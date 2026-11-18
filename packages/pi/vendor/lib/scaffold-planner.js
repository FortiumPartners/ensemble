'use strict';

/**
 * Pure scaffold planner.
 *
 * Extracts Scaffold Steps 3-6 (epic / story / task / synthesized-test / and
 * dependency edge construction) from
 * packages/development/commands/implement-trd-tasks.yaml into a pure,
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
 * @typedef {Object} DepEdge
 * @property {('story-blocks-epic'|'task-blocks-story'|'task-depends'|'synthtest-depends')} type
 * @property {string} blockerId  title-prefix of the blocking bead
 * @property {string} blockedId  title-prefix of the blocked bead
 *
 * @typedef {Object} PrdContext
 * @property {Record<string, ReqEntry>} requirements
 * @property {Record<string, AcEntry>} acs
 * @typedef {Object} ReqEntry
 * @property {string} id
 * @property {string} title
 * @property {string} text
 * @property {string[]} acIds
 * @typedef {Object} AcEntry
 * @property {string} id
 * @property {string} reqId
 * @property {string} given
 * @property {string} when
 * @property {string} then
 * @property {string} text
 */

const { buildReferencesBlock } = require('./bead-refs');

const DEFAULT_PRIORITY = 2;

// br rejects a title over 500 Unicode code points and then refuses to load the whole
// tracker, so stay clear of the limit rather than at it.
const MAX_TITLE_CHARS = 480;

/**
 * Join a bead title prefix and its text, truncating the text on a word boundary
 * (with an ellipsis) so the whole title fits br's limit. Counts code points, as br
 * does, so a surrogate pair is never split. A title that already fits is unchanged.
 */
function clampTitle(prefix, text, max = MAX_TITLE_CHARS) {
  const chars = Array.from(String(text));
  const room = max - Array.from(prefix).length - 1; // 1 = the joining space
  if (chars.length <= room) return `${prefix} ${text}`;
  const head = chars.slice(0, Math.max(room - 1, 0)).join(''); // 1 = the ellipsis
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > head.length / 2 ? head.slice(0, lastSpace) : head;
  return `${prefix} ${cut.trimEnd()}…`;
}

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
/**
 * Build a PRD enrichment block for a task that satisfies a given requirement.
 * Returns null when no PRD context is available for the requirement.
 * @param {string} reqId   e.g. "REQ-001"
 * @param {string[]} acIds  e.g. ["AC-001-1", "AC-001-2"]
 * @param {{requirements:Object, acs:Object}} prdContext
 * @returns {string|null}
 */
function prdEnrichmentSection(reqId, acIds, prdContext) {
  if (!prdContext || !reqId) return null;
  const reqs = prdContext.requirements || {};
  const acs = prdContext.acs || {};
  const req = reqs[reqId.toUpperCase()];
  if (!req) return null;

  const lines = [];
  lines.push('');
  lines.push('--- PRD Context ---');
  lines.push(`**Requirement ${req.id}**: ${req.title}`);
  lines.push(req.text);

  // Include AC breakdown for the ACs this task validates
  const taskAcs = (acIds || [])
    .map((id) => acs[id.toUpperCase()])
    .filter(Boolean);
  if (taskAcs.length) {
    lines.push('');
    lines.push('**Acceptance Criteria:**');
    for (const ac of taskAcs) {
      const parts = [];
      if (ac.given) parts.push(`Given ${ac.given}`);
      if (ac.when) parts.push(`When ${ac.when}`);
      if (ac.then) parts.push(`Then ${ac.then}`);
      lines.push(`- ${ac.id}: ${parts.join(' | ')}`);
    }
  }

  return lines.join('\n');
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
// References block (links every bead back to the TRD task / PRD requirement)
// ---------------------------------------------------------------------------

/** Satisfied PRD requirement ids of a task, excluding the INFRA / ARCH markers. */
function reqIdsOf(task) {
  return (Array.isArray(task.satisfies) ? task.satisfies : [])
    .map((s) => String(s || '').trim())
    .filter((s) => s && !isInfraOrArch(s));
}

/** The task's satisfies tokens exactly as written in the TRD (INFRA/ARCH included). */
function rawSatisfies(task) {
  return (Array.isArray(task.satisfies) ? task.satisfies : []).join(', ');
}

function taskReferencesBlock(task, opts, extra) {
  return buildReferencesBlock({
    trdPath: opts.trdFilePath,
    trdTaskId: task.id,
    prdPath: opts.prdFilePath,
    prdUnresolved: opts.prdUnresolved,
    reqIds: reqIdsOf(task),
    acIds: task.validatesAcs || [],
    parentEpicPrefix: opts.epicPrefix,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Description builders (port of YAML Scaffold Step 5 lines ~517-518 & Step 6)
// ---------------------------------------------------------------------------

/**
 * Build the structured description for an implementation task bead.
 * Ports implement-trd-tasks.yaml Step 5 line ~517, including the Sub-items and
 * Embedded-tests additions.
 */
function buildImplTaskDescription(task, opts) {
  const { prdContext, architectureDecision, keyTechnicalDecisions } = opts;
  const satisfiesAll = reqIdsOf(task);

  const sections = [];
  sections.push(`## Task: ${task.id}`);
  sections.push(taskReferencesBlock(task, opts, {}));
  sections.push('');
  // Embed actual PRD requirement prose and AC breakdown so agents never need to cross-reference.
  for (const reqId of satisfiesAll) {
    const prdBlock = prdEnrichmentSection(reqId, task.validatesAcs || [], prdContext);
    if (prdBlock) sections.push(prdBlock);
  }

  // TRD Architecture Decision and Key Technical Decisions — document-level context.
  if (architectureDecision || (keyTechnicalDecisions && keyTechnicalDecisions.length)) {
    sections.push('');
    sections.push('--- TRD Context ---');
    if (architectureDecision) {
      sections.push(architectureDecision);
    }
    if (keyTechnicalDecisions && keyTechnicalDecisions.length) {
      sections.push('');
      sections.push('**Key Technical Decisions:**');
      keyTechnicalDecisions.forEach((d) => sections.push(d));
    }
  }

  sections.push(`Satisfies: ${rawSatisfies(task)}`);
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
 * Ports implement-trd-tasks.yaml Step 5 line ~518.
 */
function buildTestTaskDescription(task, opts) {
  const { prdContext, architectureDecision, keyTechnicalDecisions } = opts;
  const satisfiesAll = reqIdsOf(task);
  const verifies = task.verifies || '';

  const sections = [];
  sections.push(`## Test Task: ${task.id}`);
  sections.push(taskReferencesBlock(task, opts, { verifiesTaskId: verifies }));
  sections.push('');
  // Embed actual PRD requirement prose and AC breakdown so agents never need to cross-reference.
  for (const reqId of satisfiesAll) {
    const prdBlock = prdEnrichmentSection(reqId, task.validatesAcs || [], prdContext);
    if (prdBlock) sections.push(prdBlock);
  }

  // TRD Architecture Decision and Key Technical Decisions — document-level context.
  if (architectureDecision || (keyTechnicalDecisions && keyTechnicalDecisions.length)) {
    sections.push('');
    sections.push('--- TRD Context ---');
    if (architectureDecision) {
      sections.push(architectureDecision);
    }
    if (keyTechnicalDecisions && keyTechnicalDecisions.length) {
      sections.push('');
      sections.push('**Key Technical Decisions:**');
      keyTechnicalDecisions.forEach((d) => sections.push(d));
    }
  }

  sections.push(`Verifies: ${verifies}`);
  sections.push(`Satisfies: ${rawSatisfies(task)}`);
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
 * sub-item. Ports implement-trd-tasks.yaml Step 6 line ~535.
 */
function buildSynthTestDescription(synthId, parentTask, subitemText, opts) {
  const sections = [];
  sections.push(`## Synthesized Test Task: ${synthId}`);
  sections.push(taskReferencesBlock(parentTask, opts, { verifiesTaskId: parentTask.id }));
  sections.push('');
  sections.push(`Derived from a nested test sub-item of ${parentTask.id} (no explicit TRD-NNN-TEST task existed).`);
  sections.push(`Verifies: ${parentTask.id}`);
  sections.push(`Satisfies: ${rawSatisfies(parentTask)}`);
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
 * @param {ParsedTRD} parsed
 * @param {{trdSlug:string, trdFilePath:string, prdFilePath:string, prdUnresolved?:boolean, prdContext:PrdContext}} opts
 *   trdFilePath / prdFilePath MUST already be repo-root-relative (forward slashes); prdFilePath is the
 *   raw reference when prdUnresolved is true, and '' when the TRD names no PRD.
 */
function buildScaffoldPlan(parsed, opts) {
  const warnings = [];

  // Defensive defaults — never throw on malformed input.
  const safeParsed = parsed && typeof parsed === 'object' ? parsed : {};
  const o = opts && typeof opts === 'object' ? opts : {};
  const slug = o.trdSlug == null ? '' : String(o.trdSlug);
  const trdFilePath = o.trdFilePath == null ? '' : String(o.trdFilePath);
  const prdFilePath = o.prdFilePath == null ? '' : String(o.prdFilePath);
  const prdContext = o.prdContext && typeof o.prdContext === 'object' ? o.prdContext : { requirements: {}, acs: {} };
  const prdUnresolved = !!o.prdUnresolved && !!prdFilePath;
  const descOpts = {
    trdFilePath,
    prdFilePath,
    prdUnresolved,
    epicPrefix: epicPrefix(slug),
    prdContext,
    architectureDecision: safeParsed.architectureDecision || null,
    keyTechnicalDecisions: Array.isArray(safeParsed.keyTechnicalDecisions) ? safeParsed.keyTechnicalDecisions : [],
  };
  const refsBase = { trdPath: trdFilePath, prdPath: prdFilePath, prdUnresolved };
  if (!prdFilePath) {
    warnings.push('TRD has no PRD reference — beads carry no PRD lines in their References block');
  } else if (prdUnresolved) {
    warnings.push(`PRD reference '${prdFilePath}' could not be resolved — beads carry an (UNRESOLVED) PRD line`);
  }

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
    title: clampTitle(epicPrefix(slug), `Implement TRD: ${title}`),
    type: 'epic',
    labels: [slug],
    priority: DEFAULT_PRIORITY,
    description: `${buildReferencesBlock(refsBase)}\n\n${summary}`,
    externalRef: trdFilePath,
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
    const description = `${buildReferencesBlock({ ...refsBase, parentEpicPrefix: epicPrefix(slug) })}\n\n${beadLabel} ${phase.n} of TRD: ${title}. Contains ${taskCount} tasks.${shippableLine}`;

    stories.push({
      phaseN: phase.n,
      titlePrefix: prefix,
      title: clampTitle(prefix, `${beadLabel} ${phase.n}: ${phase.title}`),
      type: 'feature',
      labels: [slug],
      priority: DEFAULT_PRIORITY,
      description,
      externalRef: trdFilePath,
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

    // The task's own text is not part of its bead description, so keep it whole there
    // whenever the title had to be shortened.
    const title = clampTitle(prefix, task.description);
    const clamped = title !== `${prefix} ${task.description}`;

    tasks.push({
      id: task.id,
      phaseN: task.phaseN,
      titlePrefix: prefix,
      title,
      type: 'task',
      labels: [slug],
      priority,
      description: clamped ? `Full title: ${task.description}\n\n${description}` : description,
      externalRef: `${trdFilePath}#${lower(task.id)}`,
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
        title: clampTitle(prefix, subitemText), // full text is in the description's "Test objective"
        type: 'task',
        labels: [slug],
        priority,
        description: buildSynthTestDescription(synthId, task, subitemText, descOpts),
        externalRef: `${trdFilePath}#${lower(task.id)}`,
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
    // The scoping label every bead below carries (`bv --robot-plan --label`, `br list --label`).
    // It is the slug already inside each `[trd:<slug>...]` title, not the TRD's display-only
    // frontmatter Label.
    label: slug,
    epic,
    stories,
    tasks,
    synthesizedTests,
    deps,
    warnings,
  };
}

/**
 * Stable, whitespace-free external dedupe key for a plan entry: its title prefix without the
 * brackets (`[trd:<slug>:task:TRD-001]` -> `trd:<slug>:task:TRD-001`). Deterministic, so a re-run
 * of the scaffold names the same key for the same entry.
 */
function externalKeyFor(titlePrefix) {
  return String(titlePrefix).replace(/^\[|\]$/g, '').replace(/\s+/g, '-');
}

/**
 * Turn a PLAN into the backend-neutral call sets the scaffold executes through the toolchain:
 * `creates[]` (one `tracker.create-detailed` argument set per entry, epic, stories, tasks, then
 * synthesized tests) and `deps[]` (the `plan.deps` edges in order, with title-prefix endpoints).
 * Pure: no tracker binary, shell or I/O is touched here.
 *
 * @param {object} plan  the `buildScaffoldPlan` result
 * @returns {{creates: Array<{kind:string, titlePrefix:string, args:object}>, deps: Array<{type:string, blockerPrefix:string, blockedPrefix:string}>}}
 */
function buildScaffoldCalls(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const entry = (kind, e) => ({
    kind,
    titlePrefix: e.titlePrefix,
    args: {
      title: e.title,
      description: e.description,
      type: e.type,
      labels: (Array.isArray(e.labels) ? e.labels : []).join(','),
      priority: String(e.priority == null ? DEFAULT_PRIORITY : e.priority),
      externalKey: externalKeyFor(e.titlePrefix),
    },
  });
  const creates = [];
  if (p.epic) creates.push(entry('epic', p.epic));
  for (const s of p.stories || []) creates.push(entry('story', s));
  for (const t of p.tasks || []) creates.push(entry('task', t));
  for (const t of p.synthesizedTests || []) creates.push(entry('test', t));
  const deps = (p.deps || []).map((d) => ({ type: d.type, blockerPrefix: d.blockerId, blockedPrefix: d.blockedId }));
  return { creates, deps };
}

/**
 * Resolve one `buildScaffoldCalls` edge to `tracker.dep-add` arguments (`id` is the blocked item,
 * `dependsOnId` its blocker), or `null` when either endpoint has no created id.
 */
function buildDepArgs(edge, idByPrefix) {
  const ids = idByPrefix && typeof idByPrefix === 'object' ? idByPrefix : {};
  const blocked = ids[edge && edge.blockedPrefix];
  const blocker = ids[edge && edge.blockerPrefix];
  if (!blocked || !blocker) return null;
  return { id: blocked, dependsOnId: blocker, type: 'blocks' };
}

module.exports = { buildScaffoldPlan, buildScaffoldCalls, buildDepArgs, externalKeyFor, clampTitle };
