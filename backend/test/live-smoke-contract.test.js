const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptsDir = path.join(__dirname, '..', 'scripts');
const oldSmokePath = path.join(scriptsDir, 'live-four-role-smoke.js');
const smokePath = path.join(scriptsDir, 'live-five-role-smoke.js');

function smokeSource() {
  assert.equal(fs.existsSync(smokePath), true, 'five-role smoke source must exist');
  return fs.readFileSync(smokePath, 'utf8');
}

function loadSmoke() {
  assert.equal(fs.existsSync(smokePath), true, 'five-role smoke source must exist');
  delete require.cache[require.resolve(smokePath)];
  return require(smokePath);
}

function orderedIndex(source, pattern, after = -1) {
  const index = source.indexOf(pattern, after + 1);
  assert.ok(index > after, `expected ${pattern} after source offset ${after}`);
  return index;
}

test('release exposes only the renamed five-role smoke package command', () => {
  const packageJson = require('../package.json');
  assert.equal(fs.existsSync(smokePath), true);
  assert.equal(fs.existsSync(oldSmokePath), false);
  assert.equal(packageJson.scripts['smoke:live'], 'node scripts/live-five-role-smoke.js');
  assert.equal(packageJson.scripts['migrate:managed-chat'], undefined);
  assert.equal(JSON.stringify(packageJson).includes('live-four-role-smoke'), false);
});

test('smoke configuration generates isolated five-role identities and accepts only approved origins', () => {
  const {
    createRunContext,
    resolveOrigin,
  } = loadSmoke();

  assert.equal(resolveOrigin({ LUMILABS_E2E_ORIGIN: 'http://127.0.0.1:3100/' }),
    'http://127.0.0.1:3100');
  assert.equal(resolveOrigin({ LUMILABS_E2E_ORIGIN: 'http://35.212.144.149' }),
    'http://35.212.144.149');
  for (const rejected of [
    'http://localhost:3100',
    'https://127.0.0.1:3100',
    'http://127.0.0.1:3100/api',
    'http://35.212.144.149:3100',
    'https://35.212.144.149',
  ]) {
    assert.throws(
      () => resolveOrigin({ LUMILABS_E2E_ORIGIN: rejected }),
      /approved public origin|loopback/i,
    );
  }

  const first = createRunContext();
  const second = createRunContext();
  assert.match(first.runId, /^smoke-[0-9a-f-]{36}$/);
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(first.credential, second.credential);
  assert.deepEqual(first.roles, [
    'superadmin',
    'admin',
    'relationship_manager',
    'business_owner',
    'investor',
  ]);
  assert.equal(new Set(Object.values(first.emails)).size, 7);
  for (const email of Object.values(first.emails)) {
    assert.equal(email.startsWith(first.runId), true);
  }
});

test('five-role journey uses supported APIs in lifecycle order without removed chat controls', () => {
  const source = smokeSource();
  let index = -1;
  for (const required of [
    "api('/superadmin/staff'",
    "api('/auth/register'",
    "api(`/portfolios/${portfolioId}/submit`",
    "api(`/admin/portfolios/${portfolioId}/approve`",
    "api(`/superadmin/portfolios/${portfolioId}/assignment`",
    "api(`/superadmin/portfolios/${portfolioId}/assignment`",
    "api(`/interests/${portfolioId}`",
    "api('/relationship-manager/conversations'",
    "api(`/relationship-manager/conversations/${conversationId}/investors/${investor1Id}`",
    "api(`/relationship-manager/conversations/${conversationId}/investors`",
    "api(`/interests/${portfolioId}`",
    "api(`/superadmin/portfolios/${portfolioId}/assignment`",
    "api(`/portfolios/${portfolioId}/submit`",
    "api(`/admin/portfolios/${portfolioId}/reject`",
    "api(`/portfolios/${portfolioId}`",
    "api(`/portfolios/${portfolioId}/submit`",
    "api(`/admin/portfolios/${portfolioId}/approve`",
  ]) {
    index = orderedIndex(source, required, index);
  }

  assert.match(source, /interest_ids:\s*\[interest1Id,\s*interest2Id\]/);
  assert.match(source, /actions\.can_create_conversation/);
  assert.match(source, /documents\/\$\{documentId\}\/download/);
  assert.match(source, /expectStatus\([\s\S]*investor1[\s\S]*403/);
  assert.match(source, /expectStatus\([\s\S]*investor2[\s\S]*403/);
  assert.match(source, /expectStatus\([\s\S]*manager1[\s\S]*403/);
  assert.doesNotMatch(source, /\/archive|\/reopen/);

  const directUserInserts = source.match(/INSERT INTO users\b/gi) || [];
  assert.equal(directUserInserts.length, 1);
  assert.match(
    source,
    /INSERT INTO users \(email,password_hash,name,role\) VALUES \(\?,\?,\?,'superadmin'\)/,
  );
});

test('smoke proves exact ID history, join boundaries, recipients, denials, and both audit streams', () => {
  const {
    EXPECTED_SUPERADMIN_ACTIONS,
    assertExactIds,
    assertExactRecipientIds,
  } = loadSmoke();

  assert.deepEqual(EXPECTED_SUPERADMIN_ACTIONS, [
    'admin_account_created',
    'relationship_manager_account_created',
    'relationship_manager_account_created',
    'portfolio_assigned',
    'portfolio_unassigned',
    'portfolio_assigned',
    'portfolio_reassigned',
  ]);
  assert.doesNotThrow(() => assertExactIds(
    [{ id: 12 }, { id: 10 }, { id: 11 }],
    [10, 11, 12],
    'message history',
  ));
  assert.throws(
    () => assertExactIds([{ id: 10 }, { id: 12 }], [10, 11, 12], 'message history'),
    /message history/i,
  );
  assert.doesNotThrow(() => assertExactRecipientIds(
    [{ user_id: 8 }, { user_id: 3 }, { user_id: 6 }],
    [3, 6, 8],
    'new interest',
  ));
  assert.throws(
    () => assertExactRecipientIds(
      [{ user_id: 3 }, { user_id: 6 }, { user_id: 99 }],
      [3, 6, 8],
      'new interest',
    ),
    /new interest/i,
  );

  const source = smokeSource();
  assert.match(source, /visible_after_message_id/);
  assert.match(source, /assertExactRecipientIds/);
  assert.match(source, /superadmin_audit_logs/);
  assert.match(source, /audit_logs/);
  assert.match(source, /\/superadmin\/audit-logs/);
  assert.match(source, /\/admin\/audit-logs/);
  assert.match(source, /api\('\/superadmin\/stats',\s*\{\s*token:\s*admin\.token/);
  assert.match(source, /api\('\/admin\/stats',\s*\{\s*token:\s*superadmin\.token/);
  assert.match(source, /api\('\/messages\/conversations',\s*\{\s*token:\s*admin\.token/);
  assert.match(source, /api\('\/messages\/conversations',\s*\{\s*token:\s*superadmin\.token/);
  assert.match(
    source,
    /expectStatus\(api\(`\/superadmin\/portfolios\/\$\{portfolioId\}\/assignment`,[\s\S]*token:\s*admin\.token[\s\S]*\),\s*403\)/,
  );
  assert.match(
    source,
    /expectStatus\(api\(`\/admin\/portfolios\/\$\{portfolioId\}\/approve`,[\s\S]*token:\s*superadmin\.token[\s\S]*\),\s*403\)/,
  );
  assert.match(
    source,
    /expectStatus\(api\(`\/superadmin\/portfolios\/\$\{portfolioId\}\/assignment`,[\s\S]*method:\s*'DELETE'[\s\S]*token:\s*superadmin\.token[\s\S]*\),\s*409\)/,
  );
});

test('cleanup is UUID-scoped, FK-safe, reconciled, and manager-reassignment aware', () => {
  const source = smokeSource();
  const deleteTables = [...source.matchAll(/DELETE FROM ([a-z_]+)/g)]
    .map((match) => match[1]);
  assert.deepEqual(deleteTables, [
    'superadmin_audit_logs',
    'audit_logs',
    'notifications',
    'messages',
    'conversation_members',
    'conversations',
    'investor_interests',
    'portfolio_documents',
    'portfolios',
    'users',
  ]);

  for (const statement of source.match(/DELETE FROM [^'`]+/g) || []) {
    assert.match(statement, /\bWHERE\b/i, `cleanup delete must be qualified: ${statement}`);
  }
  for (const trackedType of [
    'userIds',
    'portfolioIds',
    'interestIds',
    'conversationIds',
    'messageIds',
    'notificationIds',
    'moderationAuditIds',
    'superadminAuditIds',
    'documentIds',
  ]) {
    assert.match(source, new RegExp(`created\\.${trackedType}`));
  }

  assert.match(source, /email LIKE \?/);
  assert.match(source, /`\$\{runId\}%`/);
  assert.match(source, /captureNonTemporaryCounts/);
  assert.match(source, /assertNonTemporaryCountsUnchanged/);
  assert.match(source, /assertCleanupComplete/);
  assert.match(source, /reconcileTemporaryRecords/);
  assert.match(
    source,
    /WHERE c\.portfolio_id=\?[\s\S]*c\.relationship_manager_id IN/,
  );
  assert.doesNotMatch(
    source,
    /WHERE c\.portfolio_id=\? AND c\.relationship_manager_id=\?/,
  );
  const reconciliation = source.match(
    /async function reconcileTemporaryRecords\(context\) \{([\s\S]*?)\n\}/,
  )?.[1] || '';
  assert.ok(reconciliation, 'reconciliation function must exist');
  assert.ok(
    reconciliation.indexOf('FROM superadmin_audit_logs')
      < reconciliation.indexOf('if (!portfolioIds.length) return'),
    'UUID-scoped staff audits must be reconciled even before a portfolio exists',
  );
});

test('smoke source contains no fixed credential, email address, or token', () => {
  const source = smokeSource();
  assert.doesNotMatch(
    source,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  );
  assert.doesNotMatch(
    source,
    /(?:password|credential|token)\s*[:=]\s*['"][^'"]+['"]/i,
  );
  assert.doesNotMatch(
    source,
    /victor@lumilabs\.com|biztest@lumilabs\.com|invtest@lumilabs\.com|rsmanager@lumilabs\.com/i,
  );
});
