'use strict';

/**
 * br-o515z (TRD-025-TEST; PRD REQ-014 AC-014-1, AC-014-2, AC-014-3): the documented kata
 * starting-point steps really scaffold a fresh kata project, and the documented unbound
 * message really is what stops an unbound workspace.
 *
 *  - Docs leg (no kata needed): the "Prerequisites" section of
 *    skills/implement-trd-tasks-reference/reference/kata-starting-point.md names the binding
 *    file (.kata.toml), `kata init`, and the version floor (0.23.0), and the walkthrough is the
 *    ordered list the test then executes.
 *  - Unbound leg with a stub kata (no kata needed): `toolchain-cli preflight` prints the
 *    documented message and exits nonzero, and the stub records no write verb.
 *  - Real-kata legs (guardKata, isolated KATA_HOME under ~/.omp): an unbound scratch workspace
 *    stops with the documented message and creates no items; a fresh project, following only the
 *    documented steps (kata init, tracker: kata, scaffold), ends with work items in kata.
 *
 * Scratch lives under ~/.omp, never os.tmpdir(). No daemon is started by this file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const { guardKata } = require('./helpers/kata-guard');
const { kataScratch } = require('./helpers/kata-scratch');

const PKG = path.join(__dirname, '..');
const TOOLCHAIN_CLI = path.join(PKG, 'lib', 'toolchain-cli.js');
const TRD_CLI = path.join(PKG, 'lib', 'trd-cli.js');
const RUN_ID = '49f55f8f-4070-4238-948d-917c765551a4';
const SCRATCH = path.join(os.homedir(), '.omp', 'br-o515z', `walkthrough-${process.pid}`);

// KATA_WALKTHROUGH_REF points at a mutated COPY of the doc for a RED demonstration.
const REF = fs.readFileSync(
  process.env.KATA_WALKTHROUGH_REF ||
    path.join(PKG, 'skills', 'implement-trd-tasks-reference', 'reference', 'kata-starting-point.md'),
  'utf8',
);
const adapter = yaml.load(fs.readFileSync(path.join(PKG, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8'));
const FAIL_MESSAGE = adapter.health.find((h) => h.jsonAssert).jsonAssert.failMessage;

const TRD_TEXT = `---
prd_reference: docs/PRD/demo.md
---
# Demo TRD

Summary.

## Master Task List

### PR 1: First

**Shippable State:** Works.

- [ ] **TRD-001** Build the thing (1h) \`[satisfies REQ-001]\`
  - Target File: src/thing.js
  - Implementation AC:
    - Given input, when run, then output is correct.
- [ ] **TRD-001-TEST** Test the thing (1h) \`[verifies TRD-001] [satisfies REQ-001] [depends: TRD-001]\`
  - Test AC:
    - Given a thing, when tested, then green.
`;

/** Section text between "## <heading>" and the next "## ". */
function section(heading) {
  const m = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(REF);
  return m ? m[1] : '';
}

/** Lay out the files the documented step 3 and a TRD need, in `dir`. */
function writeProjectFiles(dir) {
  fs.mkdirSync(path.join(dir, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
  fs.mkdirSync(path.join(dir, 'docs', 'TRD'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'TRD', 'demo.md'), TRD_TEXT);
  fs.mkdirSync(path.join(dir, 'docs', 'PRD'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'PRD', 'demo.md'), '# PRD\n\n#### REQ-001: Thing\nText.\n');
}

function cli(script, args, cwd, env) {
  const res = spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

const preflight = (cwd, env) =>
  cli(TOOLCHAIN_CLI, ['preflight', '--run-id', RUN_ID, '--require', 'tracker.create-detailed'], cwd, env);

describe('kata starting-point docs: prerequisites (AC-014-1)', () => {
  const prereq = section('Prerequisites');

  test('the Prerequisites section names the binding file, the init command and the version floor', () => {
    expect(prereq).not.toBe('');
    expect(prereq).toContain('.kata.toml');
    expect(prereq).toContain('kata init --project <name>');
    expect(prereq).toContain('0.23.0');
    expect(prereq).toContain('tracker: kata');
  });

  test('the walkthrough is the ordered install, init, configure, run list this file executes', () => {
    const steps = section('Fresh-project walkthrough').match(/^\d+\. .*$/gm) || [];
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain('0.23.0');
    expect(steps[1]).toContain('kata init --project');
    expect(steps[2]).toContain('tracker: kata');
    expect(steps[3]).toContain('/ensemble:implement-trd-tasks');
  });

  test('the documented unbound message is the adapter failMessage', () => {
    expect(section('Unbound workspace')).toContain(FAIL_MESSAGE);
  });
});

describe('unbound workspace with a stub kata (AC-014-3, no kata needed)', () => {
  const dir = path.join(SCRATCH, 'stub');
  afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

  test('preflight stops with the documented message and the stub sees no write verb', () => {
    fs.rmSync(dir, { recursive: true, force: true });
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const log = path.join(dir, 'calls.log');
    const doctor = JSON.stringify({ checks: [{ id: 'daemon.connection', status: 'ok' }, { id: 'config.workspace', status: 'warn' }] });
    fs.writeFileSync(
      path.join(bin, 'kata'),
      `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$1" = "--version" ]; then echo "kata v0.23.0"; exit 0; fi\nif [ "$1" = "doctor" ]; then echo '${doctor}'; exit 0; fi\nexit 9\n`,
      { mode: 0o755 },
    );
    const proj = path.join(dir, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    writeProjectFiles(proj);
    const env = { PATH: bin, XDG_CONFIG_HOME: path.join(dir, 'xdg'), KATA_HOME: path.join(dir, 'kata-home'), ENSEMBLE_NON_INTERACTIVE: '1' };
    const res = preflight(proj, env);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain(`kata: ${FAIL_MESSAGE}`);
    const verbs = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0]);
    expect(verbs.filter((v) => !['--version', 'doctor'].includes(v))).toEqual([]);
  });
});

guardKata('br-o515z documented steps against real kata', () => {
  const scratches = [];
  const projectEnv = (ws) => ({ ...ws.env, XDG_CONFIG_HOME: path.join(ws.workspace, '..', 'xdg'), ENSEMBLE_NON_INTERACTIVE: '1' });
  const listAll = (ws) => {
    const out = ws.runInWorkspace(['list', '--status', 'all', '--limit', '0', '--json']);
    return JSON.parse(out.stdout).issues;
  };
  const make = () => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    const ws = kataScratch({ root: SCRATCH });
    scratches.push(ws);
    return ws;
  };
  afterAll(() => {
    scratches.forEach((ws) => ws.cleanup());
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  });

  test('unbound scratch workspace: stops with the documented message and creates no items', () => {
    const ws = make();
    writeProjectFiles(ws.workspace);
    const res = preflight(ws.workspace, projectEnv(ws));
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain(`kata: ${FAIL_MESSAGE}`);
    expect(fs.existsSync(path.join(ws.workspace, '.kata.toml'))).toBe(false);
  }, 60000);

  test('fresh project, documented steps only: work items appear in kata', () => {
    const ws = make();
    // Step 2: kata init --project <name> creates the binding file.
    ws.init();
    expect(ws.errors).toEqual([]);
    expect(fs.existsSync(path.join(ws.workspace, '.kata.toml'))).toBe(true);
    // Step 3: tracker: kata in .ensemble/toolchain.yaml.
    writeProjectFiles(ws.workspace);
    const env = projectEnv(ws);
    // Step 4: preflight passes the binding gate, then the scaffold phase creates items.
    expect(preflight(ws.workspace, env).status).toBe(0);
    expect(listAll(ws)).toHaveLength(0);
    const sc = JSON.parse(cli(TRD_CLI, ['scaffold-calls', 'docs/TRD/demo.md'], ws.workspace, env).stdout);
    expect(sc.ok).toBe(true);
    expect(sc.creates.length).toBeGreaterThan(1);
    for (const entry of sc.creates) {
      const args = Object.entries(entry.args).flatMap(([k, v]) => ['--arg', `${k}=${v}`]);
      const r = JSON.parse(cli(TOOLCHAIN_CLI, ['run', 'tracker.create-detailed', '--run-id', RUN_ID, ...args, '--json'], ws.workspace, env).stdout);
      expect(r.ok).toBe(true);
    }
    const items = listAll(ws);
    expect(items).toHaveLength(sc.creates.length);
    for (const entry of sc.creates) {
      expect(items.some((i) => i.title === entry.args.title)).toBe(true);
    }
  }, 180000);
});
