'use strict';

/**
 * TRD-002-TEST (TRD-2026-d571763f): the verb registry, the argv parser and discovery.
 *
 * Every scenario drives the real entry point `main(argv, ctx)` from `lib/ensemble-cli.js`, or
 * `parseArgv` from `lib/engine/argv.js`, in process: `main` returns `{ envelope, exitCode }` and
 * never calls `process.exit`, which is what makes these assertions possible at all.
 *
 * The registry under test is a fixture registry injected through `ctx.registry`, so the
 * scenarios pin the registry/argv/discovery contract itself and not the particular verbs the
 * shipped `buildRegistry()` happens to mount.
 */

const { parseArgv } = require('../lib/engine/argv');
const { createRegistry } = require('../lib/engine/registry');
const { main } = require('../lib/ensemble-cli');

const INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { path: { type: 'string' } },
  additionalProperties: false,
});

const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  additionalProperties: false,
});

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

function makeCtx(registry) {
  return {
    cwd: process.cwd(),
    env: {},
    registry,
    stderr: collector(),
    stdout: collector(),
  };
}

function spec(group, name, overrides = {}) {
  return {
    exitCodes: [0, 2],
    group,
    handler: () => ({ ok: true }),
    inputSchema: INPUT_SCHEMA,
    name,
    outputSchema: OUTPUT_SCHEMA,
    policyKeys: [],
    sideEffect: 'read',
    summary: `fixture verb ${group} ${name}`,
    ...overrides,
  };
}

/** Three registered verbs, the fixture every scenario below starts from. */
function fixtureRegistry(overrides = {}) {
  const registry = createRegistry();
  registry.register(spec('implement', 'args', overrides.args));
  registry.register(spec('implement', 'resume', overrides.resume));
  registry.register(spec('trd', 'parse', overrides.parse));
  return registry;
}

describe('engine registry, argv and discovery (TRD-002)', () => {
  test('describe lists every verb', () => {
    const ctx = makeCtx(fixtureRegistry());
    const { envelope, exitCode } = main(['--describe'], ctx);

    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.status).toBe('OK');

    const { verbs } = envelope.data;
    expect(verbs.map(v => `${v.group} ${v.name}`)).toEqual([
      'implement args',
      'implement resume',
      'trd parse',
    ]);

    for (const entry of verbs) {
      expect(Object.keys(entry)).toEqual(
        [
          'exitCodes',
          'group',
          'inputSchema',
          'name',
          'outputSchema',
          'policyKeys',
          'sideEffect',
          'summary',
        ].sort()
      );
      expect(entry.inputSchema).toEqual(INPUT_SCHEMA);
      expect(entry.outputSchema).toEqual(OUTPUT_SCHEMA);
    }

    expect(ctx.stdout.text).toBe('');
  });

  test('unknown verb refused', () => {
    const ctx = makeCtx(fixtureRegistry());
    const { envelope, exitCode } = main(['implement', 'frobnicate'], ctx);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain("unknown verb 'implement frobnicate'");
    expect(envelope.error.message).toContain('implement args');
    expect(envelope.error.message).toContain('implement resume');
  });

  test('flag position independent', () => {
    const before = parseArgv(['--run-id', 'r1', '--project-root', '/p', 'implement', 'args']);
    const after = parseArgv(['implement', 'args', '--run-id', 'r1', '--project-root', '/p']);

    expect(before.error).toBeNull();
    expect(after.error).toBeNull();
    expect(before.globals).toEqual({
      json: false,
      nonInteractive: false,
      projectRoot: '/p',
      runId: 'r1',
    });
    expect(after.globals).toEqual(before.globals);
    expect([after.group, after.verb]).toEqual([before.group, before.verb]);

    const equals = parseArgv(['--run-id=r1', '--project-root=/p', 'implement', 'args']);
    expect(equals.globals).toEqual(before.globals);
  });

  test('unknown flag rejected', () => {
    const handler = jest.fn(() => ({ ok: true }));
    const ctx = makeCtx(fixtureRegistry({ args: { handler } }));
    const { envelope, exitCode } = main(['implement', 'args', '--no-such-flag'], ctx);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('UNKNOWN_FLAG');
    expect(envelope.error.message).toContain("--no-such-flag");
    expect(handler).not.toHaveBeenCalled();
  });

  test('describe can fail', () => {
    const ctx = makeCtx(fixtureRegistry({ resume: { outputSchema: {} } }));
    const { envelope, exitCode } = main(['--describe'], ctx);

    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.message).toContain('implement resume');
  });

  test('help is generated from the registry', () => {
    const registry = fixtureRegistry();
    const groupCtx = makeCtx(registry);
    const groupHelp = main(['implement', '--help'], groupCtx);
    expect(groupHelp.exitCode).toBe(0);
    expect(groupHelp.envelope).toBeNull();
    expect(groupCtx.stdout.text).toContain('implement args');
    expect(groupCtx.stdout.text).toContain('fixture verb implement args');

    const verbCtx = makeCtx(registry);
    const verbHelp = main(['implement', 'args', '--help'], verbCtx);
    expect(verbHelp.exitCode).toBe(0);
    expect(verbHelp.envelope).toBeNull();
    expect(verbCtx.stdout.text).toContain('fixture verb implement args');
    expect(verbCtx.stdout.text).toContain('--run-id');
  });

  test('a handler error with an unknown status is contained as INTERNAL', () => {
    // `status = 404` is not one of the engine's seven statuses. Passing it on would make
    // `buildEnvelope` throw inside the catch block, and the run would answer with no envelope
    // and no exit code at all.
    const boom = new Error('handler blew up');
    boom.status = 404;
    const ctx = makeCtx(
      fixtureRegistry({
        args: {
          handler: () => {
            throw boom;
          },
        },
      })
    );
    const { envelope, exitCode } = main(['implement', 'args'], ctx);

    expect(exitCode).toBe(6);
    expect(envelope.ok).toBe(false);
    expect(envelope.status).toBe('INTERNAL');
    expect(envelope.error.message).toBe('handler blew up');
  });

  test('a handler error with a tabled status keeps that status', () => {
    const refused = new Error('not now');
    refused.status = 'REFUSED';
    refused.code = 'NOT_NOW';
    const ctx = makeCtx(
      fixtureRegistry({
        args: {
          handler: () => {
            throw refused;
          },
        },
      })
    );
    const { envelope, exitCode } = main(['implement', 'args'], ctx);

    expect(exitCode).toBe(1);
    expect(envelope.ok).toBe(false);
    expect(envelope.status).toBe('REFUSED');
    expect(envelope.error.code).toBe('NOT_NOW');
    expect(envelope.error.message).toBe('not now');
  });
});
