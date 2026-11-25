'use strict';

/**
 * TRD-005-TEST (TRD-2026-d571763f): shared fixtures for the engine's native-verb tests.
 *
 * Every scenario drives the real entry point `main(argv, ctx)`, so these helpers only supply
 * collecting streams, a temporary project root and an output-schema check. Nothing here
 * re-implements engine behaviour: a helper that decided a result would hide the behaviour the
 * scenario is supposed to pin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv');

const { main } = require('../../lib/ensemble-cli');

/** A collecting stream stand-in, so stdout and stderr stay separable. */
function collector() {
  const chunks = [];
  return {
    write(text) {
      chunks.push(String(text));
      return true;
    },
    get text() {
      return chunks.join('');
    },
  };
}

/**
 * @param {object} [overrides]
 * @returns {object} a context for `main`, with collecting streams and an empty environment
 */
function makeCtx(overrides = {}) {
  return {
    cwd: process.cwd(),
    env: {},
    stderr: collector(),
    stdout: collector(),
    ...overrides,
  };
}

/**
 * Run the dispatcher in process.
 * @param {string[]} argv
 * @param {object} [ctx]
 * @returns {{envelope: object|null, exitCode: number, stdout: string, stderr: string}}
 */
function runMain(argv, ctx = makeCtx()) {
  const { envelope, exitCode } = main(argv, ctx);
  return {
    envelope,
    exitCode,
    stderr: ctx.stderr.text,
    stdout: ctx.stdout.text,
  };
}

/**
 * A real, empty project root. The real path is returned because the engine compares real paths,
 * and on macOS `os.tmpdir()` is itself a symlink.
 * @returns {string} an absolute, existing directory
 */
function makeRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-')));
}

/**
 * Write `.ensemble/engine.yaml` under `root`.
 * @param {string} root
 * @param {string} text
 * @returns {string} the file path
 */
function writeEngineYaml(root, text) {
  const file = path.join(root, '.ensemble', 'engine.yaml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

/**
 * Assert the envelope's payload really matches the schema the verb published. A verb whose
 * `outputSchema` drifts from what it returns would make `--describe` a lie.
 * @param {object} spec the registry spec
 * @param {object} envelope
 */
function expectMatchesOutputSchema(spec, envelope) {
  if (envelope.status !== 'OK' && envelope.status !== 'NEEDS_CHOICE') return;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(spec.outputSchema);
  if (!validate(envelope.data)) {
    throw new Error(
      `verb '${spec.group} ${spec.name}' output does not match its outputSchema: ${ajv.errorsText(
        validate.errors
      )}`
    );
  }
}

module.exports = {
  collector,
  expectMatchesOutputSchema,
  makeCtx,
  makeRoot,
  runMain,
  writeEngineYaml,
};
