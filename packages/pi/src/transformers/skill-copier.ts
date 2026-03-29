/**
 * Skill Copier
 *
 * Propagates SKILL.md (and REFERENCE.md) files from Ensemble framework
 * skill packages into packages/pi/skills/ for consumption by the Pi runtime.
 *
 * Discovery pattern:
 *   - packages/*\/skills\/<subdir>\/{SKILL,REFERENCE}.md  (subdirectory layout)
 *   - packages/*\/skills\/{SKILL,REFERENCE}.md            (top-level layout, e.g. blazor, nestjs)
 *
 * Output layout:
 *   - Subdirectory layout: packages/pi/skills/<subdir>/<filename>
 *   - Top-level layout:    packages/pi/skills/<package-name>/<filename>
 *
 * The `pi` package itself is excluded from scanning to avoid self-referential copies.
 * Symlinks (e.g. packages/full/skills/) are resolved before copying; if two paths
 * resolve to the same real file, the second is skipped.
 *
 * Files are copied byte-for-byte (no content transformation).
 *
 * @module ensemble-pi/transformers/skill-copier
 */

import * as fs from 'fs';
import * as path from 'path';
import { TransformResult } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File names to copy from each skill directory. */
const SKILL_FILES = ['SKILL.md', 'REFERENCE.md'];

/** Package directories to skip during scanning (output targets, not sources). */
const SKIP_PACKAGES = new Set(['pi', 'full']);

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
  /** File name (SKILL.md or REFERENCE.md). */
  fileName: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Discover skill files across all packages.
 *
 * Handles two layouts:
 *   1. Subdirectory layout: packages/<pkg>/skills/<subdir>/SKILL.md
 *      → skillDirName = <subdir>
 *   2. Top-level layout: packages/<pkg>/skills/SKILL.md
 *      → skillDirName = <pkg>
 *
 * Skips packages in SKIP_PACKAGES (pi, full).
 */
function discoverSkillFiles(packagesDir: string): SkillFileEntry[] {
  const entries: SkillFileEntry[] = [];

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
    if (SKIP_PACKAGES.has(pkgDirent.name)) continue;

    const pkgName = pkgDirent.name;
    const skillsDir = path.join(packagesDir, pkgName, 'skills');

    if (!fs.existsSync(skillsDir)) continue;

    let skillDirents: fs.Dirent[];
    try {
      skillDirents = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    // Check for top-level SKILL.md / REFERENCE.md directly in skills/
    for (const fileName of SKILL_FILES) {
      const topLevelFile = path.join(skillsDir, fileName);
      if (fs.existsSync(topLevelFile)) {
        let realSrcPath: string;
        try {
          realSrcPath = fs.realpathSync(topLevelFile);
        } catch {
          continue;
        }
        entries.push({
          realSrcPath,
          srcPath: topLevelFile,
          skillDirName: pkgName,
          fileName,
        });
      }
    }

    // Check each subdirectory entry for SKILL.md / REFERENCE.md
    for (const skillDirent of skillDirents) {
      // Only look at directories (including symlinked dirs)
      const subPath = path.join(skillsDir, skillDirent.name);

      let resolvedSubPath: string;
      try {
        resolvedSubPath = fs.realpathSync(subPath);
      } catch {
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(resolvedSubPath);
      } catch {
        continue;
      }

      if (!stat.isDirectory()) continue;

      for (const fileName of SKILL_FILES) {
        const filePath = path.join(resolvedSubPath, fileName);
        if (fs.existsSync(filePath)) {
          let realSrcPath: string;
          try {
            realSrcPath = fs.realpathSync(filePath);
          } catch {
            continue;
          }
          entries.push({
            realSrcPath,
            srcPath: filePath,
            skillDirName: skillDirent.name,
            fileName,
          });
        }
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Copy SKILL.md and REFERENCE.md files from all Ensemble skill packages
 * into the Pi output root under `skills/<skill-name>/`.
 *
 * No content transformation is performed — files are copied byte-for-byte.
 *
 * Deduplication: if two paths resolve to the same real file (common when
 * packages/full uses symlinks), only the first occurrence is copied.
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
    process.stdout.write(
      `skill-copier: found ${skillEntries.length} skill file(s) before dedup\n`
    );
  }

  // Deduplicate by resolved (real) path to avoid double-copying symlinked skills
  const seen = new Set<string>();
  const results: TransformResult[] = [];

  for (const entry of skillEntries) {
    if (seen.has(entry.realSrcPath)) {
      if (verbose) {
        process.stdout.write(`  skill-copier: skipping duplicate ${entry.srcPath}\n`);
      }
      continue;
    }
    seen.add(entry.realSrcPath);

    const outputPath = path.join(skillsOutputDir, entry.skillDirName, entry.fileName);

    // Read file content
    let content: string;
    try {
      content = fs.readFileSync(entry.realSrcPath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `  skill-copier: warning — cannot read ${entry.srcPath}: ${(err as Error).message}\n`
      );
      continue;
    }

    const result: TransformResult = {
      sourcePath: entry.srcPath,
      outputPath,
      content,
      type: 'skill',
    };

    if (!dryRun) {
      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, content, 'utf-8');
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
