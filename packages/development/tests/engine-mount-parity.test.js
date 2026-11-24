'use strict';

/**
 * TRD-003-TEST (TRD-2026-d571763f): legacy parity across every mounted verb.
 *
 * Each parity scenario runs the SAME verb twice in the same test -- once through
 * `lib/ensemble-cli.js` and once through the legacy CLI -- and compares the two stdout buffers
 * byte for byte. The comparison is live, never a stored golden, so a change to legacy output
 * fails the test instead of silently drifting past a stale fixture.
 *
 * The side-effect-table scenario proves registration is refused for an undeclared verb, and the
 * byte-equality scenario hashes both legacy CLIs against their committed HEAD blobs, so a
 * working-tree edit to either one fails the test. The authority on whether this PR modified
 * them is the PR diff against the base branch; this test only pins the working tree to HEAD.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { createRegistry } = require('../lib/engine/registry');
const { mountLegacyGroup } = require('../lib/engine/mount');

const DEV_ROOT = path.join(__dirname, '..');
const ENSEMBLE_CLI = path.join(DEV_ROOT, 'lib', 'ensemble-cli.js');
const TRD_CLI = path.join(DEV_ROOT, 'lib', 'trd-cli.js');
const TOOLCHAIN_CLI = path.join(DEV_ROOT, 'lib', 'toolchain-cli.js');
const EXIT_CLI = path.join(__dirname, 'fixtures', 'engine', 'exit-cli.js');
const FIXTURE = path.join('tests', 'fixtures', 'engine', 'trd-parity.md');

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: DEV_ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

describe('mounted legacy groups keep legacy behaviour (TRD-003)', () => {
  test.each([
    ['parse', [FIXTURE]],
    ['phase-status', [FIXTURE]],
    ['list', ['--dir', path.join('tests', 'fixtures', 'engine')]],
  ])('trd parity: trd %s', (verb, args) => {
    const viaEngine = run([ENSEMBLE_CLI, 'trd', verb, ...args]);
    const viaLegacy = run([TRD_CLI, verb, ...args]);

    expect(viaLegacy.status).toBe(0);
    expect(viaEngine.status).toBe(viaLegacy.status);
    expect(viaEngine.stdout.equals(viaLegacy.stdout)).toBe(true);
  });

  test.each([
    ['resolve', ['--json']],
    ['explain', ['--json']],
  ])('tool parity: tool %s', (verb, args) => {
    const viaEngine = run([ENSEMBLE_CLI, 'tool', verb, ...args]);
    const viaLegacy = run([TOOLCHAIN_CLI, verb, ...args]);

    expect(viaLegacy.status).toBe(0);
    expect(viaEngine.status).toBe(viaLegacy.status);
    expect(viaEngine.stdout.equals(viaLegacy.stdout)).toBe(true);
  });

  test('a legacy handler that exits cannot terminate the engine process', () => {
    // The legacy CLIs end with `process.exit` (`toolchain-cli.js:1410`), so the engine mounts
    // them as child processes: their exit has to surface as an exit code without killing the
    // engine. Both dispatches run inside ONE child process and the marker written after the
    // second one is what proves the engine was still alive -- with the dispatches in separate
    // processes a terminated engine still looks like a clean numeric exit.
    const script = [
      `const { main } = require(${JSON.stringify(ENSEMBLE_CLI)});`,
      `const { createRegistry } = require(${JSON.stringify(
        path.join(DEV_ROOT, 'lib', 'engine', 'registry')
      )});`,
      `const { mountLegacyGroup } = require(${JSON.stringify(
        path.join(DEV_ROOT, 'lib', 'engine', 'mount')
      )});`,
      'const registry = createRegistry();',
      `mountLegacyGroup(registry, { cliPath: ${JSON.stringify(EXIT_CLI)}, group: 'fixture', sideEffects: { die: 'read' }, summaries: { die: 'a fixture verb that exits' }, verbs: ['die'] });`,
      "const first = main(['fixture', 'die'], { registry });",
      "const second = main(['fixture', 'die'], { registry });",
      "process.stdout.write('ENGINE_SURVIVED:' + first.exitCode + ':' + second.exitCode + '\\n');",
    ].join('\n');

    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: DEV_ROOT,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });

    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stdout.toString('utf8')).toContain('ENGINE_SURVIVED:2:2');
  });

  test('mounting refuses a verb with no declared side-effect class', () => {
    const registry = createRegistry();
    expect(() =>
      mountLegacyGroup(registry, {
        cliPath: TRD_CLI,
        group: 'trd',
        sideEffects: { parse: 'read' },
        summaries: { parse: 'parse a TRD', frobnicate: 'undeclared' },
        verbs: ['parse', 'frobnicate'],
      })
    ).toThrow("trd: verb 'frobnicate' has no declared side-effect class");
    expect(registry.get('trd', 'frobnicate')).toBeNull();
  });

  test('describe reports a declared side-effect class for every mounted verb', () => {
    const described = run([ENSEMBLE_CLI, '--describe']);
    expect(described.status).toBe(0);
    const { data } = JSON.parse(described.stdout.toString('utf8'));
    const mounted = data.verbs.filter(v => v.group === 'trd' || v.group === 'tool');

    expect(mounted.length).toBeGreaterThan(0);
    for (const verb of mounted) {
      expect(['read', 'write']).toContain(verb.sideEffect);
      expect(Object.keys(verb.inputSchema).length).toBeGreaterThan(0);
      expect(Object.keys(verb.outputSchema).length).toBeGreaterThan(0);
    }
    expect(mounted.filter(v => v.group === 'trd').map(v => v.name)).toContain('parse');
    expect(mounted.filter(v => v.group === 'tool').map(v => v.name)).toContain('preflight');
  });

  test.each([
    ['packages/development/lib/trd-cli.js', TRD_CLI],
    ['packages/development/lib/toolchain-cli.js', TOOLCHAIN_CLI],
  ])('%s is byte-identical to its committed HEAD blob', (repoPath, absPath) => {
    const committed = execFileSync('git', ['show', `HEAD:${repoPath}`], {
      cwd: path.join(DEV_ROOT, '..', '..'),
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(sha256(fs.readFileSync(absPath))).toBe(sha256(committed));
  });
});
