'use strict';

/**
 * TRD-027-TEST: pr-merge refuses an unready PR (PRD scenarios).
 *
 * Verifies TRD-027 (`MODE=gate` in the pr-review-cycle skill and pr-merge's
 * binding to it). Satisfies REQ-012, REQ-013, REQ-014, REQ-017, REQ-008.
 * Validates PRD ACs: AC-012-3, AC-013-2, AC-014-3, AC-017-1, AC-008-1.
 *
 *   - AC-012-3 Given a second assessment indicates a Low or Medium PR
 *     nonetheless needs another person, when it is evaluated, then the tier is
 *     raised.
 *   - AC-013-2 Given an agent or the author proposes a tier, when it is lower
 *     than the assigned tier, then it is ignored; only a code owner can lower
 *     a tier.
 *   - AC-014-3 Given an agent authored a PR on a person's instruction, when
 *     approvals are counted, then that person counts as one of the required
 *     reviewers, as if they had written the code themselves.
 *   - AC-017-1 Given a PR is reviewed, when the security review finds an
 *     issue, then merge is blocked until it is fixed or closed with a stated
 *     reason.
 *   - AC-008-1 Given an Important finding is open, when merge is attempted,
 *     then it is refused and names the open finding.
 *
 * WHAT MAKES THIS DIFFERENT from the suites it sits beside. TRD-027 owns the
 * prose contract (pr-review-gate-mode-skill.test.js parses the skill and the
 * command YAML). TRD-025-TEST owns `evaluateGate`'s blockers in isolation
 * (pr-review-gate-scenarios.test.js). Neither runs the thing this task is
 * named after. Here every scenario runs the WHOLE `MODE=gate` pipeline the
 * skill performs, in the skill's own order --
 *
 *     classifyPaths -> CLI `tier` -> CLI `approvals` -> CLI `gate`
 *
 * -- with the three graded steps executed as the REAL `pr-review-cli.js`
 * binary in a child process, exactly as the skill invokes them. A scenario
 * therefore cannot pass against a payload shape the gate would never receive,
 * and it cannot pass by calling a function the shipped procedure never calls.
 *
 * Every scenario starts from ONE ready PR that really does merge, changes
 * exactly the thing it is proving, and asserts the refusal. The ready case is
 * asserted too: a rule proven only in the refusing direction would be
 * satisfied by a gate that refuses everything.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-027-test
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { classifyPaths } = require('../lib/pr-review-paths');
const { checkDescription } = require('../lib/pr-review-description');
const { recordResolution } = require('../lib/pr-review-ledger');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

const BASE = 'e'.repeat(40);
const HEAD = 'a'.repeat(40);
const TREE = 'd'.repeat(40);

const CHANGED = ['src/app.js'];
const POLICY = Object.freeze({ botLogins: ['coderabbitai', 'github-actions'] });

/**
 * One real CLI invocation: the subcommand the skill names, JSON in on stdin,
 * JSON out on stdout. A non-zero exit is a test failure, never a silent `{}`.
 */
function cli(subcommand, payload) {
  const run = spawnSync('node', [CLI, subcommand], { input: JSON.stringify(payload), encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`pr-review-cli ${subcommand} exited ${run.status}: ${run.stdout}${run.stderr}`);
  }
  return JSON.parse(run.stdout);
}

const DESCRIPTION_SECTIONS = [
  '## Summary',
  '',
  'Adds the widget.',
  '',
  '## Testing',
  '',
  '`npx jest` in packages/development.',
  '',
  '## Risk',
  '',
  'Low. One module.',
  '',
  '## How to revert',
  '',
  'Revert the commit.',
  '',
];

const FULL_DESCRIPTION = DESCRIPTION_SECTIONS.join('\n');

/**
 * An agent-authored PR must also carry the `Directed by:` line -- that line is
 * where AC-014-3's "on a person's instruction" is recorded, so a description
 * without it is not ready regardless of approvals.
 */
const directedDescription = (login) => [...DESCRIPTION_SECTIONS, `Directed by: @${login}`, ''].join('\n');

/** A finding as a reviewer would really record it: every required field present. */
function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'src/app.js:12',
    severity: 'important',
    failureMode: 'unvalidated input reaches the writer',
    disposition: 'fix',
    evidence: 'line 12 writes payload.body without checking it',
    originalTextOrLink: 'https://example.invalid/pr/1#discussion_r1',
    headSha: HEAD,
    ...overrides,
  };
}

/**
 * Runs the gate the way `MODE=gate` does, and returns every intermediate
 * result so a scenario can assert the step it is about as well as the verdict.
 *
 * `kinds` and `secondAssessment` stand in for the two fresh-context subagents
 * (the classifier and the "needs another person" assessment) -- their output
 * contract, not their prose, is what this pipeline consumes.
 */
function runGate(options = {}) {
  const {
    kinds = [{ kind: 'product', paths: CHANGED }],
    secondAssessment = { needsAnotherPerson: false, reason: 'single module, covered by tests', evidencePaths: [] },
    proposedTier,
    proposedBy,
    author = 'author-a',
    agentAuthored = false,
    directedBy,
    reviews = [{ author: 'human-a', state: 'APPROVED', commitSha: HEAD, treeSha: TREE }],
    ledger = [],
    security = { status: 'clean', findings: [] },
    description = agentAuthored && directedBy !== undefined ? directedDescription(directedBy) : FULL_DESCRIPTION,
  } = options;

  const paths = classifyPaths({ changedPaths: CHANGED, baseSha: BASE, sourceSha: BASE });

  const tierRequest = { paths, kinds, secondAssessment, author, assignedBy: 'change-classifier' };
  if (proposedTier !== undefined) tierRequest.proposedTier = proposedTier;
  if (proposedBy !== undefined) tierRequest.proposedBy = proposedBy;
  const tier = cli('tier', tierRequest);

  const approvalRequest = { reviews, headSha: HEAD, headTreeSha: TREE, tier, policy: POLICY, author };
  if (agentAuthored) approvalRequest.agentAuthored = true;
  if (directedBy !== undefined) approvalRequest.directedBy = directedBy;
  const approvals = cli('approvals', approvalRequest);

  const gate = cli('gate', {
    ledger,
    approvals,
    tier,
    description: checkDescription({ body: description, agentAuthored }),
    security,
    headSha: HEAD,
  });

  return { tier, approvals, gate };
}

const codesOf = (gate) => gate.blockers.map((entry) => entry.code);
const blockerOf = (gate, code) => gate.blockers.find((entry) => entry.code === code);

// ---------------------------------------------------------------------------
// The control: a PR that really is ready really does merge
// ---------------------------------------------------------------------------

describe('TRD-027-TEST control: a ready PR passes the gate', () => {
  test('one human approval bound to the head, no findings, clean security: mergeable', () => {
    const { gate, tier, approvals } = runGate();

    expect(gate.mergeable).toBe(true);
    expect(gate.blockers).toEqual([]);
    expect(tier.effectiveTier).toBe('medium');
    expect(approvals.satisfied).toBe(true);
    expect(approvals.humansCounted).toBe(1);
  });

  test('every blocker the scenarios below rely on really can fire on this same PR', () => {
    // Guards the control itself: if the pipeline silently stopped grading,
    // every scenario would "pass" by refusing nothing.
    const broken = runGate({ reviews: [], security: { status: 'not-run' }, ledger: [finding()] });
    expect(broken.gate.mergeable).toBe(false);
    expect(broken.gate.blockers.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// AC-012-3 -- the second assessment raises the tier
// ---------------------------------------------------------------------------

describe('Scenario AC-012-3: a second assessment that says "needs another person" raises the tier', () => {
  const DOCS_KINDS = [{ kind: 'docs', paths: CHANGED }];
  const NEEDS_ANOTHER = {
    needsAnotherPerson: true,
    reason: 'it changes the auth contract the doc describes',
    evidencePaths: CHANGED,
  };

  test('a LOW PR is raised to Medium, and the raise is recorded with its reason', () => {
    const { tier } = runGate({ kinds: DOCS_KINDS, secondAssessment: NEEDS_ANOTHER });

    expect(tier.originalTier).toBe('low');
    expect(tier.finalTier).toBe('medium');
    expect(tier.raised).toEqual([
      expect.objectContaining({ from: 'low', to: 'medium', reason: NEEDS_ANOTHER.reason }),
    ]);
  });

  test('negative control: the same Low PR without the assessment is not raised', () => {
    const { tier } = runGate({ kinds: DOCS_KINDS });

    expect(tier.originalTier).toBe('low');
    expect(tier.finalTier).toBe('low');
    expect(tier.raised).toEqual([]);
  });

  test('a MEDIUM PR is raised to High, and the merge that would have passed is now refused', () => {
    // The consequence a person actually feels. One human approval satisfies
    // Medium; the raise to High demands two, so the very same approved PR
    // stops being mergeable.
    const approved = [{ author: 'human-a', state: 'APPROVED', commitSha: HEAD, treeSha: TREE }];

    const before = runGate({ reviews: approved });
    expect(before.tier.finalTier).toBe('medium');
    expect(before.approvals.humansRequired).toBe(1);
    expect(before.gate.mergeable).toBe(true);

    const after = runGate({ reviews: approved, secondAssessment: NEEDS_ANOTHER });
    expect(after.tier.originalTier).toBe('medium');
    expect(after.tier.finalTier).toBe('high');
    expect(after.tier.raised).toEqual([expect.objectContaining({ from: 'medium', to: 'high' })]);

    expect(after.approvals.humansRequired).toBe(2);
    expect(after.approvals.humansCounted).toBe(1);
    expect(after.gate.mergeable).toBe(false);
    expect(codesOf(after.gate)).toContain('approvals-unsatisfied');
    expect(blockerOf(after.gate, 'approvals-unsatisfied').nextAction).toMatch(/\S/);
  });

  test('the raised PR merges once the second person the raise demanded has approved', () => {
    const { gate } = runGate({
      secondAssessment: NEEDS_ANOTHER,
      reviews: [
        { author: 'human-a', state: 'APPROVED', commitSha: HEAD, treeSha: TREE },
        { author: 'human-b', state: 'APPROVED', commitSha: HEAD, treeSha: TREE },
      ],
    });

    expect(gate.mergeable).toBe(true);
  });

  test('an assessment the gate cannot read raises rather than assuming "no"', () => {
    // Fail closed: an unreadable answer must not become the permissive one.
    const { tier } = runGate({ secondAssessment: { needsAnotherPerson: 'maybe' } });

    expect(tier.finalTier).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// AC-013-2 -- raise-only: a proposal can never lower the tier
// ---------------------------------------------------------------------------

describe('Scenario AC-013-2: a tier proposed below the assigned tier is ignored unless a code owner makes it', () => {
  test('the author proposing Low on a Medium PR is ignored, and the Medium duty still stands', () => {
    const { tier, gate } = runGate({
      proposedTier: 'low',
      proposedBy: { login: 'author-a', isCodeOwner: false },
      reviews: [],
    });

    expect(tier.finalTier).toBe('medium');
    expect(tier.lowered).toEqual([]);
    expect(tier.ignored).toEqual([
      expect.objectContaining({ proposedTier: 'low', by: 'author-a', reason: 'lowering-needs-code-owner' }),
    ]);

    // Ignored in substance, not only in the record: the approval the Medium
    // tier requires is still required, so the merge is refused.
    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate)).toContain('approvals-unsatisfied');
  });

  test('an agent proposing Low is ignored the same way: the rule is about authority, not identity', () => {
    const { tier } = runGate({
      proposedTier: 'low',
      proposedBy: { login: 'assistant-bot', isCodeOwner: false },
      agentAuthored: true,
      reviews: [],
    });

    expect(tier.finalTier).toBe('medium');
    expect(tier.ignored).toEqual([expect.objectContaining({ reason: 'lowering-needs-code-owner' })]);
  });

  test('a code owner proposing Low DOES lower it, and the record says who', () => {
    const { tier } = runGate({
      proposedTier: 'low',
      proposedBy: { login: 'owner-o', isCodeOwner: true },
      reviews: [],
    });

    expect(tier.finalTier).toBe('low');
    expect(tier.lowered).toEqual([expect.objectContaining({ from: 'medium', to: 'low', by: 'owner-o' })]);
  });

  test('even a code owner\'s Low does not escape the human approval: Low is treated as Medium', () => {
    // REQ-013's "strict by default". Lowering the ASSIGNED tier is the code
    // owner's call, but the EFFECTIVE tier stays Medium unless the Low waiver
    // is enabled with its evidence -- so the merge is still refused. Asserting
    // only `finalTier` would have missed that the duty survives the lowering.
    const { tier, gate } = runGate({
      proposedTier: 'low',
      proposedBy: { login: 'owner-o', isCodeOwner: true },
      reviews: [],
    });

    expect(tier.effectiveTier).toBe('medium');
    expect(tier.waiver).toEqual(expect.objectContaining({ applies: false }));
    expect(tier.humansRequired).toBe(1);
    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate)).toContain('approvals-unsatisfied');
  });

  test('raising is open to anyone: the rule restricts lowering only', () => {
    const { tier } = runGate({ proposedTier: 'high', proposedBy: { login: 'author-a', isCodeOwner: false } });

    expect(tier.finalTier).toBe('high');
    expect(tier.raised).toEqual([expect.objectContaining({ from: 'medium', to: 'high' })]);
  });
});

// ---------------------------------------------------------------------------
// AC-014-3 -- the person who directed an agent-authored PR counts
// ---------------------------------------------------------------------------

describe('Scenario AC-014-3: the person who directed an agent-authored PR counts as a required reviewer', () => {
  const AGENT = 'assistant-bot';

  test('an agent-authored PR directed by a person: that person fills the required slot and it merges', () => {
    const { approvals, gate } = runGate({
      author: AGENT,
      agentAuthored: true,
      directedBy: 'alice',
      reviews: [],
    });

    expect(approvals.satisfied).toBe(true);
    expect(approvals.directedBy).toBe('alice');
    expect(approvals.approvedBy).toContain('alice');
    expect(gate.mergeable).toBe(true);
  });

  test('the same agent-authored PR with nobody named as the director: refused', () => {
    const { approvals, gate } = runGate({ author: AGENT, agentAuthored: true, reviews: [] });

    expect(approvals.satisfied).toBe(false);
    expect(approvals.humansCounted).toBe(0);
    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate)).toContain('approvals-unsatisfied');
  });

  test('a director named on a PR that an agent did NOT author does not count', () => {
    // "As if they had written the code themselves" is the whole justification:
    // it applies to an agent-authored PR, so it cannot be borrowed elsewhere.
    const { approvals, gate } = runGate({ author: 'author-a', agentAuthored: false, directedBy: 'alice', reviews: [] });

    expect(approvals.satisfied).toBe(false);
    expect(gate.mergeable).toBe(false);
  });

  test('a bot approval never fills the slot the director filled', () => {
    const { approvals, gate } = runGate({
      author: AGENT,
      agentAuthored: true,
      reviews: [{ author: 'coderabbitai', state: 'APPROVED', commitSha: HEAD, treeSha: TREE, isBot: true }],
    });

    expect(approvals.ignored).toEqual([expect.objectContaining({ login: 'coderabbitai', reason: 'automated' })]);
    expect(approvals.satisfied).toBe(false);
    expect(gate.mergeable).toBe(false);
  });

  test('on a High-tier agent-authored PR the director fills ONE slot, not all of them', () => {
    const { approvals, gate } = runGate({
      author: AGENT,
      agentAuthored: true,
      directedBy: 'alice',
      proposedTier: 'high',
      proposedBy: { login: 'alice', isCodeOwner: false },
      reviews: [],
    });

    expect(approvals.humansRequired).toBe(2);
    expect(approvals.humansCounted).toBe(1);
    expect(gate.mergeable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-017-1 -- the security lane blocks until fixed or closed with a reason
// ---------------------------------------------------------------------------

describe('Scenario AC-017-1: a security finding blocks the merge until it is fixed or closed with a stated reason', () => {
  const securityFinding = finding({
    id: 'SEC-1',
    source: 'security-lane',
    severity: 'important',
    failureMode: 'the token is logged in plain text',
    locationOrLink: 'src/app.js:40',
  });

  test('the security review found an issue: the merge is refused and the finding is named', () => {
    const { gate } = runGate({ security: { status: 'findings', findings: [securityFinding] } });

    expect(gate.mergeable).toBe(false);
    const blocker = gate.blockers.find((entry) => /security/i.test(entry.code));
    expect(blocker).toBeDefined();
    expect(JSON.stringify(blocker)).toContain('SEC-1');
    expect(blocker.nextAction).toMatch(/\S/);
  });

  test('closed with a stated reason: the reason is recorded and the merge proceeds', () => {
    const resolved = recordResolution(securityFinding, {
      reason: 'the value logged is the request id, not the token; renamed to make that plain',
      by: 'owner-o',
      headSha: HEAD,
      at: '2026-11-06T10:00:00Z',
    });
    expect(resolved.ok).toBe(true);

    const { gate } = runGate({ security: { status: 'clean', findings: [] }, ledger: [resolved.finding] });

    expect(gate.mergeable).toBe(true);
  });

  test('"closed" with NO stated reason records nothing, and the merge is still refused', () => {
    const refused = recordResolution(securityFinding, { reason: '   ' });
    expect(refused.ok).toBe(false);

    const { gate } = runGate({ security: { status: 'findings', findings: [securityFinding] } });
    expect(gate.mergeable).toBe(false);
  });

  test('a security lane that never ran is refused, never assumed clean', () => {
    const { gate } = runGate({ security: { status: 'not-run' } });

    expect(gate.mergeable).toBe(false);
    expect(codesOf(gate).some((code) => /security/i.test(code))).toBe(true);
  });

  test('a lane result that could not be collected is refused as missing data, never passed', () => {
    const { gate } = runGate({ security: { status: 'unavailable', reason: 'the reviewer timed out' } });

    expect(gate.mergeable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-008-1 -- an open Important finding refuses the merge, by name
// ---------------------------------------------------------------------------

describe('Scenario AC-008-1: an open Important finding refuses the merge and names it', () => {
  test('merge attempted with the finding still open: refused, and the finding is named', () => {
    const open = finding({ id: 'F-OPEN' });
    const { gate } = runGate({ ledger: [open] });

    expect(gate.mergeable).toBe(false);
    expect(gate.findings.open).toContain('F-OPEN');
    const blocker = gate.blockers.find((entry) => JSON.stringify(entry).includes('F-OPEN'));
    expect(blocker).toBeDefined();
    expect(blocker.nextAction).toMatch(/\S/);
  });

  test('the same PR once that finding is answered with a recorded reason: it merges', () => {
    const answered = recordResolution(finding({ id: 'F-OPEN' }), {
      reason: 'validated at the call site in the same commit',
      by: 'author-a',
      headSha: HEAD,
      at: '2026-11-06T10:00:00Z',
    });

    const { gate } = runGate({ ledger: [answered.finding] });
    expect(gate.mergeable).toBe(true);
  });

  test('a Nit left open does not block: the rule is about Important findings', () => {
    const { gate } = runGate({ ledger: [finding({ id: 'F-NIT', severity: 'nit' })] });

    expect(gate.mergeable).toBe(true);
  });

  test('several open findings are ALL named, so a second round is not a surprise', () => {
    const { gate } = runGate({
      ledger: [finding({ id: 'F-1' }), finding({ id: 'F-2', locationOrLink: 'src/app.js:30' })],
    });

    expect(gate.mergeable).toBe(false);
    expect(gate.findings.open).toEqual(expect.arrayContaining(['F-1', 'F-2']));
  });

  test('a finding whose severity the gate cannot read blocks: unknown is not a Nit', () => {
    const { gate } = runGate({ ledger: [finding({ id: 'F-ODD', severity: 'spicy' })] });

    expect(gate.mergeable).toBe(false);
  });
});
