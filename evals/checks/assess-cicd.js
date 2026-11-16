#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `assess-cicd` eval (see evals/skills/assess-cicd/README.md). They read the report the run saved at
 * docs/assessment/cicd.md in the seeded `shipit` workspace: a tiny Node service with one GitHub Actions workflow
 * (.github/workflows/ci.yml: build -> test -> deploy-staging -> deploy-prod), scripts/deploy.sh, a Dockerfile and Terraform in
 * infra/main.tf. No GitLab, Jenkins, Azure DevOps or CircleCI config. Report-shape checks follow the skill's own Output Format and
 * the shared Scoring Scale of `assessment-report-suite`; fixture-fact checks use what the fixture really contains, including planted problems:
 *   - ci.yml sets REGISTRY_PASSWORD to a literal in the workflow-level env block (a plaintext credential; the other secrets use `secrets.*`);
 *   - the deploy-prod job runs right after staging with no `environment:` protection or manual approval;
 *   - nothing in the pipeline or deploy script can roll a release back.
 * Line numbers are read from the shipped fixture at check time, never hard-coded. Checks that may be too strict for a correct but
 * differently-worded report are marked FLAKY. Dependency-free; reads never follow symlinks; no workspace code is run.
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, clean, headings, section, run } = require('./lib');

const REPORT = 'docs/assessment/cicd.md';
const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'assess-cicd', 'fixture');
const WORKFLOW = '.github/workflows/ci.yml';

// Lower bound of each letter band on the shared scale (assessment-report-suite, Scoring Scale).
const BANDS = [[4.5, 'A'], [4.167, 'B+'], [3.833, 'B'], [3.5, 'B-'], [3.167, 'C+'], [2.833, 'C'], [2.5, 'C-'], [2.167, 'D+'], [1.833, 'D'], [1.5, 'D-'], [0, 'F']];
const letterFor = (n) => BANDS.find(([min]) => n >= min)[1];

// The skill's Output Format, level-2 headings in order.
const SECTIONS = [
  ['Pipeline Discovery', /^pipeline discovery\b/i],
  ['Pipeline Stages', /^pipeline stages?\b/i],
  ['Deployment Strategy', /^deployment strateg(?:y|ies)\b/i],
  ['Strengths', /^strengths?\b/i],
  ['Weaknesses', /^weaknesses?\b/i],
  ['Score', /^score\b/i],
  ['Recommendations', /^recommendations?\b/i],
];

const report = () => {
  const t = readText(REPORT);
  if (t === null) fail(`${REPORT} was not written`);
  return t;
};

const sec = (text, name) => {
  const def = SECTIONS.find(([n]) => n === name);
  const s = section(text, def[1]);
  if (!s) fail(`no "${name}" section`);
  return s;
};

const fixtureLines = (rel) => {
  const t = readText(path.join(FIXTURE_DIR, rel));
  if (t === null) fail(`fixture file ${rel} is missing from the eval (check bug)`);
  return t.split('\n');
};

/** { from, to } 1-based lines in the shipped fixture workflow: the first line matching `needle` and (when `toEnd`) the end of the file. */
function workflowSpan(needle, toEnd) {
  const lines = fixtureLines(WORKFLOW);
  const i = lines.findIndex((l) => needle.test(l));
  if (i < 0) fail(`the planted line is gone from fixture ${WORKFLOW} (check bug)`);
  return { from: i + 1, to: toEnd ? lines.length : i + 1 };
}

const numberedItems = (body) => body.split('\n')
  .map((l) => /^\s*\d{1,2}[.)]\s+(\S.*)$/.exec(l))
  .filter(Boolean).map((m) => m[1].trim())
  .filter((t) => !/^\[[^\]]*\]$/.test(t) && t !== '...'); // an unfilled template placeholder is not an item

// A citation: path-like token with a known extension, `:line` or `:line-line`. Bounded: the path part is at most 120 characters.
const CITE = /([A-Za-z0-9_./-]{1,120}\.(?:yml|yaml|sh|tf|json|js|md|toml|mk)|Dockerfile|Makefile):(\d{1,5})(?:[-–](\d{1,5}))?/g;
const citations = (text) => [...text.matchAll(CITE)].map((m) => ({ file: m[1].replace(/^\.\//, ''), from: Number(m[2]), to: m[3] ? Number(m[3]) : Number(m[2]) }));

/** Cells of every markdown table row in `body` (separator rows dropped): [[cell, ...], ...]. */
function tableRows(body) {
  return body.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
}

// A status cell: negative first (so "not found" is not read as "found"). A template placeholder `✓/✗` is neither.
const NEG = /✗|✘|❌|✖|\b(?:no|none|not found|not detected|absent|missing|n\/a)\b/i;
const POS = /✓|✔|✅|\b(?:yes|found|present|detected|configured)\b/i;
const verdict = (cell) => {
  if (/✓\s*\/\s*✗|✔\s*\/\s*✘/.test(cell)) return null;
  if (NEG.test(cell)) return false;
  if (POS.test(cell)) return true;
  return null;
};

const overlaps = (c, span) => path.posix.basename(c.file) === path.posix.basename(WORKFLOW) && c.from - 1 <= span.to && span.from <= c.to + 1;

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (t.trim().length < 600) fail(`${REPORT} is only ${t.trim().length} characters`);
    if (!headings(t).some((h) => h.level === 1 && /ci\s*\/\s*cd analysis/i.test(h.text))) fail('no "# CI/CD Analysis" title');
    return `saved ${REPORT}`;
  },

  // Every section of the skill's Output Format is present as a level-2 heading, in the prescribed order.
  'sections-complete': () => {
    const hs = headings(report()).filter((h) => h.level === 2);
    let from = -1;
    const missing = [];
    const misplaced = [];
    for (const [name, re] of SECTIONS) {
      const at = hs.findIndex((h, i) => i > from && re.test(h.text));
      if (at >= 0) { from = at; continue; }
      (hs.some((h) => re.test(h.text)) ? misplaced : missing).push(name);
    }
    if (missing.length) fail(`sections missing: ${missing.join(', ')}`);
    if (misplaced.length) fail(`sections out of the prescribed order: ${misplaced.join(', ')}`);
    return `all ${SECTIONS.length} sections present in order`;
  },

  // The overall score follows the numeric-first rule: `## Score: <1.0-5.0> / <Letter>`, letter derived from the shared scale.
  'score-format': () => {
    const s = sec(report(), 'Score');
    const m = /^score\s*:?\s*\**\s*(\d(?:\.\d{1,3})?)\s*\/\s*([A-F][+-]?)(?![A-Za-z0-9+-])/i.exec(s.heading) ||
      /^\s*\**\s*(?:score\s*:?\s*)?\**\s*(\d(?:\.\d{1,3})?)\s*\/\s*([A-F][+-]?)(?![A-Za-z0-9+-])/i.exec(s.body.split('\n').find((l) => l.trim()) || '');
    if (!m) fail(`the Score is ${JSON.stringify(clean(s.heading))}, not "<1.0-5.0> / <Letter>" (a bare letter or no number is not a valid score)`);
    const n = Number(m[1]);
    if (n < 1 || n > 5) fail(`score ${n} is outside 1.0-5.0`);
    if (m[2].toUpperCase() !== letterFor(n)) fail(`score is ${n} / ${m[2]} but the scale gives ${letterFor(n)} for ${n}`);
    return `score ${n} / ${m[2]}`;
  },

  // The Pipeline Discovery table reports what the repository really has: GitHub Actions found, GitLab CI, Jenkins and Azure DevOps not found.
  'discovery-correct': () => {
    const rows = tableRows(sec(report(), 'Pipeline Discovery').body);
    const platforms = [['GitHub Actions', /github actions|\bgithub\b/i, true], ['GitLab CI', /gitlab/i, false], ['Jenkins', /jenkins/i, false], ['Azure DevOps', /azure/i, false], ['CircleCI', /circle/i, false]];
    const wrong = [];
    for (const [name, re, want] of platforms) {
      const row = rows.find((cells) => re.test(cells[0]));
      if (!row) { if (name !== 'CircleCI') wrong.push(`${name} has no row`); continue; }
      const got = verdict(row[row.length - 1]);
      if (got !== want) wrong.push(`${name} is marked ${got === null ? 'neither found nor missing' : got ? 'found' : 'not found'}, the repository ${want ? 'has' : 'has no'} ${name}`);
    }
    if (wrong.length) fail(`Pipeline Discovery: ${wrong.join('; ')}`);
    return 'GitHub Actions found; GitLab CI, Jenkins and Azure DevOps not found';
  },

  // The Pipeline Stages table has the build, test and deploy stages; the report names the real test command and the triggers.
  'stages-identified': () => {
    const t = report();
    const s = sec(t, 'Pipeline Stages');
    const rows = tableRows(s.body);
    const missing = [['Build', /^build/i], ['Test', /^test/i], ['Deploy', /^deploy/i]].filter(([, re]) => !rows.some((c) => re.test(c[0].replace(/[*_`]/g, '')))).map(([n]) => n);
    if (missing.length) fail(`Pipeline Stages has no row for: ${missing.join(', ')}`);
    if (!/npm (?:run )?test|node --test/i.test(t)) fail('the report never names the test command the pipeline runs (npm test)');
    if (!/pull[_ -]?request|\bPRs?\b/i.test(t) || !/\bpush(?:es|ed)?\b/i.test(t)) fail('the report does not name the triggers (push to main and pull requests)');
    return 'build, test and deploy stages, the test command and the triggers named';
  },

  // FLAKY: table column layout. Deployment Strategy table: production deploys with no approval gate and no rollback (both planted); staging has no rollback.
  'deploy-table': () => {
    const rows = tableRows(sec(report(), 'Deployment Strategy').body);
    const head = rows.find((c) => c.some((x) => /approval/i.test(x)) && c.some((x) => /rollback/i.test(x)));
    if (!head) fail('Deployment Strategy has no table with Approval and Rollback columns');
    const col = (re) => head.findIndex((x) => re.test(x));
    const [ap, rb] = [col(/approval/i), col(/rollback/i)];
    const cellOf = (re, i) => { const r = rows.find((c) => c !== head && re.test(c[0].replace(/[*_`]/g, ''))); return r ? r[i] : undefined; };
    const need = [['Staging', /^stag/i], ['Prod', /^prod/i]];
    const absent = need.filter(([, re]) => cellOf(re, 0) === undefined).map(([n]) => n);
    if (absent.length) fail(`the Deployment Strategy table has no row for: ${absent.join(', ')}`);
    const wrong = [];
    if (verdict(cellOf(/^prod/i, ap) || '') !== false) wrong.push('Prod Approval should be ✗: the production job has no environment protection or manual approval');
    if (verdict(cellOf(/^prod/i, rb) || '') !== false) wrong.push('Prod Rollback should be ✗: nothing in the pipeline can roll back');
    if (verdict(cellOf(/^stag/i, rb) || '') !== false) wrong.push('Staging Rollback should be ✗');
    if (wrong.length) fail(wrong.join('; '));
    return 'production has no approval and no rollback; staging has no rollback';
  },

  // FLAKY: wording. The plaintext REGISTRY_PASSWORD in the workflow env block is cited at its real line and called a hard-coded credential.
  'plaintext-secret': () => {
    const text = report();
    const span = workflowSpan(/REGISTRY_PASSWORD\s*:/, false);
    const where = [sec(text, 'Weaknesses').body, sec(text, 'Deployment Strategy').body, sec(text, 'Recommendations').body].join('\n');
    const hit = citations(where).find((c) => overlaps(c, span));
    if (!hit) fail(`no citation of ${WORKFLOW}:${span.from} (the plaintext REGISTRY_PASSWORD) in Weaknesses, Deployment Strategy or Recommendations`);
    const mentions = where.split('\n').filter((l) => /REGISTRY_PASSWORD/.test(l) || citations(l).some((c) => overlaps(c, span)));
    if (!/hard-?coded|plain-?text|in clear|literal|committed|exposed|leak|inline|not (?:stored |kept )?(?:in|as|via) (?:a |the )?(?:github )?secrets?|rather than (?:a |the )?(?:github )?secrets?|instead of (?:a |the )?(?:github )?secrets?/i.test(mentions.join('\n'))) {
      fail(`${clean(hit.file)}:${hit.from} is cited but the finding does not say the credential is hard-coded or in plain text`);
    }
    return `reports the plaintext credential at ${WORKFLOW}:${span.from}`;
  },

  // FLAKY: wording. The deploy-prod job (to the end of the workflow) is cited and the finding is about the missing gate or unattended deploy.
  'prod-gate': () => {
    const text = report();
    const span = workflowSpan(/^\s*deploy-prod\s*:/, true);
    const where = [sec(text, 'Weaknesses').body, sec(text, 'Deployment Strategy').body, sec(text, 'Recommendations').body].join('\n');
    const hit = citations(where).find((c) => overlaps(c, span));
    if (!hit) fail(`no citation of the deploy-prod job (${WORKFLOW}:${span.from}) in Weaknesses, Deployment Strategy or Recommendations`);
    const lines = where.split('\n').filter((l) => citations(l).some((c) => overlaps(c, span)) || /deploy-prod|production/i.test(l));
    if (!/approv|manual|gate|protect|environment|review|unattended|automatic|without (?:a |any )?(?:human|check)|no (?:human|check)/i.test(lines.join('\n'))) {
      fail(`${clean(hit.file)}:${hit.from} is cited but not described as a production deploy without approval or a protection gate`);
    }
    return 'reports production deploying without an approval gate';
  },

  // FLAKY: wording. The missing rollback is named as a weakness or recommendation.
  'rollback-gap': () => {
    const text = report();
    const where = [sec(text, 'Weaknesses').body, sec(text, 'Recommendations').body].join('\n');
    const lines = where.split('\n').filter((l) => /roll(?:ing)?[- ]?back|revert|previous (?:version|release)/i.test(l));
    if (lines.length === 0) fail('neither Weaknesses nor Recommendations mentions rollback; the pipeline has no way to roll a release back');
    if (!/\b(?:no|lack|lacks|lacking|missing|without|absent|not|cannot|can't|nothing|add|implement|introduce|automate|define)\b/i.test(lines.join('\n'))) fail('rollback is mentioned but not as a gap or something to add');
    return 'the missing rollback is reported';
  },

  // Deployment Strategy reports the Terraform in infra/main.tf as infrastructure as code.
  'iac-identified': () => {
    const b = sec(report(), 'Deployment Strategy').body;
    if (!/terraform/i.test(b)) fail('Deployment Strategy does not mention Terraform (infra/main.tf)');
    if (!/infra\/main\.tf|main\.tf/.test(b)) fail('Deployment Strategy names Terraform but not infra/main.tf');
    return 'Terraform in infra/main.tf identified';
  },

  // FLAKY: citations are checked against the workspace. Every file:line must name a file that exists with that line in it (an invented path or a
  // line past the end is a fabricated citation); at least five of them, over at least three distinct files.
  'citations-real': () => {
    const text = report();
    const files = walk('.').filter((f) => !f.startsWith('docs/assessment/') && !/^\.(ensemble|beads)\//.test(f));
    const cites = citations(text);
    if (cites.length < 5) fail(`only ${cites.length} file:line citation(s); the skill says to cite file:line for findings`);
    const lengths = new Map();
    const lenOf = (f) => { if (!lengths.has(f)) lengths.set(f, (readText(f) || '').split('\n').length); return lengths.get(f); };
    const cited = new Set();
    for (const c of cites) {
      const found = files.includes(c.file) ? c.file : files.find((f) => f.endsWith(`/${c.file}`) && !c.file.includes('/'));
      if (!found) fail(`cited ${clean(c.file)}:${c.from} but that file is not in the repository`);
      const n = lenOf(found);
      if (c.from > n || c.to > n || c.to < c.from) fail(`cited ${clean(c.file)}:${c.from}${c.to !== c.from ? `-${c.to}` : ''} but the file has ${n} lines`);
      cited.add(found);
    }
    if (cited.size < 3) fail(`citations cover only ${cited.size} distinct file(s); expected at least 3`);
    return `${cites.length} citations, all resolve, ${cited.size} distinct files`;
  },

  'weaknesses-recommendations': () => {
    const t = report();
    const strengths = numberedItems(sec(t, 'Strengths').body);
    if (strengths.length < 1) fail('Strengths has no numbered item');
    const weak = numberedItems(sec(t, 'Weaknesses').body);
    if (weak.length < 3) fail(`Weaknesses has ${weak.length} numbered item(s); the return summary asks for the top three`);
    const cited = weak.filter((i) => citations(i).length > 0).length;
    if (cited < 2) fail(`only ${cited} Weakness(es) cite a file:line; the skill says to cite file:line for findings`);
    const recs = numberedItems(sec(t, 'Recommendations').body);
    if (recs.length < 2) fail(`Recommendations has ${recs.length} numbered item(s); the format has two`);
    return `${strengths.length} strengths, ${weak.length} weaknesses (${cited} cited), ${recs.length} recommendations`;
  },

  // The run changed no fixture file and wrote nothing outside docs/assessment/ (the prompt asks for the report only).
  'no-stray-writes': () => {
    const extra = [];
    const changed = [];
    const seeded = walk(FIXTURE_DIR);
    for (const f of walk('.')) {
      if (f.startsWith('docs/assessment/') || /^\.(ensemble|beads)\//.test(f)) continue;
      if (!seeded.includes(f)) { extra.push(f); continue; }
      if (readText(f) !== readText(path.join(FIXTURE_DIR, f))) changed.push(f);
    }
    const gone = seeded.filter((f) => !fs.existsSync(f));
    if (extra.length) fail(`files written outside docs/assessment/: ${extra.slice(0, 5).map(clean).join(', ')}`);
    if (changed.length) fail(`fixture file(s) modified: ${changed.slice(0, 5).map(clean).join(', ')}`);
    if (gone.length) fail(`fixture file(s) removed: ${gone.slice(0, 5).map(clean).join(', ')}`);
    return 'no fixture file changed; nothing written outside docs/assessment/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
