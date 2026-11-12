'use strict';

/**
 * The committed wall-time baseline (kata vrda, AC1): docs/guides/review-walltime-baseline-<date>.json.
 *
 * What is pinned here is that the file is REPRODUCIBLE from its stated sources:
 *   - its `metrics` block is what the library computes from its `runs` (a number edited by hand fails);
 *   - every figure it takes from the plan's section 1 is in the plan's table, in the cell it names, so a plan figure that
 *     moves (or a baseline figure that is edited) fails CI. The figures are quoted below, not re-derived from the file;
 *   - the figures it recomputed from the omp session files (which CI cannot read) agree with the rows: the plan's whole
 *     minutes are the sessions' task durations cut to the minute, and the 77.4 -> 70.4 min restatement of the plan's
 *     correction C01 is exactly the 7:00 idle linger.
 * And that it is HONEST about what it cannot support: a stratum with fewer PRs than the minimum is `unknown` in a
 * compare, computed from the file rather than assumed.
 */

const fs = require('fs');
const path = require('path');

const { SCHEMA, MINIMUMS, REQUIRED_STRATA, validateCohort, computeWalltimeCohort, compareWalltime } = require('../lib/pr-review-walltime');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GUIDES = path.join(REPO_ROOT, 'docs', 'guides');
const PLAN = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'plans', 'pr-review-speedup-plan.md'), 'utf8');
const NAME = /^review-walltime-baseline-\d{4}-\d{2}-\d{2}\.json$/;

const files = fs.readdirSync(GUIDES).filter((name) => NAME.test(name));
const FILE = files[files.length - 1];
const baseline = JSON.parse(fs.readFileSync(path.join(GUIDES, FILE), 'utf8'));
const runOf = (id) => baseline.runs.find((run) => run.id === id);

/** The minutes a plan table cell states, in the order it states them. */
function minutesIn(cell) {
  const hoursAndMinutes = cell.match(/^(\d+)h\s*(\d+)m$/);
  if (hoursAndMinutes) return [Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2])];
  const slashed = cell.match(/^(\d+(?:\s*\/\s*\d+)*)\s*min$/);
  if (slashed) return slashed[1].split('/').map((part) => Number(part.trim()));
  const about = cell.match(/^about (\d+) min/);
  if (about) return [Number(about[1])];
  throw new Error(`cannot read the plan cell ${JSON.stringify(cell)}`);
}

/** Plan section 1 rows, the cell each wall figure is in, and the baseline rows that take it (in the cell's order). */
const PLAN_WALL_FIGURES = [
  { row: '#233 round 1', cell: '1h 22m', runs: ['pr233-first'] },
  { row: '#225 / #228 / #229 (3 run concurrently)', cell: '66 / 39 / 55 min', runs: ['pr225-first', 'pr228-first', 'pr229-first'] },
  { row: '#233 re-review', cell: 'about 70 min, plus 28', runs: ['pr233-rereview-1'] },
];

describe('the committed baseline file', () => {
  test('exists under the wall-time name (not the PR-count cohort name review-baseline-<date>.json, whose test checks another schema)', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(FILE).toMatch(NAME);
    expect(FILE).not.toMatch(/^review-baseline-/);
  });

  test('is a cohort of the current schema that the library can read', () => {
    expect(baseline.schema).toBe(SCHEMA);
    const checked = validateCohort(baseline, FILE);
    expect(checked.ok).toBe(true);
    expect(baseline.repository).toBe('Sunstone-Partners/ensemble');
    expect(baseline.cohort.definition.length).toBeGreaterThan(40);
    expect(baseline.cohort.note.length).toBeGreaterThan(40);
  });

  test('every run is a real pre-speedup review that names its source', () => {
    expect(baseline.runs.length).toBeGreaterThan(0);
    for (const run of baseline.runs) {
      expect(run.origin).toBe('real');
      expect(run.source.length).toBeGreaterThan(30);
    }
  });

  test('its stored metrics are exactly what the library computes from its runs', () => {
    const { ok, ...computed } = computeWalltimeCohort(baseline);
    expect(ok).toBe(true);
    expect(baseline.metrics).toEqual(computed);
  });
});

describe('AC1: reproducible from the stated sources', () => {
  test.each(PLAN_WALL_FIGURES)('plan section 1 row $row: cell $cell is in the table and gives the figures the baseline takes', ({ row, cell, runs }) => {
    const line = PLAN.split('\n').find((text) => text.startsWith('|') && text.includes(row) && text.includes(cell));
    expect(line).toBeDefined();
    expect(minutesIn(cell)).toHaveLength(runs.length);
    runs.forEach((id, index) => {
      expect(runOf(id).wall_min).toBe(minutesIn(cell)[index]);
    });
  });

  test('plan section 1 states the gate runs of #225 and #229 and the baseline takes them', () => {
    const cell = '#225 needed 3 runs, #229 needed 2';
    expect(PLAN.split('\n').some((text) => text.startsWith('|') && text.includes('Local-CI gate') && text.includes(cell))).toBe(true);
    expect(runOf('pr225-first').gate_runs).toBe(3);
    expect(runOf('pr229-first').gate_runs).toBe(2);
  });

  test("plan section 1 restates the #233 re-review from each agent's last message: 70 min, not 77 (correction C01)", () => {
    expect(PLAN).toContain('the whole re-review chain is 70 min, not 77');
    const check = baseline.provenance.sessions.checks.find((entry) => entry.run === 'pr233-rereview-1');
    expect(check.minutes_if_session_exit_were_used - check.minutes).toBeCloseTo(7, 1);
    expect(runOf('pr233-rereview-1').wall_min).toBe(70);
  });

  test("plan section 1 says #233 'has been through four such chains' and the baseline's #233 rows add up to four", () => {
    expect(PLAN).toContain('#233 has been through four such chains');
    const entry = baseline.metrics.perPr.find((pr) => pr.pr === 233);
    expect(entry.reviewChains).toBe(4);
    expect(entry.gateRuns).toBe(4);
  });

  test('the recorded session checks agree with the rows (the plan truncates to whole minutes); the session files themselves are not readable in CI', () => {
    const { sessions } = baseline.provenance;
    expect(sessions.available_to_ci).toBe(false);
    expect(sessions.method).toContain("never to 'session_exit'");
    for (const check of sessions.checks) {
      const run = runOf(check.run);
      expect(run).toBeDefined();
      expect(run.tier).toBe(check.tier);
      expect(run.gate_runs).toBe(check.gate_runs);
      if (run.wall_min !== null) {
        const excess = check.minutes - run.wall_min;
        expect(excess).toBeGreaterThanOrEqual(0);
        expect(excess).toBeLessThan(1);
      }
    }
    expect(sessions.checks.map((entry) => entry.run).sort()).toEqual(baseline.runs.map((run) => run.id).sort());
  });

  test('each session check states where its interval ends and where its gate-run count comes from (the end point differs per row)', () => {
    const { sessions } = baseline.provenance;
    expect(sessions.method).toContain('The interval of each check is stated on the check');
    for (const check of sessions.checks) {
      expect(typeof check.interval).toBe('string');
      expect(typeof check.gate_runs_source).toBe('string');
    }
    const checkOf = (run) => sessions.checks.find((entry) => entry.run === run);
    expect(checkOf('pr233-first').interval).toContain('2026-11-04T19:22:43.595Z');
    expect(checkOf('pr233-first').interval).toContain('is not this figure');
    expect(checkOf('pr233-rereview-1').interval).toContain('2026-11-04T21:25:13.744Z');
    expect(checkOf('pr233-rereview-1').interval).toContain('2026-11-04T22:35:39.343Z');
    expect(checkOf('pr225-first').gate_runs_source).toContain("the plan's text");
    expect(checkOf('pr229-first').gate_runs_source).toContain("the plan's text");
    expect(checkOf('pr228-first').gate_runs_source).toContain('only');
    expect(checkOf('pr233-first').gate_runs_source).toContain('only');
  });
});

describe('the baseline does not claim more than it measured', () => {
  test('the aborted fourth #233 chain has no wall time, and says why', () => {
    const aborted = runOf('pr233-rereview-2');
    expect(aborted.wall_min).toBeNull();
    expect(aborted.wall_min_reason).toContain('aborted');
    const perPr = baseline.metrics.perPr.find((pr) => pr.pr === 233);
    expect(perPr.wallMinTotal).toBeNull();
    expect(perPr.wallMinTotalReason).toContain('pr233-rereview-2');
  });

  test('the tier recorded for each PR is the one pr-review-cli tier gave in the review sessions (pinned here, not re-derived)', () => {
    expect(baseline.metrics.perPr.map((pr) => [pr.pr, pr.tier])).toEqual([
      [225, 'medium'],
      [228, 'high'],
      [229, 'high'],
      [233, 'high'],
    ]);
  });

  test('what was considered and left out is listed with a reason', () => {
    expect(baseline.excluded.length).toBeGreaterThanOrEqual(5);
    for (const entry of [...baseline.excluded, ...baseline.unmeasured]) {
      const reason = entry.reason;
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(20);
    }
    const left = baseline.excluded.map((entry) => entry.what).join('\n');
    for (const needle of ['fix round', 'Local-CI gate', 'Per agent', '#202', '#234']) expect(left).toContain(needle);
  });

  test('a stratum with no run in the file is listed as unmeasured, and no run is in it', () => {
    for (const { stratum } of baseline.unmeasured) {
      const [tier, round] = stratum.split('/');
      expect(baseline.runs.filter((run) => run.tier === tier && run.round === round)).toEqual([]);
    }
  });

  test('every required stratum is in the metrics, with a median only where a run has a wall time', () => {
    for (const id of REQUIRED_STRATA) {
      const entry = baseline.metrics.strata.find((own) => own.id === id);
      expect(entry).toBeDefined();
      expect(entry.medianMin === null).toBe(entry.runs === 0);
    }
  });
});

describe('what the baseline supports in a compare (computed from the file, never assumed)', () => {
  const empty = { schema: SCHEMA, runs: [] };

  test('a stratum is graded against the baseline only where the baseline itself has the minimum number of PRs', () => {
    const result = compareWalltime({ baseline, current: empty });
    expect(result.ok).toBe(true);
    for (const entry of result.strata) {
      const own = baseline.metrics.strata.find((stratum) => stratum.id === entry.id);
      const thin = own.prs < MINIMUMS.prsPerStratum;
      const refusedForBaseline = entry.reasons.some((reason) => reason.startsWith('baseline-too-few-prs'));
      expect([entry.id, refusedForBaseline]).toEqual([entry.id, thin]);
      expect(entry.status).toBe('unknown');
    }
    expect(result.fiveX).toMatchObject({ claim: 'unknown', met: false });
  });

  test('the baseline compared with itself is not 5x', () => {
    const result = compareWalltime({ baseline, current: baseline });
    expect(result.fiveX.met).toBe(false);
    expect(result.fiveX.claim).not.toBe('met');
    for (const entry of result.strata) expect(entry.status).not.toBe('met');
  });

  test('the file is documented where a reader will look for it', () => {
    const guide = fs.readFileSync(path.join(GUIDES, 'pr-review-walltime.md'), 'utf8');
    expect(guide).toContain(FILE);
    for (const word of ['walltime', 'summarize', 'row', 'compare', 'unknown', 'carry']) expect(guide).toContain(word);
  });
});
