const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'assignments.js'), 'utf8');

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
    this.hidden = id === 'assignments-main'
      || id.endsWith('-dialog')
      || id === 'assignment-retry';
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

  closest(selector) {
    if (
      selector === '[data-assignment-action]'
      && this.dataset.assignmentAction != null
    ) return this;
    return null;
  }
}

function apiError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asAsync(value, fallback) {
  if (typeof value === 'function') return value;
  if (value !== undefined) return async () => value;
  return fallback;
}

function assignmentsHarness(overrides = {}) {
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

  const defaultAssignments = [{
    id: 20,
    name: 'Northstar Foods',
    status: 'approved',
    owner: {
      id: 4,
      name: 'Charlie Owner',
      email: 'charlie@example.test',
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
  }];
  const defaultManagers = [{
    id: 7,
    name: 'Rita Manager',
    email: 'rita@example.test',
    role: 'relationship_manager',
  }];

  const calls = [];
  const methodCalls = Object.fromEntries([
    'getCurrentUser',
    'getPortfolioAssignments',
    'getAssignableRelationshipManagers',
    'assignPortfolioManager',
    'unassignPortfolioManager',
  ].map((name) => [name, []]));

  const authenticatedRole = overrides.authenticatedRole || 'superadmin';
  let mutationStatus = overrides.mutationStatus || null;
  const defaults = {
    getCurrentUser: async () => ({
      id: 1,
      name: 'Sonia Superadmin',
      role: authenticatedRole,
    }),
    getPortfolioAssignments: async () => defaultAssignments,
    getAssignableRelationshipManagers: async () => defaultManagers,
    assignPortfolioManager: async () => {
      if (mutationStatus) {
        throw apiError(
          overrides.mutationMessage
            || 'Assignment changed since this page was loaded. Refresh and try again.',
          mutationStatus,
        );
      }
      return {};
    },
    unassignPortfolioManager: async () => {
      if (mutationStatus) {
        throw apiError(
          overrides.mutationMessage
            || 'Assignment changed since this page was loaded. Refresh and try again.',
          mutationStatus,
        );
      }
      return {};
    },
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
    .replace(/\ninitAssignments\(\);\s*$/, '')
    .replace(/\ninitializeAssignments\(\);\s*$/, '');
  vm.runInContext(
    `${withoutAutoInit}
globalThis.__assignmentsClient = {
  initialize: typeof initializeAssignments === "function"
    ? initializeAssignments
    : initAssignments,
  load: typeof loadAssignments === "function"
    ? loadAssignments
    : renderAssignments,
  open: typeof openAssignmentDialog === "function"
    ? openAssignmentDialog
    : openAssignModal,
  submit: typeof submitAssignment === "function"
    ? submitAssignment
    : async function () {},
  confirmUnassign: typeof openUnassignDialog === "function"
    ? openUnassignDialog
    : async function () {},
  submitUnassign: typeof submitUnassignment === "function"
    ? submitUnassignment
    : async function () {},
};`,
    context,
    { filename: 'js/assignments.js' },
  );

  return {
    api,
    calls,
    methodCalls,
    context,
    document,
    location,
    element: (id) => document.getElementById(id),
    initialize: () => context.__assignmentsClient.initialize(),
    load: () => context.__assignmentsClient.load(),
    openAssignment: (portfolioId) => context.__assignmentsClient.open(portfolioId),
    submitManager: (managerId) => {
      document.getElementById('assignment-manager').value = String(managerId);
      return context.__assignmentsClient.submit({ preventDefault() {} });
    },
    openUnassignment: (portfolioId) => (
      context.__assignmentsClient.confirmUnassign(portfolioId)
    ),
    submitUnassignment: () => context.__assignmentsClient.submitUnassign({
      preventDefault() {},
    }),
    setMutationStatus: (status) => {
      mutationStatus = status;
    },
    run: (code) => vm.runInContext(code, context),
  };
}

module.exports = {
  assignmentsHarness,
  deferred,
  flush,
  apiError,
};
