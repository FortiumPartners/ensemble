const fs = require('fs');
const path = require('path');

const { readDevelopmentSkill } = require('./helpers/skill-workflow');

// beads-build is a skill-backed command: its YAML is a manifest and the prompt is its skill
// (SKILL.md + references/). The contract is pinned against the whole prompt.
const skillText = readDevelopmentSkill('ensemble-beads-build').prompt;

// Index of the `#### Step N.M: <title>` heading whose title is `title`.
function stepAt(text, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^#### Step [\\d.]+: ${escaped}`, 'm').exec(text);
  return match ? match.index : -1;
}

describe('beads-build clean-tree gate', () => {
  test('a fresh run still HALTs on a dirty working directory', () => {
    const text = skillText;
    expect(text).toContain('If STARTED_COUNT == 0');
    expect(text).toContain('ERROR: working directory is dirty. Commit, stash or revert before starting a new build.');
  });

  test('a resumed run warns and continues instead of halting', () => {
    const text = skillText;
    expect(text).toContain('If STARTED_COUNT > 0 and WORKTREE_STATUS is non-empty');
    expect(text).toContain('NOTE: resuming with a dirty working directory.');
    expect(text).toContain('Never stash, commit, checkout or clean these paths to satisfy a gate.');
  });

  // A wave boundary leaves every task of the finished wave closed and none
  // in_progress. Keying the gate on IN_PROGRESS_COUNT reads that as a fresh
  // run and HALTs on the WIP the resume exists to continue, which is the
  // failure this change removes. So the fresh-run test has to count closed
  // tasks too, and must not be expressible in terms of in_progress alone.
  test('closed tasks count as work already started, so a wave boundary is a resume', () => {
    const text = skillText;
    expect(text).toContain('STARTED_COUNT = IN_PROGRESS_COUNT + CLOSED_COUNT');
    // --all and --limit 0 both decide whether CLOSED_COUNT can be non-zero.
    // `br list --help`: -a/--all is "Include closed issues (default excludes
    // closed)" and --limit is "Maximum number of results (0 = unlimited,
    // default: 50)". The tracker.list capability's default-adapter mapping
    // (packages/development/skills/adapter-tracker-beads/adapter.yaml) runs
    // exactly `br list --all --limit 0 --json`, preserving that guarantee.
    expect(text).toContain('run tracker.list');
    expect(text).toContain('filter to status=="closed"');
    expect(text).not.toContain('If IN_PROGRESS_COUNT == 0 — this is a fresh run');
    expect(text).not.toContain('If IN_PROGRESS_COUNT > 0 and WORKTREE_STATUS is non-empty');
  });

  // Ordering, not presence: the broken file also contained a clean-tree gate.
  // It sat in step 3, one step ahead of the IN_PROGRESS_COUNT that decides
  // whether it applies.
  test('the gate is decided after epic discovery, never before it', () => {
    const text = skillText;
    const epicDiscovery = stepAt(text, 'Epic Discovery');
    const haltDecision = text.indexOf('ERROR: working directory is dirty.');
    expect(epicDiscovery).toBeGreaterThan(-1);
    expect(haltDecision).toBeGreaterThan(-1);
    expect(haltDecision).toBeGreaterThan(epicDiscovery);
  });

  test('preflight step 3 captures the status without deciding on it', () => {
    const text = skillText;
    expect(text).toContain('run workflow.status');
    expect(text).toContain('as WORKTREE_STATUS');
    expect(text).not.toContain('git status --porcelain — HALT if output non-empty');
  });
});

describe('beads-build Preflight resolve-sdlc rewiring (TRD-013)', () => {
  test('no unconditional HALT tied to validate-git-town.sh exit codes 1 or 2', () => {
    const text = skillText;
    const stepStart = stepAt(text, 'Git-Town and Working Directory Verification');
    const stepEnd = stepAt(text, 'Epic Discovery');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toMatch(/Exit codes 0 \(ok\), 1 \(not installed\), and 2 \(not configured\) no longer HALT here/);
    expect(stepBlock).toMatch(/Exit codes 3 \(version mismatch\) and 4 \(not a git repo\) are unaffected by this feature — HALT on those exactly as before/);
  });

  test('resolve-sdlc invocation is present', () => {
    const text = skillText;
    expect(text).toContain('node "$TRD_CLI" resolve-sdlc --git-town-exit-code');
    expect(text).toContain('RESOLVE_SDLC_RESULT');
  });

  test('four-option AskUserQuestion block for PR backend resolution is present', () => {
    const text = skillText;
    const stepStart = stepAt(text, 'Git-Town and Working Directory Verification');
    const stepEnd = stepAt(text, 'Epic Discovery');
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("id='pr_backend'");
    expect(stepBlock).toContain("label:'ado'");
    expect(stepBlock).toContain("label:'manual'");
    expect(stepBlock).toContain("label:'proceed with gh anyway (not recommended)'");
    expect(stepBlock).toContain("label:'abort'");
    expect(stepBlock).toMatch(/INTERACTIVE=false, or INTERACTIVE detection is itself uncertain[\s\S]*HALT/);
  });

  test('beads-build and the implement-trd-beads reference skill consume the same resolve-sdlc contract', () => {
    const beadsBuildText = skillText;
    const implText = fs.readFileSync(
      path.join(__dirname, '../skills/implement-trd-beads-reference/SKILL.md'),
      'utf8'
    );
    const beadsBuildStep = beadsBuildText
      .slice(
        stepAt(beadsBuildText, 'Git-Town and Working Directory Verification'),
        stepAt(beadsBuildText, 'Epic Discovery')
      )
      .replace(/''/g, "'");

    for (const [buildMarker, implMarker] of [
      ['resolve-sdlc --git-town-exit-code', 'resolve-sdlc --git-town-exit-code'],
      ["branchingStrategy.action == 'halt'", "branchingStrategy.action=='halt'"],
      ['prBackend.needsResolution == false', 'prBackend.needsResolution==false'],
      ['consolidatedMessage', 'consolidatedMessage'],
    ]) {
      expect(beadsBuildStep).toContain(buildMarker);
      expect(implText).toContain(implMarker);
    }
  });

  test('repro scenario: ADO remote + git-town unconfigured/absent + non-interactive never HALTs on dead command text and never signals git town propose', () => {
    const { resolveBranchingStrategy, resolvePrBackend } = require('../lib/pr-strategy.js');
    for (const exitCode of [1, 2]) {
      const branching = resolveBranchingStrategy({}, exitCode);
      expect(branching.action).not.toBe('halt');
      expect(branching.strategy).toBe('plain-git');
      const backend = resolvePrBackend({}, 'https://dev.azure.com/org/project/_git/repo');
      expect(backend.needsResolution).toBe(true);
    }
  });
});

describe('beads-build has no branch-creation logic of its own (TRD-014)', () => {
  test('states that it never creates or switches branches itself', () => {
    const text = skillText;
    expect(text).toContain('This command never creates or switches branches');
    expect(text).toContain('it issues no branching-tool command under any BRANCHING_STRATEGY');
  });

  test('zero real git-town branch-creation invocations anywhere in the file (git town hack/append/propose)', () => {
    const text = skillText;
    // No actual command invocations anywhere in this file — only prose describing why there are none.
    expect(text).not.toMatch(/run git town (hack|propose|append)/);
    expect(text).not.toMatch(/git town (hack|propose|append) <[A-Z_]/);
    // No git checkout -b / git switch -c either — this file performs zero branch mutation, plain-git or otherwise
    expect(text).not.toMatch(/git checkout -b/);
    expect(text).not.toMatch(/git switch -c/);
  });

  test('BRANCHING_STRATEGY is still resolved (for consistency with the other two consumer commands) even though unused for mutation', () => {
    const text = skillText;
    expect(text).toContain('Set BRANCHING_STRATEGY=RESOLVE_SDLC_RESULT.branchingStrategy.strategy');
  });
});

describe('beads-build backend-aware completion reminder (TRD-015)', () => {
  test("Completion Report names all three backends' distinct reminder text", () => {
    const rawText = skillText;
    // This file uses single-quoted YAML scalars, so literal single quotes are escaped as ''.
    // Normalize so assertions can use plain, readable quoting regardless of escaping style.
    const text = rawText.replace(/''/g, "'");
    const stepStart = stepAt(text, 'Completion Report');
    const stepEnd = text.indexOf('#### Step', stepStart + 1);
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    // TRD-015 marker + explicit remind-not-automate design note
    expect(stepBlock).toContain('PR reminder (TRD-015):');
    expect(stepBlock).toContain('this command never auto-creates a PR regardless of PR_BACKEND');
    expect(stepBlock).toContain("mirroring TRD-010's three backend behaviors, minus the ado MCP-tool-preferred attempt");

    // gh: distinct reminder text (workflow.diff, then the host change-request capability)
    expect(stepBlock).toContain("If PR_BACKEND=='gh': remind user: node \"$TOOLCHAIN_CLI\" run workflow.diff --arg ref=main...<branch>; then node \"$TOOLCHAIN_CLI\" run host.change-request-create");
    // ado: distinct reminder text (workflow.push + host adapter, portal fallback, no MCP attempt)
    expect(stepBlock).toContain("If PR_BACKEND=='ado': remind user: node \"$TOOLCHAIN_CLI\" run workflow.push --arg branch=<branch>; then node \"$TOOLCHAIN_CLI\" run host.change-request-create");
    expect(stepBlock).toContain('resolves through the configured Azure DevOps host adapter');
    expect(stepBlock).toContain('use the portal instead: Repos > Pull Requests > New Pull Request');
    // manual: distinct reminder text
    expect(stepBlock).toContain("If PR_BACKEND=='manual': remind user: node \"$TOOLCHAIN_CLI\" run workflow.push --arg branch=<branch>; then node \"$TOOLCHAIN_CLI\" run host.change-request-create");
    expect(stepBlock).toContain('resolves through whichever host adapter is configured');

    // Never auto-creates, regardless of which backend was resolved
    expect(stepBlock).toContain('Do NOT auto-create PR — user must create it manually per the PR_BACKEND-specific reminder above');
  });

  test('all three PR_BACKEND branches are mutually exclusive if/else-style clauses, not a single generic message', () => {
    const rawText = skillText;
    const text = rawText.replace(/''/g, "'");
    const stepStart = stepAt(text, 'Completion Report');
    const stepEnd = text.indexOf('#### Step', stepStart + 1);
    const stepBlock = text.slice(stepStart, stepEnd);
    const ghIdx = stepBlock.indexOf("If PR_BACKEND=='gh':");
    const adoIdx = stepBlock.indexOf("If PR_BACKEND=='ado':");
    const manualIdx = stepBlock.indexOf("If PR_BACKEND=='manual':");
    expect(ghIdx).toBeGreaterThan(-1);
    expect(adoIdx).toBeGreaterThan(ghIdx);
    expect(manualIdx).toBeGreaterThan(adoIdx);
  });
});

describe('beads-build team-roles delegation contract', () => {
  test('Argument Parsing accepts --team-roles and keeps deprecated --builder fallback', () => {
    const text = skillText;
    const stepStart = stepAt(text, 'Argument Parsing');
    const stepEnd = stepAt(text, 'Tool Capability Preflight');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    expect(stepBlock).toMatch(/--team-roles/);
    expect(stepBlock).toMatch(/deprecated --builder/);
    expect(stepBlock).toMatch(/TEAM_ROLES=\{/);
  });

  test('beads-build-wave payload includes team_roles roster (moved from inline Track Orchestrator)', () => {
    // beads-build-wave is skill-backed: its prompt is the skill (SKILL.md + references/)
    const text = readDevelopmentSkill('ensemble-beads-build-wave').prompt;
    expect(text).toMatch(/team_roles/);
    expect(text).toMatch(/lifecycle_contract/);
    expect(text).toMatch(/quality_loop/);
    expect(text).toMatch(/Architect is invoked on in_design, PM on in_clarification/);
    expect(text).toMatch(/reviewer approves routes through advisor before QA/);
  });
});

describe('beads-build PR-boundary doc hook contract', () => {
  test('Phase Completion Detection runs doc-maintenance before PR/reporting follow-up', () => {
    const text = skillText;
    const stepStart = stepAt(text, 'Phase Completion Detection');
    const stepEnd = stepAt(text, 'Test Execution');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    expect(stepBlock).toMatch(/packages\/development\/lib\/doc-maintenance\.js/);
    expect(stepBlock).toMatch(/Fire once per PR boundary/);
    expect(stepBlock).toMatch(/README\.md, AGENTS\.md, and docs\/UserGuide\.md/);
    expect(stepBlock).toMatch(/ENSEMBLE_SKIP_DOC_HOOK=1/);
    expect(stepBlock).toMatch(/documentation-specialist is missing/);
  });
});

describe('beads-build PM clarification guard contract', () => {
  test('beads-build-wave payload documents a 3-round PM clarification cap (moved from inline Track Orchestrator)', () => {
    // beads-build-wave is skill-backed: its prompt is the skill (SKILL.md + references/)
    const text = readDevelopmentSkill('ensemble-beads-build-wave').prompt;
    expect(text).toMatch(/pm_clarification_guard/);
    expect(text).toMatch(/maximum 3 PM clarification rounds per task/);
    expect(text).toMatch(/On the 4th request, HALT/);
  });
});
