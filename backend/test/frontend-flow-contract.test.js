const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..');
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function elementTag(source, id) {
  const match = source.match(
    new RegExp(`<(?:input|textarea|select)\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i'),
  );
  assert.ok(match, `missing form control ${id}`);
  return match[0];
}

function selectOptions(source, id) {
  const match = source.match(
    new RegExp(`<select\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i'),
  );
  assert.ok(match, `missing select ${id}`);
  return [...match[1].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((option) => option[1].replace(/<[^>]+>/g, '').trim());
}

function assertAttribute(tag, name, value = true) {
  if (value === true) {
    assert.match(tag, new RegExp(`\\b${name}(?:\\s|=|\\/?>)`, 'i'));
    return;
  }
  assert.match(tag, new RegExp(`\\b${name}=["']${String(value).replaceAll('.', '\\.')}["']`, 'i'));
}

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

test('business dashboard displays rejected portfolios in both status summaries', () => {
  const html = read('businessownerdashboard.html');
  const css = read('css/style.css');

  assert.match(
    html,
    /class=["']count-box rejected["'][\s\S]*?class=["']count-label["']>Rejected<[\s\S]*?id=["']count-rejected["']/,
  );
  assert.match(html, /data\.portfolios\.rejected\}\s+rejected/);
  assert.match(
    html,
    /getElementById\(["']count-rejected["']\)\.innerText\s*=\s*data\.portfolios\.rejected/,
  );
  assert.match(
    css,
    /\.count-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/s,
  );
  assert.match(css, /\.count-box\.rejected\s*\{[^}]*var\(--red-bg\)/s);
  assert.match(
    css,
    /\.count-box\.rejected \.count-(?:label|num)[\s\S]*var\(--red-text\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*720px\)[\s\S]*?\.count-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/,
  );
});

test('business dashboard normalizes database readiness before inline rendering', () => {
  const html = read('businessownerdashboard.html');
  assert.match(
    html,
    /const readinessScore\s*=\s*normalizeReadinessScore\(p\.readiness_score\)/,
  );
  assert.match(html, /Readiness:\s*\$\{readinessScore\}\/100/);
  assert.doesNotMatch(html, /Readiness:\s*\$\{Number\(p\.readiness_score\)/);
});

test('database-derived labels describe the actual result sets', () => {
  const audit = read('audit-logs.html');
  for (const label of [
    'Latest 100 actions',
    'Actions in latest 100',
    'Approved in latest 100',
    'Rejected in latest 100',
  ]) {
    assert.match(audit, new RegExp(`>${label}<`), label);
  }

  assert.match(read('moderatordashboard.html'), />Investor Interests</);
  assert.match(read('moderatordashboard.html'), />Relationship managers</);
  assert.match(
    read('messages.html'),
    /id=["']conversation-search["'][^>]*placeholder=["']Search conversations["']/,
  );
});

test('owner subpages keep Messages navigation without unwired badges', () => {
  for (const page of ['mybusinesses.html', 'createportfolio.html']) {
    const html = read(page);
    assert.match(html, /href='messages\.html'[^>]*>[\s\S]*?Messages/);
    assert.doesNotMatch(html, /id=["']nav-msg-badge["']/);
  }
});

test('owner and investor entry points use only server-provided managed chat state', () => {
  for (const file of [
    'businessownerdashboard.html', 'js/browse.js', 'js/my-interests.js',
    'js/mybusinesses.js', 'js/investordashboard.js',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /partnerId|receiver_id|Message owner|Message investor/);
    assert.match(source, /chat_state|messages\.html/);
  }
  assert.match(read('js/browse.js'), /Awaiting Relationship Manager/);
  assert.match(read('js/my-interests.js'), /Open Managed Chat/);
  assert.match(read('js/mybusinesses.js'), /View Archived Chat/);
});

test('public registration exposes only owner and investor roles', () => {
  const registerRoute = read('backend/src/routes/auth.js').split('// POST /api/auth/login')[0];
  assert.match(registerRoute, /isIn\(\['business_owner', 'investor'\]\)/);
  assert.doesNotMatch(registerRoute, /isIn\([^\n]*relationship_manager/);
});

test('signup and signin controls mirror user-column limits', () => {
  const signup = read('signup.html');
  const signin = read('signin.html');
  for (const [source, id, max] of [
    [signup, 'su-name', 100],
    [signup, 'su-email', 255],
    [signin, 'si-email', 255],
  ]) {
    const tag = elementTag(source, id);
    assertAttribute(tag, 'required');
    assertAttribute(tag, 'maxlength', max);
  }
});

test('portfolio editor and Browse expose the same canonical sector order', () => {
  const expected = [
    'SaaS',
    'Fintech',
    'Healthtech',
    'Edtech',
    'AI / ML',
    'Clean Energy',
    'E-commerce',
    'Logistics',
    'Other',
  ];
  assert.deepEqual(
    selectOptions(read('createportfolio.html'), 'f-sector').slice(1),
    expected,
  );
  assert.deepEqual(
    selectOptions(read('browse.html'), 'sector-filter').slice(1),
    expected,
  );
});

test('portfolio editor mirrors database-backed form limits', () => {
  const html = read('createportfolio.html');
  const constraints = {
    'f-name': { required: true, maxlength: 255 },
    'f-sector': { required: true },
    'f-mvp_status': { required: true },
    'f-funding_goal': {
      required: true,
      min: 0,
      max: '9999999999999.99',
      step: '0.01',
    },
    'f-description': { maxlength: 65535 },
    'f-team_size': { min: 0, max: 2147483647, step: 1 },
    'f-founded_year': { min: 1901, max: 2100, step: 1 },
    'f-location': { maxlength: 255 },
    'f-website': { maxlength: 500 },
    'f-advisor_names': { maxlength: 500 },
    'f-monthly_revenue': {
      min: 0,
      max: '9999999999999.99',
      step: '0.01',
    },
    'f-user_count': { min: 0, max: 2147483647, step: 1 },
    'f-growth_rate': { min: 0, max: '999.99', step: '0.01' },
    'f-market_size': { maxlength: 500 },
    'f-competitor_analysis': { maxlength: 65535 },
    'f-burn_rate': {
      min: 0,
      max: '9999999999999.99',
      step: '0.01',
    },
    'f-runway_months': { min: 0, max: 2147483647, step: 1 },
  };
  for (const [id, attributes] of Object.entries(constraints)) {
    const tag = elementTag(html, id);
    for (const [name, value] of Object.entries(attributes)) {
      assertAttribute(tag, name, value);
    }
  }
  assert.match(
    html,
    /Accepted: PDF, PPT, PPTX, DOC, and DOCX • Max size: 10MB/,
  );
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

test('administrator dashboard exposes recoverable sections and synchronized assets', () => {
  const html = read('moderatordashboard.html');
  const css = read('css/style.css');

  for (const id of [
    'moderation-status',
    'moderation-retry-btn',
    'manager-directory-status',
    'manager-directory-retry-btn',
    'reason-error',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }

  assert.match(
    html,
    /id=["']review-card["'][^>]*role=["']dialog["'][^>]*aria-modal=["']true["'][^>]*tabindex=["']-1["']/,
  );
  assert.match(css, /\.admin-retry-btn\[hidden\][^{]*\{[^}]*display:\s*none/s);
  assert.match(css, /\.admin-dashboard-status\.stale/);
  assert.match(css, /\.admin-row-state/);
  assert.match(css, /\.modal-error-state/);
});

test('administrator queue Review uses delegated data attributes without inline calls', () => {
  const client = read('js/moderatordashboard.js');
  assert.match(client, /data-portfolio-id=/);
  assert.match(client, /queue-list["']\)\.addEventListener\(["']click/);
  assert.doesNotMatch(client, /onclick=["']openReviewModal/);
});

test('every Tabler page uses the exact pinned dist stylesheet', () => {
  const expected = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.0.0/dist/tabler-icons.min.css';
  for (const page of pages.filter((name) => /ti ti-/.test(read(name)))) {
    const source = read(page);
    const urls = [...source.matchAll(/<link[^>]+href=["']([^"']*tabler-icons[^"']*)["']/g)]
      .map((match) => match[1]);
    assert.deepEqual(urls, [expected], page);
    assert.doesNotMatch(source, /@latest|@3\.0\.0\/tabler-icons\.min\.css/);
  }
});

test('changed shared-client pages use one coherent frontend release key', () => {
  const releaseKey = '20260723.5';
  const changedSharedClientPages = [
    'audit-logs.html',
    'browse.html',
    'businessownerdashboard.html',
    'createportfolio.html',
    'investordashboard.html',
    'messages.html',
    'moderatordashboard.html',
    'my-interests.html',
    'mybusinesses.html',
    'relationshipmanagerdashboard.html',
    'index.html',
    'signin.html',
    'signup.html',
  ];

  for (const page of changedSharedClientPages) {
    const source = read(page);
    const localAssets = [
      ...source.matchAll(/<link[^>]+href=["']((?:css)\/[^"']+)["']/g),
      ...source.matchAll(/<script[^>]+src=["']((?:js)\/[^"']+)["']/g),
    ].map((match) => match[1]);
    assert.ok(localAssets.length > 0, `${page}: no local assets found`);
    for (const asset of localAssets) {
      assert.match(asset, new RegExp(`\\?v=${releaseKey}$`), `${page}: ${asset}`);
    }
  }
});

test('browser JavaScript passes node syntax checking', () => {
  for (const name of fs.readdirSync(path.join(root, 'js')).filter((item) => item.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'js', name)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});
