/**
 * Unit tests for CommandTranslator (OC-S1-CMD-001 through OC-S1-CMD-010)
 * and snapshot tests (OC-S1-TEST-002, OC-S1-TEST-003)
 *
 * TDD: These tests are written BEFORE the implementation.
 * Strategy: Test each translation concern independently, then snapshot
 * the full Markdown output for representative commands.
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

// The CommandTranslator is implemented as a CommonJS module in
// scripts/generate-opencode/src/ for compatibility with both Jest and ts-node.
const {
  CommandTranslator,
} = require('../../../scripts/generate-opencode/src/command-translator.js');

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');

// Helper: load a YAML fixture
function loadFixture(name) {
  const content = fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
  return yaml.load(content);
}

// Helper: load a YAML fixture as raw string
function loadFixtureRaw(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

// ---------------------------------------------------------------------------
// OC-S1-CMD-001: Parse Ensemble command YAML schema
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-001: CommandTranslator class construction and YAML parsing', () => {
  it('should instantiate with required options', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
    expect(translator).toBeDefined();
  });

  it('should parse a valid command YAML file', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
    const parsed = translator.parseCommandYaml(
      path.join(FIXTURES_DIR, 'simple-command.yaml')
    );
    expect(parsed).toBeDefined();
    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata.name).toBe('ensemble:fold-prompt');
    expect(parsed.workflow).toBeDefined();
    expect(parsed.workflow.phases).toHaveLength(2);
  });

  it('should extract metadata fields correctly', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
    const parsed = translator.parseCommandYaml(
      path.join(FIXTURES_DIR, 'command-with-arguments.yaml')
    );
    expect(parsed.metadata.name).toBe('ensemble:create-trd');
    expect(parsed.metadata.version).toBe('2.0.0');
    expect(parsed.metadata.category).toBe('planning');
    expect(parsed.metadata.model).toBe('opus-4-6');
  });

  it('should extract mission summary', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
    const parsed = translator.parseCommandYaml(
      path.join(FIXTURES_DIR, 'simple-command.yaml')
    );
    expect(parsed.mission).toBeDefined();
    expect(parsed.mission.summary).toContain('Advanced Claude environment optimization');
  });

  it('should extract workflow phases and steps', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
    const parsed = translator.parseCommandYaml(
      path.join(FIXTURES_DIR, 'command-with-arguments.yaml')
    );
    expect(parsed.workflow.phases).toHaveLength(3);
    expect(parsed.workflow.phases[0].name).toBe('PRD Analysis & Validation');
    expect(parsed.workflow.phases[0].steps).toHaveLength(2);
    expect(parsed.workflow.phases[1].steps[0].delegation).toBeDefined();
    expect(parsed.workflow.phases[1].steps[0].delegation.agent).toBe(
      'ensemble-orchestrator'
    );
  });

  it('should throw on invalid YAML file', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
    expect(() =>
      translator.parseCommandYaml('/nonexistent/path.yaml')
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-002: YAML metadata to Markdown header translation
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-002: Markdown header translation', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should generate Markdown title from metadata.name (strip namespace, title-case)', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // ensemble:fold-prompt -> "Fold Prompt"
    expect(markdown).toMatch(/^# Fold Prompt/m);
  });

  it('should include description as a paragraph after heading', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain(
      'Advanced Claude environment optimization'
    );
  });

  it('should include mission summary after description', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('documentation enhancement for maximum productivity gains');
  });

  it('should add $PLACEHOLDER to title for commands that use $ARGUMENTS', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // create-trd uses $ARGUMENTS -> $PRD_PATH placeholder
    expect(markdown).toMatch(/^# Create TRD \$/m);
  });

  it('should not add $PLACEHOLDER to title for commands without arguments', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toMatch(/^# Fold Prompt$/m);
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-003: $ARGUMENTS to $PLACEHOLDER_NAME syntax conversion
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-003: Argument placeholder conversion', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should replace $ARGUMENTS with specific placeholder name in body text', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // $ARGUMENTS should be replaced with a specific placeholder
    expect(markdown).not.toContain('$ARGUMENTS');
    expect(markdown).toMatch(/\$[A-Z_]+/);
  });

  it('should derive placeholder name from command name for commands with $ARGUMENTS', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // create-trd -> $PRD_PATH based on TRD argument mapping
    expect(markdown).toContain('$PRD_PATH');
  });

  it('should generate placeholders from parameters section when available', () => {
    const parsed = loadFixture('command-with-params.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // fix-issue has explicit parameters section
    expect(markdown).toMatch(/\$DESCRIPTION|\$ISSUE|\$BRANCH/);
  });

  it('should leave body text unchanged when no arguments exist', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).not.toMatch(/\$[A-Z_]{2,}/);
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-004: Workflow phases/steps to numbered Markdown sections
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-004: Workflow phase and step rendering', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should render each phase as ## Phase N: Title', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('## Phase 1: Intelligent Discovery & Context Mapping');
    expect(markdown).toContain('## Phase 2: Strategic Optimization & Enhancement');
  });

  it('should render each step as ### Step N.M: Title', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('### Step 1.1: Deep Project Analysis');
    expect(markdown).toContain('### Step 1.2: Context Intelligence Gathering');
    expect(markdown).toContain('### Step 2.1: CLAUDE.md Intelligence Enhancement');
  });

  it('should include step descriptions', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('Scan directory structure with pattern recognition');
  });

  it('should render actions as bullet points under steps', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('- Analyze codebase architecture and technology stack');
    expect(markdown).toContain('- Identify documentation gaps');
  });

  it('should handle phases with many steps correctly', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // Phase 1 has 2 steps, Phase 2 has 2 steps, Phase 3 has 1 step
    expect(markdown).toContain('### Step 1.1: PRD Ingestion');
    expect(markdown).toContain('### Step 1.2: Requirements Validation');
    expect(markdown).toContain('### Step 2.1: Ensemble Orchestrator');
    expect(markdown).toContain('### Step 2.2: Tech Lead Orchestrator');
    expect(markdown).toContain('### Step 3.1: TRD Creation');
  });

  it('should handle a minimal command with one phase and one step', () => {
    const parsed = loadFixture('minimal-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('## Phase 1: Single Phase');
    expect(markdown).toContain('### Step 1.1: Only Step');
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-005: Constraints section rendering
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-005: Constraints section', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should render constraints as ## Constraints with bullet list', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('## Constraints');
    expect(markdown).toContain(
      '- DO NOT implement, build, or execute any technical work described in the requirements'
    );
    expect(markdown).toContain('- This command creates ONLY a TRD document');
  });

  it('should omit constraints section when none defined', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).not.toContain('## Constraints');
  });

  it('should render all constraints for commands with multiple', () => {
    const parsed = loadFixture('command-with-params.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('## Constraints');
    expect(markdown).toContain('- GitHub only');
    expect(markdown).toContain('- GitHub CLI (gh) must be installed');
    expect(markdown).toContain('- Tests must pass unless --skip-tests');
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-006: Expected output section rendering
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-006: Expected output section', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should render expected output as ## Expected Output section', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('## Expected Output');
    expect(markdown).toContain('Optimized Claude Configuration');
  });

  it('should list output structure items', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('**CLAUDE.md**');
    expect(markdown).toContain('Optimized with intelligent context management');
    expect(markdown).toContain('**README.md**');
  });

  it('should omit expected output section when not defined', () => {
    const parsed = loadFixture('minimal-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).not.toContain('## Expected Output');
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-007: Delegation step annotations
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-007: Delegation annotations', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should add agent annotation for steps with delegation', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('**Agent:** @ensemble-orchestrator');
    expect(markdown).toContain('**Agent:** @tech-lead-orchestrator');
  });

  it('should include delegation context', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('Validated PRD with acceptance criteria');
    expect(markdown).toContain('Product requirements requiring technical translation');
  });

  it('should not add agent annotation for steps without delegation', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).not.toContain('**Agent:**');
  });

  it('should annotate multiple delegation steps in the same command', () => {
    const parsed = loadFixture('command-with-params.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toContain('**Agent:** @general-purpose');
    expect(markdown).toContain('**Agent:** @test-runner');
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-008: Generate JSON command config entries
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-008: JSON config entry generation', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should generate a config entry with command name as key', () => {
    const parsed = loadFixture('simple-command.yaml');
    const config = translator.generateConfigEntry(parsed);
    expect(config).toHaveProperty('ensemble:fold-prompt');
  });

  it('should include description in config entry', () => {
    const parsed = loadFixture('simple-command.yaml');
    const config = translator.generateConfigEntry(parsed);
    expect(config['ensemble:fold-prompt'].description).toContain(
      'Advanced Claude environment optimization'
    );
  });

  it('should set subtask to false for top-level commands', () => {
    const parsed = loadFixture('simple-command.yaml');
    const config = translator.generateConfigEntry(parsed);
    expect(config['ensemble:fold-prompt'].subtask).toBe(false);
  });

  it('should include agent field when model hint is present', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const config = translator.generateConfigEntry(parsed);
    // opus-4-6 model hint should result in an agent field
    expect(config['ensemble:create-trd']).toHaveProperty('agent');
  });

  it('should not include agent field when no model hint', () => {
    const parsed = loadFixture('simple-command.yaml');
    const config = translator.generateConfigEntry(parsed);
    // No model hint -> default agent or no agent field
    expect(config['ensemble:fold-prompt'].agent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-009: Model hint to OpenCode providerID/modelID mapping
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-009: Model hint mapping', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should map opus-4-6 to anthropic/claude-opus-4-6', () => {
    expect(translator.mapModelHint('opus-4-6')).toBe(
      'anthropic/claude-opus-4-6'
    );
  });

  it('should map opus to anthropic/claude-opus-4-6', () => {
    expect(translator.mapModelHint('opus')).toBe(
      'anthropic/claude-opus-4-6'
    );
  });

  it('should map sonnet-4 to anthropic/claude-sonnet-4-20250514', () => {
    expect(translator.mapModelHint('sonnet-4')).toBe(
      'anthropic/claude-sonnet-4-20250514'
    );
  });

  it('should map sonnet to anthropic/claude-sonnet-4-20250514', () => {
    expect(translator.mapModelHint('sonnet')).toBe(
      'anthropic/claude-sonnet-4-20250514'
    );
  });

  it('should map haiku to anthropic/claude-haiku-4-5-20251001', () => {
    expect(translator.mapModelHint('haiku')).toBe(
      'anthropic/claude-haiku-4-5-20251001'
    );
  });

  it('should return undefined for unknown model hints', () => {
    expect(translator.mapModelHint('unknown')).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    expect(translator.mapModelHint(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OC-S1-CMD-010: Write translated commands to output directory
// ---------------------------------------------------------------------------
describe('OC-S1-CMD-010: File output (dry-run)', () => {
  const tmpDir = path.join('/tmp', 'ensemble-cmd-test-' + Date.now());

  afterAll(() => {
    // Clean up temp directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should discover all command YAML files in packages/', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: tmpDir,
      dryRun: true,
      verbose: false,
    });
    const files = translator.discoverCommandFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    files.forEach((f) => {
      expect(f).toMatch(/\.yaml$/);
    });
  });

  it('should produce a TranslatedCommand for each discovered YAML', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: tmpDir,
      dryRun: true,
      verbose: false,
    });
    const result = translator.executeSync();
    expect(result.commands.length).toBeGreaterThanOrEqual(10);
    result.commands.forEach((cmd) => {
      expect(cmd.markdownContent).toBeDefined();
      expect(cmd.markdownContent.length).toBeGreaterThan(0);
      expect(cmd.markdownPath).toMatch(/\.md$/);
      expect(cmd.configEntry).toBeDefined();
      expect(cmd.sourcePath).toMatch(/\.yaml$/);
    });
  });

  it('should write Markdown files to output directory when not dry-run', () => {
    const outputDir = path.join(tmpDir, 'write-test');
    const translator = new CommandTranslator({
      packagesDir: FIXTURES_DIR,
      outputDir: outputDir,
      dryRun: false,
      verbose: false,
    });
    // Use fixtures dir as packagesDir so it finds our test yamls
    // We need to override discovery for this test
    const parsed = loadFixture('simple-command.yaml');
    const md = translator.translateToMarkdown(parsed);
    const outPath = path.join(outputDir, 'fold-prompt.md');

    // Ensure directory exists
    fs.mkdirSync(outputDir, { recursive: true });
    translator.writeCommandFile(outPath, md);

    expect(fs.existsSync(outPath)).toBe(true);
    const written = fs.readFileSync(outPath, 'utf-8');
    expect(written).toContain('# Fold Prompt');
  });

  it('should generate a combined config block with all commands', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: tmpDir,
      dryRun: true,
      verbose: false,
    });
    const result = translator.executeSync();
    expect(result.configBlock).toBeDefined();
    expect(typeof result.configBlock).toBe('object');
    // Should have keys like "ensemble:fold-prompt", "ensemble:create-trd", etc.
    const keys = Object.keys(result.configBlock);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    keys.forEach((key) => {
      expect(key).toMatch(/^ensemble:/);
    });
  });

  it('should collect errors without throwing for individual translation failures', () => {
    const translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: tmpDir,
      dryRun: true,
      verbose: false,
    });
    const result = translator.executeSync();
    expect(result.errors).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OC-S1-TEST-002: Integration-level unit tests
// ---------------------------------------------------------------------------
describe('OC-S1-TEST-002: Full translation integration', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should translate a complete command YAML to valid Markdown', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);

    // Must have title
    expect(markdown).toMatch(/^# /m);

    // Must have at least one phase
    expect(markdown).toMatch(/^## Phase \d+:/m);

    // Must have at least one step
    expect(markdown).toMatch(/^### Step \d+\.\d+:/m);

    // Must have constraints
    expect(markdown).toContain('## Constraints');

    // Must have expected output
    expect(markdown).toContain('## Expected Output');
  });

  it('should produce Markdown that does not contain raw YAML syntax', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);

    // Should not contain YAML-specific syntax artifacts
    expect(markdown).not.toMatch(/^---$/m);
    expect(markdown).not.toContain('metadata:');
    expect(markdown).not.toContain('workflow:');
    expect(markdown).not.toContain('phases:');
  });

  it('should include all phases from the source command', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);

    expect(markdown).toContain('Phase 1:');
    expect(markdown).toContain('Phase 2:');
    expect(markdown).toContain('Phase 3:');
  });

  it('should preserve the order of phases and steps', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);

    const phase1Idx = markdown.indexOf('Phase 1:');
    const phase2Idx = markdown.indexOf('Phase 2:');
    const phase3Idx = markdown.indexOf('Phase 3:');

    expect(phase1Idx).toBeLessThan(phase2Idx);
    expect(phase2Idx).toBeLessThan(phase3Idx);
  });
});

// ---------------------------------------------------------------------------
// OC-S1-TEST-003: Snapshot tests for representative commands
// ---------------------------------------------------------------------------
describe('OC-S1-TEST-003: Snapshot tests for generated Markdown', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should match snapshot for simple command (fold-prompt)', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toMatchSnapshot();
  });

  it('should match snapshot for command with $ARGUMENTS (create-trd)', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toMatchSnapshot();
  });

  it('should match snapshot for command with parameters (fix-issue)', () => {
    const parsed = loadFixture('command-with-params.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toMatchSnapshot();
  });

  it('should match snapshot for minimal command', () => {
    const parsed = loadFixture('minimal-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    expect(markdown).toMatchSnapshot();
  });

  it('should match snapshot for JSON config entry (create-trd)', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const config = translator.generateConfigEntry(parsed);
    expect(config).toMatchSnapshot();
  });

  it('should match snapshot for JSON config entry (fix-issue)', () => {
    const parsed = loadFixture('command-with-params.yaml');
    const config = translator.generateConfigEntry(parsed);
    expect(config).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Edge cases and error handling
// ---------------------------------------------------------------------------
describe('Edge cases and error handling', () => {
  let translator;

  beforeEach(() => {
    translator = new CommandTranslator({
      packagesDir: PACKAGES_DIR,
      outputDir: '/tmp/test-output',
      dryRun: true,
      verbose: false,
    });
  });

  it('should handle commands with no actions in steps gracefully', () => {
    const parsed = loadFixture('minimal-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // Should not crash, just skip the actions section
    expect(markdown).toContain('### Step 1.1: Only Step');
    expect(markdown).not.toContain('undefined');
  });

  it('should handle multiline descriptions', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    // The description spans multiple lines in YAML
    expect(markdown).toBeDefined();
    expect(markdown.length).toBeGreaterThan(0);
  });

  it('should strip trailing whitespace from generated Markdown', () => {
    const parsed = loadFixture('simple-command.yaml');
    const markdown = translator.translateToMarkdown(parsed);
    const lines = markdown.split('\n');
    lines.forEach((line) => {
      expect(line).toBe(line.trimEnd());
    });
  });

  it('should generate valid command name in output path (strip namespace)', () => {
    const parsed = loadFixture('command-with-arguments.yaml');
    const outputPath = translator.getOutputPath(parsed);
    expect(outputPath).toContain('create-trd.md');
    expect(outputPath).not.toContain('ensemble:');
  });
});
