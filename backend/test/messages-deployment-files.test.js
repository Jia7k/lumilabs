const test = require('node:test');
const assert = require('node:assert/strict');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createRequire, isBuiltin } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const backendDir = path.join(__dirname, '..');
const deployDir = path.join(backendDir, 'deploy');
const repositoryDir = path.join(backendDir, '..');
const MAX_DEPENDENCY_SOURCE_BYTES = 1024 * 1024;
const MAX_DEPENDENCY_NODES = 200000;
const MAX_DEPENDENCY_RESOLUTION_STEPS = 1000;

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
  'images/lumi5-mark.svg',
  'images/lumi5-mark-1024.png',
  'favicon.svg',
  'favicon-32x32.png',
  'favicon.ico',
  'apple-touch-icon.png',
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

function pathEscapesRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  );
}

function lstatIfExists(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function assertNoDependencySymlinks(target, root) {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  if (pathEscapesRoot(absoluteRoot, absoluteTarget)) {
    throw new Error(`dependency path escapes root: ${target}`);
  }

  const relative = path.relative(absoluteRoot, absoluteTarget);
  let current = absoluteRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = lstatIfExists(current);
    if (!stats) return;
    if (stats.isSymbolicLink()) {
      throw new Error(`dependency symbolic links are forbidden: ${current}`);
    }
  }
}

function inspectDependencyPath(target, root) {
  const absoluteTarget = path.resolve(target);
  assertNoDependencySymlinks(absoluteTarget, root);
  const stats = lstatIfExists(absoluteTarget);
  if (!stats) return null;

  const rootRealPath = fs.realpathSync(root);
  const targetRealPath = fs.realpathSync(absoluteTarget);
  if (pathEscapesRoot(rootRealPath, targetRealPath)) {
    throw new Error(`dependency target escapes root: ${target}`);
  }
  return {
    path: absoluteTarget,
    realPath: targetRealPath,
    stats,
  };
}

function readBoundedPackageJson(packageFile, root) {
  const inspected = inspectDependencyPath(packageFile, root);
  if (!inspected || !inspected.stats.isFile()) {
    throw new Error(`dependency package metadata is not a file: ${packageFile}`);
  }
  if (inspected.stats.size > MAX_DEPENDENCY_SOURCE_BYTES) {
    throw new Error(
      `dependency package metadata exceeds ${MAX_DEPENDENCY_SOURCE_BYTES} bytes: ${packageFile}`
    );
  }
  try {
    const value = JSON.parse(fs.readFileSync(inspected.path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('top level must be an object');
    }
    return { path: inspected.path, value };
  } catch (error) {
    throw new Error(`cannot parse dependency package metadata ${packageFile}: ${error.message}`);
  }
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

function nearestPackageJson(sourceFile, root = repositoryDir) {
  const absoluteRoot = path.resolve(root);
  let directory = path.dirname(
    path.isAbsolute(sourceFile) ? sourceFile : path.resolve(root, sourceFile)
  );
  while (true) {
    const relative = path.relative(absoluteRoot, directory);
    if (
      relative === '..'
      || relative.startsWith(`..${path.sep}`)
      || path.isAbsolute(relative)
    ) {
      break;
    }

    const packageFile = path.join(directory, 'package.json');
    if (lstatIfExists(packageFile)) {
      return readBoundedPackageJson(packageFile, root);
    }
    if (directory === absoluteRoot) break;
    directory = path.dirname(directory);
  }
  return null;
}

function sourceContextForFile(sourceFile, root = repositoryDir) {
  const extension = path.extname(sourceFile).toLowerCase();
  if (extension === '.mjs') return { sourceType: 'module', metadataFiles: [] };
  if (extension === '.cjs') return { sourceType: 'commonjs', metadataFiles: [] };
  if (extension === '') return { sourceType: 'commonjs', metadataFiles: [] };
  if (extension !== '.js') return { sourceType: 'script', metadataFiles: [] };

  const packageJson = nearestPackageJson(sourceFile, root);
  if (packageJson) {
    return {
      sourceType: packageJson.value.type === 'module' ? 'module' : 'commonjs',
      metadataFiles: [packageJson.path],
    };
  }
  return { sourceType: 'commonjs', metadataFiles: [] };
}

function isRequireCallee(callee) {
  return (
    (callee.type === 'Identifier' && callee.name === 'require')
    || (
      callee.type === 'MemberExpression'
      && callee.computed === false
      && callee.object.type === 'Identifier'
      && callee.object.name === 'module'
      && callee.property.type === 'Identifier'
      && callee.property.name === 'require'
    )
  );
}

function literalModuleLoads(source, sourceLabel = '<source>', root = repositoryDir) {
  const sourceBytes = Buffer.byteLength(source, 'utf8');
  if (sourceBytes > MAX_DEPENDENCY_SOURCE_BYTES) {
    throw new Error(
      `dependency source exceeds ${MAX_DEPENDENCY_SOURCE_BYTES} bytes: ${sourceLabel}`
    );
  }

  let ast;
  const sourceContext = sourceContextForFile(sourceLabel, root);
  try {
    ast = acorn.parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: sourceContext.sourceType,
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
    let kind;
    if (
      node.type === 'ImportDeclaration'
      || node.type === 'ExportAllDeclaration'
      || (node.type === 'ExportNamedDeclaration' && node.source)
    ) {
      sourceNode = node.source;
      kind = 'esm';
    } else if (node.type === 'ImportExpression') {
      sourceNode = node.source;
      kind = 'esm';
    } else if (
      node.type === 'CallExpression'
      && isRequireCallee(node.callee)
    ) {
      if (node.arguments.length !== 1) {
        throw new Error(`nonliteral module load in ${sourceLabel}`);
      }
      [sourceNode] = node.arguments;
      kind = 'commonjs';
    }

    if (sourceNode) {
      dependencies.push({
        kind,
        start: node.start,
        specifier: moduleSpecifierValue(sourceNode, sourceLabel),
      });
    }
  });

  return dependencies
    .sort((left, right) => left.start - right.start)
    .map(({ kind, specifier }) => ({ kind, specifier }));
}

function literalModuleSpecifiers(source, sourceLabel = '<source>', root = repositoryDir) {
  return literalModuleLoads(source, sourceLabel, root)
    .map(({ specifier }) => specifier);
}

function createCandidateState(root) {
  return {
    root: path.resolve(root),
    steps: 0,
  };
}

function inspectCommonJsCandidate(candidate, state) {
  state.steps += 1;
  if (state.steps > MAX_DEPENDENCY_RESOLUTION_STEPS) {
    throw new Error(
      `dependency resolution exceeds ${MAX_DEPENDENCY_RESOLUTION_STEPS} steps`
    );
  }
  return inspectDependencyPath(candidate, state.root);
}

function commonJsFileCandidates(candidate) {
  return [
    candidate,
    `${candidate}.js`,
    `${candidate}.json`,
    `${candidate}.node`,
  ];
}

function commonJsIndexCandidates(directory) {
  return ['index.js', 'index.json', 'index.node']
    .map((basename) => path.join(directory, basename));
}

function matchNodeResolvedFile(candidates, nodeResolved, state) {
  for (const file of candidates) {
    const inspected = inspectCommonJsCandidate(file, state);
    if (inspected?.stats.isFile()) {
      if (inspected.realPath !== nodeResolved) {
        throw new Error(`Node resolved a different dependency target: ${file}`);
      }
      return inspected.path;
    }
  }
  return null;
}

function lexicalCommonJsResolution(candidate, nodeResolved, root) {
  const state = createCandidateState(root);
  const directFile = matchNodeResolvedFile(
    commonJsFileCandidates(candidate),
    nodeResolved,
    state
  );
  if (directFile) return { target: directFile, metadataFiles: [] };

  const inspectedDirectory = inspectCommonJsCandidate(candidate, state);
  if (!inspectedDirectory?.stats.isDirectory()) {
    throw new Error(`Cannot map Node dependency resolution for ${candidate}`);
  }
  const packageFile = path.join(inspectedDirectory.path, 'package.json');
  const inspectedPackage = inspectCommonJsCandidate(packageFile, state);
  let packageJson;
  if (inspectedPackage) {
    if (!inspectedPackage.stats.isFile()) {
      throw new Error(`dependency package metadata is not a file: ${packageFile}`);
    }
    packageJson = readBoundedPackageJson(packageFile, state.root);
    if (
      typeof packageJson.value.main === 'string'
      && packageJson.value.main.length > 0
    ) {
      const mainCandidate = path.resolve(
        inspectedDirectory.path,
        packageJson.value.main
      );
      const mainFile = matchNodeResolvedFile(
        commonJsFileCandidates(mainCandidate),
        nodeResolved,
        state
      );
      if (mainFile) {
        return {
          target: mainFile,
          metadataFiles: [packageJson.path],
        };
      }

      const inspectedMainDirectory = inspectCommonJsCandidate(
        mainCandidate,
        state
      );
      if (inspectedMainDirectory?.stats.isDirectory()) {
        const mainIndex = matchNodeResolvedFile(
          commonJsIndexCandidates(inspectedMainDirectory.path),
          nodeResolved,
          state
        );
        if (mainIndex) {
          return {
            target: mainIndex,
            metadataFiles: [packageJson.path],
          };
        }
      }
    }
  }

  const indexFile = matchNodeResolvedFile(
    commonJsIndexCandidates(inspectedDirectory.path),
    nodeResolved,
    state
  );
  if (indexFile) {
    return {
      target: indexFile,
      metadataFiles: packageJson ? [packageJson.path] : [],
    };
  }
  throw new Error(`Cannot map Node dependency resolution for ${candidate}`);
}

function resolveCommonJsLocal(fromFile, specifier, root) {
  let nodeResolved;
  try {
    nodeResolved = createRequire(fromFile).resolve(specifier);
  } catch (error) {
    throw new Error(`Cannot resolve ${specifier} from ${fromFile}: ${error.message}`);
  }
  if (!path.isAbsolute(nodeResolved)) {
    throw new Error(`Cannot resolve ${specifier} from ${fromFile}`);
  }

  const candidate = path.resolve(path.dirname(fromFile), specifier);
  return lexicalCommonJsResolution(
    candidate,
    fs.realpathSync(nodeResolved),
    root
  );
}

function resolveLocalModule(fromFile, load, root) {
  if (load.kind === 'esm') {
    let candidate;
    try {
      const targetUrl = new URL(load.specifier, pathToFileURL(fromFile));
      if (targetUrl.protocol !== 'file:') {
        throw new Error(`unsupported protocol ${targetUrl.protocol}`);
      }
      candidate = fileURLToPath(targetUrl);
    } catch (error) {
      throw new Error(
        `Cannot resolve explicit ESM dependency ${load.specifier} from ${fromFile}: ${error.message}`
      );
    }
    const inspected = inspectDependencyPath(candidate, root);
    if (!inspected?.stats.isFile()) {
      throw new Error(
        `Cannot resolve explicit ESM dependency ${load.specifier} from ${fromFile}`
      );
    }
    return { target: inspected.path, metadataFiles: [] };
  }

  return resolveCommonJsLocal(fromFile, load.specifier, root);
}

function classifyModuleSpecifier(specifier) {
  if (isBuiltin(specifier)) return 'builtin';
  if (path.isAbsolute(specifier) || path.win32.isAbsolute(specifier)) {
    return 'absolute';
  }
  if (/^file:/i.test(specifier)) return 'file';
  if (specifier.startsWith('#')) return 'imports';
  if (/^\.\.?([/\\]|$)/.test(specifier)) return 'relative';
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return 'protocol';
  return 'bare';
}

function packageSelfReference(fromFile, specifier, root) {
  const packageJson = nearestPackageJson(fromFile, root);
  const packageName = packageJson?.value.name;
  if (
    typeof packageName !== 'string'
    || packageName.length === 0
    || !Object.hasOwn(packageJson.value, 'exports')
  ) {
    return null;
  }
  return (
    specifier === packageName
    || specifier.startsWith(`${packageName}/`)
  )
    ? packageJson
    : null;
}

const PACKAGE_TARGET_NO_MATCH = Symbol('package target has no matching condition');
const PACKAGE_TARGET_BLOCKED = Symbol('package target is blocked');

function advancePackageTargetState(state) {
  state.steps += 1;
  if (state.steps > MAX_DEPENDENCY_RESOLUTION_STEPS) {
    throw new Error(
      `dependency resolution exceeds ${MAX_DEPENDENCY_RESOLUTION_STEPS} steps`
    );
  }
}

function matchPackageImportsTarget(imports, specifier, state) {
  if (!imports || typeof imports !== 'object' || Array.isArray(imports)) {
    throw new Error(`invalid package imports map for ${specifier}`);
  }
  if (Object.hasOwn(imports, specifier) && !specifier.includes('*')) {
    return { patternMatch: null, target: imports[specifier] };
  }

  const matches = [];
  for (const [key, target] of Object.entries(imports)) {
    advancePackageTargetState(state);
    const wildcardCount = [...key].filter((character) => character === '*').length;
    if (wildcardCount > 1) {
      throw new Error(`unsupported package imports pattern: ${key}`);
    }
    if (wildcardCount !== 1) continue;

    const wildcardIndex = key.indexOf('*');
    const prefix = key.slice(0, wildcardIndex);
    const trailer = key.slice(wildcardIndex + 1);
    if (
      specifier.length < prefix.length + trailer.length
      || !specifier.startsWith(prefix)
      || !specifier.endsWith(trailer)
    ) {
      continue;
    }
    matches.push({
      key,
      patternMatch: specifier.slice(
        prefix.length,
        specifier.length - trailer.length
      ),
      prefixLength: prefix.length,
      target,
    });
  }
  matches.sort((left, right) => (
    right.prefixLength - left.prefixLength
    || right.key.length - left.key.length
  ));
  return matches[0] || null;
}

function selectPackageImportsTarget(target, conditions, patternMatch, state, inArray = false) {
  advancePackageTargetState(state);
  if (target === null) {
    return inArray ? PACKAGE_TARGET_NO_MATCH : PACKAGE_TARGET_BLOCKED;
  }
  if (typeof target === 'string') {
    if (patternMatch === null && target.includes('*')) {
      throw new Error('package imports target has a wildcard without a pattern key');
    }
    return patternMatch === null
      ? target
      : target.replaceAll('*', patternMatch);
  }
  if (Array.isArray(target)) {
    if (target.length === 0) return PACKAGE_TARGET_BLOCKED;
    for (const fallback of target) {
      const selected = selectPackageImportsTarget(
        fallback,
        conditions,
        patternMatch,
        state,
        true
      );
      if (selected !== PACKAGE_TARGET_NO_MATCH) return selected;
    }
    return PACKAGE_TARGET_BLOCKED;
  }
  if (!target || typeof target !== 'object') {
    throw new Error('unsupported package imports target type');
  }

  const keys = Object.keys(target);
  if (keys.some((key) => key.startsWith('.') || key.startsWith('#'))) {
    throw new Error('unsupported package imports target object');
  }
  for (const condition of keys) {
    advancePackageTargetState(state);
    if (condition !== 'default' && !conditions.has(condition)) continue;
    const selected = selectPackageImportsTarget(
      target[condition],
      conditions,
      patternMatch,
      state
    );
    if (selected !== PACKAGE_TARGET_NO_MATCH) return selected;
  }
  return PACKAGE_TARGET_NO_MATCH;
}

function inspectLocalPackageImportsTarget(packageJson, target, root) {
  if (
    target.includes('\\')
    || target.split(/[?#]/, 1)[0]
      .split('/')
      .slice(1)
      .some((segment) => (
        segment === '.'
        || segment === '..'
        || segment.toLowerCase() === 'node_modules'
      ))
  ) {
    throw new Error(`unsupported local package imports target: ${target}`);
  }

  let candidate;
  try {
    const targetUrl = new URL(target, pathToFileURL(packageJson.path));
    if (targetUrl.protocol !== 'file:') {
      throw new Error(`unsupported protocol ${targetUrl.protocol}`);
    }
    candidate = fileURLToPath(targetUrl);
  } catch (error) {
    throw new Error(`invalid local package imports target ${target}: ${error.message}`);
  }
  if (pathEscapesRoot(path.dirname(packageJson.path), candidate)) {
    throw new Error(`local package imports target escapes package: ${target}`);
  }

  const inspected = inspectDependencyPath(candidate, root);
  if (!inspected?.stats.isFile()) {
    throw new Error(`Cannot resolve local package imports target ${target}`);
  }
  return inspected;
}

function resolvePackageImportsAlias(fromFile, load, root) {
  const packageJson = nearestPackageJson(fromFile, root);
  if (!packageJson) {
    throw new Error(`Cannot resolve package imports alias ${load.specifier} from ${fromFile}`);
  }

  const state = createCandidateState(root);
  const mapping = matchPackageImportsTarget(
    packageJson.value.imports,
    load.specifier,
    state
  );
  if (!mapping) {
    throw new Error(`Cannot resolve package imports alias ${load.specifier} from ${fromFile}`);
  }
  const conditions = new Set(
    load.kind === 'commonjs'
      ? ['node', 'require']
      : ['node', 'import']
  );
  const target = selectPackageImportsTarget(
    mapping.target,
    conditions,
    mapping.patternMatch,
    state
  );
  if (target === PACKAGE_TARGET_BLOCKED) {
    throw new Error(`blocked package imports alias ${load.specifier} from ${fromFile}`);
  }
  if (target === PACKAGE_TARGET_NO_MATCH) {
    throw new Error(`Cannot resolve package imports alias ${load.specifier} from ${fromFile}`);
  }

  const targetType = classifyModuleSpecifier(target);
  if (targetType === 'builtin' || targetType === 'bare') {
    if (target.length === 0) {
      throw new Error(`unsupported package imports target: ${target}`);
    }
    if (
      targetType === 'bare'
      && packageSelfReference(fromFile, target, root)
    ) {
      throw new Error(
        `package self-reference is forbidden: ${target} from ${fromFile}`
      );
    }
    return {
      target: null,
      metadataFiles: [packageJson.path],
    };
  }
  if (targetType !== 'relative' || !target.startsWith('./')) {
    throw new Error(`unsupported package imports target: ${target}`);
  }

  const lexicalTarget = inspectLocalPackageImportsTarget(
    packageJson,
    target,
    root
  );
  if (load.kind === 'commonjs') {
    let nodeResolved;
    try {
      nodeResolved = createRequire(fromFile).resolve(load.specifier);
    } catch {
      throw new Error(`Cannot resolve package imports alias ${load.specifier} from ${fromFile}`);
    }
    const inspectedNodeTarget = inspectDependencyPath(nodeResolved, root);
    if (
      !inspectedNodeTarget?.stats.isFile()
      || inspectedNodeTarget.realPath !== lexicalTarget.realPath
    ) {
      throw new Error(`Cannot resolve package imports alias ${load.specifier} from ${fromFile}`);
    }
  }
  return {
    target: lexicalTarget.path,
    metadataFiles: [packageJson.path],
  };
}

function isJavaScriptDependency(file) {
  return new Set(['', '.js', '.cjs', '.mjs'])
    .has(path.extname(file).toLowerCase());
}

function staticRequiresReachableFrom(entryRelativePath, root = repositoryDir) {
  const requestedRoot = path.resolve(root);
  const requestedEntry = path.isAbsolute(entryRelativePath)
    ? entryRelativePath
    : path.resolve(root, entryRelativePath);
  const inspectedEntry = inspectDependencyPath(requestedEntry, requestedRoot);
  if (!inspectedEntry?.stats.isFile()) {
    throw new Error('dependency graph entry is missing or not a file');
  }
  const absoluteRoot = fs.realpathSync(requestedRoot);
  const pending = [inspectedEntry.realPath];
  const visited = new Set();
  while (pending.length) {
    const inspected = inspectDependencyPath(pending.pop(), absoluteRoot);
    if (!inspected?.stats.isFile()) {
      throw new Error('dependency graph entry is missing or not a file');
    }
    const current = inspected.path;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!isJavaScriptDependency(current)) continue;

    const sourceContext = sourceContextForFile(current, absoluteRoot);
    pending.push(...sourceContext.metadataFiles);
    const source = fs.readFileSync(current, 'utf8');
    const relativeCurrent = path.relative(absoluteRoot, current).split(path.sep).join('/');
    for (const load of literalModuleLoads(source, relativeCurrent, absoluteRoot)) {
      const specifierType = classifyModuleSpecifier(load.specifier);
      if (specifierType === 'builtin') continue;
      if (specifierType === 'bare') {
        if (packageSelfReference(current, load.specifier, absoluteRoot)) {
          throw new Error(
            `package self-reference is forbidden: ${load.specifier} from ${current}`
          );
        }
        continue;
      }
      if (
        specifierType === 'absolute'
        || specifierType === 'file'
        || specifierType === 'protocol'
      ) {
        throw new Error(
          `forbidden module specifier (${specifierType}): ${load.specifier}`
        );
      }
      const resolved = specifierType === 'imports'
        ? resolvePackageImportsAlias(current, load, absoluteRoot)
        : resolveLocalModule(current, load, absoluteRoot);
      pending.push(...resolved.metadataFiles);
      if (resolved.target) pending.push(resolved.target);
    }
  }
  return [...visited]
    .map((file) => path.relative(absoluteRoot, file).split(path.sep).join('/'))
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

function writeDependencyFixture(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
  }
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

  assert.deepEqual(literalModuleSpecifiers(source, 'fixture.mjs'), [
    './common-js',
    './static-esm.js',
    './re-export.js',
    './dynamic-esm.js',
  ]);
});

test('dependency scanner uses CommonJS wrapper context and module.require', () => {
  const source = [
    "if (stop) return require('./top-level-return.js');",
    'with ({ enabled: true }) {',
    "  module.require('./sloppy-module-require.js');",
    '}',
  ].join('\n');

  assert.deepEqual(
    literalModuleSpecifiers(source, path.join(backendDir, 'fixture.js')),
    ['./top-level-return.js', './sloppy-module-require.js']
  );
});

test('dependency scanner fails closed on computed module loads', () => {
  for (const source of [
    "require('./routes/' + routeName);",
    'require(moduleName);',
    'module.require(moduleName);',
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

  assert.deepEqual(literalModuleSpecifiers(source, 'non-dependencies.mjs'), []);
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

test('dependency graph resolves exact CommonJS and explicit ESM runtime closure', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-dependency-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': '{"type":"commonjs"}\n',
    'entry.js': [
      "if (stop) return require('./extensionless-data');",
      'with ({ available: true }) {',
      "  module.require('./package-main');",
      '}',
      "require('./explicit.json');",
      "require('./directory-index');",
      "require('./native');",
      "require('./looped-package');",
      "require('./helper');",
      "import('./module.mjs');",
      "import('./esm-package/module.js');",
    ].join('\n'),
    'extensionless-data.json': '{"kind":"extensionless"}\n',
    'explicit.json': '{"kind":"explicit"}\n',
    'native.node': 'not parsed as JavaScript\n',
    'package-main/package.json': '{"main":"lib/start"}\n',
    'package-main/lib/start.js': "module.require('./nested.json');\n",
    'package-main/lib/nested.json': '{"kind":"nested"}\n',
    'directory-index/index.json': '{"kind":"index"}\n',
    'looped-package/package.json': '{"main":"."}\n',
    'looped-package/index.js': "require('./leaf.json');\n",
    'looped-package/leaf.json': '{"kind":"loop-fallback"}\n',
    'helper': "if (stop) return require('./helper-leaf.js');\n",
    'helper-leaf.js': 'module.exports = true;\n',
    'module.mjs': [
      "import './esm-target.mjs';",
      "export * from './esm-all.mjs';",
      "import('./esm-data.json', { with: { type: 'json' } });",
    ].join('\n'),
    'esm-target.mjs': 'export const target = true;\n',
    'esm-all.mjs': 'export const all = true;\n',
    'esm-data.json': '{"kind":"esm"}\n',
    'esm-package/package.json': '{"type":"module"}\n',
    'esm-package/module.js': [
      "import './leaf.js';",
      "export { value } from './re-export.js';",
    ].join('\n'),
    'esm-package/leaf.js': 'export const leaf = true;\n',
    'esm-package/re-export.js': 'export const value = true;\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    [
      'directory-index/index.json',
      'entry.js',
      'esm-all.mjs',
      'esm-data.json',
      'esm-package/leaf.js',
      'esm-package/module.js',
      'esm-package/package.json',
      'esm-package/re-export.js',
      'esm-target.mjs',
      'explicit.json',
      'extensionless-data.json',
      'helper',
      'helper-leaf.js',
      'looped-package/index.js',
      'looped-package/leaf.json',
      'looped-package/package.json',
      'module.mjs',
      'native.node',
      'package-main/lib/nested.json',
      'package-main/lib/start.js',
      'package-main/package.json',
      'package.json',
    ]
  );
});

test('dependency graph follows Node nested-main fallback without recursive package lookup', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-nested-main-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': '{"type":"commonjs"}\n',
    'entry.js': "require('./nested-main');\n",
    'nested-main/package.json': '{"main":"sub"}\n',
    'nested-main/sub/package.json': '{"main":"deep.json"}\n',
    'nested-main/sub/deep.json': '{"wrong":"nested-main"}\n',
    'nested-main/sub/index.json': '{"right":"directory-index"}\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    [
      'entry.js',
      'nested-main/package.json',
      'nested-main/sub/index.json',
      'package.json',
    ]
  );
});

for (const [description, main] of [
  ['null', null],
  ['numeric', 7],
  ['empty', ''],
]) {
  test(`dependency graph falls back to index for a ${description} package main`, (context) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-main-fallback-'));
    context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
    writeDependencyFixture(fixtureRoot, {
      'package.json': '{"type":"commonjs"}\n',
      'entry.js': "require('./dependency');\n",
      'dependency/package.json': `${JSON.stringify({ main })}\n`,
      'dependency/index.json': '{"fallback":true}\n',
    });

    assert.deepEqual(
      staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
      [
        'dependency/index.json',
        'dependency/package.json',
        'entry.js',
        'package.json',
      ]
    );
  });
}

test('dependency graph fails closed on malformed package metadata', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-package-json-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': '{"type":"commonjs"}\n',
    'entry.js': "require('./malformed');\n",
    'malformed/package.json': '{"main":\n',
    'malformed/index.js': 'module.exports = true;\n',
  });

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    /package|JSON|config/i
  );
});

test('dependency graph rejects a contained ancestor symlink', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-contained-link-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'entry.js': "require('./linked/leaf.js');\n",
    'real/leaf.js': 'module.exports = true;\n',
  });
  fs.symlinkSync('real', path.join(fixtureRoot, 'linked'), 'dir');

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    /symbolic links are forbidden/
  );
});

test('dependency graph rejects CommonJS extension fallback for explicit ESM paths', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-esm-path-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'entry.mjs': "import './target';\n",
    'target.js': 'export const target = true;\n',
  });

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    /Cannot resolve explicit ESM dependency \.\/target/
  );
});

test('dependency graph resolves ESM query and fragment suffixes to deployment files', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-esm-url-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'entry.mjs': [
      "import './target.mjs?raw';",
      "export * from './other.mjs#fragment';",
    ].join('\n'),
    'target.mjs': 'export const target = true;\n',
    'other.mjs': 'export const other = true;\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    ['entry.mjs', 'other.mjs', 'target.mjs']
  );
});

test('dependency graph rejects a local dependency symlink that escapes its root', (context) => {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-dependency-link-'));
  const fixtureRoot = path.join(fixtureParent, 'repository');
  const outsideFile = path.join(fixtureParent, 'outside.js');
  context.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'entry.js': "require('./escape');\n",
  });
  fs.writeFileSync(outsideFile, 'module.exports = true;\n');
  fs.symlinkSync(outsideFile, path.join(fixtureRoot, 'escape.js'));

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    /symbolic links are forbidden/
  );
});

const rejectedSpecifierFixtures = [
  [
    'an absolute path inside the dependency root',
    ({ insideFile }) => `require(${JSON.stringify(insideFile)});\n`,
  ],
  [
    'an absolute path outside the dependency root',
    ({ outsideFile }) => `require(${JSON.stringify(outsideFile)});\n`,
  ],
  [
    'a file URL inside the dependency root',
    ({ insideFile }) => `import(${JSON.stringify(pathToFileURL(insideFile).href)});\n`,
  ],
  [
    'a file URL outside the dependency root',
    ({ outsideFile }) => `import(${JSON.stringify(pathToFileURL(outsideFile).href)});\n`,
  ],
  [
    'a Windows drive-absolute path',
    () => `require(${JSON.stringify('C:\\portable\\inside.js')});\n`,
  ],
  [
    'a Windows UNC path',
    () => `require(${JSON.stringify('\\\\server\\share\\inside.js')});\n`,
  ],
  [
    'an unsupported URL protocol',
    () => "import('https://example.invalid/module.js');\n",
  ],
];

for (const [description, sourceFor] of rejectedSpecifierFixtures) {
  test(`dependency graph rejects ${description}`, (context) => {
    const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-specifier-'));
    const fixtureRoot = path.join(fixtureParent, 'repository');
    const insideFile = path.join(fixtureRoot, 'inside.js');
    const outsideFile = path.join(fixtureParent, 'outside.js');
    context.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));
    writeDependencyFixture(fixtureRoot, {
      'entry.js': sourceFor({ insideFile, outsideFile }),
      'inside.js': 'module.exports = true;\n',
    });
    fs.writeFileSync(outsideFile, 'module.exports = true;\n');

    assert.throws(
      () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
      /forbidden module specifier/
    );
  });
}

test('dependency graph resolves an exact local package imports alias', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': '{"type":"commonjs","imports":{"#local":"./mapped.js"}}\n',
    'entry.js': "require('#local');\n",
    'mapped.js': "require('./leaf.js');\n",
    'leaf.js': 'module.exports = true;\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    ['entry.js', 'leaf.js', 'mapped.js', 'package.json']
  );
});

test('dependency graph fails closed on an unresolved package imports alias', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-missing-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': '{"type":"commonjs","imports":{}}\n',
    'entry.js': "require('#missing');\n",
  });

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    /Cannot resolve package imports alias #missing/
  );
});

test('dependency graph rejects a scoped CommonJS package self-reference', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-self-cjs-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      name: '@scope/self-package',
      exports: {
        './local': './mapped.cjs',
      },
    }),
    'entry.cjs': "require('@scope/self-package/local');\n",
    'mapped.cjs': "require('./mapped-leaf.js');\n",
    'mapped-leaf.js': 'module.exports = true;\n',
  });

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.cjs'), fixtureRoot),
    /package self-reference is forbidden: @scope\/self-package\/local/
  );
});

test('dependency graph rejects an ESM package self-reference', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-self-esm-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      name: 'self-package',
      type: 'module',
      exports: {
        './local': './mapped.mjs',
      },
    }),
    'entry.mjs': "import 'self-package/local';\n",
    'mapped.mjs': "import './mapped-leaf.mjs';\n",
    'mapped-leaf.mjs': 'export const leaf = true;\n',
  });

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    /package self-reference is forbidden: self-package\/local/
  );
});

test('dependency graph does not misclassify an ordinary package sharing a self-reference prefix', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-self-prefix-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      name: '@scope/self',
      exports: {
        './local': './mapped.cjs',
      },
    }),
    'entry.cjs': "require('@scope/selfish/local');\n",
    'mapped.cjs': 'module.exports = true;\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.cjs'), fixtureRoot),
    ['entry.cjs']
  );
});

test('dependency graph resolves an exact ESM package imports alias transitively', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-esm-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      type: 'module',
      imports: {
        '#local': './mapped.mjs',
      },
    }),
    'entry.mjs': "import '#local';\n",
    'mapped.mjs': "import './leaf.mjs';\n",
    'leaf.mjs': 'export const leaf = true;\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    ['entry.mjs', 'leaf.mjs', 'mapped.mjs', 'package.json']
  );
});

test('dependency graph applies ordered require and import package imports conditions', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-conditions-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      type: 'commonjs',
      imports: {
        '#conditional': {
          require: './require-target.cjs',
          import: './import-target.mjs',
          default: './default-target.js',
        },
      },
    }),
    'entry.js': [
      "require('#conditional');",
      "import('#conditional');",
    ].join('\n'),
    'require-target.cjs': "require('./require-leaf.json');\n",
    'require-leaf.json': '{"kind":"require"}\n',
    'import-target.mjs': "import './import-leaf.mjs';\n",
    'import-leaf.mjs': 'export const kind = "import";\n',
    'default-target.js': 'module.exports = "wrong";\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.js'), fixtureRoot),
    [
      'entry.js',
      'import-leaf.mjs',
      'import-target.mjs',
      'package.json',
      'require-leaf.json',
      'require-target.cjs',
    ]
  );
});

test('dependency graph resolves the most specific ESM package imports pattern', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-pattern-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      type: 'module',
      imports: {
        '#features/*': './wrong/*.mjs',
        '#features/*.js': './features/*.mjs',
      },
    }),
    'entry.mjs': "import '#features/tool.js';\n",
    'features/tool.mjs': "import './tool-leaf.mjs';\n",
    'features/tool-leaf.mjs': 'export const leaf = true;\n',
    'wrong/tool.js.mjs': 'export const wrong = true;\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    [
      'entry.mjs',
      'features/tool-leaf.mjs',
      'features/tool.mjs',
      'package.json',
    ]
  );
});

test('dependency graph follows an ordered package imports array fallback', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-array-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      type: 'module',
      imports: {
        '#fallback': [null, './fallback.mjs'],
      },
    }),
    'entry.mjs': "import '#fallback';\n",
    'fallback.mjs': "import './fallback-leaf.mjs';\n",
    'fallback-leaf.mjs': 'export const leaf = true;\n',
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    ['entry.mjs', 'fallback-leaf.mjs', 'fallback.mjs', 'package.json']
  );
});

test('dependency graph rejects a blocked package imports alias', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-blocked-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      type: 'module',
      imports: {
        '#blocked': null,
      },
    }),
    'entry.mjs': "import '#blocked';\n",
  });

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    /blocked package imports alias #blocked/
  );
});

test('dependency graph deliberately skips an external package imports target', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-external-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      type: 'module',
      imports: {
        '#external': 'external-package/subpath',
      },
    }),
    'entry.mjs': "import '#external';\n",
  });

  assert.deepEqual(
    staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    ['entry.mjs', 'package.json']
  );
});

test('dependency graph rejects a package imports target that is a self-reference', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumilabs-imports-self-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  writeDependencyFixture(fixtureRoot, {
    'package.json': JSON.stringify({
      name: 'self-package',
      type: 'module',
      exports: {
        './local': './mapped.mjs',
      },
      imports: {
        '#self': 'self-package/local',
      },
    }),
    'entry.mjs': "import '#self';\n",
    'mapped.mjs': "import './mapped-leaf.mjs';\n",
    'mapped-leaf.mjs': 'export const leaf = true;\n',
  });

  assert.throws(
    () => staticRequiresReachableFrom(path.join(fixtureRoot, 'entry.mjs'), fixtureRoot),
    /package self-reference is forbidden: self-package\/local/
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
