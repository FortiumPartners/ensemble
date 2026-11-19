'use strict';

/**
 * TRD-011 -- close with reason and evidence (TRD-2026-6995dc96 TRD-011; PRD REQ-003 AC-003-1,
 * AC-003-2, AC-003-3).
 *
 *  - tracker.close-with-reason carries the reason and the commit to `kata close --done -m ... --commit ...`.
 *  - A bare tracker.close {id} is refused INVALID_ARG naming tracker.close-with-reason BEFORE any
 *    kata process runs (mandatory sentinel placeholder), so nothing is closed silently.
 *  - A missing reason is refused INVALID_ARG before kata runs; kata's own too-short-reason refusal
 *    surfaces TOOL_FAILED.
 *  - tracker.close-with-evidence (manifest-declared, not in the shipped tracker 1.0 contract)
 *    carries one typed `--evidence` value, e.g. `test:<command>`.
 *  - The manifest still passes validateConformance, and the `refuse.` sentinel exemption in
 *    validate.js is narrow: any other undeclared placeholder is still rejected.
 *
 * The behaviour tests use a recording stub `kata` (scratch under ~/.omp/br-l6wlk, never /tmp).
 * They prove the adapter's argv and refusal behaviour, NOT kata's own recording of the reason;
 * that part was verified against a real kata 0.23.0 (see adapter.yaml and SKILL.md).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability, runCapabilitySync } = require('../lib/toolchain/runner');
const { validateConformance, validateManifest } = require('../lib/toolchain/validate');
const { loadContracts } = require('../lib/toolchain/contracts');

const DEV_ROOT = path.join(__dirname, '..');
const ADAPTER_DIR = path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata');
const MANIFEST = yaml.load(fs.readFileSync(path.join(ADAPTER_DIR, 'adapter.yaml'), 'utf8'));

const REASON = 'Verified the close path end to end and recorded the evidence';
const SCRATCH = path.join(os.homedir(), '.omp', 'br-l6wlk', 'jest', `close-${process.pid}`);
const WORKDIR = path.join(SCRATCH, 'cwd');
let argvLog;
let opts;

beforeAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(WORKDIR, { recursive: true });
  argvLog = path.join(SCRATCH, 'argv.log');
  // Mimics kata's validation: a `-m` message under 40 chars is refused (exit 3, JSON on stdout).
  fs.writeFileSync(
    path.join(SCRATCH, 'kata'),
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('fs');",
      "fs.appendFileSync(__dirname + '/argv.log', JSON.stringify(process.argv.slice(2)) + '\\n');",
      'const a = process.argv.slice(2);',
      "const i = a.indexOf('-m');",
      'if (i >= 0 && a[i + 1].length < 40) {',
      "  process.stdout.write(JSON.stringify({ error: { kind: 'validation', message: 'message too short for reason=done (need >=40 chars after normalization)', exit_code: 3 } }));",
      '  process.exit(3);',
      '}',
      "process.stdout.write(JSON.stringify({ issue: { short_id: a[1], status: 'closed', closed_reason: 'done' }, event: { type: 'issue.closed' }, changed: true }));",
      ''
    ].join('\n')
  );
  fs.chmodSync(path.join(SCRATCH, 'kata'), 0o755);
  opts = {
    parentEnv: { PATH: `${SCRATCH}${path.delimiter}${process.env.PATH}`, HOME: SCRATCH },
    execFileOptions: { cwd: WORKDIR }
  };
});

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(argvLog, { force: true });
});

function argvs() {
  if (!fs.existsSync(argvLog)) return [];
  return fs.readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function both(capability, args) {
  const a = await runCapability(MANIFEST, capability, args, opts);
  const calls = argvs().length;
  const s = runCapabilitySync(MANIFEST, capability, args, opts);
  // The sync entry point must agree on the envelope for every refusal and every success.
  expect(s.ok).toBe(a.ok);
  if (!a.ok) expect(s.error).toEqual(a.error);
  return { result: a, calls, syncCalls: argvs().length - calls };
}

describe('TRD-011 tracker.close-with-reason (AC-003-1)', () => {
  test('runs kata close --done -m <reason> --commit <sha> --json and succeeds', async () => {
    const { result } = await both('tracker.close-with-reason', { id: 'ab3d', reason: REASON, commit: 'abc1234' });
    expect(result.ok).toBe(true);
    expect(argvs()[0]).toEqual(['close', 'ab3d', '--done', '-m', REASON, '--commit', 'abc1234', '--json']);
  });

  test('declares exactly the contract inputs (id, reason, commit)', () => {
    const joined = MANIFEST.capabilities['tracker.close-with-reason'].run.join(' ');
    expect([...joined.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]).sort()).toEqual(['commit', 'id', 'reason']);
  });
});

describe('TRD-011 absent reason is refused observably (AC-003-2)', () => {
  test.each([
    ['reason', { id: 'ab3d', commit: 'abc1234' }],
    ['commit', { id: 'ab3d', reason: REASON }],
    ['reason (null)', { id: 'ab3d', reason: null, commit: 'abc1234' }]
  ])('close-with-reason without %s -> INVALID_ARG, kata never runs', async (_label, args) => {
    const { result, calls, syncCalls } = await both('tracker.close-with-reason', args);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(calls + syncCalls).toBe(0);
  });

  test('a reason kata rejects as too short surfaces TOOL_FAILED naming the rule', async () => {
    const { result } = await both('tracker.close-with-reason', { id: 'ab3d', reason: 'short', commit: 'abc1234' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TOOL_FAILED');
    expect(result.error.message).toContain('message too short');
  });
});

describe('TRD-011 bare tracker.close is refused, never closes silently (AC-003-2)', () => {
  test('{id} only -> INVALID_ARG naming tracker.close-with-reason; kata is never invoked', async () => {
    const { result, calls, syncCalls } = await both('tracker.close', { id: 'ab3d' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(result.error.message).toContain('tracker.close-with-reason');
    expect(calls + syncCalls).toBe(0);
    expect(argvs()).toEqual([]);
  });

  test('also refused when the id itself is missing (still INVALID_ARG, still no kata call)', async () => {
    const { result, calls, syncCalls } = await both('tracker.close', {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(calls + syncCalls).toBe(0);
  });

  test('the manifest still declares tracker.close, because the contract marks it required', () => {
    expect(MANIFEST.capabilities['tracker.close']).toBeDefined();
  });
});

describe('TRD-011 tracker.close-with-evidence (AC-003-3)', () => {
  const TEST_CMD = 'npx jest packages/development/tests/kata-close-evidence.test.js';

  test('argv carries --evidence test:<command> verbatim as one element', async () => {
    const { result } = await both('tracker.close-with-evidence', {
      id: 'ab3d',
      reason: REASON,
      evidence: `test:${TEST_CMD}`
    });
    expect(result.ok).toBe(true);
    expect(argvs()[0]).toEqual(['close', 'ab3d', '--done', '-m', REASON, '--evidence', `test:${TEST_CMD}`, '--json']);
  });

  test.each([
    ['commit', 'commit:abc1234'],
    ['pr', 'pr:https://example.test/pull/1']
  ])('also carries %s evidence', async (_k, evidence) => {
    const { result } = await both('tracker.close-with-evidence', { id: 'ab3d', reason: REASON, evidence });
    expect(result.ok).toBe(true);
    expect(argvs()[0]).toContain(evidence);
  });

  test.each([
    ['evidence', { id: 'ab3d', reason: REASON }],
    ['reason', { id: 'ab3d', evidence: 'test:make check' }]
  ])('missing %s -> INVALID_ARG, kata never runs', async (_l, args) => {
    const { result, calls, syncCalls } = await both('tracker.close-with-evidence', args);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(calls + syncCalls).toBe(0);
  });

  test('an evidence value that looks like a flag is refused before kata runs', async () => {
    const { result, calls } = await both('tracker.close-with-evidence', { id: 'ab3d', reason: REASON, evidence: '--force' });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_ARG');
    expect(calls).toBe(0);
  });
});

describe('TRD-011 manifest validity', () => {
  const contracts = loadContracts();

  test('validateConformance accepts the kata manifest (sentinel + manifest-only capability)', () => {
    expect(validateConformance(MANIFEST, contracts)).toEqual({ ok: true, errors: [] });
  });

  test('validateManifest accepts the kata adapter directory', () => {
    expect(validateManifest(ADAPTER_DIR)).toEqual({ valid: true, errors: [] });
  });

  test('the exemption is narrow: any other undeclared placeholder is still rejected', () => {
    const m = JSON.parse(JSON.stringify(MANIFEST));
    m.capabilities['tracker.close'].run = ['kata', 'close', '${id}', '${bogus}', '--json'];
    const res = validateConformance(m, contracts);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain("'${bogus}'");
  });

  test('the exemption is narrow: a near-miss prefix is still rejected', () => {
    const m = JSON.parse(JSON.stringify(MANIFEST));
    m.capabilities['tracker.close'].run = ['kata', 'close', '${id}', '${refused}', '--json'];
    expect(validateConformance(m, contracts).ok).toBe(false);
  });

  test('the exemption also covers variant templates and is equally narrow there', () => {
    const m = JSON.parse(JSON.stringify(MANIFEST));
    m.capabilities['tracker.set-status'].variants.status.closed = ['kata', 'close', '${id}', '${bogus}'];
    expect(validateConformance(m, contracts).ok).toBe(false);
    m.capabilities['tracker.set-status'].variants.status.closed = ['kata', 'close', '${id}', '${refuse.x.tracker.close-with-reason}'];
    expect(validateConformance(m, contracts).ok).toBe(true);
  });
});
