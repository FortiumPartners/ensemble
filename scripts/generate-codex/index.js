#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { globSync } = require('glob');

const ROOT = path.resolve(__dirname, '..', '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const CODEX_PACKAGE_DIR = path.join(PACKAGES_DIR, 'codex');
const OUTPUT_DIR = path.join(CODEX_PACKAGE_DIR, '.codex');
const AGENTS_OUTPUT = path.join(CODEX_PACKAGE_DIR, 'AGENTS.md');
const DEFAULT_MODEL = 'gpt-5.1-codex';
// Codex targets OpenAI models, so any Anthropic-family tier alias coming from
// the source frontmatter (opus/sonnet/haiku) maps to the OpenAI DEFAULT_MODEL.
const ANTHROPIC_ALIASES = new Set(['opus', 'sonnet', 'haiku']);
const AVAILABLE_SKILLS = new Set(['react', 'nestjs', 'rails', 'phoenix', 'blazor', 'jest', 'pytest', 'rspec', 'xunit', 'exunit', 'reqnroll']);
const FRAMEWORK_SKILL_REWRITES = [
  [/skills\/nestjs-framework\//g, '.codex/skills/nestjs/'],
  [/skills\/phoenix-framework\//g, '.codex/skills/phoenix/'],
  [/skills\/rails-framework\//g, '.codex/skills/rails/'],
  [/skills\/dotnet-framework\//g, '.codex/skills/blazor/dotnet-framework/'],
  [/skills\/react-framework\//g, '.codex/skills/react/'],
  [/skills\/jest-framework\//g, '.codex/skills/jest/'],
  [/skills\/pytest-framework\//g, '.codex/skills/pytest/'],
  [/skills\/rspec-framework\//g, '.codex/skills/rspec/'],
  [/skills\/xunit-framework\//g, '.codex/skills/xunit/'],
  [/skills\/exunit-framework\//g, '.codex/skills/exunit/'],
  [/skills\/\{framework\}\//g, '.codex/skills/<framework>/'],
];

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
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { data: {}, content: markdown };
  }

  let data;
  try {
    data = yaml.load(match[1]) || {};
  } catch (_err) {
    data = parseSimpleFrontmatter(match[1]);
  }

  const content = markdown.slice(match[0].length);
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
  const normalized = String(value).replace(/\r\n/g, '\n').replace(/"""/g, '\\\"\\\"\\\"');
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
    '- Infra/release: `infrastructure-developer`, `build-orchestrator`, `deployment-orchestrator`, `release-agent`',
    '- Research/general tasks: `general-purpose`, `context-fetcher`',
    '',
    '## Key Skills',
    '',
    '- Frameworks: `react`, `nestjs`, `rails`, `phoenix`, `blazor`',
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
  if (contentMentions(['blazor', '.net', 'dotnet', 'asp.net'])) skills.add('blazor');
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
    ['nestjs', 'rails', 'phoenix', 'blazor'].forEach((skill) => skills.add(skill));
  }

  return Array.from(skills).filter((skill) => AVAILABLE_SKILLS.has(skill)).sort();
}

function copyFrameworkSkills({ dryRun, verbose }) {
  const skillFiles = globSync(path.join(PACKAGES_DIR, '*/skills/SKILL.md')).sort();
  let count = 0;

  for (const skillFile of skillFiles) {
    const packageName = path.basename(path.dirname(path.dirname(skillFile)));
    const dest = path.join(OUTPUT_DIR, 'skills', packageName, 'SKILL.md');
    const raw = readFile(skillFile);
    const parsed = parseFrontmatter(raw);
    const frontmatter = Object.keys(parsed.data).length > 0
      ? { ...parsed.data, 'user-invocable': parsed.data['user-invocable'] ?? true }
      : {
          name: packageName,
          description: firstMeaningfulLine(parsed.content),
          'user-invocable': true,
        };

    writeFile(dest, `${yamlFrontmatter(frontmatter)}\n${normalizeSkillBody(parsed.content)}\n`, dryRun, verbose);
    count += 1;
  }


  const reqnrollSkillFile = path.join(PACKAGES_DIR, 'reqnroll', 'skills', 'reqnroll', 'SKILL.md');
  if (fs.existsSync(reqnrollSkillFile)) {
    const packageName = 'reqnroll';
    const dest = path.join(OUTPUT_DIR, 'skills', packageName, 'SKILL.md');
    const raw = readFile(reqnrollSkillFile);
    const parsed = parseFrontmatter(raw);
    const frontmatter = Object.keys(parsed.data).length > 0
      ? { ...parsed.data, 'user-invocable': parsed.data['user-invocable'] ?? true }
      : {
          name: packageName,
          description: firstMeaningfulLine(parsed.content),
          'user-invocable': true,
        };

    writeFile(dest, `${yamlFrontmatter(frontmatter)}\n${normalizeSkillBody(parsed.content)}\n`, dryRun, verbose);

    const referencePath = path.join(PACKAGES_DIR, 'reqnroll', 'skills', 'reqnroll', 'REFERENCE.md');
    if (fs.existsSync(referencePath)) {
      writeFile(path.join(OUTPUT_DIR, 'skills', packageName, 'REFERENCE.md'), `${normalizeSkillBody(readFile(referencePath))}\n`, dryRun, verbose);
    }
    count += 1;
  }
  return count;
}

function generateCommandSkills({ dryRun, verbose }) {
  const commandYamlFiles = globSync(path.join(PACKAGES_DIR, '*/commands/*.yaml')).sort();
  let count = 0;

  for (const yamlFile of commandYamlFiles) {
    const packageDir = path.dirname(path.dirname(yamlFile));
    const baseName = path.basename(yamlFile, '.yaml');
    const markdownPath = path.join(packageDir, 'commands', 'ensemble', `${baseName}.md`);
    const raw = fs.existsSync(markdownPath) ? readFile(markdownPath) : readFile(yamlFile);
    const { data, content } = parseFrontmatter(raw);
    const codexSkillName = `ensemble-${baseName}`;
    const dest = path.join(OUTPUT_DIR, 'skills', 'commands', codexSkillName, 'SKILL.md');
    const description = data.description || `Run Ensemble command /ensemble:${baseName}`;
    const commandName = data.name || `ensemble:${baseName}`;

    const frontmatter = {
      name: codexSkillName,
      description: `${description} (Codex skill for /${commandName})`,
      'user-invocable': true,
      ...(data['argument-hint'] ? { 'argument-hint': data['argument-hint'] } : {}),
      ...(data.model ? { model: ANTHROPIC_ALIASES.has(data.model) ? DEFAULT_MODEL : data.model } : {}),
    };

    const body = [
      `# Ensemble Command: /${commandName}`,
      '',
      `This Codex skill mirrors the Ensemble slash command \`/${commandName}\`.`,
      'Follow the workflow below, adapt to the current repository, and keep outputs structured.',
      '',
      normalizeSkillBody(content),
      '',
    ].join('\n');

    writeFile(dest, `${yamlFrontmatter(frontmatter)}\n${body}`, dryRun, verbose);
    count += 1;
  }

  return count;
}

function generateAgents({ dryRun, verbose }) {
  const agentYamlFiles = globSync(path.join(PACKAGES_DIR, '*/agents/*.yaml')).sort();
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
      'sandbox_mode = "workspace-write"',
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

  const skillCount = copyFrameworkSkills(options);
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
};
