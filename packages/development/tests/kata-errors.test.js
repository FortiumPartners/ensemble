'use strict';

/**
 * TRD-029-TEST -- named failures and truncation-safe reads (TRD-2026-6995dc96 TRD-029;
 * PRD REQ-017 AC-017-2, AC-017-3).
 *
 *  - kata's stderr text survives into the adapter error.
 *  - kata exit codes 3..8 each map to a NAMED adapter error (ok:false, never success), through
 *    BOTH runCapability and runCapabilitySync.
 *  - a list read refuses truncated, short-count, count-less and malformed output with
 *    BAD_OUTPUT and returns no items; a complete list passes.
 *
 * A fake `kata` executable stands in for the binary (no real kata, no kata state is touched). It
 * is put first on PATH through `opts.parentEnv`, and replays whatever `behaviour.json` next to it
 * says, because the runner strips every env var outside the base allowlist.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { mapOutput } = require('../lib/toolchain/mapping');
const { runCapability, runCapabilitySync } = require('../lib/toolchain/runner');

const DEV_ROOT = path.join(__dirname, '..');
const MANIFEST = yaml.load(
  fs.readFileSync(path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8')
);
const FIXTURES = path.join(__dirname, 'fixtures', 'kata');
const LIST_OK = fs.readFileSync(path.join(FIXTURES, 'list-total.json'), 'utf8');
const LIST_TRUNCATED = fs.readFileSync(path.join(FIXTURES, 'list-total-truncated.json'), 'utf8');

const SCRATCH = path.join(os.homedir(), '.omp', 'kata-errors-jest', `fake-kata-${process.pid}`);
let behaviourFile;
let opts;

beforeAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  behaviourFile = path.join(SCRATCH, 'behaviour.json');
  const bin = path.join(SCRATCH, 'kata');
  fs.writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('fs');",
      "const b = JSON.parse(fs.readFileSync(__dirname + '/behaviour.json', 'utf8'));",
      "if (b.stdout) process.stdout.write(b.stdout);",
      "if (b.stderr) process.stderr.write(b.stderr);",
      'process.exit(b.exit || 0);',
      ''
    ].join('\n')
  );
  fs.chmodSync(bin, 0o755);
  opts = { parentEnv: { PATH: `${SCRATCH}${path.delimiter}${process.env.PATH}`, HOME: SCRATCH } };
});

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

function behave(b) {
  fs.writeFileSync(behaviourFile, JSON.stringify(b));
}

/** Run one capability through both entry points; they must agree. */
async function both(capability, args = {}) {
  const asyncResult = await runCapability(MANIFEST, capability, args, opts);
  const syncResult = runCapabilitySync(MANIFEST, capability, args, opts);
  expect(syncResult).toEqual(asyncResult);
  return asyncResult;
}

describe('TRD-029 stderr passthrough (AC-017-2)', () => {
  test('a nonzero exit carries kata stderr text to the caller', async () => {
    behave({ exit: 1, stderr: 'kata: daemon exploded in a distinctive way\n' });
    const result = await both('tracker.show', { id: 'abcd' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TOOL_FAILED');
    expect(result.error.message).toContain('kata: daemon exploded in a distinctive way');
  });
});

describe('TRD-029 named exit codes 3..8 (AC-017-2)', () => {
  const NAMES = {
    3: 'validation',
    4: 'not_found',
    5: 'conflict',
    6: 'confirmation_required',
    7: 'daemon_unavailable',
    8: 'wait_timeout'
  };

  test('the manifest declares exactly those names', () => {
    expect(MANIFEST.exitCodeNames).toEqual(NAMES);
  });

  test.each(Object.entries(NAMES))('exit %s is named %s, never success', async (code, name) => {
    behave({ exit: Number(code), stderr: `kata says no (${code})` });
    const result = await both('tracker.show', { id: 'abcd' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TOOL_FAILED');
    expect(result.error.exitCode).toBe(Number(code));
    expect(result.error.exitName).toBe(name);
    expect(result.error.message).toContain(name);
    expect(result.error.message).toContain(`exit ${code}`);
    expect(result.error.message).toContain(`kata says no (${code})`);
  });

  test('the stdout error envelope message still comes through under a named exit', async () => {
    behave({
      exit: 4,
      stdout: JSON.stringify({ error: { kind: 'not_found', code: 'issue_not_found', message: 'issue not found', exit_code: 4 } })
    });
    const result = await both('tracker.show', { id: 'zzzz' });
    expect(result.ok).toBe(false);
    expect(result.error.exitName).toBe('not_found');
    expect(result.error.message).toContain('issue_not_found');
  });

  test('an unnamed nonzero exit stays a plain TOOL_FAILED without a name', async () => {
    behave({ exit: 1, stderr: 'plain failure' });
    const result = await both('tracker.show', { id: 'abcd' });
    expect(result.ok).toBe(false);
    expect(result.error.exitName).toBeUndefined();
    expect(result.error.message).toContain('plain failure');
  });

  test('an adapter without exitCodeNames is unchanged (no name fields)', async () => {
    behave({ exit: 4, stderr: 'nope' });
    const bare = { ...MANIFEST };
    delete bare.exitCodeNames;
    const result = await runCapability(bare, 'tracker.show', { id: 'abcd' }, opts);
    expect(result.ok).toBe(false);
    expect(result.error.exitName).toBeUndefined();
    expect(result.error.exitCode).toBeUndefined();
  });
});

describe('TRD-029 truncation-safe list reads (AC-017-3)', () => {
  test('happy: a complete list returns the normalized items', async () => {
    behave({ exit: 0, stdout: LIST_OK });
    const result = await both('tracker.list', {});
    expect(result.ok).toBe(true);
    const raw = JSON.parse(LIST_OK);
    expect(result.data.items).toHaveLength(raw.total);
    expect(result.data.items[0]).toEqual({
      id: raw.issues[0].short_id,
      title: raw.issues[0].title,
      status: raw.issues[0].status,
      labels: raw.issues[0].labels || []
    });
  });

  test('labels, priority and owner survive when kata emits them, and are omitted when unset', async () => {
    const doc = JSON.parse(LIST_OK);
    doc.issues[0].labels = ['a', 'b'];
    doc.issues[0].priority = 2;
    doc.issues[0].owner = 'bot:x';
    delete doc.issues[1].priority;
    delete doc.issues[1].owner;
    delete doc.issues[1].labels;
    behave({ exit: 0, stdout: JSON.stringify(doc) });
    const result = await both('tracker.list', {});
    expect(result.ok).toBe(true);
    expect(result.data.items[0]).toMatchObject({ labels: ['a', 'b'], priority: '2', owner: 'bot:x' });
    expect(result.data.items[1].labels).toEqual([]);
    expect(result.data.items[1]).not.toHaveProperty('priority');
    expect(result.data.items[1]).not.toHaveProperty('owner');
  });

  test('an envelope flagged truncated is refused with no items', async () => {
    behave({ exit: 0, stdout: LIST_TRUNCATED });
    const result = await both('tracker.list', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
    expect(result.error.message).toMatch(/truncat/i);
    expect(result.data).toBeUndefined();
  });

  test('a row count that disagrees with total is refused (even if flags claim complete)', async () => {
    const doc = JSON.parse(LIST_OK);
    doc.issues = doc.issues.slice(0, 1);
    behave({ exit: 0, stdout: JSON.stringify(doc) });
    const result = await both('tracker.list', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
    expect(result.error.message).toMatch(/truncat/i);
    expect(result.data).toBeUndefined();
  });

  test('an envelope with no total is refused', async () => {
    const doc = JSON.parse(LIST_OK);
    delete doc.total;
    behave({ exit: 0, stdout: JSON.stringify(doc) });
    const result = await both('tracker.list', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
  });

  test('output cut off mid-JSON is a parse failure with no items', async () => {
    behave({ exit: 0, stdout: LIST_OK.slice(0, Math.floor(LIST_OK.length / 2)) });
    const result = await both('tracker.list', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
    expect(result.data).toBeUndefined();
  });

  test('non-JSON stdout is a parse failure', async () => {
    behave({ exit: 0, stdout: 'not json at all' });
    const result = await both('tracker.list', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
  });

  test.each([['open'], ['closed'], ['all'], [undefined]])(
    'every tracker.list argv (filter=%s) passes --include-total',
    (filter) => {
      const cap = MANIFEST.capabilities['tracker.list'];
      const tpl = filter === undefined ? cap.run : cap.variants.filter[filter];
      expect(tpl).toContain('--include-total');
      expect(tpl).toContain('--limit');
    }
  );
});

describe('TRD-029 mapOutput parse.countFrom unit', () => {
  const base = {
    format: 'json',
    root: '$',
    map: {},
    arrayMap: { items: { source: '$.rows', item: { id: '$.id' } } }
  };
  const doc = (n, total, extra = {}) =>
    JSON.stringify({ total, rows: Array.from({ length: n }, (_, i) => ({ id: `r${i}` })), ...extra });

  test('equal count maps normally', () => {
    expect(mapOutput(doc(2, 2), { ...base, countFrom: '$.total' }).items).toHaveLength(2);
  });

  test('zero rows with total 0 is a valid empty list', () => {
    expect(mapOutput(doc(0, 0), { ...base, countFrom: '$.total' }).items).toEqual([]);
  });

  test('fewer rows than total throws BAD_OUTPUT naming truncation', () => {
    let err;
    try {
      mapOutput(doc(1, 2), { ...base, countFrom: '$.total' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('BAD_OUTPUT');
    expect(err.message).toMatch(/truncat/i);
  });

  test('more rows than total also throws', () => {
    let err;
    try {
      mapOutput(doc(3, 2), { ...base, countFrom: '$.total' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('BAD_OUTPUT');
    expect(err.message).toMatch(/BAD_OUTPUT|truncat|disagree/i);
  });

  test('a missing or non-integer total throws', () => {
    expect(() => mapOutput(JSON.stringify({ rows: [] }), { ...base, countFrom: '$.total' })).toThrow();
    expect(() => mapOutput(doc(1, 'x'), { ...base, countFrom: '$.total' })).toThrow(/total/i);
  });

  test('a truncated:true flag refuses even when the count matches', () => {
    expect(() =>
      mapOutput(doc(2, 2, { truncated: true }), { ...base, countFrom: '$.total', truncatedFrom: '$.truncated' })
    ).toThrow(/truncat/i);
  });

  test('a complete:false flag refuses', () => {
    expect(() =>
      mapOutput(doc(2, 2, { complete: false }), { ...base, countFrom: '$.total', completeFrom: '$.complete' })
    ).toThrow(/incomplete|truncat/i);
  });

  test('countFrom without exactly one arrayMap entry is a manifest defect (BAD_OUTPUT)', () => {
    expect(() => mapOutput(doc(1, 1), { format: 'json', map: { total: '$.total' }, countFrom: '$.total' })).toThrow(/arrayMap/);
  });

  test('countFrom must be a dotted-path string', () => {
    expect(() => mapOutput(doc(1, 1), { ...base, countFrom: 5 })).toThrow(/countFrom/);
  });
});
