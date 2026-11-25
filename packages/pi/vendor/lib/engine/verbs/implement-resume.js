'use strict';

/**
 * TRD-008 (TRD-2026-d571763f): `ensemble implement resume` -- every decision Step 1.4 and Step 1.5
 * of implement-trd-tasks make about WHICH TRD is being built, whether a scaffold for it already
 * exists, and whether it may be built at all right now.
 *
 * The verb only reads: it selects a TRD, validates it, asks the tracker whether an epic for it is
 * open, reads the working tree through the `workflow` adapter and evaluates the staleness gate.
 * It never stashes, commits, checks out or cleans anything to satisfy a gate -- a gate that
 * repairs the thing it is checking is not a gate.
 *
 * Order follows the skill's order, which matters twice: every local check runs before the tracker
 * is called, so a malformed TRD is named without a network round trip; and the tracker read comes
 * before the working-tree check, because whether the tree may be dirty depends on whether this is
 * a resume (`references/phase-1-preflight.md:48-50`).
 */

const fs = require('fs');
const path = require('path');

const MESSAGES = require('../messages');
const { STRATEGIES, loadPolicy } = require('../policy');
const { evaluateStaleness } = require('../staleness');
const { isResult, needsChoice, refused, unavailable } = require('../result');
const { lsFiles } = require('../git');
const { resolveInteractivity } = require('../interactivity');
const { runToolchain, runTrd, toolchainFailure } = require('../cli-json');
const { readWorktree } = require('../worktree');
const { resolveCallerPath } = require('../validate');
const {
  discoverTrds,
  hasMasterTaskList,
  hasTaskLine,
  readFrontmatter,
  slugOf,
  toProjectRelative,
} = require('../trd-source');
const {
  extractDesignReadinessScore,
  getFrontmatterField,
  normalizeLineEndings,
  parseTRD,
} = require('../../trd-parser');
const { hasDotnetProject } = require('../../trd-cli');

const MD_RE = /\.md$/i;

/** The TRD status that makes a document the obvious candidate when nothing was named. */
const IN_PROGRESS = 'In Progress';

/** Where the repository declares its development methodology. */
const CONSTITUTION_FILE = path.join('docs', 'standards', 'constitution.md');

/** The constitution line the methodology is read from. */
const METHODOLOGY_RE = /Development Methodology:?\**\s*(.+)/i;

/** The note a dirty tree gets on a resume, instead of the refusal a fresh run gets. */
const WORKTREE_RESUME_NOTE =
  'NOTE: working directory is dirty; continuing because this is a resume.';

/**
 * Lowercase, non-alphanumerics to `-`, trimmed: the same shape `deriveSlug` produces, so a
 * fragment a maintainer typed can be compared with a slug derived from a filename.
 * @param {string} value
 * @returns {string}
 */
function slugifyFragment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Step 1.4's first decision: which TRD this run is about.
 * @param {object} call the dispatcher's call object
 * @param {boolean} interactive whether a question can be asked
 * @returns {{path: string}|object} the project-relative path, or a tagged engine result
 */
function selectTrd(call, interactive) {
  const operand = call.input.trd;

  if (typeof operand === 'string' && MD_RE.test(operand)) {
    const absolute = resolveCallerPath(call.projectRoot, operand);
    let stat;
    try {
      stat = fs.statSync(absolute);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      return refused('TRD_NOT_FOUND', `TRD '${operand}' does not exist`);
    }
    return { path: toProjectRelative(call.projectRoot, absolute) };
  }

  const all = discoverTrds(call.projectRoot);
  const supplied = operand !== undefined && operand !== '';
  const fragment = supplied ? slugifyFragment(operand) : '';
  // A query that carries no word at all names no TRD: choosing the sole in-progress TRD for it
  // would answer a question the caller did not ask.
  if (supplied && fragment === '') {
    return refused(
      'TRD_NOT_FOUND',
      `no TRD in docs/TRD matches '${operand}'; name one as a '.md' path`
    );
  }
  const candidates =
    fragment === ''
      ? all.filter(trd => trd.status === IN_PROGRESS)
      : all.filter(trd => trd.slug.includes(fragment));

  if (candidates.length === 1) return { path: candidates[0].path };

  if (candidates.length === 0) {
    const what =
      fragment === ''
        ? `no TRD in docs/TRD declares status '${IN_PROGRESS}'`
        : `no TRD in docs/TRD matches '${operand}'`;
    return refused('TRD_NOT_FOUND', `${what}; name one as a '.md' path`);
  }

  if (!interactive) {
    return refused(
      'TRD_AMBIGUOUS',
      [`${candidates.length} TRDs match; name one as a '.md' path:`]
        .concat(candidates.map(trd => `  ${trd.path} (${trd.status || 'no status'})`))
        .join('\n')
    );
  }

  return needsChoice({
    flag: null,
    id: 'trd_select',
    options: candidates.map(trd => ({
      args: [trd.path],
      label: `${trd.title} (${trd.status || 'no status'})`,
      value: trd.path,
    })),
    question: 'Which TRD is this run about?',
  });
}

/**
 * Step 1.4's design-readiness bands, with the thresholds from policy rather than from the skill's
 * literal `4.0`/`3.0`, so a repository can move them (Constitution Rule 8).
 * @param {{interactive: boolean, pass: number, score: number|null, warn: number}} input
 * @returns {{askToContinue: boolean, band: string, message: string, score: number|null}|object}
 */
function evaluateReadiness({ interactive, pass, score, warn }) {
  if (score === null) {
    return {
      askToContinue: false,
      band: 'absent',
      message: 'design_readiness_score is absent; continuing',
      score: null,
    };
  }
  if (score >= pass) {
    return {
      askToContinue: false,
      band: 'pass',
      message: `design_readiness_score ${score} is at or above ${pass}`,
      score,
    };
  }
  if (score >= warn) {
    return {
      askToContinue: interactive,
      band: 'warn',
      message: `design_readiness_score ${score} is between ${warn} and ${pass}`,
      score,
    };
  }
  return refused(
    'READINESS_BELOW_WARN',
    `design_readiness_score ${score} is below ${warn}; run /ensemble:refine-trd`
  );
}

/**
 * Step 1.4's traceability gate: `trd-cli validate` must return `ok`.
 * @param {object} call the dispatcher's call object
 * @param {string} trdPath project-relative
 * @returns {{errors: string[], skipped: string[], warnings: string[]}|object}
 */
function validateTraceability(call, trdPath) {
  const result = runTrd(call, ['validate', trdPath]);
  if (!result.json) {
    return unavailable(
      'TRD_VALIDATE_UNREADABLE',
      `trd-cli validate produced no JSON result (exit ${result.exitCode})${
        result.stderr ? `: ${result.stderr.trim()}` : ''
      }`
    );
  }
  // `trd-cli.js` reports a thrown error as a bare `{error}` object, which the skill HALTs on
  // (`references/phase-1-preflight.md:41`) rather than reading as "nothing to report".
  if (typeof result.json.error === 'string') {
    return refused('TRD_VALIDATION_FAILED', result.json.error);
  }

  const errors = Array.isArray(result.json.errors) ? result.json.errors : [];
  const warnings = Array.isArray(result.json.warnings) ? result.json.warnings : [];
  const skipped = Array.isArray(result.json.skipped) ? result.json.skipped : [];

  if (result.json.ok !== true) {
    const lines = [`trd validate refused '${trdPath}':`];
    for (const error of errors) lines.push(`  ${error.message}`);
    if (errors.some(error => error.code === 'ORPHANED_SATISFIES')) {
      lines.push(
        'Fix orphaned [satisfies] annotations in the TRD, or add the requirements to the PRD;',
        'run /ensemble:validate-requirements for details'
      );
    }
    return refused('TRD_VALIDATION_FAILED', lines.join('\n'));
  }

  return {
    errors: errors.map(error => error.message),
    skipped: skipped.map(String),
    warnings: warnings.map(warning => warning.message),
  };
}

/**
 * Step 1.5's resume detection: the tracker's own view of this TRD.
 * @param {object} call the dispatcher's call object
 * @param {string} slug
 * @returns {{closed: number, epicId: string|null, inProgress: number, open: number,
 *   total: number}|object}
 */
function readEpic(call, slug) {
  const result = runToolchain(call, ['run', 'tracker.list']);
  if (!result.json) {
    return unavailable(
      'TRACKER_UNREADABLE',
      `tracker.list produced no JSON result (exit ${result.exitCode})${
        result.stderr ? `: ${result.stderr.trim()}` : ''
      }`
    );
  }
  if (result.json.ok !== true) return toolchainFailure(result.json.error);

  let payload = result.json.data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return unavailable('TRACKER_UNREADABLE', 'tracker.list output is not valid JSON');
    }
  }
  // Every shipped tracker shape: a bare array (older `br`), `{issues}` (`br --json`) or the
  // normalized `{items}` a parsed adapter answers with.
  const issues = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.issues)
      ? payload.issues
      : payload && Array.isArray(payload.items)
        ? payload.items
        : null;
  if (!issues) {
    return unavailable('TRACKER_UNREADABLE', 'tracker.list output has no issue list');
  }

  const epicPrefix = `[trd:${slug}]`;
  const taskPrefix = `[trd:${slug}:task:`;
  const epics = [];
  const counts = { closed: 0, inProgress: 0, open: 0, total: 0 };

  for (const issue of issues) {
    const title = String((issue && issue.title) || '');
    const status = String((issue && issue.status) || '').toLowerCase();
    if (title.startsWith(epicPrefix) && status !== 'closed') {
      const id = String((issue && issue.id) || '').trim();
      // A tracker row with no id is a malformed result, not a scaffold: recording an empty id
      // would let `--execute` proceed on a dirty worktree with no epic behind it.
      if (id !== '') epics.push(id);
    }
    if (title.includes(taskPrefix)) {
      counts.total += 1;
      if (status === 'closed') counts.closed += 1;
      else if (status === 'in_progress') counts.inProgress += 1;
      else counts.open += 1;
    }
  }

  if (epics.length > 1) {
    return refused(
      'MULTIPLE_OPEN_EPICS',
      `${epics.length} open epics are titled '${epicPrefix}': ${epics.join(', ')}; close all but one`
    );
  }

  return { ...counts, epicId: epics.length === 1 ? epics[0] : null };
}

/**
 * The methodology the repository's constitution declares, mapped through policy.
 * @param {string} projectRoot
 * @param {object} table the `constitution_methodology` policy value
 * @returns {string|null} a strategy, or `null` when the constitution says nothing usable
 */
function constitutionStrategy(projectRoot, table) {
  let text;
  try {
    text = fs.readFileSync(path.join(projectRoot, CONSTITUTION_FILE), 'utf8');
  } catch {
    return null;
  }
  for (const line of normalizeLineEndings(text).split('\n')) {
    const match = METHODOLOGY_RE.exec(line);
    if (!match) continue;
    const word = match[1]
      .replace(/\*/g, '')
      .trim()
      .split(/[\s—–-]+/)[0]
      .toLowerCase();
    const mapped = table[word];
    if (typeof mapped === 'string') return mapped;
  }
  return null;
}

/**
 * The strategy the TRD's own words suggest, through the policy detection table.
 * @param {{summary: string, title: string}} parsed
 * @param {object} table the `strategy_detection` policy value
 * @returns {string|null}
 */
function detectStrategy(parsed, table) {
  const haystack = `${parsed.title || ''}\n${parsed.summary || ''}`.toLowerCase();
  for (const keyword of Object.keys(table)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(haystack)) return table[keyword];
  }
  return null;
}

/**
 * Step 1.5's strategy precedence, in order.
 * @param {{frontmatter: object|null, parsed: object, policy: object, projectRoot: string,
 *   strategyArgument: string|undefined, warnings: string[]}} input
 * @returns {{source: string, strategy: string}}
 */
function resolveStrategy({
  frontmatter,
  parsed,
  policy,
  projectRoot,
  strategyArgument,
  warnings,
}) {
  if (strategyArgument !== undefined) return { source: 'argument', strategy: strategyArgument };

  const declared = getFrontmatterField(frontmatter, 'strategy');
  if (declared != null) {
    const value = String(declared).trim();
    if (STRATEGIES.includes(value)) return { source: 'trd', strategy: value };
    warnings.push(
      `TRD frontmatter 'strategy' is not one of ${STRATEGIES.join(', ')} ('${value}'); ignored`
    );
  }

  const fromConstitution = constitutionStrategy(projectRoot, policy.constitution_methodology);
  if (fromConstitution !== null) return { source: 'constitution', strategy: fromConstitution };

  const detected = detectStrategy(parsed, policy.strategy_detection);
  if (detected !== null) return { source: 'detection', strategy: detected };

  return { source: 'default', strategy: policy.default_strategy };
}

/**
 * Evaluate the staleness gate against the real files.
 * @param {{call: object, isResume: boolean, thresholdHours: number, trdPath: string}} input
 * @returns {object} the gate's report, or a tagged engine result
 */
function readStaleness({ call, isResume, thresholdHours, trdPath }) {
  if (isResume) {
    return evaluateStaleness({
      files: [],
      isResume: true,
      nowSec: call.now,
      thresholdHours,
      trdMtimeSec: 0,
      trdPath,
    });
  }

  const tracked = lsFiles(call);
  if (isResult(tracked)) return tracked;

  const mtimeOf = relative => {
    try {
      return Math.floor(fs.statSync(path.join(call.projectRoot, relative)).mtimeMs / 1000);
    } catch {
      return null;
    }
  };
  const trdMtimeSec = mtimeOf(trdPath);
  if (trdMtimeSec === null) {
    return unavailable('TRD_MTIME_UNREADABLE', `cannot read the modification time of '${trdPath}'`);
  }

  const files = [];
  for (const relative of tracked) {
    const mtimeSec = mtimeOf(relative);
    if (mtimeSec !== null) files.push({ mtimeSec, path: relative });
  }

  return evaluateStaleness({
    files,
    isResume: false,
    nowSec: call.now,
    thresholdHours,
    trdMtimeSec,
    trdPath,
  });
}

/**
 * @param {object} call the dispatcher's call object
 * @returns {object} the resume, gate and strategy decisions, or a tagged engine result
 */
function handler(call) {
  const { interactive } = resolveInteractivity({ env: call.env, globals: call.globals });
  const policy = loadPolicy({ projectRoot: call.projectRoot }).values;
  const warnings = [];

  const selected = selectTrd(call, interactive);
  if (isResult(selected)) return selected;
  const trdPath = selected.path;
  const absolute = path.join(call.projectRoot, trdPath);

  const text = fs.readFileSync(absolute, 'utf8');
  if (!hasMasterTaskList(text)) {
    return refused(
      'TRD_NO_MASTER_TASK_LIST',
      `TRD '${trdPath}' has no '## Master Task List' heading`
    );
  }
  if (!hasTaskLine(text)) {
    return refused('TRD_NO_TASKS', `TRD '${trdPath}' has no '- [ ] **TRD-...**' task line`);
  }

  const parsed = parseTRD(text);
  const { frontmatter } = readFrontmatter(absolute);
  const slug = slugOf(absolute);

  const declaredScore = extractDesignReadinessScore(frontmatter);
  const readiness = evaluateReadiness({
    interactive,
    pass: policy.design_readiness_pass,
    score:
      declaredScore !== null && declaredScore !== undefined
        ? declaredScore
        : (parsed.designReadinessScore ?? null),
    warn: policy.design_readiness_warn,
  });
  if (isResult(readiness)) return readiness;
  if (readiness.band === 'absent') warnings.push(readiness.message);

  const validation = validateTraceability(call, trdPath);
  if (isResult(validation)) return validation;

  const bdd = require('../../bdd-mode').resolveBdd({
    env: call.env,
    repo: { dotnet: hasDotnetProject(call.projectRoot) },
    trdPath: absolute,
  });

  const epic = readEpic(call, slug);
  if (isResult(epic)) return epic;
  const isResume = epic.epicId !== null;

  if (call.input.execute === true && !isResume) {
    return refused('EXECUTE_NEEDS_SCAFFOLD', MESSAGES.EXECUTE_NEEDS_SCAFFOLD);
  }

  const worktree = readWorktree(call);
  if (isResult(worktree)) return worktree;
  if (worktree.dirty && !isResume) {
    return refused('WORKTREE_DIRTY', MESSAGES.WORKTREE_DIRTY, {
      WORKTREE_STATUS: worktree.files,
    });
  }

  const staleness = readStaleness({
    call,
    isResume,
    thresholdHours: policy.staleness_hours,
    trdPath,
  });
  if (isResult(staleness)) return staleness;
  if (staleness.stale) {
    return refused('TRD_STALE', staleness.message, {
      AGE_HOURS: staleness.ageHours,
      NEWER_COUNT: staleness.newerCount,
      STALE_AGE: staleness.staleAge,
      STALE_DRIFT: staleness.staleDrift,
    });
  }

  const strategy = resolveStrategy({
    frontmatter,
    parsed,
    policy,
    projectRoot: call.projectRoot,
    strategyArgument: call.input.strategy,
    warnings,
  });

  return {
    BDD_MODE: { enabled: bdd.enabled, message: bdd.message, source: bdd.source },
    CLOSED_TASKS: epic.closed,
    DESIGN_READINESS: readiness,
    IN_PROGRESS_TASKS: epic.inProgress,
    IS_RESUME: isResume,
    OPEN_TASKS: epic.open,
    ROOT_EPIC_ID: epic.epicId,
    STALENESS: staleness,
    STRATEGY: strategy.strategy,
    STRATEGY_SOURCE: strategy.source,
    TOTAL_TASKS: epic.total,
    TRD_FILE_PATH: trdPath,
    TRD_LABEL: slug,
    TRD_SLUG: slug,
    VALIDATION: validation,
    WARNINGS: warnings,
    WORKTREE_DIRTY: worktree.dirty,
    WORKTREE_NOTE: worktree.dirty && isResume ? WORKTREE_RESUME_NOTE : null,
  };
}

const spec = {
  // Nothing is written: the tracker is listed, the TRD is validated and the tree is read.
  exitCodes: [0, 1, 2, 4, 5],
  group: 'implement',
  handler,
  inputSchema: {
    additionalProperties: false,
    properties: {
      execute: { type: 'boolean' },
      strategy: { enum: [...STRATEGIES], type: 'string' },
      trd: { type: 'string', 'x-operand': true },
    },
    type: 'object',
  },
  name: 'resume',
  outputSchema: {
    additionalProperties: false,
    properties: {
      BDD_MODE: {
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          message: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['enabled', 'message', 'source'],
        type: 'object',
      },
      CHOICE: {
        additionalProperties: false,
        properties: {
          flag: { type: ['string', 'null'] },
          id: { type: 'string' },
          options: {
            items: {
              additionalProperties: false,
              properties: {
                args: { items: { type: 'string' }, type: 'array' },
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['args', 'label', 'value'],
              type: 'object',
            },
            type: 'array',
          },
          question: { type: 'string' },
        },
        required: ['flag', 'id', 'options', 'question'],
        type: 'object',
      },
      CLOSED_TASKS: { minimum: 0, type: 'integer' },
      DESIGN_READINESS: {
        additionalProperties: false,
        properties: {
          askToContinue: { type: 'boolean' },
          band: { enum: ['absent', 'pass', 'warn'], type: 'string' },
          message: { type: 'string' },
          score: { type: ['number', 'null'] },
        },
        required: ['askToContinue', 'band', 'message', 'score'],
        type: 'object',
      },
      IN_PROGRESS_TASKS: { minimum: 0, type: 'integer' },
      IS_RESUME: { type: 'boolean' },
      OPEN_TASKS: { minimum: 0, type: 'integer' },
      ROOT_EPIC_ID: { type: ['string', 'null'] },
      STALENESS: {
        additionalProperties: false,
        properties: {
          ageHours: { type: ['integer', 'null'] },
          checked: { type: 'boolean' },
          message: { type: 'string' },
          more: { minimum: 0, type: 'integer' },
          newer: { items: { type: 'string' }, type: 'array' },
          newerCount: { minimum: 0, type: 'integer' },
          stale: { type: 'boolean' },
          staleAge: { type: 'boolean' },
          staleDrift: { type: 'boolean' },
        },
        required: [
          'ageHours',
          'checked',
          'message',
          'more',
          'newer',
          'newerCount',
          'stale',
          'staleAge',
          'staleDrift',
        ],
        type: 'object',
      },
      STRATEGY: { enum: [...STRATEGIES], type: 'string' },
      STRATEGY_SOURCE: {
        enum: ['argument', 'constitution', 'default', 'detection', 'trd'],
        type: 'string',
      },
      TOTAL_TASKS: { minimum: 0, type: 'integer' },
      TRD_FILE_PATH: { type: 'string' },
      TRD_LABEL: { type: 'string' },
      TRD_SLUG: { type: 'string' },
      VALIDATION: {
        additionalProperties: false,
        properties: {
          errors: { items: { type: 'string' }, type: 'array' },
          skipped: { items: { type: 'string' }, type: 'array' },
          warnings: { items: { type: 'string' }, type: 'array' },
        },
        required: ['errors', 'skipped', 'warnings'],
        type: 'object',
      },
      WARNINGS: { items: { type: 'string' }, type: 'array' },
      WORKTREE_DIRTY: { type: 'boolean' },
      WORKTREE_NOTE: { type: ['string', 'null'] },
    },
    type: 'object',
  },
  policyKeys: [
    'constitution_methodology',
    'default_strategy',
    'design_readiness_pass',
    'design_readiness_warn',
    'staleness_hours',
    'strategy_detection',
  ],
  sideEffect: 'read',
  summary: 'report whether a scaffold for a TRD already exists, and the gates a build must pass',
};

module.exports = { spec };
