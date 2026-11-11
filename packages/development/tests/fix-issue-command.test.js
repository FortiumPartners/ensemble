/**
 * fix-issue: machine contracts only.
 *
 * fix-issue is a skill-backed command: commands/fix-issue.yaml is a manifest (metadata +
 * skill) and the prompt is skills/ensemble-fix-issue/ -- SKILL.md plus one
 * references/phase-N-*.md file per phase. The contract lives in the step descriptions there.
 * Assertions here check that what the descriptions name actually exists in the code and
 * skills they call, and that the gate structure holds -- never exact wording.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { listSkillReferences } = require('../../../scripts/lib/skill-backed-command');

const COMMAND_PATH = path.join(__dirname, '../commands/fix-issue.yaml');
const STORE_SRC = fs.readFileSync(
  path.join(__dirname, '../../agent-core/src/fix-issue/issue-run-index.ts'),
  'utf-8'
);
const TYPES_SRC = fs.readFileSync(path.join(__dirname, '../../agent-core/src/fix-issue/types.ts'), 'utf-8');
const SKILL_SRC = fs.readFileSync(path.join(__dirname, '../skills/pr-review-cycle/SKILL.md'), 'utf-8');

const unique = (list) => [...new Set(list)];

// Self-contained on purpose: scripts/ and agent-core/ are all the mutation harness
// (pr-review-cycle-mutation.test.js) mirrors beside this package, so no other package's helpers.
const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
const PARAMETER = /^- \*\*`([^`]+)`\*\* \(([^,)]+)(?:, (optional|required))?(?:, default: `(.+?)`)?\): (.*)$/;

/** The skill's SKILL.md body (no frontmatter), its file, and its references/*.md files in name order. */
function readSkill(skill) {
  const file = path.join(__dirname, '../skills', skill, 'SKILL.md');
  const body = fs.readFileSync(file, 'utf-8').replace(FRONTMATTER, '');
  const references = listSkillReferences(file).map((reference) => ({ file: reference, text: fs.readFileSync(reference, 'utf-8') }));
  return { file, body, references };
}

/** The `## Arguments` bullets as [{name, type, default, description}]. */
function parseParameters(body) {
  const section = body.slice(body.indexOf('\n## Arguments\n') + '\n## Arguments\n'.length);
  return section
    .slice(0, section.indexOf('\n## '))
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const [, name, type, , rawDefault, description] = PARAMETER.exec(line);
      return { name, type, default: rawDefault === undefined ? undefined : JSON.parse(rawDefault), description };
    });
}

const PHASE_HEADING = /^### Phase (\d+): (.+)$/;
const STEP_HEADING = /^#### Step (\d+)\.(\d+): (.+)$/;

/**
 * The phases of the skill's reference files as `[{order, name, steps: [{order, title, description}]}]`.
 * A step's description is everything under its `#### Step N.M: <title>` heading (bullets
 * included) up to the next heading, so assertions see the step's whole text.
 */
function parsePhases(references) {
  const phases = [];
  let phase = null;
  let step = null;
  for (const reference of references) {
    for (const line of reference.text.split('\n')) {
      const phaseMatch = PHASE_HEADING.exec(line);
      if (phaseMatch) {
        phase = { order: Number(phaseMatch[1]), name: phaseMatch[2], steps: [] };
        phases.push(phase);
        step = null;
        continue;
      }
      const stepMatch = STEP_HEADING.exec(line);
      if (stepMatch && phase) {
        step = { phaseOrder: Number(stepMatch[1]), order: Number(stepMatch[2]), title: stepMatch[3], lines: [] };
        phase.steps.push(step);
        continue;
      }
      if (step) step.lines.push(line);
    }
  }
  phases.forEach((p) => p.steps.forEach((st) => { st.description = st.lines.join('\n').trim(); }));
  return phases;
}

/** Bullets of one `- **\`key\`**:` list under the skill's `## Validation` section. */
function validationList(body, key) {
  const section = body.slice(body.indexOf('\n## Validation\n'));
  const start = section.indexOf(`- **${key}**:\n`);
  if (start === -1) throw new Error(`no ${key} in ## Validation`);
  const items = [];
  for (const line of section.slice(start).split('\n').slice(1)) {
    const match = /^ {2}- (.+)$/.exec(line);
    if (!match) break;
    items.push(match[1]);
  }
  return items;
}

describe('Fix-Issue Command', () => {
  let commandYaml;
  let skill;
  let phases;
  let parameters;
  let steps; // [{ phase, ...step }] in document order
  let descriptionOf; // title (+ optional phase) -> description

  beforeAll(() => {
    commandYaml = yaml.load(fs.readFileSync(COMMAND_PATH, 'utf-8'));
    skill = readSkill(commandYaml.skill);
    phases = parsePhases(skill.references);
    parameters = parseParameters(skill.body);
    steps = phases.flatMap((phase) => phase.steps.map((step) => ({ ...step, phase: phase.name })));
    descriptionOf = (title, phase) =>
      steps.find((s) => s.title === title && (!phase || s.phase === phase)).description;
  });

  const allText = () => steps.map((s) => s.description).join('\n');

  describe('structure', () => {
    test('metadata (manifest) and the 9 parameters (skill)', () => {
      expect(commandYaml.skill).toBe('ensemble-fix-issue');
      expect(commandYaml.metadata.name).toBe('ensemble:fix-issue');
      expect(commandYaml.metadata.output_path).toBe('ensemble/fix-issue.md');
      expect(parameters.map((p) => p.name)).toEqual([
        'description', 'issue', 'branch', 'skip-tests', 'draft-pr', 'interactive', 'foreman', 'status', 'abandon',
      ]);
      const types = Object.fromEntries(parameters.map((p) => [p.name, p.type]));
      expect(types.issue).toBe('number');
      ['skip-tests', 'draft-pr', 'interactive', 'foreman', 'status', 'abandon'].forEach((name) => {
        const param = parameters.find((p) => p.name === name);
        expect({ name, type: param.type, default: param.default }).toEqual({ name, type: 'boolean', default: false });
      });
    });

    test('four phases and every step numbered sequentially', () => {
      expect(phases.map((p) => p.name)).toEqual([
        'Entry Point Resolution', 'Analysis & Planning', 'Execution', 'Validation & Delivery',
      ]);
      phases.forEach((phase, i) => {
        expect(phase.order).toBe(i + 1);
        phase.steps.forEach((step, j) => {
          expect(step.phaseOrder).toBe(i + 1);
          expect(step.order).toBe(j + 1);
        });
      });
    });

    test('Validation & Delivery step order puts the local review before PR creation and the remote review after', () => {
      const vd = phases[3].steps.map((s) => s.title);
      expect(vd).toEqual([
        'Test Validation', 'Local Review and Batch Fix', 'PR Creation', 'Remote Review Disposition', 'Record Stage Checkpoint',
      ]);
    });

    test('the manifest carries no prompt: only metadata and the skill, and the skill index names every phase file', () => {
      expect(Object.keys(commandYaml).sort()).toEqual(['metadata', 'skill']);
      skill.references.forEach((reference) => {
        const relative = path.relative(path.dirname(skill.file), reference.file).split(path.sep).join('/');
        expect({ relative, indexed: skill.body.includes(`\`${relative}\``) }).toEqual({ relative, indexed: true });
      });
      expect(skill.references).toHaveLength(4);
    });

    test('every required agent is a real agent, and delegation targets named in descriptions are required', () => {
      const agentsDir = path.join(__dirname, '../../');
      const known = new Set(
        fs.readdirSync(agentsDir).flatMap((pkg) => {
          const dir = path.join(agentsDir, pkg, 'agents');
          return fs.existsSync(dir)
            ? fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''))
            : [];
        })
      );
      const requiredAgents = validationList(skill.body, 'required_agents');
      requiredAgents.forEach((agent) => expect({ agent, known: known.has(agent) }).toEqual({ agent, known: true }));
      const named = unique(allText().match(/\b[a-z]+(?:-[a-z]+)*-(?:developer|orchestrator|runner)\b/g) || []);
      named.forEach((agent) => expect(requiredAgents).toContain(agent));
    });

    test('SKILL.md stays under the skill word ceiling (the phases live in references/)', () => {
      expect(skill.body.split(/\s+/).length).toBeLessThan(1500);
    });
  });

  describe('store contract', () => {
    test('every IssueRunIndexStore method the workflow calls is exported by the store', () => {
      const called = unique([...allText().matchAll(/IssueRunIndexStore\.(\w+)\(/g)].map((m) => m[1]));
      expect(called.sort()).toEqual(['abandon', 'complete', 'createRun', 'findActive', 'loadRun', 'mutate']);
      called.forEach((method) =>
        expect({ method, exported: new RegExp(`export function ${method}\\(`).test(STORE_SRC) }).toEqual({ method, exported: true })
      );
    });

    test('every stage the workflow records or reads is a real stage, and checkpoints advance in the fixed order', () => {
      const real = TYPES_SRC.match(/ISSUE_STAGE_ORDER[^=]*=\s*\[([^\]]*)\]/)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
      const named = unique(allText().match(/\b(?:analysis_planning|execution|validation_delivery|done)\b/g));
      named.forEach((stage) => expect(real).toContain(stage));

      const checkpoints = steps.filter((s) => s.title === 'Record Stage Checkpoint').map((s) => s.description);
      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0]).toContain('record.stage = "execution"');
      expect(checkpoints[1]).toContain('record.stage = "validation_delivery"');
      expect(checkpoints[2]).toContain('IssueRunIndexStore.complete(');
    });

    test('every checkpoint mutate sets stage and outcome in ONE call (a second mutate on one revision conflicts)', () => {
      const [plan, execution] = steps.filter((s) => s.title === 'Record Stage Checkpoint');
      [plan, execution].forEach((s) => {
        expect(s.description.match(/IssueRunIndexStore\.mutate\(/g)).toHaveLength(1);
        expect(s.description).toContain('record.stageOutcome');
      });
      expect(plan.description).toContain('REVISION_CONFLICT');
    });

    test('createRun failure code the workflow handles is the one the store throws', () => {
      expect(descriptionOf('Start New Run or Resume Active Run')).toContain('RUN_ALREADY_ACTIVE');
      expect(STORE_SRC + fs.readFileSync(path.join(__dirname, '../../agent-core/src/run-index-core.ts'), 'utf-8')).toContain('RUN_ALREADY_ACTIVE');
    });
  });

  describe('review gates', () => {
    test('every review status token the workflow names is a status the pr-review-cycle skill defines', () => {
      const named = unique(allText().match(/\b(?:LOCAL_)?REVIEW_(?:COMPLETE|PENDING|BLOCKED)\b/g));
      expect(named.length).toBe(6);
      named.forEach((token) => expect({ token, defined: SKILL_SRC.includes(token) }).toEqual({ token, defined: true }));
    });

    test('both review steps reference the skill by the repo-root path pattern, and that skill exists', () => {
      const pattern = 'packages/development/skills/pr-review-cycle/SKILL.md (via tool-path-resolution)';
      expect(descriptionOf('Local Review and Batch Fix')).toContain(pattern);
      expect(descriptionOf('Remote Review Disposition')).toContain(pattern);
      expect(fs.existsSync(path.join(__dirname, '../skills/pr-review-cycle/SKILL.md'))).toBe(true);
    });

    test('prApprovedAt is set in exactly one step (local review), keyed on LOCAL_REVIEW_COMPLETE, and read by PR Creation', () => {
      const setters = steps.filter((s) => /prApprovedAt\s*=\s*now\(\)/.test(s.description));
      expect(setters.map((s) => s.title)).toEqual(['Local Review and Batch Fix']);
      const local = setters[0].description;
      expect(local.indexOf('LOCAL_REVIEW_COMPLETE')).toBeLessThan(local.indexOf('prApprovedAt = now()'));
      const pr = descriptionOf('PR Creation');
      expect(pr).toContain('prApprovedAt');
      expect(pr).toContain('loadRun');
    });

    test('PR Creation body carries the graded Testing, Risk and How to revert sections and a body gate (REQ-002)', () => {
      const pr = descriptionOf('PR Creation');
      for (const needle of ['Testing', 'Risk', 'How to revert', 'Directed by:', 'Body gate (REQ-002)', 'pr-review-cycle', 'AGENT_AUTHORED=true']) {
        expect(pr).toContain(needle);
      }
    });

    test('publishing capabilities appear only in PR Creation', () => {
      // Only PR Creation RUNS a publishing capability. Branch Creation merely lists the ids on its
      // single toolchain preflight line, and Remote Review mentions host.change-request-create only
      // as the recovery action for a missing PR URL.
      const publishes = /\brun (?:workflow\.(?:commit|push)|host\.change-request-create)\b/;
      const offenders = steps
        .filter((s) => publishes.test(s.description))
        .map((s) => s.title);
      expect(offenders).toEqual(['PR Creation']);
    });

    test('every approval_wait detail the remote step records carries the REVIEW_ prefix the resume gate matches on', () => {
      const remote = descriptionOf('Remote Review Disposition');
      expect(remote).toMatch(/kind: "approval_wait", detail: `\$\{HALT_STATUS\}:/);
      expect(remote).toMatch(/HALT_STATUS is REVIEW_STATUS when exactly REVIEW_PENDING or REVIEW_BLOCKED, else REVIEW_BLOCKED/);
      const entry = descriptionOf('Start New Run or Resume Active Run');
      expect(entry).toContain('starts with "REVIEW_"');
    });

    test('resume gate branches are tested in order: no run, failure, REVIEW_ approval_wait, anything else', () => {
      const entry = descriptionOf('Start New Run or Resume Active Run');
      const at = (re) => entry.search(re);
      const order = [/No active run/, /"failure"/, /"approval_wait"/, /anything else/].map(at);
      expect(order.every((i) => i > -1)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    test('reviewed tree is carried by tree SHAs: local records reviewedTreeSha, remote passes HEAD_TREE_SHA', () => {
      const local = descriptionOf('Local Review and Batch Fix');
      expect(local).toContain('REVIEWED_TREE_SHA');
      expect(local).toContain('the tree SHA of SNAPSHOT_HEAD');
      const remote = descriptionOf('Remote Review Disposition');
      expect(remote).toContain('HEAD_TREE_SHA');
      expect(remote).toContain('reviewedTreeSha');
    });

    test('Foreman artifact is gated on --foreman and a non-empty FOREMAN_ARTIFACT_PATH in both review steps', () => {
      ['Local Review and Batch Fix', 'Remote Review Disposition'].forEach((title) => {
        const text = descriptionOf(title);
        expect(text).toContain('FOREMAN_ARTIFACT_PATH');
        expect(text).toContain('--foreman');
      });
      expect(parameters.find((p) => p.name === 'foreman').description).toContain('FOREMAN_ARTIFACT_PATH');
    });

    test('only exactly LOCAL_REVIEW_COMPLETE passes the local review gate; every other outcome fails closed', () => {
      const local = descriptionOf('Local Review and Batch Fix');
      const gate = local.match(/Only (LOCAL_PHASE == [^:]*?) proceeds/);
      expect(gate).not.toBeNull();
      expect(gate[1].match(/LOCAL_REVIEW_\w+/g)).toEqual(['LOCAL_REVIEW_COMPLETE']);
      expect(local).toMatch(/EVERY other outcome \(LOCAL_REVIEW_PENDING, LOCAL_REVIEW_BLOCKED, null, unrecognised\) leaves prApprovedAt null/);
    });

    test('the Foreman artifact is written before the pending/blocked halt in Remote Review Disposition', () => {
      const remote = descriptionOf('Remote Review Disposition');
      const artifactAt = remote.search(/write \{ status: REVIEW_STATUS, headSha, ledger \}/);
      const haltAt = remote.indexOf('kind: "approval_wait"');
      expect(artifactAt).toBeGreaterThan(-1);
      expect(haltAt).toBeGreaterThan(-1);
      expect(artifactAt).toBeLessThan(haltAt);
    });
  });
});
