const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'mybusinesses.js'), 'utf8');
const dashboardPage = fs.readFileSync(
  path.join(root, 'businessownerdashboard.html'),
  'utf8',
);
const businessesPage = fs.readFileSync(path.join(root, 'mybusinesses.html'), 'utf8');

function loadClient() {
  const elements = new Map();
  const document = {
    addEventListener() {},
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          innerHTML: '',
          innerText: '',
          addEventListener() {},
          classList: {
            toggle() {},
            remove() {},
          },
        });
      }
      return elements.get(id);
    },
  };
  const context = vm.createContext({
    window: { location: { href: '' } },
    document,
    requirePageRole: async () => null,
    API: {},
    alert() {},
    confirm() { return false; },
    console,
    Date,
    Intl,
    normalizeReadinessScore(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return 0;
      if (typeof value === 'string' && value.trim() === '') return 0;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
    },
  });
  vm.runInContext(source, context);
  return {
    elements,
    run(code) {
      return vm.runInContext(code, context);
    },
  };
}

function render(client, portfolio) {
  return client.run(`managedChatAction(${JSON.stringify(portfolio)})`);
}

test('My Businesses prioritizes accessible open and archived conversations', () => {
  const client = loadClient();

  const open = render(client, {
    status: 'approved',
    relationship_manager_id: 8,
    interest_count: 1,
    conversation_id: 12,
    chat_state: 'open',
  });
  assert.match(open, /href="messages\.html\?conversation=12"/);
  assert.match(open, /Open Managed Chat/);

  const archived = render(client, {
    status: 'rejected',
    relationship_manager_id: 8,
    interest_count: 0,
    conversation_id: 12,
    chat_state: 'archived',
  });
  assert.match(archived, /href="messages\.html\?conversation=12"/);
  assert.match(archived, /View Archived Chat/);
});

test('My Businesses uses assignment before interest and manager chat handoff', () => {
  const client = loadClient();

  const unassigned = render(client, {
    status: 'approved',
    relationship_manager_id: null,
    interest_count: 0,
    conversation_id: null,
    chat_state: 'awaiting_manager',
  });
  assert.match(unassigned, /Awaiting relationship manager assignment/);

  for (const interestCount of [2, '2']) {
    const awaiting = render(client, {
      status: 'approved',
      relationship_manager_id: 8,
      interest_count: interestCount,
      conversation_id: null,
      chat_state: 'awaiting_manager',
    });
    assert.match(awaiting, /Awaiting relationship manager to create the group chat/);
    assert.doesNotMatch(awaiting, /href=/);
  }

  const waiting = render(client, {
    status: 'approved',
    relationship_manager_id: 8,
    interest_count: 0,
    conversation_id: null,
    chat_state: 'awaiting_manager',
  });
  assert.match(waiting, /Waiting for investor interest/);
  assert.doesNotMatch(waiting, /Awaiting relationship manager assignment/);
  assert.doesNotMatch(waiting, /href=/);
});

test('managedChatGuidance returns the exact assignment workflow states', () => {
  const client = loadClient();
  for (const [portfolio, expected] of [
    [
      { relationship_manager_id: null, interest_count: 3 },
      'Awaiting relationship manager assignment',
    ],
    [
      { relationship_manager_id: 8, interest_count: 0 },
      'Waiting for investor interest',
    ],
    [
      { relationship_manager_id: 8, interest_count: 2, conversation_id: null },
      'Awaiting relationship manager to create the group chat',
    ],
    [
      {
        relationship_manager_id: 8,
        interest_count: 2,
        conversation_id: 12,
        chat_state: 'active',
      },
      'Open group chat',
    ],
    [
      {
        relationship_manager_id: 8,
        interest_count: 2,
        conversation_id: 12,
        chat_state: 'archived',
      },
      'View archived group chat',
    ],
  ]) {
    assert.equal(
      client.run(`managedChatGuidance(${JSON.stringify(portfolio)})`),
      expected,
    );
  }
});

test('My Businesses rejects unsafe conversation links', () => {
  const client = loadClient();
  const unsafe = render(client, {
    status: 'approved',
    relationship_manager_id: 8,
    interest_count: 1,
    conversation_id: Number.MAX_SAFE_INTEGER + 1,
    chat_state: 'open',
  });
  assert.doesNotMatch(unsafe, /href=/);
});

test('My Businesses shows no managed-chat guidance for ineligible portfolio states', () => {
  const client = loadClient();

  for (const status of ['draft', 'pending', 'rejected']) {
    assert.equal(render(client, {
      status,
      interest_count: 3,
      conversation_id: null,
      chat_state: 'awaiting_manager',
    }), '');
  }
});

test('My Businesses renders malformed readiness as numeric zero', async () => {
  const client = loadClient();
  client.run(`
    API.getMyPortfolios = async () => [{
      id: 1,
      name: 'Malformed',
      sector: 'Fintech',
      status: 'draft',
      mvp_status: 'Beta',
      funding_goal: 1000,
      readiness_score: [88],
      updated_at: '2026-01-01'
    }];
  `);

  await client.run('render()');
  const html = client.elements.get('biz-list').innerHTML;
  assert.match(html, />0\/100</);
  assert.doesNotMatch(html, />88\/100</);
});

test('owner navigation is hidden before auth and revealed only after role resolution', async () => {
  for (const page of [dashboardPage, businessesPage]) {
    assert.match(page, /<div[^>]*id="business-owner-nav"[^>]*hidden[^>]*>/);
    assert.match(page, /(?:css\/style|js\/api)\.[a-z]+\?v=20260728\.3/);
  }

  const client = loadClient();
  client.run(`
    requirePageRole = async () => ({ id: 3, name: 'Owner', role: 'business_owner' });
    API.getMyPortfolios = async () => [];
  `);
  await client.run('init()');
  assert.equal(client.elements.get('business-owner-nav').hidden, false);
});
