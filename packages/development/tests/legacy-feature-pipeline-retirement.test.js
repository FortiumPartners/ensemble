/**
 * Unit tests for TRD-009 / TRD-009-TEST
 * (docs/TRD/TRD-2026-87e64cc6-command-surface-consolidation.md#trd-009,
 * #trd-009-test).
 *
 * `packages/product/commands/feature.yaml` used to hold the old, superseded
 * 5-step linear pipeline (Argument Parsing + create-prd/refine-prd/create-trd/
 * refine-trd/implement-trd-tasks orchestration). Both it and
 * `packages/development/commands/feature.yaml` (TRD-002's canonical
 * dispatcher) declared `metadata.name: ensemble:feature`, and
 * scripts/generate-codex/index.js derives both its generated skill name and
 * output path purely from the YAML file's basename ("feature"), so whichever
 * of the two `feature.yaml` sources sorted last won the `ensemble-feature`
 * Codex skill -- silently clobbering the dispatcher with the old pipeline.
 *
 * The fix retires the old file outright (REQ-008: "Retire the superseded
 * linear pipeline outright") rather than duplicating dispatcher content
 * across two source files, which would just re-create the same multi-source
 * collision with identical content.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

const OLD_PIPELINE_TOKENS = [
  '--skip-refine',
  '5-step Pipeline Execution',
  'Step 1/5',
  'Step 2/5',
  'Step 3/5',
  'Step 4/5',
  'Step 5/5',
];

/** Recursively list files under `dir`, skipping node_modules/.git/dist/vendor. */
function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'vendor', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe('TRD-009: legacy linear pipeline retirement', () => {
  test('packages/product/commands/feature.yaml no longer exists', () => {
    const oldYamlPath = path.join(PACKAGES_DIR, 'product', 'commands', 'feature.yaml');
    expect(fs.existsSync(oldYamlPath)).toBe(false);
  });

  test('packages/product/commands/ensemble/feature.md (its generated output) no longer exists', () => {
    const oldMarkdownPath = path.join(PACKAGES_DIR, 'product', 'commands', 'ensemble', 'feature.md');
    expect(fs.existsSync(oldMarkdownPath)).toBe(false);
  });

  test('exactly one feature.yaml command source exists across all packages (development\'s dispatcher)', () => {
    const matches = [];
    for (const pkg of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const candidate = path.join(PACKAGES_DIR, pkg.name, 'commands', 'feature.yaml');
      if (fs.existsSync(candidate)) matches.push(candidate);
    }
    expect(matches).toEqual([path.join(PACKAGES_DIR, 'development', 'commands', 'feature.yaml')]);
  });

  describe('Test AC: old --skip-refine 5-step pipeline not found anywhere', () => {
    // Scan every tracked source/generated artifact directory, not just the
    // retired YAML -- the old pipeline's derived Codex/Pi skill mirrors must
    // also be clean after regeneration.
    const scanDirs = ['product', 'development', 'codex', 'pi'].map((p) => path.join(PACKAGES_DIR, p));

    test.each(scanDirs)('%s contains no trace of the old 5-step pipeline', (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const file of listFiles(dir)) {
        if (!/\.(ya?ml|md)$/.test(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        for (const token of OLD_PIPELINE_TOKENS) {
          if (content.includes(token)) {
            // new-feature.yaml (and its generated mirrors) legitimately own
            // `--skip-refine` as part of their own current, unrelated
            // checkpointed workflow -- only the retired orchestration's
            // "Step N/5" pipeline markers are disqualifying for that file.
            if (token === '--skip-refine' && /new-feature/.test(file)) continue;
            throw new Error(`${file} still contains old-pipeline token "${token}"`);
          }
        }
      }
    });
  });

  test('Test AC: only ensemble-feature is advertised for the feature lifecycle (single generated Codex skill)', () => {
    const skillDir = path.join(PACKAGES_DIR, 'codex', '.codex', 'skills', 'commands', 'ensemble-feature');
    const skillPath = path.join(skillDir, 'SKILL.md');
    expect(fs.existsSync(skillPath)).toBe(true);
    const content = fs.readFileSync(skillPath, 'utf8');
    expect(content).toMatch(/Dispatch to the feature-lifecycle workflow/);
    for (const token of OLD_PIPELINE_TOKENS) {
      expect(content).not.toContain(token);
    }
  });
});
