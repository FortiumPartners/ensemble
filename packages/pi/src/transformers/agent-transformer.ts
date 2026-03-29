/**
 * Agent Transformer
 *
 * Transforms Ensemble YAML agent definitions into Pi agent markdown
 * files with YAML frontmatter, written to packages/pi/agents/.
 *
 * Handles both top-level `name`/`description`/`tools` layout and the
 * nested `metadata.*` pattern used across the Ensemble monorepo.
 *
 * Pi-available tools (allowlist):
 *   Read, Write, Edit, Bash, ask_user
 *
 * Stripped Claude Code-only tools:
 *   Task, TodoWrite, Agent, NotebookEdit, ExitPlanMode, EnterPlanMode,
 *   WebSearch, WebFetch, Glob, Grep, AskUserQuestion
 *
 * @module ensemble-pi/transformers/agent-transformer
 */

import * as path from 'path';
import { TransformResult } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools that are available in the Pi runtime. */
const PI_AVAILABLE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Bash', 'ask_user']);

/** Claude Code-only tools that must be stripped when targeting Pi. */
const CLAUDE_CODE_ONLY_TOOLS = new Set([
  'Task',
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
  let name = '';
  let description = '';
  let tools: string[] = [];
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
 * Filter the tools list to only Pi-available tools.
 * AskUserQuestion is mapped to ask_user before filtering.
 */
function filterTools(tools: string[]): string[] {
  return tools
    .map(t => (t === 'AskUserQuestion' ? 'ask_user' : t))
    .filter(t => PI_AVAILABLE_TOOLS.has(t));
}

/**
 * Render a YAML frontmatter block for a Pi agent file.
 * Tools list is rendered as a flow sequence (inline array).
 */
function renderFrontmatter(
  name: string,
  description: string,
  tools: string[],
  model: string | undefined
): string {
  const toolsInline = tools.length > 0 ? `[${tools.join(', ')}]` : '[]';
  // Quote description if it starts with YAML-special characters ([, {, *, &, !, |, >, ', ", %)
  const descSafe = /^[[{*&!|>'"%]/.test(description) ? `"${description.replace(/"/g, '\\"')}"` : description;
  const lines = ['---', `name: ${name}`, `description: ${descSafe}`, `tools: ${toolsInline}`];
  if (model) {
    lines.push(`model: ${model}`);
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
 * AskUserQuestion references in text are replaced with ask_user.
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

  // Replace AskUserQuestion tool references in body text with ask_user
  return body.replace(/\bAskUserQuestion\b/g, 'ask_user');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transform a parsed agent YAML into a Pi agent markdown string.
 *
 * Produces YAML frontmatter (name, description, tools, model) followed by
 * markdown body (mission, responsibilities). Claude Code-only tools are
 * stripped; AskUserQuestion is mapped to ask_user.
 *
 * @param agentYaml  Parsed YAML object from agent source file
 * @param sourcePath Absolute path to the source .yaml file (for logging)
 * @param options    Runtime options
 * @returns          Rendered markdown string (frontmatter + body)
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

  return `${frontmatter}\n\n${body}`;
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
