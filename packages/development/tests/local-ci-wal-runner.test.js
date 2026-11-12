'use strict';

/**
 * W6. The runner's cleanup must never throw over a result (PR 297, round 5, finding R1). A head's step can leave directories
 * nobody can read (chmod 000), or make the clone's parent read-only; the clean clone is removed in `runGate`'s cleanup, and a
 * problem there is MERGED into the returned result (a head-bound `runner-error`), never thrown, never swallowed. Real runner,
 * real git, real clone; only the process runner (node --version and the steps) is injected.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { runGate, sweepStaleClones, RUNS_DIR } = require('../lib/local-ci-runner');
const { cleanupBaseRepos } = require('./helpers/local-ci-base-repo');
const H = require('./helpers/local-ci-hosted');
const W = require('./helpers/local-ci-wal');

afterAll(() => {
  W.cleanupWalFixtures();
  cleanupBaseRepos();
});

const repairAll = (dir) => spawnSync('chmod', ['-R', 'u+rwx', dir]);

/** A fresh fixture per test (a step may damage it). `script` runs in the clone for the step `npm run validate`; `exit` is its status. */
function scenario(script, exit, depsExtra) {
  const fx = H.hostedRepo();
  const runs = path.join(fx.dir, RUNS_DIR);
  const deps = {
    ...(depsExtra || {}),
    resolveNodeBinDir: (major) => `/fake/node${major}/bin`,
    run: (cmd, o) => {
      if (cmd === 'node --version') return { status: 0, stdout: `v${/node(\d+)/.exec(o.env.PATH)[1]}.0.0\n`, stderr: '' };
      if (cmd === 'npm run validate' && script) spawnSync('bash', ['-c', script], { cwd: o.cwd });
      return { status: cmd === 'npm run validate' ? exit : 0, stdout: '', stderr: '' };
    },
  };
  const run = (extra) =>
    runGate({ repoRoot: fx.dir, headSha: fx.headSha, approvalSet: H.APPROVAL_SET, equivalents: H.APPROVAL_SET.equivalents, excludedSteps: H.APPROVAL_SET.excludedSteps, ...extra }, deps);
  return { fx, runs, clone: path.join(runs, fx.headSha), run };
}

const kinds = (r) => r.failures.map((f) => f.kind);

describe('W6. runner cleanup', () => {
  it('control: a clean passing run leaves no clone and no failure', () => {
    const s = scenario(null, 0);
    const r = s.run();
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(fs.existsSync(s.clone)).toBe(false);
  });

  it('an unreadable tree left by a failing step is repaired and removed: no throw, the failure survives, the clone is gone', () => {
    const s = scenario('mkdir -p x/y && touch x/y/f && chmod 000 x/y x', 1);
    try {
      let r;
      expect(() => {
        r = s.run();
      }).not.toThrow();
      expect(r.ok).toBe(false);
      expect(kinds(r)).toContain('step-failed');
      expect(kinds(r)).not.toContain('runner-error');
      expect(fs.existsSync(s.clone)).toBe(false);
    } finally {
      repairAll(s.runs);
    }
  });

  it('an unreadable tree left by a PASSING step is repaired and removed too: no throw, no runner-error', () => {
    const s = scenario('mkdir -p x/y && touch x/y/f && chmod 000 x/y x', 0);
    try {
      const r = s.run();
      expect(fs.existsSync(s.clone)).toBe(false);
      expect(kinds(r)).not.toContain('runner-error');
    } finally {
      repairAll(s.runs);
    }
  });

  it('removal that still fails after the repair: a failing runner-error result, no throw, earlier failures kept', () => {
    const s = scenario('chmod 555 "$(dirname "$PWD")"', 1);
    try {
      let r;
      expect(() => {
        r = s.run();
      }).not.toThrow();
      expect(r.ok).toBe(false);
      expect(kinds(r)).toEqual(expect.arrayContaining(['step-failed', 'runner-error']));
      const removal = r.failures.find((f) => f.kind === 'runner-error');
      expect(removal.message).toContain(`could not remove the clean clone ${s.clone}`);
      expect(removal.message).toContain('remove it by hand before re-running');
      expect(removal.sha).toBe(s.fx.headSha);
    } finally {
      repairAll(s.runs);
    }
  });

  it('a PASSING run whose clone cannot be removed is NOT a pass', () => {
    const s = scenario('chmod 555 "$(dirname "$PWD")"', 0);
    try {
      const r = s.run();
      expect(r.ok).toBe(false);
      expect(kinds(r)).toEqual(['runner-error']);
      expect(r.failures[0].message).toContain('could not remove the clean clone');
    } finally {
      repairAll(s.runs);
    }
  });

  it('keep: true leaves the clone and reports nothing about it', () => {
    const s = scenario(null, 0);
    const r = s.run({ keep: true });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(s.clone)).toBe(true);
  });

  it('symlinks are never chmod-ed or followed: a link to a directory outside the clone keeps its target\'s mode and contents', () => {
    const outside = W.scratchDir('local-ci-wal-outside-');
    fs.mkdirSync(path.join(outside, 'inner'), { mode: 0o755 });
    fs.writeFileSync(path.join(outside, 'inner', 'keep.txt'), 'keep');
    fs.chmodSync(path.join(outside, 'inner'), 0o755);
    fs.chmodSync(outside, 0o755);
    const s = scenario(`ln -s '${outside}' link && ln -s '${path.join(outside, 'inner')}' link2 && mkdir -p x/y && touch x/y/f && chmod 000 x/y x`, 1);
    try {
      const r = s.run();
      expect(r.ok).toBe(false);
      expect(fs.existsSync(s.clone)).toBe(false);
      expect(fs.statSync(outside).mode & 0o777).toBe(0o755);
      expect(fs.statSync(path.join(outside, 'inner')).mode & 0o777).toBe(0o755);
      expect(fs.readFileSync(path.join(outside, 'inner', 'keep.txt'), 'utf8')).toBe('keep');
    } finally {
      repairAll(s.runs);
    }
  });

  it('symlinks INSIDE an unreadable tree are never chmod-ed or followed by the repair either (the first removal cannot reach them, so the repair walk meets them)', () => {
    const outside = W.scratchDir('local-ci-wal-outside-');
    fs.mkdirSync(path.join(outside, 'inner'), { mode: 0o755 });
    fs.writeFileSync(path.join(outside, 'inner', 'keep.txt'), 'keep');
    fs.chmodSync(path.join(outside, 'inner'), 0o755);
    fs.chmodSync(outside, 0o755);
    const s = scenario(`mkdir -p x/y && ln -s '${outside}' x/y/link && ln -s '${path.join(outside, 'inner')}' x/y/link2 && touch x/y/f && chmod 000 x/y x`, 1);
    try {
      const r = s.run();
      expect(r.ok).toBe(false);
      expect(kinds(r)).not.toContain('runner-error'); // the repair worked: the clone is gone
      expect(fs.existsSync(s.clone)).toBe(false);
      expect(fs.statSync(outside).mode & 0o777).toBe(0o755);
      expect(fs.statSync(path.join(outside, 'inner')).mode & 0o777).toBe(0o755);
      expect(fs.readFileSync(path.join(outside, 'inner', 'keep.txt'), 'utf8')).toBe('keep');
    } finally {
      repairAll(s.runs);
    }
  });

  describe('sweepStaleClones uses the same removal', () => {
    const stale = (runs, sha) => {
      const dir = path.join(runs, sha);
      fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'a', 'b', 'f'), 'x');
      fs.chmodSync(path.join(dir, 'a', 'b'), 0o000);
      fs.chmodSync(path.join(dir, 'a'), 0o000);
      return dir;
    };

    it('a stale clone with unreadable directories is repaired and removed', () => {
      const fx = H.hostedRepo();
      const runs = path.join(fx.dir, RUNS_DIR);
      fs.mkdirSync(runs, { recursive: true });
      const sha = 'd'.repeat(40);
      const dir = stale(runs, sha);
      try {
        expect(sweepStaleClones({ repoRoot: fx.dir, maxAgeMs: 1, now: Date.now() + 60 * 60 * 1000 })).toEqual([sha]);
        expect(fs.existsSync(dir)).toBe(false);
      } finally {
        repairAll(runs);
      }
    });

    it('a removal that still fails after the repair throws (the runner reports that as the transient cleanup kind)', () => {
      const fx = H.hostedRepo();
      const runs = path.join(fx.dir, RUNS_DIR);
      fs.mkdirSync(runs, { recursive: true });
      stale(runs, 'e'.repeat(40));
      fs.chmodSync(runs, 0o555);
      try {
        expect(() => sweepStaleClones({ repoRoot: fx.dir, maxAgeMs: 1, now: Date.now() + 60 * 60 * 1000 })).toThrow();
        expect(fs.existsSync(path.join(runs, 'e'.repeat(40)))).toBe(true);
      } finally {
        repairAll(runs);
      }
      expect(fs.existsSync(runs)).toBe(true);
    });

    it('through runGate: the sweep that cannot remove a stale clone is the transient cleanup failure', () => {
      const s = scenario(null, 0);
      fs.mkdirSync(s.runs, { recursive: true });
      stale(s.runs, 'f'.repeat(40));
      fs.chmodSync(s.runs, 0o555);
      try {
        const r = s.run({ staleMs: 1, now: Date.now() + 60 * 60 * 1000 });
        expect(r.ok).toBe(false);
        expect(kinds(r)).toEqual(['cleanup']);
      } finally {
        repairAll(s.runs);
      }
    });
  });
});

describe('W7. untracked-file check fails closed on unreadable directories', () => {
  const HIDE = 'mkdir -p x/y && echo permission > x/y/f && chmod 000 x/y x';

  it('a step that hides a file in an unreadable directory (exit 0) is clone-tampered, not a pass, and the clone is removed', () => {
    const s = scenario(HIDE, 0);
    try {
      const r = s.run();
      expect(r.ok).toBe(false);
      const f = r.failures.find((x) => x.kind === 'clone-tampered');
      expect(f).toBeDefined();
      expect(f.step).toBe('validate');
      expect(f.message).toContain('could not inspect the clone');
      expect(fs.existsSync(s.clone)).toBe(false);
    } finally {
      repairAll(s.runs);
    }
  });

  it('control: the same shape left readable outside output_paths is unexpected-output', () => {
    const s = scenario('mkdir -p x/y && echo permission > x/y/f', 0);
    try {
      const r = s.run();
      expect(r.ok).toBe(false);
      expect(kinds(r)).toContain('unexpected-output');
      expect(kinds(r)).not.toContain('clone-tampered');
    } finally {
      repairAll(s.runs);
    }
  });

  it('control: output only under an allowed output path (dist/) still passes', () => {
    const s = scenario('mkdir -p dist/y && echo built > dist/y/f', 0);
    try {
      const r = s.run();
      expect(r.failures).toEqual([]);
      expect(r.ok).toBe(true);
    } finally {
      repairAll(s.runs);
    }
  });

  it('control: git exiting 0 with an unrelated warning is still read normally', () => {
    const s = scenario(null, 0, {
      git: (args, o) => {
        const r = spawnSync('git', args, { cwd: o && o.cwd, input: o && o.input, encoding: 'utf8' });
        return { status: r.status, stdout: r.stdout || '', stderr: args[0] === 'ls-files' ? 'warning: something else' : r.stderr || '' };
      },
    });
    const r = s.run();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('baseline: git exit 0 plus the warning BEFORE the first step is not "everything allowed": the first step is clone-tampered', () => {
    // Not constructible with real git: a fresh clone of a commit has no unreadable directory before a step runs
    // (git cannot commit one), so the baseline read is exercised through an injected git.
    let lsCalls = 0;
    const s = scenario(null, 0, {
      git: (args, o) => {
        const r = spawnSync('git', args, { cwd: o && o.cwd, input: o && o.input, encoding: 'utf8' });
        let stderr = r.stderr || '';
        if (args[0] === 'ls-files' && lsCalls++ === 0) stderr = "warning: could not open directory 'secret/': Permission denied\n";
        return { status: r.status, stdout: r.stdout || '', stderr };
      },
    });
    const r = s.run();
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('clone-tampered');
  });

  it('the phrase is matched case-insensitively', () => {
    const s = scenario(null, 0, {
      git: (args, o) => {
        const r = spawnSync('git', args, { cwd: o && o.cwd, input: o && o.input, encoding: 'utf8' });
        return { status: r.status, stdout: r.stdout || '', stderr: args[0] === 'ls-files' ? "WARNING: Could Not Open Directory 'a/'" : r.stderr || '' };
      },
    });
    const r = s.run();
    expect(r.ok).toBe(false);
    expect(kinds(r)).toContain('clone-tampered');
  });
});
