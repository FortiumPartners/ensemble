'use strict';

/**
 * Fixtures for the hosted-CI reuse tests (local-ci-hosted*.test.js).
 *
 * The repository under test has three hosted workflows: validate (job `validate`), test (job `test`, matrix Node 22 and
 * 24) and generated-drift (job `drift`, an extra workflow). Real temp git repos come from makeBaseRepo: the config and the
 * workflows are committed at the trusted base, the PR head is a descendant that does NOT touch them unless a test says so.
 *
 * GitHub is a fake. `honest(head)` is what the Actions API says for a head whose hosted CI is green; `actionsApi(entries)`
 * serves it as the `ghApi` dependency and records every lookup. A test changes ONE thing about the honest answer and asserts
 * the refusal, so removing a guard in local-ci-hosted.js fails the test that pins it. The fake does NOT filter runs by the
 * requested head_sha (GitHub does): a wrong-head run is exactly what the head checks in verifyHosted defend against.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const yaml = require('js-yaml');
const { defaultDeps } = require('../../lib/local-ci-cli');
const { validateConfig } = require('../../lib/local-ci-config');
const { makeBaseRepo, REPO, PR, BASE_BRANCH } = require('./local-ci-base-repo');

const VALIDATE = '.github/workflows/validate.yml';
const TEST = '.github/workflows/test.yml';
const DRIFT = '.github/workflows/generated-drift.yml';
const CONTEXT = 'x/local-ci';

const TRIGGERS = 'on:\n  pull_request:\n  push:\n    branches: [main, dev]\n';
const WORKFLOW_FILES = {
  [VALIDATE]: `name: Validate Plugins\n${TRIGGERS}jobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - run: npm run validate\n`,
  [TEST]: `name: Test Plugins\n${TRIGGERS}jobs:\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node-version: [22, 24]\n    steps:\n      - uses: actions/checkout@v6\n      - run: npm test\n`,
  [DRIFT]: `name: Generated Drift\n${TRIGGERS}jobs:\n  drift:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - run: npm run generate\n`,
};

/** The base-ref config: local steps validate + test, hosted CI declared to run both, plus the extra drift workflow. */
const CONFIG = `workflows:
  - file: ${VALIDATE}
    jobs:
      - id: validate
  - file: ${TEST}
    jobs:
      - id: test
        matrix:
          node-version: [22, 24]
steps:
  - name: validate
    cmd: npm run validate
  - name: test
    cmd: npm test
status_context: ${CONTEXT}
hosted_reuse:
  covers: [validate, test]
  extra_workflows:
    - file: ${DRIFT}
      jobs:
        - id: drift
`;
/** The same config without the opt-in: the behaviour before hosted reuse existed. */
const CONFIG_WITHOUT_HOSTED = CONFIG.slice(0, CONFIG.indexOf('hosted_reuse:'));

/** A real temp repo: `config` and the workflows at the base (a `null` file is left out), `headFiles` committed on the head only. */
function hostedRepo({ config = CONFIG, files = {}, headFiles = {} } = {}) {
  return makeBaseRepo({ config, files: { ...WORKFLOW_FILES, ...files }, headFiles });
}

/** The approval set the CLI would build from `source` (config text or object). A fixture that does not validate is a test bug. */
function approvalSetOf(source) {
  const r = validateConfig(source);
  if (!r.ok) throw new Error(`fixture config is invalid: ${r.problems.join('; ')}`);
  return r.approvalSet;
}
const APPROVAL_SET = approvalSetOf(CONFIG);

/**
 * The `steps[]` GitHub's jobs listing carries for one job of `workflowText` (the base workflow): `Set up job`, the
 * workflow's steps in order (a named step by its evaluated name, an unnamed `uses` as `Run <uses>`, an unnamed `run:` as
 * `Run <first line>`), a numbering GAP (hidden internal steps, as in real data), `Post ...` for the steps that have a
 * post action (checkout, setup-*, cache) in reverse order, `Complete job`. A step whose base `if:` is a pure matrix
 * comparison that is false for this matrix cell is `skipped`, the way `Upload coverage` is on `test (22)`. A job or a
 * workflow the fixture cannot find gets a generic checkout + run step list.
 */
function jobSteps(workflowText, jobName) {
  let def = null;
  let matrixKeys = [];
  if (typeof workflowText === 'string') {
    const jobs = (yaml.load(workflowText) || {}).jobs || {};
    const id = Object.keys(jobs).find((k) => jobName === k || jobName.startsWith(`${k} (`)) || Object.keys(jobs).find((k) => jobs[k] && jobs[k].name === jobName);
    def = id ? jobs[id] : null;
    const m = def && def.strategy && def.strategy.matrix;
    if (m && typeof m === 'object') matrixKeys = Object.keys(m).filter((k) => Array.isArray(m[k]));
  }
  const cell = {};
  const paren = /\((.*)\)$/.exec(jobName);
  if (paren) paren[1].split(', ').forEach((v, i) => { if (matrixKeys[i]) cell[matrixKeys[i]] = v; });
  const fill = (s) => String(s).replace(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_m, k) => (k in cell ? cell[k] : _m));
  const term = (t) => {
    const m = /^\s*matrix\.([\w-]+)\s*(==|!=)\s*('[^']*'|[\d.]+|true|false)\s*$/.exec(t);
    if (!m || !(m[1] in cell)) return true; // not a matrix comparison the fixture can evaluate: the step runs
    const lit = m[3].startsWith("'") ? m[3].slice(1, -1) : m[3];
    return (cell[m[1]] === lit) === (m[2] === '==');
  };
  const runs = (cond) => {
    if (typeof cond !== 'string') return true;
    const body = cond.trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1');
    return body.split('||').some((conj) => conj.split('&&').every(term));
  };
  const defSteps = def && Array.isArray(def.steps) && def.steps.length > 0 ? def.steps : [{ uses: 'actions/checkout@v6' }, { run: 'npm test' }];
  const nameOf = (st) => (st.name !== undefined ? fill(st.name) : st.uses ? `Run ${st.uses}` : `Run ${String(st.run).split('\n')[0]}`);
  const numbered = [{ number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' }];
  defSteps.forEach((st, i) => numbered.push({ number: i + 2, name: nameOf(st), status: 'completed', conclusion: runs(st.if) ? 'success' : 'skipped' }));
  const POST = /^actions\/(checkout|setup-[a-z]+|cache)@/;
  const posts = defSteps.filter((st) => typeof st.uses === 'string' && POST.test(st.uses)).reverse();
  let next = numbered.length + 5; // the numbering gap
  for (const st of posts) numbered.push({ number: next++, name: `Post ${nameOf(st)}`, status: 'completed', conclusion: 'success' });
  numbered.push({ number: next, name: 'Complete job', status: 'completed', conclusion: 'success' });
  return numbered;
}

/**
 * One workflow run with its jobs, as `{ run, jobs }`: completed, green, a pull_request run on `head`. Job ids are
 * `id * 100 + n`. `run` and `job` override fields of the run and of every job (e.g. a different head_sha). Each job
 * carries the realistic `steps[]` of its definition in `workflow` (default: the fixture workflow of `file`).
 */
function hostedRun(id, file, jobNames, head, { run = {}, job = {}, workflow = WORKFLOW_FILES[file] } = {}) {
  const r = { id, name: path.basename(file, '.yml'), path: file, event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: head, head_branch: 'feat/hosted', run_attempt: 1, pull_requests: [{ number: PR, base: { ref: BASE_BRANCH, sha: 'b'.repeat(40) } }], ...run };
  const jobs = jobNames.map((name, i) => ({ id: id * 100 + i + 1, run_id: id, name, status: 'completed', conclusion: 'success', head_sha: r.head_sha, run_attempt: 1, steps: jobSteps(workflow, name), ...job }));
  return { run: r, jobs };
}

/**
 * Hosted CI green on `head`: validate (run 101), test 22 + 24 (run 102), drift (run 103). `workflows` maps a workflow file
 * to the text of the base workflow the jobs' steps[] must follow (default: the fixture workflow of that file), for a test
 * that gives the repo a different workflow.
 */
const honest = (head, workflows = {}) => [
  hostedRun(101, VALIDATE, ['validate'], head, { workflow: workflows[VALIDATE] || WORKFLOW_FILES[VALIDATE] }),
  hostedRun(102, TEST, ['test (22)', 'test (24)'], head, { workflow: workflows[TEST] || WORKFLOW_FILES[TEST] }),
  hostedRun(103, DRIFT, ['drift'], head, { workflow: workflows[DRIFT] || WORKFLOW_FILES[DRIFT] }),
];

/** What verifyHosted reports for `honest(head)`: the jobs it verified. */
const VERIFIED = [
  { workflow: VALIDATE, event: 'pull_request', runId: 101, jobId: 10101, name: 'validate', conclusion: 'success' },
  { workflow: TEST, event: 'pull_request', runId: 102, jobId: 10201, name: 'test (22)', conclusion: 'success' },
  { workflow: TEST, event: 'pull_request', runId: 102, jobId: 10202, name: 'test (24)', conclusion: 'success' },
  { workflow: DRIFT, event: 'pull_request', runId: 103, jobId: 10301, name: 'drift', conclusion: 'success' },
];

/** `entries` with `change(entry)` applied to every entry whose run belongs to workflow `file`. */
const swap = (entries, file, change) => entries.map((e) => (e.run.path === file ? change(e) : e));
const withRun = (entry, over) => ({ run: { ...entry.run, ...over }, jobs: entry.jobs });
const withJob = (entry, name, over) => ({ run: entry.run, jobs: entry.jobs.map((j) => (j.name === name ? { ...j, ...over } : j)) });
const withoutJob = (entry, name) => ({ run: entry.run, jobs: entry.jobs.filter((j) => j.name !== name) });

/**
 * The `ghApi` dependency: GET only, answers the two Actions lookups verifyHosted makes from `entries`, refuses anything
 * else, and records every path in `.calls`. `runsTotal` / `jobsTotal[runId]` set total_count (truncated listings);
 * `answer(path, proceed)` takes over a lookup entirely (an error, a malformed body, even `undefined`): call `proceed()`
 * to get the answer the fake would otherwise have given.
 */
function actionsApi(entries, { repo = REPO, runsTotal, jobsTotal = {}, answer, statuses = [] } = {}) {
  const calls = [];
  const honestAnswer = (apiPath) => {
    const runs = /^repos\/([^/]+\/[^/]+)\/actions\/runs\?head_sha=([0-9a-fA-F]+)&per_page=(\d+)$/.exec(apiPath);
    if (runs) {
      if (runs[1] !== repo) return { ok: false, error: `HTTP 404: no repository ${runs[1]}` };
      const workflow_runs = entries.map((e) => e.run);
      return { ok: true, json: { total_count: runsTotal === undefined ? workflow_runs.length : runsTotal, workflow_runs } };
    }
    const jobs = /^repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/jobs\?filter=latest&per_page=(\d+)$/.exec(apiPath);
    if (jobs) {
      if (jobs[1] !== repo) return { ok: false, error: `HTTP 404: no repository ${jobs[1]}` };
      const entry = entries.find((e) => String(e.run.id) === jobs[2]);
      if (!entry) return { ok: false, error: `HTTP 404: no run ${jobs[2]}` };
      const total = jobsTotal[entry.run.id];
      return { ok: true, json: { total_count: total === undefined ? entry.jobs.length : total, jobs: entry.jobs } };
    }
    const statusList = /^repos\/([^/]+\/[^/]+)\/commits\/([0-9a-fA-F]+)\/statuses\?per_page=(\d+)$/.exec(apiPath);
    if (statusList) {
      if (statusList[1] !== repo) return { ok: false, error: `HTTP 404: no repository ${statusList[1]}` };
      return { ok: true, json: statuses };
    }
    return { ok: false, error: `unexpected lookup: ${apiPath}` };
  };
  const ghApi = (apiPath) => {
    calls.push(apiPath);
    return typeof answer === 'function' ? answer(apiPath, () => honestAnswer(apiPath)) : honestAnswer(apiPath);
  };
  ghApi.calls = calls;
  return ghApi;
}

/**
 * A STATEFUL GitHub for the commit-status endpoints: `postStatus` records what the gate posts and the statuses lookup
 * returns it, NEWEST FIRST like GitHub, ahead of `initial` (also newest first). `answer` plugs into actionsApi's
 * `answer` option (the Actions lookups stay the fixture's); `posts` is every request `postStatus` accepted.
 * `published:false` makes postStatus report that gh could not post (and store nothing).
 */
function statefulStatuses({ initial = [] } = {}) {
  const store = [...initial];
  const posts = [];
  const fake = {
    store,
    posts,
    published: true,
    answer: (apiPath, proceed) => (/\/commits\/[0-9a-fA-F]+\/statuses\?/.test(apiPath) ? { ok: true, json: store.slice() } : proceed()),
    postStatus: async (req) => {
      if (!fake.published) return { published: false, reason: 'gh could not post the status' };
      posts.push(req);
      store.unshift({ context: req.context, state: req.state, description: req.description, sha: req.sha });
      return { published: true, repo: req.repo, sha: req.sha, state: req.state, context: req.context, id: 99 };
    },
  };
  return fake;
}

/**
 * The real `git` dependency, memoised per (args, cwd). A fixture repo never changes once built, so one real git call per
 * question is exact; a test file that asks the same questions hundreds of times is not dominated by process spawns.
 */
function memoGit() {
  const real = defaultDeps().git;
  const cache = new Map();
  return (args, cwd) => {
    const key = JSON.stringify([args, cwd]);
    if (!cache.has(key)) cache.set(key, real(args, cwd));
    return cache.get(key);
  };
}

const dirs = [];
function cleanupHostedFixtures() {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/**
 * A real `gh` executable for tests that run the CLI as a process. It answers `gh pr view` with `pr`, and exactly the
 * Actions lookups of `entries` for `head` (`gh api <path>`, one argv element), by replaying JSON files; anything else
 * (a POST, another path) exits 2. `apiMode`: 'ok' (default) replays the answers; 'fails' makes every `gh api` exit 1
 * like a 502; 'garbage' makes it exit 0 with output that is not JSON. Every invocation's argv is
 * recorded: read it back with `ghInvocations(dir)`.
 */
function fakeGhActionsDir({ pr, entries, head, repo = REPO, apiMode = 'ok', statuses = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-ci-hostedgh-'));
  dirs.push(dir);
  const cases = [];
  const answer = (apiPath, json) => {
    const file = path.join(dir, `answer-${cases.length}.json`);
    fs.writeFileSync(file, JSON.stringify(json));
    cases.push(`    ${JSON.stringify(apiPath)}) cat ${JSON.stringify(file)}; exit 0;;`);
  };
  answer(`repos/${repo}/actions/runs?head_sha=${head}&per_page=100`, { total_count: entries.length, workflow_runs: entries.map((e) => e.run) });
  for (const e of entries) answer(`repos/${repo}/actions/runs/${e.run.id}/jobs?filter=latest&per_page=100`, { total_count: e.jobs.length, jobs: e.jobs });
  answer(`repos/${repo}/commits/${head}/statuses?per_page=100`, statuses);
  fs.writeFileSync(path.join(dir, 'pr.json'), JSON.stringify(pr));
  const api = {
    ok: `if [ "$#" -eq 2 ]; then\n    case "$2" in\n${cases.join('\n')}\n    esac\n  fi`,
    fails: 'echo "gh: HTTP 502: Bad Gateway" >&2; exit 1',
    garbage: 'printf \'%s\' "<html>Bad gateway</html>"; exit 0',
  }[apiMode];
  const script = `#!/bin/sh
{ printf '%s\\n' "$@"; echo '---'; } >> ${JSON.stringify(path.join(dir, 'argv.log'))}
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then cat ${JSON.stringify(path.join(dir, 'pr.json'))}; exit 0; fi
if [ "$1" = "api" ]; then
  ${api}
fi
echo "unexpected gh call: $*" >&2
exit 2
`;
  fs.writeFileSync(path.join(dir, 'gh'), script, { mode: 0o755 });
  return dir;
}

/** Every `gh` invocation the fake recorded, each as its argv array. */
function ghInvocations(dir) {
  const file = path.join(dir, 'argv.log');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('---\n')
    .filter((chunk) => chunk !== '')
    .map((chunk) => chunk.split('\n').filter((line) => line !== ''));
}

module.exports = {
  VALIDATE,
  TEST,
  DRIFT,
  CONTEXT,
  CONFIG,
  CONFIG_WITHOUT_HOSTED,
  WORKFLOW_FILES,
  APPROVAL_SET,
  VERIFIED,
  PR,
  REPO,
  hostedRepo,
  approvalSetOf,
  jobSteps,
  hostedRun,
  honest,
  swap,
  withRun,
  withJob,
  withoutJob,
  actionsApi,
  statefulStatuses,
  memoGit,
  fakeGhActionsDir,
  ghInvocations,
  cleanupHostedFixtures,
};
