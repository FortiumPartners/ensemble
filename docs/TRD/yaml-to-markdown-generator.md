# Technical Requirements Document: YAML-to-Markdown Command Generator

| Field | Value |
|-------|-------|
| **TRD ID** | TRD-CORE-003 |
| **Feature** | YAML-to-Markdown Command Generator |
| **Plugin** | ensemble-core |
| **Version Target** | 5.1.0 |
| **Status** | Ready for Development |
| **Created** | 2025-12-19 |
| **Last Updated** | 2025-12-19 |
| **Author** | Fortium Partners |
| **Version** | 1.1 |
| **PRD Reference** | PRD-CORE-003 v1.1 |

---

## 1. Executive Summary

### 1.1 Technical Approach Overview

This TRD defines the technical implementation for an automated YAML-to-Markdown generator that transforms structured YAML files (commands and agents) into Claude Code-compatible Markdown files. The system will use a modular architecture with separate concerns for parsing, validation, transformation, and file I/O.

**Core Technical Decisions:**
- **Language**: Node.js (>=20.0.0) to align with existing ensemble tooling
- **YAML Parser**: js-yaml (already in dependencies)
- **Schema Validation**: ajv with ajv-formats (already in dependencies)
- **Template Engine**: Custom transformer functions (no external templating library needed)
- **CLI Framework**: Commander.js for argument parsing
- **File Watching**: chokidar for watch mode
- **Testing**: Jest (already in ecosystem)

### 1.2 Key Architectural Decisions

| Decision Area | Choice | Rationale |
|---------------|--------|-----------|
| **File Discovery** | Plugin manifest-based (plugin.json) | Respects plugin architecture, processes only active files |
| **Schema Validation** | JSON Schema with ajv | Reuses existing validation infrastructure |
| **Error Strategy** | Collect-all-errors (default) with --fail-fast option | Better DX by default; CI can use --fail-fast |
| **Transformation** | Separate transformers per type | Maintainable, testable, follows SRP |
| **Output Strategy** | In-place generation with "DO NOT EDIT" header | Simple, predictable, clear attribution |
| **Cleanup Strategy** | Automatic orphan removal with safety check | Only removes files with "DO NOT EDIT" header |

### 1.3 Technology Stack

```
Runtime:       Node.js >=20.0.0
Dependencies:  js-yaml ^4.1.0, ajv ^8.12.0, ajv-formats ^3.0.1, commander ^11.0.0, chokidar ^3.5.3
DevDependencies: jest ^29.7.0
Testing:       Jest with >90% coverage target
CI/CD:         GitHub Actions integration
```

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI Entry Point                          │
│                    (generate-markdown.js)                        │
│  - Argument parsing (Commander.js)                              │
│  - Mode selection (all/commands/agents/single file)             │
│  - Orchestration of generation pipeline                         │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│                      File Discovery Module                       │
│                   (lib/file-discovery.js)                       │
│  - Scan packages/*/.claude-plugin/plugin.json                   │
│  - Extract agents/commands directory paths                      │
│  - Discover *.yaml files in specified directories               │
│  - Return list of YAML files to process                         │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│                      Processing Pipeline                         │
│              (for each discovered YAML file)                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. YAML Parser (lib/yaml-parser.js)                      │  │
│  │    - Read file from disk                                 │  │
│  │    - Parse YAML with js-yaml                             │  │
│  │    - Detect type (command vs agent)                      │  │
│  │    - Error: ValidationError on parse failure             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           v                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 2. Schema Validator (lib/schema-validator.js)            │  │
│  │    - Load appropriate schema (command/agent)             │  │
│  │    - Validate with ajv                                   │  │
│  │    - Validate cross-references (delegation agents)       │  │
│  │    - Validate step numbering (no gaps)                   │  │
│  │    - Error: ValidationError with details                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           v                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 3. Markdown Generator (lib/markdown-generator.js)        │  │
│  │    - Route to command-transformer or agent-transformer   │  │
│  │    - Generate frontmatter                                │  │
│  │    - Generate body sections                              │  │
│  │    - Add "DO NOT EDIT" header                            │  │
│  │    - Return Markdown string                              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           v                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 4. File Writer (lib/file-utils.js)                       │  │
│  │    - Determine output path (same dir as YAML)            │  │
│  │    - Atomic write (temp file + rename)                   │  │
│  │    - Track generated files                               │  │
│  │    - Error: GenerationError on write failure             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│                      Orphan Cleanup Module                       │
│                   (lib/orphan-cleanup.js)                       │
│  - Scan agent/command directories for *.md files                │
│  - Check for "DO NOT EDIT" header in each file                  │
│  - Compare against generated file set                           │
│  - Remove orphans not in generated set (only if has header)     │
│  - Log all deletions                                            │
└─────────────────────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│                      Error Reporter                              │
│                   (lib/error-handler.js)                        │
│  - Collect all errors from pipeline                            │
│  - Format errors with file, field, message                     │
│  - Print summary of all errors                                 │
│  - Exit with code 1 if any errors, 0 if success                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Module Breakdown

| Module | Responsibility | Inputs | Outputs | Error Handling |
|--------|---------------|--------|---------|----------------|
| **file-discovery.js** | Discover YAML files via plugin.json | packages/ directory | List of YAML file paths | Warn on missing paths |
| **yaml-parser.js** | Parse YAML files | YAML file path | Parsed object + type | ValidationError |
| **schema-validator.js** | Validate against schemas | Parsed YAML, type | Validated object | ValidationError[] |
| **command-transformer.js** | Transform command YAML → MD | Command YAML object | Markdown string | GenerationError |
| **agent-transformer.js** | Transform agent YAML → MD | Agent YAML object | Markdown string | GenerationError |
| **markdown-generator.js** | Route to transformers | Parsed YAML, type | Markdown string | GenerationError |
| **file-utils.js** | Read/write files atomically | Path, content | Success boolean | IOError |
| **orphan-cleanup.js** | Remove orphaned MD files (with header check) | Generated file set, directories | Deleted file list | CleanupError |
| **error-handler.js** | Collect and report errors | Error array | Formatted output | N/A (terminal) |

### 2.3 Data Flow Diagram

```
[Plugin Manifests] → [File Discovery] → [YAML Files List]
                                              │
                                              v
                                    ┌─────────────────┐
                                    │  Process Each   │
                                    │   YAML File     │
                                    └─────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    v                         v                         v
            [Parse YAML]              [Validate Schema]        [Generate Markdown]
                    │                         │                         │
                    v                         v                         v
            [Parsed Object]          [Validation Errors]        [MD String]
                    │                         │                         │
                    └─────────────────────────┴─────────────────────────┘
                                              │
                                              v
                                    ┌─────────────────┐
                                    │ Collect Errors  │
                                    │  or Write File  │
                                    └─────────────────┘
                                              │
                                              v
                                    [Generated Files Set]
                                              │
                                              v
                                    [Orphan Cleanup]
                                              │
                                              v
                                    [Error Summary Report]
```

---

## 3. Detailed Design

### 3.1 YAML Parser Module

**File**: `scripts/lib/yaml-parser.js`

**Purpose**: Parse YAML files and detect their type (command vs agent).

**Exports**:
```javascript
/**
 * Parse a YAML file from disk
 * @param {string} filePath - Absolute path to YAML file
 * @returns {Promise<{type: 'command'|'agent', data: object}>}
 * @throws {ValidationError} If YAML syntax is invalid
 */
async function parseYamlFile(filePath)

/**
 * Detect YAML file type based on structure
 * @param {object} yamlData - Parsed YAML object
 * @returns {'command'|'agent'}
 * @throws {ValidationError} If type cannot be determined
 */
function detectYamlType(yamlData)
```

**Implementation Details**:
```javascript
const yaml = require('js-yaml');
const fs = require('fs').promises;
const { ValidationError } = require('./error-handler');

async function parseYamlFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const data = yaml.load(content);
    const type = detectYamlType(data);
    return { type, data };
  } catch (error) {
    if (error.name === 'YAMLException') {
      throw new ValidationError(filePath, 'YAML syntax', error.message);
    }
    throw error;
  }
}

function detectYamlType(yamlData) {
  // Commands have 'workflow' field
  if (yamlData.workflow) return 'command';

  // Agents have 'responsibilities' field
  if (yamlData.responsibilities) return 'agent';

  throw new ValidationError(
    'unknown',
    'type',
    'Cannot determine YAML type: missing workflow (command) or responsibilities (agent)'
  );
}

module.exports = { parseYamlFile, detectYamlType };
```

**Error Cases**:
- Invalid YAML syntax → ValidationError with line number
- Missing metadata section → ValidationError
- Cannot determine type → ValidationError

### 3.2 Schema Validator Module

**File**: `scripts/lib/schema-validator.js`

**Purpose**: Validate parsed YAML against JSON Schema, plus semantic validation.

**JSON Schemas**:
- `schemas/command-yaml-schema.json`
- `schemas/agent-yaml-schema.json`

**Exports**:
```javascript
/**
 * Validate command YAML against schema
 * @param {object} commandData - Parsed command YAML
 * @param {string} filePath - Original file path (for errors)
 * @param {Set<string>} agentNames - Set of all known agent names
 * @returns {void}
 * @throws {ValidationError[]} Array of validation errors
 */
function validateCommandSchema(commandData, filePath, agentNames)

/**
 * Validate agent YAML against schema
 * @param {object} agentData - Parsed agent YAML
 * @param {string} filePath - Original file path (for errors)
 * @returns {void}
 * @throws {ValidationError[]} Array of validation errors
 */
function validateAgentSchema(agentData, filePath)

/**
 * Build set of all agent names from discovered files
 * @param {string[]} agentYamlPaths - Paths to all agent YAML files
 * @returns {Promise<Set<string>>}
 */
async function buildAgentNameSet(agentYamlPaths)
```

**Implementation Details**:
```javascript
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { ValidationError } = require('./error-handler');
const path = require('path');
const fs = require('fs').promises;

// Initialize AJV
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Load schemas
const commandSchema = require('../../schemas/command-yaml-schema.json');
const agentSchema = require('../../schemas/agent-yaml-schema.json');

const validateCommandJsonSchema = ajv.compile(commandSchema);
const validateAgentJsonSchema = ajv.compile(agentSchema);

function validateCommandSchema(commandData, filePath, agentNames) {
  const errors = [];

  // 1. JSON Schema validation
  const valid = validateCommandJsonSchema(commandData);
  if (!valid) {
    validateCommandJsonSchema.errors.forEach(err => {
      errors.push(new ValidationError(
        filePath,
        err.instancePath || 'root',
        err.message
      ));
    });
  }

  // 2. Semantic validation: phase numbering
  if (commandData.workflow?.phases) {
    const phaseOrders = commandData.workflow.phases.map(p => p.order).sort((a, b) => a - b);
    for (let i = 0; i < phaseOrders.length; i++) {
      if (phaseOrders[i] !== i + 1) {
        errors.push(new ValidationError(
          filePath,
          'workflow.phases',
          `Phase numbering has gaps: expected ${i + 1}, found ${phaseOrders[i]}`
        ));
        break;
      }
    }
  }

  // 3. Semantic validation: step numbering
  if (commandData.workflow?.phases) {
    commandData.workflow.phases.forEach(phase => {
      const stepOrders = phase.steps?.map(s => s.order).sort((a, b) => a - b) || [];
      for (let i = 0; i < stepOrders.length; i++) {
        if (stepOrders[i] !== i + 1) {
          errors.push(new ValidationError(
            filePath,
            `workflow.phases[${phase.order}].steps`,
            `Step numbering has gaps: expected ${i + 1}, found ${stepOrders[i]}`
          ));
          break;
        }
      }
    });
  }

  // 4. Semantic validation: delegation references
  if (commandData.workflow?.phases) {
    commandData.workflow.phases.forEach(phase => {
      phase.steps?.forEach(step => {
        if (step.delegation?.agent) {
          if (!agentNames.has(step.delegation.agent)) {
            errors.push(new ValidationError(
              filePath,
              `workflow.phases[${phase.order}].steps[${step.order}].delegation.agent`,
              `Referenced agent '${step.delegation.agent}' not found in agent ecosystem`
            ));
          }
        }
      });
    });
  }

  if (errors.length > 0) {
    throw errors;
  }
}

function validateAgentSchema(agentData, filePath) {
  const errors = [];

  // JSON Schema validation
  const valid = validateAgentJsonSchema(agentData);
  if (!valid) {
    validateAgentJsonSchema.errors.forEach(err => {
      errors.push(new ValidationError(
        filePath,
        err.instancePath || 'root',
        err.message
      ));
    });
  }

  if (errors.length > 0) {
    throw errors;
  }
}

async function buildAgentNameSet(agentYamlPaths) {
  const agentNames = new Set();

  for (const yamlPath of agentYamlPaths) {
    try {
      const content = await fs.readFile(yamlPath, 'utf8');
      const yaml = require('js-yaml');
      const data = yaml.load(content);
      if (data.metadata?.name) {
        agentNames.add(data.metadata.name);
      }
    } catch (error) {
      // Skip files that can't be parsed (will be caught in main validation)
    }
  }

  return agentNames;
}

module.exports = {
  validateCommandSchema,
  validateAgentSchema,
  buildAgentNameSet
};
```

**Validation Rules**:

1. **JSON Schema Validation** (both types):
   - Required fields present
   - Field types correct
   - Enum values valid (category, priority)
   - Semantic version format
   - ISO 8601 date format
   - Valid tool names
   - Model validation (if specified): must be opus, sonnet, or haiku

2. **Phase Numbering Validation** (commands only):
   - Phases must be numbered sequentially starting from 1
   - No gaps allowed (e.g., 1,2,4 is invalid)

3. **Step Numbering Validation** (commands only):
   - Steps must be numbered sequentially starting from 1
   - No gaps allowed (e.g., 1,2,4 is invalid)
   - Each phase validated independently

4. **Delegation Reference Validation** (commands only):
   - Referenced agent names must exist in agent ecosystem
   - Cross-plugin references are allowed
   - Case-sensitive matching

### 3.3 Command Transformer Module

**File**: `scripts/lib/command-transformer.js`

**Purpose**: Transform validated command YAML into Markdown.

**Exports**:
```javascript
/**
 * Transform command YAML to Markdown
 * @param {object} commandData - Validated command YAML
 * @param {string} sourceYamlPath - Path to source YAML (for header)
 * @returns {string} Generated Markdown
 */
function transformCommandToMarkdown(commandData, sourceYamlPath)
```

**Implementation Details**:
```javascript
const path = require('path');

function transformCommandToMarkdown(commandData, sourceYamlPath) {
  const parts = [];

  // 1. Frontmatter
  parts.push(generateCommandFrontmatter(commandData));

  // 2. DO NOT EDIT header
  const relativeYamlPath = path.basename(sourceYamlPath);
  parts.push(generateDoNotEditHeader(relativeYamlPath));

  // 3. Mission summary (before sections)
  if (commandData.mission?.summary) {
    parts.push(commandData.mission.summary.trim());
    parts.push('');
  }

  // 4. Mission section
  parts.push('## Mission');
  parts.push('');
  if (commandData.mission?.summary) {
    parts.push(commandData.mission.summary.trim());
  }
  parts.push('');

  // 5. Workflow section
  if (commandData.workflow?.phases) {
    parts.push('## Workflow');
    parts.push('');
    commandData.workflow.phases
      .sort((a, b) => a.order - b.order)
      .forEach(phase => {
        parts.push(`### ${phase.order}. ${phase.name}`);
        parts.push('');

        if (phase.steps) {
          phase.steps
            .sort((a, b) => a.order - b.order)
            .forEach(step => {
              parts.push(`**${step.order}. ${step.title}**`);
              if (step.description) {
                parts.push(step.description);
              }
              parts.push('');

              if (step.actions && step.actions.length > 0) {
                step.actions.forEach(action => {
                  parts.push(`- ${action}`);
                });
                parts.push('');
              }

              if (step.delegation) {
                parts.push(`**Delegation:** @${step.delegation.agent}`);
                if (step.delegation.context) {
                  parts.push(step.delegation.context);
                }
                parts.push('');
              }
            });
        }
      });
  }

  // 6. Expected Output section
  if (commandData.expectedOutput) {
    parts.push('## Expected Output');
    parts.push('');
    if (commandData.expectedOutput.format) {
      parts.push(`**Format:** ${commandData.expectedOutput.format}`);
      parts.push('');
    }

    if (commandData.expectedOutput.structure) {
      parts.push('**Structure:**');
      commandData.expectedOutput.structure.forEach(item => {
        parts.push(`- **${item.name}**: ${item.description}`);
      });
      parts.push('');
    }
  }

  // 7. Usage section
  parts.push('## Usage');
  parts.push('');
  parts.push('```');
  parts.push(`/ensemble:${commandData.metadata.name} [arguments]`);
  parts.push('```');
  parts.push('');

  return parts.join('\n');
}

function generateCommandFrontmatter(commandData) {
  const frontmatter = [];
  frontmatter.push('---');
  frontmatter.push(`name: ensemble:${commandData.metadata.name}`);
  frontmatter.push(`description: ${commandData.metadata.description}`);

  // allowed-tools (hyphenated for commands)
  if (commandData.metadata.allowed_tools) {
    const tools = commandData.metadata.allowed_tools.join(', ');
    frontmatter.push(`allowed-tools: [${tools}]`);
  } else {
    // Default tools for commands
    frontmatter.push('allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]');
  }

  // argument-hint (optional, derived from description)
  if (commandData.metadata.argument_hint) {
    frontmatter.push(`argument-hint: ${commandData.metadata.argument_hint}`);
  }

  // model (optional)
  if (commandData.metadata.model) {
    frontmatter.push(`model: ${commandData.metadata.model}`);
  }

  frontmatter.push('---');
  frontmatter.push('');

  return frontmatter.join('\n');
}

function generateDoNotEditHeader(sourceFileName) {
  return [
    '<!--',
    'DO NOT EDIT THIS FILE DIRECTLY',
    `This file is auto-generated from ${sourceFileName}`,
    'Any manual edits will be overwritten on next generation.',
    'Edit the YAML source file instead.',
    '-->',
    ''
  ].join('\n');
}

module.exports = { transformCommandToMarkdown };
```

**Markdown Structure**:
```
---
[frontmatter]
---

<!-- DO NOT EDIT warning -->

[mission.summary]

## Mission
[mission details]

## Workflow
### 1. [phase.name]
**1. [step.title]**
[step.description]
- [actions]
**Delegation:** @agent-name

## Expected Output
**Format:** [format]
**Structure:**
- [items]

## Usage
```
/ensemble:command-name [args]
```
```

### 3.4 Agent Transformer Module

**File**: `scripts/lib/agent-transformer.js`

**Purpose**: Transform validated agent YAML into Markdown.

**Exports**:
```javascript
/**
 * Transform agent YAML to Markdown
 * @param {object} agentData - Validated agent YAML
 * @param {string} sourceYamlPath - Path to source YAML (for header)
 * @returns {string} Generated Markdown
 */
function transformAgentToMarkdown(agentData, sourceYamlPath)
```

**Implementation Details**:
```javascript
const path = require('path');

function transformAgentToMarkdown(agentData, sourceYamlPath) {
  const parts = [];

  // 1. Frontmatter
  parts.push(generateAgentFrontmatter(agentData));

  // 2. DO NOT EDIT header
  const relativeYamlPath = path.basename(sourceYamlPath);
  parts.push(generateDoNotEditHeader(relativeYamlPath));

  // 3. Mission section
  parts.push('## Mission');
  parts.push('');
  if (agentData.mission?.summary) {
    parts.push(agentData.mission.summary.trim());
  }
  parts.push('');

  // 4. Boundaries section (if present)
  if (agentData.mission?.boundaries) {
    parts.push('## Boundaries');
    parts.push('');

    if (agentData.mission.boundaries.handles) {
      parts.push(`**Handles:** ${agentData.mission.boundaries.handles.trim()}`);
      parts.push('');
    }

    if (agentData.mission.boundaries.doesNotHandle) {
      parts.push(`**Does Not Handle:** ${agentData.mission.boundaries.doesNotHandle.trim()}`);
      parts.push('');
    }

    if (agentData.mission.boundaries.collaboratesOn) {
      parts.push(`**Collaborates On:** ${agentData.mission.boundaries.collaboratesOn.trim()}`);
      parts.push('');
    }
  }

  // 5. Expertise section (if present)
  if (agentData.mission?.expertise) {
    parts.push('## Expertise');
    parts.push('');
    agentData.mission.expertise.forEach(exp => {
      parts.push(`### ${exp.name}`);
      parts.push(exp.description.trim());
      parts.push('');
    });
  }

  // 6. Responsibilities section
  if (agentData.responsibilities) {
    parts.push('## Responsibilities');
    parts.push('');

    // Group by priority
    const byPriority = {
      high: [],
      medium: [],
      low: []
    };

    agentData.responsibilities.forEach(resp => {
      byPriority[resp.priority].push(resp);
    });

    ['high', 'medium', 'low'].forEach(priority => {
      if (byPriority[priority].length > 0) {
        parts.push(`### ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`);
        parts.push('');

        byPriority[priority].forEach(resp => {
          parts.push(`#### ${resp.title}`);
          parts.push(resp.description.trim());
          parts.push('');
        });
      }
    });
  }

  // 7. Examples section (if present)
  if (agentData.examples) {
    parts.push('## Examples');
    parts.push('');

    agentData.examples.forEach(example => {
      parts.push(`### ${example.title}`);
      parts.push('');

      if (example.antiPattern) {
        parts.push('**Anti-Pattern:**');
        parts.push('```' + example.antiPattern.language);
        parts.push(example.antiPattern.code.trim());
        parts.push('```');
        parts.push('');

        if (example.antiPattern.issues) {
          parts.push('**Issues:**');
          example.antiPattern.issues.forEach(issue => {
            parts.push(`- ${issue}`);
          });
          parts.push('');
        }
      }

      if (example.bestPractice) {
        parts.push('**Best Practice:**');
        parts.push('```' + example.bestPractice.language);
        parts.push(example.bestPractice.code.trim());
        parts.push('```');
        parts.push('');

        if (example.bestPractice.benefits) {
          parts.push('**Benefits:**');
          example.bestPractice.benefits.forEach(benefit => {
            parts.push(`- ${benefit}`);
          });
          parts.push('');
        }
      }
    });
  }

  // 8. Quality Standards section (if present)
  if (agentData.qualityStandards) {
    parts.push('## Quality Standards');
    parts.push('');

    if (agentData.qualityStandards.codeQuality) {
      parts.push('### Code Quality');
      parts.push('');
      agentData.qualityStandards.codeQuality.forEach(standard => {
        parts.push(`**${standard.name}** (${standard.enforcement})`);
        parts.push(standard.description.trim());
        parts.push('');
      });
    }

    if (agentData.qualityStandards.testing) {
      parts.push('### Testing');
      parts.push('');
      Object.entries(agentData.qualityStandards.testing).forEach(([key, value]) => {
        parts.push(`**${key}:** ${value.minimum}% - ${value.description}`);
        parts.push('');
      });
    }

    if (agentData.qualityStandards.performance) {
      parts.push('### Performance');
      parts.push('');
      agentData.qualityStandards.performance.forEach(metric => {
        parts.push(`**${metric.name}:** ${metric.target}${metric.unit}`);
        parts.push(metric.description.trim());
        parts.push('');
      });
    }
  }

  // 9. Delegation Criteria section (if present)
  if (agentData.delegationCriteria) {
    parts.push('## Delegation Criteria');
    parts.push('');

    if (agentData.delegationCriteria.whenToUse) {
      parts.push('**When to Use:**');
      agentData.delegationCriteria.whenToUse.forEach(item => {
        parts.push(`- ${item}`);
      });
      parts.push('');
    }

    if (agentData.delegationCriteria.whenToDelegate) {
      parts.push('**When to Delegate:**');
      agentData.delegationCriteria.whenToDelegate.forEach(delegation => {
        parts.push(`**@${delegation.agent}:**`);
        delegation.triggers.forEach(trigger => {
          parts.push(`- ${trigger}`);
        });
        parts.push('');
      });
    }
  }

  return parts.join('\n');
}

function generateAgentFrontmatter(agentData) {
  const frontmatter = [];
  frontmatter.push('---');
  frontmatter.push(`name: ${agentData.metadata.name}`);
  frontmatter.push(`description: ${agentData.metadata.description}`);

  // tools (no hyphen for agents)
  if (agentData.metadata.tools) {
    const tools = agentData.metadata.tools.join(', ');
    frontmatter.push(`tools: [${tools}]`);
  }

  frontmatter.push('---');
  frontmatter.push('');

  return frontmatter.join('\n');
}

function generateDoNotEditHeader(sourceFileName) {
  return [
    '<!--',
    'DO NOT EDIT THIS FILE DIRECTLY',
    `This file is auto-generated from ${sourceFileName}`,
    'Any manual edits will be overwritten on next generation.',
    'Edit the YAML source file instead.',
    '-->',
    ''
  ].join('\n');
}

module.exports = { transformAgentToMarkdown };
```

### 3.5 Markdown Generator Module

**File**: `scripts/lib/markdown-generator.js`

**Purpose**: Route to appropriate transformer based on YAML type.

**Exports**:
```javascript
/**
 * Generate Markdown from validated YAML
 * @param {object} yamlData - Validated YAML object
 * @param {'command'|'agent'} type - YAML type
 * @param {string} sourceYamlPath - Source YAML file path
 * @returns {string} Generated Markdown
 * @throws {GenerationError}
 */
function generateMarkdown(yamlData, type, sourceYamlPath)
```

**Implementation Details**:
```javascript
const { transformCommandToMarkdown } = require('./command-transformer');
const { transformAgentToMarkdown } = require('./agent-transformer');
const { GenerationError } = require('./error-handler');

function generateMarkdown(yamlData, type, sourceYamlPath) {
  try {
    if (type === 'command') {
      return transformCommandToMarkdown(yamlData, sourceYamlPath);
    } else if (type === 'agent') {
      return transformAgentToMarkdown(yamlData, sourceYamlPath);
    } else {
      throw new GenerationError(
        sourceYamlPath,
        `Unknown YAML type: ${type}`
      );
    }
  } catch (error) {
    if (error instanceof GenerationError) {
      throw error;
    }
    throw new GenerationError(
      sourceYamlPath,
      `Markdown generation failed: ${error.message}`
    );
  }
}

module.exports = { generateMarkdown };
```

### 3.6 File Utilities Module

**File**: `scripts/lib/file-utils.js`

**Purpose**: Atomic file I/O operations.

**Exports**:
```javascript
/**
 * Write Markdown file atomically
 * @param {string} markdownPath - Output path for Markdown
 * @param {string} content - Markdown content
 * @returns {Promise<void>}
 * @throws {IOError}
 */
async function writeMarkdownFile(markdownPath, content)

/**
 * Determine output path for Markdown from YAML path
 * @param {string} yamlPath - Source YAML path
 * @param {object} yamlData - Parsed YAML (may have output_path override)
 * @returns {string} Output Markdown path
 */
function getMarkdownPath(yamlPath, yamlData)
```

**Implementation Details**:
```javascript
const fs = require('fs').promises;
const path = require('path');
const { IOError } = require('./error-handler');

async function writeMarkdownFile(markdownPath, content) {
  try {
    // Atomic write: write to temp file, then rename
    const tempPath = `${markdownPath}.tmp`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, markdownPath);
  } catch (error) {
    throw new IOError(markdownPath, `Failed to write file: ${error.message}`);
  }
}

function getMarkdownPath(yamlPath, yamlData) {
  // Check for output_path override
  if (yamlData.metadata?.output_path) {
    const repoRoot = path.resolve(__dirname, '../..');
    return path.join(repoRoot, yamlData.metadata.output_path);
  }

  // Default: same directory, .md extension
  const dir = path.dirname(yamlPath);
  const basename = path.basename(yamlPath, '.yaml');
  return path.join(dir, `${basename}.md`);
}

module.exports = {
  writeMarkdownFile,
  getMarkdownPath
};
```

### 3.7 Orphan Cleanup Module

**File**: `scripts/lib/orphan-cleanup.js`

**Purpose**: Remove Markdown files without corresponding YAML sources.

**Exports**:
```javascript
/**
 * Clean up orphaned Markdown files
 * @param {Set<string>} generatedMarkdownPaths - Set of generated MD paths
 * @param {string[]} agentDirectories - Directories with agents
 * @param {string[]} commandDirectories - Directories with commands
 * @param {boolean} dryRun - If true, only log what would be deleted
 * @returns {Promise<string[]>} Array of deleted file paths
 * @throws {CleanupError}
 */
async function cleanupOrphanedMarkdown(
  generatedMarkdownPaths,
  agentDirectories,
  commandDirectories,
  dryRun = false
)
```

**Implementation Details**:
```javascript
const fs = require('fs').promises;
const path = require('path');
const { CleanupError } = require('./error-handler');

async function cleanupOrphanedMarkdown(
  generatedMarkdownPaths,
  agentDirectories,
  commandDirectories,
  dryRun = false
) {
  const deletedFiles = [];
  const allDirectories = [...agentDirectories, ...commandDirectories];

  for (const directory of allDirectories) {
    try {
      const files = await fs.readdir(directory);
      const markdownFiles = files.filter(f => f.endsWith('.md'));

      for (const mdFile of markdownFiles) {
        const fullPath = path.join(directory, mdFile);

        // Check if this Markdown file was generated
        if (!generatedMarkdownPaths.has(fullPath)) {
          // Safety check: only delete files with "DO NOT EDIT" header
          const content = await fs.readFile(fullPath, 'utf8');
          const hasDoNotEditHeader = content.includes('<!-- DO NOT EDIT');

          if (!hasDoNotEditHeader) {
            console.log(`Skipping orphan (no "DO NOT EDIT" header): ${fullPath}`);
            continue;
          }

          console.warn(`Orphan detected: ${fullPath} (no corresponding YAML source)`);

          if (!dryRun) {
            await fs.unlink(fullPath);
            console.log(`Removed: ${fullPath}`);
          } else {
            console.log(`[DRY RUN] Would remove: ${fullPath}`);
          }

          deletedFiles.push(fullPath);
        }
      }
    } catch (error) {
      throw new CleanupError(
        directory,
        `Failed to clean directory: ${error.message}`
      );
    }
  }

  return deletedFiles;
}

module.exports = { cleanupOrphanedMarkdown };
```

### 3.8 File Discovery Module

**File**: `scripts/lib/file-discovery.js`

**Purpose**: Discover YAML files from plugin manifests.

**Exports**:
```javascript
/**
 * Discover all YAML files from plugin manifests
 * @param {string} packagesDir - Path to packages directory
 * @returns {Promise<{agentPaths: string[], commandPaths: string[]}>}
 */
async function discoverYamlFiles(packagesDir)
```

**Implementation Details**:
```javascript
const fs = require('fs').promises;
const path = require('path');

async function discoverYamlFiles(packagesDir) {
  const agentPaths = [];
  const commandPaths = [];

  // Get all package directories
  const packageDirs = await fs.readdir(packagesDir);

  for (const pkg of packageDirs) {
    const pkgPath = path.join(packagesDir, pkg);
    const stat = await fs.stat(pkgPath);

    if (!stat.isDirectory()) continue;

    // Check for plugin.json
    const pluginJsonPath = path.join(pkgPath, '.claude-plugin', 'plugin.json');

    try {
      const pluginJson = JSON.parse(await fs.readFile(pluginJsonPath, 'utf8'));

      // Discover agents
      if (pluginJson.agents) {
        const agentsDir = path.join(pkgPath, pluginJson.agents);
        try {
          const agentFiles = await fs.readdir(agentsDir);
          agentFiles
            .filter(f => f.endsWith('.yaml'))
            .forEach(f => agentPaths.push(path.join(agentsDir, f)));
        } catch (error) {
          console.warn(`Warning: agents directory not found for ${pkg}: ${agentsDir}`);
        }
      }

      // Discover commands
      if (pluginJson.commands) {
        const commandsDir = path.join(pkgPath, pluginJson.commands);
        try {
          const commandFiles = await fs.readdir(commandsDir);
          commandFiles
            .filter(f => f.endsWith('.yaml'))
            .forEach(f => commandPaths.push(path.join(commandsDir, f)));
        } catch (error) {
          console.warn(`Warning: commands directory not found for ${pkg}: ${commandsDir}`);
        }
      }
    } catch (error) {
      // No plugin.json or invalid JSON - skip this package
      continue;
    }
  }

  return { agentPaths, commandPaths };
}

module.exports = { discoverYamlFiles };
```

### 3.9 Error Handler Module

**File**: `scripts/lib/error-handler.js`

**Purpose**: Custom error types and error reporting.

**Exports**:
```javascript
class ValidationError extends Error
class GenerationError extends Error
class IOError extends Error
class CleanupError extends Error

/**
 * Format and print error summary
 * @param {Error[]} errors - Array of errors
 * @returns {void}
 */
function printErrorSummary(errors)
```

**Implementation Details**:
```javascript
class ValidationError extends Error {
  constructor(file, field, message) {
    super(`${file}: ${field} - ${message}`);
    this.name = 'ValidationError';
    this.file = file;
    this.field = field;
  }
}

class GenerationError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'GenerationError';
    this.file = file;
  }
}

class IOError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'IOError';
    this.file = file;
  }
}

class CleanupError extends Error {
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.name = 'CleanupError';
    this.file = file;
  }
}

function printErrorSummary(errors) {
  console.error('\n=== Generation Errors Summary ===\n');

  // Group errors by type
  const byType = {
    ValidationError: [],
    GenerationError: [],
    IOError: [],
    CleanupError: [],
    Other: []
  };

  errors.forEach(error => {
    const type = error.name || 'Other';
    if (byType[type]) {
      byType[type].push(error);
    } else {
      byType.Other.push(error);
    }
  });

  // Print by type
  Object.entries(byType).forEach(([type, typeErrors]) => {
    if (typeErrors.length > 0) {
      console.error(`\n${type}s (${typeErrors.length}):`);
      typeErrors.forEach(error => {
        console.error(`  ❌ ${error.message}`);
      });
    }
  });

  console.error(`\nTotal errors: ${errors.length}`);
}

module.exports = {
  ValidationError,
  GenerationError,
  IOError,
  CleanupError,
  printErrorSummary
};
```

### 3.10 CLI Entry Point

**File**: `scripts/generate-markdown.js`

**Purpose**: Main CLI entry point with argument parsing.

**Implementation Details**:
```javascript
#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const { discoverYamlFiles } = require('./lib/file-discovery');
const { parseYamlFile } = require('./lib/yaml-parser');
const { validateCommandSchema, validateAgentSchema, buildAgentNameSet } = require('./lib/schema-validator');
const { generateMarkdown } = require('./lib/markdown-generator');
const { writeMarkdownFile, getMarkdownPath } = require('./lib/file-utils');
const { cleanupOrphanedMarkdown } = require('./lib/orphan-cleanup');
const { printErrorSummary } = require('./lib/error-handler');

const program = new Command();

program
  .name('generate-markdown')
  .description('Generate Markdown files from YAML command and agent definitions')
  .version('1.0.0')
  .option('-t, --type <type>', 'Generate only commands or agents (all|commands|agents)', 'all')
  .option('-f, --file <path>', 'Generate only specified file')
  .option('-v, --validate', 'Run validation only, no generation')
  .option('--verbose', 'Verbose output')
  .option('--dry-run', 'Show what would be generated without writing files')
  .option('--fail-fast', 'Exit immediately on first error (useful for CI)')
  .parse(process.argv);

const options = program.opts();

async function main() {
  console.log('Ensemble Markdown Generator');
  console.log('===========================\n');

  const repoRoot = path.resolve(__dirname, '..');
  const packagesDir = path.join(repoRoot, 'packages');

  const errors = [];
  const generatedFiles = new Set();

  try {
    // Discover YAML files
    let agentPaths = [];
    let commandPaths = [];

    if (options.file) {
      // Single file mode
      const filePath = path.resolve(options.file);
      const { type } = await parseYamlFile(filePath);
      if (type === 'agent') {
        agentPaths = [filePath];
      } else {
        commandPaths = [filePath];
      }
    } else {
      // Full discovery mode
      const discovered = await discoverYamlFiles(packagesDir);
      agentPaths = discovered.agentPaths;
      commandPaths = discovered.commandPaths;

      // Filter by type if specified
      if (options.type === 'commands') {
        agentPaths = [];
      } else if (options.type === 'agents') {
        commandPaths = [];
      }
    }

    console.log(`Found ${agentPaths.length} agent files`);
    console.log(`Found ${commandPaths.length} command files\n`);

    // Build agent name set for delegation validation
    const agentNames = await buildAgentNameSet(agentPaths);
    if (options.verbose) {
      console.log(`Known agents: ${Array.from(agentNames).join(', ')}\n`);
    }

    // Process all files
    const allPaths = [...agentPaths, ...commandPaths];

    for (const yamlPath of allPaths) {
      try {
        if (options.verbose) {
          console.log(`Processing: ${yamlPath}`);
        }

        // Parse
        const { type, data } = await parseYamlFile(yamlPath);

        // Validate
        if (type === 'command') {
          validateCommandSchema(data, yamlPath, agentNames);
        } else {
          validateAgentSchema(data, yamlPath);
        }

        if (options.validate) {
          console.log(`  ✓ Valid: ${path.basename(yamlPath)}`);
          continue; // Validation only, skip generation
        }

        // Generate Markdown
        const markdown = generateMarkdown(data, type, yamlPath);

        // Determine output path
        const markdownPath = getMarkdownPath(yamlPath, data);

        // Write file
        if (!options.dryRun) {
          await writeMarkdownFile(markdownPath, markdown);
          console.log(`  ✓ Generated: ${path.basename(markdownPath)}`);
        } else {
          console.log(`  [DRY RUN] Would generate: ${path.basename(markdownPath)}`);
        }

        generatedFiles.add(markdownPath);

      } catch (error) {
        // Collect errors (may be array from validation)
        if (Array.isArray(error)) {
          errors.push(...error);
        } else {
          errors.push(error);
        }

        // Fail fast if requested
        if (options.failFast) {
          printErrorSummary(errors);
          process.exit(1);
        }
      }
    }

    // Cleanup orphaned Markdown files
    if (!options.validate && !options.file) {
      console.log('\nCleaning up orphaned Markdown files...');
      const agentDirs = [...new Set(agentPaths.map(p => path.dirname(p)))];
      const commandDirs = [...new Set(commandPaths.map(p => path.dirname(p)))];

      try {
        const deleted = await cleanupOrphanedMarkdown(
          generatedFiles,
          agentDirs,
          commandDirs,
          options.dryRun
        );

        if (deleted.length > 0) {
          console.log(`Cleaned up ${deleted.length} orphaned file(s)`);
        }
      } catch (error) {
        errors.push(error);
      }
    }

    // Report results
    if (errors.length > 0) {
      printErrorSummary(errors);
      process.exit(1);
    }

    console.log('\n✓ Generation completed successfully');
    if (!options.dryRun && !options.validate) {
      console.log(`Generated ${generatedFiles.size} Markdown file(s)`);
    }

  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
```

### 3.11 Watch Mode Script

**File**: `scripts/generate-markdown-watch.js`

**Purpose**: Watch YAML files and auto-regenerate on changes with debouncing (500ms) to handle rapid successive edits.

**Implementation Details**:
```javascript
#!/usr/bin/env node

const chokidar = require('chokidar');
const { execSync } = require('child_process');
const path = require('path');

const packagesDir = path.resolve(__dirname, '../packages');
const DEBOUNCE_MS = 500; // 500ms debounce

console.log('Ensemble Markdown Generator - Watch Mode');
console.log('========================================\n');
console.log('Watching for YAML file changes...\n');

// Debounce timers keyed by file path
const debounceTimers = new Map();

function debounceGenerate(filePath, action) {
  // Clear existing timer for this file
  if (debounceTimers.has(filePath)) {
    clearTimeout(debounceTimers.get(filePath));
  }

  // Set new timer
  const timer = setTimeout(() => {
    console.log(`\n[${new Date().toLocaleTimeString()}] ${action}: ${filePath}`);
    try {
      execSync(`node scripts/generate-markdown.js --file ${filePath}`, {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
      });
    } catch (error) {
      console.error('Generation failed');
    }
    debounceTimers.delete(filePath);
  }, DEBOUNCE_MS);

  debounceTimers.set(filePath, timer);
}

const watcher = chokidar.watch(
  ['packages/**/agents/*.yaml', 'packages/**/commands/*.yaml'],
  {
    cwd: path.resolve(__dirname, '..'),
    ignoreInitial: true,
    persistent: true
  }
);

watcher
  .on('change', (filePath) => {
    debounceGenerate(filePath, 'Changed');
  })
  .on('add', (filePath) => {
    debounceGenerate(filePath, 'Added');
  })
  .on('unlink', (filePath) => {
    console.log(`\n[${new Date().toLocaleTimeString()}] Removed: ${filePath}`);
    console.log('Run full generation to clean up orphaned Markdown files');
  });

console.log('Press Ctrl+C to stop watching\n');

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\n\nStopping watch mode...');
  watcher.close();
  process.exit(0);
});
```

---

## 4. Data Models

### 4.1 Command YAML Schema (JSON Schema)

**File**: `schemas/command-yaml-schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": true,
  "required": ["metadata", "mission", "workflow", "expectedOutput"],
  "properties": {
    "metadata": {
      "type": "object",
      "required": ["name", "description", "version", "lastUpdated", "category", "source"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$",
          "description": "Command name (lowercase, hyphens allowed)"
        },
        "description": {
          "type": "string",
          "minLength": 10,
          "maxLength": 200
        },
        "version": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$",
          "description": "Semantic version"
        },
        "lastUpdated": {
          "type": "string",
          "format": "date",
          "description": "ISO 8601 date (YYYY-MM-DD)"
        },
        "category": {
          "type": "string",
          "enum": ["analysis", "workflow", "infrastructure", "quality"]
        },
        "output_path": {
          "type": "string",
          "description": "Optional: override default output path"
        },
        "source": {
          "type": "string",
          "const": "fortium"
        },
        "model": {
          "type": "string",
          "enum": ["opus", "sonnet", "haiku"],
          "description": "Optional: Claude model override (strict validation)"
        },
        "allowed_tools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Task", "TodoWrite"]
          },
          "minItems": 1
        },
        "argument_hint": {
          "type": "string",
          "description": "Optional: hint for command arguments"
        }
      }
    },
    "mission": {
      "type": "object",
      "required": ["summary"],
      "properties": {
        "summary": {
          "type": "string",
          "minLength": 10
        }
      }
    },
    "workflow": {
      "type": "object",
      "required": ["phases"],
      "properties": {
        "phases": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": ["name", "order", "steps"],
            "properties": {
              "name": {
                "type": "string"
              },
              "order": {
                "type": "integer",
                "minimum": 1
              },
              "steps": {
                "type": "array",
                "minItems": 1,
                "items": {
                  "type": "object",
                  "required": ["order", "title"],
                  "properties": {
                    "order": {
                      "type": "integer",
                      "minimum": 1
                    },
                    "title": {
                      "type": "string"
                    },
                    "description": {
                      "type": "string"
                    },
                    "actions": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "delegation": {
                      "type": "object",
                      "required": ["agent"],
                      "properties": {
                        "agent": {
                          "type": "string",
                          "description": "Agent name to delegate to"
                        },
                        "context": {
                          "type": "string",
                          "description": "Context to pass to agent"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "expectedOutput": {
      "type": "object",
      "required": ["format"],
      "properties": {
        "format": {
          "type": "string"
        },
        "structure": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "description"],
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  }
}
```

### 4.2 Agent YAML Schema (JSON Schema)

**File**: `schemas/agent-yaml-schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "additionalProperties": true,
  "required": ["metadata", "mission", "responsibilities"],
  "properties": {
    "metadata": {
      "type": "object",
      "required": ["name", "description", "version", "lastUpdated", "category", "tools"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$",
          "description": "Agent name (lowercase, hyphens allowed)"
        },
        "description": {
          "type": "string",
          "minLength": 10,
          "maxLength": 200
        },
        "version": {
          "type": "string",
          "pattern": "^\\d+\\.\\d+\\.\\d+$"
        },
        "lastUpdated": {
          "type": "string",
          "format": "date"
        },
        "category": {
          "type": "string",
          "enum": ["orchestrator", "specialist", "developer"]
        },
        "tools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Task", "TodoWrite"]
          },
          "minItems": 1
        }
      }
    },
    "mission": {
      "type": "object",
      "required": ["summary"],
      "properties": {
        "summary": {
          "type": "string",
          "minLength": 10
        },
        "boundaries": {
          "type": "object",
          "properties": {
            "handles": {
              "type": "string"
            },
            "doesNotHandle": {
              "type": "string"
            },
            "collaboratesOn": {
              "type": "string"
            }
          }
        },
        "expertise": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "description"],
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "responsibilities": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["priority", "title", "description"],
        "properties": {
          "priority": {
            "type": "string",
            "enum": ["high", "medium", "low"]
          },
          "title": {
            "type": "string"
          },
          "description": {
            "type": "string"
          }
        }
      }
    },
    "examples": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "category", "title"],
        "properties": {
          "id": {
            "type": "string"
          },
          "category": {
            "type": "string",
            "enum": ["patterns", "antipatterns", "workflow"]
          },
          "title": {
            "type": "string"
          },
          "antiPattern": {
            "type": "object",
            "required": ["language", "code", "issues"],
            "properties": {
              "language": {
                "type": "string"
              },
              "code": {
                "type": "string"
              },
              "issues": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          },
          "bestPractice": {
            "type": "object",
            "required": ["language", "code", "benefits"],
            "properties": {
              "language": {
                "type": "string"
              },
              "code": {
                "type": "string"
              },
              "benefits": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    },
    "qualityStandards": {
      "type": "object",
      "properties": {
        "codeQuality": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "description", "enforcement"],
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "enforcement": {
                "type": "string",
                "enum": ["required", "recommended"]
              }
            }
          }
        },
        "testing": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "required": ["minimum", "description"],
            "properties": {
              "minimum": {
                "type": "number",
                "minimum": 0,
                "maximum": 100
              },
              "description": {
                "type": "string"
              }
            }
          }
        },
        "performance": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "target", "unit", "description"],
            "properties": {
              "name": {
                "type": "string"
              },
              "target": {
                "type": "string"
              },
              "unit": {
                "type": "string"
              },
              "description": {
                "type": "string"
              }
            }
          }
        }
      }
    },
    "delegationCriteria": {
      "type": "object",
      "properties": {
        "whenToUse": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "whenToDelegate": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["agent", "triggers"],
            "properties": {
              "agent": {
                "type": "string"
              },
              "triggers": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 4.3 Internal TypeScript Interfaces (for documentation)

```typescript
// Command YAML structure
interface CommandYaml {
  metadata: {
    name: string;
    description: string;
    version: string;
    lastUpdated: string;
    category: 'analysis' | 'workflow' | 'infrastructure' | 'quality';
    output_path?: string;
    source: 'fortium';
    model?: string;
    allowed_tools?: string[];
    argument_hint?: string;
  };
  mission: {
    summary: string;
  };
  workflow: {
    phases: {
      name: string;
      order: number;
      steps: {
        order: number;
        title: string;
        description?: string;
        actions?: string[];
        delegation?: {
          agent: string;
          context?: string;
        };
      }[];
    }[];
  };
  expectedOutput: {
    format: string;
    structure?: {
      name: string;
      description: string;
    }[];
  };
}

// Agent YAML structure
interface AgentYaml {
  metadata: {
    name: string;
    description: string;
    version: string;
    lastUpdated: string;
    category: 'orchestrator' | 'specialist' | 'developer';
    tools: string[];
  };
  mission: {
    summary: string;
    boundaries?: {
      handles?: string;
      doesNotHandle?: string;
      collaboratesOn?: string;
    };
    expertise?: {
      name: string;
      description: string;
    }[];
  };
  responsibilities: {
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
  }[];
  examples?: {
    id: string;
    category: 'patterns' | 'antipatterns' | 'workflow';
    title: string;
    antiPattern?: {
      language: string;
      code: string;
      issues: string[];
    };
    bestPractice?: {
      language: string;
      code: string;
      benefits: string[];
    };
  }[];
  qualityStandards?: {
    codeQuality?: {
      name: string;
      description: string;
      enforcement: 'required' | 'recommended';
    }[];
    testing?: {
      [key: string]: {
        minimum: number;
        description: string;
      };
    };
    performance?: {
      name: string;
      target: string;
      unit: string;
      description: string;
    }[];
  };
  delegationCriteria?: {
    whenToUse?: string[];
    whenToDelegate?: {
      agent: string;
      triggers: string[];
    }[];
  };
}

// Parsed result from parser
interface ParsedYaml {
  type: 'command' | 'agent';
  data: CommandYaml | AgentYaml;
}
```

---

## 5. File Structure

### 5.1 New Files to Create

```
ensemble/
├── scripts/
│   ├── generate-markdown.js              # NEW: Main CLI entry point
│   ├── generate-markdown-watch.js        # NEW: Watch mode script
│   └── lib/                              # NEW: Generator modules
│       ├── yaml-parser.js                # NEW: YAML parsing
│       ├── schema-validator.js           # NEW: Schema validation
│       ├── command-transformer.js        # NEW: Command transformation
│       ├── agent-transformer.js          # NEW: Agent transformation
│       ├── markdown-generator.js         # NEW: Generator router
│       ├── file-utils.js                 # NEW: File I/O utilities
│       ├── file-discovery.js             # NEW: Plugin manifest discovery
│       ├── orphan-cleanup.js             # NEW: Orphan cleanup
│       └── error-handler.js              # NEW: Error types and reporting
├── schemas/
│   ├── command-yaml-schema.json          # NEW: Command YAML schema
│   └── agent-yaml-schema.json            # NEW: Agent YAML schema
├── tests/
│   └── generator/                        # NEW: Generator tests
│       ├── unit/
│       │   ├── yaml-parser.test.js
│       │   ├── schema-validator.test.js
│       │   ├── command-transformer.test.js
│       │   └── agent-transformer.test.js
│       ├── integration/
│       │   ├── generate-all.test.js
│       │   └── idempotency.test.js
│       └── fixtures/
│           ├── valid-command.yaml
│           ├── valid-agent.yaml
│           ├── invalid-syntax.yaml
│           └── invalid-delegation.yaml
└── package.json                          # MODIFIED: Add new scripts
```

### 5.2 Modified Files

**`package.json`**:
```json
{
  "scripts": {
    "generate": "node scripts/generate-markdown.js",
    "generate:commands": "node scripts/generate-markdown.js --type commands",
    "generate:agents": "node scripts/generate-markdown.js --type agents",
    "generate:watch": "node scripts/generate-markdown-watch.js",
    "validate": "npm run generate -- --validate && node scripts/validate-all.js",
    "prebuild": "npm run generate",
    "test": "npm run test --workspaces --if-present",
    "test:generator": "jest tests/generator"
  },
  "devDependencies": {
    "ajv": "^8.12.0",
    "ajv-cli": "^5.0.0",
    "ajv-formats": "^3.0.1",
    "commander": "^11.0.0",
    "chokidar": "^3.5.3",
    "jest": "^29.7.0",
    "js-yaml": "^4.1.0"
  }
}
```

**`.github/workflows/validate.yml`** (add generation and drift check steps):
```yaml
- name: Generate Markdown (with validation)
  run: npm run generate -- --fail-fast

- name: Check for drift (generated files vs committed)
  run: |
    git diff --exit-code || (echo "ERROR: Generated Markdown files are out of sync with committed files. Run 'npm run generate' locally and commit the changes." && exit 1)
```

**CI Drift Detection**: This ensures that developers have run the generator locally before committing. If generated files don't match what's in git, the CI build fails. This prevents stale Markdown files from being deployed.

---

## 6. Error Handling

### 6.1 Error Types and Codes

| Error Type | Exit Code | Use Case | Example |
|------------|-----------|----------|---------|
| **ValidationError** | 1 | YAML syntax or schema errors | Invalid YAML, missing required field |
| **GenerationError** | 1 | Markdown generation failures | Template rendering error |
| **IOError** | 1 | File system errors | Cannot write file, permission denied |
| **CleanupError** | 1 | Orphan cleanup failures | Cannot delete orphaned file |
| **FatalError** | 2 | Unexpected errors | Uncaught exception |

### 6.2 Error Collection Strategy

**Collect-All-Errors Implementation**:

```javascript
// Main generation loop
const errors = [];

for (const yamlPath of allYamlPaths) {
  try {
    // Parse, validate, generate, write
    await processYamlFile(yamlPath);
  } catch (error) {
    // If error is array (from validation), spread it
    if (Array.isArray(error)) {
      errors.push(...error);
    } else {
      errors.push(error);
    }
    // Continue processing other files
  }
}

// After all files processed
if (errors.length > 0) {
  printErrorSummary(errors);
  process.exit(1);
}
```

**Benefits**:
- Developer sees all issues at once
- No need to fix-and-retry multiple times
- Better DX for batch operations

### 6.3 Error Message Format

```
=== Generation Errors Summary ===

ValidationErrors (3):
  ❌ packages/core/commands/fold-prompt.yaml: metadata.version - must match pattern "^\d+\.\d+\.\d+$"
  ❌ packages/metrics/commands/manager-dashboard.yaml: workflow.phases[0].steps - Step numbering has gaps: expected 2, found 3
  ❌ packages/product/commands/create-prd.yaml: workflow.phases[1].steps[2].delegation.agent - Referenced agent 'non-existent-agent' not found in agent ecosystem

GenerationErrors (1):
  ❌ packages/git/agents/git-workflow.yaml: Markdown generation failed: Cannot read property 'summary' of undefined

Total errors: 4
```

### 6.4 Exit Codes

```javascript
// Success
process.exit(0);

// Validation or generation errors
if (errors.length > 0) {
  process.exit(1);
}

// Fatal error (uncaught exception)
process.on('uncaughtException', (error) => {
  console.error('Fatal error:', error);
  process.exit(2);
});
```

---

## 7. Testing Strategy

### 7.1 Test Coverage Targets

| Category | Target Coverage | Measurement |
|----------|----------------|-------------|
| Unit Tests | ≥90% | Lines, branches, functions |
| Integration Tests | All workflows | End-to-end scenarios |
| Edge Cases | All error paths | Negative testing |

### 7.2 Unit Tests

**File**: `tests/generator/unit/yaml-parser.test.js`

```javascript
const { parseYamlFile, detectYamlType } = require('../../../scripts/lib/yaml-parser');
const { ValidationError } = require('../../../scripts/lib/error-handler');
const path = require('path');

describe('yaml-parser', () => {
  describe('parseYamlFile', () => {
    it('should parse valid command YAML', async () => {
      const result = await parseYamlFile(
        path.join(__dirname, '../fixtures/valid-command.yaml')
      );
      expect(result.type).toBe('command');
      expect(result.data.metadata.name).toBe('test-command');
    });

    it('should parse valid agent YAML', async () => {
      const result = await parseYamlFile(
        path.join(__dirname, '../fixtures/valid-agent.yaml')
      );
      expect(result.type).toBe('agent');
      expect(result.data.metadata.name).toBe('test-agent');
    });

    it('should throw ValidationError on invalid YAML syntax', async () => {
      await expect(
        parseYamlFile(path.join(__dirname, '../fixtures/invalid-syntax.yaml'))
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('detectYamlType', () => {
    it('should detect command type from workflow field', () => {
      const yaml = { workflow: { phases: [] } };
      expect(detectYamlType(yaml)).toBe('command');
    });

    it('should detect agent type from responsibilities field', () => {
      const yaml = { responsibilities: [] };
      expect(detectYamlType(yaml)).toBe('agent');
    });

    it('should throw ValidationError if type cannot be determined', () => {
      const yaml = { metadata: {} };
      expect(() => detectYamlType(yaml)).toThrow(ValidationError);
    });
  });
});
```

**File**: `tests/generator/unit/schema-validator.test.js`

```javascript
const { validateCommandSchema, validateAgentSchema } = require('../../../scripts/lib/schema-validator');
const { ValidationError } = require('../../../scripts/lib/error-handler');

describe('schema-validator', () => {
  describe('validateCommandSchema', () => {
    const validCommand = {
      metadata: {
        name: 'test-command',
        description: 'Test command description',
        version: '1.0.0',
        lastUpdated: '2025-12-19',
        category: 'analysis',
        source: 'fortium'
      },
      mission: {
        summary: 'Test mission summary'
      },
      workflow: {
        phases: [{
          name: 'Test Phase',
          order: 1,
          steps: [
            { order: 1, title: 'Step 1' },
            { order: 2, title: 'Step 2' }
          ]
        }]
      },
      expectedOutput: {
        format: 'Markdown'
      }
    };

    it('should validate correct command schema', () => {
      const agentNames = new Set(['test-agent']);
      expect(() => validateCommandSchema(validCommand, 'test.yaml', agentNames))
        .not.toThrow();
    });

    it('should throw ValidationError on missing required field', () => {
      const invalid = { ...validCommand };
      delete invalid.metadata.name;

      expect(() => validateCommandSchema(invalid, 'test.yaml', new Set()))
        .toThrow(ValidationError);
    });

    it('should throw ValidationError on step numbering gaps', () => {
      const invalid = {
        ...validCommand,
        workflow: {
          phases: [{
            name: 'Test',
            order: 1,
            steps: [
              { order: 1, title: 'Step 1' },
              { order: 3, title: 'Step 3' } // Gap: missing 2
            ]
          }]
        }
      };

      expect(() => validateCommandSchema(invalid, 'test.yaml', new Set()))
        .toThrow();
    });

    it('should throw ValidationError on invalid delegation reference', () => {
      const invalid = {
        ...validCommand,
        workflow: {
          phases: [{
            name: 'Test',
            order: 1,
            steps: [{
              order: 1,
              title: 'Step 1',
              delegation: { agent: 'non-existent-agent' }
            }]
          }]
        }
      };

      const agentNames = new Set(['existing-agent']);
      expect(() => validateCommandSchema(invalid, 'test.yaml', agentNames))
        .toThrow(ValidationError);
    });
  });
});
```

**File**: `tests/generator/unit/command-transformer.test.js`

```javascript
const { transformCommandToMarkdown } = require('../../../scripts/lib/command-transformer');

describe('command-transformer', () => {
  const validCommand = {
    metadata: {
      name: 'test-command',
      description: 'Test command',
      allowed_tools: ['Read', 'Write']
    },
    mission: {
      summary: 'Test mission'
    },
    workflow: {
      phases: [{
        name: 'Test Phase',
        order: 1,
        steps: [
          {
            order: 1,
            title: 'Step 1',
            description: 'Do something',
            actions: ['Action 1', 'Action 2']
          }
        ]
      }]
    },
    expectedOutput: {
      format: 'Markdown',
      structure: [
        { name: 'Section 1', description: 'First section' }
      ]
    }
  };

  it('should generate valid Markdown with frontmatter', () => {
    const markdown = transformCommandToMarkdown(validCommand, 'test.yaml');

    expect(markdown).toContain('---');
    expect(markdown).toContain('name: ensemble:test-command');
    expect(markdown).toContain('description: Test command');
    expect(markdown).toContain('allowed-tools: [Read, Write]');
  });

  it('should include DO NOT EDIT header', () => {
    const markdown = transformCommandToMarkdown(validCommand, 'test.yaml');

    expect(markdown).toContain('DO NOT EDIT THIS FILE DIRECTLY');
    expect(markdown).toContain('This file is auto-generated from test.yaml');
  });

  it('should include workflow phases and steps', () => {
    const markdown = transformCommandToMarkdown(validCommand, 'test.yaml');

    expect(markdown).toContain('## Workflow');
    expect(markdown).toContain('### 1. Test Phase');
    expect(markdown).toContain('**1. Step 1**');
    expect(markdown).toContain('Do something');
    expect(markdown).toContain('- Action 1');
  });

  it('should include delegation information', () => {
    const commandWithDelegation = {
      ...validCommand,
      workflow: {
        phases: [{
          name: 'Test',
          order: 1,
          steps: [{
            order: 1,
            title: 'Step 1',
            delegation: {
              agent: 'test-agent',
              context: 'Some context'
            }
          }]
        }]
      }
    };

    const markdown = transformCommandToMarkdown(commandWithDelegation, 'test.yaml');

    expect(markdown).toContain('**Delegation:** @test-agent');
    expect(markdown).toContain('Some context');
  });
});
```

### 7.3 Integration Tests

**File**: `tests/generator/integration/generate-all.test.js`

```javascript
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('generate-all integration', () => {
  const repoRoot = path.resolve(__dirname, '../../..');

  it('should generate all Markdown files without errors', () => {
    expect(() => {
      execSync('node scripts/generate-markdown.js', {
        cwd: repoRoot,
        stdio: 'pipe'
      });
    }).not.toThrow();
  });

  it('should generate Markdown files with DO NOT EDIT headers', () => {
    execSync('node scripts/generate-markdown.js', {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    // Check a known generated file
    const markdownPath = path.join(
      repoRoot,
      'packages/metrics/agents/manager-dashboard-agent.md'
    );

    const content = fs.readFileSync(markdownPath, 'utf8');
    expect(content).toContain('DO NOT EDIT THIS FILE DIRECTLY');
  });

  it('should fail validation on invalid YAML', () => {
    // Create temp invalid YAML
    const tempYaml = path.join(repoRoot, 'packages/core/commands/temp-invalid.yaml');
    fs.writeFileSync(tempYaml, 'invalid: yaml: syntax:');

    expect(() => {
      execSync('node scripts/generate-markdown.js --validate', {
        cwd: repoRoot,
        stdio: 'pipe'
      });
    }).toThrow();

    // Cleanup
    fs.unlinkSync(tempYaml);
  });
});
```

**File**: `tests/generator/integration/idempotency.test.js`

```javascript
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

describe('idempotency', () => {
  const repoRoot = path.resolve(__dirname, '../../..');

  function getFileHash(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  it('should produce identical output on repeated generation', () => {
    // Generate once
    execSync('node scripts/generate-markdown.js', {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    const firstHash = getFileHash(
      path.join(repoRoot, 'packages/metrics/agents/manager-dashboard-agent.md')
    );

    // Generate again
    execSync('node scripts/generate-markdown.js', {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    const secondHash = getFileHash(
      path.join(repoRoot, 'packages/metrics/agents/manager-dashboard-agent.md')
    );

    expect(firstHash).toBe(secondHash);
  });
});
```

### 7.4 Test Fixtures

**File**: `tests/generator/fixtures/valid-command.yaml`

```yaml
metadata:
  name: test-command
  description: Test command for unit testing
  version: 1.0.0
  lastUpdated: "2025-12-19"
  category: analysis
  source: fortium

mission:
  summary: This is a test command for unit testing purposes

workflow:
  phases:
    - name: Test Phase
      order: 1
      steps:
        - order: 1
          title: First Step
          description: This is the first step
          actions:
            - Do action 1
            - Do action 2

expectedOutput:
  format: Markdown
  structure:
    - name: Section 1
      description: First section
```

**File**: `tests/generator/fixtures/invalid-syntax.yaml`

```yaml
metadata:
  name: invalid
  invalid yaml syntax here:
    - unclosed: bracket
```

### 7.5 Running Tests

```bash
# Run all generator tests
npm run test:generator

# Run with coverage
npm run test:generator -- --coverage

# Run specific test file
npm run test:generator -- yaml-parser.test.js

# Watch mode for development
npm run test:generator -- --watch
```

---

## 8. Implementation Plan

### 8.1 Phase 1: Foundation (Week 1, Days 1-2)

**Milestone**: Core parsing and validation infrastructure

**Tasks**:
1. Create JSON schemas (`command-yaml-schema.json`, `agent-yaml-schema.json`)
2. Implement `error-handler.js` (error types, formatting)
3. Implement `yaml-parser.js` (parse, detect type)
4. Implement `schema-validator.js` (JSON Schema validation)
5. Write unit tests for parser and validator
6. Validate against 5 existing YAML files

**Deliverables**:
- Working parser with type detection
- Schema validation with ajv
- 90% test coverage for parser and validator

**Dependencies**: None

### 8.2 Phase 2: Transformation (Week 1, Days 3-4)

**Milestone**: Markdown generation logic

**Tasks**:
1. Implement `command-transformer.js` (frontmatter, body, sections)
2. Implement `agent-transformer.js` (frontmatter, body, sections)
3. Implement `markdown-generator.js` (router)
4. Add DO NOT EDIT header generation
5. Write unit tests for transformers
6. Test on 10 existing YAML files

**Deliverables**:
- Working transformers for both types
- Proper Markdown structure with frontmatter
- 90% test coverage for transformers

**Dependencies**: Phase 1 complete

### 8.3 Phase 3: File I/O and Discovery (Week 1, Day 5)

**Milestone**: File operations and discovery

**Tasks**:
1. Implement `file-utils.js` (atomic writes, path resolution)
2. Implement `file-discovery.js` (plugin manifest scanning)
3. Implement `orphan-cleanup.js` (orphan detection and removal)
4. Write unit tests for file operations
5. Test on full repository

**Deliverables**:
- Plugin manifest-based file discovery
- Atomic file writes
- Orphan cleanup functionality

**Dependencies**: Phase 2 complete

### 8.4 Phase 4: CLI and Integration (Week 2, Days 1-2)

**Milestone**: CLI interface and npm integration

**Tasks**:
1. Implement `generate-markdown.js` (CLI with Commander.js)
2. Add argument parsing (--type, --file, --validate, --dry-run, --verbose)
3. Implement error collection and reporting
4. Add npm scripts to package.json
5. Write integration tests
6. Test on all 42 YAML files

**Deliverables**:
- Working CLI with all options
- npm scripts integration
- Collect-all-errors implementation
- Integration test suite

**Dependencies**: Phase 3 complete

### 8.5 Phase 5: Watch Mode and CI (Week 2, Days 3-4)

**Milestone**: Developer experience and automation

**Tasks**:
1. Implement `generate-markdown-watch.js` (chokidar-based watcher)
2. Add pre-build hook to package.json
3. Update `.github/workflows/validate.yml`
4. Test watch mode in development
5. Test CI integration in GitHub Actions

**Deliverables**:
- Working watch mode
- CI/CD integration
- Pre-build hook

**Dependencies**: Phase 4 complete

### 8.6 Phase 6: Validation and Refinement (Week 2, Day 5)

**Milestone**: Production readiness

**Tasks**:
1. Run generator on all 42 existing YAML files
2. Compare generated Markdown with existing files
3. Fix any YAML files that don't match schema
4. Test generated Markdown in Claude Code
5. Performance testing (should be <5s for all files)
6. Documentation updates (CLAUDE.md)

**Deliverables**:
- All 42 files generate successfully
- Generated Markdown works in Claude Code
- Updated documentation

**Dependencies**: Phase 5 complete

### 8.7 Milestone Summary

| Phase | Duration | Effort | Deliverable | Success Criteria |
|-------|----------|--------|-------------|------------------|
| **Phase 1** | 2 days | 16 hours | Parser + Validator | Parses all 42 YAML files |
| **Phase 2** | 2 days | 16 hours | Transformers | Generates valid Markdown |
| **Phase 3** | 1 day | 8 hours | File I/O + Discovery | Discovers files via manifests |
| **Phase 4** | 2 days | 16 hours | CLI + Integration | CLI works end-to-end |
| **Phase 5** | 2 days | 16 hours | Watch + CI | Watch mode and CI work |
| **Phase 6** | 1 day | 8 hours | Validation | All files work in Claude Code |
| **Total** | **10 days** | **80 hours** | Complete generator | Production ready |

---

## 9. Risks and Mitigations

### 9.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Existing YAML files don't match schema** | High | High | Incrementally fix files during Phase 6; use lenient schema initially |
| **Claude Code rejects generated Markdown** | Medium | High | Test with Claude Code early in Phase 2; iterate on format |
| **Performance issues with 42+ files** | Low | Medium | Profile and optimize; implement caching if needed |
| **Step numbering validation too strict** | Medium | Low | Make validation configurable; warn instead of error option |
| **Delegation references break with agent renames** | Medium | Medium | Build comprehensive agent index; clear error messages |

### 9.2 Risk Mitigation Strategies

**Risk 1: Existing YAML files don't match schema**

*Mitigation*:
1. Start with permissive schema (required fields only)
2. Test against all 42 files in Phase 1
3. Identify common patterns and adjust schema
4. Fix files incrementally or adjust schema
5. Document migration guide for non-compliant files

**Risk 2: Claude Code rejects generated Markdown**

*Mitigation*:
1. Test generated Markdown in Claude Code during Phase 2
2. Compare with existing working Markdown files
3. Iterate on frontmatter format if needed
4. Add post-generation validation step
5. Create test suite of Claude Code-compatible files

**Risk 3: Performance issues**

*Mitigation*:
1. Profile generator with all 42 files
2. Implement incremental generation (only changed files)
3. Parallelize file processing if needed
4. Add caching for repeated runs
5. Optimize hot paths identified by profiling

**Risk 4: Step numbering validation too strict**

*Mitigation*:
1. Make validation level configurable (--strict flag)
2. Default to warnings, not errors
3. Provide clear error messages with fix suggestions
4. Auto-fix option to renumber steps
5. Document step numbering best practices

**Risk 5: Delegation references break**

*Mitigation*:
1. Build comprehensive agent name index
2. Support fuzzy matching for similar names
3. Clear error messages with suggestions
4. Warn about cross-plugin references
5. Document delegation best practices

### 9.3 Process Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Timeline slippage** | Medium | Medium | Buffer time in Phase 6; prioritize P0 features |
| **Scope creep** | Medium | Medium | Strict adherence to PRD; defer P2 features |
| **Testing gaps** | Low | High | 90% coverage target; integration tests required |

---

## 10. Performance Targets

### 10.1 Performance Metrics

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| **Generation time per file** | <100ms | Timer around single file generation |
| **Total generation time (42 files)** | <5s | End-to-end script execution time |
| **Validation time per file** | <50ms | Timer around validation function |
| **Memory usage** | <100MB | Peak RSS during generation |
| **Watch mode latency** | <500ms | Time from file save to generation complete |

### 10.2 Performance Testing

```javascript
// Performance test
const { performance } = require('perf_hooks');

describe('performance', () => {
  it('should generate all files in under 5 seconds', () => {
    const start = performance.now();

    execSync('node scripts/generate-markdown.js', {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(5000);
  });

  it('should generate single file in under 100ms', async () => {
    const start = performance.now();

    await processYamlFile('packages/metrics/agents/manager-dashboard-agent.yaml');

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(100);
  });
});
```

### 10.3 Optimization Strategies

If performance targets are not met:

1. **Parallel Processing**: Use worker threads for file processing
2. **Incremental Generation**: Only regenerate changed files
3. **Caching**: Cache parsed YAML and validation results
4. **Lazy Schema Loading**: Load schemas once, reuse validators
5. **Streaming**: Stream large files instead of loading into memory

---

## 11. Security Considerations

### 11.1 Security Requirements

| Requirement | Implementation | Rationale |
|-------------|----------------|-----------|
| **No code execution from YAML** | Parse only, never `eval()` | Prevent injection attacks |
| **Path traversal prevention** | Resolve symlinks before validating paths within repo | Prevent writing outside repo via symlink attacks |
| **Input validation** | Schema validation on all YAML | Sanitize untrusted input |
| **Dependency security** | Use trusted, maintained libraries | Prevent supply chain attacks |

### 11.2 Security Implementation

```javascript
// Path traversal prevention with symlink resolution
const fs = require('fs');

function getMarkdownPath(yamlPath, yamlData) {
  const repoRoot = fs.realpathSync(path.resolve(__dirname, '../..'));

  if (yamlData.metadata?.output_path) {
    const outputPath = path.resolve(repoRoot, yamlData.metadata.output_path);

    // Resolve symlinks before validation
    const resolvedPath = fs.realpathSync(path.dirname(outputPath));
    const fullResolvedPath = path.join(resolvedPath, path.basename(outputPath));

    // Ensure output path is within repo
    if (!fullResolvedPath.startsWith(repoRoot)) {
      throw new Error(`Invalid output_path: must be within repository`);
    }

    return fullResolvedPath;
  }

  // Default path (always safe)
  return path.join(path.dirname(yamlPath), `${path.basename(yamlPath, '.yaml')}.md`);
}
```

### 11.3 Dependency Audit

All dependencies are already in use in the ensemble ecosystem:

- `js-yaml@^4.1.0` - 15M+ weekly downloads, actively maintained
- `ajv@^8.12.0` - 60M+ weekly downloads, actively maintained
- `ajv-formats@^3.0.1` - 3M+ weekly downloads, actively maintained
- `commander@^11.0.0` - 15M+ weekly downloads, actively maintained
- `chokidar@^3.5.3` - 30M+ weekly downloads, actively maintained

Run `npm audit` regularly to check for vulnerabilities.

---

## 12. Documentation Requirements

### 12.1 User Documentation

**Update `CLAUDE.md`**:

Add section:
```markdown
### Generate Markdown from YAML

Commands and agents are defined in YAML (source of truth) and auto-generated to Markdown for Claude Code.

```bash
# Generate all Markdown files
npm run generate

# Generate only commands
npm run generate:commands

# Generate only agents
npm run generate:agents

# Validate without generating
npm run generate -- --validate

# Watch mode (auto-regenerate on changes)
npm run generate:watch

# Dry run (show what would be generated)
npm run generate -- --dry-run
```

**Important**: Always edit YAML files, not Markdown. Generated Markdown files contain a "DO NOT EDIT" warning.
```

### 12.2 Developer Documentation

**Create `docs/GENERATOR.md`**:

Contents:
- Architecture overview
- Module descriptions
- Adding new validation rules
- Extending transformer logic
- Troubleshooting common issues
- Performance tuning

### 12.3 Migration Guide

**Create `docs/MIGRATION.md`**:

Contents:
- How to convert existing Markdown to YAML
- Manual migration steps
- Common pitfalls
- Schema validation tips

---

## 13. Acceptance Criteria

### 13.1 Functional Acceptance

| ID | Criterion | Test | Success Metric |
|----|-----------|------|----------------|
| **AC-F1** | Generate Markdown from command YAML | Run on `manager-dashboard.yaml` | Valid Markdown with ≥80% content |
| **AC-F2** | Generate Markdown from agent YAML | Run on `manager-dashboard-agent.yaml` | Valid Markdown with all sections |
| **AC-F3** | Validate YAML before generation | Run on invalid YAML | Clear error, exit code 1 |
| **AC-F4** | Generate proper frontmatter | Inspect generated Markdown | Correct fields and format |
| **AC-F5** | Preserve workflow phases | Compare YAML and Markdown | All phases present |
| **AC-F6** | Support delegation context | Generate with delegation | Delegation section in output |
| **AC-F7** | Handle optional fields | Generate minimal YAML | No errors on missing optional |
| **AC-F8** | Batch generate all files | Run `npm run generate` | All 42 files regenerated |
| **AC-F9** | Validate step numbering | Test with gaps | Error on non-sequential steps |
| **AC-F10** | Validate delegation refs | Test with invalid agent | Error on non-existent agent |
| **AC-F11** | Cleanup orphaned files | Remove YAML, regenerate | Markdown removed automatically |
| **AC-F12** | Add DO NOT EDIT header | Inspect generated files | Header present in all files |

### 13.2 Integration Acceptance

| ID | Criterion | Test | Success Metric |
|----|-----------|------|----------------|
| **AC-I1** | npm scripts work | Run `npm run generate` | Completes in <5s |
| **AC-I2** | Pre-build hook works | Run `npm run build` | Markdown generated first |
| **AC-I3** | CI validation passes | Push YAML changes | CI generates and validates |
| **AC-I4** | Idempotent generation | Run twice | Identical output (hash match) |
| **AC-I5** | Watch mode works | Edit YAML, save | Auto-regenerated in <500ms |
| **AC-I6** | Claude Code compatibility | Load generated files | Commands/agents work |

### 13.3 Quality Acceptance

| ID | Criterion | Test | Success Metric |
|----|-----------|------|----------------|
| **AC-Q1** | Test coverage | Run jest --coverage | ≥90% coverage |
| **AC-Q2** | Error messages clear | Test invalid inputs | Actionable error messages |
| **AC-Q3** | Performance target | Time full generation | <5s for 42 files |
| **AC-Q4** | Memory usage | Monitor during run | <100MB peak RSS |

---

## 14. Appendix

### 14.1 Example Generated Files

**Command Example**: `manager-dashboard.md` (generated from YAML)

```markdown
---
name: ensemble:manager-dashboard
description: Generate real-time productivity metrics and team analytics dashboard
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

<!--
DO NOT EDIT THIS FILE DIRECTLY
This file is auto-generated from manager-dashboard.yaml
Any manual edits will be overwritten on next generation.
Edit the YAML source file instead.
-->

Generate a comprehensive management dashboard with real-time productivity metrics,
team analytics, sprint progress, and actionable insights for engineering managers
and technical leads.

## Mission

Generate a comprehensive management dashboard with real-time productivity metrics,
team analytics, sprint progress, and actionable insights for engineering managers
and technical leads.

## Workflow

### 1. Data Collection

**1. Metrics Gathering**
Collect productivity metrics from all sources

- Git commit history
- Test coverage reports
- Sprint task completion
- Code review metrics

### 2. Analysis

**1. Trend Analysis**
Analyze productivity trends over time

**2. Insight Generation**
Generate actionable insights

### 3. Dashboard Generation

**1. Dashboard Creation**
Generate HTML/Markdown dashboard

**Delegation:** @manager-dashboard-agent
Collected metrics and analysis results

## Expected Output

**Format:** Interactive Dashboard

**Structure:**
- **Productivity Metrics**: Development velocity, error rates, automation coverage
- **Team Analytics**: Individual and team performance metrics
- **Sprint Progress**: Current sprint status and burndown

## Usage

```
/ensemble:manager-dashboard [arguments]
```
```

### 14.2 Directory Structure After Implementation

```
ensemble/
├── scripts/
│   ├── generate-markdown.js              # Main CLI
│   ├── generate-markdown-watch.js        # Watch mode
│   ├── validate-all.js                   # Existing validator
│   └── lib/
│       ├── yaml-parser.js
│       ├── schema-validator.js
│       ├── command-transformer.js
│       ├── agent-transformer.js
│       ├── markdown-generator.js
│       ├── file-utils.js
│       ├── file-discovery.js
│       ├── orphan-cleanup.js
│       └── error-handler.js
├── schemas/
│   ├── command-yaml-schema.json          # New
│   ├── agent-yaml-schema.json            # New
│   ├── plugin-schema.json                # Existing
│   └── marketplace-schema.json           # Existing
├── tests/
│   └── generator/
│       ├── unit/
│       │   ├── yaml-parser.test.js
│       │   ├── schema-validator.test.js
│       │   ├── command-transformer.test.js
│       │   └── agent-transformer.test.js
│       ├── integration/
│       │   ├── generate-all.test.js
│       │   └── idempotency.test.js
│       └── fixtures/
│           ├── valid-command.yaml
│           ├── valid-agent.yaml
│           └── invalid-syntax.yaml
├── packages/
│   ├── metrics/
│   │   ├── agents/
│   │   │   ├── manager-dashboard-agent.yaml      # Source (edited)
│   │   │   └── manager-dashboard-agent.md        # Generated (DO NOT EDIT)
│   │   └── commands/
│   │       ├── manager-dashboard.yaml            # Source (edited)
│   │       └── manager-dashboard.md              # Generated (DO NOT EDIT)
│   └── [other packages...]
└── package.json                          # Updated with new scripts
```

### 14.3 Related Documents

- **PRD-CORE-003 v1.1**: Product Requirements Document
- **CLAUDE.md**: Ensemble plugin ecosystem documentation
- **schemas/plugin-schema.json**: Existing plugin schema
- **scripts/validate-all.js**: Existing validation script

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.1 | 2025-12-19 | Fortium Partners | Updated with user interview decisions: orphan safety (DO NOT EDIT header check), watch mode debounce (500ms), strict model validation (opus/sonnet/haiku), --fail-fast CLI option, phase numbering validation, schema extensibility (additionalProperties: true), symlink resolution in security, CI drift check |
| 1.0 | 2025-12-19 | Fortium Partners | Initial TRD creation based on PRD-CORE-003 v1.1 |

---

**END OF TECHNICAL REQUIREMENTS DOCUMENT**
