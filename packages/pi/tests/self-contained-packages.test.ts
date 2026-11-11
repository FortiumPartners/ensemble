/**
 * Self-contained Pi packages (SELF_CONTAINED_PI_PACKAGES).
 *
 * A package in that set (today: assessment) is installed as a Pi package of its
 * own, so its commands must be generated into that package and nowhere in
 * ensemble-pi: a prompt left in packages/pi/prompts would point at skills that
 * ensemble-pi does not ship.
 *
 * Three layers, each of which fails if the mechanism is reverted:
 *   1. Generator behaviour on a throwaway monorepo (hermetic; every case pairs the
 *      self-contained package with a control package that must keep landing in
 *      ensemble-pi, so a generator that moves everything, or nothing, fails).
 *   2. The package manifests that must register what the generator writes.
 *   3. The committed output of the real repository.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import matter from 'gray-matter';
import { generate, generateAll, generateSelfContainedPackages } from '../src/generator';
import { copySkills } from '../src/transformers/skill-copier';
import { SELF_CONTAINED_PI_PACKAGES } from '../src/self-contained-packages';
import { GeneratorOptions } from '../src/types';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// assessment is self-contained by decision (it is its own Pi package), so it is always checked;
// any other member of the set is checked too. A reverted set therefore fails the cases below
// instead of making `describe.each` throw on an empty table.
const SELF_CONTAINED = [...new Set(['assessment', ...Object.keys(SELF_CONTAINED_PI_PACKAGES)])];

function command(name: string, extra = '', visibility = ''): string {
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
    extra,
    '',
  ].join('\n');
}

function dispatcherTo(...refs: string[]): string {
  return [
    'dispatch:',
    '  subcommands:',
    ...refs.flatMap((ref) => [`    - keyword: ${ref}`, `      ref: ${ref}`, `      description: "Goes to ${ref}"`]),
  ].join('\n');
}

/** Every file under `dir`, as paths relative to `dir` with forward slashes. */
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name)).map((f) => `${entry.name}/${f}`)
        : [entry.name]
    );
}

// ---------------------------------------------------------------------------
// 1. Generator behaviour on a throwaway monorepo
// ---------------------------------------------------------------------------

describe('Pi generator: self-contained package output roots', () => {
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

  const writeCommand = (pkg: string, file: string, content: string): void => {
    const dir = path.join(src, 'packages', pkg, 'commands');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), content, 'utf-8');
  };
  const inPkg = (pkg: string, ...p: string[]) => path.join(src, 'packages', pkg, ...p);
  const inPi = (...p: string[]) => path.join(piRoot, ...p);

  beforeEach(() => {
    src = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-selfc-src-'));
    piRoot = path.join(src, 'packages', 'pi');
    fs.writeFileSync(path.join(src, 'CLAUDE.md'), '## Agent Mesh\n\nContent.\n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(src, { recursive: true, force: true });
  });

  it('is a precondition of every case below that the fixture package really is self-contained', () => {
    expect(Object.keys(SELF_CONTAINED_PI_PACKAGES)).toContain(PKG);
    expect(Object.keys(SELF_CONTAINED_PI_PACKAGES)).not.toContain('other');
  });

  it('writes a self-contained package\'s prompt and wrapper skill into the package, not into ensemble-pi', async () => {
    writeCommand(PKG, 'assess.yaml', command('assess'));
    writeCommand('other', 'other.yaml', command('other'));
    await generateAll(options());

    expect(fs.readFileSync(inPkg(PKG, 'prompts', 'ensemble-assess.md'), 'utf-8')).toContain(
      '# ensemble-assess'
    );
    expect(fs.existsSync(inPkg(PKG, 'skills', 'ensemble-assess', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(inPi('prompts', 'ensemble-assess.md'))).toBe(false);
    expect(fs.existsSync(inPi('skills', 'ensemble-assess'))).toBe(false);

    // Control: a package outside the set keeps landing in ensemble-pi and gets no root of its own.
    expect(fs.existsSync(inPi('prompts', 'ensemble-other.md'))).toBe(true);
    expect(fs.existsSync(inPi('skills', 'ensemble-other', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(inPkg('other', 'prompts'))).toBe(false);
    expect(fs.existsSync(inPkg('other', 'skills'))).toBe(false);
  });

  it('leaves no reference to the self-contained command anywhere in the ensemble-pi output', async () => {
    writeCommand(PKG, 'assess.yaml', command('assess'));
    writeCommand('other', 'other.yaml', command('other'));
    await generateAll(options());

    const piFiles = walk(piRoot);
    expect(piFiles.length).toBeGreaterThan(0); // the scan is not vacuous
    for (const file of piFiles) {
      const content = fs.readFileSync(inPi(file), 'utf-8');
      expect(`${file}\n${content}`).not.toMatch(/ensemble[-:]assess/);
    }
  });

  it('generate() alone is confined to its output root and skips the self-contained commands', async () => {
    writeCommand(PKG, 'assess.yaml', command('assess'));
    writeCommand('other', 'other.yaml', command('other'));
    await generate(options());

    expect(fs.existsSync(inPi('prompts', 'ensemble-other.md'))).toBe(true);
    expect(fs.existsSync(inPi('prompts', 'ensemble-assess.md'))).toBe(false);
    expect(fs.existsSync(inPkg(PKG, 'prompts'))).toBe(false);
    expect(fs.existsSync(inPkg(PKG, 'skills'))).toBe(false);
  });

  it('routes a hidden command to the package\'s own prompts/_hidden/ and points its dispatcher there', async () => {
    writeCommand(PKG, 'hub.yaml', command('hub', dispatcherTo('secret', 'shown')));
    writeCommand(PKG, 'secret.yaml', command('secret', '', 'hidden'));
    writeCommand(PKG, 'shown.yaml', command('shown'));
    await generateAll(options());

    expect(fs.existsSync(inPkg(PKG, 'prompts', '_hidden', 'ensemble-secret.md'))).toBe(true);
    expect(fs.existsSync(inPkg(PKG, 'prompts', 'ensemble-secret.md'))).toBe(false);
    expect(fs.existsSync(inPkg(PKG, 'skills', 'ensemble-secret'))).toBe(false);
    expect(fs.existsSync(inPkg(PKG, 'skills', 'ensemble-shown', 'SKILL.md'))).toBe(true);

    const hub = fs.readFileSync(inPkg(PKG, 'prompts', 'ensemble-hub.md'), 'utf-8');
    expect(hub).toContain(`\`packages/${PKG}/prompts/_hidden/ensemble-secret.md\``);
    expect(hub).toContain(`\`packages/${PKG}/prompts/ensemble-shown.md\``);
  });

  it('rejects a dispatcher in ensemble-pi that targets a self-contained command', async () => {
    writeCommand(PKG, 'assess.yaml', command('assess'));
    writeCommand('other', 'hub.yaml', command('hub', dispatcherTo('assess')));
    await expect(generateAll(options())).rejects.toThrow(/unknown command 'assess'/);
  });

  it('rejects a dispatcher in a self-contained package that targets an ensemble-pi command', async () => {
    writeCommand('other', 'other.yaml', command('other'));
    writeCommand(PKG, 'hub.yaml', command('hub', dispatcherTo('other')));
    await expect(generateAll(options())).rejects.toThrow(/unknown command 'other'/);
  });

  it('writes nothing in either root on a dry run', async () => {
    writeCommand(PKG, 'assess.yaml', command('assess'));
    writeCommand('other', 'other.yaml', command('other'));
    await generateAll(options({ dryRun: true }));

    expect(fs.existsSync(piRoot)).toBe(false);
    expect(fs.existsSync(inPkg(PKG, 'prompts'))).toBe(false);
    expect(fs.existsSync(inPkg(PKG, 'skills'))).toBe(false);
  });

  it('creates nothing for a self-contained package that has no commands', async () => {
    fs.mkdirSync(inPkg(PKG, 'skills', 'a-skill'), { recursive: true });
    fs.writeFileSync(inPkg(PKG, 'skills', 'a-skill', 'SKILL.md'), '---\nname: a-skill\n---\nbody\n');
    await generateSelfContainedPackages(options());

    expect(fs.existsSync(inPkg(PKG, 'prompts'))).toBe(false);
    expect(walk(inPkg(PKG))).toEqual(['skills/a-skill/SKILL.md']);
  });

  it('validates the self-contained package\'s artifacts when --validate is set', async () => {
    writeCommand(PKG, 'assess.yaml', command('assess'));
    await expect(generateSelfContainedPackages(options({ validate: true }))).resolves.toEqual({ pruned: [] });
  });

  it('hides a self-contained wrapper from Claude Code, and leaves ensemble-pi\'s own wrappers alone', async () => {
    writeCommand(PKG, 'assess.yaml', command('assess'));
    writeCommand('other', 'other.yaml', command('other'));
    await generateAll(options());

    const own = matter(fs.readFileSync(inPkg(PKG, 'skills', 'ensemble-assess', 'SKILL.md'), 'utf-8')).data;
    expect(own['disable-model-invocation']).toBe(true);
    expect(own['user-invocable']).toBe(false);

    // Control: with no Claude command behind them, ensemble-pi's wrappers stay user-invocable.
    const piOwn = matter(fs.readFileSync(inPi('skills', 'ensemble-other', 'SKILL.md'), 'utf-8')).data;
    expect(piOwn['disable-model-invocation']).toBe(true);
    expect(piOwn['user-invocable']).toBeUndefined();
  });

  it.each(SELF_CONTAINED)('skill-copier skips %s, so its skills never reach ensemble-pi', async (pkg) => {
    fs.mkdirSync(inPkg(pkg, 'skills', 'leaf'), { recursive: true });
    fs.writeFileSync(inPkg(pkg, 'skills', 'leaf', 'SKILL.md'), '---\nname: leaf\n---\nbody\n');
    fs.mkdirSync(inPkg('other', 'skills', 'ctl'), { recursive: true });
    fs.writeFileSync(inPkg('other', 'skills', 'ctl', 'SKILL.md'), '---\nname: ctl\n---\nbody\n');

    await copySkills(src, piRoot, {});

    expect(fs.existsSync(inPi('skills', 'leaf'))).toBe(false);
    expect(fs.existsSync(inPi('skills', 'ctl', 'SKILL.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Package manifests register what the generator writes
// ---------------------------------------------------------------------------

describe.each(SELF_CONTAINED)('self-contained Pi package manifest: %s', (pkg) => {
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'packages', pkg, file), 'utf-8'));
  let manifest: Record<string, any>;

  beforeAll(() => {
    manifest = read('package.json');
  });

  it('is a Pi package of its own', () => {
    expect(manifest.keywords).toContain('pi-package');
    expect(manifest.pi.skills).toContain('./skills');
  });

  it('registers prompts with the non-recursive glob, so prompts/_hidden/ stays unregistered', () => {
    expect(manifest.pi.prompts).toEqual(['./prompts/*.md']);
  });

  it('publishes the prompts it registers', () => {
    expect(manifest.files).toEqual(expect.arrayContaining(['prompts/', 'skills/']));
  });

  it('is a Claude Code plugin that registers its commands, so the Pi wrapper it hides is not the only entry', () => {
    expect(read('.claude-plugin/plugin.json').commands).toBeTruthy();
  });

  it('has no dependency on, and is not depended on by, ensemble-pi', () => {
    const depsOf = (m: Record<string, any>) => [
      ...Object.keys(m.dependencies ?? {}),
      ...Object.keys(m.devDependencies ?? {}),
      ...Object.keys(m.peerDependencies ?? {}),
      ...Object.keys(m.optionalDependencies ?? {}),
    ];
    expect(depsOf(manifest)).not.toContain('@sunstone-partners/ensemble-pi');
    expect(depsOf(read('../pi/package.json'))).not.toContain(manifest.name);
  });
});

// ---------------------------------------------------------------------------
// 3. The committed output of the real repository
// ---------------------------------------------------------------------------

describe.each(SELF_CONTAINED)('committed output: %s', (pkg) => {
  const pkgDir = path.join(REPO_ROOT, 'packages', pkg);
  const piDir = path.join(REPO_ROOT, 'packages', 'pi');
  const commandNames = fs
    .readdirSync(path.join(pkgDir, 'commands'))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => `ensemble-${path.basename(f, '.yaml')}`);

  it('has at least one command, so the checks below are not vacuous', () => {
    expect(commandNames.length).toBeGreaterThan(0);
  });

  it.each(commandNames)('ships %s as a prompt and a wrapper skill in the package itself', (name) => {
    const hiddenPrompt = path.join(pkgDir, 'prompts', '_hidden', `${name}.md`);
    const visiblePrompt = path.join(pkgDir, 'prompts', `${name}.md`);
    expect(fs.existsSync(visiblePrompt) || fs.existsSync(hiddenPrompt)).toBe(true);
    if (fs.existsSync(visiblePrompt)) {
      const wrapper = path.join(pkgDir, 'skills', name, 'SKILL.md');
      expect(fs.existsSync(wrapper)).toBe(true);
      // Claude Code lists this package's skills/, where /ensemble:<cmd> already is the entry point.
      expect(matter(fs.readFileSync(wrapper, 'utf-8')).data['user-invocable']).toBe(false);
    }
  });

  it.each(commandNames)('does not ship %s in ensemble-pi', (name) => {
    expect(fs.existsSync(path.join(piDir, 'prompts', `${name}.md`))).toBe(false);
    expect(fs.existsSync(path.join(piDir, 'prompts', '_hidden', `${name}.md`))).toBe(false);
    expect(fs.existsSync(path.join(piDir, 'skills', name))).toBe(false);
  });

  it('leaves no reference to the package\'s commands in the ensemble-pi output', () => {
    const files = ['prompts', 'skills', 'agents', 'vendor'].flatMap((dir) =>
      walk(path.join(piDir, dir)).map((f) => path.join(dir, f))
    );
    files.push('AGENTS.md');
    expect(files.length).toBeGreaterThan(100); // a real scan, not an empty directory
    for (const name of commandNames) {
      const colonForm = name.replace(/^ensemble-/, 'ensemble:');
      for (const file of files) {
        const content = fs.readFileSync(path.join(piDir, file), 'utf-8');
        expect(content.includes(name) || content.includes(colonForm) ? file : null).toBeNull();
      }
    }
  });

  it('commits exactly what the generator writes now (run `npm run generate:pi` if this fails)', async () => {
    // Regenerate from a copy of the package's command sources, so a YAML edit that was not
    // followed by a regenerate is caught here and not only by CI's git-diff drift check.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-selfc-fresh-'));
    try {
      fs.mkdirSync(path.join(scratch, 'packages', pkg, 'commands'), { recursive: true });
      for (const file of fs.readdirSync(path.join(pkgDir, 'commands')).filter((f) => f.endsWith('.yaml'))) {
        fs.copyFileSync(
          path.join(pkgDir, 'commands', file),
          path.join(scratch, 'packages', pkg, 'commands', file)
        );
      }
      // A skill-backed command's prompt is its skill (packages/<pkg>/skills/<skill>/SKILL.md),
      // which the generator must be able to find beside the command sources.
      if (fs.existsSync(path.join(pkgDir, 'skills'))) {
        fs.cpSync(path.join(pkgDir, 'skills'), path.join(scratch, 'packages', pkg, 'skills'), { recursive: true });
      }
      await generateSelfContainedPackages({ dryRun: false, verbose: false, validate: false, sourceRoot: scratch });

      const fresh = path.join(scratch, 'packages', pkg);
      const generated = [...walk(path.join(fresh, 'prompts')).map((f) => `prompts/${f}`),
        ...walk(path.join(fresh, 'skills')).map((f) => `skills/${f}`)].sort();
      expect(generated.length).toBeGreaterThan(0);
      for (const file of generated) {
        expect(fs.readFileSync(path.join(pkgDir, file), 'utf-8')).toBe(
          fs.readFileSync(path.join(fresh, file), 'utf-8')
        );
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The CLI entry point reaches the mechanism
// ---------------------------------------------------------------------------

describe('Pi generator CLI entry point (src/index.ts)', () => {
  it('generates the self-contained packages as well as ensemble-pi (dry run on the real sources)', async () => {
    // `npm run generate:pi` runs the entry point, not generate(): a mechanism that only
    // generateAll() knew about, with the entry point still calling generate(), would pass
    // every other case in this file and never run for real.
    const originalArgv = process.argv;
    const exited = new Promise<number | undefined>((resolve) => {
      jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        resolve(code);
      }) as never);
    });
    const written: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    }) as never);
    process.argv = ['node', 'index.js', '--dry-run', '--verbose'];

    try {
      jest.isolateModules(() => {
        require('../src/index');
      });
      expect(await exited).toBe(0);
    } finally {
      process.argv = originalArgv;
      jest.restoreAllMocks();
    }

    const log = written.join('');
    for (const pkg of SELF_CONTAINED) {
      expect(log).toMatch(new RegExp(`Self-contained Pi package ${pkg}: \\d+ command YAML file`));
    }
  });
});
