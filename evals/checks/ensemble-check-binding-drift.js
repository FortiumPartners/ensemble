#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-check-binding-drift` skill eval (evals/skills/ensemble-check-binding-drift).
 * The skill is read-only: it diffs a PRD's acceptance-criteria steps against the [Given/When/Then(@"...")] attributes in the Reqnroll
 * Steps/*.cs files and reports UNBOUND (PRD step, no binding) and ORPHANED (binding, no PRD step) steps. The prompt asks the run to save
 * its report as drift-report.md; the checks read that report and the workspace, never run the CLI or any workspace code.
 *
 * FLAKY (phrasing-dependent): report-unbound, report-orphaned and report-precision assign steps to a section by the line that starts
 * with the word UNBOUND or ORPHANED (as the CLI prints them, or as a markdown heading, bullet, bold or table row). A report that names
 * the steps without ever introducing them under those words fails; that is the skill's output contract ("the lists of UNBOUND ... and
 * ORPHANED ... entries"), not a harmless phrasing difference. Step text is compared case-, whitespace-, backtick- and
 * quote-insensitively, as a substring.
 */

const path = require('path');
const { fail, readText, readRequired, listFiles, walk, need, list, clean, run } = require('./lib');

/** Lower-cased, whitespace collapsed, markdown emphasis and quote characters removed. Linear. */
const norm = (s) => String(s).toLowerCase().replace(/[`*"'_]/g, '').replace(/\s+/g, ' ').trim();

const MARKER = /^[\s#>*+\-|_`]*(unbound|orphaned)\b/i;
const HEADING = /^#{1,6}\s/;

/** { unbound, orphaned }: normalized text of every report line from a UNBOUND / ORPHANED marker line to the next marker or heading. */
function sections(report) {
  const out = { unbound: [], orphaned: [] };
  let kind = null;
  for (const line of report.split('\n')) {
    const m = MARKER.exec(line);
    if (m) kind = m[1].toLowerCase();
    else if (HEADING.test(line)) kind = null;
    if (kind) out[kind].push(line);
  }
  return { unbound: norm(out.unbound.join('\n')), orphaned: norm(out.orphaned.join('\n')) };
}

const readReport = (o) => readRequired(o.report || 'drift-report.md', o.report || 'drift-report.md');

const CHECKS = {
  // The report exists and is more than a stub.
  'report-saved': (o) => {
    const file = o.report || 'drift-report.md';
    const t = readText(file);
    if (t === null) fail(`${clean(file)} was not written`);
    if (t.trim().length < 40) fail(`${clean(file)} is only ${t.trim().length} characters`);
    return `saved ${clean(file)}`;
  },
  // Every step that is in the PRD but not bound is listed under UNBOUND.
  'report-unbound': (o) => {
    const s = sections(readReport(o));
    if (s.unbound === '') fail('the report has no UNBOUND section (a line starting with UNBOUND)');
    const steps = list(need(o, 'steps'));
    const missing = steps.filter((t) => !s.unbound.includes(norm(t)));
    if (missing.length) fail(`not listed as UNBOUND: ${missing.map(clean).join(' | ')}`);
    return `all ${steps.length} unbound steps listed`;
  },
  // Every binding whose PRD step is gone or reworded is listed under ORPHANED.
  'report-orphaned': (o) => {
    const s = sections(readReport(o));
    if (s.orphaned === '') fail('the report has no ORPHANED section (a line starting with ORPHANED)');
    const steps = list(need(o, 'steps'));
    const missing = steps.filter((t) => !s.orphaned.includes(norm(t)));
    if (missing.length) fail(`not listed as ORPHANED: ${missing.map(clean).join(' | ')}`);
    return `all ${steps.length} orphaned bindings listed`;
  },
  // No step that is in sync (a PRD step with a binding) is reported as drift, and no drift step sits in the other section.
  'report-precision': (o) => {
    const s = sections(readReport(o));
    const wrong = [];
    for (const t of list(need(o, 'bound'))) {
      if (s.unbound.includes(norm(t)) || s.orphaned.includes(norm(t))) wrong.push(`bound step reported as drift: ${clean(t)}`);
    }
    for (const t of list(need(o, 'unbound'))) if (s.orphaned.includes(norm(t))) wrong.push(`unbound step reported as ORPHANED: ${clean(t)}`);
    for (const t of list(need(o, 'orphaned'))) if (s.unbound.includes(norm(t))) wrong.push(`orphaned binding reported as UNBOUND: ${clean(t)}`);
    if (wrong.length) fail(wrong.join('; '));
    return 'no in-sync step reported as drift, no step in the wrong section';
  },
  // Read-only: the files under --tree are exactly --files, the orphaned binding is still there, no stub was added for an unbound step,
  // and the PRD still carries the unbound steps.
  'bindings-untouched': (o) => {
    const tree = need(o, 'tree');
    const have = walk('.').filter((f) => f.startsWith(`${tree}/`)).sort();
    const want = list(need(o, 'files')).map((f) => `${tree}/${f}`).sort();
    if (have.join('\n') !== want.join('\n')) fail(`files under ${clean(tree)} changed: now ${have.map(clean).join(', ') || 'none'}`);
    const dir = need(o, 'steps-dir');
    const all = listFiles(dir, /\.cs$/).map((f) => norm(readRequired(path.join(dir, f)))).join('\n');
    for (const t of list(need(o, 'kept'))) if (!all.includes(norm(t))) fail(`binding removed or rewritten: ${clean(t)}`);
    const absent = list(need(o, 'absent'));
    for (const t of absent) if (all.includes(norm(t))) fail(`a binding was added for an unbound step: ${clean(t)}`);
    const prd = norm(readRequired(need(o, 'prd')));
    for (const t of absent) if (!prd.includes(norm(t))) fail(`the PRD no longer contains: ${clean(t)}`);
    return 'bindings, features and PRD left as they were';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
