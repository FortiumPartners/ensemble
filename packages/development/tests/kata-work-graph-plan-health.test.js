'use strict';

/**
 * TRD-019-TEST -- kata work-graph.plan / work-graph.graph-health on the shared scan
 * (TRD-2026-6995dc96 TRD-019; PRD REQ-007 AC-007-2..AC-007-5). Stub/fixture driven: the list
 * envelope is injected or served by a stub `kata` on PATH. Scratch lives under ~/.omp, never
 * os.tmpdir(), and is removed afterwards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const resolver = require('../lib/toolchain/work-graph-resolve');
const { validateAdapterDir } = require('../lib/toolchain/validate');
const schema = require('../toolchain/schemas/adapter-manifest-schema.json');
const mod = require('../skills/adapter-tracker-kata/work-graph-module');

const ADAPTER_DIR = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata');
const MANIFEST = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));

const issue = (id, extra = {}) => ({ short_id: id, title: `t-${id}`, status: 'open', ...extra });
const dep = (id, status = 'open') => ({ short_id: id, status });
const envelope = (issues, extra = {}) => ({ complete: true, truncated: false, total: issues.length, issues, ...extra });
const ctxFor = (env) => ({ manifest: MANIFEST, dir: ADAPTER_DIR, fetchList: async () => env });
const plan = (env) => mod.run('work-graph.plan', {}, ctxFor(env));
const health = (env) => mod.run('work-graph.graph-health', {}, ctxFor(env));

describe('manifest entries (TRD-019 a)', () => {
  test.each(['work-graph.plan', 'work-graph.graph-health'])('%s is an in-process module capability', (name) => {
    const cap = MANIFEST.capabilities[name];
    expect(cap.module).toBe('work-graph-module.js');
    expect(cap.run).toBeUndefined();
    expect(cap.export === undefined || cap.export === 'run').toBe(true);
  });

  test('manifest passes the schema', () => {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    expect(validate(MANIFEST)).toBe(true);
  });

  test('validateAdapterDir accepts the adapter directory', () => {
    const result = validateAdapterDir(ADAPTER_DIR);
    const errors = (result.errors || result.findings || []).filter((f) => !f.severity || f.severity === 'error');
    expect(errors).toEqual([]);
  });

  test('the module exports run', () => {
    expect(typeof mod.run).toBe('function');
  });
});

describe('plan (AC-007-2, AC-007-4)', () => {
  test('every item appears after the items it depends on; kata is the ordering source', async () => {
    // Listing order puts dependents first on purpose.
    const env = envelope([
      issue('c', { blocked_by: [dep('b')] }),
      issue('b', { blocked_by: [dep('a')] }),
      issue('a'),
    ]);
    const result = await plan(env);
    expect(result.ok).toBe(true);
    expect(result.capability).toBe('work-graph.plan');
    expect(result.data.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.data.orderingSource).toBe('kata');
    expect(result.data.dependencyAware).toBe(true);
    expect(result.data.findings).toEqual([]);
  });

  test('a blocks-only edge also orders dependency-first', async () => {
    const env = envelope([issue('y'), issue('x', { blocks: [dep('y')] })]);
    expect((await plan(env)).data.items.map((i) => i.id)).toEqual(['x', 'y']);
  });
});

describe('cycle (AC-007-3)', () => {
  const cyc = envelope([
    issue('a', { blocked_by: [dep('b')] }),
    issue('b', { blocked_by: [dep('a')] }),
    issue('ok'),
  ]);

  test('graph-health reports the cycle as unhealthy', async () => {
    const result = await health(cyc);
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('unhealthy');
    expect(result.data.findings).toEqual([expect.objectContaining({ type: 'cycle', items: ['a', 'b'] })]);
    expect(result.data.orderingSource).toBe('kata');
    expect(result.data.dependencyAware).toBe(true);
  });

  test('plan does not order the cycle silently', async () => {
    const result = await plan(cyc);
    expect(result.ok).toBe(true);
    expect(result.data.items).toEqual([]);
    expect(result.data.findings.map((f) => f.type)).toEqual(['cycle']);
  });
});

describe('dangling edge (AC-007-5)', () => {
  test('a blocker the scope never returns is a dangling-edge finding', async () => {
    const result = await health(envelope([issue('a', { blocked_by: [dep('ghost')] }), issue('b')]));
    expect(result.data.status).toBe('unhealthy');
    expect(result.data.findings).toEqual([
      expect.objectContaining({ type: 'dangling-edge', items: ['a'], dependency: 'ghost' }),
    ]);
  });
});

describe('healthy and closed blockers', () => {
  test('healthy graph has no findings', async () => {
    const result = await health(envelope([issue('a'), issue('b', { blocked_by: [dep('a')] })]));
    expect(result.data).toMatchObject({ status: 'healthy', findings: [], dependencyAware: true });
  });

  test('a blocked_by entry with no status is unknown and stays an edge (fixture list.json always carries status)', async () => {
    const env = envelope([issue('a', { blocked_by: [{ short_id: 'ghost' }] }), issue('b', { blocked_by: [{ short_id: 'a', status: undefined }] })]);
    const result = await health(env);
    expect(result.data.status).toBe('unhealthy');
    expect(result.data.findings).toEqual([expect.objectContaining({ type: 'dangling-edge', items: ['a'], dependency: 'ghost' })]);
    expect((await plan(envelope([issue('a'), issue('b', { blocked_by: [{ short_id: 'a' }] })]))).data.items.map((i) => i.id)).toEqual(['a', 'b']);
    const odd = envelope([issue('a', { blocked_by: [dep('ghost', 'weird')] })]);
    expect((await health(odd)).data.status).toBe('unhealthy');
  });

  test('a closed blocker is satisfied, not dangling, and does not gate the plan', async () => {
    const env = envelope([issue('a', { blocked_by: [dep('done', 'closed')] })]);
    expect((await health(env)).data).toMatchObject({ status: 'healthy', findings: [] });
    expect((await plan(env)).data.items.map((i) => i.id)).toEqual(['a']);
  });
});

describe('incomplete listings are refused (g)', () => {
  test.each([
    ['truncated', envelope([issue('a')], { truncated: true })],
    ['complete false', envelope([issue('a')], { complete: false })],
    ['total mismatch', envelope([issue('a')], { total: 2 })],
    ['no issues array', { complete: true }],
  ])('%s => BAD_OUTPUT', async (_n, env) => {
    for (const fn of [plan, health]) {
      const result = await fn(env);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('BAD_OUTPUT');
    }
  });

  test('an unhandled capability is refused', async () => {
    const result = await mod.run('work-graph.ready', {}, ctxFor(envelope([])));
    expect(result.ok).toBe(false);
  });
});

describe('end to end through the resolver (h)', () => {
  const SCRATCH = path.join(os.homedir(), '.omp', `trd019-test-${process.pid}`);
  const savedPath = process.env.PATH;

  beforeAll(() => {
    fs.mkdirSync(SCRATCH, { recursive: true });
    const body = JSON.stringify(
      envelope([issue('c', { blocked_by: [dep('a')] }), issue('a'), issue('z', { blocked_by: [dep('ghost')] })])
    );
    const stub = path.join(SCRATCH, 'kata');
    fs.writeFileSync(
      stub,
      `#!/bin/sh\nif [ "$1" = list ] && echo "$@" | grep -q -- '--limit 0' && echo "$@" | grep -q -- '--include-total'; then\ncat <<'EOF_JSON'\n${body}\nEOF_JSON\nelse echo "unexpected: $@" >&2; exit 2; fi\n`,
      { mode: 0o755 }
    );
    process.env.PATH = `${SCRATCH}${path.delimiter}${savedPath}`;
  });

  afterAll(() => {
    process.env.PATH = savedPath;
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  });

  const resolved = () => ({ value: 'kata', source: 'project', autoVia: 'tracker-capabilities', origin: 'installed', dir: ADAPTER_DIR, manifest: MANIFEST });

  test('plan names kata and is dependency-aware', async () => {
    const result = await resolver.dispatchWorkGraphCapability(resolved(), 'work-graph.plan', {}, { source: 'project', cwd: SCRATCH });
    expect(result.ok).toBe(true);
    expect(result.data.orderingSource).toBe('kata');
    expect(result.data.dependencyAware).toBe(true);
    expect(result.data.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(result.data.findings.map((f) => f.type)).toEqual(['dangling-edge']);
  });

  test('graph-health reports the dangling edge', async () => {
    const result = await resolver.dispatchWorkGraphCapability(resolved(), 'work-graph.graph-health', {}, { source: 'project', cwd: SCRATCH });
    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('unhealthy');
    expect(result.data.findings[0]).toMatchObject({ type: 'dangling-edge', dependency: 'ghost' });
  });
});

describe('library lookup in each package layout (F1)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const MIRRORS = [
    ['pi', path.join(ROOT, 'pi', 'skills', 'adapter-tracker-kata')],
    ['codex', path.join(ROOT, 'codex', '.codex', 'skills', 'adapter-tracker-kata')],
  ];

  test.each(MIRRORS)('%s mirror ships the module and resolves the vendored scan', async (_n, dir) => {
    expect(fs.existsSync(path.join(dir, 'work-graph-module.js'))).toBe(true);
    const m = require(path.join(dir, 'work-graph-module.js'));
    const env = envelope([issue('c', { blocked_by: [dep('a')] }), issue('a'), issue('z', { blocked_by: [dep('ghost')] })]);
    const ctx = { manifest: MANIFEST, fetchList: async () => env };
    const p = await m.run('work-graph.plan', {}, ctx);
    expect(p.ok).toBe(true);
    expect(p.data.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(p.data.findings.map((f) => f.type)).toEqual(['dangling-edge']);
    const h = await m.run('work-graph.graph-health', {}, ctx);
    expect(h.data.status).toBe('unhealthy');
  });

  describe.each(MIRRORS.concat([['development', ADAPTER_DIR]]))('%s runner path', (_n, dir) => {
    const SCRATCH = path.join(os.homedir(), '.omp', `trd019-layout-${process.pid}-${_n}`);
    const savedPath = process.env.PATH;
    beforeAll(() => {
      fs.mkdirSync(SCRATCH, { recursive: true });
      const body = JSON.stringify(envelope([issue('a')]));
      fs.writeFileSync(
        path.join(SCRATCH, 'kata'),
        `#!/bin/sh\necho "$@" > "${SCRATCH}/argv.txt"\ncat <<'EOF_JSON'\n${body}\nEOF_JSON\n`,
        { mode: 0o755 }
      );
      process.env.PATH = `${SCRATCH}${path.delimiter}${savedPath}`;
    });
    afterAll(() => {
      process.env.PATH = savedPath;
      fs.rmSync(SCRATCH, { recursive: true, force: true });
    });

    test('the vendored runner is found and receives the exact synthetic tracker.list argv (F3)', async () => {
      const m = require(path.join(dir, 'work-graph-module.js'));
      const result = await m.run('work-graph.plan', {}, { manifest: MANIFEST, source: 'project', cwd: SCRATCH });
      expect(result.ok).toBe(true);
      expect(result.data.items.map((i) => i.id)).toEqual(['a']);
      expect(fs.readFileSync(path.join(SCRATCH, 'argv.txt'), 'utf8').trim()).toBe(
        'list --status open --limit 0 --include-total --json'
      );
    });
  });
});
