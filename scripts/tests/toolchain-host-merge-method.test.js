'use strict';
/**
 * Tests for TRD-2026-8d825f54 PR 9 fix round, item 2: `host.change-request-merge`'s new
 * optional `method` input (squash|merge|rebase; default `squash`, preserving pre-existing
 * behavior) declared in `packages/development/toolchain/categories/host.yaml` and wired
 * through the manifest `variants` mechanism (`packages/development/lib/toolchain/
 * runner.js#selectTemplate`, TRD-010 -- the SAME mechanism `adapter-tracker-beads#tracker.set-
 * status` already uses, unchanged) in both shipped host adapters:
 *   - `adapter-host-github`: all three methods map to `gh pr merge`'s own three real,
 *     documented, mutually-exclusive flags (`--squash`/`--merge`/`--rebase`).
 *   - `adapter-host-azure-devops`: `az repos pr update` has NO merge-strategy flag at all
 *     (confirmed against its own `fixtures/az-repos-pr-help.txt`), so only `squash` is
 *     declared; `method: merge`/`method: rebase` fail closed with `NOT_ALLOWED`.
 *
 * Every "production" test here spawns the REAL, un-copied `packages/development/lib/
 * toolchain-cli.js` against real, stub `gh`/`az` binaries that log every argv they receive
 * (never a real `gh`/`az` install, none exists in this environment). The mutation-proof
 * section uses a small throwaway FIXTURE host adapter (never the real github/azure-devops
 * manifests) so "drop a variant" is a pure manifest-content comparison, plus
 * `makeMutantToolchainRoot`/`mutateAndRequire` (the shared convention this repo's other
 * mutation-restore proofs use, e.g. `toolchain-runner.test.js`) for an engine-level
 * "pass-through" proof against a REAL subprocess running the mutant copy's own
 * `toolchain-cli.js`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync, spawnSync } = require('child_process');

const {
  makeMutantToolchainRoot,
  mutateAndRequire
} = require('./fixtures/toolchain/mutant-toolchain-copy');

jest.setTimeout(30000);

const REPO_ROOT = path.join(__dirname, '..', '..');
const TOOLCHAIN_CLI = path.join(REPO_ROOT, 'packages', 'development', 'lib', 'toolchain-cli.js');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkTempDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

/** `PATH` containing ONLY the stub bin dir, node's own dir and `/usr/bin:/bin` -- NEVER the
 * real inherited `process.env.PATH` -- the same convention `tracker-swap-scenario.test.js`'s
 * own `buildPath` uses, so no real `gh`/`az` anywhere on the host's actual PATH is reachable. */
function buildStubPath(binDir) {
  return [binDir, path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
}

function installBinary(binDir, binName, source) {
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, binName);
  fs.writeFileSync(binPath, source, { mode: 0o755 });
}

function readCallsLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Every argv is logged (one JSON line) to `calls-<bin>.log`; `pr merge` always succeeds with
 * no structured output (matching `adapter-host-github#host.change-request-merge`'s own
 * documented no-`parse`-block choice); every other invocation (the two health checks) also
 * just succeeds. */
function ghStubSource() {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(path.join(__dirname, 'calls-gh.log'), JSON.stringify(argv) + '\\n');",
    "if (argv[0] === 'pr' && argv[1] === 'merge') {",
    "  process.stdout.write('\\u2713 Merged pull request #' + argv[2] + '\\n');",
    '}',
    'process.exit(0);'
  ].join('\n');
}

/** Every argv is logged. `repos pr update` (the merge capability's base/variant templates)
 * echoes back `[id, "completed"]` as the JSON array `host.change-request-merge`'s own
 * `parse.map`/`parse.statusMap` expects (`--query "[to_string(pullRequestId), status]"`'s real
 * shape); every other invocation (the four health checks) just succeeds with no output. */
function azStubSource() {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(path.join(__dirname, 'calls-az.log'), JSON.stringify(argv) + '\\n');",
    "const idIndex = argv.indexOf('--id');",
    "if (argv[0] === 'repos' && argv[1] === 'pr' && argv[2] === 'update') {",
    "  const id = idIndex === -1 ? '0' : argv[idIndex + 1];",
    "  process.stdout.write(JSON.stringify([id, 'completed']));",
    '}',
    'process.exit(0);'
  ].join('\n');
}

function writeToolchainConfig(dir, host) {
  fs.mkdirSync(path.join(dir, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ensemble', 'toolchain.yaml'), `host: ${host}\n`);
}

function runNode(cliPath, args, cwd, env) {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, env, encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    // some assertions below only need status/stdout/stderr
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** Preflight (writes a passing record) then run `host.change-request-merge`, exactly the
 * sequence `pr-merge.yaml`'s own Merge step documents. */
function preflightAndMerge(cliPath, projectRoot, env, mergeArgs) {
  const preflight = runNode(cliPath, ['preflight', '--require', 'host.change-request-merge', '--json'], projectRoot, env);
  if (preflight.status !== 0 || !preflight.json || !preflight.json.ok) {
    throw new Error(`preflight failed: ${JSON.stringify(preflight)}`);
  }
  const runId = preflight.json.runId;
  const merge = runNode(
    cliPath,
    ['run', 'host.change-request-merge', '--run-id', runId, ...mergeArgs, '--non-interactive', '--json'],
    projectRoot,
    env
  );
  return { preflight, merge };
}

describe('production: host.change-request-merge method variants against the REAL adapter-host-github manifest', () => {
  function setup() {
    const projectRoot = mkTempDir('toolchain-merge-method-gh-');
    writeToolchainConfig(projectRoot, 'github');
    const binDir = path.join(projectRoot, 'bin');
    installBinary(binDir, 'gh', ghStubSource());
    const env = { PATH: buildStubPath(binDir) };
    return { projectRoot, binDir, env };
  }

  test('an omitted method defaults to --squash (preserves pre-existing behavior)', () => {
    const { projectRoot, binDir, env } = setup();
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=190']);
    expect(merge.status).toBe(0);
    const calls = readCallsLog(path.join(binDir, 'calls-gh.log'));
    const mergeCall = calls.find((c) => c[0] === 'pr' && c[1] === 'merge');
    expect(mergeCall).toEqual(['pr', 'merge', '190', '--squash']);
  });

  test('method=squash explicitly produces the identical --squash argv', () => {
    const { projectRoot, binDir, env } = setup();
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=190', '--arg', 'method=squash']);
    expect(merge.status).toBe(0);
    const calls = readCallsLog(path.join(binDir, 'calls-gh.log'));
    const mergeCall = calls.find((c) => c[0] === 'pr' && c[1] === 'merge');
    expect(mergeCall).toEqual(['pr', 'merge', '190', '--squash']);
  });

  test('method=merge selects --merge', () => {
    const { projectRoot, binDir, env } = setup();
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=190', '--arg', 'method=merge']);
    expect(merge.status).toBe(0);
    const calls = readCallsLog(path.join(binDir, 'calls-gh.log'));
    const mergeCall = calls.find((c) => c[0] === 'pr' && c[1] === 'merge');
    expect(mergeCall).toEqual(['pr', 'merge', '190', '--merge']);
  });

  test('method=rebase selects --rebase', () => {
    const { projectRoot, binDir, env } = setup();
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=190', '--arg', 'method=rebase']);
    expect(merge.status).toBe(0);
    const calls = readCallsLog(path.join(binDir, 'calls-gh.log'));
    const mergeCall = calls.find((c) => c[0] === 'pr' && c[1] === 'merge');
    expect(mergeCall).toEqual(['pr', 'merge', '190', '--rebase']);
  });

  test('an unrecognized method fails closed with NOT_ALLOWED and never spawns gh pr merge at all', () => {
    const { projectRoot, binDir, env } = setup();
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=190', '--arg', 'method=fast-forward']);
    expect(merge.status).toBe(1);
    expect(merge.json.ok).toBe(false);
    expect(merge.json.error.code).toBe('NOT_ALLOWED');
    expect(merge.json.error.message).toContain('method');
    expect(merge.json.error.message).toContain('fast-forward');
    const calls = readCallsLog(path.join(binDir, 'calls-gh.log'));
    expect(calls.find((c) => c[0] === 'pr' && c[1] === 'merge')).toBeUndefined();
  });
});

describe('production: host.change-request-merge method variants against the REAL adapter-host-azure-devops manifest', () => {
  function setup() {
    const projectRoot = mkTempDir('toolchain-merge-method-az-');
    writeToolchainConfig(projectRoot, 'azure-devops');
    const binDir = path.join(projectRoot, 'bin');
    installBinary(binDir, 'az', azStubSource());
    const env = { PATH: buildStubPath(binDir) };
    return { projectRoot, binDir, env };
  }

  function updateCall(calls) {
    return calls.find((c) => c[0] === 'repos' && c[1] === 'pr' && c[2] === 'update');
  }

  test('an omitted method keeps the pre-existing --status completed argv (no merge-strategy flag exists on this CLI)', () => {
    const { projectRoot, binDir, env } = setup();
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=42']);
    expect(merge.status).toBe(0);
    const call = updateCall(readCallsLog(path.join(binDir, 'calls-az.log')));
    expect(call).toEqual([
      'repos', 'pr', 'update', '--id', '42', '--status', 'completed',
      '--query', '[to_string(pullRequestId), status]', '--output', 'json'
    ]);
    expect(merge.json.data).toEqual({ id: '42', state: 'closed' });
  });

  test('method=squash explicitly produces the identical argv (squash is the only declared variant)', () => {
    const { projectRoot, binDir, env } = setup();
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=42', '--arg', 'method=squash']);
    expect(merge.status).toBe(0);
    const call = updateCall(readCallsLog(path.join(binDir, 'calls-az.log')));
    expect(call).toEqual([
      'repos', 'pr', 'update', '--id', '42', '--status', 'completed',
      '--query', '[to_string(pullRequestId), status]', '--output', 'json'
    ]);
  });

  test.each(['merge', 'rebase'])(
    'method=%s fails closed with NOT_ALLOWED (az repos pr update has no such flag) and never spawns the update call',
    (method) => {
      const { projectRoot, binDir, env } = setup();
      const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=42', '--arg', `method=${method}`]);
      expect(merge.status).toBe(1);
      expect(merge.json.ok).toBe(false);
      expect(merge.json.error.code).toBe('NOT_ALLOWED');
      expect(merge.json.error.message).toContain('method');
      expect(merge.json.error.message).toContain(method);
      expect(updateCall(readCallsLog(path.join(binDir, 'calls-az.log')))).toBeUndefined();
    }
  );
});

// ---------------------------------------------------------------------------
// Mutation proofs. A small throwaway fixture host adapter -- never the real github/azure-
// devops manifests -- isolates these two proofs from any unrelated shipped-adapter detail.
// ---------------------------------------------------------------------------

function fixtureToolStubSource() {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(path.join(__dirname, 'calls-fixture-tool.log'), JSON.stringify(argv) + '\\n');",
    'process.exit(0);'
  ].join('\n');
}

function fixtureHostManifest(methodKeys) {
  const variants = {};
  if (methodKeys.includes('squash')) variants.squash = ['fixture-tool', 'merge', '${id}', '--squash'];
  if (methodKeys.includes('merge')) variants.merge = ['fixture-tool', 'merge', '${id}', '--merge'];
  return {
    adapter: 'host-merge-fixture',
    version: '1.0.0',
    categories: ['host'],
    contract: { host: '1.0' },
    binaries: ['fixture-tool'],
    allowlist: [{ bin: 'fixture-tool', sub: ['merge'] }],
    env: [],
    health: [],
    detect: [],
    capabilities: {
      'host.change-request-merge': {
        run: ['fixture-tool', 'merge', '${id}', '--squash'],
        variants: { method: variants }
      }
    }
  };
}

function writeFixtureHostAdapter(projectRoot, methodKeys) {
  const dir = path.join(projectRoot, 'packages', 'fixture-pkg', 'skills', 'host-merge-fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapter.yaml'), yaml.dump(fixtureHostManifest(methodKeys)));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Fixture Host Adapter\n');
}

describe('mutation proof: dropping a variant key actually discriminates (never a vacuous pass)', () => {
  function runFixture(methodKeys, mergeArgs) {
    const projectRoot = mkTempDir('toolchain-merge-method-mutant-variant-');
    writeToolchainConfig(projectRoot, 'host-merge-fixture');
    writeFixtureHostAdapter(projectRoot, methodKeys);
    const binDir = path.join(projectRoot, 'bin');
    installBinary(binDir, 'fixture-tool', fixtureToolStubSource());
    const env = { PATH: buildStubPath(binDir) };
    const { merge } = preflightAndMerge(TOOLCHAIN_CLI, projectRoot, env, ['--arg', 'id=1', ...mergeArgs]);
    const calls = readCallsLog(path.join(binDir, 'calls-fixture-tool.log'));
    return { merge, calls };
  }

  test('with BOTH squash and merge declared, method=merge succeeds and spawns --merge', () => {
    const { merge, calls } = runFixture(['squash', 'merge'], ['--arg', 'method=merge']);
    expect(merge.status).toBe(0);
    expect(calls[0]).toEqual(['merge', '1', '--merge']);
  });

  test('with ONLY squash declared (the merge variant dropped), the identical method=merge call fails NOT_ALLOWED and spawns nothing', () => {
    const { merge, calls } = runFixture(['squash'], ['--arg', 'method=merge']);
    expect(merge.status).toBe(1);
    expect(merge.json.ok).toBe(false);
    expect(merge.json.error.code).toBe('NOT_ALLOWED');
    expect(calls).toHaveLength(0);
  });
});

describe('mutation proof: an unmapped method value is never passed through as a literal argv element', () => {
  test('the REAL (unmutated) engine throws NOT_ALLOWED before spawning; a mutant with the NOT_ALLOWED guard removed instead substitutes the bogus value verbatim into the spawned argv', () => {
    const mutantRoot = makeMutantToolchainRoot();
    try {
      const projectRoot = mkTempDir('toolchain-merge-method-mutant-passthrough-');
      writeToolchainConfig(projectRoot, 'host-merge-fixture');
      writeFixtureHostAdapter(projectRoot, ['squash']);
      const binDir = path.join(projectRoot, 'bin');
      installBinary(binDir, 'fixture-tool', fixtureToolStubSource());
      const env = { PATH: buildStubPath(binDir) };

      // Baseline: the real (unmutated) engine, copied verbatim into the mutant root, still
      // rejects an unmapped method and spawns nothing.
      const baseline = preflightAndMerge(mutantRoot.cliPath, projectRoot, env, [
        '--arg', 'id=1', '--arg', 'method=fast-forward'
      ]);
      expect(baseline.merge.status).toBe(1);
      expect(baseline.merge.json.error.code).toBe('NOT_ALLOWED');
      expect(readCallsLog(path.join(binDir, 'calls-fixture-tool.log'))).toHaveLength(0);

      // Mutate: remove the variants NOT_ALLOWED guard inside selectTemplate so an unrecognized
      // value silently falls through to the selector arg's OWN raw value as a literal argv
      // element appended to the base template, instead of ever throwing.
      const needle = `    if (!Object.prototype.hasOwnProperty.call(variantMap, key)) {
      const error = new Error(
        \`\${selectorArgName}: '\${key}' is not an allowed variant (expected one of: \` +
          \`\${Object.keys(variantMap).join(', ')})\`
      );
      error.code = 'NOT_ALLOWED';
      throw error;
    }

    effectiveTemplate = variantMap[key];`;
      const replacement = `    effectiveTemplate = Object.prototype.hasOwnProperty.call(variantMap, key)
      ? variantMap[key]
      : [...runTemplate, key];`;
      mutateAndRequire(mutantRoot.runnerPath, needle, replacement);

      const mutated = preflightAndMerge(mutantRoot.cliPath, projectRoot, env, [
        '--arg', 'id=1', '--arg', 'method=fast-forward'
      ]);
      expect(mutated.merge.status).toBe(0);
      const calls = readCallsLog(path.join(binDir, 'calls-fixture-tool.log'));
      // With the guard removed, the bogus 'fast-forward' value is appended verbatim onto the
      // base template instead of being rejected -- exactly what the real (unmutated) baseline
      // above disproves.
      expect(calls[0]).toEqual(['merge', '1', '--squash', 'fast-forward']);
    } finally {
      mutantRoot.cleanup();
    }
  });
});
