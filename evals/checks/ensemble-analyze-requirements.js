#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-analyze-requirements` eval. The skill prints a readiness report; the eval's prompt asks the
 * run to also save it to docs/analysis/readiness-report.md, and these checks read that file. The fixture (a report-export PRD and TRD)
 * plants: TRD-003 depends on TRD-009 (undefined: an error, so the verdict is NOT READY whatever the contradiction count), REQ-002 and
 * REQ-003 are satisfied by no task, TRD-003 has no estimate and no TRD-003-TEST, and PRD REQ-002 (synchronous, within 2 seconds, and
 * "without a separate worker process") is contradicted by TRD-002 (asynchronous background queue, ready within 30 seconds).
 * Expected values are those of `trd-cli analyze` on the fixture. Text matching is by window (the matching line and its neighbours) so
 * a table row, a bullet or a heading plus bullets all pass; every regex is anchored on short words, bounded, and run per line.
 * FLAKY by nature (format dependent): phase-stats. The rest accept a range of phrasings; none runs workspace code.
 */

const path = require('path');
const { fail, readText, walk, clean, run } = require('./lib');

const REPORT = 'docs/analysis/readiness-report.md';
const FIXTURE = path.join(__dirname, '..', 'skills', 'ensemble-analyze-requirements', 'fixture');
const INPUTS = ['docs/PRD/PRD-2026-c3d4e5f6-report-export.md', 'docs/TRD/TRD-report-export.md'];

const report = () => {
  const t = readText(REPORT);
  if (t === null) return fail(`${REPORT} was not written`);
  return t;
};

/** Text of the lines around every line matching `re`: `before` lines above, `after` below. One string per matching line. */
function windows(text, re, before, after) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) out.push(lines.slice(Math.max(0, i - before), i + after + 1).join('\n'));
  }
  return out;
}

const VERDICT = /verdict[^A-Za-z]{0,20}(not[ _-]?ready|mostly[ _-]?ready|caution|ready)\b/gi;

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (t.replace(/\s+/g, '').length < 200) fail(`${REPORT} is nearly empty`);
    return `saved ${REPORT}`;
  },

  // The skill's ladder: errors -> NOT READY, >5 warnings -> CAUTION, >0 -> MOSTLY READY, else READY. The fixture has one error.
  'verdict-not-ready': () => {
    const t = report();
    const stated = [...t.matchAll(VERDICT)].map((m) => m[1].toLowerCase().replace(/[ _-]/g, ''));
    if (stated.length > 0) {
      const other = stated.find((v) => v !== 'notready');
      if (other) fail(`the report states the verdict ${clean(other)}, but the TRD has an unresolved dependency (an error): NOT READY`);
      return 'verdict NOT READY';
    }
    if (/\b(?:mostly[ _-]?ready|caution)\b/i.test(t)) fail('the report names a different verdict than NOT READY');
    if (!/\bnot[ _-]?ready\b/i.test(t)) fail('no verdict NOT READY in the report');
    return 'verdict NOT READY (unlabelled)';
  },

  // traceability.uncoveredRequirements = REQ-002, REQ-003
  'finding-uncovered': () => {
    const t = report();
    const GAP = /uncovered|not covered|no (?:trd )?tasks?\b|missing|untraced|\bgaps?\b|without|not satisfied|nothing satisf|no coverage|unmapped|no (?:matching )?task/i;
    for (const req of ['REQ-002', 'REQ-003']) {
      const ok = windows(t, new RegExp(`\\b${req}\\b`), 3, 1).some((w) => GAP.test(w));
      if (!ok) fail(`the report does not flag ${req} as uncovered by any TRD task`);
    }
    return 'REQ-002 and REQ-003 flagged as uncovered';
  },

  // validation.errors: UNRESOLVED_DEPENDENCY, TRD-003 -> TRD-009
  'finding-dependency': () => {
    const t = report();
    const BAD = /undefined|not defined|unresolved|does not exist|doesn't exist|missing|dangling|no such|unknown|not found|never defined/i;
    const ok = windows(t, /\bTRD-009\b/, 2, 2).some((w) => BAD.test(w) && /\bTRD-003(?![-\w])/.test(w));
    if (!ok) fail('the report does not flag that TRD-003 depends on TRD-009, which is not defined');
    return 'unresolved dependency TRD-003 -> TRD-009 flagged';
  },

  // estimates.missing = TRD-003; traceability.missingTestPairs = TRD-003
  'finding-estimate-and-test-pair': () => {
    const t = report();
    const around = windows(t, /\bTRD-003(?![-\w])/, 2, 2);
    if (!around.some((w) => /estimate|\bhours?\b|\bhrs?\b/i.test(w))) fail('the report does not flag that TRD-003 has no estimate');
    const pair = /\bTRD-003-TEST\b/.test(t) || around.some((w) => /test pair|missing test|no test|paired test|test task|without a test/i.test(w));
    if (!pair) fail('the report does not flag that TRD-003 has no test task (TRD-003-TEST)');
    return 'TRD-003 missing estimate and test pair flagged';
  },

  // phases[0] = Export service, 5 tasks, 11 hours (statistics come from the CLI). FLAKY: depends on how the report lays out the phase.
  'phase-stats': () => {
    const t = report();
    const ok = windows(t, /export service/i, 2, 2).some((w) => /\b5\b/.test(w) && /\b11(?:\.0)?\b/.test(w));
    if (!ok) fail('the report does not give the Export service phase with 5 tasks and 11 hours');
    return 'phase statistics quoted (5 tasks, 11 hours)';
  },

  // The contradiction scan: PRD REQ-002 (synchronous, 2 s, no worker) against TRD-002 (asynchronous queue, 30 s).
  'contradiction-found': () => {
    const t = report();
    const PRD_SIDE = /\bREQ-002\b|\bAC-002-1\b|separate worker/i;
    const SYNC = /\bsync(?:hronous(?:ly)?)?\b|same http response|inline/i;
    const ASYNC = /\basync(?:hronous(?:ly)?)?\b|background|queue|job id/i;
    const CONFLICT = /contradict|conflict|inconsisten|mismatch|disagree|differ|incompatible/i;
    const ok = windows(t, /\bTRD-002(?![-\w])/, 3, 3).some((w) => PRD_SIDE.test(w) && SYNC.test(w) && ASYNC.test(w) && CONFLICT.test(w));
    if (!ok) fail('the report does not cite the synchronous PRD requirement (REQ-002) and the asynchronous TRD-002 as a contradiction');
    return 'sync-versus-async contradiction reported with both sides';
  },

  // Read-only: the PRD and TRD are byte-identical to the seeded ones, and no PRD or TRD was added.
  'inputs-unchanged': () => {
    for (const rel of INPUTS) {
      const now = readText(rel);
      const seeded = readText(path.join(FIXTURE, rel));
      if (seeded === null) fail(`fixture file ${rel} is missing from the eval`);
      if (now === null) fail(`${rel} was deleted`);
      if (now !== seeded) fail(`${rel} was modified (the skill is read-only)`);
    }
    const added = walk('.').filter((f) => /^docs\/(?:PRD|TRD)\//.test(f) && !INPUTS.includes(f));
    if (added.length) fail(`a PRD or TRD was added: ${added.slice(0, 5).map(clean).join(', ')}`);
    return 'PRD and TRD unchanged';
  },

  // As the pilots: no file outside docs/ (and tool state) is written.
  'no-impl-files': () => {
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f));
    if (extra.length) fail(`implementation or stray files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files written outside docs/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
