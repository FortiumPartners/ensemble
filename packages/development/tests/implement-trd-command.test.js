const fs = require('fs');
const path = require('path');

describe('implement-trd Preflight resolve-sdlc rewiring (TRD-017)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('no unconditional HALT tied to validate-git-town.sh exit codes 1 or 2', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Git Town Verification');
    const stepEnd = text.indexOf('title: TRD Staleness Gate');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toMatch(/Exit codes 0 \(success\), 1 \(not installed\), and 2 \(not configured\) no longer escalate\/HALT here/);
    expect(stepBlock).toMatch(/Exit codes 3 \(version mismatch\) and 4 \(not a git repo\) are unaffected by this feature/);
  });

  test('resolve-sdlc invocation is present', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('node \\"$TRD_CLI\\" resolve-sdlc --git-town-exit-code');
    expect(text).toContain('RESOLVE_SDLC_RESULT');
  });

  test('four-option AskUserQuestion block for PR backend resolution is present', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Git Town Verification');
    const stepEnd = text.indexOf('title: TRD Staleness Gate');
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("id='pr_backend'");
    expect(stepBlock).toContain("label:'ado'");
    expect(stepBlock).toContain("label:'manual'");
    expect(stepBlock).toContain("label:'proceed with gh anyway (not recommended)'");
    expect(stepBlock).toContain("label:'abort'");
    expect(stepBlock).toMatch(/INTERACTIVE=false, or INTERACTIVE detection is itself uncertain[\s\S]*HALT/);
  });

  test('behavioral equivalence with implement-trd-beads.yaml TRD-008 Preflight pattern', () => {
    const thisText = fs.readFileSync(yamlPath, 'utf8');
    const implBeadsPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
    const implBeadsText = fs.readFileSync(implBeadsPath, 'utf8');

    const extractStep = (text, startMarker, endMarker) => {
      const s = text.indexOf(startMarker);
      const e = text.indexOf(endMarker);
      return text.slice(s, e);
    };

    const thisStep = extractStep(thisText, 'title: Git Town Verification', 'title: TRD Staleness Gate');
    const implBeadsStep = extractStep(
      implBeadsText,
      'title: Git-Town and Working Directory Verification',
      'title: TRD Selection and Validation'
    );

    for (const marker of [
      'resolve-sdlc --git-town-exit-code',
      'RESOLVE_SDLC_RESULT',
      "branchingStrategy.action == 'halt'",
      'prBackend.needsResolution == true',
      'prBackend.needsResolution == false',
      'consolidatedMessage',
    ]) {
      expect(thisStep).toContain(marker);
      expect(implBeadsStep).toContain(marker);
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

describe('implement-trd plain-git branch creation (TRD-018)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('Feature Branch Creation (line 55) is config-driven on BRANCHING_STRATEGY, not exit-code-only', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Feature Branch Creation');
    const stepEnd = text.indexOf('title: TRD Ingestion');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain('Execute, config-driven on BRANCHING_STRATEGY (resolved in Preflight step 1, not exit-code-only)');
    expect(stepBlock).toContain("if BRANCHING_STRATEGY=='git-town', run git town hack <CURRENT_BRANCH> [UNCHANGED]");
    expect(stepBlock).toContain("if BRANCHING_STRATEGY=='plain-git', run git checkout -b <CURRENT_BRANCH> <base_branch> unconditionally");
    expect(stepBlock).toContain('no git town attempt at all — zero git town commands issued anywhere in this run');
  });

  test('plain-git clause contains zero real git-town invocations', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const clauseStart = text.indexOf("if BRANCHING_STRATEGY=='plain-git', run git checkout -b <CURRENT_BRANCH>");
    expect(clauseStart).toBeGreaterThan(-1);
    const clauseEnd = text.indexOf('Verify branch creation successful', clauseStart);
    expect(clauseEnd).toBeGreaterThan(clauseStart);
    const clause = text.slice(clauseStart, clauseEnd);
    expect(clause).toContain('git checkout -b <CURRENT_BRANCH> <base_branch>');
    expect(clause).not.toMatch(/git town (hack|propose|append)/);
  });

  test('the git-town clause (unchanged) still uses git town hack, proving the split is config-driven, not a deletion', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain("if BRANCHING_STRATEGY=='git-town', run git town hack <CURRENT_BRANCH> [UNCHANGED]");
  });
});

describe('implement-trd PR-backend branching logic (TRD-019)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('Sprint PR Stacking description references TRD-010 behaviors and TRD-018 line-55 pattern', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Sprint PR Stacking');
    const stepEnd = text.indexOf('expectedInput:');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("PR creation branches on PR_BACKEND (resolved in Preflight step");
    expect(stepBlock).toMatch(/matching implement-trd-beads\.yaml's TRD-010 behaviors exactly/);
    expect(stepBlock).toMatch(/config-driven on BRANCHING_STRATEGY, matching TRD-018's line-55 pattern/);

    // Three distinct PR_BACKEND clauses for the per-sprint stacked path
    expect(stepBlock).toContain('PR_BACKEND==\'gh\' AND BRANCHING_STRATEGY==\'git-town\' [UNCHANGED]: run git town propose --title');
    expect(stepBlock).toContain('PR_BACKEND==\'gh\' AND BRANCHING_STRATEGY==\'plain-git\': run git push -u origin <CURRENT_BRANCH>, then run gh pr create');
    expect(stepBlock).toContain("PR_BACKEND=='ado': run git push -u origin <CURRENT_BRANCH>; scan available tool names for any name starting with 'mcp__azure-devops'");
    expect(stepBlock).toContain("PR_BACKEND=='manual': print 'PR backend is manual — create this PR yourself:'");

    // gh+plain-git is a standalone gh call, never routed through git town
    expect(stepBlock).toMatch(/gh pr create --title \\"<SPRINT_TITLE>\\"[\s\S]*?\(a standalone gh call, not routed through any git town command\)/);
    // ado never HALTs — falls back to manual az/portal instructions
    expect(stepBlock).toContain('do NOT HALT, do NOT attempt any other shell-out; SPRINT_PR_MAP[CURRENT_SPRINT] remains unset');
  });

  test('next-sprint branch creation after a stacked PR is config-driven on BRANCHING_STRATEGY (mirrors TRD-018)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Sprint PR Stacking');
    const stepEnd = text.indexOf('expectedInput:');
    const stepBlock = text.slice(stepStart, stepEnd);
    const nextIdx = stepBlock.indexOf('If STACKED_PRS=true AND more sprints remain:');
    expect(nextIdx).toBeGreaterThan(-1);
    const nextClauseEnd = stepBlock.indexOf('If STACKED_PRS=true AND no more sprints:', nextIdx);
    const nextClause = stepBlock.slice(nextIdx, nextClauseEnd);
    expect(nextClause).toContain("if BRANCHING_STRATEGY=='git-town': run git town append feature/<trd-slug>-sprint-<NEXT_SPRINT> [UNCHANGED]");
    expect(nextClause).toContain("if BRANCHING_STRATEGY=='plain-git': run git checkout -b feature/<trd-slug>-sprint-<NEXT_SPRINT> unconditionally");
    expect(nextClause).toContain('zero git town commands issued');
  });

  test('final single-PR path (STACKED_PRS=false) also branches on all four PR_BACKEND/BRANCHING_STRATEGY combinations', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Sprint PR Stacking');
    const stepEnd = text.indexOf('expectedInput:');
    const stepBlock = text.slice(stepStart, stepEnd);
    const finalIdx = stepBlock.indexOf('If STACKED_PRS=false:');
    expect(finalIdx).toBeGreaterThan(-1);
    const finalClause = stepBlock.slice(finalIdx);
    expect(finalClause).toContain("'gh'+git-town runs git town propose [UNCHANGED]");
    expect(finalClause).toContain("'gh'+plain-git runs git push -u origin <CURRENT_BRANCH> then gh pr create (standalone)");
    expect(finalClause).toContain("'ado' pushes then prefers the azure-devops MCP tool's repo_create_pull_request, else prints manual az repos pr create/portal steps and continues");
    expect(finalClause).toContain("'manual' always prints manual push+PR instructions");
  });
});

describe('implement-trd always-on team roster (team8)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('Preflight contains Team Configuration Detection with default 8-role roster log', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/title: Team Configuration Detection/);
    expect(text).toMatch(/always-on default 8-role roster/);
    expect(text).toMatch(/Team mode \(default roster\): lead=<lead>, architect=<architect>, builders=<n>, reviewer=<reviewer>, qa=<qa>, advisor=<advisor>, pm=<pm>, documentation=<documentation>/);
  });
});

describe('implement-trd v2.5.0 two-tier task-loop contract', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('Task Loop step is a two-tier dispatch (delegates to implement-trd-task, not inline task work)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const loopStart = text.indexOf('title: Task Loop');
    const loopEnd = text.indexOf('title: Quality Gates');
    expect(loopStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(loopStart);
    const loopBlock = text.slice(loopStart, loopEnd);

    expect(loopBlock).toMatch(/Task\(subagent_type=implement-trd-task/);
    expect(loopBlock).toMatch(/two-tier non-recursive\s+loop/i);
    expect(loopBlock).toMatch(/max_depth=1/);
    expect(loopBlock).toMatch(/task-runner owns specialist dispatch/);
    expect(loopBlock).toMatch(/does NOT inline any of that work/i);
  });

  test('Task Loop handles the JSON summary terminal states (parent owns sprint-level decisions)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const loopStart = text.indexOf('title: Task Loop');
    const loopEnd = text.indexOf('title: Quality Gates');
    const loopBlock = text.slice(loopStart, loopEnd);

    expect(loopBlock).toMatch(/task_state == 'approved_closed'/);
    expect(loopBlock).toMatch(/task_state == 'rejected_halt'/);
    expect(loopBlock).toMatch(/task_state == 'pm_exhausted_halt'/);
    expect(loopBlock).toMatch(/task_state == 'blocked'/);

  });

  test('mission summary explains the two-tier loop architecture', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const missionBlock = text.slice(
      text.indexOf('mission:'),
      text.indexOf('workflow:')
    );
    expect(missionBlock).toMatch(/two-tier non-recursive dispatch\s+loop/i);
    expect(missionBlock).toMatch(/implement-trd-task/);
    expect(missionBlock).toMatch(/max_depth=1/);
  });
});

describe('implement-trd PR-boundary doc hook contract', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('Sprint PR Stacking runs doc-maintenance before PR creation and branch append', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Sprint PR Stacking');
    const stepEnd = text.indexOf('expectedInput:');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    expect(stepBlock).toMatch(/packages\/development\/lib\/doc-maintenance\.js/);
    expect(stepBlock).toMatch(/README\.md, AGENTS\.md, and docs\/UserGuide\.md/);
    expect(stepBlock).toMatch(/BEFORE git town propose \/ gh pr create \/ git town append \/ git checkout -b/);
  });
});

describe('implement-trd quickstart validation artifact contract', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('states quickstart output path rules for Foreman and non-Foreman runs', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('QUICKSTART_PATH is dirname(FOREMAN_ARTIFACT_PATH)/quickstart.md');
    expect(text).toContain('beside the exact phase artifact path');
    expect(text).toContain('QUICKSTART_PATH is dirname(TRD_PATH)/quickstart.md');
    expect(text).toContain('beside the source TRD');
  });

  test('runs quickstart after completion verification and before implementation complete success branches', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const completionIdx = text.indexOf('Completion Verification');
    const quickstartIdx = text.indexOf('Quickstart generation: run node \\"$TRD_CLI\\" quickstart');
    const completeIdx = text.indexOf('implementation complete', quickstartIdx);
    expect(completionIdx).toBeGreaterThan(-1);
    expect(quickstartIdx).toBeGreaterThan(completionIdx);
    expect(completeIdx).toBeGreaterThan(quickstartIdx);
    expect(text).toContain('HALT before claiming implementation complete');
  });

  test('final reporting includes quickstart coverage fields and preserves Foreman artifact path', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('quickstart path');
    expect(text).toContain('parsed AC count');
    expect(text).toContain('scenario count');
    expect(text).toContain('unmapped AC count');
    expect(text).toContain('clarification count');
    expect(text).toContain('coverage percentage');
    expect(text).toContain('write the Foreman phase report to that exact path');
    expect(text).toContain('do not substitute the quickstart path for FOREMAN_ARTIFACT_PATH');
  });
});

describe('implement-trd PM clarification guard contract', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd.yaml');

  test('Task Loop documents PM clarification contract with task-runner (3-round cap)', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const loopStart = text.indexOf('title: Task Loop');
    const loopEnd = text.indexOf('title: Quality Gates');
    expect(loopStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(loopStart);
    const loopBlock = text.slice(loopStart, loopEnd);

    // After v2.5.0 split: the parent loop documents the task_state contract for
    // pm_exhausted_halt; the 3-round cap itself is enforced by the task-runner.
    expect(loopBlock).toMatch(/PM clarification loop guard/);
    expect(loopBlock).toMatch(/task-runner enforces the 3-round PM cap/);
    expect(loopBlock).toMatch(/task_state[/='"]*pm_exhausted_halt/);
  });

  test('implement-trd-task.yaml enforces the 3-round PM cap (parent owns contract, child enforces count)', () => {
    const taskPath = path.join(__dirname, '../commands/implement-trd-task.yaml');
    const text = fs.readFileSync(taskPath, 'utf8');
    expect(text).toMatch(/PM clarification loop guard/);
    expect(text).toMatch(/Maximum 3 PM clarification rounds per task/);
    expect(text).toMatch(/emit summary task_state="pm_exhausted_halt"/);
  });
});
