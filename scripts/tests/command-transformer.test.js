'use strict';
/**
 * Tests for the dispatcher-command "## Subcommands" rendering in
 * scripts/lib/command-transformer.js's transformCommandToMarkdown (see
 * local://dispatcher-command-design.md). Mirrors the equivalent Codex
 * coverage in scripts/tests/generate-codex.test.js. Also covers the Claude Code stub a
 * skill-backed command renders to, and that a command without `skill:` renders as it always did.
 */

const path = require('path');
const { transformCommandToMarkdown } = require('../lib/command-transformer');
const yaml = require('js-yaml');
const { extractFrontmatter } = require('../lib/frontmatter-check');
const { createPackage, skillFile } = require('./fixtures/skill-backed/temp-package');
const { plainCommand, PLAIN_COMMAND_EXPECTED } = require('./fixtures/skill-backed/plain-command');

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

describe('transformCommandToMarkdown — capabilities frontmatter length-gating (TRD-022, PR 5 review P3)', () => {
  function capabilitiesCommand(capabilities) {
    const command = dispatcherCommand([]);
    delete command.dispatch;
    if (capabilities) {
      command.metadata.capabilities = capabilities;
    }
    return command;
  }

  function renderFrontmatter(capabilities) {
    return transformCommandToMarkdown(
      capabilitiesCommand(capabilities),
      path.join(REPO_ROOT, 'packages/development/commands/issue.yaml')
    );
  }

  test('both capabilities-required and capabilities-optional lines render when both lists are non-empty', () => {
    const markdown = renderFrontmatter({ required: ['tracker.show'], optional: ['work-graph.ready'] });
    expect(markdown).toContain('capabilities-required: "tracker.show"');
    expect(markdown).toContain('capabilities-optional: "work-graph.ready"');
  });

  test('omits both lines when metadata.capabilities is absent', () => {
    expect(renderFrontmatter(undefined)).not.toContain('capabilities-');
  });

  // TRD-2026-8d825f54 PR 5 review P3: a present-but-empty `capabilities: {required: [],
  // optional: []}` declaration (the schema's own default shape) must render nothing, exactly
  // like the absent case -- matching Pi/OpenCode's own length-gating and the Codex fix this
  // review introduced.
  test('omits both lines when capabilities is present but both lists are empty, byte-identical to the absent case', () => {
    const empty = renderFrontmatter({ required: [], optional: [] });
    const absent = renderFrontmatter(undefined);
    expect(empty).not.toContain('capabilities-');
    expect(empty).toBe(absent);
  });
});

describe('transformCommandToMarkdown — skill-backed command stub', () => {
  let pkg;
  beforeEach(() => {
    pkg = createPackage({ 'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo') });
  });
  afterEach(() => pkg.cleanup());

  function manifest(metadataExtras = {}, skill = 'ensemble-demo') {
    return {
      metadata: {
        name: 'ensemble:demo',
        description: 'Demonstrate a skill-backed command manifest',
        version: '1.0.0',
        lastUpdated: '2026-10-17',
        category: 'planning',
        model: 'high',
        argument_hint: '[thing] [--flag]',
        ...metadataExtras
      },
      skill
    };
  }

  const render = (data) => transformCommandToMarkdown(data, pkg.yamlPath('demo'));
  const frontmatterOf = (markdown) => yaml.load(extractFrontmatter(markdown));
  const bodyOf = (markdown) => markdown.replace(/^---\n[\s\S]*?\n---\n/, '');

  test('emits the command frontmatter through the code path a full command uses, plus Read', () => {
    expect(frontmatterOf(render(manifest()))).toEqual({
      name: 'ensemble:demo',
      description: 'Demonstrate a skill-backed command manifest',
      version: '1.0.0',
      category: 'planning',
      'last-updated': '2026-10-17',
      'allowed-tools': 'Read',
      'argument-hint': '[thing] [--flag]',
      model: 'opus'
    });
  });

  test('the body is the DO NOT EDIT header and a fixed pointer at the skill, nothing else', () => {
    expect(bodyOf(render(manifest()))).toBe(
      '<!-- DO NOT EDIT - Generated from demo.yaml -->\n' +
      '<!-- To modify this file, edit the YAML source and run: npm run generate -->\n' +
      '\n' +
      'Read the file ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-demo/SKILL.md and follow its instructions exactly; ' +
      'resolve any relative paths in it against ${CLAUDE_PLUGIN_ROOT}/skills/ensemble-demo/. ' +
      'Wherever that file refers to its ARGUMENTS, use this value: $ARGUMENTS\n'
    );
  });

  // Claude Code substitutes EVERY $ARGUMENTS in a command body, so the sigil may appear only
  // as the value; the relative-path clause for a skill's references/ must not repeat it.
  test('the $ARGUMENTS sigil appears exactly once, however many clauses the pointer has', () => {
    expect(bodyOf(render(manifest())).match(/\$ARGUMENTS/g)).toHaveLength(1);
  });

  test('merges Read into the tools the manifest already grants, once', () => {
    expect(frontmatterOf(render(manifest({ allowed_tools: ['Bash', 'Grep'] })))['allowed-tools']).toBe('Bash, Grep, Read');
    expect(frontmatterOf(render(manifest({ allowed_tools: ['Read', 'Bash'] })))['allowed-tools']).toBe('Read, Bash');
  });

  test('leaves the manifest it was given untouched', () => {
    const data = manifest({ allowed_tools: ['Bash'] });
    render(data);
    expect(data.metadata.allowed_tools).toEqual(['Bash']);
  });

  test('keeps visibility and capabilities in the frontmatter exactly as a full command would', () => {
    const frontmatter = frontmatterOf(
      render(manifest({ visibility: 'hidden', capabilities: { required: ['tracker.show'], optional: ['work-graph.ready'] } }))
    );
    expect(frontmatter['user-invocable']).toBe(false);
    expect(frontmatter['capabilities-required']).toBe('tracker.show');
    expect(frontmatter['capabilities-optional']).toBe('work-graph.ready');
  });

  test('fails generation, naming the skill and the path it looked at, when the skill does not exist', () => {
    expect(() => render(manifest({}, 'ensemble-missing'))).toThrow(
      `skill 'ensemble-missing', but ${path.join(pkg.dir, 'skills', 'ensemble-missing', 'SKILL.md')} does not exist`
    );
  });

  test.each(['../escape', 'Upper', 'two--hyphens', ''])('refuses %p as a skill name', (skill) => {
    expect(() => render(manifest({}, skill))).toThrow(/is not a valid skill directory name/);
  });
});

describe('transformCommandToMarkdown — a command without skill: renders exactly as it did before', () => {
  test('matches the output frozen from the transformer as it stood before skill-backed commands', () => {
    expect(
      transformCommandToMarkdown(plainCommand(), path.join(REPO_ROOT, 'packages/demo/commands/demo-plain.yaml'))
    ).toBe(PLAIN_COMMAND_EXPECTED);
  });
});
