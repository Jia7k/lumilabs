const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(
  path.join(root, 'js', 'superadmindashboard.js'),
  'utf8',
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  constructor(id, ownerDocument) {
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.classList = new FakeClassList();
    this.className = '';
    this.dataset = {};
    this.hidden = id === 'superadmin-main';
    this.disabled = false;
    this.innerHTML = '';
    this.innerText = '';
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  async dispatch(type, overrides = {}) {
    if (type === 'click' && (this.disabled || this.hidden)) return;
    const event = {
      type,
      target: overrides.target || this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      ...overrides,
    };
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  contains(element) {
    return this === element || this.children.includes(element);
  }
}

function asAsync(value, fallback) {
  if (typeof value === 'function') return value;
  if (value !== undefined) return async () => value;
  return fallback;
}

function superadminDashboardHarness(overrides = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    listeners: new Map(),
    body: null,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id, document));
      return elements.get(id);
    },
    addEventListener(type, handler) {
      const list = this.listeners.get(type) || [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    async dispatch(type, event = {}) {
      for (const handler of this.listeners.get(type) || []) await handler(event);
    },
  };
  document.body = document.getElementById('body');

  const calls = [];
  const methodCalls = Object.fromEntries([
    'getCurrentUser',
    'getSuperadminStats',
    'getStaff',
    'createStaff',
    'getSuperadminAuditLogs',
  ].map((name) => [name, []]));

  const authenticatedRole = overrides.authenticatedRole || 'superadmin';
  const defaults = {
    getCurrentUser: async () => ({
      id: 1,
      name: 'Sonia Superadmin',
      email: 'sonia@example.test',
      role: authenticatedRole,
    }),
    getSuperadminStats: async () => ({
      business_owners: 4,
      investors: 8,
      admins: 2,
      relationship_managers: 3,
      approved_portfolios: 5,
      unassigned_portfolios: 1,
      assigned_portfolios: 4,
      rm_workload: [{
        id: 7,
        name: 'Rita Manager',
        email: 'rita@example.test',
        assigned_portfolios: 2,
        active_rooms: 1,
      }],
    }),
    getStaff: async () => [{
      id: 2,
      name: 'Ari Admin',
      email: 'ari@example.test',
      role: 'admin',
      created_at: '2026-07-20T10:00:00.000Z',
    }],
    createStaff: async () => ({
      id: 10,
      name: 'New Admin',
      email: 'new@example.test',
      role: 'admin',
      created_at: '2026-07-27T10:00:00.000Z',
    }),
    getSuperadminAuditLogs: async (page = 1, limit = 50) => ({
      items: [{
        id: '9007199254740993',
        action: 'admin_account_created',
        superadmin_name_snapshot: 'Sonia Superadmin',
        created_user_name_snapshot: 'Ari Admin',
        created_user_role: 'admin',
        created_at: '2026-07-27T10:00:00.000Z',
      }],
      pagination: {
        page,
        limit,
        total: 1,
        total_pages: 1,
      },
    }),
  };

  const api = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    const implementation = asAsync(overrides[name], fallback);
    api[name] = async (...args) => {
      calls.push(name);
      methodCalls[name].push(args);
      return implementation(...args);
    };
  }

  const roleDashboards = {
    business_owner: 'businessownerdashboard.html',
    investor: 'investordashboard.html',
    relationship_manager: 'relationshipmanagerdashboard.html',
    admin: 'moderatordashboard.html',
    superadmin: 'superadmindashboard.html',
  };
  const location = { href: '' };
  const requirePageRole = async (requiredRole) => {
    const user = await api.getCurrentUser();
    if (user.role !== requiredRole) {
      location.href = roleDashboards[user.role] || 'index.html';
      return null;
    }
    return user;
  };

  const sandbox = {
    API: api,
    document,
    window: { location },
    requirePageRole,
    signOut() {},
    alert() {},
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const withoutAutoInit = source
    .replace(/\ninitSuperadmin\(\);\s*$/, '')
    .replace(/\ninitializeSuperadminDashboard\(\);\s*$/, '');
  vm.runInContext(
    `${withoutAutoInit}
globalThis.__dashboardClient = {
  initialize: typeof initializeSuperadminDashboard === "function"
    ? initializeSuperadminDashboard
    : initSuperadmin,
  loadStats: typeof loadStatsAndWorkload === "function"
    ? loadStatsAndWorkload
    : renderSuperadmin,
  loadStaff: typeof loadStaffDirectory === "function"
    ? loadStaffDirectory
    : async function () {},
  loadAudit: typeof loadAuditPage === "function"
    ? loadAuditPage
    : async function () {},
  submitStaff: typeof submitStaffAccount === "function"
    ? submitStaffAccount
    : async function () {},
};`,
    context,
    { filename: 'js/superadmindashboard.js' },
  );

  return {
    api,
    calls,
    methodCalls,
    context,
    document,
    location,
    element: (id) => document.getElementById(id),
    initialize: () => context.__dashboardClient.initialize(),
    loadStats: () => context.__dashboardClient.loadStats(),
    loadStaff: () => context.__dashboardClient.loadStaff(),
    loadAudit: (page) => context.__dashboardClient.loadAudit(page),
    submitStaff: () => context.__dashboardClient.submitStaff({
      preventDefault() {},
    }),
    run: (code) => vm.runInContext(code, context),
  };
}

module.exports = {
  superadminDashboardHarness,
  deferred,
  flush,
};
