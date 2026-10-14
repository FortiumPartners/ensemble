'use strict';

/**
 * TRD-007-TEST: Packaging reachability for the pr-review-cycle CLI/skill.
 *
 * Validates PRD ACs: AC-001-3, AC-019-3, AC-025-3.
 *
 * Scenario: state reports are untracked -- given a report under
 * .ensemble/pr-review/, `git check-ignore` reports the path ignored so a
 * state report can never alter the PR head.
 *
 * Scenario: mirror validation passes -- given the new pr-review-*.js lib
 * files and the new pr-review-cycle skill exist, when
 * validateFullLibMirror()/validateFullSkillsMirror() run (the same
 * functions `npm run validate` calls), then neither reports a missing
 * mirror for them.
 *
 * The remaining Test AC scenario (vendored bundle contains the CLI and its
 * modules) is covered by packages/pi/tests/lib-bundler.test.ts ("vendors
 * every real sibling module pr-review-cli.js requires").
 */

const path = require('path');
const { execFileSync } = require('child_process');
const {
  validateFullLibMirror,
  validateFullSkillsMirror,
} = require('../../../scripts/validate-all.js');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

describe('pr-review review-state report packaging', () => {
  test('.ensemble/pr-review/<file>.json is reported ignored by git check-ignore', () => {
    const target = '.ensemble/pr-review/x.json';
    let output;
    let status = 0;
    try {
      output = execFileSync('git', ['check-ignore', target], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      });
    } catch (err) {
      status = err.status;
      output = (err.stdout || '') + (err.stderr || '');
    }

    // Exit 0 = path is ignored (the desired, safe outcome).
    expect(status).toBe(0);
    expect(output.trim()).toBe(target);
  });

  test('.gitignore declares the pr-review state directory', () => {
    const fs = require('fs');
    const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.ensemble/pr-review/');
  });
});

describe('scenario: mirror validation passes', () => {
  test('packages/full/lib mirrors every pr-review-*.js file', () => {
    const failures = validateFullLibMirror();
    const prReviewFailures = failures.filter((msg) => msg.includes('pr-review-'));
    expect(prReviewFailures).toEqual([]);
  });

  test('packages/full/skills mirrors the pr-review-cycle skill', () => {
    const failures = validateFullSkillsMirror();
    const prReviewCycleFailures = failures.filter((msg) => msg.includes('pr-review-cycle'));
    expect(prReviewCycleFailures).toEqual([]);
  });
});
