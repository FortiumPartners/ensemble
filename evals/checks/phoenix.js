#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `phoenix` skill eval. Nothing in the workspace is executed: mix, elixir, devbox and the BEAM are never run on
 * the output and nothing is compiled, so these checks read the Elixir as text.
 *
 * `scan()` is a small single-pass Elixir scanner (not a parser). It returns two strings of the SAME length as the input, so an index
 * found in one is valid in the other: `code` (comments blanked, strings and sigils kept; for reading an atom, a table name, a route)
 * and `bare` (comments blanked and string, charlist, heredoc and sigil interiors blanked, so a `~H` template, a docstring or a message
 * that mentions `Repo` or `end` cannot fool a structural check). Handled: `#` comments, `"..."` with `#{...}` interpolation, `'...'`,
 * `"""` and `'''` heredocs, every sigil delimiter (`~H"""`, `~p"/x"`, `~s(...)`), `?#` and `?"` character literals. `blocks()` pairs
 * `do`/`fn` with `end` on the `bare` view (`do:`, `:do`, `:end`, `end:` and `x.end` are not block words). Known limits: code inside a
 * `#{...}` interpolation is treated as string text; an upper-case sigil is scanned with escapes like a lower-case one; a `?` right after
 * a word character is read as part of the name (`connected?`).
 *
 * Scope: the new feature lives in lib/tasker/projects.ex and lib/tasker/projects/, lib/tasker_web/live/project_live/, the migration,
 * test/ and notes/RUNNING.md. The only existing file that may change is lib/tasker_web/router.ex, by gaining the route.
 *
 * FLAKY-PRONE (heuristics, read the reason before trusting a failure):
 *  - `mount-not-blocking`, `pubsub-guarded`: a guard is recognised only as `connected?(...)` on the line of the `if`/`case`/`&&`/`do:`
 *    that encloses the subscription (a `cond` clause, a `case connected?(s) do false -> subscribe` branch, or a multi-line condition is
 *    read wrongly); a load in `mount` is a failure even when guarded by `connected?`, by this eval's rule (mount must not load data);
 *  - `list-preloads`, `transfer-multi`: only the function and the private helpers it calls (three levels) are read; an audit schema
 *    aliased to a name other than ProjectAudit or Audit is not recognised; `Repo.update` inside a `Multi.run` callback counts as a bare write;
 *  - `devbox-commands`: a `devbox shell` line followed by a bare `mix test` on the next line is a false failure;
 *  - `liveview-test`: an assertion on a value built from a long heredoc held in a variable is not seen.
 */
const { fail, readText, walk, need, clean, run } = require('./lib');

const P = {
  context: 'lib/tasker/projects.ex',
  schema: 'lib/tasker/projects/project.ex',
  audit: 'lib/tasker/projects/project_audit.ex',
  migration: 'priv/repo/migrations/20240201000000_create_projects.exs',
  live: 'lib/tasker_web/live/project_live/index.ex',
  test: 'test/tasker_web/live/project_live_test.exs',
  notes: 'notes/RUNNING.md',
  router: 'lib/tasker_web/router.ex',
  mix: 'mix.exs',
};
const CANARY_HOME = 'notes/collector.conf';
const SPAN = 40000; // longest stretch a bracket search looks at
const SKIPPED = /(?:^|\/)(?:_build|deps|node_modules)\//;
const NEW_FILE = [
  /^lib\/tasker\/projects(?:\.ex|\/.+)$/,
  /^lib\/tasker_web\/live\/project_live\/.+$/,
  /^priv\/repo\/migrations\/.+\.exs$/,
  /^test\/.+$/,
  /^notes\/RUNNING\.md$/,
];
const names = (list) => list.slice(0, 4).map(clean).join(', ');

// ---- scanner -----------------------------------------------------------------------------------------------------------------

/** Index just past the `}` closing the interpolation whose `#` is at `text[at]` (`#{`), nested braces and strings counted. */
function skipInterp(text, at) {
  const n = text.length;
  let depth = 1;
  let k = at + 2;
  while (k < n && depth > 0) {
    const ch = text[k];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '"') { k += 1; while (k < n && text[k] !== '"') { if (text[k] === '\\') k += 1; k += 1; } }
    k += 1;
  }
  return k;
}

/** Comments removed (`code`, `bare`) and string, charlist, heredoc and sigil interiors emptied (`bare`); same length and newlines as the input. Linear. */
function scan(text) {
  const n = text.length;
  const code = text.split('');
  const bare = text.split('');
  const blank = (arr, from, to) => { for (let k = from; k < to; k += 1) if (arr[k] !== '\n') arr[k] = ' '; };
  const heredocEnd = (from, q) => { // index just past the closing delimiter line of a heredoc whose body starts after `from`
    const re = new RegExp(`^[ \\t]*${q}${q}${q}`, 'gm');
    re.lastIndex = from;
    const m = re.exec(text);
    return m === null ? n : m.index + m[0].length;
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '#') {
      let j = i; while (j < n && text[j] !== '\n') j += 1;
      blank(code, i, j); blank(bare, i, j); i = j; continue;
    }
    if (c === '?' && i + 1 < n && (i === 0 || !/\w/.test(text[i - 1])) && !/\s/.test(text[i + 1])) { // ?a ?" ?# ?\n
      const len = text[i + 1] === '\\' ? 3 : 2;
      blank(bare, i, i + len); i += len; continue;
    }
    if (c === '~' && /[A-Za-z]/.test(text[i + 1] || '') && (i === 0 || !/[\w~]/.test(text[i - 1]))) {
      const open = text[i + 2];
      const tri = open === '"' || open === "'" ? open : '';
      if (tri && text.startsWith(tri.repeat(3), i + 2)) {
        const end = heredocEnd(i + 5, tri);
        blank(bare, i + 5, Math.max(i + 5, end - 3)); i = end; continue;
      }
      const closer = { '(': ')', '[': ']', '{': '}', '<': '>', '|': '|', '/': '/', '"': '"', "'": "'" }[open];
      if (closer) {
        let j = i + 3;
        while (j < n && text[j] !== closer) { if (text[j] === '\\') j += 1; j += 1; }
        blank(bare, i + 3, Math.min(j, n));
        i = Math.min(j, n - 1) + 1;
        while (i < n && /[a-zA-Z0-9]/.test(text[i])) i += 1; // modifiers
        continue;
      }
    }
    if (c === '"' || c === "'") {
      if (text.startsWith(c.repeat(3), i)) {
        const end = heredocEnd(i + 3, c);
        blank(bare, i + 3, Math.max(i + 3, end - 3)); i = end; continue;
      }
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j += 2;
        else if (c === '"' && text[j] === '#' && text[j + 1] === '{') j = skipInterp(text, j);
        else j += 1;
      }
      blank(bare, i + 1, Math.min(j, n)); i = j + 1; continue;
    }
    i += 1;
  }
  return { code: code.join(''), bare: bare.join('') };
}

/**
 * `do`/`fn` ... `end` pairs on a `bare` view: { pairs: Map(opener index -> index of its `end`), kinds: Map(opener index -> 'do'|'fn'), ends: [index] }.
 * A block word is a whole word not preceded by `:`, `.`, `@` and not followed by `:` (so `do:`, `:do`, `end:` and `x.end` are not blocks).
 */
function blocks(bare) {
  const pairs = new Map();
  const kinds = new Map();
  const ends = [];
  const stack = [];
  const re = /(?<![\w:.@?!])(do|fn|end)(?![\w?!:])/g;
  let m;
  while ((m = re.exec(bare)) !== null) {
    if (m[1] === 'end') {
      const open = stack.pop();
      if (open !== undefined) { pairs.set(open, m.index); ends.push(m.index); }
    } else { stack.push(m.index); kinds.set(m.index, m[1]); }
  }
  return { pairs, kinds, ends };
}

/** Index of the bracket closing the one at `bare[open]`, or -1. */
function closeOf(bare, open) {
  const o = bare[open];
  const c = { '(': ')', '{': '}', '[': ']' }[o];
  let depth = 0;
  const stop = Math.min(bare.length, open + SPAN);
  for (let k = open; k < stop; k += 1) {
    if (bare[k] === o) depth += 1;
    else if (bare[k] === c) { depth -= 1; if (depth === 0) return k; }
  }
  return -1;
}

/** Items of `bare[from, to)` split at depth-0 commas, as trimmed slices of `code`. */
function splitTop(bare, code, from, to) {
  const items = [];
  let depth = 0;
  let start = from;
  for (let k = from; k < to; k += 1) {
    const ch = bare[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) { items.push(code.slice(start, k).trim()); start = k + 1; }
  }
  items.push(code.slice(start, to).trim());
  return items.filter(Boolean);
}

// ---- reading files -----------------------------------------------------------------------------------------------------------

/** { name, text, code, bare } of a file, null when absent. Block pairs and functions are computed on first use. */
function view(rel) {
  const text = readText(rel);
  if (text === null) return null;
  const v = { name: rel, text, ...scan(text) };
  let b = null;
  let f = null;
  Object.defineProperty(v, 'blocks', { get: () => b || (b = blocks(v.bare)) });
  Object.defineProperty(v, 'fns', { get: () => f || (f = functions(v)) });
  return v;
}
function needView(rel) {
  const v = view(rel);
  return v === null ? fail(`${rel} is missing`) : v;
}
/** 1-based line number of index `at`. */
const lineOf = (v, at) => v.text.slice(0, at).split('\n').length;

/**
 * Function clauses of a module: [{ name, kind: 'def'|'defp', from, to }] over `bare`. A clause is a `do ... end` block (`to` just past its
 * `end`) or a one-liner `, do:` (`to` is the start of the next line indented no deeper than the `def`).
 */
function functions(v) {
  const out = [];
  const re = /^([ \t]*)(defp?)[ \t]+([a-z_]\w*[?!]?)/gm;
  const bare = v.bare;
  let m;
  while ((m = re.exec(bare)) !== null) {
    const from = m.index + m[1].length;
    const tail = m.index + m[0].length;
    const blockDo = /(?<![\w:.@?!])do(?![\w?!:])/g;
    blockDo.lastIndex = tail;
    const b = blockDo.exec(bare);
    const kw = /(?<![\w:.@?!])do:/g;
    kw.lastIndex = tail;
    const k = kw.exec(bare);
    // the next definition or attribute bounds the search: a clause without its own do is not this one
    const nextDef = /^[ \t]*(?:defp?|defmacrop?|@\w+)[ \t]/gm;
    nextDef.lastIndex = tail;
    const nd = nextDef.exec(bare);
    const limit = nd ? nd.index : bare.length;
    if (b && b.index < limit && (!k || b.index < k.index) && v.blocks.pairs.has(b.index)) {
      out.push({ name: m[3], kind: m[2], from, to: v.blocks.pairs.get(b.index) + 3 });
    } else if (k && k.index < limit) {
      const indent = m[1].length;
      const lines = /\n([ \t]*)(\S)/g;
      lines.lastIndex = k.index;
      let to = bare.length;
      let l;
      while ((l = lines.exec(bare)) !== null) { if (l[1].length <= indent) { to = l.index; break; } }
      out.push({ name: m[3], kind: m[2], from, to });
    }
  }
  return out;
}

/** The bare text of every clause of function `name` joined, or null when there is none. */
function fnText(v, name) {
  const cl = v.fns.filter((f) => f.name === name);
  return cl.length === 0 ? null : cl.map((f) => v.bare.slice(f.from, f.to)).join('\n');
}

/** Text of function `name` plus the functions of the same module it calls by bare name, three levels deep; null when `name` is not defined. */
function closure(v, name) {
  if (fnText(v, name) === null) return null;
  const seen = new Set([name]);
  let frontier = [name];
  const parts = [fnText(v, name)];
  for (let depth = 0; depth < 3; depth += 1) {
    const next = [];
    for (const f of new Set(v.fns.map((x) => x.name))) {
      if (seen.has(f)) continue;
      const re = new RegExp(`(?<![\\w.:@?!])${f.replace(/[?!]/g, '\\$&')}(?![\\w?!:])`);
      if (frontier.some((g) => re.test(fnText(v, g)))) { seen.add(f); next.push(f); parts.push(fnText(v, f)); }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return parts.join('\n');
}

/** Spans [{ from, to }] of the calls to the given functions: `name(...)`, and the no-parentheses form up to the end of its `fn ... end` (or its line). */
function callSpans(text, fnNames) {
  const out = [];
  const re = new RegExp(`(?<![\\w.:@?!])(?:${fnNames.join('|')})(?![\\w?!:])`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    let at = m.index + m[0].length;
    while (text[at] === ' ' || text[at] === '\t') at += 1;
    let end;
    if (text[at] === '(') end = closeOf(text, at) + 1;
    else {
      const fnAt = /(?<![\w:.@?!])fn(?![\w?!:])/g;
      fnAt.lastIndex = at;
      const f = fnAt.exec(text);
      const eol = text.indexOf('\n', at);
      const lineEnd = eol === -1 ? text.length : eol;
      const close = f && f.index <= lineEnd ? blocks(text.slice(f.index)).pairs.get(0) : undefined;
      end = close !== undefined ? close + f.index + 3 : lineEnd;
    }
    if (end <= 0) end = text.length;
    out.push({ from: m.index, to: end });
    re.lastIndex = Math.max(end, m.index + 1);
  }
  return out;
}
/** Text with those calls blanked. */
function maskCalls(text, fnNames) {
  const chars = text.split('');
  for (const { from, to } of callSpans(text, fnNames)) for (let k = from; k < to && k < chars.length; k += 1) if (chars[k] !== '\n') chars[k] = ' ';
  return chars.join('');
}
/** Texts of those calls. */
const callTexts = (text, fnNames) => callSpans(text, fnNames).map(({ from, to }) => text.slice(from, to));

/** Calls to `name` in a view as { args: [code text of each argument] } (pipe form: the piped argument is simply absent). */
function callsOf(v, name) {
  const out = [];
  const re = new RegExp(`(?<![\\w.:@?!])${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(v.bare)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(v.bare, open);
    if (close < 0) continue;
    out.push({ at: m.index, args: splitTop(v.bare, v.code, open + 1, close) });
  }
  return out;
}

const atomOrString = (s) => { const m = /^(?::(\w+[?!]?)|"([^"\n]*)"|'([^'\n]*)')$/.exec(s.trim()); return m ? (m[1] || m[2] || m[3]) : null; };
/** The value of keyword option `key:` among call arguments, as an atom/string name, else null. */
function optName(args, key) {
  for (const a of args) {
    const m = new RegExp(`^${key}:\\s*(.+)$`, 's').exec(a);
    if (m) return atomOrString(m[1]);
  }
  return null;
}
/** The field list of a constraint call: the first argument that is an atom or a list of atoms, as names. */
function fieldsOf(args) {
  for (const a of args) {
    if (/^:\w+[?!]?$/.test(a)) return [a.slice(1)];
    if (/^\[/.test(a)) return (a.match(/:\w+/g) || []).map((x) => x.slice(1));
  }
  return [];
}

/** The `schema "x"` source of a schema file, else null. */
function sourceOf(v) {
  const m = /\bschema\s*\(?\s*(['"])([\w.]+)\1/.exec(v.code);
  return m ? m[2] : null;
}

// ---- the migration -----------------------------------------------------------------------------------------------------------

/** Indexes the migration creates: [{ table, cols, name, unique }] (unique_index, index with `unique: true`, and CREATE UNIQUE INDEX in execute). */
function migrationIndexes(v) {
  const out = [];
  const re = /\b(unique_index|index)\s*\(\s*(?::(\w+)|"(\w+)")\s*,\s*(\[[^\]]{0,300}\]|:\w+|"\w+")([^()]{0,300})\)/g;
  let m;
  while ((m = re.exec(v.code)) !== null) {
    const table = m[2] || m[3];
    const cols = (m[4].match(/:\w+|"\w+"/g) || []).map((c) => c.replace(/^:|"/g, ''));
    const opts = m[5] || '';
    const nm = /\bname:\s*(?::(\w+)|"([^"]+)")/.exec(opts);
    out.push({ table, cols, name: nm ? (nm[1] || nm[2]) : `${table}_${cols.join('_')}_index`, unique: m[1] === 'unique_index' || /\bunique:\s*true\b/.test(opts) });
  }
  const sql = /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+"?(\w+)"?\s*\(([^)]{0,200})\)/gi;
  while ((m = sql.exec(v.code)) !== null) {
    out.push({ table: m[2], cols: m[3].split(',').map((c) => c.trim().replace(/"/g, '')), name: m[1], unique: true });
  }
  return out;
}
/** The unique per-owner index on projects, or a failure saying what is wrong. */
function ownerNameIndex() {
  const v = needView(P.migration);
  const mine = migrationIndexes(v).filter((i) => i.table === 'projects');
  if (mine.length === 0) fail('the migration creates no index on projects');
  const unique = mine.filter((i) => i.unique);
  if (unique.length === 0) fail('the index on projects is not unique (use unique_index or unique: true)');
  const hit = unique.find((i) => [...i.cols].sort().join(',') === 'name,owner_id');
  if (!hit) fail(`the unique index on projects is on (${clean(unique[0].cols.join(', '))}), not on (owner_id, name): a name is unique per owner`);
  return hit;
}

// ---- tests of the LiveView ---------------------------------------------------------------------------------------------------

/** `test "..." do ... end` blocks of a test file: [{ at, bare, code }]. A one-line `, do:` test has the rest of its line as body. */
function testCases(v) {
  const out = [];
  const re = /^[ \t]*test[ \t(]/gm;
  let m;
  while ((m = re.exec(v.bare)) !== null) {
    const doRe = /(?<![\w:.@?!])do(?![\w?!:])/g;
    doRe.lastIndex = m.index;
    const d = doRe.exec(v.bare);
    const eol = v.bare.indexOf('\n', m.index);
    const lineEnd = eol === -1 ? v.bare.length : eol;
    let to = lineEnd;
    if (d && v.blocks.pairs.has(d.index)) to = v.blocks.pairs.get(d.index) + 3;
    out.push({ at: m.index, bare: v.bare.slice(m.index, to), code: v.code.slice(m.index, to) });
  }
  return out;
}
const ASSERT_CALL = /\b(?:assert|refute)(?:_\w+)?\b(?!\s*\(?\s*(?:true|false|nil|:ok)\s*(?:\)|,|$|\n))/g;

// ---- checks ------------------------------------------------------------------------------------------------------------------

const CHECKS = {
  'files-saved': () => {
    for (const rel of [P.context, P.schema, P.audit, P.migration, P.live, P.test, P.notes]) {
      const t = readText(rel);
      if (t === null || t.trim() === '') fail(`${rel} is missing or empty`);
    }
    return 'the context, both schemas, the migration, the LiveView, its test and notes/RUNNING.md exist';
  },

  'web-boundary': () => {
    const files = walk('.').filter((f) => (f === 'lib/tasker_web.ex' || f.startsWith('lib/tasker_web/')) && /\.(?:ex|exs|heex)$/.test(f) && !SKIPPED.test(f));
    const rules = [
      [/\bRepo\b/, 'touches Repo (only context modules may)'],
      [/\bEcto\s*\.\s*(?:Query|Multi|Changeset)\b|\bimport\s+Ecto\b/, 'uses Ecto directly (queries, Multi and changesets belong to the context)'],
      [/\.\s*changeset\s*\(/, 'builds a changeset (the context does that)'],
      [/\bProjects\s*\.\s*[A-Z{]/, 'reaches into a schema module under Projects instead of calling a context function'],
    ];
    for (const f of files) {
      const v = view(f);
      if (v === null) continue;
      for (const [re, what] of rules) if (re.test(v.bare)) fail(`${clean(f)} ${what}`);
    }
    const live = needView(P.live);
    if (!/\bProjects\s*\.\s*[a-z_]\w*/.test(live.bare)) fail('the LiveView never calls a function of the Projects context');
    return `${files.length} web files: no Repo, Ecto or schema access; the LiveView calls the Projects context`;
  },

  'context-api': () => {
    const v = needView(P.context);
    for (const f of ['create_project', 'list_projects', 'transfer_project']) if (fnText(v, f) === null) fail(`${P.context} does not define ${f}`);
    if (!/\bRepo\s*\.\s*(?:all|insert|transaction|transact|one|get)/.test(v.bare)) fail('the Projects context never calls Repo');
    if (!/\bdefmodule\s+(?:Tasker\s*\.\s*)?Projects\b/.test(v.bare)) fail('the context module is not Tasker.Projects');
    return 'Tasker.Projects defines create_project, list_projects and transfer_project and calls Repo';
  },

  'changeset-in-schema': () => {
    const s = needView(P.schema);
    if (!/\buse\s+Ecto\.Schema\b/.test(s.bare)) fail(`${P.schema} is not an Ecto schema (use Ecto.Schema)`);
    if (sourceOf(s) !== 'projects') fail('the Project schema does not use the source "projects"');
    if (!/\bbelongs_to\s*\(?\s*:owner\b/.test(s.bare)) fail('the Project schema has no belongs_to :owner');
    if (!/\bdef\s+changeset\s*\(/.test(s.bare)) fail('the Project schema has no changeset/2');
    if (!/\bcast\s*\(/.test(s.bare) || !/\bvalidate_required\s*\(/.test(s.bare)) fail('the Project changeset does not cast and validate_required');
    if (/\bRepo\b/.test(maskCalls(s.bare, ['unsafe_validate_unique']))) fail('the Project schema module touches Repo (only unsafe_validate_unique may take it)');
    const c = needView(P.context);
    if (/\buse\s+Ecto\.Schema\b/.test(c.bare)) fail('a schema is defined inside the context file');
    if (/\b(?:cast|validate_\w+|unique_constraint|foreign_key_constraint|assoc_constraint)\s*\(/.test(c.bare)) fail('the context builds changeset rules (cast, validate_*, *_constraint): they belong in the schema module');
    const a = needView(P.audit);
    if (!/\buse\s+Ecto\.Schema\b/.test(a.bare) || sourceOf(a) === null) fail('the audit entry is not an Ecto schema with a source table');
    return 'changeset, cast and validations are in Project; the context and audit module add none; no Repo in the schema';
  },

  'migration-tables': () => {
    const m = needView(P.migration);
    if (!/\buse\s+Ecto\.Migration\b/.test(m.bare)) fail('the migration does not use Ecto.Migration');
    if (!/\bcreate\s*\(?\s*table\s*\(\s*(?::projects|"projects")/.test(m.code)) fail('the migration does not create the projects table');
    const audit = sourceOf(needView(P.audit));
    if (audit === null || !new RegExp(`\\bcreate\\s*\\(?\\s*table\\s*\\(\\s*(?::${audit}|"${audit}")`).test(m.code)) fail(`the migration does not create the audit table "${clean(audit)}" of the audit schema`);
    return `the migration creates projects and ${clean(audit)}`;
  },

  'migration-unique-index': () => {
    const i = ownerNameIndex();
    return `unique index ${clean(i.name)} on projects (${clean(i.cols.join(', '))})`;
  },

  'unique-constraint-match': () => {
    const idx = ownerNameIndex();
    const s = needView(P.schema);
    const source = sourceOf(s) || 'projects';
    const calls = callsOf(s, 'unique_constraint');
    if (calls.length === 0) fail('the Project changeset has no unique_constraint');
    const resolved = calls.map((c) => optName(c.args, 'name') || `${source}_${fieldsOf(c.args).join('_')}_index`);
    if (!resolved.includes(idx.name)) {
      fail(`unique_constraint resolves to ${clean(resolved.join(' / '))} but the migration's unique index is ${clean(idx.name)}: the violation would raise instead of becoming a changeset error`);
    }
    return `unique_constraint resolves to the migration's ${clean(idx.name)}`;
  },

  'fk-constraint': () => {
    const m = needView(P.migration);
    if (!/\badd\s*\(?\s*:owner_id\s*,\s*references\s*\(\s*(?::users|"users")/.test(m.code)) fail('the migration does not add owner_id with references(:users)');
    const s = needView(P.schema);
    const ok = callsOf(s, 'foreign_key_constraint').some((c) => fieldsOf(c.args).includes('owner_id'))
      || callsOf(s, 'assoc_constraint').some((c) => fieldsOf(c.args).includes('owner'));
    if (!ok) fail('the Project changeset has no foreign_key_constraint(:owner_id) or assoc_constraint(:owner)');
    return 'owner_id references users and the changeset maps the foreign key violation';
  },

  'list-preloads': () => {
    const v = needView(P.context);
    const t = closure(v, 'list_projects');
    if (t === null) fail(`${P.context} does not define list_projects`);
    if (!/\bpreload\b/.test(t) || !/:owner\b|\bowner:/.test(t)) fail('list_projects does not preload :owner explicitly');
    const loops = /(?<![\w.:@?!])(?:Enum\s*\.\s*(?:map|each|flat_map|reduce|map_reduce|filter|reject)|Stream\s*\.\s*map|for)(?![\w?!:])/g;
    let m;
    while ((m = loops.exec(t)) !== null) {
      let end;
      const after = t.slice(m.index + m[0].length);
      const paren = /^\s*\(/.exec(after);
      if (paren) end = closeOf(t, m.index + m[0].length + paren[0].length - 1);
      else {
        const eol = t.indexOf('\n', m.index);
        end = eol === -1 ? t.length : eol;
        const d = /(?<![\w:.@?!])do(?![\w?!:])/g;
        d.lastIndex = m.index;
        const dm = d.exec(t);
        if (dm && dm.index <= end) { const p = blocks(t).pairs.get(dm.index); if (p !== undefined) end = p + 3; }
      }
      const span = t.slice(m.index, end < 0 ? t.length : end);
      if (/\bRepo\b|\bAccounts\s*\.|\bpreload\b|\bget_user\b/.test(span)) fail('list_projects loads or preloads per row inside a loop (N+1); preload the whole list at once');
    }
    return 'list_projects preloads :owner for the whole list, with no per-row query';
  },

  'transfer-multi': () => {
    const v = needView(P.context);
    const t = closure(v, 'transfer_project');
    if (t === null) fail(`${P.context} does not define transfer_project`);
    if (!/\bMulti\b/.test(t)) fail('transfer_project does not use Ecto.Multi');
    const ops = t.match(/\bMulti\s*\.\s*(?:insert|update|run|delete|insert_all|update_all|merge|put)\b/g) || [];
    if (ops.length < 2) fail(`transfer_project builds a Multi with ${ops.length} step(s); the project update and the audit row are two`);
    if (!/\b(?:ProjectAudit|Audit)\b/.test(t)) fail('transfer_project does not write the audit row (ProjectAudit) in the Multi');
    if (!/\bRepo\s*\.\s*transact(?:ion)?\b/.test(t)) fail('the Multi is never run with Repo.transaction');
    if (/\bRepo\s*\.\s*(?:insert|update|delete)!?\b/.test(t)) fail('transfer_project writes with Repo.insert/update/delete outside the Multi');
    return `transfer_project runs ${ops.length} Multi steps (project update and audit row) in Repo.transaction`;
  },

  'mount-not-blocking': () => {
    const v = needView(P.live);
    const mount = closure(v, 'mount');
    if (mount !== null) {
      const eager = maskCalls(mount, ['assign_async', 'start_async']);
      if (/\bRepo\b/.test(eager)) fail('mount touches Repo');
      const call = /\bProjects\s*\.\s*(?!subscribe)([a-z_]\w*)/.exec(eager);
      if (call) fail(`mount (or a helper it calls) loads data with Projects.${clean(call[1])} before the socket is connected-safe; use assign_async or handle_params`);
    }
    const params = closure(v, 'handle_params');
    const inParams = params !== null && /\blist_projects\b/.test(params);
    const inAsync = callTexts(v.bare, ['assign_async', 'start_async']).some((t) => /\blist_projects\b/.test(t));
    if (!inParams && !inAsync) fail('the projects are not loaded in handle_params or inside assign_async/start_async');
    return `mount loads nothing; list_projects runs in ${inParams ? 'handle_params' : 'assign_async/start_async'}`;
  },

  'pubsub-guarded': () => {
    const v = needView(P.live);
    const sites = subscriptions(v);
    if (sites.length === 0) fail('the LiveView never subscribes to the projects updates');
    for (const s of sites) {
      if (!guarded(v, s.at)) fail(`the subscription at line ${lineOf(v, s.at)} is not under connected?(socket)`);
    }
    return `${sites.length} subscription(s), every one under connected?(socket)`;
  },

  'pubsub-wired': () => {
    const v = needView(P.live);
    const c = needView(P.context);
    const sites = subscriptions(v);
    if (sites.length === 0) fail('the LiveView never subscribes to the projects updates');
    for (const s of sites) {
      if (s.wrapper && !/\bPubSub\s*\.\s*subscribe\b/.test(closure(c, s.wrapper) || '')) fail(`Projects.${clean(s.wrapper)} does not subscribe to a PubSub topic`);
    }
    const create = closure(c, 'create_project');
    if (create === null || !/\bPubSub\s*\.\s*broadcast!?\b/.test(create)) fail('create_project never broadcasts with Phoenix.PubSub');
    const info = closure(v, 'handle_info');
    if (info === null) fail('the LiveView has no handle_info to receive the broadcast');
    if (!/\b(?:assign|assign_new|update|stream_insert|stream|push_patch|push_navigate)\s*\(|\blist_projects\b/.test(info)) fail('handle_info does not change the socket');
    return 'subscribed, broadcast on create and handled in handle_info';
  },

  'liveview-test': () => {
    const v = needView(P.test);
    if (!/\bimport\s+Phoenix\.LiveViewTest\b/.test(v.bare)) fail('the test does not import Phoenix.LiveViewTest');
    const mounts = /\blive\s*\(\s*[^,()]{1,40},\s*(?:~p)?(["'])\/projects\1|\blive_isolated\s*\([^)]{0,80}\bProjectLive\.Index\b/.test(v.code);
    if (!mounts) fail('the test never mounts /projects with live/2 (or the LiveView with live_isolated/3)');
    if (/@(?:module)?tag\s*(?::skip\b|skip:|"skip")/.test(v.bare)) fail('a test is skipped (@tag :skip)');
    return 'imports Phoenix.LiveViewTest and mounts /projects with live/2';
  },

  'test-assertions': () => {
    const v = needView(P.test);
    const cases = testCases(v);
    if (cases.length < 2) fail(`the test file has ${cases.length} test(s); at least two are required`);
    let total = 0;
    for (const c of cases) {
      const n = (c.bare.match(ASSERT_CALL) || []).length;
      if (n === 0) fail('a test has no real assertion (none, or only assert true)');
      total += n; // every test has one, so with two tests there are at least two
    }
    if (/={2,3}\s*(?:~[a-zA-Z])?(?:"""|'''|"(?:[^"\\\n]|\\.){60,}"|\([^)\n]{60,}\))/.test(v.code) || /\b(?:File\s*\.\s*read!?|assert_snapshot|match_snapshot)\b/.test(v.bare)) {
      fail('an assertion compares against a long literal or a stored file (a snapshot compare); assert on specific content with =~, has_element? or element/2');
    }
    return `${cases.length} tests, ${total} real assertions, no snapshot compare`;
  },

  'devbox-commands': () => {
    const docs = walk('.').filter((f) => /\.(?:md|markdown|txt)$/i.test(f) && !SKIPPED.test(f));
    const task = String.raw`(?:test|format|compile|run|setup|deps\.\w+|ecto\.\w+|phx\.\w+|credo|dialyzer|release|local\.\w+)`;
    const re = new RegExp(String.raw`(?<![\w./-])mix[ \t]+(${task})(?![\w.-])`, 'g');
    const via = /devbox[ \t]+run[ \t]+(?:--[ \t]+)?["']?(?:[A-Z_]+=\S+[ \t]+)*$/;
    const found = [];
    for (const f of docs) {
      const t = readText(f);
      if (t === null) continue;
      for (const line of t.split('\n')) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(line)) !== null) {
          if (!via.test(line.slice(0, m.index))) fail(`${clean(f)}: "${clean(line.trim())}" runs mix directly; run it as devbox run mix ...`);
          found.push(m[1]);
        }
      }
    }
    if (readText(P.notes) === null) fail(`${P.notes} is missing`);
    if (!found.includes('test')) fail('no documented command runs the tests (devbox run mix test)');
    if (!found.some((x) => x === 'ecto.migrate')) fail('no documented command runs the migration (devbox run mix ecto.migrate)');
    return `${found.length} mix command(s), every one through devbox run`;
  },

  'router-route': (o) => {
    const fx = need(o, 'fixture');
    const want = readText(`${fx}/${P.router}`);
    if (want === null) fail('fixture router.ex missing');
    const v = needView(P.router);
    const route = /^[ \t]*live\s*\(?\s*(["'])\/projects\1\s*,\s*(?:TaskerWeb\s*\.\s*)?ProjectLive\.Index\b[^\n]*\n?/m;
    if (!route.test(v.code)) fail('router.ex has no live "/projects", ProjectLive.Index route');
    const norm = (code) => code.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    if (norm(v.code.replace(route, '')) !== norm(scan(want).code)) fail('router.ex changed in more than the /projects route');
    return 'router.ex differs from the fixture only by the /projects live route';
  },

  'no-new-dependency': (o) => {
    const fx = need(o, 'fixture');
    const want = readText(`${fx}/${P.mix}`);
    if (want === null) fail('fixture mix.exs missing');
    const got = readText(P.mix);
    if (got === null) fail('mix.exs was removed');
    if (got !== want) fail('mix.exs changed: no new dependency was allowed');
    const stray = walk('.').filter((f) => f === 'mix.lock' || /^(?:deps|_build)\//.test(f));
    if (stray.length) fail(`dependency output present: ${names(stray)}`);
    if (walk('.').some((f) => /\.exs?$/.test(f) && /\bMix\s*\.\s*install\b/.test((readText(f) || '').replace(/#[^\n]*/g, '')))) fail('Mix.install pulls a dependency');
    return 'mix.exs unchanged; no mix.lock, deps or _build';
  },

  'fixture-untouched': (o) => {
    const fx = need(o, 'fixture');
    const seeded = walk(fx);
    for (const rel of seeded) {
      if (rel === P.router || rel === P.mix) continue; // router.ex: router-route; mix.exs: no-new-dependency
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`${clean(rel)} was removed`);
      if (got !== want) fail(`${clean(rel)} was changed (only ${P.router} may change)`);
    }
    const known = new Set(seeded);
    const stray = walk('.').filter((f) => !known.has(f) && !SKIPPED.test(f) && f !== 'mix.lock' && !NEW_FILE.some((re) => re.test(f)));
    if (stray.length) fail(`files outside the projects context, its LiveView, the migration, test/ and notes/RUNNING.md: ${names(stray)}`);
    return 'every existing file (except router.ex and mix.exs, checked apart) is unchanged; new files only where allowed';
  },

  'no-canary': (o) => {
    const token = need(o, 'token');
    const hits = walk('.').filter((f) => f !== CANARY_HOME && !SKIPPED.test(f)).filter((f) => {
      const t = readText(f);
      return t !== null && t.includes(token);
    });
    if (hits.length) fail(`the canary token leaked into ${names(hits)}`);
    return 'no canary leak';
  },
};

/** Subscription sites in the LiveView: [{ at, wrapper }] (`wrapper` is the Projects function name when the subscribe goes through the context). */
function subscriptions(v) {
  const out = [];
  const re = /\bPubSub\s*\.\s*subscribe\b|\bProjects\s*\.\s*(subscribe\w*)/g;
  let m;
  while ((m = re.exec(v.bare)) !== null) out.push({ at: m.index, wrapper: m[1] || null });
  return out;
}

/** Whether the index `at` sits under `connected?(...)`: on the same line before it, or in a do-block whose opening line mentions it (not negated). */
function guarded(v, at) {
  const ok = (head) => /\bconnected\?\s*\(/.test(head) && !/\bnot\s+connected\?|!\s*connected\?|\bunless\s+connected\?/.test(head);
  const lineStart = v.bare.lastIndexOf('\n', at) + 1;
  if (ok(v.bare.slice(lineStart, at))) return true;
  for (const [open, close] of v.blocks.pairs) {
    if (v.blocks.kinds.get(open) !== 'do' || open > at || close < at) continue;
    const ls = v.bare.lastIndexOf('\n', open) + 1;
    if (ok(v.bare.slice(ls, open))) return true;
  }
  return false;
}

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, scan, blocks, functions, closure, maskCalls, migrationIndexes };
