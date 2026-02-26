// AgentTranslator - Converts YAML agent definitions to OpenCode JSON config and Markdown
//
// Responsibilities:
//   - Discover and parse all agent YAML files across packages (OC-S2-AGT-001)
//   - Map tool permissions to OpenCode format (OC-S2-AGT-002)
//   - Generate prompt from mission and responsibilities (OC-S2-AGT-003)
//   - Classify agent modes: orchestrator -> primary, others -> subagent (OC-S2-AGT-004)
//   - Translate model hints to OpenCode providerID/modelID format (OC-S2-AGT-005)
//   - Generate JSON config entries for opencode.json agent block (OC-S2-AGT-006)
//   - Generate Markdown agent files for .opencode/agents/ (OC-S2-AGT-007)
//   - Extract delegation hierarchy from integration protocols (OC-S2-AGT-008)
//   - Generate routing prompt for primary orchestrator (OC-S2-AGT-009)
//   - Inject @agent-name references in generated prompts (OC-S2-AGT-010)
//   - Add category metadata tags to generated config (OC-S2-AGT-011)
//
// Task IDs: OC-S2-AGT-001 through OC-S2-AGT-011

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const glob = require('glob');

// ---------------------------------------------------------------------------
// Model hint mapping table (OC-S2-AGT-005)
// ---------------------------------------------------------------------------
const MODEL_MAP = {
  opus: { providerID: 'anthropic', modelID: 'claude-opus-4-6' },
  'opus-4-6': { providerID: 'anthropic', modelID: 'claude-opus-4-6' },
  sonnet: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
  'sonnet-4-6': { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
  haiku: { providerID: 'anthropic', modelID: 'claude-haiku-4-5-20251001' },
  'haiku-4-5': { providerID: 'anthropic', modelID: 'claude-haiku-4-5-20251001' },
};

const DEFAULT_MODEL = { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' };

// ---------------------------------------------------------------------------
// Tool permission mapping table (OC-S2-AGT-002)
// ---------------------------------------------------------------------------
const TOOL_PERMISSION_MAP = {
  Read: { read: 'allow' },
  Grep: { read: 'allow' },
  Glob: { read: 'allow' },
  Write: { edit: 'allow' },
  Edit: { edit: 'allow' },
  Bash: { bash: 'ask' },
  // Task, TodoWrite, AskUserQuestion have no direct OpenCode mapping
};

// ---------------------------------------------------------------------------
// Category constants (OC-S2-AGT-011)
// ---------------------------------------------------------------------------
const KNOWN_CATEGORIES = new Set([
  'orchestrator',
  'developer',
  'specialist',
  'quality',
  'utility',
  'workflow',
  'infrastructure',
  'testing',
]);

// ---------------------------------------------------------------------------
// Category display names for routing prompt grouping (OC-S2-AGT-009)
// ---------------------------------------------------------------------------
const CATEGORY_GROUP_ORDER = [
  'orchestrator',
  'developer',
  'specialist',
  'quality',
  'workflow',
  'infrastructure',
  'utility',
  'testing',
];

const CATEGORY_GROUP_LABELS = {
  orchestrator: 'Orchestrators',
  developer: 'Developers',
  specialist: 'Specialists',
  quality: 'Quality & Testing',
  workflow: 'Workflow',
  infrastructure: 'Infrastructure',
  utility: 'Utilities',
  testing: 'Testing Frameworks',
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Convert a hyphenated agent name to Title Case.
 * "backend-developer" -> "Backend Developer"
 */
function toTitleCase(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Trim a string value, handling multiline YAML strings.
 */
function trimValue(val) {
  if (!val) return '';
  return String(val).trim();
}

// ---------------------------------------------------------------------------
// AgentTranslator class
// ---------------------------------------------------------------------------
class AgentTranslator {
  /**
   * @param {object} options
   * @param {string} options.packagesDir  - Path to packages/ directory
   * @param {string} options.outputDir    - Path to output directory for .md files
   * @param {boolean} options.dryRun      - If true, don't write files
   * @param {boolean} options.verbose     - If true, log extra info
   */
  constructor(options) {
    this.packagesDir = options.packagesDir;
    this.outputDir = options.outputDir;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-001: Parse Ensemble agent YAML
  // -------------------------------------------------------------------------

  /**
   * Parse an agent YAML file and return the parsed object.
   * @param {string} filePath - Absolute path to the YAML file
   * @returns {object} Parsed YAML object
   */
  parseAgentYaml(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Agent YAML file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content);
    if (!parsed || !parsed.metadata) {
      throw new Error(`Invalid agent YAML (missing metadata): ${filePath}`);
    }
    return parsed;
  }

  /**
   * Discover all agent YAML files across packages/ directories.
   * @returns {string[]} Array of absolute paths to YAML files
   */
  discoverAgentFiles() {
    const pattern = path.join(this.packagesDir, '*/agents/*.yaml');
    const files = glob.sync(pattern);
    return files.sort();
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-002: Tool permission mapping
  // -------------------------------------------------------------------------

  /**
   * Map Ensemble tool names to OpenCode permission config.
   * @param {string[]} tools - Array of tool names from metadata
   * @returns {object} Permission object { read, edit, bash }
   */
  mapToolPermissions(tools) {
    const permissions = {};
    if (!tools || !Array.isArray(tools)) return permissions;

    for (const tool of tools) {
      const mapping = TOOL_PERMISSION_MAP[tool];
      if (mapping) {
        Object.assign(permissions, mapping);
      }
    }
    return permissions;
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-003: Mission/responsibilities to prompt field
  // -------------------------------------------------------------------------

  /**
   * Generate the OpenCode prompt string from agent YAML data.
   * Concatenates Mission, Boundaries, Responsibilities, Integration Protocols,
   * and Delegation sections.
   * @param {object} agent - Parsed agent YAML object
   * @returns {string} Formatted prompt string
   */
  generatePrompt(agent) {
    const lines = [];

    // Mission section
    if (agent.mission && agent.mission.summary) {
      lines.push('## Mission');
      lines.push('');
      lines.push(trimValue(agent.mission.summary));
      lines.push('');
    }

    // Boundaries section
    if (agent.mission && agent.mission.boundaries) {
      const b = agent.mission.boundaries;
      if (b.handles || b.doesNotHandle || b.collaboratesOn) {
        lines.push('## Boundaries');
        lines.push('');
        if (b.handles) {
          lines.push(`**Handles:** ${trimValue(b.handles)}`);
          lines.push('');
        }
        if (b.doesNotHandle) {
          lines.push(`**Does Not Handle:** ${trimValue(b.doesNotHandle)}`);
          lines.push('');
        }
        if (b.collaboratesOn) {
          lines.push(`**Collaborates On:** ${trimValue(b.collaboratesOn)}`);
          lines.push('');
        }
      }
    }

    // Responsibilities section
    if (agent.responsibilities && agent.responsibilities.length > 0) {
      lines.push('## Responsibilities');
      lines.push('');
      for (const r of agent.responsibilities) {
        const priority = r.priority ? ` [${r.priority}]` : '';
        lines.push(`### ${r.title}${priority}`);
        lines.push('');
        if (r.description) {
          lines.push(trimValue(r.description));
          lines.push('');
        }
      }
    }

    // Receives Work From section (OC-S2-AGT-010: @agent-name references)
    if (
      agent.integrationProtocols &&
      agent.integrationProtocols.handoffFrom &&
      agent.integrationProtocols.handoffFrom.length > 0
    ) {
      lines.push('## Receives Work From');
      lines.push('');
      for (const h of agent.integrationProtocols.handoffFrom) {
        const agentRef = this._formatAgentRef(h.agent);
        lines.push(`- ${agentRef}: ${trimValue(h.context)}`);
      }
      lines.push('');
    }

    // Hands Off To section (OC-S2-AGT-010: @agent-name references)
    if (
      agent.integrationProtocols &&
      agent.integrationProtocols.handoffTo &&
      agent.integrationProtocols.handoffTo.length > 0
    ) {
      lines.push('## Hands Off To');
      lines.push('');
      for (const h of agent.integrationProtocols.handoffTo) {
        const agentRef = this._formatAgentRef(h.agent);
        const deliverables = trimValue(h.deliverables);
        lines.push(`- ${agentRef}: ${deliverables}`);
      }
      lines.push('');
    }

    // Delegation section (OC-S2-AGT-010: @agent-name references)
    if (agent.delegationCriteria) {
      lines.push('## Delegation');
      lines.push('');

      if (agent.delegationCriteria.whenToUse) {
        lines.push('**When to use this agent:**');
        for (const item of agent.delegationCriteria.whenToUse) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }

      if (agent.delegationCriteria.whenToDelegate) {
        lines.push('**Delegates to:**');
        lines.push('');
        for (const d of agent.delegationCriteria.whenToDelegate) {
          const agentRef = `@ensemble-${d.agent}`;
          lines.push(`- ${agentRef}:`);
          if (d.triggers) {
            for (const trigger of d.triggers) {
              lines.push(`  - ${trigger}`);
            }
          }
        }
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd() + '\n';
  }

  /**
   * Format an agent name as an @ensemble- reference.
   * Some YAML handoff entries use descriptive names like "Context Required"
   * rather than actual agent names. We detect those and leave them as-is.
   * @param {string} agentName
   * @returns {string}
   */
  _formatAgentRef(agentName) {
    if (!agentName) return 'unknown';
    // Heuristic: real agent names are lowercase-with-hyphens
    // Descriptive labels contain spaces or are capitalized words
    const isRealAgent = /^[a-z][a-z0-9-]*$/.test(agentName);
    if (isRealAgent) {
      return `@ensemble-${agentName}`;
    }
    return agentName;
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-004: Agent mode classification
  // -------------------------------------------------------------------------

  /**
   * Classify agent mode based on category.
   * @param {string|undefined} category
   * @returns {"primary"|"subagent"}
   */
  classifyMode(category) {
    if (category === 'orchestrator') return 'primary';
    return 'subagent';
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-005: Model hint translation
  // -------------------------------------------------------------------------

  /**
   * Map an Ensemble model hint to OpenCode providerID/modelID format.
   * @param {string|undefined|null} hint - Model hint
   * @returns {{ providerID: string, modelID: string }}
   */
  mapModelHint(hint) {
    if (!hint) return { ...DEFAULT_MODEL };
    const mapped = MODEL_MAP[hint];
    return mapped ? { ...mapped } : { ...DEFAULT_MODEL };
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-006: Generate JSON config entries
  // -------------------------------------------------------------------------

  /**
   * Generate a JSON config entry for the opencode.json agent block.
   * @param {object} agent - Parsed YAML agent object
   * @returns {object} Config entry keyed by ensemble-prefixed agent name
   */
  generateConfigEntry(agent) {
    const name = `ensemble-${agent.metadata.name}`;
    const category = this.classifyCategory(agent.metadata.category);
    const mode = this.classifyMode(agent.metadata.category);
    const model = this.mapModelHint(agent.metadata.model);
    const permission = this.mapToolPermissions(agent.metadata.tools);
    const prompt = this.generatePrompt(agent);

    const entry = {
      name,
      description: trimValue(agent.metadata.description),
      mode,
      model,
      permission,
      prompt,
      metadata: {
        category,
      },
    };

    return { [name]: entry };
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-007: Generate Markdown agent files
  // -------------------------------------------------------------------------

  /**
   * Generate OpenCode Markdown agent file content.
   * @param {object} agent - Parsed YAML agent object
   * @returns {string} Markdown content
   */
  generateMarkdown(agent) {
    const lines = [];
    const title = toTitleCase(agent.metadata.name);
    const mode = this.classifyMode(agent.metadata.category);
    const category = this.classifyCategory(agent.metadata.category);

    // Heading
    lines.push(`# ${title}`);
    lines.push('');

    // Description
    if (agent.metadata.description) {
      lines.push(trimValue(agent.metadata.description));
      lines.push('');
    }

    // Mode and category annotations
    lines.push(`**Mode:** ${mode}`);
    lines.push(`**Category:** ${category}`);
    lines.push('');

    // Full prompt content (mission, responsibilities, boundaries, etc.)
    const prompt = this.generatePrompt(agent);
    lines.push(prompt);

    return lines
      .map((line) => line.trimEnd())
      .join('\n')
      .trimEnd()
      .concat('\n');
  }

  /**
   * Get the output file path for a parsed agent.
   * @param {object} agent - Parsed YAML agent object
   * @returns {string} Output .md file path
   */
  getOutputPath(agent) {
    return path.join(this.outputDir, `${agent.metadata.name}.md`);
  }

  /**
   * Write an agent Markdown file to disk.
   * @param {string} filePath - Output file path
   * @param {string} content - Markdown content
   */
  writeAgentFile(filePath, content) {
    if (this.dryRun) {
      if (this.verbose) {
        console.log(`[dry-run] Would write: ${filePath}`);
      }
      return;
    }
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    if (this.verbose) {
      console.log(`Written: ${filePath}`);
    }
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-008: Delegation hierarchy extraction
  // -------------------------------------------------------------------------

  /**
   * Extract delegation hierarchy from agent YAML data.
   * @param {object} agent - Parsed YAML agent object
   * @returns {{ delegatesTo: string[], receivesFrom: string[], handsOffTo: string[] }}
   */
  extractDelegationHierarchy(agent) {
    const delegatesTo = [];
    const receivesFrom = [];
    const handsOffTo = [];

    // Extract from delegationCriteria.whenToDelegate
    if (
      agent.delegationCriteria &&
      agent.delegationCriteria.whenToDelegate &&
      Array.isArray(agent.delegationCriteria.whenToDelegate)
    ) {
      for (const d of agent.delegationCriteria.whenToDelegate) {
        if (d.agent && !delegatesTo.includes(d.agent)) {
          delegatesTo.push(d.agent);
        }
      }
    }

    // Extract from integrationProtocols.handoffFrom
    if (
      agent.integrationProtocols &&
      agent.integrationProtocols.handoffFrom &&
      Array.isArray(agent.integrationProtocols.handoffFrom)
    ) {
      for (const h of agent.integrationProtocols.handoffFrom) {
        if (h.agent && this._isRealAgentName(h.agent) && !receivesFrom.includes(h.agent)) {
          receivesFrom.push(h.agent);
        }
      }
    }

    // Extract from integrationProtocols.handoffTo
    if (
      agent.integrationProtocols &&
      agent.integrationProtocols.handoffTo &&
      Array.isArray(agent.integrationProtocols.handoffTo)
    ) {
      for (const h of agent.integrationProtocols.handoffTo) {
        if (h.agent && this._isRealAgentName(h.agent) && !handsOffTo.includes(h.agent)) {
          handsOffTo.push(h.agent);
        }
      }
    }

    return { delegatesTo, receivesFrom, handsOffTo };
  }

  /**
   * Check if a string looks like a real agent name (lowercase-with-hyphens)
   * vs a descriptive label like "Context Required".
   * @param {string} name
   * @returns {boolean}
   */
  _isRealAgentName(name) {
    return /^[a-z][a-z0-9-]*$/.test(name);
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-009: Routing prompt for primary orchestrator
  // -------------------------------------------------------------------------

  /**
   * Generate a comprehensive routing prompt that lists all agents
   * and when to delegate to each.
   * @param {object[]} agents - Array of parsed agent YAML objects
   * @returns {string} Routing prompt string
   */
  generateRoutingPrompt(agents) {
    const lines = [];

    lines.push('## Agent Delegation Map');
    lines.push('');
    lines.push(
      'You have access to the following specialized agents. Use @agent-name to delegate tasks:'
    );
    lines.push('');

    // Group agents by category
    const groups = {};
    for (const agent of agents) {
      const category = this.classifyCategory(agent.metadata.category);
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(agent);
    }

    // Render groups in defined order
    for (const cat of CATEGORY_GROUP_ORDER) {
      const groupAgents = groups[cat];
      if (!groupAgents || groupAgents.length === 0) continue;

      const label = CATEGORY_GROUP_LABELS[cat] || toTitleCase(cat);
      lines.push(`### ${label}`);
      lines.push('');

      for (const agent of groupAgents) {
        const ref = `@ensemble-${agent.metadata.name}`;
        const desc = trimValue(agent.metadata.description);
        lines.push(`- ${ref}: ${desc}`);

        // Include delegation triggers if available
        if (
          agent.delegationCriteria &&
          agent.delegationCriteria.whenToUse &&
          agent.delegationCriteria.whenToUse.length > 0
        ) {
          lines.push(`  - **When to delegate:** ${agent.delegationCriteria.whenToUse[0]}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
  }

  // -------------------------------------------------------------------------
  // OC-S2-AGT-011: Category metadata tags
  // -------------------------------------------------------------------------

  /**
   * Classify an agent category, defaulting to 'utility' for unknown values.
   * @param {string|undefined} category
   * @returns {string}
   */
  classifyCategory(category) {
    if (!category) return 'utility';
    if (KNOWN_CATEGORIES.has(category)) return category;
    return 'utility';
  }

  // -------------------------------------------------------------------------
  // Full pipeline execution
  // -------------------------------------------------------------------------

  /**
   * Execute the full translation pipeline synchronously.
   * @returns {object} AgentTranslatorResult
   */
  executeSync() {
    const errors = [];
    const translatedAgents = [];
    const configBlock = {};
    const parsedAgents = [];

    const files = this.discoverAgentFiles();

    for (const filePath of files) {
      try {
        const agent = this.parseAgentYaml(filePath);
        parsedAgents.push(agent);

        const markdownContent = this.generateMarkdown(agent);
        const outputPath = this.getOutputPath(agent);
        const configEntry = this.generateConfigEntry(agent);

        // Merge config entry into block
        Object.assign(configBlock, configEntry);

        translatedAgents.push({
          markdownPath: outputPath,
          markdownContent,
          configEntry,
          sourcePath: filePath,
        });

        // Write file unless dry-run
        this.writeAgentFile(outputPath, markdownContent);
      } catch (err) {
        errors.push({
          filePath,
          message: err.message,
          error: err,
        });
        if (this.verbose) {
          console.error(`Error translating ${filePath}: ${err.message}`);
        }
      }
    }

    // Generate routing prompt from all successfully parsed agents
    const routingPrompt = this.generateRoutingPrompt(parsedAgents);

    return {
      agents: translatedAgents,
      configBlock,
      routingPrompt,
      errors,
    };
  }
}

module.exports = { AgentTranslator };
