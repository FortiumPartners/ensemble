'use strict';

/**
 * Like-for-like comparison of a finished suite log (evals/results/*.json) with the committed baselines (TRD-019).
 * The verdict comes from results.checkAgainstBaseline (which uses compareSummaries): this module only reads and validates the log,
 * rebuilds the context a summary needs, and formats. It is read-only: it never writes a baseline, a cache entry or a log.
 *
 * Per eval, one of:
 *   ok              comparable (same runtime, model, eval version and repeats) and not a regression: the change in score is reported
 *   regression      comparable, the committed summary was reliable and the new result is not: names skill and eval (exit 1)
 *   not-comparable  something differs, or a model is `unknown`: a notice, no regression is claimed (exit unchanged)
 *   no-baseline     nothing committed for the runtime and skill: "nothing comparable", no regression is claimed
 *   incomplete      the result cannot be scored (a run missing, unverifiable or aborted, or the log lacks the evidence): never a pass (exit 4)
 * Exit: 2 (log or baseline unreadable or malformed) outranks 1 (regression), which outranks 4 (incomplete); else 0.
 */

const fs = require('fs');
const path = require('path');
const results = require('./results');

class CompareError extends Error {
  constructor(message) { super(message); this.name = 'CompareError'; }
}

const MAX_LOG_BYTES = 64 * 1024 * 1024;

/** Newest regular `.json` log under `dir` (by modification time). A symlinked directory or entry, or no log at all, is a CompareError. */
function latestLog(dir) {
  const root = path.resolve(dir);
  if (!results.checkDir(root, 'results directory', CompareError)) throw new CompareError(`no results directory at ${path.basename(root)}: run the evals first`);
  let best = null;
  for (const name of fs.readdirSync(root).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(root, name);
    results.checkFile(file, CompareError, MAX_LOG_BYTES);
    const mtime = fs.lstatSync(file).mtimeMs;
    if (!best || mtime >= best.mtime) best = { file, mtime };
  }
  if (!best) throw new CompareError('no results log (*.json) in the results directory: run the evals first');
  return best.file;
}

/** Read and shape-check one suite log (never through a symlink, never a special file, size capped). */
function loadLog(file) {
  if (!results.checkFile(file, CompareError, MAX_LOG_BYTES)) throw new CompareError(`${path.basename(file)}: cannot read (ENOENT)`);
  const text = results.readStoreText(file, CompareError, MAX_LOG_BYTES);
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new CompareError(`${path.basename(file)}: not valid JSON (${e.message})`); }
  const bad = (m) => { throw new CompareError(`${path.basename(file)}: ${m}`); };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) bad('a results log must be a JSON object');
  if (!Array.isArray(doc.results)) bad('no "results" array');
  if (!Array.isArray(doc.records)) bad('no "records" array');
  doc.records.forEach((r, i) => results.validateResult(r, `${path.basename(file)} records[${i}]`));
  for (const [i, e] of doc.results.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) bad(`results[${i}] is not an object`);
    if (e.arms !== true) continue; // legacy single-arm scenarios and replays have no arms: nothing to compare
    if (!results.cleanId(e.id) || !results.isSkillName(e.skill)) bad(`results[${i}] has no valid id and skill`);
    results.assertRuntime(e.runtime, `results[${i}] runtime`);
    if (!Array.isArray(e.runs)) bad(`results[${i}] has no "runs" array`);
  }
  return doc;
}

/**
 * The summary context for one eval-level result, from the log alone: eval version and hashes from its stored records and
 * evaluated copy. Returns `{ ctx }` or `{ why }` when the log lacks what a summary needs (the eval is then incomplete).
 */
function contextFor(evalResult, records) {
  const mine = records.filter((r) => r.evalId === evalResult.id && r.skill === evalResult.skill && r.runtime === evalResult.runtime);
  if (!mine.length) return { why: 'the log has no stored records for this eval' };
  if (mine.length !== evalResult.runs.length) return { why: `the log has ${mine.length} stored record(s) for ${evalResult.runs.length} run(s)` };
  const one = (k) => { const v = new Set(mine.map((r) => r[k])); return v.size === 1 ? [...v][0] : undefined; };
  const evalVersion = one('evalVersion');
  const skillHash = one('skillHash');
  if (!evalVersion || !skillHash) return { why: 'the stored records disagree on eval version or skill hash' };
  const copy = evalResult.evaluatedCopy;
  const needsPackage = results.granularityFor(evalResult.runtime) === 'package';
  if (!copy || (needsPackage && typeof copy.packageHash !== 'string')) return { why: 'the log has no evaluated copy (package hash)' };
  return {
    ctx: {
      skillHash, evalVersion, packageHash: typeof copy.packageHash === 'string' ? copy.packageHash : undefined,
      skillVersion: one('skillVersion') === undefined ? null : one('skillVersion'), model: results.evalModel(evalResult.runs),
    },
  };
}

/**
 * Compare every skill eval in the log with the committed baselines under `baselinesDir`.
 * Returns { entries, storeErrors, skipped }; each entry { skill, evalId, runtime, status, reasons, notes, delta, committedAt }.
 */
function compareLog(doc, { baselinesDir, skill = null }) {
  const entries = [];
  const storeErrors = [];
  const evals = doc.results.filter((e) => e.arms === true && (!skill || e.skill === skill));
  for (const e of evals) {
    const base = { skill: e.skill, evalId: e.id, runtime: e.runtime };
    const { ctx, why } = contextFor(e, doc.records);
    if (!ctx) { entries.push({ ...base, status: 'incomplete', reasons: [why], notes: [] }); continue; }
    try {
      // An incomplete result is reported as such whether or not a baseline exists: "nothing comparable" must not hide it.
      try { results.toBaselineSummary(e, ctx); } catch (err) {
        if (!(err instanceof results.BaselineError)) throw err;
        entries.push({ ...base, status: 'incomplete', reasons: [err.message], notes: [] });
        continue;
      }
      const check = results.checkAgainstBaseline(baselinesDir, e, ctx);
      entries.push({ ...base, status: check.status, reasons: check.reasons, notes: check.notes || [], delta: check.delta || null, committedAt: check.committed ? check.committed.recordedAt : null });
    } catch (err) {
      if (!(err instanceof results.BaselineError || err instanceof results.ResultError)) throw err;
      storeErrors.push(`${e.skill} [${e.runtime}] (eval ${e.id}): ${err.message}`);
    }
  }
  return { entries, storeErrors, skipped: doc.results.length - evals.length };
}

const change = (c) => `${c.committed.toFixed(2)} -> ${c.current.toFixed(2)} (${c.change >= 0 ? '+' : ''}${c.change.toFixed(2)})`;

/** Report text: one block per eval. Not-comparable and nothing-comparable are said in words and never as a pass. */
function formatComparison(cmp) {
  const out = [];
  // Every value read from a log or a committed baseline is stripped of terminal control characters (and kept on one line) before it is printed.
  const s = (v) => results.stripControl(v).replace(/[\n\t]/g, ' ');
  for (const e0 of cmp.entries) {
    const e = { ...e0, skill: s(e0.skill), evalId: s(e0.evalId), runtime: s(e0.runtime), reasons: e0.reasons.map(s), notes: e0.notes.map(s), committedAt: e0.committedAt == null ? e0.committedAt : s(e0.committedAt) };
    const head = `skill ${e.skill} eval ${e.evalId} [${e.runtime}]`;
    if (e.status === 'regression') out.push(`REGRESSION ${head}: ${e.reasons.join('; ')} (committed summary recorded ${e.committedAt})`);
    else if (e.status === 'ok') out.push(`${head}: comparable, no regression`);
    else if (e.status === 'not-comparable') out.push(`NOT COMPARABLE ${head}: ${e.reasons.join('; ')}; nothing comparable with the committed baseline, no regression is claimed`);
    else if (e.status === 'no-baseline') out.push(`NOTHING COMPARABLE ${head}: no committed baseline for this runtime and skill; no regression is claimed`);
    else out.push(`INCOMPLETE ${head}: ${e.reasons.join('; ')}; not compared, not a pass`);
    for (const n of e.notes) out.push(`  note: ${n}`);
    if (e.delta) {
      out.push(`  change in score vs committed: with-skill rate ${change(e.delta.withSkillRate)}`);
      out.push(`  change in uplift: ${change(e.delta.uplift)}`);
    }
  }
  for (const m of cmp.storeErrors) out.push(`ERROR ${s(m)}`);
  return out.join('\n');
}

/** 2 outranks 1 outranks 4; zero evals compared is 4 (a check that compared nothing must not read as a pass). */
function exitCode(cmp) {
  if (cmp.storeErrors.length) return 2;
  if (cmp.entries.some((e) => e.status === 'regression')) return 1;
  if (!cmp.entries.length || cmp.entries.some((e) => e.status === 'incomplete')) return 4;
  return 0;
}

module.exports = { CompareError, MAX_LOG_BYTES, latestLog, loadLog, contextFor, compareLog, formatComparison, exitCode };
