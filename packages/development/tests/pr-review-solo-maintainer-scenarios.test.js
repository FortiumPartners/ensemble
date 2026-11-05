'use strict';

/**
 * Solo-maintainer rule (policy `soloMaintainer`) -- requirement-level scenarios.
 *
 * A repository with exactly one maintainer can never field two humans for a
 * High PR: the director of an agent-authored PR fills one slot, the PR author
 * never fills one, and nobody else exists. With the policy flag on, a High PR
 * that touches no sensitive path and was directed by that maintainer needs one
 * human instead of two -- the director, AUTHENTICATED: someone other than the
 * PR author, who has APPROVED the current head on the host. A `Directed by:`
 * line in the PR body is a claim, never evidence, so it alone never lowers the
 * floor. The security lane must still pass, and every other case keeps two
 * humans.
 *
 * Every input comes from the REAL chain (`classifyPaths` -> `assignTier` ->
 * `effectiveTier` -> `evaluateApprovals` -> `evaluateGate`), and every case
 * that relaxes sits next to the case that must still be refused. Every fact
 * the rule leans on holds by default (a second assessment that said no, a
 * path list that can be trusted, a director who approved the head and did not
 * write the PR), so each refusal is judged on the one fact it overrides.
 */

const fs = require('fs');
const path = require('path');

const { evaluateGate, BLOCKER_CODES } = require('../lib/pr-review-gate');
const { evaluateApprovals } = require('../lib/pr-review-approvals');
const { assignTier, effectiveTier, tierRecord } = require('../lib/pr-review-tier');
const { classifyPaths } = require('../lib/pr-review-paths');
const { checkDescription } = require('../lib/pr-review-description');
const { loadPolicy } = require('../lib/pr-review-policy');
const { HANDLERS } = require('../lib/pr-review-cli');
const { readSkillReference } = require('./helpers/pr-review-cycle-skill');

const BASE = 'e'.repeat(40);
const HEAD = 'a'.repeat(40);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const DECLARATION = Object.freeze({
  sourceSha: BASE,
  sensitive: [],
  high: ['packages/agent-core/**'],
});

const SOLO_POLICY = Object.freeze({
  botLogins: ['coderabbitai'],
  maintainerLogins: ['@Maintainer-M'],
  soloMaintainer: true,
});

const DESCRIPTION = [
  '## Summary',
  '',
  'Change.',
  '',
  '## Testing',
  '',
  'Ran the suite.',
  '',
  '## Risk',
  '',
  'Low.',
  '',
  '## How to revert',
  '',
  'Revert the commit.',
  '',
].join('\n');

/** What the second-assessment subagent returns when it says no other person is needed. */
const NO_PEER = Object.freeze({ needsAnotherPerson: false, reason: 'reviewed', evidencePaths: [] });

/** Pass as `assessment` to leave the `secondAssessment` key out of the tier input altogether. */
const OMIT = Symbol('omit the second assessment');

/**
 * The real chain for a PR changing `changedPaths`, High by owner declaration
 * or by the sensitive floor: path classification, tier assignment, effective tier.
 */
function chainFor(changedPaths, { policy = SOLO_POLICY, assessment = NO_PEER, ...extra } = {}) {
  const paths = classifyPaths({ changedPaths, declaration: DECLARATION, baseSha: BASE });
  const input = { paths, kinds: [{ kind: 'product', paths: changedPaths }], ...extra };
  if (assessment !== OMIT) input.secondAssessment = assessment;
  const assignment = assignTier(input);
  return { paths, assignment, effective: effectiveTier({ assignment, policy, author: 'maintainer-m' }) };
}

/** The effective tier of the real chain for a PR changing `changedPaths`. */
const tierFor = (changedPaths, policy = SOLO_POLICY, options = {}) => chainFor(changedPaths, { policy, ...options }).effective;

/** A non-sensitive PR the tier chain RAISES to High (it is Medium on its paths alone). */
function raisedTierFor({ secondAssessment = NO_PEER, proposedTier } = {}) {
  const changedPaths = ['packages/development/lib/widget.js'];
  const paths = classifyPaths({ changedPaths, declaration: { ...DECLARATION, high: [] }, baseSha: BASE });
  const assignment = assignTier({
    paths,
    kinds: [{ kind: 'product', paths: changedPaths }],
    secondAssessment,
    proposedTier,
  });
  return effectiveTier({ assignment, policy: SOLO_POLICY, author: 'maintainer-m' });
}

const HIGH_PATHS = ['packages/agent-core/src/behavior/event-disposition.ts'];

/** An APPROVED review `login` gave on `commitSha` (the head by default), as the host returns it. */
const approval = (login, overrides = {}) => ({ author: login, state: 'APPROVED', commitSha: HEAD, ...overrides });

/**
 * An agent-authored PR directed by `directedBy`. By default the director has
 * APPROVED the head and someone else wrote the PR, so a case that overrides
 * `directedBy`, `author` or `reviews` is judged on that fact alone. An `author`
 * of `null` is a PR author nobody could read.
 */
function approvalsFor(
  tier,
  { policy = SOLO_POLICY, directedBy = 'maintainer-m', agentAuthored = true, author = 'agent-bot-author', reviews, headTreeSha } = {}
) {
  return evaluateApprovals({
    reviews: reviews === undefined ? (directedBy === null ? [] : [approval(directedBy)]) : reviews,
    headSha: HEAD,
    headTreeSha,
    tier,
    policy,
    author,
    directedBy,
    agentAuthored,
  });
}

function gateFor({ tier, approvals, security = { status: 'clean', findings: [] } }) {
  return evaluateGate({
    headSha: HEAD,
    ledger: [],
    approvals,
    tier,
    description: checkDescription({ body: DESCRIPTION, agentAuthored: false }),
    security,
  });
}

const codesOf = (result) => result.blockers.map((entry) => entry.code);

/** The ordinary High answer: the director's credit counts one human, and two are required. */
const refused = (approvals) => {
  expect(approvals).toMatchObject({ satisfied: false, humansRequired: 2, soloMaintainer: false });
  expect(approvals.reason).toBe('insufficient-human-approvals');
};

describe('solo maintainer: the one-human path', () => {
  test('a non-sensitive High PR directed by the sole maintainer needs one human, and the gate agrees', () => {
    const tier = tierFor(HIGH_PATHS);
    expect(tier.effectiveTier).toBe('high');
    expect(tier.soloMaintainer).toEqual({ eligible: true, login: 'maintainer-m' });

    const approvals = approvalsFor(tier);
    expect(approvals).toMatchObject({
      satisfied: true,
      humansRequired: 1,
      humansCounted: 1,
      soloMaintainer: true,
      directedBy: 'maintainer-m',
    });
    expect(approvals.reasons).toContain('solo-maintainer-applied');

    const gate = gateFor({ tier, approvals });
    expect(codesOf(gate)).toEqual([]);
    expect(gate.mergeable).toBe(true);
  });

  test('the tier record carries the eligibility so the recorded decision names it', () => {
    const { assignment, effective } = chainFor(HIGH_PATHS);
    const record = tierRecord({ assignment, effective });
    expect(record.soloMaintainer).toEqual({ eligible: true, login: 'maintainer-m' });
  });

  test('the security lane still blocks: a High solo PR whose security review did not run is refused', () => {
    const tier = tierFor(HIGH_PATHS);
    const gate = gateFor({ tier, approvals: approvalsFor(tier), security: { status: 'not-run', findings: [] } });
    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate)).toContain(BLOCKER_CODES.SECURITY_REVIEW_MISSING);
  });
});

describe('solo maintainer: every other case keeps two humans', () => {
  test('a sensitive path (CI workflow) keeps two humans', () => {
    const tier = tierFor(['.github/workflows/ci.yml']);
    expect(tier.soloMaintainer.eligible).toBe(false);
    refused(approvalsFor(tier));
  });

  test('changing the review policy itself keeps two humans', () => {
    const tier = tierFor(['REVIEW.md']);
    expect(tier.soloMaintainer.eligible).toBe(false);
    refused(approvalsFor(tier));
  });

  test('the flag off keeps two humans', () => {
    const policy = { ...SOLO_POLICY, soloMaintainer: false };
    const tier = tierFor(HIGH_PATHS, policy);
    refused(approvalsFor(tier, { policy }));
  });

  test('a flag that is not exactly true keeps two humans', () => {
    const policy = { ...SOLO_POLICY, soloMaintainer: 'true' };
    const tier = tierFor(HIGH_PATHS, policy);
    refused(approvalsFor(tier, { policy }));
  });

  test('a tier raised to High by a second assessment asking for another person keeps two humans', () => {
    const tier = raisedTierFor({ secondAssessment: { needsAnotherPerson: true, reason: 'touches billing' } });
    expect(tier.effectiveTier).toBe('high');
    expect(tier.soloMaintainer.eligible).toBe(false);
    refused(approvalsFor(tier));
  });

  test('a tier raised to High by a proposal keeps two humans', () => {
    const tier = raisedTierFor({ proposedTier: 'high' });
    expect(tier.effectiveTier).toBe('high');
    expect(tier.soloMaintainer.eligible).toBe(false);
    refused(approvalsFor(tier));
  });

  describe('a PR already High by the owner declaration (nothing can rise)', () => {
    const highByDeclaration = (extra) => {
      const paths = classifyPaths({ changedPaths: HIGH_PATHS, declaration: DECLARATION, baseSha: BASE });
      const assignment = assignTier({ paths, kinds: [{ kind: 'product', paths: HIGH_PATHS }], secondAssessment: NO_PEER, ...extra });
      return effectiveTier({ assignment, policy: SOLO_POLICY, author: 'maintainer-m' });
    };

    test('a second assessment asking for another person is honoured: two humans', () => {
      const tier = highByDeclaration({ secondAssessment: { needsAnotherPerson: true, reason: 'touches billing' } });
      expect(tier.effectiveTier).toBe('high');
      refused(approvalsFor(tier));
    });

    test('an unreadable second assessment cannot say no, so it is honoured too', () => {
      refused(approvalsFor(highByDeclaration({ secondAssessment: 'looks fine' })));
    });

    test('a proposal of High is honoured: two humans', () => {
      refused(approvalsFor(highByDeclaration({ proposedTier: 'high' })));
    });

    test('a second assessment that says no leaves the rule in force', () => {
      const tier = highByDeclaration({ secondAssessment: { needsAnotherPerson: false, reason: 'reviewed' } });
      expect(approvalsFor(tier)).toMatchObject({ satisfied: true, humansRequired: 1, soloMaintainer: true });
    });
  });

  test('two maintainers keep two humans', () => {
    const policy = { ...SOLO_POLICY, maintainerLogins: ['maintainer-m', 'maintainer-n'] };
    const tier = tierFor(HIGH_PATHS, policy);
    refused(approvalsFor(tier, { policy }));
  });

  test('a PR directed by someone other than the sole maintainer keeps two humans', () => {
    const tier = tierFor(HIGH_PATHS);
    refused(approvalsFor(tier, { directedBy: 'someone-else' }));
  });

  test('a PR no agent wrote has no director, so the maintainer cannot fill the slot', () => {
    const tier = tierFor(HIGH_PATHS);
    refused(approvalsFor(tier, { agentAuthored: false }));
  });

  test('a Medium PR is untouched: the rule only ever relaxes High', () => {
    const tier = tierFor(['packages/development/lib/widget.js']);
    expect(tier.effectiveTier).toBe('medium');
    const approvals = approvalsFor(tier);
    expect(approvals).toMatchObject({ humansRequired: 1, soloMaintainer: false });
  });

  test('a tier record that raised the requirement above two is not relaxed to one', () => {
    const tier = { ...tierFor(HIGH_PATHS), humansRequired: 3 };
    const approvals = approvalsFor(tier);
    expect(approvals).toMatchObject({ satisfied: false, humansRequired: 3, soloMaintainer: false });
    expect(approvals.reasons).not.toContain('solo-maintainer-applied');
  });
});

describe('solo maintainer: the director is authenticated, not merely named (F-01)', () => {
  const tier = tierFor(HIGH_PATHS);

  /** Refused: the director's credit still counts one human, the floor stays at two, and the reason is named. */
  const refusedBecause = (approvals, warning) => {
    refused(approvals);
    expect(approvals).toMatchObject({ humansCounted: 1, directedBy: 'maintainer-m' });
    expect(approvals.reasons).not.toContain('solo-maintainer-applied');
    expect(approvals.warnings).toContain(warning);
  };

  test('the sole maintainer, directing a PR someone else wrote and APPROVING its head, lowers High to one human', () => {
    const approvals = approvalsFor(tier);
    expect(approvals).toMatchObject({
      satisfied: true,
      humansRequired: 1,
      humansCounted: 1,
      soloMaintainer: true,
      approvedBy: ['maintainer-m'],
    });
    expect(approvals.ignored).toEqual([]);
    expect(approvals.warnings).toEqual([]);
    expect(gateFor({ tier, approvals }).mergeable).toBe(true);
  });

  test('an approval on an older commit that has the head\'s tree is bound to the head', () => {
    const TREE = 'f'.repeat(40);
    const approvals = approvalsFor(tier, {
      headTreeSha: TREE,
      reviews: [approval('maintainer-m', { commitSha: 'c'.repeat(40), treeSha: TREE })],
    });
    expect(approvals).toMatchObject({ satisfied: true, humansRequired: 1, soloMaintainer: true });
  });

  test('a Directed by line alone never lowers the floor: no APPROVED review, no discount', () => {
    refusedBecause(approvalsFor(tier, { reviews: [] }), 'solo-maintainer-director-not-approved');
  });

  test('an outsider who names the maintainer on the Directed by line gets two humans, and the gate refuses', () => {
    const approvals = approvalsFor(tier, { author: 'mallory', reviews: [] });
    refusedBecause(approvals, 'solo-maintainer-director-not-approved');

    const gate = gateFor({ tier, approvals });
    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate)).toEqual([BLOCKER_CODES.APPROVALS_UNSATISFIED]);
  });

  test.each([
    ['the same login', 'maintainer-m'],
    ['the same login written with an @ and other letter case', '@Maintainer-M'],
  ])('a director who is also the PR author (%s) gets two humans: their own review is a self-approval', (_label, author) => {
    const approvals = approvalsFor(tier, { author });
    refusedBecause(approvals, 'solo-maintainer-director-is-author');
    expect(approvals.ignored).toEqual([{ login: 'maintainer-m', reason: 'self-approval', commitSha: HEAD }]);
    expect(gateFor({ tier, approvals }).mergeable).toBe(false);
  });

  test('a PR author nobody could read cannot be shown to differ from the director', () => {
    refusedBecause(approvalsFor(tier, { author: null }), 'solo-maintainer-author-unknown');
  });

  test('an approval bound to another commit is not an approval of this head', () => {
    const approvals = approvalsFor(tier, { reviews: [approval('maintainer-m', { commitSha: 'b'.repeat(40) })] });
    refusedBecause(approvals, 'solo-maintainer-director-not-approved');
    expect(approvals.ignored).toEqual([{ login: 'maintainer-m', reason: 'stale-commit', commitSha: 'b'.repeat(40) }]);
  });

  test('an approval the maintainer withdrew with a later review does not count', () => {
    const withdrawn = { author: 'maintainer-m', state: 'CHANGES_REQUESTED', commitSha: HEAD };
    refusedBecause(approvalsFor(tier, { reviews: [approval('maintainer-m'), withdrawn] }), 'solo-maintainer-director-not-approved');
  });

  test('a review the platform marked as an automated account is not the maintainer approving', () => {
    const approvals = approvalsFor(tier, { reviews: [approval('maintainer-m', { isBot: true })] });
    refusedBecause(approvals, 'solo-maintainer-director-not-approved');
    expect(approvals.ignored).toEqual([{ login: 'maintainer-m', reason: 'automated', commitSha: HEAD }]);
  });

  test('another person approving does not stand in for the maintainer: two humans still work, the ordinary way', () => {
    const approvals = approvalsFor(tier, { reviews: [approval('someone-else')] });
    expect(approvals).toMatchObject({ satisfied: true, humansRequired: 2, humansCounted: 2, soloMaintainer: false });
    expect(approvals.reasons).not.toContain('solo-maintainer-applied');
  });
});

describe('solo maintainer: a second assessment nobody gave is not a "no" (F-03, F-21)', () => {
  test.each([
    ['omitted', OMIT],
    ['null', null],
  ])('a second assessment that is %s keeps two humans on a PR that is already High', (_label, assessment) => {
    const { assignment, effective } = chainFor(HIGH_PATHS, { assessment });
    expect(assignment.peerDemanded).toBe(true);
    expect(effective.effectiveTier).toBe('high');
    expect(effective.soloMaintainer).toEqual({ eligible: false, login: null });

    const approvals = approvalsFor(effective);
    refused(approvals);
    expect(gateFor({ tier: effective, approvals }).mergeable).toBe(false);
  });

  test.each([
    ['an object that does not carry needsAnotherPerson', { reason: 'looks fine', evidencePaths: [] }],
    ['an empty object', {}],
    ['needsAnotherPerson as the string "false"', { needsAnotherPerson: 'false' }],
    ['needsAnotherPerson as null', { needsAnotherPerson: null }],
    ['needsAnotherPerson as 0', { needsAnotherPerson: 0 }],
    ['an array', []],
    ['a string', 'looks fine'],
    ['the bare boolean false, which is no record at all', false],
  ])('%s cannot say no, so two humans', (_label, assessment) => {
    const { assignment, effective } = chainFor(HIGH_PATHS, { assessment });
    expect(assignment.peerDemanded).toBe(true);
    refused(approvalsFor(effective));
  });

  test('a missing assessment withholds the discount without raising anything: a Medium PR stays Medium', () => {
    const { assignment, effective } = chainFor(['packages/development/lib/widget.js'], { assessment: OMIT });
    expect(assignment.tier).toBe('medium');
    expect(assignment.raised).toEqual([]);
    expect(assignment.reasons).toContain('second-assessment-missing');
    expect(effective).toMatchObject({ effectiveTier: 'medium', humansRequired: 1 });
  });

  test('an assessment that says no still leaves the rule in force, and records no missing assessment', () => {
    const { assignment, effective } = chainFor(HIGH_PATHS, { assessment: NO_PEER });
    expect(assignment.peerDemanded).toBe(false);
    expect(assignment.reasons).not.toContain('second-assessment-missing');
    expect(approvalsFor(effective)).toMatchObject({ satisfied: true, humansRequired: 1, soloMaintainer: true });
  });
});

describe('solo maintainer: a changed-path list the rule cannot trust keeps two humans (F-02)', () => {
  /** git's C-quoting of `.github/workflows/é.yml`, which is how `git diff --name-only` prints it without `-z`. */
  const QUOTED = '".github/workflows/\\303\\251.yml"';

  const expectTwoHumans = ({ assignment, effective }) => {
    expect(effective).toMatchObject({ effectiveTier: 'high', soloMaintainer: { eligible: false, login: null } });
    refused(approvalsFor(effective));
    return assignment;
  };

  test('a rename-complete listing names the side of a move that was deleted, and that side is sensitive', () => {
    // `git diff --name-only -z --no-renames` lists BOTH sides of a move.
    const chain = chainFor([...HIGH_PATHS, '.github/workflows/ci.yml', 'tools/ci.yml']);
    expect(chain.paths.sensitive).toEqual(['.github/workflows/ci.yml']);
    expectTwoHumans(chain);
  });

  test.each([
    ['a name git quoted because of a non-ASCII byte', QUOTED],
    ['a name git quoted because of a double quote', '".github/workflows/a\\"b.yml"'],
    ['a name-status line, with a tab before the path', 'D\t.github/workflows/ci.yml'],
    ['a name with a newline in it', 'packages/agent-core/src/a\nb.ts'],
    ['a name with a DEL character in it', 'packages/agent-core/src/a\u007f.ts'],
    ['a name with a carriage return in it', 'packages/agent-core/src/a\rb.ts'],
    ['a name with a line separator (U+2028) in it', 'packages/agent-core/src/a\u2028b.ts'],
    ['a name with a paragraph separator (U+2029) in it', 'packages/agent-core/src/a\u2029b.ts'],
    ['a name with a next-line character (U+0085) in it', 'packages/agent-core/src/a\u0085b.ts'],
    ['a name with a C1 control character (U+009F) in it', 'packages/agent-core/src/a\u009fb.ts'],
  ])('%s is no verbatim path, so the list cannot vouch that nothing sensitive changed', (_label, entry) => {
    const assignment = expectTwoHumans(chainFor([...HIGH_PATHS, entry]));
    expect(assignment.warnings).toContain('non-verbatim-changed-path');
  });

  /** Whether the tier module lets this ONE name count as part of a path list it can vouch for. */
  const readable = (name) =>
    assignTier({
      paths: { sensitive: [], high: [name], paths: [name] },
      kinds: [{ kind: 'product', paths: [name] }],
      secondAssessment: NO_PEER,
    }).changedPathsReadable;

  test('exactly the control characters, DEL, NEL and the Unicode line and paragraph separators are refused (U+0000 to U+2FFF)', () => {
    const range = (from, to) => Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
    const refused = [];
    for (let code = 0; code <= 0x2fff; code += 1) {
      if (!readable(`packages/agent-core/src/a${String.fromCharCode(code)}b.ts`)) refused.push(code);
    }
    // C0, DEL and C1 (which holds NEL, U+0085), then the line and the paragraph separator.
    expect(refused).toEqual([...range(0x00, 0x1f), ...range(0x7f, 0x9f), 0x2028, 0x2029]);
  });

  test('ordinary non-ASCII names stay readable: a no-break space, a hyphenation point, CJK, an emoji', () => {
    for (const name of ['a\u00a0b.ts', 'a\u2027b.ts', '\u6587\u4ef6.ts', 'a\ud83d\ude00b.ts', 'caf\u00e9.ts']) {
      expect(readable(`packages/agent-core/src/${name}`)).toBe(true);
    }
  });

  /**
   * The real classification of HIGH_PATHS with its `paths` list replaced, or removed when `listed` is undefined:
   * a hand-assembled input that exercises the rule's own guard (the real classification of an empty list would
   * not be High at all, so it could never be solo-eligible).
   */
  const withListing = (listed) => {
    const paths = { ...classifyPaths({ changedPaths: HIGH_PATHS, declaration: DECLARATION, baseSha: BASE }) };
    if (listed === undefined) delete paths.paths;
    else paths.paths = listed;
    const assignment = assignTier({ paths, kinds: [{ kind: 'product', paths: HIGH_PATHS }], secondAssessment: NO_PEER });
    return { assignment, effective: effectiveTier({ assignment, policy: SOLO_POLICY, author: 'maintainer-m' }) };
  };

  test.each([
    ['is missing', undefined],
    ['is empty', []],
    ['mixes records and bare names', [{ path: HIGH_PATHS[0] }, HIGH_PATHS[0]]],
    ['holds an empty name', [HIGH_PATHS[0], '']],
  ])('a path list that %s keeps two humans', (_label, listed) => {
    expectTwoHumans(withListing(listed));
  });

  test('a verbatim non-ASCII name and a name with a space are ordinary paths: the rule stays in force', () => {
    const { assignment, effective } = chainFor(['packages/agent-core/src/é.ts', 'packages/agent-core/docs/my notes.md']);
    expect(assignment.warnings).toEqual([]);
    expect(approvalsFor(effective)).toMatchObject({ satisfied: true, humansRequired: 1, soloMaintainer: true });
  });
});

describe('solo maintainer: the gate does not take the approvals evaluator on trust', () => {
  test('approvals that claim the solo rule on a PR the tier says is not eligible are refused as a tier mismatch', () => {
    const solo = tierFor(HIGH_PATHS);
    const forged = approvalsFor(solo); // solo-applied: humansRequired 1
    const sensitiveTier = tierFor(['.github/workflows/ci.yml']);

    const gate = gateFor({ tier: sensitiveTier, approvals: forged });
    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate)).toContain(BLOCKER_CODES.APPROVALS_TIER_MISMATCH);
  });

  test('approvals that name a different director than the eligible maintainer are refused as a tier mismatch', () => {
    const tier = tierFor(HIGH_PATHS);
    const approvals = { ...approvalsFor(tier), directedBy: 'someone-else' };

    const gate = gateFor({ tier, approvals });
    expect(codesOf(gate)).toContain(BLOCKER_CODES.APPROVALS_TIER_MISMATCH);
  });

  test('approvals that lowered the count without claiming the solo rule are refused as a tier mismatch', () => {
    const tier = tierFor(HIGH_PATHS);
    const approvals = { ...approvalsFor(tier), soloMaintainer: false };

    const gate = gateFor({ tier, approvals });
    expect(codesOf(gate)).toContain(BLOCKER_CODES.APPROVALS_TIER_MISMATCH);
  });

  describe('forged approvals results', () => {
    const solo = tierFor(HIGH_PATHS);
    /** A genuine solo-applied result with the named fields overwritten. */
    const forgery = (overrides) => ({ ...approvalsFor(solo), ...overrides });

    test('a solo claim naming no director, on a tier that is not eligible, is refused as a tier mismatch', () => {
      const gate = gateFor({ tier: tierFor(['.github/workflows/ci.yml']), approvals: forgery({ directedBy: null }) });
      expect(gate.mergeable).toBe(false);
      expect(codesOf(gate)).toContain(BLOCKER_CODES.APPROVALS_TIER_MISMATCH);
    });

    test('an eligible tier does not accept a count lowered below the one-human floor', () => {
      const gate = gateFor({ tier: solo, approvals: forgery({ humansRequired: 0 }) });
      expect(gate.mergeable).toBe(false);
      expect(codesOf(gate)).toContain(BLOCKER_CODES.APPROVALS_TIER_MISMATCH);
    });

    test('a tier record that raised the requirement above two is not relaxed by a solo claim', () => {
      const gate = gateFor({ tier: { ...solo, humansRequired: 3 }, approvals: forgery({}) });
      expect(gate.mergeable).toBe(false);
      expect(codesOf(gate)).toContain(BLOCKER_CODES.APPROVALS_TIER_MISMATCH);
    });
  });
});

describe('solo maintainer: the policy block accepts the key', () => {
  const block = (extra) =>
    ['```ensemble-review-policy', JSON.stringify({ sourceSha: BASE, maintainerLogins: ['maintainer-m'], ...extra }), '```'].join('\n');

  test('soloMaintainer: true is read, not treated as an unknown key', () => {
    const result = loadPolicy({ text: block({ soloMaintainer: true }), baseSha: BASE });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('policy');
    expect(result.policy.soloMaintainer).toBe(true);
  });

  test('a non-boolean value is rejected and the safe default (off) stands', () => {
    const result = loadPolicy({ text: block({ soloMaintainer: 'yes' }), baseSha: BASE });
    expect(result.policy.soloMaintainer).toBe(false);
    expect(result.rejected.map((entry) => entry.key)).toContain('soloMaintainer');
  });
});

describe("solo maintainer: through the subcommands the skill calls, under this repository's own policy", () => {
  const POLICY_TEXT = fs.readFileSync(path.join(REPO_ROOT, 'REVIEW.md'), 'utf8');
  const { policy } = HANDLERS.policy({ text: POLICY_TEXT, baseSha: BASE, sourceSha: BASE });
  const DIRECTOR = 'ldangelo';
  /** High by this repository's `highPaths`, and not sensitive. */
  const LIB = ['packages/development/lib/trd-parser.js'];

  /** Step 1b's `paths` and Step 10e's `tier`, `approvals` and `gate`, run in order on the CLI's own handlers. */
  function run({ changedPaths, author = 'agent-bot', directedBy = DIRECTOR, reviews, assessment = NO_PEER }) {
    const paths = HANDLERS.paths({
      changedPaths,
      declaration: { sourceSha: BASE, sensitive: policy.sensitivePaths, high: policy.highPaths },
      baseSha: BASE,
    });
    const tierPayload = { kinds: [{ kind: 'product', paths: changedPaths }], paths, policy, author };
    if (assessment !== OMIT) tierPayload.secondAssessment = assessment;
    const tier = HANDLERS.tier(tierPayload);
    const approvals = HANDLERS.approvals({
      reviews: reviews === undefined ? [approval(directedBy)] : reviews,
      headSha: HEAD,
      tier,
      policy,
      author,
      directedBy,
      agentAuthored: true,
    });
    const gate = HANDLERS.gate({
      ledger: [],
      approvals,
      tier,
      description: HANDLERS.description({ body: DESCRIPTION, agentAuthored: false }),
      security: { status: 'clean', findings: [] },
      headSha: HEAD,
    });
    return { paths, tier, approvals, gate };
  }

  test('the policy this repository ships turns the rule on for one maintainer', () => {
    expect(policy).toMatchObject({ soloMaintainer: true, maintainerLogins: ['@ldangelo'] });
  });

  test('a library change the maintainer directed and approved, written by someone else, merges with one human', () => {
    const { tier, approvals, gate } = run({ changedPaths: LIB });
    expect(tier).toMatchObject({ ok: true, effectiveTier: 'high', soloMaintainer: { eligible: true, login: DIRECTOR } });
    expect(approvals).toMatchObject({ satisfied: true, humansRequired: 1, soloMaintainer: true });
    expect(gate).toMatchObject({ mergeable: true, blockers: [] });
  });

  test.each([
    ['names the maintainer but has no review from them', { reviews: [] }],
    ['was written by an outsider who names the maintainer', { author: 'mallory', reviews: [] }],
    ["was written by the maintainer's own login", { author: 'ldangelo' }],
    ['had no second assessment', { assessment: OMIT }],
    ['had a null second assessment', { assessment: null }],
  ])('a PR that %s keeps two humans', (_label, overrides) => {
    const { approvals, gate } = run({ changedPaths: LIB, ...overrides });
    expect(approvals).toMatchObject({ satisfied: false, humansRequired: 2, soloMaintainer: false });
    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate)).toContain(BLOCKER_CODES.APPROVALS_UNSATISFIED);
  });

  test.each([
    '.ensemble/local-ci.yaml',
    'packages/development/lib/local-ci-runner.js',
    'packages/pi/vendor/lib/pr-review-gate.js',
    'packages/pi/vendor/lib/local-ci-status.js',
    'packages/development/skills/pr-review-cycle/reference/merge-gate.md',
    'packages/pi/skills/pr-review-cycle/reference/merge-gate.md',
    'packages/development/skills/pr-review-cycle/reference/scope-guidance-depth.md',
    'packages/pi/skills/pr-review-cycle/reference/scope-guidance-depth.md',
    'packages/git/commands/pr-merge.yaml',
    'packages/full/lib/pr-review-gate.js',
    'packages/full/lib/local-ci-runner.js',
    'packages/development/lib/pr-review-gate',
    'packages/development/lib/local-ci-runner.mjs',
    'packages/development/lib/PR-REVIEW-GATE.JS',
    'packages/pi/vendor/lib/pr-review-gate.cjs',
    'packages/development/skills/pr-review-cycle/SKILL.md',
    'packages/development/skills/pr-review-cycle/reference/inputs.md',
    'packages/pi/skills/pr-review-cycle/SKILL.md',
    'packages/full/skills/pr-review-cycle',
    'packages/git/commands/ensemble/pr-merge.md',
    'packages/pi/prompts/ensemble-pr-merge.md',
    'packages/pi/skills/ensemble-pr-merge/SKILL.md',
    'packages/codex/.codex/skills/commands/ensemble-pr-merge/SKILL.md',
    'scripts/ci-local.js',
  ])('%s is a guard: a PR that also changes it keeps two humans', (guard) => {
    const { tier, gate } = run({ changedPaths: [...LIB, guard] });
    expect(tier.paths.sensitive).toContain(guard);
    expect(tier.soloMaintainer).toEqual({ eligible: false, login: null });
    expect(gate.mergeable).toBe(false);
  });

  test('a vendored copy of an ordinary library is not a guard: the discount stays', () => {
    const { tier, gate } = run({ changedPaths: [...LIB, 'packages/pi/vendor/lib/trd-parser.js'] });
    expect(tier.paths.sensitive).toEqual([]);
    expect(tier.soloMaintainer.eligible).toBe(true);
    expect(gate.mergeable).toBe(true);
  });

  test('a changed-path list holding a name git quoted keeps two humans', () => {
    const { tier, gate } = run({ changedPaths: [...LIB, '".github/workflows/\\303\\251.yml"'] });
    expect(tier.warnings).toContain('non-verbatim-changed-path');
    expect(tier.soloMaintainer).toEqual({ eligible: false, login: null });
    expect(gate.mergeable).toBe(false);
  });

  test.each([
    ['a line separator (U+2028)', '\u2028'],
    ['a paragraph separator (U+2029)', '\u2029'],
    ['a next-line character (U+0085)', '\u0085'],
  ])('a workflow whose name holds %s keeps two humans: a sensitive path in a list that is no verbatim one', (_label, character) => {
    const workflow = `.github/workflows/ev${character}il.yml`;
    const { tier, gate } = run({ changedPaths: [...LIB, workflow] });
    expect(tier.paths.sensitive).toContain(workflow);
    expect(tier.warnings).toContain('non-verbatim-changed-path');
    expect(tier.soloMaintainer).toEqual({ eligible: false, login: null });
    expect(gate.mergeable).toBe(false);
  });

  test('a High path whose name holds a line separator is still graded High, not waved through as Medium', () => {
    const { paths, tier } = run({ changedPaths: ['packages/development/lib/a\u2028b.js'] });
    expect(paths.high).toEqual(['packages/development/lib/a\u2028b.js']);
    expect(tier.effectiveTier).toBe('high');
  });
});

describe('solo maintainer: every description of the rule names the authenticated director', () => {
  const read = (file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const rowOf = (file) => read(file).split('\n').find((line) => line.startsWith('| `soloMaintainer`'));

  test.each(['REVIEW.md', 'README.md', 'docs/guides/user-guide.md'])(
    '%s: the policy row says who must approve, and that the maintainer must not be the author',
    (file) => {
      const row = rowOf(file);
      expect(row).toBeDefined();
      expect(row).toContain("not the PR's author");
      expect(row).toContain('has approved the current head on the host');
      expect(row).toContain('`Directed by:` line alone never lowers');
    }
  );

  test('the CHANGELOG entry says the same', () => {
    const entry = read('CHANGELOG.md').split('\n').find((line) => line.includes('`soloMaintainer` review policy key'));
    expect(entry).toContain("is not the PR's author and has approved the current head on the host");
    expect(entry).toContain('never lowers the requirement');
  });

  test('the skill says a Directed by line is a claim: the inputs table and the gate reference', () => {
    expect(readSkillReference('inputs.md')).toContain('it never lowers a floor by itself');
    expect(readSkillReference('merge-gate.md').replace(/\s+/g, ' ')).toContain(
      'A `Directed by:` line alone never lowers the floor.'
    );
  });

  test('the warnings the gate reference names are exactly the ones the evaluator emits when it refuses', () => {
    const named = new Set(readSkillReference('merge-gate.md').match(/solo-maintainer-[a-z-]+/g));
    const tier = tierFor(HIGH_PATHS);
    const emitted = new Set(
      [
        ...approvalsFor(tier, { reviews: [] }).warnings,
        ...approvalsFor(tier, { author: 'maintainer-m' }).warnings,
        ...approvalsFor(tier, { author: null }).warnings,
      ].filter((warning) => warning.startsWith('solo-maintainer-'))
    );
    expect([...named].sort()).toEqual([...emitted].sort());
    expect(named.size).toBe(3);
  });
});
