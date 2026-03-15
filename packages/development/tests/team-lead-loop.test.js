/**
 * TRD-024: Integration tests for lead loop happy path
 *
 * Verifies the lead orchestration loop pipeline with simulated agent responses.
 * Tests the full task lifecycle: open -> in_progress -> in_review -> in_qa -> closed
 * as well as skip paths, rejection cycles, and audit trail integrity.
 *
 * Bead: ensemble-bxv
 */

'use strict';

const {
  parseSubState,
  validateTransition,
} = require('./helpers/team-utils');

// ---------------------------------------------------------------------------
// Pipeline simulation
// ---------------------------------------------------------------------------

/**
 * Simulates the full task pipeline executed by the lead loop.
 *
 * @param {Object} options
 * @param {boolean} [options.reviewerEnabled=true]
 * @param {boolean} [options.qaEnabled=true]
 * @param {string}  [options.reviewerVerdict='approved']  'approved' | 'rejected'
 * @param {string}  [options.qaVerdict='passed']          'passed' | 'rejected'
 * @param {boolean} [options.skipReview=false]
 * @param {boolean} [options.skipQA=false]
 * @returns {{ finalState: string, comments: string[] }}
 */
function simulateTaskPipeline(options = {}) {
  const {
    reviewerEnabled = true,
    qaEnabled = true,
    reviewerVerdict = 'approved',
    qaVerdict = 'passed',
    skipReview = false,
    skipQA = false,
  } = options;

  const comments = [];
  let currentState = 'open';

  // Determine effective skip flags (explicit skip or role not enabled)
  const effectiveSkipReview = skipReview || !reviewerEnabled;
  const effectiveSkipQA = skipQA || !qaEnabled;

  // Lead assigns to builder
  if (validateTransition(currentState, 'in_progress')) {
    currentState = 'in_progress';
    comments.push('status:in_progress assigned:backend-developer');
  }

  // Review phase
  if (effectiveSkipReview) {
    comments.push('status:skip-review lead:tech-lead-orchestrator reason:skip-requested');
    // After skipping review, decide on QA
    if (!effectiveSkipQA) {
      // Still need QA — transition to in_qa from in_progress (valid per state machine)
      currentState = 'in_qa';
      comments.push('status:in_qa lead:tech-lead-orchestrator reason:review-skipped');
    }
    // If also skipping QA, fall through to QA phase below
  } else {
    // Builder completes -> in_review
    currentState = 'in_review';
    comments.push('status:in_review builder:backend-developer files:src/api.ts');

    // Reviewer verdict
    if (reviewerVerdict === 'approved') {
      if (!effectiveSkipQA) {
        // Advance to QA
        currentState = 'in_qa';
        comments.push('status:in_qa reviewer:code-reviewer verdict:approved');
      }
      // If QA skipped, fall through to QA phase below
    } else {
      // Reviewer rejected — back to builder
      currentState = 'in_progress';
      comments.push('status:in_progress reviewer:code-reviewer verdict:rejected reason:missing-tests');
      return { finalState: currentState, comments };
    }
  }

  // QA phase
  if (effectiveSkipQA) {
    // Skip QA whenever the task is not stuck in rejection (in_progress due to builder rework)
    // When both review and QA are skipped, currentState is still in_progress — that is valid
    const canSkipQA = currentState === 'in_progress' && effectiveSkipReview
      ? true  // skip-all: still in_progress because review was also skipped
      : currentState !== 'in_progress';
    if (canSkipQA) {
      comments.push('status:skip-qa lead:tech-lead-orchestrator reason:skip-requested');
      currentState = 'closed';
      comments.push('status:closed lead:tech-lead-orchestrator reason:qa-skipped');
    }
  } else if (currentState === 'in_qa') {
    // QA verdict
    if (qaVerdict === 'passed') {
      currentState = 'closed';
      comments.push('status:closed qa:qa-orchestrator verdict:passed');
    } else {
      currentState = 'in_progress';
      comments.push('status:in_progress qa:qa-orchestrator verdict:rejected reason:coverage-too-low');
    }
  }

  return { finalState: currentState, comments };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Lead Loop - Full Pipeline', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  test('happy path: open -> in_progress -> in_review -> in_qa -> closed', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'passed' });
    expect(result.finalState).toBe('closed');
    expect(result.comments.some(c => c.includes('status:in_review'))).toBe(true);
    expect(result.comments.some(c => c.includes('status:in_qa'))).toBe(true);
    expect(result.comments[result.comments.length - 1]).toContain('status:closed');
  });

  test('happy path starts from open state', () => {
    // The first comment should move to in_progress from open
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'passed' });
    expect(result.comments[0]).toContain('status:in_progress');
    expect(result.comments[0]).toContain('assigned:backend-developer');
  });

  // -------------------------------------------------------------------------
  // Reviewer rejection
  // -------------------------------------------------------------------------

  test('reviewer rejection: returns to in_progress', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'rejected', qaVerdict: 'passed' });
    expect(result.finalState).toBe('in_progress');
    expect(result.comments.some(c => c.includes('verdict:rejected'))).toBe(true);
    expect(result.comments.some(c => c.includes('reviewer:code-reviewer'))).toBe(true);
  });

  test('reviewer rejection includes reason in comment', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'rejected', qaVerdict: 'passed' });
    const rejectionComment = result.comments.find(c => c.includes('verdict:rejected'));
    expect(rejectionComment).toBeDefined();
    expect(rejectionComment).toContain('reason:missing-tests');
  });

  // -------------------------------------------------------------------------
  // QA rejection
  // -------------------------------------------------------------------------

  test('QA rejection: returns to in_progress', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'rejected' });
    expect(result.finalState).toBe('in_progress');
    const qaRejection = result.comments.find(c => c.includes('qa:qa-orchestrator') && c.includes('rejected'));
    expect(qaRejection).toBeDefined();
  });

  test('QA rejection includes coverage reason', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'rejected' });
    const qaComment = result.comments.find(c => c.includes('qa:qa-orchestrator') && c.includes('rejected'));
    expect(qaComment).toContain('reason:coverage-too-low');
  });

  // -------------------------------------------------------------------------
  // Skip paths
  // -------------------------------------------------------------------------

  test('skip-review path: in_progress -> in_qa -> closed', () => {
    const result = simulateTaskPipeline({ skipReview: true, qaVerdict: 'passed' });
    expect(result.finalState).toBe('closed');
    expect(result.comments.some(c => c.includes('skip-review'))).toBe(true);
    expect(result.comments.some(c => c.includes('status:in_review'))).toBe(false);
    expect(result.comments.some(c => c.includes('status:in_qa'))).toBe(true);
  });

  test('skip-all path: in_progress -> closed', () => {
    const result = simulateTaskPipeline({ skipReview: true, skipQA: true });
    expect(result.finalState).toBe('closed');
    expect(result.comments.some(c => c.includes('skip-review'))).toBe(true);
    expect(result.comments.some(c => c.includes('skip-qa'))).toBe(true);
    expect(result.comments.some(c => c.includes('status:in_review'))).toBe(false);
    expect(result.comments.some(c => c.includes('status:in_qa'))).toBe(false);
  });

  test('no reviewer (reviewerEnabled=false): skips review step automatically', () => {
    const result = simulateTaskPipeline({ reviewerEnabled: false, qaVerdict: 'passed' });
    expect(result.comments.some(c => c.includes('status:in_review'))).toBe(false);
    expect(result.comments.some(c => c.includes('skip-review'))).toBe(true);
  });

  test('no QA (qaEnabled=false): closes after reviewer approval', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaEnabled: false });
    expect(result.comments.some(c => c.includes('status:in_qa'))).toBe(false);
    expect(result.comments.some(c => c.includes('skip-qa'))).toBe(true);
    expect(result.finalState).toBe('closed');
    // The in_review->closed transition (with QA skipped) bypasses validateTransition
    // by design: the skip-QA path is an explicit override of the normal state machine,
    // so the in_review->in_qa step is intentionally absent.
    expect(result.comments.some(c => c.includes('status:in_review'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // State transition validation
  // -------------------------------------------------------------------------

  test('all state transitions in happy path are valid', () => {
    const sequence = ['open', 'in_progress', 'in_review', 'in_qa', 'closed'];
    for (let i = 0; i < sequence.length - 1; i++) {
      expect(validateTransition(sequence[i], sequence[i + 1])).toBe(true);
    }
  });

  test('invalid transition from closed to in_progress is rejected', () => {
    expect(validateTransition('closed', 'in_progress')).toBe(false);
  });

  test('invalid transition from open directly to in_review is rejected', () => {
    expect(validateTransition('open', 'in_review')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Audit trail
  // -------------------------------------------------------------------------

  test('happy path audit trail has all expected status comments', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'passed' });
    const statusComments = result.comments.filter(c => c.startsWith('status:'));
    const states = statusComments.map(c => c.split(' ')[0].replace('status:', ''));
    expect(states).toContain('in_progress');
    expect(states).toContain('in_review');
    expect(states).toContain('in_qa');
    expect(states).toContain('closed');
  });

  test('happy path audit trail has exactly 4 status comments', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'passed' });
    expect(result.comments).toHaveLength(4);
  });

  test('skip-all audit trail has in_progress + skip-review + skip-qa + closed', () => {
    const result = simulateTaskPipeline({ skipReview: true, skipQA: true });
    expect(result.comments.some(c => c.startsWith('status:in_progress'))).toBe(true);
    expect(result.comments.some(c => c.startsWith('status:skip-review'))).toBe(true);
    expect(result.comments.some(c => c.startsWith('status:skip-qa'))).toBe(true);
    expect(result.comments.some(c => c.startsWith('status:closed'))).toBe(true);
  });

  test('last comment is always status:closed for all terminal paths', () => {
    const happyPath = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'passed' });
    const skipAll = simulateTaskPipeline({ skipReview: true, skipQA: true });
    const skipReviewOnly = simulateTaskPipeline({ skipReview: true, qaVerdict: 'passed' });

    expect(happyPath.comments[happyPath.comments.length - 1]).toContain('status:closed');
    expect(skipAll.comments[skipAll.comments.length - 1]).toContain('status:closed');
    expect(skipReviewOnly.comments[skipReviewOnly.comments.length - 1]).toContain('status:closed');
  });

  // -------------------------------------------------------------------------
  // parseSubState integration
  // -------------------------------------------------------------------------

  test('parseSubState correctly reads final status from happy path comment trail', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'passed' });
    const commentOutput = result.comments.join('\n');
    const parsed = parseSubState(commentOutput);
    expect(parsed).not.toBeNull();
    expect(parsed.state).toBe('closed');
    expect(parsed.metadata.qa).toBe('qa-orchestrator');
    expect(parsed.metadata.verdict).toBe('passed');
  });

  test('parseSubState correctly reads reviewer rejection from comment trail', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'rejected', qaVerdict: 'passed' });
    const commentOutput = result.comments.join('\n');
    const parsed = parseSubState(commentOutput);
    expect(parsed).not.toBeNull();
    expect(parsed.state).toBe('in_progress');
    expect(parsed.metadata.reviewer).toBe('code-reviewer');
    expect(parsed.metadata.verdict).toBe('rejected');
  });

  test('parseSubState correctly reads QA rejection from comment trail', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'rejected' });
    const commentOutput = result.comments.join('\n');
    const parsed = parseSubState(commentOutput);
    expect(parsed).not.toBeNull();
    expect(parsed.state).toBe('in_progress');
    expect(parsed.metadata.qa).toBe('qa-orchestrator');
  });

  // -------------------------------------------------------------------------
  // Lead comment attribution
  // -------------------------------------------------------------------------

  test('skip-review comment is attributed to tech-lead-orchestrator', () => {
    const result = simulateTaskPipeline({ skipReview: true, qaVerdict: 'passed' });
    const skipComment = result.comments.find(c => c.includes('skip-review'));
    expect(skipComment).toContain('lead:tech-lead-orchestrator');
  });

  test('skip-qa comment is attributed to tech-lead-orchestrator', () => {
    const result = simulateTaskPipeline({ skipReview: true, skipQA: true });
    const skipQAComment = result.comments.find(c => c.includes('skip-qa'));
    expect(skipQAComment).toContain('lead:tech-lead-orchestrator');
  });

  test('closed comment for skip-all is attributed to lead, not qa', () => {
    const result = simulateTaskPipeline({ skipReview: true, skipQA: true });
    const closedComment = result.comments.find(c => c.startsWith('status:closed'));
    expect(closedComment).toContain('lead:tech-lead-orchestrator');
    expect(closedComment).not.toContain('qa:');
  });

  test('closed comment for happy path is attributed to qa, not lead', () => {
    const result = simulateTaskPipeline({ reviewerVerdict: 'approved', qaVerdict: 'passed' });
    const closedComment = result.comments.find(c => c.startsWith('status:closed'));
    expect(closedComment).toContain('qa:qa-orchestrator');
    expect(closedComment).not.toContain('lead:');
  });
});
