/**
 * Unit tests for TRD-005 / TRD-005-TEST (REQ-015): command input validation
 * at the boundary.
 *
 * The feature skill's (skills/ensemble-feature/SKILL.md) dispatch step rejects an unknown action or an
 * unsupported flag before any run state is created or read (no RunIndexStore
 * access, no forward invocation constructed), showing the supported action
 * list instead.
 */

const { readFeature } = require('./helpers/feature-skill');

function actionsText(step) {
  return (step.actions || []).join('\n');
}

describe('Feature command input validation at the boundary (TRD-005)', () => {
  let dispatchStep;

  beforeAll(() => {
    const dispatchPhase = readFeature().workflow.phases.find((p) => p.name === 'Dispatch');
    dispatchStep = dispatchPhase.steps.find((s) => s.order === 1);
  });

  test('the REQ-015 validation action runs before any per-keyword routing action in the step\'s action bullets', () => {
    const indexOfValidation = dispatchStep.actions.findIndex((a) => a.includes('Command input validation at the boundary (REQ-015)'));
    const indexOfNewKeyword = dispatchStep.actions.findIndex((a) => a.startsWith('keyword `new`:'));
    expect(indexOfValidation).toBeGreaterThan(-1);
    expect(indexOfNewKeyword).toBeGreaterThan(-1);
    expect(indexOfValidation).toBeLessThan(indexOfNewKeyword);
  });

  describe('Scenario: unknown action rejected pre-state', () => {
    test('a first token matching no keyword is rejected before any RunIndexStore access, with the supported action list shown', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain('before any RunIndexStore access or forward invocation is constructed');
      expect(text).toContain('the first token matches none of `new`/`resume`/`status`/`abandon`, or $ARGUMENTS is empty');
      expect(text).toContain('printing the keyword table below (keyword + one-line description) and HALTing with no side effects');
    });
  });

  describe('Scenario: unsupported flag rejected pre-state (e.g. `feature resume --foo` or `feature status extra`)', () => {
    test('resume/status with any remaining text is rejected as an unsupported flag/argument, not silently ignored', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain(
        'the first token is `resume` or `status` and there is any remaining text -- `resume` and `status` take no arguments, so any remaining text is an unsupported flag or argument rejected here, not silently ignored',
      );
    });

    test('the resume/status per-keyword actions only construct their invocation given no remaining text -- the rejection above is what handles the flag case', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain('keyword `resume` with no remaining text (any remaining text is rejected above, REQ-015)');
      expect(text).toContain('keyword `status` with no remaining text (any remaining text is rejected above, REQ-015)');
    });
  });

  describe('Scenario: empty input ($ARGUMENTS empty) shows the action list with no side effect', () => {
    test('empty $ARGUMENTS is explicitly one of the two REQ-015 rejection cases', () => {
      const text = actionsText(dispatchStep);
      expect(text).toMatch(/\$ARGUMENTS is empty/);
    });

    test('the pre-existing Fallback action (no-arg/unrecognized -> table + HALT) is unchanged, so both the new and old assertions of this same guarantee hold', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain(
        'If the first token matches no keyword above, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.',
      );
    });
  });
});
