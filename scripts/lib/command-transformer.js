/**
 * Command Transformer Module
 * Transforms validated command YAML into Claude Code compatible Markdown
 */

'use strict';

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

  // Allowed tools (optional)
  if (meta.allowed_tools && meta.allowed_tools.length > 0) {
    lines.push(`allowed-tools: ${meta.allowed_tools.join(', ')}`);
  }

  // Argument hint (optional)
  if (meta.argument_hint) {
    lines.push(`argument-hint: ${meta.argument_hint}`);
  }

  // Model (optional)
  if (meta.model) {
    lines.push(`model: ${meta.model}`);
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
