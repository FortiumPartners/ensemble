'use strict';

/**
 * The real language detector behind the conditional health checks of the default
 * `test-runner` adapter (finding 9: `preflight --require test-runner.run` stopped
 * with MISSING_BINARY for `elixir` in every repo that has no Elixir).
 *
 * `toolchain-preflight-language-gate.test.js` mocks the detector to pin the
 * gating logic. These tests deliberately do NOT mock it: they drive the real
 * marker-file scan over real project directories, so a broken detector (for
 * example one that throws) cannot hide behind the "no language detected" fallback
 * and silently re-enable every health check.
 *
 * Hermetic: PATH is the seam (the runner builds the child env from a base
 * allowlist that always includes PATH), so every stub directory replaces PATH
 * entirely -- only the binaries a case names exist. Scratch lives under
 * ~/.omp/ensemble-pdf-f9-test-runner-elixir/, never the system temp directory.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const { detectStack } = require('../lib/toolchain/detect-stack');
const { runPreflight } = require('../lib/toolchain/preflight');

const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'ensemble-pdf-f9-test-runner-elixir', 'scratch');
const RUN_ID = 'detect-stack-run';

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
 * canned version and log their invocation). Anything not listed is genuinely
 * absent from PATH, so the real runner really does hit ENOENT.
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
  return {
    dir,
    log,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
  };
}

/**
 * A project directory containing only the given marker files.
 */
function projectWith(files) {
  const projectRoot = mkScratch('project');
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(projectRoot, name), content);
  }
  return {
    projectRoot,
    ctx: { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } },
  };
}

function recordPath(projectRoot, runId) {
  return path.join(projectRoot, '.ensemble', 'state', 'toolchain', `preflight-${runId}.json`);
}

function runTestRunner(ctx) {
  return runPreflight({ categories: ['test-runner'], runId: RUN_ID, requires: ['test-runner.run'] }, ctx);
}

beforeAll(() => {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
});

beforeEach(() => {
  savedPath = process.env.PATH;
  scratchDirs = [];
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

describe('the real language detector', () => {
  test('detects elixir from mix.exs', async () => {
    const { projectRoot } = projectWith({ 'mix.exs': 'defmodule P do\nend\n' });

    const result = await detectStack(projectRoot);

    expect(result.error).toBeNull();
    expect(result.languages).toEqual(['elixir']);
  });

  test('detects ruby from Gemfile and python from pyproject.toml', async () => {
    const { projectRoot } = projectWith({ Gemfile: "source 'x'\n", 'pyproject.toml': '[project]\n' });

    const result = await detectStack(projectRoot);

    expect(result.error).toBeNull();
    expect(result.languages).toEqual(expect.arrayContaining(['ruby', 'python']));
  });

  test('reports a JavaScript project once, with or without a tsconfig', async () => {
    const js = projectWith({ 'package.json': '{"name":"a"}\n' });
    const ts = projectWith({ 'package.json': '{"name":"a"}\n', 'tsconfig.json': '{}\n' });

    const jsResult = await detectStack(js.projectRoot);
    const tsResult = await detectStack(ts.projectRoot);

    expect(jsResult.languages).toEqual(['javascript']);
    // tsconfig.json is not a second ecosystem: a Node project routinely has both.
    expect(tsResult.languages).toEqual(['javascript']);
  });

  test('reports no language for a directory without markers', async () => {
    const { projectRoot } = projectWith({ 'README.md': '# hi\n' });

    const result = await detectStack(projectRoot);

    expect(result.error).toBeNull();
    expect(result.languages).toEqual([]);
  });

  test('reports an error for a directory that does not exist', async () => {
    const missing = path.join(SCRATCH_ROOT, 'does-not-exist');

    const result = await detectStack(missing);

    expect(result.error).toBeTruthy();
    expect(result.languages).toEqual([]);
  });

  test('ignores source files inside skipped directories', async () => {
    const { projectRoot } = projectWith({ 'package.json': '{"name":"a"}\n' });
    fs.mkdirSync(path.join(projectRoot, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'node_modules', 'left-pad', 'index.rb'), 'puts 1\n');

    const result = await detectStack(projectRoot);

    expect(result.languages).toEqual(['javascript']);
  });
});

describe('preflight against the real detector', () => {
  test('a Node-only project passes --require test-runner.run with elixir, python3 and ruby absent', async () => {
    const stubs = stubPathWith(['node', 'bash']);
    const { projectRoot, ctx } = projectWith({ 'package.json': '{"name":"node-only"}\n' });

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(true);
    const invoked = stubs.calls().join('\n');
    expect(invoked).toContain('node --version');
    expect(invoked).toContain('bash --version');
    expect(invoked).not.toContain('elixir');
    expect(invoked).not.toContain('python3');
    expect(invoked).not.toContain('ruby');
    expect(fs.existsSync(recordPath(projectRoot, RUN_ID))).toBe(true);
  });

  test('an Elixir project still fails MISSING_BINARY for elixir when it is absent', async () => {
    stubPathWith(['node', 'bash']);
    const { projectRoot, ctx } = projectWith({ 'mix.exs': 'defmodule P do\nend\n' });

    const result = await runTestRunner(ctx);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toContain('elixir');
    expect(result.error.message).toMatch(/PATH/);
    expect(fs.existsSync(recordPath(projectRoot, RUN_ID))).toBe(false);
  });
});