/**
 * Agent Frontmatter Validation Test Suite
 *
 * TRD Tasks: TRD-TEST-086 to TRD-TEST-092
 *
 * Tests to validate agent frontmatter in .md files for the 12 streamlined subagents.
 *
 * Run tests with: npx jest agent-validation.test.js
 *
 * Prerequisites:
 *   npm install --save-dev jest js-yaml
 *
 * Schema Expected:
 *   ---
 *   name: string          # Required, must match filename
 *   description: string   # Required
 *   skills: string        # Optional, comma-separated list
 *   ---
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Use js-yaml for parsing frontmatter
let yaml;
try {
  yaml = require('js-yaml');
} catch (e) {
  // Fallback to gray-matter if js-yaml not available
  try {
    yaml = require('gray-matter');
  } catch (e2) {
    console.warn('Neither js-yaml nor gray-matter found. Install with: npm install js-yaml');
  }
}

// =============================================================================
// Constants
// =============================================================================

const AGENTS_DIR = path.join(__dirname, '../../full/agents');

/**
 * Required 12 agents as per TRD constitution and CLAUDE.md
 */
const REQUIRED_AGENTS = [
  'product-manager',
  'technical-architect',
  'spec-planner',
  'frontend-implementer',
  'backend-implementer',
  'mobile-implementer',
  'verify-app',
  'code-simplifier',
  'code-reviewer',
  'app-debugger',
  'devops-engineer',
  'cicd-specialist'
];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse YAML frontmatter from a markdown file.
 * Frontmatter is expected to be between --- delimiters at the start of the file.
 *
 * @param {string} content - The file content
 * @returns {Object|null} Parsed frontmatter object or null if not found/invalid
 */
function parseFrontmatter(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();

  // Check if file starts with ---
  if (!trimmed.startsWith('---')) {
    return null;
  }

  // Find the closing ---
  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return null;
  }

  const yamlContent = trimmed.slice(3, endIndex).trim();

  if (!yamlContent) {
    return null;
  }

  try {
    // Use js-yaml if available
    if (yaml && typeof yaml.load === 'function') {
      return yaml.load(yamlContent);
    }
    // Fallback to gray-matter parsing
    if (yaml && typeof yaml === 'function') {
      const result = yaml(content);
      return result.data;
    }
    // Manual simple parsing if no library available
    return parseSimpleYaml(yamlContent);
  } catch (e) {
    return null;
  }
}

/**
 * Simple YAML parser for basic key-value pairs.
 * Used as fallback when js-yaml is not available.
 *
 * @param {string} yamlContent - The YAML content to parse
 * @returns {Object} Parsed object
 */
function parseSimpleYaml(yamlContent) {
  const result = {};
  const lines = yamlContent.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, colonIndex).trim();
    let value = trimmedLine.slice(colonIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Get all .md files in the agents directory (excluding test files).
 *
 * @returns {string[]} Array of agent filenames (without extension)
 */
function getAgentFiles() {
  try {
    const files = fs.readdirSync(AGENTS_DIR);
    return files
      .filter(f => f.endsWith('.md') && !f.includes('.test.'))
      .map(f => f.replace('.md', ''));
  } catch (e) {
    return [];
  }
}

/**
 * Read and parse an agent file.
 *
 * @param {string} agentName - The agent name (without .md extension)
 * @returns {Object|null} Object with content and frontmatter, or null if not found
 */
function readAgentFile(agentName) {
  const filePath = path.join(AGENTS_DIR, `${agentName}.md`);

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);
    return {
      path: filePath,
      content,
      frontmatter
    };
  } catch (e) {
    return null;
  }
}

// =============================================================================
// TRD-TEST-087: All 12 agent files exist
// =============================================================================

describe('TRD-TEST-087: All 12 agent files exist', () => {
  it('should have all 12 required agent files', () => {
    const missingAgents = [];

    for (const agentName of REQUIRED_AGENTS) {
      const filePath = path.join(AGENTS_DIR, `${agentName}.md`);
      if (!fs.existsSync(filePath)) {
        missingAgents.push(agentName);
      }
    }

    if (missingAgents.length > 0) {
      console.log(`Missing agents: ${missingAgents.join(', ')}`);
    }

    expect(missingAgents).toHaveLength(0);
  });

  // Dynamic tests for each required agent
  describe.each(REQUIRED_AGENTS)('Agent: %s', (agentName) => {
    it(`should exist as ${agentName}.md`, () => {
      const filePath = path.join(AGENTS_DIR, `${agentName}.md`);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});

// =============================================================================
// TRD-TEST-088: Valid YAML frontmatter parsing
// =============================================================================

describe('TRD-TEST-088: Valid YAML frontmatter parsing', () => {
  const existingAgents = REQUIRED_AGENTS.filter(name => {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    return fs.existsSync(filePath);
  });

  if (existingAgents.length === 0) {
    it.skip('No agent files exist yet - skipping frontmatter parsing tests', () => {
      // This test is skipped when no agents exist
    });
  } else {
    describe.each(existingAgents)('Agent: %s', (agentName) => {
      it('should have parseable YAML frontmatter', () => {
        const agent = readAgentFile(agentName);
        expect(agent).not.toBeNull();
        expect(agent.content).toBeDefined();

        // Check frontmatter starts with ---
        const content = agent.content.trim();
        expect(content.startsWith('---')).toBe(true);

        // Check frontmatter can be parsed
        expect(agent.frontmatter).not.toBeNull();
        expect(typeof agent.frontmatter).toBe('object');
      });

      it('should not throw on frontmatter parsing', () => {
        expect(() => {
          const agent = readAgentFile(agentName);
          parseFrontmatter(agent.content);
        }).not.toThrow();
      });
    });
  }
});

// =============================================================================
// TRD-TEST-089: Required fields present
// =============================================================================

describe('TRD-TEST-089: Required fields present', () => {
  const existingAgents = REQUIRED_AGENTS.filter(name => {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    return fs.existsSync(filePath);
  });

  if (existingAgents.length === 0) {
    it.skip('No agent files exist yet - skipping required fields tests', () => {
      // This test is skipped when no agents exist
    });
  } else {
    describe.each(existingAgents)('Agent: %s', (agentName) => {
      let agent;

      beforeAll(() => {
        agent = readAgentFile(agentName);
      });

      it('should have a "name" field', () => {
        expect(agent.frontmatter).not.toBeNull();
        expect(agent.frontmatter).toHaveProperty('name');
        expect(typeof agent.frontmatter.name).toBe('string');
        expect(agent.frontmatter.name.length).toBeGreaterThan(0);
      });

      it('should have a "description" field', () => {
        expect(agent.frontmatter).not.toBeNull();
        expect(agent.frontmatter).toHaveProperty('description');
        expect(typeof agent.frontmatter.description).toBe('string');
        expect(agent.frontmatter.description.length).toBeGreaterThan(0);
      });
    });
  }
});

// =============================================================================
// TRD-TEST-090: Name matches filename
// =============================================================================

describe('TRD-TEST-090: Name matches filename', () => {
  const existingAgents = REQUIRED_AGENTS.filter(name => {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    return fs.existsSync(filePath);
  });

  if (existingAgents.length === 0) {
    it.skip('No agent files exist yet - skipping name-filename match tests', () => {
      // This test is skipped when no agents exist
    });
  } else {
    describe.each(existingAgents)('Agent: %s', (agentName) => {
      it('should have name field matching the filename', () => {
        const agent = readAgentFile(agentName);
        expect(agent).not.toBeNull();
        expect(agent.frontmatter).not.toBeNull();
        expect(agent.frontmatter.name).toBe(agentName);
      });
    });
  }
});

// =============================================================================
// TRD-TEST-091: Skills field format (if present)
// =============================================================================

describe('TRD-TEST-091: Skills field format (if present)', () => {
  const existingAgents = REQUIRED_AGENTS.filter(name => {
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    return fs.existsSync(filePath);
  });

  if (existingAgents.length === 0) {
    it.skip('No agent files exist yet - skipping skills field format tests', () => {
      // This test is skipped when no agents exist
    });
  } else {
    describe.each(existingAgents)('Agent: %s', (agentName) => {
      it('should have valid skills field format if skills field is present', () => {
        const agent = readAgentFile(agentName);
        expect(agent).not.toBeNull();
        expect(agent.frontmatter).not.toBeNull();

        // Skills field is optional
        if (!agent.frontmatter.hasOwnProperty('skills')) {
          // No skills field - this is allowed
          expect(true).toBe(true);
          return;
        }

        const skills = agent.frontmatter.skills;

        // Skills can be: array, string (comma-separated), or null/undefined (comments only in YAML)
        if (skills === null || skills === undefined) {
          // Empty skills (YAML with only comments) is valid
          expect(true).toBe(true);
          return;
        }

        // Convert to array for validation
        let skillList;
        if (Array.isArray(skills)) {
          skillList = skills;
        } else if (typeof skills === 'string') {
          skillList = skills.trim().length > 0 ? skills.split(',').map(s => s.trim()) : [];
        } else {
          // Unexpected type
          expect(Array.isArray(skills) || typeof skills === 'string').toBe(true);
          return;
        }

        // Each skill should be non-empty and kebab-case
        const validSkillPattern = /^[a-z0-9-]+$/;
        for (const skill of skillList) {
          if (typeof skill !== 'string') continue;
          expect(skill.length).toBeGreaterThan(0);
          if (!validSkillPattern.test(skill)) {
            console.log(`Invalid skill format: "${skill}" in agent ${agentName}`);
          }
          expect(validSkillPattern.test(skill)).toBe(true);
        }
      });
    });
  }
});

// =============================================================================
// TRD-TEST-092: No duplicate agent names
// =============================================================================

describe('TRD-TEST-092: No duplicate agent names', () => {
  it('should have no duplicate agent names across all agent files', () => {
    const existingAgents = REQUIRED_AGENTS.filter(name => {
      const filePath = path.join(AGENTS_DIR, `${name}.md`);
      return fs.existsSync(filePath);
    });

    if (existingAgents.length === 0) {
      // Skip if no agents exist
      console.log('No agent files exist yet - skipping duplicate name check');
      return;
    }

    const names = new Map();
    const duplicates = [];

    for (const agentName of existingAgents) {
      const agent = readAgentFile(agentName);

      if (agent && agent.frontmatter && agent.frontmatter.name) {
        const name = agent.frontmatter.name;

        if (names.has(name)) {
          duplicates.push({
            name,
            files: [names.get(name), `${agentName}.md`]
          });
        } else {
          names.set(name, `${agentName}.md`);
        }
      }
    }

    if (duplicates.length > 0) {
      console.log('Duplicate agent names found:');
      for (const dup of duplicates) {
        console.log(`  "${dup.name}" in files: ${dup.files.join(', ')}`);
      }
    }

    expect(duplicates).toHaveLength(0);
  });

  it('should have unique names for all 12 required agents', () => {
    // Verify that all required agent names are unique by definition
    const uniqueNames = new Set(REQUIRED_AGENTS);
    expect(uniqueNames.size).toBe(REQUIRED_AGENTS.length);
  });
});

// =============================================================================
// Summary Tests
// =============================================================================

describe('Agent Validation Summary', () => {
  it('should report overall validation status', () => {
    const existingAgents = getAgentFiles();
    const missingAgents = REQUIRED_AGENTS.filter(name => !existingAgents.includes(name));

    console.log('\n=== Agent Validation Summary ===');
    console.log(`Total Required Agents: ${REQUIRED_AGENTS.length}`);
    console.log(`Existing Agents: ${existingAgents.length}`);
    console.log(`Missing Agents: ${missingAgents.length}`);

    if (missingAgents.length > 0) {
      console.log(`\nMissing: ${missingAgents.join(', ')}`);
    }

    if (existingAgents.length > 0) {
      console.log(`\nExisting: ${existingAgents.join(', ')}`);
    }

    // This test just reports - it doesn't fail
    expect(true).toBe(true);
  });
});

// =============================================================================
// Helper Function Tests (Unit Tests)
// =============================================================================

describe('parseFrontmatter helper function', () => {
  it('should parse valid YAML frontmatter', () => {
    const content = `---
name: test-agent
description: A test agent
skills: skill-one, skill-two
---

# Agent Content
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result.name).toBe('test-agent');
    expect(result.description).toBe('A test agent');
    expect(result.skills).toBe('skill-one, skill-two');
  });

  it('should return null for content without frontmatter', () => {
    const content = `# Just a Markdown file

No frontmatter here.
`;
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('should return null for empty content', () => {
    expect(parseFrontmatter('')).toBeNull();
    expect(parseFrontmatter(null)).toBeNull();
    expect(parseFrontmatter(undefined)).toBeNull();
  });

  it('should return null for unclosed frontmatter', () => {
    const content = `---
name: broken
description: Missing closing delimiter
`;
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('should handle frontmatter with only required fields', () => {
    const content = `---
name: minimal-agent
description: Minimal description
---
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result.name).toBe('minimal-agent');
    expect(result.description).toBe('Minimal description');
    expect(result.skills).toBeUndefined();
  });

  it('should handle quoted strings in frontmatter', () => {
    const content = `---
name: "quoted-agent"
description: "Description with: colon"
---
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result.name).toBe('quoted-agent');
    expect(result.description).toBe('Description with: colon');
  });
});

describe('parseSimpleYaml helper function', () => {
  it('should parse basic key-value pairs', () => {
    const yaml = `name: test
description: A test`;
    const result = parseSimpleYaml(yaml);
    expect(result.name).toBe('test');
    expect(result.description).toBe('A test');
  });

  it('should ignore comments', () => {
    const yaml = `# This is a comment
name: test
# Another comment
description: value`;
    const result = parseSimpleYaml(yaml);
    expect(result.name).toBe('test');
    expect(result.description).toBe('value');
    expect(result['# This is a comment']).toBeUndefined();
  });

  it('should handle empty lines', () => {
    const yaml = `name: test

description: value`;
    const result = parseSimpleYaml(yaml);
    expect(result.name).toBe('test');
    expect(result.description).toBe('value');
  });

  it('should remove surrounding quotes', () => {
    const yaml = `name: "quoted"
description: 'single quoted'`;
    const result = parseSimpleYaml(yaml);
    expect(result.name).toBe('quoted');
    expect(result.description).toBe('single quoted');
  });
});

// =============================================================================
// Exports for potential reuse
// =============================================================================

module.exports = {
  REQUIRED_AGENTS,
  AGENTS_DIR,
  parseFrontmatter,
  parseSimpleYaml,
  getAgentFiles,
  readAgentFile
};
