'use strict';
/**
 * Tests for the Agent Skills spec gate (scripts/validate-skills.js).
 *
 * Each rule is exercised against a committed fixture skill under fixtures/skills-spec/ that
 * breaks only that rule, next to a conforming control, so a gate that accepts everything
 * or rejects everything fails here.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findSkillDirs, filterTolerated } = require('../validate-skills');

// validateSkillDir loads the ESM-only `skills-ref` through a dynamic import(), which jest's
// CommonJS VM rejects without --experimental-vm-modules. Call the real exported function in
// a plain node process instead.
const GATE = path.resolve(__dirname, '..', 'validate-skills.js');
const validateSkillDir = async (dir) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        'require(process.argv[1]).validateSkillDir(process.argv[2]).then((e) => console.log(JSON.stringify(e)))',
        GATE,
        dir,
      ],
      { encoding: 'utf8' }
    )
  );

const FIXTURES = path.join(__dirname, 'fixtures', 'skills-spec');
const fixture = (name) => path.join(FIXTURES, name);

describe('validateSkillDir', () => {
  test('a conforming skill (with metadata.version) passes', async () => {
    expect(await validateSkillDir(fixture('conforming'))).toEqual([]);
  });

  test('a top-level `version:` key fails', async () => {
    const errors = await validateSkillDir(fixture('bad-version'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/version/);
  });

  test('a directory name that differs from the skill name fails', async () => {
    const errors = await validateSkillDir(fixture('dir-name-mismatch'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must match skill name/);
  });

  test('an uppercase skill name fails', async () => {
    const errors = await validateSkillDir(fixture('Upper-Name'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/lowercase/);
  });

  test('a skill name with a space fails', async () => {
    const errors = await validateSkillDir(fixture('spaced name'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/invalid characters/);
  });

  test('a description over 1024 characters fails', async () => {
    const errors = await validateSkillDir(fixture('long-description'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/1024/);
  });
});

describe('host extension keys (user-invocable, argument-hint, model)', () => {
  test('pass on a directory named ensemble-*', async () => {
    expect(await validateSkillDir(fixture('ensemble-host-keys'))).toEqual([]);
  });

  test('fail on any other directory name, with the same keys', async () => {
    const errors = await validateSkillDir(fixture('plain-host-keys'));
    expect(errors).toHaveLength(1);
    for (const key of ['user-invocable', 'argument-hint', 'model']) {
      expect(errors[0]).toContain(key);
    }
  });
});

describe('filterTolerated', () => {
  const unexpected = (keys) =>
    `Unexpected fields in frontmatter: ${keys}. Only allowed-tools, compatibility, description, license, metadata, name are allowed.`;

  test('drops an error whose keys are all host keys on an ensemble-* directory', () => {
    expect(filterTolerated('/skills/ensemble-x', [unexpected('model, user-invocable')])).toEqual([]);
  });

  test('keeps the same error on a directory that is not ensemble-*', () => {
    const errors = [unexpected('model, user-invocable')];
    expect(filterTolerated('/skills/plain-x', errors)).toEqual(errors);
  });

  test('keeps the error when a non-host key rides along on an ensemble-* directory', () => {
    const errors = [unexpected('user-invocable, version')];
    expect(filterTolerated('/skills/ensemble-x', errors)).toEqual(errors);
  });

  test('never drops an unrelated error, even on an ensemble-* directory', () => {
    const errors = ['Description exceeds 1024 character limit (1500 chars)'];
    expect(filterTolerated('/skills/ensemble-x', errors)).toEqual(errors);
  });
});

describe('findSkillDirs', () => {
  const tree = path.join(FIXTURES, 'tree');
  const symlink = path.join(tree, 'linked');

  beforeAll(() => {
    // Created at run time: a committed symlink does not survive every checkout (Windows).
    fs.rmSync(symlink, { force: true });
    fs.symlinkSync(fixture('conforming'), symlink, 'dir');
  });

  afterAll(() => {
    fs.rmSync(symlink, { force: true });
  });

  test('finds skill directories at any depth', () => {
    const found = findSkillDirs(tree).map((d) => path.relative(tree, d));
    expect(found).toContain('alpha');
    expect(found).toContain(path.join('group', 'beta'));
  });

  test('does not descend into a skill directory (its subfolders are assets)', () => {
    const found = findSkillDirs(tree).map((d) => path.relative(tree, d));
    expect(found).not.toContain(path.join('alpha', 'assets', 'inner'));
    expect(found.some((d) => d.startsWith(`alpha${path.sep}`))).toBe(false);
  });

  test('does not follow symlinks, even to a directory that holds a SKILL.md', () => {
    expect(fs.existsSync(path.join(symlink, 'SKILL.md'))).toBe(true);
    const found = findSkillDirs(tree).map((d) => path.relative(tree, d));
    expect(found).not.toContain('linked');
    expect(found.sort()).toEqual(['alpha', path.join('group', 'beta')]);
  });

  test('returns [] for a root that does not exist', () => {
    expect(findSkillDirs(path.join(FIXTURES, 'no-such-dir'))).toEqual([]);
  });
});
