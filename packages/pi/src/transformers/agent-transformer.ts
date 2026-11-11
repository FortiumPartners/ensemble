/**
 * Agent Transformer
 *
 * Transforms Ensemble YAML agent definitions into Pi agent markdown
 * files with YAML frontmatter, written to packages/pi/agents/. Each file
 * carries the generated marker (../generated-marker.ts) right after the
 * frontmatter, which is how a later run recognises it as its own output.
 *
 * Handles both top-level `name`/`description`/`tools` layout and the
 * nested `metadata.*` pattern used across the Ensemble monorepo.
 *
 * Pi/OMP-available tools (allowlist):
 *   Read, Write, Edit, Bash, ask, task
 *
 * Stripped Claude Code-only tools:
 *   TodoWrite, Agent, NotebookEdit, ExitPlanMode, EnterPlanMode,
 *   WebSearch, WebFetch, Glob, Grep
 *
 * @module ensemble-pi/transformers/agent-transformer
 */

import * as path from 'path';
import { TransformResult } from '../types';
import { generatedMarker } from '../generated-marker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools available to Pi agents, including OMP's native delegation tool. */
const PI_AVAILABLE_TOOLS: Record<string, true> = {
  Read: true,
  Write: true,
  Edit: true,
  Bash: true,
  ask: true,
  task: true,
};

/** Claude Code-only tools that must be stripped when targeting Pi. */
const CLAUDE_CODE_ONLY_TOOLS = new Set([
  'TodoWrite',
  'Agent',
  'NotebookEdit',
  'ExitPlanMode',
  'EnterPlanMode',
  'WebSearch',
  'WebFetch',
  'Glob',
  'Grep',
  'AskUserQuestion',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw YAML object to extract name, description, tools, and model,
 * supporting both top-level and nested `metadata.*` layouts.
 */
function normalizeAgentFields(raw: Record<string, unknown>): {
  name: string;
  description: string;
  tools: string[];
  model: string | undefined;
} {
  let name: string;
  let description: string;
  let tools: string[];
  let model: string | undefined;

  if (raw.metadata && typeof raw.metadata === 'object') {
    const meta = raw.metadata as Record<string, unknown>;
    name = typeof meta.name === 'string' ? meta.name : '';
    description = typeof meta.description === 'string' ? meta.description : '';
    // Tools may be in metadata.tools or top-level tools
    const metaTools = Array.isArray(meta.tools) ? (meta.tools as string[]) : [];
    const topTools = Array.isArray(raw.tools) ? (raw.tools as string[]) : [];
    tools = topTools.length > 0 ? topTools : metaTools;
    model = typeof meta.model === 'string' ? meta.model : undefined;
  } else {
    name = typeof raw.name === 'string' ? raw.name : '';
    description = typeof raw.description === 'string' ? raw.description : '';
    tools = Array.isArray(raw.tools) ? (raw.tools as string[]) : [];
    model = typeof raw.model === 'string' ? raw.model : undefined;
  }

  return { name, description, tools, model };
}

/**
 * Filter the tools list to only Pi/OMP-available tools.
 * Task must use the native lowercase name: OMP also uses it to infer spawn
 * permission. Preserve source opt-in rather than granting it to every agent.
 * AskUserQuestion is mapped to ask (OMP's native interactive-question tool) before filtering.
 */
function filterTools(tools: string[]): string[] {
  return tools
    .map(t => {
      if (t === 'Task') return 'task';
      if (t === 'AskUserQuestion') return 'ask';
      return t;
    })
    .filter(t => PI_AVAILABLE_TOOLS[t] === true);
}

/**
 * Abstract model tiers used by the source agent YAMLs (`metadata.model`).
 *
 * OMP resolves a BARE word in an agent's `model:` as a model-name substring
 * pattern (e.g. `high` matches `o3-mini-high`, `medium` matches `*-medium*`),
 * not as a role. A role alias needs the `@` prefix (`@high` resolves through
 * the user's `modelRoles.high`).
 *
 * An `@role` naming a role the user never configured is NOT skipped: OMP keeps
 * it as a literal pattern that matches no model, and a lone unresolved
 * selector leaves the subagent with no model ("No model selected"). So each
 * tier is emitted as an ordered selector list, `@<tier>,@default`: the tier
 * role where it is configured, the user's `default` role everywhere else.
 */
const MODEL_TIER_ROLES: Record<string, true> = { high: true, medium: true };

/**
 * Map an agent's source model to the value written into the Pi frontmatter.
 * Exactly a tier word becomes `@<tier>,@default`; anything else (a concrete
 * `provider/id`, an existing `@role`) passes through unchanged.
 */
function resolveModelValue(model: string): string {
  const trimmed = model.trim();
  return MODEL_TIER_ROLES[trimmed] === true ? `@${trimmed},@default` : model;
}

/**
 * Emit a value as a quoted, single-line YAML scalar.
 *
 * Quoting is unconditional. The previous rule quoted only when the value
 * *started* with a YAML indicator, which let a mid-string ": " through and
 * produced an unparseable block — and a parse failure drops the whole agent
 * silently. JSON string escaping is valid YAML 1.2 double-quoted style, so the
 * escaping is the standard library's rather than ours.
 *
 * Mirrors scripts/lib/yaml-scalar.js; kept local to avoid a build-time
 * dependency from this package on the repo's generator scripts.
 */
function yamlScalar(value: string): string {
  return JSON.stringify(String(value).replace(/\s+/g, ' ').trim());
}

/**
 * Render a YAML frontmatter block for a Pi agent file.
 * Tools list is rendered as a flow sequence (inline array) of quoted elements.
 */
function renderFrontmatter(
  name: string,
  description: string,
  tools: string[],
  model: string | undefined
): string {
  const toolsInline = tools.length > 0 ? `[${tools.map(yamlScalar).join(', ')}]` : '[]';
  const lines = [
    '---',
    `name: ${yamlScalar(name)}`,
    `description: ${yamlScalar(description)}`,
    `tools: ${toolsInline}`
  ];
  if (model) {
    lines.push(`model: ${yamlScalar(resolveModelValue(model))}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Extract agent body content from the raw YAML object.
 *
 * Strategy: walk the raw object and render relevant sections as markdown.
 * Sections are rendered in a consistent order: mission, responsibilities,
 * plus any other top-level keys that aren't metadata/tools/model.
 *
 * AskUserQuestion references in text are replaced with ask.
 */
function renderBody(raw: Record<string, unknown>, agentName: string): string {
  const sections: string[] = [];

  sections.push(`# ${agentName}`);
  sections.push('');

  // Render mission section
  if (raw.mission && typeof raw.mission === 'object') {
    const mission = raw.mission as Record<string, unknown>;
    sections.push('## Mission');
    sections.push('');

    if (typeof mission.summary === 'string') {
      sections.push(mission.summary.trim());
      sections.push('');
    }

    if (mission.boundaries && typeof mission.boundaries === 'object') {
      const b = mission.boundaries as Record<string, unknown>;
      if (typeof b.handles === 'string') {
        sections.push('### Handles');
        sections.push('');
        sections.push(b.handles.trim());
        sections.push('');
      }
      if (typeof b.doesNotHandle === 'string') {
        sections.push('### Does Not Handle');
        sections.push('');
        sections.push(b.doesNotHandle.trim());
        sections.push('');
      }
      if (typeof b.collaboratesOn === 'string') {
        sections.push('### Collaborates On');
        sections.push('');
        sections.push(b.collaboratesOn.trim());
        sections.push('');
      }
    }

    if (Array.isArray(mission.expertise)) {
      sections.push('### Expertise');
      sections.push('');
      for (const item of mission.expertise as Array<Record<string, unknown>>) {
        if (typeof item.name === 'string') {
          sections.push(`**${item.name}**`);
          if (typeof item.description === 'string') {
            sections.push('');
            sections.push(item.description.trim());
          }
          sections.push('');
        }
      }
    }
  }

  // Render responsibilities section
  if (Array.isArray(raw.responsibilities)) {
    sections.push('## Responsibilities');
    sections.push('');
    for (const resp of raw.responsibilities as Array<Record<string, unknown>>) {
      const priority = typeof resp.priority === 'string' ? resp.priority : '';
      const title = typeof resp.title === 'string' ? resp.title : '';
      if (title) {
        sections.push(`### ${title}${priority ? ` (${priority})` : ''}`);
        sections.push('');
      }
      if (typeof resp.description === 'string') {
        sections.push(resp.description.trim());
        sections.push('');
      }
    }
  }

  // Render the output contract when an agent declares one (the read-only code
  // reviewer's ledger findings and summary rule). Absent on every other agent,
  // so no other generated file changes.
  if (raw.outputContract && typeof raw.outputContract === 'object') {
    const contract = raw.outputContract as Record<string, unknown>;
    const guide = (contract.fieldGuide && typeof contract.fieldGuide === 'object'
      ? contract.fieldGuide
      : {}) as Record<string, unknown>;
    sections.push('## Output Contract');
    sections.push('');
    if (Array.isArray(contract.findingFields)) {
      sections.push('### Finding Fields');
      sections.push('');
      for (const field of contract.findingFields as string[]) {
        const note = typeof guide[field] === 'string' ? `: ${guide[field] as string}` : '';
        sections.push(`- \`${field}\`${note}`);
      }
      sections.push('');
    }
    if (Array.isArray(contract.severities)) {
      sections.push(`**Severities:** ${(contract.severities as string[]).map((word) => `\`${word}\``).join(', ')}`);
      sections.push('');
    }
    if (typeof contract.summaryRule === 'string') {
      sections.push('### Summary');
      sections.push('');
      sections.push(contract.summaryRule.trim());
      sections.push('');
    }
    if (typeof contract.secretHandling === 'string') {
      sections.push('### Secrets');
      sections.push('');
      sections.push(contract.secretHandling.trim());
      sections.push('');
    }
  }

  // Render delegation criteria if present (useful for routing awareness)
  if (raw.delegationCriteria && typeof raw.delegationCriteria === 'object') {
    const dc = raw.delegationCriteria as Record<string, unknown>;
    if (Array.isArray(dc.whenToUse)) {
      sections.push('## When To Use');
      sections.push('');
      for (const trigger of dc.whenToUse as string[]) {
        sections.push(`- ${trigger}`);
      }
      sections.push('');
    }
  }

  const body = sections.join('\n');

  // Replace AskUserQuestion tool references in body text with ask
  return body.replace(/\bAskUserQuestion\b/g, 'ask');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transform a parsed agent YAML into a Pi agent markdown string.
 *
 * Produces YAML frontmatter (name, description, tools, model), the generated
 * marker, then the markdown body (mission, responsibilities). Claude Code-only
 * tools are stripped; Task is mapped to task and AskUserQuestion to ask.
 *
 * @param agentYaml  Parsed YAML object from agent source file
 * @param sourcePath Absolute path to the source .yaml file (named in the marker, and for logging)
 * @param options    Runtime options
 * @returns          Rendered markdown string (frontmatter + marker + body)
 */
export function transformAgent(
  agentYaml: Record<string, unknown>,
  sourcePath: string,
  options: { verbose?: boolean }
): string {
  const { name, description, tools, model } = normalizeAgentFields(agentYaml);

  const filteredTools = filterTools(tools);

  if (options.verbose) {
    const stripped = tools.filter(t => CLAUDE_CODE_ONLY_TOOLS.has(t) || t === 'AskUserQuestion');
    if (stripped.length > 0) {
      process.stdout.write(
        `  agent-transformer: stripped tools [${stripped.join(', ')}] from ${path.basename(sourcePath)}\n`
      );
    }
  }

  const frontmatter = renderFrontmatter(name, description, filteredTools, model);
  const body = renderBody(agentYaml, name);

  return `${frontmatter}\n\n${generatedMarker(path.basename(sourcePath))}\n\n${body}`;
}

/**
 * Derive the output path for a Pi agent file from the source path and output root.
 *
 * @param agentName  Normalized agent name (e.g. "product-management-orchestrator")
 * @param outputRoot Absolute path to packages/pi
 * @returns          Absolute path to the output .md file
 */
export function agentOutputPath(agentName: string, outputRoot: string): string {
  const safeName = agentName.replace(/\s+/g, '-').toLowerCase();
  return path.join(outputRoot, 'agents', `${safeName}.md`);
}

/**
 * Build a TransformResult for an agent file.
 * Convenience wrapper used by generator.ts.
 */
export function buildAgentResult(
  agentYaml: Record<string, unknown>,
  sourcePath: string,
  outputRoot: string,
  options: { verbose?: boolean }
): TransformResult {
  const { name } = normalizeAgentFields(agentYaml);
  const content = transformAgent(agentYaml, sourcePath, options);
  const outputPath = agentOutputPath(name, outputRoot);
  return { sourcePath, outputPath, content, type: 'agent' };
}
