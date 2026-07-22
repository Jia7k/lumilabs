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
