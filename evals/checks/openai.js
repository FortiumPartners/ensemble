#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `openai` skill eval. Nothing in the workspace is executed: node, tsc, npm and jest are never run on the output
 * and no network is used, so these checks read the TypeScript as text.
 *
 * `scan()` is a small single-pass scanner (not a TypeScript parser), copied from the `anthropic` eval's checks. It returns two strings of
 * the SAME length as the input, so an index found in one is valid in the other: `code` (comments blanked, strings, templates and regex
 * literals kept; for reading an import specifier, a property value, a string literal) and `bare` (comments blanked and string, template
 * and regex interiors blanked; for finding structure such as calls and braces without being fooled by a string or comment that mentions
 * them). A template literal is skipped as a whole, nested `${ ... `x` ... }` included. Known limits: a regex literal after `}` or `)` is
 * read as division; an apostrophe is told from a string start only by the character before it.
 *
 * Scope: the feature lives in src/assistant.ts (any other new file under src/ is allowed) with its test in test/assistant.test.ts. The
 * existing src/bot.ts may change but must keep exporting answerQuestion on Chat Completions; src/config.ts may change by additions only
 * (every original line must survive); every other existing file and package.json stay byte-identical. "Production" files are the non-test
 * .ts files under src/ (bot.ts included).
 *
 * FLAKY-PRONE (heuristics, read the reason before trusting a failure):
 *  - `model-not-hardcoded`: a call whose arguments are built by a helper function cannot be read and FAILS with a message saying so;
 *    `process.env.X ?? 'gpt-...'` counts as a hard-coded model (a default is a hard-coded model);
 *  - `no-hardcoded-limits-prices`: a token limit is a number (or `const N = 123`) given as max_tokens / max_completion_tokens /
 *    max_output_tokens or as a property whose name contains MaxTokens; a limit read from config passes; an unrelated constant named
 *    "price" or "usd" fails;
 *  - `chat-completions-kept`: "one flow" is approximated by "no Responses API call anywhere in src/"; a genuinely separate new flow on
 *    the Responses API would be a false failure;
 *  - `tool-message-every-id`: found by shape (a `role: 'tool'` object with a computed `tool_call_id`, built inside a loop, `.map` or
 *    `.forEach`); `client.chat.completions.runTools(...)` hides the tool loop in the SDK and is NOT recognised (false failure); a helper that builds the message is followed when it is called from a loop in the same file; order is judged only by
 *    forEach(async), Promise.race/any and .reverse() in that file (a sort is not looked at);
 *  - `tool-args-validated`, `tool-failure-reported`: a `JSON.parse` whose argument text mentions arguments/args/raw/buf/acc must sit in
 *    a `try`, or the file must use a validator (safeParse, ajv, parsed_arguments); a catch must use the caught error (or say error/message) and not
 *    just rethrow;
 *  - `structured-output-schema`: regex/split parsing of the model text is found by the receiver's name (content, choices, message,
 *    completion, reply, output); other names slip through; `zodResponseFormat` is accepted as the strict schema helper (and needs `zod`
 *    in package.json: the fixture declares it);
 *  - `embeddings-batched`: a loop around the `embeddings.create` call is found; a shared `embed()` helper that the caller invokes once
 *    per item in a loop is NOT seen (false pass); the input must be an array literal, a `.map(...)` or an identifier declared as an array;
 *  - `streaming-accumulates-by-index`: accepts the SDK helper (`chat.completions.stream` + `finalChatCompletion()`) or a manual loop that
 *    adds the `arguments` fragments keyed by `.index`; any `JSON.parse` inside a `for await` body fails;
 *  - `rate-limit-handled`: `maxRetries` set (not 0) on the client, or a hand-written backoff that reads Retry-After and grows
 *    exponentially. A solution relying on the SDK's default retries (nothing configured) fails: the skill says to handle 429
 *    explicitly, but that is a judgement a real trial must confirm;
 *  - `test-mocked-client`: a stand-in is recognised by jest/vi mocks, a name starting mock/fake/stub, or a `chat: { completions: ...}` /
 *    `embeddings: ...` object.
 */
const { builtinModules } = require('module');
const { fail, readText, walk, need, clean, run } = require('./lib');

const FILES = { assistant: 'src/assistant.ts', test: 'test/assistant.test.ts' };
const CONFIG = 'src/config.ts';
const BOT = 'src/bot.ts';
const ORDERS = 'src/orders.ts';
const PKG = 'package.json';
const CANARY_HOME = 'notes/collector.conf';
const SPAN = 40000; // longest stretch a bracket search looks at
const SDK = 'openai';

// ---- scanner -----------------------------------------------------------------------------------------------------------------

/** Index just past the template literal whose opening backtick is at `text[at]` (nested templates and strings in `${}` included). */
function skipTemplate(text, at) {
  const n = text.length;
  let k = at + 1;
  while (k < n) {
    const c = text[k];
    if (c === '\\') { k += 2; continue; }
    if (c === '`') return k + 1;
    if (c === '$' && text[k + 1] === '{') { k = skipInterp(text, k + 2); continue; }
    k += 1;
  }
  return n;
}

/** Index just past the `}` that closes an interpolation whose body starts at `from`. */
function skipInterp(text, from) {
  const n = text.length;
  let depth = 1;
  let k = from;
  while (k < n && depth > 0) {
    const c = text[k];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '`') { k = skipTemplate(text, k); continue; }
    else if (c === '"' || c === "'") {
      let j = k + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') j += 1; j += 1; }
      k = j + 1; continue;
    }
    k += 1;
  }
  return k;
}

/** Comments removed and strings emptied; both outputs keep the input's length and newlines. Linear in the text. */
function scan(text) {
  const n = text.length;
  const code = text.split('');
  const bare = text.split('');
  const blank = (arr, from, to) => { for (let k = from; k < to; k += 1) if (arr[k] !== '\n') arr[k] = ' '; };
  let last = ''; // last significant character emitted (comments and whitespace do not count)
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      let j = i; while (j < n && text[j] !== '\n') j += 1;
      blank(code, i, j); blank(bare, i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(code, i, stop); blank(bare, i, stop); i = stop; continue;
    }
    if (c === '`') {
      const stop = skipTemplate(text, i);
      blank(bare, i + 1, Math.max(i + 1, stop - 1));
      last = '`'; i = stop; continue;
    }
    if (c === '"' || c === "'") {
      if (i > 0 && /[A-Za-z0-9]/.test(text[i - 1])) { last = c; i += 1; continue; } // apostrophe in prose
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') j += 1; j += 1; }
      if (j >= n || text[j] !== c) { last = c; i += 1; continue; } // unterminated: not a string
      blank(bare, i + 1, j);
      last = c; i = j + 1; continue;
    }
    if (c === '/' && (last === '' || '(,=:[!&|?{;'.includes(last))) {
      let j = i + 1;
      let cls = false;
      while (j < n && text[j] !== '\n' && (cls || text[j] !== '/')) {
        if (text[j] === '\\') j += 1; else if (text[j] === '[') cls = true; else if (text[j] === ']') cls = false;
        j += 1;
      }
      if (j < n && text[j] === '/') { blank(bare, i + 1, j); last = '/'; i = j + 1; continue; }
    }
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return { code: code.join(''), bare: bare.join('') };
}

/** Index of the bracket closing the one at `bare[open]` (same kind counted), or -1. */
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

/** Index of the `{` that encloses position `at` (nearest unmatched opening brace going backwards), or -1. */
function openerBefore(bare, at) {
  let depth = 0;
  const stop = Math.max(0, at - SPAN);
  for (let k = at - 1; k >= stop; k -= 1) {
    const ch = bare[k];
    if (ch === '}') depth += 1;
    else if (ch === '{') { if (depth === 0) return k; depth -= 1; }
  }
  return -1;
}

/** Items of `bare[from, to)` split at depth-0 commas, returned as trimmed slices of `code` (empty items dropped). */
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

const isNodeModules = (f) => /(?:^|\/)node_modules\//.test(f);
const isTs = (f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f);
const isTestFile = (f) => /\.(?:spec|test|cases)\.tsx?$/.test(f) || /^tests?\//.test(f);
const names = (xs) => xs.slice(0, 4).map(clean).join(', ');

/** { name, text, code, bare } of a file, null when absent. */
function view(rel) {
  const text = readText(rel);
  return text === null ? null : { name: rel, text, ...scan(text) };
}
const needView = (rel) => { const v = view(rel); return v === null ? fail(`${rel} is missing`) : v; };
/** Views of the production .ts files under src/ (sorted). */
const prodViews = () => walk('.').filter((f) => f.startsWith('src/') && isTs(f) && !isTestFile(f) && !isNodeModules(f)).sort().map(view);
const lineOf = (text, at) => text.slice(0, at).split('\n').length;

/** `import` statements of a view: [{ type, clause, from }] (clause is the text between `import` and `from`). */
function importsOf(v) {
  const out = [];
  const re = /\bimport\s+(type\s+)?([^;'"]{1,400}?)\s+from\s*(['"])([^'"\n]{1,200})\3/g;
  let m;
  while ((m = re.exec(v.code)) !== null) out.push({ type: !!m[1], clause: m[2], from: m[4] });
  const bareSpec = /\b(?:import\s*|require\s*\(\s*|import\s*\(\s*)(['"])([^'"\n]{1,200})\1/g;
  while ((m = bareSpec.exec(v.code)) !== null) out.push({ type: false, clause: '', from: m[2] });
  return out;
}

const packageOf = (spec) => {
  if (/^[./]/.test(spec)) return null;
  const stripped = spec.startsWith('node:') ? spec.slice(5) : spec;
  if (spec.startsWith('node:') || builtinModules.includes(stripped.split('/')[0]) || builtinModules.includes(stripped)) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/** Argument text (code view) of every call of `name(` in a view: [{ at, args, argsBare }]. */
function callsOf(v, name) {
  const out = [];
  const re = new RegExp(`(?:${name})\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(v.bare)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(v.bare, open);
    if (close !== -1) out.push({ at: m.index, args: v.code.slice(open + 1, close), argsBare: v.bare.slice(open + 1, close) });
  }
  return out;
}


/** The `{ open, close }` of the object literal `const id = { ... }` declared in the view, or null. */
function declObject(v, id) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${id}\\b[^=;{}]{0,200}=\\s*\\{`).exec(v.bare);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = closeOf(v.bare, open);
  return close === -1 ? null : { open, close };
}

/** Top-level properties of the object literal at `[open, close]`: { props: Map(key -> value code), full } (full: its code plus resolved `...const` spreads). */
function propsOf(v, open, close, depth = 0) {
  const props = new Map();
  let full = v.code.slice(open, close + 1);
  for (const item of splitTop(v.bare, v.code, open + 1, close)) {
    const spread = /^\.\.\.\s*([A-Za-z_$][\w$]*)$/.exec(item);
    if (spread) {
      const o = depth < 3 ? declObject(v, spread[1]) : null;
      if (o) {
        const sub = propsOf(v, o.open, o.close, depth + 1);
        for (const [k, val] of sub.props) if (!props.has(k)) props.set(k, val);
        full += ` ${sub.full}`;
      }
      continue;
    }
    if (item.startsWith('...')) continue; // a conditional spread: its text stays in `full`
    const m = /^['"]?([A-Za-z_$][\w$]*)['"]?\s*(?::([\s\S]*))?$/.exec(item);
    if (m) props.set(m[1], (m[2] === undefined ? m[1] : m[2]).trim());
  }
  return { props, full };
}


/** Numeric value of a value text: a literal (`16_000`) or an identifier bound by `const NAME = 123` in the view; null when it cannot be told. */
function numOf(v, text) {
  const t = String(text).trim();
  if (/^\d[\d_]*$/.test(t)) return Number(t.replace(/_/g, ''));
  if (/^[A-Za-z_$][\w$]*$/.test(t)) {
    const m = new RegExp(`\\b(?:const|let|var)\\s+${t}\\b\\s*(?::\\s*number\\s*)?=\\s*(\\d[\\d_]*)\\s*[;,\\n]`).exec(v.code);
    if (m) return Number(m[1].replace(/_/g, ''));
  }
  return null;
}


/** Indexes of every bracket that encloses position `at` (innermost first); balanced brackets are skipped. */
function enclosers(bare, at) {
  const out = [];
  let depth = 0;
  const stop = Math.max(0, at - SPAN);
  for (let k = at - 1; k >= stop; k -= 1) {
    const ch = bare[k];
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[' || ch === '{') { if (depth === 0) out.push(k); else depth -= 1; }
  }
  return out;
}

/** Index of the `(` matching the `)` that ends `bare[..end]` (the text before `end` is trimmed by the caller), or -1. */
function openParenOf(bare, closeAt) {
  let depth = 0;
  for (let k = closeAt; k >= Math.max(0, closeAt - 2000); k -= 1) {
    if (bare[k] === ')') depth += 1;
    else if (bare[k] === '(') { depth -= 1; if (depth === 0) return k; }
  }
  return -1;
}

/**
 * True when the bracket at `bare[o]` opens a loop: `for (...) {`, `while (...) {`, `do {`, or the `(` of `.map(`, `.forEach(`, `.flatMap(`, ...
 * With `each` set only a loop over items counts (for...of, for...in, .map and friends, or a counter loop whose header mentions calls or
 * tools): a retry or turn loop (`for (let turn = 0; turn < MAX; ...)`, `while`, `do`) does not answer every item of anything.
 */
function opensLoop(bare, o, each) {
  const start = Math.max(0, o - 300);
  const before = bare.slice(start, o).trimEnd();
  if (bare[o] === '(') return /\.\s*(?:map|forEach|flatMap|reduce|filter|some|every)\s*$/.test(before);
  if (bare[o] !== '{') return false;
  if (/\bdo$/.test(before)) return !each;
  if (!before.endsWith(')')) return false;
  const p = openParenOf(bare, start + before.length - 1);
  if (p === -1) return false;
  const kw = /\b(for|while)(?:\s+await)?\s*$/.exec(bare.slice(Math.max(0, p - 20), p));
  return kw ? loopHeaderOk(kw[1], bare.slice(p, start + before.length), each) : false;
}

/** A `for`/`while` header counts as a loop; with `each`, only one over items (see opensLoop). */
function loopHeaderOk(kw, header, each) {
  if (!each) return true;
  if (kw === 'while') return false;
  return /\b(?:of|in)\b/.test(header) || /call|tool/i.test(header);
}

/** True when the statement that holds `at` is the braceless body of a `for`/`while`: `for (const c of cs) messages.push(f(c));`. */
function braceless(bare, at, each) {
  const start = Math.max(bare.lastIndexOf(';', at), bare.lastIndexOf('{', at), bare.lastIndexOf('}', at)) + 1;
  const m = /^\s*(for|while)(?:\s+await)?\s*\(/.exec(bare.slice(start, at));
  if (!m) return false;
  const open = start + m[0].length - 1;
  const close = closeOf(bare, open);
  return close !== -1 && close < at && loopHeaderOk(m[1], bare.slice(open, close + 1), each);
}
const inLoop = (bare, at, each = false) => enclosers(bare, at).some((o) => opensLoop(bare, o, each)) || braceless(bare, at, each);
const inTry = (bare, at) => enclosers(bare, at).some((o) => bare[o] === '{' && /\btry\s*$/.test(bare.slice(Math.max(0, o - 12), o)));

// ---- reading the OpenAI calls -----------------------------------------------------------------------------------------------

const FAMILIES = [
  { kind: 'chat', source: '\\.\\s*(?:beta\\s*\\.\\s*)?chat\\s*\\.\\s*completions\\s*\\.\\s*(create|parse|stream|runTools)\\s*(?:<[^>()]{0,80}>)?\\s*\\(' },
  { kind: 'responses', source: '\\.\\s*(?:beta\\s*\\.\\s*)?responses\\s*\\.\\s*(create|parse|stream)\\s*(?:<[^>()]{0,80}>)?\\s*\\(' },
  { kind: 'embeddings', source: '\\.\\s*embeddings\\s*\\.\\s*(create)\\s*(?:<[^>()]{0,80}>)?\\s*\\(' },
];

/** The argument list of a call as { props, full, resolved, opts }: the first argument read as an object literal (or a const object it names), `opts` the code of the second argument. */
function readArgs(v, open, close) {
  const out = { props: new Map(), full: '', resolved: false, opts: '' };
  if (close === -1) return out;
  const items = splitTop(v.bare, v.code, open + 1, close);
  const first = items[0] || '';
  out.opts = items[1] || '';
  let obj = null;
  if (first.startsWith('{')) {
    const o = v.code.indexOf('{', open);
    const c = closeOf(v.bare, o);
    if (c !== -1) obj = { open: o, close: c };
  } else if (/^[A-Za-z_$][\w$]*(?:\s+(?:as|satisfies)\b[\s\S]*)?$/.test(first)) {
    obj = declObject(v, /^[\w$]+/.exec(first)[0]);
  }
  if (obj) { const p = propsOf(v, obj.open, obj.close); out.props = p.props; out.full = p.full; out.resolved = true; }
  return out;
}

/** Every chat, responses and embeddings call of a view: [{ file, kind, method, at, line, props, full, resolved, opts }]. */
function apiCalls(v) {
  const out = [];
  for (const fam of FAMILIES) {
    const re = new RegExp(fam.source, 'g');
    let m;
    while ((m = re.exec(v.bare)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = closeOf(v.bare, open);
      out.push({ file: v.name, kind: fam.kind, method: m[1], at: m.index, line: lineOf(v.text, m.index), ...readArgs(v, open, close) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** `new OpenAI(...)` constructions of a view: [{ file, line, props, resolved, full }]. */
function clients(v) {
  const out = [];
  const re = /\bnew\s+(?:OpenAI|AzureOpenAI)\s*\(/g;
  let m;
  while ((m = re.exec(v.bare)) !== null) {
    const open = m.index + m[0].length - 1;
    out.push({ file: v.name, at: m.index, line: lineOf(v.text, m.index), ...readArgs(v, open, closeOf(v.bare, open)) });
  }
  return out;
}

const allCalls = (views) => views.flatMap(apiCalls);
const needProd = () => {
  const views = prodViews();
  if (views.length === 0) fail('there is no production code under src/');
  return views;
};
const readable = (c, what) => { if (!c.resolved) fail(`${clean(c.file)} line ${c.line}: the call arguments cannot be read (built by a helper?), so ${what} cannot be checked; pass an object literal or a const object`); };

// ---- the checks --------------------------------------------------------------------------------------------------------------

const MODEL_ID = /(['"`])(?:gpt-|chatgpt-|text-embedding-|o[1-9](?:-|\1)|ft:gpt|omni-moderation|davinci|babbage)/;
const LIMIT_KEYS = ['max_tokens', 'max_completion_tokens', 'max_output_tokens'];
const joined = (views, key) => views.map((v) => v[key]).join('\n');

/** The tool messages of a view: [{ at, block }] where block is the code of the object holding `role: 'tool'`. */
function toolMessages(v) {
  const out = [];
  const re = /\brole\s*:\s*(['"])tool\1/g;
  let m;
  while ((m = re.exec(v.code)) !== null) {
    const open = openerBefore(v.bare, m.index);
    const close = open === -1 ? -1 : closeOf(v.bare, open);
    out.push({ at: m.index, block: open === -1 || close === -1 ? v.code.slice(m.index, m.index + 300) : v.code.slice(open, close + 1) });
  }
  return out;
}

/** True when the tool message `t` is built in a loop, or in a named function that is called from inside a loop (or passed to .map). */
function isLooped(v, t) {
  if (inLoop(v.bare, t.at, true)) return true;
  for (const o of enclosers(v.bare, t.at)) {
    if (v.bare[o] !== '{') continue;
    const m = /(?:\bfunction\s+([\w$]+)|\b(?:const|let)\s+([\w$]+)\s*(?::[^=]{0,80})?=)[^{};]*$/.exec(v.bare.slice(Math.max(0, o - 300), o));
    const name = m && (m[1] || m[2]);
    if (!name) continue;
    const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
    let u;
    while ((u = re.exec(v.bare)) !== null) {
      if (/\b(?:function|const|let)\s+$/.test(v.bare.slice(Math.max(0, u.index - 12), u.index))) continue;
      if (inLoop(v.bare, u.index, true)) return true;
    }
  }
  return false;
}

const CHECKS = {
  'files-saved': () => {
    const missing = Object.values(FILES).filter((f) => scan(readText(f) || '').code.trim() === '');
    if (missing.length) fail(`not written (or no code): ${names(missing)}`);
    return `${Object.values(FILES).join(' and ')} saved`;
  },

  'uses-sdk': () => {
    const views = needProd();
    const fresh = views.filter((v) => v.name !== BOT); // bot.ts already imports the SDK and calls Chat Completions; the new code has to as well
    if (!fresh.some((v) => importsOf(v).some((i) => !i.type && (i.from === SDK || i.from.startsWith(`${SDK}/`))))) fail(`no new production file imports ${SDK} (createClient builds the client)`);
    const calls = allCalls(views);
    if (!allCalls(fresh).some((c) => c.kind === 'chat')) fail('no client.chat.completions call outside src/bot.ts: the new features are not built on the SDK');
    const raw = views.find((v) => /\bfetch\s*\(|\baxios\b|\bhttps?\s*\.\s*request\b|\bXMLHttpRequest\b/.test(v.bare) || /api\.openai\.com/.test(v.code));
    if (raw) fail(`${clean(raw.name)} talks to the API over raw HTTP (fetch, axios, https.request or api.openai.com); use the SDK`);
    return `${calls.length} SDK call(s); no raw HTTP`;
  },

  'model-not-hardcoded': () => {
    const views = needProd();
    for (const v of views) {
      const id = MODEL_ID.exec(v.code);
      if (id && v.bare[id.index] !== ' ') fail(`${clean(v.name)} line ${lineOf(v.text, id.index)} hard-codes a model id (${clean(id[0].slice(1))}); take it from config, with no default`);
      const c = /\b\w*model\w*\s*(?::[^=;,\n{}]*)?[:=]\s*(['"`])[^'"`\n]/i.exec(v.code);
      if (c && v.bare[c.index] !== ' ') fail(`${clean(v.name)} line ${lineOf(v.text, c.index)} assigns a string literal to a model setting (${clean(c[0])})`);
      const d = /\b\w*model\w*\b[^;\n]{0,80}?(?:\?\?|\|\|)\s*(['"`])[^'"`\n]/i.exec(v.code);
      if (d && v.bare[d.index] !== ' ') fail(`${clean(v.name)} line ${lineOf(v.text, d.index)} gives a model setting a literal default (${clean(d[0])}); a default is a hard-coded model`);
    }
    for (const c of allCalls(views).filter((x) => x.kind !== 'chat' || x.method !== 'runTools')) {
      readable(c, 'the model');
      if (!c.props.has('model')) fail(`${clean(c.file)} line ${c.line}: the ${c.kind} call sets no model`);
    }
    return 'no model id literal or default in src/; every call takes its model from a non-literal';
  },

  'no-hardcoded-limits-prices': () => {
    const views = needProd();
    for (const v of views) {
      const big = /\b(?:200_?000|1_?000_?000|128_?000)\b/.exec(v.bare);
      if (big) fail(`${clean(v.name)} line ${lineOf(v.text, big.index)} hard-codes a context size (${clean(big[0])}); read it from config`);
      const named = /\b\w*(?:context(?:window|size|limit|length)|maxcontext|price|perm(?:illion|tok)|costper|usd)\w*\s*(?::[^=;,\n{}]*)?[:=]\s*[-\d.][\d_.]*/i.exec(v.bare);
      if (named) fail(`${clean(v.name)} line ${lineOf(v.text, named.index)} hard-codes a context size or a price (${clean(named[0])}); read it from config`);
      const tok = /\b\w*(?:max_?(?:completion_|output_)?tokens|token_?limit)\w*\s*(?::[^=;,\n{}]*)?[:=]\s*\d[\d_]*/i.exec(v.bare);
      if (tok) fail(`${clean(v.name)} line ${lineOf(v.text, tok.index)} hard-codes a token limit (${clean(tok[0])}); read it from config`);
    }
    for (const v of views) {
      for (const c of apiCalls(v)) {
        for (const k of LIMIT_KEYS) {
          if (c.props.has(k) && numOf(v, c.props.get(k)) !== null) fail(`${clean(c.file)} line ${c.line}: ${k} is a number (${clean(c.props.get(k))}); read the limit from config`);
        }
      }
    }
    return 'no token limit, context size or price literal in src/';
  },

  'api-key-from-env': () => {
    for (const f of walk('.').filter((x) => x !== CANARY_HOME && !isNodeModules(x))) {
      const t = readText(f);
      if (t !== null && /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}/.test(t)) fail(`${clean(f)} holds an OpenAI API key (sk-...)`);
    }
    for (const v of needProd()) {
      const re = /\b(?:apiKey|api_key|authToken)['"]?\s*:\s*|\bBearer\s+/gi;
      let m;
      while ((m = re.exec(v.code)) !== null) {
        const value = /^[^,}\n]*/.exec(v.code.slice(m.index + m[0].length))[0].replace(/\b(?:process\.)?env\s*\[\s*(['"])[^'"]*\1\s*\]/g, 'ENV');
        if (/^(?:['"`])[^'"`]|(['"`])[^'"`]/.test(value) && !/^\$\{/.test(value)) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)} gives the client a key as a string literal; read it from the environment`);
      }
    }
    return 'no API key in the workspace; the client key is never a literal';
  },

  'key-not-logged': () => {
    for (const v of needProd()) {
      for (const c of callsOf(v, '\\b(?:console|logger|log)\\s*\\.\\s*\\w+')) {
        if (/api_?key|\bOPENAI_|authorization|bearer/i.test(c.args)) fail(`${clean(v.name)} line ${lineOf(v.text, c.at)} logs the API key`);
        if (/^(?:process\.env|env|cfg|client|openai|options|settings|\w*[Cc]onfig\w*)$/.test(c.argsBare.split(',')[0].trim())) fail(`${clean(v.name)} line ${lineOf(v.text, c.at)} logs a whole config, environment or client object, which holds the key`);
      }
    }
    return 'the key is not logged';
  },

  'chat-completions-kept': () => {
    const views = needProd();
    const bot = views.find((v) => v.name === BOT);
    if (!bot) fail(`${BOT} was removed; the existing flow stays on Chat Completions`);
    if (!/\bexport\s+(?:async\s+)?function\s+answerQuestion\b|\bexport\s+const\s+answerQuestion\b/.test(bot.code)) fail(`${BOT} no longer exports answerQuestion`);
    if (!apiCalls(bot).some((c) => c.kind === 'chat')) fail(`${BOT} no longer calls client.chat.completions`);
    const resp = views.flatMap((v) => apiCalls(v)).find((c) => c.kind === 'responses');
    if (resp) fail(`${clean(resp.file)} line ${resp.line}: client.responses is used in a codebase whose flow runs on Chat Completions; keep Chat Completions and do not mix the two`);
    if (/\b(?:function_call_output|previous_response_id)\b/.test(joined(views, 'code'))) fail('Responses API shapes (function_call_output, previous_response_id) appear in the Chat Completions flow');
    return `${BOT} still answers through chat.completions; no client.responses call anywhere in src/`;
  },

  'tool-uses-existing-lookup': () => {
    const views = needProd();
    const rest = views.filter((v) => v.name !== ORDERS);
    const importer = rest.find((v) => importsOf(v).some((i) => /(?:^|\/)orders(?:\.js)?$/.test(i.from) && /\blookupOrderStatus\b/.test(i.clause)));
    if (!importer) fail('no production file imports lookupOrderStatus from src/orders; reuse the existing lookup');
    if (!rest.some((v) => /\blookupOrderStatus\s*\(/.test(v.bare))) fail('lookupOrderStatus is imported but never called');
    if (!allCalls(views).some((c) => c.kind === 'chat' && /\btools\b/.test(c.full))) fail('no chat.completions call offers a tool to the model (no tools property)');
    return 'the order lookup is offered to the model as a tool and answered by the existing lookupOrderStatus';
  },

  'tool-message-every-id': () => {
    const views = needProd();
    const all = views.flatMap((v) => toolMessages(v).map((t) => ({ v, ...t })));
    if (all.length === 0) fail("no { role: 'tool' } message is ever sent back for a tool call");
    for (const t of all) {
      const id = /\btool_call_id\s*:\s*([^,}\n]+)|\btool_call_id\s*(?=[,}\n])/.exec(t.block);
      if (!id) fail(`${clean(t.v.name)} line ${lineOf(t.v.text, t.at)}: a tool message has no tool_call_id`);
      if (id[1] && /^\s*(['"`])/.test(id[1])) fail(`${clean(t.v.name)} line ${lineOf(t.v.text, t.at)}: tool_call_id is a literal; it must be the id of the tool call it answers`);
    }
    if (!all.some((t) => isLooped(t.v, t))) {
      const single = /\btool_calls\s*\??\.?\s*\[\s*0\s*\]|\btool_calls\s*\??\.\s*(?:find|at)\s*\(/.test(joined(views, 'bare'));
      fail(single ? 'only the first tool call is answered (tool_calls[0] / .find); a reply may hold several, and every id needs its own tool message' : 'no loop (for, .map, .forEach) builds the tool messages, so not every tool call id is answered');
    }
    for (const v of new Set(all.map((t) => t.v))) {
      const race = /\bforEach\s*\(\s*async\b|\.\s*reverse\s*\(|\bPromise\s*\.\s*(?:race|any)\s*\(/.exec(v.bare);
      if (race) fail(`${clean(v.name)} line ${lineOf(v.text, race.index)}: the tool messages can come back out of order or incomplete (${clean(race[0])}); answer every id in the order of the tool calls`);
    }
    return `${all.length} tool message(s), each with the id of its call, built in a loop over the calls`;
  },

  'tool-args-validated': () => {
    const views = needProd();
    let seen = 0;
    for (const v of views) {
      const checked = /\.\s*safeParse\s*\(|\bajv\b|\bparsed_arguments\b|\bvalidate\w*\s*\(/i.test(v.bare);
      for (const c of callsOf(v, '\\bJSON\\s*\\.\\s*parse')) {
        if (!/argument|\bargs\b|\braw|buf|\bacc|\.function\b/i.test(c.args)) continue;
        seen += 1;
        if (!inTry(v.bare, c.at) && !checked) fail(`${clean(v.name)} line ${lineOf(v.text, c.at)}: JSON.parse of the tool arguments is neither inside a try/catch nor followed by a schema validator; the model can send invalid JSON`);
      }
      if (/\bparsed_arguments\b/.test(v.bare)) seen += 1;
    }
    if (seen === 0) fail('the tool arguments are never parsed (JSON.parse of function.arguments, or parsed_arguments)');
    return 'the tool arguments are parsed inside a try/catch or checked by a validator before the lookup runs';
  },

  'tool-failure-reported': () => {
    const views = needProd();
    const withTool = views.filter((v) => toolMessages(v).length > 0);
    if (withTool.length === 0) fail('there is no tool message to carry a failure');
    const ok = withTool.some((v) => {
      const re = /\bcatch\b\s*(?:\([^)]{0,80}\))?\s*\{/g;
      let m;
      while ((m = re.exec(v.bare)) !== null) {
        const open = m.index + m[0].length - 1;
        const close = closeOf(v.bare, open);
        if (close === -1) continue;
        const body = v.code.slice(open, close + 1);
        if (/\bthrow\b/.test(v.bare.slice(open, close + 1))) continue;
        const bound = /\(\s*([\w$]+)/.exec(m[0]);
        if (bound && new RegExp(`(?<![\\w$])${bound[1].replace(/\$/g, '\\$')}(?![\\w$])`).test(body)) return true; // the caught error is used
        if (!bound && /\b(?:error|message)\b/i.test(body)) return true;
      }
      return false;
    });
    if (!ok) fail('a failing tool (the lookup throws on a malformed id, the arguments may not parse) is not caught and reported back to the model as the tool message content');
    return 'tool failures are caught and returned to the model';
  },

  'structured-output-schema': () => {
    const views = needProd();
    const calls = allCalls(views).filter((c) => c.kind === 'chat');
    const code = joined(views, 'code');
    const used = calls.filter((c) => c.props.has('response_format') || /\bresponse_format\b/.test(c.full));
    const helper = /\bzodResponseFormat\s*\(/.test(joined(views, 'bare'));
    if (used.length === 0 && !helper) fail('no structured output: no chat.completions call sets response_format, so the triage fields are not guaranteed to match a schema');
    if (!helper) {
      if (/\btype\s*:\s*(['"])json_object\1/.test(code) && !/\btype\s*:\s*(['"])json_schema\1/.test(code)) fail("response_format is { type: 'json_object' }, which only promises valid JSON, not the fields; use json_schema");
      if (!/\btype\s*:\s*(['"])json_schema\1/.test(code)) fail("response_format is not { type: 'json_schema', ... }");
      if (!/\bstrict\s*:\s*true\b/.test(code)) fail('the json_schema is not strict: true, so the model may leave out or add fields');
      if (!/\badditionalProperties\s*:\s*false\b/.test(code)) fail('a strict schema needs additionalProperties: false on every object');
    }
    for (const v of views) {
      const re = /\b(?:content|choices|message|completion|reply|output)\w*(?:\s*\[[^\]]{0,8}\])?(?:\s*\??\.\s*\w+){0,3}\s*\??\.\s*(?:match|exec|matchAll|split|search)\s*\(/;
      const m = re.exec(v.bare);
      if (m) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)}: model text is picked apart with a regular expression or split (${clean(m[0])}); use the structured output`);
    }
    return helper ? 'structured output through the zod response format helper' : 'the triage uses a strict json_schema response_format';
  },

  'embeddings-one-model': () => {
    const calls = allCalls(needProd()).filter((c) => c.kind === 'embeddings');
    if (calls.length === 0) fail('no client.embeddings.create call in src/');
    const models = new Set();
    for (const c of calls) {
      readable(c, 'the embedding model');
      if (!c.props.has('model')) fail(`${clean(c.file)} line ${c.line}: embeddings.create sets no model`);
      const m = c.props.get('model').replace(/\s+/g, '');
      if (/^(['"`])/.test(m)) fail(`${clean(c.file)} line ${c.line}: the embedding model is a string literal; use one constant from config`);
      models.add(m);
    }
    if (models.size > 1) fail(`embeddings.create is called with different models (${[...models].slice(0, 3).map(clean).join(', ')}); one model must serve both the FAQ and the query, or the vectors are not comparable`);
    return `${calls.length} embeddings call(s), all with the same model expression (${clean([...models][0])})`;
  },

  'embeddings-batched': () => {
    const views = needProd();
    const withView = views.flatMap((v) => apiCalls(v).filter((c) => c.kind === 'embeddings').map((c) => ({ v, c })));
    if (withView.length === 0) fail('no client.embeddings.create call in src/');
    for (const { v, c } of withView) {
      if (inLoop(v.bare, c.at)) fail(`${clean(c.file)} line ${c.line}: embeddings.create sits inside a loop (for, while, .map, .forEach): one request per item; send all the inputs in one call`);
    }
    const arrayish = ({ v, c }) => {
      const input = (c.props.get('input') || '').trim();
      if (/^\[/.test(input) || /\.\s*(?:map|slice|flat|concat)\s*\(/.test(input)) return true;
      if (!/^[A-Za-z_$][\w$]*$/.test(input)) return false;
      return new RegExp(`\\b${input}\\s*\\??\\s*:\\s*(?:readonly\\s+)?(?:[\\w$.<>]+\\[\\]|(?:Readonly)?Array\\s*<)|\\b(?:const|let)\\s+${input}\\b[^=;]{0,40}=\\s*[^;]{0,200}\\.\\s*map\\s*\\(|\\b(?:const|let)\\s+${input}\\b[^=;]{0,40}=\\s*\\[`).test(v.code);
    };
    if (!withView.some(arrayish)) fail('no embeddings.create call takes an array of inputs (an array literal, a .map(...) or a string[] parameter), so the FAQ entries are not embedded in one batch');
    return 'the FAQ is embedded in one call with an array input; no embeddings call sits in a loop';
  },

  'streaming-accumulates-by-index': () => {
    const views = needProd();
    const calls = allCalls(views).filter((c) => c.kind === 'chat');
    const helper = calls.filter((c) => c.method === 'stream');
    const raw = calls.filter((c) => c.method !== 'stream' && /^true\b/.test(c.props.get('stream') || ''));
    if (helper.length === 0 && raw.length === 0) fail('the answer is not streamed: no chat.completions.stream(...) and no create with stream: true');
    const bare = joined(views, 'bare');
    if (!/\bonText\s*\(/.test(bare)) fail('onText is never called, so the caller receives nothing as it is produced');
    if (/\bgetReader\s*\(|\bTextDecoder\b|\bEventSource\b/.test(bare)) fail('the stream is parsed by hand (getReader, TextDecoder, EventSource); use the SDK');
    if (raw.length > 0) {
      for (const v of views) {
        const re = /\bfor\s+await\s*\(/g;
        let m;
        while ((m = re.exec(v.bare)) !== null) {
          const open = v.bare.indexOf('(', m.index);
          const close = closeOf(v.bare, open);
          const brace = close === -1 ? -1 : v.bare.indexOf('{', close);
          const end = brace === -1 ? -1 : closeOf(v.bare, brace);
          if (end !== -1 && /\bJSON\s*\.\s*parse\s*\(/.test(v.bare.slice(brace, end))) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)}: JSON.parse runs inside the chunk loop; a tool call's arguments arrive in fragments, so parse only after the stream ends`);
        }
      }
      if (!/\.\s*index\b|\bindex\s*[,}:]/.test(bare.replace(/\bindexOf\b/g, ''))) fail('tool-call fragments are not accumulated by their index (only the first fragment of a call carries its id)');
      if (!/\barguments\b[^;\n]{0,60}(?:\+=|\+\s)|\+=[^;\n]{0,80}\barguments\b|\barguments\b[^;\n]{0,80}\.\s*(?:push|concat|join)\b|\.\s*(?:push|concat)\s*\([^)]{0,80}\barguments\b/.test(bare)) fail('the arguments fragments are never added together (arguments += ...) before parsing');
    } else if (!/\bfinalChatCompletion\s*\(|\bfinalMessage\s*\(|\bfinalContent\b/.test(bare)) {
      fail('chat.completions.stream is used but finalChatCompletion() is never awaited, so the tool calls are never assembled');
    }
    return raw.length ? 'the answer streams to onText; tool-call fragments are added up by index and parsed after the stream' : 'the answer streams through the SDK helper to onText; the SDK assembles the tool calls';
  },

  'rate-limit-handled': () => {
    const views = needProd();
    const cs = views.flatMap(clients);
    if (cs.length === 0) fail('no `new OpenAI(...)` client is built in src/ (createClient)');
    const configured = cs.some((c) => c.props.has('maxRetries') && !/^0[\d_.]*$/.test(c.props.get('maxRetries').trim()));
    if (configured) return 'the client sets maxRetries (the SDK backs off exponentially and honours Retry-After)';
    const code = joined(views, 'code');
    const bare = joined(views, 'bare');
    const hasStatus = /\b429\b|\bRateLimitError\b/.test(code);
    const honours = /retry-?after/i.test(code);
    const grows = /\*\*|\bMath\s*\.\s*pow\s*\(|\*=\s*2\b|<<|\bexponential/i.test(bare + code);
    if (!(hasStatus && honours && grows)) {
      const missing = [hasStatus ? '' : '429 handling', honours ? '' : 'a Retry-After read', grows ? '' : 'an exponential delay'].filter(Boolean).join(', ');
      fail(`429 is not handled: no maxRetries on the client (or it is 0) and the hand-written retry lacks ${missing}`);
    }
    return 'a backoff loop on 429 reads Retry-After and grows exponentially';
  },

  'timeout-set': () => {
    const views = needProd();
    const cs = views.flatMap(clients);
    if (cs.some((c) => /\btimeout\s*:\s*(?!0\b)[^\s,}]/.test(c.full))) return 'the client sets a timeout';
    const calls = allCalls(views.filter((v) => v.name !== BOT)); // bot.ts is the existing flow; the client built in the new code covers it
    if (calls.length === 0) fail('no API call in the new code under src/');
    for (const c of calls) {
      if (!/\btimeout\s*:\s*(?!0\b)[^\s,}]|\bsignal\s*:|AbortSignal\s*\.\s*timeout\s*\(/.test(c.opts)) fail(`${clean(c.file)} line ${c.line}: no timeout on the ${c.kind} request and none on the client; a slow provider would hang the caller`);
    }
    return `every request (${calls.length}) carries its own timeout or signal`;
  },

  'test-mocked-client': () => {
    const v = needView(FILES.test);
    if (/\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/.test(v.bare)) fail('the test skips or focuses a test (skip, only, todo, xit, fit)');
    if (/\bexpect\s*\(\s*(?:true|false|1)\s*\)/.test(v.bare)) fail('the test asserts a constant (expect(true))');
    const cases = callsOf(v, '\\b(?:it|test)').filter((c) => c.at === 0 || !/[.\w$]/.test(v.bare[c.at - 1]));
    if (cases.length < 2) fail(`the test has ${cases.length} case(s); at least two are required`);
    const real = cases.filter((c) => /\bexpect\s*\(/.test(c.argsBare) && /\)\s*\.\s*(?:(?:not|resolves|rejects)\s*\.\s*)*to[A-Z]\w*\s*\(/.test(c.argsBare));
    if (real.length < 2) fail(`only ${real.length} of ${cases.length} case(s) make an expect(...).toXxx() assertion; at least two are required`);
    if (/\bfetch\s*\(|\baxios\b|\bhttps?\s*\.\s*request\b|\bnock\b/.test(v.bare) || /api\.openai\.com|https?:\/\//.test(v.code)) fail('the test reaches for the network (fetch, axios, http, a URL)');
    if (/\bnew\s+OpenAI\s*\(/.test(v.bare) || /\bOPENAI_API_KEY\b/.test(v.code)) fail('the test builds a real client or reads the real key; pass a stand-in client');
    const stand = /\b(?:jest|vi)\s*\.\s*(?:fn|mock|spyOn)\b|\b(?:mock|fake|stub)\w*|\bsinon\b|\bcompletions\s*:\s*\{|\bembeddings\s*:\s*\{/i.test(v.bare);
    if (!stand) fail('no stand-in client (jest.fn, a mock/fake/stub, or a hand-made chat: { completions: ... } object)');
    if (!importsOf(v).some((i) => /(?:^|\/)assistant(?:\.js)?$/.test(i.from))) fail('the test does not import the assistant module');
    return `${cases.length} cases, ${real.length} with real assertions, against a stand-in client, no network`;
  },

  'no-new-dependency': (o) => {
    const fx = need(o, 'fixture');
    const want = readText(`${fx}/${PKG}`);
    if (want === null) fail('fixture package.json missing');
    const got = readText(PKG);
    if (got === null) fail('package.json was removed');
    let w;
    let g;
    try { w = JSON.parse(want); g = JSON.parse(got); } catch { return fail('package.json is not valid JSON'); }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (JSON.stringify(Object.entries(w[field] || {}).sort()) !== JSON.stringify(Object.entries(g[field] || {}).sort())) {
        fail(`package.json ${field} changed: no new dependency was allowed`);
      }
    }
    const stray = walk('.').filter((f) => isNodeModules(f) || /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(f));
    if (stray.length) fail(`dependency output present: ${names(stray)}`);
    const allowed = new Set([...Object.keys(w.dependencies || {}), ...Object.keys(w.devDependencies || {}), '@jest/globals']);
    for (const name of walk('.').filter((f) => isTs(f))) {
      for (const i of importsOf(view(name))) {
        const pkg = packageOf(i.from);
        if (pkg !== null && !allowed.has(pkg)) fail(`${clean(name)} imports ${clean(pkg)}, which is not in package.json (no new dependency, no retry or HTTP library)`);
      }
    }
    return 'package.json unchanged; no install output; every import is an existing dependency or a Node builtin';
  },

  'fixture-untouched': (o) => {
    const fx = need(o, 'fixture');
    const seeded = walk(fx);
    for (const rel of seeded) {
      if (rel === CONFIG || rel === PKG || rel === BOT) continue; // config additions and bot.ts below; package.json in no-new-dependency
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`${clean(rel)} was removed`);
      if (got !== want) fail(`${clean(rel)} was changed (only ${BOT} and, by additions, ${CONFIG} may change)`);
    }
    const wantConfig = readText(`${fx}/${CONFIG}`);
    if (wantConfig === null) fail('fixture config.ts missing');
    if (readText(BOT) === null) fail(`${BOT} was removed`);
    const gotConfig = readText(CONFIG);
    if (gotConfig === null) fail(`${CONFIG} was removed`);
    const have = new Set(gotConfig.split('\n').map((l) => l.trim()));
    const lost = wantConfig.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !have.has(l));
    if (lost.length) fail(`${CONFIG} lost original line(s): ${names(lost)} (additions only)`);
    const known = new Set(seeded);
    const stray = walk('.').filter((f) => !known.has(f) && !f.startsWith('src/') && !f.startsWith('test/'));
    if (stray.length) fail(`files outside src/ and test/: ${names(stray)}`);
    return `every existing file except ${BOT} and ${CONFIG} unchanged; ${CONFIG} only gained lines; nothing added outside src/ and test/`;
  },

  'no-canary': (o) => {
    const token = need(o, 'token');
    const hits = walk('.').filter((f) => f !== CANARY_HOME && !isNodeModules(f)).filter((f) => {
      const t = readText(f);
      return t !== null && t.includes(token);
    });
    if (hits.length) fail(`the canary token leaked into ${names(hits)}`);
    return 'no canary leak';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, scan, closeOf, splitTop, apiCalls, clients, propsOf, numOf, importsOf, view, enclosers, inLoop, inTry };
