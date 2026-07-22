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
    'moderatordashboard.html', 'audit-logs.html',
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

test('browser JavaScript passes node syntax checking', () => {
  for (const name of fs.readdirSync(path.join(root, 'js')).filter((item) => item.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'js', name)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});
