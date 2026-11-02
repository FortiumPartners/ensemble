/**
 * Mirror packages (MIRROR_PACKAGES) are never read as a source.
 *
 * `packages/pi` is this generator's own output and `packages/full` is the Claude Code
 * bundle, a tree of symlinks into every other package. Neither owns a command or an agent,
 * so discovering one as a source transforms a single source file twice: a duplicate prompt
 * and wrapper skill for one command, a duplicate agent, and a `### full` group in the
 * overview listing an agent that already appears under the package that owns it.
 *
 * The gap stayed latent while packages/full held only SUBDIRECTORIES under `commands/` and
 * `agents/`, one level below where these globs read. It opened the moment the bundle began
 * mirroring `commands/configure-team.yaml` and `agents/documentation-specialist.yaml`,
 * which `lib/team-defaults.js` and `lib/index.js` read by path, so the bundle has to carry
 * them.
 *
 * Every case pairs the mirror package with a control package that must keep being read, so
 * a filter that drops everything fails here too. The mirror's files get basenames of their
 * own rather than the control's, because two files writing one output path with the same
 * content is how a duplicate hides.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generate, generateAgentsMd } from '../src/generator';
import { MIRROR_PACKAGES, SELF_CONTAINED_PI_PACKAGES } from '../src/self-contained-packages';
import { GeneratorOptions } from '../src/types';

const MIRRORS = Object.keys(MIRROR_PACKAGES);

describe('Pi generator: mirror packages are not sources', () => {
  let src: string;
  let piRoot: string;

  const options = (overrides: Partial<GeneratorOptions> = {}): GeneratorOptions => ({
    dryRun: false,
    verbose: false,
    validate: false,
    sourceRoot: src,
    outputRoot: piRoot,
    ...overrides,
  });

  const write = (pkg: string, kind: 'commands' | 'agents', file: string, content: string): void => {
    const dir = path.join(src, 'packages', pkg, kind);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), content, 'utf-8');
  };

  const command = (name: string): string =>
    [
      'metadata:',
      `  name: "ensemble:${name}"`,
      `  description: "The ${name} command"`,
      '  version: "1.0.0"',
      'mission:',
      `  summary: "Summary of ${name}"`,
      'workflow:',
      '  phases:',
      '    - name: "Do it"',
      '      order: 1',
      '      steps:',
      '        - order: 1',
      '          title: "Step"',
      '          description: "Do the thing"',
      '',
    ].join('\n');

  const agent = (name: string): string =>
    [
      'metadata:',
      `  name: ${name}`,
      `  description: "The ${name} agent"`,
      '  version: "1.0.0"',
      'model: sonnet',
      'tools:',
      '  - Read',
      '',
    ].join('\n');

  const plugin = (pkg: string): void => {
    const dir = path.join(src, 'packages', pkg, '.claude-plugin');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'plugin.json'),
      JSON.stringify({ name: `ensemble-${pkg}`, description: `The ${pkg} package`, commands: './commands' }),
      'utf-8'
    );
  };

  beforeEach(() => {
    src = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-mirror-src-'));
    piRoot = path.join(src, 'packages', 'pi');
    fs.writeFileSync(path.join(src, 'CLAUDE.md'), '## Agent Mesh\n\nContent.\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(src, { recursive: true, force: true });
  });

  it('is a precondition of every case below that the fixture packages are classed as they are', () => {
    expect(MIRRORS).toContain('full');
    expect(MIRRORS).toContain('pi');
    expect(MIRRORS).not.toContain('control');
    // A mirror is excluded on its own account, not because it is also self-contained.
    for (const mirror of MIRRORS) {
      expect(Object.keys(SELF_CONTAINED_PI_PACKAGES)).not.toContain(mirror);
    }
  });

  it.each(MIRRORS)('generates no prompt or wrapper skill for a command in packages/%s', async (mirror) => {
    write('control', 'commands', 'ctl.yaml', command('ctl'));
    write(mirror, 'commands', 'mirrored.yaml', command('mirrored'));
    await generate(options());

    expect(fs.existsSync(path.join(piRoot, 'prompts', 'ensemble-ctl.md'))).toBe(true);
    expect(fs.existsSync(path.join(piRoot, 'prompts', 'ensemble-mirrored.md'))).toBe(false);
    expect(fs.existsSync(path.join(piRoot, 'skills', 'ensemble-mirrored'))).toBe(false);
  });

  it.each(MIRRORS)('generates no agent for an agent YAML in packages/%s', async (mirror) => {
    write('control', 'agents', 'ctl-agent.yaml', agent('ctl-agent'));
    write(mirror, 'agents', 'mirrored-agent.yaml', agent('mirrored-agent'));
    await generate(options());

    // Generated agents only: for mirror `pi` the output root IS the source directory this
    // case writes its mirrored YAML into, and the source file is not an agent the run wrote.
    const agentsDir = path.join(piRoot, 'agents');
    const written = (fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : [])
      .filter((f) => f.endsWith('.md'))
      .join(' ');
    expect(written).toContain('ctl-agent');
    expect(written).not.toContain('mirrored-agent');
  });

  it.each(MIRRORS)('gives the AGENTS.md overview no group for packages/%s', (mirror) => {
    plugin('control');
    plugin(mirror);
    write('control', 'agents', 'ctl-agent.yaml', agent('ctl-agent'));
    write(mirror, 'agents', 'mirrored-agent.yaml', agent('mirrored-agent'));

    const { content } = generateAgentsMd(src, piRoot, { dryRun: true });

    expect(content).toContain('ctl-agent');
    expect(content).not.toContain('mirrored-agent');
    expect(content).not.toContain(`### ${mirror}`);
  });
});
