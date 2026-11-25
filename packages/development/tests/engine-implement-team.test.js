'use strict';

/**
 * TRD-009-TEST (TRD-2026-d571763f): roster and alias decisions of `ensemble implement team`.
 *
 * Every scenario drives the real entry point `main(argv, ctx)` from `lib/ensemble-cli.js` through
 * the real `buildRegistry()`, against a fixture project whose agent definitions are real files on
 * disk, so what is pinned is what a maintainer running `ensemble implement team` gets.
 *
 * The fixture sets `HOME` to a directory inside the fixture, so whatever plugins the host happens
 * to have installed under `~/.omp` cannot change an outcome.
 */

const fs = require('fs');
const path = require('path');

const { buildRegistry } = require('../lib/ensemble-cli');
const { buildAliasMap, discoverAgents } = require('../lib/engine/agents');
const MESSAGES = require('../lib/engine/messages');
const { resolveDefaultTeamRoles } = require('../lib/team-defaults');
const { expectMatchesOutputSchema, makeCtx, makeRoot, runMain } = require('./helpers/engine-run');

const PREFLIGHT = path.join(
  __dirname,
  '..',
  'skills',
  'ensemble-implement-trd-tasks',
  'references',
  'phase-1-preflight.md'
);

/** The eight agents the default roster names, so the fixture can register all of them. */
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

function writeAgent(root, pkg, name) {
  const dir = path.join(root, 'packages', pkg, 'agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.yaml`),
    `metadata:\n  name: ${name}\n  description: fixture agent\n`
  );
}

function writePlugin(root, pkg, pluginName) {
  const dir = path.join(root, 'packages', pkg, '.claude-plugin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: pluginName }));
}

function writeRuntimeAgent(home, scope, pkg, name, frontmatterName) {
  const parts = [home, '.omp', 'plugins', 'node_modules'];
  if (scope !== null) parts.push(scope);
  parts.push(pkg, 'agents');
  const dir = path.join(...parts);
  fs.mkdirSync(dir, { recursive: true });
  const head = frontmatterName === undefined ? '' : `---\nname: ${frontmatterName}\n---\n`;
  fs.writeFileSync(path.join(dir, `${name}.md`), `${head}# ${name}\n`);
}

/** A fixture project with the eight default agents registered under `ensemble-development`. */
function makeFixture() {
  const root = makeRoot();
  const home = path.join(root, 'fixture-home');
  fs.mkdirSync(home, { recursive: true });
  writePlugin(root, 'development', 'ensemble-development');
  for (const name of DEFAULT_AGENTS) writeAgent(root, 'development', name);
  return { home, root };
}

function writeTrd(root, relative, body) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return relative;
}

function run(fx, argv = []) {
  return runMain(
    ['implement', 'team', ...argv],
    makeCtx({ cwd: fx.root, env: { HOME: fx.home } })
  );
}

function teamSpec() {
  return buildRegistry().get('implement', 'team');
}

const TRD_WITH_BLOCK = [
  '# A TRD',
  '',
  '```yaml',
  'team:',
  '  roles:',
  '    - name: lead',
  '      agent: tech-lead-orchestrator',
  '      owns: [planning]',
  '    - name: builder',
  '      agents: [backend-developer, documentation-specialist]',
  '      owns: [implementation]',
  '```',
  '',
].join('\n');

describe('ensemble implement team: the roster', () => {
  it('registers the verb so a maintainer can reach it', () => {
    expect(teamSpec().name).toBe('team');
    expect(teamSpec().sideEffect).toBe('read');
  });

  it('takes the roster from the TRD team block when it has one', () => {
    const fx = makeFixture();
    const trd = writeTrd(fx.root, 'docs/TRD/TRD-2026-001-team.md', TRD_WITH_BLOCK);

    const { envelope } = run(fx, [trd]);

    expect(envelope.status).toBe('OK');
    expect(envelope.data.ROSTER_SOURCE).toBe('trd');
    expect(envelope.data.TEAM_ROLES).toEqual({
      builder: { agents: ['backend-developer', 'documentation-specialist'], owns: ['implementation'] },
      lead: { agents: ['tech-lead-orchestrator'], owns: ['planning'] },
    });
    expectMatchesOutputSchema(teamSpec(), envelope);
  });

  it('refuses a team block that declares the same role twice', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-003-team.md',
      [
        '# A TRD',
        '',
        '```yaml',
        'team:',
        '  roles:',
        '    - name: lead',
        '      agent: tech-lead-orchestrator',
        '    - name: lead',
        '      agent: advisor',
        '```',
        '',
      ].join('\n')
    );

    const { envelope } = run(fx, [trd]);

    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TEAM_BLOCK_INVALID');
    expect(envelope.error.message).toContain("role 'lead' is declared more than once");
  });

  it('keeps a role named __proto__ an ordinary role of the roster', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-004-team.md',
      [
        '# A TRD',
        '',
        '```yaml',
        'team:',
        '  roles:',
        '    - name: __proto__',
        '      agent: advisor',
        '```',
        '',
      ].join('\n')
    );

    const { envelope } = run(fx, [trd]);

    expect(envelope.status).toBe('OK');
    expect(Object.keys(envelope.data.TEAM_ROLES)).toContain('__proto__');
    expect(envelope.data.TEAM_ROLES['__proto__']).toEqual({
      agents: ['advisor'],
      owns: [],
    });
    expectMatchesOutputSchema(teamSpec(), envelope);
  });

  it('refuses a role named __proto__ whose agent is not registered', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-005-team.md',
      [
        '# A TRD',
        '',
        '```yaml',
        'team:',
        '  roles:',
        '    - name: __proto__',
        '      agent: nobody-registered',
        '```',
        '',
      ].join('\n')
    );

    const { envelope } = run(fx, [trd]);

    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('AGENT_NOT_REGISTERED');
    expect(envelope.error.message).toContain('nobody-registered');
  });

  it('reads the team block from frontmatter too', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-002-team.md',
      ['---', 'team:', '  roles:', '    - name: lead', '      agent: advisor', '---', '# A TRD', ''].join('\n')
    );

    const { envelope } = run(fx, [trd]);

    expect(envelope.data.ROSTER_SOURCE).toBe('trd');
    expect(envelope.data.TEAM_ROLES).toEqual({ lead: { agents: ['advisor'], owns: [] } });
  });

  it('refuses a malformed team block instead of falling back to the default roster', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-003-team.md',
      ['# A TRD', '', '```yaml', 'team:', '  roles:', '    - owns: [planning]', '```', ''].join('\n')
    );

    const { envelope, exitCode } = run(fx, [trd]);

    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TEAM_BLOCK_INVALID');
    expect(exitCode).toBe(1);
  });

  it('refuses a team block whose yaml cannot be parsed instead of falling back to the default roster', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-004-team.md',
      ['# A TRD', '', '```yaml', 'team: [', '  roles:', '```', ''].join('\n')
    );

    const { envelope, exitCode } = run(fx, [trd]);

    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('TEAM_BLOCK_INVALID');
    expect(exitCode).toBe(1);
  });

  it('refuses an agent name that is only an inherited property', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-005-team.md',
      [
        '# A TRD',
        '',
        '```yaml',
        'team:',
        '  roles:',
        '    - name: lead',
        '      agent: constructor',
        '```',
        '',
      ].join('\n')
    );

    const { envelope, exitCode } = run(fx, [trd]);

    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('AGENT_NOT_REGISTERED');
    expect(envelope.error.message).toContain('constructor');
    expect(exitCode).toBe(1);
  });

  it('supplies the eight-role default roster when no TRD block says otherwise', () => {
    const fx = makeFixture();

    const { envelope } = run(fx);

    expect(envelope.status).toBe('OK');
    expect(envelope.data.ROSTER_SOURCE).toBe('default');
    expect(Object.keys(envelope.data.TEAM_ROLES).length).toBe(8);
    expect(envelope.data.TEAM_ROLES).toEqual(resolveDefaultTeamRoles({}));
    expectMatchesOutputSchema(teamSpec(), envelope);
  });

  it('produces the compatibility roster for the deprecated --builder flag', () => {
    const fx = makeFixture();

    const { envelope } = run(fx, ['--builder', 'backend-developer']);

    expect(envelope.data.ROSTER_SOURCE).toBe('builder-compat');
    expect(envelope.data.TEAM_ROLES).toEqual({
      architect: { agents: ['architect'], owns: ['task-design'] },
      builder: { agents: ['backend-developer'], owns: ['implementation'] },
      documentation: {
        agents: ['documentation-specialist'],
        owns: ['pr-boundary-doc-maintenance'],
      },
      lead: { agents: ['tech-lead-orchestrator'], owns: ['planning', 'escalation'] },
    });
    expect(envelope.data.WARNINGS.length).toBeGreaterThan(0);
  });

  it('produces the compatibility roster for the deprecated builder_agent frontmatter', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-004-team.md',
      ['---', 'builder_agent: documentation-specialist', '---', '# A TRD', ''].join('\n')
    );

    const { envelope } = run(fx, [trd]);

    expect(envelope.data.ROSTER_SOURCE).toBe('builder-compat');
    expect(envelope.data.TEAM_ROLES.builder.agents).toEqual(['documentation-specialist']);
  });

  it('lets the TRD block win over the deprecated flag and says it ignored it', () => {
    const fx = makeFixture();
    const trd = writeTrd(fx.root, 'docs/TRD/TRD-2026-005-team.md', TRD_WITH_BLOCK);

    const { envelope } = run(fx, [trd, '--builder', 'advisor']);

    expect(envelope.data.ROSTER_SOURCE).toBe('trd');
    expect(envelope.data.WARNINGS.join('\n')).toContain('--builder');
  });
});

describe('ensemble implement team: the alias map', () => {
  it('maps an unqualified agent name to its namespaced runtime id', () => {
    const fx = makeFixture();

    const { envelope } = run(fx);

    expect(envelope.data.AGENT_ALIAS_MAP['backend-developer']).toBe(
      'ensemble-development:backend-developer'
    );
  });

  it('includes runtime agents installed under ~/.omp/plugins', () => {
    const fx = makeFixture();
    writeRuntimeAgent(fx.home, '@sunstone-partners', 'ensemble-pi', 'pi-only-agent');
    writeRuntimeAgent(fx.home, null, 'ensemble-extra', 'extra-agent', 'extra-agent');

    const { envelope } = run(fx);

    expect(envelope.data.AGENT_ALIAS_MAP['pi-only-agent']).toBe('ensemble-pi:pi-only-agent');
    expect(envelope.data.AGENT_ALIAS_MAP['extra-agent']).toBe('ensemble-extra:extra-agent');
  });

  it('skips the mirror packages, so a mirrored copy never supplies an id', () => {
    const fx = makeFixture();
    writePlugin(fx.root, 'full', 'ensemble-full');
    writeAgent(fx.root, 'full', 'mirror-only-agent');

    const { envelope } = run(fx);

    expect(envelope.data.AGENT_ALIAS_MAP['mirror-only-agent']).toBeUndefined();
    expect(discoverAgents({ env: { HOME: fx.home }, projectRoot: fx.root }).map(a => a.name)).not.toContain(
      'mirror-only-agent'
    );
  });

  it('refuses when a roster agent has no alias, naming the agent', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-006-team.md',
      ['# A TRD', '', '```yaml', 'team:', '  roles:', '    - name: lead', '      agent: nobody-developer', '```', ''].join(
        '\n'
      )
    );

    const { envelope, exitCode } = run(fx, [trd]);

    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('AGENT_NOT_REGISTERED');
    expect(envelope.error.message).toBe(MESSAGES.agentNotRegistered('nobody-developer'));
    expect(envelope.error.details.agents).toEqual(['nobody-developer']);
    expect(exitCode).toBe(1);
  });

  it('prints the refusal the skill prints', () => {
    const preflight = fs.readFileSync(PREFLIGHT, 'utf8');
    expect(preflight).toContain(MESSAGES.agentNotRegistered('beads-build-wave'));
  });

  it('accepts a roster agent that is already a namespaced id', () => {
    const fx = makeFixture();
    const trd = writeTrd(
      fx.root,
      'docs/TRD/TRD-2026-007-team.md',
      [
        '# A TRD',
        '',
        '```yaml',
        'team:',
        '  roles:',
        '    - name: lead',
        '      agent: ensemble-development:advisor',
        '```',
        '',
      ].join('\n')
    );

    const { envelope } = run(fx, [trd]);

    expect(envelope.status).toBe('OK');
  });

  it('lets an exact unqualified entry win over an alias', () => {
    const map = buildAliasMap([
      { id: 'ensemble-development:advisor', name: 'advisor', tier: 'source' },
      { id: 'advisor', name: 'advisor', tier: 'source' },
    ]);
    expect(map.advisor).toBe('advisor');
  });

  it('prefers a runtime entry over a source entry for the same name', () => {
    const map = buildAliasMap([
      { id: 'ensemble-development:advisor', name: 'advisor', tier: 'source' },
      { id: 'ensemble-pi:advisor', name: 'advisor', tier: 'runtime' },
    ]);
    expect(map.advisor).toBe('ensemble-pi:advisor');
  });

  it('breaks a tie within one tier on the smallest id', () => {
    const map = buildAliasMap([
      { id: 'ensemble-zeta:advisor', name: 'advisor', tier: 'source' },
      { id: 'ensemble-alpha:advisor', name: 'advisor', tier: 'source' },
    ]);
    expect(map.advisor).toBe('ensemble-alpha:advisor');
  });
});

describe('ensemble implement team: what it reports', () => {
  it('returns one Team mode log line naming every role', () => {
    const fx = makeFixture();

    const { envelope } = run(fx);

    expect(envelope.data.TEAM_MODE_LOG).toBe(
      'Team mode (default roster): lead=tech-lead-orchestrator, architect=architect, builders=1, ' +
        'reviewer=code-reviewer, qa=test-runner, advisor=advisor, ' +
        'pm=product-management-orchestrator, documentation=documentation-specialist'
    );
  });

  it('says TRD roster when the TRD supplied the roster, and none for an absent role', () => {
    const fx = makeFixture();
    const trd = writeTrd(fx.root, 'docs/TRD/TRD-2026-008-team.md', TRD_WITH_BLOCK);

    const { envelope } = run(fx, [trd]);

    expect(envelope.data.TEAM_MODE_LOG).toBe(
      'Team mode (TRD roster): lead=tech-lead-orchestrator, architect=none, builders=2, ' +
        'reviewer=none, qa=none, advisor=none, pm=none, documentation=none'
    );
  });

  it('says default roster for the compatibility roster', () => {
    const fx = makeFixture();

    const { envelope } = run(fx, ['--builder', 'backend-developer']);

    expect(envelope.data.TEAM_MODE_LOG).toContain('Team mode (default roster):');
  });

  it('emits TEAM_ROLES_JSON compactly in sorted key order', () => {
    const fx = makeFixture();
    const trd = writeTrd(fx.root, 'docs/TRD/TRD-2026-009-team.md', TRD_WITH_BLOCK);

    const { envelope } = run(fx, [trd]);

    expect(envelope.data.TEAM_ROLES_JSON).toBe(
      '{"builder":{"agents":["backend-developer","documentation-specialist"],"owns":["implementation"]},' +
        '"lead":{"agents":["tech-lead-orchestrator"],"owns":["planning"]}}'
    );
    expect(JSON.parse(envelope.data.TEAM_ROLES_JSON)).toEqual(envelope.data.TEAM_ROLES);
  });

  it('answers identically on two runs', () => {
    const fx = makeFixture();
    writeRuntimeAgent(fx.home, '@sunstone-partners', 'ensemble-pi', 'pi-only-agent');

    const first = run(fx);
    const second = run(fx);

    expect(first.stdout).toBe(second.stdout);
  });
  it('a plugin manifest that is null does not stop the roster from resolving', () => {
    const fx = makeFixture();
    const manifest = path.join(fx.root, 'packages', 'development', '.claude-plugin', 'plugin.json');
    fs.writeFileSync(manifest, 'null');

    const { envelope } = run(fx);

    expect(envelope.status).toBe('OK');
    expect(envelope.data.ROSTER_SOURCE).toBe('default');
  });
});
