'use strict';

/**
 * TRD-017-TEST -- kata edge export and ready-work listing (TRD-2026-6995dc96 TRD-017; AC-007-1).
 * Fixture-driven; the runCapability case uses a stub `kata` on PATH, so no real kata is needed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { mapOutput } = require('../lib/toolchain/mapping');
const { runCapability } = require('../lib/toolchain/runner');
const { scanWorkGraph } = require('../lib/toolchain/work-graph-scan');
const { normalizeReadyItems, normalizeEdges } = require('../skills/adapter-tracker-kata/work-graph-module');

const DEV_ROOT = path.join(__dirname, '..');
const MANIFEST = yaml.load(
  fs.readFileSync(path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8')
);
const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'kata', n), 'utf8');
const LIST = JSON.parse(fixture('list.json'));

const issue = (id, extra = {}) => ({ short_id: id, title: `t-${id}`, status: 'open', priority: 2, ...extra });

describe('work-graph.ready manifest entry', () => {
  const cap = MANIFEST.capabilities['work-graph.ready'];
  test('argv is kata ready --limit 0 --json (no row cap)', () => {
    expect(cap.run).toEqual(['kata', 'ready', '--limit', '0', '--json']);
  });
  test('parse maps $.issues to items in kata order', () => {
    const body = JSON.stringify({ issues: [issue('a'), issue('b', { priority: null })] });
    const out = mapOutput(body, cap.parse);
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out.items[0]).toMatchObject({ title: 't-a', status: 'open', priority: '2', labels: [] });
  });
});

describe('ready listing', () => {
  // Hand-built envelope: C is simply not in it. This only shows the module passes the envelope
  // through; it does NOT prove filtering (see the recorded-fixture test below).
  const ready = { issues: [issue('A'), issue('B', { blocks: [{ short_id: 'C' }] })] };

  test('hand-built envelope passes through in kata order (C not in the envelope)', () => {
    const ids = normalizeReadyItems(ready).map((i) => i.id);
    expect(ids).toEqual(['A', 'B']);
  });
  test('recorded fixtures: ready.json omits jfh4, which list.json shows blocked by open 7zzg', () => {
    // The module relies on kata's own readiness filtering and never decides readiness itself.
    // ready.json was recorded with `kata ready --json`, not `--limit 0`.
    const jfh4 = LIST.issues.find((i) => i.short_id === 'jfh4');
    expect(jfh4.blocked_by.some((b) => b.short_id === '7zzg' && b.status === 'open')).toBe(true);
    const readyText = fixture('ready.json');
    const ids = normalizeReadyItems(JSON.parse(readyText)).map((i) => i.id);
    expect(ids).toEqual(['7zzg']);
    expect(ids).not.toContain('jfh4');
    const mapped = mapOutput(readyText, MANIFEST.capabilities['work-graph.ready'].parse);
    expect(mapped.items.map((i) => i.id)).toEqual(ids);
  });
  test('never re-sorts (reverse-alphabetical kata order survives)', () => {
    const env = { issues: [issue('z'), issue('m'), issue('a')] };
    expect(normalizeReadyItems(env).map((i) => i.id)).toEqual(['z', 'm', 'a']);
  });
  test('stable: two normalizations are identical', () => {
    expect(normalizeReadyItems(ready)).toEqual(normalizeReadyItems(ready));
  });
  test('more than any default row cap: 250 rows all returned, in order', () => {
    const env = { issues: Array.from({ length: 250 }, (_, i) => issue(`id${i}`)) };
    const items = normalizeReadyItems(env);
    expect(items).toHaveLength(250);
    expect(items.map((i) => i.id)).toEqual(env.issues.map((i) => i.short_id));
    expect(mapOutput(JSON.stringify(env), MANIFEST.capabilities['work-graph.ready'].parse).items).toHaveLength(250);
  });
  test('malformed envelope throws a clear error', () => {
    expect(() => normalizeReadyItems(null)).toThrow(/issues/);
    expect(() => normalizeReadyItems({ issues: [{ title: 'x' }] })).toThrow(/short_id/);
    expect(() => normalizeEdges({ issues: [issue('a', { blocked_by: 'x' })] })).toThrow(/blocked_by/);
  });
});

describe('edge normalization from the recorded list fixture', () => {
  test('blocked_by populates dependencies; blocks inverts without duplicating', () => {
    const items = normalizeEdges(LIST);
    expect(items.map((i) => i.id)).toEqual(LIST.issues.map((i) => i.short_id));
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    // jfh4 is blocked_by 7zzg, and 7zzg blocks jfh4: one edge, not two.
    expect(byId.jfh4.dependencies).toEqual([{ id: '7zzg', type: 'blocks' }]);
    expect(byId['7zzg'].dependencies).toEqual([]);
    expect(byId['7vvb'].dependencies).toEqual([]);
  });
  test('inverts blocks when blocked_by is absent', () => {
    const items = normalizeEdges({ issues: [issue('X', { blocks: [{ short_id: 'Y' }] }), issue('Y')] });
    expect(items[1].dependencies).toEqual([{ id: 'X', type: 'blocks' }]);
    expect(normalizeEdges({ issues: [issue('X', { blocks: [{ short_id: 'Y' }] }), issue('Y')] })).toEqual(items);
  });
  test('outbound blocks to an id absent from the envelope are silently dropped (TRD-019 decides)', () => {
    const items = normalizeEdges({ issues: [issue('X', { blocks: [{ short_id: 'Y' }] })] });
    expect(items.map((i) => i.id)).toEqual(['X']);
    expect(items[0].dependencies).toEqual([]);
  });
  test('feeds scanWorkGraph: no dangling edges, blocker ordered first', () => {
    const scan = scanWorkGraph(normalizeEdges(LIST));
    expect(scan.findings).toEqual([]);
    const order = scan.ordered.map((i) => i.id);
    expect(order.indexOf('7zzg')).toBeLessThan(order.indexOf('jfh4'));
  });
  test('scope missing the blocker is a dangling edge', () => {
    const items = normalizeEdges(LIST).filter((i) => i.id !== '7zzg');
    expect(scanWorkGraph(items).findings.map((f) => f.type)).toEqual(['dangling-edge']);
  });
});

describe('runCapability work-graph.ready against a stub kata on PATH', () => {
  test('yields normalized items in kata order and passes --limit 0', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-edges-'));
    try {
      const payload = JSON.stringify({ issues: [issue('q'), issue('b')] });
      fs.writeFileSync(path.join(dir, 'args.log'), '');
      fs.writeFileSync(
        path.join(dir, 'kata'),
        `#!/bin/sh\necho "$@" >> "${dir}/args.log"\ncat <<'EOF'\n${payload}\nEOF\n`,
        { mode: 0o755 }
      );
      const res = await runCapability(MANIFEST, 'work-graph.ready', {}, {
        parentEnv: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
      });
      expect(res.ok).toBe(true);
      expect((res.data || res.result || res).items.map((i) => i.id)).toEqual(['q', 'b']);
      expect(fs.readFileSync(path.join(dir, 'args.log'), 'utf8').trim()).toBe('ready --limit 0 --json');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
