/**
 * Command Transformer Module
 * Transforms validated command YAML into Claude Code compatible Markdown
 */

'use strict';

const { yamlScalar } = require('./yaml-scalar');

// NOTE: model: tier aliases in source YAML (high/medium/low) are emitted as
// Claude Code's portable model aliases (opus/sonnet/haiku) in the generated .md.
// These resolve per-provider at runtime (Anthropic API, Bedrock, Vertex), so
// generated commands run on any backend. Emitting a pinned first-party ID
// (e.g. 'claude-opus-4-7') would 400 on Bedrock, where the model identifier is
// an inference-profile ARN that does not match first-party model names.

const path = require('path');

/**
 * Generate the DO NOT EDIT header
 * @param {string} sourceFile - Source YAML filename
 * @returns {string}
 */
function generateDoNotEditHeader(sourceFile) {
  return `<!-- DO NOT EDIT - Generated from ${sourceFile} -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->

`;
}

/**
 * Generate frontmatter for command
 * @param {object} data - Command YAML data
 * @returns {string}
 */
function generateCommandFrontmatter(data) {
  const meta = data.metadata || {};
  const lines = ['---'];

  // Every value below goes through yamlScalar. Emitting any of them raw risks
  // an unparseable block, and a parse failure drops the whole command silently.

  // Name (required)
  if (meta.name) {
    lines.push(`name: ${yamlScalar(meta.name)}`);
  }

  // Description (required)
  if (meta.description) {
    lines.push(`description: ${yamlScalar(meta.description)}`);
  }

  // Version (optional)
  if (meta.version) {
    lines.push(`version: ${yamlScalar(meta.version)}`);
  }

  // Category (optional)
  if (meta.category) {
    lines.push(`category: ${yamlScalar(meta.category)}`);
  }

  // Last updated (optional)
  if (meta.lastUpdated) {
    lines.push(`last-updated: ${yamlScalar(meta.lastUpdated)}`);
  }

  // Allowed tools (optional). This is a comma-joined STRING, not a sequence --
  // quote the joined value as a whole. Bracketing it would promote it to a list.
  if (meta.allowed_tools && meta.allowed_tools.length > 0) {
    lines.push(`allowed-tools: ${yamlScalar(meta.allowed_tools.join(', '))}`);
  }

  // Argument hint (optional)
  if (meta.argument_hint) {
    lines.push(`argument-hint: ${yamlScalar(meta.argument_hint)}`);
  }

  // Map tier aliases (high/medium/low) to Claude Code's portable model aliases
  // (opus/sonnet/haiku). These resolve per-provider at runtime, so generated
  // commands run on Anthropic API, Bedrock, and Vertex alike. A pinned
  // first-party ID would 400 on Bedrock (model id is an inference-profile ARN).
  // Non-tier values pass through unchanged for explicit overrides.
  if (meta.model) {
    const TIER_TO_ALIAS = { high: 'opus', medium: 'sonnet', low: 'haiku' };
    const emitted = Object.prototype.hasOwnProperty.call(TIER_TO_ALIAS, meta.model)
      ? TIER_TO_ALIAS[meta.model]
      : meta.model;
    lines.push(`model: ${yamlScalar(emitted)}`);
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Generate the Arguments section from a command's parameters[] list.
 * Each parameter renders as a single bullet: name, type, required/optional,
 * default (if present), and description. Descriptions may arrive as
 * folded/literal YAML block scalars with embedded whitespace runs -- these
 * are collapsed to a single line so one parameter never spans multiple
 * bullets.
 * @param {Array<object>} parameters - Parameter definitions
 * @returns {string}
 */
function generateArgumentsSection(parameters) {
  const lines = ['## Arguments', ''];

  for (const param of parameters) {
    const type = param.type || 'string';
    const requirement = param.required ? 'required' : 'optional';
    let tag = `${type}, ${requirement}`;
    if (param.default !== undefined) {
      tag += `, default: \`${JSON.stringify(param.default)}\``;
    }

    let line = `- **\`${param.name}\`** (${tag})`;
    if (param.description) {
      const desc = param.description.trim().replace(/\s+/g, ' ');
      line += `: ${desc}`;
    }
    lines.push(line);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generate the "## Subcommands" section for a dispatcher command. Each
 * subcommand's `ref` resolves through the shared commandPathsByRef map
 * (built once per generation run in generate-markdown.js) to that sibling
 * command's own, already-generated output path -- the dispatcher never
 * inlines the sibling's workflow, keeping per-invocation cost equal to
 * today's single-command cost.
 * @param {Array<object>} subcommands - dispatch.subcommands[] from the YAML
 * @param {Map<string,string>} commandPathsByRef - bare command name -> resolved output path
 * @param {string} sourceYamlPath - path to the dispatcher's own YAML (for errors)
 * @returns {string}
 */
function generateSubcommandsSection(subcommands, commandPathsByRef, sourceYamlPath) {
  const repoRoot = path.resolve(__dirname, '../..');
  const lines = ['## Subcommands', ''];

  for (const sub of subcommands) {
    const outputPath = commandPathsByRef.get(sub.ref);
    if (!outputPath) {
      throw new Error(`dispatch.subcommands references unknown command '${sub.ref}' (${sourceYamlPath})`);
    }
    const relPath = path.relative(repoRoot, outputPath);
    const description = sub.description ? sub.description.trim().replace(/\s+/g, ' ') : '';
    const descPrefix = description ? `${description}. ` : '';
    lines.push(
      `- **\`${sub.keyword}\`** - ${descPrefix}Invoke \`/ensemble:${sub.ref}\` directly, or read and follow \`${relPath}\`, passing the remaining arguments through as its $ARGUMENTS.`
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Transform command YAML to Markdown
 * @param {object} commandData - Validated command YAML
 * @param {string} sourceYamlPath - Path to source YAML (for header)
 * @param {Map<string,string>} [commandPathsByRef] - Bare command name -> resolved
 *   output path, for resolving dispatcher subcommand refs. Only required
 *   when commandData.dispatch?.subcommands is present.
 * @returns {string} Generated Markdown
 */
function transformCommandToMarkdown(commandData, sourceYamlPath, commandPathsByRef) {
  const parts = [];
  const sourceFile = path.basename(sourceYamlPath);

  // 1. Frontmatter
  parts.push(generateCommandFrontmatter(commandData));

  // 2. DO NOT EDIT header
  parts.push(generateDoNotEditHeader(sourceFile));

  // 3. Mission summary
  if (commandData.mission?.summary) {
    parts.push(commandData.mission.summary.trim());
    parts.push('');
  }

  // 4. Arguments
  if (commandData.parameters && commandData.parameters.length > 0) {
    parts.push(generateArgumentsSection(commandData.parameters));
  }

  // 4b. Subcommands (dispatcher commands only)
  if (commandData.dispatch?.subcommands) {
    parts.push(generateSubcommandsSection(commandData.dispatch.subcommands, commandPathsByRef || new Map(), sourceYamlPath));
  }

  // 5. Workflow phases
  if (commandData.workflow?.phases) {
    parts.push('## Workflow');
    parts.push('');

    const sortedPhases = [...commandData.workflow.phases].sort((a, b) => a.order - b.order);

    for (const phase of sortedPhases) {
      parts.push(`### Phase ${phase.order}: ${phase.name}`);
      parts.push('');

      if (phase.steps && phase.steps.length > 0) {
        const sortedSteps = [...phase.steps].sort((a, b) => a.order - b.order);

        for (const step of sortedSteps) {
          // Step title
          const stepTitle = step.title || `Step ${step.order}`;
          parts.push(`**${step.order}. ${stepTitle}**`);

          // Step description
          if (step.description) {
            parts.push(`   ${step.description}`);
          }
          parts.push('');

          // Step actions
          if (step.actions && step.actions.length > 0) {
            for (const action of step.actions) {
              parts.push(`- ${action}`);
            }
            parts.push('');
          }

          // Delegation info
          if (step.delegation?.agent) {
            parts.push(`   **Delegation:** @${step.delegation.agent}`);
            if (step.delegation.context) {
              parts.push(`   ${step.delegation.context}`);
            }
            parts.push('');
          }

          // MCP Tool info
          if (step.mcp_tool) {
            if (typeof step.mcp_tool === 'object') {
              if (step.mcp_tool.name) {
                parts.push(`   **MCP Tool:** \`${step.mcp_tool.name}\``);
              }
              if (step.mcp_tool.usage) {
                parts.push(`   ${step.mcp_tool.usage.trim()}`);
                parts.push('');
              }
              if (step.mcp_tool.fallback) {
                parts.push(`   **Fallback:** ${step.mcp_tool.fallback}`);
                parts.push('');
              }
            } else if (typeof step.mcp_tool === 'string') {
              parts.push(`   **MCP Tool:** \`${step.mcp_tool}\``);
              parts.push('');
            }
          }
        }
      }
    }
  }

  // 6. Expected Output
  if (commandData.expectedOutput) {
    parts.push('## Expected Output');
    parts.push('');

    if (commandData.expectedOutput.format) {
      parts.push(`**Format:** ${commandData.expectedOutput.format}`);
      parts.push('');
    }

    if (commandData.expectedOutput.structure && commandData.expectedOutput.structure.length > 0) {
      parts.push('**Structure:**');
      for (const item of commandData.expectedOutput.structure) {
        parts.push(`- **${item.name}**: ${item.description || ''}`);
      }
      parts.push('');
    }
  }

  // 7. Usage section
  const name = commandData.metadata?.name || 'command';
  const argHint = commandData.metadata?.argument_hint || '';
  parts.push('## Usage');
  parts.push('');
  parts.push('```');
  parts.push(`/${name}${argHint ? ' ' + argHint : ''}`);
  parts.push('```');
  parts.push('');

  return parts.join('\n');
}

module.exports = {
  transformCommandToMarkdown,
  generateCommandFrontmatter,
  generateDoNotEditHeader,
  generateArgumentsSection
};
