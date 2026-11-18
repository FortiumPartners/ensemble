'use strict';

/**
 * br-2q2uz -- PR 3 boundary ("Dependency-aware pickup on kata"), TRD-2026-6995dc96 PR 3,
 * PRD REQ-007 AC-007-1..AC-007-5.
 *
 * One end-to-end check of the shippable state, through the REAL CLI entry point
 * (`node toolchain-cli.js run work-graph.<cap> --json`) in a project whose tracker is `kata`:
 *
 *  - work-graph.ready       lists unblocked work in kata's own order (a blocked item is absent),
 *                           answered by `kata ready`, never by this repo's own readiness logic.
 *  - work-graph.plan        puts every dependency before its dependents (a chain, listed
 *                           dependents-first so listing order cannot satisfy it by accident).
 *  - work-graph.graph-health reports a cycle and a dangling edge as findings, not as silence.
 *  - all three name kata as their source: `ready` is answered by the kata adapter (`adapter`),
 *                           plan/health are in-process module results that carry `orderingSource`.
 *  - a non-kata (tracker-only, "jira-like") project is unchanged: the built-in fallback answers.
 *
 * The `kata` binary is a stub on PATH that serves recorded-shape envelopes from a graph file and
 * implements `ready` as "open items with no open blocker, in priority order" (what real kata
 * does; the real-binary legs live in kata-work-graph.test.js). It never touches a real kata, so
 * this runs identically on a machine without kata and needs no skip. Scratch lives under
 * ~/.omp, never os.tmpdir().
 *
 * `KATA_PR3_ADAPTER_DIR` points at a mutated COPY of the adapter directory for a RED demonstration;
 * it is installed as a project-local package so it is found ahead of the shipped adapter.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  writeNoWorkGraphTrackerStub,
  writeStubControl,
} = require('../../../scripts/tests/fixtures/toolchain/work-graph-fallback-tracker-stub');

const CLI = path.join(__dirname, '..', 'lib', 'toolchain-cli.js');
const SCRATCH = path.join(os.homedir(), '.omp', 'br-2q2uz', `pr3-${process.pid}`);
const MUTANT_ADAPTER_DIR = process.env.KATA_PR3_ADAPTER_DIR;

const issue = (id, priority, blockedBy = []) => ({
  short_id: id,
  title: `t-${id}`,
  status: 'open',
  priority,
  blocked_by: blockedBy.map((b) => ({ short_id: b, status: 'open' })),
});

// Stub `kata`: `list` serves the whole graph; `ready` keeps open items with no open blocker,
// ordered by priority then listing order (kata's own ordering, deliberately not alphabetical).
const STUB = (graphFile) => `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
const issues = JSON.parse(fs.readFileSync(${JSON.stringify(graphFile)}, 'utf8'));
const out = (v) => process.stdout.write(JSON.stringify(v));
if (argv[0] === '--version') { console.log('kata v0.23.0'); }
else if (argv[0] === 'list') { out({ kata_api_version: 1, complete: true, truncated: false, total: issues.length, issues }); }
else if (argv[0] === 'ready') {
  const rows = issues
    .map((i, n) => ({ i, n }))
    .filter(({ i }) => i.status === 'open' && !(i.blocked_by || []).some((b) => b.status === 'open'))
    .sort((a, b) => a.i.priority - b.i.priority || a.n - b.n)
    .map(({ i }) => i);
  out({ kata_api_version: 1, issues: rows });
}
else { process.stderr.write('stub kata: unexpected ' + argv.join(' ') + '\\n'); process.exit(2); }
`;

const dirs = [];

function mkProject(label, graph, { tracker = 'kata' } = {}) {
  const root = path.join(SCRATCH, label);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), `tracker: ${tracker}\n`);
  const graphFile = path.join(root, 'graph.json');
  fs.writeFileSync(graphFile, JSON.stringify(graph));
  fs.writeFileSync(path.join(root, 'bin', 'kata'), STUB(graphFile), { mode: 0o755 });
  const xdg = path.join(root, 'xdg');
  fs.mkdirSync(xdg, { recursive: true });
  if (MUTANT_ADAPTER_DIR) {
    // A package-shaped tree inside the project: `<pkg>/skills/adapter-tracker-kata` plus a
    // `<pkg>/lib` link to the real library (the adapter module finds its runner at ../../lib).
    const pkg = path.join(root, 'packages', 'mutant');
    fs.mkdirSync(path.join(pkg, 'skills'), { recursive: true });
    fs.cpSync(MUTANT_ADAPTER_DIR, path.join(pkg, 'skills', 'adapter-tracker-kata'), { recursive: true });
    fs.symlinkSync(path.join(__dirname, '..', 'lib'), path.join(pkg, 'lib'));
  }
  dirs.push(root);
  return { root, env: { PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, XDG_CONFIG_HOME: xdg } };
}

function cli(project, capability) {
  const res = spawnSync(process.execPath, [CLI, 'run', capability, '--json'], {
    cwd: project.root,
    env: project.env,
    encoding: 'utf8',
  });
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch { parsed = { ok: false, unparsable: res.stdout, stderr: res.stderr }; }
  return { status: res.status, ...parsed };
}

const ids = (r) => r.data.items.map((i) => i.id);

beforeAll(() => fs.mkdirSync(SCRATCH, { recursive: true }));
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

describe('PR 3 boundary: dependency-aware pickup on a kata project (br-2q2uz)', () => {
  describe('chain with a blocked item (AC-007-1, AC-007-2, AC-007-4)', () => {
    // Listed dependents-first: c <- b <- a, bl blocked by a, s standalone with the best priority.
    const graph = [issue('c', 2, ['b']), issue('bl', 2, ['a']), issue('b', 2, ['a']), issue('s', 1), issue('a', 3)];
    let project;
    beforeAll(() => { project = mkProject('chain', graph); });

    test('ready lists only unblocked work, in kata order, and names kata', () => {
      const r = cli(project, 'work-graph.ready');
      expect(r).toMatchObject({ ok: true, status: 0, adapter: 'kata' });
      expect(ids(r)).toEqual(['s', 'a']);
      for (const blocked of ['c', 'bl', 'b']) expect(ids(r)).not.toContain(blocked);
      // AC-007-1: an unchanged item set lists identically twice.
      expect(ids(cli(project, 'work-graph.ready'))).toEqual(ids(r));
    });

    test('plan puts every dependency first and names kata as the ordering source', () => {
      const r = cli(project, 'work-graph.plan');
      expect(r).toMatchObject({ ok: true, status: 0 });
      expect(r.data.orderingSource).toBe('kata');
      expect(r.data.dependencyAware).toBe(true);
      expect(r.data.findings).toEqual([]);
      const order = ids(r);
      expect([...order].sort()).toEqual(['a', 'b', 'bl', 'c', 's']);
      const before = (x, y) => expect(order.indexOf(x)).toBeLessThan(order.indexOf(y));
      before('a', 'b');
      before('b', 'c');
      before('a', 'bl');
    });

    test('graph-health is healthy and names kata', () => {
      const r = cli(project, 'work-graph.graph-health');
      expect(r).toMatchObject({ ok: true, status: 0 });
      expect(r.data).toMatchObject({ status: 'healthy', findings: [], orderingSource: 'kata', dependencyAware: true });
    });
  });

  describe('cycle (AC-007-3)', () => {
    let project;
    beforeAll(() => {
      project = mkProject('cycle', [issue('x', 2, ['y']), issue('y', 2, ['x']), issue('ok', 2)]);
    });

    test('graph-health reports the cycle as a finding; plan does not order it silently; ready still answers', () => {
      const health = cli(project, 'work-graph.graph-health');
      expect(health.ok).toBe(true);
      expect(health.data.status).toBe('unhealthy');
      expect(health.data.orderingSource).toBe('kata');
      expect(health.data.findings).toEqual([expect.objectContaining({ type: 'cycle', items: ['x', 'y'] })]);

      const plan = cli(project, 'work-graph.plan');
      expect(plan.ok).toBe(true);
      expect(plan.data.orderingSource).toBe('kata');
      expect(ids(plan)).toEqual([]);
      expect(plan.data.findings.map((f) => f.type)).toEqual(['cycle']);

      const ready = cli(project, 'work-graph.ready');
      expect(ready).toMatchObject({ ok: true, adapter: 'kata' });
      expect(ids(ready)).toEqual(['ok']);
    });
  });

  describe('dangling edge (AC-007-5)', () => {
    let project;
    beforeAll(() => {
      project = mkProject('dangling', [issue('a', 2, ['ghost']), issue('b', 2)]);
    });

    test('a blocker the scope never returns is a dangling-edge finding for health and plan', () => {
      const health = cli(project, 'work-graph.graph-health');
      expect(health.ok).toBe(true);
      expect(health.data.status).toBe('unhealthy');
      expect(health.data.orderingSource).toBe('kata');
      expect(health.data.findings).toEqual([
        expect.objectContaining({ type: 'dangling-edge', items: ['a'], dependency: 'ghost' }),
      ]);

      const plan = cli(project, 'work-graph.plan');
      expect(plan.ok).toBe(true);
      expect(plan.data.orderingSource).toBe('kata');
      expect(plan.data.findings).toEqual([
        expect.objectContaining({ type: 'dangling-edge', items: ['a'], dependency: 'ghost' }),
      ]);
    });
  });

  describe('a non-kata project is unchanged (jira-like tracker with no work-graph)', () => {
    test('the built-in fallback answers, never kata', () => {
      const root = path.join(SCRATCH, 'jira-like');
      const binDir = path.join(root, 'bin');
      const binPath = writeNoWorkGraphTrackerStub(binDir);
      writeStubControl(binDir, [
        { id: 'j-1', status: 'open', dependencies: [{ id: 'j-2' }] },
        { id: 'j-2', status: 'open', dependencies: [] },
      ]);
      fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
      fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), 'tracker: fixture-jira-like\n');
      const skillDir = path.join(root, 'packages', 'fixture-pkg', 'skills', 'fixture-jira-like');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'adapter.yaml'),
        JSON.stringify({
          adapter: 'fixture-jira-like',
          version: '1.0.0',
          categories: ['tracker'],
          contract: { tracker: '1.0' },
          binaries: [binPath],
          allowlist: [{ bin: binPath, sub: ['list', 'show'] }],
          env: [],
          health: [],
          detect: [],
          capabilities: {
            'tracker.list': { run: [binPath, 'list'] },
            'tracker.show': {
              run: [binPath, 'show', '${id}'],
              parse: {
                format: 'json',
                root: '$',
                map: { id: '$.id', status: '$.status', dependencies: '$.dependencies' },
                statusMap: { open: 'open', in_progress: 'in_progress', closed: 'closed' },
              },
            },
          },
        })
      );
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# fixture-jira-like\n## Vocabulary\nstub\n');
      const project = { root, env: { PATH: process.env.PATH } };

      const ready = cli(project, 'work-graph.ready');
      expect(ready).toMatchObject({ ok: true, status: 0, adapter: 'work-graph-links-fallback' });
      expect(ready.data.orderingSource).toBe('tracker-links');
      expect(ids(ready)).toEqual(['j-2']);
      const plan = cli(project, 'work-graph.plan');
      expect(plan.adapter).toBe('work-graph-links-fallback');
      expect(plan.data.orderingSource).not.toBe('kata');
    });
  });
});
