'use strict';

const fs = require('fs');
const path = require('path');

describe('beads-scaffold-specialist agent', () => {
  test('is registered and bounded to scaffold-only graph work', () => {
    const plugin = JSON.parse(fs.readFileSync(path.join(__dirname, '../.claude-plugin/plugin.json'), 'utf8'));
    expect(plugin.agents).toContain('./agents/beads-scaffold-specialist.md');

    const yaml = fs.readFileSync(path.join(__dirname, '../agents/beads-scaffold-specialist.yaml'), 'utf8');
    expect(yaml).toContain('never implement product code');
    expect(yaml).toContain('bv --robot-*');
    expect(yaml).toContain('Acceptance Criteria Coverage');
    expect(yaml).toContain('Cross-Cutting Requirement Coverage');
  });

  test('implement-trd-beads reserves scaffold work for the scaffold specialist', () => {
    const yaml = fs.readFileSync(path.join(__dirname, '../commands/implement-trd-beads.yaml'), 'utf8');
    expect(yaml).toContain('beads-scaffold-specialist');
    expect(yaml).toContain('Do not delegate scaffold planning to backend-developer');
  });
});
