'use strict';
/**
 * Per-adapter status overrides (Jira tracker adapter, reporter finding F5).
 *
 * The Jira adapter's own `statusMap` names only Jira's 7 default workflow statuses, so an
 * issue sitting in any other status of a customised workflow (e.g. "Code Review") made
 * `tracker.show` fail `BAD_OUTPUT` ("status value ... has no entry in parse.statusMap"), and
 * `tracker.set-status` always wrote Jira's default names ("To Do"/"In Progress"/"Done"),
 * which a custom workflow may not even have.
 *
 * A repo now extends that vocabulary from its OWN `.ensemble/toolchain.yaml`, without
 * duplicating the whole adapter:
 *
 *   adapters:
 *     jira:
 *       statusMap:            # provider status name -> normalized status (reading)
 *         "Code Review": in_progress
 *       statusNames:          # normalized status -> provider status name (writing)
 *         open: Backlog
 *
 * These tests drive the real adapter manifest through the real runner (`runCapability`)
 * against a stub `jira` binary, so they prove the WHOLE path (config -> argv -> mapping),
 * not just one helper.
 */

const fs = require('fs');
const path = require('path');
const { loadAdapter } = require('../lib/toolchain/adapters');
const { runCapability } = require('../lib/toolchain/runner');
const { resolveAdapterOverrides } = require('../lib/toolchain/config');
const { rewriteStatusArg } = require('../lib/toolchain/status-overrides');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRATCH_PARENT = path.join(process.env.HOME || '/root', '.omp', 'ensemble-pdf-f45-r5', 'jest');
const scratchDirs = [];

function mkScratch(prefix) {
  fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_PARENT, prefix));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A stub `jira` binary: records the argv it was spawned with into `argv.json` next to
 * itself and answers with one flat issue object. `control.json` (same directory) selects
 * the status it reports, so one stub serves every case.
 */
function writeStubJira(dir, issueStatus) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'control.json'), JSON.stringify({ issueStatus }));
  const bin = path.join(dir, 'jira');
  fs.writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      "const fs = require('fs');",
      "const path = require('path');",
      'const args = process.argv.slice(2);',
      "fs.writeFileSync(path.join(__dirname, 'argv.json'), JSON.stringify(args));",
      "const control = JSON.parse(fs.readFileSync(path.join(__dirname, 'control.json'), 'utf8'));",
      "const statusIndex = args.indexOf('--status');",
      'const status = statusIndex >= 0 ? args[statusIndex + 1] : control.issueStatus;',
      'process.stdout.write(JSON.stringify({',
      "  key: 'VA-1',",
      "  summary: 'Stub summary',",
      "  description: 'Stub description',",
      "  issueType: 'Bug',",
      '  status,',
      "  priority: 'High',",
      "  labels: ['backend']",
      '}));',
      ''
    ].join('\n')
  );
  fs.chmodSync(bin, 0o755);
  return bin;
}

/** A project root whose `.ensemble/toolchain.yaml` carries the given YAML text. */
function projectWith(toolchainYaml) {
  const root = mkScratch('proj-');
  fs.mkdirSync(path.join(root, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ensemble', 'toolchain.yaml'), toolchainYaml);
  return root;
}

function stubEnv(root, binDir) {
  return {
    projectRoot: root,
    timeoutMs: 10000,
    parentEnv: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  };
}

function spawnedArgv(binDir) {
  return JSON.parse(fs.readFileSync(path.join(binDir, 'argv.json'), 'utf8'));
}

function statusArgValue(binDir) {
  const argv = spawnedArgv(binDir);
  const index = argv.indexOf('--status');
  return index === -1 ? null : argv[index + 1];
}

const MANIFEST = loadAdapter('jira', { projectRoot: REPO_ROOT }).manifest;

describe('per-adapter status overrides: reading (statusMap)', () => {
  test('tracker.show maps a status outside the adapter default table once the repo extends the map', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'Code Review');
    const root = projectWith(
      [
        'tracker: jira',
        'adapters:',
        '  jira:',
        '    statusMap:',
        '      Code Review: in_progress',
        ''
      ].join('\n')
    );

    const result = await runCapability(
      MANIFEST,
      'tracker.show',
      { id: 'VA-1' },
      stubEnv(root, binDir)
    );

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('in_progress');
    expect(result.data.id).toBe('VA-1');
  });

  test('a status the adapter default table does not name still fails loudly, naming the config key to set', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'Blocked (unrecognized)');
    const root = projectWith(['tracker: jira', ''].join('\n'));

    const result = await runCapability(
      MANIFEST,
      'tracker.show',
      { id: 'VA-1' },
      stubEnv(root, binDir)
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('BAD_OUTPUT');
    expect(result.error.message).toContain('adapters.jira.statusMap');
  });
});

describe('per-adapter status overrides: writing (statusNames)', () => {
  test('tracker.set-status writes the provider status name the repo configured', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'Backlog');
    const root = projectWith(
      [
        'tracker: jira',
        'adapters:',
        '  jira:',
        '    statusMap:',
        '      Backlog: open',
        '    statusNames:',
        '      open: Backlog',
        ''
      ].join('\n')
    );

    const result = await runCapability(
      MANIFEST,
      'tracker.set-status',
      { id: 'VA-1', status: 'open' },
      stubEnv(root, binDir)
    );

    expect(result.ok).toBe(true);
    expect(statusArgValue(binDir)).toBe('Backlog');
    expect(result.data.status).toBe('open');
  });

  test('tracker.close writes the overridden closed-status name', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'Resolved');
    const root = projectWith(
      [
        'tracker: jira',
        'adapters:',
        '  jira:',
        '    statusMap:',
        '      Resolved: closed',
        '    statusNames:',
        '      closed: Resolved',
        ''
      ].join('\n')
    );

    const result = await runCapability(MANIFEST, 'tracker.close', { id: 'VA-1' }, stubEnv(root, binDir));

    expect(result.ok).toBe(true);
    expect(statusArgValue(binDir)).toBe('Resolved');
  });
});

describe('per-adapter status overrides: the rewrite touches the --status value only', () => {
  const INDEX = { 'To Do': 'open', Done: 'closed' };
  const NAMES = { open: 'Backlog', closed: 'Resolved' };

  test('only the value after --status is replaced, other argument values keep their text', () => {
    const argv = ['jira', 'issues', 'update', 'VA-1', '--summary', 'Done', '--status', 'Done'];
    expect(rewriteStatusArg(argv, INDEX, NAMES)).toEqual([
      'jira',
      'issues',
      'update',
      'VA-1',
      '--summary',
      'Done',
      '--status',
      'Resolved'
    ]);
  });

  test('the inline --status=VALUE spelling is rewritten as well', () => {
    expect(rewriteStatusArg(['jira', 'issues', 'update', 'VA-1', '--status=To Do'], INDEX, NAMES)).toEqual([
      'jira',
      'issues',
      'update',
      'VA-1',
      '--status=Backlog'
    ]);
  });

  test('a status value that is in no known vocabulary is passed through unchanged', () => {
    const argv = ['jira', 'issues', 'update', 'VA-1', '--status', 'QA Testing'];
    expect(rewriteStatusArg(argv, INDEX, NAMES)).toEqual(argv);
  });

  test('no write-side name configured means the provider default name is kept, never a blank value', () => {
    const argv = ['jira', 'issues', 'update', 'VA-1', '--status', 'Done'];
    expect(rewriteStatusArg(argv, INDEX, { open: 'Backlog' })).toEqual(argv);
  });

  test('tracker.close keeps the adapter default Done when the repo configures no closed-status name', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'Done');
    const root = projectWith(
      ['tracker: jira', 'adapters:', '  jira:', '    statusMap:', '      Code Review: in_progress', ''].join('\n')
    );

    const result = await runCapability(MANIFEST, 'tracker.close', { id: 'VA-1' }, stubEnv(root, binDir));

    expect(result.ok).toBe(true);
    expect(statusArgValue(binDir)).toBe('Done');
  });
});

describe('per-adapter status overrides: defaults are unchanged without an override', () => {
  test('the adapter default status table still normalizes the 7 default Jira statuses', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'In Review');
    const root = projectWith(['tracker: jira', ''].join('\n'));

    const result = await runCapability(
      MANIFEST,
      'tracker.show',
      { id: 'VA-1' },
      stubEnv(root, binDir)
    );

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('in_progress');
  });

  test('tracker.set-status still writes the adapter default provider names', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'To Do');
    const root = projectWith(['tracker: jira', ''].join('\n'));

    const result = await runCapability(
      MANIFEST,
      'tracker.set-status',
      { id: 'VA-1', status: 'open' },
      stubEnv(root, binDir)
    );

    expect(result.ok).toBe(true);
    expect(statusArgValue(binDir)).toBe('To Do');
    expect(result.data.status).toBe('open');
  });

  test('resolveAdapterOverrides reports no override when the project config has none', () => {
    const root = projectWith(['tracker: jira', ''].join('\n'));
    expect(resolveAdapterOverrides('jira', { projectRoot: root })).toEqual({
      statusMap: {},
      statusNames: {}
    });
  });
});

describe('per-adapter status overrides: every tracker call path carries the project root', () => {
  test('the work-graph builtin fallback forwards the project root to its tracker calls', async () => {
    // The Jira adapter declares no `work-graph` category, so the work-graph
    // capabilities resolve through the built-in fallback, which calls
    // `tracker.show` / `tracker.list` itself. Without the project root the runner
    // cannot find the repository's `.ensemble/toolchain.yaml`, so the overrides
    // would silently not apply on that path.
    const { dispatchWorkGraphCapability } = require('../lib/toolchain/work-graph-resolve');
    const calls = [];

    await dispatchWorkGraphCapability(
      { autoVia: 'builtin-fallback', manifest: { capabilities: {} }, trackerManifest: MANIFEST },
      'work-graph.ready',
      {},
      {
        source: 'project',
        cwd: '/some/project',
        timeouts: { short: 1000 },
        runBuiltinImpl: async (capability, trackerManifest, args, opts) => {
          calls.push(opts);
          return { ok: true, data: [] };
        }
      }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].execOpts.projectRoot).toBe('/some/project');
  });
});

describe('per-adapter status overrides: malformed override blocks are rejected', () => {
  test('a statusMap value outside the normalized status vocabulary fails schema validation', () => {
    const root = projectWith(
      [
        'tracker: jira',
        'adapters:',
        '  jira:',
        '    statusMap:',
        '      Code Review: not-a-status',
        ''
      ].join('\n')
    );

    expect(() => resolveAdapterOverrides('jira', { projectRoot: root })).toThrow(/statusMap/);
  });

  test('an unknown key inside an adapter override block fails schema validation', () => {
    const root = projectWith(
      ['tracker: jira', 'adapters:', '  jira:', '    statusMapp: {}', ''].join('\n')
    );

    expect(() => resolveAdapterOverrides('jira', { projectRoot: root })).toThrow(/statusMapp/);
  });

  test('a statusNames value that would read as a command-line flag fails schema validation', () => {
    const root = projectWith(
      ['tracker: jira', 'adapters:', '  jira:', '    statusNames:', '      open: "--summary"', ''].join('\n')
    );

    expect(() => resolveAdapterOverrides('jira', { projectRoot: root })).toThrow(/statusNames/);
  });

  test('a runner call with a malformed project config fails CONFIG_INVALID instead of spawning anything', async () => {
    const binDir = mkScratch('bin-');
    writeStubJira(binDir, 'To Do');
    const root = projectWith(
      [
        'tracker: jira',
        'adapters:',
        '  jira:',
        '    statusMap:',
        '      Code Review: not-a-status',
        ''
      ].join('\n')
    );

    const result = await runCapability(
      MANIFEST,
      'tracker.show',
      { id: 'VA-1' },
      stubEnv(root, binDir)
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('CONFIG_INVALID');
  });
});
