'use strict';

/** TRD-018-TEST: result cache. Every scenario runs run.js against a stub claude that logs each call; no real model. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const cache = require('../lib/cache');
const results = require('../lib/results');
const { createSuite } = require('./stub-suite');

const MODEL_ARGS = ['--repeats', '2', '--concurrency', '1', '--model', 'claude-stub-1'];

let t;
beforeEach(() => { t = createSuite(); });
afterEach(() => t.cleanup());

describe('unchanged inputs reuse the result (AC-011-1)', () => {
  test('a stub that fails if called is never called, the suite passes, and the reuse costs nothing', () => {
    const first = t.run();
    expect(first.status).toBe(0);
    expect(t.calls()).toHaveLength(4); // 2 repeats x 2 arms
    expect(t.entries()).toHaveLength(4);
    t.resetCalls();
    const second = t.run(MODEL_ARGS, { die: true });
    expect(second.status).toBe(0);
    expect(t.calls()).toEqual([]); // the stub was never called
    expect(second.stdout).toMatch(/cache: 4 run\(s\) reused, 0 executed/);
    expect(second.stdout).toMatch(/reusing stored result for ensemble-create-prd/);
    const doc = second.doc();
    expect(doc.totalCostUsd).toBe(0);
    expect(doc.records).toHaveLength(4);
    expect(doc.records.every((r) => r.cached === true && r.costUsd === 0 && r.outcome !== 'incomplete')).toBe(true);
    expect(doc.results[0]).toMatchObject({ outcome: 'pass', reliable: true, withSkill: { passes: 2, runs: 2 } });
  });

  test('the check can fail: under --refresh the same stub IS called (the marker appears)', () => {
    expect(t.run().status).toBe(0);
    t.resetCalls();
    const r = t.run([...MODEL_ARGS, '--refresh'], { die: true });
    expect(t.calls().length).toBeGreaterThan(0);
    expect(r.stdout).not.toMatch(/reusing stored result/);
  });

  test('a reused result does not count against the suite cap: a cap of one run budget still passes four reused runs, and with --refresh the same cap leaves runs unstarted', () => {
    expect(t.run([...MODEL_ARGS, '--run-usd', '0.01']).status).toBe(0);
    t.resetCalls();
    const capped = t.run([...MODEL_ARGS, '--max-usd', '0.01', '--run-usd', '0.01'], { die: true });
    expect(capped.status).toBe(0);
    expect(t.calls()).toEqual([]);
    expect(capped.doc().totalCostUsd).toBe(0);
    expect(capped.doc().peakCommittedUsd).toBe(0); // reused runs reserve nothing either
    const forced = t.run([...MODEL_ARGS, '--max-usd', '0.01', '--run-usd', '0.01', '--refresh']);
    expect(forced.status).toBe(4); // the cap is reached before a run starts: incomplete, never a pass
  });

  test('without --model nothing is reused or stored, and the notice says why', () => {
    const first = t.run(['--repeats', '2', '--concurrency', '1']);
    expect(first.stdout).toMatch(/cache: not used \(no --model given/);
    expect(t.entries()).toEqual([]);
    expect(fs.existsSync(t.sub('cache'))).toBe(false);
    t.resetCalls();
    t.run(['--repeats', '2', '--concurrency', '1']);
    expect(t.calls()).toHaveLength(4);
  });
});

describe('changed input reruns (AC-011-2)', () => {
  const rerunsWith = (args, opts) => {
    expect(t.run().status).toBe(0);
    t.resetCalls();
    t.run(args, opts);
    return t.calls().length;
  };

  test('an edited eval (prompt) reruns every run of the eval', () => {
    expect(t.run().status).toBe(0);
    t.resetCalls();
    const def = JSON.parse(fs.readFileSync(t.evalJsonPath, 'utf8'));
    fs.writeFileSync(t.evalJsonPath, JSON.stringify({ ...def, prompt: 'Write a longer summary of the repo' }));
    const r = t.run();
    expect(r.status).toBe(0);
    expect(t.calls()).toHaveLength(4);
    expect(r.stdout).not.toMatch(/reusing stored result/);
  });

  test('an edited fixture reruns', () => {
    expect(t.run().status).toBe(0);
    t.resetCalls();
    fs.appendFileSync(t.sub('skills', 'ensemble-create-prd', 'fixture', 'seed.txt'), 'more\n');
    t.run();
    expect(t.calls()).toHaveLength(4);
  });

  test('a different model reruns; the original model is still reused afterwards', () => {
    expect(rerunsWith(['--repeats', '2', '--concurrency', '1', '--model', 'claude-other-2'], { model: 'claude-other-2' })).toBe(4);
    t.resetCalls();
    t.run(MODEL_ARGS, { die: true });
    expect(t.calls()).toEqual([]);
  });

  test('a different timeout or per-run budget reruns (settings that change the run are part of the key)', () => {
    expect(rerunsWith([...MODEL_ARGS, '--timeout', '600'])).toBe(4);
    t.resetCalls();
    t.run([...MODEL_ARGS, '--run-usd', '3']);
    expect(t.calls()).toHaveLength(4);
  });

  test('more repeats run only the new repeat indexes: the stored ones are reused', () => {
    expect(t.run().status).toBe(0);
    t.resetCalls();
    const r = t.run(['--repeats', '3', '--concurrency', '1', '--model', 'claude-stub-1']);
    expect(t.calls()).toHaveLength(2); // run 3 of each arm
    expect(r.stdout).toMatch(/cache: 4 run\(s\) reused, 2 executed/);
  });

  test('every key field changes the key (skill hash, package hash, eval version, model, runtime, arm, mode, repeat, settings, judge)', () => {
    const ev = { id: 'e', skill: 'ensemble-create-prd', invocation: 'plain', maxTurns: 5, allowedTools: ['Read'] };
    const base = { ev, arm: 'with-skill', run: 1, runtime: 'claude', requestedModel: 'm', copy: { skillHash: 'a', packageHash: 'p' }, evalVersion: 'v', timeoutMs: 1000, runUsd: 1, judgeModel: null };
    const key = (over) => cache.keyOf(cache.keyInputs({ ...base, ...over }));
    const k0 = key({});
    expect(key({})).toBe(k0);
    const variants = {
      skillHash: { copy: { skillHash: 'b', packageHash: 'p' } },
      packageHash: { copy: { skillHash: 'a', packageHash: 'q' } },
      evalVersion: { evalVersion: 'w' },
      model: { requestedModel: 'n' },
      runtime: { runtime: 'pi' },
      arm: { arm: 'baseline' },
      mode: { ev: { ...ev, invocation: 'explicit' } },
      run: { run: 2 },
      maxTurns: { ev: { ...ev, maxTurns: 6 } },
      allowedTools: { ev: { ...ev, allowedTools: ['Read', 'Bash'] } },
      timeout: { timeoutMs: 2000 },
      runUsd: { runUsd: 2 },
      judge: { judgeModel: 'j' },
      evalId: { ev: { ...ev, id: 'f' } },
    };
    for (const [name, over] of Object.entries(variants)) expect({ name, same: key(over) === k0 }).toEqual({ name, same: false });
    // The package hash is a Claude input only; for Pi (skill-level) it is not part of the key.
    expect(cache.keyInputs({ ...base, runtime: 'pi' }).packageHash).toBeNull();
    expect(key({ runtime: 'pi', copy: { skillHash: 'a', packageHash: 'zzz' } })).toBe(key({ runtime: 'pi' }));
    // The judge model only matters for the with-skill arm.
    expect(key({ arm: 'baseline', judgeModel: 'j' })).toBe(key({ arm: 'baseline' }));
  });
});

describe('no age limit, refresh forces (AC-011-3)', () => {
  test('a result stored a year ago is reused; --refresh runs fresh and rewrites the entries', () => {
    expect(t.run().status).toBe(0);
    const yearAgo = new Date(Date.now() - 366 * 24 * 3600 * 1000).toISOString();
    for (const { file, entry } of t.entries()) fs.writeFileSync(file, JSON.stringify({ ...entry, storedAt: yearAgo }));
    t.resetCalls();
    const reused = t.run(MODEL_ARGS, { die: true });
    expect(reused.status).toBe(0);
    expect(t.calls()).toEqual([]);
    expect(reused.stdout).toContain(`stored ${yearAgo}`);
    const fresh = t.run([...MODEL_ARGS, '--refresh']);
    expect(fresh.status).toBe(0);
    expect(t.calls()).toHaveLength(4);
    expect(t.entries().every(({ entry }) => entry.storedAt !== yearAgo)).toBe(true);
  });
});

describe('what is never reused, and untrusted entries', () => {
  const tamper = (fn) => {
    expect(t.run().status).toBe(0);
    t.entries().forEach((e, i) => fn(e, i));
    t.resetCalls();
  };
  const rewrite = ({ file, entry }, over) => fs.writeFileSync(file, JSON.stringify({ ...entry, ...over }));

  test('a timed-out, incomplete, unknown-model, estimated-cost or invalid stored record is a miss with a warning, never a crash or a pass', () => {
    const bads = [
      (e) => ({ record: { ...e.entry.record, outcome: 'timed_out' } }),
      (e) => ({ record: { ...e.entry.record, outcome: 'incomplete', incompleteReason: 'aborted' } }),
      (e) => ({ record: { ...e.entry.record, model: 'unknown' } }),
      (e) => ({ record: { ...e.entry.record, costEstimated: true } }),
      (e) => ({ record: { ...e.entry.record, run: 'x' } }), // fails validateResult
      (e) => ({ record: { ...e.entry.record, skillHash: 'f'.repeat(64) } }), // does not match the key
      (e) => ({ record: Object.fromEntries(Object.entries(e.entry.record).filter(([k]) => k !== 'graders')) }), // a required field missing
      (e) => ({ inputs: { ...e.entry.inputs, timeoutMs: 1 } }), // stored inputs differ from the requested ones
      () => ({ key: 'a'.repeat(64) }),
      () => ({ format: 99 }),
    ];
    for (const bad of bads) {
      tamper((e) => rewrite(e, bad(e)));
      const r = t.run(MODEL_ARGS);
      expect(r.status).toBe(0);
      expect(t.calls()).toHaveLength(4); // every entry was a miss: the runs executed
      expect(r.stderr).toMatch(/WARNING cache entry [0-9a-f]{64}\.json ignored/);
      expect(r.stdout).not.toMatch(/reusing stored result/);
      t.cleanup();
      t = createSuite();
    }
  });

  test('a baseline-arm entry without clean isolation evidence is a miss (the check runs again on read)', () => {
    tamper((e) => { if (e.entry.record.arm === 'baseline') rewrite(e, { isolation: null }); });
    const r = t.run(MODEL_ARGS);
    expect(r.stderr).toMatch(/isolation evidence missing or not clean/);
    expect(t.calls().filter((c) => c === 'baseline')).toHaveLength(2); // the baseline runs executed; the with-skill ones were reused
    expect(t.calls().filter((c) => c === 'with-skill')).toHaveLength(0);
    t.cleanup();
    t = createSuite();
    tamper((e) => { if (e.entry.record.arm === 'baseline') rewrite(e, { isolation: { ...e.entry.isolation, loadedSkills: ['ensemble-product:ensemble-create-prd'] } }); });
    const leaked = t.run(MODEL_ARGS);
    expect(leaked.stderr).toMatch(/isolation evidence missing or not clean/);
    expect(t.calls().filter((c) => c === 'baseline')).toHaveLength(2);
    t.cleanup();
    t = createSuite();
    // An empty skill list read from no startup event is not a verified-empty list: a miss.
    tamper((e) => { if (e.entry.record.arm === 'baseline') rewrite(e, { isolation: { ...e.entry.isolation, loadedSource: null } }); });
    expect(t.run(MODEL_ARGS).stderr).toMatch(/isolation evidence missing or not clean/);
    expect(t.calls().filter((c) => c === 'baseline')).toHaveLength(2);
  });

  test('corrupt JSON, an oversize file, a symlinked entry and a FIFO are misses with a warning; the FIFO is not opened (no hang)', () => {
    tamper((e, n) => {
      if (n === 0) fs.writeFileSync(e.file, '{ not json');
      else if (n === 1) fs.writeFileSync(e.file, ' '.repeat(cache.MAX_ENTRY_BYTES + 10));
      else if (n === 2) { const real = `${e.file}.real`; fs.renameSync(e.file, real); fs.symlinkSync(real, e.file); }
      else { fs.rmSync(e.file); expect(spawnSync('mkfifo', [e.file]).status).toBe(0); }
    });
    const r = t.run(MODEL_ARGS);
    // Each entry was a miss and the run executed. The fresh result then cannot replace a symlink, a FIFO or an oversize file (never
    // written through or over one): that is a store problem, exit 2 with the file named, and it outranks the passing eval. A small
    // corrupt regular file is simply replaced.
    expect(r.status).toBe(2);
    expect(r.stderr.match(/CACHE NOT WRITTEN/g)).toHaveLength(3);
    expect(t.calls()).toHaveLength(4);
    expect(r.stderr.match(/WARNING cache entry/g)).toHaveLength(4);
    expect(r.stderr).toMatch(/not valid JSON/);
    expect(r.stderr).toMatch(/larger than/);
    expect(r.stderr).toMatch(/symlink/);
    expect(r.stderr).toMatch(/not a regular file/);
  });

  test('a stored detail with terminal control characters is cleaned on reuse; a hostile replay command in the stored record never reaches the report', () => {
    tamper((e) => {
      const rec = e.entry.record;
      rewrite(e, { record: { ...rec, graders: rec.graders.map((g) => ({ ...g, detail: `ok\u001b[31m red` })), replay: { ...rec.replay, command: "node evals/run.js --scenario 'x'; touch /tmp/pwned" } } });
    });
    const r = t.run(MODEL_ARGS, { die: true });
    expect(r.status).toBe(0);
    expect(t.calls()).toEqual([]);
    expect(r.stdout).not.toContain('\u001b');
    const doc = r.doc();
    expect(JSON.stringify(doc.records)).not.toMatch(/pwned/);
  });

  test('a failing (not timed-out) run is reusable: a stored fail is reproduced without a call', () => {
    expect(t.run(MODEL_ARGS, { pass: false }).status).toBe(1);
    t.resetCalls();
    const again = t.run(MODEL_ARGS, { pass: true, die: true });
    expect(t.calls()).toEqual([]);
    expect(again.status).toBe(1); // the stored fail is what comes back until --refresh
    expect(again.stdout).toMatch(/NOT reliable/);
  });

  test('uncacheableReason: timed out, unverifiable, aborted, leak, unknown model, estimated or missing cost are never stored', () => {
    const ev = { id: 'e', skill: 'ensemble-create-prd', package: 'product', invocation: 'plain' };
    const rec = (over = {}) => ({ outcome: 'pass', model: 'm', arm: 'with-skill', costUsd: 0.1, ...over });
    expect(cache.uncacheableReason({}, rec(), ev, 'claude')).toBeNull();
    expect(cache.uncacheableReason({}, rec({ outcome: 'fail' }), ev, 'claude')).toBeNull();
    for (const outcome of ['timed_out', 'incomplete']) expect(cache.uncacheableReason({}, rec({ outcome }), ev, 'claude')).toMatch(/not reusable/);
    expect(cache.uncacheableReason({ leak: 'x' }, rec(), ev, 'claude')).toMatch(/flagged/);
    expect(cache.uncacheableReason({ unverifiable: 'x' }, rec(), ev, 'claude')).toMatch(/flagged/);
    expect(cache.uncacheableReason({}, rec({ model: 'unknown' }), ev, 'claude')).toMatch(/no model/);
    expect(cache.uncacheableReason({}, rec({ costEstimated: true }), ev, 'claude')).toMatch(/no cost/);
    expect(cache.uncacheableReason({}, rec({ costUsd: null }), ev, 'claude')).toMatch(/no cost/);
    expect(cache.uncacheableReason({ loadedSource: undefined }, rec({ arm: 'baseline' }), ev, 'claude', { repoRoot: t.root })).toMatch(/isolation/);
  });

  test('a run that times out or leaks is never stored (the stub is the same each time, so a hit would hide the problem)', () => {
    const leaked = t.run(MODEL_ARGS, { leak: true });
    expect(leaked.status).toBe(1);
    expect(t.entries()).toEqual([]); // an aborted (leaked) eval stores nothing
    const timed = t.run(['--repeats', '1', '--concurrency', '1', '--model', 'claude-stub-1', '--timeout', '1'], { hang: true });
    expect(timed.status).toBe(1);
    expect(timed.stdout).toMatch(/TIMED_OUT/);
    expect(t.entries()).toEqual([]); // timed-out and unverifiable runs are never stored
  });
});

describe('the cache is a store: symlinks and special files are refused (exit 2, nothing run)', () => {
  test('a symlinked cache root', () => {
    fs.mkdirSync(t.sub('elsewhere'), { recursive: true });
    fs.symlinkSync(t.sub('elsewhere'), t.sub('cache'));
    const r = t.run();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/cache root is a symlink/);
    expect(t.calls()).toEqual([]);
    expect(fs.readdirSync(t.sub('elsewhere'))).toEqual([]);
  });

  test('a symlinked runtime directory and a non-directory root', () => {
    fs.mkdirSync(t.sub('cache'), { recursive: true });
    fs.mkdirSync(t.sub('elsewhere'), { recursive: true });
    fs.symlinkSync(t.sub('elsewhere'), t.sub('cache', 'claude'));
    const r = t.run();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/cache claude directory is a symlink/);
    expect(t.calls()).toEqual([]);
    fs.rmSync(t.sub('cache'), { recursive: true, force: true });
    fs.writeFileSync(t.sub('cache'), 'x');
    const r2 = t.run();
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/cache root is not a directory/);
  });

  test('a symlink swapped in for an entry at write time is refused, not followed (store error, exit 2)', () => {
    expect(t.run().status).toBe(0);
    const [{ file }] = t.entries();
    const target = t.sub('victim.json');
    fs.writeFileSync(target, 'precious');
    fs.rmSync(file);
    fs.symlinkSync(target, file);
    const r = t.run([...MODEL_ARGS, '--refresh']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/CACHE NOT WRITTEN/);
    expect(fs.readFileSync(target, 'utf8')).toBe('precious');
  });

  test('the cache is written atomically through validated paths: entries are plain files under <runtime>/<sha256>.json, no temp files left', () => {
    expect(t.run().status).toBe(0);
    const dir = t.sub('cache', 'claude');
    expect(fs.readdirSync(dir).every((n) => /^[0-9a-f]{64}\.json$/.test(n))).toBe(true);
    for (const { file, entry } of t.entries()) {
      expect(fs.lstatSync(file).isFile()).toBe(true);
      expect(cache.keyOf(entry.inputs)).toBe(entry.key);
      expect(() => results.validateResult(entry.record)).not.toThrow();
      expect(JSON.stringify(entry)).not.toContain(process.env.HOME);
    }
  });
});

describe('a regression is not locked in as the reusable answer', () => {
  test('with --refresh, a regressing result writes no cache entry (unchanged bytes); --update-baselines accepts it', () => {
    expect(t.run().status).toBe(0);
    const before = t.entries().map((e) => fs.readFileSync(e.file, 'utf8'));
    const r = t.run([...MODEL_ARGS, '--refresh'], { pass: false });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/cache: results of this eval not stored/);
    expect(t.entries().map((e) => fs.readFileSync(e.file, 'utf8'))).toEqual(before);
    const accepted = t.run([...MODEL_ARGS, '--refresh', '--update-baselines'], { pass: false });
    expect(accepted.status).toBe(1);
    expect(t.entries().some((e) => e.entry.record.outcome === 'fail')).toBe(true);
  });
});

describe('an edited skill or package runs the affected eval again (TRD-018-TEST, end to end through run.js)', () => {
  // run.js reads the packages from EVALS_REPO_ROOT: a scratch copy, so the real packages/ is never edited.
  const SKILL_MD = (pkg) => path.join(pkg, 'skills', 'ensemble-create-prd', 'SKILL.md');

  test('unchanged scratch package: still a hit (no call); editing SKILL.md: the stub is called again for every run', () => {
    const pkg = t.useScratchRepo();
    expect(t.run().status).toBe(0);
    expect(t.calls()).toHaveLength(4);
    t.resetCalls();
    const same = t.run(MODEL_ARGS, { die: true });
    expect(same.stdout).toMatch(/cache: 4 run\(s\) reused, 0 executed/);
    expect(t.calls()).toEqual([]);
    fs.appendFileSync(SKILL_MD(pkg), '\nAn edited instruction.\n');
    t.resetCalls();
    const edited = t.run(MODEL_ARGS);
    expect(edited.status).toBe(0);
    expect(edited.stdout).toMatch(/cache: 0 run\(s\) reused, 4 executed/);
    expect(t.calls()).toHaveLength(4);
    expect(edited.doc().records.every((r) => r.cached !== true)).toBe(true);
  });

  test('a sibling file in the package (outside skills/<skill>) re-runs the Claude eval: the package is what Claude loads', () => {
    const pkg = t.useScratchRepo();
    expect(t.run().status).toBe(0);
    fs.appendFileSync(path.join(pkg, 'README.md'), '\nA sibling change.\n');
    t.resetCalls();
    const r = t.run(MODEL_ARGS);
    expect(r.status).toBe(0);
    expect(t.calls()).toHaveLength(4);
    expect(r.stdout).toMatch(/cache: 0 run\(s\) reused, 4 executed/);
  });

  test('EVALS_REPO_ROOT must be an existing directory containing packages/', () => {
    const missing = t.run(MODEL_ARGS, { env: { EVALS_REPO_ROOT: t.sub('nope') } });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/EVALS_REPO_ROOT must be an existing directory containing packages/);
    fs.mkdirSync(t.sub('empty'));
    expect(t.run(MODEL_ARGS, { env: { EVALS_REPO_ROOT: t.sub('empty') } }).status).toBe(2);
    expect(t.calls()).toEqual([]);
  });
});

describe('control characters in a stored timestamp or identifier (terminal injection)', () => {
  test('a cache entry whose storedAt carries an escape sequence (Date.parse accepts it) is a miss with a WARNING, and no escape byte is printed', () => {
    expect(t.run().status).toBe(0);
    const evil = '2020-01-01 (\u001b]0;x\u0007)';
    expect(Number.isNaN(Date.parse(evil))).toBe(false); // the premise: the old check let it through
    for (const { file, entry } of t.entries()) fs.writeFileSync(file, JSON.stringify({ ...entry, storedAt: evil }));
    t.resetCalls();
    const r = t.run(MODEL_ARGS);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING cache entry .*\.json ignored \(a miss, the run executes\): invalid storedAt/);
    expect(t.calls()).toHaveLength(4); // executed, not reused
    expect(r.stdout + r.stderr).not.toContain('\u001b');
    expect(r.stdout + r.stderr).not.toContain('\u0007');
  });

  test('a cache entry that is not JSON (the parser error quotes the input) is a miss and prints no escape byte', () => {
    expect(t.run().status).toBe(0);
    for (const { file } of t.entries()) fs.writeFileSync(file, '\u001b]0;PWN\u0007 {');
    t.resetCalls();
    const r = t.run(MODEL_ARGS);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/WARNING cache entry .*not valid JSON/);
    expect(t.calls()).toHaveLength(4);
    expect(r.stdout + r.stderr).not.toContain('\u001b');
    expect(r.stdout + r.stderr).not.toContain('\u0007');
  });

  test('storedAt must be an ISO-8601 UTC timestamp; a model with a control character in a stored record is a miss', () => {
    expect(results.isIsoTimestamp(new Date().toISOString())).toBe(true);
    expect(results.isIsoTimestamp('2020-01-01T00:00:00Z')).toBe(true);
    for (const v of ['2020-01-01', '2020-01-01T00:00:00+02:00', '2020-13-01T00:00:00Z', 'x2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z\u001b', 5, null]) expect(results.isIsoTimestamp(v)).toBe(false);
    expect(t.run().status).toBe(0);
    for (const { file, entry } of t.entries()) fs.writeFileSync(file, JSON.stringify({ ...entry, record: { ...entry.record, model: 'claude\u001b[2Jstub' } }));
    t.resetCalls();
    const r = t.run(MODEL_ARGS);
    expect(r.stderr).toMatch(/WARNING cache entry .*invalid field "model"/);
    expect(t.calls()).toHaveLength(4);
  });
});
