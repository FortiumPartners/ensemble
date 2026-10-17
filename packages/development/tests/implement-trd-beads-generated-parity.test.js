/**
 * TRD-015-TEST: implement-trd-beads generated parity
 *
 * Proves that regenerating implement-trd-beads.yaml's OMP (Claude + Pi) and
 * Codex outputs, and complete-beads/SKILL.md's Pi mirror, carries the same
 * PR-review-gate structure as the source: the stacked-phase PR Review Gate
 * (Gate Result Recording), the single-PR PR Review Gate (Completion Report),
 * and the PR Review Completion Check, in the right order relative to each
 * other and to Epic Closure; their shared pr-review-cycle skill reference by
 * the repo-root path pattern; the local/remote status vocabulary
 * (LOCAL_REVIEW_COMPLETE/LOCAL_REVIEW_BLOCKED, REMOTE_REVIEW_PENDING); and
 * the anti-early-completion contract (never described as merged or landed)
 * -- plus that regeneration is idempotent (no further drift) and that both
 * generate:validate and the full validate suite pass.
 *
 * The generic markdown/Pi/Codex generators render each workflow step's
 * `title`, `description` and `actions[]` only (never an `instructions` key
 * -- confirmed project-wide; see fix-issue-generated-parity.test.js). Every
 * content assertion below is scoped to what actually survives generation.
 * complete-beads/SKILL.md is a plain prose skill (not a command), so only
 * its Pi mirror is generated; it is asserted byte-identical to the source
 * after the Pi-injected frontmatter.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOURCE_PATH = path.join(__dirname, '../commands/implement-trd-beads.yaml');
const COMPLETE_BEADS_SOURCE_PATH = path.join(__dirname, '../skills/complete-beads/SKILL.md');

const GENERATED_FILES = {
  'Claude/OMP markdown': path.join(__dirname, '../commands/ensemble/implement-trd-beads.md'),
  'Pi prompt': path.join(__dirname, '../../pi/prompts/ensemble-implement-trd-beads.md'),
  'Pi skill': path.join(__dirname, '../../pi/skills/ensemble-implement-trd-beads/SKILL.md'),
  'Codex skill': path.join(
    __dirname,
    '../../codex/.codex/skills/commands/ensemble-implement-trd-beads/SKILL.md'
  ),
};

const COMPLETE_BEADS_PI_MIRROR_PATH = path.join(__dirname, '../../pi/skills/complete-beads/SKILL.md');

const SKILL_PATH_PATTERN =
  '"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md"';

describe('implement-trd-beads generated parity (TRD-015-TEST)', () => {
  let sourceYaml;
  let generated;
  let completeBeadsSource;
  let completeBeadsPiMirror;

  beforeAll(() => {
    sourceYaml = yaml.load(fs.readFileSync(SOURCE_PATH, 'utf-8'));
    generated = {};
    for (const [label, filePath] of Object.entries(GENERATED_FILES)) {
      generated[label] = fs.readFileSync(filePath, 'utf-8');
    }
    completeBeadsSource = fs.readFileSync(COMPLETE_BEADS_SOURCE_PATH, 'utf-8');
    completeBeadsPiMirror = fs.readFileSync(COMPLETE_BEADS_PI_MIRROR_PATH, 'utf-8');
  });

  test('source: stacked and single-PR review gates and the completion check exist in order, each referencing the skill by the repo-root path pattern', () => {
    const qualityGate = sourceYaml.workflow.phases.find((p) => p.name === 'Quality Gate');
    const gateResultRecording = qualityGate.steps.find((s) => s.title === 'Gate Result Recording');
    const stackedGateAction = gateResultRecording.actions.find((a) =>
      a.startsWith('PR Review Gate (TRD-013, REQ-015): if gate_passed')
    );
    expect(stackedGateAction).toBeDefined();
    expect(stackedGateAction).toContain(SKILL_PATH_PATTERN);

    const completion = sourceYaml.workflow.phases.find((p) => p.name === 'Completion');
    const titles = completion.steps.map((s) => s.title);
    expect(titles).toEqual([
      'Completion Verification',
      'PR Review Completion Check',
      'Epic Closure',
      'TRD Checkbox Sync',
      'Completion Report',
    ]);

    const prReviewCheck = completion.steps.find((s) => s.title === 'PR Review Completion Check');
    const remoteAction = prReviewCheck.actions.find((a) => a.includes("MODE='remote'"));
    expect(remoteAction).toBeDefined();
    expect(remoteAction).toContain(SKILL_PATH_PATTERN);

    // The single-PR whole-branch gate runs in the check, BEFORE Epic Closure, and not again in Completion Report.
    const singlePrGateAction = prReviewCheck.actions.find((a) =>
      a.startsWith('Single-PR local review gate (TRD-013')
    );
    expect(singlePrGateAction).toBeDefined();
    expect(singlePrGateAction).toContain(SKILL_PATH_PATTERN);
    const completionReport = completion.steps.find((s) => s.title === 'Completion Report');
    expect(completionReport.actions.some((a) => /MODE='local'/.test(a))).toBe(false);
  });

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries the PR Review Completion Check title between Completion Verification and the Epic Closure step',
    (label) => {
      const text = generated[label];
      const verificationIdx = text.indexOf('Completion Verification');
      const checkIdx = text.indexOf('PR Review Completion Check');
      // The Epic Closure STEP is located by its own (unique) description text,
      // not the bare words "Epic Closure" -- that phrase also appears earlier,
      // inside Completion Verification's own pre-existing cross-reference
      // ("...and continue to Epic Closure."), which would otherwise produce a
      // false-positive earlier match.
      const epicClosureStepIdx = text.indexOf('Close the root epic when all children are done');

      expect(verificationIdx).toBeGreaterThan(-1);
      expect(checkIdx).toBeGreaterThan(-1);
      expect(epicClosureStepIdx).toBeGreaterThan(-1);
      expect(verificationIdx).toBeLessThan(checkIdx);
      expect(checkIdx).toBeLessThan(epicClosureStepIdx);
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries both PR review gate call sites, the stacked one before its append and the single-PR one before Epic Closure',
    (label) => {
      const text = generated[label];
      const stackedGateIdx = text.indexOf('PR Review Gate (TRD-013');
      const singleGateIdx = text.indexOf('Single-PR local review gate (TRD-013');
      const appendClauseIdx = text.indexOf('GATE_ACTION.appendNextBranch is set');
      // The Epic Closure STEP is located by its own unique description text (see above).
      const epicClosureStepIdx = text.indexOf('Close the root epic when all children are done');

      expect(stackedGateIdx).toBeGreaterThan(-1);
      expect(singleGateIdx).toBeGreaterThan(-1);
      expect(appendClauseIdx).toBeGreaterThan(stackedGateIdx);
      // A blocking whole-branch finding must halt before the epic can close (AC-016-3).
      expect(epicClosureStepIdx).toBeGreaterThan(singleGateIdx);
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: references the pr-review-cycle skill by the exact repo-root path pattern, at least 3 times (2 local gates + 1 remote check)',
    (label) => {
      const occurrences = generated[label].split(SKILL_PATH_PATTERN).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(3);
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries the local review status vocabulary and the shared skill\'s REVIEW_PENDING/REVIEW_BLOCKED terminal statuses (same vocabulary fix-issue already established)',
    (label) => {
      const text = generated[label];
      expect(text).toContain('LOCAL_REVIEW_COMPLETE');
      expect(text).toContain('LOCAL_REVIEW_BLOCKED');
      expect(text).toContain("'REVIEW_PENDING' or 'REVIEW_BLOCKED'");
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries the anti-early-completion contract (a pending/blocked PR is never described as merged or landed)',
    (label) => {
      const text = generated[label];
      expect(text).toMatch(/never describes? a pending PR as merged or landed/);
      expect(text).toContain('never merged or landed until a human confirms it');
    }
  );

  test('complete-beads Pi mirror: byte-identical to the source after the Pi-injected frontmatter, and carries the quality-gate review contract', () => {
    const frontmatterEnd = completeBeadsPiMirror.indexOf('\n# complete-beads');
    expect(frontmatterEnd).toBeGreaterThan(-1);
    const mirrorBody = completeBeadsPiMirror.slice(frontmatterEnd + 1);
    expect(mirrorBody).toBe(completeBeadsSource);

    expect(completeBeadsPiMirror).toContain('Quality Gate Review');
    expect(completeBeadsPiMirror).toContain('LOCAL_REVIEW_COMPLETE');
    expect(completeBeadsPiMirror).toContain('LOCAL_REVIEW_BLOCKED');
    expect(completeBeadsPiMirror).toContain(SKILL_PATH_PATTERN);
  });

  test(
    'generated artifacts validate -- generate:validate and the full validate suite both pass (read-only; regeneration idempotency is enforced by the CI generate check on a clean checkout, never by rewriting tracked output from inside a unit test)',
    () => {
      execSync('npm run generate:validate && npm run validate', {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    },
    120000
  );
});
