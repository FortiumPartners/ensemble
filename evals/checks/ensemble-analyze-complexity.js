#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-analyze-complexity` skill eval. The run saves its report to docs/complexity.md; the fixture
 * (evals/skills/ensemble-analyze-complexity/fixture) has two packages, `packages/auth/src/session.js` (imported by two files) and
 * `packages/billing/src/invoice.js`, and the prompt names both, mentions production and rollback and carries a fake API key.
 * Checks read the report only; nothing here runs the analyzer or any workspace code.
 */

const { fail, readText, walk, section, clean, run } = require('./lib');

const REPORT = 'docs/complexity.md';
const SECRET = 'sk_live_abcdef1234567890';
const SEEDED = new Set([
  'README.md',
  'packages/auth/src/session.js',
  'packages/auth/src/tokens.js',
  'packages/billing/src/invoice.js',
  'packages/billing/src/profile.js',
]);

const report = () => {
  const t = readText(REPORT);
  if (t === null) fail(`${REPORT} was not written`);
  return t;
};
const ROUTES = ['simple', 'medium', 'complex'];
const band = (n) => (n <= 3 ? 'simple' : n <= 6 ? 'medium' : 'complex');

/** `- Label: value` or `Label: value` (bold and bullets tolerated), first match, value trimmed of markup. */
const field = (text, label) => {
  const m = new RegExp(`^[ \\t>*-]*\\**${label}\\**[ \\t]*:\\**[ \\t]*([^\\n]{0,200})$`, 'im').exec(text);
  return m ? m[1].replace(/[*`_]/g, '').trim() : null;
};
const routeOf = (v) => (v === null ? null : ROUTES.find((r) => new RegExp(`\\b${r}\\b`, 'i').test(v)) || null);
const scoreOf = (text) => {
  const v = field(text, 'Score');
  const m = v === null ? null : /^(\d{1,2})\b/.exec(v);
  return m ? Number(m[1]) : null;
};

const CHECKS = {
  'report-saved': () => {
    const t = report();
    if (scoreOf(t) === null) fail(`${REPORT} has no "Score: N" line`);
    return `saved ${REPORT}`;
  },

  // The score is an integer 1-10, the recommended route is the one its band names (1-3 simple, 4-6 medium, 7-10 complex), and with no
  // override the selected route is the recommended one.
  'score-route-consistent': () => {
    const t = report();
    const score = scoreOf(t);
    if (score === null) fail('no "Score: N" line');
    if (score < 1 || score > 10) fail(`score ${score} is outside 1-10`);
    const rec = routeOf(field(t, 'Recommended route'));
    if (rec === null) fail('no "Recommended route" naming simple, medium or complex');
    if (rec !== band(score)) fail(`score ${score} is the ${band(score)} band but the recommended route is ${rec}`);
    const sel = routeOf(field(t, 'Selected route'));
    if (sel === null) fail('no "Selected route" naming simple, medium or complex');
    const ov = field(t, 'Override');
    if ((ov === null || /^none\b/i.test(ov)) && sel !== rec) fail(`no override, but the selected route ${sel} differs from the recommended ${rec}`);
    return `score ${score} -> ${rec}`;
  },

  // Two named paths in two packages, risk words and a provider dependency: the analyzer scores this 9 (complex). A run that guesses
  // "medium" or scores from the words alone fails.
  'expected-complex': () => {
    const t = report();
    const score = scoreOf(t);
    if (score === null || score < 7) fail(`score ${score} is below 7 (complex) for work that spans two packages`);
    const sel = routeOf(field(t, 'Selected route'));
    if (sel !== 'complex') fail(`selected route is ${sel}, expected complex`);
    return `score ${score}, route complex`;
  },

  // Strict part: the key does not appear in the audit text (everything but the Route Plan section, where the skill hands the original
  // description downstream). Convention part: a [REDACTED...] marker stands in for it. FLAKY-ish: a run may omit the key instead of
  // marking it; that fails here by design (the skill prescribes the marker).
  'secret-redacted': () => {
    const t = report();
    const rp = section(t, /^route plan/i);
    const audit = rp ? t.replace(rp.body, '') : t;
    if (audit.includes(SECRET) || /abcdef1234567890/.test(audit)) fail('the API key appears unredacted in the report');
    if (!/\[REDACTED[^\]\n]{0,40}\]/i.test(audit)) fail('no [REDACTED...] marker where the key was');
    return 'key redacted with a marker';
  },

  // The complex route is the four commands in order, then a stop before implementation until approval.
  'route-plan': () => {
    const t = report();
    const rp = section(t, /^route plan/i, { toEnd: true });
    if (!rp) fail('no "Route Plan" section');
    let at = 0;
    for (const cmd of ['create-prd', 'refine-prd', 'create-trd', 'refine-trd']) {
      const i = rp.body.indexOf(cmd, at);
      if (i < 0) fail(`route plan lacks ${cmd} (in order after the previous command)`);
      at = i + cmd.length;
    }
    if (!/\b(stop|approval|approve)\b/i.test(rp.body.slice(at))) fail('route plan does not stop for approval after refine-trd');
    return 'create-prd, refine-prd, create-trd, refine-trd, then stop';
  },

  // Facts only the repository can give: both named files and session.js imported by 2 files (invoice.js and profile.js), and the span of
  // two packages. A text-only guess cannot print these.
  'repo-facts-cited': () => {
    const t = report();
    for (const p of ['packages/auth/src/session.js', 'packages/billing/src/invoice.js']) if (!t.includes(p)) fail(`the report does not cite ${p}`);
    if (!/imported by 2\b/i.test(t)) fail('the report does not cite that session.js is imported by 2 files');
    if (!/\b(?:2|two) packages\b|\bspan[a-z]{0,3}\b[^\n]{0,80}packages\/billing/i.test(t)) fail('the report does not cite the span of two packages');
    return 'paths, fan-in 2 and package span cited';
  },

  // Team size is not readable: it belongs under Missing Inputs, not in a score.
  'missing-inputs': () => {
    const t = report();
    const mi = section(t, /^missing inputs/i);
    if (!mi) fail('no "Missing Inputs" section');
    if (!/team[ -]size/i.test(mi.body)) fail('Missing Inputs does not list team size');
    const m = /team[ -]size\W{0,3}score\W{0,3}(\d)/i.exec(t.replace(mi.body, ''));
    if (m) fail(`team size was scored (${clean(m[0])})`);
    return 'team size listed as missing';
  },

  // Only the report is written: no new file outside docs/ and no seeded file removed.
  'no-implementation': () => {
    const files = walk('.');
    const extra = files.filter((f) => !SEEDED.has(f) && !f.startsWith('docs/'));
    if (extra.length) fail(`wrote outside docs/: ${extra.slice(0, 5).map(clean).join(', ')}`);
    const gone = [...SEEDED].filter((f) => !files.includes(f));
    if (gone.length) fail(`removed seeded file ${clean(gone[0])}`);
    if (!files.includes(REPORT)) fail(`${REPORT} was not written`);
    return 'only docs/ was written';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
