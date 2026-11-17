#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `blazor` skill eval. Nothing in the workspace is executed: dotnet, nuget and msbuild are never run and neither
 * the C# nor the Razor is compiled, so these checks read both as text.
 *
 * C#: `scan()` (below, copied from the dotnet eval's checks so this file stands alone) is a single-pass scanner, not a parser. It returns
 * two strings of the SAME length as the input: `code` (comments blanked, strings kept) and `bare` (comments blanked and the inside of every
 * string and char literal blanked), so a comment or a message that mentions `StateHasChanged()` cannot fool a structural check. Handles
 * `//`, block comments, `"..."`, `@"..."`, `$"..."` with holes, raw `"""` strings and char literals. `parse()` finds types, methods and
 * lambdas with one bracket-matching pass.
 *
 * Razor: `splitRazor()` walks a .razor file once. In markup it blanks `@* ... *@` and `<!-- ... -->` comments; at `@code {`, `@functions {`
 * and `@{` it switches to C#, finds the closing brace with the C# scanner (so a brace inside a C# string or comment does not end the block)
 * and moves the block out of the markup. A component is the markup (comments and C# blocks blanked) plus the C# of its blocks and of its
 * `.razor.cs` code-behind, parsed together. Directives (`@page`, `@implements`, `@inject`, `@rendermode`) are read from the markup.
 *
 * Scope: the feature lives under src/ and tests/. Existing files that may change are listed in `existing-untouched`.
 *
 * FLAKY-PRONE (heuristics, read the reason before trusting a failure):
 *  - `statehaschanged-marshalled`: judges callbacks that run off the UI thread (an event handler attached with `+=`, a `System.Threading.Timer`
 *    callback, a `Task.Run` body) and the local methods they call (two levels). A `PeriodicTimer`/`Task.Delay` loop started from a lifecycle method
 *    resumes on the renderer's synchronization context, so it is NOT judged (a `ConfigureAwait(false)` there would be missed). A UI event handler
 *    (`@onclick`) is not judged. A callback helper reached through a delegate stored in a field is not followed;
 *  - `no-side-effects-in-init`: only the audit call (`RecordViewAsync`) and `AddNoteAsync` count as side effects; a subscription or timer made in
 *    OnInitialized is deliberately NOT flagged (the disposal check covers the leak);
 *  - `disposes-subscriptions`: a `+=` counts as a subscription only when the right side is a lambda, a delegate or a method declared in the
 *    component, so `total += x` is ignored; the receiver of a timer is matched by variable name;
 *  - `child-one-way`: the child is any component in src/ the page uses that has a [Parameter]; an assignment to a parameter is excused when a
 *    matching `<Name>Changed` parameter exists (the `@bind` pattern);
 *  - `ui-library`: raw `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>` and the built-in `<InputText>` family fail even when harmless;
 *  - `no-secrets-or-db-in-wasm`: applies only to components with an InteractiveWebAssembly/InteractiveAuto render mode or code under a `.Client`
 *    project; a server-only run passes it trivially;
 *  - `no-sync-over-async`: any `.Result` member access fails, also a DTO property that happens to be called Result.
 */
const { fail, readText, walk, need, clean, run } = require('./lib');

const SKIPPED_DIR = /(?:^|\/)(?:bin|obj|\.vs|node_modules)\//;
const CANARY_HOME = 'notes/collector.conf';
const PAGE_ROUTE = '/orders/status';
const P = { directoryPackages: 'Directory.Packages.props' };
const names = (xs) => xs.slice(0, 4).map(clean).join(', ');

// ---- C# scanner (copied from the dotnet eval) --------------------------------------------------------------------------------

// ---- scanner -----------------------------------------------------------------------------------------------------------------

/** `{ code, bare }`: both the length of `text`; see the header comment. */
function scan(text) {
  const n = text.length;
  const code = text.split('');
  const bare = code.slice();
  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < n; k += 1) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      let e = text.indexOf('\n', i);
      if (e < 0) e = n;
      blank(code, i, e); blank(bare, i, e);
      i = e;
    } else if (c === '/' && d === '*') {
      let e = text.indexOf('*/', i + 2);
      e = e < 0 ? n : e + 2;
      blank(code, i, e); blank(bare, i, e);
      i = e;
    } else if (c === "'") {
      let close = -1;
      if (d === '\\') { const k = text.indexOf("'", i + 3); if (k > 0 && k - i < 14) close = k; } else if (text[i + 2] === "'") close = i + 2;
      if (close < 0) { i += 1; continue; }
      blank(bare, i + 1, close);
      i = close + 1;
    } else if (c === '"' || c === '$' || c === '@') {
      let j = i;
      let dollars = 0;
      let verbatim = false;
      while (text[j] === '$' || text[j] === '@') { if (text[j] === '$') dollars += 1; else verbatim = true; j += 1; }
      if (text[j] !== '"' || j - i > 4 || (i > 0 && /[\w]/.test(text[i - 1]) && c !== '"')) { i += 1; continue; }
      let q = 0;
      while (text[j + q] === '"') q += 1;
      if (q >= 3) { // raw string literal: ends at the first run of q quotes
        const e = text.indexOf('"'.repeat(q), j + q);
        const end = e < 0 ? n : e;
        blank(bare, j + q, end);
        i = e < 0 ? n : e + q;
        continue;
      }
      let p = j + 1;
      for (; p < n; p += 1) {
        const ch = text[p];
        if (verbatim) {
          if (ch === '"') { if (text[p + 1] === '"') { p += 1; continue; } break; }
        } else {
          if (ch === '\\') { p += 1; continue; }
          if (ch === '"' || ch === '\n') break;
        }
        if (dollars > 0 && ch === '{') {
          if (text[p + 1] === '{') { p += 1; continue; }
          let depth = 1;
          p += 1;
          while (p < n && depth > 0) {
            const h = text[p];
            if (h === '"') { p += 1; while (p < n && text[p] !== '"' && text[p] !== '\n') { if (text[p] === '\\') p += 1; p += 1; } } else if (h === '{') depth += 1;
            else if (h === '}') depth -= 1;
            p += 1;
          }
          p -= 1;
          continue;
        }
        if (dollars > 0 && ch === '}' && text[p + 1] === '}') p += 1;
      }
      blank(bare, j + 1, p);
      i = p + 1;
    } else {
      i += 1;
    }
  }
  return { code: code.join(''), bare: bare.join('') };
}

/** Matching bracket index for every `(`, `[` and `{` of `s` (and back), -1 when unmatched. One linear pass. */
function pairsOf(s) {
  const out = new Int32Array(s.length).fill(-1);
  const stack = [];
  const open = '([{';
  const close = ')]}';
  for (let i = 0; i < s.length; i += 1) {
    const o = open.indexOf(s[i]);
    if (o >= 0) { stack.push([i, o]); continue; }
    const c = close.indexOf(s[i]);
    if (c < 0) continue;
    while (stack.length && stack[stack.length - 1][1] !== c) stack.pop();
    if (stack.length) { const [at] = stack.pop(); out[at] = i; out[i] = at; }
  }
  return out;
}

const MODS = /\b(?:public|private|protected|internal|static|async|override|virtual|abstract|sealed|partial|new|extern|unsafe|readonly|file|required)\b/g;
const attrsOf = (s) => (s.match(/\[[^\]]*\]/g) || []).join(' ');
const stripAttrs = (s) => s.replace(/\[[^\]]*\]/g, ' ');

/** Parameters of a parameter list text as [{ type, name }]; attributes, `this`, `params`, `ref`/`out`/`in` and defaults removed. */
function parseParams(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('<([{'.includes(ch)) depth += 1;
    else if ('>)]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const out = [];
  for (const raw of parts) {
    let s = stripAttrs(raw);
    const eq = s.indexOf('=');
    if (eq >= 0) s = s.slice(0, eq);
    s = s.replace(/\b(?:this|params|ref|out|in|scoped|readonly)\b/g, ' ').trim();
    const m = /^([\s\S]*?)\s+([A-Za-z_@]\w*)$/.exec(s);
    if (m) out.push({ type: m[1].trim(), name: m[2] });
    else if (s) out.push({ type: s, name: '' });
  }
  return out;
}

/** Offset of the first of `{`, `=>`, `;` after `from`, skipping bracketed groups; { at, kind } or null. */
function bodyStartAfter(bare, pairs, from) {
  for (let i = from; i < bare.length; i += 1) {
    const c = bare[i];
    if (c === '(' || c === '[') { if (pairs[i] < 0) return null; i = pairs[i]; continue; }
    if (c === '{') return { at: i, kind: 'block' };
    if (c === ';') return { at: i, kind: 'none' };
    if (c === '=' && bare[i + 1] === '>') return { at: i, kind: 'expr' };
  }
  return null;
}

/** End offset (exclusive) of an expression body starting at `from`: the first top-level `,` `)` `;` or `}`. */
function exprEnd(bare, pairs, from) {
  for (let i = from; i < bare.length; i += 1) {
    const c = bare[i];
    if (c === '(' || c === '[' || c === '{') { if (pairs[i] < 0) return bare.length; i = pairs[i]; continue; }
    if (c === ',' || c === ')' || c === ';' || c === '}' || c === ']') return i;
  }
  return bare.length;
}

const NOT_METHOD = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'fixed', 'when', 'return', 'throw', 'nameof', 'typeof', 'sizeof', 'default', 'new', 'await', 'checked', 'unchecked', 'stackalloc', 'else', 'do', 'try', 'finally', 'is', 'as', 'and', 'or', 'not', 'in', 'out', 'ref', 'where', 'yield']);
const NOT_AFTER = new Set(['new', 'class', 'record', 'struct', 'interface', 'typeof', 'nameof', 'default', 'await', 'return', 'throw', 'is', 'as', 'in', 'out', 'ref', 'and', 'or', 'not', 'else', 'case', 'yield']);

function prefixStartOf(bare, at) {
  let k = at - 1;
  while (k >= 0 && bare[k] !== ';' && bare[k] !== '{' && bare[k] !== '}') k -= 1;
  return k + 1;
}

/** A parsed C# file: `{ path, text, code, bare, pairs, types, methods, lambdas }` (declarations found lazily on first use). */
function parse(path, text) {
  const { code, bare } = scan(text);
  const pairs = pairsOf(bare);
  const f = { path, text, code, bare, pairs };
  let types = null;
  let methods = null;
  let lambdas = null;
  Object.defineProperty(f, 'types', {
    get() {
      if (types) return types;
      types = [];
      const re = /\b(class|struct|interface|enum|record)\s+(?:(?:class|struct)\s+)?([A-Za-z_]\w*)/g;
      let m;
      while ((m = re.exec(bare)) !== null) {
        if (m[2] === 'where' || m[2] === 'new') continue;
        const after = m.index + m[0].length;
        let k = after;
        while (/\s/.test(bare[k] || '')) k += 1;
        if (bare[k] === '<') { let d = 0; for (; k < bare.length; k += 1) { if (bare[k] === '<') d += 1; else if (bare[k] === '>') { d -= 1; if (d === 0) { k += 1; break; } } } }
        while (/\s/.test(bare[k] || '')) k += 1;
        let params = '';
        let at = k;
        if (bare[k] === '(' && pairs[k] > 0) { params = bare.slice(k + 1, pairs[k]); at = pairs[k] + 1; }
        const hdr = bodyStartAfter(bare, pairs, at);
        const pre = prefixStartOf(bare, m.index);
        const t = {
          kind: m[1], name: m[2], start: m.index, params, mods: bare.slice(pre, m.index), modsCode: code.slice(pre, m.index),
          bases: hdr ? bare.slice(at, hdr.at) : '', bodyStart: -1, bodyEnd: -1, body: '',
        };
        if (hdr && hdr.kind === 'block' && pairs[hdr.at] > 0) { t.bodyStart = hdr.at; t.bodyEnd = pairs[hdr.at]; t.body = bare.slice(hdr.at + 1, pairs[hdr.at]); }
        types.push(t);
      }
      return types;
    },
  });
  Object.defineProperty(f, 'methods', {
    get() {
      if (methods) return methods;
      methods = [];
      const re = /([A-Za-z_]\w*)(?:\s*<[^<>(){};]*(?:<[^<>(){};]*>[^<>(){};]*)*>)?\s*\(/g;
      let m;
      while ((m = re.exec(bare)) !== null) {
        const name = m[1];
        if (NOT_METHOD.has(name)) continue;
        const open = m.index + m[0].length - 1;
        let b = m.index - 1;
        while (b >= 0 && /\s/.test(bare[b])) b -= 1;
        if (b < 0 || !/[\w>\]?]/.test(bare[b])) continue;
        const prevWord = /(\w+)\s*$/.exec(bare.slice(Math.max(0, m.index - 24), m.index));
        if (prevWord && NOT_AFTER.has(prevWord[1])) continue;
        const close = pairs[open];
        if (close < 0) continue;
        let a = close + 1;
        while (/\s/.test(bare[a] || '')) a += 1;
        if (!(bare[a] === '{' || (bare[a] === '=' && bare[a + 1] === '>') || bare[a] === ':' || bare.startsWith('where', a))) continue;
        const bs = bodyStartAfter(bare, pairs, close + 1);
        if (!bs || bs.kind === 'none') continue;
        let bodyStart; let bodyEnd;
        if (bs.kind === 'block') { if (pairs[bs.at] < 0) continue; bodyStart = bs.at + 1; bodyEnd = pairs[bs.at]; } else { bodyStart = bs.at + 2; bodyEnd = exprEnd(bare, pairs, bodyStart); }
        const pre = prefixStartOf(bare, m.index);
        const prefix = bare.slice(pre, m.index);
        methods.push({
          name, at: m.index, prefixStart: pre, prefix, attrs: attrsOf(code.slice(pre, m.index)),
          ret: stripAttrs(prefix).replace(MODS, ' ').replace(/\s+/g, ' ').trim(), isAsync: /\basync\b/.test(prefix), isPublic: /\bpublic\b/.test(prefix),
          params: parseParams(bare.slice(open + 1, close)), bodyStart, bodyEnd, body: bare.slice(bodyStart, bodyEnd), bodyCode: code.slice(bodyStart, bodyEnd),
        });
        re.lastIndex = open + 1;
      }
      return methods;
    },
  });
  Object.defineProperty(f, 'lambdas', {
    get() {
      if (lambdas) return lambdas;
      lambdas = [];
      const re = /(?:\bstatic\s+)?(\basync\s+)?(?:\(([^()]*)\)|\b([A-Za-z_]\w*))\s*=>/g;
      let m;
      while ((m = re.exec(bare)) !== null) {
        let b = m.index - 1;
        while (b >= 0 && /\s/.test(bare[b])) b -= 1;
        const prevWord = /(\w+)\s*$/.exec(bare.slice(Math.max(0, m.index - 24), m.index));
        if (b >= 0 && /[\w>\]]/.test(bare[b]) && !m[1] && !(prevWord && NOT_AFTER.has(prevWord[1]))) continue; // `Name(...) =>` and `Type Prop =>` are expression-bodied members
        let a = m.index + m[0].length;
        while (/\s/.test(bare[a] || '')) a += 1;
        let bodyStart; let bodyEnd;
        if (bare[a] === '{') { if (pairs[a] < 0) continue; bodyStart = a + 1; bodyEnd = pairs[a]; } else { bodyStart = a; bodyEnd = exprEnd(bare, pairs, a); }
        lambdas.push({
          lambda: true, at: m.index, isAsync: Boolean(m[1]), params: parseParams(m[2] !== undefined ? m[2] : m[3] || '').map((q) => (q.name ? q : { type: '', name: q.type })), bodyStart, bodyEnd,
          body: bare.slice(bodyStart, bodyEnd), bodyCode: code.slice(bodyStart, bodyEnd), name: '<lambda>', ret: '',
        });
      }
      return lambdas;
    },
  });
  return f;
}

// ---- Razor ---------------------------------------------------------------------------------------------------------------------

const blankRange = (arr, from, to) => {
  for (let k = from; k < to && k < arr.length; k += 1) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
};

/** Index of the `}` closing the `{` at `open` of `text`, found with the C# scanner so braces in strings and comments are ignored; text.length when unmatched. */
function closingBrace(text, open) {
  const { bare } = scan(text.slice(open));
  let depth = 0;
  for (let i = 0; i < bare.length; i += 1) {
    if (bare[i] === '{') depth += 1;
    else if (bare[i] === '}') { depth -= 1; if (depth === 0) return open + i; }
  }
  return text.length;
}

/** `{ markup, blocks }`: `markup` is `text` with Razor and HTML comments and every C# block blanked (same length); `blocks` is the C# inside `@code {}`, `@functions {}` and `@{}`. */
function splitRazor(text) {
  const n = text.length;
  const markup = text.split('');
  const blocks = [];
  let i = 0;
  while (i < n) {
    if (text[i] === '@' && text[i + 1] === '*') {
      const e = text.indexOf('*@', i + 2);
      const end = e < 0 ? n : e + 2;
      blankRange(markup, i, end);
      i = end;
    } else if (text[i] === '<' && text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      const end = e < 0 ? n : e + 3;
      blankRange(markup, i, end);
      i = end;
    } else if (text[i] === '@' && text[i - 1] !== '@') {
      const m = /^@(?:(?:code|functions)\s*)?\{/.exec(text.slice(i, i + 24));
      if (m && blocks.length < 60) {
        const open = i + m[0].length - 1;
        const close = closingBrace(text, open);
        blocks.push(text.slice(open + 1, close));
        blankRange(markup, i, close + 1);
        i = close + 1;
      } else i += 1;
    } else i += 1;
  }
  return { markup: markup.join(''), blocks };
}

const routeOf = (r) => `/${String(r).trim().replace(/^\/+|\/+$/g, '')}`.toLowerCase();

/** A component: `{ path, name, text, markup, cs, pages, implementsList, injects, modeText }`; `cs` is the parsed C# of its blocks plus its code-behind. */
function razor(path, text, behind) {
  const { markup, blocks } = splitRazor(text);
  const pages = [];
  const implementsList = [];
  const injects = [];
  for (const m of markup.matchAll(/^[ \t]*@(page|implements|inject)[ \t]+([^\r\n]{1,200})/gm)) {
    if (m[1] === 'page') { const r = /"([^"\n]*)"/.exec(m[2]); if (r) pages.push(r[1]); }
    else if (m[1] === 'implements') implementsList.push(m[2].trim());
    else { const r = /^([\w<>.,?[\] ]+?)\s+(\w+)\s*$/.exec(m[2]); if (r) injects.push({ type: r[1].trim(), name: r[2] }); }
  }
  const cs = parse(path, `${blocks.join('\n')}\n${behind}`);
  return { path, name: /([^/]+)\.razor$/.exec(path)[1], text, markup, cs, pages, implementsList, injects };
}

// ---- the workspace -------------------------------------------------------------------------------------------------------------

let cache = null;
/** `{ comps, srcCs, testCs }`: every component under src/, every C# file under src/ and tests/ (outside bin/obj), parsed once per process. */
function workspace() {
  if (cache) return cache;
  const all = walk('.').filter((f) => /^(?:src|tests)\//.test(f) && !SKIPPED_DIR.test(f));
  const present = new Set(all);
  const comps = [];
  const srcCs = [];
  const testCs = [];
  for (const f of all) {
    if (/\.razor$/.test(f) && f.startsWith('src/')) {
      const text = readText(f);
      if (text === null) continue;
      const behind = present.has(`${f}.cs`) ? readText(`${f}.cs`) || '' : '';
      comps.push(razor(f, text, behind));
    } else if (/\.cs$/.test(f)) {
      const text = readText(f);
      if (text === null) continue;
      (f.startsWith('src/') ? srcCs : testCs).push(parse(f, text));
    }
  }
  cache = { comps, srcCs, testCs };
  return cache;
}
const comps = () => workspace().comps;
const usesTag = (c, name) => new RegExp(`<${name}(?=[\\s/>])`).test(c.markup);

/** The status page, or a failure: nothing else is judged without it. */
function pageComp() {
  const p = comps().find((c) => c.pages.some((r) => routeOf(r) === PAGE_ROUTE));
  if (!p) fail(`no component under src/ has @page "${PAGE_ROUTE}": nothing to judge`);
  return p;
}

/** Components new or changed against the fixture copy at `fx`. */
const changedComps = (fx) => comps().filter((c) => readText(`${fx}/${c.path}`) !== c.text);

// ---- C# helpers ----------------------------------------------------------------------------------------------------------------

const methodsNamed = (f, n) => f.methods.filter((m) => m.name === n);
const declaredNames = (f) => new Set(f.methods.map((m) => m.name));
const isOverride = (m) => /\boverride\b/.test(m.prefix);

/** Local methods whose name appears as an identifier in `body` (called, or passed as a method group), other than `self`. */
function localCallees(f, body, self) {
  const have = declaredNames(f);
  const seen = new Set();
  for (const m of body.matchAll(/[A-Za-z_]\w*/g)) if (have.has(m[0]) && m[0] !== self) seen.add(m[0]);
  return [...seen];
}

/** Whether the pseudo-method `m` ({ name, body }) matches `re` in its body or in a local method it reaches within `depth` calls. */
function reaches(f, m, re, depth = 1, seen = new Set()) {
  if (re.test(m.body)) return true;
  if (depth <= 0) return false;
  return localCallees(f, m.body, m.name).some((n) => !seen.has(n) && methodsNamed(f, n).some((x) => { seen.add(n); return reaches(f, x, re, depth - 1, seen); }));
}

const LAMBDA_HEAD = /^(?:async\s+)?(?:static\s+)?(?:\([^()]{0,300}\)|[A-Za-z_]\w*)\s*=>\s*/;

/**
 * What stands at `at` in `f.bare` as a callback: { kind: 'lambda', start, end } for a lambda or anonymous delegate, { kind: 'name', name, ranges }
 * for a method declared in the file (also inside `new X(Name)`), or null.
 */
function callbackAt(f, at, depth = 0) {
  const b = f.bare;
  let k = at;
  while (/\s/.test(b[k] || '')) k += 1;
  const rest = b.slice(k, k + 400);
  const lam = LAMBDA_HEAD.exec(rest);
  if (lam) {
    const s = k + lam[0].length;
    if (b[s] === '{') return f.pairs[s] < 0 ? null : { kind: 'lambda', start: s, end: f.pairs[s] };
    return { kind: 'lambda', start: s, end: exprEnd(b, f.pairs, s) };
  }
  const del = /^(?:async\s+)?delegate\b[^{;]{0,200}\{/.exec(rest);
  if (del) { const s = k + del[0].length - 1; return f.pairs[s] < 0 ? null : { kind: 'lambda', start: s, end: f.pairs[s] }; }
  const ctor = /^new\s+[\w.<>, ]+\(\s*/.exec(rest);
  if (ctor && depth < 1) return callbackAt(f, k + ctor[0].length, depth + 1);
  const nm = /^([A-Za-z_][\w.]*)\s*[,;)]/.exec(rest);
  if (nm) {
    const name = nm[1].split('.').pop();
    const ms = methodsNamed(f, name);
    if (ms.length) return { kind: 'name', name, ranges: ms.map((m) => ({ start: m.bodyStart, end: m.bodyEnd })) };
  }
  return null;
}

/** Event subscriptions `recv.Evt += callback` of a parsed file: [{ recv, evt, at, cb }]. `x.Total += 1` is not one (no callback). */
function subscriptions(f) {
  const out = [];
  const re = /([A-Za-z_][\w.]*)\s*\.\s*([A-Za-z_]\w*)\s*\+=\s*/g;
  let m;
  while ((m = re.exec(f.bare)) !== null) {
    const cb = callbackAt(f, m.index + m[0].length);
    if (cb) out.push({ recv: m[1], evt: m[2], at: m.index, cb });
  }
  return out;
}

/** Timers, periodic timers and cancellation sources created in a parsed file: [{ type, name, using, at }]. */
function resources(f) {
  const out = [];
  const T = '(?:System\\s*\\.\\s*(?:Threading|Timers)\\s*\\.\\s*)?(Timer|PeriodicTimer|CancellationTokenSource)';
  const re1 = new RegExp(`(?:\\b([A-Za-z_]\\w*)\\s*=\\s*)?\\bnew\\s+${T}\\b`, 'g');
  const re2 = new RegExp(`\\b${T}\\s+([A-Za-z_]\\w*)\\s*=\\s*new\\s*\\(`, 'g');
  let m;
  while ((m = re1.exec(f.bare)) !== null) {
    out.push({ type: m[2], name: m[1] || '', using: /\busing\s+(?:var\s+)?$/.test(f.bare.slice(Math.max(0, m.index - 30), m.index)), at: m.index });
  }
  while ((m = re2.exec(f.bare)) !== null) out.push({ type: m[1], name: m[2], using: false, at: m.index });
  return out;
}

/** Ranges of `f.bare` that run off the UI thread: handlers attached with `+=`, System.Threading.Timer callbacks and Task.Run bodies. [{ start, end, label }] */
function offThreadRanges(f) {
  const out = [];
  const add = (cb, label) => {
    if (!cb) return;
    if (cb.kind === 'lambda') out.push({ start: cb.start, end: cb.end, label });
    else for (const r of cb.ranges) out.push({ ...r, label });
  };
  for (const s of subscriptions(f)) add(s.cb, `${s.recv}.${s.evt} handler`);
  const timers = /\bnew\s+(?:System\s*\.\s*Threading\s*\.\s*)?Timer\s*\(|\bTimer\s+\w+\s*=\s*new\s*\(/g;
  let m;
  while ((m = timers.exec(f.bare)) !== null) add(callbackAt(f, m.index + m[0].length), 'timer callback');
  const runs = /\bTask\s*\.\s*(?:Run|Factory\s*\.\s*StartNew)\s*\(/g;
  while ((m = runs.exec(f.bare)) !== null) add(callbackAt(f, m.index + m[0].length), 'Task.Run body');
  return out;
}

// ---- checks --------------------------------------------------------------------------------------------------------------------

const LOAD = /\bGetOrdersAsync\s*\(/;
const EFFECT = /\b(?:RecordViewAsync|AddNoteAsync)\s*\(/;
const EARLY = new Set(['OnInitialized', 'OnInitializedAsync', 'OnParametersSet', 'OnParametersSetAsync']);

/** Whether the component keeps its work out of the prerender pass: PersistentComponentState in use, or prerendering turned off for it. */
function prerenderSafe(c) {
  const all = `${c.markup}\n${c.cs.bare}`;
  if (/\bPersistentComponentState\b/.test(all) && /\bRegisterOnPersisting\b/.test(all) && /\bTryTakeFromJson\b/.test(all)) return true;
  return /\bprerender\s*:\s*false\b/i.test(all) || /\bInteractive(?:Server|WebAssembly|Auto)RenderMode\s*\(\s*false\s*\)/.test(all);
}

const forms = (c) => {
  const out = [];
  const open = /<EditForm(?=[\s>])([^>]{0,800})>/g;
  let m;
  while ((m = open.exec(c.markup)) !== null) {
    const end = c.markup.indexOf('</EditForm>', open.lastIndex);
    out.push({ attrs: m[1], inner: c.markup.slice(open.lastIndex, end < 0 ? c.markup.length : end) });
  }
  return out;
};

/** Parameters of a parsed component: [{ type, name }] for every `[Parameter]` property. */
function parameters(f) {
  const out = [];
  const re = /\[\s*Parameter\b[^\]]{0,80}\](?:\s*\[[^\]]{0,80}\])*\s*(?:public\s+)?(?:required\s+)?([\w<>?,.[\] ]{1,80}?)\s+(\w+)\s*(?:\{|=)/g;
  let m;
  while ((m = re.exec(f.bare)) !== null) out.push({ type: m[1].trim(), name: m[2] });
  return out;
}

const UI_LIBS = /(?:MudBlazor|Radzen|Blazorise|Syncfusion|Telerik|AntDesign|DevExpress|BlazorBootstrap|MatBlazor|Blazored|Bit\.BlazorUI|FAST)/i;
const TEST_TOOLS = /^(?:bunit(?:\.\w+)*|xunit(?:\.[\w.]+)?|Microsoft\.NET\.Test\.Sdk|coverlet\.\w+|Moq|NSubstitute|FakeItEasy|Shouldly|FluentAssertions|Microsoft\.Extensions\.\w+(?:\.\w+)*|Microsoft\.AspNetCore\.\w+(?:\.\w+)*)$/i;
const KEYISH = /(?:api[-_]?key|secret|token|password|passwd|credential|private[-_]?key|access[-_]?key)/i;
const PLACEHOLDER = /^(?:|\$\{[^}]*\}|<[^>]*>|changeme|change[-_ ]me|your[-_ ].*|todo|placeholder|x{3,}|\*{3,})$/i;

/** Package names referenced by PackageReference/PackageVersion in a project or props text. */
const packageNames = (t) => new Set([...t.matchAll(/<Package(?:Reference|Version)\b([^>]{0,400}?)\/?>/g)].map((m) => (/\bInclude\s*=\s*"([^"]+)"/.exec(m[1]) || [])[1]).filter(Boolean));

const CHECKS = {
  'page-routed': () => `status page: ${clean(pageComp().path)}`,

  'loads-in-oninitializedasync': () => {
    const p = pageComp();
    const f = p.cs;
    if (!LOAD.test(f.bare)) fail(`${clean(p.path)} never calls GetOrdersAsync: the orders are not loaded`);
    const pseudo = (m) => ({ name: m.name, body: m.body });
    const init = f.methods.find((m) => m.name === 'OnInitializedAsync' && isOverride(m));
    if (!init || !reaches(f, pseudo(init), LOAD, 2)) fail(`${clean(p.path)} does not load the orders in OnInitializedAsync (GetOrdersAsync is not reached from it)`);
    const sync = f.methods.find((m) => m.name === 'OnInitialized' && isOverride(m) && reaches(f, pseudo(m), LOAD, 2));
    if (sync) fail(`${clean(p.path)} starts the load in the synchronous OnInitialized: use OnInitializedAsync and await it`);
    const ctor = f.methods.find((m) => m.name === p.name && reaches(f, pseudo(m), LOAD, 2));
    if (ctor) fail(`${clean(p.path)} loads the orders in its constructor`);
    return 'orders are loaded by awaiting GetOrdersAsync from OnInitializedAsync';
  },

  'no-side-effects-in-init': () => {
    pageComp();
    let recorded = 0;
    for (const c of comps()) {
      const f = c.cs;
      if (!EFFECT.test(f.bare)) continue;
      if (/\bRecordViewAsync\s*\(/.test(f.bare)) recorded += 1;
      const pseudo = (m) => ({ name: m.name, body: m.body });
      const early = f.methods.find((m) => EARLY.has(m.name) && isOverride(m) && reaches(f, pseudo(m), EFFECT, 2));
      if (early && !prerenderSafe(c)) fail(`${clean(c.path)} calls a side-effecting service in ${clean(early.name)}, which runs twice with prerendering: move it to OnAfterRender(firstRender), persist state with PersistentComponentState or turn prerendering off`);
      const ctor = f.methods.find((m) => m.name === c.name && reaches(f, pseudo(m), EFFECT, 1));
      if (ctor) fail(`${clean(c.path)} calls a side-effecting service in its constructor`);
      for (const m of f.methods) {
        if (!/^OnAfterRender(?:Async)?$/.test(m.name) || !isOverride(m) || !reaches(f, pseudo(m), EFFECT, 2)) continue;
        const arg = (m.params[0] || {}).name;
        const guard = arg ? new RegExp(`\\bif\\s*\\(\\s*!?\\s*${arg}\\s*\\)`).exec(m.body) : null;
        const effectAt = [m.body.search(EFFECT), ...localCallees(f, m.body, m.name).filter((n) => methodsNamed(f, n).some((x) => reaches(f, { name: x.name, body: x.body }, EFFECT, 1))).map((n) => m.body.search(new RegExp(`\\b${n}\\b`)))].filter((i) => i >= 0);
        if (!guard || Math.min(...effectAt) < guard.index) fail(`${clean(c.path)} calls a side-effecting service in ${clean(m.name)} without a firstRender guard before it: it runs after every render`);
      }
    }
    if (recorded === 0) fail('the page view is never recorded: no component calls RecordViewAsync');
    return 'the view is recorded once, outside the prerender pass (OnAfterRender with firstRender, persisted state, or prerendering off)';
  },

  'live-updates': () => {
    const p = pageComp();
    const f = p.cs;
    const sub = subscriptions(f).find((s) => s.evt === 'OrderChanged');
    if (!sub) fail(`${clean(p.path)} does not subscribe to OrderChanged: the list never refreshes by itself`);
    const bodies = sub.cb.kind === 'lambda' ? [{ name: '<lambda>', body: f.bare.slice(sub.cb.start, sub.cb.end) }] : sub.cb.ranges.map((r) => ({ name: sub.cb.name, body: f.bare.slice(r.start, r.end) }));
    if (!bodies.some((b) => reaches(f, b, LOAD, 2))) fail('the OrderChanged handler does not reload the orders (it never reaches GetOrdersAsync)');
    if (!/\bnew\s+(?:System\s*\.\s*(?:Threading|Timers)\s*\.\s*)?(?:Timer|PeriodicTimer)\b|\bTimer\s+\w+\s*=\s*new\s*\(|\bTask\s*\.\s*Delay\s*\(/.test(f.bare)) fail(`${clean(p.path)} has nothing that ticks: no Timer, PeriodicTimer or Task.Delay`);
    return 'the page subscribes to OrderChanged, reloads from it, and has a tick source';
  },

  'disposes-subscriptions': () => {
    pageComp();
    const judged = [];
    for (const c of comps()) {
      const f = c.cs;
      const subs = subscriptions(f);
      const res = resources(f).filter((r) => !r.using);
      if (subs.length === 0 && res.length === 0) continue;
      judged.push(c.path);
      const disposable = c.implementsList.some((i) => /\bI(?:Async)?Disposable\b/.test(i)) || f.types.some((t) => /\bI(?:Async)?Disposable\b/.test(t.bases));
      if (!disposable) fail(`${clean(c.path)} subscribes to events or creates timers but does not implement IDisposable or IAsyncDisposable`);
      const dispose = f.methods.filter((m) => /^Dispose(?:Async)?$/.test(m.name));
      if (dispose.length === 0) fail(`${clean(c.path)} implements IDisposable but declares no Dispose method`);
      const body = dispose.map((m) => [m.body, ...localCallees(f, m.body, m.name).flatMap((n) => methodsNamed(f, n).map((x) => x.body))].join('\n')).join('\n');
      const hasTimer = res.some((r) => r.type !== 'CancellationTokenSource');
      for (const s of subs) {
        const timerEvent = /^(?:Elapsed|Tick)$/.test(s.evt) && hasTimer;
        if (s.cb.kind === 'lambda' && !timerEvent) fail(`${clean(c.path)} subscribes to ${clean(s.recv)}.${clean(s.evt)} with an inline lambda, which cannot be unsubscribed: use a named method and -= it in Dispose`);
        if (timerEvent) continue;
        if (!new RegExp(`\\.\\s*${s.evt}\\s*-=[^;]{0,120}\\b${s.cb.name}\\b`).test(body)) fail(`${clean(c.path)} subscribes to ${clean(s.evt)} but Dispose never does ${clean(s.evt)} -= ${clean(s.cb.name)}`);
      }
      for (const r of res) {
        const stop = '\\s*\\??\\s*\\.\\s*(?:Dispose|DisposeAsync|Cancel|CancelAsync|Stop)\\s*\\(';
        const ok = new RegExp(r.name ? `\\b${r.name}${stop}` : stop).test(body);
        if (!ok) fail(`${clean(c.path)} creates a ${clean(r.type)}${r.name ? ` (${clean(r.name)})` : ''} that Dispose never disposes or cancels`);
      }
    }
    return judged.length ? `${names(judged)}: every subscription is removed and every timer disposed or cancelled` : 'no component subscribes or runs a timer';
  },

  'statehaschanged-marshalled': () => {
    pageComp();
    const judged = [];
    for (const c of comps()) {
      const f = c.cs;
      const ranges = offThreadRanges(f);
      if (ranges.length === 0) continue;
      judged.push(c.path);
      const spans = [];
      for (const m of f.bare.matchAll(/\bInvokeAsync\s*\(/g)) { const open = m.index + m[0].length - 1; if (f.pairs[open] > 0) spans.push([open, f.pairs[open]]); }
      const inSpan = (i) => spans.some(([a, b]) => i > a && i < b);
      const visited = new Set();
      const walkRange = (start, end, label, depth) => {
        for (const m of f.bare.slice(start, end).matchAll(/\bStateHasChanged\b/g)) {
          if (!inSpan(start + m.index)) fail(`${clean(c.path)}: StateHasChanged is called directly in a ${clean(label)}, which runs off the UI thread: wrap it in InvokeAsync`);
        }
        if (depth <= 0) return;
        for (const m of f.bare.slice(start, end).matchAll(/[A-Za-z_]\w*/g)) {
          if (inSpan(start + m.index) || visited.has(m[0])) continue;
          for (const callee of methodsNamed(f, m[0])) {
            if (callee.bodyStart === start) continue;
            visited.add(m[0]);
            walkRange(callee.bodyStart, callee.bodyEnd, `${label} (through ${m[0]})`, depth - 1);
          }
        }
      };
      for (const r of ranges) walkRange(r.start, r.end, r.label, 2);
      if (!/\bInvokeAsync\s*\(/.test(f.bare)) fail(`${clean(c.path)} has callbacks that run off the UI thread but never calls InvokeAsync, so the UI is not updated safely`);
    }
    if (judged.length === 0) fail('no component has an off-thread callback (an event handler attached with +=, a timer callback, Task.Run): nothing marshals updates');
    return `${names(judged)}: StateHasChanged is only reached through InvokeAsync from off-thread callbacks`;
  },

  'form-validated': () => {
    pageComp();
    const found = comps().filter((c) => forms(c).length > 0);
    if (found.length === 0) fail('no component has an EditForm');
    for (const c of found) {
      for (const form of forms(c)) {
        if (!/(?:^|\s)(?:Model|EditContext)\s*=/.test(form.attrs)) fail(`${clean(c.path)}: the EditForm has no Model or EditContext`);
        if (!/<DataAnnotationsValidator\b/.test(form.inner)) fail(`${clean(c.path)}: the EditForm has no DataAnnotationsValidator`);
        if (!/<(?:Fluent)?Validation(?:Message|Summary)\b/.test(form.inner)) fail(`${clean(c.path)}: the EditForm shows no validation messages (ValidationMessage or ValidationSummary)`);
        if (!/\bOnValidSubmit\s*=/.test(form.attrs) && !(/\bOnSubmit\s*=/.test(form.attrs) && /\.\s*Validate\s*\(\s*\)/.test(c.cs.bare))) fail(`${clean(c.path)}: the EditForm submits without validating (use OnValidSubmit)`);
      }
    }
    return `${names(found.map((c) => c.path))}: EditForm with a validator, a model and validation messages`;
  },

  'model-annotated': () => {
    pageComp();
    const formComps = comps().filter((c) => forms(c).length > 0);
    if (formComps.length === 0) fail('no component has an EditForm, so there is no form model');
    const types = [...comps().flatMap((c) => c.cs.types), ...workspace().srcCs.flatMap((f) => f.types)].filter((t) => t.kind !== 'interface' && t.kind !== 'enum');
    const required = (t) => (`${t.params}\n${t.body}`.match(/\bRequired(?:Attribute)?\s*(?:\(|\]|,)/g) || []).length;
    const bounded = (t) => /\b(?:StringLength|MaxLength)(?:Attribute)?\s*\(/.test(`${t.params}\n${t.body}`);
    const good = types.filter((t) => required(t) >= 2 && bounded(t));
    if (good.length === 0) fail('no model type has two [Required] members and a [StringLength] or [MaxLength] bound');
    const used = good.find((t) => formComps.some((c) => new RegExp(`\\b${t.name}\\b`).test(`${c.markup}\n${c.cs.bare}`)));
    if (!used) fail(`the annotated type ${clean(good[0].name)} is not used by the component that has the form`);
    return `${clean(used.name)} carries the data annotations and is used by the form`;
  },

  'child-one-way': () => {
    const p = pageComp();
    const kids = comps().filter((c) => c.pages.length === 0 && c !== p && usesTag(p, c.name) && parameters(c.cs).length > 0);
    if (kids.length === 0) fail(`${clean(p.path)} uses no child component that takes parameters`);
    let reporting = 0;
    for (const c of kids) {
      const params = parameters(c.cs);
      for (const q of params) {
        if (/^(?:System\.)?(?:Action|Func|Predicate|Delegate)\b/.test(q.type)) fail(`${clean(c.path)}: parameter ${clean(q.name)} is a ${clean(q.type)}, not an EventCallback`);
      }
      for (const q of params) {
        if (/^EventCallback\b/.test(q.type)) continue;
        const paired = params.some((x) => x.name === `${q.name}Changed` && /^EventCallback\b/.test(x.type));
        const assign = new RegExp(`(?<![.\\w])${q.name}\\s*(?:=(?![=>])|\\+=|-=|\\+\\+|--)|(?<![.\\w])${q.name}\\s*\\.\\s*\\w+\\s*=(?![=>])`);
        if (assign.test(c.cs.bare) && !paired) fail(`${clean(c.path)}: the component assigns its own [Parameter] ${clean(q.name)}: parameters flow down only, report changes with an EventCallback`);
      }
      const callbacks = params.filter((q) => /^EventCallback\b/.test(q.type));
      const fired = callbacks.filter((q) => new RegExp(`\\b${q.name}\\s*\\.\\s*Invoke(?:Async)?\\s*\\(`).test(c.cs.bare) || new RegExp(`=\\s*"[^"]*\\b${q.name}\\b`).test(c.markup));
      if (fired.length > 0) {
        const tag = new RegExp(`<${c.name}(?=[\\s/>])([^>]{0,800})`).exec(p.markup);
        if (!tag || !fired.some((q) => new RegExp(`(?:^|\\s)${q.name}\\s*=|@bind-\\w+`).test(tag[1]))) fail(`${clean(p.path)} uses ${clean(c.name)} without handling its ${clean(fired[0].name)} callback`);
        reporting += 1;
      } else if (callbacks.length > 0) fail(`${clean(c.path)} declares an EventCallback parameter but never invokes it`);
    }
    if (reporting === 0) fail(`no child of ${clean(p.path)} reports upward with an EventCallback (declared and invoked)`);
    return `${names(kids.map((c) => c.name))}: parameters flow down, an EventCallback reports up`;
  },

  'ui-library': () => {
    const p = pageComp();
    const raw = /<(?:button|input|select|textarea|table)(?=[\s/>])|<Input(?:Text|TextArea|Number|Select|Checkbox|Date|Radio|RadioGroup|File)(?=[\s/>])/;
    for (const c of comps()) {
      const m = raw.exec(c.markup);
      if (m) fail(`${clean(c.path)} uses ${clean(m[0])} instead of the project's Fluent UI component`);
    }
    if (!/<Fluent[A-Z]\w*/.test(p.markup) && !comps().some((c) => c !== p && usesTag(p, c.name) && /<Fluent[A-Z]\w*/.test(c.markup))) fail(`${clean(p.path)} and the components it uses contain no Fluent UI component`);
    const formComps = comps().filter((c) => forms(c).length > 0);
    for (const c of formComps) {
      if (!/<Fluent(?:TextField|TextArea|NumberField|Select|Checkbox|Combobox|Button|SearchBox)\b/.test(c.markup)) fail(`${clean(c.path)}: the form uses no Fluent UI input or button`);
    }
    return 'Fluent UI components are used and no raw HTML control or built-in Input* component appears';
  },

  'no-secrets-or-db-in-wasm': () => {
    const wasm = (c) => /\.Client\//.test(c.path) || /\bInteractive(?:WebAssembly|Auto)\b|\bRenderModeInteractive(?:WebAssembly|Auto)\b/.test(`${c.markup}\n${c.cs.bare}`);
    const files = [...comps().filter(wasm).map((c) => ({ path: c.path, code: c.cs.code, bare: c.cs.bare })), ...workspace().srcCs.filter((f) => /\.Client\//.test(f.path)).map((f) => ({ path: f.path, code: f.code, bare: f.bare }))];
    for (const f of files) {
      const db = /\b(?:DbContext|DbSet|SqlConnection|SqlCommand|NpgsqlConnection|MySqlConnection|SqliteConnection|MongoClient|IDocumentSession|GetConnectionString)\b|\bConnectionString\b/.exec(f.bare);
      if (db) fail(`${clean(f.path)} runs in the browser but uses ${clean(db[0])}: call an API instead of the database`);
      for (const m of f.code.matchAll(/\b([A-Za-z_]\w*)\s*(?:\{[^{}]{0,60}\}\s*)?=\s*"([^"\n]+)"/g)) {
        if (KEYISH.test(m[1]) && !/(?:Header|Name|Section|Scheme|Path|Prefix|Endpoint|Url|Uri)$/.test(m[1]) && !PLACEHOLDER.test(m[2].trim())) fail(`${clean(f.path)} runs in the browser but holds a secret literal in ${clean(m[1])}`);
      }
      if (/\b(?:Password|Pwd)\s*=\s*[^;"\s]{1,60};|"Bearer\s+[A-Za-z0-9._-]{12,}"/.test(f.code)) fail(`${clean(f.path)} runs in the browser but embeds a credential`);
    }
    return files.length ? `${files.length} browser-side file(s) hold no secret and no database access` : 'no browser-side (WebAssembly/Auto/.Client) code: nothing to judge';
  },

  'no-sync-over-async': () => {
    const { srcCs, testCs } = workspace();
    for (const f of [...comps().map((c) => ({ path: c.path, bare: c.cs.bare })), ...srcCs, ...testCs]) {
      const m = /\.\s*Result\b(?!\s*\()|\.\s*Wait\s*\(|\bGetAwaiter\s*\(\s*\)\s*\.\s*GetResult\s*\(|\bTask\s*\.\s*Wait(?:All|Any)\s*\(/.exec(f.bare);
      if (m) fail(`${clean(f.path)} blocks on a task (${clean(m[0].trim())}): await it`);
    }
    return 'no .Result, .Wait() or GetAwaiter().GetResult()';
  },

  'test-added': (o) => {
    const fx = need(o, 'fixture');
    const feature = pageComp();
    const fresh = new Set([feature.name, ...changedComps(fx).map((c) => c.name)]);
    const hit = [];
    for (const f of workspace().testCs) {
      if (!/\b(?:TestContext|BunitContext)\b/.test(f.bare)) continue;
      for (const m of f.methods) {
        if (!/\[\s*(?:Xunit\.)?(?:Fact|Theory)\b/.test(m.prefix)) continue;
        const r = [...m.body.matchAll(/\bRender(?:Component)?\s*<\s*([A-Za-z_]\w*)\s*>/g)].map((x) => x[1]);
        if (r.some((x) => fresh.has(x))) hit.push(`${f.path}:${m.name}`);
      }
    }
    if (hit.length === 0) fail('no bUnit [Fact]/[Theory] under tests/ renders the new page or a new component (RenderComponent<T>/Render<T> on a TestContext)');
    return `bUnit tests: ${names(hit)}`;
  },

  'test-asserts': (o) => {
    const fx = need(o, 'fixture');
    const feature = pageComp();
    const fresh = new Set([feature.name, ...changedComps(fx).map((c) => c.name)]);
    let count = 0;
    for (const f of workspace().testCs) {
      if (!/\b(?:TestContext|BunitContext)\b/.test(f.bare)) continue;
      for (const m of f.methods) {
        if (!/\[\s*(?:Xunit\.)?(?:Fact|Theory)\b/.test(m.prefix)) continue;
        if (![...m.body.matchAll(/\bRender(?:Component)?\s*<\s*([A-Za-z_]\w*)\s*>/g)].some((x) => fresh.has(x[1]))) continue;
        count += 1;
        if (/\bSkip\s*=/.test(f.code.slice(m.prefixStart, m.at))) fail(`${clean(f.path)}:${clean(m.name)} is skipped`);
        const real = m.body.replace(/\bAssert\s*\.\s*(?:True\s*\(\s*true|False\s*\(\s*false)\s*[,)]/g, ' ');
        if (!/\bAssert\s*\.\s*(?!Fail\b)\w+\s*[(<]|\.\s*MarkupMatches\s*\(|\.\s*Should\s*\(/.test(real)) fail(`${clean(f.path)}:${clean(m.name)} renders the component but has no real assertion`);
      }
    }
    if (count === 0) fail('no bUnit test of the new page to judge');
    return `${count} bUnit tests of the new page, each with a real assertion, none skipped`;
  },

  'existing-untouched': (o) => {
    const fx = need(o, 'fixture');
    const seeded = walk(fx);
    const KEEP_LINES = new Set(['src/Shop.Web/Program.cs', 'src/Shop.Web/Shop.Web.csproj', 'tests/Shop.Web.Tests/Shop.Web.Tests.csproj', 'src/Shop.Web/Components/Layout/MainLayout.razor', 'src/Shop.Web/Components/_Imports.razor', 'tests/Shop.Web.Tests/HomeTests.cs']);
    const norm = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const rel of seeded) {
      if (rel === P.directoryPackages) continue; // packages-central
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`${clean(rel)} was removed`);
      if (KEEP_LINES.has(rel)) {
        const have = norm(got);
        let k = 0;
        for (const line of norm(want)) {
          while (k < have.length && have[k] !== line) k += 1;
          if (k >= have.length) fail(`${clean(rel)} lost or reordered an original line: ${clean(line)}`);
          k += 1;
        }
      } else if (got !== want) fail(`${clean(rel)} was changed (only Program.cs, MainLayout.razor, _Imports.razor, the project files and HomeTests.cs may change, and only by addition)`);
    }
    const known = new Set(seeded);
    const stray = walk('.').filter((f) => !known.has(f) && !/^(?:src|tests)\//.test(f));
    if (stray.length) fail(`files outside src/ and tests/: ${names(stray)}`);
    const built = walk('.').filter((f) => SKIPPED_DIR.test(f));
    if (built.length) fail(`build output present although no build tool was to be run: ${names(built)}`);
    return 'every existing file is unchanged (or only extended where allowed); new files only under src/ and tests/';
  },

  'packages-central': (o) => {
    const fx = need(o, 'fixture');
    const pkgs = readText(P.directoryPackages);
    if (pkgs === null) fail('Directory.Packages.props was removed');
    if (!/<ManagePackageVersionsCentrally>\s*true\s*<\/ManagePackageVersionsCentrally>/i.test(pkgs)) fail('central package management was switched off');
    const versions = (t) => new Map([...t.matchAll(/<PackageVersion\b([^>]{0,300})>/g)].map((m) => [(/\bInclude\s*=\s*"([^"]+)"/.exec(m[1]) || [])[1], (/\bVersion\s*=\s*"([^"]+)"/.exec(m[1]) || [])[1]]).filter(([k]) => k));
    const was = versions(readText(`${fx}/${P.directoryPackages}`) || '');
    const now = versions(pkgs);
    for (const [k, v] of was) if (now.get(k) !== v) fail(`the pinned version of ${clean(k)} changed (${clean(v)} -> ${clean(now.get(k) || 'removed')})`);
    const lower = new Set([...now.keys()].map((k) => k.toLowerCase()));
    for (const rel of walk('.').filter((f) => /(?:\.csproj|\.props|\.targets)$/i.test(f) && f !== P.directoryPackages && !SKIPPED_DIR.test(f))) {
      const text = readText(rel);
      if (text === null) continue;
      for (const m of text.matchAll(/<PackageReference\b([^>]{0,400}?)(\/?)>/g)) {
        const inc = (/\bInclude\s*=\s*"([^"]+)"/.exec(m[1]) || [])[1];
        if (/\bVersion(?:Override)?\s*=/.test(m[1])) fail(`${clean(rel)} pins a version on PackageReference ${clean(inc)}: versions live in ${P.directoryPackages}`);
        if (m[2] !== '/') {
          const end = text.indexOf('</PackageReference>', m.index);
          if (end > 0 && /<Version(?:Override)?\b/.test(text.slice(m.index, end))) fail(`${clean(rel)} pins a version inside PackageReference ${clean(inc)}`);
        }
        if (inc && !lower.has(inc.toLowerCase())) fail(`${clean(rel)} references ${clean(inc)} but ${P.directoryPackages} has no PackageVersion for it`);
      }
    }
    return 'versions stay in Directory.Packages.props; every reference is versionless and pinned there';
  },

  'no-new-ui-package': (o) => {
    const fx = need(o, 'fixture');
    const was = new Set([...packageNames(readText(`${fx}/${P.directoryPackages}`) || '')].map((n) => n.toLowerCase()));
    const added = [];
    for (const rel of walk('.').filter((f) => /(?:\.csproj|\.props|\.targets)$/i.test(f) && !SKIPPED_DIR.test(f))) {
      const text = readText(rel);
      if (text === null) continue;
      for (const n of packageNames(text)) if (!was.has(n.toLowerCase())) added.push(n);
    }
    const ui = added.find((n) => UI_LIBS.test(n));
    if (ui) fail(`a second UI library was added (${clean(ui)}): use the Fluent UI components the project already references`);
    const odd = added.find((n) => !TEST_TOOLS.test(n));
    if (odd) fail(`a new package was added (${clean(odd)}) although the task needs none beyond test tooling`);
    for (const c of comps()) {
      const m = /<(?:Mud|Rz|Radzen|Sf|Ant|Dx|Telerik|Blazorise)[A-Z]\w*(?=[\s/>])/.exec(c.markup);
      if (m) fail(`${clean(c.path)} uses ${clean(m[0])} from another UI library`);
    }
    return 'no new UI library, no new non-test package';
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
module.exports = { CHECKS, scan, parse, pairsOf, parseParams, splitRazor, razor, subscriptions, offThreadRanges, parameters };
