'use strict';

/**
 * One reading of a finding, the gate's (kata rsja, 0465): `findingAsGateReads` is what the gate, the run's status counts and the
 * CLI `ledger isActionable` (given a `headSha`) all use; `isNonBlockingDecided` is the one predicate for "this Nit / Pre-existing
 * is decided" behind both the disposition list and the status counts; and `ledger resolve` reads the finding's class from the
 * STORED state by id, never from the payload.
 */

const { evaluateGate } = require('../lib/pr-review-gate');
const { buildDispositionChoices } = require('../lib/pr-review-disposition');
const { isActionable, findingAsGateReads, isNonBlockingDecided, recordStoredResolution } = require('../lib/pr-review-ledger');
const { runLedger } = require('../lib/pr-review-cli');

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const AT = '2026-11-06T10:00:00Z';

const finding = (o = {}) => ({ id: 'F-1', source: 'reviewer', locationOrLink: 'src/a.js:3', severity: 'important', failureMode: 'unchecked input', disposition: 'fix', evidence: 'line 3', originalTextOrLink: 'https://example.invalid/1', ...o });
const decision = (o = {}) => ({ decision: 'accept', reason: 'the operator decided', by: 'ldangelo', at: AT, headSha: HEAD, ...o });
const deferred = (o = {}) => finding({ blocking: false, disposition: 'deferred', reason: 'stopping rule', ...o });

describe('findingAsGateReads: the gate\'s own reading', () => {
  test('an Important deferral (blocking:false + reason) reads as open, as the gate does', () => {
    const entry = deferred();
    expect(isActionable(entry)).toBe(false); // the ledger's raw reading
    expect(isActionable(findingAsGateReads(entry, HEAD, false).entry)).toBe(true);
  });

  test.each([
    ['no decision', decision({ decision: undefined })],
    ['follow-on', decision({ decision: 'follow-on' })],
    ['an earlier head', decision({ headSha: OLD })],
  ])('a resolution with %s is dropped; one with accept for this head is kept', (_n, resolution) => {
    const read = findingAsGateReads(finding({ disposition: 'resolved', resolution }), HEAD, false);
    expect(isActionable(read.entry)).toBe(true);
    expect(read.refusal).toEqual(expect.any(String));
    const kept = findingAsGateReads(finding({ disposition: 'resolved', resolution: decision() }), HEAD, false);
    expect(isActionable(kept.entry)).toBe(false);
    expect(kept.refusal).toBeNull();
  });

  test('a Nit, a Pre-existing finding and a cleared finding are returned as written', () => {
    for (const entry of [finding({ severity: 'nit', resolution: { reason: 'fine' } }), finding({ severity: 'pre-existing' }), finding({ cleared: true, blocking: false })]) {
      expect(findingAsGateReads(entry, HEAD, false)).toEqual({ entry, refusal: null });
    }
  });

  test('the gate\'s verdict is exactly the shared reading, for every case above', () => {
    const cases = [deferred(), finding({ disposition: 'resolved', resolution: decision({ decision: undefined }) }), finding({ disposition: 'resolved', resolution: decision() }), finding({ disposition: 'resolved', resolution: decision({ headSha: OLD }) })];
    for (const entry of cases) {
      const verdict = evaluateGate({ headSha: HEAD, ledger: [entry], approvals: { ok: true, headSha: HEAD, satisfied: true, reason: 'required-approvals-present', tier: 'medium', humansRequired: 1, humansCounted: 1, approvedBy: ['h'], directedBy: null, ignored: [], refusals: [], reasons: [], warnings: [] }, tier: { ok: true, effectiveTier: 'medium' }, description: { ok: true, valid: true, reasons: [] }, security: { status: 'clean', findings: [] }, coverage: { status: 'complete', gaps: [] } });
      const open = isActionable(findingAsGateReads(entry, HEAD, false).entry);
      expect([entry.id, verdict.findings.open.includes(entry.id)]).toEqual([entry.id, open]);
    }
  });
});

describe('CLI ledger isActionable (kata rsja)', () => {
  test('WITH headSha it answers as the gate reads: a deferred Important and a decision-less resolution are actionable', () => {
    expect(runLedger({ action: 'isActionable', finding: deferred(), headSha: HEAD })).toEqual({ actionable: true, reading: 'gate' });
    const noDecision = finding({ disposition: 'resolved', resolution: decision({ decision: undefined }) });
    expect(runLedger({ action: 'isActionable', finding: noDecision, headSha: HEAD })).toMatchObject({ actionable: true, reading: 'gate', resolutionRefused: expect.any(String) });
    expect(runLedger({ action: 'isActionable', finding: finding({ disposition: 'resolved', resolution: decision({ headSha: OLD }) }), headSha: HEAD }).actionable).toBe(true);
    expect(runLedger({ action: 'isActionable', finding: finding({ disposition: 'resolved', resolution: decision() }), headSha: HEAD })).toEqual({ actionable: false, reading: 'gate' });
  });

  test('WITHOUT headSha it is the raw reading, unchanged: just { actionable }', () => {
    expect(runLedger({ action: 'isActionable', finding: deferred() })).toEqual({ actionable: false });
    expect(runLedger({ action: 'isActionable', finding: finding({ resolution: { reason: 'fine' } }) })).toEqual({ actionable: false });
  });

  test('policy is honoured with headSha (a refused login), and policy or lane without headSha is an error', () => {
    const botDecided = finding({ disposition: 'resolved', resolution: decision({ by: '@coderabbitai' }) });
    const policy = { botLogins: ['@coderabbitai'] };
    expect(runLedger({ action: 'isActionable', finding: botDecided, headSha: HEAD, policy }).actionable).toBe(true);
    expect(runLedger({ action: 'isActionable', finding: botDecided, headSha: HEAD }).actionable).toBe(false);
    expect(() => runLedger({ action: 'isActionable', finding: botDecided, policy })).toThrow(/headSha/);
  });
});

describe('one predicate for a decided Nit (kata 0465 part 2)', () => {
  const reasonOnly = finding({ id: 'N-1', severity: 'nit', resolution: { reason: 'fine' } });
  const recorded = finding({ id: 'N-2', severity: 'nit', resolution: decision({ decision: 'follow-on' }) });

  test('isNonBlockingDecided: a bare reason does not decide; a full decision for this head does; another head does not; cleared does', () => {
    expect(isNonBlockingDecided(reasonOnly, HEAD)).toBe(false);
    expect(isNonBlockingDecided(recorded, HEAD)).toBe(true);
    expect(isNonBlockingDecided(recorded, 'c'.repeat(40))).toBe(false);
    expect(isNonBlockingDecided(finding({ severity: 'nit', cleared: true }), HEAD)).toBe(true);
    expect(isNonBlockingDecided(finding({ severity: 'pre-existing' }), HEAD)).toBe(false);
  });

  test('the disposition list asks about exactly the Nits the predicate calls undecided, and the verdict ignores both', () => {
    const list = buildDispositionChoices({ ledger: [reasonOnly, recorded], headSha: HEAD });
    expect(list.dispositionChoices.map((c) => c.id)).toEqual(['N-1']);
    // A Nit never blocks and the raw reading calls the reason-only one closed: no fix round either way.
    expect(isActionable(reasonOnly)).toBe(false);
  });
});

describe('recordStoredResolution / `ledger resolve` reads the STORED record (kata 0465 part 3)', () => {
  const stored = finding({ id: 'S-1', severity: 'nit' });
  const important = finding({ id: 'I-1' });
  const lane = finding({ id: 'L-1', severity: 'nit' }); // a Nit by severity, but held in the security lane
  const gap = { id: 'slice:s1', paths: ['x'] };
  const state = { ledger: [stored, important], security: { status: 'findings', findings: [lane] }, coverage: { gaps: [gap] } };
  const ask = (o) => runLedger({ action: 'resolve', resolution: decision(), ...state, ...o });

  test('returns the STORED finding with the resolution attached, and says where it came from', () => {
    const out = ask({ id: 'I-1' });
    expect(out.finding).toMatchObject({ ...important, disposition: 'resolved', resolution: { decision: 'accept', by: 'ldangelo', headSha: HEAD } });
    expect(out).toMatchObject({ lane: false, source: 'ledger' });
  });

  test('a relabelled severity is refused: an Important claimed as a Nit would record a follow-on the gate ignores', () => {
    expect(() => ask({ id: 'I-1', severity: 'nit', resolution: decision({ decision: 'follow-on' }) })).toThrow(/stored/);
    expect(() => ask({ id: 'I-1', severity: 'nit' })).toThrow(/severity/);
    // the same follow-on with NO claimed class is refused too, because the stored class is Important
    expect(() => ask({ id: 'I-1', resolution: decision({ decision: 'follow-on' }) })).toThrow(/follow-on/);
  });

  test('an unknown id is refused', () => {
    expect(() => ask({ id: 'nope' })).toThrow(/no stored finding has id/);
    expect(recordStoredResolution({ id: 'nope', resolution: decision(), ledger: [] })).toMatchObject({ ok: false });
  });

  test('the lane comes from where the stored finding lives: a security Nit takes accept only, a ledger Nit takes follow-on', () => {
    expect(() => ask({ id: 'L-1', resolution: decision({ decision: 'follow-on' }) })).toThrow(/follow-on/);
    expect(ask({ id: 'L-1' })).toMatchObject({ lane: true, source: 'security' });
    expect(ask({ id: 'S-1', resolution: decision({ decision: 'follow-on' }) })).toMatchObject({ lane: false, source: 'ledger' });
    expect(() => ask({ id: 'S-1', lane: true })).toThrow(/lane/);
    expect(() => ask({ id: 'L-1', lane: false })).toThrow(/lane/);
    expect(ask({ id: 'L-1', lane: true }).lane).toBe(true);
  });

  test('an unknown key is refused, so a misspelt policy is a CLI error and never read as no policy', () => {
    expect(() => ask({ id: 'I-1', polciy: { botLogins: ['ldangelo'] } })).toThrow(/does not take 'polciy'/);
    expect(() => ask({ id: 'I-1', policy: { botLogins: ['ldangelo'] } })).toThrow(/bot login/);
  });

  test('a lane Nit with a follow-on reads as not actionable without lane and actionable with it, as at the gate', () => {
    const laneNit = finding({ id: 'L-1', severity: 'nit', disposition: 'resolved', resolution: decision({ decision: 'follow-on' }) });
    expect(runLedger({ action: 'isActionable', finding: laneNit, headSha: HEAD }).actionable).toBe(false);
    expect(runLedger({ action: 'isActionable', finding: laneNit, headSha: HEAD, lane: true }).actionable).toBe(true);
  });

  test('a coverage gap is found in the stored coverage record', () => {
    expect(ask({ id: 'slice:s1' })).toMatchObject({ source: 'coverage', finding: { id: 'slice:s1', resolution: expect.any(Object) } });
  });

  test('the old payload shape ({ finding, lane }) is refused, and the ledger and the security record are read as the stored state', () => {
    expect(() => runLedger({ action: 'resolve', finding: important, resolution: decision() })).toThrow(/no longer takes a 'finding'/);
    expect(() => runLedger({ action: 'resolve', finding: important, id: 'I-1', ledger: [important], resolution: decision() })).toThrow(/no longer takes a 'finding'/);
    expect(recordStoredResolution({ id: 'L-1', resolution: decision(), ledger: [], security: [lane] })).toMatchObject({ ok: true, lane: true });
    expect(recordStoredResolution({ id: 'I-1', resolution: decision(), ledger: [important, important] })).toMatchObject({ ok: false, reason: expect.stringContaining('2 entries') });
  });
});
