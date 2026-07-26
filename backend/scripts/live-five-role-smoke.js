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
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && origin !== 'http://35.212.144.149') {
    throw new Error('LUMILABS_E2E_ORIGIN must target loopback or the approved public origin');
  }
  return origin;
}

function generatedEmail(runId, label) {
  const local = [runId, label, crypto.randomBytes(4).toString('hex')].join('-');
  const domain = [crypto.randomBytes(6).toString('hex'), 'invalid'].join('.');
  return `${local}${String.fromCharCode(64)}${domain}`;
}

function createRunContext() {
  const runId = `smoke-${crypto.randomUUID()}`;
  const labels = [
    'superadmin',
    'admin',
    'manager1',
    'manager2',
    'owner',
    'investor1',
    'investor2',
  ];
  return {
    runId,
    roles: [
      'superadmin',
      'admin',
      'relationship_manager',
      'business_owner',
      'investor',
    ],
    credential: crypto.randomBytes(32).toString('base64url'),
    emails: Object.fromEntries(labels.map((label) => [
      label,
      generatedEmail(runId, label),
    ])),
    identities: {},
    created: {
      userIds: new Set(),
      portfolioIds: new Set(),
      interestIds: new Set(),
      conversationIds: new Set(),
      messageIds: new Set(),
      notificationIds: new Set(),
      moderationAuditIds: new Set(),
      superadminAuditIds: new Set(),
      documentIds: new Set(),
    },
    userEmails: new Map(),
    userRoles: new Map(),
    baselineCounts: null,
    database: null,
  };
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

function trackUser(context, user, expectedEmail, expectedRole) {
  const id = positiveId(user.id, `${expectedRole} user ID`);
  const email = String(user.email || expectedEmail || '').toLowerCase();
  assert.equal(email, expectedEmail.toLowerCase(), `${expectedRole} email changed`);
  assert.ok(email.startsWith(context.runId), `${expectedRole} is outside this smoke run`);
  if (user.role !== undefined) assert.equal(user.role, expectedRole);
  context.created.userIds.add(id);
  context.userEmails.set(id, email);
  context.userRoles.set(id, expectedRole);
  return { ...user, id, email, role: expectedRole };
}

function trackRows(target, rows, label, normalize = positiveId) {
  for (const row of rows) target.add(normalize(row.id, `${label} ID`));
  return rows;
}

async function requestApi(origin, requestPath, {
  method = 'GET',
  token,
  body,
  form,
  binary = false,
} = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}/api${requestPath}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let payload = {};
  if (bytes.length && !binary) {
    try {
      payload = JSON.parse(bytes.toString('utf8'));
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const error = new Error(`${method} ${requestPath} returned ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { status: response.status, data: binary ? bytes : payload };
}

async function expectStatus(request, status) {
  await assert.rejects(request, (error) => error.status === status);
}

async function tableMaximum(database, table) {
  assert.ok(['notifications'].includes(table), 'unsupported marker table');
  const [[row]] = await database.query(`SELECT COALESCE(MAX(id),0) AS id FROM ${table}`);
  return positiveId(row.id || 1, `${table} marker`) - (Number(row.id) === 0 ? 1 : 0);
}

async function notificationRowsAfter(context, marker, {
  type,
  relatedMessageId,
}) {
  const params = [marker, type, [...context.created.portfolioIds][0]];
  let extra = '';
  if (relatedMessageId !== undefined) {
    extra = ' AND related_message_id=?';
    params.push(relatedMessageId);
  }
  const [rows] = await context.database.query(
    `SELECT id,user_id,type,related_portfolio_id,related_conversation_id,
            related_message_id,related_user_id
       FROM notifications
      WHERE id>? AND type=? AND related_portfolio_id=?${extra}
      ORDER BY id`,
    params,
  );
  trackRows(context.created.notificationIds, rows, 'notification');
  return rows;
}

async function assertNewNotifications(context, marker, type, recipients, label, options = {}) {
  const rows = await notificationRowsAfter(context, marker, { type, ...options });
  assertExactRecipientIds(rows, recipients, label);
  return rows;
}

function notificationScope(context) {
  const clauses = [];
  const params = [];
  const userIds = [...context.created.userIds];
  if (userIds.length) {
    const marks = placeholders(userIds);
    clauses.push(`user_id IN (${marks})`, `related_user_id IN (${marks})`);
    params.push(...userIds, ...userIds);
  }
  const portfolioIds = [...context.created.portfolioIds];
  if (portfolioIds.length) {
    clauses.push(`related_portfolio_id IN (${placeholders(portfolioIds)})`);
    params.push(...portfolioIds);
  }
  const conversationIds = [...context.created.conversationIds];
  if (conversationIds.length) {
    clauses.push(`related_conversation_id IN (${placeholders(conversationIds)})`);
    params.push(...conversationIds);
  }
  const messageIds = [...context.created.messageIds];
  if (messageIds.length) {
    clauses.push(`related_message_id IN (${placeholders(messageIds)})`);
    params.push(...messageIds);
  }
  return {
    sql: clauses.length ? clauses.map((clause) => `(${clause})`).join(' OR ') : '0=1',
    params,
  };
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

async function stageDocumentFiles(documentRows) {
  const staged = [];
  try {
    for (const row of documentRows) {
      const original = resolveTemporaryDocument(row.file_url);
      const stagedPath = `${original}.cleanup-${crypto.randomUUID()}`;
      try {
        await fs.rename(original, stagedPath);
        staged.push({ original, staged: stagedPath });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return staged;
  } catch (error) {
    for (const file of staged.reverse()) {
      await fs.rename(file.staged, file.original).catch(() => {});
    }
    throw error;
  }
}

async function restoreStagedFiles(staged) {
  for (const file of staged.reverse()) {
    await fs.rename(file.staged, file.original).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function purgeStagedFiles(staged) {
  for (const file of staged) {
    await fs.unlink(file.staged).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
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
  assert.deepEqual(
    after,
    before,
    'non-temporary portfolio/member/message counts changed during the smoke',
  );
}

async function reconcileTemporaryRecords(context) {
  const { database, runId, emails, created } = context;
  const like = `${runId}%`;
  const [users] = await database.query(
    'SELECT id,email,name,role FROM users WHERE email LIKE ? ORDER BY id',
    [like],
  );
  const rolesByEmail = new Map([
    [emails.superadmin, 'superadmin'],
    [emails.admin, 'admin'],
    [emails.manager1, 'relationship_manager'],
    [emails.manager2, 'relationship_manager'],
    [emails.owner, 'business_owner'],
    [emails.investor1, 'investor'],
    [emails.investor2, 'investor'],
  ]);
  for (const user of users) {
    const email = String(user.email).toLowerCase();
    const role = rolesByEmail.get(email);
    assert.ok(role, `unexpected UUID-scoped user ${email}`);
    trackUser(context, user, email, role);
  }

  const ownerId = context.identities.owner?.id
    || [...context.userEmails].find(([, email]) => email === emails.owner)?.[0];
  if (ownerId) {
    const [portfolios] = await database.query(
      'SELECT id,owner_id,name FROM portfolios WHERE owner_id=? AND name=?',
      [ownerId, `${runId} Portfolio`],
    );
    assert.ok(portfolios.length <= 1, 'temporary portfolio identity is ambiguous');
    trackRows(created.portfolioIds, portfolios, 'portfolio');
  }

  const portfolioIds = [...created.portfolioIds];
  const superadminAuditParams = [like, like];
  let superadminAuditPortfolioScope = '';
  if (portfolioIds.length) {
    superadminAuditPortfolioScope = (
      ` OR portfolio_id_snapshot IN (${placeholders(portfolioIds)})`
    );
    superadminAuditParams.push(...portfolioIds);
  }
  const [superadminAudits] = await database.query(
    `SELECT id
       FROM superadmin_audit_logs
      WHERE superadmin_email_snapshot LIKE ?
         OR created_user_email_snapshot LIKE ?
         ${superadminAuditPortfolioScope}`,
    superadminAuditParams,
  );
  trackRows(created.superadminAuditIds, superadminAudits, 'superadmin audit', auditId);
  if (!portfolioIds.length) return;
  const [interests] = await database.query(
    `SELECT id FROM investor_interests
      WHERE portfolio_id IN (${placeholders(portfolioIds)})`,
    portfolioIds,
  );
  trackRows(created.interestIds, interests, 'interest');
  const [documents] = await database.query(
    `SELECT id FROM portfolio_documents
      WHERE portfolio_id IN (${placeholders(portfolioIds)})`,
    portfolioIds,
  );
  trackRows(created.documentIds, documents, 'document');

  const managerIds = [...created.userIds].filter(
    (id) => context.userRoles.get(id) === 'relationship_manager',
  );
  let conversations = [];
  if (managerIds.length) {
    [conversations] = await database.query(
      `SELECT c.id,c.portfolio_id,c.relationship_manager_id
         FROM conversations c
        WHERE c.portfolio_id=? AND c.relationship_manager_id IN (${placeholders(managerIds)})`,
      [portfolioIds[0], ...managerIds],
    );
  } else {
    [conversations] = await database.query(
      'SELECT c.id,c.portfolio_id,c.relationship_manager_id FROM conversations c WHERE c.portfolio_id=?',
      [portfolioIds[0]],
    );
  }
  assert.ok(conversations.length <= 1, 'temporary conversation identity is ambiguous');
  trackRows(created.conversationIds, conversations, 'conversation');

  const conversationIds = [...created.conversationIds];
  if (conversationIds.length) {
    const [messages] = await database.query(
      `SELECT id FROM messages WHERE conversation_id IN (${placeholders(conversationIds)})`,
      conversationIds,
    );
    trackRows(created.messageIds, messages, 'message');
  }

  const notifications = notificationScope(context);
  const [notificationRows] = await database.query(
    `SELECT id FROM notifications WHERE ${notifications.sql}`,
    notifications.params,
  );
  trackRows(created.notificationIds, notificationRows, 'notification');

  const [moderationAudits] = await database.query(
    `SELECT id FROM audit_logs
      WHERE portfolio_id IN (${placeholders(portfolioIds)})`,
    portfolioIds,
  );
  trackRows(created.moderationAuditIds, moderationAudits, 'moderation audit');
}

async function verifyTemporaryResources(context) {
  const { database, created, runId } = context;
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
  const userIds = [...created.userIds];
  if (!userIds.length) return resources;
  [resources.users] = await database.query(
    `SELECT id,email,role FROM users
      WHERE id IN (${placeholders(userIds)}) AND email LIKE ?
      FOR UPDATE`,
    [...userIds, `${runId}%`],
  );
  assert.equal(resources.users.length, userIds.length, 'tracked users lost their UUID identity');

  const portfolioIds = [...created.portfolioIds];
  if (portfolioIds.length) {
    [resources.portfolios] = await database.query(
      `SELECT id,owner_id,name FROM portfolios
        WHERE id IN (${placeholders(portfolioIds)})
        FOR UPDATE`,
      portfolioIds,
    );
    assert.equal(resources.portfolios.length, portfolioIds.length);
  }
  const conversationIds = [...created.conversationIds];
  if (conversationIds.length) {
    [resources.conversations] = await database.query(
      `SELECT id,portfolio_id,relationship_manager_id FROM conversations
        WHERE id IN (${placeholders(conversationIds)})
        FOR UPDATE`,
      conversationIds,
    );
    [resources.memberships] = await database.query(
      `SELECT conversation_id,user_id,member_role,membership_status,visible_after_message_id
         FROM conversation_members
        WHERE conversation_id IN (${placeholders(conversationIds)})
        FOR UPDATE`,
      conversationIds,
    );
    for (const membership of resources.memberships) {
      assert.ok(created.userIds.has(Number(membership.user_id)));
    }
  }
  const messageIds = [...created.messageIds];
  if (messageIds.length) {
    [resources.messages] = await database.query(
      `SELECT id,conversation_id FROM messages
        WHERE id IN (${placeholders(messageIds)})
        FOR UPDATE`,
      messageIds,
    );
    assertExactIds(resources.messages, messageIds, 'tracked message');
  }
  const notificationIds = [...created.notificationIds];
  if (notificationIds.length) {
    [resources.notifications] = await database.query(
      `SELECT id,user_id,related_portfolio_id,related_conversation_id,related_message_id
         FROM notifications
        WHERE id IN (${placeholders(notificationIds)})
        FOR UPDATE`,
      notificationIds,
    );
    const fullScope = notificationScope(context);
    const [scopeRows] = await database.query(
      `SELECT id FROM notifications WHERE ${fullScope.sql} FOR UPDATE`,
      fullScope.params,
    );
    assertExactIds(scopeRows, resources.notifications.map(({ id }) => id), 'notification scope');
  }
  const moderationAuditIds = [...created.moderationAuditIds];
  if (moderationAuditIds.length) {
    [resources.moderationAudits] = await database.query(
      `SELECT id,portfolio_id FROM audit_logs
        WHERE id IN (${placeholders(moderationAuditIds)})
        FOR UPDATE`,
      moderationAuditIds,
    );
  }
  const superadminAuditIds = [...created.superadminAuditIds];
  if (superadminAuditIds.length) {
    [resources.superadminAudits] = await database.query(
      `SELECT id,superadmin_id_snapshot,portfolio_id_snapshot,
              previous_relationship_manager_id_snapshot,
              new_relationship_manager_id_snapshot,created_user_id_snapshot
         FROM superadmin_audit_logs
        WHERE id IN (${placeholders(superadminAuditIds)})
        FOR UPDATE`,
      superadminAuditIds,
    );
  }
  const interestIds = [...created.interestIds];
  if (interestIds.length) {
    [resources.interests] = await database.query(
      `SELECT id,portfolio_id,investor_id FROM investor_interests
        WHERE id IN (${placeholders(interestIds)})
        FOR UPDATE`,
      interestIds,
    );
  }
  const documentIds = [...created.documentIds];
  if (documentIds.length) {
    [resources.documents] = await database.query(
      `SELECT id,portfolio_id,file_url FROM portfolio_documents
        WHERE id IN (${placeholders(documentIds)})
        FOR UPDATE`,
      documentIds,
    );
  }
  return resources;
}

async function assertCleanupComplete(context) {
  const { database, created, runId } = context;
  const idChecks = [
    ['users', created.userIds],
    ['portfolios', created.portfolioIds],
    ['investor_interests', created.interestIds],
    ['portfolio_documents', created.documentIds],
    ['conversations', created.conversationIds],
    ['messages', created.messageIds],
    ['notifications', created.notificationIds],
    ['audit_logs', created.moderationAuditIds],
    ['superadmin_audit_logs', created.superadminAuditIds],
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
  const conversationIds = [...created.conversationIds];
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
  const notificationWhere = notificationScope(context);
  const [[notifications]] = await database.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE ${notificationWhere.sql}`,
    notificationWhere.params,
  );
  assert.equal(Number(notifications.count), 0, 'UUID-scoped notifications remain');
}

async function cleanTemporaryRecords(context) {
  const { database, created, runId } = context;
  if (!database) return;
  let stagedFiles = [];
  let transactionOpen = false;
  let committed = false;
  try {
    await reconcileTemporaryRecords(context);
    if (!created.userIds.size) return;
    await database.beginTransaction();
    transactionOpen = true;
    const resources = await verifyTemporaryResources(context);
    stagedFiles = await stageDocumentFiles(resources.documents);

    if (resources.superadminAudits.length) {
      const ids = resources.superadminAudits.map(({ id }) => String(id));
      await database.query(
        `DELETE FROM superadmin_audit_logs WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.moderationAudits.length) {
      const ids = resources.moderationAudits.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM audit_logs WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.notifications.length) {
      const ids = resources.notifications.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM notifications WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.messages.length) {
      const ids = resources.messages.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM messages WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.memberships.length) {
      const conversationIds = [...created.conversationIds];
      await database.query(
        `DELETE FROM conversation_members WHERE conversation_id IN (${placeholders(conversationIds)})`,
        conversationIds,
      );
    }
    if (resources.conversations.length) {
      const ids = resources.conversations.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM conversations WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.interests.length) {
      const ids = resources.interests.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM investor_interests WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.documents.length) {
      const ids = resources.documents.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM portfolio_documents WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.portfolios.length) {
      const ids = resources.portfolios.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM portfolios WHERE id IN (${placeholders(ids)})`,
        ids,
      );
    }
    if (resources.users.length) {
      const ids = resources.users.map(({ id }) => Number(id));
      await database.query(
        `DELETE FROM users WHERE id IN (${placeholders(ids)}) AND email LIKE ?`,
        [...ids, `${runId}%`],
      );
    }
    await database.commit();
    transactionOpen = false;
    committed = true;
    await purgeStagedFiles(stagedFiles);
    stagedFiles = [];
    await assertCleanupComplete(context);
  } catch (error) {
    if (transactionOpen) await database.rollback().catch(() => {});
    if (!committed) await restoreStagedFiles(stagedFiles).catch(() => {});
    throw error;
  }
}

function actionCounts(actions) {
  const counts = new Map();
  for (const action of actions) counts.set(action, (counts.get(action) || 0) + 1);
  return [...counts].sort(([left], [right]) => left.localeCompare(right));
}

async function runFiveRoleFlow(context, origin) {
  const { database, runId, emails, credential, identities, created } = context;
  const api = (requestPath, options) => requestApi(origin, requestPath, options);
  const login = async (email) => (await api('/auth/login', {
    method: 'POST',
    body: { email, password: credential },
  })).data;
  const createStaff = async (role, email, name, superadmin) => trackUser(
    context,
    (await api('/superadmin/staff', {
      method: 'POST',
      token: superadmin.token,
      body: { role, email, name, password: credential },
    })).data,
    email,
    role,
  );
  const register = async (role, email, name) => {
    const session = (await api('/auth/register', {
      method: 'POST',
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

  for (const [session, role] of [
    [superadmin, 'superadmin'],
    [admin, 'admin'],
    [manager1, 'relationship_manager'],
    [manager2, 'relationship_manager'],
    [owner, 'business_owner'],
    [investor1, 'investor'],
    [investor2, 'investor'],
  ]) {
    assert.equal((await api('/auth/me', { token: session.token })).data.role, role);
  }
  await expectStatus(api('/superadmin/stats', { token: admin.token }), 403);
  await expectStatus(api('/admin/stats', { token: superadmin.token }), 403);
  await expectStatus(api('/messages/conversations', { token: admin.token }), 403);
  await expectStatus(api('/messages/conversations', { token: superadmin.token }), 403);
  await expectStatus(api('/relationship-manager/dashboard', { token: admin.token }), 403);
  await expectStatus(api('/relationship-manager/dashboard', { token: superadmin.token }), 403);
  await expectStatus(api('/admin/stats', { token: manager1.token }), 403);
  await expectStatus(api('/superadmin/staff', {
    method: 'POST',
    token: admin.token,
    body: {
      role: 'admin',
      email: generatedEmail(runId, 'forbidden'),
      name: `${runId} Forbidden`,
      password: credential,
    },
  }), 403);

  const portfolio = (await api('/portfolios', {
    method: 'POST',
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
  created.portfolioIds.add(portfolioId);
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
    token: owner.token,
    form,
  })).data;
  assert.equal(upload.documents.length, 1);
  const documentId = positiveId(upload.documents[0].id, 'document ID');
  created.documentIds.add(documentId);

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
  );

  marker = await tableMaximum(database, 'notifications');
  const firstAssignment = (await api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    token: superadmin.token,
    body: { relationship_manager_id: identities.manager1.id },
  })).data;
  assert.equal(firstAssignment.action, 'portfolio_assigned');
  await assertNewNotifications(
    context,
    marker,
    'portfolio_assigned',
    [owner.user.id, identities.manager1.id],
    'initial assignment',
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
  assert.equal(unassigned.action, 'portfolio_unassigned');
  await assertNewNotifications(
    context,
    marker,
    'portfolio_unassigned',
    [owner.user.id, identities.manager1.id],
    'pre-chat unassignment',
  );

  marker = await tableMaximum(database, 'notifications');
  const assignedAgain = (await api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    token: superadmin.token,
    body: { relationship_manager_id: identities.manager1.id },
  })).data;
  assert.equal(assignedAgain.action, 'portfolio_assigned');
  await assertNewNotifications(
    context,
    marker,
    'portfolio_assigned',
    [owner.user.id, identities.manager1.id],
    'second assignment',
  );

  marker = await tableMaximum(database, 'notifications');
  assert.equal((await api(`/interests/${portfolioId}`, {
    method: 'POST',
    token: investor1.token,
  })).status, 201);
  await assertNewNotifications(
    context,
    marker,
    'new_interest',
    [owner.user.id, identities.manager1.id],
    'first investor interest',
  );
  marker = await tableMaximum(database, 'notifications');
  assert.equal((await api(`/interests/${portfolioId}`, {
    method: 'POST',
    token: investor2.token,
  })).status, 201);
  await assertNewNotifications(
    context,
    marker,
    'new_interest',
    [owner.user.id, identities.manager1.id],
    'second investor interest',
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
  created.interestIds.add(interest1Id);
  created.interestIds.add(interest2Id);

  marker = await tableMaximum(database, 'notifications');
  const createdConversation = (await api('/relationship-manager/conversations', {
    method: 'POST',
    token: manager1.token,
    body: { portfolio_id: portfolioId, interest_ids: [interest1Id, interest2Id] },
  })).data;
  const conversationId = positiveId(createdConversation.conversation_id, 'conversation ID');
  created.conversationIds.add(conversationId);
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
  );

  const send = async (session, content, expectedRecipients) => {
    const notificationMarker = await tableMaximum(database, 'notifications');
    const saved = (await api(`/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      token: session.token,
      body: { content },
    })).data;
    const messageId = positiveId(saved.id, 'message ID');
    created.messageIds.add(messageId);
    await assertNewNotifications(
      context,
      notificationMarker,
      'new_message',
      expectedRecipients,
      `message ${messageId}`,
      { relatedMessageId: messageId },
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
  const initialMessageIds = [...created.messageIds];
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

  const unchangedMessageIds = [...created.messageIds];
  marker = await tableMaximum(database, 'notifications');
  const reassigned = (await api(`/superadmin/portfolios/${portfolioId}/assignment`, {
    method: 'PUT',
    token: superadmin.token,
    body: { relationship_manager_id: identities.manager2.id },
  })).data;
  assert.equal(reassigned.action, 'portfolio_reassigned');
  assert.equal(Number(reassigned.conversation_id), conversationId);
  await assertNewNotifications(
    context,
    marker,
    'portfolio_reassigned',
    [owner.user.id, identities.manager1.id, identities.manager2.id],
    'post-chat reassignment',
  );
  await expectStatus(api(`/messages/conversations/${conversationId}`, {
    token: manager1.token,
  }), 403);
  await expectStatus(api(`/relationship-manager/portfolios/${portfolioId}`, {
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
    'approved resubmission',
  );
  await assertNewNotifications(
    context,
    marker,
    'conversation_archived',
    [identities.manager2.id, investor1.user.id],
    'approval archive',
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
  );
  archivedThread = (await api(`/messages/conversations/${conversationId}`, {
    token: owner.token,
  })).data;
  assert.equal(archivedThread.conversation.status, 'active');
  assert.equal(archivedThread.conversation.archived_reason, null);
  assertExactIds(archivedThread.messages, unchangedMessageIds, 'restored owner history');

  const moderationRows = (await api('/admin/audit-logs', { token: admin.token })).data
    .filter(({ portfolio_id: id }) => Number(id) === portfolioId);
  trackRows(created.moderationAuditIds, moderationRows, 'moderation audit');
  assert.deepEqual(
    actionCounts(moderationRows.map(({ action }) => action)),
    actionCounts(['approved', 'rejected', 'approved']),
  );
  const superadminRows = (await api('/superadmin/audit-logs?limit=100', {
    token: superadmin.token,
  })).data.items.filter((row) => (
    String(row.superadmin_email_snapshot).toLowerCase() === emails.superadmin
    || String(row.created_user_email_snapshot || '').startsWith(runId)
    || Number(row.portfolio_id_snapshot) === portfolioId
  ));
  trackRows(created.superadminAuditIds, superadminRows, 'superadmin audit', auditId);
  assert.deepEqual(
    actionCounts(superadminRows.map(({ action }) => action)),
    actionCounts(EXPECTED_SUPERADMIN_ACTIONS),
  );
  console.log('Live five-role workflow smoke passed');
}

async function main(environment = process.env) {
  const context = createRunContext();
  const origin = resolveOrigin(environment);
  for (const name of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (!String(environment[name] || '').trim()) {
      throw new Error(`${name} is required for the self-cleaning live smoke`);
    }
  }
  context.database = await mysql.createConnection({
    host: environment.DB_HOST || '127.0.0.1',
    port: Number(environment.DB_PORT || 3306),
    user: environment.DB_USER,
    password: environment.DB_PASSWORD,
    database: environment.DB_NAME,
  });
  context.baselineCounts = await captureNonTemporaryCounts(
    context.database,
    context.runId,
  );

  let flowError;
  let cleanupError;
  let countError;
  try {
    await runFiveRoleFlow(context, origin);
  } catch (error) {
    flowError = error;
  }
  try {
    await cleanTemporaryRecords(context);
  } catch (error) {
    cleanupError = error;
  }
  if (!cleanupError) {
    try {
      const finalCounts = await captureNonTemporaryCounts(context.database, context.runId);
      assertNonTemporaryCountsUnchanged(context.baselineCounts, finalCounts);
    } catch (error) {
      countError = error;
    }
  }
  await context.database.end().catch((error) => {
    cleanupError = cleanupError || error;
  });
  context.database = null;

  const errors = [flowError, cleanupError, countError].filter(Boolean);
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Five-role smoke or reconciliation failed');
  }
  if (errors.length === 1) throw errors[0];
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
  assertExactIds,
  assertExactRecipientIds,
  assertNonTemporaryCountsUnchanged,
  captureNonTemporaryCounts,
  cleanTemporaryRecords,
  createRunContext,
  main,
  reconcileTemporaryRecords,
  resolveOrigin,
};
