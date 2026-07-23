const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'browse.js'), 'utf8');
const browsePage = fs.readFileSync(path.join(__dirname, '..', '..', 'browse.html'), 'utf8');

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

  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name);
    else this.values.delete(name);
    return next;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.innerHTML = '';
    this.innerText = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.className = '';
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.focused = false;
    this.scrolled = false;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatch(type, target = this) {
    const event = {
      type,
      target,
      preventDefault() {},
      stopPropagation() {},
    };
    for (const handler of this.listeners.get(type) || []) await handler(event);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {
    this.scrolled = true;
  }
}

function browseHarness({
  includeStatus = true,
  includeRecommendationStatus = true,
  captureStatus = true,
  captureRecommendationStatus = true,
  captureFilters = true,
} = {}) {
  const hooks = {
    calls: [],
    statuses: [],
    recommendationStatuses: [],
    renders: 0,
  };
  const elements = new Map();
  const documentListeners = new Map();
  const context = vm.createContext({
    window: { location: { href: '' } },
    document: {
      getElementById(id) {
        if (id === 'browse-status' && !includeStatus) return null;
        if (id === 'recommendation-status' && !includeRecommendationStatus) return null;
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
      },
      addEventListener(type, handler) {
        const handlers = documentListeners.get(type) || [];
        handlers.push(handler);
        documentListeners.set(type, handlers);
      },
    },
    requirePageRole: async () => null,
    API: {},
    alert() {},
    console,
    Set,
    normalizeReadinessScore(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return 0;
      if (typeof value === 'string' && value.trim() === '') return 0;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
    },
    hooks,
    Object,
  });
  vm.runInContext(source, context);
  vm.runInContext(
    `${captureFilters ? 'applyFilters = () => { hooks.renders += 1; };' : ''}
    ${captureStatus ? 'setBrowseStatus = (message, type, retryable) => hooks.statuses.push({ message, type, retryable });' : ''}
    ${captureRecommendationStatus ? 'setRecommendationStatus = (message, type, retryable) => hooks.recommendationStatuses.push({ message, type, retryable });' : ''}`,
    context,
  );
  return {
    context,
    elements,
    hooks,
    run: (code) => vm.runInContext(code, context),
  };
}

test('new browse client tolerates a cached page without the status target', () => {
  const client = browseHarness({ includeStatus: false, captureStatus: false });
  assert.doesNotThrow(() => client.run("setBrowseStatus('Temporary', 'error', true)"));
});

test('successful interest mutation commits the two refetched sources together', async () => {
  const client = browseHarness();
  client.run(`
    allPortfolios = [{ id: 1, interest_count: 4, chat_state: 'awaiting_manager' }];
    interestedIds = new Set();
    API.expressInterest = async (id) => { hooks.calls.push(['express', id]); };
    API.getAllPortfolios = async () => {
      hooks.calls.push(['portfolios']);
      return [{ id: 1, interest_count: 9, chat_state: 'open', conversation_id: 44 }];
    };
    API.getMyInterests = async () => { hooks.calls.push(['interests']); return [{ id: 1 }]; };
  `);
  await client.run('toggleInterest(1)');
  assert.deepEqual(
    JSON.parse(JSON.stringify(client.hooks.calls)),
    [['express', 1], ['portfolios'], ['interests']],
  );
  assert.equal(client.run('allPortfolios[0].interest_count'), 9);
  assert.equal(client.run('allPortfolios[0].chat_state'), 'open');
  assert.equal(client.run('interestedIds.has(1)'), true);
});

test('one failed authoritative read commits neither source and Retry never resends mutation', async () => {
  const client = browseHarness();
  client.run(`
    allPortfolios = [{ id: 1, interest_count: 4 }];
    interestedIds = new Set();
    API.expressInterest = async () => { hooks.calls.push(['express']); };
    API.getAllPortfolios = async () => [{ id: 1, interest_count: 5 }];
    API.getMyInterests = async () => { throw new Error('read failed'); };
  `);
  await client.run('toggleInterest(1)');
  assert.equal(client.run('allPortfolios[0].interest_count'), 4);
  assert.equal(client.run('interestedIds.has(1)'), false);
  assert.equal(client.run('interestDataStale'), true);
  assert.match(client.hooks.statuses.at(-1).message, /saved.*refresh/i);
  assert.equal(client.hooks.statuses.at(-1).retryable, true);
  client.run(`
    API.getAllPortfolios = async () => [{ id: 1, interest_count: 5 }];
    API.getMyInterests = async () => [{ id: 1 }];
  `);
  await client.run('retryInterestRefresh()');
  assert.equal(client.hooks.calls.filter(([name]) => name === 'express').length, 1);
  assert.equal(client.run('allPortfolios[0].interest_count'), 5);
  assert.equal(client.run('interestedIds.has(1)'), true);
  assert.equal(client.run('interestDataStale'), false);
});

test('overlapping card toggles are ignored while one reconciliation is pending', async () => {
  const client = browseHarness();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  client.context.pending = pending;
  client.run(`
    allPortfolios = [{ id: 1 }, { id: 2 }];
    interestedIds = new Set();
    API.expressInterest = async (id) => { hooks.calls.push(['express', id]); await pending; };
    API.getAllPortfolios = async () => allPortfolios;
    API.getMyInterests = async () => [];
  `);
  const first = client.run('toggleInterest(1)');
  const second = client.run('toggleInterest(2)');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(JSON.parse(JSON.stringify(client.hooks.calls)), [['express', 1]]);
});

test('browse managed-chat guidance waits for the current investor to express interest', () => {
  const client = browseHarness();

  const open = client.run(`managedChatAction({
    conversation_id: 44,
    chat_state: 'open'
  }, false)`);
  assert.match(open, /href="messages\.html\?conversationId=44"/);
  assert.match(open, /Open Managed Chat/);

  const archived = client.run(`managedChatAction({
    conversation_id: 44,
    chat_state: 'archived'
  }, false)`);
  assert.match(archived, /View Archived Chat/);

  const awaiting = client.run(`managedChatAction({
    conversation_id: null,
    chat_state: 'awaiting_manager'
  }, true)`);
  assert.match(awaiting, /Awaiting Relationship Manager/);
  assert.doesNotMatch(awaiting, /href=/);

  assert.equal(client.run(`managedChatAction({
    conversation_id: null,
    chat_state: 'awaiting_manager'
  }, false)`), '');
});

test('renderGrid supplies the reconciled current-investor state to chat guidance', () => {
  const client = browseHarness();

  client.run(`
    interestedIds = new Set([1]);
    managedChatAction = (portfolio, hasInterest) => {
      hooks.calls.push([portfolio.id, hasInterest]);
      return "";
    };
    renderGrid([
      {
        id: 1, name: "Interested", owner_name: "Owner", sector: "SaaS",
        funding_goal: 1000, readiness_score: 70, interest_count: 1
      },
      {
        id: 2, name: "Not interested", owner_name: "Owner", sector: "SaaS",
        funding_goal: 1000, readiness_score: 70, interest_count: 0
      }
    ]);
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(client.hooks.calls)),
    [[1, true], [2, false]],
  );
});

test('sector filtering uses the exact database value instead of a substring', () => {
  const client = browseHarness({ captureFilters: false });
  client.run(`
    document.getElementById('sector-filter').value = 'Fintech';
    allPortfolios = [
      {
        id: 1, name: 'Exact', owner_name: 'Owner', sector: 'Fintech',
        readiness_score: 50, created_at: '2026-01-01'
      },
      {
        id: 2, name: 'Substring', owner_name: 'Owner', sector: 'Fintech Services',
        readiness_score: 50, created_at: '2026-01-02'
      }
    ];
    renderGrid = (portfolios) => {
      hooks.filteredIds = portfolios.map(({ id }) => id);
    };
    applyFilters();
  `);
  assert.deepEqual(
    JSON.parse(JSON.stringify(client.hooks.filteredIds)),
    [1],
  );
});

test('Browse normalizes card readiness and blocks coercible high-potential values', () => {
  const client = browseHarness();
  client.run(`
    interestedIds = new Set();
    renderGrid([{
      id: 1,
      name: 'Malformed Score',
      owner_name: 'Owner',
      sector: 'Fintech',
      funding_goal: 1000,
      readiness_score: [88],
      interest_count: 0
    }]);
  `);

  const html = client.elements.get('card-grid').innerHTML;
  assert.match(html, />0\/100</);
  assert.doesNotMatch(html, /High Potential/);
  assert.doesNotMatch(html, />88\/100</);
});

test('Browse threshold and fallback sort use normalized readiness', () => {
  const client = browseHarness({ captureFilters: false });
  client.run(`
    document.getElementById('score-filter').value = '0';
    allPortfolios = [
      {
        id: 1, name: 'Malformed', owner_name: 'Owner', sector: 'Fintech',
        readiness_score: 'not-a-score', created_at: '2026-01-02'
      },
      {
        id: 2, name: 'Ready', owner_name: 'Owner', sector: 'Fintech',
        readiness_score: '88', created_at: '2026-01-01'
      }
    ];
    aiScores = {};
    renderGrid = (portfolios) => {
      hooks.filteredIds = portfolios.map(({ id }) => id);
    };
    applyFilters();
  `);

  assert.deepEqual(
    JSON.parse(JSON.stringify(client.hooks.filteredIds)),
    [2, 1],
  );
});

function portfolio(id, readinessScore, name = `Portfolio ${id}`) {
  return {
    id,
    name,
    owner_name: 'Owner',
    sector: 'Fintech',
    funding_goal: 1000,
    readiness_score: readinessScore,
    interest_count: 0,
    created_at: `2026-01-0${id}T00:00:00.000Z`,
  };
}

test('Browse exposes independent workspace and recommendation live regions', () => {
  assert.match(
    browsePage,
    /id=["']recommendation-status["'][^>]*role=["']status["'][^>]*aria-live=["']polite["'][^>]*hidden/,
  );
  assert.match(browsePage, /id=["']sort-ai["'][^>]*>[\s\S]*Readiness Score/);
});

test('deferred recommendations do not delay a successful workspace render', async () => {
  const recommendations = deferred();
  const client = browseHarness({
    captureFilters: false,
    captureStatus: false,
    captureRecommendationStatus: false,
  });
  client.context.pendingRecommendations = recommendations.promise;
  client.run(`
    requirePageRole = async () => ({ id: 9, name: 'Investor', role: 'investor' });
    API.getAllPortfolios = async () => [${JSON.stringify(portfolio(1, 60, 'Workspace Ready'))}];
    API.getMyInterests = async () => [];
    API.getRecommendations = async () => pendingRecommendations;
  `);

  let settled = false;
  const initialization = client.run('init()').then(() => { settled = true; });
  await flush();
  const settledBeforeRecommendations = settled;
  const workspaceHtml = client.elements.get('card-grid').innerHTML;
  recommendations.resolve([]);
  await initialization;

  assert.equal(settledBeforeRecommendations, true);
  assert.match(workspaceHtml, /Workspace Ready/);
});

test('workspace and recommendation failures stay in separate recovery regions', async () => {
  const client = browseHarness({
    captureFilters: false,
    captureStatus: false,
    captureRecommendationStatus: false,
  });
  client.run(`
    requirePageRole = async () => ({ id: 9, name: 'Investor', role: 'investor' });
    API.getAllPortfolios = async () => { throw new Error('workspace down'); };
    API.getMyInterests = async () => [];
    API.getRecommendations = async () => { throw new Error('ranking down'); };
  `);

  await client.run('init()');
  await flush();

  const workspace = client.elements.get('browse-status').innerHTML;
  const recommendations = client.elements.get('recommendation-status').innerHTML;
  assert.match(workspace, /workspace down/);
  assert.match(workspace, /data-retry-interest-refresh/);
  assert.doesNotMatch(workspace, /ranking down/);
  assert.match(recommendations, /ranking down/);
  assert.match(recommendations, /data-retry-recommendations/);
  assert.doesNotMatch(recommendations, /workspace down/);
});

test('recommendation failure keeps cards visible with readiness ranking labels', async () => {
  const client = browseHarness({
    captureFilters: false,
    captureRecommendationStatus: false,
  });
  client.run(`
    allPortfolios = [
      ${JSON.stringify(portfolio(1, 20, 'Lower'))},
      ${JSON.stringify(portfolio(2, 80, 'Higher'))}
    ];
    API.getRecommendations = async () => { throw new Error('ranking down'); };
  `);

  assert.equal(await client.run('loadRecommendations({ supersede: true })'), false);
  const html = client.elements.get('card-grid').innerHTML;
  assert.equal(client.run('recommendationState'), 'fallback');
  assert.ok(html.indexOf('Higher') < html.indexOf('Lower'));
  assert.match(html, /Readiness Score/);
  assert.doesNotMatch(html, /AI Score/);
  assert.match(client.elements.get('sort-ai').innerHTML, /Readiness Score/);
});

test('recommendation Retry is single-flight and touches only recommendations', async () => {
  const retry = deferred();
  const client = browseHarness({
    captureFilters: false,
    captureStatus: false,
    captureRecommendationStatus: false,
  });
  client.context.retryRequest = retry.promise;
  client.run(`
    allPortfolios = [
      ${JSON.stringify(portfolio(1, 80, 'Ready First'))},
      ${JSON.stringify(portfolio(2, 20, 'AI First'))}
    ];
    recommendationState = 'fallback';
    testRecommendationCalls = 0;
    API.getRecommendations = async () => {
      testRecommendationCalls += 1;
      return retryRequest;
    };
    API.getAllPortfolios = async () => { hooks.calls.push(['portfolios']); return []; };
    API.getMyInterests = async () => { hooks.calls.push(['interests']); return []; };
    API.expressInterest = async () => { hooks.calls.push(['mutation']); };
  `);

  const first = client.run('retryRecommendations()');
  const second = client.run('retryRecommendations()');
  await flush();
  assert.equal(client.run('testRecommendationCalls'), 1);
  assert.deepEqual(client.hooks.calls, []);
  retry.resolve([{ id: 2, ai_score: 99 }, { id: 1, ai_score: 1 }]);
  await Promise.all([first, second]);

  assert.equal(client.run('recommendationState'), 'ready');
  assert.equal(client.elements.get('recommendation-status').hidden, true);
  assert.match(client.elements.get('sort-ai').innerHTML, /AI Ranked/);
  const html = client.elements.get('card-grid').innerHTML;
  assert.ok(html.indexOf('AI First') < html.indexOf('Ready First'));
  assert.match(html, /AI Score/);
});

test('a failed refresh after success clears stale AI scores', async () => {
  const client = browseHarness({
    captureFilters: false,
    captureRecommendationStatus: false,
  });
  client.run(`
    allPortfolios = [
      ${JSON.stringify(portfolio(1, 90, 'Readiness Winner'))},
      ${JSON.stringify(portfolio(2, 10, 'Old AI Winner'))}
    ];
    recommendationState = 'ready';
    aiScores = { 1: 1, 2: 99 };
    API.getRecommendations = async () => { throw new Error('refresh failed'); };
  `);

  assert.equal(await client.run('loadRecommendations({ supersede: true })'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(client.run('aiScores'))), {});
  assert.equal(client.run('recommendationState'), 'fallback');
  const html = client.elements.get('card-grid').innerHTML;
  assert.ok(html.indexOf('Readiness Winner') < html.indexOf('Old AI Winner'));
  assert.doesNotMatch(html, /AI Score/);
});

test('superseding recommendation loads ignore stale out-of-order results', async () => {
  const older = deferred();
  const newer = deferred();
  const client = browseHarness({ captureFilters: false });
  client.context.olderRequest = older.promise;
  client.context.newerRequest = newer.promise;
  client.run(`
    recommendationCalls = 0;
    API.getRecommendations = async () => {
      recommendationCalls += 1;
      return recommendationCalls === 1 ? olderRequest : newerRequest;
    };
  `);

  const first = client.run('loadRecommendations({ supersede: true })');
  const second = client.run('loadRecommendations({ supersede: true })');
  await flush();
  assert.equal(client.run('recommendationCalls'), 2);

  newer.resolve([{ id: 1, ai_score: 90 }]);
  await second;
  older.resolve([{ id: 1, ai_score: 10 }]);
  await first;

  assert.equal(client.run('recommendationState'), 'ready');
  assert.equal(client.run('aiScores[1]'), 90);
});

test('workspace and recommendation errors cannot overwrite each other', async () => {
  const client = browseHarness({
    captureFilters: false,
    captureStatus: false,
    captureRecommendationStatus: false,
  });
  client.run(`
    setRecommendationStatus('Existing recommendation warning', 'warning', true);
    allPortfolios = [${JSON.stringify(portfolio(1, 50))}];
    interestedIds = new Set();
    API.expressInterest = async () => { throw new Error('interest failed'); };
  `);
  await client.run('toggleInterest(1)');
  assert.match(
    client.elements.get('recommendation-status').innerHTML,
    /Existing recommendation warning/,
  );

  client.run(`
    setBrowseStatus('Existing workspace warning', 'warning', true);
    API.getRecommendations = async () => { throw new Error('recommendation failed'); };
  `);
  await client.run('loadRecommendations({ supersede: true })');
  assert.match(client.elements.get('browse-status').innerHTML, /Existing workspace warning/);
});
