'use strict';

/**
 * Tests for `buildDispositionChoices`
 * (packages/development/lib/pr-review-disposition.js).
 *
 * In-process calls against the pure module.
 */

const { buildDispositionChoices, COLLAPSE_THRESHOLD } = require('../lib/pr-review-disposition');

const HEAD = 'a'.repeat(40);

/** A ledger finding with every required field, overridable per test. */
function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'packages/development/lib/x.js:12',
    severity: 'important',
    failureMode: 'unchecked input',
    disposition: 'fix',
    evidence: 'line 12',
    originalTextOrLink: 'https://example.invalid/pr/1#r1',
    ...overrides,
  };
}

function build(ledger, extra = {}) {
  return buildDispositionChoices({ ledger, headSha: HEAD, ...extra });
}

function resolution(overrides = {}) {
  return { reason: 'accepted: low risk', by: 'octocat', at: '2026-01-01T00:00:00Z', headSha: HEAD, ...overrides };
}

function acceptChoice(entry) {
  return entry.choices.find((c) => c.id === 'accept');
}

function nits(count, file = 'lib/same.js', overrides = {}) {
  return Array.from({ length: count }, (_, i) =>
    finding({ id: `N-${i + 1}`, severity: 'nit', locationOrLink: `${file}:${i + 1}`, ...overrides }));
}

describe('buildDispositionChoices', () => {
  test('#235 worked example: nit, nit, pre-existing security; all default follow-on', () => {
    const result = build([
      finding({ id: 'N2-01', severity: 'Nit', locationOrLink: 'pr-review-paths.js:190-191' }),
      finding({ id: 'F-04', severity: 'nit', locationOrLink: 'pr-review-paths.js:40' }),
      finding({ id: 'F-05', severity: 'pre-existing', locationOrLink: 'pr-review-paths.js:192', security: true }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.dispositionChoices.map((e) => e.id)).toEqual(['N2-01', 'F-04', 'F-05']);
    expect(result.dispositionChoices.map((e) => e.group)).toEqual(['nit', 'nit', 'pre-existing']);
    expect(result.dispositionChoices.map((e) => e.default)).toEqual(['follow-on', 'follow-on', 'follow-on']);
    expect(result.dispositionChoices[2].security).toBe(true);
  });

  test('blocking Important offers only fix-here/accept, defaults to fix-here', () => {
    const [entry] = build([finding()]).dispositionChoices;
    expect(entry.group).toBe('blocking');
    expect(entry.choices.map((c) => c.id)).toEqual(['fix-here', 'accept']);
    expect(entry.default).toBe('fix-here');
    expect(entry.requiresReason).toBe(true);
    expect(acceptChoice(entry).default).toBe(false);
    expect(acceptChoice(entry).batchable).toBe(false);
    expect(entry.choices.filter((c) => c.default).map((c) => c.id)).toEqual(['fix-here']);
  });

  test('unrecognised severity is blocking and keeps its raw word', () => {
    const [entry] = build([finding({ severity: 'catastrophic-ish' })]).dispositionChoices;
    expect(entry.group).toBe('blocking');
    expect(entry.severity).toBe('catastrophic-ish');
  });

  test('blocking security finding: same choices, reasonPerFinding, security first', () => {
    const result = build([
      finding({ id: 'F-1' }),
      finding({ id: 'S-1', severity: 'important', security: true }),
    ]);
    expect(result.dispositionChoices.map((e) => e.id)).toEqual(['S-1', 'F-1']);
    const sec = result.dispositionChoices[0];
    expect(sec.choices.map((c) => c.id)).toEqual(['fix-here', 'accept']);
    expect(sec.default).toBe('fix-here');
    expect(sec.requiresReason).toBe(true);
    expect(sec.reasonPerFinding).toBe(true);
  });

  test('security lane findings and Critical severity are security even without a flag', () => {
    const result = build([finding({ id: 'C-1', severity: 'critical' })], {
      security: { status: 'complete', findings: [finding({ id: 'L-1', severity: 'nit' })] },
    });
    const byId = Object.fromEntries(result.dispositionChoices.map((e) => [e.id, e]));
    expect(byId['C-1'].security).toBe(true);
    expect(byId['L-1'].security).toBe(true);
    expect(byId['L-1'].group).toBe('blocking');
  });

  test('same id in ledger and security lane is one security finding', () => {
    const result = build([finding({ id: 'D-1' })], { security: { findings: [finding({ id: 'D-1' })] } });
    expect(result.dispositionChoices).toHaveLength(1);
    expect(result.dispositionChoices[0].security).toBe(true);
  });

  test('AC3: security accept is never default/batchable and never in batchChoices', () => {
    const result = build([
      finding({ id: 'N-1', severity: 'nit', locationOrLink: 'a.js:1' }),
      finding({ id: 'P-1', severity: 'pre-existing', locationOrLink: 'b.js:1', security: true }),
      finding({ id: 'P-2', severity: 'pre-existing', locationOrLink: 'c.js:1' }),
      finding({ id: 'S-1', security: true }),
    ]);
    const sec = result.dispositionChoices.find((e) => e.id === 'P-1');
    expect(sec.default).toBe('follow-on');
    expect(sec.reasonPerFinding).toBe(true);
    const accept = acceptChoice(sec);
    expect(accept).toMatchObject({ default: false, batchable: false, requiresReason: true });
    const group = (name) => result.groups.find((g) => g.group === name);
    expect(group('pre-existing').batchChoices).not.toContain('accept');
    expect(group('blocking').batchChoices).toEqual(['fix-here']);
    expect(group('nit').batchChoices).toContain('accept');
    // pure pre-existing group without security does batch accept
    const pure = build([finding({ id: 'P-2', severity: 'pre-existing', locationOrLink: 'c.js:1' })]);
    expect(pure.groups[0].batchChoices).toContain('accept');
    expect(result.groups.map((g) => g.group)).toEqual(['blocking', 'nit', 'pre-existing']);
  });

  test('valid-provenance resolution: not listed, reported as accepted blocking', () => {
    const result = build([finding({ id: 'F-1', resolution: resolution() })]);
    expect(result.dispositionChoices).toEqual([]);
    expect(result.mergeConfirmation.acceptedBlocking).toEqual([
      { id: 'F-1', severity: 'important', security: false, reason: 'accepted: low risk', by: 'octocat', at: '2026-01-01T00:00:00Z' },
    ]);
    expect(result.mergeConfirmation.summary).toMatch(/F-1: accepted: low risk/);
  });

  test('stale or unattributed resolution is listed again as staleResolution', () => {
    const result = build([
      finding({ id: 'F-1', resolution: resolution({ headSha: 'b'.repeat(40) }) }),
      finding({ id: 'F-2', resolution: resolution({ by: '' }) }),
    ]);
    expect(result.dispositionChoices.map((e) => e.id)).toEqual(['F-1', 'F-2']);
    expect(result.dispositionChoices.every((e) => e.staleResolution === true)).toBe(true);
    expect(result.mergeConfirmation.acceptedBlocking).toEqual([]);
    expect(result.mergeConfirmation.staleResolutions).toEqual(['F-1', 'F-2']);
  });

  test('cleared findings are not listed', () => {
    expect(build([finding({ cleared: true })]).dispositionChoices).toEqual([]);
  });

  test('votes: tally attached, absent votes null; a filtered finding is listed while the gate blocks on it, hidden when it never would', () => {
    const votes = {
      ok: true,
      findings: [
        { id: 'F-1', outcome: 'present', presented: true, tally: { real: 2, notReal: 1, abstain: 0, expected: 3, needed: 2 } },
        { id: 'F-2', outcome: 'filtered', presented: false, tally: { real: 0, notReal: 3, abstain: 0, expected: 3, needed: 2 } },
        { id: 'N-1', outcome: 'filtered', presented: false, tally: { real: 0, notReal: 3, abstain: 0, expected: 3, needed: 2 } },
      ],
    };
    const result = build([finding({ id: 'F-1' }), finding({ id: 'F-2' }), finding({ id: 'F-3' }), finding({ id: 'N-1', severity: 'nit' })], { votes });
    // F-2 is Important: the gate still blocks on it (it reads no vote), so the list must ask about it, showing the tally that filtered it.
    // N-1 is a Nit: the gate never blocks on it, so a verifier-filtered Nit is not asked about.
    expect(result.dispositionChoices.map((e) => e.id)).toEqual(['F-1', 'F-2', 'F-3']);
    expect(result.dispositionChoices[0].votes).toEqual({ real: 2, notReal: 1, abstain: 0, expected: 3 });
    expect(result.dispositionChoices[1].votes).toEqual({ real: 0, notReal: 3, abstain: 0, expected: 3 });
    expect(result.dispositionChoices[2].votes).toBeNull();
    expect(build([finding()]).dispositionChoices[0].votes).toBeNull();
  });

  test('collapse boundary: threshold stays individual, one more collapses', () => {
    const same = build(nits(COLLAPSE_THRESHOLD));
    expect(same.dispositionChoices).toHaveLength(COLLAPSE_THRESHOLD);
    const over = build(nits(COLLAPSE_THRESHOLD + 1), {
      votes: {
        ok: true,
        findings: [
          { id: 'N-1', presented: true, tally: { real: 2, notReal: 1, abstain: 0, expected: 3 } },
          { id: 'N-2', presented: true, tally: { real: 1, notReal: 1, abstain: 1, expected: 5 } },
        ],
      },
    });
    expect(over.dispositionChoices).toHaveLength(1);
    const [entry] = over.dispositionChoices;
    expect(entry).toMatchObject({ id: 'file:lib/same.js', collapsed: true, file: 'lib/same.js', group: 'nit', beadId: null });
    expect(entry.members.map((m) => m.id)).toEqual(['N-1', 'N-2', 'N-3', 'N-4']);
    expect(entry.votes).toEqual({ real: 3, notReal: 2, abstain: 1, expected: 5 });
    expect(entry.default).toBe('follow-on');
    expect(over.groups[0].ids).toEqual(['file:lib/same.js']);
  });

  test('blocking and security findings never collapse', () => {
    const blocking = build(nits(5, 'lib/same.js', { severity: 'important' }));
    expect(blocking.dispositionChoices).toHaveLength(5);
    expect(blocking.dispositionChoices.every((e) => e.collapsed === undefined)).toBe(true);
    const security = build(nits(5, 'lib/same.js', { severity: 'pre-existing', security: true }));
    expect(security.dispositionChoices).toHaveLength(5);
    expect(security.dispositionChoices.every((e) => e.collapsed === undefined)).toBe(true);
    // security findings do not count toward a non-security bucket either
    const mixed = build([...nits(3), finding({ id: 'S-9', severity: 'nit', locationOrLink: 'lib/same.js:99', security: true })]);
    expect(mixed.dispositionChoices.some((e) => e.collapsed)).toBe(false);
  });

  test('collapse uses finding.file or a path:range location', () => {
    const viaFile = build(nits(4, 'ignored', {}).map((f, i) => ({ ...f, locationOrLink: `https://x.invalid/${i}`, file: 'lib/f.js' })));
    expect(viaFile.dispositionChoices[0].id).toBe('file:lib/f.js');
    const viaRange = build(Array.from({ length: 4 }, (_, i) => finding({ id: `R-${i}`, severity: 'nit', locationOrLink: `lib/r.js:${i}-${i + 3}` })));
    expect(viaRange.dispositionChoices[0].id).toBe('file:lib/r.js');
  });

  test('fail closed on unreadable input', () => {
    const empty = { ok: false, dispositionChoices: [], groups: [], mergeConfirmation: null };
    for (const bad of [
      buildDispositionChoices(null),
      buildDispositionChoices({ ledger: {}, headSha: HEAD }),
      buildDispositionChoices({ ledger: [] }),
      build([finding(), 'oops']),
      build([finding()], { security: { findings: [null] } }),
    ]) {
      expect(bad).toMatchObject(empty);
      expect(typeof bad.reason).toBe('string');
    }
  });

  test('beadId and openBeads counting, including collapsed members', () => {
    const ledger = [
      finding({ id: 'F-1', beadId: 'bd-1' }),
      finding({ id: 'F-2' }),
      ...nits(4).map((f, i) => (i < 2 ? { ...f, beadId: `bd-n${i}` } : f)),
    ];
    const result = build(ledger);
    expect(result.dispositionChoices[0].beadId).toBe('bd-1');
    expect(result.dispositionChoices[1].beadId).toBeNull();
    const collapsed = result.dispositionChoices[2];
    expect(collapsed.beadIds).toEqual(['bd-n0', 'bd-n1']);
    expect(result.mergeConfirmation.openBeads).toBe(3);
    expect(result.mergeConfirmation.findingsWithoutBead).toBe(3);
    expect(result.mergeConfirmation.undecidedBlocking).toEqual(['F-1', 'F-2']);
    expect(result.mergeConfirmation.undecided).toEqual(['F-1', 'F-2', 'file:lib/same.js']);
  });

  test('a numeric finding id is listed, and a vote written with the text form of it still attaches (the gate accepts numeric ids)', () => {
    const votes = { ok: true, findings: [{ id: '7', outcome: 'present', presented: true, tally: { real: 3, notReal: 0, abstain: 0, expected: 3 } }] };
    const result = build([finding({ id: 7 })], { votes });

    expect(result.ok).toBe(true);
    expect(result.dispositionChoices.map((e) => e.id)).toEqual([7]);
    expect(result.dispositionChoices[0].votes).toEqual({ real: 3, notReal: 0, abstain: 0, expected: 3 });
  });
});
