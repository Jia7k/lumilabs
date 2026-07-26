function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const assignmentState = {
  items: [],
  managers: [],
  loading: false,
  mutatingPortfolioId: null,
  dialogPortfolioId: null,
  unassignPortfolioId: null,
  dialogInvoker: null,
  unassignInvoker: null,
  pendingFocus: null,
};

function positiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function setAssignmentStatus(message = "", isError = false) {
  const status = document.getElementById("assignment-status");
  status.textContent = message;
  status.classList.toggle("error", Boolean(isError));
}

function formatRole(role) {
  return String(role || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

function statusBadge(status) {
  const normalized = String(status || "unknown").toLowerCase();
  const label = formatRole(normalized);
  const className = {
    approved: "badge-green",
    rejected: "badge-red",
    needs_changes: "badge-yellow",
    pending: "badge-yellow",
  }[normalized] || "badge-yellow";
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

function chatSummary(conversation) {
  if (!conversation) {
    return `<span class="assignment-chat-state muted">
      <i class="ti ti-message-off" aria-hidden="true"></i> Not created
    </span>`;
  }
  const active = conversation.status === "active";
  return `<span class="assignment-chat-state ${active ? "active" : "archived"}">
    <i class="ti ${active ? "ti-messages" : "ti-archive"}" aria-hidden="true"></i>
    ${active ? "Active" : "Archived"}
  </span>`;
}

function disabledActionReason(reason, fallback) {
  return `<p class="action-disabled-reason">${escapeHtml(reason || fallback)}</p>`;
}

function assignmentActions(portfolio) {
  const assigned = Boolean(portfolio.relationship_manager);
  const actions = portfolio.actions || {};
  const busy = assignmentState.mutatingPortfolioId !== null;
  const primaryAction = assigned ? "reassign" : "assign";
  const canPrimary = assigned ? actions.can_reassign : actions.can_assign;
  const primaryReason = assigned
    ? actions.reassign_disabled_reason
    : actions.assign_disabled_reason;
  const primaryLabel = assigned ? "Reassign" : "Assign";
  const primaryDisabled = busy || !canPrimary;
  const primaryDisabledReason = busy
    ? assignmentState.mutatingPortfolioId === portfolio.id
      ? "Saving this portfolio assignment…"
      : "Another portfolio assignment is being saved…"
    : primaryReason;

  let html = `
    <div class="assignment-action-group">
      <button
        class="btn btn-primary assignment-action"
        type="button"
        data-assignment-action="${primaryAction}"
        data-portfolio-id="${portfolio.id}"
        ${primaryDisabled ? "disabled" : ""}
      >
        <i class="ti ti-user-cog" aria-hidden="true"></i> ${primaryLabel}
      </button>
      ${primaryDisabled
    ? disabledActionReason(
      primaryDisabledReason,
      "This portfolio is not currently eligible for assignment.",
    )
    : ""}
    </div>`;

  if (assigned) {
    const canUnassign = Boolean(actions.can_unassign);
    const unassignDisabled = busy || !canUnassign;
    const unassignReason = busy
      ? assignmentState.mutatingPortfolioId === portfolio.id
        ? "Saving this portfolio assignment…"
        : "Another portfolio assignment is being saved…"
      : actions.unassign_disabled_reason;
    html += `
      <div class="assignment-action-group">
        <button
          class="btn btn-outline assignment-action"
          type="button"
          data-assignment-action="unassign"
          data-portfolio-id="${portfolio.id}"
          ${unassignDisabled ? "disabled" : ""}
        >
          <i class="ti ti-user-off" aria-hidden="true"></i> Unassign
        </button>
        ${unassignDisabled
    ? disabledActionReason(
      unassignReason,
      "This assignment cannot be removed.",
    )
    : ""}
      </div>`;
  }
  return html;
}

function assignmentRow(portfolio) {
  const manager = portfolio.relationship_manager;
  return `
    <tr data-row-portfolio-id="${portfolio.id}">
      <td>
        <div class="startup-cell">
          <span class="startup-icon" aria-hidden="true"><i class="ti ti-building"></i></span>
          <span>
            <strong class="startup-name">${escapeHtml(portfolio.name)}</strong>
            <small class="table-secondary">Portfolio #${portfolio.id}</small>
          </span>
        </div>
      </td>
      <td>${statusBadge(portfolio.status)}</td>
      <td>
        <strong>${escapeHtml(portfolio.owner?.name || "Unknown owner")}</strong>
        <span class="table-secondary">${escapeHtml(portfolio.owner?.email || "")}</span>
      </td>
      <td>
        ${manager
    ? `<strong>${escapeHtml(manager.name)}</strong>
             <span class="table-secondary">${escapeHtml(manager.email)}</span>`
    : `<span class="assignment-unassigned">Awaiting assignment</span>`}
      </td>
      <td>${chatSummary(portfolio.conversation)}</td>
      <td><div class="assignment-actions">${assignmentActions(portfolio)}</div></td>
    </tr>`;
}

function renderAssignmentRows() {
  const filter = document.getElementById("assignment-filter").value || "all";
  const filtered = assignmentState.items.filter(portfolio => {
    if (filter === "unassigned") return !portfolio.relationship_manager;
    if (filter === "assigned") return Boolean(portfolio.relationship_manager);
    return true;
  });
  const body = document.getElementById("assignment-rows");
  body.innerHTML = filtered.length
    ? filtered.map(assignmentRow).join("")
    : `
      <tr class="superadmin-empty-row">
        <td colspan="6">No portfolios match this view.</td>
      </tr>`;
  document.getElementById("assignments-badge").textContent =
    String(assignmentState.items.length);
}

function normalizeAssignments(payload) {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(item => positiveSafeInteger(item?.id) !== null)
    .map(item => ({ ...item, id: positiveSafeInteger(item.id) }));
}

function normalizeManagers(payload) {
  if (!Array.isArray(payload)) return [];
  return payload
    .filter(manager => positiveSafeInteger(manager?.id) !== null)
    .map(manager => ({ ...manager, id: positiveSafeInteger(manager.id) }));
}

function invokerDescriptor(invoker, fallbackAction, portfolioId) {
  const candidate = invoker?.closest?.("[data-assignment-action]") || invoker;
  const action = candidate?.dataset?.assignmentAction || fallbackAction;
  const normalizedId = positiveSafeInteger(
    candidate?.dataset?.portfolioId || portfolioId,
  );
  if (
    normalizedId === null
    || !["assign", "reassign", "unassign"].includes(action)
  ) return null;
  return { action, portfolioId: normalizedId };
}

function restoreActionFocus(descriptor) {
  if (!descriptor) return;
  const selector =
    `[data-assignment-action="${descriptor.action}"]`
    + `[data-portfolio-id="${descriptor.portfolioId}"]`;
  const replacement = document.querySelector(selector)
    || document.querySelector(
      `[data-portfolio-id="${descriptor.portfolioId}"]`
      + "[data-assignment-action]",
    );
  const fallback = document.getElementById("assignment-filter");
  (replacement || fallback)?.focus();
}

function syncModalBackground() {
  const modalOpen =
    !document.getElementById("assignment-dialog").hidden
    || !document.getElementById("unassign-dialog").hidden;
  for (const id of ["protected-nav", "assignments-main"]) {
    const element = document.getElementById(id);
    element.inert = modalOpen;
    if (modalOpen) element.setAttribute("aria-hidden", "true");
    else element.removeAttribute("aria-hidden");
  }
}

function assignmentDialogEligibility(portfolio) {
  if (!portfolio) {
    return {
      eligible: false,
      reason: "This portfolio is no longer available. Refresh the workspace.",
    };
  }
  return {
    eligible: canOpenAssignment(portfolio),
    reason: assignmentDisabledReason(portfolio)
      || "This assignment is no longer available.",
  };
}

function renderAssignmentDialog(portfolio, { refreshed = false } = {}) {
  const eligibility = assignmentDialogEligibility(portfolio);
  const selectedManagerId = positiveSafeInteger(
    portfolio?.relationship_manager?.id,
  );
  const title = document.getElementById("assignment-dialog-title");
  const description = document.getElementById("assignment-dialog-description");
  const select = document.getElementById("assignment-manager");
  const submit = document.getElementById("assignment-submit");
  const status = document.getElementById("assignment-dialog-status");
  document.getElementById("assignment-dialog-retry").hidden = true;

  title.textContent = !portfolio
    ? "Assignment unavailable"
    : selectedManagerId === null
      ? "Assign relationship manager"
      : "Reassign relationship manager";
  description.textContent = portfolio
    ? `Choose who will oversee “${portfolio.name}” and its managed chat.`
    : "This portfolio is no longer part of the assignment workspace.";
  select.innerHTML = managerOptions(selectedManagerId);
  select.value = selectedManagerId === null ? "" : String(selectedManagerId);
  select.disabled = !eligibility.eligible;
  submit.disabled = !eligibility.eligible;
  document.getElementById("assignment-manager-error").textContent = "";
  status.classList.toggle("error", !eligibility.eligible);
  status.textContent = !eligibility.eligible
    ? eligibility.reason
    : refreshed
      ? "Assignment data refreshed. Review the current manager before saving."
      : "";
}

function renderUnassignDialog(portfolio, { refreshed = false } = {}) {
  const submit = document.getElementById("unassign-submit");
  const status = document.getElementById("unassign-dialog-status");
  document.getElementById("unassign-dialog-retry").hidden = true;
  const canUnassign = Boolean(
    portfolio?.relationship_manager
    && portfolio.actions?.can_unassign,
  );
  document.getElementById("unassign-dialog-description").textContent =
    portfolio?.relationship_manager
      ? `Remove ${portfolio.relationship_manager.name} from “${portfolio.name}”? `
        + "The portfolio will return to the awaiting-assignment queue."
      : "This assignment is no longer available.";
  submit.disabled = !canUnassign;
  status.classList.toggle("error", !canUnassign);
  status.textContent = !canUnassign
    ? portfolio?.actions?.unassign_disabled_reason
      || "This assignment can no longer be removed."
    : refreshed
      ? "Assignment data refreshed. Confirm the current manager before unassigning."
      : "";
}

function reconcileOpenDialogs() {
  if (!document.getElementById("assignment-dialog").hidden) {
    renderAssignmentDialog(
      findPortfolio(assignmentState.dialogPortfolioId),
      { refreshed: true },
    );
  }
  if (!document.getElementById("unassign-dialog").hidden) {
    renderUnassignDialog(
      findPortfolio(assignmentState.unassignPortfolioId),
      { refreshed: true },
    );
  }
}

async function loadAssignments() {
  if (assignmentState.loading) return;
  assignmentState.loading = true;
  document.getElementById("assignment-retry").hidden = true;
  document.getElementById("assignment-dialog-retry").disabled = true;
  document.getElementById("unassign-dialog-retry").disabled = true;
  document.getElementById("assignments-main").setAttribute("aria-busy", "true");
  setAssignmentStatus("Loading portfolio assignments…");
  try {
    const [items, managers] = await Promise.all([
      API.getPortfolioAssignments(),
      API.getAssignableRelationshipManagers(),
    ]);
    assignmentState.items = normalizeAssignments(items);
    assignmentState.managers = normalizeManagers(managers);
    renderAssignmentRows();
    reconcileOpenDialogs();
    if (assignmentState.pendingFocus) {
      restoreActionFocus(assignmentState.pendingFocus);
      assignmentState.pendingFocus = null;
    }
    setAssignmentStatus("");
  } catch (error) {
    setAssignmentStatus(
      error.message || "Portfolio assignments could not be loaded.",
      true,
    );
    document.getElementById("assignment-retry").hidden = false;
  } finally {
    assignmentState.loading = false;
    document.getElementById("assignment-dialog-retry").disabled = false;
    document.getElementById("unassign-dialog-retry").disabled = false;
    document.getElementById("assignments-main").removeAttribute("aria-busy");
  }
}

function findPortfolio(portfolioId) {
  const normalized = positiveSafeInteger(portfolioId);
  if (normalized === null) return null;
  return assignmentState.items.find(item => item.id === normalized) || null;
}

function canOpenAssignment(portfolio) {
  if (!portfolio) return false;
  const actions = portfolio.actions || {};
  return portfolio.relationship_manager
    ? Boolean(actions.can_reassign)
    : Boolean(actions.can_assign);
}

function assignmentDisabledReason(portfolio) {
  if (!portfolio) return "This portfolio is no longer available.";
  const actions = portfolio.actions || {};
  return portfolio.relationship_manager
    ? actions.reassign_disabled_reason
    : actions.assign_disabled_reason;
}

function managerOptions(selectedId) {
  const placeholder = selectedId === null ? " selected" : "";
  return `
    <option value="" disabled${placeholder}>Select a relationship manager</option>
    ${assignmentState.managers.map(manager => `
      <option value="${manager.id}"${manager.id === selectedId ? " selected" : ""}>
        ${escapeHtml(manager.name)} (${escapeHtml(manager.email)})
      </option>`).join("")}`;
}

function openAssignmentDialog(portfolioId, invoker = document.activeElement) {
  if (assignmentState.mutatingPortfolioId !== null) return;
  const portfolio = findPortfolio(portfolioId);
  if (!portfolio || !canOpenAssignment(portfolio)) {
    setAssignmentStatus(
      assignmentDisabledReason(portfolio)
        || "This assignment is no longer available. Refresh and try again.",
      true,
    );
    return;
  }

  assignmentState.dialogPortfolioId = portfolio.id;
  assignmentState.dialogInvoker = invokerDescriptor(
    invoker,
    portfolio.relationship_manager ? "reassign" : "assign",
    portfolio.id,
  );
  renderAssignmentDialog(portfolio);
  const dialog = document.getElementById("assignment-dialog");
  dialog.hidden = false;
  syncModalBackground();
  document.getElementById("assignment-manager").focus();
}

function closeAssignmentDialog({ restoreAfterLoad = false } = {}) {
  if (assignmentState.mutatingPortfolioId !== null) return;
  const invoker = assignmentState.dialogInvoker;
  const dialog = document.getElementById("assignment-dialog");
  dialog.hidden = true;
  assignmentState.dialogPortfolioId = null;
  assignmentState.dialogInvoker = null;
  if (restoreAfterLoad) assignmentState.pendingFocus = invoker;
  document.getElementById("assignment-dialog-retry").hidden = true;
  document.getElementById("assignment-dialog-status").textContent = "";
  syncModalBackground();
  restoreActionFocus(invoker);
}

function setMutationState(portfolioId, active) {
  assignmentState.mutatingPortfolioId = active ? portfolioId : null;
  document.getElementById("assignment-submit").disabled = active;
  document.getElementById("assignment-cancel").disabled = active;
  document.getElementById("unassign-submit").disabled = active;
  document.getElementById("unassign-cancel").disabled = active;
  document.getElementById("assignment-manager").disabled = active;
  renderAssignmentRows();
}

function showMutationConflict(message, statusId) {
  const status = document.getElementById(statusId);
  status.textContent =
    message || "This assignment changed. Refresh the data before trying again.";
  status.classList.add("error");
  setAssignmentStatus(
    "The assignment data changed. Refresh to review the latest state.",
    true,
  );
  document.getElementById("assignment-retry").hidden = false;
  document.getElementById(
    statusId === "unassign-dialog-status"
      ? "unassign-dialog-retry"
      : "assignment-dialog-retry",
  ).hidden = false;
}

async function submitAssignment(event) {
  event?.preventDefault();
  if (assignmentState.mutatingPortfolioId !== null) return;

  const portfolio = findPortfolio(assignmentState.dialogPortfolioId);
  const status = document.getElementById("assignment-dialog-status");
  const fieldError = document.getElementById("assignment-manager-error");
  status.textContent = "";
  status.classList.remove("error");
  fieldError.textContent = "";

  if (!portfolio || !canOpenAssignment(portfolio)) {
    showMutationConflict(
      assignmentDisabledReason(portfolio)
        || "This portfolio changed. Refresh before trying again.",
      "assignment-dialog-status",
    );
    return;
  }

  const managerId = positiveSafeInteger(
    document.getElementById("assignment-manager").value,
  );
  const managerExists = assignmentState.managers.some(
    manager => manager.id === managerId,
  );
  if (managerId === null || !managerExists) {
    fieldError.textContent = "Choose an available relationship manager.";
    return;
  }
  if (positiveSafeInteger(portfolio.relationship_manager?.id) === managerId) {
    status.textContent = "This relationship manager is already assigned.";
    status.classList.add("error");
    return;
  }

  setMutationState(portfolio.id, true);
  status.textContent = "Saving assignment…";
  try {
    await API.assignPortfolioManager(portfolio.id, managerId);
    setMutationState(portfolio.id, false);
    closeAssignmentDialog({ restoreAfterLoad: true });
    setAssignmentStatus("Assignment saved.");
    await loadAssignments();
  } catch (error) {
    setMutationState(portfolio.id, false);
    if (error.status === 409) {
      showMutationConflict(error.message, "assignment-dialog-status");
      return;
    }
    status.textContent = error.message || "Assignment could not be saved.";
    status.classList.add("error");
  }
}

function openUnassignDialog(portfolioId, invoker = document.activeElement) {
  if (assignmentState.mutatingPortfolioId !== null) return;
  const portfolio = findPortfolio(portfolioId);
  if (!portfolio || !portfolio.relationship_manager || !portfolio.actions?.can_unassign) {
    setAssignmentStatus(
      portfolio?.actions?.unassign_disabled_reason
        || "This assignment cannot be removed.",
      true,
    );
    return;
  }
  assignmentState.unassignPortfolioId = portfolio.id;
  assignmentState.unassignInvoker = invokerDescriptor(
    invoker,
    "unassign",
    portfolio.id,
  );
  renderUnassignDialog(portfolio);
  const dialog = document.getElementById("unassign-dialog");
  dialog.hidden = false;
  syncModalBackground();
  document.getElementById("unassign-cancel").focus();
}

function closeUnassignDialog({ restoreAfterLoad = false } = {}) {
  if (assignmentState.mutatingPortfolioId !== null) return;
  const invoker = assignmentState.unassignInvoker;
  document.getElementById("unassign-dialog").hidden = true;
  assignmentState.unassignPortfolioId = null;
  assignmentState.unassignInvoker = null;
  if (restoreAfterLoad) assignmentState.pendingFocus = invoker;
  document.getElementById("unassign-dialog-retry").hidden = true;
  document.getElementById("unassign-dialog-status").textContent = "";
  syncModalBackground();
  restoreActionFocus(invoker);
}

async function submitUnassignment(event) {
  event?.preventDefault();
  if (assignmentState.mutatingPortfolioId !== null) return;

  const portfolio = findPortfolio(assignmentState.unassignPortfolioId);
  const status = document.getElementById("unassign-dialog-status");
  status.textContent = "";
  status.classList.remove("error");
  if (
    !portfolio
    || !portfolio.relationship_manager
    || !portfolio.actions?.can_unassign
  ) {
    showMutationConflict(
      portfolio?.actions?.unassign_disabled_reason
        || "This assignment changed. Refresh before trying again.",
      "unassign-dialog-status",
    );
    return;
  }

  setMutationState(portfolio.id, true);
  status.textContent = "Removing assignment…";
  try {
    await API.unassignPortfolioManager(portfolio.id);
    setMutationState(portfolio.id, false);
    closeUnassignDialog({ restoreAfterLoad: true });
    setAssignmentStatus("Relationship manager unassigned.");
    await loadAssignments();
  } catch (error) {
    setMutationState(portfolio.id, false);
    if (error.status === 409) {
      showMutationConflict(error.message, "unassign-dialog-status");
      return;
    }
    status.textContent = error.message || "Assignment could not be removed.";
    status.classList.add("error");
  }
}

function handleAssignmentAction(event) {
  if (assignmentState.mutatingPortfolioId !== null) return;
  const actionButton = event.target.closest("[data-assignment-action]");
  if (!actionButton || actionButton.disabled) return;
  const portfolioId = positiveSafeInteger(actionButton.dataset.portfolioId);
  if (portfolioId === null || !findPortfolio(portfolioId)) return;
  if (actionButton.dataset.assignmentAction === "unassign") {
    openUnassignDialog(portfolioId, actionButton);
    return;
  }
  if (["assign", "reassign"].includes(actionButton.dataset.assignmentAction)) {
    openAssignmentDialog(portfolioId, actionButton);
  }
}

function trapDialogFocus(event, dialog) {
  const focusable = Array.from(dialog.querySelectorAll(
    "button:not([disabled]), select:not([disabled]), "
    + "input:not([disabled]), [tabindex]:not([tabindex=\"-1\"])",
  )).filter(element => !element.hidden);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const activeIndex = focusable.indexOf(document.activeElement);
  const shouldWrapBackward = event.shiftKey && activeIndex <= 0;
  const shouldWrapForward = !event.shiftKey
    && (activeIndex === -1 || document.activeElement === last);
  if (!shouldWrapBackward && !shouldWrapForward) return;
  event.preventDefault();
  (shouldWrapBackward ? last : first).focus();
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

function bindAssignmentEvents() {
  document.getElementById("assignment-rows").addEventListener(
    "click",
    handleAssignmentAction,
  );
  document.getElementById("assignment-filter").addEventListener(
    "change",
    renderAssignmentRows,
  );
  document.getElementById("assignment-form").addEventListener(
    "submit",
    submitAssignment,
  );
  document.getElementById("assignment-cancel").addEventListener(
    "click",
    closeAssignmentDialog,
  );
  document.getElementById("unassign-cancel").addEventListener(
    "click",
    closeUnassignDialog,
  );
  document.getElementById("unassign-submit").addEventListener(
    "click",
    submitUnassignment,
  );
  document.getElementById("assignment-retry").addEventListener(
    "click",
    loadAssignments,
  );
  document.getElementById("assignment-dialog-retry").addEventListener(
    "click",
    loadAssignments,
  );
  document.getElementById("unassign-dialog-retry").addEventListener(
    "click",
    loadAssignments,
  );
  document.getElementById("assignment-dialog").addEventListener("click", event => {
    if (event.target.dataset.dialogDismiss === "assignment") {
      closeAssignmentDialog();
    }
  });
  document.getElementById("unassign-dialog").addEventListener("click", event => {
    if (event.target.dataset.dialogDismiss === "unassign") closeUnassignDialog();
  });
  document.addEventListener("keydown", event => {
    const unassignDialog = document.getElementById("unassign-dialog");
    const assignmentDialog = document.getElementById("assignment-dialog");
    const openDialog = !unassignDialog.hidden
      ? unassignDialog
      : !assignmentDialog.hidden
        ? assignmentDialog
        : null;
    if (event.key === "Tab" && openDialog) {
      trapDialogFocus(event, openDialog);
      return;
    }
    if (event.key !== "Escape" || assignmentState.mutatingPortfolioId !== null) return;
    if (!unassignDialog.hidden) {
      closeUnassignDialog();
    } else if (!assignmentDialog.hidden) {
      closeAssignmentDialog();
    }
  });
  document.getElementById("signout-button").addEventListener("click", signOut);
}

async function initializeAssignments() {
  const user = await requirePageRole("superadmin");
  if (!user) {
    const recovery = document.getElementById("protected-page-recovery");
    if (recovery) {
      const recoveryMain = recovery.closest("main") || document.querySelector("main");
      if (recoveryMain) recoveryMain.hidden = false;
    }
    return;
  }

  const name = String(user.name || "Superadmin");
  document.getElementById("user-avatar").textContent = name.charAt(0).toUpperCase();
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-role").textContent = formatRole(user.role);
  document.getElementById("protected-nav").hidden = false;
  document.getElementById("assignments-main").hidden = false;
  await loadAssignments();
}

initRoleMenu();
bindAssignmentEvents();
initializeAssignments();
