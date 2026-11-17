'use strict';

/** TRD-019-TEST: like-for-like comparison and regression detection (evals/compare.js, evals/lib/compare.js). Read-only; stub claude only. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const results = require('../lib/results');
const cmp = require('../lib/compare');
const { createSuite, SKILL } = require('./stub-suite');

const FIVE = ['--repeats', '5', '--concurrency', '1', '--model', 'claude-stub-1'];
const THREE = ['--repeats', '3', '--concurrency', '1', '--model', 'claude-stub-1'];
const BASELINE = () => t.sub('baselines', 'claude', `${SKILL}.json`);
const readBaseline = () => JSON.parse(fs.readFileSync(BASELINE(), 'utf8'));
const writeBaseline = (over) => fs.writeFileSync(BASELINE(), JSON.stringify({ ...readBaseline(), ...over }));

let t;
beforeEach(() => { t = createSuite(); });
afterEach(() => t.cleanup());

describe('score change shown (AC-016-1)', () => {
  test('a baseline with the same model, runtime and eval version: the change in score is reported', () => {
    expect(t.run(FIVE).status).toBe(0);
    // The committed summary says 4 of 5 with-skill passes (bar 4, still reliable): the new result is 5 of 5.
    writeBaseline({ withSkill: { passes: 4, runs: 5 }, uplift: 4 / 5 - 0, baseline: { passes: 0, runs: 5 } });
    const r = t.compare();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`skill ${SKILL} eval ${SKILL} [claude]: comparable, no regression`);
    expect(r.stdout).toMatch(/change in score vs committed: with-skill rate 0\.80 -> 1\.00 \(\+0\.20\)/);
    expect(r.stdout).toMatch(/change in uplift: 0\.80 -> 1\.00 \(\+0\.20\)/);
  });

  test('a changed skill or package hash does not make the result not-comparable: it is a note, and a below-bar result is then a regression (the gate can fail on a defective skill)', () => {
    expect(t.run(FIVE).status).toBe(0);
    writeBaseline({ skillHash: 'e'.repeat(64), packageHash: 'f'.repeat(64) });
    const same = t.compare();
    expect(same.status).toBe(0);
    expect(same.stdout).toMatch(/note: skill content changed since the committed summary/);
    expect(same.stdout).toMatch(/note: package content changed/);
    expect(t.run(FIVE.concat('--refresh'), { passSeq: [true, true, true, false, false] }).status).toBe(1);
    const bad = t.compare();
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/REGRESSION skill ensemble-create-prd eval ensemble-create-prd \[claude\]/);
  });
});

describe('nothing comparable, no regression (AC-016-2)', () => {
  test('no committed baseline: nothing comparable, no regression claimed, exit 0', () => {
    expect(t.run(THREE).status).toBe(0);
    fs.rmSync(t.sub('baselines'), { recursive: true });
    const r = t.compare();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NOTHING COMPARABLE skill ensemble-create-prd/);
    expect(r.stdout).toMatch(/no regression is claimed/);
    expect(r.stdout).not.toMatch(/REGRESSION|comparable, no regression/);
    expect(fs.existsSync(t.sub('baselines'))).toBe(false); // read-only: nothing created
  });

  test.each([
    ['eval version', { evalVersion: '9'.repeat(64) }, /evalVersion differs/],
    ['model', { model: 'claude-other-9' }, /model differs/],
    ['repeats', { repeats: 5, bar: 4, withSkill: { passes: 5, runs: 5 }, baseline: { passes: 0, runs: 5 }, uplift: 1 }, /repeats differs/],
  ])('a baseline with a different %s: not comparable, no regression claimed, exit unchanged (0), says so', (name, over, reason) => {
    expect(t.run(THREE).status).toBe(0);
    // A below-bar new result against an otherwise reliable baseline must still not be called a regression.
    writeBaseline(over);
    const r = t.compare();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NOT COMPARABLE skill ensemble-create-prd/);
    expect(r.stdout).toMatch(reason);
    expect(r.stdout).toMatch(/nothing comparable with the committed baseline, no regression is claimed/);
    expect(r.stdout).not.toMatch(/REGRESSION|change in score/);
  });

  test('a baseline recorded under a different runtime (pi) is not compared to a claude run: nothing comparable, no regression claimed, exit 0 (AC-016-2)', () => {
    expect(t.run(THREE).status).toBe(0);
    // Move the (valid, reliable, same model and eval version) summary under baselines/pi: the claude directory is now empty.
    const claude = readBaseline();
    expect(claude).toMatchObject({ reliable: true, model: 'claude-stub-1', runtime: 'claude' });
    fs.mkdirSync(t.sub('baselines', 'pi'));
    fs.writeFileSync(t.sub('baselines', 'pi', `${SKILL}.json`), JSON.stringify({ ...claude, runtime: 'pi', granularity: 'skill' }));
    fs.rmSync(BASELINE());
    // A below-bar new result must not be called a regression against it either.
    const bad = t.run([...THREE, '--refresh'], { passSeq: [true, false, false] });
    expect(bad.status).toBe(1); // the eval itself fails; no regression against another runtime's baseline
    expect(bad.stderr).not.toMatch(/REGRESSION/);
    fs.rmSync(BASELINE(), { force: true });
    const r = t.compare();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NOTHING COMPARABLE skill ensemble-create-prd eval ensemble-create-prd \[claude\]/);
    expect(r.stdout).toMatch(/no regression is claimed/);
    expect(r.stdout).not.toMatch(/REGRESSION|comparable, no regression|change in score/);
  });

  test('a different eval version with a failing new result still claims no regression (the claim needs a like-for-like baseline)', () => {
    expect(t.run(FIVE).status).toBe(0);
    writeBaseline({ evalVersion: '9'.repeat(64) });
    // run.js: the eval itself fails (3 of 5 under bar 4: exit 1) but the baseline is not like-for-like, so no regression is claimed.
    const run = t.run([...FIVE, '--refresh'], { passSeq: [true, true, true, false, false] });
    expect(run.status).toBe(1);
    expect(run.stderr).not.toMatch(/REGRESSION/);
    const r = t.compare();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NOT COMPARABLE/);
    expect(r.stdout).not.toMatch(/REGRESSION/);
  });

  test('an unknown model is never comparable, even to a committed unknown', () => {
    expect(t.run(THREE, { model: null }).status).toBe(0);
    expect(fs.existsSync(BASELINE())).toBe(false); // an unknown-model summary is not written by run.js
    expect(t.run(THREE).status).toBe(0); // a known-model baseline now exists
    expect(t.run([...THREE, '--refresh'], { model: null }).status).toBe(0);
    const r = t.compare();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NOT COMPARABLE/);
    expect(r.stdout).toMatch(/model is unknown/);
    writeBaseline({ model: 'unknown' });
    const both = t.compare();
    expect(both.stdout).toMatch(/model is unknown: an unknown model is not comparable to anything, itself included/);
  });
});

describe('reliable to unreliable fails (AC-018-1)', () => {
  test('a reliable baseline and a 3-of-5 result: the check fails (exit 1) naming the skill and the eval', () => {
    expect(t.run(FIVE).status).toBe(0);
    expect(readBaseline()).toMatchObject({ reliable: true, repeats: 5, bar: 4 });
    const bad = t.run([...FIVE, '--refresh'], { passSeq: [true, false, true, false, true] });
    expect(bad.status).toBe(1); // run.js itself also reports it
    const r = t.compare();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/REGRESSION skill ensemble-create-prd eval ensemble-create-prd \[claude\]: was reliable \(5\/5, bar 4\), now 3\/5/);
    expect(r.stderr).toMatch(/1 regression\(s\): ensemble-create-prd\/ensemble-create-prd/);
    expect(r.stdout).toMatch(/change in score vs committed: with-skill rate 1\.00 -> 0\.60 \(-0\.40\)/);
  });

  test('a still-reliable result with a lower score passes and reports the change; the check can fail (the same log against an unreliable result fails)', () => {
    expect(t.run(FIVE).status).toBe(0);
    const committed = fs.readFileSync(BASELINE(), 'utf8');
    expect(t.run([...FIVE, '--refresh'], { passSeq: [true, true, true, true, false] }).status).toBe(0);
    fs.writeFileSync(BASELINE(), committed); // run.js rewrote the summary (the result was ok); compare against the earlier committed one
    const ok = t.compare();
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/rate 1\.00 -> 0\.80 \(-0\.20\)/);
    const doc = JSON.parse(fs.readFileSync(path.join(t.sub('results'), fs.readdirSync(t.sub('results'))[0]), 'utf8'));
    // Same log with the arm counts below the bar: now it must fail.
    doc.results[0].withSkill.passes = 3;
    doc.results[0].reliable = false;
    doc.results[0].uplift = 3 / 5;
    fs.writeFileSync(t.sub('edited.json'), JSON.stringify(doc));
    expect(t.compare(['--results', t.sub('edited.json')]).status).toBe(1);
  });
});

describe('incomplete and not-comparable do not pass silently (AC-018-3)', () => {
  const incompleteRun = () => {
    expect(t.run(THREE).status).toBe(0);
    // A cap that fits one run leaves the rest unstarted: the eval is incomplete.
    const r = t.run([...THREE, '--refresh', '--max-usd', '0.01', '--run-usd', '0.01']);
    expect(r.status).toBe(4);
  };

  test('an incomplete result exits 4 and is named, not scored; a baseline is not needed to say so', () => {
    incompleteRun();
    const r = t.compare();
    expect(r.status).toBe(4);
    expect(r.stdout).toMatch(/INCOMPLETE skill ensemble-create-prd eval ensemble-create-prd \[claude\]: .*not compared, not a pass/);
    fs.rmSync(t.sub('baselines'), { recursive: true });
    const noBase = t.compare();
    expect(noBase.status).toBe(4); // "nothing comparable" must not hide an incomplete result
    expect(noBase.stdout).toMatch(/INCOMPLETE/);
    expect(noBase.stdout).not.toMatch(/NOTHING COMPARABLE/);
  });

  test('a not-comparable result prints a notice; both outcomes in one suite: incomplete outranks nothing, regression outranks incomplete', () => {
    expect(cmp.exitCode({ storeErrors: [], entries: [{ status: 'incomplete' }, { status: 'regression' }] })).toBe(1);
    expect(cmp.exitCode({ storeErrors: ['x'], entries: [{ status: 'regression' }] })).toBe(2);
    expect(cmp.exitCode({ storeErrors: [], entries: [{ status: 'not-comparable' }, { status: 'ok' }, { status: 'no-baseline' }] })).toBe(0);
    expect(cmp.exitCode({ storeErrors: [], entries: [{ status: 'not-comparable' }, { status: 'incomplete' }] })).toBe(4);
    expect(cmp.exitCode({ storeErrors: [], entries: [] })).toBe(4); // nothing compared is never a pass
  });

  test('a log without the stored records an eval needs, or whose counts disagree, is incomplete', () => {
    expect(t.run(THREE).status).toBe(0);
    const doc = JSON.parse(fs.readFileSync(path.join(t.sub('results'), fs.readdirSync(t.sub('results'))[0]), 'utf8'));
    fs.writeFileSync(t.sub('no-records.json'), JSON.stringify({ ...doc, records: [] }));
    const none = t.compare(['--results', t.sub('no-records.json')]);
    expect(none.status).toBe(4);
    expect(none.stdout).toMatch(/no stored records/);
    fs.writeFileSync(t.sub('short.json'), JSON.stringify({ ...doc, records: doc.records.slice(1) }));
    expect(t.compare(['--results', t.sub('short.json')]).status).toBe(4);
    const noCopy = { ...doc, results: [{ ...doc.results[0], evaluatedCopy: null }] };
    fs.writeFileSync(t.sub('no-copy.json'), JSON.stringify(noCopy));
    const nc = t.compare(['--results', t.sub('no-copy.json')]);
    expect(nc.status).toBe(4);
    expect(nc.stdout).toMatch(/no evaluated copy/);
  });

  test('--skill that matches nothing compares nothing: exit 4, not 0', () => {
    expect(t.run(THREE).status).toBe(0);
    const r = t.compare(['--skill', 'no-such-skill']);
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/nothing was compared/);
  });
});

describe('store problems exit 2 and outrank everything', () => {
  test('a corrupt, symlinked or contradictory committed baseline', () => {
    expect(t.run(THREE).status).toBe(0);
    const goodBaseline = fs.readFileSync(BASELINE(), 'utf8');
    fs.writeFileSync(BASELINE(), '{ nope');
    const corrupt = t.compare();
    expect(corrupt.status).toBe(2);
    expect(corrupt.stdout).toMatch(/ERROR ensemble-create-prd \[claude\].*not valid JSON/);
    fs.writeFileSync(t.sub('real.json'), '{}');
    fs.rmSync(BASELINE());
    fs.symlinkSync(t.sub('real.json'), BASELINE());
    const link = t.compare();
    expect(link.status).toBe(2);
    expect(link.stdout).toMatch(/symlink/);
    fs.rmSync(BASELINE());
    fs.writeFileSync(BASELINE(), JSON.stringify({ ...JSON.parse(goodBaseline), reliable: false }));
    expect(t.compare().status).toBe(2); // reliable contradicts the counts
  });

  test('a symlinked baselines directory, a symlinked or special or oversize or malformed log, and a missing log', () => {
    expect(t.run(THREE).status).toBe(0);
    const log = path.join(t.sub('results'), fs.readdirSync(t.sub('results'))[0]);
    fs.renameSync(t.sub('baselines'), t.sub('real-baselines'));
    fs.symlinkSync(t.sub('real-baselines'), t.sub('baselines'));
    expect(t.compare().status).toBe(2);
    fs.rmSync(t.sub('baselines'));
    fs.renameSync(t.sub('real-baselines'), t.sub('baselines'));
    expect(t.compare().status).toBe(0);

    fs.symlinkSync(log, t.sub('linked.json'));
    const linked = t.compare(['--results', t.sub('linked.json')]);
    expect(linked.status).toBe(2);
    expect(linked.stderr).toMatch(/symlink/);
    expect(spawnSync('mkfifo', [t.sub('fifo.json')]).status).toBe(0);
    const fifo = t.compare(['--results', t.sub('fifo.json')]);
    expect(fifo.status).toBe(2); // not opened: no hang
    expect(fifo.stderr).toMatch(/not a regular file/);
    fs.writeFileSync(t.sub('big.json'), ' '.repeat(cmp.MAX_LOG_BYTES + 1));
    expect(t.compare(['--results', t.sub('big.json')]).stderr).toMatch(/larger than/);
    fs.writeFileSync(t.sub('junk.json'), '[1]');
    expect(t.compare(['--results', t.sub('junk.json')]).stderr).toMatch(/must be a JSON object/);
    fs.writeFileSync(t.sub('norec.json'), JSON.stringify({ results: [] }));
    expect(t.compare(['--results', t.sub('norec.json')]).stderr).toMatch(/no "records" array/);
    expect(t.compare(['--results', t.sub('absent.json')]).status).toBe(2);
    fs.rmSync(t.sub('results'), { recursive: true });
    expect(t.compare().stderr).toMatch(/no results directory/);
    expect(t.compare(['--bogus']).status).toBe(2);
    expect(t.compare(['--results']).status).toBe(2);
  });

  test('a malformed record in the log is named', () => {
    expect(t.run(THREE).status).toBe(0);
    const doc = JSON.parse(fs.readFileSync(path.join(t.sub('results'), fs.readdirSync(t.sub('results'))[0]), 'utf8'));
    doc.records[0].run = 'x';
    fs.writeFileSync(t.sub('bad-record.json'), JSON.stringify(doc));
    const r = t.compare(['--results', t.sub('bad-record.json')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/bad-record\.json records\[0\]: invalid field "run"/);
  });
});

describe('control characters from a committed baseline or a log never reach the console', () => {
  const ESC = '\u001b';
  test('a baseline whose recordedAt or model carries an escape sequence is rejected naming the file (exit 2), and no escape byte is printed', () => {
    expect(t.run(THREE).status).toBe(0);
    const good = readBaseline();
    for (const over of [{ recordedAt: `2020-01-01 (${ESC}]0;x\u0007)` }, { model: `claude-stub-1${ESC}[31m` }, { evalVersion: `${'a'.repeat(8)}${ESC}[2J` }]) {
      writeBaseline({ ...good, ...over });
      const r = t.compare();
      expect(r.status).toBe(2);
      expect(r.stdout).toMatch(/ERROR ensemble-create-prd \[claude\].*ensemble-create-prd\.json: invalid field "(recordedAt|model|evalVersion)"/);
      expect(r.stdout + r.stderr).not.toContain(ESC);
    }
    writeBaseline(good);
    expect(t.compare().status).toBe(0);
  });

  test('a log or baseline that is not JSON (the parser error quotes the input) prints no escape byte', () => {
    expect(t.run(THREE).status).toBe(0);
    fs.writeFileSync(t.sub('notjson.json'), `${ESC}]0;PWN\u0007 {`);
    const r = t.compare(['--results', t.sub('notjson.json')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/not valid JSON/);
    expect(r.stdout + r.stderr).not.toContain(ESC);
  });

  test('a log whose eval id contains ESC is rejected (exit 2) and prints no ESC; formatComparison also strips every printed value (defence in depth)', () => {
    expect(t.run(THREE).status).toBe(0);
    const doc = JSON.parse(fs.readFileSync(path.join(t.sub('results'), fs.readdirSync(t.sub('results'))[0]), 'utf8'));
    doc.results[0].id = `${SKILL}${ESC}]0;pwned\u0007`;
    fs.writeFileSync(t.sub('esc.json'), JSON.stringify(doc));
    const r = t.compare(['--results', t.sub('esc.json')]);
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).not.toContain(ESC);
    const text = cmp.formatComparison({
      storeErrors: [`x${ESC}[1m`],
      entries: [{ skill: SKILL, evalId: `e${ESC}]0;t\u0007v`, runtime: 'claude', status: 'regression', reasons: [`model differs (committed m${ESC}[2J)`], notes: [`n${ESC}[0m`], delta: null, committedAt: `2020${ESC}` }],
    });
    expect(text).toContain('e]0;tv');
    expect([...text].filter((ch) => ch !== '\n' && /\p{Cc}/u.test(ch))).toEqual([]);
  });
});

describe('the comparison is read-only and wired to an npm script', () => {
  test('it writes no baseline, cache entry or log, and uses the newest log by default', () => {
    expect(t.run(THREE).status).toBe(0);
    const snap = () => JSON.stringify([t.sub('baselines'), t.sub('cache'), t.sub('results')].map((d) => (fs.existsSync(d) ? walk(d) : null)));
    const before = snap();
    expect(t.compare().status).toBe(0);
    expect(snap()).toBe(before);
    expect(t.compare(['--json']).stdout).toMatch(/"status": "ok"/);
  });

  test('package.json has evals:compare running evals/compare.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
    expect(pkg.scripts['evals:compare']).toBe('node evals/compare.js');
  });

  test('compareSummaries is the single comparison rule (run.js and compare.js agree on the same pair)', () => {
    expect(typeof results.compareSummaries).toBe('function');
    expect(fs.readFileSync(path.join(__dirname, '../lib/compare.js'), 'utf8')).not.toMatch(/reliable\s*&&\s*!/); // no second copy of the rule
  });
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).map((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? [e.name, walk(p)] : [e.name, fs.statSync(p).mtimeMs, fs.readFileSync(p, 'utf8')];
  });
}
