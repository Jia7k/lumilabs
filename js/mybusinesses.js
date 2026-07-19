const statusLabel = {
  draft: "Draft",
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatFunding(n) {
  n = Number(n);

  if (Number.isNaN(n)) return "—";
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(0) + "K";
  return "$" + n;
}

function formatDate(iso) {
  if (!iso) return "—";

  const date = new Date(iso);
  if (isNaN(date)) return "—";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

async function init() {
  let user;
  try {
    user = await API.getCurrentUser();
  } catch (err) {
    alert("Your session has expired or is invalid. Please log in again.");
    return;
  }

  document.getElementById("user-avatar").innerText = user.name[0];
  document.getElementById("user-name").innerText = user.name;
  document.getElementById("user-role").innerText = user.role
    .replace("_", " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  await render();
}

async function render() {
  let portfolios;
  try {
    portfolios = await API.getMyPortfolios();
  } catch (err) {
    document.getElementById("biz-list").innerHTML = `
      <div class="card" style="text-align:center; padding:48px; color:var(--text-secondary);">
        Couldn't load your portfolios: ${err.message}
      </div>`;
    return;
  }

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
          <div class="biz-title">${escapeHtml(p.name)}</div>

          <div class="biz-meta" style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">
            ${escapeHtml(p.sector)}
            <span style="color:var(--text-muted);">&middot;</span>
            <span class="badge ${p.status}">${statusLabel[p.status]}</span>
          </div>

          <div class="biz-info-grid">
            <div class="biz-info-box">
              <div class="biz-info-label">MVP Status</div>
              <div class="biz-info-value">${escapeHtml(p.mvp_status || "—")}</div>
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

          ${p.status === "rejected" && p.rejection_reason ? `
            <div class="biz-rejection">
              Rejection Reason: ${escapeHtml(p.rejection_reason)}
            </div>
          ` : ""}
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

async function deletePortfolio(id) {
  if (!confirm("Are you sure you want to delete this portfolio? This action cannot be undone.")) return;
  try {
    await API.deletePortfolio(id);
    await render();
  } catch (err) {
    alert("Couldn't delete portfolio: " + err.message);
  }
}

init();