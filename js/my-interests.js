function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function positiveSafeInteger(value) {
  if (typeof value === "string" && !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function managedChatAction(portfolio) {
  const conversationId = positiveSafeInteger(portfolio.conversation_id);
  if (conversationId && portfolio.chat_state === "open") {
    return `<a class="btn-action btn-chat" href="messages.html?conversation=${conversationId}"><i class="ti ti-messages"></i> Open Managed Chat</a>`;
  }
  if (conversationId && portfolio.chat_state === "archived") {
    return `<a class="btn-action btn-chat-archived" href="messages.html?conversation=${conversationId}"><i class="ti ti-archive"></i> View Archived Chat</a>`;
  }
  if (["removed", "withdrawn"].includes(portfolio.chat_state)) {
    return `<span class="chat-awaiting"><i class="ti ti-user-off"></i> Chat access is no longer available</span>`;
  }
  const guidance = portfolio.relationship_manager_id
    ? "Awaiting relationship manager to create group chat"
    : "Awaiting relationship manager assignment";
  return `<span class="chat-awaiting"><i class="ti ti-clock"></i> ${guidance}</span>`;
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
        <div style="width:72px;height:72px;border-radius:50%;background:var(--pink-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <i class="ti ti-heart-off" style="font-size:32px;color:var(--pink-text);display:block;margin:0;"></i>
        </div>
        <h3>No interests yet</h3>
        <p>Browse startups and express interest to see them here.</p>
        <button onclick="window.location.href='browse.html'" style="margin:16px auto 0;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 28px;background:var(--logo-purple);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;"><i class="ti ti-search"></i> Browse Startups</button>
      </div>`;
    return;
  }

  list.innerHTML = interests.map((p) => {
    const portfolioId = positiveSafeInteger(p.id);
    if (!portfolioId) return "";
    const readinessScore = normalizeReadinessScore(p.readiness_score);
    return `
    <div class="interest-card" id="interest-${portfolioId}">
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
        <button class="btn-action btn-remove" onclick="removeInterest(${portfolioId})" id="remove-${portfolioId}">
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
  const id = positiveSafeInteger(portfolioId);
  if (!id) return false;
  const btn = document.getElementById(`remove-${id}`);
  btn.disabled = true;
  btn.innerHTML = `<i class="ti ti-loader-2"></i> Removing...`;
  try {
    await API.removeInterest(id);
    interests = interests.filter((portfolio) => positiveSafeInteger(portfolio.id) !== id);
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

  document.getElementById("investor-nav").hidden = false;
  document.getElementById("user-avatar").innerText = user.name[0].toUpperCase();
  document.getElementById("user-name").innerText = user.name;
  initRoleMenu();
  bindInterestEvents();
  await loadInterests();
}

init();
