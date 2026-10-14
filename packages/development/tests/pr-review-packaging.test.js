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
 * The other two Test AC scenarios (vendored bundle contains the CLI and its
 * modules; packages/full mirror check passes) are covered by
 * packages/pi/tests/lib-bundler.test.ts ("vendors every real sibling module
 * pr-review-cli.js requires") and by `npm run validate`'s
 * validateFullLibMirror()/validateFullSkillsMirror() checks respectively.
 */

const path = require('path');
const { execFileSync } = require('child_process');

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
