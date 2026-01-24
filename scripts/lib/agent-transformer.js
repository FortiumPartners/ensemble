/**
 * Agent Transformer Module
 * Transforms validated agent YAML into Claude Code compatible Markdown
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
 * Generate frontmatter for agent
 * @param {object} data - Agent YAML data
 * @returns {string}
 */
function generateAgentFrontmatter(data) {
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

  // Tools (required for agents)
  if (meta.tools && meta.tools.length > 0) {
    lines.push(`tools: [${meta.tools.join(', ')}]`);
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Transform agent YAML to Markdown
 * @param {object} agentData - Validated agent YAML
 * @param {string} sourceYamlPath - Path to source YAML (for header)
 * @returns {string} Generated Markdown
 */
function transformAgentToMarkdown(agentData, sourceYamlPath) {
  const parts = [];
  const sourceFile = path.basename(sourceYamlPath);

  // 1. Frontmatter
  parts.push(generateAgentFrontmatter(agentData));

  // 2. DO NOT EDIT header
  parts.push(generateDoNotEditHeader(sourceFile));

  // 3. Mission section
  parts.push('## Mission');
  parts.push('');

  if (agentData.mission?.summary) {
    parts.push(agentData.mission.summary.trim());
    parts.push('');
  }

  // 4. Boundaries
  if (agentData.mission?.boundaries) {
    parts.push('### Boundaries');
    parts.push('');

    if (agentData.mission.boundaries.handles) {
      parts.push('**Handles:**');
      parts.push(agentData.mission.boundaries.handles.trim());
      parts.push('');
    }

    if (agentData.mission.boundaries.doesNotHandle) {
      parts.push('**Does Not Handle:**');
      parts.push(agentData.mission.boundaries.doesNotHandle.trim());
      parts.push('');
    }
  }

  // 5. Responsibilities (grouped by priority)
  if (agentData.responsibilities && agentData.responsibilities.length > 0) {
    parts.push('## Responsibilities');
    parts.push('');

    // Group by priority
    const byPriority = {
      high: [],
      medium: [],
      low: []
    };

    for (const resp of agentData.responsibilities) {
      const priority = (resp.priority || 'medium').toLowerCase();
      if (byPriority[priority]) {
        byPriority[priority].push(resp);
      } else {
        byPriority.medium.push(resp);
      }
    }

    // Output by priority
    for (const [priority, items] of Object.entries(byPriority)) {
      if (items.length > 0) {
        parts.push(`### ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`);
        parts.push('');

        for (const item of items) {
          parts.push(`- **${item.title}**${item.description ? `: ${item.description}` : ''}`);
        }
        parts.push('');
      }
    }
  }

  // 6. Integration Protocols
  if (agentData.integrationProtocols) {
    parts.push('## Integration Protocols');
    parts.push('');

    if (agentData.integrationProtocols.handoffFrom && agentData.integrationProtocols.handoffFrom.length > 0) {
      parts.push('### Receives Work From');
      parts.push('');

      for (const handoff of agentData.integrationProtocols.handoffFrom) {
        parts.push(`- **${handoff.agent}**${handoff.context ? `: ${handoff.context}` : ''}`);
      }
      parts.push('');
    }

    if (agentData.integrationProtocols.handoffTo && agentData.integrationProtocols.handoffTo.length > 0) {
      parts.push('### Hands Off To');
      parts.push('');

      for (const handoff of agentData.integrationProtocols.handoffTo) {
        parts.push(`- **${handoff.agent}**${handoff.deliverables ? `: ${handoff.deliverables}` : ''}`);
      }
      parts.push('');
    }
  }

  // 7. Delegation Criteria
  if (agentData.delegationCriteria) {
    parts.push('## Delegation Criteria');
    parts.push('');

    if (agentData.delegationCriteria.whenToUse && agentData.delegationCriteria.whenToUse.length > 0) {
      parts.push('### When to Use This Agent');
      parts.push('');

      for (const item of agentData.delegationCriteria.whenToUse) {
        parts.push(`- ${item}`);
      }
      parts.push('');
    }

    if (agentData.delegationCriteria.whenToDelegate && agentData.delegationCriteria.whenToDelegate.length > 0) {
      parts.push('### When to Delegate');
      parts.push('');

      for (const delegation of agentData.delegationCriteria.whenToDelegate) {
        parts.push(`**${delegation.agent}:**`);
        if (delegation.triggers && delegation.triggers.length > 0) {
          for (const trigger of delegation.triggers) {
            parts.push(`- ${trigger}`);
          }
        }
        parts.push('');
      }
    }
  }

  // 8. Examples
  if (agentData.examples && agentData.examples.length > 0) {
    parts.push('## Examples');
    parts.push('');

    for (const example of agentData.examples) {
      if (example.scenario) {
        parts.push(`### ${example.scenario}`);
        parts.push('');
      }

      if (example.bestPractice) {
        parts.push('**Best Practice:**');
        if (example.bestPractice.description) {
          parts.push(example.bestPractice.description);
        }
        if (example.bestPractice.code) {
          const lang = example.bestPractice.language || '';
          parts.push('```' + lang);
          parts.push(example.bestPractice.code.trim());
          parts.push('```');
        }
        parts.push('');
      }

      if (example.antiPattern) {
        parts.push('**Anti-Pattern:**');
        if (example.antiPattern.description) {
          parts.push(example.antiPattern.description);
        }
        if (example.antiPattern.code) {
          const lang = example.antiPattern.language || '';
          parts.push('```' + lang);
          parts.push(example.antiPattern.code.trim());
          parts.push('```');
        }
        parts.push('');
      }
    }
  }

  // 9. Quality Standards
  if (agentData.qualityStandards) {
    parts.push('## Quality Standards');
    parts.push('');

    if (agentData.qualityStandards.codeQuality && agentData.qualityStandards.codeQuality.length > 0) {
      parts.push('### Code Quality');
      for (const item of agentData.qualityStandards.codeQuality) {
        parts.push(`- ${item}`);
      }
      parts.push('');
    }

    if (agentData.qualityStandards.documentation && agentData.qualityStandards.documentation.length > 0) {
      parts.push('### Documentation');
      for (const item of agentData.qualityStandards.documentation) {
        parts.push(`- ${item}`);
      }
      parts.push('');
    }

    if (agentData.qualityStandards.testing && agentData.qualityStandards.testing.length > 0) {
      parts.push('### Testing');
      for (const item of agentData.qualityStandards.testing) {
        parts.push(`- ${item}`);
      }
      parts.push('');
    }
  }

  return parts.join('\n');
}

module.exports = {
  transformAgentToMarkdown,
  generateAgentFrontmatter,
  generateDoNotEditHeader
};
