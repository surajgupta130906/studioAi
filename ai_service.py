import os
import httpx
from google import genai
from google.genai.errors import APIError
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# ==========================================
# 1. TEXT / PROMPT GENERATION FALLBACKS
# ==========================================

def call_openai_prompt_fallback(meta_prompt: str) -> str:
    """Fallback Tier 2: Uses OpenAI GPT-4o-mini if Gemini text models hit quota limits."""
    try:
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key:
            raise ValueError("OPENAI_API_KEY is missing from .env")

        client = OpenAI(api_key=openai_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an elite visual director and AI image prompt generator."},
                {"role": "user", "content": meta_prompt}
            ],
            temperature=0.7
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"[Warning] OpenAI prompt enhancement failed: {e}")
        raise e


def call_pollinations_prompt_fallback(meta_prompt: str) -> str:
    """Fallback Tier 3: Unlimited free text API fallback."""
    try:
        url = "https://text.pollinations.ai/"
        payload = {
            "messages": [{"role": "user", "content": meta_prompt}],
            "model": "openai"
        }
        response = httpx.post(url, json=payload, timeout=10.0)
        if response.status_code == 200:
            return response.text.strip()
    except Exception as e:
        print(f"[Warning] Pollinations text fallback failed: {e}")
    
    raise RuntimeError("All LLM prompt enhancers (Gemini, OpenAI, Pollinations) failed.")

'''
def call_gemini_with_fallback(client, meta_prompt: str) -> str:
    """Fallback Tier 1: Tries Gemini models in order."""
    models_to_try = [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash"
    ]

    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=meta_prompt,
            )
            if response and response.text:
                return response.text.strip()
        except APIError as e:
            if e.code == 429 or "RESOURCE_EXHAUSTED" in str(e):
                print(f"[Warning] Gemini quota limit hit for {model_name}. Trying next model...")
                continue
            else:
                raise e
        except Exception:
            continue

    print("[Warning] All Gemini text models exhausted. Switching to OpenAI GPT...")
    try:
        return call_openai_prompt_fallback(meta_prompt)
    except Exception:
        pass

    print("[Warning] OpenAI failed. Switching to Pollinations text backup...")
    return call_pollinations_prompt_fallback(meta_prompt)
'''

def call_gemini_with_fallback(client, meta_prompt: str) -> str:
    """Fallback Tier 1: Tries current active Gemini models in order."""
    models_to_try = [
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite"
    ]

    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=meta_prompt,
            )
            if response and response.text:
                return response.text.strip()
        except APIError as e:
            print(f"[Warning] Gemini model '{model_name}' failed ({e}). Trying next...")
            continue
        except Exception as e:
            print(f"[Warning] Unexpected error on '{model_name}': {e}. Trying next...")
            continue

    print("[Warning] All Gemini models failed. Switching to OpenAI GPT...")
    try:
        return call_openai_prompt_fallback(meta_prompt)
    except Exception:
        pass

    print("[Warning] OpenAI failed. Switching to Pollinations text backup...")
    return call_pollinations_prompt_fallback(meta_prompt)

def generate_enhanced_prompt(
    product_name: str, 
    product_description: str, 
    category: str, 
    style_theme: str, 
    lighting_style: str
) -> str:
    """
    Main exported function required by main.py to transform user inputs into 
    an enhanced image generation prompt.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    meta_prompt = f"""You are an elite visual director and AI image prompt generator. Your task is to transform simple user inputs into a single, high-detail image generation prompt for Midjourney / Stable Diffusion / Flux / DALL-E.

--- USER INPUTS ---
Subject/Name: {product_name}
Category: {category}
Theme/Style: {style_theme}
Lighting: {lighting_style}
Additional Details: {product_description}

--- GENERATION RULES ---
1. INTENT RECOGNITION:
   - If Category/Subject is "Nature & Landscapes", "Architecture", or environmental scenery: Describe a wide-angle composition, horizon depth, atmospheric lighting, weather, and fine natural details. DO NOT add products, containers, bottles, models, or human artifacts unless explicitly requested.
   - If Category/Subject is a retail product (e.g., Cosmetics, Electronics, Apparel): Describe studio product photography setup, surface textures, soft reflections, shadow depth, and display materials.

2. VISUAL DETAILS TO INCLUDE:
   - Subject framing, background elements, lighting style ({lighting_style}), color palette, texture details, depth of field, and camera perspective.

3. OUTPUT FORMAT:
   - Output EXACTLY one paragraph containing the raw image prompt.
   - DO NOT include intros, explanations, quote marks, markdown headers, or labels like "Prompt:"."""

    if not api_key:
        print("[Warning] GEMINI_API_KEY missing. Attempting OpenAI directly...")
        return call_openai_prompt_fallback(meta_prompt)

    client = genai.Client(api_key=api_key)
    return call_gemini_with_fallback(client, meta_prompt)


# ==========================================
# 2. IMAGE GENERATION FALLBACKS
# ==========================================

def generate_image_with_gemini_imagen(prompt: str) -> str:
    """Image Provider Tier 1: Gemini Imagen 3"""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY missing")

    client = genai.Client(api_key=api_key)
    result = client.models.generate_images(
        model='imagen-3.0-generate-002',
        prompt=prompt,
        config=dict(
            number_of_images=1,
            output_mime_type="image/jpeg",
        )
    )
    for generated_image in result.generated_images:
        return generated_image.image.image_bytes
    raise Exception("Imagen failed to generate image bytes.")


def generate_image_with_openai_dalle(prompt: str) -> str:
    """Image Provider Tier 2: OpenAI DALL-E 3"""
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        raise ValueError("OPENAI_API_KEY missing")

    client = OpenAI(api_key=openai_key)
    response = client.images.generate(
        model="dall-e-3",
        prompt=prompt,
        size="1024x1024",
        quality="standard",
        n=1,
    )
    return response.data[0].url


def generate_image_with_pollinations(prompt: str) -> str:
    """Image Provider Tier 3: Free Pollinations Flux Fallback"""
    formatted_prompt = prompt.replace(" ", "%20")
    image_url = f"https://pollinations.ai/p/{formatted_prompt}?width=1024&height=1024&seed=42&model=flux"
    return image_url


def generate_final_image(prompt: str) -> dict:
    """
    Exported function to generate images with sequential failover:
    Gemini Imagen -> OpenAI DALL-E 3 -> Pollinations (Flux)
    """
    image_providers = [
        ("Gemini Imagen 3", generate_image_with_gemini_imagen),
        ("OpenAI DALL-E 3", generate_image_with_openai_dalle),
        ("Pollinations Flux", generate_image_with_pollinations),
    ]

    for provider_name, provider_func in image_providers:
        try:
            print(f"[Info] Attempting image generation with {provider_name}...")
            image_result = provider_func(prompt)
            return {
                "status": "success",
                "provider": provider_name,
                "result": image_result
            }
        except Exception as e:
            print(f"[Warning] {provider_name} failed: {e}. Trying next provider...")
            continue

    raise RuntimeError("All image generation providers (Gemini, OpenAI, Pollinations) failed.")
