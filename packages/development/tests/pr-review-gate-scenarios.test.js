'use strict';

/**
 * TRD-025-TEST: Merge gate blockers (PRD scenarios).
 *
 * Verifies TRD-025 (`lib/pr-review-gate.js`).
 * Validates PRD ACs: AC-008-1, AC-008-4 (REQ-008), AC-017-1, AC-017-2,
 * AC-017-3 (REQ-017), AC-002-3 (REQ-002).
 *
 * The field-level behavior of `evaluateGate` is covered by
 * pr-review-gate.test.js (TRD-025) and is never re-stated here. These are the
 * REQUIREMENT-level scenarios: a whole PR as it would really arrive at the
 * merge step, graded once, and the verdict a person would act on asserted.
 *
 * Two deliberate differences from the implementation suite:
 *
 *   - the approvals, tier and description inputs are produced by the REAL
 *     `classifyPaths` -> `assignTier` -> `effectiveTier` -> `evaluateApprovals`
 *     chain and the real `checkDescription`, never hand-built literals, so a
 *     scenario cannot pass against a shape the gate would never receive;
 *   - the security lane transitions use the real ledger helpers
 *     (`recordResolution`, `clearFixedFindings`), so "closed with a reason"
 *     and "a later commit fixed it" are the recorded states, not assertions
 *     about them.
 *
 * Every scenario carries the case that must be REFUSED next to the case that
 * merges: no rule here is proven only in the direction that permits a merge.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-025-test
 */

const { evaluateGate, BLOCKER_CODES } = require('../lib/pr-review-gate');
const { evaluateApprovals } = require('../lib/pr-review-approvals');
const { assignTier, effectiveTier } = require('../lib/pr-review-tier');
const { classifyPaths } = require('../lib/pr-review-paths');
const { checkDescription } = require('../lib/pr-review-description');
const { recordResolution, clearFixedFindings } = require('../lib/pr-review-ledger');

const BASE = 'e'.repeat(40);
const HEAD = 'a'.repeat(40);
const OLDER_COMMIT = 'c'.repeat(40);

const POLICY = Object.freeze({
  botLogins: ['coderabbitai'],
  maintainerLogins: ['maintainer-m'],
});

/**
 * A PR description a person would really write, with all three sections. It is graded with
 * `agentAuthored: false`: only an explicit false says a person wrote it.
 */
const FULL_DESCRIPTION = [
  '## Summary',
  '',
  'Adds the merge gate scenarios.',
  '',
  '## Testing',
  '',
  '`npx jest tests/pr-review-gate` in packages/development.',
  '',
  '## Risk',
  '',
  'Low. Tests only.',
  '',
  '## How to revert',
  '',
  'Revert the commit.',
  '',
].join('\n');

/** Drops one section (heading and body) from a description body. */
function without(body, heading) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start === -1) throw new Error(`fixture has no "${heading}" section`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

/** The real tier chain for an ordinary product change: Medium. */
function mediumTier() {
  const changedPaths = ['packages/development/lib/widget.js'];
  const paths = classifyPaths({ changedPaths, baseSha: BASE });
  const assignment = assignTier({ paths, kinds: [{ kind: 'product', paths: changedPaths }] });
  return effectiveTier({ assignment, policy: POLICY, author: 'author-a' });
}

/** Real approvals: one person approving the current head satisfies Medium. */
function satisfiedApprovals(tier) {
  return evaluateApprovals({
    reviews: [{ author: 'human-a', state: 'APPROVED', commitSha: HEAD }],
    headSha: HEAD,
    tier,
    policy: POLICY,
    author: 'author-a',
  });
}

/** One finding as a reviewer would really record it. */
function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'packages/development/lib/widget.js:12',
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
 * The whole merge attempt: every input produced by the real chain, nothing to
 * answer, so the only thing a scenario changes is the thing it is proving.
 */
function mergeAttempt(overrides = {}) {
  const tier = mediumTier();
  return {
    headSha: HEAD,
    ledger: [],
    approvals: satisfiedApprovals(tier),
    tier,
    description: checkDescription({ body: FULL_DESCRIPTION, agentAuthored: false }),
    security: { status: 'clean', findings: [] },
    coverage: { status: 'complete', gaps: [] },
    ...overrides,
  };
}

const codesOf = (result) => result.blockers.map((entry) => entry.code);
const blockerOf = (result, code) => result.blockers.find((entry) => entry.code === code);

describe('Scenario AC-008-1: an open Important finding refuses the merge and names it', () => {
  test('merge is attempted with an Important finding still open: refused, and the finding is named', () => {
    const open = finding({ id: 'F-7', locationOrLink: 'packages/development/lib/widget.js:31' });
    const result = evaluateGate(mergeAttempt({ ledger: [open] }));

    expect(result.ok).toBe(true);
    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain(BLOCKER_CODES.OPEN_IMPORTANT_FINDING);

    const refusal = blockerOf(result, BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
    expect(refusal.findingId).toBe('F-7');
    expect(refusal.message).toContain('F-7');
    expect(refusal.message).toContain('packages/development/lib/widget.js:31');
    expect(refusal.nextAction).toEqual(expect.any(String));
    expect(result.findings.open).toEqual(['F-7']);
  });

  test('the same PR once that finding is answered with a recorded reason: it merges', () => {
    const answered = recordResolution(finding({ id: 'F-7' }), {
      reason: 'intentional: the caller validates the payload, see REVIEW.md',
      by: 'author-a',
      headSha: HEAD,
      at: '2026-11-06T10:00:00Z',
    });
    expect(answered.ok).toBe(true);

    const result = evaluateGate(mergeAttempt({ ledger: [answered.finding] }));

    expect(result.mergeable).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test('a finding "closed" with no stated reason is NOT an answer: the merge is still refused', () => {
    const noReason = recordResolution(finding({ id: 'F-7' }), { by: 'author-a' });
    expect(noReason.ok).toBe(false);

    const result = evaluateGate(mergeAttempt({ ledger: [noReason.finding] }));

    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain(BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
  });
});

describe('Scenario AC-008-4: a Nit or Pre-existing finding does not block the merge', () => {
  test('only Nit and Pre-existing findings are open: the merge proceeds', () => {
    const nit = finding({ id: 'N-1', severity: 'nit', failureMode: 'name reads oddly' });
    const preExisting = finding({ id: 'P-1', severity: 'pre-existing', failureMode: 'old helper lacks a test' });

    const result = evaluateGate(mergeAttempt({ ledger: [nit, preExisting] }));

    expect(result.mergeable).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.findings.nits).toBe(1);
    expect(result.findings.preExisting).toBe(1);
    expect(result.warnings).toContain('open-nits-not-blocking');
  });

  test('the same ledger with one Important finding added: refused, so "does not block" is not "nothing blocks"', () => {
    const nit = finding({ id: 'N-1', severity: 'nit', failureMode: 'name reads oddly' });
    const important = finding({ id: 'F-2' });

    const result = evaluateGate(mergeAttempt({ ledger: [nit, important] }));

    expect(result.mergeable).toBe(false);
    expect(result.findings.open).toEqual(['F-2']);
  });

  test('a finding whose severity the gate cannot read is treated as Important, not as a Nit', () => {
    const odd = finding({ id: 'F-3', severity: 'cosmetic-ish' });

    const result = evaluateGate(mergeAttempt({ ledger: [odd] }));

    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain(BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING);
  });
});

describe('Scenario AC-017-1: the security lane blocks the merge until the issue is fixed or closed with a reason', () => {
  const securityFinding = (overrides = {}) =>
    finding({
      id: 'S-1',
      source: 'security-reviewer',
      locationOrLink: 'packages/development/lib/widget.js:44',
      failureMode: 'the token is logged in plain text',
      evidence: 'line 44 passes the bearer token to console.log',
      ...overrides,
    });

  test('the security review found an issue: merge is refused and the finding is named', () => {
    const result = evaluateGate(
      mergeAttempt({ security: { status: 'findings', findings: [securityFinding()] } })
    );

    expect(result.mergeable).toBe(false);
    const refusal = blockerOf(result, BLOCKER_CODES.SECURITY_FINDING_OPEN);
    expect(refusal.findingId).toBe('S-1');
    expect(refusal.message).toContain('packages/development/lib/widget.js:44');
    expect(result.securityLane.open).toEqual(['S-1']);
  });

  test('the security review ran and found nothing: the merge proceeds', () => {
    const result = evaluateGate(mergeAttempt({ security: { status: 'clean', findings: [] } }));

    expect(result.mergeable).toBe(true);
    expect(result.securityLane.status).toBe('clean');
  });

  test('the security review never ran on a Medium PR: the merge is refused rather than assumed clean', () => {
    const result = evaluateGate(mergeAttempt({ security: { status: 'not-run' } }));

    expect(result.mergeable).toBe(false);
    expect(blockerOf(result, BLOCKER_CODES.SECURITY_REVIEW_MISSING).tier).toBe('medium');
  });

  test('the lane result could not be collected: the merge is refused as unavailable data, never passed', () => {
    const result = evaluateGate(
      mergeAttempt({ security: { status: 'unavailable', reason: 'gh was rate-limited' } })
    );

    expect(result.mergeable).toBe(false);
    const refusal = blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE);
    expect(refusal.message).toContain('gh was rate-limited');
    expect(refusal.nextAction).toEqual(expect.any(String));
  });

  describe('Scenario AC-017-2: a later commit fixes the issue and the finding clears on re-review', () => {
    const NEW_HEAD = 'f'.repeat(40);

    /** The same merge attempt, re-run against a later head. */
    const atNewHead = (ledger) => {
      const tier = mediumTier();
      return {
        headSha: NEW_HEAD,
        ledger: [],
        approvals: evaluateApprovals({
          reviews: [{ author: 'human-a', state: 'APPROVED', commitSha: NEW_HEAD }],
          headSha: NEW_HEAD,
          tier,
          policy: POLICY,
          author: 'author-a',
        }),
        tier,
        description: checkDescription({ body: FULL_DESCRIPTION, agentAuthored: false }),
        security: { status: 'findings', findings: ledger },
        coverage: { status: 'complete', gaps: [] },
      };
    };

    test('the later commit changed the line the finding cited and no reviewer reported it again: it clears itself', () => {
      const recorded = [securityFinding({ headSha: OLDER_COMMIT })];
      const cleared = clearFixedFindings({
        ledger: recorded,
        changedLocations: ['packages/development/lib/widget.js:44'],
        reReported: [],
        headSha: NEW_HEAD,
      });
      expect(cleared.ok).toBe(true);
      expect(cleared.cleared).toEqual(['S-1']);

      const result = evaluateGate(atNewHead(cleared.findings));

      expect(result.mergeable).toBe(true);
      expect(result.securityLane.cleared).toEqual(['S-1']);
      expect(result.securityLane.open).toEqual([]);
    });

    test('the later commit touched other code and the reviewer reported it again: it still blocks', () => {
      const recorded = [securityFinding({ headSha: OLDER_COMMIT })];
      const notCleared = clearFixedFindings({
        ledger: recorded,
        changedLocations: ['packages/development/lib/other.js:10'],
        reReported: [securityFinding({ headSha: NEW_HEAD })],
        headSha: NEW_HEAD,
      });
      expect(notCleared.cleared).toEqual([]);

      const result = evaluateGate(atNewHead(notCleared.findings));

      expect(result.mergeable).toBe(false);
      expect(result.securityLane.open).toEqual(['S-1']);
    });
  });

  describe('Scenario AC-017-3: a false positive closed with a reason is recorded in the ledger', () => {
    test('the author closes it with a stated reason: the reason is recorded and the merge proceeds', () => {
      const closed = recordResolution(securityFinding(), {
        reason: 'false positive: the logger redacts this value before writing',
        by: 'author-a',
        headSha: HEAD,
        at: '2026-11-06T10:00:00Z',
      });
      expect(closed.ok).toBe(true);
      expect(closed.finding.resolution.reason).toContain('false positive');
      expect(closed.finding.disposition).toBe('resolved');

      const result = evaluateGate(mergeAttempt({ security: { status: 'findings', findings: [closed.finding] } }));

      expect(result.mergeable).toBe(true);
      expect(result.securityLane.resolved).toEqual([
        { id: 'S-1', reason: 'false positive: the logger redacts this value before writing' },
      ]);
      expect(result.securityLane.open).toEqual([]);
    });

    test('the author closes it with no reason: nothing is recorded and the merge is still refused', () => {
      const closed = recordResolution(securityFinding(), { reason: '   ' });
      expect(closed.ok).toBe(false);

      const result = evaluateGate(
        mergeAttempt({ security: { status: 'findings', findings: [closed.finding] } })
      );

      expect(result.mergeable).toBe(false);
      expect(result.securityLane.resolved).toEqual([]);
      expect(result.securityLane.open).toEqual(['S-1']);
    });
  });
});

describe('Scenario AC-002-3: a description missing a section is not ready for approval and the section is named', () => {
  for (const [section, label] of [
    ['Testing', 'testing'],
    ['Risk', 'risk'],
    ['How to revert', 'how-to-revert'],
  ]) {
    test(`the description has no ${section} section: the merge is refused and names it`, () => {
      const description = checkDescription({ body: without(FULL_DESCRIPTION, section), agentAuthored: false });
      expect(description.ready).toBe(false);
      expect(description.missing).toContain(label);

      const result = evaluateGate(mergeAttempt({ description }));

      expect(result.mergeable).toBe(false);
      const refusal = result.blockers.find(
        (entry) => entry.code === BLOCKER_CODES.DESCRIPTION_SECTION_MISSING && entry.section === label
      );
      expect(refusal).toBeDefined();
      expect(refusal.message).toContain(label);
      expect(refusal.message).toContain('not ready for approval');
    });
  }

  test('the complete description on the same PR: no description blocker, so the rule is not "always refuse"', () => {
    const result = evaluateGate(mergeAttempt());

    expect(codesOf(result)).not.toContain(BLOCKER_CODES.DESCRIPTION_SECTION_MISSING);
    expect(result.mergeable).toBe(true);
  });

  test('a description that could not be read at all is refused as unavailable data, not passed', () => {
    const result = evaluateGate(mergeAttempt({ description: checkDescription({ body: 42 }) }));

    expect(result.mergeable).toBe(false);
    expect(blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE).missing).toEqual(
      expect.arrayContaining(['description'])
    );
  });
});
