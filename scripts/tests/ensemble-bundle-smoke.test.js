'use strict';

/**
 * TRD-004-TEST (TRD-2026-d571763f): the `ensemble` binary has to survive the only install the
 * Claude Code plugin ever gets -- `claude plugin install` copies `packages/full` with its
 * symlinks dereferenced and never runs `npm install`.
 *
 * The scenarios below pin the five promises TRD-004 makes:
 *   1. the dereferenced bundle really runs `bin/ensemble --describe`;
 *   2. the bundled-binary validator refuses a launcher that is absent, not executable, or
 *      bare-requires something the bundle does not vendor;
 *   3. the `full/lib` mirror validator names an engine entry file whose mirror is absent;
 *   4. the pi vendor tree carries `vendor/lib/ensemble-cli.js` and the engine subtree
 *      byte-for-byte, so a fresh `npm run generate:pi` leaves the tree clean;
 *   5. the `tool-path-resolution` cheat sheet gives `ENSEMBLE_CLI` the same four tiers as
 *      `TRD_CLI` and still states the HALT rule for an unresolvable CLI.
 *
 * Scratch directories live under the repository, never `os.tmpdir()` (AGENTS.md).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { validateBundleBinaries, validateFullLibMirror } = require('../validate-all');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FULL_DIR = path.join(REPO_ROOT, 'packages', 'full');
const DEV_LIB_DIR = path.join(REPO_ROOT, 'packages', 'development', 'lib');
const PI_VENDOR_LIB_DIR = path.join(REPO_ROOT, 'packages', 'pi', 'vendor', 'lib');
const SKILL_MD = path.join(
  REPO_ROOT,
  'packages',
  'development',
  'skills',
  'tool-path-resolution',
  'SKILL.md'
);

/** Directories the installer does not copy (mirrors full-bundle-install-smoke.test.js). */
const NON_CONTENT_DIRS = new Set(['tests']);

const scratchRoots = [];

function makeScratch(prefix) {
  const dir = fs.mkdtempSync(path.join(REPO_ROOT, prefix));
  scratchRoots.push(dir);
  return dir;
}

/** Copy `src` to `dest` with every symlink dereferenced, exactly as the installer does. */
function copyDereferenced(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    copyDereferenced(fs.realpathSync(src), dest);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (NON_CONTENT_DIRS.has(entry)) continue;
      copyDereferenced(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, stat.mode & 0o777);
}

/**
 * Every vendored content path under `dir`, relative and forward-slash separated. `*.json` counts
 * as well as `*.js`: `engine/policy/defaults.json` carries the engine's policy defaults, and a
 * stale copy of it would change what a pi run decides while every `.js` file matched.
 */
function listJsFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listJsFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
      out.push(rel);
    }
  }
  return out;
}

afterAll(() => {
  for (const dir of scratchRoots) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the dereferenced bundle runs bin/ensemble', () => {
  let installRoot;

  beforeAll(() => {
    installRoot = makeScratch('.tmp-ensemble-bundle-');
    copyDereferenced(FULL_DIR, path.join(installRoot, 'full'));
  }, 180000);

  test('`bin/ensemble --describe` prints the registry with exit 0', () => {
    const launcher = path.join(installRoot, 'full', 'bin', 'ensemble');
    const result = spawnSync(process.execPath, [launcher, '--describe'], {
      cwd: path.join(installRoot, 'full'),
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(result.error).toBeUndefined();
    expect(`${result.status} ${result.stderr}`).toBe('0 ');

    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.status).toBe('OK');
    expect(Array.isArray(envelope.data.verbs)).toBe(true);
    expect(envelope.data.verbs.length).toBeGreaterThan(0);
    for (const verb of envelope.data.verbs) {
      expect(typeof verb.group).toBe('string');
      expect(typeof verb.name).toBe('string');
      expect(verb.inputSchema).toBeDefined();
      expect(verb.outputSchema).toBeDefined();
    }
  }, 120000);

  test('a native verb runs from the bundle, so its data files are installed too', () => {
    const bundleRoot = path.join(installRoot, 'full');
    const launcher = path.join(bundleRoot, 'bin', 'ensemble');

    // `engine policy` reads `lib/engine/policy/defaults.json`: a bundle that shipped only the
    // `.js` files would answer with an exit code, not with the defaults.
    const policy = spawnSync(process.execPath, [launcher, 'engine', 'policy'], {
      cwd: bundleRoot,
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(`${policy.status} ${policy.stderr}`).toBe('0 ');
    const policyEnvelope = JSON.parse(policy.stdout);
    expect(policyEnvelope.status).toBe('OK');
    expect(typeof policyEnvelope.data.policy.max_parallel_default.value).toBe('number');
    expect(policyEnvelope.data.policy.max_parallel_default.source).toBe('default');

    const args = spawnSync(
      process.execPath,
      [launcher, 'implement', 'args', '--plan', 'docs/x.md'],
      { cwd: bundleRoot, encoding: 'utf8', timeout: 60000 }
    );
    expect(`${args.status} ${args.stderr}`).toBe('0 ');
    const argsEnvelope = JSON.parse(args.stdout);
    expect(argsEnvelope.status).toBe('OK');
    expect(argsEnvelope.data.PLAN_ONLY).toBe(true);
    expect(argsEnvelope.data.TRD_PATHS).toEqual(['docs/x.md']);
  }, 120000);
});

describe('the bundled-binary rules are enforced', () => {
  /** A fixture `packages/full` whose `bin/` holds exactly the given files. */
  function fixtureFullDir(files) {
    const fullDir = path.join(makeScratch('.tmp-ensemble-bundle-bin-'), 'full');
    fs.mkdirSync(path.join(fullDir, 'bin'), { recursive: true });
    for (const [name, spec] of Object.entries(files)) {
      const file = path.join(fullDir, 'bin', name);
      fs.writeFileSync(file, spec.source);
      fs.chmodSync(file, spec.mode);
    }
    return fullDir;
  }

  const GOOD = {
    source: "#!/usr/bin/env node\n'use strict';\nrequire('../lib/ensemble-cli.js');\n",
    mode: 0o755,
  };

  test('a missing `ensemble` launcher fails, naming it', () => {
    const failures = validateBundleBinaries(fixtureFullDir({ jira: GOOD }));
    expect(failures.join('\n')).toMatch(/packages\/full\/bin\/ensemble is missing/);
  });

  test('a launcher that is not executable fails, naming it', () => {
    const failures = validateBundleBinaries(
      fixtureFullDir({ ensemble: { ...GOOD, mode: 0o644 }, jira: GOOD })
    );
    expect(failures.join('\n')).toMatch(/packages\/full\/bin\/ensemble is not executable/);
  });

  test('a launcher that bare-requires a non-builtin fails, naming the specifier', () => {
    const failures = validateBundleBinaries(
      fixtureFullDir({
        ensemble: {
          source: "#!/usr/bin/env node\n'use strict';\nrequire('js-yaml');\n",
          mode: 0o755,
        },
        jira: GOOD,
      })
    );
    expect(failures.join('\n')).toMatch(
      /packages\/full\/bin\/ensemble requires 'js-yaml'/
    );
  });

  test('the real bundle passes', () => {
    expect(validateBundleBinaries(FULL_DIR)).toEqual([]);
  });
});

describe('a missing full/lib mirror is detected', () => {
  test('an engine entry file without its full/lib mirror fails, naming the file', () => {
    const packagesDir = path.join(makeScratch('.tmp-ensemble-bundle-mirror-'), 'packages');
    fs.mkdirSync(path.join(packagesDir, 'development', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(packagesDir, 'full', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(packagesDir, 'development', 'lib', 'ensemble-cli.js'),
      "'use strict';\n"
    );

    const failures = validateFullLibMirror(packagesDir);
    expect(failures.join('\n')).toMatch(/packages\/full\/lib\/ensemble-cli\.js is missing/);
  });

  test('the real tree mirrors ensemble-cli.js and the engine directory', () => {
    const mirror = path.join(REPO_ROOT, 'packages', 'full', 'lib', 'ensemble-cli.js');
    expect(fs.lstatSync(mirror).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(mirror)).toBe('../../development/lib/ensemble-cli.js');

    const engine = path.join(REPO_ROOT, 'packages', 'full', 'lib', 'engine');
    expect(fs.lstatSync(engine).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(engine)).toBe('../../development/lib/engine');

    expect(validateFullLibMirror()).toEqual([]);
  });
});

describe('the engine is vendored for pi', () => {
  test('vendor/lib/ensemble-cli.js exists and matches its source byte-for-byte', () => {
    const vendored = path.join(PI_VENDOR_LIB_DIR, 'ensemble-cli.js');
    expect(fs.existsSync(vendored)).toBe(true);
    expect(fs.readFileSync(vendored)).toEqual(
      fs.readFileSync(path.join(DEV_LIB_DIR, 'ensemble-cli.js'))
    );
  });

  test('every engine module the CLI requires is vendored byte-for-byte, so generate:pi leaves no drift', () => {
    // The bundler vendors the require closure of each entry file, so every module
    // `ensemble-cli.js` reaches has to be present; a vendored file that differs from its
    // source is the stale-vendor defect `toolchain-vendor-sync.test.js` guards for the
    // toolchain subtree.
    const required = [
      'agents.js',
      'argv.js',
      'cli-json.js',
      'describe.js',
      'envelope.js',
      'git.js',
      'input.js',
      'interactivity.js',
      'messages.js',
      'mount.js',
      'policy.js',
      'policy/defaults.json',
      'registry.js',
      'result.js',
      'staleness.js',
      'trd-source.js',
      'validate.js',
      'worktree.js',
      'groups/engine.js',
      'groups/implement.js',
      'groups/tool.js',
      'groups/trd.js',
      'verbs/implement-args.js',
      'verbs/implement-branch.js',
      'verbs/implement-env.js',
      'verbs/implement-resume.js',
      'verbs/implement-team.js',
    ];
    const vendoredFiles = fs.existsSync(path.join(PI_VENDOR_LIB_DIR, 'engine'))
      ? listJsFiles(path.join(PI_VENDOR_LIB_DIR, 'engine'))
      : [];

    const drift = [];
    for (const rel of required) {
      if (!vendoredFiles.includes(rel)) drift.push(`vendor/lib/engine/${rel} is missing`);
    }
    for (const rel of vendoredFiles) {
      const source = path.join(DEV_LIB_DIR, 'engine', rel);
      if (!fs.existsSync(source)) {
        drift.push(`vendor/lib/engine/${rel} has no source counterpart`);
        continue;
      }
      const same = fs
        .readFileSync(path.join(PI_VENDOR_LIB_DIR, 'engine', rel))
        .equals(fs.readFileSync(source));
      if (!same) drift.push(`vendor/lib/engine/${rel} differs from its source`);
    }
    expect(drift).toEqual([]);
  });
});

describe('an unresolvable ENSEMBLE_CLI halts', () => {
  test('the cheat sheet gives ENSEMBLE_CLI the same four tiers as TRD_CLI and states the HALT rule', () => {
    const text = fs.readFileSync(SKILL_MD, 'utf8');

    const row = text
      .split('\n')
      .find(line => line.includes('`ENSEMBLE_CLI`'));
    expect(row).toBeDefined();
    expect(row).toContain('`packages/development/lib/ensemble-cli.js`');
    expect(row).toContain('`vendor/lib/ensemble-cli.js`');

    expect(text).toMatch(
      /If none of the four tiers resolve[\s\S]*?prints its own error message and HALTs\/exits/
    );
  });

  test('the shipped mirror of the cheat sheet carries the same row', () => {
    const shipped = path.join(
      REPO_ROOT,
      'packages',
      'full',
      'skills',
      'tool-path-resolution',
      'SKILL.md'
    );
    expect(fs.readFileSync(shipped, 'utf8')).toContain('`ENSEMBLE_CLI`');
  });
});
