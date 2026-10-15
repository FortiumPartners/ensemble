const fs = require('fs');
const path = require('path');

// Split a YAML block's `actions:` list into one string per action so assertions are about
// which action does what and in what ORDER, not about line-wrapped literals.
const actionsOf = (block) =>
  block
    .slice(block.indexOf('actions:'))
    .split(/\n\s*- "/)
    .slice(1);

// Every literal the RAW skill field `localPhase` is compared with. A gate must key on the one good value
// (LOCAL_REVIEW_COMPLETE); comparing the raw field with a bad literal is the fail-open shape, because any
// other or missing value then slips past.
const rawPhaseComparisons = (s) => [...s.matchAll(/\blocalPhase\s*==\s*'([A-Z_]+)'/g)].map((m) => m[1]);

describe('implement-trd-beads command progress behavior', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('does not pause for routine progress or context checkpoints', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Non-Interactive Progress Policy');
    expect(text).toContain('Do NOT stop, pause, ask for acknowledgement');
    expect(text).toContain('real user decision');
    expect(text).not.toContain('Context checkpoint: <N> tasks completed this session');
    expect(text).not.toContain('/compact to compress conversation context');
  });

  test('resolves shorthand agents to runtime namespaced plugin agents before delegation', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('AGENT_ALIAS_MAP');
    expect(text).toContain('ensemble-full:backend-developer');
    expect(text).toContain('Task(agent_type=<resolved_specialist>');
    expect(text).toContain('resolved @code-reviewer');
    expect(text).toContain('resolved @deep-debugger');
  });

  test('does not call trd_progress after every task', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Do NOT call trd_progress() here');
    expect(text).not.toContain('After each task (or parallel group): br sync --flush-only, then call trd_progress()');
  });
});


describe('implement-trd-beads RCA quality gates', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('supports AC/XC synthetic task ids and Definition of Done closure gates', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('AC-NNN-M');
    expect(text).toContain('XC-NNN synthetic validation tasks');
    expect(text).toContain('Definition of Done gate');
    expect(text).toContain('no new src/**/*.FIXME');
    expect(text).toContain('Only close when verdict:proven');
  });
});


describe('implement-trd-beads direct multi-TRD deprecation', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
  test('errors on direct multiple TRDs and points to create-workstream-trd', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Multiple TRDs passed directly');
    expect(text).toContain('/ensemble:create-workstream-trd');
    expect(text).toContain('--legacy-multi');
    expect(text).toContain('DEPRECATED: direct multi-TRD mode');
  });
});


describe('implement-trd-beads execution blocked-check logic', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('blocked-check uses live bead graph, not parsed depends-on', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // Must use live bead graph via br dep list
    expect(text).toContain('br dep list');
    expect(text).toContain('br show');
    // Step a must NOT consult TASK_TRACEABILITY depends-on for blocker ids
    // (phaseN lookup is fine; blocker ids must come from br dep list)
    expect(text).not.toMatch(/look up.*depends-on.*in TASK_TRACEABILITY/);
  });

  test('blocked-check computes current_phase from PHASE_TASK_IDS and CLOSED_TRD_IDS', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('PHASE_TASK_IDS');
    expect(text).toContain('CLOSED_TRD_IDS');
    // next-task algorithm: lowest phase with unclosed tasks
    expect(text).toMatch(/lowest phaseN in PHASE_TASK_IDS that has any task id NOT in CLOSED_TRD_IDS/);
  });

  test('blocked-check distinguishes current-phase blockers from later-phase tasks', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // Later-phase state is irrelevant; current_phase is decisive
    expect(text).toMatch(/Tasks in later phases are irrelevant/);
    // HALT only when current_phase is blocked
    expect(text).toMatch(/EXECUTION BLOCKED.*current-phase.*open blockers/);
    // Retry/inconsistency only when current_phase unblocked
    expect(text).toMatch(/genuine inconsistency.*current-phase.*all blockers closed/);
  });

  test('old stale blocked-check text is gone', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // No more "SOME remaining open tasks have ALL blockers closed" phrasing
    expect(text).not.toMatch(/SOME remaining open tasks have ALL blockers closed/);
    // No more generic "EXECUTION BLOCKED" without current_phase context
    expect(text).not.toMatch(/EXECUTION BLOCKED.*all.*remaining open tasks are waiting/);
  });
});
describe('implement-trd-beads v1 quickstart unsupported path', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('documents unsupported quickstart generation without pointing at a removed command', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('beads-backed quickstart.md generation is unsupported in v1');
    expect(text).not.toMatch(/\/ensemble:implement-trd\b(?!-beads|-task)/);
    expect(text).toContain('No standalone command currently generates this artifact for a beads-backed run');
  });
});

describe('implement-trd-beads branch-intent flags', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('--use-current-branch parsed in Preflight Step 1 with mutual-exclusivity vs --branch', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/--use-current-branch.*USE_CURRENT_BRANCH_REQUESTED=true/);
    expect(text).toMatch(/--use-current-branch.*and --branch=<name>.*mutually exclusive.*HALT/);
    expect(text).toMatch(/If flag absent.*set USE_CURRENT_BRANCH_REQUESTED=false/);
  });

  test('--branch=<name> parsed and stored as BRANCH_REQUESTED in Preflight Step 1', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/--branch=<name>.*extract the branch name.*BRANCH_REQUESTED/);
  });

  test('non-interactive path handles both --branch and --use-current-branch before asking', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/non-interactive[\s\S]*--branch=<name>[\s\S]*set branch_name=<BRANCH_REQUESTED>/);
    expect(text).toMatch(/non-interactive[\s\S]*USE_CURRENT_BRANCH_REQUESTED=true[\s\S]*CURRENT_BRANCH_NAME is empty[\s\S]*ERROR[\s\S]*detached HEAD[\s\S]*HALT/);
    expect(text).toMatch(/non-interactive[\s\S]*USE_CURRENT_BRANCH_REQUESTED=true[\s\S]*CURRENT_BRANCH_NAME[\s\S]*set branch_name=<CURRENT_BRANCH_NAME>[\s\S]*USE_PROPOSED=false/);
    expect(text).toMatch(/non-interactive[\s\S]*Branch intent required[\s\S]*HALT/);
  });

  test('interactive path pre-ask gate handles both USE_CURRENT_BRANCH_REQUESTED and BRANCH_REQUESTED', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    // Both flags appear in the combined INTERACTIVE=true AND (...) OR block, each setting branch_name and skipping AskUserQuestion
    expect(text).toMatch(/USE_CURRENT_BRANCH_REQUESTED=true.*skip AskUserQuestion/s);
    expect(text).toMatch(/BRANCH_REQUESTED is set.*set branch_name=<BRANCH_REQUESTED>.*skip AskUserQuestion/s);
  });

  test('AskUserQuestion only fires when NEITHER flag is set', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/INTERACTIVE=true AND USE_CURRENT_BRANCH_REQUESTED=false AND BRANCH_REQUESTED is not set.*AskUserQuestion/);
  });

  test('detached HEAD rejection for --use-current-branch appears in both non-interactive and interactive paths', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/--use-current-branch[\s\S]*detached HEAD[\s\S]*ERROR[\s\S]*Switch to a branch first[\s\S]*--branch=<name>[\s\S]*HALT/);
    expect(text).toMatch(/USE_CURRENT_BRANCH_REQUESTED=true[\s\S]*CURRENT_BRANCH_NAME is empty[\s\S]*ERROR[\s\S]*detached HEAD[\s\S]*Switch to a branch first[\s\S]*--branch=<name>[\s\S]*HALT/);
  });

  test('argument_hint advertises --branch=<name> and --use-current-branch', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/argument_hint[\s\S]*--branch=<name>/);
    expect(text).toMatch(/argument_hint[\s\S]*--use-current-branch/);
  });

  test('dead STACKED_PRS early initialization removed — pr-plan is authoritative source', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const lines = text.split('\n');
    const prefightStacksPrs = lines.findIndex(l =>
      l.includes('ENSEMBLE_USE_STACKED_PRS') &&
      l.includes('STACKED_PRS=true') &&
      l.includes('environment variable')
    );
    expect(prefightStacksPrs).toBe(-1);
  });

  test('confirmed plan appears BEFORE first mutating git command in Feature Branch Creation', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    expect(fbStart).toBeGreaterThan(-1);
    expect(mpStart).toBeGreaterThan(fbStart);
    const fbBlock = text.slice(fbStart, mpStart);
    const confirmedIdx = fbBlock.indexOf('EXECUTION PLAN (confirmed)');
    // Must match the actual post-confirmed-plan action, not option preview text
    const postPlanGitSwitch = fbBlock.indexOf('If USE_PROPOSED=true: Run: git branch --list');
    const postPlanGitTown   = fbBlock.indexOf('git town hack <branch_name>');
    const reuseGitSwitch = fbBlock.indexOf('If USE_PROPOSED=false: Run: git branch --list');
    expect(confirmedIdx).toBeGreaterThan(-1);
    expect(postPlanGitSwitch).toBeGreaterThan(confirmedIdx);
    expect(postPlanGitTown).toBeGreaterThan(confirmedIdx);
    expect(reuseGitSwitch).toBeGreaterThan(confirmedIdx);
    // choices-write must run AFTER both git mutation paths so the working tree
    // is clean when hack creates the branch (hack fails on dirty tree).
    const choicesWriteIdx = fbBlock.indexOf('choices-write');
    expect(choicesWriteIdx).toBeGreaterThan(postPlanGitTown);
    expect(choicesWriteIdx).toBeGreaterThan(reuseGitSwitch);
  });

  test('branch-intent HALT paths exit before any git mutation', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    const fbBlock = text.slice(fbStart, mpStart);
    const noIntentAction = fbBlock.indexOf('Branch intent required in non-interactive mode');
    expect(noIntentAction).toBeGreaterThan(-1);
    // HALT index in absolute fbBlock coordinates
    const noIntentHalt = fbBlock.indexOf('HALT', noIntentAction);
    expect(noIntentHalt).toBeGreaterThan(-1);
    const postPlanGitSwitch = fbBlock.indexOf('If USE_PROPOSED=true: Run: git branch --list');
    expect(noIntentHalt).toBeLessThan(postPlanGitSwitch);
  });
  test('TRD slug auto-detection action present after pr-plan and current-branch read', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    const fbBlock = text.slice(fbStart, mpStart);
    // pr-plan action uses escaped quotes in YAML: node \"$TRD_CLI\" pr-plan
    const prPlanIdx = fbBlock.indexOf('Run: node \\"$TRD_CLI\\" pr-plan');
    const showCurrentIdx = fbBlock.indexOf('git branch --show-current');
    const autoDetectIdx = fbBlock.indexOf('TRD Branch Auto-Detection');
    const interactiveDetectIdx = fbBlock.indexOf('Detect AskUserQuestion availability');
    expect(prPlanIdx).toBeGreaterThan(-1);
    expect(showCurrentIdx).toBeGreaterThan(prPlanIdx);
    expect(autoDetectIdx).toBeGreaterThan(showCurrentIdx);
    expect(interactiveDetectIdx).toBeGreaterThan(autoDetectIdx);
    // Auto-detection scans only local refs/heads/ (no remotes)
    const autoDetectBlock = fbBlock.slice(autoDetectIdx, interactiveDetectIdx);
    expect(autoDetectBlock).toMatch(/refs\/heads\//);
    expect(autoDetectBlock).toMatch(/BRANCH_RESOLVED_BY_AUTO_DETECT=true/);
    expect(autoDetectBlock).toMatch(/USE_PROPOSED=false/);
    // Guard: only runs when no explicit flag was set
    expect(autoDetectBlock).toMatch(/USE_CURRENT_BRANCH_REQUESTED != true/);
    expect(autoDetectBlock).toMatch(/BRANCH_REQUESTED is not set/);
    // Ambiguity: multiple local matches must NOT guess — must print warning and fall through
    expect(autoDetectBlock).toMatch(/MATCHES\.length\s*==\s*1/);
    expect(autoDetectBlock).toMatch(/MATCHES\.length\s*>=\s*2.*WARNING.*Multiple local branches match/);
  });

  test('non-interactive no-flags HALT path is escaped by BRANCH_RESOLVED_BY_AUTO_DETECT', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    const fbBlock = text.slice(fbStart, mpStart);
    const nonInteractiveIdx = fbBlock.indexOf('In non-interactive mode (INTERACTIVE=false)');
    expect(nonInteractiveIdx).toBeGreaterThan(-1);
    const noFlagHaltIdx = fbBlock.indexOf('Branch intent required in non-interactive mode', nonInteractiveIdx);
    expect(noFlagHaltIdx).toBeGreaterThan(nonInteractiveIdx);
    // Between the start of non-interactive block and the HALT, BRANCH_RESOLVED_BY_AUTO_DETECT must appear
    const slice = fbBlock.slice(nonInteractiveIdx, noFlagHaltIdx);
    expect(slice).toMatch(/BRANCH_RESOLVED_BY_AUTO_DETECT=true/);
  });

  test('AskUserQuestion guard escapes when BRANCH_RESOLVED_BY_AUTO_DETECT=true', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    const fbBlock = text.slice(fbStart, mpStart);
    const askIdx = fbBlock.indexOf('Call AskUserQuestion');
    expect(askIdx).toBeGreaterThan(-1);
    const guardSlice = fbBlock.slice(
      fbBlock.lastIndexOf('INTERACTIVE=true', askIdx),
      askIdx
    );
    expect(guardSlice).toMatch(/BRANCH_RESOLVED_BY_AUTO_DETECT is not true/);
  });

  test('explicit --branch and --use-current-branch are checked BEFORE BRANCH_RESOLVED_BY_AUTO_DETECT in non-interactive path', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    const fbBlock = text.slice(fbStart, mpStart);
    const nonInteractiveIdx = fbBlock.indexOf('In non-interactive mode (INTERACTIVE=false)');
    const flagBranchIdx = fbBlock.indexOf('--branch=<name> is present', nonInteractiveIdx);
    const flagUseCurrentIdx = fbBlock.indexOf('USE_CURRENT_BRANCH_REQUESTED=true', nonInteractiveIdx);
    const autoDetectBranchIdx = fbBlock.indexOf('BRANCH_RESOLVED_BY_AUTO_DETECT=true', nonInteractiveIdx);
    expect(flagBranchIdx).toBeGreaterThan(nonInteractiveIdx);
    expect(flagUseCurrentIdx).toBeGreaterThan(flagBranchIdx);
    expect(autoDetectBranchIdx).toBeGreaterThan(flagUseCurrentIdx);
  });

  test('explicit --branch and --use-current-branch are checked BEFORE BRANCH_RESOLVED_BY_AUTO_DETECT in interactive path', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    const fbBlock = text.slice(fbStart, mpStart);
    // New combined condition: all three flags are handled in one OR block before AskUserQuestion
    const combinedIdx = fbBlock.indexOf('INTERACTIVE=true AND (USE_CURRENT_BRANCH_REQUESTED=true OR BRANCH_REQUESTED is set OR BRANCH_RESOLVED_BY_AUTO_DETECT=true)');
    expect(combinedIdx).toBeGreaterThan(-1);
    // The AskUserQuestion call comes AFTER the combined guard block
    const askIdx = fbBlock.indexOf('Call AskUserQuestion');
    expect(askIdx).toBeGreaterThan(combinedIdx);
  });

  test('auto-detected branch flows through reuse-mode PR_ACTIONS normalization', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const fbStart = text.indexOf('title: Feature Branch Creation');
    const mpStart = text.indexOf('title: Marketplace Preflight Check');
    const fbBlock = text.slice(fbStart, mpStart);
    // The reuse-mode transform sets STACKED_PRS=false and creates completion entry
    const reuseTransformIdx = fbBlock.indexOf('If USE_PROPOSED=false (current or specified branch)');
    const autoDetectIdx = fbBlock.indexOf('TRD Branch Auto-Detection');
    expect(autoDetectIdx).toBeGreaterThan(-1);
    expect(reuseTransformIdx).toBeGreaterThan(autoDetectIdx);
  });
});

describe('implement-trd-beads Preflight resolve-sdlc rewiring (TRD-008)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('no unconditional HALT tied to validate-git-town.sh exit codes 1 or 2', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Git-Town and Working Directory Verification');
    const stepEnd = text.indexOf('title: TRD Selection and Validation');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    // Exit codes 1/2 must be explicitly called out as no longer HALTing
    expect(stepBlock).toMatch(/Exit codes 0 \(ok\), 1 \(not installed\), and 2 \(not configured\) no longer HALT here/);
    // Only exit codes 3/4 retain the old unconditional HALT behavior
    expect(stepBlock).toMatch(/Exit codes 3 \(version mismatch\) and 4 \(not a git repo\) are unaffected by this feature — HALT on those exactly as before/);
  });

  test('resolve-sdlc invocation is present', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('node \\"$TRD_CLI\\" resolve-sdlc --git-town-exit-code');
    expect(text).toContain('RESOLVE_SDLC_RESULT');
  });

  test('four-option AskUserQuestion block for PR backend resolution is present', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Git-Town and Working Directory Verification');
    const stepEnd = text.indexOf('title: TRD Selection and Validation');
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("id='pr_backend'");
    expect(stepBlock).toContain("label:'ado'");
    expect(stepBlock).toContain("label:'manual'");
    expect(stepBlock).toContain("label:'proceed with gh anyway (not recommended)'");
    expect(stepBlock).toContain("label:'abort'");
    // Non-interactive / uncertain-interactive path HALTs with the env var to set, never hangs
    expect(stepBlock).toMatch(/INTERACTIVE=false, or INTERACTIVE detection is itself uncertain[\s\S]*HALT/);
  });

  test('repro scenario: ADO remote + git-town unconfigured/absent + non-interactive never HALTs on dead command text and never signals git town propose', () => {
    // Simulates the exact resolve-sdlc call this step drives, per TRD-008-TEST's second AC.
    const { resolveBranchingStrategy, resolvePrBackend } = require('../lib/pr-strategy.js');
    for (const exitCode of [1, 2]) {
      const branching = resolveBranchingStrategy({}, exitCode);
      expect(branching.action).not.toBe('halt');
      expect(branching.strategy).toBe('plain-git');
      const backend = resolvePrBackend({}, 'https://dev.azure.com/org/project/_git/repo');
      expect(backend.needsResolution).toBe(true);
      // Non-interactive callers HALT on unresolved backend rather than guessing 'gh' — never a git town propose call.
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runChoicesRead / runChoicesWrite — trd-cli.js unit tests
// ─────────────────────────────────────────────────────────────────────────────
const { runChoicesRead, runChoicesWrite } = require('../lib/trd-cli.js');
const os = require('os');

describe('runChoicesRead / runChoicesWrite', () => {
  const trdWithFrontmatter = [
    '---',
    'title: Test TRD',
    'ensemble_implement_trd_beads:',
    '  branch_name: feature/previous-branch',
    '  use_proposed: true',
    '  stacked_prs: false',
    '---',
    '',
    '# Test content',
    '',
  ].join('\n');

  const trdNoBlock = [
    '---',
    'title: Test TRD',
    '---',
    '',
    '# Test content',
    '',
  ].join('\n');

  test('read: returns empty choices when no ensemble_implement_trd_beads block exists', () => {
    const tmp = path.join(os.tmpdir(), `trd-no-block-${Date.now()}.md`);
    fs.writeFileSync(tmp, trdNoBlock);
    try {
      const result = runChoicesRead([tmp]);
      expect(result.ok).toBe(true);
      expect(result.choices.branch_name).toBe('');
      expect(result.choices.use_proposed).toBe(false);
      expect(result.choices.stacked_prs).toBe(false);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('read: parses existing block correctly', () => {
    const tmp = path.join(os.tmpdir(), `trd-with-block-${Date.now()}.md`);
    fs.writeFileSync(tmp, trdWithFrontmatter);
    try {
      const result = runChoicesRead([tmp]);
      expect(result.ok).toBe(true);
      expect(result.choices.branch_name).toBe('feature/previous-branch');
      expect(result.choices.use_proposed).toBe(true);
      expect(result.choices.stacked_prs).toBe(false);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('write: creates block when none exists', () => {
    const tmp = path.join(os.tmpdir(), `trd-write-new-${Date.now()}.md`);
    fs.writeFileSync(tmp, trdNoBlock);
    try {
      const result = runChoicesWrite([tmp, '--branch-name', 'feature/new-branch', '--use-proposed', '--stacked-prs']);
      expect(result.ok).toBe(true);
      const written = fs.readFileSync(tmp, 'utf8');
      expect(written).toMatch(/^ensemble_implement_trd_beads:/m);
      expect(written).toMatch(/^  branch_name: feature\/new-branch$/m);
      expect(written).toMatch(/^  use_proposed: true$/m);
      expect(written).toMatch(/^  stacked_prs: true$/m);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('write: replaces existing block — top-level key (not indented), boolean flags truthy', () => {
    const tmp = path.join(os.tmpdir(), `trd-write-replace-${Date.now()}.md`);
    fs.writeFileSync(tmp, trdWithFrontmatter);
    try {
      runChoicesWrite([tmp, '--branch-name', 'feature/replaced', '--use-proposed']);
      const written = fs.readFileSync(tmp, 'utf8');
      // Top-level key check (not indented with 2 spaces)
      expect(written).toMatch(/^ensemble_implement_trd_beads:/m);
      // Previous values gone
      expect(written).not.toMatch(/^  branch_name: feature\/previous-branch$/m);
      expect(written).toMatch(/^  branch_name: feature\/replaced$/m);
      expect(written).toMatch(/^  use_proposed: true$/m);
      expect(written).toMatch(/^  stacked_prs: false$/m); // was false, not toggled
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('write + read: round-trip with space-separated --branch-name flag', () => {
    const tmp = path.join(os.tmpdir(), `trd-roundtrip-${Date.now()}.md`);
    fs.writeFileSync(tmp, trdNoBlock);
    try {
      const writeResult = runChoicesWrite([tmp, '--branch-name', 'feature/roundtrip', '--stacked-prs']);
      expect(writeResult.ok).toBe(true);
      const readResult = runChoicesRead([tmp]);
      expect(readResult.ok).toBe(true);
      expect(readResult.choices.branch_name).toBe('feature/roundtrip');
      expect(readResult.choices.use_proposed).toBe(false);
      expect(readResult.choices.stacked_prs).toBe(true);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test('read: branch_name outside the ensemble_implement_trd_beads block is NOT parsed (block is authoritative)', () => {
    // TRD has branch_name both inside AND outside the choices block
    const text = [
      '---',
      'title: Test TRD',
      'ensemble_implement_trd_beads:',
      '  branch_name: feature/saved-choice',
      '  use_proposed: true',
      '  stacked_prs: false',
      'owner: alice',
      'branch_name: feature/outside-block',
      '---',
      '',
      '# Test content',
      '',
    ].join('\n');
    const tmp = path.join(os.tmpdir(), `trd-outside-block-${Date.now()}.md`);
    fs.writeFileSync(tmp, text);
    try {
      const result = runChoicesRead([tmp]);
      expect(result.ok).toBe(true);
      // Must read from inside the block, NOT from the top-level branch_name
      expect(result.choices.branch_name).toBe('feature/saved-choice');
      expect(result.choices.use_proposed).toBe(true);
      expect(result.choices.stacked_prs).toBe(false);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe('implement-trd-beads plain-git branch creation (TRD-009)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('Feature Branch Creation: plain-git clause uses git checkout -b, zero git town invocations', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const clauseStart = text.indexOf("AND BRANCHING_STRATEGY=='plain-git': resolve BASE_BRANCH");
    expect(clauseStart).toBeGreaterThan(-1);
    // Clause runs to the end of that bullet's sentence about zero git town commands.
    const clauseEnd = text.indexOf("Zero git town commands are issued anywhere in this run when BRANCHING_STRATEGY=='plain-git'.", clauseStart);
    expect(clauseEnd).toBeGreaterThan(clauseStart);
    const clause = text.slice(clauseStart, clauseEnd);
    expect(clause).toContain('git checkout -b <branch_name> <BASE_BRANCH>');
    // No actual git-town subcommand invocation anywhere in the plain-git clause itself
    // (comparisons like "the same base branch git town hack would have targeted" are prose, not invocations)
    expect(clause).not.toMatch(/git town (hack|propose|append)(?! would)/);
  });

  test('Gate Result Recording: appendNextBranch plain-git next-branch clause uses git checkout -b, zero git town invocations', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const clauseStart = text.indexOf("if BRANCHING_STRATEGY=='plain-git': run git checkout -b <NEXT_BRANCH>");
    expect(clauseStart).toBeGreaterThan(-1);
    const clauseEnd = text.indexOf("'Next branch ready:", clauseStart);
    expect(clauseEnd).toBeGreaterThan(clauseStart);
    const clause = text.slice(clauseStart, clauseEnd);
    expect(clause).toContain('git checkout -b <NEXT_BRANCH>');
    // (comparison like "the same parent-branch topology git town append would have produced" is prose, not an invocation)
    expect(clause).not.toMatch(/git town (hack|propose|append)(?! would)/);
  });

  test('the git-town clause (unchanged) still uses git town hack/append, proving the split is config-driven, not a deletion', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain("AND BRANCHING_STRATEGY=='git-town': git town hack <branch_name> [UNCHANGED]");
    expect(text).toContain("if BRANCHING_STRATEGY=='git-town': run git town append <NEXT_BRANCH> [UNCHANGED]");
  });
});

describe('implement-trd-beads PR-backend branching logic (TRD-010)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('Gate Result Recording (Quality Gate) declares three distinct PR_BACKEND branches', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Gate Result Recording');
    const stepEnd = text.indexOf('title: Epic Closure');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='git-town' [UNCHANGED]: ensure currently checked out on GATE_ACTION.branch");
    expect(stepBlock).toContain("PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='plain-git': ensure currently checked out on GATE_ACTION.branch");
    expect(stepBlock).toContain("PR_BACKEND=='ado': ensure currently checked out on GATE_ACTION.branch");
    expect(stepBlock).toContain("PR_BACKEND=='manual': print 'PR backend is manual");
    // gh+git-town uses git town propose; gh+plain-git is a standalone gh call, never routed through git town
    expect(stepBlock).toContain('run git town propose --title');
    expect(stepBlock).toMatch(/gh pr create --title '<GATE_ACTION\.proposeTitle>'[\s\S]*?\(a standalone gh call, not routed through any git town command\)/);
    // ado prefers the azure-devops MCP tool, falls back to manual az/portal instructions, never HALTs
    expect(stepBlock).toContain("scan available tool names for any name starting with 'mcp__azure-devops'");
    expect(stepBlock).toContain('az repos pr create --source-branch');
    expect(stepBlock).toMatch(/do NOT HALT, do NOT attempt any other shell-out/);
  });

  test('Completion Report declares the same three distinct PR_BACKEND branches for the single-PR path', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Completion Report');
    const stepEnd = text.indexOf('expectedInput:');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toContain("PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='git-town' [UNCHANGED]: run git town propose --title '<COMPLETION_ACTION.proposeTitle>'");
    expect(stepBlock).toContain("PR_BACKEND=='gh' AND BRANCHING_STRATEGY=='plain-git': run git push -u origin <COMPLETION_ACTION.branch>, then run gh pr create");
    expect(stepBlock).toContain("PR_BACKEND=='ado': run git push -u origin <COMPLETION_ACTION.branch>; scan available tool names for any name starting with 'mcp__azure-devops'");
    expect(stepBlock).toContain("PR_BACKEND=='manual': print 'PR backend is manual — create this PR yourself:'");
  });

  test('ado sub-cases: MCP-present records PR URL, MCP-absent prints manual az/portal steps and continues without HALT', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Gate Result Recording');
    const stepEnd = text.indexOf('title: Epic Closure');
    const adoClauseStart = text.indexOf("PR_BACKEND=='ado':", stepStart);
    expect(adoClauseStart).toBeGreaterThan(stepStart);
    expect(adoClauseStart).toBeLessThan(stepEnd);
    const adoClauseEnd = text.indexOf("PR_BACKEND=='manual':", adoClauseStart);
    const adoClause = text.slice(adoClauseStart, adoClauseEnd);
    // MCP-present sub-case
    expect(adoClause).toContain('If found: call its repo_create_pull_request tool');
    expect(adoClause).toContain('record the returned PR URL as PHASE_PR_MAP[N] exactly as git town propose\'s output is recorded above');
    // MCP-absent sub-case
    expect(adoClause).toContain('If NOT found: print \'Azure DevOps MCP tool not connected — create this PR manually:\'');
    expect(adoClause).toContain('az repos pr create --source-branch <GATE_ACTION.branch> --target-branch <GATE_ACTION.parentBranch or main>');
    expect(adoClause).toContain('do NOT HALT, do NOT attempt any other shell-out; PHASE_PR_MAP[N] remains unset');
  });
});

describe('implement-trd-beads resume-path config freshness (TRD-011)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('Resume Detection step documents that BRANCHING_STRATEGY/PR_BACKEND are always re-resolved fresh, never reused from persisted choices', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Resume Detection');
    const stepEnd = text.indexOf('title: TRD Staleness Gate');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);
    expect(stepBlock).toMatch(/BRANCHING_STRATEGY\/PR_BACKEND were already re-resolved fresh in Preflight step 4/);
    expect(stepBlock).toContain('resuming never reuses a strategy/backend value cached from this');
    expect(stepBlock).toContain('branch_name/use_proposed/stacked_prs are the only');
    expect(stepBlock).toContain('BRANCHING_STRATEGY and PR_BACKEND are');
    expect(stepBlock).toContain('never written there and are always live-resolved');
  });

  test('no code path skips Preflight resolve-sdlc on resume: resume branch runs after step 4, never before it', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const resolveSdlcIdx = text.indexOf('node \\"$TRD_CLI\\" resolve-sdlc --git-town-exit-code');
    const resumeStepIdx = text.indexOf('title: Resume Detection');
    expect(resolveSdlcIdx).toBeGreaterThan(-1);
    expect(resumeStepIdx).toBeGreaterThan(resolveSdlcIdx);
    // Resume-found branch does not re-invoke resolve-sdlc (it relies on step 4 already having run this invocation)
    // but neither does it short-circuit past step 4 — step 4 (Git-Town and Working Directory Verification)
    // is order 4, strictly before Resume Detection at order 7, in every invocation including EXECUTE_ONLY resume.
    const gitTownStepIdx = text.indexOf('title: Git-Town and Working Directory Verification');
    const executeOnlyIdx = text.indexOf('If EXECUTE_ONLY=true: skip scaffold phase entirely.');
    expect(gitTownStepIdx).toBeGreaterThan(-1);
    expect(executeOnlyIdx).toBeGreaterThan(gitTownStepIdx);
  });

  test('reconciliation-notice action references both a prior (unnamed, unpersisted) resolution and the current session\'s values', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Resume Detection');
    const stepEnd = text.indexOf('title: TRD Staleness Gate');
    const stepBlock = text.slice(stepStart, stepEnd);
    const noticeIdx = stepBlock.indexOf('Reconciliation notice (REQ-014/REQ-015):');
    expect(noticeIdx).toBeGreaterThan(-1);
    const noticeClause = stepBlock.slice(noticeIdx);
    // Current-session values named explicitly
    expect(noticeClause).toContain('this session resolved BRANCHING_STRATEGY=<BRANCHING_STRATEGY>, PR_BACKEND=<PR_BACKEND>');
    // Prior session's resolution acknowledged but explicitly not persisted/nameable
    expect(noticeClause).toContain("The prior session's resolution is not persisted anywhere, so it cannot be named exactly here");
    // Only fires when a resume was actually detected AND a consolidated message exists for this invocation
    expect(noticeClause).toMatch(/if a resume was just detected \(ROOT_EPIC_ID found above\) AND RESOLVE_SDLC_RESULT\.consolidatedMessage[\s\S]*is non-null/);
    // Deliberate limitation: never rewrites/retargets prior branches or PRs
    expect(noticeClause).toContain('no branch or PR created in a prior session is rewritten, re-targeted, or otherwise touched');
  });
});

describe('implement-trd-beads always-on team roster (team8)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('Preflight contains Team Configuration Detection with default 8-role roster log', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toMatch(/title: Team Configuration Detection/);
    expect(text).toMatch(/always-on default 8-role roster/);
    expect(text).toMatch(/Team mode \(default roster\): lead=<lead>, architect=<architect>, builders=<n>, reviewer=<reviewer>, qa=<qa>, advisor=<advisor>, pm=<pm>, documentation=<documentation>/);
  });

  test('Execute delegation passes --team-roles instead of only --builder', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: Delegate to beads-build');
    const stepEnd = text.indexOf('- name: Quality Gate');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    expect(stepBlock).toMatch(/TEAM_ROLES_JSON/);
    expect(stepBlock).toMatch(/--team-roles '<TEAM_ROLES_JSON>'/);
    expect(stepBlock).toMatch(/deprecated fallback accepted by beads-build/);
  });

  test('--foreman tags only task beads with foreman-exec after bv planning, without replacing labels', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const stepStart = text.indexOf('title: BV Execution Planning');
    const stepEnd = text.indexOf('title: Scaffold Summary and BV Analysis');
    expect(stepStart).toBeGreaterThan(-1);
    expect(stepEnd).toBeGreaterThan(stepStart);
    const stepBlock = text.slice(stepStart, stepEnd);

    expect(stepBlock.indexOf('bv --robot-plan --format toon')).toBeGreaterThan(-1);
    expect(stepBlock.indexOf('br update <BEAD_ID> --add-label foreman-exec')).toBeGreaterThan(
      stepBlock.indexOf('bv --robot-plan --format toon')
    );
    expect(stepBlock).toMatch(/NEVER tag the root epic or story beads/);
    expect(stepBlock).toMatch(/NEVER use --labels or --set-labels/);
    expect(stepBlock).not.toMatch(/br update <BEAD_ID> --labels/);
  });
});

describe('implement-trd-beads PR review gates at stacked-phase and single-PR boundaries (TRD-013)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
  const text = fs.readFileSync(yamlPath, 'utf8');

  function sliceBetween(startMarker, endMarker, fromIdx = 0) {
    const start = text.indexOf(startMarker, fromIdx);
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf(endMarker, start);
    expect(end).toBeGreaterThan(start);
    return { start, end, block: text.slice(start, end) };
  }

  // The Gate Result Recording step's actions in order, and where a given one sits among them.
  const gateResultActions = () => actionsOf(sliceBetween('title: Gate Result Recording', 'title: Epic Closure').block);
  const at = (actions, re) => actions.findIndex((a) => re.test(a));
  const REVIEW_GATE = /^PR Review Gate \(TRD-013/;
  const GATE_RESULT = /^Parse the skill's return \{status, localPhase/;

  test('Scenario: stacked gate precedes propose and append -- the review gate runs before git town propose and before the appendNextBranch clause', () => {
    const actions = gateResultActions();
    const gateAt = at(actions, REVIEW_GATE);

    expect(gateAt).toBeGreaterThan(-1);
    expect(at(actions, /git town propose/)).toBeGreaterThan(gateAt);
    expect(at(actions, /git town append/)).toBeGreaterThan(gateAt);
  });

  test('Scenario: a blocked phase review halts before PR creation or branch append, without touching the existing gate_passed checkpoint', () => {
    const actions = gateResultActions();
    const gateAt = at(actions, REVIEW_GATE);
    const resultAt = at(actions, GATE_RESULT);

    expect(gateAt).toBeGreaterThan(-1);
    expect(resultAt).toBeGreaterThan(gateAt);
    // The gate value is derived from the raw localPhase by a match on the one good value only ...
    expect(rawPhaseComparisons(actions[resultAt])).toEqual(['LOCAL_REVIEW_COMPLETE']);
    // ... every other outcome HALTs in this action, which precedes every action that creates the PR or appends the next branch.
    expect(actions[resultAt]).toMatch(/\bHALT\b/);
    expect(resultAt).toBeLessThan(at(actions, /git town propose/));
    expect(resultAt).toBeLessThan(at(actions, /git town append/));
    // The existing gate_passed checkpoint close runs earlier in the same step and is untouched by the new gate.
    const checkpointAt = at(actions, /br close <STORY_BEAD_ID>/);
    expect(checkpointAt).toBeGreaterThan(-1);
    expect(checkpointAt).toBeLessThan(gateAt);
  });

  test("Scenario: a phase review excludes later phases -- PARENT_PHASE_TIP_SHA is the parent branch tip, so BASE_SHA excludes the parent phase's own commits and any later phase", () => {
    const actions = gateResultActions();
    const gate = actions[at(actions, REVIEW_GATE)];

    expect(gate).toContain('PARENT_PHASE_TIP_SHA = git merge-base HEAD <GATE_ACTION.parentBranch>');
    expect(gate).toContain('BASE_SHA=<PARENT_PHASE_TIP_SHA>');
    expect(gate).toContain('HEAD_SHA=<git rev-parse HEAD>');
  });

  test('Scenario: single-PR gate precedes Epic Closure and the completion PR -- the whole-branch review runs once, in the PR Review Completion Check, never in Completion Report', () => {
    const checkStart = text.indexOf('title: PR Review Completion Check');
    const epicStart = text.indexOf('title: Epic Closure');
    const reportStart = text.indexOf('title: Completion Report');
    expect(checkStart).toBeGreaterThan(-1);
    expect(epicStart).toBeGreaterThan(checkStart);
    expect(reportStart).toBeGreaterThan(epicStart);

    const checkBlock = text.slice(checkStart, epicStart);
    const reportBlock = text.slice(reportStart, text.indexOf('expectedInput:', reportStart));

    // The local review is invoked exactly once, before Epic Closure ...
    const gateActions = actionsOf(checkBlock).filter((a) => /MODE='local'/.test(a) && /<TRD_SLUG>-completion/.test(a));
    expect(gateActions).toHaveLength(1);
    // ... and never again in Completion Report, whose PR creation therefore runs on an already-reviewed head.
    expect(reportBlock).not.toMatch(/MODE='local'/);
    ['git town propose --title', 'gh pr create --title', "PR_BACKEND=='ado'", "PR_BACKEND=='manual'"].forEach((needle) => {
      expect(reportBlock).toContain(needle);
    });
  });

  test('Scenario: a blocked completion review halts BEFORE Epic Closure, leaving the epic open and creating no PR', () => {
    const checkBlock = text.slice(text.indexOf('title: PR Review Completion Check'), text.indexOf('title: Epic Closure'));
    const [gate, parse] = actionsOf(checkBlock);

    expect(gate).toMatch(/MODE='local'/);
    // The verdict is derived from the raw localPhase by a match on the one good value only ...
    expect(rawPhaseComparisons(parse)).toEqual(['LOCAL_REVIEW_COMPLETE']);
    // ... every other outcome HALTs here, in the check that sits before Epic Closure ...
    expect(parse).toMatch(/\bHALT\b/);
    // ... and that branch closes nothing and publishes nothing.
    const blockedAt = parse.indexOf("If COMPLETION_LOCAL_REVIEW=='LOCAL_REVIEW_BLOCKED'");
    const completeAt = parse.indexOf("If COMPLETION_LOCAL_REVIEW=='LOCAL_REVIEW_COMPLETE'");
    expect(blockedAt).toBeGreaterThan(-1);
    expect(completeAt).toBeGreaterThan(blockedAt);
    expect(parse.slice(blockedAt, completeAt)).not.toMatch(/\bbr close\b|git town propose|gh pr create|git push/);
  });

  test('R2 fail-closed: the completion gate resolves its base from the default branch, blocks on an empty/unresolvable base, and Epic Closure re-checks the verdict', () => {
    const checkBlock = text.slice(text.indexOf('title: PR Review Completion Check'), text.indexOf('title: Epic Closure'));
    const [gate, parse] = actionsOf(checkBlock);

    // No hardcoded base: it is derived from the default branch, with an explicit empty/unresolvable -> BLOCKED path.
    expect(gate).not.toMatch(/BASE_SHA=<git merge-base HEAD main>/);
    expect(gate).toContain('git symbolic-ref --short refs/remotes/origin/HEAD');
    expect(gate).toMatch(/empty or does not resolve to a commit, skip the skill call and treat the gate as LOCAL_REVIEW_BLOCKED/);
    expect(gate).toContain('BASE_SHA=<COMPLETION_BASE_SHA>');
    expect(parse).toMatch(/empty\/unresolvable COMPLETION_BASE_SHA/);
    // The halt covers anything other than exactly COMPLETE and a re-run starts a fresh review.
    expect(parse).toMatch(/anything other than exactly 'LOCAL_REVIEW_COMPLETE'/);
    expect(parse).toMatch(/FRESH review \(a prior BLOCKED result is never reused\)/);

    // Epic Closure itself refuses to run on any other/unset verdict.
    const epicBlock = text.slice(text.indexOf('title: Epic Closure'), text.indexOf('title: TRD Checkbox Sync'));
    const precondition = actionsOf(epicBlock)[0];
    expect(precondition).toMatch(/COMPLETION_LOCAL_REVIEW == 'LOCAL_REVIEW_COMPLETE'/);
    expect(precondition).toMatch(/any other, unset or missing value blocks/);
    expect(precondition).toMatch(/Otherwise this step must not run/);
  });

  test('Scenario: a stacked story is not closed until its PR review gate returns LOCAL_REVIEW_COMPLETE', () => {
    const { block } = sliceBetween('title: Gate Result Recording', 'title: Completion Verification');
    const actions = actionsOf(block);

    const gateIdx = actions.findIndex((a) => /^PR Review Gate \(TRD-013/.test(a));
    const resultIdx = actions.findIndex((a) => /^Parse the skill's return \{status, localPhase/.test(a));
    expect(gateIdx).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(gateIdx);

    // Any story close that can run BEFORE the review gate must be restricted to single-PR mode (no PR boundary).
    actions.slice(0, gateIdx).filter((a) => /br close <STORY_BEAD_ID>/.test(a)).forEach((a) => {
      expect(a).toMatch(/createPr == false/);
      expect(a).toMatch(/do NOT close <STORY_BEAD_ID> yet/);
    });

    // The stacked-mode close lives in the review-result action, only on the COMPLETE branch; BLOCKED keeps the story open.
    const result = actions[resultIdx];
    const blocked = result.indexOf("If PHASE_LOCAL_REVIEW=='LOCAL_REVIEW_BLOCKED'");
    const complete = result.indexOf("If PHASE_LOCAL_REVIEW=='LOCAL_REVIEW_COMPLETE'");
    const closeAt = result.indexOf('br close <STORY_BEAD_ID>');
    expect(blocked).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(blocked);
    expect(closeAt).toBeGreaterThan(complete);
    expect(result.slice(blocked, complete)).toMatch(/<STORY_BEAD_ID> stays OPEN/);
    expect(result.slice(blocked, complete)).not.toMatch(/br close/);
  });

  test('Scenario: existing safeguards intact -- pr-plan GATE_ACTION/COMPLETION_ACTION resolution, the Pre-PR test gate (still ahead of the review gate), and completion-verification are unchanged', () => {
    // pr-plan topology (GATE_ACTION/COMPLETION_ACTION) is still the source of branch/title/parent data.
    expect(text).toContain('GATE_ACTION = PR_ACTIONS[N]');
    expect(text).toContain("kind=='completion'");
    // The pre-existing Pre-PR test gate (tests+coverage, independent of review) still runs, still HALTs on failure, and precedes the review gate.
    const actions = gateResultActions();
    const preTestAt = actions.findIndex((a) => /npm run test --workspaces --if-present/.test(a) && /\bHALT\b/.test(a));
    expect(preTestAt).toBeGreaterThan(-1);
    expect(preTestAt).toBeLessThan(at(actions, REVIEW_GATE));
    // completion-verification stays the full-suite/requirement authority (TRD-014 adds a later, separate check).
    expect(text).toContain('packages/development/skills/completion-verification/SKILL.md');
    expect(text).toContain("TRACKING_MODE='beads'");
  });

  test('both PR Review Gate call sites resolve the shared pr-review-cycle skill by the canonical repo-root path (no duplicated review logic)', () => {
    // Exactly two MODE='local' call sites: Gate Result Recording (stacked) and
    // Completion Report (single-PR). TRD-014 adds a third, MODE='remote' call
    // site (PR Review Completion Check) -- covered separately in its own test.
    const localOccurrences = text.split(
      "pr-review-cycle/SKILL.md\\\", with MODE='local'"
    ).length - 1;
    expect(localOccurrences).toBe(2);
    expect(text).not.toMatch(/pr-review-cli\.js/);
  });
});

describe('implement-trd-beads PR-review completion check, messaging, manual/ADO backends (TRD-014)', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
  const text = fs.readFileSync(yamlPath, 'utf8');

  function sliceBetween(startMarker, endMarker, fromIdx = 0) {
    const start = text.indexOf(startMarker, fromIdx);
    expect(start).toBeGreaterThan(-1);
    const end = text.indexOf(endMarker, start);
    expect(end).toBeGreaterThan(start);
    return { start, end, block: text.slice(start, end) };
  }

  // The PR Review Completion Check step's actions, in order.
  const checkActions = () => actionsOf(sliceBetween('title: PR Review Completion Check', 'title: Epic Closure').block);

  test('Scenario: completion-verification stays authoritative -- Completion Verification runs first and the PR-review check is a separate step before Epic Closure', () => {
    const yaml = require('js-yaml');
    const doc = yaml.load(text);
    const completion = doc.workflow.phases.find((p) => p.name === 'Completion');
    const titles = completion.steps.map((s) => s.title);

    expect(titles).toEqual([
      'Completion Verification',
      'PR Review Completion Check',
      'Epic Closure',
      'TRD Checkbox Sync',
      'Completion Report',
    ]);

    // The check owns no verification of its own: it never invokes completion-verification, tracks no progress, and closes no bead.
    const prCheck = completion.steps.find((s) => s.title === 'PR Review Completion Check');
    expect(prCheck.actions.join('\n')).not.toMatch(/completion-verification|trd_progress|TRACKING_MODE|\bbr close\b/);
  });

  test('Scenario: no evidence is claimed when none was gathered -- a never-created PR is marked PENDING and never evaluated, and no status can say merged or landed', () => {
    const actions = checkActions();
    const unset = actions.find((a) => /whose url is unset/.test(a));
    const set = actions.find((a) => /whose url is set/.test(a));

    expect(unset).toBeDefined();
    expect(set).toBeDefined();
    // A PR that was never created is marked PENDING and is never sent to the review skill ...
    expect(unset).toContain("PR_REVIEW_STATUS[entry.n]='PENDING (no PR created)'");
    expect(unset).not.toMatch(/MODE='remote'/);
    // ... only a PR with a url is evaluated remotely.
    expect(set).toMatch(/MODE='remote'/);
    // The only statuses this check ever assigns are that marker and the skill's own verdict.
    const assigned = [...actions.join('\n').matchAll(/PR_REVIEW_STATUS\[entry\.n\]=('[^']*'|\w+)/g)].map((m) => m[1]);
    expect(assigned).toEqual(["'PENDING (no PR created)'", 'status']);
  });

  test('Scenario: manual backend prints steps and reports pending -- PR_BACKEND manual or ado-without-MCP boundaries are reported PENDING with manual review steps, never silently', () => {
    const unset = checkActions().find((a) => /whose url is unset/.test(a));

    expect(unset).toBeDefined();
    // Both causes of an unset url are named, the PENDING marker is set, and the user is told what to do.
    expect(unset).toContain("PR_BACKEND=='manual'");
    expect(unset).toContain("'ado'");
    expect(unset).toContain("PR_REVIEW_STATUS[entry.n]='PENDING (no PR created)'");
    expect(unset).toMatch(/\bprint\b/);
  });

  test('Scenario: pending remote review is never called merged -- the completion summary reports the evaluated status and never claims a just-created PR is reviewed', () => {
    const actions = actionsOf(sliceBetween('title: Completion Report', 'expectedInput:').block);
    const single = actions.find((a) => /=== PR SUMMARY ===/.test(a));
    const stacked = actions.find((a) => /=== STACKED PR SUMMARY ===/.test(a));

    expect(single).toBeDefined();
    expect(stacked).toBeDefined();
    // A PR created in this very step has had no remote review: its summary is pending, never complete.
    expect(single).toContain('REVIEW_PENDING');
    expect(single).not.toContain('REVIEW_COMPLETE');
    // The stacked summary reports each PR's evaluated status and flags a pending or blocked one as unfinished.
    expect(stacked).toMatch(/review: <PR_REVIEW_STATUS\[N\]>/);
    expect(stacked).toContain('REVIEW_PENDING or REVIEW_BLOCKED');
  });

  test('the remote evaluation never HALTs or blocks Epic Closure -- the only HALT in the check is the single-PR local gate', () => {
    const actions = checkActions();
    const halting = actions.filter((a) => /\bHALT\b/.test(a));

    // The local gate's verdict action is where the check halts; any other mention is the note naming it as the only one.
    expect(halting.length).toBeGreaterThan(0);
    expect(halting.some((a) => /COMPLETION_LOCAL_REVIEW/.test(a))).toBe(true);
    halting.forEach((a) => expect(a).toMatch(/COMPLETION_LOCAL_REVIEW|local review gate/));
    // No remote-evaluation action (the MODE='remote' invocation or a PR_REVIEW_STATUS assignment) halts.
    actions
      .filter((a) => /MODE='remote'|PR_REVIEW_STATUS\[entry\.n\]/.test(a))
      .forEach((a) => expect(a).not.toMatch(/\bHALT\b/));
  });

  test('the completion-side remote check reuses the same canonical pr-review-cycle skill path as the TRD-013 local gates (MODE=remote, one call site)', () => {
    const remoteOccurrences = text.split(
      "pr-review-cycle/SKILL.md\\\", with MODE='remote'"
    ).length - 1;
    expect(remoteOccurrences).toBe(1);
  });
});

describe('implement-trd-beads PR review gate decision points are positive-only (R3-P3-F1 sweep)', () => {
  // Every property is a pure function of a yaml text. The SAME function judges the shipped file (it must report nothing)
  // and an in-memory mutant of it (it must report the defect), so no property here is a check that cannot fail.
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
  const text = fs.readFileSync(yamlPath, 'utf8');

  const slice = (src, from, to) => {
    const start = src.indexOf(from);
    if (start < 0) throw new Error(`marker not found: ${from}`);
    const end = src.indexOf(to, start + from.length);
    if (end < 0) throw new Error(`marker not found: ${to}`);
    return src.slice(start, end);
  };
  const guarded = (check) => (src) => {
    try {
      return check(src);
    } catch (error) {
      return [error.message];
    }
  };
  // The one occurrence of `anchor` (any run of whitespace matches any run) replaced; zero or several is an error, because
  // a mutant that silently changed nothing proves nothing.
  const replaceOnce = (src, anchor, replacement) => {
    const pattern = new RegExp(
      anchor
        .split(/\s+/)
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+'),
      'g'
    );
    const found = [...src.matchAll(pattern)];
    if (found.length !== 1) throw new Error(`a mutation anchor must occur exactly once (found ${found.length}): ${anchor}`);
    return src.slice(0, found[0].index) + replacement + src.slice(found[0].index + found[0][0].length);
  };
  const checkActions = (src) => actionsOf(slice(src, 'title: PR Review Completion Check', 'title: Epic Closure'));
  const epicActions = (src) => actionsOf(slice(src, 'title: Epic Closure', 'title: TRD Checkbox Sync'));

  // The whole-branch gate is skipped ONLY for a completion action positively recognised as stacked (it exists and its
  // createPr is exactly false); a missing action or an odd createPr is not stacked mode, so the gate fails closed.
  const completionGateProblems = (src) => {
    const [gate, verdict] = checkActions(src);
    const problems = [];
    const skipAt = gate.search(/\bskip this action and the next\b/i);
    if (skipAt < 0) return ['the completion gate has no skip clause'];
    if (!/\bexactly false\b/.test(gate.slice(skipAt, skipAt + 200))) problems.push('the skip is not conditioned on an exactly-false createPr');
    if (/If COMPLETION_ACTION\.createPr == false/.test(gate)) problems.push('the skip is keyed on the bad value alone, so an unrecognised shape would slip past');
    const catchAllAt = gate.search(/\bmissing COMPLETION_ACTION\b/);
    if (catchAllAt < skipAt || !/LOCAL_REVIEW_BLOCKED/.test(gate.slice(catchAllAt))) problems.push('an unrecognised completion action is not treated as BLOCKED');
    if (!/unrecognised COMPLETION_ACTION/.test(verdict)) problems.push('the verdict does not derive BLOCKED for an unrecognised completion action');
    return problems;
  };
  // Epic Closure proceeds for a positively recognised stacked run (positive control: it must still be reachable) or on
  // the exact single-PR verdict; every other shape, unset value or unreadable listing blocks it.
  const epicClosureProblems = (src) => {
    const [precondition, verify] = epicActions(src);
    const problems = [];
    if (!/COMPLETION_ACTION exists and its createPr is exactly false/.test(precondition)) problems.push('the precondition does not positively recognise a stacked run, which must still reach Epic Closure');
    if (!/COMPLETION_LOCAL_REVIEW == 'LOCAL_REVIEW_COMPLETE'/.test(precondition)) problems.push('the single-PR verdict is not required');
    if (!/any other, unset or missing value blocks/.test(precondition)) problems.push('an unset or odd verdict is not stated to block');
    if (!/missing COMPLETION_ACTION/.test(precondition)) problems.push('a missing completion action is not stated to block');
    if (/in single-PR mode \(a completion action with createPr==true\)/.test(precondition)) problems.push('single-PR mode is recognised positively, so an unrecognised shape skips the gate');
    if (!/Otherwise this step must not run/.test(precondition)) problems.push('the precondition has no catch-all');
    if (!/listing that fails or cannot be parsed[^.]*open beads/.test(verify)) problems.push('an unreadable bead listing is not treated as open beads');
    return problems;
  };
  // The remote evaluation only reports and never gates, but what it reports must be truthful: only an exact
  // REVIEW_COMPLETE reads as complete, and a status this step does not recognise degrades to PENDING.
  const remoteStatusProblems = (src) => {
    const action = checkActions(src).find((a) => /Set PR_REVIEW_STATUS\[entry\.n\]=status/.test(a));
    if (!action) return ['no action records the evaluated remote status'];
    const problems = [];
    if (!/exactly one of 'REVIEW_COMPLETE', 'REVIEW_PENDING' or 'REVIEW_BLOCKED'/.test(action)) problems.push('the recorded status is not limited to the three known words');
    if (!/any other, missing or unparseable status[^.]*'REVIEW_PENDING'[^.]*never as REVIEW_COMPLETE/.test(action)) problems.push('an unrecognised status does not degrade to PENDING');
    return problems;
  };

  const PROPERTIES = [
    ['completion-gate-skips-only-explicit-stacked', completionGateProblems],
    ['epic-closure-needs-stacked-or-exact-verdict', epicClosureProblems],
    ['remote-status-degrades-to-pending', remoteStatusProblems],
  ].map(([id, check]) => ({ id, check: guarded(check) }));

  test.each(PROPERTIES)('Scenario: $id holds on the shipped yaml', ({ check }) => {
    expect(check(text)).toEqual([]);
  });

  // Each mutant reverts or drops ONE guarantee in an in-memory copy of the shipped yaml; the property that guards it must report.
  const MUTANTS = [
    [
      'skipping the gate on the bad value alone',
      'completion-gate-skips-only-explicit-stacked',
      (src) => replaceOnce(src, 'Skip this action and the next ONLY when COMPLETION_ACTION exists and its createPr is exactly false (stacked mode)', 'If COMPLETION_ACTION.createPr == false (stacked mode): skip this action and the next'),
    ],
    [
      'dropping the unrecognised-completion-action catch-all',
      'completion-gate-skips-only-explicit-stacked',
      (src) => replaceOnce(src, 'A missing COMPLETION_ACTION, or a createPr that is neither exactly true nor exactly false, is not stacked mode: treat the gate as LOCAL_REVIEW_BLOCKED (never skip it on a shape this step does not recognise).', ''),
    ],
    [
      'leaving the unrecognised action out of the BLOCKED causes of the verdict',
      'completion-gate-skips-only-explicit-stacked',
      (src) => replaceOnce(src, ', or an unrecognised COMPLETION_ACTION)', ')'),
    ],
    [
      'recognising single-PR mode positively in the Epic Closure precondition',
      'epic-closure-needs-stacked-or-exact-verdict',
      (src) => replaceOnce(src, 'AND the PR review gate holds: either COMPLETION_ACTION exists and its createPr is exactly false (stacked mode: no completion PR exists and every phase gate already passed), or COMPLETION_LOCAL_REVIEW', 'AND, in single-PR mode (a completion action with createPr==true), COMPLETION_LOCAL_REVIEW'),
    ],
    [
      'dropping the stacked exception (a stacked run could never close its epic)',
      'epic-closure-needs-stacked-or-exact-verdict',
      (src) => replaceOnce(src, 'either COMPLETION_ACTION exists and its createPr is exactly false (stacked mode: no completion PR exists and every phase gate already passed), or COMPLETION_LOCAL_REVIEW', 'COMPLETION_LOCAL_REVIEW'),
    ],
    [
      'treating a missing completion action as stacked',
      'epic-closure-needs-stacked-or-exact-verdict',
      (src) => replaceOnce(src, ', and so does a missing COMPLETION_ACTION or a createPr that is not exactly false', ''),
    ],
    [
      'trusting an unreadable bead listing',
      'epic-closure-needs-stacked-or-exact-verdict',
      (src) => replaceOnce(src, 'A listing that fails or cannot be parsed counts as open beads remaining: do not close the epic. ', ''),
    ],
    [
      'letting an unrecognised remote status through unchanged',
      'remote-status-degrades-to-pending',
      (src) => replaceOnce(src, "; any other, missing or unparseable status, or no return at all, is recorded as 'REVIEW_PENDING' with the reasons it could not be read (never as REVIEW_COMPLETE)", ''),
    ],
  ].map(([name, property, mutate]) => ({ name, property, mutate, check: PROPERTIES.find((p) => p.id === property).check }));

  test.each(MUTANTS)('negative control: $name is reported by $property', ({ mutate, check }) => {
    const mutant = mutate(text);

    expect(mutant).not.toBe(text);
    expect(check(mutant).length).toBeGreaterThan(0);
  });

  test('every property has at least one mutant that it reports', () => {
    PROPERTIES.forEach(({ id }) => expect(MUTANTS.some((mutant) => mutant.property === id)).toBe(true));
  });
});
