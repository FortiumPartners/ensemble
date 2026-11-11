/**
 * Command Skill Transformer
 *
 * Generates SKILL.md wrappers for every command prompt so each one appears
 * in Pi's skill inventory with the full workflow content embedded directly.
 *
 * Mirrors the codex generator's discovery (scripts/generate-codex/index.js
 * generateCommandSkills): dynamically globs the prompt sources instead of a
 * hardcoded allowlist, so a new command prompt gets a SKILL.md wrapper
 * automatically with no source change required.
 *
 * @module ensemble-pi/transformers/command-skill-transformer
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { TransformResult } from '../types';
import { COMMAND_HEADER_PREFIX } from '../generated-marker';
import matter from 'gray-matter';

/**
 * Strip the first HTML comment of the prompt header (the generated marker) so the
 * SKILL.md body starts with the rest of the header and the markdown title. Only the
 * first comment goes: the `<!-- Command: <name> | Version: <v> -->` line stays, and
 * isCommandWrapperSkill relies on that to tie a wrapper to the command it came from.
 */
function stripHeader(content: string): string {
  return content.replace(/^<!--[\s\S]*?-->\n*/m, '');
}

/** Agent Skills spec limit for a SKILL.md `description` (https://agentskills.io/specification). */
export const MAX_DESCRIPTION_LENGTH = 1024;

/**
 * Cap `description` at MAX_DESCRIPTION_LENGTH characters. A description already within
 * the limit is returned unchanged. Otherwise it is cut after the last sentence end
 * (`.`, `!` or `?` followed by whitespace) that fits, else at the last word boundary,
 * else hard at the limit. The wrapper body still carries the complete command text.
 */
export function capDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description;

  // One extra character so a sentence ending exactly at the limit is recognised.
  const window = description.slice(0, MAX_DESCRIPTION_LENGTH + 1);

  let sentenceEnd = -1;
  for (const m of window.matchAll(/[.!?](?=\s)/g)) {
    const end = (m.index ?? 0) + 1;
    if (end <= MAX_DESCRIPTION_LENGTH) sentenceEnd = end;
  }
  if (sentenceEnd > 0) return description.slice(0, sentenceEnd);

  const wordEnd = window.search(/\s\S*$/);
  if (wordEnd > 0) return description.slice(0, wordEnd).trimEnd();

  return description.slice(0, MAX_DESCRIPTION_LENGTH);
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
 * Whether `content` is a command-wrapper skill that generateCommandSkills wrote into
 * the skill directory `skillDirName`: the directory and frontmatter name are the
 * `ensemble-<cmd>` prompt stem, the frontmatter carries `disable-model-invocation: true`,
 * and the body opens with the prompt's own `Command:` header line for that same name.
 * A hand-authored skill that merely shares the name, or sets the same flag, has no such
 * header line, so pruning (generator.ts) never takes it for a wrapper.
 */
export function isCommandWrapperSkill(skillDirName: string, content: string): boolean {
  if (!skillDirName.startsWith('ensemble-')) return false;
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return false; // frontmatter that does not parse is not ours
  }
  return (
    parsed.data['disable-model-invocation'] === true &&
    parsed.data['name'] === skillDirName &&
    parsed.content.trimStart().startsWith(`${COMMAND_HEADER_PREFIX}${skillDirName} |`)
  );
}

/**
 * Where the wrapper skill of the prompt at `promptPath` is written under `outputRoot`:
 * skills/<prompt stem>/SKILL.md. Exported so the generator can name the wrappers a run is
 * about to write (for a dry run, before any prompt is on disk) exactly as this writer does.
 */
export function commandSkillPath(outputRoot: string, promptPath: string): string {
  return path.join(outputRoot, 'skills', path.basename(promptPath, '.md'), 'SKILL.md');
}

/**
 * Generate SKILL.md wrappers for every command prompt.
 *
 * Discovers every prompts/*.md file dynamically and writes a SKILL.md with
 * the full command body embedded directly so each skill is self-contained.
 *
 * Files are written directly (like copySkills) and results returned with
 * type: 'skill' so the main write loop skips them.
 *
 * @param outputRoot  Package root whose prompts/ holds the command prompts and whose
 *                    skills/ receives the wrappers (packages/pi, or a self-contained
 *                    Pi package's directory)
 * @param options     Runtime options. `hideFromClaudeCode` adds `user-invocable: false`
 *                    to each wrapper (Pi and OMP ignore the key; verified on pi 1.3.0 and
 *                    omp 18.12.0, where `skill:<name>` stays registered). Set it for a
 *                    package that is also a Claude Code plugin with the real
 *                    /ensemble:<cmd> command: Claude Code scans that package's skills/
 *                    and would otherwise list the Pi/OMP wrapper beside the command.
 *                    Leave it unset where the wrapper is the only entry point (packages/pi
 *                    has no Claude commands).
 * @returns           Array of TransformResult entries, one per skill generated
 */
export async function generateCommandSkills(
  outputRoot: string,
  options: { dryRun?: boolean; verbose?: boolean; hideFromClaudeCode?: boolean }
): Promise<TransformResult[]> {
  const { dryRun = false, verbose = false, hideFromClaudeCode = false } = options;

  const promptsDir = path.join(outputRoot, 'prompts');
  const results: TransformResult[] = [];

  // NON-recursive on purpose: hidden commands live in prompts/_hidden/ and must
  // not get a wrapper skill (nor be registered by Pi's prompts/*.md scan).
  const promptFiles = (
    await glob(path.join(promptsDir, '*.md').split(path.sep).join('/'), { absolute: true })
  ).sort();

  for (const promptPath of promptFiles) {
    const skillName = path.basename(promptPath, '.md');

    let promptContent: string;
    try {
      promptContent = fs.readFileSync(promptPath, 'utf-8');
    } catch (err) {
      process.stderr.write(
        `  command-skill: warning — cannot read ${promptPath}: ${(err as Error).message}\n`
      );
      continue;
    }

    // The spec caps `description` at 1024 chars; the full Mission text stays in the body.
    const description = capDescription(extractDescription(promptContent, skillName));
    const promptBody = stripHeader(promptContent);

    // Build SKILL.md with frontmatter + embedded prompt body.
    // NOTE: disable-model-invocation is experimental — Pi may not consume this field.
    // Remove it if Pi rejects unknown frontmatter keys.
    const skillBody = matter.stringify(promptBody, {
      name: skillName,
      description,
      // Prevent auto-trigger from description matching; invoke via explicit /skill-name only
      'disable-model-invocation': true,
      ...(hideFromClaudeCode ? { 'user-invocable': false } : {}),
    });

    const outputPath = commandSkillPath(outputRoot, promptPath);

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
