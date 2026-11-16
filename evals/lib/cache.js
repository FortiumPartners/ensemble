'use strict';

/**
 * Result cache (TRD-018): a finished per-run result is reused, with no model call and no cost against the suite cap, when
 * every input that can change the outcome is the same. The cache directory is a store like the baselines: a symlinked root,
 * runtime directory or entry is refused, a FIFO is never opened, reads are size capped and writes go through a temp file and
 * an atomic rename. Entries are untrusted input when read back: every field is validated, and anything wrong is a MISS (with
 * a warning naming the file), never a crash and never a pass.
 *
 *   <cacheDir>/<runtime>/<sha256 of the key inputs>.json  =  { format, key, inputs, storedAt, turns, isolation, record }
 *
 * Key inputs (`keyInputs`): runtime, the REQUESTED model (the reported model exists only after the call), eval id, skill,
 * eval version (hash of eval.json, rubric and fixture), skill hash and, for the package-level Claude runtime, the package hash,
 * arm, invocation mode, repeat index, `maxTurns`, `allowedTools`, the effective timeout and per-run budget, and the judge model
 * for the with-skill arm. The key is stored inside the entry and compared field by field on read; the file name is never trusted.
 * No age limit: `storedAt` is informational. `--refresh` skips reads and overwrites.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const results = require('./results');
const arms = require('./arms');

class CacheError extends Error {
  constructor(message) { super(message); this.name = 'CacheError'; }
}

const FORMAT = 1;
const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_GRADERS = 200;
const MAX_LIST = 500;
const MAX_STR = 4000;
const KEY_RE = /^[0-9a-f]{64}$/;
const CACHEABLE_OUTCOMES = ['pass', 'fail'];

/** JSON with sorted keys: the same inputs always give the same text. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * Everything that changes the outcome of one planned run.
 * ctx: { ev, arm, run, runtime, requestedModel, copy ({ skillHash, packageHash }), evalVersion, timeoutMs, runUsd, judgeModel (null when no judge runs) }
 */
function keyInputs(ctx) {
  const { ev, arm, run, runtime, requestedModel, copy, evalVersion, timeoutMs, runUsd, judgeModel } = ctx;
  return {
    format: FORMAT,
    runtime,
    requestedModel,
    evalId: ev.id,
    skill: ev.skill,
    evalVersion,
    skillHash: copy.skillHash,
    // Claude loads the whole package, so any file in it can change the outcome; Pi loads the single skill.
    packageHash: results.granularityFor(runtime) === 'package' ? copy.packageHash : null,
    arm,
    invocationMode: ev.invocation,
    run,
    maxTurns: ev.maxTurns === undefined ? null : ev.maxTurns,
    allowedTools: ev.allowedTools === undefined ? null : ev.allowedTools,
    timeoutMs,
    runUsd,
    judgeModel: arm === 'with-skill' && judgeModel ? judgeModel : null,
  };
}

const keyOf = (inputs) => crypto.createHash('sha256').update(stable(inputs)).digest('hex');

function entryFile(cacheDir, runtime, key) {
  results.assertRuntime(runtime);
  if (!KEY_RE.test(key)) throw new CacheError('invalid cache key');
  const root = path.resolve(cacheDir);
  return path.join(root, runtime, `${key}.json`);
}

/**
 * Verify the cache root and the runtime directory (when they exist). A symlink or a non-directory is a CacheError (a store
 * problem: exit 2). Returns false when nothing is stored yet.
 */
function checkStore(cacheDir, runtime) {
  results.assertRuntime(runtime);
  const root = path.resolve(cacheDir);
  if (!results.checkDir(root, 'cache root', CacheError)) return false;
  return results.checkDir(path.join(root, runtime), `cache ${runtime} directory`, CacheError);
}

const isStr = (v, max = MAX_STR) => typeof v === 'string' && v.length <= max;
const strList = (v) => Array.isArray(v) && v.length <= MAX_LIST && v.every((x) => isStr(x, 400));
// Terminal control characters (an escape sequence in a stored detail would be printed): dropped from reused text.
const { stripControl } = results;

/** The isolation evidence of a clean baseline run, as stored. */
function isolationOf(r) {
  return {
    loadedSkills: (r.loadedSkills || []).filter((s) => typeof s === 'string'),
    invokedSkills: (r.invokedSkills || []).filter((s) => typeof s === 'string'),
    loadedSource: typeof r.loadedSource === 'string' ? r.loadedSource : null,
  };
}

/** Whether stored isolation evidence still shows a clean baseline (the check run again on read: missing evidence is not clean). */
function isolationClean(ev, runtime, iso) {
  if (!iso || !strList(iso.loadedSkills) || !strList(iso.invokedSkills)) return false;
  if (!arms.VERIFIED_SOURCES.has(iso.loadedSource)) return false;
  if (iso.invokedSkills.some((s) => arms.skillMatches(s, ev.skill))) return false;
  if (iso.loadedSkills.some((s) => arms.skillMatches(s, ev.skill))) return false;
  if (runtime === 'pi' && iso.loadedSkills.length) return false; // Pi's baseline runs under --no-skills
  return true;
}

/**
 * Why a freshly executed run must not be stored, or null when it may be. `r` is the run result as run.js produced it,
 * `record` its stored form. Only a completed pass or fail with a known model, a reported cost and (baseline) verified
 * isolation is reusable: never an incomplete, timed-out, unverifiable, aborted, leak-flagged or estimated-cost run.
 */
function uncacheableReason(r, record, ev, runtime, { repoRoot } = {}) {
  if (!record || !CACHEABLE_OUTCOMES.includes(record.outcome)) return `outcome ${record ? record.outcome : 'unknown'} is not reusable`;
  if (r.leak || r.unverifiable) return 'the run was flagged (leak or unverifiable isolation)';
  if (record.model === results.UNKNOWN_MODEL) return 'the runtime reported no model id';
  if (record.costEstimated || record.costUsd === null) return 'the run reported no cost';
  if (record.arm === 'baseline') {
    const c = arms.checkBaseline(ev, { ...r, runtime }, { repoRoot });
    if (c) return 'baseline isolation could not be verified';
  }
  return null;
}

function buildEntry(inputs, record, r, storedAt = new Date().toISOString()) {
  return {
    format: FORMAT,
    key: keyOf(inputs),
    inputs,
    storedAt,
    turns: typeof r.turns === 'number' && Number.isFinite(r.turns) && r.turns >= 0 ? r.turns : null,
    isolation: record.arm === 'baseline' ? isolationOf(r) : null,
    record,
  };
}

/**
 * Write one entry (the record must already be sanitized). The directories are checked first (symlink or non-directory:
 * CacheError), the file is checked (never replace a symlink or a special file), then temp file + rename. Returns the path.
 */
function store(cacheDir, entry) {
  const inputs = entry.inputs;
  const file = entryFile(cacheDir, inputs.runtime, entry.key);
  if (keyOf(inputs) !== entry.key) throw new CacheError('entry key does not match its inputs');
  results.validateResult(entry.record, `cache entry ${entry.key.slice(0, 12)}`);
  const root = path.resolve(cacheDir);
  const dir = path.dirname(file);
  if (!results.checkDir(root, 'cache root', CacheError)) fs.mkdirSync(root, { recursive: true });
  results.checkDir(root, 'cache root', CacheError);
  if (!results.checkDir(dir, `cache ${inputs.runtime} directory`, CacheError)) fs.mkdirSync(dir);
  results.checkDir(dir, `cache ${inputs.runtime} directory`, CacheError);
  results.checkFile(file, CacheError, MAX_ENTRY_BYTES);
  results.atomicWrite(file, `${JSON.stringify(entry)}\n`, `cache-${entry.key.slice(0, 12)}`);
  return file;
}

/** Throw a plain Error naming the first bad field; callers turn it into a miss. */
function validateEntry(doc, inputs, key, ev) {
  const bad = (m) => { throw new Error(m); };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) bad('not a JSON object');
  if (doc.format !== FORMAT) bad('unknown format');
  if (doc.key !== key || !KEY_RE.test(String(doc.key))) bad('key does not match');
  if (stable(doc.inputs) !== stable(inputs)) bad('stored inputs differ from the requested ones');
  if (!isStr(doc.storedAt, 40) || !results.isIsoTimestamp(doc.storedAt)) bad('invalid storedAt');
  if (doc.turns !== null && !(typeof doc.turns === 'number' && Number.isFinite(doc.turns) && doc.turns >= 0)) bad('invalid turns');
  const rec = results.validateResult(doc.record, 'record');
  const same = { runtime: inputs.runtime, evalId: inputs.evalId, skill: inputs.skill, evalVersion: inputs.evalVersion, skillHash: inputs.skillHash, arm: inputs.arm, invocationMode: inputs.invocationMode, run: inputs.run };
  for (const [k, v] of Object.entries(same)) if (rec[k] !== v) bad(`record ${k} differs from the key`);
  if (!CACHEABLE_OUTCOMES.includes(rec.outcome)) bad(`outcome ${rec.outcome} is not reusable`);
  if (rec.model === results.UNKNOWN_MODEL || !isStr(rec.model, 200)) bad('record model is unknown');
  if (rec.costEstimated || rec.costUsd === null || rec.incompleteReason !== undefined || rec.cached) bad('record is not a clean, completed run');
  if (rec.durationMs === null) bad('record has no duration');
  if (rec.graders.length > MAX_GRADERS) bad('too many graders');
  for (const g of rec.graders) {
    if (!g || typeof g !== 'object' || !isStr(g.type, 100) || typeof g.pass !== 'boolean' || !isStr(g.detail === undefined ? '' : g.detail)) bad('invalid grader');
    if (g.score !== undefined && !(typeof g.score === 'number' && Number.isFinite(g.score))) bad('invalid grader score');
  }
  if (rec.arm === 'baseline') {
    if (!isolationClean(ev, inputs.runtime, doc.isolation)) bad('baseline isolation evidence missing or not clean');
  }
  return { rec, turns: doc.turns, storedAt: doc.storedAt };
}

/** The run result run.js works with, rebuilt from a validated stored record. Cost is 0: nothing was spent in this suite. */
function toRunResult(ev, validated) {
  const { rec, turns, storedAt } = validated;
  const graders = rec.graders.map((g) => ({
    type: stripControl(g.type), pass: g.pass, ...(g.judged && { judged: true }), ...(g.score !== undefined && { score: g.score }), detail: stripControl(g.detail === undefined ? '' : g.detail),
  }));
  const scores = graders.filter((g) => g.judged && typeof g.score === 'number').map((g) => g.score);
  return {
    id: ev.id, type: 'agent', skill: ev.skill, evalId: ev.id, arm: rec.arm, run: rec.run, runtime: rec.runtime, model: rec.model, invocationMode: rec.invocationMode,
    pass: rec.outcome === 'pass', outcome: rec.outcome, verdict: rec.outcome,
    invoked: rec.invoked === null ? undefined : rec.invoked,
    graders, judgedScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, judgeModel: rec.judgeModel,
    turns, costUsd: 0, durationMs: rec.durationMs, cached: true, cachedAt: storedAt, timedOut: false,
  };
}

/**
 * Look up one planned run. Returns `{ hit: <run result> }`, or `{ hit: null, why }` with `warning` when an entry exists but
 * cannot be trusted (unreadable, symlink, FIFO, oversize, not JSON, failing validation, key mismatch). A bad entry is a miss.
 * The directories were checked by `checkStore` at suite start; this function re-checks them and lets a CacheError escape
 * (a store problem), but anything about the entry itself is a miss.
 */
function lookup(cacheDir, inputs, ev) {
  const key = keyOf(inputs);
  const file = entryFile(cacheDir, inputs.runtime, key);
  if (!checkStore(cacheDir, inputs.runtime)) return { hit: null, why: 'empty cache' };
  const name = path.basename(file);
  try {
    if (!results.checkFile(file, CacheError, MAX_ENTRY_BYTES)) return { hit: null, why: 'no entry' };
    const text = results.readStoreText(file, CacheError, MAX_ENTRY_BYTES);
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error(`not valid JSON (${e.message})`); }
    return { hit: toRunResult(ev, validateEntry(doc, inputs, key, ev)), why: 'hit' };
  } catch (e) {
    return { hit: null, why: 'unusable entry', warning: `cache entry ${name} ignored (a miss, the run executes): ${String(e.message).slice(0, 200)}` };
  }
}

module.exports = {
  CacheError, FORMAT, MAX_ENTRY_BYTES, keyInputs, keyOf, entryFile, checkStore, uncacheableReason, buildEntry, store, lookup, isolationClean, validateEntry, stable,
};
