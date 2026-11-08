'use strict';

/**
 * `pr-review-cli.js walltime` through the real entry point (kata vrda): a child process, JSON on stdin, JSON on stdout,
 * the committed baseline file as the input, and a trace read from disk exactly as `timing` reads it. A request the
 * dispatcher cannot read is an error (exit 1); everything the module grades is an in-band result (exit 0).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { HANDLERS } = require('../lib/pr-review-cli');
const { SCHEMA, computeWalltimeCohort, compareWalltime } = require('../lib/pr-review-walltime');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const GUIDES = path.join(REPO_ROOT, 'docs', 'guides');
const FIXTURE = path.join(__dirname, 'fixtures', 'pr-review-timing', 'trace-review-pr234.jsonl');
const BASELINE = JSON.parse(
  fs.readFileSync(path.join(GUIDES, fs.readdirSync(GUIDES).filter((name) => /^review-walltime-baseline-\d{4}-\d{2}-\d{2}\.json$/.test(name)).pop()), 'utf8')
);

const sha = (char) => char.repeat(40);

function walltime(payload) {
  const result = spawnSync(process.execPath, [CLI, 'walltime'], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr, out: JSON.parse(result.stdout) };
}

/** One run per PR, three PRs per required stratum on each side. */
function row(id, pr, tier, round, wall, extra = {}) {
  return { id, pr, tier, round, origin: 'real', wall_min: wall, chains: 1, gate_runs: 1, source: 'test fixture', ...extra };
}
const stratum = (tier, round, walls, firstPr) => walls.map((wall, index) => row(`${tier}-${round}-${firstPr + index}`, firstPr + index, tier, round, wall));
const fatBaseline = () => ({
  schema: SCHEMA,
  runs: [...stratum('medium', 'first', [60, 66, 70], 100), ...stratum('high', 'first', [39, 55, 82], 200), ...stratum('high', 're-review', [60, 70, 80], 300)],
});
const fastCurrent = () => ({
  schema: SCHEMA,
  runs: [
    ...stratum('medium', 'first', [10, 12, 13], 400),
    ...stratum('high', 'first', [8, 10, 11], 500),
    ...stratum('high', 're-review', [10, 12], 600),
    row('carry-1', 900, 'high', 're-review', 12, { carry: { carried: 3, head_sha: sha('b'), from_heads: [sha('a')] } }),
  ],
});

describe('walltime is registered and answers what the module answers', () => {
  test('HANDLERS holds it, and the CLI prints the module result verbatim', () => {
    expect(typeof HANDLERS.walltime).toBe('function');
    const { status, out } = walltime({ action: 'summarize', cohort: BASELINE });
    expect(status).toBe(0);
    expect(out).toEqual(JSON.parse(JSON.stringify(computeWalltimeCohort(BASELINE))));
  });

  test('summarize of the committed baseline reproduces its stored metrics, through the entry point', () => {
    const { out } = walltime({ action: 'summarize', cohort: BASELINE });
    expect(out.ok).toBe(true);
    const { ok: _ok, ...rest } = out;
    expect(rest).toEqual(BASELINE.metrics);
  });

  test('compare is compareWalltime with every counted current row checked against its trace', () => {
    const payload = { action: 'compare', baseline: fatBaseline(), current: fastCurrent() };
    const { status, out } = walltime(payload);
    expect(status).toBe(0);
    const direct = JSON.parse(JSON.stringify(compareWalltime({ baseline: payload.baseline, current: payload.current })));
    // The same grades; only the claim differs, because these hand-typed rows name no trace to re-derive.
    expect({ ...out, fiveX: undefined, warnings: undefined }).toEqual({ ...direct, fiveX: undefined, warnings: undefined });
    expect(direct.fiveX.claim).toBe('met');
    expect(out.fiveX.claim).toBe('unknown');
    expect(out.fiveX.attestation.tracesChecked).toBe(true);
  });
});

describe('compare through the entry point', () => {
  test('the committed baseline against nothing measured is unknown everywhere and the claim is not made', () => {
    const { status, out } = walltime({ action: 'compare', baseline: BASELINE, current: { schema: SCHEMA, runs: [] } });
    expect(status).toBe(0);
    expect(out.ok).toBe(true);
    expect(out.strata.map((entry) => entry.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(out.fiveX).toMatchObject({ claim: 'unknown', met: false });
  });

  test('hand-typed rows reach met strata, but the entry point withholds the claim: they name no trace to re-derive', () => {
    const { out } = walltime({ action: 'compare', baseline: fatBaseline(), current: fastCurrent() });
    expect(out.strata.map((entry) => entry.status)).toEqual(['met', 'met', 'met']);
    expect(out.fiveX).toMatchObject({ claim: 'unknown', met: false, attestation: { tracesChecked: true } });
    expect(out.fiveX.reasons).toHaveLength(9);
    expect(out.fiveX.reasons[0]).toContain('the row names no trace (run_id)');
  });

  test('...and the carried re-review (AC3) is a reason of its own: carry evidence that carried nothing is named', () => {
    const current = fastCurrent();
    current.runs = current.runs.map((run) => (run.id === 'carry-1' ? { ...run, carry: { carried: 0, head_sha: sha('b'), from_heads: [] } } : run));
    const { out } = walltime({ action: 'compare', baseline: fatBaseline(), current });
    expect(out.strata.map((entry) => entry.status)).toEqual(['met', 'met', 'met']);
    expect(out.fiveX).toMatchObject({ claim: 'unknown', met: false });
    expect(out.fiveX.reasons).toContain('carry: no real high-tier re-review with carried verdicts and a wall time is in the current cohort');
  });

  test('a cohort it cannot read is a refusing RESULT (exit 0), never a clean pass', () => {
    const { status, out } = walltime({ action: 'compare', baseline: BASELINE, current: { schema: SCHEMA, runs: [row('a', 1, 'urgent', 'first', 5)] } });
    expect(status).toBe(0);
    expect(out).toMatchObject({ ok: false, fiveX: { claim: 'unknown', met: false } });
    expect(out.reason).toMatch(/^current cannot be read/);
  });
});

describe('row from a trace on disk, exactly as `timing` reads it', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-walltime-cli-'));
    const traces = path.join(dir, '.ensemble', 'state', 'toolchain');
    fs.mkdirSync(traces, { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(traces, 'trace-review-pr234.jsonl'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const request = (extra) => ({ action: 'row', pr: 234, tier: 'medium', round: 'first', origin: 'fixture', runId: 'review-pr234', ...extra });

  test('the #234 trace becomes a row: 19.661 min, one chain, no gate span so no gate count', () => {
    const { status, out } = walltime(request({ cwd: dir }));
    expect(status).toBe(0);
    expect(out).toEqual({
      ok: true,
      row: {
        id: 'pr234-first-review-pr234',
        pr: 234,
        tier: 'medium',
        round: 'first',
        origin: 'fixture',
        wall_min: 19.661,
        chains: 1,
        gate_runs: null,
        gate_runs_reason: "no 'review.gate' span was recorded",
        source: 'pr-review-cli timing on run review-pr234',
        run_id: 'review-pr234',
      },
    });
  });

  test('the row is a valid cohort row, and a fixture row is excluded from the compare, never counted', () => {
    const { out } = walltime(request({ cwd: dir }));
    const compared = walltime({ action: 'compare', baseline: BASELINE, current: { schema: SCHEMA, runs: [out.row] } });
    expect(compared.out.ok).toBe(true);
    expect(compared.out.excluded.current).toEqual([{ id: out.row.id, pr: 234, origin: 'fixture', reason: 'origin is fixture: listed here, never counted' }]);
    expect(compared.out.strata.find((entry) => entry.id === 'medium/first').current).toMatchObject({ runs: 0, prs: 0 });
  });

  test('a trace that is not there is a refusing result naming the read, not a row', () => {
    const { status, out } = walltime(request({ cwd: dir, runId: 'no-such-run' }));
    expect(status).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('cannot read the run trace');
  });

  test('a timing answer can be passed instead of a runId', () => {
    const timing = JSON.parse(spawnSync(process.execPath, [CLI, 'timing'], { input: JSON.stringify({ runId: 'review-pr234', cwd: dir }), encoding: 'utf8' }).stdout);
    const { out } = walltime({ action: 'row', pr: 234, tier: 'medium', round: 'first', origin: 'fixture', timing });
    expect(out.ok).toBe(true);
    expect(out.row.wall_min).toBe(19.661);
  });

  test('carry evidence is derived from the verdicts array in the payload: the CLI does not read a state report', () => {
    const verdicts = [{ id: 'F-1', head: sha('b'), carriedFrom: sha('a') }];
    const { out } = walltime(request({ cwd: dir, round: 're-review', carry: { headSha: sha('b'), verdicts } }));
    expect(out.row.carry).toEqual({ carried: 1, head_sha: sha('b'), from_heads: [sha('a')] });
  });

  test('a tier outside low, medium, high is a refusing result', () => {
    const { status, out } = walltime(request({ cwd: dir, tier: 'urgent' }));
    expect(status).toBe(0);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('needs tier to be one of');
  });
});

describe('a request the dispatcher cannot read is an error (exit 1), so a misspelt key is never an empty answer', () => {
  test.each([
    ['an unknown action', { action: 'nope' }, "Unknown walltime action 'nope'. Expected one of: summarize, row, compare"],
    ['no action', {}, 'Unknown walltime action undefined'],
    ['a payload that is not an object', null, 'walltime payload must be a JSON object'],
    ['summarize without a cohort', { action: 'summarize' }, "walltime action 'summarize' requires payload key 'cohort' to be an object"],
    ['summarize with a cohort that is not an object', { action: 'summarize', cohort: 'x' }, "requires payload key 'cohort' to be an object"],
    ['compare without a baseline', { action: 'compare', current: { runs: [] } }, "requires payload key 'baseline' to be an object"],
    ['compare without a current', { action: 'compare', baseline: { runs: [] } }, "requires payload key 'current' to be an object"],
    ['row without a PR', { action: 'row', tier: 'high', round: 'first', origin: 'real', runId: 'x' }, "requires payload key 'pr' to be an integer"],
    ['row without a tier', { action: 'row', pr: 1, round: 'first', origin: 'real', runId: 'x' }, "requires payload key 'tier' to be a non-empty string"],
    ['row with neither runId nor timing', { action: 'row', pr: 1, tier: 'high', round: 'first', origin: 'real' }, "requires exactly one of the payload keys 'runId' or 'timing'"],
    ['row with both runId and timing', { action: 'row', pr: 1, tier: 'high', round: 'first', origin: 'real', runId: 'x', timing: {} }, "requires exactly one of the payload keys 'runId' or 'timing'"],
    ['row with cwd and timing', { action: 'row', pr: 1, tier: 'high', round: 'first', origin: 'real', timing: {}, cwd: '.' }, "takes 'cwd' only with 'runId'"],
    ['row with a misspelt key (runid)', { action: 'row', pr: 1, tier: 'high', round: 'first', origin: 'real', runid: 'x' }, "does not accept payload key(s) 'runid'"],
    ['row with a misspelt carry key', { action: 'row', pr: 1, tier: 'high', round: 're-review', origin: 'real', runId: 'x', carrry: {} }, "does not accept payload key(s) 'carrry'"],
    ['row with a carry that is not an object', { action: 'row', pr: 1, tier: 'high', round: 'first', origin: 'real', runId: 'x', carry: 5 }, "payload key 'carry' must be an object when given"],
    ['compare with an extra key', { action: 'compare', baseline: { runs: [] }, current: { runs: [] }, minimum: 1 }, "does not accept payload key(s) 'minimum'"],
  ])('%s', (_, payload, message) => {
    const { status, out } = walltime(payload);
    expect(status).toBe(1);
    expect(out.error).toContain(message);
  });

  test('an inherited name is not an action', () => {
    for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const { status, out } = walltime({ action });
      expect(status).toBe(1);
      expect(out.error).toContain('Unknown walltime action');
    }
  });

  test('a payload that is not JSON is an error', () => {
    const { status, out } = walltime('{not json');
    expect(status).toBe(1);
    expect(out.error).toContain('invalid JSON on stdin');
  });
});

describe('compare re-derives each counted current row from its trace, and a met needs that', () => {
  // Nine real current rows, three PRs in each required stratum, each backed by a copy of the committed #234 trace under
  // its own run id (19.661 min, one chain, no gate span), against a baseline five times slower.
  let dir;
  const slowBaseline = () => ({
    schema: SCHEMA,
    runs: [...stratum('medium', 'first', [100, 101, 102], 100), ...stratum('high', 'first', [100, 101, 102], 200), ...stratum('high', 're-review', [100, 101, 102], 300)],
  });
  const traced = (id, pr, tier, round, extra = {}) => row(id, pr, tier, round, 19.661, { gate_runs: null, gate_runs_reason: 'no span', run_id: `rid-${id}`, ...extra });
  const tracedCurrent = () => ({
    schema: SCHEMA,
    runs: [
      ...[400, 401, 402].map((pr) => traced(`m-${pr}`, pr, 'medium', 'first')),
      ...[500, 501, 502].map((pr) => traced(`h-${pr}`, pr, 'high', 'first')),
      traced('r-600', 600, 'high', 're-review'),
      traced('r-601', 601, 'high', 're-review'),
      traced('r-602', 602, 'high', 're-review', { carry: { carried: 2, head_sha: sha('b'), from_heads: [sha('a')] } }),
    ],
  });
  const compareIn = (current, extra = {}) => walltime({ action: 'compare', baseline: slowBaseline(), current, ...extra });

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walltime-compare-'));
    const traces = path.join(dir, '.ensemble', 'state', 'toolchain');
    fs.mkdirSync(traces, { recursive: true });
    const text = fs.readFileSync(FIXTURE, 'utf8');
    for (const run of tracedCurrent().runs) fs.writeFileSync(path.join(traces, `trace-${run.run_id}.jsonl`), text.split('review-pr234').join(run.run_id));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('every row matches its trace: met, with the traces checked and the rest attested', () => {
    const { status, out } = compareIn(tracedCurrent(), { cwd: dir });
    expect(status).toBe(0);
    expect(out.fiveX).toMatchObject({ claim: 'met', met: true, reasons: [], attestation: { tracesChecked: true, rowsWithoutTraceCheck: [] } });
    expect(out.warnings).toEqual([expect.stringContaining('re-derived from their traces')]);
  });

  test('without the traces (the working directory holds none) the same rows are unknown, never met', () => {
    const { out } = compareIn(tracedCurrent());
    expect(out.fiveX.claim).toBe('unknown');
    expect(out.fiveX.reasons).toHaveLength(9);
    expect(out.fiveX.reasons[0]).toContain("trace: row 'm-400' was not re-derived from its trace");
  });

  test('a row whose wall time was edited (still above the floor) is named with what its trace says', () => {
    const current = tracedCurrent();
    current.runs.find((run) => run.id === 'h-501').wall_min = 3;
    const { out } = compareIn(current, { cwd: dir });
    expect(out.fiveX.claim).toBe('unknown');
    expect(out.fiveX.reasons).toEqual(["trace: row 'h-501' was not re-derived from its trace (wall_min is 3, its trace says 19.661)"]);
  });

  test('a row that names no trace is not re-derived', () => {
    const current = tracedCurrent();
    delete current.runs.find((run) => run.id === 'r-601').run_id;
    const { out } = compareIn(current, { cwd: dir });
    expect(out.fiveX.claim).toBe('unknown');
    expect(out.fiveX.reasons).toEqual(["trace: row 'r-601' was not re-derived from its trace (the row names no trace (run_id), so its figures cannot be re-derived)"]);
  });

  test('cwd must be text, and a misspelt key is still an error', () => {
    expect(compareIn(tracedCurrent(), { cwd: 5 }).status).toBe(1);
    expect(compareIn(tracedCurrent(), { cwdd: dir }).status).toBe(1);
  });
});
