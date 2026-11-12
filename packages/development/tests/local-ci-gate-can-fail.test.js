'use strict';

/**
 * TRD-006-TEST: the local CI gate can both FAIL and PASS through the real code
 * path. A real git repo is built in a temp dir with a base commit, a deliberately
 * failing commit F and a fixing commit P, under ONE unchanged configuration.
 * Real: git clone, the trusted command run by the runner (bash -c), non-zero exit, runGate,
 * runGateFlow, the real postStatus (its `gh api` argv is built and parsed for real), runMerge.
 * Fake: only the `gh` process (an injected `run`) standing in for GitHub.
 * Not exercised: npm ci, Node downloads, the repo's real suites, real GitHub.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { runGateFlow, runMerge, defaultDeps } = require('../lib/local-ci-cli');
const { makeBaseRepo, cleanupBaseRepos, prInfoFor, PR } = require('./helpers/local-ci-base-repo');
const { runGate } = require('../lib/local-ci-runner');
const { redact, postStatus } = require('../lib/local-ci-status');

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
const NODE_BIN_DIR = path.dirname(process.execPath);
const CONTEXT = 'ensemble/local-ci';
const REPO = 'example-org/example-repo';
const WORKFLOW = '.github/workflows/proof.yml';
const PROOF = path.join(__dirname, '..', 'skills', 'local-ci-gate', 'PROOF.md');

const CONFIG_YAML = `workflows:
  - file: ${WORKFLOW}
    jobs:
      - id: proof
        matrix:
          node-version: [${NODE_MAJOR}]
steps:
  - name: unit-check
    cmd: node scripts/unit-check.js
status_context: ${CONTEXT}
`;

const WORKFLOW_YAML = `name: proof
on: [push]
jobs:
  proof:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/unit-check.js
`;

const UNIT_FAILING = `'use strict';
const assert = require('assert');
assert.strictEqual(2 + 2, 5, 'deliberately failing test');
`;
const UNIT_PASSING = `'use strict';
const assert = require('assert');
assert.strictEqual(2 + 2, 4);
`;

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function write(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

function commit(root, message, files) {
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** In-memory fake of `gh`: records every argv it is run with and every status post it accepts; `down` makes it fail like a 403. */
function fakeGitHub() {
  const posts = [];
  const runs = [];
  const state = { down: false };
  const run = (cmd, argv) => {
    runs.push({ cmd, argv });
    if (state.down) return { status: 1, stdout: '', stderr: 'gh: Resource not accessible (HTTP 403)' };
    const m = /^repos\/([^/]+\/[^/]+)\/statuses\/([0-9a-f]+)$/.exec(argv[3] || '');
    if (cmd !== 'gh' || argv[0] !== 'api' || argv[1] !== '-X' || argv[2] !== 'POST' || !m) return { status: 2, stdout: '', stderr: 'unexpected gh call' };
    const field = (k) => argv.find((a, i) => argv[i - 1] === '-f' && a.startsWith(`${k}=`)).slice(k.length + 1);
    posts.push({ repo: m[1], sha: m[2], state: field('state'), context: field('context'), description: field('description') });
    return { status: 0, stdout: JSON.stringify({ id: posts.length }), stderr: '' };
  };
  /** What GitHub lists for `sha`: the accepted posts, newest first, in GitHub's shape. */
  const list = (sha) =>
    posts
      .map((p, i) => ({ id: i + 1, state: p.state, context: p.context, description: p.description, sha: p.sha }))
      .filter((p) => p.sha === sha)
      .reverse()
      .map(({ sha: _sha, ...rest }) => rest);
  return { run, runs, posts, state, list };
}

describe('local CI gate can fail and can pass (TRD-006)', () => {
  let tmp;
  let repoRoot;
  let shaBase;
  let baseRef;
  let shaF;
  let shaP;
  let gh;
  let deps;
  let failedReport;
  let passedReport;
  let failedPosts;

  const payloadFor = (headSha) => ({ repoRoot, headSha, repo: REPO, pr: PR, baseRef });
  const mergePayload = (headSha) => ({ repoRoot, headSha, repo: REPO, pr: PR, baseRef });
  // Honest PR identity per head: the PR's head is whichever commit is being gated/merged.
  const depsFor = (headSha) => ({ ...deps, prInfo: prInfoFor({ headSha }) });

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-can-fail-'));
    // Config + passing stand-in committed at the trusted base; F and P descend from it.
    const fixture = makeBaseRepo({
      config: CONFIG_YAML,
      files: {
        'scripts/unit-check.js': UNIT_PASSING,
        [WORKFLOW]: WORKFLOW_YAML,
        '.gitignore': '.ensemble/local-ci-runs/\n',
      },
      headFiles: { 'scripts/unit-check.js': UNIT_FAILING },
    });
    repoRoot = fixture.dir;
    baseRef = fixture.baseRef;
    shaBase = fixture.baseSha;
    shaF = fixture.headSha;
    shaP = commit(repoRoot, 'P: fix the unit check', { 'scripts/unit-check.js': UNIT_PASSING });

    gh = fakeGitHub();
    deps = {
      ...defaultDeps(),
      env: { ...process.env },
      postStatus: (req) => postStatus({ ...req, run: gh.run, env: {} }),
      // merge reads the head's statuses from GitHub: the fake lists what it accepted, newest first, without a per-status sha
      ghApi: (apiPath) => {
        const m = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/statuses\?per_page=100$/.exec(apiPath);
        return m ? { ok: true, json: gh.list(m[1]) } : { ok: false, error: `unexpected lookup: ${apiPath}` };
      },
      runGate,
      runnerDeps: { resolveNodeBinDir: () => NODE_BIN_DIR },
    };

    failedReport = await runGateFlow(payloadFor(shaF), depsFor(shaF));
    failedPosts = gh.posts.slice();
    passedReport = await runGateFlow(payloadFor(shaP), depsFor(shaP));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanupBaseRepos();
  });

  test('the fixture is a real repo whose three commits are distinct', () => {
    expect(new Set([shaBase, shaF, shaP]).size).toBe(3);
    expect(git(repoRoot, 'rev-parse', 'HEAD')).toBe(shaP);
    expect(shaF).toMatch(/^[0-9a-f]{40}$/);
  });

  test('failing test blocks: failure naming the step and exact head, only a failure status posted', () => {
    expect(failedReport.ok).toBe(false);
    expect(failedReport.mergeReady).toBe(false);
    expect(failedReport.headSha).toBe(shaF);
    const named = failedReport.failures.filter((f) => f.kind === 'step-failed');
    expect(named).toHaveLength(1);
    expect(named[0].step).toBe('unit-check');
    expect(named[0].sha).toBe(shaF);

    expect(failedPosts).toHaveLength(2);
    expect(failedPosts.map((p) => p.state)).toEqual(['pending', 'failure']);
    expect(failedPosts[0]).toMatchObject({ repo: REPO, sha: shaF, state: 'pending', context: CONTEXT });
    expect(failedPosts[1]).toMatchObject({ repo: REPO, sha: shaF, state: 'failure', context: CONTEXT });
    expect(failedPosts.some((p) => p.state === 'success')).toBe(false);
    expect(failedReport.posted).toBe(true);
  });

  test('a failure status never satisfies the merge check for the failing head', () => {
    const verdict = runMerge({ ...mergePayload(shaF), statuses: failedPosts }, depsFor(shaF));
    expect(verdict.ok).toBe(false);
    expect(verdict.mergeReady).toBe(false);
  });

  test('fixed branch passes: same config, success posted on the fixed head', () => {
    expect(passedReport.ok).toBe(true);
    expect(passedReport.mergeReady).toBe(true);
    expect(passedReport.headSha).toBe(shaP);
    expect(passedReport.failures).toEqual([]);
    const successes = gh.posts.filter((p) => p.state === 'success');
    expect(successes).toHaveLength(1);
    expect(successes[0]).toMatchObject({ repo: REPO, sha: shaP, context: CONTEXT });
    // for each head the pending went first: F got pending then failure, P got pending then success; nothing else was ever posted
    expect(gh.posts.map((p) => `${p.state}@${p.sha}`)).toEqual([`pending@${shaF}`, `failure@${shaF}`, `pending@${shaP}`, `success@${shaP}`]);
  });

  test('runMerge accepts the success record for P and refuses it for F', () => {
    const accepted = runMerge({ ...mergePayload(shaP), statuses: gh.posts }, depsFor(shaP));
    expect(accepted.ok).toBe(true);
    expect(accepted.mergeReady).toBe(true);
    expect(accepted.hostedCiWaitRequired).toBe(false);

    const successOnly = gh.posts.filter((p) => p.state === 'success');
    const refused = runMerge({ ...mergePayload(shaF), statuses: successOnly }, depsFor(shaF));
    expect(refused.ok).toBe(false);
    expect(refused.mergeReady).toBe(false);
  });

  test('when gh cannot post, the gate cannot attest success for P (cannot fake a pass)', async () => {
    const before = gh.posts.length;
    gh.state.down = true;
    try {
      const r = await runGateFlow(payloadFor(shaP), depsFor(shaP));
      expect(r.mergeReady).toBe(false);
      expect(r.posted).toBe(false);
      expect(gh.posts).toHaveLength(before);
    } finally {
      gh.state.down = false;
    }
  });

  test('the transport used by the proof is the real postStatus: gh api -X POST as an argv array, nothing else', () => {
    expect(gh.runs.length).toBeGreaterThanOrEqual(2);
    for (const { cmd, argv } of gh.runs) {
      expect(cmd).toBe('gh');
      expect(argv.slice(0, 3)).toEqual(['api', '-X', 'POST']);
      expect(argv[3]).toMatch(/^repos\/example-org\/example-repo\/statuses\/[0-9a-f]{40}$/);
    }
  });
});

describe('PROOF.md (TRD-006 proof note)', () => {
  const text = fs.readFileSync(PROOF, 'utf8');

  test('lists both outcomes and the date', () => {
    expect(text).toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(text).toMatch(/^#{2,3} .*Outcome.*fail/im);
    expect(text).toMatch(/^#{2,3} .*Outcome.*pass/im);
    expect(text).toMatch(/\bfailure\b/);
    expect(text).toMatch(/\bsuccess\b/);
  });

  test('records the live experiment: the real gate run on both Node versions and the real GitHub behaviour', () => {
    const m = /^#{2,3} Live experiment[^\n]*$([\s\S]*?)(?=^#{1,3} |\s*$(?![\s\S]))/im.exec(text);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/Node 22/);
    expect(body).toMatch(/Node 24/);
    // the observed protection behaviour, one line per situation, including the honest-actor limit
    expect(body).toMatch(/BLOCKED/);
    expect(body).toMatch(/hand typed/i);
    expect(body).toMatch(/honest-actor/i);
  });

  test('Not proven still names what has NOT been done: the real gh pr view, a non-dry post, and enabling it on dev', () => {
    const m = /^#{2,3} Not proven\s*$([\s\S]*?)(?=^#{1,3} |\s*$(?![\s\S]))/im.exec(text);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/gh pr view/);
    expect(body).toMatch(/dryRun|dry run/i);
    expect(body).toMatch(/`dev`/);
    expect(body).toMatch(/not (been )?(observed|exercised|run|required)|has never|has not been/i);
  });

  test('contains no credential: nothing in it is token- or PEM-shaped', () => {
    expect(redact(text)).toBe(text);
    expect(text).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  });

  test('the redact oracle can fail: it flags a token-shaped string', () => {
    const tainted = `${text}\nghp_${'a'.repeat(36)}\n`;
    expect(redact(tainted)).not.toBe(tainted);
  });
});
