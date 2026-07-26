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
      || id === 'protected-nav'
      || id.endsWith('-dialog')
      || id.endsWith('-retry');
    this.disabled = false;
    this._innerHTML = '';
    this.innerText = '';
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    this.parentElement = null;
    this.isConnected = true;
    this.inert = false;
    this.renderedActions = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (this.id !== 'assignment-rows') return;
    this.renderedActions.forEach((action) => {
      action.isConnected = false;
      action.parentElement = null;
    });
    this.renderedActions = [
      ...this._innerHTML.matchAll(
        /<button\b([\s\S]*?)data-assignment-action="([^"]+)"([\s\S]*?)data-portfolio-id="([^"]+)"([\s\S]*?)>/g,
      ),
    ].map((match, index) => {
      const action = new FakeElement(
        `generated-assignment-action-${index}`,
        this.ownerDocument,
      );
      action.dataset.assignmentAction = match[2];
      action.dataset.portfolioId = match[4];
      action.disabled = /\bdisabled\b/.test(`${match[1]}${match[3]}${match[5]}`);
      action.parentElement = this;
      return action;
    });
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
    return this === element
      || this.children.includes(element)
      || this.renderedActions.includes(element);
  }

  closest(selector) {
    if (
      selector === '[data-assignment-action]'
      && this.dataset.assignmentAction != null
    ) return this;
    return null;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => {
      child.parentElement = null;
      child.isConnected = false;
    });
    this.children = children;
    children.forEach((child) => {
      child.parentElement = this;
      child.isConnected = true;
    });
  }

  querySelectorAll() {
    const ids = this.id === 'assignment-dialog'
      ? [
        'assignment-manager',
        'assignment-dialog-retry',
        'assignment-cancel',
        'assignment-submit',
      ]
      : this.id === 'unassign-dialog'
        ? ['unassign-dialog-retry', 'unassign-cancel', 'unassign-submit']
        : [];
    return ids
      .map((id) => this.ownerDocument.getElementById(id))
      .filter((element) => !element.disabled && !element.hidden);
  }

  querySelector(selector) {
    if (selector !== '[role="document"][tabindex="-1"]') return null;
    const cardId = this.id === 'assignment-dialog'
      ? 'assignment-dialog-card'
      : this.id === 'unassign-dialog'
        ? 'unassign-dialog-card'
        : null;
    return cardId ? this.ownerDocument.getElementById(cardId) : null;
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
      if (id === 'protected-page-recovery' && !elements.has(id)) return null;
      if (!elements.has(id)) elements.set(id, new FakeElement(id, document));
      return elements.get(id);
    },
    querySelector(selector) {
      if (selector === 'main') return this.getElementById('assignments-main');
      const actionMatch = selector.match(
        /^\[data-assignment-action="([^"]+)"\]\[data-portfolio-id="([^"]+)"\]$/,
      );
      if (actionMatch) {
        return this.getElementById('assignment-rows').renderedActions.find(
          (element) => (
            element.dataset.assignmentAction === actionMatch[1]
            && element.dataset.portfolioId === actionMatch[2]
          ),
        ) || null;
      }
      const portfolioActionMatch = selector.match(
        /^\[data-portfolio-id="([^"]+)"\]\[data-assignment-action\]$/,
      );
      if (!portfolioActionMatch) return null;
      return this.getElementById('assignment-rows').renderedActions.find(
        (element) => element.dataset.portfolioId === portfolioActionMatch[1],
      ) || null;
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
  document.getElementById('protected-skip-link');
  document.getElementById('protected-nav');
  document.getElementById('assignments-main');
  for (const id of ['assignment-dialog-card', 'unassign-dialog-card']) {
    document.getElementById(id).setAttribute('role', 'document');
    document.getElementById(id).setAttribute('tabindex', '-1');
  }

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
    try {
      const user = await api.getCurrentUser();
      if (user.role !== requiredRole) {
        location.href = roleDashboards[user.role] || 'index.html';
        return null;
      }
      return user;
    } catch {
      const recovery = new FakeElement('protected-page-recovery', document);
      elements.set('protected-page-recovery', recovery);
      recovery.hidden = false;
      recovery.setAttribute('role', 'alert');
      document.getElementById('assignments-main').replaceChildren(recovery);
      return null;
    }
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
  closeAssignment: typeof closeAssignmentDialog === "function"
    ? closeAssignmentDialog
    : async function () {},
  closeUnassign: typeof closeUnassignDialog === "function"
    ? closeUnassignDialog
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
    closeAssignment: () => context.__assignmentsClient.closeAssignment(),
    closeUnassignment: () => context.__assignmentsClient.closeUnassign(),
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
