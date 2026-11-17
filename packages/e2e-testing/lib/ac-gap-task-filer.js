'use strict';

/**
 * TRD-021: resolve the implementing commit author's ADO identity and file one
 * ADO Task per confirmed AC gap, for /ensemble:author-playwright-tests
 * (REQ-010, AC-010-1/AC-010-2). Consumes ac-gap-detector.js's (TRD-020)
 * `resolveGapReview(...)` 'confirmed' outcome — read that module first.
 *
 * This module has TWO distinct concerns, deliberately kept apart:
 *
 * 1. resolveImplementingAuthor(targetFiles, opts) — REAL git I/O, may shell
 *    out. Finds the most relevant commit author for the given target file(s)
 *    on the current branch. Follows implementation-grounding.js's (TRD-004)
 *    established convention: injectable `opts.gitExec` (defaulting to a real
 *    `execFileSync('git', [...])`, argv-array, no `shell: true`), and — same
 *    as that module — NEVER THROWS. Any resolution failure (bad input,
 *    untracked file, no git history, git not available) is reported as an
 *    explicit `{resolved: false, reason}` result rather than an exception,
 *    for the same reason implementation-grounding.js's `groundImplementation`
 *    never throws: "could the author be found" is a fact about the repo's
 *    history, not a caller-contract violation, and callers (this module's own
 *    `planGapTaskFiling`, or the orchestrator) need a normal value to branch
 *    on, not a try/catch.
 *
 *    Multi-file tie-break (deliberately simple, not a full blame-based
 *    attribution algorithm): each target file's most recent commit author is
 *    resolved independently via `git log -1 --format=%an|%ae|%at -- <file>`;
 *    if files disagree, the author of the single MOST RECENT commit across
 *    all files wins (highest `%at` author-timestamp). This is a reasonable
 *    proxy for "who most recently touched the implementing code," not a
 *    guarantee of "who wrote the most lines" — documented here rather than
 *    over-engineered.
 *
 * 2. planGapTaskFiling(...) / recordFiledGapTask(...) — MCP-only, PURE
 *    decision/shaping logic, no I/O. Same CRITICAL boundary as
 *    ado-test-suite.js (TRD-016) and ado-test-case-sync.js (TRD-017): Azure
 *    DevOps MCP tools (a `wit_create_work_item`-equivalent per this TRD's
 *    architecture diagram — the exact tool name is the orchestrator's
 *    concern, not hardcoded here) are only invocable by the orchestrating
 *    agent at conversation time. So this module never calls MCP itself; it
 *    only shapes the request the orchestrator passes to whatever tool it
 *    uses, and normalizes that tool's response afterward — matching
 *    ado-test-suite.js's resolveOrCreateTestSuite/recordCreatedSuite and
 *    ado-test-case-sync.js's planTestCaseSync/recordSyncedTestCase pattern.
 *
 *    `planGapTaskFiling` consumes concern #1's raw git identity
 *    (name/email) as-is for the Task's `assignedTo`. Resolving that git
 *    identity into an actual Azure DevOps user/descriptor (the
 *    architecture diagram's `core_get_identity_ids`) is a SEPARATE MCP call
 *    the orchestrator makes itself, between calling this module and calling
 *    the work-item-creation tool — not this module's job. This module only
 *    hands the orchestrator the plain email/name (or an explicit
 *    "could not resolve" note) to resolve.
 *
 *    Unlike ado-test-suite.js/ado-test-case-sync.js, there is no
 *    resolve-vs-create branch here: a confirmed AC gap is never "already
 *    filed" — every confirmed gap is a brand-new Task. So
 *    `planGapTaskFiling` always produces a "file a new Task" request; it
 *    does not accept an existing work item id to update.
 *
 *    AC-010-2 (one Task per gap, never bundled) is enforced by this
 *    module's very shape, not by a runtime check: `planGapTaskFiling` takes
 *    exactly ONE confirmed gap's fields (`acId`, `reqId`, `gapReason`) — no
 *    `gaps: []` array parameter, no "file everything found this session in
 *    one Task" code path exists anywhere in this module. The orchestrator
 *    calls it once per confirmed gap, by construction.
 *
 * Convention: concern #1 never throws (see above); concern #2 throws on
 * invalid input, listing every problem found — matching
 * ado-test-suite.js/ado-test-case-sync.js's `assertNoErrors` rigor, since
 * that half's inputs are already-decided data flowing between modules at
 * conversation time, not raw git/environment facts.
 */

const { execFileSync } = require('child_process');

const AUTHOR_LOG_FORMAT = '%an|%ae|%at';

/** Default `git` invocation — swappable via `opts.gitExec` for tests (matches implementation-grounding.js). */
function defaultGitExec(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' });
}

/** Throw a single clear error listing every problem found, or return true. */
function assertNoErrors(label, errors) {
  if (errors.length > 0) {
    throw new Error(`Invalid ${label}: ${errors.join('; ')}`);
  }
  return true;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isNonEmptyStringOrNumber(value) {
  return (typeof value === 'string' || typeof value === 'number') && String(value).trim() !== '';
}

/**
 * Resolve one file's most recent commit author via `git log -1`. Returns
 * `null` (never throws) if the file has no resolvable commit — git failed,
 * the file is untracked, or the log line came back in an unexpected shape.
 *
 * @param {(args: string[]) => string} gitExec
 * @param {string} file
 * @returns {{name: string, email: string, timestamp: number, file: string}|null}
 */
function resolveAuthorForFile(gitExec, file) {
  let raw;
  try {
    raw = gitExec(['log', '-1', `--format=${AUTHOR_LOG_FORMAT}`, '--', file]);
  } catch {
    return null;
  }

  const line = (raw || '').trim();
  if (!line) return null; // no commit touches this file

  const parts = line.split('|');
  if (parts.length < 3) return null; // unexpected log format — treat as unresolved for this file

  const [name, email, timestampStr] = parts;
  const timestamp = Number(timestampStr);
  if (!name.trim() || !email.trim() || !Number.isFinite(timestamp)) return null;

  return { name: name.trim(), email: email.trim(), timestamp, file };
}

/**
 * Resolve the implementing commit author for one or more target files, on
 * the current branch (real git I/O — see module header for why this never
 * throws and how multi-file ties are broken).
 *
 * @param {string[]} targetFiles - the implementing task's Target Files
 * @param {object} [opts]
 * @param {(args: string[]) => string} [opts.gitExec] - injectable git runner
 * @returns {{resolved: true, name: string, email: string, file: string}
 *          |{resolved: false, reason: string}}
 */
function resolveImplementingAuthor(targetFiles, opts = {}) {
  if (!Array.isArray(targetFiles) || targetFiles.length === 0) {
    return { resolved: false, reason: 'targetFiles must be a non-empty array of file paths' };
  }
  const invalidIndex = targetFiles.findIndex((file) => typeof file !== 'string' || file.trim() === '');
  if (invalidIndex !== -1) {
    return { resolved: false, reason: `targetFiles[${invalidIndex}] must be a non-empty string` };
  }

  const gitExec = opts.gitExec || defaultGitExec;

  const candidates = targetFiles
    .map((file) => resolveAuthorForFile(gitExec, file))
    .filter((candidate) => candidate !== null);

  if (candidates.length === 0) {
    return {
      resolved: false,
      reason: `Could not resolve a commit author for any of: ${targetFiles.join(', ')}`,
    };
  }

  // Deterministic tie-break: the author of the single most recent commit
  // across all target files wins (see module header — not full blame).
  const winner = candidates.reduce((latest, candidate) =>
    candidate.timestamp > latest.timestamp ? candidate : latest
  );

  return { resolved: true, name: winner.name, email: winner.email, file: winner.file };
}

const REFINE_CYCLE_SUGGESTION =
  'Suggested resolution: run `refine-trd` to update the TRD so this gap is captured as a task, ' +
  'then `implement-trd-tasks` to implement the fix (a `refine-trd` -> `implement-trd-tasks` cycle).';

/** Deterministic Task title for a confirmed AC gap. */
function buildGapTaskTitle(acId, reqId) {
  return `AC Gap: ${acId} (${reqId})`;
}

/** Deterministic Task description — must describe the gap AND suggest the refine-trd cycle (AC-010-1). */
function buildGapTaskDescription(acId, reqId, gapReason) {
  return [
    `Playwright test authoring for ${acId} (${reqId}) found a confirmed implementation gap:`,
    '',
    gapReason.trim(),
    '',
    REFINE_CYCLE_SUGGESTION,
  ].join('\n');
}

/**
 * Validate `author` — must be exactly the shape `resolveImplementingAuthor`
 * returns (this module's concern #2 consumes concern #1's output as-is;
 * see module header). Pushes errors into `errors` (mutates); returns
 * nothing.
 */
function validateAuthor(author, errors) {
  if (!author || typeof author !== 'object') {
    errors.push('author must be the object returned by resolveImplementingAuthor');
    return;
  }
  if (author.resolved === true) {
    if (!isNonEmptyString(author.name)) errors.push('author.name must be a non-empty string when resolved');
    if (!isNonEmptyString(author.email)) errors.push('author.email must be a non-empty string when resolved');
  } else if (author.resolved === false) {
    if (!isNonEmptyString(author.reason)) errors.push('author.reason must be a non-empty string when unresolved');
  } else {
    errors.push('author.resolved must be exactly true or false');
  }
}

/** Shape the Task's assignedTo field from a validated `author`. */
function buildAssignedTo(author) {
  if (author.resolved === true) {
    return { resolved: true, name: author.name, email: author.email };
  }
  return {
    resolved: false,
    note: `Unassigned — could not resolve the implementing commit author (${author.reason})`,
  };
}

/**
 * Shape a request to file ONE new ADO Task for ONE confirmed AC gap
 * (AC-010-1). Deliberately has no `gaps: []`/batching input — see module
 * header's AC-010-2 note. Call once per confirmed gap.
 *
 * @param {object} input
 * @param {string} input.acId - e.g. "AC-009-1"
 * @param {string} input.reqId - e.g. "REQ-009"
 * @param {string} input.gapReason - the confirmed gap's plain-text reason
 *   (e.g. from ac-gap-detector.js's `flagAcGap` / a 'confirmed' `resolveGapReview`)
 * @param {string|number} input.storyWorkItemId - the PRD-referenced User Story's ADO id
 * @param {{resolved: true, name: string, email: string}|{resolved: false, reason: string}} input.author
 *   - exactly the shape returned by `resolveImplementingAuthor`
 * @returns {{title: string, description: string,
 *            assignedTo: {resolved: true, name: string, email: string}|{resolved: false, note: string},
 *            parentWorkItemId: string, acId: string, reqId: string}}
 * @throws {Error} listing every missing/invalid field, when input is invalid
 */
function planGapTaskFiling(input) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return assertNoErrors('planGapTaskFiling input', ['input must be an object']);
  }

  if (!isNonEmptyString(input.acId)) errors.push('acId must be a non-empty string');
  if (!isNonEmptyString(input.reqId)) errors.push('reqId must be a non-empty string');
  if (!isNonEmptyString(input.gapReason)) errors.push('gapReason must be a non-empty string');
  if (!isNonEmptyStringOrNumber(input.storyWorkItemId)) {
    errors.push('storyWorkItemId must be a non-empty string or number');
  }
  validateAuthor(input.author, errors);

  assertNoErrors('planGapTaskFiling input', errors);

  const acId = input.acId.trim();
  const reqId = input.reqId.trim();

  return {
    title: buildGapTaskTitle(acId, reqId),
    description: buildGapTaskDescription(acId, reqId, input.gapReason),
    assignedTo: buildAssignedTo(input.author),
    parentWorkItemId: String(input.storyWorkItemId).trim(),
    acId,
    reqId,
  };
}

/**
 * Validate/normalize the MCP tool's response after the orchestrator actually
 * filed the Task (and linked it under `parentWorkItemId`, e.g. via a
 * `wit_create_work_item` + `wit_add_child_work_items`-equivalent call pair).
 *
 * @param {{title: string, parentWorkItemId: string, acId: string, reqId: string}} decision
 *   - the decision this module previously returned from planGapTaskFiling
 * @param {{id: string|number, title?: string}} mcpResponse - the MCP tool's response
 * @returns {{taskWorkItemId: string, title: string, parentWorkItemId: string, acId: string, reqId: string}}
 * @throws {Error} if `decision` isn't a decision from planGapTaskFiling, or `mcpResponse` lacks a usable id
 */
function recordFiledGapTask(decision, mcpResponse) {
  if (
    !decision ||
    typeof decision !== 'object' ||
    !isNonEmptyString(decision.title) ||
    !isNonEmptyStringOrNumber(decision.parentWorkItemId) ||
    !isNonEmptyString(decision.acId) ||
    !isNonEmptyString(decision.reqId)
  ) {
    throw new Error('recordFiledGapTask requires the decision returned by planGapTaskFiling');
  }

  const errors = [];
  if (!mcpResponse || typeof mcpResponse !== 'object') {
    errors.push('mcpResponse must be an object');
  } else if (!isNonEmptyStringOrNumber(mcpResponse.id)) {
    errors.push('mcpResponse.id must be a non-empty string or number');
  } else if (mcpResponse.title !== undefined && typeof mcpResponse.title !== 'string') {
    errors.push('mcpResponse.title must be a string when present');
  }
  assertNoErrors('mcpResponse', errors);

  return {
    taskWorkItemId: String(mcpResponse.id).trim(),
    title: (mcpResponse.title && mcpResponse.title.trim()) || decision.title,
    parentWorkItemId: String(decision.parentWorkItemId).trim(),
    acId: decision.acId,
    reqId: decision.reqId,
  };
}

module.exports = {
  resolveImplementingAuthor,
  planGapTaskFiling,
  recordFiledGapTask,
  buildGapTaskTitle,
  buildGapTaskDescription,
};

// ponytail self-check: `node packages/e2e-testing/lib/ac-gap-task-filer.js`
// exercises resolveImplementingAuthor's git-tie-break/never-throw contract,
// planGapTaskFiling's shaping/validation, AC-010-2's "always one gap in, one
// Task out" shape, and recordFiledGapTask's normalization — TRD-021-TEST is
// a separate, later task providing full coverage, so this is interim.
if (require.main === module) {
  const assert = require('assert');

  // --- resolveImplementingAuthor: single file, resolved ---
  const singleFileGit = (args) => {
    assert.deepStrictEqual(args, ['log', '-1', '--format=%an|%ae|%at', '--', 'src/a.js']);
    return 'Ada Lovelace|ada@example.com|1000\n';
  };
  assert.deepStrictEqual(resolveImplementingAuthor(['src/a.js'], { gitExec: singleFileGit }), {
    resolved: true,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    file: 'src/a.js',
  });

  // --- resolveImplementingAuthor: multiple files, different authors -> most-recent-commit wins ---
  const multiFileGit = (args) => {
    const file = args[args.length - 1];
    if (file === 'src/old.js') return 'Old Author|old@example.com|500\n';
    if (file === 'src/new.js') return 'New Author|new@example.com|9999\n';
    throw new Error(`unexpected file: ${file}`);
  };
  assert.deepStrictEqual(
    resolveImplementingAuthor(['src/old.js', 'src/new.js'], { gitExec: multiFileGit }),
    { resolved: true, name: 'New Author', email: 'new@example.com', file: 'src/new.js' }
  );

  // --- resolveImplementingAuthor: git fails for every file -> resolved:false, never throws ---
  const alwaysFailGit = () => {
    throw new Error('fatal: no such path in HEAD');
  };
  const unresolved = resolveImplementingAuthor(['src/gone.js'], { gitExec: alwaysFailGit });
  assert.strictEqual(unresolved.resolved, false);
  assert.match(unresolved.reason, /Could not resolve a commit author/);

  // --- resolveImplementingAuthor: bad input -> resolved:false (never throws), degraded path ---
  assert.strictEqual(resolveImplementingAuthor([]).resolved, false);
  assert.strictEqual(resolveImplementingAuthor(null).resolved, false);
  assert.strictEqual(resolveImplementingAuthor(['ok', '']).resolved, false);

  // --- planGapTaskFiling: resolved author -> full shape, description carries AC-010-1's exact suggestion ---
  const resolvedAuthor = { resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' };
  const filed = planGapTaskFiling({
    acId: 'AC-009-1',
    reqId: 'REQ-009',
    gapReason: 'handler is a 501 stub; described validation logic does not exist yet',
    storyWorkItemId: 4821,
    author: resolvedAuthor,
  });
  assert.deepStrictEqual(filed, {
    title: 'AC Gap: AC-009-1 (REQ-009)',
    description:
      'Playwright test authoring for AC-009-1 (REQ-009) found a confirmed implementation gap:\n\n' +
      'handler is a 501 stub; described validation logic does not exist yet\n\n' +
      REFINE_CYCLE_SUGGESTION,
    assignedTo: { resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' },
    parentWorkItemId: '4821',
    acId: 'AC-009-1',
    reqId: 'REQ-009',
  });
  assert.match(filed.description, /refine-trd/);
  assert.match(filed.description, /implement-trd-tasks/);

  // --- planGapTaskFiling: unresolved author -> explicit unassigned note, not silently dropped ---
  const unresolvedAuthor = { resolved: false, reason: 'no commit history for src/gone.js' };
  const filedUnassigned = planGapTaskFiling({
    acId: 'AC-009-2',
    reqId: 'REQ-009',
    gapReason: 'another gap',
    storyWorkItemId: '4821',
    author: unresolvedAuthor,
  });
  assert.deepStrictEqual(filedUnassigned.assignedTo, {
    resolved: false,
    note: 'Unassigned — could not resolve the implementing commit author (no commit history for src/gone.js)',
  });

  // --- AC-010-2: two confirmed gaps in one session -> two independent decisions, never bundled ---
  const secondFiled = planGapTaskFiling({
    acId: 'AC-011-1',
    reqId: 'REQ-011',
    gapReason: 'a second, unrelated gap',
    storyWorkItemId: 4821,
    author: resolvedAuthor,
  });
  assert.notStrictEqual(filed.acId, secondFiled.acId);
  assert.notStrictEqual(filed.title, secondFiled.title);
  // no batching parameter exists at all — planGapTaskFiling's arity below proves
  // it only ever accepts a single input object describing one gap.
  assert.strictEqual(planGapTaskFiling.length, 1);

  // --- planGapTaskFiling: invalid inputs collect every error, never a silent default ---
  assert.throws(() => planGapTaskFiling({}), /acId.*reqId.*gapReason.*storyWorkItemId.*author/s);
  assert.throws(
    () =>
      planGapTaskFiling({
        acId: 'A',
        reqId: 'B',
        gapReason: 'x',
        storyWorkItemId: 1,
        author: { resolved: true, name: '', email: 'x@example.com' },
      }),
    /author\.name must be a non-empty string when resolved/
  );
  assert.throws(
    () =>
      planGapTaskFiling({
        acId: 'A',
        reqId: 'B',
        gapReason: 'x',
        storyWorkItemId: 1,
        author: { resolved: 'maybe' },
      }),
    /author\.resolved must be exactly true or false/
  );

  // --- recordFiledGapTask: normalizes a valid MCP response ---
  assert.deepStrictEqual(recordFiledGapTask(filed, { id: 777, title: 'AC Gap: AC-009-1 (REQ-009)' }), {
    taskWorkItemId: '777',
    title: 'AC Gap: AC-009-1 (REQ-009)',
    parentWorkItemId: '4821',
    acId: 'AC-009-1',
    reqId: 'REQ-009',
  });

  // falls back to the decision's title if the MCP response omits title
  assert.deepStrictEqual(recordFiledGapTask(filed, { id: 777 }), {
    taskWorkItemId: '777',
    title: filed.title,
    parentWorkItemId: '4821',
    acId: 'AC-009-1',
    reqId: 'REQ-009',
  });

  // rejects a non-decision and a response with no usable id
  assert.throws(() => recordFiledGapTask({}, { id: 1 }), /requires the decision returned by planGapTaskFiling/);
  assert.throws(() => recordFiledGapTask(filed, {}), /mcpResponse\.id must be a non-empty string or number/);
  assert.throws(() => recordFiledGapTask(filed, null), /mcpResponse must be an object/);

  console.log('ac-gap-task-filer.js self-check passed');
}
