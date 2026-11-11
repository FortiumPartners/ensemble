'use strict';
/**
 * Tests for skill-backed commands ("commands invoke skills"): a command YAML with a top-level
 * `skill: <skill-directory-name>` is a manifest whose prompt lives in
 * `packages/<same package>/skills/<skill>/SKILL.md`.
 *
 * Covers the shared module (scripts/lib/skill-backed-command.js), the consumers that have to
 * recognize a manifest (yaml-parser type detection, the capability drift gate, the
 * generate-markdown CLI) and the rest of what a manifest must not break. The Claude stub
 * rendering lives in command-transformer.test.js, schema rules in schema-validator.test.js and
 * the preflight lint in lint-provider-refs.test.js.
 *
 * Every tree is a throwaway under os.tmpdir() (fixtures/skill-backed/temp-package.js).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const {
  isSkillBacked,
  isValidSkillName,
  resolveSkillFile,
  listSkillReferences,
  readSkillProse,
  readCommandProse
} = require('../lib/skill-backed-command');
const { detectYamlType } = require('../lib/yaml-parser');
const { checkCapabilityInvocationDrift } = require('../lib/capability-ids-check');
const { validateCapabilityInvocationDrift } = require('../validate-all');
const { createPackage, skillFile } = require('./fixtures/skill-backed/temp-package');

const GENERATE_MARKDOWN = path.resolve(__dirname, '..', 'generate-markdown.js');

let packages = [];
afterEach(() => {
  packages.forEach((pkg) => pkg.cleanup());
  packages = [];
});

function tracked(files) {
  const pkg = createPackage(files);
  packages.push(pkg);
  return pkg;
}

const MANIFEST = [
  'metadata:',
  '  name: ensemble:demo',
  '  description: Demonstrate a skill-backed command manifest',
  '  version: 1.0.0',
  '  lastUpdated: "2026-10-17"',
  '  category: planning',
  '  output_path: ensemble/demo.md',
  '  model: high',
  '  argument_hint: "[thing]"',
  'skill: ensemble-demo',
  ''
].join('\n');

describe('isSkillBacked', () => {
  test('is true for a command carrying a skill key, even a malformed one', () => {
    expect(isSkillBacked({ metadata: {}, skill: 'ensemble-demo' })).toBe(true);
    expect(isSkillBacked({ metadata: {}, skill: null })).toBe(true);
  });

  test('is false for a full command and for anything that is not a parsed YAML object', () => {
    expect(isSkillBacked({ metadata: {}, mission: {}, workflow: {} })).toBe(false);
    expect(isSkillBacked(null)).toBe(false);
    expect(isSkillBacked(undefined)).toBe(false);
    expect(isSkillBacked('skill')).toBe(false);
  });
});

describe('isValidSkillName', () => {
  test.each(['ensemble-create-prd', 'a', 'skill2', 'a'.repeat(64)])('accepts %s', (name) => {
    expect(isValidSkillName(name)).toBe(true);
  });

  // The name is joined into a path, so this doubles as the traversal guard.
  test.each(['', 'Upper', 'with space', 'a/b', '../escape', '..', 'a.b', '-lead', 'trail-', 'two--hyphens', 'a'.repeat(65), 5, null, undefined])(
    'rejects %p',
    (name) => {
      expect(isValidSkillName(name)).toBe(false);
    }
  );
});

describe('resolveSkillFile', () => {
  test('finds the SKILL.md in the skills/ directory of the YAML\'s own package', () => {
    const pkg = tracked({ 'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo') });
    expect(resolveSkillFile(pkg.yamlPath('demo'), 'ensemble-demo')).toBe(
      path.join(pkg.dir, 'skills', 'ensemble-demo', 'SKILL.md')
    );
  });

  test('does not borrow a skill of the same name from another package', () => {
    const pkg = tracked({
      'commands/demo.yaml': MANIFEST,
      '../other/skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo')
    });
    expect(() => resolveSkillFile(pkg.yamlPath('demo'), 'ensemble-demo')).toThrow(
      /skill-backed command points at skill 'ensemble-demo', but .*demo[\\/]skills[\\/]ensemble-demo[\\/]SKILL\.md does not exist/
    );
  });

  test('names the skill and the path it looked at when the SKILL.md is missing', () => {
    const pkg = tracked({ 'commands/demo.yaml': MANIFEST });
    const looked = path.join(pkg.dir, 'skills', 'ensemble-demo', 'SKILL.md');
    expect(() => resolveSkillFile(pkg.yamlPath('demo'), 'ensemble-demo')).toThrow(
      `skill 'ensemble-demo', but ${looked} does not exist`
    );
  });

  test('does not accept a directory standing where SKILL.md should be', () => {
    const pkg = tracked({ 'skills/ensemble-demo/SKILL.md/keep': '' });
    expect(() => resolveSkillFile(pkg.yamlPath('demo'), 'ensemble-demo')).toThrow(/does not exist/);
  });

  test.each(['../other', 'Upper', '', null])('refuses %p as a skill name', (skill) => {
    const pkg = tracked({ 'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo') });
    expect(() => resolveSkillFile(pkg.yamlPath('demo'), skill)).toThrow(/is not a valid skill directory name/);
  });
});

// Directory listing order is up to the filesystem. List every directory in the worst case, the
// reverse of sorted order, so a test of "sorted by name" passes only when the code sorts.
function listDirectoriesBackwards() {
  const real = fs.readdirSync;
  return jest.spyOn(fs, 'readdirSync').mockImplementation((dir, options) => {
    const entries = real.call(fs, dir, options);
    const nameOf = (entry) => (typeof entry === 'string' ? entry : entry.name);
    return [...entries].sort((a, b) => (nameOf(a) < nameOf(b) ? 1 : -1));
  });
}

describe('listSkillReferences', () => {
  const skillDir = (pkg) => path.join(pkg.dir, 'skills', 'ensemble-demo');
  const skillPath = (pkg) => path.join(skillDir(pkg), 'SKILL.md');
  const referencePaths = (pkg, ...names) => names.map((name) => path.join(skillDir(pkg), 'references', name));

  test('lists the .md files of references/ beside the SKILL.md, as absolute paths sorted by name', () => {
    const pkg = tracked({
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo'),
      'skills/ensemble-demo/references/c-third.md': 'c\n',
      'skills/ensemble-demo/references/a-first.md': 'a\n',
      'skills/ensemble-demo/references/b-second.md': 'b\n'
    });
    const listing = listDirectoriesBackwards();
    try {
      expect(listSkillReferences(skillPath(pkg))).toEqual(referencePaths(pkg, 'a-first.md', 'b-second.md', 'c-third.md'));
    } finally {
      listing.mockRestore();
    }
  });

  test('is empty for a skill with no references/ directory', () => {
    const pkg = tracked({ 'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo') });
    expect(listSkillReferences(skillPath(pkg))).toEqual([]);
  });

  test('fails, rather than reporting no references, when references/ exists but cannot be listed', () => {
    const pkg = tracked({
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo'),
      'skills/ensemble-demo/references/a.md': 'a\n'
    });
    const real = fs.readdirSync;
    const listing = jest.spyOn(fs, 'readdirSync').mockImplementation((dir, ...rest) => {
      if (String(dir).endsWith('references')) {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${dir}'`), { code: 'EACCES' });
      }
      return real.call(fs, dir, ...rest);
    });
    try {
      expect(() => listSkillReferences(skillPath(pkg))).toThrow(/EACCES: permission denied/);
    } finally {
      listing.mockRestore();
    }
  });

  test('is one level deep: a subdirectory, a directory named like a file, a non-.md file, a symlink and a .md outside references/ are not references', () => {
    const pkg = tracked({
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo'),
      'skills/ensemble-demo/references/a.md': 'a\n',
      'skills/ensemble-demo/references/notes.txt': 'notes\n',
      'skills/ensemble-demo/references/deeper/nested.md': 'nested\n',
      'skills/ensemble-demo/references/folder.md/inner.txt': 'inner\n',
      'skills/ensemble-demo/elsewhere/other.md': 'other\n'
    });
    fs.symlinkSync(
      path.join(skillDir(pkg), 'references', 'a.md'),
      path.join(skillDir(pkg), 'references', 'link.md')
    );
    expect(listSkillReferences(skillPath(pkg))).toEqual(referencePaths(pkg, 'a.md'));
  });
});

describe('readSkillProse', () => {
  const skillPath = (pkg) => path.join(pkg.dir, 'skills', 'ensemble-demo', 'SKILL.md');

  test('is the SKILL.md followed by each reference sorted by name, a line break between files', () => {
    const pkg = tracked({
      'skills/ensemble-demo/SKILL.md': 'SKILL TEXT',
      'skills/ensemble-demo/references/b.md': 'REF B',
      'skills/ensemble-demo/references/a.md': 'REF A'
    });
    const listing = listDirectoriesBackwards();
    try {
      expect(readSkillProse(skillPath(pkg))).toBe('SKILL TEXT\nREF A\nREF B');
    } finally {
      listing.mockRestore();
    }
  });

  test('is the SKILL.md alone for a skill with no references', () => {
    const pkg = tracked({ 'skills/ensemble-demo/SKILL.md': 'SKILL TEXT' });
    expect(readSkillProse(skillPath(pkg))).toBe('SKILL TEXT');
  });
});

describe('readCommandProse', () => {
  test('is the YAML text itself for a command that is not skill-backed', () => {
    const raw = 'metadata:\n  name: x\nmission:\n  summary: run tracker.list\n';
    expect(readCommandProse('/repo/packages/demo/commands/x.yaml', yaml.load(raw), raw)).toBe(raw);
  });

  test('adds the skill\'s SKILL.md for a skill-backed command, whose manifest holds no prose', () => {
    const pkg = tracked({
      'commands/demo.yaml': MANIFEST,
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo', 'Say hello to $ARGUMENTS.')
    });
    const prose = readCommandProse(pkg.yamlPath('demo'), yaml.load(MANIFEST), MANIFEST);
    expect(prose).toContain('name: ensemble:demo');
    expect(prose).toContain('Say hello to $ARGUMENTS.');
  });

  describe('a skill split into references/', () => {
    const files = (extra) => ({
      'commands/demo.yaml': MANIFEST,
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo', 'SKILL-BODY, see references/.'),
      ...extra
    });
    const proseOf = (pkg) => readCommandProse(pkg.yamlPath('demo'), yaml.load(MANIFEST), MANIFEST);

    test('is the manifest, the SKILL.md, then every reference in name order', () => {
      const pkg = tracked(files({
        'skills/ensemble-demo/references/c-third.md': 'REF-C\n',
        'skills/ensemble-demo/references/a-first.md': 'REF-A\n',
        'skills/ensemble-demo/references/b-second.md': 'REF-B\n'
      }));
      const listing = listDirectoriesBackwards();
      try {
        const prose = proseOf(pkg);
        const positions = ['name: ensemble:demo', 'SKILL-BODY', 'REF-A', 'REF-B', 'REF-C'].map((text) => prose.indexOf(text));
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      } finally {
        listing.mockRestore();
      }
    });

    test('does not read a references/ subdirectory or a file that is not .md', () => {
      const pkg = tracked(files({
        'skills/ensemble-demo/references/a.md': 'REF-A\n',
        'skills/ensemble-demo/references/notes.txt': 'NOTES-TXT\n',
        'skills/ensemble-demo/references/deeper/nested.md': 'NESTED-MD\n'
      }));
      const prose = proseOf(pkg);
      expect(prose).toContain('REF-A');
      expect(prose).not.toContain('NOTES-TXT');
      expect(prose).not.toContain('NESTED-MD');
    });

    test('still fails closed, naming the skill, when the SKILL.md is missing: references/ cannot stand in for it', () => {
      const pkg = tracked({
        'commands/demo.yaml': MANIFEST,
        'skills/ensemble-demo/references/a.md': 'REF-A\n'
      });
      expect(() => proseOf(pkg)).toThrow(/skill 'ensemble-demo', but .*SKILL\.md does not exist/);
    });

    test.each([
      ['the SKILL.md', path.join('ensemble-demo', 'SKILL.md')],
      ['a reference', path.join('references', 'a.md')]
    ])('fails closed when %s cannot be read, rather than scanning what is left', (_what, unreadable) => {
      const pkg = tracked(files({ 'skills/ensemble-demo/references/a.md': 'REF-A\n' }));
      const real = fs.readFileSync;
      const reading = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
        if (String(file).endsWith(unreadable)) {
          throw Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' });
        }
        return real.call(fs, file, ...rest);
      });
      try {
        expect(() => proseOf(pkg)).toThrow(/EACCES: permission denied/);
      } finally {
        reading.mockRestore();
      }
    });
  });

  test('throws, naming the skill, when the skill cannot be found', () => {
    const pkg = tracked({ 'commands/demo.yaml': MANIFEST });
    expect(() => readCommandProse(pkg.yamlPath('demo'), yaml.load(MANIFEST), MANIFEST)).toThrow(/skill 'ensemble-demo'/);
  });
});

describe('validateCapabilityInvocationDrift -- skill-backed commands', () => {
  const withCapabilities = (declared) =>
    MANIFEST.replace('  argument_hint: "[thing]"\n', `  argument_hint: "[thing]"\n  capabilities:\n    required:\n      - ${declared}\n`);

  function drift(files) {
    const pkg = tracked(files);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      return { pkg, failures: validateCapabilityInvocationDrift(path.join(pkg.root, 'packages')) };
    } finally {
      log.mockRestore();
    }
  }

  test('reads the skill: a capability its prose invokes but the manifest does not declare is reported', () => {
    const manifest = withCapabilities('tracker.show');
    const { failures } = drift({
      'commands/demo.yaml': manifest,
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo', 'Run `toolchain-cli run tracker.list --json`.')
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(path.join('packages', 'demo', 'commands', 'demo.yaml'));
    expect(failures[0]).toContain("invokes capability 'tracker.list'");
    // The manifest alone has nothing to scan: skipping the skill would have let this through.
    expect(checkCapabilityInvocationDrift(yaml.load(manifest), 'demo.yaml', manifest)).toEqual([]);
  });

  test('a skill that invokes only what the manifest declares is clean', () => {
    const { failures } = drift({
      'commands/demo.yaml': withCapabilities('tracker.show'),
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo', 'Run `toolchain-cli run tracker.show --json`.')
    });
    expect(failures).toEqual([]);
  });

  test('reads the skill\'s references too: an invocation that lives only in a reference is reported', () => {
    const { failures } = drift({
      'commands/demo.yaml': withCapabilities('tracker.show'),
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo', 'Run `toolchain-cli run tracker.show --json`, then follow references/more.md.'),
      'skills/ensemble-demo/references/more.md': 'Then run `toolchain-cli run tracker.list --json`.\n'
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("invokes capability 'tracker.list'");
  });

  test('a reference that invokes only what the manifest declares is clean', () => {
    const { failures } = drift({
      'commands/demo.yaml': withCapabilities('tracker.show'),
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo', 'Follow references/more.md.'),
      'skills/ensemble-demo/references/more.md': 'Run `toolchain-cli run tracker.show --json`.\n'
    });
    expect(failures).toEqual([]);
  });

  test('fails closed, saying why, when the skill is missing: the command cannot be scanned', () => {
    const { failures } = drift({ 'commands/demo.yaml': withCapabilities('tracker.show') });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/demo\.yaml: cannot scan for capability drift: skill-backed command points at skill 'ensemble-demo'/);
  });
});

describe('detectYamlType -- skill-backed manifests', () => {
  test('a manifest is a command although it has no workflow and its category is not one the inference knows', () => {
    expect(detectYamlType(yaml.load(MANIFEST), 'demo.yaml')).toBe('command');
  });

  test('a YAML with neither workflow, skill nor responsibilities is still refused', () => {
    expect(() => detectYamlType({ metadata: { category: 'planning' } }, 'x.yaml')).toThrow(
      /Cannot determine YAML type/
    );
  });

  test('full commands and agents are detected as before', () => {
    expect(detectYamlType({ workflow: { phases: [{ name: 'p', order: 1 }] } }, 'x.yaml')).toBe('command');
    expect(detectYamlType({ responsibilities: ['r'] }, 'x.yaml')).toBe('agent');
  });
});

describe('generate-markdown CLI -- skill-backed manifests', () => {
  function run(yamlPath) {
    const result = spawnSync(process.execPath, [GENERATE_MARKDOWN, '--file', yamlPath, '--dry-run'], {
      encoding: 'utf8'
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  test('detects, validates and renders a manifest whose skill exists', () => {
    const pkg = tracked({
      'commands/demo.yaml': MANIFEST,
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo')
    });

    const { status, output } = run(pkg.yamlPath('demo'));

    expect(output).toContain('Dry run completed (1 files would be generated)');
    expect(status).toBe(0);
    expect(fs.existsSync(path.join(pkg.dir, 'commands', 'ensemble'))).toBe(false);
  });

  test('fails with a clear error naming the skill when it does not exist', () => {
    const pkg = tracked({ 'commands/demo.yaml': MANIFEST });

    const { status, output } = run(pkg.yamlPath('demo'));

    expect(status).toBe(1);
    expect(output).toContain("skill-backed command points at skill 'ensemble-demo'");
    expect(output).toContain('does not exist');
  });

  test('fails when a manifest also carries a prompt key the skill is meant to own', () => {
    const pkg = tracked({
      'commands/demo.yaml': `${MANIFEST}constraints:\n  - Never do the thing.\n`,
      'skills/ensemble-demo/SKILL.md': skillFile('ensemble-demo')
    });

    const { status, output } = run(pkg.yamlPath('demo'));

    expect(status).toBe(1);
    expect(output).toContain("'constraints' is not allowed in a skill-backed command manifest");
  });
});

describe('buildCommandPathMap (dispatcher "read and follow" targets)', () => {
  const { buildCommandPathMap } = require('../lib/file-discovery');

  it('points a skill-backed command at its SKILL.md and leaves a plain command on its generated markdown', async () => {
    const pkg = createPackage({
      'commands/backed.yaml': 'metadata:\n  name: ensemble:backed\n  output_path: ensemble/backed.md\nskill: demo-backed\n',
      'commands/plain.yaml': 'metadata:\n  name: ensemble:plain\n  output_path: ensemble/plain.md\n',
      'skills/demo-backed/SKILL.md': skillFile('demo-backed')
    });
    try {
      const map = await buildCommandPathMap([pkg.yamlPath('backed'), pkg.yamlPath('plain')]);

      // The backed command's generated .md is a stub that depends on Claude Code expanding
      // ${CLAUDE_PLUGIN_ROOT} when it LOADS a command; a dispatcher that has the model Read
      // that file by path would hand it an unexpanded stub, so it must get the skill itself.
      expect(map.get('backed')).toBe(path.join(pkg.dir, 'skills', 'demo-backed', 'SKILL.md'));
      expect(map.get('plain')).toBe(path.join(pkg.dir, 'commands', 'ensemble', 'plain.md'));
    } finally {
      pkg.cleanup();
    }
  });
});
