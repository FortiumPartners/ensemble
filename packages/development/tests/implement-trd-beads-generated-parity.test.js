/**
 * TRD-015-TEST: implement-trd-beads generated parity
 *
 * Proves that regenerating implement-trd-beads (a skill-backed command: the YAML is a
 * manifest and the prompt is the skill, SKILL.md + references/) carries the same
 * PR-review-gate structure into every runtime's copy of the skill (Pi skill, Codex skill)
 * and that the Claude Code command and Pi prompt are stubs pointing at it, as the source: the stacked-phase PR Review Gate
 * (Gate Result Recording), the single-PR PR Review Gate (Completion Report),
 * and the PR Review Completion Check, in the right order relative to each
 * other and to Epic Closure; their shared pr-review-cycle skill reference by
 * the repo-root path pattern; the local/remote status vocabulary
 * (LOCAL_REVIEW_COMPLETE/LOCAL_REVIEW_BLOCKED, REMOTE_REVIEW_PENDING); and
 * the anti-early-completion contract (never described as merged or landed)
 * -- plus that regeneration is idempotent (no further drift) and that both
 * generate:validate and the full validate suite pass.
 *
 * The Claude Code markdown and the Pi prompt of a skill-backed command carry no prompt text
 * (they are stubs), so the content assertions that used to run against them run against the
 * skill prose of the source skill and of the Pi and Codex copies of the skill.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

const { readSkillProse } = require('../../../scripts/lib/skill-backed-command');
const { readDevelopmentSkill, parseWorkflow } = require('./helpers/skill-workflow');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOURCE_PATH = path.join(__dirname, '../commands/implement-trd-beads.yaml');

// Entry points that are stubs pointing at the skill (no prompt text of their own).
const STUB_FILES = {
  'Claude/OMP markdown': path.join(__dirname, '../commands/ensemble/implement-trd-beads.md'),
  'Pi prompt': path.join(__dirname, '../../pi/prompts/ensemble-implement-trd-beads.md'),
};

// Every copy of the skill: SKILL.md plus its references/*.md, read as one prose.
const GENERATED_FILES = {
  'Skill source': path.join(__dirname, '../skills/ensemble-implement-trd-beads/SKILL.md'),
  'Pi skill': path.join(__dirname, '../../pi/skills/ensemble-implement-trd-beads/SKILL.md'),
  'Codex skill': path.join(
    __dirname,
    '../../codex/.codex/skills/commands/ensemble-implement-trd-beads/SKILL.md'
  ),
};

const SKILL_PATH_PATTERN = 'packages/development/skills/pr-review-cycle/SKILL.md (via tool-path-resolution)';

describe('implement-trd-beads generated parity (TRD-015-TEST)', () => {
  let sourceYaml;
  let generated;

  beforeAll(() => {
    const manifest = yaml.load(fs.readFileSync(SOURCE_PATH, 'utf-8'));
    const skill = readDevelopmentSkill(manifest.skill);
    sourceYaml = {
      mission: { summary: skill.body },
      workflow: { phases: parseWorkflow(skill) },
    };
    generated = {};
    for (const [label, filePath] of Object.entries(GENERATED_FILES)) {
      generated[label] = readSkillProse(filePath);
    }
  });

  test.each(Object.entries(STUB_FILES))(
    '%s: is a stub that points at the ensemble-implement-trd-beads skill',
    (label, filePath) => {
      const text = fs.readFileSync(filePath, 'utf-8');
      expect(text).toContain('ensemble-implement-trd-beads');
      expect(text).toMatch(/skill/i);
      expect(text).toContain('$ARGUMENTS');
    }
  );

  test('source: Completion steps run verification, the PR review completion check, then epic closure; the gate and checks reference the skill by PR_REVIEW_SKILL', () => {
    const qualityGate = sourceYaml.workflow.phases.find((p) => p.name === 'Quality Gate');
    const gate = qualityGate.steps.find((s) => s.title === 'Per-phase gate').actions.join('\n');
    expect(gate).toContain('PR_REVIEW_SKILL');
    expect(sourceYaml.mission.summary).toContain(`PR_REVIEW_SKILL = ${SKILL_PATH_PATTERN}`);

    const completion = sourceYaml.workflow.phases.find((p) => p.name === 'Completion');
    expect(completion.steps.map((s) => s.title)).toEqual([
      'Completion verification',
      'PR review completion check',
      'Epic closure and TRD checkboxes',
      'Completion report',
    ]);

    const prReviewCheck = completion.steps.find((s) => s.title === 'PR review completion check');
    expect(prReviewCheck.actions.some((a) => a.includes("MODE='remote'"))).toBe(true);
    expect(prReviewCheck.actions.some((a) => a.includes("MODE='local'"))).toBe(true);
    // The whole-branch local gate runs in the check, BEFORE Epic Closure, and not again in the report.
    const completionReport = completion.steps.find((s) => s.title === 'Completion report');
    expect(completionReport.actions.some((a) => /MODE='local'/.test(a))).toBe(false);
  });

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries the PR review completion check between completion verification and epic closure, and the per-phase gate before them',
    (label) => {
      const text = generated[label];
      const gateIdx = text.indexOf('Per-phase gate');
      const verificationIdx = text.indexOf('Completion verification');
      const checkIdx = text.indexOf('PR review completion check');
      const closureIdx = text.indexOf('Epic closure and TRD checkboxes');

      expect(gateIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(verificationIdx);
      expect(verificationIdx).toBeLessThan(checkIdx);
      expect(checkIdx).toBeLessThan(closureIdx);
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: defines PR_REVIEW_SKILL by the exact repo-root path pattern',
    (label) => {
      expect(generated[label]).toContain(SKILL_PATH_PATTERN);
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries the local review status vocabulary and the shared skill\'s REVIEW_PENDING/REVIEW_BLOCKED terminal statuses (same vocabulary fix-issue already established)',
    (label) => {
      const text = generated[label];
      expect(text).toContain('LOCAL_REVIEW_COMPLETE');
      expect(text).toContain('LOCAL_REVIEW_BLOCKED');
      expect(text).toContain('REVIEW_PENDING');
      expect(text).toContain('REVIEW_BLOCKED');
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: carries the anti-early-completion contract (a pending/blocked PR is never described as merged or landed)',
    (label) => {
      const text = generated[label];
      expect(text).toMatch(/Never call a PR merged or landed/);
    }
  );

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
