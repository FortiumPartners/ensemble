'use strict';

/**
 * Finding 9 (Randy Grohs, Ensemble full bundle packaging report): the default
 * `test-runner` adapter health-checked `elixir --version` -- and `python3`/`ruby`
 * -- unconditionally, so `toolchain-cli preflight --require test-runner.run` (the
 * `--plan` step of /ensemble:implement-trd-tasks) stopped with MISSING_BINARY in
 * every repository that had none of those interpreters.
 *
 * These tests pin the fix: a health check may declare `when: { languages: [...] }`
 * and preflight skips it when the project is detected as none of those languages.
 * Two properties matter and both are pinned here:
 *   1. A detected Node/TypeScript-only project passes `--require test-runner.run`
 *      even though `elixir --version` (and python3/ruby) would fail on this box.
 *   2. A detected Elixir project STILL fails with MISSING_BINARY for `elixir`,
 *      and a project with NO detectable language still runs every check, so
 *      nothing that passes preflight today can regress.
 *
 * Hermetic: PATH is the seam (the runner builds the child env from a base
 * allowlist that always includes PATH), so every stub directory replaces PATH
 * entirely -- only the binaries a case names exist. Scratch lives under
 * ~/.omp/ensemble-pdf-f9-test-runner-elixir/, never the system temp directory.
 * `../lib/toolchain/detect-stack` is mocked so the detected language set is
 * explicit; the REAL runner runs, so the MISSING_BINARY envelope asserted here
 * is the one a user gets.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const yaml = require('js-yaml');

const { runPreflight } = require('../lib/toolchain/preflight');
const adapterManifestSchema = require('../toolchain/schemas/adapter-manifest-schema.json');
const defaultTestRunnerManifest = yaml.load(
  fs.readFileSync(path.join(__dirname, '..', 'skills', 'adapter-test-runner-default', 'adapter.yaml'), 'utf8')
);

// The mock must be declared before the module it replaces is used. preflight.js
// requires './detect-stack' lazily per run, so replacing the registry entry here
// is enough to control detection for every runPreflight call below.
jest.mock('../lib/toolchain/detect-stack', () => {
  const real = jest.requireActual('../lib/toolchain/detect-stack');
  return {
    __esModule: false,
    ...real,
    detectStack: jest.fn(async () => ({ languages: global.__DETECT_LANGUAGES || [], error: null })),
  };
});

const { detectStack } = require('../lib/toolchain/detect-stack');

const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'ensemble-pdf-f9-test-runner-elixir', 'scratch');
const RUN_ID = 'language-gate-run';

let scratchDirs;
let savedPath;

function mkScratch(label) {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, `${label}-`));
  scratchDirs.push(dir);
  return dir;
}

/**
 * Replace PATH with a directory containing only `names` (shell stubs that print a
 * canned version and log their invocation). Anything not listed -- elixir, python3,
 * ruby in the passing case -- is genuinely absent from PATH, so the real runner
 * really does hit ENOENT and produce the real MISSING_BINARY envelope.
 */
function stubPathWith(names) {
  const dir = mkScratch('stubs');
  const log = path.join(dir, 'calls.log');
  for (const name of names) {
    const script = [
      '#!/bin/sh',
      `echo "\${0##*/} $*" >> "${log}"`,
      'echo "stub 1.0.0"',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, name), script, { mode: 0o755 });
  }
  process.env.PATH = dir;
  return { dir, log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}

function project() {
  const projectRoot = mkScratch('project');
  return { projectRoot, ctx: { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } } };
}

function recordPath(projectRoot, runId) {
  return path.join(projectRoot, '.ensemble', 'state', 'toolchain', `preflight-${runId}.json`);
}

function runTestRunner(ctx) {
  return runPreflight({ categories: ['test-runner'], runId: RUN_ID, requires: ['test-runner.run'] }, ctx);
}

function detectAs(languages) {
  global.__DETECT_LANGUAGES = languages;
  detectStack.mockClear();
}

beforeAll(() => {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
});

beforeEach(() => {
  savedPath = process.env.PATH;
  scratchDirs = [];
  global.__DETECT_LANGUAGES = [];
});

afterEach(() => {
  process.env.PATH = savedPath;
});

afterAll(() => {
  process.env.PATH = savedPath;
  for (const dir of scratchDirs || []) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  if (fs.existsSync(SCRATCH_ROOT)) {
    try {
      fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('preflight language-conditional health checks (finding 9)', () => {
  test('a Node/TypeScript-only project passes --require test-runner.run with elixir, python3 and ruby absent', async () => {
    detectAs(['typescript']);
    const stubs = stubPathWith(['node', 'bash']);
    const { projectRoot, ctx } = project();

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(true);
    // Only the unconditional checks ran: nothing even attempted elixir/python3/ruby.
    const invoked = stubs.calls().join('\n');
    expect(invoked).toContain('node --version');
    expect(invoked).toContain('bash --version');
    expect(invoked).not.toContain('elixir');
    expect(invoked).not.toContain('python3');
    expect(invoked).not.toContain('ruby');
    // A passing preflight still writes the record the callers key on.
    expect(fs.existsSync(recordPath(projectRoot, RUN_ID))).toBe(true);
  });

  test('a Python project still health-checks python3 and fails MISSING_BINARY when it is absent', async () => {
    detectAs(['python']);
    const stubs = stubPathWith(['node', 'bash']);
    const { projectRoot, ctx } = project();

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toContain('python3');
    expect(result.error.message).toMatch(/PATH/);
    expect(result.error.message).toMatch(/install/i);
    expect(stubs.calls().join('\n')).not.toContain('elixir');
    expect(fs.existsSync(recordPath(projectRoot, RUN_ID))).toBe(false);
  });

  test('an Elixir project still fails MISSING_BINARY for elixir when it is absent', async () => {
    detectAs(['elixir']);
    stubPathWith(['node', 'bash']);
    const { projectRoot, ctx } = project();

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toContain('elixir');
    expect(result.error.message).toMatch(/PATH/);
    expect(fs.existsSync(recordPath(projectRoot, RUN_ID))).toBe(false);
  });

  test('an Elixir project with elixir installed passes', async () => {
    detectAs(['elixir']);
    stubPathWith(['node', 'bash', 'elixir', 'mix']);
    const { ctx } = project();

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(true);
  });

  test('when no language can be detected every health check still runs (today behaviour)', async () => {
    detectAs([]);
    // Only elixir is missing, so the failing check proves the elixir check still
    // ran even though nothing could be detected.
    stubPathWith(['node', 'bash', 'python3', 'ruby']);
    const { ctx } = project();

    const result = await runTestRunner(ctx);

    // Unchanged from before the fix: an undetected project runs every check, so
    // the missing elixir binary still fails the run.
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toContain('elixir');
    expect(result.error.message).toMatch(/PATH/);
  });

  test('detection runs at most once per preflight run', async () => {
    detectAs(['typescript']);
    stubPathWith(['node', 'bash', 'elixir', 'python3', 'ruby']);
    const { ctx } = project();

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(true);
    expect(detectStack).toHaveBeenCalledTimes(1);
  });

  test('a check without `when` is unaffected by detection (backward compatible)', async () => {
    detectAs(['go']);
    const stubs = stubPathWith(['node', 'bash', 'elixir', 'python3', 'ruby']);
    const { ctx } = project();

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(true);
    const invoked = stubs.calls().join('\n');
    // go is detected, so every language-conditional check is skipped, but the two
    // unconditional ones still ran.
    expect(invoked).toContain('node --version');
    expect(invoked).toContain('bash --version');
    expect(invoked).not.toContain('elixir');
  });

  test('a multi-language project runs the check for every language it declares', async () => {
    detectAs(['typescript', 'python']);
    const stubs = stubPathWith(['node', 'bash']);
    const { ctx } = project();

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toContain('python3');
    expect(stubs.calls().join('\n')).not.toContain('elixir');
  });
});

describe('adapter manifest schema and the shipped default test-runner adapter', () => {
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(adapterManifestSchema);

  test('the schema accepts an optional `when` on a health check', () => {
    expect(validate(defaultTestRunnerManifest)).toBe(true);
  });

  test('the schema rejects an unknown key inside `when`', () => {
    const manifest = JSON.parse(JSON.stringify(defaultTestRunnerManifest));
    manifest.health.find((check) => check.id === 'elixir-installed').when.extra = true;
    expect(validate(manifest)).toBe(false);
  });

  test('the schema rejects an empty `when.languages`', () => {
    const manifest = JSON.parse(JSON.stringify(defaultTestRunnerManifest));
    manifest.health.find((check) => check.id === 'elixir-installed').when = { languages: [] };
    expect(validate(manifest)).toBe(false);
  });

  test('the shipped default test-runner adapter marks only python3, elixir and ruby conditional', () => {
    const conditional = new Map(
      defaultTestRunnerManifest.health
        .filter((check) => check.when)
        .map((check) => [check.id, check.when.languages])
    );
    expect([...conditional.keys()].sort()).toEqual(['elixir-installed', 'python3-installed', 'ruby-installed']);
    expect(conditional.get('elixir-installed')).toEqual(['elixir']);
    expect(conditional.get('python3-installed')).toEqual(['python']);
    expect(conditional.get('ruby-installed')).toEqual(['ruby']);
    for (const id of ['node-installed', 'bash-installed']) {
      expect(defaultTestRunnerManifest.health.find((check) => check.id === id).when).toBeUndefined();
    }
  });
});
