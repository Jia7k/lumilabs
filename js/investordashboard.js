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

async function init() {
  const user = await requirePageRole("investor");
  if (!user) return;

  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;
  document.getElementById("user-role").innerText = "Investor";
  document.getElementById("page-title").innerText = `Welcome back, ${user.name}`;
  document.getElementById("page-subtitle").innerText = "Discover promising startups and investment opportunities";

  const [dash, recs] = await Promise.allSettled([
    API.getInvestorDashboard(),
    API.getRecommendations(),
  ]);

  if (dash.status === "fulfilled") {
    const s = dash.value.stats;
    document.getElementById("stat-available").innerText = s.available;
    document.getElementById("stat-interests").innerText = s.interests;
    document.getElementById("stat-messages").innerText = s.messages;
    document.getElementById("stat-potential").innerText = s.highPotential;

    const riList = document.getElementById("recent-interests-list");
    if (!dash.value.recentInterests.length) {
      riList.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No interests yet.</p>`;
    } else {
      riList.innerHTML = dash.value.recentInterests.map(i => `
        <div class="interest-list-item">
          <div class="il-icon"><i class="ti ti-heart"></i></div>
          <div>
            <div class="il-name">${escapeHtml(i.name)}</div>
            <div class="il-sub">${escapeHtml(i.sector)}</div>
          </div>
        </div>
      `).join("");
    }
  }

  if (recs.status === "fulfilled") {
    const recList = document.getElementById("recommended-list");
    const top = recs.value.slice(0, 5);
    if (!top.length) {
      recList.innerHTML = `<p style="padding:20px;color:var(--text-muted);">No approved startups yet.</p>`;
    } else {
      recList.innerHTML = top.map((p, i) => `
        <div class="rec-item" style="cursor:pointer;" onclick="window.location.href='browse.html'">
          <div class="rec-rank">#${i + 1}</div>
          <div class="rec-info">
            <div class="rec-name-row">
              <span class="rec-name">${escapeHtml(p.name)}</span>
              ${p.is_high_potential ? `<span class="badge-purple"><i class="ti ti-star"></i> High Potential</span>` : ""}
            </div>
            <div class="rec-industry">${escapeHtml(p.sector)}</div>
          </div>
          <div class="score-text">${p.ai_score}</div>
          <i class="ti ti-arrow-right rec-arrow"></i>
        </div>
      `).join("");
    }

    const recent = [...recs.value]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 4);
    const recentGrid = document.getElementById("recently-added-grid");
    if (!recent.length) {
      recentGrid.innerHTML = `<p style="color:var(--text-muted);">No startups yet.</p>`;
    } else {
      recentGrid.innerHTML = recent.map(p => `
        <div class="recent-card" style="cursor:pointer;" onclick="window.location.href='browse.html'">
          <div class="rc-top">
            <div class="rc-icon"><i class="ti ti-briefcase"></i></div>
            <div class="rc-star" style="background:${p.readiness_score >= 75 ? "var(--purple-light)" : "var(--bg-page)"}; color:${p.readiness_score >= 75 ? "var(--purple-text)" : "var(--text-muted)"}"><i class="ti ti-star"></i></div>
          </div>
          <div>
            <div class="rc-name">${escapeHtml(p.name)}</div>
            <div class="rc-industry">${escapeHtml(p.sector)}</div>
          </div>
          <div class="rc-bottom">
            <div class="rc-money">${formatFunding(p.funding_goal)}</div>
            <div class="rc-score" style="color:${p.readiness_score >= 70 ? "var(--primary-green)" : "#D98F39"}; background:${p.readiness_score >= 70 ? "rgba(82,164,117,0.1)" : "rgba(217,143,57,0.1)"}">${p.readiness_score}</div>
          </div>
        </div>
      `).join("");
    }

    const interestCount = dash.status === "fulfilled" ? dash.value.stats.interests : 0;
    document.getElementById("quick-actions-list").innerHTML = `
      <button class="quick-action-btn" onclick="window.location.href='browse.html'">
        <div class="qa-left"><i class="ti ti-search"></i> Browse Startups</div>
        <i class="ti ti-chevron-right" style="color:var(--text-muted)"></i>
      </button>
      <button class="quick-action-btn" onclick="window.location.href='my-interests.html'">
        <div class="qa-left"><i class="ti ti-heart"></i> My Interests</div>
        ${interestCount > 0 ? `<span class="badge-red">${interestCount}</span>` : ""}
      </button>
      <button class="quick-action-btn" onclick="window.location.href='messages.html'">
        <div class="qa-left"><i class="ti ti-message"></i> Messages</div>
      </button>
    `;
  }

  if (!roleMenuInitialized) {
    initRoleMenu();
    roleMenuInitialized = true;
  }
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
    await init();
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
