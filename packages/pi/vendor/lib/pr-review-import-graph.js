'use strict';

/**
 * pr-review-import-graph.js -- the reverse import graph of a repository head, used to size the
 * blast radius of a delta re-review (kata 801a; docs/plans/pr-review-speedup-plan.md section 3B).
 *
 * Pure: NO shell, NO file reads, NO network. The caller (pr-review-prepare.js, which owns the repo
 * scan) hands in the reference-bearing source lines it found and the list of every tracked path at
 * the head; this module only turns them into `{ schema, importers, testFiles, computed }`:
 *
 *   importers  target path -> sorted paths that reference it. A relative path that resolves to a
 *              tracked file is keyed by that file; one that resolves to nothing (the file was
 *              deleted, or is named with an extension the scan does not know) is keyed by the
 *              normalized path itself, so a deleted module still names its importers.
 *   testFiles  every tracked test file (`*.test.*` / `*.spec.*`), for the stem match.
 *   computed   sorted paths holding a `require` / `import()` / jest module call whose specifier is not a
 *              plain string literal on its line. Such a call names nothing the graph can resolve, so it
 *              is listed here instead of being dropped: the planner asks whether the file's text names a
 *              changed file (`namesFile`).
 *
 * What counts as a reference, stated rather than hidden. EVERY quoted relative path on a scanned line is
 * an edge (`'./x'`, `"../y"`, a template without `${}`), whatever calls it: `require`, `require.resolve`,
 * `jest.requireActual`, `import()`, `import ... from`, `export ... from`, a worker path, the argument line
 * of a call that spans lines. In an HTML file the `src` and `href` values are edges (a `<script src>`).
 * The graph is FILE level: it over-approximates "callers of a changed symbol" by "importers of the
 * changed file", which can only ask a reviewer to read MORE. Bare package specifiers are not edges, and a
 * reference built at run time from nothing the text names (`require(pickOne())`) is not seen at all.
 */

/** Extensions the scan parses for references. `planDeltaReview` falls back to a full re-read for source outside this set it cannot size. */
const ANALYZED_EXTENSIONS = Object.freeze(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.tsx']);
/** Markup the scan reads as well: a `<script src>` or `<link href>` names the file it loads. */
const MARKUP_EXTENSIONS = Object.freeze(['.html', '.htm']);
const SCANNED_EXTENSIONS = Object.freeze([...ANALYZED_EXTENSIONS, ...MARKUP_EXTENSIONS]);
const RESOLVE_EXTENSIONS = Object.freeze([...ANALYZED_EXTENSIONS, '.json']);
/** `.test.js`, `.spec.ts` ... : the names the baseline run of pr-review-prepare.js treats as tests. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SCHEMA = 2;

/** A quoted string on one line, any quote kind, escapes honoured. */
const STRING = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
/** `./x`, `../x`, `.`, `..`: a path that starts from the referencing file. */
const RELATIVE = /^\.\.?(?:\/|$)/;
/** A call that loads a module by specifier: `require`, `require.resolve`, `import()`, jest/vitest's module registry calls (`requireActual`, `mock`, ...). */
const REFERENCE_CALL = /(?:\brequire(?:\.resolve)?|\bimport|\b(?:jest|vi)\.(?:mock|doMock|unmock|dontMock|setMock|requireActual|requireMock|importActual|importMock|createMockFromModule))\s*\(/g;
/** The first argument of such a call when it is a closed string literal followed by `,` or `)`. */
const LITERAL_ARGUMENT = /^(['"`])((?:\\.|(?!\1)[^\\\n])*)\1\s*[,)]/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;
const ATTRIBUTE = /\b(?:src|href)\s*=\s*(['"])([^'"\n]*)\1/gi;
/** A scheme (`https:`, `data:`) or a protocol-relative `//host`: not a file of the repository. */
const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const posix = (value) => value.replace(/\\/g, '/');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isMarkup = (file) => /\.html?$/i.test(file);

function dirname(file) {
  const i = file.lastIndexOf('/');
  return i < 0 ? '' : file.slice(0, i);
}

function basename(file) {
  return file.slice(file.lastIndexOf('/') + 1);
}

/** Normalizes `dir/spec` without leaving the repository; null when the specifier climbs out of the root. */
function joinRelative(dir, spec) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const segment of posix(spec).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length === 0 ? null : parts.join('/');
}

/** The quoted relative paths on one source line, in order. A template with `${}` is not a literal. */
function relativeLiterals(text) {
  const found = [];
  for (const match of text.matchAll(STRING)) {
    const [, quote, body] = match;
    if (quote === '`' && body.includes('${')) continue;
    if (RELATIVE.test(body)) found.push(body);
  }
  return found;
}

/**
 * True when the line holds a module-loading call whose specifier is not a plain string literal: an identifier or an
 * expression, an interpolated template, an argument that starts on the next line. `require()` with nothing in it is prose.
 */
function hasComputedReference(text) {
  if (COMMENT_LINE.test(text)) return false;
  for (const call of text.matchAll(REFERENCE_CALL)) {
    const rest = text.slice(call.index + call[0].length).trimStart();
    if (rest.startsWith(')')) continue;
    const literal = LITERAL_ARGUMENT.exec(rest);
    if (literal === null || (literal[1] === '`' && literal[2].includes('${'))) return true;
  }
  return false;
}

/** The files an HTML line loads: its `src` and `href` values that are not URLs. A value without `./` is relative to the page. */
function markupTargets(text) {
  const found = [];
  for (const match of text.matchAll(ATTRIBUTE)) {
    const value = match[2].replace(/[?#].*$/, '');
    if (value === '' || URL_LIKE.test(value)) continue;
    found.push(value.startsWith('/') || RELATIVE.test(value) ? value : `./${value}`);
  }
  return found;
}

/**
 * What one scanned line references.
 * @param {string} file  The file the line is from.
 * @param {string} text  The line.
 * @returns {{specifiers:string[], computed:boolean}}  `specifiers`: relative paths the graph resolves (a leading `/` in an
 *   HTML file is root-relative); `computed`: a module-loading call with a specifier the line does not give as a plain literal.
 */
function referencesOf(file, text) {
  const specifiers = relativeLiterals(text);
  if (isMarkup(file)) specifiers.push(...markupTargets(text));
  return { specifiers: [...new Set(specifiers)], computed: hasComputedReference(text) };
}

/** The tracked file a normalized specifier path names, or null. */
function resolveTracked(normalized, tracked) {
  if (tracked.has(normalized)) return normalized;
  for (const ext of RESOLVE_EXTENSIONS) if (tracked.has(normalized + ext)) return normalized + ext;
  for (const ext of RESOLVE_EXTENSIONS) if (tracked.has(`${normalized}/index${ext}`)) return `${normalized}/index${ext}`;
  // TypeScript names the compiled extension in the specifier: './x.js' means './x.ts'.
  const compiled = /^(.*)\.(?:js|mjs|cjs)$/.exec(normalized);
  if (compiled !== null) {
    for (const ext of ['.ts', '.tsx']) if (tracked.has(compiled[1] + ext)) return compiled[1] + ext;
  }
  return null;
}

/**
 * @param {Object} input
 * @param {string[]} input.filePaths  Every tracked path at the head.
 * @param {Array<{path:string, text:string}>} input.lines  The reference-bearing source lines the scan found.
 * @returns {{schema:2, importers:Object<string,string[]>, testFiles:string[], computed:string[]}}
 */
function buildImportGraph(input) {
  const filePaths = isObject(input) && Array.isArray(input.filePaths) ? input.filePaths.filter(isText) : [];
  const lines = isObject(input) && Array.isArray(input.lines) ? input.lines : [];
  const tracked = new Set(filePaths);
  const edges = new Map();
  const computed = new Set();

  for (const line of lines) {
    if (!isObject(line) || !isText(line.path) || typeof line.text !== 'string') continue;
    const references = referencesOf(line.path, line.text);
    if (references.computed) computed.add(line.path);
    for (const spec of references.specifiers) {
      const normalized = joinRelative(spec.startsWith('/') ? '' : dirname(line.path), spec);
      if (normalized === null) continue;
      const target = resolveTracked(normalized, tracked) || normalized;
      if (target === line.path) continue;
      if (!edges.has(target)) edges.set(target, new Set());
      edges.get(target).add(line.path);
    }
  }

  const importers = {};
  for (const target of [...edges.keys()].sort()) importers[target] = [...edges.get(target)].sort();
  return { schema: SCHEMA, importers, testFiles: filePaths.filter((file) => TEST_FILE.test(file)).sort(), computed: [...computed].sort() };
}

/** True for a graph `buildImportGraph` could have produced: the planner never trusts a half-read one. */
function isImportGraph(value) {
  if (!isObject(value) || value.schema !== SCHEMA || !isObject(value.importers)) return false;
  if (!Array.isArray(value.testFiles) || !value.testFiles.every(isText)) return false;
  if (!Array.isArray(value.computed) || !value.computed.every(isText)) return false;
  return Object.values(value.importers).every((list) => Array.isArray(list) && list.every(isText));
}

/** The graph keys a changed path may be filed under: itself, without its extension, and the directory of an index file. */
function targetKeys(file) {
  const keys = [file];
  const noExt = file.replace(/\.[^./]+$/, '');
  if (noExt !== file) keys.push(noExt);
  if (/^index$/.test(basename(noExt))) {
    const dir = dirname(noExt);
    if (dir !== '') keys.push(dir);
  }
  return keys;
}

/** The test-file stem match pr-review-prepare.js uses: `thing.js` is tested by `thing.test.js`, `thing.spec.ts`. */
function stemOf(file) {
  return basename(file).replace(/\.[^.]+$/, '');
}

function testStemOf(file) {
  return basename(file).replace(/\.(?:test|spec)\.[^.]+$/, '');
}

/** The stem a changed non-test file is matched to tests by: `thing.js` -> `thing`; jest's `__snapshots__/thing.test.js.snap` -> `thing`, the test that owns it. */
function ownerStemOf(file) {
  const name = basename(file);
  return /\.snap$/.test(name) ? testStemOf(name.slice(0, -'.snap'.length)) : stemOf(file);
}

/** The name a file is mentioned by: its stem, and the extensions a mention of it may carry (a TypeScript file is named `./x.js`). */
function nameOf(file) {
  const name = basename(file);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, extensions: [] };
  const extension = name.slice(dot);
  return { stem: name.slice(0, dot), extensions: ANALYZED_EXTENSIONS.includes(extension) ? ANALYZED_EXTENSIONS : [extension] };
}

/**
 * Fixed strings every mention of any of `files` contains, for `git grep -F`. A prefilter only: `namesFile` decides.
 * @param {string[]} files
 * @returns {string[]}
 */
function mentionNeedles(files) {
  const stems = [...new Set(files.map((file) => nameOf(file).stem))].sort();
  return stems.flatMap((stem) => [`/${stem}`, `'${stem}`, `"${stem}`, `\`${stem}`]);
}

/**
 * Does this line of code name `file` -- by a path that ends in its name (`/thing`, `/thing.js`, in a require, an
 * interpolated template, a path.join, a script tag) or by a quoted file name (`'thing.js'`)? A bare word is not a mention
 * (`'index'` is a string, `index.js` is a file), and neither is `thing.test.js` for `thing.js`. Directory-blind on purpose:
 * it over-approximates, so a reviewer reads more, never less.
 * @param {string} text
 * @param {string} file
 * @returns {boolean}
 */
function namesFile(text, file) {
  if (typeof text !== 'string' || !isText(file)) return false;
  const { stem, extensions } = nameOf(file);
  const stemPattern = escapeRegExp(stem);
  const extension = extensions.map(escapeRegExp).join('|');
  const word = '(?![\\w-])';
  const pathLike = extension === ''
    ? new RegExp(`/${stemPattern}(?![\\w-]|\\.\\w)`)
    : new RegExp(`/${stemPattern}(?:(?:${extension})${word}|(?![\\w-]|\\.\\w))`);
  if (pathLike.test(text)) return true;
  return extension !== '' && new RegExp(`['"\`]${stemPattern}(?:${extension})${word}`).test(text);
}

module.exports = {
  buildImportGraph,
  isImportGraph,
  referencesOf,
  namesFile,
  mentionNeedles,
  targetKeys,
  stemOf,
  testStemOf,
  ownerStemOf,
  ANALYZED_EXTENSIONS,
  SCANNED_EXTENSIONS,
  TEST_FILE,
  SCHEMA,
};
