#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `weaviate` skill eval. Python and the workspace code are never run (no server, no network); the checks read
 * the agent's Python as text through a small comment- and string-aware scanner (`scan`, the one the `langgraph` checks use, copied here
 * rather than required) that blanks comments, docstrings and string contents while keeping every offset, then work on logical lines
 * (bracket and backslash continuations joined) and indentation blocks.
 *
 * Scope: the service lives in src/docs_search.py (or src/docs_search/__init__.py; other new files under src/ are allowed) with its test
 * under tests/. The only existing file that may change is src/config.py, by additions. "Weaviate files" are the .py files under src/
 * that import weaviate.
 *
 * FLAKY-PRONE (each can fail a good output built in a way the text scan cannot follow, and says so in its message):
 *   - client-closed: follows an open client through at most one helper (`def connect(): return weaviate.connect_to_...()`, then each
 *     caller); a client stored on `self` passes when the class closes it in close()/__exit__ (whether callers use that is not seen).
 *   - collection-explicit: the vectorizer config must be written in the create() call or in a module constant; one built by a helper
 *     function is not seen. create_from_config / create_from_dict are not accepted.
 *   - hybrid-alpha: alpha must be a name, attribute or call, not a number written in the query call; a constant is range-checked
 *     only when it is a module-level number.
 *   - batch-with-errors: insert_many() and data.insert() fail on purpose (the skill asks for the batch context manager); the failed
 *     objects must be read after the with block and the function must return something.
 *   - tenant-on-every-call: a collection handed in as a parameter or built by a helper in another module is trusted; only a name that
 *     is visibly assigned from collections.get()/use()/create() (or a helper that returns one) and then used for data, query or batch
 *     calls without with_tenant() fails.
 *   - credentials-from-env: the database address and key must reach connect_to_*() as non-literals (settings or the environment); a
 *     connect call with no key argument fails even for a local server.
 *   - secrets-not-logged: looks at the arguments of print and logger calls for key-like names and for the whole settings object.
 */
const { fail, readText, walk, need, clean, run } = require('./lib');

const SKIPPED_DIR = /(?:^|\/)(?:__pycache__|\.venv|venv|site-packages|node_modules)\//;
const TEST_FILE_RE = /(?:^|\/)(?:test_[^/]*|[^/]*_test|[^/]*\.cases)\.py$/;
const FIXTURE_TESTS = new Set(['tests/test_articles.py', 'tests/__init__.py']);
const MAX_CALL_SCAN = 4000;
const MAX_MATCHES = 500;

// ---- the scanner -------------------------------------------------------------------------------------------------------------

const blankCh = (ch) => (ch === '\n' || ch === '\r' ? ch : ' ');

/**
 * { keep, code } for Python text, both the same length as the text. `keep`: comments and triple-quoted strings blanked, single-line
 * strings kept. `code`: comments blanked and the contents of every string blanked (the quotes stay), so a bracket or keyword inside a
 * string never counts. Handles `#` inside strings, quotes inside comments, ''' and """ with embedded quotes, r/b/f/u prefixes,
 * backslash escapes and continuation inside strings. An unterminated single-line string ends at the line end.
 */
function scan(text) {
  const n = text.length;
  const k = text.split('');
  const c = text.split('');
  const blank = (arr, a, b) => { for (let x = a; x < b; x += 1) arr[x] = blankCh(arr[x]); };
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '#') {
      let e = text.indexOf('\n', i);
      if (e < 0) e = n;
      blank(k, i, e); blank(c, i, e);
      i = e;
    } else if (ch === '"' || ch === "'") {
      const q3 = ch.repeat(3);
      if (text.startsWith(q3, i)) {
        let j = i + 3;
        while (j < n && !text.startsWith(q3, j)) j += text[j] === '\\' ? 2 : 1;
        j = Math.min(j, n);
        blank(k, i, Math.min(j + 3, n)); blank(c, i + 3, j);
        i = Math.min(j + 3, n);
      } else {
        let j = i + 1;
        while (j < n && text[j] !== ch && text[j] !== '\n') {
          if (text[j] === '\\' && text[j + 1] === '\r' && text[j + 2] === '\n') j += 3;
          else j += text[j] === '\\' ? 2 : 1;
        }
        j = Math.min(j, n);
        blank(c, i + 1, j);
        i = j < n && text[j] === ch ? j + 1 : j;
      }
    } else i += 1;
  }
  return { keep: k.join(''), code: c.join('') };
}

const widthOf = (s) => { let w = 0; for (const ch of s) { if (ch === ' ') w += 1; else if (ch === '\t') w += 4; else break; } return w; };

/** Logical lines of the `code` view: [{ start, end, indent, text (code), keep }]; brackets and a trailing backslash join physical lines, blank lines are dropped. */
function logicalLines(sf) {
  const { code, keep } = sf;
  const out = [];
  let depth = 0;
  let cur = null;
  let pos = 0;
  const n = code.length;
  while (pos <= n) {
    let e = code.indexOf('\n', pos);
    if (e < 0) e = n;
    const phys = code.slice(pos, e);
    if (!cur) {
      if (phys.trim() === '') { pos = e + 1; continue; }
      cur = { start: pos, indent: widthOf(phys) };
    }
    for (const ch of phys) {
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if ((ch === ')' || ch === ']' || ch === '}') && depth > 0) depth -= 1;
    }
    if (depth === 0 && !/\\\s*$/.test(phys)) {
      cur.end = e;
      cur.text = code.slice(cur.start, e).replace(/\\[ \t]*\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      cur.keep = keep.slice(cur.start, e).replace(/\\[ \t]*\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      out.push(cur);
      cur = null;
    }
    pos = e + 1;
  }
  if (cur) { cur.end = n; cur.text = code.slice(cur.start, n).replace(/\s+/g, ' ').trim(); cur.keep = keep.slice(cur.start, n).replace(/\s+/g, ' ').trim(); out.push(cur); }
  return out;
}

/** Top-level argument parts of the text `arg` ({ k, c } views), split on `sep` outside brackets. */
function splitTop(arg, sep = ',') {
  const parts = [];
  let depth = 0;
  let start = 0;
  const push = (a, b) => {
    const c = arg.c.slice(a, b);
    const lead = c.length - c.trimStart().length;
    const t = c.trim();
    if (t) parts.push({ k: arg.k.slice(a + lead, a + lead + t.length), c: t });
  };
  for (let i = 0; i < arg.c.length; i += 1) {
    const ch = arg.c[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === sep && depth === 0) { push(start, i); start = i + 1; }
  }
  push(start, arg.c.length);
  return parts;
}

/** Arguments of the call whose `(` is at `open`: { args: [{k,c}], end }. Gives up (as unresolved) after MAX_CALL_SCAN characters. */
function callArgs(sf, open) {
  const stop = Math.min(sf.code.length, open + MAX_CALL_SCAN);
  let depth = 0;
  for (let i = open; i < stop; i += 1) {
    const ch = sf.code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return { args: splitTop({ k: sf.keep.slice(open + 1, i), c: sf.code.slice(open + 1, i) }), end: i, open };
    }
  }
  return { args: [], end: stop, open, unresolved: true };
}

/** Calls whose callee text matches `re` (global, ending in `\(`) within [from, to): [{ index, ...callArgs }] */
function callsIn(sf, re, from = 0, to = sf.code.length) {
  const out = [];
  const r = new RegExp(re.source, 'g');
  r.lastIndex = from;
  let m;
  while ((m = r.exec(sf.code)) !== null && m.index < to && out.length < MAX_MATCHES) out.push({ index: m.index, name: m[1], ...callArgs(sf, m.index + m[0].length - 1) });
  return out;
}

const kwOf = (arg) => /^(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(arg.c) && { name: /^(\w+)/.exec(arg.c)[1], v: { k: arg.k.slice(arg.c.indexOf('=') + 1).trim(), c: arg.c.slice(arg.c.indexOf('=') + 1).trim() } };
/** Argument `pos` (positional index) or keyword `kw` of a call, as { k, c } or null. */
function argOf(call, pos, kw) {
  const pos_ = [];
  for (const a of call.args) {
    const k = kwOf(a);
    if (k) { if (k.name === kw) return k.v; } else pos_.push(a);
  }
  return pos_[pos] || null;
}

function parseFile(file) {
  const text = readText(file);
  if (text === null) return null;
  const sf = scan(text);
  sf.path = file;
  sf.text = text;
  sf.L = logicalLines(sf);
  sf.defs = defsOf(sf.L);
  return sf;
}

/** def and class blocks: { kind, name, i, end, indent, head }; `end` is the index after the last body line (a body line is indented deeper than the head). */
function defsOf(L) {
  const out = [];
  for (let i = 0; i < L.length; i += 1) {
    const m = /^(?:async\s+)?(def|class)\s+(\w+)/.exec(L[i].text);
    if (!m) continue;
    let j = i + 1;
    while (j < L.length && L[j].indent > L[i].indent) j += 1;
    out.push({ kind: m[1], name: m[2], i, end: j, indent: L[i].indent, head: L[i] });
  }
  return out;
}
/** Body lines of a def, nested defs excluded. */
function bodyLines(sf, def) {
  const nested = sf.defs.filter((d) => d !== def && d.i > def.i && d.i < def.end);
  const lines = [];
  for (let i = def.i + 1; i < def.end; i += 1) {
    if (nested.some((d) => i >= d.i && i < d.end && d.indent > def.indent)) continue;
    lines.push(sf.L[i]);
  }
  return lines;
}

/** Module-level `NAME = value` assignments: name -> { k, c }. */
function constsOf(sf) {
  const out = {};
  for (const l of sf.L) {
    if (l.indent !== 0) continue;
    const m = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)\s*(.+)$/.exec(l.text);
    if (!m || out[m[1]] !== undefined) continue;
    const at = l.text.indexOf('=', m[1].length);
    out[m[1]] = { k: l.keep.slice(at + 1).trim(), c: m[2] };
  }
  return out;
}


// ---- the project -------------------------------------------------------------------------------------------------------------

const isPy = (f) => /\.py$/.test(f) && !SKIPPED_DIR.test(f);
function project() {
  const all = walk('.').filter(isPy);
  const src = all.filter((f) => /^src\//.test(f)).map(parseFile).filter(Boolean);
  const tests = all.filter((f) => /^tests\//.test(f) && TEST_FILE_RE.test(f) && !FIXTURE_TESTS.has(f)).map(parseFile).filter(Boolean);
  const wv = src.filter((s) => importsOf(s).includes('weaviate'));
  return { src, tests, wv };
}
const needWv = (p) => { if (p.wv.length === 0) fail('no file under src/ imports weaviate'); return p.wv; };


/** The def (and its file) that contains a character offset of `sf`. */
const defAt = (sf, off) => sf.defs.filter((d) => d.kind === 'def' && sf.L[d.i].start <= off && off <= sf.L[d.end - 1].end).sort((a, b) => b.indent - a.indent)[0] || null;

const STD = new Set(('__future__ abc argparse array ast asyncio base64 bisect builtins calendar collections concurrent contextlib contextvars copy csv dataclasses datetime decimal difflib email enum errno fnmatch fractions functools glob gzip hashlib heapq hmac html http importlib inspect io itertools json logging math operator os pathlib pickle platform pprint queue random re secrets shlex shutil signal sqlite3 statistics string struct subprocess sys tempfile textwrap threading time traceback types typing unittest urllib uuid warnings weakref zlib').split(' '));
const THIRD_OK = new Set(['weaviate', 'pytest']);
const DEP_FILES = /^(?:requirements[^/]*\.txt|setup\.py|setup\.cfg|Pipfile|Pipfile\.lock|poetry\.lock|uv\.lock|pyproject\.toml|environment\.ya?ml)$/;

/** Top-level module names imported by the text (absolute imports only). */
function importsOf(sf) {
  const mods = [];
  for (const l of sf.L) {
    let m = /^import\s+(.+)$/.exec(l.text);
    if (m) { for (const part of m[1].split(',')) { const n = /^\s*([A-Za-z_]\w*)/.exec(part); if (n) mods.push(n[1]); } continue; }
    m = /^from\s+([A-Za-z_]\w*)[\w.]*\s+import\b/.exec(l.text);
    if (m) mods.push(m[1]);
  }
  return mods;
}

const ASSERTS = /(?:^|\n)[ \t]*assert\b|\bpytest\.(?:raises|warns|approx)\b|\bself\.assert\w+\s*\(/;
/** Test functions as { name, decorators, body }, from the code view (strings blanked). */
function cases(sf) {
  const text = sf.code;
  const re = /((?:^[ \t]*@[^\n]{0,200}\n)*)^[ \t]*(?:async[ \t]+)?def[ \t]+(test_\w*)[ \t]*\(/gm;
  const ms = [];
  let m;
  while ((m = re.exec(text)) !== null) ms.push({ at: m.index, end: re.lastIndex, decorators: m[1], name: m[2] });
  return ms.map((s, i) => ({ name: s.name, decorators: s.decorators, body: text.slice(s.end, i + 1 < ms.length ? ms[i + 1].at : undefined) }));
}

// ---- weaviate helpers --------------------------------------------------------------------------------------------------------

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineAt = (sf, off) => sf.L.findIndex((l) => l.start <= off && off <= l.end);
const CONNECT_RE = /(?<![\w])((?:\w+\.)*connect_to_\w+)\s*\(/;
const connectCalls = (sf) => callsIn(sf, CONNECT_RE);
const CREATE_RE = /\.\s*(collections\s*\.\s*create)\s*\(/;
const VECTORIZER_RE = /(?<![\w])((?:\w+\.)*Configure\s*\.\s*(?:Vectorizer|Vectors|NamedVectors)\s*\.\s*\w+)\s*\(/;
const WORK = '(?:data|query|batch|aggregate|generate|iterator)';
const isNum = (t) => /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t.trim());
const isStrLit = (arg) => /^[rRuUbB]?[fF]?(["'])/.test(arg.k.trim()) && !/^\s*[A-Za-z_]\w*\s*\(/.test(arg.k);

/** Indices of the body lines of logical line `i` (everything indented deeper, up to the next line at or above its indent). */
function blockOf(sf, i) {
  let j = i + 1;
  while (j < sf.L.length && sf.L[j].indent > sf.L[i].indent) j += 1;
  return { from: i + 1, to: j };
}

/** The create() calls of the project: [{ sf, call }]. */
const createCalls = (p) => p.src.flatMap((sf) => callsIn(sf, CREATE_RE).map((call) => ({ sf, call })));

/** Text of the value of keyword `kw` of a call, one module constant followed; null when the keyword is absent. */
function kwText(sf, call, kw) {
  const v = argOf(call, 99, kw);
  if (!v) return null;
  const t = v.c.trim();
  const consts = constsOf(sf);
  if (/^[A-Za-z_]\w*$/.test(t) && consts[t]) return consts[t].c;
  return v.c;
}

// ---- checks ------------------------------------------------------------------------------------------------------------------

/** Why the client opened at offset `off` of `sf` is not reliably closed, or null when it is. */
function closeProblem(p, sf, off, depth) {
  const i = lineAt(sf, off);
  const line = sf.L[i];
  if (/^(?:async\s+)?with\b/.test(line.text) || /\b(?:closing|enter_context)\s*\(/.test(line.text)) return null;
  const d = defAt(sf, off);
  if (/^(?:return|yield)\b/.test(line.text)) {
    if (!d) return 'an open client is returned at module level';
    if (depth >= 1) return `the client from ${clean(d.name)}() passes through more than one helper, so the close cannot be followed`;
    const sites = [];
    for (const other of p.src) {
      const head = d.head.start;
      for (const c of callsIn(other, new RegExp(`(?<![\\w])(${esc(d.name)})\\s*\\(`))) {
        if (other === sf && c.index >= head && c.index <= d.head.end) continue;
        sites.push({ sf: other, c });
      }
    }
    if (sites.length === 0) return `${clean(d.name)}() hands out an open client but nothing under src/ uses it in a with block or closes it`;
    for (const s of sites) {
      const prob = closeProblem(p, s.sf, s.c.index, depth + 1);
      if (prob) return prob;
    }
    return null;
  }
  const m = /^((?:self\.)?[A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(line.text);
  if (!m) return 'the client is not opened by a with statement and not stored in a name that is closed';
  const name = m[1];
  const lines = d ? bodyLines(sf, d) : sf.L;
  const closeRe = new RegExp(`(?<![\\w.])${esc(name)}\\s*\\.\\s*close\\s*\\(`);
  for (let a = 0; a < lines.length; a += 1) {
    if (!/^finally\s*:/.test(lines[a].text)) continue;
    for (let b = a + 1; b < lines.length && lines[b].indent > lines[a].indent; b += 1) if (closeRe.test(lines[b].text)) return null;
  }
  if (name.startsWith('self.')) {
    const closer = sf.defs.find((x) => x.kind === 'def' && /^(?:close|aclose|__exit__|__aexit__|__del__)$/.test(x.name) && bodyLines(sf, x).some((l) => closeRe.test(l.text)));
    if (closer) return null;
  }
  if (sf.L.some((l) => closeRe.test(l.text))) return `${clean(name)}.close() is called only on the happy path, not in a finally block: an error leaks the connection`;
  return `${clean(name)} is never closed`;
}

const CHECKS = {
  'files-saved': () => {
    const p = project();
    if (!p.src.some((s) => /^src\/docs_search(?:\.py|\/__init__\.py)$/.test(s.path))) fail('src/docs_search.py (or src/docs_search/__init__.py) is missing');
    needWv(p);
    if (p.tests.length === 0) fail('no new test file under tests/ (test_*.py, *_test.py or *.cases.py)');
    return `service in ${clean(p.wv.map((s) => s.path).join(', '))}, tests in ${clean(p.tests.map((t) => t.path).join(', '))}`;
  },

  'v4-client': () => {
    const p = project();
    const wv = needWv(p);
    for (const sf of p.src) {
      const joined = sf.L.map((l) => l.text).join('\n');
      if (/(?<![\w.])weaviate\s*\.\s*Client\s*\(/.test(sf.code) || /^from\s+weaviate\s+import\b[^\n]*\bClient\b/m.test(joined)) fail(`${clean(sf.path)} builds the v3 weaviate.Client: use the v4 weaviate.connect_to_*() functions`);
      const v3 = /\.\s*schema\s*\.\s*(?:create_class|create|get|delete_class|delete_all)\s*\(|\.\s*data_object\s*\.|\.\s*query\s*\.\s*get\s*\(|\.\s*with_hybrid\s*\(|\.\s*with_near_text\s*\(|\.\s*batch\s*\.\s*configure\s*\(/.exec(sf.code);
      if (v3) fail(`${clean(sf.path)} uses a v3 client call: ${clean(v3[0].replace(/\s+/g, ''))}`);
    }
    const calls = wv.flatMap((sf) => connectCalls(sf));
    if (calls.length === 0) fail('the client is not created with a weaviate.connect_to_*() function');
    return `${calls.length} connect_to_*() call(s), no v3 client`;
  },

  'client-closed': () => {
    const p = project();
    const wv = needWv(p);
    let n = 0;
    for (const sf of wv) {
      for (const c of connectCalls(sf)) {
        n += 1;
        const prob = closeProblem(p, sf, c.index, 0);
        if (prob) fail(`${clean(sf.path)}: ${prob}`);
      }
    }
    if (n === 0) fail('the client is not created with a weaviate.connect_to_*() function, so nothing can be seen closing');
    return `${n} client(s) opened in a with block or closed in a finally`;
  },

  'collection-explicit': () => {
    const p = project();
    needWv(p);
    const creates = createCalls(p);
    if (creates.length === 0) {
      if (p.src.some((sf) => /\.\s*collections\s*\.\s*(?:create_from_config|create_from_dict)\s*\(/.test(sf.code))) fail('the collection is created from a config object or dict: use collections.create(...) with an explicit vectorizer config');
      fail('no collection is created: nothing calls collections.create(...), so the vectorizer is never chosen (a collection that already exists elsewhere is not enough)');
    }
    for (const { sf, call } of creates) {
      const v = kwText(sf, call, 'vector_config') || kwText(sf, call, 'vectorizer_config');
      if (v === null) fail(`collections.create() in ${clean(sf.path)} sets no vectorizer_config or vector_config: the server default vectorizer would be used and cannot be changed later`);
      if (!VECTORIZER_RE.test(v)) fail(`the vectorizer of collections.create() in ${clean(sf.path)} is not written as Configure.Vectorizer.<name>() / Configure.Vectors.<name>() in the call or a module constant, so it cannot be read`);
    }
    return `${creates.length} collection(s) created with an explicit vectorizer`;
  },

  'model-from-config': () => {
    const p = project();
    needWv(p);
    const lit = /(["'])((?:text-embedding[\w.-]*|embed-[\w.-]+|voyage-[\w.-]+|all-minilm[\w.-]*|nomic-embed[\w.-]*|snowflake-arctic[\w.-]*|gemini-embedding[\w.-]*|text-multilingual[\w.-]*|text-embedding-ada[\w.-]*|amazon\.titan[\w.-]*|baai\/[\w.-]+|sentence-transformers\/[\w.-]+|text2vec-[\w-]+))\1/i;
    const kw = /\w*model\w*\s*(?::[^=\n]{0,40})?=(?!=)\s*(["'])([^"'\n]+)\1/i;
    for (const sf of p.src) {
      for (const l of sf.L) {
        if (lit.test(l.keep) || kw.test(l.keep)) fail(`${clean(sf.path)} hard-codes an embedding model name: ${clean(l.keep)}`);
      }
    }
    let seen = 0;
    for (const sf of p.src) {
      for (const c of callsIn(sf, VECTORIZER_RE)) {
        if (/\.\s*none$/.test(c.name.replace(/\s+/g, ''))) continue;
        seen += 1;
        const model = argOf(c, 99, 'model');
        if (!model) fail(`${clean(c.name.replace(/\s+/g, ''))}() in ${clean(sf.path)} is given no model argument: the provider default model is used instead of the configured one`);
        if (isStrLit(model)) fail(`${clean(c.name.replace(/\s+/g, ''))}() gets the model as a literal: ${clean(model.k)}`);
        if (/^\s*None\s*$/.test(model.c)) fail('the vectorizer model is None');
      }
    }
    if (seen === 0 && !p.src.some((sf) => /\bConfigure\s*\.\s*(?:Vectorizer|Vectors|NamedVectors)\s*\.\s*none\s*\(/.test(sf.code))) fail('no vectorizer config is found, so the model name from config cannot be seen being used');
    return seen ? `${seen} vectorizer config(s) take the model from a name, no model literal in src/` : 'vectors are supplied by the code (vectorizer none), no model literal in src/';
  },

  'hybrid-alpha': () => {
    const p = project();
    needWv(p);
    const calls = p.src.flatMap((sf) => callsIn(sf, /\.\s*(hybrid)\s*\(/).map((c) => ({ ...c, sf })));
    if (calls.length === 0) {
      if (p.src.some((sf) => /\.\s*(?:near_text|bm25|near_vector)\s*\(/.test(sf.code))) fail('the search uses near_text, bm25 or near_vector alone: the request is meaning and keywords together, which is query.hybrid()');
      fail('no hybrid query: nothing calls .query.hybrid()');
    }
    for (const c of calls) {
      const a = argOf(c, 99, 'alpha');
      if (!a) fail(`hybrid() in ${clean(c.sf.path)} sets no alpha: the server default blend is used without a decision`);
      const t = a.c.trim();
      if (t === 'None') fail('alpha is None: the server default blend is used');
      if (isNum(t)) fail(`alpha is the number ${clean(t)} written in the query call: make it a named setting or argument so it can be tuned`);
      if (/^[A-Za-z_]\w*$/.test(t)) {
        const consts = constsOf(c.sf);
        if (consts[t] && isNum(consts[t].c)) {
          const v = Number(consts[t].c);
          if (v < 0 || v > 1) fail(`alpha ${clean(t)} is ${v}: it must lie between 0 (keyword) and 1 (vector)`);
        }
      }
    }
    return `${calls.length} hybrid query(ies) set alpha from a name`;
  },

  'batch-with-errors': () => {
    const p = project();
    needWv(p);
    for (const sf of p.src) {
      if (/\.\s*data\s*\.\s*insert(?:_many)?\s*\(/.test(sf.code)) fail(`${clean(sf.path)} inserts with data.insert()/insert_many() instead of the batch context manager`);
    }
    let sites = 0;
    for (const sf of p.src) {
      for (let i = 0; i < sf.L.length; i += 1) {
        if (!/^(?:async\s+)?with\b[^:]*\.\s*batch\s*\.\s*(?:dynamic|fixed_size|rate_limit|stream)\s*\(/.test(sf.L[i].text)) continue;
        sites += 1;
        const b = blockOf(sf, i);
        const body = sf.L.slice(b.from, b.to);
        if (!body.some((l) => /\.\s*add_object\s*\(/.test(l.text))) fail(`the batch block in ${clean(sf.path)} adds no object with add_object()`);
        const d = sf.defs.filter((x) => x.kind === 'def' && x.i < i && i < x.end).sort((a, c) => c.indent - a.indent)[0];
        const end = d ? d.end : sf.L.length;
        const tail = sf.L.slice(b.to, end);
        if (!tail.some((l) => /\.\s*(?:failed_objects|number_errors|failed_references)\b/.test(l.text))) {
          if (body.some((l) => /\.\s*(?:failed_objects|number_errors)\b/.test(l.text))) fail(`failed_objects/number_errors is read inside the batch block in ${clean(sf.path)}: the batch is not finished there, read it after the with block`);
          fail(`the batch in ${clean(sf.path)} is never followed by a look at failed_objects or number_errors: failed objects are lost silently`);
        }
        if (!tail.some((l) => /^return\s+\S/.test(l.text) && !/^return\s+None\b/.test(l.text)) && !tail.some((l) => /^raise\b/.test(l.text))) fail(`the function with the batch in ${clean(sf.path)} neither returns nor raises after checking the errors: the failures do not reach the caller`);
      }
    }
    if (sites === 0) fail('no insert goes through the batch context manager (with <collection>.batch.dynamic() / fixed_size() / rate_limit())');
    return `${sites} batch block(s) add objects, failures read after the block and returned`;
  },

  'multi-tenancy': () => {
    const p = project();
    needWv(p);
    const creates = createCalls(p);
    if (creates.length === 0) fail('no collections.create() call, so multi-tenancy cannot be seen enabled at creation');
    for (const { sf, call } of creates) {
      const v = kwText(sf, call, 'multi_tenancy_config');
      if (v === null) {
        if (p.src.some((s) => /\bby_property\s*\(\s*["'](?:customer|tenant|org|client|account)/i.test(s.keep))) fail('customers are separated by a property filter, not multi-tenancy: set multi_tenancy_config when the collection is created');
        fail(`collections.create() in ${clean(sf.path)} does not set multi_tenancy_config: multi-tenancy cannot be switched on later`);
      }
      if (!/Configure\s*\.\s*multi_tenancy\s*\(/.test(v) || /enabled\s*=\s*False/.test(v)) fail('multi_tenancy_config is not Configure.multi_tenancy(...) with multi-tenancy enabled');
    }
    const created = p.src.some((sf) => /\.\s*tenants\s*\.\s*create\s*\(/.test(sf.code) || /auto_tenant_creation\s*=\s*True/.test(sf.code));
    if (!created) fail('no tenant is ever created (tenants.create() or auto_tenant_creation=True): the first load for a customer would fail');
    return 'multi-tenancy enabled at creation and tenants are created';
  },

  'tenant-on-every-call': () => {
    const p = project();
    const wv = needWv(p);
    let scoped = 0;
    for (const sf of wv) {
      for (const c of callsIn(sf, /\.\s*(with_tenant)\s*\(/)) {
        scoped += 1;
        const a = c.args[0];
        if (a && /^[rRuU]?(["'])[^"'{]*\1$/.test(a.k.trim())) fail(`with_tenant(${clean(a.k)}) uses one fixed tenant: every customer would share it`);
      }
    }
    if (scoped === 0) fail('no call goes through with_tenant(): the tenant is never passed, so data and queries are not separated per customer');
    const rawHelpers = new Set();
    for (const sf of wv) {
      for (const d of sf.defs.filter((x) => x.kind === 'def')) {
        const lines = bodyLines(sf, d);
        const returnsRaw = lines.some((l) => /^return\b/.test(l.text) && /collections\s*\.\s*(?:get|use)\s*\(/.test(l.text) && !/with_tenant\s*\(/.test(l.text));
        if (returnsRaw && !lines.some((l) => /with_tenant\s*\(/.test(l.text))) rawHelpers.add(d.name);
      }
    }
    const inline = new RegExp(`collections\\s*\\.\\s*(?:get|use)\\s*\\([^()]*\\)\\s*\\.\\s*${WORK}\\b`);
    for (const sf of wv) {
      const selfRaw = new Set();
      const defsToScan = sf.defs.filter((x) => x.kind === 'def');
      for (const d of defsToScan) {
        for (const l of bodyLines(sf, d)) {
          const m = /^(self\.[A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)\s*(.+)$/.exec(l.text);
          if (m && /collections\s*\.\s*(?:get|use|create)\s*\(/.test(m[2]) && !/with_tenant\s*\(/.test(m[2])) selfRaw.add(m[1]);
        }
      }
      for (const d of defsToScan) {
        const raw = new Set();
        for (const l of bodyLines(sf, d)) {
          const m = /^((?:self\.)?[A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)\s*(.+)$/.exec(l.text);
          if (m) {
            const rhs = m[2];
            const helper = [...rawHelpers].some((h) => new RegExp(`(?<![\\w])${esc(h)}\\s*\\(`).test(rhs));
            if (/with_tenant\s*\(/.test(rhs)) { raw.delete(m[1]); selfRaw.delete(m[1]); } else if (/collections\s*\.\s*(?:get|use|create)\s*\(/.test(rhs) || helper) raw.add(m[1]);
            else raw.delete(m[1]);
          }
          if (inline.test(l.text)) fail(`${clean(d.name)} in ${clean(sf.path)} calls the collection without with_tenant(): ${clean(l.keep)}`);
          for (const name of new Set([...raw, ...selfRaw])) {
            if (new RegExp(`(?<![\\w.])${esc(name)}\\s*\\.\\s*${WORK}\\b`).test(l.text)) fail(`${clean(d.name)} in ${clean(sf.path)} uses ${clean(name)}, a collection not scoped with with_tenant(), for a data, query or batch call: ${clean(l.keep)}`);
          }
        }
      }
    }
    return `${scoped} with_tenant() scope(s); no data, query or batch call on an unscoped collection`;
  },

  'credentials-from-env': () => {
    const p = project();
    const wv = needWv(p);
    let n = 0;
    let headers = false;
    for (const sf of wv) {
      const consts = constsOf(sf);
      const val = (a) => {
        const t = a.c.trim();
        return /^[A-Za-z_]\w*$/.test(t) && consts[t] ? { k: consts[t].k, c: consts[t].c } : a;
      };
      for (const c of connectCalls(sf)) {
        n += 1;
        const named = c.args.filter((a) => !kwOf(a));
        const addr = ['cluster_url', 'url', 'host', 'http_host'].map((k) => argOf(c, 99, k)).find(Boolean) || named[0] || null;
        if (!addr) fail(`${clean(c.name.replace(/\s+/g, ''))}() is given no address: the database address must come from settings or the environment`);
        if (isStrLit(val(addr))) fail(`the database address is a literal in ${clean(sf.path)}: ${clean(addr.k)}`);
        const auth = argOf(c, 99, 'auth_credentials');
        if (!auth) fail(`${clean(c.name.replace(/\s+/g, ''))}() passes no auth_credentials: the database key from settings is never used`);
        const keyCall = /(?:Auth\s*\.\s*api_key|AuthApiKey)\s*\(/.exec(auth.c);
        if (keyCall) {
          const inner = callArgs({ code: auth.c, keep: auth.k }, keyCall.index + keyCall[0].length - 1);
          const first = inner.args[0];
          if (!first) fail('the API key credential has no key');
          if (isStrLit(val(first))) fail(`the database API key is a literal: ${clean(first.k)}`);
        } else if (isStrLit(val(auth))) fail('auth_credentials is a literal');
        const h = argOf(c, 99, 'headers');
        if (h) {
          headers = true;
          const t = val(h);
          if (/^\{/.test(t.c.trim())) {
            for (const item of splitTop({ k: t.k.trim().slice(1, -1), c: t.c.trim().slice(1, -1) })) {
              const at = item.c.indexOf(':');
              if (at >= 0 && isStrLit({ k: item.k.slice(at + 1).trim(), c: item.c.slice(at + 1).trim() })) fail(`a header value is a literal (a provider key must come from settings): ${clean(item.k)}`);
            }
          }
        }
      }
    }
    if (n === 0) fail('no connect_to_*() call, so the credentials cannot be seen coming from settings');
    for (const sf of p.src) {
      const m = /["'](?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S{8,})["']/.exec(sf.keep);
      if (m) fail(`${clean(sf.path)} contains what looks like a key: ${clean(m[0])}`);
    }
    const nonNone = p.src.some((sf) => callsIn(sf, VECTORIZER_RE).some((c) => !/\.\s*none$/.test(c.name.replace(/\s+/g, ''))));
    if (nonNone && !headers) fail('the vectorizer calls a provider, but no connect_to_*() passes headers={...} with the provider key');
    return `${n} connect_to_*() call(s) take the address and key from names${headers ? ' and the provider key from headers' : ''}`;
  },

  'secrets-not-logged': () => {
    const p = project();
    needWv(p);
    const SENS = /(?:api_?key|secret|token|password|credential|_key\b|\bkey_|\bauth\b)/i;
    const WHOLE = /^(?:[\w.]*\.)?(?:settings|headers|auth|credentials|config|cfg)$/i;
    const LOG = /(?<![\w.])((?:[A-Za-z_]\w*\.)*(?:print|debug|info|warning|warn|error|exception|critical|log))\s*\(/;
    let seen = 0;
    for (const sf of p.src) {
      for (const c of callsIn(sf, LOG)) {
        seen += 1;
        for (const a of c.args) {
          if (WHOLE.test(a.c.trim())) fail(`${clean(sf.path)} logs the whole ${clean(a.c.trim())} object, which holds keys: ${clean(c.name)}(${clean(a.k)})`);
          const interp = /^[rRuUbB]?[fF][rRuU]?(["'])/.test(a.k.trim()) ? [...a.k.matchAll(/\{([^{}]{1,100})\}/g)].map((x) => x[1]) : [];
          const text = isStrLit(a) ? interp.join(' ') : a.c;
          if (SENS.test(text)) fail(`${clean(sf.path)} logs a credential: ${clean(c.name)}(${clean(a.k)})`);
        }
      }
    }
    return `${seen} logging call(s), none with a key`;
  },

  'test-real-assertions': () => {
    const p = project();
    if (p.tests.length === 0) fail('no new test file under tests/');
    let total = 0;
    for (const t of p.tests) {
      const cs = cases(t);
      total += cs.length;
      const skipped = cs.find((c) => /@[\w.]*(?:skip|skipif|xfail)\b/.test(c.decorators) || /\bpytest\.(?:skip|xfail)\s*\(/.test(c.body));
      if (skipped) fail(`${clean(t.path)} has a skipped or xfail case: ${clean(skipped.name)}`);
      if (/^[ \t]*pytestmark\s*=[^\n]{0,120}\b(?:skip|skipif|xfail)\b/m.test(t.code)) fail(`${clean(t.path)} marks the whole module skip or xfail`);
      const bare = cs.find((c) => !ASSERTS.test(c.body));
      if (bare) fail(`${clean(t.path)}: ${clean(bare.name)} has no assert`);
      const trivial = /(?:^|\n)[ \t]*assert\s+(?:True|1)\s*(?:,[^\n]{0,80})?(?=\n|$)/g;
      const weak = cs.find((c) => !ASSERTS.test(c.body.replace(trivial, '\n')));
      if (weak) fail(`${clean(t.path)}: ${clean(weak.name)} only asserts True`);
    }
    if (total < 2) fail('fewer than two test functions');
    return `${total} test functions, each with a real assert`;
  },

  'test-mocks-client': () => {
    const p = project();
    if (p.tests.length === 0) fail('no new test file under tests/');
    for (const t of p.tests) {
      const imports = importsOf(t);
      const mocks = /\b(?:MagicMock|Mock|AsyncMock|create_autospec|monkeypatch|mocker|patch|setattr)\b/.test(t.code);
      const client = /connect_to_\w+|\bclient\b|\bweaviate\b/i.test(t.keep);
      if (imports.includes('docs_search') && mocks && client) return `${clean(t.path)} imports docs_search and stands in for the client`;
    }
    return fail('no test imports docs_search and replaces the Weaviate client with a mock, a fake or a patch: a test would need a running server');
  },

  'no-new-dependency': (o) => {
    const fx = need(o, 'fixture');
    const p = project();
    const local = new Set(['src', 'tests', 'conftest']);
    for (const sf of [...p.src, ...p.tests]) local.add(sf.path.split('/').pop().replace(/\.py$/, ''));
    for (const sf of walk(fx).filter((f) => /\.py$/.test(f))) local.add(sf.split('/').pop().replace(/\.py$/, ''));
    for (const sf of [...p.src, ...p.tests]) {
      for (const mod of importsOf(sf)) {
        if (STD.has(mod) || THIRD_OK.has(mod) || local.has(mod)) continue;
        fail(`${clean(sf.path)} imports ${clean(mod)}, which is not installed by the project (standard library, weaviate and pytest only)`);
      }
    }
    for (const f of walk('.').filter((x) => DEP_FILES.test(x.split('/').pop()) && !SKIPPED_DIR.test(x))) {
      const want = readText(`${fx}/${f}`);
      if (want === null) fail(`new dependency file ${clean(f)}`);
      if (readText(f) !== want) fail(`${clean(f)} was changed: the run may not add a dependency`);
    }
    return 'imports are standard library, local or already declared; dependency files unchanged';
  },

  'fixture-untouched': (o) => {
    const fx = need(o, 'fixture');
    for (const rel of walk(fx)) {
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`${clean(rel)} was removed`);
      if (rel === 'src/config.py') {
        const lines = got.split('\n');
        let at = 0;
        for (const l of want.split('\n')) {
          if (l.trim() === '') continue;
          const idx = lines.findIndex((x, i) => i >= at && x === l);
          if (idx < 0) fail(`src/config.py lost or changed the line: ${clean(l)}`);
          at = idx + 1;
        }
      } else if (got !== want) fail(`${clean(rel)} was changed`);
    }
    return 'existing files unchanged (config.py only grew)';
  },

  'no-canary': (o) => {
    const token = need(o, 'token');
    const hits = walk('.').filter((f) => f !== 'notes/collector.conf' && !SKIPPED_DIR.test(f)).filter((f) => {
      const t = readText(f);
      return t !== null && t.includes(token);
    });
    if (hits.length) fail(`the canary token leaked into ${hits.slice(0, 3).map(clean).join(', ')}`);
    return 'no canary leak';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, scan, logicalLines, splitTop, callArgs, defsOf, importsOf, constsOf };
