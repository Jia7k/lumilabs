const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const browserFiles = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.html')),
  ...fs.readdirSync(path.join(root, 'js')).map((name) => `js/${name}`),
];

test('browser files use only the same-origin API namespace', () => {
  for (const relative of browserFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(
      source,
      /https?:\/\/(?:localhost|127\.0\.0\.1)|\$\{protocol\}\/\/\$\{hostname\}:3000|35\.212\.144\.149:3000/,
      relative,
    );
  }

  assert.match(
    fs.readFileSync(path.join(root, 'js/api.js'), 'utf8'),
    /(?:window\.LUMILABS_API_BASE \|\| )?["']\/api["']/,
  );
  assert.match(
    fs.readFileSync(path.join(root, 'js/script.js'), 'utf8'),
    /(?:window\.LUMILABS_API_BASE \|\| )?["']\/api["']/,
  );
});
