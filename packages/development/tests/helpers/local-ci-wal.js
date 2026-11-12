'use strict';

/**
 * Fixtures for the write-ahead veto tests (PR 297, kata ehsm): local-ci-wal*.test.js.
 *
 *  - records:   verified / unverified success statuses (a REAL `buildRecord` for the fixture's config blob and workflow set)
 *  - makeWorld: an in-process world, real git, a STATEFUL fake GitHub (every accepted post is listed newest first with an
 *               increasing id; a post can be refused or made to throw), an event log (lock / posts / run) and an injected runner
 *  - walGhDir:  a real `gh` executable (a stateful copy of helpers/local-ci-wal-gh.js) plus `npx`/`npm`/`node` shims, so a
 *               real CLI process can gate and merge without any network
 * Nothing here reaches the network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const cli = require('../../lib/local-ci-cli');
const { buildRecord } = require('../../lib/local-ci-record');
const { prInfoFor, BASE_BRANCH, PR, REPO } = require('./local-ci-base-repo');
const H = require('./local-ci-hosted');

const { CONTEXT } = H;
const CLI_PATH = path.join(__dirname, '..', '..', 'lib', 'local-ci-cli.js');
const WORKFLOW_SET = H.APPROVAL_SET.workflows.map((w) => w.file);
const OTHER = 'c'.repeat(40);

const dirs = [];
const scratchDir = (prefix = 'local-ci-wal-') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
};
function cleanupWalFixtures() {
  for (const d of dirs.splice(0)) {
    spawnSync('chmod', ['-R', 'u+rwx', d]);
    fs.rmSync(d, { recursive: true, force: true });
  }
  H.cleanupHostedFixtures();
}

/* ------------------------------------------------------------------------------ records and statuses */

const configBlobOf = (fx) => fx.git('rev-parse', `${fx.baseRef}:.ensemble/local-ci.yaml`);

/** The description a passing gate posts for this fixture: a record that verifies for its config blob and workflow set. */
const verifiedDescription = (fx, { set = WORKFLOW_SET, blob = configBlobOf(fx), log = 'run' } = {}) => {
  const r = buildRecord({ runnerBlobSha: blob, workflowSet: set, log });
  if (!r.ok) throw new Error(`fixture record: ${r.error}`);
  return r.description;
};

/** One status in the configured context, in the payload's shape (`sha` present). */
const status = (state, over = {}) => ({ context: CONTEXT, state, description: 'x', ...over });
/** A success that verifies for `fx` on `sha` (default: its head). */
const verified = (fx, over = {}) => status('success', { description: verifiedDescription(fx), sha: fx.headSha, ...over });
/** The same list as GitHub shapes it: newest first as given, no per-status sha, increasing ids (see asGithub). */
const asGithub = (list) => list.map(({ sha: _sha, ...rest }, i) => ({ id: 1000 + list.length - i, ...rest }));

/* ----------------------------------------------------------------------------------------- runner results */

const passingRun = (sha) => ({ ok: true, sha, failures: [], unmirrored: [], nodes: [{ node: 22, ok: true, steps: [] }, { node: 24, ok: true, steps: [] }] });
const refusedRun = (sha, failure) => ({
  ok: false,
  sha,
  failures: [{ step: null, node: null, sha, message: 'refused', ...failure }],
  unmirrored: [],
  nodes: [{ node: 22, ok: false, steps: [] }],
});

/* ------------------------------------------------------------------------------------- the in-process world */

/**
 * `fx` is a `H.hostedRepo()` fixture. Options:
 *   entries   the hosted Actions answers (default: green on the head)
 *   initial   GitHub's statuses of the head before the test, NEWEST FIRST, in GitHub's shape (use `asGithub`)
 *   refuse    (request) => boolean: the post is refused (published:false, HTTP 403) and stores nothing
 *   throwOn   (request) => boolean: the post throws
 *   api       actionsApi options (an `answer` here replaces the statuses answer)
 *   deps      overrides of the CLI dependencies (`postStatus: undefined` removes it)
 * The returned world: `events` ('lock', 'unlock', 'post:<state>', 'run', in order), `posts` (every post ATTEMPTED),
 * `store` (what GitHub lists, newest first), `localRuns`, `next` (what the injected runner answers: a value or a function),
 * `prInfo`, `ghApi`, `deps`.
 */
function makeWorld(fx, { entries, initial = [], refuse = () => false, throwOn = () => false, api = {}, deps = {}, prAnswers = [{}] } = {}) {
  const events = [];
  const posts = [];
  const store = [...initial];
  let nextId = 5000;
  const w = { events, posts, store, localRuns: 0, next: () => passingRun(fx.headSha), refuse, throwOn };
  w.postStatus = async (req) => {
    events.push(`post:${req.state}`);
    posts.push(req);
    if (w.throwOn(req)) throw new Error('postStatus exploded');
    if (w.refuse(req)) return { published: false, reason: 'gh api exited with status 1: HTTP 403' };
    nextId += 1;
    store.unshift({ id: nextId, context: req.context, state: req.state, description: req.description });
    return { published: true, repo: req.repo, sha: req.sha, state: req.state, context: req.context, id: nextId };
  };
  w.ghApi = H.actionsApi(entries || H.honest(fx.headSha), {
    ...api,
    answer: api.answer || ((apiPath, proceed) => (/\/commits\/[0-9a-fA-F]+\/statuses\?/.test(apiPath) ? { ok: true, json: store.slice() } : proceed())),
  });
  const prCalls = [];
  w.prInfo = (args) => {
    const n = prCalls.length;
    prCalls.push(args);
    const over = prAnswers[Math.min(n, prAnswers.length - 1)];
    return over.error ? { ok: false, error: over.error } : prInfoFor(fx, over)(args);
  };
  w.prInfo.calls = prCalls;
  w.deps = {
    ...cli.defaultDeps(),
    git: H.memoGit(),
    env: {},
    prInfo: w.prInfo,
    ghApi: w.ghApi,
    postStatus: w.postStatus,
    runGate: (options) => {
      events.push('run');
      w.localRuns += 1;
      return typeof w.next === 'function' ? w.next(options) : w.next;
    },
    acquireGateLock: async () => {
      events.push('lock');
      return { acquired: true, queuedMs: 0, release: () => events.push('unlock') };
    },
    ...deps,
  };
  return w;
}

/** A subcommand through `cli.main`: resolves `{ code, body }` (stdout parsed). */
async function call(sub, payload, w) {
  let out = '';
  const code = await cli.main([sub], { ...w.deps, io: { readJson: () => payload, write: (s) => (out += s) } });
  return { code, body: JSON.parse(out) };
}
const payloadFor = (fx, extra) => ({ repoRoot: fx.dir, headSha: fx.headSha, baseRef: fx.baseRef, repo: REPO, pr: PR, ...extra });
const gate = (w, fx, extra) => call('gate', payloadFor(fx, extra), w);
const merge = (w, fx, statuses = [], extra) => call('merge', payloadFor(fx, { statuses, ...extra }), w);
/** How many commit-status lookups the world's GitHub answered. */
const statusReads = (w) => w.ghApi.calls.filter((p) => /\/statuses\?/.test(p)).length;

/* ------------------------------------------------------------------------------- the real-process world */

const NPX = `#!/bin/sh
here=$(dirname "$0")
echo "$*" >> "$here/npx.log"
if [ "$(cat "$here/npx-mode" 2>/dev/null)" = fail ]; then echo "npx: no network" >&2; exit 1; fi
major=\${3#node@}
echo "$here/node$major/bin/node"
`;

/**
 * A directory to put first on PATH of a real CLI process: the stateful `gh` (see local-ci-wal-gh.js), and shims so the REAL
 * runner can run without a network: `npx` (provides node 22/24 under this directory; `npx-mode` = `fail` makes it fail like
 * an offline npx, which the runner reports as the transient `node-version` kind; every call is logged to `npx.log`) and
 * `npm` (exits 0). `initial` is GitHub's statuses of `head` newest first (without sha); `refuse` a list of {state?, context?}.
 */
function walGhDir({ fx, entries, initial = [], refuse = [], pr = {} }) {
  const d = scratchDir('local-ci-walgh-');
  fs.copyFileSync(path.join(__dirname, 'local-ci-wal-gh.js'), path.join(d, 'gh'));
  fs.chmodSync(path.join(d, 'gh'), 0o755);
  const json = (name, value) => fs.writeFileSync(path.join(d, name), JSON.stringify(value));
  json('pr.json', { baseRefName: BASE_BRANCH, headRefOid: fx.headSha, state: 'OPEN', ...pr });
  const answers = {};
  const list = entries || H.honest(fx.headSha);
  answers[`repos/${REPO}/actions/runs?head_sha=${fx.headSha}&per_page=100`] = { total_count: list.length, workflow_runs: list.map((e) => e.run) };
  for (const e of list) answers[`repos/${REPO}/actions/runs/${e.run.id}/jobs?filter=latest&per_page=100`] = { total_count: e.jobs.length, jobs: e.jobs };
  json('actions.json', answers);
  json('state.json', { next: 8000, statuses: initial.map((s) => ({ sha: fx.headSha, ...s })) });
  json('refuse.json', refuse);
  fs.writeFileSync(path.join(d, 'npx'), NPX, { mode: 0o755 });
  for (const major of [22, 24]) {
    fs.mkdirSync(path.join(d, `node${major}`, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(d, `node${major}`, 'bin', 'node'), `#!/bin/sh\necho v${major}.0.0\n`, { mode: 0o755 });
  }
  fs.writeFileSync(path.join(d, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return d;
}

/** What the fake GitHub of `dir` lists for the head, newest first, as [state, description] pairs (sha dropped). */
const walStatuses = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).statuses;
const walStates = (dir) => walStatuses(dir).map((s) => s.state);
const setNpxMode = (dir, mode) => fs.writeFileSync(path.join(dir, 'npx-mode'), mode);
const npxCalls = (dir) => (fs.existsSync(path.join(dir, 'npx.log')) ? fs.readFileSync(path.join(dir, 'npx.log'), 'utf8').split('\n').filter(Boolean) : []);

/** A REAL `local-ci-cli` process: `{ code, signal, body }` (body is the parsed stdout, or null when there was none). */
function runCli(sub, payload, ghDir) {
  const r = spawnSync(process.execPath, [CLI_PATH, sub], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${ghDir}${path.delimiter}${process.env.PATH}`, ENSEMBLE_LOCAL_CI_LOCK_DIR: scratchDir('local-ci-walgate-locks-') },
  });
  let body = null;
  try {
    body = JSON.parse(r.stdout);
  } catch {
    /* killed before it wrote anything */
  }
  return { code: r.status, signal: r.signal, body, stderr: r.stderr };
}

module.exports = {
  CLI_PATH,
  WORKFLOW_SET,
  OTHER,
  CONTEXT,
  scratchDir,
  cleanupWalFixtures,
  configBlobOf,
  verifiedDescription,
  status,
  verified,
  asGithub,
  passingRun,
  refusedRun,
  makeWorld,
  call,
  payloadFor,
  gate,
  merge,
  statusReads,
  walGhDir,
  walStatuses,
  walStates,
  setNpxMode,
  npxCalls,
  runCli,
};
