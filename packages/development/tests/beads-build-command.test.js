const fs = require('fs');
const path = require('path');

describe('beads-build clean-tree gate', () => {
  const yamlPath = path.join(__dirname, '../commands/beads-build.yaml');

  test('a fresh run still HALTs on a dirty working directory', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('If STARTED_COUNT == 0');
    expect(text).toContain('ERROR: working directory is dirty. Commit, stash or revert before starting a new build.');
  });

  test('a resumed run warns and continues instead of halting', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
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
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('STARTED_COUNT = IN_PROGRESS_COUNT + CLOSED_COUNT');
    // --all and --limit 0 both decide whether CLOSED_COUNT can be non-zero.
    // `br list --help`: -a/--all is "Include closed issues (default excludes
    // closed)" and --limit is "Maximum number of results (0 = unlimited,
    // default: 50)". Drop either and the count reads 0 on a real database,
    // which HALTs the resume this change exists to let through.
    expect(text).toContain('br list --all --status=closed --limit 0 --json');
    expect(text).not.toContain('If IN_PROGRESS_COUNT == 0 — this is a fresh run');
    expect(text).not.toContain('If IN_PROGRESS_COUNT > 0 and WORKTREE_STATUS is non-empty');
  });

  // Ordering, not presence: the broken file also contained a clean-tree gate.
  // It sat in step 3, one step ahead of the IN_PROGRESS_COUNT that decides
  // whether it applies.
  test('the gate is decided after epic discovery, never before it', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const epicDiscovery = text.indexOf('title: Epic Discovery');
    const haltDecision = text.indexOf('ERROR: working directory is dirty.');
    expect(epicDiscovery).toBeGreaterThan(-1);
    expect(haltDecision).toBeGreaterThan(-1);
    expect(haltDecision).toBeGreaterThan(epicDiscovery);
  });

  test('preflight step 3 captures the status without deciding on it', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('capture the output as WORKTREE_STATUS');
    expect(text).not.toContain('git status --porcelain — HALT if output non-empty');
  });
});

describe('beads-build Preflight resolve-sdlc rewiring (TRD-013)', () => {
  const yamlPath = path.join(__dirname, '../commands/beads-build.yaml');

  test('no unconditional HALT tied to validate-git-town.sh exit codes 1 or 2', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Git-Town and Working Directory Verification');
    const stepEnd = text.indexOf('title: Epic Discovery');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toMatch(/Exit codes 0 \(ok\), 1 \(not installed\), and 2 \(not configured\) no longer HALT here/);
    expect(stepBlock).toMatch(/Exit codes 3 \(version mismatch\) and 4 \(not a git repo\) are unaffected by this feature — HALT on those exactly as before/);
  });

  test('resolve-sdlc invocation is present', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('node "$TRD_CLI" resolve-sdlc --git-town-exit-code');
    expect(text).toContain('RESOLVE_SDLC_RESULT');
  });

  test('four-option AskUserQuestion block for PR backend resolution is present', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Git-Town and Working Directory Verification');
    const stepEnd = text.indexOf('title: Epic Discovery');
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("id=''pr_backend''");
    expect(stepBlock).toContain("label:''ado''");
    expect(stepBlock).toContain("label:''manual''");
    expect(stepBlock).toContain("label:''proceed with gh anyway (not recommended)''");
    expect(stepBlock).toContain("label:''abort''");
    expect(stepBlock).toMatch(/INTERACTIVE=false, or INTERACTIVE detection is itself uncertain[\s\S]*HALT/);
  });

  test('behavioral equivalence with implement-trd-beads.yaml TRD-008 Preflight pattern', () => {
    const beadsBuildText = fs.readFileSync(yamlPath, 'utf8');
    const implPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
    const implText = fs.readFileSync(implPath, 'utf8');

    const extractStep = (text, startMarker, endMarker) => {
      const s = text.indexOf(startMarker);
      const e = text.indexOf(endMarker);
      return text.slice(s, e);
    };

    // Normalize YAML single-quote escaping (''->') so markers compare equally
    // regardless of which file's quoting style (single- vs double-quoted scalars) is used.
    const normalize = (s) => s.replace(/''/g, "'");

    const beadsBuildStep = normalize(extractStep(
      beadsBuildText,
      'title: Git-Town and Working Directory Verification',
      'title: Epic Discovery'
    ));
    const implStep = normalize(extractStep(
      implText,
      'title: Git-Town and Working Directory Verification',
      'title: TRD Selection and Validation'
    ));

    // Same resolution logic markers present in both — same HALT/prompt/consolidated-message shape.
    for (const marker of [
      'resolve-sdlc --git-town-exit-code',
      'RESOLVE_SDLC_RESULT',
      "branchingStrategy.action == 'halt'",
      'prBackend.needsResolution == true',
      'prBackend.needsResolution == false',
      'consolidatedMessage',
    ]) {
      expect(beadsBuildStep).toContain(marker);
      expect(implStep).toContain(marker);
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
  const yamlPath = path.join(__dirname, '../commands/beads-build.yaml');

  test('explicit REQ-004 note documents the file never issues branch-mutation commands', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const noteIdx = text.indexOf('Plain-git branch creation (TRD-014):');
    expect(noteIdx).toBeGreaterThan(-1);
    expect(text).toContain('this command drives an existing bead hierarchy on whatever branch is already checked out');
    expect(text).toContain('unlike implement-trd-beads.yaml, it never creates or switches branches itself');
    expect(text).toContain('there is zero `git town` command anywhere in this file to make config-driven');
    expect(text).toContain('the plain-git contract (REQ-004: zero git town commands issued when BRANCHING_STRATEGY==plain-git) is satisfied automatically');
    expect(text).toContain('by this file never issuing branch-mutation commands of any kind, git-town or otherwise');
  });

  test('zero real git-town branch-creation invocations anywhere in the file (git town hack/append/propose)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // No actual command invocations anywhere in this file — only prose describing why there are none.
    expect(text).not.toMatch(/run git town (hack|propose|append)/);
    expect(text).not.toMatch(/git town (hack|propose|append) <[A-Z_]/);
    // No git checkout -b / git switch -c either — this file performs zero branch mutation, plain-git or otherwise
    expect(text).not.toMatch(/git checkout -b/);
    expect(text).not.toMatch(/git switch -c/);
  });

  test('BRANCHING_STRATEGY is still resolved (for consistency with the other two consumer commands) even though unused for mutation', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Set BRANCHING_STRATEGY=RESOLVE_SDLC_RESULT.branchingStrategy.strategy');
    expect(text).toContain('BRANCHING_STRATEGY is still resolved above for consistency with the other two consumer commands');
  });
});

describe('beads-build backend-aware completion reminder (TRD-015)', () => {
  const yamlPath = path.join(__dirname, '../commands/beads-build.yaml');

  test("Completion Report names all three backends' distinct reminder text", () => {
    const rawText = fs.readFileSync(yamlPath, 'utf8');
    // This file uses single-quoted YAML scalars, so literal single quotes are escaped as ''.
    // Normalize so assertions can use plain, readable quoting regardless of escaping style.
    const text = rawText.replace(/''/g, "'");
    const stepStart = text.indexOf('title: Completion Report');
    const stepEnd = text.indexOf('expectedInput:');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    // TRD-015 marker + explicit remind-not-automate design note
    expect(stepBlock).toContain('PR reminder (TRD-015):');
    expect(stepBlock).toContain('this command never auto-creates a PR regardless of PR_BACKEND');
    expect(stepBlock).toContain("mirroring TRD-010's three backend behaviors, minus the ado MCP-tool-preferred attempt");

    // gh: distinct reminder text
    expect(stepBlock).toContain("If PR_BACKEND=='gh': remind user: git diff main...<branch>; gh pr create;");
    // ado: distinct reminder text (az CLI + portal, no MCP attempt)
    expect(stepBlock).toContain("If PR_BACKEND=='ado': remind user: git push -u origin <branch>; az repos pr create --source-branch <branch> --target-branch main");
    expect(stepBlock).toContain('or via the portal: Repos > Pull Requests > New Pull Request');
    // manual: distinct reminder text
    expect(stepBlock).toContain("If PR_BACKEND=='manual': remind user: git push -u origin <branch>; then create the PR yourself via gh pr create --base main");
    expect(stepBlock).toContain('or the ADO CLI/portal equivalent if the remote is Azure DevOps');

    // Never auto-creates, regardless of which backend was resolved
    expect(stepBlock).toContain('Do NOT auto-create PR — user must create it manually per the PR_BACKEND-specific reminder above');
  });

  test('all three PR_BACKEND branches are mutually exclusive if/else-style clauses, not a single generic message', () => {
    const rawText = fs.readFileSync(yamlPath, 'utf8');
    const text = rawText.replace(/''/g, "'");
    const stepStart = text.indexOf('title: Completion Report');
    const stepEnd = text.indexOf('expectedInput:');
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
  const yamlPath = path.join(__dirname, '../commands/beads-build.yaml');

  test('Argument Parsing accepts --team-roles and keeps deprecated --builder fallback', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Argument Parsing');
    const stepEnd = text.indexOf('title: Tool Availability Check');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    expect(stepBlock).toMatch(/--team-roles/);
    expect(stepBlock).toMatch(/deprecated --builder/);
    expect(stepBlock).toMatch(/TEAM_ROLES=\{/);
  });

  test('beads-build-wave payload includes team_roles roster (moved from inline Track Orchestrator)', () => {
    const wavePath = path.join(__dirname, '../commands/beads-build-wave.yaml');
    const text = fs.readFileSync(wavePath, 'utf8');
    expect(text).toMatch(/team_roles/);
    expect(text).toMatch(/lifecycle_contract/);
    expect(text).toMatch(/quality_loop/);
    expect(text).toMatch(/Architect is invoked on in_design, PM on in_clarification/);
    expect(text).toMatch(/reviewer approves routes through advisor before QA/);
  });
});

describe('beads-build PR-boundary doc hook contract', () => {
  const yamlPath = path.join(__dirname, '../commands/beads-build.yaml');

  test('Phase Completion Detection runs doc-maintenance before PR/reporting follow-up', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Phase Completion Detection');
    const stepEnd = text.indexOf('title: Test Execution');
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
  const yamlPath = path.join(__dirname, '../commands/beads-build.yaml');

  test('beads-build-wave payload documents a 3-round PM clarification cap (moved from inline Track Orchestrator)', () => {
    const wavePath = path.join(__dirname, '../commands/beads-build-wave.yaml');
    const text = fs.readFileSync(wavePath, 'utf8');
    expect(text).toMatch(/pm_clarification_guard/);
    expect(text).toMatch(/maximum 3 PM clarification rounds per task/);
    expect(text).toMatch(/On the 4th request, HALT/);
  });
});
