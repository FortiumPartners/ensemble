'use strict';

/**
 * Repo-signal detection engine (TRD-2026-8d825f54 TRD-016, PRD REQ-010, AC-010-1, AC-010-2).
 *
 * `detectAdapter(category, ctx)` is the function wired as `ctx.detect` for `resolveCategory()`
 * (`./config.js`) -- the "detection" precedence step that only runs when project config, user
 * config and env-compat have all declined to resolve `category` (TRD interpretation I2).
 *
 * Algorithm: discover every installed adapter (`./adapters.js#discoverAdapters`), load each
 * candidate whose manifest declares `category` in its `categories` list
 * (`./adapters.js#loadAdapter`, wrapped in try/catch so one bad or untrusted candidate --
 * `NOT_INSTALLED` racing a concurrent uninstall, `UNTRUSTED_REPO_ADAPTER`, `CONFIG_INVALID` --
 * is silently excluded from detection rather than aborting the whole sweep; an untrusted
 * repo-local adapter is therefore never auto-selected by detection, matching `loadAdapter`'s
 * own I5 non-interactive trust requirement), and evaluate each candidate's `manifest.detect`
 * array against the repo at `ctx.projectRoot`. A candidate "matches" when ANY ONE of its
 * declared signals matches -- OR across signals, e.g. git-town's only signal is
 * `git_config_set git-town.main-branch`; github's is only `remote_url_matches`; an adapter
 * declaring `detect: []` (e.g. Jira, which has no repo signal at all) never matches on its own.
 *
 * Detect-signal field names (not formally named anywhere else in this codebase as of this
 * task -- no adapter populates `detect:` for real yet; chosen here to match the TRD-036 prose
 * shorthand "remote_url_matches github.com" / "git_config_set git-town.main-branch" so that
 * later real-adapter PR does not need to rename anything):
 *   - `remote_url_matches`: `{signal: 'remote_url_matches', pattern: <string>}` -- `pattern` is
 *     compiled as `new RegExp(pattern)` and tested against the repo's `origin` remote URL.
 *   - `file_exists` / `dir_exists`: `{signal: ..., path: <string>}` -- `path` is resolved
 *     relative to `ctx.projectRoot` and rejected if it would resolve outside of it.
 *   - `git_config_set`: `{signal: 'git_config_set', key: <string>}` -- a dotted git config key
 *     (e.g. `git-town.main-branch`); true iff that key is present anywhere in the resolved
 *     repo's config (any value, including empty string, counts as "set"; an absent key does
 *     not).
 *
 * I2 result shape (refined, PR 9 independent fix -- see "I2 refinement" below `detectAdapter`
 * for the full rationale and old-vs-new wording):
 *   - zero candidates match AND no positively-identified signal source exists (no `.git`
 *     directory at all, or a `.git` directory with no `origin` remote configured) -> returns
 *     `null`, so `resolveCategory` falls through to the shipped default (`source:'default'`,
 *     no error).
 *   - exactly one candidate matches -> `{value: <adapter name>, source: 'detection'}`.
 *   - two or more candidates match -> throws an `Error` with `.code === 'AMBIGUOUS_PROVIDER'`
 *     naming `category`, every matched adapter name, and `.ensemble/toolchain.yaml`.
 *   - zero candidates match, but a positively-identified signal source exists (an `origin`
 *     remote URL is present) AND the category's OWN shipped default adapter
 *     (`toolchain.default.yaml`, e.g. `host: github`) is itself selected by a declared
 *     `remote_url_matches` signal -> throws the same `AMBIGUOUS_PROVIDER` shape (a remote that
 *     matches nothing suggests the default is likely wrong). When the default declares NO
 *     remote signal (e.g. `tracker: beads`, `detect: []`), an unrelated installed adapter's
 *     own unmatched signal is NOT evidence against the default -> falls through to it exactly
 *     like "no signal source" (returns `null`, `source:'default'`, no error).
 *
 * fs-only git inspection: this module never spawns a process, matching `./adapters.js`'s own
 * fs-only style. It resolves the repo's real git directory itself, including the worktree
 * gitlink case (`<projectRoot>/.git` is a *file* containing `gitdir: <path>`, and that
 * worktree-specific gitdir's own `commondir` file -- when present -- points back to the main
 * repository's git directory, which is where `config` actually lives; this very repository is
 * checked out as a worktree, so this path is exercised in production, not only in tests), then
 * parses `config` with a small purpose-built INI reader (sections `[section]` / `[section
 * "subsection"]`, `key = value` lines) sufficient to answer `remote.origin.url` and arbitrary
 * `git_config_set` lookups.
 *
 * ## `remote_url_matches`: a bad pattern on one adapter never breaks detection for the rest
 *
 * (PR 4 review round 2, Finding 1.) A `DETECTION_SIGNAL_ERROR` from `testRemoteUrlPattern`
 * (oversized/invalid pattern, or a deadline timeout -- see below) EXCLUDES only the candidate
 * adapter that declared the bad pattern from THIS category's sweep -- the exact same convention
 * the nearby `loadAdapter` try/catch already uses for an uninstalled/untrusted candidate. It
 * never aborts the whole `detectAdapter` call (which would otherwise fail every category a
 * caller like `toolchain-cli explain`/`resolve` loops over, not just the one category the bad
 * adapter happens to declare). Each exclusion is reported, never silent:
 *   - if `ctx.diagnostics` is an array, one `{adapter, signal, pattern, category, reason}`
 *     record (every string field sanitized -- control characters, including ANSI escapes,
 *     stripped) is pushed onto it per excluded candidate. `toolchain-cli.js`'s `resolveAll`
 *     (serving both `resolve`/`explain`) supplies a fresh array per category and attaches it as
 *     `data.<category>.detectionDiagnostics` when non-empty.
 *   - one sanitized line is written to `process.stderr` per DISTINCT `(adapter, pattern)` pair,
 *     de-duplicated for the lifetime of this process (a module-level `Set`) so a pattern that
 *     keeps failing across many categories/invocations within one process logs once, not once
 *     per sweep.
 * `AMBIGUOUS_PROVIDER` and the "no signal source at all" default-fallback semantics above are
 * completely unchanged by this: an excluded candidate still counts toward
 * `candidateDeclaresRemoteSignal` (it DID declare a `remote_url_matches` signal, just a broken
 * one), so an origin URL matching nothing else still correctly reports ambiguous rather than
 * silently defaulting.
 *
 * ## `remote_url_matches` pattern evaluation: a deadline, not a sandbox
 *
 * (PR 4 review round 2, Finding 2.) Each pattern is evaluated under a hard
 * `REMOTE_URL_MATCH_TIMEOUT_MS` wall-clock deadline via `vm.Script#runInContext`'s `{timeout}`
 * option -- this interrupts even catastrophic backtracking (e.g. `^(a+)+$` against a long
 * near-matching string), which a plain `new RegExp(pattern).test(url)` call has no way to
 * abort. **This is not a sandbox or an isolation boundary**: `vm.createContext` shares the
 * host's built-in intrinsics, so running code "inside" it is not meaningfully separated from
 * the surrounding process. It is used here solely because it is the one primitive Node exposes
 * for imposing an execution deadline on synchronous JS. The only thing that ever varies between
 * calls is DATA -- `pattern`/`url`, assigned as plain string properties on the context object,
 * never concatenated into source text -- while the SCRIPT itself is the one fixed, literal
 * string `'__result = new RegExp(pattern).test(url);'`, so a hostile `pattern` value can never
 * become executable code through this path regardless of its content.
 * `codeGeneration: {strings: false, wasm: false}` is set on the context as defense in depth
 * (it disables `eval()`/`new Function()`/`WebAssembly` string compilation inside the context):
 * today's fixed script never needs it, but it costs nothing and narrows what a future change to
 * this function could do by accident.
 *
 * ## `remote_url_matches` pattern evaluation is memoized per process
 *
 * (PR 4 review round 2, Finding 3.) `detectAdapter` re-sweeps every candidate once per
 * `category` a caller asks about (`resolve`/`explain` ask about all 14), so without caching a
 * single adapter's `remote_url_matches` signal would pay its own (bounded, but non-trivial for
 * a timed-out pattern) evaluation cost once per category it declares. `evaluateRemoteUrlMatch`
 * memoizes the RAW result (including a thrown `DETECTION_SIGNAL_ERROR`) in a module-level,
 * size-bounded `Map` keyed on the full `(adapter id, signal kind, pattern, origin URL)` tuple
 * for the lifetime of the process: a result (success or failure) computed once for one category
 * is reused for every other category the same adapter declares, so a catastrophic pattern costs
 * one `REMOTE_URL_MATCH_TIMEOUT_MS` timeout total per process, not one per category.
 *
 * ## Known limits
 *
 * - No interactive adapter-selection UI exists anywhere in this codebase yet (out of scope for
 *   this task, and not built by any other task either); `detectAdapter` always throws
 *   `AMBIGUOUS_PROVIDER` on ambiguity regardless of `ctx.interactive` -- a deliberate
 *   fail-closed choice, not an interactive prompt deferred to later.
 * - The fs-only git config reader does not follow `[include]`/`[includeIf]` directives (real
 *   `git config --get` does); a key or remote URL set only via an included file is invisible to
 *   this module. None of this task's ACs require include-file support; a later task can add an
 *   `execFile`-based fallback (`./runner.js#buildChildEnv`) if a real adapter ever needs it.
 * - `remote_url_matches` only inspects the `origin` remote; other remote names are not
 *   consulted (no documented signal needs them yet).
 */

const vm = require('vm');

const REMOTE_URL_MATCH_TIMEOUT_MS = 200;
const MAX_REMOTE_URL_PATTERN_LENGTH = 512;
const MAX_REMOTE_URL_LENGTH = 2048;
const MAX_REMOTE_URL_MATCH_CACHE_ENTRIES = 500;

/**
 * Strip ASCII control characters (0x00-0x1F, 0x7F -- this range already covers the ESC byte
 * 0x1B that begins an ANSI escape sequence, so stripping it alone neutralizes the sequence into
 * harmless literal text) from a value before it is ever written to `process.stderr` or placed
 * into a diagnostics record a caller might print. Never throws: a non-string is stringified
 * first.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeForLog(value) {
  return String(value).replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Evaluate `new RegExp(pattern).test(url)` under a hard `REMOTE_URL_MATCH_TIMEOUT_MS`
 * wall-clock deadline. See this file's header "pattern evaluation: a deadline, not a sandbox"
 * section for exactly what the `vm` usage below is (an execution deadline) and is not (a
 * security sandbox).
 *
 * Never returns a bare `false` on failure: an oversized pattern/URL, an invalid pattern, or a
 * timeout all throw a named `Error` with `.code === 'DETECTION_SIGNAL_ERROR'` and a `.pattern`
 * field carrying the raw pattern value, so the caller reports (never silently swallows) which
 * signal failed.
 *
 * @param {unknown} pattern
 * @param {string} url
 * @returns {boolean}
 * @throws {Error} with `.code === 'DETECTION_SIGNAL_ERROR'`
 */
function testRemoteUrlPattern(pattern, url) {
  remoteUrlMatchEvaluationCount += 1;
  if (typeof pattern !== 'string' || pattern.length === 0) {
    const error = new Error('remote_url_matches: pattern must be a non-empty string');
    error.code = 'DETECTION_SIGNAL_ERROR';
    error.pattern = pattern;
    throw error;
  }
  if (pattern.length > MAX_REMOTE_URL_PATTERN_LENGTH) {
    const error = new Error(
      `remote_url_matches: pattern length ${pattern.length} exceeds the ` +
        `${MAX_REMOTE_URL_PATTERN_LENGTH}-character limit`
    );
    error.code = 'DETECTION_SIGNAL_ERROR';
    error.pattern = pattern;
    throw error;
  }
  if (typeof url !== 'string' || url.length > MAX_REMOTE_URL_LENGTH) {
    const error = new Error(
      `remote_url_matches: origin URL length exceeds the ${MAX_REMOTE_URL_LENGTH}-character limit`
    );
    error.code = 'DETECTION_SIGNAL_ERROR';
    error.pattern = pattern;
    throw error;
  }

  // `pattern`/`url` are DATA on this context object, never source text; the only script ever
  // compiled/run against it is the one fixed literal string below (see header doc). The
  // `codeGeneration` option is defense in depth, not load-bearing for that guarantee.
  const sandbox = vm.createContext(
    { pattern, url, __result: undefined },
    { codeGeneration: { strings: false, wasm: false } }
  );
  try {
    const script = new vm.Script('__result = new RegExp(pattern).test(url);');
    script.runInContext(sandbox, { timeout: REMOTE_URL_MATCH_TIMEOUT_MS });
    return Boolean(sandbox.__result);
  } catch (cause) {
    const timedOut = Boolean(cause && /Script execution timed out/.test(cause.message || ''));
    const error = new Error(
      timedOut
        ? `remote_url_matches: pattern '${pattern}' exceeded ${REMOTE_URL_MATCH_TIMEOUT_MS}ms ` +
          `evaluating against the origin URL (possible catastrophic backtracking)`
        : `remote_url_matches: pattern '${pattern}' is invalid (${cause && cause.message})`
    );
    error.code = 'DETECTION_SIGNAL_ERROR';
    error.pattern = pattern;
    throw error;
  }
}

/**
 * Static, author-time check for one `remote_url_matches` signal's `pattern`: non-empty string,
 * within `MAX_REMOTE_URL_PATTERN_LENGTH`, and compiles as a regex. This NEVER runs the pattern
 * against any input (`new RegExp(pattern)` only parses syntax; it does not match), so unlike
 * `testRemoteUrlPattern` it carries no ReDoS risk and needs no deadline -- it exists so
 * `./validate.js`'s static gate can reject a bad pattern at `toolchain-cli validate` time,
 * reusing these exact limits (exported from this one place; `validate.js` never redeclares
 * them).
 *
 * @param {unknown} pattern
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function checkRemoteUrlMatchPatternStatic(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    return { ok: false, error: 'pattern must be a non-empty string' };
  }
  if (pattern.length > MAX_REMOTE_URL_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `pattern length ${pattern.length} exceeds the ${MAX_REMOTE_URL_PATTERN_LENGTH}-character limit`
    };
  }
  try {
    // eslint-disable-next-line no-new -- compiling only, to check syntax; never matched against
    // any input here, so this is never subject to catastrophic backtracking.
    new RegExp(pattern);
  } catch (error) {
    return { ok: false, error: `pattern is invalid (${error.message})` };
  }
  return { ok: true };
}

const remoteUrlMatchCache = new Map();
let remoteUrlMatchEvaluationCount = 0;

function remoteUrlMatchCacheKey(adapterName, pattern, url) {
  return [adapterName, 'remote_url_matches', pattern, url].join('\u0000');
}

/**
 * `testRemoteUrlPattern`, memoized per `(adapter id, signal kind, pattern, origin URL)` tuple
 * for the lifetime of this process (see header "pattern evaluation is memoized per process").
 * A thrown `DETECTION_SIGNAL_ERROR` is cached and re-thrown (the SAME `Error` instance) on
 * every subsequent call with the identical tuple, so a catastrophic/invalid pattern is only
 * ever actually evaluated once. The cache is size-bounded (`MAX_REMOTE_URL_MATCH_CACHE_ENTRIES`,
 * oldest-inserted evicted first) so it cannot grow unbounded across a long-lived process.
 *
 * @param {string} adapterName
 * @param {unknown} pattern
 * @param {string} url
 * @returns {boolean}
 * @throws {Error} with `.code === 'DETECTION_SIGNAL_ERROR'`
 */
function evaluateRemoteUrlMatch(adapterName, pattern, url) {
  const key = remoteUrlMatchCacheKey(adapterName, pattern, url);
  const cached = remoteUrlMatchCache.get(key);
  if (cached) {
    if (cached.error) {
      throw cached.error;
    }
    return cached.value;
  }

  try {
    const value = testRemoteUrlPattern(pattern, url);
    remoteUrlMatchCache.set(key, { value });
    return value;
  } catch (error) {
    remoteUrlMatchCache.set(key, { error });
    throw error;
  } finally {
    while (remoteUrlMatchCache.size > MAX_REMOTE_URL_MATCH_CACHE_ENTRIES) {
      remoteUrlMatchCache.delete(remoteUrlMatchCache.keys().next().value);
    }
  }
}

/** Test-only: clears the memoization cache, its evaluation counter, and the per-process
 * excluded-adapter stderr dedup set, so each test starts from a clean slate. */
function __resetDetectionCachesForTests() {
  remoteUrlMatchCache.clear();
  remoteUrlMatchEvaluationCount = 0;
  loggedDetectionFailures.clear();
}

/** Test-only: the number of times `testRemoteUrlPattern` actually ran (real evaluations, NOT
 * cache hits) since the last reset. Incremented inside `testRemoteUrlPattern` itself -- not in
 * `evaluateRemoteUrlMatch`'s wrapper -- so this stays an accurate, observable,
 * non-timing-based proxy for "was the expensive deadline-bounded match actually run" even if a
 * caller bypasses the memoization cache entirely (e.g. a mutation test). */
function __getRemoteUrlMatchCacheMissesForTests() {
  return remoteUrlMatchEvaluationCount;
}

const loggedDetectionFailures = new Set();

/**
 * Record one candidate adapter's `remote_url_matches` failure (PR 4 review round 2, Finding 1):
 * pushes a sanitized diagnostic onto `ctx.diagnostics` when the caller supplied an array, and
 * writes one sanitized `process.stderr` line per distinct `(adapter, pattern)` pair for the
 * lifetime of this process (never a duplicate line for the same pair within one process).
 *
 * @param {string} adapterName
 * @param {string} category
 * @param {Error & {pattern?: unknown}} error a `DETECTION_SIGNAL_ERROR` from
 *   `evaluateRemoteUrlMatch`/`testRemoteUrlPattern`
 * @param {{diagnostics?: unknown[]}} ctx
 */
function recordDetectionSignalFailure(adapterName, category, error, ctx) {
  const adapter = sanitizeForLog(adapterName);
  const pattern = sanitizeForLog(error.pattern);
  const reason = sanitizeForLog(error.message);

  if (ctx && Array.isArray(ctx.diagnostics)) {
    ctx.diagnostics.push({ adapter, signal: 'remote_url_matches', pattern, category, reason });
  }

  const dedupeKey = `${adapter}\u0000${pattern}`;
  if (!loggedDetectionFailures.has(dedupeKey)) {
    loggedDetectionFailures.add(dedupeKey);
    process.stderr.write(
      `toolchain detect: adapter '${adapter}' excluded from detection -- remote_url_matches ` +
        `pattern '${pattern}' failed (${reason})\n`
    );
  }
}

const fs = require('fs');
const path = require('path');

const { discoverAdapters, loadAdapter } = require('./adapters');
const { loadDefaultToolchainConfig } = require('./config');

/**
 * Resolve `<projectRoot>/.git` to the real git directory that holds `config`, handling the
 * plain-directory case and the worktree gitlink case (a `.git` *file* containing
 * `gitdir: <path>`, whose own `commondir` file -- when present -- points back to the main
 * repository's git directory). Returns `null` for any missing/unreadable/malformed layout
 * (never throws).
 *
 * @param {string} projectRoot
 * @returns {string|null}
 */
function resolveGitDir(projectRoot) {
  const gitPath = path.join(projectRoot, '.git');
  let stat;
  try {
    stat = fs.lstatSync(gitPath);
  } catch {
    return null;
  }

  let candidate = gitPath;
  if (stat.isFile()) {
    let content;
    try {
      content = fs.readFileSync(gitPath, 'utf8');
    } catch {
      return null;
    }
    const match = /^gitdir:\s*(.+)$/m.exec(content);
    if (!match) {
      return null;
    }
    const gitdirValue = match[1].trim();
    candidate = path.isAbsolute(gitdirValue) ? gitdirValue : path.resolve(projectRoot, gitdirValue);

    try {
      const commondirContent = fs.readFileSync(path.join(candidate, 'commondir'), 'utf8').trim();
      if (commondirContent) {
        candidate = path.isAbsolute(commondirContent)
          ? commondirContent
          : path.resolve(candidate, commondirContent);
      }
    } catch {
      // No commondir file: not a worktree checkout, or an unusual layout. Use candidate as-is.
    }
  } else if (!stat.isDirectory()) {
    return null;
  }

  try {
    if (!fs.statSync(candidate).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }
  return candidate;
}

/**
 * Parse a git `config` file's text into a `Map` from a lowercased, dotted
 * `section[.subsection].key` to the array of values assigned to it (in file order; the git
 * convention is that the last assignment wins for a scalar read). A key with no `=` (a bare
 * boolean-style line) is recorded with value `''`, which still counts as "set".
 *
 * @param {string} content
 * @returns {Map<string, string[]>}
 */
function parseGitConfig(content) {
  const map = new Map();
  let section = null;
  let subsection = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    const sectionMatch = /^\[([^\]\s"]+)(?:\s+"([^"]*)")?\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].toLowerCase();
      subsection = sectionMatch[2] !== undefined ? sectionMatch[2] : null;
      continue;
    }

    if (!section) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    const key = (eqIndex === -1 ? line : line.slice(0, eqIndex)).trim().toLowerCase();
    if (!key) {
      continue;
    }
    const value = eqIndex === -1 ? '' : line.slice(eqIndex + 1).trim();
    const mapKey = subsection !== null ? `${section}.${subsection}.${key}` : `${section}.${key}`;
    if (!map.has(mapKey)) {
      map.set(mapKey, []);
    }
    map.get(mapKey).push(value);
  }

  return map;
}

/**
 * Read and parse `<projectRoot>`'s resolved git `config` file. Returns `null` for any
 * missing/unreadable repo rather than throwing.
 *
 * @param {string} projectRoot
 * @returns {Map<string, string[]>|null}
 */
function loadGitConfigMap(projectRoot) {
  const gitDir = resolveGitDir(projectRoot);
  if (!gitDir) {
    return null;
  }
  let content;
  try {
    content = fs.readFileSync(path.join(gitDir, 'config'), 'utf8');
  } catch {
    return null;
  }
  return parseGitConfig(content);
}

/**
 * The repo's `origin` remote URL, or `null` when unset/unparseable.
 * @param {Map<string, string[]>|null} gitConfigMap
 * @returns {string|null}
 */
function resolveOriginRemoteUrl(gitConfigMap) {
  if (!gitConfigMap) {
    return null;
  }
  const values = gitConfigMap.get('remote.origin.url');
  return values && values.length > 0 ? values[values.length - 1] : null;
}

/**
 * Whether a dotted git config key (e.g. `git-town.main-branch`, `remote.origin.url`) is set
 * anywhere in `gitConfigMap`. The first dot-separated part is the section, the last is the key,
 * and anything in between (if present) is the subsection -- mirroring how git itself derives a
 * dotted config key from `[section "subsection"]` / `key = ...`.
 *
 * @param {Map<string, string[]>|null} gitConfigMap
 * @param {unknown} dottedKey
 * @returns {boolean}
 */
function gitConfigKeyIsSet(gitConfigMap, dottedKey) {
  if (!gitConfigMap || typeof dottedKey !== 'string' || !dottedKey.includes('.')) {
    return false;
  }
  const parts = dottedKey.split('.');
  const section = parts[0].toLowerCase();
  const key = parts[parts.length - 1].toLowerCase();
  const subsectionParts = parts.slice(1, -1);
  const mapKey = subsectionParts.length > 0 ? `${section}.${subsectionParts.join('.')}.${key}` : `${section}.${key}`;
  return gitConfigMap.has(mapKey);
}

/**
 * Resolve `relativePath` against `projectRoot`, returning `null` (never throwing) when it is
 * not a non-empty string or would resolve outside of `projectRoot`.
 *
 * @param {string} projectRoot
 * @param {unknown} relativePath
 * @returns {string|null}
 */
function resolvePathWithinRoot(projectRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return null;
  }
  const resolvedRoot = path.resolve(projectRoot);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}

/**
 * Evaluate one `manifest.detect[]` entry against the repo at `projectRoot`. `file_exists` /
 * `dir_exists` / `git_config_set` never throw: any unreadable/malformed input for those is
 * treated as "no match". `remote_url_matches` is the one exception (see
 * `evaluateRemoteUrlMatch`/`testRemoteUrlPattern`'s doc above): it can throw a named
 * `.code === 'DETECTION_SIGNAL_ERROR'` error on an oversized/invalid pattern or a deadline
 * timeout -- that error is never swallowed here, it propagates to the caller (`detectAdapter`,
 * which excludes just the offending candidate, see header doc).
 *
 * @param {{signal?: string, pattern?: string, path?: string, key?: string}} signal
 * @param {string} projectRoot
 * @param {Map<string, string[]>|null} gitConfigMap
 * @param {string} adapterName the candidate adapter declaring `signal`, used as part of the
 *   `remote_url_matches` memoization cache key
 * @returns {boolean}
 * @throws {Error} with `.code === 'DETECTION_SIGNAL_ERROR'` for a bad/slow `remote_url_matches`
 *   pattern
 */
function signalMatches(signal, projectRoot, gitConfigMap, adapterName) {
  if (!signal || typeof signal.signal !== 'string') {
    return false;
  }

  switch (signal.signal) {
    case 'file_exists': {
      const resolved = resolvePathWithinRoot(projectRoot, signal.path);
      if (!resolved) {
        return false;
      }
      try {
        return fs.statSync(resolved).isFile();
      } catch {
        return false;
      }
    }
    case 'dir_exists': {
      const resolved = resolvePathWithinRoot(projectRoot, signal.path);
      if (!resolved) {
        return false;
      }
      try {
        return fs.statSync(resolved).isDirectory();
      } catch {
        return false;
      }
    }
    case 'remote_url_matches': {
      const url = resolveOriginRemoteUrl(gitConfigMap);
      if (!url) {
        return false;
      }
      return evaluateRemoteUrlMatch(adapterName, signal.pattern, url);
    }
    case 'git_config_set':
      return gitConfigKeyIsSet(gitConfigMap, signal.key);
    default:
      return false;
  }
}

/**
 * Detect the adapter for `category` from repo signals (see module doc for the full algorithm
 * and I2 result shape). Usable directly as `ctx.detect` for `resolveCategory()`.
 *
 * @param {string} category
 * @param {{projectRoot?: string, env?: NodeJS.ProcessEnv, interactive?: boolean,
 *   diagnostics?: object[]}} [ctx] when `ctx.diagnostics` is an array, one record is pushed
 *   onto it per candidate excluded for a `DETECTION_SIGNAL_ERROR` (PR 4 review round 2,
 *   Finding 1) -- see header doc.
 * @returns {{value: string, source: 'detection'}|null}
 * @throws {Error} with `.code === 'AMBIGUOUS_PROVIDER'` per the module doc's I2 ambiguous case.
 *   A candidate whose `remote_url_matches` pattern is oversized, invalid, or exceeds its
 *   evaluation deadline is EXCLUDED from this category's sweep (never thrown from here) --
 *   see header doc "a bad pattern on one adapter never breaks detection for the rest".
 */
function detectAdapter(category, ctx = {}) {
  const { projectRoot = process.cwd() } = ctx;

  const gitConfigMap = loadGitConfigMap(projectRoot);
  const originUrl = resolveOriginRemoteUrl(gitConfigMap);

  const candidateNames = new Set(discoverAdapters(ctx).map((entry) => entry.name));

  const defaults = loadDefaultToolchainConfig();
  const defaultAdapterName = defaults && defaults[category] != null ? defaults[category] : null;

  const matched = [];
  let defaultAdapterDeclaresRemoteSignal = false;

  for (const name of candidateNames) {
    let loaded;
    try {
      // Keyed on (id, category): an id declared by two directories, one category each, used to
      // load whichever sorted first and then be dropped by the category check below, so it
      // could never be a candidate for the other category at all (#146).
      loaded = loadAdapter(name, { ...ctx, category });
    } catch {
      // Not installed anymore (discovery/load race), untrusted repo-local adapter, or an
      // invalid user toolchain.yaml encountered during the trust lookup: exclude this
      // candidate from detection rather than aborting the whole sweep. When this candidate IS
      // the category's shipped default, it also can never be confirmed remote-detected below
      // -- fails safe to "not ambiguous, use the default" (same as the default not being
      // installed at all).
      continue;
    }

    const manifest = loaded.manifest;
    // The `categories.includes(category)` half is now implied by the keyed load above (that is
    // the fix), and is kept because it is what makes the keyed load's effect visible here: a
    // candidate reaching this line without the category means the pass-through was dropped.
    if (!manifest || !Array.isArray(manifest.categories) || !manifest.categories.includes(category)) {
      continue;
    }

    const detectSignals = Array.isArray(manifest.detect) ? manifest.detect : [];
    if (
      name === defaultAdapterName &&
      detectSignals.some((signal) => signal && signal.signal === 'remote_url_matches')
    ) {
      defaultAdapterDeclaresRemoteSignal = true;
    }

    let candidateMatched;
    try {
      candidateMatched = detectSignals.some((signal) =>
        signalMatches(signal, projectRoot, gitConfigMap, name)
      );
    } catch (error) {
      if (error && error.code === 'DETECTION_SIGNAL_ERROR') {
        // Exclude ONLY this candidate (same convention as the loadAdapter catch above) --
        // never abort the whole sweep for every other adapter/category (PR 4 review round 2,
        // Finding 1). Reported, never silent: see recordDetectionSignalFailure.
        recordDetectionSignalFailure(name, category, error, ctx);
        continue;
      }
      throw error;
    }

    if (candidateMatched) {
      matched.push(name);
    }
  }

  if (matched.length === 1) {
    return { value: matched[0], source: 'detection' };
  }

  if (matched.length >= 2) {
    const error = new Error(
      `detection for category '${category}' matched more than one installed adapter ` +
        `(${matched.join(', ')}); set '${category}' explicitly in .ensemble/toolchain.yaml`
    );
    error.code = 'AMBIGUOUS_PROVIDER';
    throw error;
  }

  // I2 refinement (PR 9 independent fix): a remote URL is evidence of the HOST provider, not
  // of every category a repo happens to have an adapter installed for. An unmatched remote
  // only means "the default is probably wrong" when the category's OWN shipped default
  // adapter (`toolchain.default.yaml`) is itself selected by a remote signal -- i.e. the
  // default is a remote-detected adapter like `host: github` (declares `remote_url_matches`),
  // so a non-github remote really does suggest github is the wrong default. When the default
  // declares no remote signal at all (`tracker: beads`, `detect: []`), an unrelated installed
  // adapter's own unmatched signal (e.g. `adapter-tracker-azure-boards`'s `dev\.azure\.com`
  // pattern against a github.com remote) is not evidence against the default -- it falls
  // through to the shipped default exactly as "no signal source" would. A MATCHING remote
  // still selects the matching adapter regardless of which adapter is the default (the
  // `matched.length === 1` branch above, unchanged); two or more matching adapters is still
  // ambiguous (the `matched.length >= 2` branch above, unchanged).
  if (originUrl && defaultAdapterDeclaresRemoteSignal) {
    const error = new Error(
      `detection for category '${category}' found a remote 'origin' URL ('${originUrl}') that ` +
        `matches no installed adapter's signal (the shipped default adapter '${defaultAdapterName}' ` +
        `is itself remote-detected); set '${category}' explicitly in .ensemble/toolchain.yaml`
    );
    error.code = 'AMBIGUOUS_PROVIDER';
    throw error;
  }

  return null;
}

module.exports = {
  detectAdapter,
  testRemoteUrlPattern,
  checkRemoteUrlMatchPatternStatic,
  MAX_REMOTE_URL_PATTERN_LENGTH,
  MAX_REMOTE_URL_LENGTH,
  __resetDetectionCachesForTests,
  __getRemoteUrlMatchCacheMissesForTests
};
