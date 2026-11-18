/**
 * TRD-020-TEST: implement-trd-tasks parity against the pre-rename golden capture.
 *
 * The backend-neutral rename (`ensemble:implement-trd-beads` -> `ensemble:implement-trd-tasks`)
 * must not change what the command does:
 *
 *   - AC-010-1: every phase the beads-named command supported (plan-only execution, unattended
 *     execution, branch selection, status reporting, single-task reset, backlog listing,
 *     workstream generation, delegation to an external runner) is still accepted and reaches the
 *     same handling the golden capture recorded.
 *   - AC-010-2: the scaffolded work items keep the same titles, dependency edges and phase
 *     grouping as the captured plan.
 *   - AC-010-3: the plan-only completion message names the renamed command's execute step.
 *
 * The capture in tests/fixtures/implement-trd/ was recorded before the rename, so each comparison
 * rewrites the retired command name in the captured text (or undoes the rename in the current
 * prose) before comparing. The capture stays read-only evidence; the plan comparison reads the
 * three named fields instead of byte-comparing the 1 MB transcript.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { readDevelopmentSkill, parseWorkflow, parseParameters } = require('./helpers/skill-workflow');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PKG_DIR = path.join(__dirname, '..');
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'implement-trd');
const TRD_CLI = path.join(PKG_DIR, 'lib', 'trd-cli.js');
const TRD_PATH = path.join(
  REPO_ROOT,
  'docs',
  'TRD',
  'TRD-2026-6995dc96-configurable-tasks-backend-kata.md'
);

const golden = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'command-golden.json'), 'utf8'));
const manifest = yaml.load(fs.readFileSync(path.join(PKG_DIR, 'commands', 'implement-trd-tasks.yaml'), 'utf8'));
const skill = readDevelopmentSkill(manifest.skill);
const workflow = parseWorkflow(skill);

const RETIRED_NAME = 'implement-trd-beads';
const RETIRED_COMMAND = `/ensemble:${RETIRED_NAME}`;
const RENAMED_COMMAND = '/ensemble:implement-trd-tasks';
const RENAMED_NAME = 'implement-trd-tasks';

// The capture predates the rename: rewrite the captured command name to compare it with the
// current prose, and undo the rename in current prose to compare it with the capture.
const applyRename = (text) => text.split(RETIRED_COMMAND).join(RENAMED_COMMAND);
const undoRename = (text) => text.split(RENAMED_COMMAND).join(RETIRED_COMMAND);
// The capture also stores the skill directory name and the command file path, which carry the
// bare (unprefixed) name; those need their own rewrite.
const applyRenameBare = (text) => text.split(RETIRED_NAME).join(RENAMED_NAME);
const toPosixPath = (text) => text.split(path.sep).join('/');

// A TRD task checkbox records progress, not the work-item contract the capture pins.
const withoutCheckbox = (title) => title.replace(/\[([ xX])\]/g, '[ ]');

const goldenRules = golden.argumentRules.rules;
const goldenActionsOf = (phaseName) =>
  golden.workflow.find((p) => p.name === phaseName).steps.flatMap((s) => s.actions);
const currentActionsOf = (phaseName) =>
  workflow.find((p) => p.name === phaseName).steps.flatMap((s) => s.actions);
const currentPreflightActions = currentActionsOf('Preflight');
const currentPreflightText = currentPreflightActions.join('\n');
const currentParameters = parseParameters(skill.body);

describe('TRD-020-TEST: the renamed command preserves every captured phase (AC-010-1)', () => {
  test('phase order, phase names and step titles are the captured ones', () => {
    expect(workflow.map((p) => ({ order: p.order, name: p.name }))).toEqual(
      golden.workflow.map((p) => ({ order: p.order, name: p.name }))
    );
    for (const capturedPhase of golden.workflow) {
      const currentPhase = workflow.find((p) => p.order === capturedPhase.order);
      expect(currentPhase.steps.map((s) => s.title)).toEqual(capturedPhase.steps.map((s) => s.title));
    }
  });

  test('every captured step description and action survives, with only the command name changed', () => {
    for (const capturedPhase of golden.workflow) {
      const currentPhase = workflow.find((p) => p.order === capturedPhase.order);
      for (let i = 0; i < capturedPhase.steps.length; i++) {
        const capturedStep = capturedPhase.steps[i];
        const currentStep = currentPhase.steps[i];
        expect(undoRename(currentStep.description)).toBe(capturedStep.description);
        expect(currentStep.actions.map(undoRename)).toEqual(capturedStep.actions);
        expect(currentStep.description).not.toContain(RETIRED_NAME);
        expect(currentStep.actions.join('\n')).not.toContain(RETIRED_NAME);
      }
    }
  });

  test('each named phase is still handled by the rule the capture recorded', () => {
    const NAMED_PHASES = [
      {
        name: 'plan-only execution',
        evidence: [
          { kind: 'rule', match: (guard) => guard.includes('`--plan` with `--execute`') },
          { kind: 'action', phase: 'Scaffold', match: (action) => action.includes('PLAN_ONLY') },
        ],
      },
      {
        name: 'unattended execution',
        evidence: [
          { kind: 'parameter', name: 'foreman' },
          { kind: 'action', phase: 'Scaffold', match: (action) => action.includes('`--foreman`') },
        ],
      },
      {
        name: 'branch selection',
        evidence: [{ kind: 'rule', match: (guard) => guard.includes('`--branch=<name>`') }],
      },
      {
        name: 'status reporting',
        evidence: [{ kind: 'rule', match: (guard) => guard === '`--status`' }],
      },
      {
        name: 'single-task reset',
        evidence: [{ kind: 'rule', match: (guard) => guard.includes('`--reset-task TRD-XXX`') }],
      },
      {
        name: 'backlog listing',
        evidence: [{ kind: 'rule', match: (guard) => guard === '`--list`' }],
      },
      {
        name: 'workstream generation',
        evidence: [
          {
            kind: 'rule',
            match: (guard) => guard.includes('`--workstream`') || guard.includes('`--generate-only`'),
          },
        ],
      },
      {
        name: 'external-runner delegation',
        evidence: [
          { kind: 'action', phase: 'Execute', match: (action) => action.includes('/ensemble:beads-build') },
          { kind: 'rule', match: (guard) => guard.includes('--max-parallel') },
        ],
      },
    ];

    const report = {};
    for (const named of NAMED_PHASES) {
      const entry = { captured: 0, preserved: true };
      for (const item of named.evidence) {
        if (item.kind === 'rule') {
          const rules = goldenRules.filter((rule) => item.match(rule.guard));
          entry.captured += rules.length;
          for (const rule of rules) {
            if (!currentPreflightText.includes(applyRename(rule.text))) entry.preserved = false;
          }
        } else if (item.kind === 'parameter') {
          const capturedParameter = golden.parameters.find((p) => p.name === item.name);
          const currentParameter = currentParameters.find((p) => p.name === item.name);
          entry.captured += capturedParameter ? 1 : 0;
          if (!capturedParameter || !currentParameter) entry.preserved = false;
        } else {
          const capturedAction = goldenActionsOf(item.phase).find((action) => item.match(action));
          entry.captured += capturedAction ? 1 : 0;
          if (!capturedAction || !currentActionsOf(item.phase).includes(applyRename(capturedAction))) {
            entry.preserved = false;
          }
        }
      }
      report[named.name] = entry;
    }

    const uncovered = Object.entries(report)
      .filter(([, entry]) => entry.captured === 0)
      .map(([name]) => name);
    const unpreserved = Object.entries(report)
      .filter(([, entry]) => !entry.preserved)
      .map(([name]) => name);
    expect(uncovered).toEqual([]);
    expect(unpreserved).toEqual([]);
  });

  test('the command under test is the renamed command the capture recorded', () => {
    expect(applyRenameBare(golden.skill)).toBe(manifest.skill);
    expect(applyRenameBare(golden.sourceYaml)).toBe(
      toPosixPath(path.relative(REPO_ROOT, path.join(PKG_DIR, 'commands', `${RENAMED_NAME}.yaml`)))
    );
  });

  test('the declared parameters are the captured ones', () => {
    const shape = (p) => ({ name: p.name, type: p.type, required: p.required, default: p.default });
    expect(currentParameters.map(shape)).toEqual(golden.parameters.map(shape));
  });

  test('the argument rules never invoke the retired command', () => {
    expect(currentPreflightText).not.toContain(RETIRED_NAME);
  });
});

describe('TRD-020-TEST: the scaffolded work items match the captured plan (AC-010-2)', () => {
  const captured = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'cli-plan_scaffold_plan.json'), 'utf8'));
  const capturedPlan = captured.json.plan;
  let currentPlan;

  beforeAll(() => {
    const stdout = execFileSync(process.execPath, [TRD_CLI, 'scaffold-plan', TRD_PATH], {
      cwd: PKG_DIR,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    currentPlan = JSON.parse(stdout).plan;
  }, 60000);

  const titlesOf = (plan) =>
    plan.tasks.map((task) => `${task.id} | ${task.titlePrefix} | ${withoutCheckbox(task.title)}`);
  const taskEdgesOf = (plan) =>
    plan.tasks
      .map((task) => `${task.id} dependsOn ${JSON.stringify(task.dependsOn || [])}`)
      .sort();
  const depEdgesOf = (plan) =>
    plan.deps.map((dep) => `${dep.type} ${dep.blockerId} -> ${dep.blockedId}`).sort();
  const groupingOf = (plan) => ({
    epic: plan.epic.titlePrefix,
    stories: plan.stories.map((story) => `${story.phaseN} | ${story.titlePrefix} | ${withoutCheckbox(story.title)}`),
    tasks: plan.tasks.map((task) => `${task.id} in phase ${task.phaseN}`),
  });

  test('the capture is non-trivial, so the comparison cannot pass vacuously', () => {
    expect(capturedPlan.tasks.length).toBeGreaterThan(0);
    expect(capturedPlan.stories.length).toBeGreaterThan(0);
    expect(capturedPlan.deps.length).toBeGreaterThan(0);
    expect(currentPlan.tasks.length).toBe(capturedPlan.tasks.length);
    expect(currentPlan.stories.length).toBe(capturedPlan.stories.length);
    expect(currentPlan.deps.length).toBe(capturedPlan.deps.length);
  });

  test('work-item titles are the captured ones', () => {
    expect(titlesOf(currentPlan)).toEqual(titlesOf(capturedPlan));
  });

  test('dependency edges are the captured ones', () => {
    expect(taskEdgesOf(currentPlan)).toEqual(taskEdgesOf(capturedPlan));
    expect(depEdgesOf(currentPlan)).toEqual(depEdgesOf(capturedPlan));
  });

  test('phase grouping is the captured one', () => {
    expect(groupingOf(currentPlan)).toEqual(groupingOf(capturedPlan));
  });
});

describe('TRD-020-TEST: the plan-only completion names the renamed execute step (AC-010-3)', () => {
  const planOnlyActions = (actions) => actions.filter((action) => action.includes('PLAN_ONLY'));

  test('the plan-only completion names the renamed command and not the retired one', () => {
    const messages = planOnlyActions(currentActionsOf('Scaffold'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('/ensemble:implement-trd-tasks --execute');
    expect(messages[0]).not.toContain(RETIRED_NAME);
  });

  test('the plan-only completion is the captured message with the command renamed', () => {
    const capturedMessages = planOnlyActions(goldenActionsOf('Scaffold'));
    expect(capturedMessages).toHaveLength(1);
    expect(currentActionsOf('Scaffold')).toContain(applyRename(capturedMessages[0]));
  });

  test('plan-only mode is the one the --plan argument selects', () => {
    const planRule = currentPreflightActions.find((action) => action.includes('`--plan`'));
    expect(planRule).toBeDefined();
    expect(planRule).toMatch(/PLAN_ONLY/);
  });
});
