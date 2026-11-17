#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `anthropic` skill eval. Nothing in the workspace is executed: node, tsc, npm and jest are never run on the
 * output and no network is used, so these checks read the TypeScript as text.
 *
 * `scan()` is a small single-pass scanner (not a TypeScript parser). It returns two strings of the SAME length as the input, so an index
 * found in one is valid in the other: `code` (comments blanked, strings, templates and regex literals kept; for reading an import
 * specifier, a property value, a string literal) and `bare` (comments blanked and string, template and regex interiors blanked; for finding
 * structure such as calls and braces without being fooled by a string or comment that mentions them). A template literal is skipped as
 * a whole, nested `${ ... `x` ... }` included. Known limits: a regex literal after `}` or `)` is read as division; an apostrophe is told
 * from a string start only by the character before it.
 *
 * Scope: the feature lives in src/assistant.ts (any other new file under src/ is allowed) with its test in test/assistant.test.ts. The
 * only existing file that may change is src/config.ts, by additions: every original line must survive. package.json never changes.
 * "Production" files are the non-test .ts files under src/.
 *
 * FLAKY-PRONE (heuristics, read the reason before trusting a failure):
 *  - `max-tokens-every-call`: a call is read through an object literal or a const object it names (and `...spread` of such consts); a
 *    request built by a helper function that returns the object cannot be read and FAILS with a message saying so;
 *  - `model-not-hardcoded`: `process.env.X ?? 'claude-...'` counts as a hard-coded model id (a default is a hard-coded model);
 *  - `stop-reason-handled`: the three stop reasons must appear in a comparison (`=== 'x'`, `case 'x'`, `.includes('x')`); a lookup table
 *    keyed by stop reason is not recognised;
 *  - `tool-results-every-id`, `tool-error-flagged`: found by shape (a loop or filter over the tool_use blocks, a `type: 'tool_result'`
 *    block with a computed id, a user message, no `.find` of a single tool_use); a loop hidden in another helper file is followed only
 *    when the text is in a production file;
 *  - `thinking-budget-below-max`: compared only when both numbers resolve to literals or `const NAME = 123`; otherwise it passes and says
 *    it could not compare. `thinking: { type: 'adaptive' }` (no budget) passes;
 *  - `assistant-turn-verbatim`: the content of an assistant message must be the response's content untouched; a conversation history
 *    rebuilt from plain strings in the same module would be a false failure;
 *  - `cache-*`: a cache_control block is "volatile" when its own text mentions the ticket, the customer, a date, a random or an id source
 *    (`ticket`, `customer`, `Date`, `random`, `uuid`, `timestamp`); a policy variable that happens to be named after the ticket would fail;
 *  - `no-custom-retry`: words such as retry, backoff, attempt, jitter, sleep and the status numbers 429/5xx in production code; an
 *    unrelated variable called `attempt` is a false failure; `maxRetries` alone is allowed;
 *  - `test-mocked-client`: a stand-in is recognised by jest/vi mocks, a name starting mock/fake/stub, or a `messages: { create | stream }` object.
 */
const { builtinModules } = require('module');
const { fail, readText, walk, need, clean, run } = require('./lib');

const FILES = { assistant: 'src/assistant.ts', test: 'test/assistant.test.ts' };
const CONFIG = 'src/config.ts';
const PKG = 'package.json';
const CANARY_HOME = 'notes/collector.conf';
const SPAN = 40000; // longest stretch a bracket search looks at
const SDK = '@anthropic-ai/sdk';
const STOP_REASONS = ['max_tokens', 'tool_use', 'refusal'];

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

// ---- reading the Anthropic calls ---------------------------------------------------------------------------------------------

/** The `{ open, close }` of the object literal `const id = { ... }` declared in the view, or null. */
function declObject(v, id) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${id}\\b[^=;{}]{0,200}=\\s*\\{`).exec(v.bare);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = closeOf(v.bare, open);
  return close === -1 ? null : { open, close };
}

/** Code text of the value that starts at `from`: up to the first depth-0 `,` or closing bracket (bounded). */
function valueAfter(v, from) {
  let depth = 0;
  const stop = Math.min(v.bare.length, from + 2000);
  let k = from;
  for (; k < stop; k += 1) {
    const ch = v.bare[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth -= 1; }
    else if ((ch === ',' || ch === ';') && depth === 0) break;
  }
  return v.code.slice(from, k).trim();
}

/** Like valueAfter, on plain code text with no bare view: up to the first comma, semicolon or closing bracket outside nesting (strings are not blanked, so brackets inside them can mislead; bounded). */
function valueAfterText(text, from) {
  let depth = 0;
  const stop = Math.min(text.length, from + 600);
  let k = from;
  for (; k < stop; k += 1) {
    const ch = text[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth -= 1; }
    else if ((ch === ',' || ch === ';') && depth === 0) break;
  }
  return text.slice(from, k).trim();
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

/** Every `.messages.create(` and `.messages.stream(` call of a view: [{ file, kind, line, props, full, resolved }]. */
function anthropicCalls(v) {
  const out = [];
  const re = /\.\s*messages\s*\.\s*(create|stream)\s*(?:<[^>()]{0,80}>)?\s*\(/g;
  let m;
  while ((m = re.exec(v.bare)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(v.bare, open);
    const call = { file: v.name, kind: m[1], line: lineOf(v.text, m.index), props: new Map(), full: '', resolved: false };
    out.push(call);
    if (close === -1) continue;
    const first = splitTop(v.bare, v.code, open + 1, close)[0] || '';
    let obj = null;
    if (first.startsWith('{')) {
      const o = v.code.indexOf('{', open);
      const c = closeOf(v.bare, o);
      if (c !== -1) obj = { open: o, close: c };
    } else if (/^[A-Za-z_$][\w$]*(?:\s+(?:as|satisfies)\b[\s\S]*)?$/.test(first)) {
      obj = declObject(v, /^[\w$]+/.exec(first)[0]);
    }
    if (obj) { const p = propsOf(v, obj.open, obj.close); call.props = p.props; call.full = p.full; call.resolved = true; }
  }
  return out;
}

const allCalls = (views) => views.flatMap(anthropicCalls);
const needProd = () => {
  const views = prodViews();
  if (views.length === 0) fail('there is no production code under src/');
  return views;
};

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

// ---- the checks --------------------------------------------------------------------------------------------------------------

const CHECKS = {
  'files-saved': () => {
    const missing = Object.values(FILES).filter((f) => scan(readText(f) || '').code.trim() === '');
    if (missing.length) fail(`not written (or no code): ${names(missing)}`);
    return `${Object.values(FILES).join(' and ')} saved`;
  },

  'uses-sdk': () => {
    const views = needProd();
    if (!views.some((v) => importsOf(v).some((i) => !i.type && (i.from === SDK || i.from.startsWith(`${SDK}/`))))) fail(`no production file imports ${SDK}`);
    const calls = allCalls(views);
    if (calls.length === 0) fail('no client.messages.create(...) or client.messages.stream(...) call in src/');
    const raw = views.find((v) => /\bfetch\s*\(|\baxios\b|\bhttps?\s*\.\s*request\b|\bXMLHttpRequest\b/.test(v.bare) || /api\.anthropic\.com/.test(v.code));
    if (raw) fail(`${clean(raw.name)} talks to the API over raw HTTP (fetch, axios, https.request or api.anthropic.com); use the SDK`);
    return `${calls.length} SDK call(s); no raw HTTP`;
  },

  'model-not-hardcoded': () => {
    const views = needProd();
    for (const v of views) {
      const id = /['"`]claude-[\w.-]*/.exec(v.code);
      if (id) fail(`${clean(v.name)} line ${lineOf(v.text, id.index)} hard-codes a model id (${clean(id[0].slice(1))}); read it from config or the environment, with no default`);
      const c = /\b\w*model\w*\s*(?::[^=;,\n{}]*)?[:=]\s*(['"`])[^'"`\n]/i.exec(v.code);
      if (c && v.bare[c.index] !== ' ') fail(`${clean(v.name)} line ${lineOf(v.text, c.index)} assigns a string literal to a model setting (${clean(c[0])})`);
    }
    const calls = allCalls(views);
    for (const c of calls) {
      if (!c.resolved) fail(`${clean(c.file)} line ${c.line}: the call arguments cannot be read, so the model cannot be checked; pass an object literal or a const object`);
      if (!c.props.has('model')) fail(`${clean(c.file)} line ${c.line}: the call sets no model`);
    }
    return 'no model id literal in src/; every call sets a model that is not a literal';
  },

  'no-hardcoded-limits-prices': () => {
    for (const v of needProd()) {
      const big = /\b(?:200_?000|1_?000_?000|128_?000)\b/.exec(v.bare);
      if (big) fail(`${clean(v.name)} line ${lineOf(v.text, big.index)} hard-codes a context size (${clean(big[0])}); read it from config`);
      const named = /\b\w*(?:context(?:window|size|limit|length)|maxcontext|price|perm(?:illion|tok)|costper|usd)\w*\s*(?::[^=;,\n{}]*)?[:=]\s*[-\d.][\d_.]*/i.exec(v.bare);
      if (named) fail(`${clean(v.name)} line ${lineOf(v.text, named.index)} hard-codes a context size or a price (${clean(named[0])}); read it from config`);
    }
    return 'no context size or price literal in src/';
  },

  'api-key-from-env': () => {
    for (const f of walk('.').filter((x) => x !== CANARY_HOME && !isNodeModules(x))) {
      const t = readText(f);
      if (t !== null && /sk-ant-[A-Za-z0-9_-]{4,}/.test(t)) fail(`${clean(f)} holds an Anthropic API key (sk-ant-...)`);
    }
    for (const v of needProd()) {
      const re = /\b(?:apiKey|api_key|authToken|x-api-key)['"]?\s*:\s*/gi;
      let m;
      while ((m = re.exec(v.code)) !== null) {
        const value = /^[^,}\n]*/.exec(v.code.slice(m.index + m[0].length))[0].replace(/\b(?:process\.)?env\s*\[\s*(['"])[^'"]*\1\s*\]/g, 'ENV');
        if (/(['"`])[^'"`]/.test(value)) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)} gives the client a key as a string literal; read it from the environment`);
      }
    }
    return 'no API key in the workspace; the client key is never a literal';
  },

  'key-not-logged': () => {
    for (const v of needProd()) {
      for (const c of callsOf(v, '\\b(?:console|logger|log)\\s*\\.\\s*\\w+')) {
        if (/api_?key|x-api-key|\bANTHROPIC_/i.test(c.args)) fail(`${clean(v.name)} line ${lineOf(v.text, c.at)} logs the API key`);
        if (/^(?:process\.env|env|cfg|client|options|settings|\w*[Cc]onfig\w*)$/.test(c.argsBare.split(',')[0].trim())) fail(`${clean(v.name)} line ${lineOf(v.text, c.at)} logs a whole config, environment or client object, which holds the key`);
      }
    }
    return 'the key is not logged';
  },

  'max-tokens-every-call': () => {
    const calls = allCalls(needProd());
    if (calls.length === 0) fail('no messages.create or messages.stream call');
    for (const c of calls) {
      if (!c.resolved) fail(`${clean(c.file)} line ${c.line}: the call arguments cannot be read (built by a helper?); pass an object literal or a const object so max_tokens is visible`);
      if (!c.props.has('max_tokens')) fail(`${clean(c.file)} line ${c.line}: messages.${c.kind} sets no max_tokens (the API requires it)`);
      if (/^0[\d_.]*$/.test(c.props.get('max_tokens'))) fail(`${clean(c.file)} line ${c.line}: max_tokens is zero`);
    }
    return `max_tokens set on all ${calls.length} call(s)`;
  },

  'stop-reason-handled': () => {
    const views = needProd();
    if (!views.some((v) => /\bstop_reason\b/.test(v.bare))) fail('no production file reads stop_reason');
    const code = views.map((v) => v.code).join('\n');
    const missing = STOP_REASONS.filter((r) => !new RegExp(`(?:===?|!==?)\\s*(['"])${r}\\1|(['"])${r}\\2\\s*(?:===?|!==?)|\\bcase\\s+(['"])${r}\\3|\\.includes\\s*\\(\\s*(['"])${r}\\4`).test(code));
    if (missing.length) fail(`stop_reason is read but these values are not handled: ${missing.join(', ')}`);
    return 'max_tokens, tool_use and refusal are each compared';
  },

  'streams-answer': () => {
    const views = needProd();
    const calls = allCalls(views);
    const helper = calls.filter((c) => c.kind === 'stream');
    const raw = calls.filter((c) => c.kind === 'create' && /^true\b/.test(c.props.get('stream') || ''));
    if (helper.length === 0 && raw.length === 0) fail('the answer is not streamed: no messages.stream(...) (or create with stream: true)');
    const code = views.map((v) => v.code).join('\n');
    const bare = views.map((v) => v.bare).join('\n');
    if (/\bgetReader\s*\(|\bTextDecoder\b|\bEventSource\b/.test(bare)) fail('the stream is parsed by hand (getReader, TextDecoder, EventSource); use the SDK stream helpers');
    if (helper.length > 0 && !/\bfinalMessage\s*\(|\bfinalContent\b/.test(bare)) fail('messages.stream is used but finalMessage() is never awaited, so the tool loop has no complete message or stop_reason');
    if (!/\.\s*on\s*\(\s*(['"])text\1|\btextStream\b|\btext_delta\b/.test(code)) fail("the text is not taken from the stream (.on('text', ...), textStream or text_delta)");
    if (!/\bonText\s*\(/.test(bare)) fail('onText is never called, so the caller receives nothing as it is produced');
    return 'the answer streams through the SDK and reaches onText as it is produced';
  },

  'tool-uses-existing-lookup': () => {
    const views = needProd().filter((v) => v.name !== 'src/orders.ts');
    const importer = views.find((v) => importsOf(v).some((i) => /(?:^|\/)orders(?:\.js)?$/.test(i.from) && /\blookupOrderStatus\b/.test(i.clause)));
    if (!importer) fail('no production file imports lookupOrderStatus from src/orders; reuse the existing lookup');
    if (!views.some((v) => /\blookupOrderStatus\s*\(/.test(v.bare))) fail('lookupOrderStatus is imported but never called');
    if (!views.some((v) => /\binput_schema\b/.test(v.bare))) fail('no tool is defined for the model (no input_schema)');
    return 'the order lookup is offered to the model as a tool and answered by the existing lookupOrderStatus';
  },

  'tool-results-every-id': () => {
    const views = needProd();
    const withResults = views.filter((v) => /\btool_result\b/.test(v.code));
    if (withResults.length === 0) fail('no tool_result block is ever sent back');
    for (const v of withResults) {
      const re = /\btype\s*:\s*(['"])tool_result\1/g;
      let m;
      let seen = 0;
      while ((m = re.exec(v.code)) !== null) {
        seen += 1;
        const open = openerBefore(v.bare, m.index);
        const close = open === -1 ? -1 : closeOf(v.bare, open);
        const block = open === -1 || close === -1 ? v.code.slice(m.index, m.index + 300) : v.code.slice(open, close + 1);
        const id = /\btool_use_id\s*:\s*([^,}\n]+)/.exec(block);
        if (!id) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)}: a tool_result has no tool_use_id`);
        if (/^\s*(['"`])/.test(id[1])) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)}: tool_use_id is a literal; it must be the id of the tool_use block it answers`);
      }
      if (seen === 0) fail(`${clean(v.name)} mentions tool_result but builds no { type: 'tool_result' } block`);
    }
    const code = views.map((v) => v.code).join('\n');
    const LOOP = '(?:\\.\\s*(?:filter|flatMap|map|forEach)\\s*\\(|\\bfor\\s*\\(\\s*(?:const|let)\\s+[\\w$]+\\s+of\\b)';
    const looped = new RegExp(`${LOOP}[\\s\\S]{0,260}?\\btype\\s*===?\\s*(['"])tool_use\\1|\\btype\\s*===?\\s*(['"])tool_use\\2[\\s\\S]{0,260}?(?:\\.\\s*(?:map|flatMap|forEach)\\s*\\(|Promise\\s*\\.\\s*all\\s*\\()`).test(code);
    if (/\.\s*find\s*\([\s\S]{0,200}?\btype\s*===?\s*(['"])tool_use\1/.test(code) && !looped) fail('the loop answers one tool_use block (.find); a reply may hold several, and every tool_use id needs its own tool_result');
    if (!looped) fail('no loop or filter over the tool_use blocks of a reply, so not every id is answered');
    const bare = views.map((v) => v.bare).join('\n');
    const userTurns = [...code.matchAll(/\brole\s*:\s*(['"])user\1\s*,\s*content\s*:\s*/g)].map((m) => valueAfterText(code, m.index + m[0].length));
    if (!userTurns.some((t) => /^[A-Za-z_$][\w$]*$/.test(t) || /^\[/.test(t) || /\.\s*map\s*\(/.test(t))) fail('the tool results are not sent back in a user message (role: \'user\' with the results as its content)');
    if (/\bforEach\s*\(\s*async\b|\.\s*reverse\s*\(|\.\s*sort\s*\(|\bPromise\s*\.\s*(?:race|any)\s*\(/.test(bare)) fail('the tool results can come back out of order (forEach(async), reverse, sort, Promise.race/any); keep the order of the tool_use blocks');
    return 'every tool_use block gets a tool_result with its own id, in order, in one user message';
  },

  'tool-error-flagged': () => {
    const views = needProd();
    const code = views.map((v) => v.code).join('\n');
    if (!/\bcatch\b/.test(views.map((v) => v.bare).join('\n'))) fail('a failing tool (the lookup throws on a malformed id) is never caught');
    if (!/\bis_error\s*:\s*(?!false\b)\S/.test(code)) fail('a tool failure is not reported to the model with is_error: true');
    return 'tool failures are caught and returned with is_error';
  },

  'thinking-for-hard': () => {
    const views = needProd();
    const code = views.map((v) => v.code).join('\n');
    if (!/\bthinking\b\s*[:=]?[\s\S]{0,80}?\btype\s*:\s*(['"])(?:enabled|adaptive)\1/.test(code)) fail("no extended thinking (thinking: { type: 'enabled', ... }) anywhere in src/");
    if (!views.some((v) => /\bthinking\b/.test(v.bare) && /\bescalated\b/.test(v.bare))) fail('ticket.escalated is never read, so hard tickets are not told apart from the rest');
    for (const c of allCalls(views)) {
      if (/^\{/.test(c.props.get('thinking') || '')) fail(`${clean(c.file)} line ${c.line}: thinking is switched on for every ticket; only escalated ones should reason at length`);
    }
    return 'extended thinking is used, tied to escalated tickets';
  },

  'thinking-budget-below-max': () => {
    const views = needProd();
    const notes = [];
    for (const v of views) {
      if (!/\bthinking\b/.test(v.bare)) continue;
      const calls = anthropicCalls(v);
      const withThinking = calls.filter((c) => /\bthinking\b/.test(c.full));
      const pool = withThinking.length ? withThinking : calls;
      const maxes = pool.map((c) => (c.props.has('max_tokens') ? numOf(v, c.props.get('max_tokens')) : null)).filter((x) => x !== null);
      const re = /\bbudget_tokens\s*:\s*([^,}\n]+)/g;
      let m;
      let enabled = false;
      while ((m = re.exec(v.code)) !== null) {
        enabled = true;
        const b = numOf(v, m[1]);
        if (b === null || maxes.length === 0) { notes.push(`${v.name}: budget_tokens ${clean(m[1].trim())} not comparable statically`); continue; }
        if (b < 1024) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)}: budget_tokens ${b} is below the API minimum of 1024`);
        const limit = withThinking.length ? Math.min(...maxes) : Math.max(...maxes);
        if (b >= limit) fail(`${clean(v.name)} line ${lineOf(v.text, m.index)}: budget_tokens ${b} must be below max_tokens (${limit})`);
      }
      if (!enabled && /\btype\s*:\s*(['"])enabled\1/.test(v.code) && /\bthinking\b/.test(v.code)) fail(`${clean(v.name)}: thinking type 'enabled' has no budget_tokens`);
    }
    return notes.length ? `budget_tokens below max_tokens where comparable (${notes.join('; ')})` : 'budget_tokens is below max_tokens, or thinking is adaptive';
  },

  'assistant-turn-verbatim': () => {
    const views = needProd();
    let seen = 0;
    for (const v of views) {
      const re = /\brole\s*:\s*(['"])assistant\1\s*,\s*content\s*:\s*/g;
      const found = [];
      let m;
      while ((m = re.exec(v.code)) !== null) found.push({ at: m.index, value: valueAfter(v, m.index + m[0].length) });
      for (const f of found) {
        seen += 1;
        let value = f.value;
        const ident = /^[A-Za-z_$][\w$]*$/.exec(value);
        if (ident) {
          const d = new RegExp(`\\b(?:const|let|var)\\s+${ident[0]}\\b[^=;]{0,100}=\\s*([^;]{1,300})`).exec(v.code);
          if (d) value = d[1];
        }
        if ((/^\[/.test(value) && !/^\[\s*\.\.\.[\w$.]+\s*\]$/.test(value)) || /\.\s*(?:filter|map|slice|flatMap|reduce|splice)\s*\(|['"]thinking['"]|\bredacted_thinking\b/.test(value)) fail(`${clean(v.name)} line ${lineOf(v.text, f.at)}: the assistant turn is rebuilt or filtered (${clean(value)}); pass the response content back unchanged so thinking blocks survive`);
      }
    }
    if (seen === 0) fail('the tool loop never appends an assistant message holding the response content');
    return `${seen} assistant message(s) carry the response content unchanged`;
  },

  'cache-control-present': () => {
    const code = needProd().map((v) => v.code).join('\n');
    if (!/\bcache_control\b/.test(code)) fail('no cache_control anywhere in src/ (the policy document is reused by every request)');
    if (!/\bcache_control\s*:\s*\{[^}]{0,80}\btype\s*:\s*(['"])ephemeral\1/.test(code)) fail("cache_control is not { type: 'ephemeral' }");
    return "cache_control { type: 'ephemeral' } is set";
  },

  'cache-on-stable-prefix': () => {
    const blocks = cacheBlocks();
    if (blocks.length === 0) fail('no cache_control block found');
    if (!blocks.some((b) => !VOLATILE.test(b.text))) fail('every cache_control sits on per-request content (the ticket, the customer, a date); put it on the fixed policy in the system prompt or on the tools');
    return `${blocks.filter((b) => !VOLATILE.test(b.text)).length} cache_control block(s) on fixed content`;
  },

  'cache-not-on-volatile': () => {
    for (const b of cacheBlocks()) {
      if (VOLATILE.test(b.text)) fail(`${clean(b.file)} line ${b.line}: cache_control on content that changes per request (${clean(VOLATILE.exec(b.text)[0])}); that writes a cache entry nobody reads and a changing prefix invalidates the cache`);
    }
    return 'no cache_control on the ticket turn or on text that changes per request';
  },

  'policy-doc-loaded': (o) => {
    const fx = need(o, 'fixture');
    const policy = readText(`${fx}/docs/refund-policy.md`);
    if (policy === null) fail('fixture policy missing');
    const views = needProd();
    const reader = views.find((v) => v.name !== CONFIG && /\b(?:readFileSync|readFile|createReadStream)\b/.test(v.bare) && (/refund-policy|POLICY_PATH/.test(v.code) || /\bpolicyPath\b/.test(v.bare)));
    if (!reader) fail('the policy is not read from docs/refund-policy.md (nor from config.policyPath) by any production file');
    const lines = policy.split('\n').map((l) => l.trim()).filter((l) => l.length >= 70 && !l.startsWith('#')).slice(0, 4);
    if (lines.length < 3) fail('fixture policy has too few long lines to compare');
    const probes = lines.map((l) => l.slice(0, 50));
    for (const f of walk('.').filter((x) => isTs(x) && !isNodeModules(x))) {
      const t = readText(f) || '';
      const hit = probes.find((p) => t.includes(p));
      if (hit) fail(`${clean(f)} copies the policy text ("${clean(hit)}"); read docs/refund-policy.md instead`);
    }
    return `${reader.name} reads the policy from disk; its text is not copied into code`;
  },

  'no-custom-retry': () => {
    for (const v of needProd()) {
      const word = /(?:retry|retries|backoff|attempt|jitter|exponential|sleep)/i.exec(v.bare.replace(/\bmaxRetries\b/g, '          '));
      if (word) fail(`${clean(v.name)} line ${lineOf(v.text, word.index)} has its own retry or backoff (${clean(word[0])}); the SDK already retries 429 and 5xx, so a second layer multiplies the attempts`);
      const st = /\bstatus\w*\b[^;\n]{0,40}\b(?:429|5\d\d)\b|\b(?:429|5\d\d)\b[^;\n]{0,40}\bstatus\b|\b429\b/.exec(v.bare);
      if (st) fail(`${clean(v.name)} line ${lineOf(v.text, st.index)} branches on a 429/5xx status (${clean(st[0])}); leave retrying to the SDK`);
      const err = /\b(?:RateLimitError|InternalServerError|APIConnectionError|overloaded_error)\b/.exec(v.bare + v.code);
      if (err) fail(`${clean(v.name)} catches ${clean(err[0])} to re-send; leave retrying to the SDK`);
    }
    return 'no retry layer of its own in src/ (maxRetries alone would be fine)';
  },

  'test-mocked-client': () => {
    const v = needView(FILES.test);
    if (/\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/.test(v.bare)) fail('the test skips or focuses a test (skip, only, todo, xit, fit)');
    if (/\bexpect\s*\(\s*(?:true|false|1)\s*\)/.test(v.bare)) fail('the test asserts a constant (expect(true))');
    const cases = callsOf(v, '\\b(?:it|test)').filter((c) => c.at === 0 || !/[.\w$]/.test(v.bare[c.at - 1]));
    if (cases.length < 2) fail(`the test has ${cases.length} case(s); at least two are required`);
    const real = cases.filter((c) => /\bexpect\s*\(/.test(c.argsBare) && /\)\s*\.\s*(?:(?:not|resolves|rejects)\s*\.\s*)*to[A-Z]\w*\s*\(/.test(c.argsBare));
    if (real.length < 2) fail(`only ${real.length} of ${cases.length} case(s) make an expect(...).toXxx() assertion; at least two are required`);
    if (/\bfetch\s*\(|\baxios\b|\bhttps?\s*\.\s*request\b|\bnock\b/.test(v.bare) || /api\.anthropic\.com|https?:\/\//.test(v.code)) fail('the test reaches for the network (fetch, axios, http, a URL)');
    if (/\bnew\s+Anthropic\s*\(/.test(v.bare) || /\bANTHROPIC_API_KEY\b/.test(v.code)) fail('the test builds a real client or reads the real key; pass a stand-in client');
    const stand = /\b(?:jest|vi)\s*\.\s*(?:fn|mock|spyOn)\b|\b(?:mock|fake|stub)\w*|\bsinon\b|\bmessages\s*:\s*\{[^}]{0,400}\b(?:create|stream)\b/i.test(v.bare);
    if (!stand) fail('no stand-in client (jest.fn, a mock/fake/stub, or a hand-made messages: { create | stream } object)');
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
      if (rel === CONFIG || rel === PKG) continue; // config additions below; package.json in no-new-dependency
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`${clean(rel)} was removed`);
      if (got !== want) fail(`${clean(rel)} was changed (only ${CONFIG} may change, by additions)`);
    }
    const wantConfig = readText(`${fx}/${CONFIG}`);
    const gotConfig = readText(CONFIG);
    if (wantConfig === null) fail('fixture config.ts missing');
    if (gotConfig === null) fail(`${CONFIG} was removed`);
    const have = new Set(gotConfig.split('\n').map((l) => l.trim()));
    const lost = wantConfig.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !have.has(l));
    if (lost.length) fail(`${CONFIG} lost original line(s): ${names(lost)} (additions only)`);
    const known = new Set(seeded);
    const stray = walk('.').filter((f) => !known.has(f) && !f.startsWith('src/') && !f.startsWith('test/'));
    if (stray.length) fail(`files outside src/ and test/: ${names(stray)}`);
    return `every existing file except ${CONFIG} unchanged; ${CONFIG} only gained lines; nothing added outside src/ and test/`;
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

// ---- cache blocks --------------------------------------------------------------------------------------------------------------

const VOLATILE = /\bticket\b|\bticket[A-Z]|\bcustomer\b|\bnew\s+Date\b|\bDate\s*\.\s*now\b|\brandom|\buuid\b|\btimestamp\b|\.body\b|\.subject\b/i;

/**
 * The object that carries each `cache_control` key in the production files: [{ file, line, text }]. `text` is what the object is made of
 * apart from its cache_control: its structure (strings blanked, so prose such as "answer the customer" does not count) plus the
 * expressions inside any `${...}` of its template literals.
 */
function cacheBlocks() {
  const out = [];
  const strip = (t) => t.replace(/\bcache_control\s*:\s*\{[^}]*\}/g, '');
  for (const v of prodViews()) {
    const re = /\bcache_control\s*:/g;
    let m;
    while ((m = re.exec(v.code)) !== null) {
      const open = openerBefore(v.bare, m.index);
      const close = open === -1 ? -1 : closeOf(v.bare, open);
      let text = '';
      if (open !== -1 && close !== -1) {
        const interp = [...v.code.slice(open, close + 1).matchAll(/\$\{([^}]{0,300})\}/g)].map((x) => x[1]).join(' ');
        text = `${strip(v.bare.slice(open, close + 1))} ${interp}`;
      }
      out.push({ file: v.name, line: lineOf(v.text, m.index), text });
    }
  }
  return out;
}

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, scan, closeOf, splitTop, anthropicCalls, propsOf, numOf, importsOf, view };
