'use strict';

/**
 * TRD-001-TEST (TRD-2026-d571763f): the engine's envelope, exit-code and input-validation
 * boundary.
 *
 * The boundary is exercised directly -- `buildEnvelope`/`emit`/`exitCodeFor` from
 * `lib/engine/envelope.js` and `readStdinCapped`/`parseInput`/`resolveCallerPath` from
 * `lib/engine/validate.js` -- through the small in-test driver `runFixtureVerb` below. The
 * driver stands in for the real dispatcher deliberately: TRD-002's `lib/ensemble-cli.js` does
 * not exist yet at this task, and the protocol these scenarios pin (one object on stdout,
 * diagnostics on stderr, status-to-exit-code mapping, refusal before parsing) is owned by the
 * two modules under test, not by the dispatcher.
 *
 * Fixture trees live under `os.tmpdir()` and are removed in `finally` (the convention of
 * `tests/toolchain-cli-project-root.test.js`); none holds work that must survive a reboot.
 * They are `fs.realpathSync`'d because macOS resolves `/var` to `/private/var`, and
 * `resolveCallerPath` compares real paths.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const {
  STATUS_EXIT,
  buildEnvelope,
  emit,
  exitCodeFor,
  internal,
  invalidInput,
} = require('../lib/engine/envelope');
const {
  MAX_STDIN_BYTES,
  parseInput,
  readStdinCapped,
  resolveCallerPath,
} = require('../lib/engine/validate');

/** A collecting stream stand-in: records every write so stdout and stderr stay separable. */
function collector() {
  const chunks = [];
  return {
    chunks,
    write(text) {
      chunks.push(String(text));
      return true;
    },
    get text() {
      return chunks.join('');
    },
  };
}

function makeStreams() {
  return { stdout: collector(), stderr: collector() };
}

/**
 * Minimal in-process verb driver: run a handler, turn its result or its throw into exactly one
 * envelope on stdout, and return the exit code for that envelope's status.
 */
function runFixtureVerb(verb, handler, streams) {
  let envelope;
  try {
    const data = handler(streams);
    envelope = buildEnvelope({ ok: true, status: 'OK', verb, data });
  } catch (err) {
    envelope =
      err && err.status === 'INVALID_INPUT'
        ? invalidInput(verb, err.code, err.message, null)
        : internal(verb, err, streams);
  }
  emit(envelope, streams);
  return exitCodeFor(envelope.status);
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: { resultFile: { type: 'string' } },
  additionalProperties: false,
};

function makeRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-envelope-')));
}

describe('engine envelope and validation boundary (TRD-001)', () => {
  test('one object on stdout', () => {
    const streams = makeStreams();
    const exitCode = runFixtureVerb(
      'fixture noisy',
      s => {
        s.stderr.write('warning: the fixture verb is chatty\n');
        return { value: 1 };
      },
      streams
    );

    expect(exitCode).toBe(0);
    const stdout = streams.stdout.text;
    expect(stdout.endsWith('\n')).toBe(true);
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({
      data: { value: 1 },
      next: null,
      ok: true,
      status: 'OK',
      verb: 'fixture noisy',
    });
    expect(Object.keys(parsed)).toEqual(['data', 'next', 'ok', 'status', 'verb']);
    expect(stdout).not.toContain('warning:');
    expect(streams.stderr.text).toContain('warning: the fixture verb is chatty');
  });

  test('exit codes match statuses', () => {
    const statuses = [
      'OK',
      'REFUSED',
      'INVALID_INPUT',
      'NEEDS_AGENT',
      'NEEDS_CHOICE',
      'UNAVAILABLE',
      'INTERNAL',
    ];
    const codes = statuses.map(status =>
      exitCodeFor(buildEnvelope({ ok: status === 'OK', status, verb: 'fixture status' }).status)
    );

    expect(codes).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Object.keys(STATUS_EXIT).sort()).toEqual(statuses.slice().sort());
    expect(() => exitCodeFor('MADE_UP')).toThrow(/MADE_UP/);
  });

  test('schema violation named', () => {
    const streams = makeStreams();
    const exitCode = runFixtureVerb(
      'fixture parse',
      () => parseInput('{"nope":1}', RESULT_SCHEMA),
      streams
    );

    expect(exitCode).toBe(2);
    const parsed = JSON.parse(streams.stdout.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe('INVALID_INPUT');
    expect(parsed.error.message).toContain('nope');
  });

  test('oversize stdin refused', async () => {
    const oversize = Buffer.alloc(5 * 1024 * 1024, 0x61);
    expect(oversize.length).toBeGreaterThan(MAX_STDIN_BYTES);
    const stream = Readable.from([oversize]);
    const spy = jest.spyOn(JSON, 'parse');

    try {
      await expect(readStdinCapped(stream)).rejects.toMatchObject({
        code: 'INPUT_TOO_LARGE',
        status: 'INVALID_INPUT',
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('path escape refused', () => {
    const root = makeRoot();
    try {
      fs.mkdirSync(path.join(root, '.ensemble', 'state'), { recursive: true });

      expect(resolveCallerPath(root, 'out/result.json')).toBe(path.join(root, 'out/result.json'));
      expect(resolveCallerPath(root, '.ensemble/state/result.json')).toBe(
        path.join(root, '.ensemble', 'state', 'result.json')
      );

      let thrown = null;
      try {
        resolveCallerPath(root, '../../etc/passwd');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).not.toBeNull();
      expect(thrown.code).toBe('PATH_ESCAPE');
      expect(thrown.status).toBe('INVALID_INPUT');

      const streams = makeStreams();
      const argv = ['--result-file', '../../etc/passwd'];
      const exitCode = runFixtureVerb(
        'fixture write',
        () => ({ resultFile: resolveCallerPath(root, argv[argv.indexOf('--result-file') + 1]) }),
        streams
      );

      expect(exitCode).toBe(2);
      const parsed = JSON.parse(streams.stdout.text);
      expect(parsed.status).toBe('INVALID_INPUT');
      expect(parsed.error.code).toBe('PATH_ESCAPE');
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  test('internal error contained', () => {
    const streams = makeStreams();
    const exitCode = runFixtureVerb(
      'fixture boom',
      () => {
        throw new Error('boom');
      },
      streams
    );

    expect(exitCode).toBe(6);
    const stdout = streams.stdout.text;
    expect(stdout).not.toMatch(/\bat \S+:\d+/);
    expect(stdout).not.toContain('engine-envelope.test.js');
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe('INTERNAL');
    expect(parsed.error.message).toBe('boom');
    expect(parsed.error).not.toHaveProperty('stack');
    expect(streams.stderr.text).toMatch(/\bat \S+/);
  });

  test('token-shaped output redacted', () => {
    const streams = makeStreams();
    const token = `ghp_${'a1b2c3d4e5'.repeat(3)}`;
    const exitCode = runFixtureVerb('fixture secret', () => ({ note: `token ${token}` }), streams);

    expect(exitCode).toBe(0);
    const stdout = streams.stdout.text;
    expect(stdout).not.toContain(token);
    expect(JSON.parse(stdout).data.note).toBe('token [REDACTED:github-token]');
  });

  test('an own constructor key does not stop redaction', () => {
    // An own `constructor` key shadows the inherited one, so a plain `value.constructor === Object`
    // test would treat this payload as foreign and leave its strings unredacted.
    const streams = makeStreams();
    const token = `ghp_${'a1b2c3d4e5'.repeat(3)}`;
    const payload = JSON.parse(`{"constructor":null,"note":"token ${token}"}`);
    const exitCode = runFixtureVerb('fixture secret', () => payload, streams);

    expect(exitCode).toBe(0);
    const stdout = streams.stdout.text;
    expect(stdout).not.toContain(token);
    expect(JSON.parse(stdout).data.note).toBe('token [REDACTED:github-token]');
  });

  test('a null-prototype record is redacted too', () => {
    // `JSON.stringify` emits the enumerable own properties of a null-prototype record, so
    // skipping it would put its strings on stdout unredacted.
    const streams = makeStreams();
    const token = `ghp_${'a1b2c3d4e5'.repeat(3)}`;
    const payload = Object.assign(Object.create(null), { note: `token ${token}` });
    const exitCode = runFixtureVerb('fixture secret', () => payload, streams);

    expect(exitCode).toBe(0);
    const stdout = streams.stdout.text;
    expect(stdout).not.toContain(token);
    expect(JSON.parse(stdout).data.note).toBe('token [REDACTED:github-token]');
  });

  test('a custom toJSON cannot smuggle an unredacted value out', () => {
    // A `toJSON` method decides the serialized form, and `JSON.stringify` calls it *after*
    // redaction has run. Unless the serialized form is materialized and redacted first, the
    // value it returns reaches stdout untouched.
    const streams = makeStreams();
    const token = `ghp_${'a1b2c3d4e5'.repeat(3)}`;
    const payload = { toJSON: () => ({ note: `token ${token}` }) };
    const exitCode = runFixtureVerb('fixture secret', () => payload, streams);

    expect(exitCode).toBe(0);
    const stdout = streams.stdout.text;
    expect(stdout).not.toContain(token);
    expect(JSON.parse(stdout).data.note).toBe('token [REDACTED:github-token]');
  });

  test('a stdin stream that closes before it ends is refused', async () => {
    // A stream destroyed before EOF emits `close` without `end` or `error`; nothing may settle
    // the promise on that event, or the call would hang forever.
    const stream = new Readable({ read() { this.destroy(); } });
    await expect(readStdinCapped(stream)).rejects.toMatchObject({
      code: 'INPUT_STREAM_CLOSED',
      status: 'INVALID_INPUT',
    });
  });

  test('a __proto__ field survives as an own data property', () => {
    // A plain assignment to `__proto__` replaces the prototype of the rebuilt object instead of
    // copying the field, so the supplied JSON would silently lose it.
    const streams = makeStreams();
    const payload = JSON.parse('{"__proto__":{"label":"example"},"value":1}');
    const exitCode = runFixtureVerb('fixture proto', () => payload, streams);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(streams.stdout.text);
    expect(Object.keys(parsed.data)).toEqual(['__proto__', 'value']);
    expect(parsed.data.__proto__).toEqual({ label: 'example' });
  });

  test('a dangling symlink out of the tree is refused', () => {
    // The link target does not exist, so `realpath` fails with ENOENT exactly as it does for a
    // plain absent file. Re-attaching the missing part to the nearest existing ancestor would
    // accept the link, and a later write would follow it out of the project root.
    const root = makeRoot();
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-outside-')));
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'out'));

      let thrown = null;
      try {
        resolveCallerPath(root, 'out');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).not.toBeNull();
      expect(thrown.code).toBe('PATH_ESCAPE');
      expect(thrown.status).toBe('INVALID_INPUT');
    } finally {
      fs.rmSync(outside, { force: true, recursive: true });
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  test('a genuinely absent in-project file stays valid', () => {
    const root = makeRoot();
    try {
      expect(resolveCallerPath(root, 'not-created-yet.txt')).toBe(
        path.join(root, 'not-created-yet.txt')
      );
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });
});
