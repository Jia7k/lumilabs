const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'superadmin-route-test-secret';

const {
  SuperadminAssignmentError,
} = require('../src/services/superadmin-assignment-workflow');
const {
  StaffProvisioningError,
} = require('../src/services/staff-provisioning-workflow');

function loadRouterFactory() {
  return require('../src/routes/superadmin').createSuperadminRouter;
}

async function listen(app) {
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function token(role = 'superadmin', id = 1) {
  return jwt.sign({
    id,
    email: `${role}-${id}@example.test`,
    name: role,
    role,
  }, process.env.JWT_SECRET);
}

function testApp({
  database = { marker: 'database' },
  assignmentWorkflow = {},
  provisioningWorkflow = {},
  readModel = {},
} = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/superadmin', loadRouterFactory()({
    database,
    assignmentWorkflow,
    provisioningWorkflow,
    readModel,
  }));
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  return app;
}

async function requester(t, app) {
  const server = await listen(app);
  t.after(server.close);
  return async function request(
    method,
    path,
    { role = 'superadmin', id = 1, body, authenticated = true } = {},
  ) {
    const response = await fetch(`${server.origin}${path}`, {
      method,
      headers: authenticated ? {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token(role, id)}`,
      } : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      response,
      payload: await response.json(),
    };
  };
}

test('router exposes all eight final routes and delegates every mutation', async (t) => {
  const database = { marker: 'injected database' };
  const calls = [];
  const readModel = {
    async loadSuperadminStats(received) {
      calls.push(['stats', received]);
      return { admins: 2 };
    },
    async listPortfolioAssignments(received) {
      calls.push(['assignments', received]);
      return [{ id: 20 }];
    },
    async listRelationshipManagers(received) {
      calls.push(['managers', received]);
      return [{ id: 8 }];
    },
    async listStaff(received) {
      calls.push(['staff', received]);
      return [{ id: 9 }];
    },
    async listSuperadminAuditLogs(received, pagination) {
      calls.push(['audit', received, pagination]);
      return { items: [], pagination };
    },
  };
  const assignmentWorkflow = {
    async assignPortfolio(options) {
      calls.push(['assign', options]);
      return { changed: true, action: 'portfolio_assigned' };
    },
    async unassignPortfolio(options) {
      calls.push(['unassign', options]);
      return { changed: true, action: 'portfolio_unassigned' };
    },
  };
  const provisioningWorkflow = {
    async createStaffAccount(options) {
      calls.push(['createStaff', options]);
      return {
        id: 9,
        name: options.name,
        email: options.email,
        role: options.role,
      };
    },
  };
  const request = await requester(t, testApp({
    database,
    assignmentWorkflow,
    provisioningWorkflow,
    readModel,
  }));

  const stats = await request('GET', '/api/superadmin/stats');
  const assignments = await request('GET', '/api/superadmin/portfolio-assignments');
  const managers = await request('GET', '/api/superadmin/relationship-managers');
  const staff = await request('GET', '/api/superadmin/staff');
  const created = await request('POST', '/api/superadmin/staff', {
    body: {
      name: ' Avery Admin ',
      email: 'Avery@Example.Test',
      password: 'secret1',
      role: 'admin',
      ignored: 'not forwarded',
    },
  });
  const assigned = await request(
    'PUT',
    '/api/superadmin/portfolios/20/assignment',
    { body: { relationship_manager_id: 8 } },
  );
  const unassigned = await request(
    'DELETE',
    '/api/superadmin/portfolios/20/assignment',
  );
  const audit = await request(
    'GET',
    '/api/superadmin/audit-logs?page=2&limit=25',
  );

  assert.equal(stats.response.status, 200);
  assert.deepEqual(stats.payload, { admins: 2 });
  assert.equal(assignments.response.status, 200);
  assert.deepEqual(assignments.payload, [{ id: 20 }]);
  assert.equal(managers.response.status, 200);
  assert.deepEqual(managers.payload, [{ id: 8 }]);
  assert.equal(staff.response.status, 200);
  assert.deepEqual(staff.payload, [{ id: 9 }]);
  assert.equal(created.response.status, 201);
  assert.equal(assigned.response.status, 200);
  assert.equal(unassigned.response.status, 200);
  assert.equal(audit.response.status, 200);
  assert.deepEqual(calls, [
    ['stats', database],
    ['assignments', database],
    ['managers', database],
    ['staff', database],
    ['createStaff', {
      database,
      superadminId: 1,
      name: ' Avery Admin ',
      email: 'Avery@Example.Test',
      password: 'secret1',
      role: 'admin',
    }],
    ['assign', {
      database,
      superadminId: 1,
      portfolioId: 20,
      relationshipManagerId: 8,
    }],
    ['unassign', {
      database,
      superadminId: 1,
      portfolioId: 20,
    }],
    ['audit', database, { page: 2, limit: 25 }],
  ]);
});

test('router-level boundary rejects anonymous and non-superadmin requests', async (t) => {
  let calls = 0;
  const readModel = {
    async loadSuperadminStats() {
      calls += 1;
      return {};
    },
  };
  const request = await requester(t, testApp({ readModel }));

  const anonymous = await request('GET', '/api/superadmin/stats', {
    authenticated: false,
  });
  const admin = await request('GET', '/api/superadmin/stats', { role: 'admin' });

  assert.equal(anonymous.response.status, 401);
  assert.deepEqual(anonymous.payload, { error: 'Access token required' });
  assert.equal(admin.response.status, 403);
  assert.deepEqual(admin.payload, { error: 'Insufficient permissions' });
  assert.equal(calls, 0);
});

test('malformed IDs and pagination stop before workflows or read models', async (t) => {
  let assignmentCalls = 0;
  let auditCalls = 0;
  const assignmentWorkflow = {
    async assignPortfolio() {
      assignmentCalls += 1;
    },
    async unassignPortfolio() {
      assignmentCalls += 1;
    },
  };
  const readModel = {
    async listSuperadminAuditLogs() {
      auditCalls += 1;
      return { items: [], pagination: {} };
    },
  };
  const request = await requester(t, testApp({
    assignmentWorkflow,
    readModel,
  }));

  for (const [method, path, body] of [
    ['PUT', '/api/superadmin/portfolios/20junk/assignment', {
      relationship_manager_id: 8,
    }],
    ['PUT', '/api/superadmin/portfolios/0/assignment', {
      relationship_manager_id: 8,
    }],
    ['PUT', '/api/superadmin/portfolios/20/assignment', {
      relationship_manager_id: '8junk',
    }],
    ['PUT', '/api/superadmin/portfolios/20/assignment', {
      relationship_manager_id: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['DELETE', '/api/superadmin/portfolios/20junk/assignment'],
  ]) {
    const result = await request(method, path, { body });
    assert.equal(result.response.status, 400, `${method} ${path}`);
  }

  for (const path of [
    '/api/superadmin/audit-logs?page=0',
    '/api/superadmin/audit-logs?page=1junk',
    '/api/superadmin/audit-logs?page=9007199254740992',
    '/api/superadmin/audit-logs?limit=0',
    '/api/superadmin/audit-logs?limit=101',
    '/api/superadmin/audit-logs?limit=2junk',
    `/api/superadmin/audit-logs?page=${Number.MAX_SAFE_INTEGER}&limit=100`,
  ]) {
    const result = await request('GET', path);
    assert.equal(result.response.status, 400, path);
  }
  assert.equal(assignmentCalls, 0);
  assert.equal(auditCalls, 0);
});

test('obsolete direct assignment path no longer exists', async (t) => {
  let calls = 0;
  const assignmentWorkflow = {
    async assignPortfolio() {
      calls += 1;
    },
  };
  const request = await requester(t, testApp({ assignmentWorkflow }));

  const result = await request(
    'PUT',
    '/api/superadmin/portfolios/20/assign',
    { body: { relationship_manager_id: 8 } },
  );

  assert.equal(result.response.status, 404);
  assert.deepEqual(result.payload, { error: 'Route not found' });
  assert.equal(calls, 0);
});

test('typed workflow failures preserve public status and code', async (t) => {
  const assignmentWorkflow = {
    async assignPortfolio() {
      throw new SuperadminAssignmentError(
        404,
        'Portfolio not found',
        'PORTFOLIO_NOT_FOUND',
      );
    },
  };
  const provisioningWorkflow = {
    async createStaffAccount() {
      throw new StaffProvisioningError(
        409,
        'Email already registered',
        'DUPLICATE_EMAIL',
      );
    },
  };
  const request = await requester(t, testApp({
    assignmentWorkflow,
    provisioningWorkflow,
  }));

  const assigned = await request(
    'PUT',
    '/api/superadmin/portfolios/20/assignment',
    { body: { relationship_manager_id: 8 } },
  );
  const created = await request('POST', '/api/superadmin/staff', {
    body: {
      name: 'Avery Admin',
      email: 'avery@example.test',
      password: 'secret1',
      role: 'admin',
    },
  });

  assert.equal(assigned.response.status, 404);
  assert.deepEqual(assigned.payload, {
    error: 'Portfolio not found',
    code: 'PORTFOLIO_NOT_FOUND',
  });
  assert.equal(created.response.status, 409);
  assert.deepEqual(created.payload, {
    error: 'Email already registered',
    code: 'DUPLICATE_EMAIL',
  });
});

test('workflow 5xx failures are generic and safely logged', {
  concurrency: false,
}, async (t) => {
  const staffSecret = 'staff credential password=staff-secret';
  const assignmentSecret = 'assignment credential password=assignment-secret';
  const unknownSecret = 'driver credential password=driver-secret';
  const staffError = new StaffProvisioningError(
    500,
    staffSecret,
    'INTERNAL_STAFF_CODE',
  );
  staffError.cause = new Error(staffSecret);
  const assignmentError = new SuperadminAssignmentError(
    500,
    assignmentSecret,
    'INTERNAL_ASSIGNMENT_CODE',
  );
  assignmentError.cause = new Error(assignmentSecret);
  const unknownError = new Error(unknownSecret);
  unknownError.status = 503;
  unknownError.code = 'INTERNAL_DRIVER_CODE';

  const logged = [];
  const originalError = console.error;
  console.error = (...parts) => logged.push(parts);
  t.after(() => {
    console.error = originalError;
  });

  const request = await requester(t, testApp({
    assignmentWorkflow: {
      async assignPortfolio() {
        throw assignmentError;
      },
      async unassignPortfolio() {
        throw unknownError;
      },
    },
    provisioningWorkflow: {
      async createStaffAccount() {
        throw staffError;
      },
    },
  }));

  const staff = await request('POST', '/api/superadmin/staff', {
    body: {
      name: 'Avery Admin',
      email: 'avery@example.test',
      password: 'secret1',
      role: 'admin',
    },
  });
  const assigned = await request(
    'PUT',
    '/api/superadmin/portfolios/20/assignment',
    { body: { relationship_manager_id: 8 } },
  );
  const unassigned = await request(
    'DELETE',
    '/api/superadmin/portfolios/20/assignment',
  );

  for (const result of [staff, assigned, unassigned]) {
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.payload, { error: 'Server error' });
  }
  const responseText = inspect([
    staff.payload,
    assigned.payload,
    unassigned.payload,
  ]);
  assert.doesNotMatch(
    responseText,
    /staff credential|assignment credential|driver credential|INTERNAL_/,
  );
  assert.doesNotMatch(
    inspect(logged, { depth: 8 }),
    /staff-secret|assignment-secret|driver-secret/,
  );
});

test('unexpected failures return a generic 500 without internal details', {
  concurrency: false,
}, async (t) => {
  const secret = 'database password leaked in query error';
  const readError = new Error(secret);
  readError.sql = `SELECT * FROM users WHERE password='${secret}'`;
  readError.cause = new Error(`database cause: ${secret}`);
  const errors = [];
  const originalError = console.error;
  console.error = (...parts) => errors.push(parts);
  t.after(() => {
    console.error = originalError;
  });
  const readModel = {
    async loadSuperadminStats() {
      throw readError;
    },
  };
  const request = await requester(t, testApp({ readModel }));

  const result = await request('GET', '/api/superadmin/stats');

  assert.equal(result.response.status, 500);
  assert.deepEqual(result.payload, { error: 'Server error' });
  assert.doesNotMatch(JSON.stringify(result.payload), new RegExp(secret));
  assert.deepEqual(errors, [['Superadmin read failed']]);
  assert.doesNotMatch(inspect(errors, { depth: 8 }), /password|SELECT|cause/i);
});
