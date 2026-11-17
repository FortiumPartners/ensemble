'use strict';

/**
 * REQ-001 trigger check for /ensemble:author-playwright-tests.
 *
 * A test-authoring session may only start once implement-trd-tasks has
 * shipped a PR boundary for the target branch. TRD-003's original
 * `checkPrState()` shelled out directly to the `gh` (GitHub CLI) binary --
 * fine for a GitHub-hosted repo, but this TRD's own consuming application is
 * hosted on Azure DevOps Repos, where that approach cannot resolve anything
 * at all. `checkPrState()`'s exec-failure path used to silently return
 * `hasOpenPr: false`, so an Azure-DevOps-hosted repo would permanently
 * report "no open PR" regardless of true PR state (TRD-031, v1.2.0).
 *
 * TRD-038 (this wave) removes the direct host-binary invocation entirely:
 * `checkPrState()` now routes through the `host.change-request-list`
 * toolchain capability (TRD-035/TRD-036), shelling out to
 * `packages/development/lib/toolchain-cli.js` instead of a host CLI
 * directly. `packages/e2e-testing` cannot `require()` anything under
 * `packages/development` (confirmed architectural package boundary), so
 * `resolveToolchainCliPath()` below re-implements the tool-path-resolution
 * skill's documented tier order in plain JS rather than importing a shared
 * helper. `host.change-request-list`'s adapter-level run template has no
 * `${filter}` placeholder (every shipped host adapter relies on its own
 * CLI's default "open" scoping instead -- see `adapter-host-github`'s
 * `adapter.yaml`), so branch matching happens client-side here, same as
 * `checkPrStateAdo()` already does for Azure DevOps.
 *
 * This wave also changes `checkPrState()`'s exec-failure behavior
 * (deliberately, not a regression): the old code's `catch { return
 * {hasOpenPr:false, ...} }` silently conflated "the tool call itself
 * failed" (missing binary, unauthenticated, network error, adapter
 * resolution failure) with "the call succeeded and legitimately found no
 * PR" -- both produced the exact same `{hasOpenPr:false}` shape, so a caller
 * could never distinguish "no PR yet" from "the check didn't actually run".
 * `checkPrState()` now lets an `exec()` throw (tool spawn/non-zero-exit
 * failure) and a non-`ok` toolchain-cli envelope both propagate as thrown
 * `Error`s; only a well-formed envelope with no matching item for `branch`
 * returns the normal `{hasOpenPr:false, ...}` shape.
 *
 * TRD-031 adds two things, additive only -- `checkPrState()`'s own GitHub
 * behavior is untouched:
 *   1. `detectRepoHost(opts)` - classify the `origin` remote as
 *      'github' | 'azure-devops' | 'unknown', parsing
 *      {organization, project, repository} out of an Azure DevOps URL.
 *   2. `checkPrStateAdo(branch, prs)` - pure decision logic (no MCP client
 *      here — Azure DevOps MCP tools are only invocable by the orchestrating
 *      agent at conversation time, matching ado-test-suite.js's/
 *      ado-test-case-sync.js's established boundary) that normalizes an
 *      already-fetched Azure DevOps PR list into the exact same
 *      {hasOpenPr, state, url, number, baseBranch} shape checkPrState()
 *      returns for GitHub, so nothing downstream needs to know which host
 *      produced it.
 *
 * The orchestrator (author-playwright-tests.yaml) calls detectRepoHost()
 * first, then either checkPrState() (github/unknown) or an Azure DevOps MCP
 * PR-list call followed by checkPrStateAdo() (azure-devops).
 *
 * Both functions also surface `baseBranch` (the PR's real target/base
 * branch) so the orchestrator can pass it to implementation-grounding.js's
 * `groundImplementation(reqId, trdPath, {baseBranch})` instead of letting
 * that module fall back to its hardcoded main/origin-main default — some
 * consuming repos' feature branches target `integration` rather than `main`,
 * and would otherwise ground against the wrong branch entirely. Found
 * live-dogfooding this feature against a real, open PR in the consuming
 * application, where a manual diff against `main` pulled in unrelated
 * already-integrated work as if it belonged to the PR under test.
 *
 * checkPrStateAdo() also accepts the Azure DevOps MCP server's numeric
 * `status` representation, not just the raw REST API's string form — see
 * `isAdoStatusActive()` below.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NO_OPEN_PR_MESSAGE =
  'No open PR found for this branch. Run `/ensemble:implement-trd-tasks` first ' +
  'to ship a PR boundary before starting an author-playwright-tests session.';

const TOOLCHAIN_CLI_RELATIVE_PATH = 'packages/development/lib/toolchain-cli.js';

/**
 * Resolve `packages/development/lib/toolchain-cli.js`'s on-disk path, re-implementing the
 * tool-path-resolution skill's documented tier order in plain JS (`packages/e2e-testing`
 * cannot `require()` anything under `packages/development`, so there is no shared helper to
 * import). The first tier whose candidate path exists on disk wins; `null` when none do.
 *
 * @returns {string|null}
 */
function resolveToolchainCliPath() {
  // Tier 1: canonical monorepo root (dogfooding).
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    if (root) {
      const candidate = path.join(root, TOOLCHAIN_CLI_RELATIVE_PATH);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // Not a git repo, or git unavailable -- fall through to the next tier.
  }

  // Tier 2: legacy CWD-relative (works when CWD is already the monorepo root).
  if (fs.existsSync(TOOLCHAIN_CLI_RELATIVE_PATH)) {
    return TOOLCHAIN_CLI_RELATIVE_PATH;
  }

  // Tier 3: Claude Code plugin root, RELATIVE_PATH's `packages/development/` prefix stripped.
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    const candidate = path.join(process.env.CLAUDE_PLUGIN_ROOT, 'lib', 'toolchain-cli.js');
    if (fs.existsSync(candidate)) return candidate;
  }

  // Tier 4: Pi/OMP vendor bundle -- resolve `@sunstone-partners/ensemble-pi`'s own declared
  // install location (never hardcode a ~/.omp/plugins path).
  try {
    const searchPaths = [
      process.env.ENSEMBLE_PI_INSTALL_ROOT,
      path.join(os.homedir(), '.omp', 'plugins'),
      process.cwd(),
    ].filter(Boolean);
    const pkgJsonPath = require.resolve('@sunstone-partners/ensemble-pi/package.json', {
      paths: searchPaths,
    });
    const candidate = path.join(path.dirname(pkgJsonPath), 'vendor', 'lib', 'toolchain-cli.js');
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // Not installed as a Pi/OMP vendor bundle either.
  }

  return null;
}

/**
 * Default `host.change-request-list` invocation, via `toolchain-cli.js run` -- swappable via
 * the `exec` option for tests. Returns raw stdout (the toolchain-cli `--json` envelope,
 * `{ok, data: {items}}` or `{ok:false, error}`), never pre-parsed, matching this module's
 * existing injectable-exec convention (implementation-grounding.js's own doc comment on this
 * pattern).
 *
 * @param {string[]} args extra argv appended after the resolved toolchain-cli path
 * @returns {string}
 */
function defaultExec(args) {
  const toolchainCliPath = resolveToolchainCliPath();
  if (!toolchainCliPath) {
    throw new Error(
      'checkPrState: could not locate toolchain-cli.js (see the tool-path-resolution skill)'
    );
  }
  return execFileSync(process.execPath, [toolchainCliPath, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

/** Default `origin` remote-URL lookup — swappable via `opts.gitExec` for tests. */
function defaultGitExec() {
  return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: 'pipe' });
}

// https://dev.azure.com/<org>/<project>/_git/<repo>, optionally with a
// "user@" prefix and/or a trailing ".git" — the modern ADO Repos URL shape.
const AZURE_DEVOPS_MODERN_RE = /dev\.azure\.com\/(?:[^/@]+@)?([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/i;
// https://<org>.visualstudio.com/<project>/_git/<repo> — the legacy ADO URL shape.
const AZURE_DEVOPS_LEGACY_RE = /([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+?)(?:\.git)?\/?$/i;

/**
 * Classify the repo's `origin` remote by git host, so the orchestrator knows
 * whether to use `checkPrState()` (GitHub) or an Azure DevOps MCP PR-list
 * call + `checkPrStateAdo()`. Never throws — an unresolvable remote is
 * `{host: 'unknown', remoteUrl: null}`, not an exception.
 *
 * @param {object} [opts]
 * @param {() => string} [opts.gitExec] - injectable `git remote get-url origin` runner
 * @returns {{host: 'github', remoteUrl: string}
 *          |{host: 'azure-devops', remoteUrl: string, organization: string, project: string, repository: string}
 *          |{host: 'unknown', remoteUrl: string|null}}
 */
function detectRepoHost(opts = {}) {
  const gitExec = opts.gitExec || defaultGitExec;

  let remoteUrl;
  try {
    remoteUrl = String(gitExec()).trim();
  } catch {
    return { host: 'unknown', remoteUrl: null };
  }
  if (!remoteUrl) {
    return { host: 'unknown', remoteUrl: null };
  }

  if (/github\.com/i.test(remoteUrl)) {
    return { host: 'github', remoteUrl };
  }

  const modernMatch = remoteUrl.match(AZURE_DEVOPS_MODERN_RE);
  if (modernMatch) {
    return {
      host: 'azure-devops',
      remoteUrl,
      organization: modernMatch[1],
      project: decodeURIComponent(modernMatch[2]),
      repository: decodeURIComponent(modernMatch[3]),
    };
  }

  const legacyMatch = remoteUrl.match(AZURE_DEVOPS_LEGACY_RE);
  if (legacyMatch) {
    return {
      host: 'azure-devops',
      remoteUrl,
      organization: legacyMatch[1],
      project: decodeURIComponent(legacyMatch[2]),
      repository: decodeURIComponent(legacyMatch[3]),
    };
  }

  return { host: 'unknown', remoteUrl };
}

/**
 * Check whether an open PR exists for the given branch, via the `host.change-request-list`
 * toolchain capability (GitHub and any other host the resolved adapter supports).
 *
 * `baseBranch` is surfaced so callers (e.g. author-playwright-tests.yaml's
 * implementation-grounding step) can diff against the PR's real target
 * branch instead of guessing main/origin-main — see implementation-grounding.js's
 * own `opts.baseBranch`.
 *
 * Unlike the pre-TRD-038 version, a failure to actually perform the check — `exec()` throwing
 * (toolchain-cli missing, adapter not installed/authenticated, non-zero exit, etc.), malformed
 * JSON stdout, or a `{ok:false}` toolchain-cli envelope — is a thrown `Error`, not a silent
 * `{hasOpenPr:false}`. Only a successful envelope with no item matching `branch` returns
 * `{hasOpenPr:false, ...}`: that is the one legitimate "no PR yet" outcome, and it must stay
 * distinguishable from "the check itself failed to run".
 *
 * @param {string} branch - branch name to check (e.g. current git branch)
 * @param {object} [opts]
 * @param {(args: string[]) => string} [opts.exec] - injectable toolchain-cli invocation, returns raw stdout
 * @returns {{hasOpenPr: boolean, state: string|null, url: string|null, number: number|null, baseBranch: string|null}}
 * @throws {Error} when the toolchain-cli call fails, its stdout is not valid JSON, or it
 *   returns a non-`ok` envelope
 */
function checkPrState(branch, opts = {}) {
  const exec = opts.exec || defaultExec;
  const args = ['run', 'host.change-request-list', '--json'];

  // Deliberately NOT wrapped in try/catch — a spawn/non-zero-exit failure here must propagate
  // as a real thrown error (see this function's own doc comment above).
  const raw = exec(args);

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`checkPrState: toolchain-cli returned non-JSON output: ${raw}`, { cause });
  }

  if (!envelope || envelope.ok !== true) {
    const message =
      (envelope && envelope.error && envelope.error.message) || 'unknown toolchain-cli failure';
    throw new Error(`checkPrState: host.change-request-list failed: ${message}`);
  }

  const items = (envelope.data && Array.isArray(envelope.data.items)) ? envelope.data.items : [];
  const pr = items.find((item) => item && item.headBranch === branch);

  if (!pr) {
    return { hasOpenPr: false, state: null, url: null, number: null, baseBranch: null };
  }

  const number = typeof pr.id === 'number'
    ? pr.id
    : typeof pr.id === 'string' && /^\d+$/.test(pr.id)
      ? Number(pr.id)
      : null;

  return {
    hasOpenPr: true,
    state: pr.state || 'OPEN',
    url: pr.url || null,
    number,
    baseBranch: pr.baseBranch || null,
  };
}

/**
 * True when an Azure DevOps PR `status` value means "active", regardless of
 * which representation the caller sent it in. The raw Azure DevOps REST API
 * returns `status` as the string `"active"`, but the Azure DevOps MCP server
 * observed in practice serializes it as the underlying .NET
 * `PullRequestStatus` enum's numeric ordinal instead (`1` = Active; `0` =
 * NotSet, `2` = Abandoned, `3` = Completed) — a real repo's live PR list came
 * back as `status: 1`, which the string-only check below used to miss
 * entirely, always reporting `hasOpenPr: false` regardless of branch match.
 */
function isAdoStatusActive(status) {
  if (typeof status === 'number') return status === 1;
  if (typeof status === 'string') return status.toLowerCase() === 'active';
  return false;
}

/**
 * Check whether an open PR exists for the given branch, given a PR list the
 * orchestrator already fetched from the Azure DevOps MCP server (e.g. its
 * `repo_list_pull_requests_by_repo_or_project`-equivalent tool). Pure — no
 * MCP client here, matching ado-test-suite.js's/ado-test-case-sync.js's
 * established boundary. Returns the exact same shape `checkPrState()` does.
 *
 * Azure DevOps PR resource fields used: `status` (see `isAdoStatusActive()`
 * for the string/numeric representations accepted), `sourceRefName` (e.g.
 * "refs/heads/feature/x"), `targetRefName` (surfaced as `baseBranch`, stripped
 * of its `refs/heads/` prefix), `pullRequestId`, `url`.
 *
 * @param {string} branch - branch name to check (e.g. current git branch)
 * @param {Array<object>} prs - already-fetched Azure DevOps PR objects
 * @returns {{hasOpenPr: boolean, state: string|null, url: string|null, number: number|null, baseBranch: string|null}}
 */
function checkPrStateAdo(branch, prs) {
  const list = Array.isArray(prs) ? prs : [];
  const targetRef = `refs/heads/${branch}`;

  const match = list.find(
    (pr) => pr && isAdoStatusActive(pr.status) && pr.sourceRefName === targetRef
  );

  if (!match) {
    return { hasOpenPr: false, state: null, url: null, number: null, baseBranch: null };
  }

  return {
    hasOpenPr: true,
    state: 'active',
    url: match.url || null,
    number: typeof match.pullRequestId === 'number' ? match.pullRequestId : null,
    baseBranch:
      typeof match.targetRefName === 'string'
        ? match.targetRefName.replace(/^refs\/heads\//, '')
        : null,
  };
}

module.exports = {
  checkPrState,
  checkPrStateAdo,
  detectRepoHost,
  NO_OPEN_PR_MESSAGE,
  // exported for unit testing of the helper
  isAdoStatusActive,
};
