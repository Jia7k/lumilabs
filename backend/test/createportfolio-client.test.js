const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'createportfolio.js'),
  'utf8',
);

function editorHarness() {
  const fields = new Map();
  const document = {
    getElementById(id) {
      if (!fields.has(id)) fields.set(id, { value: '', addEventListener() {} });
      return fields.get(id);
    },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({
    window: { location: { search: '', href: '' } },
    document,
    URLSearchParams,
    requirePageRole: async () => null,
    API: {},
    history: { replaceState() {} },
    alert() {},
    confirm() { return false; },
    console,
    Set,
  });
  vm.runInContext(source, context);
  return { context, fields, run: (code) => vm.runInContext(code, context) };
}

test('edit hydration preserves every numeric zero', () => {
  const editor = editorHarness();
  editor.context.populatePortfolioForm({
    name: 'Zero Labs', sector: 'Fintech', mvp_status: 'beta', description: '',
    funding_goal: 0, team_size: 0, founded_year: 0, monthly_revenue: 0,
    user_count: 0, growth_rate: 0, burn_rate: 0, runway_months: 0,
  });
  for (const id of [
    'f-funding_goal', 'f-team_size', 'f-founded_year', 'f-monthly_revenue',
    'f-user_count', 'f-growth_rate', 'f-burn_rate', 'f-runway_months',
  ]) assert.equal(editor.fields.get(id).value, '0', id);
});

test('payload serialization preserves integer and decimal zeroes', () => {
  const editor = editorHarness();
  const values = {
    'f-name': 'Zero Labs', 'f-sector': 'Fintech', 'f-mvp_status': 'beta',
    'f-funding_goal': '0', 'f-description': '', 'f-team_size': '0',
    'f-founded_year': '2000', 'f-location': '', 'f-website': '',
    'f-advisor_names': '', 'f-monthly_revenue': '0', 'f-user_count': '0',
    'f-growth_rate': '0', 'f-market_size': '', 'f-competitor_analysis': '',
    'f-burn_rate': '0', 'f-runway_months': '0',
  };
  for (const [id, value] of Object.entries(values)) editor.fields.set(id, { value });
  const payload = editor.run('buildPortfolioPayload()');
  for (const key of [
    'funding_goal', 'team_size', 'monthly_revenue', 'user_count',
    'growth_rate', 'burn_rate', 'runway_months',
  ]) assert.equal(payload[key], 0, key);
  assert.equal(payload.founded_year, 2000);
});

test('optional numeric parsers distinguish blank and invalid input from zero', () => {
  const editor = editorHarness();
  assert.equal(editor.run("parseIntegerOrNull('0')"), 0);
  assert.equal(editor.run("parseDecimalOrNull('0.00')"), 0);
  assert.equal(editor.run("parseIntegerOrNull('')"), null);
  assert.equal(editor.run("parseDecimalOrNull('not-a-number')"), null);
});
