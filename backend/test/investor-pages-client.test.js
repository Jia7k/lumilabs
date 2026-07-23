const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');

function elementMap() {
  const elements = new Map();
  return {
    elements,
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            innerHTML: '', innerText: '', textContent: '', disabled: false,
            addEventListener(_name, handler) { this.handler = handler; },
            classList: { add() {}, remove() {}, toggle() { return false; } },
            setAttribute() {},
          });
        }
        return elements.get(id);
      },
      addEventListener() {},
    },
  };
}

function loadClient(file) {
  const dom = elementMap();
  const hooks = { menuCalls: 0 };
  const context = vm.createContext({
    window: { location: { href: '' } },
    document: dom.document,
    requirePageRole: async () => null,
    API: {},
    console,
    alert() {},
    setTimeout,
    clearTimeout,
    hooks,
    Date,
    Intl,
    normalizeReadinessScore(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return 0;
      if (typeof value === 'string' && value.trim() === '') return 0;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return { context, hooks, elements: dom.elements, run: (code) => vm.runInContext(code, context) };
}

test('dashboard failure still renders recommendations and quick navigation without a false zero', async () => {
  const client = loadClient('js/investordashboard.js');
  client.run(`
    API.getInvestorDashboard = async () => { throw new Error('dashboard down'); };
    API.getRecommendations = async () => [{
      id: 1, name: 'Solar Stack', sector: 'Clean Energy', ai_score: 88,
      readiness_score: 80, funding_goal: 500000, created_at: '2026-07-23T00:00:00Z'
    }];
  `);
  await client.run('loadInvestorDashboard()');
  assert.match(client.elements.get('recommended-list').innerHTML, /Solar Stack/);
  assert.match(client.elements.get('quick-actions-list').innerHTML, /Browse Startups/);
  assert.match(client.elements.get('quick-actions-list').innerHTML, /My Interests/);
  assert.doesNotMatch(client.elements.get('quick-actions-list').innerHTML, /badge-red[^>]*>0</);
  assert.match(client.elements.get('recent-interests-list').innerHTML, /Retry/);
  assert.equal(client.elements.get('stat-interests').innerText, '—');
});

test('recommendation failure preserves dashboard data and uses its real interest count', async () => {
  const client = loadClient('js/investordashboard.js');
  client.run(`
    API.getInvestorDashboard = async () => ({
      stats: { available: 7, interests: 3, messages: 2, highPotential: 4 },
      recentInterests: [{ id: 1, name: 'Solar Stack', sector: 'Clean Energy' }]
    });
    API.getRecommendations = async () => { throw new Error('recommendations down'); };
  `);
  await client.run('loadInvestorDashboard()');
  assert.equal(client.elements.get('stat-interests').innerText, 3);
  assert.match(client.elements.get('recent-interests-list').innerHTML, /Solar Stack/);
  assert.match(client.elements.get('recommended-list').innerHTML, /Retry/);
  assert.match(client.elements.get('recently-added-grid').innerHTML, /Retry/);
  assert.match(client.elements.get('quick-actions-list').innerHTML, /badge-red[^>]*>3</);
});

test('dashboard section Retry uses a visible card-specific button style', async () => {
  const client = loadClient('js/investordashboard.js');
  client.run(`
    API.getInvestorDashboard = async () => { throw new Error('dashboard down'); };
    API.getRecommendations = async () => { throw new Error('recommendations down'); };
  `);

  await client.run('loadInvestorDashboard()');

  assert.match(client.elements.get('recent-interests-list').innerHTML, /btn-section-retry/);
  const page = fs.readFileSync(path.join(root, 'investordashboard.html'), 'utf8');
  assert.match(page, /\.btn-section-retry\s*\{[^}]*color:\s*var\(--text-primary\)/s);
  assert.match(page, /\.btn-section-retry\s*\{[^}]*border:\s*1px solid var\(--border\)/s);
});

test('a superseded dashboard load cannot overwrite a newer result', async () => {
  const client = loadClient('js/investordashboard.js');
  let resolveOldDashboard;
  let resolveOldRecommendations;
  client.context.oldDashboard = new Promise((resolve) => { resolveOldDashboard = resolve; });
  client.context.oldRecommendations = new Promise((resolve) => { resolveOldRecommendations = resolve; });
  client.run(`
    dashboardCalls = 0;
    recommendationCalls = 0;
    API.getInvestorDashboard = async () => {
      dashboardCalls += 1;
      if (dashboardCalls === 1) return oldDashboard;
      return {
        stats: { available: 8, interests: 4, messages: 2, highPotential: 5 },
        recentInterests: [{ id: 2, name: 'New Result', sector: 'SaaS' }]
      };
    };
    API.getRecommendations = async () => {
      recommendationCalls += 1;
      if (recommendationCalls === 1) return oldRecommendations;
      return [{
        id: 2, name: 'New Result', sector: 'SaaS', ai_score: 92,
        readiness_score: 86, funding_goal: 900000, created_at: '2026-07-23T01:00:00Z'
      }];
    };
  `);

  const oldLoad = client.run('loadInvestorDashboard()');
  await client.run('loadInvestorDashboard()');
  resolveOldDashboard({
    stats: { available: 1, interests: 1, messages: 0, highPotential: 0 },
    recentInterests: [{ id: 1, name: 'Old Result', sector: 'Fintech' }],
  });
  resolveOldRecommendations([{
    id: 1, name: 'Old Result', sector: 'Fintech', ai_score: 50,
    readiness_score: 50, funding_goal: 100000, created_at: '2026-07-22T01:00:00Z',
  }]);
  await oldLoad;

  assert.match(client.elements.get('recent-interests-list').innerHTML, /New Result/);
  assert.doesNotMatch(client.elements.get('recent-interests-list').innerHTML, /Old Result/);
  assert.equal(client.elements.get('stat-interests').innerText, 4);
});

test('My Interests binds its menu and retry before a failed data load', async () => {
  const client = loadClient('js/my-interests.js');
  client.run(`
    requirePageRole = async () => ({ id: 6, name: 'Investor', role: 'investor' });
    initRoleMenu = () => { hooks.menuCalls += 1; };
    API.getMyInterests = async () => { throw new Error('<temporary>'); };
  `);
  await client.run('init()');
  assert.equal(client.hooks.menuCalls, 1);
  assert.match(client.elements.get('interests-list').innerHTML, /Retry/);
  assert.match(client.elements.get('interests-list').innerHTML, /&lt;temporary&gt;/);
});

test('My Interests Retry performs one guarded read and replaces the error', async () => {
  const client = loadClient('js/my-interests.js');
  client.run(`
    testCalls = 0;
    API.getMyInterests = async () => {
      testCalls += 1;
      if (testCalls === 1) throw new Error('temporary');
      return [{ id: 1, name: 'Solar Stack', sector: 'Clean Energy', owner_name: 'Charlie', readiness_score: 80 }];
    };
  `);
  await client.run('loadInterests()');
  await client.run('loadInterests()');
  assert.equal(client.run('testCalls'), 2);
  assert.match(client.elements.get('interests-list').innerHTML, /Solar Stack/);
  assert.equal(client.elements.get('count-badge').innerText, 1);
});

test('investor recent cards normalize malformed readiness without a high badge', () => {
  const client = loadClient('js/investordashboard.js');
  client.run(`
    renderRecommendationResult({
      status: 'fulfilled',
      value: [{
        id: 1,
        name: 'Malformed',
        sector: 'Fintech',
        ai_score: 20,
        readiness_score: [88],
        funding_goal: 1000,
        created_at: '2026-01-01'
      }]
    });
  `);

  const html = client.elements.get('recently-added-grid').innerHTML;
  assert.match(html, />0<\/div>/);
  assert.doesNotMatch(html, /var\\(--purple-light\\)/);
  assert.doesNotMatch(html, />88<\/div>/);
});

test('My Interests renders nullable readiness as numeric zero', () => {
  const client = loadClient('js/my-interests.js');
  client.run(`
    interests = [{
      id: 1,
      name: 'Nullable',
      sector: 'Fintech',
      owner_name: 'Owner',
      readiness_score: null,
      funding_goal: 1000
    }];
    render();
  `);

  const html = client.elements.get('interests-list').innerHTML;
  assert.match(html, />0\/100</);
  assert.doesNotMatch(html, /null\/100/);
});

test('recommended and recently added cards preserve their selected portfolio ID', () => {
  const client = loadClient('js/investordashboard.js');
  client.run(`
    renderRecommendationResult({
      status: 'fulfilled',
      value: [{
        id: 42,
        name: 'Selected',
        sector: 'Fintech',
        ai_score: 90,
        readiness_score: 80,
        funding_goal: 1000,
        created_at: '2026-01-01'
      }]
    });
  `);

  assert.match(
    client.elements.get('recommended-list').innerHTML,
    /browse\.html\?portfolioId=42/,
  );
  assert.match(
    client.elements.get('recently-added-grid').innerHTML,
    /browse\.html\?portfolioId=42/,
  );
});
