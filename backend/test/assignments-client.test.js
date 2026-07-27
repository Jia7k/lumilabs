const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  assignmentsHarness,
  deferred,
  flush,
} = require('./helpers/assignments-harness');

const root = path.join(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assignedPortfolio(overrides = {}) {
  return {
    id: 20,
    name: 'Northstar Foods',
    status: 'approved',
    owner: { id: 4, name: 'Charlie Owner', email: 'charlie@example.test' },
    relationship_manager: {
      id: 7,
      name: 'Rita Manager',
      email: 'rita@example.test',
    },
    conversation: null,
    actions: {
      can_assign: false,
      assign_disabled_reason: null,
      can_reassign: true,
      reassign_disabled_reason: null,
      can_unassign: true,
      unassign_disabled_reason: null,
    },
    ...overrides,
  };
}

test('assignments verifies superadmin before any data request', async () => {
  const page = assignmentsHarness({ authenticatedRole: 'relationship_manager' });
  await page.initialize();
  assert.deepEqual(page.calls, ['getCurrentUser']);
  assert.equal(page.location.href, 'relationshipmanagerdashboard.html');
  assert.equal(page.element('assignments-main').hidden, true);
  assert.equal(page.element('protected-nav').hidden, true);
});

test('assignment auth recovery shows only the recovery main', async () => {
  const page = assignmentsHarness({
    getCurrentUser: async () => {
      throw new Error('network unavailable');
    },
  });
  await page.initialize();
  assert.deepEqual(page.calls, ['getCurrentUser']);
  assert.equal(page.element('protected-nav').hidden, true);
  assert.equal(page.element('assignments-main').hidden, false);
  assert.equal(page.element('protected-page-recovery').hidden, false);
});

test('assignment data renders escaped nested database strings', async () => {
  const hostile = '<svg onload=alert(1)>';
  const page = assignmentsHarness({
    getPortfolioAssignments: [{
      ...assignedPortfolio(),
      name: hostile,
      owner: { id: 4, name: hostile, email: 'owner@example.test' },
      relationship_manager: {
        id: 7,
        name: hostile,
        email: `${hostile}@example.test`,
      },
    }],
    getAssignableRelationshipManagers: [{
      id: 7,
      name: hostile,
      email: `${hostile}@example.test`,
    }],
  });
  await page.initialize();
  assert.doesNotMatch(page.element('assignment-rows').innerHTML, /<svg/i);
  assert.match(page.element('assignment-rows').innerHTML, /&lt;svg/);
  page.openAssignment(20);
  assert.doesNotMatch(page.element('assignment-manager').innerHTML, /<svg/i);
  assert.match(page.element('assignment-manager').innerHTML, /&lt;svg/);
});

test('assignment submit is single-flight and refreshes only after success', async () => {
  const mutation = deferred();
  const page = assignmentsHarness({
    assignPortfolioManager: () => mutation.promise,
  });
  await page.initialize();
  page.openAssignment(20);
  const first = page.submitManager(7);
  const second = page.submitManager(7);
  await flush();
  assert.deepEqual(page.methodCalls.assignPortfolioManager, [[20, 7]]);
  assert.equal(page.methodCalls.getPortfolioAssignments.length, 1);
  mutation.resolve({});
  await Promise.all([first, second]);
  assert.equal(page.methodCalls.getPortfolioAssignments.length, 2);
  assert.equal(page.element('assignment-dialog').hidden, true);
});

test('pending mutation locks every row action and cannot replace dialog context', async () => {
  const mutation = deferred();
  const page = assignmentsHarness({
    getPortfolioAssignments: [
      {
        id: 20,
        name: 'Northstar Foods',
        status: 'approved',
        owner: { id: 4, name: 'Charlie', email: 'charlie@example.test' },
        relationship_manager: null,
        conversation: null,
        actions: { can_assign: true, can_reassign: false, can_unassign: false },
      },
      {
        id: 21,
        name: 'Second Business',
        status: 'approved',
        owner: { id: 5, name: 'Delta', email: 'delta@example.test' },
        relationship_manager: null,
        conversation: null,
        actions: { can_assign: true, can_reassign: false, can_unassign: false },
      },
    ],
    assignPortfolioManager: () => mutation.promise,
  });
  await page.initialize();
  page.openAssignment(20);
  const pending = page.submitManager(7);
  await flush();
  page.openAssignment(21);
  assert.equal(page.run('assignmentState.dialogPortfolioId'), 20);
  assert.match(page.element('assignment-dialog-description').textContent, /Northstar/);
  const rowActions = page.element('assignment-rows').renderedActions;
  assert.ok(rowActions.length >= 2);
  assert.ok(rowActions.every((action) => action.disabled));
  mutation.resolve({});
  await pending;
});

test('409 keeps recoverable stale state and retry never replays mutation', async () => {
  const page = assignmentsHarness({ mutationStatus: 409 });
  await page.initialize();
  page.openAssignment(20);
  await page.submitManager(7);
  assert.match(page.element('assignment-dialog-status').textContent, /changed|refresh/i);
  assert.equal(page.element('assignment-dialog').hidden, false);
  assert.equal(page.element('assignment-retry').hidden, false);
  assert.equal(page.element('assignment-dialog-retry').hidden, false);
  await page.element('assignment-dialog-retry').dispatch('click');
  assert.equal(page.methodCalls.assignPortfolioManager.length, 1);
  assert.equal(page.methodCalls.getPortfolioAssignments.length, 2);
});

test('409 Retry reconciles an open assignment dialog with fresh server state', async () => {
  let loads = 0;
  const page = assignmentsHarness({
    mutationStatus: 409,
    getPortfolioAssignments: async () => {
      loads += 1;
      if (loads === 1) {
        return [{
          id: 20,
          name: 'Northstar Foods',
          status: 'approved',
          owner: { id: 4, name: 'Charlie', email: 'charlie@example.test' },
          relationship_manager: null,
          conversation: null,
          actions: { can_assign: true, can_reassign: false, can_unassign: false },
        }];
      }
      return [assignedPortfolio({
        relationship_manager: {
          id: 8,
          name: 'Morgan Manager',
          email: 'morgan@example.test',
        },
      })];
    },
    getAssignableRelationshipManagers: [
      { id: 7, name: 'Rita Manager', email: 'rita@example.test' },
      { id: 8, name: 'Morgan Manager', email: 'morgan@example.test' },
    ],
  });
  await page.initialize();
  page.openAssignment(20);
  await page.submitManager(7);
  await page.element('assignment-dialog-retry').dispatch('click');
  assert.equal(page.methodCalls.assignPortfolioManager.length, 1);
  assert.equal(page.element('assignment-dialog').hidden, false);
  assert.match(page.element('assignment-dialog-title').textContent, /reassign/i);
  assert.equal(page.element('assignment-manager').value, '8');
  assert.match(page.element('assignment-manager').innerHTML, /Morgan Manager/);
  assert.equal(page.element('assignment-submit').disabled, false);
});

test('409 Retry disables stale unassign confirmation when a chat now exists', async () => {
  let loads = 0;
  const page = assignmentsHarness({
    mutationStatus: 409,
    getPortfolioAssignments: async () => {
      loads += 1;
      if (loads === 1) return [assignedPortfolio()];
      return [assignedPortfolio({
        conversation: {
          id: 9,
          status: 'archived',
          archived_reason: 'portfolio_not_approved',
        },
        actions: {
          can_assign: false,
          assign_disabled_reason: null,
          can_reassign: true,
          reassign_disabled_reason: null,
          can_unassign: false,
          unassign_disabled_reason: 'Reassign required because this portfolio already has a chat',
        },
      })];
    },
  });
  await page.initialize();
  page.openUnassignment(20);
  await page.submitUnassignment();
  assert.equal(page.element('unassign-dialog-retry').hidden, false);
  await page.element('unassign-dialog-retry').dispatch('click');
  assert.equal(page.methodCalls.unassignPortfolioManager.length, 1);
  assert.equal(page.element('unassign-dialog').hidden, false);
  assert.equal(page.element('unassign-submit').disabled, true);
  assert.match(page.element('unassign-dialog-status').textContent, /reassign required/i);
});

test('same-manager selection is rejected locally', async () => {
  const page = assignmentsHarness({
    getPortfolioAssignments: [assignedPortfolio()],
  });
  await page.initialize();
  page.openAssignment(20);
  await page.submitManager(7);
  assert.equal(page.methodCalls.assignPortfolioManager.length, 0);
  assert.match(page.element('assignment-dialog-status').textContent, /already assigned/i);
  assert.equal(page.element('assignment-dialog').hidden, false);
});

test('malformed delegated dataset identifiers perform no action', async () => {
  const page = assignmentsHarness();
  await page.initialize();
  const target = page.element('malformed-action');
  target.dataset.assignmentAction = 'assign';
  target.dataset.portfolioId = '20junk';
  await page.element('assignment-rows').dispatch('click', { target });
  assert.equal(page.element('assignment-dialog').hidden, true);
  assert.equal(page.methodCalls.assignPortfolioManager.length, 0);
});

test('dialog rerender restores focus to the newly rendered equivalent action', async () => {
  const page = assignmentsHarness();
  await page.initialize();
  const original = page.document.querySelector(
    '[data-assignment-action="assign"][data-portfolio-id="20"]',
  );
  assert.ok(original?.isConnected);
  page.document.activeElement = original;
  page.openAssignment(20);
  page.run('renderAssignmentRows()');
  assert.equal(original.isConnected, false);
  page.closeAssignment();
  const replacement = page.document.querySelector(
    '[data-assignment-action="assign"][data-portfolio-id="20"]',
  );
  assert.ok(replacement?.isConnected);
  assert.notEqual(replacement, original);
  assert.equal(page.document.activeElement, replacement);
});

test('successful mutation refetch leaves focus on a connected portfolio action', async () => {
  let loads = 0;
  const page = assignmentsHarness({
    getPortfolioAssignments: async () => {
      loads += 1;
      return loads === 1
        ? [{
          id: 20,
          name: 'Northstar Foods',
          status: 'approved',
          owner: { id: 4, name: 'Charlie', email: 'charlie@example.test' },
          relationship_manager: null,
          conversation: null,
          actions: { can_assign: true, can_reassign: false, can_unassign: false },
        }]
        : [assignedPortfolio()];
    },
  });
  await page.initialize();
  const original = page.document.querySelector(
    '[data-assignment-action="assign"][data-portfolio-id="20"]',
  );
  page.document.activeElement = original;
  page.openAssignment(20);
  await page.submitManager(7);
  const focused = page.document.activeElement;
  assert.equal(focused?.isConnected, true);
  assert.equal(focused?.dataset.portfolioId, '20');
  assert.equal(focused?.dataset.assignmentAction, 'reassign');
});

test('open dialog makes only the background inert and traps Tab focus', async () => {
  const page = assignmentsHarness();
  await page.initialize();
  const invoker = page.document.querySelector(
    '[data-assignment-action="assign"][data-portfolio-id="20"]',
  );
  page.document.activeElement = invoker;
  page.openAssignment(20);
  assert.equal(page.element('protected-nav').inert, true);
  assert.equal(page.element('assignments-main').inert, true);
  assert.equal(page.element('assignment-dialog').inert, false);
  assert.equal(page.element('protected-nav').getAttribute('aria-hidden'), 'true');
  page.document.activeElement = page.element('assignment-submit');
  let prevented = false;
  await page.document.dispatch('keydown', {
    key: 'Tab',
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(page.document.activeElement, page.element('assignment-manager'));
  await page.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(page.element('assignment-dialog').hidden, true);
  assert.equal(page.element('protected-nav').inert, false);
  assert.equal(page.element('assignments-main').inert, false);
  assert.equal(page.document.activeElement, invoker);
});

test('pending mutation contains focus in the dialog and isolates the skip link', async () => {
  const mutation = deferred();
  const page = assignmentsHarness({
    assignPortfolioManager: () => mutation.promise,
  });
  await page.initialize();
  const invoker = page.document.querySelector(
    '[data-assignment-action="assign"][data-portfolio-id="20"]',
  );
  page.document.activeElement = invoker;
  page.openAssignment(20);

  const skipLink = page.element('protected-skip-link');
  assert.equal(skipLink.inert, true);
  assert.equal(skipLink.getAttribute('aria-hidden'), 'true');

  page.document.activeElement = page.element('assignment-submit');
  const pending = page.submitManager(7);
  await flush();

  const dialogCard = page.element('assignment-dialog-card');
  assert.equal(dialogCard.getAttribute('role'), 'document');
  assert.equal(dialogCard.getAttribute('tabindex'), '-1');
  assert.equal(page.document.activeElement, dialogCard);

  let prevented = false;
  await page.document.dispatch('keydown', {
    key: 'Tab',
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(page.document.activeElement, dialogCard);

  mutation.resolve({});
  await pending;
  assert.equal(skipLink.inert, false);
  assert.equal(skipLink.getAttribute('aria-hidden'), null);
  assert.equal(page.document.activeElement?.isConnected, true);
  assert.equal(page.document.activeElement?.dataset.portfolioId, '20');
});

test('unassign requires a separate explicit confirmation before DELETE', async () => {
  const page = assignmentsHarness({
    getPortfolioAssignments: [assignedPortfolio()],
  });
  await page.initialize();
  page.openUnassignment(20);
  assert.equal(page.element('unassign-dialog').hidden, false);
  assert.equal(page.methodCalls.unassignPortfolioManager.length, 0);
  await page.submitUnassignment();
  assert.deepEqual(page.methodCalls.unassignPortfolioManager, [[20]]);
  assert.equal(page.element('unassign-dialog').hidden, true);
  assert.equal(page.methodCalls.getPortfolioAssignments.length, 2);
});

test('server action reasons remain visible beside disabled buttons', async () => {
  const page = assignmentsHarness({
    getPortfolioAssignments: [assignedPortfolio({
      status: 'rejected',
      conversation: {
        id: 9,
        status: 'archived',
        archived_reason: 'portfolio_not_approved',
      },
      actions: {
        can_assign: false,
        assign_disabled_reason: 'Portfolio must be approved before assignment',
        can_reassign: false,
        reassign_disabled_reason: 'Portfolio must be approved before reassignment',
        can_unassign: false,
        unassign_disabled_reason: 'Reassign required because this portfolio already has a chat',
      },
    })],
  });
  await page.initialize();
  const rows = page.element('assignment-rows').innerHTML;
  assert.match(rows, /disabled/);
  assert.match(rows, /Portfolio must be approved before reassignment/);
  assert.match(rows, /Reassign required because this portfolio already has a chat/);
  assert.match(rows, /action-disabled-reason/);
});

test('assignment workspace uses delegated actions and accessible protected dialogs', () => {
  const html = read('assignments.html');
  const client = read('js/assignments.js');
  assert.match(html, /<body class=["'][^"']*\bprotected-page\b/);
  assert.match(html, /id=["']assignments-main["'][^>]*\bhidden\b/);
  assert.match(html, /class=["'][^"']*\btable-scroll\b[^"']*["'][^>]*tabindex=["']0["']/);
  assert.match(html, /aria-label=["']Portfolio assignments["']/);
  assert.match(html, /id=["']assignment-dialog["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["']/);
  assert.match(html, /id=["']unassign-dialog["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["']/);
  assert.match(
    html,
    /id=["']assignment-dialog["'][^>]*aria-describedby=["']assignment-dialog-description["']/,
  );
  assert.match(
    html,
    /id=["']unassign-dialog["'][^>]*aria-describedby=["']unassign-dialog-description["']/,
  );
  assert.match(html, /id=["']assignment-status["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/);
  assert.match(
    client,
    /assignment-rows["']\)[\s\S]{0,100}\.addEventListener\(\s*["']click/,
  );
  assert.doesNotMatch(client, /onclick=["'](?:open|assign|unassign)/);
});

test('assignment workspace pins assets and keeps mobile overflow inside the table', () => {
  const html = read('assignments.html');
  const css = read('css/style.css');
  assert.match(
    html,
    /https:\/\/cdn\.jsdelivr\.net\/npm\/@tabler\/icons-webfont@3\.0\.0\/dist\/tabler-icons\.min\.css/,
  );
  for (const asset of [
    'css/style.css?v=20260728.2',
    'js/api.js?v=20260728.2',
    'js/assignments.js?v=20260728.2',
  ]) assert.match(html, new RegExp(escapeRegex(asset)));
  assert.match(css, /\.table-scroll\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.assignment-dialog-card\s*\{[^}]*max-height:\s*(?:calc\()?[^;}]*100(?:d?vh)/s);
  assert.match(css, /\.action-disabled-reason\s*\{[^}]*max-width:\s*28ch/s);
  assert.match(
    css,
    /@media \(max-width:\s*390px\)[\s\S]*?\.superadmin-grid,[\s\S]*?\.staff-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
});
