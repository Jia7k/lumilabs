const state = {
  user: null,
  dashboard: null,
  pending: new Set(),
  selectedCreateInterests: new Map(),
  selectedAddInterests: new Map(),
  stale: false,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function initRelationshipManagerDashboard() {
  setStatus("Loading managed conversations…", "loading");
  state.user = await requirePageRole("relationship_manager");
  if (!state.user) return;
  renderUser();
  bindDashboardEvents();
  await loadDashboard();
}

function renderUser() {
  document.getElementById("user-avatar").textContent = state.user.name.slice(0, 1).toUpperCase();
  document.getElementById("user-name").textContent = state.user.name;
  document.getElementById("user-role").textContent = "Relationship Manager";
}

function setStatus(message, type = "", retryable = false) {
  const status = document.getElementById("dashboard-status");
  status.textContent = message;
  status.className = `dashboard-status ${type}`.trim();
  document.getElementById("dashboard-retry").hidden = !retryable;
}

function selectionFor(map, parentId) {
  const key = String(parentId);
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
}

function syncSelectionFromDom(kind, parentId) {
  const selector = `input[data-selection="${kind}"][data-parent-id="${parentId}"]:checked`;
  const interestIds = [...document.querySelectorAll(selector)].map((input) => String(input.value));
  const map = kind === "create" ? state.selectedCreateInterests : state.selectedAddInterests;
  map.set(String(parentId), new Set(interestIds));
}

function interestCheckbox(interest, kind, parentId, selected, disabled) {
  const interestId = String(interest.id);
  const checked = selected.has(interestId) ? " checked" : "";
  const isDisabled = disabled ? " disabled" : "";
  return `
    <label class="rm-interest-option">
      <input type="checkbox" data-selection="${kind}" data-parent-id="${escapeHtml(parentId)}"
             value="${escapeHtml(interestId)}"${checked}${isDisabled} />
      <span class="rm-interest-check" aria-hidden="true"><i class="ti ti-check"></i></span>
      <span>
        <strong>${escapeHtml(interest.investor.name)}</strong>
        <small>Eligible investor</small>
      </span>
    </label>`;
}

function renderUnclaimedPortfolios() {
  const list = document.getElementById("unclaimed-room-list");
  const portfolios = state.dashboard.unclaimed_portfolios || [];
  if (!portfolios.length) {
    list.innerHTML = `
      <div class="rm-empty-state">
        <i class="ti ti-circle-check" aria-hidden="true"></i>
        <h3>No portfolios are waiting</h3>
        <p>New approved portfolios with investor interest will appear here.</p>
      </div>`;
    return;
  }
  const mutationsDisabled = state.stale || state.pending.size > 0;
  list.innerHTML = portfolios.map((portfolio) => {
    const portfolioId = String(portfolio.portfolio_id);
    const disabled = mutationsDisabled;
    const selected = selectionFor(state.selectedCreateInterests, portfolioId);
    return `
      <article class="rm-room-card rm-room-card--unclaimed">
        <div class="rm-room-topline"><span>Approved portfolio</span><i class="ti ti-sparkles"></i></div>
        <div class="rm-room-title-row">
          <div>
            <h3>${escapeHtml(portfolio.portfolio_name)}</h3>
            <p>Owned by ${escapeHtml(portfolio.owner.name)}</p>
          </div>
          <span class="rm-interest-count">${portfolio.interests.length} interested</span>
        </div>
        <fieldset class="rm-interest-fieldset"${disabled ? " disabled" : ""}>
          <legend>Choose investors for this room</legend>
          ${portfolio.interests.map((interest) => interestCheckbox(
            interest, "create", portfolioId, selected, disabled
          )).join("")}
        </fieldset>
        <button class="btn btn-primary rm-room-primary" type="button" data-action="create"
                data-id="${escapeHtml(portfolioId)}"${disabled ? " disabled" : ""}>
          <i class="ti ti-users-plus"></i> ${state.pending.size ? "Creating room…" : "Create managed room"}
        </button>
      </article>`;
  }).join("");
}

function participantChip(name, role) {
  return `<span class="rm-participant-chip rm-participant-chip--${role}">
    <i class="ti ${role === "owner" ? "ti-building" : "ti-user"}"></i>
    ${escapeHtml(name)} <small>${role === "owner" ? "Owner" : "Investor"}</small>
  </span>`;
}

function reopenEligibility(room) {
  if (room.status !== "archived") {
    return { enabled: false, reason: "This room is not archived." };
  }
  if (room.archived_reason === "portfolio_deleted" || room.portfolio_id == null) {
    return { enabled: false, reason: "This portfolio was deleted; its chat history is permanent and cannot reopen." };
  }
  if (room.archived_reason === "portfolio_unapproved") {
    return { enabled: false, reason: "The portfolio must be approved before this room can reopen." };
  }
  if (!Array.isArray(room.investors) || !Array.isArray(room.eligible_interests)) {
    return { enabled: false, reason: "This room cannot reopen from its current state." };
  }
  if (room.investors.length > 0) return { enabled: true, reason: "" };
  if (room.eligible_interests.length > 0) {
    return { enabled: false, reason: "Add an eligible investor before reopening this room." };
  }
  return { enabled: false, reason: "An investor must express interest before this room can reopen." };
}

function renderManagedRooms() {
  const list = document.getElementById("managed-room-list");
  const rooms = state.dashboard.rooms || [];
  if (!rooms.length) {
    list.innerHTML = `
      <div class="rm-empty-state">
        <i class="ti ti-messages-off" aria-hidden="true"></i>
        <h3>No managed rooms yet</h3>
        <p>Create a room from an approved portfolio when investor interest arrives.</p>
      </div>`;
    return;
  }
  const mutationsDisabled = state.stale || state.pending.size > 0;
  list.innerHTML = rooms.map((room) => {
    const conversationId = String(room.conversation_id);
    const addDisabled = mutationsDisabled;
    const selected = selectionFor(state.selectedAddInterests, conversationId);
    const archived = room.status === "archived";
    const investors = Array.isArray(room.investors) ? room.investors : [];
    const eligibleInterests = Array.isArray(room.eligible_interests)
      ? room.eligible_interests
      : [];
    const noEligibleMessage = investors.length
      ? "All currently interested investors are already in this room."
      : "No investors are currently interested.";
    const reopen = archived ? reopenEligibility(room) : { enabled: true, reason: "" };
    const statusDisabled = mutationsDisabled || (archived && !reopen.enabled);
    const reasonId = `reopen-reason-${conversationId}`;
    const statusAction = `
      <button class="btn btn-outline" type="button" data-action="${archived ? "reopen" : "archive"}"
              data-id="${escapeHtml(conversationId)}"
              ${archived && reopen.reason ? `aria-describedby="${reasonId}"` : ""}
              ${statusDisabled ? "disabled" : ""}>
        <i class="ti ${archived ? "ti-lock-open" : "ti-archive"}"></i>
        ${state.pending.size ? "Updating…" : archived ? "Reopen" : "Archive"}
      </button>
      ${archived && reopen.reason ? `<p class="rm-no-eligible" id="${reasonId}">${escapeHtml(reopen.reason)}</p>` : ""}`;
    return `
      <article class="rm-room-card ${archived ? "rm-room-card--archived" : "rm-room-card--active"}">
        <div class="rm-room-topline">
          <span class="rm-room-status ${archived ? "archived" : "active"}">
            <i class="ti ${archived ? "ti-lock" : "ti-point-filled"}"></i>
            ${archived ? "Archived · read-only" : "Active conversation"}
          </span>
          ${room.unread_count ? `<span class="rm-unread-pill">${room.unread_count} unread</span>` : ""}
        </div>
        <div class="rm-room-title-row">
          <div><h3>${escapeHtml(room.title)}</h3><p>Managed group conversation</p></div>
        </div>
        <div class="rm-participant-list" aria-label="Current participants">
          ${participantChip(room.owner.name, "owner")}
          ${investors.map((investor) => participantChip(investor.name, "investor")).join("")}
        </div>
        ${eligibleInterests.length ? `
          <fieldset class="rm-interest-fieldset rm-add-fieldset"${addDisabled ? " disabled" : ""}>
            <legend>Add eligible investors</legend>
            ${eligibleInterests.map((interest) => interestCheckbox(
              interest, "add", conversationId, selected, addDisabled
            )).join("")}
          </fieldset>
          <button class="btn btn-outline rm-add-investors" type="button" data-action="add"
                  data-id="${escapeHtml(conversationId)}"${addDisabled ? " disabled" : ""}>
            <i class="ti ti-user-plus"></i> ${state.pending.size ? "Adding…" : "Add selected investors"}
          </button>` : `<p class="rm-no-eligible">${escapeHtml(noEligibleMessage)}</p>`}
        <div class="rm-room-actions">
          <button class="btn btn-primary" type="button" data-action="open" data-id="${escapeHtml(conversationId)}">
            <i class="ti ti-message-circle"></i> Open Group Chat
          </button>
          ${statusAction}
        </div>
      </article>`;
  }).join("");
}

function renderDashboard() {
  const stats = state.dashboard.stats;
  document.getElementById("stat-eligible").textContent = stats.eligible_interests;
  document.getElementById("stat-active").textContent = stats.active_rooms;
  document.getElementById("stat-businesses").textContent = stats.businesses_overseen;
  document.getElementById("stat-unread").textContent = stats.unread_messages;
  renderUnclaimedPortfolios();
  renderManagedRooms();
}

async function loadDashboard() {
  setStatus("Loading managed conversations…", "loading");
  try {
    const dashboard = await API.getRelationshipManagerDashboard();
    state.dashboard = dashboard;
    state.stale = false;
    renderDashboard();
    setStatus("Dashboard is up to date.", "success");
    return true;
  } catch (error) {
    if (state.dashboard) {
      state.stale = true;
      renderDashboard();
    }
    setStatus(`Could not load the dashboard. ${error.message}`, "error", true);
    return false;
  }
}

async function runMutation(key, action, successMessage) {
  if (state.stale || state.pending.size > 0) return false;
  state.pending.add(key);
  renderDashboard();
  try {
    await action();
    const refreshed = await loadDashboard();
    if (!refreshed) {
      state.stale = true;
      if (state.dashboard) renderDashboard();
      setStatus(
        "The change was saved, but the dashboard refresh failed. Retry before making another change.",
        "error",
        true,
      );
      return false;
    }
    setStatus(successMessage, "success");
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    return false;
  } finally {
    state.pending.delete(key);
    if (state.dashboard) renderDashboard();
  }
}

async function createRoom(portfolioId) {
  syncSelectionFromDom("create", portfolioId);
  const interestIds = [...selectionFor(state.selectedCreateInterests, portfolioId)];
  if (!interestIds.length) {
    setStatus("Please select at least one interested investor before creating a room.", "error");
    return;
  }
  await runMutation(`create:${portfolioId}`, async () => {
    await API.createManagedConversation(portfolioId, interestIds);
    state.selectedCreateInterests.delete(portfolioId);
  }, "Managed room created. The participants can now join the group chat.");
}

async function addInvestors(conversationId) {
  syncSelectionFromDom("add", conversationId);
  const interestIds = [...selectionFor(state.selectedAddInterests, conversationId)];
  if (!interestIds.length) {
    setStatus("Please select at least one interested investor to add.", "error");
    return;
  }
  await runMutation(`add:${conversationId}`, async () => {
    await API.addManagedInvestors(conversationId, interestIds);
    state.selectedAddInterests.delete(conversationId);
  }, "Selected investors were added to the managed conversation.");
}

async function changeRoomStatus(conversationId, action) {
  const label = action === "archive" ? "archived" : "reopened";
  await runMutation(`${action}:${conversationId}`, async () => {
    if (action === "archive") await API.archiveManagedConversation(conversationId);
    else await API.reopenManagedConversation(conversationId);
  }, `The managed conversation was ${label}.`);
}

function openGroupChat(conversationId) {
  window.location.href = `messages.html?conversationId=${conversationId}`;
}

function bindDashboardEvents() {
  document.getElementById("dashboard-retry").addEventListener("click", loadDashboard);
  document.getElementById("main-content").addEventListener("change", (event) => {
    const input = event.target.closest("input[data-selection]");
    if (input) syncSelectionFromDom(input.dataset.selection, input.dataset.parentId);
  });
  document.getElementById("main-content").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    const { action, id } = button.dataset;
    if (action === "create") createRoom(id);
    else if (action === "add") addInvestors(id);
    else if (action === "open") openGroupChat(id);
    else if (action === "archive" || action === "reopen") changeRoomStatus(id, action);
  });
}

document.addEventListener("DOMContentLoaded", initRelationshipManagerDashboard);
