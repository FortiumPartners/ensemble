'use strict';

/**
 * Review wall time by tier, and the before/after compare (kata `vrda`, epic `ptqb`;
 * docs/plans/pr-review-speedup-plan.md section 5, second bullet: "Compare median and p75 wall time by tier, and the
 * number of gate runs and review chains per PR, before and after each PR above").
 *
 * NO side effects, NO shell, NO network, NO file reads. A pure function over a cohort DOCUMENT -- an object whose
 * `runs` array holds one row per review run -- in the shape of `docs/guides/review-walltime-baseline-<date>.json`.
 * The one thing that reads a trace from disk is `pr-review-cli.js walltime row`, through lib/pr-review-timing.js
 * (injectable deps); `rowFromTiming` here only turns its answer into a row.
 *
 * It is the sibling of `pr-review-metrics.js`, which compares a cohort of merged PRs by COUNT (approvals, rounds,
 * waits). This one compares WALL TIME. It reuses that module's `median` and nearest-rank `percentile`.
 *
 * THE UNIT. A row is one review run: one orchestrator task, from its first work to its verdict, on a PR of a tier
 * (`low` | `medium` | `high`, the effective tier `pr-review-cli tier` computed, never a guess) and a round
 * (`first` review of the PR, or a `re-review` after a push). Its `wall_min` is that task's wall time, as the plan's
 * section 1 table gives it and as `pr-review-cli timing` reports `wall`. `chains` counts the review chains the row
 * covers (a head change restarts the whole reviewer -> verifier -> verdict chain, so a run that went through two
 * heads is two chains) and `gate_runs` the local-CI gate runs. A PR's gate runs and review chains are the sums of its
 * rows; a stratum is one (tier, round) pair, the rows of the plan's section 2 target table.
 *
 * WHAT IS NEVER INVENTED. A figure that was not recorded is `null` WITH A REASON (`wall_min_reason`,
 * `gate_runs_reason`), never zero and never a guess; a run that never reached a verdict has no wall time. A row the
 * schema cannot read, a PR in two tiers or a run counted twice refuses the whole cohort -- there is no input for
 * which this module answers a comparison from data it could not read.
 *
 * THE MINIMUM. A stratum is compared only when BOTH sides have at least `MINIMUMS.prsPerStratum` distinct PRs with a
 * wall time in it. Fewer is `unknown`, never `met` (and never `not-met`: a verdict needs data). Three is the least
 * for which a median and a 75th percentile mean anything (the nearest-rank p75 of three runs is the slowest one);
 * it is a floor, not a significance test. There is no switch to lower it: lowering it is a change to this file.
 *
 * THE TARGET. "Finish a PR review in 20% of today's wall time (5x)": a stratum is `met` when the current median is at
 * most a fifth of the baseline median AND the current p75 at most a fifth of the baseline p75 (the tail must not hide
 * behind the median). Where the plan's own figure is ambiguous the baseline takes the SMALLER (harder) reading.
 *
 * AC3 -- THE 5x CLAIM. `compareWalltime().fiveX.claim` is `met` only when every required stratum (`REQUIRED_STRATA`,
 * the three rows of the plan's section 2) is `met` AND the current cohort holds a real HIGH-tier re-review, with a
 * wall time, in which verdicts were carried across heads: a row of the `high/re-review` stratum itself, the stratum
 * the claim is about (the `carry` child's work: plan section 5, "Do not claim the 5x target met until PR 4 has run
 * on a real re-review"). A carried re-review in another tier does not stand in for it. Anything short of that is
 * `unknown`, and one required stratum `not-met` is `not-met`.
 *
 * THE FLOOR. A real review that dispatches a model agent cannot finish in under `MINIMUMS.wallMin` minute. A row
 * below it is a typo, a unit slip (seconds for minutes) or a stand-in: it is listed under `excluded` with the reason
 * and never enters a median, a count or the carry evidence, so a row of a few milliseconds cannot read as a zero.
 *
 * TRUST MODEL -- WHAT A `met` RESTS ON. Nothing signs a row. `origin`, the wall time, the counts and the carry
 * evidence are what the row's writer states, and this pure module cannot check them. What it does: leave `stand-in`,
 * `fixture` and below-the-floor rows out of EVERY statistic and out of the carry evidence, bind the carry evidence to
 * the `high/re-review` stratum, and require it to name a count of carried verdicts and two different full object ids.
 * `compareWalltime({ baseline, current, traceChecks })` additionally withholds `met` unless every counted current row
 * of a required stratum has a passing check in `traceChecks` (`pr-review-cli.js walltime compare` builds it by
 * re-deriving the row's wall time, chains and gate runs from the trace its `run_id` names). What no trace holds stays
 * attested -- `origin`, the tier, and the carried-verdict evidence (a state report is an untracked file) -- and
 * `fiveX.attestation` and a `claim-met-attested` warning say so on every `met`. With no `traceChecks` the module
 * answers from the rows as written and says `tracesChecked: false`.
 *
 * HONEST LIMITS.
 *   - A stratum compares run times; it does not normalise for the size of the PRs in it.
 *   - The statistics are per RUN; the minimum counts distinct PRs. A PR with two runs in a stratum (a re-review whose
 *     second chain was a second run) adds two figures and counts once toward the three.
 *   - The baseline's wall figures are the plan's whole minutes, each from the plan's own interval (see the baseline
 *     file's provenance); this module does not recompute them.
 */

const { median, percentile } = require('./pr-review-metrics');
const { isObjectId } = require('./pr-review-scope');
const { STAGES } = require('./pr-review-timing');

const SCHEMA = 'review-walltime-cohort/1';
const TIERS = Object.freeze(['low', 'medium', 'high']);
const ROUNDS = Object.freeze(['first', 're-review']);
const ORIGINS = Object.freeze(['real', 'stand-in', 'fixture']);

/** The rows of the plan's section 2 target table: the strata the 5x claim is about. */
const REQUIRED_STRATA = Object.freeze(['medium/first', 'high/first', 'high/re-review']);

/** A stratum is compared only with this many distinct PRs, with a wall time, on each side; `wallMin` is the floor of THE FLOOR. */
const MINIMUMS = Object.freeze({ prsPerStratum: 3, wallMin: 1 });

/** 5x: the current figure may be at most a fifth of the baseline figure. */
const SPEEDUP_TARGET = 5;

/** What a printed `met` rests on, repeated in `fiveX.attestation` so the verdict never travels without it. */
const TRUST_STATEMENT =
  'origin and the carried-verdict evidence are what the rows state: nothing signs a row, and a state report is an untracked file. ' +
  'The wall time, chains and gate runs of a row can be re-derived from its trace (walltime compare does, from each row run_id), and a met needs that for every counted current row of a required stratum.';

/** Keys a row may carry. Anything else is refused, so a misspelt key is never read as an absent one. */
const ROW_KEYS = Object.freeze([
  'id', 'pr', 'tier', 'round', 'origin', 'wall_min', 'wall_min_reason', 'chains', 'gate_runs', 'gate_runs_reason',
  'source', 'notes', 'run_id', 'carry',
]);
const CARRY_KEYS = Object.freeze(['carried', 'head_sha', 'from_heads']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const round3 = (value) => Math.round(value * 1000) / 1000;

const stratumId = (tier, round) => `${tier}/${round}`;
const parseStratum = (id) => {
  const [tier, round] = id.split('/');
  return { tier, round };
};
const byStratum = (a, b) => {
  const left = parseStratum(a);
  const right = parseStratum(b);
  return TIERS.indexOf(left.tier) - TIERS.indexOf(right.tier) || ROUNDS.indexOf(left.round) - ROUNDS.indexOf(right.round);
};

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

/** Why one row cannot be read, as a list (empty when it can). `where` names the row in each message. */
function rowErrors(run, where) {
  if (!isObject(run)) return [`${where} is not an object`];
  const errors = [];
  for (const key of Object.keys(run)) {
    if (!ROW_KEYS.includes(key)) errors.push(`${where} has an unknown key '${key}'`);
  }
  if (!isText(run.id)) errors.push(`${where} needs a non-empty id`);
  if (!Number.isSafeInteger(run.pr) || run.pr <= 0) errors.push(`${where} needs pr to be a positive integer`);
  if (!TIERS.includes(run.tier)) errors.push(`${where} needs tier to be one of ${TIERS.join(', ')}`);
  if (!ROUNDS.includes(run.round)) errors.push(`${where} needs round to be one of ${ROUNDS.join(', ')}`);
  if (!ORIGINS.includes(run.origin)) errors.push(`${where} needs origin to be one of ${ORIGINS.join(', ')}`);
  if (!isText(run.source)) errors.push(`${where} needs a source: what the figures were taken from`);

  // wall_min: a positive number, or null with a reason -- never zero, never absent
  if (!hasOwn(run, 'wall_min')) {
    errors.push(`${where} needs wall_min (a number of minutes, or null with wall_min_reason)`);
  } else if (run.wall_min === null) {
    if (!isText(run.wall_min_reason)) errors.push(`${where} has wall_min null without a wall_min_reason`);
  } else if (typeof run.wall_min !== 'number' || !Number.isFinite(run.wall_min) || run.wall_min <= 0) {
    errors.push(`${where} needs wall_min to be a positive number of minutes or null`);
  } else if (hasOwn(run, 'wall_min_reason')) {
    errors.push(`${where} has wall_min_reason although wall_min is known`);
  }

  if (!Number.isSafeInteger(run.chains) || run.chains < 1) errors.push(`${where} needs chains to be an integer of at least 1`);

  // gate_runs: a count, or null with a reason
  if (!hasOwn(run, 'gate_runs')) {
    errors.push(`${where} needs gate_runs (a count, or null with gate_runs_reason)`);
  } else if (run.gate_runs === null) {
    if (!isText(run.gate_runs_reason)) errors.push(`${where} has gate_runs null without a gate_runs_reason`);
  } else if (!isCount(run.gate_runs)) {
    errors.push(`${where} needs gate_runs to be a non-negative integer or null`);
  } else if (hasOwn(run, 'gate_runs_reason')) {
    errors.push(`${where} has gate_runs_reason although gate_runs is known`);
  }

  if (hasOwn(run, 'notes') && !isText(run.notes)) errors.push(`${where} has notes that are not text`);
  if (hasOwn(run, 'run_id') && !isText(run.run_id)) errors.push(`${where} has a run_id that is not text`);
  if (hasOwn(run, 'carry')) errors.push(...carryErrors(run, where));
  return errors;
}

function carryErrors(run, where) {
  const { carry } = run;
  if (!isObject(carry)) return [`${where} has a carry that is not an object`];
  const errors = [];
  for (const key of Object.keys(carry)) {
    if (!CARRY_KEYS.includes(key)) errors.push(`${where} has an unknown carry key '${key}'`);
  }
  if (run.round !== 're-review') errors.push(`${where} carries verdicts but is not a re-review`);
  if (!isCount(carry.carried)) errors.push(`${where} needs carry.carried to be a non-negative integer`);
  if (!isObjectId(carry.head_sha)) errors.push(`${where} needs carry.head_sha to be a full object id`);
  if (!Array.isArray(carry.from_heads) || !carry.from_heads.every(isObjectId)) {
    errors.push(`${where} needs carry.from_heads to be a list of full object ids`);
  } else if (isCount(carry.carried)) {
    if (carry.carried > 0 && carry.from_heads.length === 0) errors.push(`${where} carried verdicts without naming the head they came from`);
    if (carry.carried === 0 && carry.from_heads.length > 0) errors.push(`${where} names heads it carried from but carried none`);
    if (isObjectId(carry.head_sha) && carry.from_heads.some((head) => head.toLowerCase() === carry.head_sha.toLowerCase())) {
      errors.push(`${where} carried verdicts from its own head: a carry crosses heads`);
    }
  }
  return errors;
}

/**
 * Reads a cohort document: its `runs` must all be readable rows, with unique ids and trace run ids, and no PR in two
 * tiers. Any problem refuses the whole cohort.
 *
 * @param {*} input  a cohort document: `{ runs: Row[], ...anything else a document carries }`
 * @param {string} [what]  how the document is named in a refusal
 * @returns {{ok: true, runs: Row[]}|{ok: false, reason: string, errors: string[]}}
 */
function validateCohort(input, what = 'cohort') {
  const refuse = (errors) => ({
    ok: false,
    reason: `${what} cannot be read: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? `; and ${errors.length - 5} more` : ''}`,
    errors,
  });
  if (!isObject(input)) return refuse([`${what} must be an object with a runs array`]);
  if (!Array.isArray(input.runs)) return refuse([`${what}.runs must be an array`]);
  if (input.schema !== SCHEMA) {
    return refuse([hasOwn(input, 'schema') ? `${what} has schema ${JSON.stringify(input.schema)}; this reader reads ${SCHEMA}` : `${what} has no schema key; this reader reads ${SCHEMA}`]);
  }

  const errors = [];
  const ids = new Map();
  const traces = new Map();
  const tiersByPr = new Map();
  input.runs.forEach((run, index) => {
    const where = isObject(run) && isText(run.id) ? `run '${run.id}'` : `runs[${index}]`;
    errors.push(...rowErrors(run, where));
    if (!isObject(run)) return;
    if (isText(run.id)) {
      if (ids.has(run.id)) errors.push(`run id '${run.id}' appears twice`);
      ids.set(run.id, true);
    }
    if (isText(run.run_id)) {
      if (traces.has(run.run_id)) errors.push(`trace run_id '${run.run_id}' is on runs '${traces.get(run.run_id)}' and '${run.id}': one trace is one run`);
      else traces.set(run.run_id, run.id);
    }
    if (Number.isSafeInteger(run.pr) && TIERS.includes(run.tier)) {
      if (tiersByPr.has(run.pr) && tiersByPr.get(run.pr) !== run.tier) {
        errors.push(`pr ${run.pr} is in two tiers (${tiersByPr.get(run.pr)} and ${run.tier}): one tier per PR`);
      } else {
        tiersByPr.set(run.pr, run.tier);
      }
    }
  });
  return errors.length > 0 ? refuse(errors) : { ok: true, runs: input.runs };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** A wall time under the floor: a typo, a unit slip or a stand-in, never a review (THE FLOOR). */
const belowFloor = (run) => run.wall_min !== null && run.wall_min < MINIMUMS.wallMin;

/** A row that counts anywhere: a real review whose wall time, when it has one, is not under the floor. Everything else is listed, never counted. */
const isCounted = (run) => run.origin === 'real' && !belowFloor(run);

/** A run that counts in a stratum's statistics: a counted row with a wall time. */
const isGraded = (run) => isCounted(run) && run.wall_min !== null;

function distribution(values) {
  return values.length === 0 ? { median: null, p75: null } : { median: round3(median(values)), p75: round3(percentile(values, 75)) };
}

/** Per-PR counts: how many PRs have a figure, how many do not, and their median, p75 and total. */
function countStats(values, withoutFigure) {
  return {
    prs: values.length,
    prsWithoutFigure: withoutFigure,
    total: values.reduce((sum, value) => sum + value, 0),
    ...distribution(values),
  };
}

function perPrOf(runs) {
  const byPr = new Map();
  for (const run of runs) {
    if (!byPr.has(run.pr)) byPr.set(run.pr, []);
    byPr.get(run.pr).push(run);
  }
  return [...byPr.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pr, rows]) => {
      const gateGaps = rows.filter((row) => row.gate_runs === null);
      const wallGaps = rows.filter((row) => row.wall_min === null);
      return {
        pr,
        tier: rows[0].tier,
        runs: rows.map((row) => row.id),
        reviewChains: rows.reduce((sum, row) => sum + row.chains, 0),
        gateRuns: gateGaps.length === 0 ? rows.reduce((sum, row) => sum + row.gate_runs, 0) : null,
        ...(gateGaps.length > 0 ? { gateRunsReason: `${gateGaps.length} of ${rows.length} runs without a gate run count (${gateGaps.map((row) => row.id).join(', ')})` } : {}),
        wallMinTotal: wallGaps.length === 0 ? round3(rows.reduce((sum, row) => sum + row.wall_min, 0)) : null,
        ...(wallGaps.length > 0 ? { wallMinTotalReason: `${wallGaps.length} of ${rows.length} runs without a wall time (${wallGaps.map((row) => row.id).join(', ')}): the PR's total is not stated` } : {}),
      };
    });
}

/**
 * The statistics of validated rows. `extraStrata` names strata to list even when empty (the compare lists the same
 * strata for both sides). Only `real` rows count; the rest are listed under `excluded`.
 */
function summarize(runs, extraStrata = []) {
  const real = runs.filter(isCounted);
  const excluded = runs
    .filter((run) => !isCounted(run))
    .map((run) => ({
      id: run.id,
      pr: run.pr,
      origin: run.origin,
      reason:
        run.origin !== 'real'
          ? `origin is ${run.origin}: listed here, never counted`
          : `wall_min ${run.wall_min} is under the ${MINIMUMS.wallMin} min a real review cannot beat: listed here, never counted`,
    }));

  const ids = new Set([...REQUIRED_STRATA, ...extraStrata, ...real.map((run) => stratumId(run.tier, run.round))]);
  const strata = [...ids].sort(byStratum).map((id) => {
    const { tier, round } = parseStratum(id);
    const inStratum = real.filter((run) => run.tier === tier && run.round === round);
    const graded = inStratum.filter(isGraded);
    const walls = graded.map((run) => run.wall_min);
    const entry = {
      id,
      tier,
      round,
      required: REQUIRED_STRATA.includes(id),
      runs: graded.length,
      prs: new Set(graded.map((run) => run.pr)).size,
      runsWithoutWall: inStratum.length - graded.length,
      medianMin: distribution(walls).median,
      p75Min: distribution(walls).p75,
      reason:
        inStratum.length === 0
          ? 'no run recorded for this tier and round'
          : graded.length === 0
            ? 'no run of this tier and round has a wall time'
            : null,
    };
    // The grade is judged on the unrounded figures; the rounded ones above are for display. Not enumerable: not in the output.
    Object.defineProperty(entry, 'raw', { value: walls.length === 0 ? { median: null, p75: null } : { median: median(walls), p75: percentile(walls, 75) } });
    return entry;
  });

  const perPr = perPrOf(real);
  const requiredTiers = REQUIRED_STRATA.map((id) => parseStratum(id).tier);
  const tiers = [...new Set([...requiredTiers, ...real.map((run) => run.tier)])]
    .sort((a, b) => TIERS.indexOf(a) - TIERS.indexOf(b))
    .map((tier) => {
      const own = perPr.filter((entry) => entry.tier === tier);
      const gates = own.filter((entry) => entry.gateRuns !== null).map((entry) => entry.gateRuns);
      return {
        tier,
        prs: own.length,
        gateRunsPerPr: countStats(gates, own.length - gates.length),
        reviewChainsPerPr: countStats(own.map((entry) => entry.reviewChains), 0),
      };
    });

  return { runCount: real.length, prCount: perPr.length, strata, tiers, perPr, excluded };
}

/**
 * The statistics of one cohort document: per stratum the runs, the distinct PRs, the median and the p75 wall time in
 * minutes; per tier the gate runs and review chains per PR; per PR its runs, chains, gate runs and total wall time.
 * Only rows with `origin: "real"` count. This is the `metrics` block of a committed baseline file.
 *
 * @param {{runs: Row[]}} input
 */
function computeWalltimeCohort(input) {
  const checked = validateCohort(input);
  if (!checked.ok) return { ok: false, reason: checked.reason, errors: checked.errors };
  return { ok: true, ...summarize(checked.runs) };
}

// ---------------------------------------------------------------------------
// Rows from a `timing` answer
// ---------------------------------------------------------------------------

/**
 * The carried verdicts a re-review's state report shows: the verdict records (`state.verdicts`) stamped with this head
 * whose `carriedFrom` is another head. The carry subcommand is the only producer of such records
 * (docs/guides/pr-review-carry.md), but a state report is an untracked file: this is evidence a person attests to,
 * not a proof.
 *
 * @param {{headSha: string, verdicts: Object[]}} input
 * @returns {{ok: true, carry: {carried: number, head_sha: string, from_heads: string[]}}|{ok: false, reason: string}}
 */
function carryEvidence(input) {
  if (!isObject(input)) return { ok: false, reason: 'carry evidence needs { headSha, verdicts }' };
  if (!isObjectId(input.headSha)) return { ok: false, reason: 'carry.headSha must be a full object id' };
  if (!Array.isArray(input.verdicts)) return { ok: false, reason: "carry.verdicts must be the state report's verdicts array" };
  const head = input.headSha.toLowerCase();
  const carried = input.verdicts.filter(
    (record) => isObject(record) && isObjectId(record.head) && record.head.toLowerCase() === head && isObjectId(record.carriedFrom) && record.carriedFrom.toLowerCase() !== head
  );
  const from = [...new Set(carried.map((record) => record.carriedFrom.toLowerCase()))].sort();
  return { ok: true, carry: { carried: carried.length, head_sha: head, from_heads: from } };
}

/**
 * One row from a `pr-review-cli timing` answer. The wall time is the answer's `wall` (the orchestrator window); a
 * `wall` it could not state is `null` with its reason. `chains` is the number of rounds the trace ran (a trace with
 * none is not a review and is refused); `gate_runs` is the number of `review.gate` spans (none recorded is `null`:
 * a stage nobody recorded is not zero runs).
 *
 * @param {{timing: Object, pr: number, tier: string, round: string, origin: string,
 *          id?: string, source?: string, notes?: string, carry?: {headSha: string, verdicts: Object[]}}} input
 * @returns {{ok: true, row: Object}|{ok: false, reason: string}}
 */
function rowFromTiming(input) {
  if (!isObject(input)) return { ok: false, reason: 'invalid-input' };
  const { timing } = input;
  if (!isObject(timing) || timing.ok !== true) {
    return { ok: false, reason: `timing must be a successful pr-review-cli timing answer${isObject(timing) && isText(timing.reason) ? ` (${timing.reason})` : ''}` };
  }
  const rounds = isObject(timing.criticalPath) && Array.isArray(timing.criticalPath.rounds) ? timing.criticalPath.rounds : [];
  if (rounds.length === 0) {
    return { ok: false, reason: 'the trace records no reviewer, verifier or verdict span, so it is not a review chain' };
  }

  const wall = isObject(timing.wall) ? timing.wall : { missing: true, reason: 'the timing answer has no wall' };
  const wallKnown = wall.missing === false && typeof wall.ms === 'number' && Number.isFinite(wall.ms) && wall.ms > 0;
  const gate = isObject(timing.stages) && isObject(timing.stages[STAGES.gate]) ? timing.stages[STAGES.gate] : { count: 0 };
  const gateRuns = isCount(gate.count) && gate.count > 0 ? gate.count : null;
  const runId = isText(timing.runId) ? timing.runId : undefined;

  const row = {
    id: isText(input.id) ? input.id : `pr${input.pr}-${input.round}${runId ? `-${runId}` : ''}`,
    pr: input.pr,
    tier: input.tier,
    round: input.round,
    origin: input.origin,
    wall_min: wallKnown ? round3(wall.ms / 60000) : null,
    ...(wallKnown ? {} : { wall_min_reason: isText(wall.reason) ? wall.reason : 'the timing answer states no usable wall time' }),
    chains: rounds.length,
    gate_runs: gateRuns,
    ...(gateRuns === null ? { gate_runs_reason: `no '${STAGES.gate}' span was recorded` } : {}),
    source: isText(input.source) ? input.source : `pr-review-cli timing${runId ? ` on run ${runId}` : ''}`,
    ...(isText(input.notes) ? { notes: input.notes } : {}),
    ...(runId ? { run_id: runId } : {}),
  };

  if (input.carry !== undefined) {
    const evidence = carryEvidence(input.carry);
    if (!evidence.ok) return { ok: false, reason: evidence.reason };
    row.carry = evidence.carry;
  }

  const errors = rowErrors(row, `row '${row.id}'`);
  return errors.length > 0 ? { ok: false, reason: errors.join('; ') } : { ok: true, row };
}

// ---------------------------------------------------------------------------
// The compare
// ---------------------------------------------------------------------------

function refused(reason) {
  return {
    ok: false,
    reason,
    minimums: MINIMUMS,
    speedupTarget: SPEEDUP_TARGET,
    strata: [],
    counts: [],
    perPr: { baseline: [], current: [] },
    carry: { present: false, evidence: [], reason },
    fiveX: { claim: 'unknown', met: false, required: REQUIRED_STRATA, reasons: [reason] },
    excluded: { baseline: [], current: [] },
    warnings: [],
  };
}

/** `current` is at most 1/SPEEDUP_TARGET of `baseline` (a hair of tolerance for decimal arithmetic). */
const meetsTarget = (current, baseline) => current * SPEEDUP_TARGET <= baseline + 1e-9;

function gradeStratum(baseline, current) {
  const reasons = [];
  if (baseline.prs < MINIMUMS.prsPerStratum) reasons.push(`baseline-too-few-prs: ${baseline.prs} of the ${MINIMUMS.prsPerStratum} needed`);
  if (current.prs < MINIMUMS.prsPerStratum) reasons.push(`current-too-few-prs: ${current.prs} of the ${MINIMUMS.prsPerStratum} needed`);
  const view = (side) => ({ runs: side.runs, prs: side.prs, runsWithoutWall: side.runsWithoutWall, medianMin: side.medianMin, p75Min: side.p75Min });
  const out = {
    id: baseline.id,
    tier: baseline.tier,
    round: baseline.round,
    required: baseline.required,
    baseline: view(baseline),
    current: view(current),
    target: baseline.medianMin === null ? null : { medianMin: round3(baseline.medianMin / SPEEDUP_TARGET), p75Min: round3(baseline.p75Min / SPEEDUP_TARGET) },
    status: 'unknown',
    medianMet: null,
    p75Met: null,
    speedup: null,
    reasons,
  };
  if (reasons.length > 0) return out;

  out.medianMet = meetsTarget(current.raw.median, baseline.raw.median);
  out.p75Met = meetsTarget(current.raw.p75, baseline.raw.p75);
  out.speedup = { median: round3(baseline.raw.median / current.raw.median), p75: round3(baseline.raw.p75 / current.raw.p75) };
  out.status = out.medianMet && out.p75Met ? 'met' : 'not-met';
  if (!out.medianMet) reasons.push('median-above-target');
  if (!out.p75Met) reasons.push('p75-above-target');
  return out;
}

/** The two per-PR counts of a tier, side by side. Reported, never graded: the plan sets no target for them. */
function compareCount(key, baseline, current) {
  const reasons = [];
  if (baseline[key].prs < MINIMUMS.prsPerStratum) reasons.push(`baseline-too-few-prs: ${baseline[key].prs} of the ${MINIMUMS.prsPerStratum} needed`);
  if (current[key].prs < MINIMUMS.prsPerStratum) reasons.push(`current-too-few-prs: ${current[key].prs} of the ${MINIMUMS.prsPerStratum} needed`);
  const compared = reasons.length === 0;
  return {
    status: compared ? 'compared' : 'unknown',
    baseline: baseline[key],
    current: current[key],
    change: compared ? { median: round3(current[key].median - baseline[key].median), p75: round3(current[key].p75 - baseline[key].p75) } : null,
    reasons,
  };
}

/** A real HIGH-tier re-review, with a plausible wall time, in which verdicts were carried across heads: a row of the stratum the 5x claim is about. */
const isCarryEvidence = (run) =>
  isCounted(run) && run.tier === 'high' && run.round === 're-review' && run.wall_min !== null && isObject(run.carry) && run.carry.carried >= 1;

/**
 * Compares a post-change cohort with the baseline, per (tier, round) stratum, and answers whether the 5x claim may be
 * made.
 *
 * @param {{baseline: {runs: Row[]}, current: {runs: Row[]}}} input  two cohort documents
 * @returns {{ok: boolean, reason?: string, minimums: Object, speedupTarget: number,
 *   strata: Array<{id, tier, round, required, baseline, current, target, status: 'met'|'not-met'|'unknown',
 *     medianMet: ?boolean, p75Met: ?boolean, speedup: ?Object, reasons: string[]}>,
 *   counts: Array<{tier: string, gateRunsPerPr: Object, reviewChainsPerPr: Object}>,
 *   perPr: {baseline: Object[], current: Object[]},
 *   carry: {present: boolean, evidence: Object[], reason: ?string},
 *   fiveX: {claim: 'met'|'not-met'|'unknown', met: boolean, required: string[], reasons: string[]},
 *   excluded: {baseline: Object[], current: Object[]}, warnings: string[]}}
 *   `fiveX.met` is true only when every required stratum is met AND the carry evidence is in the data.
 */
function compareWalltime(input) {
  if (!isObject(input)) return refused('invalid-input');
  if (input.traceChecks !== undefined && !isObject(input.traceChecks)) return refused('traceChecks must be an object of row id to { ok, reason }');
  const checked = {};
  for (const side of ['baseline', 'current']) {
    checked[side] = validateCohort(input[side], side);
    if (!checked[side].ok) return refused(checked[side].reason);
  }

  const ids = new Set(REQUIRED_STRATA);
  for (const side of ['baseline', 'current']) {
    for (const run of checked[side].runs) if (isCounted(run)) ids.add(stratumId(run.tier, run.round));
  }
  const baseline = summarize(checked.baseline.runs, [...ids]);
  const current = summarize(checked.current.runs, [...ids]);

  const strata = baseline.strata.map((entry, index) => gradeStratum(entry, current.strata[index]));
  const counts = baseline.tiers
    .concat(current.tiers.filter((entry) => !baseline.tiers.some((own) => own.tier === entry.tier)))
    .map((entry) => entry.tier)
    .sort((a, b) => TIERS.indexOf(a) - TIERS.indexOf(b))
    .map((tier) => {
      const emptyTier = { tier, prs: 0, gateRunsPerPr: countStats([], 0), reviewChainsPerPr: countStats([], 0) };
      const own = baseline.tiers.find((entry) => entry.tier === tier) || emptyTier;
      const now = current.tiers.find((entry) => entry.tier === tier) || emptyTier;
      return {
        tier,
        baselinePrs: own.prs,
        currentPrs: now.prs,
        gateRunsPerPr: compareCount('gateRunsPerPr', own, now),
        reviewChainsPerPr: compareCount('reviewChainsPerPr', own, now),
      };
    });

  const evidence = checked.current.runs
    .filter(isCarryEvidence)
    .map((run) => ({ id: run.id, pr: run.pr, carried: run.carry.carried, headSha: run.carry.head_sha, fromHeads: run.carry.from_heads }));
  const carry = {
    present: evidence.length > 0,
    evidence,
    reason: evidence.length > 0 ? null : 'no real high-tier re-review with carried verdicts and a wall time is in the current cohort',
  };

  const required = strata.filter((entry) => entry.required);
  // What a `met` rests on: every counted current row with a wall time in a required stratum, re-derived from its trace.
  const needed = checked.current.runs.filter((run) => isGraded(run) && REQUIRED_STRATA.includes(stratumId(run.tier, run.round)));
  const { traceChecks } = input;
  const passed = (run) => isObject(traceChecks[run.id]) && traceChecks[run.id].ok === true;
  const unchecked = traceChecks === undefined ? [] : needed.filter((run) => !passed(run));
  const reasons = [];
  let claim;
  if (required.some((entry) => entry.status === 'not-met')) {
    claim = 'not-met';
    for (const entry of required.filter((own) => own.status === 'not-met')) reasons.push(`${entry.id}: not met (${entry.reasons.join(', ')})`);
  } else {
    claim = required.every((entry) => entry.status === 'met') && carry.present && unchecked.length === 0 ? 'met' : 'unknown';
    if (claim === 'unknown') {
      for (const entry of required.filter((own) => own.status === 'unknown')) reasons.push(`${entry.id}: unknown (${entry.reasons.join(', ')})`);
      if (!carry.present) reasons.push(`carry: ${carry.reason}`);
      for (const run of unchecked) {
        const why = isObject(traceChecks[run.id]) && isText(traceChecks[run.id].reason) ? traceChecks[run.id].reason : 'no check was made for it';
        reasons.push(`trace: row '${run.id}' was not re-derived from its trace (${why})`);
      }
    }
  }

  const warnings = [];
  const onBaseline = new Set(baseline.perPr.map((entry) => entry.pr));
  const both = current.perPr.map((entry) => entry.pr).filter((pr) => onBaseline.has(pr));
  if (both.length > 0) warnings.push(`pr-on-both-sides: ${both.join(', ')} appear in the baseline and in the current cohort`);
  for (const entry of strata.filter((own) => !own.required && own.status === 'not-met')) {
    warnings.push(`stratum-not-met: ${entry.id} is not met (${entry.reasons.join(', ')}); it is not one of the required strata, so the claim does not depend on it`);
  }
  if (claim === 'met') {
    const how = traceChecks === undefined ? 'no row was checked against a trace' : `the wall time, chains and gate runs of ${needed.length} row(s) were re-derived from their traces`;
    warnings.push(`claim-met-attested: origin and the carried-verdict evidence are what the rows' writers state (nothing signs a row; a state report is an untracked file); ${how}`);
  }

  return {
    ok: true,
    minimums: MINIMUMS,
    speedupTarget: SPEEDUP_TARGET,
    strata,
    counts,
    perPr: { baseline: baseline.perPr, current: current.perPr },
    carry,
    fiveX: {
      claim,
      met: claim === 'met',
      required: REQUIRED_STRATA,
      reasons,
      attestation: { tracesChecked: traceChecks !== undefined, rowsWithoutTraceCheck: unchecked.map((run) => run.id), statement: TRUST_STATEMENT },
    },
    excluded: { baseline: baseline.excluded, current: current.excluded },
    warnings,
  };
}

module.exports = {
  SCHEMA,
  TIERS,
  ROUNDS,
  ORIGINS,
  REQUIRED_STRATA,
  MINIMUMS,
  SPEEDUP_TARGET,
  validateCohort,
  computeWalltimeCohort,
  carryEvidence,
  rowFromTiming,
  compareWalltime,
};
