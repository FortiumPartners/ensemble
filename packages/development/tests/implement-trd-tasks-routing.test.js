'use strict';

/**
 * br-viyk7 (TRD-022-TEST; PRD REQ-009 AC-009-1) -- a kata run scaffolds in kata and never invokes a
 * beads binary, against the REAL kata binary.
 *
 *  Happy: a bound scratch kata project (isolated KATA_HOME under ~/.omp) plus a TRD; the scaffold
 *    sequence implement-trd-tasks Phase 2 prescribes (scaffold-calls, tracker.create-detailed,
 *    scaffold-dep-args, tracker.dep-add, work-graph.ready/plan) runs through the REAL toolchain-cli and
 *    trd-cli; the scratch project then holds every TRD work item with its dependency edges (read back
 *    with `kata show`/`kata list`).
 *  Edge: `br` and `bv` are deliberately broken on PATH (recording stubs that exit 1); the run still
 *    succeeds and the ledger of br/bv invocations is empty.
 *
 * Skips cleanly ("tool absent") without kata. No daemon is left behind: cleanup stops it.
 * Limitation: the guards are PATH-resolved, so an absolute-path invocation of br/bv would bypass them.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { guardKata, kataPath } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');

const PKG = path.join(__dirname, '..');
const TOOLCHAIN_CLI = path.join(PKG, 'lib', 'toolchain-cli.js');
const TRD_CLI = path.join(PKG, 'lib', 'trd-cli.js');
// Optional RED hook: directory of a mutated COPY of the adapter (never the shipped one).
const MUTANT_ADAPTER_DIR = process.env.KATA_ROUTING_ADAPTER_DIR;
const RUN_ID = '49f55f8f-4070-4238-948d-917c765551a4';

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
- [ ] **TRD-002** Wire CI (1h) \`[satisfies INFRA]\` \`[depends: TRD-001]\`
  - Target File: ci.yml
- [ ] **TRD-001-TEST** Test the thing (1h) \`[verifies TRD-001] [satisfies REQ-001] [depends: TRD-001]\`
  - Test AC:
    - Given a thing, when tested, then green.
`;

guardKata('br-viyk7 kata scaffold with broken br/bv (real kata)', () => {
  let ws;
  let guards;
  let kataBin;
  let env;
  let sc;
  let ids;
  let depArgs;

  const ledger = () => {
    const f = path.join(guards, 'ledger.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  };
  const toolchain = (args) => {
    const res = spawnSync(process.execPath, [TOOLCHAIN_CLI, ...args, '--json'], { cwd: ws.workspace, env, encoding: 'utf8', timeout: 120000 });
    try {
      return JSON.parse(res.stdout);
    } catch {
      return { ok: false, unparsable: res.stdout, stderr: res.stderr };
    }
  };
  const runCap = (capability, args = {}) =>
    toolchain(['run', capability, '--run-id', RUN_ID, ...Object.entries(args).flatMap(([k, v]) => ['--arg', `${k}=${v}`])]);
  const trd = (args) => {
    const res = spawnSync(process.execPath, [TRD_CLI, ...args], { cwd: ws.workspace, env, encoding: 'utf8', timeout: 120000 });
    let json;
    try {
      json = JSON.parse(res.stdout);
    } catch {
      json = { ok: false, unparsable: res.stdout };
    }
    return { status: res.status, stderr: res.stderr, json };
  };

  beforeAll(() => {
    ws = kataScratch({ root: path.join(require('os').homedir(), '.omp', 'br-viyk7') });
    ws.init();
    expect(ws.errors).toEqual([]);
    const root = ws.workspace;
    if (MUTANT_ADAPTER_DIR) {
      // RED demonstration: a mutated COPY of the adapter, installed project-local so it is found ahead
      // of the shipped one (`<pkg>/lib` links the real library; the adapter finds its runner at ../../lib).
      const pkg = path.join(root, 'packages', 'mutant');
      fs.mkdirSync(path.join(pkg, 'skills'), { recursive: true });
      fs.cpSync(MUTANT_ADAPTER_DIR, path.join(pkg, 'skills', 'adapter-tracker-kata'), { recursive: true });
      fs.symlinkSync(path.join(PKG, 'lib'), path.join(pkg, 'lib'));
    }
    guards = path.join(ws.dir, 'guards');
    kataBin = path.join(ws.dir, 'katabin');
    fs.mkdirSync(guards, { recursive: true });
    fs.mkdirSync(kataBin, { recursive: true });
    // PATH holds only the real kata (symlinked alone, so no real br/bv sits beside it) and broken br/bv.
    fs.symlinkSync(kataPath(), path.join(kataBin, 'kata'));
    for (const name of ['br', 'bv']) {
      fs.writeFileSync(
        path.join(guards, name),
        `#!/bin/sh\necho "${name} $*" >> "${guards}/ledger.log"\necho "broken ${name}: must never be invoked on a kata run" >&2\nexit 1\n`,
        { mode: 0o755 },
      );
    }
    fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
    fs.mkdirSync(path.join(root, 'docs', 'TRD'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'TRD', 'demo.md'), TRD_TEXT);
    fs.mkdirSync(path.join(root, 'docs', 'PRD'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'PRD', 'demo.md'), '# PRD\n\n#### REQ-001: Thing\nText.\n\n- AC-001-1: Given a, when b, then c.\n');
    env = {
      PATH: `${guards}:${kataBin}:/usr/bin:/bin`,
      HOME: process.env.HOME,
      KATA_HOME: ws.env.KATA_HOME,
      XDG_CONFIG_HOME: path.join(ws.dir, 'xdg'),
      ENSEMBLE_NON_INTERACTIVE: '1',
    };
  }, 60000);
  afterAll(() => {
    if (ws) ws.cleanup();
  });

  test('Happy: scaffold writes the TRD work items and dependency edges into the scratch kata project', () => {
    sc = trd(['scaffold-calls', 'docs/TRD/demo.md']).json;
    expect(sc.ok).toBe(true);
    expect(sc.creates.length).toBeGreaterThan(3);

    const pre = toolchain([
      'preflight', '--run-id', RUN_ID,
      '--require', 'tracker.create-detailed', '--require', 'tracker.dep-add',
      '--require', 'work-graph.ready', '--require', 'work-graph.plan',
    ]);
    expect(pre.ok).toBe(true);

    ids = {};
    for (const entry of sc.creates) {
      const r = runCap('tracker.create-detailed', entry.args);
      expect(r).toMatchObject({ ok: true });
      ids[entry.titlePrefix] = r.data.id;
    }
    const wired = trd(['scaffold-dep-args', 'docs/TRD/demo.md', '--ids', JSON.stringify(ids)]);
    expect(wired.status).toBe(0);
    expect(wired.json.unresolved).toEqual([]);
    depArgs = wired.json.deps;
    expect(depArgs).toHaveLength(sc.deps.length);
    for (const a of depArgs) {
      const r = runCap('tracker.dep-add', a);
      expect(ledger()).toEqual([]); // a beads binary was invoked if this is non-empty
      expect(r.ok).toBe(true);
    }
    expect(runCap('work-graph.ready').ok).toBe(true);
    const plan = runCap('work-graph.plan');
    expect(plan.ok).toBe(true);
    expect(plan.data.items.length).toBe(sc.creates.length);

    // Read back through kata itself: every item exists with its title, and each edge is present.
    const all = parseJson(ws.runInWorkspace(['list', '--status', 'all', '--limit', '0', '--json']).stdout).issues;
    expect(all).toHaveLength(sc.creates.length);
    const titles = all.map((i) => i.title);
    for (const entry of sc.creates) expect(titles).toContain(entry.args.title);
    const edges = new Set();
    for (const item of all) {
      const shown = parseJson(ws.runInWorkspace(['show', item.short_id, '--json']).stdout);
      for (const l of shown.links) if (l.type === 'blocks') edges.add(`${l.from.short_id}->${l.to.short_id}`);
    }
    for (const a of depArgs) {
      // kata edge: from = blocker, to = blocked, type blocks.
      expect(edges.has(`${a.dependsOnId}->${a.id}`)).toBe(true);
    }
    // No extra edges: the distinct blocks links across every item equal the TRD's declared deps.
    expect(edges.size).toBe(sc.deps.length);
    // Happy leg ran with br/bv broken on PATH and never touched them.
    expect(ledger()).toEqual([]);
  }, 240000);

  test('Edge: br and bv are broken on PATH and were never invoked', () => {
    expect(Object.keys(ids || {}).length).toBeGreaterThan(0);
    // The guards are live: invoking them directly fails and records, so an empty ledger is meaningful.
    const probe = spawnSync('sh', ['-c', 'br --version'], { env, encoding: 'utf8' });
    expect(probe.status).toBe(1);
    expect(ledger()).toEqual(['br --version']);
    fs.rmSync(path.join(guards, 'ledger.log'));
    // A re-run of the whole create sequence (idempotent) still succeeds with nothing recorded.
    for (const entry of sc.creates.slice(0, 2)) {
      const r = runCap('tracker.create-detailed', entry.args);
      expect(r).toMatchObject({ ok: true });
      expect(r.data.id).toBe(ids[entry.titlePrefix]);
    }
    expect(ledger()).toEqual([]);
  }, 120000);
});
