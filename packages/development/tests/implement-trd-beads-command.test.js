const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { readDevelopmentSkill, parseWorkflow, parseParameters } = require('./helpers/skill-workflow');

// implement-trd-beads is a thin orchestrator: these tests pin the machine contracts it
// shares with other components (flags, CLI invocations, gate ordering, fail-closed gates),
// not its wording. Branch/PR/workstream/resume detail lives in the
// implement-trd-beads-reference skill.

const YAML_PATH = path.join(__dirname, '../commands/implement-trd-beads.yaml');
const REF_PATH = path.join(__dirname, '../skills/implement-trd-beads-reference/SKILL.md');
// implement-trd-beads is a skill-backed command: the YAML is a manifest (metadata + skill) and
// the prompt is its skill -- SKILL.md plus the phase files under references/.
const manifest = yaml.load(fs.readFileSync(YAML_PATH, 'utf8'));
const skill = readDevelopmentSkill(manifest.skill);
const text = skill.prompt;
// The reference skill's companion files (reference/*.md) hold detail moved out of the budgeted SKILL.md.
const REF_DIR = path.join(path.dirname(REF_PATH), 'reference');
const ref = [REF_PATH, ...fs.readdirSync(REF_DIR).sort().map((f) => path.join(REF_DIR, f))]
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
// The `## Expected Output` bullets of SKILL.md: `- **<name>**: <description>`.
const expectedOutputSection = skill.body.slice(skill.body.indexOf('\n## Expected Output\n'), skill.body.indexOf('\n## Expected Input\n'));
const doc = {
  metadata: manifest.metadata,
  parameters: parseParameters(skill.body),
  mission: { summary: skill.body.slice(0, skill.body.indexOf('\n## Capabilities\n')) },
  expectedOutput: {
    structure: [...expectedOutputSection.matchAll(/^- \*\*(.+?)\*\*:/gm)].map((m) => ({ name: m[1] })),
  },
  workflow: { phases: parseWorkflow(skill) },
};

const phase = (name) => doc.workflow.phases.find((p) => p.name === name);
const step = (phaseName, title) => phase(phaseName).steps.find((s) => s.title === title);
const actions = (phaseName, title) => step(phaseName, title).actions.join('\n');
const allActions = doc.workflow.phases.flatMap((p) => p.steps.flatMap((s) => s.actions || [])).join('\n');

// Every literal the RAW skill field `localPhase` is compared with. A gate must key on the one good value.
const rawPhaseComparisons = (s) => [...s.matchAll(/\blocalPhase\s*==\s*'([A-Z_]+)'/g)].map((m) => m[1]);

describe('implement-trd-beads delegation to beads-build', () => {
  test('passes the scoping flags and --defer-completion; this command owns closure', () => {
    const delegate = actions('Execute', 'Delegate to beads-build');
    expect(delegate).toMatch(
      /\/ensemble:beads-build <ROOT_EPIC_ID> --trd <TRD_FILE_PATH> --max-parallel <MAX_PARALLEL> --team-roles '<TEAM_ROLES_JSON>' --label <TRD_LABEL> --defer-completion/
    );
  });

  test('backfills the TRD label through trd-cli before delegating', () => {
    const delegate = actions('Execute', 'Delegate to beads-build');
    expect(delegate).toMatch(/beads-label --label "<TRD_LABEL>" --match "\[trd:<TRD_SLUG>/);
    expect(delegate.indexOf('beads-label')).toBeLessThan(delegate.indexOf('/ensemble:beads-build <ROOT_EPIC_ID>'));
  });

  test('--team-roles carries the roster; --builder is only a deprecated fallback', () => {
    const delegate = actions('Execute', 'Delegate to beads-build');
    expect(delegate).toContain('--team-roles');
    expect(delegate).toMatch(/deprecated `--builder`/);
  });
});

describe('implement-trd-beads scaffold executes the scaffold-plan PLAN', () => {
  test('uses trd-cli parse and scaffold-plan, never a hand parse', () => {
    const scaffold = actions('Scaffold', 'Plan and create beads');
    expect(scaffold).toContain('node "$TRD_CLI" parse');
    expect(scaffold).toContain('node "$TRD_CLI" scaffold-plan');
  });

  test('creates epic, stories, tasks, synthesized tests with --labels and wires plan.deps once', () => {
    const scaffold = actions('Scaffold', 'Plan and create beads');
    expect(scaffold).toMatch(/plan\.epic`, `plan\.stories\[\]`, `plan\.tasks\[\]`, `plan\.synthesizedTests\[\]/);
    expect(scaffold).toContain('no priority/labels/externalRef arg; externalRef folds into description, labels backfilled later');
    expect(scaffold).toContain('tracker.dep-add --arg id=<blocked_bead_id> --arg dependsOnId=<blocker_bead_id>');
    expect(scaffold).toMatch(/title prefix|titlePrefix/);
  });

  test('scaffold work is reserved for the scaffold specialist', () => {
    expect(text).toContain('@beads-scaffold-specialist');
  });
});

describe('implement-trd-beads Preflight contracts', () => {
  test('--plan and --execute are mutually exclusive; --branch and --use-current-branch are mutually exclusive', () => {
    const args = actions('Preflight', 'Arguments and early exits');
    expect(args).toContain('--plan` with `--execute');
    expect(args).toMatch(/both together HALT before any tracker\/git\/scaffold side effect/);
  });

  test('argument_hint advertises the branch-intent flags callers use', () => {
    expect(doc.metadata.argument_hint).toContain('--branch=<name>');
    expect(doc.metadata.argument_hint).toContain('--use-current-branch');
    expect(doc.metadata.argument_hint).toContain('--foreman');
  });

  test('TRD validation and --status go through trd-cli', () => {
    expect(actions('Preflight', 'TRD selection and validation')).toContain('node "$TRD_CLI" validate');
    expect(actions('Preflight', 'Arguments and early exits')).toContain('node "$TRD_CLI" status <TRD_SLUG>');
  });

  test('TRD_LABEL is defined as the TRD slug', () => {
    expect(actions('Preflight', 'TRD selection and validation')).toMatch(/TRD_LABEL = TRD_SLUG/);
  });

  test('clean-tree gate is decided at resume detection from the status captured earlier', () => {
    expect(step('Preflight', 'Git-town, PR backend and working tree').description).toContain('WORKTREE_STATUS');
    const resume = actions('Preflight', 'Resume detection, staleness gate, strategy');
    expect(resume).toMatch(/fresh run \+ dirty tree HALTs; resume \+ dirty tree notes it and continues/);
    expect(ref).toContain('run workflow.status');
    expect(ref).toMatch(/minus `\.beads\/` paths/);
  });

  test('staleness gate is skipped on resume and strategy detection follows it', () => {
    const resume = actions('Preflight', 'Resume detection, staleness gate, strategy');
    expect(resume.indexOf('staleness-gate')).toBeGreaterThan(-1);
    expect(resume).toMatch(/Skip it on resume/);
    expect(resume.indexOf('staleness-gate')).toBeLessThan(resume.indexOf('STRATEGY:'));
  });

  test('branch intent, resolve-sdlc and workstream procedures are delegated to the reference skill', () => {
    expect(step('Preflight', 'Branch intent and feature branch').actions.join('\n')).toContain('reference section 2');
    expect(step('Preflight', 'Git-town, PR backend and working tree').actions.join('\n')).toContain('reference section 1');
    expect(ref).toContain('resolve-sdlc --git-town-exit-code');
    expect(ref).toContain('choices-read');
    expect(ref).toContain('choices-write');
    expect(ref).toContain('pr-plan');
  });
});

describe('implement-trd-beads --workstream / --generate-only', () => {
  const pre = actions('Preflight', 'Arguments and early exits');
  const lines = step('Preflight', 'Arguments and early exits').actions;
  const idx = (needle) => lines.findIndex((a) => a.includes(needle));

  test('flags are advertised in argument_hint and parameters', () => {
    expect(doc.metadata.argument_hint).toContain('--workstream [--generate-only [--out <path>] [--allow-invalid]]');
    expect(doc.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['workstream', 'generate-only']));
  });

  test('generation runs trd-cli create-workstream-trd and forwards --out/--allow-invalid', () => {
    expect(pre).toContain('node "$TRD_CLI" create-workstream-trd <TRD_PATHS...>');
    expect(pre).toContain('`--out <path>`');
    expect(pre).toContain('`--allow-invalid`');
    expect(pre).toContain('{ok,path,workstreamSlug,sourceTrds,errors}');
  });

  test('multiple TRDs without --workstream/--legacy-multi HALT and point at the flag form', () => {
    expect(pre).toContain('/ensemble:implement-trd-beads --workstream --generate-only <trd1> <trd2>');
    expect(pre).not.toContain('/ensemble:create-workstream-trd');
  });

  test('--generate-only rejects other modes before anything else and exits before side effects', () => {
    const guard = idx('cannot be combined with --plan, --execute, --status, --reset-task, --list, --branch or --use-current-branch');
    const gen = idx('create-workstream-trd');
    const report = idx('next step `/ensemble:implement-trd-beads <generated-path>`');
    const status = idx('`--status`: single TRD');
    expect(guard).toBe(Math.min(...[guard, gen, report, status].filter((n) => n >= 0)));
    expect(report).toBeGreaterThan(gen);
    expect(report).toBeLessThan(status);
    expect(lines[report]).toMatch(/EXIT/);
    expect(lines[report]).toMatch(/no beads, branches, commits or PRs/);
  });

  test('--generate-only requires --workstream and two or more TRDs', () => {
    expect(pre).toContain('ERROR: --generate-only requires --workstream and two or more TRD paths.');
  });

  test('generated-TRD contract and filename scheme live in the reference skill', () => {
    for (const k of ['Source TRD Manifest', 'normalized Master Task List', 'verbatim source task markdown', 'TRD-YYYY-<8hex>-workstream-<slug>.md']) {
      expect(ref).toContain(k);
    }
  });

  test('expectedOutput lists the workstream TRD artifact', () => {
    expect(doc.expectedOutput.structure.map((o) => o.name)).toContain('Workstream TRD (--workstream --generate-only)');
  });
});

describe('implement-trd-beads reference skill contracts', () => {
  test('branch creation goes through workflow.branch-create; the git-town stacked append is a documented gap', () => {
    expect(ref).toContain('run workflow.branch-create --arg name=<b> --arg baseBranch=<base>');
    expect(ref).toContain('run workflow.branch-create --arg name=<NEXT_BRANCH>');
    expect(ref).toMatch(/no workflow capability covers a stacked append/);
    expect(ref).toMatch(/git-town's native stacked-append for `<NEXT_BRANCH>` \(documented gap\)/);
    expect(ref).not.toMatch(/git town (hack|append|propose)/);
  });

  test('branch intent is resolved before any git mutation, and non-interactive unresolved intent HALTs', () => {
    expect(ref).toMatch(/BEFORE the first mutating git command/);
    expect(ref).toContain('Branch intent required in non-interactive mode');
    expect(ref).toMatch(/--use-current-branch.*HALT on detached HEAD/);
  });

  test('PR backends: gh/git-town, gh/plain-git, ado (MCP or manual, never HALT), manual', () => {
    expect(ref).toContain('run workflow.propose');
    expect(ref).toContain('run workflow.push');
    expect(ref).toContain('run host.change-request-create');
    expect(ref).toContain('repo_create_pull_request');
    expect(ref).toContain('mcp__azure-devops');
    expect(ref).toContain('portal route');
    expect(ref).toMatch(/ado.*do NOT HALT/s);
    expect(ref).toMatch(/manual.*never push or create automatically/s);
  });

  test('--foreman tags only task beads with tracker.label foreman-exec and verifies the count', () => {
    expect(ref).toContain('tracker.label --arg ids=<id> --arg labels=foreman-exec');
    expect(ref).toMatch(/`tracker\.label` only adds/);
    expect(ref).toContain('a `tracker.list` count for label `foreman-exec`');
    expect(ref).toMatch(/never epic\/stories/);
  });
});

describe('implement-trd-beads Quality Gate and Completion ordering', () => {
  test('Completion step order: verification, then PR review completion check, then epic closure', () => {
    const titles = phase('Completion').steps.map((s) => s.title);
    expect(titles.indexOf('Completion verification')).toBe(0);
    expect(titles.indexOf('PR review completion check')).toBeLessThan(titles.indexOf('Epic closure and TRD checkboxes'));
    expect(titles.indexOf('Epic closure and TRD checkboxes')).toBeLessThan(titles.indexOf('Completion report'));
  });

  test('completion-verification stays authoritative -- it runs first and the PR-review check is a separate step before Epic Closure', () => {
    const titles = phase('Completion').steps.map((s) => s.title);
    expect(titles).toEqual([
      'Completion verification',
      'PR review completion check',
      'Epic closure and TRD checkboxes',
      'Completion report',
    ]);
    expect(actions('Completion', 'Completion verification')).toContain('TRACKING_MODE=\'beads\'');
  });

  test('a stacked story is not closed until its PR review gate returns LOCAL_REVIEW_COMPLETE', () => {
    const gate = actions('Quality Gate', 'Per-phase gate');
    expect(gate).toMatch(/do NOT close the story yet/);
    expect(gate).toMatch(/BLOCKED -> print the reasons[^.]*HALT with the story still open, no PR and no branch append/);
    expect(gate).toMatch(/COMPLETE -> close the story \(tracker\.close/);
    expect(gate.indexOf('HALT with the story still open')).toBeLessThan(gate.indexOf('COMPLETE -> close the story'));
  });

  test('the stacked phase review excludes parent commits and runs after the pre-PR test gate, before PR creation', () => {
    const gate = actions('Quality Gate', 'Per-phase gate');
    expect(gate).toContain('run workflow.merge-base --arg refA=HEAD --arg refB=<GATE_ACTION.parentBranch>');
    expect(gate).toContain('BASE_SHA=<PARENT_PHASE_TIP_SHA>');
    expect(gate.indexOf('Pre-PR test gate')).toBeLessThan(gate.indexOf('MODE=\'local\''));
    expect(gate.indexOf('MODE=\'local\'')).toBeLessThan(gate.indexOf('then create the PR and append the next branch'));
  });

  test('single-PR phases close the story, stage only this TRD\'s beads and checkpoint-commit', () => {
    const gate = actions('Quality Gate', 'Per-phase gate');
    expect(gate).toContain('GATE_ACTION.createPr == false');
    expect(gate).toMatch(/beads-stage --match[^`]*`, then commit via node "\$TOOLCHAIN_CLI" run workflow\.commit --arg message="chore\(<bead_prefix> <N>\): checkpoint/);
  });

  test('phase completion comes from trd-cli phase-status', () => {
    expect(actions('Quality Gate', 'Per-phase gate')).toContain('node "$TRD_CLI" phase-status');
  });

  test('every pr-review-cycle call site resolves the skill through PR_REVIEW_SKILL, defined by the canonical repo-root path', () => {
    const pattern = 'packages/development/skills/pr-review-cycle/SKILL.md (via tool-path-resolution)';
    expect(doc.mission.summary).toContain('PR_REVIEW_SKILL = ' + pattern);
    expect(actions('Quality Gate', 'Per-phase gate')).toContain('PR_REVIEW_SKILL');
    const check = actions('Completion', 'PR review completion check');
    expect(check).toContain("(PR_REVIEW_SKILL) with MODE='local'");
    expect(check).toContain("invoke pr-review-cycle with MODE='remote'");
  });
});

describe('implement-trd-beads fail-closed gates are positive-only', () => {
  const check = actions('Completion', 'PR review completion check');
  const closure = actions('Completion', 'Epic closure and TRD checkboxes');

  test('review gates compare raw localPhase only by equality with LOCAL_REVIEW_COMPLETE', () => {
    const literals = rawPhaseComparisons(text);
    expect(literals.length).toBeGreaterThanOrEqual(2);
    expect(new Set(literals)).toEqual(new Set(['LOCAL_REVIEW_COMPLETE']));
  });

  test('the completion gate is skipped only on an exactly-false createPr; a missing or unrecognised entry blocks', () => {
    expect(check).toMatch(/Skip the local gate ONLY when COMPLETION_ACTION exists and `createPr` is exactly false/);
    expect(check).toMatch(/A missing entry or any other `createPr` value is treated as LOCAL_REVIEW_BLOCKED, never skipped/);
  });

  test('an empty or unresolvable base blocks without calling the skill; any non-exact result is BLOCKED', () => {
    expect(check).toMatch(/empty or unresolvable -> BLOCKED without calling the skill/);
    expect(check).toMatch(/any other, missing or unparseable result is BLOCKED/);
    expect(check).toMatch(/HALT before Epic Closure/);
  });

  test('epic closure requires a COMPLETE (or explicitly overridden) verdict and an exact stacked-or-LOCAL_REVIEW_COMPLETE gate', () => {
    expect(closure).toMatch(/verdict COMPLETE, or INCOMPLETE with COMPLETION_OVERRIDDEN/);
    expect(closure).toMatch(/createPr is exactly false, or COMPLETION_LOCAL_REVIEW == 'LOCAL_REVIEW_COMPLETE'/);
  });

  test('an unreadable bead listing counts as open beads remaining', () => {
    expect(closure).toMatch(/a listing that fails or cannot be parsed counts as 'open beads remain'/);
  });

  test('an unrecognised remote status degrades to REVIEW_PENDING and nothing is called merged or landed', () => {
    expect(check).toMatch(/exactly REVIEW_COMPLETE \/ REVIEW_PENDING \/ REVIEW_BLOCKED, else REVIEW_PENDING/);
    expect(check).toMatch(/Never call a PR merged or landed/);
    expect(check).toMatch(/never HALTs, never blocks closure/);
  });

  test('INCOMPLETE completion verification HALTs unless the user explicitly overrides interactively', () => {
    const verify = actions('Completion', 'Completion verification');
    expect(verify).toContain('INCOMPLETE');
    expect(verify).toMatch(/only an explicit override sets COMPLETION_OVERRIDDEN/);
    expect(verify).toMatch(/non-interactive\) HALT before Epic Closure/);
  });
});

describe('implement-trd-beads completion', () => {
  test('stages only this TRD beads (no broad git add) and checkbox sync stages the TRD file', () => {
    expect(text).not.toMatch(/git add \.beads/);
    expect(text).not.toMatch(/git commit -a/);
    const line = text.split('\n').find((l) => l.includes('run workflow.commit') && l.includes('sync checkboxes'));
    expect(line).toMatch(/stage <TRD_FILE_PATH>/);
    expect(line.indexOf('beads-stage')).toBeLessThan(line.indexOf('run workflow.commit'));
  });

  test('requirement table comes from trd-cli req-status over tracker.list data, with VERIFIED ids restored via tracker.comments (PR 7 item 2: pre-refactor behavior restored, not omitted)', () => {
    const report = actions('Completion', 'Completion report');
    expect(report).toContain('req-status');
    expect(report).toContain('--issues-json');
    expect(report).toContain('tracker.comments');
    expect(report).toContain('req-verified:REQ-NNN');
    expect(report).toContain('VERIFIED_REQS');
    expect(report).toContain('--verified <VERIFIED_REQS>');
  });

  test('closes the root epic and syncs after verification', () => {
    expect(actions('Completion', 'Epic closure and TRD checkboxes')).toContain('node "$TOOLCHAIN_CLI" run tracker.close --arg id=<ROOT_EPIC_ID>');
  });
});

describe('implement-trd-beads bead references contract', () => {
  test('scaffold folds the plan entry externalRef into the tracker.create description (tracker.create has no externalRef field)', () => {
    const scaffold = actions('Scaffold', 'Plan and create beads');
    expect(scaffold).toContain('externalRef folds into description');
    expect(scaffold).toContain('## References');
  });

  test('Execute runs the References health check and epic bead-context before beads-build, HALTing on ok:false', () => {
    const delegate = actions('Execute', 'Delegate to beads-build');
    const check = delegate.indexOf('bead-context --bead <ROOT_EPIC_ID> --trd <TRD_FILE_PATH>');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(delegate.indexOf('/ensemble:beads-build <ROOT_EPIC_ID>'));
    expect(delegate).toMatch(/warn with the count of open scoped beads lacking a `## References` block/);
    expect(delegate).toMatch(/`ok:false` or non-zero -> print every `missing` entry and HALT/);
  });

  test('reference skill documents the block, bead-context, legacy fallback and failure handling', () => {
    expect(ref).toContain('## 7. Bead references and context contract');
    for (const key of ['TRD Task', 'PRD Requirement', 'PRD ACs', 'externalRef']) {
      expect(ref).toContain(key);
    }
    expect(ref).toContain("embedded in `tracker.create`'s description");
    expect(ref).toContain('node "$TRD_CLI" bead-context --bead <BEAD_ID> [--trd <path>]');
    expect(ref).toContain('source:"fallback"');
    expect(ref).toContain('blocked:missing-references');
    expect(ref).toContain('context-read:');
  });
});

describe('implement-trd-beads source shape', () => {
  test('the dead executionContract/comment-spec prose is gone and the YAML stays thin', () => {
    expect(text).not.toContain('executionContract');
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(4500);
  });

  test('foreman parameter is a boolean defaulting to false', () => {
    const p = doc.parameters.find((x) => x.name === 'foreman');
    expect(p.type).toBe('boolean');
    expect(p.default).toBe(false);
    expect(allActions).toContain('reference section 6');
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
      expect(written).toMatch(/^ {2}branch_name: feature\/new-branch$/m);
      expect(written).toMatch(/^ {2}use_proposed: true$/m);
      expect(written).toMatch(/^ {2}stacked_prs: true$/m);
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
      expect(written).not.toMatch(/^ {2}branch_name: feature\/previous-branch$/m);
      expect(written).toMatch(/^ {2}branch_name: feature\/replaced$/m);
      expect(written).toMatch(/^ {2}use_proposed: true$/m);
      expect(written).toMatch(/^ {2}stacked_prs: false$/m); // was false, not toggled
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
