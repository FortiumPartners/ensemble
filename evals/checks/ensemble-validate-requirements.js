#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-validate-requirements` eval. The skill writes no file (it prints `trd-cli validate`'s
 * report and sets an exit code), so the eval's prompt asks the run to save the report to --file; these checks read that file.
 * The seeded pair (fixture/docs/PRD + fixture/docs/TRD) has known defects and a known `trd-cli validate` answer:
 *   stats           tasks 4 (TRD-001, TRD-001-TEST, TRD-002, TRD-003; the heading-style `### TRD-004` is NOT a task), prdRequirements 3
 *   errors          ORPHANED_SATISFIES: TRD-003 satisfies REQ-009, which the PRD does not have  (so ok is false)
 *   warnings        UNCOVERED_REQUIREMENT REQ-003; MISSING_TEST_PAIR TRD-002 and TRD-003 (TRD-001 has TRD-001-TEST)
 * Matching is on ids (REQ-009, TRD-003, ...), not prose, so the CLI's raw JSON, a pretty-printed one and a prose or markdown report
 * all pass. Reads never follow symlinks; every regular expression is bounded (`{0,N}` gaps, no nested quantifiers) and no check
 * runs git or workspace code. FLAKY by construction (they judge free text with patterns): report-stats (a count written in an
 * unusual way is missed), report-warnings (a prose line that lists a good and a bad task together can be misread), report-verdict.
 * The others (report-saved, report-errors, docs-unchanged, no-impl-files) do not depend on how the report is phrased.
 */

const path = require('path');
const { clean, fail, readText, listFiles, walk, need, run } = require('./lib');

/** The report the run saved: non-empty text. */
function report(o) {
  const text = readText(need(o, 'file'));
  if (text === null) fail(`${clean(o.file)} was not written`);
  if (text.trim().length < 20) fail(`${clean(o.file)} is empty or has no report in it`);
  return text;
}

const SEP = '["\'\\s:=|*]{0,6}';
/** Every integer N written as the task count: `tasks: N`, `"tasks":N`, `| tasks | N |`, `Tasks parsed: N`, `N tasks`. `implTasks`/`testTasks` do not match (no word boundary). */
function taskCounts(text) {
  const out = [];
  const a = new RegExp(`\\btasks(?:\\s+parsed)?${SEP}(\\d{1,5})\\b`, 'gi');
  const b = /\b(\d{1,5})\s+(?:real\s+)?tasks\b/gi;
  for (const re of [a, b]) for (const m of text.matchAll(re)) out.push(Number(m[1]));
  return out;
}

const UNCOVERED = '(?:uncovered|no\\s+(?:trd\\s+)?task|not\\s+covered|no\\s+coverage|lacks?|not\\s+satisfied|unsatisfied|missing|has\\s+no\\s+task)';
const PAIR_MISSING = '(?:missing|no|without|lacks?|absent|not\\s+defined|not\\s+found)';
const PAIR_TEST = '(?:test[_ ]pair|-test\\b|test\\s+task|test\\s+counterpart)';

/** The text says the (REQ) `id` has no covering task: the CLI's code then the id, or the id and a word of absence on one line, either order. */
function claimsUncovered(text, id) {
  const e = id.replace(/-/g, '\\-');
  if (new RegExp(`UNCOVERED_REQUIREMENT[^\\n]{0,60}?\\b${e}\\b`).test(text)) return true;
  const after = new RegExp(`\\b${e}\\b[^\\n;]{0,60}?${UNCOVERED}`, 'i');
  const before = new RegExp(`${UNCOVERED}[^\\n;]{0,40}?\\b${e}\\b`, 'i');
  return text.split('\n').some((l) => l.length <= 400 && (after.test(l) || before.test(l)));
}

/** The text says task `id` has no `-TEST` pair (the id itself, not `id-TEST`). Long lines (raw JSON) only count through the CLI's code. */
function claimsNoPair(text, id) {
  const e = id.replace(/-/g, '\\-');
  if (new RegExp(`MISSING_TEST_PAIR[^\\n]{0,60}?\\b${e}\\b(?!-)`).test(text)) return true;
  const gap = '[^\\n;.]{0,60}?';
  const after = new RegExp(`\\b${e}\\b(?!-)${gap}(?:${PAIR_MISSING}${gap}${PAIR_TEST}|${PAIR_TEST}${gap}${PAIR_MISSING})`, 'i');
  const before = new RegExp(`(?:${PAIR_MISSING}${gap}${PAIR_TEST}|${PAIR_TEST}${gap}${PAIR_MISSING})[^\\n;.]{0,40}?\\b${e}\\b(?!-)`, 'i');
  return text.split('\n').some((l) => l.length <= 400 && (after.test(l) || before.test(l)));
}

/** Whether, within `span` characters of some occurrence of `a`, the text matches RegExp `re` (works on a one-line JSON report). */
function near(text, a, re, span = 100) {
  let at = text.indexOf(a);
  while (at !== -1) {
    if (re.test(text.slice(Math.max(0, at - span), at + a.length + span))) return true;
    at = text.indexOf(a, at + a.length);
  }
  return false;
}

/** Files directly under dir/ of root, as { rel: text }. */
function docsOf(root, dir) {
  const out = {};
  for (const f of listFiles(path.join(root, dir), /\.md$/)) out[`${dir}/${f}`] = readText(path.join(root, dir, f));
  return out;
}

const CHECKS = {
  'report-saved': (o) => { report(o); return `saved ${clean(o.file)}`; },

  // The stats the CLI prints: 4 tasks (the heading-style TRD-004 is not counted: a hand count says 5) and 3 PRD requirements.
  'report-stats': (o) => {
    const text = report(o);
    const counts = taskCounts(text);
    if (counts.includes(5)) fail('the report counts 5 tasks: the heading-style `### TRD-004` is not a task, so there are 4');
    if (!counts.includes(4)) fail('the report does not state 4 tasks (stats.tasks)');
    const nReq = new RegExp(`\\b(?:prdRequirements|requirements)${SEP}3\\b|\\b3\\s+(?:prd\\s+)?requirements\\b`, 'i').test(text);
    const allReqs = ['REQ-001', 'REQ-002', 'REQ-003'].every((r) => text.includes(r));
    if (!nReq && !allReqs) fail('the report does not state the 3 PRD requirements (stats.prdRequirements)');
    return 'tasks: 4 (heading-style id not counted), 3 PRD requirements';
  },

  // The one error: TRD-003 satisfies REQ-009, which the PRD does not have.
  'report-errors': (o) => {
    const text = report(o);
    const hit = near(text, 'REQ-009', /TRD-003/) && near(text, 'REQ-009', /orphan|not\s+in\s+the\s+prd|not\s+(?:defined|found|present|exist)|non-?existent|unknown|invalid|no\s+such|does\s+not\s+(?:have|contain|exist)|missing\s+from/i);
    if (!hit) fail('the report does not name TRD-003 and REQ-009 as an orphaned requirement reference (a REQ the PRD lacks)');
    return 'TRD-003 / REQ-009 reported as not in the PRD';
  },

  // The warnings: REQ-003 uncovered; TRD-002 and TRD-003 lack a -TEST pair; TRD-001 (which has one) is not reported.
  'report-warnings': (o) => {
    const text = report(o);
    if (!claimsUncovered(text, 'REQ-003')) fail('the report does not show REQ-003 as uncovered (no task satisfies it)');
    for (const t of ['TRD-002', 'TRD-003']) {
      if (!claimsNoPair(text, t)) fail(`the report does not show ${t} as missing its ${t}-TEST pair`);
    }
    if (claimsNoPair(text, 'TRD-001')) fail('the report says TRD-001 is missing a TEST pair, but TRD-001-TEST exists');
    return 'REQ-003 uncovered; TRD-002 and TRD-003 missing a TEST pair; TRD-001 not flagged';
  },

  // ok is false (an error exists): the report must say validation failed, and must not say it passed.
  'report-verdict': (o) => {
    const text = report(o);
    const failed = /VALIDATION_FAILED|["']?\bok["']?\s*[:=]\s*\**\s*false\b|\bvalidation\s+failed\b|\b(?:result|verdict|status|overall)\W{0,6}(?:fail|failed|error)\b/i.test(text);
    if (!failed) fail('the report does not show a failed validation (VALIDATION_FAILED or ok: false)');
    const passed = /["']?\bok["']?\s*[:=]\s*\**\s*true\b|\bvalidation\s+(?:passed|succeeded)\b|\ball\s+checks\s+passed\b|\b(?:result|verdict|status|overall)\W{0,6}(?:pass|passed|ok|success)\b/i.test(text);
    if (passed) fail('the report also says validation passed (ok: true); there is an error, so it must not');
    return 'failed validation reported';
  },

  // The PRD and TRD are exactly as seeded (the skill must not edit the documents it validates), and no new document appeared beside them.
  'docs-unchanged': (o) => {
    const fixture = need(o, 'fixture');
    for (const dir of ['docs/PRD', 'docs/TRD']) {
      const want = docsOf(fixture, dir);
      const have = docsOf('.', dir);
      if (Object.keys(want).length === 0) fail(`fixture has no ${dir} documents`);
      for (const rel of Object.keys(want)) {
        if (have[rel] === undefined) fail(`${rel} was removed`);
        if (have[rel] !== want[rel]) fail(`${rel} was edited; validation must not change the documents`);
      }
      const extra = Object.keys(have).filter((rel) => want[rel] === undefined);
      if (extra.length) fail(`unexpected new document ${clean(extra[0])}`);
    }
    return 'the PRD and TRD are unchanged';
  },

  // No file outside docs/ (and tool state) other than --allow (comma-separated seeded paths).
  'no-impl-files': (o) => {
    const allow = new Set(String(o.allow || '').split(',').map((s) => s.trim()).filter(Boolean));
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f) && !allow.has(f));
    if (extra.length) fail(`implementation or stray files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files written outside docs/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
