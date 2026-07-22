const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
const deployDir = path.join(backendDir, 'deploy');

const expectedRuntimeFiles = [
  'audit-logs.html',
  'browse.html',
  'businessownerdashboard.html',
  'createportfolio.html',
  'index.html',
  'investordashboard.html',
  'messages.html',
  'moderatordashboard.html',
  'my-interests.html',
  'mybusinesses.html',
  'signin.html',
  'signup.html',
  'css/style.css',
  'js/api.js',
  'js/audit-logs.js',
  'js/browse.js',
  'js/createportfolio.js',
  'js/investordashboard.js',
  'js/messages.js',
  'js/moderatordashboard.js',
  'js/my-interests.js',
  'js/mybusinesses.js',
  'js/script.js',
  'backend/server.js',
  'backend/package.json',
  'backend/package-lock.json',
  'backend/scripts/live-three-role-smoke.js',
  'backend/src/schema-contract.js',
  'backend/src/config/db.js',
  'backend/src/middleware/auth.js',
  'backend/src/middleware/upload.js',
  'backend/src/routes/admin.js',
  'backend/src/routes/auth.js',
  'backend/src/routes/dashboard.js',
  'backend/src/routes/interests.js',
  'backend/src/routes/messages.js',
  'backend/src/routes/notifications.js',
  'backend/src/routes/portfolios.js',
  'backend/src/routes/recommendations.js',
  'backend/src/services/workflow.js',
];

test('systemd unit runs the unified API on a private loopback port', () => {
  const service = fs.readFileSync(
    path.join(deployDir, 'lumilabs-backend.service'),
    'utf8'
  );

  assert.match(service, /^User=user$/m);
  assert.match(service, /^Group=www-data$/m);
  assert.match(service, /^WorkingDirectory=\/var\/www\/lumilabs-backend$/m);
  assert.match(
    service,
    /^EnvironmentFile=\/var\/www\/lumilabs-backend\/\.env$/m
  );
  assert.match(
    service,
    /^ExecStart=\/usr\/bin\/env HOST=127\.0\.0\.1 PORT=3100 \/opt\/lumilabs-messaging\/current\/bin\/node server\.js$/m
  );
  assert.doesNotMatch(service, /messages-server|3001/);
});

test('Apache proxies the complete API namespace to the private service', () => {
  const proxyConfig = fs.readFileSync(
    path.join(deployDir, 'apache-lumilabs-proxy.conf'),
    'utf8'
  );

  assert.match(
    proxyConfig,
    /^ProxyPass "\/api\/" "http:\/\/127\.0\.0\.1:3100\/api\/"$/m
  );
  assert.match(
    proxyConfig,
    /^ProxyPassReverse "\/api\/" "http:\/\/127\.0\.0\.1:3100\/api\/"$/m
  );
  assert.doesNotMatch(proxyConfig, /messages-server|3001|ProxyPassMatch/);
});

test('runtime manifest is the exact public deployment allowlist', () => {
  const manifest = fs.readFileSync(
    path.join(deployDir, 'runtime-manifest.txt'),
    'utf8'
  );
  const files = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  assert.deepEqual(files, expectedRuntimeFiles);
  assert.equal(new Set(files).size, files.length);

  for (const file of files) {
    assert.doesNotMatch(
      file,
      /(^|\/)(\.env|node_modules|test|deploy|docs|\.vscode|README(?:\.|$))/
    );
  }
});

test('production package does not depend on browser CORS middleware', () => {
  const packageJson = require('../package.json');
  assert.equal(packageJson.dependencies.cors, undefined);
});
