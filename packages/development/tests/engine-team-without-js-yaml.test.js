'use strict';

/**
 * The paths that only exist when this installation has no YAML parser (js-yaml): a marketplace
 * cache install keeps the repository but not `node_modules`, so an agent definition and a TRD's
 * `team:` block are read by the modules' own fallbacks.
 *
 * A quoted agent name is the agent's name, and a TRD that declares a roster is refused rather
 * than answered with the default roster: the roster the TRD asked for is the one it must report,
 * and a roster nobody could read is not the default one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The default roster's agents, so the default roster resolves in a fixture project. */
const DEFAULT_AGENTS = [
  'advisor',
  'architect',
  'backend-developer',
  'code-reviewer',
  'documentation-specialist',
  'product-management-orchestrator',
  'tech-lead-orchestrator',
  'test-runner',
];

/**
 * Load a module whose own YAML parser is gone.
 *
 * The module's own `require('js-yaml')` is the first one in its chain, so the first call here is
 * the module's and fails; every later call (a pre-existing module in the chain that hard-requires
 * the parser) gets the real one. If that order ever changes the module does not load at all and
 * the test fails loudly.
 * @param {string} id the module to require
 * @returns {object} the module's exports
 */
function loadWithParserGone(id) {
  let loaded;
  jest.isolateModules(() => {
    let calls = 0;
    jest.doMock('js-yaml', () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("Cannot find module 'js-yaml'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }
      return jest.requireActual('js-yaml');
    });
    loaded = require(id);
  });
  jest.dontMock('js-yaml');
  return loaded;
}

/**
 * A project directory holding one plugin with the given agent definitions.
 * @param {string[]} names the agents the plugin defines
 * @returns {string} the project root
 */
function projectWithAgents(names) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-agents-')));
  const pluginDir = path.join(root, 'packages', 'demo', '.claude-plugin');
  const agentsDir = path.join(root, 'packages', 'demo', 'agents');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'demo' }));
  for (const name of names) {
    fs.writeFileSync(
      path.join(agentsDir, `${name}.yaml`),
      `metadata:\n  name: ${name}\n  description: fixture agent\n`
    );
  }
  return root;
}

/**
 * A project directory holding one plugin with one agent definition of the given text.
 * @param {string} agentYaml the agent definition's text
 * @returns {string} the project root
 */
function projectWithAgentYaml(agentYaml) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-agents-')));
  const pluginDir = path.join(root, 'packages', 'demo', '.claude-plugin');
  const agentsDir = path.join(root, 'packages', 'demo', 'agents');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'demo' }));
  fs.writeFileSync(path.join(agentsDir, 'backend.yaml'), agentYaml);
  return root;
}

/**
 * A project directory holding one TRD and the agents a default roster needs.
 * @param {string} body the TRD's text
 * @returns {string} the project root
 */
function projectWithTrd(body) {
  const root = projectWithAgents(DEFAULT_AGENTS);
  const trdDir = path.join(root, 'docs', 'TRD');
  fs.mkdirSync(trdDir, { recursive: true });
  fs.writeFileSync(path.join(trdDir, 'team.md'), body);
  return root;
}

/**
 * Run the team verb's handler against a project root.
 * @param {object} spec the verb's spec
 * @param {string} root the project root
 * @returns {object} the handler's result
 */
function runTeam(spec, root) {
  return spec.handler({
    env: { HOME: path.join(root, 'home') },
    input: { trd: 'docs/TRD/team.md' },
    projectRoot: root,
  });
}

describe('without js-yaml', () => {
  test('a quoted metadata name is the agent name', () => {
    const root = projectWithAgentYaml(
      'metadata:\n  name: "backend-developer"\n  description: fixture agent\n'
    );
    const { discoverAgents } = loadWithParserGone('../lib/engine/agents');

    const entries = discoverAgents({ env: { HOME: path.join(root, 'home') }, projectRoot: root });

    expect(entries.map(entry => entry.name)).toContain('backend-developer');
  });

  test('a name outside the metadata block is not the agent name', () => {
    const root = projectWithAgentYaml(
      'metadata:\n  description: fixture agent\nspec:\n  name: not-the-agent\n'
    );
    const { discoverAgents } = loadWithParserGone('../lib/engine/agents');

    const entries = discoverAgents({ env: { HOME: path.join(root, 'home') }, projectRoot: root });

    expect(entries.map(entry => entry.name)).not.toContain('not-the-agent');
  });

  test('a TRD that declares a roster is REFUSED, not answered with the default roster', () => {
    const root = projectWithTrd(
      [
        '# A TRD',
        '',
        '```yaml',
        'team:',
        '  roles:',
        '    - name: lead',
        '      agent: advisor',
        '```',
        '',
      ].join('\n')
    );
    const { spec } = loadWithParserGone('../lib/engine/verbs/implement-team');

    const result = runTeam(spec, root);

    expect(result.status).toBe('REFUSED');
    expect(result.code).toBe('TEAM_BLOCK_INVALID');
    expect(result.message).toContain('js-yaml');
  });

  test('a TRD that declares no roster still gets the default roster', () => {
    const root = projectWithTrd(['# A TRD', '', 'This TRD names no roster.', ''].join('\n'));
    const { spec } = loadWithParserGone('../lib/engine/verbs/implement-team');

    const result = runTeam(spec, root);

    expect(result.code).toBeUndefined();
    expect(result.ROSTER_SOURCE).toBe('default');
    expect(result.TEAM_ROLES_JSON).toContain(DEFAULT_AGENTS[0]);
  });
  test('a comment after the agent name is not part of the name', () => {
    const root = projectWithAgentYaml(
      'metadata:\n  name: backend-developer # the default agent\n  description: fixture agent\n'
    );
    const { discoverAgents } = loadWithParserGone('../lib/engine/agents');

    const entries = discoverAgents({ env: { HOME: path.join(root, 'home') }, projectRoot: root });

    expect(entries.map(entry => entry.name)).toContain('backend-developer');
  });

  test('a nested name is not the agent name', () => {
    const root = projectWithAgentYaml(
      'metadata:\n  owner:\n    name: decoy\n  description: fixture agent\n'
    );
    const { discoverAgents } = loadWithParserGone('../lib/engine/agents');

    const entries = discoverAgents({ env: { HOME: path.join(root, 'home') }, projectRoot: root });

    expect(entries.map(entry => entry.name)).not.toContain('decoy');
  });
});
