'use strict';

/**
 * TRD-025: Implementation AC tests for `evaluateGate`
 * (packages/development/lib/pr-review-gate.js).
 *
 * In-process calls against the pure module. The PRD scenarios for REQ-008,
 * REQ-017 and REQ-002 belong to TRD-025-TEST and the `gate` CLI subcommand to
 * TRD-026; neither is anticipated here.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-025
 */

const { evaluateGate, BLOCKER_CODES } = require('../lib/pr-review-gate');

const HEAD = 'a'.repeat(40);

/** A ledger finding with every required field, overridable per test. */
function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'packages/development/lib/pr-review-gate.js:12',
    severity: 'important',
    failureMode: 'unchecked input reaches the gate',
    disposition: 'fix',
    evidence: 'line 12 reads payload.ledger without validating it',
    originalTextOrLink: 'https://example.invalid/pr/1#discussion_r1',
    ...overrides,
  };
}

/** An approvals result shaped the way `evaluateApprovals` returns one. */
function approvals(overrides = {}) {
  return {
    ok: true,
    headSha: HEAD,
    satisfied: true,
    reason: 'required-approvals-present',
    tier: 'medium',
    humansRequired: 1,
    humansCounted: 1,
    approvedBy: ['human-a'],
    directedBy: null,
    ignored: [],
    refusals: [],
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

/** A `checkDescription` result. */
function description(overrides = {}) {
  return {
    ok: true,
    missing: [],
    present: ['testing', 'risk', 'rollback'],
    empty: [],
    directedBy: null,
    agentAuthored: false,
    ready: true,
    warnings: [],
    ...overrides,
  };
}

/** An effective-tier result. */
function tier(word = 'medium', overrides = {}) {
  return {
    ok: true,
    tier: word,
    effectiveTier: word,
    humansRequired: { low: 0, medium: 1, high: 2 }[word],
    refusals: [],
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

/** The whole, clean input: every part present and nothing to answer. */
function cleanInput(overrides = {}) {
  return {
    headSha: HEAD,
    ledger: [],
    approvals: approvals(),
    tier: tier('medium'),
    description: description(),
    security: { status: 'clean', findings: [] },
    ...overrides,
  };
}

const codesOf = (result) => result.blockers.map((blocker) => blocker.code);
const blockerOf = (result, code) => result.blockers.find((blocker) => blocker.code === code);

describe('TRD-025 AC-1: mergeable only when findings, approvals and description all pass', () => {
  test('a complete, answered review is mergeable with no blockers', () => {
    const result = evaluateGate(cleanInput());

    expect(result.ok).toBe(true);
    expect(result.mergeable).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  test('an open Important finding refuses the merge and names the finding', () => {
    const result = evaluateGate(cleanInput({ ledger: [finding({ id: 'F-7' })] }));

    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain(BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
    const blocker = blockerOf(result, BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
    expect(blocker.findingId).toBe('F-7');
    expect(blocker.message).toContain('F-7');
    expect(blocker.message).toContain('packages/development/lib/pr-review-gate.js:12');
  });

  test('an Important finding answered with a recorded reason stops blocking', () => {
    const answered = finding({
      id: 'F-7',
      disposition: 'resolved',
      resolution: { reason: 'intentional, documented in REVIEW.md', by: 'maintainer-m', headSha: HEAD, at: '2026-11-06T10:00:00Z' },
    });
    const result = evaluateGate(cleanInput({ ledger: [answered] }));

    expect(result.mergeable).toBe(true);
    expect(result.findings.open).toEqual([]);
  });

  test('unsatisfied approvals block and name how many humans are still required', () => {
    const result = evaluateGate(
      cleanInput({ approvals: approvals({ satisfied: false, reason: 'insufficient-human-approvals', humansCounted: 0 }) })
    );

    expect(result.mergeable).toBe(false);
    const blocker = blockerOf(result, BLOCKER_CODES.APPROVALS_UNSATISFIED);
    expect(blocker.message).toContain('1');
    expect(blocker.reason).toBe('insufficient-human-approvals');
  });

  test('a missing description section blocks and names the section (AC-002-3)', () => {
    const result = evaluateGate(cleanInput({ description: description({ missing: ['rollback'], present: ['testing', 'risk'], ready: false }) }));

    expect(result.mergeable).toBe(false);
    const blocker = blockerOf(result, BLOCKER_CODES.DESCRIPTION_SECTION_MISSING);
    expect(blocker.section).toBe('rollback');
    expect(blocker.message).toContain('rollback');
  });

  test('every blocker carries a code, a message and a nextAction', () => {
    const result = evaluateGate(
      cleanInput({
        ledger: [finding({ id: 'F-9' })],
        approvals: approvals({ satisfied: false, humansCounted: 0 }),
        description: description({ missing: ['testing'], ready: false }),
        security: { status: 'findings', findings: [finding({ id: 'S-1', source: 'security-lane' })] },
      })
    );

    expect(result.mergeable).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(4);
    for (const blocker of result.blockers) {
      expect(typeof blocker.code).toBe('string');
      expect(blocker.message.trim()).not.toBe('');
      expect(blocker.nextAction.trim()).not.toBe('');
    }
  });
});

describe('TRD-025 AC-2: Nit and Pre-existing findings never block', () => {
  test('Nit and Pre-existing findings leave the gate mergeable and are still counted', () => {
    const result = evaluateGate(
      cleanInput({
        ledger: [
          finding({ id: 'N-1', severity: 'nit' }),
          finding({ id: 'N-2', severity: 'nitpick' }),
          finding({ id: 'P-1', severity: 'pre-existing' }),
        ],
      })
    );

    expect(result.mergeable).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.findings.nits).toBe(2);
    expect(result.findings.preExisting).toBe(1);
  });

  test('a finding whose severity cannot be read blocks: it is never waved through', () => {
    const result = evaluateGate(cleanInput({ ledger: [finding({ id: 'U-1', severity: 'spicy' })] }));

    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain(BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING);
    expect(blockerOf(result, BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING).findingId).toBe('U-1');
  });
});

describe('TRD-025 AC-3: the security lane blocks, clears and records its reasons', () => {
  const securityFinding = (overrides = {}) =>
    finding({ id: 'S-1', source: 'security-lane', failureMode: 'bearer token forwarded downstream', ...overrides });

  test('an open security finding blocks the merge and names it', () => {
    const result = evaluateGate(cleanInput({ security: { status: 'findings', findings: [securityFinding()] } }));

    expect(result.mergeable).toBe(false);
    const blocker = blockerOf(result, BLOCKER_CODES.SECURITY_FINDING_OPEN);
    expect(blocker.findingId).toBe('S-1');
    expect(result.securityLane.open).toEqual(['S-1']);
  });

  test('a security finding closed with a stated reason stops blocking and the reason is recorded (AC-017-3)', () => {
    const closed = securityFinding({
      disposition: 'resolved',
      resolution: {
        reason: 'false positive: the token never leaves the process',
        by: 'maintainer-m',
        headSha: HEAD,
        at: '2026-11-06T10:00:00Z',
      },
    });
    const result = evaluateGate(cleanInput({ security: { status: 'findings', findings: [closed] } }));

    expect(result.mergeable).toBe(true);
    expect(result.securityLane.resolved).toEqual([
      { id: 'S-1', reason: 'false positive: the token never leaves the process' },
    ]);
  });

  test('a security finding closed with no stated reason still blocks', () => {
    const unreasoned = securityFinding({ disposition: 'resolved', resolution: { reason: '   ' } });
    const result = evaluateGate(cleanInput({ security: { status: 'findings', findings: [unreasoned] } }));

    expect(result.mergeable).toBe(false);
    expect(blockerOf(result, BLOCKER_CODES.SECURITY_FINDING_OPEN).nextAction).toMatch(/reason/i);
  });

  test('a security finding a later head fixed clears on its own (AC-017-2)', () => {
    const cleared = securityFinding({ cleared: true });
    const result = evaluateGate(cleanInput({ security: { status: 'findings', findings: [cleared] } }));

    expect(result.mergeable).toBe(true);
    expect(result.securityLane.cleared).toEqual(['S-1']);
    expect(result.securityLane.open).toEqual([]);
  });

  test('a lane that did not run blocks Medium and High tiers', () => {
    for (const word of ['medium', 'high']) {
      const result = evaluateGate(
        cleanInput({
          tier: tier(word),
          approvals: approvals({ tier: word, humansRequired: word === 'high' ? 2 : 1, humansCounted: 2, approvedBy: ['a', 'b'] }),
          security: { status: 'not-run' },
        })
      );
      expect(result.mergeable).toBe(false);
      expect(codesOf(result)).toContain(BLOCKER_CODES.SECURITY_REVIEW_MISSING);
    }
  });

  test('a lane that did not run on an effective-Low PR is a warning, not a blocker', () => {
    const result = evaluateGate(
      cleanInput({
        tier: tier('low'),
        approvals: approvals({ tier: 'low', satisfied: true, humansRequired: 0, humansCounted: 0, approvedBy: [] }),
        security: { status: 'not-run' },
      })
    );

    expect(result.mergeable).toBe(true);
    expect(result.warnings).toContain('security-review-not-run');
  });
});

describe('TRD-025 AC-4: missing or unavailable review data never passes', () => {
  test.each([
    ['ledger', 'ledger'],
    ['approvals', 'approvals'],
    ['description', 'description'],
    ['security', 'security'],
  ])('an absent %s is reported as unavailable review data and refuses the merge', (key, named) => {
    const input = cleanInput();
    delete input[key];
    const result = evaluateGate(input);

    expect(result.mergeable).toBe(false);
    const blocker = blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE);
    expect(blocker.missing).toContain(named);
    expect(blocker.message).toContain(named);
    expect(blocker.nextAction.trim()).not.toBe('');
  });

  test('an approvals result that refused its own input is unavailable data, not a pass', () => {
    const result = evaluateGate(cleanInput({ approvals: { ok: false, satisfied: false, reason: 'invalid-tier' } }));

    expect(result.mergeable).toBe(false);
    expect(blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE).missing.join(' ')).toContain('approvals');
  });

  test('a security lane that could not be reached is unavailable data for every tier', () => {
    const result = evaluateGate(cleanInput({ security: { status: 'unavailable', reason: 'gh rate-limited' } }));

    expect(result.mergeable).toBe(false);
    expect(blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE).message).toContain('security');
  });

  test('a caller-reported outage (gh unreachable) blocks and is named with a nextAction', () => {
    const result = evaluateGate(cleanInput({ unavailable: ['gh-unreachable'] }));

    expect(result.mergeable).toBe(false);
    const blocker = blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE);
    expect(blocker.missing).toContain('gh-unreachable');
    expect(blocker.nextAction).toMatch(/re-run|access|supply/i);
  });

  test('a ledger entry that is not a usable finding is unavailable data, never an empty pass', () => {
    const result = evaluateGate(cleanInput({ ledger: [{ id: 'B-1' }] }));

    expect(result.mergeable).toBe(false);
    expect(blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE).missing.join(' ')).toContain('ledger');
  });

  test.each([undefined, null, 'ok', 42, []])('a hostile payload (%p) never returns a clean pass', (payload) => {
    const result = evaluateGate(payload);

    expect(result.ok).toBe(false);
    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain(BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE);
  });
});

describe('approvals must match the gate tier floor and head (fail closed)', () => {
  test('approvals evaluated at a lower tier than the effective tier block', () => {
    const result = evaluateGate(
      cleanInput({ tier: tier('high'), approvals: approvals({ tier: 'low', humansRequired: 0, humansCounted: 0 }) })
    );
    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain('approvals-tier-mismatch');
    expect(blockerOf(result, 'approvals-tier-mismatch').nextAction).toEqual(expect.any(String));
  });

  test('approvals whose humansRequired is below the tier floor block', () => {
    const result = evaluateGate(cleanInput({ tier: tier('high'), approvals: approvals({ tier: 'high', humansRequired: 1 }) }));
    expect(codesOf(result)).toContain('approvals-tier-mismatch');
  });

  test('approvals bound to a different head block; the matching head passes', () => {
    const stale = evaluateGate(cleanInput({ approvals: approvals({ headSha: 'b'.repeat(40) }) }));
    expect(codesOf(stale)).toContain('approvals-tier-mismatch');
    const fresh = evaluateGate(cleanInput({ approvals: approvals({ headSha: HEAD }) }));
    expect(fresh.mergeable).toBe(true);
  });
});

describe('gate head binding (final-gate F17): no head, no pass', () => {
  test('a gate asked without a head SHA reports review data unavailable, never mergeable', () => {
    const input = cleanInput();
    delete input.headSha;
    const result = evaluateGate(input);
    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain(BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE);
    expect(blockerOf(result, BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE).missing).toContain('headSha');
  });

  test('an approvals result that names no commit is refused even when the gate has a head', () => {
    const unbound = approvals();
    delete unbound.headSha;
    const result = evaluateGate(cleanInput({ approvals: unbound }));
    expect(result.mergeable).toBe(false);
    expect(codesOf(result)).toContain('approvals-tier-mismatch');
  });
});
