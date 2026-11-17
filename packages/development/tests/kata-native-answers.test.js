'use strict';

/**
 * TRD-014 -- native answers for tracker.update-detailed, tracker.stage-export and tracker.sync
 * (TRD-2026-6995dc96 TRD-014; PRD REQ-006 AC-006-1). Each must be answered by the kata adapter
 * itself: ok:true, the success envelope names adapter `kata`, and no `unavailable`/`fallback`
 * key appears anywhere.
 *
 * A fake `kata` executable (scratch under ~/.omp/br-h0rf4-jest, never /tmp) replays envelopes and
 * logs every argv, so the tests can assert which subcommands ran and that nothing is written.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability, runCapabilitySync } = require('../lib/toolchain/runner');

const DEV_ROOT = path.join(__dirname, '..');
const MANIFEST = yaml.load(
  fs.readFileSync(path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8')
);
const SKILL = fs.readFileSync(path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'SKILL.md'), 'utf8');

const EDIT_ENVELOPE = JSON.stringify({
  kata_api_version: 1,
  issue: { short_id: 'ab3d', title: 'T', body: 'B', status: 'open', priority: 2 },
  event: { type: 'edited' },
  events: [],
  changed: true
});
const DOCTOR_ENVELOPE = JSON.stringify({
  kata_api_version: 1,
  version: 1,
  checks: [{ id: 'config.workspace', category: 'config', status: 'warn', summary: 'unbound', details: [], fix: '' }],
  summary: { ok: 0, info: 11, warn: 1, fail: 0 }
});

const SCRATCH = path.join(os.homedir(), '.omp', 'br-h0rf4-jest', `native-${process.pid}`);
const WORKDIR = path.join(SCRATCH, 'cwd');
let behaviourFile;
let argvLog;
let opts;

beforeAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(WORKDIR, { recursive: true });
  behaviourFile = path.join(SCRATCH, 'behaviour.json');
  argvLog = path.join(SCRATCH, 'argv.log');
  const bin = path.join(SCRATCH, 'kata');
  fs.writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('fs');",
      "const b = JSON.parse(fs.readFileSync(__dirname + '/behaviour.json', 'utf8'));",
      "fs.appendFileSync(__dirname + '/argv.log', JSON.stringify(process.argv.slice(2)) + '\\n');",
      // A real `kata export` writes a file into cwd; mimic it so a stray export is detectable.
      "if (process.argv[2] === 'export') fs.writeFileSync('.kata-export.jsonl', 'x');",
      'if (b.stdout) process.stdout.write(b.stdout);',
      'if (b.stderr) process.stderr.write(b.stderr);',
      'process.exit(b.exit || 0);',
      ''
    ].join('\n')
  );
  fs.chmodSync(bin, 0o755);
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

function behave(b) {
  fs.writeFileSync(behaviourFile, JSON.stringify(b));
}

function argvs() {
  if (!fs.existsSync(argvLog)) return [];
  return fs.readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function both(capability, args = {}) {
  const a = await runCapability(MANIFEST, capability, args, opts);
  const s = runCapabilitySync(MANIFEST, capability, args, opts);
  expect(s).toEqual(a);
  return a;
}

function expectNative(result) {
  expect(result.ok).toBe(true);
  expect(result.adapter).toBe('kata');
  expect(result).not.toHaveProperty('unavailable');
  expect(result).not.toHaveProperty('fallback');
  expect(result.data).not.toHaveProperty('unavailable');
  expect(result.data).not.toHaveProperty('fallback');
}

describe('TRD-014 tracker.update-detailed', () => {
  const args = { id: 'ab3d', title: 'T', description: 'B', priority: '2', notes: 'a note' };

  test('answers natively with the id of the edited item', async () => {
    behave({ stdout: EDIT_ENVELOPE });
    const result = await both('tracker.update-detailed', args);
    expectNative(result);
    expect(result.data).toEqual({ id: 'ab3d' });
  });

  test('argv applies the note with --comment and touches no label/status/owner flag', async () => {
    behave({ stdout: EDIT_ENVELOPE });
    await runCapability(MANIFEST, 'tracker.update-detailed', args, opts);
    const [argv] = argvs();
    expect(argv[0]).toBe('edit');
    expect(argv).toEqual(expect.arrayContaining(['--title', 'T', '--body', 'B', '--priority', '2']));
    const i = argv.indexOf('--comment');
    expect(i).toBeGreaterThan(-1);
    expect(argv[i + 1]).toBe('a note');
    for (const flag of argv.filter((a) => a.startsWith('--'))) {
      expect(flag).not.toMatch(/label|status|owner|blocked/);
    }
  });
});

describe('TRD-014 tracker.sync', () => {
  test('answers {status: synced} from the adapter without a fallback', async () => {
    behave({ stdout: DOCTOR_ENVELOPE });
    const result = await both('tracker.sync');
    expectNative(result);
    expect(result.data).toEqual({ status: 'synced' });
  });

  test('is read-only: runs `kata doctor --json` and nothing else', async () => {
    behave({ stdout: DOCTOR_ENVELOPE });
    await runCapability(MANIFEST, 'tracker.sync', {}, opts);
    expect(argvs()).toEqual([['doctor', '--json']]);
  });

  test('a non-zero doctor exit is a failure, never synced', async () => {
    behave({ exit: 7, stderr: 'daemon unreachable' });
    const result = await both('tracker.sync');
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('TOOL_FAILED');
    expect(result.data).toBeUndefined();
  });
});

describe('TRD-014 tracker.stage-export', () => {
  test('answers the contract unavailable status itself, with no fallback marker', async () => {
    behave({ stdout: DOCTOR_ENVELOPE });
    const result = await both('tracker.stage-export', {});
    expectNative(result);
    expect(result.data).toEqual({ text: '', status: 'unavailable' });
  });

  test('runs no export subcommand and creates no file in cwd', async () => {
    behave({ stdout: DOCTOR_ENVELOPE });
    await runCapability(MANIFEST, 'tracker.stage-export', {}, opts);
    for (const argv of argvs()) expect(argv).not.toContain('export');
    expect(fs.readdirSync(WORKDIR)).toEqual([]);
  });

  test('the manifest no longer allowlists kata export', () => {
    const subs = MANIFEST.allowlist.find((a) => a.bin === 'kata').sub;
    expect(subs).not.toContain('export');
  });
});

describe('TRD-014 docs', () => {
  test('SKILL.md no longer says TRD-014 owns these gaps', () => {
    expect(SKILL).not.toMatch(/TRD-014 owns/);
  });
});
