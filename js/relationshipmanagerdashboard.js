const state = {
  user: null,
  dashboard: null,
  pending: new Set(),
  selectedCreateInterests: new Map(),
  selectedAddInterests: new Map(),
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

function setStatus(message, type = "") {
  const status = document.getElementById("dashboard-status");
  status.textContent = message;
  status.className = `dashboard-status ${type}`.trim();
  document.getElementById("dashboard-retry").hidden = type !== "error";
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
  list.innerHTML = portfolios.map((portfolio) => {
    const portfolioId = String(portfolio.portfolio_id);
    const pendingKey = `create:${portfolioId}`;
    const disabled = state.pending.has(pendingKey);
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
          <i class="ti ti-users-plus"></i> ${disabled ? "Creating room…" : "Create managed room"}
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
  list.innerHTML = rooms.map((room) => {
    const conversationId = String(room.conversation_id);
    const addKey = `add:${conversationId}`;
    const archiveKey = `archive:${conversationId}`;
    const reopenKey = `reopen:${conversationId}`;
    const addPending = state.pending.has(addKey);
    const statusPending = state.pending.has(archiveKey) || state.pending.has(reopenKey);
    const selected = selectionFor(state.selectedAddInterests, conversationId);
    const archived = room.status === "archived";
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
          ${room.investors.map((investor) => participantChip(investor.name, "investor")).join("")}
        </div>
        ${room.eligible_interests.length ? `
          <fieldset class="rm-interest-fieldset rm-add-fieldset"${addPending ? " disabled" : ""}>
            <legend>Add eligible investors</legend>
            ${room.eligible_interests.map((interest) => interestCheckbox(
              interest, "add", conversationId, selected, addPending
            )).join("")}
          </fieldset>
          <button class="btn btn-outline rm-add-investors" type="button" data-action="add"
                  data-id="${escapeHtml(conversationId)}"${addPending ? " disabled" : ""}>
            <i class="ti ti-user-plus"></i> ${addPending ? "Adding…" : "Add selected investors"}
          </button>` : '<p class="rm-no-eligible">All currently interested investors are already in this room.</p>'}
        <div class="rm-room-actions">
          <button class="btn btn-primary" type="button" data-action="open" data-id="${escapeHtml(conversationId)}">
            <i class="ti ti-message-circle"></i> Open Group Chat
          </button>
          <button class="btn btn-outline" type="button" data-action="${archived ? "reopen" : "archive"}"
                  data-id="${escapeHtml(conversationId)}"${statusPending ? " disabled" : ""}>
            <i class="ti ${archived ? "ti-lock-open" : "ti-archive"}"></i>
            ${statusPending ? "Updating…" : archived ? "Reopen" : "Archive"}
          </button>
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
    state.dashboard = await API.getRelationshipManagerDashboard();
    renderDashboard();
    setStatus("Dashboard is up to date.", "success");
  } catch (error) {
    setStatus(`Could not load the dashboard. ${error.message}`, "error");
  }
}

async function runMutation(key, action, successMessage) {
  if (state.pending.has(key)) return;
  state.pending.add(key);
  renderDashboard();
  try {
    await action();
    await loadDashboard();
    setStatus(successMessage, "success");
  } catch (error) {
    setStatus(error.message, "error");
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
