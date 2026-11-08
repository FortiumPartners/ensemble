'use strict';

/**
 * TRD-012-TEST: Single round cap everywhere (PRD scenarios).
 *
 * Validates PRD ACs: AC-009-1, AC-009-2, AC-009-3, AC-009-4 (REQ-009).
 *
 * TRD-012 was a CUTOVER, not a feature: `MAX_AUTO_ROUNDS = 2` left
 * pr-review-status.js, `--max-rounds (default 5)` left pr-merge, "max 2
 * review rounds" left the tech-lead quality loop and beads-build-wave, and
 * all four now take ONE number -- the repository's `roundCap`, read from the
 * base branch's REVIEW.md policy block (1-5, default 3).
 *
 * So the scenarios here are about the PROCEDURES, not the loader. The policy
 * loader's own behaviour (which file the cap comes from, the range check, the
 * warning) is TRD-002-TEST's subject in pr-review-policy-scenarios.test.js;
 * what is proven here is that the shared cap actually REACHES the grader every
 * procedure uses, that an out-of-range value cannot widen a procedure's budget
 * at that boundary either, and that no shipped procedure -- command YAML,
 * agent, skill, generated mirror or user-facing guide -- still carries a round
 * number of its own.
 *
 * Scenarios:
 *   - AC-009-1: at the cap the procedure stops iterating and asks the author
 *     to step back and reconsider the approach.
 *   - AC-009-2: the default is 3, 1..5 is configurable, and anything else is
 *     refused with the reason recorded and the default applied.
 *   - AC-009-3: the repository's configured cap is the one every procedure
 *     uses, and no procedure keeps a private number.
 *   - AC-009-4: the 82b6a138 documents no longer state a 2-round cap.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages/development/lib/pr-review-cli.js');

const { DEFAULT_ROUND_CAP, ROUND_CAP_MIN, ROUND_CAP_MAX } = require('../lib/pr-review-policy');

const BASE_SHA = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';
const HEAD_SHA = 'b8fe66aeb70b304237e584311a2b481a3c990f91';

/** Every shipped procedure that bounds review rounds, including the generated mirrors a user installs. */
const PROCEDURES = {
  'pr-merge (command)': 'packages/git/commands/pr-merge.yaml',
  'pr-merge (claude)': 'packages/git/commands/ensemble/pr-merge.md',
  'pr-merge (pi prompt)': 'packages/pi/prompts/ensemble-pr-merge.md',
  'pr-merge (pi skill)': 'packages/pi/skills/ensemble-pr-merge/SKILL.md',
  'beads-build-wave (command)': 'packages/development/commands/beads-build-wave.yaml',
  'beads-build-wave (claude)': 'packages/development/commands/ensemble/beads-build-wave.md',
  'beads-build-wave (pi prompt)': 'packages/pi/prompts/_hidden/ensemble-beads-build-wave.md',
  'tech-lead quality loop (agent)': 'packages/development/agents/tech-lead-orchestrator.yaml',
  'tech-lead quality loop (pi)': 'packages/pi/agents/tech-lead-orchestrator.md',
  'pr-review-cycle (skill)': 'packages/development/skills/pr-review-cycle/SKILL.md',
  'pr-review-cycle (pi skill)': 'packages/pi/skills/pr-review-cycle/SKILL.md',
};

const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

/** One fresh CLI process, the way a procedure actually reaches the grader. */
function runCli(subcommand, payload) {
  const out = execFileSync('node', [CLI, subcommand], { input: JSON.stringify(payload), encoding: 'utf8', cwd: REPO_ROOT });
  return JSON.parse(out);
}

/** The facts a procedure hands `status` when a round ends with a finding still open. */
function factsWithOpenFinding(overrides = {}) {
  return {
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    reviewedHeadSha: HEAD_SHA,
    findingCounts: { total: 1, actionable: 1, deferred: 0 },
    coverage: { status: 'complete', gaps: [] },
    tests: { exitCode: 0, skipped: false, command: 'npm test' },
    ...overrides,
  };
}

/** A REVIEW.md carrying one policy block, as a repository would commit it. */
function reviewMd(policy) {
  return ['# Review rules', '', '```ensemble-review-policy', JSON.stringify({ sourceSha: BASE_SHA, ...policy }), '```', ''].join('\n');
}

describe('Scenario AC-009-1: at the cap the procedure stops iterating and asks the author to reconsider', () => {
  test('the one grader every procedure calls refuses to complete and names the next action', () => {
    const result = runCli('status', factsWithOpenFinding({ roundsUsed: DEFAULT_ROUND_CAP, roundCap: DEFAULT_ROUND_CAP }));

    expect(result.status).not.toBe('REVIEW_COMPLETE');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.next).toBe('reconsider-approach-with-author');
    expect(result.reasons.join(' ')).toMatch(/step back and reconsider the approach/);
  });

  test('one round short of the cap the very same facts keep the loop open', () => {
    const result = runCli('status', factsWithOpenFinding({ roundsUsed: DEFAULT_ROUND_CAP - 1, roundCap: DEFAULT_ROUND_CAP }));

    expect(result.status).toBe('REVIEW_PENDING');
    expect(result.next).not.toBe('reconsider-approach-with-author');
  });

  test('a cap reached with nothing open still completes: the cap stops iteration, it does not fail the PR', () => {
    const result = runCli('status', {
      ...factsWithOpenFinding({ roundsUsed: DEFAULT_ROUND_CAP, roundCap: DEFAULT_ROUND_CAP }),
      findingCounts: { total: 1, actionable: 0, deferred: 1 },
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
    });

    expect(result.status).toBe('REVIEW_COMPLETE');
    expect(result.next).not.toBe('reconsider-approach-with-author');
  });

  test.each(Object.keys(PROCEDURES))('%s tells its operator to stop and reconsider at the cap, not to open another round', (name) => {
    const text = read(PROCEDURES[name]);
    expect(text).toMatch(/reconsider/i);
    expect(text).toMatch(/round cap|ROUND_CAP|roundCap/);
  });
});

describe('Scenario AC-009-2: the default is 3, 1..5 configures it, anything else is refused with the default applied', () => {
  test('a procedure that resolved no policy is graded against 3, never a larger number', () => {
    const result = runCli('status', factsWithOpenFinding({ roundsUsed: 3 }));

    expect(DEFAULT_ROUND_CAP).toBe(3);
    expect(result.contract.roundCap).toBe(3);
    expect(result.rounds.max).toBe(3);
    expect(result.next).toBe('reconsider-approach-with-author');
  });

  test.each([1, 2, 3, 4, 5])('a repository cap of %i is the cap the grader uses', (roundCap) => {
    const atCap = runCli('status', factsWithOpenFinding({ roundsUsed: roundCap, roundCap }));
    const below = runCli('status', factsWithOpenFinding({ roundsUsed: roundCap - 1, roundCap }));

    expect(atCap.contract.roundCap).toBe(roundCap);
    expect(atCap.next).toBe('reconsider-approach-with-author');
    expect(below.next).not.toBe('reconsider-approach-with-author');
  });

  test.each([0, 6, 99, -1, 2.5, '3', null, true, [3], { roundCap: 3 }])(
    'a cap of %p never widens a budget: the default applies and the refusal is recorded',
    (roundCap) => {
      const result = runCli('status', factsWithOpenFinding({ roundsUsed: DEFAULT_ROUND_CAP, roundCap }));

      expect(result.contract.roundCap).toBe(DEFAULT_ROUND_CAP);
      expect(result.next).toBe('reconsider-approach-with-author');
      if (roundCap !== null) {
        expect(result.reasons.join(' ')).toMatch(
          new RegExp(`invalid roundCap \\(expected an integer ${ROUND_CAP_MIN}-${ROUND_CAP_MAX}\\); default ${DEFAULT_ROUND_CAP} applied`)
        );
      }
    }
  );

  test('the out-of-range value is ignored, not clamped to its own direction', () => {
    // 99 does not become 5 and 0 does not become 1: both become the default.
    expect(runCli('status', factsWithOpenFinding({ roundsUsed: 4, roundCap: 99 })).rounds.max).toBe(DEFAULT_ROUND_CAP);
    expect(runCli('status', factsWithOpenFinding({ roundsUsed: 4, roundCap: 0 })).rounds.max).toBe(DEFAULT_ROUND_CAP);
  });
});

describe('Scenario AC-009-3: every procedure uses the repository cap and none keeps a private number', () => {
  test('a repository that sets 1 stops every procedure after one round, end to end through the CLI', () => {
    const policy = runCli('policy', { text: reviewMd({ roundCap: 1 }), baseSha: BASE_SHA, sourceSha: BASE_SHA });
    expect(policy.ok).toBe(true);
    expect(policy.policy.roundCap).toBe(1);

    // Each procedure hands the SAME resolved cap to the SAME grader, in its own process.
    for (const procedure of ['pr-review-cycle', 'pr-merge', 'beads-build-wave', 'tech-lead quality loop']) {
      const result = runCli('status', factsWithOpenFinding({ roundsUsed: 1, roundCap: policy.policy.roundCap }));
      expect([procedure, result.next]).toEqual([procedure, 'reconsider-approach-with-author']);
      expect([procedure, result.rounds.max]).toEqual([procedure, 1]);
    }

    // ... and under the repository's own default the same round count keeps going.
    expect(runCli('status', factsWithOpenFinding({ roundsUsed: 1 })).next).not.toBe('reconsider-approach-with-author');
  });

  test('editing the repository file changes every procedure at once: 5 then 2, with no code change', () => {
    const five = runCli('policy', { text: reviewMd({ roundCap: 5 }), baseSha: BASE_SHA, sourceSha: BASE_SHA });
    const two = runCli('policy', { text: reviewMd({ roundCap: 2 }), baseSha: BASE_SHA, sourceSha: BASE_SHA });

    expect(runCli('status', factsWithOpenFinding({ roundsUsed: 4, roundCap: five.policy.roundCap })).next).not.toBe(
      'reconsider-approach-with-author'
    );
    expect(runCli('status', factsWithOpenFinding({ roundsUsed: 2, roundCap: two.policy.roundCap })).next).toBe(
      'reconsider-approach-with-author'
    );
  });

  // A round budget a procedure STATES as its own: "--max-rounds (default 5)",
  // "max 2 review rounds", "MAX_AUTO_ROUNDS = 2", "bounded by 3 rounds". A user
  // passing `--max-rounds=3` on one run is not a budget the procedure keeps, and
  // a reference to the shared cap ("1-5, default 3") states no number of its own.
  const PRIVATE_NUMBER =
    /(?:MAX_(?:AUTO_)?ROUNDS|max[-\s]?rounds?)[^.\n]{0,80}default[^.\n]{0,8}\d|MAX_(?:AUTO_)?ROUNDS\s*[=(]\s*\d|max(?:imum)? \d+ (?:review|rejection|remediation) rounds|bounded by \d+ rounds|\b\d-round cap\b/i;

  /** The line names the ONE shared cap rather than a budget of its own. */
  const NAMES_THE_SHARED_CAP = /1-5, default 3|1 to 5, default 3|shared (?:policy )?round cap|lower(?:s)? (?:it|the shared)/i;

  test.each(Object.keys(PROCEDURES))('%s states no round budget of its own', (name) => {
    const text = read(PROCEDURES[name]);
    const offending = text.split('\n').filter((line) => PRIVATE_NUMBER.test(line) && !NAMES_THE_SHARED_CAP.test(line));
    expect(offending).toEqual([]);
  });

  test('the user-facing guides describe the shared cap, not a command-specific default', () => {
    for (const guide of ['docs/guides/user-guide.md', 'docs/guides/pr-review-cycle-time-pilot.md']) {
      const text = read(guide);
      const offending = text.split('\n').filter((line) => PRIVATE_NUMBER.test(line) && !NAMES_THE_SHARED_CAP.test(line));
      expect([guide, offending]).toEqual([guide, []]);
    }
  });

  test('negative control: the guard really does catch a private round budget, and passes the shared one', () => {
    expect(PRIVATE_NUMBER.test('Bound remediation to --max-rounds (default 5) verification rounds.')).toBe(true);
    expect(PRIVATE_NUMBER.test('delegate back to the specialist (max 2 review rounds)')).toBe(true);
    expect(PRIVATE_NUMBER.test('Given roundsUsed >= MAX_AUTO_ROUNDS = 2 with actionable findings')).toBe(true);
    expect(PRIVATE_NUMBER.test('PRD-2026-82b6a138 stated a 2-round cap')).toBe(true);
    expect(PRIVATE_NUMBER.test('--max-rounds=N caps remediation rounds before HALT-and-escalate (default 5)')).toBe(true);

    expect(PRIVATE_NUMBER.test("bounded by the repository's shared round cap from the pr-review-cycle skill")).toBe(false);
    expect(PRIVATE_NUMBER.test('/ensemble:pr-merge https://github.com/acme/portal/pull/482 --max-rounds=3')).toBe(false);

    // A line that states the shared cap's own numbers is allowed by the exemption, not by the pattern.
    expect(NAMES_THE_SHARED_CAP.test('the policy block in the base branch REVIEW.md, 1-5, default 3')).toBe(true);
  });
});

describe('Scenario AC-009-4: the 82b6a138 documents no longer state a 2-round cap', () => {
  const DOCUMENTS = [
    'docs/PRD/PRD-2026-82b6a138-pr-review-cycle-time.md',
    'docs/TRD/TRD-2026-82b6a138-pr-review-cycle-time.md',
    'docs/guides/pr-review-cycle-time-pilot.md',
  ];

  // AC-009-4 asks that these documents no longer CONTRADICT the shared cap. A
  // line that records the old constant as superseded -- naming TRD-012, the
  // shared cap or `roundCap` -- explains the history instead of contradicting it.
  const STATES_THE_OLD_CAP = /\b2-round cap\b|MAX_(?:AUTO_)?ROUNDS/;
  const RECORDED_AS_SUPERSEDED = /TRD-012|shared (?:round )?cap|roundCap|supersed|is gone/i;

  test.each(DOCUMENTS)('%s no longer contradicts the shared cap', (document) => {
    const offending = read(document)
      .split('\n')
      .filter((line) => STATES_THE_OLD_CAP.test(line) && !RECORDED_AS_SUPERSEDED.test(line));
    expect(offending).toEqual([]);
  });

  test('negative control: a bare statement of the old cap is caught, a superseded note is not', () => {
    expect(STATES_THE_OLD_CAP.test('Given roundsUsed >= MAX_AUTO_ROUNDS (2), the loop stops.')).toBe(true);
    expect(RECORDED_AS_SUPERSEDED.test('Given roundsUsed >= MAX_AUTO_ROUNDS (2), the loop stops.')).toBe(false);
    expect(RECORDED_AS_SUPERSEDED.test('(Since TRD-2026-70e784f2 TRD-012, `MAX_AUTO_ROUNDS = 2` is gone)')).toBe(true);
  });

  test('the TRD that owned the old constant says where the cap lives now, instead of staying silent', () => {
    const text = read('docs/TRD/TRD-2026-82b6a138-pr-review-cycle-time.md');
    expect(text).toMatch(/DEFAULT_ROUND_CAP = 3/);
    expect(text).toMatch(/pr-review-policy\.js/);
  });

  test('the shipped module really has no constant of its own left', () => {
    const source = read('packages/development/lib/pr-review-status.js');
    expect(source).not.toMatch(/MAX_AUTO_ROUNDS/);
    expect(source).toMatch(/require\('\.\/pr-review-policy'\)/);
  });
});

describe('TRD-012 cutover: the cap a repository configures survives the trip through a review-state report', () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-round-cap-'));
  });

  afterEach(() => {
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('a resumed run is graded against the recorded cap, not against the default', () => {
    const prId = 'ensemble-pr-9001';
    const policy = runCli('policy', { text: reviewMd({ roundCap: 2 }), baseSha: BASE_SHA, sourceSha: BASE_SHA });
    const round = runCli('status', factsWithOpenFinding({ roundsUsed: 2, roundCap: policy.policy.roundCap }));

    expect(runCli('state-write', { prId, cwd, state: { ...round, prId } }).ok).toBe(true);

    const resumed = runCli('state-read', { prId, cwd, headSha: HEAD_SHA });
    expect(resumed.state.contract.roundCap).toBe(2);
    expect(resumed.state.rounds).toEqual({ used: 2, max: 2 });
    expect(resumed.state.next).toBe('reconsider-approach-with-author');
  });
});
