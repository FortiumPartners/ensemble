'use strict';
/**
 * Tests for the dispatcher-command "## Subcommands" rendering in
 * scripts/lib/command-transformer.js's transformCommandToMarkdown (see
 * local://dispatcher-command-design.md). Mirrors the equivalent Codex
 * coverage in scripts/tests/generate-codex.test.js.
 */

const path = require('path');
const { transformCommandToMarkdown } = require('../lib/command-transformer');

// Matches the real repoRoot computation inside command-transformer.js
// (path.resolve(__dirname, '../..') from scripts/lib) so relative-path
// assertions below reflect what the generator actually produces, not an
// arbitrary fixture path outside the real repo tree.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIX_ISSUE_OUTPUT = path.join(REPO_ROOT, 'packages/development/commands/fix-issue.md');
const LIST_ISSUE_OUTPUT = path.join(REPO_ROOT, 'packages/development/commands/list-issue.md');

function dispatcherCommand(subcommands) {
  return {
    metadata: {
      name: 'ensemble:issue',
      description: 'Dispatch to an issue-management subcommand by keyword',
      version: '1.0.0',
      lastUpdated: '2026-10-05',
      category: 'implementation'
    },
    mission: { summary: 'Thin routing layer over issue-related subcommands.' },
    dispatch: { subcommands },
    workflow: {
      phases: [
        {
          name: 'Dispatch',
          order: 1,
          steps: [
            {
              order: 1,
              title: 'Route by first argument token',
              description: 'Parse $ARGUMENTS and hand off to the matching sibling command',
              actions: ['Parse $ARGUMENTS.']
            }
          ]
        }
      ]
    }
  };
}

describe('transformCommandToMarkdown — dispatcher "## Subcommands" rendering', () => {
  test('renders one bullet per subcommand with description and resolved sibling path', () => {
    const commandPathsByRef = new Map([
      ['fix-issue', FIX_ISSUE_OUTPUT],
      ['list-issue', LIST_ISSUE_OUTPUT]
    ]);
    const markdown = transformCommandToMarkdown(
      dispatcherCommand([
        { keyword: 'fix', ref: 'fix-issue', description: 'Fix a bug end to end' },
        { keyword: 'list', ref: 'list-issue', description: 'List open Beads issues via br/bv' }
      ]),
      path.join(REPO_ROOT, 'packages/development/commands/issue.yaml'),
      commandPathsByRef
    );

    expect(markdown).toContain('## Subcommands');
    expect(markdown).toContain(
      "- **`fix`** - Fix a bug end to end. Invoke `/ensemble:fix-issue` directly, or read and follow `packages/development/commands/fix-issue.md`, passing the remaining arguments through as its $ARGUMENTS."
    );
    expect(markdown).toContain(
      "- **`list`** - List open Beads issues via br/bv. Invoke `/ensemble:list-issue` directly, or read and follow `packages/development/commands/list-issue.md`, passing the remaining arguments through as its $ARGUMENTS."
    );
  });

  test('renders without a description prefix when a subcommand has none', () => {
    const commandPathsByRef = new Map([['fix-issue', FIX_ISSUE_OUTPUT]]);
    const markdown = transformCommandToMarkdown(
      dispatcherCommand([{ keyword: 'fix', ref: 'fix-issue' }]),
      path.join(REPO_ROOT, 'packages/development/commands/issue.yaml'),
      commandPathsByRef
    );

    expect(markdown).toContain('- **`fix`** - Invoke `/ensemble:fix-issue` directly');
    expect(markdown).not.toMatch(/- \*\*`fix`\*\* - \. Invoke/);
  });

  test('places Subcommands before Workflow in the rendered section order', () => {
    const commandPathsByRef = new Map([['fix-issue', FIX_ISSUE_OUTPUT]]);
    const markdown = transformCommandToMarkdown(
      dispatcherCommand([{ keyword: 'fix', ref: 'fix-issue', description: 'd' }]),
      path.join(REPO_ROOT, 'packages/development/commands/issue.yaml'),
      commandPathsByRef
    );

    expect(markdown.indexOf('## Subcommands')).toBeLessThan(markdown.indexOf('## Workflow'));
  });

  test('throws when a subcommand ref has no entry in commandPathsByRef', () => {
    expect(() =>
      transformCommandToMarkdown(
        dispatcherCommand([{ keyword: 'fix', ref: 'does-not-exist', description: 'd' }]),
        path.join(REPO_ROOT, 'packages/development/commands/issue.yaml'),
        new Map()
      )
    ).toThrow(/references unknown command 'does-not-exist'/);
  });

  test('a command with no dispatch field never renders a Subcommands section', () => {
    const plain = dispatcherCommand([{ keyword: 'fix', ref: 'fix-issue', description: 'd' }]);
    delete plain.dispatch;
    const markdown = transformCommandToMarkdown(
      plain,
      path.join(REPO_ROOT, 'packages/development/commands/fix-issue.yaml')
    );
    expect(markdown).not.toContain('## Subcommands');
  });
});

describe('transformCommandToMarkdown — workflow step actions', () => {
  test('renders each action as a top-level list item with no leading indent (markdownlint MD007)', () => {
    const command = dispatcherCommand([{ keyword: 'fix', ref: 'fix-issue', description: 'd' }]);
    command.workflow.phases[0].steps[0].actions = ['First action.', 'Second action.'];
    delete command.dispatch;
    const markdown = transformCommandToMarkdown(
      command,
      path.join(REPO_ROOT, 'packages/development/commands/fix-issue.yaml')
    );

    expect(markdown).toMatch(/^- First action\.$/m);
    expect(markdown).toMatch(/^- Second action\.$/m);
    expect(markdown).not.toMatch(/^ +- (First|Second) action\./m);
  });
});
