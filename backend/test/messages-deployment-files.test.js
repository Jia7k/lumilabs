const test = require('node:test');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
const deployDir = path.join(backendDir, 'deploy');
const repositoryDir = path.join(backendDir, '..');
const MAX_DEPENDENCY_SOURCE_BYTES = 1024 * 1024;
const MAX_DEPENDENCY_NODES = 200000;

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

function moduleSpecifierValue(node, sourceLabel) {
  if (node?.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  if (
    node?.type === 'TemplateLiteral'
    && node.expressions.length === 0
    && node.quasis.length === 1
    && typeof node.quasis[0].value.cooked === 'string'
  ) {
    return node.quasis[0].value.cooked;
  }
  throw new Error(`nonliteral module load in ${sourceLabel}`);
}

function literalModuleSpecifiers(source, sourceLabel = '<source>') {
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > MAX_DEPENDENCY_SOURCE_BYTES) {
    throw new Error(
      `dependency source exceeds ${MAX_DEPENDENCY_SOURCE_BYTES} bytes: ${sourceLabel}`
    );
  }

  let ast;
  try {
    ast = acorn.parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  } catch (error) {
    throw new Error(`cannot parse dependency source ${sourceLabel}: ${error.message}`);
  }

  const dependencies = [];
  let visitedNodes = 0;
  walk.full(ast, (node) => {
    visitedNodes += 1;
    if (visitedNodes > MAX_DEPENDENCY_NODES) {
      throw new Error(`dependency source has too many AST nodes: ${sourceLabel}`);
    }

    let sourceNode;
    if (
      node.type === 'ImportDeclaration'
      || node.type === 'ExportAllDeclaration'
      || (node.type === 'ExportNamedDeclaration' && node.source)
    ) {
      sourceNode = node.source;
    } else if (node.type === 'ImportExpression') {
      sourceNode = node.source;
    } else if (
      node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === 'require'
    ) {
      if (node.arguments.length !== 1) {
        throw new Error(`nonliteral module load in ${sourceLabel}`);
      }
      [sourceNode] = node.arguments;
    }

    if (sourceNode) {
      dependencies.push({
        start: node.start,
        specifier: moduleSpecifierValue(sourceNode, sourceLabel),
      });
    }
  });

  return dependencies
    .sort((left, right) => left.start - right.start)
    .map(({ specifier }) => specifier);
}

function staticRequiresReachableFrom(entryRelativePath) {
  const pending = [path.resolve(repositoryDir, entryRelativePath)];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = fs.readFileSync(current, 'utf8');
    const relativeCurrent = path.relative(repositoryDir, current).split(path.sep).join('/');
    for (const specifier of literalModuleSpecifiers(source, relativeCurrent)) {
      if (!specifier.startsWith('.')) continue;
      pending.push(resolveLocalRequire(current, specifier));
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

function assertRuntimeFileSafe(file, root = repositoryDir) {
  assert.equal(path.posix.isAbsolute(file), false);
  assert.equal(path.posix.normalize(file), file);
  assert.equal(file.startsWith('../'), false);
  const segments = file.split('/');
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  const basename = lowerSegments.at(-1);
  const forbiddenSegment = lowerSegments.some((segment) => (
    segment === 'node_modules'
    || segment === 'test'
    || segment === 'tests'
    || segment === 'docs'
    || segment === 'deploy'
    || segment === 'upload'
    || segment === 'uploads'
    || segment === 'backup'
    || segment === 'backups'
    || segment === 'archive'
    || segment === 'archives'
    || segment === 'temp'
    || segment === 'tmp'
    || segment === 'secret'
    || segment === 'secrets'
    || segment === 'key'
    || segment === 'keys'
    || segment === 'certificate'
    || segment === 'certificates'
    || segment === '.git'
    || segment === '.idea'
    || segment === '.fleet'
    || segment === '.vs'
    || segment === '.vscode'
    || segment.startsWith('.env')
  ));
  const forbiddenName = (
    /[*?[\]{}]/.test(file)
    || /^readme(?:\.|$)/i.test(basename)
    || /(?:^|\.)env(?:\.|$)/i.test(basename)
    || /^\.[a-z0-9_-]+rc(?:\.|$)/i.test(basename)
    || /(?:^|[._-])(?:test|tests|spec|specs)(?:[._-]|$)/i.test(basename)
    || /\.(?:sql|psql|pgsql|dump|sqlite|sqlite3|db)(?:$|\.)/i.test(basename)
    || /\.(?:pem|key|crt|cer|der|p12|pfx|jks)$/i.test(basename)
    || /(?:^|[-_.])(?:secret|secrets|credential|credentials|api[-_.]?key|private[-_.]?key|id_rsa|id_ed25519)(?:[-_.]|$)/i
      .test(basename)
    || /\.(?:zip|tar|tgz|gz|bz2|xz|zst|7z|rar)$/i.test(basename)
    || /(?:~|\.sw[op]|\.tmp|\.temp|\.bak|\.bkp|\.backup|\.old|\.orig|\.rej|\.save|\.ds_store)$/i
      .test(basename)
  );
  assert.equal(
    forbiddenSegment || forbiddenName,
    false,
    `forbidden runtime manifest entry: ${file}`
  );

  const rootRealPath = fs.realpathSync(root);
  const absolute = path.resolve(root, ...segments);
  const lexicalRelative = path.relative(root, absolute);
  assert.equal(
    lexicalRelative === '..'
      || lexicalRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(lexicalRelative),
    false,
    `manifest path escapes repository: ${file}`
  );
  assert.equal(fs.existsSync(absolute), true, `manifest file is missing: ${file}`);
  const pathStats = fs.lstatSync(absolute);
  assert.equal(
    pathStats.isSymbolicLink(),
    false,
    `runtime manifest symbolic links are forbidden: ${file}`
  );
  assert.equal(pathStats.isFile(), true, `manifest path is not a file: ${file}`);
  const resolved = fs.realpathSync(absolute);
  const resolvedRelative = path.relative(rootRealPath, resolved);
  assert.equal(
    resolvedRelative === '..'
      || resolvedRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(resolvedRelative),
    false,
    `manifest target escapes repository: ${file}`
  );
}

function runNodeEntry(entry, args = [], { timeout } = {}) {
  return spawnSync(process.execPath, [entry, ...args], {
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
    timeout,
  });
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
    assertRuntimeFileSafe(file);
  }
});

test('runtime file safety rejects private, generated and broad deployment artifacts', () => {
  const forbidden = [
    'backend/schema.sql',
    'backend/schema.psql',
    'backups/schema-20260727.sql.gz',
    'backups/server.js',
    'uploads/contact/message.txt',
    'backend/.env.production',
    'backend/production.env',
    'backend/secrets.json',
    'secrets/runtime.json',
    'backend/private.key',
    'keys/runtime.json',
    'backend/api-key.json',
    'backend/certificate.pem',
    'backend/certificate.der',
    'release/runtime.zip',
    'release/runtime.zst',
    'temp/server.js',
    'backend/example.test.js',
    'backend/.idea/workspace.xml',
    'backend/.npmrc',
    'backend/server.js.bak',
    'backend/server.js.bkp',
    'backend/server.js.tmp',
    'backend/server.js~',
    'backend/node_modules/express/index.js',
    'backend/test/example.test.js',
    'docs/release.md',
    'backend/deploy/runtime-manifest.txt',
    'js/*.js',
  ];

  for (const file of forbidden) {
    assert.throws(
      () => assertRuntimeFileSafe(file),
      /forbidden runtime manifest entry/,
      file
    );
  }
});

test('runtime file safety rejects a symlink that escapes its fixture repository', (context) => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-manifest-'));
  const fixtureRoot = path.join(fixtureParent, 'repository');
  const fixtureBackend = path.join(fixtureRoot, 'backend');
  const outsideFile = path.join(fixtureParent, 'outside.js');
  fs.mkdirSync(fixtureBackend, { recursive: true });
  fs.writeFileSync(outsideFile, 'module.exports = true;\n');
  fs.symlinkSync(outsideFile, path.join(fixtureBackend, 'server.js'));
  context.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));

  assert.throws(
    () => assertRuntimeFileSafe('backend/server.js', fixtureRoot),
    /symbolic links are forbidden/
  );
});

test('runtime manifest contains every local dependency reachable from the backend server', () => {
  const manifest = new Set(readManifest());
  for (const dependency of staticRequiresReachableFrom('backend/server.js')) {
    assert.ok(manifest.has(dependency), `missing runtime dependency: ${dependency}`);
  }
});

test('dependency scanner ignores comments and strings while enumerating literal module loads', () => {
  const source = `
    // require('./line-comment');
    /* require('./block-comment'); import './block-import.js'; */
    const example = "require('./string-content')";
    const pattern = /require\\(['"]\\.\\/regex-content/;
    const commonJs = require('./common-js');
    import staticValue from './static-esm.js';
    export { named } from './re-export.js';
    const lazy = import('./dynamic-esm.js');
  `;

  assert.deepEqual(literalModuleSpecifiers(source, 'fixture.js'), [
    './common-js',
    './static-esm.js',
    './re-export.js',
    './dynamic-esm.js',
  ]);
});

test('dependency scanner fails closed on computed module loads', () => {
  for (const source of [
    "require('./routes/' + routeName);",
    'require(moduleName);',
    'import(moduleName);',
    'import(`./routes/${routeName}.js`);',
  ]) {
    assert.throws(
      () => literalModuleSpecifiers(source, 'fixture.js'),
      /nonliteral module load in fixture\.js/
    );
  }
});

test('dependency scanner decodes escaped and static-template local specifiers', () => {
  const source = [
    "const escaped = require('\\u002e\\u002fhidden.js');",
    "const hexEscaped = require('\\x2e\\x2fhex-hidden.js');",
    'const staticRequire = require(`./static-require.js`);',
    'const staticImport = import(`./static-import.js`);',
  ].join('\n');

  assert.deepEqual(literalModuleSpecifiers(source, 'escaped.js'), [
    './hidden.js',
    './hex-hidden.js',
    './static-require.js',
    './static-import.js',
  ]);
});

test('dependency scanner walks executable template interpolations', () => {
  const source = [
    "const required = `${require('./hidden.js')}`;",
    "const imported = `${import('./also-hidden.js')}`;",
  ].join('\n');
  assert.deepEqual(
    literalModuleSpecifiers(source, 'template-interpolation.js'),
    ['./hidden.js', './also-hidden.js']
  );
});

test('dependency scanner does not treat metadata, regex or ordinary templates as imports', () => {
  const source = [
    "export const metadata = { from: './not-a-module.js' };",
    'if (ready) /require\\([\'"]\\.\\/regex-content/.test(value);',
    "const example = `require('./template-content.js')`;",
  ].join('\n');

  assert.deepEqual(literalModuleSpecifiers(source, 'non-dependencies.js'), []);
});

test('dependency scanner accepts literal dynamic import options', () => {
  const source = `
    const data = import('./data.json', { with: { type: 'json' } });
  `;
  assert.deepEqual(
    literalModuleSpecifiers(source, 'dynamic-options.js'),
    ['./data.json']
  );
});

test('dependency scanner rejects an oversized source instead of scanning without a bound', () => {
  assert.throws(
    () => literalModuleSpecifiers(' '.repeat(1024 * 1024 + 1), 'oversized.js'),
    /dependency source exceeds 1048576 bytes: oversized\.js/
  );
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

  const result = runNodeEntry(entry, args, { timeout: 2000 });

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Contact migration failed: Missing migration environment variables: DB_USER, DB_PASSWORD, DB_NAME/
  );
  assert.doesNotMatch(result.stderr, /ECONN|connect|password@|access denied/i);
});

test('node entry runner terminates a child that exceeds its timeout', () => {
  const result = runNodeEntry(
    '-e',
    ['setTimeout(() => {}, 400);'],
    { timeout: 25 }
  );

  assert.equal(result.status, null);
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.signal, 'SIGTERM');
});

test('release parser dev dependencies are exact direct pins', () => {
  const packageJson = require('../package.json');
  assert.deepEqual(packageJson.devDependencies, {
    acorn: '8.17.0',
    'acorn-walk': '8.3.5',
    nodemon: '^3.1.4',
  });
});

test('production package does not depend on browser CORS middleware', () => {
  const packageJson = require('../package.json');
  assert.equal(packageJson.dependencies.cors, undefined);
});
