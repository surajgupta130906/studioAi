import uuid
import traceback
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, status
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from database import get_db_connection
from ai_service import generate_enhanced_prompt
import auth

app = FastAPI(title="Content Engine API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------------
# Pydantic Schemas
# -------------------------------------------------------------------
class ProductRequest(BaseModel):
    product_name: str
    product_description: str
    category: str = "Home & Kitchen"
    style_theme: str = "Studio Minimalist"
    aspect_ratio: str = "1:1"
    lighting_style: str = "Warm Cinematic"

class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# -------------------------------------------------------------------
# Auth Helper & Dependencies
# -------------------------------------------------------------------
def is_token_blacklisted(token: str) -> bool:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM token_blacklist WHERE token = %s", (token,))
        result = cursor.fetchone()
        return result is not None
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def get_current_user(token: str = Depends(auth.oauth2_scheme)):
    if is_token_blacklisted(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been logged out or revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = auth.decode_access_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    username = payload["sub"]
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT id, username, email FROM users WHERE username = %s OR email = %s", (username, username))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    finally:
        cursor.close()
        conn.close()

# -------------------------------------------------------------------
# Authentication Endpoints
# -------------------------------------------------------------------
@app.post("/register", status_code=201)
def register(user: UserRegister):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT id FROM users WHERE username = %s OR email = %s", (user.username, user.email))
        existing = cursor.fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username or email already registered")
        
        hashed_pwd = auth.get_password_hash(user.password)
        cursor.execute(
            "INSERT INTO users (username, email, hashed_password) VALUES (%s, %s, %s)",
            (user.username, user.email, hashed_pwd)
        )
        conn.commit()
        return {"message": "User registered successfully"}
    finally:
        cursor.close()
        conn.close()

@app.post("/login")
def login(credentials: UserLogin):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id, username, email, hashed_password, DATE_FORMAT(created_at, '%%b %%Y') as join_date FROM users WHERE email = %s", 
            (credentials.email,)
        )
        user = cursor.fetchone()
        
        # 1. Verify user exists
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Account not found. Please sign up first."
            )
        
        # 2. Verify hashed password match
        if not auth.verify_password(credentials.password, user["hashed_password"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect password."
            )
        
        # 3. Create access token
        access_token = auth.create_access_token(data={"sub": user["username"]})
        
        return {
            "status": "success",
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": user["id"],
                "username": user["username"],
                "email": user["email"],
                "joinDate": user.get("join_date", "Recent")
            }
        }
    finally:
        cursor.close()
        conn.close()

@app.post("/token", response_model=Token)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute("SELECT username, hashed_password FROM users WHERE username = %s OR email = %s", (form_data.username, form_data.username))
        user = cursor.fetchone()
        if not user or not auth.verify_password(form_data.password, user["hashed_password"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username/email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        access_token = auth.create_access_token(data={"sub": user["username"]})
        return {"access_token": access_token, "token_type": "bearer"}
    finally:
        cursor.close()
        conn.close()

@app.post("/logout")
def logout(token: str = Depends(auth.oauth2_scheme)):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO token_blacklist (token) VALUES (%s)", (token,))
        conn.commit()
        return {"message": "Successfully logged out across all sessions"}
    finally:
        cursor.close()
        conn.close()

@app.get("/users/me")
def read_users_me(current_user: dict = Depends(get_current_user)):
    return current_user

# -------------------------------------------------------------------
# Product Generation & Jobs API
# -------------------------------------------------------------------
@app.get("/")
def home():
    return FileResponse("index.html")

@app.get("/health")
def health_check():
    return {"status": "ok"}

def process_image_job(job_id: str, payload_dict: dict):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("UPDATE jobs SET status = 'processing' WHERE id = %s", (job_id,))
        conn.commit()
        
        enhanced_prompt = generate_enhanced_prompt(
            payload_dict["product_name"],
            payload_dict["product_description"],
            payload_dict["category"],
            payload_dict["style_theme"],
            payload_dict["lighting_style"]
        )
        
        dim_map = {"1:1": (800, 800), "16:9": (1024, 576), "4:5": (800, 1000)}
        width, height = dim_map.get(payload_dict["aspect_ratio"], (800, 800))
        
        encoded_prompt = urllib.parse.quote(enhanced_prompt)
        image_result_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&nologo=true"
        
        update_query = """
            UPDATE jobs 
            SET enhanced_prompt = %s, result_url = %s, status = 'completed' 
            WHERE id = %s
        """
        cursor.execute(update_query, (enhanced_prompt, image_result_url, job_id))
        conn.commit()
        
    except Exception as e:
        print("Error in background task:", traceback.format_exc())
        if conn and cursor:
            cursor.execute("UPDATE jobs SET status = 'failed', error_message = %s WHERE id = %s", (str(e), job_id))
            conn.commit()
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

@app.post("/generate")
def create_job(payload: ProductRequest, background_tasks: BackgroundTasks):
    try:
        job_id = str(uuid.uuid4())
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = """
            INSERT INTO jobs (id, product_name, product_description, category, style_theme, aspect_ratio, lighting_style, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(query, (
            job_id, payload.product_name, payload.product_description,
            payload.category, payload.style_theme, payload.aspect_ratio,
            payload.lighting_style, 'pending'
        ))
        conn.commit()
        cursor.close()
        conn.close()
        
        background_tasks.add_task(process_image_job, job_id, payload.dict())
        return {"job_id": job_id, "status": "pending"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": traceback.format_exc()})

@app.get("/jobs/{job_id}")
def get_job_status(job_id: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM jobs WHERE id = %s", (job_id,))
        job = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/history")
def get_job_history():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM jobs WHERE status = 'completed' ORDER BY created_at DESC")
        history = cursor.fetchall()
        cursor.close()
        conn.close()
        return history
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.delete("/history/{job_id}")
def delete_history_item(job_id: str):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM jobs WHERE id = %s", (job_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return {"status": "deleted", "job_id": job_id}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
