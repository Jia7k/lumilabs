function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function managedChatAction(portfolio, hasExpressedInterest) {
  const conversationId = Number(portfolio.conversation_id);
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "open") {
    return `<a class="managed-chat-action" href="messages.html?conversationId=${conversationId}"><i class="ti ti-messages"></i> Open Managed Chat</a>`;
  }
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "archived") {
    return `<a class="managed-chat-action managed-chat-archived" href="messages.html?conversationId=${conversationId}"><i class="ti ti-archive"></i> View Archived Chat</a>`;
  }
  if (!hasExpressedInterest) return "";
  return `<span class="managed-chat-awaiting"><i class="ti ti-clock"></i> Awaiting Relationship Manager</span>`;
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
let recommendationState = "loading";
let recommendationRequestVersion = 0;
let recommendationLoadPromise = null;
let interestMutationInFlight = false;
let interestDataStale = false;
let workspaceReady = false;

async function fetchBrowseSnapshot() {
  const [portfolios, interests] = await Promise.all([
    API.getAllPortfolios(),
    API.getMyInterests(),
  ]);
  return {
    portfolios,
    interestedIds: new Set(interests.map(({ id }) => Number(id))),
  };
}

function commitBrowseSnapshot(snapshot) {
  allPortfolios = snapshot.portfolios;
  interestedIds = snapshot.interestedIds;
  workspaceReady = true;
}

function setBrowseStatus(message = "", type = "", retryable = false) {
  const status = document.getElementById("browse-status");
  if (!status) return;
  status.hidden = !message;
  status.className = type;
  status.innerHTML = message
    ? `<span>${escapeHtml(message)}</span>${retryable ? '<button class="btn-filter" type="button" data-retry-interest-refresh>Retry</button>' : ''}`
    : "";
}

function setRecommendationStatus(message = "", type = "", retryable = false) {
  const status = document.getElementById("recommendation-status");
  if (!status) return;
  status.hidden = !message;
  status.className = type;
  status.innerHTML = message
    ? `<span>${escapeHtml(message)}</span>${retryable ? '<button class="btn-filter" type="button" data-retry-recommendations>Retry</button>' : ''}`
    : "";
}

function syncRankingUi() {
  const button = document.getElementById("sort-ai");
  if (!button) return;
  const aiReady = recommendationState === "ready";
  button.innerHTML = aiReady
    ? '<i class="ti ti-stars"></i> AI Ranked'
    : '<i class="ti ti-chart-bar"></i> Readiness Score';
}

function rankingScore(portfolio) {
  const readinessScore = normalizeReadinessScore(portfolio.readiness_score);
  if (
    recommendationState === "ready"
    && Object.hasOwn(aiScores, portfolio.id)
  ) {
    return normalizeReadinessScore(aiScores[portfolio.id]);
  }
  return readinessScore;
}

function refreshRankingView() {
  syncRankingUi();
  if (workspaceReady || allPortfolios.length > 0) applyFilters();
}

async function loadRecommendations({ supersede = false } = {}) {
  if (recommendationLoadPromise && !supersede) return recommendationLoadPromise;

  const version = ++recommendationRequestVersion;
  recommendationState = "loading";
  refreshRankingView();

  const request = (async () => {
    try {
      const rows = await API.getRecommendations();
      if (version !== recommendationRequestVersion) return false;
      aiScores = Object.fromEntries(
        rows.map((row) => [Number(row.id), Number(row.ai_score)]),
      );
      recommendationState = "ready";
      setRecommendationStatus();
      refreshRankingView();
      return true;
    } catch (error) {
      if (version !== recommendationRequestVersion) return false;
      aiScores = {};
      recommendationState = "fallback";
      setRecommendationStatus(
        `Recommendations are unavailable: ${error.message}`,
        "warning",
        true,
      );
      refreshRankingView();
      return false;
    } finally {
      if (version === recommendationRequestVersion) {
        recommendationLoadPromise = null;
      }
    }
  })();

  recommendationLoadPromise = request;
  return request;
}

function retryRecommendations() {
  return loadRecommendations();
}

async function retryInterestRefresh() {
  if (interestMutationInFlight) return false;
  interestMutationInFlight = true;
  applyFilters();
  try {
    const snapshot = await fetchBrowseSnapshot();
    commitBrowseSnapshot(snapshot);
    interestDataStale = false;
    setBrowseStatus();
    return true;
  } catch (error) {
    interestDataStale = true;
    setBrowseStatus(`Could not refresh interest data: ${error.message}`, "error", true);
    return false;
  } finally {
    interestMutationInFlight = false;
    applyFilters();
  }
}

function setSort(mode) {
  sortMode = mode;
  document.getElementById("sort-ai").classList.toggle("active", mode === "ai");
  document.getElementById("sort-new").classList.toggle("active", mode === "new");
  applyFilters();
}

function applyFilters() {
  const search = document.getElementById("search-input").value.toLowerCase();
  const sector = document.getElementById("sector-filter").value;
  const minScore = parseInt(document.getElementById("score-filter").value) || 0;

  let filtered = allPortfolios.map((portfolio) => ({
    portfolio,
    readinessScore: normalizeReadinessScore(portfolio.readiness_score),
  })).filter(({ portfolio: p, readinessScore }) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search) || (p.owner_name || "").toLowerCase().includes(search);
    const matchSector = !sector || p.sector === sector;
    const matchScore = readinessScore >= minScore;
    return matchSearch && matchSector && matchScore;
  });

  if (sortMode === "ai") {
    filtered.sort((a, b) => {
      const scoreA = rankingScore(a.portfolio);
      const scoreB = rankingScore(b.portfolio);
      return scoreB - scoreA;
    });
  } else {
    filtered.sort(
      (a, b) => new Date(b.portfolio.created_at) - new Date(a.portfolio.created_at),
    );
  }

  renderGrid(filtered.map(({ portfolio }) => portfolio));
}

function renderGrid(portfolios) {
  const grid = document.getElementById("card-grid");
  const interestDisabled = interestMutationInFlight || interestDataStale ? " disabled" : "";
  document.getElementById("results-count").innerText = `${portfolios.length} startup${portfolios.length !== 1 ? "s" : ""} found`;

  if (!portfolios.length) {
    grid.innerHTML = `<div class="empty-state"><i class="ti ti-search"></i>No startups match your filters.</div>`;
    return;
  }

  grid.innerHTML = portfolios.map(p => {
    const liked = interestedIds.has(p.id);
    const readinessScore = normalizeReadinessScore(p.readiness_score);
    const aiReady = recommendationState === "ready";
    const score = rankingScore(p);
    const isHighPotential = readinessScore >= 75;
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
            <div class="meta-value score-value">${readinessScore}/100</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">${aiReady ? "AI Score" : "Readiness Score"}</div>
            <div class="meta-value score-value">${score}</div>
          </div>
          <div class="meta-box">
            <div class="meta-label">Interested</div>
            <div class="meta-value">${p.interest_count ?? 0}</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-interest ${liked ? "interested" : ""}" id="btn-interest-${p.id}" onclick="toggleInterest(${p.id})"${interestDisabled}>
            <i class="ti ${liked ? "ti-heart-filled" : "ti-heart"}"></i>
            ${liked ? "Interested" : "Express Interest"}
          </button>
          ${managedChatAction(p, liked)}
        </div>
      </div>
    `;
  }).join("");
}

async function toggleInterest(portfolioId) {
  if (interestMutationInFlight || interestDataStale) return;
  interestMutationInFlight = true;
  applyFilters();
  let mutationSaved = false;
  try {
    if (interestedIds.has(portfolioId)) await API.removeInterest(portfolioId);
    else await API.expressInterest(portfolioId);
    mutationSaved = true;

    const snapshot = await fetchBrowseSnapshot();
    commitBrowseSnapshot(snapshot);
    interestDataStale = false;
    setBrowseStatus();
  } catch (error) {
    if (mutationSaved) {
      interestDataStale = true;
      setBrowseStatus(
        `Your change was saved, but the latest data could not refresh: ${error.message}`,
        "warning",
        true,
      );
    } else {
      setBrowseStatus(`Could not update interest: ${error.message}`, "error");
    }
  } finally {
    interestMutationInFlight = false;
    applyFilters();
  }
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
  const user = await requirePageRole("investor");
  if (!user) return;

  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;
  const browseStatus = document.getElementById("browse-status");
  if (browseStatus) {
    browseStatus.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-retry-interest-refresh]")) retryInterestRefresh();
    });
  }
  const recommendationStatus = document.getElementById("recommendation-status");
  if (recommendationStatus) {
    recommendationStatus.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-retry-recommendations]")) {
        retryRecommendations();
      }
    });
  }

  document.getElementById("search-input").addEventListener("input", applyFilters);
  document.getElementById("sector-filter").addEventListener("change", applyFilters);
  document.getElementById("score-filter").addEventListener("change", applyFilters);

  loadRecommendations({ supersede: true });

  try {
    const snapshot = await fetchBrowseSnapshot();
    commitBrowseSnapshot(snapshot);
    interestDataStale = false;
    setBrowseStatus();
  } catch (error) {
    interestDataStale = true;
    document.getElementById("results-count").innerText = "Startups unavailable";
    document.getElementById("card-grid").innerHTML = `
      <div class="empty-state">
        <i class="ti ti-alert-circle"></i>
        Couldn't load startups: ${escapeHtml(error.message || "Please try again")}
      </div>`;
    setBrowseStatus(
      `Could not load the Browse workspace: ${error.message || "Please retry"}`,
      "error",
      true,
    );
    initRoleMenu();
    return;
  }

  applyFilters();
  initRoleMenu();
}

init();
