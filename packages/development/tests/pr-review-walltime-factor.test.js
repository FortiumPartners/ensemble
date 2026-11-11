'use strict';

/**
 * The explicit per-stratum target factor of `walltime compare` (kata js1p, plan docs/plans/pr-review-speed-plan-v2.md V2-5).
 * The committed baseline and the committed final cohort are the input, through the real CLI with each row's committed
 * trace on disk, and the default answer is pinned byte for byte to the committed `walltime-compare.json`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { compareWalltime, SPEEDUP_TARGET, MINIMUMS } = require('../lib/pr-review-walltime');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const GUIDES = path.resolve(__dirname, '../../..', 'docs', 'guides');
const FINAL = path.join(GUIDES, 'review-speedup-measurement-2026-11-10-final');
const BASELINE = JSON.parse(fs.readFileSync(path.join(GUIDES, 'review-walltime-baseline-2026-11-07.json'), 'utf8'));
const COHORT = JSON.parse(fs.readFileSync(path.join(FINAL, 'cohort-current.json'), 'utf8'));
const GOLDEN_TEXT = fs.readFileSync(path.join(FINAL, 'walltime-compare.json'), 'utf8');
const GOLDEN = JSON.parse(GOLDEN_TEXT);

let project;
beforeAll(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'walltime-factor-'));
  const traces = path.join(project, '.ensemble', 'state', 'toolchain');
  fs.mkdirSync(traces, { recursive: true });
  for (const run of COHORT.runs) fs.copyFileSync(path.join(FINAL, run.run_id, 'trace.jsonl'), path.join(traces, `trace-${run.run_id}.jsonl`));
});
afterAll(() => fs.rmSync(project, { recursive: true, force: true }));

function compare(extra = {}) {
  const result = spawnSync(process.execPath, [CLI, 'walltime'], {
    input: JSON.stringify({ action: 'compare', baseline: BASELINE, current: COHORT, cwd: project, ...extra }),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, out: result.status === 0 ? JSON.parse(result.stdout) : null };
}
const byId = (out, id) => out.strata.find((entry) => entry.id === id);

describe('the default is unchanged', () => {
  test('through the CLI the answer is byte-identical to the committed walltime-compare.json', () => {
    const { status, out } = compare();
    expect(status).toBe(0);
    expect(JSON.stringify(out, null, 1)).toBe(GOLDEN_TEXT);
    expect(out).toEqual(GOLDEN);
  });

  test('an explicit factor of 5, and an empty targetFactors, are the default (no marker, same bytes)', () => {
    expect(compare({ targetFactors: {} }).stdout).toBe(compare().stdout);
    expect(compare({ targetFactors: { 'high/first': 5, 'medium/first': 5 } }).stdout).toBe(compare().stdout);
  });

  test('the module answers the golden too, with every row passing its trace check', () => {
    const traceChecks = Object.fromEntries(COHORT.runs.map((run) => [run.id, { ok: true }]));
    expect(JSON.parse(JSON.stringify(compareWalltime({ baseline: BASELINE, current: COHORT, traceChecks })))).toEqual(GOLDEN);
  });

  test('the default carries no factor field anywhere: strata, payload or fiveX', () => {
    const { out } = compare();
    for (const entry of out.strata) expect(entry).not.toHaveProperty('targetFactor');
    expect(out).not.toHaveProperty('rebased');
    expect(out).not.toHaveProperty('targetFactors');
    expect(out.speedupTarget).toBe(SPEEDUP_TARGET);
  });
});

describe('a re-based factor is explicit, loud, and never the 5x', () => {
  test('factor 2 on high/first: the stratum is met (2.18x median, 2.22x p75), marked rebased, with its factor and target', () => {
    const { status, out } = compare({ targetFactors: { 'high/first': 2 } });
    expect(status).toBe(0);
    expect(byId(out, 'high/first')).toMatchObject({
      status: 'met', medianMet: true, p75Met: true, speedup: { median: 2.183, p75: 2.222 },
      targetFactor: 2, rebased: true, target: { medianMin: 27.5, p75Min: 41 }, reasons: [],
    });
    expect(out).toMatchObject({ speedupTarget: 5, rebased: true, targetFactors: { 'high/first': 2 } });
    expect(out.warnings).toEqual([expect.stringContaining('stratum-rebased: high/first is graded at target factor 2, not the 5x yardstick')]);
  });

  test('fiveX stays not-met, and its reason names the factor', () => {
    const { out } = compare({ targetFactors: { 'high/first': 2 } });
    expect(out.fiveX).toMatchObject({ claim: 'not-met', met: false });
    expect(out.fiveX.reasons[0]).toBe('high/first: evaluated at target factor 2, not the 5x yardstick (rebased); fiveX needs the 5x');
    expect(out.fiveX.reasons[1]).toBe('high/first: not met at 5x (median-above-target, p75-above-target)');
  });

  test('every other stratum, the counts, the carry and the minimums are what the default says', () => {
    const { out } = compare({ targetFactors: { 'high/first': 2 } });
    for (const id of ['medium/first', 'high/re-review']) expect(byId(out, id)).toEqual(byId(GOLDEN, id));
    expect(out.counts).toEqual(GOLDEN.counts);
    expect(out.carry).toEqual(GOLDEN.carry);
    expect(out.minimums).toEqual(MINIMUMS);
    expect(out.minimums).toEqual({ prsPerStratum: 3, wallMin: 1 });
  });

  test('a factor below what the data reach is not-met, and the target minutes follow the factor', () => {
    const { out } = compare({ targetFactors: { 'high/first': 3 } });
    expect(byId(out, 'high/first')).toMatchObject({ status: 'not-met', targetFactor: 3, rebased: true, reasons: ['median-above-target', 'p75-above-target'] });
    expect(byId(out, 'high/first').target).toEqual({ medianMin: 18.333, p75Min: 27.333 });
  });

  test('a thin stratum stays unknown at any factor (the minimum is not relaxed by a factor)', () => {
    const { out } = compare({ targetFactors: { 'medium/first': 1, 'high/re-review': 1 } });
    for (const id of ['medium/first', 'high/re-review']) {
      expect(byId(out, id)).toMatchObject({ status: 'unknown', rebased: true, targetFactor: 1 });
      expect(byId(out, id).reasons).toEqual(byId(GOLDEN, id).reasons);
    }
  });

  // Three PRs per stratum on each side, the current five times faster, and a real high re-review that carried verdicts.
  const fiveTimesFaster = (extraTier) => {
    const runs = (tier, round, wall, first) => [0, 1, 2].map((index) => ({
      id: `${tier}-${round}-${first + index}`, pr: first + index, tier, round, origin: 'real', wall_min: wall, chains: 1, gate_runs: 1, source: 'test',
    }));
    const strata = [['medium', 'first'], ['high', 'first'], ['high', 're-review'], ...(extraTier ? [['low', 'first']] : [])];
    const baseline = { schema: BASELINE.schema, runs: strata.flatMap(([tier, round], at) => runs(tier, round, 100, 1 + at * 10)) };
    const current = { schema: BASELINE.schema, runs: strata.flatMap(([tier, round], at) => runs(tier, round, 20, 100 + at * 10)) };
    const carried = current.runs.findIndex((run) => run.tier === 'high' && run.round === 're-review');
    current.runs[carried] = { ...current.runs[carried], carry: { carried: 2, head_sha: 'b'.repeat(40), from_heads: ['a'.repeat(40)] } };
    return { baseline, current };
  };

  test('fiveX cannot become met on a non-default factor, even when the cohort is five times faster and carries a re-review', () => {
    const input = fiveTimesFaster(false);
    expect(compareWalltime(input).fiveX).toMatchObject({ claim: 'met', met: true });
    expect(compareWalltime({ ...input, targetFactors: { 'high/first': 5 } }).fiveX).toMatchObject({ claim: 'met', met: true });
    for (const id of ['medium/first', 'high/first', 'high/re-review']) {
      const answer = compareWalltime({ ...input, targetFactors: { [id]: 2 } });
      expect(answer.fiveX).toMatchObject({ claim: 'not-met', met: false });
      expect(answer.fiveX.reasons[0]).toContain(`${id}: evaluated at target factor 2`);
      expect(answer.strata.find((entry) => entry.id === id)).toMatchObject({ status: 'met', rebased: true, targetFactor: 2 });
    }
  });

  test('a factor loosening a stratum the 5x would fail does not let fiveX through either', () => {
    const input = fiveTimesFaster(false);
    input.current.runs = input.current.runs.map((run) => (run.tier === 'high' && run.round === 'first' ? { ...run, wall_min: 40 } : run));
    const answer = compareWalltime({ ...input, targetFactors: { 'high/first': 2 } });
    expect(answer.strata.find((entry) => entry.id === 'high/first').status).toBe('met');
    expect(answer.fiveX).toMatchObject({ claim: 'not-met', met: false });
    expect(answer.fiveX.reasons).toContain('high/first: not met at 5x (median-above-target, p75-above-target)');
  });

  test('a re-based stratum that is not a required one does not touch fiveX, but is marked itself', () => {
    const input = fiveTimesFaster(true);
    const answer = compareWalltime({ ...input, targetFactors: { 'low/first': 2 } });
    expect(answer.fiveX).toEqual(compareWalltime(input).fiveX);
    expect(answer.fiveX.claim).toBe('met');
    expect(answer.strata.find((entry) => entry.id === 'low/first')).toMatchObject({ rebased: true, targetFactor: 2 });
    expect(answer.rebased).toBe(true);
  });
});

describe('an invalid factor is refused, never graded', () => {
  const refusal = (targetFactors) => {
    const { status, out } = compare({ targetFactors });
    expect(status).toBe(0);
    expect(out).toMatchObject({ ok: false, strata: [], fiveX: { claim: 'unknown', met: false } });
    return out.reason;
  };

  test.each([[0], [0.99], [-5], [null], ['2'], [true], [[2]], [{ x: 2 }]])('factor %j on a stratum is refused', (factor) => {
    expect(refusal({ 'high/first': factor })).toContain("targetFactors['high/first'] must be a finite number of at least 1");
  });

  test('NaN and Infinity (not JSON, so the module only) are refused', () => {
    for (const factor of [NaN, Infinity, -Infinity]) {
      const answer = compareWalltime({ baseline: BASELINE, current: COHORT, targetFactors: { 'high/first': factor } });
      expect(answer.ok).toBe(false);
      expect(answer.fiveX.met).toBe(false);
    }
  });

  test('a stratum that is not compared is refused, so a misspelt id cannot pass for a re-based result', () => {
    expect(refusal({ 'high/frist': 2 })).toContain("targetFactors names 'high/frist'");
  });

  test('targetFactors must be an object: the module refuses a list or text, the CLI refuses a non-object key', () => {
    expect(compareWalltime({ baseline: BASELINE, current: COHORT, targetFactors: [2] })).toMatchObject({ ok: false, reason: expect.stringContaining('targetFactors must be an object') });
    expect(compareWalltime({ baseline: BASELINE, current: COHORT, targetFactors: 2 })).toMatchObject({ ok: false });
    expect(compare({ targetFactors: 2 }).status).toBe(1);
  });

  test('one bad factor refuses the whole compare, whatever the good ones say', () => {
    expect(refusal({ 'high/first': 2, 'medium/first': 0 })).toContain("targetFactors['medium/first']");
  });

  test('a misspelt payload key is still an error', () => {
    expect(compare({ targetFactor: { 'high/first': 2 } }).status).toBe(1);
  });
});
