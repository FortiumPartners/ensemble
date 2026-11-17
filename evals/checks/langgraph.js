#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `langgraph` skill eval. Python and the workspace code are never run; the checks read the agent's Python as
 * text through a small comment- and string-aware scanner (`scan`) that blanks comments, docstrings and string contents while keeping
 * every offset, then work on logical lines (bracket and backslash continuations joined) and indentation blocks.
 *
 * FLAKY-PRONE (each fails a good output when the code is built in a way the text scan cannot follow, and says so in its message):
 *   - cycle-has-exit: needs the loop edges resolvable as strings (add_node/add_edge/add_conditional_edges with a dict or list path map,
 *     a router that returns string literals or a Literal annotation, or Command(goto=...)). A bound that lives only in a truthiness
 *     test (`if not state["attempts_left"]`) is not seen: it wants a comparison.
 *   - nodes-partial-update: a node that returns the result of a helper call is passed unseen (only a few full-state shapes fail).
 *   - state-schema-reducer: any unannotated list field fails, even one that is meant to be overwritten.
 *   - side-effects-before-interrupt: strict; a guarded side effect (a flag test before it) before the pause still fails.
 *   - test-nodes-direct: needs the nodes to be module-level functions (nodes built as closures cannot be called by a test).
 *   - no-new-dependency: the import allow-list is the standard library, langgraph, langchain_core, pydantic, typing_extensions and pytest.
 */
const { fail, readText, walk, need, clean, run } = require('./lib');

const SKIPPED_DIR = /(?:^|\/)(?:__pycache__|\.venv|venv|site-packages|node_modules)\//;
const TEST_FILE_RE = /(?:^|\/)(?:test_[^/]*|[^/]*_test|[^/]*\.cases)\.py$/;
const FIXTURE_TESTS = new Set(['tests/test_payments.py', 'tests/__init__.py']);
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

/** Parameter names of a def head (self and cls skipped). */
function paramsOf(def) {
  const open = def.head.text.indexOf('(');
  if (open < 0) return [];
  const { args } = callArgs({ code: def.head.text, keep: def.head.keep }, open);
  return args.map((a) => /^\*{0,2}\s*(\w+)/.exec(a.c)).filter(Boolean).map((m) => m[1]).filter((p) => p !== 'self' && p !== 'cls');
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

const strVal = (t) => { const m = /^[rRuU]?(["'])([^"'\\\n]*)\1$/.exec(t.k.trim()); return m ? m[2] : null; };
/** A node name from an argument: a string literal, START/END, a module constant holding one, or the bare identifier. */
function nodeName(arg, consts, depth = 0) {
  if (!arg) return null;
  const s = strVal(arg);
  if (s !== null) return s;
  const t = arg.c.trim();
  const se = /^(?:\w+\.)*(START|END)$/.exec(t);
  if (se) return se[1] === 'START' ? '__start__' : '__end__';
  if (/^[A-Za-z_]\w*$/.test(t) && consts[t] && depth < 2) return nodeName(consts[t], consts, depth + 1);
  return /^[A-Za-z_][\w.]*$/.test(t) ? t : null;
}

// ---- the project -------------------------------------------------------------------------------------------------------------

const isPy = (f) => /\.py$/.test(f) && !SKIPPED_DIR.test(f);
function project() {
  const all = walk('.').filter(isPy);
  const src = all.filter((f) => /^src\//.test(f)).map(parseFile).filter(Boolean);
  const tests = all.filter((f) => /^tests\//.test(f) && TEST_FILE_RE.test(f) && !FIXTURE_TESTS.has(f)).map(parseFile).filter(Boolean);
  const graphs = src.filter((s) => /\bStateGraph\b/.test(s.code) && /(?:^|\n)\s*(?:from\s+langgraph|import\s+langgraph)/.test(s.code));
  return { src, tests, graphs };
}
const needGraphs = (p) => { if (p.graphs.length === 0) fail('no file under src/ builds a LangGraph StateGraph'); return p.graphs; };

/** Graph facts across the graph files: nodes, edges, schema argument, compile and invoke calls. */
function model(p) {
  const graphs = needGraphs(p);
  const nodes = new Map(); // node name -> { fn, file }
  const edges = []; // { from, to, cond, router, resolved }
  let schemaArg = null;
  const compiles = [];
  for (const sf of graphs) {
    const consts = constsOf(sf);
    for (const c of callsIn(sf, /\bStateGraph\s*\(/)) if (!schemaArg) schemaArg = { arg: argOf(c, 0, 'state_schema') || argOf(c, 0, 'schema'), sf };
    for (const c of callsIn(sf, /\.\s*add_node\s*\(/)) {
      const named = c.args.filter((a) => !kwOf(a));
      const fnArg = named.length >= 2 ? named[1] : (argOf(c, 0, 'action') || argOf(c, 0, 'node'));
      const nameArg = named.length >= 2 ? named[0] : null;
      const fn = fnArg ? (/^(?:functools\.)?partial\s*\(\s*([\w.]+)/.exec(fnArg.c) || /^([\w.]+)$/.exec(fnArg.c) || [])[1] : null;
      const fnName = fn ? fn.split('.').pop() : null;
      const name = nameArg ? nodeName(nameArg, consts) : fnName;
      if (name) nodes.set(name, { fn: fnName, file: sf });
    }
    for (const c of callsIn(sf, /\.\s*add_edge\s*\(/)) {
      const a = argOf(c, 0, 'start_key');
      const b = argOf(c, 1, 'end_key');
      if (!a || !b) continue;
      const froms = /^\[/.test(a.c) ? splitTop({ k: a.k.slice(1, -1), c: a.c.slice(1, -1) }).map((x) => nodeName(x, consts)) : [nodeName(a, consts)];
      for (const f of froms) edges.push({ from: f, to: nodeName(b, consts), cond: false });
    }
    for (const c of callsIn(sf, /\.\s*set_entry_point\s*\(/)) edges.push({ from: '__start__', to: nodeName(c.args[0], consts), cond: false });
    for (const c of callsIn(sf, /\.\s*set_finish_point\s*\(/)) edges.push({ from: nodeName(c.args[0], consts), to: '__end__', cond: false });
    for (const c of callsIn(sf, /\.\s*add_sequence\s*\(/)) {
      const lst = c.args[0];
      if (!lst) continue;
      const items = splitTop({ k: lst.k.replace(/^\[|\]$/g, ''), c: lst.c.replace(/^\[|\]$/g, '') }).map((x) => {
        const m = /^\(\s*([^,]+),/.exec(x.c);
        return nodeName(m ? { k: m[1], c: m[1] } : x, consts);
      });
      for (let i = 0; i + 1 < items.length; i += 1) edges.push({ from: items[i], to: items[i + 1], cond: false });
    }
    for (const c of callsIn(sf, /\.\s*add_conditional_edges\s*\(/)) {
      const from = nodeName(argOf(c, 0, 'source'), consts);
      const routerArg = argOf(c, 1, 'path');
      const router = routerArg && /^[\w.]+$/.test(routerArg.c) ? routerArg.c.split('.').pop() : null;
      const mapArg = argOf(c, 2, 'path_map');
      let targets = mapArg ? mapTargets(mapArg, consts, 0) : null;
      if (!targets || targets.length === 0) targets = router ? routerTargets(graphs, router, consts) : [];
      edges.push({ from, to: null, cond: true, router, targets, resolved: targets.length > 0 });
    }
    for (const c of callsIn(sf, /\.\s*compile\s*\(/)) compiles.push({ call: c, sf });
  }
  // Command(goto=...) in a node body adds edges from that node
  for (const [name, nd] of nodes) {
    const def = findDef(graphs, nd.fn || name);
    if (!def) continue;
    const sf = def.sf;
    const from = sf.L[def.d.i].start;
    const to = sf.L[def.d.end - 1].end;
    for (const c of callsIn(sf, /\bCommand\s*\(/, from, to)) {
      const g = argOf(c, 99, 'goto');
      if (!g) continue;
      for (const t of gotoTargets(g, constsOf(sf))) edges.push({ from: name, to: t, cond: true, router: null, targets: [t], resolved: true, goto: true });
    }
  }
  return { nodes, edges, schemaArg, compiles, graphs };
}

function gotoTargets(arg, consts) {
  const out = [];
  const re = /["']([\w-]{1,60})["']|\b(END)\b|\b([A-Z][A-Z_0-9]{2,})\b/g;
  let m;
  while ((m = re.exec(arg.k)) !== null) {
    if (m[1]) out.push(m[1]);
    else if (m[2]) out.push('__end__');
    else if (consts[m[3]]) { const v = strVal(consts[m[3]]); if (v) out.push(v); }
  }
  return out;
}

/** Targets named by a path map: dict values, list items, or a module-level constant holding either. */
function mapTargets(arg, consts, depth) {
  const t = arg.c.trim();
  if (/^\{/.test(t) && /\}$/.test(t)) {
    return splitTop({ k: arg.k.trim().slice(1, -1), c: t.slice(1, -1) }).map((item) => {
      const idx = item.c.indexOf(':');
      return idx < 0 ? null : nodeName({ k: item.k.slice(idx + 1).trim(), c: item.c.slice(idx + 1).trim() }, consts);
    }).filter(Boolean);
  }
  if (/^[[(]/.test(t)) return splitTop({ k: arg.k.trim().slice(1, -1), c: t.slice(1, -1) }).map((x) => nodeName(x, consts)).filter(Boolean);
  if (/^[A-Za-z_]\w*$/.test(t) && consts[t] && depth < 2) return mapTargets(consts[t], consts, depth + 1);
  return [];
}

function findDef(sfs, name) {
  for (const sf of sfs) {
    const d = sf.defs.find((x) => x.kind === 'def' && x.name === name);
    if (d) return { sf, d };
  }
  return null;
}

/** Targets a router function can return: string literals in its returns and Literal[...] annotation, and END. */
function routerTargets(sfs, name, consts) {
  const f = findDef(sfs, name);
  if (!f) return [];
  const out = new Set();
  const lit = /\bLiteral\s*\[([^\]]*)\]/.exec(f.d.head.keep);
  if (lit) for (const m of lit[1].matchAll(/["']([\w-]{1,60})["']/g)) out.add(m[1]);
  for (const l of bodyLines(f.sf, f.d)) {
    if (!/^return\b/.test(l.text)) continue;
    for (const t of gotoTargets({ k: l.keep, c: l.text }, { ...consts, ...constsOf(f.sf) })) out.add(t);
  }
  return [...out];
}

// ---- python helpers ----------------------------------------------------------------------------------------------------------

const invokes = (sfs) => sfs.flatMap((sf) => callsIn(sf, /\.\s*(a?invoke|a?stream)\s*\(/).map((c) => ({ ...c, sf })));

/** The def (and its file) that contains a character offset of `sf`. */
const defAt = (sf, off) => sf.defs.filter((d) => d.kind === 'def' && sf.L[d.i].start <= off && off <= sf.L[d.end - 1].end).sort((a, b) => b.indent - a.indent)[0] || null;

const STD = new Set(('__future__ abc argparse array ast asyncio base64 bisect builtins calendar collections concurrent contextlib contextvars copy csv dataclasses datetime decimal difflib email enum errno fnmatch fractions functools glob gzip hashlib heapq hmac html http importlib inspect io itertools json logging math operator os pathlib pickle platform pprint queue random re secrets shlex shutil signal sqlite3 statistics string struct subprocess sys tempfile textwrap threading time traceback types typing unittest urllib uuid warnings weakref zlib').split(' '));
const THIRD_OK = new Set(['langgraph', 'langchain_core', 'pydantic', 'typing_extensions', 'pytest']);
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

// ---- checks ------------------------------------------------------------------------------------------------------------------

const FULL_STATE = (sp) => new RegExp(`^(?:${sp}\\.copy\\s*\\(|dict\\s*\\(\\s*${sp}\\b|copy\\.(?:deep)?copy\\s*\\(\\s*${sp}\\b|${sp}\\.model_copy\\s*\\(|\\{\\s*\\*\\*\\s*${sp}\\b|\\w+\\s*\\(\\s*\\*\\*\\s*${sp}\\b)`);

/** Registered node functions: [{ name, fn, sf, def }] (only those whose def is found in the project). */
function nodeDefs(p, m) {
  const out = [];
  for (const [name, nd] of m.nodes) {
    const f = findDef(p.src, nd.fn || name);
    if (f) out.push({ name, fn: nd.fn || name, sf: f.sf, def: f.d });
  }
  return out;
}

/** Fields of a state class: [{ name, ann, annotated, reducer, list }] following one level of local base classes; MessagesState counts as a reduced messages list. */
function stateFields(p, className, depth = 0) {
  for (const sf of p.src) {
    const d = sf.defs.find((x) => x.kind === 'class' && x.name === className);
    if (!d) continue;
    const head = d.head.text;
    const baseTxt = (/^class\s+\w+\s*(?:\(([^)]*)\))?/.exec(head) || [])[1] || '';
    const bases = baseTxt.split(',').map((b) => b.trim().replace(/^\w+=.*/, '')).filter(Boolean);
    const decorated = d.i > 0 && /^@(?:dataclasses\.)?dataclass\b/.test(sf.L[d.i - 1].text);
    const kind = bases.some((b) => /(?:^|\.)TypedDict$/.test(b)) ? 'typeddict' : bases.some((b) => /(?:^|\.)BaseModel$/.test(b)) ? 'pydantic' : decorated ? 'dataclass' : null;
    const fields = [];
    let inherited = kind;
    for (const b of bases) {
      if (b === 'MessagesState' || /\.MessagesState$/.test(b)) { fields.push({ name: 'messages', list: true, reducer: true }); inherited = inherited || 'typeddict'; } else if (depth < 3 && /^[A-Za-z_]\w*$/.test(b) && b !== 'TypedDict' && b !== 'BaseModel') {
        const up = stateFields(p, b, depth + 1);
        if (up) { fields.push(...up.fields); inherited = inherited || up.kind; }
      }
    }
    const bodyIndent = d.end > d.i + 1 ? sf.L[d.i + 1].indent : d.indent + 4;
    for (let i = d.i + 1; i < d.end; i += 1) {
      const l = sf.L[i];
      if (l.indent !== bodyIndent) continue;
      const m = /^(\w+)\s*:\s*(.+)$/.exec(l.text);
      if (!m) continue;
      const kAnn = l.keep.slice(l.keep.indexOf(':') + 1).trim();
      const cAnn = m[2];
      let cut = cAnn.length;
      let depthB = 0;
      for (let x = 0; x < cAnn.length; x += 1) {
        const ch = cAnn[x];
        if ('([{'.includes(ch)) depthB += 1; else if (')]}'.includes(ch)) depthB -= 1; else if (ch === '=' && depthB === 0) { cut = x; break; }
      }
      const ann = { k: kAnn.slice(0, cut).trim(), c: cAnn.slice(0, cut).trim() };
      const am = /^(?:typing\.|typing_extensions\.)?Annotated\s*\[([\s\S]*)\]$/.exec(ann.c);
      let first = ann.c;
      let reducer = false;
      if (am) {
        const inner = splitTop({ k: ann.k.slice(ann.k.indexOf('[') + 1, ann.k.lastIndexOf(']')), c: am[1] });
        first = inner[0] ? inner[0].c : '';
        reducer = inner.length >= 2 && inner[1].c.trim() !== '' && !/^None$/.test(inner[1].c.trim());
      }
      fields.push({ name: m[1], list: /^(?:typing\.)?(?:list|List|Sequence|MutableSequence|deque|Deque)\b/.test(first), reducer });
    }
    return { kind: inherited, fields, sf };
  }
  return null;
}

const SIDE_EFFECT = /^(?:send|issue|refund|charge|pay|write|save|post|notify|email|mail|create|delete|remove|insert|submit|publish|dispatch|record|store|put|commit|execute|upload|transfer|cancel|capture)\w*$/i;

function bound(p, m, scc, exits) {
  const re = /(?<![-=<>!])[<>]=?(?![>=])|(?:[=!]=)/;
  const named = /max|attempt|revision|retr|round|iteration|count|tries|budget|left|remaining/i;
  const lines = [];
  for (const e of exits) {
    const f = e.router ? findDef(p.src, e.router) : null;
    if (f) lines.push(...bodyLines(f.sf, f.d));
  }
  for (const n of scc) {
    const nd = m.nodes.get(n);
    const f = nd ? findDef(p.src, nd.fn || n) : null;
    if (f) lines.push(...bodyLines(f.sf, f.d));
  }
  return lines.some((l) => /^\s*(?:if|elif|while|return|assert|\w+\s*=|.*\bif\b)/.test(l.text) && re.test(l.text.replace(/->/g, '')) && named.test(l.keep));
}

const CHECKS = {
  'files-saved': () => {
    const p = project();
    needGraphs(p);
    if (p.tests.length === 0) fail('no new test file under tests/ (test_*.py, *_test.py or *.cases.py)');
    return `graph in ${clean(p.graphs.map((g) => g.path).join(', '))}, tests in ${clean(p.tests.map((t) => t.path).join(', '))}`;
  },

  'state-schema-reducer': () => {
    const p = project();
    const m = model(p);
    const arg = m.schemaArg && m.schemaArg.arg;
    const name = arg && /^[A-Za-z_]\w*$/.test(arg.c.trim()) ? arg.c.trim() : null;
    if (!name || name === 'dict' || name === 'Dict') fail('StateGraph is not given a typed state schema class (TypedDict or Pydantic model)');
    const st = name === 'MessagesState' ? { kind: 'typeddict', fields: [{ name: 'messages', list: true, reducer: true }] } : stateFields(p, name);
    if (!st) fail(`state schema ${clean(name)} is not defined as a class under src/`);
    if (!st.kind) fail(`state schema ${clean(name)} is not a TypedDict, Pydantic model or dataclass`);
    const lists = st.fields.filter((f) => f.list);
    if (lists.length === 0) fail(`state schema ${clean(name)} has no list field for the accumulated messages`);
    const bare = lists.find((f) => !f.reducer);
    if (bare) fail(`list field "${clean(bare.name)}" of ${clean(name)} has no reducer (Annotated[list, add_messages] or operator.add): nodes would overwrite it`);
    return `${clean(name)} (${st.kind}) has reducers on ${lists.map((f) => clean(f.name)).join(', ')}`;
  },

  'nodes-partial-update': () => {
    const p = project();
    const m = model(p);
    const nodes = nodeDefs(p, m);
    if (nodes.length === 0) fail('no node function registered with add_node could be found in src/');
    for (const n of nodes) {
      const sp = paramsOf(n.def)[0];
      const lines = bodyLines(n.sf, n.def);
      for (const l of lines) {
        const r = /^return\b\s*(.*)$/.exec(l.text);
        if (!r) continue;
        const kr = l.keep.replace(/^return\b\s*/, '');
        let expr = r[1];
        if (!sp) continue;
        if (expr === sp) fail(`node ${clean(n.name)} returns its whole input state, not a partial update`);
        if (FULL_STATE(sp).test(expr)) fail(`node ${clean(n.name)} returns a copy of the full state (${clean(kr)})`);
        if (/^[A-Za-z_]\w*$/.test(expr) && expr !== 'None') {
          const assign = lines.filter((x) => new RegExp(`^${expr}\\s*(?::[^=]+)?=(?!=)\\s*`).test(x.text)).pop();
          if (assign) {
            expr = assign.text.replace(new RegExp(`^${expr}\\s*(?::[^=]+)?=\\s*`), '');
            if (expr === sp || FULL_STATE(sp).test(expr)) fail(`node ${clean(n.name)} returns a copy of the full state (${clean(assign.keep)})`);
          }
        }
      }
    }
    return `${nodes.length} nodes return partial updates`;
  },

  'nodes-no-mutation': () => {
    const p = project();
    const m = model(p);
    const nodes = nodeDefs(p, m);
    if (nodes.length === 0) fail('no node function registered with add_node could be found in src/');
    for (const n of nodes) {
      const sp = paramsOf(n.def)[0];
      if (!sp) continue;
      const lines = bodyLines(n.sf, n.def);
      const names = new Set([sp]);
      for (const l of lines) {
        const a = new RegExp(`^(\\w+)\\s*(?::[^=]+)?=(?!=)\\s*${sp}\\s*(?:\\[[^\\]]*\\]|\\.get\\s*\\([^)]*\\)|\\.\\w+)\\s*$`).exec(l.text);
        if (a) names.add(a[1]);
      }
      for (const nm of names) {
        const assign = new RegExp(`^${nm}\\s*(?:\\[[^\\]]*\\]|\\.\\w+)+\\s*(?:[-+*/%|&^@]|//|\\*\\*)?=(?!=)`);
        const aug = new RegExp(`^${nm}\\s*(?:[-+*/%|&^@]|//|\\*\\*)=(?!=)`);
        const del = new RegExp(`^del\\s+${nm}\\b`);
        const meth = new RegExp(`\\b${nm}\\s*(?:\\[[^\\]]*\\]\\s*)*\\.\\s*(?:append|extend|insert|remove|pop|popitem|clear|update|setdefault|sort|reverse|add|discard)\\s*\\(`);
        for (const l of lines) {
          if (assign.test(l.text) || aug.test(l.text) || del.test(l.text) || meth.test(l.text)) {
            fail(`node ${clean(n.name)} mutates its input state: ${clean(l.keep)}`);
          }
        }
      }
    }
    return `${nodes.length} nodes leave their input alone`;
  },

  'cycle-has-exit': () => {
    const p = project();
    const m = model(p);
    const adj = new Map();
    const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
    const cond = m.edges.filter((e) => e.cond);
    for (const e of m.edges) {
      if (!e.cond) { if (e.from && e.to) add(e.from, e.to); } else if (e.from) for (const t of e.targets) add(e.from, t);
    }
    const reach = (from) => {
      const seen = new Set();
      const stack = [...(adj.get(from) || [])];
      while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); stack.push(...(adj.get(x) || [])); }
      return seen;
    };
    const cyc = [...m.nodes.keys()].filter((n) => reach(n).has(n));
    if (cyc.length === 0) {
      const unresolved = cond.find((e) => !e.resolved);
      fail(unresolved
        ? 'no loop found in the graph, and a conditional edge could not be resolved to node names (give it a path map or a Literal return type)'
        : 'the graph has no loop: nothing sends a conditional edge back to an earlier node, so the revise-and-review step cannot repeat');
    }
    const seenScc = [];
    for (const n of cyc) {
      if (seenScc.some((s) => s.has(n))) continue;
      const scc = new Set(cyc.filter((x) => x === n || (reach(n).has(x) && reach(x).has(n))));
      seenScc.push(scc);
      const exits = cond.filter((e) => e.from && scc.has(e.from) && e.targets.some((t) => !scc.has(t)));
      if (exits.length === 0) fail(`the loop through ${clean([...scc].join(', '))} has no conditional edge that leaves it: it can never end`);
      if (!bound(p, m, scc, exits)) fail(`the loop through ${clean([...scc].join(', '))} can leave only on the reviewer's verdict: no counter or limit (a comparison such as revisions < MAX) ends it when the reviewer never approves`);
    }
    return `every loop (${seenScc.map((s) => [...s].join('>')).join('; ')}) has a bounded exit`;
  },

  'recursion-limit-set': () => {
    const p = project();
    needGraphs(p);
    const calls = invokes(p.src);
    if (calls.length === 0) fail('nothing under src/ invokes or streams the workflow');
    let found = null;
    for (const sf of p.src) {
      const consts = constsOf(sf);
      const re = /(?:["']recursion_limit["']\s*:|\brecursion_limit\s*=(?!=))\s*([\w.]+)/g;
      let mm;
      while ((mm = re.exec(sf.keep)) !== null) {
        let v = mm[1];
        if (consts[v]) v = consts[v].c.trim();
        const num = /^\d+$/.test(v) ? Number(v) : null;
        if (num !== null && (num < 1 || num > 200)) fail(`recursion_limit is ${num}: not a useful bound (use 1 to 200)`);
        found = found || { sf, at: mm.index };
        const pre = sf.keep.slice(Math.max(0, mm.index - 220), mm.index);
        if (/configurable["']?\s*[:=]\s*(?:dict\s*\(|\{)(?:[^{}]|\{[^{}]*\}){0,200}$/.test(pre)) fail('recursion_limit sits inside "configurable", where it has no effect: it belongs next to it in the config');
      }
    }
    if (!found) fail('no recursion_limit is set in the config passed when the workflow runs');
    return `recursion_limit set in ${clean(found.sf.path)}`;
  },

  'checkpointer-compiled': () => {
    const p = project();
    const m = model(p);
    if (m.compiles.length === 0) fail('the graph is never compiled with .compile()');
    for (const { call } of m.compiles) {
      const a = argOf(call, 0, 'checkpointer');
      if (!a || /^None$/.test(a.c.trim())) fail('compile() is called without a checkpointer: nothing is remembered between calls and the pause cannot be resumed');
    }
    if (!p.src.some((sf) => /\b\w*Saver\s*\(|\.from_conn_string\s*\(/.test(sf.code))) fail('no checkpoint saver (MemorySaver, SqliteSaver, ...) is created');
    return 'compiled with a checkpointer';
  },

  'thread-id-per-customer': () => {
    const p = project();
    const calls = invokes(p.src);
    if (calls.length === 0) fail('nothing under src/ invokes or streams the workflow');
    for (const c of calls) {
      if (!argOf(c, 1, 'config')) fail(`the workflow is run without a config argument (${clean(c.sf.path)}), so no thread id reaches it`);
    }
    for (const sf of p.src) {
      const m = /configurable["']?\s*[:=]\s*(?:dict\s*\(|\{)[\s\S]{0,200}?thread_id["']?\s*[:=]\s*([^,})\n]+)/.exec(sf.keep);
      if (!m) continue;
      const v = m[1].trim();
      if (/^[rbuf]{0,2}["'][^"'{]*["']$/.test(v) || /^\d+$/.test(v)) fail(`thread_id is the constant ${clean(v)}: every customer would share one conversation`);
      if (/\b(?:uuid|random|time|datetime|token_hex|token_urlsafe)\b/.test(v)) fail(`thread_id (${clean(v)}) is new on every call: a customer's later request would not continue the conversation`);
      return `thread_id from ${clean(v)}`;
    }
    return fail('no thread_id under "configurable" in the config passed to the workflow');
  },

  'approval-uses-interrupt': () => {
    const p = project();
    const m = model(p);
    for (const sf of p.src) {
      if (/(?<![\w.])input\s*\(/.test(sf.code)) fail(`${clean(sf.path)} waits for the approval with input(): a server cannot block on a terminal`);
      if (/(?<![\w])sleep\s*\(/.test(sf.code)) fail(`${clean(sf.path)} sleeps: waiting for the approval by polling instead of pausing the graph`);
    }
    const nodeFns = new Set([...m.nodes].map(([n, v]) => v.fn || n));
    const hits = [];
    for (const sf of p.src) for (const c of callsIn(sf, /(?<![\w.])(?:langgraph\.types\.)?(interrupt)\s*\(/)) hits.push({ sf, c });
    if (hits.length === 0) fail('the approval does not use interrupt(): the workflow cannot pause and be resumed');
    for (const h of hits) {
      const d = defAt(h.sf, h.c.index);
      if (!d) fail('interrupt() is called outside any function');
      const called = [...nodeFns].some((fnName) => { const f = findDef(p.src, fnName); return f && callsIn(f.sf, new RegExp(`(?<![\\w.])(${d.name})\\s*\\(`), f.sf.L[f.d.i].start, f.sf.L[f.d.end - 1].end).length > 0; });
      if (!nodeFns.has(d.name) && !called) fail(`interrupt() is called in ${clean(d.name)}, which is not a node or called by one`);
    }
    if (!p.src.some((sf) => /^from\s+langgraph\.types\s+import\b[^\n]*\binterrupt\b/m.test(sf.L.map((l) => l.text).join('\n')) || /langgraph\.types\.interrupt\s*\(/.test(sf.code))) fail('interrupt is not imported from langgraph.types');
    return 'the approval pauses the graph with interrupt()';
  },

  'resume-with-command': () => {
    const p = project();
    for (const sf of p.src) {
      for (const c of callsIn(sf, /(?<![\w.])(Command)\s*\(/)) {
        if (!argOf(c, 99, 'resume')) continue;
        if (callsIn(sf, /\.\s*(a?invoke|a?stream)\s*\(/).length === 0) continue; // the run helper may sit in another def
        if (!/^from\s+langgraph\.types\s+import\b[^\n]*\bCommand\b/m.test(sf.L.map((l) => l.text).join('\n')) && !/langgraph\.types\.Command\s*\(/.test(sf.code)) fail('Command is not imported from langgraph.types');
        return `resumed with Command(resume=...) in ${clean(sf.path)}`;
      }
    }
    return fail('nothing resumes the paused run with Command(resume=...) passed to invoke() or stream()');
  },

  'side-effects-before-interrupt': () => {
    const p = project();
    let seen = false;
    for (const sf of p.src) {
      for (const c of callsIn(sf, /(?<![\w.])(?:langgraph\.types\.)?(interrupt)\s*\(/)) {
        seen = true;
        const d = defAt(sf, c.index);
        if (!d) continue;
        for (const call of callsIn(sf, /(?:^|[^\w])((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\s*\(/, sf.L[d.i + 1] ? sf.L[d.i + 1].start : 0, c.index)) {
          const last = call.name.split('.').pop();
          if (SIDE_EFFECT.test(last)) fail(`${clean(d.name)} calls ${clean(call.name)}() before interrupt(): the node runs again on resume, so the effect would happen twice`);
        }
      }
    }
    return seen ? 'no side effect runs before the pause in the same node' : fail('no interrupt() call found, so the order of effects cannot be judged');
  },

  'model-from-config': () => {
    const p = project();
    const lit = /(["'])((?:gpt-?[\w.-]*|chatgpt[\w.-]*|o[134](?:-[\w.-]+)?|claude[\w.-]*|gemini[\w.-]*|llama[\w.-]*|mistral[\w.-]*|mixtral[\w.-]*|deepseek[\w.-]*|qwen[\w.-]*|command-[\w.-]+|text-embedding[\w.-]*))\1/i;
    const kw = /\bmodel\w*\s*(?::[^=\n]{0,40})?=(?!=)\s*(["'])([^"'\n]+)\1/i;
    for (const sf of p.src) {
      for (const l of sf.L) {
        const m = lit.exec(l.keep) || kw.exec(l.keep);
        if (m) fail(`${clean(sf.path)} hard-codes a model name: ${clean(l.keep)}`);
      }
    }
    const uses = p.src.some((sf) => !/(?:^|\/)config\.py$/.test(sf.path) && sf.L.some((l) => /\.\s*model\b|\[\s*["']model["']\s*\]|\b(?:environ|getenv)\b[^\n]{0,60}MODEL/i.test(l.keep)));
    if (!uses) fail('the model name is not taken from the config module or the environment');
    return 'the model name comes from config';
  },

  'test-nodes-direct': () => {
    const p = project();
    const m = model(p);
    const nodes = nodeDefs(p, m).filter((n) => n.def.indent === 0);
    if (nodes.length === 0) fail('no node is a module-level function, so a test cannot call one on its own');
    const names = [...new Set(nodes.map((n) => n.fn))];
    for (const t of p.tests) {
      for (const c of cases(t)) {
        const calls = names.find((n) => new RegExp(`(?<![\\w])(?:\\w+\\.)?${n}\\s*\\(`).test(c.body));
        if (!calls) continue;
        if (/\.\s*compile\s*\(|\bbuild_\w*\s*\(|\b(?:run|resume)_\w*\s*\(|\.\s*(?:a?invoke|a?stream)\s*\(/.test(c.body)) continue;
        if (!ASSERTS.test(c.body)) continue;
        return `${clean(t.path)}: ${clean(c.name)} calls ${clean(calls)}() directly and asserts on the result`;
      }
    }
    return fail('no test calls a node function directly (without building or running the graph) and asserts on what it returns');
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

  'no-new-dependency': (o) => {
    const fx = need(o, 'fixture');
    const p = project();
    const local = new Set(['src', 'tests', 'conftest']);
    for (const sf of [...p.src, ...p.tests]) local.add(sf.path.split('/').pop().replace(/\.py$/, ''));
    for (const sf of walk(fx).filter((f) => /\.py$/.test(f))) local.add(sf.split('/').pop().replace(/\.py$/, ''));
    for (const sf of [...p.src, ...p.tests]) {
      for (const mod of importsOf(sf)) {
        if (STD.has(mod) || THIRD_OK.has(mod) || local.has(mod)) continue;
        fail(`${clean(sf.path)} imports ${clean(mod)}, which is not installed by the project (standard library, langgraph, langchain_core, pydantic, pytest only)`);
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
module.exports = { CHECKS, scan, logicalLines, splitTop, callArgs, defsOf, importsOf, constsOf, nodeName };
