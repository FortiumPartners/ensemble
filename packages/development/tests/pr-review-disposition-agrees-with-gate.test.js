'use strict';

/**
 * The operator's decision list must say what the merge gate says (review of
 * PR #253, finding F4).
 *
 * `mergeConfirmation` is the one question the operator answers before the
 * merge approval (plan 3H item 5), so a list that reports "0 blocking
 * finding(s) undecided" while the gate refuses on an open finding is wrong in
 * the one place that matters. These tests run the SAME input through
 * `evaluateGate` and `buildDispositionChoices` and require the two to agree on
 * which findings block: for each shape the review found them disagreeing on,
 * for the shapes around them, and through the real CLI process.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { evaluateGate } = require('../lib/pr-review-gate');
const { buildDispositionChoices } = require('../lib/pr-review-disposition');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');
const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const AT = '2026-11-06T10:00:00Z';
const POLICY = { botLogins: ['@coderabbitai'], maintainerLogins: ['@ldangelo'] };

function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'packages/development/lib/widget.js:12',
    severity: 'important',
    failureMode: 'unchecked input',
    disposition: 'fix',
    evidence: 'line 12',
    originalTextOrLink: 'https://example.invalid/pr/1#r1',
    ...overrides,
  };
}

const decision = (overrides = {}) => ({ reason: 'accepted: low risk', by: 'ldangelo', at: AT, headSha: HEAD, ...overrides });
/** A finding closed with a resolution carrying full provenance for HEAD. */
const decided = (base, overrides) => ({ ...base, disposition: 'resolved', resolution: decision(overrides) });
const lane = (...findings) => ({ status: 'findings', findings });
const filtered = (id) => ({
  ok: true,
  findings: [{ id, outcome: 'filtered', presented: false, tally: { real: 0, notReal: 3, abstain: 0, expected: 3, needed: 2 } }],
});

/** A complete gate payload around the findings under test; nothing but the findings can block it. */
function gateInput(extra = {}) {
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
    ...extra,
  };
}

function listFor(input) {
  return buildDispositionChoices({
    ledger: input.ledger,
    security: input.security,
    votes: input.votes,
    policy: input.policy,
    headSha: HEAD,
  });
}

const sortedIds = (ids) => [...new Set(ids.map(String))].sort();

/** Every shape here must make the gate and the list agree. The first block is what the review found them disagreeing on. */
const SHAPES = [
  ['(a) full provenance but an open review thread', { ledger: [decided(finding({ unresolvedThread: true }))] }],
  ['(a) full provenance but flagged uncertain', { ledger: [decided(finding({ uncertain: true }))] }],
  ['(a) cleared but an open review thread', { ledger: [finding({ cleared: true, unresolvedThread: true })] }],
  ['(b) a verifier-filtered Important finding', { ledger: [finding()], votes: filtered('F-1') }],
  ['(b) a verifier-filtered Nit', { ledger: [finding({ severity: 'nit' })], votes: filtered('F-1') }],
  ['(c) same id: open in the ledger, cleared in the lane', { ledger: [finding({ id: 'X-1' })], security: lane(finding({ id: 'X-1', cleared: true })) }],
  ['(c) same id: closed in the ledger, open in the lane', { ledger: [decided(finding({ id: 'X-1' }))], security: lane(finding({ id: 'X-1' })) }],
  ['(d) an open Pre-existing security-lane finding', { security: lane(finding({ id: 'S-1', severity: 'pre-existing' })) }],
  ['(d) a Pre-existing lane finding closed by a bare reason', { security: lane({ ...finding({ id: 'S-1', severity: 'pre-existing' }), resolution: { reason: 'accepted' } }) }],
  ['(d) a Pre-existing lane finding closed with full provenance', { security: lane(decided(finding({ id: 'S-1', severity: 'pre-existing' }))) }],
  ['(e) a ledger Nit flagged security', { ledger: [finding({ severity: 'nit', security: true })] }],
  ['a ledger Pre-existing finding flagged security', { ledger: [finding({ severity: 'pre-existing', security: true })] }],
  // The shapes around them.
  ['an open Important finding', { ledger: [finding()] }],
  ['an Important finding closed with full provenance', { ledger: [decided(finding())] }],
  ['an Important finding closed by a bare reason', { ledger: [{ ...finding(), resolution: { reason: 'ok' } }] }],
  ['an Important finding closed for another head', { ledger: [decided(finding(), { headSha: OLD_HEAD })] }],
  ['a cleared Important finding', { ledger: [finding({ cleared: true })] }],
  ['an Important finding the stopping rule deferred', { ledger: [finding({ blocking: false, disposition: 'deferred', reason: 'opt-in component' })] }],
  ['a deferred Important finding closed with full provenance', { ledger: [{ ...finding({ blocking: false, disposition: 'deferred', reason: 'opt-in component' }), resolution: decision() }] }],
  ['a deferred Critical finding', { ledger: [finding({ severity: 'critical', blocking: false, disposition: 'deferred', reason: 'opt-in component' })] }],
  ['an unrecognised severity', { ledger: [finding({ severity: 'spicy' })] }],
  ['an unrecognised severity closed with full provenance', { ledger: [decided(finding({ severity: 'spicy' }))] }],
  ['a Nit closed by a bare reason', { ledger: [{ ...finding({ severity: 'nit' }), resolution: { reason: 'fine' } }] }],
  ['an open Nit and an open Pre-existing finding', { ledger: [finding({ id: 'N-1', severity: 'nit' }), finding({ id: 'P-1', severity: 'pre-existing' })] }],
  ['a decision by a bot under the policy', { policy: POLICY, ledger: [decided(finding(), { by: '@coderabbitai' })] }],
  ['a decision by a stranger under the policy', { policy: POLICY, ledger: [decided(finding(), { by: 'random-user' })] }],
  ['a decision by the maintainer under the policy', { policy: POLICY, ledger: [decided(finding(), { by: '@ldangelo' })] }],
  ['a decision under a policy that cannot be read', { policy: 'strict', ledger: [decided(finding())] }],
  ['a numeric finding id', { ledger: [finding({ id: 7 })] }],
  [
    'several findings of every kind at once',
    {
      policy: POLICY,
      ledger: [
        finding({ id: 'A-1' }),
        decided(finding({ id: 'A-2' }), { by: '@ldangelo' }),
        finding({ id: 'A-3', severity: 'nit' }),
        finding({ id: 'A-4', severity: 'pre-existing', security: true }),
        decided(finding({ id: 'A-5', unresolvedThread: true }), { by: '@ldangelo' }),
      ],
      security: lane(finding({ id: 'S-1' }), decided(finding({ id: 'S-2', severity: 'pre-existing' }), { by: '@ldangelo' })),
      votes: filtered('A-1'),
    },
  ],
];

describe('the decision list and the gate agree on what blocks', () => {
  test.each(SHAPES)('%s', (_name, extra) => {
    const input = gateInput(extra);
    const verdict = evaluateGate(input);
    const list = listFor(input);

    expect(list.ok).toBe(true);
    const gateBlocks = sortedIds([...verdict.findings.open, ...verdict.securityLane.open]);
    const listBlocks = sortedIds(list.mergeConfirmation.undecidedBlocking);
    expect(listBlocks).toEqual(gateBlocks);

    // The sentence the operator reads carries the same count.
    expect(list.mergeConfirmation.summary).toContain(`${list.mergeConfirmation.undecidedBlocking.length} blocking finding(s) undecided`);
    // Nothing the gate holds open is reported as accepted.
    for (const accepted of list.mergeConfirmation.acceptedBlocking) expect(gateBlocks).not.toContain(String(accepted.id));
  });

  test('a gate that cannot read the findings and a list that cannot read them fail the same way', () => {
    const unusable = { ...finding(), source: undefined };
    const input = gateInput({ ledger: [unusable] });

    expect(evaluateGate(input).mergeable).toBe(false);
    const list = listFor(input);
    expect(list.ok).toBe(false);
    expect(list.dispositionChoices).toEqual([]);
    expect(list.mergeConfirmation).toBeNull();
    expect(list.reason).toMatch(/unusable/);

    const unusableLane = listFor(gateInput({ security: lane({ ...finding({ id: 'S-1' }), evidence: undefined }) }));
    expect(unusableLane.ok).toBe(false);
  });
});

describe('what the list shows for each shape the review found it disagreeing on', () => {
  test('(a) a decision recorded on a finding whose review thread is still open does not hide it', () => {
    for (const flag of [{ unresolvedThread: true }, { uncertain: true }]) {
      const list = listFor(gateInput({ ledger: [decided(finding(flag))] }));

      expect(list.dispositionChoices.map((entry) => entry.id)).toEqual(['F-1']);
      expect(list.dispositionChoices[0].group).toBe('blocking');
      expect(list.mergeConfirmation.undecidedBlocking).toEqual(['F-1']);
      expect(list.mergeConfirmation.acceptedBlocking).toEqual([]);
      expect(list.mergeConfirmation.summary).toContain('1 blocking finding(s) undecided');
    }
  });

  test('(b) a finding the verifiers filtered out is still listed while the gate blocks on it, with the tally that filtered it', () => {
    const list = listFor(gateInput({ ledger: [finding()], votes: filtered('F-1') }));

    expect(list.mergeConfirmation.undecidedBlocking).toEqual(['F-1']);
    expect(list.dispositionChoices[0].votes).toEqual({ real: 0, notReal: 3, abstain: 0, expected: 3 });
  });

  test('(b) a filtered Nit stays out of the list: the gate never blocks on it', () => {
    const list = listFor(gateInput({ ledger: [finding({ severity: 'nit' })], votes: filtered('F-1') }));

    expect(list.dispositionChoices).toEqual([]);
  });

  test('(c) the same id open in the ledger and cleared in the lane is still one undecided blocking finding', () => {
    const list = listFor(gateInput({ ledger: [finding({ id: 'X-1' })], security: lane(finding({ id: 'X-1', cleared: true })) }));

    expect(list.dispositionChoices.map((entry) => entry.id)).toEqual(['X-1']);
    expect(list.dispositionChoices[0].group).toBe('blocking');
    expect(list.dispositionChoices[0].security).toBe(true);
  });

  test('(d) an open Pre-existing finding in the security lane is a blocking entry, because the gate blocks on it', () => {
    const list = listFor(gateInput({ security: lane(finding({ id: 'S-1', severity: 'pre-existing' })) }));

    const [entry] = list.dispositionChoices;
    expect(entry.group).toBe('blocking');
    expect(entry.security).toBe(true);
    expect(entry.choices.map((choice) => choice.id)).toEqual(['fix-here', 'accept']);
    expect(entry.choices.find((choice) => choice.id === 'accept')).toMatchObject({ default: false, batchable: false, requiresReason: true });
    expect(list.mergeConfirmation.undecidedBlocking).toEqual(['S-1']);
  });

  test('(d) closed with full provenance it is reported as an accepted blocking finding and asks nothing more', () => {
    const list = listFor(gateInput({ security: lane(decided(finding({ id: 'S-1', severity: 'pre-existing' }))) }));

    expect(list.dispositionChoices).toEqual([]);
    expect(list.mergeConfirmation.acceptedBlocking.map((entry) => entry.id)).toEqual(['S-1']);
  });

  test('(e) a ledger Nit flagged security is a Nit entry for the list, as it is for the gate, with a security accept', () => {
    const list = listFor(gateInput({ ledger: [finding({ severity: 'nit', security: true })] }));

    const [entry] = list.dispositionChoices;
    expect(entry.group).toBe('nit');
    expect(entry.security).toBe(true);
    expect(entry.default).toBe('follow-on');
    expect(entry.choices.find((choice) => choice.id === 'accept')).toMatchObject({ default: false, batchable: false, requiresReason: true });
    expect(list.mergeConfirmation.undecidedBlocking).toEqual([]);
  });

  test('a deferral does not hide an Important finding from the list, and the list asks for the decision the gate asks for', () => {
    const list = listFor(gateInput({ ledger: [finding({ id: 'D-1', blocking: false, disposition: 'deferred', reason: 'triager: non-blocking' })] }));

    expect(list.mergeConfirmation.undecidedBlocking).toEqual(['D-1']);
    expect(list.mergeConfirmation.summary).toContain('1 blocking finding(s) undecided');
  });

  test('a decision by a bot is not counted: the list asks again, as the gate refuses it', () => {
    const list = listFor(gateInput({ policy: POLICY, ledger: [decided(finding(), { by: '@coderabbitai' })] }));

    expect(list.mergeConfirmation.undecidedBlocking).toEqual(['F-1']);
    expect(list.mergeConfirmation.acceptedBlocking).toEqual([]);
    expect(list.mergeConfirmation.staleResolutions).toEqual(['F-1']);
  });
});

describe('through the real CLI process, `gate` returns a verdict and a list that agree', () => {
  function runGate(payload) {
    const run = spawnSync('node', [CLI, 'gate'], { input: JSON.stringify(payload), encoding: 'utf8' });
    expect(run.status).toBe(0);
    return JSON.parse(run.stdout);
  }

  test('the reviewer repro: a deferred Important finding refuses the gate AND is undecided in the list', () => {
    const out = runGate(gateInput({ ledger: [finding({ id: 'D-1', blocking: false, disposition: 'deferred', reason: 'triager: non-blocking' })] }));

    expect(out.mergeable).toBe(false);
    expect(out.findings.open).toEqual(['D-1']);
    expect(out.mergeConfirmation.undecidedBlocking).toEqual(['D-1']);
    expect(out.mergeConfirmation.summary).toContain('1 blocking finding(s) undecided');
  });

  test('a Pre-existing security-lane finding closed by a bare reason refuses the gate and stays undecided in the list', () => {
    const out = runGate(gateInput({ security: lane({ ...finding({ id: 'S', severity: 'pre-existing' }), resolution: { reason: 'accepted' } }) }));

    expect(out.mergeable).toBe(false);
    expect(out.securityLane.open).toEqual(['S']);
    expect(out.mergeConfirmation.undecidedBlocking).toEqual(['S']);
  });

  test('the policy reaches both the verdict and the list: a bot decision is refused by each, a maintainer decision taken by each', () => {
    const byBot = runGate(gateInput({ policy: POLICY, ledger: [decided(finding(), { by: '@coderabbitai' })] }));
    expect(byBot.mergeable).toBe(false);
    expect(byBot.mergeConfirmation.undecidedBlocking).toEqual(['F-1']);

    const byMaintainer = runGate(gateInput({ policy: POLICY, ledger: [decided(finding(), { by: '@ldangelo' })] }));
    expect(byMaintainer.mergeable).toBe(true);
    expect(byMaintainer.mergeConfirmation.undecidedBlocking).toEqual([]);
    expect(byMaintainer.mergeConfirmation.acceptedBlocking.map((entry) => entry.id)).toEqual(['F-1']);
  });
});

describe('a finding the verifier brief refused is named as not verified in the list `gate` builds from the recorded state (kata 0g9n)', () => {
  // The MODE=gate payload of Step 10 is the ledger as the state report recorded it and carries no `votes` (Step 3b does not run
  // there). The review runner writes each finding's verification record into that ledger, so the list reads it from there.
  const REFUSAL = { kind: 'leak', input: 'claim', reason: 'the verifier brief refuses its input: \'claim\' reads as the orchestrator ("orchestrator")' };
  const unbriefable = (overrides = {}) => finding({
    id: 'f1',
    verification: { outcome: 'unverified', reason: 'unbriefable', authorLabel: 'unverified', presented: true, tally: null, assigned: [], incompleteVerifiers: [], ignoredVotes: [], unbriefable: REFUSAL },
    ...overrides,
  });
  const verified = (overrides = {}) => finding({
    id: 'f2',
    verification: { outcome: 'present', reason: 'verifier-majority', authorLabel: 'verified', presented: true, tally: { real: 3, notReal: 0, abstain: 0, expected: 3 }, assigned: ['v1', 'v2', 'v3'], incompleteVerifiers: [], ignoredVotes: [] },
    ...overrides,
  });
  const runGate = (payload) => {
    const run = spawnSync('node', [CLI, 'gate'], { input: JSON.stringify(payload), encoding: 'utf8' });
    expect(run.status).toBe(0);
    return JSON.parse(run.stdout);
  };

  test('with no votes supplied the entry says unverified and why, and its votes are none, never a count; a verified finding carries no verification', () => {
    const out = runGate(gateInput({ ledger: [unbriefable(), verified()] }));
    expect(out.mergeable).toBe(false);
    expect(out.findings.open).toEqual(expect.arrayContaining(['f1', 'f2']));
    expect(out.dispositionChoices.find((c) => c.id === 'f1')).toMatchObject({
      group: 'blocking',
      votes: null,
      verification: { outcome: 'unverified', reason: 'unbriefable', unbriefable: REFUSAL },
    });
    expect(out.dispositionChoices.find((c) => c.id === 'f2')).not.toHaveProperty('verification');
  });

  test('the in-process list says the same as the one the CLI returns', () => {
    const list = listFor(gateInput({ ledger: [unbriefable()] }));
    expect(list.dispositionChoices.find((c) => c.id === 'f1')).toMatchObject({ votes: null, verification: { outcome: 'unverified', reason: 'unbriefable', unbriefable: REFUSAL } });
  });
});
