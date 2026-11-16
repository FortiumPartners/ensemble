#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-prd` eval (evals/skills/ensemble-prd/eval.json). The skill is a router: `create <description>`
 * must end as create-prd would end it, with the keyword removed from the arguments. The PRD file name is not known ahead of time
 * (docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md), so the checks find it by pattern and test what is in it. Run from the agent's workspace;
 * exit 0 = pass, 1 = fail, one line of detail on stdout. No git, no network, no workspace code; reads never follow symlinks.
 *
 * Usage: node evals/checks/ensemble-prd.js <check> [--name value ...]
 */

const path = require('path');
const {
  clean, fail, readText, listFiles, walk, need, list, run, frontmatter, reqSections, acBlocks, isGwt,
} = require('./lib');

/** The one PRD the skill saved: a PRD-*.md under docs/PRD/ (the fixture seeds none). */
function newPrd() {
  const files = listFiles('docs/PRD', /^PRD-.+\.md$/);
  if (files.length === 0) fail('no new PRD-*.md under docs/PRD/');
  if (files.length > 1) fail(`expected one new PRD under docs/PRD/, found ${files.length}: ${files.map(clean).join(', ')}`);
  return { name: files[0], text: readText(path.join('docs/PRD', files[0])) };
}

/** The PRD's H1 title text (after an optional `PRD-...:` id prefix), or ''. */
function title(text) {
  const m = /^#\s+(.+)$/m.exec(text);
  return m ? m[1].replace(/^PRD-[\w-]+\s*[:–—-]\s*/, '').trim() : '';
}

const CHECKS = {
  'prd-saved': () => `saved docs/PRD/${newPrd().name}`,
  'prd-reqs': () => {
    const reqs = reqSections(newPrd().text);
    if (reqs.length === 0) fail('no REQ-NNN heading in the PRD');
    return `${reqs.length} REQ headings`;
  },
  'prd-gwt': () => {
    const reqs = reqSections(newPrd().text);
    if (reqs.length === 0) fail('no REQ-NNN heading in the PRD');
    for (const r of reqs) {
      const acs = acBlocks(r.body);
      if (acs.length === 0) fail(`${r.id} has no AC-NNN-M acceptance criterion`);
      const bad = acs.find((l) => !isGwt(l));
      if (bad) fail(`${r.id}: acceptance criterion is not Given/When/Then: ${clean(bad.trim())}`);
    }
    return `every one of ${reqs.length} requirements has Given/When/Then ACs`;
  },
  'prd-constitution': () => {
    if (!/Constitution compliance:(?:\*\*)?\s*passed\b/.test(newPrd().text)) fail('the PRD does not record `Constitution compliance: passed`');
    return 'Constitution compliance: passed recorded';
  },
  // The arguments after the keyword reached the sub-skill: the PRD is about --subject (case-insensitive) in its title or label.
  // Robust to wording; fails on a PRD about an invented subject or one written from the repository instead of the arguments.
  'prd-subject': (o) => {
    const subject = need(o, 'subject').toLowerCase();
    const text = newPrd().text;
    const fm = frontmatter(text);
    const head = [title(text), String(fm.label || ''), String(fm.title || '')].join('\n').toLowerCase();
    if (!head.includes(subject)) fail(`the PRD's title and label do not mention ${clean(o.subject)}: ${JSON.stringify(clean(title(text)))}`);
    return `PRD is about ${o.subject}`;
  },
  // The routing keyword was consumed by the router, not passed on as part of the product description: the PRD's title and label do not
  // start with it ("Create csv2json", `prd-create-csv2json`). FLAKY only if a product legitimately starts with the keyword (not csv2json).
  'prd-keyword-stripped': (o) => {
    const kw = need(o, 'keyword').toLowerCase();
    const text = newPrd().text;
    const fm = frontmatter(text);
    const t = title(text).toLowerCase();
    const label = String(fm.label || '').toLowerCase().replace(/^prd[-_]/, '');
    const starts = (s) => s === kw || s.startsWith(`${kw} `) || s.startsWith(`${kw}-`) || s.startsWith(`${kw}_`) || s.startsWith(`${kw}:`);
    if (starts(t)) fail(`the PRD title starts with the routing keyword: ${JSON.stringify(clean(title(text)))}`);
    if (starts(label)) fail(`the PRD label starts with the routing keyword: ${JSON.stringify(clean(String(fm.label)))}`);
    return 'routing keyword not carried into the PRD title or label';
  },
  // No file outside docs/ (and tool state) that is not in --allow (comma-separated workspace paths the fixture seeded).
  'no-impl-files': (o) => {
    const allow = new Set(list(o.allow || ''));
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f) && !allow.has(f));
    if (extra.length) fail(`implementation or stray files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files written outside docs/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
