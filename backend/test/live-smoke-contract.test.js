const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'live-three-role-smoke.js'),
  'utf8'
);

test('live smoke is explicitly targeted and self-cleaning', () => {
  assert.match(source, /LUMILABS_E2E_ORIGIN/);
  assert.match(source, /codex_e2e_/);
  assert.match(source, /finally/);
  assert.match(source, /DELETE FROM users WHERE email IN/);
  assert.doesNotMatch(source, /victor@lumilabs\.com|admin123|password\s*=/i);
});
