const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  superadminDashboardHarness,
  deferred,
  flush,
} = require('./helpers/superadmin-dashboard-harness');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('dashboard verifies superadmin before any data request', async () => {
  const page = superadminDashboardHarness({ authenticatedRole: 'admin' });
  await page.initialize();
  assert.deepEqual(page.calls, ['getCurrentUser']);
  assert.equal(page.location.href, 'moderatordashboard.html');
  assert.equal(page.element('superadmin-main').hidden, true);
});

test('dashboard keeps its protected shell hidden until authorization resolves', async () => {
  const auth = deferred();
  const page = superadminDashboardHarness({
    getCurrentUser: () => auth.promise,
  });
  const initialization = page.initialize();
  await flush();
  assert.equal(page.element('superadmin-main').hidden, true);
  assert.equal(page.element('protected-nav').hidden, true);
  assert.deepEqual(page.calls, ['getCurrentUser']);
  auth.resolve({
    id: 1,
    name: 'Sonia',
    role: 'superadmin',
  });
  await initialization;
  assert.equal(page.element('superadmin-main').hidden, false);
  assert.equal(page.element('protected-nav').hidden, false);
});

test('transient authorization recovery reveals only the recovery main', async () => {
  const page = superadminDashboardHarness({
    getCurrentUser: async () => {
      throw new Error('network unavailable');
    },
  });
  await page.initialize();
  assert.deepEqual(page.calls, ['getCurrentUser']);
  assert.equal(page.element('protected-nav').hidden, true);
  assert.equal(page.element('superadmin-main').hidden, false);
  assert.equal(page.element('protected-page-recovery').hidden, false);
  assert.equal(
    page.element('protected-page-recovery').parentElement,
    page.element('superadmin-main'),
  );
});

test('dashboard loaders fail and retry independently', async () => {
  let statsAttempts = 0;
  const page = superadminDashboardHarness({
    getSuperadminStats: async () => {
      statsAttempts += 1;
      if (statsAttempts === 1) throw new Error('stats unavailable');
      return {
        business_owners: 1,
        investors: 2,
        admins: 3,
        relationship_managers: 4,
        approved_portfolios: 5,
        unassigned_portfolios: 1,
        assigned_portfolios: 4,
        rm_workload: [],
      };
    },
  });
  await page.initialize();
  assert.deepEqual(page.calls, [
    'getCurrentUser',
    'getSuperadminStats',
    'getStaff',
    'getSuperadminAuditLogs',
  ]);
  assert.equal(page.element('stats-retry').hidden, false);
  assert.equal(page.element('staff-retry').hidden, true);
  assert.equal(page.element('audit-retry').hidden, true);

  await page.element('stats-retry').dispatch('click');
  assert.equal(statsAttempts, 2);
  assert.equal(page.methodCalls.getStaff.length, 1);
  assert.equal(page.methodCalls.getSuperadminAuditLogs.length, 1);
  assert.equal(page.element('stats-retry').hidden, true);
});

test('dashboard escapes database strings in workload, staff, and audit output', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const page = superadminDashboardHarness({
    getSuperadminStats: {
      business_owners: 1,
      investors: 1,
      admins: 1,
      relationship_managers: 1,
      approved_portfolios: 1,
      unassigned_portfolios: 0,
      assigned_portfolios: 1,
      rm_workload: [{
        id: 7,
        name: hostile,
        email: `${hostile}@example.test`,
        assigned_portfolios: 1,
        active_rooms: 1,
      }],
    },
    getStaff: [{
      id: 8,
      name: hostile,
      email: `${hostile}@example.test`,
      role: 'admin',
      created_at: '2026-07-27T10:00:00Z',
    }],
    getSuperadminAuditLogs: {
      items: [{
        id: '1',
        action: 'admin_account_created',
        superadmin_name_snapshot: hostile,
        created_user_name_snapshot: hostile,
        created_user_role: 'admin',
        created_at: '2026-07-27T10:00:00Z',
      }],
      pagination: { page: 1, limit: 50, total: 1, total_pages: 1 },
    },
  });
  await page.initialize();
  for (const id of ['manager-workload-body', 'staff-directory-body', 'audit-body']) {
    assert.doesNotMatch(page.element(id).innerHTML, /<img/i);
    assert.match(page.element(id).innerHTML, /&lt;img/);
  }
});

test('staff form exposes only admin and relationship-manager roles and DB limits', () => {
  const html = read('superadmindashboard.html');
  assert.match(html, /<body class=["'][^"']*\bprotected-page\b/);
  assert.match(html, /id=["']superadmin-main["'][^>]*\bhidden\b/);
  assert.match(
    html,
    /id=["']staff-name["'][^>]*maxlength=["']100["'][^>]*required[^>]*aria-describedby=["']staff-name-error["']/,
  );
  assert.match(
    html,
    /id=["']staff-email["'][^>]*maxlength=["']255["'][^>]*required[^>]*aria-describedby=["']staff-email-error["']/,
  );
  assert.match(
    html,
    /id=["']staff-password["'][^>]*minlength=["']6["'][^>]*maxlength=["']128["'][^>]*required[^>]*aria-describedby=["']staff-password-help staff-password-error["']/,
  );
  assert.match(
    html,
    /id=["']staff-password-help["'][^>]*>Use 6–128 characters\./,
  );
  const roleSelect = html.match(
    /<select[^>]*id=["']staff-role["'][^>]*>([\s\S]*?)<\/select>/,
  );
  assert.ok(roleSelect);
  assert.match(
    roleSelect[0],
    /aria-describedby=["']staff-role-error["']/,
  );
  assert.match(roleSelect[1], /value=["']admin["']/);
  assert.match(roleSelect[1], /value=["']relationship_manager["']/);
  assert.doesNotMatch(roleSelect[1], /value=["']superadmin["']/);
});

test('invalid staff role is blocked locally without a request', async () => {
  const page = superadminDashboardHarness();
  await page.initialize();
  page.element('staff-name').value = 'Future Staff';
  page.element('staff-email').value = 'future@example.test';
  page.element('staff-password').value = 'secret1';
  page.element('staff-role').value = 'superadmin';
  await page.submitStaff();
  assert.equal(page.methodCalls.createStaff.length, 0);
  assert.match(page.element('staff-role-error').textContent, /admin|relationship/i);
});

test('staff failure preserves every field and permits a later retry', async () => {
  let attempts = 0;
  const page = superadminDashboardHarness({
    createStaff: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Email already registered');
      return {};
    },
  });
  await page.initialize();
  const values = {
    'staff-name': 'Future Staff',
    'staff-email': 'future@example.test',
    'staff-password': 'secret1',
    'staff-role': 'admin',
  };
  for (const [id, value] of Object.entries(values)) page.element(id).value = value;

  await page.submitStaff();
  for (const [id, value] of Object.entries(values)) {
    assert.equal(page.element(id).value, value, id);
  }
  assert.equal(page.element('staff-submit').disabled, false);
  assert.match(page.element('staff-form-status').textContent, /email already/i);

  await page.submitStaff();
  assert.equal(page.element('staff-password').value, '');
  assert.equal(page.element('staff-name').value, values['staff-name']);
  assert.equal(page.element('staff-email').value, values['staff-email']);
  assert.equal(page.methodCalls.createStaff.length, 2);
});

test('staff submission is single-flight and refreshes only relevant data', async () => {
  const create = deferred();
  const page = superadminDashboardHarness({
    createStaff: () => create.promise,
  });
  await page.initialize();
  page.element('staff-name').value = 'Future Manager';
  page.element('staff-email').value = 'manager@example.test';
  page.element('staff-password').value = 'secret1';
  page.element('staff-role').value = 'relationship_manager';

  const first = page.submitStaff();
  const second = page.submitStaff();
  await flush();
  assert.equal(page.methodCalls.createStaff.length, 1);
  assert.equal(page.element('staff-submit').disabled, true);
  create.resolve({});
  await Promise.all([first, second]);
  assert.equal(page.methodCalls.getSuperadminStats.length, 2);
  assert.equal(page.methodCalls.getStaff.length, 2);
  assert.equal(page.methodCalls.getSuperadminAuditLogs.length, 2);
  assert.equal(page.element('staff-password').value, '');
});

test('staff success queues fresh section reads behind busy initial reads', async () => {
  const stats = deferred();
  const staff = deferred();
  const audit = deferred();
  let statsCalls = 0;
  let staffCalls = 0;
  let auditCalls = 0;
  const page = superadminDashboardHarness({
    getSuperadminStats: async () => {
      statsCalls += 1;
      if (statsCalls === 1) return stats.promise;
      return {
        business_owners: 1,
        investors: 1,
        admins: 2,
        relationship_managers: 1,
        approved_portfolios: 1,
        assigned_portfolios: 1,
        unassigned_portfolios: 0,
        rm_workload: [],
      };
    },
    getStaff: async () => {
      staffCalls += 1;
      if (staffCalls === 1) return staff.promise;
      return [];
    },
    getSuperadminAuditLogs: async (page, limit) => {
      auditCalls += 1;
      if (auditCalls === 1) return audit.promise;
      return {
        items: [],
        pagination: { page, limit, total: 0, total_pages: 0 },
      };
    },
  });
  const initialization = page.initialize();
  await flush();
  page.element('staff-name').value = 'Fresh Admin';
  page.element('staff-email').value = 'fresh@example.test';
  page.element('staff-password').value = 'secret1';
  page.element('staff-role').value = 'admin';
  const submission = page.submitStaff();
  await flush();
  stats.resolve({
    business_owners: 1,
    investors: 1,
    admins: 1,
    relationship_managers: 1,
    approved_portfolios: 1,
    assigned_portfolios: 1,
    unassigned_portfolios: 0,
    rm_workload: [],
  });
  staff.resolve([]);
  audit.resolve({
    items: [],
    pagination: { page: 1, limit: 50, total: 0, total_pages: 0 },
  });
  await Promise.all([initialization, submission]);
  assert.equal(page.methodCalls.getSuperadminStats.length, 2);
  assert.equal(page.methodCalls.getStaff.length, 2);
  assert.equal(page.methodCalls.getSuperadminAuditLogs.length, 2);
});

test('audit controls paginate without reloading other sections', async () => {
  const page = superadminDashboardHarness({
    getSuperadminAuditLogs: async (page, limit) => ({
      items: [],
      pagination: { page, limit, total: 120, total_pages: 3 },
    }),
  });
  await page.initialize();
  await page.element('audit-next').dispatch('click');
  assert.deepEqual(page.methodCalls.getSuperadminAuditLogs, [[1, 50], [2, 50]]);
  assert.equal(page.methodCalls.getSuperadminStats.length, 1);
  assert.equal(page.methodCalls.getStaff.length, 1);
  assert.equal(page.element('audit-page').textContent, 'Page 2 of 3');
});

test('audit Retry repeats the failed requested page, not the last successful page', async () => {
  let pageTwoAttempts = 0;
  const page = superadminDashboardHarness({
    getSuperadminAuditLogs: async (requestedPage, limit) => {
      if (requestedPage === 2) {
        pageTwoAttempts += 1;
        if (pageTwoAttempts === 1) throw new Error('page two unavailable');
      }
      return {
        items: [],
        pagination: {
          page: requestedPage,
          limit,
          total: 120,
          total_pages: 3,
        },
      };
    },
  });
  await page.initialize();
  await page.element('audit-next').dispatch('click');
  assert.equal(page.element('audit-retry').hidden, false);
  await page.element('audit-retry').dispatch('click');
  assert.deepEqual(
    page.methodCalls.getSuperadminAuditLogs,
    [[1, 50], [2, 50], [2, 50]],
  );
  assert.equal(page.element('audit-page').textContent, 'Page 2 of 3');
});

test('dashboard assets and stable accessible regions are synchronized', () => {
  const html = read('superadmindashboard.html');
  assert.match(
    html,
    /https:\/\/cdn\.jsdelivr\.net\/npm\/@tabler\/icons-webfont@3\.0\.0\/dist\/tabler-icons\.min\.css/,
  );
  for (const asset of [
    'css/style.css?v=20260728.4',
    'js/api.js?v=20260728.4',
    'js/superadmindashboard.js?v=20260728.4',
  ]) assert.match(html, new RegExp(escapeRegex(asset)));
  for (const id of [
    'superadmin-stats',
    'manager-workload',
    'staff-form',
    'staff-directory',
    'superadmin-audit',
    'stats-retry',
    'staff-retry',
    'audit-retry',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`), id);
  assert.match(html, /href=["']assignments\.html["']/);
  assert.match(html, /signout/i);
});
