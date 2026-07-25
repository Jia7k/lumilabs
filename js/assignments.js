function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let currentUser = null;
let currentAssignments = [];
let relationshipManagers = [];
let activeAssignId = null; // portfolio id currently being assigned/changed

async function initAssignments() {
  try {
    currentUser = await API.getCurrentUser();git
  } catch (err) {
    alert("Your session has expired or is invalid. Please log in again.");
    return;
  }

  document.getElementById("user-avatar").innerText = currentUser.name[0].toUpperCase();
  document.getElementById("user-name").innerText = currentUser.name;
  document.getElementById("user-role").innerText = currentUser.role
    .replace("_", " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  document.getElementById("page-title").innerText = "Portfolio Assignments";
  document.getElementById("page-subtitle").innerText = "Assign relationship managers to approved portfolios";

  await renderAssignments();
}

async function renderAssignments() {
  try {
    [currentAssignments, relationshipManagers] = await Promise.all([
      API.getPortfolioAssignments(),
      API.getAssignableRelationshipManagers(),
    ]);
  } catch (err) {
    alert("Couldn't load assignment data: " + err.message);
    return;
  }

  document.getElementById("assignments-badge").innerText = `${currentAssignments.length} approved`;

  renderAssignmentRows();
}

function renderAssignmentRows() {
  const filter = document.getElementById("assignment-filter").value;
  const filtered = currentAssignments.filter(p => {
    if (filter === "unassigned") return p.rm_id == null;
    if (filter === "assigned") return p.rm_id != null;
    return true;
  });

  const tbody = document.getElementById("assignments-list");
  tbody.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color: var(--text-secondary); padding: 24px;">
          No portfolios match this filter
        </td>
      </tr>`;
    return;
  }

  filtered.forEach(p => {
    const isAssigned = p.rm_id != null;
    tbody.innerHTML += `
      <tr>
        <td>
          <div class="startup-cell">
            <div class="startup-icon"><i class="ti ti-building"></i></div>
            <div class="startup-name">${escapeHtml(p.name)}</div>
          </div>
        </td>
        <td>${escapeHtml(p.owner_name)}</td>
        <td>${isAssigned ? escapeHtml(p.rm_name) : "—"}</td>
        <td>
          ${isAssigned
        ? `<span class="badge-yellow" style="background:#DCFCE7;color:#166534;">Assigned</span>`
        : `<span class="badge-yellow">Awaiting Assignment</span>`}
        </td>
        <td>
          <button class="btn-review" onclick="openAssignModal(${p.id})">
            <i class="ti ti-user-cog"></i> ${isAssigned ? "Change" : "Assign"}
          </button>
        </td>
      </tr>
    `;
  });
}

function openAssignModal(portfolioId) {
  activeAssignId = portfolioId;
  const portfolio = currentAssignments.find(p => p.id === portfolioId);
  const isAssigned = portfolio && portfolio.rm_id != null;

  document.getElementById("assign-modal-title").innerText =
    isAssigned ? "Change Relationship Manager" : "Assign Relationship Manager";
  document.getElementById("assign-modal-subtitle").innerText =
    `Choose a relationship manager for "${portfolio ? portfolio.name : "this portfolio"}".`;

  const select = document.getElementById("assign-rm-select");
  select.innerHTML =
    `<option value="" disabled ${isAssigned ? "" : "selected"}>Select a relationship manager</option>` +
    relationshipManagers
      .map(rm => `<option value="${rm.id}">${escapeHtml(rm.name)} (${escapeHtml(rm.email)})</option>`)
      .join("");

  if (isAssigned) select.value = portfolio.rm_id;

  document.getElementById("assign-overlay").classList.add("open");
}

function closeAssignModal() {
  activeAssignId = null;
  document.getElementById("assign-overlay").classList.remove("open");
}

document.getElementById("assign-cancel-btn").addEventListener("click", closeAssignModal);

document.getElementById("assign-overlay").addEventListener("click", (e) => {
  if (e.target.id === "assign-overlay") closeAssignModal();
});

document.getElementById("assignment-filter").addEventListener("change", renderAssignmentRows);

document.getElementById("assign-confirm-btn").addEventListener("click", () => {
  if (activeAssignId === null) return;
  const rmId = document.getElementById("assign-rm-select").value;
  if (!rmId) {
    alert("Please select a relationship manager.");
    return;
  }

  const rm = relationshipManagers.find(r => r.id == rmId);
  const portfolio = currentAssignments.find(p => p.id === activeAssignId);
  document.getElementById("confirm-assign-text").innerText =
    `Assign ${rm ? rm.name : "this relationship manager"} to "${portfolio ? portfolio.name : "this portfolio"}"?`;

  document.getElementById("confirm-assign-overlay").classList.add("open");
});

document.getElementById("confirm-assign-cancel-btn").addEventListener("click", () => {
  document.getElementById("confirm-assign-overlay").classList.remove("open");
});

document.getElementById("confirm-assign-overlay").addEventListener("click", (e) => {
  if (e.target.id === "confirm-assign-overlay") {
    document.getElementById("confirm-assign-overlay").classList.remove("open");
  }
});

document.getElementById("confirm-assign-confirm-btn").addEventListener("click", async () => {
  const rmId = document.getElementById("assign-rm-select").value;
  try {
    await API.assignPortfolioRM(activeAssignId, rmId);
    document.getElementById("confirm-assign-overlay").classList.remove("open");
    closeAssignModal();
    await renderAssignments();
  } catch (err) {
    document.getElementById("confirm-assign-overlay").classList.remove("open");
    alert("Couldn't save assignment: " + err.message);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("confirm-assign-overlay").classList.contains("open")) {
    document.getElementById("confirm-assign-overlay").classList.remove("open");
  } else if (document.getElementById("assign-overlay").classList.contains("open")) {
    closeAssignModal();
  }
});

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
initAssignments();