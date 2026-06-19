'use strict';

/**
 * Pure scaffold planner.
 *
 * Extracts Scaffold Steps 3-6 (epic / story / task / synthesized-test / and
 * dependency edge construction) from
 * packages/development/commands/implement-trd-beads.yaml into a pure,
 * tested function.
 *
 * IMPORTANT: this module has NO side effects. It does NOT call `br`, git, or
 * any shell. It returns a PLAN (plain data) that a caller will later execute
 * (creating beads and wiring dependencies via `br`).
 *
 * The plan uses stable TITLE PREFIXES as identifiers for dependency edges,
 * because real bead ids do not exist yet at planning time. The title prefix is
 * also the idempotency key that the executor matches against existing beads.
 *
 * @typedef {import('./trd-parser').ParsedTRD} ParsedTRD
 *
 * @typedef {Object} ScaffoldPlan
 * @property {EpicPlan} epic
 * @property {StoryPlan[]} stories
 * @property {TaskPlan[]} tasks
 * @property {SynthTestPlan[]} synthesizedTests
 * @property {DepEdge[]} deps
 * @property {string[]} warnings
 *
 * @typedef {Object} DepEdge
 * @property {('story-blocks-epic'|'task-blocks-story'|'task-depends'|'inter-phase-gate'|'synthtest-depends')} type
 * @property {string} blockerId  title-prefix of the blocking bead
 * @property {string} blockedId  title-prefix of the blocked bead
 */

const DEFAULT_PRIORITY = 2;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Lower-case a TRD/PRD anchor id (e.g. TRD-001 -> trd-001). */
function lower(s) {
  return String(s == null ? '' : s).toLowerCase();
}

/** True when a satisfies token is the INFRA / ARCH non-PRD marker. */
function isInfraOrArch(token) {
  return /^(INFRA|ARCH)$/i.test(String(token || '').trim());
}

/** Render a list of texts as a markdown checklist block (one "- [ ] x" per line). */
function checklistBlock(items) {
  return items.map((t) => `- [ ] ${t}`).join('\n');
}

/** Render a list of texts as a numbered list block ("1. x"). */
function numberedBlock(items) {
  return items.map((t, i) => `${i + 1}. ${t}`).join('\n');
}

/** Join non-null/non-undefined description sections with single newlines. */
function joinSections(sections) {
  return sections.filter((s) => s !== null && s !== undefined).join('\n');
}

// ---------------------------------------------------------------------------
// Title-prefix builders (the idempotency keys / stable identifiers)
// ---------------------------------------------------------------------------

function epicPrefix(slug) {
  return `[trd:${slug}]`;
}

function storyPrefix(slug, beadPrefix, n) {
  return `[trd:${slug}:${beadPrefix}:${n}]`;
}

function taskPrefix(slug, taskId) {
  return `[trd:${slug}:task:${taskId}]`;
}

// ---------------------------------------------------------------------------
// Description builders (port of YAML Scaffold Step 5 lines ~517-518 & Step 6)
// ---------------------------------------------------------------------------

/**
 * Build the structured description for an implementation task bead.
 * Ports implement-trd-beads.yaml Step 5 line ~517, including the Sub-items and
 * Embedded-tests additions.
 */
function buildImplTaskDescription(task, opts) {
  const { trdFilePath, prdFilePath } = opts;
  const satisfiesReq = task.satisfies && task.satisfies.length ? task.satisfies[0] : '';

  const sections = [];
  sections.push(`## Task: ${task.id}`);
  sections.push(`TRD Reference: ${trdFilePath}#${lower(task.id)}`);

  // PRD Reference line is omitted for INFRA / ARCH / empty satisfies.
  if (satisfiesReq && !isInfraOrArch(satisfiesReq)) {
    sections.push(`PRD Reference: ${prdFilePath}#${lower(satisfiesReq)}`);
  }

  sections.push(`Satisfies: ${satisfiesReq}`);
  sections.push(`PRD ACs: ${(task.validatesAcs || []).join(', ')}`);
  sections.push(`Target File: ${(task.targetFiles || []).join(', ')}`);

  sections.push('Actions:');
  sections.push(numberedBlock(task.actions || []));

  sections.push('Implementation AC:');
  sections.push(checklistBlock(task.implementationAc || []));

  // Sub-items section — only when nestedSubitems is non-empty.
  if (task.nestedSubitems && task.nestedSubitems.length) {
    sections.push('Sub-items (every checklist item below MUST be completed before this task is done):');
    sections.push(checklistBlock(task.nestedSubitems));
  }

  // Embedded tests section — only when testSubitems is non-empty.
  if (task.testSubitems && task.testSubitems.length) {
    sections.push('Embedded tests (implement AND run these — they have no separate TRD-NNN-TEST task):');
    sections.push(checklistBlock(task.testSubitems));
  }

  sections.push(`Dependencies: ${(task.dependsOn || []).join(', ')}`);

  return joinSections(sections);
}

/**
 * Build the structured description for a test task bead.
 * Ports implement-trd-beads.yaml Step 5 line ~518.
 */
function buildTestTaskDescription(task, opts) {
  const { trdFilePath, prdFilePath } = opts;
  const satisfiesReq = task.satisfies && task.satisfies.length ? task.satisfies[0] : '';
  const verifies = task.verifies || '';

  const sections = [];
  sections.push(`## Test Task: ${task.id}`);
  sections.push(`TRD Reference: ${trdFilePath}#${lower(task.id)}`);
  if (satisfiesReq && !isInfraOrArch(satisfiesReq)) {
    sections.push(`PRD Reference: ${prdFilePath}#${lower(satisfiesReq)}`);
  }
  sections.push(`Verifies Task: ${trdFilePath}#${lower(verifies)}`);
  sections.push(`Verifies: ${verifies}`);
  sections.push(`Satisfies: ${satisfiesReq}`);
  sections.push(`PRD ACs Proven: ${(task.validatesAcs || []).join(', ')}`);
  sections.push(`Proof of requirement: ${task.proofOfRequirement || ''}`);
  sections.push(`Target Files: ${(task.targetFiles || []).join(', ')}`);
  sections.push('Actions:');
  sections.push(numberedBlock(task.actions || []));
  sections.push('Test AC:');
  sections.push(checklistBlock(task.testAc || []));
  sections.push(`Dependencies: ${(task.dependsOn || []).join(', ')}`);

  return joinSections(sections);
}

/**
 * Build the description for a synthesized test bead derived from a nested test
 * sub-item. Ports implement-trd-beads.yaml Step 6 line ~535.
 */
function buildSynthTestDescription(synthId, parentTask, subitemText) {
  const satisfiesReq = parentTask.satisfies && parentTask.satisfies.length ? parentTask.satisfies[0] : '';
  const sections = [];
  sections.push(`## Synthesized Test Task: ${synthId}`);
  sections.push(`Derived from a nested test sub-item of ${parentTask.id} (no explicit TRD-NNN-TEST task existed).`);
  sections.push(`Verifies Task: ${parentTask.id}`);
  sections.push(`Verifies: ${parentTask.id}`);
  sections.push(`Satisfies: ${satisfiesReq}`);
  sections.push(`Test objective: ${subitemText}`);
  sections.push(`Target Files: ${(parentTask.targetFiles || []).join(', ')}`);
  sections.push(`Parent impl task: ${parentTask.id}`);
  return joinSections(sections);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build a pure scaffold plan from a ParsedTRD.
 * Never throws — problems are collected into the returned `warnings` array.
 *
 * @param {ParsedTRD} parsed  output of parseTRD()
 * @param {{trdSlug:string, trdFilePath:string, prdFilePath:string}} opts
 * @returns {ScaffoldPlan}
 */
function buildScaffoldPlan(parsed, opts) {
  const warnings = [];

  // Defensive defaults — never throw on malformed input.
  const safeParsed = parsed && typeof parsed === 'object' ? parsed : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const slug = o.trdSlug == null ? '' : String(o.trdSlug);
  const trdFilePath = o.trdFilePath == null ? '' : String(o.trdFilePath);
  const prdFilePath = o.prdFilePath == null ? '' : String(o.prdFilePath);
  const descOpts = { trdFilePath, prdFilePath };

  const prFormat = !!safeParsed.prFormat;
  const phases = Array.isArray(safeParsed.phases) ? safeParsed.phases : [];
  const tasksById = safeParsed.tasksById && typeof safeParsed.tasksById === 'object'
    ? safeParsed.tasksById
    : {};
  const title = safeParsed.title || '';
  const summary = safeParsed.summary || '';

  // bead_prefix / bead_label.
  const beadPrefix = prFormat ? 'pr' : 'phase';
  const beadLabel = prFormat ? 'PR' : 'Phase';

  // -------------------------------------------------------------------------
  // Epic (Step 3).
  // -------------------------------------------------------------------------
  const epic = {
    titlePrefix: epicPrefix(slug),
    title: `${epicPrefix(slug)} Implement TRD: ${title}`,
    type: 'epic',
    priority: DEFAULT_PRIORITY,
    description: summary,
  };

  // -------------------------------------------------------------------------
  // Stories (Step 4) — one per phase, stable ascending order.
  // -------------------------------------------------------------------------
  const stories = [];
  // Map phaseN -> story title-prefix (used to wire task-blocks-story edges).
  const storyPrefixByPhase = {};
  // Sort phases ascending by n for determinism (parser already orders them,
  // but be explicit).
  const orderedPhases = phases.slice().sort((a, b) => a.n - b.n);

  for (const phase of orderedPhases) {
    const prefix = storyPrefix(slug, beadPrefix, phase.n);
    storyPrefixByPhase[phase.n] = prefix;
    const taskCount = Array.isArray(phase.taskIds) ? phase.taskIds.length : 0;
    const shippableState = phase.shippableState || null;
    const shippableLine = prFormat && shippableState
      ? ` Shippable state: ${shippableState}`
      : '';
    const description = `${beadLabel} ${phase.n} of TRD: ${title}. Contains ${taskCount} tasks.${shippableLine}`;

    stories.push({
      phaseN: phase.n,
      titlePrefix: prefix,
      title: `${prefix} ${beadLabel} ${phase.n}: ${phase.title}`,
      type: 'feature',
      priority: DEFAULT_PRIORITY,
      description,
      shippableState,
    });
  }

  // -------------------------------------------------------------------------
  // Tasks (Step 5) — one per non-synthesized task, document order.
  // -------------------------------------------------------------------------
  const tasks = [];
  const taskPrefixById = {};
  // Document order: walk phases ascending, then taskIds in their listed order.
  // This matches parser document order and keeps the plan deterministic.
  const orderedTaskIds = [];
  // A task id is usable only when tasksById holds an actual object for it.
  // Null / non-object entries are skipped with a warning rather than throwing
  // (honors the never-throw contract for malformed/partial parse output).
  const isUsableTask = (tid) =>
    Object.prototype.hasOwnProperty.call(tasksById, tid) &&
    tasksById[tid] != null &&
    typeof tasksById[tid] === 'object';
  for (const phase of orderedPhases) {
    for (const tid of (phase.taskIds || [])) {
      if (typeof tid !== 'string' || !tid) continue;
      if (isUsableTask(tid)) {
        orderedTaskIds.push(tid);
      } else if (Object.prototype.hasOwnProperty.call(tasksById, tid)) {
        warnings.push(`Task id ${tid} has no valid task object — skipped`);
      }
    }
  }
  // Include any tasks present in tasksById but not referenced by a phase
  // (defensive — should not normally happen). Preserve insertion order.
  for (const tid of Object.keys(tasksById)) {
    if (orderedTaskIds.includes(tid)) continue;
    if (isUsableTask(tid)) {
      orderedTaskIds.push(tid);
    } else {
      warnings.push(`Task id ${tid} has no valid task object — skipped`);
    }
  }

  for (const tid of orderedTaskIds) {
    const task = tasksById[tid];
    const prefix = taskPrefix(slug, task.id);
    taskPrefixById[task.id] = prefix;
    const priority = (typeof task.priority === 'number') ? task.priority : DEFAULT_PRIORITY;
    const description = task.isTest
      ? buildTestTaskDescription(task, descOpts)
      : buildImplTaskDescription(task, descOpts);

    tasks.push({
      id: task.id,
      phaseN: task.phaseN,
      titlePrefix: prefix,
      title: `${prefix} ${task.description}`,
      type: 'task',
      priority,
      description,
      isTest: !!task.isTest,
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.slice() : [],
    });
  }

  // -------------------------------------------------------------------------
  // Synthesized tests (Step 6) — one per testSubitems entry.
  // -------------------------------------------------------------------------
  const synthesizedTests = [];
  for (const tid of orderedTaskIds) {
    const task = tasksById[tid];
    const subitems = Array.isArray(task.testSubitems) ? task.testSubitems : [];
    for (let k = 0; k < subitems.length; k++) {
      const subitemText = subitems[k];
      const synthId = `${task.id}-TEST-S${k + 1}`;
      const prefix = taskPrefix(slug, synthId);
      const priority = (typeof task.priority === 'number') ? task.priority : DEFAULT_PRIORITY;
      synthesizedTests.push({
        id: synthId,
        parentId: task.id,
        phaseN: task.phaseN,
        titlePrefix: prefix,
        title: `${prefix} ${subitemText}`,
        type: 'task',
        priority,
        description: buildSynthTestDescription(synthId, task, subitemText),
        verifies: task.id,
        satisfies: Array.isArray(task.satisfies) ? task.satisfies.slice() : [],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Dependency edges (Steps 4, 5, 6, 7) — emitted, never executed.
  // blockerId blocks blockedId.
  // -------------------------------------------------------------------------
  const deps = [];

  // story-blocks-epic: every story blocks the epic (epic closes last).
  for (const story of stories) {
    deps.push({
      type: 'story-blocks-epic',
      blockerId: story.titlePrefix,
      blockedId: epic.titlePrefix,
    });
  }

  // task-blocks-story: every task blocks its phase story.
  for (const t of tasks) {
    const sp = storyPrefixByPhase[t.phaseN];
    if (sp) {
      deps.push({
        type: 'task-blocks-story',
        blockerId: t.titlePrefix,
        blockedId: sp,
      });
    } else {
      warnings.push(`Task ${t.id} belongs to phase ${t.phaseN} which has no story — task-blocks-story edge skipped`);
    }
  }

  // task-depends: explicit dependsOn edges. dep blocks task.
  for (const tid of orderedTaskIds) {
    const task = tasksById[tid];
    const deparr = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    for (const depId of deparr) {
      if (isUsableTask(depId)) {
        deps.push({
          type: 'task-depends',
          blockerId: taskPrefixById[depId],
          blockedId: taskPrefixById[task.id],
        });
      } else {
        warnings.push(`Task ${task.id} depends on unknown task id ${depId} — dependency skipped`);
      }
    }
  }

  // inter-phase-gate: for phase i >= 2, last task of phase i-1 blocks first
  // task of phase i (sequential gate between phases).
  for (let i = 1; i < orderedPhases.length; i++) {
    const prevPhase = orderedPhases[i - 1];
    const curPhase = orderedPhases[i];
    const prevTaskIds = (prevPhase.taskIds || []).filter(isUsableTask);
    const curTaskIds = (curPhase.taskIds || []).filter(isUsableTask);
    if (prevTaskIds.length === 0 || curTaskIds.length === 0) continue;
    const lastPrev = prevTaskIds[prevTaskIds.length - 1];
    const firstCur = curTaskIds[0];
    deps.push({
      type: 'inter-phase-gate',
      blockerId: taskPrefixById[lastPrev],
      blockedId: taskPrefixById[firstCur],
    });
  }

  // synthtest-depends + task-blocks-story for synthesized tests.
  for (const synth of synthesizedTests) {
    // Parent impl task blocks the synth test (test runs after implementation).
    deps.push({
      type: 'synthtest-depends',
      blockerId: taskPrefixById[synth.parentId],
      blockedId: synth.titlePrefix,
    });
    // Synth test also blocks its phase story (story closes after all tasks).
    const sp = storyPrefixByPhase[synth.phaseN];
    if (sp) {
      deps.push({
        type: 'task-blocks-story',
        blockerId: synth.titlePrefix,
        blockedId: sp,
      });
    } else {
      warnings.push(`Synthesized test ${synth.id} belongs to phase ${synth.phaseN} which has no story — task-blocks-story edge skipped`);
    }
  }

  return {
    epic,
    stories,
    tasks,
    synthesizedTests,
    deps,
    warnings,
  };
}

module.exports = { buildScaffoldPlan };
