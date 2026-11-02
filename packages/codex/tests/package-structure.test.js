const fs = require('fs');
const path = require('path');

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

  test('lean runtime skills only ship SKILL.md for framework packages', () => {
    const reactDir = path.join(CODEX_DIR, 'skills', 'react');
    const files = fs.readdirSync(reactDir).sort();
    expect(files).toEqual(['SKILL.md']);
  });
});
