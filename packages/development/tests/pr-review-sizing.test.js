'use strict';

/**
 * Slices and deadlines sized to what there is to read (kata sfpb, epic ptqb): `pr-review-sizing.js`, the three policy keys it
 * feeds (`sliceMaxFiles`, `sliceTargetLines`, `deadlineHeadroom`) and `reviewDeadlines`' `work`.
 *
 * The defect these pin: on the one real full-mode run (PR 271: 19 paths, 1450 changed lines, ONE slice) the security lane
 * needed 17m45s against a flat 15-minute deadline and one of the two reviewers listed 5 of the 19 paths, so the slice was
 * reported not reviewed. The runner failed closed, correctly; the plan it was given did not depend on how much there was to
 * read. Every number in the model is derived from that run's own record (OBSERVED), and these tests recompute them from it, so
 * a number typed over the derivation fails here.
 *
 * Fail closed, kept: a larger deadline never relaxes an expiry and a smaller slice never relaxes a path a reviewer did not
 * list. Those are pinned through the runner in pr-review-run.test.js; here the model, the keys and the deadline function.
 */

const fs = require('fs');
const path = require('path');

const sizing = require('../lib/pr-review-sizing');
const { DEFAULT_POLICY, loadPolicy, DEADLINE_MINUTES_MAX, DEFAULT_DEADLINE_MINUTES, KNOWN_KEYS } = require('../lib/pr-review-policy');
const { reviewDeadlines, floorOverrideMessage } = require('../lib/pr-review-results');
const { planSlices } = require('../lib/pr-review-depth');

const {
  OBSERVED,
  OBSERVED_HI_EFFORT,
  FLOOR_FACTOR,
  MIN_AGENT_MINUTES,
  MODEL,
  MINUTES_PER_FILE,
  MINUTES_PER_100_LINES,
  LANE_OVERRUN,
  REVIEWER_SPREAD,
  LANE_OVER_REVIEWER,
  DEFAULT_HEADROOM,
  HEADROOM_MIN,
  HEADROOM_MAX,
  SIZED_ROLES,
  isWork,
  isSliceMaxFiles,
  isSliceTargetLines,
  isDeadlineHeadroom,
  estimateMinutes,
  sizedMinutes,
  deriveLimits,
  resolveSizing,
} = sizing;

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const BASE_SHA = 'b'.repeat(40);

const agent = (name) => OBSERVED.agents.find((entry) => entry.name === name);
const minutesOf = (entry) => entry.elapsedMs / MIN;
const load = (policy) => loadPolicy({ baseSha: BASE_SHA, sourceSha: BASE_SHA, text: `\`\`\`ensemble-review-policy\n${JSON.stringify(policy)}\n\`\`\`\n` });

describe('the observation: what the one real full-mode run recorded', () => {
  test('it is the run of PR 271: 19 paths and 1450 changed lines in one slice, every agent on a 15-minute deadline', () => {
    expect(OBSERVED).toMatchObject({ run: 'real271', pr: 271, files: 19, changedLines: 1450, deadlineMinutes: 15 });
    expect(OBSERVED.agents.map((entry) => entry.name)).toEqual(['security-lane', 'reviewer-s1-a', 'reviewer-s1-b']);
  });

  test('the lane arrived 2m45s after its deadline (the kata title), the other reviewer inside it', () => {
    const lateBySeconds = (agent('security-lane').elapsedMs - OBSERVED.deadlineMinutes * MIN) / 1000;
    expect(Math.round(lateBySeconds)).toBe(2 * 60 + 45);
    expect(minutesOf(agent('reviewer-s1-a'))).toBeLessThan(OBSERVED.deadlineMinutes);
    expect(minutesOf(agent('reviewer-s1-b'))).toBeLessThan(OBSERVED.deadlineMinutes);
  });

  test('reviewer-s1-b listed 5 paths holding 318 lines and left 14 paths and 1132 lines; the other two read all 19', () => {
    const b = agent('reviewer-s1-b');
    expect([b.reachedFiles, b.reachedLines]).toEqual([5, 318]);
    expect([OBSERVED.files - b.reachedFiles, OBSERVED.changedLines - b.reachedLines]).toEqual([14, 1132]);
    for (const name of ['security-lane', 'reviewer-s1-a']) expect([agent(name).reachedFiles, agent(name).reachedLines]).toEqual([OBSERVED.files, OBSERVED.changedLines]);
  });

  test('the record is frozen: no caller can edit the observation the model stands on', () => {
    expect(Object.isFrozen(OBSERVED)).toBe(true);
    expect(Object.isFrozen(OBSERVED.agents)).toBe(true);
    expect(Object.isFrozen(OBSERVED.agents[0])).toBe(true);
  });
});

describe('the model is derived from the observation, not typed in', () => {
  const laneMinutes = minutesOf(agent('security-lane'));

  test('the rates are the slowest agent that read EVERY path, over its paths and over its lines', () => {
    expect(MINUTES_PER_FILE).toBeCloseTo(laneMinutes / OBSERVED.files, 12);
    expect(MINUTES_PER_100_LINES).toBeCloseTo(laneMinutes / (OBSERVED.changedLines / 100), 12);
    // about 0.93 minutes a path and 1.22 minutes per 100 changed lines
    expect(MODEL).toEqual({ minutesPerFile: 0.934, minutesPer100Lines: 1.224 });
  });

  test('the model reproduces the lane exactly on the run it was derived from, so a deadline of that size would have held it', () => {
    expect(estimateMinutes({ files: OBSERVED.files, lines: OBSERVED.changedLines })).toBeCloseTo(laneMinutes, 12);
    // and the old flat deadline is below it: the defect, stated as arithmetic
    expect(OBSERVED.deadlineMinutes).toBeLessThan(estimateMinutes({ files: OBSERVED.files, lines: OBSERVED.changedLines }));
  });

  test('the headroom is a stated JUDGEMENT (2), set above the two smaller ratios the run shows and below the third: the run holds no spread of one agent on identical work', () => {
    expect(LANE_OVERRUN).toBeCloseTo(laneMinutes / OBSERVED.deadlineMinutes, 12);
    expect(REVIEWER_SPREAD).toBeCloseTo(minutesOf(agent('reviewer-s1-a')) / minutesOf(agent('reviewer-s1-b')), 12);
    expect(LANE_OVER_REVIEWER).toBeCloseTo(laneMinutes / minutesOf(agent('reviewer-s1-a')), 12);
    expect([LANE_OVERRUN, REVIEWER_SPREAD, LANE_OVER_REVIEWER].map((ratio) => Math.round(ratio * 100) / 100)).toEqual([1.18, 1.7, 2.26]);
    expect(DEFAULT_HEADROOM).toBe(2);
    expect(DEFAULT_HEADROOM).toBeGreaterThanOrEqual(Math.max(LANE_OVERRUN, REVIEWER_SPREAD));
    expect(DEFAULT_HEADROOM).toBeLessThan(LANE_OVER_REVIEWER);
  });

  test('the two reviewers of one assignment did NOT do the same work, so their times are no spread: the faster one listed 5 of the 19 paths', () => {
    expect(agent('reviewer-s1-a').reachedFiles).toBe(OBSERVED.files);
    expect(agent('reviewer-s1-b').reachedFiles).toBeLessThan(agent('reviewer-s1-a').reachedFiles);
    expect(minutesOf(agent('reviewer-s1-b'))).toBeLessThan(minutesOf(agent('reviewer-s1-a')));
  });

  test('what the choice moves, stated in the docs: at 2.5 (the third ratio rounded up to a half) the limits are 6 paths and 490 lines and the lane is given 45 minutes', () => {
    expect(deriveLimits({ baseMinutes: 15, headroom: 2.5 })).toEqual({ maxFiles: 6, targetLines: 490 });
    expect(sizedMinutes({ base: 15, work: { files: OBSERVED.files, lines: OBSERVED.changedLines }, headroom: 2.5, maximum: 60 }).minutes).toBe(45);
  });

  test('the headroom lies inside the range a policy may set', () => {
    expect(isDeadlineHeadroom(DEFAULT_HEADROOM)).toBe(true);
    expect(HEADROOM_MIN).toBe(1);
    expect(HEADROOM_MAX).toBe(10);
  });

  test('only a reviewer and the security lane are sized: a verifier settles a claim, whatever the PR\'s size', () => {
    expect(SIZED_ROLES).toEqual(['reviewer', 'security']);
  });
});

describe('estimateMinutes: whichever of the per-file and per-line terms is larger', () => {
  test('many tiny files cost by the file, one long file by its length', () => {
    expect(estimateMinutes({ files: 30, lines: 30 })).toBeCloseTo(30 * MINUTES_PER_FILE, 12); // a read each, however short
    expect(estimateMinutes({ files: 1, lines: 3000 })).toBeCloseTo(30 * MINUTES_PER_100_LINES, 12); // 3000 lines, one file
  });

  test('nothing to read is no time, and the estimate only grows with the work', () => {
    expect(estimateMinutes({ files: 0, lines: 0 })).toBe(0);
    expect(estimateMinutes({ files: 9, lines: 100 })).toBeGreaterThan(estimateMinutes({ files: 8, lines: 100 }));
    expect(estimateMinutes({ files: 8, lines: 900 })).toBeGreaterThan(estimateMinutes({ files: 8, lines: 800 }));
  });
});

describe('sizedMinutes: the base is a floor, the maximum a ceiling, and a modelled need over it is said', () => {
  // floor: 0 isolates the size model; the fixed-cost floor has its own describe below
  const sized = (work, over = {}) => sizedMinutes({ base: 15, work, headroom: 2, maximum: 60, floor: 0, ...over });

  test('a small read keeps the base: the model never LOWERS a deadline', () => {
    expect(sized({ files: 3, lines: 33 })).toMatchObject({ minutes: 15, base: 15, raised: false, capped: false });
    expect(sized({ files: 0, lines: 0 }).minutes).toBe(15);
    expect(sized({ files: 3, lines: 33 }, { base: 40 }).minutes).toBe(40);
  });

  test('the lane of the real run: 36 minutes, which is 2x what it took and 21 more than it was given', () => {
    const lane = sized({ files: OBSERVED.files, lines: OBSERVED.changedLines });
    expect(lane).toMatchObject({ minutes: 36, modeled: 36, raised: true, capped: false });
    expect(lane.minutes).toBeGreaterThanOrEqual(minutesOf(agent('security-lane')) * DEFAULT_HEADROOM);
    expect(lane.minutes).toBeGreaterThan(OBSERVED.deadlineMinutes);
  });

  test('whole minutes, rounded UP: a deadline never rounds down into the need', () => {
    const answer = sized({ files: 1, lines: 700 }); // 7 x 1.224 x 2 = 17.14...
    expect(answer.estimate * answer.headroom).toBeGreaterThan(17);
    expect(answer.minutes).toBe(18);
    expect(Number.isInteger(answer.minutes)).toBe(true);
  });

  test('a need over the maximum is capped at it and SAID, never given silently as if it were enough', () => {
    const answer = sized({ files: 80, lines: 6000 });
    expect(answer.modeled).toBeGreaterThan(60);
    expect(answer).toMatchObject({ minutes: 60, capped: true, raised: true });
    expect(sized({ files: 32, lines: 2000 }).capped).toBe(false); // just inside
  });

  test('raised means the model made the deadline LONGER than the base: at a base already at the maximum it cannot', () => {
    expect(sized({ files: 80, lines: 6000 }, { base: 60 })).toMatchObject({ minutes: 60, raised: false, capped: true });
  });

  test('a bigger headroom asks for more minutes, a smaller one fewer', () => {
    const work = { files: OBSERVED.files, lines: OBSERVED.changedLines };
    expect(sized(work, { headroom: 3 }).minutes).toBe(54);
    expect(sized(work, { headroom: 1 }).minutes).toBe(18);
  });
});

describe('deriveLimits: the slice that just fits the base reviewer deadline, with its headroom', () => {
  test('at 15 minutes and 2x: 8 paths and 612 changed lines', () => {
    expect(deriveLimits({ baseMinutes: 15, headroom: DEFAULT_HEADROOM })).toEqual({ maxFiles: 8, targetLines: 612 });
  });

  test('the limits are TIGHT: a slice at them fits the base, one path or one line more does not', () => {
    const fits = (work) => sizedMinutes({ base: 15, work, headroom: DEFAULT_HEADROOM, maximum: 60 }).modeled <= 15;
    expect(fits({ files: 8, lines: 0 })).toBe(true);
    expect(fits({ files: 9, lines: 0 })).toBe(false);
    expect(fits({ files: 1, lines: 612 })).toBe(true);
    expect(fits({ files: 1, lines: 613 })).toBe(false);
    expect(fits({ files: 8, lines: 612 })).toBe(true);
  });

  test('a slice at the limits is one the slowest observed reader finishes in half the reviewer deadline', () => {
    const { maxFiles, targetLines } = deriveLimits({ baseMinutes: 15, headroom: DEFAULT_HEADROOM });
    expect(estimateMinutes({ files: maxFiles, lines: targetLines })).toBeLessThanOrEqual(15 / DEFAULT_HEADROOM);
  });

  test('the limits follow the base and the headroom, and are never below one', () => {
    expect(deriveLimits({ baseMinutes: 30, headroom: 2 })).toEqual({ maxFiles: 16, targetLines: 1225 });
    expect(deriveLimits({ baseMinutes: 15, headroom: 1 })).toEqual({ maxFiles: 16, targetLines: 1225 });
    expect(deriveLimits({ baseMinutes: 1, headroom: 10 })).toEqual({ maxFiles: 1, targetLines: 8 });
    expect(deriveLimits({ baseMinutes: 0, headroom: 10 })).toEqual({ maxFiles: 1, targetLines: 1 });
  });

  test('the policy defaults ARE these limits, derived from the policy\'s own reviewer default', () => {
    const limits = deriveLimits({ baseMinutes: DEFAULT_DEADLINE_MINUTES.reviewer, headroom: DEFAULT_HEADROOM });
    expect(DEFAULT_POLICY.sliceMaxFiles).toBe(limits.maxFiles);
    expect(DEFAULT_POLICY.sliceTargetLines).toBe(limits.targetLines);
    expect(DEFAULT_POLICY.deadlineHeadroom).toBe(DEFAULT_HEADROOM);
  });
});

describe('the validators and resolveSizing', () => {
  test.each([
    [isSliceMaxFiles, [1, 8, 1000], [0, -1, 1.5, '8', null, undefined, NaN, Infinity]],
    [isSliceTargetLines, [1, 612, 100000], [0, -3, 2.5, '612', null, undefined, NaN, Infinity]],
    [isDeadlineHeadroom, [1, 1.5, 2, 10], [0.99, 0, -1, 10.01, '2', null, undefined, NaN, Infinity]],
  ])('%p accepts a count in range and refuses anything else', (isValid, good, bad) => {
    for (const value of good) expect(isValid(value)).toBe(true);
    for (const value of bad) expect(isValid(value)).toBe(false);
  });

  test('work is whole non-negative files and lines', () => {
    expect(isWork({ files: 0, lines: 0 })).toBe(true);
    expect(isWork({ files: 19, lines: 1450 })).toBe(true);
    for (const bad of [null, undefined, [], 'x', {}, { files: 1 }, { lines: 1 }, { files: -1, lines: 0 }, { files: 1.5, lines: 0 }, { files: 1, lines: '3' }]) expect(isWork(bad)).toBe(false);
  });

  const defaults = { sliceMaxFiles: 8, sliceTargetLines: 612, deadlineHeadroom: 2 };

  test('a readable policy value is used, an absent one takes the default', () => {
    expect(resolveSizing({ sliceMaxFiles: 5, sliceTargetLines: 300, deadlineHeadroom: 3 }, defaults)).toEqual({ maxFiles: 5, targetLines: 300, headroom: 3, warnings: [] });
    expect(resolveSizing({ sliceMaxFiles: 5 }, defaults)).toEqual({ maxFiles: 5, targetLines: 612, headroom: 2, warnings: [] });
    expect(resolveSizing(null, defaults)).toEqual({ maxFiles: 8, targetLines: 612, headroom: 2, warnings: [] });
    expect(resolveSizing(undefined, defaults).maxFiles).toBe(8);
  });

  test('an unreadable value is NAMED and the default stands, never the unreadable value', () => {
    const resolved = resolveSizing({ sliceMaxFiles: 0, sliceTargetLines: 'many', deadlineHeadroom: 0.5 }, defaults);
    expect(resolved).toEqual({ maxFiles: 8, targetLines: 612, headroom: 2, warnings: ['invalid-sliceMaxFiles', 'invalid-sliceTargetLines', 'invalid-deadlineHeadroom'] });
  });
});

describe('the policy keys: validated by name, defaulted from the model', () => {
  test('the defaults are 8 paths, 612 changed lines and a headroom of 2', () => {
    expect(DEFAULT_POLICY).toMatchObject({ sliceMaxFiles: 8, sliceTargetLines: 612, deadlineHeadroom: 2 });
    expect(load({}).policy).toMatchObject({ sliceMaxFiles: 8, sliceTargetLines: 612, deadlineHeadroom: 2 });
  });

  test('the keys are known: setting one is not an unknown-key rejection', () => {
    for (const key of ['sliceMaxFiles', 'sliceTargetLines', 'deadlineHeadroom']) expect(KNOWN_KEYS).toContain(key);
    const result = load({ sliceMaxFiles: 5, sliceTargetLines: 300, deadlineHeadroom: 1.5 });
    expect(result.rejected).toEqual([]);
    expect(result.policy).toMatchObject({ sliceMaxFiles: 5, sliceTargetLines: 300, deadlineHeadroom: 1.5 });
  });

  test.each([
    ['sliceMaxFiles', [0, -1, 2.5, '8', null, true]],
    ['sliceTargetLines', [0, -1, 2.5, '600', null, []]],
    ['deadlineHeadroom', [0.5, 0, -2, 11, '2', null, {}]],
  ])('%s: a value outside its range or type is rejected BY NAME and the default applies', (key, values) => {
    for (const value of values) {
      const result = load({ [key]: value });
      expect(result.rejected.map((entry) => entry.key)).toEqual([key]);
      expect(result.policy[key]).toBe(DEFAULT_POLICY[key]);
    }
  });

  test('the base commit rule still holds: a block that is not the base commit\'s copy sets none of them', () => {
    const text = `\`\`\`ensemble-review-policy\n${JSON.stringify({ sourceSha: 'c'.repeat(40), sliceMaxFiles: 100 })}\n\`\`\`\n`;
    const result = loadPolicy({ text, baseSha: BASE_SHA, sourceSha: BASE_SHA });
    expect(result.ok).toBe(false);
    expect(result.policy.sliceMaxFiles).toBe(DEFAULT_POLICY.sliceMaxFiles);
  });
});

describe('reviewDeadlines with `work`: the base is a floor and the model raises it', () => {
  const ask = (role, work, extra = {}) => reviewDeadlines({ role, now: T0, work, ...extra });
  const REAL = { files: OBSERVED.files, lines: OBSERVED.changedLines };

  test('without work nothing changes: the base alone, from the default or the policy', () => {
    expect(reviewDeadlines({ role: 'security', now: T0 })).toMatchObject({ minutes: 15, source: 'default' });
    expect(reviewDeadlines({ role: 'security', now: T0 }).sizing).toBeUndefined();
    const { policy } = load({ deadlineMinutes: { security: 20 } });
    expect(reviewDeadlines({ role: 'security', now: T0, policy })).toMatchObject({ minutes: 20, source: 'policy' });
  });

  test('the lane of the real run is given 36 minutes, with the record of why', () => {
    const answer = ask('security', REAL);
    expect(answer).toMatchObject({ ok: true, minutes: 36, source: 'size', deadlineAt: T0 + 36 * MIN, budgetMs: 36 * MIN });
    expect(answer.sizing).toMatchObject({ files: 19, lines: 1450, baseMinutes: 15, headroom: 2, modeledMinutes: 36, raised: true, capped: false });
    expect(answer.sizing.estimateMinutes).toBeCloseTo(minutesOf(agent('security-lane')), 6);
    expect(answer.warnings).toEqual([]);
  });

  test('the deadline covers what the lane took on that run with the stated headroom, and the old default did not', () => {
    const lane = ask('security', REAL);
    expect(lane.budgetMs).toBeGreaterThanOrEqual(agent('security-lane').elapsedMs * DEFAULT_HEADROOM);
    expect(reviewDeadlines({ role: 'security', now: T0 }).budgetMs).toBeLessThan(agent('security-lane').elapsedMs);
  });

  test('a reviewer on a slice that fits keeps the base, and one on a slice that does not is given longer', () => {
    expect(ask('reviewer', { files: 8, lines: 556 })).toMatchObject({ minutes: MIN_AGENT_MINUTES, source: 'size' });
    expect(ask('reviewer', { files: 8, lines: 556 }).sizing).toMatchObject({ raised: true, floored: true, floorMinutes: MIN_AGENT_MINUTES });
    expect(ask('reviewer', { files: 19, lines: 1450 })).toMatchObject({ minutes: 36, source: 'size' });
  });

  test('a policy base is a floor too: it is never lowered, and a larger need still raises it', () => {
    const { policy } = load({ deadlineMinutes: { reviewer: 45, security: 5 } });
    expect(ask('reviewer', REAL, { policy })).toMatchObject({ minutes: 45, source: 'policy' });
    expect(ask('security', REAL, { policy })).toMatchObject({ minutes: 36, source: 'size' });
    // a policy base below the measured floor is not honoured: the floor holds (kata d9sy)
    expect(ask('security', { files: 1, lines: 1 }, { policy })).toMatchObject({ minutes: MIN_AGENT_MINUTES, source: 'size' });
  });

  test('the policy headroom scales the modelled need', () => {
    expect(ask('security', REAL, { policy: load({ deadlineHeadroom: 3 }).policy }).minutes).toBe(54);
    expect(ask('security', REAL, { policy: load({ deadlineHeadroom: 1 }).policy }).minutes).toBe(MIN_AGENT_MINUTES); // 18 modelled, the floor is 22
  });

  test('an unreadable headroom in a hand-handed policy is NAMED and the default applies', () => {
    const answer = ask('security', REAL, { policy: { deadlineHeadroom: 0.2 } });
    expect(answer.minutes).toBe(36);
    expect(answer.warnings.join(' ')).toMatch(/deadlineHeadroom is out of range/);
  });

  test('a need over the 60-minute maximum is capped, SAID in the warnings and flagged in the record', () => {
    const answer = ask('security', { files: 40, lines: 4000 });
    expect(answer).toMatchObject({ ok: true, minutes: 60, source: 'size', budgetMs: 60 * MIN });
    expect(answer.sizing).toMatchObject({ capped: true, raised: true });
    expect(answer.sizing.modeledMinutes).toBeGreaterThan(DEADLINE_MINUTES_MAX);
    expect(answer.warnings.join(' ')).toMatch(/over the 60-minute maximum/);
  });

  test('a verifier is not sized: work is ignored for it, and the answer says so', () => {
    const answer = ask('verifier', REAL);
    expect(answer).toMatchObject({ ok: true, minutes: 5, source: 'default' });
    expect(answer.sizing).toBeUndefined();
    expect(answer.warnings.join(' ')).toMatch(/does not change a verifier/);
  });

  test.each([
    [{ files: -1, lines: 0 }],
    [{ files: 1.5, lines: 0 }],
    [{ files: 1 }],
    ['19 files'],
    [null],
    [[]],
  ])('work %j is refused with a named reason, not guessed at', (work) => {
    const answer = ask('reviewer', work);
    expect(answer).toMatchObject({ ok: false, deadlineAt: null });
    expect(answer.reason).toMatch(/work must be/);
  });

  test('tier and depth are still validated and echoed, and still do not change the budget', () => {
    const answer = ask('security', REAL, { tier: 'high', depth: 'deep' });
    expect(answer).toMatchObject({ tier: 'high', depth: 'deep', minutes: 36 });
    expect(ask('security', REAL, { tier: 'low', depth: 'quick' }).minutes).toBe(36);
  });
});

describe('the defect on the real run, and the plan that fixes it', () => {
  // the 19 paths of PR 271 in path order, with the changed lines each had (added + deleted), from that run's own numstat
  const PATHS = [
    ['CHANGELOG.md', 1],
    ['docs/guides/pr-review-run.md', 127],
    ['packages/development/CHANGELOG.md', 1],
    ['packages/development/lib/pr-review-full.js', 159],
    ['packages/development/lib/pr-review-run-support.js', 1],
    ['packages/development/lib/pr-review-run.js', 145],
    ['packages/development/lib/review-run-cli.js', 12],
    ['packages/development/skills/pr-review-cycle/SKILL.md', 8],
    ['packages/development/skills/pr-review-cycle/reference/review-run.md', 76],
    ['packages/development/tests/pr-review-full.test.js', 125],
    ['packages/development/tests/pr-review-run.test.js', 355],
    ['packages/development/tests/review-run-cli.test.js', 38],
    ['packages/full/lib/pr-review-full.js', 1],
    ['packages/pi/skills/pr-review-cycle/SKILL.md', 8],
    ['packages/pi/skills/pr-review-cycle/reference/review-run.md', 76],
    ['packages/pi/vendor/lib/pr-review-full.js', 159],
    ['packages/pi/vendor/lib/pr-review-run-support.js', 1],
    ['packages/pi/vendor/lib/pr-review-run.js', 145],
    ['packages/pi/vendor/lib/review-run-cli.js', 12],
  ].map(([path, lines]) => ({ path, lines }));

  const plan = (over = {}) => planSlices({ paths: PATHS, threshold: 1500, mode: 'deep', lensesPerSlice: 2, targetLines: DEFAULT_POLICY.sliceTargetLines, maxFiles: DEFAULT_POLICY.sliceMaxFiles, maxSlices: 3, ...over });

  test('the fixture is the real run\'s shape: 19 paths, 1450 changed lines, under the 1500 threshold', () => {
    expect(PATHS).toHaveLength(OBSERVED.files);
    expect(PATHS.reduce((sum, entry) => sum + entry.lines, 0)).toBe(OBSERVED.changedLines);
  });

  test('before: no slice smaller than the PR (the runner passed no size limit) and a flat 15 minutes', () => {
    const before = planSlices({ paths: PATHS, threshold: 1500, mode: 'deep', lensesPerSlice: 2 });
    expect(before.slices).toHaveLength(1);
    expect(before.slices[0].paths).toHaveLength(19);
  });

  test('after: three slices, each inside both limits, every path in exactly one', () => {
    const after = plan();
    expect(after.slices.map((slice) => [slice.paths.length, slice.lines])).toEqual([[8, 454], [3, 556], [8, 440]]);
    for (const slice of after.slices) {
      expect(slice.paths.length).toBeLessThanOrEqual(DEFAULT_POLICY.sliceMaxFiles);
      expect(slice.lines).toBeLessThanOrEqual(DEFAULT_POLICY.sliceTargetLines);
    }
    expect(after.slices.flatMap((slice) => slice.paths).sort()).toEqual(PATHS.map((entry) => entry.path).sort());
  });

  test('a reviewer can reach every path of its slice: the modelled time with headroom fits the deadline it is given', () => {
    for (const slice of plan().slices) {
      const answer = reviewDeadlines({ role: 'reviewer', now: T0, work: { files: slice.paths.length, lines: slice.lines } });
      expect(answer.sizing.modeledMinutes).toBeLessThanOrEqual(answer.minutes);
      expect(answer.minutes).toBe(MIN_AGENT_MINUTES);
      // the slowest observed reader (a path in 0.93 minutes) finishes the slice's paths inside HALF that
      expect(slice.paths.length * MINUTES_PER_FILE).toBeLessThanOrEqual(answer.minutes / DEFAULT_HEADROOM + 1e-9);
    }
  });

  test('the lane is given 36 minutes: 2x what it needed, where the flat 15 expired it', () => {
    const lane = reviewDeadlines({ role: 'security', now: T0, work: { files: OBSERVED.files, lines: OBSERVED.changedLines } });
    expect(lane.minutes).toBe(36);
    expect(lane.minutes * MIN).toBeGreaterThanOrEqual(agent('security-lane').elapsedMs * DEFAULT_HEADROOM);
    expect(15 * MIN).toBeLessThan(agent('security-lane').elapsedMs);
  });

  test('the three slices and the lane are seven agents: the whole review round fits one wave at the default cap of 8', () => {
    expect(plan().reviewerAssignments.length + 1).toBe(7);
    expect(DEFAULT_POLICY.maxConcurrentAgents).toBe(8);
  });
});

describe('the docs state the numbers the code derives: a number that drifts fails here (the way AC8 pins the deadline docs)', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8').replace(/\s+/g, ' ');
  const guide = read('docs', 'guides', 'pr-review-run.md');
  const reference = read('packages', 'development', 'skills', 'pr-review-cycle', 'reference', 'review-run.md');
  const userGuide = fs.readFileSync(path.join(repoRoot, 'docs', 'guides', 'user-guide.md'), 'utf8');
  const changelog = read('CHANGELOG.md');
  const row = (key) => userGuide.split('\n').find((line) => line.startsWith(`| \`${key}\` |`));

  test('every policy key has a row in the user guide that ends with its default', () => {
    expect(row('sliceMaxFiles')).toMatch(new RegExp(`\\| \`${DEFAULT_POLICY.sliceMaxFiles}\` \\|$`));
    expect(row('sliceTargetLines')).toMatch(new RegExp(`\\| \`${DEFAULT_POLICY.sliceTargetLines}\` \\|$`));
    expect(row('deadlineHeadroom')).toMatch(new RegExp(`\\| \`${DEFAULT_POLICY.deadlineHeadroom}\` \\|$`));
  });

  test('the deadlineMinutes row says it is a BASE and a floor, and keeps what AC8 pins about the subcommand', () => {
    expect(row('deadlineMinutes')).toMatch(/\*\*base\*\*/);
    expect(row('deadlineMinutes')).toMatch(/floor and not a pin/);
    expect(row('deadlineMinutes')).toMatch(/no skill or command calls the subcommand yet/);
  });

  test('the maxConcurrentAgents row says the runner reads it for the slices and still that it is not enforced', () => {
    expect(row('maxConcurrentAgents')).toMatch(/one wave/);
    expect(row('maxConcurrentAgents')).toMatch(/not enforced yet/);
  });

  test.each([['the guide', guide], ['the reference', reference]])('%s states the rates, the headroom, the limits and the real run\'s plan', (_name, text) => {
    expect(text).toContain(String(MODEL.minutesPerFile));
    expect(text).toContain(String(MODEL.minutesPer100Lines));
    // the default sits beside the key, in a table cell or in brackets
    expect(text).toMatch(new RegExp(`\`sliceMaxFiles\`[^0-9]{1,6}${DEFAULT_POLICY.sliceMaxFiles}\\b`));
    expect(text).toMatch(new RegExp(`\`sliceTargetLines\`[^0-9]{1,6}${DEFAULT_POLICY.sliceTargetLines}\\b`));
    expect(text).toContain('three slices of 8, 3 and 8 paths');
    expect(text).toContain('36');
  });

  test('the guide gives the derivation of every number from the observation', () => {
    expect(guide).toContain('17.75 min for 19 paths and 1450 lines, on a 15 min deadline');
    expect(guide).toContain('4.62 min, listed 5 paths (318 lines), left 14 (1132 lines)');
    expect(guide).toContain(`floor(15 / (2 x ${MODEL.minutesPerFile}))`);
    expect(guide).toContain(`floor(15 / (2 x ${MODEL.minutesPer100Lines} / 100))`);
    expect(guide).toContain('1.18');
    expect(guide).toContain('1.70');
    expect(guide).toContain('2.26');
    expect(guide).toMatch(/a judgement, not a measurement/);
  });

  test('the sfpb defect is no longer listed as unfixed anywhere the docs list defects', () => {
    expect(guide).not.toContain('None is fixed in this change');
    expect(guide).toMatch(/The 15-minute deadline \(kata `sfpb`\) is addressed by a size model[^;]*; the first live measurements \(effort `hi`, kata `q3a9`\) found its flat floor too tight for a SMALL slice/);
    expect(guide).not.toMatch(/is fixed by the size model/);
    expect(reference).not.toContain('are NOT fixed here and are tracked on their own: (a)');
    expect(reference).toMatch(/One is NOT fixed here and is tracked on its own: `review-run-cli\.js` `peekRun`/);
  });

  test('REVIEW.md\'s policy table says what the runner does with sliceThreshold and lists the three new keys and the base deadline', () => {
    const rows = fs.readFileSync(path.join(repoRoot, 'REVIEW.md'), 'utf8').split('\n').filter((line) => line.startsWith('| `'));
    const rowOf = (key) => rows.find((line) => line.startsWith(`| \`${key}\` |`));
    expect(rowOf('sliceThreshold')).toMatch(/does not use it to decide whether to slice/);
    expect(rowOf('sliceMaxFiles')).toContain(`default ${DEFAULT_POLICY.sliceMaxFiles}`);
    expect(rowOf('sliceTargetLines')).toContain(`default ${DEFAULT_POLICY.sliceTargetLines}`);
    expect(rowOf('deadlineHeadroom')).toContain(`default ${DEFAULT_POLICY.deadlineHeadroom}`);
    expect(rowOf('deadlineMinutes')).toMatch(/base/);
  });

  test('the guide and the reference state the cross-slice limit and what the answers now carry', () => {
    for (const text of [guide, reference]) {
      expect(text).toContain('cross-slice');
      expect(text).toContain('rangeDiff');
    }
    expect(guide).toMatch(/no `TRIAGE`/);
    expect(guide).toMatch(/not run end to end here/);
  });

  test('the guide, the reference, the user guide and the CHANGELOG state the whole-range reader of a light run cut into several slices, the cap arithmetic, what it is graded on and what it cannot do (review of PR 274, rounds 2 and 3)', () => {
    for (const text of [guide, reference]) {
      expect(text).toContain('reviewer-range');
      expect(text).toContain('whole-range');
      expect(text).toMatch(/one pass[^.]{0,40}one lens/);
      // the slices come first; the reader is added only when the cap holds it beside them, and the plan says when it does not
      expect(text).toContain('floor((maxConcurrentAgents - lane) / lenses per slice)');
      expect(text).toContain('slices x lenses + lane + 1 <= maxConcurrentAgents');
      expect(text).toContain('reader-not-planned');
      expect(text).toContain('range-reviewer-brief.md');
    }
    expect(guide).toMatch(/the plan does not warn about it/);
    expect(guide).toMatch(/A slice that fits the limits is never given up for it/);
    expect(guide).toContain('| 8 (the default) | 3, within the limits | yes | 8 |');
    expect(guide).toContain('| 7 | 3, within the limits | no (`reader-not-planned`) | 7 |');
    expect(guide).toContain('| 5 | 2 (`slice-over-limit`) | no (`reader-not-planned`) | 5 |');
    expect(guide).toMatch(/36 minutes for the real PR/);
    expect(guide).toMatch(/no second independent reader of the whole diff/);
    expect(guide).toMatch(/`paths-not-reviewed`/);
    expect(guide).toMatch(/`deadlineHeadroom` changes the deadlines only/);
    expect(row('maxConcurrentAgents')).toMatch(/whole-range reader/);
    expect(row('maxConcurrentAgents')).toContain('floor((cap - lane) / lenses per slice)');
    expect(row('deadlineMinutes')).toMatch(/only when its payload carries `work`/);
    const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'));
    expect(unreleased).toMatch(/gets one whole-range reader when the cap holds it \(kata `sfpb`, review rounds 2 and 3/);
    expect(unreleased).toContain('reader-not-planned');
  });

  test('the CHANGELOG has the sizing entry in Unreleased, among the first entries (the newer ones named), and it says the model is one run and nothing is relaxed', () => {
    // the newest entry goes at the top of the list (kata k48x), so this entry is found by its own opening words, and its place is pinned relative to the newer ones
    const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'));
    const start = unreleased.search(/- \*\*packages\/development:\*\* `review-run` sizes its slices and deadlines to what there is to read \(kata `sfpb`/);
    expect(start).toBeGreaterThanOrEqual(0);
    // the text collapses whitespace: entries are told apart by their prefix; an entry filed far from the top is a misplaced one
    const newer = unreleased.slice(0, start).split('- **packages/development:**').slice(1);
    expect(newer.length).toBeLessThanOrEqual(8);
    // the entries known to sit above it: the re-review delta (kata xb4j) is the first, the small-slice deadlines (katas d9sy and 630v) the next
    expect(newer[0]).toMatch(/^ review-run re-review plans a delta/);
    expect(newer[1]).toMatch(/^ `review-run` gives a small slice the time the first live runs showed it needs.*\(kata `d9sy` and `630v`/);
    const first = unreleased.slice(start);
    // the entry ends where the next bullet starts (the file is read with whitespace collapsed, so a bullet is ' - ' + a bold or code opener)
    const next = first.slice(10).search(/ - (?:\*\*|`)/);
    expect(next).toBeGreaterThan(0);
    const entry = first.slice(0, next + 10);
    expect(entry).toMatch(/Nothing is relaxed/);
    expect(entry).toMatch(/one observed run/);
  });
});

describe('the fixed cost of an agent: a small slice is not given a deadline its own size says (kata d9sy)', () => {
  const SMALL_4_PATHS = { files: 4, lines: 280 }; // the slice whose reviewer did not arrive inside 15 minutes (run pr277-first-q3a9)
  const slowestFinished = Math.max(...OBSERVED_HI_EFFORT.finishedReviewerMinutes);
  const REAL = { files: OBSERVED.files, lines: OBSERVED.changedLines };
  const ask = (role, work, extra = {}) => reviewDeadlines({ role, now: T0, work, ...extra });

  test('the defect: the old model gave the 4-path, 280-line slice 15 minutes, and a reviewer measured at 12.8, 14.6 and >15 needed them all', () => {
    const answer = reviewDeadlines({ role: 'reviewer', now: T0, work: SMALL_4_PATHS });
    expect(answer.sizing.modeledMinutes).toBe(8); // the model alone: 2 x 3.7 minutes, so the base of 15 decided
    expect(answer.minutes).toBe(MIN_AGENT_MINUTES);
    expect(answer.minutes).toBeGreaterThan(Math.max(...OBSERVED_HI_EFFORT.expiredReviewerMinutes) + 5);
    expect(answer.sizing).toMatchObject({ floored: true, floorMinutes: MIN_AGENT_MINUTES, raised: true });
    expect(answer.source).toBe('size');
  });

  test('the floor is derived from the measured reviewers, not typed: the slowest finished one times FLOOR_FACTOR, rounded up', () => {
    expect(slowestFinished).toBe(14.58);
    expect(MIN_AGENT_MINUTES).toBe(Math.ceil(slowestFinished * FLOOR_FACTOR));
    expect(MIN_AGENT_MINUTES).toBe(22);
    expect(FLOOR_FACTOR).toBeGreaterThanOrEqual(1.5);
    for (const minutes of OBSERVED_HI_EFFORT.finishedReviewerMinutes) expect(MIN_AGENT_MINUTES).toBeGreaterThan(minutes);
    // every measured reviewer of a small slice, finished or not, was inside the slice limits: size does not explain the spread
    expect(Math.max(...OBSERVED_HI_EFFORT.finishedReviewerMinutes)).toBeGreaterThan(2 * Math.min(...OBSERVED_HI_EFFORT.finishedReviewerMinutes));
  });

  test('the floor binds the sized roles and nothing else: a verifier keeps its 5 minutes and a large read keeps its modelled deadline', () => {
    expect(reviewDeadlines({ role: 'verifier', now: T0, work: SMALL_4_PATHS }).minutes).toBe(DEFAULT_DEADLINE_MINUTES.verifier);
    expect(reviewDeadlines({ role: 'verifier', now: T0 }).minutes).toBe(DEFAULT_DEADLINE_MINUTES.verifier);
    expect(reviewDeadlines({ role: 'security', now: T0, work: SMALL_4_PATHS }).minutes).toBe(MIN_AGENT_MINUTES);
    expect(ask('security', REAL).minutes).toBe(36); // the model's own deadline is above the floor: unchanged
    expect(reviewDeadlines({ role: 'reviewer', now: T0 }).minutes).toBe(DEFAULT_DEADLINE_MINUTES.reviewer); // no work: the base alone, as ever
  });

  test('a policy base above the floor is kept, one below it is raised to it, and the 60-minute maximum still caps', () => {
    expect(ask('reviewer', SMALL_4_PATHS, { policy: load({ deadlineMinutes: { reviewer: 40 } }).policy })).toMatchObject({ minutes: 40, source: 'policy' });
    expect(ask('reviewer', SMALL_4_PATHS, { policy: load({ deadlineMinutes: { reviewer: 10 } }).policy }).minutes).toBe(MIN_AGENT_MINUTES);
    expect(sizing.sizedMinutes({ base: 15, work: SMALL_4_PATHS, headroom: 2, maximum: 20 }).minutes).toBe(20);
  });

  test('a policy base the floor overrides is NAMED, with the policy value and the floor, and recorded; the default and a larger value are not (independent review round 1)', () => {
    const over = ask('reviewer', SMALL_4_PATHS, { policy: load({ deadlineMinutes: { reviewer: 10 } }).policy });
    expect(over.minutes).toBe(MIN_AGENT_MINUTES);
    expect(over.sizing).toMatchObject({ floored: true, floorMinutes: MIN_AGENT_MINUTES, overridesPolicy: true });
    expect(over.warnings).toEqual([`policy deadlineMinutes.reviewer (10) is below the ${MIN_AGENT_MINUTES}-minute fixed-cost floor of a reviewer or security agent (kata d9sy); the deadline is ${MIN_AGENT_MINUTES} minutes`]);
    expect(ask('security', SMALL_4_PATHS, { policy: load({ deadlineMinutes: { security: 3 } }).policy }).warnings.join()).toContain('deadlineMinutes.security (3)');
    // the default (a loaded policy holds every key, so 15 cannot be told from unset) and values at or above the floor say nothing
    for (const policy of [load({}).policy, load({ deadlineMinutes: { reviewer: MIN_AGENT_MINUTES } }).policy, load({ deadlineMinutes: { reviewer: 40 } }).policy]) {
      const quiet = ask('reviewer', SMALL_4_PATHS, { policy });
      expect(quiet.warnings).toEqual([]);
      expect(quiet.sizing.overridesPolicy).toBe(false);
    }
    // work that needs more than the floor is the model's doing, not the floor's: nothing to name
    expect(ask('security', REAL, { policy: load({ deadlineMinutes: { security: 5 } }).policy }).warnings).toEqual([]);
  });

  test('F2 (second independent review): a policy value the policy SET is named whatever it equals, 15 included; an unset one is raised without a warning, and the sizing records what the policy set', () => {
    const set15 = load({ deadlineMinutes: { reviewer: 15 } });
    expect(set15.explicit).toEqual({ deadlineMinutes: { reviewer: 15 } });
    const named = ask('reviewer', SMALL_4_PATHS, { policy: set15.policy, explicit: set15.explicit });
    expect(named.minutes).toBe(MIN_AGENT_MINUTES);
    expect(named.sizing).toMatchObject({ floored: true, policyMinutes: 15, overridesPolicy: true });
    expect(named.warnings).toEqual([floorOverrideMessage({ role: 'reviewer', policyMinutes: 15, floorMinutes: MIN_AGENT_MINUTES })]);
    expect(named.warnings[0]).toContain('deadlineMinutes.reviewer (15)');
    // not set: the default is raised silently (the manifest says the floor decided: deadlineFloored), and no policy value is recorded
    const unset = load({});
    expect(unset.explicit).toEqual({ deadlineMinutes: {} });
    const quiet = ask('reviewer', SMALL_4_PATHS, { policy: unset.policy, explicit: unset.explicit });
    expect(quiet.minutes).toBe(MIN_AGENT_MINUTES);
    expect(quiet.warnings).toEqual([]);
    expect(quiet.sizing).toMatchObject({ floored: true, policyMinutes: null, overridesPolicy: false });
    // set to the floor or above: nothing is overridden; a role the policy did not set keeps null
    const atFloor = load({ deadlineMinutes: { reviewer: MIN_AGENT_MINUTES } });
    expect(ask('reviewer', SMALL_4_PATHS, { policy: atFloor.policy, explicit: atFloor.explicit }).warnings).toEqual([]);
    expect(ask('security', SMALL_4_PATHS, { policy: set15.policy, explicit: set15.explicit }).sizing.policyMinutes).toBeNull();
    // a value the loader rejected was never set
    const rejected = load({ deadlineMinutes: { reviewer: 0 } });
    expect(rejected.explicit).toEqual({ deadlineMinutes: {} });
  });

  test('the floor relaxes no rule: the deadline is the floor and no more, and the 60-minute maximum stays above it', () => {
    const answer = reviewDeadlines({ role: 'reviewer', now: T0, work: SMALL_4_PATHS });
    expect(answer.deadlineAt).toBe(T0 + MIN_AGENT_MINUTES * 60 * 1000);
    expect(answer.deadlineAt).toBeLessThan(T0 + DEADLINE_MINUTES_MAX * 60 * 1000);
  });
});
