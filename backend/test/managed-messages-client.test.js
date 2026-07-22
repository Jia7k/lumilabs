const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'messages.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'js', 'messages.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(root, 'js', 'api.js'), 'utf8');

test('messages page uses the shared authenticated API client without global collisions', () => {
  const apiScript = html.match(/<script src="js\/api\.js\?v=([a-z0-9._-]+)"><\/script>/i);
  const messagesScript = html.match(/<script src="js\/messages\.js\?v=([a-z0-9._-]+)"><\/script>/i);

  assert.ok(apiScript, 'messages.html must load a cache-keyed js/api.js');
  assert.ok(messagesScript, 'messages.html must load a cache-keyed js/messages.js');
  assert.equal(apiScript[1], messagesScript[1], 'message scripts must share one release cache key');
  assert.ok(apiScript.index < messagesScript.index, 'js/api.js must load before js/messages.js');
  assert.match(html, /onclick="signOut\(\)"/);
  assert.doesNotMatch(source, /const API_BASE/);
  assert.doesNotMatch(source, /function apiFetch\s*\(/);
  assert.doesNotMatch(source, /function getAuthToken\s*\(/);
  assert.doesNotMatch(source, /function clearMessageSession\s*\(/);
  assert.doesNotMatch(source, /function signOutMessages\s*\(/);

  const sandbox = {
    window: { LUMILABS_API_BASE: undefined, location: { search: '', href: '' } },
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
    },
    localStorage: {
      getItem() { return null; },
      removeItem() {},
    },
    FormData: class {},
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get() { return 'application/json'; } },
      json: async () => ({}),
    }),
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    encodeURIComponent,
    Intl,
    Date,
  };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(apiSource, sandbox);
    vm.runInContext(source, sandbox);
  });
});

test('messages page supports relationship-manager navigation and permanent archive-aware composer', () => {
  assert.match(html, /id="relationship-manager-nav"/);
  assert.match(html, /relationshipmanagerdashboard\.html/);
  assert.match(html, /id="thread-participants"/);
  assert.match(html, /id="archive-notice"[^>]*aria-live="polite"/);
  assert.match(html, /id="message-form"/);
  assert.match(html, /body\.role-relationship-manager/);
});

test('client state and URL starter are conversation-ID-only', () => {
  assert.match(source, /activeConversationId:\s*null/);
  assert.match(source, /activeThread:\s*null/);
  assert.match(source, /params\.get\(['"]conversationId['"]\)/);
  assert.match(source, /data-conversation-id/);
  assert.doesNotMatch(source, /partnerId|receiver_id|receiverName|portfolioId/);
});

test('current user is right aligned and every other sender is left aligned with identity', () => {
  const sandbox = {
    window: { LUMILABS_API_BASE: undefined, location: { search: '', href: '' } },
    document: { addEventListener() {} },
    localStorage: { getItem() { return ''; }, removeItem() {} },
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    encodeURIComponent,
    Intl,
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  vm.runInContext(`
    state.user = { id: '8', name: 'Rachel Manager', role: 'relationship_manager' };
    state.activeConversationId = '12';
    state.activeThread = normalizeThread({
      conversation: { id: 12, title: 'X3', status: 'active', can_send: true },
      participants: [],
      messages: [
        { id: 1, conversation_id: 12, sender_id: 8, sender_name: 'Rachel Manager', sender_role: 'relationship_manager', content: 'Mine', created_at: '2026-07-22T09:00:00Z' },
        { id: 2, conversation_id: 12, sender_id: 3, sender_name: 'Beta', sender_role: 'business_owner', content: 'Owner', created_at: '2026-07-22T09:01:00Z' },
        { id: 3, conversation_id: 12, sender_id: 6, sender_name: 'testing1', sender_role: 'investor', content: 'Investor', created_at: '2026-07-22T09:02:00Z' }
      ]
    });
    els.messageList = { innerHTML: '', scrollTop: 0, scrollHeight: 100 };
    renderThread();
  `, sandbox);
  const rendered = vm.runInContext('els.messageList.innerHTML', sandbox);
  assert.match(rendered, /message-row mine[\s\S]*You[\s\S]*Relationship Manager/);
  assert.match(rendered, /message-row(?! mine)[\s\S]*Beta[\s\S]*Business Owner/);
  assert.match(rendered, /message-row(?! mine)[\s\S]*testing1[\s\S]*Investor/);
});

test('archived rooms stay readable while composer is disabled with explanation', () => {
  assert.match(source, /This conversation is archived and is read-only\./);
  assert.match(source, /setComposeEnabled\(false\)/);
  assert.match(source, /ARCHIVE_REASON_LABELS/);
  assert.match(source, /conversation\.can_send/);
});

test('search covers title, participants, and latest content with escaped output', () => {
  assert.match(source, /conversation\.title/);
  assert.match(source, /conversation\.participants\.map/);
  assert.match(source, /conversation\.latest_message\?\.content/);
  assert.match(source, /escapeHtml\(conversation\.title\)/);
  assert.match(source, /escapeHtml\(message\.content\)/);
  assert.match(source, /escapeHtml\(message\.sender_name\)/);
});
