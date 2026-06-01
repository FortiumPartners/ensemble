/**
 * Command Transformer Module
 * Transforms validated command YAML into Claude Code compatible Markdown
 */

'use strict';

// NOTE: model: tier aliases in source YAML are resolved to fully-pinned model IDs
// at generation time via packages/core/lib/config-loader + model-resolver.
// Generated .md files always contain real model IDs (or no model: field if unresolvable).

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

  // Name (required)
  if (meta.name) {
    lines.push(`name: ${meta.name}`);
  }

  // Description (required)
  if (meta.description) {
    lines.push(`description: ${meta.description}`);
  }

  // Version (optional)
  if (meta.version) {
    lines.push(`version: ${meta.version}`);
  }

  // Category (optional)
  if (meta.category) {
    lines.push(`category: ${meta.category}`);
  }

  // Last updated (optional)
  if (meta.lastUpdated) {
    lines.push(`last-updated: ${meta.lastUpdated}`);
  }

  // Allowed tools (optional)
  if (meta.allowed_tools && meta.allowed_tools.length > 0) {
    lines.push(`allowed-tools: ${meta.allowed_tools.join(', ')}`);
  }

  // Argument hint (optional)
  if (meta.argument_hint) {
    lines.push(`argument-hint: ${meta.argument_hint}`);
  }

  // Resolve tier aliases to fully-pinned model IDs before emitting.
  // Claude Code rejects tier names ('high', 'medium', 'low') as model IDs.
  // If resolution fails, suppress the field so Claude Code uses the user's default.
  if (meta.model) {
    const TIER_ALIASES = new Set(['high', 'medium', 'low']);
    let resolvedModel = meta.model;
    if (TIER_ALIASES.has(meta.model)) {
      try {
        const { loadConfig } = require('../../packages/core/lib/config-loader');
        const { resolveModel } = require('../../packages/core/lib/model-resolver');
        const cfg = loadConfig(process.cwd());
        resolvedModel = resolveModel(meta.model, cfg);
      } catch (_) {
        resolvedModel = null; // suppress on any error
      }
    }
    if (resolvedModel) {
      lines.push(`model: ${resolvedModel}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Transform command YAML to Markdown
 * @param {object} commandData - Validated command YAML
 * @param {string} sourceYamlPath - Path to source YAML (for header)
 * @returns {string} Generated Markdown
 */
function transformCommandToMarkdown(commandData, sourceYamlPath) {
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

  // 4. Workflow phases
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
              parts.push(`   - ${action}`);
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

  // 5. Expected Output
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

  // 6. Usage section
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
  generateDoNotEditHeader
};
