/**
 * beads-build-wave Step 1.3 runs `toolchain-cli preflight` (Step 1.2) and then HALTs when
 * `workflow.status` lists any changed path outside `.beads/`. The preflight record itself lives
 * under `.ensemble/state/toolchain/`, so in a repo with no `.gitignore` entry for it a faithful
 * run would halt on the toolchain's own file. These tests drive the real CLI against a scratch
 * git repo with NO `.gitignore` and assert the clean-tree check input is empty.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'packages', 'development', 'lib', 'toolchain-cli.js');
const { recordSideEffect, recordFailure } = require('../../packages/development/lib/toolchain/ledger');
const { createTracer } = require('../../packages/development/lib/run-trace');

const roots = [];
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-clean-tree-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return { root, git };
}
const cli = (root, args) =>
  JSON.parse(execFileSync('node', [CLI, ...args, '--json'], { cwd: root, encoding: 'utf8' }));

afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

describe('toolchain state under .ensemble/state/ never dirties the work tree', () => {
  test('preflight then workflow.status: files is empty in a repo without a .gitignore entry', () => {
    const { root, git } = makeRepo();
    const pre = cli(root, ['preflight', '--require', 'workflow.status']);
    expect(pre.ok).toBe(true);
    // The state file really was written (the test would be vacuous otherwise).
    expect(fs.readdirSync(path.join(root, '.ensemble', 'state', 'toolchain'))).toEqual(
      expect.arrayContaining([`preflight-${pre.runId}.json`])
    );
    const status = cli(root, ['run', 'workflow.status', '--run-id', pre.runId]);
    expect(status.ok).toBe(true);
    expect(status.data.files).toEqual([]);
    expect(git('status', '--porcelain')).toBe('');
  });

  test('ledger, failure record and trace writers are ignored too, and real changes still show', () => {
    const { root, git } = makeRepo();
    recordSideEffect('run-1', { capability: 'x' }, { projectRoot: root });
    recordFailure('run-1', { adapter: 'a', capability: 'x', error: 'e' }, { projectRoot: root, env: {} });
    const tracer = createTracer({ runId: 'run-1', projectRoot: root });
    tracer.startSpan('noop');
    expect(fs.existsSync(tracer.path)).toBe(true);
    expect(git('status', '--porcelain')).toBe('');
    fs.writeFileSync(path.join(root, 'real.txt'), 'x');
    expect(git('status', '--porcelain')).toBe('?? real.txt\n');
  });

  test('an existing .ensemble/state/.gitignore is left alone', () => {
    const { root } = makeRepo();
    const dir = path.join(root, '.ensemble', 'state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'custom\n');
    recordSideEffect('run-1', { capability: 'x' }, { projectRoot: root });
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('custom\n');
  });
});
