const fs = require('fs');
const path = require('path');

/**
 * br-rt4: beads-build.yaml dispatched Task(subagent_type=beads-build-wave) and
 * implement-trd.yaml dispatched Task(subagent_type=implement-trd-task), but
 * both targets shipped only as commands - never as agents. A command file is
 * not in the agent registry, so the dispatch could not resolve and the
 * documented execution engine was unreachable.
 *
 * This guard fails if any command dispatches a concrete subagent_type that has
 * no matching agent definition on disk.
 */
describe('every subagent_type dispatched by a command resolves to a real agent', () => {
  const commandsDir = path.join(__dirname, '../commands');
  const agentsDir = path.join(__dirname, '../agents');

  // Agents this package can dispatch: its own, plus any sibling package's.
  const packagesDir = path.join(__dirname, '../..');
  const knownAgents = new Set(
    fs
      .readdirSync(packagesDir)
      .map((pkg) => path.join(packagesDir, pkg, 'agents'))
      .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory())
      .flatMap((dir) => fs.readdirSync(dir))
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.md'))
      .map((f) => f.replace(/\.(yaml|md)$/, ''))
  );

  // Placeholders resolved at runtime from context, not literal agent names.
  const isPlaceholder = (name) => name.startsWith('<') || name === '';

  const dispatches = fs
    .readdirSync(commandsDir)
    .filter((f) => f.endsWith('.yaml'))
    .flatMap((file) => {
      const text = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      const matches = text.match(/subagent_type=(?:"|')?([^,)"'\s]*)/g) || [];
      return matches.map((m) => ({
        file,
        agent: m.replace(/^subagent_type=(?:"|')?/, ''),
      }));
    })
    .filter(({ agent }) => !isPlaceholder(agent));

  test('at least one concrete dispatch exists to check', () => {
    expect(dispatches.length).toBeGreaterThan(0);
  });

  test.each(dispatches)('%s dispatches $agent, which exists as an agent', ({ file, agent }) => {
    expect(knownAgents.has(agent)).toBe(true);
    expect(file).toBeTruthy();
  });

  // br-hn0: an agent file on disk is not enough. Claude Code's plugin manifest
  // reference says an explicit `agents` array REPLACES auto-discovery of agents/, so a
  // file that is on disk but not listed is never registered and Task(subagent_type=...)
  // cannot reach it -- even on the latest release. The check is against THIS package's
  // manifest, not any package's: `ensemble-full` and the Pi build mirror or
  // auto-discover every agent, which would mask a standalone ensemble-development
  // install that never registered the agent its own commands dispatch.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../.claude-plugin/plugin.json'), 'utf8')
  );
  const registeredAgents = new Set([].concat(manifest.agents || []).map((a) => path.basename(a, '.md')));

  test('the manifest lists agents explicitly (this guard assumes replace-not-discover)', () => {
    expect(registeredAgents.size).toBeGreaterThan(0);
  });

  test.each(dispatches)('%s dispatches $agent, which plugin.json registers', ({ agent }) => {
    expect(registeredAgents.has(agent)).toBe(true);
  });

  // ensemble-full lists every agent explicitly too (as agents/<pkg>/<name>.md).
  const fullManifest = JSON.parse(
    fs.readFileSync(path.join(packagesDir, 'full/.claude-plugin/plugin.json'), 'utf8')
  );
  const fullRegistered = new Set(fullManifest.agents.map((a) => path.basename(a, '.md')));

  test.each(dispatches)('%s dispatches $agent, which ensemble-full registers', ({ agent }) => {
    expect(fullRegistered.has(agent)).toBe(true);
  });

  // br-hn0: a session that loaded an older plugin must fail at the start, naming the
  // fix, instead of after preflight when the dispatch finds nothing to call.
  test.each(['beads-build.yaml', 'implement-trd-beads.yaml'])(
    '%s halts early when beads-build-wave is not registered',
    (file) => {
      const text = fs.readFileSync(path.join(commandsDir, file), 'utf8');
      expect(text).toMatch(/agent beads-build-wave is not registered in this session/);
      expect(text).toMatch(/\/ensemble:reinstall-plugins/);
    }
  );

  // The two that regressed. Named explicitly so deleting either agent fails
  // loudly even if the dispatch prose is reworded.
  test.each(['beads-build-wave'])(
    '%s ships as an agent, not only as a command',
    (name) => {
      expect(fs.existsSync(path.join(agentsDir, `${name}.yaml`))).toBe(true);
      expect(fs.existsSync(path.join(agentsDir, `${name}.md`))).toBe(true);
      expect(fs.existsSync(path.join(commandsDir, `${name}.yaml`))).toBe(true);
    }
  );

  test('runner agent delegates to its command instead of duplicating it', () => {
    for (const name of ['beads-build-wave']) {
      const text = fs.readFileSync(path.join(agentsDir, `${name}.yaml`), 'utf8');
      expect(text).toMatch(new RegExp(`ensemble:${name}`));
      expect(text).toMatch(/RUNNER, not a second copy of the procedure/);
      expect(text).toMatch(/the command wins/);
    }
  });
});
