const user = JSON.parse(localStorage.getItem("lumilabsSelectedUser"));

const defaultPortfolios = [
  {
    id: 1,
    owner_id: 1,
    name: "X3",
    sector: "Fintech",
    description: "AI-powered payments platform",
    funding_goal: 1000000.00,
    readiness_score: 85,
    mvp_status: "Launched",
    status: "approved",
    rejection_reason: null,
    submitted_at: "2025-05-20T10:00:00Z",
    created_at: "2025-05-01T10:00:00Z",
    updated_at: "2025-07-03T10:00:00Z"
  },
  {
    id: 2,
    owner_id: 1,
    name: "Happi",
    sector: "Healthtech",
    description: "Mental wellness app",
    funding_goal: 10000000.00,
    readiness_score: 80,
    mvp_status: "Beta",
    status: "pending",
    rejection_reason: null,
    submitted_at: "2025-05-25T10:00:00Z",
    created_at: "2025-05-10T10:00:00Z",
    updated_at: "2025-06-25T10:00:00Z"
  },
  {
    id: 3,
    owner_id: 1,
    name: "Fint",
    sector: "Fintech",
    description: "SME lending platform",
    funding_goal: 500000.00,
    readiness_score: 45,
    mvp_status: "Prototype",
    status: "rejected",
    rejection_reason: "Needs stronger market validation",
    submitted_at: "2025-06-01T10:00:00Z",
    created_at: "2025-05-15T10:00:00Z",
    updated_at: "2025-06-18T10:00:00Z"
  }
];

// LOCALSTORAGE (need to swap these two functions for real API calls later)
function getPortfolios() {
  const stored = localStorage.getItem("portfolios");
  if (stored) return JSON.parse(stored);
  localStorage.setItem("portfolios", JSON.stringify(defaultPortfolios));
  return defaultPortfolios;
}

function savePortfolios(portfolios) {
  localStorage.setItem("portfolios", JSON.stringify(portfolios));
}

const statusLabel = {
  draft: "Draft",
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected"
};

function formatFunding(n) {
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(0) + "K";
  return "$" + n;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function render() {
  document.getElementById("user-avatar").innerText = user.name[0];
  document.getElementById("user-name").innerText = user.name;
  document.getElementById("user-role").innerText = user.role.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());

  const portfolios = getPortfolios();

  if (portfolios.length === 0) {
    document.getElementById("biz-list").innerHTML = `
      <div class="card" style="text-align:center; padding:48px; color:var(--text-secondary);">
        <i class="ti ti-building-store" style="font-size:40px; margin-bottom:12px; display:block;"></i>
        No portfolios yet. Create your first one!
      </div>`;
    return;
  }

  const html = portfolios.map(p => `
    <div class="card" style="margin-bottom:16px;">
      <div class="biz-card">
        <div style="flex:1;">
          <div class="biz-title">${p.name}</div>

          <div class="biz-meta" style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">
            ${p.sector}
            <span style="color:var(--text-muted);">&middot;</span>
            <span class="badge ${p.status}">${statusLabel[p.status]}</span>
          </div>

          <div class="biz-info-grid">
            <div class="biz-info-box">
              <div class="biz-info-label">MVP Status</div>
              <div class="biz-info-value">${p.mvp_status || "—"}</div>
            </div>
            <div class="biz-info-box">
              <div class="biz-info-label">Funding Goal</div>
              <div class="biz-info-value">${formatFunding(p.funding_goal)}</div>
            </div>
            <div class="biz-info-box">
              <div class="biz-info-label">Readiness</div>
              <div class="biz-info-value">${p.readiness_score}/100</div>
            </div>
            <div class="biz-info-box">
              <div class="biz-info-label">Last Updated</div>
              <div class="biz-info-value">${formatDate(p.updated_at)}</div>
            </div>
          </div>

          ${p.rejection_reason ? `
            <div class="biz-rejection">
              Rejection Reason: ${p.rejection_reason}
            </div>` : ""}
        </div>

        <div class="biz-actions">
  <button class="btn btn-outline" onclick="window.location.href='createportfolio.html?id=${p.id}'">
    <i class="ti ti-edit"></i> Edit
  </button>
  <button class="btn-text-danger" onclick="deletePortfolio(${p.id})">
    <i class="ti ti-trash"></i> Delete
  </button>
</div>
      </div>
    </div>
  `).join("");

  document.getElementById("biz-list").innerHTML = html;
}

function deletePortfolio(id) {
  if (!confirm("Are you sure you want to delete this portfolio? This action cannot be undone.")) return;
  const updated = getPortfolios().filter(p => p.id !== id);
  savePortfolios(updated);
  render();
}

render();