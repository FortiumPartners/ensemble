const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { generateCommandSkills } = require('../../../scripts/generate-codex/index.js');

const { MIRROR_PACKAGES } = require('../../../scripts/lib/mirror-packages');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGE_DIR = path.join(ROOT, 'packages', 'codex');
const CODEX_DIR = path.join(PACKAGE_DIR, '.codex');

describe('ensemble-codex package structure', () => {
  test('package.json exists and has expected package name', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('@sunstone-partners/ensemble-codex');
  });

  test('plugin.json exists and has expected plugin name', () => {
    const plugin = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_DIR, '.claude-plugin', 'plugin.json'), 'utf-8')
    );
    expect(plugin.name).toBe('ensemble-codex');
  });

  test('root package.json exposes generate:codex script', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    expect(rootPkg.scripts).toHaveProperty('generate:codex');
  });

  test('generated Codex artifacts exist', () => {
    expect(fs.existsSync(path.join(PACKAGE_DIR, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(CODEX_DIR, 'config.toml'))).toBe(true);
    expect(fs.existsSync(path.join(CODEX_DIR, 'agents'))).toBe(true);
    expect(fs.existsSync(path.join(CODEX_DIR, 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'install-codex-project.js'))).toBe(true);
    expect(fs.existsSync(path.join(PACKAGE_DIR, 'bin', 'install.js'))).toBe(true);
  });

  test('Codex AGENTS.md stays concise', () => {
    const lines = fs.readFileSync(path.join(PACKAGE_DIR, 'AGENTS.md'), 'utf-8').trim().split('\n');
    expect(lines.length).toBeLessThanOrEqual(150);
  });

  test('translated agent configs are present', () => {
    const agentDir = path.join(CODEX_DIR, 'agents');
    const files = fs.readdirSync(agentDir).filter((file) => file.endsWith('.toml'));
    const sourceAgents = fs
      .readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })
      // A mirror package carries another package's agent YAML, so counting it here expects
      // the duplicate .toml the generator deliberately does not write.
      .filter((entry) => entry.isDirectory() && !MIRROR_PACKAGES.has(entry.name))
      .flatMap((entry) => {
        const dir = path.join(ROOT, 'packages', entry.name, 'agents');
        return fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith('.yaml')) : [];
      })
      .map((file) => file.replace(/\.yaml$/, '.toml'));
    expect([...files].sort()).toEqual([...sourceAgents].sort());

    const backendAgent = fs.readFileSync(path.join(agentDir, 'backend-developer.toml'), 'utf-8');
    expect(backendAgent).toMatch(/skills = \[/);
  });

  test('translated command skills are present', () => {
    const commandDir = path.join(CODEX_DIR, 'skills', 'commands');
    const dirs = fs.readdirSync(commandDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(dirs.length).toBeGreaterThanOrEqual(26);
  });

  test('package metadata supports npm publishing', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf-8'));
    expect(pkg.bin).toHaveProperty('ensemble-codex-install', './bin/install.js');
    expect(pkg.publishConfig).toEqual({ access: 'public' });
    expect(pkg.scripts).toHaveProperty('prepublishOnly');
    expect(pkg.scripts.prepublishOnly).toContain('npm pack --dry-run');
    expect(pkg.scripts).toHaveProperty('sync:version');
    expect(pkg.scripts).toHaveProperty('release-notes');
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'generate-codex-release-notes.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'generate-release-notes.js'))).toBe(true);
  });

  // Framework skills only: the skill of a skill-backed command also carries its references/ directory
  // (see 'skill-backed commands of the real sources' below), which this assertion does not look at.
  test('lean runtime skills only ship SKILL.md for framework packages', () => {
    const reactDir = path.join(CODEX_DIR, 'skills', 'react');
    const files = fs.readdirSync(reactDir).sort();
    expect(files).toEqual(['SKILL.md']);
  });
});

describe('ensemble-codex: skill-backed commands of the real sources', () => {
  // Skill-backed commands (a top-level `skill` in the command YAML) ship their skill verbatim as
  // the command's one skill. The real sources go through the generator into a scratch directory,
  // so this holds whether or not the committed output has been regenerated yet; with no
  // skill-backed command in the repository the loop below has nothing to check.
  const PACKAGES_DIR = path.join(ROOT, 'packages');
  let scratch;
  let commandsDir;
  let count;

  function skillBackedCommands() {
    const found = [];
    for (const pkg of fs.readdirSync(PACKAGES_DIR).sort()) {
      const dir = path.join(PACKAGES_DIR, pkg, 'commands');
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
        const data = yaml.load(fs.readFileSync(path.join(dir, file), 'utf-8'));
        if (data && typeof data.skill === 'string') {
          found.push({
            yamlFile: path.join(dir, file),
            baseName: path.basename(file, '.yaml'),
            skill: data.skill,
          });
        }
      }
    }
    return found;
  }

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-skillbacked-real-'));
    commandsDir = path.join(scratch, '.codex', 'skills', 'commands');
    count = generateCommandSkills({
      dryRun: false,
      verbose: false,
      packagesDir: PACKAGES_DIR,
      outputDir: path.join(scratch, '.codex'),
    });
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test('each ships its skill byte for byte as the one skill of the command, with no wrapper beside it', () => {
    for (const { yamlFile, baseName, skill } of skillBackedCommands()) {
      const source = fs.readFileSync(path.join(path.dirname(path.dirname(yamlFile)), 'skills', skill, 'SKILL.md'));
      const shipped = fs.readFileSync(path.join(commandsDir, skill, 'SKILL.md'));
      expect({ yamlFile, identical: shipped.equals(source) }).toEqual({ yamlFile, identical: true });

      if (skill !== `ensemble-${baseName}`) {
        const wrapperDir = path.join(commandsDir, `ensemble-${baseName}`);
        expect({ yamlFile, wrapperDir: fs.existsSync(wrapperDir) }).toEqual({ yamlFile, wrapperDir: false });
      }
    }
  });

  // The SKILL.md of a split skill names its phase files by paths relative to itself
  // (`references/phase-1-....md`), so they must ship beside it: the skill directory of a command holds
  // SKILL.md and the files of its references/ directory, and nothing else of the source skill.
  function filesBelow(dir) {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .flatMap((entry) =>
        entry.isDirectory() ? filesBelow(path.join(dir, entry.name)).map((rel) => `${entry.name}/${rel}`) : [entry.name]
      )
      .sort();
  }

  test('each ships the references/ of its skill with it, file for file and byte for byte, plus the Codex policy file when the skill opts out of implicit use, and no other file of the skill', () => {
    for (const { yamlFile, skill } of skillBackedCommands()) {
      const sourceDir = path.join(path.dirname(path.dirname(yamlFile)), 'skills', skill);
      const referencesDir = path.join(sourceDir, 'references');
      const references = fs.existsSync(referencesDir) ? filesBelow(referencesDir).map((rel) => `references/${rel}`) : [];
      const shippedDir = path.join(commandsDir, skill);
      // Codex does not read `disable-model-invocation`; it reads agents/openai.yaml instead.
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(sourceDir, 'SKILL.md'), 'utf8'));
      const optsOut = frontmatter !== null && /^disable-model-invocation:\s*true\s*$/m.test(frontmatter[1]);
      const policy = optsOut ? ['agents/openai.yaml'] : [];

      expect({ yamlFile, shipped: filesBelow(shippedDir) }).toEqual({
        yamlFile,
        shipped: ['SKILL.md', ...policy, ...references].sort(),
      });
      if (optsOut) {
        expect({ yamlFile, policy: fs.readFileSync(path.join(shippedDir, 'agents/openai.yaml'), 'utf8') }).toEqual({
          yamlFile,
          policy: 'policy:\n  allow_implicit_invocation: false\n',
        });
      }
      for (const rel of references) {
        const identical = fs.readFileSync(path.join(shippedDir, rel)).equals(fs.readFileSync(path.join(sourceDir, rel)));
        expect({ yamlFile, rel, identical }).toEqual({ yamlFile, rel, identical: true });
      }
    }
  });

  test('the command skill count the generator reports (and AGENTS.md states) is the number of skills it wrote', () => {
    const dirs = fs.readdirSync(commandsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(count).toBe(dirs.length);
  });
});
