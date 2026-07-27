const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html'));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function businessDashboardChatAction(interest) {
  const html = read('businessownerdashboard.html');
  const inlineScript = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .at(-1)?.[1];
  assert.ok(inlineScript, 'missing business dashboard inline client');
  const elements = new Map();
  const context = vm.createContext({
    window: { location: { href: '' } },
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            addEventListener() {},
            classList: { toggle() { return false; }, remove() {} },
            style: {},
          });
        }
        return elements.get(id);
      },
      addEventListener() {},
    },
    requirePageRole: async () => null,
    API: {},
    normalizeReadinessScore: () => 0,
    alert() {},
    console,
  });
  vm.runInContext(inlineScript, context);
  context.interestFixture = interest;
  return vm.runInContext('managedChatAction(interestFixture)', context);
}

function visibleText(markup) {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

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
  assert.doesNotMatch(read('moderatordashboard.html'), /id=["']rm-account-form["']/);
  assert.doesNotMatch(
    read('js/moderatordashboard.js'),
    /createRelationshipManager|getRelationshipManagers/,
  );
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
  assert.match(read('js/my-interests.js'), /Open Managed Chat/);
  assert.match(read('js/mybusinesses.js'), /View Archived Chat/);

  const unassigned = businessDashboardChatAction({
    portfolio: 'Northstar',
    relationship_manager_id: null,
    conversation_id: null,
    chat_state: 'awaiting_manager',
  });
  assert.equal(
    visibleText(unassigned),
    'Awaiting relationship manager assignment',
  );
  assert.doesNotMatch(unassigned, /title=/);

  const assigned = businessDashboardChatAction({
    portfolio: 'Northstar',
    relationship_manager_id: 8,
    conversation_id: null,
    chat_state: 'awaiting_manager',
  });
  assert.equal(
    visibleText(assigned),
    'Awaiting relationship manager to create group chat',
  );
  assert.doesNotMatch(assigned, /title=/);
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

test('homepage exposes only the two public audience journeys', () => {
  const html = read('index.html');
  const nav = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0];

  assert.ok(nav, 'missing homepage navigation');
  assert.doesNotMatch(
    html,
    /Relationship Manager|Administrator|Superadmin/i,
  );
  assert.doesNotMatch(
    html,
    /signin\.html\?role=(?:relationship_manager|admin|superadmin)/i,
  );
  assert.doesNotMatch(nav, /How it works/i);

  assert.match(nav, /href=["']signin\.html["'][^>]*>\s*Sign in\s*</i);
  assert.match(nav, /href=["']signup\.html["'][^>]*>\s*Sign up\s*</i);
  assert.match(
    html,
    /href=["']signup\.html\?role=business_owner["'][^>]*>\s*Raise capital/i,
  );
  assert.match(
    html,
    /href=["']signup\.html\?role=business_owner["'][^>]*>\s*Start raising/i,
  );
  assert.match(
    html,
    /href=["']signup\.html\?role=investor["'][^>]*>\s*Explore opportunities/i,
  );
  assert.match(
    html,
    /href=["']signup\.html\?role=investor["'][^>]*>\s*Start exploring/i,
  );
});

test('homepage contains the approved semantic content and orbit description', () => {
  const html = read('index.html');

  assert.match(html, /<body class=["']landing-page["']/i);
  assert.equal([...html.matchAll(/<h1\b/gi)].length, 1);
  assert.match(html, /<main\b[^>]*>/i);
  assert.match(html, /<footer\b[^>]*>/i);
  assert.match(html, /Funding,\s*found[\s\S]*with focus\./i);
  assert.match(html, /One platform,\s*two ambitions/i);
  assert.match(html, /A clearer path to the right connection/i);
  assert.match(html, /Find your next meaningful connection\./i);
  assert.match(
    html,
    /role=["']img["'][^>]*aria-label=["']Lumi5 Labs connects businesses and investors around shared sector, stage, geography, and capital priorities\.["']/i,
  );
  assert.match(html, /<script src=["']js\/script\.js\?v=20260727\.1["']/i);
});

test('homepage styles are scoped and follow the approved breakpoints', () => {
  const css = read('css/style.css');

  assert.match(
    css,
    /body\.landing-page\s*\{[^}]*overflow-x:\s*hidden/s,
  );
  assert.match(
    css,
    /\.landing-page \.landing-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.05fr\)\s+minmax\(280px,\s*0\.95fr\)/s,
  );
  assert.match(
    css,
    /\.landing-page \.landing-orbit-card\s*\{[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    css,
    /@media \(max-width:\s*899px\)[\s\S]*?\.landing-page \.landing-hero\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*899px\)[\s\S]*?\.landing-page \.landing-audience-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*599px\)[\s\S]*?\.landing-page \.landing-trust-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*599px\)[\s\S]*?\.landing-page \.landing-steps-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /\.landing-page [^{]*:focus-visible\s*\{[^}]*outline:/s,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.landing-page \*,\s*\.landing-page \*::before,\s*\.landing-page \*::after\s*\{[^}]*animation-duration:\s*0\.01ms\s*!important;[^}]*transition-duration:\s*0\.01ms\s*!important;/,
  );
});

test('homepage accessibility styles preserve contrast and touch targets', () => {
  const css = read('css/style.css');

  assert.match(
    css,
    /\.landing-page \.landing-brand\s*\{[^}]*min-height:\s*44px/s,
  );
  assert.match(
    css,
    /\.landing-page \.landing-audience-card a\s*\{[^}]*min-height:\s*44px/s,
  );
  assert.match(
    css,
    /\.landing-page [^{]*:focus-visible\s*\{[^}]*outline:\s*3px solid #1F2A44;[^}]*box-shadow:\s*0 0 0 6px #FFFFFF;/s,
  );

  for (const selector of [
    '\\.landing-support',
    '\\.landing-section-heading > p:last-child',
    '\\.landing-audience-card p',
    '\\.landing-steps-grid p',
    '\\.landing-footer',
  ]) {
    assert.match(
      css,
      new RegExp(`\\.landing-page ${selector}\\s*\\{[^}]*color:\\s*#5F687A`, 's'),
    );
  }

  assert.match(
    css,
    /\.landing-page \.landing-final-cta p\s*\{[^}]*color:\s*#FFFFFF/s,
  );
  assert.match(
    css,
    /\.landing-page \.landing-final-cta\s*\{[^}]*rgba\(255,\s*255,\s*255,\s*0\.10\)[^}]*linear-gradient\(135deg,\s*#4346B8,\s*#5749C2\)/s,
  );
});

test('shared hidden attribute always overrides component display rules', () => {
  assert.match(read('css/style.css'), /\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s);
});

test('login maps all five server-returned roles while public registration stays limited', () => {
  const client = read('js/script.js');
  for (const [role, dashboard] of Object.entries({
    business_owner: 'businessownerdashboard.html',
    investor: 'investordashboard.html',
    relationship_manager: 'relationshipmanagerdashboard.html',
    admin: 'moderatordashboard.html',
    superadmin: 'superadmindashboard.html',
  })) {
    assert.match(
      client,
      new RegExp(`${role}:\\s*\\{\\s*dashboard:\\s*'${dashboard.replace('.', '\\.')}'`),
    );
  }
  assert.match(
    client,
    /const PUBLIC_REGISTRATION_ROLES\s*=\s*new Set\(\['business_owner',\s*'investor'\]\)/,
  );
  assert.match(client, /const mapped\s*=\s*saveSession\(token,\s*user\)/);
  assert.doesNotMatch(client, /saveSession\(token,\s*\{[^}]*role:\s*(?:requestedRole|selectedRole)/s);
});

test('portfolio editor guards its optional account menu before binding it', () => {
  const client = read('js/createportfolio.js');
  assert.match(client, /const menu\s*=\s*document\.getElementById\(["']role-menu["']\)/);
  assert.match(client, /if\s*\(\s*!?menu[\s\S]*?button\.addEventListener/);
});

test('administrator dashboard is moderation-only with accessible recovery state', () => {
  const html = read('moderatordashboard.html');
  const client = read('js/moderatordashboard.js');
  assert.match(html, /id=["']queue-list["']/);
  assert.match(html, /View Audit Logs/);
  assert.match(client, /API\.getStats\(\)/);
  assert.match(client, /API\.getQueue\(\)/);
  assert.doesNotMatch(html, /rm-account-form|rm-account-list|Temporary password/);
  assert.doesNotMatch(client, /createRelationshipManager|getRelationshipManagers/);
});

test('administrator dashboard exposes recoverable sections and synchronized assets', () => {
  const html = read('moderatordashboard.html');
  const css = read('css/style.css');

  for (const id of [
    'moderation-status',
    'moderation-retry-btn',
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
  const releaseKey = '20260727.1';
  const changedSharedClientPages = [
    'audit-logs.html',
    'assignments.html',
    'browse.html',
    'businessownerdashboard.html',
    'createportfolio.html',
    'investordashboard.html',
    'messages.html',
    'moderatordashboard.html',
    'my-interests.html',
    'mybusinesses.html',
    'relationshipmanagerdashboard.html',
    'superadmindashboard.html',
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
  assert.match(
    read('js/messages.js'),
    new RegExp(`MESSAGES_API_SCRIPT_SRC\\s*=\\s*['"]js/api\\.js\\?v=${releaseKey}['"]`),
  );
});

test('Assignments is an actionable current section in the superadmin navigation', () => {
  const html = read('assignments.html');
  assert.match(
    html,
    /class=["'][^"']*\bnav-btn\b[^"']*\bactive\b[^"']*["'][^>]*>[\s\S]*?Assignments/,
  );
  assert.match(html, /aria-current=["']page["']/);
});

test('browser JavaScript passes node syntax checking', () => {
  for (const name of fs.readdirSync(path.join(root, 'js')).filter((item) => item.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, 'js', name)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('shared protected pages collapse without widening the document', () => {
  const css = read('css/style.css');
  for (const page of [
    'businessownerdashboard.html',
    'mybusinesses.html',
    'createportfolio.html',
    'moderatordashboard.html',
    'audit-logs.html',
  ]) {
    assert.match(read(page), /<body class=["'][^"']*\bprotected-page\b/);
  }
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(
    css,
    /@media \(max-width:\s*900px\)[\s\S]*?body\.protected-page \.stats-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*699px\)[\s\S]*?\.protected-page \.nav\s*\{[^}]*flex-wrap:\s*wrap/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*699px\)[\s\S]*?body\.protected-page \.stats-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*699px\)[\s\S]*?\.protected-page \.content-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*699px\)[\s\S]*?\.protected-page \.pf-form-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
});

test('administrator data tables scroll inside their cards on narrow screens', () => {
  for (const page of ['moderatordashboard.html', 'audit-logs.html']) {
    assert.match(
      read(page),
      /<div class=["']table-scroll["']>[\s\S]*?<table class=["']table["'][\s\S]*?<\/table>[\s\S]*?<\/div>/,
      page,
    );
  }
});

test('standalone investor pages define narrow-screen layout contracts', () => {
  const dashboard = read('investordashboard.html');
  const browse = read('browse.html');
  const interests = read('my-interests.html');
  for (const [page, source] of [
    ['investordashboard.html', dashboard],
    ['browse.html', browse],
    ['my-interests.html', interests],
  ]) {
    assert.match(source, /@media \(max-width:\s*699px\)/, page);
    assert.match(
      source,
      /@media \(max-width:\s*699px\)[\s\S]*?\.nav\s*\{[^}]*flex-wrap:\s*wrap/,
      page,
    );
    assert.match(
      source,
      /@media \(max-width:\s*699px\)[\s\S]*?\.nav-links\s*\{[^}]*overflow-x:\s*auto/,
      page,
    );
  }
  assert.match(
    dashboard,
    /@media \(max-width:\s*699px\)[\s\S]*?\.stats-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    browse,
    /@media \(max-width:\s*699px\)[\s\S]*?\.filter-input\s*\{[^}]*min-width:\s*0/,
  );
  assert.match(
    interests,
    /@media \(max-width:\s*699px\)[\s\S]*?\.interest-card\s*\{[^}]*flex-direction:\s*column/,
  );
});

test('authentication pages expose the Connected Horizon shell accessibly', () => {
  const cases = [
    {
      file: 'signin.html',
      bodyClass: 'signin-page',
      formId: 'signin-form',
      messageId: 'signin-message',
      fields: [
        ['si-email', 'si-email-error'],
        ['si-password', 'si-password-error'],
      ],
    },
    {
      file: 'signup.html',
      bodyClass: 'signup-page',
      formId: 'signup-form',
      messageId: 'signup-message',
      fields: [
        ['su-name', 'su-name-error'],
        ['su-email', 'su-email-error'],
        ['su-password', 'su-password-error'],
        ['su-confirm-password', 'su-confirm-password-error'],
      ],
    },
  ];

  for (const page of cases) {
    const html = read(page.file);
    assert.match(
      html,
      new RegExp(`<body[^>]*class=["'][^"']*auth-shell-page[^"']*${page.bodyClass}[^"']*["']`),
      page.file,
    );
    assert.match(html, /class=["'][^"']*auth-shell[^"']*["']/);
    assert.match(html, /class=["'][^"']*auth-story[^"']*["']/);
    assert.match(html, /class=["'][^"']*auth-form-panel[^"']*["']/);
    assert.match(html, new RegExp(`<form[^>]*id=["']${page.formId}["'][^>]*novalidate`));
    assert.match(
      html,
      new RegExp(`id=["']${page.messageId}["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']`),
    );
    assert.doesNotMatch(html, /<nav\b/i, `${page.file} must not retain the old shared nav`);

    for (const [fieldId, errorId] of page.fields) {
      assertAttribute(elementTag(html, fieldId), 'aria-describedby', errorId);
    }
  }

  const signup = read('signup.html');
  const roleButtons = [...signup.matchAll(
    /<button\b[^>]*class=["'][^"']*role-toggle-btn[^"']*["'][^>]*>/gi,
  )].map((match) => match[0]);
  assert.equal(roleButtons.length, 2);
  assertAttribute(roleButtons[0], 'aria-pressed', 'true');
  assertAttribute(roleButtons[1], 'aria-pressed', 'false');
});
