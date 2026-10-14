/**
 * TRD-011-TEST: fix-issue generated parity
 *
 * Proves that regenerating fix-issue.yaml's OMP (Claude + Pi) and Codex
 * outputs carries the same PR-review-gate structure as the source: the two
 * new Validation & Delivery steps (Local Review and Batch Fix, Remote Review
 * Disposition) in the right order, their shared pr-review-cycle skill
 * reference by the repo-root path pattern, and the anti-early-completion
 * contract Record Stage Checkpoint now carries -- plus that regeneration is
 * idempotent (no drift) and passes generation validation.
 *
 * The generic markdown/Pi/Codex generators render each workflow step's
 * `title` and `description` only (never its `instructions` body -- true for
 * every command in this repo, confirmed by grepping for instructions-only
 * text like "Detect test framework" across all four generated files and
 * finding zero matches). Every content assertion below is scoped to what
 * actually survives generation; it does not assert on `instructions` text.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOURCE_PATH = path.join(__dirname, '../commands/fix-issue.yaml');
const GENERATED_FILES = {
  'Claude/OMP markdown': path.join(__dirname, '../commands/ensemble/fix-issue.md'),
  'Pi prompt': path.join(__dirname, '../../pi/prompts/ensemble-fix-issue.md'),
  'Pi skill': path.join(__dirname, '../../pi/skills/ensemble-fix-issue/SKILL.md'),
  'Codex skill': path.join(__dirname, '../../codex/.codex/skills/commands/ensemble-fix-issue/SKILL.md'),
};

const SKILL_PATH_PATTERN =
  '"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md"';

describe('fix-issue generated parity (TRD-011-TEST)', () => {
  let sourceYaml;
  let generated;

  beforeAll(() => {
    sourceYaml = yaml.load(fs.readFileSync(SOURCE_PATH, 'utf-8'));
    generated = {};
    for (const [label, filePath] of Object.entries(GENERATED_FILES)) {
      generated[label] = fs.readFileSync(filePath, 'utf-8');
    }
  });

  test('source: both review-gate steps exist in order, each referencing the skill by the repo-root path pattern', () => {
    const vd = sourceYaml.workflow.phases.find((p) => p.name === 'Validation & Delivery');
    const titles = vd.steps.map((s) => s.title);

    expect(titles).toEqual([
      'Test Validation',
      'Local Review and Batch Fix',
      'PR Creation',
      'Remote Review Disposition',
      'Record Stage Checkpoint',
    ]);

    const localReview = vd.steps.find((s) => s.title === 'Local Review and Batch Fix');
    const remoteReview = vd.steps.find((s) => s.title === 'Remote Review Disposition');
    expect(localReview.description).toContain(SKILL_PATH_PATTERN);
    expect(remoteReview.description).toContain(SKILL_PATH_PATTERN);
  });

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries both review-gate step titles, in source order, before Record Stage Checkpoint',
    (label) => {
      const text = generated[label];
      const localIdx = text.indexOf('Local Review and Batch Fix');
      const prIdx = text.indexOf('PR Creation');
      const remoteIdx = text.indexOf('Remote Review Disposition');
      const checkpointIdx = text.lastIndexOf('Record Stage Checkpoint');

      expect(localIdx).toBeGreaterThan(-1);
      expect(prIdx).toBeGreaterThan(-1);
      expect(remoteIdx).toBeGreaterThan(-1);
      expect(checkpointIdx).toBeGreaterThan(-1);
      expect(localIdx).toBeLessThan(prIdx);
      expect(prIdx).toBeLessThan(remoteIdx);
      expect(remoteIdx).toBeLessThan(checkpointIdx);
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: references the pr-review-cycle skill by the exact repo-root path pattern, for both steps',
    (label) => {
      const occurrences = generated[label].split(SKILL_PATH_PATTERN).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries the anti-early-completion contract (Record Stage Checkpoint only runs on REVIEW_COMPLETE)',
    (label) => {
      const text = generated[label];
      expect(text).toContain("reached when Remote Review Disposition's status is");
      expect(text).toContain('REVIEW_COMPLETE');
      expect(text).toContain('a pending or blocked outcome halts there');
    }
  );

  test(
    'regeneration is idempotent and generate:validate passes -- re-running generate, generate:pi, generate:codex and generate:validate from the repo root produces zero further diff',
    () => {
      execSync('npm run generate && npm run generate:pi && npm run generate:codex && npm run generate:validate', {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });

      const relativePaths = Object.values(GENERATED_FILES).map((p) => path.relative(REPO_ROOT, p));
      const diff = execSync(`git status --porcelain -- ${relativePaths.join(' ')}`, {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
      }).trim();
      expect(diff).toBe('');
    },
    60000
  );
});
