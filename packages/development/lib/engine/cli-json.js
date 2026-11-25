'use strict';

/**
 * TRD-007 (TRD-2026-d571763f): how a native verb asks the legacy CLIs a question.
 *
 * The engine does not re-implement what `toolchain-cli.js` and `trd-cli.js` already decide, and
 * it does not import their handlers either: it runs them exactly the way the skill runs them
 * today, as a child process whose `--json` envelope it reads (TRD decision D4). Importing them
 * would make the engine a second dispatcher for their verbs (Constitution Rule 4) and would let
 * a change to their process-level behaviour -- exit codes, `--non-interactive`, the run-id gate
 * -- pass unnoticed.
 *
 * Only pure functions are imported directly; anything that resolves an adapter, touches the
 * filesystem or spawns a tool goes through here.
 */

const { spawnSync } = require('child_process');

const { RESULT, refused, unavailable } = require('./result');
const { resolveInteractivity } = require('./interactivity');

/** The largest child-process output accepted, so a runaway tool cannot exhaust memory. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Run a Node CLI of this package and read its JSON envelope.
 * @param {string} cliPath absolute path of the CLI entry point
 * @param {string[]} argv the CLI's own arguments
 * @param {{cwd: string, env: object}} options
 * @returns {{exitCode: number, json: object|null, stderr: string}} `json` is `null` when the CLI
 *   wrote something that is not a JSON object, which callers must treat as a failure rather than
 *   as an empty answer (Constitution Rule 7).
 */
function runJsonCli(cliPath, argv, options) {
  const result = spawnSync(process.execPath, [cliPath, ...argv], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  const exitCode = result.status === null ? 1 : result.status;
  const stderr = `${result.stderr || ''}${result.error ? result.error.message : ''}`;
  let json = null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed && typeof parsed === 'object') json = parsed;
  } catch {
    // A non-JSON stdout is reported as `json: null`; the caller decides what that means for it.
  }
  return { exitCode, json, stderr };
}

/**
 * The flags every legacy-CLI call inherits from the engine invocation: `--json` always, the
 * caller's run id when it supplied one (so the toolchain's side-effect ledger stays bound to the
 * same run), and `--non-interactive` when the engine itself cannot ask a question -- a tool that
 * prompted anyway would hang a Foreman run.
 * @param {object} call
 * @returns {string[]}
 */
function inheritedFlags(call) {
  const flags = ['--json'];
  const runId = call.globals && call.globals.runId;
  if (runId) flags.push('--run-id', runId);
  if (isNonInteractive(call)) flags.push('--non-interactive');
  return flags;
}

function isNonInteractive(call) {
  return resolveInteractivity({ env: call.env, globals: call.globals }).nonInteractive;
}

/**
 * Run `toolchain-cli.js`.
 * @param {object} call the dispatcher's call object
 * @param {string[]} argv the subcommand and its arguments
 * @returns {{exitCode: number, json: object|null, stderr: string}}
 */
function runToolchain(call, argv) {
  const { cliPath } = require('./groups/tool');
  return runJsonCli(cliPath, [...argv, ...inheritedFlags(call)], {
    cwd: call.projectRoot,
    env: call.env,
  });
}

/**
 * Run `trd-cli.js`.
 * @param {object} call the dispatcher's call object
 * @param {string[]} argv the subcommand and its arguments
 * @returns {{exitCode: number, json: object|null, stderr: string}}
 */
function runTrd(call, argv) {
  const { cliPath } = require('./groups/trd');
  return runJsonCli(cliPath, [...argv, ...inheritedFlags(call)], {
    cwd: call.projectRoot,
    env: call.env,
  });
}

/** Legacy error codes that mean the request itself was wrong. */
const INVALID_INPUT_CODES = Object.freeze(['INVALID_RUN_ID', 'INVALID_ARG']);

/** Legacy error codes that mean a gate said no -- the tool worked and declined. */
const REFUSED_CODES = Object.freeze([
  'PREFLIGHT_REQUIRED',
  'CAPABILITY_NOT_REPORTED',
  'CONFIRMATION_REQUIRED',
  'NOT_ALLOWED',
]);

/**
 * Turn a legacy CLI failure into the engine result that says the same thing. The message is
 * passed through unchanged: an adapter's own wording is what the maintainer must read, and
 * rewriting it here would hide which tool refused and why.
 * @param {{code?: string, message?: string}|null|undefined} error the legacy `error` object
 * @param {string} [fallbackMessage] used when the CLI produced no envelope at all
 * @returns {object} a tagged engine result
 */
function toolchainFailure(error, fallbackMessage = 'the toolchain CLI produced no JSON result') {
  if (!error || typeof error !== 'object') {
    return unavailable('TOOLCHAIN_UNREADABLE', fallbackMessage);
  }
  const code = typeof error.code === 'string' ? error.code : 'UNAVAILABLE';
  const message = typeof error.message === 'string' ? error.message : fallbackMessage;
  if (INVALID_INPUT_CODES.includes(code)) {
    return { [RESULT]: true, code, details: null, message, status: 'INVALID_INPUT' };
  }
  if (REFUSED_CODES.includes(code)) return refused(code, message);
  return unavailable(code, message);
}

module.exports = {
  MAX_OUTPUT_BYTES,
  runJsonCli,
  runToolchain,
  runTrd,
  toolchainFailure,
};
