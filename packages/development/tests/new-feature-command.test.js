/**
 * Unit tests for new-feature.yaml command structure (TRD-003)
 */

const fs = require('fs');
const path = require('path');

const { readNewFeature } = require('./helpers/new-feature-skill');

const FIXED_STAGE_ORDER = [
  'prd_create',
  'prd_refine',
  'trd_create',
  'trd_refine',
  'beads_plan',
  'implementation_approval',
  'implementation',
  'pr_approval',
  'pr_create',
  'done',
];

/**
 * Join a step's `actions[]` array into one string for regex/.includes()
 * assertions. Each action entry is itself a single continuous string (no
 * internal hard-wrapping), so cross-clause assertions that used to rely on
 * the old `instructions: |` block scalar's line wraps (`\s*\n\s*` between
 * two phrases) now only need `\s+` -- the phrases themselves are unchanged,
 * only the line-wrap mechanics are gone.
 */
function actionsText(step) {
  return (step.actions || []).join('\n');
}

describe('new-feature is a skill-backed command', () => {
  const feature = readNewFeature();

  test('its YAML is a manifest -- metadata and a skill, no prompt of its own', () => {
    expect(Object.keys(feature.manifest).sort()).toEqual(['metadata', 'skill']);
    expect(feature.manifest.skill).toBe('ensemble-new-feature');
    expect(feature.skill.frontmatter.name).toBe(feature.manifest.skill);
  });

  test('SKILL.md indexes every phase file by its relative path, and every indexed file exists', () => {
    const indexed = [...feature.body.matchAll(/`(references\/[^`]+\.md)`/g)].map((m) => m[1]).sort();
    const present = feature.references.map((r) => `references/${path.basename(r.file)}`);
    expect(present).toHaveLength(3);
    expect(indexed).toEqual(present);
  });

  test('each phase lives in its own reference file, not in SKILL.md', () => {
    for (const [name, heading] of [
      ['phase-1-entry-point-resolution.md', '### Phase 1: Entry Point Resolution'],
      ['phase-2-stage-resolution.md', '### Phase 2: Stage Resolution'],
      ['phase-3-execute-stage.md', '### Phase 3: Execute Stage'],
    ]) {
      const reference = feature.references.find((r) => path.basename(r.file) === name);
      expect(reference).toBeDefined();
      expect(reference.text.startsWith(heading)).toBe(true);
      expect(feature.body).not.toContain(heading);
    }
  });
});

describe('New-Feature Command', () => {
  let commandYaml;

  beforeAll(() => {
    // The pre-skill YAML shape (metadata, parameters, constraints, workflow.phases),
    // rebuilt from the manifest and the skill the prompt now lives in.
    const feature = readNewFeature();
    commandYaml = { ...feature.manifest, ...feature };
  });

  describe('Metadata', () => {
    test('has valid metadata structure', () => {
      expect(commandYaml.metadata).toBeDefined();
      expect(commandYaml.metadata.name).toBe('ensemble:new-feature');
      expect(commandYaml.metadata.category).toBe('implementation');
      expect(commandYaml.metadata.source).toBe('sunstone');
    });
  });

  describe('AC-002-1: fixed stage order', () => {
    test('constraints declare the exact PRD stage sequence, in order, with no gaps', () => {
      const orderConstraint = commandYaml.constraints.find((c) => c.includes('Stage order is fixed'));
      expect(orderConstraint).toBeDefined();
      for (const stage of FIXED_STAGE_ORDER) {
        expect(orderConstraint).toContain(stage);
      }
      // Every stage name appears in declared order (not just present-anywhere).
      const positions = FIXED_STAGE_ORDER.map((stage) => orderConstraint.indexOf(stage));
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sorted);
    });

    test('Stage Resolution phase dispatch table lists every stage exactly once, in fixed order', () => {
      const phase = commandYaml.workflow.phases.find((p) => p.name === 'Stage Resolution');
      expect(phase).toBeDefined();
      const dispatchStep = phase.steps.find((s) => s.title === 'Dispatch to the Eligible Stage');
      expect(dispatchStep).toBeDefined();
      // Each stage is dispatched via an explicit "<stage> -> ..." mapping inside
      // one semicolon-separated action string; confirm every stage appears in
      // this exact mapped form, in fixed order (not just present-anywhere).
      const text = actionsText(dispatchStep);
      const positions = FIXED_STAGE_ORDER.map((stage) => text.indexOf(`${stage} ->`));
      expect(positions.every((p) => p >= 0)).toBe(true);
      const sorted = [...positions].sort((a, b) => a - b);
      expect(positions).toEqual(sorted);
    });
  });

  describe('AC-002-3: no skip-ahead on stray files', () => {
    test('Load Current Checkpoint step derives the eligible stage from RunIndexStore state, and explicitly forbids consulting the filesystem', () => {
      const phase = commandYaml.workflow.phases.find((p) => p.name === 'Stage Resolution');
      const loadStep = phase.steps.find((s) => s.title === 'Load Current Checkpoint');
      expect(loadStep).toBeDefined();
      // The only two ways ELIGIBLE_STAGE is derived: from stageOutcome.kind
      // (success -> next stage) or from the current stage itself (not yet
      // succeeded -> same stage). Neither branch may consult the filesystem.
      expect(actionsText(loadStep)).toMatch(/ELIGIBLE_STAGE/);
      expect(actionsText(loadStep)).toMatch(/stageOutcome\.kind/);
      expect(actionsText(loadStep)).toMatch(/Never consult the filesystem/i);
      expect(actionsText(loadStep)).toMatch(/regardless of what files already exist on disk/i);
    });

    test('a non-success stageOutcome keeps the eligible stage pinned to the current stage, not a later one', () => {
      const phase = commandYaml.workflow.phases.find((p) => p.name === 'Stage Resolution');
      const loadStep = phase.steps.find((s) => s.title === 'Load Current Checkpoint');
      // Exercises exactly the TRD-003-TEST scenario in prose form: a run
      // parked at trd_create (outcome not success) with a stray
      // beads_plan-looking file present must still resolve to trd_create,
      // not what runs next.
      expect(actionsText(loadStep)).toMatch(/\(and only it\) is what runs next/);
    });
  });

  describe('Optional PR branch', () => {
    test('pr_approval and pr_create are reserved stage slots, not unconditionally executed', () => {
      const orderConstraint = commandYaml.constraints.find((c) => c.includes('pr_approval'));
      expect(orderConstraint).toContain('completion without a PR request is a valid terminal state');
      expect(orderConstraint).toContain('only entered if a PR was requested');
    });
  });

  describe('AC-001-1/2/3: Entry Point Resolution (TRD-005)', () => {
    let entryPhase;

    beforeAll(() => {
      entryPhase = commandYaml.workflow.phases.find((p) => p.name === 'Entry Point Resolution');
    });

    test('phase exists and runs before Stage Resolution', () => {
      expect(entryPhase).toBeDefined();
      const stagePhase = commandYaml.workflow.phases.find((p) => p.name === 'Stage Resolution');
      expect(entryPhase.order).toBeLessThan(stagePhase.order);
    });

    test('AC-001-1: idea input creates exactly one run via RunIndexStore.createRun and prints its identifier', () => {
      const step = entryPhase.steps.find((s) => s.title === 'Idea Input -- Start a New Run');
      expect(step).toBeDefined();
      expect(actionsText(step)).toMatch(/RunIndexStore\.createRun\(projectRoot, idea\)/);
      expect(actionsText(step)).toMatch(/print the new run's identifier/);
      expect(actionsText(step)).toMatch(/prd_create/);
    });

    test('AC-008-1: createRun() rejection (RUN_ALREADY_ACTIVE) is handled without creating a second run', () => {
      const step = entryPhase.steps.find((s) => s.title === 'Idea Input -- Start a New Run');
      expect(actionsText(step)).toMatch(/RUN_ALREADY_ACTIVE/);
      expect(actionsText(step)).toMatch(/no new run is created/);
    });

    test('AC-001-2: a matched artifact path resumes that run at its recorded stage', () => {
      const step = entryPhase.steps.find((s) => s.title === 'Artifact-Path Input -- Resume an Indexed Run, or Adopt an Unindexed PRD');
      expect(step).toBeDefined();
      expect(actionsText(step)).toMatch(/RunIndexStore\.resolveByArtifact\(projectRoot, path\)/);
      expect(actionsText(step)).toMatch(/Found:.*run's recorded stage/s);
    });

    test('AC-001-3: a `path` that does not exist or cannot be read is rejected outright; no run is created or advanced', () => {
      const step = entryPhase.steps.find((s) => s.title === 'Artifact-Path Input -- Resume an Indexed Run, or Adopt an Unindexed PRD');
      const text = actionsText(step);
      expect(text).toMatch(/no file exists at that path to adopt as a new run's source/);
      expect(text).toMatch(/Not found,.*Create no run; advance nothing/s);
    });

    // The following three tests cover createRunFromArtifact-based PRD adoption,
    // added as a documented extension of REQ-001/AC-001 beyond TRD-2026-d6bbf322's
    // original scope. No AC-NNN/REQ-NNN number has been assigned to this behavior
    // in the PRD/TRD yet -- flagged, not fabricated, pending a traceability update.

    test('unindexed-but-readable-PRD path is adopted via RunIndexStore.createRunFromArtifact, entering at prd_refine', () => {
      const step = entryPhase.steps.find((s) => s.title === 'Artifact-Path Input -- Resume an Indexed Run, or Adopt an Unindexed PRD');
      const text = actionsText(step);
      expect(text).toMatch(/document_id` matching `PRD-\*`: adopt it/);
      expect(text).toMatch(/RunIndexStore\.createRunFromArtifact\(projectRoot,/);
      expect(text).toMatch(/'prd_refine'\)/);
      expect(text).toMatch(/enters at prd_refine, not prd_create/);
    });

    test('unindexed-path rejection still applies when the file is not a PRD (a TRD, unrelated file, or malformed frontmatter)', () => {
      const step = entryPhase.steps.find((s) => s.title === 'Artifact-Path Input -- Resume an Indexed Run, or Adopt an Unindexed PRD');
      const text = actionsText(step);
      expect(text).toMatch(/no `document_id` matching `PRD-\*` \(a TRD, an unrelated file, or malformed frontmatter\)/);
      expect(text).toMatch(/not a PRD document/);
      expect(text).toMatch(/only.*resumed/is);
      expect(text).toMatch(/Create no run; advance nothing/);
    });

    test('adopted-artifact exclusivity: createRunFromArtifact enforces the same RUN_ALREADY_ACTIVE rejection as createRun', () => {
      const step = entryPhase.steps.find((s) => s.title === 'Artifact-Path Input -- Resume an Indexed Run, or Adopt an Unindexed PRD');
      const text = actionsText(step);
      expect(text).toMatch(/createRunFromArtifact\(\) enforces the same single-active-run exclusivity as createRun\(\)/);
      expect(text).toMatch(/RUN_ALREADY_ACTIVE/);
    });
  });

  describe('AC-003-1/2: --skip-refine rejection (TRD-006)', () => {
    test('rejects --skip-refine and equivalents before any stage runs, naming both mandatory refinement stages and the standalone commands', () => {
      const entryPhase = commandYaml.workflow.phases.find((p) => p.name === 'Entry Point Resolution');
      const step = entryPhase.steps.find((s) => s.title === 'Reject Unsupported Flags Before Any Stage Runs');
      expect(step).toBeDefined();
      expect(actionsText(step)).toMatch(/--skip-refine/);
      expect(actionsText(step)).toMatch(/mandatory/);
      expect(actionsText(step)).toMatch(/refine-prd/);
      expect(actionsText(step)).toMatch(/refine-trd/);
      expect(actionsText(step)).toMatch(/unmodified/);
      // This check must run first (order: 1), before createRun/resolveByArtifact steps.
      expect(step.order).toBe(1);
    });
  });

  describe('AC-006-2/3: explicit-retry-only resume (TRD-008)', () => {
    let entryPhase;
    let executePhase;

    beforeAll(() => {
      entryPhase = commandYaml.workflow.phases.find((p) => p.name === 'Entry Point Resolution');
      executePhase = commandYaml.workflow.phases.find((p) => p.name === 'Execute Stage');
    });

    test('AC-006-3: a bare resume of a failed run asks for explicit confirmation before re-dispatching, never auto-retries', () => {
      const step = entryPhase.steps.find((s) => s.title === 'No Arguments -- Resume Active or Show Status');
      expect(step).toBeDefined();
      expect(actionsText(step)).toMatch(/stageOutcome\.kind is "failure"/);
      expect(actionsText(step)).toMatch(/do NOT proceed to Stage Resolution on a\s+bare invocation alone/);
      expect(actionsText(step)).toMatch(/no mutate\(\)\s+call is made merely by viewing this prompt/);
    });

    test('AC-006-2: retry re-executes only the parked stage; earlier stages are never re-executed or re-derived', () => {
      const step = executePhase.steps.find((s) => s.title === 'Explicit-Retry-Only Resume of a Failed Stage');
      expect(step).toBeDefined();
      expect(actionsText(step)).toMatch(/only that stage's artifact\/outcome/);
      expect(actionsText(step)).toMatch(/never re-executed or\s+re-derived by a retry/);
      expect(actionsText(step)).toMatch(/remain blocked/);
    });

    test('failure handling step defers to the confirmation gate for what counts as an explicit retry', () => {
      const failStep = executePhase.steps.find((s) => s.title === 'Handle Stage Failure');
      expect(failStep).toBeDefined();
      expect(actionsText(failStep)).toMatch(/explicit retry/);
      expect(actionsText(failStep)).toMatch(/Do not advance, do\s+not retry/);
    });
  });

  describe('AC-007-1/2: decline/edit handling (TRD-009)', () => {
    let recordStep;

    beforeAll(() => {
      const executePhase = commandYaml.workflow.phases.find((p) => p.name === 'Execute Stage');
      recordStep = executePhase.steps.find((s) => s.title === 'Record the Stage Outcome');
    });

    test('AC-007-1: a decline keeps the run at the current stage and asks for the needed correction', () => {
      expect(actionsText(recordStep)).toMatch(/stageOutcome to \{ kind: "decline"/);
      expect(actionsText(recordStep)).toMatch(/stage does not advance/);
      expect(actionsText(recordStep)).toMatch(/Ask the user for the correction needed/);
    });

    test('AC-007-2: an edit/regenerate request preserves the prior artifact and blocks dependent stages until acceptance', () => {
      expect(actionsText(recordStep)).toMatch(/edit\/regenerate/);
      expect(actionsText(recordStep)).toMatch(/never overwrite a prior entry/);
      expect(actionsText(recordStep)).toMatch(/do NOT advance `stage` or set stageOutcome\.kind to "success"/);
      expect(actionsText(recordStep)).toMatch(/no dependent stage runs/);
    });
  });

  describe('AC-012-1/2: --status reporting (TRD-011)', () => {
    let statusStep;

    beforeAll(() => {
      const entryPhase = commandYaml.workflow.phases.find((p) => p.name === 'Entry Point Resolution');
      statusStep = entryPhase.steps.find((s) => s.title === 'No Arguments -- Resume Active or Show Status');
    });

    test('AC-012-1: --status is read-only and always prints the five required fields', () => {
      expect(actionsText(statusStep)).toMatch(/If `status` is true/);
      expect(actionsText(statusStep)).toMatch(/No stage executes and no mutate\(\) call is made/);
      expect(actionsText(statusStep)).toMatch(/run identifier, current stage, last\s+stageOutcome\.kind/);
      expect(actionsText(statusStep)).toMatch(/every recorded artifacts\[\] and\s+beadRefs\[\] reference/);
      expect(actionsText(statusStep)).toMatch(/status is always\s+read-only and never proceeds to Stage Resolution/);
    });

    test('AC-012-1: falls back to the most recent terminal run when none is active', () => {
      expect(actionsText(statusStep)).toMatch(/read the run files under \.ensemble\/new-feature\//);
      expect(actionsText(statusStep)).toMatch(/latest updatedAt/);
    });

    test('AC-012-2: a completed run with no PR never implies one was created', () => {
      expect(actionsText(statusStep)).toMatch(/Claim a PR exists only if/);
      expect(actionsText(statusStep)).toMatch(/STATUS_RUN\.prApprovedAt is non-null AND a beadRefs\[\] entry has the "pr:" prefix/);
      expect(actionsText(statusStep)).toMatch(/otherwise state plainly that no PR exists/);
    });
  });

  describe('AC-007-3: Abandon Confirmation Gate (TRD-001)', () => {
    let abandonStep;
    let noArgsStep;

    beforeAll(() => {
      const entryPhase = commandYaml.workflow.phases.find((p) => p.name === 'Entry Point Resolution');
      abandonStep = entryPhase.steps.find((s) => s.title === 'Abandon Confirmation Gate');
      noArgsStep = entryPhase.steps.find((s) => s.title === 'No Arguments -- Resume Active or Show Status');
    });

    test('the `abandon` parameter exists and documents its optional-reason/precedence contract', () => {
      const param = commandYaml.parameters.find((p) => p.name === 'abandon');
      expect(param).toBeDefined();
      expect(param.required).toBe(false);
      expect(param.description).toMatch(/optional reason/);
      expect(param.description).toMatch(/idea.*or.*path.*is also given, that takes\s+precedence/);
    });

    test('AC-007-3: a confirmation is asked before RunIndexStore.abandon() is called', () => {
      expect(abandonStep).toBeDefined();
      expect(actionsText(abandonStep)).toMatch(/Found: ask the user for explicit confirmation/);
      expect(actionsText(abandonStep)).toMatch(/before calling RunIndexStore\.abandon\(\)/);
    });

    test('AC-007-3: a decline leaves the run untouched -- no mutate()/abandon() call, no state change', () => {
      expect(actionsText(abandonStep)).toMatch(/Declined or no response: make no\s+mutate\(\)\/abandon\(\) call/);
      expect(actionsText(abandonStep)).toMatch(/the run is left untouched/);
    });

    test('AC-007-3: no active run exists -- reports nothing to abandon, makes no state change', () => {
      expect(actionsText(abandonStep)).toMatch(/Not found: print 'No active run exists/);
      expect(actionsText(abandonStep)).toMatch(/no mutate\(\)\/abandon\(\) call is made, no state is touched/);
    });

    test('a confirmed abandon calls RunIndexStore.abandon() with the given reason and retains history', () => {
      expect(actionsText(abandonStep)).toMatch(/call RunIndexStore\.abandon\(projectRoot, runId, reason\)/);
      expect(actionsText(abandonStep)).toMatch(/sets status to "abandoned"/);
      expect(actionsText(abandonStep)).toMatch(/artifacts and history are retained/);
    });

    test("Step 4's resume/status branch explicitly excludes abandon, so the two steps never both fire", () => {
      expect(actionsText(noArgsStep)).toMatch(/`abandon` is not provided, and neither `idea` nor `path`/);
    });
  });

  describe('AC-013-2: generated command is discoverable in each runtime (TRD-021)', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const markdownPath = path.join(repoRoot, 'packages/development/commands/ensemble/new-feature.md');
    const piPath = path.join(repoRoot, 'packages/pi/prompts/ensemble-new-feature.md');
    const codexPath = path.join(repoRoot, 'packages/codex/.codex/skills/commands/ensemble-new-feature/SKILL.md');
    const fixIssueMarkdownPath = path.join(repoRoot, 'packages/development/commands/ensemble/fix-issue.md');

    test('the product-command markdown file exists, carries the DO NOT EDIT banner, and has name/category frontmatter', () => {
      expect(fs.existsSync(markdownPath)).toBe(true);
      const content = fs.readFileSync(markdownPath, 'utf8');
      expect(content).toMatch(/DO NOT EDIT - Generated from new-feature\.yaml/);
      expect(content).toMatch(/name:\s*"ensemble:new-feature"/);
      expect(content).toMatch(/category:\s*"implementation"/);
    });

    test('the pi prompt file exists and carries its generator/source marker', () => {
      expect(fs.existsSync(piPath)).toBe(true);
      const content = fs.readFileSync(piPath, 'utf8');
      expect(content).toMatch(/Generated by ensemble-pi generator/);
      expect(content).toMatch(/Source: new-feature\.yaml/);
      expect(content).toMatch(/Command: ensemble-new-feature/);
    });

    test('the codex skill file exists, carries codex frontmatter, and is user-invocable', () => {
      expect(fs.existsSync(codexPath)).toBe(true);
      const content = fs.readFileSync(codexPath, 'utf8');
      // A skill-backed command ships its skill as the codex skill: the user invokes it by
      // name and the model never starts it on its own (disable-model-invocation).
      expect(content).toMatch(/name:\s*ensemble-new-feature/);
      expect(content).toMatch(/disable-model-invocation:\s*true/);
    });

    test('AC-013-2: new-feature appears alongside fix-issue in the product-command runtime (no separate catalog/manifest -- same file-presence discovery mechanism both commands share)', () => {
      expect(fs.existsSync(fixIssueMarkdownPath)).toBe(true);
      expect(fs.existsSync(markdownPath)).toBe(true);
    });
  });
});

