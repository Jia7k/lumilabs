async function getAdminData() {
  // Replace with actual API call later
  return {
    user: { name: "Victor", role: "Administrator" },
    pageDetails: { title: "Moderation Dashboard", subtitle: "Review and manage startup portfolios" },
    stats: { pending: 1, approved: 7, rejected: 3, totalMatches: 2 },
    queue: [
      {
        name: "Happi", owner: "Beta", industry: "Healthtech",
        submittedDate: "Jun 25, 2026", submittedTime: "10:42 AM",
        status: "Pending Review", score: 80,
        mvpStatus: "Prototype", fundingGoal: "$100,000", teamSize: 5,
        location: "Singapore", website: null,
        description: "Happy company"
      }
    ]
  };
}

// Everything below is in plain JS variables. This is just to get the modal working first
let currentData = null; // Set by initAdmin(), holds { user, pageDetails, stats, queue }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str ?? "";
  return div.innerHTML;
}

async function initAdmin() {
  currentData = await getAdminData();
  renderAdmin();
}

function renderAdmin() {
  const data = currentData;

  document.getElementById("user-avatar").innerText = data.user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = data.user.name;
  document.getElementById("user-role").innerText = data.user.role;

  document.getElementById("page-title").innerText = data.pageDetails.title;
  document.getElementById("page-subtitle").innerText = data.pageDetails.subtitle;

  document.getElementById("nav-pending-badge").innerText = data.stats.pending;
  document.getElementById("stat-pending").innerText = data.stats.pending;
  document.getElementById("stat-approved").innerText = data.stats.approved;
  document.getElementById("stat-rejected").innerText = data.stats.rejected;
  document.getElementById("stat-matches").innerText = data.stats.totalMatches;
  document.getElementById("queue-badge").innerText = `${data.stats.pending} pending`;

  const tbody = document.getElementById("queue-list");
  tbody.innerHTML = "";
  data.queue.forEach((item, index) => {
    tbody.innerHTML += `
        <tr>
          <td>
            <div class="startup-cell">
              <div class="startup-icon"><i class="ti ti-building"></i></div>
              <div>
                <div class="startup-name">${item.name}</div>
                <div class="startup-owner">${item.owner}</div>
              </div>
            </div>
          </td>
          <td>${item.industry}</td>
          <td>
            <div>${item.submittedDate}</div>
            <div style="color: var(--text-secondary); font-size: 12px;">${item.submittedTime}</div>
          </td>
          <td>
            <div class="status-wrapper">
              <span class="badge-yellow">${item.status}</span>
              <i class="ti ti-alert-triangle" style="color: var(--amber-text)"></i>
            </div>
          </td>
          <td><div class="score-circle" style="--score:${item.score};"><span>${item.score}</span></div></td>
          <td><button class="btn-review" onclick="openReviewModal(${index})"><i class="ti ti-eye"></i> Review</button></td>
        </tr>
      `;
  });
}

// Review modal
let activeReviewIndex = null;

function openReviewModal(index) {
  const p = currentData.queue[index];
  if (!p) return;
  activeReviewIndex = index;

  document.getElementById("review-card").innerHTML = `
        <div class="modal-header-row">
          <div class="modal-title-group">
            <h2>${escapeHtml(p.name)}</h2>
            <span class="badge-yellow">${escapeHtml(p.status)}</span>
          </div>
          <button class="modal-close-btn" onclick="closeReviewModal()"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Review all portfolio details before making a decision</p>

        <div class="modal-readiness">
          <div class="score-circle" style="--score:${p.score}; width:48px; height:48px; font-size:15px;"><span>${p.score}</span></div>
          <div>
            <div class="readiness-label">Readiness</div>
            <div class="readiness-score">${p.score}/100</div>
          </div>
        </div>

        <div class="modal-fields-grid">
          <div>
            <div class="modal-field-label">Industry</div>
            <div class="modal-field-value">${escapeHtml(p.industry)}</div>
          </div>
          <div>
            <div class="modal-field-label">MVP Status</div>
            <div class="modal-field-value">${escapeHtml(p.mvpStatus)}</div>
          </div>
          <div>
            <div class="modal-field-label">Funding Goal</div>
            <div class="modal-field-value">${escapeHtml(p.fundingGoal)}</div>
          </div>
          <div>
            <div class="modal-field-label">Team Size</div>
            <div class="modal-field-value">${escapeHtml(p.teamSize)}</div>
          </div>
          <div>
            <div class="modal-field-label">Location</div>
            <div class="modal-field-value">${escapeHtml(p.location)}</div>
          </div>
          <div>
            <div class="modal-field-label">Website</div>
            <div class="modal-field-value ${p.website ? "" : "muted"}">${p.website ? escapeHtml(p.website) : "Not specified"}</div>
          </div>
          <div class="modal-field-full">
            <div class="modal-field-label">Description</div>
            <div class="modal-field-value" style="font-weight:400;">${escapeHtml(p.description)}</div>
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
  activeReviewIndex = null;
  document.getElementById("review-overlay").classList.remove("open");
}

document.getElementById("review-overlay").addEventListener("click", (e) => {
  if (e.target.id === "review-overlay") closeReviewModal();
});

function handleApprove() {
  if (activeReviewIndex === null) return;
  currentData.queue.splice(activeReviewIndex, 1);
  currentData.stats.pending -= 1;
  currentData.stats.approved += 1;
  closeReviewModal();
  renderAdmin();
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

document.getElementById("reason-confirm-btn").addEventListener("click", () => {
  if (activeReviewIndex === null) return;
  // Reason is captured but not stored anywhere yet — just to close out the flow
  const reason = document.getElementById("reason-textarea").value;
  currentData.queue.splice(activeReviewIndex, 1);
  currentData.stats.pending -= 1;
  currentData.stats.rejected += 1;
  closeRejectPopup();
  closeReviewModal();
  renderAdmin();
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