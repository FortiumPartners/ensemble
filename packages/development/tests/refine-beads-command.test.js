const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

describe('refine-beads command', () => {
  const yamlPath = path.join(__dirname, '../commands/refine-beads.yaml');
  const mdPath = path.join(__dirname, '../commands/ensemble/refine-beads.md');
  let command;
  beforeAll(() => {
    command = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
  });

  test('has command metadata', () => {
    expect(command.metadata.name).toBe('ensemble:refine-beads');
    expect(command.metadata.output_path).toBe('ensemble/refine-beads.md');
    expect(command.metadata.argument_hint).toContain('--scope project');
  });

  test('forbids implementation execution', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('never executes implementation work');
    expect(text).toContain('No br update, br dep add, br dep remove, br close, branch, test, builder, reviewer, or implementation command may run in this phase.');
  });

  test('uses only bv robot flags', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('bv --robot-insights');
    expect(text).toContain('bv --robot-plan');
    expect(text).toContain('Do not run bare bv');
    expect(text).not.toMatch(/run bv(?! --robot|-)/i);
  });

  test('generates repair plan before approval prompt', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('"$BEADS_REFINE_CLI" plan');
    expect(text).toContain('capture REPAIR_PLAN');
    expect(text).toContain('proposed br command(s) from REPAIR_PLAN');
  });

  test('resolves the bundled CLI rather than hardcoding a monorepo path', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // A bare packages/development/lib/... path only exists in the monorepo, so the
    // command was unusable from a consuming project with only the plugin installed.
    expect(text).not.toContain('node packages/development/lib/');
    expect(text).toContain('tool-path-resolution');
  });

  test('requires approval and dependency confirmation before mutation', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Apply only explicitly approved fixes');
    expect(text).toContain('separate explicit confirmation');
    expect(text).toContain('Never guess');
  });

  test('documents failure recovery choices', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
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
