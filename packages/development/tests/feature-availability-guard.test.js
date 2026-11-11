/**
 * Unit tests for the feature skill's delegation-availability guard (TRD-004, TRD-004-TEST, REQ-006)
 *
 * `ensemble:feature`'s Dispatch step 1 confirms `/ensemble:new-feature`'s
 * sibling skill resolves before doing anything else. This file
 * proves the guard's own 3 Implementation AC scenarios against the actual
 * action text of skills/ensemble-feature/SKILL.md, same convention as
 * feature-command.test.js (TRD-002).
 */

const { readFeature } = require('./helpers/feature-skill');

function actionsText(step) {
  return (step.actions || []).join('\n');
}

describe('Feature delegation-availability guard (TRD-004)', () => {
  let dispatchStep;

  beforeAll(() => {
    const dispatchPhase = readFeature().workflow.phases.find((p) => p.name === 'Dispatch');
    dispatchStep = dispatchPhase.steps.find((s) => s.order === 1);
  });

  test('the guard confirms the new-feature sibling skill, whose path the Subcommands section carries', () => {
    const feature = readFeature();
    expect(dispatchStep.actions[0]).toContain(
      "`/ensemble:new-feature`'s sibling skill (its path is in the Subcommands section above)",
    );
    feature.subcommands.forEach((sub) => {
      expect(sub.path).toBe('../ensemble-new-feature/SKILL.md');
    });
  });

  test('the guard is the very first action in Dispatch step 1, ahead of per-keyword routing', () => {
    const [firstAction] = dispatchStep.actions;
    expect(firstAction).toMatch(/Delegation-availability guard \(REQ-006\)/);
    expect(firstAction).toMatch(/before doing anything else/);
  });

  describe('Scenario: missing capability halts naming it + install instructions, no partial state', () => {
    test('names the missing capability and how to obtain it, creating no run state', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain('If it does not resolve, HALT immediately');
      expect(text).toContain('name the missing capability (`ensemble-new-feature`)');
      expect(text).toContain('state how to obtain it (install/enable the `development` package)');
      expect(text).toContain('creating no run state and performing no other action below');
    });
  });

  describe('Scenario: present capability is silent', () => {
    test('resolving proceeds silently with no availability confirmation printed', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain('If it resolves, proceed silently');
      expect(text).toMatch(/print no availability confirmation of any kind, for any keyword/);
    });
  });

  describe('Scenario: first-ever run (no .ensemble/new-feature/ yet) is ordinary/silent', () => {
    test('the first-run case is explicitly called out as the normal, silent case -- not a distinct warning path', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain(
        "including the ordinary case of a project's first-ever `new` run with no prior `.ensemble/new-feature/` state",
      );
      expect(text).toContain('that remains the normal, silent first-run case');
    });
  });
});
