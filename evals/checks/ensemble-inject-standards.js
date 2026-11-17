#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-inject-standards` eval. The skill prints a standards block to stdout; the eval prompt asks the
 * agent to also save that block, as printed, to `standards-context.txt`, and every check reads that file (and the seeded index).
 * A rule is recognised by a short distinctive phrase from its text in the seeded `standards/index.yml` (`--must 'a,b'`), matched
 * case-insensitively as a plain substring, so harmless reflowing or a different bullet marker does not matter.
 * Format-sensitive (likely to be flaky if the agent paraphrases the printed block): header-stack, example-inline, rule-count, footer-handoff.
 */

const crypto = require('crypto');
const { fail, readText, readRequired, walk, need, list, clean, run } = require('./lib');

const BULLET = /^\s*[-*•]\s+\S/;
const OUT = (o) => need(o, 'file');
const outText = (o) => readRequired(OUT(o), OUT(o));
const lc = (s) => s.toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CHECKS = {
  // The printed block was saved at all, and is not blank.
  'context-saved': (o) => {
    const t = outText(o);
    if (t.trim() === '') fail(`${clean(OUT(o))} is empty`);
    return `saved ${clean(OUT(o))}`;
  },
  // Header "=== RELEVANT STANDARDS FOR: <task> ===" naming the task, and "Stack: <language> + <framework>" read from the index.
  'header-stack': (o) => {
    const lines = outText(o).split('\n');
    const head = lines.find((l) => /^\s*=+\s*RELEVANT STANDARDS FOR:/i.test(l));
    if (!head) fail('no "=== RELEVANT STANDARDS FOR: <task> ===" header line');
    if (!lc(head).includes(lc(need(o, 'task-word')))) fail(`the header does not carry the task (no "${clean(o['task-word'])}")`);
    const stack = new RegExp(`^\\s*Stack:\\s*${escapeRe(need(o, 'lang'))}\\s*\\+\\s*${escapeRe(need(o, 'framework'))}\\s*$`, 'i');
    if (!lines.some((l) => stack.test(l))) fail(`no "Stack: ${clean(o.lang)} + ${clean(o.framework)}" line (the index's language and framework)`);
    return 'header names the task; stack line matches the index';
  },
  // Every rule named in --must is printed (universal naming and git rules, or the top-scoring category).
  'rules-present': (o) => {
    const t = lc(outText(o));
    const missing = list(need(o, 'must')).filter((k) => !t.includes(lc(k)));
    if (missing.length) fail(`rules missing from the injected block: ${missing.map(clean).join('; ')}`);
    return `all ${list(o.must).length} required rules present`;
  },
  // None of the rules in --none (categories scoring 0 for this task) is printed.
  'rules-absent': (o) => {
    const t = lc(outText(o));
    const present = list(need(o, 'none')).filter((k) => t.includes(lc(k)));
    if (present.length) fail(`irrelevant rules were injected: ${present.map(clean).join('; ')}`);
    return 'no irrelevant rule injected';
  },
  // Between --min and --max rule bullets (the skill selects 5-8). Format-sensitive: counts bullet lines.
  'rule-count': (o) => {
    const n = outText(o).split('\n').filter((l) => BULLET.test(l)).length;
    const min = Number(need(o, 'min'));
    const max = Number(need(o, 'max'));
    if (n < min || n > max) fail(`${n} rule bullets, expected ${min}-${max}`);
    return `${n} rule bullets`;
  },
  // A rule whose index entry has an example carries it inline as "[example: ...]". Format-sensitive.
  'example-inline': (o) => {
    const lines = outText(o).split('\n').filter((l) => BULLET.test(l));
    for (const k of list(need(o, 'rules'))) {
      const line = lines.find((l) => lc(l).includes(lc(k)));
      if (!line) fail(`rule "${clean(k)}" is not printed as a bullet`);
      if (!/\[example:\s*\S/i.test(line)) fail(`rule "${clean(k)}" has no inline [example: ...]`);
    }
    return 'examples appended inline';
  },
  // The footer pointing at the full index and the handoff note. Format-sensitive.
  'footer-handoff': (o) => {
    const t = outText(o);
    if (!/Full index:\s*standards\/index\.yml/i.test(t)) fail('no "Full index: standards/index.yml" footer');
    if (!/Standards injected/i.test(t)) fail('no "Standards injected" handoff note');
    if (!/standards discover/i.test(t)) fail('no hint to refresh with standards discover');
    return 'footer and handoff note present';
  },
  // The skill never modifies the index: byte-identical to the seeded one (sha256 of the seeded file).
  'index-unchanged': (o) => {
    const t = readText('standards/index.yml');
    if (t === null) fail('standards/index.yml is missing (deleted or moved)');
    const sha = crypto.createHash('sha256').update(t).digest('hex');
    if (sha !== need(o, 'sha')) fail('standards/index.yml was modified');
    return 'standards/index.yml unchanged';
  },
  // Nothing but the seeded index and the saved block: the skill implements nothing and writes no other file.
  'only-expected-files': (o) => {
    const allow = new Set(list(need(o, 'allow')));
    const extra = walk('.').filter((f) => !allow.has(f) && !/^\.(ensemble|beads)\//.test(f));
    if (extra.length) fail(`unexpected files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files beyond the saved block';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
