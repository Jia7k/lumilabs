const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadSuperadminStats,
  listPortfolioAssignments,
  listRelationshipManagers,
  listStaff,
  listSuperadminAuditLogs,
} = require('../src/services/superadmin-read-model');

function normalizeSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

test('assignment list includes approved portfolios and retained non-approved assignments', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql: normalizeSql(sql), params });
      return [[
        {
          id: '1',
          name: 'Approved Unassigned',
          status: 'approved',
          owner_id: '11',
          owner_name: 'Owner One',
          owner_email: 'owner1@example.test',
          relationship_manager_id: null,
          relationship_manager_name: null,
          relationship_manager_email: null,
          conversation_id: null,
          conversation_status: null,
          conversation_archived_reason: null,
        },
        {
          id: '2',
          name: 'Retained Rejected',
          status: 'rejected',
          owner_id: '12',
          owner_name: 'Owner Two',
          owner_email: 'owner2@example.test',
          relationship_manager_id: '8',
          relationship_manager_name: 'Rachel Manager',
          relationship_manager_email: 'rachel@example.test',
          conversation_id: '40',
          conversation_status: 'archived',
          conversation_archived_reason: 'portfolio_unapproved',
        },
        {
          id: '4',
          name: 'Approved Assigned',
          status: 'approved',
          owner_id: '14',
          owner_name: 'Owner Four',
          owner_email: 'owner4@example.test',
          relationship_manager_id: '9',
          relationship_manager_name: 'Morgan Manager',
          relationship_manager_email: 'morgan@example.test',
          conversation_id: null,
          conversation_status: null,
          conversation_archived_reason: null,
        },
      ], []];
    },
  };

  const items = await listPortfolioAssignments(database);

  assert.equal(calls.length, 1);
  assert.match(
    calls[0].sql,
    /WHERE p\.status='approved' OR p\.relationship_manager_id IS NOT NULL/,
  );
  assert.deepEqual(items.map((item) => item.id), [1, 2, 4]);
  assert.equal(items.find((item) => item.id === 3), undefined);
  assert.deepEqual(items[0], {
    id: 1,
    name: 'Approved Unassigned',
    status: 'approved',
    owner: {
      id: 11,
      name: 'Owner One',
      email: 'owner1@example.test',
    },
    relationship_manager: null,
    conversation: null,
    actions: {
      can_assign: true,
      assign_disabled_reason: null,
      can_reassign: false,
      reassign_disabled_reason: null,
      can_unassign: false,
      unassign_disabled_reason: null,
    },
  });
  assert.deepEqual(items[1].relationship_manager, {
    id: 8,
    name: 'Rachel Manager',
    email: 'rachel@example.test',
  });
  assert.deepEqual(items[1].conversation, {
    id: 40,
    status: 'archived',
    archived_reason: 'portfolio_unapproved',
  });
  assert.deepEqual(items[1].actions, {
    can_assign: false,
    assign_disabled_reason: 'Portfolio must be approved before assignment',
    can_reassign: false,
    reassign_disabled_reason: 'Portfolio must be approved before reassignment',
    can_unassign: false,
    unassign_disabled_reason:
      'Reassign required because this portfolio already has a chat',
  });
  assert.equal(items[2].actions.can_reassign, true);
  assert.equal(items[2].actions.can_unassign, true);
});

test('stats cover all live roles, assignment totals, and manager room workload', async () => {
  const calls = [];
  const responses = [
    [{
      business_owners: '5',
      investors: '7',
      relationship_managers: '2',
      admins: '3',
      superadmins: '1',
    }],
    [{
      approved_portfolios: '6',
      unassigned_portfolios: '2',
      assigned_portfolios: '5',
    }],
    [{
      id: '8',
      name: 'Rachel Manager',
      email: 'rachel@example.test',
      assigned_portfolios: '4',
      active_rooms: '2',
    }],
  ];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql: normalizeSql(sql), params });
      assert.ok(responses.length, `Unexpected query: ${sql}`);
      return [responses.shift(), []];
    },
  };

  const stats = await loadSuperadminStats(database);

  assert.deepEqual(stats, {
    business_owners: 5,
    investors: 7,
    relationship_managers: 2,
    admins: 3,
    superadmins: 1,
    approved_portfolios: 6,
    unassigned_portfolios: 2,
    assigned_portfolios: 5,
    rm_workload: [{
      id: 8,
      name: 'Rachel Manager',
      email: 'rachel@example.test',
      assigned_portfolios: 4,
      active_rooms: 2,
    }],
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /role='superadmin'/);
  assert.match(calls[1].sql, /status='approved'/);
  assert.match(calls[1].sql, /relationship_manager_id IS NULL/);
  assert.match(calls[1].sql, /relationship_manager_id IS NOT NULL/);
  assert.match(calls[2].sql, /c\.status='active'/);
});

test('manager and staff directories expose only safe account metadata', async () => {
  const calls = [];
  const manager = {
    id: 8,
    name: 'Rachel Manager',
    email: 'rachel@example.test',
    role: 'relationship_manager',
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-21T00:00:00.000Z',
  };
  const admin = {
    id: 9,
    name: 'Avery Admin',
    email: 'avery@example.test',
    role: 'admin',
    created_at: '2026-07-22T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
  };
  const database = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, params });
      if (normalized.includes("role='relationship_manager'")) {
        return [[manager], []];
      }
      if (normalized.includes("role IN ('admin','relationship_manager')")) {
        return [[admin, manager], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  assert.deepEqual(await listRelationshipManagers(database), [manager]);
  assert.deepEqual(await listStaff(database), [admin, manager]);
  assert.equal(calls.length, 2);
  for (const { sql } of calls) {
    assert.doesNotMatch(sql, /password/i);
    assert.match(sql, /^SELECT id,name,email,role,created_at,updated_at FROM users/);
  }
});

test('audit history uses stable newest-first pagination and immutable snapshots', async () => {
  const auditRows = [{
    id: '9007199254740993',
    superadmin_id_snapshot: 1,
    superadmin_name_snapshot: 'Root Admin',
    superadmin_email_snapshot: 'root@example.test',
    action: 'portfolio_reassigned',
    portfolio_id_snapshot: 20,
    portfolio_name_snapshot: 'Growth Co',
    previous_relationship_manager_id_snapshot: 7,
    previous_relationship_manager_name_snapshot: 'Previous Manager',
    previous_relationship_manager_email_snapshot: 'previous@example.test',
    new_relationship_manager_id_snapshot: 8,
    new_relationship_manager_name_snapshot: 'Rachel Manager',
    new_relationship_manager_email_snapshot: 'rachel@example.test',
    created_user_id_snapshot: null,
    created_user_name_snapshot: null,
    created_user_email_snapshot: null,
    created_user_role: null,
    created_at: '2026-07-27T00:00:00.000Z',
  }];
  const calls = [];
  const database = {
    async query(sql, params = []) {
      const normalized = normalizeSql(sql);
      calls.push({ sql: normalized, params });
      if (normalized.startsWith('SELECT COUNT(*) AS total')) {
        return [[{ total: '61' }], []];
      }
      return [auditRows, []];
    },
  };

  const result = await listSuperadminAuditLogs(database, { page: 2, limit: 25 });

  assert.deepEqual(result, {
    items: auditRows,
    pagination: {
      page: 2,
      limit: 25,
      total: 61,
      total_pages: 3,
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /ORDER BY created_at DESC,id DESC LIMIT \? OFFSET \?$/);
  assert.deepEqual(calls[1].params, [25, 25]);
  assert.equal(result.items[0].id, '9007199254740993');
});
