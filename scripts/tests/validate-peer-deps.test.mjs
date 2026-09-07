// Tests for scripts/validate-peer-deps.js
//
// This predicate has been redesigned three times, each time because a reviewer's
// hand-built fixture found a case the previous version got wrong — and each time
// the fix introduced a different wrong case. These are those fixtures, captured.
//
// Black-box on purpose: the script is a CLI whose contract is an exit code, so the
// tests run it. The sibling lint-model-ids test copies its helpers into the test
// file and warns they "must stay in sync", which is a second thing to get wrong.
//
// Every expectation here was verified against real npm 10.9.2 before being written
// down. Where the guard and npm disagreed, npm won.
//
//   node --test scripts/tests/validate-peer-deps.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const GUARD = path.join(REPO, 'scripts/validate-peer-deps.js');

/** Build a throwaway workspace repo and run the guard in it. Returns {code, out}. */
function runGuard({ workspaces, consumer }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-deps-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] })
    );
    // The guard requires semver; borrow the repo's copy rather than installing.
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(GUARD, path.join(dir, 'scripts/validate-peer-deps.js'));

    for (const [name, pkg] of Object.entries(workspaces)) {
      const d = path.join(dir, 'packages', name);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pkg));
    }
    if (consumer) {
      const d = path.join(dir, 'packages', 'consumer');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(consumer));
    }
    try {
      const out = execFileSync('node', ['scripts/validate-peer-deps.js'], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (err) {
      return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const A = { a: { name: 'pkg-a', version: '1.0.0' } };
const dep = (deps) => ({ name: 'pkg-consumer', version: '1.0.0', dependencies: deps });

test('a stale range on a workspace fails — the defect this guard exists for', () => {
  const { code, out } = runGuard({ workspaces: A, consumer: dep({ 'pkg-a': '^2.0.0' }) });
  assert.equal(code, 1);
  assert.match(out, /pkg-a .* is at 1\.0\.0 — widen to "\^1\.0\.0"/);
});

test('a satisfied range passes', () => {
  assert.equal(runGuard({ workspaces: A, consumer: dep({ 'pkg-a': '^1.0.0' }) }).code, 0);
});

// npm 10.9.2 rejects all three with EUNSUPPORTEDPROTOCOL before it looks at the
// name or the path, so they break `npm ci` even when they name a real workspace.
for (const proto of ['workspace:^1.0.0', 'link:../a', 'portal:../a']) {
  test(`${proto.split(':')[0]}: fails — npm cannot install it`, () => {
    const { code, out } = runGuard({ workspaces: A, consumer: dep({ 'pkg-a': proto }) });
    assert.equal(code, 1);
    assert.match(out, /EUNSUPPORTEDPROTOCOL/);
  });
}

test('file: passes — npm tolerates it, so failing it would invent a failure mode', () => {
  assert.equal(runGuard({ workspaces: A, consumer: dep({ 'pkg-a': 'file:../a' }) }).code, 0);
});

test('an npm: alias hiding a stale workspace version fails', () => {
  // The target name lives inside the range, so the field key tells you nothing.
  const { code, out } = runGuard({ workspaces: A, consumer: dep({ aliased: 'npm:pkg-a@^2.0.0' }) });
  assert.equal(code, 1);
  assert.match(out, /aliases pkg-a, which is at 1\.0\.0/);
});

test('an npm: alias that is satisfied passes', () => {
  assert.equal(runGuard({ workspaces: A, consumer: dep({ aliased: 'npm:pkg-a@^1.0.0' }) }).code, 0);
});

test('an external package sharing our scope is left alone', () => {
  // Pass 2: deriving a family prefix flagged this as "renamed, deleted, or mistyped".
  const ws = { a: { name: '@acme/widget-core', version: '1.0.0' },
               z: { name: '@acme/zzz-unrelated', version: '1.0.0' } };
  assert.equal(runGuard({ workspaces: ws, consumer: dep({ '@acme/eslint-config': '^1.0.0' }) }).code, 0);
});

test('an unscoped workspace is checked like any other', () => {
  // Pass 1: scope-based matching skipped these entirely and reported 0 checked.
  const ws = { a: { name: 'unscoped-tool', version: '5.0.0' } };
  const { code } = runGuard({ workspaces: ws, consumer: dep({ 'unscoped-tool': '^4.0.0' }) });
  assert.equal(code, 1);
});

test('a repo whose workspaces glob matches nothing fails rather than reporting zero', () => {
  const { code, out } = runGuard({ workspaces: {}, consumer: null });
  assert.equal(code, 1);
  assert.match(out, /matched no package\.json files|nothing to check/);
});
