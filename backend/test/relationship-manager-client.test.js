const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const htmlPath = path.join(root, 'relationshipmanagerdashboard.html');
const clientPath = path.join(root, 'js', 'relationshipmanagerdashboard.js');

function readRequired(file, label) {
  assert.equal(fs.existsSync(file), true, `${label} must exist`);
  return fs.readFileSync(file, 'utf8');
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

test('room mutations refresh and clear only successful selections', () => {
  const source = readRequired(clientPath, 'relationship manager client');
  assert.match(source, /state\.selectedCreateInterests\.delete\(portfolioId\)/);
  assert.match(source, /state\.selectedAddInterests\.delete\(conversationId\)/);
  assert.match(source, /await loadDashboard\(\)/);
  assert.match(source, /API\.archiveManagedConversation/);
  assert.match(source, /API\.reopenManagedConversation/);
  assert.match(source, /finally\s*\{[\s\S]*state\.pending\.delete/);
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
