const test = require('node:test');
const assert = require('node:assert/strict');

const {
  StaffProvisioningError,
  createStaffAccount,
} = require('../src/services/staff-provisioning-workflow');

function clone(value) {
  return structuredClone(value);
}

function normalizedSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function staffHarness(options = {}) {
  let state = {
    users: clone(options.users || [{
      id: 1,
      name: 'Root Admin',
      email: 'root@example.test',
      role: options.actorRole || 'superadmin',
    }]),
    audits: [],
  };
  let transactionSnapshot = null;
  const calls = [];
  let connections = 0;
  let begins = 0;
  let commits = 0;
  let rollbacks = 0;
  let releases = 0;
  let destroys = 0;
  let queryInserts = 0;
  let executeInserts = 0;

  async function insertUser(sqlValue, params = []) {
    const sql = normalizedSql(sqlValue);
    assert.equal(
      sql,
      'INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)',
    );
    if (options.insertError) throw options.insertError;
    const [email, password_hash, name, role] = params;
    const user = {
      id: 15,
      name,
      email,
      password_hash,
      role,
      created_at: '2026-07-27T00:00:00.000Z',
    };
    state.users.push(user);
    return [{ insertId: user.id, affectedRows: 1 }, []];
  }

  const connection = {
    async beginTransaction() {
      begins += 1;
      transactionSnapshot = clone(state);
    },
    async query(sqlValue, params = []) {
      const sql = normalizedSql(sqlValue);
      calls.push({ sql, params: clone(params) });

      if (sql === 'SELECT id,name,email,role FROM users WHERE id=? FOR UPDATE') {
        return [[
          ...state.users
            .filter((user) => user.id === params[0])
            .map(clone),
        ], []];
      }

      if (sql === 'SELECT id FROM users WHERE email=? FOR UPDATE') {
        return [[
          ...state.users
            .filter((user) => user.email === params[0])
            .map(({ id }) => ({ id })),
        ], []];
      }

      if (sql === 'INSERT INTO users (email,password_hash,name,role) VALUES (?,?,?,?)') {
        queryInserts += 1;
        return insertUser(sqlValue, params);
      }

      if (sql === 'SELECT id,name,email,role,created_at FROM users WHERE id=?') {
        return [[
          ...state.users
            .filter((user) => user.id === params[0])
            .map(clone),
        ], []];
      }

      if (sql.startsWith('INSERT INTO superadmin_audit_logs')) {
        assert.equal(
          sql,
          'INSERT INTO superadmin_audit_logs '
            + '(superadmin_id, superadmin_id_snapshot, superadmin_name_snapshot, '
            + 'superadmin_email_snapshot, action, created_user_id, '
            + 'created_user_id_snapshot, created_user_name_snapshot, '
            + 'created_user_email_snapshot, created_user_role) '
            + 'VALUES (?,?,?,?,?,?,?,?,?,?)',
        );
        if (options.auditError) throw options.auditError;
        const columns = [
          'superadmin_id',
          'superadmin_id_snapshot',
          'superadmin_name_snapshot',
          'superadmin_email_snapshot',
          'action',
          'created_user_id',
          'created_user_id_snapshot',
          'created_user_name_snapshot',
          'created_user_email_snapshot',
          'created_user_role',
        ];
        state.audits.push(Object.fromEntries(
          columns.map((column, index) => [column, params[index]]),
        ));
        return [{ affectedRows: 1 }, []];
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute(sqlValue, params = []) {
      executeInserts += 1;
      calls.push({
        sql: normalizedSql(sqlValue),
        params: clone(params),
        prepared: true,
      });
      return insertUser(sqlValue, params);
    },
    async commit() {
      commits += 1;
      transactionSnapshot = null;
    },
    async rollback() {
      rollbacks += 1;
      if (options.rollbackError) throw options.rollbackError;
      if (transactionSnapshot) state = clone(transactionSnapshot);
      transactionSnapshot = null;
    },
    release() {
      releases += 1;
    },
    destroy() {
      destroys += 1;
      if (options.destroyError) throw options.destroyError;
    },
  };

  return {
    async getConnection() {
      connections += 1;
      return connection;
    },
    auditActions: () => state.audits.map(({ action }) => action),
    audits: () => clone(state.audits),
    createdUsers: () => clone(state.users.filter(({ id }) => id === 15)),
    get calls() {
      return clone(calls);
    },
    get connections() {
      return connections;
    },
    get begins() {
      return begins;
    },
    get commits() {
      return commits;
    },
    get rollbacks() {
      return rollbacks;
    },
    get releases() {
      return releases;
    },
    get destroys() {
      return destroys;
    },
    get queryInserts() {
      return queryInserts;
    },
    get executeInserts() {
      return executeInserts;
    },
  };
}

test('creates an admin and its audit row in one transaction', async () => {
  const database = staffHarness();
  const staff = await createStaffAccount({
    database,
    superadminId: 1,
    name: '  New Admin  ',
    email: ' NEW.ADMIN@EXAMPLE.TEST ',
    password: 'secure12',
    role: 'admin',
    hashPassword: async () => 'bcrypt-hash',
  });
  assert.equal(staff.name, 'New Admin');
  assert.equal(staff.email, 'new.admin@example.test');
  assert.equal(staff.role, 'admin');
  assert.equal('password' in staff, false);
  assert.equal('password_hash' in staff, false);
  assert.deepEqual(database.auditActions(), ['admin_account_created']);
  assert.equal(database.commits, 1);
  assert.equal(database.executeInserts, 1);
  assert.equal(database.queryInserts, 0);
});

test('creates a relationship manager with exact immutable audit snapshots', async () => {
  const database = staffHarness();
  const staff = await createStaffAccount({
    database,
    superadminId: 1,
    name: 'New Manager',
    email: 'manager@example.test',
    password: 'secure12',
    role: 'relationship_manager',
    hashPassword: async () => 'bcrypt-hash',
  });

  assert.deepEqual(staff, {
    id: 15,
    name: 'New Manager',
    email: 'manager@example.test',
    role: 'relationship_manager',
    created_at: '2026-07-27T00:00:00.000Z',
  });
  assert.deepEqual(database.audits(), [{
    superadmin_id: 1,
    superadmin_id_snapshot: 1,
    superadmin_name_snapshot: 'Root Admin',
    superadmin_email_snapshot: 'root@example.test',
    action: 'relationship_manager_account_created',
    created_user_id: 15,
    created_user_id_snapshot: 15,
    created_user_name_snapshot: 'New Manager',
    created_user_email_snapshot: 'manager@example.test',
    created_user_role: 'relationship_manager',
  }]);
});

test('invalid role performs no hashing or database work', async () => {
  let hashes = 0;
  const database = staffHarness();
  await assert.rejects(
    createStaffAccount({
      database,
      superadminId: 1,
      name: 'Bad Role',
      email: 'bad@example.test',
      password: 'secure12',
      role: 'superadmin',
      hashPassword: async () => {
        hashes += 1;
        return 'unused';
      },
    }),
    error => error.status === 400 && error.code === 'INVALID_STAFF_ROLE'
  );
  assert.equal(hashes, 0);
  assert.equal(database.connections, 0);
});

test('all invalid fields fail before hashing or database access', async (t) => {
  const cases = [
    {
      name: '',
      email: 'valid@example.test',
      password: 'secure12',
      role: 'admin',
      code: 'INVALID_NAME',
    },
    {
      name: 'n'.repeat(101),
      email: 'valid@example.test',
      password: 'secure12',
      role: 'admin',
      code: 'INVALID_NAME',
    },
    {
      name: 'Valid',
      email: 'not-an-email',
      password: 'secure12',
      role: 'admin',
      code: 'INVALID_EMAIL',
    },
    {
      name: 'Valid',
      email: `${'a'.repeat(244)}@example.test`,
      password: 'secure12',
      role: 'admin',
      code: 'INVALID_EMAIL',
    },
    {
      name: 'Valid',
      email: 'valid@example.test',
      password: 'short',
      role: 'admin',
      code: 'INVALID_PASSWORD',
    },
    {
      name: 'Valid',
      email: 'valid@example.test',
      password: 'p'.repeat(129),
      role: 'admin',
      code: 'INVALID_PASSWORD',
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.code, async () => {
      let hashes = 0;
      const database = staffHarness();
      await assert.rejects(
        createStaffAccount({
          database,
          superadminId: 1,
          ...fixture,
          hashPassword: async () => {
            hashes += 1;
            return 'unused';
          },
        }),
        error => (
          error instanceof StaffProvisioningError
          && error.status === 400
          && error.code === fixture.code
        ),
      );
      assert.equal(hashes, 0);
      assert.equal(database.connections, 0);
    });
  }
});

test('requires a locked superadmin actor and rolls back', async () => {
  const database = staffHarness({ actorRole: 'admin' });
  await assert.rejects(
    createStaffAccount({
      database,
      superadminId: 1,
      name: 'New Admin',
      email: 'new@example.test',
      password: 'secure12',
      role: 'admin',
      hashPassword: async () => 'bcrypt-hash',
    }),
    error => error.status === 403 && error.code === 'SUPERADMIN_REQUIRED',
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.deepEqual(database.createdUsers(), []);
});

test('duplicate email pre-check rolls back without inserting or auditing', async () => {
  const database = staffHarness({
    users: [
      { id: 1, name: 'Root Admin', email: 'root@example.test', role: 'superadmin' },
      { id: 9, name: 'Existing', email: 'taken@example.test', role: 'investor' },
    ],
  });
  await assert.rejects(
    createStaffAccount({
      database,
      superadminId: 1,
      name: 'New Admin',
      email: 'TAKEN@EXAMPLE.TEST',
      password: 'secure12',
      role: 'admin',
      hashPassword: async () => 'bcrypt-hash',
    }),
    error => error.status === 409 && error.code === 'DUPLICATE_EMAIL',
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.deepEqual(database.createdUsers(), []);
  assert.deepEqual(database.auditActions(), []);
});

test('duplicate insert race maps to DUPLICATE_EMAIL and rolls back', async () => {
  const duplicate = new Error('duplicate');
  duplicate.code = 'ER_DUP_ENTRY';
  const database = staffHarness({ insertError: duplicate });

  await assert.rejects(
    createStaffAccount({
      database,
      superadminId: 1,
      name: 'New Admin',
      email: 'new@example.test',
      password: 'secure12',
      role: 'admin',
      hashPassword: async () => 'bcrypt-hash',
    }),
    error => error.status === 409 && error.code === 'DUPLICATE_EMAIL',
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.deepEqual(database.auditActions(), []);
});

test('unexpected insert errors cannot expose the password or hash', async () => {
  const password = 'secure12';
  const passwordHash = 'bcrypt-hash';
  const insertError = new Error(`insert failed for ${passwordHash}`);
  insertError.sql = `INSERT INTO users VALUES ('${passwordHash}')`;
  insertError.sqlMessage = `invalid value ${passwordHash}`;
  insertError.parameters = ['new@example.test', passwordHash];
  insertError.cause = new Error(`driver retained ${password}`);
  const database = staffHarness({ insertError });
  let thrown;

  try {
    await createStaffAccount({
      database,
      superadminId: 1,
      name: 'New Admin',
      email: 'new@example.test',
      password,
      role: 'admin',
      hashPassword: async () => passwordHash,
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof StaffProvisioningError);
  assert.equal(thrown.status, 500);
  assert.equal(thrown.code, 'STAFF_PROVISIONING_FAILED');
  assert.equal(thrown.message, 'Staff account could not be created');
  assert.equal(Object.hasOwn(thrown, 'cause'), false);
  assert.equal(Object.hasOwn(thrown, 'sql'), false);
  assert.equal(Object.hasOwn(thrown, 'sqlMessage'), false);
  assert.equal(Object.hasOwn(thrown, 'parameters'), false);
  const serialized = `${thrown.message} ${JSON.stringify(thrown)}`;
  assert.doesNotMatch(serialized, new RegExp(password));
  assert.doesNotMatch(serialized, new RegExp(passwordHash));
  assert.equal(database.executeInserts, 1);
  assert.equal(database.queryInserts, 0);
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
});

test('audit failure rolls back the inserted staff account', async () => {
  const auditError = new Error('audit unavailable');
  const database = staffHarness({ auditError });

  await assert.rejects(
    createStaffAccount({
      database,
      superadminId: 1,
      name: 'New Admin',
      email: 'new@example.test',
      password: 'secure12',
      role: 'admin',
      hashPassword: async () => 'bcrypt-hash',
    }),
    error => (
      error instanceof StaffProvisioningError
      && error.status === 500
      && error.code === 'STAFF_PROVISIONING_FAILED'
    ),
  );
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.releases, 1);
  assert.deepEqual(database.createdUsers(), []);
  assert.deepEqual(database.auditActions(), []);
});

test('rollback failure destroys the connection and preserves a safe primary error', async () => {
  const password = 'secure12';
  const passwordHash = 'bcrypt-hash';
  const auditError = new Error(`audit exposed ${passwordHash}`);
  auditError.sql = `INSERT audit '${passwordHash}'`;
  auditError.parameters = [passwordHash];
  auditError.cause = new Error(password);
  const rollbackError = new Error('rollback failed');
  const destroyError = new Error('destroy failed');
  const database = staffHarness({ auditError, rollbackError, destroyError });
  let thrown;

  try {
    await createStaffAccount({
      database,
      superadminId: 1,
      name: 'New Admin',
      email: 'new@example.test',
      password,
      role: 'admin',
      hashPassword: async () => passwordHash,
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof StaffProvisioningError);
  assert.equal(thrown.status, 500);
  assert.equal(thrown.code, 'STAFF_PROVISIONING_FAILED');
  assert.equal(thrown.message, 'Staff account could not be created');
  assert.equal(Object.hasOwn(thrown, 'cause'), false);
  assert.equal(Object.hasOwn(thrown, 'sql'), false);
  assert.equal(Object.hasOwn(thrown, 'parameters'), false);
  const serialized = `${thrown.message} ${JSON.stringify(thrown)}`;
  assert.doesNotMatch(serialized, new RegExp(password));
  assert.doesNotMatch(serialized, new RegExp(passwordHash));
  assert.equal(database.commits, 0);
  assert.equal(database.rollbacks, 1);
  assert.equal(database.destroys, 1);
  assert.equal(database.releases, 0);
});
