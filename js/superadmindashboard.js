function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let currentUser = null;

async function initSuperadmin() {
  try {
    currentUser = await API.getCurrentUser();
  } catch (err) {
    alert("Your session has expired or is invalid. Please log in again.");
    return;
  }

  document.getElementById("user-avatar").innerText = currentUser.name[0].toUpperCase();
  document.getElementById("user-name").innerText = currentUser.name;
  document.getElementById("user-role").innerText = currentUser.role
    .replace("_", " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  document.getElementById("page-title").innerText = "Superadmin Dashboard";
  document.getElementById("page-subtitle").innerText = "Platform overview and relationship manager workload";

  await renderSuperadmin();
}

async function renderSuperadmin() {
  let stats;
  try {
    stats = await API.getSuperAdminStats();
  } catch (err) {
    alert("Couldn't load dashboard data: " + err.message);
    return;
  }

  document.getElementById("stat-business-owners").innerText = stats.business_owners;
  document.getElementById("stat-investors").innerText = stats.investors;
  document.getElementById("stat-admins").innerText = stats.admins;
  document.getElementById("stat-relationship-managers").innerText = stats.relationship_managers;

  const tbody = document.getElementById("workload-list");
  tbody.innerHTML = "";

  const workload = stats.rm_workload || [];

  if (workload.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align:center; color: var(--text-secondary); padding: 24px;">
          No relationship managers yet
        </td>
      </tr>`;
    return;
  }

  const maxCount = Math.max(...workload.map(rm => rm.portfolio_count), 1);

  workload.forEach(rm => {
    const pct = Math.round((rm.portfolio_count / maxCount) * 100);
    tbody.innerHTML += `
      <tr>
        <td>
          <div class="startup-cell">
            <div class="startup-icon"><i class="ti ti-user"></i></div>
            <div class="startup-name">${escapeHtml(rm.name)}</div>
          </div>
        </td>
        <td>${escapeHtml(rm.email)}</td>
        <td>${rm.portfolio_count}</td>
      </tr>
    `;
  });
}

function initRoleMenu() {
  const menu = document.getElementById("role-menu");
  const button = document.getElementById("role-menu-button");
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", () => menu.classList.remove("open"));
}

initRoleMenu();
initSuperadmin();