const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const browserFiles = [
  ...fs.readdirSync(root).filter((name) => name.endsWith('.html')),
  ...fs.readdirSync(path.join(root, 'js')).map((name) => `js/${name}`),
];
const localHostname = ['local', 'host'].join('');
const loopbackHostname = ['127', '0', '0', '1'].join('.');
const publicHostname = ['35', '212', '144', '149'].join('.');
const forbiddenOriginFragments = [
  `http://${localHostname}`,
  `https://${localHostname}`,
  `http://${loopbackHostname}`,
  `https://${loopbackHostname}`,
  ['${protocol}//${hostname}', '3000'].join(':'),
  [`http://${publicHostname}`, '3000'].join(':'),
  [`https://${publicHostname}`, '3000'].join(':'),
];

test('browser files use only the same-origin API namespace', () => {
  for (const relative of browserFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const fragment of forbiddenOriginFragments) {
      assert.equal(source.includes(fragment), false, `${relative}: ${fragment}`);
    }
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

test('relationship-manager clients use same-origin API helper paths', () => {
  const source = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
  for (const route of [
    '/admin/relationship-managers',
    '/relationship-manager/dashboard',
    '/relationship-manager/conversations',
  ]) assert.match(source, new RegExp(route.replaceAll('/', '\\/')));
  assert.doesNotMatch(source, /https?:\/\//);
});
