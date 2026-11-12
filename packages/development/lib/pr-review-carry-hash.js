'use strict';

/**
 * pr-review-carry-hash.js -- the deterministic producer of the hashes `planCarry` (pr-review-carry.js, kata qw98) consumes.
 * `prepare` computes no hunk or dependency hash, so without this module an orchestrator could not supply them.
 *
 * It shells out to git (through injectable `deps.git`, the runner of review-prepare-runtime.js `defaultDeps()` that
 * pr-review-prepare.js takes), so it is a module of its own and NOT part of the pure pr-review-cli.js.
 *
 *   hashCitations({ repoRoot?, headSha, citations:[{ id?, file, line?, lines?:[start,end], claim? }] }, deps?)
 *     -> { ok, headSha, candidates:[{ ...the citation verbatim, headSha, hunkHash?, depHashes?, dependents?, hashError? }] }
 *     (a `hashError` candidate carries none of hunkHash, depHashes, dependents. EVERY candidate, that one included, carries
 *     `headSha`, the head it was hashed at: `planCarry` and `recordVerdicts` refuse a candidate stamped with any other head)
 *
 * Everything is read AT `headSha` from git objects (`git ls-tree -r` for the tracked paths, `git cat-file --batch` for blob
 * bytes), never from the working tree. Subprocess count is small: one ls-tree plus one cat-file per closure level, blobs
 * cached by path for the whole call.
 *
 * hunkHash  sha256 hex of the cited lines (`line`, or `lines` = [start, end], 1-based inclusive) widened by CONTEXT_LINES (3)
 *           lines on each side (clamped to the file), joined with '\n' (UTF-8). A trailing newline does not add a line.
 * depHashes `{ path: sha256 hex of that file's blob bytes at the head }` for the TRANSITIVE closure of the cited file's
 *           relative imports. References are read exactly as pr-review-import-graph.js `buildImportGraph` does: `referencesOf`
 *           per line, specifier joined to the referencing file's directory (a leading '/' is root-relative) and resolved
 *           against the tracked paths with `resolveTracked`. The cited file itself is never in its own depHashes. Only files
 *           of the analyzed/markup types are read for further references; a `.json` or other data file is hashed, not scanned.
 *           A documentation/data cited file (isSizeable, not analyzed) has `depHashes: {}`.
 *
 * FAIL CLOSED: a citation that cannot be hashed gets NO hunkHash and NO depHashes plus `hashError` (planCarry reads a missing
 * hash as 'hash-missing' => re-verify). Causes: file absent at head, no/invalid line or range (outside the file), the cited
 * file or a closure member holds a computed specifier or is a symlink or names a specifier that passes through a symlinked
 * directory or a submodule, the cited path itself passes through one, the tracked closure exceeds MAX_CLOSURE (200) files,
 * the cited file is source of an unanalyzable type, a git read or scan (the dependents' `git grep`) fails, a
 * path git cannot hand to `cat-file --batch` (contains a newline). Nothing is ever defaulted.
 *
 * HONEST LIMITS: only what the cited file DEPENDS ON is hashed. Its DEPENDENTS are LISTED, not hashed: `dependents` holds the
 * sorted repo-relative paths of the files that use it at the head, found exactly as planDeltaReview (pr-review-delta.js)
 * finds the blast radius of a changed file: importers (`buildImportGraph` over the head's reference lines, `targetKeys`),
 * name-matched tests (same stem, no import edge needed; not applied when the cited file is itself a test) and files with a
 * computed specifier whose text names the cited file. `planCarry` re-verifies a verdict when any of them is in the delta.
 * Direct dependents only, not transitive callers. Bare npm packages (`require('lodash')`) are not hashed: a lockfile change
 * does not invalidate. Symlinks (git mode 120000) are refused, cited or in the closure: git stores the link text, so hashing
 * the blob would not see the target change. So is a specifier whose normalized path passes through a symlinked DIRECTORY or a
 * SUBMODULE (any proper-prefix directory is a symlink entry, mode 120000, or a gitlink entry, mode 160000), in the cited file or
 * in any closure member, and so is a cited path that does: git lists the link or the submodule as one entry and nothing under
 * it, so the specifier resolves to nothing and no hash would see its target move (the link text, the submodule's pointer).
 * Resolution is the graph's file-level over-approximation. A
 * relative specifier that resolves to no tracked file is recorded as an ABSENT dependency: key = its normalized joined path,
 * value = sha256('absent'). A string that merely looks like a path is therefore harmless, and a dangling import is
 * invalidated when the file appears (the key set and hashes change). Absent entries are never read and do not count toward
 * the 200-file cap. A specifier climbing above the repository root is ignored. Runtime-built paths are only
 * caught when the call has no plain literal (computed). Only lines are hashed, not syntax: a whitespace edit inside the
 * region changes the hash (toward re-verification). REDACTION: the CLI output (and the state writer) replace the VALUE of any
 * key matching /token|secret|password|api[-_]?key|authorization/i, so a `depHashes` entry keyed `lib/token-cache.js` comes
 * back `[REDACTED]`; `planCarry` reads that as a missing hash, so carry is disabled for that closure (fails closed).
 */

const crypto = require('crypto');
const {
  referencesOf, joinRelative, dirname, resolveTracked, SCANNED_EXTENSIONS,
  buildImportGraph, targetKeys, testStemOf, ownerStemOf, namesFile, TEST_FILE,
} = require('./pr-review-import-graph');
const { isSizeable } = require('./pr-review-delta');
const { isObjectId } = require('./pr-review-scope');
const { parseLsTreeZ, scanReferenceLines, scanNameLines } = require('./pr-review-prepare');

const SYMLINK_MODE = '120000';
const GITLINK_MODE = '160000';
/** Entries git lists as ONE entry with nothing under it although they stand for a directory, and what an error calls each. */
const OPAQUE_DIRECTORY = new Map([[SYMLINK_MODE, 'symlinked directory'], [GITLINK_MODE, 'submodule']]);

const CONTEXT_LINES = 3;
const MAX_CLOSURE = 200;
const REQUEST_KEYS = ['repoRoot', 'headSha', 'citations'];
const CITATION_KEYS = ['id', 'file', 'line', 'lines', 'claim'];

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const ABSENT_HASH = sha256('absent');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isLine = (value) => Number.isInteger(value) && value >= 1;
const extensionOf = (file) => {
  const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
};
/** Files whose text is read for references: code the graph analyzes plus markup (`.json` is scanned by the graph's scan but holds no reference). */
const isScanned = (file) => SCANNED_EXTENSIONS.includes(extensionOf(file)) && extensionOf(file) !== '.json';

class HashError extends Error {}

function defaultGit() {
  return require('./review-prepare-runtime').defaultDeps().git;
}

function gitText(git, repoRoot, args, buffer = false, input) {
  const r = git(args, { cwd: repoRoot, buffer, input });
  if (r.status !== 0) throw new Error(`git ${args[0]} exited ${r.status}: ${String(r.stderr).trim().slice(0, 300)}`);
  return r.stdout;
}

/** Tracked paths at the head (`tracked`) and their git modes (`modes`: path -> '100644' | '120000' | ...). */
function listTracked(git, repoRoot, headSha) {
  const out = gitText(git, repoRoot, ['ls-tree', '-r', '-z', '--full-tree', headSha]);
  const entries = parseLsTreeZ(String(out));
  return { tracked: new Set(entries.map((e) => e.path)), modes: new Map(entries.map((e) => [e.path, e.mode])) };
}

/** Parses `git cat-file --batch` output for `paths`, in order: Map path -> Buffer | null (missing). */
function parseBatch(buffer, paths) {
  const result = new Map();
  let pos = 0;
  for (const p of paths) {
    const eol = buffer.indexOf(0x0a, pos);
    if (eol === -1) throw new Error('cat-file output is truncated');
    const header = buffer.slice(pos, eol).toString('utf8');
    pos = eol + 1;
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
      result.set(p, null);
      continue;
    }
    const match = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
    if (match === null) throw new Error('cat-file header is unreadable');
    const size = Number(match[2]);
    result.set(p, match[1] === 'blob' ? buffer.slice(pos, pos + size) : null);
    pos += size + 1;
  }
  return result;
}

/** Reads every not yet cached path in one cat-file call. A path git cannot name on a line is not read (cached as null). */
function loadBlobs(ctx, paths) {
  const need = [...new Set(paths)].filter((p) => !ctx.blobs.has(p));
  const readable = need.filter((p) => !/[\n\r]/.test(p));
  for (const p of need) if (!readable.includes(p)) ctx.blobs.set(p, null);
  if (readable.length === 0) return;
  // A Buffer: defaultDeps().git passes encoding 'buffer' to spawnSync, which rejects a string `input`.
  const input = Buffer.from(readable.map((p) => `${ctx.headSha}:${p}\n`).join(''));
  const out = gitText(ctx.git, ctx.repoRoot, ['cat-file', '--batch'], true, input);
  for (const [p, content] of parseBatch(Buffer.from(out), readable)) ctx.blobs.set(p, content);
}

function hunkOf(text, citation) {
  let start;
  let end;
  const hasLine = citation.line !== undefined;
  const hasLines = citation.lines !== undefined;
  if (hasLine === hasLines) throw new HashError(hasLine ? 'both line and lines given' : 'no line or lines given');
  if (hasLine) {
    if (!isLine(citation.line)) throw new HashError('line is not a positive integer');
    start = citation.line;
    end = citation.line;
  } else {
    const range = citation.lines;
    if (!Array.isArray(range) || range.length !== 2 || !isLine(range[0]) || !isLine(range[1]) || range[0] > range[1]) {
      throw new HashError('lines is not [start, end] of positive integers');
    }
    [start, end] = range;
  }
  const rows = text.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  if (end > rows.length) throw new HashError(`cited line ${end} is outside the file (${rows.length} lines)`);
  return sha256(rows.slice(Math.max(1, start - CONTEXT_LINES) - 1, Math.min(rows.length, end + CONTEXT_LINES)).join('\n'));
}

/**
 * The first proper-prefix directory of the normalized path `normalized` that git lists as ONE entry with nothing under it, a
 * symlink (mode 120000) or a submodule (a gitlink, mode 160000): `symlinked directory <path>` or `submodule <path>`; null
 * when there is none. A specifier through it resolves to nothing, so no hash can see its target move (`./vendor.js/pkg` with
 * `lib/vendor.js` -> real-a, retargeted to real-b; `./gl.js/x` with `lib/gl.js` a submodule whose pointer moved).
 */
function opaqueAncestor(modes, normalized) {
  const parts = normalized.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join('/');
    const what = OPAQUE_DIRECTORY.get(modes.get(prefix));
    if (what !== undefined) return `${what} ${prefix}`;
  }
  return null;
}

/**
 * What `file` references: `tracked` (the files it resolves to) and `absent` (the normalized paths of relative specifiers
 * that resolve to no tracked file). A specifier climbing above the repository root is dropped. Throws a HashError on a
 * computed specifier and on a specifier that passes through a symlinked directory or a submodule.
 */
function dependenciesOf(ctx, file) {
  const text = ctx.blobs.get(file).toString('utf8');
  const found = new Set();
  const absent = new Set();
  for (const line of text.split('\n')) {
    const references = referencesOf(file, line);
    if (references.computed) throw new HashError(`${file} holds a computed module specifier`);
    for (const spec of references.specifiers) {
      const normalized = joinRelative(spec.startsWith('/') ? '' : dirname(file), spec);
      if (normalized === null) continue;
      const through = opaqueAncestor(ctx.modes, normalized);
      if (through !== null) throw new HashError(`${file} names '${spec}', which passes through the ${through}`);
      const target = resolveTracked(normalized, ctx.tracked);
      if (target === null) absent.add(normalized);
      else if (target !== file) found.add(target);
    }
  }
  return { tracked: [...found].sort(), absent: [...absent].sort() };
}

function depHashesOf(ctx, file) {
  const closure = new Map();
  const seen = new Set([file]);
  let level = isScanned(file) ? [file] : [];
  while (level.length > 0) {
    const next = [];
    for (const member of level) {
      const deps = dependenciesOf(ctx, member);
      for (const gone of deps.absent) closure.set(gone, ABSENT_HASH);
      for (const dep of deps.tracked) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        if (seen.size - 1 > MAX_CLOSURE) throw new HashError(`dependency closure exceeds ${MAX_CLOSURE} files`);
        next.push(dep);
      }
    }
    for (const dep of next) if (ctx.modes.get(dep) === SYMLINK_MODE) throw new HashError(`${dep} is a symlink`);
    loadBlobs(ctx, next);
    for (const dep of next) {
      const blob = ctx.blobs.get(dep);
      if (blob === null) throw new HashError(`${dep} cannot be read at the head`);
      closure.set(dep, sha256(blob));
    }
    level = next.filter(isScanned);
  }
  const out = {};
  for (const key of [...closure.keys()].sort()) out[key] = closure.get(key);
  return out;
}

/** Throws on a git failure (-> `git read failed`), never returns a partial answer. Builds the graph and name lines once per call. */
function blastRadius(ctx) {
  if (ctx.radius === undefined) {
    try {
      const deps = { git: ctx.git };
      const refLines = scanReferenceLines(deps, ctx.repoRoot, ctx.headSha);
      if (refLines === null) throw new Error('the reference scan (git grep) failed');
      const graph = buildImportGraph({ filePaths: [...ctx.tracked], lines: refLines });
      const nameLines = graph.computed.length === 0 ? [] : scanNameLines(deps, ctx.repoRoot, ctx.headSha, graph.computed, ctx.citedFiles);
      if (nameLines === null) throw new Error('the name scan (git grep) failed');
      const testsByStem = new Map();
      for (const test of graph.testFiles) {
        const stem = testStemOf(test);
        if (!testsByStem.has(stem)) testsByStem.set(stem, []);
        testsByStem.get(stem).push(test);
      }
      ctx.radius = { graph, nameLines, testsByStem, computed: new Set(graph.computed) };
    } catch (err) {
      ctx.radius = { error: err };
    }
  }
  if (ctx.radius.error) throw ctx.radius.error;
  return ctx.radius;
}

/** The files that use `file` at the head, exactly as planDeltaReview's blast radius finds them (never `file` itself). */
function dependentsOf(ctx, file) {
  const { graph, nameLines, testsByStem, computed } = blastRadius(ctx);
  const found = new Set();
  for (const key of targetKeys(file)) {
    if (!Object.prototype.hasOwnProperty.call(graph.importers, key)) continue;
    for (const importer of graph.importers[key]) found.add(importer);
  }
  if (!TEST_FILE.test(file)) for (const test of testsByStem.get(ownerStemOf(file)) || []) found.add(test);
  for (const line of nameLines) if (computed.has(line.path) && namesFile(line.text, file)) found.add(line.path);
  found.delete(file);
  return [...found].sort();
}

function hashOne(ctx, citation) {
  const { file } = citation;
  if (!isText(file) || file.startsWith('/') || file.includes('\\') || file.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    throw new HashError('file is not a normalized repository-relative path');
  }
  if (ctx.modes.get(file) === SYMLINK_MODE) throw new HashError(`${file} is a symlink`);
  // git lists nothing under a symlinked directory or a submodule, so a path behind one reads as missing for want of a listing
  const through = opaqueAncestor(ctx.modes, file);
  if (through !== null) throw new HashError(`${file} passes through the ${through}`);
  loadBlobs(ctx, [file]);
  const blob = ctx.blobs.get(file);
  if (blob === null || !ctx.tracked.has(file)) throw new HashError(`${file} does not exist at the head`);
  if (!isSizeable(file) && !isScanned(file)) throw new HashError(`${file} is source of a type that cannot be analyzed`);
  const hunkHash = hunkOf(blob.toString('utf8'), citation);
  const depHashes = isScanned(file) ? depHashesOf(ctx, file) : {};
  return { hunkHash, depHashes, dependents: dependentsOf(ctx, file) };
}

/**
 * @param {Object} request  `{ repoRoot?, headSha, citations }`
 * @param {{git?:Function}} [deps]  injected `git(args, { cwd, input, buffer })` -> `{ status, stdout, stderr }`
 * @returns {{ok:true, headSha:string, candidates:Object[]}|{ok:false, error:string}}
 */
function hashCitations(request, deps = {}) {
  if (!isObject(request)) return { ok: false, error: 'request must be a JSON object' };
  const unknown = Object.keys(request).filter((k) => !REQUEST_KEYS.includes(k));
  if (unknown.length > 0) return { ok: false, error: `unknown key(s): ${unknown.join(', ')}` };
  if (!isObjectId(request.headSha)) return { ok: false, error: 'headSha must be a full object id' };
  if (!Array.isArray(request.citations) || !request.citations.every(isObject)) return { ok: false, error: 'citations must be an array of objects' };
  for (const citation of request.citations) {
    const extra = Object.keys(citation).filter((k) => !CITATION_KEYS.includes(k));
    if (extra.length > 0) return { ok: false, error: `unknown citation key(s): ${extra.join(', ')}` };
  }
  const repoRoot = request.repoRoot === undefined ? process.cwd() : request.repoRoot;
  if (!isText(repoRoot)) return { ok: false, error: 'repoRoot must be a non-empty string' };
  const git = deps.git || defaultGit();
  const citedFiles = [...new Set(request.citations.map((c) => c.file).filter(isText))];
  const ctx = { git, repoRoot, headSha: request.headSha, blobs: new Map(), tracked: null, modes: null, citedFiles, radius: undefined };
  try {
    ({ tracked: ctx.tracked, modes: ctx.modes } = listTracked(git, repoRoot, request.headSha));
  } catch (err) {
    return { ok: false, error: `cannot list the tracked files at the head: ${err.message}` };
  }
  // Every candidate is stamped with the head it was hashed at, one that could not be hashed included. A citation cannot bring a
  // `headSha` of its own (it is not a citation key), so the stamp is always the head this call read.
  const stamp = { headSha: request.headSha };
  const candidates = request.citations.map((citation) => {
    try {
      return { ...citation, ...stamp, ...hashOne(ctx, citation) };
    } catch (err) {
      if (err instanceof HashError) return { ...citation, ...stamp, hashError: err.message };
      return { ...citation, ...stamp, hashError: `git read failed: ${err.message}` };
    }
  });
  return { ok: true, headSha: request.headSha, candidates };
}

module.exports = { hashCitations, CONTEXT_LINES, MAX_CLOSURE };
