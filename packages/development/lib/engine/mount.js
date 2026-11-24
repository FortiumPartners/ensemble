'use strict';

/**
 * TRD-003 (TRD-2026-d571763f): mount an existing CLI as an `ensemble` group.
 *
 * A mounted verb runs the legacy CLI as a child process and copies its stdout and stderr through
 * verbatim as Buffers, so `ensemble trd parse x` is byte-identical to `node trd-cli.js parse x`.
 * Mounted groups deliberately bypass the engine envelope ("Mounted groups keep their legacy
 * output exactly", TRD line 91); a child process is also what makes a legacy handler's
 * `process.exit` (`toolchain-cli.js:1410`) unable to terminate the engine process.
 *
 * Registration is refused -- loudly, naming the verb -- when a verb has no entry in the declared
 * side-effect table. A mounted verb whose side-effect class were guessed would let a disk-writing
 * verb be published to the planner as a read (Constitution Rule 7).
 */

const { spawnSync } = require('child_process');

/** Mounted verbs take whatever the caller typed; the schema says exactly that. */
const PASSTHROUGH_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { argv: { type: 'array', items: { type: 'string' } } },
  additionalProperties: false,
});

/** The legacy CLIs print their own JSON shapes; the engine does not reinterpret them. */
const PASSTHROUGH_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: true,
});

/**
 * Register every verb of a legacy CLI as a passthrough verb of `group`.
 *
 * @param {{register: Function}} registry
 * @param {{group: string, cliPath: string, verbs: string[], sideEffects: Record<string,string>,
 *          summaries: Record<string,string>, exitCodes?: number[]}} mount
 * @returns {object[]} the registered specs
 * @throws {Error} naming the verb when it has no declared side-effect class or summary
 */
function mountLegacyGroup(registry, mount) {
  const { cliPath, exitCodes = [0, 1], group, sideEffects, summaries, verbs } = mount;
  const registered = [];

  for (const name of verbs) {
    if (!Object.prototype.hasOwnProperty.call(sideEffects, name)) {
      throw new Error(`${group}: verb '${name}' has no declared side-effect class`);
    }
    if (!Object.prototype.hasOwnProperty.call(summaries, name)) {
      throw new Error(`${group}: verb '${name}' has no declared summary`);
    }

    registered.push(
      registry.register({
        exitCodes,
        group,
        handler: call => runLegacy(cliPath, name, call),
        inputSchema: PASSTHROUGH_INPUT_SCHEMA,
        name,
        outputSchema: PASSTHROUGH_OUTPUT_SCHEMA,
        passthrough: true,
        policyKeys: [],
        sideEffect: sideEffects[name],
        summary: summaries[name],
      })
    );
  }

  return registered;
}

/**
 * @param {string} cliPath
 * @param {string} verb
 * @param {{cwd: string, env: object, rest: string[], stdout: {write: Function}, stderr: {write: Function}}} call
 * @returns {number} the child's exit code, which becomes the engine's exit code
 */
function runLegacy(cliPath, verb, call) {
  const child = spawnSync(process.execPath, [cliPath, verb, ...call.rest], {
    cwd: call.cwd,
    encoding: 'buffer',
    env: call.env,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (child.error) throw child.error;
  if (child.stdout && child.stdout.length > 0) call.stdout.write(child.stdout);
  if (child.stderr && child.stderr.length > 0) call.stderr.write(child.stderr);

  // A child killed by a signal has `status === null`; report it as a failure rather than as 0.
  return child.status === null ? 1 : child.status;
}

module.exports = {
  PASSTHROUGH_INPUT_SCHEMA,
  PASSTHROUGH_OUTPUT_SCHEMA,
  mountLegacyGroup,
};
