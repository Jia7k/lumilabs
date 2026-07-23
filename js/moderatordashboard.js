function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatFunding(n) {
  if (n == null) return "—";
  n = Number(n);
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(0) + "K";
  return "$" + n;
}

function isScoreStale(p) {
  return p.monthly_revenue == null && p.user_count == null && p.growth_rate == null &&
    p.market_size == null && p.competitor_analysis == null && p.advisor_names == null &&
    p.burn_rate == null && p.runway_months == null;
}

function formatSubmitted(iso) {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  };
}

let currentUser = null;
let currentQueue = [];
let relationshipManagers = [];
let activeReviewId = null; // portfolio id currently open in the review modal
let currentStats = null;
let hasModerationSnapshot = false;
let hasManagerSnapshot = false;
let moderationRequestVersion = 0;
let managerRequestVersion = 0;
let managerCreateInFlight = false;
let reviewRequestVersion = 0;
let reviewLoadInFlight = false;
let activeReviewTrigger = null;
let activeReviewPortfolio = null;
let decisionInFlight = false;

function normalizePortfolioId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function setRmFieldError(inputId, message) {
  const input = document.getElementById(inputId);
  const group = input.closest(".form-group");
  group.classList.toggle("has-error", Boolean(message));
  document.getElementById(`${inputId}-error`).textContent = message;
}

function setRmFormMessage(message, type = "") {
  const element = document.getElementById("rm-form-message");
  element.textContent = message;
  element.className = message ? `form-message show ${type}` : "form-message";
}

function renderRelationshipManagers(managers = relationshipManagers) {
  const list = document.getElementById("rm-account-list");
  document.getElementById("rm-account-count").textContent =
    `${managers.length} ${managers.length === 1 ? "account" : "accounts"}`;
  if (!managers.length) {
    list.innerHTML = '<tr class="rm-empty-row"><td colspan="3">No relationship manager accounts yet.</td></tr>';
    return;
  }
  list.innerHTML = managers.map((manager) => {
    const created = manager.created_at
      ? new Date(manager.created_at).toLocaleDateString("en-SG", {
        day: "numeric", month: "short", year: "numeric"
      })
      : "—";
    return `
      <tr>
        <td>
          <span class="rm-account-name">${escapeHtml(manager.name)}</span>
          <span class="rm-account-role">${escapeHtml(manager.role.replaceAll("_", " "))}</span>
        </td>
        <td>${escapeHtml(manager.email)}</td>
        <td>${escapeHtml(created)}</td>
      </tr>`;
  }).join("");
}

function setSectionStatus(statusId, retryId, message, {
  type = "",
  retryable = false,
  loading = false,
} = {}) {
  const status = document.getElementById(statusId);
  const retry = document.getElementById(retryId);
  if (status) {
    status.textContent = message;
    status.className = `dashboard-status admin-dashboard-status${type ? ` ${type}` : ""}`;
    status.hidden = !message;
  }
  if (retry) {
    retry.hidden = !retryable;
    retry.disabled = loading;
  }
}

function renderStats(stats) {
  const values = stats
    ? {
        "nav-pending-badge": stats.pending,
        "stat-pending": stats.pending,
        "stat-approved": stats.approved,
        "stat-rejected": stats.rejected,
        "stat-matches": stats.total_matches,
        "queue-badge": `${stats.pending} pending`,
      }
    : {
        "nav-pending-badge": "",
        "stat-pending": "—",
        "stat-approved": "—",
        "stat-rejected": "—",
        "stat-matches": "—",
        "queue-badge": "Unavailable",
      };

  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).innerText = value;
  }
}

function queueStateRow(message, type = "") {
  return `<tr class="admin-row-state${type ? ` ${type}` : ""}"><td colspan="6">${escapeHtml(message)}</td></tr>`;
}

function renderQueue(queue, { reviewDisabled = false } = {}) {
  const tbody = document.getElementById("queue-list");
  if (!queue.length) {
    tbody.innerHTML = queueStateRow("No portfolios are waiting for review.");
    return;
  }

  tbody.innerHTML = queue.map((p) => {
    const submitted = formatSubmitted(p.submitted_at);
    return `
      <tr>
        <td>
          <div class="startup-cell">
            <div class="startup-icon"><i class="ti ti-building"></i></div>
            <div>
              <div class="startup-name">${escapeHtml(p.name)}</div>
              <div class="startup-owner">${escapeHtml(p.owner_name)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(p.sector)}</td>
        <td>
          <div>${submitted.date}</div>
          <div style="color: var(--text-secondary); font-size: 12px;">${submitted.time}</div>
        </td>
        <td>
          <div class="status-wrapper">
            <span class="badge-yellow">Pending Review</span>
            <i class="ti ti-alert-triangle" style="color: var(--amber-text)"></i>
          </div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <div class="score-circle" style="--score:${Number(p.readiness_score) || 0};"><span>${escapeHtml(p.readiness_score ?? 0)}</span></div>
            ${isScoreStale(p) ? '<i class="ti ti-alert-triangle" style="color:#F59E0B;font-size:15px;" title="Score may be outdated — new readiness fields are empty"></i>' : ""}
          </div>
        </td>
        <td>
          <button class="btn-review"
                  data-portfolio-id="${escapeHtml(p.id)}"
                  type="button"
                  ${reviewDisabled ? "disabled" : ""}>
            <i class="ti ti-eye"></i> Review
          </button>
        </td>
      </tr>`;
  }).join("");
}

function renderModerationSnapshot(stats, queue, options = {}) {
  renderStats(stats);
  renderQueue(queue, options);
}

function bindRelationshipManagerForm() {
  const form = document.getElementById("rm-account-form");
  const rmSubmit = document.getElementById("rm-submit");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (managerCreateInFlight) return;

    const name = document.getElementById("rm-name");
    const email = document.getElementById("rm-email");
    const password = document.getElementById("rm-password");
    const cleanName = name.value.trim();
    const cleanEmail = email.value.trim();
    let valid = true;

    setRmFormMessage("");
    setRmFieldError("rm-name", "");
    setRmFieldError("rm-email", "");
    setRmFieldError("rm-password", "");
    if (!cleanName) {
      setRmFieldError("rm-name", "Full name is required.");
      valid = false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setRmFieldError("rm-email", "Enter a valid email address.");
      valid = false;
    }
    if (password.value.length < 6 || password.value.length > 128) {
      setRmFieldError("rm-password", "Use between 6 and 128 characters.");
      valid = false;
    }
    if (!valid) {
      setRmFormMessage("Please fix the highlighted fields.", "error");
      return;
    }

    managerCreateInFlight = true;
    rmSubmit.disabled = true;
    rmSubmit.innerHTML = '<i class="ti ti-loader-2"></i> Creating account…';
    try {
      await API.createRelationshipManager({
        name: cleanName,
        email: cleanEmail,
        password: password.value,
      });
      password.value = "";
    } catch (error) {
      setRmFormMessage(error.message, "error");
      return;
    } finally {
      managerCreateInFlight = false;
      rmSubmit.disabled = false;
      rmSubmit.innerHTML = '<i class="ti ti-user-plus"></i> Create manager account';
    }

    const refreshed = await loadManagerDirectory({
      successMessage: "Manager directory updated.",
      failureMessage: "Account created, but the manager directory could not refresh.",
    });
    setRmFormMessage(
      refreshed
        ? "Relationship manager account created."
        : "Relationship manager account created, but the directory could not refresh.",
      "success",
    );
  });
}

async function initAdmin() {
  currentUser = await requirePageRole("admin");
  if (!currentUser) return;

  document.getElementById("user-avatar").innerText = currentUser.name[0].toUpperCase();
  document.getElementById("user-name").innerText = currentUser.name;
  document.getElementById("user-role").innerText = currentUser.role
    .replace("_", " ")
    .replace(/\b\w/g, c => c.toUpperCase());

  document.getElementById("page-title").innerText = "Moderation Dashboard";
  document.getElementById("page-subtitle").innerText = "Review and manage startup portfolios";

  bindRelationshipManagerForm();
  document.getElementById("moderation-retry-btn")
    ?.addEventListener("click", () => loadModeration());
  document.getElementById("manager-directory-retry-btn")
    ?.addEventListener("click", () => loadManagerDirectory());
  document.getElementById("queue-list").addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-portfolio-id]");
    if (!trigger || trigger.disabled) return;
    await openReviewModal(trigger.dataset.portfolioId, trigger);
  });
  await renderAdmin();
}

async function loadModeration({
  successMessage = "",
  failureMessage = "Couldn't load moderation data. Try again.",
} = {}) {
  const requestVersion = ++moderationRequestVersion;
  const hadSnapshot = hasModerationSnapshot;
  setSectionStatus(
    "moderation-status",
    "moderation-retry-btn",
    hadSnapshot ? "Refreshing moderation data…" : "Loading moderation data…",
    { type: "loading", loading: true },
  );
  if (hadSnapshot) {
    renderModerationSnapshot(currentStats, currentQueue, { reviewDisabled: true });
  } else {
    renderStats(null);
    document.getElementById("queue-list").innerHTML = queueStateRow("Loading portfolios…");
  }

  try {
    const [nextStats, nextQueue] = await Promise.all([API.getStats(), API.getQueue()]);
    if (requestVersion !== moderationRequestVersion) return false;
    if (!nextStats || typeof nextStats !== "object" || !Array.isArray(nextQueue)) {
      throw new Error("Invalid moderation response");
    }
    currentStats = nextStats;
    currentQueue = nextQueue;
    hasModerationSnapshot = true;
    renderModerationSnapshot(currentStats, currentQueue);
    setSectionStatus(
      "moderation-status",
      "moderation-retry-btn",
      successMessage,
      { type: successMessage ? "success" : "" },
    );
    return true;
  } catch (error) {
    if (requestVersion !== moderationRequestVersion) return false;
    if (hadSnapshot) {
      renderModerationSnapshot(currentStats, currentQueue, { reviewDisabled: true });
      setSectionStatus(
        "moderation-status",
        "moderation-retry-btn",
        `${failureMessage} Showing the last loaded data.`,
        { type: "stale", retryable: true },
      );
    } else {
      renderStats(null);
      document.getElementById("queue-list").innerHTML =
        queueStateRow("Couldn't load the moderation queue.", "error");
      setSectionStatus(
        "moderation-status",
        "moderation-retry-btn",
        failureMessage,
        { type: "error", retryable: true },
      );
    }
    return false;
  }
}

async function loadManagerDirectory({
  successMessage = "",
  failureMessage = "Couldn't load the manager directory. Try again.",
} = {}) {
  const requestVersion = ++managerRequestVersion;
  const hadSnapshot = hasManagerSnapshot;
  setSectionStatus(
    "manager-directory-status",
    "manager-directory-retry-btn",
    hadSnapshot ? "Refreshing manager directory…" : "Loading manager directory…",
    { type: "loading", loading: true },
  );
  if (!hadSnapshot) {
    document.getElementById("rm-account-list").innerHTML =
      '<tr class="rm-empty-row"><td colspan="3">Loading manager accounts…</td></tr>';
  }

  try {
    const managers = await API.getRelationshipManagers();
    if (requestVersion !== managerRequestVersion) return false;
    if (!Array.isArray(managers)) throw new Error("Invalid manager response");
    relationshipManagers = managers;
    hasManagerSnapshot = true;
    renderRelationshipManagers(relationshipManagers);
    setSectionStatus(
      "manager-directory-status",
      "manager-directory-retry-btn",
      successMessage,
      { type: successMessage ? "success" : "" },
    );
    return true;
  } catch (error) {
    if (requestVersion !== managerRequestVersion) return false;
    if (!hadSnapshot) {
      document.getElementById("rm-account-list").innerHTML =
        '<tr class="rm-empty-row"><td colspan="3">Manager directory unavailable.</td></tr>';
    }
    setSectionStatus(
      "manager-directory-status",
      "manager-directory-retry-btn",
      hadSnapshot ? `${failureMessage} Showing the last loaded directory.` : failureMessage,
      { type: hadSnapshot ? "stale" : "error", retryable: true },
    );
    return false;
  }
}

async function renderAdmin() {
  await Promise.allSettled([loadModeration(), loadManagerDirectory()]);
}

function setReviewOverlayOpen(open) {
  const overlay = document.getElementById("review-overlay");
  overlay.classList.toggle("open", open);
  overlay.setAttribute("aria-hidden", String(!open));
}

function renderReviewLoading() {
  document.getElementById("review-card").innerHTML = `
    <div class="modal-error-state" role="status" aria-live="polite">
      <h2>Loading portfolio…</h2>
      <p class="modal-subtitle">Retrieving the latest submitted details.</p>
    </div>`;
}

function renderReviewError(message) {
  document.getElementById("review-card").innerHTML = `
    <div class="modal-error-state" role="alert">
      <h2>Couldn't display this portfolio</h2>
      <p class="modal-subtitle">${escapeHtml(message)}</p>
      <div class="modal-error-actions">
        <button class="btn btn-outline"
                id="review-close"
                data-review-action="close"
                type="button">Close</button>
        <button class="btn btn-primary"
                id="review-retry"
                data-review-action="retry"
                type="button">Try again</button>
      </div>
    </div>`;
}

function validatePortfolioDetail(detail, expectedId) {
  if (
    !detail ||
    typeof detail !== "object" ||
    normalizePortfolioId(detail.id) !== expectedId ||
    !Array.isArray(detail.documents)
  ) {
    throw new Error("The server returned incomplete portfolio details.");
  }
}

async function loadReviewDetails(id) {
  if (reviewLoadInFlight) return false;
  const requestVersion = ++reviewRequestVersion;
  reviewLoadInFlight = true;
  renderReviewLoading();
  try {
    const detail = await API.getPortfolio(id);
    if (requestVersion !== reviewRequestVersion || activeReviewId !== id) return false;
    validatePortfolioDetail(detail, id);
    renderReviewDetails(detail, activeReviewPortfolio);
    return true;
  } catch (error) {
    if (requestVersion !== reviewRequestVersion || activeReviewId !== id) return false;
    renderReviewError(error.message || "Portfolio details are unavailable.");
    return false;
  } finally {
    if (requestVersion === reviewRequestVersion) reviewLoadInFlight = false;
  }
}

async function openReviewModal(rawId, trigger = null) {
  const id = normalizePortfolioId(rawId);
  const portfolio = currentQueue.find((item) => normalizePortfolioId(item.id) === id);
  if (!id || !portfolio) {
    setSectionStatus(
      "moderation-status",
      "moderation-retry-btn",
      "That portfolio is no longer available in the moderation queue.",
      { type: "error", retryable: true },
    );
    return false;
  }

  activeReviewId = id;
  activeReviewPortfolio = portfolio;
  activeReviewTrigger = trigger;
  renderReviewLoading();
  setReviewOverlayOpen(true);
  document.getElementById("review-card").focus();
  return loadReviewDetails(id);
}

function renderReviewDetails(full, p) {
  document.getElementById("review-card").innerHTML = `
    <div class="modal-header-row">
      <div class="modal-title-group">
        <h2>${escapeHtml(full.name)}</h2>
        <span class="badge-yellow">Pending Review</span>
      </div>
      <button class="modal-close-btn"
              data-review-action="close"
              type="button"
              aria-label="Close portfolio review">
        <i class="ti ti-x"></i>
      </button>
    </div>
    <p class="modal-subtitle">Review all portfolio details before making a decision</p>

    <div class="modal-readiness">
      <div class="score-circle" style="--score:${full.readiness_score}; width:48px; height:48px; font-size:15px;"><span>${full.readiness_score}</span></div>
      <div>
        <div class="readiness-label">
          Readiness
          <button class="score-info-btn"
                  data-review-action="score-info"
                  type="button"
                  title="How is this calculated?">
            <i class="ti ti-info-circle"></i>
          </button>
        </div>
        <div class="readiness-score">${full.readiness_score}/100</div>
      </div>
      ${isScoreStale(p) ? `
      <div class="score-stale-warning">
        <i class="ti ti-alert-triangle"></i>
        Score may be outdated — business owner hasn't filled in new readiness fields
      </div>` : ""}
    </div>

    <div class="modal-section-label">Company</div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Industry</div>
        <div class="modal-field-value">${escapeHtml(full.sector)}</div>
      </div>
      <div>
        <div class="modal-field-label">MVP Status</div>
        <div class="modal-field-value">${escapeHtml(full.mvp_status)}</div>
      </div>
      <div>
        <div class="modal-field-label">Funding Goal</div>
        <div class="modal-field-value">${formatFunding(full.funding_goal)}</div>
      </div>
      <div>
        <div class="modal-field-label">Location</div>
        <div class="modal-field-value ${full.location ? "" : "muted"}">${full.location ? escapeHtml(full.location) : "No location provided"}</div>
      </div>
      <div>
        <div class="modal-field-label">Website</div>
        <div class="modal-field-value ${full.website ? "" : "muted"}">${full.website ? escapeHtml(full.website) : "No website provided"}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Description</div>
        <div class="modal-field-value ${full.description ? "" : "muted"}">${full.description ? escapeHtml(full.description) : "No description provided"}</div>
        </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Documents</div>
        <div class="modal-field-value ${full.documents && full.documents.length > 0 ? "" : "muted"}">
          ${
            full.documents && full.documents.length > 0
              ? full.documents.map(d => `
                  <a href="${escapeHtml(d.download_url)}" data-document-download data-file-name="${escapeHtml(d.file_name)}"
                     style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                    <i class="ti ti-file"></i> ${escapeHtml(d.file_name)}
                  </a>
                `).join("")
              : `No documents uploaded`
          }
        </div>
      </div>
    </div>
    
    <div class="modal-section-label">Team <span class="modal-section-pts">25 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Team Size</div>
        <div class="modal-field-value ${full.team_size ? "" : "muted"}">${full.team_size ? escapeHtml(full.team_size) : "No team size provided"}</div>
      </div>
      <div>
        <div class="modal-field-label">Founded Year</div>
        <div class="modal-field-value">${full.founded_year ?? "—"}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Advisors / Notable Members</div>
        <div class="modal-field-value" style="font-weight:400;">${full.advisor_names ? escapeHtml(full.advisor_names) : "—"}</div>
      </div>
    </div>

    <div class="modal-section-label">Traction <span class="modal-section-pts">25 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Monthly Revenue</div>
        <div class="modal-field-value">${full.monthly_revenue != null ? formatFunding(full.monthly_revenue) : "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">Users / Customers</div>
        <div class="modal-field-value">${full.user_count != null ? Number(full.user_count).toLocaleString() : "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">MoM Growth</div>
        <div class="modal-field-value">${full.growth_rate != null ? full.growth_rate + "%" : "—"}</div>
      </div>
    </div>

    <div class="modal-section-label">Market <span class="modal-section-pts">20 pts</span></div>
    <div class="modal-fields-grid">
      <div class="modal-field-full">
        <div class="modal-field-label">Target Market Size</div>
        <div class="modal-field-value" style="font-weight:400;">${full.market_size ? escapeHtml(full.market_size) : "—"}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Competitor Analysis</div>
        <div class="modal-field-value" style="font-weight:400;">${full.competitor_analysis ? escapeHtml(full.competitor_analysis) : "—"}</div>
      </div>
    </div>

    <div class="modal-section-label">Financials <span class="modal-section-pts">15 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Monthly Burn Rate</div>
        <div class="modal-field-value">${full.burn_rate != null ? formatFunding(full.burn_rate) : "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">Runway</div>
        <div class="modal-field-value">${full.runway_months != null ? full.runway_months + " months" : "—"}</div>
      </div>
    </div>

    <div class="modal-footer">
      <div class="modal-action-status"
           id="review-action-status"
           role="status"
           aria-live="polite"></div>
      <button class="btn-reject-outline"
              id="review-reject-btn"
              data-review-action="reject"
              type="button">
        <i class="ti ti-x"></i> Reject
      </button>
      <button class="btn-approve-solid"
              id="review-approve-btn"
              data-review-action="approve"
              type="button">
        <i class="ti ti-circle-check"></i> Approve
      </button>
    </div>
  `;
}

function closeReviewModal() {
  if (decisionInFlight) return false;
  reviewRequestVersion += 1;
  reviewLoadInFlight = false;
  activeReviewId = null;
  activeReviewPortfolio = null;
  setReviewOverlayOpen(false);
  document.getElementById("review-card").innerHTML = "";
  const trigger = activeReviewTrigger;
  activeReviewTrigger = null;
  if (trigger && !trigger.disabled) trigger.focus();
  return true;
}

document.getElementById("review-overlay").addEventListener("click", (e) => {
  if (e.target.id === "review-overlay") closeReviewModal();
});

document.getElementById("review-card").addEventListener("click", async (event) => {
  const download = event.target.closest("[data-document-download]");
  if (download) {
    event.preventDefault();
    try {
      await API.downloadDocument(download.getAttribute("href"), download.dataset.fileName);
    } catch (error) {
      const status = document.getElementById("review-action-status");
      if (status) {
        status.textContent = `Couldn't download document: ${error.message}`;
        status.className = "modal-action-status error";
      }
    }
    return;
  }

  const control = event.target.closest("[data-review-action]");
  if (!control || control.disabled) return;
  const action = control.dataset.reviewAction;
  if (action === "close") closeReviewModal();
  else if (action === "retry" && activeReviewId !== null) await loadReviewDetails(activeReviewId);
  else if (action === "score-info") showScoreInfo();
  else if (action === "approve") await handleApprove();
  else if (action === "reject") openRejectPopup();
});

async function handleApprove() {
  if (activeReviewId === null) return;
  try {
    await API.approvePortfolio(activeReviewId);
    closeReviewModal();
    await renderAdmin();
  } catch (err) {
    alert("Couldn't approve portfolio: " + err.message);
  }
}

// Reject reason popup
function openRejectPopup() {
  document.getElementById("reason-textarea").value = "";
  document.getElementById("reason-overlay").classList.add("open");
  document.getElementById("reason-textarea").focus();
}

function closeRejectPopup() {
  document.getElementById("reason-overlay").classList.remove("open");
}

document.getElementById("reason-cancel-btn").addEventListener("click", closeRejectPopup);

document.getElementById("reason-overlay").addEventListener("click", (e) => {
  if (e.target.id === "reason-overlay") closeRejectPopup();
});

document.getElementById("reason-confirm-btn").addEventListener("click", async () => {
  if (activeReviewId === null) return;
  const reason = document.getElementById("reason-textarea").value.trim();
  if (!reason) {
    alert("Please provide a rejection reason.");
    return;
  }
  try {
    await API.rejectPortfolio(activeReviewId, reason);
    closeRejectPopup();
    closeReviewModal();
    await renderAdmin();
  } catch (err) {
    alert("Couldn't reject portfolio: " + err.message);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("reason-overlay").classList.contains("open")) {
    closeRejectPopup();
  } else if (document.getElementById("review-overlay").classList.contains("open")) {
    closeReviewModal();
  }
});

initAdmin();
