#!/usr/bin/env node
'use strict';

/**
 * Recall guard for a review run (kata yg7k): scores the findings a run reported against a REFERENCE SET of Important findings
 * somebody already confirmed on the same head, and answers "which known Important findings did this run lose?". Plan section 5:
 * a faster run that loses a real Important finding is a regression, so a re-measurement needs one number it can be compared by.
 *
 * It complements `review-eval-guard.js` rather than replacing it. That guard grades cases that an owner confirmed on the BASE branch
 * and matches by LOCATION alone; this one needs only a reference file and a run's ledger (no git, no CODEOWNERS), and it can match a
 * finding that names the right defect in another file, which a location-only match misses (the PR 207 reference defect was raised
 * in three files).
 *
 * REFERENCE (JSON): `{ pr, headSha, items: [ { id, summary, anchors?, terms? } ] }`
 *   - `anchors`: `[ { path, startLine, endLine } ]`; a finding is anchored when its `path:line` falls in a range (plus `slack` lines).
 *   - `terms`: `[ [ "word", "word" ], ... ]`; a finding names the defect when its `failureMode` (and `evidence`, when the ledger carries
 *     it) holds EVERY word of at least one inner list, compared lower case and as whole words ("slow-mo" is not in "slow-motion").
 *   An item must give at least one of the two. When it gives both, a finding must satisfy both: anchors alone say only "something
 *   Important sits near here", terms alone say "somebody described this", and an item that wants either may simply give one.
 *
 * FINDINGS (JSON): an array, or an object holding the array as `ledger` or `findings`. Each entry has `locationOrLink`, `severity`,
 * `failureMode`. Severity is read as the review reads it (`normalizeSeverity`: Critical and Major are Important).
 *
 * VERDICT PER ITEM, in the direction that costs the run the benefit of the doubt:
 *   - `found`        an Important finding matches;
 *   - `downgraded`   the defect was raised but only as a Nit, Pre-existing or an unreadable severity: the review would defer it, so for
 *                    the guard it is lost, and it is reported apart because the cause is different (grading, not reading);
 *   - `not-raised`   no finding matches.
 * `falseNegativeRate` = (downgraded + not-raised) / items; `notRaisedRate` is the part of it nobody raised at all. `unmatchedImportant` lists the Important findings that match no item (a run that
 * inflates its Important findings raises no false-negative rate: read this beside it). Findings that state a `headSha` different from the
 * reference's are refused (`head-mismatch`), and the reference should be read from the checkout that runs the guard, never from the reviewed head. The guard FAILS (exit 1)
 * when `falseNegativeRate` exceeds `--max-false-negative` (default 0: any lost Important finding fails). Unreadable input is exit 2 and
 * never a pass: an empty reference, a duplicate id, an item with neither anchors nor terms, findings that are not a list.
 *
 * It grades only; it runs no model and reads two files. A match is by anchor and wording, not by understanding: a finding that happens to
 * use the words is counted, and a correct finding that paraphrases them is not, so the reference's `terms` should be words only the defect
 * uses (an item may carry a `note` saying why), several phrasings are listed, and `matchedBy` in the output is to be read, not trusted.
 *
 * Usage: node review-recall-guard.js --reference <file> --findings <file> [--max-false-negative <0..1>] [--slack <n>]
 */

const fs = require('fs');
const { normalizeSeverity } = require('./pr-review-ledger');

const DEFAULT_SLACK = 3;
const DEFAULT_MAX_FALSE_NEGATIVE = 0;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isLine = (value) => Number.isInteger(value) && value >= 1;

/** `path:line` or `path:start-end` -> { path, start, end }, or null. */
function parseLocation(text) {
  if (!isText(text)) return null;
  const match = /^(.+?):(\d+)(?:-(\d+))?(?::\d+)?$/.exec(text.trim());
  if (match === null) return null;
  const start = Number(match[2]);
  const end = match[3] === undefined ? start : Number(match[3]);
  return start >= 1 && end >= start ? { path: match[1], start, end } : null;
}

/** The reference, validated: `{ ok: true, items }` or `{ ok: false, error }`. */
function readReference(reference) {
  if (!isObject(reference) || !Array.isArray(reference.items) || reference.items.length === 0) {
    return { ok: false, error: 'reference-empty: the reference needs a non-empty `items` list' };
  }
  const seen = new Set();
  for (const item of reference.items) {
    if (!isObject(item) || !isText(item.id)) return { ok: false, error: 'reference-item-invalid: every item needs an `id`' };
    if (seen.has(item.id)) return { ok: false, error: `reference-duplicate-id: ${item.id}` };
    seen.add(item.id);
    const anchors = item.anchors === undefined ? [] : item.anchors;
    const terms = item.terms === undefined ? [] : item.terms;
    const anchorsOk = Array.isArray(anchors) && anchors.every((a) => isObject(a) && isText(a.path) && isLine(a.startLine) && isLine(a.endLine) && a.endLine >= a.startLine);
    const termsOk = Array.isArray(terms) && terms.every((set) => Array.isArray(set) && set.length > 0 && set.every(isText));
    if (!anchorsOk || !termsOk) return { ok: false, error: `reference-item-invalid: ${item.id} has unreadable anchors or terms` };
    if (anchors.length === 0 && terms.length === 0) return { ok: false, error: `reference-item-unmatchable: ${item.id} needs anchors or terms` };
  }
  return { ok: true, items: reference.items.map((item) => ({ id: item.id, summary: item.summary || '', anchors: item.anchors || [], terms: item.terms || [] })) };
}

/** The finding list inside what a run left: an array, or `{ ledger }` / `{ findings }`. Null when there is none. */
function findingList(input) {
  if (Array.isArray(input)) return input;
  if (isObject(input) && Array.isArray(input.ledger)) return input.ledger;
  if (isObject(input) && Array.isArray(input.findings)) return input.findings;
  return null;
}

/** `word` in `text` as a whole word: not inside a longer one ("slow-mo" is not in "slow-motion"). Both are lower case already or lowered here. */
function hasWord(text, word) {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(text);
}

function matches(item, finding, slack) {
  const where = parseLocation(finding.locationOrLink);
  if (item.anchors.length > 0) {
    const anchored = where !== null && item.anchors.some((a) => a.path === where.path && where.start <= a.endLine + slack && where.end >= a.startLine - slack);
    if (!anchored) return false;
  }
  if (item.terms.length > 0) {
    const text = `${isText(finding.failureMode) ? finding.failureMode : ''}\n${isText(finding.evidence) ? finding.evidence : ''}`.toLowerCase();
    if (!item.terms.some((set) => set.every((word) => hasWord(text, word)))) return false;
  }
  return true;
}

/**
 * Scores `findings` against `reference`. Pure.
 * @returns {{ok:boolean, error?:string, pass?:boolean, items?:Object[], counts?:Object, falseNegativeRate?:number, notRaisedRate?:number}}
 */
function scoreRecall({ reference, findings, slack = DEFAULT_SLACK, maxFalseNegative = DEFAULT_MAX_FALSE_NEGATIVE }) {
  const ref = readReference(reference);
  if (!ref.ok) return { ok: false, pass: false, error: ref.error };
  const list = findingList(findings);
  if (list === null) return { ok: false, pass: false, error: 'findings-unreadable: expected an array, or an object with `ledger` or `findings`' };
  if (!Number.isInteger(slack) || slack < 0) return { ok: false, pass: false, error: 'slack-invalid: a whole number of lines, 0 or more' };
  if (typeof maxFalseNegative !== 'number' || !(maxFalseNegative >= 0 && maxFalseNegative <= 1)) return { ok: false, pass: false, error: 'max-false-negative-invalid: a number from 0 to 1' };

  // the findings of another head say nothing about this reference: fail closed rather than score them
  const stated = isObject(findings) && isText(findings.headSha) ? findings.headSha.trim() : null;
  if (stated !== null && isText(reference.headSha) && stated !== reference.headSha.trim()) {
    return { ok: false, pass: false, error: `head-mismatch: the findings are of ${stated}, the reference is of ${reference.headSha.trim()}` };
  }

  const entries = list.filter(isObject);
  const items = ref.items.map((item) => {
    const hits = entries.filter((finding) => matches(item, finding, slack));
    const important = hits.filter((finding) => normalizeSeverity(finding.severity) === 'important');
    const status = important.length > 0 ? 'found' : hits.length > 0 ? 'downgraded' : 'not-raised';
    const best = important[0] || hits[0];
    return {
      id: item.id,
      summary: item.summary,
      status,
      matchedBy: hits.map((finding) => ({ id: finding.id === undefined ? null : finding.id, severity: finding.severity === undefined ? null : finding.severity, locationOrLink: finding.locationOrLink === undefined ? null : finding.locationOrLink })),
      ...(best === undefined ? {} : { best: best.id === undefined ? null : best.id }),
    };
  });
  // Important findings that match no reference item: over-inflation (many Important findings, few of them real) is invisible to the rate, so it is counted
  const matched = new Set(items.flatMap((item) => item.matchedBy.map((m) => m.id)));
  const unmatchedImportant = entries.filter((finding) => normalizeSeverity(finding.severity) === 'important' && !matched.has(finding.id === undefined ? null : finding.id)).map((finding) => ({ id: finding.id === undefined ? null : finding.id, locationOrLink: finding.locationOrLink === undefined ? null : finding.locationOrLink }));
  const counts = { items: items.length, found: 0, downgraded: 0, 'not-raised': 0 };
  for (const item of items) counts[item.status] += 1;
  const falseNegativeRate = (counts.downgraded + counts['not-raised']) / counts.items;
  const notRaisedRate = counts['not-raised'] / counts.items;
  return { ok: true, pass: falseNegativeRate <= maxFalseNegative, maxFalseNegative, items, counts, falseNegativeRate, notRaisedRate, unmatchedImportant };
}

/** A flag's number: an empty or non-numeric string is NaN (refused later), never 0. */
const number = (value) => (/^\s*[+-]?(?:\d+\.?\d*|\.\d+)\s*$/.test(value) ? Number(value) : NaN);

function parseArgs(argv) {
  const options = { slack: DEFAULT_SLACK, maxFalseNegative: DEFAULT_MAX_FALSE_NEGATIVE };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) return { error: `${flag} needs a value` };
    if (flag === '--reference') options.reference = value;
    else if (flag === '--findings') options.findings = value;
    else if (flag === '--slack') options.slack = number(value);
    else if (flag === '--max-false-negative') options.maxFalseNegative = number(value);
    else return { error: `unknown argument ${flag}` };
  }
  if (!isText(options.reference) || !isText(options.findings)) return { error: '--reference and --findings are required' };
  return { options };
}

/** Reads both files and scores; the exit code is 0 pass, 1 recall lost, 2 unreadable. */
function main(argv, deps = {}) {
  const read = deps.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const out = deps.write || ((text) => process.stdout.write(text));
  const parsed = parseArgs(Array.isArray(argv) ? argv : []);
  const fail = (error) => {
    out(`${JSON.stringify({ ok: false, pass: false, error })}\n`);
    return 2;
  };
  if (parsed.error) return fail(parsed.error);
  let reference;
  let findings;
  try {
    reference = JSON.parse(read(parsed.options.reference));
    findings = JSON.parse(read(parsed.options.findings));
  } catch (error) {
    return fail(`input-unreadable: ${error.message}`);
  }
  const result = scoreRecall({ reference, findings, slack: parsed.options.slack, maxFalseNegative: parsed.options.maxFalseNegative });
  out(`${JSON.stringify(result)}\n`);
  return result.ok ? (result.pass ? 0 : 1) : 2;
}

module.exports = { scoreRecall, readReference, findingList, parseLocation, main, DEFAULT_SLACK, DEFAULT_MAX_FALSE_NEGATIVE };

if (require.main === module) process.exit(main(process.argv.slice(2)));
