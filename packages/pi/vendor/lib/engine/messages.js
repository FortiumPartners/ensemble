'use strict';

/**
 * TRD-006 (TRD-2026-d571763f): the texts the engine prints, each one kept exactly as the skill
 * prints it today.
 *
 * A thinned skill that delegates a decision to the engine must still print what it printed
 * before, so these constants are copied verbatim from their source file and carry its anchor.
 * The `ERROR: ` prefix is part of the text for that reason. A test asserts each constant is a
 * substring of the file cited above it; retyping one would make that test fail, which is the
 * point.
 *
 * Texts with no verbatim source are authored in the pattern of the nearest sourced sentence and
 * say so.
 */
/** phase-1-preflight.md:7 */
const PLAN_EXECUTE_EXCLUSIVE = "ERROR: --plan and --execute are mutually exclusive.";

/** phase-1-preflight.md:8 */
const GENERATE_ONLY_CONFLICT = "ERROR: --generate-only only generates the workstream TRD and cannot be combined with --plan, --execute, --status, --reset-task, --list, --branch or --use-current-branch.";

/** phase-1-preflight.md:9 */
const MULTIPLE_TRDS = "ERROR: Multiple TRDs passed directly (deprecated: it can lose fidelity). Run /ensemble:implement-trd-tasks --workstream --generate-only <trd1> <trd2> ... then run the generated workstream TRD, or rerun with --workstream.";

/** phase-1-preflight.md:11 */
const GENERATE_ONLY_REQUIRES_WORKSTREAM = "ERROR: --generate-only requires --workstream and two or more TRD paths.";

/** implement-trd-tasks-reference/SKILL.md:64 */
const EXECUTE_NEEDS_SCAFFOLD = "ERROR: --execute requires an existing bead scaffold. Run /ensemble:implement-trd-tasks --plan first.";

/** implement-trd-tasks-reference/SKILL.md:63 */
const WORKTREE_DIRTY = "ERROR: working directory is dirty. Commit, stash or revert before starting a new build.";

/**
 * Two flags that cannot be given together. Authored in the pattern of
 * phase-1-preflight.md:7, because phase-1-preflight.md:16 and
 * implement-trd-tasks-reference/SKILL.md:21 only say HALT and print no text.
 * @param {string} first
 * @param {string} second
 * @returns {string}
 */
function exclusive(first, second) {
  return `ERROR: ${first} and ${second} are mutually exclusive.`;
}

/** Both branch flags at once (phase-1-preflight.md:16). */
const BRANCH_FLAGS_EXCLUSIVE = exclusive('--branch', '--use-current-branch');

/**
 * `--use-current-branch` on a detached HEAD. Authored in the pattern of
 * phase-1-preflight.md:7 around the reference's own words, because
 * `implement-trd-tasks-reference/SKILL.md:26` quotes the reason and the way out
 * ("requires a current branch ... use --branch=<name>") but prints no full sentence.
 */
const DETACHED_HEAD =
  'ERROR: --use-current-branch requires a current branch, but HEAD is detached; use --branch=<name>.';

/**
 * A named or saved branch that does not exist locally, which the reference HALTs on
 * (`implement-trd-tasks-reference/SKILL.md:29`: "must already exist (switch to it), else HALT").
 * Authored in the pattern of phase-1-preflight.md:7, because that line prints no text.
 * @param {string} name the branch that was asked for
 * @returns {string}
 */
function branchNotFound(name) {
  return `ERROR: branch '${name}' does not exist locally. Create it first, or pass --use-proposed-branch to use the proposed branch.`;
}

/**
 * An agent the roster names that no runtime registered (phase-1-preflight.md:26, which prints
 * this sentence for `beads-build-wave`; the agent name is the only part that varies).
 * @param {string} name the unqualified agent name
 * @returns {string}
 */
function agentNotRegistered(name) {
  return `ERROR: agent ${name} is not registered in this session. Run /ensemble:reinstall-plugins and re-run.`;
}

/**
 * The reasons `validate-git-town.sh` gives for the two exit codes the skill halts on, quoted from
 * that script's own header (`packages/git/skills/git-town/scripts/validate-git-town.sh:13-14`).
 */
const GIT_TOWN_EXIT_REASONS = Object.freeze({
  3: 'git-town version too old (< 14.0.0)',
  4: 'not a git repository',
});

/**
 * git-town cannot be used here at all. Authored in the pattern of phase-1-preflight.md:7, because
 * `implement-trd-tasks-reference/SKILL.md:11` only says HALT and prints no text; the reason is
 * the script's own.
 * @param {number} exitCode 3 or 4
 * @returns {string}
 */
function gitTownUnusable(exitCode) {
  const reason = GIT_TOWN_EXIT_REASONS[exitCode] || 'validation failed';
  return `validate-git-town.sh exited ${exitCode} (${reason})`;
}

/**
 * The PR backend cannot be resolved and nobody can be asked. The three values and the "export one
 * in your shell profile" hint are what `implement-trd-tasks-reference/SKILL.md:15` prints in the
 * non-interactive case; the sentence is authored around them in that line's own wording.
 */
const PR_BACKEND_UNRESOLVED = [
  'PR backend resolution needed (unsupported host, no ENSEMBLE_PR_BACKEND set). Export one of the',
  'following in your shell profile, or pass --pr-backend <ado|manual|gh>:',
  '  ENSEMBLE_PR_BACKEND=ado',
  '  ENSEMBLE_PR_BACKEND=manual',
  '  ENSEMBLE_PR_BACKEND=gh',
].join('\n');

module.exports = {
  BRANCH_FLAGS_EXCLUSIVE,
  DETACHED_HEAD,
  EXECUTE_NEEDS_SCAFFOLD,
  GIT_TOWN_EXIT_REASONS,
  GENERATE_ONLY_CONFLICT,
  GENERATE_ONLY_REQUIRES_WORKSTREAM,
  MULTIPLE_TRDS,
  PLAN_EXECUTE_EXCLUSIVE,
  PR_BACKEND_UNRESOLVED,
  WORKTREE_DIRTY,
  agentNotRegistered,
  branchNotFound,
  exclusive,
  gitTownUnusable,
};
