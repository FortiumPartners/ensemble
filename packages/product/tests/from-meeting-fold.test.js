'use strict';

// create-prd-meeting and refine-prd-meeting were folded into a `--from-meeting`
// flag on create-prd and refine-prd, and the two variant commands were removed
// (docs/plans/ensemble-surface-consolidation-plan.md, C-C). A fold only holds if
// the variants' distinct behavior now lives in the base commands, so these tests
// pin that behavior where each base command keeps its prompt: refine-prd in its
// source YAML and in the markdown the Claude Code generator renders from it,
// create-prd -- a skill-backed command -- in its skill: the SKILL.md and the phase files
// under its references/. They read those sources, never the generated files, so they hold
// before and after regeneration.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { transformCommandToMarkdown } = require('../../../scripts/lib/command-transformer');
const { readCommandProse } = require('../../../scripts/lib/skill-backed-command');
const { readSkill, section, parseWorkflow } = require('./helpers/skill-prompt');

const PACKAGES_DIR = path.join(__dirname, '..', '..');
const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

function commandPath(slug) {
  return path.join(COMMANDS_DIR, `${slug}.yaml`);
}

function load(slug) {
  return yaml.load(fs.readFileSync(commandPath(slug), 'utf8'));
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, out));
  }
  return out;
}

function collapse(text) {
  return text.replace(/\s+/g, ' ');
}

// Every string in the command (constraints, parameters, mission, steps), joined,
// so a phrase is found wherever the YAML happens to wrap or quote it.
function allText(doc) {
  return collapse(collectStrings(doc).join('\n'));
}

function phase(doc, name) {
  const found = doc.workflow.phases.find((p) => p.name === name);
  expect(found).toBeDefined();
  return found;
}

function step(doc, phaseName, title) {
  const found = phase(doc, phaseName).steps.find((s) => s.title === title);
  expect(found).toBeDefined();
  return found;
}

function stepText(s) {
  return collapse(collectStrings(s).join('\n'));
}

function render(slug, commandPathsByRef = new Map()) {
  return collapse(transformCommandToMarkdown(load(slug), commandPath(slug), commandPathsByRef));
}

describe('the meeting-sourced variants are gone', () => {
  test.each(['create-prd-meeting', 'refine-prd-meeting'])('%s has no command source', (slug) => {
    expect(fs.existsSync(commandPath(slug))).toBe(false);
  });

  test('no command in any package, YAML or skill, still names a removed variant', () => {
    const offenders = [];
    for (const pkg of fs.readdirSync(PACKAGES_DIR)) {
      const dir = path.join(PACKAGES_DIR, pkg, 'commands');
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
        const yamlPath = path.join(dir, file);
        const raw = fs.readFileSync(yamlPath, 'utf8');
        // A skill-backed command's prompt is its skill, so that is the text that can name a variant.
        const prose = readCommandProse(yamlPath, yaml.load(raw), raw);
        if (/(create|refine)-prd-meeting/.test(prose)) offenders.push(`${pkg}/commands/${file}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('prd dispatcher', () => {
  const doc = load('prd');

  test('routes only create and refine; meeting work is a flag on them', () => {
    expect(doc.dispatch.subcommands.map((s) => [s.keyword, s.ref])).toEqual([
      ['create', 'create-prd'],
      ['refine', 'refine-prd'],
    ]);
    expect(doc.metadata.argument_hint).toBe('<create|refine> [subcommand args...]');
  });

  test.each(['create', 'refine'])('the %s keyword points at --from-meeting', (keyword) => {
    const sub = doc.dispatch.subcommands.find((s) => s.keyword === keyword);
    expect(sub.description).toContain('--from-meeting');
  });

  test('the rendered keyword table lists only create and refine', () => {
    const md = render(
      'prd',
      new Map([
        ['create-prd', path.join(COMMANDS_DIR, 'ensemble', 'create-prd.md')],
        ['refine-prd', path.join(COMMANDS_DIR, 'ensemble', 'refine-prd.md')],
      ]),
    );
    expect(md).toContain('**`create`**');
    expect(md).toContain('**`refine`**');
    expect(md).not.toMatch(/(create|refine)-meeting|prd-meeting/);
  });
});

describe('create-prd --from-meeting', () => {
  // create-prd is skill-backed: its YAML holds only metadata, and its constraints and arguments
  // are its SKILL.md while each phase of its workflow is a file under references/. The
  // assertions below read the whole prompt (skill.prompt: the SKILL.md body, then every
  // reference); parseWorkflow reads the phase files back into the phases/steps/actions the
  // YAML used to hold, so they are the ones that were written against the YAML.
  const manifest = load('create-prd');
  const skill = readSkill(manifest.skill);
  const doc = { workflow: { phases: parseWorkflow(skill) } };
  const text = collapse(skill.prompt);

  test('is a boolean flag, advertised in the argument hint and descriptions', () => {
    expect(section(skill.body, 'Arguments')).toContain('- **`from-meeting`** (boolean, optional, default: `false`)');
    expect(manifest.metadata.argument_hint).toContain('--from-meeting');
    expect(manifest.metadata.description).toContain('--from-meeting');
    expect(manifest.metadata.description.length).toBeLessThanOrEqual(200);
    expect(skill.frontmatter.description).toContain('--from-meeting');
  });

  test('has a delimited intake phase right after the interview phase, with sequential phase numbers', () => {
    expect(doc.workflow.phases.map((p) => p.name).slice(0, 3)).toEqual([
      'Structured Elicitation',
      'Meeting Summary Intake (--from-meeting only)',
      'Research and Context',
    ]);
    expect(doc.workflow.phases.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const intake = phase(doc, 'Meeting Summary Intake (--from-meeting only)');
    expect(intake.steps.map((s) => s.title)).toEqual([
      'Parse Meeting Summary',
      'Scale Detection (inferred, not asked)',
      'Extraction',
    ]);
    for (const s of intake.steps) {
      expect(s.description).toContain('Runs only when --from-meeting is present in $ARGUMENTS');
    }
  });

  test.each(['Scale Detection', 'Problem Space Interview', 'Creative Elicitation'])(
    'the %s interview step is skipped under --from-meeting',
    (title) => {
      const actions = step(doc, 'Structured Elicitation', title).actions;
      expect(actions.some((a) => a.startsWith('IF --from-meeting flag is set: skip'))).toBe(true);
    },
  );

  test('Issue Resolution (the live walk-through) is skipped under --from-meeting', () => {
    const actions = step(doc, 'Adversarial Review and Readiness Gate', 'Issue Resolution').actions;
    expect(actions[0]).toMatch(/^IF --from-meeting flag is set: skip this step entirely/);
    expect(actions[0]).toContain('do NOT invoke AskUserQuestion');
  });

  test('--from-meeting and --foreman are rejected together before anything else runs', () => {
    const first = step(doc, 'Structured Elicitation', 'Scale Detection').actions[0];
    expect(first).toMatch(/^HALT CHECK \(run first/);
    expect(first).toContain('--from-meeting');
    expect(first).toContain('--foreman');
    expect(first).toContain('HALT immediately');
    expect(section(skill.body, 'Constraints')).toContain('--from-meeting cannot be combined with --foreman');
  });

  test('the readiness exception is read before the hard FAIL gate it overrides', () => {
    const actions = step(doc, 'Adversarial Review and Readiness Gate', 'Implementation Readiness Gate').actions;
    const exception = actions.findIndex((a) => a.startsWith('IF --from-meeting flag is set: the CONCERNS and FAIL branches below do NOT apply'));
    const fail = actions.findIndex((a) => a.startsWith('FAIL (<3.0)'));
    const concerns = actions.findIndex((a) => a.startsWith('CONCERNS (3.0-3.9)'));
    expect(exception).toBeGreaterThan(-1);
    expect(exception).toBeLessThan(concerns);
    expect(exception).toBeLessThan(fail);
  });

  test('the Constitution Gate is inherited unchanged, with no meeting-mode bypass', () => {
    const gate = stepText(phase(doc, 'Constitution Gate'));
    expect(gate).toContain('Constitution violations are non-bypassable in every mode, including --foreman');
    expect(gate).not.toMatch(/from-meeting/);
  });

  // Each phrase is a behavior of the removed create-prd-meeting command.
  test.each([
    // input contract
    'not raw audio/video',
    'do not assume Teams-specific formatting anywhere in this workflow',
    'Expect a normalized shape with some subset of: meeting title/date/attendees, Decisions, Open Questions, Discussion Points (optionally grouped by topic), Action Items (optionally tagged with an owner)',
    'do not fail if one section is missing, just note what\'s absent',
    'suggest /ensemble:create-prd (without --from-meeting) for that instead',
    // inferred scale
    '3 or fewer total items => LIGHT, 4-10 => STANDARD, more than 10 or explicit enterprise/multi-team language in the summary => DEEP',
    'Default to STANDARD if the signal is ambiguous rather than guessing at the extremes',
    'State the inferred depth AND the reasoning behind it in the PRD\'s Notes section',
    // extraction without guessing
    'Where the summary does NOT answer a question, do not guess',
    'Do NOT attempt the SCAMPER/failure-scenario elicitation interactively',
    'DO NOT invent requirements, decisions, or constraints that are not actually present in the provided meeting summary',
    'draw requirements only from the Meeting Summary Intake phase\'s extraction',
    'a Decision implies Must, an Open Question implies the priority itself may need clarification',
    'if the meeting argued about effort or cost, record that as a constraint or an action item, never as the requirement\'s priority',
    '[NEEDS CLARIFICATION: no approver identified in the meeting -- confirm who signs off on this scope]',
    '[NEEDS CLARIFICATION: no NFR discussion found for <category> -- confirm requirements]',
    'mark the missing edge case with [NEEDS CLARIFICATION] rather than inventing one',
    'expect a HIGHER marker count',
    'Ambiguity scan complete: N items marked for clarification (meeting-sourced draft -- expect more than a live create-prd run).',
    'flag that as a candidate for /ensemble:refine-prd <prd-path> --from-meeting <meeting-summary-or-path> instead',
    // non-interactive review and gate
    'do NOT present these issues to the user for live resolution',
    'convert everything else into an additional [NEEDS CLARIFICATION] marker instead of asking',
    'expect a LOWER score than a live run would typically produce',
    'the CONCERNS and FAIL branches below do NOT apply',
    'Do NOT invoke AskUserQuestion for this branch',
    'save the PRD with Status set to Draft',
    'a human refine-prd pass is expected next given the score',
    // output
    'add a Source line noting this PRD was drafted from a meeting summary',
    'state the [NEEDS CLARIFICATION] marker count in the Notes section',
    'not /ensemble:create-trd directly, given the marker count',
    'Clarification Agenda (--from-meeting only)',
  ])('carries the removed command behavior: %s', (phrase) => {
    expect(text).toContain(phrase);
  });
});

describe('refine-prd --from-meeting', () => {
  // refine-prd is skill-backed too: constraints and arguments are its SKILL.md, each workflow
  // phase a file under references/. parseWorkflow reads the phase files back into the
  // phases/steps/actions the YAML used to hold.
  const manifest = load('refine-prd');
  const skill = readSkill(manifest.skill);
  const doc = { workflow: { phases: parseWorkflow(skill) } };
  const text = collapse(skill.prompt);

  test('is a boolean parameter, advertised in the argument hint and description', () => {
    expect(section(skill.body, 'Arguments')).toContain('- **`from-meeting`** (boolean, optional, default: `false`)');
    expect(manifest.metadata.argument_hint).toContain('--from-meeting');
    expect(manifest.metadata.description).toContain('--from-meeting');
    expect(manifest.metadata.description.length).toBeLessThanOrEqual(200);
    expect(skill.frontmatter.description).toContain('--from-meeting');
  });

  test('has a delimited meeting phase after PRD Review, with sequential phase numbers', () => {
    expect(doc.workflow.phases.map((p) => p.name)).toEqual([
      'Collaborative Review',
      'PRD Review',
      'Meeting-Sourced Review (--from-meeting only)',
      'Enhancement',
      'Readiness Gate Re-Score',
      'Output Management',
    ]);
    expect(doc.workflow.phases.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6]);
    const meeting = phase(doc, 'Meeting-Sourced Review (--from-meeting only)');
    expect(meeting.steps.map((s) => s.title)).toEqual([
      'Parse Meeting Summary',
      'Synthesis (classify findings against the meeting summary)',
      'Feedback Integration (from meeting content only)',
    ]);
    for (const s of meeting.steps) {
      expect(s.description).toContain('Runs only when `--from-meeting` is present in $ARGUMENTS');
    }
  });

  test('the live Synthesis prompt, Interview and Feedback Integration give way to the meeting phase', () => {
    const review = phase(doc, 'PRD Review');
    const byOrder = (n) => stepText(review.steps.find((s) => s.order === n));
    // Synthesis still scans (the meeting phase classifies that list) but never prompts.
    expect(byOrder(2)).toContain('IF `--from-meeting` is present in $ARGUMENTS: still generate the numbered findings list');
    expect(byOrder(2)).toContain('skip the AskUserQuestion selection prompt below entirely');
    expect(byOrder(3)).toContain('If `--from-meeting` is present in $ARGUMENTS, SKIP this step entirely');
    expect(byOrder(4)).toContain('If `--from-meeting` is present in $ARGUMENTS, SKIP this step entirely');
  });

  test('--from-meeting is rejected with --collab, --long-lived or --foreman before any bootstrap work', () => {
    const bootstrap = stepText(step(doc, 'Collaborative Review', 'Session Bootstrap'));
    const second = bootstrap.slice(bootstrap.indexOf('SECOND HALT CHECK'));
    expect(bootstrap).toContain('SECOND HALT CHECK');
    expect(second.indexOf('GUARD:')).toBeGreaterThan(second.indexOf('HALT immediately'));
    for (const flag of ['`--from-meeting`', '`--collab`', '`--long-lived`', '`--foreman`']) {
      expect(second.slice(0, second.indexOf('GUARD:'))).toContain(flag);
    }
    expect(section(skill.body, 'Constraints')).toContain('--from-meeting cannot be combined with --collab, --long-lived or --foreman');
  });

  test('a meeting-sourced pass never locks the PRD or changes its Status', () => {
    const lock = step(doc, 'Output Management', 'PRD Lock');
    expect(lock.actions[0]).toMatch(/^IF --from-meeting is present in \$ARGUMENTS: SKIP this entire step\./);
    expect(lock.actions[0]).toContain('set no `status: Locked`');
    expect(lock.actions[0]).toContain('print no create-trd next step');
    expect(text).toContain('this mode never changes the PRD\'s Status field away from whatever it already was');
  });

  // Each phrase is a behavior of the removed refine-prd-meeting command.
  test.each([
    'DO NOT invent answers to findings the meeting summary does not actually address',
    'leave those findings and their [NEEDS CLARIFICATION] markers untouched for a later live /ensemble:refine-prd pass',
    'requires TWO distinct inputs in $ARGUMENTS: a PRD file path AND a meeting summary',
    'the PRD path is the first non-flag token',
    'Expect the same normalized shape as create-prd --from-meeting',
    'suggest /ensemble:refine-prd (without --from-meeting) for a live-interview refinement instead',
    'RESOLVABLE_FROM_MEETING: the summary directly states an answer',
    'STILL_OPEN: the summary does not address this finding',
    'Do NOT use AskUserQuestion here -- there is no live interview in this mode',
    'Print both buckets as a report to the user (not a prompt)',
    'Apply changes ONLY for RESOLVABLE_FROM_MEETING findings',
    'Cite which part of the summary (a Decision, an Action Item, a specific Discussion Point) grounded each change',
    'Leave STILL_OPEN findings and their [NEEDS CLARIFICATION] markers completely untouched',
    'Set SELECTED_ITEMS to exactly the RESOLVABLE_FROM_MEETING findings',
    'refine strictly what the meeting summary actually resolved',
    'confirm every STILL_OPEN finding from Synthesis remains genuinely untouched in the saved output',
    'note plainly if a meaningful STILL_OPEN count remains',
    'regardless of whether the re-score lands on PASS, CONCERNS, or FAIL',
    'that still requires a live human check',
    'names the meeting if the input included a title/date',
    'the summary also states the RESOLVABLE_FROM_MEETING count applied and the STILL_OPEN count remaining',
    'Remaining Findings Report (--from-meeting only)',
  ])('carries the removed command behavior: %s', (phrase) => {
    expect(text).toContain(phrase);
  });

  test('the skill prompt carries the mode gates, not only the constraints', () => {
    const md = text;
    for (const phrase of [
      'Meeting-Sourced Review (--from-meeting only)',
      'SECOND HALT CHECK',
      'Runs only when `--from-meeting` is present in $ARGUMENTS',
      'SKIP this entire step. A meeting-sourced pass never locks the PRD',
      'Status transition rule',
      '**`from-meeting`** (boolean, optional, default: `false`)',
    ]) {
      expect(md).toContain(phrase);
    }
  });
});

// An unquoted ': ' inside a YAML list item turns it into a one-key mapping instead of a
// string. The Claude generator ignores `constraints`, so nothing there notices, but the Pi
// generator calls .trim() on each one and fails. Pin that every slot a generator renders
// is still a string after the --from-meeting additions.
describe('every rendered slot of the folded commands is a string', () => {
  function nonStringSlots(doc) {
    const bad = [];
    const expectString = (label, value) => {
      if (typeof value !== 'string') bad.push(`${label} -> ${JSON.stringify(value)}`);
    };
    (doc.constraints || []).forEach((c, i) => expectString(`constraints[${i}]`, c));
    (doc.parameters || []).forEach((p) => expectString(`parameters.${p.name}.description`, p.description));
    doc.workflow.phases.forEach((p) => {
      expectString(`phase ${p.order} name`, p.name);
      (p.steps || []).forEach((s) => {
        const where = `phase ${p.order} step ${s.order}`;
        expectString(`${where} title`, s.title);
        if (s.description !== undefined) expectString(`${where} description`, s.description);
        (s.actions || []).forEach((a, i) => expectString(`${where} actions[${i}]`, a));
      });
    });
    ((doc.expectedOutput || {}).structure || []).forEach((o) => {
      expectString(`expectedOutput ${o.name}`, o.name);
      expectString(`expectedOutput ${o.name} description`, o.description);
    });
    ((doc.dispatch || {}).subcommands || []).forEach((s) => expectString(`dispatch ${s.keyword} description`, s.description));
    return bad;
  }

  // create-prd and refine-prd are skill-backed: their YAML holds no slot to render, and their prompt is Markdown.
  test.each(['prd'])('%s', (slug) => {
    expect(nonStringSlots(load(slug))).toEqual([]);
  });
});
