'use strict';

/**
 * Findings-as-beads tracker operations (plan docs/plans/pr-review-speedup-plan.md section 3H
 * item 1, kata yfbg): create a bead with labels/priority/dedupe key in one call, find a bead
 * by its dedupe key, append an update, close with a reason and commit.
 *
 * This module is the caller-side half of four OPTIONAL `tracker.*` capabilities
 * (`tracker.create-detailed`, `tracker.find-by-key`, `tracker.update-detailed`,
 * `tracker.close-with-reason`; contract: toolchain/categories/tracker.yaml). It holds the rules
 * a declarative adapter manifest cannot express: exact-match key lookup with a zero/one/many
 * verdict, input validation, and one defined "unavailable" result.
 *
 * Pure by construction: NO shell, NO network and NO file reads here. Every effect goes through
 * the injected `deps.run(capability, args)`, which returns the toolchain runner's envelope
 * (`{ok:true, data}` or `{ok:false, error:{code, message}, unavailable?, fallback?}`). The
 * default `deps` (`createToolchainDeps`) is the only part that touches the toolchain, and it
 * lives in its own function so tests inject a fake or a real manifest.
 *
 * "Unavailable" is a verdict about RESOLUTION, never a guess from a failure: the repository has
 * no usable tracker (no adapter, no initialised workspace, binary not installed) or its adapter
 * does not declare the capability. `deps.run` reports that by RETURNING an envelope with
 * `unavailable: true`. A tool that ran and failed is TOOL_FAILED whatever its message says (the
 * message echoes the finding text), and an exception from `deps.run` is a bug and propagates:
 * neither may read as "no tracker here", because callers skip the beads on unavailable and the
 * findings would silently disappear.
 *
 * Every function RETURNS a result (it throws only for such a bug):
 *   - `{ok:true, ...}` success
 *   - `{ok:false, unavailable:true, fallback:'skip-finding-beads', error:{code:'UNAVAILABLE'}}`
 *     the repository has no usable tracker, or its adapter does not declare the capability
 *     (callers skip the beads and still show the findings list)
 *   - `{ok:false, error:{code, message}}` any other refusal or failure (INVALID_ARG,
 *     AMBIGUOUS_KEY, BAD_OUTPUT, TOOL_FAILED, ...)
 */

const SKIP_FALLBACK = 'skip-finding-beads';
// br accepts only these characters in a label (captured live: VALIDATION_FAILED otherwise). A
// leading '-' is refused: the runner refuses a dash-led value only for the JOINED label list, so
// a later '-x' label would be stored but could never be passed to the runner on its own.
const LABEL_RE = /^[A-Za-z0-9_:][A-Za-z0-9_:-]*$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
// br refuses whitespace anywhere in an external reference (captured live: VALIDATION_FAILED
// `external_ref: cannot contain whitespace`, exit 4). Its notion is Unicode White_Space, which
// differs from JS `\s` at U+0085 (br refuses it) and U+FEFF (br accepts it), so spell it out.
const KEY_WHITESPACE_RE = /[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
// Matches runner.js#lookupCapability's text for an adapter that omits a capability whose
// category contract carries no `fallback` (an older vendored contract): still "unavailable".
// That text is built from the capability and adapter ids only, never from the finding.
const UNDECLARED_RE = /^capability '[^']+' is not declared by adapter '/;
// Adapter id -> directory that must exist under the project root for the tracker to be set up.
const WORKSPACE_MARKERS = { beads: '.beads' };

function failure(code, message, extra) {
  return { ok: false, error: { code, message }, ...extra };
}

function unavailable(message) {
  return {
    ok: false,
    unavailable: true,
    fallback: SKIP_FALLBACK,
    error: { code: 'UNAVAILABLE', message }
  };
}

/** Map a runner envelope to this module's result: structured-unavailable and undeclared both degrade. */
function classify(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return failure('BAD_OUTPUT', 'tracker run returned no envelope');
  }
  if (envelope.ok) return envelope;
  if (envelope.unavailable) return unavailable(envelope.error && envelope.error.message);
  const error = envelope.error || {};
  if (error.code === 'NOT_ALLOWED' && UNDECLARED_RE.test(String(error.message))) {
    return unavailable(error.message);
  }
  return envelope;
}

function call(deps, capability, args) {
  return classify(deps.run(capability, args));
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validKey(key) {
  return nonEmpty(key) && !KEY_WHITESPACE_RE.test(key);
}

function validLabels(labels) {
  return Array.isArray(labels) && labels.length > 0 && labels.every((l) => typeof l === 'string' && LABEL_RE.test(l));
}

function validPriority(priority) {
  const n = typeof priority === 'string' && /^[0-9]+$/.test(priority) ? Number(priority) : priority;
  return Number.isInteger(n) && n >= 0 && n <= 4;
}

/**
 * Create a bead in one call. `key` is stored as the bead's external reference and is what
 * `findByKey` matches on; br refuses a second bead with the same key anywhere in the workspace,
 * so look the key up with `findByKey` first. `labels` should include the label the caller uses
 * to recognise its own beads (`findByKey` is not scoped by it).
 *
 * @param {{run: Function}} deps
 * @param {{title: string, description: string, type?: string, labels: string[], priority: number, key: string}} input
 * @returns {{ok:true, data:{id:string}} | object}
 */
function createFinding(deps, { title, description, type = 'bug', labels, priority, key } = {}) {
  if (!validKey(key)) return failure('INVALID_ARG', "createFinding: 'key' must be a non-empty string without whitespace");
  if (!nonEmpty(title)) return failure('INVALID_ARG', "createFinding: 'title' must be a non-empty string");
  if (typeof description !== 'string') return failure('INVALID_ARG', "createFinding: 'description' must be a string");
  if (!validLabels(labels)) {
    return failure(
      'INVALID_ARG',
      "createFinding: 'labels' must be a non-empty list of [A-Za-z0-9_:-] labels that do not start with '-'"
    );
  }
  if (!validPriority(priority)) return failure('INVALID_ARG', "createFinding: 'priority' must be an integer 0-4");
  return call(deps, 'tracker.create-detailed', {
    title,
    description,
    type,
    labels: labels.join(','),
    priority: String(priority),
    externalKey: key
  });
}

/**
 * Find the bead whose external key is exactly `key` anywhere in the workspace, closed beads
 * included. The lookup is NOT scoped to a label: br enforces external-key uniqueness across the
 * whole workspace, so the bead holding the key may carry any labels (or none), and a label-scoped
 * lookup would miss it while creating the same key is refused. The matched bead's `labels` are
 * returned so the caller can judge whether it is one of its own.
 *
 * @returns {{ok:true, found:true, item:object, labels:string[]} | {ok:true, found:false} |
 *   {ok:false, error:{code:'AMBIGUOUS_KEY', message:string, ids:string[]}} | object}
 *   Several beads sharing one key is refused, never resolved by picking one.
 */
function findByKey(deps, { key } = {}) {
  if (!validKey(key)) return failure('INVALID_ARG', "findByKey: 'key' must be a non-empty string without whitespace");
  const result = call(deps, 'tracker.find-by-key', { key });
  if (!result.ok) return result;

  let parsed = result.data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (_error) {
      return failure('BAD_OUTPUT', 'findByKey: tracker output is not valid JSON');
    }
  }
  // `br list --json` wraps as {issues:[...]}; an older br prints a bare array.
  const items = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.issues) ? parsed.issues : null;
  if (!items) return failure('BAD_OUTPUT', 'findByKey: tracker output has no issue list');

  const matches = items.filter((item) => item && item.external_ref === key);
  if (matches.length === 0) return { ok: true, found: false };
  if (matches.length > 1) {
    const ids = matches.map((item) => item.id);
    return {
      ok: false,
      error: {
        code: 'AMBIGUOUS_KEY',
        message: `findByKey: ${matches.length} beads carry key '${key}' (${ids.join(', ')}); refusing to pick one`,
        ids
      }
    };
  }
  const item = matches[0];
  return { ok: true, found: true, item, labels: Array.isArray(item.labels) ? item.labels.slice() : [] };
}

/** Rewrite title/description/priority and append `note`; labels and status are untouched. */
function updateFinding(deps, { id, title, description, priority, note } = {}) {
  if (!nonEmpty(id)) return failure('INVALID_ARG', "updateFinding: 'id' must be a non-empty string");
  if (!nonEmpty(title)) return failure('INVALID_ARG', "updateFinding: 'title' must be a non-empty string");
  if (typeof description !== 'string') return failure('INVALID_ARG', "updateFinding: 'description' must be a string");
  if (!validPriority(priority)) return failure('INVALID_ARG', "updateFinding: 'priority' must be an integer 0-4");
  if (!nonEmpty(note)) return failure('INVALID_ARG', "updateFinding: 'note' must be a non-empty string");
  return call(deps, 'tracker.update-detailed', { id, title, description, priority: String(priority), notes: note });
}

/** Close a bead. A reason and the resolving commit are both required: no reasonless close. */
function closeFinding(deps, { id, reason, commit } = {}) {
  if (!nonEmpty(id)) return failure('INVALID_ARG', "closeFinding: 'id' must be a non-empty string");
  if (!nonEmpty(reason)) return failure('INVALID_ARG', "closeFinding: a non-empty 'reason' is required");
  if (typeof commit !== 'string' || !COMMIT_RE.test(commit)) {
    return failure('INVALID_ARG', "closeFinding: 'commit' must be a 7-40 character hex SHA");
  }
  return call(deps, 'tracker.close-with-reason', { id, reason, commit });
}

/** True when `file` is a regular file the current user may execute. */
function isExecutableFile(file) {
  const fs = require('fs');
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * The binary `capability` would spawn when it is not an executable file the way the child's own
 * PATH lookup would find it, else null. `searchPath` is the PATH the child will get; a relative
 * entry (and an empty one, which means the working directory) and a relative binary resolve
 * against `cwd`, the child's working directory. Null as well when the manifest does not declare
 * the capability: the runner reports that itself, as a structured unavailable envelope.
 */
function missingBinary(manifest, capability, searchPath, cwd) {
  const cap = manifest.capabilities && manifest.capabilities[capability];
  const binary = cap && Array.isArray(cap.run) ? cap.run[0] : null;
  if (typeof binary !== 'string') return null;
  const path = require('path');
  const candidates =
    binary.includes('/') || binary.includes(path.sep)
      ? [path.resolve(cwd, binary)]
      : String(searchPath || '')
          .split(path.delimiter)
          .map((dir) => path.resolve(cwd, dir || '.', binary));
  const suffixes = process.platform === 'win32' ? ['', '.exe', '.com'] : [''];
  const found = candidates.some((candidate) => suffixes.some((suffix) => isExecutableFile(candidate + suffix)));
  return found ? null : binary;
}

/**
 * Resolve the repository's tracker adapter manifest: `{manifest}`, or `{reason}` when no usable
 * tracker can be resolved (no config/detect match, adapter not installed, manifest invalid, the
 * adapter's workspace not initialised here). Only failures to RESOLVE are reported; the requires
 * stay outside the try so a broken install propagates instead of reading as "no tracker".
 */
function resolveManifest(projectRoot, env) {
  const { resolveCategory } = require('./toolchain/config');
  const { loadAdapter } = require('./toolchain/adapters');
  const { detectAdapter } = require('./toolchain/detect');
  let manifest;
  try {
    const resolved = resolveCategory('tracker', { projectRoot, env, detect: detectAdapter });
    manifest = loadAdapter(resolved.value, { projectRoot, env, interactive: false }).manifest;
  } catch (error) {
    return { reason: error && error.message ? error.message : String(error) };
  }
  // A tracker whose workspace is not initialised in this repository is "no tracker": br reports
  // that only on stdout, which the runner's TOOL_FAILED detail drops, so it cannot be recognised
  // from the envelope.
  const marker = WORKSPACE_MARKERS[manifest.adapter];
  if (marker && !require('fs').existsSync(require('path').join(projectRoot, marker))) {
    return { reason: `no '${marker}' workspace in ${projectRoot} for the '${manifest.adapter}' tracker` };
  }
  return { manifest };
}

/**
 * Default deps: resolve the repository's tracker adapter through the toolchain and run
 * capabilities against it with `cwd` set to `projectRoot`. When no usable tracker can be
 * resolved (see `resolveManifest`), or the capability's binary is not an executable on the
 * `PATH` the child will get, `run` RETURNS the unavailable envelope without spawning anything.
 * Everything the runner itself throws is a bug and propagates. Requires are lazy so the pure
 * functions above load without the toolchain.
 *
 * @param {{projectRoot: string, env?: NodeJS.ProcessEnv, timeoutMs?: number}} options
 * @returns {{run: (capability: string, args: object) => object}}
 */
function createToolchainDeps({ projectRoot, env = process.env, timeoutMs } = {}) {
  let manifest;
  return {
    run(capability, args) {
      const { runCapabilitySync, buildChildEnv } = require('./toolchain/runner');
      if (!manifest) {
        const resolved = resolveManifest(projectRoot, env);
        if (!resolved.manifest) return unavailable(`tracker is unavailable: ${resolved.reason}`);
        manifest = resolved.manifest;
      }
      const missing = missingBinary(manifest, capability, buildChildEnv(manifest.env, env).PATH, projectRoot);
      if (missing) return unavailable(`tracker is unavailable: '${missing}' is not installed (no executable on PATH)`);
      return runCapabilitySync(manifest, capability, args, {
        parentEnv: env,
        timeoutMs,
        execFileOptions: { cwd: projectRoot }
      });
    }
  };
}

module.exports = {
  SKIP_FALLBACK,
  createFinding,
  findByKey,
  updateFinding,
  closeFinding,
  createToolchainDeps
};
