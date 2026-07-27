const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
const deployDir = path.join(backendDir, 'deploy');
const repositoryDir = path.join(backendDir, '..');

const expectedRuntimeFiles = [
  'about.html',
  'assignments.html',
  'audit-logs.html',
  'browse.html',
  'businessownerdashboard.html',
  'contact.html',
  'createportfolio.html',
  'index.html',
  'investordashboard.html',
  'messages.html',
  'moderatordashboard.html',
  'relationshipmanagerdashboard.html',
  'my-interests.html',
  'mybusinesses.html',
  'signin.html',
  'signup.html',
  'superadmindashboard.html',
  'css/style.css',
  'images/raveen.webp',
  'images/victor.webp',
  'js/api.js',
  'js/assignments.js',
  'js/audit-logs.js',
  'js/browse.js',
  'js/contact.js',
  'js/createportfolio.js',
  'js/investordashboard.js',
  'js/messages.js',
  'js/moderatordashboard.js',
  'js/my-interests.js',
  'js/mybusinesses.js',
  'js/relationshipmanagerdashboard.js',
  'js/script.js',
  'js/superadmindashboard.js',
  'backend/server.js',
  'backend/migrate.js',
  'backend/migrate-contact.js',
  'backend/package.json',
  'backend/package-lock.json',
  'backend/scripts/migrate-contact-submissions.js',
  'backend/scripts/migrate-five-role-workflow.js',
  'backend/scripts/seed-managed-chat.js',
  'backend/scripts/live-five-role-smoke.js',
  'backend/src/schema-contract.js',
  'backend/src/validation/database-boundaries.js',
  'backend/src/config/db.js',
  'backend/src/middleware/auth.js',
  'backend/src/middleware/upload.js',
  'backend/src/routes/admin.js',
  'backend/src/routes/auth.js',
  'backend/src/routes/contact.js',
  'backend/src/routes/dashboard.js',
  'backend/src/routes/interests.js',
  'backend/src/routes/messages.js',
  'backend/src/routes/notifications.js',
  'backend/src/routes/portfolios.js',
  'backend/src/routes/recommendations.js',
  'backend/src/routes/relationship-manager.js',
  'backend/src/routes/superadmin.js',
  'backend/src/services/contact-submission-workflow.js',
  'backend/src/services/document-workflow.js',
  'backend/src/services/group-message-workflow.js',
  'backend/src/services/managed-conversation-workflow.js',
  'backend/src/services/relationship-manager-read-model.js',
  'backend/src/services/staff-provisioning-workflow.js',
  'backend/src/services/superadmin-assignment-workflow.js',
  'backend/src/services/superadmin-read-model.js',
  'backend/src/services/workflow.js',
];

function readManifest() {
  return fs.readFileSync(
    path.join(deployDir, 'runtime-manifest.txt'),
    'utf8'
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveLocalRequire(fromFile, specifier) {
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  for (const resolved of [candidate, `${candidate}.js`, path.join(candidate, 'index.js')]) {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
}

function staticRequiresReachableFrom(entryRelativePath) {
  const pending = [path.resolve(repositoryDir, entryRelativePath)];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = fs.readFileSync(current, 'utf8');
    for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!match[1].startsWith('.')) continue;
      pending.push(resolveLocalRequire(current, match[1]));
    }
  }
  return [...visited]
    .map((file) => path.relative(repositoryDir, file).split(path.sep).join('/'))
    .sort();
}

function localPageReferences(pageRelativePath) {
  const source = fs.readFileSync(path.join(repositoryDir, pageRelativePath), 'utf8');
  const references = [];
  for (const match of source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const target = match[1].replace(/&amp;/g, '&');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
    const localPath = target.split(/[?#]/, 1)[0];
    if (!localPath) continue;
    references.push(
      path.posix.normalize(path.posix.join(path.posix.dirname(pageRelativePath), localPath))
    );
  }
  return references;
}

test('systemd unit runs the unified API on a private loopback port', () => {
  const service = fs.readFileSync(
    path.join(deployDir, 'lumilabs-backend.service'),
    'utf8'
  );

  assert.match(service, /^User=user$/m);
  assert.match(service, /^Group=user$/m);
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
  const files = readManifest();

  assert.deepEqual(files, expectedRuntimeFiles);
  assert.equal(new Set(files).size, files.length);

  for (const file of files) {
    assert.equal(path.posix.isAbsolute(file), false);
    assert.equal(path.posix.normalize(file), file);
    assert.equal(file.startsWith('../'), false);
    assert.doesNotMatch(
      file,
      /(^|\/)(\.env|node_modules|test|deploy|docs|\.vscode|README(?:\.|$))/
    );
    const absolute = path.join(repositoryDir, ...file.split('/'));
    assert.equal(fs.existsSync(absolute), true, `manifest file is missing: ${file}`);
    assert.equal(fs.statSync(absolute).isFile(), true, `manifest path is not a file: ${file}`);
  }
});

test('runtime manifest contains every local dependency reachable from the backend server', () => {
  const manifest = new Set(readManifest());
  for (const dependency of staticRequiresReachableFrom('backend/server.js')) {
    assert.ok(manifest.has(dependency), `missing runtime dependency: ${dependency}`);
  }
});

test('About and Contact local routes, assets and scripts are deployable', () => {
  const manifest = new Set(readManifest());
  for (const page of ['about.html', 'contact.html']) {
    assert.ok(manifest.has(page), `missing public page: ${page}`);
    for (const dependency of localPageReferences(page)) {
      assert.ok(
        manifest.has(dependency),
        `${page} references an undeployed local dependency: ${dependency}`
      );
      const absolute = path.join(repositoryDir, ...dependency.split('/'));
      assert.equal(
        fs.existsSync(absolute) && fs.statSync(absolute).isFile(),
        true,
        `${page} references a missing local file: ${dependency}`
      );
    }
  }
});

test('runtime manifest keeps operational release commands and excludes retired artifacts', () => {
  const manifest = new Set(readManifest());
  for (const required of [
    'backend/migrate.js',
    'backend/migrate-contact.js',
    'backend/scripts/migrate-contact-submissions.js',
    'backend/scripts/migrate-five-role-workflow.js',
    'backend/scripts/seed-managed-chat.js',
    'backend/scripts/live-five-role-smoke.js',
  ]) {
    assert.ok(manifest.has(required), `missing operational runtime file: ${required}`);
  }
  for (const forbidden of [
    'backend/scripts/live-four-role-smoke.js',
    'backend/scripts/migrate-managed-chat.js',
  ]) {
    assert.equal(manifest.has(forbidden), false);
  }
  for (const entry of [
    'backend/migrate.js',
    'backend/migrate-contact.js',
    'backend/scripts/seed-managed-chat.js',
    'backend/scripts/live-five-role-smoke.js',
  ]) {
    for (const dependency of staticRequiresReachableFrom(entry)) {
      assert.ok(manifest.has(dependency), `${entry} requires undeployed file: ${dependency}`);
    }
  }
});

test('package scripts expose only the final release entry points', () => {
  const scripts = require('../package.json').scripts;
  assert.deepEqual(scripts, {
    start: 'node server.js',
    dev: 'nodemon server.js',
    test: 'node --test test/*.test.js',
    'migrate:five-role-workflow': 'node migrate.js',
    'migrate:contact-submissions': 'node migrate-contact.js',
    'seed:managed-chat': 'node scripts/seed-managed-chat.js',
    'smoke:live': 'node scripts/live-five-role-smoke.js',
  });
});

test('focused Contact migration command executes and fails closed without credentials', () => {
  const script = require('../package.json').scripts['migrate:contact-submissions'];
  assert.equal(typeof script, 'string');
  const [runtime, entry, ...args] = script.split(/\s+/);
  assert.equal(runtime, 'node');

  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: backendDir,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      DB_USER: '',
      DB_PASSWORD: '',
      DB_NAME: '',
      SSH_HOST: '',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Contact migration failed: Missing migration environment variables: DB_USER, DB_PASSWORD, DB_NAME/
  );
  assert.doesNotMatch(result.stderr, /ECONN|connect|password@|access denied/i);
});

test('production package does not depend on browser CORS middleware', () => {
  const packageJson = require('../package.json');
  assert.equal(packageJson.dependencies.cors, undefined);
});
