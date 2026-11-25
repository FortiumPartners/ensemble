'use strict';

/**
 * TRD-005-TEST (TRD-2026-d571763f): the dispatcher's input boundary.
 *
 * PR 1 built `lib/engine/validate.js` but nothing called it. These scenarios exist because
 * Constitution Rule 6 requires the behaviour to be reachable from the entry point: every one
 * drives `main(argv, ctx)` (or the real binary), never `validate.js` directly, so a boundary
 * that stopped being wired in would go red here rather than pass a unit test in isolation.
 *
 * Each refusal is also asserted to happen *before* the handler runs: a check that refuses after
 * the side effect is not a check (Rule 7).
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { MAX_STDIN_BYTES } = require('../lib/engine/validate');
const { createRegistry } = require('../lib/engine/registry');
const { makeCtx, makeRoot, runMain } = require('./helpers/engine-run');

const CLI_PATH = path.join(__dirname, '..', 'lib', 'ensemble-cli.js');

/**
 * A registry with one native verb that takes an `x-path` field, so path containment can be
 * exercised through the dispatcher without depending on a shipped verb having such a field.
 * @param {Function} handler
 * @returns {object} the registry
 */
function pathVerbRegistry(handler) {
  const registry = createRegistry();
  registry.register({
    exitCodes: [0, 2],
    group: 'fixture',
    handler,
    inputSchema: {
      additionalProperties: false,
      properties: { file: { type: 'string', 'x-path': true } },
      required: ['file'],
      type: 'object',
    },
    name: 'read-file',
    outputSchema: { additionalProperties: false, properties: { file: { type: 'string' } }, type: 'object' },
    policyKeys: [],
    sideEffect: 'read',
    summary: 'fixture verb that takes a contained path',
  });
  return registry;
}

describe('stdin input boundary', () => {
  test('stdin input is schema-checked and the unknown field is named', () => {
    const { envelope, exitCode } = runMain(
      ['engine', 'schema', '--stdin'],
      makeCtx({ cwd: makeRoot(), stdin: '{"verb":"engine.policy","nope":1}' })
    );

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('nope');
  });

  test('a stdin body missing a required field is refused naming it', () => {
    const { envelope, exitCode } = runMain(
      ['engine', 'schema', '--stdin'],
      makeCtx({ cwd: makeRoot(), stdin: '{}' })
    );

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('verb');
  });

  test('a stdin field of the wrong type is refused naming the field', () => {
    const { envelope, exitCode } = runMain(
      ['engine', 'schema', '--stdin'],
      makeCtx({ cwd: makeRoot(), stdin: '{"verb":5}' })
    );

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('verb');
  });

  test('a well-formed stdin body reaches the verb', () => {
    const { envelope, exitCode } = runMain(
      ['engine', 'schema', '--stdin'],
      makeCtx({ cwd: makeRoot(), stdin: '{"verb":"engine.policy"}' })
    );

    expect(exitCode).toBe(0);
    expect(envelope.data.name).toBe('policy');
  });

  test('--stdin together with an operand is refused', () => {
    const { envelope, exitCode } = runMain(
      ['engine', 'schema', 'engine.policy', '--stdin'],
      makeCtx({ cwd: makeRoot(), stdin: '{"verb":"engine.policy"}' })
    );

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('STDIN_WITH_FLAGS');
  });

  test('--stdin with no body read is refused rather than treated as empty input', () => {
    const { envelope, exitCode } = runMain(['engine', 'schema', '--stdin'], makeCtx({ cwd: makeRoot() }));

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('STDIN_NOT_READ');
  });
});

describe('flag and operand boundary', () => {
  test('an unknown flag is refused and the handler never runs', () => {
    const handler = jest.fn(() => ({ file: 'x' }));
    const ctx = makeCtx({ cwd: makeRoot(), registry: pathVerbRegistry(handler) });
    const { envelope, exitCode } = runMain(['fixture', 'read-file', '--no-such-flag'], ctx);

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('UNKNOWN_FLAG');
    expect(handler).not.toHaveBeenCalled();
  });

  test('an operand on a verb with no operand property is refused naming it', () => {
    const handler = jest.fn(() => ({ file: 'x' }));
    const ctx = makeCtx({ cwd: makeRoot(), registry: pathVerbRegistry(handler) });
    const { envelope, exitCode } = runMain(['fixture', 'read-file', 'stray-operand'], ctx);

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('UNEXPECTED_OPERAND');
    expect(envelope.error.message).toContain('stray-operand');
    expect(handler).not.toHaveBeenCalled();
  });

  test('a flag that expects a value and gets none is refused', () => {
    const handler = jest.fn(() => ({ file: 'x' }));
    const ctx = makeCtx({ cwd: makeRoot(), registry: pathVerbRegistry(handler) });
    const { envelope, exitCode } = runMain(['fixture', 'read-file', '--file'], ctx);

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('MISSING_FLAG_VALUE');
    expect(handler).not.toHaveBeenCalled();
  });

  test('a repeated scalar flag is refused rather than silently taking the last value', () => {
    const handler = jest.fn(() => ({ file: 'x' }));
    const ctx = makeCtx({ cwd: makeRoot(), registry: pathVerbRegistry(handler) });
    const { envelope, exitCode } = runMain(
      ['fixture', 'read-file', '--file', 'a.txt', '--file', 'b.txt'],
      ctx
    );

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('DUPLICATE_FLAG');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('path containment boundary', () => {
  test('a path that escapes the project root is refused and the handler never runs', () => {
    const handler = jest.fn(() => ({ file: 'x' }));
    const root = makeRoot();
    const ctx = makeCtx({ cwd: root, registry: pathVerbRegistry(handler) });
    const { envelope, exitCode } = runMain(
      ['fixture', 'read-file', '--file', '../../etc/passwd'],
      ctx
    );

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('PATH_ESCAPE');
    expect(handler).not.toHaveBeenCalled();
  });

  test('an in-tree path reaches the handler resolved against the project root', () => {
    const root = makeRoot();
    const handler = jest.fn(call => ({ file: call.input.file }));
    const ctx = makeCtx({ cwd: root, registry: pathVerbRegistry(handler) });
    const { exitCode } = runMain(['fixture', 'read-file', '--file', 'docs/x.md'], ctx);

    expect(exitCode).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].input.file).toBe(path.join(root, 'docs', 'x.md'));
  });

  test('a nonexistent --project-root is refused', () => {
    const handler = jest.fn(() => ({ file: 'x' }));
    const root = makeRoot();
    const ctx = makeCtx({ cwd: root, registry: pathVerbRegistry(handler) });
    const { envelope, exitCode } = runMain(
      ['fixture', 'read-file', '--project-root', path.join(root, 'no-such-dir'), '--file', 'a.md'],
      ctx
    );

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('INVALID_PROJECT_ROOT');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('the real binary', () => {
  test('an oversized stdin body is refused before it is parsed', () => {
    const oversized = 'x'.repeat(MAX_STDIN_BYTES + 1);
    const out = spawnSync(process.execPath, [CLI_PATH, 'engine', 'schema', '--stdin'], {
      encoding: 'utf8',
      input: oversized,
      maxBuffer: 64 * 1024 * 1024,
    });

    expect(out.status).toBe(2);
    const lines = out.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0]);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('INPUT_TOO_LARGE');
  });

  test('a well-formed stdin body is answered with one envelope on stdout', () => {
    const out = spawnSync(process.execPath, [CLI_PATH, 'engine', 'schema', '--stdin'], {
      encoding: 'utf8',
      input: '{"verb":"engine.policy"}',
    });

    expect(out.status).toBe(0);
    const lines = out.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).data.name).toBe('policy');
  });
});
