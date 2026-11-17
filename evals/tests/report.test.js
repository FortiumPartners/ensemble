'use strict';

/** PR 5 behavior: the per-skill report (TRD-016-TEST). Stub results go through arms.summarizeEval, as a real suite's do. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const arms = require('../lib/arms');
const results = require('../lib/results');
const report = require('../lib/report');

const mkRuns = (arm, runtime, outcomes) => outcomes.map((outcome, i) => ({ evalId: 'e', arm, run: i + 1, runtime, model: 'm', invocationMode: 'plain', outcome, invoked: false, costUsd: 0.01, durationMs: 5, graders: [] }));
function ev(skill, runtime, withOutcomes, baseOutcomes, { repeats = 5, bar = 4, abort = null } = {}) {
  return arms.summarizeEval({ id: `${skill}-eval`, skill, invocation: 'plain' }, { repeats, bar, repeatsSource: 't', barSource: 't' },
    { 'with-skill': mkRuns('with-skill', runtime, withOutcomes), baseline: mkRuns('baseline', runtime, baseOutcomes) }, { runtime, abort });
}
const P = 'pass';
const F = 'fail';
const text = (evals) => report.formatReport(report.buildReport(evals));

describe('TRD-016 per-skill report', () => {
  test('Scenario: report shows rates, difference and verdict', () => {
    const { rows } = report.buildReport([ev('alpha', 'claude', [P, P, P, P, F], [P, F, F, F, F])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ skill: 'alpha', status: 'complete', withSkill: { passes: 4, runs: 5 }, baseline: { passes: 1, runs: 5 }, reliable: true });
    expect(rows[0].uplift).toBeCloseTo(0.6);
    const t = text([ev('alpha', 'claude', [P, P, P, P, F], [P, F, F, F, F])]);
    expect(t).toMatch(/with-skill rate 4\/5 \(80%\); baseline rate 1\/5 \(20%\)/);
    expect(t).toMatch(/uplift \+0\.60/);
    expect(t).toMatch(/reliability: reliable \(with-skill bar 4 of 5\)/);
    expect(text([ev('alpha', 'claude', [P, F, F, F, F], [F, F, F, F, F])])).toMatch(/reliability: NOT reliable/);
  });

  test('Scenario: uplift reported, not judged (negative uplift shows the number and no pass or fail on its line)', () => {
    const t = text([ev('neg', 'claude', [P, F, F, F, F], [P, P, P, P, F])]);
    const line = t.split('\n').find((l) => /uplift/.test(l));
    expect(line).toMatch(/uplift -0\.60 \(package-level/);
    expect(line).not.toMatch(/pass|fail|reliab|ok|good|bad|regress/i);
    expect(report.buildReport([ev('neg', 'claude', [P, F, F, F, F], [P, P, P, P, F])]).rows[0]).not.toHaveProperty('upliftVerdict');
  });

  test('Scenario: incomplete skill unscored (unexecuted, unverifiable and aborted evals get no number)', () => {
    const budget = ev('cut', 'claude', [P, P, P], [F, F, F]); // 3 of 5 runs executed
    const unverifiable = ev('unv', 'claude', [P, P, P, P, P], [F, F, 'unverifiable', F, F]);
    const aborted = ev('abt', 'claude', [P, P, P, P, P], [F, F, F, F, F], { abort: 'leaked' });
    for (const [e, kind] of [[budget, 'incomplete'], [unverifiable, 'incomplete'], [aborted, 'aborted']]) {
      const row = report.buildReport([e]).rows[0];
      expect(row).toMatchObject({ status: kind, withSkill: null, baseline: null, uplift: null, reliable: null });
      expect(row.reasons.length).toBeGreaterThan(0);
      const t = report.formatReport({ rows: [row], granularities: [row.granularity] });
      expect(t).toMatch(kind === 'aborted' ? /ABORTED: no score/ : /INCOMPLETE: no score/);
      expect(t).not.toMatch(/uplift|rate|reliab|%/);
    }
    expect(text([unverifiable])).toMatch(/1 run\(s\) unverifiable/);
  });

  test('an unverifiable run is not counted as a pass or fail anywhere in the report', () => {
    const t = text([ev('unv', 'claude', [P, P, P, P, P], [F, F, 'unverifiable', F, F])]);
    expect(t).not.toMatch(/baseline rate/);
  });

  test('Scenario: uplift granularity labelled (Claude package-level, Pi skill-level), never mixed up', () => {
    const c = ev('both', 'claude', [P, P, P, P, P], [F, F, F, F, F]);
    const p = ev('both', 'pi', [P, P, P, P, P], [F, F, F, F, F]);
    const t = text([c, p]);
    const lines = t.split('\n');
    const claudeAt = lines.findIndex((l) => /skill both \[claude\]/.test(l));
    const piAt = lines.findIndex((l) => /skill both \[pi\]/.test(l));
    expect(lines[claudeAt + 2]).toBe('  uplift +1.00 (package-level (skills share a package))');
    expect(lines[piAt + 2]).toBe('  uplift +1.00 (skill-level)');
    expect(t).toMatch(/package-level and skill-level uplift are different quantities and are not comparable/);
    expect(text([p])).not.toMatch(/not comparable|package-level/); // a single granularity needs no caveat
  });

  test('an unknown runtime is an error, never a default label', () => {
    expect(() => report.buildReport([{ ...ev('x', 'claude', [P], [F]), runtime: 'cursor' }])).toThrow(/unknown runtime "cursor"/);
  });

  test('report from committed baselines: rows carry the stored granularity; a corrupt file is an error', () => {
    const dir = fs.mkdtempSync(path.join(os.homedir(), '.omp', 'trd-skills-eval', 'rep-'));
    try {
      const ctx = { skillHash: 'a'.repeat(64), packageHash: 'd'.repeat(64), skillVersion: null, evalVersion: 'b'.repeat(64), model: 'm' };
      const done = (rt) => ev('alpha', rt, [P, P, P, P, P], [F, F, F, F, F]);
      for (const rt of ['claude', 'pi']) results.writeBaseline(dir, results.toBaselineSummary(done(rt), ctx));
      const rep = report.buildReportFromBaselines(dir);
      expect(rep.rows.map((r) => [r.runtime, r.granularity, r.label])).toEqual([
        ['claude', 'package', 'package-level (skills share a package)'], ['pi', 'skill', 'skill-level'],
      ]);
      fs.writeFileSync(path.join(dir, 'pi', 'alpha.json'), '{bad');
      expect(() => report.buildReportFromBaselines(dir)).toThrow(/alpha\.json: not valid JSON/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('uplift label when the with-skill arm adds a package (sharedPackages)', () => {
  const shared = (skill, runtime = 'claude') => arms.summarizeEval({ id: `${skill}-eval`, skill, package: 'development', sharedPackages: ['git'], invocation: 'explicit-both' }, { repeats: 5, bar: 4, repeatsSource: 't', barSource: 't' },
    { 'with-skill': mkRuns('with-skill', runtime, [P, P, P, P, P]), baseline: mkRuns('baseline', runtime, [F, F, F, F, F]) }, { runtime });
  test('the report row and text say what the with-skill arm adds; an eval without sharedPackages keeps the plain label', () => {
    const e = shared('trace');
    expect(e.upliftLabel).toBe('package-level (with-skill adds development)');
    expect(report.buildReport([e]).rows[0].label).toBe('package-level (with-skill adds development)');
    expect(text([e])).toMatch(/uplift \+1\.00 \(package-level \(with-skill adds development\)\)/);
    expect(text([ev('plain', 'claude', [P, P, P, P, P], [F, F, F, F, F])])).toMatch(/\(package-level \(skills share a package\)\)/);
  });
  test('a committed baseline keeps the label: withSkillAdds is stored, validated, and reported', () => {
    const ctx = { skillHash: 'h', packageHash: 'p', skillVersion: null, evalVersion: 'v', model: 'm' };
    const b = results.toBaselineSummary(shared('trace'), ctx);
    expect(b.withSkillAdds).toEqual(['development']);
    expect(report.rowFromBaseline(b).label).toBe('package-level (with-skill adds development)');
    expect(() => results.validateBaseline({ ...b, withSkillAdds: ['../x'] }, 't')).toThrow(/withSkillAdds/);
    expect(() => results.validateBaseline({ ...b, withSkillAdds: [] }, 't')).toThrow(/withSkillAdds/);
    const plain = results.toBaselineSummary(ev('plain', 'claude', [P, P, P, P, P], [F, F, F, F, F]), ctx);
    expect(plain).not.toHaveProperty('withSkillAdds');
    expect(report.rowFromBaseline(plain).label).toBe('package-level (skills share a package)');
  });
});

