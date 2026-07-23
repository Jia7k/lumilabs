const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'js', 'mybusinesses.js'), 'utf8');

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
    interest_count: 1,
    conversation_id: 12,
    chat_state: 'open',
  });
  assert.match(open, /href="messages\.html\?conversationId=12"/);
  assert.match(open, /Open Managed Chat/);

  const archived = render(client, {
    status: 'rejected',
    interest_count: 0,
    conversation_id: 12,
    chat_state: 'archived',
  });
  assert.match(archived, /href="messages\.html\?conversationId=12"/);
  assert.match(archived, /View Archived Chat/);
});

test('My Businesses distinguishes manager handoff from waiting for investor interest', () => {
  const client = loadClient();

  for (const interestCount of [2, '2']) {
    const awaiting = render(client, {
      status: 'approved',
      interest_count: interestCount,
      conversation_id: null,
      chat_state: 'awaiting_manager',
    });
    assert.match(awaiting, /Awaiting Relationship Manager/);
    assert.doesNotMatch(awaiting, /href=/);
  }

  const waiting = render(client, {
    status: 'approved',
    interest_count: 0,
    conversation_id: null,
    chat_state: 'awaiting_manager',
  });
  assert.match(waiting, /Waiting for investor interest/);
  assert.doesNotMatch(waiting, /Awaiting Relationship Manager/);
  assert.doesNotMatch(waiting, /href=/);
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
