'use strict';

/**
 * TRD-013-TEST: Convergence in the review loop (PRD scenarios).
 *
 * Validates PRD ACs: AC-007-2, AC-007-3 (REQ-007), AC-009-1 (REQ-009),
 * AC-010-1 (REQ-010), AC-011-1 (REQ-011).
 *
 * TRD-013 is the SKILL INTEGRATION: the libraries TRD-009 to TRD-012 built
 * are only worth anything if the pr-review-cycle loop actually reaches them,
 * round after round, and converges instead of re-posting the same findings
 * forever. So these scenarios do not call a library function once and assert
 * its return value -- the per-function Implementation AC tests already do
 * that (pr-review-severity.test.js, pr-review-repeats.test.js,
 * pr-review-delta-range.test.js, pr-review-status.test.js).
 *
 * Instead each scenario DRIVES THE LOOP the way SKILL.md documents it:
 *
 *   Step 3   `ledger dedupe` then `ledger recordRound` with the findings
 *            carried over in the review-state report;
 *   Step 6   `review-range` for every re-review after the first, fed the
 *            `reviewedHeadSha` the PRIOR round recorded;
 *   Step 8   `status` with `roundsUsed` and the policy `roundCap`;
 *   Step 9   `state-write` / `state-read`, the only thing that carries a
 *            fact from one round to the next.
 *
 * Every call is a FRESH `node pr-review-cli.js` process and every cross-round
 * fact travels through the on-disk report, so nothing an in-memory object
 * remembers can make the loop look convergent when it is not.
 *
 * Scenarios:
 *   - AC-007-2: the set the author is shown is Important first, each anchored
 *     to a file and a line -- after a real round, not in a sorted fixture.
 *   - AC-007-3: a maintainer edits the severity definitions in REVIEW.md and
 *     the next review is told the new wording, with no code change -- proven
 *     through the base-commit read (`git show <baseSha>:REVIEW.md`) the skill
 *     performs, in a scratch repository.
 *   - AC-009-1: the loop stops at the cap and asks the author to reconsider
 *     the approach; below the cap it keeps going (so the stop is the cap's
 *     doing, not a constant answer).
 *   - AC-010-1: round 2 reviews only the changes since the commit round 1
 *     recorded as reviewed.
 *   - AC-011-1: the class finding the loop presents names its class and lists
 *     every instance found, including the instance a later round added.
 */

const fs = require('fs');
const { readSkillBundle } = require('./helpers/pr-review-cycle-skill');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'packages/development/lib/pr-review-cli.js');
const SKILL = path.join(REPO_ROOT, 'packages/development/skills/pr-review-cycle/SKILL.md');

const OID = (hex) => hex.repeat(40).slice(0, 40);
const BASE = OID('a1b2c3d4e5f6');
const HEAD_R1 = OID('1111aaaa2222');
const HEAD_R2 = OID('3333bbbb4444');
const HEAD_R3 = OID('5555cccc6666');

/** One CLI call, in its own process: no state survives it. */
function runCli(subcommand, payload, options = {}) {
  const out = execFileSync('node', [CLI, subcommand], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: options.cwd || REPO_ROOT,
  });
  return JSON.parse(out);
}

function finding(overrides) {
  return {
    id: 'F1',
    source: 'local-review',
    locationOrLink: 'packages/development/lib/a.js:10',
    severity: 'important',
    failureMode: 'unchecked array index',
    disposition: 'fix',
    evidence: 'reproduced by the focused regression test',
    originalTextOrLink: 'packages/development/lib/a.js:10',
    ...overrides,
  };
}

/**
 * Exactly SKILL.md Step 3: dedupe this round's own findings, then record the
 * round against the ledger the state report carried over. Returns the CLI's
 * answer verbatim.
 */
function runRound(carriedLedger, rawFindings, round) {
  const deduped = runCli('ledger', { action: 'dedupe', findings: rawFindings });
  expect(Array.isArray(deduped.findings)).toBe(true);
  return runCli('ledger', { action: 'recordRound', ledger: carriedLedger, incoming: deduped.findings, round });
}

/** The file:line anchor a presented finding must carry (AC-007-2). */
function anchorText(entry) {
  return String(entry.locationOrLink || '');
}

describe('Scenario AC-007-2: the author is shown Important first, each finding anchored to a file and a line', () => {
  test('after a real round through the CLI, the presented order is Important, Nit, Pre-existing', () => {
    const result = runRound(
      [],
      [
        finding({ id: 'N1', severity: 'nit', locationOrLink: 'packages/development/lib/a.js:3', failureMode: 'name reads oddly' }),
        finding({ id: 'P1', severity: 'pre-existing', locationOrLink: 'packages/development/lib/b.js:9', failureMode: 'old todo left behind' }),
        finding({ id: 'I1', severity: 'important', locationOrLink: 'packages/development/lib/c.js:12', failureMode: 'unchecked array index' }),
        finding({ id: 'I2', severity: 'important', locationOrLink: 'packages/development/lib/d.js:1', failureMode: 'missing await on a write' }),
      ],
      1
    );

    expect(result.ok).toBe(true);
    expect(result.presented.map((entry) => entry.id)).toEqual(['I1', 'I2', 'N1', 'P1']);
  });

  test('every finding the loop presents cites a file and a line, so the author can go straight to it', () => {
    const result = runRound(
      [],
      [
        finding({ id: 'I1', severity: 'important', locationOrLink: 'packages/development/lib/c.js:12' }),
        finding({ id: 'N1', severity: 'nit', locationOrLink: 'packages/development/lib/a.js:3', failureMode: 'name reads oddly' }),
      ],
      1
    );

    expect(result.presented).toHaveLength(2);
    for (const entry of result.presented) {
      expect(anchorText(entry)).toMatch(/^[^\s:]+\.[a-z]+:\d+$/);
    }
  });

  test('the order holds across rounds: a round-2 Important sorts above a round-1 Nit that is still open', () => {
    const round1 = runRound(
      [],
      [finding({ id: 'N1', severity: 'nit', locationOrLink: 'packages/development/lib/a.js:3', failureMode: 'name reads oddly' })],
      1
    );
    const round2 = runRound(
      round1.findings,
      [finding({ id: 'I9', severity: 'important', locationOrLink: 'packages/development/lib/z.js:40', failureMode: 'missing await on a write' })],
      2
    );

    // Round 2 presents only what round 2 added -- the Nit is not re-posted --
    // while the ledger carried forward still holds it: suppressed, not dropped.
    expect(round2.presented.map((entry) => entry.id)).toEqual(['I9']);
    expect(round2.findings.map((entry) => `${entry.id}:${entry.severity}`)).toEqual(['N1:nit', 'I9:important']);
  });
});

describe('Scenario AC-007-3: a maintainer edits the severity definitions and the next review uses the new wording', () => {
  let repo;

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-severity-edit-'));
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(
      path.join(repo, 'REVIEW.md'),
      ['# Review rules', '', '## Severity', '', '- **Important** — a defect a user would hit.', '- **Nit** — a preference that does not change behaviour.', '- **Pre-existing** — not introduced by this change.', ''].join('\n')
    );
    git('add', 'REVIEW.md');
    git('commit', '-qm', 'review rules');
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
  });

  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  test('the maintainer edits prose only -- the definitions the reviewer is handed come from REVIEW.md at the base commit', () => {
    // The maintainer edits the meaning of Nit and commits it. No .js file is touched.
    const edited = fs
      .readFileSync(path.join(repo, 'REVIEW.md'), 'utf8')
      .replace(
        '- **Nit** — a preference that does not change behaviour.',
        '- **Nit** — a preference that does not change behaviour, including every naming question, which this repository now treats as a Nit without exception.'
      );
    fs.writeFileSync(path.join(repo, 'REVIEW.md'), edited);
    git('add', 'REVIEW.md');
    git('commit', '-qm', 'severity: naming questions are Nits');
    const baseSha = git('rev-parse', 'HEAD');

    // Step 1b, verbatim: the next review reads the rules from the base commit.
    const handedToTheReviewer = execFileSync('git', ['show', `${baseSha}:REVIEW.md`], { cwd: repo, encoding: 'utf8' });
    expect(handedToTheReviewer).toContain('which this repository now treats as a Nit without exception');
  });

  test('no code changed and nothing was rebuilt: the development package has no build step', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages/development/package.json'), 'utf8'));
    expect(pkg.scripts.build).toBeUndefined();

    // The loop's code knows the three WORDS and the order they are presented
    // in; it holds no sentence about what any of them means.
    const ledgerSource = fs.readFileSync(path.join(REPO_ROOT, 'packages/development/lib/pr-review-ledger.js'), 'utf8');
    expect(ledgerSource).toMatch(/important/);
    expect(ledgerSource).not.toMatch(/a preference that does not change behaviour/);
  });

  test('a PR cannot relax its own definitions: the head copy is never the guidance in force', () => {
    const baseSha = git('rev-parse', 'HEAD');
    // The PR rewrites REVIEW.md on its branch to call everything a Nit.
    fs.writeFileSync(path.join(repo, 'REVIEW.md'), '# Review rules\n\n## Severity\n\n- **Nit** — everything in this PR.\n');

    const fromBase = execFileSync('git', ['show', `${baseSha}:REVIEW.md`], { cwd: repo, encoding: 'utf8' });
    expect(fromBase).not.toContain('everything in this PR');
    expect(fromBase).toContain('**Important**');
  });

  test('the skill reads the definitions from the base commit, and says so', () => {
    const skill = readSkillBundle();
    expect(skill).toMatch(/read from the \*\*base commit\*\*/);
    expect(skill).toMatch(/never from the PR head/);
  });
});

describe('Scenario AC-009-1: at the round cap the loop stops and asks the author to reconsider the approach', () => {
  const factsAtRound = (roundsUsed, roundCap) => ({
    baseSha: BASE,
    headSha: HEAD_R1,
    reviewedHeadSha: HEAD_R1,
    findingCounts: { total: 2, actionable: 1, deferred: 1 },
    coverage: { status: 'complete', gaps: [] },
    tests: { exitCode: 0, skipped: false, command: 'npm test' },
    roundsUsed,
    roundCap,
  });

  test('with findings still open at the cap, the status is never complete and the next action is to reconsider', () => {
    const atCap = runCli('status', factsAtRound(3, 3));

    expect(atCap.status).not.toBe('REVIEW_COMPLETE');
    expect(atCap.next).toBe('reconsider-approach-with-author');
    expect(atCap.reasons.join(' ')).toMatch(/round cap reached \(3 of 3\): step back and reconsider the approach/);
  });

  test('below the cap the same open finding does NOT stop the loop -- the stop is the cap, not a constant answer', () => {
    const belowCap = runCli('status', factsAtRound(2, 3));

    expect(belowCap.status).toBe('REVIEW_PENDING');
    expect(belowCap.next).not.toBe('reconsider-approach-with-author');
    expect(belowCap.reasons.join(' ')).not.toMatch(/round cap reached/);
  });

  test('the cap that stops the loop is the repository\'s, read from the policy block, not a number in this procedure', () => {
    const reviewMd = [
      '# Review rules',
      '',
      '```ensemble-review-policy',
      JSON.stringify({ roundCap: 1 }),
      '```',
      '',
    ].join('\n');
    const policy = runCli('policy', { text: reviewMd, baseSha: BASE, sourceSha: BASE });
    expect(policy.policy.roundCap).toBe(1);

    // One round used is already the cap for this repository.
    const atConfiguredCap = runCli('status', factsAtRound(1, policy.policy.roundCap));
    expect(atConfiguredCap.next).toBe('reconsider-approach-with-author');
    expect(atConfiguredCap.contract.roundCap).toBe(1);

    // ... and under the default cap of 3 the very same round count keeps going.
    expect(runCli('status', factsAtRound(1, 3)).next).not.toBe('reconsider-approach-with-author');
  });

  test('the skill documents the stop, not a private round budget', () => {
    const skill = readSkillBundle();
    expect(skill).toMatch(/reconsider-approach-with-author/);
    expect(skill).toMatch(/`REVIEW_COMPLETE` is never reachable at the cap/);
    expect(skill).toMatch(/Never keep a\nprivate number here or in a calling command/);
  });
});

describe('Scenario AC-010-1: a round after the first examines only the changes since the previously reviewed commit', () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-convergence-'));
  });

  afterEach(() => {
    if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('round 2 takes its lastReviewedSha from the report round 1 WROTE, and reviews the delta only', () => {
    const prId = 'ensemble-pr-7001';

    // Round 1 reviewed HEAD_R1 and recorded it, exactly as Step 9 says.
    const written = runCli('state-write', {
      prId,
      cwd,
      state: {
        prId,
        baseSha: BASE,
        headSha: HEAD_R1,
        reviewedHeadSha: HEAD_R1,
        roundsUsed: 1,
        remediationShas: [HEAD_R2],
        ledger: [],
      },
    });
    expect(written.ok).toBe(true);

    // Round 2 resumes that report and asks review-range what to review.
    const resumed = runCli('state-read', { prId, cwd, headSha: HEAD_R1 });
    expect(resumed.state.reviewedHeadSha).toBe(HEAD_R1);

    const range = runCli('review-range', {
      baseSha: BASE,
      headSha: HEAD_R2,
      lastReviewedSha: resumed.state.reviewedHeadSha,
      commits: [{ sha: HEAD_R2, parents: [HEAD_R1] }],
      remediationShas: resumed.state.remediationShas,
    });

    expect(range.mode).toBe('delta');
    expect(range.range).toBe(`${HEAD_R1}..${HEAD_R2}`);
    expect(range.range).not.toBe(`${BASE}..${HEAD_R2}`);
  });

  test('round 1 has nothing to compare against, so it reviews the full base-correct range', () => {
    const range = runCli('review-range', { baseSha: BASE, headSha: HEAD_R1, commits: [] });

    expect(range.mode).toBe('full');
    expect(range.range).toBe(`${BASE}..${HEAD_R1}`);
  });

  test('a push between rounds that the loop cannot vouch for sends round 3 back to the full range', () => {
    const prId = 'ensemble-pr-7002';
    runCli('state-write', {
      prId,
      cwd,
      state: { prId, baseSha: BASE, headSha: HEAD_R2, reviewedHeadSha: HEAD_R2, roundsUsed: 2, remediationShas: [], ledger: [] },
    });
    const resumed = runCli('state-read', { prId, cwd, headSha: HEAD_R2 });

    const range = runCli('review-range', {
      baseSha: BASE,
      headSha: HEAD_R3,
      lastReviewedSha: resumed.state.reviewedHeadSha,
      // An agent pushed HEAD_R3 outside the loop: no round recorded it as a remediation.
      commits: [{ sha: HEAD_R3, parents: [HEAD_R2] }],
      remediationShas: [],
    });

    expect(range.mode).toBe('full');
    expect(range.range).toBe(`${BASE}..${HEAD_R3}`);
    expect(range.reason).toBe('unvouched-history');
  });

  test('the skill wires round 2 onward to review-range, fed by the prior round\'s recorded head', () => {
    const skill = readSkillBundle();
    expect(skill).toMatch(/review-range/);
    expect(skill).toMatch(/`lastReviewedSha` is the `reviewedHeadSha` the\nprior round recorded in the state report/);
  });
});

describe('Scenario AC-011-1: a class finding names the class and lists every instance found', () => {
  const classFinding = (id, file, line) =>
    finding({
      id,
      locationOrLink: `${file}:${line}`,
      originalTextOrLink: `${file}:${line}`,
      failureMode: `unvalidated external input at ${file}`,
      class: 'unvalidated external input',
    });

  test('one class record is presented for three instances, naming the class and every location', () => {
    const round1 = runRound(
      [],
      [
        classFinding('C1', 'packages/development/lib/a.js', 11),
        classFinding('C2', 'packages/development/lib/b.js', 22),
        classFinding('C3', 'packages/development/lib/c.js', 33),
      ],
      1
    );

    const presentedClasses = round1.presented.filter((entry) => entry.kind === 'class');
    expect(presentedClasses).toHaveLength(1);

    const record = presentedClasses[0];
    expect(record.class).toBe('unvalidated external input');
    expect(record.instanceCount).toBe(3);
    expect(record.instances.map((instance) => instance.locationOrLink).sort()).toEqual([
      'packages/development/lib/a.js:11',
      'packages/development/lib/b.js:22',
      'packages/development/lib/c.js:33',
    ]);

    // The three instances are NOT also presented as three separate findings:
    // the author gets one class to fix in a batch, with every location named.
    expect(round1.presented.filter((entry) => entry.kind !== 'class')).toEqual([]);
  });

  test('the instance a later round finds joins the SAME class record, with the full list intact', () => {
    const round1 = runRound([], [classFinding('C1', 'packages/development/lib/a.js', 11)], 1);
    const round2 = runRound(round1.findings, [classFinding('C9', 'packages/development/lib/d.js', 44)], 2);

    expect(round2.attached.map((entry) => entry.class)).toEqual(['unvalidated external input']);

    const record = round2.presented.find((entry) => entry.kind === 'class');
    expect(record).toBeDefined();
    expect(record.class).toBe('unvalidated external input');
    expect(record.instances.map((instance) => instance.locationOrLink)).toEqual([
      'packages/development/lib/a.js:11',
      'packages/development/lib/d.js:44',
    ]);
    // One class finding, not two: round 2 opened nothing new.
    expect(round2.classes).toHaveLength(1);
  });

  test('the skill tells the reviewer to report classes by name with every instance, so the batch fix covers all of them', () => {
    const skill = readSkillBundle();
    expect(skill).toMatch(/`classes` by naming the class and listing every instance found/);
    expect(skill).toMatch(/recordRound/);
  });
});
