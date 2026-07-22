const ROLE_LABELS = Object.freeze({
  business_owner: 'Business Owner',
  investor: 'Investor',
  relationship_manager: 'Relationship Manager',
  admin: 'Administrator',
});

const ARCHIVE_REASON_LABELS = Object.freeze({
  manual: 'The relationship manager archived this conversation.',
  no_active_investors: 'There are no active investors in this conversation.',
  portfolio_unapproved: 'The portfolio is no longer approved for an active conversation.',
  portfolio_deleted: 'The portfolio was removed. This history is retained for reference.',
});

const state = {
  user: null,
  conversations: [],
  activeConversationId: null,
  activeThread: null,
  search: '',
  selectionVersion: 0,
  sending: false,
};

const els = {};
let conversationLoadVersion = 0;
let lastConversationLoadError = null;
let toastTimer = null;
let eventsBound = false;

document.addEventListener('DOMContentLoaded', initMessages);

async function initMessages() {
  cacheElements();
  bindEvents();
  await loadMessagesWorkspace();
}

async function loadMessagesWorkspace() {
  try {
    const user = await apiFetch('/messages/me');
    state.user = {
      id: String(user.id),
      name: user.name || 'Lumi5 Labs user',
      role: user.role,
      roleLabel: roleLabel(user.role),
    };
    renderUser();

    const loaded = await loadConversations();
    if (!loaded) {
      if (lastConversationLoadError?.status !== 401) {
        renderLoadError('Messages are temporarily unavailable.');
      }
      return false;
    }

    renderConversations();
    await selectInitialConversation();
    return true;
  } catch (error) {
    console.error(error);
    if (error?.status !== 401) {
      renderLoadError(
        error?.isNetworkError
          ? 'Messages could not be reached. Check your connection and retry.'
          : 'Messages are temporarily unavailable.',
      );
    }
    return false;
  }
}

function cacheElements() {
  els.businessNav = document.getElementById('business-nav');
  els.investorNav = document.getElementById('investor-nav');
  els.relationshipManagerNav = document.getElementById('relationship-manager-nav');
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
  els.threadParticipants = document.getElementById('thread-participants');
  els.threadStatus = document.getElementById('thread-status');
  els.messageList = document.getElementById('message-list');
  els.archiveNotice = document.getElementById('archive-notice');
  els.messageForm = document.getElementById('message-form');
  els.messageInput = document.getElementById('message-input');
  els.sendBtn = document.getElementById('send-btn');
  els.toast = document.getElementById('toast');
}

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  els.roleMenuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = els.roleMenu.classList.toggle('open');
    els.roleMenuButton.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', closeRoleMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeRoleMenu();
  });

  els.refreshBtn.addEventListener('click', refreshMessages);

  els.search.addEventListener('input', () => {
    state.search = els.search.value.trim().toLowerCase();
    renderConversations();
  });

  els.conversationList.addEventListener('click', async (event) => {
    const retry = event.target.closest('[data-retry-messages]');
    if (retry) {
      await loadMessagesWorkspace();
      return;
    }

    const button = event.target.closest('[data-conversation-id]');
    if (!button) return;
    await selectConversation(button.dataset.conversationId);
  });

  els.messageForm.addEventListener('submit', sendActiveMessage);
}

function renderLoadError(message) {
  state.selectionVersion += 1;
  conversationLoadVersion += 1;
  state.conversations = [];
  state.activeConversationId = null;
  state.activeThread = null;
  setComposeEnabled(false);
  els.modeLabel.textContent = message;
  els.unreadCount.textContent = '0';
  updateUnreadIndicators(0);
  els.conversationList.innerHTML = `
    <div class="empty-state">
      <i class="ti ti-alert-circle"></i>
      <div class="empty-title">Messages unavailable</div>
      <div>${escapeHtml(message)}</div>
      <button class="btn" type="button" data-retry-messages>Retry</button>
    </div>
  `;
  renderEmptyThread();
}

function renderUser() {
  const role = state.user.role;
  document.body.classList.toggle('role-business-owner', role === 'business_owner');
  document.body.classList.toggle('role-investor', role === 'investor');
  document.body.classList.toggle('role-relationship-manager', role === 'relationship_manager');
  renderRoleNav(role);
  els.userAvatar.textContent = initials(state.user.name);
  els.userName.textContent = state.user.name;
  els.userRole.textContent = state.user.roleLabel;
  els.modeLabel.textContent = 'Managed conversations for approved business opportunities.';
}

function renderRoleNav(role) {
  els.businessNav.hidden = role !== 'business_owner';
  els.investorNav.hidden = role !== 'investor';
  els.relationshipManagerNav.hidden = role !== 'relationship_manager';
}

function closeRoleMenu() {
  els.roleMenu.classList.remove('open');
  els.roleMenuButton.setAttribute('aria-expanded', 'false');
}

async function loadConversations(expectedSelectionVersion = null) {
  const loadVersion = ++conversationLoadVersion;
  lastConversationLoadError = null;
  try {
    const rows = await apiFetch('/messages/conversations');
    if (loadVersion !== conversationLoadVersion) return false;
    if (
      expectedSelectionVersion !== null
      && expectedSelectionVersion !== state.selectionVersion
    ) return false;
    state.conversations = rows.map(normalizeConversation);
    return true;
  } catch (error) {
    console.error(error);
    if (loadVersion === conversationLoadVersion) {
      lastConversationLoadError = error;
      if (error?.status !== 401) showToast('Could not load conversations');
    }
    return false;
  }
}

function normalizeParticipant(row = {}) {
  return {
    id: String(row.id ?? ''),
    name: row.name || 'Unknown user',
    role: row.role || '',
  };
}

function normalizeLatestMessage(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sender_id: String(row.sender_id ?? ''),
    sender_name: row.sender_name || 'Unknown user',
    content: row.content || '',
    created_at: row.created_at || '',
  };
}

function normalizeConversation(row = {}) {
  return {
    id: String(row.id ?? ''),
    portfolio_id: row.portfolio_id == null ? null : String(row.portfolio_id),
    title: row.title || 'Managed conversation',
    status: row.status || 'archived',
    archived_reason: row.archived_reason || null,
    can_send: Boolean(row.can_send),
    unread_count: Number(row.unread_count) || 0,
    participants: Array.isArray(row.participants)
      ? row.participants.map(normalizeParticipant)
      : [],
    latest_message: normalizeLatestMessage(row.latest_message),
  };
}

function normalizeMessage(row = {}) {
  return {
    id: Number(row.id),
    conversation_id: String(row.conversation_id ?? ''),
    sender_id: String(row.sender_id ?? ''),
    sender_name: row.sender_name || 'Unknown user',
    sender_role: row.sender_role || '',
    content: row.content || '',
    created_at: row.created_at || '',
  };
}

function normalizeThread(payload = {}) {
  const participants = Array.isArray(payload.participants)
    ? payload.participants.map(normalizeParticipant)
    : [];
  const conversation = normalizeConversation({
    ...(payload.conversation || {}),
    participants,
  });
  conversation.can_send = Boolean(payload.conversation?.can_send);
  return {
    conversation,
    participants,
    messages: Array.isArray(payload.messages) ? payload.messages.map(normalizeMessage) : [],
  };
}

function getStarterConversationId() {
  const params = new URLSearchParams(window.location.search);
  const requested = Number(params.get('conversationId'));
  return Number.isInteger(requested) && requested > 0 ? String(requested) : null;
}

async function selectInitialConversation() {
  const requestedId = getStarterConversationId();
  if (requestedId !== null) {
    const requested = state.conversations.find(({ id }) => sameId(id, requestedId));
    if (!requested) {
      showConversationUnavailable();
      return false;
    }
    return selectConversation(requested.id);
  }

  const firstConversation = state.conversations[0];
  if (!firstConversation) {
    renderEmptyThread();
    return true;
  }
  return selectConversation(firstConversation.id);
}

async function refreshMessages() {
  if (!state.user) return loadMessagesWorkspace();

  const previousConversationId = state.activeConversationId;
  const refreshVersion = ++state.selectionVersion;
  const loaded = await loadConversations(refreshVersion);
  if (!loaded) return false;

  renderConversations();
  if (previousConversationId !== null) {
    const stillAvailable = state.conversations.some(({ id }) => (
      sameId(id, previousConversationId)
    ));
    if (!stillAvailable) {
      showConversationUnavailable();
      return false;
    }
    const selected = await selectConversation(previousConversationId);
    if (selected) showToast('Conversations refreshed');
    return selected;
  }

  const selected = await selectInitialConversation();
  if (selected) showToast('Conversations refreshed');
  return selected;
}

function renderConversations() {
  const filtered = state.conversations.filter((conversation) => {
    if (!state.search) return true;
    const participantText = conversation.participants.map((participant) => (
      `${participant.name} ${roleLabel(participant.role)}`
    )).join(' ');
    const haystack = [
      conversation.title,
      participantText,
      conversation.latest_message?.content,
      conversation.latest_message?.sender_name,
    ].join(' ').toLowerCase();
    return haystack.includes(state.search);
  });

  const unreadTotal = state.conversations.reduce(
    (total, conversation) => total + conversation.unread_count,
    0,
  );
  updateUnreadIndicators(unreadTotal);

  if (!filtered.length) {
    els.conversationList.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-inbox"></i>
        <div class="empty-title">${state.search ? 'No matching conversations' : 'No managed conversations yet'}</div>
        <div>${state.search ? 'Try another search.' : 'A relationship manager creates rooms for approved opportunities.'}</div>
      </div>
    `;
    return;
  }

  els.conversationList.innerHTML = filtered.map((conversation) => {
    const activeClass = sameId(conversation.id, state.activeConversationId) ? ' active' : '';
    const latest = conversation.latest_message;
    const previewPrefix = latest && sameId(latest.sender_id, state.user.id) ? 'You: ' : '';
    const participantNames = conversation.participants
      .filter((participant) => !sameId(participant.id, state.user.id))
      .map((participant) => participant.name)
      .join(', ');

    return `
      <button class="conversation-item${activeClass}" type="button" data-conversation-id="${escapeHtml(conversation.id)}">
        <div class="conversation-avatar">${escapeHtml(initials(conversation.title))}</div>
        <div class="conversation-main">
          <div class="conversation-top">
            <div class="conversation-name">${escapeHtml(conversation.title)}</div>
            <div class="conversation-time">${escapeHtml(formatShortTime(latest?.created_at))}</div>
          </div>
          <div class="conversation-preview">${escapeHtml(previewPrefix + (latest?.content || 'No messages yet'))}</div>
          <div class="conversation-meta">
            <span><i class="ti ti-users"></i> ${escapeHtml(participantNames || 'Managed room')}</span>
            ${conversation.status === 'archived' ? '<span class="conversation-state">Archived</span>' : ''}
          </div>
        </div>
        ${conversation.unread_count ? `<span class="unread-dot">${conversation.unread_count}</span>` : '<span></span>'}
      </button>
    `;
  }).join('');
}

function updateUnreadIndicators(unreadTotal) {
  els.unreadCount.textContent = String(unreadTotal);
  if (!els.navMsgBadge) return;
  if (unreadTotal > 0) {
    els.navMsgBadge.textContent = unreadTotal > 99 ? '99+' : String(unreadTotal);
    els.navMsgBadge.style.display = 'flex';
  } else {
    els.navMsgBadge.textContent = '';
    els.navMsgBadge.style.display = 'none';
  }
}

async function selectConversation(conversationId) {
  if (state.sending) return false;
  const id = String(conversationId);
  const summary = state.conversations.find((conversation) => sameId(conversation.id, id));
  if (!summary) {
    showConversationUnavailable();
    return false;
  }

  const selectionVersion = ++state.selectionVersion;
  state.activeConversationId = id;
  state.activeThread = {
    conversation: { ...summary, can_send: false },
    participants: summary.participants,
    messages: [],
  };
  renderConversations();
  renderActiveHeader();
  renderThreadLoading();
  setComposeEnabled(false);
  hideArchiveNotice();

  try {
    const payload = await apiFetch(`/messages/conversations/${encodeURIComponent(id)}`);
    if (!selectionIsCurrent(selectionVersion, id)) return false;

    state.activeThread = normalizeThread(payload);
    renderActiveHeader();
    renderThread();
    applyConversationAvailability();

    const lastMessage = state.activeThread.messages.at(-1);
    if (lastMessage) {
      try {
        await apiFetch(`/messages/conversations/${encodeURIComponent(id)}/read`, {
          method: 'PUT',
          body: JSON.stringify({ message_id: lastMessage.id }),
        });
      } catch (error) {
        console.error(error);
        showToast('Messages loaded, but the unread count could not be updated');
      }
    }

    if (!selectionIsCurrent(selectionVersion, id)) return false;
    const listLoaded = await loadConversations(selectionVersion);
    if (!selectionIsCurrent(selectionVersion, id)) return false;
    if (listLoaded) {
      if (!syncActiveConversationSummary()) return false;
      renderConversations();
      renderActiveHeader();
    }
    return true;
  } catch (error) {
    if (!selectionIsCurrent(selectionVersion, id)) return false;
    console.error(error);
    showToast(error.message || 'Could not open this conversation');
    state.activeThread = null;
    renderThreadError();
    renderActiveHeader();
    setComposeEnabled(false);
    return false;
  }
}

function selectionIsCurrent(version, id) {
  return version === state.selectionVersion && sameId(id, state.activeConversationId);
}

function syncActiveConversationSummary() {
  if (!state.activeThread) return false;
  const summary = state.conversations.find(({ id }) => sameId(id, state.activeConversationId));
  if (!summary) {
    showConversationUnavailable();
    return false;
  }
  state.activeThread.conversation = {
    ...summary,
    ...state.activeThread.conversation,
    participants: state.activeThread.participants,
  };
  return true;
}

function showConversationUnavailable() {
  state.selectionVersion += 1;
  state.activeConversationId = null;
  state.activeThread = null;
  hideArchiveNotice();
  setComposeEnabled(false);

  if (state.user) renderConversations();
  els.threadAvatar.textContent = '!';
  els.threadTitle.textContent = 'Conversation unavailable';
  els.threadSubtitle.textContent = 'This managed room is no longer available to you.';
  els.threadParticipants.innerHTML = '';
  els.threadStatus.textContent = 'Unavailable';
  renderThreadError();
}

function renderActiveHeader() {
  if (!state.activeThread) {
    els.threadAvatar.textContent = '?';
    els.threadTitle.textContent = 'Select a conversation';
    els.threadSubtitle.textContent = 'Choose a managed room from your inbox.';
    els.threadParticipants.innerHTML = '';
    els.threadStatus.textContent = 'Ready';
    return;
  }

  const { conversation, participants } = state.activeThread;
  els.threadAvatar.textContent = initials(conversation.title);
  els.threadTitle.textContent = conversation.title;
  els.threadSubtitle.textContent = conversation.portfolio_id
    ? `Approved portfolio · Room ${conversation.id}`
    : 'Retained conversation history';
  els.threadParticipants.innerHTML = participants.map((participant) => `
    <span class="participant-chip" title="${escapeHtml(roleLabel(participant.role))}">
      <span class="participant-dot" aria-hidden="true"></span>
      ${escapeHtml(participant.name)}
      <span class="participant-role">${escapeHtml(roleLabel(participant.role))}</span>
    </span>
  `).join('');
  els.threadStatus.textContent = conversation.status === 'active' ? 'Managed conversation' : 'Archived';
}

function renderThread() {
  if (!state.activeThread) {
    renderEmptyThread();
    return;
  }

  const messages = state.activeThread.messages;
  if (!messages.length) {
    els.messageList.innerHTML = `
      <div class="empty-state">
        <i class="ti ti-message-plus"></i>
        <div class="empty-title">No messages yet</div>
        <div>Start the managed conversation when everyone is ready.</div>
      </div>
    `;
    return;
  }

  els.messageList.innerHTML = messages.map((message) => {
    const mine = sameId(message.sender_id, state.user.id);
    return `
      <div class="message-row${mine ? ' mine' : ''}">
        <div class="message-bubble">
          <div>${escapeHtml(message.content)}</div>
          <div class="message-meta">
            <span class="message-sender">${mine ? 'You' : escapeHtml(message.sender_name)}</span>
            <span>${escapeHtml(roleLabel(message.sender_role))}</span>
            <span aria-hidden="true">·</span>
            <time>${escapeHtml(formatLongTime(message.created_at))}</time>
          </div>
        </div>
      </div>
    `;
  }).join('');
  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function renderThreadLoading() {
  els.messageList.innerHTML = `
    <div class="empty-state">
      <i class="ti ti-loader-2"></i>
      <div class="empty-title">Loading conversation</div>
    </div>
  `;
}

function renderThreadError() {
  els.messageList.innerHTML = `
    <div class="empty-state">
      <i class="ti ti-alert-circle"></i>
      <div class="empty-title">Conversation unavailable</div>
      <div>Refresh the inbox and try again.</div>
    </div>
  `;
}

function renderEmptyThread() {
  setComposeEnabled(false);
  hideArchiveNotice();
  renderActiveHeader();
  els.messageList.innerHTML = `
    <div class="empty-state">
      <i class="ti ti-message-circle"></i>
      <div class="empty-title">No conversation selected</div>
      <div>Pick a managed room to view its messages.</div>
    </div>
  `;
}

function applyConversationAvailability() {
  const conversation = state.activeThread?.conversation;
  if (!conversation) {
    hideArchiveNotice();
    setComposeEnabled(false);
    return;
  }

  if (conversation.status === 'active' && conversation.can_send) {
    hideArchiveNotice();
    setComposeEnabled(true);
    return;
  }

  const reason = ARCHIVE_REASON_LABELS[conversation.archived_reason];
  els.archiveNotice.hidden = false;
  els.archiveNotice.className = 'archive-notice';
  els.archiveNotice.textContent = `This conversation is archived and is read-only.${reason ? ` ${reason}` : ''}`;
  setComposeEnabled(false);
}

function hideArchiveNotice() {
  if (!els.archiveNotice) return;
  els.archiveNotice.hidden = true;
  els.archiveNotice.textContent = '';
}

async function reloadActiveConversationFromDatabase(conversationId) {
  const id = String(conversationId);
  const selectionVersion = state.selectionVersion;
  const payload = await apiFetch(`/messages/conversations/${encodeURIComponent(id)}`);
  if (!selectionIsCurrent(selectionVersion, id)) return false;

  state.activeThread = normalizeThread(payload);
  renderThread();
  renderActiveHeader();
  applyConversationAvailability();

  const lastMessage = state.activeThread.messages.at(-1);
  if (lastMessage) {
    try {
      await apiFetch(`/messages/conversations/${encodeURIComponent(id)}/read`, {
        method: 'PUT',
        body: JSON.stringify({ message_id: lastMessage.id }),
      });
    } catch (error) {
      console.error(error);
      showToast('Messages loaded, but the unread count could not be updated');
    }
  }

  if (!selectionIsCurrent(selectionVersion, id)) return false;
  const listLoaded = await loadConversations(selectionVersion);
  if (!selectionIsCurrent(selectionVersion, id)) return false;
  if (listLoaded) {
    if (!syncActiveConversationSummary()) return false;
    renderConversations();
    renderActiveHeader();
  }
  return true;
}

async function sendActiveMessage(event) {
  event.preventDefault();
  const id = state.activeConversationId;
  const conversation = state.activeThread?.conversation;
  if (!id || !conversation?.can_send || state.sending) return;

  const draft = els.messageInput.value;
  const content = draft.trim();
  if (!content) return;

  setSending(true);
  try {
    await apiFetch(`/messages/conversations/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    els.messageInput.value = '';
    try {
      await reloadActiveConversationFromDatabase(id);
      showToast('Message sent');
    } catch (error) {
      console.error(error);
      showToast('Message saved, but the conversation could not be refreshed');
    }
  } catch (error) {
    console.error(error);
    els.messageInput.value = draft;
    showToast(error.message || 'Message could not be sent');
  } finally {
    setSending(false);
  }
}

function setComposeEnabled(enabled) {
  els.messageInput.disabled = !enabled;
  els.sendBtn.disabled = !enabled;
}

function setSending(sending) {
  state.sending = sending;
  const canSend = Boolean(
    !sending
    && state.activeThread?.conversation?.status === 'active'
    && state.activeThread?.conversation?.can_send,
  );
  els.messageInput.disabled = sending || !canSend;
  els.sendBtn.disabled = sending || !canSend;
  els.sendBtn.innerHTML = sending
    ? '<i class="ti ti-loader-2"></i> Sending'
    : '<i class="ti ti-send"></i> Send';
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role || 'User';
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
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(undefined, isToday
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(date);
}

function formatLongTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
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

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}
