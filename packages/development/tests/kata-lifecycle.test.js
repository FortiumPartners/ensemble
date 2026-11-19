'use strict';

/**
 * TRD-012-TEST -- labels one id per call through tracker.label-one, and lifecycle status derived
 * from ownership (TRD-2026-6995dc96 TRD-012; PRD REQ-004 AC-004-1, AC-004-2, AC-004-3 as amended
 * by TRD-027).
 *
 * Two layers:
 *  - Manifest-level (no kata needed): the tracker 1.1 pin, the declared `tracker.label-one`
 *    argv/parse, the compat check, and the `set-status closed` refusal, which fires before any
 *    process is spawned.
 *  - Real kata in an isolated KATA_HOME (guardKata, skipped "tool absent" otherwise): per-id label
 *    sweep read back with `kata show`, `kata label rm`, claim -> owned+open, unassign -> unowned.
 *
 * `KATA_LIFECYCLE_MANIFEST` lets a RED demonstration point at a mutated COPY of the manifest.
 * The narrow in-progress mapping rule (`inProgressWhen`) is covered by tests/kata-owner.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability, buildArgv } = require('../lib/toolchain/runner');
const { checkCompat } = require('../lib/toolchain/contracts');
const { mapOutput } = require('../lib/toolchain/mapping');
const { guardKata } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');

const DEV_ROOT = path.join(__dirname, '..');
const MANIFEST = yaml.load(
  fs.readFileSync(process.env.KATA_LIFECYCLE_MANIFEST || path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8')
);
const TRACKER = yaml.load(fs.readFileSync(path.join(DEV_ROOT, 'toolchain', 'categories', 'tracker.yaml'), 'utf8'));
const SCRATCH_PARENT = path.join(os.homedir(), '.omp', 'br-0hbel', 'jest');

describe('TRD-012 manifest: tracker 1.1 pin and tracker.label-one', () => {
  test('pins tracker 1.1 and tracker.label-one is available under that pin', () => {
    expect(MANIFEST.contract.tracker).toBe('1.1');
    expect(checkCompat(MANIFEST.contract.tracker, TRACKER).unavailableCapabilities).not.toContain('tracker.label-one');
  });

  test('declares tracker.label-one with one ref and one label per call', () => {
    const cap = MANIFEST.capabilities['tracker.label-one'];
    expect(cap).toBeDefined();
    expect(cap.run).toEqual(['kata', 'label', 'add', '${id}', '${label}', '--json']);
    const argv = buildArgv(cap.run.map((x) => x.replace(/\$\{/g, '{')), { id: 'ab3d', label: 'wave-1' }, { inputs: {}, variants: {} });
    expect(argv).toEqual(['kata', 'label', 'add', 'ab3d', 'wave-1', '--json']);
  });

  test('tracker.label-one parse reports the id and maps only contract-declared outputs', () => {
    const cap = MANIFEST.capabilities['tracker.label-one'];
    const env = JSON.stringify({ kata_api_version: 1, issue: { short_id: 'ab3d' }, label: { issue_id: 1, label: 'wave-1' }, changed: true });
    expect(Object.keys(cap.parse.map).every((k) => TRACKER.capabilities['tracker.label-one'].outputs.includes(k))).toBe(true);
    expect(mapOutput(env, cap.parse)).toEqual({ id: 'ab3d' });
  });

  test('the allowlist admits `label rm` (removal argv) and `label add`', () => {
    const subs = MANIFEST.allowlist.find((a) => a.bin === 'kata').sub;
    expect(subs).toEqual(expect.arrayContaining(['label add', 'label rm']));
  });

  test('AC-004-3: set-status closed is refused naming tracker.close-with-reason, before spawning kata', async () => {
    const res = await runCapability(MANIFEST, 'tracker.set-status', { id: 'ab3d', status: 'closed' }, {
      parentEnv: { PATH: '/nonexistent' },
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('INVALID_ARG');
    expect(res.error.message).toContain('tracker.close-with-reason');
  });

  test('set-status variants are claim and unassign, plus a closed refusal that never reaches kata', () => {
    const v = MANIFEST.capabilities['tracker.set-status'].variants.status;
    expect(Object.keys(v).sort()).toEqual(['closed', 'in_progress', 'open']);
    expect(v.closed.join(' ')).toContain('${refuse.');
    expect(v.in_progress[1]).toBe('claim');
    expect(v.open[1]).toBe('unassign');
  });
});

guardKata('TRD-012-TEST labels and lifecycle (real kata)', () => {
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

  function createItem(title) {
    const res = ws.runInWorkspace(['create', title, '--json']);
    const id = parseJson(res.stdout)?.issue?.short_id;
    expect(id).toBeTruthy();
    return id;
  }
  const showRaw = (id) => parseJson(ws.runInWorkspace(['show', id, '--json']).stdout);
  const readItem = async (id) => {
    const r = await runCapability(MANIFEST, 'tracker.show', { id }, opts);
    expect(r.ok).toBe(true);
    return r.data;
  };

  test('AC-004-1: three items sharing a title prefix, labelled once per id, each reads the label back', async () => {
    const ids = ['sweep one', 'sweep two', 'sweep three'].map((t) => createItem(`wave sweep: ${t}`));
    for (const id of ids) {
      const res = await runCapability(MANIFEST, 'tracker.label-one', { id, label: 'wave-1' }, opts);
      expect(res.ok).toBe(true);
      expect(res.data).toMatchObject({ id });
    }
    for (const id of ids) {
      expect(showRaw(id).issue.labels).toContain('wave-1');
      expect((await readItem(id)).labels).toContain('wave-1');
    }
  }, 120000);

  test('removal uses kata label rm and the label is gone on read-back', () => {
    const id = createItem('rm target');
    expect(ws.runInWorkspace(['label', 'add', id, 'temp', '--json']).status).toBe(0);
    expect(showRaw(id).issue.labels).toContain('temp');
    expect(ws.runInWorkspace(['label', 'rm', id, 'temp', '--json']).status).toBe(0);
    expect(showRaw(id).issue.labels).not.toContain('temp');
  }, 60000);

  test('AC-004-2 and unassign: open unowned -> in_progress reads owned+open with owner; back to open clears the owner', async () => {
    const id = createItem('claim cycle');
    expect((await readItem(id)).status).toBe('open');

    const claimed = await runCapability(MANIFEST, 'tracker.set-status', { id, status: 'in_progress' }, opts);
    expect(claimed.ok).toBe(true);
    expect(claimed.data.status).toBe('in_progress');
    expect(claimed.data.owner).toBeTruthy();

    const raw = showRaw(id).issue;
    expect(raw.status).toBe('open');
    expect(raw.owner).toBe(claimed.data.owner);
    const item = await readItem(id);
    expect(item.status).toBe('in_progress');
    expect(item.owner).toBe(claimed.data.owner);

    const released = await runCapability(MANIFEST, 'tracker.set-status', { id, status: 'open' }, opts);
    expect(released.ok).toBe(true);
    expect(released.data.status).toBe('open');
    expect(released.data.owner).toBeUndefined();
    const after = await readItem(id);
    expect(after.status).toBe('open');
    expect(after.owner).toBeUndefined();
    expect(showRaw(id).issue.owner || null).toBeNull();
  }, 120000);

  test('AC-004-3: set-status closed on a real item is refused and the item stays open', async () => {
    const id = createItem('no close via status');
    const res = await runCapability(MANIFEST, 'tracker.set-status', { id, status: 'closed' }, opts);
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain('tracker.close-with-reason');
    expect(showRaw(id).issue.status).toBe('open');
  }, 60000);
});
