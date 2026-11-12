'use strict';

/**
 * Path matching, owner and sensitivity resolution (TRD-001, REQ-003).
 *
 * Pure: NO shell, NO git calls, NO file reads, NO network. The caller
 * supplies the already-read declaration text (parsed into an object), the
 * CODEOWNERS text and the changed path list; this module only grades them.
 *
 * Three rules this module exists to make non-negotiable:
 *
 *   1. **The declaration in force is the BASE copy.** A declaration is used
 *      only when it carries a `sourceSha` that is a full object id equal to
 *      the review's `baseSha`. Anything else -- a declaration read from the
 *      PR head, one with no source identity, one with a bare ref as the base
 *      -- is rejected with `declaration-not-from-base` and the built-in
 *      defaults apply instead. A PR therefore cannot widen or narrow its own
 *      review by editing the declaration (REQ-024, AC-003-3).
 *
 *   2. **The built-in default sensitive set is a floor, not a fallback.** It
 *      applies even when a declaration IS in force, so an owner declaration
 *      can only add sensitive areas, never remove CI workflows, release
 *      gates, installers, generation scripts or the constitution from the set
 *      (AC-003-2).
 *
 *   3. **Fail closed.** A request this module cannot read never produces a
 *      clean "not sensitive" answer: `ok` is false, `prSensitive` and
 *      `declarationChanged` are true, and the reason is named. A caller that
 *      ignores `ok` still gets the safe answer.
 *
 * Glob matching is implemented here (no dependency, Constitution §4). The
 * semantics are the gitignore/CODEOWNERS ones callers already expect:
 *
 *   - `*` and `?` do not cross `/`; `**` does, and takes ANY character, line
 *     terminators (\n, \r, U+2028, U+2029) included: a bare `.` skips them, so a
 *     name holding one would be no match for `.github/workflows/**`. A double
 *     star that is a whole segment inside a pattern (`a`, `**`, `b`, joined by
 *     slashes) is zero or more whole directories: it takes `a/b` and `a/x/b`,
 *     never `a/xb`.
 *   - A pattern with no `/` matches a basename at any depth (`*.yml`).
 *   - A leading `/` anchors the pattern to the repository root (`/*.yml`).
 *   - A trailing `/` makes the pattern directory-only (`docs/`).
 *   - A pattern that names a directory -- one written with a trailing `/`, or
 *     a literal pattern with no wildcard at all (`docs/`, `src/auth`) -- also
 *     matches every file beneath it. A pattern that SPELLS OUT a wildcard
 *     segment matches only what it spells: `src/*` does not reach
 *     `src/a/b.js`, so a generation-pipeline subtree is written out in full
 *     as its own entry rather than relying on `scripts/generate-*`.
 *   - Every other character is matched literally: a regex metacharacter in a
 *     pattern is escaped, never executed.
 *   - Matching is case-sensitive, except that `classifyPaths` matches a
 *     sensitive or High pattern that names a path (one with a `/`) ignoring
 *     letter case (see there). A bare file name such as `REVIEW.md` and every
 *     owner stay exact: GitHub resolves CODEOWNERS paths case-sensitively.
 *     "Ignoring letter case" is the full Unicode case fold a case-insensitive
 *     file system applies (U+212A, U+017F, U+00DF, U+FB00..U+FB06 read as the
 *     letters they spell), not the narrower fold of a regex flag. A name is
 *     read two ways and either selects it: by the letters of its full fold
 *     (U+00DF is `ss`, so `??` takes it) and as written with the regex flag's
 *     one-to-one fold (U+00DF is one character, so `?` takes it). Keeping the
 *     second reading means the full fold only ever ADDS matches to what the
 *     regex flag selected, `?` included. A name that would need both readings
 *     at once (`a/?ss/b` against `a/\u00DF\u00DF/b`) is not selected.
 *   - `?` takes one code point: an astral name is one character, in exact-case
 *     patterns too.
 *   - A name is matched both as git printed it and with its surrounding
 *     whitespace dropped, so neither spelling escapes a guarded area.
 *
 * `tests/pr-review-paths-property.test.js` compares `matchesPattern` and
 * `classifyPaths` with an independent oracle over seeded generated cases; its
 * header says which name forms it generates and which it does not.
 */

const { isObjectId } = require('./pr-review-scope');

/**
 * Areas that are sensitive with no owner declaration at all (AC-003-2):
 * CI workflow definitions, release gates, installers, the generation
 * pipeline and the project constitution. Frozen so no caller can shrink it.
 */
const DEFAULT_SENSITIVE_PATHS = Object.freeze([
  // CI workflow definitions
  '.github/workflows/**',
  '.github/actions/**',
  '.circleci/**',
  '.gitlab-ci.yml',
  'azure-pipelines.yml',
  'Jenkinsfile',
  // Release gates
  'scripts/validate-*',
  'scripts/publish-*',
  'scripts/release-*',
  // Installers
  'scripts/install-*',
  'install.sh',
  'install.ps1',
  // Generation pipeline
  'scripts/generate-*',
  'scripts/generate-*/**',
  // Project constitution
  'constitution.md',
  'CONSTITUTION.md',
]);

/**
 * Files that declare how review itself behaves. Changing one of these makes a
 * PR sensitive whatever else it touches (AC-003-3), including when no
 * declaration is in force -- that is the case where the first REVIEW.md is
 * being introduced.
 */
const DEFAULT_DECLARATION_PATHS = Object.freeze([
  'REVIEW.md',
  '.github/REVIEW.md',
  'CODEOWNERS',
  '.github/CODEOWNERS',
  'docs/CODEOWNERS',
]);

/** A GitHub team/user handle (`@org/team`, `@alice`) or an email address. */
const OWNER_TOKEN = /^(?:@[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/** Absent is fine; present must be an array of non-empty strings -- never partially read. */
const isOptionalStringList = (value) =>
  value === undefined || (Array.isArray(value) && value.every((entry) => isNonEmptyString(entry)));

/** `path` on a declaration may be absent, one file, or a list of files. */
const isOptionalPathSpec = (value) =>
  value === undefined || isNonEmptyString(value) || (Array.isArray(value) && value.every((e) => isNonEmptyString(e)));

/** Repository-relative form: `./a` and `/a` both mean `a`; trailing slashes are dropped. */
function normalizePath(value, trim = true) {
  const spelled = String(value).replace(/\\/g, '/');
  let path = trim ? spelled.trim() : spelled;
  while (path.startsWith('./')) path = path.slice(2);
  while (path.startsWith('/')) path = path.slice(1);
  while (path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/** `a/b/c.js` -> ['a', 'a/b'] -- the directories a pattern may match on the path's behalf. */
function ancestors(path) {
  const segments = path.split('/');
  const out = [];
  for (let i = 1; i < segments.length; i += 1) out.push(segments.slice(0, i).join('/'));
  return out;
}

const basenameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

/** Every regex metacharacter except the glob ones is matched literally. */
const escapeLiteral = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Glob body -> regex source. `**` crosses `/` and takes any character at all,
 * line terminators included (`.` would skip \n, \r, U+2028 and U+2029); `*` and
 * `?` do not cross `/`. Scanned left to right so a `**` is never seen as two `*`.
 */
function globToRegExpSource(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          // `**/` is zero or more WHOLE directories: `a/**/b` is `a/b` and `a/x/y/b`, never `a/xb`, and `**/foo` is
          // `foo` or `x/foo`, never `xfoo`.
          source += '(?:[\\s\\S]*/)?';
          i += 1;
        } else {
          source += '[\\s\\S]*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeLiteral(char);
    }
  }
  return source;
}

const COMPILED = new Map();

/**
 * Full case fold, one code point at a time: what a case-insensitive file system treats as the same name. The `i`
 * regex flag folds only one letter to one letter, so U+FB02 (`fl`), U+00DF and U+1E9E (`ss`) and U+FB00..U+FB06
 * would be no alias of the ASCII letters they spell on APFS: `.github/work\uFB02ows/ci.yml` is the same file as
 * `.github/workflows/ci.yml` there. Lower -> upper -> lower reaches the multi-letter folds (U+212A and U+017F
 * too), and going per code point keeps Greek final sigma, which is context-sensitive, from folding differently in
 * a pattern than in a path. U+0131 (dotless i) is the one letter whose upper case is an ASCII letter yet which
 * Unicode folds only under Turkic rules (CaseFolding.txt status T), so it stays itself: APFS does not alias it.
 */
function foldCase(text) {
  let out = '';
  for (const char of text) out += char === '\u0131' ? char : char.toLowerCase().toUpperCase().toLowerCase();
  return out;
}

/**
 * Compiles (and caches) one pattern, matching letter case exactly or, when
 * asked, ignoring it for a pattern that names a PATH. Returns null for a
 * pattern that cannot match anything.
 */
function compilePattern(pattern, ignoreCase) {
  const key = `${ignoreCase ? 'i' : 's'}${pattern}`;
  if (COMPILED.has(key)) return COMPILED.get(key);

  let body = pattern.trim().replace(/\\/g, '/');
  const anchored = body.startsWith('/');
  if (anchored) body = body.slice(1);
  const directoryOnly = body.endsWith('/');
  while (body.endsWith('/')) body = body.slice(0, -1);

  // A pattern with no separator matches a basename at any depth, unless anchored.
  const basenameOnly = !anchored && !body.includes('/');

  // Letter case is loosened only for a pattern that names a path. A bare name (`REVIEW.md`, `*.yml`, `docs/`)
  // selects that name at any depth, and another-case spelling of it elsewhere is no alias of anything: loosening
  // it would make every `review.md` in the tree a review file.
  // Loosened by folding pattern AND path with `foldCase` and matching the folded forms exactly, not by the `i`/`iu`
  // regex flags: those fold one letter to one letter, so U+FB02 would escape `workflows`.
  const fold = ignoreCase && !basenameOnly;
  const compiled = body === ''
    ? null
    : {
      // `u`: `?` and `[^/]` take one code point, not half of a surrogate pair, so an astral name is one character
      // here as it is to the file system. Every source is escaped literals plus the glob forms, all valid under `u`.
      regex: new RegExp(`^${globToRegExpSource(fold ? foldCase(body) : body)}$`, 'u'),
      // The fold turns one character into several letters (U+00DF into `ss`), and `?` then takes one LETTER, so the
      // folded form alone would stop a `?` from taking such a character, which it takes as written. The name as
      // written, read with the regex flag's one-to-one fold, is therefore tried as well: the full fold adds matches
      // and takes none away.
      written: fold ? new RegExp(`^${globToRegExpSource(body)}$`, 'iu') : null,
      fold,
      basenameOnly,
      // Only a directory-shaped pattern stands in for the files beneath it.
      coversSubtree: directoryOnly || !/[*?]/.test(body),
      directoryOnly,
    };

  COMPILED.set(key, compiled);
  return compiled;
}

/**
 * Does `pattern` select `path`?
 *
 * @param {string} pattern Glob in the gitignore/CODEOWNERS dialect described above.
 * @param {string} path    Repository-relative path of a changed file.
 * @param {{ignoreCase?: boolean}} [options] `ignoreCase: true` matches letter case loosely; the default is exact.
 * @returns {boolean} false for any non-string input -- an unreadable pattern never matches.
 */
function matchesPattern(pattern, path, options) {
  if (typeof pattern !== 'string' || typeof path !== 'string') return false;
  const compiled = compilePattern(pattern, isObject(options) && options.ignoreCase === true);
  if (!compiled) return false;

  // Both spellings of the name are tried: with surrounding whitespace dropped (a Windows checkout drops it, so
  // `ci.yml ` is `ci.yml`) and as git printed it (a file named ` ` under a guarded directory is still under it).
  // Matching more only asks for more review.
  const spellings = new Set([normalizePath(path), normalizePath(path, false)]);
  spellings.delete('');
  for (const normalized of spellings) {
    // The path itself matches unless the pattern is directory-only. Ancestor
    // directories are tried only for a pattern that names a directory, which
    // is how `docs/` and `src/auth` cover the files beneath them without
    // letting `src/*` reach `src/a/b.js`.
    const self = compiled.directoryOnly ? [] : [normalized];
    const candidates = compiled.coversSubtree ? [...self, ...ancestors(normalized)] : self;
    for (const named of candidates) {
      const candidate = compiled.fold ? foldCase(named) : named;
      if (compiled.regex.test(candidate)) return true;
      if (compiled.written !== null && compiled.written.test(named)) return true;
      if (compiled.basenameOnly && compiled.regex.test(basenameOf(candidate))) return true;
    }
  }
  return false;
}

/** The first pattern in `patterns` that selects `path` (see `matchesPattern` for `options`), or null. */
function firstMatch(patterns, path, options) {
  for (const pattern of patterns) {
    if (matchesPattern(pattern, path, options)) return pattern;
  }
  return null;
}

/**
 * Parses CODEOWNERS text into ordered rules.
 *
 * A line that names no owner, or any owner token that is not a handle or an
 * email, makes the WHOLE line malformed: it is reported and skipped, and no
 * owner is inferred from it (AC: "never guessed").
 *
 * @returns {{rules: Array<{pattern:string, owners:string[]}>, malformed: Array<{line:number,text:string,reason:string}>}}
 */
function parseCodeowners(text) {
  const rules = [];
  const malformed = [];
  if (typeof text !== 'string') return { rules, malformed };

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (raw === '' || raw.startsWith('#')) continue;

    const tokens = [];
    for (const token of raw.split(/\s+/)) {
      if (token.startsWith('#')) break; // trailing comment
      tokens.push(token);
    }

    const [pattern, ...owners] = tokens;
    if (!pattern) continue;

    if (owners.length === 0) {
      malformed.push({ line: index + 1, text: raw, reason: 'no-owners' });
      continue;
    }
    if (!owners.every((owner) => OWNER_TOKEN.test(owner))) {
      malformed.push({ line: index + 1, text: raw, reason: 'invalid-owner' });
      continue;
    }
    rules.push({ pattern, owners });
  }

  return { rules, malformed };
}

/** Last matching rule wins, as GitHub resolves CODEOWNERS. */
function resolveOwners(rules, path) {
  let winner = null;
  for (const rule of rules) {
    if (matchesPattern(rule.pattern, path)) winner = rule;
  }
  return winner
    ? { owners: winner.owners.slice(), matchedBy: winner.pattern }
    : { owners: [], matchedBy: null };
}

/**
 * Owners of one path according to CODEOWNERS text.
 *
 * @param {string} path
 * @param {string} codeownersText
 * @returns {{owners:string[], matchedBy:string|null, malformed:Array<{line:number,text:string,reason:string}>}}
 *   `malformed` lists every unreadable line in the text, so a caller can show
 *   them whether or not one of them would have matched this path.
 */
function ownersFor(path, codeownersText) {
  const { rules, malformed } = parseCodeowners(codeownersText);
  if (typeof path !== 'string') return { owners: [], matchedBy: null, malformed };
  const { owners, matchedBy } = resolveOwners(rules, path);
  return { owners, matchedBy, malformed };
}

/** The fail-closed answer: unreadable request, so the PR is treated as sensitive and the reason is named. */
function blocked(reason) {
  return {
    ok: false,
    reason,
    sensitive: [],
    high: [],
    paths: [],
    declarationChanged: true,
    prSensitive: true,
    declarationSource: 'defaults',
    warnings: [reason],
    ownersMalformed: [],
  };
}

/**
 * Sensitive and High patterns that name a path are matched ignoring letter case.
 * A case-insensitive checkout (macOS, Windows) writes `PR-REVIEW-GATE.JS` over
 * `pr-review-gate.js`, and a glob has no way to spell "either case", so such a
 * pattern covers the other-case spellings of its paths. Matching more only asks
 * for MORE review. A bare file name (`REVIEW.md`) stays exact, so `docs/review.md`
 * is no review file, and owners are not matched this way at all, since GitHub
 * resolves CODEOWNERS paths case-sensitively.
 */
const AREA_MATCH = Object.freeze({ ignoreCase: true });

/**
 * Classifies every changed path as sensitive or not, naming the declaration
 * entry that matched.
 *
 * @param {Object} input
 * @param {string[]} input.changedPaths              Repository-relative paths changed by the PR.
 * @param {Object|null} [input.declaration]          The declaration READ FROM THE BASE COMMIT:
 *   `{ sourceSha, path?, sensitive?: string[], high?: string[] }`. Used only when `sourceSha` is a
 *   full object id equal to `baseSha`.
 * @param {string} [input.codeowners]                CODEOWNERS text from the base commit.
 * @param {string} input.baseSha                     The review's base commit (full object id).
 * @returns {{ok:boolean, sensitive:string[], high:string[], declarationChanged:boolean, prSensitive:boolean,
 *   declarationSource:'declaration'|'defaults', paths:Array<Object>, warnings:string[],
 *   ownersMalformed:Array<Object>, reason?:string}}
 *   `sensitive` and `high` list the changed paths (in the order given); `paths` carries the per-path
 *   detail including `matchedBy` and `source` (`declaration`, `default` or `declaration-file`).
 */
function classifyPaths(input) {
  if (!isObject(input)) return blocked('invalid-input');

  const { changedPaths, declaration, codeowners, baseSha, policyUntrusted } = input;
  if (!Array.isArray(changedPaths)) return blocked('invalid-changed-paths');
  if (!changedPaths.every((entry) => isNonEmptyString(entry))) return blocked('invalid-path-entry');

  const warnings = [];

  // A policy that could not be trusted (stale or foreign identity, unparseable) carries no highPaths, so strict
  // defaults would silently LOWER the tier below what the real policy implies (kata vhpf). Fail up instead: every
  // changed path is High, named by the reason, until a trusted policy is in force. Never lowers anything.
  const untrustedReason = typeof policyUntrusted === 'string' && policyUntrusted.trim() !== '' ? policyUntrusted.trim() : null;
  if (untrustedReason !== null) warnings.push(`policy-untrusted-all-high:${untrustedReason}`);

  // --- Which declaration, if any, is in force (REQ-024) -------------------
  let declaredSensitive = [];
  let declaredHigh = [];
  let declarationSource = 'defaults';
  let declarationPaths = DEFAULT_DECLARATION_PATHS.slice();

  if (declaration !== undefined && declaration !== null) {
    if (!isObject(declaration)) {
      warnings.push('declaration-malformed');
    } else if (
      !isObjectId(baseSha)
      || !isObjectId(declaration.sourceSha)
      || declaration.sourceSha.toLowerCase() !== baseSha.toLowerCase()
    ) {
      // A declaration from the PR head, with no identity, or graded against a
      // bare ref is never read: strict defaults apply instead.
      warnings.push('declaration-not-from-base');
    } else if (
      !isOptionalStringList(declaration.sensitive)
      || !isOptionalStringList(declaration.high)
      || !isOptionalPathSpec(declaration.path)
    ) {
      warnings.push('declaration-malformed');
    } else {
      declaredSensitive = declaration.sensitive ? declaration.sensitive.slice() : [];
      declaredHigh = declaration.high ? declaration.high.slice() : [];
      declarationSource = 'declaration';
      const declared = declaration.path === undefined
        ? []
        : [].concat(declaration.path).map(normalizePath);
      declarationPaths = [...new Set([...declared, ...DEFAULT_DECLARATION_PATHS])];
    }
  }

  const declarationPathSet = new Set(declarationPaths.map(normalizePath));

  // --- Owners -------------------------------------------------------------
  const { rules: ownerRules, malformed: ownersMalformed } = parseCodeowners(codeowners);
  if (ownersMalformed.length > 0) warnings.push('codeowners-malformed');

  // --- Per-path classification -------------------------------------------
  const paths = [];
  const sensitive = [];
  const high = [];
  let declarationChanged = false;

  for (const original of changedPaths) {
    const normalized = normalizePath(original);

    const isDeclarationFile = declarationPathSet.has(normalized);
    if (isDeclarationFile) declarationChanged = true;

    // Order of precedence for the reported reason: the declaration file
    // itself, then an owner declaration entry, then the built-in floor.
    let matchedBy = null;
    let source = null;
    if (isDeclarationFile) {
      matchedBy = normalized;
      source = 'declaration-file';
    } else {
      const declaredMatch = firstMatch(declaredSensitive, original, AREA_MATCH);
      if (declaredMatch !== null) {
        matchedBy = declaredMatch;
        source = 'declaration';
      } else {
        const defaultMatch = firstMatch(DEFAULT_SENSITIVE_PATHS, original, AREA_MATCH);
        if (defaultMatch !== null) {
          matchedBy = defaultMatch;
          source = 'default';
        }
      }
    }

    // The matchers get the name as git printed it: they try it both with and without its surrounding whitespace, and
    // a name already trimmed here would lose the second spelling.
    const highMatchedBy = untrustedReason !== null
      ? `policy-untrusted:${untrustedReason}`
      : firstMatch(declaredHigh, original, AREA_MATCH);
    const { owners } = resolveOwners(ownerRules, original);

    const isSensitive = source !== null;
    if (isSensitive) sensitive.push(original);
    if (highMatchedBy !== null) high.push(original);

    paths.push({
      path: original,
      sensitive: isSensitive,
      matchedBy,
      source,
      high: highMatchedBy !== null,
      highMatchedBy,
      declarationFile: isDeclarationFile,
      owners,
    });
  }

  return {
    ok: true,
    sensitive,
    high,
    declarationChanged,
    prSensitive: declarationChanged || sensitive.length > 0,
    declarationSource,
    paths,
    warnings,
    ownersMalformed,
  };
}

module.exports = {
  classifyPaths,
  ownersFor,
  matchesPattern,
  parseCodeowners,
  DEFAULT_SENSITIVE_PATHS,
  DEFAULT_DECLARATION_PATHS,
};
