/**
 * One beads execution engine: implement-trd-beads (TRD orchestrator) -> beads-build
 * (wave loop) -> beads-build-wave command (one wave, loaded by the thin beads-build-wave agent). implement-bead is a thin
 * single-bead entry that follows the same commit policy, but opens its branch/change-request
 * through the workflow.branch-create/host.change-request-create toolchain capabilities instead
 * of the other engines' resolve-sdlc branching/PR_BACKEND policy.
 *
 * These checks read the source YAML (for the skill-backed commands: the skill prose, since their YAML is
 * only a manifest) and assert policy that has to hold across all of
 * them, so a contradiction between the entry points fails here.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { readDevelopmentSkill, parseWorkflow } = require('./helpers/skill-workflow');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// implement-trd-beads, beads-build and implement-bead are skill-backed: their YAML is a manifest
// (metadata + skill) and the prompt is the skill (SKILL.md + references/). `prose` returns the
// prompt for those and the source text for the rest.
const SKILL_BACKED = {
  'commands/implement-trd-beads.yaml': 'ensemble-implement-trd-beads',
  'commands/beads-build.yaml': 'ensemble-beads-build',
  'commands/implement-bead.yaml': 'ensemble-implement-bead',
};
const prose = (rel) => (SKILL_BACKED[rel] ? readDevelopmentSkill(SKILL_BACKED[rel]).prompt : read(rel));
const manifest = (rel) => yaml.load(read(rel));

const ENGINE_FILES = [
  'commands/implement-trd-beads.yaml',
  'commands/beads-build.yaml',
  'commands/implement-bead.yaml',
  'commands/beads-build-wave.yaml',
  'agents/beads-build-wave.yaml',
];

describe('beads engine sources', () => {
  test.each(ENGINE_FILES)('%s parses as YAML', (rel) => {
    expect(() => yaml.load(read(rel))).not.toThrow();
  });

  test.each(ENGINE_FILES)('%s only mentions broad staging when forbidding it', (rel) => {
    const text = prose(rel);
    const staging = /git add -A|git add \.(?![\w/])|git add \.beads\/?|git commit -a(?!\w)|commit -a(?!\w)/g;
    for (const m of text.matchAll(staging)) {
      const before = text.slice(Math.max(0, m.index - 200), m.index);
      expect(before).toMatch(/never|do not|not stage|forbid/i);
    }
  });

  test.each(ENGINE_FILES)('%s does not treat bv as required', (rel) => {
    const text = prose(rel);
    expect(text).not.toMatch(/bv \(beads_viewer\) is required/);
    expect(text).not.toMatch(/bv is required/i);
    expect(text).not.toMatch(/no graceful-degradation/);
    expect(text).not.toMatch(/no br ready fallback/);
    expect(text).not.toMatch(/never a fallback dispatcher/);
  });

  test('the wave command and beads-build both define the work-graph.plan/work-graph.ready scheduling fallback', () => {
    expect(read('commands/beads-build-wave.yaml')).toMatch(/work-graph\.ready capability when plan is unavailable/);
    const build = manifest('commands/beads-build.yaml');
    expect(build.metadata.capabilities.required).toContain('work-graph.ready');
    expect(build.metadata.capabilities.optional).toContain('work-graph.plan');
    expect(prose('commands/implement-trd-beads.yaml')).toMatch(/work-graph\.ready \(graph-aware parallel tracks[^)]*\) or plan order when that is unavailable/);
  });
});

describe('beads-build --plan mode (replaces beads-plan)', () => {
  const build = manifest('commands/beads-build.yaml');
  const plan = parseWorkflow(readDevelopmentSkill('ensemble-beads-build')).find((p) => p.name === 'Plan Mode');

  test('is advertised and parsed', () => {
    expect(build.metadata.argument_hint).toMatch(/\[--plan\]/);
    expect(prose('commands/beads-build.yaml')).toMatch(/Parse --plan from \$ARGUMENTS/);
  });

  test('exists as its own phase and is read-only', () => {
    expect(plan).toBeDefined();
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/br (close|update|create|comment add)|git (commit|add|push)|beads-label|beads-stage/);
    expect(text).toMatch(/run tracker\.sync/);
  });
});

describe('implement-bead shares the engine policy', () => {
  const text = prose('commands/implement-bead.yaml');

  test('opens its change request and creates its branch through the host/workflow toolchain capabilities, not resolve-sdlc PR_BACKEND', () => {
    expect(text).not.toMatch(/resolve-sdlc --git-town-exit-code/);
    expect(text).not.toMatch(/PR_BACKEND==/);
    expect(text).toMatch(/run host\.change-request-create/);
    expect(text).toMatch(/run workflow\.branch-create/);
  });

  test('creates branches through workflow.branch-create, never a hard-coded git-town/plain-git branch', () => {
    expect(text).not.toMatch(/git town hack/i);
    expect(text).not.toMatch(/BRANCHING_STRATEGY==/);
    expect(text).toMatch(/run workflow\.branch-create/);
  });

  test('its dirty-tree gate ignores br state under .beads/', () => {
    expect(text).toMatch(/run workflow\.status/);
    expect(text).toMatch(/Ignore every path under \.beads\//);
  });
});

describe('bead context contract is mandatory before any dispatch', () => {
  const actionsOf = (rel) => {
    const phases = SKILL_BACKED[rel] ? parseWorkflow(readDevelopmentSkill(SKILL_BACKED[rel])) : yaml.load(read(rel)).workflow.phases;
    return phases.flatMap((ph) => ph.steps.flatMap((s) => s.actions || []));
  };
  const CMD = 'node "$TRD_CLI" bead-context --bead <BEAD_ID>';

  test('beads-build-wave track payload carries context_contract; lifecycle orders claim -> context read -> dispatch -> commit gate', () => {
    const acts = actionsOf('commands/beads-build-wave.yaml');
    const lifecycle = acts.find((a) => /^\s*lifecycle_contract:/.test(a));
    const context = acts.find((a) => /^\s*context_contract:/.test(a));
    expect(lifecycle).toBeDefined();
    expect(context).toBeDefined();
    const order = ['(1) claim via', '(2) CONTEXT READ per context_contract', '(3) dispatch the implementing subagent', '(4) COMMIT GATE'].map((s) => lifecycle.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(context).toContain(CMD + ' --trd <TRD_PATH>');
    expect(context).toContain('blocked:missing-references');
    expect(context).toContain('tracker.set-status --run-id <RUN_ID> --arg id=<BEAD_ID> --arg status=open');
    expect(context).toContain('context-read: trd=<references.trd> task=<references.trdTask> prd=<references.prd> reqs=<ids>');
    expect(context).toMatch(/ENTIRE bead_context JSON/);
    expect(context).toMatch(/read the referenced files yourself before editing/);
    expect(context).toMatch(/PRD ACs in bead_context/);
  });

  test('implement-bead reads context after claim and before dispatching the orchestrator, and passes bead_context', () => {
    const acts = actionsOf('commands/implement-bead.yaml');
    const claim = acts.findIndex((a) => a.includes('tracker.set-status') && a.includes('status=in_progress'));
    const ctx = acts.findIndex((a) => a.includes(CMD));
    const dispatch = acts.findIndex((a) => a.startsWith('Dispatch Task('));
    const gate = acts.findIndex((a, i) => i > dispatch && a.includes('run workflow.status'));
    expect(claim).toBeGreaterThan(-1);
    expect(ctx).toBeGreaterThan(claim);
    expect(dispatch).toBeGreaterThan(ctx);
    expect(gate).toBeGreaterThan(dispatch);
    expect(acts[ctx]).toContain('blocked:missing-references');
    expect(acts[ctx]).toContain('HALT');
    expect(acts[dispatch]).toContain('bead_context');
    expect(acts[dispatch]).toMatch(/read the referenced files yourself before editing/);
  });

  test('tech-lead-orchestrator Bead-Track Mode requires the context read and refuses unresolved beads', () => {
    const summary = yaml.load(read('agents/tech-lead-orchestrator.yaml')).mission.summary;
    expect(summary).toContain('`context_contract`');
    expect(summary).toContain('node "$TRD_CLI" bead-context --bead <BEAD_ID> --trd <TRD_PATH>');
    expect(summary).toMatch(/NEVER implement that bead/);
    expect(summary).toMatch(/Never implement a bead whose context read failed/);
    expect(summary).toMatch(/code-reviewer MUST check the diff against the PRD ACs/);
  });

  test('beads-build documents that the wave payload carries context_contract', () => {
    expect(actionsOf('commands/beads-build.yaml').join('\n')).toMatch(/context_contract/);
  });
});

describe('removed duplicates stay removed', () => {
  const GONE = [
    'commands/beads-plan.yaml',
    'skills/complete-beads/SKILL.md',
    'lib/complete-beads-cli.js',
    'lib/complete-beads-planner.js',
  ];
  test.each(GONE)('%s does not exist', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(false);
  });

  test('the single wave definition is the hidden wave command', () => {
    expect(fs.existsSync(path.join(ROOT, 'commands/beads-build-wave.yaml'))).toBe(true);
    expect(read('commands/beads-build-wave.yaml')).toMatch(/visibility: hidden/);
  });

  test('no command or agent source still names a removed component', () => {
    const dirs = ['commands', 'agents', 'skills'].map((d) => path.join(ROOT, d));
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'ensemble') walk(p);
        } else if (/\.yaml$/.test(e.name) || e.name === 'SKILL.md') {
          if (/complete-beads|ensemble:beads-plan/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
        }
      }
    };
    dirs.forEach(walk);
    expect(hits).toEqual([]);
  });
});
