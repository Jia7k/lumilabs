const state = {
  user: null,
  dashboard: null,
  pending: new Set(),
  selectedCreateInterests: new Map(),
  selectedAddInterests: new Map(),
  stale: false,
  dashboardRequestVersion: 0,
  detailRequestVersion: 0,
  detailPortfolio: null,
  detailTrigger: null,
  eventsBound: false,
};

const PORTFOLIO_STATUS_CLASSES = Object.freeze({
  approved: "approved",
  draft: "draft",
  pending: "pending",
  rejected: "rejected",
});

const PARTICIPANT_ROLE_CLASSES = Object.freeze({
  relationship_manager: "manager",
  business_owner: "owner",
  investor: "investor",
});

const PARTICIPANT_ROLE_LABELS = Object.freeze({
  relationship_manager: "Relationship manager",
  business_owner: "Business owner",
  investor: "Investor",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function positiveSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function displayLabel(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function setStatus(message, type = "", retryable = false) {
  const status = document.getElementById("dashboard-status");
  status.textContent = message;
  status.className = `dashboard-status${type ? ` ${type}` : ""}`;
  document.getElementById("dashboard-retry").hidden = !retryable;
}

function setStats(stats = null) {
  const values = stats
    ? {
        "stat-assigned": stats.assigned_portfolios,
        "stat-approved": stats.approved_portfolios,
        "stat-eligible": stats.eligible_interests,
        "stat-active": stats.active_rooms,
        "stat-unread": stats.unread_messages,
      }
    : {
        "stat-assigned": "—",
        "stat-approved": "—",
        "stat-eligible": "—",
        "stat-active": "—",
        "stat-unread": "—",
      };
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).textContent = value ?? 0;
  }
}

function renderUser() {
  const name = String(state.user?.name || "");
  document.getElementById("user-avatar").textContent = name.slice(0, 1).toUpperCase();
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-role").textContent = "Relationship Manager";
}

function assignedPortfolio(rawPortfolioId) {
  const portfolioId = positiveSafeInteger(rawPortfolioId);
  if (!portfolioId || !Array.isArray(state.dashboard?.portfolios)) return null;
  return state.dashboard.portfolios.find(
    (portfolio) => positiveSafeInteger(portfolio.id) === portfolioId,
  ) || null;
}

function portfolioForConversation(rawConversationId) {
  const conversationId = positiveSafeInteger(rawConversationId);
  if (!conversationId || !Array.isArray(state.dashboard?.portfolios)) return null;
  return state.dashboard.portfolios.find(
    (portfolio) => positiveSafeInteger(portfolio.conversation?.id) === conversationId,
  ) || null;
}

function eligibleInterests(portfolio) {
  if (!Array.isArray(portfolio?.interests)) return [];
  return portfolio.interests.filter((interest) => (
    !interest.is_active_member
    && positiveSafeInteger(interest.interest_id) !== null
    && interest.investor
    && typeof interest.investor === "object"
  ));
}

function selectionFor(kind, portfolioId) {
  const map = kind === "create"
    ? state.selectedCreateInterests
    : state.selectedAddInterests;
  const key = String(portfolioId);
  if (!map.has(key)) map.set(key, new Set());
  return map.get(key);
}

function syncSelectionFromDom(kind, rawPortfolioId) {
  if (kind !== "create" && kind !== "add") return;
  const portfolioId = positiveSafeInteger(rawPortfolioId);
  const portfolio = assignedPortfolio(portfolioId);
  if (!portfolioId || !portfolio) return;
  const allowedIds = new Set(
    eligibleInterests(portfolio).map((interest) => positiveSafeInteger(interest.interest_id)),
  );
  const selector =
    `input[data-selection="${kind}"][data-portfolio-id="${portfolioId}"]:checked`;
  const selected = [...document.querySelectorAll(selector)]
    .map((input) => positiveSafeInteger(input.value))
    .filter((interestId) => interestId !== null && allowedIds.has(interestId));
  const map = kind === "create"
    ? state.selectedCreateInterests
    : state.selectedAddInterests;
  map.set(String(portfolioId), new Set(selected.map(String)));
}

function interestCheckbox(interest, kind, portfolioId, selected, disabled) {
  const interestId = positiveSafeInteger(interest.interest_id);
  if (!interestId) return "";
  const inputId = `rm-${kind}-${portfolioId}-${interestId}`;
  const checked = selected.has(String(interestId)) ? " checked" : "";
  return `
    <label class="rm-interest-option" for="${inputId}">
      <input id="${inputId}"
             type="checkbox"
             data-selection="${kind}"
             data-portfolio-id="${portfolioId}"
             value="${interestId}"${checked}${disabled ? " disabled" : ""} />
      <span class="rm-interest-check" aria-hidden="true"><i class="ti ti-check"></i></span>
      <span>
        <strong>${escapeHtml(interest.investor.name)}</strong>
        <small>${escapeHtml(interest.investor.email || "Eligible investor")}</small>
      </span>
    </label>`;
}

function documentButtons(portfolio) {
  const portfolioId = positiveSafeInteger(portfolio.id);
  const documents = Array.isArray(portfolio.documents)
    ? portfolio.documents.filter((document) => positiveSafeInteger(document.id))
    : [];
  if (!portfolioId || !documents.length) {
    return '<p class="rm-empty-copy">No documents have been uploaded.</p>';
  }
  return `
    <div class="rm-document-list">
      ${documents.map((document) => `
        <button class="rm-document-button"
                type="button"
                data-action="download"
                data-portfolio-id="${portfolioId}"
                data-document-id="${positiveSafeInteger(document.id)}">
          <i class="ti ti-file-download" aria-hidden="true"></i>
          <span>
            <strong>${escapeHtml(document.file_name)}</strong>
            <small>${escapeHtml(displayLabel(document.file_type || "Document"))}</small>
          </span>
        </button>`).join("")}
    </div>`;
}

function participantRows(portfolio, mutationsDisabled) {
  const conversationId = positiveSafeInteger(portfolio.conversation?.id);
  const participants = Array.isArray(portfolio.participants) ? portfolio.participants : [];
  if (!participants.length) {
    return '<p class="rm-empty-copy">No active chat participants yet.</p>';
  }
  return `
    <div class="rm-participant-list">
      ${participants.map((participant) => {
        const participantId = positiveSafeInteger(participant.id);
        const role = Object.hasOwn(PARTICIPANT_ROLE_CLASSES, participant.role)
          ? participant.role
          : null;
        const roleClass = role ? PARTICIPANT_ROLE_CLASSES[role] : "participant";
        const roleLabel = role ? PARTICIPANT_ROLE_LABELS[role] : "Participant";
        const canRemove = role === "investor" && participantId && conversationId;
        return `
          <div class="rm-participant-row rm-participant-row--${roleClass}">
            <span class="rm-participant-avatar" aria-hidden="true">
              ${escapeHtml(String(participant.name || "?").slice(0, 1).toUpperCase())}
            </span>
            <span class="rm-participant-identity">
              <strong>${escapeHtml(participant.name)}</strong>
              <small>${escapeHtml(roleLabel)}</small>
            </span>
            ${canRemove ? `
              <button class="btn btn-outline rm-remove-investor"
                      type="button"
                      data-action="remove"
                      data-conversation-id="${conversationId}"
                      data-investor-id="${participantId}"
                      ${mutationsDisabled ? "disabled" : ""}>
                <i class="ti ti-user-minus" aria-hidden="true"></i>
                ${state.pending.size ? "Removing…" : "Remove"}
              </button>` : ""}
          </div>`;
      }).join("")}
    </div>`;
}

function chatSummary(portfolio) {
  const conversation = portfolio.conversation;
  if (!conversation) {
    return `
      <span class="rm-chat-state not-started">
        <i class="ti ti-message-off" aria-hidden="true"></i> Chat not started
      </span>`;
  }
  const chatStatus = conversation.status === "active" ? "active" : "archived";
  return `
    <span class="rm-chat-state ${chatStatus}">
      <i class="ti ${chatStatus === "active" ? "ti-message-circle-check" : "ti-lock"}"
         aria-hidden="true"></i>
      ${escapeHtml(displayLabel(conversation.status || "Unknown"))} chat
      ${conversation.unread_count
        ? `<small>${escapeHtml(conversation.unread_count)} unread</small>`
        : ""}
    </span>
    ${conversation.archived_reason
      ? `<p class="rm-chat-reason">${escapeHtml(displayLabel(conversation.archived_reason))}</p>`
      : ""}`;
}

function renderPortfolioAction(portfolio, mutationsDisabled) {
  const portfolioId = positiveSafeInteger(portfolio.id);
  const conversationId = positiveSafeInteger(portfolio.conversation?.id);
  const candidates = eligibleInterests(portfolio);
  const actions = portfolio.actions && typeof portfolio.actions === "object"
    ? portfolio.actions
    : {};
  const {
    can_create_conversation,
    create_disabled_reason,
    can_add_investors,
    add_disabled_reason,
  } = actions;
  const kind = conversationId ? "add" : "create";
  const serverAllows = kind === "create"
    ? can_create_conversation === true
    : can_add_investors === true;
  const serverReason = kind === "create"
    ? create_disabled_reason
    : add_disabled_reason;
  const selected = selectionFor(kind, portfolioId);
  const fieldsetDisabled = mutationsDisabled || !serverAllows || !portfolioId;
  const actionDisabled = fieldsetDisabled || selected.size === 0;
  const disabledReason = !serverAllows
    ? serverReason || "This action is not available."
    : selected.size === 0
      ? "Select at least one interested investor."
      : "";
  const reasonId = `rm-${kind}-reason-${portfolioId || "invalid"}`;

  return `
    <div class="rm-interest-action">
      <fieldset class="rm-interest-fieldset"${fieldsetDisabled ? " disabled" : ""}>
        <legend>${kind === "create"
          ? "Choose investors for the new chat"
          : "Choose interested investors to add"}</legend>
        ${candidates.length
          ? candidates.map((interest) => interestCheckbox(
              interest,
              kind,
              portfolioId,
              selected,
              fieldsetDisabled,
            )).join("")
          : '<p class="rm-empty-copy">No eligible interest candidates right now.</p>'}
      </fieldset>
      <button class="btn ${kind === "create" ? "btn-primary" : "btn-outline"} rm-investor-action"
              type="button"
              data-action="${kind}"
              data-portfolio-id="${portfolioId || ""}"
              aria-describedby="${reasonId}"
              ${actionDisabled ? "disabled" : ""}>
        <i class="ti ${kind === "create" ? "ti-users-plus" : "ti-user-plus"}"
           aria-hidden="true"></i>
        ${state.pending.size
          ? "Saving…"
          : kind === "create"
            ? "Create managed chat"
            : "Add selected investors"}
      </button>
      <p class="rm-action-reason" id="${reasonId}">${escapeHtml(disabledReason)}</p>
    </div>`;
}

function renderPortfolioCard(portfolio) {
  const portfolioId = positiveSafeInteger(portfolio.id);
  const statusClass = Object.hasOwn(PORTFOLIO_STATUS_CLASSES, portfolio.status)
    ? PORTFOLIO_STATUS_CLASSES[portfolio.status]
    : "unknown";
  const mutationsDisabled = state.stale || state.pending.size > 0;
  const conversationId = positiveSafeInteger(portfolio.conversation?.id);
  const interestCount = eligibleInterests(portfolio).length;
  return `
    <article class="rm-portfolio-card rm-portfolio-card--${statusClass}"
             data-portfolio-card="${portfolioId || ""}">
      <div class="rm-portfolio-rail" aria-hidden="true"></div>
      <header class="rm-portfolio-header">
        <div>
          <p class="rm-portfolio-id">Assigned portfolio ${portfolioId ? `#${portfolioId}` : ""}</p>
          <h3>${escapeHtml(portfolio.name)}</h3>
          <p class="rm-owner-line">
            <i class="ti ti-building" aria-hidden="true"></i>
            ${escapeHtml(portfolio.owner?.name || "Owner unavailable")}
          </p>
        </div>
        <div class="rm-status-stack">
          <span class="badge ${statusClass}">${escapeHtml(displayLabel(portfolio.status || "Unknown"))}</span>
          ${chatSummary(portfolio)}
        </div>
      </header>

      <div class="rm-portfolio-summary">
        <span><small>Sector</small>${escapeHtml(displayValue(portfolio.sector))}</span>
        <span><small>Readiness</small>${escapeHtml(displayValue(portfolio.readiness_score))}/100</span>
        <span><small>Eligible interests</small>${interestCount}</span>
      </div>

      <section class="rm-card-section" aria-label="Active participants">
        <div class="rm-card-section-heading">
          <h4>Active participants</h4>
          <span>${Array.isArray(portfolio.participants) ? portfolio.participants.length : 0}</span>
        </div>
        ${participantRows(portfolio, mutationsDisabled)}
      </section>

      <section class="rm-card-section" aria-label="Portfolio documents">
        <div class="rm-card-section-heading">
          <h4>Documents</h4>
          <span>${Array.isArray(portfolio.documents) ? portfolio.documents.length : 0}</span>
        </div>
        ${documentButtons(portfolio)}
      </section>

      ${renderPortfolioAction(portfolio, mutationsDisabled)}

      <footer class="rm-card-actions">
        <button class="btn btn-outline"
                type="button"
                data-action="details"
                data-portfolio-id="${portfolioId || ""}"
                ${portfolioId ? "" : "disabled"}>
          <i class="ti ti-eye" aria-hidden="true"></i> View details
        </button>
        ${conversationId ? `
          <button class="btn btn-primary"
                  type="button"
                  data-action="open-chat"
                  data-conversation-id="${conversationId}">
            <i class="ti ti-message-circle" aria-hidden="true"></i> Open group chat
          </button>` : ""}
      </footer>
    </article>`;
}

function renderDashboard() {
  if (!state.dashboard) return;
  setStats(state.dashboard.stats);
  const portfolios = state.dashboard.portfolios;
  const list = document.getElementById("portfolio-list");
  if (!portfolios.length) {
    list.innerHTML = `
      <div class="rm-empty-state">
        <i class="ti ti-briefcase-off" aria-hidden="true"></i>
        <h3>No portfolios are assigned to you</h3>
        <p>A superadmin assignment will appear here automatically.</p>
      </div>`;
    return;
  }
  list.innerHTML = portfolios.map(renderPortfolioCard).join("");
}

function validDashboard(response) {
  return Boolean(
    response
    && typeof response === "object"
    && response.stats
    && typeof response.stats === "object"
    && Array.isArray(response.portfolios),
  );
}

async function loadDashboard() {
  const requestVersion = ++state.dashboardRequestVersion;
  const hadSnapshot = Boolean(state.dashboard);
  setStatus(
    hadSnapshot ? "Refreshing assigned portfolios…" : "Loading assigned portfolios…",
    "loading",
  );
  if (!hadSnapshot) {
    setStats(null);
    document.getElementById("portfolio-list").innerHTML = `
      <div class="rm-empty-state">
        <i class="ti ti-loader-2" aria-hidden="true"></i>
        <h3>Loading assigned portfolios…</h3>
        <p>Retrieving the latest portfolio and conversation state.</p>
      </div>`;
  }

  try {
    const response = await API.getRelationshipManagerDashboard();
    if (requestVersion !== state.dashboardRequestVersion) return false;
    if (!validDashboard(response)) throw new Error("The dashboard response was incomplete.");
    state.dashboard = response;
    state.stale = false;
    renderDashboard();
    setStatus("Assigned portfolio workspace is up to date.", "success");
    return true;
  } catch (error) {
    if (requestVersion !== state.dashboardRequestVersion) return false;
    if (hadSnapshot) {
      state.stale = true;
      renderDashboard();
      setStatus(
        "Couldn't refresh assigned portfolios. Showing the last loaded data.",
        "stale",
        true,
      );
    } else {
      setStats(null);
      document.getElementById("portfolio-list").innerHTML = `
        <div class="rm-empty-state rm-empty-state--error">
          <i class="ti ti-alert-triangle" aria-hidden="true"></i>
          <h3>Couldn't load assigned portfolios</h3>
          <p>${escapeHtml(error.message || "Try again.")}</p>
        </div>`;
      setStatus("Couldn't load assigned portfolios. Try again.", "error", true);
    }
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
        "The change was saved, but the workspace could not refresh. Retry before making another change.",
        "error",
        true,
      );
      return false;
    }
    setStatus(successMessage, "success");
    return true;
  } catch (error) {
    if (error?.status === 409) {
      const refreshed = await loadDashboard();
      if (refreshed) {
        setStatus(
          `${error.message || "The workspace changed."} The latest data was refreshed; review it before trying again.`,
          "error",
        );
      } else {
        state.stale = true;
        setStatus(
          "The workspace changed and the latest data could not be loaded. Retry before making another change.",
          "error",
          true,
        );
      }
      return false;
    }
    setStatus(error?.message || "The change could not be saved.", "error");
    return false;
  } finally {
    state.pending.delete(key);
    if (state.dashboard) renderDashboard();
  }
}

async function createConversation(rawPortfolioId) {
  const portfolioId = positiveSafeInteger(rawPortfolioId);
  const portfolio = assignedPortfolio(portfolioId);
  if (!portfolioId || !portfolio || portfolio.actions?.can_create_conversation !== true) {
    setStatus(
      portfolio?.actions?.create_disabled_reason || "This managed chat cannot be created.",
      "error",
    );
    return false;
  }
  syncSelectionFromDom("create", portfolioId);
  const interestIds = [...selectionFor("create", portfolioId)]
    .map(positiveSafeInteger)
    .filter((interestId) => interestId !== null);
  if (!interestIds.length) {
    setStatus("Please select at least one interested investor.", "error");
    return false;
  }
  return runMutation(`create:${portfolioId}`, async () => {
    await API.createManagedConversation(portfolioId, interestIds);
    state.selectedCreateInterests.delete(String(portfolioId));
  }, "Managed chat created.");
}

async function addInvestors(rawPortfolioId) {
  const portfolioId = positiveSafeInteger(rawPortfolioId);
  const portfolio = assignedPortfolio(portfolioId);
  const conversationId = positiveSafeInteger(portfolio?.conversation?.id);
  if (
    !portfolioId
    || !conversationId
    || portfolio.actions?.can_add_investors !== true
  ) {
    setStatus(
      portfolio?.actions?.add_disabled_reason || "Investors cannot be added to this chat.",
      "error",
    );
    return false;
  }
  syncSelectionFromDom("add", portfolioId);
  const interestIds = [...selectionFor("add", portfolioId)]
    .map(positiveSafeInteger)
    .filter((interestId) => interestId !== null);
  if (!interestIds.length) {
    setStatus("Please select at least one interested investor.", "error");
    return false;
  }
  return runMutation(`add:${conversationId}`, async () => {
    await API.addManagedInvestors(conversationId, interestIds);
    state.selectedAddInterests.delete(String(portfolioId));
  }, "Selected investors were added to the managed chat.");
}

async function removeInvestor(rawConversationId, rawInvestorId) {
  if (state.stale || state.pending.size > 0) return false;
  const conversationId = positiveSafeInteger(rawConversationId);
  const investorId = positiveSafeInteger(rawInvestorId);
  const portfolio = portfolioForConversation(conversationId);
  const investor = Array.isArray(portfolio?.participants)
    ? portfolio.participants.find((participant) => (
        participant.role === "investor"
        && positiveSafeInteger(participant.id) === investorId
      ))
    : null;
  if (!conversationId || !investorId || !portfolio || !investor) return false;
  const confirmed = window.confirm(
    `Remove ${investor.name} from the managed chat for ${portfolio.name}?`,
  );
  if (!confirmed) return false;
  return runMutation(`remove:${conversationId}:${investorId}`, async () => {
    await API.removeManagedInvestor(conversationId, investorId);
  }, `${investor.name} was removed from the managed chat.`);
}

function detailFields(record, excludedKeys = []) {
  if (!record || typeof record !== "object") return "";
  const excluded = new Set(excludedKeys);
  return Object.entries(record)
    .filter(([key, value]) => (
      !excluded.has(key)
      && (value === null || ["string", "number", "boolean"].includes(typeof value))
    ))
    .map(([key, value]) => `
      <div class="rm-detail-field">
        <dt>${escapeHtml(displayLabel(key))}</dt>
        <dd>${escapeHtml(displayValue(value))}</dd>
      </div>`)
    .join("");
}

function detailList(title, items, renderItem) {
  return `
    <section class="rm-detail-section">
      <h3>${escapeHtml(title)}</h3>
      ${items.length
        ? `<div class="rm-detail-list">${items.map(renderItem).join("")}</div>`
        : '<p class="rm-empty-copy">None.</p>'}
    </section>`;
}

function renderPortfolioDetails(portfolio) {
  const portfolioId = positiveSafeInteger(portfolio.id);
  const interests = Array.isArray(portfolio.interests) ? portfolio.interests : [];
  const participants = Array.isArray(portfolio.participants) ? portfolio.participants : [];
  const documents = Array.isArray(portfolio.documents) ? portfolio.documents : [];
  document.getElementById("portfolio-detail-card").innerHTML = `
    <header class="rm-detail-header">
      <div>
        <p class="rm-eyebrow">Read-only assigned portfolio</p>
        <h2 id="portfolio-detail-title">${escapeHtml(portfolio.name)}</h2>
        <p>Portfolio information is managed by the business owner.</p>
      </div>
      <button class="rm-detail-close"
              type="button"
              data-action="close-detail"
              aria-label="Close portfolio details">
        <i class="ti ti-x" aria-hidden="true"></i>
      </button>
    </header>

    <section class="rm-detail-section">
      <h3>Portfolio fields</h3>
      <dl class="rm-detail-grid">
        ${detailFields(portfolio, [
          "owner",
          "conversation",
          "interests",
          "participants",
          "documents",
          "actions",
        ])}
      </dl>
    </section>

    <section class="rm-detail-section">
      <h3>Owner</h3>
      <dl class="rm-detail-grid">${detailFields(portfolio.owner)}</dl>
    </section>

    <section class="rm-detail-section">
      <h3>Conversation</h3>
      ${portfolio.conversation
        ? `<dl class="rm-detail-grid">${detailFields(portfolio.conversation)}</dl>`
        : '<p class="rm-empty-copy">Chat not started.</p>'}
    </section>

    ${detailList("Interested investors", interests, (interest) => `
      <article class="rm-detail-list-item">
        <dl class="rm-detail-grid">
          ${detailFields(interest, ["investor"])}
          ${detailFields(interest.investor)}
        </dl>
      </article>`)}

    ${detailList("Active participants", participants, (participant) => `
      <article class="rm-detail-list-item">
        <dl class="rm-detail-grid">${detailFields(participant)}</dl>
      </article>`)}

    <section class="rm-detail-section">
      <h3>Documents</h3>
      ${documents.length
        ? `<div class="rm-document-list">${documents.map((document) => {
            const documentId = positiveSafeInteger(document.id);
            return `
              <article class="rm-detail-list-item">
                <dl class="rm-detail-grid">${detailFields(document, ["download_url"])}</dl>
                ${documentId && portfolioId ? `
                  <button class="btn btn-outline"
                          type="button"
                          data-action="download"
                          data-portfolio-id="${portfolioId}"
                          data-document-id="${documentId}">
                    <i class="ti ti-download" aria-hidden="true"></i>
                    Download ${escapeHtml(document.file_name)}
                  </button>` : ""}
              </article>`;
          }).join("")}</div>`
        : '<p class="rm-empty-copy">No documents have been uploaded.</p>'}
    </section>

    <section class="rm-detail-section">
      <h3>Available actions</h3>
      <dl class="rm-detail-grid">${detailFields(portfolio.actions)}</dl>
    </section>

    <div class="rm-detail-feedback"
         id="portfolio-detail-feedback"
         role="status"
         aria-live="polite"></div>`;
}

function setDetailOverlayOpen(open) {
  const overlay = document.getElementById("portfolio-detail-overlay");
  overlay.classList.toggle("open", open);
  overlay.setAttribute("aria-hidden", String(!open));
  for (const id of ["skip-link", "relationship-manager-nav", "main-content"]) {
    const backgroundRegion = document.getElementById(id);
    if (backgroundRegion) backgroundRegion.inert = open;
  }
}

function renderDetailLoading() {
  document.getElementById("portfolio-detail-card").innerHTML = `
    <button class="rm-detail-close rm-detail-loading-close"
            type="button"
            data-action="close-detail"
            aria-label="Close portfolio details">
      <i class="ti ti-x" aria-hidden="true"></i>
    </button>
    <div class="rm-detail-loading" role="status" aria-live="polite">
      <i class="ti ti-loader-2" aria-hidden="true"></i>
      <h2 id="portfolio-detail-title">Loading portfolio details…</h2>
      <p>Retrieving the latest assigned information.</p>
    </div>`;
}

function renderDetailError(message) {
  document.getElementById("portfolio-detail-card").innerHTML = `
    <div class="rm-detail-loading" role="alert">
      <i class="ti ti-alert-triangle" aria-hidden="true"></i>
      <h2 id="portfolio-detail-title">Couldn't display portfolio details</h2>
      <p>${escapeHtml(message)}</p>
      <div class="rm-card-actions">
        <button class="btn btn-outline" type="button" data-action="close-detail">Close</button>
        <button class="btn btn-primary" type="button" data-action="retry-detail">Try again</button>
      </div>
    </div>`;
}

async function openPortfolioDetails(rawPortfolioId, trigger = null) {
  const portfolioId = positiveSafeInteger(rawPortfolioId);
  if (!portfolioId || !assignedPortfolio(portfolioId)) {
    setStatus("That assigned portfolio is no longer available.", "error", true);
    return false;
  }
  const requestVersion = ++state.detailRequestVersion;
  state.detailPortfolio = null;
  state.detailTrigger = trigger;
  renderDetailLoading();
  setDetailOverlayOpen(true);
  document.getElementById("portfolio-detail-card").focus();
  try {
    const portfolio = await API.getAssignedPortfolio(portfolioId);
    if (requestVersion !== state.detailRequestVersion) return false;
    if (
      !portfolio
      || typeof portfolio !== "object"
      || positiveSafeInteger(portfolio.id) !== portfolioId
      || !Array.isArray(portfolio.documents)
    ) {
      throw new Error("The server returned incomplete portfolio details.");
    }
    state.detailPortfolio = portfolio;
    renderPortfolioDetails(portfolio);
    return true;
  } catch (error) {
    if (requestVersion !== state.detailRequestVersion) return false;
    renderDetailError(error.message || "Portfolio details are unavailable.");
    return false;
  }
}

function closePortfolioDetails() {
  const overlay = document.getElementById("portfolio-detail-overlay");
  if (!overlay.classList.contains("open")) return false;
  state.detailRequestVersion += 1;
  state.detailPortfolio = null;
  setDetailOverlayOpen(false);
  document.getElementById("portfolio-detail-card").innerHTML = "";
  const trigger = state.detailTrigger;
  state.detailTrigger = null;
  if (trigger && !trigger.disabled) trigger.focus();
  return true;
}

async function retryPortfolioDetails() {
  const portfolioId = positiveSafeInteger(
    state.detailPortfolio?.id
    || state.dashboard?.portfolios.find(
      (portfolio) => positiveSafeInteger(portfolio.id)
        === positiveSafeInteger(state.detailTrigger?.dataset?.portfolioId),
    )?.id
    || state.detailTrigger?.dataset?.portfolioId,
  );
  if (!portfolioId) return false;
  return openPortfolioDetails(portfolioId, state.detailTrigger);
}

async function downloadPortfolioDocument(rawPortfolioId, rawDocumentId) {
  const portfolioId = positiveSafeInteger(rawPortfolioId);
  const documentId = positiveSafeInteger(rawDocumentId);
  if (!portfolioId || !documentId) return false;
  const portfolio = positiveSafeInteger(state.detailPortfolio?.id) === portfolioId
    ? state.detailPortfolio
    : assignedPortfolio(portfolioId);
  const documentRecord = Array.isArray(portfolio?.documents)
    ? portfolio.documents.find(
        (document) => positiveSafeInteger(document.id) === documentId,
      )
    : null;
  if (!documentRecord) return false;
  try {
    await API.downloadDocument(documentRecord.download_url, documentRecord.file_name);
    return true;
  } catch (error) {
    const detailFeedback = document.getElementById("portfolio-detail-feedback");
    if (
      detailFeedback
      && document.getElementById("portfolio-detail-overlay").classList.contains("open")
    ) {
      detailFeedback.textContent = `Couldn't download document: ${error.message}`;
      detailFeedback.className = "rm-detail-feedback error";
    } else {
      setStatus(`Couldn't download document: ${error.message}`, "error");
    }
    return false;
  }
}

function openGroupChat(rawConversationId) {
  const conversationId = positiveSafeInteger(rawConversationId);
  if (!conversationId || !portfolioForConversation(conversationId)) return false;
  window.location.href = `messages.html?conversationId=${conversationId}`;
  return true;
}

function trapDetailFocus(event) {
  const card = document.getElementById("portfolio-detail-card");
  const focusable = [...card.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && !element.disabled);
  if (!focusable.length) {
    event.preventDefault();
    card.focus();
    return;
  }

  const currentIndex = focusable.indexOf(document.activeElement);
  const movingBeforeFirst = event.shiftKey && currentIndex <= 0;
  const movingPastLast = !event.shiftKey && (
    currentIndex === -1 || currentIndex === focusable.length - 1
  );
  if (!movingBeforeFirst && !movingPastLast) return;

  event.preventDefault();
  (movingBeforeFirst ? focusable.at(-1) : focusable[0]).focus();
}

async function handleDashboardAction(button) {
  const action = button.dataset.action;
  if (action === "create") {
    return createConversation(button.dataset.portfolioId);
  }
  if (action === "add") {
    return addInvestors(button.dataset.portfolioId);
  }
  if (action === "remove") {
    return removeInvestor(button.dataset.conversationId, button.dataset.investorId);
  }
  if (action === "details") {
    return openPortfolioDetails(button.dataset.portfolioId, button);
  }
  if (action === "download") {
    return downloadPortfolioDocument(
      button.dataset.portfolioId,
      button.dataset.documentId,
    );
  }
  if (action === "open-chat") {
    return openGroupChat(button.dataset.conversationId);
  }
  return false;
}

function bindDashboardEvents() {
  if (state.eventsBound) return;
  state.eventsBound = true;
  document.getElementById("dashboard-retry").addEventListener("click", loadDashboard);
  document.getElementById("main-content").addEventListener("change", (event) => {
    const input = event.target.closest("input[data-selection]");
    if (!input) return;
    syncSelectionFromDom(input.dataset.selection, input.dataset.portfolioId);
    renderDashboard();
  });
  document.getElementById("main-content").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    await handleDashboardAction(button);
  });
  document.getElementById("portfolio-detail-overlay").addEventListener(
    "click",
    async (event) => {
      const action = event.target.dataset?.action;
      if (action === "close-detail") {
        closePortfolioDetails();
        return;
      }
      const button = event.target.closest?.("button[data-action]");
      if (!button || button.disabled) return;
      if (button.dataset.action === "close-detail") closePortfolioDetails();
      else if (button.dataset.action === "retry-detail") await retryPortfolioDetails();
      else if (button.dataset.action === "download") {
        await downloadPortfolioDocument(
          button.dataset.portfolioId,
          button.dataset.documentId,
        );
      }
    },
  );
  document.addEventListener("keydown", (event) => {
    const detailOpen = document
      .getElementById("portfolio-detail-overlay")
      .classList.contains("open");
    if (!detailOpen) return;
    if (event.key === "Tab") trapDetailFocus(event);
    else if (event.key === "Escape") closePortfolioDetails();
  });
}

async function initRelationshipManagerDashboard() {
  setStatus("Verifying relationship manager access…", "loading");
  state.user = await requirePageRole("relationship_manager");
  if (!state.user) return false;
  renderUser();
  bindDashboardEvents();
  return loadDashboard();
}

document.addEventListener("DOMContentLoaded", initRelationshipManagerDashboard);
