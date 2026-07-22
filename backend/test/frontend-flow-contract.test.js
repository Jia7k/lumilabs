const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('every literal local html target exists', () => {
  for (const page of pages) {
    const source = read(page);
    const targets = [...source.matchAll(/(?:href=|location\.href\s*=\s*)["']([^"'?#]+\.html)/g)]
      .map((match) => match[1]);
    for (const target of targets) {
      assert.ok(fs.existsSync(path.join(root, target)), `${page} -> ${target}`);
    }
  }
});

test('visible navigation buttons have click behavior', () => {
  for (const page of pages) {
    const source = read(page);
    const buttons = [...source.matchAll(/<button\b[^>]*class=["'][^"']*nav-btn[^"']*["'][^>]*>/g)]
      .map((match) => match[0]);
    for (const button of buttons) {
      assert.match(button, /onclick=|id=/, `${page}: ${button}`);
    }
  }
});

test('all protected role pages provide sign out', () => {
  const protectedPages = [
    'businessownerdashboard.html', 'mybusinesses.html', 'createportfolio.html',
    'investordashboard.html', 'browse.html', 'my-interests.html', 'messages.html',
    'moderatordashboard.html', 'audit-logs.html', 'relationshipmanagerdashboard.html',
  ];
  for (const page of protectedPages) assert.match(read(page), /signOut|signout/i, page);
});

test('business dashboard escapes database strings before interpolation', () => {
  const source = read('businessownerdashboard.html');
  for (const expression of ['p.name', 'p.sector', 'i.investor', 'i.portfolio', 'n.title', 'n.body']) {
    assert.match(source, new RegExp(`escapeHtml\\(${expression.replace('.', '\\.')}\\)`), expression);
  }
});

test('investor message buttons include partner and portfolio context', () => {
  for (const file of ['js/browse.js', 'js/my-interests.js']) {
    const source = read(file);
    assert.match(source, /partnerId: portfolio\.owner_id/);
    assert.match(source, /portfolioId: portfolio\.id/);
  }
});

test('public registration exposes only owner and investor roles', () => {
  const registerRoute = read('backend/src/routes/auth.js').split('// POST /api/auth/login')[0];
  assert.match(registerRoute, /isIn\(\['business_owner', 'investor'\]\)/);
  assert.doesNotMatch(registerRoute, /isIn\([^\n]*relationship_manager/);
});

test('homepage offers four roles without public manager signup', () => {
  const html = read('index.html');
  assert.match(html, />Relationship Manager</);
  assert.match(
    html,
    /href="signin\.html"[^>]*>\s*Sign In as Relationship Manager/s,
  );
  assert.doesNotMatch(html, /signup\.html\?role=relationship_manager/);
  assert.doesNotMatch(html, /Direct messaging|Message investors/);
});

test('homepage role grid has explicit four, two, and one-column breakpoints', () => {
  const css = read('css/style.css');
  assert.match(css, /\.roles-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
  assert.match(css, /@media \(max-width:\s*1199px\)[\s\S]*?\.roles-grid\s*\{[^}]*repeat\(2,/);
  assert.match(css, /@media \(max-width:\s*699px\)[\s\S]*?\.roles-grid\s*\{[^}]*1fr/);
});

test('login maps relationship managers to their protected dashboard', () => {
  assert.match(
    read('js/script.js'),
    /relationship_manager:\s*\{\s*dashboard:\s*'relationshipmanagerdashboard\.html'/,
  );
});

test('administrator dashboard provisions managers with accessible recoverable form state', () => {
  const html = read('moderatordashboard.html');
  const client = read('js/moderatordashboard.js');
  for (const id of [
    'rm-name', 'rm-name-error', 'rm-email', 'rm-email-error',
    'rm-password', 'rm-password-error', 'rm-submit', 'rm-form-message',
    'rm-account-list',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`), id);
  assert.match(html, /Temporary password/);
  assert.match(html, /communicate it securely/i);
  assert.match(client, /Promise\.all/);
  assert.match(client, /API\.createRelationshipManager/);
  assert.match(client, /API\.getRelationshipManagers/);
  assert.match(client, /rmSubmit\.disabled\s*=\s*true/);
  assert.match(client, /escapeHtml\(manager\.name\)/);
  assert.match(client, /escapeHtml\(manager\.email\)/);
});

test('browser JavaScript passes node syntax checking', () => {
  for (const name of fs.readdirSync(path.join(root, 'js')).filter((item) => item.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'js', name)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});
