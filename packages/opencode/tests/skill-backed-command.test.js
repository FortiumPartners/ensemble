/**
 * Skill-backed commands in the OpenCode generator.
 *
 * A command YAML with a top-level `skill` is a manifest (metadata plus the name of the skill that
 * carries the whole prompt). It used to be rejected here ("missing metadata or workflow"), which
 * failed the whole pipeline. Now:
 *
 *   - the CommandTranslator turns it into a thin command that tells the agent to load the skill, and
 *   - the SkillCopier ships the skill itself, byte for byte, as the command's one skill
 *     (.opencode/skill/<skill>/SKILL.md): OpenCode has no wrapper skills, so nothing can duplicate it.
 *
 * Each case pairs the manifest with an ordinary command, so a generator that stubs everything, or
 * nothing, fails. Everything runs on throwaway packages/ and output directories.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { CommandTranslator } = require('../../../scripts/generate-opencode/src/command-translator.js');
const { SkillCopier } = require('../lib/skill-copier.js');
const {
  runPipeline,
  discoverSkillSourceFiles,
  discoverCommandSkills,
} = require('../../../scripts/generate-opencode/index.js');

// A source skill written to defeat any re-serialization: a comment in the frontmatter, a
// double-quoted description with escaped quotes, nested metadata, a trailing blank line.
const SKILL_SOURCE = [
  '---',
  '# kept verbatim, not re-dumped',
  'name: ensemble-make-thing',
  'description: "Make a thing, with \\"quoted\\" words. Use when asked."',
  'disable-model-invocation: true',
  'metadata:',
  '  version: "1.0.0"',
  '  category: planning',
  '---',
  '',
  'Make the thing described by $ARGUMENTS.',
  '',
  '',
].join('\n');

const manifest = (name, skill, extra = []) =>
  [
    'metadata:',
    `  name: ensemble:${name}`,
    `  description: "The ${name} command"`,
    '  version: 1.0.0',
    ...extra,
    `skill: ${skill}`,
    '',
  ].join('\n');

const ORDINARY = [
  'metadata:',
  '  name: ensemble:plain',
  '  description: "The plain command"',
  '  version: 1.0.0',
  'mission:',
  '  summary: "Summary of plain"',
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

describe('OpenCode generator: skill-backed commands', () => {
  let tmp;
  let packagesDir;
  let outputDir;

  /** Write `files`, relative to the fixture package, into the throwaway packages/ directory. */
  function put(files) {
    for (const [relPath, content] of Object.entries(files)) {
      const target = path.join(packagesDir, 'fixture-pkg', relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  const outFile = (...parts) => path.join(outputDir, '.opencode', ...parts);

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-skillbacked-'));
    packagesDir = path.join(tmp, 'packages');
    outputDir = path.join(tmp, 'out');
    fs.mkdirSync(packagesDir, { recursive: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('CommandTranslator', () => {
    const translate = (dryRun = true) =>
      new CommandTranslator({ packagesDir, outputDir: path.join(outputDir, 'commands'), dryRun, verbose: false }).executeSync();

    test('turns a manifest into a thin command that loads the skill, and leaves an ordinary command alone', () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
        'commands/plain.yaml': ORDINARY,
      });
      const { commands, errors, configBlock } = translate();

      expect(errors).toEqual([]);
      const bySlug = Object.fromEntries(commands.map((c) => [path.basename(c.markdownPath, '.md'), c.markdownContent]));
      expect(Object.keys(bySlug).sort()).toEqual(['make-thing', 'plain']);

      expect(bySlug['make-thing']).toBe(
        [
          '# Make Thing',
          '',
          'The make-thing command',
          '',
          'Load the `ensemble-make-thing` skill with the skill tool and follow its instructions exactly.',
          '',
          'The skill names some files by paths relative to its own directory (the files of its `references/` directory, for example). Resolve those paths against the base directory that the skill tool reports for the skill, never against your working directory or the workspace root.',
          '',
          'Wherever the skill refers to its ARGUMENTS, use this value (empty if none were given): $ARGUMENTS',
          '',
        ].join('\n')
      );
      expect(bySlug['make-thing']).not.toMatch(/^## Phase/m);
      // The control: the ordinary command still renders its own phases
      expect(bySlug.plain).toContain('## Phase 1: Do it');
      expect(bySlug.plain).not.toContain('skill tool');
      // and both are registered in the opencode.json command block
      expect(Object.keys(configBlock).sort()).toEqual(['ensemble:make-thing', 'ensemble:plain']);
    });

    test('hands over the arguments under the placeholder every other command uses', () => {
      put({
        'commands/create-prd.yaml': manifest('create-prd', 'ensemble-create-prd'),
        'skills/ensemble-create-prd/SKILL.md': SKILL_SOURCE.replace('ensemble-make-thing', 'ensemble-create-prd'),
      });
      const [{ markdownContent }] = translate().commands;

      expect(markdownContent).toContain('# Create PRD $PRODUCT_DESCRIPTION');
      expect(markdownContent).toContain('use this value (empty if none were given): $PRODUCT_DESCRIPTION');
    });

    test('says what the relative paths of the skill are relative to, in words that OpenCode\'s template expansion leaves alone', () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
      });
      const [{ markdownContent }] = translate().commands;
      const clause = markdownContent.split('\n').find((line) => line.includes('relative to its own directory'));

      expect(clause).toContain('the files of its `references/` directory');
      expect(clause).toContain('Resolve those paths against the base directory that the skill tool reports for the skill');
      expect(clause).toContain('never against your working directory or the workspace root');
      // An OpenCode command template expands $1 and $ARGUMENTS, @file mentions and !`command`: none may appear
      expect(clause).not.toMatch(/[$@]|!`/);
    });

    test('keeps the capabilities a manifest declares', () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing', [
          '  capabilities:',
          '    required: [tracker.show]',
          '    optional: [work-graph.ready]',
        ]),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
      });
      const [{ markdownContent }] = translate().commands;

      expect(markdownContent).toContain('## Capabilities\n\n**Required:** tracker.show\n**Optional:** work-graph.ready\n');
    });

    test('reports, without throwing, a manifest whose skill does not exist, and still translates the others', () => {
      put({ 'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'), 'commands/plain.yaml': ORDINARY });
      const { commands, errors } = translate();

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/make-thing\.yaml: skill-backed command points at skill 'ensemble-make-thing', but .* does not exist/);
      expect(commands.map((c) => path.basename(c.markdownPath))).toEqual(['plain.md']);
    });

    test('still rejects a command that has neither a workflow nor a skill', () => {
      put({ 'commands/broken.yaml': 'metadata:\n  name: ensemble:broken\n  description: x\n  version: 1.0.0\n' });
      const { errors } = translate();

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/Invalid command YAML \(missing metadata or workflow\)/);
    });
  });

  describe('SkillCopier', () => {
    const copy = async (commandSkills, dryRun = false) =>
      new SkillCopier({ packagesDir, outputDir: path.join(outputDir, 'skill'), injectFrontmatter: true, dryRun, verbose: false, commandSkills }).execute();

    test('ships a command skill byte for byte under its own name, beside the framework skills', async () => {
      put({ 'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE });
      fs.mkdirSync(path.join(packagesDir, 'react', 'skills', 'react'), { recursive: true });
      fs.writeFileSync(path.join(packagesDir, 'react', 'skills', 'react', 'SKILL.md'), '---\nname: react\ndescription: React\n---\n\n# React\n');
      const result = await copy([{ name: 'ensemble-make-thing', skillPath: path.join(packagesDir, 'fixture-pkg', 'skills', 'ensemble-make-thing') }]);

      expect(result.errors).toEqual([]);
      expect(result.skillsCopied).toBe(2);
      expect(fs.readFileSync(path.join(outputDir, 'skill', 'ensemble-make-thing', 'SKILL.md'), 'utf-8')).toBe(SKILL_SOURCE);
      expect(fs.readdirSync(path.join(outputDir, 'skill')).sort()).toEqual(['ensemble-make-thing', 'react']);
    });

    test('ships nothing for command skills it is not given: a skills/ directory alone is not a command skill', async () => {
      put({ 'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE });
      const result = await copy(undefined);

      expect(result.skillsCopied).toBe(0);
      expect(fs.existsSync(path.join(outputDir, 'skill'))).toBe(false);
    });

    test('reports a command skill named like a framework skill, and writes neither over the other', async () => {
      put({ 'skills/react/SKILL.md': SKILL_SOURCE.replace('ensemble-make-thing', 'react') });
      fs.mkdirSync(path.join(packagesDir, 'react', 'skills', 'react'), { recursive: true });
      const framework = '---\nname: react\ndescription: The React framework skill\n---\n\n# React\n';
      fs.writeFileSync(path.join(packagesDir, 'react', 'skills', 'react', 'SKILL.md'), framework);
      const result = await copy([{ name: 'react', skillPath: path.join(packagesDir, 'fixture-pkg', 'skills', 'react') }]);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toMatch(/Command skill name collision: "react" is shipped by multiple sources/);
      expect(fs.readFileSync(path.join(outputDir, 'skill', 'react', 'SKILL.md'), 'utf-8')).toBe(framework);
    });

    test('does not prune a command skill that is named adapter-*', async () => {
      put({ 'skills/adapter-thing/SKILL.md': SKILL_SOURCE.replace('ensemble-make-thing', 'adapter-thing') });
      const commandSkills = [{ name: 'adapter-thing', skillPath: path.join(packagesDir, 'fixture-pkg', 'skills', 'adapter-thing') }];
      await copy(commandSkills);
      await copy(commandSkills); // the second run prunes stale adapter-* output: this one is not stale

      expect(fs.existsSync(path.join(outputDir, 'skill', 'adapter-thing', 'SKILL.md'))).toBe(true);
    });

    describe('the references/ directory of a command skill', () => {
      // The skill is named otherwise than its command, so a destination worked out from the command
      // name lands in the wrong directory. REF_A has CRLF line ends, a non-ASCII character and a
      // command reference, so any normalization or re-serialization shows.
      const SKILL = 'renamed-skill';
      const REF_A = '# Phase 1\r\nHand off to /ensemble:next-thing \u2014 caf\u00e9.\r\n';
      const REF_B = '# Nested\n\nDeeper still.\n';
      const SHIPPED = ['SKILL.md', 'references/a.md', 'references/nested/b.md'];
      const SOURCE_FILES = {
        [`skills/${SKILL}/SKILL.md`]: SKILL_SOURCE.replace('ensemble-make-thing', SKILL),
        [`skills/${SKILL}/references/a.md`]: REF_A,
        [`skills/${SKILL}/references/nested/b.md`]: REF_B,
      };
      // Lazy: packagesDir is only known once beforeEach has run
      const commandSkills = () => [{ name: SKILL, skillPath: path.join(packagesDir, 'fixture-pkg', 'skills', SKILL) }];

      /** Every file below `dir`, relative to it, `/`-separated and sorted; none when `dir` is absent. */
      const walk = (dir, prefix = '') =>
        !fs.existsSync(dir)
          ? []
          : fs
              .readdirSync(dir, { withFileTypes: true })
              .flatMap((entry) =>
                entry.isDirectory() ? walk(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]
              )
              .sort();
      const shippedTree = (skill = SKILL) => walk(path.join(outputDir, 'skill', skill));

      test('ships it beside the SKILL.md, each file at its own relative path and byte for byte, and no other file of the skill', async () => {
        put({
          ...SOURCE_FILES,
          // Beside the SKILL.md rather than in references/: authoring material the output leaves out
          [`skills/${SKILL}/notes.txt`]: 'scratch\n',
          [`skills/${SKILL}/README.md`]: '# readme\n',
          [`skills/${SKILL}/scripts/run.js`]: 'process.exit(0);\n',
        });
        const result = await copy(commandSkills());

        expect(result.errors).toEqual([]);
        expect(result.skillsCopied).toBe(1);
        expect(shippedTree()).toEqual(SHIPPED);
        const shipped = (rel) => fs.readFileSync(path.join(outputDir, 'skill', SKILL, rel));
        expect(shipped('references/a.md').equals(Buffer.from(REF_A, 'utf-8'))).toBe(true);
        expect(shipped('references/nested/b.md').equals(Buffer.from(REF_B, 'utf-8'))).toBe(true);
        expect(shipped('SKILL.md').toString('utf-8')).toBe(SOURCE_FILES[`skills/${SKILL}/SKILL.md`]);
      });

      test('leaves out a dotfile of references/: it is one machine\'s leftover, not part of the skill', async () => {
        put({
          ...SOURCE_FILES,
          [`skills/${SKILL}/references/.DS_Store`]: 'finder\n',
          [`skills/${SKILL}/references/.hidden/c.md`]: '# in a hidden directory\n',
        });
        await copy(commandSkills());

        expect(shippedTree()).toEqual(SHIPPED);
      });

      test('gives no references/ to a skill that has none, and none to a framework skill that has one', async () => {
        put({
          ...SOURCE_FILES,
          'skills/bare-skill/SKILL.md': SKILL_SOURCE.replace('ensemble-make-thing', 'bare-skill'),
        });
        fs.mkdirSync(path.join(packagesDir, 'react', 'skills', 'react', 'references'), { recursive: true });
        fs.writeFileSync(path.join(packagesDir, 'react', 'skills', 'react', 'SKILL.md'), '---\nname: react\ndescription: React\n---\n\n# React\n');
        fs.writeFileSync(path.join(packagesDir, 'react', 'skills', 'react', 'references', 'x.md'), '# not shipped: lean\n');
        await copy([...commandSkills(), { name: 'bare-skill', skillPath: path.join(packagesDir, 'fixture-pkg', 'skills', 'bare-skill') }]);

        expect(shippedTree('bare-skill')).toEqual(['SKILL.md']);
        expect(shippedTree('react')).toEqual(['SKILL.md']);
        expect(shippedTree()).toEqual(SHIPPED); // the skill that has them still ships them
      });

      test('replaces the references of an earlier run: one removed from the source does not linger', async () => {
        put(SOURCE_FILES);
        await copy(commandSkills());
        expect(shippedTree()).toEqual(SHIPPED);

        fs.rmSync(path.join(packagesDir, 'fixture-pkg', 'skills', SKILL, 'references', 'nested'), { recursive: true });
        put({ [`skills/${SKILL}/references/c.md`]: '# Added\n' });
        await copy(commandSkills());
        expect(shippedTree()).toEqual(['SKILL.md', 'references/a.md', 'references/c.md']);

        fs.rmSync(path.join(packagesDir, 'fixture-pkg', 'skills', SKILL, 'references'), { recursive: true });
        await copy(commandSkills());
        expect(shippedTree()).toEqual(['SKILL.md']);
      });

      test('a dry run neither writes nor removes any of it', async () => {
        put(SOURCE_FILES);
        await copy(commandSkills(), true);
        expect(fs.existsSync(path.join(outputDir, 'skill'))).toBe(false);

        await copy(commandSkills());
        fs.rmSync(path.join(packagesDir, 'fixture-pkg', 'skills', SKILL, 'references', 'a.md'));
        await copy(commandSkills(), true);
        expect(shippedTree()).toEqual(SHIPPED); // the earlier run's file is still there
      });
    });
  });

  describe('discovery', () => {
    test('finds the skill each manifest names, once, and no skill that no manifest names', () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'commands/make-thing-alias.yaml': manifest('make-thing-alias', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
        'skills/unclaimed/SKILL.md': '---\nname: unclaimed\ndescription: x\n---\n',
        'commands/plain.yaml': ORDINARY,
      });

      expect(discoverCommandSkills(packagesDir)).toEqual([
        { name: 'ensemble-make-thing', skillPath: path.join(packagesDir, 'fixture-pkg', 'skills', 'ensemble-make-thing') },
      ]);
    });

    test('puts the command skills among the sources the incremental cache hashes', () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
      });

      expect(discoverSkillSourceFiles(packagesDir)).toContain(
        path.join(packagesDir, 'fixture-pkg', 'skills', 'ensemble-make-thing', 'SKILL.md')
      );
    });

    test('puts every file of a command skill\'s references/ among them too, so editing one invalidates the cache', () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
        'skills/ensemble-make-thing/references/a.md': 'a\n',
        'skills/ensemble-make-thing/references/nested/b.md': 'b\n',
        'skills/ensemble-make-thing/notes.txt': 'not a source of the output\n',
      });
      const skillDir = path.join(packagesDir, 'fixture-pkg', 'skills', 'ensemble-make-thing');
      const files = discoverSkillSourceFiles(packagesDir);

      expect(files).toContain(path.join(skillDir, 'references', 'a.md'));
      expect(files).toContain(path.join(skillDir, 'references', 'nested', 'b.md'));
      expect(files).not.toContain(path.join(skillDir, 'notes.txt'));
    });

    test('throws naming the manifest when its skill is missing or not a skill name', () => {
      put({ 'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing') });
      expect(() => discoverCommandSkills(packagesDir)).toThrow(/make-thing\.yaml: skill-backed command points at skill/);

      put({ 'commands/make-thing.yaml': manifest('make-thing', '../elsewhere') });
      expect(() => discoverCommandSkills(packagesDir)).toThrow(/make-thing\.yaml: skill "\.\.\/elsewhere" is not a valid skill directory name/);
    });
  });

  describe('the whole pipeline', () => {
    const run = async (force = true) => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      return runPipeline({ dryRun: false, verbose: false, validate: false, outputDir, force, packagesDir });
    };

    test('emits the thin command and the one source skill, with no error, beside an ordinary command', async () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
        'commands/plain.yaml': ORDINARY,
      });
      const { errors } = await run();

      expect(errors).toEqual([]);
      expect(fs.readFileSync(outFile('commands', 'ensemble', 'make-thing.md'), 'utf-8')).toContain('Load the `ensemble-make-thing` skill');
      expect(fs.readFileSync(outFile('commands', 'ensemble', 'plain.md'), 'utf-8')).toContain('## Phase 1: Do it');
      // One skill for the command, the source skill itself
      expect(fs.readdirSync(outFile('skill')).filter((n) => n.includes('make-thing'))).toEqual(['ensemble-make-thing']);
      expect(fs.readFileSync(outFile('skill', 'ensemble-make-thing', 'SKILL.md'), 'utf-8')).toBe(SKILL_SOURCE);
      expect(Object.keys(JSON.parse(fs.readFileSync(path.join(outputDir, 'opencode.json'), 'utf-8')).command).sort()).toEqual([
        'ensemble:make-thing',
        'ensemble:plain',
      ]);
    });

    test('ships the references of the skill a manifest names, beside the SKILL.md the command loads', async () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
        'skills/ensemble-make-thing/references/phase-1-first.md': '# Phase 1\r\nverbatim\r\n',
        'commands/plain.yaml': ORDINARY,
      });
      const { errors } = await run();

      expect(errors).toEqual([]);
      expect(fs.readFileSync(outFile('skill', 'ensemble-make-thing', 'SKILL.md'), 'utf-8')).toBe(SKILL_SOURCE);
      expect(fs.readFileSync(outFile('skill', 'ensemble-make-thing', 'references', 'phase-1-first.md'), 'utf-8')).toBe('# Phase 1\r\nverbatim\r\n');
    });

    test('an edited, added or removed reference reaches the output of the next incremental run', async () => {
      put({
        'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'),
        'skills/ensemble-make-thing/SKILL.md': SKILL_SOURCE,
        'skills/ensemble-make-thing/references/a.md': 'one\n',
        'skills/ensemble-make-thing/references/b.md': 'to be removed\n',
      });
      const refs = path.join(packagesDir, 'fixture-pkg', 'skills', 'ensemble-make-thing', 'references');
      const shippedRefs = () => fs.readdirSync(outFile('skill', 'ensemble-make-thing', 'references')).sort();
      await run(false);
      expect(shippedRefs()).toEqual(['a.md', 'b.md']);

      fs.writeFileSync(path.join(refs, 'a.md'), 'two\n');
      fs.writeFileSync(path.join(refs, 'c.md'), 'added\n');
      fs.rmSync(path.join(refs, 'b.md'));
      await run(false); // not forced: only a changed source set makes the SkillCopier run again

      expect(fs.readFileSync(outFile('skill', 'ensemble-make-thing', 'references', 'a.md'), 'utf-8')).toBe('two\n');
      expect(shippedRefs()).toEqual(['a.md', 'c.md']);
    });

    test('fails the run, loudly, for a manifest whose skill is missing, instead of shipping a command that loads nothing', async () => {
      put({ 'commands/make-thing.yaml': manifest('make-thing', 'ensemble-make-thing'), 'commands/plain.yaml': ORDINARY });
      const { errors } = await run();

      expect(errors.map((e) => e.step).sort()).toEqual(['CommandTranslator', 'SkillCopier']);
      expect(fs.existsSync(outFile('commands', 'ensemble', 'make-thing.md'))).toBe(false);
      expect(fs.existsSync(outFile('commands', 'ensemble', 'plain.md'))).toBe(true);
    });
  });
});
