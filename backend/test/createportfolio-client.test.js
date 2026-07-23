const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'createportfolio.js'),
  'utf8',
);

const BASE_VALUES = {
  'f-name': 'Exact Labs',
  'f-sector': 'Fintech',
  'f-mvp_status': 'Beta',
  'f-funding_goal': '1000.00',
  'f-description': 'A database-aligned portfolio.',
  'f-team_size': '5',
  'f-founded_year': '2024',
  'f-location': 'Singapore',
  'f-website': 'https://example.com',
  'f-advisor_names': 'Alex Example',
  'f-monthly_revenue': '5000.00',
  'f-user_count': '120',
  'f-growth_rate': '12.50',
  'f-market_size': 'Regional enterprise market',
  'f-competitor_analysis': 'Focused differentiation.',
  'f-burn_rate': '2000.00',
  'f-runway_months': '18',
};

function editorHarness() {
  const fields = new Map();
  const hooks = {
    alerts: [],
    created: [],
    focused: [],
    updated: [],
  };
  const document = {
    getElementById(id) {
      if (!fields.has(id)) {
        fields.set(id, {
          value: '',
          disabled: false,
          hidden: false,
          style: {},
          addEventListener() {},
          focus() {
            hooks.focused.push(id);
          },
          setAttribute() {},
        });
      }
      return fields.get(id);
    },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({
    window: { location: { search: '', href: '' } },
    document,
    URL,
    URLSearchParams,
    TextEncoder,
    requirePageRole: async () => null,
    API: {
      async createPortfolio(payload) {
        hooks.created.push(payload);
        return { id: 99 };
      },
      async updatePortfolio(id, payload) {
        hooks.updated.push({ id, payload });
        return {};
      },
    },
    history: { replaceState() {} },
    alert(message) { hooks.alerts.push(message); },
    confirm() { return false; },
    console,
    Set,
    normalizeReadinessScore(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return 0;
      if (typeof value === 'string' && value.trim() === '') return 0;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
    },
    hooks,
  });
  vm.runInContext(source, context);
  return {
    context,
    fields,
    hooks,
    run: (code) => vm.runInContext(code, context),
    setValues(values = BASE_VALUES) {
      for (const [id, value] of Object.entries(values)) {
        document.getElementById(id).value = value;
      }
    },
  };
}

function validationResult(editor, payload) {
  editor.context.candidatePayload = payload;
  return editor.run('validatePortfolioPayload(candidatePayload)');
}

function validPayload(overrides = {}) {
  return {
    name: 'Exact Labs',
    sector: 'Fintech',
    mvp_status: 'Beta',
    funding_goal: '1000.00',
    description: '',
    location: '',
    website: '',
    advisor_names: '',
    market_size: '',
    competitor_analysis: '',
    ...overrides,
  };
}

test('edit hydration preserves every numeric zero and canonical MVP casing', () => {
  const editor = editorHarness();
  editor.context.populatePortfolioForm({
    name: 'Zero Labs',
    sector: 'Fintech',
    mvp_status: 'Beta',
    description: '',
    funding_goal: 0,
    team_size: 0,
    founded_year: 0,
    monthly_revenue: 0,
    user_count: 0,
    growth_rate: 0,
    burn_rate: 0,
    runway_months: 0,
  });
  for (const id of [
    'f-funding_goal',
    'f-team_size',
    'f-founded_year',
    'f-monthly_revenue',
    'f-user_count',
    'f-growth_rate',
    'f-burn_rate',
    'f-runway_months',
  ]) {
    assert.equal(editor.fields.get(id).value, '0', id);
  }
  assert.equal(editor.fields.get('f-mvp_status').value, 'Beta');
});

test('observed production sectors hydrate and serialize unchanged', () => {
  const editor = editorHarness();
  for (const sector of [
    'AI / ML',
    'Edtech',
    'Fintech',
    'Healthtech',
    'Logistics',
  ]) {
    editor.context.populatePortfolioForm({
      ...Object.fromEntries(
        Object.keys(BASE_VALUES).map((id) => [id.slice(2), '']),
      ),
      name: 'Observed Sector',
      sector,
      mvp_status: 'Beta',
      funding_goal: '10.00',
    });
    assert.equal(editor.fields.get('f-sector').value, sector);
    assert.equal(editor.run('buildPortfolioPayload().sector'), sector);
  }
});

test('payload keeps exact decimal strings and omits blank optional numerics', () => {
  const editor = editorHarness();
  editor.setValues({
    ...BASE_VALUES,
    'f-funding_goal': '0.00',
    'f-team_size': '0',
    'f-founded_year': '',
    'f-monthly_revenue': '',
    'f-user_count': '0',
    'f-growth_rate': '',
    'f-burn_rate': '0.00',
    'f-runway_months': '',
  });

  const payload = editor.run('buildPortfolioPayload()');
  assert.equal(payload.funding_goal, '0.00');
  assert.equal(payload.team_size, '0');
  assert.equal(payload.user_count, '0');
  assert.equal(payload.burn_rate, '0.00');
  for (const key of [
    'founded_year',
    'monthly_revenue',
    'growth_rate',
    'runway_months',
  ]) {
    assert.equal(Object.hasOwn(payload, key), false, key);
  }
});

test('year, integer, decimal, enum, URL, and text byte boundaries are exact', () => {
  const editor = editorHarness();
  for (const year of ['1901', '2100']) {
    assert.equal(
      validationResult(editor, validPayload({ founded_year: year })).valid,
      true,
    );
  }
  assert.equal(
    validationResult(editor, validPayload({ founded_year: '1900' })).field,
    'f-founded_year',
  );
  assert.equal(
    validationResult(editor, validPayload({ founded_year: '2101' })).field,
    'f-founded_year',
  );
  assert.equal(
    validationResult(editor, validPayload({ team_size: '2147483648' })).field,
    'f-team_size',
  );
  assert.equal(
    validationResult(editor, validPayload({ team_size: '1.5' })).field,
    'f-team_size',
  );
  assert.equal(
    validationResult(editor, validPayload({
      funding_goal: '10000000000000.00',
    })).field,
    'f-funding_goal',
  );
  assert.equal(
    validationResult(editor, validPayload({ growth_rate: '0.001' })).field,
    'f-growth_rate',
  );
  assert.equal(
    validationResult(editor, validPayload({ sector: 'fintech' })).field,
    'f-sector',
  );
  assert.equal(
    validationResult(editor, validPayload({ mvp_status: 'beta' })).field,
    'f-mvp_status',
  );
  assert.equal(
    validationResult(editor, validPayload({ website: 'ftp://example.com' })).field,
    'f-website',
  );
  assert.equal(
    validationResult(editor, validPayload({
      description: `${'界'.repeat(21845)}a`,
    })).field,
    'f-description',
  );
  assert.equal(
    validationResult(editor, validPayload({
      competitor_analysis: '😀'.repeat(16384),
    })).field,
    'f-competitor_analysis',
  );
});

test('invalid input preserves every value, focuses its field, and sends no API call', async () => {
  const editor = editorHarness();
  const values = {
    ...BASE_VALUES,
    'f-growth_rate': '1000.00',
  };
  editor.setValues(values);

  await editor.run("submitForm('draft')");

  assert.equal(editor.hooks.created.length, 0);
  assert.equal(editor.hooks.updated.length, 0);
  assert.equal(editor.hooks.focused.at(-1), 'f-growth_rate');
  assert.match(editor.hooks.alerts.at(-1), /Growth Rate.*999\.99/i);
  for (const [id, value] of Object.entries(values)) {
    assert.equal(editor.fields.get(id).value, value, id);
  }
});

test('create and edit summary normalizes nullable and malformed readiness', () => {
  const editor = editorHarness();

  editor.run("renderPortfolioSummary('draft', null)");
  assert.match(editor.fields.get('page-sub').innerHTML, /Readiness 0\/100/);

  editor.run("renderPortfolioSummary('draft', [88])");
  assert.match(editor.fields.get('page-sub').innerHTML, /Readiness 0\/100/);
  assert.doesNotMatch(editor.fields.get('page-sub').innerHTML, /Readiness 88\/100/);
});
