'use strict';

/**
 * TRD-014-TEST -- every fallback-bearing tracker capability answers from kata (TRD-2026-6995dc96
 * TRD-014; PRD REQ-006 AC-006-1).
 *
 * The fallback-bearing set is DERIVED from the shipped tracker contract (every capability that
 * carries a `fallback`), never hard-coded, and the kata manifest must declare each one: a
 * capability added to the contract later has no invocation args here and fails the suite.
 *
 *  - Unguarded leg (recording stub kata under ~/.omp/br-lulpv): each capability runs through the
 *    real runner, names `kata` as its adapter, carries no `fallback`/`unavailable` field, and
 *    spawns exactly one kata process (the call was answered by the adapter, not routed elsewhere).
 *  - Guarded leg (guardKata, isolated KATA_HOME, daemon not started by this file): the same six
 *    capabilities against a real kata project.
 *
 * `KATA_FALLBACK_MANIFEST` may point at a mutated COPY of the manifest for a RED demonstration.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability } = require('../lib/toolchain/runner');
const cli = require('../lib/toolchain-cli');
const { resolveWorkGraphAdapter, dispatchWorkGraphCapability } = require('../lib/toolchain/work-graph-resolve');
const { loadContracts } = require('../lib/toolchain/contracts');
const { guardKata } = require('./helpers/kata-guard');
const { kataScratch } = require('./helpers/kata-scratch');

const ADAPTER_DIR = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata');
const MANIFEST = yaml.load(
  fs.readFileSync(process.env.KATA_FALLBACK_MANIFEST || path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8')
);
const CONTRACTS = loadContracts();
const SCRATCH_PARENT = path.join(os.homedir(), '.omp', 'br-lulpv', 'jest');
const REASON = 'Closed to prove the fallback-bearing close capability answers from kata itself';

/** Fallback ids named by the shipped contracts; none may ever be the source of a kata answer. */
const FALLBACK_IDS = new Set(
  Object.values(CONTRACTS).flatMap((c) =>
    Object.values(c.capabilities || {}).map((cap) => cap.fallback).filter(Boolean)
  )
);
const FALLBACK_BEARING = Object.entries(CONTRACTS['tracker.yaml'].capabilities)
  .filter(([, cap]) => cap.fallback)
  .map(([name]) => name)
  .sort();
const WORK_GRAPH_FALLBACK_BEARING = Object.entries(CONTRACTS['work-graph.yaml'].capabilities)
  .filter(([, cap]) => cap.fallback)
  .map(([name]) => name)
  .sort();

/** Invocation args per capability; `id` is the item the capability acts on. */
const ARGS = {
  'tracker.label': (id) => ({ ids: id, labels: 'fallback-check' }),
  'tracker.stage-export': () => ({ scope: 'all' }),
  'tracker.create-detailed': () => ({
    title: 'fallback create',
    description: 'fallback create body',
    priority: 2,
    externalKey: 'FALLBACK-CREATE-1',
  }),
  'tracker.find-by-key': () => ({ key: 'FALLBACK-FIND-1' }),
  'tracker.update-detailed': (id) => ({
    id,
    title: 'fallback updated',
    description: 'fallback updated body',
    priority: 3,
    notes: 'fallback note',
  }),
  'tracker.close-with-reason': (id) => ({ id, reason: REASON, commit: 'abc1234' }),
};

/**
 * First argv elements the kata process must receive per capability (what the manifest declares).
 * `calls()[0]` being this prefix is what shows the call went to the kata subcommand that answers
 * the capability, rather than being re-routed to a title-prefix, full-export or skip path.
 */
const EXPECTED_ARGV_PREFIX = {
  'tracker.label': (id) => ['label', 'add', id, 'fallback-check'],
  'tracker.stage-export': () => ['doctor'],
  'tracker.create-detailed': () => ['create', 'fallback create'],
  'tracker.find-by-key': () => ['list'],
  'tracker.update-detailed': (id) => ['edit', id, '--title', 'fallback updated'],
  'tracker.close-with-reason': (id) => ['close', id, '--done', '-m', REASON, '--commit', 'abc1234'],
};

/**
 * Every envelope-level claim about who answered: names kata, never a fallback.
 *
 * `res.source` is deliberately NOT asserted here: the runner copies `opts.source` into the
 * envelope unchanged (runner.js), so a test that supplies it and reads it back proves nothing.
 * `res.adapter` is derived from the manifest and is the real signal; where `source` matters it is
 * asserted from the resolver itself (see the resolver test below).
 */
function expectAnsweredByKata(res, capability) {
  expect(res.ok).toBe(true);
  expect(res.capability).toBe(capability);
  expect(res.adapter).toBe('kata');
  expect(FALLBACK_IDS.has(res.adapter)).toBe(false);
  expect(res).not.toHaveProperty('fallback');
  expect(res).not.toHaveProperty('unavailable');
  expect(res).not.toHaveProperty('error');
}

describe('TRD-014 fallback-bearing set is derived from the contract', () => {
  test('the contract marks the six expected tracker capabilities optional-with-fallback', () => {
    expect(FALLBACK_BEARING).toEqual(
      [
        'tracker.close-with-reason',
        'tracker.create-detailed',
        'tracker.find-by-key',
        'tracker.label',
        'tracker.stage-export',
        'tracker.update-detailed',
      ].sort()
    );
    for (const name of FALLBACK_BEARING) {
      expect(CONTRACTS['tracker.yaml'].capabilities[name].required).toBe(false);
    }
  });

  test.each(FALLBACK_BEARING)('the kata manifest declares %s', (name) => {
    expect(MANIFEST.capabilities[name]).toBeDefined();
    expect(Array.isArray(MANIFEST.capabilities[name].run)).toBe(true);
  });

  test('the shipped contracts name the fallback ids this suite guards against', () => {
    for (const id of ['title-prefix-scoping', 'full-export-unscoped', 'skip-finding-beads', 'work-graph-links-fallback']) {
      expect(FALLBACK_IDS.has(id)).toBe(true);
    }
  });

  test.each(WORK_GRAPH_FALLBACK_BEARING)('the kata manifest declares %s too (no links fallback)', (name) => {
    expect(MANIFEST.capabilities[name]).toBeDefined();
  });

  test('every derived capability has invocation args here (a newly added one fails until covered)', () => {
    expect(Object.keys(ARGS).sort()).toEqual(FALLBACK_BEARING);
  });
});

describe('TRD-014 fallback-bearing capabilities answer from kata (recording stub kata)', () => {
  const dir = path.join(SCRATCH_PARENT, `stub-${process.pid}`);
  const log = path.join(dir, 'argv.log');
  let opts;

  beforeAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'cwd'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'kata'),
      [
        '#!/usr/bin/env node',
        "'use strict';",
        "require('fs').appendFileSync(__dirname + '/argv.log', JSON.stringify(process.argv.slice(2)) + '\\n');",
        'const sub = process.argv[2];',
        "const issue = { short_id: 'ab3d', status: 'open' };",
        "let out = { kata_api_version: 1, issue, event: { type: 'issue.updated' }, changed: true };",
        "if (sub === 'list') out = { issues: [], complete: true, truncated: false };",
        "if (sub === 'doctor') out = { checks: [] };",
        "if (sub === 'label') out.label = { label: 'fallback-check' };",
        "if (sub === 'close') out.issue = { short_id: 'ab3d', status: 'closed' };",
        'process.stdout.write(JSON.stringify(out));',
        '',
      ].join('\n')
    );
    fs.chmodSync(path.join(dir, 'kata'), 0o755);
    opts = {
      parentEnv: { PATH: `${dir}${path.delimiter}${process.env.PATH}`, HOME: dir },
      execFileOptions: { cwd: path.join(dir, 'cwd') },
    };
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => fs.rmSync(log, { force: true }));

  const calls = () =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

  test.each(FALLBACK_BEARING)('AC-006-1: %s is answered by kata, one kata process, no fallback routing', async (name) => {
    const res = await runCapability(MANIFEST, name, ARGS[name]('ab3d'), opts);
    expectAnsweredByKata(res, name);
    expect(calls()).toHaveLength(1);
    const argv = calls()[0];
    const expected = EXPECTED_ARGV_PREFIX[name]('ab3d');
    expect(argv.slice(0, expected.length)).toEqual(expected);
    // No title-prefix label scoping: ids, labels and titles reach kata verbatim.
    for (const token of argv) expect(token).not.toMatch(/^\[[^\]]*\]/);
    if (name === 'tracker.label') expect(argv).toEqual(['label', 'add', 'ab3d', 'fallback-check', '--json']);
    if (name === 'tracker.find-by-key') expect(argv).toContain('ext_key=FALLBACK-FIND-1');
  });

  test('every derived capability has an expected kata subcommand here', () => {
    expect(Object.keys(EXPECTED_ARGV_PREFIX).sort()).toEqual(FALLBACK_BEARING);
  });

  test('tracker.stage-export answers in-band and spawns no kata export', async () => {
    const res = await runCapability(MANIFEST, 'tracker.stage-export', { scope: 'all' }, opts);
    expectAnsweredByKata(res, 'tracker.stage-export');
    expect(calls()[0][0]).toBe('doctor');
  });

  test('with no source supplied the envelope still names kata as adapter and carries no fallback field', async () => {
    for (const name of FALLBACK_BEARING) {
      const res = await runCapability(MANIFEST, name, ARGS[name]('ab3d'), opts);
      expectAnsweredByKata(res, name);
      expect(res.source == null).toBe(true);
    }
  });
});

describe('TRD-014 the resolver names kata as adapter and source (real resolution path)', () => {
  const dir = path.join(SCRATCH_PARENT, `resolve-${process.pid}`);
  beforeAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ensemble', 'toolchain.yaml'), 'tracker: kata\n');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('a project selecting tracker: kata resolves tracker and work-graph to kata, not a builtin fallback', () => {
    const ctx = { projectRoot: dir, env: { XDG_CONFIG_HOME: path.join(dir, 'xdg'), ENSEMBLE_NON_INTERACTIVE: '1' } };
    const res = cli.resolve(ctx);
    expect(res.ok).toBe(true);
    expect(res.data.tracker).toMatchObject({ adapter: 'kata', source: 'project' });
    expect(res.data['work-graph']).toMatchObject({ adapter: 'kata', source: 'project', autoVia: 'tracker-capabilities' });
    expect(FALLBACK_IDS.has(res.data['work-graph'].adapter)).toBe(false);
    const resolved = resolveWorkGraphAdapter(ctx);
    expect(resolved.autoVia).not.toBe('builtin-fallback');
  });
});

guardKata('TRD-014-TEST fallback-bearing capabilities answer from kata (real kata)', () => {
  let ws;
  let opts;

  beforeAll(() => {
    fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
    ws = kataScratch({ root: SCRATCH_PARENT });
    ws.init();
    expect(ws.errors).toEqual([]);
    opts = { parentEnv: { ...ws.env }, execFileOptions: { cwd: ws.workspace } };
  }, 60000);

  afterAll(() => {
    if (ws) ws.cleanup();
  });

  async function seed(key) {
    const res = await runCapability(MANIFEST, 'tracker.create-detailed', {
      title: `seed ${key}`,
      description: 'seed body',
      priority: 2,
      externalKey: key,
    }, opts);
    expectAnsweredByKata(res, 'tracker.create-detailed');
    return res.data.id;
  }

  test('AC-006-1: each fallback-bearing capability is answered by the kata adapter', async () => {
    const id = await seed('FALLBACK-FIND-1');
    const results = {};
    for (const name of FALLBACK_BEARING) {
      // create-detailed uses its own key so it does not collide with the seeded item's idempotency key
      const res = await runCapability(MANIFEST, name, ARGS[name](id), opts);
      expectAnsweredByKata(res, name);
      results[name] = res;
    }
    expect(results['tracker.create-detailed'].data.id).toBeTruthy();
    expect(results['tracker.find-by-key'].data.items.map((i) => i.id)).toEqual([id]);
    expect(results['tracker.label'].data).toMatchObject({ id, label: 'fallback-check' });
    expect(results['tracker.update-detailed'].data.id).toBe(id);
    expect(results['tracker.stage-export'].data.status).toBe('unavailable');
    expect(results['tracker.close-with-reason'].ok).toBe(true);
  }, 120000);

  test('the writes really happened in kata (not a substituted fallback)', async () => {
    const id = await seed('FALLBACK-READBACK-1');
    expectAnsweredByKata(await runCapability(MANIFEST, 'tracker.label', { ids: id, labels: 'rb' }, opts), 'tracker.label');
    expectAnsweredByKata(
      await runCapability(MANIFEST, 'tracker.update-detailed', {
        id, title: 'readback title', description: 'readback body', priority: 1, notes: 'rb note',
      }, opts),
      'tracker.update-detailed'
    );
    const shown = await runCapability(MANIFEST, 'tracker.show', { id }, opts);
    expect(shown.data).toMatchObject({ id, title: 'readback title', labels: ['rb'] });
    expectAnsweredByKata(
      await runCapability(MANIFEST, 'tracker.close-with-reason', { id, reason: REASON, commit: 'abc1234' }, opts),
      'tracker.close-with-reason'
    );
    const closed = await runCapability(MANIFEST, 'tracker.show', { id }, opts);
    expect(closed.data.status).toBe('closed');
  }, 120000);

  test('Edge: no kata capability result is routed to a fallback id', async () => {
    const id = await seed('FALLBACK-EDGE-1');
    for (const name of FALLBACK_BEARING) {
      const res = await runCapability(MANIFEST, name, ARGS[name](id), opts);
      expectAnsweredByKata(res, name);
    }
    // Work-graph capabilities: the manifest must declare each one natively (a `run` argv) or via an
    // in-process `module` (plan/graph-health are served by work-graph-module.js, which the argv
    // runner refuses by design with NOT_ALLOWED), never leave them to work-graph-links-fallback.
    // `ready` runs through the real runner; plan/graph-health run through the real resolver
    // dispatch (the only path that executes a module capability).
    const savedEnv = {};
    for (const [k, v] of Object.entries(ws.env)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
    try {
      const resolved = resolveWorkGraphAdapter({
        projectRoot: ws.workspace,
        projectConfig: { tracker: 'kata' },
        env: { ...ws.env, XDG_CONFIG_HOME: path.join(ws.workspace, 'xdg'), ENSEMBLE_NON_INTERACTIVE: '1' },
      });
      expect(resolved.value).toBe('kata');
      expect(resolved.autoVia).toBe('tracker-capabilities');
      for (const name of WORK_GRAPH_FALLBACK_BEARING) {
        const decl = MANIFEST.capabilities[name];
        expect(decl).toBeDefined();
        expect(Boolean(decl.run) !== Boolean(decl.module)).toBe(true);
        expect(decl.provider).not.toBe('work-graph-links-fallback');
        expect(FALLBACK_IDS.has(decl.module || decl.provider || '')).toBe(false);
        const res = await dispatchWorkGraphCapability(resolved, name, {}, { cwd: ws.workspace });
        expect(res.ok).toBe(true);
        expect(res).not.toHaveProperty('fallback');
        expect(res).not.toHaveProperty('unavailable');
        if (decl.run) {
          const direct = await runCapability(MANIFEST, name, {}, opts);
          expect(direct.ok).toBe(true);
          expect(direct.adapter).toBe('kata');
          expect(res.adapter).toBe('kata');
        } else {
          // module capability: ordering/health is attributed to kata, not the links fallback
          expect(res.data.orderingSource).toBe('kata');
          expect(res.data.dependencyAware).toBe(true);
          expect(FALLBACK_IDS.has(res.data.orderingSource)).toBe(false);
        }
      }
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }, 120000);
});
