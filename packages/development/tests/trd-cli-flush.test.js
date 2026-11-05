'use strict';

/**
 * REGRESSION (beads:ensemble:br-bhj9): `trd-cli.js parse <large TRD> | consumer` truncated
 * stdout at exactly 65536 bytes.
 *
 * The CLI wrapper used to end in `process.exit(code)`. When stdout is a pipe, Node writes it
 * asynchronously, so anything past the 64 KiB pipe buffer was still in flight when the process
 * was terminated: the consumer received JSON cut at position 65536 and failed to parse it, while
 * the same command redirected to a file produced the complete object. Repository TRDs parse to
 * well over that (~84 KB of JSON), so any pipe consumer of `parse`/`scaffold-plan` broke.
 *
 * The fix assigns `process.exitCode` instead of calling `process.exit`, which lets the event loop
 * drain stdout before the process exits. Same exit codes, no truncation.
 *
 * WHY A SHELL PIPELINE WITH A LATE READER IS THE PROBE. `spawnSync(...).stdout` is NOT a pipe test:
 * Node gives that child a socketpair, whose buffer is larger than this fixture's output on Linux, so
 * the unfixed CLI is not truncated there and the assertions would pass without the fix. The output
 * tests therefore run `node CLI ... | (sleep 0.5; cat)` through `/bin/sh`: a real OS pipe whose
 * reader starts late, so the unfixed CLI's queued bytes are still in flight when it force-exits.
 * Checked against the pre-fix CLI on macOS and Linux: 65536 bytes before the fix, 124742 after.
 *
 * WHY EXIT CODES ARE NOT READ THROUGH THAT PIPELINE: a pipeline's status is the reader's (`cat`'s),
 * so a status assertion on it could never go red. Exit codes are asserted on `res.status` of a
 * direct `spawnSync('node', [CLI, ...])` (`runDirect`).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'lib', 'trd-cli.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'TRD-2026-999-stdout-flush.md');

// Node's libuv pipe capacity: the exact byte count the bug truncated output to.
const PIPE_BUFFER_BYTES = 65536;

/** Slug derived from the fixture filename (basename, slugified) — see `deriveSlug`. */
const FIXTURE_SLUG = 'trd-2026-999-stdout-flush';

/**
 * Run the real CLI with stdout on a real OS pipe whose reader starts late, returning the bytes the
 * reader received. `status` is the reader's, not the CLI's; use `runDirect` for exit codes.
 *
 * @param {string[]} cliArgs
 * @returns {{ stdout: string, bytes: number, status: number | null }}
 */
function runThroughPipe(cliArgs) {
  const res = spawnSync('/bin/sh', ['-c', 'node "$0" "$@" | (sleep 0.5; cat)', CLI, ...cliArgs], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60000,
  });
  if (res.error) {
    throw res.error;
  }
  return { stdout: res.stdout, bytes: Buffer.byteLength(res.stdout), status: res.status };
}

/**
 * Run the real CLI directly (stdout captured by Node), for the child's own exit status and its
 * small outputs. Not a pipe test: see the header.
 *
 * @param {string[]} cliArgs
 * @returns {{ stdout: string, bytes: number, status: number | null }}
 */
function runDirect(cliArgs) {
  const res = spawnSync('node', [CLI, ...cliArgs], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
  if (res.error) {
    throw res.error;
  }
  return { stdout: res.stdout, bytes: Buffer.byteLength(res.stdout), status: res.status };
}

/** Same run with stdout redirected to a file — the path the bug never affected. */
function runThroughRedirect(cliArgs) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'trd-cli-flush-'));
  const file = path.join(dir, 'out.json');
  try {
    const res = spawnSync('/bin/sh', ['-c', `node ${[CLI, ...cliArgs].map((a) => `'${a}'`).join(' ')} > '${file}'`]);
    const stdout = fs.readFileSync(file, 'utf8');
    return { stdout, bytes: Buffer.byteLength(stdout), status: res.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('fixture guard: the fixture must stay large enough to expose the bug', () => {
  test('`parse` on the fixture exceeds the 65536-byte pipe buffer when redirected to a file', () => {
    const res = runThroughRedirect(['parse', FIXTURE]);
    expect(res.status).toBe(0);
    expect(res.bytes).toBeGreaterThan(PIPE_BUFFER_BYTES);
    // A genuine parse of a real TRD, not an error object padded out with prose.
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(Object.keys(parsed.trd.tasksById).length).toBeGreaterThan(0);
  });

  test('`scaffold-plan` on the fixture also exceeds the pipe buffer when redirected', () => {
    const res = runThroughRedirect(['scaffold-plan', FIXTURE]);
    expect(res.bytes).toBeGreaterThan(PIPE_BUFFER_BYTES);
    expect(JSON.parse(res.stdout).ok).toBe(true);
  });
});

describe('regression: piped stdout is not truncated at 65536 bytes', () => {
  test('`parse` through a pipe yields complete, valid JSON (was cut at exactly 65536)', () => {
    const res = runThroughPipe(['parse', FIXTURE]);
    expect(res.bytes).toBeGreaterThan(PIPE_BUFFER_BYTES);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    expect(JSON.parse(res.stdout).trd.slug).toBe(FIXTURE_SLUG);
  });

  test('`scaffold-plan` through a pipe yields complete, valid JSON', () => {
    const res = runThroughPipe(['scaffold-plan', FIXTURE]);
    expect(res.bytes).toBeGreaterThan(PIPE_BUFFER_BYTES);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
  });

  test('piping and redirecting produce byte-identical output', () => {
    const piped = runThroughPipe(['parse', FIXTURE]);
    const redirected = runThroughRedirect(['parse', FIXTURE]);
    expect(piped.bytes).toBe(redirected.bytes);
    expect(piped.stdout).toBe(redirected.stdout);
  });

  test('every task parsed from the fixture survives the pipe (none silently dropped)', () => {
    const piped = JSON.parse(runThroughPipe(['parse', FIXTURE]).stdout);
    const redirected = JSON.parse(runThroughRedirect(['parse', FIXTURE]).stdout);
    expect(Object.keys(piped.trd.tasksById).sort()).toEqual(
      Object.keys(redirected.trd.tasksById).sort()
    );
  });

  test('the truncated form is not what a consumer sees (guards the exact bug signature)', () => {
    const res = runThroughPipe(['parse', FIXTURE]);
    expect(res.bytes).not.toBe(PIPE_BUFFER_BYTES);
  });
});

describe('exit-code contract still holds after replacing process.exit with process.exitCode', () => {
  test('happy path exits 0', () => {
    expect(runDirect(['parse', FIXTURE]).status).toBe(0);
  });

  test('bad path exits 1 and still emits exactly one JSON {error}', () => {
    const res = runDirect(['parse', '/no/such/file-xyz.md']);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).error).toMatch(/Cannot read/);
  });

  test('unknown subcommand exits 1', () => {
    const res = runDirect(['frobnicate', FIXTURE]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).error).toMatch(/Unknown subcommand/);
  });

  test('missing subcommand exits 1', () => {
    const res = runDirect([]);
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).error).toMatch(/Missing subcommand/);
  });

  test('the non-zero path is not truncated either (error JSON survives a pipe)', () => {
    const res = runThroughPipe(['parse', '/no/such/file-xyz.md']);
    expect(res.bytes).toBeLessThan(PIPE_BUFFER_BYTES);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
  });
});

describe('vendored copy parity (Generated Artifact Policy)', () => {
  test('packages/pi/vendor/lib/trd-cli.js carries the same exit path as the source', () => {
    const vendored = path.join(__dirname, '..', '..', 'pi', 'vendor', 'lib', 'trd-cli.js');
    if (!fs.existsSync(vendored)) {
      return; // bundle not generated in this checkout
    }
    const src = fs.readFileSync(CLI, 'utf8');
    const dst = fs.readFileSync(vendored, 'utf8');
    const srcExit = /process\.exitCode = main\(/.test(src);
    expect(srcExit).toBe(true);
    expect(/process\.exitCode = main\(/.test(dst)).toBe(srcExit);
    expect(src).toBe(dst);
  });
});
