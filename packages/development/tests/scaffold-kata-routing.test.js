'use strict';

/**
 * br-3wwul (TRD-022; PRD REQ-009 AC-009-1) -- scaffold routing through toolchain capabilities so a
 * kata run never invokes `br` or `bv`.
 *
 *  1. Pure helpers (lib/scaffold-planner.js): `buildScaffoldCalls` turns the scaffold PLAN into the
 *     `tracker.create-detailed` argument sets (deterministic whitespace-free externalKey) and the
 *     ordered `tracker.dep-add` edges; `buildDepArgs` resolves an edge to concrete ids.
 *  2. The skill prose: Step 2.1 names tracker.create-detailed / tracker.dep-add, Step 2.2 names
 *     work-graph.ready / work-graph.plan, and the command manifest declares them.
 *  3. End to end through the REAL `node toolchain-cli.js run ...` with `tracker: kata`: a stub
 *     `kata` on PATH (state in a scratch dir) plus stub `br`/`bv` that record any invocation and
 *     fail. The ledger must show zero br/bv invocations (AC3) while create-detailed, dep-add,
 *     ready and plan were each exercised.
 *
 *  4. A guardKata real-kata leg (isolated KATA_HOME scratch project under ~/.omp) runs the dedupe/create
 *     contract with the scaffold-calls args: create once, repeat create returns the same item (idempotency
 *     key), find-by-key returns it. It skips cleanly with reason "tool absent" when kata is absent.
 *
 * The stub-kata legs need no real kata and no daemon. Scratch lives under ~/.omp, never os.tmpdir().
 *
 * Limitation (AC3 scope): the br/bv guards are PATH-resolved shell stubs, so they record only a
 * PATH-resolved `br`/`bv`; an invocation by absolute path (e.g. /opt/homebrew/bin/br) would bypass
 * them. That is not detectable here; the corroborating evidence is a source scan: scaffold-planner,
 * trd-cli, beads-label and beads-stage spawn only `git` and route tracker work through the toolchain.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

const { buildScaffoldPlan, buildScaffoldCalls, buildDepArgs } = require('../lib/scaffold-planner');
const { runCapability } = require('../lib/toolchain/runner');
const { guardKata } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');
const { readDevelopmentSkill, parseWorkflow } = require('./helpers/skill-workflow');

const PKG = path.join(__dirname, '..');
const TOOLCHAIN_CLI = path.join(PKG, 'lib', 'toolchain-cli.js');
const TRD_CLI = path.join(PKG, 'lib', 'trd-cli.js');
const RUN_ID = '49f55f8f-4070-4238-948d-917c765551a4';
const SCRATCH = path.join(os.homedir(), '.omp', 'br-3wwul', `routing-${process.pid}`);

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

// Stub kata: node script (absolute shebang), state in <dir>/state.json, argv log in <dir>/kata-calls.jsonl.
const kataStub = (dir) => `#!${process.execPath}
const fs = require('fs');
const dir = ${JSON.stringify(dir)};
const argv = process.argv.slice(2);
fs.appendFileSync(dir + '/kata-calls.jsonl', JSON.stringify(argv) + '\\n');
const file = dir + '/state.json';
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { n: 0, items: [] };
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const out = (o) => { process.stdout.write(JSON.stringify(o) + '\\n'); };
const row = (it) => {
  const blockedBy = state.items.filter((o) => (it.blockedBy || []).includes(o.short_id)).map((o) => ({ short_id: o.short_id, status: 'open' }));
  const blocks = state.items.filter((o) => (o.blockedBy || []).includes(it.short_id)).map((o) => ({ short_id: o.short_id, status: 'open' }));
  return { short_id: it.short_id, title: it.title, body: it.body, status: it.status || 'open', labels: it.labels || [], priority: it.priority, metadata: it.key ? { ext_key: it.key } : {}, blocked_by: blockedBy, blocks };
};
const cmd = argv[0];
if (cmd === '--version') { console.log('kata v0.23.0'); }
else if (cmd === 'doctor') { out({ checks: [{ id: 'daemon.connection', status: 'ok' }, { id: 'config.workspace', status: 'ok' }] }); }
else if (cmd === 'create') {
  // Mirrors real kata: the dedupe key is metadata ext_key (the adapter's carrier) and
  // --idempotency-key makes a retried create return the SAME issue rather than a second one.
  const meta = flag('--meta') || '';
  const key = meta.startsWith('ext_key=') ? meta.slice(8) : undefined;
  const idem = flag('--idempotency-key');
  let it = idem && state.items.find((o) => o.idem === idem);
  if (!it) {
    state.n += 1;
    it = { short_id: 'k-' + state.n, title: argv[1], body: flag('--body'), priority: Number(flag('--priority')), key, idem, blockedBy: [], labels: [] };
    state.items.push(it);
    save();
  }
  out({ issue: { short_id: it.short_id } });
}
else if (cmd === 'label') {
  const it = state.items.find((o) => o.short_id === argv[2]);
  if (!it || argv[1] !== 'add') { console.error('bad label'); process.exit(3); }
  it.labels = it.labels || []; if (!it.labels.includes(argv[3])) it.labels.push(argv[3]); save();
  out({ issue: { short_id: it.short_id }, label: { label: argv[3] } });
}
else if (cmd === 'edit') {
  const it = state.items.find((o) => o.short_id === argv[1]);
  const b = flag('--blocked-by');
  if (!it || !b) { console.error('bad edit'); process.exit(3); }
  it.blockedBy = it.blockedBy || []; if (!it.blockedBy.includes(b)) it.blockedBy.push(b); save();
  out({ issue: { short_id: it.short_id } });
}
else if (cmd === 'list' || cmd === 'ready') {
  const meta = flag('--meta') || '';
  // Real kata lists OPEN items unless --status says otherwise (so tracker.list never sees closed ones).
  let items = state.items.filter((o) => flag('--status') === 'all' || (o.status || 'open') === (flag('--status') || 'open'));
  if (meta.startsWith('ext_key=')) items = items.filter((o) => o.key === meta.slice(8));
  if (cmd === 'ready') items = items.filter((o) => !(o.blockedBy || []).length);
  out({ kata_api_version: 1, complete: true, truncated: false, total: items.length, issues: items.map(row) });
}
else { console.error('stub kata: unsupported ' + argv.join(' ')); process.exit(2); }
`;

const trackerBinaryStub = (dir, name) => `#!/bin/sh
echo "${name} $*" >> "${dir}/ledger.log"
echo "stub ${name}: must never be invoked on a kata run" >&2
exit 1
`;

let project;

function mkProject() {
  const root = SCRATCH;
  fs.rmSync(root, { recursive: true, force: true });
  const bin = path.join(root, 'bin');
  const guards = path.join(root, 'guards');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(guards, { recursive: true });
  fs.mkdirSync(path.join(root, 'xdg'), { recursive: true });
  fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
  fs.mkdirSync(path.join(root, 'docs', 'TRD'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'TRD', 'demo.md'), TRD_TEXT);
  fs.mkdirSync(path.join(root, 'docs', 'PRD'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'PRD', 'demo.md'), '# PRD\n\n#### REQ-001: Thing\nText.\n\n- AC-001-1: Given a, when b, then c.\n');
  fs.writeFileSync(path.join(bin, 'kata'), kataStub(bin), { mode: 0o755 });
  for (const name of ['br', 'bv']) fs.writeFileSync(path.join(guards, name), trackerBinaryStub(guards, name), { mode: 0o755 });
  spawnSync('git', ['init', '-q'], { cwd: root });
  const ledger = () => {
    const f = path.join(guards, 'ledger.log');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  };
  const kataCalls = () => {
    const f = path.join(bin, 'kata-calls.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  // toolchain-cli sees ONLY the kata stub dir plus the br/bv guards (guards FIRST would shadow a
  // real br; kata dir has no br/bv). trd-cli additionally needs git from the system PATH.
  const baseEnv = { XDG_CONFIG_HOME: path.join(root, 'xdg'), KATA_HOME: path.join(root, 'kata-home'), ENSEMBLE_NON_INTERACTIVE: '1' };
  return {
    root,
    ledger,
    kataCalls,
    tcEnv: { ...baseEnv, PATH: `${bin}:${guards}` },
    trdEnv: { ...baseEnv, PATH: `${guards}:${bin}:/usr/bin:/bin` },
  };
}

function toolchain(args) {
  const res = spawnSync(process.execPath, [TOOLCHAIN_CLI, ...args, '--json'], { cwd: project.root, env: project.tcEnv, encoding: 'utf8' });
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    parsed = { ok: false, unparsable: res.stdout, stderr: res.stderr };
  }
  return parsed;
}

function trd(args) {
  const res = spawnSync(process.execPath, [TRD_CLI, ...args], { cwd: project.root, env: project.trdEnv, encoding: 'utf8' });
  return { status: res.status, stderr: res.stderr, json: JSON.parse(res.stdout) };
}

const runCap = (capability, args = {}) =>
  toolchain(['run', capability, '--run-id', RUN_ID, ...Object.entries(args).flatMap(([k, v]) => ['--arg', `${k}=${v}`])]);

beforeAll(() => {
  fs.mkdirSync(path.dirname(SCRATCH), { recursive: true });
  project = mkProject();
});
afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

const OPTS = { trdSlug: 'demo', trdFilePath: 'docs/TRD/demo.md', prdFilePath: '' };
const parsedTrd = () => ({
  title: 'Demo',
  summary: 'S',
  prFormat: true,
  phases: [{ n: 1, title: 'First', shippableState: 'Works', taskIds: ['TRD-001', 'TRD-002'] }],
  tasksById: {
    'TRD-001': { id: 'TRD-001', phaseN: 1, description: 'A', isTest: false, satisfies: [], dependsOn: [], targetFiles: [], actions: [], implementationAc: [], testAc: [], nestedSubitems: [], testSubitems: [] },
    'TRD-002': { id: 'TRD-002', phaseN: 1, description: 'B', isTest: false, satisfies: [], dependsOn: ['TRD-001'], targetFiles: [], actions: [], implementationAc: [], testAc: [], nestedSubitems: [], testSubitems: [] },
  },
});

describe('buildScaffoldCalls / buildDepArgs (pure)', () => {
  const plan = buildScaffoldPlan(parsedTrd(), OPTS);
  let calls;
  beforeAll(() => {
    calls = buildScaffoldCalls(plan);
  });

  test('one create-detailed argument set per plan entry, in epic, stories, tasks, tests order', () => {
    const n = 1 + plan.stories.length + plan.tasks.length + plan.synthesizedTests.length;
    expect(calls.creates).toHaveLength(n);
    expect(calls.creates[0]).toMatchObject({ kind: 'epic', titlePrefix: plan.epic.titlePrefix });
    expect(calls.creates.map((c) => c.kind)).toEqual(['epic', ...plan.stories.map(() => 'story'), ...plan.tasks.map(() => 'task'), ...plan.synthesizedTests.map(() => 'test')]);
  });

  test('args carry title, description, type, labels, priority and a whitespace-free externalKey', () => {
    const c = calls.creates[0];
    expect(c.args).toEqual({
      title: plan.epic.title,
      description: plan.epic.description,
      type: 'epic',
      labels: 'demo',
      priority: '2',
      externalKey: 'trd:demo',
    });
    for (const e of calls.creates) {
      expect(e.args.externalKey).toMatch(/^\S+$/);
      expect(e.args.externalKey.startsWith('trd:demo')).toBe(true);
    }
    expect(new Set(calls.creates.map((e) => e.args.externalKey)).size).toBe(calls.creates.length);
  });

  test('deps preserve plan.deps order with title-prefix endpoints', () => {
    expect(calls.deps).toEqual(plan.deps.map((d) => ({ type: d.type, blockerPrefix: d.blockerId, blockedPrefix: d.blockedId })));
  });

  test('buildDepArgs maps an edge to tracker.dep-add args; unresolved endpoints give null', () => {
    const edge = calls.deps[0];
    const ids = { [edge.blockerPrefix]: 'k-9', [edge.blockedPrefix]: 'k-3' };
    expect(buildDepArgs(edge, ids)).toEqual({ id: 'k-3', dependsOnId: 'k-9', type: 'blocks' });
    expect(buildDepArgs(edge, { [edge.blockerPrefix]: 'k-9' })).toBeNull();
  });
});

describe('skill prose and command manifest (AC1, AC2)', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'commands', 'implement-trd-tasks.yaml'), 'utf8'));
  const phases = parseWorkflow(readDevelopmentSkill(manifest.skill));
  const stepText = (phaseName, titleRe) => {
    const phase = phases.find((p) => p.name === phaseName);
    const step = phase.steps.find((s) => titleRe.test(s.title));
    return step.actions.join('\n');
  };

  test('Step 2.1 creates through tracker.create-detailed and wires edges through tracker.dep-add', () => {
    const t = stepText('Scaffold', /Plan and create/);
    expect(t).toMatch(/tracker\.create-detailed/);
    expect(t).toMatch(/tracker\.dep-add/);
    expect(t).toMatch(/scaffold-calls/);
    expect(t).toMatch(/externalKey/);
    expect(t).toMatch(/scaffold-dep-args/);
  });

  test('Step 2.1 states exactly when find-by-key fires and the kata label gap', () => {
    const t = stepText('Scaffold', /Plan and create/);
    expect(t).toMatch(/not cached/);
    expect(t).toMatch(/open-only|open items only/);
    expect(t).toMatch(/closed/);
    expect(t).toMatch(/carries no labels or type/);
    expect(t).toMatch(/tracker\.label/);
  });

  test('Step 2.2 runs work-graph.ready and work-graph.plan through the toolchain CLI', () => {
    const t = stepText('Scaffold', /Work-graph analysis/);
    expect(t).toMatch(/work-graph\.ready/);
    expect(t).toMatch(/work-graph\.plan/);
    expect(t).toMatch(/\$TOOLCHAIN_CLI/);
  });

  test('manifest declares the capabilities the scaffold now calls', () => {
    const all = [...manifest.metadata.capabilities.required, ...manifest.metadata.capabilities.optional];
    for (const id of ['tracker.create-detailed', 'tracker.find-by-key', 'work-graph.ready', 'tracker.dep-add', 'work-graph.plan']) {
      expect(all).toContain(id);
    }
  });

  test('scaffold prose never names br or bv', () => {
    const t = stepText('Scaffold', /Plan and create/) + stepText('Scaffold', /Work-graph analysis/);
    expect(t).not.toMatch(/\bbr\b|\bbv\b|--robot-/);
  });
});

// The Step 2.1 algorithm, as the prose states it: tracker.list cache keyed by title prefix (open items
// only on kata); for an entry not cached, tracker.find-by-key on its externalKey (finds closed items
// too); otherwise tracker.create-detailed. Returns ids by title prefix and what was created.
function runScaffold(sc) {
  const listed = runCap('tracker.list');
  expect(listed.ok).toBe(true);
  const cache = {};
  for (const it of listed.data.items || []) {
    const m = /^\[[^\]]+\]/.exec(it.title || '');
    if (m) cache[m[0]] = it.id;
  }
  const idByPrefix = {};
  const created = [];
  const found = [];
  for (const entry of sc.creates) {
    if (cache[entry.titlePrefix]) {
      idByPrefix[entry.titlePrefix] = cache[entry.titlePrefix];
      continue;
    }
    const hit = runCap('tracker.find-by-key', { key: entry.args.externalKey });
    if (hit.ok && hit.data.items && hit.data.items.length) {
      idByPrefix[entry.titlePrefix] = hit.data.items[0].id;
      found.push(entry.titlePrefix);
      continue;
    }
    const r = runCap('tracker.create-detailed', entry.args);
    expect(r).toMatchObject({ ok: true });
    expect(r.data.id).toMatch(/^k-\d+$/);
    idByPrefix[entry.titlePrefix] = r.data.id;
    created.push(entry.titlePrefix);
  }
  return { idByPrefix, created, found };
}

function wireDeps(idByPrefix) {
  const res = trd(['scaffold-dep-args', 'docs/TRD/demo.md', '--ids', JSON.stringify(idByPrefix)]);
  expect(res.status).toBe(0);
  expect(res.json.ok).toBe(true);
  expect(res.json.unresolved).toEqual([]);
  for (const a of res.json.deps) expect(runCap('tracker.dep-add', a).ok).toBe(true);
  return res.json.deps;
}

describe('kata end to end through toolchain-cli (AC1, AC2, AC3)', () => {
  let sc;
  let first;
  let depArgs;

  test('scaffold-calls, create-detailed, dep-add (via scaffold-dep-args), ready and plan run with zero br/bv invocations', () => {
    sc = trd(['scaffold-calls', 'docs/TRD/demo.md']).json;
    expect(sc.ok).toBe(true);
    expect(sc.creates.length).toBeGreaterThan(3);

    const pre = toolchain([
      'preflight', '--run-id', RUN_ID,
      '--require', 'tracker.create-detailed', '--require', 'tracker.dep-add',
      '--require', 'work-graph.ready', '--require', 'work-graph.plan',
    ]);
    expect(pre.ok).toBe(true);

    first = runScaffold(sc);
    expect(first.created).toHaveLength(sc.creates.length);
    depArgs = wireDeps(first.idByPrefix);
    expect(depArgs).toHaveLength(sc.deps.length);

    expect(runCap('work-graph.ready').ok).toBe(true);
    const plan = runCap('work-graph.plan');
    expect(plan.ok).toBe(true);
    expect(plan.data.dependencyAware).toBe(true);
    expect(plan.data.findings).toEqual([]);
    expect(plan.data.items.length).toBe(sc.creates.length);
    const order = plan.data.items.map((i) => i.id);
    for (const a of depArgs) expect(order.indexOf(a.dependsOnId)).toBeLessThan(order.indexOf(a.id));

    const calls = project.kataCalls();
    expect(calls.filter((c) => c[0] === 'edit' && c.includes('--blocked-by'))).toHaveLength(sc.deps.length);
    expect(calls.some((c) => c[0] === 'ready')).toBe(true);
    expect(calls.some((c) => c[0] === 'list' && c.includes('--include-total'))).toBe(true);
    expect(project.ledger()).toEqual([]);
  }, 180000);

  test('--body, --priority, --meta ext_key and --idempotency-key reach kata for every create', () => {
    const creates = project.kataCalls().filter((c) => c[0] === 'create');
    expect(creates).toHaveLength(sc.creates.length);
    const state = JSON.parse(fs.readFileSync(path.join(project.root, 'bin', 'state.json'), 'utf8'));
    for (const entry of sc.creates) {
      const argv = creates.find((c) => c[1] === entry.args.title);
      expect(argv).toBeDefined();
      const val = (f) => argv[argv.indexOf(f) + 1];
      expect(val('--body')).toBe(entry.args.description);
      expect(val('--priority')).toBe(entry.args.priority);
      expect(val('--meta')).toBe(`ext_key=${entry.args.externalKey}`);
      expect(val('--idempotency-key')).toBe(entry.args.externalKey);
      const item = state.items.find((o) => o.short_id === first.idByPrefix[entry.titlePrefix]);
      expect(item).toMatchObject({ body: entry.args.description, priority: Number(entry.args.priority), key: entry.args.externalKey });
    }
  });

  test('re-running the scaffold creates nothing: open entries come from tracker.list, a closed one from tracker.find-by-key', () => {
    // Close one entry in the stub: kata's tracker.list is open-only, so it is not cached and only
    // find-by-key (--status all) can see it.
    const stateFile = path.join(project.root, 'bin', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const closedPrefix = sc.creates[sc.creates.length - 1].titlePrefix;
    const closedId = first.idByPrefix[closedPrefix];
    state.items.find((o) => o.short_id === closedId).status = 'closed';
    fs.writeFileSync(stateFile, JSON.stringify(state));

    const before = project.kataCalls().filter((c) => c[0] === 'create').length;
    const second = runScaffold(sc);
    expect(second.created).toEqual([]);
    expect(second.found).toEqual([closedPrefix]);
    expect(second.idByPrefix).toEqual(first.idByPrefix);
    expect(project.kataCalls().filter((c) => c[0] === 'create')).toHaveLength(before);
    // Edges re-wired once more are idempotent no-ops (no new item, no throw).
    wireDeps(second.idByPrefix);
    expect(project.ledger()).toEqual([]);
  }, 180000);

  test('Delegate-phase label backfill (trd-cli beads-label) works on kata: labels the TRD, then is a no-op', () => {
    const run1 = trd(['beads-label', '--label', 'demo', '--match', '[trd:demo']);
    expect(run1.status).toBe(0);
    expect(run1.json).toMatchObject({ ok: true, label: 'demo' });
    // The closed entry is not in kata's open-only tracker.list, so it is not matched.
    expect(run1.json.matched).toBe(sc.creates.length - 1);
    expect(run1.json.labeled).toBe(sc.creates.length - 1);
    const state = JSON.parse(fs.readFileSync(path.join(project.root, 'bin', 'state.json'), 'utf8'));
    expect(state.items.filter((o) => (o.labels || []).includes('demo'))).toHaveLength(sc.creates.length - 1);
    const run2 = trd(['beads-label', '--label', 'demo', '--match', '[trd:demo']);
    expect(run2.json).toMatchObject({ ok: true, matched: sc.creates.length - 1, labeled: 0, already: sc.creates.length - 1 });
    expect(project.ledger()).toEqual([]);
  });

  test('scaffold-dep-args reports unresolvable edges instead of guessing ids', () => {
    const partial = Object.fromEntries(Object.entries(first.idByPrefix).slice(0, 1));
    const res = trd(['scaffold-dep-args', 'docs/TRD/demo.md', '--ids', JSON.stringify(partial)]);
    expect(res.json.ok).toBe(true);
    expect(res.json.deps).toEqual([]);
    expect(res.json.unresolved).toHaveLength(sc.deps.length);
  });

  test('beads-stage on kata never invokes br: untracked export is skipped, a tracked one reports unavailable', () => {
    const skipped = trd(['beads-stage', '--match', '[trd:demo']);
    expect(skipped.json).toMatchObject({ ok: true, tracked: false, skipped: true });
    fs.mkdirSync(path.join(project.root, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(project.root, '.beads', 'issues.jsonl'), '');
    const git = (a) => spawnSync('git', a, { cwd: project.root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git(['add', '.beads/issues.jsonl']);
    expect(git(['commit', '-q', '-m', 'seed']).status).toBe(0);
    const tracked = trd(['beads-stage', '--match', '[trd:demo']);
    expect(tracked.status).toBe(0);
    expect(tracked.json).toMatchObject({ ok: true, tracked: true, staged: false, unavailable: true });
    expect(project.ledger()).toEqual([]);
  });
});

// Real kata: the dedupe/create contract the scaffold relies on (ext_key metadata + idempotency key +
// find-by-key including closed) against the REAL binary, isolated KATA_HOME, scratch under ~/.omp.
guardKata('br-3wwul scaffold create-detailed dedupe (real kata)', () => {
  const adapterManifest = yaml.load(fs.readFileSync(path.join(PKG, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8'));
  const parent = path.join(os.homedir(), '.omp', 'br-3wwul', 'jest');
  let ws;
  let opts;

  beforeAll(() => {
    fs.mkdirSync(parent, { recursive: true });
    ws = kataScratch({ root: parent });
    ws.init();
    expect(ws.errors).toEqual([]);
    opts = { parentEnv: { ...ws.env }, execFileOptions: { cwd: ws.workspace } };
  }, 60000);
  afterAll(() => {
    if (ws) ws.cleanup();
  });

  test('scaffold-calls args create once, a repeat create returns the same item, find-by-key returns it', async () => {
    const plan = buildScaffoldPlan(parsedTrd(), OPTS);
    const { creates } = buildScaffoldCalls(plan);
    const entry = creates[0];
    const a = await runCapability(adapterManifest, 'tracker.create-detailed', entry.args, opts);
    expect(a.ok).toBe(true);
    const b = await runCapability(adapterManifest, 'tracker.create-detailed', entry.args, opts);
    expect(b.ok).toBe(true);
    expect(b.data.id).toBe(a.data.id);
    const shown = parseJson(ws.runInWorkspace(['show', a.data.id, '--json']).stdout).issue;
    expect(shown.metadata.ext_key).toBe(entry.args.externalKey);
    expect(shown.body).toBe(entry.args.description);
    expect(shown.priority).toBe(Number(entry.args.priority));
    const all = parseJson(ws.runInWorkspace(['list', '--status', 'all', '--limit', '0', '--json']).stdout).issues;
    expect(all).toHaveLength(1);
    const hit = await runCapability(adapterManifest, 'tracker.find-by-key', { key: entry.args.externalKey }, opts);
    expect(hit.ok).toBe(true);
    expect(hit.data.items).toHaveLength(1);
    expect(hit.data.items[0]).toMatchObject({ id: a.data.id, external_ref: entry.args.externalKey });
  }, 120000);
});
