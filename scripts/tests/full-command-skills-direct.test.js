'use strict';

/**
 * Command skills must be direct entries of packages/full/skills/. Since the bundle stopped shipping command stubs (v9.0.0),
 * `/ensemble-full:ensemble-<name>` exists only for a skill that is a direct child of skills/; a whole-package mirror such as
 * `git -> ../../git/skills` keeps paths resolvable but registers nothing. That is how ensemble-pr-merge and nine more commands
 * vanished from the bundle without any check noticing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateFullCommandSkillsDirect } = require('../validate-all.js');

const COMMANDS = [
  'ensemble-pr-merge', 'ensemble-release', 'ensemble-assess', 'ensemble-standards', 'ensemble-discover-standards',
  'ensemble-inject-standards', 'ensemble-fold-prompt', 'ensemble-reinstall-plugins', 'ensemble-sessionlog',
  'ensemble-author-playwright-tests',
];

describe('packages/full/skills: command skills are direct entries', () => {
  let log;
  beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => log.mockRestore());

  test('the real bundle has a direct entry for every command skill, the ten restored ones included', () => {
    expect(validateFullCommandSkillsDirect()).toEqual([]);
    const bundleSkills = path.join(__dirname, '..', '..', 'packages', 'full', 'skills');
    for (const name of COMMANDS) expect(fs.existsSync(path.join(bundleSkills, name, 'SKILL.md'))).toBe(true);
  });

  describe('against a scratch packages tree', () => {
    let root;
    const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-full-skills-')); // disposable fixture, removed in afterEach
      write(path.join(root, 'git', 'skills', 'ensemble-pr-merge', 'SKILL.md'), '---\nname: ensemble-pr-merge\n---\n');
      write(path.join(root, 'git', 'skills', 'git-town', 'SKILL.md'), '---\nname: git-town\n---\n'); // not a command skill
      fs.mkdirSync(path.join(root, 'full', 'skills'), { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('a command skill reachable only through a whole-package mirror is reported with the fix', () => {
      fs.symlinkSync('../../git/skills', path.join(root, 'full', 'skills', 'git'));
      const failures = validateFullCommandSkillsDirect(root);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(/packages\/full\/skills\/ensemble-pr-merge is not a direct entry \(command skill of packages\/git\)/);
      expect(failures[0]).toMatch(/ln -s \.\.\/\.\.\/git\/skills\/ensemble-pr-merge packages\/full\/skills\/ensemble-pr-merge/);
    });

    test('a per-skill link passes, and a skill that is not a command skill (git-town) is not demanded', () => {
      fs.symlinkSync('../../git/skills/ensemble-pr-merge', path.join(root, 'full', 'skills', 'ensemble-pr-merge'));
      expect(validateFullCommandSkillsDirect(root)).toEqual([]);
    });

    test('a broken link does not count as an entry', () => {
      fs.symlinkSync('../../git/skills/does-not-exist', path.join(root, 'full', 'skills', 'ensemble-pr-merge'));
      expect(validateFullCommandSkillsDirect(root)).toHaveLength(1);
    });

    test('a link to a different skill does not count as the entry for this one', () => {
      write(path.join(root, 'git', 'skills', 'ensemble-release', 'SKILL.md'), '---\nname: ensemble-release\n---\n');
      fs.symlinkSync('../../git/skills/ensemble-release', path.join(root, 'full', 'skills', 'ensemble-pr-merge')); // wrong target
      fs.symlinkSync('../../git/skills/ensemble-release', path.join(root, 'full', 'skills', 'ensemble-release'));
      const failures = validateFullCommandSkillsDirect(root);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(/ensemble-pr-merge is not a direct entry/);
    });

    test('a checkout without symlink support (the link is a file naming its target) counts only when it names this skill', () => {
      const entry = path.join(root, 'full', 'skills', 'ensemble-pr-merge');
      fs.writeFileSync(entry, '../../git/skills/ensemble-pr-merge');
      expect(validateFullCommandSkillsDirect(root)).toEqual([]);
      write(path.join(root, 'git', 'skills', 'ensemble-release', 'SKILL.md'), '---\nname: ensemble-release\n---\n');
      fs.writeFileSync(entry, '../../git/skills/ensemble-release'); // resolves, but to another skill
      const failures = validateFullCommandSkillsDirect(root);
      expect(failures.some((m) => /ensemble-pr-merge is not a direct entry/.test(m))).toBe(true);
      fs.writeFileSync(entry, 'not a link target\nat all, just some prose'); // not link-shaped
      expect(validateFullCommandSkillsDirect(root).some((m) => /ensemble-pr-merge is not a direct entry/.test(m))).toBe(true);
    });

    test('the full, pi, codex and opencode packages are not sources', () => {
      write(path.join(root, 'pi', 'skills', 'ensemble-x', 'SKILL.md'), 'x');
      fs.symlinkSync('../../git/skills/ensemble-pr-merge', path.join(root, 'full', 'skills', 'ensemble-pr-merge'));
      expect(validateFullCommandSkillsDirect(root)).toEqual([]);
    });
  });
});
