'use strict';

/**
 * Shared test fixture (NOT a test file itself): a full, non-skill-backed command that touches
 * every section scripts/lib/command-transformer.js renders, and the exact Markdown it
 * rendered BEFORE skill-backed commands existed.
 *
 * PLAIN_COMMAND_EXPECTED was produced by the transformer as it stood at that point, not by the
 * current one, so a test comparing the two proves a YAML without `skill:` still renders
 * byte-for-byte as it used to. Change it only when the rendering of full commands is changed
 * on purpose.
 */

function plainCommand() {
  return {
    metadata: {
      name: 'ensemble:demo-plain',
      description: 'Exercise every section a full command renders, for the unchanged-output test',
      version: '1.2.3',
      lastUpdated: '2026-10-17',
      category: 'implementation',
      output_path: 'ensemble/demo-plain.md',
      source: 'sunstone',
      model: 'medium',
      argument_hint: '[target] [--flag]',
      visibility: 'hidden',
      allowed_tools: ['Read', 'Bash'],
      capabilities: { required: ['tracker.show'], optional: ['work-graph.ready'] }
    },
    mission: { summary: 'Render every section of a full command.\nA second mission line.\n' },
    parameters: [
      { name: 'flag', type: 'boolean', default: false, description: 'A flag\n  whose description wraps.' },
      { name: 'target', type: 'string', required: true, description: 'What to act on.' }
    ],
    workflow: {
      phases: [
        {
          name: 'Second Phase',
          order: 2,
          steps: [{ order: 1, title: 'Wrap up', actions: ['Print the result.'] }]
        },
        {
          name: 'First Phase',
          order: 1,
          steps: [
            {
              order: 2,
              title: 'Delegate',
              description: 'Hand the diff off.',
              delegation: { agent: 'code-reviewer', context: 'Review the diff.' }
            },
            {
              order: 1,
              title: 'Scan',
              description: 'Look around.',
              actions: ['Read $ARGUMENTS.', 'List the files.'],
              mcp_tool: { name: 'mcp__demo__search', usage: 'Search the index.\n', fallback: 'Fall back to grep.' }
            },
            { order: 3, description: 'An untitled step.', mcp_tool: 'mcp__demo__fetch' }
          ]
        }
      ]
    },
    expectedOutput: {
      format: 'Markdown report',
      structure: [{ name: 'Summary', description: 'One paragraph.' }, { name: 'Details' }]
    }
  };
}

const PLAIN_COMMAND_EXPECTED = [
  '---',
  'name: "ensemble:demo-plain"',
  'description: "Exercise every section a full command renders, for the unchanged-output test"',
  'user-invocable: false',
  'version: "1.2.3"',
  'category: "implementation"',
  'last-updated: "2026-10-17"',
  'allowed-tools: "Read, Bash"',
  'capabilities-required: "tracker.show"',
  'capabilities-optional: "work-graph.ready"',
  'argument-hint: "[target] [--flag]"',
  'model: "sonnet"',
  '---',
  '<!-- DO NOT EDIT - Generated from demo-plain.yaml -->',
  '<!-- To modify this file, edit the YAML source and run: npm run generate -->',
  '',
  '',
  'Render every section of a full command.',
  'A second mission line.',
  '',
  '## Arguments',
  '',
  '- **`flag`** (boolean, optional, default: `false`): A flag whose description wraps.',
  '- **`target`** (string, required): What to act on.',
  '',
  '## Workflow',
  '',
  '### Phase 1: First Phase',
  '',
  '**1. Scan**',
  '   Look around.',
  '',
  '- Read $ARGUMENTS.',
  '- List the files.',
  '',
  '   **MCP Tool:** `mcp__demo__search`',
  '   Search the index.',
  '',
  '   **Fallback:** Fall back to grep.',
  '',
  '**2. Delegate**',
  '   Hand the diff off.',
  '',
  '   **Delegation:** @code-reviewer',
  '   Review the diff.',
  '',
  '**3. Step 3**',
  '   An untitled step.',
  '',
  '   **MCP Tool:** `mcp__demo__fetch`',
  '',
  '### Phase 2: Second Phase',
  '',
  '**1. Wrap up**',
  '',
  '- Print the result.',
  '',
  '## Expected Output',
  '',
  '**Format:** Markdown report',
  '',
  '**Structure:**',
  '- **Summary**: One paragraph.',
  '- **Details**: ',
  '',
  '## Usage',
  '',
  '```',
  '/ensemble:demo-plain [target] [--flag]',
  '```',
  '',
].join('\n');

module.exports = { plainCommand, PLAIN_COMMAND_EXPECTED };
