'use strict';
/**
 * Tests for scripts/migrate-command-to-skill.js: the dry-run/write/parity workflow that turns a full
 * command YAML into a skill-backed manifest plus SKILL.md.
 *
 * Uses a synthetic fixture command (fixtures/migrate-command/demo-cmd.yaml), copied into a throwaway
 * git repository under os.tmpdir() so `--base <ref>` (git show) is exercised for real.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const migrate = require('../migrate-command-to-skill');
const { validateCommandSchema } = require('../lib/schema-validator');
const { isSkillBacked, readSkillProse } = require('../lib/skill-backed-command');
const { extractFrontmatter } = require('../lib/frontmatter-check');

const FIXTURE = path.join(__dirname, 'fixtures', 'migrate-command', 'demo-cmd.yaml');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let roots = [];
afterEach(() => {
  roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true }));
  roots = [];
});

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' }
  );
}

/** A git repo with packages/demo/commands/<name>.yaml committed (default: the fixture). */
function createRepo(yamlText = fs.readFileSync(FIXTURE, 'utf8'), name = 'demo-cmd') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-cmd-'));
  roots.push(root);
  const yamlPath = path.join(root, 'packages', 'demo', 'commands', `${name}.yaml`);
  fs.mkdirSync(path.dirname(yamlPath), { recursive: true });
  fs.writeFileSync(yamlPath, yamlText);
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'add command');
  return { root, yamlPath, pkgDir: path.join(root, 'packages', 'demo'), skillDir: path.join(root, 'packages', 'demo', 'skills', `ensemble-${name}`) };
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out[p] = 'dir'; walk(p); } else out[p] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function quiet() {
  const logs = [];
  return { log: (m) => logs.push(m), error: (m) => logs.push(m), logs };
}

describe('dry run', () => {
  test('plan and CLI dry-run write nothing and summarize files, size and collisions', () => {
    const { root, yamlPath, skillDir } = createRepo();
    const before = snapshot(root);
    const out = quiet();
    expect(migrate.main([yamlPath], out)).toBe(0);
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(skillDir)).toBe(false);
    const text = out.logs.join('\n');
    expect(text).toContain('ensemble-demo-cmd');
    expect(text).toMatch(/SKILL\.md\s+\(\d+ lines, ~\d+ tokens\)/);
    expect(text).toContain('Dry run: nothing written');
    expect(text).not.toContain('WARNING');
  });

  test('a real command in the repository: summary printed, tree unchanged', () => {
    const real = path.join(REPO_ROOT, 'packages', 'product', 'commands', 'refine-prd.yaml');
    const skillDir = path.join(REPO_ROOT, 'packages', 'product', 'skills', 'ensemble-refine-prd');
    const yamlBefore = fs.readFileSync(real, 'utf8');
    const out = quiet();
    expect(migrate.main([real], out)).toBe(0);
    expect(out.logs.join('\n')).toContain('ensemble-refine-prd');
    expect(fs.readFileSync(real, 'utf8')).toBe(yamlBefore);
    expect(fs.existsSync(skillDir)).toBe(false);
  });

  test('warns and suggests a references/ split above the size budget', () => {
    const actions = Array.from({ length: 700 }, (_, i) => `            - Perform numbered action ${i} carefully.`).join('\n');
    const big = fs.readFileSync(FIXTURE, 'utf8').replace('            - Write one paragraph per verified claim.', `${actions}\n            - Write one paragraph per verified claim.`);
    const { yamlPath } = createRepo(big);
    const plan = migrate.planMigration(yamlPath);
    expect(plan.warnings.join('\n')).toMatch(/references\//);
    expect(plan.lineCount).toBeGreaterThan(500);
  });
});

describe('--write', () => {
  test('writes a valid SKILL.md and a schema-valid manifest that preserves all metadata', () => {
    const { yamlPath, skillDir } = createRepo();
    const original = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
    migrate.writeMigration(migrate.planMigration(yamlPath));

    const skillMd = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const fm = yaml.load(extractFrontmatter(skillMd));
    expect(fm.name).toBe(path.basename(skillDir));
    expect(fm.name).toBe('ensemble-demo-cmd');
    expect(fm.description).toBe(original.metadata.description);
    expect(fm['disable-model-invocation']).toBe(true);
    expect(fm.metadata).toEqual({ version: '1.4.2', category: 'planning' });

    const manifestText = fs.readFileSync(yamlPath, 'utf8');
    const manifest = yaml.load(manifestText);
    expect(isSkillBacked(manifest)).toBe(true);
    expect(manifest.skill).toBe('ensemble-demo-cmd');
    expect(Object.keys(manifest).sort()).toEqual(['metadata', 'skill']);
    // exact preservation, including hidden/visibility, allowed_tools, capabilities, argument_hint, model
    expect(manifest.metadata).toEqual(original.metadata);
    expect(manifest.metadata.visibility).toBe('hidden');
    expect(manifest.metadata.allowed_tools).toEqual(['Read', 'Grep', 'mcp__demo__lookup']);
    expect(() => validateCommandSchema(manifest, yamlPath)).not.toThrow();
    expect(manifestText).toContain('lastUpdated: "2026-10-18"');
  });

  test('skill body is the union of the Claude, Pi and OpenCode renders (constraints and phase descriptions included)', () => {
    const { yamlPath, skillDir } = createRepo();
    const original = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
    migrate.writeMigration(migrate.planMigration(yamlPath));
    const prose = readSkillProse(path.join(skillDir, 'SKILL.md')).replace(/\*\*|`/g, '').replace(/\s+/g, ' ');

    const units = migrate.renderUnits(original, yamlPath);
    expect(units.claude.length).toBeGreaterThan(10);
    expect(units.pi.length).toBeGreaterThan(10);
    expect(units.opencode.length).toBeGreaterThan(10);
    for (const [runtime, list] of Object.entries(units)) {
      for (const u of list) expect({ runtime, u, present: prose.includes(u) }).toEqual({ runtime, u, present: true });
    }

    // the three renders really do differ, so the union is not trivially one of them
    const claudeOnly = new Set(units.claude);
    expect(units.pi.some((u) => !claudeOnly.has(u))).toBe(true); // constraints: Pi/OpenCode only
    expect(units.opencode.some((u) => !new Set(units.pi).has(u))).toBe(true); // phase descriptions, delegation, expected output
    for (const c of original.constraints) expect(prose).toContain(c.replace(/\*\*|`/g, ''));
    expect(prose).toContain('Collect every fact the report needs before writing anything.');
    expect(prose).toContain('Verify each claim against its quoted source and report mismatches.');
    expect(prose).toContain('Read the source file directly when the lookup tool is unavailable.');
  });

  test('refuses to overwrite an existing skill directory and leaves everything untouched', () => {
    const { root, yamlPath, skillDir } = createRepo();
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'hand-written, do not clobber\n');
    git(root, 'add', '-A');
    const before = snapshot(root);

    const plan = migrate.planMigration(yamlPath);
    expect(plan.collision).toBe(true);
    expect(() => migrate.writeMigration(plan)).toThrow(/refusing to overwrite/);
    const out = quiet();
    expect(migrate.main([yamlPath], out)).toBe(1); // dry run reports the collision too
    expect(out.logs.join('\n')).toContain('already exists');
    expect(() => migrate.main([yamlPath, '--write'], quiet())).toThrow(/refusing to overwrite/);
    expect(snapshot(root)).toEqual(before);

    // --name picks a free directory
    expect(migrate.planMigration(yamlPath, { name: 'ensemble-demo-cmd-v2' }).collision).toBe(false);
  });

  test('rejects an invalid --name and an input that is already a manifest', () => {
    const { yamlPath } = createRepo();
    expect(() => migrate.planMigration(yamlPath, { name: '../escape' })).toThrow(/not a valid skill/);
    migrate.writeMigration(migrate.planMigration(yamlPath));
    expect(() => migrate.planMigration(yamlPath)).toThrow(/already a skill-backed manifest/);
  });
});

describe('checkMigrationParity', () => {
  function migrated() {
    const repo = createRepo();
    migrate.writeMigration(migrate.planMigration(repo.yamlPath));
    return repo;
  }
  const skillPath = (repo) => path.join(repo.skillDir, 'SKILL.md');
  const edit = (repo, from, to) => {
    const text = fs.readFileSync(skillPath(repo), 'utf8');
    expect(text).toContain(from);
    fs.writeFileSync(skillPath(repo), text.replace(from, to));
  };

  test('passes right after migration, reading the pre-migration YAML from git HEAD', () => {
    const repo = migrated();
    const result = migrate.checkMigrationParity(repo.yamlPath, repo.skillDir);
    expect(result).toMatchObject({ ok: true, missing: [] });
    expect(result.checked).toBeGreaterThan(30);
    const out = quiet();
    expect(migrate.main([repo.yamlPath, '--check-parity'], out)).toBe(0);
    expect(out.logs.join('\n')).toContain('parity OK');
  });

  test('--base selects the ref; a manifest ref is rejected', () => {
    const repo = migrated();
    git(repo.root, 'add', '-A');
    git(repo.root, 'commit', '-q', '-m', 'migrate');
    expect(() => migrate.checkMigrationParity(repo.yamlPath, repo.skillDir)).toThrow(/already a manifest/);
    expect(migrate.checkMigrationParity(repo.yamlPath, repo.skillDir, { base: 'HEAD~1' }).ok).toBe(true);
    expect(migrate.main([repo.yamlPath, '--check-parity', '--base', 'HEAD~1'], quiet())).toBe(0);
  });

  test.each([
    ['dropping a constraint (Claude never rendered it)', '- Stop and ask when the topic is empty; do not guess a subject.\n', '', 'Stop and ask when the topic is empty'],
    ['dropping the whole constraints section', '- NEVER modify any file outside the report directory.\n- Stop and ask when the topic is empty; do not guess a subject.\n- Format: the report is plain Markdown without front matter.\n', '', 'NEVER modify any file'],
    ['dropping a step action', '- End with a one-line conclusion.\n', '', 'End with a one-line conclusion'],
    ['dropping a phase description (OpenCode only)', 'Turn the verified facts into the report.\n', '', 'Turn the verified facts into the report'],
    ['dropping a delegation context', 'Verify each claim against its quoted source and report mismatches.\n', '', 'Verify each claim against its quoted source'],
    ['dropping the MCP fallback', '**Fallback:** Read the source file directly when the lookup tool is unavailable.\n', '', 'Read the source file directly'],
    ['dropping an expected-output item', '- **Claims**: The verified claims with their sources.\n', '', 'The verified claims with their sources'],
    ['dropping the second mission sentence', 'Then summarize them for a reviewer who has not seen the source material.', '', 'Then summarize them'],
    ['altering a constraint', 'NEVER modify any file', 'You may modify any file', 'NEVER modify any file']
  ])('mutation: %s fails the parity check', (_label, from, to, expectedMissing) => {
    const repo = migrated();
    edit(repo, from, to);
    const result = migrate.checkMigrationParity(repo.yamlPath, repo.skillDir);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.text.includes(expectedMissing))).toBe(true);
    const out = quiet();
    expect(migrate.main([repo.yamlPath, '--check-parity'], out)).toBe(1);
    expect(out.logs.join('\n')).toContain('parity FAILED');
    expect(out.logs.join('\n')).toContain(expectedMissing);
  });

  test('a dropped action line is reported against every runtime that rendered it', () => {
    const repo = migrated();
    edit(repo, '- Write one paragraph per verified claim.\n', '');
    const runtimes = migrate.checkMigrationParity(repo.yamlPath, repo.skillDir).missing.map((m) => m.runtime);
    expect(runtimes).toEqual(expect.arrayContaining(['claude', 'pi', 'opencode']));
  });

  test('content moved into references/*.md still counts; rewrapping and emphasis changes are tolerated', () => {
    const repo = migrated();
    const sentence = '- End with a one-line conclusion.\n';
    edit(repo, sentence, '');
    expect(migrate.checkMigrationParity(repo.yamlPath, repo.skillDir).ok).toBe(false);
    fs.mkdirSync(path.join(repo.skillDir, 'references'));
    fs.writeFileSync(path.join(repo.skillDir, 'references', 'phase-2.md'), `**End** with a one-line\nconclusion.\n`);
    expect(migrate.checkMigrationParity(repo.yamlPath, repo.skillDir).ok).toBe(true);
  });
});

describe('carried top-level keys', () => {
  const CARRIED_YAML = `${fs.readFileSync(FIXTURE, 'utf8').trimEnd()}

expectedInput:
  description: A topic name and an optional audience.
  fields:
    topic: Must be a single noun phrase.
    audience: Reviewer or maintainer
  required_flags:
    - --fast
usageExamples:
  - Run the demo with a topic named zebra.
  - Run the demo in fast mode for the topic giraffe.
timing_budget: Finish within five minutes of wall clock.
`;
  function migrated() {
    const repo = createRepo(CARRIED_YAML);
    migrate.writeMigration(migrate.planMigration(repo.yamlPath));
    return repo;
  }
  const skillPath = (repo) => path.join(repo.skillDir, 'SKILL.md');

  test('dry run reports carried keys instead of a dropped warning', () => {
    const repo = createRepo(CARRIED_YAML);
    const plan = migrate.planMigration(repo.yamlPath);
    const text = plan.warnings.join('\n');
    expect(text).toContain('carried into SKILL.md as sections: expectedInput, usageExamples, timing_budget');
    expect(text).not.toContain('dropped');
  });

  test('SKILL.md gets a titled section per key, manifest stays metadata + skill, parity passes', () => {
    const repo = migrated();
    const skill = fs.readFileSync(skillPath(repo), 'utf8');
    expect(skill).toContain('## Expected Input');
    expect(skill).toContain('## Usage Examples');
    expect(skill).toContain('## Timing Budget');
    expect(skill).toContain('- **description**: A topic name and an optional audience.');
    expect(skill).toContain('  - **topic**: Must be a single noun phrase.');
    expect(skill).toContain('- Run the demo with a topic named zebra.');
    expect(skill).toContain('Finish within five minutes of wall clock.');
    expect(skill.indexOf('## Expected Output')).toBeLessThan(skill.indexOf('## Expected Input'));
    expect(skill.indexOf('## Expected Input')).toBeLessThan(skill.indexOf('## Usage Examples'));
    const manifest = yaml.load(fs.readFileSync(repo.yamlPath, 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(['metadata', 'skill']);
    const result = migrate.checkMigrationParity(repo.yamlPath, repo.skillDir);
    expect(result).toMatchObject({ ok: true, missing: [] });
  });

  test('values nested more than two levels deep are fenced as yaml and still pass parity', () => {
    const deep = `${fs.readFileSync(FIXTURE, 'utf8').trimEnd()}\nteam_configuration:\n  a:\n    b:\n      c: deepest leaf value\n`;
    const repo = createRepo(deep);
    migrate.writeMigration(migrate.planMigration(repo.yamlPath));
    const skill = fs.readFileSync(skillPath(repo), 'utf8');
    expect(skill).toContain('## Team Configuration');
    expect(skill).toContain('```yaml');
    expect(migrate.checkMigrationParity(repo.yamlPath, repo.skillDir).ok).toBe(true);
  });

  test.each([
    ['a nested leaf', '  - **topic**: Must be a single noun phrase.\n', 'Must be a single noun phrase'],
    ['a list leaf', '- --fast\n', '--fast'],
    ['a usage example', '- Run the demo in fast mode for the topic giraffe.\n', 'Run the demo in fast mode'],
    ['a key name', '**required_flags**:', 'required_flags']
  ])('mutation: dropping %s from SKILL.md fails parity and names it', (_label, from, expected) => {
    const repo = migrated();
    const text = fs.readFileSync(skillPath(repo), 'utf8');
    expect(text).toContain(from);
    fs.writeFileSync(skillPath(repo), text.replace(from, ''));
    const result = migrate.checkMigrationParity(repo.yamlPath, repo.skillDir);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.text.includes(expected) && m.runtime.startsWith('carried:'))).toBe(true);
    const out = quiet();
    expect(migrate.main([repo.yamlPath, '--check-parity'], out)).toBe(1);
    expect(out.logs.join('\n')).toContain(expected);
  });

  test('a carried key moved into a non-markdown file under references/ still passes parity; deleting that file fails it', () => {
    const repo = migrated();
    const dataFile = path.join(repo.skillDir, 'references', 'carried-data.yaml');
    const text = fs.readFileSync(skillPath(repo), 'utf8');
    const start = text.indexOf('## Expected Input');
    const end = text.indexOf('## Usage Examples');
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, text.slice(start, end));
    fs.writeFileSync(skillPath(repo), text.slice(0, start) + text.slice(end));

    expect(migrate.checkMigrationParity(repo.yamlPath, repo.skillDir).ok).toBe(true);

    fs.rmSync(dataFile);
    const result = migrate.checkMigrationParity(repo.yamlPath, repo.skillDir);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.runtime.startsWith('carried:'))).toBe(true);
  });
});
