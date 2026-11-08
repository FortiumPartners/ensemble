#!/usr/bin/env node
'use strict';

/**
 * review-precheck-cli.js -- the entry point and the real deps for `pr-review-precheck.js` (kata 4ev6).
 *
 *   node review-precheck-cli.js < payload.json
 *   payload: { repo: "owner/name", pr: 234, repoRoot: "/path/to/clone", dryRun?: true, tier?: <pr-review-cli tier record> }
 *
 * Prints ONE JSON object on stdout (the precheck result, token-shaped strings redacted) and exits 0, or 1 when the
 * result is `ok:false`. A gate that could not be started is NOT a failed run (the comment still goes up and the exit code
 * is 0): read `gate.action` in the result. `dryRun` posts no comment and starts the gate in ITS dry-run mode (no commit
 * status is published), under a separate start marker so a dry marker never makes a later real run read as "already
 * started". A dry gate and a real gate for one head still share the runner's one clone of it
 * (`.ensemble/local-ci-runs/<sha>`, keyed by the sha alone), so the second is refused, with a named reason, while the first
 * is running.
 *
 * Shell-outs live here, never in the pure module: `gh` and `git` run as argv arrays (never a shell) with the
 * maintainer's own login, and every value that reaches argv was validated first.
 *
 * WHAT A RUN TOUCHES -- all of it:
 *   - files this module creates: only under `<repoRoot>/.ensemble/pr-review/` (start markers, the gate's input and its log),
 *     the directory the review state reports already use and that .gitignore already excludes;
 *   - `git fetch origin <base>` and, when the head commit is not already local, `git fetch origin <head sha>` (fallback
 *     `refs/pull/<n>/head`), run in `<repoRoot>`: they move `refs/remotes/origin/<base>`, write `.git/FETCH_HEAD` and add
 *     objects to the repository;
 *   - read-only git (`rev-parse`, `cat-file`, `show` of REVIEW.md and `.ensemble/local-ci.yaml` at `origin/<base>`) and
 *     read-only `gh` (the PR, its reviews, the head commit, branch protection, commit statuses, the viewer, the comments);
 *   - the ONE PR comment it creates or edits (`gh api -X POST|PATCH`), redacted and with local paths stripped;
 *   - the gate it starts, a detached `local-ci-cli.js gate`: it clones the head into
 *     `<repoRoot>/.ensemble/local-ci-runs/<sha>` (removed when it finishes), runs the base-ref command list there and, unless
 *     `dryRun`, posts the commit status on the head. The recorded pid leads the gate's process group and its steps run in that
 *     group, so stop a gate with `kill -KILL -- -<pid>`: killing the pid alone leaves its steps running.
 *
 * Why not the host adapter: `host.yaml` has no PR-comment, commit-status-list or branch-protection capability, and the
 * GitHub adapter's command allowlist is a fixed TRD-036 list (no `api` REST). Adding capabilities to every host
 * adapter is a separate change; until then this is GitHub-only, like local-ci-status.js and local-ci-cli.js's `prInfo`,
 * and says so (`readPr` fails closed on a repository `gh` cannot reach).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const { runPrecheck, COMMENT_MARKER } = require('./pr-review-precheck');
const { redact } = require('./local-ci-status');

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_STDIN_BYTES = 1024 * 1024;
const PAYLOAD_KEYS = ['repo', 'pr', 'repoRoot', 'dryRun', 'tier'];
const STATE_SUBDIR = path.join('.ensemble', 'pr-review');
const GH_TIMEOUT_MS = 60000;
// A claim with no gate recorded is normal for the milliseconds between claiming and spawning. After this long the run that
// made it died before it recorded a gate (a pid that merely looks alive may have been reused), so the claim is orphaned.
const CLAIM_GRACE_MS = 60 * 1000;
// The runner clones a head into `<repoRoot>/.ensemble/local-ci-runs/<sha>`, keyed by the sha ALONE, refuses a clone that already
// exists, and sweeps one older than an hour before it clones. Both constants mirror local-ci-runner.js (RUNS_DIR,
// DEFAULT_STALE_MS); a test holds them equal.
const RUNS_SUBDIR = path.join('.ensemble', 'local-ci-runs');
const STALE_CLONE_MS = 60 * 60 * 1000;

/**
 * A base branch name the precheck will put on a git argv and hand to the gate as `origin/<name>`: a string that cannot be
 * read as an option (no leading dash or dot) and that the gate's own `isBaseRef` will not refuse (no `..`, no `.lock`).
 */
const isBranchName = (v) => typeof v === 'string' && v.length <= 200 && BRANCH_RE.test(v) && !v.includes('..') && !v.split('/').some((part) => part.endsWith('.lock'));

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** Default process runner: argv array, never a shell. Resolves `{status, stdout, stderr}`; never rejects. */
function defaultRun(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (!err) return resolve({ status: 0, stdout, stderr: stderr || '' });
      resolve({ status: typeof err.code === 'number' ? err.code : 127, stdout: stdout || '', stderr: stderr || String(err.message) });
    });
  });
}

const tail = (text) => String(text || '').trim().slice(0, 300);

/** `--paginate --slurp` yields an array of pages; flatten one level. */
function flattenPages(stdout) {
  const pages = JSON.parse(stdout);
  if (!Array.isArray(pages)) throw new Error('not an array');
  return pages.flatMap((p) => (Array.isArray(p) ? p : [p]));
}

/**
 * Build the real deps for one PR. `run`, `spawnProcess`, `kill`, `now` and `gateScript` are injectable so the
 * claim-and-start path can be exercised against a real filesystem without a real gate, network or signal.
 */
function makeDeps({ repo, pr, repoRoot, run = defaultRun, spawnProcess = spawn, kill = (pid, signal) => process.kill(pid, signal), now = () => new Date(), gateScript = path.join(__dirname, 'local-ci-cli.js') }) {
  const root = path.resolve(repoRoot);
  const stateDir = path.join(root, STATE_SUBDIR);
  const git = (args) => run('git', args, { cwd: root });
  const gh = (args) => run('gh', args, { cwd: root });
  const ghJson = async (args, flatten) => {
    const r = await gh(args);
    if (r.status !== 0) return { ok: false, error: `gh ${args[0]} ${args[1] || ''} failed: ${tail(r.stderr) || `exit ${r.status}`}` };
    try {
      return { ok: true, data: flatten ? flattenPages(r.stdout) : JSON.parse(r.stdout) };
    } catch (e) {
      return { ok: false, error: `gh ${args[0]} returned output that is not JSON (${e.message})` };
    }
  };
  const markerPath = (headSha, dryRun) => path.join(stateDir, `precheck-pr-${pr}-${headSha}${dryRun ? '.dry' : ''}.gate.json`);
  const rel = (p) => path.relative(root, p);
  /**
   * The comment is public and carries `gh`/`git` stderr and file-system errors. Before it leaves this machine, strip anything
   * credential-shaped (token patterns and the GH_TOKEN/GITHUB_TOKEN values) and the absolute location of this checkout and of
   * the user's home, which would otherwise name the local user and directory layout.
   */
  const publishable = (text) => {
    let out = redact(text, process.env);
    if (root.length > 1) out = out.split(`${root}${path.sep}`).join('').split(root).join('.');
    const home = os.homedir();
    if (typeof home === 'string' && home.length > 1) out = out.split(home).join('~');
    return out;
  };
  /**
   * Whether a process with this pid exists: true or false, or null when `pid` is not a usable pid. EPERM means it exists but is
   * not ours. It cannot tell the gate from an unrelated process that reused its pid, so "alive" means "a process has that pid".
   */
  const probe = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM';
    }
  };
  /**
   * What a start marker says now. A recorded gate is `alive` or not (see `probe`). A claim with NO gate recorded is
   * `alive: null` while it is young and the run that made it is still going; otherwise that run died first and the marker is
   * `orphaned`.
   */
  const describeMarker = (file) => {
    let data = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isObject(parsed)) data = parsed;
    } catch (_e) {
      data = {};
    }
    const gatePid = Number.isInteger(data.pid) && data.pid > 0 ? data.pid : undefined;
    const info = {
      pid: gatePid,
      startedAt: data.startedAt,
      claimedAt: data.claimedAt,
      claimer: Number.isInteger(data.claimer) ? data.claimer : undefined,
      marker: rel(file),
      mode: file.endsWith('.dry.gate.json') ? 'dry-run' : 'real',
    };
    if (gatePid !== undefined) return { ...info, alive: probe(gatePid), orphaned: false };
    let claimedMs = Date.parse(data.claimedAt);
    if (!Number.isFinite(claimedMs)) {
      try {
        claimedMs = fs.statSync(file).mtimeMs;
      } catch (_e) {
        claimedMs = NaN;
      }
    }
    const young = Number.isFinite(claimedMs) && now().getTime() - claimedMs <= CLAIM_GRACE_MS;
    const orphaned = !(young && probe(info.claimer) !== false);
    return { ...info, alive: orphaned ? false : null, orphaned };
  };

  const closeQuietly = (fd) => {
    if (fd === undefined) return;
    try {
      fs.closeSync(fd);
    } catch (_e) {
      // best effort: the child holds its own copy
    }
  };
  /** Merge the recorded gate into the claim and replace the marker whole, so a reader never sees a half-written file. */
  const recordGate = (file, gate) => {
    let claim = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isObject(parsed)) claim = parsed;
    } catch (_e) {
      claim = {};
    }
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ ...claim, ...gate }));
      fs.renameSync(tmp, file);
    } catch (e) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch (_e) {
        // best effort
      }
      throw e;
    }
  };
  /**
   * Stop a gate that was started but could not be recorded. It was spawned detached, so it leads its own process group and
   * its steps run in it: the group is signalled (SIGKILL cannot be caught or ignored). True when nothing is left running: the
   * signal went out, or neither the group nor the process exists any more. Never signals a pid that could name every process.
   */
  const stopGate = (pid) => {
    if (!Number.isInteger(pid) || pid <= 1) return false;
    for (const target of [-pid, pid]) {
      try {
        kill(target, 'SIGKILL');
        return true;
      } catch (e) {
        if (!e || e.code !== 'ESRCH') return false;
      }
    }
    return true;
  };

  /** What stops a gate from starting for this head because another gate holds the runner's one clone of it, or null. */
  const blockedBy = (headSha, ownFile) => {
    let names = [];
    try {
      names = fs.readdirSync(stateDir);
    } catch (_e) {
      names = [];
    }
    const sibling = new RegExp(`^precheck-pr-\\d+-${headSha}(?:\\.dry)?\\.gate\\.json$`);
    const other = names
      .filter((name) => sibling.test(name) && path.join(stateDir, name) !== ownFile)
      .map((name) => describeMarker(path.join(stateDir, name)))
      .find((m) => m.alive !== false || m.orphaned === true);
    if (other !== undefined) {
      const state = other.pid !== undefined ? `still running (pid ${other.pid}${other.startedAt ? `, started ${other.startedAt}` : ''})` : 'being started, or was interrupted while starting';
      return {
        kind: 'gate-running-for-head',
        reason: `a ${other.mode} gate for this head is ${state} (marker ${other.marker}); a dry run and a real run, or two pull requests with the same head, share the runner's one clone of the head, so a second gate would be refused by the runner and post nothing. Run the precheck again once that gate has finished`,
      };
    }
    const clone = path.join(root, RUNS_SUBDIR, headSha);
    let st = null;
    try {
      st = fs.lstatSync(clone);
    } catch (_e) {
      st = null;
    }
    if (st !== null && now().getTime() - st.mtimeMs <= STALE_CLONE_MS) {
      return {
        kind: 'clone-exists',
        reason: `the runner already holds a clone of this head (${rel(clone)}): an earlier gate run is still going, or died and left it. The runner never reuses a clone, so a gate started now would exit without posting a status. Remove the directory if no gate is running, then run the precheck again (the runner itself sweeps clones older than an hour)`,
      };
    }
    return null;
  };

  // `origin/<base>` must be fresh before the base-ref config/policy are read and before the gate runs (it refuses a
  // stale or absent remote-tracking ref). Fetched once per run.
  let baseFetch = null;
  const fetchBase = (baseRefName) => {
    if (baseFetch === null) {
      baseFetch = isBranchName(baseRefName)
        ? git(['fetch', '--quiet', 'origin', baseRefName]).then((r) => (r.status === 0 ? { ok: true } : { ok: false, error: `git fetch origin ${baseRefName} failed: ${tail(r.stderr)}` }))
        : Promise.resolve({ ok: false, error: 'the base branch name is not usable' });
    }
    return baseFetch;
  };

  // Every network step of a start, done BEFORE the claim (see `startOnce` in the pure module): a run that dies while
  // fetching then leaves nothing behind. The gate checks the base/head relationship in THIS clone before it clones the
  // head itself, so the head commit must be present locally; GitHub serves a commit by sha, the PR's own ref is the
  // fallback. Memoized per base and head, so `startGate` re-reads the settled answer without touching the network.
  const preparing = new Map();
  const prepare = (headSha, baseRefName) => {
    const key = `${baseRefName}@${headSha}`;
    if (!preparing.has(key)) {
      preparing.set(key, (async () => {
        const f = await fetchBase(baseRefName);
        if (!f.ok) return f;
        if (!SHA_RE.test(headSha)) return { ok: false, error: 'the head commit is not a full sha' };
        if ((await git(['cat-file', '-e', `${headSha}^{commit}`])).status === 0) return { ok: true };
        let got = await git(['fetch', '--quiet', 'origin', headSha]);
        if (got.status !== 0) got = await git(['fetch', '--quiet', 'origin', `refs/pull/${pr}/head`]);
        if (got.status !== 0) return { ok: false, error: `git fetch of the PR head ${headSha} failed: ${tail(got.stderr)}` };
        return { ok: true };
      })());
    }
    return preparing.get(key);
  };
  let viewer = null;
  const viewerLogin = () => {
    if (viewer === null) {
      viewer = ghJson(['api', 'user']).then((r) => (r.ok && isText(r.data && r.data.login) ? { ok: true, login: r.data.login } : { ok: false, error: r.error || 'gh api user returned no login' }));
    }
    return viewer;
  };

  return {
    async readPr() {
      const r = await ghJson(['pr', 'view', String(pr), '--repo', repo, '--json', 'headRefOid,baseRefName,state,body,author,isCrossRepository']);
      if (!r.ok) return r;
      const d = r.data;
      if (!isObject(d) || !isBranchName(d.baseRefName)) return { ok: false, error: 'gh pr view returned no usable base branch' };
      return { ok: true, headSha: d.headRefOid, baseRefName: d.baseRefName, state: d.state, body: typeof d.body === 'string' ? d.body : '', author: isObject(d.author) ? d.author.login : undefined, isCrossRepository: d.isCrossRepository };
    },

    async readReviews() {
      const r = await ghJson(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${pr}/reviews?per_page=100`], true);
      if (!r.ok) return r;
      return {
        ok: true,
        reviews: r.data.map((x) => ({
          login: isObject(x.user) ? x.user.login : undefined,
          authorType: isObject(x.user) ? x.user.type : undefined,
          state: x.state,
          commitSha: x.commit_id,
          submittedAt: x.submitted_at,
        })),
      };
    },

    async readHeadTree(headSha) {
      const r = await ghJson(['api', `repos/${repo}/git/commits/${headSha}`]);
      return r.ok && isObject(r.data.tree) ? { ok: true, treeSha: r.data.tree.sha } : { ok: false, error: r.error || 'no tree in the commit' };
    },

    async readProtection(baseRefName) {
      if (!isBranchName(baseRefName)) return { ok: false, error: 'the base branch name is not usable' };
      const r = await gh(['api', `repos/${repo}/branches/${baseRefName}/protection`]);
      if (r.status === 0) {
        try {
          return { ok: true, protection: JSON.parse(r.stdout) };
        } catch (_e) {
          return { ok: false, error: 'branch protection answered with output that is not JSON' };
        }
      }
      // Only GitHub's exact "Branch not protected" 404 says there is no rule. Any other failure (no admin access,
      // missing branch, rate limit, network) is an unreadable answer: `unknown`, never `absent` or `enforced`.
      let message = '';
      try {
        message = JSON.parse(r.stdout).message;
      } catch (_e) {
        message = '';
      }
      if (message === 'Branch not protected' && /HTTP 404/.test(r.stderr)) return { ok: true, notProtected: true };
      return { ok: false, error: tail(r.stderr) || `exit ${r.status}` };
    },

    async readStatuses(headSha) {
      const r = await ghJson(['api', '--paginate', '--slurp', `repos/${repo}/commits/${headSha}/statuses?per_page=100`], true);
      if (!r.ok) return r;
      // The list is for exactly this ref; bind each entry to it so a status can never be read for another commit.
      return { ok: true, statuses: r.data.map((s) => ({ context: s.context, state: s.state, description: s.description, sha: headSha })) };
    },

    async readGateConfig(baseRefName) {
      const f = await fetchBase(baseRefName);
      if (!f.ok) return f;
      // The status context comes ONLY from the config committed at the base ref (the gate's own trust rule).
      const rev = await git(['rev-parse', '--verify', '--end-of-options', `refs/remotes/origin/${baseRefName}^{commit}`]);
      const baseSha = String(rev.stdout || '').trim();
      if (rev.status !== 0 || !SHA_RE.test(baseSha)) return { ok: false, error: `origin/${baseRefName} does not resolve to a commit in ${root}` };
      const shown = await git(['show', `${baseSha}:.ensemble/local-ci.yaml`]);
      if (shown.status !== 0) return { ok: false, error: `no .ensemble/local-ci.yaml at origin/${baseRefName}: local CI is not configured for this base` };
      let cfg;
      try {
        cfg = require('./local-ci-config').validateConfig(shown.stdout);
      } catch (e) {
        return { ok: false, error: `the local-ci config could not be validated: ${e.message}` };
      }
      if (!cfg || cfg.ok !== true || !cfg.approvalSet || !isText(cfg.approvalSet.statusContext)) {
        return { ok: false, error: `unusable .ensemble/local-ci.yaml at origin/${baseRefName}: ${((cfg && cfg.problems) || ['invalid']).join('; ').slice(0, 300)}` };
      }
      return { ok: true, statusContext: cfg.approvalSet.statusContext };
    },

    async readPolicy(baseRefName) {
      const f = await fetchBase(baseRefName);
      if (!f.ok) return f;
      const rev = await git(['rev-parse', '--verify', '--end-of-options', `refs/remotes/origin/${baseRefName}^{commit}`]);
      const baseSha = String(rev.stdout || '').trim();
      if (rev.status !== 0 || !SHA_RE.test(baseSha)) return { ok: false, error: 'the base commit could not be resolved' };
      // A missing REVIEW.md is the documented "no policy file" case (strict defaults), not a read failure.
      const has = await git(['cat-file', '-e', `${baseSha}:REVIEW.md`]);
      let text;
      if (has.status === 0) {
        const shown = await git(['show', `${baseSha}:REVIEW.md`]);
        if (shown.status !== 0) return { ok: false, error: `git show REVIEW.md failed: ${tail(shown.stderr)}` };
        text = shown.stdout;
      }
      const loaded = require('./pr-review-policy').loadPolicy({ text, baseSha, sourceSha: baseSha });
      return loaded.ok === true ? { ok: true, policy: loaded.policy } : { ok: false, error: `policy not usable: ${loaded.reason}` };
    },

    prepareGate({ headSha, baseRefName }) {
      return prepare(headSha, baseRefName);
    },

    /**
     * Atomic create-once marker: exactly one concurrent caller gets `claimed:true` for a head. Not a queue or lock.
     *
     * The runner's clone is keyed by the head sha alone, so only ONE gate can run per sha whatever its mode or PR: a second
     * one finds the clone and exits without posting. So after a claim is made it is given back, with `blocked`, when another
     * gate for this sha (the other mode, another PR) is running, being started or was interrupted while starting, or when
     * the runner already holds a clone of it that it has not yet swept.
     */
    claimGateStart({ headSha, dryRun }) {
      if (!SHA_RE.test(headSha)) return { claimed: false, error: 'the head commit is not a full sha' };
      const file = markerPath(headSha, dryRun);
      let fd;
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fd = fs.openSync(file, 'wx');
      } catch (e) {
        if (e.code === 'EEXIST') return { claimed: false, existing: describeMarker(file) };
        return { claimed: false, error: e.message };
      }
      try {
        fs.writeSync(fd, JSON.stringify({ headSha, pr, mode: dryRun ? 'dry-run' : 'real', claimedAt: now().toISOString(), claimer: process.pid }));
      } catch (e) {
        fs.rmSync(file, { force: true });
        return { claimed: false, error: `could not record the claim: ${e.message}` };
      } finally {
        fs.closeSync(fd);
      }
      const blocked = blockedBy(headSha, file);
      if (blocked !== null) {
        fs.rmSync(file, { force: true });
        return { claimed: false, blocked };
      }
      return { claimed: true };
    },

    releaseGateStart({ headSha, dryRun }) {
      fs.rmSync(markerPath(headSha, dryRun), { force: true });
    },

    /**
     * Start the existing `local-ci-cli.js gate` detached, its input from a file and its output to a log.
     *
     * Everything that can fail without a gate existing happens BEFORE the spawn. From the spawn on a gate process exists, so
     * its claim must never be released while it may still run (the next run would start a second gate for the head): the pid
     * is recorded in the same turn as the spawn, and if even that fails the gate is killed and the answer says whether it may
     * still be running (`mayBeRunning`), which is what tells the caller to keep the claim.
     */
    async startGate({ headSha, baseRefName, dryRun }) {
      const prep = await prepare(headSha, baseRefName);
      if (!prep.ok) return prep;
      const file = markerPath(headSha, dryRun);
      const stem = path.join(stateDir, `precheck-pr-${pr}-${headSha}${dryRun ? '.dry' : ''}.gate`);
      const input = `${stem}-input.json`;
      const logPath = `${stem}.log`;
      const payload = { repoRoot: root, headSha, baseRef: `origin/${baseRefName}`, repo, pr, ...(dryRun ? { dryRun: true } : {}) };
      let inFd;
      let outFd;
      let child;
      try {
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(input, JSON.stringify(payload));
        inFd = fs.openSync(input, 'r');
        outFd = fs.openSync(logPath, 'a');
        child = spawnProcess(process.execPath, [gateScript, 'gate'], { cwd: root, detached: true, stdio: [inFd, outFd, outFd] });
      } catch (e) {
        return { ok: false, error: `could not start the gate: ${e.message}` };
      } finally {
        closeQuietly(inFd);
        closeQuietly(outFd);
      }
      if (!Number.isInteger(child.pid)) {
        // `spawn` reports a failure to launch asynchronously and gives no pid: nothing is running.
        const spawnError = await new Promise((resolve) => {
          child.once('error', (e) => resolve(e));
          setImmediate(() => resolve(null));
        });
        return { ok: false, error: `could not start the gate: ${spawnError ? spawnError.message : 'no pid'}` };
      }
      // A gate process exists from here on.
      try {
        child.unref();
        const startedAt = now().toISOString();
        recordGate(file, { pid: child.pid, startedAt, logPath });
        return { ok: true, pid: child.pid, logPath, startedAt };
      } catch (e) {
        const stopped = stopGate(child.pid);
        return {
          ok: false,
          pid: child.pid,
          mayBeRunning: !stopped,
          error: `the gate was started (pid ${child.pid}) but could not be recorded: ${e.message}; ${stopped ? 'it was stopped' : `it could not be stopped and may still be running (stop it with: kill -KILL -- -${child.pid})`}`,
        };
      }
    },

    /** Our one comment on this PR: carries the marker AND was written by the login `gh` is using now. */
    async findComment() {
      const who = await viewerLogin();
      if (!who.ok) return { ok: false, error: who.error };
      const r = await ghJson(['api', '--paginate', '--slurp', `repos/${repo}/issues/${pr}/comments?per_page=100`], true);
      if (!r.ok) return r;
      const mine = r.data.filter((c) => isObject(c) && typeof c.body === 'string' && c.body.startsWith(COMMENT_MARKER) && isObject(c.user) && String(c.user.login).toLowerCase() === who.login.toLowerCase());
      // If something earlier left more than one, update the oldest and never add another.
      mine.sort((a, b) => a.id - b.id);
      return { ok: true, comment: mine.length > 0 ? { id: mine[0].id, body: mine[0].body } : null };
    },

    async postComment(body) {
      const r = await ghJson(['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '-f', `body=${publishable(body)}`]);
      return r.ok ? { ok: true, id: r.data.id, url: r.data.html_url } : r;
    },

    async updateComment(id, body) {
      if (!Number.isInteger(id)) return { ok: false, error: 'the existing comment has no usable id' };
      const r = await ghJson(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${id}`, '-f', `body=${publishable(body)}`]);
      return r.ok ? { ok: true, id: r.data.id, url: r.data.html_url } : r;
    },
  };
}

function validatePayload(payload) {
  if (!isObject(payload)) throw new Error('payload must be a JSON object');
  const unknown = Object.keys(payload).filter((k) => !PAYLOAD_KEYS.includes(k));
  if (unknown.length > 0) throw new Error(`unknown payload key(s) ${unknown.join(', ')}; allowed: ${PAYLOAD_KEYS.join(', ')}`);
  if (typeof payload.repo !== 'string' || !REPO_RE.test(payload.repo) || payload.repo.length > 140 || payload.repo.startsWith('-') || payload.repo.startsWith('.')) throw new Error('repo is missing or malformed (owner/name)');
  if (!Number.isInteger(payload.pr) || payload.pr < 1 || payload.pr > 2147483647) throw new Error('pr is missing or not a positive integer');
  if (!isText(payload.repoRoot)) throw new Error('repoRoot is missing');
  if (payload.dryRun !== undefined && typeof payload.dryRun !== 'boolean') throw new Error('dryRun must be a boolean');
  if (payload.tier !== undefined && !isObject(payload.tier)) throw new Error('tier must be a pr-review-cli tier record');
  return payload;
}

function readStdinJson(fd = 0) {
  const chunks = [];
  let total = 0;
  const buf = Buffer.alloc(64 * 1024);
  for (;;) {
    let n;
    try {
      n = fs.readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      if (err.code === 'EAGAIN') continue;
      if (err.code === 'EOF') break;
      throw err;
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_STDIN_BYTES) throw new Error(`payload exceeds ${MAX_STDIN_BYTES} bytes`);
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Entry point: resolves to the exit code. `injected` may replace `readJson`, `write` and `deps`. */
async function main(injected) {
  const io = { readJson: readStdinJson, write: (s) => process.stdout.write(s), ...(injected || {}) };
  const emit = (value) => io.write(`${JSON.stringify(redact(value))}\n`);
  let payload;
  try {
    payload = validatePayload(io.readJson());
  } catch (err) {
    emit({ ok: false, error: err.message });
    return 1;
  }
  try {
    const deps = (injected && injected.deps) || makeDeps(payload);
    const result = await runPrecheck({ dryRun: payload.dryRun, tier: payload.tier }, deps);
    emit(result);
    return result.ok === false ? 1 : 0;
  } catch (err) {
    emit({ ok: false, error: err && err.message ? err.message : String(err) });
    return 1;
  }
}

module.exports = { main, makeDeps, validatePayload, STATE_SUBDIR };

if (require.main === module) {
  main().then((code) => process.exit(code));
}
