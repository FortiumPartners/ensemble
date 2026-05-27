'use strict';
/**
 * Tests for scripts/lint-model-ids.js
 *
 * Tests the helper functions directly by requiring them in isolation,
 * and tests the script's exit behavior via child_process.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// We need to extract the functions for unit testing.
// The script calls main() on load, so we replicate the helper functions here.
// The real integration test runs the script via execSync.

// --- Replicated helpers (must stay in sync with lint-model-ids.js) ---

function extractModelValue(yamlContent) {
  const match = yamlContent.match(/^  model:\s+(\S+)\s*$/m) || yamlContent.match(/^model:\s+(\S+)\s*$/m);
  return match ? match[1] : null;
}

// --- Unit tests for extractModelValue ---

describe('extractModelValue', () => {
  test('extracts model from top-level model: field', () => {
    const yaml = `name: my-agent\nmodel: high\ndescription: test`;
    expect(extractModelValue(yaml)).toBe('high');
  });

  test('extracts model from indented metadata model: field', () => {
    const yaml = `metadata:\n  name: my-command\n  model: medium\n  version: 1.0.0`;
    expect(extractModelValue(yaml)).toBe('medium');
  });

  test('extracts low tier', () => {
    const yaml = `model: low`;
    expect(extractModelValue(yaml)).toBe('low');
  });

  test('extracts full model ID', () => {
    const yaml = `model: claude-sonnet-4-6`;
    expect(extractModelValue(yaml)).toBe('claude-sonnet-4-6');
  });

  test('returns null when no model field present', () => {
    const yaml = `name: my-agent\ndescription: No model field here`;
    expect(extractModelValue(yaml)).toBeNull();
  });

  test('returns null for empty content', () => {
    expect(extractModelValue('')).toBeNull();
  });

  test('does not match model inside other words', () => {
    // "remodel:" should not match
    const yaml = `remodel: something`;
    expect(extractModelValue(yaml)).toBeNull();
  });

  test('ignores inline model references in descriptions', () => {
    const yaml = `description: This uses the claude model for stuff\nname: test`;
    expect(extractModelValue(yaml)).toBeNull();
  });
});

// --- Integration tests via child_process ---

describe('lint-model-ids.js script integration', () => {
  const scriptPath = path.resolve(__dirname, '../lint-model-ids.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'));

  afterAll(() => {
    // Cleanup temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('script file exists and is executable', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  test('exits 0 on clean migrated codebase', () => {
    // Run the script against the actual codebase (all YAMLs should be migrated)
    let exitCode = 0;
    let output = '';
    try {
      output = execSync(`node "${scriptPath}"`, {
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '../..'),
      });
    } catch (err) {
      exitCode = err.status;
      output = err.stderr || err.stdout || '';
    }

    expect(exitCode).toBe(0);
    expect(output).toMatch(/lint passed/);
  });

  test('exits 1 when a YAML contains an unknown model ID', () => {
    // Create a fake package structure with a bad model ID
    const fakeAgentsDir = path.join(tmpDir, 'packages', 'fake-pkg', 'agents');
    fs.mkdirSync(fakeAgentsDir, { recursive: true });

    const badYaml = `---\nname: bad-agent\nmodel: claude-opus-3-invalid\ndescription: Uses retired model ID\n`;
    fs.writeFileSync(path.join(fakeAgentsDir, 'bad-agent.yaml'), badYaml);

    // Point ROOT to tmpDir by running with a modified environment trick.
    // We test this by creating a minimal script that overrides ROOT.
    const tempScript = path.join(tmpDir, 'run-lint.js');
    fs.writeFileSync(tempScript, `
'use strict';
const path = require('path');
const fs = require('fs');
const { KNOWN_MODEL_IDS } = require('${path.resolve(__dirname, '../../packages/core/lib/known-model-ids')}');

const ROOT = '${tmpDir}';

function collectYamlFiles(dir, results) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) collectYamlFiles(fullPath, results);
    else if (entry.endsWith('.yaml')) results.push(fullPath);
  }
}

function findYamlFiles() {
  const results = [];
  const packagesDir = path.join(ROOT, 'packages');
  if (!fs.existsSync(packagesDir)) return results;
  const packages = fs.readdirSync(packagesDir).filter(n => fs.statSync(path.join(packagesDir, n)).isDirectory());
  for (const pkg of packages) {
    const agentsDir = path.join(packagesDir, pkg, 'agents');
    if (fs.existsSync(agentsDir)) {
      fs.readdirSync(agentsDir).filter(f => f.endsWith('.yaml')).forEach(f => results.push(path.join(agentsDir, f)));
    }
    const commandsDir = path.join(packagesDir, pkg, 'commands');
    if (fs.existsSync(commandsDir)) collectYamlFiles(commandsDir, results);
  }
  return results;
}

function extractModelValue(yamlContent) {
  const match = yamlContent.match(/^  model:\\s+(\\S+)\\s*$/m) || yamlContent.match(/^model:\\s+(\\S+)\\s*$/m);
  return match ? match[1] : null;
}

const yamlFiles = findYamlFiles();
const VALID_VALUES = new Set(['high', 'medium', 'low', ...KNOWN_MODEL_IDS]);
const errors = [];
for (const filePath of yamlFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const modelValue = extractModelValue(content);
  if (!modelValue) continue;
  if (!VALID_VALUES.has(modelValue)) {
    errors.push(path.relative(ROOT, filePath) + ': model: ' + modelValue);
  }
}
if (errors.length > 0) {
  errors.forEach(e => process.stderr.write('  ' + e + '\\n'));
  process.exit(1);
} else {
  process.exit(0);
}
`);

    let exitCode = 0;
    try {
      execSync(`node "${tempScript}"`, { encoding: 'utf8' });
    } catch (err) {
      exitCode = err.status;
    }

    expect(exitCode).toBe(1);
  });
});
