'use strict';

const fs = require('fs');
const path = require('path');
const { parsePRD, deriveLabel } = require('../lib/prd-feature-parser');

const SAMPLE = fs.readFileSync(
  path.join(__dirname, 'fixtures/PRD-sample.md'),
  'utf8'
);

describe('parsePRD', () => {
  const prd = parsePRD(SAMPLE);

  test('extracts frontmatter (micro-uuid document id, version, status)', () => {
    expect(prd.documentId).toBe('PRD-2026-a1b2c3d4');
    expect(prd.version).toBe('1.2.0');
    expect(prd.status).toBe('Draft');
    expect(prd.date).toBe('2026-06-29');
  });

  test('extracts both requirements with id, title, MoSCoW and complexity', () => {
    expect(prd.reqs.map((r) => r.id)).toEqual(['REQ-001', 'REQ-002']);
    const req1 = prd.reqs[0];
    expect(req1.title).toBe('User Authentication');
    expect(req1.moscow).toBe('Must');
    expect(req1.complexity).toBe('Medium');
  });

  test('collects ACs under their owning requirement only', () => {
    expect(prd.reqs[0].acs.map((a) => a.id)).toEqual(['AC-001-1', 'AC-001-2']);
    expect(prd.reqs[1].acs.map((a) => a.id)).toEqual([
      'AC-002-1',
      'AC-002-2',
      'AC-002-3',
    ]);
  });

  test('accepts both bold and plain AC marker forms', () => {
    // AC-001-1 is bold (**AC-001-1:**), AC-002-1 is plain (AC-002-1:)
    const ac1 = prd.reqs[0].acs[0];
    const ac2 = prd.reqs[1].acs[0];
    expect(ac1.given).toBeTruthy();
    expect(ac2.given).toBeTruthy();
  });

  test('splits a single AC sentence into Given/When/Then clauses', () => {
    const ac = prd.reqs[0].acs[0]; // AC-001-1
    expect(ac.given).toBe('a user with valid credentials');
    expect(ac.when).toBe('they submit the login form');
    expect(ac.then).toBe('they are authenticated and see the dashboard');
    expect(ac.needsClarification).toBe(false);
  });

  test('keeps natural-prose "and" inside the Then clause (no over-splitting)', () => {
    const ac = parsePRD(
      '### REQ-009: x\n- AC-009-1: Given a path, when it runs, then a, b, and c happen.\n'
    ).reqs[0].acs[0];
    expect(ac.then).toBe('a, b, and c happen');
  });

  test('flags free-form ACs (no Given/When/Then) as needing clarification', () => {
    const ac = prd.reqs[1].acs[1]; // AC-002-2 (free-form)
    expect(ac.given).toBeNull();
    expect(ac.needsClarification).toBe(true);
    expect(ac.raw).toContain('password complexity');
  });

  test('flags ACs carrying an inline [NEEDS CLARIFICATION] marker', () => {
    const ac = prd.reqs[1].acs[2]; // AC-002-3
    expect(ac.needsClarification).toBe(true);
  });

  test('parses sequence-style document ids too', () => {
    const seq = parsePRD('---\ndocument_id: PRD-2026-023\nversion: 1.0.0\n---\n# x\n');
    expect(seq.documentId).toBe('PRD-2026-023');
  });

  test('surfaces the human-readable label from frontmatter', () => {
    expect(prd.label).toBe('prd-sample-feature');
  });

  test('label is null when absent (legacy docs)', () => {
    const legacy = parsePRD('---\ndocument_id: PRD-2026-023\n---\n# x\n');
    expect(legacy.label).toBeNull();
  });
});

describe('parsePRD — CRLF line endings', () => {
  // Deliberately constructed CRLF variant, independent of the checked-out
  // fixture's own line endings (which vary by OS/core.autocrlf and would
  // otherwise hide this regression on an LF checkout, e.g. Linux CI). Every
  // heading/AC-line regex is `$`-anchored, and JS regex treats a lone
  // trailing `\r` as its own line terminator that `.` cannot consume, so a
  // CRLF-sourced PRD (the norm on Windows checkouts with core.autocrlf=true)
  // silently failed REQ/AC extraction and frontmatter parsing before this fix.
  const CRLF_SAMPLE = SAMPLE.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

  test('extracts frontmatter despite trailing \\r on delimiter/field lines', () => {
    const prd = parsePRD(CRLF_SAMPLE);
    expect(prd.documentId).toBe('PRD-2026-a1b2c3d4');
    expect(prd.label).toBe('prd-sample-feature');
  });

  test('still finds every REQ and AC despite trailing \\r on heading/bullet lines', () => {
    const prd = parsePRD(CRLF_SAMPLE);
    expect(prd.reqs.map((r) => r.id)).toEqual(['REQ-001', 'REQ-002']);
    expect(prd.reqs[0].acs.map((a) => a.id)).toEqual(['AC-001-1', 'AC-001-2']);
    expect(prd.reqs[1].acs.map((a) => a.id)).toEqual(['AC-002-1', 'AC-002-2', 'AC-002-3']);
  });

  test('still splits Given/When/Then despite trailing \\r', () => {
    const ac = parsePRD(CRLF_SAMPLE).reqs[0].acs[0];
    expect(ac.given).toBe('a user with valid credentials');
    expect(ac.then).toBe('they are authenticated and see the dashboard');
  });
});

describe('deriveLabel (display fallback for docs without an authored label)', () => {
  test('prefixes with prd/trd from the document id and kebabs the title', () => {
    expect(deriveLabel('PRD-2026-a1b2c3d4', 'Multi TRD Beads Workstream')).toBe(
      'prd-multi-trd-beads-workstream'
    );
    expect(deriveLabel('TRD-2026-a1b2c3d4', 'Multi TRD Beads Workstream')).toBe(
      'trd-multi-trd-beads-workstream'
    );
  });

  test('falls back to a generic doc- prefix for unknown id shapes', () => {
    expect(deriveLabel('XYZ-1', 'Some Thing')).toBe('doc-some-thing');
  });

  test('strips a leading doc-id token from the title (legacy H1 embeds the id)', () => {
    // Legacy titles look like "# PRD-2026-023: Multi-TRD Beads Workstream"
    expect(deriveLabel('PRD-2026-023', 'PRD-2026-023: Multi-TRD Beads Workstream')).toBe(
      'prd-multi-trd-beads-workstream'
    );
  });
});
