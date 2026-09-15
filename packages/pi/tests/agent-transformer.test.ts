/**
 * Unit tests for agent-transformer.ts (TRD-007-TEST)
 *
 * Covers: tool filtering, AskUserQuestion stripping, YAML frontmatter format,
 * markdown body preservation, both YAML layouts, empty tools, and TransformResult shape.
 */

import matter from 'gray-matter';
import {
  transformAgent,
  agentOutputPath,
  buildAgentResult,
} from '../src/transformers/agent-transformer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Top-level layout: name/description/tools at root. */
const TOP_LEVEL_AGENT: Record<string, unknown> = {
  name: 'backend-developer',
  description: 'Implements server-side logic',
  tools: ['Read', 'Write', 'Task', 'Glob', 'Agent'],
};

/** Nested metadata layout. */
const METADATA_AGENT: Record<string, unknown> = {
  metadata: {
    name: 'frontend-developer',
    description: 'Implements UI components',
    tools: ['Read', 'Write', 'WebSearch'],
  },
};

/** Agent with AskUserQuestion in tools list. */
const ASK_USER_AGENT: Record<string, unknown> = {
  name: 'interviewer',
  description: 'Conducts interviews',
  tools: ['Read', 'AskUserQuestion'],
};

/** Agent with all tools stripped. */
const ALL_STRIPPED_AGENT: Record<string, unknown> = {
  name: 'orchestrator',
  description: 'Orchestrates tasks',
  tools: ['Agent', 'TodoWrite', 'Glob', 'Grep'],
};

/** Agent with no tools field. */
const NO_TOOLS_AGENT: Record<string, unknown> = {
  name: 'minimal-agent',
  description: 'A minimal agent',
};

/** Agent with mission body content. */
const MISSION_AGENT: Record<string, unknown> = {
  name: 'mission-agent',
  description: 'Agent with mission',
  tools: ['Read', 'Write'],
  mission: {
    summary: 'Core purpose of this agent.',
    boundaries: {
      handles: 'All API work',
      doesNotHandle: 'UI work',
    },
  },
  responsibilities: [
    {
      priority: 'high',
      title: 'API Development',
      description: 'Build REST APIs.',
    },
  ],
};

/** Agent with model field. */
const MODEL_AGENT: Record<string, unknown> = {
  name: 'specialized-agent',
  description: 'Uses a specific model',
  tools: ['Read'],
  model: 'claude-opus-4',
};

const SOURCE_PATH = '/workspace/packages/development/agents/backend-developer.yaml';
const OUTPUT_ROOT = '/workspace/packages/pi';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transformAgent', () => {
  describe('YAML frontmatter format', () => {
    it('starts with "---\\nname:"', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      expect(output).toMatch(/^---\nname:/);
    });

    it('frontmatter contains name, description, tools lines', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      expect(output).toContain('name: "backend-developer"');
      expect(output).toContain('description: "Implements server-side logic"');
      expect(output).toContain('tools:');
    });

    it('closes frontmatter with "---"', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      const lines = output.split('\n');
      // Second occurrence of '---' closes the frontmatter
      const closingIdx = lines.indexOf('---', 1);
      expect(closingIdx).toBeGreaterThan(0);
    });

    it('includes model in frontmatter when present', () => {
      const output = transformAgent(MODEL_AGENT, SOURCE_PATH, {});
      expect(output).toContain('model: "claude-opus-4"');
    });

    it('does not include model line when model is absent', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      expect(output).not.toContain('model:');
    });
  });

  describe('tool filtering and native delegation', () => {
    it('preserves explicit delegation as the native task capability', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      expect(matter(output).data.tools).toEqual(['Read', 'Write', 'task']);
    });

    it('preserves delegation declared in nested metadata', () => {
      const output = transformAgent({
        metadata: {
          name: 'orchestrator',
          description: 'Delegates to specialists',
          tools: ['Read', 'Task'],
        },
      }, SOURCE_PATH, {});
      expect(matter(output).data.tools).toEqual(['Read', 'task']);
    });

    it('retains an already-native task capability', () => {
      const output = transformAgent({
        name: 'orchestrator',
        description: 'Delegates to specialists',
        tools: ['task'],
      }, SOURCE_PATH, {});
      expect(matter(output).data.tools).toEqual(['task']);
    });

    it('does not grant delegation to a non-delegating agent', () => {
      const output = transformAgent(METADATA_AGENT, SOURCE_PATH, {});
      expect(matter(output).data.tools).toEqual(['Read', 'Write']);
    });

    it('strips all Claude Code-only tools: TodoWrite, NotebookEdit, ExitPlanMode, EnterPlanMode, Grep', () => {
      const agent: Record<string, unknown> = {
        name: 'test',
        description: 'test',
        tools: ['Read', 'TodoWrite', 'NotebookEdit', 'ExitPlanMode', 'EnterPlanMode', 'Grep', 'Write'],
      };
      const output = transformAgent(agent, SOURCE_PATH, {});
      expect(output).toContain('["Read", "Write"]');
      expect(output).not.toMatch(/TodoWrite|NotebookEdit|ExitPlanMode|EnterPlanMode|Grep/);
    });

    it('strips WebFetch', () => {
      const agent: Record<string, unknown> = {
        name: 'test',
        description: 'test',
        tools: ['Read', 'WebFetch'],
      };
      const output = transformAgent(agent, SOURCE_PATH, {});
      expect(output).not.toContain('WebFetch');
      expect(output).toContain('["Read"]');
    });
  });

  describe('AskUserQuestion stripped from tools', () => {
    it('maps AskUserQuestion to ask_user (which IS Pi-available)', () => {
      const output = transformAgent(ASK_USER_AGENT, SOURCE_PATH, {});
      expect(output).toContain('ask_user');
      expect(output).not.toContain('AskUserQuestion');
    });

    it('retains Read alongside the mapped ask_user', () => {
      const output = transformAgent(ASK_USER_AGENT, SOURCE_PATH, {});
      expect(output).toContain('["Read", "ask_user"]');
    });
  });

  describe('empty tools list', () => {
    it('grants no tools when all declared tools are unsupported', () => {
      const output = transformAgent(ALL_STRIPPED_AGENT, SOURCE_PATH, {});
      expect(matter(output).data.tools).toEqual([]);
    });

    it('grants no tools when no tools field is present', () => {
      const output = transformAgent(NO_TOOLS_AGENT, SOURCE_PATH, {});
      expect(matter(output).data.tools).toEqual([]);
    });
  });

  describe('both YAML layouts', () => {
    it('reads name from top-level key', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      expect(output).toContain('name: "backend-developer"');
    });

    it('reads name from metadata.name', () => {
      const output = transformAgent(METADATA_AGENT, SOURCE_PATH, {});
      expect(output).toContain('name: "frontend-developer"');
    });

    it('reads description from top-level key', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      expect(output).toContain('description: "Implements server-side logic"');
    });

    it('reads description from metadata.description', () => {
      const output = transformAgent(METADATA_AGENT, SOURCE_PATH, {});
      expect(output).toContain('description: "Implements UI components"');
    });

    it('does not inherit delegation when top-level tools override metadata.tools', () => {
      const agent: Record<string, unknown> = {
        metadata: {
          name: 'mixed-agent',
          description: 'Mixed layout',
          tools: ['Task'],
        },
        tools: ['Read', 'Edit'],
      };
      const output = transformAgent(agent, SOURCE_PATH, {});
      expect(matter(output).data.tools).toEqual(['Read', 'Edit']);
    });
  });

  describe('markdown body', () => {
    it('includes an H1 heading with the agent name after frontmatter', () => {
      const output = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
      const bodyStart = output.indexOf('---\n\n');
      const body = output.slice(bodyStart);
      expect(body).toContain('# backend-developer');
    });

    it('renders mission section when present', () => {
      const output = transformAgent(MISSION_AGENT, SOURCE_PATH, {});
      expect(output).toContain('## Mission');
      expect(output).toContain('Core purpose of this agent.');
    });

    it('renders boundaries subsections when present', () => {
      const output = transformAgent(MISSION_AGENT, SOURCE_PATH, {});
      expect(output).toContain('### Handles');
      expect(output).toContain('All API work');
      expect(output).toContain('### Does Not Handle');
      expect(output).toContain('UI work');
    });

    it('renders responsibilities section when present', () => {
      const output = transformAgent(MISSION_AGENT, SOURCE_PATH, {});
      expect(output).toContain('## Responsibilities');
      expect(output).toContain('### API Development');
      expect(output).toContain('Build REST APIs.');
    });

    it('replaces AskUserQuestion in body text with ask_user', () => {
      const agent: Record<string, unknown> = {
        name: 'test-agent',
        description: 'test',
        tools: ['Read'],
        mission: {
          summary: 'Use AskUserQuestion to interview the user.',
        },
      };
      const output = transformAgent(agent, SOURCE_PATH, {});
      expect(output).not.toContain('AskUserQuestion');
      expect(output).toContain('ask_user');
    });
  });
});

describe('agentOutputPath', () => {
  it('places output file under <outputRoot>/agents/', () => {
    const result = agentOutputPath('backend-developer', OUTPUT_ROOT);
    expect(result).toBe(`${OUTPUT_ROOT}/agents/backend-developer.md`);
  });

  it('lowercases and kebab-cases agent names with spaces', () => {
    const result = agentOutputPath('Backend Developer', OUTPUT_ROOT);
    expect(result).toBe(`${OUTPUT_ROOT}/agents/backend-developer.md`);
  });

  it('appends .md extension', () => {
    const result = agentOutputPath('my-agent', OUTPUT_ROOT);
    expect(result).toMatch(/\.md$/);
  });
});

describe('buildAgentResult', () => {
  it('returns a TransformResult with type === "agent"', () => {
    const result = buildAgentResult(TOP_LEVEL_AGENT, SOURCE_PATH, OUTPUT_ROOT, {});
    expect(result.type).toBe('agent');
  });

  it('returns sourcePath matching the provided source path', () => {
    const result = buildAgentResult(TOP_LEVEL_AGENT, SOURCE_PATH, OUTPUT_ROOT, {});
    expect(result.sourcePath).toBe(SOURCE_PATH);
  });

  it('returns outputPath under agents/ directory', () => {
    const result = buildAgentResult(TOP_LEVEL_AGENT, SOURCE_PATH, OUTPUT_ROOT, {});
    expect(result.outputPath).toContain('/agents/');
    expect(result.outputPath).toMatch(/\.md$/);
  });

  it('returns content matching transformAgent output', () => {
    const result = buildAgentResult(TOP_LEVEL_AGENT, SOURCE_PATH, OUTPUT_ROOT, {});
    const direct = transformAgent(TOP_LEVEL_AGENT, SOURCE_PATH, {});
    expect(result.content).toBe(direct);
  });

  it('result has all required TransformResult fields', () => {
    const result = buildAgentResult(TOP_LEVEL_AGENT, SOURCE_PATH, OUTPUT_ROOT, {});
    expect(result).toHaveProperty('sourcePath');
    expect(result).toHaveProperty('outputPath');
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('type');
  });

  it('verbose option does not throw', () => {
    const writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(() =>
      buildAgentResult(TOP_LEVEL_AGENT, SOURCE_PATH, OUTPUT_ROOT, { verbose: true })
    ).not.toThrow();
    writeSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Frontmatter YAML safety (TRD-009-TEST)
//
// The previous rule quoted a description only when it *started* with a YAML
// indicator, so a mid-string ": " slipped through and produced an unparseable
// block. A parse failure is not partial -- the consumer drops the whole agent,
// silently. Quoting is now unconditional; these are the adversarial inputs.
// ---------------------------------------------------------------------------

describe('transformAgent › frontmatter is always parseable YAML', () => {
  const yaml = require('js-yaml') as typeof import('js-yaml');

  /** Parse just the frontmatter block out of a transformed agent. */
  const frontmatterOf = (output: string): Record<string, unknown> => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(output);
    if (!match) throw new Error('no frontmatter block');
    return yaml.load(match[1]) as Record<string, unknown>;
  };

  const hostile: Array<[string, string]> = [
    ['mid-string colon', 'Helm charts: templating, values, releases'],
    ['leading bracket', '[experimental] does a thing'],
    ['bracket group with trailing content', '[a-path] [--flag] extra'],
    ['embedded newlines', 'First line,\n\nsecond line.\n'],
    ['embedded double quote', 'He said "hi" then left'],
    ['embedded backslash', 'a \ backslash'],
    ['leading YAML indicators', '*anchor #comment | > % & !'],
    ['non-ASCII', 'emoji ✓ and unicode é']
  ];

  it.each(hostile)('%s round-trips through the frontmatter', (_label, description) => {
    const output = transformAgent(
      { name: 'hostile-agent', description, tools: ['Read'] },
      SOURCE_PATH,
      {}
    );
    const expected = description.replace(/\s+/g, ' ').trim();
    expect(frontmatterOf(output).description).toBe(expected);
  });

  it('a colon in the description no longer breaks the block', () => {
    // Regression: the old startsWith-based predicate let this through unquoted.
    const output = transformAgent(
      { name: 'a', description: 'Does X: then Y', tools: ['Read'] },
      SOURCE_PATH,
      {}
    );
    expect(() => frontmatterOf(output)).not.toThrow();
    expect(frontmatterOf(output).description).toBe('Does X: then Y');
  });

  it('tools stays an array, not a string', () => {
    const output = transformAgent(
      { name: 'a', description: 'd', tools: ['Read', 'Write'] },
      SOURCE_PATH,
      {}
    );
    expect(frontmatterOf(output).tools).toEqual(['Read', 'Write']);
  });

  it('a multi-line description collapses to a single line', () => {
    const output = transformAgent(
      { name: 'a', description: 'one\ntwo', tools: ['Read'] },
      SOURCE_PATH,
      {}
    );
    const descriptionLines = output.split('\n').filter(l => l.startsWith('description:'));
    expect(descriptionLines).toHaveLength(1);
  });
});
