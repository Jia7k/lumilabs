function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str ?? "";
  return div.innerHTML;
}

function formatFunding(n) {
  if (n == null) return "—";
  n = Number(n);
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(0) + "K";
  return "$" + n;
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
        <td><div class="score-circle" style="--score:${p.readiness_score};"><span>${p.readiness_score}</span></div></td>
        <td><button class="btn-review" onclick="openReviewModal(${p.id})"><i class="ti ti-eye"></i> Review</button></td>
      </tr>
    `;
  });
}

function openReviewModal(id) {
  const p = currentQueue.find(item => item.id === id);
  if (!p) return;
  activeReviewId = id;

  document.getElementById("review-card").innerHTML = `
    <div class="modal-header-row">
      <div class="modal-title-group">
        <h2>${escapeHtml(p.name)}</h2>
        <span class="badge-yellow">Pending Review</span>
      </div>
      <button class="modal-close-btn" onclick="closeReviewModal()"><i class="ti ti-x"></i></button>
    </div>
    <p class="modal-subtitle">Review all portfolio details before making a decision</p>

    <div class="modal-readiness">
      <div class="score-circle" style="--score:${p.readiness_score}; width:48px; height:48px; font-size:15px;"><span>${p.readiness_score}</span></div>
      <div>
        <div class="readiness-label">Readiness</div>
        <div class="readiness-score">${p.readiness_score}/100</div>
      </div>
    </div>

    <div class="modal-section-label">Company</div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Industry</div>
        <div class="modal-field-value">${escapeHtml(p.sector)}</div>
      </div>
      <div>
        <div class="modal-field-label">MVP Status</div>
        <div class="modal-field-value">${escapeHtml(p.mvp_status)}</div>
      </div>
      <div>
        <div class="modal-field-label">Funding Goal</div>
        <div class="modal-field-value">${formatFunding(p.funding_goal)}</div>
      </div>
      <div>
        <div class="modal-field-label">Location</div>
        <div class="modal-field-value">${p.location ? escapeHtml(p.location) : "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">Website</div>
        <div class="modal-field-value ${p.website ? "" : "muted"}">${p.website ? escapeHtml(p.website) : "Not specified"}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Description</div>
        <div class="modal-field-value" style="font-weight:400;">${p.description ? escapeHtml(p.description) : "—"}</div>
      </div>
    </div>

    <div class="modal-section-label">Team <span class="modal-section-pts">25 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Team Size</div>
        <div class="modal-field-value">${p.team_size ?? "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">Founded Year</div>
        <div class="modal-field-value">${p.founded_year ?? "—"}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Advisors / Notable Members</div>
        <div class="modal-field-value" style="font-weight:400;">${p.advisor_names ? escapeHtml(p.advisor_names) : "—"}</div>
      </div>
    </div>

    <div class="modal-section-label">Traction <span class="modal-section-pts">25 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Monthly Revenue</div>
        <div class="modal-field-value">${p.monthly_revenue != null ? formatFunding(p.monthly_revenue) : "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">Users / Customers</div>
        <div class="modal-field-value">${p.user_count != null ? p.user_count.toLocaleString() : "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">MoM Growth</div>
        <div class="modal-field-value">${p.growth_rate != null ? p.growth_rate + "%" : "—"}</div>
      </div>
    </div>

    <div class="modal-section-label">Market <span class="modal-section-pts">20 pts</span></div>
    <div class="modal-fields-grid">
      <div class="modal-field-full">
        <div class="modal-field-label">Target Market Size</div>
        <div class="modal-field-value" style="font-weight:400;">${p.market_size ? escapeHtml(p.market_size) : "—"}</div>
      </div>
      <div class="modal-field-full">
        <div class="modal-field-label">Competitor Analysis</div>
        <div class="modal-field-value" style="font-weight:400;">${p.competitor_analysis ? escapeHtml(p.competitor_analysis) : "—"}</div>
      </div>
    </div>

    <div class="modal-section-label">Financials <span class="modal-section-pts">15 pts</span></div>
    <div class="modal-fields-grid">
      <div>
        <div class="modal-field-label">Monthly Burn Rate</div>
        <div class="modal-field-value">${p.burn_rate != null ? formatFunding(p.burn_rate) : "—"}</div>
      </div>
      <div>
        <div class="modal-field-label">Runway</div>
        <div class="modal-field-value">${p.runway_months != null ? p.runway_months + " months" : "—"}</div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-reject-outline" onclick="openRejectPopup()"><i class="ti ti-x"></i> Reject</button>
      <button class="btn-approve-solid" onclick="handleApprove()"><i class="ti ti-circle-check"></i> Approve</button>
    </div>
  `;

  document.getElementById("review-overlay").classList.add("open");
}

function closeReviewModal() {
  activeReviewId = null;
  document.getElementById("review-overlay").classList.remove("open");
}

document.getElementById("review-overlay").addEventListener("click", (e) => {
  if (e.target.id === "review-overlay") closeReviewModal();
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