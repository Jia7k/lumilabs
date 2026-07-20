function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str ?? "";
  return div.innerHTML;
}

const actionBadge = {
  approved: { label: "Approved", className: "badge-green" },
  rejected: { label: "Rejected", className: "badge-red" }
};

function formatTimestamp(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  };
}

async function initAuditLogs() {
  let user;
  try {
    user = await API.getCurrentUser();
  } catch (err) {
    alert("Your session has expired or is invalid. Please log in again.");
    return;
  }

  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;
  document.getElementById("user-role").innerText = user.role
    .replace("_", " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  await renderAuditLogs();
}

async function renderAuditLogs() {
  let logs;
  try {
    logs = await API.getAuditLogs();
  } catch (err) {
    alert("Couldn't load audit logs: " + err.message);
    return;
  }

  const approvedCount = logs.filter(l => l.action === "approved").length;
  const rejectedCount = logs.filter(l => l.action === "rejected").length;

  document.getElementById("stat-total").innerText = logs.length;
  document.getElementById("stat-approved").innerText = approvedCount;
  document.getElementById("stat-rejected").innerText = rejectedCount;

  const tbody = document.getElementById("audit-tbody");
  tbody.innerHTML = logs.map(log => {
    const ts = formatTimestamp(log.created_at);
    const badge = actionBadge[log.action] || { label: log.action, className: "badge-yellow" };
    const initial = (log.admin_name || "?")[0].toUpperCase();

    return `
      <tr>
        <td>
          <div>
            <div style="font-weight:600;">${ts.date}</div>
            <div style="font-size:12px;color:#6B7280;">${ts.time}</div>
          </div>
        </td>

        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:32px;height:32px;border-radius:50%;background:#8B5CF6;color:white;display:flex;align-items:center;justify-content:center;font-weight:600;">
              ${escapeHtml(initial)}
            </div>
            ${escapeHtml(log.admin_name)}
          </div>
        </td>

        <td>
          <span class="${badge.className}">
            ${badge.label}
          </span>
        </td>

        <td style="font-weight:600;">${escapeHtml(log.portfolio_name)}</td>

        <td style="color:#6B7280;font-size:13px;">
          ${log.reason ? escapeHtml(log.reason) : "-"}
        </td>
      </tr>
    `;
  }).join("");

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; padding:32px; color:#6B7280;">
          No moderation actions yet.
        </td>
      </tr>
    `;
  }
}

initAuditLogs();