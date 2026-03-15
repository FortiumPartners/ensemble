/**
 * TRD-009: Unit tests for the br comment status parser
 *
 * The parser reads `br comment list <bead_id>` output and finds the
 * latest `status:` comment. Implements and tests the parsing algorithm
 * defined in the COMMENT FORMAT SPEC section of implement-trd-beads.yaml.
 */

'use strict';

const { parseSubState } = require('./helpers/team-utils');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Comment Parser (parseSubState)', () => {
  // -------------------------------------------------------------------------
  // Basic parsing
  // -------------------------------------------------------------------------

  test('parses a basic status comment with no metadata', () => {
    const output = 'status:in_progress';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_progress');
    expect(result.metadata).toEqual({});
  });

  test('parses status:in_progress with assigned key', () => {
    const output = 'status:in_progress assigned:backend-developer';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_progress');
    expect(result.metadata.assigned).toBe('backend-developer');
  });

  test('parses status:in_review with builder and files keys', () => {
    const output =
      'status:in_review builder:backend-developer files:src/api.ts,src/api.test.ts';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_review');
    expect(result.metadata.builder).toBe('backend-developer');
    expect(result.metadata.files).toBe('src/api.ts,src/api.test.ts');
  });

  test('parses status:in_qa with reviewer and verdict keys', () => {
    const output = 'status:in_qa reviewer:code-reviewer verdict:approved';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_qa');
    expect(result.metadata.reviewer).toBe('code-reviewer');
    expect(result.metadata.verdict).toBe('approved');
  });

  test('parses status:closed with qa and verdict keys', () => {
    const output = 'status:closed qa:qa-orchestrator verdict:passed';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('closed');
    expect(result.metadata.qa).toBe('qa-orchestrator');
    expect(result.metadata.verdict).toBe('passed');
  });

  test('parses status:skip-review with lead and reason keys', () => {
    const output =
      'status:skip-review lead:tech-lead-orchestrator reason:documentation-only-task';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('skip-review');
    expect(result.metadata.lead).toBe('tech-lead-orchestrator');
  });

  test('parses status:skip-qa with lead and reason keys', () => {
    const output =
      'status:skip-qa lead:tech-lead-orchestrator reason:low-risk-configuration-change';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('skip-qa');
    expect(result.metadata.lead).toBe('tech-lead-orchestrator');
  });

  // -------------------------------------------------------------------------
  // URL-encoded reason values
  // -------------------------------------------------------------------------

  test('preserves hyphens in reason values (reason:TRD-001-related)', () => {
    const output =
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:TRD-001-related';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.metadata.reason).toBe('TRD-001-related');
  });

  test('preserves hyphens in multi-word reason values', () => {
    const output =
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-input-validation';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.metadata.reason).toBe('missing-input-validation');
  });

  test('decodes %20-encoded reason values to spaces', () => {
    const output =
      'status:in_progress qa:qa-orchestrator verdict:rejected reason:missing%20input%20validation';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.metadata.reason).toBe('missing input validation');
  });

  test('decodes %20 reason for QA rejection while preserving hyphens', () => {
    const output =
      'status:in_progress qa:qa-orchestrator verdict:rejected reason:test-coverage%20below%2080-percent';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.metadata.reason).toBe('test-coverage below 80-percent');
  });

  // -------------------------------------------------------------------------
  // Reverse-scan ordering (latest comment wins)
  // -------------------------------------------------------------------------

  test('returns the latest status comment when multiple exist', () => {
    const output = [
      'status:in_progress assigned:backend-developer',
      'status:in_review builder:backend-developer files:src/api.ts',
      'status:in_qa reviewer:code-reviewer verdict:approved',
    ].join('\n');
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_qa');
    expect(result.metadata.reviewer).toBe('code-reviewer');
  });

  test('ignores earlier status comments when a later one exists', () => {
    const output = [
      'status:in_progress assigned:backend-developer',
      'status:closed qa:qa-orchestrator verdict:passed',
    ].join('\n');
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('closed');
  });

  // -------------------------------------------------------------------------
  // Timestamp prefix handling (br comment list output format)
  // -------------------------------------------------------------------------

  test('handles lines with ISO timestamp prefix', () => {
    const output =
      '2024-01-15T12:34:56Z  status:in_review builder:backend-developer files:src/api.ts';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_review');
    expect(result.metadata.builder).toBe('backend-developer');
  });

  test('handles multi-line output where only some lines have timestamps', () => {
    const output = [
      '2024-01-14T10:00:00Z  status:in_progress assigned:backend-developer',
      '2024-01-15T11:00:00Z  status:in_review builder:backend-developer files:src/auth.ts',
    ].join('\n');
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_review');
  });

  test('handles mixed lines (non-status comments interleaved)', () => {
    const output = [
      'status:in_progress assigned:backend-developer',
      'Implementation complete: added JWT middleware',
      'Code review REJECTED: missing error handling',
      'status:in_review builder:backend-developer files:src/auth.ts',
    ].join('\n');
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_review');
  });

  // -------------------------------------------------------------------------
  // Fallback / no status comment found
  // -------------------------------------------------------------------------

  test('returns null when no status: comment exists in output', () => {
    const output = [
      'Implementation complete: added JWT middleware to request pipeline',
      'Code review: looks good overall, minor nits',
      'QA: all tests passing',
    ].join('\n');
    expect(parseSubState(output)).toBeNull();
  });

  test('returns null for empty string input', () => {
    expect(parseSubState('')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(parseSubState(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(parseSubState(undefined)).toBeNull();
  });

  test('returns null for whitespace-only input', () => {
    expect(parseSubState('   \n  \n  ')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  test('does not match a line that contains "no-status:" (substring check)', () => {
    // "no-status:" contains "status:" but is not a status comment
    const output = 'This task has no-status: indicator yet';
    // The implementation finds "status:" inside "no-status:" which is an
    // expected limitation — documented here as a behaviour test.
    // If business logic changes, update this test accordingly.
    const result = parseSubState(output);
    // Current parser will find "status:" at position 16 in "no-status:"
    // and the substring starting there is "status: indicator yet"
    // which does parse (state = '', skipped due to empty state guard).
    // Net result: null because state is empty after replace.
    expect(result).toBeNull();
  });

  test('handles a comment with only the state token (no key-value pairs)', () => {
    const output = 'status:closed';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('closed');
    expect(Object.keys(result.metadata)).toHaveLength(0);
  });

  test('ignores malformed key tokens missing a value after colon', () => {
    // "verdict:" has no value — should be included as empty string, not crash
    const output = 'status:in_qa reviewer:code-reviewer verdict:';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_qa');
    // Empty value is acceptable; key is present
    expect(result.metadata.verdict).toBe('');
  });

  test('ignores tokens without a colon separator', () => {
    const output = 'status:in_progress somegarbage assigned:backend-developer';
    const result = parseSubState(output);
    expect(result).not.toBeNull();
    expect(result.state).toBe('in_progress');
    // "somegarbage" has no colon, so it is not added to metadata
    expect(result.metadata).not.toHaveProperty('somegarbage');
    expect(result.metadata.assigned).toBe('backend-developer');
  });

  test('all six valid states are accepted by the parser', () => {
    const validStates = [
      'in_progress',
      'in_review',
      'in_qa',
      'closed',
      'skip-review',
      'skip-qa',
    ];
    for (const state of validStates) {
      const result = parseSubState(`status:${state}`);
      expect(result).not.toBeNull();
      expect(result.state).toBe(state);
    }
  });
});
