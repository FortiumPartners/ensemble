'use strict';

/**
 * Seeded property/fuzz harness for the approval-gate glob and path matcher
 * (`packages/development/lib/pr-review-paths.js`), kata g1r4, plan 3F.
 *
 * The example-based suites (`pr-review-paths*.test.js`) pin the cases someone
 * thought of. A matcher that decides "does this PR touch a sensitive path" is
 * exactly the code where the case nobody thought of is the finding, and three
 * LLM review rounds found them one at a time (Kelvin sign, long s, ligatures,
 * U+2028 in a name). This file generates the cases instead and compares the
 * production matcher with an INDEPENDENT oracle:
 *
 *   - The oracle shares no code with the production module: no regex is built
 *     from a pattern, it matches by dynamic programming over arrays of
 *     case-folded units, and its folds are explicit alias tables, not
 *     `toLowerCase` or the `i`/`u` regex flags the production code leans on.
 *   - The tables are the ground truth of what a case-insensitive file system
 *     does, not of what a JS regex does: on APFS, `U+212A` names `k`, `U+017F`
 *     names `s`, and the FULL fold also maps `U+00DF`, `U+1E9E` to `ss` and
 *     `U+FB00`..`U+FB06` to `ff`, `fi`, `fl`, `ffi`, `ffl`, `st`. (Checked by
 *     creating `fl` and `ss` on APFS and opening them as `\uFB02` and `\u00DF`.)
 *     The `iu` regex flag folds only the one-to-one aliases, so `work\uFB02ows`
 *     would escape `.github/workflows/**` on such a checkout. The oracle reads
 *     a case-loosened name both ways, as the matcher's header says, and either
 *     reading selects it: by the full fold (`ONE_TO_MANY`: a character may
 *     become several letters, so `?` counts letters) and with the one-to-one
 *     fold only (`ONE_TO_ONE`: a character stays one, so `?` counts written
 *     characters).
 *
 * Reproducibility: the cases are a pure function of the seed. The default seed
 * is fixed, so CI is deterministic; `PR_REVIEW_FUZZ_SEED=<int>` (decimal or
 * 0x-hex) explores another run, and every failure prints the seed and the case
 * index to replay it.
 *
 * What a run generates (the reviewer brief points here, so this list is the
 * claim and a test below checks that each form is reached):
 *   - Names: ASCII and Latin-1 letters in either case; the case-fold aliases
 *     Kelvin U+212A, long s U+017F, sharp s U+00DF and U+1E9E, ligatures
 *     U+FB00..U+FB06, Ohm U+2126, Angstrom U+212B, Greek omega, sigma and
 *     final sigma; dotted capital I U+0130 and dotless i U+0131; the regex
 *     metacharacters ( ) + | ^ $ { } [ ]; newline, CR, tab, space, NBSP,
 *     U+2028, U+2029 and NUL (NUL only for `matchesPattern`: git cannot print
 *     one); an astral character; `./`, `/` and `\` forms; whitespace around a
 *     name; a trailing `/`.
 *   - Patterns: a name's segments with some kept, some replaced by `*`, `?`,
 *     `**` or `**` + `/`, some cut off, an alias spelling, a leading or
 *     trailing `/`, whitespace at the pattern's edge; random globs; and a
 *     family that sets `?`, `*` and the letters a character folds to against
 *     names holding a character whose fold is several letters.
 *   - `classifyPaths`: the default floor and the declaration files, declared
 *     sensitive and High patterns and CODEOWNERS rules (owners), over names
 *     that travel through the real `git diff --numstat -z --no-renames`
 *     parser (`parseNumstatZ`).
 *
 * NOT generated, or not modelled (so not claimed): Unicode normalization (APFS
 * is also normalization-insensitive); combining marks written apart from their
 * base letter; other file systems' folds (NTFS, ext4 casefold: only APFS was
 * checked); bracket classes, `!` negation and backslash escapes in patterns
 * (the matcher has none and the generator never emits an escape); paths of
 * more than five segments; the declaration `path` key; a malformed declaration
 * or CODEOWNERS line. And the rules themselves: the oracle is written from the
 * same documented rules as the matcher (fold, then match; two readings of a
 * case-loosened name; the subtree rule; the two whitespace spellings), so
 * agreement shows the code follows them, not that they are the right ones.
 */

const fs = require('fs');
const path = require('path');

const {
  matchesPattern,
  classifyPaths,
  DEFAULT_SENSITIVE_PATHS,
  DEFAULT_DECLARATION_PATHS,
} = require('../lib/pr-review-paths');
const { parseNumstatZ } = require('../lib/pr-review-prepare');

/** A non-negative whole number from the environment, decimal or 0x-hex; anything else is an error, never a quiet 0. */
function envInteger(name, fallback, env = process.env) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name}=${JSON.stringify(raw)} is not a non-negative whole number (decimal, or 0x-prefixed hex)`);
  }
  return value;
}

const DEFAULT_SEED = 0x5eed1234;
const SEED = envInteger('PR_REVIEW_FUZZ_SEED', DEFAULT_SEED) >>> 0;
const CASES = envInteger('PR_REVIEW_FUZZ_CASES', 60000);
const REPLAY = (seed) =>
  `PR_REVIEW_FUZZ_SEED=${seed} PR_REVIEW_FUZZ_CASES=${CASES} npx jest tests/pr-review-paths-property.test.js`;
const BASE = 'b'.repeat(40);

// The generated tests run in time proportional to the case count (about 2.5 s for the default 60,000 pairs on a quiet
// machine, the oracle reading a case-loosened name two ways), and a widened run (`PR_REVIEW_FUZZ_CASES=200000`) takes
// several times that: jest's 5 s default would turn a slow runner into a failure that is not a finding.
jest.setTimeout(Math.max(60000, CASES * 3));

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32): the only source of randomness in this file.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  const pick = (list) => list[int(list.length)];
  const chance = (p) => next() < p;
  return { next, int, pick, chance };
}

// ---------------------------------------------------------------------------
// The oracle.
// ---------------------------------------------------------------------------

/**
 * Folds a character to ONE character: what the regex `i` flag does under `u` (Unicode simple case folding), and what
 * a case-insensitive file system does for these. U+1E9E folds to U+00DF here (simple fold), to `ss` in the full fold.
 */
const ONE_TO_ONE = Object.freeze({
  '\u212A': 'k', // KELVIN SIGN
  '\u017F': 's', // LATIN SMALL LETTER LONG S
  '\u1E9E': '\u00DF', // CAPITAL SHARP S -> SHARP S
  '\uFB05': '\uFB06', // LONG S T LIGATURE: V8 closes it over U+FB06 (both fold to `st`), which the spec's simple fold does not
  '\u2126': '\u03C9', // OHM SIGN
  '\u212B': '\u00E5', // ANGSTROM SIGN
  '\u00C5': '\u00E5',
  '\u00C9': '\u00E9',
  '\u00DC': '\u00FC',
  '\u00C4': '\u00E4',
  '\u03A9': '\u03C9',
  '\u03A3': '\u03C3',
  '\u03C2': '\u03C3', // FINAL SIGMA
});

/** Full case folding (CaseFolding.txt status F): ONE character that is several letters once folded. */
const ONE_TO_MANY = Object.freeze({
  '\u00DF': 'ss', // SHARP S
  '\u1E9E': 'ss', // CAPITAL SHARP S
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
  '\u0130': 'i\u0307', // DOTTED CAPITAL I: i + combining dot above, and NOT `i`
});

/**
 * A string as an array of comparable units. `exact`: the characters as written. `oneToOne`: ASCII and the one-to-one
 * folds only. `full`: those plus the one-to-many folds, so one character may be several units.
 */
function units(text, mode) {
  const out = [];
  for (const ch of text) {
    if (mode === 'full' && ONE_TO_MANY[ch] !== undefined) {
      out.push(...ONE_TO_MANY[ch]);
    } else if (mode !== 'exact' && ONE_TO_ONE[ch] !== undefined) {
      out.push(ONE_TO_ONE[ch]);
    } else if (mode !== 'exact' && ch >= 'A' && ch <= 'Z') {
      out.push(String.fromCharCode(ch.charCodeAt(0) + 32));
    } else {
      out.push(ch);
    }
  }
  return out;
}

/** `./a`, `/a` and `a/` all name `a`; `\` is a separator. No other change: a name is not trimmed. */
function oracleNormalize(raw, trim) {
  let text = raw.split('\\').join('/');
  if (trim) text = text.trim();
  let start = 0;
  while (text.startsWith('./', start)) start += 2;
  while (text[start] === '/') start += 1;
  let end = text.length;
  while (end > start && text[end - 1] === '/') end -= 1;
  return text.slice(start, end);
}

function tokenize(body, mode) {
  const tokens = [];
  const chars = [...body];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === '*' && chars[i + 1] === '*') {
      i += 1;
      if (chars[i + 1] === '/') {
        i += 1;
        tokens.push({ kind: 'dirs' }); // `**/`: zero or more WHOLE directories
      } else {
        tokens.push({ kind: 'any' }); // `**`: anything, `/` included
      }
    } else if (ch === '*') {
      tokens.push({ kind: 'run' }); // `*`: anything but `/`
    } else if (ch === '?') {
      tokens.push({ kind: 'one' }); // `?`: one unit but `/`
    } else {
      for (const unit of units(ch, mode)) tokens.push({ kind: 'lit', unit });
    }
  }
  return tokens;
}

function globMatch(tokens, text) {
  const memo = new Map();
  const walk = (ti, ui) => {
    const key = ti * 100003 + ui;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (ti === tokens.length) {
      result = ui === text.length;
    } else {
      const token = tokens[ti];
      switch (token.kind) {
        case 'lit':
          result = ui < text.length && text[ui] === token.unit && walk(ti + 1, ui + 1);
          break;
        case 'one':
          result = ui < text.length && text[ui] !== '/' && walk(ti + 1, ui + 1);
          break;
        case 'run': {
          result = false;
          for (let j = ui; ; j += 1) {
            if (walk(ti + 1, j)) { result = true; break; }
            if (j >= text.length || text[j] === '/') break;
          }
          break;
        }
        case 'any': {
          result = false;
          for (let j = ui; j <= text.length; j += 1) {
            if (walk(ti + 1, j)) { result = true; break; }
          }
          break;
        }
        default: { // 'dirs'
          result = walk(ti + 1, ui);
          for (let j = ui + 1; !result && j <= text.length; j += 1) {
            if (text[j - 1] === '/' && walk(ti + 1, j)) result = true;
          }
        }
      }
    }
    memo.set(key, result);
    return result;
  };
  return walk(0, 0);
}

/**
 * The documented semantics of `matchesPattern`, written from the header comment, not from the implementation, for
 * ONE spelling of the name: `trim` drops surrounding whitespace, as a Windows checkout does.
 */
function oracleMatchesSpelling(pattern, rawPath, ignoreCase, trim) {
  let spelled = pattern.trim().split('\\').join('/'); // a pattern is read after trim()
  const anchored = spelled.startsWith('/');
  if (anchored) spelled = spelled.slice(1);
  const directoryOnly = spelled.endsWith('/');
  let end = spelled.length;
  while (end > 0 && spelled[end - 1] === '/') end -= 1;
  const body = spelled.slice(0, end);
  if (body === '') return false;

  const bareName = !anchored && !body.includes('/');
  const subtree = directoryOnly || !/[*?]/.test(body);
  const fold = ignoreCase && !bareName;
  // A case-loosened name is read both ways and either selects it; every other name is read as written.
  const readings = (fold ? ['full', 'oneToOne'] : ['exact']).map((mode) => ({ mode, tokens: tokenize(body, mode) }));

  const path = oracleNormalize(rawPath, trim);
  if (path === '') return false;
  const segments = path.split('/');

  const named = [];
  if (!directoryOnly) named.push(segments);
  if (subtree) for (let i = 1; i < segments.length; i += 1) named.push(segments.slice(0, i));

  return named.some((thing) => {
    // A bare name is tried against the whole name AND its last segment: `**` crosses `/`, so `a**` reaches `a/x`.
    const targets = bareName ? [thing.join('/'), thing[thing.length - 1]] : [thing.join('/')];
    return targets.some((target) => readings.some(({ mode, tokens }) => globMatch(tokens, units(target, mode))));
  });
}

/** A path matches when the name matches as git printed it OR with its surrounding whitespace dropped (more review, never less). */
function oracleMatches(pattern, rawPath, ignoreCase) {
  return oracleMatchesSpelling(pattern, rawPath, ignoreCase, false) || oracleMatchesSpelling(pattern, rawPath, ignoreCase, true);
}

/** What `classifyPaths` must answer for each name: sensitive, High, and the owners of the last CODEOWNERS rule that matches. */
function oracleClassify({ names, declaration, rules }) {
  return names.map((name) => {
    const declarationFile = DEFAULT_DECLARATION_PATHS.some((file) => oracleNormalize(name, true) === file);
    const declared = declaration !== null && declaration.sensitive.some((pattern) => oracleMatches(pattern, name, true));
    const floor = DEFAULT_SENSITIVE_PATHS.some((pattern) => oracleMatches(pattern, name, true));
    const high = declaration !== null && declaration.high.some((pattern) => oracleMatches(pattern, name, true));
    let winner = null;
    for (const rule of rules) if (oracleMatches(rule.pattern, name, false)) winner = rule;
    return { sensitive: declarationFile || declared || floor, declared, high, owners: winner ? winner.owners : [] };
  });
}

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

const ATOMS = [
  '.github', 'workflows', 'actions', '.circleci', 'scripts', 'generate-codex', 'generate-x', 'validate-all.js',
  'publish-npm.sh', 'release-notes', 'install-hook', 'install.sh', 'install.ps1', 'Jenkinsfile', 'constitution.md',
  'CONSTITUTION.md', 'REVIEW.md', 'CODEOWNERS', 'packages', 'development', 'lib', 'pr-review-paths.js', 'skills',
  'pr-review-cycle', 'SKILL.md', 'docs', 'src', 'auth', 'a', 'b', 'c.yml', 'ci.yml', 'index.js', 'azure-pipelines.yml',
  '.gitlab-ci.yml', 'test', 'dist',
  // Names whose letters have case-fold aliases (`ss`, `ff`, `fi`, Greek, Angstrom): respelled below.
  'assets', 'config', 'office', 'staff', 'caf\u00E9', '\u00E5ngstrom', '\u03C9mega',
];
const METACHARS = ['(', ')', '+', '|', '^', '$', '{', '}', '[', ']'];
// Characters a name may hold that a glob engine must not trip over. No `*`/`?` (a pattern cannot spell them
// literally) and no `/` or `\` (separators).
const JUNK = [
  'a', 'b', 'k', 'K', 's', 'S', 'f', 'l', 'i', 't', 'x', 'z', '.', '-', '_', ' ', '0',
  '\n', '\r', '\t', '\u2028', '\u2029', '\0', '\u00A0', '\u00E9', '\u00C9', '\u65E5', '\u{1F600}',
  ...METACHARS,
  '\u0130', '\u0131', '\u00DF', '\u1E9E', '\uFB01', '\uFB06', '\u212A', '\u017F',
  '\u03C9', '\u03A9', '\u2126', '\u00E5', '\u212B', '\u03C3', '\u03C2', '\u03A3',
];
const ALIASES = [
  ['k', '\u212A'], ['s', '\u017F'], ['ss', '\u00DF'], ['ss', '\u1E9E'], ['ff', '\uFB00'], ['fi', '\uFB01'],
  ['fl', '\uFB02'], ['ffi', '\uFB03'], ['ffl', '\uFB04'], ['st', '\uFB05'], ['st', '\uFB06'],
  ['\u03C9', '\u2126'], ['\u00E5', '\u212B'], ['\u03C3', '\u03C2'],
];

function flipCase(rng, text) {
  let out = '';
  for (const ch of text) {
    const swapped = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
    out += rng.chance(0.3) && swapped.length === 1 ? swapped : ch;
  }
  return out;
}

/** Re-spells a name the way another case, or a Unicode alias, would. */
function respell(rng, text) {
  let out = flipCase(rng, text);
  for (const [plain, alias] of ALIASES) {
    let at = out.toLowerCase().indexOf(plain);
    while (at !== -1) {
      if (rng.chance(0.5)) {
        out = out.slice(0, at) + alias + out.slice(at + plain.length);
        at = out.toLowerCase().indexOf(plain, at + 1);
      } else {
        at = out.toLowerCase().indexOf(plain, at + plain.length);
      }
    }
  }
  return out;
}

function junkSegment(rng) {
  let out = '';
  const length = 1 + rng.int(5);
  for (let i = 0; i < length; i += 1) out += rng.pick(JUNK);
  return out;
}

function segmentList(rng) {
  const length = 1 + rng.int(5);
  const list = [];
  for (let i = 0; i < length; i += 1) list.push(rng.chance(0.75) ? rng.pick(ATOMS) : junkSegment(rng));
  return list;
}

/** Some segments re-spelled the way a case-insensitive checkout can spell them. */
function spellSegments(rng, segments) {
  return segments.map((segment) => (rng.chance(0.45) ? respell(rng, segment) : segment));
}

/** The segments joined the way git can print a changed path: separators, prefixes, surrounding whitespace. */
function joinPath(rng, spelled) {
  let text = spelled[0];
  for (let i = 1; i < spelled.length; i += 1) text += (rng.chance(0.04) ? '\\' : '/') + spelled[i];
  if (rng.chance(0.15)) text = rng.pick(['./', '/', '././']) + text;
  if (rng.chance(0.05)) text += '/';
  if (rng.chance(0.04)) text = rng.pick([' ', '\n', '\u2028', '\u00A0']) + text;
  if (rng.chance(0.04)) text += rng.pick([' ', '\n', '\u2028', '\u00A0']);
  return text;
}

/** A changed path as git can print it, including the spellings a checkout can alias. */
function makePath(rng, segments) {
  return joinPath(rng, spellSegments(rng, segments));
}

/** A glob read off a path: some segments kept, some wildcarded, the rest cut off. */
function deriveGlob(rng, segments) {
  const keep = 1 + rng.int(segments.length);
  const parts = segments.slice(0, keep).map((segment) => {
    const roll = rng.next();
    if (roll < 0.5) return rng.chance(0.3) ? respell(rng, segment) : segment;
    if (roll < 0.62) return '*';
    if (roll < 0.74) { // wildcard one character or a span of the name
      const at = rng.int(segment.length);
      return `${segment.slice(0, at)}?${segment.slice(at + 1)}`;
    }
    if (roll < 0.88) {
      const at = rng.int(segment.length + 1);
      return `${segment.slice(0, at)}*${segment.slice(at + rng.int(3))}`;
    }
    return segment.length > 1 ? `*${segment.slice(1 + rng.int(segment.length - 1))}` : '*';
  });
  if (parts.length > 1 && rng.chance(0.25)) parts[rng.int(parts.length - 1)] = '**';
  if (keep < segments.length && rng.chance(0.3)) parts[parts.length - 1] = '**';
  if (rng.chance(0.1)) parts.unshift('**');
  let glob = parts.join('/');
  if (rng.chance(0.2)) glob = `/${glob}`;
  if (rng.chance(0.25) && !glob.endsWith('**')) glob += '/';
  return glob;
}

function randomGlob(rng) {
  const length = 1 + rng.int(4);
  const parts = [];
  for (let i = 0; i < length; i += 1) {
    const roll = rng.next();
    if (roll < 0.15) parts.push('*');
    else if (roll < 0.22) parts.push('**');
    else if (roll < 0.35) parts.push(`${rng.pick(ATOMS).slice(0, 3)}*`);
    else if (roll < 0.45) parts.push(`*${rng.pick(['.js', '.yml', '.md', '-all.js', 'ws'])}`);
    else if (roll < 0.55) parts.push(`${rng.pick(['a', 'b', 'x'])}?`);
    else if (roll < 0.6) parts.push(`${rng.pick(ATOMS).slice(0, 2)}${rng.pick(METACHARS)}*`);
    else if (roll < 0.64) parts.push(rng.pick(['?', '??']));
    else parts.push(rng.chance(0.3) ? respell(rng, rng.pick(ATOMS)) : rng.pick(ATOMS));
  }
  let glob = parts.join('/');
  if (rng.chance(0.15)) glob = `/${glob}`;
  if (rng.chance(0.2) && !glob.endsWith('**')) glob += '/';
  return glob;
}

const MULTI = Object.keys(ONE_TO_MANY);

/**
 * The family a case-fold narrowing of `?` lives in: a name holding a character that is ONE character as written but
 * SEVERAL letters once folded, set against `?`, `*`, the character itself and the letters it folds to.
 */
function multiFoldCase(rng) {
  const pool = [...MULTI, ...MULTI, 'a', 's', 'x', 'f', 'i', 'k', '\u212A', '\u017F'];
  const written = [];
  const length = 1 + rng.int(3);
  for (let i = 0; i < length; i += 1) written.push(rng.pick(pool));
  const part = (unit) => {
    const roll = rng.next();
    if (roll < 0.34) return '?';
    if (roll < 0.52) return unit;
    if (roll < 0.74) return ONE_TO_MANY[unit] !== undefined ? ONE_TO_MANY[unit] : unit; // the letters it folds to
    if (roll < 0.82) return '*';
    return unit.toUpperCase();
  };
  const dir = rng.pick(['a', 'docs', 'private']);
  const path = `${dir}/${written.join('')}${rng.chance(0.5) ? '/x.md' : ''}`;
  const pattern = `${dir}/${written.map(part).join('')}${rng.pick(['', '', '/x.md', '/*', '/**'])}`;
  return { pattern, path, ignoreCase: rng.chance(0.85) };
}

function* generateCases(seed, count) {
  const rng = makeRng(seed);
  for (let index = 0; index < count; index += 1) {
    if (rng.chance(0.08)) {
      yield { index, ...multiFoldCase(rng) };
    } else {
      const segments = segmentList(rng);
      const spelled = spellSegments(rng, segments);
      const path = joinPath(rng, spelled);
      // A pattern is read after `trim()`, so whitespace at its edges is generated too.
      const pattern = rng.chance(0.7) ? deriveGlob(rng, rng.chance(0.35) ? spelled : segments) : randomGlob(rng);
      yield { index, pattern, path, ignoreCase: rng.chance(0.6) };
    }
  }
}

const OWNERS = ['@org/team', '@alice', 'bob@example.com'];

/** One PR's worth of input for `classifyPaths`: names, a declaration (or none), CODEOWNERS rules. */
function* generateClassifyBatches(seed, count) {
  const rng = makeRng(seed);
  for (let batch = 0; batch < count; batch += 1) {
    // A rename is two entries under --no-renames; both sides go through the grader. git cannot print a NUL in a name.
    const lists = Array.from({ length: 1 + rng.int(4) }, () => segmentList(rng));
    const names = lists
      .map((segments) => makePath(rng, segments).replace(/\0/g, ''))
      .filter((name) => name.trim() !== '');
    if (names.length === 0) continue;

    const globs = (max) => {
      const out = [];
      for (let i = rng.int(max + 1); i > 0; i -= 1) {
        const glob = rng.chance(0.75) ? deriveGlob(rng, rng.pick(lists)) : randomGlob(rng);
        if (glob.trim() !== '') out.push(glob); // a blank entry would make the whole declaration malformed
      }
      return out;
    };
    const declaration = rng.chance(0.75) ? { sourceSha: BASE, sensitive: globs(3), high: globs(3) } : null;

    const rules = [];
    for (let i = rng.chance(0.6) ? 1 + rng.int(4) : 0; i > 0; i -= 1) {
      const pattern = rng.chance(0.75) ? deriveGlob(rng, rng.pick(lists)) : randomGlob(rng);
      // A CODEOWNERS line is split on whitespace, and a leading `#` starts a comment: such a pattern cannot be written.
      if (/\s/.test(pattern) || pattern.startsWith('#')) continue;
      rules.push({ pattern, owners: rng.chance(0.5) ? [rng.pick(OWNERS)] : [OWNERS[0], OWNERS[1]] });
    }
    const codeowners = rules.length > 0 ? rules.map((rule) => `${rule.pattern} ${rule.owners.join(' ')}`).join('\n') : undefined;
    yield { batch, names, declaration, rules, codeowners };
  }
}

/** `git diff --numstat -z --no-renames`: `<added>\t<deleted>\t<path>\0` per file, the path verbatim. */
const numstatListing = (names) => names.map((name) => `1\t0\t${name}\0`).join('');

// ---------------------------------------------------------------------------
// Properties.
// ---------------------------------------------------------------------------

function fail(title, mismatches, extra = '') {
  if (mismatches.length === 0) return;
  const shown = mismatches.slice(0, 8).map((m) => JSON.stringify(m)).join('\n');
  throw new Error(
    `${title}: ${mismatches.length} mismatch(es). seed=${SEED}; replay with ${REPLAY(SEED)}${extra}\n${shown}`
  );
}

describe('pr-review-paths property harness: the cases are a function of the seed', () => {
  test('the same seed generates the same cases, another seed generates others', () => {
    const run = (seed) => [...generateCases(seed, 500)];
    expect(run(SEED)).toEqual(run(SEED));
    expect(run(SEED)).not.toEqual(run(SEED + 1));
    const batches = (seed) => [...generateClassifyBatches(seed, 200)];
    expect(batches(SEED)).toEqual(batches(SEED));
    expect(batches(SEED)).not.toEqual(batches(SEED + 1));
  });

  test('a seed or case count that is not a whole number is refused, never read as 0', () => {
    expect(envInteger('X', 7, {})).toBe(7);
    expect(envInteger('X', 7, { X: '42' })).toBe(42);
    expect(envInteger('X', 7, { X: '0x5eed1234' })).toBe(0x5eed1234);
    for (const bad of ['', ' ', 'abc', '-3', '12.5', '0xzz', 'NaN']) {
      expect(() => envInteger('X', 7, { X: bad })).toThrow(/X=.* is not a non-negative whole number/);
    }
  });

  test('the generator reaches the forms the header says it generates', () => {
    const cases = [...generateCases(SEED, CASES)];
    const seen = (test) => cases.some(test);
    const names = (test) => seen((c) => test(c.path));
    expect(names((p) => p.includes('\u212A') || p.includes('\u017F'))).toBe(true);
    expect(names((p) => /[\u00DF\u1E9E\uFB00-\uFB06]/.test(p))).toBe(true);
    expect(names((p) => /[\u2126\u212B\u03C9\u03A9\u00E5\u00C5\u03C3\u03C2\u03A3]/.test(p))).toBe(true);
    expect(names((p) => p.includes('\u0130'))).toBe(true);
    expect(names((p) => p.includes('\u0131'))).toBe(true);
    expect(names((p) => /[()+|^${}[\]]/.test(p))).toBe(true);
    expect(names((p) => /[\n\r\u2028\u2029]/.test(p))).toBe(true);
    expect(names((p) => p.includes('\t') || p.includes('\u00A0'))).toBe(true);
    expect(names((p) => p.includes('\0'))).toBe(true);
    expect(names((p) => p.includes('\u{1F600}'))).toBe(true);
    expect(names((p) => p.includes('\\') && p.indexOf('\\') > 0)).toBe(true);
    expect(names((p) => /^\s|\s$/.test(p))).toBe(true);
    expect(names((p) => p.endsWith('/'))).toBe(true);
    expect(names((p) => p.startsWith('./'))).toBe(true);
    expect(names((p) => p.startsWith('/'))).toBe(true);
    expect(seen((c) => /[()+|^${}[\]]/.test(c.pattern))).toBe(true);
    expect(seen((c) => /^\s|\s$/.test(c.pattern))).toBe(true);
    expect(seen((c) => c.pattern.includes('**/'))).toBe(true);
    expect(seen((c) => c.pattern.endsWith('/'))).toBe(true);
    expect(seen((c) => c.pattern.startsWith('/'))).toBe(true);
    expect(seen((c) => /[\u00DF\u1E9E\uFB00-\uFB06\u0130\u212A\u017F]/.test(c.pattern))).toBe(true);
    // The multi-letter fold family: `?` and `*` against a character that folds to several letters, on both answers.
    const multi = (c) => c.pattern.includes('?') && MULTI.some((m) => c.path.includes(m));
    expect(seen((c) => multi(c) && oracleMatches(c.pattern, c.path, c.ignoreCase))).toBe(true);
    expect(seen((c) => multi(c) && !oracleMatches(c.pattern, c.path, c.ignoreCase))).toBe(true);
    expect(seen((c) => oracleMatches(c.pattern, c.path, c.ignoreCase))).toBe(true);
    expect(seen((c) => !oracleMatches(c.pattern, c.path, c.ignoreCase))).toBe(true);
    // A healthy share of cases must be positives, or agreement on "no" proves little.
    const positives = cases.filter((c) => oracleMatches(c.pattern, c.path, c.ignoreCase)).length;
    expect(positives / cases.length).toBeGreaterThan(0.15);
  });

  test('the classifyPaths generator reaches declarations, High patterns and owners, on both answers', () => {
    const rows = [...generateClassifyBatches(SEED, 3000)].flatMap((b) => oracleClassify(b).map((row) => ({ ...row, batch: b })));
    expect(rows.some((r) => r.batch.declaration === null)).toBe(true);
    expect(rows.some((r) => r.declared)).toBe(true);
    expect(rows.some((r) => r.batch.declaration !== null && !r.declared)).toBe(true);
    expect(rows.some((r) => r.high)).toBe(true);
    expect(rows.some((r) => r.batch.declaration !== null && r.batch.declaration.high.length > 0 && !r.high)).toBe(true);
    expect(rows.some((r) => r.owners.length > 0)).toBe(true);
    expect(rows.some((r) => r.batch.rules.length > 0 && r.owners.length === 0)).toBe(true);
    expect(rows.some((r) => r.sensitive && !r.declared)).toBe(true); // the default floor and declaration files answer alone
    expect(rows.some((r) => r.batch.names.some((n) => n !== n.trim()))).toBe(true);
    expect(rows.some((r) => r.batch.names.some((n) => DEFAULT_DECLARATION_PATHS.includes(oracleNormalize(n, true))))).toBe(true);
  });
});

describe('pr-review-paths property harness: the oracle itself', () => {
  // The oracle is only worth anything if it can tell the answers apart.
  test.each([
    ['a/**/b', 'a/b', false, true],
    ['a/**/b', 'a/x/y/b', false, true],
    ['a/**/b', 'a/xb', false, false],
    ['**/foo', 'barfoo', false, false],
    ['**/foo', 'x/foo', false, true],
    ['src/*', 'src/a/b.js', false, false],
    ['src/auth', 'src/auth/a.js', false, true],
    ['docs/', 'docs', false, false],
    ['.github/workflows/**', '.github/workflows/a\nb.yml', false, true],
    ['scripts/ci-local.js', '\u017Fcripts/ci-local.js', true, true],
    ['scripts/ci-local.js', '\u017Fcripts/ci-local.js', false, false],
    ['.github/workflows/**', '.github/work\uFB02ows/ci.yml', true, true],
    ['packages/**/pr-review-*', 'packages/a/pr-revie\u017F', true, false],
    ['a/ss/b', 'a/\u00DF/b', true, true],
    ['REVIEW.md', 'docs/review.md', true, false],
    // `?` is one character as written, so it takes a character whose full fold is several letters (the one-to-one
    // reading), and the full fold reads that character as its letters, so `??` takes it too.
    ['a/?/b', 'a/\u00DF/b', true, true],
    ['a/?/b', 'a/\uFB01/b', true, true],
    ['a/?/b', 'a/\u0130/b', true, true],
    ['a/??/b', 'a/\u00DF/b', true, true],
    ['a/?s/b', 'a/\u00DF/b', true, true],
    ['a/???/b', 'a/\u00DF/b', true, false],
    ['a/?ss/b', 'a/\u00DFss/b', true, true],
    // A name that would need both readings at once is not selected (the matcher's header says so).
    ['a/?ss/b', 'a/\u00DF\u00DF/b', true, false],
    // Exact case: one character as written, no fold.
    ['a/?/b', 'a/\u00DF/b', false, true],
    ['a/??/b', 'a/\u00DF/b', false, false],
    ['a/ss/b', 'a/\u00DF/b', false, false],
    // The dotted capital I is `i` plus a dot, not `i`; the dotless i is no `i` either.
    ['a/i/b', 'a/\u0130/b', true, false],
    ['a/i/b', 'a/\u0131/b', true, false],
    // A bare pattern holding `**` also reaches across segments, because `**` takes `/`.
    ['a**', 'a/x', false, true],
    ['a*', 'a/x', false, false],
    // A pattern is read after trim().
    ['  docs/a.md\n', 'docs/a.md', false, true],
    ['\u2028/docs/', 'docs/x', false, true],
    [' ', 'docs/a.md', false, false],
  ])('%j vs %j (ignoreCase %s) -> %s', (pattern, path, ignoreCase, expected) => {
    expect(oracleMatches(pattern, path, ignoreCase)).toBe(expected);
  });
});

// The matcher keeps one compiled pair of regexes per distinct pattern for the life of the module, and a widened run
// generates hundreds of thousands of distinct patterns: V8's code space for compiled regexes runs out before the heap
// does (a 200,000-case run died inside the regex compiler). Each chunk of cases therefore gets a fresh copy of the
// module, and the previous copy and its cache are collected.
const CHUNK = 20000;
function freshMatchesPattern() {
  jest.resetModules();
  return require('../lib/pr-review-paths').matchesPattern;
}

describe('pr-review-paths property harness: matchesPattern agrees with the oracle', () => {
  test(`${CASES} generated (pattern, path) pairs`, () => {
    const mismatches = [];
    let match = matchesPattern;
    for (const c of generateCases(SEED, CASES)) {
      if (c.index % CHUNK === 0) match = freshMatchesPattern();
      const expected = oracleMatches(c.pattern, c.path, c.ignoreCase);
      const actual = match(c.pattern, c.path, { ignoreCase: c.ignoreCase });
      if (actual !== expected) mismatches.push({ ...c, lib: actual, oracle: expected });
    }
    fail('matchesPattern vs oracle', mismatches);
  });

  test('loosening letter case only ever adds matches', () => {
    const mismatches = [];
    let match = matchesPattern;
    for (const c of generateCases(SEED ^ 0x9e3779b9, CASES / 3)) {
      if (c.index % CHUNK === 0) match = freshMatchesPattern();
      const exact = match(c.pattern, c.path);
      const loose = match(c.pattern, c.path, { ignoreCase: true });
      if (exact && !loose) mismatches.push(c);
    }
    fail('ignoreCase dropped a match', mismatches);
  });
});

describe('pr-review-paths property harness: classifyPaths over `git diff --numstat -z --no-renames` listings', () => {
  test('a name holding a newline, a tab, a space or a line separator stays ONE entry through the production parser', () => {
    const names = ['a b.yml', 'dir/new\nline.yml', '.github/workflows/u\u2028v.yml', 'p\u2029q', 'tab\tname', ' lead', 'trail ', '.circleci/\r'];
    expect(parseNumstatZ(numstatListing(names)).map((entry) => entry.path)).toEqual(names);
  });

  test('every path is graded by the default floor, the declaration files, the declared patterns and CODEOWNERS exactly as the oracle grades it', () => {
    const mismatches = [];
    for (const batch of generateClassifyBatches(SEED ^ 0x51ed270b, 3000)) {
      // The names travel the way prepare sends them: through the numstat -z parser, then into the grader.
      const changedPaths = parseNumstatZ(numstatListing(batch.names)).map((entry) => entry.path);
      if (JSON.stringify(changedPaths) !== JSON.stringify(batch.names)) {
        mismatches.push({ names: batch.names, parsed: changedPaths });
        continue;
      }

      const input = { changedPaths, declaration: batch.declaration, baseSha: BASE };
      if (batch.codeowners !== undefined) input.codeowners = batch.codeowners;
      const result = classifyPaths(input);
      if (!result.ok) { mismatches.push({ names: batch.names, reason: result.reason }); continue; }
      if (result.warnings.length > 0) { mismatches.push({ names: batch.names, warnings: result.warnings }); continue; }

      const expected = oracleClassify(batch);
      changedPaths.forEach((name, i) => {
        const got = result.paths[i];
        const want = expected[i];
        if (got.sensitive !== want.sensitive || got.high !== want.high || JSON.stringify(got.owners) !== JSON.stringify(want.owners)) {
          mismatches.push({
            name,
            declaration: batch.declaration,
            codeowners: batch.codeowners,
            lib: { sensitive: got.sensitive, high: got.high, owners: got.owners },
            oracle: { sensitive: want.sensitive, high: want.high, owners: want.owners },
          });
        }
      });
      const wantSensitive = changedPaths.filter((_, i) => expected[i].sensitive);
      const wantHigh = changedPaths.filter((_, i) => expected[i].high);
      if (JSON.stringify(result.sensitive) !== JSON.stringify(wantSensitive) || JSON.stringify(result.high) !== JSON.stringify(wantHigh)) {
        mismatches.push({ names: batch.names, sensitive: result.sensitive, high: result.high, wantSensitive, wantHigh });
      }
      const declarationChanged = changedPaths.some((name) => DEFAULT_DECLARATION_PATHS.some((file) => oracleNormalize(name, true) === file));
      if (result.prSensitive !== (declarationChanged || wantSensitive.length > 0)) {
        mismatches.push({ names: batch.names, prSensitive: result.prSensitive });
      }
    }
    fail('classifyPaths vs oracle', mismatches);
  });

  // Spellings a case-insensitive checkout resolves onto a guarded file (each verified as an alias on APFS). They
  // are fixed by hand, not by the oracle, so a shared mistake in both cannot hide them. In each the alias sits in a
  // LITERAL part of the guarding pattern: an alias under `*` or `**` would match with the fold removed too.
  test.each([
    ['.github/work\uFB02ows/ci.yml'], // ligature fl, needs the FULL fold: `iu` does not map it to `fl`
    ['.GitHub/Workflows/ci.yml'],
    ['.github/wor\u212Aflows/ci.yml'], // Kelvin sign
    ['SCRIPT\u017F/generate-x/a.js'], // long s
    ['scripts/in\uFB05all-hook'], // ligature st
    ['scripts/in\uFB06all-hook'],
    ['scripts/in\u017Ftall-hook'],
    ['scripts/relea\u017Fe-notes.sh'],
    ['.GITHUB/ACTIONS/x.yml'],
    ['.Circleci/config.yml'],
  ])('the alias %j of a guarded path is sensitive', (changedPath) => {
    const result = classifyPaths({ changedPaths: [changedPath], declaration: null, baseSha: BASE });
    expect(result.paths[0].sensitive).toBe(true);
  });

  // The default floor has no literal `ss`, `ff` or Greek, so these go through a declared pattern outside it.
  test.each([
    ['docs/strasse/**', 'docs/stra\u00DFe/a.md'], // sharp s is `ss`
    ['docs/strasse/**', 'docs/stra\u1E9Ee/a.md'], // capital sharp s too
    ['docs/office/**', 'docs/o\uFB03ce/a.md'], // ligature ffi
    ['docs/staff/**', 'docs/\uFB06aff/a.md'], // ligature st
    ['docs/diff/**', 'docs/di\uFB00/a.md'], // ligature ff
    ['docs/config/**', 'docs/con\uFB01g/a.md'], // ligature fi
    ['docs/\u00E5ngstrom/**', 'docs/\u212Bngstrom/a.md'], // Angstrom sign is a-ring
    ['docs/\u03C9mega/**', 'docs/\u2126mega/a.md'], // Ohm sign is omega
    ['docs/\u03C3/**', 'docs/\u03C2/a.md'], // final sigma is sigma
    ['docs/kilo/**', 'docs/\u212Ailo/a.md'], // Kelvin sign
  ])('a declared pattern %j selects the alias %j', (pattern, changedPath) => {
    const result = classifyPaths({ changedPaths: [changedPath], declaration: { sourceSha: BASE, sensitive: [pattern] }, baseSha: BASE });
    expect(result.paths[0].sensitive).toBe(true);
    expect(result.paths[0].matchedBy).toBe(pattern);
  });

  test.each([
    ['scripts/\u0131nstall-hook'], // dotless i is no alias of i
    ['scripts/\u0130nstall-hook'], // dotted capital I folds to i + U+0307, not to i
    ['.github/workflow/ci.yml'],
    ['github/workflows/ci.yml'],
    ['xscripts/install-hook'],
    ['packages/development/lib/trd-parser.js'],
  ])('the lookalike %j is NOT sensitive', (changedPath) => {
    const result = classifyPaths({ changedPaths: [changedPath], declaration: null, baseSha: BASE });
    expect(result.paths[0].sensitive).toBe(false);
  });
});

// Defects the harness found in the matcher, pinned by hand so they do not depend on the seed reaching them again.
describe('pr-review-paths property harness: defects found by the fuzz, pinned', () => {
  test.each([
    // `**/` is whole directories, not "anything": these matched on the last letters of an unrelated name.
    ['**/foo', 'barfoo', false],
    ['**/foo', 'x/foo', true],
    ['**/foo', 'foo', true],
    ['a/**/b', 'a/xb', false],
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['**/x', 'scripts/generate-codex', false],
  ])('%j vs %j matches: %s', (pattern, changedPath, expected) => {
    expect(matchesPattern(pattern, changedPath)).toBe(expected);
  });

  test.each([
    ['.circleci/\r'],
    ['.circleci/     '],
    ['.github/workflows/     '],
    ['.github/workflows/\u2028'],
    ['scripts/generate-x/\n'],
  ])('a name that is only whitespace under a guarded directory, %j, is still under it', (changedPath) => {
    const result = classifyPaths({ changedPaths: [changedPath], declaration: null, baseSha: BASE });
    expect(result.ok).toBe(true);
    expect(result.paths[0].sensitive).toBe(true);
  });

  test('a path with whitespace around it is graded as git printed it AND with the whitespace dropped', () => {
    expect(classifyPaths({ changedPaths: ['azure-pipelines.yml '], declaration: null, baseSha: BASE }).paths[0].sensitive).toBe(true);
    expect(matchesPattern('skills/', 'skills/     ')).toBe(true);
    expect(matchesPattern('/REVIEW.md', ' REVIEW.md')).toBe(true);
  });

  test('a pattern is read after trim(): whitespace at its edges changes nothing', () => {
    expect(matchesPattern('  docs/a.md\n', 'docs/a.md')).toBe(true);
    expect(matchesPattern('\u2028/docs/', 'docs/x')).toBe(true); // trimmed, then anchored
    expect(matchesPattern(' ', 'docs/a.md')).toBe(false); // nothing is left of it
    expect(matchesPattern('\n/\n', 'docs/a.md')).toBe(false);
  });
});

// `classifyPaths` hands the declared-sensitive, declared-High and CODEOWNERS checks the name AS GIT PRINTED IT: each
// matcher tries it as printed and with its whitespace dropped, and a name already trimmed would lose the first
// spelling, so a name that is only whitespace under a directory would collapse onto the directory itself. The patterns
// here lie outside DEFAULT_SENSITIVE_PATHS, so the default floor cannot answer for the declared checks.
describe('pr-review-paths property harness: the declared, High and owner checks read the name as git printed it', () => {
  const NAMES = ['docs/private/ ', 'docs/private/\r', 'docs/private/\u2028', 'docs/private/\n\n', 'docs/private/\u00A0'];

  test.each(NAMES.map((name) => [name]))('a declared SENSITIVE pattern selects the whitespace-only name %j', (name) => {
    const declaration = { sourceSha: BASE, sensitive: ['docs/private/**'] };
    const result = classifyPaths({ changedPaths: [name], declaration, baseSha: BASE });
    expect(result.ok).toBe(true);
    expect(result.paths[0]).toMatchObject({ sensitive: true, matchedBy: 'docs/private/**', source: 'declaration' });
    expect(result.sensitive).toEqual([name]);
    expect(result.prSensitive).toBe(true);
  });

  test.each(NAMES.map((name) => [name]))('a declared HIGH pattern selects the whitespace-only name %j', (name) => {
    const declaration = { sourceSha: BASE, high: ['docs/private/**'] };
    const result = classifyPaths({ changedPaths: [name], declaration, baseSha: BASE });
    expect(result.ok).toBe(true);
    expect(result.paths[0]).toMatchObject({ high: true, highMatchedBy: 'docs/private/**', sensitive: false });
    expect(result.high).toEqual([name]);
  });

  test.each(NAMES.map((name) => [name]))('a CODEOWNERS rule selects the whitespace-only name %j and names its owners', (name) => {
    const result = classifyPaths({
      changedPaths: [name],
      declaration: null,
      codeowners: 'docs/private/** @org/team bob@example.com\n',
      baseSha: BASE,
    });
    expect(result.ok).toBe(true);
    expect(result.paths[0].owners).toEqual(['@org/team', 'bob@example.com']);
  });

  test('the same patterns still answer for a name with no whitespace in it, and not for a lookalike', () => {
    const declaration = { sourceSha: BASE, sensitive: ['docs/private/**'], high: ['docs/private/**'] };
    const codeowners = 'docs/private/** @org/team\n';
    const inside = classifyPaths({ changedPaths: ['docs/private/a.md'], declaration, codeowners, baseSha: BASE }).paths[0];
    expect(inside).toMatchObject({ sensitive: true, high: true, owners: ['@org/team'] });
    const outside = classifyPaths({ changedPaths: ['docs/private'], declaration, codeowners, baseSha: BASE }).paths[0];
    expect(outside).toMatchObject({ sensitive: false, high: false, owners: [] });
  });

  test('declared sensitive and High patterns that name a path ignore letter case; a bare name and an owner rule stay exact', () => {
    const declaration = { sourceSha: BASE, sensitive: ['Docs/Private/**', 'NOTES.md'], high: ['DOCS/Secret/**'] };
    const codeowners = 'Docs/Owned/** @org/team\n';
    const changedPaths = ['docs/private/a.md', 'docs/secret/a.md', 'docs/owned/a.md', 'sub/notes.md'];
    const result = classifyPaths({ changedPaths, declaration, codeowners, baseSha: BASE });
    expect(result.paths.map((p) => p.sensitive)).toEqual([true, false, false, false]);
    expect(result.paths.map((p) => p.high)).toEqual([false, true, false, false]);
    expect(result.paths.map((p) => p.owners)).toEqual([[], [], [], []]);
  });
});

// `?` is one character as the name is written: `a/?/b` selected `a/\u00DF/b` before the full fold existed, and the
// full fold must not take that away, although it reads \u00DF as the two letters `ss` and a `?` takes one letter.
describe('pr-review-paths property harness: `?` takes a character whose full fold is several letters', () => {
  test.each([
    ['a/?/b', 'a/\u00DF/b'],
    ['a/?/b', 'a/\u1E9E/b'],
    ['a/?/b', 'a/\uFB00/b'],
    ['a/?/b', 'a/\uFB01/b'],
    ['a/?/b', 'a/\uFB03/b'],
    ['a/?/b', 'a/\uFB06/b'],
    ['a/?/b', 'a/\u0130/b'],
    ['.github/workflows/?.yml', '.github/workflows/\u00DF.yml'],
    ['.github/workflows/?.yml', '.github/workflows/\uFB01.yml'],
    ['a/?ss/b', 'a/\u00DFss/b'], // `?` is one written character, and the letters after it are literal
    ['A/?/B', 'a/\u00DF/b'],
  ])('%j selects %j under ignoreCase', (pattern, changedPath) => {
    expect(matchesPattern(pattern, changedPath, { ignoreCase: true })).toBe(true);
  });

  test.each([
    ['a/??/b', 'a/\u00DF/b'], // the full fold reads sharp s as `ss`, so two `?` take it
    ['a/?s/b', 'a/\u00DF/b'],
    ['a/??/b', 'a/\uFB01/b'],
    ['a/???/b', 'a/\uFB03/b'],
  ])('%j selects %j under ignoreCase by the letters of its full fold', (pattern, changedPath) => {
    expect(matchesPattern(pattern, changedPath, { ignoreCase: true })).toBe(true);
  });

  test.each([
    ['a/???/b', 'a/\u00DF/b'], // two letters, not three
    ['a/?ss/b', 'a/\u00DF\u00DF/b'], // would need both readings at once: documented, not selected
    ['a/?/b', 'a/ss/b'], // `ss` written as two letters is two characters
    ['a/i/b', 'a/\u0130/b'], // dotted capital I is not `i`
  ])('%j does not select %j', (pattern, changedPath) => {
    expect(matchesPattern(pattern, changedPath, { ignoreCase: true })).toBe(false);
  });

  test('exact case is unchanged: a character as written is one `?`, and no fold applies', () => {
    expect(matchesPattern('a/?/b', 'a/\u00DF/b')).toBe(true);
    expect(matchesPattern('a/??/b', 'a/\u00DF/b')).toBe(false);
    expect(matchesPattern('a/ss/b', 'a/\u00DF/b')).toBe(false);
  });

  // Through the grader, with a declared pattern outside the default floor, which has no `?` pattern at all.
  test.each([
    ['sensitive', 'docs/private/?', 'docs/private/\u00DF'],
    ['sensitive', 'docs/private/?', 'docs/private/\uFB01'],
    ['sensitive', 'docs/private/??', 'docs/private/\u00DF'],
    ['high', 'docs/private/?', 'docs/private/\u1E9E'],
    ['high', 'docs/private/?', 'docs/private/\uFB03'],
  ])('a declared %s pattern %j selects the one-character name %j', (kind, pattern, changedPath) => {
    const declaration = { sourceSha: BASE, [kind]: [pattern] };
    const result = classifyPaths({ changedPaths: [changedPath], declaration, baseSha: BASE });
    expect(result.paths[0][kind === 'high' ? 'high' : 'sensitive']).toBe(true);
  });
});

describe('pr-review-paths property harness: alias rows prove folding, not the pattern', () => {
  // Each alias row above is only evidence about case folding if its ASCII twin is sensitive for a plain reason.
  test.each([
    ['.github/workflows/ci.yml'],
    ['scripts/install-hook'],
    ['scripts/release-notes.sh'],
    ['scripts/generate-sub/x.js'],
    ['.github/actions/x.yml'],
    ['.circleci/config.yml'],
  ])('the plain twin %j is sensitive', (changedPath) => {
    expect(classifyPaths({ changedPaths: [changedPath], declaration: null, baseSha: BASE }).paths[0].sensitive).toBe(true);
  });

  // `?` is one character to a file system, an astral one included, whether or not letter case is loosened.
  test.each([
    [false],
    [true],
  ])('`?` takes one astral code point (ignoreCase %s)', (ignoreCase) => {
    expect(matchesPattern('scripts/install-?', 'scripts/install-\u{1F600}', { ignoreCase })).toBe(true);
    expect(matchesPattern('scripts/install-??', 'scripts/install-\u{1F600}', { ignoreCase })).toBe(false);
  });
});

// The reviewer brief (templates/reviewer-brief.md) tells every reviewer to read this file's header and the chains
// before spending calls on matcher edge cases or gate sequences. It may claim only what this file proves, so it
// names this header, which lists what is and is not generated, and tells reviewers to report the rest.
describe('pr-review-paths property harness: the reviewer brief claims no more than this file proves', () => {
  const PROPERTY = 'packages/development/tests/pr-review-paths-property.test.js';
  const CHAIN = 'pr-review-gate-chain.test.js';
  const brief = fs
    .readFileSync(path.join(__dirname, '..', 'skills', 'pr-review-cycle', 'templates', 'reviewer-brief.md'), 'utf8')
    .replace(/\s+/g, ' ');
  const header = fs.readFileSync(__filename, 'utf8').split('*/')[0];

  test('the brief names both test files, and both exist', () => {
    expect(brief).toContain(PROPERTY);
    expect(brief).toContain(CHAIN);
    expect(fs.existsSync(path.join(__dirname, '..', '..', '..', PROPERTY))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, CHAIN))).toBe(true);
  });

  test('the header it points at lists what is generated and what is not, and says what the oracle cannot show', () => {
    expect(brief).toContain(`read the header of \`${PROPERTY}\` (it lists the name forms it generates and the ones it does not)`);
    expect(header).toContain('What a run generates');
    expect(header).toContain('NOT generated, or not modelled');
    expect(header).toContain('agreement shows the code follows them, not that they are the right ones');
  });

  test('the brief tells reviewers to report what is not covered and any rule they think is wrong, and claims no blanket coverage', () => {
    expect(brief).toContain('Report what they do not cover, and any rule you think is wrong');
    expect(brief).toContain('the oracle is written from the same rules as the matcher, so the test cannot show that a rule is the right one');
    expect(brief).not.toMatch(/(?:property test|tests?) covers? (?:this|it|them|all)\b/i);
  });
});
