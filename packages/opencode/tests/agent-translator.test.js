/**
 * Unit tests for AgentTranslator (OC-S2-AGT-001 through OC-S2-AGT-011)
 * and snapshot tests (OC-S2-TEST-004, OC-S2-TEST-005, OC-S2-TEST-006)
 *
 * TDD: These tests are written BEFORE the implementation.
 * Strategy: Test each translation concern independently, then snapshot
 * the full output for 5 representative agents.
 *
 * Skills used: jest (test patterns, mocking, snapshot testing)
 */

const path = require('path');
const fs = require('fs');

const {
  AgentTranslator,
} = require('../../../scripts/generate-opencode/src/agent-translator.js');

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

// ---------------------------------------------------------------------------
// OC-S2-AGT-001: Parse Ensemble agent YAML schema
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-001: AgentTranslator YAML parsing', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should instantiate with required options', () => {
    expect(translator).toBeDefined();
    expect(translator.packagesDir).toBe(PACKAGES_DIR);
    expect(translator.outputDir).toBe('/tmp/test-agent-output');
    expect(translator.dryRun).toBe(true);
  });

  it('should parse a valid agent YAML file with metadata', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    expect(agent).toBeDefined();
    expect(agent.metadata).toBeDefined();
    expect(agent.metadata.name).toBe('backend-developer');
    expect(agent.metadata.description).toContain('server-side logic');
    expect(agent.metadata.category).toBe('specialist');
    expect(agent.metadata.tools).toEqual(
      expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'])
    );
  });

  it('should parse mission summary from agent YAML', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    expect(agent.mission).toBeDefined();
    expect(agent.mission.summary).toContain('backend development specialist');
  });

  it('should parse responsibilities from agent YAML', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    expect(agent.responsibilities).toBeDefined();
    expect(Array.isArray(agent.responsibilities)).toBe(true);
    expect(agent.responsibilities.length).toBeGreaterThanOrEqual(3);
    expect(agent.responsibilities[0].title).toBe('API Development');
    expect(agent.responsibilities[0].priority).toBe('high');
  });

  it('should parse integration protocols from agent YAML', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    expect(agent.integrationProtocols).toBeDefined();
    expect(agent.integrationProtocols.handoffFrom).toBeDefined();
    expect(agent.integrationProtocols.handoffTo).toBeDefined();
  });

  it('should parse delegation criteria from agent YAML', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    expect(agent.delegationCriteria).toBeDefined();
    expect(agent.delegationCriteria.whenToUse).toBeDefined();
    expect(agent.delegationCriteria.whenToDelegate).toBeDefined();
    expect(agent.delegationCriteria.whenToDelegate.length).toBeGreaterThan(0);
  });

  it('should throw for a non-existent file', () => {
    expect(() => {
      translator.parseAgentYaml('/nonexistent/path.yaml');
    }).toThrow(/not found/);
  });

  it('should discover all agent YAML files across packages', () => {
    const files = translator.discoverAgentFiles();
    expect(files.length).toBeGreaterThanOrEqual(20);
    // All files should be absolute paths to .yaml files
    for (const f of files) {
      expect(f).toMatch(/\.yaml$/);
      expect(path.isAbsolute(f)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-002: Tool permission mapping
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-002: Tool permission mapping', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should map Read to read: "allow"', () => {
    const perms = translator.mapToolPermissions(['Read']);
    expect(perms.read).toBe('allow');
  });

  it('should map Grep and Glob to read: "allow"', () => {
    const perms = translator.mapToolPermissions(['Grep', 'Glob']);
    expect(perms.read).toBe('allow');
  });

  it('should map Write to edit: "allow"', () => {
    const perms = translator.mapToolPermissions(['Write']);
    expect(perms.edit).toBe('allow');
  });

  it('should map Edit to edit: "allow"', () => {
    const perms = translator.mapToolPermissions(['Edit']);
    expect(perms.edit).toBe('allow');
  });

  it('should map Bash to bash: "ask"', () => {
    const perms = translator.mapToolPermissions(['Bash']);
    expect(perms.bash).toBe('ask');
  });

  it('should not map Task (no direct OpenCode mapping)', () => {
    const perms = translator.mapToolPermissions(['Task']);
    expect(perms.bash).toBeUndefined();
    expect(perms.read).toBeUndefined();
    expect(perms.edit).toBeUndefined();
  });

  it('should combine all permissions from a full tool set', () => {
    const perms = translator.mapToolPermissions([
      'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task',
    ]);
    expect(perms).toEqual({
      read: 'allow',
      edit: 'allow',
      bash: 'ask',
    });
  });

  it('should handle empty tools array', () => {
    const perms = translator.mapToolPermissions([]);
    expect(perms).toEqual({});
  });

  it('should handle unknown tools gracefully', () => {
    const perms = translator.mapToolPermissions(['TodoWrite', 'AskUserQuestion']);
    expect(perms).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-003: Mission/responsibilities to prompt field
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-003: Prompt generation from mission and responsibilities', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should include mission summary in prompt', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    expect(prompt).toContain('## Mission');
    expect(prompt).toContain('backend development specialist');
  });

  it('should include responsibilities in prompt', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    expect(prompt).toContain('## Responsibilities');
    expect(prompt).toContain('API Development');
    expect(prompt).toContain('Database Integration');
  });

  it('should include boundaries in prompt when present', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    expect(prompt).toContain('## Boundaries');
    expect(prompt).toContain('Handles');
    expect(prompt).toContain('Does Not Handle');
  });

  it('should include delegation criteria in prompt when present', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    expect(prompt).toContain('## Delegation');
  });

  it('should include integration protocols (handoff from/to) in prompt', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    expect(prompt).toContain('## Receives Work From');
    expect(prompt).toContain('## Hands Off To');
  });

  it('should produce a non-empty prompt string', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-workflow-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(50);
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-004: Agent mode classification
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-004: Agent mode classification', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should classify orchestrator category as primary', () => {
    expect(translator.classifyMode('orchestrator')).toBe('primary');
  });

  it('should classify specialist category as subagent', () => {
    expect(translator.classifyMode('specialist')).toBe('subagent');
  });

  it('should classify developer category as subagent', () => {
    expect(translator.classifyMode('developer')).toBe('subagent');
  });

  it('should classify quality category as subagent', () => {
    expect(translator.classifyMode('quality')).toBe('subagent');
  });

  it('should classify utility category as subagent', () => {
    expect(translator.classifyMode('utility')).toBe('subagent');
  });

  it('should classify workflow category as subagent', () => {
    expect(translator.classifyMode('workflow')).toBe('subagent');
  });

  it('should classify infrastructure category as subagent', () => {
    expect(translator.classifyMode('infrastructure')).toBe('subagent');
  });

  it('should classify testing category as subagent', () => {
    expect(translator.classifyMode('testing')).toBe('subagent');
  });

  it('should default to subagent for unknown categories', () => {
    expect(translator.classifyMode('unknown')).toBe('subagent');
    expect(translator.classifyMode(undefined)).toBe('subagent');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-005: Model hint translation
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-005: Model hint translation', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should map opus to anthropic/claude-opus-4-6', () => {
    const model = translator.mapModelHint('opus');
    expect(model).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-opus-4-6',
    });
  });

  it('should map sonnet to anthropic/claude-sonnet-4-6', () => {
    const model = translator.mapModelHint('sonnet');
    expect(model).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-6',
    });
  });

  it('should map haiku to anthropic/claude-haiku-4-5-20251001', () => {
    const model = translator.mapModelHint('haiku');
    expect(model).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-haiku-4-5-20251001',
    });
  });

  it('should default to sonnet when no model specified', () => {
    const model = translator.mapModelHint(undefined);
    expect(model).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-6',
    });
  });

  it('should default to sonnet for null input', () => {
    const model = translator.mapModelHint(null);
    expect(model).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-6',
    });
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-006: Generate JSON config entries
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-006: JSON config entry generation', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should generate config entry for a developer agent', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);

    expect(entry).toBeDefined();
    const key = Object.keys(entry)[0];
    expect(key).toBe('ensemble-backend-developer');

    const config = entry[key];
    expect(config.name).toBe('ensemble-backend-developer');
    expect(config.description).toContain('server-side logic');
    expect(config.mode).toBe('subagent');
    expect(config.model).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-6',
    });
    expect(config.permission).toEqual({
      read: 'allow',
      edit: 'allow',
      bash: 'ask',
    });
    expect(config.prompt).toContain('## Mission');
  });

  it('should generate config entry for an orchestrator agent', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);

    const key = Object.keys(entry)[0];
    expect(key).toBe('ensemble-ensemble-orchestrator');

    const config = entry[key];
    expect(config.mode).toBe('primary');
  });

  it('should prefix agent names with ensemble-', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    const key = Object.keys(entry)[0];
    expect(key).toBe('ensemble-code-reviewer');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-007: Generate Markdown agent files
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-007: Markdown agent file generation', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should generate Markdown content with agent name as heading', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toContain('# Backend Developer');
  });

  it('should include description in Markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toContain('server-side logic');
  });

  it('should include mode annotation in Markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toContain('**Mode:** primary');
  });

  it('should include category in Markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toContain('**Category:** quality');
  });

  it('should include the full prompt content in Markdown body', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toContain('## Mission');
    expect(md).toContain('## Responsibilities');
  });

  it('should generate output path based on agent name', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const outputPath = translator.getOutputPath(agent);
    expect(outputPath).toBe(
      path.join('/tmp/test-agent-output', 'backend-developer.md')
    );
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-008: Delegation hierarchy extraction
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-008: Delegation hierarchy extraction', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should extract delegation targets from delegationCriteria', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const hierarchy = translator.extractDelegationHierarchy(agent);
    expect(hierarchy).toBeDefined();
    expect(hierarchy.delegatesTo).toContain('tech-lead-orchestrator');
    expect(hierarchy.delegatesTo).toContain('backend-developer');
    expect(hierarchy.delegatesTo).toContain('code-reviewer');
  });

  it('should extract handoff sources from integrationProtocols', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const hierarchy = translator.extractDelegationHierarchy(agent);
    expect(hierarchy.receivesFrom).toContain('tech-lead-orchestrator');
  });

  it('should extract handoff targets from integrationProtocols', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const hierarchy = translator.extractDelegationHierarchy(agent);
    expect(hierarchy.handsOffTo).toContain('code-reviewer');
  });

  it('should handle agents without delegation criteria', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-workflow-agent.yaml')
    );
    const hierarchy = translator.extractDelegationHierarchy(agent);
    expect(hierarchy.delegatesTo).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-009: Routing prompt for primary orchestrator
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-009: Routing prompt generation', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should generate a routing prompt string', () => {
    // To generate routing prompt, we need to parse multiple agents
    // and build the full agent map
    const agents = [
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-workflow-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-utility-agent.yaml')),
    ];
    const routingPrompt = translator.generateRoutingPrompt(agents);
    expect(typeof routingPrompt).toBe('string');
    expect(routingPrompt.length).toBeGreaterThan(100);
  });

  it('should include Agent Delegation Map heading', () => {
    const agents = [
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')),
    ];
    const routingPrompt = translator.generateRoutingPrompt(agents);
    expect(routingPrompt).toContain('## Agent Delegation Map');
  });

  it('should reference agents with @agent-name format', () => {
    const agents = [
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')),
    ];
    const routingPrompt = translator.generateRoutingPrompt(agents);
    expect(routingPrompt).toContain('@ensemble-backend-developer');
    expect(routingPrompt).toContain('@ensemble-code-reviewer');
  });

  it('should group agents by category', () => {
    const agents = [
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-workflow-agent.yaml')),
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-utility-agent.yaml')),
    ];
    const routingPrompt = translator.generateRoutingPrompt(agents);
    expect(routingPrompt).toContain('### Orchestrators');
    expect(routingPrompt).toMatch(/### (Specialists|Developers)/);
  });

  it('should include agent descriptions in routing prompt', () => {
    const agents = [
      translator.parseAgentYaml(path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')),
    ];
    const routingPrompt = translator.generateRoutingPrompt(agents);
    expect(routingPrompt).toContain('server-side logic');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-TEST-005: Routing prompt with real agent data
// ---------------------------------------------------------------------------
describe('OC-S2-TEST-005: Routing prompt with real agents', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should generate routing prompt referencing all discovered agents', () => {
    const files = translator.discoverAgentFiles();
    const agents = files.map((f) => translator.parseAgentYaml(f));
    const routingPrompt = translator.generateRoutingPrompt(agents);

    // Should reference all agents with @agent-name format
    for (const agent of agents) {
      expect(routingPrompt).toContain(`@ensemble-${agent.metadata.name}`);
    }
  });

  it('should include delegation criteria in routing prompt for orchestrators', () => {
    const files = translator.discoverAgentFiles();
    const agents = files.map((f) => translator.parseAgentYaml(f));
    const routingPrompt = translator.generateRoutingPrompt(agents);

    // The routing prompt should mention when to delegate
    expect(routingPrompt).toContain('delegate');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-010: @agent-name reference injection
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-010: @agent-name reference injection', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should inject @agent-name references in delegation prompt text', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    // Delegation section should use @ensemble-agent-name format
    expect(prompt).toContain('@ensemble-tech-lead-orchestrator');
    expect(prompt).toContain('@ensemble-backend-developer');
  });

  it('should inject @agent-name references in handoff sections', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const prompt = translator.generatePrompt(agent);
    expect(prompt).toContain('@ensemble-tech-lead-orchestrator');
    expect(prompt).toContain('@ensemble-code-reviewer');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-AGT-011: Category metadata tags
// ---------------------------------------------------------------------------
describe('OC-S2-AGT-011: Category metadata tags', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should classify agent categories correctly', () => {
    expect(translator.classifyCategory('orchestrator')).toBe('orchestrator');
    expect(translator.classifyCategory('specialist')).toBe('specialist');
    expect(translator.classifyCategory('quality')).toBe('quality');
    expect(translator.classifyCategory('utility')).toBe('utility');
    expect(translator.classifyCategory('workflow')).toBe('workflow');
    expect(translator.classifyCategory('infrastructure')).toBe('infrastructure');
    expect(translator.classifyCategory('developer')).toBe('developer');
    expect(translator.classifyCategory('testing')).toBe('testing');
  });

  it('should default unknown categories to utility', () => {
    expect(translator.classifyCategory('unknown')).toBe('utility');
    expect(translator.classifyCategory(undefined)).toBe('utility');
  });

  it('should include category tag in config entry', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    const config = Object.values(entry)[0];
    expect(config.metadata).toBeDefined();
    expect(config.metadata.category).toBe('quality');
  });

  it('should include category tag in config for orchestrators', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    const config = Object.values(entry)[0];
    expect(config.metadata.category).toBe('orchestrator');
  });
});

// ---------------------------------------------------------------------------
// OC-S2-TEST-004: Full pipeline execution
// ---------------------------------------------------------------------------
describe('OC-S2-TEST-004: Full pipeline execution', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should execute the full translation pipeline', () => {
    const result = translator.executeSync();

    expect(result).toBeDefined();
    expect(result.agents).toBeDefined();
    expect(Array.isArray(result.agents)).toBe(true);
    expect(result.agents.length).toBeGreaterThanOrEqual(20);
  });

  it('should produce a config block with all agents', () => {
    const result = translator.executeSync();
    const keys = Object.keys(result.configBlock);
    expect(keys.length).toBeGreaterThanOrEqual(20);
    // All keys should be prefixed with ensemble-
    for (const key of keys) {
      expect(key).toMatch(/^ensemble-/);
    }
  });

  it('should generate a routing prompt', () => {
    const result = translator.executeSync();
    expect(result.routingPrompt).toBeDefined();
    expect(typeof result.routingPrompt).toBe('string');
    expect(result.routingPrompt.length).toBeGreaterThan(100);
  });

  it('should report errors array (may be empty)', () => {
    const result = translator.executeSync();
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should produce translated agents with all required fields', () => {
    const result = translator.executeSync();
    for (const agent of result.agents) {
      expect(agent.markdownPath).toBeDefined();
      expect(agent.markdownContent).toBeDefined();
      expect(agent.configEntry).toBeDefined();
      expect(agent.sourcePath).toBeDefined();
      expect(typeof agent.markdownContent).toBe('string');
      expect(agent.markdownContent.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// OC-S2-TEST-006: Snapshot tests for 5 representative agents
// ---------------------------------------------------------------------------
describe('OC-S2-TEST-006: Snapshot tests for representative agents', () => {
  let translator;

  beforeEach(() => {
    translator = new AgentTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-agent-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should match snapshot for orchestrator agent config', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    expect(entry).toMatchSnapshot();
  });

  it('should match snapshot for developer agent config', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    expect(entry).toMatchSnapshot();
  });

  it('should match snapshot for quality agent config', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    expect(entry).toMatchSnapshot();
  });

  it('should match snapshot for workflow agent config', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-workflow-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    expect(entry).toMatchSnapshot();
  });

  it('should match snapshot for utility agent config', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-utility-agent.yaml')
    );
    const entry = translator.generateConfigEntry(agent);
    expect(entry).toMatchSnapshot();
  });

  it('should match snapshot for orchestrator agent markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-orchestrator-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toMatchSnapshot();
  });

  it('should match snapshot for developer agent markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-developer-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toMatchSnapshot();
  });

  it('should match snapshot for quality agent markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-quality-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toMatchSnapshot();
  });

  it('should match snapshot for workflow agent markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-workflow-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toMatchSnapshot();
  });

  it('should match snapshot for utility agent markdown', () => {
    const agent = translator.parseAgentYaml(
      path.join(FIXTURES_DIR, 'sample-utility-agent.yaml')
    );
    const md = translator.generateMarkdown(agent);
    expect(md).toMatchSnapshot();
  });
});
