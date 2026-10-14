'use strict';

/**
 * REGRESSION (br-trd-beads-title-length-guard-40x): bead titles are composed as
 * `<prefix> <TRD text>` and nothing bounded the result, so a long task row produced
 * a title over br's 500-character limit. One such record makes br refuse to load
 * the whole tracker ("CONFIG_ERROR: ... title: exceeds 500 characters").
 * br counts Unicode code points, not UTF-16 units or bytes.
 */

const { buildScaffoldPlan, clampTitle } = require('../lib/scaffold-planner');
const { buildWorkstreamPlan } = require('../lib/workstream-planner');

const BR_LIMIT = 500;
const OPTS = { trdSlug: 'demo-trd', trdFilePath: 'docs/TRD/demo.md', prdFilePath: 'docs/PRD/demo.md' };
const LONG = 'Implement the persistence layer with paging, filtering and structured logging for every transition '.repeat(10);
const codePoints = (s) => Array.from(s).length;
const hasLoneSurrogate = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

function makeTask(over) {
  return {
    id: 'TRD-011',
    phaseN: 1,
    description: 'Do the thing',
    isTest: false,
    hourEstimate: null,
    satisfies: ['REQ-001'],
    verifies: null,
    validatesAcs: [],
    dependsOn: [],
    targetFiles: [],
    actions: [],
    implementationAc: [],
    testAc: [],
    nestedSubitems: [],
    testSubitems: [],
    proofOfRequirement: null,
    ...over,
  };
}

function parsedWith({ title = 'Demo', phaseTitle = 'Foundation', task }) {
  return {
    title,
    summary: 'A demo summary.',
    prdReference: 'docs/PRD/demo.md',
    designReadinessScore: null,
    prFormat: true,
    phases: [{ n: 1, title: phaseTitle, shippableState: 'Users can do the thing.', taskIds: [task.id] }],
    tasksById: { [task.id]: task },
    warnings: [],
  };
}

function allTitles(plan) {
  return [plan.epic, ...plan.stories, ...plan.tasks, ...plan.synthesizedTests].map((b) => b.title);
}

describe('clampTitle', () => {
  const prefix = '[trd:demo-trd:task:TRD-011]';

  test('leaves a title that fits untouched', () => {
    expect(clampTitle(prefix, 'Short task')).toBe(`${prefix} Short task`);
  });

  test('keeps the prefix, ends in an ellipsis and stays under br\'s limit', () => {
    const t = clampTitle(prefix, LONG);
    expect(t.startsWith(`${prefix} Implement`)).toBe(true);
    expect(t.endsWith('…')).toBe(true);
    expect(codePoints(t)).toBeLessThan(BR_LIMIT);
  });

  test('cuts on a word boundary', () => {
    const t = clampTitle(prefix, LONG);
    expect(LONG.startsWith(t.slice(prefix.length + 1, -1))).toBe(true);
    expect(LONG[t.length - prefix.length - 2]).toBe(' ');
  });

  test('never splits a surrogate pair', () => {
    const t = clampTitle(prefix, '😀'.repeat(600));
    expect(hasLoneSurrogate(t)).toBe(false);
    expect(codePoints(t)).toBeLessThan(BR_LIMIT);
  });
});

describe('scaffold plan titles stay under br\'s limit', () => {
  const task = makeTask({ description: LONG, testSubitems: [LONG] });
  const plan = buildScaffoldPlan(parsedWith({ task }), OPTS);

  test('task and synthesized-test beads', () => {
    expect(plan.tasks).toHaveLength(1);
    expect(plan.synthesizedTests).toHaveLength(1);
    for (const b of [...plan.tasks, ...plan.synthesizedTests]) {
      expect(b.title.startsWith(b.titlePrefix)).toBe(true);
      expect(codePoints(b.title)).toBeLessThan(BR_LIMIT);
    }
  });

  test('epic and story beads when the TRD or phase title is long', () => {
    const long = buildScaffoldPlan(parsedWith({ title: LONG, phaseTitle: LONG, task: makeTask({}) }), OPTS);
    expect(allTitles(long).every((t) => codePoints(t) < BR_LIMIT)).toBe(true);
  });

  test('a clamped task keeps its full text in the description', () => {
    expect(plan.tasks[0].description).toContain(LONG);
  });

  test('a task whose title fits is unchanged', () => {
    const short = buildScaffoldPlan(parsedWith({ task: makeTask({ description: 'Do the thing' }) }), OPTS);
    expect(short.tasks[0].title).toBe(`${short.tasks[0].titlePrefix} Do the thing`);
    expect(short.tasks[0].description).not.toContain('Full title');
  });
});

describe('workstream plan titles', () => {
  test('TRD epic title is clamped when the TRD title is long', () => {
    const result = buildWorkstreamPlan(
      [{
        trdPath: 'docs/TRD/TRD-2026-001-alpha.md',
        parsed: { ...parsedWith({ title: LONG, task: makeTask({}) }), designReadinessScore: 4.5 },
      }],
      { stackedPrs: true, workstreamSlug: 'alpha' }
    );
    expect(result.ok).toBe(true);
    expect(codePoints(result.trdEpics[0].title)).toBeLessThan(BR_LIMIT);
  });
});
