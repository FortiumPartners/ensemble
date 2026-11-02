'use strict';
/**
 * packages/pi and packages/full MIRROR other packages' content; neither owns any.
 * Reading one as a source produces a second agent, command or skill out of one source
 * file, in every runtime the monorepo generates.
 *
 * Each generator already excluded them from its ADAPTER-SKILL discovery, with a comment
 * saying why. None excluded them from its AGENT and COMMAND discovery, because those read
 * one level inside each package's `agents/` and `commands/` directory and packages/full
 * held only subdirectories there. The moment it began mirroring
 * `commands/configure-team.yaml` and `agents/documentation-specialist.yaml` -- which
 * `lib/team-defaults.js` and `lib/index.js` read by path, so the bundle has to carry them
 * -- the Codex generator reported 25 agents and 42 command skills instead of 24 and 41,
 * and the Pi overview grew a `### full` group listing an agent that already appeared under
 * the package owning it. Both CI jobs went red on stale generated output.
 *
 * The fixture names its mirror package `full` and gives it an agent and a command whose
 * basenames differ from the real package's, so a pass here cannot come from two files
 * writing the same output path with the same content -- which is how the opencode side
 * stayed green while reading the mirror.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateCommandSkills } = require('../generate-codex');
const { MIRROR_PACKAGES, owningPackage } = require('../lib/mirror-packages');
const { AgentTranslator } = require('../generate-opencode/src/agent-translator');
const { CommandTranslator } = require('../generate-opencode/src/command-translator');

/**
 * A packages/ tree with one real package and one mirror package, each holding one agent
 * and one command.
 *
 * @returns {{root: string, packagesDir: string}}
 */
function writeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-exclusion-'));
  const packagesDir = path.join(root, 'packages');

  const command = name => [
    'metadata:',
    `  name: ${name}`,
    `  description: Command ${name}`,
    'steps:',
    '  - name: Step',
    '    description: Does a thing',
    '',
  ].join('\n');

  const agent = name => [
    'metadata:',
    `  name: ${name}`,
    `  description: Agent ${name}`,
    'model: sonnet',
    'tools:',
    '  - Read',
    '',
  ].join('\n');

  for (const [pkg, suffix] of [['development', 'real'], ['full', 'mirrored']]) {
    fs.mkdirSync(path.join(packagesDir, pkg, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(packagesDir, pkg, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(packagesDir, pkg, 'commands', `cmd-${suffix}.yaml`), command(`cmd-${suffix}`));
    fs.writeFileSync(path.join(packagesDir, pkg, 'agents', `agent-${suffix}.yaml`), agent(`agent-${suffix}`));
  }

  return { root, packagesDir };
}

describe('owningPackage', () => {
  test('names the package by the first segment, whatever the depth', () => {
    const packagesDir = path.join('/repo', 'packages');
    expect(owningPackage(path.join(packagesDir, 'full', 'agents', 'a.yaml'), packagesDir)).toBe('full');
    expect(owningPackage(path.join(packagesDir, 'full', 'skills', 'adapter-x', 'SKILL.md'), packagesDir)).toBe('full');
    expect(owningPackage(path.join(packagesDir, 'development', 'commands', 'c.yaml'), packagesDir)).toBe('development');
  });

  test('both mirror packages are named', () => {
    expect(MIRROR_PACKAGES.has('full')).toBe(true);
    expect(MIRROR_PACKAGES.has('pi')).toBe(true);
    expect(MIRROR_PACKAGES.has('development')).toBe(false);
  });
});

describe('the Codex generator skips a mirror package', () => {
  test('a command in packages/full produces no Codex skill', () => {
    const { root, packagesDir } = writeFixture();
    const outputDir = path.join(root, 'out');
    try {
      generateCommandSkills({ dryRun: false, verbose: false, packagesDir, outputDir, rootDir: root });
      const written = fs.existsSync(path.join(outputDir, 'skills', 'commands'))
        ? fs.readdirSync(path.join(outputDir, 'skills', 'commands'))
        : [];
      expect(written.join(' ')).toContain('real');
      expect(written.join(' ')).not.toContain('mirrored');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the OpenCode translators skip a mirror package', () => {
  test('discoverAgentFiles leaves packages/full out', () => {
    const { root, packagesDir } = writeFixture();
    try {
      const found = new AgentTranslator({ packagesDir }).discoverAgentFiles();
      expect(found.some(f => f.includes(`${path.sep}development${path.sep}`))).toBe(true);
      expect(found.some(f => f.includes(`${path.sep}full${path.sep}`))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('discoverCommandFiles leaves packages/full out', () => {
    const { root, packagesDir } = writeFixture();
    try {
      const found = new CommandTranslator({ packagesDir }).discoverCommandFiles();
      expect(found.some(f => f.includes(`${path.sep}development${path.sep}`))).toBe(true);
      expect(found.some(f => f.includes(`${path.sep}full${path.sep}`))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
