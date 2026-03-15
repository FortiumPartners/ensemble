/**
 * TRD-010: Unit tests for state machine transitions
 *
 * Validates the transition table and validator function used by the
 * implement-trd-beads workflow. Covers all 8 valid transitions, invalid
 * transitions, rejection cycle counting, escalation thresholds, and skip paths.
 */

'use strict';

const {
  VALID_TRANSITIONS,
  validateTransition,
  countRejections,
  MAX_REJECTIONS,
  requiresEscalation,
} = require('./helpers/team-utils');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('State Machine (validateTransition)', () => {
  // -------------------------------------------------------------------------
  // Valid transitions (8 total)
  // -------------------------------------------------------------------------

  describe('valid transitions', () => {
    test('open -> in_progress is valid (builder claims task)', () => {
      expect(validateTransition('open', 'in_progress')).toBe(true);
    });

    test('in_progress -> in_review is valid (builder submits for review)', () => {
      expect(validateTransition('in_progress', 'in_review')).toBe(true);
    });

    test('in_progress -> in_qa is valid (lead skips review via skip-review)', () => {
      expect(validateTransition('in_progress', 'in_qa')).toBe(true);
    });

    test('in_progress -> closed is valid (lead skips all stages)', () => {
      expect(validateTransition('in_progress', 'closed')).toBe(true);
    });

    test('in_review -> in_qa is valid (reviewer approves)', () => {
      expect(validateTransition('in_review', 'in_qa')).toBe(true);
    });

    test('in_review -> in_progress is valid (reviewer rejects, send back)', () => {
      expect(validateTransition('in_review', 'in_progress')).toBe(true);
    });

    test('in_qa -> closed is valid (QA passes)', () => {
      expect(validateTransition('in_qa', 'closed')).toBe(true);
    });

    test('in_qa -> in_progress is valid (QA rejects, send back)', () => {
      expect(validateTransition('in_qa', 'in_progress')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid transitions
  // -------------------------------------------------------------------------

  describe('invalid transitions', () => {
    test('open -> in_qa is invalid (cannot skip builder step)', () => {
      expect(validateTransition('open', 'in_qa')).toBe(false);
    });

    test('open -> closed is invalid', () => {
      expect(validateTransition('open', 'closed')).toBe(false);
    });

    test('open -> in_review is invalid', () => {
      expect(validateTransition('open', 'in_review')).toBe(false);
    });

    test('closed -> in_progress is invalid (closed is terminal)', () => {
      expect(validateTransition('closed', 'in_progress')).toBe(false);
    });

    test('closed -> in_review is invalid', () => {
      expect(validateTransition('closed', 'in_review')).toBe(false);
    });

    test('closed -> in_qa is invalid', () => {
      expect(validateTransition('closed', 'in_qa')).toBe(false);
    });

    test('closed -> open is invalid', () => {
      expect(validateTransition('closed', 'open')).toBe(false);
    });

    test('in_review -> open is invalid', () => {
      expect(validateTransition('in_review', 'open')).toBe(false);
    });

    test('in_review -> closed is invalid (must go through QA first)', () => {
      expect(validateTransition('in_review', 'closed')).toBe(false);
    });

    test('in_qa -> open is invalid', () => {
      expect(validateTransition('in_qa', 'open')).toBe(false);
    });

    test('in_qa -> in_review is invalid (QA cannot send back to review)', () => {
      expect(validateTransition('in_qa', 'in_review')).toBe(false);
    });

    test('in_progress -> open is invalid', () => {
      expect(validateTransition('in_progress', 'open')).toBe(false);
    });

    test('unknown state -> in_progress is invalid', () => {
      expect(validateTransition('nonexistent', 'in_progress')).toBe(false);
    });

    test('undefined current state is invalid', () => {
      expect(validateTransition(undefined, 'in_progress')).toBe(false);
    });

    test('null current state is invalid', () => {
      expect(validateTransition(null, 'in_progress')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Self-transitions
  // -------------------------------------------------------------------------

  describe('self-transitions (same state -> same state)', () => {
    test('open -> open is invalid', () => {
      expect(validateTransition('open', 'open')).toBe(false);
    });

    test('in_progress -> in_progress is invalid', () => {
      expect(validateTransition('in_progress', 'in_progress')).toBe(false);
    });

    test('in_review -> in_review is invalid', () => {
      expect(validateTransition('in_review', 'in_review')).toBe(false);
    });

    test('in_qa -> in_qa is invalid', () => {
      expect(validateTransition('in_qa', 'in_qa')).toBe(false);
    });

    test('closed -> closed is invalid', () => {
      expect(validateTransition('closed', 'closed')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Rejection cycle counting
// ---------------------------------------------------------------------------

describe('Rejection cycle tracking (countRejections)', () => {
  test('returns 0 for empty comment list', () => {
    expect(countRejections('')).toBe(0);
  });

  test('returns 0 when no verdict:rejected comments exist', () => {
    const output = [
      'status:in_progress assigned:backend-developer',
      'status:in_review builder:backend-developer files:src/api.ts',
      'status:in_qa reviewer:code-reviewer verdict:approved',
    ].join('\n');
    expect(countRejections(output)).toBe(0);
  });

  test('counts a single verdict:rejected correctly', () => {
    const output = [
      'status:in_progress assigned:backend-developer',
      'status:in_review builder:backend-developer files:src/api.ts',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-input-validation',
    ].join('\n');
    expect(countRejections(output)).toBe(1);
  });

  test('counts two verdict:rejected comments correctly', () => {
    const output = [
      'status:in_progress assigned:backend-developer',
      'status:in_review builder:backend-developer files:src/api.ts',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-input-validation',
      'status:in_review builder:backend-developer files:src/api.ts',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:still-missing-validation',
    ].join('\n');
    expect(countRejections(output)).toBe(2);
  });

  test('counts rejections from both reviewer and QA stages', () => {
    const output = [
      'status:in_review builder:backend-developer files:src/api.ts',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-error-handling',
      'status:in_review builder:backend-developer files:src/api.ts',
      'status:in_qa reviewer:code-reviewer verdict:approved',
      'status:in_progress qa:qa-orchestrator verdict:rejected reason:test-coverage-below-80-percent',
    ].join('\n');
    expect(countRejections(output)).toBe(2);
  });

  test('returns 0 for null input', () => {
    expect(countRejections(null)).toBe(0);
  });

  test('returns 0 for undefined input', () => {
    expect(countRejections(undefined)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lead-reset:true baseline
// ---------------------------------------------------------------------------

describe('lead-reset:true baseline (countRejections)', () => {
  test('no lead-reset -> counts all rejections (backward compat)', () => {
    const output = [
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-tests',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:still-missing',
    ].join('\n');
    expect(countRejections(output)).toBe(2);
  });

  test('lead-reset in middle -> counts only rejections after it', () => {
    const output = [
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:first',
      'status:in_progress lead:tech-lead-orchestrator lead-reset:true',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:second',
    ].join('\n');
    expect(countRejections(output)).toBe(1);
  });

  test('multiple lead-resets -> uses most recent', () => {
    const output = [
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:first',
      'status:in_progress lead:tech-lead-orchestrator lead-reset:true',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:second',
      'status:in_progress lead:tech-lead-orchestrator lead-reset:true',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:third',
    ].join('\n');
    expect(countRejections(output)).toBe(1);
  });

  test('lead-reset at end -> returns 0', () => {
    const output = [
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:first',
      'status:in_progress reviewer:code-reviewer verdict:rejected reason:second',
      'status:in_progress lead:tech-lead-orchestrator lead-reset:true',
    ].join('\n');
    expect(countRejections(output)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Escalation threshold
// ---------------------------------------------------------------------------

describe('Escalation threshold (requiresEscalation)', () => {
  test('does not escalate at 0 rejections', () => {
    expect(requiresEscalation(0)).toBe(false);
  });

  test('does not escalate at 1 rejection (below MAX_REJECTIONS)', () => {
    expect(requiresEscalation(1)).toBe(false);
  });

  test('escalates at exactly MAX_REJECTIONS (2)', () => {
    expect(requiresEscalation(MAX_REJECTIONS)).toBe(true);
  });

  test('escalates above MAX_REJECTIONS (3)', () => {
    expect(requiresEscalation(3)).toBe(true);
  });

  test('MAX_REJECTIONS constant is 2', () => {
    expect(MAX_REJECTIONS).toBe(2);
  });

  describe('end-to-end escalation scenario', () => {
    test('two rejections triggers escalation', () => {
      const commentLog = [
        'status:in_progress assigned:backend-developer',
        'status:in_review builder:backend-developer files:src/auth.ts',
        'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-jwt-expiry-check',
        'status:in_review builder:backend-developer files:src/auth.ts',
        'status:in_progress reviewer:code-reviewer verdict:rejected reason:still-missing-expiry-check',
      ].join('\n');

      const rejections = countRejections(commentLog);
      expect(rejections).toBe(2);
      expect(requiresEscalation(rejections)).toBe(true);
    });

    test('one rejection does not yet trigger escalation', () => {
      const commentLog = [
        'status:in_progress assigned:backend-developer',
        'status:in_review builder:backend-developer files:src/auth.ts',
        'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-jwt-expiry-check',
        'status:in_review builder:backend-developer files:src/auth.ts',
      ].join('\n');

      const rejections = countRejections(commentLog);
      expect(rejections).toBe(1);
      expect(requiresEscalation(rejections)).toBe(false);
    });

    test('after lead escalation, rejection count resets via lead-reset:true', () => {
      // Full history including pre-reset rejections and post-reset fresh segment.
      // The lead-reset:true marker tells countRejections to only count after it.
      const fullHistory = [
        'status:in_progress assigned:backend-developer',
        'status:in_review builder:backend-developer files:src/auth.ts',
        'status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-jwt-expiry-check',
        'status:in_review builder:backend-developer files:src/auth.ts',
        'status:in_progress reviewer:code-reviewer verdict:rejected reason:still-missing-expiry-check',
        'status:in_progress lead:tech-lead-orchestrator reason:escalated-after-2-rejections lead-reset:true',
        'status:in_progress assigned:backend-developer',
        'status:in_review builder:backend-developer files:src/auth.ts',
      ].join('\n');

      // Only counts rejections after the lead-reset:true line (0 in fresh segment)
      expect(countRejections(fullHistory)).toBe(0);
      expect(requiresEscalation(0)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Skip paths
// ---------------------------------------------------------------------------

describe('Skip paths', () => {
  test('in_progress -> in_qa is valid (skip-review path)', () => {
    // When lead issues skip-review, next transition bypasses in_review
    expect(validateTransition('in_progress', 'in_qa')).toBe(true);
  });

  test('in_progress -> closed is valid (skip-qa + skip-review path)', () => {
    // When lead issues skip-qa after skip-review, task closes directly
    expect(validateTransition('in_progress', 'closed')).toBe(true);
  });

  test('in_qa -> closed is valid (QA passed path)', () => {
    expect(validateTransition('in_qa', 'closed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS table shape
// ---------------------------------------------------------------------------

describe('VALID_TRANSITIONS table', () => {
  test('defines transitions for all non-terminal states', () => {
    expect(VALID_TRANSITIONS).toHaveProperty('open');
    expect(VALID_TRANSITIONS).toHaveProperty('in_progress');
    expect(VALID_TRANSITIONS).toHaveProperty('in_review');
    expect(VALID_TRANSITIONS).toHaveProperty('in_qa');
  });

  test('closed state has no outgoing transitions (terminal)', () => {
    expect(VALID_TRANSITIONS).not.toHaveProperty('closed');
  });

  test('total valid transition count is 8', () => {
    const total = Object.values(VALID_TRANSITIONS).reduce(
      (sum, targets) => sum + targets.length,
      0
    );
    expect(total).toBe(8);
  });

  test('open state has exactly 1 valid target', () => {
    expect(VALID_TRANSITIONS.open).toHaveLength(1);
  });

  test('in_progress state has exactly 3 valid targets', () => {
    expect(VALID_TRANSITIONS.in_progress).toHaveLength(3);
  });

  test('in_review state has exactly 2 valid targets', () => {
    expect(VALID_TRANSITIONS.in_review).toHaveLength(2);
  });

  test('in_qa state has exactly 2 valid targets', () => {
    expect(VALID_TRANSITIONS.in_qa).toHaveLength(2);
  });
});
