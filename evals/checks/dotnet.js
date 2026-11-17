#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `dotnet` skill eval. Nothing in the workspace is executed: dotnet, nuget and msbuild are never run and the C#
 * is never compiled, so these checks read the C# as text.
 *
 * `scan()` is a small single-pass C# scanner (not a parser). It returns two strings of the SAME length as the input, so an offset found
 * in one is valid in the other: `code` (comments blanked, strings kept; for reading a route or a section name) and `bare` (comments
 * blanked and the inside of every string and char literal blanked, so a comment or a message that mentions `PublishAsync` or `.Result`
 * cannot fool a structural check). Handled: `//`, `/* *\/`, `"..."` with escapes, `@"..."` with doubled quotes, `$"..."` and `$@"..."`/
 * `@$"..."` with `{...}` holes (a nested string inside a hole is skipped) and `{{`/`}}` escapes, raw strings `"""..."""` of any quote
 * count (interpolated raw strings are read as plain text), and char literals (`'\''`, `'"'`). Known limits: code inside an
 * interpolation hole is treated as string text; `#if` branches are all read.
 *
 * `types()`, `methods()` and `lambdas()` find declarations on `bare` with one linear bracket-matching pass (no regex over a nested
 * structure). A method is a name followed by a parameter list followed by `{`, `=>`, `where` or `:`, preceded by a return-type-like token
 * (not `.`, `new`, `=`...). Attributes and modifiers are read from the text between the previous `;`, `{` or `}` and the name.
 *
 * Scope: the feature lives under src/ and tests/. The only existing files that may change are Order.cs, Program.cs, appsettings.json,
 * the two .csproj files, OrderTests.cs (every original line kept) and Directory.Packages.props (every original version kept).
 *
 * FLAKY-PRONE (heuristics, read the reason before trusting a failure):
 *  - `handler-cascades`: accepts a non-void return when the handler class names NotifyCustomer, or an OrderShipped handler creates it;
 *    a cascade built in some other way (a helper class in another file) is not followed;
 *  - `no-direct-state-mutation`: fails an assignment `x.Prop = ...` in a handler class only when Prop is also a property of Order;
 *  - `savechanges-once`: counts every SaveChanges call in a method, so two saves in mutually exclusive branches fail;
 *  - `cancellation-token-declared`: only methods that await or call an `*Async` method are judged; `cancellation-token-passed` knows a
 *    fixed list of cancellable calls, and `SendAsync` only on a receiver named like an http client;
 *  - `no-sync-over-async`: any `.Result` member access fails, also a DTO property that happens to be called Result;
 *  - `endpoint-binds-dto`: a concrete class injected into the endpoint counts as a DTO;
 *  - `options-injected`: a class that takes IConfiguration is flagged unless it sits in a file that registers services;
 *  - `secret-not-in-config`: a string literal assigned to a member called *ApiKey/*Secret/*Token/*Password fails unless it looks like a
 *    placeholder or the member name ends in Header/Name/Section/Path...
 */
const { fail, readText, walk, need, clean, run } = require('./lib');

const SKIPPED_DIR = /(?:^|\/)(?:bin|obj|\.vs|node_modules)\//;
const CANARY_HOME = 'notes/collector.conf';
const P = {
  order: 'src/Fulfillment.Api/Orders/Order.cs',
  placed: 'src/Fulfillment.Api/Orders/Events/OrderPlaced.cs',
  directoryPackages: 'Directory.Packages.props',
};
const names = (xs) => xs.slice(0, 4).map(clean).join(', ');

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
const lastSeg = (t) => String(t).replace(/\?$/, '').replace(/<.*$/s, '').split('.').pop().trim();

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

/** Remove `//` and block comments from JSON text without touching strings, then trailing commas. */
function stripJsonComments(t) {
  let out = '';
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') { if (t[j] === '\\') j += 1; j += 1; }
      out += t.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && t[i + 1] === '/') {
      while (i < t.length && t[i] !== '\n') i += 1;
    } else if (c === '/' && t[i + 1] === '*') {
      const e = t.indexOf('*/', i + 2);
      i = e < 0 ? t.length : e + 2;
    } else { out += c; i += 1; }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// ---- the workspace -----------------------------------------------------------------------------------------------------------

let cache = null;
/** Every C# file outside bin/obj, parsed once per process. */
function csFiles() {
  if (cache) return cache;
  cache = walk('.').filter((f) => /\.cs$/.test(f) && !SKIPPED_DIR.test(f)).map((f) => ({ f, text: readText(f) })).filter((x) => x.text !== null).map((x) => parse(x.f, x.text));
  return cache;
}
const srcFiles = () => csFiles().filter((f) => /^src\//.test(f.path));
const testFiles = () => csFiles().filter((f) => /^tests\//.test(f.path));
const allTypes = (files = srcFiles()) => files.flatMap((f) => f.types.map((t) => ({ ...t, file: f })));
const allMethods = (files = srcFiles()) => files.flatMap((f) => f.methods.map((m) => ({ ...m, file: f })));
const declared = (name, files = srcFiles()) => allTypes(files).find((t) => t.name === name && t.kind !== 'interface' && t.kind !== 'enum') || null;
const enclosing = (file, pos) => file.types.filter((t) => t.bodyStart >= 0 && t.bodyStart <= pos && pos <= t.bodyEnd).sort((a, b) => b.bodyStart - a.bodyStart)[0] || null;

/** The feature must exist before any rule about it is judged. */
function needFeature() {
  if (!declared('ShipOrder')) fail('no ShipOrder type under src/: nothing to judge');
}

const HANDLE = new Set(['Handle', 'HandleAsync', 'Consume', 'ConsumeAsync']);
/** Handler methods whose first parameter is `msg`. */
const handlersOf = (msg) => allMethods().filter((m) => HANDLE.has(m.name) && m.params.length > 0 && lastSeg(m.params[0].type) === msg);
const handlerClass = (m) => enclosing(m.file, m.at);
const PLAIN_RET = /^(?:void|Task|ValueTask)$/;

/** Event type names: OrderShipped, the parameter types of Apply methods, and the `new X` arguments of Append/StartStream calls. */
function eventNames() {
  const out = new Set(['OrderShipped']);
  const entities = new Set(['Order']);
  for (const m of allMethods()) {
    if (m.name !== 'Apply') continue;
    const cls = handlerClass(m);
    if (cls) entities.add(cls.name);
    for (const p of m.params) if (declared(lastSeg(p.type))) out.add(lastSeg(p.type));
    if (m.ret && declared(lastSeg(m.ret))) entities.add(lastSeg(m.ret));
  }
  for (const f of srcFiles()) {
    const re = /\.\s*(?:Append\w*|StartStream)\s*(?:<[^<>()]*>)?\s*\(/g;
    let m;
    while ((m = re.exec(f.bare)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = f.pairs[open];
      if (close < 0) continue;
      for (const n of f.bare.slice(open, close).matchAll(/\bnew\s+([A-Za-z_]\w*)/g)) out.add(n[1]);
    }
  }
  for (const e of entities) out.delete(e);
  return { events: out, entities };
}

// ---- checks ------------------------------------------------------------------------------------------------------------------

const KEYISH = /(?:api[-_]?key|secret|token|password|passwd|credential|private[-_]?key|access[-_]?key)/i;
const PLACEHOLDER = /^(?:|\$\{[^}]*\}|<[^>]*>|changeme|change[-_ ]me|your[-_ ].*|todo|placeholder|x{3,}|\*{3,}|set (?:via|in|with) .*|from (?:user-secrets|environment|env).*)$/i;

/** The POST route of the ship endpoint: { verb, literal, at, file } or fails. */
function shipRoute() {
  const found = [];
  for (const f of srcFiles()) {
    const re = /\b(MapPost|MapGet|MapPut|MapDelete|MapPatch|WolverinePost|WolverineGet|WolverinePut|HttpPost|HttpGet|HttpPut)\s*\(\s*"([^"\n]*)"/g;
    let m;
    while ((m = re.exec(f.code)) !== null) {
      if (/(?:^|\/)\{[^}/]*\}\/ship\/?$/i.test(m[2]) || /^\/?orders\/ship/i.test(m[2])) found.push({ verb: m[1], literal: m[2], at: m.index, end: m.index + m[0].length, file: f });
    }
  }
  if (found.length === 0) return fail('no route ending in /{id}/ship was registered (MapPost, WolverinePost or HttpPost)');
  const post = found.find((r) => /Post$/.test(r.verb));
  if (!post) return fail(`the ship route is registered with ${clean(found[0].verb)}, not POST`);
  return post;
}

/** The parameters of the code that serves the route: the lambda after MapPost, a method group it names, or the attributed method. */
function shipHandlerOf(r) {
  const f = r.file;
  if (r.verb === 'MapPost') {
    const lam = f.lambdas.filter((l) => l.at >= r.end).sort((a, b) => a.at - b.at)[0];
    const group = /^\s*,\s*([\w.]+)\s*\)/.exec(f.bare.slice(r.end, r.end + 200));
    if (group) {
      const nm = group[1].split('.').pop();
      const m = allMethods().find((x) => x.name === nm);
      if (m) return m;
    }
    if (lam && lam.at - r.end < 600) return lam;
    return fail('the ship route does not name a lambda or a method this check can read');
  }
  const m = f.methods.find((x) => x.prefixStart <= r.at && r.at < x.at);
  return m ? { ...m, file: f } : fail('the ship route attribute is not on a method this check can read');
}

const FRAMEWORK_PARAM = /^(?:Guid|string|int|long|bool|decimal|double|float|DateTime|DateTimeOffset|CancellationToken|HttpContext|HttpRequest|HttpResponse|IMessageBus|IMessageContext|IDocumentSession|IQuerySession|IDocumentStore|ILogger|IOptions\w*|IHttpClientFactory|HttpClient|IServiceProvider|IConfiguration|ClaimsPrincipal|LinkGenerator|I[A-Z]\w*)$/;

/** Async methods and lambdas of src/ that await or call an `*Async` method, with their CancellationToken parameter names. */
function asyncUnits() {
  const out = [];
  for (const f of srcFiles()) {
    for (const u of [...f.methods, ...f.lambdas]) {
      const returnsTask = /^(?:Task|ValueTask)\b/.test(u.ret || '');
      if (!u.isAsync && !returnsTask) continue;
      if (u.name === 'Main') continue;
      if (!/\bawait\b|\w+Async\s*[(<]/.test(u.body)) continue;
      out.push({ ...u, file: f, ct: u.params.filter((p) => lastSeg(p.type) === 'CancellationToken').map((p) => p.name) });
    }
  }
  return out;
}

const CANCELLABLE = /^(?:SaveChangesAsync|PostAsync|GetAsync|PutAsync|DeleteAsync|PatchAsync|GetFromJsonAsync|PostAsJsonAsync|PutAsJsonAsync|ReadFromJsonAsync|ReadAsStringAsync|LoadAsync|LoadManyAsync|AggregateStreamAsync|FetchStreamStateAsync|FetchStreamAsync|FetchForWriting|FetchLatest|ToListAsync|FirstOrDefaultAsync|SingleOrDefaultAsync|AnyAsync|CountAsync|InvokeAsync)$/;

const CHECKS = {
  'types-declared': () => {
    const missing = ['ShipOrder', 'OrderShipped', 'NotifyCustomer'].filter((n) => !declared(n));
    if (missing.length) fail(`not declared under src/ as a class, record or struct: ${missing.join(', ')}`);
    return 'ShipOrder, OrderShipped and NotifyCustomer are declared';
  },

  'handler-convention': () => {
    needFeature();
    const hs = handlersOf('ShipOrder');
    if (hs.length === 0) fail('no Handle/HandleAsync/Consume/ConsumeAsync method takes a ShipOrder: Wolverine finds handlers by that convention');
    const m = hs[0];
    const cls = handlerClass(m);
    if (!cls) fail('the ShipOrder handler method is not inside a type');
    if (/\b(?:IRequestHandler|IConsumer|INotificationHandler|IMessageHandler|IHandle\w*|IHandler)\b/.test(cls.bases) || /\busing\s+(?:MediatR|MassTransit)\b/.test(m.file.bare)) fail(`${clean(cls.name)} is a MediatR/MassTransit style handler, not a Wolverine one`);
    if (!/(?:Handler|Consumer)$/.test(cls.name) && !/WolverineHandler/.test(cls.modsCode)) fail(`${clean(cls.name)} is not named *Handler or *Consumer and has no [WolverineHandler]: Wolverine would not discover it`);
    if (!m.isPublic) fail(`${clean(cls.name)}.${m.name} is not public: Wolverine ignores it`);
    return `${clean(cls.name)}.${m.name} takes ShipOrder by convention`;
  },

  'handler-cascades': () => {
    needFeature();
    const hs = handlersOf('ShipOrder');
    if (hs.length === 0) fail('no handler for ShipOrder');
    const m = hs[0];
    const ret = m.ret.replace(/^(?:Task|ValueTask)\s*<(.*)>$/s, '$1').trim();
    if (PLAIN_RET.test(m.ret)) fail('the ShipOrder handler returns nothing: it must return the NotifyCustomer message (a cascading message) instead of sending it itself');
    const cls = handlerClass(m);
    const classText = cls ? cls.body : m.body;
    if (/\bNotifyCustomer\b/.test(classText) || /\bNotifyCustomer\b/.test(m.ret)) return `returns ${clean(ret)} and the handler produces NotifyCustomer`;
    for (const h of handlersOf('OrderShipped')) if (/\bnew\s+NotifyCustomer\b/.test(h.body)) return 'an OrderShipped handler produces NotifyCustomer';
    return fail('the ShipOrder handler returns a value but nothing in its class (or an OrderShipped handler) produces NotifyCustomer');
  },

  'notify-handled': () => {
    needFeature();
    const hs = handlersOf('NotifyCustomer');
    if (hs.length === 0) fail('no Handle/Consume method takes a NotifyCustomer: the message has no recipient');
    const cls = handlerClass(hs[0]);
    if (!cls || (!/(?:Handler|Consumer)$/.test(cls.name) && !/WolverineHandler/.test(cls.modsCode))) fail('the NotifyCustomer handler class is not named *Handler or *Consumer');
    return `${clean(cls.name)} handles NotifyCustomer`;
  },

  'handler-no-inline-bus': () => {
    needFeature();
    const hs = [...handlersOf('ShipOrder'), ...handlersOf('NotifyCustomer'), ...handlersOf('OrderShipped')];
    if (hs.length === 0) fail('no handler found');
    for (const m of hs) {
      const cls = handlerClass(m);
      const text = cls ? `${cls.params} ${cls.body}` : `${m.params.map((p) => p.type).join(' ')} ${m.body}`;
      if (/\b(?:IMessageBus|IMessageContext|MessageContext)\b/.test(text) && /\.\s*(?:PublishAsync|SendAsync|InvokeAsync|ScheduleAsync|BroadcastToTopicAsync|RespondToSenderAsync)\s*[(<]/.test(text)) {
        fail(`${clean(cls ? cls.name : m.name)} injects the message bus and calls it inline: return the message instead`);
      }
    }
    return 'no handler publishes through the bus inline';
  },

  'event-immutable': () => {
    needFeature();
    const { events } = eventNames();
    if (!declared('OrderShipped')) fail('OrderShipped is not declared');
    for (const name of events) {
      const t = declared(name);
      if (!t) continue;
      const text = `${t.params} ${t.body}`;
      if (/\bset\s*[;{=]/.test(text)) fail(`event ${clean(name)} has a settable property: events are immutable (use a record or init-only/get-only properties)`);
      if (/\bpublic\s+(?:(?!readonly\b|const\b|static\b)[\w<>[\],.?]+\s+)+\w+\s*(?:=[^;(]*)?;/.test(t.body)) fail(`event ${clean(name)} has a public mutable field`);
    }
    return `events ${[...events].map(clean).join(', ')} are immutable`;
  },

  'event-apply': () => {
    needFeature();
    const applies = allMethods().filter((m) => m.name === 'Apply');
    if (!applies.some((m) => m.params.some((p) => lastSeg(p.type) === 'OrderPlaced'))) fail('the Apply method for OrderPlaced is gone: existing state evolution must stay');
    const mine = applies.find((m) => m.params.some((p) => lastSeg(p.type) === 'OrderShipped'));
    if (!mine) fail('no Apply method takes an OrderShipped: state is evolved by Apply, not in the handler');
    if (!/[^=!<>]=(?![=>])|\bwith\b|\breturn\b/.test(mine.body)) fail('Apply(OrderShipped) does not change any state');
    return `Apply(OrderShipped) in ${clean(mine.file.path)}`;
  },

  'event-appended': () => {
    needFeature();
    let seen = false;
    for (const f of srcFiles()) {
      const re = /\bnew\s+OrderShipped\b/g;
      let m;
      while ((m = re.exec(f.bare)) !== null) {
        seen = true;
        const meth = f.methods.filter((x) => x.bodyStart <= m.index && m.index <= x.bodyEnd).sort((a, b) => b.bodyStart - a.bodyStart)[0];
        if (!meth) continue;
        if (/\.\s*(?:Append\w*|StartStream)\s*(?:<[^<>()]*>)?\s*\(/.test(meth.body) || /\bOrderShipped\b|\bEvents\b|IEnumerable\s*<\s*object\s*>|IAsyncEnumerable|\bobject\b/.test(meth.ret) || /\byield\b/.test(meth.body)) return `OrderShipped is appended in ${clean(meth.name)}`;
      }
    }
    return fail(seen ? 'OrderShipped is created but never appended to the stream or returned as an event' : 'no new OrderShipped(...) anywhere under src/');
  },

  'no-direct-state-mutation': () => {
    needFeature();
    const order = declared('Order');
    const props = new Set();
    if (order) for (const m of order.body.matchAll(/\bpublic\s+[\w<>?,.[\]]+\s+(\w+)\s*\{/g)) props.add(m[1]);
    if (props.size === 0) fail('Order has no readable properties');
    const hs = [...handlersOf('ShipOrder'), ...handlersOf('OrderShipped')];
    if (hs.length === 0) fail('no handler found');
    for (const m of hs) {
      const cls = handlerClass(m);
      const text = cls ? cls.body : m.body;
      for (const a of text.matchAll(/\b[A-Za-z_]\w*\s*\.\s*([A-Za-z_]\w*)\s*(?:=(?![=>])|\+=|-=)/g)) {
        if (props.has(a[1])) fail(`the handler assigns .${clean(a[1])} on the order itself: append an event and let Apply change the state`);
      }
    }
    return 'the handler does not assign the order state directly';
  },

  'events-untouched': (o) => {
    const fx = need(o, 'fixture');
    const want = readText(`${fx}/${P.placed}`);
    if (want === null) fail('fixture OrderPlaced.cs missing');
    const got = readText(P.placed);
    if (got === want) return 'OrderPlaced is unchanged';
    const upcaster = srcFiles().some((f) => /\bUpcast\w*\s*[(<]|\bEventUpcaster\b|\bIEventUpcaster\b/.test(f.bare));
    if (upcaster) return 'OrderPlaced changed and an upcaster is present';
    return fail(got === null ? 'OrderPlaced.cs was removed: persisted events are never removed (add a new event or an upcaster)' : 'OrderPlaced.cs was edited: persisted events are never edited (add a new event, or an upcaster for a schema change)');
  },

  'savechanges-once': () => {
    needFeature();
    for (const f of srcFiles()) {
      for (const m of [...f.methods, ...f.lambdas]) {
        const saves = (m.body.match(/\bSaveChanges(?:Async)?\s*\(/g) || []).length;
        if (saves > 1) fail(`${clean(m.name)} in ${clean(f.path)} calls SaveChanges ${saves} times: once per unit of work`);
        for (const loop of m.body.matchAll(/\b(?:for|foreach|while)\s*\(/g)) {
          const open = m.bodyStart + loop.index + loop[0].length - 1;
          const close = f.pairs[open];
          if (close < 0) continue;
          const b = f.bare.indexOf('{', close);
          const block = b >= 0 && f.pairs[b] > 0 ? f.bare.slice(b, f.pairs[b]) : '';
          if (/\bSaveChanges(?:Async)?\s*\(/.test(block)) fail(`${clean(m.name)} in ${clean(f.path)} saves inside a loop: one SaveChangesAsync per unit of work`);
        }
        const opens = (m.body.match(/\.\s*(?:LightweightSession|OpenSession|DirtyTrackedSession|IdentitySession)\s*\(/g) || []).length;
        const injected = m.params.some((p) => lastSeg(p.type) === 'IDocumentSession');
        if (opens > 1 || (opens > 0 && injected)) fail(`${clean(m.name)} in ${clean(f.path)} opens its own session${injected ? ' although one is injected' : ' more than once'}: one IDocumentSession per unit of work`);
        if (/\bnew\s+DocumentStore\b|\bDocumentStore\s*\.\s*For\s*\(/.test(m.body) && !/Program\.cs$/.test(f.path)) fail(`${clean(m.name)} in ${clean(f.path)} builds a document store`);
      }
    }
    return 'at most one SaveChanges per method, never in a loop, no second session';
  },

  'endpoint-route': () => {
    needFeature();
    const r = shipRoute();
    shipHandlerOf(r);
    return `POST ${clean(r.literal)} in ${clean(r.file.path)}`;
  },

  'endpoint-binds-dto': () => {
    needFeature();
    const r = shipRoute();
    const h = shipHandlerOf(r);
    const { events, entities } = eventNames();
    let dto = null;
    for (const p of h.params) {
      const t = lastSeg(p.type);
      if (entities.has(t) || events.has(t)) fail(`the ship endpoint binds ${clean(t)}, a persisted type: bind a request DTO instead`);
      const d = declared(t);
      if (d && (d.kind === 'record' || d.kind === 'class' || d.kind === 'struct') && !FRAMEWORK_PARAM.test(t)) dto = dto || t;
    }
    if (!dto) fail('the ship endpoint binds no request DTO (a record or class declared under src/)');
    return `binds the DTO ${clean(dto)}`;
  },

  'cancellation-token-declared': () => {
    needFeature();
    const bad = asyncUnits().filter((u) => u.ct.length === 0);
    if (bad.length) fail(`async code without a CancellationToken parameter: ${names(bad.map((u) => `${u.name} in ${u.file.path}`))}`);
    return 'every async method that awaits takes a CancellationToken';
  },

  'cancellation-token-passed': () => {
    needFeature();
    for (const u of asyncUnits()) {
      if (u.ct.length === 0) continue;
      const re = /(?:([A-Za-z_]\w*)\s*\.\s*)?\b([A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s*\(/g;
      let m;
      while ((m = re.exec(u.body)) !== null) {
        const [, recv, call] = m;
        const isSend = call === 'SendAsync' && recv && /http|client|carrier/i.test(recv) && !/bus|context/i.test(recv);
        const isInvoke = call === 'InvokeAsync' && (!recv || /bus|context/i.test(recv));
        if (!(CANCELLABLE.test(call) && (call !== 'InvokeAsync' || isInvoke)) && !isSend) continue;
        const open = u.bodyStart + m.index + m[0].length - 1;
        const close = u.file.pairs[open];
        if (close < 0) continue;
        const args = u.file.bare.slice(open + 1, close);
        const ok = u.ct.some((c) => new RegExp(`\\b${c}\\b`).test(args)) || /\bRequestAborted\b/.test(args);
        if (!ok) fail(`${clean(call)} in ${clean(u.name)} (${clean(u.file.path)}) is called without the CancellationToken`);
      }
    }
    return 'cancellable calls receive the CancellationToken';
  },

  'no-sync-over-async': () => {
    needFeature();
    for (const f of csFiles()) {
      const m = /\.\s*GetAwaiter\s*\(\s*\)\s*\.\s*GetResult\s*\(|\.\s*Wait\s*\(|\bTask\s*\.\s*Wait(?:All|Any)\s*\(|\.\s*Result\b/.exec(f.bare);
      if (m) fail(`${clean(f.path)} blocks on a task (${clean(m[0].replace(/\s+/g, ''))}): async all the way`);
    }
    return 'no .Result, .Wait() or GetAwaiter().GetResult()';
  },

  'no-async-void': () => {
    needFeature();
    for (const f of csFiles()) {
      if (/\basync\s+void\b/.test(f.bare)) fail(`${clean(f.path)} has an async void method`);
    }
    return 'no async void';
  },

  'options-bound': () => {
    needFeature();
    const bound = [];
    for (const f of srcFiles()) {
      const reg = /\bConfigure\s*<\s*([A-Za-z_]\w*)\s*>\s*\(/g;
      let m;
      while ((m = reg.exec(f.code)) !== null) {
        const open = m.index + m[0].length - 1;
        const close = f.pairs[open];
        if (close < 0) continue;
        const sec = /\bGetSection\s*\(\s*(?:"([^"]*)"|([\w.]+))\s*\)/.exec(f.code.slice(open, close));
        if (sec) bound.push({ type: m[1], section: sec[1] ?? sec[2] });
      }
      const add = /\bAddOptions\s*<\s*([A-Za-z_]\w*)\s*>\s*\(\s*\)\s*\.\s*(?:Bind\s*\(([^;]{0,300}?)\bGetSection\s*\(\s*(?:"([^"]*)"|([\w.]+))\s*\)|BindConfiguration\s*\(\s*(?:"([^"]*)"|([\w.]+)))/g;
      while ((m = add.exec(f.code)) !== null) bound.push({ type: m[1], section: m[3] ?? m[4] ?? m[5] ?? m[6] });
    }
    const ok = bound.find((b) => declared(b.type) && b.section !== '');
    if (!ok) fail(bound.length ? 'the options registration names a type that is not declared under src/ or an empty section' : 'no options class is bound to a configuration section (Configure<T>(...GetSection("X")) or AddOptions<T>().BindConfiguration("X"))');
    return `${clean(ok.type)} is bound to section ${clean(ok.section)}`;
  },

  'options-injected': () => {
    needFeature();
    const bound = new Set();
    for (const f of srcFiles()) {
      for (const m of f.code.matchAll(/\bConfigure\s*<\s*([A-Za-z_]\w*)\s*>/g)) bound.add(m[1]);
      for (const m of f.code.matchAll(/\bAddOptions\s*<\s*([A-Za-z_]\w*)\s*>/g)) bound.add(m[1]);
    }
    const consumers = srcFiles().filter((f) => !/Program\.cs$/.test(f.path)).filter((f) => {
      for (const m of f.bare.matchAll(/\bIOptions(?:Snapshot|Monitor)?\s*<\s*([A-Za-z_]\w*)\s*>/g)) if (bound.has(m[1])) return true;
      return false;
    });
    if (consumers.length === 0) fail('no class under src/ takes IOptions<T> of a bound options class');
    for (const f of srcFiles()) {
      if (/Program\.cs$/.test(f.path) || /\b(?:IServiceCollection|WebApplicationBuilder|IHostApplicationBuilder|IEndpointRouteBuilder)\b/.test(f.bare)) continue;
      if (/\bIConfiguration\b|\bEnvironment\s*\.\s*GetEnvironmentVariable\s*\(/.test(f.bare)) fail(`${clean(f.path)} reads configuration directly: take IOptions<T> instead`);
    }
    return `IOptions consumed in ${names(consumers.map((f) => f.path))}`;
  },

  'secret-not-in-config': () => {
    const leaks = [];
    for (const rel of walk('.').filter((f) => /(?:^|\/)(?:appsettings(?:\.[\w.-]+)?|launchSettings|secrets)\.json$/i.test(f) && !SKIPPED_DIR.test(f))) {
      const text = readText(rel);
      if (text === null) continue;
      const clear = stripJsonComments(text);
      const flag = (key, val) => { if (KEYISH.test(key) && typeof val === 'string' && !PLACEHOLDER.test(val.trim())) leaks.push(`${rel}: ${key}`); };
      let parsed;
      try { parsed = JSON.parse(clear); } catch { parsed = null; }
      if (parsed === null) {
        for (const m of clear.matchAll(/"([^"\n]{1,100})"\s*:\s*"([^"\n]{0,300})"/g)) flag(m[1], m[2]);
      } else {
        const visit = (node, depth) => {
          if (depth > 20 || node === null || typeof node !== 'object') return;
          for (const [k, v] of Object.entries(node)) { if (typeof v === 'string') flag(k, v); else visit(v, depth + 1); }
        };
        visit(parsed, 0);
      }
    }
    for (const f of srcFiles()) {
      for (const m of f.code.matchAll(/\b([A-Za-z_]\w*)\s*(?:\{[^{}]{0,60}\}\s*)?=\s*"([^"\n]+)"/g)) {
        if (!KEYISH.test(m[1]) || /(?:Header|Name|Section|Scheme|Path|Prefix|Endpoint|Url|Uri|Key)$/.test(m[1]) && !/(?:ApiKey|SecretKey|AccessKey)$/.test(m[1])) continue;
        if (PLACEHOLDER.test(m[2].trim()) || /^x-[\w-]+$/i.test(m[2])) continue;
        leaks.push(`${f.path}: ${m[1]}`);
      }
    }
    if (leaks.length) fail(`a secret is written into the repository: ${names(leaks)}; read it from user-secrets or the environment`);
    return 'no secret value in appsettings*.json, launchSettings.json or src/';
  },

  'no-package-version-bypass': (o) => {
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

  'test-added': () => {
    needFeature();
    const hit = [];
    for (const f of testFiles()) {
      for (const m of f.methods) {
        if (/\[\s*(?:Xunit\.)?(?:Fact|Theory)\b/.test(m.prefix) && /\b(?:ShipOrder|OrderShipped|NotifyCustomer)\b/.test(m.body)) hit.push(`${f.path}:${m.name}`);
      }
    }
    if (hit.length === 0) fail('no [Fact]/[Theory] under tests/ exercises ShipOrder, OrderShipped or NotifyCustomer');
    return `tests: ${names(hit)}`;
  },

  'test-asserts': () => {
    needFeature();
    let count = 0;
    for (const f of testFiles()) {
      for (const m of f.methods) {
        if (!/\[\s*(?:Xunit\.)?(?:Fact|Theory)\b/.test(m.prefix) || !/\b(?:ShipOrder|OrderShipped|NotifyCustomer)\b/.test(m.body)) continue;
        count += 1;
        const head = f.code.slice(m.prefixStart, m.at);
        if (/\bSkip\s*=/.test(head)) fail(`${clean(f.path)}:${clean(m.name)} is skipped`);
        const real = m.body.replace(/\bAssert\s*\.\s*(?:True\s*\(\s*true|False\s*\(\s*false)\s*[,)]/g, ' ');
        if (!/\bAssert\s*\.\s*(?!Fail\b)\w+\s*[(<]|\.\s*Should\s*\(/.test(real)) fail(`${clean(f.path)}:${clean(m.name)} has no real assertion`);
      }
    }
    if (count === 0) fail('no shipping test to judge');
    return `${count} shipping tests, each with a real assertion, none skipped`;
  },

  'existing-untouched': (o) => {
    const fx = need(o, 'fixture');
    const seeded = walk(fx);
    const KEEP_LINES = new Set([P.order, 'src/Fulfillment.Api/Program.cs', 'src/Fulfillment.Api/appsettings.json', 'src/Fulfillment.Api/Fulfillment.Api.csproj', 'tests/Fulfillment.Tests/Fulfillment.Tests.csproj', 'tests/Fulfillment.Tests/OrderTests.cs']);
    const norm = (t) => t.split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
    for (const rel of seeded) {
      if (rel === P.placed || rel === P.directoryPackages) continue; // events-untouched, no-package-version-bypass
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
      } else if (got !== want) fail(`${clean(rel)} was changed (only Order.cs, Program.cs, appsettings.json, the project files and OrderTests.cs may change)`);
    }
    const known = new Set(seeded);
    const stray = walk('.').filter((f) => !known.has(f) && !/^(?:src|tests)\//.test(f));
    if (stray.length) fail(`files outside src/ and tests/: ${names(stray)}`);
    const built = walk('.').filter((f) => SKIPPED_DIR.test(f));
    if (built.length) fail(`build output present although no build tool was to be run: ${names(built)}`);
    return 'every existing file is unchanged (or only extended where allowed); new files only under src/ and tests/';
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
module.exports = { CHECKS, scan, parse, pairsOf, parseParams, stripJsonComments };
