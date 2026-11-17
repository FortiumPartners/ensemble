#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-fold-prompt` eval (evals/skills/ensemble-fold-prompt). Each check is one named function; the
 * working directory is the agent's workspace. They read the rewritten CLAUDE.md and the `.claude/` files the skill's "Expected
 * Output" names, and measure the limits the skill's own Step 4.1 states (Quick Reference in the first 20 lines, no prose paragraph
 * over 3 lines, paths resolve, a standards section with at least 3 entries) plus the token budget (about 2000 tokens).
 * They show structure and limits, not that the standards are correct or the prose good.
 *
 * Flaky / phrasing-dependent (prefer the others when judging a run): `standards-section` (term lists are matched case-insensitively
 * but a standard worded unexpectedly misses), `context-notes` (four keyword rules), `standards-index` (the index schema is only
 * loosely prescribed: key: value lines plus a category word), `quick-reference` (needs a markdown table, as the skill prescribes).
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, readRequired, walk, need, list, clean, headings, section, run } = require('./lib');

const CLAUDE = 'CLAUDE.md';
const INDEX_FILES = ['.claude/standards-index.yml', '.claude/standards-index.yaml'];

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const claude = () => readRequired(CLAUDE, CLAUDE);
const lines = (t) => t.split(/\r?\n/);
const indexText = () => { for (const f of INDEX_FILES) { const t = readText(f); if (t !== null) return t; } return null; };

/** Paragraphs of prose: runs of lines that are not blank, headings, list items (and their continuations), tables, quotes or fenced code. */
function paragraphs(text) {
  const out = [];
  let cur = null;
  let fenced = false;
  let inList = false;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  lines(text).forEach((line, i) => {
    if (/^\s*(?:```|~~~)/.test(line)) { fenced = !fenced; flush(); return; }
    if (fenced) return;
    if (line.trim() === '') { flush(); inList = false; return; }
    if (/^#{1,6}\s/.test(line) || /^\s*\|/.test(line) || /^\s*>/.test(line)) { flush(); inList = false; return; }
    if (LIST_ITEM.test(line)) { flush(); inList = true; return; }
    if (inList && /^\s+\S/.test(line)) return; // continuation of a list item
    inList = false;
    if (!cur) cur = { start: i + 1, rows: [] };
    cur.rows.push(line);
  });
  flush();
  return out;
}

/** Rendered length of a paragraph in 110-column lines: a 400-character single line counts as 4. */
const renderedLines = (p) => p.rows.reduce((n, r) => n + Math.max(1, Math.ceil(r.length / 110)), 0);

/** Backticked path-like tokens and `.claude/` pointers in the text. Bounded scan; no nested quantifiers. */
function pathRefs(text) {
  const refs = new Set();
  const tick = /`([^`\n]{1,200})`/g;
  let m;
  while ((m = tick.exec(text)) !== null) refs.add(m[1].trim());
  return [...refs].filter((t) => /^[\w.@-]+(?:\/[\w.@-]+)+\/?$/.test(t) && !/^[a-z]+:\/\//i.test(t)).filter((t) => {
    const first = t.split('/')[0];
    const last = t.replace(/\/$/, '').split('/').pop();
    return /\.[A-Za-z0-9]{1,6}$/.test(last) || first.startsWith('.') || fs.existsSync(first);
  });
}

const exists = (rel) => {
  const abs = path.resolve(rel);
  if (!abs.startsWith(`${process.cwd()}${path.sep}`)) return true; // outside the workspace: not a claim about the project
  try { fs.lstatSync(abs); return true; } catch { return false; }
};

const CHECKS = {
  // CLAUDE.md opens with a Quick Reference section (within the first 20 lines) holding a markdown command table and the test command.
  'quick-reference': (o) => {
    const text = claude();
    const head = lines(text).slice(0, 20);
    const at = head.findIndex((l) => /^#{1,6}\s+.*quick\s*ref/i.test(l));
    if (at < 0) fail('no Quick Reference heading in the first 20 lines of CLAUDE.md');
    const cmd = need(o, 'test-cmd');
    if (!head.slice(at).some((l) => l.includes(cmd))) fail(`the test command "${clean(cmd)}" is not in the first 20 lines`);
    if (!head.slice(at).some((l) => /^\s*\|.*\|\s*$/.test(l))) fail('the first 20 lines hold no markdown table of commands');
    return `Quick Reference at line ${at + 1} with the test command and a command table`;
  },

  // The core file fits the token budget (about 4 characters a token; the skill targets 2000 tokens).
  'size-budget': (o) => {
    const text = claude();
    const max = Number(need(o, 'max-chars'));
    if (text.trim().length < 200) fail(`CLAUDE.md is ${text.trim().length} characters: emptied, not optimized`);
    if (text.length > max) fail(`CLAUDE.md is ${text.length} characters, over the ${max} budget (about ${Math.round(max / 4)} tokens)`);
    return `${text.length} characters (budget ${max})`;
  },

  // No prose paragraph longer than 3 rendered lines (the skill's Step 4.1 gate).
  'no-long-prose': () => {
    const text = claude();
    const long = paragraphs(text).filter((p) => renderedLines(p) > 3);
    if (long.length > 0) fail(`${long.length} prose paragraph(s) longer than 3 lines, first at line ${long[0].start}: "${clean(long[0].rows[0].slice(0, 60))}"`);
    return 'no prose paragraph over 3 lines';
  },

  // A "Coding Standards" section with at least 3 bullet entries; each --require term (a regular expression, comma separated) appears in it or in the index file.
  'standards-section': (o) => {
    const text = claude();
    const sec = section(text, /^coding standards/i);
    if (!sec) fail('no "Coding Standards" section in CLAUDE.md');
    const bullets = lines(sec.body).filter((l) => LIST_ITEM.test(l));
    if (bullets.length < 3) fail(`the Coding Standards section has ${bullets.length} entries; at least 3 are required`);
    const hay = `${sec.body}\n${indexText() || ''}`;
    const missing = list(need(o, 'require')).filter((term) => !new RegExp(term, 'i').test(hay));
    if (missing.length > 0) fail(`the discovered standards do not mention: ${missing.map(clean).join(', ')}`);
    return `${bullets.length} standards entries covering the code's conventions`;
  },

  // Every file path CLAUDE.md names in backticks exists (a deleted file is context rot).
  'paths-resolve': () => {
    const text = claude();
    const refs = pathRefs(text);
    const gone = refs.filter((r) => !exists(r));
    if (gone.length > 0) fail(`CLAUDE.md names path(s) that do not exist: ${gone.slice(0, 5).map(clean).join(', ')}`);
    return `${refs.length} path reference(s), all resolve`;
  },

  // Reference material moved out: CLAUDE.md points to .claude/patterns/*.md files that exist and hold it; the inlined material is mostly gone.
  'progressive-disclosure': (o) => {
    const text = claude();
    const ptr = [...new Set((text.match(/\.claude\/patterns\/[\w.-]{1,80}\.md/g) || []))];
    if (ptr.length === 0) fail('CLAUDE.md points to no .claude/patterns/*.md file');
    for (const p of ptr) {
      const body = readText(p);
      if (body === null) fail(`CLAUDE.md points to ${p}, which does not exist`);
      if (lines(body).filter((l) => l.trim() !== '').length < 3) fail(`${p} is nearly empty`);
      if (!/express|router|handler|route/i.test(body)) fail(`${p} holds none of the extracted route patterns`);
    }
    const marker = o['moved-re'] || '^- Pattern \\d+:';
    const left = lines(text).filter((l) => new RegExp(marker).test(l)).length;
    if (left > 5) fail(`${left} lines of the inlined pattern reference are still in CLAUDE.md`);
    return `${ptr.length} pointer(s) to existing pattern file(s); ${left} inlined pattern line(s) left`;
  },

  // A "Context Notes" section, the last section of the file, at most 5 bullets, carrying the three guidance rules.
  'context-notes': () => {
    const text = claude();
    const hs = headings(text);
    const sec = section(text, /^context notes/i, { toEnd: true });
    if (!sec) fail('no "Context Notes" section in CLAUDE.md');
    if (!hs.length || !/^context notes/i.test(hs[hs.length - 1].text)) fail('"Context Notes" is not the last section (the skill puts it at the bottom)');
    const bullets = lines(sec.body).filter((l) => LIST_ITEM.test(l));
    if (bullets.length < 1 || bullets.length > 5) fail(`Context Notes has ${bullets.length} bullets; 1 to 5 are required`);
    const b = bullets.join('\n');
    const rules = [
      ['delegate tasks over 5 files to a subagent', /(?:>\s*5|more than (?:5|five)|over (?:5|five)|(?:5|five)\+)\s*(?:or more )?files/i],
      ['read file sections with offset/limit', /offset|limit/i],
      ['suggest a new session at 60% context', /60\s*%/],
    ].filter(([, re]) => !re.test(b)).map(([what]) => what);
    if (rules.length > 0) fail(`Context Notes lacks the rule(s): ${rules.join('; ')}`);
    return `${bullets.length} bullets carrying the three rules, at the bottom`;
  },

  // .claude/standards-index.yml exists, with at least --min `key: value` lines and a category word; no tabs.
  'standards-index': (o) => {
    const text = indexText();
    if (text === null) fail('.claude/standards-index.yml was not written');
    const min = Number(need(o, 'min'));
    if (text.includes('\t')) fail('the standards index contains a tab; YAML forbids tabs for indentation');
    const entries = lines(text).filter((l) => !/^\s*#/.test(l) && /^\s*(?:-\s+)?[\w.-]{1,60}\s*:\s*\S/.test(l));
    if (entries.length < min) fail(`the standards index has ${entries.length} key: value lines; at least ${min} are required`);
    if (!/naming|testing|imports?|error|git|style|lint/i.test(text)) fail('the standards index names no category (naming, testing, imports, error-handling, git)');
    return `${entries.length} entries in the standards index`;
  },

  // Content the skill must strip (the stale TODO) is gone from CLAUDE.md.
  'stale-removed': (o) => {
    const text = claude();
    const still = list(need(o, 'gone')).filter((s) => text.includes(s));
    if (still.length > 0) fail(`CLAUDE.md still contains stale content: ${still.map(clean).join(', ')}`);
    return 'stale TODO removed';
  },

  // Only CLAUDE.md and files under .claude/ or .ensemble/ changed: every other fixture file is byte-identical and nothing else was added.
  'sources-untouched': (o) => {
    const fixture = need(o, 'fixture');
    const seeded = walk(fixture);
    const changed = [];
    for (const rel of seeded) {
      if (rel === CLAUDE) continue;
      const now = readText(rel);
      if (now === null || now !== readText(path.join(fixture, rel))) changed.push(rel);
    }
    if (changed.length > 0) fail(`source file(s) changed or removed: ${changed.slice(0, 5).map(clean).join(', ')}`);
    const extra = walk('.').filter((f) => !seeded.includes(f) && f !== CLAUDE && !f.startsWith('.claude/') && !f.startsWith('.ensemble/'));
    if (extra.length > 0) fail(`file(s) written outside CLAUDE.md, .claude/ and .ensemble/: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'only CLAUDE.md and .claude/ files changed';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
