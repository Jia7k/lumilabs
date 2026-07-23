const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const htmlPath = path.join(root, 'relationshipmanagerdashboard.html');
const clientPath = path.join(root, 'js', 'relationshipmanagerdashboard.js');
const cssPath = path.join(root, 'css', 'style.css');

function readRequired(file, label) {
  assert.equal(fs.existsSync(file), true, `${label} must exist`);
  return fs.readFileSync(file, 'utf8');
}

function managerHarness() {
  const elements = new Map();
  const hooks = { statuses: [], renders: 0, refreshes: 0 };
  const document = {
    addEventListener() {},
    querySelectorAll() { return []; },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          innerHTML: '', textContent: '', className: '', hidden: false,
          addEventListener() {},
        });
      }
      return elements.get(id);
    },
  };
  const context = vm.createContext({
    window: { location: { href: '' } }, document, console, API: {},
    requirePageRole: async () => null, hooks,
  });
  vm.runInContext(readRequired(clientPath, 'relationship manager client'), context);
  const originalSetStatus = context.setStatus;
  vm.runInContext(`
    setStatus = (message, type, retryable) => hooks.statuses.push({ message, type, retryable });
    renderDashboard = () => { hooks.renders += 1; };
  `, context);
  return {
    context,
    elements,
    hooks,
    originalSetStatus,
    run: (code) => vm.runInContext(code, context),
  };
}

test('manager dashboard has semantic loading, content, empty, and recoverable status regions', () => {
  const html = readRequired(htmlPath, 'relationship manager dashboard');
  for (const id of [
    'stat-eligible', 'stat-active', 'stat-businesses', 'stat-unread',
    'dashboard-status', 'unclaimed-room-list', 'managed-room-list',
    'user-avatar', 'user-name', 'user-role',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`), id);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Loading managed conversations/);
  assert.match(html, /<main/);
  assert.match(html, /signOut/);
});

test('Retry remains visually hidden when the dashboard status is not retryable', () => {
  const css = readRequired(cssPath, 'shared stylesheet');
  assert.match(
    css,
    /\.rm-retry\[hidden\]\s*\{[^}]*display:\s*none\s*;?[^}]*\}/s,
  );

  const client = managerHarness();

  client.originalSetStatus('Dashboard is up to date.', 'success');
  assert.equal(client.elements.get('dashboard-retry').hidden, true);

  client.originalSetStatus('Could not load the dashboard.', 'error', true);
  assert.equal(client.elements.get('dashboard-retry').hidden, false);
});

test('role authorization completes before dashboard data loading', () => {
  const source = readRequired(clientPath, 'relationship manager client');
  const roleCheck = source.indexOf('await requirePageRole("relationship_manager")');
  const dataLoad = source.indexOf('API.getRelationshipManagerDashboard()');
  assert.ok(roleCheck >= 0 && dataLoad > roleCheck);
  assert.match(source, /if \(!state\.user\) return/);
});

test('client tracks multiple create/add selections and recoverable pending state', () => {
  const source = readRequired(clientPath, 'relationship manager client');
  assert.match(source, /selectedCreateInterests:\s*new Map\(\)/);
  assert.match(source, /selectedAddInterests:\s*new Map\(\)/);
  assert.match(source, /pending:\s*new Set\(\)/);
  assert.match(source, /const selector = [^\n]*:checked/);
  assert.match(source, /querySelectorAll\(selector\)/);
  assert.match(source, /API\.createManagedConversation\([^,]+,\s*interestIds\)/);
  assert.match(source, /API\.addManagedInvestors\([^,]+,\s*interestIds\)/);
  assert.match(source, /Please select at least one interested investor/);
  assert.match(source, /setStatus\(error\.message,\s*"error"\)/);
});

test('rendering escapes names and titles and avoids unescaped inline handlers', () => {
  const source = readRequired(clientPath, 'relationship manager client');
  for (const expression of [
    'portfolio.portfolio_name', 'portfolio.owner.name', 'interest.investor.name', 'room.title',
  ]) assert.match(source, new RegExp(`escapeHtml\\(${expression.replace('.', '\\.')}\\)`));
  assert.match(source, /function participantChip\(name,[\s\S]*escapeHtml\(name\)/);
  assert.match(source, /participantChip\(room\.owner\.name/);
  assert.match(source, /participantChip\(investor\.name/);
  assert.doesNotMatch(source, /onclick=/);
  assert.match(source, /addEventListener\("click"/);
  assert.match(source, /<fieldset/);
  assert.match(source, /<legend/);
});

test('reopen eligibility fails closed and allows a newly active investor', () => {
  const client = managerHarness();
  const cases = [
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'manual', investors: [{ id: 2 }], eligible_interests: [] }, true, ''],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'no_active_investors', investors: [{ id: 2 }], eligible_interests: [] }, true, ''],
    [{ status: 'archived', portfolio_id: null, archived_reason: 'portfolio_deleted', investors: [], eligible_interests: [] }, false, 'permanent'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'portfolio_unapproved', investors: [{ id: 2 }], eligible_interests: [] }, false, 'approved'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'no_active_investors', investors: [], eligible_interests: [{ id: 7 }] }, false, 'Add an eligible investor'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'no_active_investors', investors: [], eligible_interests: [] }, false, 'express interest'],
    [{ status: 'archived', portfolio_id: 1, archived_reason: 'manual' }, false, 'current state'],
  ];
  for (const [room, enabled, reason] of cases) {
    client.context.room = room;
    const result = client.run('reopenEligibility(room)');
    assert.equal(result.enabled, enabled, JSON.stringify(room));
    if (reason) assert.match(result.reason, new RegExp(reason, 'i'));
    else assert.equal(result.reason, '');
  }
});

test('mutation success plus refresh failure is marked stale and blocks another mutation', async () => {
  const client = managerHarness();
  client.run(`
    state.dashboard = { stats: {}, unclaimed_portfolios: [], rooms: [] };
    loadDashboard = async () => { hooks.refreshes += 1; return false; };
    mutationCalls = 0;
  `);
  await client.run(`runMutation('archive:12', async () => { mutationCalls += 1; }, 'wrong success')`);
  assert.equal(client.run('mutationCalls'), 1);
  assert.equal(client.run('state.stale'), true);
  assert.equal(client.hooks.refreshes, 1);
  assert.doesNotMatch(client.hooks.statuses.at(-1).message, /wrong success/);
  assert.match(client.hooks.statuses.at(-1).message, /saved.*refresh/i);
  assert.equal(client.hooks.statuses.at(-1).retryable, true);
  await client.run(`runMutation('archive:13', async () => { mutationCalls += 1; }, 'never')`);
  assert.equal(client.run('mutationCalls'), 1);
});

test('mutation rejection retains coherent state and does not refresh', async () => {
  const client = managerHarness();
  client.run(`
    previousDashboard = { stats: { active_rooms: 1 }, unclaimed_portfolios: [], rooms: [] };
    state.dashboard = previousDashboard;
    loadDashboard = async () => { hooks.refreshes += 1; return true; };
  `);
  await client.run(`runMutation('archive:12', async () => { throw new Error('Not allowed'); }, 'success')`);
  assert.equal(client.run('state.dashboard === previousDashboard'), true);
  assert.equal(client.run('state.stale'), false);
  assert.equal(client.hooks.refreshes, 0);
  assert.equal(client.hooks.statuses.at(-1).message, 'Not allowed');
});

test('successful dashboard Retry atomically replaces data and clears stale', async () => {
  const client = managerHarness();
  client.run(`
    state.stale = true;
    state.dashboard = { stats: { active_rooms: 1 }, unclaimed_portfolios: [], rooms: [] };
    API.getRelationshipManagerDashboard = async () => ({
      stats: { active_rooms: 2 }, unclaimed_portfolios: [], rooms: []
    });
  `);
  assert.equal(await client.run('loadDashboard()'), true);
  assert.equal(client.run('state.dashboard.stats.active_rooms'), 2);
  assert.equal(client.run('state.stale'), false);
});

test('successful mutation installs refreshed data before announcing success', async () => {
  const client = managerHarness();
  client.run(`
    state.dashboard = { stats: { active_rooms: 1 }, unclaimed_portfolios: [], rooms: [] };
    API.getRelationshipManagerDashboard = async () => ({
      stats: { active_rooms: 2 }, unclaimed_portfolios: [], rooms: []
    });
    mutationCalls = 0;
  `);
  await client.run(`runMutation('archive:12', async () => { mutationCalls += 1; }, 'Room archived')`);
  assert.equal(client.run('mutationCalls'), 1);
  assert.equal(client.run('state.dashboard.stats.active_rooms'), 2);
  assert.equal(client.run('state.stale'), false);
  assert.equal(client.run('state.pending.size'), 0);
  assert.equal(client.hooks.statuses.at(-1).message, 'Room archived');
});

test('disabled Reopen explains why while Open Group Chat remains enabled', () => {
  const client = managerHarness();
  client.run(`
    state.dashboard = {
      stats: {}, unclaimed_portfolios: [], rooms: [{
        conversation_id: 12,
        portfolio_id: 1,
        title: 'Solar Stack',
        status: 'archived',
        archived_reason: 'no_active_investors',
        unread_count: 0,
        owner: { id: 3, name: 'Charlie' },
        investors: [],
        eligible_interests: [{ id: 7, investor: { id: 8, name: 'Investor One' } }]
      }]
    };
    renderManagedRooms();
  `);
  const rendered = client.elements.get('managed-room-list').innerHTML;
  assert.match(rendered, /data-action="open"/);
  assert.doesNotMatch(rendered, /data-action="open"[^>]*disabled/);
  assert.match(rendered, /data-action="reopen"[^>]*[\s\S]*disabled/);
  assert.match(rendered, /aria-describedby="reopen-reason-12"/);
  assert.match(rendered, /Add an eligible investor/);
});

test('managed room distinguishes zero investors from an exhausted eligible list', () => {
  const client = managerHarness();

  client.run(`
    state.dashboard = {
      stats: {},
      unclaimed_portfolios: [],
      rooms: [{
        conversation_id: 12,
        portfolio_id: 1,
        title: 'Solar Stack',
        status: 'archived',
        archived_reason: 'no_active_investors',
        unread_count: 0,
        owner: { id: 3, name: 'Charlie' },
        investors: [],
        eligible_interests: []
      }]
    };
    renderManagedRooms();
  `);

  let rendered = client.elements.get('managed-room-list').innerHTML;
  assert.match(rendered, /No investors are currently interested\./);
  assert.doesNotMatch(
    rendered,
    /All currently interested investors are already in this room/,
  );

  client.run(`
    state.dashboard.rooms[0].investors = [{ id: 6, name: 'Investor One' }];
    renderManagedRooms();
  `);

  rendered = client.elements.get('managed-room-list').innerHTML;
  assert.match(
    rendered,
    /All currently interested investors are already in this room/,
  );
  assert.doesNotMatch(rendered, /No investors are currently interested\./);
});

test('Open Group Chat navigates only by conversation ID', () => {
  const source = readRequired(clientPath, 'relationship manager client');
  const sandbox = {
    window: { location: { href: '' } },
    document: { addEventListener() {} },
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: clientPath });
  sandbox.openGroupChat('12');
  assert.equal(sandbox.window.location.href, 'messages.html?conversationId=12');
  assert.match(source, /`messages\.html\?conversationId=\$\{conversationId\}`/);
  assert.doesNotMatch(source, /partnerId|receiver_id/);
});
