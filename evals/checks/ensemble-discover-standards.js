#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-discover-standards` eval (evals/skills/ensemble-discover-standards). The fixture is a tiny
 * JavaScript library (node:test, eslint, kebab-case files, camelCase functions, a ValidationError class, *-test.js tests) that already has a
 * standards/index.yml with two seeded rules and a CLAUDE.md with no standards pointer. Structure and grounding only: no check shows
 * that the rules are good. Flaky-prone checks are marked FLAKY. The index is read with a small line parser (no YAML dependency); a
 * block scalar (`rule: >`) or a flow-style list is not understood and reads as an empty rule, which the checks report as such.
 */

const path = require('path');
const { fail, readText, walk, need, list, clean, run } = require('./lib');

const FIXTURE = path.resolve(__dirname, '..', 'skills', 'ensemble-discover-standards', 'fixture');
const CATEGORIES = ['naming', 'testing', 'imports', 'error_handling', 'git', 'api'];
const MIN_RULES = 6;
const MIN_CATEGORIES = 3;
const MAX_RULE = 80;
const MAX_EXAMPLE = 60;

const unquote = (v) => {
  const s = v.trim();
  const m = /^(["'])(.*)\1$/.exec(s);
  return m ? m[2] : s;
};

/** The index as { top: { key: scalar }, stack: { key: scalar }, categories: { name: [{ id, rule, example }] } } from a line parse. */
function parseIndex(text) {
  const out = { top: {}, stack: {}, categories: {} };
  let block = null; // 'stack' | 'standards' | null
  let cat = null;
  let item = null;
  const lines = text.split('\n').slice(0, 5000);
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*(#.*)?$/.test(line)) continue;
    const indent = /^ */.exec(line)[0].length;
    const body = line.trim();
    if (indent === 0) {
      const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(body);
      if (!m) continue;
      out.top[m[1]] = unquote(m[2]);
      block = m[1] === 'stack' || m[1] === 'standards' ? m[1] : null;
      cat = null; item = null;
    } else if (block === 'stack') {
      const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(body);
      if (m) out.stack[m[1]] = unquote(m[2]);
    } else if (block === 'standards') {
      const start = /^-\s*(?:([A-Za-z_][\w-]*):\s*(.*))?$/.exec(body);
      if (start && cat) {
        item = { id: '', rule: '', example: undefined };
        out.categories[cat].push(item);
        if (start[1]) item[start[1]] = unquote(start[2]);
        continue;
      }
      const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(body);
      if (!m) continue;
      if (m[2] === '' && (indent <= 4) && !(item && indent > 4)) {
        cat = m[1]; out.categories[cat] = out.categories[cat] || []; item = null;
      } else if (item && ['id', 'rule', 'example'].includes(m[1])) {
        item[m[1]] = unquote(m[2]);
      }
    }
  }
  return out;
}

/** The parsed index from standards/index.yml, or a failure naming what is wrong. */
function loadIndex() {
  const text = readText('standards/index.yml');
  if (text === null) fail('standards/index.yml was not written');
  const idx = parseIndex(text);
  for (const k of ['version', 'generated', 'stack', 'standards']) {
    if (!Object.prototype.hasOwnProperty.call(idx.top, k)) fail(`standards/index.yml has no top-level "${k}" key`);
  }
  return idx;
}

const allRules = (idx) => Object.entries(idx.categories).flatMap(([cat, rules]) => rules.map((r) => ({ cat, ...r })));
const num = (id) => Number(/-(\d+)$/.exec(id)[1]);

const CHECKS = {
  // The index exists and has the four top-level keys (version, generated, stack, standards). The seeded index already does, so this alone
  // does not show a run happened; `rules-wellformed` needs more rules than the seed.
  'index-saved': () => {
    const idx = loadIndex();
    if (!idx.top.version || !idx.top.generated) fail('version or generated is empty');
    return 'standards/index.yml has version, generated, stack and standards';
  },

  // stack.* carries language, framework, test_framework and linter, and matches the fixture (JavaScript, node:test, eslint). FLAKY-prone only
  // if a run writes the language as "Node.js"/"JS": both are accepted.
  'index-stack': () => {
    const { stack } = loadIndex();
    for (const k of ['language', 'framework', 'test_framework', 'linter']) if (!stack[k]) fail(`stack.${k} is missing or empty (use "none" when not found)`);
    if (!/\b(javascript|node(?:\.?js)?|js|ecmascript)\b/i.test(stack.language)) fail(`stack.language is ${JSON.stringify(clean(stack.language))}, the fixture is JavaScript`);
    if (!/node[:\s-]?test|node(?:\.?js)? test runner|built-?in/i.test(stack.test_framework)) fail(`stack.test_framework is ${JSON.stringify(clean(stack.test_framework))}, the fixture uses node:test`);
    if (!/\beslint\b/i.test(stack.linter)) fail(`stack.linter is ${JSON.stringify(clean(stack.linter))}, the fixture uses eslint`);
    return `stack: ${clean(stack.language)} / ${clean(stack.test_framework)} / ${clean(stack.linter)}`;
  },

  // Rules are well formed: known categories only, ids `<category>-NNN` with the category's own prefix and no duplicate, a rule under 80
  // characters, an example (when present) under 60, at least 6 rules over at least 3 categories.
  'rules-wellformed': () => {
    const idx = loadIndex();
    const rules = allRules(idx);
    const seen = new Set();
    for (const cat of Object.keys(idx.categories)) if (!CATEGORIES.includes(cat)) fail(`unknown category ${JSON.stringify(clean(cat))} (expected ${CATEGORIES.join(', ')})`);
    for (const r of rules) {
      if (!new RegExp(`^${r.cat}-\\d{3}$`).test(r.id)) fail(`rule id ${JSON.stringify(clean(r.id))} in ${r.cat} is not ${r.cat}-NNN`);
      if (seen.has(r.id)) fail(`duplicate rule id ${r.id}`);
      seen.add(r.id);
      if (!r.rule) fail(`${r.id} has an empty rule`);
      if (r.rule.length >= MAX_RULE) fail(`${r.id} rule is ${r.rule.length} characters, the limit is under ${MAX_RULE}`);
      if (r.example !== undefined && r.example.length >= MAX_EXAMPLE) fail(`${r.id} example is ${r.example.length} characters, the limit is under ${MAX_EXAMPLE}`);
    }
    const used = Object.keys(idx.categories).filter((c) => idx.categories[c].length > 0);
    if (rules.length < MIN_RULES) fail(`only ${rules.length} rules, expected at least ${MIN_RULES}`);
    if (used.length < MIN_CATEGORIES) fail(`rules in only ${used.length} categories, expected at least ${MIN_CATEGORIES}`);
    return `${rules.length} well-formed rules across ${used.length} categories`;
  },

  // Merge-first: each `--keep <id>:<phrase>,...` rule still exists under that id with its phrase in the rule text, and every other rule in
  // that category has a higher number (new ids continue after the existing highest). A run that regenerated the index from scratch loses
  // the seeded testing rule or restarts numbering at 001.
  'merge-preserved': (o) => {
    const idx = loadIndex();
    const rules = allRules(idx);
    for (const spec of list(need(o, 'keep'))) {
      const [id, phrase] = spec.split(':');
      const r = rules.find((x) => x.id === id);
      if (!r) fail(`seeded rule ${id} is gone: the existing index was replaced, not merged`);
      if (!r.rule.toLowerCase().includes(phrase.toLowerCase())) fail(`seeded rule ${id} no longer says "${phrase}": ${JSON.stringify(clean(r.rule))}`);
      const cat = id.replace(/-\d+$/, '');
      const clash = rules.find((x) => x.cat === cat && x.id !== id && num(x.id) <= num(id) && !list(o.keep).some((s) => s.split(':')[0] === x.id));
      if (clash) fail(`new rule ${clash.id} does not continue after the existing ${id}`);
    }
    return 'seeded rules kept; new ids continue the numbering';
  },

  // The rules describe THIS codebase: at least 3 of 4 facts (camelCase names, a ValidationError/custom error class, *-test.js test files,
  // a barrel/index re-export) appear in the rule or example text, and no rule names a stack the fixture does not have. FLAKY-prone: a run
  // that states the facts in unusual words can miss a pattern; 3 of 4 leaves room for one.
  'rules-grounded': () => {
    const rules = allRules(loadIndex());
    const text = rules.map((r) => `${r.rule} ${r.example || ''}`).join('\n');
    const facts = {
      camelCase: /camel\s?-?case|camelcase/i,
      'custom error class': /\bValidationError\b|custom error|extends\s+Error/i,
      'test file naming': /-test\.js\b|\*-test\b/i,
      'barrel export': /barrel|src\/index|index\.js|re-?export/i,
    };
    const hit = Object.keys(facts).filter((k) => facts[k].test(text));
    if (hit.length < 3) fail(`rules mention only ${hit.length} of 4 facts about the codebase (${hit.join(', ') || 'none'}); expected camelCase, a custom error class, *-test.js, a barrel export`);
    const foreign = /\b(pytest|jest|mocha|vitest|rspec|django|rails|phoenix|exunit|go test|junit|xunit|snake_case file)\b/i.exec(text);
    if (foreign) fail(`a rule names "${clean(foreign[1])}", which this codebase does not use`);
    return `rules match the codebase (${hit.join(', ')})`;
  },

  // A category with more than 3 rules has its own standards/<category>.md with some content.
  'category-docs': () => {
    const idx = loadIndex();
    const big = Object.keys(idx.categories).filter((c) => idx.categories[c].length > 3 && CATEGORIES.includes(c));
    for (const c of big) {
      const t = readText(`standards/${c}.md`);
      if (t === null) fail(`${c} has ${idx.categories[c].length} rules but standards/${c}.md was not written`);
      if (t.trim().length < 40) fail(`standards/${c}.md is empty or a stub`);
    }
    return big.length ? `expanded files for ${big.join(', ')}` : 'no category has more than 3 rules';
  },

  // CLAUDE.md keeps its original content and gains exactly one pointer to standards/index.yml (not zero, not appended twice).
  'claude-pointer': (o) => {
    const t = readText('CLAUDE.md');
    if (t === null) fail('CLAUDE.md is missing (it exists in the fixture)');
    const original = need(o, 'original');
    if (!t.includes(original)) fail(`CLAUDE.md lost its original content ("${clean(original)}")`);
    const n = t.split('standards/index.yml').length - 1;
    if (n === 0) fail('CLAUDE.md has no pointer to standards/index.yml');
    if (n > 1) fail(`CLAUDE.md references standards/index.yml ${n} times, expected one`);
    return 'CLAUDE.md points to standards/index.yml once';
  },

  // The skill writes only standards/ and CLAUDE.md: every fixture file except CLAUDE.md and standards/index.yml is byte-identical, and
  // every file that is not in the fixture is under standards/.
  'scope-only': () => {
    const fixture = new Set(walk(FIXTURE));
    const files = walk('.');
    const stray = files.filter((f) => !fixture.has(f) && !f.startsWith('standards/') && !/^\.(ensemble|beads)\//.test(f));
    if (stray.length) fail(`files written outside standards/: ${stray.slice(0, 5).map(clean).join(', ')}`);
    for (const f of fixture) {
      if (f === 'CLAUDE.md' || f === 'standards/index.yml') continue;
      const now = readText(f);
      if (now === null) fail(`${clean(f)} was deleted`);
      if (now !== readText(path.join(FIXTURE, f))) fail(`${clean(f)} was modified`);
    }
    return 'only standards/ and CLAUDE.md changed';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, parseIndex };
