'use strict';

const fs = require('fs');
const path = require('path');
// js-yaml is absent from a marketplace-cache install (no `npm install` runs there),
// so a bare require would crash the whole module. Same guard as trd-cli.js.
let yaml;
try { yaml = require('js-yaml'); } catch { yaml = null; }

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Read the flat `default_agents:` map from configure-team.yaml without a YAML parser.
 * ponytail: handles only that one `key: value` block; the rest of team_configuration
 * (domain_keywords, ...) needs js-yaml. Nothing in this file reads those.
 */
function readDefaultAgents(text) {
  const agents = {};
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*default_agents:\s*$/.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    const m = line.match(/^\s+([\w-]+):\s*([\w.-]+)\s*$/);
    if (!m) break;
    agents[m[1]] = m[2];
  }
  return agents;
}

function loadTeamConfiguration() {
  const configPath = path.join(__dirname, '..', 'commands', 'configure-team.yaml');
  const text = fs.readFileSync(configPath, 'utf8');
  if (yaml) return yaml.load(text).team_configuration;
  return { default_agents: readDefaultAgents(text) };
}

function inferBuilderAgents(domains = [], teamConfiguration = loadTeamConfiguration()) {
  const defaults = teamConfiguration.default_agents || {};
  const builders = [];

  const directBuilderDomains = ['backend', 'frontend', 'infrastructure', 'devops'];
  for (const domain of domains) {
    if (directBuilderDomains.includes(domain) && defaults[domain]) {
      builders.push(defaults[domain]);
    }
  }

  if (domains.includes('database') || domains.includes('security')) {
    if (defaults.backend) builders.push(defaults.backend);
  }

  if (builders.length === 0) {
    builders.push(defaults.backend || 'backend-developer');
  }

  return unique(builders);
}

function resolveDefaultTeamRoles(input = {}) {
  const teamConfiguration = loadTeamConfiguration();
  const defaults = teamConfiguration.default_agents || {};
  const domains = input.domains || [];
  const builderAgents = inferBuilderAgents(domains, teamConfiguration);

  return {
    lead: {
      agents: [defaults.lead || 'tech-lead-orchestrator'],
      owns: ['planning', 'escalation', 'skip-decisions'],
    },
    builder: {
      agents: builderAgents,
      owns: ['implementation'],
    },
    architect: {
      agents: ['architect'],
      owns: ['task-design', 'architecture-drift-detection'],
    },
    documentation: {
      agents: [defaults.documentation || 'documentation-specialist'],
      owns: ['pr-boundary-doc-maintenance'],
    },
    reviewer: {
      agents: [defaults.reviewer || 'code-reviewer'],
      owns: ['code-review'],
    },
    qa: {
      agents: [defaults.qa || defaults.qa_fallback || 'qa-orchestrator'],
      owns: ['quality-assurance'],
    },
    advisor: {
      agents: ['advisor'],
      owns: ['shortcut-detection', 'solution-quality', 'requirement-traceability'],
    },
    pm: {
      agents: ['product-management-orchestrator'],
      owns: ['requirement-clarification', 'scope-decisions', 'ambiguity-resolution'],
    },
  };
}

module.exports = {
  loadTeamConfiguration,
  resolveDefaultTeamRoles,
  inferBuilderAgents,
};
