'use strict';

/**
 * br-kss6 -- PR 1 boundary ("Kata resolves, preflights, and refuses unsafe workspaces"),
 * TRD-2026-6995dc96 PR 1, PRD REQ-001 / REQ-012 / REQ-018.
 *
 * Shippable State, checked end to end through the REAL CLI entry point
 * (`node toolchain-cli.js resolve|preflight --json`) in scratch projects:
 *
 *  1. `tracker: kata` resolves BOTH tracker and work-graph to kata (source not the shipped
 *     default); an explicit work-graph override leaves tracker = kata.
 *  2. a bound kata 0.23.0 passes preflight and the record carries the reported version.
 *  3. a kata older than the floor stops preflight naming 0.23.0, having been asked only `--version`.
 *  4. kata absent from PATH is a named MISSING_BINARY failure, never a fallback to beads.
 *  5. an unbound workspace stops preflight with the binding prerequisite message and no write
 *     command ever reaches kata.
 *  6. projects without kata configuration are unchanged (beads default, binding file alone does
 *     not select kata, deleting the config reverts, kata's detect list is empty).
 *
 * `kata` is a stub on PATH that logs every invocation, so this runs identically on a machine
 * with or without real kata (no guard or skip needed) and never touches a real daemon. XDG_CONFIG_HOME
 * and KATA_HOME are isolated per project. Scratch lives under ~/.omp, never os.tmpdir().
 *
 * `KATA_PR1_ADAPTER_DIR` points at a mutated COPY of the adapter directory for a RED
 * demonstration; it is installed as a project-local package so it is found ahead of the shipped
 * adapter.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'toolchain-cli.js');
const SHIPPED_ADAPTER_DIR = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata');
const SCRATCH = path.join(os.homedir(), '.omp', 'br-kss6', `pr1-${process.pid}`);
const MUTANT_ADAPTER_DIR = process.env.KATA_PR1_ADAPTER_DIR;

const DOCTOR_BOUND = { checks: [{ id: 'daemon.connection', status: 'ok' }, { id: 'config.workspace', status: 'ok' }] };
const DOCTOR_UNBOUND = {
  checks: [
    { id: 'daemon.connection', status: 'ok' },
    { id: 'config.workspace', status: 'warn', summary: 'No project binding or explicit project' },
  ],
};

// Stub `kata`: logs argv; `--version` prints the configured version; `doctor` prints the
// configured envelope; any other verb is a "write" that is logged and answers a created item.
const stubSource = (dir) => `#!/bin/sh
echo "$*" >> "${dir}/calls.log"
if [ "$1" = "--version" ]; then read -r v < "${dir}/version.txt"; echo "kata v$v"; exit 0; fi
if [ "$1" = "doctor" ]; then read -r d < "${dir}/doctor.json"; echo "$d"; exit 0; fi
echo '{"issue":{"short_id":"k-1"}}'
`;

const dirs = [];

function mkProject(label, { toolchain, version = '0.23.0', doctor = DOCTOR_BOUND, withKata = true, bindingFile = false } = {}) {
  const root = path.join(SCRATCH, label);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(root, 'xdg'), { recursive: true });
  if (toolchain !== undefined) {
    fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), toolchain);
  }
  if (withKata) {
    fs.writeFileSync(path.join(bin, 'version.txt'), `${version}\n`);
    fs.writeFileSync(path.join(bin, 'doctor.json'), `${JSON.stringify(doctor)}\n`);
    fs.writeFileSync(path.join(bin, 'kata'), stubSource(bin), { mode: 0o755 });
  }
  if (bindingFile) fs.writeFileSync(path.join(root, '.kata.toml'), 'project = "scratch"\n');
  if (MUTANT_ADAPTER_DIR) {
    // `<pkg>/skills/adapter-tracker-kata` plus a `<pkg>/lib` link to the real library (the adapter
    // module finds its runner at ../../lib).
    const pkg = path.join(root, 'packages', 'mutant');
    fs.mkdirSync(path.join(pkg, 'skills'), { recursive: true });
    fs.cpSync(MUTANT_ADAPTER_DIR, path.join(pkg, 'skills', 'adapter-tracker-kata'), { recursive: true });
    fs.symlinkSync(path.join(__dirname, '..', 'lib'), path.join(pkg, 'lib'));
  }
  dirs.push(root);
  const calls = () => {
    const log = path.join(bin, 'calls.log');
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  };
  return {
    root,
    bin,
    calls,
    // PATH is the stub dir only (plus nothing else): stubs are #!/bin/sh and the CLI is launched by
    // absolute node path, so no other binary is needed and no real kata/br can leak in.
    env: { PATH: bin, XDG_CONFIG_HOME: path.join(root, 'xdg'), KATA_HOME: path.join(root, 'kata-home'), ENSEMBLE_NON_INTERACTIVE: '1' },
  };
}

function cli(project, args) {
  const res = spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd: project.root, env: project.env, encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch { parsed = { ok: false, unparsable: res.stdout, stderr: res.stderr }; }
  return { status: res.status, ...parsed };
}

const resolve = (project) => cli(project, ['resolve']);
const preflight = (project, runId) =>
  cli(project, ['preflight', '--require', 'tracker.show', '--require', 'work-graph.ready', '--run-id', runId]);
const WRITE_VERBS = /^(create|edit|close|reopen|comment|label|claim|unassign|init)\b/;
const writes = (project) => project.calls().filter((l) => WRITE_VERBS.test(l) || !/^(--version|doctor)\b/.test(l));
const recordFiles = (project) => {
  const dir = path.join(project.root, '.ensemble', 'state', 'toolchain');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

beforeAll(() => fs.mkdirSync(SCRATCH, { recursive: true }));
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

describe('PR 1 boundary: kata resolves, preflights, and refuses unsafe workspaces (br-kss6)', () => {
  describe('leg 1: tracker: kata selects kata for both categories', () => {
    test('tracker AND work-graph resolve to kata from the project config, not the shipped default', () => {
      const p = mkProject('resolve', { toolchain: 'tracker: kata\n' });
      const r = resolve(p);
      expect(r.ok).toBe(true);
      expect(r.data.tracker).toMatchObject({ adapter: 'kata', source: 'project' });
      expect(r.data['work-graph']).toMatchObject({ adapter: 'kata' });
      expect(r.data['work-graph'].source).not.toBe('default');
    });

    test('an explicit work-graph override is honoured and tracker stays kata', () => {
      const p = mkProject('override', { toolchain: 'tracker: kata\nwork-graph: beads\n' });
      const r = resolve(p);
      expect(r.ok).toBe(true);
      expect(r.data.tracker).toMatchObject({ adapter: 'kata', source: 'project' });
      expect(r.data['work-graph']).toMatchObject({ adapter: 'beads', source: 'project' });
    });
  });

  describe('leg 2: bound kata at the floor passes and its version is reported', () => {
    test('preflight ok; the record carries versions.kata = 0.23.0; only read-only probes ran', () => {
      const p = mkProject('pass', { toolchain: 'tracker: kata\n' });
      const r = preflight(p, 'pass-1');
      expect(r).toMatchObject({ ok: true, status: 0 });
      expect(JSON.stringify(r)).toContain('0.23.0');
      const recordFile = path.join(p.root, '.ensemble', 'state', 'toolchain', 'preflight-pass-1.json');
      expect(fs.existsSync(recordFile)).toBe(true);
      const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
      expect(record.versions.kata).toBe('0.23.0');
      expect(writes(p)).toEqual([]);
    });
  });

  describe('leg 3: a too-old kata stops preflight naming the floor', () => {
    test('0.22.9 fails naming 0.23.0; kata was asked only --version; no record written', () => {
      const p = mkProject('old', { toolchain: 'tracker: kata\n', version: '0.22.9' });
      const r = preflight(p, 'old-1');
      expect(r.ok).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.error.message).toContain('0.23.0');
      expect(r.error.message).toContain('0.22.9');
      expect(p.calls()).toEqual(['--version']);
      expect(recordFiles(p).filter((f) => f.startsWith('preflight-'))).toEqual([]);
    });
  });

  describe('leg 4: kata absent from PATH is a named failure, not a fallback', () => {
    test('MISSING_BINARY naming kata; beads is never consulted', () => {
      const p = mkProject('absent', { toolchain: 'tracker: kata\n', withKata: false });
      const r = preflight(p, 'absent-1');
      expect(r.ok).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.error.code).toBe('MISSING_BINARY');
      expect(r.error.message).toContain('kata');
      expect(r.error.message).not.toMatch(/beads|\bbr\b|\bbv\b/i);
      expect(recordFiles(p).filter((f) => f.startsWith('preflight-'))).toEqual([]);
    });
  });

  describe('leg 5: an unbound workspace stops preflight before any item is written', () => {
    test('binding prerequisite message; only --version and doctor reached kata; no write verb', () => {
      const p = mkProject('unbound', { toolchain: 'tracker: kata\n', doctor: DOCTOR_UNBOUND });
      const r = preflight(p, 'unbound-1');
      expect(r.ok).toBe(false);
      expect(r.status).not.toBe(0);
      expect(r.error.message).toContain('kata init --project');
      expect(r.error.message).toContain('.kata.toml');
      const calls = p.calls();
      expect(calls.length).toBeGreaterThan(0);
      for (const line of calls) expect(line).toMatch(/^(--version|doctor)\b/);
      expect(writes(p)).toEqual([]);
      expect(recordFiles(p).filter((f) => f.startsWith('preflight-'))).toEqual([]);
    });
  });

  describe('leg 6: projects without kata configuration are unchanged', () => {
    test('no toolchain config resolves tracker to beads, even with a kata binding file and kata on PATH', () => {
      const p = mkProject('plain', { bindingFile: true });
      const r = resolve(p);
      expect(r.ok).toBe(true);
      expect(r.data.tracker).toMatchObject({ adapter: 'beads', source: 'default' });
      expect(r.data['work-graph'].adapter).toBe('beads');
      expect(p.calls()).toEqual([]);
    });

    test('deleting the kata config reverts to beads', () => {
      const p = mkProject('revert', { toolchain: 'tracker: kata\n' });
      expect(resolve(p).data.tracker.adapter).toBe('kata');
      fs.rmSync(path.join(p.root, '.ensemble', 'toolchain.yaml'));
      const r = resolve(p);
      expect(r.data.tracker).toMatchObject({ adapter: 'beads', source: 'default' });
      expect(r.data['work-graph'].adapter).toBe('beads');
    });

    test('a beads project with kata absent shows no kata-related preflight failure', () => {
      const p = mkProject('beads-nokata', { toolchain: 'tracker: beads\n', withKata: false });
      for (const name of ['br', 'bv']) {
        fs.writeFileSync(path.join(p.bin, name), '#!/bin/sh\necho "' + name + ' 0.1.0"\n', { mode: 0o755 });
      }
      const r = cli(p, ['preflight', '--require', 'tracker.show', '--run-id', 'beads-1']);
      expect(JSON.stringify(r)).not.toMatch(/kata/i);
      expect(r.ok).toBe(true);
    });

    test('the kata manifest declares an empty detect list (kata is never auto-selected)', () => {
      const manifestPath = path.join(MUTANT_ADAPTER_DIR || SHIPPED_ADAPTER_DIR, 'adapter.yaml');
      const manifest = require('js-yaml').load(fs.readFileSync(manifestPath, 'utf8'));
      expect(manifest.adapter).toBe('kata');
      expect(manifest.detect).toEqual([]);
    });
  });
});
