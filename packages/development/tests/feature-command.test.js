/**
 * Unit tests for feature.yaml command structure (TRD-002, TRD-002-TEST)
 *
 * `ensemble:feature` is a thin dispatcher: every keyword (`new`/`resume`/`status`/
 * `abandon`) forwards into the existing, already-tested `/ensemble:new-feature`
 * workflow (see new-feature-command.test.js for that command's own stage-machine
 * coverage). This file only verifies the dispatcher's own, narrow contract: it
 * constructs the correct forwarding invocation per keyword, performs zero
 * stage-machine logic of its own, and falls back to the keyword table/HALT
 * pattern shared with trd.yaml/issue.yaml on no-match or empty input.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * Join a step's `actions[]` array into one string for .toContain()/.toMatch()
 * assertions (same convention as new-feature-command.test.js).
 */
function actionsText(step) {
  return (step.actions || []).join('\n');
}

describe('Feature Dispatcher Command', () => {
  let commandYaml;
  let yamlContent;
  let generatedMarkdown;
  let dispatchStep;

  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const yamlPath = path.join(__dirname, '..', 'commands', 'feature.yaml');
  const markdownPath = path.join(repoRoot, 'packages/development/commands/ensemble/feature.md');

  beforeAll(() => {
    yamlContent = fs.readFileSync(yamlPath, 'utf-8');
    commandYaml = yaml.load(yamlContent);
    generatedMarkdown = fs.readFileSync(markdownPath, 'utf8');

    const dispatchPhase = commandYaml.workflow.phases.find((p) => p.name === 'Dispatch');
    dispatchStep = dispatchPhase.steps.find((s) => s.order === 1);
  });

  describe('Metadata', () => {
    test('has valid metadata structure', () => {
      expect(commandYaml.metadata).toBeDefined();
      expect(commandYaml.metadata.name).toBe('ensemble:feature');
      expect(commandYaml.metadata.category).toBe('implementation');
      expect(commandYaml.metadata.output_path).toBe('ensemble/feature.md');
      expect(commandYaml.metadata.source).toBe('sunstone');
    });

    test('argument_hint documents all four keywords', () => {
      expect(commandYaml.metadata.argument_hint).toMatch(/new\|resume\|status\|abandon/);
    });
  });

  describe('dispatch.subcommands[] declares exactly the four lifecycle keywords', () => {
    test('new/resume/status/abandon, each referencing the new-feature sibling command', () => {
      const subcommands = commandYaml.dispatch.subcommands;
      expect(subcommands.map((s) => s.keyword)).toEqual(['new', 'resume', 'status', 'abandon']);
      subcommands.forEach((sub) => {
        expect(sub.ref).toBe('new-feature');
      });
    });
  });

  describe('Implementation AC 1: `feature new <description>` forwards verbatim into the existing idea-argument convention', () => {
    test('constructs `--idea "<remaining text>"`, matching new-feature\'s own idea-argument convention (its Entry Point Resolution Step 2)', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain(
        'keyword `new`: the remaining text is the feature description -- construct the invocation `/ensemble:new-feature --idea "<remaining text>"`, matching new-feature\'s own existing idea-argument convention for starting a run (its Entry Point Resolution Step 2, AC-001-1).'
      );
    });

    test('the description text is forwarded exactly as given -- never reworded, summarized, or truncated', () => {
      expect(actionsText(dispatchStep)).toContain(
        'The description text is forwarded exactly as given -- never reworded, summarized, or truncated.'
      );
    });

    test('starting a feature requires no existing issue/bead reference as input', () => {
      // The `new` construction only ever consumes the remaining free-text description --
      // it never requires, mentions, or looks up an issue/bead identifier.
      expect(actionsText(dispatchStep)).not.toMatch(/\bissue\b|\bbead\b|\bbr-[a-z0-9]+\b/i);
    });
  });

  describe('Implementation AC 2: `feature resume`/`feature status`/`feature abandon` forward into bare/--status/--abandon', () => {
    test('`resume` constructs the bare invocation with no flags (resumes from the last recorded checkpoint)', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain(
        'keyword `resume` with no remaining text (any remaining text is rejected above, REQ-015): construct the bare invocation `/ensemble:new-feature` with no flags, matching new-feature\'s own existing no-arguments convention for resuming the project\'s active/paused run from its last recorded checkpoint (its Entry Point Resolution Step 4, status=false).'
      );
    });

    test('`status` constructs `--status` and is documented read-only (no mutate() call)', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain(
        'keyword `status` with no remaining text (any remaining text is rejected above, REQ-015): construct the invocation `/ensemble:new-feature --status`, matching new-feature\'s own existing `--status` convention for its read-only run report (its Entry Point Resolution Step 4, status=true). That path makes no mutate() call.'
      );
    });

    test('`abandon` constructs `--abandon` plus any given reason text, unmodified', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain(
        'keyword `abandon`: the remaining text, if any, is an optional reason -- construct the invocation `/ensemble:new-feature --abandon <remaining text>` (omit the trailing space when there is none), matching new-feature\'s own existing `--abandon` convention for terminating the active/paused run after explicit confirmation (its Entry Point Resolution Step 6, AC-007-3).'
      );
    });
  });

  describe('Implementation AC 3 / retirement scenarios: zero stage-machine logic is re-implemented in this file', () => {
    const forbiddenStageTokens = [
      'prd_create',
      'prd_refine',
      'trd_create',
      'trd_refine',
      'beads_plan',
      'implementation_approval',
      'pr_approval',
      'pr_create',
      'STAGE_ORDER',
      'RunIndexStore.mutate(',
      'Argument Parsing',
      '[Step 1/5]',
      '[Step 2/5]',
    ];

    test("the YAML source contains no trace of the old 5-step linear pipeline's stage vocabulary", () => {
      forbiddenStageTokens.forEach((token) => {
        expect(yamlContent).not.toContain(token);
      });
    });

    test("the generated feature.md contains no trace of the old 5-step linear pipeline's stage vocabulary", () => {
      forbiddenStageTokens.forEach((token) => {
        expect(generatedMarkdown).not.toContain(token);
      });
    });

    test('the dispatch step explicitly states it performs zero stage-machine logic of its own', () => {
      expect(actionsText(dispatchStep)).toContain(
        'Do not re-implement any of its stages here -- this file performs zero stage-machine logic of its own.'
      );
    });

    test('this is a single-phase, single-step dispatcher -- no multi-phase pipeline orchestration', () => {
      expect(commandYaml.workflow.phases).toHaveLength(1);
      expect(commandYaml.workflow.phases[0].steps).toHaveLength(1);
    });
  });

  describe('Test AC: pure pass-through, no translation', () => {
    test('the user-given description/reason text is never reworded, summarized, or translated into a different shape', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain('never reworded, summarized, or truncated');
      expect(text).not.toMatch(/paraphrase|reinterpret|rewritten as|convert(ed)? to JSON/i);
    });

    test('every keyword constructs its forward call by prefixing the existing new-feature flag, not by inventing a new argument shape', () => {
      const text = actionsText(dispatchStep);
      expect(text).toContain("matching new-feature's own existing idea-argument convention");
      expect(text).toContain("matching new-feature's own existing no-arguments convention");
      expect(text).toContain("matching new-feature's own existing `--status` convention");
      expect(text).toContain("matching new-feature's own existing `--abandon` convention");
    });
  });

  describe('Test AC: unrecognized keyword or empty input halts with the keyword table, no side effects', () => {
    test('the fallback action prints the keyword table and HALTs without side effects', () => {
      expect(actionsText(dispatchStep)).toContain(
        'If the first token matches no keyword above, or $ARGUMENTS is empty: print the keyword table below (keyword + one-line description) and HALT without side effects.'
      );
    });
  });

  describe('Generated command file (packages/development/commands/ensemble/feature.md)', () => {
    test('exists, carries the DO NOT EDIT banner, and has name/category frontmatter', () => {
      expect(fs.existsSync(markdownPath)).toBe(true);
      expect(generatedMarkdown).toMatch(/DO NOT EDIT - Generated from feature\.yaml/);
      expect(generatedMarkdown).toMatch(/name:\s*"ensemble:feature"/);
      expect(generatedMarkdown).toMatch(/category:\s*"implementation"/);
    });

    test('documents all four keywords in the rendered Subcommands section, each pointing at the new-feature skill', () => {
      ['new', 'resume', 'status', 'abandon'].forEach((keyword) => {
        expect(generatedMarkdown).toContain(
          `- **\`${keyword}\`** -`
        );
      });
      // new-feature is skill-backed: the dispatcher renders a pointer to its SKILL.md rather
      // than to a generated new-feature.md.
      const newFeatureReferenceCount = (
        generatedMarkdown.match(/packages\/development\/skills\/ensemble-new-feature\/SKILL\.md/g) || []
      ).length;
      // One reference per keyword (4) -- every subcommand targets the same skill.
      expect(newFeatureReferenceCount).toBe(4);
    });

    test('Usage section documents the <new|resume|status|abandon> argument shape', () => {
      expect(generatedMarkdown).toContain('/ensemble:feature <new|resume|status|abandon> [args...]');
    });
  });
});
