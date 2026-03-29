/**
 * Integration tests for the Pi orchestrator agent (TRD-015-TEST)
 *
 * Verifies that the generated product-management-orchestrator agent file
 * exists, is well-formed, and uses only Pi-compatible tools. Also validates
 * all agent files in packages/pi/agents/ for Pi tool compatibility.
 *
 * @module ensemble-pi/tests/orchestrator-agent
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';

const AGENTS_DIR = path.resolve(__dirname, '..', 'agents');
const ORCHESTRATOR_PATH = path.join(AGENTS_DIR, 'product-management-orchestrator.md');

// Tools that exist only in Claude Code and must not appear in Pi agents.
const CLAUDE_CODE_ONLY_TOOLS = ['Task', 'TodoWrite', 'Agent', 'Glob', 'Grep', 'AskUserQuestion'];

// Tools that Pi agents are expected to use.
const PI_TOOLS = ['Read', 'Write', 'Edit', 'Bash'];

// ---------------------------------------------------------------------------
// Helper: parse frontmatter tools from a parsed gray-matter result
// ---------------------------------------------------------------------------
function extractTools(parsed: matter.GrayMatterFile<string>): string[] {
  const raw = parsed.data['tools'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  // YAML inline arrays come through as arrays via gray-matter; handle string fallback
  if (typeof raw === 'string') {
    return raw
      .replace(/[\[\]]/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

describe('product-management-orchestrator agent', () => {
  let raw: string;
  let parsed: matter.GrayMatterFile<string>;

  beforeAll(() => {
    raw = fs.readFileSync(ORCHESTRATOR_PATH, 'utf-8');
    parsed = matter(raw);
  });

  // -------------------------------------------------------------------------
  // 1. File exists
  // -------------------------------------------------------------------------
  it('exists at packages/pi/agents/product-management-orchestrator.md', () => {
    expect(fs.existsSync(ORCHESTRATOR_PATH)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Has frontmatter
  // -------------------------------------------------------------------------
  it('file starts with "---" (YAML frontmatter delimiter)', () => {
    expect(raw.trimStart().startsWith('---')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Has name field
  // -------------------------------------------------------------------------
  it('frontmatter contains a name field', () => {
    expect(parsed.data).toHaveProperty('name');
  });

  it('name includes "product-management-orchestrator" or "orchestrator"', () => {
    const name: string = String(parsed.data['name'] ?? '');
    expect(name).toMatch(/orchestrator/i);
  });

  // -------------------------------------------------------------------------
  // 4. Has description field
  // -------------------------------------------------------------------------
  it('frontmatter contains a non-empty description field', () => {
    const description = parsed.data['description'];
    expect(description).toBeDefined();
    expect(String(description ?? '').trim().length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. Tools are Pi-compatible
  // -------------------------------------------------------------------------
  it('tools list does not contain Claude Code-only tools', () => {
    const tools = extractTools(parsed);
    for (const forbidden of CLAUDE_CODE_ONLY_TOOLS) {
      expect(tools).not.toContain(forbidden);
    }
  });

  it('tools list contains at least one Pi-native tool (Read, Write, Edit, or Bash)', () => {
    const tools = extractTools(parsed);
    const hasAtLeastOne = PI_TOOLS.some((t) => tools.includes(t));
    expect(hasAtLeastOne).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Has markdown body
  // -------------------------------------------------------------------------
  it('content after frontmatter is non-empty', () => {
    expect(parsed.content.trim().length).toBeGreaterThan(0);
  });

  it('body starts with a markdown heading (#)', () => {
    const firstNonEmpty = parsed.content
      .split('\n')
      .find((line) => line.trim().length > 0);
    expect(firstNonEmpty).toBeDefined();
    expect(firstNonEmpty!.trimStart().startsWith('#')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. All Pi agents have Pi-compatible tools
// ---------------------------------------------------------------------------
describe('all agents in packages/pi/agents/', () => {
  let agentFiles: string[];

  beforeAll(() => {
    agentFiles = fs
      .readdirSync(AGENTS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(AGENTS_DIR, f));
  });

  it('finds at least one agent file', () => {
    expect(agentFiles.length).toBeGreaterThan(0);
  });

  it('no agent uses Claude Code-only tools', () => {
    const violations: string[] = [];
    const parseErrors: string[] = [];

    for (const agentPath of agentFiles) {
      const content = fs.readFileSync(agentPath, 'utf-8');
      let parsed: matter.GrayMatterFile<string>;
      try {
        parsed = matter(content);
      } catch (err) {
        parseErrors.push(
          `${path.basename(agentPath)}: YAML parse error — ${(err as Error).message.split('\n')[0]}`,
        );
        continue;
      }
      const tools = extractTools(parsed);

      for (const forbidden of CLAUDE_CODE_ONLY_TOOLS) {
        if (tools.includes(forbidden)) {
          violations.push(`${path.basename(agentPath)}: contains forbidden tool "${forbidden}"`);
        }
      }
    }

    expect(parseErrors).toHaveLength(0);  // YAML parse errors: ${parseErrors.join(', ')}

    expect(violations).toHaveLength(0);  // Claude Code-only tools found: ${violations.join(', ')}
  });
});
