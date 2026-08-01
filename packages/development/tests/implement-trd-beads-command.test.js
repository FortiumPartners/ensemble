const fs = require('fs');
const path = require('path');

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
    expect(confirmedIdx).toBeGreaterThan(-1);
    expect(postPlanGitSwitch).toBeGreaterThan(confirmedIdx);
    expect(postPlanGitTown).toBeGreaterThan(confirmedIdx);
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
});
