const API_BASE = window.LUMILABS_API_BASE || '/api';

const state = {
  token: '',
  user: null,
  conversations: [],
  active: null,
  messages: [],
  search: '',
  selectionVersion: 0,
  sending: false,
};

const els = {};

document.addEventListener('DOMContentLoaded', initMessages);

async function initMessages() {
  cacheElements();
  bindEvents();

  state.token = getAuthToken();
  if (!state.token) {
    window.location.href = 'signin.html';
    return;
  }

  try {
    const user = await apiFetch('/messages/me');
    state.user = {
      id: user.id,
      name: user.name,
      role: user.role,
      roleLabel: roleLabel(user.role),
    };
  } catch (err) {
    console.error(err);
    clearMessageSession();
    window.location.href = 'signin.html';
    return;
  }

  renderUser();
  const conversationsLoaded = await loadConversations();
  if (!conversationsLoaded) {
    renderLoadError('Messages are temporarily unavailable.');
    return;
  }

  const starter = getStarterConversation();
  if (starter) {
    upsertConversation(starter, true);
  }

  renderConversations();

  const firstConversation = starter || state.conversations[0];
  if (firstConversation) {
    await selectConversation(firstConversation.partner_id);
  } else {
    renderEmptyThread();
  }
}

function cacheElements() {
  els.businessNav = document.getElementById('business-nav');
  els.investorNav = document.getElementById('investor-nav');
  els.navMsgBadge = document.getElementById('nav-msg-badge');
  els.roleMenu = document.getElementById('role-menu');
  els.roleMenuButton = document.getElementById('role-menu-button');
  els.userAvatar = document.getElementById('user-avatar');
  els.userName = document.getElementById('user-name');
  els.userRole = document.getElementById('user-role');
  els.modeLabel = document.getElementById('mode-label');
  els.refreshBtn = document.getElementById('refresh-btn');
  els.unreadCount = document.getElementById('unread-count');
  els.search = document.getElementById('conversation-search');
  els.conversationList = document.getElementById('conversation-list');
  els.threadAvatar = document.getElementById('thread-avatar');
  els.threadTitle = document.getElementById('thread-title');
  els.threadSubtitle = document.getElementById('thread-subtitle');
  els.threadStatus = document.getElementById('thread-status');
  els.messageList = document.getElementById('message-list');
  els.messageForm = document.getElementById('message-form');
  els.messageInput = document.getElementById('message-input');
  els.sendBtn = document.getElementById('send-btn');
  els.toast = document.getElementById('toast');
}

function bindEvents() {
  els.roleMenuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = els.roleMenu.classList.toggle('open');
    els.roleMenuButton.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', () => closeRoleMenu());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeRoleMenu();
    }
  });

  els.refreshBtn.addEventListener('click', async () => {
    if (!state.user) return;
    const refreshed = await loadConversations();
    if (refreshed) {
      renderConversations();
      showToast('Conversations refreshed');
    }
  });

  els.search.addEventListener('input', () => {
    state.search = els.search.value.trim().toLowerCase();
    renderConversations();
  });

  els.conversationList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-partner-id]');
    if (!button) return;
    await selectConversation(button.dataset.partnerId);
  });

  els.messageForm.addEventListener('submit', sendActiveMessage);
}

function renderLoadError(message) {
  setComposeEnabled(false);
  els.modeLabel.textContent = message;
  els.unreadCount.textContent = '0';
  updateUnreadIndicators(0);
  els.conversationList.innerHTML = `
    <div class="empty-state">
      <i class="ti ti-alert-circle"></i>
      <div class="empty-title">Messages unavailable</div>
      <div>Please try Refresh or sign in again.</div>
    </div>
  `;
  renderEmptyThread();
}

function renderUser() {
  const user = state.user;

  const isInvestor = user.role === 'investor';
  const isBusinessOwner = user.role === 'business_owner' || !isInvestor;

  document.body.classList.toggle('role-business-owner', isBusinessOwner);
  document.body.classList.toggle('role-investor', isInvestor);
  renderRoleNav(user.role);
  els.userAvatar.textContent = initials(user.name);
  els.userName.textContent = user.name;
  els.userRole.textContent = user.roleLabel;
  els.modeLabel.textContent = 'Conversations with investors and business owners.';
}

function renderRoleNav(role) {
  const isInvestor = role === 'investor';
  els.businessNav.hidden = isInvestor;
  els.investorNav.hidden = role !== 'investor';
}

function closeRoleMenu() {
  els.roleMenu.classList.remove('open');
  els.roleMenuButton.setAttribute('aria-expanded', 'false');
}

async function loadConversations() {
  try {
    const rows = await apiFetch('/messages/conversations');
    state.conversations = rows.map(normalizeConversation);
    return true;
  } catch (err) {
    console.error(err);
    showToast('Could not load conversations');
    state.conversations = [];
    return false;
  }
}

function normalizeConversation(row) {
  return {
    partner_id: String(row.partner_id),
    partner_name: row.partner_name || 'Unknown user',
    partner_role: row.partner_role || '',
    partner_role_label: roleLabel(row.partner_role),
    portfolio_id: row.portfolio_id ? String(row.portfolio_id) : '',
    portfolio_name: row.portfolio_name || '',
    content: row.content || '',
    created_at: row.created_at || new Date().toISOString(),
    unread_count: Number(row.unread_count) || 0,
    sender_id: row.sender_id ? String(row.sender_id) : '',
  };
}

function getStarterConversation() {
  const params = new URLSearchParams(window.location.search);
  const partnerId = params.get('partnerId') || params.get('receiver_id');
  const numericPartnerId = Number(partnerId);

  if (!Number.isInteger(numericPartnerId) || numericPartnerId <= 0 || sameId(numericPartnerId, state.user.id)) {
    return null;
  }

  const partnerName = params.get('partnerName') || params.get('receiverName') || `User ${numericPartnerId}`;
  const portfolioId = params.get('portfolioId') || params.get('portfolio_id') || '';
  const portfolioName = params.get('portfolioName') || params.get('portfolio') || '';

  return {
    partner_id: String(numericPartnerId),
    partner_name: partnerName,
    partner_role: params.get('partnerRole') || '',
    partner_role_label: roleLabel(params.get('partnerRole') || ''),
    portfolio_id: portfolioId ? String(portfolioId) : '',
    portfolio_name: portfolioName,
    content: '',
    created_at: new Date().toISOString(),
    unread_count: 0,
    sender_id: '',
  };
}

function upsertConversation(conversation, toTop = false) {
  const index = state.conversations.findIndex((item) => sameId(item.partner_id, conversation.partner_id));
  if (index >= 0) {
    state.conversations[index] = { ...state.conversations[index], ...conversation };
    if (toTop) {
      const [item] = state.conversations.splice(index, 1);
      state.conversations.unshift(item);
    }
    return;
  }

  if (toTop) {
    state.conversations.unshift(conversation);
  } else {
    state.conversations.push(conversation);
  }
}

function renderConversations() {
  const filtered = state.conversations.filter((conversation) => {
    if (!state.search) return true;
    const haystack = [
      conversation.partner_name,
      conversation.partner_role_label,
      conversation.portfolio_name,
      conversation.content,
    ].join(' ').toLowerCase();
    return haystack.includes(state.search);
  });

  const unreadTotal = state.conversations.reduce((total, conversation) => {
    return total + (Number(conversation.unread_count) || 0);
  }, 0);
  updateUnreadIndicators(unreadTotal);

  if (filtered.length === 0) {
    els.conversationList.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-inbox"></i>
        <div class="empty-title">No conversations yet</div>
        <div>Open a user thread to start messaging.</div>
      </div>
    `;
    return;
  }

  els.conversationList.innerHTML = filtered.map((conversation) => {
    const activeClass = state.active && sameId(conversation.partner_id, state.active.partner_id) ? ' active' : '';
    const unread = Number(conversation.unread_count) || 0;
    const previewPrefix = sameId(conversation.sender_id, state.user.id) ? 'You: ' : '';
    const portfolio = conversation.portfolio_name
      ? `<span><i class="ti ti-briefcase"></i> ${escapeHtml(conversation.portfolio_name)}</span>`
      : '';

    return `
      <button class="conversation-item${activeClass}" type="button" data-partner-id="${escapeHtml(conversation.partner_id)}">
        <div class="conversation-avatar">${escapeHtml(initials(conversation.partner_name))}</div>
        <div class="conversation-main">
          <div class="conversation-top">
            <div class="conversation-name">${escapeHtml(conversation.partner_name)}</div>
            <div class="conversation-time">${escapeHtml(formatShortTime(conversation.created_at))}</div>
          </div>
          <div class="conversation-preview">${escapeHtml(previewPrefix + (conversation.content || 'New conversation'))}</div>
          <div class="conversation-meta">
            <span>${escapeHtml(conversation.partner_role_label || roleLabel(conversation.partner_role))}</span>
            ${portfolio}
          </div>
        </div>
        ${unread ? `<span class="unread-dot">${unread}</span>` : '<span></span>'}
      </button>
    `;
  }).join('');
}

function updateUnreadIndicators(unreadTotal) {
  els.unreadCount.textContent = unreadTotal;

  if (!els.navMsgBadge) return;

  if (unreadTotal > 0) {
    els.navMsgBadge.textContent = unreadTotal > 99 ? '99+' : unreadTotal;
    els.navMsgBadge.style.display = 'flex';
  } else {
    els.navMsgBadge.textContent = '';
    els.navMsgBadge.style.display = 'none';
  }
}

async function selectConversation(partnerId) {
  if (state.sending) return;
  const conversation = state.conversations.find((item) => sameId(item.partner_id, partnerId));
  if (!conversation) return;
  const selectionVersion = ++state.selectionVersion;

  state.active = conversation;
  renderActiveHeader();
  setComposeEnabled(true);

  try {
    const rows = await apiFetch(`/messages/conversations/${encodeURIComponent(partnerId)}`);
    if (selectionVersion !== state.selectionVersion) return;
    const conversationRows = await apiFetch('/messages/conversations');
    if (selectionVersion !== state.selectionVersion) return;

    state.messages = rows.map(normalizeMessage);
    state.conversations = conversationRows.map(normalizeConversation);
    state.active.unread_count = 0;
    state.active = state.conversations.find((item) => sameId(item.partner_id, partnerId)) || state.active;
    if (state.active) state.active.unread_count = 0;
    renderThread();
    renderConversations();
    renderActiveHeader();
  } catch (err) {
    if (selectionVersion !== state.selectionVersion) return;
    console.error(err);
    showToast('Could not open this conversation');
    state.messages = [];
    renderThread();
  }
}

function normalizeMessage(row) {
  return {
    id: row.id,
    sender_id: String(row.sender_id),
    receiver_id: String(row.receiver_id),
    sender_name: row.sender_name || 'Unknown user',
    content: row.content || '',
    portfolio_id: row.portfolio_id ? String(row.portfolio_id) : '',
    portfolio_name: row.portfolio_name || '',
    read_at: row.read_at || null,
    created_at: row.created_at || new Date().toISOString(),
  };
}

function renderActiveHeader() {
  if (!state.active) {
    els.threadAvatar.textContent = '?';
    els.threadTitle.textContent = 'Select a conversation';
    els.threadSubtitle.textContent = 'Choose someone from your inbox to start messaging.';
    els.threadStatus.textContent = 'Ready';
    return;
  }

  const active = state.active;
  els.threadAvatar.textContent = initials(active.partner_name);
  els.threadTitle.textContent = active.partner_name;
  els.threadSubtitle.textContent = active.portfolio_name
    ? `${active.partner_role_label || roleLabel(active.partner_role)} about ${active.portfolio_name}`
    : active.partner_role_label || roleLabel(active.partner_role);
  els.threadStatus.textContent = 'Database';
}

function renderThread() {
  if (!state.active) {
    renderEmptyThread();
    return;
  }

  if (state.messages.length === 0) {
    els.messageList.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-message-plus"></i>
        <div class="empty-title">Start the conversation</div>
        <div>Send the first message to ${escapeHtml(state.active.partner_name)}.</div>
      </div>
    `;
    return;
  }

  els.messageList.innerHTML = state.messages.map((message) => {
    const mine = sameId(message.sender_id, state.user.id);
    return `
      <div class="message-row${mine ? ' mine' : ''}">
        <div class="message-bubble">
          <div>${escapeHtml(message.content)}</div>
          <div class="message-meta">${escapeHtml(mine ? 'You' : message.sender_name)} · ${escapeHtml(formatLongTime(message.created_at))}</div>
        </div>
      </div>
    `;
  }).join('');

  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function renderEmptyThread() {
  setComposeEnabled(false);
  renderActiveHeader();
  els.messageList.innerHTML = `
    <div class="empty-state">
      <i class="ti ti-message-circle"></i>
      <div class="empty-title">No conversation selected</div>
      <div>Pick a thread to view messages.</div>
    </div>
  `;
}

async function reloadActiveConversationFromDatabase(partnerId) {
  const selectionVersion = state.selectionVersion;
  const messageRows = await apiFetch(
    `/messages/conversations/${encodeURIComponent(partnerId)}`
  );
  const conversationRows = await apiFetch('/messages/conversations');
  if (
    selectionVersion !== state.selectionVersion
    || !state.active
    || !sameId(state.active.partner_id, partnerId)
  ) {
    return false;
  }

  state.messages = messageRows.map(normalizeMessage);
  state.conversations = conversationRows.map(normalizeConversation);
  state.active = state.conversations.find(
    (conversation) => sameId(conversation.partner_id, partnerId)
  ) || state.active;
  if (state.active) state.active.unread_count = 0;

  renderThread();
  renderConversations();
  renderActiveHeader();
  return true;
}

async function sendActiveMessage(event) {
  event.preventDefault();
  if (!state.active) return;

  const content = els.messageInput.value.trim();
  if (!content) return;

  const receiverId = Number(state.active.partner_id);
  const portfolioId = state.active.portfolio_id ? Number(state.active.portfolio_id) : null;

  if (!Number.isInteger(receiverId) || receiverId <= 0) {
    showToast('Invalid receiver');
    return;
  }

  setSending(true);

  try {
    let saved;
    try {
      saved = await apiFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: receiverId,
          content,
          portfolio_id: Number.isInteger(portfolioId) ? portfolioId : null,
        }),
      });
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Message could not be sent');
      return;
    }

    state.messages.push(normalizeMessage({
      ...saved,
      sender_name: state.user.name,
      portfolio_name: state.active.portfolio_name,
    }));
    els.messageInput.value = '';
    renderThread();
    showToast('Message sent');

    try {
      await reloadActiveConversationFromDatabase(receiverId);
    } catch (err) {
      console.error(err);
      showToast('Message saved, but conversation could not be refreshed');
    }
  } finally {
    setSending(false);
  }
}

function setComposeEnabled(enabled) {
  els.messageInput.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
}

function setSending(isSending) {
  state.sending = isSending;
  els.messageInput.disabled = isSending;
  els.sendBtn.disabled = isSending;
  els.sendBtn.innerHTML = isSending
    ? '<i class="ti ti-loader-2"></i> Sending'
    : '<i class="ti ti-send"></i> Send';
}

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.error
      || payload?.errors?.[0]?.msg
      || 'API request failed';
    throw new Error(message);
  }

  return payload;
}

function getAuthToken() {
  return localStorage.getItem('lumilabsToken') || '';
}

function clearMessageSession() {
  localStorage.removeItem('lumilabsToken');
  localStorage.removeItem('lumilabsUser');
  localStorage.removeItem('lumilabsSelectedUser');
}

function signOutMessages() {
  clearMessageSession();
  window.location.href = 'signin.html';
}

function roleLabel(role) {
  const labels = {
    business_owner: 'Business Owner',
    investor: 'Investor',
    admin: 'Administrator',
  };
  return labels[role] || role || 'User';
}

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';
}

function sameId(a, b) {
  return String(a) === String(b);
}

function formatShortTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(undefined, isToday
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(date);
}

function formatLongTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2200);
}
