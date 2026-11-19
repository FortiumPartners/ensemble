'use strict';

/**
 * TRD-010-TEST -- dedupe identity (TRD-2026-6995dc96 TRD-010; PRD REQ-002 AC-002-1..3).
 *
 * `tracker.create-detailed` records the external key as kata metadata `ext_key` and also sends it
 * as `--idempotency-key`; `tracker.find-by-key` lists the whole project (`--status all`, closed
 * items included) filtered on `--meta ext_key=<key>`, exposing the key as `external_ref`.
 *
 *  - Argv leg (unguarded, recording stub kata): the manifest's argv carries both flags, so the
 *    no-kata run still asserts the adapter's contract.
 *  - Real leg (guardKata, isolated KATA_HOME workspace): create -> read back through kata; lookup
 *    returns exactly the one item, also once closed; an unmatched key is an empty list, not an
 *    error; two keys do not leak into each other; a conflicting create (same idempotency key,
 *    different fields) surfaces as an error (kata exit 5, named `conflict` by exitCodeNames; error.code stays TOOL_FAILED) and no
 *    second item exists.
 *
 * `KATA_DEDUPE_MANIFEST` may point at a mutated copy of the manifest for a RED demonstration.
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
  fs.readFileSync(process.env.KATA_DEDUPE_MANIFEST || path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8')
);
const SCRATCH_PARENT = path.join(os.homedir(), '.omp', 'br-db1bp', 'jest');
const REASON = 'Closed to prove the dedupe lookup still finds closed items in the whole project';

const detailed = (title, key, extra = {}) => ({
  title,
  description: `${title} body`,
  priority: 2,
  externalKey: key,
  ...extra,
});

describe('TRD-010 dedupe argv (recording stub kata)', () => {
  const dir = path.join(SCRATCH_PARENT, `argv-${process.pid}`);
  const log = path.join(dir, 'argv.log');
  let opts;

  beforeAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'cwd'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'kata'),
      [
        '#!/usr/bin/env node',
        "require('fs').appendFileSync(__dirname + '/argv.log', JSON.stringify(process.argv.slice(2)) + '\\n');",
        "process.stdout.write(JSON.stringify(process.argv[2] === 'list' ? { issues: [] } : { issue: { short_id: 'ab3d' } }));",
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

  const argvs = () =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

  test('create-detailed sends the key as --meta ext_key=K and as --idempotency-key K', async () => {
    const res = await runCapability(MANIFEST, 'tracker.create-detailed', detailed('t', 'K-1'), opts);
    expect(res.ok).toBe(true);
    const argv = argvs()[0];
    expect(argv[argv.indexOf('--meta') + 1]).toBe('ext_key=K-1');
    expect(argv[argv.indexOf('--idempotency-key') + 1]).toBe('K-1');
  });

  test('find-by-key lists the whole project: --status all, --limit 0, --meta ext_key=K', async () => {
    const res = await runCapability(MANIFEST, 'tracker.find-by-key', { key: 'K-1' }, opts);
    expect(res.ok).toBe(true);
    const argv = argvs()[0];
    expect(argv.slice(0, 7)).toEqual(['list', '--status', 'all', '--limit', '0', '--meta', 'ext_key=K-1']);
  });
});

guardKata('TRD-010-TEST dedupe identity (real kata)', () => {
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

  const readIssue = (id) => parseJson(ws.runInWorkspace(['show', id, '--json']).stdout).issue;
  const listAll = () => parseJson(ws.runInWorkspace(['list', '--status', 'all', '--limit', '0', '--json']).stdout).issues;

  async function create(title, key) {
    const res = await runCapability(MANIFEST, 'tracker.create-detailed', detailed(title, key), opts);
    expect(res.ok).toBe(true);
    expect(res.data.id).toBeTruthy();
    return res.data.id;
  }

  const find = (key) => runCapability(MANIFEST, 'tracker.find-by-key', { key }, opts);

  test('create-detailed stores the key as metadata ext_key and the lookup returns that one item', async () => {
    const key = 'DEDUPE-A-1';
    const id = await create('dedupe alpha', key);
    expect(readIssue(id).metadata.ext_key).toBe(key);

    const res = await find(key);
    expect(res.ok).toBe(true);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]).toMatchObject({ id, external_ref: key });
  }, 60000);

  test('AC-002-1: the lookup still returns the item once it is closed', async () => {
    const key = 'DEDUPE-CLOSED-1';
    const id = await create('dedupe closed', key);
    const closed = await runCapability(MANIFEST, 'tracker.close-with-reason', { id, reason: REASON, commit: 'abc1234' }, opts);
    expect(closed.ok).toBe(true);
    expect(readIssue(id).status).toBe('closed');

    const res = await find(key);
    expect(res.ok).toBe(true);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0]).toMatchObject({ id, status: 'closed', external_ref: key });
  }, 60000);

  test('AC-002-2: a key that matches nothing is an empty list, not an error', async () => {
    const res = await find('DEDUPE-NO-SUCH-KEY');
    expect(res.ok).toBe(true);
    expect(res.data.items).toEqual([]);
  }, 60000);

  test('AC-002-3: two items with different keys -> the lookup returns only the matching one', async () => {
    const idB = await create('Rotate the signing certificates', 'DEDUPE-B-1');
    const idC = await create('Paginate the audit export endpoint', 'DEDUPE-C-1');
    expect(idB).not.toBe(idC);

    const b = await find('DEDUPE-B-1');
    expect(b.data.items.map((i) => i.id)).toEqual([idB]);
    const c = await find('DEDUPE-C-1');
    expect(c.data.items.map((i) => i.id)).toEqual([idC]);
  }, 60000);

  test('prefix-related keys: looking up DEDUPE-P-1 does not return DEDUPE-P-10 (exact match only)', async () => {
    const idP1 = await create('Rotate the message broker credentials', 'DEDUPE-P-1');
    const idP10 = await create('Archive stale webhook delivery logs', 'DEDUPE-P-10');
    expect(idP1).not.toBe(idP10);

    const p1 = await find('DEDUPE-P-1');
    expect(p1.ok).toBe(true);
    expect(p1.data.items.map((i) => i.id)).toEqual([idP1]);
    const p10 = await find('DEDUPE-P-10');
    expect(p10.ok).toBe(true);
    expect(p10.data.items.map((i) => i.id)).toEqual([idP10]);
  }, 60000);

  test('a retry with the same key and the same fields returns the original item, no duplicate', async () => {
    const key = 'DEDUPE-RETRY-1';
    const first = await create('dedupe retry', key);
    const again = await create('dedupe retry', key);
    expect(again).toBe(first);
    expect((await find(key)).data.items).toHaveLength(1);
  }, 60000);

  test('a create kata refuses with a conflict is an error and no second item exists', async () => {
    const key = 'DEDUPE-CONFLICT-1';
    const id = await create('conflict original', key);
    const before = listAll().length;

    const res = await runCapability(MANIFEST, 'tracker.create-detailed', detailed('Backfill invoice currency columns', key), opts);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('TOOL_FAILED');
    expect(res.error.exitCode).toBe(5);
    expect(res.error.exitName).toBe('conflict');

    expect(listAll()).toHaveLength(before);
    const found = await find(key);
    expect(found.data.items.map((i) => i.id)).toEqual([id]);
  }, 60000);
});
