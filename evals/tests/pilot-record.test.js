'use strict';

/**
 * TRD-028-TEST (Claude half): the committed baselines support an expand decision for each pilot skill, and the guide's pilot
 * record states wall-clock time and cost against the 60 minute target and the cap. The Pi half is open until Pi is run.
 */

const fs = require('fs');
const path = require('path');
const results = require('../lib/results');
const { loadEvalDefs } = require('../lib/eval-def');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PILOTS = ['ensemble-create-prd', 'ensemble-refine-prd', 'ensemble-create-trd', 'pr-merge-trace'];
const GUIDE = () => fs.readFileSync(path.join(REPO_ROOT, 'docs/guides/skills-eval.md'), 'utf8');

describe('TRD-028-TEST: pilot results record (Claude)', () => {
  test.each(PILOTS)('%s: a committed Claude baseline shows uplift and reliability, on one reported model', (skill) => {
    const file = path.join(REPO_ROOT, 'evals/baselines/claude', `${skill}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const b = results.readBaseline(file); // strict: contradictory numbers, a symlink or a wrong path throw
    expect(b.runtime).toBe('claude');
    expect(b.model).not.toBe(results.UNKNOWN_MODEL);
    expect(b.repeats).toBe(5);
    expect(typeof b.uplift).toBe('number');
    expect(typeof b.reliable).toBe('boolean');
    expect(b.withSkill.runs).toBe(5);
    expect(b.baseline.runs).toBe(5);
  });

  test('all four pilots were measured on the same model, so their numbers are comparable', () => {
    const models = PILOTS.map((s) => results.readBaseline(path.join(REPO_ROOT, 'evals/baselines/claude', `${s}.json`)).model);
    expect(new Set(models).size).toBe(1);
  });

  test('the pilot evals still load (a baseline whose eval no longer exists is not a record of anything)', () => {
    const defs = loadEvalDefs().evals;
    for (const s of PILOTS) expect(defs.find((e) => e.id === s)).toBeDefined();
  });

  const record = () => {
    const g = GUIDE();
    const i = g.indexOf('### Pilot record (TRD-028, Claude half)');
    expect(i).toBeGreaterThan(-1);
    return g.slice(i);
  };

  test('the guide table equals the committed baselines, row by row (passes, uplift, reliability), and names their model', () => {
    const rec = record();
    for (const skill of PILOTS) {
      const b = results.readBaseline(path.join(REPO_ROOT, 'evals/baselines/claude', `${skill}.json`));
      const row = new RegExp(`^\\| \`${skill}\` \\| (\\d+)/(\\d+) \\| (\\d+)/(\\d+) \\| ([+-]\\d\\.\\d\\d) \\| (yes|no) \\|$`, 'm').exec(rec);
      expect(row).not.toBeNull();
      expect([+row[1], +row[2], +row[3], +row[4]]).toEqual([b.withSkill.passes, b.withSkill.runs, b.baseline.passes, b.baseline.runs]);
      expect(+row[5]).toBeCloseTo(b.uplift, 2);
      expect(row[6]).toBe(b.reliable ? 'yes' : 'no');
    }
    expect(rec).toContain(`\`${results.readBaseline(path.join(REPO_ROOT, 'evals/baselines/claude', `${PILOTS[0]}.json`)).model}\``);
  });

  test('timing recorded against the target: wall-clock and cost are numbers, within the 60 minute target and the cap they are compared to', () => {
    const rec = record();
    const minutes = /Wall-clock time for the pilot runs was (\d+) minutes/.exec(rec);
    expect(minutes).not.toBeNull();
    expect(+minutes[1]).toBeLessThanOrEqual(60); // the record claims "within target"; a larger number must be reworded, not left
    const dollars = [...rec.matchAll(/\$(\d+\.\d\d)/g)].map((m) => +m[1]);
    expect(dollars.length).toBeGreaterThanOrEqual(3); // total, first pass, rerun
    expect(dollars[0]).toBeLessThanOrEqual(50);
    expect(dollars[1] + dollars[2]).toBeCloseTo(dollars[0], 2);
    expect(rec).toMatch(/60-minute target/);
    expect(rec).toMatch(/\$50 cap/);
    expect(rec).toMatch(/\*\*Pi has not been run\*\*/);
  });
});
