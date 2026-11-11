'use strict';

/**
 * Tests for `trd-cli resolve-bdd` (lib/trd-cli.js), the subcommand create-trd and
 * implement-trd-beads run to learn whether the Reqnroll/BDD path is on. It is on unless opted out.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { runResolveBdd } = require('../lib/trd-cli');

const CLI = path.join(__dirname, '..', 'lib', 'trd-cli.js');
const DEFAULT_MESSAGE = 'Test approach: BDD (Reqnroll) [default; opt out with ENSEMBLE_BDD=0, or --no-bdd on create-trd]';

const roots = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-bdd-'));
  roots.push(dir);
  return dir;
}
function trdWith(testApproach) {
  const file = path.join(tmp(), 'TRD.md');
  fs.writeFileSync(file, `---\ntest_approach: ${testApproach}\n---\n# TRD\n`);
  return file;
}
// A child process must not inherit the developer's own ENSEMBLE_BDD.
function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  if (!extra || !('ENSEMBLE_BDD' in extra)) delete env.ENSEMBLE_BDD;
  return env;
}
function cli(args, env, cwd) {
  const res = spawnSync('node', [CLI, 'resolve-bdd', ...args], { encoding: 'utf8', env: cleanEnv(env), cwd });
  return { status: res.status, json: JSON.parse(res.stdout.trim()) };
}

afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe('runResolveBdd (handler)', () => {
  test('--bdd and --no-bdd map to the flag source', () => {
    expect(runResolveBdd(['--bdd'], {})).toMatchObject({ ok: true, enabled: true, source: 'flag' });
    expect(runResolveBdd(['--no-bdd'], { ENSEMBLE_BDD: '1' })).toMatchObject({ ok: true, enabled: false, source: 'flag' });
  });

  test('both flags together is an error, not a silent pick', () => {
    expect(() => runResolveBdd(['--bdd', '--no-bdd'], {})).toThrow(/mutually exclusive/);
  });

  test('reads ENSEMBLE_BDD from the env it is given, not from process.env', () => {
    expect(runResolveBdd([], { ENSEMBLE_BDD: 'off' })).toMatchObject({ enabled: false, source: 'env' });
    expect(runResolveBdd([], {})).toMatchObject({ enabled: true, source: 'default' });
  });

  test('with nothing set it is on (unchanged), and the message says how to opt out', () => {
    expect(runResolveBdd([], {})).toEqual({ ok: true, enabled: true, source: 'default', message: DEFAULT_MESSAGE });
  });

  test('--trd feeds the TRD stamp into the resolution, so an opt-out recorded by create-trd is honoured', () => {
    expect(runResolveBdd(['--trd', trdWith('standard')], {})).toMatchObject({ enabled: false, source: 'trd' });
    expect(runResolveBdd(['--trd', trdWith('bdd-reqnroll')], {})).toMatchObject({ enabled: true, source: 'trd' });
  });
});

describe('trd-cli resolve-bdd (process)', () => {
  test('prints one JSON object and exits 0', () => {
    const { status, json } = cli([]);
    expect(status).toBe(0);
    expect(json).toEqual({ ok: true, enabled: true, source: 'default', message: DEFAULT_MESSAGE });
  });

  test('ENSEMBLE_BDD in the process environment is honoured', () => {
    expect(cli([], { ENSEMBLE_BDD: '0' }).json).toMatchObject({ enabled: false, source: 'env' });
  });

  test('conflicting flags print {error} and exit 1', () => {
    const { status, json } = cli(['--bdd', '--no-bdd']);
    expect(status).toBe(1);
    expect(json.error).toMatch(/mutually exclusive/);
  });

  test('is listed in the usage line, so a caller can discover it', () => {
    const res = spawnSync('node', [CLI], { encoding: 'utf8' });
    expect(JSON.parse(res.stdout).error).toContain('resolve-bdd');
  });
});

describe('--trd names the TRD the caller is about to implement: one that cannot be read is an error, never the default', () => {
  test('a missing file throws, so the commands HALT instead of carrying on with BDD on', () => {
    const missing = path.join(tmp(), 'nope.md');
    expect(() => runResolveBdd(['--trd', missing], {})).toThrow(`Cannot read TRD file '${missing}'`);
  });

  test('--no-bdd and ENSEMBLE_BDD do not paper over a TRD path that cannot be read', () => {
    const missing = path.join(tmp(), 'nope.md');
    expect(() => runResolveBdd(['--no-bdd', '--trd', missing], {})).toThrow(/Cannot read TRD file/);
    expect(() => runResolveBdd(['--trd', missing], { ENSEMBLE_BDD: '0' })).toThrow(/Cannot read TRD file/);
  });

  test('a directory is not a TRD', () => {
    const dir = tmp();
    expect(() => runResolveBdd(['--trd', dir], {})).toThrow(`Cannot read TRD file '${dir}'`);
  });

  test('--trd with no path is an error: it is not quietly dropped', () => {
    expect(() => runResolveBdd(['--trd'], {})).toThrow(/--trd requires a TRD path/);
    expect(() => runResolveBdd(['--trd', ''], {})).toThrow(/--trd requires a TRD path/);
  });

  test('--trd=<path>, a bare path and an unknown flag are errors: none is dropped to the default', () => {
    const file = trdWith('standard');
    expect(() => runResolveBdd([`--trd=${file}`], {})).toThrow(/takes only --bdd, --no-bdd and --trd <path>/);
    expect(() => runResolveBdd([file], {})).toThrow(/takes only --bdd, --no-bdd and --trd <path>/);
    expect(() => runResolveBdd(['--no-bddd'], {})).toThrow(/got: --no-bddd/);
  });

  test('the process prints {error} and exits 1 for --trd=<path> instead of answering BDD on', () => {
    const { status, json } = cli([`--trd=${trdWith('standard')}`]);
    expect(status).toBe(1);
    expect(json.error).toMatch(/takes only/);
    expect(json).not.toHaveProperty('enabled');
  });

  test('the process prints {error} and exits 1, with no enabled/source for a caller to act on', () => {
    const { status, json } = cli(['--trd', path.join(tmp(), 'nope.md')]);
    expect(status).toBe(1);
    expect(json.error).toMatch(/Cannot read TRD file/);
    expect(json).not.toHaveProperty('enabled');
    expect(json).not.toHaveProperty('source');
  });
});

describe('--trd paths resolve like the other subcommands do, and then from the repo root', () => {
  function repo() {
    const root = tmp();
    spawnSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, 'packages', 'app'), { recursive: true });
    return root;
  }
  function put(root, rel, stamp) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `---\ntest_approach: ${stamp}\n---\n# TRD\n`);
  }

  test('a repo-root-relative path, which is how the commands pass it, is found from a subdirectory', () => {
    const root = repo();
    put(root, 'docs/TRD/x.md', 'standard');
    const { status, json } = cli(['--trd', 'docs/TRD/x.md'], {}, path.join(root, 'packages', 'app'));
    expect(status).toBe(0);
    expect(json).toMatchObject({ ok: true, enabled: false, source: 'trd' });
  });

  test('a path that exists relative to the cwd is the file used, the same one parse and validate would read', () => {
    const root = repo();
    put(root, 'docs/TRD/x.md', 'standard');
    put(root, 'packages/app/docs/TRD/x.md', 'bdd-reqnroll');
    const { json } = cli(['--trd', 'docs/TRD/x.md'], {}, path.join(root, 'packages', 'app'));
    expect(json).toMatchObject({ ok: true, enabled: true, source: 'trd', evidence: 'docs/TRD/x.md' });
  });

  test('a path found in neither place is an error that names it', () => {
    const root = repo();
    const { status, json } = cli(['--trd', 'docs/TRD/missing.md'], {}, path.join(root, 'packages', 'app'));
    expect(status).toBe(1);
    expect(json.error).toContain("Cannot read TRD file 'docs/TRD/missing.md'");
  });
});

describe('what bdd-mode finds in the TRD reaches the CLI result', () => {
  test('an unrecognised ENSEMBLE_BDD is reported even though the TRD stamp decides', () => {
    const { status, json } = cli(['--trd', trdWith('standard')], { ENSEMBLE_BDD: 'maybe' });
    expect(status).toBe(0);
    expect(json).toMatchObject({ ok: true, enabled: false, source: 'trd' });
    expect(json.warning).toContain("ENSEMBLE_BDD='maybe'");
    expect(json.message).toContain("Warning: ENSEMBLE_BDD='maybe'");
  });

  test('a stamp under an H1 is honoured, so a TRD titled before its frontmatter still opts out', () => {
    const file = path.join(tmp(), 'TRD.md');
    fs.writeFileSync(file, '# TRD: Title\n\n---\ndocument_id: TRD-2026-eeeeeeee\ntest_approach: standard\n---\n\n## Body\n');
    expect(cli(['--trd', file]).json).toMatchObject({ ok: true, enabled: false, source: 'trd' });
    expect(runResolveBdd(['--trd', file], {})).toMatchObject({ enabled: false, source: 'trd' });
  });
});
