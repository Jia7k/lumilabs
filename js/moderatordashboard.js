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
let activeReviewId = null; // portfolio id currently open in the review modal

async function initAdmin() {
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

  document.getElementById("page-title").innerText = "Moderation Dashboard";
  document.getElementById("page-subtitle").innerText = "Review and manage startup portfolios";

  await renderAdmin();
}

async function renderAdmin() {
  let stats;
  try {
    stats = await API.getStats();
    currentQueue = await API.getQueue();
  } catch (err) {
    alert("Couldn't load dashboard data: " + err.message);
    return;
  }

  document.getElementById("nav-pending-badge").innerText = stats.pending;
  document.getElementById("stat-pending").innerText = stats.pending;
  document.getElementById("stat-approved").innerText = stats.approved;
  document.getElementById("stat-rejected").innerText = stats.rejected;
  document.getElementById("stat-matches").innerText = stats.total_matches;
  document.getElementById("queue-badge").innerText = `${stats.pending} pending`;

  const tbody = document.getElementById("queue-list");
  tbody.innerHTML = "";
  currentQueue.forEach(p => {
    const submitted = formatSubmitted(p.submitted_at);
    tbody.innerHTML += `
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
            <div class="score-circle" style="--score:${p.readiness_score};"><span>${p.readiness_score}</span></div>
            ${isScoreStale(p) ? `<i class="ti ti-alert-triangle" style="color:#F59E0B;font-size:15px;" title="Score may be outdated — new readiness fields are empty"></i>` : ""}
          </div>
        </td>
        <td><button class="btn-review" onclick="openReviewModal(${p.id})"><i class="ti ti-eye"></i> Review</button></td>
      </tr>
    `;
  });
}

async function openReviewModal(id) {
  const p = currentQueue.find(item => item.id === id);
  if (!p) return;
  activeReviewId = id;

  document.getElementById("review-card").innerHTML = `<p class="modal-subtitle">Loading...</p>`;
  document.getElementById("review-overlay").classList.add("open");

  let full;
  try {
    full = await API.getPortfolio(id);
  } catch (err) {
    alert("Couldn't load portfolio details: " + err.message);
    closeReviewModal();
    return;
  }

  document.getElementById("review-card").innerHTML = `
    <div class="modal-header-row">
      <div class="modal-title-group">
        <h2>${escapeHtml(full.name)}</h2>
        <span class="badge-yellow">Pending Review</span>
      </div>
      <button class="modal-close-btn" onclick="closeReviewModal()"><i class="ti ti-x"></i></button>
    </div>
    <p class="modal-subtitle">Review all portfolio details before making a decision</p>

    <div class="modal-readiness">
      <div class="score-circle" style="--score:${full.readiness_score}; width:48px; height:48px; font-size:15px;"><span>${full.readiness_score}</span></div>
      <div>
        <div class="readiness-label">Readiness <button class="score-info-btn" onclick="showScoreInfo()" title="How is this calculated?"><i class="ti ti-info-circle"></i></button></div>
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
        <div class="modal-field-value">${full.user_count != null ? full.user_count.toLocaleString() : "—"}</div>
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
      <button class="btn-reject-outline" onclick="openRejectPopup()"><i class="ti ti-x"></i> Reject</button>
      <button class="btn-approve-solid" onclick="handleApprove()"><i class="ti ti-circle-check"></i> Approve</button>
    </div>
  `;
}

function closeReviewModal() {
  activeReviewId = null;
  document.getElementById("review-overlay").classList.remove("open");
}

document.getElementById("review-overlay").addEventListener("click", (e) => {
  if (e.target.id === "review-overlay") closeReviewModal();
});

document.getElementById("review-card").addEventListener("click", async (event) => {
  const link = event.target.closest("[data-document-download]");
  if (!link) return;
  event.preventDefault();
  try {
    await API.downloadDocument(link.getAttribute("href"), link.dataset.fileName);
  } catch (error) {
    alert("Couldn't download document: " + error.message);
  }
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
