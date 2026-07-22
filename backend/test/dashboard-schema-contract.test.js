const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'dashboard.js'),
  'utf8',
);

test('admin dashboard reads the canonical audit reason field', () => {
  assert.match(source, /al\.reason/);
  assert.doesNotMatch(source, /al\.notes/);
});
