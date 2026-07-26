function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const superadminDashboardState = {
  currentUser: null,
  statsLoading: false,
  staffLoading: false,
  auditLoading: false,
  statsPromise: null,
  staffPromise: null,
  auditPromise: null,
  statsQueuedPromise: null,
  staffQueuedPromise: null,
  auditQueuedPromise: null,
  auditQueuedPage: null,
  staffSubmitting: false,
  auditPage: 1,
  auditTotalPages: 1,
  auditLimit: 50,
  auditRequestedPage: 1,
  auditFailedPage: null,
};

function setText(id, value) {
  document.getElementById(id).textContent = String(value ?? "");
}

function setSectionRecovery(section, message = "") {
  const status = document.getElementById(`${section}-status`);
  const retry = document.getElementById(`${section}-retry`);
  status.textContent = message;
  status.classList.toggle("error", Boolean(message));
  retry.hidden = !message;
}

function formatRole(role) {
  return String(role || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function renderCurrentSuperadmin(user) {
  const name = String(user.name || "Superadmin");
  setText("user-avatar", name.charAt(0).toUpperCase());
  setText("user-name", name);
  setText("user-role", formatRole(user.role));
}

function workloadRow(manager) {
  return `
    <tr>
      <td>
        <div class="startup-cell">
          <span class="startup-icon" aria-hidden="true"><i class="ti ti-user"></i></span>
          <span class="startup-name">${escapeHtml(manager.name)}</span>
        </div>
      </td>
      <td>${escapeHtml(manager.email)}</td>
      <td><strong>${Number(manager.assigned_portfolios) || 0}</strong></td>
      <td>${Number(manager.active_rooms) || 0}</td>
    </tr>`;
}

function renderStatsAndWorkload(stats) {
  const metrics = {
    "stat-business-owners": stats.business_owners,
    "stat-investors": stats.investors,
    "stat-admins": stats.admins,
    "stat-relationship-managers": stats.relationship_managers,
    "stat-approved-portfolios": stats.approved_portfolios,
    "stat-assigned-portfolios": stats.assigned_portfolios,
    "stat-unassigned-portfolios": stats.unassigned_portfolios,
  };
  for (const [id, value] of Object.entries(metrics)) {
    setText(id, Number(value) || 0);
  }

  const workload = Array.isArray(stats.rm_workload) ? stats.rm_workload : [];
  document.getElementById("manager-workload-body").innerHTML = workload.length
    ? workload.map(workloadRow).join("")
    : `
      <tr class="superadmin-empty-row">
        <td colspan="4">No relationship managers have been created yet.</td>
      </tr>`;
}

function loadStatsAndWorkload({ force = false } = {}) {
  if (superadminDashboardState.statsPromise) {
    if (!force) return superadminDashboardState.statsPromise;
    if (!superadminDashboardState.statsQueuedPromise) {
      superadminDashboardState.statsQueuedPromise =
        superadminDashboardState.statsPromise.then(() => {
          superadminDashboardState.statsQueuedPromise = null;
          return loadStatsAndWorkload();
        });
    }
    return superadminDashboardState.statsQueuedPromise;
  }

  superadminDashboardState.statsLoading = true;
  const request = (async () => {
    setSectionRecovery("stats");
    setText("stats-status", "Loading platform overview…");
    try {
      const stats = await API.getSuperadminStats();
      renderStatsAndWorkload(stats || {});
      setText("stats-status", "");
    } catch (error) {
      setSectionRecovery(
        "stats",
        error.message || "Platform overview could not be loaded.",
      );
    }
  })();
  superadminDashboardState.statsPromise = request;
  request.finally(() => {
    if (superadminDashboardState.statsPromise === request) {
      superadminDashboardState.statsPromise = null;
      superadminDashboardState.statsLoading = false;
    }
  });
  return request;
}

function staffRow(staff) {
  return `
    <tr>
      <td>
        <strong>${escapeHtml(staff.name)}</strong>
        <span class="table-secondary">${escapeHtml(staff.email)}</span>
      </td>
      <td><span class="staff-role-badge">${escapeHtml(formatRole(staff.role))}</span></td>
      <td>${escapeHtml(formatDate(staff.created_at))}</td>
    </tr>`;
}

function renderStaffDirectory(staff) {
  const rows = Array.isArray(staff) ? staff : [];
  document.getElementById("staff-directory-body").innerHTML = rows.length
    ? rows.map(staffRow).join("")
    : `
      <tr class="superadmin-empty-row">
        <td colspan="3">No admin or relationship manager accounts yet.</td>
      </tr>`;
}

function loadStaffDirectory({ force = false } = {}) {
  if (superadminDashboardState.staffPromise) {
    if (!force) return superadminDashboardState.staffPromise;
    if (!superadminDashboardState.staffQueuedPromise) {
      superadminDashboardState.staffQueuedPromise =
        superadminDashboardState.staffPromise.then(() => {
          superadminDashboardState.staffQueuedPromise = null;
          return loadStaffDirectory();
        });
    }
    return superadminDashboardState.staffQueuedPromise;
  }

  superadminDashboardState.staffLoading = true;
  const request = (async () => {
    setSectionRecovery("staff");
    setText("staff-status", "Loading staff directory…");
    try {
      const staff = await API.getStaff();
      renderStaffDirectory(staff);
      setText("staff-status", "");
    } catch (error) {
      setSectionRecovery(
        "staff",
        error.message || "Staff directory could not be loaded.",
      );
    }
  })();
  superadminDashboardState.staffPromise = request;
  request.finally(() => {
    if (superadminDashboardState.staffPromise === request) {
      superadminDashboardState.staffPromise = null;
      superadminDashboardState.staffLoading = false;
    }
  });
  return request;
}

function auditActionLabel(action) {
  const labels = {
    portfolio_assigned: "Portfolio assigned",
    portfolio_reassigned: "Portfolio reassigned",
    portfolio_unassigned: "Portfolio unassigned",
    admin_account_created: "Admin account created",
    relationship_manager_account_created: "Relationship manager created",
  };
  return labels[action] || formatRole(action);
}

function auditSubject(log) {
  if (log.portfolio_name_snapshot) {
    const manager = log.new_relationship_manager_name_snapshot
      || log.previous_relationship_manager_name_snapshot;
    return manager
      ? `${log.portfolio_name_snapshot} · ${manager}`
      : log.portfolio_name_snapshot;
  }
  if (log.created_user_name_snapshot) {
    return `${log.created_user_name_snapshot} · ${formatRole(log.created_user_role)}`;
  }
  return "—";
}

function auditRow(log) {
  return `
    <tr>
      <td>${escapeHtml(formatDate(log.created_at))}</td>
      <td><strong>${escapeHtml(auditActionLabel(log.action))}</strong></td>
      <td>${escapeHtml(log.superadmin_name_snapshot || "Unknown superadmin")}</td>
      <td>${escapeHtml(auditSubject(log))}</td>
      <td><span class="audit-reference">#${escapeHtml(log.id)}</span></td>
    </tr>`;
}

function renderAuditPage(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const pagination = payload.pagination || {};
  const page = Number(pagination.page);
  const totalPages = Number(pagination.total_pages);
  superadminDashboardState.auditPage =
    Number.isSafeInteger(page) && page > 0 ? page : 1;
  superadminDashboardState.auditTotalPages =
    Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : 1;

  document.getElementById("audit-body").innerHTML = items.length
    ? items.map(auditRow).join("")
    : `
      <tr class="superadmin-empty-row">
        <td colspan="5">No superadmin activity has been recorded yet.</td>
      </tr>`;
  setText(
    "audit-page",
    `Page ${superadminDashboardState.auditPage} of ${superadminDashboardState.auditTotalPages}`,
  );
  document.getElementById("audit-previous").disabled =
    superadminDashboardState.auditPage <= 1;
  document.getElementById("audit-next").disabled =
    superadminDashboardState.auditPage >= superadminDashboardState.auditTotalPages;
}

function loadAuditPage(
  page = superadminDashboardState.auditPage,
  { force = false } = {},
) {
  const normalizedPage = Number(page);
  if (!Number.isSafeInteger(normalizedPage) || normalizedPage <= 0) return;
  if (superadminDashboardState.auditPromise) {
    if (!force) return superadminDashboardState.auditPromise;
    superadminDashboardState.auditQueuedPage = normalizedPage;
    if (!superadminDashboardState.auditQueuedPromise) {
      superadminDashboardState.auditQueuedPromise =
        superadminDashboardState.auditPromise.then(() => {
          const queuedPage = superadminDashboardState.auditQueuedPage;
          superadminDashboardState.auditQueuedPage = null;
          superadminDashboardState.auditQueuedPromise = null;
          return loadAuditPage(queuedPage);
        });
    }
    return superadminDashboardState.auditQueuedPromise;
  }

  superadminDashboardState.auditLoading = true;
  superadminDashboardState.auditRequestedPage = normalizedPage;
  const request = (async () => {
    setSectionRecovery("audit");
    setText("audit-status", "Loading audit history…");
    document.getElementById("audit-previous").disabled = true;
    document.getElementById("audit-next").disabled = true;
    try {
      const payload = await API.getSuperadminAuditLogs(
        normalizedPage,
        superadminDashboardState.auditLimit,
      );
      renderAuditPage(payload || {});
      superadminDashboardState.auditFailedPage = null;
      setText("audit-status", "");
    } catch (error) {
      superadminDashboardState.auditFailedPage = normalizedPage;
      setSectionRecovery(
        "audit",
        error.message || "Audit history could not be loaded.",
      );
    }
  })();
  superadminDashboardState.auditPromise = request;
  request.finally(() => {
    if (superadminDashboardState.auditPromise === request) {
      superadminDashboardState.auditPromise = null;
      superadminDashboardState.auditLoading = false;
    }
  });
  return request;
}

function clearStaffErrors() {
  for (const field of ["name", "email", "password", "role"]) {
    setText(`staff-${field}-error`, "");
    document.getElementById(`staff-${field}`).removeAttribute("aria-invalid");
  }
  setText("staff-form-status", "");
  document.getElementById("staff-form-status").classList.remove("error", "success");
}

function setStaffFieldError(field, message) {
  setText(`staff-${field}-error`, message);
  document.getElementById(`staff-${field}`).setAttribute("aria-invalid", "true");
}

function validateStaffInput() {
  clearStaffErrors();
  const fields = {
    name: document.getElementById("staff-name"),
    email: document.getElementById("staff-email"),
    password: document.getElementById("staff-password"),
    role: document.getElementById("staff-role"),
  };
  const payload = {
    name: fields.name.value.trim(),
    email: fields.email.value.trim().toLowerCase(),
    password: fields.password.value,
    role: fields.role.value,
  };
  let valid = true;
  if (payload.name.length < 1 || payload.name.length > 100) {
    setStaffFieldError("name", "Enter a name between 1 and 100 characters.");
    valid = false;
  }
  if (
    payload.email.length > 255
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
  ) {
    setStaffFieldError("email", "Enter a valid email up to 255 characters.");
    valid = false;
  }
  if (payload.password.length < 6 || payload.password.length > 128) {
    setStaffFieldError("password", "Use a password between 6 and 128 characters.");
    valid = false;
  }
  if (!["admin", "relationship_manager"].includes(payload.role)) {
    setStaffFieldError("role", "Choose Admin or Relationship manager.");
    valid = false;
  }
  return valid ? payload : null;
}

async function submitStaffAccount(event) {
  event?.preventDefault();
  if (superadminDashboardState.staffSubmitting) return;
  const payload = validateStaffInput();
  if (!payload) return;

  const submit = document.getElementById("staff-submit");
  const status = document.getElementById("staff-form-status");
  superadminDashboardState.staffSubmitting = true;
  submit.disabled = true;
  status.classList.remove("error", "success");
  status.textContent = "Creating staff account…";
  try {
    await API.createStaff(payload);
    document.getElementById("staff-password").value = "";
    status.classList.add("success");
    status.textContent = `${formatRole(payload.role)} account created. Share the temporary password securely.`;
    await Promise.allSettled([
      loadStatsAndWorkload({ force: true }),
      loadStaffDirectory({ force: true }),
      loadAuditPage(1, { force: true }),
    ]);
  } catch (error) {
    status.classList.add("error");
    status.textContent = error.message || "Staff account could not be created.";
  } finally {
    superadminDashboardState.staffSubmitting = false;
    submit.disabled = false;
  }
}

function initRoleMenu() {
  const menu = document.getElementById("role-menu");
  const button = document.getElementById("role-menu-button");
  if (!menu || !button) return;
  button.addEventListener("click", event => {
    event.stopPropagation();
    const open = menu.classList.toggle("open");
    button.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => {
    menu.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
  });
}

function bindSuperadminDashboardEvents() {
  document.getElementById("stats-retry").addEventListener("click", loadStatsAndWorkload);
  document.getElementById("staff-retry").addEventListener("click", loadStaffDirectory);
  document.getElementById("audit-retry").addEventListener(
    "click",
    () => loadAuditPage(
      superadminDashboardState.auditFailedPage
        || superadminDashboardState.auditRequestedPage
        || superadminDashboardState.auditPage,
    ),
  );
  document.getElementById("audit-previous").addEventListener(
    "click",
    () => loadAuditPage(superadminDashboardState.auditPage - 1),
  );
  document.getElementById("audit-next").addEventListener(
    "click",
    () => loadAuditPage(superadminDashboardState.auditPage + 1),
  );
  document.getElementById("staff-form").addEventListener("submit", submitStaffAccount);
  document.getElementById("signout-button").addEventListener("click", signOut);
}

async function initializeSuperadminDashboard() {
  const user = await requirePageRole("superadmin");
  if (!user) {
    const recovery = document.getElementById("protected-page-recovery");
    if (recovery) {
      const recoveryMain = recovery.closest("main") || document.querySelector("main");
      if (recoveryMain) recoveryMain.hidden = false;
    }
    return;
  }

  superadminDashboardState.currentUser = user;
  renderCurrentSuperadmin(user);
  document.getElementById("protected-nav").hidden = false;
  document.getElementById("superadmin-main").hidden = false;
  await Promise.allSettled([
    loadStatsAndWorkload(),
    loadStaffDirectory(),
    loadAuditPage(1),
  ]);
}

initRoleMenu();
bindSuperadminDashboardEvents();
initializeSuperadminDashboard();
