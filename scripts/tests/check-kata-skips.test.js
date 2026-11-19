'use strict';

const { evaluate } = require('../check-kata-skips');

const ledger = (o) => JSON.stringify(o);
const results = (assertions) => ({ testResults: [{ assertionResults: assertions }] });
const a = (status, suite = 'S') => ({ status, title: 't', fullName: `${suite} t`, ancestorTitles: [suite] });

describe('check-kata-skips evaluate (TRD-030 AC-016-2, AC-016-3)', () => {
  test('passes with a nonzero skip count and the reason "tool absent"', () => {
    const r = evaluate([ledger({ suite: 'S', ran: false, reason: 'tool absent', checks: ['t'] })], results([a('pending')]));
    expect(r.ok).toBe(true);
    expect(r.skipped).toHaveLength(1);
  });
  test('fails when the skip count is zero', () => {
    expect(evaluate([], results([a('passed', 'other')])).ok).toBe(false);
  });
  test('fails when a kata-guarded test passed', () => {
    const r = evaluate([ledger({ suite: 'S', ran: false, reason: 'tool absent', checks: ['t'] })], results([a('passed')]));
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/reported passed/);
  });
  test('fails when a guarded suite ran or used another reason', () => {
    expect(evaluate([ledger({ suite: 'S', ran: true, checks: [] })], results([a('pending')])).ok).toBe(false);
    expect(evaluate([ledger({ suite: 'S', ran: false, reason: 'nope', checks: [] })], results([a('pending')])).ok).toBe(false);
  });
});
