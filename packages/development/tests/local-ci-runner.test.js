'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateConfig } = require('../lib/local-ci-config');
const {
  runGate,
  cloneAtSha,
  sweepStaleClones,
  findUnmirroredSteps,
  requiredNodeVersions,
  worstCaseMs,
  RUNS_DIR,
} = require('../lib/local-ci-runner');

const CONFIG = `
workflows:
  - file: .github/workflows/validate.yml
    jobs:
      - id: validate
  - file: .github/workflows/test.yml
    jobs:
      - id: test
        matrix:
          node-version: [22, 24]
steps:
  - name: install
    cmd: npm ci --legacy-peer-deps
  - name: validate
    cmd: npm run validate
  - name: test
    cmd: npm test
status_context: ensemble/local-ci
`;

const VALIDATE_YML = `
name: Validate
jobs:
  validate:
    steps:
      - uses: actions/checkout@v6
      - name: Setup Node.js
        uses: actions/setup-node@v6
        with: { node-version: '24' }
      - name: Install dependencies
        run: npm ci --legacy-peer-deps
      - name: Validate
        run: npm run validate
`;
const TEST_YML = `
name: Test
jobs:
  test:
    steps:
      - uses: actions/checkout@v6
      - name: Run tests
        run: npm test
`;
const CI_STEPS = [
  { name: 'install', cmd: 'npm ci --legacy-peer-deps' },
  { name: 'validate', cmd: 'npm run validate' },
  { name: 'test', cmd: 'npm test' },
];

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function git(cwd, ...args) {
  return sh('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], cwd);
}
function commitAll(cwd, msg) {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}

let tmp;
let repo;
let shaA; // older commit (checked out)
let shaB; // "PR head" (not checked out)
const approvalSet = validateConfig(CONFIG).approvalSet;

function write(rel, text) {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lci-runner-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  write('.gitignore', '.ensemble/local-ci-runs/\n.ensemble/local-ci.secrets.env\n');
  write('.github/workflows/validate.yml', VALIDATE_YML);
  write('.github/workflows/test.yml', TEST_YML);
  write('scripts/ci-local.js', '// placeholder entry point\n');
  write('marker.txt', 'A');
  shaA = commitAll(repo, 'A');
  write('marker.txt', 'B');
  shaB = commitAll(repo, 'B');
  git(repo, 'checkout', '-q', '--detach', shaA); // maintainer is on A, PR head is B
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Fake process runner: `node --version` reports the Node on PATH; every trusted command is scripted via onCmd. */
function fakeDeps({ onCmd, nodeBin } = {}) {
  const calls = [];
  return {
    calls,
    resolveNodeBinDir(major) {
      if (nodeBin) return nodeBin(major);
      return `/fake/node${major}/bin`;
    },
    run(cmd, { cwd, env }) {
      calls.push({ cmd, cwd, env });
      if (cmd === 'node --version') {
        const m = /\/fake\/node(\d+)\/bin/.exec(env.PATH);
        return { status: 0, stdout: m ? `v${m[1]}.0.0\n` : 'v26.0.0\n', stderr: '' };
      }
      return onCmd ? onCmd(cmd, { cwd, env }) : { status: 0, stdout: '', stderr: '' };
    },
  };
}

function gate(extra, deps) {
  return runGate({ repoRoot: repo, headSha: shaB, approvalSet, ...extra }, deps);
}

describe('local-ci-runner: isolated clone of the PR head', () => {
  test('runs the pushed commit, not the checked-out HEAD', () => {
    const seen = [];
    const deps = fakeDeps({
      onCmd: (cmd, { cwd }) => {
        if (cmd === 'npm test') {
          seen.push({
            head: git(cwd, 'rev-parse', 'HEAD'),
            marker: fs.readFileSync(path.join(cwd, 'marker.txt'), 'utf8'),
            cwd,
          });
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    const r = gate({}, deps);
    expect(r.ok).toBe(true);
    expect(seen.length).toBe(2);
    for (const s of seen) {
      expect(s.head).toBe(shaB);
      expect(s.marker).toBe('B');
      expect(s.cwd).toBe(path.join(repo, RUNS_DIR, shaB));
    }
    // the maintainer's checkout is untouched
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(shaA);
    expect(fs.readFileSync(path.join(repo, 'marker.txt'), 'utf8')).toBe('A');
  });

  test('dirty working tree has no effect on the result', () => {
    write('marker.txt', 'DIRTY');
    write('scripts/ci-local.js', '// edited, uncommitted\n');
    write('untracked-new-file.txt', 'x');
    const contents = [];
    const deps = fakeDeps({
      onCmd: (cmd, { cwd }) => {
        if (cmd === 'npm test') {
          contents.push({
            marker: fs.readFileSync(path.join(cwd, 'marker.txt'), 'utf8'),
            ci: fs.readFileSync(path.join(cwd, 'scripts/ci-local.js'), 'utf8'),
            untracked: fs.existsSync(path.join(cwd, 'untracked-new-file.txt')),
          });
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    const r = gate({}, deps);
    expect(r.ok).toBe(true);
    expect(contents.length).toBe(2);
    for (const c of contents) {
      expect(c.marker).toBe('B');
      expect(c.ci).toBe('// placeholder entry point\n');
      expect(c.untracked).toBe(false);
    }
    expect(fs.readFileSync(path.join(repo, 'marker.txt'), 'utf8')).toBe('DIRTY');
  });

  test('a commit that is in the repo but not reachable from any ref is still cloned exactly', () => {
    // dangling commit: created on a temp branch, then the branch is deleted
    git(repo, 'checkout', '-q', '-b', 'tmp-branch');
    write('marker.txt', 'DANGLING');
    const dangling = commitAll(repo, 'dangling');
    git(repo, 'checkout', '-q', '--detach', shaA);
    git(repo, 'branch', '-q', '-D', 'tmp-branch');
    const c = cloneAtSha({ repoRoot: repo, sha: dangling, deps: { git: (a, o) => { const r = spawnSync('git', a, { cwd: o && o.cwd, encoding: 'utf8' }); return { status: r.status, stdout: r.stdout, stderr: r.stderr }; } } });
    expect(c.ok).toBe(true);
    expect(git(c.dir, 'rev-parse', 'HEAD')).toBe(dangling);
    expect(fs.readFileSync(path.join(c.dir, 'marker.txt'), 'utf8')).toBe('DANGLING');
  });

  test('clone is removed after a normal run', () => {
    gate({}, fakeDeps());
    expect(fs.existsSync(path.join(repo, RUNS_DIR, shaB))).toBe(false);
  });

  test('unfetchable head: error naming the SHA, nothing run, no clone left', () => {
    const missing = 'deadbeef'.repeat(5);
    const deps = fakeDeps();
    const r = runGate({ repoRoot: repo, headSha: missing, approvalSet }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(missing);
    expect(r.failures[0].kind).toBe('unfetchable-head');
    expect(r.failures[0].sha).toBe(missing);
    expect(deps.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(repo, RUNS_DIR, missing))).toBe(false);
  });

  test('a head that is not a full commit sha is refused', () => {
    const r = runGate({ repoRoot: repo, headSha: 'HEAD', approvalSet }, fakeDeps());
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe('unfetchable-head');
  });

  test('the head scripts/ci-local.js is irrelevant: a head without it is graded by the trusted commands alone', () => {
    git(repo, 'checkout', '-q', '--detach', shaB);
    fs.rmSync(path.join(repo, 'scripts/ci-local.js'));
    const noCi = commitAll(repo, 'remove ci-local');
    const deps = fakeDeps();
    const r = runGate({ repoRoot: repo, headSha: noCi, approvalSet }, deps);
    expect(r.ok).toBe(true);
    expect(deps.calls.filter((c) => c.cmd === 'npm test')).toHaveLength(2);
  });
});

describe('local-ci-runner: Node matrix', () => {
  test('each required version runs explicitly, not the machine default', () => {
    const deps = fakeDeps();
    const r = gate({}, deps);
    expect(r.ok).toBe(true);
    const ciRuns = deps.calls.filter((c) => c.cmd === 'npm test');
    expect(ciRuns.map((c) => c.env.PATH.split(path.delimiter)[0])).toEqual(['/fake/node22/bin', '/fake/node24/bin']);
    expect(r.nodes.map((n) => n.node)).toEqual([22, 24]);
    expect(requiredNodeVersions(approvalSet)).toEqual([22, 24]);
  });

  test('a required version that cannot be provided fails the gate (never a skip)', () => {
    const deps = fakeDeps({
      nodeBin: (major) => {
        if (major === 24) throw new Error('offline');
        return `/fake/node${major}/bin`;
      },
    });
    const r = gate({}, deps);
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ kind: 'node-version', node: 24, sha: shaB });
    expect(r.failures[0].message).toContain('Node 24');
    expect(deps.calls.filter((c) => c.cmd === 'npm test')).toHaveLength(1);
  });

  test('a resolved bin dir that is not actually the required major fails (machine default is not accepted)', () => {
    const deps = fakeDeps({ nodeBin: () => '/machine/default/node26' });
    const r = gate({}, deps);
    expect(r.ok).toBe(false);
    expect(r.failures.every((f) => f.kind === 'node-version')).toBe(true);
    expect(deps.calls.filter((c) => c.cmd === 'npm test')).toHaveLength(0);
  });

  test('no configured Node version is a failure, not a run on the default', () => {
    const noMatrix = validateConfig(`
workflows:
  - file: .github/workflows/validate.yml
    jobs:
      - id: validate
steps:
  - name: install
    cmd: npm ci --legacy-peer-deps
  - name: validate
    cmd: npm run validate
status_context: ensemble/local-ci
`).approvalSet;
    const deps = fakeDeps();
    const r = runGate({ repoRoot: repo, headSha: shaB, approvalSet: noMatrix }, deps);
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe('node-version');
    expect(deps.calls).toHaveLength(0);
  });
});

describe('local-ci-runner: worstCaseMs (what a waiter for the gate lock sizes its patience from)', () => {
  const COMMAND_LIMIT_MS = 10 * 60 * 1000;

  /** What the runner really allows: the limit it hands to deps.run for every command it starts (an absent limit is the default). */
  function limitsGivenByRunner(extra) {
    const base = fakeDeps();
    const limits = [];
    const deps = {
      ...base,
      run: (cmd, opts) => {
        limits.push(opts.timeoutMs === undefined ? COMMAND_LIMIT_MS : opts.timeoutMs);
        return base.run(cmd, opts);
      },
    };
    expect(gate(extra, deps).ok).toBe(true);
    return limits;
  }

  test('equals the sum of the limits the runner gives the commands it starts: per Node version, the node check plus every step', () => {
    const limits = limitsGivenByRunner({});
    expect(limits).toHaveLength(2 * (1 + CI_STEPS.length)); // two Node versions, one node check and three steps each
    expect(worstCaseMs(approvalSet)).toBe(limits.reduce((a, b) => a + b, 0));
    expect(worstCaseMs(approvalSet)).toBe(80 * 60 * 1000);
  });

  test('follows a per-step limit, while the node check keeps the default limit', () => {
    const limits = limitsGivenByRunner({ stepTimeoutMs: 60 * 1000 });
    expect(worstCaseMs(approvalSet, { stepTimeoutMs: 60 * 1000 })).toBe(limits.reduce((a, b) => a + b, 0));
    expect(worstCaseMs(approvalSet, { stepTimeoutMs: 60 * 1000 })).toBe(2 * (COMMAND_LIMIT_MS + 3 * 60 * 1000));
  });

  test('counts each required Node version once and tolerates an approval set with nothing to run', () => {
    const dup = { checks: [{ matrix: { 'node-version': 22 } }, { matrix: { 'node-version': 22 } }], steps: [{ name: 'a', cmd: 'x' }] };
    expect(worstCaseMs(dup)).toBe(1 * (COMMAND_LIMIT_MS + 1 * COMMAND_LIMIT_MS));
    expect(worstCaseMs({ checks: [], steps: [] })).toBe(0);
    expect(worstCaseMs({})).toBe(0);
    expect(worstCaseMs(undefined)).toBe(0);
  });
});

describe('local-ci-runner: workflow step mirroring', () => {
  const WF_WITH_EXTRA = `
name: Validate
jobs:
  validate:
    steps:
      - uses: actions/checkout@v6
      - name: Install dependencies
        run: npm ci --legacy-peer-deps
      - name: Validate
        run: npm run validate
      - name: Reject Windows-invalid filenames
        run: |
          if git ls-files | grep ':'; then exit 1; fi
      - name: Upload coverage
        uses: codecov/codecov-action@v7
`;

  function headWithExtraSteps() {
    git(repo, 'checkout', '-q', '--detach', shaB);
    write('.github/workflows/validate.yml', WF_WITH_EXTRA);
    const sha = commitAll(repo, 'extra workflow steps');
    git(repo, 'checkout', '-q', '--detach', shaA);
    return sha;
  }

  test('unmirrored required steps fail the gate and are named; nothing is run', () => {
    const sha = headWithExtraSteps();
    const deps = fakeDeps();
    const r = runGate({ repoRoot: repo, headSha: sha, approvalSet }, deps);
    expect(r.ok).toBe(false);
    expect(r.unmirrored.map((u) => u.step)).toEqual(['Reject Windows-invalid filenames', 'Upload coverage']);
    expect(r.failures.map((f) => f.step)).toEqual(['Reject Windows-invalid filenames', 'Upload coverage']);
    expect(deps.calls).toHaveLength(0);
  });

  test('an equivalent configured command mirrors the step and is run on every Node version', () => {
    const sha = headWithExtraSteps();
    const deps = fakeDeps();
    const r = runGate(
      {
        repoRoot: repo,
        headSha: sha,
        approvalSet: { ...approvalSet, steps: [...CI_STEPS, { name: 'windows-filenames', cmd: "! git ls-files | grep ':'" }] },
        equivalents: [
          { workflowStep: 'Reject Windows-invalid filenames', runs: 'windows-filenames' },
          { workflowStep: 'Upload coverage', runs: 'windows-filenames' },
        ],
      },
      deps
    );
    expect(r.ok).toBe(true);
    expect(deps.calls.filter((c) => c.cmd === "! git ls-files | grep ':'")).toHaveLength(2);
  });

  test('an equivalent that names a step not in the list does not mirror', () => {
    const u = findUnmirroredSteps({
      workflows: [{ file: 'w.yml', doc: { jobs: { j: { steps: [{ name: 'Lint', run: 'npm run lint' }] } } } }],
      approvalSet: { workflows: [{ file: 'w.yml', jobs: [{ id: 'j' }] }] },
      runnable: CI_STEPS,
      equivalents: [{ workflowStep: 'Lint', runs: 'does-not-exist' }],
    });
    expect(u).toHaveLength(1);
    expect(u[0].step).toBe('Lint');
  });

  test('a required job missing from the workflow fails closed', () => {
    const u = findUnmirroredSteps({
      workflows: [{ file: 'w.yml', doc: { jobs: {} } }],
      approvalSet: { workflows: [{ file: 'w.yml', jobs: [{ id: 'gone' }] }] },
      runnable: CI_STEPS,
    });
    expect(u).toHaveLength(1);
    expect(u[0].job).toBe('gone');
  });

  test('a fully mirrored workflow set reports nothing unmirrored', () => {
    const r = gate({}, fakeDeps());
    expect(r.unmirrored).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("local-ci-runner: this repository's real approval set", () => {
  const yaml = require('js-yaml');
  const { STEPS } = require('../../../scripts/ci-local.js');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const ROOT = path.resolve(__dirname, '../../..');
  const real = () => {
    const cfg = validateConfig(fs.readFileSync(path.join(ROOT, '.ensemble/local-ci.yaml'), 'utf8'));
    expect(cfg.problems).toEqual([]);
    const a = cfg.approvalSet;
    const workflows = [...new Set(a.workflows.map((w) => w.file))].map((f) => ({
      file: f,
      doc: yaml.load(fs.readFileSync(path.join(ROOT, f), 'utf8')),
    }));
    return { a, workflows };
  };
  const unmirrored = (o = {}) => {
    const { a, workflows } = real();
    return findUnmirroredSteps({
      workflows,
      approvalSet: a,
      runnable: o.steps || a.steps,
      equivalents: o.equivalents || a.equivalents,
      excludedSteps: o.excludedSteps || a.excludedSteps,
    }).map((u) => u.step);
  };

  test('every required step of validate.yml and test.yml is mirrored, run, or recorded as excluded', () => {
    expect(unmirrored()).toEqual([]);
  });

  test("the trusted list begins with scripts/ci-local.js's STEPS exactly (name and command), so the gate runs what ci:local runs", () => {
    const { a } = real();
    expect(a.steps.slice(0, STEPS.length).map((s) => [s.name, norm(s.cmd)])).toEqual(STEPS.map((s) => [s.name, norm(s.cmd)]));
  });

  test('a step whose command drifted from the workflow becomes unmirrored', () => {
    const { a } = real();
    const drifted = a.steps.map((s) => (s.name === 'check-package-json-consistency' ? { ...s, cmd: s.cmd + '\n# edited' } : s));
    expect(unmirrored({ steps: drifted })).toEqual(['Check package.json consistency']);
  });

  test('dropping the generated-markdown equivalent makes that step unmirrored', () => {
    expect(unmirrored({ equivalents: [] })).toEqual(['Check generated markdown is up to date']);
  });

  test('dropping the recorded exclusion makes the coverage upload unmirrored', () => {
    expect(unmirrored({ excludedSteps: [] })).toEqual(['Upload coverage']);
  });

  test('an exclusion recorded for a different job does not hide the step', () => {
    const { a } = real();
    const wrongJob = [{ ...a.excludedSteps[0], job: 'validate' }];
    expect(unmirrored({ excludedSteps: wrongJob })).toEqual(['Upload coverage']);
  });

  test('an exclusion recorded for a different workflow file does not hide the step', () => {
    const { a } = real();
    const otherFile = a.workflows.map((w) => w.file).find((f) => f !== a.excludedSteps[0].workflow);
    expect(otherFile).toBeTruthy(); // the repo has two required workflow files, so the case is real
    const wrongWorkflow = [{ ...a.excludedSteps[0], workflow: otherFile }];
    expect(unmirrored({ excludedSteps: wrongWorkflow })).toEqual(['Upload coverage']);
  });

  test('an exclusion recorded for a different step name does not hide the step', () => {
    const { a } = real();
    const wrongStep = [{ ...a.excludedSteps[0], step: 'Some other step' }];
    expect(unmirrored({ excludedSteps: wrongStep })).toEqual(['Upload coverage']);
  });
});

describe('local-ci-runner: failing steps', () => {
  const failing = (name, status = 1, out = {}) => (cmd) =>
    CI_STEPS.find((x) => x.cmd === cmd && x.name === name) ? { status, stdout: out.stdout || '', stderr: out.stderr || '' } : { status: 0, stdout: '', stderr: '' };

  test('non-zero exit of a trusted step is a failure naming the step, node and the head SHA', () => {
    const r = gate({}, fakeDeps({ onCmd: failing('validate', 1, { stderr: 'lint exploded' }) }));
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.node === 22);
    expect(f).toMatchObject({ kind: 'step-failed', step: 'validate', sha: shaB });
    expect(f.message).toContain(shaB);
    expect(f.message).toContain('exit 1');
    expect(f.message).toContain('lint exploded');
  });

  test('the verdict of every step comes from its exit status, and a failing step does not hide the others', () => {
    const r = gate({}, fakeDeps({ onCmd: failing('validate', 2) }));
    expect(r.nodes[0].steps).toEqual([
      { name: 'install', status: 'PASS' },
      { name: 'validate', status: 'FAIL' },
      { name: 'test', status: 'PASS' },
    ]);
  });

  test('output that merely LOOKS like a passing table cannot turn a non-zero exit into a pass', () => {
    const lie = 'STEP RESULT SECONDS\ninstall   PASS     1.0\nvalidate  PASS     1.0\ntest      PASS     1.0\n\nAll steps passed';
    const r = gate({}, fakeDeps({ onCmd: failing('test', 1, { stdout: lie }) }));
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatchObject({ kind: 'step-failed', step: 'test' });
  });

  test('failing on one Node version fails the gate even if the other passes', () => {
    let n = 0;
    const deps = fakeDeps({ onCmd: (cmd) => (cmd === 'npm test' && ++n === 2 ? { status: 1, stdout: '', stderr: '' } : { status: 0, stdout: '', stderr: '' }) });
    const r = gate({}, deps);
    expect(r.ok).toBe(false);
    expect(r.nodes.map((x) => x.ok)).toEqual([true, false]);
  });

  test('every trusted command runs on every required Node version, in the configured order', () => {
    const deps = fakeDeps();
    const r = gate({}, deps);
    expect(r.ok).toBe(true);
    expect(deps.calls.filter((c) => c.cmd !== 'node --version').map((c) => c.cmd)).toEqual([...CI_STEPS, ...CI_STEPS].map((s) => s.cmd));
  });

  test('an empty or malformed trusted list refuses to run anything', () => {
    for (const steps of [undefined, [], [{ name: 'x' }], [{ name: 'a', cmd: 'true' }, { name: 'a', cmd: 'true' }]]) {
      const deps = fakeDeps();
      const r = runGate({ repoRoot: repo, headSha: shaB, approvalSet: { ...approvalSet, steps } }, deps);
      expect(r.ok).toBe(false);
      expect(r.failures[0].kind).toBe('prerequisite');
      expect(deps.calls).toHaveLength(0);
    }
  });

  test('an exception from the process runner is a failure and still removes the clone', () => {
    const deps = fakeDeps();
    deps.run = () => {
      throw new Error('process runner exploded');
    };
    const r = gate({}, deps);
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe('runner-error');
    expect(fs.existsSync(path.join(repo, RUNS_DIR, shaB))).toBe(false);
  });
});

describe('local-ci-runner: failure log retention', () => {
  const SECRET = 'logsecret-VALUE-4471';
  let logDir;
  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-faillog-'));
  });
  afterEach(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const failing = (name, out) => (cmd) =>
    CI_STEPS.find((x) => x.cmd === cmd && x.name === name) ? { status: 1, stdout: out.stdout || '', stderr: out.stderr || '' } : { status: 0, stdout: '', stderr: '' };
  const files = () => fs.readdirSync(logDir);

  test('a failing step keeps its FULL output, including the part the report tail drops, and the report names the file', () => {
    const head = 'FAIL tests/the-real-culprit.test.js\n  ● the real culprit › explodes';
    const flood = 'PASS tests/a-passing-suite.test.js\n'.repeat(400); // far longer than the report's short tail
    const r = gate({ failureLogDir: logDir }, fakeDeps({ onCmd: failing('test', { stdout: `${head}\n${flood}` }) }));
    const f = r.failures.find((x) => x.kind === 'step-failed' && x.node === 22);
    expect(f.message).toContain('the-real-culprit'); // kata ce0c: the report leads with the extracted failing test
    const file = files().find((n) => n.includes('node22') && n.includes('test'));
    expect(file).toBeDefined();
    expect(f.message).toContain(path.join(logDir, file));
    const text = fs.readFileSync(path.join(logDir, file), 'utf8');
    expect(text).toContain('the-real-culprit.test.js');
    expect(text).toContain('exit: 1');
    expect(text).toContain(shaB);
  });

  // kata ce0c: what a failed step's report text leads with. `msg` is the step-failed message of the Node 22 run.
  const ENV = { PATH: '/usr/bin', LOG_TOKEN: SECRET };
  const msg = (stdout, stderr = '') => {
    const r = gate({ secretNames: ['LOG_TOKEN'], env: ENV }, fakeDeps({ onCmd: failing('test', { stdout, stderr }) }));
    expect(r.ok).toBe(false);
    return r.failures.find((x) => x.kind === 'step-failed' && x.node === 22).message;
  };
  const MARK = '\n--- output tail ---\n';
  const evidence = (m) => m.split('failing tests (extracted):\n')[1].split(MARK)[0];
  const tailOf = (m) => m.split(MARK)[1];

  test('kata ce0c: a flood of warnings after a jest FAIL + block does not hide the failure; bounded', () => {
    const block = 'FAIL tests/x.test.js\n  ● x › explodes\n\n    expected 1 to be 2\n\n      at tests/x.test.js:3:1';
    const flood = 'lib-bundler: warning - cannot read /some/where/missing.md\n'.repeat(600);
    const m = msg(`${block}\n${flood}`);
    expect(m).toContain('failing tests (extracted):\nFAIL tests/x.test.js\n\n● x › explodes');
    expect(evidence(m)).toContain('expected 1 to be 2');
    expect(m.length).toBeLessThan(4000 + 2600 + 400); // tail + evidence caps + prefix, never the whole 600-line flood
  });

  test('kata ce0c: the extracted evidence comes BEFORE the output tail', () => {
    const m = msg(`FAIL tests/x.test.js\n${'noise\n'.repeat(900)}`);
    expect(m).toMatch(/\(exit 1\): failing tests \(extracted\):\nFAIL tests\/x\.test\.js/); // right after the step/exit prefix
    expect(m.indexOf('FAIL tests/x.test.js')).toBeLessThan(m.indexOf('--- output tail ---'));
    expect(tailOf(m)).not.toContain('FAIL tests/x.test.js');
  });

  test('kata ce0c: FAIL lines are deduplicated, capped at 10 and the rest counted', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `FAIL tests/t${i}.test.js`);
    const m = msg(`${lines.flatMap((l) => [l, l]).join('\n')}\n${lines.join('\n')}\n`); // jest prints each more than once
    const ev = evidence(m).split('\n');
    expect(ev.filter((l) => l.startsWith('FAIL '))).toEqual(lines.slice(0, 10));
    expect(ev).toContain('... and 15 more FAIL line(s)');
  });

  test('kata ce0c: a FAIL line over 200 chars is cut for display; two paths sharing 250 chars are both counted', () => {
    const common = `tests/${'d'.repeat(250)}`;
    const m = msg(`FAIL ${common}-one.test.js\nFAIL ${common}-two.test.js\n`);
    const shown = evidence(m).split('\n').filter((l) => l.startsWith('FAIL '));
    expect(shown).toHaveLength(2);
    for (const l of shown) expect(l.length).toBe(200);
  });

  test('kata ce0c: ANSI-wrapped FAIL and ● lines are still found, without the escape codes in the evidence', () => {
    const m = msg('\u001b[0m\u001b[7m\u001b[1m\u001b[31m FAIL \u001b[39m\u001b[22m\u001b[27m\u001b[0m tests/ansi.test.js\n\u001b[1m\u001b[31m  \u001b[1m● ansi › breaks\u001b[22m\n\n    boom\n');
    expect(evidence(m)).toContain('FAIL tests/ansi.test.js');
    expect(evidence(m)).toContain('● ansi › breaks');
    expect(evidence(m)).not.toContain('\u001b');
  });

  test('kata ce0c: a passing suite that logs (● Console) before the failing suite does not hide the failure block', () => {
    const out = [
      'PASS tests/a-logs.test.js',
      '  ● Console',
      '',
      '    console.warn',
      '      noisy but passing',
      '',
      'FAIL tests/b-fails.test.js',
      '  ● the suite › explodes with the real culprit',
      '',
      '    expected 1 to be 2',
    ].join('\n');
    const ev = evidence(msg(out));
    expect(ev).toContain('● the suite › explodes with the real culprit');
    expect(ev).not.toContain('● Console');
    expect(ev).not.toContain('noisy but passing');
  });

  test('kata ce0c: the failing block is capped at 400 chars', () => {
    const ev = evidence(msg(`FAIL tests/x.test.js\n  ● x › y\n${'z'.repeat(2000)}`));
    expect(ev.split('\n\n')[1].length).toBe(400);
  });

  test('kata ce0c: output with no jest markers keeps the plain tail', () => {
    const m = msg('plain tool failure: boom');
    expect(m).toMatch(/: plain tool failure: boom$/);
    expect(m).not.toContain('extracted');
  });

  test('kata ce0c: a secret straddling the FAIL cut, the block cut or the tail start never appears, even in part', () => {
    const noLeak = (m) => {
      expect(m).not.toContain('logsecret');
      expect(m).not.toContain('VALUE-4471');
      expect(m).not.toContain('secret-');
    };
    // starts at index 190 of the 200-char FAIL display, so a cut-then-redact leaves 'logsecret-'
    const failLine = `FAIL ${'a'.repeat(185)}${SECRET}.test.js`;
    const mFail = msg(`${failLine}\n`);
    expect(evidence(mFail).split('\n')[0].length).toBe(200);
    noLeak(mFail);
    // starts at index 394 of the 400-char block
    const blockLine = `  ● ${'b'.repeat(392)}${SECRET}`;
    const mBlock = msg(`FAIL tests/x.test.js\n${blockLine}\n`);
    expect(evidence(mBlock).split('\n\n')[1].length).toBe(400);
    noLeak(mBlock);
    // the secret straddles the start of the 4000-char tail (10 chars in)
    const mTail = msg(`head\n${SECRET}${'c'.repeat(3990)}`);
    expect(tailOf(mTail) ?? mTail).toContain('c'.repeat(100));
    noLeak(mTail);
    // stderr side too
    noLeak(msg('x', `${'d'.repeat(5)}${SECRET}${'e'.repeat(3990)}`));
  });

  test('kata ce0c: 2 MiB of distinct FAIL lines is processed in linear time and counted correctly', () => {
    const n = 100000;
    const out = Array.from({ length: n }, (_, i) => `FAIL t${i}.test.js`).join('\n');
    expect(out.length).toBeGreaterThan(1.5 * 1024 * 1024);
    const t0 = Date.now();
    const m = msg(out);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(evidence(m).split('\n')).toContain(`... and ${n - 10} more FAIL line(s)`);
  });

  test('a secret in a failing step output never reaches the log file or the report', () => {
    const deps = fakeDeps({ onCmd: failing('test', { stdout: `token=${SECRET}`, stderr: `again ${SECRET}` }) });
    const r = gate({ failureLogDir: logDir, secretNames: ['LOG_TOKEN'], env: { PATH: '/usr/bin', LOG_TOKEN: SECRET } }, deps);
    expect(files().length).toBeGreaterThan(0);
    for (const n of files()) expect(fs.readFileSync(path.join(logDir, n), 'utf8')).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(fs.readFileSync(path.join(logDir, files()[0]), 'utf8')).toContain('[REDACTED');
  });

  test('nothing is written ANYWHERE when the option is omitted, and passing steps write nothing', () => {
    const real = fs.writeFileSync;
    const logWrites = [];
    const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...rest) => {
      if (/-node\d+-.+\.log$/.test(String(file))) logWrites.push(String(file));
      return real.call(fs, file, ...rest);
    });
    try {
      gate({}, fakeDeps({ onCmd: failing('test', { stdout: 'boom' }) })); // failing step, option omitted
      expect(logWrites).toEqual([]);
      gate({ failureLogDir: logDir }, fakeDeps()); // option given, but every step passes
      expect(logWrites).toEqual([]);
      gate({ failureLogDir: logDir }, fakeDeps({ onCmd: failing('test', { stdout: 'boom' }) })); // control: this DOES write
      expect(logWrites.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
    expect(files().every((n) => /-node\d+-.+\.log$/.test(n))).toBe(true);
  });

  test('a step name with path separators still gets one flat, safely named log file per Node version, inside the directory', () => {
    // Real commands (so the head's workflows still mirror the trusted list and the steps actually run), hostile names.
    // `deploy/prod:../x` has a separator before any `..`: used raw it would name a subdirectory that does not exist,
    // the write would fail, and the log would silently vanish. Sanitised, it is one file the report points at.
    const hostile = {
      ...approvalSet,
      steps: [
        { name: 'install', cmd: 'npm ci --legacy-peer-deps' },
        { name: 'validate', cmd: 'npm run validate' },
        { name: 'deploy/prod:../x', cmd: 'npm test' },
      ],
    };
    const outside = path.join(logDir, '..', 'x');
    const r = gate({ failureLogDir: logDir, approvalSet: hostile }, fakeDeps({ onCmd: (cmd) => (cmd === 'npm test' ? { status: 1, stdout: 'boom', stderr: '' } : { status: 0, stdout: '', stderr: '' }) }));
    const f = r.failures.find((x) => x.kind === 'step-failed');
    expect(f).toBeDefined();
    expect(fs.existsSync(outside)).toBe(false);
    // one log per required Node version (22 and 24), each a single flat file inside the directory
    expect(files()).toHaveLength(2);
    for (const n of files()) {
      expect(n).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(fs.statSync(path.join(logDir, n)).isFile()).toBe(true);
    }
    expect(f.message).toContain(path.join(logDir, files().find((n) => n.includes('node22'))));
  });

  test('a log that cannot be written never changes the verdict: the step still fails with its tail', () => {
    const blocker = path.join(logDir, 'a-file-not-a-directory');
    fs.writeFileSync(blocker, 'x');
    const r = gate({ failureLogDir: path.join(blocker, 'logs') }, fakeDeps({ onCmd: failing('test', { stdout: 'boom-visible' }) }));
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.kind === 'step-failed');
    expect(f.message).toContain('boom-visible');
    expect(f.message).not.toContain('full output:');
  });

  test('an enormous output is capped', () => {
    const huge = 'x'.repeat(3 * 1024 * 1024);
    gate({ failureLogDir: logDir }, fakeDeps({ onCmd: failing('test', { stdout: huge }) }));
    const text = fs.readFileSync(path.join(logDir, files()[0]), 'utf8');
    expect(text.length).toBeLessThan(2 * 1024 * 1024 + 200);
    expect(text).toContain('[truncated at');
  });
});

describe('local-ci-runner: crash safety', () => {
  const OLD = new Date('2020-01-01T00:00:00Z');

  function seed() {
    const runs = path.join(repo, RUNS_DIR);
    fs.mkdirSync(runs, { recursive: true });
    const staleSha = 'a'.repeat(40);
    const freshSha = 'b'.repeat(40);
    for (const name of [staleSha, freshSha, 'my-notes']) {
      fs.mkdirSync(path.join(runs, name));
      fs.writeFileSync(path.join(runs, name, 'file.txt'), 'x');
    }
    fs.writeFileSync(path.join(runs, 'c'.repeat(40)), 'a plain file named like a sha');
    fs.utimesSync(path.join(runs, staleSha), OLD, OLD);
    fs.utimesSync(path.join(runs, 'my-notes'), OLD, OLD);
    fs.utimesSync(path.join(runs, 'c'.repeat(40)), OLD, OLD);
    const foreign = path.join(repo, '.ensemble', 'maintainer-dir');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'keep.txt'), 'keep');
    fs.utimesSync(foreign, OLD, OLD);
    const outside = path.join(tmp, 'outside-dir');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    fs.utimesSync(outside, OLD, OLD);
    return { runs, staleSha, freshSha, foreign, outside };
  }

  test('a crash leaves a clone; the next run removes only stale sha-named clones', () => {
    // simulate a crash: the clone is created and the process dies before cleanup
    const real = {
      git: (a, o) => {
        const r = spawnSync('git', a, { cwd: o && o.cwd, encoding: 'utf8' });
        return { status: r.status, stdout: r.stdout, stderr: r.stderr };
      },
    };
    const crashed = cloneAtSha({ repoRoot: repo, sha: shaB, deps: real });
    expect(crashed.ok).toBe(true);
    fs.utimesSync(crashed.dir, OLD, OLD);
    const s = seed();

    const r = gate({}, fakeDeps());
    expect(r.ok).toBe(true);
    expect(r.staleRemoved.sort()).toEqual([shaB, s.staleSha].sort());
    expect(fs.existsSync(path.join(s.runs, s.staleSha))).toBe(false);
    // everything else untouched
    expect(fs.existsSync(path.join(s.runs, s.freshSha, 'file.txt'))).toBe(true);
    expect(fs.existsSync(path.join(s.runs, 'my-notes', 'file.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(s.runs, 'c'.repeat(40)), 'utf8')).toBe('a plain file named like a sha');
  });

  test('foreign directories outside the prefix are left alone', () => {
    const s = seed();
    gate({}, fakeDeps());
    expect(fs.readFileSync(path.join(s.foreign, 'keep.txt'), 'utf8')).toBe('keep');
    expect(fs.readFileSync(path.join(s.outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  test('sweepStaleClones respects the threshold and a missing prefix directory', () => {
    expect(sweepStaleClones({ repoRoot: repo })).toEqual([]);
    const s = seed();
    const now = OLD.getTime() + 10 * 60 * 1000;
    expect(sweepStaleClones({ repoRoot: repo, maxAgeMs: 60 * 60 * 1000, now })).toEqual([]);
    expect(fs.existsSync(path.join(s.runs, s.staleSha))).toBe(true);
  });

  test('a fresh clone directory for the same sha is not clobbered', () => {
    const dir = path.join(repo, RUNS_DIR, shaB);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'other-run.txt'), 'in progress');
    const r = gate({}, fakeDeps());
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'other-run.txt'), 'utf8')).toBe('in progress');
  });
});

describe('local-ci-runner: secrets', () => {
  const SECRET = 's3cr3t-VALUE-9f2c';

  test('secrets from the gitignored file reach steps but never appear in the result', () => {
    write('.ensemble/local-ci.secrets.env', `# local\nAPP_KEY="${SECRET}"\n`);
    let seenInEnv;
    const deps = fakeDeps({
      onCmd: (cmd, { env }) => {
        if (cmd === 'npm run validate') seenInEnv = env.APP_KEY;
        return { status: 1, stdout: `leaked ${SECRET} in output`, stderr: `err ${SECRET}` };
      },
    });
    const r = gate({ secretNames: ['APP_KEY'] }, deps);
    expect(seenInEnv).toBe(SECRET);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).toContain('[REDACTED]');
  });

  test('secrets from the environment are redacted too', () => {
    const deps = fakeDeps({ onCmd: () => ({ status: 1, stdout: SECRET, stderr: '' }) });
    const r = gate({ secretNames: ['TOKEN_X'], env: { PATH: '/usr/bin', TOKEN_X: SECRET } }, deps);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  test('a secrets file that is tracked by git is refused', () => {
    write('.ensemble/local-ci.secrets.env', `APP_KEY=${SECRET}\n`);
    git(repo, 'add', '-f', '.ensemble/local-ci.secrets.env');
    git(repo, 'commit', '-q', '-m', 'oops tracked secret');
    const deps = fakeDeps();
    const r = gate({ secretNames: ['APP_KEY'] }, deps);
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe('secrets');
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(deps.calls).toHaveLength(0);
  });

  test('a secrets file that is not gitignored is refused', () => {
    write('other-secrets.env', `APP_KEY=${SECRET}\n`);
    const r = gate({ secretNames: ['APP_KEY'], secretsFile: 'other-secrets.env' }, fakeDeps());
    expect(r.ok).toBe(false);
    expect(r.failures[0].kind).toBe('secrets');
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});

describe('local-ci-runner: a hung step fails the gate instead of blocking it', () => {
  const { defaultDeps } = require('../lib/local-ci-runner');
  // The `npm test` step really runs `cmd` through the real process runner; every other step is an instant scripted pass.
  const realEnvGate = (cmd, extra) => {
    const deps = fakeDeps();
    const real = defaultDeps().run;
    deps.run = (c, o) => {
      if (c === 'node --version') return fakeDeps().run(c, o);
      return c === 'npm test' ? real(cmd, { ...o, env: { PATH: process.env.PATH } }) : { status: 0, stdout: '', stderr: '' };
    };
    return gate({ ...extra }, deps);
  };

  test('a step that outlives stepTimeoutMs is a FAILED step with the exact timeout message', () => {
    const started = Date.now();
    const r = realEnvGate('sleep 30', { stepTimeoutMs: 1000 });
    expect(Date.now() - started).toBeLessThan(20000);
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.kind === 'step-failed' && x.step === 'test');
    expect(f).toBeDefined();
    expect(f.message).toContain('step test timed out after 1s (hung?)');
    expect(r.nodes[0].steps.find((s) => s.name === 'test').status).toBe('FAIL');
  });

  test('a fast step still passes under the same timeout', () => {
    const r = realEnvGate('true', { stepTimeoutMs: 1000 });
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('the process group is killed, so a backgrounded child does not survive the timeout', () => {
    const marker = path.join(tmp, 'child-survived.txt');
    const r = realEnvGate(`(sleep 3; echo alive > ${marker}) & sleep 30`, { stepTimeoutMs: 1000 });
    expect(r.ok).toBe(false);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 4000);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
