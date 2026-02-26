/**
 * SkillCopier - Discovers and copies SKILL.md files to OpenCode paths
 *
 * Responsibilities:
 *   - Discover all SKILL.md files across packages/*/skills/
 *   - Inject frontmatter (name, description) for OpenCode discovery
 *   - Convert REFERENCE.md to SKILL.md format where needed
 *   - Copy validated skills to dist/opencode/.opencode/skill/<framework>/
 *   - Generate skills.paths config entries for opencode.json
 *
 * Task IDs: OC-S1-SK-001 through OC-S1-SK-006
 *
 * NOTE: The runtime implementation is in packages/opencode/lib/skill-copier.js
 * This TypeScript file serves as the type definition and will re-export
 * the JS implementation once the build pipeline compiles it.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SkillCopierOptions {
  /** Path to packages/ directory */
  packagesDir: string;
  /** Path to dist/opencode/.opencode/skill/ */
  outputDir: string;
  /** Whether to add frontmatter (default: true) */
  injectFrontmatter?: boolean;
  /** If true, don't write files */
  dryRun?: boolean;
  /** If true, log progress */
  verbose?: boolean;
}

export interface TranslationError {
  file: string;
  error: string;
}

export interface SkillCopierResult {
  skillsCopied: number;
  referencesConverted: number;
  /** Generated skill config paths for opencode.json */
  paths: string[];
  errors: TranslationError[];
}

interface PackageInfo {
  packageName: string;
  skillPath: string;
}

interface ParsedFrontmatter {
  data: Record<string, string | string[]>;
  content: string;
  hasFrontmatter: boolean;
}

/**
 * Parse YAML frontmatter from a markdown string.
 */
function parseFrontmatter(input: string): ParsedFrontmatter {
  if (!input.startsWith('---\n')) {
    return { data: {}, content: input, hasFrontmatter: false };
  }

  const endIndex = input.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    if (input.endsWith('\n---')) {
      const yamlStr = input.slice(4, input.length - 3);
      const data = parseSimpleYaml(yamlStr);
      return { data, content: '', hasFrontmatter: true };
    }
    return { data: {}, content: input, hasFrontmatter: false };
  }

  const yamlStr = input.slice(4, endIndex);
  const content = input.slice(endIndex + 5);
  const data = parseSimpleYaml(yamlStr);

  return { data, content, hasFrontmatter: true };
}

/**
 * Parse simple YAML key-value pairs (single level only).
 */
function parseSimpleYaml(yamlStr: string): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {};
  const lines = yamlStr.split('\n');
  let currentKey: string | null = null;

  for (const line of lines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    if (/^\s+-\s+/.test(line) && currentKey) {
      const value = line.replace(/^\s+-\s+/, '').trim();
      if (!Array.isArray(data[currentKey])) {
        data[currentKey] = [];
      }
      (data[currentKey] as string[]).push(value);
      continue;
    }

    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (match) {
      const key = match[1];
      let value = match[2].trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      currentKey = key;
      data[key] = value;
    }
  }

  return data;
}

/**
 * Stringify a simple object to YAML frontmatter format.
 */
function stringifyFrontmatter(data: Record<string, string | string[]>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      const strValue = String(value);
      if (
        strValue.includes(':') ||
        strValue.includes('#') ||
        strValue.includes('{') ||
        strValue.includes('}')
      ) {
        lines.push(`${key}: "${strValue}"`);
      } else {
        lines.push(`${key}: ${strValue}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Extract the first meaningful line of content from markdown.
 */
function extractDescription(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('#') ||
      trimmed === '---' ||
      trimmed.startsWith('**Version') ||
      trimmed.startsWith('**Use Case')
    ) {
      continue;
    }
    const cleaned = trimmed.replace(/\*\*/g, '').trim();
    if (cleaned.length > 0) {
      return cleaned.length > 120 ? cleaned.slice(0, 117) + '...' : cleaned;
    }
  }
  return 'Ensemble skill documentation';
}

export class SkillCopier {
  private packagesDir: string;
  private outputDir: string;
  private injectFrontmatter: boolean;
  private dryRun: boolean;
  private verbose: boolean;

  constructor(options: SkillCopierOptions) {
    this.packagesDir = options.packagesDir;
    this.outputDir = options.outputDir;
    this.injectFrontmatter = options.injectFrontmatter !== undefined ? options.injectFrontmatter : true;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
  }

  async execute(): Promise<SkillCopierResult> {
    const errors: TranslationError[] = [];
    let skillsCopied = 0;
    let referencesConverted = 0;

    const packageDirs = this.discoverPackages();

    if (this.verbose) {
      console.log(`Discovered ${packageDirs.length} packages with skills`);
    }

    for (const { packageName, skillPath } of packageDirs) {
      const skillFile = path.join(skillPath, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        try {
          this.processSkillFile(packageName, skillFile);
          skillsCopied++;
        } catch (err: any) {
          errors.push({ file: skillFile, error: err.message });
        }
      }
    }

    for (const { packageName, skillPath } of packageDirs) {
      const refFile = path.join(skillPath, 'REFERENCE.md');
      if (fs.existsSync(refFile)) {
        try {
          this.processReferenceFile(packageName, refFile);
          referencesConverted++;
        } catch (err: any) {
          errors.push({ file: refFile, error: err.message });
        }
      }
    }

    const paths = this.generatePaths();

    return { skillsCopied, referencesConverted, paths, errors };
  }

  private discoverPackages(): PackageInfo[] {
    const results: PackageInfo[] = [];

    if (!fs.existsSync(this.packagesDir)) {
      return results;
    }

    const entries = fs.readdirSync(this.packagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(this.packagesDir, entry.name, 'skills');
      if (fs.existsSync(skillPath) && fs.statSync(skillPath).isDirectory()) {
        const hasSkill = fs.existsSync(path.join(skillPath, 'SKILL.md'));
        const hasRef = fs.existsSync(path.join(skillPath, 'REFERENCE.md'));

        if (hasSkill || hasRef) {
          results.push({ packageName: entry.name, skillPath });
        }
      }
    }

    return results;
  }

  private processSkillFile(packageName: string, sourcePath: string): void {
    const rawContent = fs.readFileSync(sourcePath, 'utf-8');
    let outputContent: string;

    if (this.injectFrontmatter) {
      outputContent = this.ensureFrontmatter(rawContent, packageName);
    } else {
      outputContent = rawContent;
    }

    if (!this.dryRun) {
      const outDir = path.join(this.outputDir, packageName);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'SKILL.md'), outputContent, 'utf-8');
    }

    if (this.verbose) {
      console.log(`  [SKILL] ${packageName}/SKILL.md -> ${packageName}/SKILL.md`);
    }
  }

  private processReferenceFile(packageName: string, sourcePath: string): void {
    const rawContent = fs.readFileSync(sourcePath, 'utf-8');
    let outputContent: string;

    if (this.injectFrontmatter) {
      outputContent = this.createReferenceFrontmatter(rawContent, packageName);
    } else {
      outputContent = rawContent;
    }

    if (!this.dryRun) {
      const outDir = path.join(this.outputDir, packageName, 'reference');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'SKILL.md'), outputContent, 'utf-8');
    }

    if (this.verbose) {
      console.log(`  [REF]   ${packageName}/REFERENCE.md -> ${packageName}/reference/SKILL.md`);
    }
  }

  private ensureFrontmatter(rawContent: string, packageName: string): string {
    const parsed = parseFrontmatter(rawContent);

    if (parsed.hasFrontmatter) {
      const data = { ...parsed.data };
      let modified = false;

      if (!data.name) {
        data.name = packageName;
        modified = true;
      }

      if (!data.description) {
        data.description = extractDescription(parsed.content);
        modified = true;
      }

      if (modified) {
        const yamlStr = stringifyFrontmatter(data);
        return `---\n${yamlStr}\n---\n${parsed.content}`;
      }

      return rawContent;
    }

    const description = extractDescription(rawContent);
    const data: Record<string, string> = { name: packageName, description };
    const yamlStr = stringifyFrontmatter(data);
    return `---\n${yamlStr}\n---\n${rawContent}`;
  }

  private createReferenceFrontmatter(rawContent: string, packageName: string): string {
    const parsed = parseFrontmatter(rawContent);
    const body = parsed.hasFrontmatter ? parsed.content : rawContent;
    const description = extractDescription(body);

    const data: Record<string, string> = {
      name: `${packageName}-reference`,
      description,
    };

    const yamlStr = stringifyFrontmatter(data);
    return `---\n${yamlStr}\n---\n${body}`;
  }

  private generatePaths(): string[] {
    return [this.outputDir];
  }
}
