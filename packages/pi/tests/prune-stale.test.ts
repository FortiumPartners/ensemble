/**
 * Pruning stale generated output.
 *
 * Every phase of the surface consolidation needed manual orphan cleanup, because the generator
 * only ever added files: the mirror of a removed or renamed command, agent or skill stayed
 * behind. The generator now removes the generated files a run did not reproduce, and only those:
 * a file must carry the generator's proof of authorship (generated-marker.ts, or a command
 * wrapper's own marker), so a hand-authored file in the same directory is never touched.
 *
 * Everything runs on throwaway source and output roots. Every case that expects a removal also
 * checks the neighbour that must survive, so a generator that prunes nothing, or everything,
 * fails.
 */

jest.setTimeout(60_000);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ArtifactKind,
  generate,
  generateAll,
  listGeneratedFiles,
  pruneStaleArtifacts,
} from '../src/generator';
import { generatedMarker, withGeneratedMarker } from '../src/generated-marker';
import { SELF_CONTAINED_PI_PACKAGES } from '../src/self-contained-packages';
import { GeneratorOptions } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function commandYaml(name: string, visibility = ''): string {
  return [
    'metadata:',
    `  name: "ensemble:${name}"`,
    `  description: "The ${name} command"`,
    '  version: "1.0.0"',
    ...(visibility ? [`  visibility: ${visibility}`] : []),
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
}

function agentYaml(name: string): string {
  return [
    `name: ${name}`,
    `description: "The ${name} agent"`,
    'tools:',
    '  - Read',
    'mission:',
    `  summary: "Summary of ${name}"`,
    '',
  ].join('\n');
}

function skillMd(name: string): string {
  return ['---', `name: ${name}`, `description: "The ${name} skill"`, '---', '', `# ${name}`, '', 'Body. See REFERENCE.md.', ''].join('\n');
}

/** Every file under `dir` as a sorted list of paths relative to it, with forward slashes. */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name)).map((file) => `${entry.name}/${file}`)
        : [entry.name]
    )
    .sort();
}

/** Every file under `dir` with its content, to prove a run changed nothing. */
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(walk(dir).map((file) => [file, fs.readFileSync(path.join(dir, file), 'utf-8')]));
}

// ---------------------------------------------------------------------------
// ensemble-pi output root
// ---------------------------------------------------------------------------

describe('Pi generator: pruning stale generated output', () => {
  let src: string;
  let out: string;

  const options = (overrides: Partial<GeneratorOptions> = {}): GeneratorOptions => ({
    dryRun: false,
    verbose: false,
    validate: false,
    sourceRoot: src,
    outputRoot: out,
    ...overrides,
  });
  const gen = (overrides: Partial<GeneratorOptions> = {}) => generate(options(overrides));

  const source = (file: string, content: string): void => {
    const target = path.join(src, 'packages', 'fake', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  };
  const removeSource = (file: string): void =>
    fs.rmSync(path.join(src, 'packages', 'fake', file), { recursive: true, force: true });
  const addCommand = (name: string, visibility = ''): void =>
    source(`commands/${name}.yaml`, commandYaml(name, visibility));
  const addAgent = (name: string): void => source(`agents/${name}.yaml`, agentYaml(name));
  const addSkill = (name: string): void => {
    source(`skills/${name}/SKILL.md`, skillMd(name));
    source(`skills/${name}/REFERENCE.md`, `# ${name} reference\n`);
  };

  /** Hand-authored (or otherwise unproven) file in the output root. */
  const hand = (file: string, content: string): void => {
    const target = path.join(out, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  };
  const exists = (file: string): boolean => fs.existsSync(path.join(out, file));
  const read = (file: string): string => fs.readFileSync(path.join(out, file), 'utf-8');
  /** Output-root-relative, forward-slash form of a list of absolute paths. */
  const relative = (files: string[]): string[] =>
    files.map((file) => path.relative(out, file).split(path.sep).join('/'));

  beforeEach(() => {
    // The fixture has no packages/development/lib, so lib-bundler warns about every vendored file
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    src = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-prune-src-'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-prune-out-'));
    fs.writeFileSync(path.join(src, 'CLAUDE.md'), '## Agent Mesh\n\nContent.\n', 'utf-8');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  });

  /**
   * A source tree with a keeper and a casualty of every kind. Generating it, then deleting the
   * casualties' sources, leaves exactly the six mirrors in STALE behind.
   */
  function populate(): void {
    addCommand('keep');
    addCommand('keep-hidden', 'hidden');
    addCommand('gone');
    addCommand('gone-hidden', 'hidden');
    addAgent('keep-agent');
    addAgent('gone-agent');
    addSkill('keep-skill');
    addSkill('gone-skill');
  }
  function removeCasualties(): void {
    removeSource('commands/gone.yaml');
    removeSource('commands/gone-hidden.yaml');
    removeSource('agents/gone-agent.yaml');
    removeSource('skills/gone-skill');
  }
  const STALE = [
    'agents/gone-agent.md',
    'prompts/_hidden/ensemble-gone-hidden.md',
    'prompts/ensemble-gone.md',
    'skills/ensemble-gone/SKILL.md',
    'skills/gone-skill/REFERENCE.md',
    'skills/gone-skill/SKILL.md',
  ];
  const KEPT = [
    'agents/keep-agent.md',
    'prompts/_hidden/ensemble-keep-hidden.md',
    'prompts/ensemble-keep.md',
    'skills/ensemble-keep/SKILL.md',
    'skills/keep-skill/REFERENCE.md',
    'skills/keep-skill/SKILL.md',
  ];

  it('is a precondition that the first run writes both the casualties and the keepers', async () => {
    populate();
    const result = await gen();
    expect(result.pruned).toEqual([]);
    for (const file of [...STALE, ...KEPT]) expect(exists(file)).toBe(true);
  });

  describe('a removed source loses its mirror, whatever the kind', () => {
    it('prunes the prompt, hidden prompt, wrapper skill, agent and copied skill, and keeps the rest', async () => {
      populate();
      await gen();
      removeCasualties();

      const result = await gen();

      expect(relative(result.pruned)).toEqual(STALE);
      expect(result.pruned.every((file) => path.isAbsolute(file))).toBe(true);
      for (const file of STALE) expect(exists(file)).toBe(false);
      for (const file of KEPT) expect(exists(file)).toBe(true);
      // The directory of the pruned skill went with its files
      expect(exists('skills/gone-skill')).toBe(false);
      expect(exists('skills/ensemble-gone')).toBe(false);
    });

    it('prunes the old names and writes the new ones when sources are renamed', async () => {
      addCommand('before');
      addAgent('before-agent');
      addSkill('before-skill');
      addCommand('anchor'); // something that stays, so no kind is ever left empty
      addAgent('anchor-agent');
      addSkill('anchor-skill');
      await gen();

      removeSource('commands/before.yaml');
      removeSource('agents/before-agent.yaml');
      removeSource('skills/before-skill');
      addCommand('after');
      addAgent('after-agent');
      addSkill('after-skill');
      const result = await gen();

      expect(relative(result.pruned)).toEqual([
        'agents/before-agent.md',
        'prompts/ensemble-before.md',
        'skills/before-skill/REFERENCE.md',
        'skills/before-skill/SKILL.md',
        'skills/ensemble-before/SKILL.md',
      ]);
      for (const file of [
        'agents/after-agent.md',
        'prompts/ensemble-after.md',
        'skills/ensemble-after/SKILL.md',
        'skills/after-skill/SKILL.md',
        'skills/after-skill/REFERENCE.md',
        'agents/anchor-agent.md',
        'prompts/ensemble-anchor.md',
        'skills/anchor-skill/SKILL.md',
      ]) {
        expect(exists(file)).toBe(true);
      }
    });

    it('removes prompts/_hidden/ once its last prompt is pruned, and never the prompts/ or skills/ roots', async () => {
      addCommand('only', 'hidden');
      addCommand('visible');
      await gen();
      removeSource('commands/only.yaml');
      removeSource('commands/visible.yaml');
      addCommand('visible-now-hidden', 'hidden');

      await gen();

      expect(exists('prompts/_hidden/ensemble-visible-now-hidden.md')).toBe(true);
      expect(exists('prompts/_hidden/ensemble-only.md')).toBe(false);
      expect(exists('prompts/ensemble-visible.md')).toBe(false);
      // Every wrapper is gone, so skills/ is empty, and it is still there
      expect(fs.existsSync(path.join(out, 'skills'))).toBe(true);
      expect(fs.readdirSync(path.join(out, 'skills'))).toEqual([]);

      removeSource('commands/visible-now-hidden.yaml');
      addCommand('later');
      await gen();
      expect(exists('prompts/_hidden')).toBe(false); // emptied, so removed
      expect(fs.existsSync(path.join(out, 'prompts'))).toBe(true);
    });
  });

  describe('a hand-authored file is never pruned', () => {
    /** Files a person could plausibly keep in the output directories, none carrying a proof. */
    const HAND: Record<string, string> = {
      'prompts/ensemble-hand.md': '# ensemble-hand\n\nWritten by hand.\n',
      'prompts/_hidden/ensemble-hand-hidden.md': '# ensemble-hand-hidden\n',
      'agents/hand.md': '---\nname: "hand"\ndescription: "hand"\ntools: ["Read"]\n---\n\n# hand\n',
      'agents/.gitkeep': '',
      'skills/.gitkeep': '',
      'skills/hand-skill/SKILL.md': '---\nname: hand-skill\ndescription: hand\n---\n\n# hand-skill\n',
      'skills/hand-skill/REFERENCE.md': '# hand reference\n',
      // The wrapper flag and a wrapper-shaped name, but not generated from any command
      'skills/ensemble-hand-wrapper/SKILL.md':
        '---\nname: ensemble-hand-wrapper\ndescription: hand\ndisable-model-invocation: true\n---\n\n# ensemble-hand-wrapper\n',
      // Shares a pruned skill's directory
      'skills/gone-skill/NOTES.md': '# notes kept next to a generated skill\n',
      // In a subdirectory the generator does not look into (only references/ is), even though it carries a marker
      'skills/gone-skill/examples/sample.md': withGeneratedMarker('# example\n', 'by-hand'),
      'prompts/notes/ensemble-nested.md': withGeneratedMarker('# nested\n', 'by-hand'),
    };

    it('prunes the stale mirrors beside hand-authored files in the same directories and leaves those files byte for byte', async () => {
      populate();
      await gen();
      for (const [file, content] of Object.entries(HAND)) hand(file, content);
      removeCasualties();

      const result = await gen();

      // The stale files went (this is what fails a generator that prunes nothing) ...
      expect(relative(result.pruned)).toEqual(STALE);
      for (const file of STALE) expect(exists(file)).toBe(false);
      // ... and every hand-authored neighbour is intact
      for (const [file, content] of Object.entries(HAND)) {
        expect(read(file)).toBe(content);
      }
      // The directory of a pruned skill stays while it holds a file the generator never wrote
      expect(exists('skills/gone-skill')).toBe(true);
      expect(fs.readdirSync(path.join(out, 'skills', 'gone-skill')).sort()).toEqual(['NOTES.md', 'examples']);
    });

    it('does not take a wrapper-shaped skill for generated unless its body is the command wrapper', async () => {
      addCommand('keep');
      await gen();
      const wrapper = read('skills/ensemble-keep/SKILL.md');
      // Same file with the prompt-derived Command line removed: only the flag and the name are left
      const lookalike = wrapper.replace(/^<!-- Command: .*-->\n/m, '');
      expect(lookalike).not.toBe(wrapper);
      hand('skills/ensemble-lookalike/SKILL.md', lookalike.replace(/name: ensemble-keep/, 'name: ensemble-lookalike'));
      removeSource('commands/keep.yaml');
      addCommand('other');

      const result = await gen();

      expect(relative(result.pruned)).toEqual(['prompts/ensemble-keep.md', 'skills/ensemble-keep/SKILL.md']);
      expect(exists('skills/ensemble-lookalike/SKILL.md')).toBe(true);
    });

    it('keeps the wrapper of a hand-authored prompt after the prompt is deleted: nothing proves the generator wrote it', async () => {
      addCommand('keep');
      hand('prompts/ensemble-notes.md', '# ensemble-notes\n\nWritten by hand.\n');
      await gen();
      expect(exists('skills/ensemble-notes/SKILL.md')).toBe(true); // wrapped like every prompt in the directory
      fs.rmSync(path.join(out, 'prompts', 'ensemble-notes.md'));

      const result = await gen();

      expect(result.pruned).toEqual([]);
      expect(exists('skills/ensemble-notes/SKILL.md')).toBe(true);
    });

    it('cannot be tricked by a marker or flag that is not where the generator puts it', async () => {
      addCommand('keep');
      addAgent('real-agent'); // every kind has a source, so every kind is scanned
      addSkill('real-skill');
      await gen();
      const quoted = `# Notes\n\nThe generator stamps files with:\n\n${generatedMarker('x.yaml')}\n`;
      hand('prompts/quoted-prompt.md', quoted);
      hand('agents/quoted-marker.md', `---\nname: q\n---\n\n${quoted}`);
      hand('skills/quoted-marker/SKILL.md', `---\nname: quoted-marker\n---\n\n${quoted}`);
      // Wrapper-shaped directory whose frontmatter does not even parse
      hand('skills/ensemble-broken/SKILL.md', '---\nname: [unclosed\ndisable-model-invocation: true\n---\n\n# x\n');
      addCommand('other');
      removeSource('commands/keep.yaml');

      const result = await gen();

      // The scan ran (it pruned the real casualties) and passed over every impostor
      expect(relative(result.pruned)).toEqual(['prompts/ensemble-keep.md', 'skills/ensemble-keep/SKILL.md']);
      expect(read('prompts/quoted-prompt.md')).toBe(quoted);
      expect(read('agents/quoted-marker.md')).toContain(quoted);
      expect(read('skills/quoted-marker/SKILL.md')).toContain(quoted);
      expect(exists('skills/ensemble-broken/SKILL.md')).toBe(true);
    });

    it('never follows a symlink out of the output directories', async () => {
      addCommand('keep');
      addAgent('real-agent');
      addSkill('real-skill');
      await gen();
      const outside = path.join(src, 'outside');
      fs.mkdirSync(outside);
      const marked = withGeneratedMarker('# outside\n', 'x');
      fs.writeFileSync(path.join(outside, 'target.md'), marked, 'utf-8');
      fs.writeFileSync(path.join(outside, 'SKILL.md'), marked, 'utf-8');
      fs.symlinkSync(path.join(outside, 'target.md'), path.join(out, 'prompts', 'ensemble-link.md'));
      fs.symlinkSync(path.join(outside, 'target.md'), path.join(out, 'agents', 'link.md'));
      fs.symlinkSync(outside, path.join(out, 'skills', 'linked-skill')); // a symlinked directory
      addCommand('other');
      removeSource('commands/keep.yaml');

      const result = await gen();

      expect(relative(result.pruned)).toEqual(['prompts/ensemble-keep.md', 'skills/ensemble-keep/SKILL.md']);
      for (const link of ['prompts/ensemble-link.md', 'agents/link.md', 'skills/linked-skill']) {
        expect(fs.lstatSync(path.join(out, link)).isSymbolicLink()).toBe(true);
      }
      expect(fs.readFileSync(path.join(outside, 'target.md'), 'utf-8')).toBe(marked);
      expect(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf-8')).toBe(marked);
    });

    it('leaves marked files outside prompts/, agents/ and skills/ alone', async () => {
      populate();
      await gen();
      hand('extra/notes.md', withGeneratedMarker('# notes\n', 'x'));
      hand('vendor/lib/note.md', withGeneratedMarker('# vendored\n', 'x'));
      removeCasualties();

      await gen();

      expect(exists('extra/notes.md')).toBe(true);
      expect(exists('vendor/lib/note.md')).toBe(true);
      expect(exists('AGENTS.md')).toBe(true);
    });
  });

  describe('a dry run removes nothing and reports what a real run would remove', () => {
    it('lists the stale files, including the wrapper of a stale prompt, and leaves the tree untouched', async () => {
      populate();
      await gen();
      hand('skills/hand-skill/SKILL.md', skillMd('hand-skill'));
      removeCasualties();
      const before = snapshot(out);

      const dry = await gen({ dryRun: true });

      expect(relative(dry.pruned)).toEqual(STALE);
      expect(snapshot(out)).toEqual(before);

      const real = await gen();
      expect(real.pruned).toEqual(dry.pruned);
      for (const file of STALE) expect(exists(file)).toBe(false);
      expect(exists('skills/hand-skill/SKILL.md')).toBe(true);
    });

    it('reports nothing for an output root with nothing stale', async () => {
      populate();
      await gen();
      const before = snapshot(out);
      const dry = await gen({ dryRun: true });
      expect(dry.pruned).toEqual([]);
      expect(snapshot(out)).toEqual(before);
    });

    it('does not report the wrapper of a prompt that is missing from disk but about to be written', async () => {
      populate();
      await gen();
      fs.rmSync(path.join(out, 'prompts', 'ensemble-keep.md')); // deleted by hand; the command lives on

      const dry = await gen({ dryRun: true });
      expect(dry.pruned).toEqual([]);
      expect(exists('skills/ensemble-keep/SKILL.md')).toBe(true);

      const real = await gen();
      expect(real.pruned).toEqual([]);
      expect(exists('prompts/ensemble-keep.md')).toBe(true);
      expect(exists('skills/ensemble-keep/SKILL.md')).toBe(true);
    });
  });

  describe('a command that changes visibility keeps exactly one copy of its prompt', () => {
    const promptCopies = (): string[] =>
      walk(path.join(out, 'prompts')).filter((file) => file.endsWith('ensemble-flip.md'));

    it('visible to hidden to visible, reporting each superseded file', async () => {
      addCommand('flip');
      addCommand('anchor');
      await gen();
      expect(promptCopies()).toEqual(['ensemble-flip.md']);
      expect(exists('skills/ensemble-flip/SKILL.md')).toBe(true);

      addCommand('flip', 'hidden');
      const toHidden = await gen();
      expect(relative(toHidden.pruned)).toEqual(['prompts/ensemble-flip.md', 'skills/ensemble-flip/SKILL.md']);
      expect(promptCopies()).toEqual(['_hidden/ensemble-flip.md']);
      expect(exists('skills/ensemble-flip')).toBe(false);

      addCommand('flip');
      const toVisible = await gen();
      expect(relative(toVisible.pruned)).toEqual(['prompts/_hidden/ensemble-flip.md']);
      expect(promptCopies()).toEqual(['ensemble-flip.md']);
      expect(exists('skills/ensemble-flip/SKILL.md')).toBe(true);
      expect(exists('prompts/_hidden')).toBe(false);
    });

    it('also in a dry run: the visible copy and its wrapper are reported, not removed', async () => {
      addCommand('flip');
      addCommand('anchor');
      await gen();
      addCommand('flip', 'hidden');

      const dry = await gen({ dryRun: true });

      expect(relative(dry.pruned)).toEqual(['prompts/ensemble-flip.md', 'skills/ensemble-flip/SKILL.md']);
      expect(promptCopies()).toEqual(['ensemble-flip.md']);
      expect(exists('skills/ensemble-flip/SKILL.md')).toBe(true);
    });
  });

  describe('a second run is idempotent', () => {
    it('prunes nothing and rewrites every file identically', async () => {
      populate();
      await gen();
      hand('skills/hand-skill/SKILL.md', skillMd('hand-skill'));
      removeCasualties();
      await gen();
      const settled = snapshot(out);

      const again = await gen();
      const thrice = await gen();

      expect(again.pruned).toEqual([]);
      expect(thrice.pruned).toEqual([]);
      expect(snapshot(out)).toEqual(settled);
    });

    it('converges in one run: no stale wrapper survives to be pruned by the next run', async () => {
      populate();
      await gen();
      removeCasualties();
      await gen();
      // A wrapper whose prompt was pruned in the same run would be regenerated and outlive it
      expect(exists('skills/ensemble-gone/SKILL.md')).toBe(false);
      expect((await gen()).pruned).toEqual([]);
    });
  });

  describe('the references/ directory of a copied skill is pruned with its skill', () => {
    /** A skill whose SKILL.md names a file of references/ and one a level deeper. */
    const addReferencedSkill = (name: string, names = ['references/a.md', 'references/deep/b.md']): void => {
      source(`skills/${name}/SKILL.md`, `${skillMd(name)}\nSee ${names.map((file) => `\`${file}\``).join(' and ')}.\n`);
      source(`skills/${name}/references/a.md`, '# a\n');
      source(`skills/${name}/references/deep/b.md`, '# b\n');
    };

    it('writes the references with the marker, so every file of the skill is provably the generator\'s', async () => {
      addReferencedSkill('ref-skill');
      addSkill('anchor-skill');
      await gen();

      expect(walk(path.join(out, 'skills', 'ref-skill'))).toEqual(['SKILL.md', 'references/a.md', 'references/deep/b.md']);
      expect(relative(listGeneratedFiles(out, 'skill')).sort()).toEqual([
        'skills/anchor-skill/REFERENCE.md',
        'skills/anchor-skill/SKILL.md',
        'skills/ref-skill/SKILL.md',
        'skills/ref-skill/references/a.md',
        'skills/ref-skill/references/deep/b.md',
      ]);
    });

    it('prunes the references of a removed skill, nested ones included, and every directory this empties', async () => {
      addReferencedSkill('gone-skill');
      addSkill('anchor-skill');
      await gen();

      removeSource('skills/gone-skill');
      const result = await gen();

      expect(relative(result.pruned)).toEqual([
        'skills/gone-skill/SKILL.md',
        'skills/gone-skill/references/a.md',
        'skills/gone-skill/references/deep/b.md',
      ]);
      expect(exists('skills/gone-skill')).toBe(false);
      expect(exists('skills/anchor-skill/SKILL.md')).toBe(true);
    });

    it('prunes a nested reference its SKILL.md stops naming, with the directory it empties, and keeps its siblings', async () => {
      addReferencedSkill('ref-skill');
      addSkill('anchor-skill');
      await gen();

      addReferencedSkill('ref-skill', ['references/a.md']);
      const result = await gen();

      expect(relative(result.pruned)).toEqual(['skills/ref-skill/references/deep/b.md']);
      expect(exists('skills/ref-skill/references/deep')).toBe(false);
      expect(exists('skills/ref-skill/references/a.md')).toBe(true);
      expect(exists('skills/ref-skill/SKILL.md')).toBe(true);
    });

    it('leaves a hand-authored file of references/ alone, and the directories that hold it', async () => {
      addReferencedSkill('gone-skill');
      addSkill('anchor-skill');
      await gen();
      hand('skills/gone-skill/references/mine.md', '# my own notes, no marker\n');
      hand('skills/gone-skill/references/deep/mine.md', '# nested notes, no marker\n');

      removeSource('skills/gone-skill');
      const result = await gen();

      expect(relative(result.pruned)).toEqual([
        'skills/gone-skill/SKILL.md',
        'skills/gone-skill/references/a.md',
        'skills/gone-skill/references/deep/b.md',
      ]);
      expect(walk(path.join(out, 'skills', 'gone-skill'))).toEqual(['references/deep/mine.md', 'references/mine.md']);
    });

    it('never follows a references/ that is a symlink, to a directory outside the output', async () => {
      addSkill('anchor-skill');
      await gen();
      const outside = path.join(src, 'outside');
      fs.mkdirSync(outside);
      const marked = withGeneratedMarker('# outside\n', 'x');
      fs.writeFileSync(path.join(outside, 'target.md'), marked, 'utf-8');
      hand('skills/linked-skill/SKILL.md', withGeneratedMarker('# stale skill\n', 'x'));
      fs.symlinkSync(outside, path.join(out, 'skills', 'linked-skill', 'references'));

      const result = await gen();

      expect(relative(result.pruned)).toEqual(['skills/linked-skill/SKILL.md']); // the scan ran, and stopped at the link
      expect(fs.lstatSync(path.join(out, 'skills', 'linked-skill', 'references')).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(path.join(outside, 'target.md'), 'utf-8')).toBe(marked);
    });

    it('never removes the skills/ root when the last references/ file of the last skill goes', () => {
      const mark = (file: string): void => hand(file, withGeneratedMarker('# generated\n', 'gone.yaml'));
      mark('skills/only/SKILL.md');
      mark('skills/only/references/a.md');

      const pruned = pruneStaleArtifacts(out, new Set(), ['skill'], { dryRun: false, verbose: false });

      expect(relative(pruned)).toEqual(['skills/only/SKILL.md', 'skills/only/references/a.md']);
      expect(fs.readdirSync(path.join(out, 'skills'))).toEqual([]);
    });
  });

  describe('safety nets', () => {
    it('prunes nothing of a kind whose sources were not discovered at all', async () => {
      populate();
      await gen();
      const before = snapshot(out);
      // A wrong sourceRoot, a broken glob: no command, agent or skill is found
      for (const file of ['commands/keep.yaml', 'commands/keep-hidden.yaml', 'commands/gone.yaml', 'commands/gone-hidden.yaml']) {
        removeSource(file);
      }
      for (const dir of ['agents', 'skills']) removeSource(dir);

      const result = await gen();

      expect(result.pruned).toEqual([]);
      expect(snapshot(out)).toEqual(before);
    });

    it('leaves a wrapper whose prompt is gone alone when no command sources were discovered', async () => {
      populate();
      await gen();
      fs.rmSync(path.join(out, 'prompts', 'ensemble-gone.md')); // the wrapper is now an orphan on disk
      for (const file of ['keep', 'keep-hidden', 'gone', 'gone-hidden']) removeSource(`commands/${file}.yaml`);

      const result = await gen();

      expect(result.pruned).toEqual([]);
      expect(exists('skills/ensemble-gone/SKILL.md')).toBe(true);
    });

    it('still prunes the kinds that were discovered when another kind found nothing', async () => {
      populate();
      await gen();
      removeSource('agents'); // no agent sources at all: agent mirrors are left, nothing else is
      removeSource('commands/gone.yaml');

      const result = await gen();

      expect(relative(result.pruned)).toEqual(['prompts/ensemble-gone.md', 'skills/ensemble-gone/SKILL.md']);
      expect(exists('agents/gone-agent.md')).toBe(true);
      expect(exists('agents/keep-agent.md')).toBe(true);
    });

    it('never deletes the file it just wrote when a stale name differs from the new one only in case', async () => {
      // On a case-insensitive filesystem agents/Foo.md and agents/foo.md are one file, and the
      // run writes it under the existing name; on a case-sensitive one they are two. Either way
      // the file for the agent that is still produced must exist afterwards, freshly written.
      hand('agents/Foo.md', withGeneratedMarker('---\nname: "foo"\ndescription: "old"\n---\n\n# old\n', 'foo.yaml'));
      addAgent('foo');
      addCommand('anchor');

      const result = await gen();

      expect(result.pruned).toEqual([]);
      expect(read('agents/foo.md')).toContain('The foo agent');
    });

    it('never removes the prompts/, agents/ or skills/ roots, even when pruning empties one', () => {
      const mark = (file: string): void => hand(file, withGeneratedMarker('# generated\n', 'gone.yaml'));
      mark('prompts/ensemble-only.md');
      mark('agents/only.md');
      mark('skills/only/SKILL.md');
      mark('skills/only/REFERENCE.md');

      const pruned = pruneStaleArtifacts(out, new Set(), ['prompt', 'agent', 'skill'], { dryRun: false, verbose: false });

      expect(relative(pruned)).toEqual([
        'agents/only.md',
        'prompts/ensemble-only.md',
        'skills/only/REFERENCE.md',
        'skills/only/SKILL.md',
      ]);
      for (const root of ['prompts', 'agents', 'skills']) {
        expect(fs.readdirSync(path.join(out, root))).toEqual([]);
      }
    });
  });

  describe('logging', () => {
    const written = (spy: jest.SpyInstance): string => spy.mock.calls.map((call) => String(call[0])).join('');

    it('lists every pruned path in verbose mode, and says so on a dry run', async () => {
      populate();
      await gen();
      removeCasualties();

      const dryLog = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await gen({ dryRun: true, verbose: true });
      const dry = written(dryLog);
      dryLog.mockRestore();
      for (const file of STALE) expect(dry).toContain(`  prune (dry-run): ${path.join(out, file)}\n`);
      expect(dry).toMatch(/prune \(prompt, agent, skill\): 5 stale file\(s\) would be removed \(dry-run\)\./);
      expect(dry).toMatch(/prune \(wrapper\): 1 stale file\(s\) would be removed \(dry-run\)\./);

      const realLog = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await gen({ verbose: true });
      const real = written(realLog);
      realLog.mockRestore();
      for (const file of STALE) expect(real).toContain(`  prune: ${path.join(out, file)}\n`);
      expect(real).not.toContain('(dry-run)');
    });

    it('says nothing about pruning without --verbose', async () => {
      populate();
      await gen();
      removeCasualties();
      const log = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await gen();
      expect(log).not.toHaveBeenCalled();
    });

    it('explains in verbose mode why a kind was not pruned', async () => {
      populate();
      await gen();
      removeSource('agents');
      const log = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      await gen({ verbose: true });
      expect(written(log)).toContain('prune: no agent sources discovered, leaving generated agents alone');
    });
  });

  describe('--validate', () => {
    it('validates and prunes in the same run', async () => {
      populate();
      await gen();
      removeCasualties();
      const result = await gen({ validate: true });
      expect(relative(result.pruned)).toEqual(STALE);
    });
  });

  describe('every file the generator writes is provably its own', () => {
    it('lists exactly the generated prompts, agents, copied skills and wrappers, and none of the hand-authored files', async () => {
      populate();
      await gen();
      hand('skills/hand-skill/SKILL.md', skillMd('hand-skill'));
      hand('agents/hand.md', '---\nname: "hand"\n---\n\n# hand\n');

      const kinds: ArtifactKind[] = ['prompt', 'agent', 'skill', 'wrapper'];
      const proven = relative(kinds.flatMap((kind) => listGeneratedFiles(out, kind))).sort();

      // The two hand-authored files are the only ones not proven; everything the run wrote is
      const everything = walk(out).filter((file) => /^(prompts|agents|skills)\//.test(file));
      const unproven = everything.filter((file) => !proven.includes(file));
      expect(unproven.sort()).toEqual(['agents/hand.md', 'skills/hand-skill/SKILL.md']);
      expect(proven.length).toBeGreaterThan(10);
    });

    it('pruneStaleArtifacts only considers the kinds it is asked about', async () => {
      populate();
      await gen();
      removeCasualties();
      const none = pruneStaleArtifacts(out, new Set(), [], { dryRun: true, verbose: false });
      expect(none).toEqual([]);
      const agentsOnly = pruneStaleArtifacts(out, new Set(), ['agent'], { dryRun: true, verbose: false });
      // Nothing produced here means every proven agent is stale: the two of them, and no prompt
      expect(relative(agentsOnly)).toEqual(['agents/gone-agent.md', 'agents/keep-agent.md']);
    });
  });
});

// ---------------------------------------------------------------------------
// Self-contained package roots
// ---------------------------------------------------------------------------

describe('Pi generator: pruning in a self-contained package root', () => {
  const PKG = 'assessment'; // a member of SELF_CONTAINED_PI_PACKAGES
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
  const put = (file: string, content: string): void => {
    const target = path.join(src, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  };
  const exists = (file: string): boolean => fs.existsSync(path.join(src, file));
  const relative = (files: string[]): string[] =>
    files.map((file) => path.relative(src, file).split(path.sep).join('/'));

  beforeEach(() => {
    // The fixture has no packages/development/lib, so lib-bundler warns about every vendored file
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    src = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-prune-selfc-'));
    piRoot = path.join(src, 'packages', 'pi');
    fs.writeFileSync(path.join(src, 'CLAUDE.md'), '## Agent Mesh\n\nContent.\n', 'utf-8');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(src, { recursive: true, force: true });
  });

  it('is a precondition that the fixture package really is self-contained', () => {
    expect(Object.keys(SELF_CONTAINED_PI_PACKAGES)).toContain(PKG);
  });

  it('prunes the package\'s own stale prompts and wrapper skills, and never its hand-authored skills or agents', async () => {
    put(`packages/${PKG}/commands/assess.yaml`, commandYaml('assess'));
    put(`packages/${PKG}/commands/old.yaml`, commandYaml('old'));
    put(`packages/${PKG}/commands/old-hidden.yaml`, commandYaml('old-hidden', 'hidden'));
    put('packages/other/commands/other.yaml', commandYaml('other'));
    // The package's own sources and files: none of them is generator output
    const own: Record<string, string> = {
      [`packages/${PKG}/skills/assess-repo/SKILL.md`]: skillMd('assess-repo'),
      [`packages/${PKG}/skills/assess-repo/REFERENCE.md`]: '# reference\n',
      [`packages/${PKG}/skills/ensemble-handwritten/SKILL.md`]:
        '---\nname: ensemble-handwritten\ndescription: x\ndisable-model-invocation: true\n---\n\n# x\n',
      // Marked, and in a package skills/ directory: a self-contained package's own skills are never inspected
      [`packages/${PKG}/skills/marked-source/SKILL.md`]: withGeneratedMarker(skillMd('marked-source'), 'elsewhere'),
      [`packages/${PKG}/agents/helper.md`]: '<!-- DO NOT EDIT - Generated from helper.yaml -->\n\n# helper\n',
      [`packages/${PKG}/prompts/hand-notes.md`]: '# written by hand\n',
    };
    for (const [file, content] of Object.entries(own)) put(file, content);
    await generateAll(options());
    for (const file of [
      `packages/${PKG}/prompts/ensemble-old.md`,
      `packages/${PKG}/prompts/_hidden/ensemble-old-hidden.md`,
      `packages/${PKG}/skills/ensemble-old/SKILL.md`,
    ]) {
      expect(exists(file)).toBe(true);
    }

    fs.rmSync(path.join(src, 'packages', PKG, 'commands', 'old.yaml'));
    fs.rmSync(path.join(src, 'packages', PKG, 'commands', 'old-hidden.yaml'));
    const dry = await generateAll(options({ dryRun: true }));
    for (const file of [
      `packages/${PKG}/prompts/ensemble-old.md`,
      `packages/${PKG}/prompts/_hidden/ensemble-old-hidden.md`,
      `packages/${PKG}/skills/ensemble-old/SKILL.md`,
    ]) {
      expect(exists(file)).toBe(true); // a dry run removed nothing
    }
    const real = await generateAll(options());

    const stale = [
      `packages/${PKG}/prompts/_hidden/ensemble-old-hidden.md`,
      `packages/${PKG}/prompts/ensemble-old.md`,
      `packages/${PKG}/skills/ensemble-old/SKILL.md`,
    ];
    expect(relative(dry.pruned)).toEqual(stale);
    expect(relative(real.pruned)).toEqual(stale);
    for (const file of stale) expect(exists(file)).toBe(false);
    for (const [file, content] of Object.entries(own)) {
      expect(fs.readFileSync(path.join(src, file), 'utf-8')).toBe(content);
    }
    // The package's live output and ensemble-pi's own output are untouched
    expect(exists(`packages/${PKG}/prompts/ensemble-assess.md`)).toBe(true);
    expect(exists(`packages/${PKG}/skills/ensemble-assess/SKILL.md`)).toBe(true);
    expect(exists('packages/pi/prompts/ensemble-other.md')).toBe(true);
    // The emptied prompts/_hidden/ of the package is gone with its last prompt
    expect(exists(`packages/${PKG}/prompts/_hidden`)).toBe(false);
  });

  it('leaves a self-contained package with no commands exactly as it was', async () => {
    put(`packages/${PKG}/commands/assess.yaml`, commandYaml('assess'));
    await generateAll(options());
    fs.rmSync(path.join(src, 'packages', PKG, 'commands', 'assess.yaml'));

    const result = await generateAll(options());

    expect(result.pruned).toEqual([]);
    expect(exists(`packages/${PKG}/prompts/ensemble-assess.md`)).toBe(true);
  });

  it('prunes an ensemble-pi mirror of a command once its package becomes self-contained', async () => {
    // The command was generated into ensemble-pi first (as if its package were not yet listed)
    put(`packages/${PKG}/commands/assess.yaml`, commandYaml('assess'));
    put('packages/other/commands/other.yaml', commandYaml('other'));
    await generateAll(options());
    const stalePrompt = path.join(piRoot, 'prompts', 'ensemble-assess.md');
    const staleWrapper = path.join(piRoot, 'skills', 'ensemble-assess', 'SKILL.md');
    fs.mkdirSync(path.dirname(staleWrapper), { recursive: true });
    fs.copyFileSync(path.join(src, 'packages', PKG, 'prompts', 'ensemble-assess.md'), stalePrompt);
    fs.copyFileSync(path.join(src, 'packages', PKG, 'skills', 'ensemble-assess', 'SKILL.md'), staleWrapper);

    const result = await generateAll(options());

    expect(relative(result.pruned)).toEqual([
      'packages/pi/prompts/ensemble-assess.md',
      'packages/pi/skills/ensemble-assess/SKILL.md',
    ]);
    expect(fs.existsSync(stalePrompt)).toBe(false);
    expect(exists('packages/pi/prompts/ensemble-other.md')).toBe(true);
  });
});
