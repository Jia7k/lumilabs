const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
const deployDir = path.join(backendDir, 'deploy');
const repositoryDir = path.join(backendDir, '..');
const MAX_DEPENDENCY_SOURCE_BYTES = 1024 * 1024;
const MAX_DEPENDENCY_TOKENS = 200000;

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

function tokenizeModuleSyntax(source, sourceLabel) {
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > MAX_DEPENDENCY_SOURCE_BYTES) {
    throw new Error(
      `dependency source exceeds ${MAX_DEPENDENCY_SOURCE_BYTES} bytes: ${sourceLabel}`
    );
  }

  const tokens = [];
  let index = 0;

  function addToken(type, value) {
    tokens.push({ type, value });
    if (tokens.length > MAX_DEPENDENCY_TOKENS) {
      throw new Error(`dependency source has too many tokens: ${sourceLabel}`);
    }
  }

  function readQuotedString(quote) {
    let value = '';
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === quote) {
        index += 1;
        addToken('string', value);
        return;
      }
      if (character === '\\') {
        index += 1;
        if (index >= source.length) break;
        const escaped = source[index];
        const simpleEscapes = {
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
          v: '\v',
        };
        value += simpleEscapes[escaped] ?? escaped;
        index += 1;
        continue;
      }
      value += character;
      index += 1;
    }
    throw new Error(`unterminated string while scanning dependencies: ${sourceLabel}`);
  }

  function readTemplate() {
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '`') {
        index += 1;
        addToken('template', '');
        return;
      }
      index += 1;
    }
    throw new Error(`unterminated template while scanning dependencies: ${sourceLabel}`);
  }

  function regexCanStart() {
    const previous = tokens.at(-1);
    if (!previous) return true;
    if (previous.type === 'identifier') {
      return new Set([
        'await',
        'case',
        'delete',
        'do',
        'else',
        'in',
        'instanceof',
        'of',
        'return',
        'throw',
        'typeof',
        'void',
        'yield',
      ]).has(previous.value);
    }
    return (
      previous.type === 'punctuator'
      && /[([{,;:=!?&|+\-*%^~<>]/.test(previous.value)
    );
  }

  function readRegex() {
    let inCharacterClass = false;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (/[\r\n]/.test(character)) {
        throw new Error(`unterminated regex while scanning dependencies: ${sourceLabel}`);
      }
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === '[') {
        inCharacterClass = true;
        index += 1;
        continue;
      }
      if (character === ']') {
        inCharacterClass = false;
        index += 1;
        continue;
      }
      if (character === '/' && !inCharacterClass) {
        index += 1;
        while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
        addToken('regex', '');
        return;
      }
      index += 1;
    }
    throw new Error(`unterminated regex while scanning dependencies: ${sourceLabel}`);
  }

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      index += 2;
      while (index < source.length && !/[\r\n]/.test(source[index])) index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (
        index < source.length
        && !(source[index] === '*' && source[index + 1] === '/')
      ) {
        index += 1;
      }
      if (index >= source.length) {
        throw new Error(`unterminated comment while scanning dependencies: ${sourceLabel}`);
      }
      index += 2;
      continue;
    }
    if (character === '/' && regexCanStart()) {
      readRegex();
      continue;
    }
    if (character === "'" || character === '"') {
      readQuotedString(character);
      continue;
    }
    if (character === '`') {
      readTemplate();
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) {
        index += 1;
      }
      addToken('identifier', source.slice(start, index));
      continue;
    }
    addToken('punctuator', character);
    index += 1;
  }

  return tokens;
}

function literalModuleSpecifiers(source, sourceLabel = '<source>') {
  const tokens = tokenizeModuleSyntax(source, sourceLabel);
  const specifiers = [];

  function addCallSpecifier(tokenIndex) {
    const argument = tokens[tokenIndex + 2];
    const close = tokens[tokenIndex + 3];
    if (argument?.type !== 'string' || close?.value !== ')') {
      throw new Error(`nonliteral module load in ${sourceLabel}`);
    }
    specifiers.push(argument.value);
    return tokenIndex + 3;
  }

  function addStaticSpecifier(tokenIndex) {
    const immediate = tokens[tokenIndex + 1];
    if (immediate?.type === 'string') {
      specifiers.push(immediate.value);
      return tokenIndex + 1;
    }

    for (
      let cursor = tokenIndex + 1;
      cursor < tokens.length && tokens[cursor].value !== ';';
      cursor += 1
    ) {
      if (tokens[cursor].type !== 'identifier' || tokens[cursor].value !== 'from') {
        continue;
      }
      const specifier = tokens[cursor + 1];
      if (specifier?.type !== 'string') {
        throw new Error(`nonliteral module load in ${sourceLabel}`);
      }
      specifiers.push(specifier.value);
      return cursor + 1;
    }
    throw new Error(`nonliteral module load in ${sourceLabel}`);
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (token.type !== 'identifier') continue;

    if (token.value === 'require' && previous?.value !== '.' && next?.value === '(') {
      index = addCallSpecifier(index);
      continue;
    }
    if (token.value === 'import') {
      if (next?.value === '.') continue;
      index = next?.value === '('
        ? addCallSpecifier(index)
        : addStaticSpecifier(index);
      continue;
    }
    if (token.value === 'export') {
      for (
        let cursor = index + 1;
        cursor < tokens.length && tokens[cursor].value !== ';';
        cursor += 1
      ) {
        if (tokens[cursor].type !== 'identifier' || tokens[cursor].value !== 'from') {
          continue;
        }
        const specifier = tokens[cursor + 1];
        if (specifier?.type !== 'string') {
          throw new Error(`nonliteral module load in ${sourceLabel}`);
        }
        specifiers.push(specifier.value);
        index = cursor + 1;
        break;
      }
    }
  }
  return specifiers;
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
    || segment === '.vscode'
    || segment.startsWith('.env')
  ));
  const forbiddenName = (
    /[*?[\]{}]/.test(file)
    || /^readme(?:\.|$)/i.test(basename)
    || /\.(?:sql|dump|sqlite|sqlite3|db)(?:$|\.)/i.test(basename)
    || /\.(?:pem|key|crt|cer|p12|pfx|jks)$/i.test(basename)
    || /(?:^|[-_.])(?:secret|secrets|credential|credentials|api[-_.]?key|private[-_.]?key|id_rsa|id_ed25519)(?:[-_.]|$)/i
      .test(basename)
    || /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar)$/i.test(basename)
    || /(?:~|\.sw[op]|\.tmp|\.temp|\.bak|\.backup|\.old|\.orig|\.rej|\.save|\.ds_store)$/i
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
    'backups/schema-20260727.sql.gz',
    'backups/server.js',
    'uploads/contact/message.txt',
    'backend/.env.production',
    'backend/secrets.json',
    'secrets/runtime.json',
    'backend/private.key',
    'keys/runtime.json',
    'backend/api-key.json',
    'backend/certificate.pem',
    'release/runtime.zip',
    'temp/server.js',
    'backend/server.js.bak',
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

test('production package does not depend on browser CORS middleware', () => {
  const packageJson = require('../package.json');
  assert.equal(packageJson.dependencies.cors, undefined);
});
