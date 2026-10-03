const API_BASE = "http://127.0.0.1:8000";

let currentJobData = null;
let selectedHistoryItem = null;
let pendingDeleteId = null;
let historyDataCache = [];

let currentUser = {
    username: "",
    email: "",
    isLoggedIn: false,
    joinDate: "Oct 2026"
};

let historyModalObj = null;
let deleteModalObj = null;

// 10 Multi-Genre Showcase Prompts
const demoExploreItems = [
    { name: "Jagged Alpine Fjord", category: "Nature & Landscapes", theme: "Cinematic Landscape", lighting: "Golden Hour Natural", desc: "Panoramic view of snow-capped alpine mountains near ocean fjords in sunset.", url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&q=80" },
    { name: "Orbital Space Station", category: "Space & Sci-Fi", theme: "Cyberpunk Neon", lighting: "Moody Dark Studio", desc: "Futuristic orbital space station floating above Earth horizon.", url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&q=80" },
    { name: "Brutalist Concrete Villa", category: "Architecture & Spaces", theme: "Studio Minimalist", lighting: "Warm Soft Side-Light", desc: "Minimalist modern concrete villa embedded in cliffside overlooking sea.", url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80" },
    { name: "Cyberpunk Cybernetic Visor", category: "Space & Sci-Fi", theme: "Cyberpunk Neon", lighting: "Volumetric Neon", desc: "Futuristic cyber visor glowing with vivid magenta and cyan ambient lighting.", url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600&q=80" },
    { name: "High-Fashion Trench Coat", category: "Fashion & Apparel", theme: "Studio Minimalist", lighting: "Warm Soft Side-Light", desc: "Haute couture beige trench coat model photography, studio backlighting.", url: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=600&q=80" },
    { name: "Matte Black Ceramic Tea Set", category: "Home & Kitchen", theme: "Rustic Organic", lighting: "Warm Soft Side-Light", desc: "Handcrafted black ceramic tea set on raw wooden oak table with steam.", url: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=600&q=80" },
    { name: "Cinematic Studio Portrait", category: "Portraits & Characters", theme: "Studio Minimalist", lighting: "Moody Dark Studio", desc: "Dramatic studio lighting portrait of a model with soft shadow contrast.", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&q=80" },
    { name: "Retro Futurist Concept Car", category: "Automotive & Transport", theme: "Cyberpunk Neon", lighting: "Volumetric Neon", desc: "Sleek metallic concept car driving on wet rain-slicked neon street.", url: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=600&q=80" },
    { name: "Amber Glass Dropper Bottle", category: "Home & Kitchen", theme: "Luxury Gold & Marble", lighting: "Warm Soft Side-Light", desc: "Amber glass bottle sitting on wet white marble with rim lighting.", url: "https://images.unsplash.com/photo-1608248597261-833258657640?w=600&q=80" },
    { name: "Misty Pine Forest Valley", category: "Nature & Landscapes", theme: "Cinematic Landscape", lighting: "Golden Hour Natural", desc: "Sunlight filtering through dense pine forest trees in morning valley fog.", url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&q=80" }
];

document.addEventListener("DOMContentLoaded", () => {
    // Modal Setup
    const historyModalEl = document.getElementById('historyModal');
    const deleteModalEl = document.getElementById('deleteConfirmModal');
    if (historyModalEl) historyModalObj = new bootstrap.Modal(historyModalEl);
    if (deleteModalEl) deleteModalObj = new bootstrap.Modal(deleteModalEl);

    // Render public showcase items on startup
    renderExploreShowcase();

    // Soft Token Check - Do NOT redirect if missing
    const token = sessionStorage.getItem('access_token');
    if (token) {
        currentUser.isLoggedIn = true;
        loadUserProfile();
        loadHistory();
    } else {
        currentUser.isLoggedIn = false;
        updateUserUI();
    }
});

// Flexible Fetch Wrapper (Works for both guest and authenticated requests)
async function fetchWithAuth(url, options = {}) {
    const token = sessionStorage.getItem('access_token');
    
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {})
    };

    const response = await fetch(url, { ...options, headers });

    // Handle token expiration only if user was logged in
    if ((response.status === 401 || response.status === 403) && token) {
        alert("Session expired. Please sign in again.");
        sessionStorage.clear();
        currentUser.isLoggedIn = false;
        window.location.href = 'login.html';
        return null;
    }

    return response;
}

// Fetch Logged-In User Profile
async function loadUserProfile() {
    try {
        const res = await fetchWithAuth(`${API_BASE}/users/me`);
        if (!res) return;

        if (res.ok) {
            const data = await res.json();
            currentUser = {
                username: data.username || "User",
                email: data.email || "",
                isLoggedIn: true,
                joinDate: data.joinDate || "Oct 2026"
            };
            updateUserUI();
        }
    } catch (err) {
        console.error("Failed to load user profile:", err);
    }
}

// Section Navigation
function showSection(section) {
    document.getElementById('nav-gen')?.classList.remove('active');
    document.getElementById('nav-explore')?.classList.remove('active');
    document.getElementById('nav-gallery')?.classList.remove('active');
    document.getElementById('nav-profile')?.classList.remove('active');

    document.getElementById('generator-section').style.display = 'none';
    document.getElementById('explore-section').style.display = 'none';
    document.getElementById('gallery-section').style.display = 'none';
    document.getElementById('profile-section').style.display = 'none';

    if (section === 'generator') {
        document.getElementById('generator-section').style.display = 'flex';
        document.getElementById('nav-gen')?.classList.add('active');
    } else if (section === 'explore') {
        document.getElementById('explore-section').style.display = 'block';
        document.getElementById('nav-explore')?.classList.add('active');
    } else if (section === 'gallery') {
        document.getElementById('gallery-section').style.display = 'block';
        document.getElementById('nav-gallery')?.classList.add('active');
        if (currentUser.isLoggedIn) loadHistory();
    } else if (section === 'profile') {
        document.getElementById('profile-section').style.display = 'block';
        document.getElementById('nav-profile')?.classList.add('active');
        syncProfileFields();
    }
}

// User Profile & Authentication UI Logic
function updateUserUI() {
    const loggedOutView = document.getElementById('logged-out-view');
    const loggedInView = document.getElementById('logged-in-view');

    if (currentUser.isLoggedIn) {
        if (loggedOutView) loggedOutView.style.display = 'none';
        if (loggedInView) loggedInView.style.display = 'block';
        
        const userDisplayName = document.getElementById('user-display-name');
        if (userDisplayName) userDisplayName.innerText = currentUser.username;

        const initials = currentUser.username.substring(0, 2).toUpperCase() || "U";
        const avatarInitials = document.getElementById('user-avatar-initials');
        const profileLargeAvatar = document.getElementById('profile-large-avatar');
        
        if (avatarInitials) avatarInitials.innerText = initials;
        if (profileLargeAvatar) profileLargeAvatar.innerText = initials;
    } else {
        if (loggedOutView) loggedOutView.style.display = 'block';
        if (loggedInView) loggedInView.style.display = 'none';
    }
}

function syncProfileFields() {
    const profileUserName = document.getElementById('profile-user-name');
    const profileUserEmail = document.getElementById('profile-user-email');
    const editName = document.getElementById('edit_profile_name');
    const editEmail = document.getElementById('edit_profile_email');
    const profileMemberSince = document.getElementById('profile-member-since');

    if (profileUserName) profileUserName.innerText = currentUser.username;
    if (profileUserEmail) profileUserEmail.innerText = currentUser.email;
    if (editName) editName.value = currentUser.username;
    if (editEmail) editEmail.value = currentUser.email;
    if (profileMemberSince) profileMemberSince.innerText = currentUser.joinDate;
}

async function handleLogout() {
    try {
        await fetchWithAuth(`${API_BASE}/logout`, { method: 'POST' });
    } catch (e) {
        console.error("Error logging out:", e);
    } finally {
        sessionStorage.clear();
        currentUser.isLoggedIn = false;
        window.location.href = 'login.html';
    }
}

// Job Generation (Protected Action)
async function submitJob() {
    // Check if user is logged in before allowing generation
    const token = sessionStorage.getItem('access_token');
    if (!token) {
        if (confirm("You need to be logged in to generate images. Would you like to go to the login page?")) {
            window.location.href = 'login.html';
        }
        return;
    }

    const payload = {
        product_name: document.getElementById("product_name").value.trim(),
        product_description: document.getElementById("product_description").value.trim(),
        category: document.getElementById("category").value,
        style_theme: document.getElementById("style_theme").value,
        lighting_style: document.getElementById("lighting_style").value,
        aspect_ratio: document.getElementById("aspect_ratio").value
    };

    if (!payload.product_name || !payload.product_description) {
        alert("Please provide both a Subject Name and Description.");
        return;
    }

    document.getElementById("submit-btn").disabled = true;
    document.getElementById("placeholder-view").style.display = "none";
    document.getElementById("result-view").style.display = "block";
    document.getElementById("image-container").style.display = "none";
    document.getElementById("prompt-container").style.display = "none";

    const badge = document.getElementById("status-badge");
    badge.className = "badge bg-warning text-dark";
    badge.innerText = "PENDING";

    try {
        const res = await fetchWithAuth(`${API_BASE}/generate`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        if (!res) return;

        const data = await res.json();
        document.getElementById("job-id-text").innerText = data.job_id;
        pollJob(data.job_id);
    } catch (err) {
        alert("Error launching generation job: " + err);
        document.getElementById("submit-btn").disabled = false;
    }
}

async function pollJob(jobId) {
    const timer = setInterval(async () => {
        try {
            const res = await fetchWithAuth(`${API_BASE}/jobs/${jobId}`, { method: 'GET' });
            if (!res || !res.ok) return;

            const job = await res.json();
            const badge = document.getElementById("status-badge");

            if (job.status === "completed") {
                clearInterval(timer);
                badge.className = "badge bg-success";
                badge.innerText = "COMPLETED";

                currentJobData = job;
                document.getElementById("output-image").src = job.result_url || job.image_url;
                document.getElementById("output-prompt").innerText = job.enhanced_prompt || job.prompt;

                document.getElementById("image-container").style.display = "block";
                document.getElementById("prompt-container").style.display = "block";
                document.getElementById("submit-btn").disabled = false;
            } else if (job.status === "failed") {
                clearInterval(timer);
                badge.className = "badge bg-danger";
                badge.innerText = "FAILED";
                alert("Generation failed: " + (job.error_message || "Unknown error"));
                document.getElementById("submit-btn").disabled = false;
            } else {
                badge.className = "badge bg-info text-dark";
                badge.innerText = "PROCESSING";
            }
        } catch (err) {
            console.error("Polling error:", err);
        }
    }, 2000);
}

// Helpers & Showcase
function applySuggestion() {
    const suggestions = [
        { name: "Nebula Glass Portal", category: "Space & Sci-Fi", theme: "Cyberpunk Neon", lighting: "Volumetric Neon", desc: "A circular glass portal hovering in deep space with swirling neon pink and blue nebulae." },
        { name: "Ethereal Crystal Waterfall", category: "Nature & Landscapes", theme: "Cinematic Landscape", lighting: "Golden Hour Natural", desc: "Lush turquoise waterfall flowing over glowing crystal rocks in an untouched mystical cavern." },
        { name: "Titanium Cybernetic Watch", category: "Fashion & Apparel", theme: "Studio Minimalist", lighting: "Moody Dark Studio", desc: "Macro studio shot of a brushed titanium watch with intricate glowing circuitry internal movement." }
    ];
    const item = suggestions[Math.floor(Math.random() * suggestions.length)];
    document.getElementById("product_name").value = item.name;
    document.getElementById("category").value = item.category;
    document.getElementById("style_theme").value = item.theme;
    document.getElementById("lighting_style").value = item.lighting;
    document.getElementById("product_description").value = item.desc;
}

function downloadCurrentImage() {
    const imageUrl = currentJobData?.result_url || currentJobData?.image_url;
    if (!imageUrl) return;
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `StudioAI_${currentJobData.id || currentJobData.job_id || "render"}.png`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function renderExploreShowcase() {
    const grid = document.getElementById("explore-grid");
    if (!grid) return;
    grid.innerHTML = "";

    demoExploreItems.forEach((item) => {
        const col = document.createElement("div");
        col.className = "col-md-6 col-lg-4";
        col.innerHTML = `
            <div class="card asset-card h-100 shadow-sm overflow-hidden border-secondary">
                <img src="${item.url}" class="card-img-top" alt="${item.name}">
                <div class="card-body d-flex flex-column">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="badge bg-primary-subtle text-primary border border-primary-subtle">${item.category}</span>
                        <small class="text-muted"><i class="bi bi-camera"></i> ${item.lighting}</small>
                    </div>
                    <h6 class="card-title fw-bold text-white mb-2">${item.name}</h6>
                    <p class="card-text text-secondary small flex-grow-1">${item.desc}</p>
                    <button class="btn btn-sm btn-outline-primary rounded-pill w-100 mt-2" onclick='loadExploreIntoGenerator(${JSON.stringify(item)})'>
                        <i class="bi bi-magic me-1"></i> Use Parameters
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(col);
    });
}

function loadExploreIntoGenerator(item) {
    document.getElementById("product_name").value = item.name;
    document.getElementById("category").value = item.category;
    document.getElementById("style_theme").value = item.theme;
    document.getElementById("lighting_style").value = item.lighting;
    document.getElementById("product_description").value = item.desc;

    showSection('generator');
}

// History API Integration
async function loadHistory() {
    try {
        const res = await fetchWithAuth(`${API_BASE}/history`);
        if (!res || !res.ok) return;
        historyDataCache = await res.json();
        renderHistoryGrid(historyDataCache);
    } catch (err) {
        console.error("Failed to load history:", err);
    }
}

function renderHistoryGrid(items) {
    const grid = document.getElementById("history-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (!items || items.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center py-5 text-muted"><p>No assets generated yet.</p></div>`;
        return;
    }

    items.forEach((item) => {
        const col = document.createElement("div");
        col.className = "col-md-6 col-lg-4";
        const imgUrl = item.result_url || item.image_url;
        const promptText = item.enhanced_prompt || item.prompt || "";
        col.innerHTML = `
            <div class="card asset-card h-100 shadow-sm overflow-hidden border-secondary">
                <div class="card-actions gap-1">
                    <button class="btn btn-sm btn-danger rounded-circle p-1 px-2" onclick="promptDeleteAsset('${item.id}', event)"><i class="bi bi-trash"></i></button>
                </div>
                <img src="${imgUrl}" class="card-img-top" alt="Asset" onclick='openHistoryModal(${JSON.stringify(item)})' style="cursor: pointer;">
                <div class="card-body">
                    <h6 class="card-title text-truncate text-white mb-1">${item.product_name || "Generated Asset"}</h6>
                    <p class="card-text text-muted small text-truncate mb-0">${promptText}</p>
                </div>
            </div>
        `;
        grid.appendChild(col);
    });
}

function filterGallery() {
    const query = document.getElementById("search-gallery").value.toLowerCase();
    const filtered = historyDataCache.filter(item => {
        const nameMatch = item.product_name && item.product_name.toLowerCase().includes(query);
        const promptMatch = (item.enhanced_prompt || item.prompt) && (item.enhanced_prompt || item.prompt).toLowerCase().includes(query);
        return nameMatch || promptMatch;
    });
    renderHistoryGrid(filtered);
}

function openHistoryModal(item) {
    selectedHistoryItem = item;
    document.getElementById("modalTitle").innerText = item.product_name || "Asset Details";
    document.getElementById("modalImage").src = item.result_url || item.image_url;
    document.getElementById("modalPrompt").innerText = item.enhanced_prompt || item.prompt;
    if (historyModalObj) historyModalObj.show();
}

function twistCurrentAsset() {
    if (!selectedHistoryItem) return;
    document.getElementById("product_name").value = selectedHistoryItem.product_name || "";
    if (selectedHistoryItem.category) document.getElementById("category").value = selectedHistoryItem.category;
    if (selectedHistoryItem.style_theme) document.getElementById("style_theme").value = selectedHistoryItem.style_theme;
    if (selectedHistoryItem.lighting_style) document.getElementById("lighting_style").value = selectedHistoryItem.lighting_style;
    document.getElementById("product_description").value = selectedHistoryItem.product_description || selectedHistoryItem.enhanced_prompt || selectedHistoryItem.prompt || "";
    
    if (historyModalObj) historyModalObj.hide();
    showSection('generator');
}

function promptDeleteAsset(jobId, event) {
    event.stopPropagation();
    pendingDeleteId = jobId;
    if (deleteModalObj) deleteModalObj.show();
}

async function confirmDeleteAction() {
    if (!pendingDeleteId) return;
    try {
        const res = await fetchWithAuth(`${API_BASE}/history/${pendingDeleteId}`, { method: "DELETE" });
        if (res && res.ok) {
            if (deleteModalObj) deleteModalObj.hide();
            pendingDeleteId = null;
            loadHistory();
        }
    } catch (err) {
        alert("Failed to delete asset: " + err);
    }
}
