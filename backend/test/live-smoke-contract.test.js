const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'live-four-role-smoke.js'),
  'utf8'
);

test('four-role smoke is explicitly targeted and creates managers through the admin API', () => {
  assert.match(source, /LUMILABS_E2E_ORIGIN/);
  assert.match(source, /codex_e2e_/);
  assert.match(source, /randomUUID\(\)/);
  assert.match(source, /emails\.manager/);
  assert.match(source, /emails\.otherManager/);
  assert.match(source, /\/admin\/relationship-managers/);
  assert.match(source, /relationship_manager/);
  assert.match(source, /assert\.rejects[\s\S]*\/auth\/register/);
  assert.match(source, /\/relationship-manager\/dashboard/);
  assert.match(source, /interest_ids/);
});

test('four-role smoke exercises group messages, isolation, archive, and withdrawal', () => {
  assert.match(source, /\/messages\/conversations\/\$\{conversationId\}\/messages/);
  assert.match(source, /\/messages\/conversations\/\$\{conversationId\}\/read/);
  assert.match(source, /sender_role/);
  assert.match(source, /unread_count/);
  assert.match(source, /new_message/);
  assert.match(source, /\/archive/);
  assert.match(source, /\/reopen/);
  assert.match(source, /api\(`\/interests\/\$\{portfolioId\}`/);
  assert.match(source, /no_active_investors/);
});

test('four-role smoke cleanup is transactionally scoped to tracked identities and IDs', () => {
  assert.match(source, /tracked\.userIds/);
  assert.match(source, /tracked\.portfolioId/);
  assert.match(source, /tracked\.interestId/);
  assert.match(source, /tracked\.conversationId/);
  assert.match(source, /tracked\.messageIds/);
  assert.match(source, /tracked\.notificationIds/);
  assert.match(source, /tracked\.documentIds/);
  assert.match(source, /tracked\.auditIds/);
  assert.match(source, /finally/);
  assert.match(source, /beginTransaction\(\)/);
  assert.match(source, /DELETE FROM notifications/);
  assert.match(source, /DELETE FROM messages/);
  assert.match(source, /DELETE FROM conversation_members/);
  assert.match(source, /DELETE FROM conversations/);
  assert.match(source, /DELETE FROM audit_logs/);
  assert.match(source, /DELETE FROM investor_interests/);
  assert.match(source, /DELETE FROM portfolio_documents/);
  assert.match(source, /DELETE FROM portfolios/);
  assert.match(source, /DELETE FROM users/);
  assert.match(source, /email LIKE 'codex\\_e2e\\_%'/);
  assert.match(source, /assertCleanupComplete/);
  assert.match(source, /reconcileTemporaryRecords/);
  assert.match(source, /verifyTrackedResources/);
  assert.match(source, /SELECT id,email,name,role FROM users WHERE email IN/);
  assert.match(source, /p\.owner_id=\?/);
  assert.match(source, /c\.relationship_manager_id=\?/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /assertAffected/);
  assert.doesNotMatch(source, /victor@lumilabs\.com|admin123|password\s*=/i);
});
