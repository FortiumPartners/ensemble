'use strict';

const fs = require('fs');
const path = require('path');

const { readDevelopmentSkill } = require('./helpers/skill-workflow');

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
    // implement-trd-beads is skill-backed: its prompt is the skill (SKILL.md + references/)
    const prose = readDevelopmentSkill('ensemble-implement-trd-beads').prompt;
    expect(prose).toContain('beads-scaffold-specialist');
    expect(prose).toMatch(/never backend-developer/);
  });
});
