'use strict';

/**
 * TRD-007-TEST -- verify show normalization and open-filter behavior
 * (TRD-2026-6995dc96 TRD-007-TEST; PRD REQ-008 AC-008-1, AC-008-2).
 *
 * Complements tests/kata-read-mappings.test.js (recorded envelopes, argv shape) by driving the
 * shipped adapter manifest through the runner against a REAL kata in an isolated scratch
 * workspace (own KATA_HOME and git state, see helpers/kata-scratch.js):
 *
 *  - Happy: an item with title, body, priority, labels and an owner, read by id, has every
 *           normalized field populated (and is schema-valid).
 *  - Edge:  one open and one closed item, tracker.list with an open filter returns only the open one.
 *  - Edge:  more items than kata's default row cap (200), tracker.list returns count === total.
 *
 * Skipped with reason "tool absent" when kata is not on PATH (guardKata). `KATA_READS_MANIFEST`
 * lets a RED demonstration point at a mutated copy of the manifest instead of the shipped one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { runCapability } = require('../lib/toolchain/runner');
const { guardKata } = require('./helpers/kata-guard');
const { kataScratch, parseJson } = require('./helpers/kata-scratch');

const DEV_ROOT = path.join(__dirname, '..');
const ADAPTER_DIR = path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata');
const MANIFEST = yaml.load(
  fs.readFileSync(process.env.KATA_READS_MANIFEST || path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8')
);
const WORK_ITEM_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(DEV_ROOT, 'toolchain', 'schemas', 'normalized', 'work-item.json'), 'utf8')
);
const validateItem = new Ajv({ allErrors: true, strict: false }).compile(WORK_ITEM_SCHEMA);

const SCRATCH_PARENT = path.join(os.homedir(), '.omp', 'br-lp9vp', 'jest');
const DEFAULT_ROW_CAP = 200;
const OVER_CAP = DEFAULT_ROW_CAP + 5;
const CLOSE_REASON = 'closed by the trd-007 read verification probe for the open filter';

guardKata('TRD-007-TEST kata reads (real kata)', () => {
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

  function create(title, extra = []) {
    const res = ws.runInWorkspace(['create', title, ...extra, '--json']);
    const id = parseJson(res.stdout)?.issue?.short_id;
    expect(id).toBeTruthy();
    return id;
  }

  test('AC-008-2: an item with body, priority, labels and an owner reads back fully normalized', async () => {
    const id = create('read me by id', ['--body', 'the body text', '--priority', '2', '--label', 'alpha', '--label', 'beta']);
    const claim = ws.runInWorkspace(['claim', id, '--json']);
    expect(claim.status).toBe(0);

    const res = await runCapability(MANIFEST, 'tracker.show', { id }, opts);
    expect(res.ok).toBe(true);
    const item = res.data;
    expect(item.id).toBe(id);
    expect(item.title).toBe('read me by id');
    expect(item.description).toBe('the body text');
    // kata has no type field: 'task' is the manifest default when metadata.type is unset.
    expect(item.type).toBe('task');
    expect(item.priority).toBe('2');
    expect([...item.labels].sort()).toEqual(['alpha', 'beta']);
    expect(typeof item.owner).toBe('string');
    expect(item.owner.length).toBeGreaterThan(0);
    expect(item.status).toBe('in_progress');
    expect(validateItem(item)).toBe(true);
  }, 60000);

  test('AC-008-1: an open filter returns the open item and excludes the closed one', async () => {
    const openId = create('open item for filter');
    const closedId = create('closed item for filter');
    const closed = ws.runInWorkspace(['close', closedId, '--done', '-m', CLOSE_REASON, '--test', `kata show ${closedId}`, '--json']);
    expect(closed.status).toBe(0);

    const res = await runCapability(MANIFEST, 'tracker.list', { filter: 'open' }, opts);
    expect(res.ok).toBe(true);
    const ids = res.data.items.map((i) => i.id);
    expect(ids).toContain(openId);
    expect(ids).not.toContain(closedId);
    expect(res.data.items.every((i) => i.status !== 'closed')).toBe(true);

    const closedRes = await runCapability(MANIFEST, 'tracker.list', { filter: 'closed' }, opts);
    expect(closedRes.ok).toBe(true);
    const closedIds = closedRes.data.items.map((i) => i.id);
    expect(closedIds).toContain(closedId);
    expect(closedIds).not.toContain(openId);
  }, 60000);

  test('AC-008-1: more items than the default row cap are all returned (count equals total)', async () => {
    const before = parseJson(ws.runInWorkspace(['list', '--status', 'open', '--limit', '0', '--include-total', '--json']).stdout).total;
    for (let n = 0; n < OVER_CAP; n += 1) create(`bulk item ${n}`);
    const total = parseJson(ws.runInWorkspace(['list', '--status', 'open', '--limit', '0', '--include-total', '--json']).stdout).total;
    expect(total).toBe(before + OVER_CAP);
    expect(total).toBeGreaterThan(DEFAULT_ROW_CAP);

    const res = await runCapability(MANIFEST, 'tracker.list', { filter: 'open' }, opts);
    expect(res.ok).toBe(true);
    expect(res.data.items.length).toBe(total);
  }, 280000);
});
