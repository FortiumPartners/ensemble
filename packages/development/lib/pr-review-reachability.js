'use strict';

/**
 * The cross-runtime reachability and no-new-secrets proof (REQ-023, REQ-024,
 * AC-023-1, AC-023-2, AC-023-3, AC-024-2).
 *
 * NO side effects, NO shell, NO network calls, NO file reads. This module
 * GRADES evidence the caller collected; it never collects it. The repository
 * proof that feeds it real artifacts lives in the tests and in the
 * `reachability` subcommand of `pr-review-cli.js`, following the 82b6a138
 * precedent that every graded fact is a pure JSON-in/JSON-out module.
 *
 * WHY THIS EXISTS. Every other module in this TRD can pass its own unit tests
 * while nothing calls it. AC-023-1 is the rule against exactly that: a
 * capability counts as reachable only when a chain holds end to end --
 *
 *     entry command TEXT -> skill -> CLI subcommand registered in HANDLERS
 *
 * -- so the proof is made THROUGH the entry point, never around it. Break any
 * one link and the capability is unreachable, however green its own tests are.
 *
 * The capabilities are the behaviours AC-023-1 names (plus `mode`, the review-run mode), mapped to the
 * subcommands that implement them in the TRD's data flow (architecture, line
 * "SKILL.md --> pr-review-cli.js depth | slices | ledger | status"):
 *
 *   verified-findings  `votes` + `verify-assign`   -- findings are voted on, by
 *                                                     the verifiers assigned to
 *                                                     each, before the author answers
 *   convergence        `status` + `ledger` + `scope` -- the shared round cap,
 *                                                     repeat suppression and
 *                                                     the delta re-review range
 *   tier               `tier`                      -- change-driven risk tier
 *   mode               `mode`                      -- light or full review-run
 *                                                     mode, from the tier
 *
 * Convergence needs ALL THREE of its subcommands: a round cap with no repeat
 * suppression still loops on the same finding, and neither converges without
 * the delta range. Partial evidence is reported as unreachable with the
 * missing piece named, never rounded up to "reached".
 *
 * FAIL CLOSED means, here, that no refusal is ever readable as a pass:
 * an unreadable request reports `ok:false` with a reason and an EMPTY
 * reached/equivalent/leak-free result. "We could not tell" is never "all
 * clear" -- the one failure mode that would make this whole proof worthless.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-037
 */

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * The behaviours AC-023-1 requires, and the CLI subcommands that carry each.
 * A capability is reached only when EVERY subcommand listed for it is reached.
 */
const CAPABILITIES = Object.freeze({
  'verified-findings': Object.freeze(['votes', 'verify-assign']),
  convergence: Object.freeze(['status', 'ledger', 'scope']),
  tier: Object.freeze(['tier']),
  mode: Object.freeze(['mode']),
});

/** The four runtimes REQ-006/AC-023-2 requires equivalence (or a stated reduction) across. */
const RUNTIMES = Object.freeze(['claude', 'pi', 'codex', 'opencode']);

/** The CLI whose direct use by an entry point is a boundary violation. */
const CLI_BASENAME = 'pr-review-cli.js';

// ---------------------------------------------------------------------------
// AC-023-1: entry text -> skill -> CLI subcommand
// ---------------------------------------------------------------------------

function traceFailure(reason) {
  return { ok: false, reason, entryPoints: [], reached: [], unreachable: [], capabilities: [] };
}

/** `text` mentions the skill: by its declared path, or by its id as a word. */
function entryReachesSkill(text, skill) {
  if (text.includes(skill.path)) return true;
  const id = skill.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9-])${id}([^a-z0-9-]|$)`, 'i').test(text);
}

/**
 * The subcommands a skill text actually invokes.
 *
 * Only the real invocation shape counts -- `node "$PR_REVIEW_CLI" <sub>` or
 * `node .../pr-review-cli.js <sub>`. Prose that merely NAMES a subcommand
 * ("the votes result") is not a call and must not prove reachability, which
 * is the difference between a traced chain and a plausible story.
 */
function subcommandsInvokedBy(text) {
  const found = new Set();
  const pattern = new RegExp(
    `(?:\\$(?:\\{)?PR_REVIEW_CLI(?:\\})?|${CLI_BASENAME.replace('.', '\\.')})["'\`]?\\s+([a-z][a-z0-9-]*)`,
    'gi'
  );
  let match = pattern.exec(text);
  while (match !== null) {
    found.add(match[1].toLowerCase());
    match = pattern.exec(text);
  }
  return found;
}

/**
 * Traces every entry point to the capabilities it can actually reach
 * (AC-023-1).
 *
 * @param {{entryPoints: Array<{id:string, text:string}>,
 *          skills: Array<{id:string, path:string, text:string}>,
 *          subcommands: string[],
 *          capabilities?: Object<string,string[]>}} input
 *   `subcommands` is the list the CLI really registers (its HANDLERS keys):
 *   a subcommand a skill asks for but the CLI does not expose would fail at
 *   run time, so it never counts as reached.
 * @returns {{ok:boolean, entryPoints:Array, reached:string[], unreachable:string[], reason?:string}}
 */
function traceCapabilities(input) {
  if (!isObject(input)) return traceFailure('invalid-input');

  const { entryPoints, skills, subcommands } = input;
  if (!Array.isArray(entryPoints) || !entryPoints.every(isObject)) return traceFailure('entryPoints must be an array of objects');
  if (!Array.isArray(skills) || !skills.every(isObject)) return traceFailure('skills must be an array of objects');
  if (!Array.isArray(subcommands) || !subcommands.every(isText)) return traceFailure('subcommands must be an array of non-empty strings');
  if (entryPoints.length === 0) return traceFailure('no-entry-points');

  for (const entry of entryPoints) {
    if (!isText(entry.id) || typeof entry.text !== 'string') return traceFailure('each entry point needs an id and text');
  }
  for (const skill of skills) {
    if (!isText(skill.id) || !isText(skill.path) || typeof skill.text !== 'string') {
      return traceFailure('each skill needs an id, a path and text');
    }
  }

  const map = input.capabilities === undefined ? CAPABILITIES : input.capabilities;
  if (!isObject(map)) return traceFailure('capabilities must be an object');
  const names = Object.keys(map);
  for (const name of names) {
    if (!Array.isArray(map[name]) || !map[name].every(isText)) return traceFailure(`capability ${name} must list subcommands`);
  }
  if (names.length === 0) return traceFailure('no-capabilities-requested');

  const registered = new Set(subcommands.map((name) => name.trim().toLowerCase()));

  const traced = entryPoints.map((entry) => {
    const text = entry.text;

    // Link 1: which skills this entry point actually invokes.
    const reachedSkills = skills.filter((skill) => entryReachesSkill(text, skill));

    // A boundary violation worth naming: the entry point reaching PAST the
    // skill straight into the CLI. It is reported, and it proves nothing.
    const directCliReferences = [...subcommandsInvokedBy(text)].filter((name) => registered.has(name)).sort();

    // Link 2: which subcommands those skills invoke, and through which skill.
    const carriers = new Map();
    for (const skill of reachedSkills) {
      for (const name of subcommandsInvokedBy(skill.text)) {
        if (!carriers.has(name)) carriers.set(name, skill.id);
      }
    }

    const capabilities = names.map((capability) => {
      const required = map[capability];
      const via = [];
      const missing = [];
      const unregistered = [];
      // A capability that maps to no subcommand is reached through nothing.
      if (required.length === 0) missing.push('no-subcommands-mapped');
      for (const name of required) {
        const key = name.trim().toLowerCase();
        // Link 3: the CLI must really register it.
        if (!registered.has(key)) {
          unregistered.push(key);
          continue;
        }
        if (!carriers.has(key)) {
          missing.push(key);
          continue;
        }
        via.push({ skill: carriers.get(key), subcommand: key });
      }
      return {
        capability,
        reached: required.length > 0 && missing.length === 0 && unregistered.length === 0,
        via,
        missing,
        unregistered,
      };
    });

    const reached = capabilities.filter((entryItem) => entryItem.reached).map((entryItem) => entryItem.capability);
    const unreachable = capabilities.filter((entryItem) => !entryItem.reached).map((entryItem) => entryItem.capability);

    const record = {
      id: entry.id,
      skills: reachedSkills.map((skill) => skill.id),
      directCliReferences,
      capabilities,
      reached,
      unreachable,
    };
    if (reachedSkills.length === 0) record.reason = 'entry-point-reaches-no-skill';
    return record;
  });

  const unreachable = [...new Set(traced.flatMap((entry) => entry.unreachable))].sort();
  const reached = [...new Set(traced.flatMap((entry) => entry.reached))].sort();

  return { ok: unreachable.length === 0, entryPoints: traced, reached, unreachable };
}

// ---------------------------------------------------------------------------
// AC-023-2: equivalent on every runtime, or the reduction is stated
// ---------------------------------------------------------------------------

function compareFailure(reason) {
  return { ok: false, reason, equivalent: false, report: [], reductions: [] };
}

const textList = (values) => values.join(', ');

/**
 * Compares the generated artifacts of each runtime against the baseline
 * (AC-023-2).
 *
 * Equivalence is one-directional on purpose: a runtime must carry everything
 * the baseline carries, but carrying MORE is not a reduction. Anything it
 * lacks is stated as a sentence a person can read, because "the report states
 * what is reduced" is the AC's own escape hatch and a boolean cannot satisfy it.
 *
 * @param {{runtimes: Object<string,{procedures:string[], subcommands:string[]}>,
 *          baseline?: string, expected?: string[]}} input
 * @returns {{ok:boolean, equivalent:boolean, report:Array, reductions:Array, reason?:string}}
 */
function compareRuntimes(input) {
  if (!isObject(input)) return compareFailure('invalid-input');
  const { runtimes } = input;
  if (!isObject(runtimes)) return compareFailure('runtimes must be an object keyed by runtime');

  const expected = input.expected === undefined ? RUNTIMES : input.expected;
  if (!Array.isArray(expected) || !expected.every(isText)) return compareFailure('expected must be an array of runtime names');

  const baseline = input.baseline === undefined ? expected[0] : input.baseline;
  if (!isText(baseline)) return compareFailure('baseline must be a runtime name');
  if (!hasOwn(runtimes, baseline)) return compareFailure(`baseline runtime ${baseline} is absent`);

  const readRuntime = (value) => {
    if (!isObject(value)) return null;
    const procedures = value.procedures === undefined ? [] : value.procedures;
    const subcommands = value.subcommands === undefined ? [] : value.subcommands;
    if (!Array.isArray(procedures) || !procedures.every(isText)) return null;
    if (!Array.isArray(subcommands) || !subcommands.every(isText)) return null;
    return {
      procedures: [...new Set(procedures.map((name) => name.trim()))],
      subcommands: [...new Set(subcommands.map((name) => name.trim().toLowerCase()))],
    };
  };

  const base = readRuntime(runtimes[baseline]);
  if (base === null) return compareFailure(`baseline runtime ${baseline} is unreadable`);
  if (base.procedures.length === 0 && base.subcommands.length === 0) return compareFailure('baseline-declares-nothing');
  if (expected.length === 0) return compareFailure('no-runtimes-expected');

  const report = [];
  for (const name of expected) {
    if (!hasOwn(runtimes, name)) {
      report.push({
        runtime: name,
        present: false,
        equivalent: false,
        missingProcedures: base.procedures.slice(),
        missingSubcommands: base.subcommands.slice(),
        extraProcedures: [],
        extraSubcommands: [],
        reduction: `${name}: not installed -- every procedure and subcommand of the ${baseline} baseline is absent`,
      });
      continue;
    }

    const current = readRuntime(runtimes[name]);
    if (current === null) return compareFailure(`runtime ${name} is unreadable`);

    const missingProcedures = base.procedures.filter((item) => !current.procedures.includes(item));
    const missingSubcommands = base.subcommands.filter((item) => !current.subcommands.includes(item));
    const extraProcedures = current.procedures.filter((item) => !base.procedures.includes(item));
    const extraSubcommands = current.subcommands.filter((item) => !base.subcommands.includes(item));
    const equivalent = missingProcedures.length === 0 && missingSubcommands.length === 0;

    const record = {
      runtime: name,
      present: true,
      equivalent,
      missingProcedures,
      missingSubcommands,
      extraProcedures,
      extraSubcommands,
    };
    if (!equivalent) {
      const parts = [];
      if (missingProcedures.length > 0) parts.push(`procedures ${textList(missingProcedures)}`);
      if (missingSubcommands.length > 0) parts.push(`subcommands ${textList(missingSubcommands)}`);
      record.reduction = `${name}: reduced against the ${baseline} baseline -- missing ${parts.join('; ')}`;
    }
    report.push(record);
  }

  const reductions = report.filter((entry) => !entry.equivalent).map((entry) => entry.reduction);
  return { ok: true, equivalent: reductions.length === 0, report, reductions };
}

// ---------------------------------------------------------------------------
// AC-023-3 and AC-024-2: no new CI secret, no reproduced credential
// ---------------------------------------------------------------------------

function hygieneFailure(reason) {
  return {
    ok: false,
    reason,
    newSecrets: [],
    leaks: [],
    libsChecked: [],
    inAgentReviewRuns: false,
    notes: [],
  };
}

/**
 * Every secret a workflow text references: `secrets.NAME`, `secrets['NAME']`,
 * `secrets["NAME"]`, and any use of the WHOLE object (`toJSON(secrets)`, a
 * bare `secrets`, `secrets[dynamic]`, `secrets: inherit`), which is reported
 * as the wildcard `*` -- it exposes every secret and is never in an allow-list.
 */
function secretsReferencedIn(text) {
  const found = new Set();
  const dotted = /(?<![\w.])secrets\.([A-Za-z_][A-Za-z0-9_]*)/gi;
  const bracketed = /(?<![\w.])secrets\s*\[\s*(?:'([^']+)'|"([^"]+)")\s*\]/gi;
  let match = dotted.exec(text);
  while (match !== null) {
    found.add(match[1]);
    match = dotted.exec(text);
  }
  match = bracketed.exec(text);
  while (match !== null) {
    found.add(match[1] !== undefined ? match[1] : match[2]);
    match = bracketed.exec(text);
  }

  // Whole-object use: what is left of an expression once the named
  // references are removed must not mention `secrets` at all.
  const expressions = /\$\{\{([\s\S]*?)\}\}/g;
  let expression = expressions.exec(text);
  while (expression !== null) {
    const rest = expression[1].replace(dotted, '').replace(bracketed, '');
    if (/(?<![\w.])secrets(?![\w])/i.test(rest)) found.add('*');
    expression = expressions.exec(text);
  }
  if (/^\s*secrets\s*:\s*inherit\b/im.test(text)) found.add('*');
  return found;
}

/**
 * Every place `secret` survives in `value`, as a dotted path.
 *
 * Keys are searched as well as values: a credential used as an object key
 * leaks just as completely as one used as a string, and JSON.stringify would
 * print both.
 */
function findSecret(value, secret, path, out) {
  if (typeof value === 'string') {
    if (value.includes(secret)) out.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSecret(item, secret, path === '' ? String(index) : `${path}.${index}`, out));
    return;
  }
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      const next = path === '' ? key : `${path}.${key}`;
      if (key.includes(secret)) out.push(next);
      findSecret(value[key], secret, next, out);
    }
  }
}

/**
 * Grades the two secret promises of REQ-023/REQ-024 together, because they
 * fail together: a review that needs a new credential, and a review that
 * reproduces one it was shown.
 *
 * @param {{workflows: Array<{path:string, text:string}>,
 *          allowedSecrets?: string[],
 *          hostedReviewerConfigured?: boolean,
 *          samples?: Array<{lib:string, secret:string, output:*}>}} input
 * @returns {{ok:boolean, newSecrets:Array, leaks:Array, libsChecked:string[],
 *   inAgentReviewRuns:boolean, notes:string[], reason?:string}}
 */
function gradeSecretHygiene(input) {
  if (!isObject(input)) return hygieneFailure('invalid-input');

  const workflows = input.workflows === undefined ? [] : input.workflows;
  if (!Array.isArray(workflows) || !workflows.every(isObject)) return hygieneFailure('workflows must be an array of objects');
  for (const workflow of workflows) {
    if (!isText(workflow.path) || typeof workflow.text !== 'string') return hygieneFailure('each workflow needs a path and text');
  }

  const allowed = input.allowedSecrets === undefined ? [] : input.allowedSecrets;
  if (!Array.isArray(allowed) || !allowed.every(isText)) return hygieneFailure('allowedSecrets must be an array of names');
  const allowedSet = new Set(allowed.map((name) => name.trim()));

  const samples = input.samples === undefined ? [] : input.samples;
  if (!Array.isArray(samples) || !samples.every(isObject)) return hygieneFailure('samples must be an array of objects');
  // Nothing to check is not a clean pass.
  if (workflows.length === 0 && samples.length === 0) return hygieneFailure('nothing-checked');

  const newSecrets = [];
  for (const workflow of workflows) {
    for (const name of secretsReferencedIn(workflow.text)) {
      if (!allowedSet.has(name)) newSecrets.push({ secret: name, path: workflow.path });
    }
  }

  const leaks = [];
  const libsChecked = [];
  for (const sample of samples) {
    if (!isText(sample.lib)) return hygieneFailure('each sample needs a lib name');
    // An empty secret matches nothing, so every output would look redacted:
    // the exact false pass this grader exists to prevent.
    if (!isText(sample.secret)) return hygieneFailure(`sample for ${sample.lib} has no secret to look for`);
    if (!hasOwn(sample, 'output')) return hygieneFailure(`sample for ${sample.lib} has no output`);

    libsChecked.push(sample.lib);
    const where = [];
    findSecret(sample.output, sample.secret, '', where);
    for (const location of where) leaks.push({ lib: sample.lib, where: location });
  }

  const notes = [];
  if (input.hostedReviewerConfigured === false) notes.push('hosted-reviewer-not-configured');

  // The in-agent review runs exactly when it needs no credential it does not
  // already have. A hosted reviewer being absent is a note, never a blocker:
  // that is what AC-023-3 promises.
  const inAgentReviewRuns = newSecrets.length === 0;

  return {
    ok: newSecrets.length === 0 && leaks.length === 0,
    newSecrets,
    leaks,
    libsChecked,
    inAgentReviewRuns,
    notes,
  };
}

module.exports = {
  traceCapabilities,
  compareRuntimes,
  gradeSecretHygiene,
  CAPABILITIES,
  RUNTIMES,
};
