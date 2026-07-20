const API_BASE = "http://localhost:3000/api";

function showScoreInfo() {
  let overlay = document.getElementById("score-info-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "score-info-overlay";
    Object.assign(overlay.style, {
      display: "none", position: "fixed", inset: "0",
      background: "rgba(0,0,0,0.45)", zIndex: "9999",
      alignItems: "center", justifyContent: "center", padding: "16px"
    });
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:14px;width:100%;max-width:560px;padding:28px 32px 24px;
                  box-shadow:0 20px 60px rgba(0,0,0,0.2);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <h3 style="font-size:17px;font-weight:700;margin:0;">How is the Readiness Score calculated?</h3>
          <button onclick="closeScoreInfo()" style="background:none;border:none;cursor:pointer;font-size:20px;color:#6B7280;padding:4px;line-height:1;">✕</button>
        </div>
        <p style="font-size:13px;color:#6B7280;margin:0 0 16px;">The score (0–100) measures how investment-ready a startup is across 5 dimensions:</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
          <thead>
            <tr style="background:#F9FAFB;">
              <th style="text-align:left;padding:8px 10px;color:#6B7280;font-weight:600;border-bottom:1px solid #E5E7EB;">Dimension</th>
              <th style="text-align:left;padding:8px 10px;color:#6B7280;font-weight:600;border-bottom:1px solid #E5E7EB;">Max</th>
              <th style="text-align:left;padding:8px 10px;color:#6B7280;font-weight:600;border-bottom:1px solid #E5E7EB;">What earns points</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style="padding:10px;border-bottom:1px solid #F3F4F6;"><strong>Team</strong></td><td style="padding:10px;border-bottom:1px solid #F3F4F6;font-weight:700;color:#52A475;">25</td><td style="padding:10px;border-bottom:1px solid #F3F4F6;">Team size ≥1 (+8), ≥3 (+5), advisors listed (+7), founded year (+5)</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #F3F4F6;"><strong>Traction</strong></td><td style="padding:10px;border-bottom:1px solid #F3F4F6;font-weight:700;color:#52A475;">25</td><td style="padding:10px;border-bottom:1px solid #F3F4F6;">Monthly revenue &gt;0 (+12), users &gt;0 (+8), growth rate &gt;0 (+5)</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #F3F4F6;"><strong>Market</strong></td><td style="padding:10px;border-bottom:1px solid #F3F4F6;font-weight:700;color:#52A475;">20</td><td style="padding:10px;border-bottom:1px solid #F3F4F6;">Market size filled (+8), competitor analysis filled (+7), description &gt;50 chars (+5)</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #F3F4F6;"><strong>Product</strong></td><td style="padding:10px;border-bottom:1px solid #F3F4F6;font-weight:700;color:#52A475;">15</td><td style="padding:10px;border-bottom:1px solid #F3F4F6;">Idea (3pts), Prototype (7pts), Beta (11pts), Launched (15pts)</td></tr>
            <tr><td style="padding:10px;"><strong>Financials</strong></td><td style="padding:10px;font-weight:700;color:#52A475;">15</td><td style="padding:10px;">Funding goal (+5), burn rate filled (+5), runway months filled (+5)</td></tr>
          </tbody>
        </table>
        <p style="font-size:11px;color:#9CA3AF;font-style:italic;margin:0;">Inspired by the Village Capital Milestone Grid and SICouncil Investment Matrix frameworks.</p>
      </div>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeScoreInfo(); });
    document.body.appendChild(overlay);
  }
  overlay.style.display = "flex";
}

function closeScoreInfo() {
  const overlay = document.getElementById("score-info-overlay");
  if (overlay) overlay.style.display = "none";
}


function getToken() {
  return localStorage.getItem("lumilabsToken");
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getToken()}`,
      ...(options.headers || {})
    }
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Ignore JSON parse errors (e.g., empty response)
  }

  if (!res.ok) {
    const message =
      data?.error ||
      data?.errors?.[0]?.msg ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }

  return data;
}

const API = {
  // Auth
  getCurrentUser: () => apiFetch("/auth/me"),

  // Business owner portfolios
  getMyPortfolios: () => apiFetch("/portfolios/my"),
  getPortfolio: (id) => apiFetch(`/portfolios/${id}`),
  createPortfolio: (payload) =>
    apiFetch("/portfolios", { method: "POST", body: JSON.stringify(payload) }),
  updatePortfolio: (id, payload) =>
    apiFetch(`/portfolios/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  submitPortfolio: (id) =>
    apiFetch(`/portfolios/${id}/submit`, { method: "POST" }),
  deletePortfolio: (id) =>
    apiFetch(`/portfolios/${id}`, { method: "DELETE" }),

  // Admin
  getQueue: () => apiFetch("/admin/queue"),
  approvePortfolio: (id, notes = null) =>
    apiFetch(`/admin/portfolios/${id}/approve`, {
      method: "PUT",
      body: JSON.stringify({ notes })
    }),
  rejectPortfolio: (id, reason) =>
    apiFetch(`/admin/portfolios/${id}/reject`, {
      method: "PUT",
      body: JSON.stringify({ reason })
    }),
  getAuditLogs: () => apiFetch("/admin/audit-logs"),
  getStats: () => apiFetch("/admin/stats"),

  // Business owner dashboard
  getBusinessOwnerDashboard: () => apiFetch("/dashboard/business-owner"),

  // Investor
  getInvestorDashboard: () => apiFetch("/dashboard/investor"),
  getRecommendations: () => apiFetch("/recommendations"),
  getAllPortfolios: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null))
    ).toString();
    return apiFetch(`/portfolios${qs ? "?" + qs : ""}`);
  },
  expressInterest: (portfolioId) =>
    apiFetch(`/interests/${portfolioId}`, { method: "POST" }),
  removeInterest: (portfolioId) =>
    apiFetch(`/interests/${portfolioId}`, { method: "DELETE" }),
  getMyInterests: () => apiFetch("/interests/my"),
};