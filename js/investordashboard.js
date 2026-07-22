function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatFunding(n) {
  n = Number(n);
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n;
}

function managedChatAction(interest) {
  const conversationId = Number(interest.conversation_id);
  if (Number.isInteger(conversationId) && conversationId > 0 && interest.chat_state === "open") {
    return `<a class="managed-chat-action managed-chat-action--compact" href="messages.html?conversationId=${conversationId}"><i class="ti ti-messages"></i> Open Managed Chat</a>`;
  }
  if (Number.isInteger(conversationId) && conversationId > 0 && interest.chat_state === "archived") {
    return `<a class="managed-chat-action managed-chat-action--compact managed-chat-archived" href="messages.html?conversationId=${conversationId}"><i class="ti ti-archive"></i> View Archived Chat</a>`;
  }
  return `<span class="managed-chat-awaiting managed-chat-awaiting--compact"><i class="ti ti-clock"></i> Awaiting Relationship Manager</span>`;
}

function retrySection(message) {
  return `<div class="empty-state" role="alert">
    <i class="ti ti-alert-circle"></i>
    <p>${escapeHtml(message)}</p>
    <button class="btn-refresh" type="button" onclick="refreshInvestorDashboard()">Retry</button>
  </div>`;
}

function renderQuickActions(interestCount = null) {
  const badge = Number.isFinite(Number(interestCount)) && Number(interestCount) > 0
    ? `<span class="badge-red">${Number(interestCount)}</span>`
    : "";
  document.getElementById("quick-actions-list").innerHTML = `
    <button class="quick-action-btn" onclick="window.location.href='browse.html'">
      <div class="qa-left"><i class="ti ti-search"></i> Browse Startups</div>
      <i class="ti ti-chevron-right" style="color:var(--text-muted)"></i>
    </button>
    <button class="quick-action-btn" onclick="window.location.href='my-interests.html'">
      <div class="qa-left"><i class="ti ti-heart"></i> My Interests</div>${badge}
    </button>
    <button class="quick-action-btn" onclick="window.location.href='messages.html'">
      <div class="qa-left"><i class="ti ti-message"></i> Messages</div>
    </button>`;
}

function renderDashboardResult(result) {
  const statIds = ["stat-available", "stat-interests", "stat-messages", "stat-potential"];
  if (result.status === "rejected") {
    statIds.forEach((id) => { document.getElementById(id).innerText = "—"; });
    document.getElementById("recent-interests-list").innerHTML = retrySection(
      `Couldn't load dashboard data: ${result.reason?.message || "Please retry"}`,
    );
    return null;
  }

  const { stats, recentInterests } = result.value;
  document.getElementById("stat-available").innerText = stats.available;
  document.getElementById("stat-interests").innerText = stats.interests;
  document.getElementById("stat-messages").innerText = stats.messages;
  document.getElementById("stat-potential").innerText = stats.highPotential;
  document.getElementById("recent-interests-list").innerHTML = recentInterests.length
    ? recentInterests.map((interest) => `
      <div class="interest-list-item">
        <div class="il-icon"><i class="ti ti-heart"></i></div>
        <div><div class="il-name">${escapeHtml(interest.name)}</div>
        <div class="il-sub">${escapeHtml(interest.sector)}</div></div>
        ${managedChatAction(interest)}
      </div>`).join("")
    : '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No interests yet.</p>';
  return stats.interests;
}

function renderRecommendationResult(result) {
  if (result.status === "rejected") {
    const error = retrySection(
      `Couldn't load recommendations: ${result.reason?.message || "Please retry"}`,
    );
    document.getElementById("recommended-list").innerHTML = error;
    document.getElementById("recently-added-grid").innerHTML = error;
    return;
  }

  const top = result.value.slice(0, 5);
  document.getElementById("recommended-list").innerHTML = top.length
    ? top.map((portfolio, index) => `
      <div class="rec-item" style="cursor:pointer;" onclick="window.location.href='browse.html'">
        <div class="rec-rank">#${index + 1}</div>
        <div class="rec-info"><div class="rec-name-row">
          <span class="rec-name">${escapeHtml(portfolio.name)}</span>
          ${portfolio.is_high_potential ? '<span class="badge-purple"><i class="ti ti-star"></i> High Potential</span>' : ""}
        </div><div class="rec-industry">${escapeHtml(portfolio.sector)}</div></div>
        <div class="score-text">${portfolio.ai_score}</div>
        <i class="ti ti-arrow-right rec-arrow"></i>
      </div>`).join("")
    : '<p style="padding:20px;color:var(--text-muted);">No approved startups yet.</p>';

  const recent = [...result.value]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 4);
  document.getElementById("recently-added-grid").innerHTML = recent.length
    ? recent.map((portfolio) => `
      <div class="recent-card" style="cursor:pointer;" onclick="window.location.href='browse.html'">
        <div class="rc-top">
          <div class="rc-icon"><i class="ti ti-briefcase"></i></div>
          <div class="rc-star" style="background:${portfolio.readiness_score >= 75 ? "var(--purple-light)" : "var(--bg-page)"}; color:${portfolio.readiness_score >= 75 ? "var(--purple-text)" : "var(--text-muted)"}"><i class="ti ti-star"></i></div>
        </div>
        <div><div class="rc-name">${escapeHtml(portfolio.name)}</div>
        <div class="rc-industry">${escapeHtml(portfolio.sector)}</div></div>
        <div class="rc-bottom"><div class="rc-money">${formatFunding(portfolio.funding_goal)}</div>
        <div class="rc-score" style="color:${portfolio.readiness_score >= 70 ? "var(--primary-green)" : "#D98F39"}; background:${portfolio.readiness_score >= 70 ? "rgba(82,164,117,0.1)" : "rgba(217,143,57,0.1)"}">${portfolio.readiness_score}</div></div>
      </div>`).join("")
    : '<p style="color:var(--text-muted);">No startups yet.</p>';
}

async function loadInvestorDashboard() {
  const [dashboard, recommendations] = await Promise.allSettled([
    API.getInvestorDashboard(),
    API.getRecommendations(),
  ]);
  const interestCount = renderDashboardResult(dashboard);
  renderRecommendationResult(recommendations);
  renderQuickActions(interestCount);
}

async function init() {
  const user = await requirePageRole("investor");
  if (!user) return;

  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;
  document.getElementById("user-role").innerText = "Investor";
  document.getElementById("page-title").innerText = `Welcome back, ${user.name}`;
  document.getElementById("page-subtitle").innerText = "Discover promising startups and investment opportunities";

  if (!roleMenuInitialized) {
    initRoleMenu();
    roleMenuInitialized = true;
  }
  renderQuickActions(null);
  await loadInvestorDashboard();
}

let isRefreshing = false;
let roleMenuInitialized = false;

async function refreshInvestorDashboard() {
  if (isRefreshing) return;
  isRefreshing = true;
  const button = document.getElementById("recommendations-refresh");
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="ti ti-loader-2"></i> Refreshing';
  }
  try {
    await loadInvestorDashboard();
  } finally {
    isRefreshing = false;
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="ti ti-refresh"></i> Refresh';
    }
  }
}

function initRoleMenu() {
  const menu = document.getElementById("role-menu");
  const button = document.getElementById("role-menu-button");
  if (!menu || !button) return;

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.toggle("open");
    button.setAttribute("aria-expanded", String(isOpen));
  });

  document.addEventListener("click", () => {
    menu.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      menu.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    }
  });
}

init();
