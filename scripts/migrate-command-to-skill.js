#!/usr/bin/env node
/**
 * Migrate a full command YAML to a skill-backed command (see scripts/lib/skill-backed-command.js).
 *
 *   node scripts/migrate-command-to-skill.js <packages/pkg/commands/cmd.yaml> [--name ensemble-cmd]
 *       dry run (default): print the summary, write nothing
 *   ... --write
 *       write packages/pkg/skills/<name>/SKILL.md and shrink the YAML to a manifest
 *   ... --check-parity [--base <git-ref>]
 *       prove every sentence / list item of every pre-migration render (read with
 *       `git show <ref>:<path>`, default HEAD) is present in the skill (SKILL.md + references/)
 *
 * The skill body is the UNION of what the runtimes render today:
 *   - Claude  (scripts/lib/command-transformer.js): mission, arguments, workflow incl. delegation,
 *     MCP tool and expected output -- but NOT constraints
 *   - Pi      (packages/pi/src/transformers/command-transformer.ts renderPromptBody): mission,
 *     constraints, arguments, workflow. It is TypeScript with no compiled output in the tree, so its
 *     section rendering is mirrored here (renderPiBody); keep the two in step.
 *   - OpenCode (scripts/generate-opencode/src/command-translator.js): mission, constraints,
 *     capabilities, arguments, workflow incl. phase descriptions and delegation, expected output
 * Claude and OpenCode are rendered by the real generators, so a change to them changes the parity check.
 * Dispatch `subcommands` are rendered from the YAML by this script (the real renderers need the
 * whole package's command map) and checked by keyword, ref and description.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const { isSkillBacked, isValidSkillName, readSkillProse } = require('./lib/skill-backed-command');
const { transformCommandToMarkdown } = require('./lib/command-transformer');
const { CommandTranslator } = require('./generate-opencode/src/command-translator');

const TOKEN_WARN = 5000;
const LINE_WARN = 500;
const ARGS_SENTINEL = '__MIGRATE_ARGS_SENTINEL__';

/** Top-level keys the three renders know about; every other non-metadata/skill key is carried into SKILL.md as a section. */
const PROMPT_KEYS = ['mission', 'constraints', 'parameters', 'dispatch', 'workflow', 'expectedOutput'];

/** Top-level keys no runtime renders and the manifest cannot hold, in YAML order. */
function carriedKeys(parsed) {
  return Object.keys(parsed).filter((k) => k !== 'metadata' && k !== 'skill' && !PROMPT_KEYS.includes(k));
}

function titleFromKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isContainer(v) {
  return v !== null && typeof v === 'object';
}

function nestingDepth(v) {
  if (!isContainer(v)) return 0;
  const kids = Array.isArray(v) ? v : Object.values(v);
  return 1 + kids.reduce((m, c) => Math.max(m, nestingDepth(c)), 0);
}

function scalarText(v) {
  return v === null ? 'null' : String(v).trim();
}

/** Multi-line scalar: continuation lines indented so they stay inside their bullet. */
function scalarLines(text, indent) {
  return scalarText(text).split('\n').map((l, i) => (i === 0 ? l : `${indent}${l.trim()}`));
}

function renderCarriedLines(value, indent) {
  const lines = [];
  const pad = ' '.repeat(indent);
  const entries = Array.isArray(value) ? value.map((v) => [null, v]) : Object.entries(value);
  for (const [k, v] of entries) {
    const label = k === null ? '' : `**${k}**:`;
    if (!isContainer(v)) {
      const [first, ...rest] = scalarLines(v, `${pad}  `);
      lines.push(`${pad}- ${label}${label ? ' ' : ''}${first}`, ...rest);
    } else if (k === null && !Array.isArray(v)) {
      // list item that is a map: first entry inline, remaining entries nested under the same bullet
      const sub = renderCarriedLines(v, indent + 2);
      lines.push(`${pad}- ${sub[0].trimStart().replace(/^- /, '')}`, ...sub.slice(1));
    } else {
      lines.push(`${pad}- ${label}`.trimEnd(), ...renderCarriedLines(v, indent + 2));
    }
  }
  return lines;
}

/** One `## <Title>` section for a carried top-level key. Deeply nested values (>2 levels) become a fenced yaml block. */
function renderCarriedSection(key, value) {
  const out = [`## ${titleFromKey(key)}`, ''];
  if (!isContainer(value)) {
    out.push(...scalarText(value).split('\n').map((l) => l.trimEnd()), '');
  } else if (nestingDepth(value) > 2) {
    out.push('```yaml', yaml.dump(value, { lineWidth: -1, noRefs: true }).trimEnd(), '```', '');
  } else {
    out.push(...renderCarriedLines(value, 0), '');
  }
  return out;
}

/** String scalar leaves and key names of a value: every one must survive into the skill. */
function carriedTokens(value, acc = []) {
  if (typeof value === 'string') {
    if (value.trim()) acc.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => carriedTokens(v, acc));
  } else if (isContainer(value)) {
    for (const [k, v] of Object.entries(value)) {
      acc.push(String(k));
      carriedTokens(v, acc);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function parseCommandText(text, label) {
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== 'object' || !parsed.metadata) {
    throw new Error(`${label} is not a command YAML (no metadata block)`);
  }
  return parsed;
}

function loadCommand(yamlPath) {
  const text = fs.readFileSync(yamlPath, 'utf8');
  const parsed = parseCommandText(text, yamlPath);
  if (isSkillBacked(parsed)) {
    throw new Error(`${yamlPath} is already a skill-backed manifest (skill: ${parsed.skill}); nothing to migrate`);
  }
  return { text, parsed };
}

/** `ensemble:refine-prd` -> `ensemble-refine-prd`; `foo` -> `ensemble-foo`. */
function deriveSkillName(parsed, yamlPath) {
  const raw = String(parsed.metadata.name || path.basename(yamlPath, '.yaml'));
  const bare = raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
  return bare.startsWith('ensemble-') ? bare : `ensemble-${bare}`;
}

function skillDirFor(yamlPath, name) {
  return path.join(path.resolve(path.dirname(yamlPath), '..'), 'skills', name);
}

// ---------------------------------------------------------------------------
// Rendering helpers shared by the skill body and the Pi mirror
// ---------------------------------------------------------------------------

function sortedByOrder(list) {
  return [...list].sort((a, b) => a.order - b.order);
}

function actionToString(action) {
  if (typeof action === 'string') return action.trim();
  if (action != null && typeof action === 'object') {
    const entries = Object.entries(action);
    if (entries.length === 1) return `${entries[0][0]}: ${entries[0][1]}`;
    return JSON.stringify(action);
  }
  return String(action);
}

function renderArguments(parameters) {
  const lines = ['## Arguments', ''];
  for (const param of parameters) {
    let tag = `${param.type || 'string'}, ${param.required ? 'required' : 'optional'}`;
    if (param.default !== undefined) tag += `, default: \`${JSON.stringify(param.default)}\``;
    let line = `- **\`${param.name}\`** (${tag})`;
    if (param.description) line += `: ${param.description.trim().replace(/\s+/g, ' ')}`;
    lines.push(line);
  }
  lines.push('');
  return lines.join('\n');
}

function renderCapabilities(capabilities) {
  const req = capabilities && capabilities.required;
  const opt = capabilities && capabilities.optional;
  if (!(req && req.length) && !(opt && opt.length)) return [];
  const lines = ['## Capabilities', ''];
  if (req && req.length) lines.push(`**Required:** ${req.join(', ')}`);
  if (opt && opt.length) lines.push(`**Optional:** ${opt.join(', ')}`);
  lines.push('');
  return lines;
}

/**
 * The routing table of a dispatcher. Every target of the six dispatchers lives in the dispatcher's
 * own package, so a sibling path (`../ensemble-<ref>/SKILL.md`, relative to this skill's directory)
 * resolves in every runtime. Hidden targets cannot be invoked as commands, so the read-and-follow
 * path is the only way to reach them and must always be present.
 */
function renderSubcommands(subcommands) {
  const lines = ['## Subcommands', ''];
  for (const sub of subcommands) {
    const desc = sub.description ? `${sub.description.trim().replace(/\s+/g, ' ')}. ` : '';
    lines.push(
      `- **\`${sub.keyword}\`** - ${desc}Invoke \`/ensemble:${sub.ref}\` directly, or read and follow ` +
        `\`../ensemble-${sub.ref}/SKILL.md\` (relative to this skill's directory), ` +
        'passing the remaining arguments through as its $ARGUMENTS.'
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Mirror of the Pi renderPromptBody sections (mission, constraints, arguments, phases). */
function renderPiBody(parsed) {
  const out = [];
  if (parsed.mission && parsed.mission.summary) {
    const collapsed = parsed.mission.summary.trim().split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
    out.push(`> **Mission:** ${collapsed}`, '');
  }
  if (parsed.constraints && parsed.constraints.length > 0) {
    out.push('> **Constraints:**');
    for (const c of parsed.constraints) out.push(`> - ${String(c).trim()}`);
    out.push('');
  }
  if (parsed.parameters && parsed.parameters.length > 0) out.push(renderArguments(parsed.parameters));
  const phases = (parsed.workflow && parsed.workflow.phases) || [];
  phases.forEach((phase, i) => {
    out.push(`## Phase ${i + 1}: ${phase.name}`);
    (phase.steps || []).forEach((step, j) => {
      out.push('', `### Step ${j + 1}: ${step.title}`);
      if (step.description && step.description.trim()) out.push('', step.description.trim());
      if (step.actions && step.actions.length > 0) {
        out.push('', '**Actions:**', '');
        step.actions.forEach((a, k) => out.push(`${k + 1}. ${actionToString(a)}`));
      }
    });
    out.push('');
  });
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Skill body: the union of the three renders
// ---------------------------------------------------------------------------

function renderSkillBody(parsed) {
  const out = [];
  if (parsed.mission && parsed.mission.summary) out.push(parsed.mission.summary.trim(), '');

  if (Array.isArray(parsed.constraints) && parsed.constraints.length > 0) {
    out.push('## Constraints', '');
    for (const c of parsed.constraints) out.push(`- ${String(c).trim()}`);
    out.push('');
  }

  out.push(...renderCapabilities(parsed.metadata && parsed.metadata.capabilities));

  if (Array.isArray(parsed.parameters) && parsed.parameters.length > 0) {
    out.push(renderArguments(parsed.parameters));
  }
  if (parsed.dispatch && Array.isArray(parsed.dispatch.subcommands) && parsed.dispatch.subcommands.length > 0) {
    out.push(renderSubcommands(parsed.dispatch.subcommands));
  }

  const phases = parsed.workflow && parsed.workflow.phases;
  if (phases && phases.length > 0) {
    out.push('## Workflow', '');
    for (const phase of sortedByOrder(phases)) {
      out.push(`### Phase ${phase.order}: ${phase.name}`, '');
      if (phase.description && phase.description.trim()) out.push(phase.description.trim(), '');
      for (const step of sortedByOrder(phase.steps || [])) {
        out.push(`#### Step ${phase.order}.${step.order}: ${step.title || `Step ${step.order}`}`, '');
        if (step.description && step.description.trim()) out.push(step.description.trim(), '');
        for (const action of step.actions || []) out.push(`- ${actionToString(action)}`);
        if (step.actions && step.actions.length > 0) out.push('');
        if (step.delegation && step.delegation.agent) {
          out.push(`**Delegation:** @${step.delegation.agent}`);
          if (step.delegation.context) out.push(step.delegation.context);
          out.push('');
        }
        const tool = step.mcp_tool;
        if (tool) {
          if (typeof tool === 'object') {
            if (tool.name) {
              out.push(`**MCP Tool:** \`${tool.name}\``);
              if (tool.usage) out.push(tool.usage.trim());
              if (tool.fallback) out.push(`**Fallback:** ${tool.fallback}`);
              out.push('');
            }
          } else {
            out.push(`**MCP Tool:** \`${tool}\``, '');
          }
        }
      }
    }
  }

  const eo = parsed.expectedOutput;
  if (eo) {
    out.push('## Expected Output', '');
    if (eo.format) out.push(`**Format:** ${eo.format}`, '');
    if (Array.isArray(eo.structure) && eo.structure.length > 0) {
      out.push('**Structure:**', '');
      for (const item of eo.structure) out.push(`- **${item.name}**: ${item.description || ''}`);
      out.push('');
    }
  }
  for (const key of carriedKeys(parsed)) out.push(...renderCarriedSection(key, parsed[key]));

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function buildSkillMd(parsed, name, body = renderSkillBody(parsed)) {
  const m = parsed.metadata;
  const fm = ['---', `name: ${name}`, `description: ${JSON.stringify(String(m.description))}`, 'disable-model-invocation: true'];
  const meta = [];
  if (m.version !== undefined) meta.push(`  version: ${JSON.stringify(String(m.version))}`);
  if (m.category !== undefined) meta.push(`  category: ${m.category}`);
  if (meta.length) fm.push('metadata:', ...meta);
  fm.push('---', '');
  return `${fm.join('\n')}\n${body}`;
}

/**
 * The manifest: the command's `metadata:` block copied verbatim from the source text (comments and
 * quoting survive, every field preserved exactly), then `skill:`. Verified by re-parsing.
 */
function buildManifest(sourceText, parsed, name, pkgName) {
  const lines = sourceText.split('\n');
  const start = lines.findIndex((l) => /^metadata:\s*$/.test(l));
  if (start === -1) throw new Error('could not find a top-level `metadata:` block in the YAML text');
  let end = start + 1;
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
  while (end > start + 1 && lines[end - 1] === '') end--;
  const block = lines.slice(start, end).join('\n');
  const manifest = [
    block,
    '',
    `# Skill-backed command: the prompt is packages/${pkgName}/skills/${name}/SKILL.md,`,
    '# the single source of truth. Edit the skill, not this manifest.',
    `skill: ${name}`,
    ''
  ].join('\n');

  const reparsed = yaml.load(manifest);
  if (JSON.stringify(reparsed.metadata) !== JSON.stringify(parsed.metadata)) {
    throw new Error('internal error: manifest metadata differs from the source command metadata');
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Plan / write
// ---------------------------------------------------------------------------

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function planMigration(yamlPath, options = {}) {
  const absYaml = path.resolve(yamlPath);
  const { text, parsed } = loadCommand(absYaml);
  const name = options.name || deriveSkillName(parsed, absYaml);
  if (!isValidSkillName(name)) throw new Error(`skill name ${JSON.stringify(name)} is not a valid skill directory name`);

  const pkgDir = path.resolve(path.dirname(absYaml), '..');
  const skillDir = skillDirFor(absYaml, name);
  const skillMd = buildSkillMd(parsed, name);
  const manifest = buildManifest(text, parsed, name, path.basename(pkgDir));

  const warnings = [];
  const lineCount = skillMd.split('\n').length - 1;
  const tokens = estimateTokens(skillMd);
  if (tokens > TOKEN_WARN || lineCount > LINE_WARN) {
    warnings.push(
      `SKILL.md is ~${tokens} tokens / ${lineCount} lines (limits ${TOKEN_WARN} tokens / ${LINE_WARN} lines): ` +
      'split phases into references/*.md (one level deep, named as backticked relative paths in SKILL.md)'
    );
  }
  const carried = carriedKeys(parsed);
  if (carried.length) {
    warnings.push(
      `top-level keys no runtime renders are carried into SKILL.md as sections: ${carried.join(', ')} ` +
      '(every runtime\'s model now sees this text; mention the behaviour change in the PR)'
    );
  }
  if (parsed.dispatch && Array.isArray(parsed.dispatch.subcommands)) {
    // The routing table points at `../ensemble-<ref>/SKILL.md`; that only resolves for a target skill
    // that sits beside this one, in the same package.
    const missing = parsed.dispatch.subcommands
      .map((sub) => sub.ref)
      .filter((ref, i, all) => all.indexOf(ref) === i)
      .filter((ref) => !fs.existsSync(path.join(pkgDir, 'skills', `ensemble-${ref}`, 'SKILL.md')));
    if (missing.length) {
      warnings.push(
        'dispatcher command: these targets have no sibling skill ' +
        `packages/${path.basename(pkgDir)}/skills/ensemble-<ref>/SKILL.md, so their read-and-follow path will not resolve: ${missing.join(', ')}`
      );
    }
  }

  return {
    yamlPath: absYaml,
    skillName: name,
    skillDir,
    skillFile: path.join(skillDir, 'SKILL.md'),
    skillMd,
    manifest,
    tokens,
    lineCount,
    warnings,
    collision: fs.existsSync(skillDir)
  };
}

function writeMigration(plan) {
  if (plan.collision) {
    throw new Error(`refusing to overwrite: ${plan.skillDir} already exists (pass --name to choose another skill name)`);
  }
  fs.mkdirSync(plan.skillDir, { recursive: true });
  fs.writeFileSync(plan.skillFile, plan.skillMd);
  try {
    const { validateCommandSchema } = require('./lib/schema-validator');
    validateCommandSchema(yaml.load(plan.manifest), plan.yamlPath);
  } catch (error) {
    fs.rmSync(plan.skillDir, { recursive: true, force: true });
    const detail = Array.isArray(error) ? error.map((e) => e.message || String(e)).join('; ') : error.message;
    throw new Error(`generated manifest fails the command schema, nothing written: ${detail}`, { cause: error });
  }
  fs.writeFileSync(plan.yamlPath, plan.manifest);
}

function formatSummary(plan) {
  const rel = (p) => path.relative(process.cwd(), p) || p;
  const lines = [
    `Migrate ${rel(plan.yamlPath)} -> skill '${plan.skillName}'`,
    'Would write:',
    `  ${rel(plan.skillFile)}  (${plan.lineCount} lines, ~${plan.tokens} tokens)`,
    `  ${rel(plan.yamlPath)}  (shrunk to metadata + skill, ${plan.manifest.split('\n').length - 1} lines)`
  ];
  if (plan.collision) lines.push(`ERROR: ${rel(plan.skillDir)} already exists; --write would refuse (use --name)`);
  for (const w of plan.warnings) lines.push(`WARNING: ${w}`);
  lines.push('Dry run: nothing written. Re-run with --write to apply.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

function withoutDispatch(parsed) {
  const clone = JSON.parse(JSON.stringify(parsed));
  delete clone.dispatch;
  return clone;
}

/** Real Claude render, minus frontmatter, generated header and the `## Usage` footer. */
function renderClaude(parsed, yamlPath) {
  let md = transformCommandToMarkdown(withoutDispatch(parsed), yamlPath);
  md = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  // The generated header is a few whole-line HTML comments (`<!-- ... -->`, each on one line).
  // Drop those lines by their delimiters instead of pattern-matching markup, which cannot be done
  // robustly with a regular expression. A comment needs at least `<!--` and `-->`: 7 characters.
  const isCommentLine = (line) => {
    const text = line.trim();
    return text.length >= 7 && text.startsWith('<!--') && text.endsWith('-->');
  };
  md = md
    .split('\n')
    .filter((line) => !isCommentLine(line))
    .join('\n');
  const usage = md.indexOf('\n## Usage');
  return usage === -1 ? md : md.slice(0, usage);
}

/** Real OpenCode render; `$ARGUMENTS` is shielded so its placeholder rewrite cannot change the text. */
function renderOpenCode(parsed) {
  const shielded = JSON.parse(JSON.stringify(withoutDispatch(parsed)).split('$ARGUMENTS').join(ARGS_SENTINEL));
  const translator = new CommandTranslator({ packagesDir: '', outputDir: '', dryRun: true });
  let md = translator.translateToMarkdown(shielded).split(ARGS_SENTINEL).join('$ARGUMENTS');
  const description = String(parsed.metadata.description || '').trim();
  // drop the `# Title` line and the description paragraph (metadata; it lives in the manifest)
  md = md.replace(/^# .*\n/, '');
  const at = description ? md.indexOf(description) : -1;
  if (at !== -1) md = md.slice(0, at) + md.slice(at + description.length);
  return md;
}

function stripMarkup(s) {
  return s.replace(/\*\*|`|\\/g, '').replace(/\s+/g, ' ').trim();
}

const LABEL_RE = /^(mission|delegation|agent|mcp tool|fallback|format):\s*/i;
const HEADING_NUMBER_RE = /^(phase|step) [\d.]+:\s*/i;
const BARE_LABELS = new Set([
  'constraints:', 'constraints', 'actions:', 'structure:', 'arguments', 'workflow', 'expected output',
  'capabilities', 'subcommands'
]);

/** Sentence-level units of a markdown render. */
function extractUnits(markdown) {
  const raw = [];
  let buffer = null;
  const flush = () => {
    if (buffer !== null) raw.push(buffer);
    buffer = null;
  };
  for (const line of markdown.split('\n')) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = /^\s*#+\s+(.*)$/.exec(line);
    const marker = /^\s*(?:>\s*)?(?:[-*]\s+|\d+\.\s+)(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (heading) {
      flush();
      raw.push(heading[1].replace(HEADING_NUMBER_RE, ''));
    } else if (marker) {
      flush();
      buffer = marker[1];
    } else if (quote) {
      flush();
      buffer = quote[1];
    } else if (buffer !== null) {
      buffer += ` ${line.trim()}`;
    } else {
      buffer = line.trim().replace(/^\*\*\d+(?:\.\d+)*\.?\s+/, '**');
    }
  }
  flush();

  const units = [];
  for (const u of raw) {
    let text = stripMarkup(u).replace(LABEL_RE, '');
    if (text.length < 2 || BARE_LABELS.has(text.toLowerCase())) continue;
    // OpenCode renders a non-string action as "[object Object]"; Claude and Pi render `key: value`
    if (/\[object object\]/i.test(text)) continue;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const s = sentence.trim();
      if (s.length >= 2) units.push(s);
    }
  }
  return units;
}

function renderUnits(parsed, yamlPath) {
  return {
    claude: extractUnits(renderClaude(parsed, yamlPath)),
    pi: extractUnits(renderPiBody(withoutDispatch(parsed))),
    opencode: extractUnits(renderOpenCode(parsed))
  };
}

function readBaseYaml(yamlPath, base) {
  const dir = path.dirname(path.resolve(yamlPath));
  try {
    return execFileSync('git', ['-C', dir, 'show', `${base}:./${path.basename(yamlPath)}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    throw new Error(`cannot read ${yamlPath} at ${base} via git show: ${String(error.stderr || error.message).trim()}`, {
      cause: error
    });
  }
}

/**
 * The non-markdown files directly inside a skill's `references/` directory (for example a data
 * file the skill's code reads, `team-configuration.yaml`), as one string. They are part of the
 * skill's content: moving a carried key's data out of SKILL.md and into such a file must not
 * read as losing it.
 * @param {string} skillDir
 * @returns {string}
 */
function readReferenceDataFiles(skillDir) {
  const dir = path.join(skillDir, 'references');
  if (!fs.existsSync(dir)) {
    return '';
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.endsWith('.md'))
    .map((entry) => fs.readFileSync(path.join(dir, entry.name), 'utf8'))
    .join('\n');
}

/**
 * Every sentence / list item of every pre-migration render must appear in the skill's prose
 * (SKILL.md plus references/*.md), whitespace- and markdown-emphasis-insensitive.
 * @param {string} oldYamlPath - The command YAML (its pre-migration text comes from git)
 * @param {string} skillDir - The skill directory (contains SKILL.md)
 * @param {{base?: string, oldYamlText?: string}} [options] - `base` git ref (default HEAD);
 *   `oldYamlText` bypasses git
 * @returns {{ok: boolean, checked: number, missing: {runtime: string, text: string}[]}}
 */
function checkMigrationParity(oldYamlPath, skillDir, options = {}) {
  const text = options.oldYamlText !== undefined ? options.oldYamlText : readBaseYaml(oldYamlPath, options.base || 'HEAD');
  const parsed = parseCommandText(text, `${oldYamlPath} at ${options.base || 'HEAD'}`);
  if (isSkillBacked(parsed)) {
    throw new Error(`${oldYamlPath} at ${options.base || 'HEAD'} is already a manifest; pass --base <ref before the migration>`);
  }
  const skillText = stripMarkup(`${readSkillProse(path.join(skillDir, 'SKILL.md'))}\n${readReferenceDataFiles(skillDir)}`);

  const missing = [];
  let checked = 0;
  const seen = new Set();
  const require_ = (runtime, unit) => {
    checked++;
    if (!skillText.includes(unit) && !seen.has(`${runtime}\0${unit}`)) {
      seen.add(`${runtime}\0${unit}`);
      missing.push({ runtime, text: unit });
    }
  };

  const units = renderUnits(parsed, oldYamlPath);
  for (const [runtime, list] of Object.entries(units)) list.forEach((u) => require_(runtime, u));

  const subs = (parsed.dispatch && parsed.dispatch.subcommands) || [];
  for (const sub of subs) {
    require_('dispatch', stripMarkup(String(sub.keyword)));
    require_('dispatch', `ensemble:${sub.ref}`);
    if (sub.description) extractUnits(sub.description.trim()).forEach((u) => require_('dispatch', u));
  }

  for (const key of carriedKeys(parsed)) {
    require_(`carried:${key}`, stripMarkup(titleFromKey(key)));
    for (const token of carriedTokens(parsed[key])) {
      const unit = stripMarkup(token);
      if (unit) require_(`carried:${key}`, unit);
    }
  }

  return { ok: missing.length === 0, checked, missing };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { write: false, checkParity: false, base: 'HEAD', name: undefined, file: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--check-parity') args.checkParity = true;
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else if (!args.file) args.file = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!args.file) throw new Error('usage: migrate-command-to-skill.js <command.yaml> [--write] [--name ensemble-<cmd>] [--check-parity [--base <ref>]]');
  if (args.base === undefined || (args.name === undefined && argv.includes('--name'))) throw new Error('missing option value');
  return args;
}

function main(argv, out = console) {
  const args = parseArgs(argv);
  if (args.checkParity) {
    const absYaml = path.resolve(args.file);
    const baseText = readBaseYaml(absYaml, args.base);
    const name = args.name || deriveSkillName(parseCommandText(baseText, absYaml), absYaml);
    const result = checkMigrationParity(absYaml, skillDirFor(absYaml, name), { base: args.base, oldYamlText: baseText });
    if (result.ok) {
      out.log(`parity OK: ${result.checked} units from the Claude, Pi and OpenCode renders at ${args.base} all present in skill '${name}'`);
      return 0;
    }
    out.error(`parity FAILED: ${result.missing.length} of ${result.checked} units missing from skill '${name}':`);
    result.missing.forEach((m) => out.error(`  [${m.runtime}] ${m.text}`));
    return 1;
  }

  const plan = planMigration(args.file, { name: args.name });
  if (!args.write) {
    out.log(formatSummary(plan));
    return plan.collision ? 1 : 0;
  }
  writeMigration(plan);
  out.log(`wrote ${plan.skillFile} and ${plan.yamlPath}`);
  plan.warnings.forEach((w) => out.log(`WARNING: ${w}`));
  out.log(`next: node scripts/migrate-command-to-skill.js ${args.file} --check-parity${args.name ? ` --name ${args.name}` : ''}`);
  return 0;
}

module.exports = {
  loadCommand,
  deriveSkillName,
  renderSkillBody,
  buildSkillMd,
  buildManifest,
  planMigration,
  writeMigration,
  formatSummary,
  renderUnits,
  extractUnits,
  checkMigrationParity,
  main
};

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }
}
