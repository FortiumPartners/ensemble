/**
 * Skill Copier
 *
 * Propagates Ensemble skills into packages/pi/skills/ for the Pi runtime. Pi ships a lean
 * runtime copy of every skill, not the authoring tree. A skill ships exactly:
 *
 *   1. its SKILL.md (always), and
 *   2. every file that a shipped file refers to by relative path, transitively, and
 *   3. for a shipped script, the sibling modules it requires and the data directories it
 *      names by string literal (e.g. `path.join(__dirname, 'patterns')`).
 *
 * Nothing else is copied: an unreferenced REFERENCE.md, README.md, VALIDATION.md, examples/,
 * templates/, tests or benchmarks are authoring artifacts and stay out of the install.
 * A skill's scripts are therefore shipped when (and only when) a shipped file names them.
 *
 * Reference detection (see referencedPaths): in a shipped text file, every token that looks
 * like a file name or relative path (`REFERENCE.md`, `scripts/run.js`, `[x](./templates/a.md)`,
 * inside backticks, code fences or prose) is resolved against the referencing file's directory,
 * then the skill root, then, for the plugin-style `skills/<skill>/<file>` form, the skill
 * root. A token ships only if it resolves to a regular file inside the skill directory,
 * outside any nested skill and outside `__tests__` / `node_modules`. Tokens that resolve
 * to nothing (URLs, user-project files like `package.json`, dangling names) are ignored and
 * never fail generation.
 *
 * Discovery pattern: packages/*\/skills\/<name>\/SKILL.md. A skill is a directory named after
 * the skill (the Agent Skills layout), whether the package ships one skill or many.
 *
 * Output layout: packages/pi/skills/<name>/<relative path>
 *
 * Packages named in EXCLUDED_PACKAGES are not scanned: `pi` (the output target, avoids
 * self-referential copies), `full` (symlink mirror of other packages' skills) and every
 * self-contained Pi package (SELF_CONTAINED_PI_PACKAGES, currently `assessment`), which is
 * distributed as its own Pi package and not bundled into ensemble-pi.
 * Symlinks (e.g. packages/full/skills/) are resolved before copying; if two paths
 * resolve to the same real SKILL.md, the second skill is skipped.
 *
 * Every copied markdown file starts with the generated marker (../generated-marker.ts), on its
 * first line or right after the frontmatter: it is how a later generator run recognises a stale
 * copy of a removed or renamed skill as its own output and prunes it (see generator.ts, which
 * only inspects markdown directly inside a skill directory). Non-markdown files (scripts, data)
 * are copied byte for byte, with their file mode.
 *
 * SKILL.md files are normalized for Pi compatibility:
 *   - `name` is always overridden with the output skill directory name
 *   - `description` is added if missing, extracted from body or generated from the name
 *
 * Other markdown is copied as it is, apart from the generated marker, CRLF -> LF
 * and the ensemble:<cmd> -> ensemble-<cmd> rewrite that applies to every copied markdown file.
 *
 * @module ensemble-pi/transformers/skill-copier
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { TransformResult } from '../types';
import { SELF_CONTAINED_PI_PACKAGES } from '../self-contained-packages';
import { withGeneratedMarker } from '../generated-marker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directories never shipped, however they are referenced. */
const NEVER_SHIPPED_DIRS = new Set(['__tests__', 'node_modules']);

/** Shipped files with these extensions are scanned for further references. */
const SCANNED_EXTENSIONS = new Set([
  '.md', '.js', '.mjs', '.cjs', '.ts', '.sh', '.py', '.rb', '.exs', '.cs', '.json', '.yaml', '.yml', '.txt',
]);

/** Shipped scripts: also scanned for required modules and data directory literals. */
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.sh', '.py', '.rb', '.exs']);

/** Maximum length for auto-extracted description. */
const DESC_MAX_LEN = 200;

// ---------------------------------------------------------------------------
// Frontmatter normalisation (SKILL.md only)
// ---------------------------------------------------------------------------

/**
 * Extract a description from the SKILL.md body when none is present in
 * the frontmatter.
 *
 * Strategy:
 *  1. Strip leading blank lines and heading lines (starting with `#`).
 *  2. Find the first non-empty line that is not a heading, blockquote,
 *     list item, table row, or fenced-code delimiter.
 *  3. Trim to DESC_MAX_LEN chars at a sentence boundary (`.`, `!`, `?`)
 *     when possible.
 *  4. Fallback: title-case each word of skillDirName + " skill".
 */
function extractDescription(body: string, skillDirName: string): string {
  const lines = body.split('\n');
  const skipPattern = /^(#|>|-|\*|\||\s*```)/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (skipPattern.test(trimmed)) continue;

    // We have a candidate paragraph line — truncate it
    if (trimmed.length <= DESC_MAX_LEN) {
      return trimmed;
    }

    // Try to cut at a sentence boundary within the limit
    const chunk = trimmed.slice(0, DESC_MAX_LEN);
    const lastSentence = Math.max(
      chunk.lastIndexOf('. '),
      chunk.lastIndexOf('! '),
      chunk.lastIndexOf('? ')
    );
    if (lastSentence > 40) {
      return chunk.slice(0, lastSentence + 1).trim();
    }
    return chunk.trim();
  }

  // Fallback: generate from the directory name
  return (
    skillDirName
      .split('-')
      .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ') + ' skill'
  );
}

/**
 * Normalize the frontmatter of a SKILL.md file for Pi compatibility.
 *
 * Rules:
 *  - `name` is always set to `skillDirName` (overrides whatever the source says).
 *  - `description` is added when absent, using body extraction or a generated fallback.
 *
 * @param content      Raw SKILL.md content (may or may not have frontmatter).
 * @param skillDirName Output skill directory name (lowercase, a-z0-9 and hyphens).
 * @returns            Normalised content string.
 */
export function normalizeSkillMd(content: string, skillDirName: string): string {
  // Normalize CRLF → LF so output is consistent across macOS and Linux
  const normalized = content.replace(/\r\n/g, '\n');
  const parsed = matter(normalized);

  // Override / set required fields
  parsed.data['name'] = skillDirName;

  if (!parsed.data['description']) {
    parsed.data['description'] = extractDescription(parsed.content, skillDirName);
  }

  return matter.stringify(parsed.content, parsed.data);
}

/**
 * Package directories to skip during scanning. `pi` and `full` are output/mirror
 * targets, not sources; self-contained Pi packages ship as their own Pi package, so the
 * generator also writes their command prompts into the package itself (see
 * ../self-contained-packages.ts).
 */
const EXCLUDED_PACKAGES: Record<string, true> = {
  pi: true,
  full: true,
  ...SELF_CONTAINED_PI_PACKAGES,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SkillFileEntry {
  /** Absolute path to the source file (resolved through symlinks). */
  realSrcPath: string;
  /** Absolute path to the source file as discovered (may be a symlink). */
  srcPath: string;
  /** Skill directory name to use in the output path. */
  skillDirName: string;
  /** Path relative to the skill directory, `/`-separated (SKILL.md, scripts/run.js). */
  relPath: string;
  /**
   * Where the file was discovered, as a path relative to the monorepo root built from names
   * alone (never from realpath, which differs per machine when a checkout sits behind a
   * symlink). It goes into the generated marker, and committed output must not vary by machine.
   */
  sourceLabel: string;
}

// ---------------------------------------------------------------------------
// Reference detection
// ---------------------------------------------------------------------------

/** A file-like token: optional `../` / `./` / dir segments, then name.ext. */
const FILE_TOKEN = /[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][A-Za-z0-9]{0,5}(?![\w/])/g;
/** Node-style relative requires/imports, which may omit the extension. */
const REQUIRE_TOKEN = /(?:require\(|from\s+|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
/** A quoted path-ish literal; in a script it may name a data directory beside it. */
const LITERAL_TOKEN = /['"`]([\w@.-]+(?:\/[\w@.-]+)*)['"`]/g;

function isShippable(rel: string): boolean {
  return !rel.split('/').some((seg) => NEVER_SHIPPED_DIRS.has(seg));
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** True when `rel` (inside `root`) sits within a nested skill, i.e. below a dir with SKILL.md. */
function inNestedSkill(root: string, rel: string): boolean {
  const segs = rel.split('/').slice(0, -1);
  let cur = root;
  for (const seg of segs) {
    cur = path.join(cur, seg);
    if (isFile(path.join(cur, 'SKILL.md'))) return true;
  }
  return false;
}

/**
 * Resolve `token`, written in the file at `fromRel`, to skill-relative paths of existing
 * files (several for a data directory). Empty when it resolves to nothing inside the skill.
 */
function resolveToken(
  root: string,
  dirName: string,
  fromRel: string,
  token: string,
  probeExtensions: boolean
): string[] {
  const clean = token.replace(/[?#].*$/, '');
  if (!clean || clean.includes('://')) return [];
  const fromDir = path.posix.dirname(fromRel);
  const trimmed = clean.replace(/^\/+/, '');
  const pluginForm = new RegExp(`(?:^|/)skills/${dirName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(.+)$`).exec(
    trimmed
  );
  const bases = [path.posix.join(fromDir, trimmed), path.posix.normalize(trimmed)];
  if (pluginForm) bases.push(pluginForm[1]);

  const suffixes = probeExtensions ? ['', '.js', '.json', '.mjs', '.cjs'] : [''];
  for (const base of bases) {
    if (base.startsWith('..') || path.posix.isAbsolute(base)) continue;
    for (const suffix of suffixes) {
      const rel = base + suffix;
      if (isShippable(rel) && isFile(path.join(root, rel)) && !inNestedSkill(root, rel)) {
        return [rel];
      }
    }
  }
  return [];
}

/** Files below a directory literal, skill-relative; never crosses into nested skills. */
function filesUnder(root: string, relDir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    if (!isShippable(rel + '/x') || isFile(path.join(root, rel, 'SKILL.md'))) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const child = `${rel}/${e.name}`;
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(child);
      else if (isFile(path.join(root, child))) out.push(child);
    }
  };
  walk(relDir);
  return out;
}

/**
 * Skill-relative paths of the files that the text of the file at `fromRel` refers to.
 * Pure over the skill directory on disk; unresolvable tokens are ignored.
 */
export function referencedPaths(root: string, dirName: string, fromRel: string, text: string): string[] {
  const found = new Set<string>();
  const ext = path.posix.extname(fromRel).toLowerCase();

  for (const m of text.matchAll(FILE_TOKEN)) {
    for (const rel of resolveToken(root, dirName, fromRel, m[0], false)) found.add(rel);
  }

  if (SCRIPT_EXTENSIONS.has(ext)) {
    for (const m of text.matchAll(REQUIRE_TOKEN)) {
      for (const rel of resolveToken(root, dirName, fromRel, m[1], true)) found.add(rel);
    }
    for (const m of text.matchAll(LITERAL_TOKEN)) {
      const rel = path.posix.join(path.posix.dirname(fromRel), m[1]);
      if (!rel.startsWith('..') && isDir(path.join(root, rel))) {
        for (const f of filesUnder(root, rel)) found.add(f);
      }
    }
  }
  return [...found];
}

/** SKILL.md plus everything it (transitively) references; sorted, `/`-separated. */
function shippedFiles(root: string, dirName: string): string[] {
  const shipped = new Set<string>(['SKILL.md']);
  const queue = ['SKILL.md'];
  while (queue.length > 0) {
    const rel = queue.pop() as string;
    if (!SCANNED_EXTENSIONS.has(path.posix.extname(rel).toLowerCase())) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf-8');
    } catch {
      continue;
    }
    for (const ref of referencedPaths(root, dirName, rel, text)) {
      if (!shipped.has(ref)) {
        shipped.add(ref);
        queue.push(ref);
      }
    }
  }
  return [...shipped].sort();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Discover the files to ship for every skill across all packages.
 *
 * A skill is a directory packages/<pkg>/skills/<name>/ that holds a SKILL.md (symlinked
 * directories included); skillDirName = <name>.
 *
 * Skips packages in EXCLUDED_PACKAGES (pi, full and the self-contained Pi packages).
 */
function discoverSkillFiles(packagesDir: string): SkillFileEntry[] {
  const entries: SkillFileEntry[] = [];
  const seenSkills = new Set<string>();

  const addSkill = (skillRoot: string, dirName: string, labelDir: string): void => {
    const skillMd = path.join(skillRoot, 'SKILL.md');
    let realSkillMd: string;
    try {
      realSkillMd = fs.realpathSync(skillMd);
    } catch {
      return;
    }
    if (seenSkills.has(realSkillMd)) return;
    seenSkills.add(realSkillMd);

    const realRoot = fs.realpathSync(skillRoot);
    for (const relPath of shippedFiles(realRoot, dirName)) {
      let realSrcPath: string;
      try {
        realSrcPath = fs.realpathSync(path.join(realRoot, relPath));
      } catch {
        continue;
      }
      entries.push({
        realSrcPath,
        srcPath: path.join(skillRoot, relPath),
        skillDirName: dirName,
        relPath,
        sourceLabel: `${labelDir}/${relPath}`,
      });
    }
  };

  if (!fs.existsSync(packagesDir)) {
    return entries;
  }

  let packageDirents: fs.Dirent[];
  try {
    packageDirents = fs.readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const pkgDirent of packageDirents) {
    if (!pkgDirent.isDirectory() && !pkgDirent.isSymbolicLink()) continue;
    if (Object.prototype.hasOwnProperty.call(EXCLUDED_PACKAGES, pkgDirent.name)) continue;

    const pkgName = pkgDirent.name;
    const skillsDir = path.join(packagesDir, pkgName, 'skills');

    if (!fs.existsSync(skillsDir)) continue;

    let skillDirents: fs.Dirent[];
    try {
      skillDirents = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    // Skills: skills/<name>/SKILL.md (directories, including symlinked ones)
    for (const skillDirent of skillDirents) {
      const subPath = path.join(skillsDir, skillDirent.name);
      if (!isDir(subPath)) continue;
      addSkill(subPath, skillDirent.name, `packages/${pkgName}/skills/${skillDirent.name}`);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Copy each Ensemble skill's runtime files (see the module header for the rule) into the
 * Pi output root under `skills/<skill-name>/`.
 *
 * SKILL.md files are normalised for Pi compatibility (name + description fields).
 * Other markdown is copied as is apart from the marker; other files byte for byte.
 *
 * Deduplication: if two paths resolve to the same real SKILL.md (common when
 * packages/full uses symlinks), only the first skill is copied.
 *
 * @param sourceRoot  Monorepo root (contains packages/ directory)
 * @param outputRoot  Pi package root (packages/pi) — output goes to outputRoot/skills/
 * @param options     Runtime options
 * @returns           Array of TransformResult entries, one per file copied
 */
export async function copySkills(
  sourceRoot: string,
  outputRoot: string,
  options: { dryRun?: boolean; verbose?: boolean }
): Promise<TransformResult[]> {
  const { dryRun = false, verbose = false } = options;

  const packagesDir = path.join(sourceRoot, 'packages');
  const skillsOutputDir = path.join(outputRoot, 'skills');

  if (verbose) {
    process.stdout.write(`skill-copier: scanning ${packagesDir}\n`);
  }

  const skillEntries = discoverSkillFiles(packagesDir);

  if (verbose) {
    process.stdout.write(`skill-copier: ${skillEntries.length} skill file(s) to ship\n`);
  }

  const results: TransformResult[] = [];

  for (const entry of skillEntries) {
    const outputPath = path.join(skillsOutputDir, entry.skillDirName, ...entry.relPath.split('/'));
    const isMarkdown = entry.relPath.toLowerCase().endsWith('.md');

    let raw: Buffer;
    try {
      raw = fs.readFileSync(entry.realSrcPath);
    } catch (err) {
      process.stderr.write(
        `  skill-copier: warning — cannot read ${entry.srcPath}: ${(err as Error).message}\n`
      );
      continue;
    }

    let content: string;
    let toWrite: string | Buffer;
    if (isMarkdown) {
      const rawContent = raw.toString('utf-8');
      // Normalise SKILL.md frontmatter for Pi compatibility; normalize CRLF for all markdown
      const normalizedContent =
        entry.relPath === 'SKILL.md'
          ? normalizeSkillMd(rawContent, entry.skillDirName)
          : rawContent.replace(/\r\n/g, '\n');

      // Rewrite Claude-style command references (ensemble:<cmd>) to the Pi
      // invocation form (ensemble-<cmd>). Pi commands are emitted as
      // prompts/ensemble-<cmd>.md and invoked as /ensemble-<cmd>; skill bodies
      // that point at ensemble:<cmd> would otherwise reference names that do not
      // resolve in Pi. Source stays authored in the Claude-canonical colon form.
      // The generated marker goes on last, so it never feeds description extraction above.
      content = withGeneratedMarker(
        normalizedContent.replace(/ensemble:([a-z0-9-]+)/g, 'ensemble-$1'),
        entry.sourceLabel
      );
      toWrite = content;
    } else {
      content = raw.toString('utf-8');
      toWrite = raw;
    }

    const result: TransformResult = {
      sourcePath: entry.srcPath,
      outputPath,
      content,
      type: 'skill',
    };

    if (!dryRun) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, toWrite);
      if (!isMarkdown) {
        try {
          fs.chmodSync(outputPath, fs.statSync(entry.realSrcPath).mode & 0o777);
        } catch {
          // mode is best effort
        }
      }
    }

    if (verbose) {
      process.stdout.write(`  skill: ${entry.srcPath} → ${outputPath}\n`);
    }

    results.push(result);
  }

  if (verbose) {
    process.stdout.write(
      `skill-copier: ${results.length} skill file(s) ${dryRun ? 'collected (dry-run)' : 'copied'}.\n`
    );
  }

  return results;
}
