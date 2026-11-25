'use strict';

/**
 * TRD-007-TEST (TRD-2026-d571763f): real-repository fixtures for the engine's environment verb.
 *
 * `implement env` runs `git`, `bash validate-git-town.sh` and `toolchain-cli.js` as child
 * processes, so its scenarios need a real git repository, a real adapter and a `PATH` that
 * cannot reach the host's own `git-town`, `br` or `kata`. These helpers build exactly that and
 * decide nothing: a helper that answered for the verb would hide the behaviour the scenario
 * pins.
 *
 * The stub-binary and installed-adapter recipe follows `tests/trd-cli-adapter-swap.test.js`
 * (:79-199): a stub named after no real tool, an adapter manifest under
 * `<root>/packages/fixture-pkg/skills/`, and a `PATH` built from scratch.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

/** The stub tracker's binary name -- deliberately neither `br` nor `kata`. */
const TRACKER_BIN = 'fixture-tracker';

/** The adapter id the fixture project selects for `tracker`. */
const TRACKER_ADAPTER = 'fixture-tracker';

/**
 * The host tools a fixture child process is allowed to run. Only these names are exposed, so a
 * `git-town`, `br` or `kata` installed anywhere on this host stays out of reach.
 */
const HOST_TOOLS = [
  'bash',
  'cat',
  'cut',
  'env',
  'git',
  'grep',
  'head',
  'node',
  'npm',
  'npx',
  'sed',
  'sh',
  'uname',
  'which',
];

/**
 * Where this host keeps an executable, or null when it has none.
 * @param {string} name the executable's name
 * @returns {string|null}
 */
function resolveOnHostPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory; keep looking.
    }
  }
  return null;
}

/**
 * Fill a directory with one link per allowed host tool. A tool this host does not have is simply
 * not exposed.
 * @param {string} dir the directory to fill
 */
function linkHostTools(dir) {
  for (const tool of HOST_TOOLS) {
    const source = resolveOnHostPath(tool);
    if (source === null) continue;
    try {
      fs.symlinkSync(source, path.join(dir, tool));
    } catch {
      // A tool that cannot be linked is not exposed.
    }
  }
}

/**
 * A `PATH` holding only the fixture bin directory and the allowed host tools -- never the
 * inherited `process.env.PATH`, and never a whole host directory, so no real `git-town`, `br` or
 * `kata` on this host can be reached by a child process these scenarios spawn. `node` and `npm`
 * are linked into the tools directory one by one, so their own directory is never opened up.
 * @param {string} binDir the fixture bin directory
 * @param {string} toolsDir the directory holding the allowed host tools
 * @returns {string}
 */
function fixturePath(binDir, toolsDir) {
  return [binDir, toolsDir]
    .filter(part => typeof part === 'string' && part.length > 0)
    .join(path.delimiter);
}

/**
 * The environment a scenario hands to `main` as `ctx.env`, and which the verb passes on to every
 * child process it spawns.
 * @param {string} binDir the fixture bin directory
 * @param {string} home a directory inside the fixture to use as `HOME`
 * @param {string} toolsDir the directory holding the allowed host tools
 * @param {object} [extra] further variables, e.g. `ENSEMBLE_PR_BACKEND`
 * @returns {object}
 */
function isolatedEnv(binDir, home, toolsDir, extra = {}) {
  return { HOME: home, PATH: fixturePath(binDir, toolsDir), ...extra };
}

/**
 * Commit everything in `fx.root` as the repository's first commit, and apply its git settings.
 * Called by `makeRepo` unless `init: false` asked for a plain directory, so a fixture that adds
 * more files first (a stub tracker, for example) can commit them too and start from a clean tree.
 * @param {{env: object, root: string}} fx
 * @param {{remote?: string|null, gitTownConfigured?: boolean}} [options]
 * @returns {{env: object, root: string}} `fx`
 */
function initRepo(fx, options = {}) {
  const { remote = null, gitTownConfigured = false } = options;
  const git = args => execFileSync('git', args, { cwd: fx.root, env: fx.env, stdio: 'ignore' });
  git(['init', '--quiet']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['add', '--all', '--', '.']);
  git(['commit', '--quiet', '--message', 'fixture']);
  if (remote !== null) git(['remote', 'add', 'origin', remote]);
  if (gitTownConfigured) git(['config', 'git-town.main-branch', 'main']);
  return fx;
}

/**
 * A real git repository with one commit.
 * @param {{files?: object, remote?: string|null, gitTownConfigured?: boolean, init?: boolean}}
 *   [options] `files` maps project-relative paths to contents; `remote` sets `origin`;
 *   `gitTownConfigured` sets `git-town.main-branch`; `init: false` leaves the directory as a
 *   plain, non-git directory for the caller to `initRepo` itself.
 * @returns {{binDir: string, env: object, root: string}}
 */
function makeRepo(options = {}) {
  const { files = {}, remote = null, gitTownConfigured = false, init = true } = options;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), 'engine-env-')));
  const binDir = path.join(root, 'fixture-bin');
  fs.mkdirSync(binDir, { recursive: true });
  const home = path.join(root, 'fixture-home');
  fs.mkdirSync(home, { recursive: true });
  // The allowed host tools live outside the project, so they never appear in the repository the
  // scenarios inspect.
  const toolsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'engine-env-tools-'));
  linkHostTools(toolsDir);
  const env = isolatedEnv(binDir, home, toolsDir);

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  const fx = { binDir, env, root };
  if (init) initRepo(fx, { gitTownConfigured, remote });
  return fx;
}

/**
 * Put a stand-in `git-town` reporting `version` on the fixture `PATH`, so the real
 * `validate-git-town.sh` reaches its version branch without a real git-town anywhere.
 * @param {string} binDir
 * @param {string} version e.g. `13.0.0`
 * @returns {string} the stub path
 */
function fakeGitTown(binDir, version) {
  const stub = path.join(binDir, 'git-town');
  fs.writeFileSync(stub, `#!/bin/sh\necho "git-town ${version}"\n`, { mode: 0o755 });
  fs.chmodSync(stub, 0o755);
  return stub;
}

/**
 * The stub tracker: answers `--version` and `list`, and records a `MUTATION` for anything else.
 * Its call log lives OUTSIDE the project root, so merely asking the stub for its version does not
 * change the tree a read-only scenario compares.
 * @param {string} logPath absolute path of the call log
 * @param {string} dataPath absolute path of the issue list the stub prints for `list`
 * @returns {string}
 */
function trackerStubSource(logPath, dataPath) {
  return `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const argv = process.argv.slice(2);
const log = ${JSON.stringify(logPath)};
fs.appendFileSync(log, JSON.stringify(argv) + '\\n');
if (argv[0] === '--version') {
  process.stdout.write('${TRACKER_BIN} 1.0.0\\n');
  process.exit(0);
}
if (argv[0] === 'list') {
  process.stdout.write(fs.readFileSync(${JSON.stringify(dataPath)}, 'utf8'));
  process.exit(0);
}
fs.appendFileSync(log, 'MUTATION ' + JSON.stringify(argv) + '\\n');
process.stderr.write('stub ${TRACKER_BIN}: refusing to mutate\\n');
process.exit(1);
`;
}

/**
 * Select a stub tracker adapter for the fixture project: the stub binary on `PATH`, an
 * installed-origin adapter manifest declaring the four capabilities the full preflight requires,
 * and `.ensemble/toolchain.yaml` naming it.
 * @param {string} root the project root
 * @param {{issues?: object[]}} [options]
 * @returns {{binDir: string, log: string, root: string, tracker: string}}
 */
function fixtureTracker(root, options = {}) {
  const { issues = [] } = options;
  const binDir = path.join(root, 'fixture-bin');
  fs.mkdirSync(binDir, { recursive: true });
  const log = `${root}-tracker-calls.log`;
  const trackerJson = `${root}-tracker.json`;
  const stub = path.join(binDir, TRACKER_BIN);
  fs.writeFileSync(stub, trackerStubSource(log, trackerJson), { mode: 0o755 });
  fs.chmodSync(stub, 0o755);

  fs.writeFileSync(trackerJson, `${JSON.stringify({ issues }, null, 2)}\n`);

  const skillDir = path.join(root, 'packages', 'fixture-pkg', 'skills', TRACKER_ADAPTER);
  fs.mkdirSync(skillDir, { recursive: true });
  const manifest = {
    adapter: TRACKER_ADAPTER,
    version: '1.0.0',
    categories: ['tracker'],
    contract: { tracker: '1.0' },
    binaries: [TRACKER_BIN],
    allowlist: [{ bin: TRACKER_BIN, sub: ['list', 'create', 'comment', 'close', '--version'] }],
    env: [],
    health: [{ id: 'tracker-version', run: [TRACKER_BIN, '--version'], timeoutMs: 5000 }],
    detect: [],
    capabilities: {
      'tracker.list': { run: [TRACKER_BIN, 'list'] },
      'tracker.create': { run: [TRACKER_BIN, 'create', '${title}'] },
      'tracker.comment': { run: [TRACKER_BIN, 'comment', '${id}', '${body}'] },
      'tracker.close': { run: [TRACKER_BIN, 'close', '${id}'] },
    },
  };
  fs.writeFileSync(path.join(skillDir, 'adapter.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${TRACKER_ADAPTER}\n`);

  writeToolchainYaml(root, `tracker: ${TRACKER_ADAPTER}\n`);
  return { binDir, log, root, tracker: trackerJson };
}

/**
 * Write `.ensemble/toolchain.yaml` under `root`.
 * @param {string} root
 * @param {string} text
 * @returns {string} the file path
 */
function writeToolchainYaml(root, text) {
  const file = path.join(root, '.ensemble', 'toolchain.yaml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

/** Every file under `root` except the git database, as project-relative paths. */
function treeFiles(root, dir = root, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) treeFiles(root, full, found);
    else found.push(path.relative(root, full));
  }
  return found;
}

/**
 * A hash of every file under `root` (path and content), the git database excluded. `.ensemble/
 * state` is deliberately included: a verb that quietly wrote a preflight record must change this.
 * @param {string} root
 * @returns {{hash: string, paths: string[]}}
 */
function snapshotTree(root) {
  const paths = treeFiles(root);
  const hash = crypto.createHash('sha256');
  for (const relative of paths) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(root, relative)));
  }
  return { hash: hash.digest('hex'), paths };
}

/**
 * A hash of the stub tracker's data, plus the assertion that no mutating call reached the stub.
 * @param {{log: string, tracker: string}} fx the result of `fixtureTracker`
 * @returns {string}
 */
function snapshotTracker(fx) {
  const calls = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8') : '';
  const mutations = calls.split('\n').filter(line => line.startsWith('MUTATION'));
  if (mutations.length > 0) {
    throw new Error(`the stub tracker was asked to mutate: ${mutations.join('; ')}`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(fx.tracker)).digest('hex');
}

/**
 * The argv of every call the stub tracker received.
 * @param {{log: string}} fx the result of `fixtureTracker`
 * @returns {string[][]}
 */
function trackerCalls(fx) {
  if (!fs.existsSync(fx.log)) return [];
  return fs
    .readFileSync(fx.log, 'utf8')
    .split('\n')
    .filter(line => line.startsWith('['))
    .map(line => JSON.parse(line));
}

module.exports = {
  TRACKER_ADAPTER,
  TRACKER_BIN,
  fakeGitTown,
  fixturePath,
  fixtureTracker,
  initRepo,
  isolatedEnv,
  makeRepo,
  snapshotTracker,
  snapshotTree,
  trackerCalls,
  writeToolchainYaml,
};
