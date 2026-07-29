/**
 * Command Skill Transformer
 *
 * Generates SKILL.md wrappers for targeted command prompts so they appear in
 * Pi's skill inventory with the full workflow content embedded directly.
 *
 * Only wraps commands that need explicit skill registration — does not flood
 * the inventory with every command prompt.
 *
 * @module ensemble-pi/transformers/command-skill-transformer
 */

import * as fs from 'fs';
import * as path from 'path';
import { GeneratorOptions, TransformResult } from '../types';
import matter from 'gray-matter';

/**
 * Commands that get SKILL.md wrappers.
 * Key = skill name (kebab-case, Pi-valid), Value = prompt filename suffix.
 */
const TARGET_COMMANDS: Record<string, string> = {
  'ensemble-full-create-prd': 'ensemble-full-create-prd',
  'ensemble-full-refine-prd': 'ensemble-full-refine-prd',
  'ensemble-full-create-trd': 'ensemble-full-create-trd',
  'ensemble-full-refine-trd': 'ensemble-full-refine-trd',
  'ensemble-full-implement-trd': 'ensemble-full-implement-trd',
  'ensemble-full-implement-trd-beads': 'ensemble-full-implement-trd-beads',
  'ensemble-full-create-trd-foreman': 'ensemble-full-create-trd-foreman',
};

/**
 * Strip the HTML comment header block (lines starting with `<!--`) from prompt
 * content so the SKILL.md body starts with the actual markdown title.
 */
function stripHeader(content: string): string {
  return content.replace(/^<!--[\s\S]*?-->\n*/m, '');
}

/**
 * Extract the description from frontmatter or the first > **Mission:** paragraph.
 */
function extractDescription(promptContent: string, skillName: string): string {
  const parsed = matter(promptContent);
  if (parsed.data['description']) {
    return String(parsed.data['description']);
  }
  const match = parsed.content.match(/> \*\*Mission:\*\* ([^\n]+)/);
  return match ? match[1].trim() : `Ensemble ${skillName} command`;
}

/**
 * Generate SKILL.md wrappers for targeted command prompts.
 *
 * Reads the already-generated prompt files from outputRoot/prompts/, extracts
 * the full prompt body (stripping the HTML header comment), and writes a
 * SKILL.md with that content embedded directly so the skill is self-contained.
 *
 * Files are written directly (like copySkills) and results returned with
 * type: 'skill' so the main write loop skips them.
 *
 * @param outputRoot  Pi package root (packages/pi)
 * @param options     Runtime options
 * @returns           Array of TransformResult entries, one per skill generated
 */
export async function generateCommandSkills(
  outputRoot: string,
  options: { dryRun?: boolean; verbose?: boolean }
): Promise<TransformResult[]> {
  const { dryRun = false, verbose = false } = options;

  const promptsDir = path.join(outputRoot, 'prompts');
  const skillsOutputDir = path.join(outputRoot, 'skills');
  const results: TransformResult[] = [];

  for (const [skillName, promptSuffix] of Object.entries(TARGET_COMMANDS)) {
    const promptPath = path.join(promptsDir, `${promptSuffix}.md`);

    if (!fs.existsSync(promptPath)) {
      if (verbose) {
        process.stderr.write(
          `  command-skill: skipping ${skillName} — prompt not found at ${promptPath}\n`
        );
      }
      continue;
    }

    let promptContent: string;
    try {
      promptContent = fs.readFileSync(promptPath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `  command-skill: warning — cannot read ${promptPath}: ${(err as Error).message}\n`
      );
      continue;
    }

    const description = extractDescription(promptContent, skillName);
    const promptBody = stripHeader(promptContent);

    // Build SKILL.md with frontmatter + embedded prompt body.
    // NOTE: disable-model-invocation is experimental — Pi may not consume this field.
    // Remove it if Pi rejects unknown frontmatter keys.
    const skillBody = matter.stringify(promptBody, {
      name: skillName,
      description,
      // Prevent auto-trigger from description matching; invoke via explicit /skill-name only
      'disable-model-invocation': true,
    });

    const outputPath = path.join(skillsOutputDir, skillName, 'SKILL.md');

    const result: TransformResult = {
      sourcePath: promptPath,
      outputPath,
      content: skillBody,
      type: 'skill',
    };

    if (!dryRun) {
      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outputPath, skillBody.replace(/\r\n/g, '\n'), 'utf-8');
    }

    if (verbose) {
      process.stdout.write(`  command-skill: ${promptPath} → ${outputPath}\n`);
    }

    results.push(result);
  }

  if (verbose) {
    process.stdout.write(
      `command-skill: ${results.length} skill(s) ${dryRun ? 'collected (dry-run)' : 'generated'}.\n`
    );
  }

  return results;
}
