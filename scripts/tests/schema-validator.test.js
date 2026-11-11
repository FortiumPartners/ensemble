'use strict';
/**
 * Tests for validateCommandSchema's dispatch.subcommands ref-exists semantic
 * check (mirrors the existing workflow.phases[].steps[].delegation.agent
 * exists check). See local://dispatcher-command-design.md.
 */

const path = require('path');
const { validateCommandSchema } = require('../lib/schema-validator');
const { createPackage, skillFile } = require('./fixtures/skill-backed/temp-package');

function baseCommand(dispatch) {
  return {
    metadata: {
      name: 'ensemble:issue',
      description: 'Dispatch to an issue-management subcommand by keyword',
      version: '1.0.0',
      lastUpdated: '2026-10-05',
      category: 'implementation'
    },
    mission: { summary: 'Thin routing layer over issue-related subcommands.' },
    dispatch,
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

describe('validateCommandSchema — dispatch.subcommands ref-exists check', () => {
  test('passes when every subcommand ref is a known command name', () => {
    const commandNames = new Set(['fix-issue', 'list-issue']);
    expect(() =>
      validateCommandSchema(
        baseCommand({
          subcommands: [
            { keyword: 'fix', ref: 'fix-issue', description: 'd' },
            { keyword: 'list', ref: 'list-issue', description: 'd' }
          ]
        }),
        '/repo/packages/development/commands/issue.yaml',
        new Set(),
        commandNames
      )
    ).not.toThrow();
  });

  test('throws with the unresolved ref named when a subcommand ref is unknown', () => {
    const commandNames = new Set(['fix-issue']);
    expect(() =>
      validateCommandSchema(
        baseCommand({
          subcommands: [{ keyword: 'fix', ref: 'does-not-exist', description: 'd' }]
        }),
        '/repo/packages/development/commands/issue.yaml',
        new Set(),
        commandNames
      )
    ).toThrow(/Referenced command 'does-not-exist' not found in command ecosystem/);
  });

  test('skips the ref-exists check entirely when commandNames is not supplied (empty set)', () => {
    // Mirrors the delegation.agent-exists check's own opt-out semantics:
    // an empty/omitted set means "the caller didn't wire this up", not
    // "every ref is invalid" -- must not produce false positives for call
    // sites that don't pass commandNames.
    expect(() =>
      validateCommandSchema(
        baseCommand({
          subcommands: [{ keyword: 'fix', ref: 'does-not-exist', description: 'd' }]
        }),
        '/repo/packages/development/commands/issue.yaml'
      )
    ).not.toThrow();
  });

  test('a command with no dispatch field is unaffected by the check', () => {
    const plain = baseCommand(undefined);
    delete plain.dispatch;
    expect(() =>
      validateCommandSchema(plain, '/repo/packages/development/commands/fix-issue.yaml', new Set(), new Set(['fix-issue']))
    ).not.toThrow();
  });
});

describe('validateCommandSchema — metadata.visibility', () => {
  const withVisibility = (visibility) => {
    const cmd = baseCommand(undefined);
    delete cmd.dispatch;
    cmd.metadata.visibility = visibility;
    return cmd;
  };
  const FILE = '/repo/packages/development/commands/x.yaml';

  test.each(['visible', 'hidden'])('accepts visibility: %s', (visibility) => {
    expect(() => validateCommandSchema(withVisibility(visibility), FILE)).not.toThrow();
  });

  test('rejects a value outside the enum', () => {
    let thrown;
    try {
      validateCommandSchema(withVisibility('secret'), FILE);
    } catch (errors) {
      thrown = errors;
    }
    expect(Array.isArray(thrown)).toBe(true);
    expect(thrown.some((e) => /visibility/.test(e.path || e.field || e.message || String(e)))).toBe(true);
  });

  test('a dispatcher ref to a hidden command resolves (refs are keyed by metadata.name only)', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { buildCommandNameSet } = require('../lib/schema-validator');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-names-'));
    try {
      const hidden = path.join(dir, 'leaf.yaml');
      fs.writeFileSync(hidden, 'metadata:\n  name: ensemble:leaf\n  visibility: hidden\n');
      const names = await buildCommandNameSet([hidden]);
      expect(names.has('leaf')).toBe(true);

      const dispatcher = baseCommand({ subcommands: [{ keyword: 'go', ref: 'leaf' }] });
      expect(() => validateCommandSchema(dispatcher, FILE, new Set(), names)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validateCommandSchema — metadata.capabilities', () => {
  const withCapabilities = (capabilities) => {
    const cmd = baseCommand(undefined);
    delete cmd.dispatch;
    cmd.metadata.capabilities = capabilities;
    return cmd;
  };
  const FILE = '/repo/packages/development/commands/x.yaml';

  test('accepts a command YAML with capabilities: {required: [tracker.show], optional: [work-graph.ready]}', () => {
    expect(() =>
      validateCommandSchema(withCapabilities({ required: ['tracker.show'], optional: ['work-graph.ready'] }), FILE)
    ).not.toThrow();
  });

  test('rejects an id that does not match the <category>.<capability> pattern', () => {
    let thrown;
    try {
      validateCommandSchema(withCapabilities({ required: ['trackershow'] }), FILE);
    } catch (errors) {
      thrown = errors;
    }
    expect(Array.isArray(thrown)).toBe(true);
    expect(thrown.some((e) => /capabilities/.test(e.path || e.field || e.message || String(e)))).toBe(true);
  });

  test('rejects an unknown key inside the capabilities object', () => {
    let thrown;
    try {
      validateCommandSchema(withCapabilities({ wanted: ['tracker.show'] }), FILE);
    } catch (errors) {
      thrown = errors;
    }
    expect(Array.isArray(thrown)).toBe(true);
  });
});

describe('validateCommandSchema — skill-backed manifests', () => {
  let pkg;
  beforeEach(() => {
    pkg = createPackage({ 'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo') });
  });
  afterEach(() => pkg.cleanup());

  const metadata = {
    name: 'ensemble:demo',
    description: 'Demonstrate a skill-backed command manifest',
    version: '1.0.0',
    lastUpdated: '2026-10-17',
    category: 'planning'
  };
  const manifest = (extra = {}) => ({ metadata, skill: 'ensemble-demo', ...extra });
  const errorsOf = (data) => {
    try {
      validateCommandSchema(data, pkg.yamlPath('demo'));
    } catch (errors) {
      return errors;
    }
    return [];
  };

  test('accepts metadata and a skill that exists, with no mission or workflow', () => {
    expect(errorsOf(manifest())).toEqual([]);
  });

  // Each value is schema-valid on its own, so the only finding is that the manifest carries it.
  test.each([
    ['mission', { summary: 'A mission long enough to pass its own schema.' }],
    ['workflow', { phases: [{ name: 'Only phase', order: 1 }] }],
    ['dispatch', { subcommands: [{ keyword: 'go', ref: 'demo' }] }],
    ['expectedOutput', { format: 'Markdown' }],
    ['constraints', ['Never do the thing.']],
    ['parameters', [{ name: 'flag', type: 'boolean' }]],
    ['expectedInput', { description: 'free-form' }]
  ])('rejects %s on a manifest once, naming it and pointing at the skill', (key, value) => {
    const errors = errorsOf(manifest({ [key]: value }));

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe(key);
    expect(errors[0].details).toContain(`'${key}' is not allowed in a skill-backed command manifest`);
    expect(errors[0].details).toContain('SKILL.md');
  });

  test.each(['Upper', '../escape', 'a/b', 'two--hyphens', '', 'a'.repeat(65), 5, null])(
    'rejects %p as a skill name with the schema\'s finding alone',
    (skill) => {
      const errors = errorsOf(manifest({ skill }));

      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('/skill');
    }
  );

  test('rejects a skill that is not in the same package, saying where it looked', () => {
    const errors = errorsOf(manifest({ skill: 'ensemble-missing' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('skill');
    expect(errors[0].details).toContain(path.join(pkg.dir, 'skills', 'ensemble-missing', 'SKILL.md'));
  });

  test('still needs metadata', () => {
    const errors = errorsOf({ skill: 'ensemble-demo' });
    expect(errors.map((e) => e.details)).toEqual(['must have required property \'metadata\' ({"missingProperty":"metadata"})']);
  });

  test('a command without skill: still needs both mission and workflow, reported exactly as before', () => {
    const errors = errorsOf({ metadata });

    expect(errors.map((e) => `${e.field}: ${e.details}`)).toEqual([
      'root: must have required property \'mission\' ({"missingProperty":"mission"})',
      'root: must have required property \'workflow\' ({"missingProperty":"workflow"})'
    ]);
  });
});
