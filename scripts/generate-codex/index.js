#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { globSync } = require('glob');
// glob needs forward-slash patterns even on Windows, where path.join() produces
// backslashes that glob reads as escape characters. Without this every pattern
// below matched zero files on Windows and the generator deleted its own output
// as orphaned.
const { toGlobPattern } = require('../lib/file-discovery');
const { vendorToolchainLibrary } = require('../lib/toolchain-vendor');
const { isSkillBacked, resolveSkillFile } = require('../lib/skill-backed-command');

const ROOT = path.resolve(__dirname, '..', '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
// Packages that MIRROR every other package's skills/adapter-* directories (packages/pi's own
// generator output, packages/full's curated symlink tree -- see
// packages/pi/src/transformers/skill-copier.ts's own EXCLUDED_PACKAGES for the same rule on
// the Pi side) must never be treated as a SECOND, independent adapter source: TRD-024 is the
// first real adapter this monorepo ships, and it exposed a latent gap here -- `packages/pi`'s
// generated `packages/pi/skills/adapter-tracker-beads/` otherwise collides with the real
// source at `packages/development/skills/adapter-tracker-beads/`, a false positive this
// generator's own collision check (below) would wrongly treat as two different packages
// shipping the same adapter name.
const ADAPTER_SOURCE_EXCLUDED_PACKAGES = new Set(['pi', 'full']);
const CODEX_PACKAGE_DIR = path.join(PACKAGES_DIR, 'codex');
const OUTPUT_DIR = path.join(CODEX_PACKAGE_DIR, '.codex');
const AGENTS_OUTPUT = path.join(CODEX_PACKAGE_DIR, 'AGENTS.md');
const DEFAULT_MODEL = 'gpt-5.1-codex';
// Codex targets OpenAI models, so any Anthropic-family tier alias coming from
// the source frontmatter (opus/sonnet/haiku) maps to the OpenAI DEFAULT_MODEL.
const ANTHROPIC_ALIASES = new Set(['opus', 'sonnet', 'haiku']);
// Agents whose source declares them READ-ONLY (they record findings and change nothing).
// Their Codex agent file gets the read-only sandbox, so the mirror enforces what the
// source documents instead of defaulting to workspace-write like every other agent.
const READ_ONLY_AGENTS = new Set(['code-reviewer']);
const AVAILABLE_SKILLS = new Set(['react', 'nestjs', 'rails', 'phoenix', 'blazor', 'dotnet', 'jest', 'pytest', 'rspec', 'xunit', 'exunit', 'reqnroll']);
// Framework skills are named after their technology (skills/react/, skills/nestjs/, ...).
// A bare `skills/<name>/` path is rewritten to the Codex location; the lookbehind leaves
// already-prefixed (`.codex/skills/...`) and longer paths (`packages/x/skills/...`) alone.
const FRAMEWORK_SKILL_REWRITES = [
  [/(?<![\w./-])skills\/(react|nestjs|rails|phoenix|blazor|dotnet|jest|pytest|rspec|xunit|exunit)\//g, '.codex/skills/$1/'],
  [/skills\/\{framework\}\//g, '.codex/skills/<framework>/'],
];

// Framework skills ship to Codex lean: SKILL.md only (packages/codex/tests/package-structure.test.js
// pins that for react). These also carry their REFERENCE.md.
const FRAMEWORK_SKILLS_WITH_REFERENCE = new Set(['reqnroll']);

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
  };
}

function log(verbose, message) {
  if (verbose) process.stdout.write(`${message}\n`);
}

function ensureDir(dirPath, dryRun) {
  if (!dryRun) fs.mkdirSync(dirPath, { recursive: true });
}

function resetOutput(dryRun) {
  if (!dryRun) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function writeFile(filePath, content, dryRun, verbose) {
  log(verbose, `${dryRun ? '[dry-run] ' : ''}write ${path.relative(ROOT, filePath)}`);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function copyFile(sourcePath, destPath, dryRun, verbose) {
  log(verbose, `${dryRun ? '[dry-run] ' : ''}copy ${path.relative(ROOT, sourcePath)} -> ${path.relative(ROOT, destPath)}`);
  if (dryRun) return;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
}

/** Normalize CRLF/CR to LF so the frontmatter delimiter regex can assume '\n'. */
function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function parseSimpleFrontmatter(rawFrontmatter) {
  const data = {};
  for (const line of rawFrontmatter.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    data[key] = value.replace(/^['"]|['"]$/g, '');
  }
  return data;
}

function parseFrontmatter(markdown) {
  // CRLF safety: the delimiter regex requires a literal '\n' next to '---',
  // so a CRLF-sourced file (the norm on Windows checkouts with
  // core.autocrlf=true) would silently discard real frontmatter as if it
  // were part of the body.
  const normalized = normalizeLineEndings(markdown);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { data: {}, content: normalized };
  }

  let data;
  try {
    data = yaml.load(match[1]) || {};
  } catch (_err) {
    data = parseSimpleFrontmatter(match[1]);
  }

  const content = normalized.slice(match[0].length);
  return { data, content };
}

function yamlFrontmatter(data) {
  return `---\n${yaml.dump(data, { lineWidth: 1000 }).trimEnd()}\n---\n`;
}

function firstMeaningfulLine(markdown) {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === '---') continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('**Version')) continue;
    if (trimmed.startsWith('**Framework')) continue;
    if (trimmed.startsWith('**Use Case')) continue;
    return trimmed.replace(/\*\*/g, '').slice(0, 160);
  }
  return 'Ensemble Codex skill';
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlMultiline(value) {
  const normalized = normalizeLineEndings(value).replace(/"""/g, '\\"\\"\\"');
  return `"""\n${normalized.trim()}\n"""`;
}

function buildCodexAgentsMd(commandCount, agentCount, skillCount) {
  const parts = [
    '# Ensemble for Codex',
    '',
    `Use this bundle to bring Ensemble into Codex CLI. It provides ${agentCount} custom agents, ${commandCount} command skills, and ${skillCount} framework/testing skills.`,
    '',
    '## What Codex Should Know',
    '',
    '- Prefer the custom agents in `.codex/agents/` for specialized work.',
    '- Treat `AGENTS.md` as the shared project contract and `.codex/config.toml` as the agent registry.',
    '- Ensemble slash commands are exposed as Codex skills using `/ensemble-...` names such as `/ensemble-create-prd`.',
    '- Framework and test skills live under `.codex/skills/` and should be consulted before framework-specific implementation.',
    '',
    '## Recommended Workflow',
    '',
    '1. Read the nearest `AGENTS.md` files that apply to files you touch.',
    '2. Pick a specialized agent when the task clearly matches one.',
    '3. Load relevant framework/test skills before editing implementation code.',
    '4. Prefer small, verifiable changes and run focused tests after edits.',
    '5. Summarize changed files, validation run, and any remaining risks.',
    '',
    '## Agent Routing',
    '',
    '- Product/spec work: `product-management-orchestrator`, `documentation-specialist`',
    '- Application code: `backend-developer`, `frontend-developer`, `tech-lead-orchestrator`',
    '- Quality: `code-reviewer`, `deep-debugger`, `test-runner`, `playwright-tester`',
    '- Infra/release: `infrastructure-developer`, `build-orchestrator`, `deployment-orchestrator`',
    '',
    '## Key Skills',
    '',
    '- Frameworks: `react`, `nestjs`, `rails`, `phoenix`, `blazor`, `dotnet`',
    '- Test frameworks: `jest`, `pytest`, `rspec`, `xunit`, `exunit`',
    '- Commands: `.codex/skills/commands/ensemble-*/SKILL.md`',
    '',
    '## Validation',
    '',
    '- Run `npm test` for broad verification.',
    '- Run package-specific tests when editing one package.',
    '- Use `npm run generate`, `npm run generate:pi`, `npm run generate:opencode`, or `npm run generate:codex` after changing generators or source YAML.',
    '',
    '## Beads',
    '',
    '- Start with `bv --robot-triage` or `br ready` when working from the issue queue.',
    '- Claim with `br update <id> --status in_progress` and close with `br close <id>` when done.',
    '- Run `br sync --flush-only` before ending a work session that changed bead state.',
    '',
  ];

  return parts.join('\n');
}

function normalizeSkillBody(content) {
  let normalized = content;
  for (const [pattern, replacement] of FRAMEWORK_SKILL_REWRITES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.trim();
}

function detectAgentSkills(name, content) {
  const skills = new Set();
  const lowerName = name.toLowerCase();
  const lowerContent = content.toLowerCase();

  const contentMentions = (patterns) => patterns.some((pattern) => lowerContent.includes(pattern));
  const nameMentions = (patterns) => patterns.some((pattern) => lowerName.includes(pattern));

  if (nameMentions(['frontend']) || contentMentions(['react', 'next.js', 'tsx', 'jsx'])) skills.add('react');
  if (contentMentions(['nestjs'])) skills.add('nestjs');
  if (contentMentions(['rails'])) skills.add('rails');
  if (contentMentions(['phoenix'])) skills.add('phoenix');
  if (contentMentions(['blazor'])) skills.add('blazor');
  if (contentMentions(['.net', 'dotnet', 'asp.net'])) skills.add('dotnet');
  if (contentMentions(['jest'])) skills.add('jest');
  if (contentMentions(['pytest'])) skills.add('pytest');
  if (contentMentions(['rspec'])) skills.add('rspec');
  if (contentMentions(['xunit'])) skills.add('xunit');
  if (contentMentions(['exunit'])) skills.add('exunit');
  if (contentMentions(['reqnroll'])) skills.add('reqnroll');

  if (lowerName.includes('test') || lowerName.includes('debug') || lowerName.includes('review')) {
    ['jest', 'pytest', 'rspec', 'xunit', 'exunit'].forEach((skill) => skills.add(skill));
  }

  if (lowerName.includes('backend')) {
    ['nestjs', 'rails', 'phoenix', 'dotnet'].forEach((skill) => skills.add(skill));
  }

  return Array.from(skills).filter((skill) => AVAILABLE_SKILLS.has(skill)).sort();
}

/**
 * An ordinary (non command-wrapper) skill keeps the frontmatter its source declares and gains no
 * host keys: `user-invocable` belongs to the `ensemble-*` wrapper skills alone. A source with no
 * frontmatter gets a name and a description synthesized from its body.
 */
function skillFrontmatter(parsed, name) {
  return Object.keys(parsed.data).length > 0
    ? parsed.data
    : { name, description: firstMeaningfulLine(parsed.content) };
}

/**
 * Copy the framework skills (react, jest, reqnroll, ...). Each is a skill named after the
 * package that owns it, at `packages/<pkg>/skills/<pkg>/SKILL.md`, and lands at
 * `.codex/skills/<pkg>/SKILL.md`.
 */
function copyFrameworkSkills({ dryRun, verbose }) {
  const packageNames = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  let count = 0;

  for (const packageName of packageNames) {
    const skillDir = path.join(PACKAGES_DIR, packageName, 'skills', packageName);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const dest = path.join(OUTPUT_DIR, 'skills', packageName, 'SKILL.md');
    const parsed = parseFrontmatter(readFile(skillFile));
    writeFile(dest, `${yamlFrontmatter(skillFrontmatter(parsed, packageName))}\n${normalizeSkillBody(parsed.content)}\n`, dryRun, verbose);

    const referencePath = path.join(skillDir, 'REFERENCE.md');
    if (FRAMEWORK_SKILLS_WITH_REFERENCE.has(packageName) && fs.existsSync(referencePath)) {
      writeFile(path.join(OUTPUT_DIR, 'skills', packageName, 'REFERENCE.md'), `${normalizeSkillBody(readFile(referencePath))}\n`, dryRun, verbose);
    }
    count += 1;
  }
  return count;
}

/**
 * Copy adapter skill directories (TRD-020, PRD REQ-021): a `packages/<pkg>/skills/adapter-NAME`
 * directory ships a `SKILL.md` describing the adapter plus an `adapter.yaml` manifest the
 * toolchain resolver reads. Both files land together under `.codex/skills/<adapter-dir-name>/`,
 * keyed by the adapter DIRECTORY's own name (not the owning package name) so two adapters
 * shipped from the same package never collide. Two DIFFERENT packages shipping an adapter
 * directory with the same basename is a hard generator failure (see the collision check
 * below), not a silent last-writer-wins overwrite.
 *
 * SKILL.md goes through the same frontmatter-synthesis path as copyFrameworkSkills (fixture
 * adapter SKILL.md files — see scripts/tests/fixtures/toolchain/good-adapter/SKILL.md — ship
 * with no frontmatter of their own, same as most framework skills) for consistency with every
 * other Codex skill. adapter.yaml is never rewritten: it is the toolchain resolver's own
 * manifest format, copied byte-for-byte like lib-bundler.ts copies vendored libs.
 */
function copyAdapterSkills({ dryRun, verbose, packagesDir = PACKAGES_DIR, outputDir = OUTPUT_DIR }) {
  const adapterSkillFiles = globSync(toGlobPattern(path.join(packagesDir, '*/skills/adapter-*/SKILL.md')))
    .filter((file) => !ADAPTER_SOURCE_EXCLUDED_PACKAGES.has(path.basename(path.dirname(path.dirname(path.dirname(file))))))
    .sort();

  // Detect adapter directory-name collisions (TRD-020 P2 fix). Output is keyed purely by the
  // adapter directory's own basename (not the owning package), so two different packages
  // shipping e.g. `skills/adapter-cc/` would otherwise silently last-writer-wins into the same
  // `.codex/skills/adapter-cc/` with no warning -- directly contradicting the PRD's "fail
  // explicitly rather than falling back/silently losing data" posture. Fail loudly instead,
  // naming every colliding source path, before writing anything.
  const sourcesByAdapterName = new Map();
  for (const skillFile of adapterSkillFiles) {
    const adapterDir = path.dirname(skillFile);
    const adapterName = path.basename(adapterDir);
    const sources = sourcesByAdapterName.get(adapterName) || [];
    sources.push(adapterDir);
    sourcesByAdapterName.set(adapterName, sources);
  }
  for (const [adapterName, sources] of sourcesByAdapterName) {
    if (sources.length <= 1) continue;
    throw new Error(
      `Adapter directory name collision: "${adapterName}" is shipped by multiple packages ` +
        `(${sources.join(', ')}); each adapter directory name must be unique across the ` +
        "monorepo because Codex output is keyed by the adapter directory's own name."
    );
  }

  let count = 0;
  for (const skillFile of adapterSkillFiles) {
    const adapterDir = path.dirname(skillFile);
    const adapterName = path.basename(adapterDir);
    const dest = path.join(outputDir, 'skills', adapterName, 'SKILL.md');
    const parsed = parseFrontmatter(readFile(skillFile));

    writeFile(dest, `${yamlFrontmatter(skillFrontmatter(parsed, adapterName))}\n${normalizeSkillBody(parsed.content)}\n`, dryRun, verbose);
    count += 1;

    const adapterYaml = path.join(adapterDir, 'adapter.yaml');
    if (fs.existsSync(adapterYaml)) {
      copyFile(adapterYaml, path.join(outputDir, 'skills', adapterName, 'adapter.yaml'), dryRun, verbose);
    }
  }

  return count;
}

/**
 * Vendor the toolchain-cli.js runtime (TRD-020, PRD REQ-021) into
 * `.codex/skills/vendor/`, so a standalone copy of `.codex/` (no monorepo checkout) can run
 * `node .codex/skills/vendor/lib/toolchain-cli.js resolve --json` after its own `npm install`.
 * See scripts/lib/toolchain-vendor.js for the exact file set and the relative-layout
 * constraint that dictates this placement.
 */
function vendorCodexToolchain({ dryRun, verbose, outputDir = OUTPUT_DIR }) {
  const vendorRoot = path.join(outputDir, 'skills', 'vendor');
  const { files } = vendorToolchainLibrary({
    sourceRoot: ROOT,
    vendorRoot,
    packageName: '@sunstone-partners/ensemble-codex-toolchain-vendor',
    dryRun,
    verbose,
  });
  return files.length;
}

/**
 * Generate the "## Subcommands" section for a Codex dispatcher command,
 * mirroring Claude Code's `generateSubcommandsSection` (scripts/lib/command-transformer.js)
 * section order and content pattern, but pointing at each sibling's Codex
 * SKILL.md output path instead of its Claude Code .md path.
 * @param {Array<{keyword: string, ref: string, description?: string}>} subcommands
 * @param {Map<string, string>} baseNameToYamlFile - bare command name -> its source YAML path
 * @param {string} sourceYamlPath - the dispatcher's own YAML path, for error messages
 * @param {object} [overrides]
 * @param {string} [overrides.outputDir] - defaults to OUTPUT_DIR; overridden by tests so the
 *   sibling skill's SKILL.md path is computed inside an isolated temp tree instead of the real
 *   repo's `.codex/` output.
 * @param {string} [overrides.rootDir] - defaults to ROOT; must be the ancestor `outputDir` sits
 *   under so the rendered path (e.g. `packages/codex/.codex/skills/commands/...`) stays
 *   structurally correct even when both are overridden to a temp root.
 * @param {Map<string, string>} [overrides.skillNameByRef] - bare command name -> the skill its Codex
 *   output carries, for the skill-backed commands, whose skill need not be named `ensemble-<command>`;
 *   a ref missing from it is named `ensemble-<ref>`.
 * @returns {string}
 */
function generateCodexSubcommandsSection(subcommands, baseNameToYamlFile, sourceYamlPath, { outputDir = OUTPUT_DIR, rootDir = ROOT, skillNameByRef = new Map() } = {}) {
  const repoRoot = rootDir;
  const lines = ['## Subcommands', ''];

  for (const sub of subcommands) {
    if (!baseNameToYamlFile.has(sub.ref)) {
      throw new Error(`dispatch.subcommands references unknown command '${sub.ref}' (${sourceYamlPath})`);
    }
    const codexSkillName = skillNameByRef.get(sub.ref) ?? `ensemble-${sub.ref}`;
    const outputPath = path.join(outputDir, 'skills', 'commands', codexSkillName, 'SKILL.md');
    const relPath = path.relative(repoRoot, outputPath);
    const description = sub.description ? sub.description.trim().replace(/\s+/g, ' ') : '';
    const descPrefix = description ? `${description}. ` : '';
    lines.push(`- **\`${sub.keyword}\`** - ${descPrefix}see the \`${codexSkillName}\` skill (\`${relPath}\`).`);
  }

  lines.push('');
  return lines.join('\n');
}

/** The subdirectory of a skill that holds its extra documents (the Agent Skills layout). */
const SKILL_REFERENCES_DIR = 'references';

/**
 * Every file below `dir`, as `/`-separated paths relative to it, in name order. A symlink is followed
 * (a link to a file ships as that file; a link to nowhere throws). A name that starts with a dot
 * (`.DS_Store` and the like) is skipped, as the Pi skill copier skips it: such a file is one machine's
 * leftover, and committed output must not differ from one machine to the next.
 */
function filesBelow(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const entry = path.join(dir, name);
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const rel of filesBelow(entry)) files.push(`${name}/${rel}`);
    } else if (stat.isFile()) {
      files.push(name);
    }
  }
  return files;
}

/**
 * The files of a skill's `references/` directory (none when it has none), relative to that directory.
 * It is the one thing that ships beside a command skill's SKILL.md, because the SKILL.md names those
 * files by paths relative to itself. The skill's other files (scripts, notes, a README) are authoring
 * material that the lean Codex bundle leaves out.
 */
function skillReferenceFiles(skillDir) {
  const referencesDir = path.join(skillDir, SKILL_REFERENCES_DIR);
  return fs.existsSync(referencesDir) && fs.statSync(referencesDir).isDirectory() ? filesBelow(referencesDir) : [];
}

/** Where a skill keeps its Codex-only machine config (Codex skill-creator layout), relative to the skill. */
const OPENAI_YAML_PATH = path.join('agents', 'openai.yaml');

/**
 * Codex does not read `disable-model-invocation`; it reads `agents/openai.yaml`. This is that file for
 * a skill that must not be injected into the model context by default (still invocable as `$skill`).
 * Strings would be quoted and keys are not, per the Codex reference; this has neither.
 */
const OPENAI_YAML_NO_IMPLICIT = 'policy:\n  allow_implicit_invocation: false\n';

/**
 * Write `agents/openai.yaml` beside a shipped command skill when its source SKILL.md frontmatter has
 * `disable-model-invocation: true`; otherwise remove one a previous run left, so dropping the key in
 * the source drops the file on regeneration. The `agents/` directory goes with it when that empties it.
 */
function syncOpenAiPolicy(skillFile, destDir, dryRun, verbose) {
  const destFile = path.join(destDir, OPENAI_YAML_PATH);
  const { data } = parseFrontmatter(readFile(skillFile));
  if (data['disable-model-invocation'] === true) {
    writeFile(destFile, OPENAI_YAML_NO_IMPLICIT, dryRun, verbose);
    return;
  }
  if (dryRun) return;
  fs.rmSync(destFile, { force: true });
  const agentsDir = path.dirname(destFile);
  if (fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length === 0) fs.rmdirSync(agentsDir);
}

/**
 * Write one Codex skill per command, `<outputDir>/skills/commands/<skill>/SKILL.md`, and return how
 * many skills that is (distinct skill directories, not the files in them nor the commands).
 *
 * An ordinary command gets a wrapper skill, `ensemble-<command>`, rendered from its prompt. A
 * skill-backed command (its YAML is a manifest with a top-level `skill`, see
 * scripts/lib/skill-backed-command.js) gets no wrapper: the skill it names is the command's one skill
 * and is copied verbatim, frontmatter and body, so the bundle carries the single source of truth and
 * not a rendering of it. The `references/` directory of that skill ships with it, every file below it
 * at the same relative path and byte for byte, so the paths its SKILL.md names stay valid; no other
 * file beside the SKILL.md does. Claude's generated command .md, which is only a stub pointing at that
 * skill, is never read for it, and `user-invocable` is not injected: the skill declares its own
 * frontmatter.
 *
 * Two commands may not claim one output file from different sources (a skill-backed command whose
 * skill is named like another command's wrapper); that throws instead of the last writer winning, and
 * so does a manifest whose skill does not exist, before anything is written.
 */
function generateCommandSkills({ dryRun, verbose, packagesDir = PACKAGES_DIR, outputDir = OUTPUT_DIR, rootDir = ROOT }) {
  const commandYamlFiles = globSync(toGlobPattern(path.join(packagesDir, '*/commands/*.yaml'))).sort();
  // Resolves each dispatch.subcommands[].ref to its sibling's own YAML path,
  // so we can validate the ref and derive that sibling's Codex output path.
  const baseNameToYamlFile = new Map(commandYamlFiles.map((f) => [path.basename(f, '.yaml'), f]));

  // Every command's raw YAML, read once: whether a command is skill-backed decides which skill a
  // dispatcher that refers to it must name, before that command's own turn comes.
  const yamlByFile = new Map(commandYamlFiles.map((f) => [f, yaml.load(normalizeLineEndings(readFile(f))) || {}]));
  const skillFileByYaml = new Map(); // a skill-backed command's YAML -> the SKILL.md it ships
  const skillNameByRef = new Map(); // its bare command name -> that skill's name
  for (const yamlFile of commandYamlFiles) {
    const manifest = yamlByFile.get(yamlFile);
    if (!isSkillBacked(manifest)) continue;
    try {
      skillFileByYaml.set(yamlFile, resolveSkillFile(yamlFile, manifest.skill));
    } catch (err) {
      throw new Error(`${path.relative(rootDir, yamlFile)}: ${err.message}`, { cause: err });
    }
    skillNameByRef.set(path.basename(yamlFile, '.yaml'), manifest.skill);
  }

  const claimed = new Map(); // every output file -> the file its content comes from
  const claim = (dest, from) => {
    const other = claimed.get(dest);
    if (other !== undefined && other !== from) {
      throw new Error(
        `Codex command skill collision: ${path.relative(rootDir, dest)} would come from both ` +
          `${path.relative(rootDir, other)} and ${path.relative(rootDir, from)}`
      );
    }
    claimed.set(dest, from);
  };
  const skillFiles = new Set(); // the output SKILL.md files, one per skill: what the return value counts
  const claimSkill = (dest, from) => {
    claim(dest, from);
    skillFiles.add(dest);
  };
  const shippedSkills = new Set(); // the SKILL.md files already copied: two manifests naming one skill ship it once

  for (const yamlFile of commandYamlFiles) {
    const skillFile = skillFileByYaml.get(yamlFile);
    if (skillFile !== undefined) {
      if (shippedSkills.has(skillFile)) continue;
      shippedSkills.add(skillFile);
      const sourceDir = path.dirname(skillFile);
      const destDir = path.join(outputDir, 'skills', 'commands', yamlByFile.get(yamlFile).skill);
      claimSkill(path.join(destDir, 'SKILL.md'), skillFile);
      copyFile(skillFile, path.join(destDir, 'SKILL.md'), dryRun, verbose);
      for (const rel of skillReferenceFiles(sourceDir)) {
        const from = path.join(sourceDir, SKILL_REFERENCES_DIR, ...rel.split('/'));
        const dest = path.join(destDir, SKILL_REFERENCES_DIR, ...rel.split('/'));
        claim(dest, from);
        copyFile(from, dest, dryRun, verbose);
      }
      syncOpenAiPolicy(skillFile, destDir, dryRun, verbose);
      continue;
    }

    const packageDir = path.dirname(path.dirname(yamlFile));
    const baseName = path.basename(yamlFile, '.yaml');
    const markdownPath = path.join(packageDir, 'commands', 'ensemble', `${baseName}.md`);
    const raw = fs.existsSync(markdownPath) ? readFile(markdownPath) : readFile(yamlFile);
    const { data, content } = parseFrontmatter(raw);
    const codexSkillName = `ensemble-${baseName}`;
    const dest = path.join(outputDir, 'skills', 'commands', codexSkillName, 'SKILL.md');
    claimSkill(dest, yamlFile);
    const description = data.description || `Run Ensemble command /ensemble:${baseName}`;
    const commandName = data.name || `ensemble:${baseName}`;

    // Whichever prose source we prefer above (Claude's generated .md
    // frontmatter-only fields, or the raw YAML) never carries `dispatch` in
    // its frontmatter -- Claude's frontmatter is name/description/version/
    // category/last-updated/allowed-tools/argument-hint/model only, so a
    // dispatcher's subcommand table is invisible unless we additionally read
    // the raw YAML directly (yamlData, parsed above).
    const yamlData = yamlByFile.get(yamlFile);
    const subcommandsSection = yamlData.dispatch?.subcommands
      ? generateCodexSubcommandsSection(yamlData.dispatch.subcommands, baseNameToYamlFile, yamlFile, { outputDir, rootDir, skillNameByRef })
      : null;

    // When `content` is mirrored from Claude's already-generated .md, a
    // dispatcher command's body already embeds Claude's OWN "## Subcommands"
    // section (pointing at Claude Code .md paths, not Codex SKILL.md paths).
    // Strip it so we splice in exactly one, Codex-correct version below,
    // instead of rendering both.
    const mirroredContent = subcommandsSection
      ? content.replace(/## Subcommands\n\n[\s\S]*?\n\n(?=## |$)/, '')
      : content;

    // Capabilities (optional, TRD-022): length-gated like allowed-tools/argument-hint -- an
    // empty `capabilities: {required: [], optional: []}` declaration (schema default shape)
    // renders nothing, matching Claude's `capabilities-required`/`capabilities-optional`
    // frontmatter lines (scripts/lib/command-transformer.js), Pi's HTML comment
    // (packages/pi/src/transformers/command-transformer.ts#renderHeader), and OpenCode's
    // "## Capabilities" section (scripts/generate-opencode/src/command-translator.js) --
    // all three emit nothing for an empty declaration, never an empty object/list.
    const capabilities = yamlData.metadata?.capabilities;
    const hasCapabilities = Boolean(
      capabilities &&
        ((capabilities.required && capabilities.required.length > 0) ||
          (capabilities.optional && capabilities.optional.length > 0))
    );

    const frontmatter = {
      name: codexSkillName,
      description: `${description} (Codex skill for /${commandName})`,
      // Hidden commands keep their wrapper skill (dispatchers reference it by
      // path) but are not user-invocable. The YAML is authoritative; Claude's
      // generated .md carries the same flag and is accepted when the YAML is not.
      'user-invocable': !(yamlData.metadata?.visibility === 'hidden' || data['user-invocable'] === false),
      ...(data['argument-hint'] ? { 'argument-hint': data['argument-hint'] } : {}),
      ...(data.model ? { model: ANTHROPIC_ALIASES.has(data.model) ? DEFAULT_MODEL : data.model } : {}),
      ...(hasCapabilities ? { capabilities } : {}),
    };

    const body = [
      `# Ensemble Command: /${commandName}`,
      '',
      `This Codex skill mirrors the Ensemble slash command \`/${commandName}\`.`,
      'Follow the workflow below, adapt to the current repository, and keep outputs structured.',
      '',
      ...(subcommandsSection ? [subcommandsSection] : []),
      normalizeSkillBody(mirroredContent),
      '',
    ].join('\n');

    writeFile(dest, `${yamlFrontmatter(frontmatter)}\n${body}`, dryRun, verbose);
  }

  return skillFiles.size;
}

/** The Codex sandbox an agent's file declares: read-only for READ_ONLY_AGENTS, workspace-write otherwise. */
function sandboxModeFor(agentName) {
  return READ_ONLY_AGENTS.has(agentName) ? 'read-only' : 'workspace-write';
}

function generateAgents({ dryRun, verbose }) {
  const agentYamlFiles = globSync(toGlobPattern(path.join(PACKAGES_DIR, '*/agents/*.yaml'))).sort();
  const agents = [];

  for (const yamlFile of agentYamlFiles) {
    const packageDir = path.dirname(path.dirname(yamlFile));
    const baseName = path.basename(yamlFile, '.yaml');
    const markdownPath = path.join(packageDir, 'agents', `${baseName}.md`);
    const raw = fs.existsSync(markdownPath) ? readFile(markdownPath) : readFile(yamlFile);
    const { data, content } = parseFrontmatter(raw);
    const name = data.name || baseName;
    const description = data.description || `${name} specialist`;
    const model = !data.model || ANTHROPIC_ALIASES.has(data.model) ? DEFAULT_MODEL : data.model;
    const dest = path.join(OUTPUT_DIR, 'agents', `${name}.toml`);
    const normalizedContent = normalizeSkillBody(content);
    const skills = detectAgentSkills(name, normalizedContent);
    const developerInstructions = [
      `You are the Ensemble agent \`${name}\` running inside Codex CLI.`,
      'Prefer concise progress updates, use repo-local skills under `.codex/skills/` when relevant, and keep changes verifiable.',
      '',
      normalizedContent,
    ].join('\n');

    const toml = [
      `name = ${tomlString(name)}`,
      `description = ${tomlString(description)}`,
      `model = ${tomlString(model)}`,
      `sandbox_mode = ${tomlString(sandboxModeFor(name))}`,
      'model_reasoning_effort = "medium"',
      ...(skills.length > 0 ? [`skills = [${skills.map((skill) => tomlString(skill)).join(', ')}]`] : []),
      '',
      `developer_instructions = ${tomlMultiline(developerInstructions)}`,
      '',
    ].join('\n');

    writeFile(dest, toml, dryRun, verbose);
    agents.push({ name, description });
  }

  const configLines = [
    '# Generated by scripts/generate-codex/index.js',
    `model = ${tomlString(DEFAULT_MODEL)}`,
    'model_reasoning_effort = "medium"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    '',
    '[agents]',
    'max_threads = 6',
    'max_depth = 1',
    '',
  ];

  for (const agent of agents) {
    configLines.push(`[agents.${JSON.stringify(agent.name)}]`);
    configLines.push(`description = ${tomlString(agent.description)}`);
    configLines.push(`config_file = ${tomlString(`agents/${agent.name}.toml`)}`);
    configLines.push('');
  }

  writeFile(path.join(OUTPUT_DIR, 'config.toml'), `${configLines.join('\n').trim()}\n`, dryRun, verbose);

  return agents.length;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { dryRun, verbose } = options;

  resetOutput(dryRun);
  ensureDir(path.join(OUTPUT_DIR, 'agents'), dryRun);
  ensureDir(path.join(OUTPUT_DIR, 'skills'), dryRun);

  const skillCount = copyFrameworkSkills(options) + copyAdapterSkills(options);
  vendorCodexToolchain(options);
  const commandCount = generateCommandSkills(options);
  const agentCount = generateAgents(options);
  const agentsMd = buildCodexAgentsMd(commandCount, agentCount, skillCount);
  writeFile(AGENTS_OUTPUT, agentsMd, dryRun, verbose);

  process.stdout.write(
    `Generated Codex artifacts: ${agentCount} agents, ${commandCount} command skills, ${skillCount} framework/workflow skills${dryRun ? ' (dry-run)' : ''}.\n`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  parseFrontmatter,
  buildCodexAgentsMd,
  detectAgentSkills,
  normalizeSkillBody,
  normalizeLineEndings,
  generateCodexSubcommandsSection,
  generateCommandSkills,
  sandboxModeFor,
  copyAdapterSkills,
  vendorCodexToolchain,
};
