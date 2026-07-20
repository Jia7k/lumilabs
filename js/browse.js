function escapeHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatFunding(n) {
  n = Number(n);
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n;
}

let allPortfolios = [];
let interestedIds = new Set();
let sortMode = "ai";
let aiScores = {};

function setSort(mode) {
  sortMode = mode;
  document.getElementById("sort-ai").classList.toggle("active", mode === "ai");
  document.getElementById("sort-new").classList.toggle("active", mode === "new");
  applyFilters();
}

function applyFilters() {
  const search = document.getElementById("search-input").value.toLowerCase();
  const sector = document.getElementById("sector-filter").value.toLowerCase();
  const minScore = parseInt(document.getElementById("score-filter").value) || 0;

  let filtered = allPortfolios.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search) || (p.owner_name || "").toLowerCase().includes(search);
    const matchSector = !sector || p.sector.toLowerCase().includes(sector);
    const matchScore = p.readiness_score >= minScore;
    return matchSearch && matchSector && matchScore;
  });

  if (sortMode === "ai") {
    filtered.sort((a, b) => (aiScores[b.id] ?? 0) - (aiScores[a.id] ?? 0));
  } else {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  renderGrid(filtered);
}

function renderGrid(portfolios) {
  const grid = document.getElementById("card-grid");
  document.getElementById("results-count").innerText = `${portfolios.length} startup${portfolios.length !== 1 ? "s" : ""} found`;

  if (!portfolios.length) {
    grid.innerHTML = `<div class="empty-state"><i class="ti ti-search"></i>No startups match your filters.</div>`;
    return;
  }

  grid.innerHTML = portfolios.map(p => {
    const liked = interestedIds.has(p.id);
    const score = aiScores[p.id] ?? p.readiness_score;
    const isHighPotential = p.readiness_score >= 75;
    return `
      <div class="startup-card" id="card-${p.id}">
        <div class="card-top">
          <div class="card-icon"><i class="ti ti-briefcase"></i></div>
          <span class="sector-badge">${escapeHtml(p.sector)}</span>
        </div>
        <div>
          <div class="card-name">${escapeHtml(p.name)}</div>
          <div class="card-owner">by ${escapeHtml(p.owner_name)}</div>
          ${isHighPotential ? `<span class="high-potential-badge" style="margin-top:6px;display:inline-flex;"><i class="ti ti-star"></i> High Potential</span>` : ""}
        </div>
        <div class="card-meta">
          <div class="meta-box">
            <div class="meta-label">Funding Goal</div>
            <div class="meta-value">${formatFunding(p.funding_goal)}</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Readiness <button onclick="showScoreInfo()" title="How is this calculated?" style="background:none;border:none;cursor:pointer;color:#9CA3AF;font-size:14px;vertical-align:middle;padding:0 2px;line-height:1;">ℹ</button></div>
            <div class="meta-value score-value">${p.readiness_score}/100</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">AI Score</div>
            <div class="meta-value score-value">${score}</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Interested</div>
            <div class="meta-value">${p.interest_count ?? 0}</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-interest ${liked ? "interested" : ""}" id="btn-interest-${p.id}" onclick="toggleInterest(${p.id})">
            <i class="ti ${liked ? "ti-heart-filled" : "ti-heart"}"></i>
            ${liked ? "Interested" : "Express Interest"}
          </button>
          <button class="btn-message" onclick="window.location.href='messages.html'" title="Message owner">
            <i class="ti ti-message"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function toggleInterest(portfolioId) {
  const btn = document.getElementById(`btn-interest-${portfolioId}`);
  btn.disabled = true;
  try {
    if (interestedIds.has(portfolioId)) {
      await API.removeInterest(portfolioId);
      interestedIds.delete(portfolioId);
    } else {
      await API.expressInterest(portfolioId);
      interestedIds.add(portfolioId);
    }
    const liked = interestedIds.has(portfolioId);
    btn.className = `btn-interest ${liked ? "interested" : ""}`;
    btn.innerHTML = `<i class="ti ${liked ? "ti-heart-filled" : "ti-heart"}"></i> ${liked ? "Interested" : "Express Interest"}`;
  } catch (err) {
    alert("Could not update interest: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

function signOut() {
  localStorage.removeItem("lumilabsToken");
  window.location.href = "signin.html";
}

function initRoleMenu() {
  const menu = document.getElementById("role-menu");
  const button = document.getElementById("role-menu-button");
  if (!menu || !button) return;
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", () => menu.classList.remove("open"));
}

async function init() {
  let user;
  try {
    user = await API.getCurrentUser();
  } catch {
    window.location.href = "signin.html";
    return;
  }
  if (user.role !== "investor") {
    window.location.href = "signin.html";
    return;
  }

  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;

  const [portfoliosRes, myInterestsRes, recsRes] = await Promise.allSettled([
    API.getAllPortfolios(),
    API.getMyInterests(),
    API.getRecommendations(),
  ]);

  if (portfoliosRes.status === "fulfilled") {
    allPortfolios = portfoliosRes.value;
  }

  if (myInterestsRes.status === "fulfilled") {
    interestedIds = new Set(myInterestsRes.value.map(i => i.id));
  }

  if (recsRes.status === "fulfilled") {
    recsRes.value.forEach(p => { aiScores[p.id] = p.ai_score; });
  }

  document.getElementById("search-input").addEventListener("input", applyFilters);
  document.getElementById("sector-filter").addEventListener("change", applyFilters);
  document.getElementById("score-filter").addEventListener("change", applyFilters);

  applyFilters();
  initRoleMenu();
}

init();
