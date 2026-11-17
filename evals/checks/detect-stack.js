#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `detect-stack` skill eval (evals/skills/detect-stack). The agent is asked to detect the stack of the
 * seeded project and save it as docs/stack.json: { framework, test, tooling: [..], cloud }. The expected values are arguments of each
 * check (see eval.json), calibrated against the real detector on the fixture (evals/tests/skills/detect-stack.test.js runs it).
 * No check runs the detector or any workspace code; the JSON is parsed with JSON.parse (data only, bounded by lib's read cap).
 * None of these is flaky: each compares a normalised name or a file list.
 */

const { fail, clean, readText, walk, need, list, run } = require('./lib');

const STACK = 'docs/stack.json';

/** The parsed stack file: a JSON object (not an array, not null). */
function stack() {
  const text = readText(STACK);
  if (text === null) fail(`${STACK} was not written`);
  let data;
  try { data = JSON.parse(text); } catch (e) { return fail(`${STACK} is not valid JSON (${clean(e.message)})`); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) fail(`${STACK} is not a JSON object`);
  return data;
}

/** One technology name as a comparable token: lower case, `.js` and spaces dropped ("React.js" -> "react"). */
const norm = (s) => String(s).toLowerCase().trim().replace(/\.js$/, '').replace(/\s+/g, '');

/** The names an axis value holds: a string, or an array of strings / `{name}` objects, or one `{name}` object. null and "none" are no names. */
function names(v) {
  const one = (x) => {
    if (typeof x === 'string') return [x];
    if (x && typeof x === 'object' && typeof x.name === 'string') return [x.name];
    return [];
  };
  if (v === null || v === undefined) return [];
  const out = (Array.isArray(v) ? v.flatMap(one) : one(v)).map(norm).filter((n) => n && n !== 'none' && n !== 'null');
  return [...new Set(out)].sort();
}

/** The axis value for `key` or a failure when the key is missing. */
function axis(key) {
  const data = stack();
  if (!Object.prototype.hasOwnProperty.call(data, key)) fail(`${STACK} has no "${key}" key`);
  return names(data[key]);
}

const CHECKS = {
  // The file exists, parses and has the four axes (an empty run and a prose answer fail here).
  'stack-saved': () => {
    const data = stack();
    const missing = ['framework', 'test', 'tooling', 'cloud'].filter((k) => !Object.prototype.hasOwnProperty.call(data, k));
    if (missing.length) fail(`${STACK} lacks: ${missing.join(', ')}`);
    return `${STACK} has framework, test, tooling and cloud`;
  },
  // Single-valued axes must be exactly the expected name (a wrong guess or a list of candidates fails).
  'stack-framework': (o) => single('framework', need(o, 'expect')),
  'stack-test': (o) => single('test', need(o, 'expect')),
  'stack-cloud': (o) => single('cloud', need(o, 'expect')),
  // Tooling is a list: every expected tool present ...
  'tooling-detected': (o) => {
    const have = axis('tooling');
    const missing = list(need(o, 'expect')).map(norm).filter((n) => !have.includes(n));
    if (missing.length) fail(`tooling is [${have.map(clean).join(', ')}], missing ${missing.join(', ')}`);
    return `tooling includes ${o.expect}`;
  },
  // ... and nothing the project gives no evidence for (the detector reports no kubernetes, kustomize, argocd or flyio here).
  'tooling-no-extras': (o) => {
    const allowed = list(need(o, 'expect')).map(norm);
    const extra = axis('tooling').filter((n) => !allowed.includes(n));
    if (extra.length) fail(`tooling lists tools with no evidence in the project: ${extra.map(clean).join(', ')}`);
    return 'no unsupported tools listed';
  },
  // Nothing outside docs/ was written except the fixture's own files (--allow, comma-separated): a detection run changes no project file.
  'no-stray-files': (o) => {
    const allow = new Set(list(need(o, 'allow')));
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f) && !allow.has(f));
    if (extra.length) fail(`files written outside docs/: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files written outside docs/';
  },
};

function single(key, expect) {
  const have = axis(key);
  const want = norm(expect);
  if (have.length !== 1 || have[0] !== want) fail(`${key} is [${have.map(clean).join(', ') || 'empty'}], expected exactly ${want}`);
  return `${key} is ${want}`;
}

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
