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
 * That is exactly why the resumable-pending rules (R3-P2-F1) are asserted
 * here: they have to be in a rendered `description`, or a generated command
 * never carries them.
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

const flat = (text) => text.replace(/\s+/g, ' ').trim();

// Every generator renders a workflow step as a heading followed by that step's `description`:
//   OMP markdown / Codex:  "**<n>. <title>**" under "### Phase <n>: <name>"
//   Pi prompt / Pi skill:  "### Step <n>: <title>" under "## Phase <n>: <name>"
// A step is therefore found by its HEADING, never by a mention of its title: the Entry Point step names
// Remote Review Disposition, so the first occurrence of that title is no longer the step itself.
const PHASE_HEADING = /^#{2,3} Phase \d+: (.+?)\s*$/;
const STEP_HEADING = /^(?:\*\*\d+\. (.+?)\*\*|### Step \d+: (.+?))\s*$/;

/** The rendered steps of one generated file, in order: { phase, title, text }, text being the whitespace-normalised description. */
function renderedSteps(text) {
  const steps = [];
  let phase = null;
  let current = null;
  for (const line of text.split('\n')) {
    const phaseHeading = line.match(PHASE_HEADING);
    const stepHeading = line.match(STEP_HEADING);
    if (phaseHeading) {
      phase = phaseHeading[1];
      current = null;
    } else if (stepHeading) {
      current = { phase, title: stepHeading[1] || stepHeading[2], lines: [] };
      steps.push(current);
    } else if (/^#{1,2} /.test(line)) {
      current = null; // the next top-level section (Expected Output, Usage, ...) ends the last step
    } else if (current) {
      current.lines.push(line);
    }
  }
  return steps.map((step) => ({ phase: step.phase, title: step.title, text: flat(step.lines.join('\n')) }));
}

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
      // By heading, not by mention: other steps' descriptions (the Entry Point resume rule) name these steps too.
      const titles = renderedSteps(generated[label])
        .filter((step) => step.phase === 'Validation & Delivery')
        .map((step) => step.title);

      expect(titles).toEqual([
        'Test Validation',
        'Local Review and Batch Fix',
        'PR Creation',
        'Remote Review Disposition',
        'Record Stage Checkpoint',
      ]);
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

  // ---------------------------------------------------------------------------------------------------------------
  // R3-P2-F1: the generators render a step's `title` and `description` only, so the rules a later session needs to
  // resume a pending or blocked remote review (and to carry the review from the local snapshot to the pushed commit)
  // must be IN those descriptions. Each assertion below is on the GENERATED output, scoped to the step it belongs to.
  // ---------------------------------------------------------------------------------------------------------------
  const ENTRY = ['Entry Point Resolution', 'Start New Run or Resume Active Run'];
  const LOCAL = ['Validation & Delivery', 'Local Review and Batch Fix'];
  const REMOTE = ['Validation & Delivery', 'Remote Review Disposition'];
  const stepOf = (label, phase, title) => {
    const found = renderedSteps(generated[label]).filter((step) => step.phase === phase && step.title === title);
    expect({ label, phase, title, found: found.length }).toEqual({ label, phase, title, found: 1 });
    return found[0].text;
  };

  test.each(Object.entries(GENERATED_FILES))(
    '%s: the Entry Point step carries the resume rule -- a REVIEW_ approval_wait at validation_delivery resumes at Remote Review Disposition, reading the recorded pr: beadRef (R3-P2-F1)',
    (label) => {
      const text = stepOf(label, ...ENTRY);
      const at = (token) => text.indexOf(token);

      ['validation_delivery', 'approval_wait', 'REVIEW_', 'pr:', 'beadRef', 'Remote Review Disposition', 'Test Validation', 'failure', 'Retry'].forEach((token) =>
        expect({ token, found: at(token) > -1 }).toEqual({ token, found: true })
      );
      // The condition is stated before the step it resumes at: stage, then outcome, then detail, then the destination.
      expect(at('validation_delivery')).toBeLessThan(at('approval_wait'));
      expect(at('approval_wait')).toBeLessThan(at('REVIEW_'));
      expect(at('REVIEW_')).toBeLessThan(at('Remote Review Disposition'));
      // The failure gate comes first, as it does among the instructions' branches.
      expect(at('failure')).toBeLessThan(at('approval_wait'));
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: Remote Review Disposition records the pr: beadRef BEFORE it invokes the skill, and blocks with approval_wait when there is no PR URL (R3-P2-F1, R3-P2-F2)',
    (label) => {
      const text = stepOf(label, ...REMOTE);
      const recordAt = text.indexOf('`pr:<url>` beadRef');
      const invokeAt = text.indexOf(SKILL_PATH_PATTERN);

      expect(recordAt).toBeGreaterThan(-1);
      expect(invokeAt).toBeGreaterThan(recordAt);
      // The no-PR-URL block: the detail the resume gate finds again, recorded as an approval_wait.
      expect(text).toContain('REVIEW_BLOCKED: no PR URL recorded');
      expect(text).toContain('approval_wait');
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: the reviewed tree is carried by the tree SHAs -- Local Review records reviewedTreeSha, Remote Review passes HEAD_TREE_SHA (R3-P1-F1)',
    (label) => {
      const local = stepOf(label, ...LOCAL);
      expect(local).toContain('reviewedTreeSha');
      expect(local).toContain('^{tree}');

      const remote = stepOf(label, ...REMOTE);
      expect(remote).toContain('HEAD_TREE_SHA');
      expect(remote).toContain('reviewedTreeSha');
      expect(remote).toContain('HEAD^{tree}');
    }
  );

  test.each(Object.entries(GENERATED_FILES))(
    '%s: renders the whole description of the three steps this contract lives in exactly as the source has it (no stale or truncated generation)',
    (label) => {
      [ENTRY, LOCAL, REMOTE].forEach(([phaseName, title]) => {
        const source = sourceYaml.workflow.phases.find((phase) => phase.name === phaseName).steps.find((step) => step.title === title);
        expect({ title, rendered: stepOf(label, phaseName, title).includes(flat(source.description)) }).toEqual({ title, rendered: true });
      });
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
