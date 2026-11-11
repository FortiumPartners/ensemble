#!/usr/bin/env node
'use strict';
/**
 * Lint script: scans shared command, agent and skill sources for hardcoded tool-binary
 * invocations and for commands that declare toolchain capabilities without preflighting
 * them or granting `Bash` (TRD-2026-8d825f54 TRD-047).
 *
 * Modeled on `scripts/lint-model-ids.js`'s shape (exported pure functions, a `main()`
 * guarded by `require.main`, plain-text scanning rather than a full markdown/YAML AST).
 *
 * Scope: `packages/*{commands,agents,skills}/**` (`.yaml`, `.md`), excluding any
 * `adapter-*` directory at any depth (an adapter is allowed to name the one binary it
 * wraps -- that is its whole job) and excluding the generated/vendor trees `packages/pi`,
 * `packages/full`, `packages/codex`, `packages/opencode` entirely (never descended into).
 *
 * Violation classes:
 *   - `BINARY_IN_COMMAND` / `BINARY_IN_AGENT` / `BINARY_IN_SKILL`: a known tool-binary name
 *     appears in a shell-command position in a file under `commands/`, `agents/` or
 *     `skills/` respectively.
 *   - `MISSING_PREFLIGHT`: a command YAML declares a non-empty `metadata.capabilities.required`
 *     but its body has no single `toolchain-cli preflight --require` line listing every one
 *     of those ids. A skill-backed command's body is its skill: its SKILL.md and the
 *     `references/*.md` files beside it (the manifest holds none).
 *   - `MISSING_BASH_GRANT`: a command YAML declares capabilities but its `metadata.allowed_tools`
 *     array is present and does not include `Bash`.
 *
 * "Known tool-binary names" is the union of every real shipped adapter's `binaries[]` (read
 * directly from each `adapter.yaml`, using the same "real source packages only" discovery
 * `scripts/lib/default-only-check.js#discoverShippedAdapters` already implements -- reused
 * here rather than reinvented) plus `packages/development/toolchain/tool-inventory.yaml`
 * (`{category: [binary, ...]}` plus `ignoredCommands`; read defensively, a missing or empty
 * file contributes nothing). Tokens in `ignoredCommands` are never violations, and
 * `node <script>` where the script is a `*_CLI` shell variable (an Ensemble internal CLI)
 * is exempt.
 *
 * Ratchet: `scripts/lint-provider-refs.baseline.json` (resolved relative to the scanned ROOT,
 * absent = empty) grandfathers `{file, class, binary}` counts. A key over its baseline count
 * or absent from it fails; ANY violation in a NAMED source (see NAMED_SOURCE_PATTERNS) fails
 * regardless. `--update-baseline` rewrites the baseline and refuses while a named source
 * still has a violation.
 *
 * Shell-command-position rule (the precise, testable rule this lint applies, chosen to
 * catch a real invocation while never flagging prose that merely mentions a binary's name
 * as an English word):
 *   1. Inside a fenced code block (``` ... ```), every line is a candidate.
 *   2. Outside a fenced code block, only the content of a markdown inline-code span
 *      (`` `...` ``) is a candidate -- backticks are the documented "shell operator"
 *      signal from the TRD for inline references, and this is what keeps a sentence like
 *      "gh is GitHub's CLI" (no code formatting) from tripping the lint while still
 *      catching "run `gh pr create`" (an inline code reference to a real invocation).
 *   3. A candidate line/span is split on the shell separators `&&`, `;` and `|`; each
 *      resulting segment is checked for a known binary as its first token, after
 *      optionally stripping a `sudo`/`env` prefix or one or more `VAR=value` environment
 *      assignments. This single split-and-check-first-token mechanism covers both "start
 *      of a fenced code block line" (the first segment of the line) and "immediately
 *      follows a shell operator" (every subsequent segment) without two separate code
 *      paths.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { discoverShippedAdapters } = require('./lib/default-only-check');
const { resolveSkillFile, isSkillBacked, readSkillProse } = require('./lib/skill-backed-command');

/** Generated/vendor package trees never scanned -- see module doc above. */
const EXCLUDED_PACKAGES = new Set(['pi', 'full', 'codex', 'opencode']);

/** The three source subdirectories this lint scans under each real package. */
const SOURCE_SUBDIRS = ['commands', 'agents', 'skills'];

const FENCE_RE = /^\s*```/;
const INVENTORY_REL = 'packages/development/toolchain/tool-inventory.yaml';
const IGNORED_KEY = 'ignoredCommands';
const BASELINE_REL = 'scripts/lint-provider-refs.baseline.json';

/**
 * NAMED sources: zero violations regardless of baseline. Matches the source file and its
 * generated `commands/ensemble/*.md` counterpart (root-relative POSIX paths).
 */
const NAMED_SOURCE_PATTERNS = [
  /^packages\/development\/commands\/(?:ensemble\/)?(?:implement-trd-beads|beads-build|beads-build-wave|implement-bead|refine-beads|fix-issue)\.(?:yaml|md)$/,
  /^packages\/git\/commands\/(?:ensemble\/)?pr-merge\.(?:yaml|md)$/,
  /^packages\/git\/skills\/git-town\//,
  /^packages\/development\/skills\/pr-review-cycle\//
];
const SEPARATOR_SPLIT_RE = /&&|;|\|/;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const PREFIX_STRIP_RE = /^(?:(?:sudo|env)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/;
const TOKEN_TRIM_RE = /^[`*_'"(]+|[`*_'",:;)]+$/g;

/**
 * Every absolute file path under `<root>/packages/*{commands,agents,skills}/**` matching
 * `.yaml` or `.md`, excluding any `adapter-*` directory at any depth and excluding the
 * generated/vendor package trees entirely.
 *
 * @param {string} root Absolute repo root (or a fixture root shaped like one)
 * @returns {string[]}
 */
function findSourceFiles(root) {
  const results = [];
  const packagesDir = path.join(root, 'packages');
  let packageEntries;
  try {
    packageEntries = fs.readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const pkgEntry of packageEntries) {
    if (!pkgEntry.isDirectory()) continue;
    if (pkgEntry.name === 'dist' || EXCLUDED_PACKAGES.has(pkgEntry.name)) continue;

    for (const sub of SOURCE_SUBDIRS) {
      walkSourceDir(path.join(packagesDir, pkgEntry.name, sub), results);
    }
  }

  return results;
}

function walkSourceDir(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('adapter-')) continue; // adapters may name their own binary
      walkSourceDir(path.join(dir, entry.name), results);
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.md'))) {
      results.push(path.join(dir, entry.name));
    }
  }
}

/**
 * `node <script>` where the script is a shell variable ending in `_CLI` invokes an Ensemble
 * internal CLI (`node "$TRD_CLI" ...`), never a provider tool.
 */
const INTERNAL_CLI_ARG_RE = /^(?:\\?["'])?\$(?:\{[A-Za-z0-9_]*_CLI\}|[A-Za-z0-9_]*_CLI)(?:\\?["'])?$/;

/**
 * Checks one split-on-separator segment for a known binary as its first token. Returns
 * the matched binary name or `null`.
 */
function firstBinaryToken(segment, binaries) {
  const trimmed = segment.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(PREFIX_STRIP_RE, '');
  const match = stripped.match(/^(\S+)(?:\s+(\S+))?/);
  if (!match) return null;
  const token = match[1].replace(TOKEN_TRIM_RE, '');
  if (!binaries.has(token)) return null;
  if (token === 'node' && match[2] && INTERNAL_CLI_ARG_RE.test(match[2])) return null;
  return token;
}

/**
 * Scans one file's full text content for shell-command-position tool-binary references.
 * See the module doc above for the exact rule. Returns a generic `class: 'BINARY'` for
 * every hit -- `lintRoot` rewrites this into `BINARY_IN_COMMAND`/`_AGENT`/`_SKILL` once it
 * knows which directory the file came from.
 *
 * @param {string} content Full text of one source file
 * @param {Set<string>} binaries Known tool-binary names
 * @returns {Array<{line: number, binary: string, class: 'BINARY'}>}
 */
function findViolations(content, binaries) {
  const violations = [];
  const lines = content.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue; // the fence delimiter itself is never a command line
    }

    if (inFence) {
      for (const segment of line.split(SEPARATOR_SPLIT_RE)) {
        const binary = firstBinaryToken(segment, binaries);
        if (binary) violations.push({ line: lineNo, binary, class: 'BINARY' });
      }
      continue;
    }

    INLINE_CODE_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_CODE_RE.exec(line)) !== null) {
      for (const segment of m[1].split(SEPARATOR_SPLIT_RE)) {
        const binary = firstBinaryToken(segment, binaries);
        if (binary) violations.push({ line: lineNo, binary, class: 'BINARY' });
      }
    }
  }

  return violations;
}

/**
 * Which of `commands`/`agents`/`skills` a discovered file lives under, derived from its
 * path relative to `<root>/packages/` (`<pkg>/<subdir>/...`). Returns `null` for a path
 * `findSourceFiles` could never have produced (defensive, never thrown).
 */
function classifySourceDir(root, filePath) {
  const rel = path.relative(path.join(root, 'packages'), filePath);
  const parts = rel.split(path.sep);
  const subdir = parts[1];
  if (subdir === 'commands') return 'COMMAND';
  if (subdir === 'agents') return 'AGENT';
  if (subdir === 'skills') return 'SKILL';
  return null;
}

/** Every `--require <id>` token on one line (a line may declare more than one). */
function extractRequireIds(line) {
  const ids = [];
  const re = /--require\s+([A-Za-z0-9_.:-]+)/g;
  let m;
  while ((m = re.exec(line)) !== null) ids.push(m[1]);
  return ids;
}

/** Best-effort anchor line for a structural (non-binary) violation: the `capabilities:` key. */
function capabilitiesAnchorLine(lines) {
  const idx = lines.findIndex(line => /^\s*capabilities:\s*$/.test(line));
  return idx === -1 ? 1 : idx + 1;
}

/**
 * `MISSING_PREFLIGHT`/`MISSING_BASH_GRANT` checks for one command YAML file. Parses with
 * `js-yaml`; a file that fails to parse or has no `metadata.capabilities.required` entries
 * is not this check's concern and returns no violations.
 *
 * Key shape confirmed against real files (`packages/development/commands/beads-build.yaml`,
 * `implement-bead.yaml`, `fix-issue.yaml`): capabilities and allowed tools both live under
 * top-level `metadata:` as `metadata.capabilities.required` (array) and
 * `metadata.allowed_tools` (array, underscore -- not `allowed-tools`); `allowed_tools` is
 * sometimes entirely absent (e.g. `fix-issue.yaml`), in which case `MISSING_BASH_GRANT`
 * does not fire (the AC only requires flagging an explicit grant list missing `Bash`, not
 * the absence of the key).
 *
 * A skill-backed manifest (`skill:` key) keeps `metadata` but holds no prose, so the
 * preflight line is looked for in the skill prose `readSkillText(skill)` returns (its
 * SKILL.md and `references/*.md`). A skill that cannot be read counts as having no preflight
 * line: the check fails closed.
 *
 * @param {string} content Full text of one command YAML
 * @param {(skill: string) => (string|null)} [readSkillText] Prose of a skill-backed
 *   command's skill (SKILL.md plus its references), or null when it cannot be read
 */
function checkCommandStructure(content, readSkillText) {
  let doc;
  try {
    doc = yaml.load(content);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object') return [];

  const metadata = doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : doc;
  const capabilities = metadata.capabilities;
  const required = Array.isArray(capabilities && capabilities.required)
    ? capabilities.required.filter(id => typeof id === 'string')
    : [];
  if (required.length === 0) return [];

  const violations = [];
  const lines = content.split('\n');
  const anchorLine = capabilitiesAnchorLine(lines);

  // A skill-backed manifest holds no prose, so the preflight line is in its skill. A skill
  // that cannot be read has none: fail closed rather than skip the check.
  const bodyLines = isSkillBacked(doc)
    ? String((readSkillText && readSkillText(doc.skill)) || '').split('\n')
    : lines;

  const hasCompletePreflightLine = bodyLines.some(line => {
    if (!/(?:toolchain-cli|TOOLCHAIN_CLI\}?(?:\\?["'])?)\s+preflight\b/i.test(line) || !line.includes('--require')) return false;
    const idsOnLine = extractRequireIds(line);
    return required.every(id => idsOnLine.includes(id));
  });
  if (!hasCompletePreflightLine) {
    violations.push({ line: anchorLine, binary: null, class: 'MISSING_PREFLIGHT' });
  }

  const allowedTools = metadata.allowed_tools;
  if (Array.isArray(allowedTools) && !allowedTools.includes('Bash')) {
    violations.push({ line: anchorLine, binary: null, class: 'MISSING_BASH_GRANT' });
  }

  return violations;
}

/**
 * Every real shipped adapter's declared `binaries[]`, read directly from each
 * `adapter.yaml` found by `discoverShippedAdapters` (the same package/skills discovery
 * `scripts/lib/default-only-check.js` uses for its own invariant check -- reused here
 * rather than reimplemented).
 */
function collectAdapterBinaries(packagesDir) {
  const binaries = new Set();
  for (const adapter of discoverShippedAdapters(packagesDir)) {
    let manifest;
    try {
      manifest = yaml.load(fs.readFileSync(path.join(adapter.dir, 'adapter.yaml'), 'utf8'));
    } catch {
      continue;
    }
    if (manifest && Array.isArray(manifest.binaries)) {
      for (const bin of manifest.binaries) {
        if (typeof bin === 'string') binaries.add(bin);
      }
    }
  }
  return binaries;
}

/**
 * Parses `packages/development/toolchain/tool-inventory.yaml` under `root` into
 * `{ categories: {category: string[]}, ignored: string[] }`. Read defensively -- a missing
 * file, unreadable file, invalid YAML, non-object document, or a value that is not an array
 * contributes nothing rather than throwing. `ignoredCommands` is the only non-category key.
 */
function readInventory(root) {
  const result = { categories: {}, ignored: [] };
  let inventory;
  try {
    inventory = yaml.load(fs.readFileSync(path.join(root, INVENTORY_REL), 'utf8'));
  } catch {
    return result;
  }
  if (!inventory || typeof inventory !== 'object') return result;

  for (const key of Object.keys(inventory)) {
    const list = inventory[key];
    if (!Array.isArray(list)) continue;
    const names = list.filter(bin => typeof bin === 'string');
    if (key === IGNORED_KEY) result.ignored = names;
    else result.categories[key] = names;
  }
  return result;
}

/** Every tool binary the inventory maps to a category (`ignoredCommands` excluded). */
function collectInventoryBinaries(root) {
  const binaries = new Set();
  for (const list of Object.values(readInventory(root).categories)) {
    for (const bin of list) binaries.add(bin);
  }
  return binaries;
}

/** The inventory's `ignoredCommands`: generic shell words that are never violations. */
function collectIgnoredCommands(root) {
  return new Set(readInventory(root).ignored);
}

/** Root-relative POSIX path, the stable form used for baseline keys and named-source tests. */
function relPosix(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** True when the root-relative path belongs to a NAMED source (zero tolerance, no baseline). */
function isNamedSource(rel) {
  return NAMED_SOURCE_PATTERNS.some(re => re.test(rel));
}

function baselineKey(v) {
  return JSON.stringify([v.rel, v.class, v.binary || null]);
}

/** Reads `<root>/scripts/lint-provider-refs.baseline.json`; absent or invalid = empty. */
function readBaseline(root) {
  const counts = new Map();
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(root, BASELINE_REL), 'utf8'));
  } catch {
    return counts;
  }
  const entries = doc && Array.isArray(doc.entries) ? doc.entries : [];
  for (const e of entries) {
    if (!e || typeof e.file !== 'string' || typeof e.class !== 'string') continue;
    if (!Number.isInteger(e.count) || e.count < 1) continue;
    counts.set(baselineKey({ rel: e.file, class: e.class, binary: e.binary || null }), e.count);
  }
  return counts;
}

/**
 * Scans every source file under `root` and returns every raw violation (no baseline
 * applied), each carrying `rel` (root-relative POSIX path) and `named`.
 */
function scanRoot(root) {
  const packagesDir = path.join(root, 'packages');
  const ignored = collectIgnoredCommands(root);
  const binaries = new Set(
    [...collectAdapterBinaries(packagesDir), ...collectInventoryBinaries(root)]
      .filter(bin => !ignored.has(bin))
  );

  const files = findSourceFiles(root);
  const results = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const rel = relPosix(root, file);
    const named = isNamedSource(rel);
    const kind = classifySourceDir(root, file);
    if (kind) {
      for (const v of findViolations(content, binaries)) {
        results.push({ file, rel, named, line: v.line, binary: v.binary, class: `BINARY_IN_${kind}` });
      }
    }

    if (kind === 'COMMAND' && file.endsWith('.yaml')) {
      // A skill-backed manifest's prose is its skill, in the same package: SKILL.md plus its references.
      const readSkillText = (skill) => {
        try {
          return readSkillProse(resolveSkillFile(file, skill));
        } catch {
          return null;
        }
      };
      for (const v of checkCommandStructure(content, readSkillText)) {
        results.push({ file, rel, named, line: v.line, binary: v.binary, class: v.class });
      }
    }
  }
  return { files, violations: results };
}

/**
 * Applies the ratchet to raw violations: a violation fails when its file is a NAMED source,
 * or when its `{file, class, binary}` key is absent from the baseline or its count exceeds
 * the baseline count (then every violation of that key is reported -- the lint cannot tell
 * which one is new). `hints` lists baseline entries whose count dropped or vanished.
 */
function applyBaseline(violations, baseline) {
  const counts = new Map();
  for (const v of violations) counts.set(baselineKey(v), (counts.get(baselineKey(v)) || 0) + 1);

  const failures = violations.filter(v => {
    if (v.named) return true;
    return counts.get(baselineKey(v)) > (baseline.get(baselineKey(v)) || 0);
  });

  const hints = [];
  for (const [key, allowed] of baseline) {
    const actual = counts.get(key) || 0;
    if (actual < allowed) {
      const [file, cls, binary] = JSON.parse(key);
      hints.push({ file, class: cls, binary, baseline: allowed, actual });
    }
  }
  return { failures, hints };
}

/**
 * Runs the full lint over `root` and returns the FAILING violations after the ratchet
 * (`[{file, line, binary, class, ...}]`). The baseline is read from
 * `<root>/scripts/lint-provider-refs.baseline.json` (absent = empty, so a fixture tree
 * scanned as ROOT is judged without grandfathering).
 *
 * @param {string} root Absolute repo root (or a fixture root shaped like one)
 */
function lintRoot(root) {
  return lintRootDetailed(root).failures.map(({ file, line, binary, class: cls }) => ({ file, line, binary, class: cls }));
}

/** Like `lintRoot` but also returns scanned `files`, raw `violations` and baseline `hints`. */
function lintRootDetailed(root) {
  const { files, violations } = scanRoot(root);
  const { failures, hints } = applyBaseline(violations, readBaseline(root));
  return { files, violations, failures, hints };
}

/** Baseline document for the given raw violations (named sources excluded by contract). */
function buildBaseline(violations) {
  const counts = new Map();
  for (const v of violations) {
    if (v.named) continue;
    counts.set(baselineKey(v), (counts.get(baselineKey(v)) || 0) + 1);
  }
  const entries = [...counts].map(([key, count]) => {
    const [file, cls, binary] = JSON.parse(key);
    return { file, class: cls, binary, count };
  });
  entries.sort((a, b) =>
    a.file.localeCompare(b.file) || a.class.localeCompare(b.class) ||
    String(a.binary).localeCompare(String(b.binary)));
  return { version: 1, entries };
}

function formatViolation(root, v) {
  const tail = v.binary ? ` ${v.binary}` : '';
  return `${relPosix(root, v.file)}:${v.line} ${v.class}${tail}${v.named ? ' (named source)' : ''}`;
}

/**
 * CLI entry. `--update-baseline` rewrites the baseline from the current tree, refusing
 * (exit 1, nothing written) while any NAMED source still has a violation.
 */
function main(argv = process.argv.slice(2)) {
  const root = process.cwd();
  const { files, violations, failures, hints } = lintRootDetailed(root);
  console.log(`Provider-reference lint: ${files.length} file(s) scanned.`);

  if (argv.includes('--update-baseline')) {
    const named = violations.filter(v => v.named);
    if (named.length > 0) {
      for (const v of named) console.log(formatViolation(root, v));
      console.log('Refusing --update-baseline: named sources must have zero violations.');
      process.exit(1);
    }
    const doc = buildBaseline(violations);
    fs.mkdirSync(path.dirname(path.join(root, BASELINE_REL)), { recursive: true });
    fs.writeFileSync(path.join(root, BASELINE_REL), JSON.stringify(doc, null, 2) + '\n');
    console.log(`Baseline written: ${doc.entries.length} entr(ies), ${doc.entries.reduce((n, e) => n + e.count, 0)} grandfathered violation(s).`);
    process.exit(0);
  }

  for (const v of failures) console.log(formatViolation(root, v));
  for (const h of hints) {
    console.log(`hint: baseline can shrink: ${h.file} ${h.class}${h.binary ? ' ' + h.binary : ''} (${h.baseline} -> ${h.actual})`);
  }
  process.exit(failures.length > 0 ? 1 : 0);
}

module.exports = {
  findSourceFiles,
  findViolations,
  lintRoot,
  main,
  // Exported for the fixture/mutation test suites and the taxonomy check.
  lintRootDetailed,
  scanRoot,
  applyBaseline,
  buildBaseline,
  isNamedSource,
  readBaseline,
  readInventory,
  checkCommandStructure,
  collectAdapterBinaries,
  collectInventoryBinaries,
  collectIgnoredCommands
};

if (require.main === module) {
  main();
}
