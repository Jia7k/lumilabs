const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

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

function jsonResponse(body, {
  status = 200,
  contentType = 'application/json; charset=utf-8',
  redirected = false,
  contentLength,
} = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    status,
    redirected,
    headers: {
      get(name) {
        const normalized = String(name).toLowerCase();
        if (normalized === 'content-type') return contentType;
        if (normalized === 'content-length') {
          return contentLength === undefined ? String(bytes.length) : String(contentLength);
        }
        return null;
      },
    },
    async arrayBuffer() {
      return bytes;
    },
  };
}

function memoryFileSystem(initialPaths = []) {
  const files = new Map(initialPaths.map((entry) => (
    Array.isArray(entry) ? [entry[0], Buffer.from(entry[1])] : [entry, Buffer.from('pdf')]
  )));
  const failures = { rename: null, unlink: null };
  const operations = [];
  const missing = (file) => Object.assign(new Error(`missing ${file}`), { code: 'ENOENT' });
  return {
    files,
    failures,
    operations,
    async stat(file) {
      if (!files.has(file)) throw missing(file);
      return { isFile: () => true };
    },
    async readFile(file) {
      if (!files.has(file)) throw missing(file);
      return Buffer.from(files.get(file));
    },
    async rename(from, to) {
      operations.push(['rename', from, to]);
      if (failures.rename && failures.rename(from, to)) throw new Error('rename failed');
      if (!files.has(from)) throw missing(from);
      files.set(to, files.get(from));
      files.delete(from);
    },
    async unlink(file) {
      operations.push(['unlink', file]);
      if (failures.unlink && failures.unlink(file)) throw new Error('unlink failed');
      if (!files.has(file)) throw missing(file);
      files.delete(file);
    },
  };
}

test('release exposes only the renamed five-role smoke package command', () => {
  const packageJson = require('../package.json');
  assert.equal(fs.existsSync(smokePath), true);
  assert.equal(fs.existsSync(oldSmokePath), false);
  assert.equal(packageJson.scripts['smoke:live'], 'node scripts/live-five-role-smoke.js');
  assert.equal(packageJson.scripts['migrate:managed-chat'], undefined);
  assert.equal(JSON.stringify(packageJson).includes('live-four-role-smoke'), false);
});

test('smoke configuration generates isolated identities and accepts only loopback origins', () => {
  const {
    createRunContext,
    resolveOrigin,
  } = loadSmoke();

  assert.equal(resolveOrigin({ LUMILABS_E2E_ORIGIN: 'http://127.0.0.1:3100/' }),
    'http://127.0.0.1:3100');
  for (const rejected of [
    'http://localhost:3100',
    'https://127.0.0.1:3100',
    'http://127.0.0.1:3100/api',
    'http://35.212.144.149:3100',
    'http://35.212.144.149',
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
  const postReassignment = source.slice(source.indexOf('const reassigned'));
  assert.match(
    postReassignment,
    /expectStatus\(api\(`\/relationship-manager\/conversations\/\$\{conversationId\}\/investors`,[\s\S]*token:\s*manager1\.token[\s\S]*\),\s*403\)/,
  );
  assert.match(
    postReassignment,
    /expectStatus\(api\(`\/relationship-manager\/conversations\/\$\{conversationId\}\/investors\/\$\{investor1Id\}`,[\s\S]*token:\s*manager1\.token[\s\S]*\),\s*403\)/,
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
    assert.match(source, new RegExp(`reported\\.${trackedType}`));
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
  assert.match(source, /reported,\s*\n\s*verified,/);
  assert.match(source, /FROM users WHERE email IN/);
  assert.match(source, /verifyReportedIds/);
  assert.match(source, /assertCompleteForeignKeyFootprint/);
  assert.doesNotMatch(source, /WHERE id>\? AND type=\?/);
  assert.ok(
    source.indexOf('FROM superadmin_audit_logs')
      < source.indexOf('if (!owner)'),
    'exact-snapshot staff audits must be reconciled even before a portfolio exists',
  );
});

test('request helper enforces exact status, JSON type, redirect rejection, and byte bounds', async () => {
  const { requestApi } = loadSmoke();
  assert.equal(typeof requestApi, 'function');
  const origin = 'http://127.0.0.1:3100';

  const ok = await requestApi(origin, '/ready', {
    expectedStatus: 200,
  }, {
    fetchImpl: async () => jsonResponse({ status: 'ready' }),
  });
  assert.deepEqual(ok.data, { status: 'ready' });

  await assert.rejects(
    requestApi(origin, '/created', { expectedStatus: 201 }, {
      fetchImpl: async () => jsonResponse({ created: true }, { status: 200 }),
    }),
    /expected 201.*received 200/i,
  );
  await assert.rejects(
    requestApi(origin, '/redirect', { expectedStatus: 200 }, {
      fetchImpl: async () => jsonResponse({}, { status: 200, redirected: true }),
    }),
    /redirect/i,
  );
  await assert.rejects(
    requestApi(origin, '/wrong-type', { expectedStatus: 200 }, {
      fetchImpl: async () => jsonResponse({}, { contentType: 'text/html' }),
    }),
    /application\/json/i,
  );
  await assert.rejects(
    requestApi(origin, '/malformed', { expectedStatus: 200 }, {
      fetchImpl: async () => jsonResponse('{bad json'),
    }),
    /valid JSON/i,
  );
  await assert.rejects(
    requestApi(origin, '/large', { expectedStatus: 200, maxBytes: 8 }, {
      fetchImpl: async () => jsonResponse({ long: 'payload' }),
    }),
    /response.*large/i,
  );
});

test('request helper aborts on timeout and validates PDF headers separately', async () => {
  const { requestApi } = loadSmoke();
  assert.equal(typeof requestApi, 'function');
  const origin = 'http://127.0.0.1:3100';
  await assert.rejects(
    requestApi(origin, '/slow', { expectedStatus: 200, timeoutMs: 5 }, {
      fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      }),
    }),
    /timed out/i,
  );

  const pdf = await requestApi(origin, '/document', {
    binary: true,
    expectedStatus: 200,
  }, {
    fetchImpl: async () => jsonResponse('%PDF-1.4', {
      contentType: 'application/pdf',
    }),
  });
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  await assert.rejects(
    requestApi(origin, '/document', {
      binary: true,
      expectedStatus: 200,
    }, {
      fetchImpl: async () => jsonResponse('not-pdf', {
        contentType: 'application/pdf',
      }),
    }),
    /PDF header/i,
  );
});

test('mutating requests wait for a late server result before cleanup starts', async () => {
  const {
    main,
    requestApi,
  } = loadSmoke();
  const events = [];
  const origin = 'http://127.0.0.1:3100';
  await assert.rejects(
    main({
      DB_USER: 'generated',
      DB_PASSWORD: 'generated',
      DB_NAME: 'generated',
      LUMILABS_E2E_ORIGIN: origin,
    }, {
      createConnection: async () => ({
        async end() { events.push('close'); },
      }),
      captureCounts: async () => ({ portfolios: 0, conversation_members: 0, messages: 0 }),
      cleanup: async () => {
        assert.deepEqual(events, ['write'], 'cleanup raced a dispatched mutation');
        events.push('cleanup');
      },
      installSignalHandlers: false,
      runFlow: async (context) => {
        await requestApi(origin, '/late-write', {
          method: 'POST',
          expectedStatus: 201,
          timeoutMs: 5,
          signal: context.abortController.signal,
        }, {
          fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              events.push('write');
              resolve(jsonResponse({ created: true }, { status: 201 }));
            }, 25);
            signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('client aborted'), { name: 'AbortError' }));
              // The localhost server operation still commits after the client aborts.
              void timer;
            }, { once: true });
          }),
        });
      },
    }),
    /timed out/i,
  );
  assert.deepEqual(events, ['write', 'cleanup', 'close']);

  const preAborted = new AbortController();
  preAborted.abort(new Error('already interrupted'));
  let dispatches = 0;
  await assert.rejects(
    requestApi(origin, '/must-not-dispatch', {
      method: 'DELETE',
      signal: preAborted.signal,
    }, {
      fetchImpl: async () => {
        dispatches += 1;
        return jsonResponse({});
      },
    }),
    /before dispatch|interrupted|aborted/i,
  );
  assert.equal(dispatches, 0);

  const interrupted = new AbortController();
  const signalEvents = [];
  const interruptedRequest = requestApi(origin, '/late-denial', {
    method: 'DELETE',
    expectedStatus: 409,
    timeoutMs: 100,
    signal: interrupted.signal,
  }, {
    fetchImpl: async () => new Promise((resolve) => {
      setTimeout(() => {
        signalEvents.push('denial');
        resolve(jsonResponse({ error: 'controlled' }, { status: 409 }));
      }, 20);
    }),
  });
  setTimeout(() => interrupted.abort(new Error('signal')), 5);
  await assert.rejects(interruptedRequest, /interrupted after dispatch/i);
  assert.deepEqual(signalEvents, ['denial']);
});

test('an organic mutation transport failure fails closed without destructive cleanup', async () => {
  const {
    main,
    requestApi,
  } = loadSmoke();
  const origin = 'http://127.0.0.1:3100';
  const counts = { cleanup: 0, count: 0, close: 0 };
  await assert.rejects(
    main({
      DB_USER: 'generated',
      DB_PASSWORD: 'generated',
      DB_NAME: 'generated',
      LUMILABS_E2E_ORIGIN: origin,
    }, {
      createConnection: async () => ({
        async end() { counts.close += 1; },
      }),
      captureCounts: async () => {
        counts.count += 1;
        return { portfolios: 0, conversation_members: 0, messages: 0 };
      },
      cleanup: async () => { counts.cleanup += 1; },
      installSignalHandlers: false,
      runFlow: async (context) => requestApi(origin, '/unknown-write', {
        method: 'POST',
        timeoutMs: 5,
        signal: context.abortController.signal,
      }, {
        fetchImpl: async () => new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('socket closed after dispatch')), 20);
          void resolve;
        }),
      }),
    }),
    /mutation outcome.*indeterminate|outcome.*unknown/i,
  );
  assert.deepEqual(counts, { cleanup: 0, count: 2, close: 1 });
});

test('expected-denial wrappers preserve indeterminate mutation outcomes through main', async () => {
  const {
    expectStatus,
    main,
    requestApi,
  } = loadSmoke();
  assert.equal(typeof expectStatus, 'function');
  const counts = { cleanup: 0, count: 0, close: 0 };
  const origin = 'http://127.0.0.1:3100';
  await assert.rejects(
    main({
      DB_USER: 'generated',
      DB_PASSWORD: 'generated',
      DB_NAME: 'generated',
      LUMILABS_E2E_ORIGIN: origin,
    }, {
      createConnection: async () => ({
        async end() { counts.close += 1; },
      }),
      captureCounts: async () => {
        counts.count += 1;
        return { portfolios: 0, conversation_members: 0, messages: 0 };
      },
      cleanup: async () => { counts.cleanup += 1; },
      installSignalHandlers: false,
      runFlow: async (context) => expectStatus(
        requestApi(origin, '/expected-denial', {
          method: 'PUT',
          expectedStatus: 200,
          timeoutMs: 100,
          signal: context.abortController.signal,
        }, {
          fetchImpl: async () => {
            throw new Error('transport failed before expected 403');
          },
        }),
        403,
      ),
    }),
    /mutation outcome.*indeterminate/i,
  );
  assert.deepEqual(counts, { cleanup: 0, count: 2, close: 1 });
});

test('a permanently pending mutation exits at a bounded fail-closed deadline', async () => {
  const {
    main,
    requestApi,
  } = loadSmoke();
  const counts = {
    aborted: 0, cleanup: 0, count: 0, close: 0,
  };
  const origin = 'http://127.0.0.1:3100';
  const startedAt = Date.now();
  await assert.rejects(
    Promise.race([
      main({
        DB_USER: 'generated',
        DB_PASSWORD: 'generated',
        DB_NAME: 'generated',
        LUMILABS_E2E_ORIGIN: origin,
      }, {
        createConnection: async () => ({
          async end() { counts.close += 1; },
        }),
        captureCounts: async () => {
          counts.count += 1;
          return { portfolios: 0, conversation_members: 0, messages: 0 };
        },
        cleanup: async () => { counts.cleanup += 1; },
        installSignalHandlers: false,
        runFlow: async (context) => requestApi(origin, '/never-settles', {
          method: 'POST',
          timeoutMs: 5,
          mutationSettlementMs: 10,
          abortSettlementMs: 10,
          signal: context.abortController.signal,
        }, {
          fetchImpl: async (url, { signal }) => {
            signal?.addEventListener('abort', () => { counts.aborted += 1; }, { once: true });
            return new Promise(() => {});
          },
        }),
      }),
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('pending mutation exceeded test deadline')), 150);
        void resolve;
      }),
    ]),
    /mutation outcome.*indeterminate/i,
  );
  assert.ok(Date.now() - startedAt < 500, 'pending mutation exceeded its deterministic bound');
  assert.deepEqual(counts, {
    aborted: 1, cleanup: 0, count: 2, close: 1,
  });
});

test('reported IDs cannot widen verified deletion scope and affected rows are exact', async () => {
  const {
    requireAffectedRows,
    verifyReportedIds,
  } = loadSmoke();
  assert.equal(typeof requireAffectedRows, 'function');
  assert.equal(typeof verifyReportedIds, 'function');

  const fakeDatabase = {
    async query() {
      return [[{ id: 91 }], []];
    },
  };
  await assert.rejects(
    verifyReportedIds({
      database: fakeDatabase,
      reportedIds: new Set([91]),
      verifiedIds: new Set([7]),
      label: 'user',
      loadExisting: async (database) => (await database.query('tracked users'))[0],
    }),
    /reported user 91.*natural scope/i,
  );
  await assert.doesNotReject(verifyReportedIds({
    database: fakeDatabase,
    reportedIds: new Set([92]),
    verifiedIds: new Set([7]),
    label: 'interest',
    loadExisting: async () => [],
  }));
  assert.doesNotThrow(() => requireAffectedRows({ affectedRows: 2 }, 2, 'message'));
  assert.throws(
    () => requireAffectedRows({ affectedRows: 1 }, 2, 'message'),
    /message cleanup affected 1.*expected 2/i,
  );
});

test('partial pre-portfolio reconciliation discovers natural users and staff audits', async () => {
  const {
    createRunContext,
    reconcileTemporaryRecords,
  } = loadSmoke();
  const context = createRunContext();
  assert.ok(context.reported, 'reported IDs must be separate from verified resources');
  assert.ok(context.verified, 'verified natural scope must own cleanup IDs');
  context.reported.userIds.add(999);
  const superadminEmail = context.emails.superadmin;
  const queries = [];
  context.database = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(normalized);
      if (/FROM users WHERE email IN/.test(normalized)) {
        return [[
          {
            id: 7,
            email: superadminEmail,
            name: context.names.superadmin,
            role: 'superadmin',
          },
          {
            id: 8,
            email: context.emails.admin,
            name: context.names.admin,
            role: 'admin',
          },
        ], []];
      }
      if (/FROM users WHERE id IN/.test(normalized)) return [[], []];
      if (/FROM superadmin_audit_logs/.test(normalized)) {
        return [[{
          id: '44',
          superadmin_id: 7,
          superadmin_id_snapshot: 7,
          superadmin_name_snapshot: context.names.superadmin,
          superadmin_email_snapshot: superadminEmail,
          action: 'admin_account_created',
          portfolio_id: null,
          portfolio_id_snapshot: null,
          portfolio_name_snapshot: null,
          previous_relationship_manager_id: null,
          previous_relationship_manager_id_snapshot: null,
          previous_relationship_manager_name_snapshot: null,
          previous_relationship_manager_email_snapshot: null,
          new_relationship_manager_id: null,
          new_relationship_manager_id_snapshot: null,
          new_relationship_manager_name_snapshot: null,
          new_relationship_manager_email_snapshot: null,
          created_user_id: 8,
          created_user_id_snapshot: 8,
          created_user_name_snapshot: context.names.admin,
          created_user_email_snapshot: context.emails.admin,
          created_user_role: 'admin',
        }], []];
      }
      throw new Error(`Unexpected query: ${normalized}`);
    },
  };

  await reconcileTemporaryRecords(context);

  assert.deepEqual([...context.verified.userIds], [7, 8]);
  assert.deepEqual([...context.verified.superadminAuditIds], ['44']);
  assert.equal(queries.some((sql) => /FROM portfolios/.test(sql)), false);
});

test('immutable audit IDs and live FKs must match exact snapshot identities before any delete', async () => {
  const {
    cleanTemporaryRecords,
    createRunContext,
  } = loadSmoke();
  for (const mismatch of [
    { created_user_id_snapshot: 999, created_user_id: 2 },
    { created_user_id_snapshot: 2, created_user_id: 1 },
  ]) {
    const context = createRunContext();
    const users = [
      {
        id: 1,
        email: context.emails.superadmin,
        name: context.names.superadmin,
        role: 'superadmin',
      },
      {
        id: 2,
        email: context.emails.admin,
        name: context.names.admin,
        role: 'admin',
      },
    ];
    const audit = {
      id: '44',
      superadmin_id: 1,
      superadmin_id_snapshot: 1,
      superadmin_name_snapshot: context.names.superadmin,
      superadmin_email_snapshot: context.emails.superadmin,
      action: 'admin_account_created',
      portfolio_id: null,
      portfolio_id_snapshot: null,
      portfolio_name_snapshot: null,
      previous_relationship_manager_id: null,
      previous_relationship_manager_id_snapshot: null,
      previous_relationship_manager_name_snapshot: null,
      previous_relationship_manager_email_snapshot: null,
      new_relationship_manager_id: null,
      new_relationship_manager_id_snapshot: null,
      new_relationship_manager_name_snapshot: null,
      new_relationship_manager_email_snapshot: null,
      created_user_name_snapshot: context.names.admin,
      created_user_email_snapshot: context.emails.admin,
      created_user_role: 'admin',
      ...mismatch,
    };
    let begins = 0;
    let deletes = 0;
    context.database = {
      async query(sql) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (/FROM users WHERE email IN/.test(normalized)) return [users, []];
        if (/FROM superadmin_audit_logs/.test(normalized)
          && /superadmin_email_snapshot/.test(normalized)) return [[audit], []];
        if (/^DELETE FROM/.test(normalized)) {
          deletes += 1;
          return [{ affectedRows: /DELETE FROM users/.test(normalized) ? 2 : 1 }, []];
        }
        if (/COUNT\(\*\)/.test(normalized)) return [[{ count: 0 }], []];
        return [[], []];
      },
      async beginTransaction() { begins += 1; },
      async commit() {},
      async rollback() {},
    };
    await assert.rejects(
      cleanTemporaryRecords(context),
      /created_user_id_snapshot|created_user_id.*snapshot|snapshot ID/i,
    );
    assert.equal(begins, 0);
    assert.equal(deletes, 0);
  }
});

test('assignment audit snapshots bind portfolio and both managers to exact IDs', () => {
  const {
    assertNaturalSuperadminAudit,
    createRunContext,
  } = loadSmoke();
  const context = createRunContext();
  const identities = [
    [1, 'superadmin'],
    [2, 'manager1'],
    [3, 'manager2'],
  ];
  for (const [id, label] of identities) {
    context.verified.userIds.add(id);
    context.userEmails.set(id, context.emails[label]);
  }
  context.trustedPortfolioId = 20;
  const row = {
    superadmin_id: 1,
    superadmin_id_snapshot: 1,
    superadmin_name_snapshot: context.names.superadmin,
    superadmin_email_snapshot: context.emails.superadmin,
    action: 'portfolio_reassigned',
    portfolio_id: 20,
    portfolio_id_snapshot: 20,
    portfolio_name_snapshot: `${context.runId} Portfolio`,
    previous_relationship_manager_id: 2,
    previous_relationship_manager_id_snapshot: 2,
    previous_relationship_manager_name_snapshot: context.names.manager1,
    previous_relationship_manager_email_snapshot: context.emails.manager1,
    new_relationship_manager_id: 3,
    new_relationship_manager_id_snapshot: 3,
    new_relationship_manager_name_snapshot: context.names.manager2,
    new_relationship_manager_email_snapshot: context.emails.manager2,
    created_user_id: null,
    created_user_id_snapshot: null,
    created_user_name_snapshot: null,
    created_user_email_snapshot: null,
    created_user_role: null,
  };
  assert.doesNotThrow(() => assertNaturalSuperadminAudit(context, row));
  assert.throws(
    () => assertNaturalSuperadminAudit(context, {
      ...row,
      new_relationship_manager_id: 2,
    }),
    /new_relationship_manager_id.*exact snapshot ID/i,
  );
});

test('notification tuples reject extras and auth identity checks every field', () => {
  const {
    assertExactAuditEvents,
    assertExactNotificationTuples,
    assertExactUser,
  } = loadSmoke();
  assert.equal(typeof assertExactAuditEvents, 'function');
  assert.equal(typeof assertExactNotificationTuples, 'function');
  assert.equal(typeof assertExactUser, 'function');
  const expected = [{
    type: 'new_interest',
    user_id: 3,
    related_portfolio_id: 20,
    related_conversation_id: null,
    related_message_id: null,
    related_user_id: 8,
  }];
  assert.doesNotThrow(() => assertExactNotificationTuples(
    [{ id: 1, ...expected[0] }],
    expected,
    'interest notification',
  ));
  assert.throws(
    () => assertExactNotificationTuples(
      [
        { id: 1, ...expected[0] },
        { id: 2, ...expected[0], type: 'portfolio_approved' },
      ],
      expected,
      'interest notification',
    ),
    /interest notification/i,
  );
  const user = {
    id: 7,
    email: 'generated',
    name: 'Generated User',
    role: 'investor',
  };
  assert.doesNotThrow(() => assertExactUser(user, user, 'auth/me'));
  assert.throws(
    () => assertExactUser({ ...user, id: 8 }, user, 'auth/me'),
    /auth\/me/i,
  );
  const audits = [{
    action: 'portfolio_assigned',
    superadmin_id_snapshot: 1,
    portfolio_id_snapshot: 20,
    previous_relationship_manager_id_snapshot: null,
    new_relationship_manager_id_snapshot: 7,
    created_user_id_snapshot: null,
  }];
  assert.doesNotThrow(() => assertExactAuditEvents(audits, audits, 'superadmin audit'));
  assert.throws(
    () => assertExactAuditEvents(
      [{ ...audits[0], new_relationship_manager_id_snapshot: 8 }],
      audits,
      'superadmin audit',
    ),
    /superadmin audit/i,
  );
});

test('audit API projections must equal the exact ordered database events', () => {
  const { assertAuditApiMatchesDatabase } = loadSmoke();
  assert.equal(typeof assertAuditApiMatchesDatabase, 'function');
  const endpointOrderedDatabaseRows = [
    { id: 11, admin_id: 2, action: 'rejected', portfolio_id: 20, reason: 'controlled' },
    { id: 10, admin_id: 2, action: 'approved', portfolio_id: 20, reason: null },
  ];
  const fields = ['admin_id', 'action', 'portfolio_id', 'reason'];
  assert.doesNotThrow(() => assertAuditApiMatchesDatabase(
    [
      { ...endpointOrderedDatabaseRows[0], admin_name: 'extra API field' },
      { ...endpointOrderedDatabaseRows[1], admin_name: 'extra API field' },
    ],
    endpointOrderedDatabaseRows,
    fields,
    'moderation audit API',
  ));
  assert.throws(
    () => assertAuditApiMatchesDatabase(
      [
        endpointOrderedDatabaseRows[1],
        endpointOrderedDatabaseRows[0],
      ],
      endpointOrderedDatabaseRows,
      fields,
      'moderation audit API',
    ),
    /moderation audit API/i,
  );
});

test('file staging requires the uploaded source and restores or purges final state', async () => {
  const {
    purgeStagedFiles,
    restoreStagedFiles,
    settleStagedFiles,
    stageDocumentFiles,
  } = loadSmoke();
  assert.equal(typeof stageDocumentFiles, 'function');
  assert.equal(typeof restoreStagedFiles, 'function');
  assert.equal(typeof purgeStagedFiles, 'function');
  assert.equal(typeof settleStagedFiles, 'function');
  const original = path.resolve(__dirname, '..', 'uploads', 'portfolio-documents', 'run.pdf');
  await assert.rejects(
    stageDocumentFiles([{ file_url: '/uploads/portfolio-documents/run.pdf' }], {
      fileSystem: memoryFileSystem(),
    }),
    /uploaded document.*exist/i,
  );

  const restoreFs = memoryFileSystem([original]);
  const stagedForRestore = await stageDocumentFiles(
    [{ file_url: '/uploads/portfolio-documents/run.pdf' }],
    { fileSystem: restoreFs },
  );
  await restoreStagedFiles(stagedForRestore, { fileSystem: restoreFs });
  await restoreStagedFiles(stagedForRestore, { fileSystem: restoreFs });
  assert.equal(restoreFs.files.has(original), true);
  assert.equal(restoreFs.files.has(stagedForRestore[0].staged), false);

  const purgeFs = memoryFileSystem([original]);
  const stagedForPurge = await stageDocumentFiles(
    [{ file_url: '/uploads/portfolio-documents/run.pdf' }],
    { fileSystem: purgeFs },
  );
  await purgeStagedFiles(stagedForPurge, { fileSystem: purgeFs });
  await purgeStagedFiles(stagedForPurge, { fileSystem: purgeFs });
  assert.equal(purgeFs.files.has(original), false);
  assert.equal(purgeFs.files.has(stagedForPurge[0].staged), false);

  const commitFailureFs = memoryFileSystem([original]);
  const stagedForFailure = await stageDocumentFiles(
    [{ file_url: '/uploads/portfolio-documents/run.pdf' }],
    { fileSystem: commitFailureFs },
  );
  await assert.rejects(
    settleStagedFiles(stagedForFailure, {
      committed: false,
      fileSystem: commitFailureFs,
      primaryError: new Error('commit failed'),
    }),
    /commit failed/,
  );
  assert.equal(commitFailureFs.files.has(original), true);
  assert.equal(commitFailureFs.files.has(stagedForFailure[0].staged), false);
});

test('document staging binds exact PDF metadata and bytes before deletion', async () => {
  const {
    createRunContext,
    stageDocumentFiles,
  } = loadSmoke();
  const context = createRunContext();
  assert.equal(context.expectedDocument.bytes.includes(Buffer.from(context.runId)), true);
  const original = path.resolve(
    __dirname,
    '..',
    'uploads',
    'portfolio-documents',
    'unrelated.pdf',
  );
  const unrelated = Buffer.from('%PDF-1.4\nunrelated existing file\n%%EOF\n');
  const fileSystem = memoryFileSystem([[original, unrelated]]);
  await assert.rejects(
    stageDocumentFiles([{
      file_name: context.expectedDocument.fileName,
      file_type: context.expectedDocument.fileType,
      file_url: '/uploads/portfolio-documents/unrelated.pdf',
    }], {
      expectedDocument: context.expectedDocument,
      fileSystem,
    }),
    /content|hash|byte/i,
  );
  assert.deepEqual(fileSystem.files.get(original), unrelated);
  assert.equal([...fileSystem.files.keys()].some((file) => file.includes('.cleanup-')), false);
  assert.equal(fileSystem.operations.filter(([operation]) => operation === 'rename').length, 2);
  assert.equal(fileSystem.operations.some(([operation]) => operation === 'unlink'), false);
});

test('file restoration failure is aggregated with the database failure', async () => {
  const {
    settleStagedFiles,
    stageDocumentFiles,
  } = loadSmoke();
  assert.equal(typeof settleStagedFiles, 'function');
  const original = path.resolve(__dirname, '..', 'uploads', 'portfolio-documents', 'run.pdf');
  const fileSystem = memoryFileSystem([original]);
  const staged = await stageDocumentFiles(
    [{ file_url: '/uploads/portfolio-documents/run.pdf' }],
    { fileSystem },
  );
  fileSystem.failures.rename = (from, to) => from === staged[0].staged && to === original;
  await assert.rejects(
    settleStagedFiles(staged, {
      committed: false,
      fileSystem,
      primaryError: new Error('database failed'),
    }),
    (error) => (
      error instanceof AggregateError
      && error.errors.some(({ message }) => message === 'database failed')
      && error.errors.some(({ message }) => message === 'rename failed')
    ),
  );
});

test('confirmed rollback restore and committed purge phases remain retryable', async () => {
  const {
    createCleanupController,
    createRunContext,
    resumeCleanupFiles,
  } = loadSmoke();
  assert.equal(typeof resumeCleanupFiles, 'function');
  for (const mode of ['restore', 'purge']) {
    const context = createRunContext();
    const original = path.resolve(
      __dirname,
      '..',
      'uploads',
      'portfolio-documents',
      `${mode}.pdf`,
    );
    const staged = `${original}.cleanup-test`;
    const fileSystem = memoryFileSystem([[staged, context.expectedDocument.bytes]]);
    context.cleanupPhase = mode === 'restore' ? 'db_rolled_back' : 'db_committed';
    context.stagedFiles = [{
      original,
      staged,
      state: 'staged',
      verifiedOwnership: true,
      size: context.expectedDocument.size,
      sha256: context.expectedDocument.sha256,
    }];
    context.baselineCounts = { portfolios: 0, conversation_members: 0, messages: 0 };
    let failed = false;
    if (mode === 'restore') {
      fileSystem.failures.rename = () => {
        if (failed) return false;
        failed = true;
        return true;
      };
    } else {
      fileSystem.failures.unlink = () => {
        if (failed) return false;
        failed = true;
        return true;
      };
    }
    const counts = { cleanup: 0, count: 0, close: 0 };
    context.database = {
      async end() { counts.close += 1; },
    };
    const controller = createCleanupController(context, {
      cleanup: async () => {
        counts.cleanup += 1;
        await resumeCleanupFiles(context, { fileSystem });
        context.cleanupPhase = 'complete';
      },
      captureCounts: async () => {
        counts.count += 1;
        return context.baselineCounts;
      },
    });
    await controller.cleanupAndClose();
    assert.deepEqual(counts, { cleanup: 2, count: 1, close: 1 });
    assert.equal(context.cleanupPhase, 'complete');
    assert.equal(context.stagedFiles.length, 0);
    assert.equal(fileSystem.files.has(mode === 'restore' ? original : staged), mode === 'restore');
  }
});

test('cleanup retries settlement only and never replays a destructive transaction', async () => {
  const {
    cleanTemporaryRecords,
    createRunContext,
  } = loadSmoke();
  const rollbackContext = createRunContext();
  const rollbackOriginal = path.resolve(
    __dirname,
    '..',
    'uploads',
    'portfolio-documents',
    'rollback-retry.pdf',
  );
  const rollbackStaged = `${rollbackOriginal}.cleanup-test`;
  const rollbackFs = memoryFileSystem([[
    rollbackStaged,
    rollbackContext.expectedDocument.bytes,
  ]]);
  rollbackContext.cleanupPhase = 'db_rolled_back';
  rollbackContext.cleanupFailure = new Error('original delete failure');
  rollbackContext.stagedFiles = [{
    original: rollbackOriginal,
    staged: rollbackStaged,
    state: 'staged',
    verifiedOwnership: true,
    size: rollbackContext.expectedDocument.size,
    sha256: rollbackContext.expectedDocument.sha256,
  }];
  const rollbackCalls = { begin: 0, commit: 0 };
  rollbackContext.database = {
    async query(sql) {
      if (/COUNT\(\*\).*FROM users WHERE email LIKE/s.test(String(sql))) {
        return [[{ count: 0 }], []];
      }
      return [[], []];
    },
    async beginTransaction() { rollbackCalls.begin += 1; },
    async commit() { rollbackCalls.commit += 1; },
    async rollback() {},
  };
  let restoreFailed = false;
  rollbackFs.failures.rename = () => {
    if (restoreFailed) return false;
    restoreFailed = true;
    return true;
  };
  await assert.rejects(
    cleanTemporaryRecords(rollbackContext, { fileSystem: rollbackFs }),
    (error) => (
      error instanceof AggregateError
      && error.errors.some(({ message }) => message === 'original delete failure')
      && error.errors.some(({ message }) => message === 'rename failed')
    ),
  );
  assert.deepEqual(rollbackCalls, { begin: 0, commit: 0 });
  await assert.rejects(
    cleanTemporaryRecords(rollbackContext, { fileSystem: rollbackFs }),
    /original delete failure/,
  );
  assert.deepEqual(rollbackCalls, { begin: 0, commit: 0 });
  assert.equal(rollbackContext.cleanupPhase, 'failed');

  const committedContext = createRunContext();
  const committedStaged = `${rollbackOriginal}.committed`;
  const committedFs = memoryFileSystem([[
    committedStaged,
    committedContext.expectedDocument.bytes,
  ]]);
  committedContext.cleanupPhase = 'db_committed';
  committedContext.stagedFiles = [{
    original: rollbackOriginal,
    staged: committedStaged,
    state: 'staged',
    verifiedOwnership: true,
    size: committedContext.expectedDocument.size,
    sha256: committedContext.expectedDocument.sha256,
  }];
  committedContext.database = {
    async query() { return [[{ count: 0 }], []]; },
    async beginTransaction() { throw new Error('committed cleanup replayed SQL'); },
  };
  await cleanTemporaryRecords(committedContext, { fileSystem: committedFs });
  assert.equal(committedContext.cleanupPhase, 'complete');
  assert.equal(committedFs.files.has(committedStaged), false);
});

test('ambiguous rollback and unverified staged evidence both fail closed', async () => {
  const {
    cleanTemporaryRecords,
    createRunContext,
    resumeCleanupFiles,
  } = loadSmoke();
  const context = createRunContext();
  let begins = 0;
  context.database = {
    async query(sql) {
      if (/COUNT\(\*\).*FROM users WHERE email LIKE/s.test(String(sql))) {
        return [[{ count: 0 }], []];
      }
      return [[], []];
    },
    async beginTransaction() { begins += 1; },
    async commit() { throw new Error('commit result lost'); },
    async rollback() { throw new Error('rollback result lost'); },
  };
  await assert.rejects(
    cleanTemporaryRecords(context),
    /indeterminate|rollback/i,
  );
  assert.equal(context.cleanupPhase, 'indeterminate');
  await assert.rejects(cleanTemporaryRecords(context), /indeterminate/i);
  assert.equal(begins, 1);

  const evidenceContext = createRunContext();
  const original = path.resolve(
    __dirname,
    '..',
    'uploads',
    'portfolio-documents',
    'unverified.pdf',
  );
  const staged = `${original}.cleanup-test`;
  const fileSystem = memoryFileSystem([[staged, evidenceContext.expectedDocument.bytes]]);
  evidenceContext.cleanupPhase = 'db_committed';
  evidenceContext.stagedFiles = [{ original, staged, state: 'staged' }];
  await assert.rejects(
    resumeCleanupFiles(evidenceContext, { fileSystem }),
    /verified ownership evidence/i,
  );
  assert.equal(fileSystem.files.has(staged), true);
  assert.equal(fileSystem.operations.some(([operation]) => operation === 'unlink'), false);
});

test('committed purge revalidates staged bytes immediately before unlink', async () => {
  const {
    createRunContext,
    resumeCleanupFiles,
  } = loadSmoke();
  const context = createRunContext();
  const original = path.resolve(
    __dirname,
    '..',
    'uploads',
    'portfolio-documents',
    'replaced-before-purge.pdf',
  );
  const staged = `${original}.cleanup-test`;
  const fileSystem = memoryFileSystem([[staged, context.expectedDocument.bytes]]);
  const readFile = fileSystem.readFile.bind(fileSystem);
  let reads = 0;
  fileSystem.readFile = async (file) => {
    reads += 1;
    if (reads === 2) fileSystem.files.set(file, Buffer.from('unrelated replacement'));
    return readFile(file);
  };
  context.cleanupPhase = 'db_committed';
  context.stagedFiles = [{
    original,
    staged,
    state: 'staged',
    verifiedOwnership: true,
    size: context.expectedDocument.size,
    sha256: context.expectedDocument.sha256,
  }];

  await assert.rejects(
    resumeCleanupFiles(context, { fileSystem }),
    /byte length|content hash/i,
  );
  assert.equal(reads, 2);
  assert.equal(fileSystem.files.has(staged), true);
  assert.equal(fileSystem.operations.some(([operation]) => operation === 'unlink'), false);
  assert.equal(context.stagedFiles.length, 1);
});

test('a rejected commit is indeterminate even when rollback resolves', async () => {
  const {
    cleanTemporaryRecords,
    createRunContext,
  } = loadSmoke();
  const context = createRunContext();
  const original = path.resolve(
    __dirname,
    '..',
    'uploads',
    'portfolio-documents',
    'commit-unknown.pdf',
  );
  const staged = `${original}.cleanup-test`;
  const fileSystem = memoryFileSystem([[staged, context.expectedDocument.bytes]]);
  const calls = { begin: 0, commit: 0, rollback: 0 };
  context.database = {
    async query(sql) {
      if (/COUNT\(\*\).*FROM users WHERE email LIKE/s.test(String(sql))) {
        return [[{ count: 0 }], []];
      }
      return [[], []];
    },
    async beginTransaction() { calls.begin += 1; },
    async commit() {
      calls.commit += 1;
      context.stagedFiles.push({
        original,
        staged,
        state: 'staged',
        verifiedOwnership: true,
        size: context.expectedDocument.size,
        sha256: context.expectedDocument.sha256,
      });
      throw new Error('commit acknowledgement lost after apply');
    },
    async rollback() { calls.rollback += 1; },
  };
  await assert.rejects(
    cleanTemporaryRecords(context, { fileSystem }),
    /commit|indeterminate/i,
  );
  assert.equal(context.cleanupPhase, 'indeterminate');
  assert.deepEqual(calls, { begin: 1, commit: 1, rollback: 1 });
  assert.equal(context.stagedFiles.length, 1);
  assert.equal(fileSystem.files.has(staged), true);
  assert.equal(fileSystem.files.has(original), false);
  await assert.rejects(
    cleanTemporaryRecords(context, { fileSystem }),
    /indeterminate/i,
  );
  assert.deepEqual(calls, { begin: 1, commit: 1, rollback: 1 });
});

test('cleanup retries are bounded, counts still run, and staged paths are reported', async () => {
  const {
    createCleanupController,
    createRunContext,
  } = loadSmoke();
  const context = createRunContext();
  context.baselineCounts = { portfolios: 0, conversation_members: 0, messages: 0 };
  context.cleanupPhase = 'db_committed';
  context.stagedFiles = [{
    original: '/tmp/original-run.pdf',
    staged: '/tmp/original-run.pdf.cleanup-stuck',
    state: 'staged',
    verifiedOwnership: true,
    size: context.expectedDocument.size,
    sha256: context.expectedDocument.sha256,
  }];
  const counts = { cleanup: 0, count: 0, close: 0 };
  context.database = {
    async end() { counts.close += 1; },
  };
  const controller = createCleanupController(context, {
    cleanup: async () => {
      counts.cleanup += 1;
      throw new Error('still failing');
    },
    captureCounts: async () => {
      counts.count += 1;
      return context.baselineCounts;
    },
  });
  await assert.rejects(
    controller.cleanupAndClose(),
    /cleanup-stuck/,
  );
  assert.deepEqual(counts, { cleanup: 3, count: 1, close: 1 });
});

test('arbitrary cleanup failures are not retried as destructive SQL', async () => {
  const {
    createCleanupController,
    createRunContext,
  } = loadSmoke();
  const context = createRunContext();
  context.baselineCounts = { portfolios: 0, conversation_members: 0, messages: 0 };
  const counts = { cleanup: 0, count: 0, close: 0 };
  context.database = {
    async end() { counts.close += 1; },
  };
  const controller = createCleanupController(context, {
    cleanup: async () => {
      counts.cleanup += 1;
      throw new Error('arbitrary delete failure');
    },
    captureCounts: async () => {
      counts.count += 1;
      return context.baselineCounts;
    },
  });
  await assert.rejects(controller.cleanupAndClose(), /arbitrary delete failure/);
  assert.deepEqual(counts, { cleanup: 1, count: 1, close: 1 });
});

test('cleanup controller is idempotent and main closes after baseline failure', async () => {
  const {
    createCleanupController,
    createRunContext,
    main,
  } = loadSmoke();
  assert.equal(typeof createCleanupController, 'function');
  const context = createRunContext();
  const counts = { cleanup: 0, close: 0 };
  context.database = {
    async end() { counts.close += 1; },
  };
  const controller = createCleanupController(context, {
    cleanup: async () => { counts.cleanup += 1; },
    captureCounts: async () => ({ portfolios: 0, conversation_members: 0, messages: 0 }),
  });
  const first = controller.cleanupAndClose();
  const second = controller.cleanupAndClose();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.deepEqual(counts, { cleanup: 1, close: 1 });

  let mainCloseCount = 0;
  await assert.rejects(
    main({
      DB_USER: 'generated',
      DB_PASSWORD: 'generated',
      DB_NAME: 'generated',
      LUMILABS_E2E_ORIGIN: 'http://127.0.0.1:3100',
    }, {
      createConnection: async () => ({
        async end() { mainCloseCount += 1; },
      }),
      captureCounts: async () => {
        throw new Error('baseline failed');
      },
      cleanup: async () => {},
      installSignalHandlers: false,
      runFlow: async () => {
        throw new Error('flow must not run');
      },
    }),
    /baseline failed/,
  );
  assert.equal(mainCloseCount, 1);
});

test('signal handlers only abort the flow and outer finally owns teardown', async () => {
  const { main } = loadSmoke();
  const processTarget = new EventEmitter();
  const counts = { cleanup: 0, close: 0 };
  await assert.rejects(
    main({
      DB_USER: 'generated',
      DB_PASSWORD: 'generated',
      DB_NAME: 'generated',
      LUMILABS_E2E_ORIGIN: 'http://127.0.0.1:3100',
    }, {
      createConnection: async () => ({
        async end() { counts.close += 1; },
      }),
      captureCounts: async () => ({ portfolios: 0, conversation_members: 0, messages: 0 }),
      cleanup: async () => { counts.cleanup += 1; },
      processTarget,
      runFlow: async () => {
        processTarget.emit('SIGTERM', 'SIGTERM');
        assert.equal(counts.cleanup, 0, 'the signal handler must not race cleanup');
      },
    }),
    /SIGTERM/,
  );
  assert.deepEqual(counts, { cleanup: 1, close: 1 });
  assert.equal(processTarget.listenerCount('SIGINT'), 0);
  assert.equal(processTarget.listenerCount('SIGTERM'), 0);
});

test('a signal during cleanup still fails main after teardown', async () => {
  const { main } = loadSmoke();
  const processTarget = new EventEmitter();
  let closed = 0;
  await assert.rejects(
    main({
      DB_USER: 'generated',
      DB_PASSWORD: 'generated',
      DB_NAME: 'generated',
      LUMILABS_E2E_ORIGIN: 'http://127.0.0.1:3100',
    }, {
      createConnection: async () => ({
        async end() { closed += 1; },
      }),
      captureCounts: async () => ({ portfolios: 0, conversation_members: 0, messages: 0 }),
      cleanup: async () => {
        processTarget.emit('SIGINT', 'SIGINT');
      },
      processTarget,
      runFlow: async () => {},
    }),
    /SIGINT/,
  );
  assert.equal(closed, 1);
});

test('a second signal removes handlers and invokes the force-termination escape', async () => {
  const { main } = loadSmoke();
  const processTarget = new EventEmitter();
  let releaseConnection;
  const connectionReady = new Promise((resolve) => { releaseConnection = resolve; });
  const forced = [];
  let flowCalls = 0;
  const running = main({
    DB_USER: 'generated',
    DB_PASSWORD: 'generated',
    DB_NAME: 'generated',
    LUMILABS_E2E_ORIGIN: 'http://127.0.0.1:3100',
  }, {
    createConnection: async () => connectionReady,
    captureCounts: async () => ({ portfolios: 0, conversation_members: 0, messages: 0 }),
    cleanup: async () => {},
    forceTerminate: (signal) => { forced.push(signal); },
    processTarget,
    runFlow: async () => { flowCalls += 1; },
  });
  processTarget.emit('SIGTERM', 'SIGTERM');
  processTarget.emit('SIGTERM', 'SIGTERM');
  assert.deepEqual(forced, ['SIGTERM']);
  assert.equal(processTarget.listenerCount('SIGINT'), 0);
  assert.equal(processTarget.listenerCount('SIGTERM'), 0);
  releaseConnection({ async end() {} });
  await assert.rejects(running, /SIGTERM/);
  assert.equal(flowCalls, 0);
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
