require('dotenv').config();

const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const origin = String(process.env.LUMILABS_E2E_ORIGIN || '').replace(/\/$/, '');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) && origin !== 'http://35.212.144.149') {
  throw new Error('LUMILABS_E2E_ORIGIN must target loopback or the approved public origin');
}

for (const name of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  if (!String(process.env[name] || '').trim()) {
    throw new Error(`${name} is required for the self-cleaning live smoke`);
  }
}

const prefix = `codex_e2e_${crypto.randomUUID()}`;
const emails = {
  admin: `${prefix}_admin@example.invalid`,
  manager: `${prefix}_manager@example.invalid`,
  otherManager: `${prefix}_other_manager@example.invalid`,
  owner: `${prefix}_owner@example.invalid`,
  investor: `${prefix}_investor@example.invalid`,
};
const generatedCredential = crypto.randomBytes(24).toString('base64url');
const tracked = {
  userIds: new Set(),
  userEmails: new Map(),
  portfolioId: null,
  interestId: null,
  conversationId: null,
  messageIds: new Set(),
  notificationIds: new Set(),
  documentIds: new Set(),
  auditIds: new Set(),
};
const temporaryEmailPredicate = String.raw`email LIKE 'codex\_e2e\_%'`;
let db;

function positiveId(value, label) {
  const id = Number(value);
  assert.ok(Number.isInteger(id) && id > 0, `${label} must be a positive integer`);
  return id;
}

function trackUser(user) {
  const id = positiveId(user.id, 'user ID');
  const email = String(user.email || '').toLowerCase();
  assert.ok(email.startsWith(`${prefix}_`), 'temporary user email must match this run');
  tracked.userIds.add(id);
  tracked.userEmails.set(id, email);
  return user;
}

function trackNotifications(rows) {
  for (const row of rows) tracked.notificationIds.add(positiveId(row.id, 'notification ID'));
  return rows;
}

function placeholders(values) {
  assert.ok(values.length > 0, 'placeholder values cannot be empty');
  return values.map(() => '?').join(',');
}

async function api(requestPath, { method = 'GET', token, body, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}/api${requestPath}`, {
    method,
    headers,
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error || payload.errors?.[0]?.msg || 'request failed';
    const error = new Error(`${method} ${requestPath}: ${response.status} ${detail}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { status: response.status, data: payload };
}

async function register(role, email, name) {
  const result = (await api('/auth/register', {
    method: 'POST',
    body: { role, email, name, password: generatedCredential },
  })).data;
  trackUser(result.user);
  return result;
}

async function login(email) {
  return (await api('/auth/login', {
    method: 'POST',
    body: { email, password: generatedCredential },
  })).data;
}

async function expectStatus(request, status) {
  await assert.rejects(request, (error) => error.status === status);
}

async function notificationList(session) {
  return trackNotifications((await api('/notifications', { token: session.token })).data);
}

function notificationCleanupWhere() {
  const clauses = [];
  const params = [];
  const userIds = [...tracked.userIds];
  if (userIds.length) {
    const marks = placeholders(userIds);
    clauses.push(`user_id IN (${marks})`, `related_user_id IN (${marks})`);
    params.push(...userIds, ...userIds);
  }
  if (tracked.portfolioId) {
    clauses.push('related_portfolio_id=?');
    params.push(tracked.portfolioId);
  }
  if (tracked.conversationId) {
    clauses.push('related_conversation_id=?');
    params.push(tracked.conversationId);
  }
  const messageIds = [...tracked.messageIds];
  if (messageIds.length) {
    clauses.push(`related_message_id IN (${placeholders(messageIds)})`);
    params.push(...messageIds);
  }
  const notificationIds = [...tracked.notificationIds];
  if (notificationIds.length) {
    clauses.push(`id IN (${placeholders(notificationIds)})`);
    params.push(...notificationIds);
  }
  return { sql: clauses.length ? clauses.join(' OR ') : '0=1', params };
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

function userIdForEmail(email) {
  return [...tracked.userEmails.entries()].find(([, value]) => value === email)?.[0] || null;
}

async function reconcileTemporaryRecords() {
  const emailValues = Object.values(emails);
  const [users] = await db.query(
    `SELECT id,email,name,role FROM users WHERE email IN (${placeholders(emailValues)})`,
    emailValues,
  );
  const expectedRoles = new Map([
    [emails.admin, 'admin'],
    [emails.manager, 'relationship_manager'],
    [emails.otherManager, 'relationship_manager'],
    [emails.owner, 'business_owner'],
    [emails.investor, 'investor'],
  ]);
  for (const user of users) {
    assert.equal(user.role, expectedRoles.get(String(user.email).toLowerCase()));
    trackUser(user);
  }

  const ownerId = userIdForEmail(emails.owner);
  if (!ownerId) return;
  const [portfolios] = await db.query(
    'SELECT id,owner_id,name FROM portfolios WHERE owner_id=? AND name=?',
    [ownerId, `${prefix} Portfolio`],
  );
  assert.ok(portfolios.length <= 1, 'temporary portfolio identity is ambiguous');
  if (!portfolios.length) return;
  const discoveredPortfolioId = positiveId(portfolios[0].id, 'portfolio ID');
  if (tracked.portfolioId) {
    assert.equal(tracked.portfolioId, discoveredPortfolioId, 'tracked portfolio ID is misbound');
  }
  tracked.portfolioId = discoveredPortfolioId;

  const investorId = userIdForEmail(emails.investor);
  if (investorId) {
    const [interests] = await db.query(
      'SELECT id FROM investor_interests WHERE portfolio_id=? AND investor_id=?',
      [tracked.portfolioId, investorId],
    );
    assert.ok(interests.length <= 1, 'temporary interest identity is ambiguous');
    if (interests.length) {
      const discoveredInterestId = positiveId(interests[0].id, 'interest ID');
      if (tracked.interestId) {
        assert.equal(tracked.interestId, discoveredInterestId, 'tracked interest ID is misbound');
      }
      tracked.interestId = discoveredInterestId;
    }
  }

  const managerId = userIdForEmail(emails.manager);
  if (managerId) {
    const [conversations] = await db.query(
      `SELECT c.id,c.portfolio_id,c.relationship_manager_id
         FROM conversations c
        WHERE c.portfolio_id=? AND c.relationship_manager_id=?`,
      [tracked.portfolioId, managerId],
    );
    assert.ok(conversations.length <= 1, 'temporary conversation identity is ambiguous');
    if (conversations.length) {
      const discoveredConversationId = positiveId(conversations[0].id, 'conversation ID');
      if (tracked.conversationId) {
        assert.equal(
          tracked.conversationId,
          discoveredConversationId,
          'tracked conversation ID is misbound',
        );
      }
      tracked.conversationId = discoveredConversationId;
      const [messages] = await db.query(
        'SELECT id FROM messages WHERE conversation_id=?',
        [tracked.conversationId],
      );
      for (const message of messages) tracked.messageIds.add(positiveId(message.id, 'message ID'));
    }
  }
}

async function verifyTrackedIdentities(lock = false) {
  const userIds = [...tracked.userIds];
  if (!userIds.length) return;
  const [rows] = await db.query(
    `SELECT id,email FROM users
      WHERE id IN (${placeholders(userIds)}) AND ${temporaryEmailPredicate}
      ${lock ? 'FOR UPDATE' : ''}`,
    userIds,
  );
  assert.equal(rows.length, userIds.length, 'every tracked user must retain its temporary identity');
  for (const row of rows) {
    assert.equal(String(row.email).toLowerCase(), tracked.userEmails.get(Number(row.id)));
  }
}

async function verifyTrackedResources() {
  await verifyTrackedIdentities(true);
  const resources = {
    audits: [],
    documents: [],
    interests: [],
    memberships: [],
    messages: [],
    notifications: [],
  };
  if (!tracked.portfolioId) return resources;

  const ownerId = userIdForEmail(emails.owner);
  const [portfolios] = await db.query(
    `SELECT p.id,p.owner_id,p.name,owner.email AS owner_email
       FROM portfolios p
       JOIN users owner ON owner.id=p.owner_id
      WHERE p.id=? AND p.owner_id=?
      FOR UPDATE`,
    [tracked.portfolioId, ownerId],
  );
  assert.equal(portfolios.length, 1, 'tracked portfolio does not belong to this run');
  assert.equal(portfolios[0].name, `${prefix} Portfolio`);
  assert.equal(String(portfolios[0].owner_email).toLowerCase(), emails.owner);

  const investorId = userIdForEmail(emails.investor);
  if (tracked.interestId) {
    [resources.interests] = await db.query(
      'SELECT id,portfolio_id,investor_id FROM investor_interests WHERE id=? FOR UPDATE',
      [tracked.interestId],
    );
    if (resources.interests.length) {
      assert.equal(Number(resources.interests[0].portfolio_id), tracked.portfolioId);
      assert.equal(Number(resources.interests[0].investor_id), investorId);
    }
  }

  [resources.documents] = await db.query(
    'SELECT id,portfolio_id,file_url FROM portfolio_documents WHERE portfolio_id=? FOR UPDATE',
    [tracked.portfolioId],
  );
  const documentIds = new Set(resources.documents.map(({ id }) => Number(id)));
  for (const id of tracked.documentIds) {
    assert.ok(documentIds.has(id), `tracked document ${id} is not owned by the temporary portfolio`);
  }
  for (const row of resources.documents) tracked.documentIds.add(positiveId(row.id, 'document ID'));

  [resources.audits] = await db.query(
    'SELECT id,portfolio_id FROM audit_logs WHERE portfolio_id=? FOR UPDATE',
    [tracked.portfolioId],
  );
  for (const row of resources.audits) tracked.auditIds.add(positiveId(row.id, 'audit ID'));

  if (tracked.conversationId) {
    const managerId = userIdForEmail(emails.manager);
    const [conversations] = await db.query(
      `SELECT c.id,c.portfolio_id,c.relationship_manager_id
         FROM conversations c
        WHERE c.id=? AND c.portfolio_id=? AND c.relationship_manager_id=?
        FOR UPDATE`,
      [tracked.conversationId, tracked.portfolioId, managerId],
    );
    assert.equal(conversations.length, 1, 'tracked conversation does not belong to this run');

    [resources.messages] = await db.query(
      'SELECT id,conversation_id FROM messages WHERE conversation_id=? FOR UPDATE',
      [tracked.conversationId],
    );
    for (const row of resources.messages) tracked.messageIds.add(positiveId(row.id, 'message ID'));
    [resources.memberships] = await db.query(
      'SELECT conversation_id,user_id FROM conversation_members WHERE conversation_id=? FOR UPDATE',
      [tracked.conversationId],
    );
    for (const membership of resources.memberships) {
      assert.ok(
        tracked.userIds.has(Number(membership.user_id)),
        'temporary conversation contains an untracked member',
      );
    }
  }

  const notificationScope = notificationCleanupWhere();
  [resources.notifications] = await db.query(
    `SELECT id FROM notifications WHERE ${notificationScope.sql} FOR UPDATE`,
    notificationScope.params,
  );
  trackNotifications(resources.notifications);
  return resources;
}

function assertAffected(result, expected, label) {
  assert.equal(Number(result.affectedRows), Number(expected), `${label} cleanup count changed`);
}

async function assertCleanupComplete() {
  const userIds = [...tracked.userIds];
  if (userIds.length) {
    const [[users]] = await db.query(
      `SELECT COUNT(*) AS count FROM users WHERE id IN (${placeholders(userIds)})`,
      userIds,
    );
    assert.equal(Number(users.count), 0, 'temporary users remain');
  }
  if (tracked.portfolioId) {
    for (const table of ['portfolios', 'portfolio_documents', 'investor_interests', 'audit_logs']) {
      const column = table === 'portfolios' ? 'id' : 'portfolio_id';
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS count FROM ${table} WHERE ${column}=?`,
        [tracked.portfolioId],
      );
      assert.equal(Number(row.count), 0, `${table} rows remain`);
    }
  }
  if (tracked.conversationId) {
    for (const table of ['conversations', 'conversation_members', 'messages']) {
      const column = table === 'conversations' ? 'id' : 'conversation_id';
      const [[row]] = await db.query(
        `SELECT COUNT(*) AS count FROM ${table} WHERE ${column}=?`,
        [tracked.conversationId],
      );
      assert.equal(Number(row.count), 0, `${table} rows remain`);
    }
  }
  const notificationScope = notificationCleanupWhere();
  const [[notifications]] = await db.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE ${notificationScope.sql}`,
    notificationScope.params,
  );
  assert.equal(Number(notifications.count), 0, 'temporary notifications remain');
}

async function cleanTemporaryRecords() {
  if (!db) return;
  let stagedFiles = [];
  let transactionOpen = false;
  let committed = false;
  try {
    await reconcileTemporaryRecords();
    const userIds = [...tracked.userIds];
    if (!userIds.length) return;

    await db.beginTransaction();
    transactionOpen = true;
    const resources = await verifyTrackedResources();
    stagedFiles = await stageDocumentFiles(resources.documents);

    const finalNotificationScope = notificationCleanupWhere();
    const [deletedNotifications] = await db.query(
      `DELETE FROM notifications WHERE ${finalNotificationScope.sql}`,
      finalNotificationScope.params,
    );
    assertAffected(
      deletedNotifications,
      resources.notifications.length,
      'notification',
    );
    if (tracked.conversationId) {
      const [deletedMessages] = await db.query(
        'DELETE FROM messages WHERE conversation_id=?',
        [tracked.conversationId],
      );
      assertAffected(deletedMessages, resources.messages.length, 'message');
      const [deletedMemberships] = await db.query(
        'DELETE FROM conversation_members WHERE conversation_id=?',
        [tracked.conversationId],
      );
      assertAffected(deletedMemberships, resources.memberships.length, 'membership');
      const [deletedConversation] = await db.query(
        'DELETE FROM conversations WHERE id=?',
        [tracked.conversationId],
      );
      assertAffected(deletedConversation, 1, 'conversation');
    }
    if (tracked.portfolioId) {
      const [deletedAudits] = await db.query(
        'DELETE FROM audit_logs WHERE portfolio_id=?',
        [tracked.portfolioId],
      );
      assertAffected(deletedAudits, resources.audits.length, 'audit');
      const investorId = userIdForEmail(emails.investor);
      if (investorId) {
        const [deletedInterests] = await db.query(
          'DELETE FROM investor_interests WHERE portfolio_id=? AND investor_id=?',
          [tracked.portfolioId, investorId],
        );
        assertAffected(deletedInterests, resources.interests.length, 'interest');
      }
      const [deletedDocuments] = await db.query(
        'DELETE FROM portfolio_documents WHERE portfolio_id=?',
        [tracked.portfolioId],
      );
      assertAffected(deletedDocuments, resources.documents.length, 'document');
      const ownerId = userIdForEmail(emails.owner);
      const [deletedPortfolio] = await db.query(
        'DELETE FROM portfolios WHERE id=? AND owner_id=?',
        [tracked.portfolioId, ownerId],
      );
      assertAffected(deletedPortfolio, 1, 'portfolio');
    }
    const emailValues = userIds.map((id) => tracked.userEmails.get(id));
    const [deletedUsers] = await db.query(
      `DELETE FROM users WHERE id IN (${placeholders(userIds)}) AND email IN (${placeholders(emailValues)}) AND ${temporaryEmailPredicate}`,
      [...userIds, ...emailValues],
    );
    assertAffected(deletedUsers, userIds.length, 'user');
    await db.commit();
    transactionOpen = false;
    committed = true;

    await purgeStagedFiles(stagedFiles);
    stagedFiles = [];
    await assertCleanupComplete();
  } catch (error) {
    if (transactionOpen) await db.rollback().catch(() => {});
    if (!committed) await restoreStagedFiles(stagedFiles).catch(() => {});
    throw error;
  } finally {
    await db.end();
    db = null;
  }
}

async function runFourRoleFlow() {
  const ready = await api('/ready');
  assert.equal(ready.data.status, 'ready');

  const adminHash = await bcrypt.hash(generatedCredential, 10);
  const [adminInsert] = await db.execute(
    "INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,'admin')",
    [emails.admin, adminHash, `${prefix} Admin`],
  );
  trackUser({ id: adminInsert.insertId, email: emails.admin });
  const admin = await login(emails.admin);

  await assert.rejects(
    api('/auth/register', {
      method: 'POST',
      body: {
        email: emails.manager,
        password: generatedCredential,
        name: `${prefix} Manager`,
        role: 'relationship_manager',
      },
    }),
    (error) => error.status === 400,
  );

  const managerUser = trackUser((await api('/admin/relationship-managers', {
    method: 'POST',
    token: admin.token,
    body: {
      email: emails.manager,
      password: generatedCredential,
      name: `${prefix} Manager`,
    },
  })).data);
  const otherManagerUser = trackUser((await api('/admin/relationship-managers', {
    method: 'POST',
    token: admin.token,
    body: {
      email: emails.otherManager,
      password: generatedCredential,
      name: `${prefix} Other Manager`,
    },
  })).data);
  const manager = await login(emails.manager);
  const otherManager = await login(emails.otherManager);
  const owner = await register('business_owner', emails.owner, `${prefix} Owner`);
  const investor = await register('investor', emails.investor, `${prefix} Investor`);

  for (const [session, role] of [
    [admin, 'admin'],
    [manager, 'relationship_manager'],
    [otherManager, 'relationship_manager'],
    [owner, 'business_owner'],
    [investor, 'investor'],
  ]) {
    assert.equal((await api('/auth/me', { token: session.token })).data.role, role);
  }
  for (const session of [admin, owner, investor]) {
    await expectStatus(api('/relationship-manager/dashboard', { token: session.token }), 403);
  }
  await expectStatus(api('/admin/stats', { token: manager.token }), 403);
  await expectStatus(api('/admin/relationship-managers', { token: owner.token }), 403);

  const portfolio = (await api('/portfolios', {
    method: 'POST',
    token: owner.token,
    body: {
      name: `${prefix} Portfolio`,
      sector: 'Technology',
      mvp_status: 'Beta',
      description: 'Temporary end-to-end portfolio used only for managed-chat verification.',
      funding_goal: 100000,
      team_size: 3,
      founded_year: 2026,
      location: 'Singapore',
      website: '',
      monthly_revenue: 1000,
      user_count: 10,
      growth_rate: 5,
      market_size: 'Temporary verification market',
      competitor_analysis: 'Temporary verification competitors',
      advisor_names: '',
      burn_rate: 100,
      runway_months: 12,
    },
  })).data;
  const portfolioId = positiveId(portfolio.id, 'portfolio ID');
  tracked.portfolioId = portfolioId;

  const form = new FormData();
  form.append(
    'documents',
    new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }),
    `${prefix}.pdf`,
  );
  const upload = (await api(`/portfolios/${portfolioId}/documents`, {
    method: 'POST',
    token: owner.token,
    form,
  })).data;
  assert.equal(upload.documents.length, 1);
  for (const document of upload.documents) {
    tracked.documentIds.add(positiveId(document.id, 'document ID'));
  }

  await api(`/portfolios/${portfolioId}/submit`, { method: 'POST', token: owner.token });
  const queue = (await api('/admin/queue', { token: admin.token })).data;
  assert.ok(queue.some(({ id }) => Number(id) === portfolioId));
  await api(`/admin/portfolios/${portfolioId}/approve`, {
    method: 'PUT',
    token: admin.token,
  });
  assert.ok((await api('/portfolios', { token: investor.token })).data
    .some(({ id }) => Number(id) === portfolioId));

  assert.equal((await api(`/interests/${portfolioId}`, {
    method: 'POST',
    token: investor.token,
  })).status, 201);
  assert.equal((await api(`/interests/${portfolioId}`, {
    method: 'POST',
    token: investor.token,
  })).status, 200);

  const managerDashboard = (await api('/relationship-manager/dashboard', {
    token: manager.token,
  })).data;
  const eligiblePortfolio = managerDashboard.unclaimed_portfolios.find(
    ({ portfolio_id: id }) => Number(id) === portfolioId,
  );
  assert.ok(eligiblePortfolio, 'newly approved opportunity must be claimable');
  const interest = eligiblePortfolio.interests.find(
    ({ investor: participant }) => Number(participant.id) === Number(investor.user.id),
  );
  tracked.interestId = positiveId(interest?.id, 'interest ID');

  const createdRoom = (await api('/relationship-manager/conversations', {
    method: 'POST',
    token: manager.token,
    body: { portfolio_id: portfolioId, interest_ids: [tracked.interestId] },
  })).data;
  const conversationId = positiveId(createdRoom.conversation_id, 'conversation ID');
  tracked.conversationId = conversationId;
  assert.equal(Number(createdRoom.manager.id), Number(managerUser.id));
  assert.equal(Number(createdRoom.owner.id), Number(owner.user.id));
  assert.deepEqual(createdRoom.investors.map(({ id }) => Number(id)), [Number(investor.user.id)]);

  const isolatedDashboard = (await api('/relationship-manager/dashboard', {
    token: otherManager.token,
  })).data;
  assert.equal(
    isolatedDashboard.rooms.some(({ conversation_id: id }) => Number(id) === conversationId),
    false,
  );
  assert.equal(
    isolatedDashboard.unclaimed_portfolios.some(({ portfolio_id: id }) => Number(id) === portfolioId),
    false,
  );
  await expectStatus(
    api(`/messages/conversations/${conversationId}`, { token: otherManager.token }),
    403,
  );
  await expectStatus(
    api(`/messages/conversations/${conversationId}`, { token: admin.token }),
    403,
  );
  await expectStatus(
    api(`/relationship-manager/conversations/${conversationId}/archive`, {
      method: 'PUT',
      token: otherManager.token,
    }),
    403,
  );

  const send = async (session, content) => {
    const saved = (await api(`/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      token: session.token,
      body: { content },
    })).data;
    tracked.messageIds.add(positiveId(saved.id, 'message ID'));
    return saved;
  };
  const managerMessage = await send(manager, `${prefix} manager message`);
  const ownerMessage = await send(owner, `${prefix} owner message`);
  const investorMessage = await send(investor, `${prefix} investor message`);
  assert.equal(managerMessage.sender_role, 'relationship_manager');
  assert.equal(ownerMessage.sender_role, 'business_owner');
  assert.equal(investorMessage.sender_role, 'investor');

  for (const session of [manager, owner, investor]) {
    const summaries = (await api('/messages/conversations', { token: session.token })).data;
    const summary = summaries.find(({ id }) => Number(id) === conversationId);
    assert.ok(summary, 'active member must see the managed room');
    assert.equal(Number(summary.unread_count), 2);
    const thread = (await api(`/messages/conversations/${conversationId}`, {
      token: session.token,
    })).data;
    assert.deepEqual(
      new Set(thread.participants.map(({ role }) => role)),
      new Set(['relationship_manager', 'business_owner', 'investor']),
    );
    assert.deepEqual(
      thread.messages.map(({ sender_role: role }) => role),
      ['relationship_manager', 'business_owner', 'investor'],
    );
    assert.ok(thread.messages.some(({ sender_id: id }) => Number(id) === Number(session.user.id)));
    assert.ok(thread.messages.some(({ sender_id: id }) => Number(id) !== Number(session.user.id)));
    await api(`/messages/conversations/${conversationId}/read`, {
      method: 'PUT',
      token: session.token,
      body: { message_id: investorMessage.id },
    });
    const refreshed = (await api('/messages/conversations', { token: session.token })).data
      .find(({ id }) => Number(id) === conversationId);
    assert.equal(Number(refreshed.unread_count), 0);
  }

  for (const session of [manager, owner, investor]) {
    const notifications = await notificationList(session);
    const groupNotifications = notifications.filter((row) => (
      row.type === 'new_message' && Number(row.related_conversation_id) === conversationId
    ));
    assert.equal(groupNotifications.length, 2);
  }

  const archived = (await api(
    `/relationship-manager/conversations/${conversationId}/archive`,
    { method: 'PUT', token: manager.token },
  )).data;
  assert.equal(archived.status, 'archived');
  assert.equal(
    (await api(`/messages/conversations/${conversationId}`, { token: owner.token }))
      .data.conversation.can_send,
    false,
  );
  await expectStatus(
    api(`/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      token: owner.token,
      body: { content: `${prefix} blocked archive message` },
    }),
    409,
  );

  assert.equal((await api(
    `/relationship-manager/conversations/${conversationId}/reopen`,
    { method: 'PUT', token: manager.token },
  )).data.status, 'active');
  await api(`/interests/${portfolioId}`, { method: 'DELETE', token: investor.token });

  await expectStatus(
    api(`/messages/conversations/${conversationId}`, { token: investor.token }),
    403,
  );
  assert.equal(
    (await api('/messages/conversations', { token: investor.token })).data
      .some(({ id }) => Number(id) === conversationId),
    false,
  );
  assert.equal(
    (await notificationList(investor))
      .some(({ related_conversation_id: id }) => Number(id) === conversationId),
    false,
  );
  const finalDashboard = (await api('/relationship-manager/dashboard', {
    token: manager.token,
  })).data;
  const finalRoom = finalDashboard.rooms.find(
    ({ conversation_id: id }) => Number(id) === conversationId,
  );
  assert.equal(finalRoom.status, 'archived');
  assert.equal(finalRoom.archived_reason, 'no_active_investors');
  assert.equal(
    (await api(`/messages/conversations/${conversationId}`, { token: manager.token }))
      .data.conversation.archived_reason,
    'no_active_investors',
  );

  const auditRows = (await api('/admin/audit-logs', { token: admin.token })).data
    .filter(({ portfolio_id: id }) => Number(id) === portfolioId);
  assert.ok(auditRows.some(({ action }) => action === 'approved'));
  for (const row of auditRows) tracked.auditIds.add(positiveId(row.id, 'audit ID'));
  await notificationList(admin);
  await notificationList(otherManager);

  assert.equal(Number(otherManagerUser.id) > 0, true);
  console.log('Live four-role managed-chat smoke passed');
}

async function main() {
  db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let flowError;
  let cleanupError;
  try {
    await runFourRoleFlow();
  } catch (error) {
    flowError = error;
  }
  try {
    await cleanTemporaryRecords();
  } catch (error) {
    cleanupError = error;
  }
  if (flowError && cleanupError) {
    throw new AggregateError([flowError, cleanupError], 'Smoke flow and cleanup both failed');
  }
  if (cleanupError) throw cleanupError;
  if (flowError) throw flowError;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { assertCleanupComplete, cleanTemporaryRecords, main };
