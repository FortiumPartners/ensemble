#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `safe-migration` skill eval (evals/skills/safe-migration). The skill makes a schema change safe:
 * a `## Migration Plan` in the TRD sequencing expand -> migrate -> contract, a dry run on a copy, a rollback file before any
 * destructive step, and a separate approval for the contract phase. These checks read what the run wrote; nothing is executed.
 *
 * Usage: node evals/checks/safe-migration.js <check> [--table users] [--old fullname] [--new first_name,last_name] [--file path]
 *
 * Flaky by nature (phrasing): plan-dry-run and plan-approval-gate match words, not meaning. The rest test files, headings and SQL
 * statements. The checks test structure and gates, not whether the plan is good.
 */

const path = require('path');
const { clean, fail, readText, listFiles, walk, need, list, run, section } = require('./lib');

const IDENT = /^\w{1,64}$/;
const ident = (v, what) => (IDENT.test(String(v)) ? String(v) : fail(`bad ${what} name`));

/** Index just past the first whole word `word` at or after `from` in lower-cased text, else -1 (indexOf loop: linear, no backtracking). */
function wordEnd(lower, word, from) {
  const isWord = (c) => c !== undefined && /\w/.test(c);
  let at = lower.indexOf(word, from);
  while (at !== -1) {
    if (!isWord(lower[at - 1]) && !isWord(lower[at + word.length])) return at + word.length;
    at = lower.indexOf(word, at + 1);
  }
  return -1;
}

/** The body of the `Migration Plan` section (level 2 or 3 heading) of the first TRD under docs/TRD/ that has one. */
function plan() {
  const files = listFiles('docs/TRD', /\.md$/);
  if (files.length === 0) fail('no TRD under docs/TRD/');
  for (const f of files) {
    const text = readText(path.join('docs/TRD', f));
    const s = text === null ? null : section(text, /^migration plan\b/i);
    if (s && s.level >= 2 && s.level <= 3) return { file: f, body: s.body };
  }
  return fail('no `## Migration Plan` section in a TRD under docs/TRD/');
}

/** New files the run added under db/ (not the seeded migrations). */
const SEEDED = new Set(['db/migrations/001_create_users.sql']);
const newDbFiles = () => walk('.').filter((f) => f.startsWith('db/') && !SEEDED.has(f));

/** A rollback is a docs/migrations/*rollback*.md, or a down/rollback script or migration under db/ or docs/migrations/. */
const ROLLBACK_NAME = /(?:rollback|(?:^|[/_.-])down(?:[_.-]|$))/i;
const rollbackFiles = () => walk('.').filter((f) => (f.startsWith('docs/migrations/') || f.startsWith('db/')) && ROLLBACK_NAME.test(path.basename(f)) && !SEEDED.has(f));

/** Statements of a SQL text, comments removed; statements split on `;`. */
const statements = (sql) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').split(';').map((s) => s.trim()).filter(Boolean);

const CHECKS = {
  // The plan is recorded in the TRD, under a Migration Plan heading, and says something.
  'plan-section': () => {
    const p = plan();
    const words = p.body.split(/\s+/).filter(Boolean).length;
    if (words < 40) fail(`the Migration Plan in ${p.file} has only ${words} words`);
    return `Migration Plan in docs/TRD/${p.file} (${words} words)`;
  },

  // expand, then migrate (or backfill / dual-write), then contract, in that order, as whole words.
  'plan-phases': () => {
    const lower = plan().body.toLowerCase();
    const e = wordEnd(lower, 'expand', 0);
    if (e < 0) fail('the Migration Plan never names the expand phase');
    let m = -1;
    for (const w of ['migrate', 'backfill', 'dual-write']) {
      const at = wordEnd(lower, w, e);
      if (at >= 0 && (m < 0 || at < m)) m = at;
    }
    if (m < 0) fail('no migrate/backfill phase after expand in the Migration Plan');
    if (wordEnd(lower, 'contract', m) < 0) fail('no contract phase after migrate in the Migration Plan');
    return 'expand, migrate, contract in order';
  },

  // FLAKY (phrasing): a dry run on a copy or snapshot, and row counts. Words, not meaning.
  'plan-dry-run': () => {
    const lower = plan().body.toLowerCase();
    if (!/dry[- ]?run|restored (?:copy|snapshot)|copy of (?:the )?(?:production|prod)\b|snapshot/.test(lower)) fail('the Migration Plan records no dry run on a copy or snapshot');
    if (!/\brow counts?\b|\bcount\(\*\)|\brows\b/.test(lower)) fail('the Migration Plan records no row counts for the dry run');
    return 'dry run on a copy with row counts recorded';
  },

  // FLAKY (phrasing): the contract phase needs its own approval; looks for "approv" within 300 characters of "contract".
  'plan-approval-gate': () => {
    const lower = plan().body.toLowerCase();
    let from = 0;
    for (;;) {
      const at = lower.indexOf('approv', from);
      if (at < 0) break;
      if (lower.slice(Math.max(0, at - 300), at + 300).includes('contract')) return 'the contract phase is gated on approval';
      from = at + 1;
    }
    return fail('the Migration Plan does not say the contract phase needs approval');
  },

  // A new migration under db/ that only adds the new columns, nullable or with a default (old code keeps inserting without them).
  'expand-migration': (o) => {
    const table = ident(need(o, 'table'), 'table');
    const cols = list(need(o, 'new')).map((c) => ident(c, 'column'));
    const files = newDbFiles().filter((f) => /\.sql$/i.test(f) && !ROLLBACK_NAME.test(path.basename(f)));
    if (files.length === 0) fail('no new .sql migration under db/');
    const text = files.map((f) => readText(f) || '').join(';\n');
    const stmts = statements(text).filter((s) => new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?["\`]?${table}\\b`, 'i').test(s));
    for (const c of cols) {
      const add = new RegExp(`\\badd\\s+(?:column\\s+)?(?:if\\s+not\\s+exists\\s+)?["\`]?${c}\\b`, 'i');
      const clauses = stmts.flatMap((s) => s.split(/,\s*(?=add\s)/i)).filter((cl) => add.test(cl));
      if (clauses.length === 0) fail(`no migration adds the column ${c} to ${table}`);
      const bad = clauses.find((cl) => /\bnot\s+null\b/i.test(cl) && !/\bdefault\b/i.test(cl));
      if (bad) fail(`${c} is added NOT NULL with no default, which breaks old code that inserts without it: ${clean(bad.replace(/\s+/g, ' '))}`);
    }
    return `${files.join(', ')} adds ${cols.join(', ')} as nullable or defaulted columns`;
  },

  // A rollback file exists and is not a stub.
  'rollback-saved': () => {
    const files = rollbackFiles();
    if (files.length === 0) fail('no rollback file (docs/migrations/<date>-<slug>-rollback.md, or a down migration/script)');
    const sized = files.filter((f) => (readText(f) || '').split('\n').filter((l) => l.trim()).length >= 3);
    if (sized.length === 0) fail(`rollback file ${clean(files[0])} is a stub (fewer than 3 non-blank lines)`);
    return `rollback file ${sized[0]}`;
  },

  // The rollback names the real table and columns, has an undo command, and (for a document) says how data is restored.
  'rollback-content': (o) => {
    const table = ident(need(o, 'table'), 'table').toLowerCase();
    const cols = [need(o, 'old'), ...list(need(o, 'new'))].map((c) => ident(c, 'column').toLowerCase());
    const files = rollbackFiles();
    if (files.length === 0) fail('no rollback file');
    const reasons = [];
    for (const f of files) {
      const lower = (readText(f) || '').toLowerCase();
      if (wordEnd(lower, table, 0) < 0 || !cols.some((c) => wordEnd(lower, c, 0) >= 0)) { reasons.push(`${f} names neither the ${table} table nor its columns`); continue; }
      if (!/\b(?:alter|drop|update|truncate|delete|restore|pg_restore|psql)\b/.test(lower)) { reasons.push(`${f} has no undo command`); continue; }
      if (/\.md$/i.test(f) && !/\b(?:backup|snapshot|restore[ds]?|pg_restore|point-in-time|pitr)\b/.test(lower)) { reasons.push(`${f} does not say how data is restored (backup or snapshot)`); continue; }
      return `${f} names ${table}, has undo commands${/\.md$/i.test(f) ? ' and a restore path' : ''}`;
    }
    return fail(reasons.join('; '));
  },

  // Outside docs/, no script or migration (other than a down/rollback one) that drops or renames the old column, drops a table or truncates.
  'no-early-destructive': (o) => {
    const old = ident(need(o, 'old'), 'column');
    const bad = [
      new RegExp(`\\bdrop\\s+column\\s+(?:if\\s+exists\\s+)?["\`]?${old}\\b`, 'i'),
      new RegExp(`\\brename\\s+column\\s+["\`]?${old}\\b`, 'i'),
      new RegExp(`\\balter\\s+column\\s+["\`]?${old}["\`]?\\s+(?:set\\s+data\\s+)?type\\b`, 'i'),
      /\bdrop\s+table\b/i,
      /\btruncate\b/i,
    ];
    for (const f of walk('.')) {
      if (f.startsWith('docs/') || /^\.(?:ensemble|beads)\//.test(f) || ROLLBACK_NAME.test(path.basename(f))) continue;
      const text = readText(f);
      if (text === null) continue;
      const hit = bad.find((re) => re.test(text));
      if (hit) fail(`${clean(f)} contains a destructive step on the old shape (${clean(hit.source.slice(0, 40))}) before approval`);
    }
    return `no destructive step on ${old} outside rollback files and docs`;
  },

  // The applied migration still creates the old column and was not rewritten to add the new ones (history is never edited).
  'history-immutable': (o) => {
    const text = readText(need(o, 'file'));
    if (text === null) return fail(`${clean(o.file)} was deleted`);
    const old = ident(need(o, 'old'), 'column');
    if (!new RegExp(`\\bcreate\\s+table\\s+users\\b[\\s\\S]{0,500}\\b${old}\\b`, 'i').test(text)) fail(`${clean(o.file)} no longer creates users.${old}; an applied migration must not be edited`);
    if (/\b(?:first_name|last_name)\b/i.test(text)) fail(`${clean(o.file)} was edited in place to add the new columns; add a new migration instead`);
    return `${o.file} unchanged in substance`;
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
