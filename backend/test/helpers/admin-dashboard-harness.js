const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'moderatordashboard.js'), 'utf8');

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
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = '';
    this.innerText = '';
    this.textContent = '';
    this.value = '';
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
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
      preventDefault() {},
      ...overrides,
    };
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  closest(selector) {
    if (selector === '.form-group') return this.formGroup || this;
    if (selector === '[data-portfolio-id]' && this.dataset.portfolioId != null) return this;
    if (selector === '[data-review-action]' && this.dataset.reviewAction != null) return this;
    if (selector === '[data-document-download]' && this.dataset.documentDownload != null) return this;
    return null;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  contains(element) {
    return this === element || this.children.includes(element);
  }
}

function adminHarness(overrides = {}) {
  const elements = new Map();
  const document = {
    activeElement: null,
    listeners: new Map(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id, document));
      return elements.get(id);
    },
    addEventListener(type, handler) {
      const list = this.listeners.get(type) || [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    async dispatch(type, event) {
      for (const handler of this.listeners.get(type) || []) await handler(event);
    },
  };

  const calls = Object.fromEntries([
    'getStats',
    'getQueue',
    'getRelationshipManagers',
    'createRelationshipManager',
    'getPortfolio',
    'approvePortfolio',
    'rejectPortfolio',
    'downloadDocument',
  ].map((name) => [name, []]));

  const defaults = {
    getStats: async () => ({ pending: 1, approved: 2, rejected: 0, total_matches: 3 }),
    getQueue: async () => [{
      id: 42,
      name: 'New Company',
      owner_name: 'Owner',
      sector: 'Technology',
      submitted_at: '2026-07-23T00:00:00.000Z',
      readiness_score: 60,
      monthly_revenue: null,
      user_count: null,
      growth_rate: null,
      market_size: null,
      competitor_analysis: null,
      advisor_names: null,
      burn_rate: null,
      runway_months: null,
    }],
    getRelationshipManagers: async () => [],
    createRelationshipManager: async () => ({ id: 8 }),
    getPortfolio: async (id) => ({
      id,
      name: 'New Company',
      sector: 'Technology',
      mvp_status: 'Beta',
      funding_goal: 100000,
      readiness_score: 60,
      documents: [],
    }),
    approvePortfolio: async () => ({}),
    rejectPortfolio: async () => ({}),
    downloadDocument: async () => {},
  };

  const api = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    api[name] = async (...args) => {
      calls[name].push(args);
      return (overrides[name] || fallback)(...args);
    };
  }

  const sandbox = {
    API: api,
    document,
    window: { location: { href: '' } },
    requirePageRole: async () => ({ id: 1, name: 'Victor', role: 'admin' }),
    showScoreInfo() {},
    signOut() {},
    alert() {},
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const instrumented = source.replace(
    /\ninitAdmin\(\);\s*$/,
    '\nglobalThis.__adminInitPromise = initAdmin();',
  );
  vm.runInContext(instrumented, context, { filename: 'js/moderatordashboard.js' });

  return {
    api,
    calls,
    context,
    document,
    element: (id) => document.getElementById(id),
    init: () => context.__adminInitPromise,
    run: (code) => vm.runInContext(code, context),
  };
}

module.exports = { adminHarness, deferred, flush };
