const API_BASE = "http://localhost:3000/api";

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