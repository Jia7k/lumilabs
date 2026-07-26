const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const htmlPath = path.join(root, 'relationshipmanagerdashboard.html');
const clientPath = path.join(root, 'js', 'relationshipmanagerdashboard.js');
const cssPath = path.join(root, 'css', 'style.css');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const clientSource = fs.readFileSync(clientPath, 'utf8');

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function portfolio(overrides = {}) {
  return {
    id: 20,
    name: 'Northstar Health',
    status: 'approved',
    sector: 'Healthtech',
    description: 'Care coordination for neighbourhood clinics.',
    mvp_status: 'Beta',
    funding_goal: '250000.00',
    readiness_score: 82,
    team_size: 5,
    founded_year: 2024,
    location: 'Singapore',
    website: 'https://northstar.example',
    advisor_names: 'Dr Tan',
    monthly_revenue: '12000.00',
    user_count: 450,
    growth_rate: '12.50',
    market_size: 'Regional clinics',
    competitor_analysis: 'Focused on small practices',
    burn_rate: '18000.00',
    runway_months: 14,
    created_at: '2026-06-01T00:00:00.000Z',
    submitted_at: '2026-07-20T00:00:00.000Z',
    owner: {
      id: 9,
      name: 'Olivia Owner',
      email: 'olivia@example.test',
    },
    conversation: null,
    interests: [],
    participants: [],
    documents: [{
      id: 51,
      file_name: 'northstar-deck.pdf',
      file_type: 'pitch_deck',
      uploaded_at: '2026-07-21T00:00:00.000Z',
      download_url: '/api/portfolios/20/documents/51/download',
    }],
    actions: {
      can_create_conversation: false,
      create_disabled_reason: 'Create chat becomes available after an investor expresses interest',
      can_add_investors: false,
      add_disabled_reason: 'Create the portfolio chat first',
    },
    ...overrides,
  };
}

function dashboard(portfolios) {
  return {
    stats: {
      assigned_portfolios: portfolios.length,
      approved_portfolios: portfolios.filter((item) => item.status === 'approved').length,
      eligible_interests: portfolios.reduce(
        (total, item) => total + item.interests.filter((interest) => !interest.is_active_member).length,
        0,
      ),
      active_rooms: portfolios.filter(
        (item) => item.conversation?.status === 'active',
      ).length,
      unread_messages: portfolios.reduce(
        (total, item) => total + (item.conversation?.unread_count || 0),
        0,
      ),
    },
    portfolios,
  };
}

const assignedNoInterestResponse = dashboard([portfolio()]);

const activeRoomResponse = dashboard([portfolio({
  conversation: {
    id: 40,
    title: 'Northstar investor room',
    status: 'active',
    archived_reason: null,
    unread_count: 3,
  },
  interests: [{
    interest_id: 60,
    investor: {
      id: 11,
      name: 'Ian Investor',
      email: 'ian@example.test',
    },
    is_active_member: true,
  }],
  participants: [
    {
      id: 7,
      name: 'Rita Manager',
      email: 'rita@example.test',
      role: 'relationship_manager',
      joined_at: '2026-07-22T00:00:00.000Z',
    },
    {
      id: 9,
      name: 'Olivia Owner',
      email: 'olivia@example.test',
      role: 'business_owner',
      joined_at: '2026-07-22T00:00:00.000Z',
    },
    {
      id: 11,
      name: 'Ian Investor',
      email: 'ian@example.test',
      role: 'investor',
      joined_at: '2026-07-22T00:00:00.000Z',
    },
  ],
  actions: {
    can_create_conversation: false,
    create_disabled_reason: 'This portfolio already has its group chat',
    can_add_investors: false,
    add_disabled_reason: 'No additional interested investors are available',
  },
})]);

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
    this.disabled = false;
    this.hidden = false;
    this.innerHTML = '';
    this.innerText = '';
    this.textContent = '';
    this.value = '';
    this.focusableChildren = [];
    this.listeners = new Map();
    this.attributes = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatch(type, overrides = {}) {
    if (type === 'click' && (this.disabled || this.hidden)) return false;
    const event = {
      type,
      target: overrides.target || this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      ...overrides,
    };
    for (const handler of this.listeners.get(type) || []) await handler(event);
    return true;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  closest(selector) {
    if (selector === 'button[data-action]' && this.dataset.action) return this;
    if (selector === 'input[data-selection]' && this.dataset.selection) return this;
    return null;
  }

  querySelectorAll() {
    return this.focusableChildren;
  }

  contains(element) {
    return this === element || this.focusableChildren.includes(element);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

function decodeHtml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&amp;', '&');
}

function textFromHtml(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function buttonFromHtml(cardHtml, action) {
  const tag = [...cardHtml.matchAll(/<button\b[^>]*>/g)]
    .map((match) => match[0])
    .find((candidate) => new RegExp(`data-action=["']${action}["']`).test(candidate));
  if (!tag) return null;
  return {
    disabled: /\sdisabled(?:\s|>|=)/.test(tag),
    html: tag,
  };
}

function relationshipManagerHarness(response, overrides = {}) {
  const elements = new Map();
  let checkedInputs = [];
  const document = {
    activeElement: null,
    listeners: new Map(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id, document));
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (!selector.includes(':checked')) return [];
      const selection = selector.match(/data-selection=["']?([^"'\]]+)/)?.[1];
      const portfolioId = selector.match(/data-portfolio-id=["']?([^"'\]]+)/)?.[1]
        || selector.match(/data-parent-id=["']?([^"'\]]+)/)?.[1];
      return checkedInputs.filter((input) => (
        (!selection || input.dataset.selection === selection)
        && (!portfolioId || input.dataset.portfolioId === portfolioId
          || input.dataset.parentId === portfolioId)
        && input.checked
      ));
    },
    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) || [];
      handlers.push(handler);
      this.listeners.set(type, handlers);
    },
    async dispatch(type, event = {}) {
      for (const handler of this.listeners.get(type) || []) await handler(event);
    },
  };

  const methodCalls = Object.fromEntries([
    'getRelationshipManagerDashboard',
    'getAssignedPortfolio',
    'createManagedConversation',
    'addManagedInvestors',
    'removeManagedInvestor',
    'downloadDocument',
  ].map((name) => [name, []]));
  let currentResponse = response;
  const defaultImplementations = {
    getRelationshipManagerDashboard: async () => clone(currentResponse),
    getAssignedPortfolio: async (portfolioId) => {
      const assigned = currentResponse.portfolios.find((item) => item.id === portfolioId);
      return clone(assigned);
    },
    createManagedConversation: async () => ({}),
    addManagedInvestors: async () => ({}),
    removeManagedInvestor: async () => ({}),
    downloadDocument: async () => {},
  };
  const api = {};
  for (const [name, fallback] of Object.entries(defaultImplementations)) {
    api[name] = async (...args) => {
      methodCalls[name].push(args);
      return (overrides[name] || fallback)(...args);
    };
  }

  const confirmations = [];
  const window = {
    location: { href: '' },
    confirm(message) {
      confirmations.push(message);
      return overrides.confirm === undefined ? true : overrides.confirm(message);
    },
  };
  const requirePageRole = overrides.requirePageRole || (async () => ({
    id: 7,
    name: 'Rita Manager',
    email: 'rita@example.test',
    role: 'relationship_manager',
  }));
  const context = vm.createContext({
    API: api,
    document,
    window,
    requirePageRole,
    signOut() {},
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(clientSource, context, {
    filename: 'js/relationshipmanagerdashboard.js',
  });

  function card(id) {
    const rendered = document.getElementById('portfolio-list').innerHTML;
    const match = rendered.match(new RegExp(
      `<article\\b[^>]*data-portfolio-card=["']${id}["'][^>]*>([\\s\\S]*?)<\\/article>`,
    ));
    const cardHtml = match?.[0] || '';
    return {
      html: cardHtml,
      textContent: textFromHtml(cardHtml),
      createButton: buttonFromHtml(cardHtml, 'create'),
      addButton: buttonFromHtml(cardHtml, 'add'),
    };
  }

  async function clickAction(action, dataset = {}) {
    const button = new FakeElement(`${action}-button`, document);
    button.dataset = { action, ...Object.fromEntries(
      Object.entries(dataset).map(([key, value]) => [key, String(value)]),
    ) };
    await document.getElementById('main-content').dispatch('click', { target: button });
  }

  return {
    api,
    card,
    confirmations,
    context,
    document,
    element: (id) => document.getElementById(id),
    methodCalls,
    source: clientSource,
    get dashboardLoads() {
      return methodCalls.getRelationshipManagerDashboard.length;
    },
    get removals() {
      return methodCalls.removeManagedInvestor.map(([conversationId, investorId]) => ({
        conversationId,
        investorId,
      }));
    },
    initialize: () => (
      typeof context.initRelationshipManagerDashboard === 'function'
        ? context.initRelationshipManagerDashboard()
        : false
    ),
    setResponse(nextResponse) {
      currentResponse = nextResponse;
    },
    selectInterests(kind, portfolioId, interestIds) {
      checkedInputs = interestIds.map((interestId) => ({
        checked: true,
        value: String(interestId),
        dataset: {
          selection: kind,
          portfolioId: String(portfolioId),
          parentId: String(portfolioId),
        },
      }));
      if (typeof context.syncSelectionFromDom === 'function') {
        context.syncSelectionFromDom(kind, String(portfolioId));
        context.renderDashboard();
      }
    },
    clickAction,
    openDetails: (portfolioId, trigger = null) => (
      typeof context.openPortfolioDetails === 'function'
        ? context.openPortfolioDetails(portfolioId, trigger)
        : false
    ),
    closeDetails: () => (
      typeof context.closePortfolioDetails === 'function'
        ? context.closePortfolioDetails()
        : false
    ),
    removeInvestor: ({ conversationId, investorId }) => (
      typeof context.removeInvestor === 'function'
        ? context.removeInvestor(conversationId, investorId)
        : false
    ),
    download: (portfolioId, documentId) => (
      typeof context.downloadPortfolioDocument === 'function'
        ? context.downloadPortfolioDocument(portfolioId, documentId)
        : false
    ),
    run: (code) => vm.runInContext(code, context),
  };
}

test('dashboard markup exposes one assigned workspace and an accessible detail dialog', () => {
  for (const id of [
    'stat-assigned', 'stat-approved', 'stat-eligible', 'stat-active', 'stat-unread',
    'dashboard-status', 'dashboard-retry', 'portfolio-list', 'portfolio-detail-overlay',
    'portfolio-detail-card', 'user-avatar', 'user-name', 'user-role',
  ]) {
    assert.match(htmlSource, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(htmlSource, /aria-live="polite"/);
  assert.match(htmlSource, /role="dialog"/);
  assert.match(htmlSource, /<main/);
  assert.doesNotMatch(htmlSource, /unclaimed-room-list|managed-room-list/);
});

test('role authorization completes before dashboard data loading', async () => {
  const role = deferred();
  const page = relationshipManagerHarness(assignedNoInterestResponse, {
    requirePageRole: async () => role.promise,
  });

  const initialization = page.initialize();
  await flush();
  assert.equal(page.dashboardLoads, 0);

  role.resolve({
    id: 7,
    name: 'Rita Manager',
    email: 'rita@example.test',
    role: 'relationship_manager',
  });
  await initialization;
  assert.equal(page.dashboardLoads, 1);
});

test('renders assigned no-interest portfolio with disabled explanation', async () => {
  const page = relationshipManagerHarness(assignedNoInterestResponse);
  await page.initialize();

  assert.match(page.card(20).textContent, /after an investor expresses interest/i);
  assert.equal(page.card(20).createButton.disabled, true);
  assert.match(page.card(20).textContent, /approved/i);
  assert.match(page.card(20).textContent, /chat not started/i);
});

test('renders every assigned status and trusts server-disabled action reasons', async () => {
  const statuses = ['approved', 'draft', 'pending', 'rejected'];
  const response = dashboard(statuses.map((status, index) => portfolio({
    id: 20 + index,
    name: `${status} portfolio`,
    status,
    interests: [{
      interest_id: 80 + index,
      investor: {
        id: 100 + index,
        name: `${status} investor`,
        email: `${status}@example.test`,
      },
      is_active_member: false,
    }],
    actions: {
      can_create_conversation: false,
      create_disabled_reason: `Server blocked ${status}`,
      can_add_investors: false,
      add_disabled_reason: 'Create the portfolio chat first',
    },
  })));
  const page = relationshipManagerHarness(response);
  await page.initialize();

  for (let index = 0; index < statuses.length; index += 1) {
    assert.match(page.card(20 + index).textContent, new RegExp(statuses[index], 'i'));
    assert.match(page.card(20 + index).textContent, new RegExp(`Server blocked ${statuses[index]}`));
    assert.equal(page.card(20 + index).createButton.disabled, true);
  }
});

test('unknown status labels cannot escape the fixed presentation class map', async () => {
  const page = relationshipManagerHarness(dashboard([
    portfolio({ status: 'constructor' }),
  ]));
  await page.initialize();

  assert.match(page.card(20).html, /rm-portfolio-card--unknown/);
  assert.doesNotMatch(page.card(20).html, /function Object/);
  assert.match(page.card(20).textContent, /Constructor/);
});

test('create submits multiple eligible interest_id values and never active members', async () => {
  const response = dashboard([portfolio({
    id: 30,
    interests: [
      {
        interest_id: 101,
        investor: { id: 21, name: 'One', email: 'one@example.test' },
        is_active_member: false,
      },
      {
        interest_id: 102,
        investor: { id: 22, name: 'Two', email: 'two@example.test' },
        is_active_member: false,
      },
      {
        interest_id: 103,
        investor: { id: 23, name: 'Already active', email: 'active@example.test' },
        is_active_member: true,
      },
    ],
    actions: {
      can_create_conversation: true,
      create_disabled_reason: null,
      can_add_investors: false,
      add_disabled_reason: 'Create the portfolio chat first',
    },
  })]);
  const page = relationshipManagerHarness(response);
  await page.initialize();
  assert.doesNotMatch(page.card(30).textContent, /Already active/);

  page.selectInterests('create', 30, [101, 102]);
  assert.equal(page.card(30).createButton.disabled, false);
  await page.clickAction('create', { portfolioId: 30 });

  assert.deepEqual(clone(page.methodCalls.createManagedConversation), [[30, [101, 102]]]);
  assert.equal(page.dashboardLoads, 2);
});

test('add submits multiple selected nonmember interests to the existing conversation', async () => {
  const response = dashboard([portfolio({
    id: 31,
    conversation: {
      id: 41,
      title: 'Growth room',
      status: 'active',
      archived_reason: null,
      unread_count: 0,
    },
    interests: [
      {
        interest_id: 111,
        investor: { id: 31, name: 'Three', email: 'three@example.test' },
        is_active_member: false,
      },
      {
        interest_id: 112,
        investor: { id: 32, name: 'Four', email: 'four@example.test' },
        is_active_member: false,
      },
      {
        interest_id: 113,
        investor: { id: 33, name: 'Current', email: 'current@example.test' },
        is_active_member: true,
      },
    ],
    participants: [{
      id: 33,
      name: 'Current',
      email: 'current@example.test',
      role: 'investor',
      joined_at: '2026-07-22T00:00:00.000Z',
    }],
    actions: {
      can_create_conversation: false,
      create_disabled_reason: 'This portfolio already has its group chat',
      can_add_investors: true,
      add_disabled_reason: null,
    },
  })]);
  const page = relationshipManagerHarness(response);
  await page.initialize();
  page.selectInterests('add', 31, [111, 112]);

  assert.equal(page.card(31).addButton.disabled, false);
  await page.clickAction('add', { portfolioId: 31 });
  assert.deepEqual(clone(page.methodCalls.addManagedInvestors), [[41, [111, 112]]]);
});

test('detail loads assigned data, escapes fields, and stays read-only', async () => {
  const unsafe = portfolio({
    name: '<img src=x onerror=alert(1)>',
    description: '<script>bad()</script>',
    owner: {
      id: 9,
      name: '<b>Owner</b>',
      email: 'owner@example.test',
    },
    documents: [{
      id: 51,
      file_name: '<deck>.pdf',
      file_type: 'pitch_deck',
      uploaded_at: '2026-07-21T00:00:00.000Z',
      download_url: '/api/portfolios/20/documents/51/download',
    }],
  });
  const page = relationshipManagerHarness(dashboard([unsafe]));
  await page.initialize();
  const trigger = new FakeElement('detail-trigger', page.document);

  await page.openDetails('20', trigger);

  assert.deepEqual(page.methodCalls.getAssignedPortfolio, [[20]]);
  assert.equal(page.document.activeElement, page.element('portfolio-detail-card'));
  const detail = page.element('portfolio-detail-card').innerHTML;
  assert.match(detail, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(detail, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(detail, /&lt;b&gt;Owner&lt;\/b&gt;/);
  assert.match(detail, /&lt;deck&gt;\.pdf/);
  assert.match(detail, /Monthly Revenue/);
  assert.doesNotMatch(detail, /<(?:input|textarea|select)\b/i);
  assert.doesNotMatch(detail, /href=["'][^"']*download/i);
});

test('document action uses trusted detail metadata without navigating an untrusted href', async () => {
  const page = relationshipManagerHarness(assignedNoInterestResponse);
  await page.initialize();
  await page.openDetails(20);
  await page.download(20, 51);

  assert.deepEqual(page.methodCalls.downloadDocument, [[
    '/api/portfolios/20/documents/51/download',
    'northstar-deck.pdf',
  ]]);
});

test('closing a pending detail ignores its late response and restores trigger focus', async () => {
  const detail = deferred();
  const page = relationshipManagerHarness(assignedNoInterestResponse, {
    getAssignedPortfolio: async () => detail.promise,
  });
  await page.initialize();
  const trigger = new FakeElement('detail-trigger', page.document);

  const opening = page.openDetails(20, trigger);
  await flush();
  assert.equal(page.document.activeElement, page.element('portfolio-detail-card'));
  page.closeDetails();
  detail.resolve(portfolio({ name: 'Late portfolio' }));
  await opening;

  assert.equal(page.element('portfolio-detail-overlay').classList.contains('open'), false);
  assert.doesNotMatch(page.element('portfolio-detail-card').innerHTML, /Late portfolio/);
  assert.equal(page.document.activeElement, trigger);
});

test('Escape closes the detail dialog and restores focus', async () => {
  const page = relationshipManagerHarness(assignedNoInterestResponse);
  await page.initialize();
  const trigger = new FakeElement('detail-trigger', page.document);
  await page.openDetails(20, trigger);

  await page.document.dispatch('keydown', { key: 'Escape' });

  assert.equal(page.element('portfolio-detail-overlay').classList.contains('open'), false);
  assert.equal(page.document.activeElement, trigger);
});

test('detail loading is closable, traps Tab focus, and isolates then restores the background', async () => {
  const detail = deferred();
  const page = relationshipManagerHarness(assignedNoInterestResponse, {
    getAssignedPortfolio: async () => detail.promise,
  });
  await page.initialize();
  const trigger = new FakeElement('detail-trigger', page.document);
  const opening = page.openDetails(20, trigger);
  await flush();

  assert.match(
    page.element('portfolio-detail-card').innerHTML,
    /data-action="close-detail"/,
  );
  assert.equal(page.element('main-content').inert, true);
  assert.equal(page.element('skip-link').inert, true);
  assert.equal(page.element('relationship-manager-nav').inert, true);

  const first = new FakeElement('first-focusable', page.document);
  const last = new FakeElement('last-focusable', page.document);
  page.element('portfolio-detail-card').focusableChildren = [first, last];
  let prevented = 0;

  first.focus();
  await page.document.dispatch('keydown', {
    key: 'Tab',
    shiftKey: true,
    preventDefault() {
      prevented += 1;
    },
  });
  assert.equal(page.document.activeElement, last);

  last.focus();
  await page.document.dispatch('keydown', {
    key: 'Tab',
    shiftKey: false,
    preventDefault() {
      prevented += 1;
    },
  });
  assert.equal(page.document.activeElement, first);
  assert.equal(prevented, 2);

  page.closeDetails();
  assert.equal(page.element('main-content').inert, false);
  assert.equal(page.element('skip-link').inert, false);
  assert.equal(page.element('relationship-manager-nav').inert, false);

  detail.resolve(portfolio());
  await opening;
});

test('removal confirmation calls one DELETE and refreshes', async () => {
  const page = relationshipManagerHarness(activeRoomResponse);
  await page.initialize();
  await page.removeInvestor({ conversationId: 40, investorId: 11 });

  assert.deepEqual(page.removals, [{ conversationId: 40, investorId: 11 }]);
  assert.equal(page.dashboardLoads, 2);
  assert.match(page.confirmations[0], /Ian Investor/);
  assert.match(page.confirmations[0], /Northstar Health/);
});

test('cancelled removal does not call DELETE or refresh', async () => {
  const page = relationshipManagerHarness(activeRoomResponse, {
    confirm: () => false,
  });
  await page.initialize();
  await page.removeInvestor({ conversationId: 40, investorId: 11 });

  assert.deepEqual(page.removals, []);
  assert.equal(page.dashboardLoads, 1);
});

test('removal is single-flight and disables mutation controls while pending', async () => {
  const removal = deferred();
  const page = relationshipManagerHarness(activeRoomResponse, {
    removeManagedInvestor: async () => removal.promise,
  });
  await page.initialize();

  const first = page.removeInvestor({ conversationId: 40, investorId: 11 });
  const second = page.removeInvestor({ conversationId: 40, investorId: 11 });
  await flush();

  assert.equal(page.removals.length, 1);
  assert.match(page.card(20).html, /data-action="remove"[\s\S]*disabled/);
  removal.resolve({});
  await Promise.all([first, second]);
  assert.equal(page.dashboardLoads, 2);
});

test('stale 409 refreshes dashboard data once without replaying DELETE', async () => {
  const conflict = new Error('Investor membership changed');
  conflict.status = 409;
  const page = relationshipManagerHarness(activeRoomResponse, {
    removeManagedInvestor: async () => {
      throw conflict;
    },
  });
  await page.initialize();
  await page.removeInvestor({ conversationId: 40, investorId: 11 });

  assert.deepEqual(page.removals, [{ conversationId: 40, investorId: 11 }]);
  assert.equal(page.dashboardLoads, 2);
  assert.match(page.element('dashboard-status').textContent, /refreshed/i);
});

test('unsafe IDs and non-investor participant roles never reach mutation APIs', async () => {
  const unsafeResponse = dashboard([portfolio({
    conversation: {
      id: '9007199254740992',
      title: 'Unsafe room',
      status: 'active',
      archived_reason: null,
      unread_count: 0,
    },
    participants: [{
      id: 11,
      name: 'Not an investor',
      email: 'person@example.test',
      role: 'investor" onclick="alert(1)',
      joined_at: '2026-07-22T00:00:00.000Z',
    }],
  })]);
  const page = relationshipManagerHarness(unsafeResponse);
  await page.initialize();
  await page.removeInvestor({
    conversationId: '9007199254740992',
    investorId: 11,
  });

  assert.deepEqual(page.removals, []);
  assert.doesNotMatch(page.card(20).html, /onclick=/);
});

test('ID normalization rejects coercible non-string and non-number values', () => {
  const page = relationshipManagerHarness(assignedNoInterestResponse);
  for (const candidate of [true, [20], { valueOf: () => 20 }]) {
    page.context.candidate = candidate;
    assert.equal(page.run('positiveSafeInteger(candidate)'), null);
  }
});

test('Open group chat emits the canonical conversation query parameter', async () => {
  const page = relationshipManagerHarness(activeRoomResponse);
  await page.initialize();

  assert.equal(page.run('openGroupChat(40)'), true);
  assert.equal(
    page.run('window.location.href'),
    'messages.html?conversation=40',
  );
});

test('manual archive and reopen controls are absent from source and rendered cards', async () => {
  const page = relationshipManagerHarness(activeRoomResponse);
  await page.initialize();

  assert.doesNotMatch(page.source, /archiveManagedConversation|reopenManagedConversation|reopenEligibility/);
  assert.doesNotMatch(page.card(20).html, /data-action=["'](?:archive|reopen)["']/);
});

test('failed refresh preserves one stale disabled assigned snapshot', async () => {
  let loads = 0;
  const page = relationshipManagerHarness(assignedNoInterestResponse, {
    getRelationshipManagerDashboard: async () => {
      loads += 1;
      if (loads === 1) return clone(assignedNoInterestResponse);
      throw new Error('dashboard offline');
    },
  });
  await page.initialize();
  await page.run('loadDashboard()');

  assert.match(page.element('dashboard-status').className, /stale/);
  assert.match(page.card(20).textContent, /Northstar Health/);
  assert.equal(page.card(20).createButton.disabled, true);
  assert.equal(page.element('dashboard-retry').hidden, false);
});

test('relationship manager controls remain responsive at 390 pixels', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(
    css,
    /@media \(max-width:\s*390px\)[\s\S]*?\.rm-portfolio-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(css, /\.rm-detail-card\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\)/s);
  assert.match(css, /\.rm-dashboard :is\([\s\S]*?\):focus-visible\s*\{/);
});
