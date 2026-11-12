'use strict';
/**
 * Tests for `validate-all.js#validateAdapterIdCategoryUniqueness` (#146).
 *
 * One `adapter` id across several directories, one category each, is legitimate and shipped:
 * `adapter-workflow-plain-git` and `adapter-worktree-plain-git` both declare
 * `adapter: plain-git`, kept apart so each carries only the allowlist its own category needs.
 * Resolution is keyed on (id, category), which leaves the duplicate PAIR as the unresolvable
 * case -- two directories declaring the same id AND the same category differ only by sort
 * order, and the loser's capabilities are unreachable with nothing reported. This check exists
 * to make that an authoring-time error, so these tests pin both directions: a split id passes,
 * a duplicate pair fails.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { validateAdapterIdCategoryUniqueness } = require('../validate-all');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkPackagesRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-id-category-'));
  tempDirs.push(dir);
  return path.join(dir, 'packages');
}

function writeAdapter(packagesDir, pkg, dirName, manifest) {
  const dir = path.join(packagesDir, pkg, 'skills', dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapter.yaml'), yaml.dump(manifest));
  return dir;
}

describe('validateAdapterIdCategoryUniqueness', () => {
  test('the real shipped packages pass, plain-git included', () => {
    // No argument: scans this repo's own packages, which DO contain the split `plain-git` id.
    // A check that rejected a split id outright would fail here, which is the point of
    // running it against the real tree rather than only against fixtures.
    expect(validateAdapterIdCategoryUniqueness()).toEqual([]);
  });

  test('one id split across two directories by category passes (the shipped plain-git shape)', () => {
    const packagesDir = mkPackagesRoot();
    writeAdapter(packagesDir, 'git', 'adapter-workflow-split', {
      adapter: 'split-git',
      categories: ['workflow']
    });
    writeAdapter(packagesDir, 'git', 'adapter-worktree-split', {
      adapter: 'split-git',
      categories: ['worktree']
    });

    expect(validateAdapterIdCategoryUniqueness(packagesDir)).toEqual([]);
  });

  test('the same (id, category) pair in two directories fails, naming the id, the category and both directories', () => {
    const packagesDir = mkPackagesRoot();
    writeAdapter(packagesDir, 'git', 'adapter-workflow-dup-a', {
      adapter: 'dup-git',
      categories: ['workflow']
    });
    writeAdapter(packagesDir, 'git', 'adapter-workflow-dup-b', {
      adapter: 'dup-git',
      categories: ['workflow']
    });

    const failures = validateAdapterIdCategoryUniqueness(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('dup-git');
    expect(failures[0]).toContain('workflow');
    expect(failures[0]).toContain(path.join('packages', 'git', 'skills', 'adapter-workflow-dup-a'));
    expect(failures[0]).toContain(path.join('packages', 'git', 'skills', 'adapter-workflow-dup-b'));
  });

  test('a duplicate pair across two packages fails too, so the check is not per-package', () => {
    const packagesDir = mkPackagesRoot();
    writeAdapter(packagesDir, 'git', 'adapter-tracker-dup', {
      adapter: 'cross-pkg',
      categories: ['tracker']
    });
    writeAdapter(packagesDir, 'development', 'adapter-tracker-dup', {
      adapter: 'cross-pkg',
      categories: ['tracker']
    });

    expect(validateAdapterIdCategoryUniqueness(packagesDir)).toHaveLength(1);
  });

  test('a multi-category manifest collides on whichever category overlaps, and only that one', () => {
    const packagesDir = mkPackagesRoot();
    // The adapter-tracker-beads shape: one manifest, two categories.
    writeAdapter(packagesDir, 'development', 'adapter-tracker-multi', {
      adapter: 'multi',
      categories: ['tracker', 'work-graph']
    });
    writeAdapter(packagesDir, 'git', 'adapter-work-graph-multi', {
      adapter: 'multi',
      categories: ['work-graph']
    });

    const failures = validateAdapterIdCategoryUniqueness(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('work-graph');
    // `tracker` is declared once, so it must not be reported.
    expect(failures[0]).not.toContain("category 'tracker'");
  });

  test('a manifest that cannot be parsed is reported rather than skipped silently', () => {
    const packagesDir = mkPackagesRoot();
    const dir = path.join(packagesDir, 'git', 'skills', 'adapter-broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adapter.yaml'), 'adapter: [unclosed\n');

    const failures = validateAdapterIdCategoryUniqueness(packagesDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('adapter-broken');
  });

  test('generated and mirrored packages are skipped, so a mirror never reads as a duplicate of its own source', () => {
    const packagesDir = mkPackagesRoot();
    const manifest = { adapter: 'mirrored', categories: ['workflow'] };
    writeAdapter(packagesDir, 'git', 'adapter-workflow-mirrored', manifest);
    for (const generated of ['full', 'pi', 'codex', 'opencode']) {
      writeAdapter(packagesDir, generated, 'adapter-workflow-mirrored', manifest);
    }

    expect(validateAdapterIdCategoryUniqueness(packagesDir)).toEqual([]);
  });
});
