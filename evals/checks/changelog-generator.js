#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `changelog-generator` eval (evals/skills/changelog-generator). The workspace is a repository tagged
 * v1.0.0 whose eight commits since the tag come from tools/seed-history.sh; the agent writes CHANGELOG.md.
 *
 * Items are found by a keyword of the commit's subject (below; the skill's own script prints a commit body on the lines after the subject, so the keyword must be in the subject), so harmless rewording of the rest of a line does not matter.
 * No check runs git: `history-seeded` looks for the tag file, and `hashes` accepts any well-formed hash (a fabricated one passes).
 * Flaky or convention-bound: `chore-excluded` (the skill's default excludes chore; a changelog that lists it is a plausible reading of
 * "release notes", so this one measures the plugin's convention), `breaking-first` and `version-bump` (a changelog that explains
 * "not 2.0.0" would pass; it is a presence check).
 */

const { fail, readText, headings, section, run } = require('./lib');

const FILE = 'CHANGELOG.md';

/** The commits of tools/seed-history.sh that the changelog must carry: keyword of the subject, scope, and the section it belongs to. */
const ITEMS = [
  { key: /rate limit/i, label: 'rate limiting', scope: 'api', cat: 'features' },
  { key: /dark mode/i, label: 'dark mode', scope: 'ui', cat: 'features' },
  { key: /connection pool/i, label: 'connection pool', scope: 'database', cat: 'fixes' },
  { key: /query indexes/i, label: 'query indexes', scope: 'api', cat: 'performance' },
  { key: /setup steps/i, label: 'setup steps', scope: null, cat: 'documentation' },
  { key: /oauth/i, label: 'OAuth 1.0 removal (! marker)', scope: 'auth', cat: 'breaking' },
  { key: /timeout option/i, label: 'timeout option rename (BREAKING CHANGE footer)', scope: 'config', cat: 'breaking' },
];
const HEAD = {
  breaking: /breaking/i,
  features: /feature/i,
  fixes: /bug\s*fix|fixes/i,
  performance: /perform/i,
  documentation: /doc/i,
};
const NAMES = { breaking: 'Breaking Changes', features: 'Features', fixes: 'Bug Fixes', performance: 'Performance', documentation: 'Documentation' };

const doc = () => {
  const t = readText(FILE);
  if (t === null) fail(`${FILE} was not written`);
  return t;
};
const sec = (text, cat) => section(text, HEAD[cat]);
const lineWith = (body, re) => {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  return i < 0 ? null : `${lines[i]}\n${lines[i + 1] || ''}`; // the next line too: a wrapped bullet may carry the hash
};
const HASH = /(?:[`([])[0-9a-f]{7,40}(?:[`)\]])|\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/;

const CHECKS = {
  // Guards against a fabricated changelog: the agent must have run the seed script, which tags v1.0.0 first.
  'history-seeded': () => {
    if (readText('.git/refs/tags/v1.0.0') === null) fail('tag v1.0.0 does not exist: tools/seed-history.sh was not run');
    return 'v1.0.0 tag present';
  },

  'changelog-saved': () => {
    const t = doc();
    if (headings(t).length === 0) fail(`${FILE} has no markdown heading`);
    return `${FILE} saved`;
  },

  // Both breaking forms land in Breaking Changes, and ordinary features and fixes do not.
  'breaking-section': () => {
    const s = sec(doc(), 'breaking');
    if (!s) fail('no Breaking Changes section');
    for (const it of ITEMS.filter((i) => i.cat === 'breaking')) {
      if (!it.key.test(s.body)) fail(`the Breaking Changes section does not hold ${it.label}`);
    }
    for (const it of ITEMS.filter((i) => i.cat !== 'breaking' && i.cat !== 'fixes')) {
      if (it.key.test(s.body)) fail(`${it.label} is listed under Breaking Changes but is not breaking`);
    }
    if (/connection pool/i.test(s.body)) fail('connection pool fix is listed under Breaking Changes but is not breaking');
    return 'both breaking commits found, no ordinary commit';
  },

  // Each commit is in the section of its type and not in the section of another type.
  categories: () => {
    const t = doc();
    for (const it of ITEMS.filter((i) => i.cat !== 'breaking')) {
      const own = sec(t, it.cat);
      if (!own) fail(`no ${NAMES[it.cat]} section`);
      if (!it.key.test(own.body)) fail(`${it.label} is not under ${NAMES[it.cat]}`);
      for (const other of Object.keys(HEAD).filter((c) => c !== it.cat && c !== 'breaking')) {
        const s = sec(t, other);
        if (s && it.key.test(s.body)) fail(`${it.label} is also listed under ${NAMES[other]}`);
      }
    }
    return 'every commit is under its own category';
  },

  // The commit's scope is named on its line.
  scopes: () => {
    const t = doc();
    for (const it of ITEMS.filter((i) => i.scope)) {
      const s = sec(t, it.cat);
      const line = s && lineWith(s.body, it.key);
      if (!line) fail(`${it.label} not found under ${NAMES[it.cat]}`);
      if (!new RegExp(`\\b${it.scope}\\b`, 'i').test(line)) fail(`the line for ${it.label} does not name its scope "${it.scope}"`);
    }
    return 'scopes named';
  },

  // Each commit line carries a hash (7 to 40 hex characters; well-formed, not verified against git).
  hashes: () => {
    const t = doc();
    for (const it of ITEMS) {
      const s = sec(t, it.cat);
      const line = s && lineWith(s.body, it.key);
      if (!line) fail(`${it.label} not found under ${NAMES[it.cat]}`);
      if (!HASH.test(line)) fail(`the line for ${it.label} has no commit hash`);
    }
    return 'every commit has a hash';
  },

  // Category priority: Breaking Changes is the first category.
  'breaking-first': () => {
    const t = doc();
    const hs = headings(t);
    const at = (cat) => hs.findIndex((h) => HEAD[cat].test(h.text));
    const b = at('breaking');
    if (b < 0) fail('no Breaking Changes section');
    for (const cat of ['features', 'fixes', 'performance', 'documentation']) {
      const i = at(cat);
      if (i >= 0 && i < b) fail(`${NAMES[cat]} comes before Breaking Changes`);
    }
    return 'Breaking Changes comes first';
  },

  // The skill's default excludes chore commits.
  'chore-excluded': () => {
    const t = doc();
    if (/lodash|bump/i.test(t)) fail('the chore commit (bump lodash) is listed');
    return 'chore commit left out';
  },

  // Two breaking commits since 1.0.0: the suggested release is the major bump.
  'version-bump': () => {
    const t = doc();
    if (!/(^|[^\d.])2\.0\.0(?![\d.]*\d)/m.test(t)) fail('the suggested version 2.0.0 (major bump for breaking changes) is not stated');
    return 'suggests 2.0.0';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
