const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { readDevelopmentSkill } = require('./helpers/skill-workflow');

describe('refine-beads command', () => {
  const yamlPath = path.join(__dirname, '../commands/refine-beads.yaml');
  const mdPath = path.join(__dirname, '../commands/ensemble/refine-beads.md');
  let command;
  // refine-beads is skill-backed: the YAML is a manifest, the prompt is the skill (SKILL.md + references).
  let skillText;
  beforeAll(() => {
    command = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
    skillText = readDevelopmentSkill(command.skill).prompt;
  });

  test('has command metadata', () => {
    expect(command.metadata.name).toBe('ensemble:refine-beads');
    expect(command.metadata.output_path).toBe('ensemble/refine-beads.md');
    expect(command.metadata.argument_hint).toContain('--scope project');
  });

  test('forbids implementation execution', () => {
    const text = skillText;
    expect(text).toContain('never executes implementation work');
    expect(text).toContain('No tracker.update, tracker.dep-add, tracker.dep-remove, tracker.close, branch, test, builder, reviewer, or implementation capability call may run in this phase.');
  });

  test('uses the work-graph.graph-health capability, not bv robot flags', () => {
    const text = skillText;
    expect(text).toContain('work-graph.graph-health');
    expect(text).not.toMatch(/\bbv (--robot|\s)/);
    expect(text).not.toMatch(/\bbv\b(?!-json)/);
  });

  test('generates repair plan before approval prompt', () => {
    const text = skillText;
    expect(text).toContain('"$BEADS_REFINE_CLI" plan');
    expect(text).toContain('capture REPAIR_PLAN');
    expect(text).toContain('proposed tracker capability call(s) from REPAIR_PLAN');
  });


  test('resolves the bundled CLI rather than hardcoding a monorepo path', () => {
    const text = skillText;
    // A bare packages/development/lib/... path only exists in the monorepo, so the
    // command was unusable from a consuming project with only the plugin installed.
    expect(text).not.toContain('node packages/development/lib/');
    expect(text).toContain('tool-path-resolution');
  });

  test('requires approval and dependency confirmation before mutation', () => {
    const text = skillText;
    expect(text).toContain('Apply only explicitly approved fixes');
    expect(text).toContain('separate explicit confirmation');
    expect(text).toContain('Never guess');
  });

  test('documents failure recovery choices', () => {
    const text = skillText;
    for (const token of ['retry failed command', 'skip failed fix', 'inverse commands', 'cancel remaining fixes', 'abort']) {
      expect(text).toContain(token);
    }
  });

  test('generated markdown exists after generation', () => {
    if (fs.existsSync(mdPath)) {
      const text = fs.readFileSync(mdPath, 'utf8');
      expect(text).toContain('ensemble:refine-beads');
    }
  });
});
