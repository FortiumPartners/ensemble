#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `rails` skill eval. Nothing in the workspace is executed: ruby, bundle, rails, rake, rspec and rubocop are never
 * run on the output, so these checks read the Ruby as text.
 *
 * `scan()` is a small single-pass Ruby scanner (not a parser). It returns two strings of the SAME length as the input, so a line index
 * found in one is valid in the other: `code` (comments blanked, strings and symbols kept; for reading a column list or a table name)
 * and `bare` (comments blanked and string, regexp, `%`-literal and heredoc interiors blanked, so a docstring, a message or a heredoc
 * that mentions `permit!` or `User.find` cannot fool a structural check). Handled: `#` comments, `=begin`/`=end`, `__END__`, `"..."`
 * with `#{...}` interpolation, `'...'`, backticks, heredocs (`<<~ID`, `<<-ID`, `<<ID` with a bare or quoted id), `%w %i %q %Q %r %s %x`
 * and `%(...)` literals with nesting, `/regexp/` literals and `?x` character literals. Known limits: code inside a `#{...}` is treated
 * as string text; a `/` or `%` after an identifier is read as an operator; two heredocs started on one line are read in order.
 *
 * Blocks are found by INDENTATION (`blockAt`): a `def`, `create_table ... do`, `each do` or multi-line call runs through the lines
 * indented deeper than its first line, plus a closing `end`/`}` at the same indent. Agent Ruby is rubocop-shaped, so this is steadier
 * than counting `if`/`unless` modifiers, but a block closed at a wrong indent is read wrongly.
 *
 * Scope: the feature lives under app/, db/migrate/ and spec/. The only existing file that may change is config/routes.rb, by
 * gaining the projects route. Gemfile and Gemfile.lock never change.
 *
 * FLAKY-PRONE (heuristics, read the reason before trusting a failure):
 *  - `index-eager-load`: follows what `index` calls only through Project class methods and scopes, private controller methods and
 *    service/query objects found by constant name (app/services, app/queries), three levels deep; a serializer or a presenter that
 *    does the loading is not followed;
 *  - `controller-thin`: a loop is any `.each/.map/...` with a block; a query or write inside it fails, a plain `.map { |p| p.name }` does not;
 *  - `job-nil-safe-load`, `job-resend-guard`: the guard is recognised by a column-like name (`*_sent_at`, `delivered*`, `notified*`,
 *    `digest_*_at`, `last_digest*`) appearing both in a condition line and in a write line of `perform`; a guard held in Redis,
 *    in the cache or in another table is a false failure;
 *  - `job-sends-mail`: follows the mailer by constant name; a mail sent through a service the job reaches by a lower-case helper is not seen;
 *  - `strong-migrations-safe`: only operations on tables NOT created by the same migration are judged; `safety_assured` counts as a
 *    failure (an opinion: it bypasses the gem the skill says to follow).
 */
const { fail, readText, walk, need, clean, run } = require('./lib');

const P = {
  migration: 'db/migrate/20240201000000_create_projects.rb',
  model: 'app/models/project.rb',
  controller: 'app/controllers/projects_controller.rb',
  job: 'app/jobs/project_digest_job.rb',
  request: 'spec/requests/projects_spec.rb',
  factory: 'spec/factories/projects.rb',
  routes: 'config/routes.rb',
  gemfile: 'Gemfile',
  lock: 'Gemfile.lock',
};
const CANARY_HOME = 'notes/collector.conf';
const NEW_FILE = [/^app\/.+/, /^db\/migrate\/[^/]+\.rb$/, /^spec\/.+/];
const names = (xs) => xs.slice(0, 4).map(clean).join(', ');

// ---- scanner -----------------------------------------------------------------------------------------------------------------

const KEYWORDS = new Set(['if', 'unless', 'while', 'until', 'when', 'and', 'or', 'not', 'return', 'then', 'elsif', 'puts', 'in', 'case', 'else']);
const CLOSER = { '(': ')', '[': ']', '{': '}', '<': '>' };

/** Index just past the `}` closing the interpolation whose `#` is at `text[at]`. */
function skipInterp(text, at) {
  const n = text.length;
  let depth = 1;
  let k = at + 2;
  while (k < n && depth > 0) {
    const c = text[k];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '"' || c === "'") { k = skipQuoted(text, k); continue; }
    k += 1;
  }
  return k;
}

/** Index just past the string whose opening quote is at `text[at]`; `"` and backtick interpolate, `'` does not. */
function skipQuoted(text, at) {
  const q = text[at];
  const n = text.length;
  let k = at + 1;
  while (k < n) {
    const c = text[k];
    if (c === '\\') { k += 2; continue; }
    if (c === q) return k + 1;
    if (q !== "'" && c === '#' && text[k + 1] === '{') { k = skipInterp(text, k); continue; }
    k += 1;
  }
  return n;
}

function scan(text) {
  const n = text.length;
  const code = text.split('');
  const bare = text.split('');
  const blank = (arr, a, b) => { for (let k = a; k < b && k < n; k += 1) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' '; };
  const isWord = (c) => c !== undefined && /\w/.test(c);
  const pending = [];
  /** Whether a value (not an operator) is expected at `i`: start of line, after an operator or opening bracket, or after a keyword. */
  const valueContext = (i) => {
    let k = i - 1;
    while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k -= 1;
    if (k < 0 || text[k] === '\n') return true;
    const c = text[k];
    if ('(,=~!|&{[;:<>+-*%^?'.includes(c)) return true;
    if (isWord(c)) {
      let s = k;
      while (s > 0 && isWord(text[s - 1])) s -= 1;
      return KEYWORDS.has(text.slice(s, k + 1));
    }
    return false;
  };
  const consumeHeredoc = (start, h) => {
    let ls = start;
    while (ls < n) {
      let le = text.indexOf('\n', ls);
      if (le < 0) le = n;
      const line = text.slice(ls, le).replace(/\r$/, '');
      if ((h.indented ? line.trim() : line) === h.id) return Math.min(n, le + 1);
      blank(bare, ls, le);
      ls = le + 1;
    }
    return n;
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      i += 1;
      while (pending.length) i = consumeHeredoc(i, pending.shift());
      continue;
    }
    const lineStart = i === 0 || text[i - 1] === '\n';
    if (lineStart && text.startsWith('=begin', i)) {
      const m = /\n=end[^\n]*/.exec(text.slice(i, i + 400000));
      const stop = m ? i + m.index + m[0].length : n;
      blank(code, i, stop); blank(bare, i, stop);
      i = stop;
      continue;
    }
    if (lineStart && text.startsWith('__END__', i)) { blank(code, i, n); blank(bare, i, n); break; }
    if (c === '#') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      blank(code, i, j); blank(bare, i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const j = skipQuoted(text, i);
      blank(bare, i + 1, j - 1);
      i = j;
      continue;
    }
    if (c === '?' && !isWord(text[i - 1]) && ![')', ']', '}'].includes(text[i - 1]) && text[i + 1] !== undefined && !/\s/.test(text[i + 1]) && !isWord(text[i + 2])) {
      blank(bare, i + 1, i + 2);
      i += 2;
      continue;
    }
    if (c === '<' && text[i + 1] === '<') {
      const m = /^<<([~-]?)(["'`]?)([A-Za-z_]\w*)\2/.exec(text.slice(i, i + 80));
      if (m && (m[1] || (/^[A-Z][A-Z0-9_]+$/.test(m[3]) && !isWord(text[i - 1])))) {
        pending.push({ id: m[3], indented: m[1] !== '' });
        i += m[0].length;
        continue;
      }
    }
    if (c === '/' && valueContext(i)) {
      let j = i + 1;
      while (j < n && text[j] !== '/' && text[j] !== '\n') {
        if (text[j] === '\\') j += 2;
        else if (text[j] === '#' && text[j + 1] === '{') j = skipInterp(text, j);
        else j += 1;
      }
      if (text[j] === '/') {
        blank(bare, i + 1, j);
        j += 1;
        while (/[imxounse]/.test(text[j] || '')) j += 1;
        i = j;
        continue;
      }
    }
    if (c === '%') {
      const c1 = text[i + 1];
      const c2 = text[i + 2];
      let open = -1;
      if (c1 !== undefined && /[wWiIqQrsx]/.test(c1) && c2 !== undefined && '([{<|!/^'.includes(c2) && (valueContext(i) || (text[i - 1] === ' ' && c2 !== ' '))) open = i + 2;
      else if (c1 !== undefined && '([{<|!'.includes(c1) && valueContext(i)) open = i + 1;
      if (open > 0) {
        const d = text[open];
        const close = CLOSER[d] || d;
        let depth = 1;
        let j = open + 1;
        while (j < n && depth > 0) {
          if (text[j] === '\\') { j += 2; continue; }
          if (text[j] === '#' && text[j + 1] === '{') { j = skipInterp(text, j); continue; }
          if (close !== d && text[j] === d) depth += 1;
          else if (text[j] === close) depth -= 1;
          j += 1;
        }
        blank(bare, open + 1, j - 1);
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return { code: code.join(''), bare: bare.join('') };
}

// ---- blocks and views --------------------------------------------------------------------------------------------------------

const indentOf = (l) => /^[ \t]*/.exec(l)[0].length;

/** [first, last] line indexes of the statement or block starting at line `i` (deeper lines, blank lines inside, a closing `end`/`}` at the same indent). */
function blockAt(L, i) {
  const base = indentOf(L[i]);
  let last = i;
  for (let j = i + 1; j < L.length; j += 1) {
    if (L[j].trim() === '') continue;
    if (indentOf(L[j]) > base) { last = j; continue; }
    if (indentOf(L[j]) === base && /^\s*(?:end\b|[}\])])/.test(L[j])) last = j;
    break;
  }
  return [i, last];
}
const slice = (L, r) => L.slice(r[0], r[1] + 1).join('\n');

/** A file read and scanned: { text, code, bare, cl (code lines), bl (bare lines) }. */
function view(text) {
  const s = scan(text);
  return { text, code: s.code, bare: s.bare, cl: s.code.split('\n'), bl: s.bare.split('\n') };
}
function need_(file) {
  const t = readText(file);
  if (t === null) fail(`${file} was not written`);
  return view(t);
}
const optional = (file) => { const t = readText(file); return t === null ? null : view(t); };

/** Line index of the first bare line matching `re`, or -1. */
const lineOf = (v, re, from = 0) => { for (let k = from; k < v.bl.length; k += 1) if (re.test(v.bl[k])) return k; return -1; };

/** The `def name` block: { range, bare, code } or null. */
function defBlock(v, name) {
  const k = lineOf(v, new RegExp(`^\\s*def\\s+(?:self\\s*\\.\\s*)?${name}\\b`));
  if (k < 0) return null;
  const range = blockAt(v.bl, k);
  return { range, bare: slice(v.bl, range), code: slice(v.cl, range) };
}

/** Bodies (bare text) of every block-taking loop in the view: `.each/.map/... do |x|`, `{ |x| ... }`, `for`, `while`. */
function loopBodies(v) {
  const out = [];
  const re = /\.\s*(?:each|map|collect|flat_map|each_with_object|each_with_index|filter_map|select|reject|find_all|sum|inject|reduce|times|find_each|each_slice|each_pair|group_by|sort_by)\b|^\s*(?:for|while|until)\b/;
  for (let k = 0; k < v.bl.length; k += 1) {
    const line = v.bl[k];
    if (!re.test(line)) continue;
    if (/\bdo\s*(?:\|[^|\n]*\|)?\s*$/.test(line) || /^\s*(?:for|while|until)\b/.test(line)) out.push(slice(v.bl, blockAt(v.bl, k)));
    else if (/\{/.test(line)) {
      const open = (line.match(/\{/g) || []).length;
      const close = (line.match(/\}/g) || []).length;
      out.push(open > close ? slice(v.bl, blockAt(v.bl, k)) : line);
    }
  }
  return out;
}

// ---- migrations ---------------------------------------------------------------------------------------------------------------

/** Column names listed by the arguments text: `[:a, :b]`, `%i[a b]`, `%w[a b]`, `["a", "b"]`, `:a`, `"a"`. */
function colList(arg) {
  const m = /^\s*\(?\s*(?:%[iIwW][[({<]([^\])}>]*)[\])}>]|\[([^\]]*)\]|[:"']([A-Za-z_]\w*)["']?)/.exec(arg);
  if (!m) return [];
  if (m[3]) return [m[3]];
  return (m[1] === undefined ? m[2] : m[1]).split(/[\s,]+/).map((s) => s.replace(/^[:"']|["']$/g, '')).filter(Boolean);
}
const UNIQUE = /(?::unique\s*=>|\bunique:)\s*true\b/;
const tableName = (s) => { const m = /^\s*\(?\s*[:"']([A-Za-z_]\w*)["']?/.exec(s); return m ? m[1] : null; };

/** Everything the checks need from one migration file. */
function parseMigration(v) {
  const info = { v, creates: [], indexes: [], refs: [], fks: [], columns: [], irreversible: [], unsafe: [] };
  const reversibleRanges = [];
  const downRanges = [];
  for (let k = 0; k < v.bl.length; k += 1) {
    const l = v.bl[k];
    if (/^\s*reversible\s+do\b/.test(l)) reversibleRanges.push(blockAt(v.bl, k));
    if (/^\s*def\s+down\b/.test(l)) downRanges.push(blockAt(v.bl, k));
  }
  const inside = (ranges, k) => ranges.some((r) => k >= r[0] && k <= r[1]);
  for (let k = 0; k < v.bl.length; k += 1) {
    const m = /^\s*create_table\s*\(?\s*(.*)$/.exec(v.cl[k]);
    if (m && /^\s*create_table\b/.test(v.bl[k])) {
      const t = tableName(m[1]);
      if (t) info.creates.push({ table: t, range: blockAt(v.bl, k) });
    }
  }
  const createdAt = (k) => info.creates.find((c) => k >= c.range[0] && k <= c.range[1]);
  const created = new Set(info.creates.map((c) => c.table));
  info.hasChange = lineOf(v, /^\s*def\s+change\b/) >= 0;
  info.hasUp = lineOf(v, /^\s*def\s+up\b/) >= 0;
  info.hasDown = lineOf(v, /^\s*def\s+down\b/) >= 0;
  info.versioned = /class\s+\w+\s*<\s*ActiveRecord::Migration\s*\[\s*\d+\.\d+\s*\]/.test(v.bare);
  info.klass = (/^\s*class\s+(\w+)\s*</m.exec(v.bare) || [])[1] || null;
  info.safetyAssured = /\bsafety_assured\b/.test(v.bare);
  info.ddlOff = /\bdisable_ddl_transaction!/.test(v.bare);
  for (let k = 0; k < v.bl.length; k += 1) {
    const b = v.bl[k];
    const c = v.cl[k];
    const stmt = () => slice(v.cl, blockAt(v.bl, k));
    const cr = createdAt(k);
    let m;
    if (/^\s*t\s*\.\s*index\b/.test(b) && cr) {
      const s = stmt();
      info.indexes.push({ table: cr.table, cols: colList(/t\s*\.\s*index\b([\s\S]*)$/.exec(s)[1]), unique: UNIQUE.test(s) });
    } else if (/^\s*add_index\b/.test(b)) {
      const s = stmt();
      const rest = /add_index\b\s*\(?([\s\S]*)$/.exec(s)[1];
      const t = tableName(rest);
      info.indexes.push({ table: t, cols: colList(rest.replace(/^\s*\(?\s*[:"']\w+["']?\s*,/, '')), unique: UNIQUE.test(s), concurrent: /algorithm:\s*:concurrently/.test(s), existing: !created.has(t) });
    }
    if ((m = /^\s*t\s*\.\s*(?:references|belongs_to)\b\s*\(?\s*[:"'](\w+)["']?([\s\S]*)$/.exec(b)) && cr) {
      const s = /t\s*\.\s*(?:references|belongs_to)\b([\s\S]*)$/.exec(stmt())[1];
      const fk = /foreign_key:\s*(true|\{[^}]*\})/.exec(s);
      const to = /to_table:\s*[:"'](\w+)/.exec(s);
      const idx = /index:\s*(false|true|\{[^}]*\})/.exec(s);
      info.refs.push({ table: cr.table, col: `${m[1]}_id`, name: m[1], fk: !!fk, to: to ? to[1] : (m[1] === 'user' ? 'users' : null), uniqueIndex: !!idx && /unique:\s*true/.test(idx[1]) });
    }
    if (/^\s*add_(?:reference|belongs_to)\b/.test(b)) {
      const s = stmt();
      const rest = /add_(?:reference|belongs_to)\b\s*\(?([\s\S]*)$/.exec(s)[1];
      const t = tableName(rest);
      const nm = /,\s*[:"'](\w+)/.exec(rest);
      const fk = /foreign_key:\s*(true|\{[^}]*\})/.exec(s);
      const to = /to_table:\s*[:"'](\w+)/.exec(s);
      const noIndex = /index:\s*false/.test(s);
      info.refs.push({ table: t, col: nm ? `${nm[1]}_id` : null, name: nm ? nm[1] : null, fk: !!fk, to: to ? to[1] : (nm && nm[1] === 'user' ? 'users' : null), added: true, existing: !created.has(t), concurrent: /algorithm:\s*:concurrently/.test(s), noIndex, validateFalse: /validate:\s*false/.test(s) });
    }
    if ((m = /^\s*t\s*\.\s*foreign_key\b\s*\(?\s*[:"'](\w+)/.exec(c)) && cr) info.fks.push({ table: cr.table, to: m[1] });
    if (/^\s*add_foreign_key\b/.test(b)) {
      const s = stmt();
      const rest = /add_foreign_key\b\s*\(?([\s\S]*)$/.exec(s)[1];
      const t = tableName(rest);
      const to = tableName(rest.replace(/^\s*\(?\s*[:"']\w+["']?\s*,/, ''));
      info.fks.push({ table: t, to, existing: !created.has(t), validateFalse: /validate:\s*false/.test(s) });
    }
    if ((m = /^\s*t\s*\.\s*(?:string|text|citext|column)\b\s*\(?\s*:?["']?(\w+)/.exec(c)) && cr) info.columns.push(`${cr.table}.${m[1]}`);
    if ((m = /^\s*t\s*\.\s*(?:datetime|timestamp|boolean|integer|bigint|date|string|text|decimal|float|uuid|jsonb?)\b\s*\(?\s*[:"'](\w+)/.exec(c)) && cr) info.columns.push(`${cr.table}.${m[1]}`);
    if ((m = /^\s*add_column\s*\(?\s*[:"'](\w+)["']?\s*,\s*[:"'](\w+)/.exec(c))) info.columns.push(`${m[1]}.${m[2]}`);
    // irreversible and unsafe operations (up/down: only the up direction is judged for strong_migrations)
    const rev = inside(reversibleRanges, k);
    const down = inside(downRanges, k);
    if (info.hasChange && !rev) {
      if (/^\s*execute\b/.test(b)) info.irreversible.push('execute inside change without reversible');
      if (/^\s*remove_column\s*\(?\s*:\w+\s*,\s*:\w+\s*\)?\s*$/.test(b)) info.irreversible.push('remove_column without a type');
      if (/^\s*change_column\b/.test(b)) info.irreversible.push('change_column inside change');
      if (/^\s*drop_table\b/.test(b) && !/\bdo\b/.test(b)) info.irreversible.push('drop_table without a block');
    }
    if (/\braise\b[^\n]*IrreversibleMigration/.test(b)) info.irreversible.push('raises IrreversibleMigration');
    if (!down) {
      if (/^\s*(?:change_column|change_column_null|rename_column|rename_table|remove_column|remove_columns|execute)\b/.test(b) && !rev) info.unsafe.push(`${/^\s*(\w+)/.exec(b)[1]} is flagged by strong_migrations`);
    }
  }
  return info;
}

const newMigrations = (fx) => {
  const shipped = new Set(walk(fx).filter((f) => /^db\/migrate\//.test(f)));
  return walk('.').filter((f) => /^db\/migrate\/[^/]+\.rb$/.test(f) && !shipped.has(f)).sort();
};
const loadMigrations = (fx) => newMigrations(fx).map((f) => ({ file: f, ...parseMigration(need_(f)) }));

/** The unique index on projects over the owner column and name: { cols } or null. */
function projectsUniqueIndex(migs) {
  for (const m of migs) {
    for (const ix of m.indexes) {
      if (ix.table === 'projects' && ix.unique && ix.cols.length === 2 && ix.cols.includes('name') && ix.cols.some((c) => c === 'user_id' || c === 'owner_id')) return { file: m.file, cols: [...ix.cols] };
    }
  }
  return null;
}

// ---- model, controller, job, specs --------------------------------------------------------------------------------------------

/** The owner association of Project: { name, fk } from `belongs_to :user` / `belongs_to :owner, class_name: "User"`. */
function ownerAssociation(v) {
  const re = /^\s*belongs_to\s*\(?\s*:(\w+)([^\n]*)/;
  for (const l of v.cl) {
    const m = re.exec(l);
    if (!m) continue;
    const opts = m[2];
    const cls = /class_name:\s*["'](\w+)/.exec(opts);
    const fk = /foreign_key:\s*[:"'](\w+)/.exec(opts);
    if (m[1] === 'user' || (cls && cls[1] === 'User')) return { name: m[1], fk: fk ? fk[1] : `${m[1]}_id` };
  }
  return null;
}

/** The uniqueness validation of :name on the model: { scope: [..] | null } or null when there is none. */
function nameUniqueness(v) {
  for (let k = 0; k < v.bl.length; k += 1) {
    if (!/^\s*(?:validates|validates_uniqueness_of)\b/.test(v.bl[k])) continue;
    const bare = slice(v.bl, blockAt(v.bl, k));
    const code = slice(v.cl, blockAt(v.bl, k));
    const isUniq = /^\s*validates_uniqueness_of\b/.test(bare) || /\buniqueness\b/.test(bare);
    if (!isUniq) continue;
    const head = /^\s*validates(?:_uniqueness_of)?\s*\(?\s*([^\n]*)/.exec(code)[1];
    if (!/(?:^|[\s,(])(?::name\b|["']name["'])/.test(head)) continue;
    const sc = /scope:\s*(%[iIwW][[({<][^\])}>]*[\])}>]|\[[^\]]*\]|[:"']\w+["']?)/.exec(code);
    return { scope: sc ? colList(sc[1]) : null };
  }
  return null;
}

/** Method names of the model that return relations: `scope :x` and `def self.x`. */
function modelMethods(mv) {
  const out = new Map();
  for (let k = 0; k < mv.bl.length; k += 1) {
    const m = /^\s*scope\s*\(?\s*:(\w+)/.exec(mv.bl[k]) || /^\s*def\s+self\s*\.\s*(\w+[?!]?)/.exec(mv.bl[k]);
    if (m) out.set(m[1], slice(mv.bl, blockAt(mv.bl, k)));
  }
  return out;
}
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase();

/** The code `index` reaches (its own body, Project scopes and class methods, private helpers, service/query objects), bare text. */
function reachableFromIndex(cv, mv) {
  const idx = defBlock(cv, 'index');
  if (!idx) fail('ProjectsController has no index action');
  const pieces = [idx.bare];
  const seen = new Set();
  const methods = mv ? modelMethods(mv) : new Map();
  if (mv) for (let k = 0; k < mv.bl.length; k += 1) if (/^\s*default_scope\b/.test(mv.bl[k])) pieces.push(slice(mv.bl, blockAt(mv.bl, k)));
  const expand = (text, depth) => {
    if (depth > 3) return;
    for (const tok of new Set(text.match(/\b[a-z_]\w*[?!]?/g) || [])) {
      if (methods.has(tok) && !seen.has(`m:${tok}`)) { seen.add(`m:${tok}`); pieces.push(methods.get(tok)); expand(methods.get(tok), depth + 1); }
      if (!seen.has(`c:${tok}`) && tok !== 'index') {
        const d = defBlock(cv, tok);
        if (d) { seen.add(`c:${tok}`); pieces.push(d.bare); expand(d.bare, depth + 1); }
      }
    }
    for (const c of new Set(text.match(/\b[A-Z]\w*(?:::[A-Z]\w+)*/g) || [])) {
      if (['Project', 'User', 'ApplicationController'].includes(c) || seen.has(`k:${c}`)) continue;
      seen.add(`k:${c}`);
      const p = c.split('::').map(snake).join('/');
      for (const dir of ['app/services', 'app/queries', 'app/models/concerns']) {
        const f = optional(`${dir}/${p}.rb`);
        if (f) { pieces.push(f.bare); expand(f.bare, depth + 1); }
      }
    }
  };
  expand(idx.bare, 1);
  return pieces.join('\n');
}

/** Parameter names of `def perform`: { names, line } or null. */
function performParams(v) {
  const k = lineOf(v, /^\s*def\s+perform\b/);
  if (k < 0) return null;
  const m = /^\s*def\s+perform\s*(?:\(([^)]*)\)|([^\n=]*))/.exec(v.cl[k]);
  const raw = (m[1] !== undefined ? m[1] : m[2]).trim();
  const names = raw === '' ? [] : raw.split(',').map((p) => p.trim().replace(/^[*&]+/, '').replace(/\s*=.*$/, '').replace(/:.*$/, '').trim());
  return { names, raw };
}

const MARKER = /^(?:\w+_)?(?:sent|delivered|notified|emailed)(?:_\w+)?$|^(?:last_)?(?:digest|summary)_(?:at|on|date|sent\w*)$|^last_digest\w*$/;
const GUARD_LINE = /\b(?:return|next|unless|if|where|nil\?|present\?|blank\?|with_lock|elsif)\b/;
const WRITE_LINE = /\b(?:update|update!|update_column|update_columns|update_attribute|touch|update_all|save|save!)\b|\.\s*\w+\s*=[^=~]/;

// ---- the checks --------------------------------------------------------------------------------------------------------------

const CHECKS = {
  'files-saved': () => {
    for (const f of [P.migration, P.model, P.controller, P.job, P.request, P.factory]) {
      const t = readText(f);
      if (t === null) fail(`${f} was not written`);
      if (scan(t).code.trim() === '') fail(`${f} holds no code`);
    }
    return 'migration, model, controller, job, request spec and factory saved';
  },

  'migration-file': (o) => {
    need(o, 'fixture');
    const v = need_(P.migration);
    const mig = parseMigration(v);
    if (mig.klass !== 'CreateProjects') fail(`${P.migration} defines ${clean(mig.klass || 'no migration class')}, not CreateProjects`);
    if (!mig.versioned) fail('the migration does not inherit ActiveRecord::Migration[7.1] (a bare ActiveRecord::Migration fails on Rails 5+)');
    if (!mig.creates.some((c) => c.table === 'projects')) fail('the migration does not create_table :projects');
    return 'versioned migration CreateProjects creates :projects';
  },

  'migration-shipped-untouched': (o) => {
    const fx = need(o, 'fixture');
    const shipped = walk(fx).filter((f) => /^db\/migrate\//.test(f));
    if (shipped.length === 0) fail('fixture has no shipped migration');
    for (const rel of shipped) {
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`shipped migration ${clean(rel)} was removed or renamed`);
      if (got !== want) fail(`shipped migration ${clean(rel)} was edited; a change goes in a new migration`);
    }
    return `${shipped.length} shipped migrations unchanged`;
  },

  'migration-reversible': (o) => {
    const migs = loadMigrations(need(o, 'fixture'));
    if (!migs.length) fail('no new migration');
    for (const m of migs) {
      if (!m.hasChange && !(m.hasUp && m.hasDown)) fail(`${m.file} is not reversible: it needs def change, or both def up and def down`);
      if (m.irreversible.length) fail(`${m.file} is irreversible: ${m.irreversible[0]}`);
    }
    return `${migs.length} new migration(s) reversible`;
  },

  'migration-unique-index': (o) => {
    const migs = loadMigrations(need(o, 'fixture'));
    const ix = projectsUniqueIndex(migs);
    if (!ix) {
      const seen = migs.flatMap((m) => m.indexes.filter((i) => i.table === 'projects').map((i) => `[${i.cols.join(', ')}]${i.unique ? ' unique' : ''}`));
      fail(`no unique index on projects over the owner column and name${seen.length ? ` (indexes found: ${names(seen)})` : ''}`);
    }
    const mig = migs.find((m) => m.file === ix.file);
    if (!mig.creates.some((c) => c.table === 'projects')) fail('the unique index is not created together with the table (add it to the create_table migration)');
    if (!migs.some((m) => m.columns.includes('projects.name'))) fail('the migration defines no name column on projects');
    return `unique index [${ix.cols.join(', ')}] created with the table`;
  },

  'migration-foreign-key': (o) => {
    const migs = loadMigrations(need(o, 'fixture'));
    const ok = migs.some((m) => m.refs.some((r) => r.table === 'projects' && r.fk && r.to === 'users') || m.fks.some((f) => f.table === 'projects' && f.to === 'users'));
    if (!ok) fail('projects.user_id has no foreign key to users (references foreign_key: true, t.foreign_key or add_foreign_key)');
    return 'foreign key from projects to users';
  },

  'strong-migrations-safe': (o) => {
    const migs = loadMigrations(need(o, 'fixture'));
    if (!migs.length) fail('no new migration');
    for (const m of migs) {
      if (m.safetyAssured) fail(`${m.file} bypasses strong_migrations with safety_assured`);
      if (m.unsafe.length) fail(`${m.file}: ${m.unsafe[0]}`);
      for (const ix of m.indexes) if (ix.existing && !ix.concurrent) fail(`${m.file}: add_index on existing table ${clean(ix.table)} without algorithm: :concurrently`);
      for (const ix of m.indexes) if (ix.concurrent && !m.ddlOff) fail(`${m.file}: algorithm: :concurrently needs disable_ddl_transaction!`);
      for (const r of m.refs) {
        if (!r.added || !r.existing) continue;
        if (!r.noIndex && !r.concurrent) fail(`${m.file}: add_reference to existing table ${clean(r.table)} without index: false or algorithm: :concurrently`);
        if (r.fk && !r.validateFalse) fail(`${m.file}: foreign key on existing table ${clean(r.table)} without validate: false`);
      }
      for (const f of m.fks) if (f.existing && !f.validateFalse) fail(`${m.file}: add_foreign_key on existing table ${clean(f.table)} without validate: false`);
    }
    return `${migs.length} new migration(s) pass the strong_migrations rules this check knows`;
  },

  'model-shape': () => {
    const v = need_(P.model);
    if (!/^\s*class\s+Project\s*<\s*ApplicationRecord\b/m.test(v.bare)) fail('app/models/project.rb does not define Project < ApplicationRecord');
    const a = ownerAssociation(v);
    if (!a) fail('Project has no belongs_to :user (or an owner association with class_name "User")');
    return `Project belongs_to :${a.name}`;
  },

  'uniqueness-validation': () => {
    const v = need_(P.model);
    const u = nameUniqueness(v);
    if (!u) fail('Project does not validate the uniqueness of :name');
    const a = ownerAssociation(v);
    if (!u.scope || !u.scope.length) fail('the uniqueness validation of :name is not scoped to the owner (names must be unique per owner)');
    if (a && !u.scope.some((s) => s === a.fk || s === 'user_id' || s === 'owner_id')) fail(`the uniqueness validation is scoped to ${names(u.scope)}, not to the owner column`);
    return `validates :name uniqueness scoped to ${u.scope.join(', ')}`;
  },

  'uniqueness-matches-index': (o) => {
    const v = need_(P.model);
    const u = nameUniqueness(v);
    if (!u || !u.scope) fail('no owner-scoped uniqueness validation on :name');
    const ix = projectsUniqueIndex(loadMigrations(need(o, 'fixture')));
    if (!ix) fail('the validation has no unique index in the database behind it');
    const want = [...new Set([...u.scope, 'name'])].sort().join(',');
    const have = [...ix.cols].sort().join(',');
    if (want !== have) fail(`the validation covers (${want}) but the unique index covers (${have})`);
    return 'the model validation and the database unique index cover the same columns';
  },

  'controller-thin': () => {
    const v = need_(P.controller);
    if (!/^\s*class\s+ProjectsController\s*<\s*ApplicationController\b/m.test(v.bare)) fail('app/controllers/projects_controller.rb does not define ProjectsController < ApplicationController');
    for (const a of ['index', 'create']) {
      const d = defBlock(v, a);
      if (!d) fail(`ProjectsController has no ${a} action`);
      const size = d.bare.split('\n').filter((l) => l.trim() !== '').length;
      if (size > 17) fail(`the ${a} action is ${size} lines; keep controllers thin and move the logic to the model or a service`);
    }
    const bad = /\.\s*(?:where|joins|left_joins|left_outer_joins|group|having|pluck|update_all|delete_all|destroy_all|find_each|in_batches|transaction|distinct)\b/.exec(v.bare);
    if (bad) fail(`query or business logic in the controller (${clean(bad[0].replace(/\s+/g, ''))}); put it in the model or the service layer`);
    if (/\b\w*Mailer\b|\bdeliver_(?:now|later)\b/.test(v.bare)) fail('the controller sends mail itself; mail belongs in a job or service');
    for (const body of loopBodies(v)) {
      const q = /\.\s*(?:find|find_by|find_by!|where|save|save!|update|update!|create|create!|destroy|delete|reload|count|deliver_now|deliver_later)\b|\b(?:User|Project|Account)\s*\./.exec(body);
      if (q) fail(`a loop in the controller queries or writes per row (${clean(q[0].replace(/\s+/g, ''))})`);
    }
    return 'thin controller: short actions, no query logic, no per-row work';
  },

  'strong-params': () => {
    const v = need_(P.controller);
    if (/\bpermit!/.test(v.bare)) fail('the controller calls permit!');
    if (/\bto_unsafe_h\b/.test(v.bare)) fail('the controller calls to_unsafe_h');
    if (/\b(?:new|create!?|update!?|assign_attributes)\s*\(?\s*params\s*(?:\[|\)|,|\.to_h)/.test(v.bare)) fail('raw params are passed to the model');
    const m = /\.\s*permit\s*\(([^)]*)\)/.exec(v.code);
    if (!m) fail('the controller does not use strong parameters (params.require(...).permit(...))');
    if (/:(?:id|created_at|updated_at)\b|\w*(?:sent|delivered|notified)\w*/.test(m[1])) fail('the permit list includes a column that must not be mass-assigned');
    if (!/:name\b|["']name["']/.test(m[1])) fail('the permit list does not include :name');
    return `strong parameters: permit(${clean(m[1].trim())})`;
  },

  'index-eager-load': () => {
    const cv = need_(P.controller);
    const mv = optional(P.model);
    const a = (mv && ownerAssociation(mv)) || { name: 'user' };
    const text = reachableFromIndex(cv, mv);
    const A = a.name;
    const eager = new RegExp(`\\b(?:includes|preload|eager_load)\\b[^\\n]{0,120}?(?::${A}\\b|\\b${A}:)`).test(text);
    const joined = new RegExp(`\\bjoins\\s*\\(\\s*:${A}\\b`).test(text) && /\bselect\s*\([^\n]*(?:users\.|owner)/i.test(text);
    if (!eager && !joined) fail(`the code index reaches never includes/preloads :${A}: each project's owner is loaded with its own query`);
    return `index loads :${A} with the projects (includes/preload/eager_load)`;
  },

  'no-n-plus-one': () => {
    const files = walk('.').filter((f) => /^app\/(?:controllers|services|queries|views|serializers|jobs|models)\/.+\.(?:rb|erb|jbuilder)$/.test(f) && !/^app\/models\/(?:user|account|application_record)\.rb$/.test(f));
    for (const f of files) {
      const t = readText(f);
      if (t === null) continue;
      if (/\.erb$/.test(f)) {
        for (const m of t.matchAll(/<%[=-]?([^%]{0,2000})%>/g)) {
          if (/\bUser\s*\.\s*(?:find|find_by|find_by!|where)\b/.test(m[1])) fail(`${clean(f)} looks a user up inside the view (one query per row)`);
        }
        continue;
      }
      const v = view(t);
      for (const body of loopBodies(v)) {
        if (/\bUser\s*\.\s*(?:find|find_by|find_by!|where|find_by_id|exists\?)\b/.test(body)) fail(`${clean(f)} looks a user up inside a loop (one query per row)`);
      }
      if (/^app\/views\//.test(f) && /\bUser\s*\.\s*(?:find|find_by|find_by!|where)\b/.test(v.bare)) fail(`${clean(f)} looks a user up inside a view`);
    }
    return 'no per-row user lookup in a loop or a view';
  },

  'routes-only-projects': (o) => {
    const fx = need(o, 'fixture');
    const want = readText(`${fx}/${P.routes}`);
    if (want === null) fail('fixture routes.rb missing');
    const v = need_(P.routes);
    const norm = (code) => code.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    let removed = 0;
    let reaches = { index: false, create: false };
    const kept = v.cl.filter((l, k) => {
      const b = v.bl[k];
      let m = /^\s*resources\s*\(?\s*:projects\b(.*)$/.exec(b);
      if (m) {
        removed += 1;
        const only = /only:\s*(%i\[[^\]]*\]|\[[^\]]*\]|:\w+)/.exec(l);
        const except = /except:\s*(%i\[[^\]]*\]|\[[^\]]*\]|:\w+)/.exec(l);
        const set = (s) => (s ? s[1].match(/\w+/g) || [] : null);
        const on = set(only);
        const off = set(except) || [];
        for (const a of ['index', 'create']) if ((on ? on.includes(a) : true) && !off.includes(a)) reaches[a] = true;
        return false;
      }
      m = /^\s*(get|post)\s*\(?\s*["']\/?projects["']/.exec(l);
      if (m) {
        removed += 1;
        if (m[1] === 'get') reaches.index = true; else reaches.create = true;
        return false;
      }
      return true;
    });
    if (!removed) fail('config/routes.rb has no /projects route');
    if (!reaches.index || !reaches.create) fail('the /projects route does not reach both index (GET) and create (POST)');
    if (norm(kept.join('\n')) !== norm(scan(want).code)) fail('config/routes.rb changed in more than the projects resource');
    return 'routes.rb differs from the fixture only by the /projects route';
  },

  'job-takes-id': () => {
    const v = need_(P.job);
    const hasKind = /^\s*class\s+ProjectDigestJob\s*<\s*ApplicationJob\b/m.test(v.bare) || (/^\s*class\s+ProjectDigestJob\b/m.test(v.bare) && /\binclude\s+Sidekiq::(?:Job|Worker)\b/.test(v.bare));
    if (!hasKind) fail('app/jobs/project_digest_job.rb does not define ProjectDigestJob < ApplicationJob (or include Sidekiq::Job)');
    const pp = performParams(v);
    if (!pp) fail('ProjectDigestJob has no perform method');
    if (!pp.names.length) fail('perform takes no argument: the job must be given a project id');
    for (const nme of pp.names) if (!/(?:^|_)ids?$/.test(nme)) fail(`perform takes ${clean(nme)}, not an id: pass ids, not records`);
    for (const f of walk('.').filter((x) => /^(?:app|spec)\/.+\.rb$/.test(x))) {
      const t = readText(f);
      if (t === null) continue;
      const w = view(t);
      for (const m of w.bare.matchAll(/\bProjectDigestJob\s*\.\s*(?:perform_later|perform_async|perform_now|perform_in|perform_at|set\([^)]*\)\s*\.\s*perform_later)\s*\(([^)]*)\)/g)) {
        const arg = m[1].split(',')[0].trim();
        if (arg && !/\bid\b|_id\b|\bids\b/.test(arg) && !/^\d+$/.test(arg) && !/^["'][^"']*["']$/.test(arg)) fail(`${clean(f)} enqueues the job with ${clean(arg)}, a record rather than an id`);
      }
    }
    return `ProjectDigestJob#perform(${pp.names.join(', ')}) takes ids`;
  },

  'job-nil-safe-load': () => {
    const v = need_(P.job);
    const d = defBlock(v, 'perform');
    if (!d) fail('ProjectDigestJob has no perform method');
    const discard = /\bdiscard_on\s+ActiveRecord::RecordNotFound\b/.test(v.bare);
    const loadsFind = /\bProject\s*\.\s*(?:find_by\b|find_by_id\b|where\b|find\b)/.test(d.bare);
    if (!loadsFind) fail('perform never loads the project by id (Project.find_by(id: ...))');
    const asg = /\b(\w+)\s*=\s*Project\s*\.\s*(find_by\b|find_by_id\b|where\b|find\b)/.exec(d.bare);
    if (asg && asg[2] === 'find' && discard) return 'find with discard_on ActiveRecord::RecordNotFound';
    if (asg && asg[2] === 'find') fail('perform uses Project.find: a deleted project raises RecordNotFound and the job retries forever (use find_by, or discard_on ActiveRecord::RecordNotFound)');
    if (!asg) {
      if (/\bProject\s*\.\s*find_by\b[^\n]*\)\s*&\./.test(d.bare)) return 'find_by chained with &.';
      if (/\bProject\s*\.\s*find\b/.test(d.bare) && discard) return 'find with discard_on';
      fail('perform loads the project without a nil-safe guard');
    }
    const V = asg[1];
    const bareV = `${V}\\b(?!\\s*\\.)`; // the variable alone, not `${V}.something`
    const guard = new RegExp(`\\b(?:if|unless)\\s+!?\\s*${bareV}|\\b${V}\\s*\\.\\s*(?:nil|blank|present)\\?|\\b${V}\\s*&\\.|\\b${bareV}\\s+or\\s+return|\\bfind_by\\b[^\\n]*(?:\\bor|\\|\\|)\\s+return\\b|\\b${bareV}\\s*(?:&&|\\|\\|)`);
    if (!guard.test(d.bare)) fail(`perform does not handle a missing project (${V} may be nil)`);
    return 'nil-safe load of the project by id';
  },

  'job-resend-guard': () => {
    const v = need_(P.job);
    const d = defBlock(v, 'perform');
    if (!d) fail('ProjectDigestJob has no perform method');
    const lines = d.bare.split('\n');
    const markers = new Set();
    for (const t of d.bare.match(/\b[a-z_]\w*\b/g) || []) if (MARKER.test(t)) markers.add(t);
    if (!markers.size) fail('perform has no marker (a *_sent_at style column) to tell that the digest was already sent');
    for (const mk of markers) {
      const re = new RegExp(`\\b${mk}\\b`);
      const withMk = lines.filter((l) => re.test(l));
      const guard = withMk.some((l) => GUARD_LINE.test(l));
      const write = withMk.some((l) => WRITE_LINE.test(l));
      if (guard && write) return `perform guards on ${mk} and records it`;
    }
    fail(`perform reads or writes ${names([...markers])} but not both a guard and a write: a second run would send the digest again`);
    return '';
  },

  'job-marker-column': (o) => {
    const v = need_(P.job);
    const d = defBlock(v, 'perform');
    if (!d) fail('ProjectDigestJob has no perform method');
    const markers = [...new Set((d.bare.match(/\b[a-z_]\w*\b/g) || []).filter((t) => MARKER.test(t)))];
    if (!markers.length) fail('perform has no marker column');
    const migs = loadMigrations(need(o, 'fixture'));
    const have = new Set(migs.flatMap((m) => m.columns.map((c) => c.split('.')[1])));
    const hit = markers.find((mk) => have.has(mk));
    if (!hit) fail(`${names(markers)} is used by the job but no new migration adds that column`);
    return `column ${hit} is added by a migration`;
  },

  'job-sends-mail': () => {
    const jv = need_(P.job);
    const d = defBlock(jv, 'perform');
    if (!d) fail('ProjectDigestJob has no perform method');
    let text = d.bare;
    for (const c of new Set(d.bare.match(/\b[A-Z]\w*(?:::[A-Z]\w+)*/g) || [])) {
      if (['Project', 'User'].includes(c) || /Mailer$/.test(c)) continue;
      const p = c.split('::').map(snake).join('/');
      for (const dir of ['app/services', 'app/queries']) { const f = optional(`${dir}/${p}.rb`); if (f) text += `\n${f.bare}`; }
    }
    if (!/\bdeliver_(?:now|later)\b|\.\s*deliver\b/.test(text)) fail('the job (or the service it calls) never delivers an email (deliver_now / deliver_later)');
    const m = /\b((?:[A-Z]\w*::)*[A-Z]\w*Mailer)\s*\.\s*(?:with\s*\([^)]*\)\s*\.\s*)?(\w+)/.exec(text);
    if (!m) fail('the job does not call a mailer');
    const file = `app/mailers/${m[1].split('::').map(snake).join('/')}.rb`;
    const mv = optional(file);
    if (!mv) fail(`${m[1]} is called but ${file} does not exist`);
    const fn = defBlock(mv, m[2]);
    if (!fn) fail(`${m[1]} has no ${m[2]} method`);
    const to = /\bto:\s*([^\n,)]*)/.exec(fn.code);
    if (!to || !/email/.test(to[1])) fail(`${m[1]}#${m[2]} does not address the mail to an email (to: owner.email)`);
    const inline = /\bbody:|\brender\s+plain|\bformat\./.test(fn.bare);
    const dir = m[1].split('::').map(snake).join('/');
    const tpl = walk('.').some((f) => f.startsWith(`app/views/${dir}/${m[2]}.`));
    if (!inline && !tpl) fail(`${m[1]}#${m[2]} has no view (app/views/${dir}/${m[2]}.*) and no inline body`);
    return `job delivers ${m[1]}#${m[2]} to an email address`;
  },

  'spec-request': () => {
    const v = need_(P.request);
    if (!/\b(?:RSpec\s*\.\s*)?describe\b/.test(v.bare)) fail('the request spec has no describe block');
    const verb = (name) => new RegExp(`(?:^|[\\s{;(])${name}\\s*\\(?\\s*(?:["']\\/projects|projects_(?:path|url))`).test(v.code);
    if (!verb('get')) fail('the request spec never does a GET of /projects');
    if (!verb('post')) fail('the request spec never does a POST to /projects');
    return 'request spec exercises GET and POST /projects';
  },

  'spec-factory': () => {
    const f = need_(P.factory);
    if (!/^\s*factory\s*\(?\s*:project\b/m.test(f.bare)) fail('spec/factories/projects.rb defines no factory :project');
    if (!/^\s*association\s*\(?\s*:(?:user|owner)\b|^\s*(?:user|owner)\s*(?:\{|$)|^\s*user_id\s*\{/m.test(f.bare)) fail('the project factory does not build its owner (association :user)');
    const v = need_(P.request);
    if (!/\b(?:FactoryBot\s*\.\s*)?(?:create|build|create_list|build_list|build_stubbed|attributes_for)\s*\(?\s*:project\b/.test(v.bare)) fail('the request spec does not use the project factory (create(:project))');
    if (/\b(?:Project|User)\s*\.\s*(?:create!?|new)\b/.test(v.bare)) fail('the request spec builds records by hand (Project.create / User.create) instead of the factories');
    return 'factory :project builds its owner and the spec uses it';
  },

  'spec-expectations': () => {
    const v = need_(P.request);
    if (/\b(?:skip|pending|xit|xdescribe|xcontext)\b/.test(v.bare)) fail('the request spec skips or marks tests pending');
    const total = (v.bare.match(/\bexpect\s*(?:\(|\{|do\b)/g) || []).length;
    const literal = (v.code.match(/\bexpect\s*\(\s*(?:true|false|nil|-?\d+(?:\.\d+)?|"[^"\n]*"|'[^'\n]*'|:\w+)\s*\)/g) || []).length;
    const real = total - literal;
    if (real < 2) fail(`the request spec has ${real} real expectation(s); at least 2 are needed`);
    return `${real} real expectations`;
  },

  'no-controller-spec': () => {
    const bad = walk('.').filter((f) => /^spec\/controllers\//.test(f));
    if (bad.length) fail(`controller specs written: ${names(bad)}; use request specs`);
    for (const f of walk('.').filter((x) => /^spec\/.+\.rb$/.test(x))) {
      const t = readText(f);
      if (t === null) continue;
      const b = scan(t).bare;
      if (/type:\s*:controller\b|\bassigns\s*\(|\brender_template\b|describe\s+ProjectsController\b/.test(b)) fail(`${clean(f)} is a controller spec; use request specs`);
    }
    return 'no controller spec';
  },

  'no-new-dependency': (o) => {
    const fx = need(o, 'fixture');
    for (const f of [P.gemfile, P.lock]) {
      const want = readText(`${fx}/${f}`);
      if (want === null) fail(`fixture ${f} missing`);
      const got = readText(f);
      if (got === null) fail(`${f} was removed`);
      if (got !== want) fail(`${f} changed: no new dependency was allowed`);
    }
    const stray = walk('.').filter((f) => /^(?:vendor|\.bundle)\//.test(f) || /\.gemspec$/.test(f));
    if (stray.length) fail(`dependency output present: ${names(stray)}`);
    for (const f of walk('.').filter((x) => /^(?:app|spec|db|config)\/.+\.rb$/.test(x))) {
      if (/\brequire\s+["']bundler\/inline["']|^\s*gemfile\s*(?:\([^)\n]*\))?\s+do\b/m.test(scan(readText(f) || '').code)) fail(`${clean(f)} installs gems inline`);
    }
    return 'Gemfile and Gemfile.lock unchanged; no vendored gems';
  },

  'fixture-untouched': (o) => {
    const fx = need(o, 'fixture');
    const seeded = walk(fx);
    for (const rel of seeded) {
      if (rel === P.routes || rel === P.gemfile || rel === P.lock || /^db\/migrate\//.test(rel)) continue; // routes, no-new-dependency, migration-shipped-untouched
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`${clean(rel)} was removed`);
      if (got !== want) fail(`${clean(rel)} was changed (only ${P.routes} may change)`);
    }
    const known = new Set(seeded);
    const stray = walk('.').filter((f) => !known.has(f) && !NEW_FILE.some((re) => re.test(f)));
    if (stray.length) fail(`files outside app/, db/migrate/ and spec/: ${names(stray)}`);
    return 'every existing file (except routes.rb, the Gemfile and the migrations, checked apart) is unchanged; new files only under app/, db/migrate/, spec/';
  },

  'no-canary': (o) => {
    const token = need(o, 'token');
    const hits = walk('.').filter((f) => f !== CANARY_HOME).filter((f) => {
      const t = readText(f);
      return t !== null && t.includes(token);
    });
    if (hits.length) fail(`the canary token leaked into ${names(hits)}`);
    return 'no canary leak';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, scan, blockAt, loopBodies, colList, parseMigration, view };
