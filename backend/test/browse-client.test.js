const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'browse.js'), 'utf8');

function browseHarness({
  includeStatus = true,
  captureStatus = true,
  captureFilters = true,
} = {}) {
  const hooks = { calls: [], statuses: [], renders: 0 };
  const elements = new Map();
  const context = vm.createContext({
    window: { location: { href: '' } },
    document: {
      getElementById(id) {
        if (id === 'browse-status' && !includeStatus) return null;
        if (!elements.has(id)) {
          elements.set(id, {
            value: '',
            innerHTML: '',
            innerText: '',
            hidden: false,
            className: '',
            addEventListener() {},
            classList: { toggle() {}, add() {}, remove() {} },
          });
        }
        return elements.get(id);
      },
      addEventListener() {},
    },
    requirePageRole: async () => null,
    API: {},
    alert() {},
    console,
    Set,
    hooks,
  });
  vm.runInContext(source, context);
  vm.runInContext(
    `${captureFilters ? 'applyFilters = () => { hooks.renders += 1; };' : ''}
    ${captureStatus ? 'setBrowseStatus = (message, type, retryable) => hooks.statuses.push({ message, type, retryable });' : ''}`,
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
