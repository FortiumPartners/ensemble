'use strict';

/**
 * TRD-022 / TRD-022-TEST: proof that the regression check can fail (AC-018-2, Constitution rule 7).
 * A scratch copy of a pilot-style skill package (EVALS_REPO_ROOT, under ~/.omp/trd-skills-eval/jest) gets a known defect, and a
 * content-sensitive stub `claude` (the with-skill arm passes only when the SKILL.md it was given still holds a required instruction)
 * runs against a reliable baseline. No real model is called; nothing under packages/ in the real checkout is touched.
 */

const fs = require('fs');
const path = require('path');
const { createSuite, SKILL, PKG_DIR } = require('./stub-suite');

const REQUIRED = 'Ambiguity Marking Pass'; // an instruction the pilot skill really carries
const DEFECT = 'Ambiguity Skipping Pass'; // the deliberately broken wording
const ARGS = ['--repeats', '5', '--concurrency', '1', '--model', 'claude-stub-1'];
const SENSITIVE = { requireInSkill: REQUIRED };

let t;
let skillFile;
beforeEach(() => {
  t = createSuite();
  skillFile = path.join(t.useScratchRepo(), 'skills', SKILL, 'SKILL.md');
});
afterEach(() => t.cleanup());

const original = () => fs.readFileSync(path.join(PKG_DIR, 'skills', SKILL, 'SKILL.md'), 'utf8');
const breakSkill = () => fs.writeFileSync(skillFile, original().split(REQUIRED).join(DEFECT));
const fixSkill = () => fs.writeFileSync(skillFile, original());
const baseline = () => JSON.parse(fs.readFileSync(t.sub('baselines', 'claude', `${SKILL}.json`), 'utf8'));
/** Record the reliable committed baseline from the intact copy. */
function commitBaseline() {
  const r = t.run(ARGS, SENSITIVE);
  expect(r.status).toBe(0);
  expect(baseline()).toMatchObject({ reliable: true, runtime: 'claude', model: 'claude-stub-1', withSkill: { passes: 5, runs: 5 } });
}

describe('the premise holds (the test cannot pass vacuously)', () => {
  test('the real pilot skill carries the required instruction, the scratch copy is separate, and the defect really removes it', () => {
    expect(original()).toContain(REQUIRED);
    expect(skillFile.startsWith(t.root)).toBe(true);
    breakSkill();
    expect(fs.readFileSync(skillFile, 'utf8')).not.toContain(REQUIRED);
    expect(original()).toContain(REQUIRED); // the real checkout is untouched
  });
});

describe('introduced defect makes the check fail; removing it makes it pass (AC-018-2)', () => {
  test('defect: run.js and compare.js exit 1 and name skill and eval; defect removed: both pass', () => {
    commitBaseline();

    breakSkill();
    const bad = t.run(ARGS, SENSITIVE);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain(`eval ${SKILL}: FAIL`);
    expect(bad.stdout).toMatch(/regression check vs committed summary: regression \(was reliable \(5\/5, bar 4\), now 0\/5\)/);
    expect(baseline().withSkill.passes).toBe(5); // a regression never overwrites the committed baseline
    const cmpBad = t.compare();
    expect(cmpBad.status).toBe(1);
    expect(cmpBad.stdout).toMatch(new RegExp(`REGRESSION skill ${SKILL} eval ${SKILL} \\[claude\\]`));
    expect(cmpBad.stderr).toContain(`${SKILL}/${SKILL}`);

    fixSkill();
    const good = t.run([...ARGS, '--refresh'], SENSITIVE);
    expect(good.status).toBe(0);
    expect(good.stdout).not.toMatch(/regression check vs committed summary: regression/);
    const cmpGood = t.compare();
    expect(cmpGood.status).toBe(0);
    expect(cmpGood.stdout).toMatch(new RegExp(`skill ${SKILL} eval ${SKILL} \\[claude\\]: comparable, no regression`));
  });
});

describe('inverse proofs: the failure comes from the defect and the baseline, not from the harness being strict', () => {
  test('a stub that ignores the skill content passes with the defect in place (the check is not failing by itself)', () => {
    commitBaseline();
    breakSkill();
    const r = t.run([...ARGS, '--refresh'], { pass: true });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/regression check vs committed summary: regression/);
  });

  test('the intact copy passes under the content-sensitive stub (it is not failing everything)', () => {
    commitBaseline();
    const r = t.run([...ARGS, '--refresh'], SENSITIVE);
    expect(r.status).toBe(0);
    expect(t.compare().status).toBe(0);
  });

  test('without a committed baseline the defect is not called a regression (nothing to regress from)', () => {
    breakSkill();
    const r = t.run(ARGS, SENSITIVE);
    expect(r.status).toBe(1); // the eval itself failed, but that is not a regression
    expect(t.compare().status).toBe(0);
    expect(r.stdout).toContain('with-skill 0/5');
    expect(r.stdout).not.toMatch(/regression check vs committed summary: regression|REGRESSION/);
    expect(t.compare().stdout).not.toMatch(/REGRESSION/);
  });

  test('a baseline that was not reliable is not regressed from: the check needs a reliable baseline', () => {
    commitBaseline();
    const file = t.sub('baselines', 'claude', `${SKILL}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...baseline(), reliable: false, withSkill: { passes: 1, runs: 5 }, uplift: 0.2 }));
    breakSkill();
    const r = t.run([...ARGS, '--refresh'], SENSITIVE);
    expect(r.status).toBe(1);
    expect(t.compare().status).toBe(0);
    expect(r.stdout).toContain('with-skill 0/5');
    expect(r.stdout).not.toMatch(/regression check vs committed summary: regression|REGRESSION/);
    expect(t.compare().stdout).not.toMatch(/REGRESSION/);
  });
});
