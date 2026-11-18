'use strict';

/**
 * TRD-019-TEST -- verify plan and graph-health end to end on a REAL kata
 * (TRD-2026-6995dc96 TRD-019-TEST; PRD REQ-007 AC-007-2..AC-007-5).
 *
 * Complements tests/kata-work-graph-plan-health.test.js (fixture envelopes and a stub `kata`) by
 * driving the shipped adapter through the resolver's in-process dispatch against a scratch kata
 * project (own KATA_HOME and git state, see helpers/kata-scratch.js):
 *
 *  - Happy: a chain of three items, plan lists each after its blocker and names kata as source.
 *  - Edge:  a cycle, graph-health reports it as a finding and plan lists no ordering for the members.
 *  - Edge:  a blocker in another kata project (never returned by this project's listing),
 *           graph-health reports the dangling edge.
 *
 * Skipped with reason "tool absent" when kata is not on PATH (guardKata). `KATA_WG_ADAPTER_DIR`
 * lets a RED demonstration point at a mutated COPY of the adapter directory.
 */

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const resolver = require('../lib/toolchain/work-graph-resolve');
const { guardKata } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');

const ADAPTER_DIR = process.env.KATA_WG_ADAPTER_DIR || path.join(__dirname, '..', 'skills', 'adapter-tracker-kata');
const MANIFEST = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));
const SCRATCH_PARENT = path.join(os.homedir(), '.omp', 'br-dezcn', 'jest');

guardKata('TRD-019-TEST kata plan and graph-health (real kata)', () => {
  let ws;
  let savedHome;

  beforeAll(() => {
    fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
    ws = kataScratch({ root: SCRATCH_PARENT });
    ws.init();
    expect(ws.errors).toEqual([]);
    // The runner forwards KATA_HOME (manifest env allowlist); it is the only isolation needed.
    savedHome = process.env.KATA_HOME;
    process.env.KATA_HOME = ws.home;
  }, 60000);

  afterAll(() => {
    if (savedHome === undefined) delete process.env.KATA_HOME;
    else process.env.KATA_HOME = savedHome;
    if (ws) ws.cleanup();
  });

  const create = (title) => {
    const id = parseJson(ws.runInWorkspace(['create', title, '--json']).stdout)?.issue?.short_id;
    expect(id).toBeTruthy();
    return id;
  };
  const blockedBy = (id, blocker) => {
    const res = ws.runInWorkspace(['edit', id, '--blocked-by', blocker, '--json']);
    expect(res.status).toBe(0);
  };
  const dispatch = (capability) =>
    resolver.dispatchWorkGraphCapability(
      { value: 'kata', source: 'project', autoVia: 'tracker-capabilities', origin: 'installed', dir: ADAPTER_DIR, manifest: MANIFEST },
      capability,
      {},
      { source: 'project', cwd: ws.workspace }
    );
  const ids = (result) => result.data.items.map((i) => i.id);

  test('AC-007-2/AC-007-4: a chain of three plans each item after its dependency and names kata', async () => {
    // Created dependents-first so listing order cannot satisfy the assertion by accident.
    const c = create('chain c');
    const b = create('chain b');
    const a = create('chain a');
    blockedBy(c, b);
    blockedBy(b, a);

    const result = await dispatch('work-graph.plan');
    expect(result.ok).toBe(true);
    expect(ids(result)).toEqual([a, b, c]);
    expect(result.data.orderingSource).toBe('kata');
    expect(result.data.dependencyAware).toBe(true);
    expect(result.data.findings).toEqual([]);
  }, 60000);

  describe('after the chain', () => {
    test('AC-007-3: a cycle is a graph-health finding and plan leaves its members unordered', async () => {
      const x = create('cycle x');
      const y = create('cycle y');
      blockedBy(x, y);
      blockedBy(y, x);
      const members = [x, y].sort();

      const health = await dispatch('work-graph.graph-health');
      expect(health.ok).toBe(true);
      expect(health.data.status).toBe('unhealthy');
      const cycles = health.data.findings.filter((f) => f.type === 'cycle');
      expect(cycles).toHaveLength(1);
      expect([...cycles[0].items].sort()).toEqual(members);
      expect(health.data.orderingSource).toBe('kata');

      const plan = await dispatch('work-graph.plan');
      expect(plan.ok).toBe(true);
      // work-graph-scan contract: any cycle finding empties `ordered`, so the cycle is never
      // silently ordered (the earlier chain items are withheld too; that is by design).
      expect(plan.data.items).toEqual([]);
      expect(plan.data.orderingSource).toBe('kata');
      const planned = plan.data.findings.filter((f) => f.type === 'cycle');
      expect(planned).toHaveLength(1);
      expect([...planned[0].items].sort()).toEqual(members);
    }, 60000);

    test('AC-007-5: a blocker the project listing never returns is a dangling-edge finding', async () => {
      // A second kata project under the same KATA_HOME supplies an id outside this project's scope.
      const other = path.join(ws.dir, 'other-workspace');
      fs.mkdirSync(other, { recursive: true });
      const git = (args) => {
        const res = cp.spawnSync('git', args, {
          encoding: 'utf8',
          env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(ws.dir, 'gitconfig'), GIT_CONFIG_SYSTEM: path.join(ws.dir, 'gitconfig-system'), GIT_TERMINAL_PROMPT: '0' },
        });
        expect(res.status).toBe(0);
        return res;
      };
      git(['init', '--initial-branch=main', other]);
      git(['-C', other, 'config', 'user.email', 'kata-scratch@example.invalid']);
      git(['-C', other, 'config', 'user.name', 'kata-scratch']);
      git(['-C', other, 'commit', '--allow-empty', '-m', 'binding']);
      git(['-C', other, 'remote', 'add', 'origin', 'git@example.invalid:other-scope.git']);
      const kata = (args) => cp.spawnSync('kata', args, { env: ws.env, cwd: other, encoding: 'utf8' });
      expect(kata(['init', '--project', 'other-scope']).status).toBe(0);
      const foreign = parseJson(kata(['create', 'foreign blocker', '--json']).stdout)?.issue?.short_id;
      expect(foreign).toBeTruthy();

      const dependent = create('depends on foreign');
      const res = ws.runInWorkspace(['edit', dependent, '--blocked-by', `other-scope#${foreign}`, '--json']);
      expect(res.status).toBe(0);

      // Premise checks: the foreign id is not an id this project lists (else the finding would be
      // vacuous), and the edge really is exported on the dependent.
      const listed = parseJson(ws.runInWorkspace(['list', '--status', 'all', '--limit', '0', '--json']).stdout);
      expect(listed.issues.map((i) => i.short_id)).not.toContain(foreign);
      const dep = listed.issues.find((i) => i.short_id === dependent);
      expect((dep.blocked_by || []).map((b) => b.short_id)).toContain(foreign);

      const health = await dispatch('work-graph.graph-health');
      expect(health.ok).toBe(true);
      expect(health.data.status).toBe('unhealthy');
      expect(health.data.findings).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'dangling-edge', items: [dependent], dependency: foreign })])
      );
    }, 60000);
  });
});
