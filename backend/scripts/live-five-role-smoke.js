require('dotenv').config();

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const EXPECTED_SUPERADMIN_ACTIONS = [
  'admin_account_created',
  'relationship_manager_account_created',
  'relationship_manager_account_created',
  'portfolio_assigned',
  'portfolio_unassigned',
  'portfolio_assigned',
  'portfolio_reassigned',
];

function positiveId(value, label) {
  const id = Number(value);
  assert.ok(Number.isSafeInteger(id) && id > 0, `${label} must be a positive integer`);
  return id;
}

function auditId(value, label) {
  const id = String(value || '');
  assert.match(id, /^[1-9]\d*$/, `${label} must be a positive SQL identifier`);
  return id;
}

function placeholders(values) {
  assert.ok(values.length > 0, 'placeholder values cannot be empty');
  return values.map(() => '?').join(',');
}

function resolveOrigin(environment = process.env) {
  const origin = String(environment.LUMILABS_E2E_ORIGIN || '').replace(/\/$/, '');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    throw new Error('LUMILABS_E2E_ORIGIN must target an explicit loopback HTTP port');
  }
  return origin;
}

function generatedEmail(runId, label) {
  const local = [runId, label, crypto.randomBytes(4).toString('hex')].join('-');
  const domain = [crypto.randomBytes(6).toString('hex'), 'invalid'].join('.');
  return `${local}${String.fromCharCode(64)}${domain}`;
}

function resourceSets() {
  return {
    userIds: new Set(),
    portfolioIds: new Set(),
    interestIds: new Set(),
    conversationIds: new Set(),
    messageIds: new Set(),
    notificationIds: new Set(),
    moderationAuditIds: new Set(),
    superadminAuditIds: new Set(),
    documentIds: new Set(),
  };
}

function createRunContext() {
  const runId = `smoke-${crypto.randomUUID()}`;
  const labels = ['superadmin', 'admin', 'manager1', 'manager2', 'owner', 'investor1', 'investor2'];
  const emails = Object.fromEntries(labels.map((label) => [label, generatedEmail(runId, label)]));
  const reported = resourceSets();
  const verified = resourceSets();
  const names = {
    superadmin: `${runId} Superadmin`,
    admin: `${runId} Admin`,
    manager1: `${runId} Manager One`,
    manager2: `${runId} Manager Two`,
    owner: `${runId} Owner`,
    investor1: `${runId} Investor One`,
    investor2: `${runId} Investor Two`,
  };
  const context = {
    runId,
    roles: ['superadmin', 'admin', 'relationship_manager', 'business_owner', 'investor'],
    credential: crypto.randomBytes(32).toString('base64url'),
    emails,
    names,
    expectedUsers: new Map([
      [emails.superadmin, { email: emails.superadmin, name: names.superadmin, role: 'superadmin' }],
      [emails.admin, { email: emails.admin, name: names.admin, role: 'admin' }],
      [emails.manager1, { email: emails.manager1, name: names.manager1, role: 'relationship_manager' }],
      [emails.manager2, { email: emails.manager2, name: names.manager2, role: 'relationship_manager' }],
      [emails.owner, { email: emails.owner, name: names.owner, role: 'business_owner' }],
      [emails.investor1, { email: emails.investor1, name: names.investor1, role: 'investor' }],
      [emails.investor2, { email: emails.investor2, name: names.investor2, role: 'investor' }],
    ]),
    issuedEmails: new Set(Object.values(emails)),
    identities: {},
    reported,
    verified,
    userEmails: new Map(),
    userRoles: new Map(),
    baselineCounts: null,
    database: null,
    abortController: new AbortController(),
    interruptedBy: null,
    stagedFiles: [],
  };
  return context;
}

function sortedIds(values) {
  return [...values].map(Number).sort((left, right) => left - right);
}

function assertExactIds(rows, expectedIds, label) {
  const actual = sortedIds(rows.map((row) => row.id));
  const expected = sortedIds(expectedIds);
  assert.deepEqual(actual, expected, `${label} IDs changed`);
}

function assertExactRecipientIds(rows, expectedIds, label) {
  const actual = sortedIds(rows.map((row) => row.user_id));
  const expected = sortedIds(expectedIds);
  assert.equal(new Set(actual).size, actual.length, `${label} recipients were duplicated`);
  assert.deepEqual(actual, expected, `${label} recipients changed`);
}

function assertExactUser(actual, expected, label = 'user') {
  assert.deepEqual(
    {
      id: positiveId(actual?.id, `${label} ID`),
      email: String(actual?.email || '').toLowerCase(),
      name: String(actual?.name || ''),
      role: String(actual?.role || ''),
    },
    {
      id: positiveId(expected?.id, `${label} expected ID`),
      email: String(expected?.email || '').toLowerCase(),
      name: String(expected?.name || ''),
      role: String(expected?.role || ''),
    },
    `${label} identity changed`,
  );
}

function normalizedNotification(row) {
  return {
    user_id: Number(row.user_id),
    type: String(row.type),
    related_portfolio_id: row.related_portfolio_id == null ? null : Number(row.related_portfolio_id),
    related_conversation_id: row.related_conversation_id == null
      ? null : Number(row.related_conversation_id),
    related_message_id: row.related_message_id == null ? null : Number(row.related_message_id),
    related_user_id: row.related_user_id == null ? null : Number(row.related_user_id),
  };
}

function stableRows(rows) {
  return rows.map((row) => normalizedNotification(row))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function assertExactNotificationTuples(actual, expected, label = 'notification interval') {
  assert.deepEqual(stableRows(actual), stableRows(expected), `${label} tuples changed`);
}

function assertExactAuditEvents(actual, expected, label = 'audit events') {
  const withoutGeneratedFields = (row) => Object.fromEntries(
    Object.entries(row).filter(([key]) => !['id', 'created_at'].includes(key)),
  );
  assert.deepEqual(
    actual.map(withoutGeneratedFields),
    expected.map(withoutGeneratedFields),
    `${label} changed`,
  );
}

function requireAffectedRows(result, expected, label) {
  assert.equal(
    Number(result?.affectedRows),
    expected,
    `${label} cleanup affected ${Number(result?.affectedRows)} rows; expected ${expected}`,
  );
}

async function verifyReportedIds({
  database,
  reportedIds,
  verifiedIds,
  label,
  loadExisting,
}) {
  const reported = [...reportedIds];
  if (!reported.length) return [];
  const rows = await loadExisting(database, reported);
  for (const row of rows) {
    const id = Number(row.id);
    assert.ok(verifiedIds.has(id) || verifiedIds.has(String(row.id)), (
      `reported ${label} ${row.id} exists outside the natural scope`
    ));
  }
  return rows;
}

function trackUser(context, user, expectedEmail, expectedRole) {
  const id = positiveId(user.id, `${expectedRole} user ID`);
  const email = String(user.email || expectedEmail || '').toLowerCase();
  assert.equal(email, expectedEmail.toLowerCase(), `${expectedRole} email changed`);
  assert.ok(email.startsWith(context.runId), `${expectedRole} is outside this smoke run`);
  if (user.role !== undefined) assert.equal(user.role, expectedRole);
  const expected = context.expectedUsers.get(email);
  if (expected && user.name !== undefined) assert.equal(user.name, expected.name);
  context.reported.userIds.add(id);
  context.userEmails.set(id, email);
  context.userRoles.set(id, expectedRole);
  return { ...user, id, email, role: expectedRole };
}

async function bindReportedId(context, type, id, label) {
  await reconcileTemporaryRecords(context);
  assert.ok(context.verified[type].has(id) || context.verified[type].has(String(id)), (
    `${label} API ID was not proven by the natural database scope`
  ));
}

function trackRows(target, rows, label, normalize = positiveId) {
  for (const row of rows) target.add(normalize(row.id, `${label} ID`));
  return rows;
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`response is too large (limit ${maxBytes} bytes)`);
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`response is too large (limit ${maxBytes} bytes)`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error(`response is too large (limit ${maxBytes} bytes)`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function requestApi(origin, requestPath, {
  method = 'GET',
  token,
  body,
  form,
  binary = false,
  expectedStatus = 200,
  timeoutMs = 10_000,
  maxBytes = 1024 * 1024,
  signal,
} = {}, { fetchImpl = fetch } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) onExternalAbort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/api${requestPath}`, {
      method,
      headers,
      body: form || (body === undefined ? undefined : JSON.stringify(body)),
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.redirected) throw new Error(`${method} ${requestPath} redirected unexpectedly`);
    const bytes = await readBoundedBody(response, maxBytes);
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    let payload;
    if (binary) {
      assert.match(contentType, /^application\/pdf(?:;|$)/, 'PDF response content type changed');
      assert.equal(bytes.subarray(0, 4).toString(), '%PDF', 'PDF header changed');
      payload = bytes;
    } else {
      assert.match(
        contentType,
        /^application\/json(?:;|$)/,
        'response content type must be application/json',
      );
      try {
        payload = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw new Error(`${method} ${requestPath} did not return valid JSON`, { cause: error });
      }
    }
    if (response.status !== expectedStatus) {
      const error = new Error(
        `${method} ${requestPath} expected ${expectedStatus} but received ${response.status}`,
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return { status: response.status, data: payload };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${method} ${requestPath} timed out or was aborted`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

async function expectStatus(request, status) {
  await assert.rejects(request, (error) => error.status === status);
}

async function tableMaximum(database, table) {
  assert.ok(['notifications'].includes(table), 'unsupported marker table');
  const [[row]] = await database.query(`SELECT COALESCE(MAX(id),0) AS id FROM ${table}`);
  return positiveId(row.id || 1, `${table} marker`) - (Number(row.id) === 0 ? 1 : 0);
}

async function notificationRowsAfter(context, marker) {
  const portfolioId = [...context.reported.portfolioIds][0];
  const [rows] = await context.database.query(
    `SELECT id,user_id,type,related_portfolio_id,related_conversation_id,
            related_message_id,related_user_id
       FROM notifications
      WHERE id>? AND related_portfolio_id=?
      ORDER BY id`,
    [marker, portfolioId],
  );
  trackRows(context.reported.notificationIds, rows, 'notification');
  return rows;
}

function expectedNotifications(context, type, recipients, {
  relatedConversationId = null,
  relatedMessageId = null,
  relatedUserId = null,
  nullConversationRecipients = [],
} = {}) {
  const portfolioId = [...context.reported.portfolioIds][0];
  const withoutConversation = new Set(nullConversationRecipients.map(Number));
  return recipients.map((recipient) => ({
    user_id: Number(recipient),
    type,
    related_portfolio_id: portfolioId,
    related_conversation_id: withoutConversation.has(Number(recipient))
      ? null : relatedConversationId,
    related_message_id: relatedMessageId,
    related_user_id: relatedUserId,
  }));
}

async function assertNewNotifications(context, marker, type, recipients, label, options = {}) {
  const rows = await notificationRowsAfter(context, marker);
  const expected = [
    ...expectedNotifications(context, type, recipients, options),
    ...(options.additionalExpected || []),
  ];
  assertExactNotificationTuples(rows, expected, label);
  return rows;
}

function resolveTemporaryDocument(fileUrl) {
  assert.match(
    String(fileUrl || ''),
    /^\/uploads\/portfolio-documents\/[A-Za-z0-9._-]+$/,
    'temporary document path must stay inside the upload directory',
  );
  const backendRoot = path.resolve(__dirname, '..');
  const documentRoot = path.resolve(backendRoot, 'uploads', 'portfolio-documents');
  const absolute = path.resolve(backendRoot, fileUrl.slice(1));
  assert.ok(absolute.startsWith(`${documentRoot}${path.sep}`), 'document path escaped upload root');
  return absolute;
}

async function pathExists(filePath, fileSystem) {
  try {
    await fileSystem.stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function combinedError(primary, secondary, message) {
  if (primary && secondary) return new AggregateError([primary, secondary], message);
  return primary || secondary;
}

async function stageDocumentFiles(documentRows, { fileSystem = fs } = {}) {
  const staged = [];
  try {
    for (const row of documentRows) {
      const original = resolveTemporaryDocument(row.file_url);
      const source = await fileSystem.stat(original).catch((error) => {
        throw new Error(`uploaded document must exist: ${original}`, { cause: error });
      });
      assert.ok(!source.isFile || source.isFile(), `uploaded document must be a file: ${original}`);
      const stagedPath = `${original}.cleanup-${crypto.randomUUID()}`;
      await fileSystem.rename(original, stagedPath);
      const entry = { original, staged: stagedPath, state: 'staged' };
      staged.push(entry);
      assert.equal(await pathExists(stagedPath, fileSystem), true, 'staged document is missing');
    }
    return staged;
  } catch (error) {
    let restoreError;
    try {
      await restoreStagedFiles(staged, { fileSystem });
    } catch (failure) {
      restoreError = failure;
    }
    const failure = combinedError(error, restoreError, 'Document staging and restoration failed');
    failure.stagedFiles = staged;
    throw failure;
  }
}

async function restoreStagedFiles(staged, { fileSystem = fs } = {}) {
  const errors = [];
  for (const file of [...staged].reverse()) {
    if (file.state === 'restored') continue;
    try {
      const stagedExists = await pathExists(file.staged, fileSystem);
      const originalExists = await pathExists(file.original, fileSystem);
      if (!stagedExists && originalExists) {
        file.state = 'restored';
        continue;
      }
      assert.equal(originalExists, false, 'both staged and original documents exist');
      assert.equal(stagedExists, true, 'neither staged nor original document exists');
      await fileSystem.rename(file.staged, file.original);
      assert.equal(await pathExists(file.original, fileSystem), true, 'restored document is missing');
      assert.equal(await pathExists(file.staged, fileSystem), false, 'staged document remains');
      file.state = 'restored';
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Document restoration failed');
}

async function purgeStagedFiles(staged, { fileSystem = fs } = {}) {
  const errors = [];
  for (const file of staged) {
    if (file.state === 'purged') continue;
    try {
      const stagedExists = await pathExists(file.staged, fileSystem);
      const originalExists = await pathExists(file.original, fileSystem);
      assert.equal(originalExists, false, 'original document exists after database commit');
      if (!stagedExists) {
        file.state = 'purged';
        continue;
      }
      await fileSystem.unlink(file.staged);
      assert.equal(await pathExists(file.staged, fileSystem), false, 'staged document remains');
      assert.equal(await pathExists(file.original, fileSystem), false, 'original document was recreated');
      file.state = 'purged';
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Document purge failed');
}

async function settleStagedFiles(staged, {
  committed,
  fileSystem = fs,
  primaryError,
} = {}) {
  let settlementError;
  try {
    if (committed) await purgeStagedFiles(staged, { fileSystem });
    else await restoreStagedFiles(staged, { fileSystem });
  } catch (error) {
    settlementError = error;
  }
  const error = combinedError(primaryError, settlementError, 'Database and file settlement failed');
  if (error) throw error;
}

async function captureNonTemporaryCounts(database, runId) {
  const like = `${runId}%`;
  const [[portfolioRow]] = await database.query(
    `SELECT COUNT(*) AS count
       FROM portfolios p
       JOIN users owner ON owner.id=p.owner_id
      WHERE owner.email NOT LIKE ?`,
    [like],
  );
  const [[memberRow]] = await database.query(
    `SELECT COUNT(*) AS count
       FROM conversation_members cm
       JOIN users member ON member.id=cm.user_id
      WHERE member.email NOT LIKE ?`,
    [like],
  );
  const [[messageRow]] = await database.query(
    `SELECT COUNT(*) AS count
       FROM messages m
       JOIN users sender ON sender.id=m.sender_id
      WHERE sender.email NOT LIKE ?`,
    [like],
  );
  return {
    portfolios: Number(portfolioRow.count),
    conversation_members: Number(memberRow.count),
    messages: Number(messageRow.count),
  };
}

function assertNonTemporaryCountsUnchanged(before, after) {
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  const error = new Error(
    `non-temporary count drift detected (possibly concurrent activity): `
      + `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
  error.code = 'NON_TEMPORARY_COUNT_DRIFT';
  throw error;
}

function resetVerified(context) {
  context.verified = resourceSets();
  return context.verified;
}

function assertRowsWithin(rows, ownedIds, label) {
  for (const row of rows) {
    assert.ok(ownedIds.has(Number(row.id)) || ownedIds.has(String(row.id)), (
      `${label} foreign-key footprint contains unverified row ${row.id}`
    ));
  }
}

function assertNaturalSuperadminAudit(context, row) {
  if (row.action === undefined) return;
  assert.equal(
    String(row.superadmin_email_snapshot).toLowerCase(),
    context.emails.superadmin,
    'superadmin audit actor email snapshot escaped scope',
  );
  assert.equal(
    row.superadmin_name_snapshot,
    context.names.superadmin,
    'superadmin audit actor name snapshot escaped scope',
  );
  if (row.action.endsWith('_account_created')) {
    const email = String(row.created_user_email_snapshot || '').toLowerCase();
    const expected = context.expectedUsers.get(email);
    assert.ok(
      expected && ['admin', 'relationship_manager'].includes(expected.role),
      'superadmin staff audit escaped issued staff scope',
    );
    assert.equal(row.created_user_name_snapshot, expected.name);
    assert.equal(row.created_user_role, expected.role);
    assert.equal(
      row.action,
      expected.role === 'admin'
        ? 'admin_account_created'
        : 'relationship_manager_account_created',
    );
    for (const column of [
      'portfolio_id_snapshot',
      'portfolio_name_snapshot',
      'previous_relationship_manager_id_snapshot',
      'previous_relationship_manager_name_snapshot',
      'previous_relationship_manager_email_snapshot',
      'new_relationship_manager_id_snapshot',
      'new_relationship_manager_name_snapshot',
      'new_relationship_manager_email_snapshot',
    ]) {
      assert.equal(row[column] ?? null, null, `${column} must be null for a staff audit`);
    }
    return;
  }
  assert.ok(
    ['portfolio_assigned', 'portfolio_unassigned', 'portfolio_reassigned'].includes(row.action),
    `unexpected superadmin audit action ${row.action}`,
  );
  assert.equal(row.portfolio_name_snapshot, `${context.runId} Portfolio`);
  for (const column of [
    'created_user_id_snapshot',
    'created_user_name_snapshot',
    'created_user_email_snapshot',
    'created_user_role',
  ]) {
    assert.equal(row[column] ?? null, null, `${column} must be null for an assignment audit`);
  }
  for (const [emailColumn, nameColumn] of [
    [
      'previous_relationship_manager_email_snapshot',
      'previous_relationship_manager_name_snapshot',
    ],
    ['new_relationship_manager_email_snapshot', 'new_relationship_manager_name_snapshot'],
  ]) {
    if (row[emailColumn] == null) continue;
    const expected = context.expectedUsers.get(String(row[emailColumn]).toLowerCase());
    assert.equal(expected?.role, 'relationship_manager', `${emailColumn} escaped scope`);
    assert.equal(row[nameColumn], expected.name);
  }
  const hasPrevious = row.previous_relationship_manager_email_snapshot != null;
  const hasNew = row.new_relationship_manager_email_snapshot != null;
  assert.equal(hasPrevious, row.action !== 'portfolio_assigned');
  assert.equal(hasNew, row.action !== 'portfolio_unassigned');
}

async function assertCompleteForeignKeyFootprint(context, resources) {
  const { database, verified } = context;
  const userIds = [...verified.userIds];
  const portfolioIds = [...verified.portfolioIds];
  const conversationIds = [...verified.conversationIds];
  const messageIds = [...verified.messageIds];
  if (userIds.length) {
    const [portfolios] = await database.query(
      `SELECT id FROM portfolios
        WHERE owner_id IN (${placeholders(userIds)})
           OR relationship_manager_id IN (${placeholders(userIds)}) FOR UPDATE`,
      [...userIds, ...userIds],
    );
    assertRowsWithin(portfolios, verified.portfolioIds, 'portfolio');
  }
  if (userIds.length || portfolioIds.length) {
    const interestClauses = [];
    const interestParams = [];
    if (userIds.length) {
      interestClauses.push(`investor_id IN (${placeholders(userIds)})`);
      interestParams.push(...userIds);
    }
    if (portfolioIds.length) {
      interestClauses.push(`portfolio_id IN (${placeholders(portfolioIds)})`);
      interestParams.push(...portfolioIds);
    }
    const [interests] = await database.query(
      `SELECT id FROM investor_interests WHERE ${interestClauses.join(' OR ')} FOR UPDATE`,
      interestParams,
    );
    assertRowsWithin(interests, verified.interestIds, 'interest');
  }
  if (portfolioIds.length) {
    const [documents] = await database.query(
      `SELECT id FROM portfolio_documents
        WHERE portfolio_id IN (${placeholders(portfolioIds)}) FOR UPDATE`,
      portfolioIds,
    );
    assertRowsWithin(documents, verified.documentIds, 'document');
  }
  if (userIds.length || portfolioIds.length) {
    const clauses = [];
    const params = [];
    if (userIds.length) {
      clauses.push(`relationship_manager_id IN (${placeholders(userIds)})`);
      params.push(...userIds);
    }
    if (portfolioIds.length) {
      clauses.push(`portfolio_id IN (${placeholders(portfolioIds)})`);
      params.push(...portfolioIds);
    }
    const [conversations] = await database.query(
      `SELECT id FROM conversations WHERE ${clauses.join(' OR ')} FOR UPDATE`,
      params,
    );
    assertRowsWithin(conversations, verified.conversationIds, 'conversation');
  }
  if (userIds.length || conversationIds.length) {
    const clauses = [];
    const params = [];
    if (userIds.length) {
      clauses.push(`user_id IN (${placeholders(userIds)})`);
      params.push(...userIds);
    }
    if (conversationIds.length) {
      clauses.push(`conversation_id IN (${placeholders(conversationIds)})`);
      params.push(...conversationIds);
    }
    const [memberships] = await database.query(
      `SELECT conversation_id,user_id FROM conversation_members
        WHERE ${clauses.join(' OR ')} FOR UPDATE`,
      params,
    );
    const owned = new Set(resources.memberships.map(
      ({ conversation_id: conversationId, user_id: userId }) => `${conversationId}:${userId}`,
    ));
    for (const row of memberships) {
      assert.ok(
        owned.has(`${row.conversation_id}:${row.user_id}`),
        'conversation membership foreign-key footprint escaped scope',
      );
    }
  }
  if (userIds.length || conversationIds.length) {
    const clauses = [];
    const params = [];
    if (userIds.length) {
      clauses.push(`sender_id IN (${placeholders(userIds)})`);
      params.push(...userIds);
    }
    if (conversationIds.length) {
      clauses.push(`conversation_id IN (${placeholders(conversationIds)})`);
      params.push(...conversationIds);
    }
    const [messages] = await database.query(
      `SELECT id FROM messages WHERE ${clauses.join(' OR ')} FOR UPDATE`,
      params,
    );
    assertRowsWithin(messages, verified.messageIds, 'message');
  }
  if (userIds.length || portfolioIds.length || conversationIds.length || messageIds.length) {
    const clauses = [];
    const params = [];
    for (const [column, ids] of [
      ['user_id', userIds],
      ['related_user_id', userIds],
      ['related_portfolio_id', portfolioIds],
      ['related_conversation_id', conversationIds],
      ['related_message_id', messageIds],
    ]) {
      if (!ids.length) continue;
      clauses.push(`${column} IN (${placeholders(ids)})`);
      params.push(...ids);
    }
    const [notifications] = await database.query(
      `SELECT id FROM notifications WHERE ${clauses.join(' OR ')} FOR UPDATE`,
      params,
    );
    assertRowsWithin(notifications, verified.notificationIds, 'notification');
  }
  if (userIds.length || portfolioIds.length) {
    const clauses = [];
    const params = [];
    if (userIds.length) {
      clauses.push(`admin_id IN (${placeholders(userIds)})`);
      params.push(...userIds);
    }
    if (portfolioIds.length) {
      clauses.push(`portfolio_id IN (${placeholders(portfolioIds)})`);
      params.push(...portfolioIds);
    }
    const [audits] = await database.query(
      `SELECT id FROM audit_logs WHERE ${clauses.join(' OR ')} FOR UPDATE`,
      params,
    );
    assertRowsWithin(audits, verified.moderationAuditIds, 'moderation audit');

    const superadminColumns = [
      'superadmin_id',
      'created_user_id',
      'previous_relationship_manager_id',
      'new_relationship_manager_id',
    ];
    const superadminClauses = [];
    const superadminParams = [];
    if (userIds.length) {
      for (const column of superadminColumns) {
        superadminClauses.push(`${column} IN (${placeholders(userIds)})`);
        superadminParams.push(...userIds);
      }
    }
    if (portfolioIds.length) {
      superadminClauses.push(`portfolio_id IN (${placeholders(portfolioIds)})`);
      superadminParams.push(...portfolioIds);
    }
    const [superadminAudits] = await database.query(
      `SELECT id FROM superadmin_audit_logs
        WHERE ${superadminClauses.join(' OR ')} FOR UPDATE`,
      superadminParams,
    );
    assertRowsWithin(superadminAudits, verified.superadminAuditIds, 'superadmin audit');
  }
}

async function reconcileTemporaryRecords(context, { lock = false } = {}) {
  const {
    database, runId, emails, reported,
  } = context;
  const verified = resetVerified(context);
  const suffix = lock ? ' FOR UPDATE' : '';
  const resources = {
    superadminAudits: [],
    moderationAudits: [],
    notifications: [],
    messages: [],
    memberships: [],
    conversations: [],
    interests: [],
    documents: [],
    portfolios: [],
    users: [],
  };
  const expectedEmails = [...context.expectedUsers.keys()];
  if (expectedEmails.length) {
    [resources.users] = await database.query(
      `SELECT id,email,name,role FROM users WHERE email IN (${placeholders(expectedEmails)})
       ORDER BY id${suffix}`,
      expectedEmails,
    );
  }
  for (const user of resources.users) {
    const email = String(user.email).toLowerCase();
    const expected = context.expectedUsers.get(email);
    assert.ok(expected, `user ${email} is outside the exact issued identity scope`);
    assert.equal(user.name, expected.name, `${email} name changed`);
    assert.equal(user.role, expected.role, `${email} role changed`);
    const id = positiveId(user.id, `${email} ID`);
    verified.userIds.add(id);
    context.userEmails.set(id, email);
    context.userRoles.set(id, expected.role);
  }
  await verifyReportedIds({
    database,
    reportedIds: reported.userIds,
    verifiedIds: verified.userIds,
    label: 'user',
    loadExisting: async (connection, ids) => (
      await connection.query(
        `SELECT id,email,name,role FROM users WHERE id IN (${placeholders(ids)})${suffix}`,
        ids,
      )
    )[0],
  });

  const staffEmails = [...context.expectedUsers.values()]
    .filter(({ role }) => ['admin', 'relationship_manager'].includes(role))
    .map(({ email }) => email);
  [resources.superadminAudits] = await database.query(
    `SELECT id,superadmin_id,superadmin_id_snapshot,superadmin_name_snapshot,
            superadmin_email_snapshot,action,portfolio_id,portfolio_id_snapshot,
            portfolio_name_snapshot,previous_relationship_manager_id,
            previous_relationship_manager_id_snapshot,previous_relationship_manager_name_snapshot,
            previous_relationship_manager_email_snapshot,new_relationship_manager_id,
            new_relationship_manager_id_snapshot,new_relationship_manager_name_snapshot,
            new_relationship_manager_email_snapshot,created_user_id,created_user_id_snapshot,
            created_user_name_snapshot,created_user_email_snapshot,created_user_role
      FROM superadmin_audit_logs
      WHERE superadmin_email_snapshot=?
         OR created_user_email_snapshot IN (${placeholders(staffEmails)})
      ORDER BY id${suffix}`,
    [emails.superadmin, ...staffEmails],
  );
  for (const row of resources.superadminAudits) {
    assertNaturalSuperadminAudit(context, row);
    assert.equal(
      String(row.superadmin_email_snapshot).toLowerCase(),
      emails.superadmin,
      'superadmin audit actor snapshot escaped exact scope',
    );
    verified.superadminAuditIds.add(auditId(row.id, 'superadmin audit ID'));
    for (const column of [
      'superadmin_id',
      'previous_relationship_manager_id',
      'new_relationship_manager_id',
      'created_user_id',
    ]) {
      assert.ok(
        row[column] == null || verified.userIds.has(Number(row[column])),
        `superadmin audit ${column} escaped scope`,
      );
    }
  }
  await verifyReportedIds({
    database,
    reportedIds: reported.superadminAuditIds,
    verifiedIds: verified.superadminAuditIds,
    label: 'superadmin audit',
    loadExisting: async (connection, ids) => (
      await connection.query(
        `SELECT id FROM superadmin_audit_logs WHERE id IN (${placeholders(ids)})${suffix}`,
        ids,
      )
    )[0],
  });

  const owner = resources.users.find(({ email }) => String(email).toLowerCase() === emails.owner);
  if (!owner) {
    for (const row of resources.superadminAudits) {
      assert.equal(row.portfolio_id ?? null, null, 'superadmin audit portfolio escaped scope');
    }
    if (lock) await assertCompleteForeignKeyFootprint(context, resources);
    return resources;
  }
  [resources.portfolios] = await database.query(
    `SELECT id,owner_id,name,relationship_manager_id FROM portfolios
      WHERE owner_id=? AND name=?${suffix}`,
    [owner.id, `${runId} Portfolio`],
  );
  assert.ok(resources.portfolios.length <= 1, 'temporary portfolio identity is ambiguous');
  for (const portfolio of resources.portfolios) {
    assert.equal(Number(portfolio.owner_id), Number(owner.id), 'portfolio owner escaped scope');
    assert.equal(portfolio.name, `${runId} Portfolio`, 'portfolio name escaped scope');
    assert.ok(
      portfolio.relationship_manager_id == null
        || resources.users.some((user) => (
          user.role === 'relationship_manager'
          && Number(user.id) === Number(portfolio.relationship_manager_id)
        )),
      'portfolio relationship manager escaped scope',
    );
    verified.portfolioIds.add(positiveId(portfolio.id, 'portfolio ID'));
  }
  await verifyReportedIds({
    database,
    reportedIds: reported.portfolioIds,
    verifiedIds: verified.portfolioIds,
    label: 'portfolio',
    loadExisting: async (connection, ids) => (
      await connection.query(
        `SELECT id FROM portfolios WHERE id IN (${placeholders(ids)})${suffix}`,
        ids,
      )
    )[0],
  });
  if (!resources.portfolios.length) {
    for (const row of resources.superadminAudits) {
      assert.equal(row.portfolio_id ?? null, null, 'superadmin audit portfolio escaped scope');
    }
    if (lock) await assertCompleteForeignKeyFootprint(context, resources);
    return resources;
  }

  const portfolioId = Number(resources.portfolios[0].id);
  [resources.documents] = await database.query(
    `SELECT id,portfolio_id,file_name,file_url FROM portfolio_documents
      WHERE portfolio_id=? AND file_name=?${suffix}`,
    [portfolioId, `${runId}.pdf`],
  );
  for (const row of resources.documents) {
    assert.equal(Number(row.portfolio_id), portfolioId);
    assert.equal(row.file_name, `${runId}.pdf`);
    verified.documentIds.add(positiveId(row.id, 'document ID'));
  }

  const investorIds = resources.users
    .filter(({ role }) => role === 'investor')
    .map(({ id }) => Number(id));
  if (investorIds.length) {
    [resources.interests] = await database.query(
      `SELECT id,portfolio_id,investor_id FROM investor_interests
        WHERE portfolio_id=? AND investor_id IN (${placeholders(investorIds)})${suffix}`,
      [portfolioId, ...investorIds],
    );
  }
  for (const row of resources.interests) {
    assert.ok(investorIds.includes(Number(row.investor_id)), 'interest investor escaped scope');
    verified.interestIds.add(positiveId(row.id, 'interest ID'));
  }

  const managerIds = resources.users
    .filter(({ role }) => role === 'relationship_manager')
    .map(({ id }) => Number(id));
  if (managerIds.length) {
    [resources.conversations] = await database.query(
      `SELECT c.id,c.portfolio_id,c.relationship_manager_id FROM conversations c
        WHERE c.portfolio_id=?
          AND c.relationship_manager_id IN (${placeholders(managerIds)})${suffix}`,
      [portfolioId, ...managerIds],
    );
  }
  assert.ok(resources.conversations.length <= 1, 'temporary conversation identity is ambiguous');
  for (const row of resources.conversations) {
    assert.ok(managerIds.includes(Number(row.relationship_manager_id)), 'conversation manager escaped scope');
    assert.equal(
      Number(row.relationship_manager_id),
      Number(resources.portfolios[0].relationship_manager_id),
      'portfolio and conversation managers diverged',
    );
    verified.conversationIds.add(positiveId(row.id, 'conversation ID'));
  }
  const conversationIds = [...verified.conversationIds];
  if (conversationIds.length) {
    [resources.memberships] = await database.query(
      `SELECT conversation_id,user_id,member_role,membership_status,visible_after_message_id
         FROM conversation_members WHERE conversation_id=?${suffix}`,
      conversationIds,
    );
    for (const row of resources.memberships) {
      assert.ok(verified.userIds.has(Number(row.user_id)), 'conversation member escaped scope');
      assert.equal(
        row.member_role,
        context.userRoles.get(Number(row.user_id)),
        'conversation member role escaped scope',
      );
    }
    [resources.messages] = await database.query(
      `SELECT id,conversation_id,sender_id,content FROM messages
        WHERE conversation_id=? AND content LIKE ?${suffix}`,
      [conversationIds[0], `${runId}%`],
    );
    for (const row of resources.messages) {
      assert.ok(verified.userIds.has(Number(row.sender_id)), 'message sender escaped scope');
      verified.messageIds.add(positiveId(row.id, 'message ID'));
    }
  }

  [resources.notifications] = await database.query(
    `SELECT n.id,n.user_id,n.type,n.related_portfolio_id,n.related_conversation_id,
            n.related_message_id,n.related_user_id,recipient.role AS recipient_role
       FROM notifications n JOIN users recipient ON recipient.id=n.user_id
      WHERE n.related_portfolio_id=?${suffix}`,
    [portfolioId],
  );
  for (const row of resources.notifications) {
    assert.ok(
      verified.userIds.has(Number(row.user_id))
        || (row.type === 'portfolio_submitted' && row.recipient_role === 'admin'),
      'notification recipient escaped scope',
    );
    assert.ok(
      row.related_user_id == null || verified.userIds.has(Number(row.related_user_id)),
      'notification related user escaped scope',
    );
    assert.ok(
      row.related_conversation_id == null
        || verified.conversationIds.has(Number(row.related_conversation_id)),
      'notification conversation escaped scope',
    );
    assert.ok(
      row.related_message_id == null || verified.messageIds.has(Number(row.related_message_id)),
      'notification message escaped scope',
    );
    verified.notificationIds.add(positiveId(row.id, 'notification ID'));
  }

  [resources.moderationAudits] = await database.query(
    `SELECT id,admin_id,action,portfolio_id,reason FROM audit_logs
      WHERE portfolio_id=?${suffix}`,
    [portfolioId],
  );
  const adminIds = resources.users.filter(({ role }) => role === 'admin').map(({ id }) => Number(id));
  for (const row of resources.moderationAudits) {
    assert.ok(adminIds.includes(Number(row.admin_id)), 'moderation actor escaped scope');
    verified.moderationAuditIds.add(positiveId(row.id, 'moderation audit ID'));
  }

  for (const [key, table] of [
    ['documentIds', 'portfolio_documents'],
    ['interestIds', 'investor_interests'],
    ['conversationIds', 'conversations'],
    ['messageIds', 'messages'],
    ['notificationIds', 'notifications'],
    ['moderationAuditIds', 'audit_logs'],
  ]) {
    await verifyReportedIds({
      database,
      reportedIds: reported[key],
      verifiedIds: verified[key],
      label: key,
      loadExisting: async (connection, ids) => (
        await connection.query(
          `SELECT id FROM ${table} WHERE id IN (${placeholders(ids)})${suffix}`,
          ids,
        )
      )[0],
    });
  }
  for (const row of resources.superadminAudits) {
    for (const column of [
      'superadmin_id',
      'previous_relationship_manager_id',
      'new_relationship_manager_id',
      'created_user_id',
    ]) {
      assert.ok(
        row[column] == null || verified.userIds.has(Number(row[column])),
        `superadmin audit ${column} escaped scope`,
      );
    }
    assert.ok(
      row.portfolio_id == null || verified.portfolioIds.has(Number(row.portfolio_id)),
      'superadmin audit portfolio_id escaped scope',
    );
  }
  if (lock) await assertCompleteForeignKeyFootprint(context, resources);
  return resources;
}

async function verifyTemporaryResources(context) {
  return reconcileTemporaryRecords(context, { lock: true });
}

async function assertCleanupComplete(context) {
  const { database, verified, runId } = context;
  const idChecks = [
    ['users', verified.userIds],
    ['portfolios', verified.portfolioIds],
    ['investor_interests', verified.interestIds],
    ['portfolio_documents', verified.documentIds],
    ['conversations', verified.conversationIds],
    ['messages', verified.messageIds],
    ['notifications', verified.notificationIds],
    ['audit_logs', verified.moderationAuditIds],
    ['superadmin_audit_logs', verified.superadminAuditIds],
  ];
  for (const [table, idsSet] of idChecks) {
    const ids = [...idsSet];
    if (!ids.length) continue;
    const [[row]] = await database.query(
      `SELECT COUNT(*) AS count FROM ${table} WHERE id IN (${placeholders(ids)})`,
      ids,
    );
    assert.equal(Number(row.count), 0, `${table} tracked rows remain`);
  }
  const conversationIds = [...verified.conversationIds];
  if (conversationIds.length) {
    const [[members]] = await database.query(
      `SELECT COUNT(*) AS count FROM conversation_members
        WHERE conversation_id IN (${placeholders(conversationIds)})`,
      conversationIds,
    );
    assert.equal(Number(members.count), 0, 'conversation_members tracked rows remain');
  }
  const [[uuidUsers]] = await database.query(
    'SELECT COUNT(*) AS count FROM users WHERE email LIKE ?',
    [`${runId}%`],
  );
  assert.equal(Number(uuidUsers.count), 0, 'UUID-prefixed users remain');
}

async function deleteRows(database, sql, params, expected, label) {
  const [result] = await database.query(sql, params);
  requireAffectedRows(result, expected, label);
}

async function cleanTemporaryRecords(context) {
  const { database, runId } = context;
  if (!database) return;
  let transactionOpen = false;
  let committed = false;
  let primaryError;
  try {
    await reconcileTemporaryRecords(context);
    await database.beginTransaction();
    transactionOpen = true;
    const resources = await verifyTemporaryResources(context);
    context.stagedFiles = await stageDocumentFiles(resources.documents);

    if (resources.superadminAudits.length) {
      const ids = resources.superadminAudits.map(({ id }) => String(id));
      await deleteRows(
        database,
        `DELETE FROM superadmin_audit_logs
          WHERE id IN (${placeholders(ids)}) AND superadmin_email_snapshot=?`,
        [...ids, context.emails.superadmin],
        ids.length,
        'superadmin audit cleanup',
      );
    }
    if (resources.moderationAudits.length) {
      const ids = resources.moderationAudits.map(({ id }) => Number(id));
      const portfolioIds = [...context.verified.portfolioIds];
      await deleteRows(
        database,
        `DELETE FROM audit_logs WHERE id IN (${placeholders(ids)})
          AND portfolio_id IN (${placeholders(portfolioIds)})`,
        [...ids, ...portfolioIds],
        ids.length,
        'moderation audit cleanup',
      );
    }
    if (resources.notifications.length) {
      const ids = resources.notifications.map(({ id }) => Number(id));
      const portfolioIds = [...context.verified.portfolioIds];
      await deleteRows(
        database,
        `DELETE FROM notifications WHERE id IN (${placeholders(ids)})
          AND related_portfolio_id IN (${placeholders(portfolioIds)})`,
        [...ids, ...portfolioIds],
        ids.length,
        'notification cleanup',
      );
    }
    if (resources.messages.length) {
      const ids = resources.messages.map(({ id }) => Number(id));
      const conversationIds = [...context.verified.conversationIds];
      await deleteRows(
        database,
        `DELETE FROM messages WHERE id IN (${placeholders(ids)})
          AND conversation_id IN (${placeholders(conversationIds)}) AND content LIKE ?`,
        [...ids, ...conversationIds, `${runId}%`],
        ids.length,
        'message cleanup',
      );
    }
    if (resources.memberships.length) {
      const conversationIds = [...context.verified.conversationIds];
      const userIds = [...context.verified.userIds];
      await deleteRows(
        database,
        `DELETE FROM conversation_members
          WHERE conversation_id IN (${placeholders(conversationIds)})
            AND user_id IN (${placeholders(userIds)})`,
        [...conversationIds, ...userIds],
        resources.memberships.length,
        'conversation membership cleanup',
      );
    }
    if (resources.conversations.length) {
      const ids = resources.conversations.map(({ id }) => Number(id));
      const portfolioIds = [...context.verified.portfolioIds];
      const managerIds = resources.users
        .filter(({ role }) => role === 'relationship_manager')
        .map(({ id }) => Number(id));
      await deleteRows(
        database,
        `DELETE FROM conversations WHERE id IN (${placeholders(ids)})
          AND portfolio_id IN (${placeholders(portfolioIds)})
          AND relationship_manager_id IN (${placeholders(managerIds)})`,
        [...ids, ...portfolioIds, ...managerIds],
        ids.length,
        'conversation cleanup',
      );
    }
    if (resources.interests.length) {
      const ids = resources.interests.map(({ id }) => Number(id));
      const portfolioIds = [...context.verified.portfolioIds];
      const investorIds = resources.users
        .filter(({ role }) => role === 'investor')
        .map(({ id }) => Number(id));
      await deleteRows(
        database,
        `DELETE FROM investor_interests WHERE id IN (${placeholders(ids)})
          AND portfolio_id IN (${placeholders(portfolioIds)})
          AND investor_id IN (${placeholders(investorIds)})`,
        [...ids, ...portfolioIds, ...investorIds],
        ids.length,
        'interest cleanup',
      );
    }
    if (resources.documents.length) {
      const ids = resources.documents.map(({ id }) => Number(id));
      const portfolioIds = [...context.verified.portfolioIds];
      await deleteRows(
        database,
        `DELETE FROM portfolio_documents WHERE id IN (${placeholders(ids)})
          AND portfolio_id IN (${placeholders(portfolioIds)}) AND file_name=?`,
        [...ids, ...portfolioIds, `${runId}.pdf`],
        ids.length,
        'document cleanup',
      );
    }
    if (resources.portfolios.length) {
      const ids = resources.portfolios.map(({ id }) => Number(id));
      const owner = resources.users.find(({ email }) => (
        String(email).toLowerCase() === context.emails.owner
      ));
      await deleteRows(
        database,
        `DELETE FROM portfolios WHERE id IN (${placeholders(ids)})
          AND owner_id=? AND name=?`,
        [...ids, Number(owner.id), `${runId} Portfolio`],
        ids.length,
        'portfolio cleanup',
      );
    }
    if (resources.users.length) {
      const ids = resources.users.map(({ id }) => Number(id));
      const tuples = resources.users.map(() => '(?,?,?)').join(',');
      await deleteRows(
        database,
        `DELETE FROM users WHERE id IN (${placeholders(ids)})
          AND (email,role,name) IN (${tuples})`,
        [
          ...ids,
          ...resources.users.flatMap(({ email, role, name }) => [email, role, name]),
        ],
        ids.length,
        'user cleanup',
      );
    }
    await database.commit();
    transactionOpen = false;
    committed = true;
  } catch (error) {
    if (Array.isArray(error.stagedFiles)) context.stagedFiles = error.stagedFiles;
    primaryError = error;
    if (transactionOpen) {
      try {
        await database.rollback();
      } catch (rollbackError) {
        primaryError = combinedError(
          primaryError,
          rollbackError,
          'Cleanup and rollback failed',
        );
      }
    }
  }
  await settleStagedFiles(context.stagedFiles, {
    committed,
    primaryError,
  });
  context.stagedFiles = [];
  if (committed) {
    await assertCleanupComplete(context);
  }
}

function assertAssignmentResult(result, {
  action,
  portfolioId,
  previousManager,
  manager,
  conversationId,
}) {
  assert.equal(result.changed, true, `${action} must report a mutation`);
  assert.equal(result.action, action);
  assert.equal(Number(result.portfolio?.id), Number(portfolioId));
  assert.deepEqual(
    result.previous_relationship_manager,
    previousManager
      ? { id: Number(previousManager.id), name: previousManager.name, email: previousManager.email }
      : null,
  );
  assert.deepEqual(
    result.relationship_manager,
    manager ? { id: Number(manager.id), name: manager.name, email: manager.email } : null,
  );
  assert.equal(
    result.conversation_id == null ? null : Number(result.conversation_id),
    conversationId == null ? null : Number(conversationId),
  );
}

async function runFiveRoleFlow(context, origin) {
  const {
    database, runId, emails, credential, identities, reported,
  } = context;
  const api = (requestPath, options = {}) => requestApi(origin, requestPath, {
    expectedStatus: 200,
    signal: context.abortController.signal,
    ...options,
  });
  const login = async (email) => {
    const session = (await api('/auth/login', {
      method: 'POST',
      body: { email, password: credential },
    })).data;
    assert.equal(typeof session.token, 'string', 'login token is missing');
    assert.ok(session.token.length > 20, 'login token is unexpectedly short');
    const expected = context.expectedUsers.get(email);
    const id = [...context.userEmails].find(([, issuedEmail]) => issuedEmail === email)?.[0];
    assertExactUser(session.user, { id, ...expected }, 'login user');
    return session;
  };
  const createStaff = async (role, email, name, superadmin) => trackUser(
    context,
    (await api('/superadmin/staff', {
      method: 'POST',
      expectedStatus: 201,
      token: superadmin.token,
      body: { role, email, name, password: credential },
    })).data,
    email,
    role,
  );
  const register = async (role, email, name) => {
    const session = (await api('/auth/register', {
      method: 'POST',
      expectedStatus: 201,
      body: { role, email, name, password: credential },
    })).data;
    trackUser(context, session.user, email, role);
    return session;
  };

  assert.equal((await api('/ready')).data.status, 'ready');
  const superadminHash = await bcrypt.hash(credential, 10);
  const [superadminInsert] = await database.execute(
    "INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,'superadmin')",
    [emails.superadmin, superadminHash, `${runId} Superadmin`],
  );
  identities.superadmin = trackUser(
    context,
    {
      id: superadminInsert.insertId,
      email: emails.superadmin,
      name: `${runId} Superadmin`,
      role: 'superadmin',
    },
    emails.superadmin,
    'superadmin',
  );
  const superadmin = await login(emails.superadmin);

  identities.admin = await createStaff(
    'admin',
    emails.admin,
    `${runId} Admin`,
    superadmin,
  );
  identities.manager1 = await createStaff(
    'relationship_manager',
    emails.manager1,
    `${runId} Manager One`,
    superadmin,
  );
  identities.manager2 = await createStaff(
    'relationship_manager',
    emails.manager2,
    `${runId} Manager Two`,
    superadmin,
  );
  const admin = await login(emails.admin);
  const manager1 = await login(emails.manager1);
  const manager2 = await login(emails.manager2);
  const owner = await register(
    'business_owner',
    emails.owner,
    `${runId} Owner`,
  );
  identities.owner = owner.user;
  const investor1 = await register(
    'investor',
    emails.investor1,
    `${runId} Investor One`,
  );
  identities.investor1 = investor1.user;
  const investor2 = await register(
    'investor',
    emails.investor2,
    `${runId} Investor Two`,
  );
  identities.investor2 = investor2.user;
  await reconcileTemporaryRecords(context);
  for (const id of reported.userIds) {
    assert.ok(context.verified.userIds.has(id), `reported user ${id} was not naturally verified`);
  }

  for (const [session, identity] of [
    [superadmin, identities.superadmin],
    [admin, identities.admin],
    [manager1, identities.manager1],
    [manager2, identities.manager2],
    [owner, identities.owner],
    [investor1, identities.investor1],
    [investor2, identities.investor2],
  ]) {
    assertExactUser(
      (await api('/auth/me', { token: session.token })).data,
      identity,
      'auth/me',
    );
  }
  await expectStatus(api('/superadmin/stats', { token: admin.token }), 403);
  await expectStatus(api('/admin/stats', { token: superadmin.token }), 403);
  await expectStatus(api('/messages/conversations', { token: admin.token }), 403);
  await expectStatus(api('/messages/conversations', { token: superadmin.token }), 403);
  await expectStatus(api('/relationship-manager/dashboard', { token: admin.token }), 403);
  await expectStatus(api('/relationship-manager/dashboard', { token: superadmin.token }), 403);
  await expectStatus(api('/admin/stats', { token: manager1.token }), 403);
  const forbiddenEmail = generatedEmail(runId, 'forbidden');
  context.issuedEmails.add(forbiddenEmail);
  context.expectedUsers.set(forbiddenEmail, {
    email: forbiddenEmail,
    name: `${runId} Forbidden`,
    role: 'admin',
  });
  await expectStatus(api('/superadmin/staff', {
    method: 'POST',
    token: admin.token,
    body: {
      role: 'admin',
      email: forbiddenEmail,
      name: `${runId} Forbidden`,
      password: credential,
    },
  }), 403);

  const portfolio = (await api('/portfolios', {
    method: 'POST',
    expectedStatus: 201,
    token: owner.token,
    body: {
      name: `${runId} Portfolio`,
      sector: 'Technology',
      mvp_status: 'Beta',
      description: 'Temporary five-role verification portfolio with complete release fields.',
      funding_goal: 100000,
      team_size: 3,
      founded_year: 2026,
      location: 'Singapore',
      website: '',
      monthly_revenue: 1000,
      user_count: 10,
      growth_rate: 5,
      market_size: 'Temporary release verification market',
      competitor_analysis: 'Temporary release verification competitors',
      advisor_names: '',
      burn_rate: 100,
      runway_months: 12,
    },
  })).data;
  const portfolioId = positiveId(portfolio.id, 'portfolio ID');
  reported.portfolioIds.add(portfolioId);
  assert.equal(Number(portfolio.owner_id), Number(owner.user.id));
  assert.equal(portfolio.name, `${runId} Portfolio`);
  await bindReportedId(context, 'portfolioIds', portfolioId, 'portfolio');
  await expectStatus(api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    token: admin.token,
    body: { relationship_manager_id: identities.manager1.id },
  }), 403);
  await expectStatus(api(`/admin/portfolios/${portfolioId}/approve`, {
    method: 'PUT',
    token: superadmin.token,
  }), 403);

  const form = new FormData();
  form.append(
    'documents',
    new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }),
    `${runId}.pdf`,
  );
  const upload = (await api(`/portfolios/${portfolioId}/documents`, {
    method: 'POST',
    expectedStatus: 201,
    token: owner.token,
    form,
  })).data;
  assert.equal(upload.documents.length, 1);
  const documentId = positiveId(upload.documents[0].id, 'document ID');
  reported.documentIds.add(documentId);
  assert.equal(upload.documents[0].file_name, `${runId}.pdf`);
  await bindReportedId(context, 'documentIds', documentId, 'document');

  const [allAdmins] = await database.query("SELECT id FROM users WHERE role='admin' ORDER BY id");
  let marker = await tableMaximum(database, 'notifications');
  await api(`/portfolios/${portfolioId}/submit`, {
    method: 'POST',
    token: owner.token,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_submitted',
    allAdmins.map(({ id }) => Number(id)),
    'initial submission',
    { relatedUserId: owner.user.id },
  );
  marker = await tableMaximum(database, 'notifications');
  await api(`/admin/portfolios/${portfolioId}/approve`, {
    method: 'PUT',
    token: admin.token,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_approved',
    [owner.user.id],
    'initial approval',
    { relatedUserId: identities.admin.id },
  );

  marker = await tableMaximum(database, 'notifications');
  const firstAssignment = (await api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    token: superadmin.token,
    body: { relationship_manager_id: identities.manager1.id },
  })).data;
  assertAssignmentResult(firstAssignment, {
    action: 'portfolio_assigned',
    portfolioId,
    previousManager: null,
    manager: identities.manager1,
    conversationId: null,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_assigned',
    [owner.user.id, identities.manager1.id],
    'initial assignment',
    { relatedUserId: identities.manager1.id },
  );

  const managerDetailBeforeInterest = (await api(
    `/relationship-manager/portfolios/${portfolioId}`,
    { token: manager1.token },
  )).data;
  assert.equal(managerDetailBeforeInterest.actions.can_create_conversation, false);
  assert.match(managerDetailBeforeInterest.actions.create_disabled_reason, /investor/i);
  const downloaded = (await api(
    `/portfolios/${portfolioId}/documents/${documentId}/download`,
    { token: manager1.token, binary: true },
  )).data;
  assert.equal(downloaded.subarray(0, 4).toString(), '%PDF');
  await expectStatus(api(`/relationship-manager/portfolios/${portfolioId}`, {
    token: manager2.token,
  }), 403);

  marker = await tableMaximum(database, 'notifications');
  const unassigned = (await api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'DELETE',
    token: superadmin.token,
  })).data;
  assertAssignmentResult(unassigned, {
    action: 'portfolio_unassigned',
    portfolioId,
    previousManager: identities.manager1,
    manager: null,
    conversationId: null,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_unassigned',
    [owner.user.id, identities.manager1.id],
    'pre-chat unassignment',
    { relatedUserId: identities.manager1.id },
  );

  marker = await tableMaximum(database, 'notifications');
  const assignedAgain = (await api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    token: superadmin.token,
    body: { relationship_manager_id: identities.manager1.id },
  })).data;
  assertAssignmentResult(assignedAgain, {
    action: 'portfolio_assigned',
    portfolioId,
    previousManager: null,
    manager: identities.manager1,
    conversationId: null,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_assigned',
    [owner.user.id, identities.manager1.id],
    'second assignment',
    { relatedUserId: identities.manager1.id },
  );

  marker = await tableMaximum(database, 'notifications');
  assert.equal((await api(`/interests/${portfolioId}`, {
    method: 'POST',
    expectedStatus: 201,
    token: investor1.token,
  })).status, 201);
  await assertNewNotifications(
    context,
    marker,
    'new_interest',
    [owner.user.id, identities.manager1.id],
    'first investor interest',
    { relatedUserId: investor1.user.id },
  );
  marker = await tableMaximum(database, 'notifications');
  assert.equal((await api(`/interests/${portfolioId}`, {
    method: 'POST',
    expectedStatus: 201,
    token: investor2.token,
  })).status, 201);
  await assertNewNotifications(
    context,
    marker,
    'new_interest',
    [owner.user.id, identities.manager1.id],
    'second investor interest',
    { relatedUserId: investor2.user.id },
  );

  const managerDetail = (await api(`/relationship-manager/portfolios/${portfolioId}`, {
    token: manager1.token,
  })).data;
  const interest1Id = positiveId(
    managerDetail.interests.find(({ investor }) => (
      Number(investor.id) === Number(investor1.user.id)
    ))?.interest_id,
    'first interest ID',
  );
  const interest2Id = positiveId(
    managerDetail.interests.find(({ investor }) => (
      Number(investor.id) === Number(investor2.user.id)
    ))?.interest_id,
    'second interest ID',
  );
  reported.interestIds.add(interest1Id);
  reported.interestIds.add(interest2Id);
  await bindReportedId(context, 'interestIds', interest1Id, 'first interest');
  assert.ok(context.verified.interestIds.has(interest2Id), 'second interest was not naturally verified');

  marker = await tableMaximum(database, 'notifications');
  const createdConversation = (await api('/relationship-manager/conversations', {
    method: 'POST',
    expectedStatus: 201,
    token: manager1.token,
    body: { portfolio_id: portfolioId, interest_ids: [interest1Id, interest2Id] },
  })).data;
  const conversationId = positiveId(createdConversation.conversation_id, 'conversation ID');
  reported.conversationIds.add(conversationId);
  await bindReportedId(context, 'conversationIds', conversationId, 'conversation');
  assert.deepEqual(
    sortedIds(createdConversation.investors.map(({ id }) => id)),
    sortedIds([investor1.user.id, investor2.user.id]),
  );
  await assertNewNotifications(
    context,
    marker,
    'conversation_created',
    [owner.user.id, investor1.user.id, investor2.user.id],
    'multi-investor conversation creation',
    {
      relatedConversationId: conversationId,
      relatedUserId: identities.manager1.id,
    },
  );

  const send = async (session, content, expectedRecipients) => {
    const notificationMarker = await tableMaximum(database, 'notifications');
    const saved = (await api(`/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      expectedStatus: 201,
      token: session.token,
      body: { content },
    })).data;
    const messageId = positiveId(saved.id, 'message ID');
    reported.messageIds.add(messageId);
    assert.equal(Number(saved.sender_id), Number(session.user.id));
    assert.equal(saved.content, content);
    await bindReportedId(context, 'messageIds', messageId, 'message');
    await assertNewNotifications(
      context,
      notificationMarker,
      'new_message',
      expectedRecipients,
      `message ${messageId}`,
      {
        relatedConversationId: conversationId,
        relatedMessageId: messageId,
        relatedUserId: session.user.id,
      },
    );
    return saved;
  };

  await send(manager1, `${runId} manager message`, [
    owner.user.id,
    investor1.user.id,
    investor2.user.id,
  ]);
  await send(owner, `${runId} owner message`, [
    identities.manager1.id,
    investor1.user.id,
    investor2.user.id,
  ]);
  await send(investor1, `${runId} first investor message`, [
    identities.manager1.id,
    owner.user.id,
    investor2.user.id,
  ]);
  const initialMessageIds = [...reported.messageIds];
  for (const session of [manager1, owner, investor1, investor2]) {
    const thread = (await api(`/messages/conversations/${conversationId}`, {
      token: session.token,
    })).data;
    assertExactIds(thread.messages, initialMessageIds, 'initial reloaded thread');
  }

  marker = await tableMaximum(database, 'notifications');
  const investor1Id = positiveId(investor1.user.id, 'first investor user ID');
  const removed = (await api(`/relationship-manager/conversations/${conversationId}/investors/${investor1Id}`,
    { method: 'DELETE', token: manager1.token },
  )).data;
  assert.equal(removed.changed, true);
  await assertNewNotifications(
    context,
    marker,
    'conversation_member_removed',
    [investor1.user.id, owner.user.id],
    'manual removal',
    {
      relatedConversationId: conversationId,
      relatedUserId: identities.manager1.id,
      nullConversationRecipients: [investor1.user.id],
    },
  );
  await expectStatus(api(`/messages/conversations/${conversationId}`, {
    token: investor1.token,
  }), 403);

  const boundaryMessage = await send(owner, `${runId} removal boundary`, [
    identities.manager1.id,
    investor2.user.id,
  ]);
  marker = await tableMaximum(database, 'notifications');
  const readded = (await api(`/relationship-manager/conversations/${conversationId}/investors`,
    {
      method: 'POST',
      token: manager1.token,
      body: { interest_ids: [interest1Id] },
    },
  )).data;
  assert.deepEqual(readded.added_investor_ids.map(Number), [Number(investor1.user.id)]);
  await assertNewNotifications(
    context,
    marker,
    'conversation_member_added',
    [investor1.user.id, owner.user.id, investor2.user.id],
    'investor re-addition',
    {
      relatedConversationId: conversationId,
      relatedUserId: identities.manager1.id,
    },
  );
  const rejoinedEmptyThread = (await api(`/messages/conversations/${conversationId}`, {
    token: investor1.token,
  })).data;
  assert.equal(rejoinedEmptyThread.messages.length, 0);
  const afterBoundary = await send(manager1, `${runId} after re-add`, [
    owner.user.id,
    investor1.user.id,
    investor2.user.id,
  ]);
  const rejoinedThread = (await api(`/messages/conversations/${conversationId}`, {
    token: investor1.token,
  })).data;
  assertExactIds(rejoinedThread.messages, [afterBoundary.id], 're-added investor boundary');
  assert.ok(Number(afterBoundary.id) > Number(boundaryMessage.id));

  marker = await tableMaximum(database, 'notifications');
  await api(`/interests/${portfolioId}`, {
    method: 'DELETE',
    token: investor2.token,
  });
  await assertNewNotifications(
    context,
    marker,
    'conversation_member_removed',
    [owner.user.id, identities.manager1.id],
    'interest withdrawal',
    {
      relatedConversationId: conversationId,
      relatedUserId: investor2.user.id,
    },
  );
  await expectStatus(api(`/messages/conversations/${conversationId}`, {
    token: investor2.token,
  }), 403);
  assert.equal(
    (await api('/messages/conversations', { token: investor2.token })).data
      .some(({ id }) => Number(id) === conversationId),
    false,
  );
  await expectStatus(api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'DELETE',
    token: superadmin.token,
  }), 409);

  const unchangedMessageIds = [...reported.messageIds];
  marker = await tableMaximum(database, 'notifications');
  const reassigned = (await api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    token: superadmin.token,
    body: { relationship_manager_id: identities.manager2.id },
  })).data;
  assertAssignmentResult(reassigned, {
    action: 'portfolio_reassigned',
    portfolioId,
    previousManager: identities.manager1,
    manager: identities.manager2,
    conversationId,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_reassigned',
    [owner.user.id, identities.manager1.id, identities.manager2.id],
    'post-chat reassignment',
    {
      relatedConversationId: conversationId,
      relatedUserId: identities.manager2.id,
      nullConversationRecipients: [identities.manager1.id],
    },
  );
  await expectStatus(api(`/messages/conversations/${conversationId}`, {
    token: manager1.token,
  }), 403);
  await expectStatus(api(`/relationship-manager/portfolios/${portfolioId}`, {
    token: manager1.token,
  }), 403);
  await expectStatus(api(`/relationship-manager/conversations/${conversationId}/investors`, {
    method: 'POST',
    token: manager1.token,
    body: { interest_ids: [interest1Id] },
  }), 403);
  await expectStatus(api(`/relationship-manager/conversations/${conversationId}/investors/${investor1Id}`, {
    method: 'DELETE',
    token: manager1.token,
  }), 403);
  const newManagerThread = (await api(`/messages/conversations/${conversationId}`, {
    token: manager2.token,
  })).data;
  assertExactIds(newManagerThread.messages, unchangedMessageIds, 'new manager full history');
  const [databaseMessages] = await database.query(
    'SELECT id FROM messages WHERE conversation_id=? ORDER BY id',
    [conversationId],
  );
  assertExactIds(databaseMessages, unchangedMessageIds, 'unchanged reassignment history');

  marker = await tableMaximum(database, 'notifications');
  await api(`/portfolios/${portfolioId}/submit`, {
    method: 'POST',
    token: owner.token,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_submitted',
    allAdmins.map(({ id }) => Number(id)),
    'approved resubmission and archive',
    {
      relatedUserId: owner.user.id,
      additionalExpected: expectedNotifications(
        context,
        'conversation_archived',
        [identities.manager2.id, investor1.user.id],
        {
          relatedConversationId: conversationId,
          relatedUserId: owner.user.id,
        },
      ),
    },
  );
  let archivedThread = (await api(`/messages/conversations/${conversationId}`, {
    token: owner.token,
  })).data;
  assert.equal(archivedThread.conversation.status, 'archived');
  assert.equal(archivedThread.conversation.archived_reason, 'portfolio_unapproved');
  await expectStatus(api(`/messages/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: owner.token,
    body: { content: `${runId} blocked archived send` },
  }), 409);

  marker = await tableMaximum(database, 'notifications');
  await api(`/admin/portfolios/${portfolioId}/reject`, {
    method: 'PUT',
    token: admin.token,
    body: { reason: `${runId} controlled rejection` },
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_rejected',
    [owner.user.id],
    'controlled rejection',
    { relatedUserId: identities.admin.id },
  );
  const draft = (await api(`/portfolios/${portfolioId}`, {
    method: 'PUT',
    token: owner.token,
    body: {},
  })).data;
  assert.equal(draft.status, 'draft');
  marker = await tableMaximum(database, 'notifications');
  await api(`/portfolios/${portfolioId}/submit`, {
    method: 'POST',
    token: owner.token,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_submitted',
    allAdmins.map(({ id }) => Number(id)),
    'reapproval submission',
    { relatedUserId: owner.user.id },
  );
  marker = await tableMaximum(database, 'notifications');
  await api(`/admin/portfolios/${portfolioId}/approve`, {
    method: 'PUT',
    token: admin.token,
  });
  await assertNewNotifications(
    context,
    marker,
    'portfolio_approved',
    [owner.user.id],
    'reapproval',
    { relatedUserId: identities.admin.id },
  );
  archivedThread = (await api(`/messages/conversations/${conversationId}`, {
    token: owner.token,
  })).data;
  assert.equal(archivedThread.conversation.status, 'active');
  assert.equal(archivedThread.conversation.archived_reason, null);
  assertExactIds(archivedThread.messages, unchangedMessageIds, 'restored owner history');

  const moderationApiRows = (await api('/admin/audit-logs', { token: admin.token })).data;
  assert.ok(Array.isArray(moderationApiRows), 'moderation audit API shape changed');
  const superadminApi = (await api('/superadmin/audit-logs?limit=100', {
    token: superadmin.token,
  })).data;
  assert.ok(Array.isArray(superadminApi.items), 'superadmin audit API shape changed');

  const [moderationRows] = await database.query(
    `SELECT id,admin_id,action,portfolio_id,reason FROM audit_logs
      WHERE portfolio_id=? ORDER BY id`,
    [portfolioId],
  );
  assertExactAuditEvents(moderationRows, [
    {
      admin_id: identities.admin.id,
      action: 'approved',
      portfolio_id: portfolioId,
      reason: null,
    },
    {
      admin_id: identities.admin.id,
      action: 'rejected',
      portfolio_id: portfolioId,
      reason: `${runId} controlled rejection`,
    },
    {
      admin_id: identities.admin.id,
      action: 'approved',
      portfolio_id: portfolioId,
      reason: null,
    },
  ], 'moderation audit');
  trackRows(reported.moderationAuditIds, moderationRows, 'moderation audit');

  const [superadminRows] = await database.query(
    `SELECT id,superadmin_id_snapshot,superadmin_name_snapshot,
            superadmin_email_snapshot,action,portfolio_id_snapshot,portfolio_name_snapshot,
            previous_relationship_manager_id_snapshot,
            previous_relationship_manager_name_snapshot,
            previous_relationship_manager_email_snapshot,new_relationship_manager_id_snapshot,
            new_relationship_manager_name_snapshot,new_relationship_manager_email_snapshot,
            created_user_id_snapshot,created_user_name_snapshot,created_user_email_snapshot,
            created_user_role
       FROM superadmin_audit_logs
      WHERE superadmin_email_snapshot=?
         OR created_user_email_snapshot IN (?,?,?)
         OR portfolio_id_snapshot=?
      ORDER BY id`,
    [emails.superadmin, emails.admin, emails.manager1, emails.manager2, portfolioId],
  );
  const baseSuperadminAudit = {
    superadmin_id_snapshot: identities.superadmin.id,
    superadmin_name_snapshot: `${runId} Superadmin`,
    superadmin_email_snapshot: emails.superadmin,
  };
  const staffAudit = (identity, role, action) => ({
    ...baseSuperadminAudit,
    action,
    portfolio_id_snapshot: null,
    portfolio_name_snapshot: null,
    previous_relationship_manager_id_snapshot: null,
    previous_relationship_manager_name_snapshot: null,
    previous_relationship_manager_email_snapshot: null,
    new_relationship_manager_id_snapshot: null,
    new_relationship_manager_name_snapshot: null,
    new_relationship_manager_email_snapshot: null,
    created_user_id_snapshot: identity.id,
    created_user_name_snapshot: identity.name,
    created_user_email_snapshot: identity.email,
    created_user_role: role,
  });
  const assignmentAudit = (action, previousManager, manager) => ({
    ...baseSuperadminAudit,
    action,
    portfolio_id_snapshot: portfolioId,
    portfolio_name_snapshot: `${runId} Portfolio`,
    previous_relationship_manager_id_snapshot: previousManager?.id ?? null,
    previous_relationship_manager_name_snapshot: previousManager?.name ?? null,
    previous_relationship_manager_email_snapshot: previousManager?.email ?? null,
    new_relationship_manager_id_snapshot: manager?.id ?? null,
    new_relationship_manager_name_snapshot: manager?.name ?? null,
    new_relationship_manager_email_snapshot: manager?.email ?? null,
    created_user_id_snapshot: null,
    created_user_name_snapshot: null,
    created_user_email_snapshot: null,
    created_user_role: null,
  });
  assertExactAuditEvents(superadminRows, [
    staffAudit(identities.admin, 'admin', 'admin_account_created'),
    staffAudit(
      identities.manager1,
      'relationship_manager',
      'relationship_manager_account_created',
    ),
    staffAudit(
      identities.manager2,
      'relationship_manager',
      'relationship_manager_account_created',
    ),
    assignmentAudit('portfolio_assigned', null, identities.manager1),
    assignmentAudit('portfolio_unassigned', identities.manager1, null),
    assignmentAudit('portfolio_assigned', null, identities.manager1),
    assignmentAudit('portfolio_reassigned', identities.manager1, identities.manager2),
  ], 'superadmin audit');
  trackRows(reported.superadminAuditIds, superadminRows, 'superadmin audit', auditId);
  await reconcileTemporaryRecords(context);
  console.log('Live five-role workflow smoke passed');
}

function createCleanupController(context, {
  cleanup = cleanTemporaryRecords,
  captureCounts = captureNonTemporaryCounts,
} = {}) {
  let cleanupPromise;
  let completed = false;
  const cleanupAndClose = () => {
    if (cleanupPromise) return cleanupPromise;
    if (completed) return Promise.resolve();
    cleanupPromise = (async () => {
      const errors = [];
      try {
        await cleanup(context);
      } catch (error) {
        errors.push(error);
      }
      if (!errors.length && context.baselineCounts) {
        try {
          const finalCounts = await captureCounts(context.database, context.runId);
          assertNonTemporaryCountsUnchanged(context.baselineCounts, finalCounts);
        } catch (error) {
          errors.push(error);
        }
      }
      if (context.database) {
        try {
          await context.database.end();
        } catch (error) {
          errors.push(error);
        } finally {
          context.database = null;
        }
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, 'Five-role smoke teardown failed');
      }
      if (errors.length === 1) throw errors[0];
      completed = true;
    })();
    return cleanupPromise;
  };
  return { cleanupAndClose };
}

async function main(environment = process.env, dependencies = {}) {
  const {
    createConnection = mysql.createConnection,
    captureCounts = captureNonTemporaryCounts,
    cleanup = cleanTemporaryRecords,
    runFlow = runFiveRoleFlow,
    processTarget = process,
    installSignalHandlers = true,
  } = dependencies;
  const context = createRunContext();
  const origin = resolveOrigin(environment);
  for (const name of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!String(environment[name] || '').trim()) {
      throw new Error(`${name} is required for the self-cleaning live smoke`);
    }
  }
  let primaryError;
  let cleanupController;
  const signalHandler = (signal) => {
    context.interruptedBy = signal;
    context.abortController.abort(new Error(`Smoke interrupted by ${signal}`));
  };
  if (installSignalHandlers) {
    processTarget.on('SIGINT', signalHandler);
    processTarget.on('SIGTERM', signalHandler);
  }
  try {
    context.database = await createConnection({
      host: environment.DB_HOST || '127.0.0.1',
      port: Number(environment.DB_PORT || 3306),
      user: environment.DB_USER,
      password: environment.DB_PASSWORD,
      database: environment.DB_NAME,
    });
    cleanupController = createCleanupController(context, { cleanup, captureCounts });
    context.baselineCounts = await captureCounts(context.database, context.runId);
    await runFlow(context, origin);
    if (context.interruptedBy) {
      throw new Error(`Smoke interrupted by ${context.interruptedBy}`);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (context.database) {
      cleanupController ||= createCleanupController(context, { cleanup, captureCounts });
      try {
        await cleanupController.cleanupAndClose();
      } catch (error) {
        primaryError = combinedError(
          primaryError,
          error,
          'Five-role smoke and teardown failed',
        );
      }
    }
    if (installSignalHandlers) {
      processTarget.removeListener('SIGINT', signalHandler);
      processTarget.removeListener('SIGTERM', signalHandler);
    }
  }
  if (primaryError) throw primaryError;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  EXPECTED_SUPERADMIN_ACTIONS,
  assertCleanupComplete,
  assertExactAuditEvents,
  assertExactIds,
  assertExactNotificationTuples,
  assertExactRecipientIds,
  assertExactUser,
  assertNonTemporaryCountsUnchanged,
  captureNonTemporaryCounts,
  cleanTemporaryRecords,
  createCleanupController,
  createRunContext,
  main,
  purgeStagedFiles,
  reconcileTemporaryRecords,
  requestApi,
  requireAffectedRows,
  resolveOrigin,
  restoreStagedFiles,
  settleStagedFiles,
  stageDocumentFiles,
  verifyReportedIds,
};
