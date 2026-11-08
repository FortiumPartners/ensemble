'use strict';

/**
 * pr-review-delta.js -- plans a delta re-review: what to read after a fix push (kata 801a;
 * docs/plans/pr-review-speedup-plan.md section 3B).
 *
 * `chooseReviewRange` already says WHETHER the commits since the last review can be vouched for.
 * This module answers the second question, WHAT a reviewer must read when they can: the delta
 * itself plus its blast radius (the importers and tests of the files the delta changed). It never
 * widens a `full` range into a delta, and it falls back to `full` on anything it cannot vouch for.
 *
 * Pure: NO shell, NO file reads, NO network. The repo scans that produce the import graph and the
 * name lines live in pr-review-prepare.js (this module consumes their output), exactly as `paths`
 * consumes the caller-read CODEOWNERS text.
 *
 * FAIL CLOSED to `{ mode:'full' }` -- every applicable reason is listed, none is dropped -- when:
 *   - the range decision is not a readable `delta` (a `full` range stays full; its reason is kept);
 *   - the last reviewed head is not on record as reviewed: `reviewed.headSha`, the `reviewedHeadSha` the review state
 *     recorded for a COMPLETED round, is missing or is not `delta.lastReviewedSha`. A commit the repository merely
 *     holds is not a head anyone reviewed, so the caller reads this from the state, never from git;
 *   - the base the last round reviewed against is not on record, or is not the base this delta is planned against
 *     (`reviewed.baseSha` is missing or is not `delta.baseSha`: a retargeted PR, a moved stacked-phase parent). The delta is
 *     only what changed since the last reviewed head; against another base the PR changes paths no round ever read;
 *   - the delta changes no path (nothing can justify reading nothing);
 *   - a changed path is classified High or sensitive, or is a review-declaration file, or the
 *     classification is unreadable or does not cover every changed path;
 *   - the import graph is missing or unreadable (no blast radius means no justified read set);
 *   - the graph lists files with a computed require/import and the name lines needed to place them are missing or
 *     unreadable;
 *   - the delta changes a file the planner can read neither as code the graph analyzes nor as documentation or data.
 * Otherwise `{ mode:'delta', readSet }`, the read set being every changed path plus
 *   - the files that reference one (`caller-of`) and the tests that reference one or carry its name (`test-of`; a
 *     jest snapshot is matched to the test that owns it);
 *   - the files whose references the graph cannot resolve (a `require` of a computed or interpolated specifier, an
 *     argument on the next line) and whose text names a changed file (`names`). That is an over-approximation by name:
 *     a reviewer reads more, never less. A computed specifier that names nothing is the one thing this cannot see.
 */

const { isObjectId } = require('./pr-review-scope');
const {
  isImportGraph, targetKeys, ownerStemOf, testStemOf, namesFile, ANALYZED_EXTENSIONS, TEST_FILE,
} = require('./pr-review-import-graph');

/**
 * Files that hold no code: documentation, data and assets. A delta may change these and the code the graph analyzes
 * (ANALYZED_EXTENSIONS) and still be sized; ANY OTHER file type is source in a language the planner cannot size, so the
 * answer is `full`. An allowlist: a type nobody listed fails closed instead of counting as harmless.
 */
const INERT_EXTENSIONS = Object.freeze([
  '.md', '.mdx', '.markdown', '.txt', '.rst', '.json', '.jsonc', '.jsonl', '.yaml', '.yml', '.toml', '.lock', '.map', '.snap',
  '.csv', '.tsv', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf',
]);
/** Dotfiles that hold configuration, not code (their "extension" is their whole name). */
const INERT_NAMES = Object.freeze(['.gitignore', '.gitattributes', '.gitkeep', '.npmignore', '.npmrc', '.editorconfig']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
/** Two full object ids naming the same object (hex is case-insensitive); anything else is never the same. */
const sameObjectId = (a, b) => isObjectId(a) && isObjectId(b) && a.toLowerCase() === b.toLowerCase();

/** True when the planner can size a change to this file: code the graph analyzes, or documentation, data and assets. */
function isSizeable(file) {
  const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot) : '';
  return ANALYZED_EXTENSIONS.includes(extension) || INERT_EXTENSIONS.includes(extension) || INERT_NAMES.includes(name);
}

const isNameLine = (line) => isObject(line) && isText(line.path) && typeof line.text === 'string';

function full(reasons) {
  return { mode: 'full', reasons, readSet: [] };
}

/**
 * @param {Object} input
 * @param {Object} input.delta  The `chooseReviewRange` answer: `{ ok:true, mode, baseSha, lastReviewedSha, headSha, reason }`.
 * @param {string[]} input.changedPaths  The paths changed in `lastReviewedSha..headSha` (not the whole PR).
 * @param {Object} input.pathsClassification  The `classifyPaths` answer for (at least) those paths.
 * @param {{headSha?:string, baseSha?:string}} [input.reviewed]  What the review-state report of the last COMPLETED round
 *   recorded: its `reviewedHeadSha` and `baseSha` (the resolved base it reviewed against). Absent, or a head that is not
 *   `delta.lastReviewedSha`, the head was never seen; a base that is not `delta.baseSha` is a base that moved: both `full`.
 * @param {Object} [input.importGraph]  `buildImportGraph` output for the head.
 * @param {Array<{path:string, text:string}>} [input.nameLines]  The lines of the files `importGraph.computed` lists that
 *   mention a changed file's name (`mentionNeedles`); required only when that list is not empty.
 * @returns {{mode:'delta'|'full', reasons:string[], readSet:Array<{path:string, reasons:string[]}>}}
 */
function planDeltaReview(input) {
  const request = isObject(input) ? input : {};
  const { delta, changedPaths, pathsClassification, reviewed, importGraph, nameLines } = request;
  const reasons = [];

  // ---- the range decision: only a readable delta can be refined, a full range is never overridden ----
  if (!isObject(delta) || delta.ok !== true || (delta.mode !== 'delta' && delta.mode !== 'full')) {
    return full(['delta-unreadable']);
  }
  if (delta.mode === 'full') {
    return full(['range-is-full', ...(isText(delta.reason) ? [delta.reason] : [])]);
  }
  if (!isObjectId(delta.lastReviewedSha) || !isObjectId(delta.headSha)) reasons.push('delta-unreadable');

  if (!isObject(reviewed) || !sameObjectId(reviewed.headSha, delta.lastReviewedSha)) reasons.push('head-never-seen');

  // The delta is `lastReviewedSha..headSha`, whatever the base: against a base the last round did not review, the PR changes
  // other paths than the ones that round read (a retarget adds the new base's own history to the PR's diff).
  const reviewedBase = isObject(reviewed) ? reviewed.baseSha : undefined;
  if (!isObjectId(reviewedBase)) reasons.push('reviewed-base-unknown');
  else if (!sameObjectId(reviewedBase, delta.baseSha)) reasons.push('base-moved');

  // ---- the changed paths ----
  const pathsReadable = Array.isArray(changedPaths) && changedPaths.every(isText);
  if (!pathsReadable) {
    reasons.push('changed-paths-unreadable');
  } else if (changedPaths.length === 0) {
    reasons.push('empty-delta');
  }

  // ---- classification: High, sensitive and declaration files always get the full read ----
  if (!isObject(pathsClassification) || pathsClassification.ok !== true || !Array.isArray(pathsClassification.paths)) {
    reasons.push('classification-unreadable');
  } else if (pathsReadable) {
    const byPath = new Map();
    for (const entry of pathsClassification.paths) if (isObject(entry) && isText(entry.path)) byPath.set(entry.path, entry);
    if (changedPaths.some((file) => !byPath.has(file))) reasons.push('classification-incomplete');
    const touched = changedPaths.map((file) => byPath.get(file)).filter((entry) => entry !== undefined);
    if (touched.some((entry) => entry.high === true)) reasons.push('high-path-touched');
    if (touched.some((entry) => entry.sensitive === true || entry.declarationFile === true)) reasons.push('sensitive-path-touched');
  }

  // ---- the import graph, and the name lines that place the files it could not read ----
  let graphOk = false;
  if (importGraph === undefined || importGraph === null) reasons.push('import-graph-unavailable');
  else if (!isImportGraph(importGraph)) reasons.push('import-graph-unreadable');
  else graphOk = true;

  const needsNames = graphOk && importGraph.computed.length > 0;
  if (needsNames && (nameLines === undefined || nameLines === null)) reasons.push('name-scan-unavailable');
  else if (needsNames && !(Array.isArray(nameLines) && nameLines.every(isNameLine))) reasons.push('name-scan-unreadable');

  if (pathsReadable && !changedPaths.every(isSizeable)) {
    reasons.push('unanalyzed-source-changed');
  }

  if (reasons.length > 0 || !graphOk) return full([...new Set(reasons)]);

  // ---- the blast radius: changed files, their importers, their tests ----
  const readSet = new Map();
  const add = (file, why) => {
    if (!readSet.has(file)) readSet.set(file, new Set());
    readSet.get(file).add(why);
  };
  const testsByStem = new Map();
  for (const test of importGraph.testFiles) {
    const stem = testStemOf(test);
    if (!testsByStem.has(stem)) testsByStem.set(stem, []);
    testsByStem.get(stem).push(test);
  }
  const computed = new Set(importGraph.computed);

  for (const file of changedPaths) {
    add(file, 'changed');
    for (const key of targetKeys(file)) {
      if (!Object.prototype.hasOwnProperty.call(importGraph.importers, key)) continue;
      for (const importer of importGraph.importers[key]) {
        add(importer, TEST_FILE.test(importer) ? `test-of:${file}` : `caller-of:${file}`);
      }
    }
    if (!TEST_FILE.test(file)) {
      for (const test of testsByStem.get(ownerStemOf(file)) || []) add(test, `test-of:${file}`);
    }
    // A file with a computed specifier is a possible caller of anything; it is read when its own text names this file.
    if (needsNames) {
      for (const line of nameLines) {
        if (computed.has(line.path) && line.path !== file && namesFile(line.text, file)) add(line.path, `names:${file}`);
      }
    }
  }

  return {
    mode: 'delta',
    reasons: [isText(delta.reason) ? delta.reason : 'delta-since-last-review'],
    readSet: [...readSet.keys()].sort().map((file) => ({ path: file, reasons: [...readSet.get(file)].sort() })),
  };
}

module.exports = { planDeltaReview, isSizeable };
