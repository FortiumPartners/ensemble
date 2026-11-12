'use strict';

/**
 * review-record-runtime.js -- the processes the PR-review recorder (`pr-review-beads-cli.js`) and the
 * clear verb (`pr-review-clear-cli.js`) start: git and `gh`.
 *
 * They live here, outside the `pr-review-*.js` modules, because those hold no process spawn, network
 * call or credential read by contract (`pr-review-reachability-repo.test.js` and
 * `pr-review-verification-dispatch-scenarios.test.js` scan every one of them); `review-precheck-cli.js`
 * and `review-prepare-runtime.js` follow the same split. The `pr-review-*` modules take the git and the
 * host read as injected functions, so unit tests need no process.
 *
 * Nothing here writes. git runs read-only plumbing with no optional locks and no prompts; `gh pr view`
 * only reads. A tool that cannot be started answers status 127 instead of throwing.
 */

const { spawnSync } = require('child_process');

const GH_TIMEOUT_MS = 60 * 1000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Variables that make git act on a repository other than the one `cwd` names. A caller's environment must not
 * rebind `repoRoot`, so none of them reaches the child.
 */
const REPOSITORY_BINDING_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX'
];

function gitEnvironment() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
  for (const name of REPOSITORY_BINDING_VARIABLES) delete env[name];
  return env;
}

/** The real git: no shell, no prompts, no optional locks (so it never writes even a stat cache), bound to `cwd`. */
function defaultGit() {
  return (args, { cwd } = {}) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
      env: gitEnvironment()
    });
    if (result.error) return { status: 127, stdout: '', stderr: String(result.error.message) };
    return {
      status: typeof result.status === 'number' ? result.status : 127,
      stdout: result.stdout || '',
      stderr: result.stderr || ''
    };
  };
}

/** The real `gh` (and any tool): no shell, a deadline, a failure to start reads as status 127. */
function defaultRun(command, argv) {
  const result = spawnSync(command, argv, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, shell: false, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) return { status: 127, stdout: '', stderr: String(result.error.message) };
  return { status: typeof result.status === 'number' ? result.status : 127, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/**
 * The host's own answer about the pull request (`gh pr view`): what the head's files cannot
 * supply. `run(command, argv) -> {status, stdout, stderr}` is replaced by tests.
 *
 * @returns {(request: {repo: string, prNumber: number}) => {ok:true, isCrossRepository:*, headRefOid:*, baseRefName:*, baseRefOid:*, state:*}|{ok:false, error:string}}
 */
function makeReadPr(run = defaultRun) {
  return ({ repo, prNumber }) => {
    const fields = 'isCrossRepository,headRefOid,baseRefName,baseRefOid,state';
    const result = run('gh', ['pr', 'view', String(prNumber), '--repo', repo, '--json', fields]);
    if (!isObject(result) || result.status !== 0) {
      const detail = isObject(result) ? String(result.stderr || '').trim().split('\n').pop() : '';
      return { ok: false, error: `gh pr view failed${detail ? `: ${detail}` : ''}` };
    }
    let data;
    try {
      data = JSON.parse(result.stdout);
    } catch (error) {
      return { ok: false, error: 'gh pr view answered with output that is not JSON' };
    }
    if (!isObject(data)) return { ok: false, error: 'gh pr view answered with something that is not an object' };
    return { ok: true, isCrossRepository: data.isCrossRepository, headRefOid: data.headRefOid, baseRefName: data.baseRefName, baseRefOid: data.baseRefOid, state: data.state };
  };
}

module.exports = { defaultGit, makeReadPr };
