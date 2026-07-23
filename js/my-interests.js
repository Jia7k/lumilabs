function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function managedChatAction(portfolio) {
  const conversationId = Number(portfolio.conversation_id);
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "open") {
    return `<a class="managed-chat-action" href="messages.html?conversationId=${conversationId}"><i class="ti ti-messages"></i> Open Managed Chat</a>`;
  }
  if (Number.isInteger(conversationId) && conversationId > 0 && portfolio.chat_state === "archived") {
    return `<a class="managed-chat-action managed-chat-archived" href="messages.html?conversationId=${conversationId}"><i class="ti ti-archive"></i> View Archived Chat</a>`;
  }
  return `<span class="managed-chat-awaiting"><i class="ti ti-clock"></i> Awaiting Relationship Manager</span>`;
}

function formatFunding(n) {
  n = Number(n);
  if (isNaN(n)) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

let interests = [];
let interestsLoading = false;
let interestEventsBound = false;

function render() {
  document.getElementById("count-badge").innerText = interests.length;
  const list = document.getElementById("interests-list");

  if (!interests.length) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-heart-off"></i>
        <h3>No interests yet</h3>
        <p>Browse startups and express interest to see them here.</p>
        <button class="btn-browse" onclick="window.location.href='browse.html'" style="margin:16px auto 0; display:inline-flex;">
          <i class="ti ti-search"></i> Browse Startups
        </button>
      </div>`;
    return;
  }

  list.innerHTML = interests.map((p) => {
    const readinessScore = normalizeReadinessScore(p.readiness_score);
    return `
    <div class="interest-card" id="interest-${p.id}">
      <div class="interest-icon"><i class="ti ti-briefcase"></i></div>
      <div class="interest-info">
        <div class="interest-name">${escapeHtml(p.name)}</div>
        <div class="interest-meta">
          <span class="sector-tag">${escapeHtml(p.sector)}</span>
          <span class="score-tag">${readinessScore}/100</span>
          <span>${formatFunding(p.funding_goal)}</span>
          <span>by ${escapeHtml(p.owner_name)}</span>
        </div>
        <div class="interest-date">Interested since ${formatDate(p.interested_at)}</div>
      </div>
      <div class="interest-actions">
        ${managedChatAction(p)}
        <button class="btn-action btn-remove" onclick="removeInterest(${p.id})" id="remove-${p.id}">
          <i class="ti ti-heart-off"></i> Remove
        </button>
      </div>
    </div>
  `;
  }).join("");
}

function renderInterestsError(error) {
  document.getElementById("interests-list").innerHTML = `
    <div class="empty-state" role="alert">
      <i class="ti ti-alert-circle"></i>
      <h3>Couldn't load interests</h3>
      <p>${escapeHtml(error.message || "Please retry")}</p>
      <button class="btn-browse" type="button" data-retry-interests>Retry</button>
    </div>`;
}

function bindInterestEvents() {
  if (interestEventsBound) return;
  interestEventsBound = true;
  document.getElementById("interests-list").addEventListener("click", (event) => {
    if (event.target.closest("[data-retry-interests]")) loadInterests();
  });
}

async function loadInterests() {
  if (interestsLoading) return false;
  interestsLoading = true;
  try {
    interests = await API.getMyInterests();
    render();
    return true;
  } catch (error) {
    renderInterestsError(error);
    return false;
  } finally {
    interestsLoading = false;
  }
}

async function removeInterest(portfolioId) {
  const btn = document.getElementById(`remove-${portfolioId}`);
  btn.disabled = true;
  btn.innerHTML = `<i class="ti ti-loader-2"></i> Removing...`;
  try {
    await API.removeInterest(portfolioId);
    interests = interests.filter(p => p.id !== portfolioId);
    render();
  } catch (err) {
    alert("Could not remove interest: " + err.message);
    btn.disabled = false;
    btn.innerHTML = `<i class="ti ti-heart-off"></i> Remove`;
  }
}

function initRoleMenu() {
  const menu = document.getElementById("role-menu");
  const button = document.getElementById("role-menu-button");
  if (!menu || !button) return;
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", () => menu.classList.remove("open"));
}

async function init() {
  const user = await requirePageRole("investor");
  if (!user) return;

  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;
  initRoleMenu();
  bindInterestEvents();
  await loadInterests();
}

init();
