/**
 * Pi Generator Orchestrator
 *
 * Discovers Ensemble YAML sources across packages/*, validates structural
 * requirements, calls transformers, and writes Pi-compatible artifacts to
 * packages/pi/prompts/, agents/, skills/, and AGENTS.md.
 *
 * Packages listed in SELF_CONTAINED_PI_PACKAGES are distributed as Pi packages of
 * their own: their commands are kept out of packages/pi and generated into the
 * package itself (see generateSelfContainedPackages).
 *
 * Stale output is pruned on every run: a generated file (one that carries a generated marker,
 * see generated-marker.ts) that the run did not reproduce is removed, so a removed or renamed
 * command, agent or skill leaves nothing behind (see pruneStaleArtifacts).
 *
 * Supports --dry-run (collect without writing or pruning), --verbose (log paths, including
 * every pruned file), and --validate (parse output .md files after generation).
 *
 * @module ensemble-pi/generator
 */

import {
  commandSkillPath,
  generateCommandSkills,
  isCommandWrapperSkill,
} from './transformers/command-skill-transformer';
import { SELF_CONTAINED_PI_PACKAGES, MIRROR_PACKAGES } from './self-contained-packages';
import { GeneratorOptions, GenerateResult, TransformResult, CommandYaml } from './types';
import { hasGeneratedMarker } from './generated-marker';
import { transformCommand } from './transformers/command-transformer';
import { buildAgentResult } from './transformers/agent-transformer';
import { copySkills } from './transformers/skill-copier';
import { bundleLibs } from './transformers/lib-bundler';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { glob } from 'glob';
import matter from 'gray-matter';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect files matching an extension under a directory.
 * Used as a fallback if glob is unavailable, but glob is preferred.
 */
function findFilesRecursive(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesRecursive(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Discover YAML files matching a glob pattern.
 * Returns absolute paths sorted lexicographically for deterministic output.
 *
 * Callers build patterns with path.join(), which on Windows yields backslashes
 * that glob reads as escape characters rather than separators -- matching zero
 * files. Normalising here covers every caller rather than each pattern site.
 */
async function discoverYamlFiles(pattern: string): Promise<string[]> {
  const files = await glob(pattern.split(path.sep).join('/'), { absolute: true });
  return files.sort();
}

/**
 * Build a map from bare command name (metadata.name with "ensemble:"
 * stripped) to that command's own resolved Pi prompt output path, relative
 * to sourceRoot (the monorepo root) -- NOT an absolute filesystem path,
 * since this map's values get embedded verbatim into generated, committed
 * .md artifacts and must be portable across machines/checkouts/CI. Used to
 * render dispatcher commands' "## Subcommands" references without guessing
 * at another command's output location.
 *
 * Mirrors scripts/lib/file-discovery.js's buildCommandPathMap for Claude
 * Code, but applies Pi's own output-path formula (outputRoot/prompts/<name>.md,
 * see buildCommandResult below) instead of Claude's commands/ensemble/<name>.md.
 *
 * Parses each file independently and skips any that fail to parse or lack
 * metadata.name — such files are already caught with a hard error by
 * validateCommandYaml() in the main discovery loop below, so silently
 * skipping them here just means their ref is simply unavailable to any
 * dispatcher that tries to reference them (which itself throws).
 */
function buildCommandPathMap(
  commandFiles: string[],
  outputRoot: string,
  sourceRoot: string
): Map<string, string> {
  const pathsByRef = new Map<string, string>();
  for (const filePath of commandFiles) {
    try {
      const raw = yaml.load(fs.readFileSync(filePath, 'utf-8')) as
        | { metadata?: { name?: unknown; visibility?: unknown } }
        | undefined;
      const name = raw?.metadata?.name;
      if (typeof name === 'string' && name) {
        const ref = name.replace(/^ensemble:/, '');
        const absolutePath = promptOutputPath(
          outputRoot,
          name,
          raw?.metadata?.visibility === 'hidden'
        );
        pathsByRef.set(ref, path.relative(sourceRoot, absolutePath));
      }
    } catch {
      // Skip files that can't be parsed; validateCommandYaml() in the main
      // discovery loop will raise a proper error for this file.
    }
  }
  return pathsByRef;
}

/**
 * Single source of truth for a command's Pi prompt output path. Visible
 * commands live at prompts/ensemble-<cmd>.md (registered by the non-recursive
 * prompts/*.md scan, and wrapped as skills). Hidden commands live one level
 * down at prompts/_hidden/ensemble-<cmd>.md: still on disk and readable by
 * path (dispatchers point at it) but invisible to that scan.
 */
export const HIDDEN_PROMPTS_DIR = '_hidden';

export function promptOutputPath(
  outputRoot: string,
  commandName: string,
  hidden: boolean
): string {
  const piName = commandName.replace(/^ensemble:/, 'ensemble-');
  return hidden
    ? path.join(outputRoot, 'prompts', HIDDEN_PROMPTS_DIR, `${piName}.md`)
    : path.join(outputRoot, 'prompts', `${piName}.md`);
}

// ---------------------------------------------------------------------------
// Pruning stale generated output
// ---------------------------------------------------------------------------

/**
 * The kinds of generator output pruning looks at, each with its own proof that the generator
 * wrote the file. A file without that proof is hand-authored as far as the generator can tell,
 * and is never touched:
 *
 *   prompt   prompts/*.md and prompts/_hidden/*.md   generated marker (generated-marker.ts)
 *   agent    agents/*.md                             generated marker, after the frontmatter
 *   skill    skills/<name>/*.md                      generated marker (what copySkills writes)
 *   wrapper  skills/ensemble-<cmd>/SKILL.md          the wrapper's own proof, see
 *                                                    isCommandWrapperSkill
 *
 * Nothing else is looked at: not a file elsewhere in the output root (AGENTS.md, vendor/),
 * not a subdirectory of a skill, not a symlink, not a placeholder such as .gitkeep.
 */
export type ArtifactKind = 'prompt' | 'agent' | 'skill' | 'wrapper';

/** Entries of `dir`, or none when it does not exist. */
function entriesOf(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
}

/** The regular .md files directly in `dir`. */
function markdownFilesIn(dir: string): string[] {
  return entriesOf(dir)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(dir, entry.name));
}

/** The regular files among `files` whose content `proof` accepts. */
function filesProving(
  files: string[],
  proof: (content: string, file: string) => boolean
): string[] {
  return files.filter((file) => {
    try {
      return fs.lstatSync(file).isFile() && proof(fs.readFileSync(file, 'utf-8'), file);
    } catch {
      return false; // unreadable or vanished: nothing proves it is ours
    }
  });
}

/**
 * Every file of `kind` under `outputRoot` that provably came from the generator, produced this
 * run or not.
 */
export function listGeneratedFiles(outputRoot: string, kind: ArtifactKind): string[] {
  const promptsDir = path.join(outputRoot, 'prompts');
  const skillsDir = path.join(outputRoot, 'skills');
  const skillDirs = entriesOf(skillsDir)
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsDir, entry.name));

  switch (kind) {
    case 'prompt':
      return filesProving(
        [...markdownFilesIn(promptsDir), ...markdownFilesIn(path.join(promptsDir, HIDDEN_PROMPTS_DIR))],
        hasGeneratedMarker
      );
    case 'agent':
      return filesProving(markdownFilesIn(path.join(outputRoot, 'agents')), hasGeneratedMarker);
    case 'skill':
      return filesProving(skillDirs.flatMap(markdownFilesIn), hasGeneratedMarker);
    case 'wrapper':
      return filesProving(
        skillDirs.map((dir) => path.join(dir, 'SKILL.md')),
        (content, file) => isCommandWrapperSkill(path.basename(path.dirname(file)), content)
      );
  }
}

/**
 * Paths compare case-folded. On a case-insensitive filesystem (macOS, Windows) a stale file
 * whose name differs from this run's output only in case is the very file just written, and
 * must never be pruned; on a case-sensitive one folding can only keep a file, never delete one.
 */
function foldPath(file: string): string {
  return path.resolve(file).toLowerCase();
}

/** The folded output paths of `results`: what a run produced, for pruneStaleArtifacts. */
function producedPaths(results: readonly TransformResult[]): Set<string> {
  return new Set(results.map((result) => foldPath(result.outputPath)));
}

/** Remove `dir` if it is empty and not one of the `keep` roots; anything inside it is safe. */
function removeIfEmpty(dir: string, keep: ReadonlySet<string>): void {
  if (keep.has(dir)) return;
  try {
    fs.rmdirSync(dir); // refuses a directory that still holds a file
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'ENOENT') throw err;
  }
}

/**
 * Remove the generated files of `kinds` under `outputRoot` that the run did not produce: the
 * mirror of a command, agent or skill that was removed or renamed, or of a command that
 * changed visibility (its prompt now lives in the other directory). `produced` holds the
 * folded paths the run wrote or, on a dry run, would write (see producedPaths). Directories
 * this empties are removed too, except the prompts/, agents/ and skills/ roots.
 *
 * Only a file that provably came from the generator is a candidate (see ArtifactKind), so a
 * hand-authored file in the same directory survives, and so does anything else sharing the
 * directory of a pruned skill. On a dry run nothing is removed.
 *
 * @returns the pruned paths (on a dry run, those that would be), sorted.
 */
export function pruneStaleArtifacts(
  outputRoot: string,
  produced: ReadonlySet<string>,
  kinds: readonly ArtifactKind[],
  options: { dryRun: boolean; verbose: boolean }
): string[] {
  const { dryRun, verbose } = options;
  const stale = [...new Set(kinds.flatMap((kind) => listGeneratedFiles(outputRoot, kind)))]
    .filter((file) => !produced.has(foldPath(file)))
    .sort();

  const keep = new Set(['prompts', 'agents', 'skills'].map((dir) => path.join(outputRoot, dir)));
  for (const file of stale) {
    if (!dryRun) {
      fs.rmSync(file, { force: true });
      removeIfEmpty(path.dirname(file), keep);
    }
    if (verbose) {
      process.stdout.write(`  prune${dryRun ? ' (dry-run)' : ''}: ${file}\n`);
    }
  }

  if (verbose && kinds.length > 0) {
    process.stdout.write(
      `prune (${kinds.join(', ')}): ${stale.length} stale file(s) ${dryRun ? 'would be removed (dry-run)' : 'removed'}.\n`
    );
  }
  return stale;
}

/**
 * Generate the command-wrapper skills from the prompts on disk, then prune the wrappers whose
 * command is gone.
 *
 * `prompts.pruned` are the prompts this run's prune removed or, on a dry run, would remove: a
 * dry run leaves them on disk, but a real run would not wrap them, so their wrappers are
 * neither output nor protected from pruning. `prompts.written` are the prompts this run writes
 * or, on a dry run, would write: such a prompt may not be on disk yet, so generateCommandSkills
 * cannot see it, but an existing wrapper of it is not stale.
 */
async function generateWrappersAndPrune(
  outputRoot: string,
  prompts: { written: readonly TransformResult[]; pruned: readonly string[] },
  options: { dryRun: boolean; verbose: boolean; hideFromClaudeCode?: boolean; pruneWrappers?: boolean }
): Promise<{ results: TransformResult[]; pruned: string[] }> {
  const { dryRun, verbose, hideFromClaudeCode, pruneWrappers = true } = options;
  const gone = new Set(prompts.pruned.map(foldPath));
  const results = (await generateCommandSkills(outputRoot, { dryRun, verbose, hideFromClaudeCode })).filter(
    (result) => !gone.has(foldPath(result.sourcePath))
  );

  const produced = producedPaths(results);
  const promptsDir = path.join(outputRoot, 'prompts'); // hidden prompts (prompts/_hidden/) get no wrapper
  for (const prompt of prompts.written) {
    if (path.dirname(prompt.outputPath) === promptsDir) {
      produced.add(foldPath(commandSkillPath(outputRoot, prompt.outputPath)));
    }
  }
  const pruned = pruneWrappers
    ? pruneStaleArtifacts(outputRoot, produced, ['wrapper'], { dryRun, verbose })
    : [];
  return { results, pruned };
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

/**
 * Validate required fields in a parsed command YAML.
 * Throws with a specific message if any required field is absent.
 */
function validateCommandYaml(data: unknown, filePath: string): CommandYaml {
  const d = data as Record<string, unknown>;

  const requiredFields: Array<{ fieldName: string; present: boolean }> = [
    {
      fieldName: 'metadata.name',
      present:
        typeof d?.metadata === 'object' &&
        d.metadata !== null &&
        typeof (d.metadata as Record<string, unknown>).name === 'string' &&
        (d.metadata as Record<string, unknown>).name !== '',
    },
    {
      fieldName: 'metadata.version',
      present:
        typeof d?.metadata === 'object' &&
        d.metadata !== null &&
        typeof (d.metadata as Record<string, unknown>).version === 'string' &&
        (d.metadata as Record<string, unknown>).version !== '',
    },
    {
      fieldName: 'workflow.phases',
      present:
        typeof d?.workflow === 'object' &&
        d.workflow !== null &&
        Array.isArray((d.workflow as Record<string, unknown>).phases),
    },
  ];

  for (const { fieldName, present } of requiredFields) {
    if (!present) {
      throw new Error(`Missing required field: ${fieldName} in ${filePath}`);
    }
  }

  return d as unknown as CommandYaml;
}

// ---------------------------------------------------------------------------
// AGENTS.md generator (TRD-009)
// ---------------------------------------------------------------------------

/** Generated runtime packages: translation layers, not part of the agent/package mesh. */
const RUNTIME_PACKAGES = new Set(['ensemble-pi', 'ensemble-pi-extension', 'ensemble-codex', 'ensemble-opencode']);

/** Static delegation protocol; deliberately free of counts so it cannot go stale. */
const DELEGATION_PROTOCOL = `Delegate through the Task tool with an explicit agent type, e.g. \`Task(subagent_type="backend-developer", prompt="...")\`.

- Route cross-cutting or multi-domain work through an orchestrator (\`ensemble-orchestrator\`, \`tech-lead-orchestrator\`); route single-domain work straight to the specialist.
- Pass file paths and requirements explicitly: delegates do not inherit your conversation.
- One responsibility per delegation; independent tasks run in parallel.
- Delegates report results back to the delegator; unresolved issues escalate up to the orchestrator.
- Verify delegated claims (files changed, tests passed) before reporting done.`;

interface PackageEntry {
  name: string;
  description: string;
}

interface AgentEntry {
  name: string;
  description: string;
}

/** Collapse whitespace so a YAML description fits on one markdown line. */
function oneLine(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/** List packages/<pkg>/<subdir>/<file> paths (sorted) whose file name satisfies `match`. */
function listPackageFiles(sourceRoot: string, subdir: string[], match: (fileName: string) => boolean): string[] {
  const packagesDir = path.join(sourceRoot, 'packages');
  const out: string[] = [];
  for (const pkg of readDirSorted(packagesDir)) {
    const dir = path.join(packagesDir, pkg, ...subdir);
    for (const file of readDirSorted(dir)) {
      if (match(file)) out.push(path.join(dir, file));
    }
  }
  return out;
}

/** Sorted directory entries; empty when the directory is absent or unreadable. */
function readDirSorted(dir: string): string[] {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Self-contained packages ship as their own Pi package; ensemble-pi's AGENTS.md must not mention them. */
function isSelfContainedPackageDir(packageDir: string): boolean {
  return Object.prototype.hasOwnProperty.call(SELF_CONTAINED_PI_PACKAGES, packageDir);
}

/** Mirror packages own no source; see MIRROR_PACKAGES for what reading one as a source costs. */
function isMirrorPackageDir(packageDir: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIRROR_PACKAGES, packageDir);
}

/** The owning package of a path under `packages/`, by its first segment rather than by dirname hops. */
function owningPackageDir(sourceRoot: string, file: string): string {
  return path.relative(path.join(sourceRoot, 'packages'), file).split(path.sep)[0] ?? '';
}

/** Read packages/*\/.claude-plugin/plugin.json (name + description), sorted by name. */
function collectPackages(sourceRoot: string): PackageEntry[] {
  const files = listPackageFiles(sourceRoot, ['.claude-plugin'], (f) => f === 'plugin.json');
  const entries: PackageEntry[] = [];
  for (const file of files) {
    if (isSelfContainedPackageDir(path.basename(path.dirname(path.dirname(file))))) continue;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as { name?: unknown; description?: unknown };
      if (typeof json.name !== 'string' || RUNTIME_PACKAGES.has(json.name)) continue;
      entries.push({ name: json.name, description: oneLine(json.description) });
    } catch {
      // Unparseable manifest: omit from the overview.
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read packages/*\/agents/*.yaml grouped by package directory name. */
function collectAgentsByPackage(sourceRoot: string): Map<string, AgentEntry[]> {
  const files = listPackageFiles(sourceRoot, ['agents'], (f) => f.endsWith('.yaml'));
  const byPackage = new Map<string, AgentEntry[]>();
  for (const file of files) {
    if (isSelfContainedPackageDir(path.basename(path.dirname(path.dirname(file))))) continue;
    // packages/full mirrors agents/documentation-specialist.yaml, so without this the
    // overview grows a "### full" group listing an agent that already appears under the
    // package that owns it.
    if (isMirrorPackageDir(owningPackageDir(sourceRoot, file))) continue;
    try {
      const raw = yaml.load(fs.readFileSync(file, 'utf-8')) as { metadata?: { name?: unknown; description?: unknown } };
      const name = raw?.metadata?.name;
      if (typeof name !== 'string' || name === '') continue;
      const pkg = path.basename(path.dirname(path.dirname(file)));
      const list = byPackage.get(pkg) ?? [];
      list.push({ name, description: oneLine(raw.metadata?.description) });
      byPackage.set(pkg, list);
    } catch {
      // Unparseable agent YAML: omit from the mesh list.
    }
  }
  return new Map([...byPackage.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function renderAgentsMd(packages: PackageEntry[], agentsByPackage: Map<string, AgentEntry[]>): string {
  const out: string[] = [
    '# Ensemble Agent Mesh',
    '',
    '> Generated from packages/*/.claude-plugin/plugin.json and packages/*/agents/*.yaml.',
    '',
    '## Architecture Overview',
    '',
    'Ensemble is a monorepo of plugin packages under `packages/`. Runtime packages (pi, codex, opencode) are generated translations of these sources.',
    '',
  ];
  for (const pkg of packages) {
    out.push(pkg.description ? `- \`${pkg.name}\` - ${pkg.description}` : `- \`${pkg.name}\``);
  }

  const total = [...agentsByPackage.values()].reduce((n, list) => n + list.length, 0);
  out.push('', '## Agent Mesh', '', `${total} agents, grouped by package.`);
  for (const [pkg, agents] of agentsByPackage) {
    out.push('', `### ${pkg}`, '');
    for (const agent of agents) {
      out.push(agent.description ? `- \`${agent.name}\` - ${agent.description}` : `- \`${agent.name}\``);
    }
  }

  out.push('', '## Agent Delegation Protocol', '', DELEGATION_PROTOCOL, '');
  return out.join('\n');
}

/**
 * Generate packages/pi/AGENTS.md from the real package and agent inventory:
 * packages/*\/.claude-plugin/plugin.json and packages/*\/agents/*.yaml under
 * sourceRoot. Independent of CLAUDE.md contents.
 *
 * @param sourceRoot  Monorepo root path.
 * @param outputRoot  packages/pi path (where AGENTS.md will be written).
 * @param options     { dryRun, verbose }
 * @returns           TransformResult describing the generated artifact.
 */
export function generateAgentsMd(
  sourceRoot: string,
  outputRoot: string,
  options: { dryRun?: boolean; verbose?: boolean }
): TransformResult {
  const { dryRun = false, verbose = false } = options;

  const sourcePath = path.join(sourceRoot, 'packages');
  const content = renderAgentsMd(collectPackages(sourceRoot), collectAgentsByPackage(sourceRoot));
  const outputPath = path.join(outputRoot, 'AGENTS.md');

  if (verbose) {
    process.stdout.write(`  agents-md: ${sourcePath} → ${outputPath}\n`);
  }

  if (!dryRun) {
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  return { sourcePath, outputPath, content, type: 'agents-md' };
}

// ---------------------------------------------------------------------------
// Placeholder transformers (stubs — expanded in TRD-007, TRD-008)
// Command transformer is fully implemented in TRD-006a (see transformers/command-transformer.ts)
// ---------------------------------------------------------------------------

/**
 * Wrap the imported command transformer to produce a TransformResult.
 *
 * Ensemble command YAMLs carry the Claude-style name "ensemble:<cmd>". Pi and
 * OMP register a prompt template under its filename stem, and ':' is illegal on
 * Windows NTFS, so the on-disk artifact uses the Windows-safe "ensemble-<cmd>"
 * form and registers as /ensemble-<cmd>. Output goes to prompts/ — the pi-native
 * home that both native pi and OMP load (native pi has no commands/ concept).
 */
function buildCommandResult(
  commandYaml: CommandYaml,
  sourcePath: string,
  outputRoot: string,
  verbose: boolean,
  commandPathsByRef: Map<string, string>
): TransformResult {
  const name = commandYaml.metadata.name;
  const outputPath = promptOutputPath(
    outputRoot,
    name,
    commandYaml.metadata.visibility === 'hidden'
  );
  const content = transformCommand(commandYaml, sourcePath, { verbose, commandPathsByRef });
  return { sourcePath, outputPath, content, type: 'command' };
}

/**
 * Transform every command YAML in `commandFiles` into a Pi prompt under
 * `outputRoot`. Dispatcher refs resolve only against `commandFiles` themselves, so
 * a command can never point at a prompt this output root does not contain: a ref
 * across a Pi package boundary (ensemble-pi to a self-contained package, or back)
 * fails loudly instead of rendering a path the installed package cannot resolve.
 */
function buildCommandResults(
  commandFiles: string[],
  outputRoot: string,
  sourceRoot: string,
  verbose: boolean
): TransformResult[] {
  // Built once per run, over the same already-discovered commandFiles, so
  // dispatcher commands can resolve dispatch.subcommands[].ref to a sibling
  // command's own Pi prompt output path (see command-transformer.ts's
  // renderSubcommands). File-order independent: every command's path is
  // resolvable regardless of which one is processed first below.
  const commandPathsByRef = buildCommandPathMap(commandFiles, outputRoot, sourceRoot);
  const results: TransformResult[] = [];

  for (const filePath of commandFiles) {
    let raw: unknown;
    try {
      raw = yaml.load(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      throw new Error(`YAML parse error in ${filePath}: ${(err as Error).message}`, { cause: err });
    }

    // Structural validation runs BEFORE any transformation (TRD-005 requirement)
    const commandYaml = validateCommandYaml(raw, filePath);
    const result = buildCommandResult(commandYaml, filePath, outputRoot, verbose, commandPathsByRef);

    if (verbose) {
      process.stdout.write(`  command: ${filePath} → ${result.outputPath}\n`);
    }

    results.push(result);
  }

  return results;
}

// transformAgent is now provided by ./transformers/agent-transformer (TRD-007)

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeResult(result: TransformResult): void {
  ensureDir(path.dirname(result.outputPath));
  fs.writeFileSync(result.outputPath, result.content, 'utf-8');
}

// ---------------------------------------------------------------------------
// --validate pass: parse output artifacts for structural issues (TRD-010)
// ---------------------------------------------------------------------------

/**
 * Validate generated artifacts using their in-memory content.
 *
 * - agent artifacts: parsed with gray-matter; must have frontmatter fields
 *   'name' and 'description'.
 * - command artifacts: must contain at least one H1 heading ('# ').
 * - All artifact types: must be non-empty.
 *
 * Throws an Error if any validation errors are found so the caller can
 * propagate a non-zero exit code.
 */
function validateResults(
  results: TransformResult[],
  options: { verbose?: boolean }
): void {
  const { verbose = false } = options;
  const validateErrors: string[] = [];

  for (const result of results) {
    if (result.type === 'agent') {
      try {
        const { data } = matter(result.content);
        if (!data.name) {
          validateErrors.push(`${result.outputPath}: missing frontmatter field 'name'`);
        }
        if (!data.description) {
          validateErrors.push(
            `${result.outputPath}: missing frontmatter field 'description'`
          );
        }
      } catch (e) {
        validateErrors.push(
          `${result.outputPath}: frontmatter parse error: ${(e as Error).message}`
        );
      }
    }

    if (result.type === 'command') {
      if (!result.content.includes('# ')) {
        validateErrors.push(`${result.outputPath}: missing H1 heading`);
      }
    }

    // All artifact types: must be non-empty
    if (!result.content.trim()) {
      validateErrors.push(`${result.outputPath}: generated content is empty`);
    }
  }

  if (validateErrors.length > 0) {
    for (const err of validateErrors) {
      process.stderr.write(`VALIDATION ERROR: ${err}\n`);
    }
    throw new Error(`Validation failed: ${validateErrors.length} error(s)`);
  }

  if (verbose) {
    process.stdout.write(`Validation passed: ${results.length} artifacts validated\n`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate ensemble-pi into `outputRoot` from the sources under `sourceRoot`: command
 * prompts, agents, copied skills, command-wrapper skills, vendored libs and AGENTS.md.
 *
 * Stale output is pruned: a file an earlier run wrote (it carries a generated marker, see
 * generated-marker.ts) that this run did not reproduce is removed, so a removed or renamed
 * command, agent or skill leaves nothing behind. A hand-authored file is never touched. On a
 * dry run nothing is removed; the result lists what a real run would remove.
 */
export async function generate(options: GeneratorOptions): Promise<GenerateResult> {
  const { dryRun, verbose, validate, sourceRoot, outputRoot } = options;

  if (verbose) {
    process.stdout.write('Pi generator starting...\n');
    process.stdout.write(`Source root: ${sourceRoot}\n`);
    process.stdout.write(`Output root: ${outputRoot}\n`);
    process.stdout.write(
      `Flags: dry-run=${dryRun}, verbose=${verbose}, validate=${validate}\n`
    );
  }

  // Performance measurement (TRD-010)
  const startTime = Date.now();

  const results: TransformResult[] = [];

  // ------------------------------------------------------------------
  // 1. Discover and process command YAML files
  // ------------------------------------------------------------------
  const commandPattern = path.join(sourceRoot, 'packages/*/commands/*.yaml');
  // Self-contained Pi packages ship their own prompts (generateSelfContainedPackages);
  // none of their commands belong in ensemble-pi.
  const commandFiles = (await discoverYamlFiles(commandPattern)).filter((file) => {
    const packageName = path.basename(path.dirname(path.dirname(file)));
    if (Object.prototype.hasOwnProperty.call(SELF_CONTAINED_PI_PACKAGES, packageName)) return false;
    return !isMirrorPackageDir(owningPackageDir(sourceRoot, file));
  });

  if (verbose) {
    process.stdout.write(`Discovered ${commandFiles.length} command YAML file(s).\n`);
  }

  const commandResults = buildCommandResults(commandFiles, outputRoot, sourceRoot, verbose);
  results.push(...commandResults);

  // ------------------------------------------------------------------
  // 2. Discover and process agent YAML files
  // ------------------------------------------------------------------
  const agentPattern = path.join(sourceRoot, 'packages/*/agents/*.yaml');
  const agentFiles = (await discoverYamlFiles(agentPattern)).filter(
    (file) => !isMirrorPackageDir(owningPackageDir(sourceRoot, file))
  );

  if (verbose) {
    process.stdout.write(`Discovered ${agentFiles.length} agent YAML file(s).\n`);
  }

  const agentResults: TransformResult[] = [];

  for (const filePath of agentFiles) {
    let raw: unknown;
    try {
      raw = yaml.load(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      throw new Error(`YAML parse error in ${filePath}: ${(err as Error).message}`, { cause: err });
    }

    if (!raw || typeof raw !== 'object') {
      // Skip malformed agent files rather than aborting the entire run
      if (verbose) {
        process.stderr.write(`  agent: skipping ${filePath} (empty or non-object YAML)\n`);
      }
      continue;
    }

    // Delegate all normalization and tool-filtering to the agent transformer (TRD-007)
    const rawObj = raw as Record<string, unknown>;

    // Quick name check before delegating — skip truly nameless agents
    const quickName =
      typeof rawObj.name === 'string'
        ? rawObj.name
        : rawObj.metadata && typeof rawObj.metadata === 'object'
          ? ((rawObj.metadata as Record<string, unknown>).name as string) ?? ''
          : '';

    if (!quickName) {
      if (verbose) {
        process.stderr.write(`  agent: skipping ${filePath} (missing name field)\n`);
      }
      continue;
    }

    const result = buildAgentResult(rawObj, filePath, outputRoot, { verbose });

    if (verbose) {
      process.stdout.write(`  agent: ${filePath} → ${result.outputPath}\n`);
    }

    results.push(result);
    agentResults.push(result);
  }

  // ------------------------------------------------------------------
  // 3. Skill files (TRD-008)
  // ------------------------------------------------------------------
  const skillResults = await copySkills(sourceRoot, outputRoot, { dryRun, verbose });
  results.push(...skillResults);

  // ------------------------------------------------------------------
  // 3b. Vendored lib/script files (trd-cli.js, trd-graph-cli.js, prd-cli.js,
  //     validate-git-town.sh) for Pi runtime consumption when only the
  //     published ensemble-pi package is installed.
  // ------------------------------------------------------------------
  const libResults = await bundleLibs(sourceRoot, outputRoot, { dryRun, verbose });
  results.push(...libResults);

  // ------------------------------------------------------------------
  // 4. AGENTS.md generation (TRD-009)
  // ------------------------------------------------------------------
  const agentsMdResult = generateAgentsMd(sourceRoot, outputRoot, { dryRun, verbose });
  results.push(agentsMdResult);

  // ------------------------------------------------------------------
  // 5. Write results (unless --dry-run)
  //    Note: generateAgentsMd() writes its own file when !dryRun, so we
  //    only write the command/agent results here to avoid double-writing.
  // ------------------------------------------------------------------
  if (!dryRun) {
    for (const result of results) {
      // agents-md, skill, and lib files are already written by their respective transformers
      if (result.type !== 'agents-md' && result.type !== 'skill' && result.type !== 'lib') {
        writeResult(result);
      }
    }
  } else if (verbose) {
    process.stdout.write(
      `Dry-run mode: ${results.length} artifact(s) collected but not written.\n`
    );
  }

  // ------------------------------------------------------------------
  // 5a. Prune stale generated files: prompts, agents and copied skills an earlier run wrote
  //     that this run did not reproduce (their command, agent or skill was removed or
  //     renamed, or a command changed visibility). Before 5b, because the wrapper skills
  //     are derived from the prompts on disk: a stale prompt left in place would get a
  //     fresh wrapper.
  //
  //     A kind is pruned only if its sources were discovered at all. Discovering none
  //     points at a wrong sourceRoot or a broken glob far more often than at a repo that
  //     really lost every command, agent or skill, and pruning then would delete
  //     everything the generator ever wrote.
  // ------------------------------------------------------------------
  const sourcesDiscovered: Array<[ArtifactKind, number, string]> = [
    ['prompt', commandFiles.length, 'generated prompts and wrapper skills'],
    ['agent', agentResults.length, 'generated agents'],
    ['skill', skillResults.length, 'copied skills'],
  ];
  const pruneKinds: ArtifactKind[] = [];
  for (const [kind, count, what] of sourcesDiscovered) {
    if (count > 0) {
      pruneKinds.push(kind);
    } else if (verbose) {
      process.stdout.write(`  prune: no ${kind} sources discovered, leaving ${what} alone\n`);
    }
  }
  const pruned = pruneStaleArtifacts(outputRoot, producedPaths(results), pruneKinds, {
    dryRun,
    verbose,
  });

  // ------------------------------------------------------------------
  // 5b. Command prompt skill wrappers, then prune the wrappers of commands that are gone
  //     Called after the write loop and the prune so the prompt files on disk are exactly
  //     this run's.
  // ------------------------------------------------------------------
  const wrappers = await generateWrappersAndPrune(
    outputRoot,
    { written: commandResults, pruned },
    { dryRun, verbose, pruneWrappers: commandFiles.length > 0 }
  );
  results.push(...wrappers.results);
  pruned.push(...wrappers.pruned);
  pruned.sort();

  // ------------------------------------------------------------------
  // 6. Performance timing (TRD-010)
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // 6. Performance timing (TRD-010)
  // ------------------------------------------------------------------
  const elapsed = Date.now() - startTime;
  if (verbose) {
    process.stdout.write(
      `Generation complete in ${elapsed}ms (target: <10000ms)\n`
    );
  }
  if (elapsed > 10000) {
    process.stderr.write(
      `WARNING: Generation took ${elapsed}ms, exceeding 10s target\n`
    );
  }

  // ------------------------------------------------------------------
  // 7. --validate: parse generated artifacts in-memory for structural issues
  // ------------------------------------------------------------------
  if (validate) {
    validateResults(results, { verbose });
  }

  if (verbose) {
    process.stdout.write(
      `Generator complete. ${results.length} artifact(s) processed.\n`
    );
  }

  return { pruned };
}

/**
 * Generate the Pi artifacts of every self-contained Pi package
 * (SELF_CONTAINED_PI_PACKAGES): each package's command prompts under
 * packages/<name>/prompts/ and their command-wrapper skills under
 * packages/<name>/skills/ensemble-*, i.e. the layout ensemble-pi itself uses, rooted
 * at the package. The package's own skills are already in packages/<name>/skills/
 * and are never copied.
 *
 * Writes only inside each package directory under `sourceRoot`, never `outputRoot`
 * (ensemble-pi), so `generate()` stays confined to the output root it is given. A
 * package without commands/*.yaml is skipped and nothing is created or pruned for it.
 *
 * Prompts and wrapper skills of a removed or renamed command are pruned (see
 * pruneStaleArtifacts). Nothing else in the package is inspected: its own skills are
 * hand-authored sources, and none of them carries a generated marker.
 */
export async function generateSelfContainedPackages(
  options: Omit<GeneratorOptions, 'outputRoot'>
): Promise<GenerateResult> {
  const { dryRun, verbose, validate, sourceRoot } = options;
  const results: TransformResult[] = [];
  const pruned: string[] = [];

  for (const packageName of Object.keys(SELF_CONTAINED_PI_PACKAGES)) {
    const packageRoot = path.join(sourceRoot, 'packages', packageName);
    const commandFiles = await discoverYamlFiles(path.join(packageRoot, 'commands', '*.yaml'));
    if (commandFiles.length === 0) continue;

    if (verbose) {
      process.stdout.write(
        `Self-contained Pi package ${packageName}: ${commandFiles.length} command YAML file(s) → ${packageRoot}\n`
      );
    }

    const commandResults = buildCommandResults(commandFiles, packageRoot, sourceRoot, verbose);
    if (!dryRun) {
      for (const result of commandResults) {
        writeResult(result);
      }
    }
    results.push(...commandResults);

    // After the write loop so this run's prompts are on disk, as in generate(). The package is
    // also a Claude Code plugin whose real /ensemble:<cmd> command is generated from the same
    // YAML, so the Pi/OMP wrapper must not be listed beside it there.
    const prunedPrompts = pruneStaleArtifacts(packageRoot, producedPaths(commandResults), ['prompt'], {
      dryRun,
      verbose,
    });
    const wrappers = await generateWrappersAndPrune(
      packageRoot,
      { written: commandResults, pruned: prunedPrompts },
      { dryRun, verbose, hideFromClaudeCode: true }
    );
    results.push(...wrappers.results);
    pruned.push(...prunedPrompts, ...wrappers.pruned);
  }

  if (validate) {
    validateResults(results, { verbose });
  }

  return { pruned: pruned.sort() };
}

/**
 * Everything `npm run generate:pi` produces: ensemble-pi into `outputRoot`, then each
 * self-contained Pi package into its own directory. Reports the stale files pruned from
 * both.
 */
export async function generateAll(options: GeneratorOptions): Promise<GenerateResult> {
  const piRoot = await generate(options);
  const packages = await generateSelfContainedPackages(options);
  return { pruned: [...piRoot.pruned, ...packages.pruned].sort() };
}
