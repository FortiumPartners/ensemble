'use strict';

/**
 * run-index-cli-core.js -- the shared body of issue-run-index-cli.js and run-index-cli.js.
 *
 * Both CLIs expose a run-index store (the generated lib/run-index/ build of the agent-core
 * stores) to skill prose. JSON in on stdin, one JSON object out on stdout:
 *
 *   ok      {"ok":true,"run":<record|null>}
 *   domain  {"ok":false,"code":"REVISION_CONFLICT"|"RUN_ALREADY_ACTIVE"|"RUN_INDEX_CORRUPT"|
 *            "INVALID_INPUT"|"PATH_ESCAPE"|"IO_ERROR", "message":...}   exit 0
 *   malformed stdin (not JSON, not an object) or an unknown / missing subcommand: the same
 *   {"ok":false,...} shape, exit 1.
 *
 * Every read and write goes through the store, so the atomic temp-and-rename write,
 * active.lock and optimistic revision check are the store's own, never re-implemented here.
 * `mutate` takes DECLARATIVE patches (a closed vocabulary validated below, applied in order
 * inside the store's updater); nothing in a payload is ever evaluated.
 *
 * What the store does NOT guard, this does: runId is joined into a file name by the store, so
 * it must be a generated id; projectRoot must be a real directory; the runs directory must
 * not be a symlink out of the project; an artifact path must not climb out of the project.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN_ID_RE = /^[0-9a-f]{16}$/;
const OUTCOME_KINDS = ['success', 'decline', 'failure', 'approval_wait'];
const MAX_PATCH_OPS = 32;

/** A validation failure: becomes {ok:false, code, message}. */
class CliError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}
const invalid = message => new CliError('INVALID_INPUT', message);

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = v => typeof v === 'string' && v.length > 0 && !v.includes('\0');

/** @returns {string} `value`, or throws INVALID_INPUT naming `field` */
function requireText(value, field) {
  if (!isText(value)) throw invalid(`"${field}" must be a non-empty string`);
  return value;
}

/** True when `child` is `parent` or inside it (both absolute, already normalised). */
const isInside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

/** Realpath of the deepest existing ancestor of `target`, with the missing tail re-appended. */
function realpathOfExisting(target) {
  let existing = target;
  const tail = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...tail);
}

/**
 * The project root: explicit `projectRoot`, else the git toplevel of the cwd, else the cwd.
 * Always returned as a realpath of an existing directory.
 */
function resolveProjectRoot(raw, cwd) {
  let root;
  if (raw !== undefined) {
    requireText(raw, 'projectRoot');
    if (raw.split(/[\\/]/).includes('..')) throw new CliError('PATH_ESCAPE', 'projectRoot must not contain ".." segments');
    root = path.resolve(cwd, raw);
  } else {
    try {
      root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      root = cwd;
    }
  }
  let real;
  try {
    real = fs.realpathSync(root);
    if (!fs.statSync(real).isDirectory()) throw new Error('not a directory');
  } catch {
    throw invalid(`projectRoot "${root}" is not an existing directory`);
  }
  return real;
}

/** Refuse a runs directory (or its parent) that is a symlink resolving outside the project. */
function assertRunsDirInside(root, runsRel, runId) {
  const parts = [...runsRel.split('/')];
  let dir = root;
  for (const part of parts) {
    dir = path.join(dir, part);
    if (fs.existsSync(dir) && !isInside(root, fs.realpathSync(dir))) {
      throw new CliError('PATH_ESCAPE', `${path.relative(root, dir)} resolves outside the project`);
    }
  }
  if (runId) {
    const file = path.join(dir, `${runId}.json`);
    if (fs.existsSync(file) && !isInside(fs.realpathSync(dir), fs.realpathSync(file))) {
      throw new CliError('PATH_ESCAPE', `run file ${runId}.json resolves outside ${runsRel}`);
    }
  }
}

/** An artifact path as given (the store matches it exactly), checked to stay in the project. */
function checkArtifactPath(value, root, field) {
  requireText(value, field);
  if (value.split(/[\\/]/).includes('..')) throw new CliError('PATH_ESCAPE', `${field} must not contain ".." segments`);
  const abs = path.resolve(root, value);
  if (!isInside(root, abs) || !isInside(root, realpathOfExisting(abs))) {
    throw new CliError('PATH_ESCAPE', `${field} resolves outside the project`);
  }
  return value;
}

/** Reject keys outside `allowed`, so a typo cannot be silently ignored. */
function onlyKeys(obj, allowed, what) {
  const extra = Object.keys(obj).filter(k => !allowed.includes(k));
  if (extra.length > 0) throw invalid(`${what}: unknown key(s) ${extra.join(', ')}`);
}

/**
 * Build a CLI for one store.
 *
 * @param {object} spec
 * @param {string} spec.name       CLI file name, for messages
 * @param {string} spec.runsRel    runs directory relative to the project, posix
 * @param {object} spec.store      the generated store module
 * @param {readonly string[]} spec.stages  the workflow's stage enum
 * @param {object} spec.create     {subcommand, field}: the create payload field that holds the free text
 * @param {readonly string[]} spec.artifactFields  keys an artifact (appendArtifact op or create-from-artifact) may carry
 * @param {(fields: object, root: string, at: string) => object} spec.artifact  validates those keys' values into the artifact
 * @param {readonly string[]} spec.extraOps  patch ops beyond the shared ones ('setImplementationApprovedAt')
 * @param {boolean} spec.hasArtifactLookup  expose resolve-by-artifact and create-from-artifact
 * @returns {{SUBCOMMANDS: string[], PATCH_OPS: string[], PAYLOAD_KEYS: object, OP_FIELDS: object, main: Function, run: Function}}
 */
function createCli(spec) {
  const { store, stages } = spec;
  const PATCH_OPS = ['setStage', 'setStageOutcome', 'appendArtifact', 'appendBeadRef', 'setPrApprovedAt', ...spec.extraOps];
  /** Keys each op may carry; anything else is rejected. Also what the skill prose is tested against. */
  const ALL_OP_FIELDS = {
    setStage: ['stage'],
    setStageOutcome: ['kind', 'detail'],
    appendArtifact: spec.artifactFields,
    appendBeadRef: ['ref'],
    setPrApprovedAt: ['value'],
    setImplementationApprovedAt: ['value'],
  };
  const OP_FIELDS = Object.fromEntries(PATCH_OPS.map(name => [name, ALL_OP_FIELDS[name]]));

  /** Validate one op into a normalised op; throws INVALID_INPUT / PATH_ESCAPE. */
  function validateOp(op, index, root) {
    const at = `patch[${index}]`;
    if (!isObject(op)) throw invalid(`${at} must be an object`);
    if (!PATCH_OPS.includes(op.op)) throw invalid(`${at}: unknown op ${JSON.stringify(op.op)} (allowed: ${PATCH_OPS.join(', ')})`);
    const { op: name, ...rest } = op;
    onlyKeys(rest, OP_FIELDS[name], at);
    switch (name) {
      case 'setStage':
        if (!stages.includes(rest.stage)) throw invalid(`${at}: stage must be one of ${stages.join(', ')}`);
        return { op: name, stage: rest.stage };
      case 'setStageOutcome': {
        if (rest.kind === undefined && rest.detail === undefined) throw invalid(`${at}: setStageOutcome needs "kind" and/or "detail"`);
        if (rest.kind !== undefined && !OUTCOME_KINDS.includes(rest.kind)) throw invalid(`${at}: kind must be one of ${OUTCOME_KINDS.join(', ')}`);
        if (rest.detail !== undefined && (typeof rest.detail !== 'string' || rest.detail.includes('\0'))) throw invalid(`${at}: detail must be a string`);
        return { op: name, kind: rest.kind, detail: rest.detail };
      }
      case 'appendArtifact':
        return { op: name, artifact: spec.artifact(rest, root, at) };
      case 'appendBeadRef':
        return { op: name, ref: requireText(rest.ref, `${at}.ref`) };
      case 'setPrApprovedAt':
      case 'setImplementationApprovedAt':
        if (rest.value !== 'now' && rest.value !== null) throw invalid(`${at}: value must be "now" or null`);
        return { op: name, value: rest.value };
      default:
        throw invalid(`${at}: unhandled op ${name}`);
    }
  }

  /** Apply validated ops, in order, to the record the store hands its updater. */
  function applyOps(record, ops) {
    for (const o of ops) {
      const now = new Date().toISOString();
      switch (o.op) {
        case 'setStage':
          record.stage = o.stage;
          break;
        case 'setStageOutcome': {
          // Omitted kind keeps the current one (the store's own abandon does the same);
          // an omitted detail drops the old one, as a fresh { kind, recordedAt } does.
          const outcome = { kind: o.kind !== undefined ? o.kind : record.stageOutcome.kind };
          if (o.detail !== undefined) outcome.detail = o.detail;
          record.stageOutcome = { ...outcome, recordedAt: now };
          break;
        }
        case 'appendArtifact':
          record.artifacts.push({ ...o.artifact, recordedAt: now });
          break;
        case 'appendBeadRef':
          if (!record.beadRefs.includes(o.ref)) record.beadRefs.push(o.ref);
          break;
        case 'setPrApprovedAt':
          record.prApprovedAt = o.value === 'now' ? now : null;
          break;
        case 'setImplementationApprovedAt':
          record.implementationApprovedAt = o.value === 'now' ? now : null;
          break;
      }
    }
  }

  const runIdOf = payload => {
    if (typeof payload.runId !== 'string' || !RUN_ID_RE.test(payload.runId)) throw invalid('"runId" must be a 16-character lowercase hex run id');
    return payload.runId;
  };

  /** Subcommand table: name -> { keys, run(payload, root) -> run record | null }. */
  const COMMANDS = {
    create: {
      keys: ['projectRoot', spec.create.field],
      run: (p, root) => store.createRun(root, requireText(p[spec.create.field], spec.create.field)),
    },
    'find-active': { keys: ['projectRoot'], run: (p, root) => store.findActive(root) || null },
    load: { keys: ['projectRoot', 'runId'], run: (p, root) => store.loadRun(root, runIdOf(p)) },
    abandon: {
      keys: ['projectRoot', 'runId', 'reason'],
      run: (p, root) => {
        if (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason.includes('\0'))) throw invalid('"reason" must be a string');
        return store.abandon(root, runIdOf(p), p.reason === undefined ? '' : p.reason);
      },
    },
    complete: { keys: ['projectRoot', 'runId'], run: (p, root) => store.complete(root, runIdOf(p)) },
    mutate: {
      keys: ['projectRoot', 'runId', 'expectedRevision', 'patch'],
      run: (p, root) => {
        const runId = runIdOf(p);
        if (!Number.isInteger(p.expectedRevision) || p.expectedRevision < 0) throw invalid('"expectedRevision" must be a non-negative integer');
        if (!Array.isArray(p.patch) || p.patch.length === 0 || p.patch.length > MAX_PATCH_OPS) {
          throw invalid(`"patch" must be an array of 1-${MAX_PATCH_OPS} ops`);
        }
        // Every op is validated before the store is touched: a bad op writes nothing.
        const ops = p.patch.map((op, i) => validateOp(op, i, root));
        return store.mutate(root, runId, p.expectedRevision, record => applyOps(record, ops));
      },
    },
  };
  if (spec.hasArtifactLookup) {
    COMMANDS['resolve-by-artifact'] = {
      keys: ['projectRoot', 'path'],
      run: (p, root) => store.resolveByArtifact(root, checkArtifactPath(p.path, root, 'path')) || null,
    };
    COMMANDS['create-from-artifact'] = {
      keys: ['projectRoot', spec.create.field, 'artifact', 'startStage'],
      run: (p, root) => {
        if (!stages.includes(p.startStage)) throw invalid(`"startStage" must be one of ${stages.join(', ')}`);
        if (!isObject(p.artifact)) throw invalid('"artifact" must be an object');
        onlyKeys(p.artifact, spec.artifactFields, 'artifact');
        const artifact = spec.artifact(p.artifact, root, 'artifact');
        return store.createRunFromArtifact(root, requireText(p[spec.create.field], spec.create.field), artifact, p.startStage);
      },
    };
  }
  const SUBCOMMANDS = Object.keys(COMMANDS);

  /** Run one subcommand against a parsed payload; returns {result, exit}. */
  function run(subcommand, payload, cwd) {
    const command = Object.hasOwn(COMMANDS, subcommand) ? COMMANDS[subcommand] : null;
    if (!command) {
      return { exit: 1, result: { ok: false, code: 'INVALID_INPUT', message: `usage: ${spec.name} <${SUBCOMMANDS.join('|')}> < payload.json`, subcommands: SUBCOMMANDS } };
    }
    if (!isObject(payload)) {
      return { exit: 1, result: { ok: false, code: 'INVALID_INPUT', message: 'stdin must be one JSON object' } };
    }
    try {
      onlyKeys(payload, command.keys, `${subcommand} payload`);
      const root = resolveProjectRoot(payload.projectRoot, cwd);
      assertRunsDirInside(root, spec.runsRel, typeof payload.runId === 'string' && RUN_ID_RE.test(payload.runId) ? payload.runId : null);
      return { exit: 0, result: { ok: true, run: command.run(payload, root) } };
    } catch (err) {
      if (err instanceof CliError) return { exit: 0, result: { ok: false, code: err.code, message: err.message, ...err.extra } };
      const code = err && typeof err.code === 'string' ? err.code : 'IO_ERROR';
      const result = { ok: false, code, message: err && err.message ? err.message : String(err) };
      for (const key of ['currentRevision', 'existingRunId', 'filePath', 'reason']) if (err && err[key] !== undefined) result[key] = err[key];
      return { exit: 0, result };
    }
  }

  /** CLI entry: `io` = { argv, readStdin, emit, cwd } for tests. @returns {number} exit code */
  function main(io = {}) {
    const argv = io.argv || process.argv.slice(2);
    const emit = io.emit || (value => process.stdout.write(`${JSON.stringify(value)}\n`));
    const cwd = io.cwd || process.cwd();
    const subcommand = argv[0];
    if (!subcommand || !SUBCOMMANDS.includes(subcommand)) return emitRun(emit, run(subcommand, {}, cwd));
    let payload;
    try {
      const raw = (io.readStdin || (() => fs.readFileSync(0, 'utf8')))();
      payload = raw.trim() === '' ? {} : JSON.parse(raw);
    } catch (err) {
      emit({ ok: false, code: 'INVALID_INPUT', message: `invalid JSON on stdin: ${err.message}` });
      return 1;
    }
    return emitRun(emit, run(subcommand, payload, cwd));
  }

  const PAYLOAD_KEYS = Object.fromEntries(SUBCOMMANDS.map(name => [name, COMMANDS[name].keys.filter(k => k !== 'projectRoot')]));
  return { SUBCOMMANDS, PATCH_OPS, PAYLOAD_KEYS, OP_FIELDS, main, run };
}

function emitRun(emit, { result, exit }) {
  emit(result);
  return exit;
}

module.exports = { createCli, requireText, onlyKeys, checkArtifactPath, invalid, CliError, RUN_ID_RE, OUTCOME_KINDS };
