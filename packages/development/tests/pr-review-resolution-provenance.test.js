'use strict';

/**
 * Resolution provenance (kata wbcv, plan 3H items 3-4).
 *
 * The merge gate must stop reading "any text reason" as an answer to an
 * Important or security finding. It honours a recorded resolution only when
 * the resolution names a reason, the login that decided (`by`), a timestamp
 * (`at`) and the head commit it was decided against, equal to the gate's head.
 *
 * HONEST LIMIT, stated in the test names on purpose: these tests prove "a
 * reason is present, decided by a NAMED LOGIN, bound to THIS HEAD". Nothing
 * here (or in the code) proves a human typed it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { evaluateGate, BLOCKER_CODES } = require('../lib/pr-review-gate');
const { recordResolution, recordOperatorResolution, isActionable, RESOLUTION_DECISIONS } = require('../lib/pr-review-ledger');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const AT = '2026-11-06T10:00:00Z';

function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'packages/development/lib/widget.js:12',
    severity: 'important',
    failureMode: 'unchecked input reaches the widget',
    disposition: 'fix',
    evidence: 'line 12 reads the payload without validating it',
    originalTextOrLink: 'https://example.invalid/pr/1#discussion_r1',
    ...overrides,
  };
}

function gateInput(overrides = {}) {
  return {
    headSha: HEAD,
    ledger: [],
    approvals: {
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
    },
    tier: { ok: true, tier: 'medium', effectiveTier: 'medium', humansRequired: 1, refusals: [], reasons: [], warnings: [] },
    description: { ok: true, missing: [], present: ['testing', 'risk', 'rollback'], empty: [], ready: true, warnings: [] },
    security: { status: 'clean', findings: [] },
    coverage: { status: 'complete', gaps: [] },
    ...overrides,
  };
}

const decision = (overrides = {}) => ({ decision: 'accept', reason: 'the caller validates it upstream', by: 'ldangelo', headSha: HEAD, at: AT, ...overrides });
const resolved = (base, overrides) => ({ ...base, disposition: 'resolved', resolution: decision(overrides) });

describe('recordOperatorResolution refuses a decision that lacks provenance', () => {
  test.each([
    ['reason', { reason: '   ' }],
    ['by', { by: undefined }],
    ['by', { by: 'the review agent on behalf of the user' }],
    ['headSha', { headSha: undefined }],
    ['at', { at: undefined }],
    ['at', { at: 'yesterday-ish' }],
  ])('a missing or unreadable %s is refused and the finding stays unresolved', (_name, bad) => {
    const result = recordOperatorResolution(finding(), decision(bad));

    expect(result.ok).toBe(false);
    expect(result.finding.resolution).toBeUndefined();
    expect(result.finding.disposition).toBe('fix');
  });

  test('a complete decision is recorded with the login, head and timestamp it was given', () => {
    const result = recordOperatorResolution(finding(), decision());

    expect(result.ok).toBe(true);
    expect(result.finding.disposition).toBe('resolved');
    expect(result.finding.resolution).toEqual(decision());
  });
});

describe('the typed decision: only accept closes a blocking finding; follow-on is for a finding that never blocked', () => {
  const BAD = [
    ['missing', undefined],
    ['a fix selection (fix-here)', 'fix-here'],
    ['a fix selection (fix)', 'fix'],
    ['the label of the answer (Fix on this PR)', 'Fix on this PR'],
    ['wrong case (ACCEPT)', 'ACCEPT'],
    ['wrong case (Follow-on)', 'Follow-on'],
    ['padded (" accept")', ' accept'],
    ['empty', ''],
    ['not text (true)', true],
    ['not text (a number)', 1],
    ['not text (a list)', ['accept']],
    ['not text (null)', null],
  ];
  const nit = (overrides = {}) => finding({ id: 'N-1', severity: 'nit', ...overrides });
  const withoutDecision = () => {
    const { decision: _dropped, ...without } = decision();
    return without;
  };

  test('RESOLUTION_DECISIONS is exactly accept and follow-on', () => {
    expect(RESOLUTION_DECISIONS).toEqual(['accept', 'follow-on']);
  });

  test.each(BAD)('recordOperatorResolution refuses a decision that is %s: names the allowed values and leaves the finding unchanged', (_name, bad) => {
    const result = recordOperatorResolution(finding(), decision({ decision: bad }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("'accept'");
    expect(result.reason).toContain("'follow-on'");
    expect(result.finding.resolution).toBeUndefined();
    expect(result.finding.disposition).toBe('fix');
  });

  test.each(BAD.filter(([, value]) => typeof value === 'string' && /fix/i.test(value)))('a fix answer (%s) is named as a fix selection, FIX_SELECTION', (_name, bad) => {
    const result = recordOperatorResolution(finding(), decision({ decision: bad }));

    expect(result.reason).toContain('FIX_SELECTION');
  });

  test.each(BAD.filter(([, value]) => !(typeof value === 'string' && /fix/i.test(value))))('a decision that is %s is not called a fix selection, and the refusal says what to do next', (_name, bad) => {
    const result = recordOperatorResolution(finding(), decision({ decision: bad }));

    expect(result.reason).not.toContain('FIX_SELECTION');
    expect(result.reason).toContain("record 'accept'");
  });

  test('recordOperatorResolution refuses a decision object with no decision key at all', () => {
    const result = recordOperatorResolution(finding(), withoutDecision());

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("'accept'");
    expect(result.finding.resolution).toBeUndefined();
  });

  test('recordOperatorResolution records accept on a blocking finding and stores it', () => {
    const result = recordOperatorResolution(finding(), decision({ decision: 'accept' }));

    expect(result.ok).toBe(true);
    expect(result.finding.disposition).toBe('resolved');
    expect(result.finding.resolution.decision).toBe('accept');
  });

  test('recordOperatorResolution refuses follow-on on a blocking finding: a follow-on PR cannot unblock the gate', () => {
    const result = recordOperatorResolution(finding(), decision({ decision: 'follow-on' }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('a follow-on PR cannot unblock the gate');
    expect(result.finding.resolution).toBeUndefined();
  });

  test('recordOperatorResolution refuses follow-on on a security-lane entry, whatever its severity, when told it is one', () => {
    const entry = finding({ id: 'S-1', severity: 'pre-existing' });

    expect(recordOperatorResolution(entry, decision({ decision: 'follow-on' }), undefined, true).ok).toBe(false);
    expect(recordOperatorResolution(entry, decision({ decision: 'follow-on' })).ok).toBe(true);
    expect(recordOperatorResolution(entry, decision({ decision: 'accept' }), undefined, true).ok).toBe(true);
  });

  test.each(['accept', 'follow-on'])('recordOperatorResolution records %s on a Nit and stores it', (value) => {
    const result = recordOperatorResolution(nit(), decision({ decision: value }));

    expect(result.ok).toBe(true);
    expect(result.finding.resolution.decision).toBe(value);
  });

  test.each(BAD)('the gate ignores a hand-written Important resolution whose decision is %s: not mergeable, resolutionRejected names the decision', (_name, bad) => {
    const result = evaluateGate(gateInput({ ledger: [resolved(finding(), { decision: bad })] }));
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING);

    expect(result.mergeable).toBe(false);
    expect(blocker.resolutionRejected).toContain('decision');
    expect(blocker.resolutionRejected).toContain("'accept'");
  });

  test('the gate ignores a hand-written resolution with no decision key', () => {
    const result = evaluateGate(gateInput({ ledger: [{ ...finding(), disposition: 'resolved', resolution: withoutDecision() }] }));
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING);

    expect(result.mergeable).toBe(false);
    expect(blocker.resolutionRejected).toContain('decision');
  });

  test('the gate ignores a decision-less resolution on a security-lane finding too', () => {
    const lane = { status: 'findings', findings: [{ ...finding({ id: 'S-1' }), disposition: 'resolved', resolution: withoutDecision() }] };
    const result = evaluateGate(gateInput({ security: lane }));

    expect(result.mergeable).toBe(false);
    expect(result.securityLane.open).toEqual(['S-1']);
  });

  test('the gate takes accept on an Important finding', () => {
    const result = evaluateGate(gateInput({ ledger: [resolved(finding(), { decision: 'accept' })] }));

    expect(result.mergeable).toBe(true);
    expect(result.findings.open).toEqual([]);
  });

  test('the gate does NOT take follow-on on an Important finding: it stays open and says why', () => {
    const result = evaluateGate(gateInput({ ledger: [resolved(finding(), { decision: 'follow-on' })] }));
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING);

    expect(result.mergeable).toBe(false);
    expect(blocker.resolutionRejected).toContain('a follow-on PR cannot unblock the gate');
  });

  test('the gate does NOT take follow-on on a security-lane finding', () => {
    const lane = { status: 'findings', findings: [resolved(finding({ id: 'S-1' }), { decision: 'follow-on' })] };
    const result = evaluateGate(gateInput({ security: lane }));

    expect(result.mergeable).toBe(false);
    expect(result.securityLane.open).toEqual(['S-1']);
  });

  test('a Nit never blocks: the gate is mergeable with follow-on, with no decision and with none recorded; the recorder takes follow-on on it and refuses a missing decision', () => {
    for (const closed of [resolved(nit(), { decision: 'follow-on' }), resolved(nit(), { decision: undefined }), nit()]) {
      expect(evaluateGate(gateInput({ ledger: [closed] })).mergeable).toBe(true);
    }
    const recorded = recordOperatorResolution(nit(), decision({ decision: 'follow-on' }));
    expect(recorded.ok).toBe(true);
    expect(recorded.finding.resolution.decision).toBe('follow-on');
    const missing = recordOperatorResolution(nit(), decision({ decision: undefined }));
    expect(missing.ok).toBe(false);
    expect(missing.finding.resolution).toBeUndefined();
  });

  test('recordResolution refuses a decision that is present and invalid, and takes one that is absent or valid', () => {
    for (const bad of ['ACCEPT', 'fix-here', 7, null, '']) {
      const refused = recordResolution(finding(), { reason: 'r', decision: bad });
      expect(refused.ok).toBe(false);
      expect(refused.finding.resolution).toBeUndefined();
    }
    expect(recordResolution(finding(), { reason: 'r' }).ok).toBe(true);
    expect(recordResolution(finding(), { reason: 'r', decision: 'follow-on' }).finding.resolution.decision).toBe('follow-on');
  });
});

describe('AC1: an Important or security finding is closed only by a stated reason', () => {
  test('a blocking finding cannot be accepted without a reason, so the gate still refuses it', () => {
    const refused = recordOperatorResolution(finding(), decision({ reason: '' }));
    expect(refused.ok).toBe(false);

    const result = evaluateGate(gateInput({ ledger: [refused.finding] }));
    expect(result.mergeable).toBe(false);
    expect(result.findings.open).toEqual(['F-1']);
  });

  test('a security finding cannot be closed without a reason, so the gate still refuses it', () => {
    const refused = recordOperatorResolution(finding({ id: 'S-1' }), decision({ reason: '' }));
    expect(refused.ok).toBe(false);

    const result = evaluateGate(gateInput({ security: { status: 'findings', findings: [refused.finding] } }));
    expect(result.mergeable).toBe(false);
    expect(result.securityLane.open).toEqual(['S-1']);
  });
});

describe('AC2: the gate honours a resolution only with a named login on THIS head (decided by a login, not proven human)', () => {
  test('a resolution with every part, bound to the gate head: the Important finding stops blocking', () => {
    const result = evaluateGate(gateInput({ ledger: [resolved(finding())] }));

    expect(result.mergeable).toBe(true);
    expect(result.findings.open).toEqual([]);
  });

  test.each([
    ['no deciding login (by)', { by: undefined }],
    ['a by that is prose, not a login', { by: 'the agent, on the user\u2019s behalf' }],
    ['no head binding (headSha)', { headSha: undefined }],
    ['a head that is not the current one', { headSha: OLD_HEAD }],
    ['no timestamp (at)', { at: undefined }],
  ])('an Important resolution with %s still blocks, and the blocker says why', (_name, bad) => {
    const result = evaluateGate(gateInput({ ledger: [resolved(finding(), bad)] }));

    expect(result.mergeable).toBe(false);
    expect(result.findings.open).toEqual(['F-1']);
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
    expect(blocker.resolutionRejected).toEqual(expect.any(String));
    expect(blocker.message).toContain('does not count');
  });

  test('the head match ignores letter case and padding, so a differently-cased copy of the same sha is the same head', () => {
    const upper = HEAD.toUpperCase();
    const result = evaluateGate(gateInput({ ledger: [resolved(finding(), { headSha: `  ${upper} ` })] }));

    expect(result.mergeable).toBe(true);
  });

  test.each([
    ['no deciding login (by)', { by: undefined }],
    ['a head that is not the current one', { headSha: OLD_HEAD }],
    ['no timestamp (at)', { at: undefined }],
  ])('a security-lane resolution with %s still blocks', (_name, bad) => {
    const lane = { status: 'findings', findings: [resolved(finding({ id: 'S-1' }), bad)] };
    const result = evaluateGate(gateInput({ security: lane }));

    expect(result.mergeable).toBe(false);
    expect(result.securityLane.open).toEqual(['S-1']);
    expect(result.securityLane.resolved).toEqual([]);
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.SECURITY_FINDING_OPEN);
    expect(blocker.resolutionRejected).toEqual(expect.any(String));
  });

  test('a security-lane resolution with full provenance on this head stops blocking and is recorded', () => {
    const lane = { status: 'findings', findings: [resolved(finding({ id: 'S-1' }))] };
    const result = evaluateGate(gateInput({ security: lane }));

    expect(result.mergeable).toBe(true);
    expect(result.securityLane.resolved).toEqual([{ id: 'S-1', reason: 'the caller validates it upstream' }]);
  });

  test('a bare recordResolution (reason only, the old shape) no longer unblocks an Important finding', () => {
    const legacy = recordResolution(finding(), { reason: 'ok', by: 'author-a' });
    expect(legacy.ok).toBe(true);

    const result = evaluateGate(gateInput({ ledger: [legacy.finding] }));
    expect(result.mergeable).toBe(false);
  });

  test('an unrecognised-severity finding is held to the same provenance rule', () => {
    const odd = resolved(finding({ severity: 'whoops' }), { by: undefined });
    const result = evaluateGate(gateInput({ ledger: [odd] }));

    expect(result.mergeable).toBe(false);
    expect(result.blockers.map((entry) => entry.code)).toContain(BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING);
  });

  test('a Nit or Pre-existing finding never needed an answer: its resolution is not held to provenance', () => {
    const nit = resolved(finding({ id: 'N-1', severity: 'nit' }), { by: undefined, headSha: undefined });
    const preExisting = resolved(finding({ id: 'P-1', severity: 'pre-existing' }), { by: undefined });
    const result = evaluateGate(gateInput({ ledger: [nit, preExisting] }));

    expect(result.mergeable).toBe(true);
  });

  test('a resolution without provenance does not turn a later head into a pass: a new head makes the old decision stale', () => {
    const decided = resolved(finding(), { headSha: OLD_HEAD });
    const atOldHead = evaluateGate(gateInput({ headSha: OLD_HEAD, ledger: [decided], approvals: undefined }));
    // The approvals result is bound to HEAD, so the old-head gate is not mergeable for that reason;
    // what matters here is that the FINDING is no longer open at the head it was decided on, and is open on the next.
    expect(atOldHead.findings.open).toEqual([]);

    const atNewHead = evaluateGate(gateInput({ ledger: [decided] }));
    expect(atNewHead.findings.open).toEqual(['F-1']);
  });
});

describe('AC5: the stopping-rule deferral is an agent claim, so it does not close an Important finding at the gate', () => {
  // The stopping rule (top of the pr-review-cycle skill) lets the triager mark a non-blocking Major
  // `blocking: false`, `disposition: 'deferred'` with a `reason`. The review cycle's `isActionable` reads
  // that, and must keep doing so. The merge gate must not: it is the same text an agent writes for itself
  // that a bare resolution reason was, and it needed no login, no timestamp and no head.
  const deferred = (overrides = {}) =>
    finding({ id: 'D-1', blocking: false, disposition: 'deferred', reason: 'opt-in component, tracked in a follow-up bead', ...overrides });

  test('an Important finding deferred as non-blocking still blocks, and the blocker says the deferral does not count', () => {
    const result = evaluateGate(gateInput({ ledger: [deferred()] }));

    expect(result.mergeable).toBe(false);
    expect(result.findings.open).toEqual(['D-1']);
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
    expect(blocker.findingId).toBe('D-1');
    expect(blocker.deferralRejected).toEqual(expect.any(String));
    expect(blocker.message).toContain('deferral');
    expect(blocker.nextAction).toContain('ledger resolve');
  });

  test.each(['important', 'Important', 'major', 'Major', 'critical', 'Critical'])(
    'severity %s is held the same way: the legacy words are Important too',
    (severity) => {
      const result = evaluateGate(gateInput({ ledger: [deferred({ severity })] }));

      expect(result.mergeable).toBe(false);
      expect(result.findings.open).toEqual(['D-1']);
    }
  );

  test('an unrecognised-severity finding deferred the same way still blocks', () => {
    const result = evaluateGate(gateInput({ ledger: [deferred({ severity: 'spicy' })] }));

    expect(result.mergeable).toBe(false);
    expect(result.blockers.map((entry) => entry.code)).toContain(BLOCKER_CODES.OPEN_UNRECOGNISED_FINDING);
  });

  test('the operator closes it the one way the gate takes: a full-provenance resolution on this head, deferral and all', () => {
    const result = evaluateGate(gateInput({ ledger: [{ ...deferred(), resolution: decision() }] }));

    expect(result.mergeable).toBe(true);
    expect(result.findings.open).toEqual([]);
  });

  test('a deferred finding whose resolution is also refused reports both refusals', () => {
    const result = evaluateGate(gateInput({ ledger: [{ ...deferred(), resolution: decision({ headSha: OLD_HEAD }) }] }));

    expect(result.mergeable).toBe(false);
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
    expect(blocker.resolutionRejected).toEqual(expect.any(String));
    expect(blocker.deferralRejected).toEqual(expect.any(String));
  });

  test('a deferred Nit is still not a blocker: a Nit never needed an answer', () => {
    const result = evaluateGate(gateInput({ ledger: [deferred({ id: 'N-1', severity: 'nit' })] }));

    expect(result.mergeable).toBe(true);
    expect(result.findings.open).toEqual([]);
  });

  test('the review cycle still reads the deferral: `isActionable` is unchanged, the change is in the gate alone', () => {
    expect(isActionable(deferred())).toBe(false);
    expect(isActionable(deferred({ severity: 'major' }))).toBe(false);
  });
});

describe('AC6: every security-lane closure needs the operator decision, a Pre-existing lane entry included', () => {
  const laneEntry = (overrides = {}) => finding({ id: 'S-9', severity: 'pre-existing', source: 'security-lane', ...overrides });
  const lane = (entry) => ({ status: 'findings', findings: [entry] });

  test('a Pre-existing lane finding nobody answered blocks: the lane holds every open entry whatever its severity', () => {
    const result = evaluateGate(gateInput({ security: lane(laneEntry()) }));

    expect(result.mergeable).toBe(false);
    expect(result.securityLane.open).toEqual(['S-9']);
  });

  test('closed with a bare reason it still blocks, and the blocker says the resolution does not count', () => {
    const bare = laneEntry({ disposition: 'resolved', resolution: { reason: 'accepted' } });
    const result = evaluateGate(gateInput({ security: lane(bare) }));

    expect(result.mergeable).toBe(false);
    expect(result.securityLane.open).toEqual(['S-9']);
    expect(result.securityLane.resolved).toEqual([]);
    const blocker = result.blockers.find((entry) => entry.code === BLOCKER_CODES.SECURITY_FINDING_OPEN);
    expect(blocker.resolutionRejected).toEqual(expect.any(String));
    expect(blocker.message).toContain('does not count');
  });

  test.each([
    ['no deciding login (by)', { by: undefined }],
    ['a head that is not the current one', { headSha: OLD_HEAD }],
    ['no timestamp (at)', { at: undefined }],
  ])('a Pre-existing lane resolution with %s still blocks', (_name, bad) => {
    const result = evaluateGate(gateInput({ security: lane(resolved(laneEntry(), bad)) }));

    expect(result.mergeable).toBe(false);
    expect(result.securityLane.open).toEqual(['S-9']);
    expect(result.securityLane.resolved).toEqual([]);
  });

  test('with full provenance on this head a Pre-existing lane finding stops blocking and the reason is recorded', () => {
    const result = evaluateGate(gateInput({ security: lane(resolved(laneEntry())) }));

    expect(result.mergeable).toBe(true);
    expect(result.securityLane.resolved).toEqual([{ id: 'S-9', reason: 'the caller validates it upstream' }]);
  });

  test('a Pre-existing finding in the LEDGER is still not held to provenance: it never blocks, so there is nothing to close', () => {
    const result = evaluateGate(gateInput({ ledger: [resolved(finding({ id: 'P-1', severity: 'pre-existing' }), { by: undefined, headSha: undefined })] }));

    expect(result.mergeable).toBe(true);
  });
});

describe('AC7: a bot, or a login the repository policy does not name, is not the deciding login', () => {
  // REVIEW.md: `botLogins` "A bot approval never satisfies a human-approval requirement"; `maintainerLogins` "Logins
  // whose approval counts for this repository". The policy block reaches `ledger resolve` and `gate` as `policy`.
  const POLICY = { botLogins: ['@coderabbitai', '@claude', '@github-actions'], maintainerLogins: ['@ldangelo'] };

  test.each([
    ['a listed bot', '@coderabbitai'],
    ['a listed bot written without the @', 'claude'],
    ['a listed bot in another letter case', 'GitHub-Actions'],
  ])('%s cannot record a decision: ledger resolve refuses it and the finding stays unresolved', (_name, by) => {
    const result = recordOperatorResolution(finding(), decision({ by }), POLICY);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bot/);
    expect(result.finding.resolution).toBeUndefined();
  });

  test('a login the policy does not name as a maintainer cannot decide either', () => {
    const result = recordOperatorResolution(finding(), decision({ by: 'random-user' }), POLICY);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/maintainerLogins/);
  });

  test.each(['ldangelo', '@ldangelo', 'LDangelo'])('the named maintainer %s can decide, whatever the @ or letter case', (by) => {
    const result = recordOperatorResolution(finding(), decision({ by }), POLICY);

    expect(result.ok).toBe(true);
    expect(result.finding.resolution.by).toBe(by);
  });

  test('a bot login is refused even when the policy names no maintainers at all', () => {
    const noMaintainers = { botLogins: ['@coderabbitai'], maintainerLogins: [] };

    expect(recordOperatorResolution(finding(), decision({ by: 'coderabbitai' }), noMaintainers).ok).toBe(false);
    expect(recordOperatorResolution(finding(), decision({ by: 'anyone-else' }), noMaintainers).ok).toBe(true);
  });

  test('with no policy handed over the login is checked for shape only: the honest limit', () => {
    expect(recordOperatorResolution(finding(), decision({ by: '@coderabbitai' })).ok).toBe(true);
    expect(recordOperatorResolution(finding(), decision({ by: 'random-user' })).ok).toBe(true);
  });

  test.each([
    ['a policy that is not an object', 'strict'],
    ['a policy that is an array', ['@ldangelo']],
    ['botLogins that is not a list', { botLogins: '@coderabbitai' }],
    ['maintainerLogins with a non-text entry', { maintainerLogins: ['@ldangelo', 7] }],
  ])('%s is refused: a policy the check cannot read never means "no check"', (_name, policy) => {
    const result = recordOperatorResolution(finding(), decision(), policy);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/policy/);
  });

  test('the gate ignores a resolution recorded by a listed bot or a stranger, in the ledger and in the security lane', () => {
    for (const by of ['@coderabbitai', 'random-user']) {
      const inLedger = evaluateGate(gateInput({ policy: POLICY, ledger: [resolved(finding(), { by })] }));
      expect([by, inLedger.mergeable]).toEqual([by, false]);
      const blocker = inLedger.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING);
      expect(blocker.resolutionRejected).toEqual(expect.any(String));

      const inLane = evaluateGate(gateInput({ policy: POLICY, security: { status: 'findings', findings: [resolved(finding({ id: 'S-1' }), { by })] } }));
      expect([by, inLane.mergeable]).toEqual([by, false]);
      expect(inLane.securityLane.open).toEqual(['S-1']);
    }
  });

  test('the gate takes the same resolution from a named maintainer', () => {
    const result = evaluateGate(gateInput({ policy: POLICY, ledger: [resolved(finding(), { by: '@ldangelo' })] }));

    expect(result.mergeable).toBe(true);
  });

  test('a gate handed no policy keeps the shape-only check: the repository lists reach it only through `policy`', () => {
    const result = evaluateGate(gateInput({ ledger: [resolved(finding(), { by: '@coderabbitai' })] }));

    expect(result.mergeable).toBe(true);
  });

  test('a gate handed a policy it cannot read ignores every resolution', () => {
    const result = evaluateGate(gateInput({ policy: 'strict', ledger: [resolved(finding())] }));

    expect(result.mergeable).toBe(false);
  });
});

describe('a decision time must be an ISO-8601 timestamp with a zone, as the CLI documents', () => {
  test.each(['1', 'Jan 1 2020', '2099-01-01', '2026-11-06 10:00:00', '2026-11-06T10:00:00'])(
    'at: %s is refused by ledger resolve and ignored by the gate',
    (at) => {
      expect(recordOperatorResolution(finding(), decision({ at })).ok).toBe(false);

      const result = evaluateGate(gateInput({ ledger: [resolved(finding(), { at })] }));
      expect(result.mergeable).toBe(false);
    }
  );

  test.each(['2026-11-06T10:00:00Z', '2026-11-06T10:00Z', '2026-11-06T10:00:00.123Z', '2026-11-06T10:00:00+01:00'])(
    'at: %s is accepted',
    (at) => {
      expect(recordOperatorResolution(finding(), decision({ at })).ok).toBe(true);
      expect(evaluateGate(gateInput({ ledger: [resolved(finding(), { at })] })).mergeable).toBe(true);
    }
  );
});

describe('AC4: `ledger resolve` through the real CLI round-trips through state and the gate reads it', () => {
  function runCli(args, payload) {
    const run = spawnSync('node', [CLI, ...args], { input: JSON.stringify(payload), encoding: 'utf8' });
    return { status: run.status, out: JSON.parse(run.stdout) };
  }

  test('resolve -> state-write -> state-read -> gate: the recorded decision unblocks only the head it was made on', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-resolution-'));
    try {
      const resolveRun = runCli(['ledger'], { action: 'resolve', finding: finding(), resolution: decision() });
      expect(resolveRun.status).toBe(0);
      const recorded = resolveRun.out.finding;
      expect(recorded.resolution).toEqual(decision());

      const written = runCli(['state-write'], { prId: '1', cwd, state: { headSha: HEAD, ledger: [recorded] } });
      expect(written.out.ok).toBe(true);
      const read = runCli(['state-read'], { prId: '1', cwd, headSha: HEAD });
      expect(read.out.discarded).toBe(false);
      const { ledger } = read.out.state;
      expect(ledger).toHaveLength(1);
      expect(ledger[0].resolution).toEqual(decision());

      const atHead = runCli(['gate'], gateInput({ ledger }));
      expect(atHead.out.findings.open).toEqual([]);
      expect(atHead.out.mergeable).toBe(true);

      const moved = runCli(['gate'], gateInput({ ledger, headSha: 'c'.repeat(40) }));
      expect(moved.out.findings.open).toEqual(['F-1']);
      expect(moved.out.mergeable).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('resolve with a missing `by` is refused with exit 1 and no finding comes back', () => {
    const run = runCli(['ledger'], { action: 'resolve', finding: finding(), resolution: decision({ by: undefined }) });

    expect(run.status).toBe(1);
    expect(run.out.error).toContain("'by'");
    expect(run.out.finding).toBeUndefined();
  });

  test('resolve with the policy refuses a bot or a stranger with exit 1, and records a named maintainer', () => {
    const policy = { botLogins: ['@coderabbitai'], maintainerLogins: ['@ldangelo'] };

    const bot = runCli(['ledger'], { action: 'resolve', finding: finding(), resolution: decision({ by: '@coderabbitai' }), policy });
    expect(bot.status).toBe(1);
    expect(bot.out.error).toMatch(/bot login/);
    expect(bot.out.finding).toBeUndefined();

    const stranger = runCli(['ledger'], { action: 'resolve', finding: finding(), resolution: decision({ by: 'random-user' }), policy });
    expect(stranger.status).toBe(1);
    expect(stranger.out.error).toMatch(/maintainerLogins/);

    const maintainer = runCli(['ledger'], { action: 'resolve', finding: finding(), resolution: decision({ by: '@ldangelo' }), policy });
    expect(maintainer.status).toBe(0);
    expect(maintainer.out.finding.resolution.by).toBe('@ldangelo');
  });

  test('a policy that is not an object is a CLI error, never read as no policy', () => {
    for (const policy of ['strict', null, [], 7]) {
      const run = runCli(['ledger'], { action: 'resolve', finding: finding(), resolution: decision(), policy });
      expect([policy, run.status]).toEqual([policy, 1]);
      expect(run.out.error).toContain("'policy'");
    }
  });

  test('a decision `resolve` refuses is exactly one the gate ignores: both read the same policy', () => {
    const policy = { botLogins: ['@coderabbitai'] };
    const resolution = decision({ by: '@coderabbitai' });

    expect(runCli(['ledger'], { action: 'resolve', finding: finding(), resolution, policy }).status).toBe(1);
    const gate = runCli(['gate'], gateInput({ policy, ledger: [{ ...finding(), disposition: 'resolved', resolution }] }));
    expect(gate.out.mergeable).toBe(false);
    expect(gate.out.findings.open).toEqual(['F-1']);
  });

  test('the gate answers with the decision list next to its verdict, and the list never changes the verdict', () => {
    const run = runCli(['gate'], gateInput({ ledger: [finding(), finding({ id: 'N-1', severity: 'nit', locationOrLink: 'a.js:3' })] }));
    const bare = evaluateGate(gateInput({ ledger: [finding(), finding({ id: 'N-1', severity: 'nit', locationOrLink: 'a.js:3' })] }));

    expect(run.out.dispositionChoices.map((entry) => entry.id)).toEqual(['F-1', 'N-1']);
    const { dispositionChoices, dispositionGroups, mergeConfirmation, ...verdict } = run.out;
    expect(verdict).toEqual(JSON.parse(JSON.stringify(bare)));
    expect(dispositionGroups).toEqual(expect.any(Array));
    expect(mergeConfirmation).toEqual(expect.any(Object));
  });
});
