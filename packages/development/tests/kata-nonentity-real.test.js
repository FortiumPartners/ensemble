'use strict';

/**
 * TRD-033-FU (br-byumx) -- real-kata proof that the shipped kata manifest's parse blocks for
 * tracker.find-by-key and tracker.label produce normalized output that validates against the
 * non-entity schemas (work-item-list.json, label-result.json). Drives the manifest through the
 * runner against a REAL kata in an isolated scratch workspace (own KATA_HOME and git state).
 * Skipped with reason "tool absent" without kata (guardKata). KATA_NONENTITY_MANIFEST lets a
 * RED demonstration point at a mutated copy of the manifest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability } = require('../lib/toolchain/runner');
const { guardKata } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');

const ADAPTER_DIR = path.join(__dirname, '..', 'skills', 'adapter-tracker-kata');
const MANIFEST = yaml.load(
  fs.readFileSync(process.env.KATA_NONENTITY_MANIFEST || path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8')
);
const SCRATCH_PARENT = path.join(os.homedir(), '.omp', 'br-byumx', 'jest');

guardKata('TRD-033-FU non-entity capabilities (real kata)', () => {
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

  test('manifest declares parse blocks for find-by-key and label', () => {
    expect(MANIFEST.capabilities['tracker.find-by-key'].parse).toBeDefined();
    expect(MANIFEST.capabilities['tracker.label'].parse).toBeDefined();
  });

  test('tracker.label output validates against label-result.json', async () => {
    const created = parseJson(ws.runInWorkspace(['create', 'label target', '--json']).stdout);
    const id = created.issue.short_id;
    const res = await runCapability(MANIFEST, 'tracker.label', { ids: id, labels: 'needs-review' }, opts);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ id, label: 'needs-review' });
  });

  test('tracker.find-by-key output validates against work-item-list.json', async () => {
    const key = 'FU-KEY-0001';
    const made = ws.runInWorkspace(['create', 'keyed item', '--meta', `ext_key=${key}`, '--json']);
    const id = parseJson(made.stdout).issue.short_id;
    const res = await runCapability(MANIFEST, 'tracker.find-by-key', { key }, opts);
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.data.items)).toBe(true);
    expect(res.data.items.map((i) => i.id)).toContain(id);
    for (const it of res.data.items) expect(typeof it.id).toBe('string');
  });

  test('tracker.find-by-key with no match answers an empty list, not BAD_OUTPUT', async () => {
    const res = await runCapability(MANIFEST, 'tracker.find-by-key', { key: 'FU-NO-SUCH-KEY' }, opts);
    expect(res.ok).toBe(true);
    expect(res.data.items).toEqual([]);
  });
});
