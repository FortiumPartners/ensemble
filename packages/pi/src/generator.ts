/**
 * Pi Generator Orchestrator
 *
 * Discovers Ensemble YAML sources across packages/*, validates structural
 * requirements, calls transformers, and writes Pi-compatible artifacts to
 * packages/pi/prompts/, agents/, skills/, and AGENTS.md.
 *
 * Supports --dry-run (collect without writing), --verbose (log paths),
 * and --validate (parse output .md files after generation).
 *
 * @module ensemble-pi/generator
 */

import { GeneratorOptions, TransformResult, CommandYaml } from './types';
import { transformCommand } from './transformers/command-transformer';
import { buildAgentResult } from './transformers/agent-transformer';
import { copySkills } from './transformers/skill-copier';
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
 */
async function discoverYamlFiles(pattern: string): Promise<string[]> {
  const files = await glob(pattern, { absolute: true });
  return files.sort();
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

/**
 * Sections from CLAUDE.md that are relevant to Pi agents.
 * These section headings (prefix-matched at the ## level) will be INCLUDED.
 */
const INCLUDED_SECTION_PREFIXES = [
  '## Agent Mesh',
  '## Agent Delegation Protocol',
  '## Architecture Overview',
];

/**
 * Keywords that mark a section or sub-section as Claude Code-specific.
 * Any ## or ### heading containing one of these terms will be EXCLUDED,
 * along with all content until the next same-or-higher-level heading.
 */
const EXCLUDED_SECTION_KEYWORDS = [
  'hook',
  'plugin install',
  'plugin uninstall',
  'settings.local.json',
  'claude code permissions',
  'claude plugin',
  'permission',
];

/** Return true if a heading line should be excluded based on Claude Code-specific keywords. */
function isExcludedHeading(line: string): boolean {
  const lower = line.toLowerCase();
  return EXCLUDED_SECTION_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Return the heading level of a markdown heading line (1-6), or 0 if not a heading. */
function headingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

/**
 * Parse CLAUDE.md content and extract only sections relevant to Pi agents,
 * stripping Claude Code-specific sections (hooks, permissions, plugin install).
 */
function extractAgentSections(claudeMdContent: string): string {
  const lines = claudeMdContent.split('\n');
  const output: string[] = [];

  let inIncludedSection = false;
  let inExcludedSubsection = false;
  let excludedLevel = 0;

  output.push(
    '# Ensemble Agent Mesh',
    '',
    '> Extracted from CLAUDE.md — relevant sections for Pi agent runtime.',
    ''
  );

  for (const line of lines) {
    const level = headingLevel(line);

    if (level === 2) {
      // Top-level section boundary (##)
      inExcludedSubsection = false;
      excludedLevel = 0;

      const matchesIncluded = INCLUDED_SECTION_PREFIXES.some((prefix) =>
        line.startsWith(prefix)
      );

      if (matchesIncluded && !isExcludedHeading(line)) {
        inIncludedSection = true;
        output.push(line);
      } else {
        inIncludedSection = false;
      }
      continue;
    }

    if (!inIncludedSection) continue;

    if (level > 0) {
      // Sub-section heading inside an included section
      if (inExcludedSubsection && level > excludedLevel) {
        // Still inside excluded sub-section — skip
        continue;
      }
      // End of excluded sub-section at same or higher level
      inExcludedSubsection = false;
      excludedLevel = 0;

      if (isExcludedHeading(line)) {
        inExcludedSubsection = true;
        excludedLevel = level;
        continue;
      }
    } else {
      // Non-heading line
      if (inExcludedSubsection) continue;
    }

    output.push(line);
  }

  // Trim trailing blank lines and add a single trailing newline
  while (output.length > 0 && output[output.length - 1].trim() === '') {
    output.pop();
  }
  output.push('');

  return output.join('\n');
}

/**
 * Generate packages/pi/AGENTS.md by extracting agent-relevant sections from
 * the monorepo's root CLAUDE.md (sourceRoot/CLAUDE.md).
 *
 * Claude Code-specific content (hooks, permissions, plugin install/uninstall)
 * is stripped from the output.
 *
 * @param sourceRoot  Monorepo root path (where CLAUDE.md lives).
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

  // Primary source: root CLAUDE.md (the canonical agent mesh document).
  // Note: packages/CLAUDE.md does not exist; the TRD reference is to this file.
  const sourcePath = path.join(sourceRoot, 'CLAUDE.md');

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`generateAgentsMd: source file not found: ${sourcePath}`);
  }

  const rawContent = fs.readFileSync(sourcePath, 'utf-8');
  const content = extractAgentSections(rawContent);
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
 * Normalises "ensemble:command-name" → "ensemble-command-name" for filesystem safety.
 */
function buildCommandResult(
  commandYaml: CommandYaml,
  sourcePath: string,
  outputRoot: string,
  verbose: boolean
): TransformResult {
  const name = commandYaml.metadata.name;
  const safeName = name.replace(/:/g, '-');
  const outputPath = path.join(outputRoot, 'prompts', `${safeName}.md`);
  const content = transformCommand(commandYaml, sourcePath, { verbose });
  return { sourcePath, outputPath, content, type: 'command' };
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

export async function generate(options: GeneratorOptions): Promise<void> {
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
  const commandFiles = await discoverYamlFiles(commandPattern);

  if (verbose) {
    process.stdout.write(`Discovered ${commandFiles.length} command YAML file(s).\n`);
  }

  for (const filePath of commandFiles) {
    let raw: unknown;
    try {
      raw = yaml.load(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      throw new Error(`YAML parse error in ${filePath}: ${(err as Error).message}`);
    }

    // Structural validation runs BEFORE any transformation (TRD-005 requirement)
    const commandYaml = validateCommandYaml(raw, filePath);
    const result = buildCommandResult(commandYaml, filePath, outputRoot, verbose);

    if (verbose) {
      process.stdout.write(`  command: ${filePath} → ${result.outputPath}\n`);
    }

    results.push(result);
  }

  // ------------------------------------------------------------------
  // 2. Discover and process agent YAML files
  // ------------------------------------------------------------------
  const agentPattern = path.join(sourceRoot, 'packages/*/agents/*.yaml');
  const agentFiles = await discoverYamlFiles(agentPattern);

  if (verbose) {
    process.stdout.write(`Discovered ${agentFiles.length} agent YAML file(s).\n`);
  }

  for (const filePath of agentFiles) {
    let raw: unknown;
    try {
      raw = yaml.load(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      throw new Error(`YAML parse error in ${filePath}: ${(err as Error).message}`);
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
  }

  // ------------------------------------------------------------------
  // 3. Skill files (TRD-008)
  // ------------------------------------------------------------------
  const skillResults = await copySkills(sourceRoot, outputRoot, { dryRun, verbose });
  results.push(...skillResults);

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
      // agents-md and skill files are already written by their respective transformers
      if (result.type !== 'agents-md' && result.type !== 'skill') {
        writeResult(result);
      }
    }
  } else if (verbose) {
    process.stdout.write(
      `Dry-run mode: ${results.length} artifact(s) collected but not written.\n`
    );
  }

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
}
