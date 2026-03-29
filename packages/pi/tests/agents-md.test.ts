/**
 * Tests for AGENTS.md content (TRD-009-TEST)
 *
 * Read-only tests against the generated packages/pi/AGENTS.md file.
 *
 * Covers:
 * 1. File exists on disk
 * 2. Does NOT contain Claude Code-specific section headings
 * 3. Has agent mesh section (contains "## Agent Mesh" or agent-related headings)
 * 4. Starts with a markdown heading (#)
 * 5. Reasonable length (> 20 lines)
 */

import * as fs from 'fs';
import * as path from 'path';

const AGENTS_MD_PATH = path.resolve(__dirname, '..', 'AGENTS.md');

describe('packages/pi/AGENTS.md', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = fs.readFileSync(AGENTS_MD_PATH, 'utf-8');
    lines = content.split('\n');
  });

  // -------------------------------------------------------------------------
  // 1. File exists
  // -------------------------------------------------------------------------
  it('exists on disk', () => {
    expect(fs.existsSync(AGENTS_MD_PATH)).toBe(true);
  });

  it('is a non-empty file', () => {
    const stat = fs.statSync(AGENTS_MD_PATH);
    expect(stat.size).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 2. No Claude Code-specific sections
  // -------------------------------------------------------------------------
  const claudeCodeSections = [
    '## Hooks System',
    '## Testing',
    '## Validation & CI',
    '## GitHub Actions',
    '## Troubleshooting',
    '## Commit Conventions',
    '## Common Tasks',
    '## Configuration',
    '### Claude Code Permissions',
    '## Links',
  ];

  for (const section of claudeCodeSections) {
    it(`does not contain the Claude Code section "${section}"`, () => {
      expect(content).not.toContain(section);
    });
  }

  it('does not contain "hooks.json" references', () => {
    expect(content).not.toContain('hooks.json');
  });

  it('does not contain "settings.local.json" references', () => {
    expect(content).not.toContain('settings.local.json');
  });

  it('does not contain "plugin install" instructions', () => {
    expect(content.toLowerCase()).not.toContain('plugin install');
  });

  // -------------------------------------------------------------------------
  // 3. Has agent mesh section
  // -------------------------------------------------------------------------
  it('contains an "Agent Mesh" section heading', () => {
    expect(content).toMatch(/##\s+Agent Mesh/);
  });

  it('lists at least one named agent', () => {
    // Agents are listed as backtick-wrapped names e.g. `ensemble-orchestrator`
    expect(content).toMatch(/`[a-z]+-[a-z-]+`/);
  });

  it('contains the Agent Delegation Protocol section', () => {
    expect(content).toContain('## Agent Delegation Protocol');
  });

  it('contains the Architecture Overview section', () => {
    expect(content).toContain('## Architecture Overview');
  });

  // -------------------------------------------------------------------------
  // 4. Starts with a markdown heading
  // -------------------------------------------------------------------------
  it('first non-empty line starts with "#"', () => {
    const firstNonEmpty = lines.find((l) => l.trim().length > 0);
    expect(firstNonEmpty).toBeDefined();
    expect(firstNonEmpty!.trimStart().startsWith('#')).toBe(true);
  });

  it('opening heading is an H1 (single #)', () => {
    const firstNonEmpty = lines.find((l) => l.trim().length > 0);
    expect(firstNonEmpty).toMatch(/^#\s/);
  });

  // -------------------------------------------------------------------------
  // 5. Reasonable length
  // -------------------------------------------------------------------------
  it('has more than 20 lines', () => {
    expect(lines.length).toBeGreaterThan(20);
  });

  it('has meaningful content beyond just headings', () => {
    const nonHeadingLines = lines.filter((l) => l.trim().length > 0 && !l.startsWith('#'));
    expect(nonHeadingLines.length).toBeGreaterThan(5);
  });

  // -------------------------------------------------------------------------
  // Content correctness spot-checks
  // -------------------------------------------------------------------------
  it('mentions at least one orchestrator agent', () => {
    expect(content).toContain('orchestrator');
  });

  it('mentions the Task tool delegation pattern', () => {
    // Agent delegation section should mention how agents use the Task tool
    expect(content).toContain('Task');
  });
});
