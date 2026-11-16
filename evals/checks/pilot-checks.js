#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the pilot evals (`evals/skills/<skill>/eval.json`). A skill writes files whose names the eval cannot
 * know ahead of time (`docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md`, `trace-<runId>.jsonl`), so these checks find the file by
 * pattern and then test what is in it. They run from an eval's `testsPass` check: the working directory is the agent's workspace,
 * the script itself lives in this repository (never in the workspace). Exit 0 = pass, exit 1 = fail; one line of detail on stdout.
 *
 * Usage: node evals/checks/pilot-checks.js <check> [--name value ...]
 *
 * Each check can fail: it reads what the agent wrote and tests it, and no check is satisfied by the seeded fixture alone.
 * Nothing here runs git or any workspace-supplied program (the workspace's `.git/config` is agent-writable); files are read without
 * following symlinks, at most MAX_BYTES each, and everything printed has control characters stripped.
 */

const path = require('path');
const {
  clean, fail, readText, listFiles, walk, need, list, run, frontmatter, section, reqSections, acBlocks, isGwt,
} = require('./lib');

/** The one PRD the skill saved: a PRD-*.md under docs/PRD/ that is not one of `--seeded` (comma-separated names). */
function newPrd(o) {
  const seeded = new Set(list(o.seeded || ''));
  const files = listFiles('docs/PRD', /^PRD-.+\.md$/).filter((f) => !seeded.has(f));
  if (files.length === 0) fail('no new PRD-*.md under docs/PRD/');
  if (files.length > 1) fail(`expected one new PRD under docs/PRD/, found ${files.length}: ${files.join(', ')}`);
  return { name: files[0], text: readText(path.join('docs/PRD', files[0])) };
}

const CHECKS = {
  // ---- ensemble-create-prd ----
  'prd-saved': (o) => { const p = newPrd(o); return `saved docs/PRD/${p.name}`; },
  'prd-reqs': (o) => {
    const reqs = reqSections(newPrd(o).text);
    if (reqs.length === 0) fail('no REQ-NNN heading in the PRD');
    return `${reqs.length} REQ headings`;
  },
  'prd-gwt': (o) => {
    const reqs = reqSections(newPrd(o).text);
    if (reqs.length === 0) fail('no REQ-NNN heading in the PRD');
    for (const r of reqs) {
      const acs = acBlocks(r.body);
      if (acs.length === 0) fail(`${r.id} has no AC-NNN-M acceptance criterion`);
      const bad = acs.find((l) => !isGwt(l));
      if (bad) fail(`${r.id}: acceptance criterion is not Given/When/Then: ${clean(bad.trim())}`);
    }
    return `every one of ${reqs.length} requirements has Given/When/Then ACs`;
  },
  'prd-constitution': (o) => {
    if (!/Constitution compliance:(?:\*\*)?\s*passed\b/.test(newPrd(o).text)) fail('the PRD does not record `Constitution compliance: passed`');
    return 'Constitution compliance: passed recorded';
  },
  // No file outside docs/ (and tool state) that is not in --allow (comma-separated workspace paths the fixture seeded).
  'no-impl-files': (o) => {
    const allow = new Set(list(o.allow || ''));
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f) && !allow.has(f));
    if (extra.length) fail(`implementation or stray files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files written outside docs/';
  },

  // ---- ensemble-refine-prd ----
  'refine-identity': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const fm = frontmatter(text);
    for (const [key, arg] of [['document_id', 'doc-id'], ['label', 'label']]) {
      if (fm[key] !== need(o, arg)) fail(`${key} is ${JSON.stringify(clean(fm[key] === undefined ? '(missing)' : fm[key]))}, expected ${JSON.stringify(o[arg])}`);
    }
    return 'Document ID and Label unchanged';
  },
  'refine-version': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const v = frontmatter(text).version;
    if (v !== need(o, 'to')) fail(`version is ${JSON.stringify(clean(v === undefined ? '(missing)' : v))}, expected ${JSON.stringify(o.to)} (a patch bump from ${clean(need(o, 'from'))})`);
    return `version ${o.from} -> ${o.to}`;
  },
  'refine-changelog': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const m = section(text, /^(?:Changelog|Version History)\b/i, { toEnd: true });
    if (!m) fail('no Changelog section');
    const entries = m.body.split('\n').filter((l) => /^\s*(?:[-*]|\d+\.|\|)/.test(l));
    if (!entries.some((l) => l.includes(need(o, 'to')))) fail(`no changelog entry for ${o.to}`);
    if (!entries.some((l) => l.includes(need(o, 'from')))) fail(`the earlier changelog entry for ${o.from} was removed`);
    return `changelog has entries for ${o.from} and ${o.to}`;
  },
  'refine-reqs': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) fail(`${clean(o.file)} is missing`);
    const have = new Set(reqSections(text).map((r) => r.id));
    const gone = list(need(o, 'reqs')).filter((id) => !have.has(id));
    if (gone.length) fail(`requirement(s) removed: ${gone.join(', ')}`);
    return `all ${list(o.reqs).length} seeded requirements still present`;
  },

  // ---- ensemble-create-trd ----
  'trd-covers-reqs': (o) => {
    const files = listFiles('docs/TRD', /\.md$/);
    if (files.length === 0) fail('no TRD markdown under docs/TRD/');
    const tagged = new Set();
    for (const f of files) {
      for (const line of readText(path.join('docs/TRD', f)).split('\n')) {
        if (!/\bTRD-\d+/.test(line)) continue;
        for (const tag of line.matchAll(/\[satisfies\s+([^\]]+)\]/g)) for (const id of tag[1].match(/REQ-\d{3,}/g) || []) tagged.add(id);
      }
    }
    const missing = list(need(o, 'reqs')).filter((id) => !tagged.has(id));
    if (missing.length) fail(`no task satisfies: ${missing.join(', ')}`);
    return `every requirement has a task (${list(o.reqs).join(', ')})`;
  },

  // ---- pr-merge-trace ----
  // The gh stub logs every call it answers to gh-calls.log in the sandbox root (the parent of the project directory); a missing log means gh was never called.
  'gh-no-merge': (o) => {
    const text = readText(o.log || '../gh-calls.log');
    if (text === null) fail('the gh stub recorded no call: the merge scenario never ran');
    // One log line per call, the call's full argv (the stub folds newlines inside an argument to spaces). The PR was read only when a call's
    // FIRST words are `pr view` (`gh --version pr view` is a version query, not a read). A merge is `pr merge` anywhere in a call, or an
    // `api graphql` call whose arguments carry a merge mutation (a query body can merge as well as the `gh pr merge` command).
    const calls = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!calls.some((l) => /^pr view(?:\s|$)/.test(l))) fail('the gh stub never answered `pr view`: the PR was not read');
    if (calls.some((l) => /(?:^|\s)pr merge\b/.test(l))) fail('gh pr merge was called: the PR was merged');
    if (calls.some((l) => /(?:^|\s)api\s+graphql\b/.test(l) && /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/i.test(l))) fail('a gh api graphql call carried a merge mutation: the PR was merged');
    return 'PR read through the stub, never merged';
  },
  'trace-spans': (o) => {
    const files = listFiles('.ensemble/state/toolchain', /^trace-[A-Za-z0-9._-]+\.jsonl$/);
    if (files.length === 0) fail('no .ensemble/state/toolchain/trace-<runId>.jsonl');
    const started = new Map();
    const ended = new Set();
    for (const f of files) {
      for (const line of readText(path.join('.ensemble/state/toolchain', f)).split('\n')) {
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (!rec || typeof rec !== 'object') continue;
        if (rec.type === 'span_start' && typeof rec.name === 'string') started.set(rec.span_id, rec.name);
        if (rec.type === 'span_end') ended.add(rec.span_id);
      }
    }
    const closed = new Set([...started].filter(([id]) => ended.has(id)).map(([, name]) => name));
    const missing = list(need(o, 'spans')).filter((n) => !closed.has(n));
    if (missing.length) fail(`no opened and closed span for: ${missing.join(', ')}`);
    return `a span for each of ${o.spans}`;
  },
  // The final report the run saved (the prompt asks for it in report.json): trace_summary embedded and the merge decision unchanged.
  'report-trace-summary': (o) => {
    const text = readText(o.file || 'report.json');
    if (text === null) fail('report.json is missing');
    let report;
    try { report = JSON.parse(text); } catch (e) { return fail(`report.json is not valid JSON: ${clean(e.message)}`); }
    if (!report || typeof report !== 'object' || Array.isArray(report)) fail('report.json is not a JSON object');
    const ts = report.trace_summary;
    if (!ts || typeof ts !== 'object' || Array.isArray(ts)) fail('the final report has no trace_summary object');
    if (ts.trace === 'unavailable') fail(`trace_summary is unavailable: ${clean(ts.reason || '')}`);
    if (typeof ts.wall_ms !== 'number') fail('trace_summary has no numeric wall_ms');
    return 'trace_summary embedded with wall_ms';
  },
  'report-not-merged': (o) => {
    const text = readText(o.file || 'report.json');
    if (text === null) fail('report.json is missing');
    let report;
    try { report = JSON.parse(text); } catch (e) { return fail(`report.json is not valid JSON: ${clean(e.message)}`); }
    if (!report || report.merged !== false) fail(`the report says merged is ${clean(JSON.stringify(report && report.merged))}, expected false`);
    if (o.pr !== undefined && String(report.pr_number) !== o.pr) fail(`the report names PR ${clean(JSON.stringify(report.pr_number))}, expected ${clean(o.pr)}`);
    return 'report: not merged';
  },
};

/** Run the check named by argv[0] (no node/script prefix); returns the exit code. */
const main = (argv) => run(CHECKS, [null, null, ...argv]);

if (require.main === module) process.exitCode = run(CHECKS);

module.exports = { CHECKS, main, reqSections, acBlocks, frontmatter };
