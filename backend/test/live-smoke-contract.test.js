const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'live-four-role-smoke.js'),
  'utf8'
);

function loadSmokeHelpers() {
  const previous = {
    DB_NAME: process.env.DB_NAME,
    DB_PASSWORD: process.env.DB_PASSWORD,
    DB_USER: process.env.DB_USER,
    LUMILABS_E2E_ORIGIN: process.env.LUMILABS_E2E_ORIGIN,
  };
  Object.assign(process.env, {
    DB_NAME: 'contract_test',
    DB_PASSWORD: 'contract_test',
    DB_USER: 'contract_test',
    LUMILABS_E2E_ORIGIN: 'http://127.0.0.1:3999',
  });
  const smokePath = require.resolve('../scripts/live-four-role-smoke');
  delete require.cache[smokePath];
  const helpers = require(smokePath);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return helpers;
}

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

test('smoke cleanup rejects message and notification IDs outside verified resources', () => {
  const { assertTrackedIdsBelongToRows } = loadSmokeHelpers();
  assert.equal(typeof assertTrackedIdsBelongToRows, 'function');
  assert.doesNotThrow(() => assertTrackedIdsBelongToRows(
    new Set([11, 12]),
    [{ id: 11 }, { id: 12 }],
    'message',
  ));
  assert.throws(
    () => assertTrackedIdsBelongToRows(new Set([11, 999]), [{ id: 11 }], 'message'),
    /tracked message 999 is outside the verified temporary resources/,
  );
  assert.throws(
    () => assertTrackedIdsBelongToRows(new Set([21, 999]), [{ id: 21 }], 'notification'),
    /tracked notification 999 is outside the verified temporary resources/,
  );
});

test('notification cleanup never trusts a raw API-returned notification ID', () => {
  const cleanupFunction = source.match(
    /function notificationCleanupWhere\(\) \{[\s\S]*?\n\}/,
  );
  assert.ok(cleanupFunction, 'notification cleanup predicate must exist');
  assert.doesNotMatch(cleanupFunction[0], /notificationIds|clauses\.push\(`id IN/);
});

test('already-deleted tracked notifications are harmless but existing misbound IDs fail', () => {
  const { assertExistingTrackedIdsAreVerified } = loadSmokeHelpers();
  assert.equal(typeof assertExistingTrackedIdsAreVerified, 'function');
  assert.doesNotThrow(() => assertExistingTrackedIdsAreVerified(
    new Set([21, 52]),
    [],
    [],
    'notification',
  ));
  assert.doesNotThrow(() => assertExistingTrackedIdsAreVerified(
    new Set([21, 52]),
    [{ id: 21 }],
    [{ id: 21 }],
    'notification',
  ));
  assert.throws(
    () => assertExistingTrackedIdsAreVerified(
      new Set([21, 999]),
      [{ id: 999 }],
      [{ id: 21 }],
      'notification',
    ),
    /tracked notification 999 is outside the verified temporary resources/,
  );
});
