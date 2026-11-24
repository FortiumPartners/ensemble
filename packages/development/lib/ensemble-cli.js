#!/usr/bin/env node
'use strict';

/**
 * TRD-002 (TRD-2026-d571763f): the `ensemble` entry point.
 *
 * `main(argv, ctx)` is the whole dispatcher and it is pure with respect to the process: it
 * returns `{ envelope, exitCode }` and never calls `process.exit`, so every behaviour below is
 * testable in process (Constitution Rule 6 -- the behaviour is reachable from the entry point,
 * and only the entry guard at the bottom touches the process).
 *
 * The flow is: parse argv -> refuse a bad flag -> `--describe` -> `--help` -> look the verb up
 * -> dispatch. A verb that is not registered is refused with the nearest known verbs; it is
 * never guessed at.
 */

const { parseArgv } = require('./engine/argv');
const { describe, nearestVerbs, renderGroupHelp, renderVerbHelp } = require('./engine/describe');
const { STATUS_EXIT, buildEnvelope, exitCodeFor, internal, invalidInput } = require('./engine/envelope');
const { mountLegacyGroup } = require('./engine/mount');
const { createRegistry } = require('./engine/registry');

const MOUNTED_GROUPS = [require('./engine/groups/trd'), require('./engine/groups/tool')];

/**
 * The engine's registry. Groups are registered here and nowhere else, so `--describe` and the
 * dispatcher can never disagree about what exists.
 * @returns {object} a fresh registry
 */
function buildRegistry() {
  const registry = createRegistry();
  for (const mount of MOUNTED_GROUPS) mountLegacyGroup(registry, mount);
  return registry;
}

function result(envelope, exitCode) {
  return { envelope, exitCode };
}

/**
 * Tell one of the engine's seven statuses from anything else a thrown error may carry.
 *
 * Only a tabled status may become an envelope status: `buildEnvelope` refuses an unknown one,
 * and that refusal would escape the catch block, so the run would answer with no envelope and
 * no exit code at all. An error with, say, `status = 404` is an ordinary fault and belongs in
 * the `INTERNAL` envelope.
 *
 * @param {*} status
 * @returns {boolean} true when `status` is one of the seven tabled statuses
 */
function isEngineStatus(status) {
  return (
    typeof status === 'string' &&
    Object.prototype.hasOwnProperty.call(STATUS_EXIT, status)
  );
}

function envelopeResult(envelope) {
  return result(envelope, exitCodeFor(envelope.status));
}

/**
 * @param {string[]} argv the arguments after the program name
 * @param {{cwd?: string, env?: object, registry?: object, stdout?: object, stderr?: object}} [ctx]
 * @returns {{envelope: object|null, exitCode: number}}
 */
function main(argv, ctx = {}) {
  const stdout = ctx.stdout || process.stdout;
  const stderr = ctx.stderr || process.stderr;
  const streams = { stderr, stdout };
  const registry = ctx.registry || buildRegistry();

  const parsed = parseArgv(argv);
  const label = [parsed.group, parsed.verb].filter(Boolean).join(' ') || 'ensemble';

  // A mounted legacy verb owns every flag after `<group> <verb>`: the parser does not know the
  // legacy CLI's flags, so what it reports as an unknown flag there is passed through untouched
  // (TRD-003 byte-identical output). For an engine verb the flag error stands and nothing runs.
  const parsedSpec =
    parsed.group && parsed.verb ? registry.get(parsed.group, parsed.verb) : null;
  const passthrough = Boolean(parsedSpec && parsedSpec.passthrough);

  if (parsed.error && !passthrough) {
    return envelopeResult(
      invalidInput(label, parsed.error.code, parsed.error.message)
    );
  }

  if (parsed.describe) {
    let data;
    try {
      data = describe(registry);
    } catch (error) {
      if (error && isEngineStatus(error.status)) {
        return envelopeResult(
          buildEnvelope({
            error: { code: error.code, message: error.message },
            ok: false,
            status: error.status,
            verb: 'ensemble --describe',
          })
        );
      }
      return envelopeResult(internal('ensemble --describe', error, streams));
    }
    return envelopeResult(
      buildEnvelope({ data, ok: true, status: 'OK', verb: 'ensemble --describe' })
    );
  }

  if (parsed.help) {
    if (parsed.group && parsed.verb && registry.get(parsed.group, parsed.verb)) {
      stdout.write(renderVerbHelp(registry, parsed.group, parsed.verb));
      return result(null, 0);
    }
    if (parsed.group && registry.groups().includes(parsed.group)) {
      stdout.write(renderGroupHelp(registry, parsed.group));
      return result(null, 0);
    }
    stdout.write(renderRootHelp(registry));
    return result(null, 0);
  }

  if (!parsed.group || !parsed.verb) {
    stdout.write(renderRootHelp(registry));
    return result(null, 0);
  }

  const spec = parsedSpec;
  if (!spec) {
    const nearest = nearestVerbs(registry, parsed.group, parsed.verb);
    const suffix = nearest.length === 0 ? 'no verbs are registered' : `did you mean: ${nearest.join(', ')}`;
    return envelopeResult(
      invalidInput(label, 'UNKNOWN_VERB', `unknown verb '${label}'; ${suffix}`)
    );
  }

  const call = {
    cwd: ctx.cwd || process.cwd(),
    env: ctx.env || process.env,
    globals: parsed.globals,
    rest: parsed.rest,
    stderr,
    stdout,
    verb: label,
  };

  try {
    const value = spec.handler(call);
    // A mounted verb has already written the legacy CLI's own bytes to stdout; wrapping them in
    // an envelope would break parity, so it reports only the legacy exit code.
    if (spec.passthrough) return result(null, value);
    return envelopeResult(
      buildEnvelope({ data: value, ok: true, status: 'OK', verb: label })
    );
  } catch (error) {
    if (error && isEngineStatus(error.status)) {
      return envelopeResult(
        buildEnvelope({
          error: { code: error.code, message: error.message },
          ok: false,
          status: error.status,
          verb: label,
        })
      );
    }
    return envelopeResult(internal(label, error, streams));
  }
}

/**
 * @param {object} registry
 * @returns {string} top-level help, generated from the registry
 */
function renderRootHelp(registry) {
  const lines = ['ensemble <group> <verb> [flags]', '', 'Groups:'];
  for (const group of registry.groups()) {
    const names = registry.verbs(group).map(spec => spec.name);
    lines.push(`  ${group} -- ${names.join(', ')}`);
  }
  if (registry.groups().length === 0) lines.push('  (none registered)');
  lines.push('', 'Run `ensemble --describe` for the machine-readable registry.');
  return `${lines.join('\n')}\n`;
}

/**
 * The only part of this file that touches the process: run `main`, print the envelope and set
 * the exit code. It is exported as well as guarded, because `packages/full/bin/ensemble` is a
 * launcher that requires this module rather than being this module -- under that launcher
 * `require.main` is the launcher, so the guard below does not fire and the launcher calls
 * `run()` itself (TRD-004).
 *
 * @param {string[]} argv the arguments after the command name
 * @returns {number} the exit code, also set on `process.exitCode`
 */
function run(argv) {
  const { envelope, exitCode } = main(argv);
  if (envelope) process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = exitCode;
  return exitCode;
}

if (require.main === module) {
  run(process.argv.slice(2));
}

module.exports = { buildRegistry, main, run };
