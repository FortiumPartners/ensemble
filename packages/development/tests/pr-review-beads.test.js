'use strict';

/**
 * Tests for the findings-as-beads planner (packages/development/lib/pr-review-beads.js, kata n350,
 * docs/plans/pr-review-speedup-plan.md section 3H item 1 and acceptance test (b)).
 *
 * Pure module: every test hands it a ledger and the tracker's answer for each key
 * (`findByKey`'s result shape) and reads the plan back.
 */

const {
  reviewFindingKey,
  reviewGroupKey,
  beadKeys,
  planBeads,
  BEAD_LABEL,
  FOLLOW_ON_LABEL,
} = require('../lib/pr-review-beads');
const { COLLAPSE_THRESHOLD } = require('../lib/pr-review-disposition');

const HEAD = 'a'.repeat(40);
const NEXT_HEAD = 'b'.repeat(40);
const FIX_COMMIT = 'c'.repeat(40);

function finding(overrides = {}) {
  return {
    id: 'F-1',
    source: 'code-reviewer',
    locationOrLink: 'src/widget.js:12',
    severity: 'important',
    failureMode: 'Unchecked path join',
    disposition: 'fix',
    evidence: 'line 12 joins user input',
    originalTextOrLink: 'https://example.invalid/pr/1#r1',
    ...overrides,
  };
}

const nits = (count, file = 'src/same.js', overrides = {}) =>
  Array.from({ length: count }, (_, i) =>
    finding({ id: `N-${i + 1}`, severity: 'nit', locationOrLink: `${file}:${i + 1}`, failureMode: `nit number ${i + 1}`, ...overrides }));

function input(ledger, extra = {}) {
  return { repo: 'Acme/Widgets', prNumber: 7, headSha: HEAD, ledger, ...extra };
}

/** What `findByKey` says for every key when the tracker holds nothing. */
function empty(inp) {
  const keys = beadKeys(inp).keys;
  return Object.fromEntries(keys.map((key) => [key, { ok: true, found: false }]));
}

/** A tracker bead as `findByKey` returns it. */
function bead(id, overrides = {}) {
  return { ok: true, found: true, item: { id, status: 'open', labels: [BEAD_LABEL], title: 'old', description: 'old', priority: 9, ...overrides }, labels: overrides.labels || [BEAD_LABEL] };
}

/** A bead this PR (Acme/Widgets PR #7, at an earlier head) last confirmed: the footer the planner writes. */
const recorded = (id, overrides = {}) => bead(id, { description: `Body.\n\nLast confirmed: acme/widgets PR #7 at head ${'1'.repeat(40)}`, ...overrides });

/** The tracker as it would hold the beads the plan creates, so a second plan can be run against it. */
function afterCreate(plan, inp) {
  const keys = beadKeys(inp).keys;
  const held = Object.fromEntries(keys.map((key) => [key, { ok: true, found: false }]));
  plan.actions
    .filter((a) => a.action === 'create')
    .forEach((a, i) => {
      held[a.key] = {
        ok: true,
        found: true,
        item: { id: `bd-${i}`, status: 'open', title: a.create.title, description: a.create.description, priority: a.create.priority, labels: a.create.labels },
        labels: a.create.labels,
      };
    });
  return held;
}

const one = (plan, id) => plan.actions.find((a) => a.findingIds.includes(id));

describe('the dedupe key: repository, file and normalized claim', () => {
  const base = { repo: 'Acme/Widgets', file: 'src/a.js', claim: 'unchecked path::' };

  test('the same claim in the same file is one key, whatever the case of the repo or the spelling of the file', () => {
    const key = reviewFindingKey(base);
    expect(key).toMatch(/^pr-review:v1:acme\/widgets:[0-9a-f]{32}$/);
    expect(reviewFindingKey({ ...base, repo: 'acme/widgets' })).toBe(key);
    expect(reviewFindingKey({ ...base, file: './src/a.js' })).toBe(key);
    expect(reviewFindingKey({ ...base, file: 'src\\a.js' })).toBe(key);
  });

  test('another repository, file or claim is another key', () => {
    const key = reviewFindingKey(base);
    expect(reviewFindingKey({ ...base, repo: 'acme/other' })).not.toBe(key);
    expect(reviewFindingKey({ ...base, file: 'src/b.js' })).not.toBe(key);
    expect(reviewFindingKey({ ...base, claim: 'unchecked read::' })).not.toBe(key);
  });

  test('a repository or claim that cannot be read gives no key, never a key shared with others', () => {
    expect(reviewFindingKey({ ...base, repo: 'acme widgets' })).toBeNull();
    expect(reviewFindingKey({ ...base, repo: '' })).toBeNull();
    expect(reviewFindingKey({ ...base, claim: '  ' })).toBeNull();
    expect(reviewFindingKey({ ...base, file: 7 })).toBeNull();
    expect(reviewGroupKey({ repo: 'acme/widgets', file: 'src/a.js', group: 'important' })).toBeNull();
  });

  test('a collapsed bead can never be mistaken for a finding bead', () => {
    expect(reviewGroupKey({ repo: 'acme/widgets', file: 'src/a.js', group: 'nit' })).toMatch(/:group:/);
    expect(reviewGroupKey({ repo: 'acme/widgets', file: 'src/a.js', group: 'nit' })).not.toBe(reviewFindingKey(base));
  });

  test('the key ignores the line and the PR, and flattens the case, punctuation and spacing of the claim: a defect that moved is the same bead', () => {
    const a = beadKeys(input([finding({ locationOrLink: 'src/widget.js:12', failureMode: 'Unchecked path join' })])).keys;
    const b = beadKeys({ ...input([finding({ locationOrLink: 'src/widget.js:91', failureMode: '  unchecked   PATH join. ' })]), prNumber: 99, headSha: NEXT_HEAD }).keys;
    expect(a).toEqual(b);
  });

  test('STATED LIMIT: a reworded claim in the same file is another key, so a paraphrase makes a second bead (a person closes the stale one)', () => {
    const first = input([finding({ failureMode: 'Unchecked path join' })]);
    const reworded = input([finding({ failureMode: 'Path join with unvalidated user input' })], { headSha: NEXT_HEAD });
    const [a] = beadKeys(first).keys;
    const [b] = beadKeys(reworded).keys;
    expect(a).not.toBe(b);

    const created = planBeads(first, empty(first));
    const held = afterCreate(created, first);
    const second = planBeads(reworded, { ...held, [b]: { ok: true, found: false } });
    expect(second.counts).toMatchObject({ create: 1, update: 0 });
    // The first bead is left exactly as it is: absence is not a fix.
    expect(second.actions.map((action) => action.key)).toEqual([b]);
  });

  test('one claim reported at different severities is one bead at the WORST severity, never split by severity', () => {
    for (const order of [['nit', 'important'], ['important', 'nit']]) {
      const ledger = order.map((severity, i) => finding({ id: `S-${i}`, severity, locationOrLink: `src/widget.js:${10 + i}` }));
      const plan = planBeads(input(ledger), empty(input(ledger)));
      expect(plan.actions).toHaveLength(1);
      expect(plan.actions[0].findingIds).toEqual(['S-0', 'S-1']);
      expect(plan.actions[0].create).toMatchObject({ priority: 1, type: 'bug' });
      expect(plan.actions[0].create.title).toMatch(/^\[important\]/);
    }
  });

  test('two findings with one claim in one file share one bead', () => {
    const ledger = [finding({ id: 'A', locationOrLink: 'src/widget.js:10' }), finding({ id: 'B', locationOrLink: 'src/widget.js:40' })];
    expect(beadKeys(input(ledger)).keys).toHaveLength(1);
    const plan = planBeads(input(ledger), empty(input(ledger)));
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].findingIds).toEqual(['A', 'B']);
    expect(plan.actions[0].create.description).toContain('src/widget.js:10');
    expect(plan.actions[0].create.description).toContain('src/widget.js:40');
  });
});

describe('re-review updates beads and never duplicates them (acceptance test b)', () => {
  const ledger = [
    finding({ id: 'F-1' }),
    finding({ id: 'F-2', severity: 'nit', locationOrLink: 'src/other.js:3', failureMode: 'stray log' }),
  ];

  test('the first review creates one bead per finding with the pr-review label, priority and key', () => {
    const plan = planBeads(input(ledger), empty(input(ledger)));
    expect(plan.ok).toBe(true);
    expect(plan.counts).toMatchObject({ create: 2, update: 0, close: 0 });
    const important = one(plan, 'F-1').create;
    expect(important).toMatchObject({ type: 'bug', priority: 1, labels: [BEAD_LABEL], key: one(plan, 'F-1').key });
    expect(important.title).toBe('[important] src/widget.js: Unchecked path join');
    expect(one(plan, 'F-2').create).toMatchObject({ type: 'chore', priority: 3, labels: [BEAD_LABEL] });
  });

  test('the bead carries the claim, location, votes, state report, PR number and head', () => {
    const votes = { ok: true, findings: [{ id: 'F-1', outcome: 'present', presented: true, tally: { real: 2, notReal: 1, abstain: 0, expected: 3, needed: 2 } }] };
    const plan = planBeads(input(ledger, { votes, reportLink: '.ensemble/pr-review/pr-7.json' }), empty(input(ledger)));
    const { description } = one(plan, 'F-1').create;
    expect(description).toContain('Claim: Unchecked path join');
    expect(description).toContain('src/widget.js:12');
    expect(description).toContain('2 real / 1 not-real of 3 expected (present)');
    expect(description).toContain('State report: .ensemble/pr-review/pr-7.json');
    expect(description).toContain(`PR #7 at head ${HEAD}`);
  });

  test('a later head UPDATES the existing beads and creates none', () => {
    const first = planBeads(input(ledger), empty(input(ledger)));
    const held = afterCreate(first, input(ledger));
    const later = input(ledger, { headSha: NEXT_HEAD, prNumber: 8 });
    const second = planBeads(later, held);

    expect(second.counts).toMatchObject({ create: 0, update: 2, close: 0, error: 0 });
    expect(second.actions.every((a) => a.action === 'update')).toBe(true);
    expect(one(second, 'F-1').update.id).toBe('bd-0');
    expect(one(second, 'F-1').update.description).toContain(`at head ${NEXT_HEAD}`);
    expect(one(second, 'F-1').update.note).toContain(`Re-confirmed at head ${NEXT_HEAD} (PR #8)`);
  });

  test('an unchanged finding at the SAME head is left alone: no update, no new note', () => {
    const first = planBeads(input(ledger), empty(input(ledger)));
    const again = planBeads(input(ledger), afterCreate(first, input(ledger)));
    expect(again.counts).toMatchObject({ create: 0, update: 0, close: 0, skip: 2 });
    expect(again.actions.map((a) => a.reason)).toEqual(['unchanged', 'unchanged']);
  });

  test('a finding that moved to another line is the same bead, updated with the new line', () => {
    const first = planBeads(input(ledger), empty(input(ledger)));
    const moved = input([finding({ id: 'F-9', locationOrLink: 'src/widget.js:88' }), ledger[1]], { headSha: NEXT_HEAD });
    const plan = planBeads(moved, afterCreate(first, input(ledger)));
    expect(plan.counts.create).toBe(0);
    expect(one(plan, 'F-9')).toMatchObject({ action: 'update', beadId: 'bd-0' });
    expect(one(plan, 'F-9').update.description).toContain('src/widget.js:88');
  });

  test('a bead the tracker lacks a pr-review label on gets it, without rewriting the fields', () => {
    const first = planBeads(input([ledger[0]]), empty(input([ledger[0]])));
    const held = afterCreate(first, input([ledger[0]]));
    const key = first.actions[0].key;
    held[key].item.labels = ['triaged'];
    const plan = planBeads(input([ledger[0]]), held);
    expect(plan.actions[0]).toMatchObject({ action: 'update', reason: 'labels', addLabels: [BEAD_LABEL] });
    expect(plan.actions[0].update).toBeUndefined();
  });

  test('a second PR raising the same claim in the same file updates the first PR\'s bead, and the note names the record it replaced', () => {
    const first = planBeads(input(ledger), empty(input(ledger)));
    const held = afterCreate(first, input(ledger));
    // The footer the first review wrote is what the tracker holds; hand it back as the item description.
    const key = first.actions[0].key;
    held[key].item.description = first.actions[0].create.description;
    const otherPr = planBeads(input(ledger, { prNumber: 99, headSha: NEXT_HEAD }), held);
    const update = one(otherPr, 'F-1').update;
    expect(update.description).toContain(`PR #99 at head ${NEXT_HEAD}`);
    expect(update.note).toContain(`Re-confirmed at head ${NEXT_HEAD} (PR #99)`);
    expect(update.note).toContain(`Replaces the description's earlier record: acme/widgets PR #7 at head ${HEAD}`);

    // A later head of the SAME PR names no earlier record: nothing was replaced but its own last head.
    const samePr = planBeads(input(ledger, { prNumber: 7, headSha: NEXT_HEAD }), held);
    expect(one(samePr, 'F-1').update.note).toBe(`Re-confirmed at head ${NEXT_HEAD} (PR #7): 1 location.`);
  });
});

describe('a fix closes the bead, and only a fix does', () => {
  const fixed = (overrides = {}) => finding({ cleared: true, clearedBy: FIX_COMMIT, clearedReason: 'location-changed', ...overrides });
  /** The commits the executor verified are on the PR. */
  const onPr = { commitsOnPr: [FIX_COMMIT] };

  test('a cleared finding closes its open bead with the verified commit and a reason that names the PR', () => {
    const inp = input([fixed()], onPr);
    const key = beadKeys(inp).keys[0];
    const plan = planBeads(inp, { [key]: recorded('bd-1') });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ action: 'close', beadId: 'bd-1', close: { id: 'bd-1', commit: FIX_COMMIT } });
    expect(plan.actions[0].close.reason).toContain(FIX_COMMIT);
    expect(plan.actions[0].close.reason).toContain('Acme/Widgets'.toLowerCase());
    expect(plan.actions[0].close.reason).toContain('PR #7');
    // The bead is closed once this runs: the finding reports it as closed, never as an open bead.
    expect(plan.byFinding['F-1']).toMatchObject({ action: 'close', closedBeadId: 'bd-1' });
    expect(plan.byFinding['F-1'].beadId).toBeUndefined();
  });

  test('no commit, no close: a cleared mark without a commit id never closes a bead', () => {
    for (const clearedBy of [undefined, '', 'not-a-sha', 'main']) {
      const inp = input([finding({ cleared: true, clearedBy })], onPr);
      // Nothing about this finding can be matched to a bead, so there is nothing to look up either.
      expect(beadKeys(inp).keys).toEqual([]);
      const plan = planBeads(inp, {});
      expect(plan.ok).toBe(true);
      expect(plan.counts.close).toBe(0);
      expect(plan.actions[0]).toMatchObject({ action: 'skip', reason: 'cleared-without-commit' });
    }
  });

  test('a commit nobody verified closes nothing: the shape of a hex string proves nothing', () => {
    const other = 'd'.repeat(40);
    for (const extra of [{}, { commitsOnPr: [] }, { commitsOnPr: [other] }]) {
      const inp = input([fixed()], extra);
      expect(beadKeys(inp).keys).toEqual([]);
      const plan = planBeads(inp, {});
      expect(plan.ok).toBe(true);
      expect(plan.counts.close).toBe(0);
      expect(plan.actions[0]).toMatchObject({ action: 'skip', reason: 'cleared-unverified' });
    }
  });

  test('a short commit id resolves to the one verified commit it abbreviates; an ambiguous abbreviation closes nothing', () => {
    const short = input([fixed({ clearedBy: FIX_COMMIT.slice(0, 9).toUpperCase() })], onPr);
    const key = beadKeys(short).keys[0];
    expect(planBeads(short, { [key]: recorded('bd-1') }).actions[0].close.commit).toBe(FIX_COMMIT);

    const twin = 'c'.repeat(12) + 'd'.repeat(28);
    const ambiguous = input([fixed({ clearedBy: 'c'.repeat(9) })], { commitsOnPr: [FIX_COMMIT, twin] });
    expect(planBeads(ambiguous, {}).actions[0]).toMatchObject({ action: 'skip', reason: 'cleared-unverified' });
  });

  test('commitsOnPr must be an array of full commit ids: anything else refuses the request', () => {
    for (const bad of ['abc', [FIX_COMMIT.slice(0, 12)], [7], [{}], 'c'.repeat(40)]) {
      const inp = input([fixed()], { commitsOnPr: bad });
      expect(beadKeys(inp)).toMatchObject({ ok: false, keys: [] });
      expect(planBeads(inp, {})).toMatchObject({ ok: false, actions: [] });
    }
  });

  test('a finding that is merely absent from the ledger closes nothing (absence is not a fix)', () => {
    const inp = input([finding({ id: 'F-other', failureMode: 'something else entirely' })]);
    const plan = planBeads(inp, empty(inp));
    expect(plan.counts.close).toBe(0);
  });

  test('an already closed bead and a fix with no bead are skipped, not closed again or created', () => {
    const inp = input([fixed()], onPr);
    const key = beadKeys(inp).keys[0];
    const closed = planBeads(inp, { [key]: bead('bd-1', { status: 'closed' }) });
    expect(closed.actions[0]).toMatchObject({ action: 'skip', reason: 'already-closed', closedBeadId: 'bd-1' });
    expect(closed.byFinding['F-1'].beadId).toBeUndefined();
    expect(planBeads(inp, { [key]: { ok: true, found: false } }).actions[0]).toMatchObject({ action: 'skip', reason: 'fixed-without-bead' });
  });

  test('a claim that is still live at another location does not close the bead', () => {
    const inp = input([fixed({ id: 'A' }), finding({ id: 'B', locationOrLink: 'src/widget.js:70' })], onPr);
    const key = beadKeys(inp).keys[0];
    const plan = planBeads(inp, { [key]: bead('bd-1') });
    expect(plan.counts.close).toBe(0);
    expect(plan.actions[0].action).toBe('update');
    expect(plan.actions[0].update.description).not.toContain('src/widget.js:12');
    expect(plan.actions[0].update.description).toContain('src/widget.js:70');
  });
});

describe('a closed bead on a live finding is reported as closed, and reopened only when this recorder closed it as a fix', () => {
  const fixed = (overrides = {}) => finding({ cleared: true, clearedBy: FIX_COMMIT, clearedReason: 'location-changed', ...overrides });

  test('a bead anyone else closed is reported as CLOSED (never as an open bead), is not reopened and is not re-created', () => {
    const inp = input([finding()]);
    const key = beadKeys(inp).keys[0];
    const lookalike = 'Fixed: x changed at nothex and was not reported again at nothex (a/b PR #1).';
    for (const close_reason of [undefined, 'wontfix', 'Fixed: by hand in PR 12', lookalike]) {
      const plan = planBeads(inp, { [key]: bead('bd-1', { status: 'closed', close_reason }) });
      expect(plan.counts).toMatchObject({ create: 0, update: 0, close: 0, skip: 1 });
      expect(plan.actions[0]).toMatchObject({ action: 'skip', reason: 'bead-closed', closedBeadId: 'bd-1', status: 'closed' });
      expect(plan.actions[0].beadId).toBeUndefined();
      expect(plan.byFinding['F-1']).toMatchObject({ action: 'skip', reason: 'bead-closed', closedBeadId: 'bd-1' });
      expect(plan.byFinding['F-1'].beadId).toBeUndefined();
    }
  });

  test('a bead this recorder closed as a fix is REOPENED when the finding is back: fields rewritten, one note, labels kept', () => {
    const fixedInput = input([fixed()], { commitsOnPr: [FIX_COMMIT] });
    const key = beadKeys(fixedInput).keys[0];
    const { close } = planBeads(fixedInput, { [key]: recorded('bd-1') }).actions[0];

    const back = input([finding({ id: 'F-9', locationOrLink: 'src/widget.js:40' })], { headSha: NEXT_HEAD, followOnIds: ['F-9'] });
    const plan = planBeads(back, { [key]: bead('bd-1', { status: 'closed', close_reason: close.reason }) });
    expect(plan.counts).toMatchObject({ create: 0, update: 1, close: 0, skip: 0 });
    expect(plan.actions[0]).toMatchObject({ action: 'update', reason: 'reopened', reopen: true, beadId: 'bd-1', addLabels: [FOLLOW_ON_LABEL] });
    expect(plan.actions[0].update.note).toContain(`Reopened at head ${NEXT_HEAD} (PR #7)`);
    expect(plan.actions[0].update.description).toContain('src/widget.js:40');
    // Once reopened it is an open bead again.
    expect(plan.byFinding['F-9']).toMatchObject({ action: 'update', beadId: 'bd-1' });
    expect(plan.byFinding['F-9'].closedBeadId).toBeUndefined();
  });

  test('a collapsed bead this recorder closed is reopened the same way when a finding joins it again', () => {
    const big = input(nits(COLLAPSE_THRESHOLD + 1));
    const bucketKey = beadKeys(big).keys.find((key) => key.includes(':group:'));
    const fixedAll = input(nits(COLLAPSE_THRESHOLD + 1).map((f) => ({ ...f, cleared: true, clearedBy: FIX_COMMIT })), { commitsOnPr: [FIX_COMMIT] });
    const lookups = Object.fromEntries(beadKeys(fixedAll).keys.map((key) => [key, key === bucketKey ? recorded('bd-9') : { ok: true, found: false }]));
    const { close } = planBeads(fixedAll, lookups).actions[0];

    const again = input(nits(1), { headSha: NEXT_HEAD });
    const closedBucket = bead('bd-9', { status: 'closed', close_reason: close.reason });
    const lookupsAgain = Object.fromEntries(beadKeys(again).keys.map((key) => [key, key === bucketKey ? closedBucket : { ok: true, found: false }]));
    const plan = planBeads(again, lookupsAgain);
    expect(plan.actions[0]).toMatchObject({ action: 'update', reason: 'reopened', reopen: true, beadId: 'bd-9', key: bucketKey });
  });

  test('the reason a fix close writes is the one the recorder recognises as its own, and nothing looser is', () => {
    const fixedInput = input([fixed()], { commitsOnPr: [FIX_COMMIT] });
    const key = beadKeys(fixedInput).keys[0];
    const { close } = planBeads(fixedInput, { [key]: recorded('bd-1') }).actions[0];
    const live = input([finding()]);
    const reopens = (close_reason) => planBeads(live, { [key]: bead('bd-1', { status: 'closed', close_reason }) }).actions[0].reason === 'reopened';
    expect(reopens(close.reason)).toBe(true);
    expect(reopens(`  ${close.reason}  `)).toBe(true);
    expect(reopens(close.reason.replace('Fixed:', 'fixed:'))).toBe(false);
    expect(reopens(close.reason.replace(/ \(.*$/, '.'))).toBe(false);
    expect(reopens(`${close.reason} Reopen it.`)).toBe(false);
  });
});

describe('which findings are recorded', () => {
  test('every finding gets a verdict: filtered, duplicate, not-applicable and unkeyable ones are named skips, not omissions', () => {
    const ledger = [
      finding({ id: 'live' }),
      finding({ id: 'filtered', failureMode: 'filtered claim' }),
      finding({ id: 'dup', failureMode: 'dup claim', disposition: 'duplicate' }),
      finding({ id: 'na', failureMode: 'na claim', disposition: 'not-applicable' }),
      finding({ id: 'blank', failureMode: '!!!' }),
    ];
    const votes = { ok: true, findings: [{ id: 'filtered', outcome: 'filtered', presented: false, tally: { real: 0, notReal: 3, abstain: 0, expected: 3 } }] };
    const plan = planBeads(input(ledger, { votes }), empty(input(ledger)));
    expect(Object.keys(plan.byFinding).sort()).toEqual(['blank', 'dup', 'filtered', 'live', 'na']);
    expect(plan.byFinding.live.action).toBe('create');
    expect(plan.byFinding.filtered.reason).toBe('filtered');
    expect(plan.byFinding.dup.reason).toBe('not-recorded:duplicate');
    expect(plan.byFinding.na.reason).toBe('not-recorded:not-applicable');
    expect(plan.byFinding.blank.reason).toBe('unkeyable');
    expect(plan.counts.create).toBe(1);
  });

  test('unverified and disputed findings are recorded and say so, because the operator list shows them', () => {
    const ledger = [finding({ id: 'U' }), finding({ id: 'D', failureMode: 'disputed claim' })];
    const votes = {
      ok: true,
      findings: [
        { id: 'U', outcome: 'unverified', presented: true, reason: 'verifier-incomplete', tally: { real: 1, notReal: 0, abstain: 0, expected: 3 } },
        { id: 'D', outcome: 'disputed', presented: true, tally: { real: 1, notReal: 2, abstain: 0, expected: 3 } },
      ],
    };
    const plan = planBeads(input(ledger, { votes }), empty(input(ledger)));
    expect(plan.counts.create).toBe(2);
    expect(one(plan, 'U').create.description).toContain('(unverified)');
    expect(one(plan, 'D').create.description).toContain('(disputed)');
  });

  test('a finding with no vote record is still recorded, marked as not recorded', () => {
    const plan = planBeads(input([finding()]), empty(input([finding()])));
    expect(plan.actions[0].create.description).toContain('[not recorded]');
  });

  test('a security-lane finding is recorded as security at the highest bead priority, whatever its severity word', () => {
    const lane = finding({ id: 'S-1', severity: 'pre-existing', failureMode: 'ligature fold', locationOrLink: 'src/p.js:192' });
    const inp = input([], { security: { status: 'findings', findings: [lane] } });
    const plan = planBeads(inp, empty(inp));
    expect(plan.actions[0].create).toMatchObject({ priority: 1, type: 'bug' });
    expect(plan.actions[0].create.title).toMatch(/^\[pre-existing, security\]/);
  });

  test('credential-shaped text is redacted before it reaches a bead title or description', () => {
    const secret = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    const plan = planBeads(input([finding({ failureMode: `leaks ${secret} to logs`, evidence: `token ${secret}` })]), empty(input([finding({ failureMode: `leaks ${secret} to logs` })])));
    const created = plan.actions[0].create;
    expect(created.title).not.toContain(secret);
    expect(created.description).not.toContain(secret);
    expect(created.description).toContain('[REDACTED]');
  });

  // Built from parts so the repository's own secret scanner does not flag this file.
  const AWS_KEY_ID = 'AKIA' + 'IOSFODNN7EXAMPLE';
  const AWS_TEMP_KEY_ID = 'ASIA' + 'IOSFODNN7EXAMPLE';
  const FINE_GRAINED = 'github_pat_' + '11ABCDEFG0abcdefghij12' + '_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6a7B8c9D0';

  test.each([
    ['an AWS access key id', AWS_KEY_ID],
    ['an AWS temporary access key id', AWS_TEMP_KEY_ID],
    ['a github_pat_ fine-grained token', FINE_GRAINED],
  ])('%s in the claim and the evidence never reaches the bead title or description', (_label, secret) => {
    const inp = input([finding({ failureMode: `hardcoded ${secret} in config`, evidence: `line 12 has ${secret}` })]);
    const created = planBeads(inp, empty(inp)).actions[0].create;
    expect(created.title).not.toContain(secret);
    expect(created.description).not.toContain(secret);
    expect(created.description).toContain('[REDACTED]');
  });

  test('a secret in a file name or in a vote outcome is redacted too, and a file name never breaks the title into lines', () => {
    const named = input([finding({ locationOrLink: `src/${AWS_KEY_ID}.js:3`, failureMode: 'named after a key' })]);
    const { title, description } = planBeads(named, empty(named)).actions[0].create;
    expect(`${title}\n${description}`).not.toContain(AWS_KEY_ID);

    const votes = { ok: true, findings: [{ id: 'F-1', outcome: `present ${FINE_GRAINED}`, presented: true, tally: { real: 2, notReal: 0, abstain: 0, expected: 3 } }] };
    const voted = input([finding()], { votes });
    expect(planBeads(voted, empty(voted)).actions[0].create.description).not.toContain(FINE_GRAINED);

    const multiline = input([finding({ locationOrLink: 'src/a\nb.js:3', failureMode: 'odd name' })]);
    expect(planBeads(multiline, empty(multiline)).actions[0].create.title).not.toMatch(/[\r\n]/);
  });

  test('a collapsed bead title and its close reason are redacted as well', () => {
    const file = `src/${AWS_KEY_ID}.js`;
    const many = input(nits(COLLAPSE_THRESHOLD + 1, file));
    const created = planBeads(many, empty(many)).actions[0].create;
    expect(`${created.title}\n${created.description}`).not.toContain(AWS_KEY_ID);

    const key = beadKeys(many).keys.find((k) => k.includes(':group:'));
    const fixedAll = input(nits(COLLAPSE_THRESHOLD + 1, file).map((f) => ({ ...f, cleared: true, clearedBy: FIX_COMMIT })), { commitsOnPr: [FIX_COMMIT] });
    const lookups = Object.fromEntries(beadKeys(fixedAll).keys.map((k) => [k, k === key ? recorded('bd-1') : { ok: true, found: false }]));
    const { close } = planBeads(fixedAll, lookups).actions[0];
    expect(close.reason).not.toContain(AWS_KEY_ID);
  });
});

describe('Nits and Pre-existing findings collapse per file (threshold shared with the operator list)', () => {
  test('the threshold is the operator list\'s own: more than COLLAPSE_THRESHOLD collapse, exactly that many do not', () => {
    const atThreshold = input(nits(COLLAPSE_THRESHOLD));
    expect(planBeads(atThreshold, empty(atThreshold)).counts.create).toBe(COLLAPSE_THRESHOLD);

    const over = input(nits(COLLAPSE_THRESHOLD + 1));
    const plan = planBeads(over, empty(over));
    expect(plan.counts.create).toBe(1);
    expect(plan.actions[0].findingIds).toHaveLength(COLLAPSE_THRESHOLD + 1);
    expect(plan.actions[0].create.title).toBe(`[nit] src/same.js: ${COLLAPSE_THRESHOLD + 1} Nit findings (collapsed)`);
    expect(plan.actions[0].key).toMatch(/:group:/);
    // Every member is mapped to the one bead's key.
    expect(new Set(Object.values(plan.byFinding).map((v) => v.key)).size).toBe(1);
  });

  test('Nits and Pre-existing findings of one file are two groups, each counted on its own', () => {
    const preExisting = nits(COLLAPSE_THRESHOLD, 'src/same.js', { severity: 'pre-existing' }).map((f, i) => ({ ...f, id: `P-${i}`, failureMode: `old problem ${i}` }));
    const ledger = [...nits(COLLAPSE_THRESHOLD), ...preExisting];
    const plan = planBeads(input(ledger), empty(input(ledger)));
    expect(plan.counts.create).toBe(COLLAPSE_THRESHOLD * 2);
  });

  test('another file is another bead', () => {
    const ledger = [...nits(COLLAPSE_THRESHOLD + 1), ...nits(COLLAPSE_THRESHOLD + 1, 'src/elsewhere.js').map((f, i) => ({ ...f, id: `E-${i}` }))];
    expect(planBeads(input(ledger), empty(input(ledger))).counts.create).toBe(2);
  });

  test('Important and security findings are never collapsed, however many share a file', () => {
    const important = Array.from({ length: COLLAPSE_THRESHOLD + 2 }, (_, i) => finding({ id: `I-${i}`, failureMode: `distinct claim ${i}` }));
    expect(planBeads(input(important), empty(input(important))).counts.create).toBe(important.length);

    const security = nits(COLLAPSE_THRESHOLD + 2, 'src/sec.js', { security: true });
    expect(planBeads(input(security), empty(input(security))).counts.create).toBe(security.length);
  });

  test('a finding that already has its own bead keeps it: it is updated, never folded into the collapsed bead', () => {
    // N-1 holds its own bead; the other four have none and are more than the threshold on their own.
    const ledger = nits(COLLAPSE_THRESHOLD + 2);
    const lookups = empty(input(ledger));
    const ownKey = reviewFindingKey({ repo: 'acme/widgets', file: 'src/same.js', claim: 'nit number 1::' });
    lookups[ownKey] = bead('bd-own');
    const plan = planBeads(input(ledger), lookups);
    expect(plan.byFinding['N-1']).toMatchObject({ action: 'update', beadId: 'bd-own' });
    expect(plan.byFinding['N-2'].action).toBe('create');
    expect(plan.byFinding['N-2'].key).toMatch(/:group:/);
    expect(plan.actions.filter((a) => a.action === 'create')).toHaveLength(1);
    expect(plan.actions.find((a) => a.action === 'create').findingIds).toHaveLength(COLLAPSE_THRESHOLD + 1);
  });

  test('3 Nits with their own beads and a 4th arriving later: the 4th gets its own bead, never a one-member collapsed bead', () => {
    const ledger = nits(COLLAPSE_THRESHOLD + 1);
    const lookups = empty(input(ledger));
    for (let i = 1; i <= COLLAPSE_THRESHOLD; i += 1) {
      lookups[reviewFindingKey({ repo: 'acme/widgets', file: 'src/same.js', claim: `nit number ${i}::` })] = bead(`bd-${i}`);
    }
    const plan = planBeads(input(ledger), lookups);
    expect(plan.counts).toMatchObject({ create: 1, update: COLLAPSE_THRESHOLD });
    const created = plan.actions.find((a) => a.action === 'create');
    expect(created.findingIds).toEqual([`N-${COLLAPSE_THRESHOLD + 1}`]);
    expect(created.key).not.toMatch(/:group:/);
    expect(created.create.title).toBe(`[nit] src/same.js: nit number ${COLLAPSE_THRESHOLD + 1}`);
    expect(plan.actions.every((a) => !/collapsed/.test(a.create ? a.create.title : ''))).toBe(true);
  });

  test('the title of a collapsed bead that is down to one member reads as one finding', () => {
    const big = input(nits(COLLAPSE_THRESHOLD + 1));
    const held = afterCreate(planBeads(big, empty(big)), big);
    const one = input(nits(1), { headSha: NEXT_HEAD });
    const plan = planBeads(one, Object.fromEntries(beadKeys(one).keys.map((key) => [key, held[key] || { ok: true, found: false }])));
    expect(plan.actions[0].update.title).toBe('[nit] src/same.js: 1 Nit finding');
  });

  test('once a file has a collapsed bead the choice is sticky: fewer findings still join it, none get their own bead', () => {
    const big = input(nits(COLLAPSE_THRESHOLD + 1));
    const first = planBeads(big, empty(big));
    const held = afterCreate(first, big);

    const small = input(nits(2), { headSha: NEXT_HEAD });
    const heldSmall = Object.fromEntries(beadKeys(small).keys.map((key) => [key, held[key] || { ok: true, found: false }]));
    const plan = planBeads(small, heldSmall);
    expect(plan.counts.create).toBe(0);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ action: 'update', key: first.actions[0].key });
    expect(plan.actions[0].update.title).toBe('[nit] src/same.js: 2 Nit findings (collapsed)');
  });

  test('re-review of an unchanged collapsed file is a no-op', () => {
    const big = input(nits(COLLAPSE_THRESHOLD + 1));
    const first = planBeads(big, empty(big));
    const again = planBeads(big, afterCreate(first, big));
    expect(again.counts).toMatchObject({ create: 0, update: 0, close: 0 });
    expect(again.actions[0]).toMatchObject({ action: 'skip', reason: 'unchanged' });
  });

  test('the collapsed bead closes only when every finding that joined it is fixed', () => {
    const big = input(nits(COLLAPSE_THRESHOLD + 1));
    const first = planBeads(big, empty(big));
    const held = afterCreate(first, big);
    const fixedAll = nits(COLLAPSE_THRESHOLD + 1).map((f) => ({ ...f, cleared: true, clearedBy: FIX_COMMIT }));
    const lookupsFor = (inp) => Object.fromEntries(beadKeys(inp).keys.map((key) => [key, held[key] || { ok: true, found: false }]));
    const onPr = { headSha: NEXT_HEAD, commitsOnPr: [FIX_COMMIT] };

    const all = input(fixedAll, onPr);
    const closed = planBeads(all, lookupsFor(all));
    expect(closed.counts).toMatchObject({ close: 1, create: 0 });
    expect(closed.actions[0].close).toMatchObject({ commit: FIX_COMMIT, id: 'bd-0' });
    expect(closed.actions[0].findingIds).toHaveLength(COLLAPSE_THRESHOLD + 1);

    const some = input([...fixedAll.slice(0, 2), ...nits(COLLAPSE_THRESHOLD + 1).slice(2)], onPr);
    const partial = planBeads(some, lookupsFor(some));
    expect(partial.counts.close).toBe(0);
    expect(partial.byFinding['N-1']).toMatchObject({ action: 'skip', reason: 'collapsed-member-fixed', beadId: 'bd-0' });
    expect(partial.actions.find((a) => a.action === 'update').update.description).not.toContain('nit number 1');
  });

  test('a collapsed bead is rendered with every member listed, capped for very large groups', () => {
    const many = input(nits(60));
    const plan = planBeads(many, empty(many));
    const { description } = plan.actions[0].create;
    expect(description).toContain('nit number 1 ');
    expect(description).toContain('- ... and 10 more');
  });
});

describe('labels: follow-on is the operator\'s choice, applied only to the findings they named', () => {
  test('a new bead for a named finding is created with follow-on; the others are not', () => {
    const ledger = [finding({ id: 'A', failureMode: 'claim a' }), finding({ id: 'B', failureMode: 'claim b' })];
    const inp = input(ledger, { followOnIds: ['A'] });
    const plan = planBeads(inp, empty(inp));
    expect(one(plan, 'A').create.labels).toEqual([BEAD_LABEL, FOLLOW_ON_LABEL]);
    expect(one(plan, 'B').create.labels).toEqual([BEAD_LABEL]);
  });

  test('the operator choosing follow-on AFTER the bead exists labels it without touching its fields', () => {
    const ledger = [finding({ id: 'A' })];
    const first = planBeads(input(ledger), empty(input(ledger)));
    const held = afterCreate(first, input(ledger));
    const after = planBeads(input(ledger, { followOnIds: ['A'] }), held);
    expect(after.actions[0]).toMatchObject({ action: 'update', reason: 'labels', addLabels: [FOLLOW_ON_LABEL], beadId: 'bd-0' });
    expect(after.actions[0].update).toBeUndefined();
    // And once labelled, the next run is a no-op.
    held[first.actions[0].key].item.labels = [BEAD_LABEL, FOLLOW_ON_LABEL];
    expect(planBeads(input(ledger, { followOnIds: ['A'] }), held).actions[0].reason).toBe('unchanged');
  });

  test('numeric ids work, and an id nobody named never gets the label', () => {
    const ledger = [finding({ id: 7 }), finding({ id: 8, failureMode: 'other claim' })];
    const inp = input(ledger, { followOnIds: [7] });
    const plan = planBeads(inp, empty(inp));
    expect(one(plan, '7').create.labels).toContain(FOLLOW_ON_LABEL);
    expect(one(plan, '8').create.labels).not.toContain(FOLLOW_ON_LABEL);
  });

  test('a collapsed bead gets follow-on only when every finding in it was chosen', () => {
    const ledger = nits(COLLAPSE_THRESHOLD + 1);
    const all = input(ledger, { followOnIds: ledger.map((f) => f.id) });
    expect(planBeads(all, empty(all)).actions[0].create.labels).toContain(FOLLOW_ON_LABEL);
    const most = input(ledger, { followOnIds: ledger.slice(1).map((f) => f.id) });
    expect(planBeads(most, empty(most)).actions[0].create.labels).toEqual([BEAD_LABEL]);
  });
});

describe('fail closed', () => {
  const lookupsOf = (inp) => empty(inp);

  test.each([
    ['no input', undefined],
    ['a repo with whitespace', { ...input([finding()]), repo: 'acme widgets' }],
    ['no repo', { ...input([finding()]), repo: undefined }],
    ['a PR number that is not a positive integer', { ...input([finding()]), prNumber: '7' }],
    ['a head that is not a hex commit id', { ...input([finding()]), headSha: 'main' }],
    ['a ledger that is not an array', { ...input([finding()]), ledger: {} }],
    ['a finding that is not an object', input(['x'])],
    ['a finding with no id', input([{ ...finding(), id: undefined }])],
    ['security that is not an object', { ...input([finding()]), security: 'clean' }],
    ['security findings that are not an array', { ...input([finding()]), security: { findings: 'x' } }],
    ['votes that are not a votes result', { ...input([finding()]), votes: [] }],
    ['followOnIds that are not an array', { ...input([finding()]), followOnIds: 'A' }],
    ['a reportLink that is not text', { ...input([finding()]), reportLink: 3 }],
  ])('%s is refused with a reason and no action', (_name, bad) => {
    const keys = beadKeys(bad);
    expect(keys.ok).toBe(false);
    expect(keys.keys).toEqual([]);
    const plan = planBeads(bad, {});
    expect(plan).toMatchObject({ ok: false, actions: [], byFinding: {} });
    expect(typeof plan.reason).toBe('string');
  });

  test('a lookup missing for a key the plan needs is refused, never read as "not found"', () => {
    const inp = input([finding()]);
    expect(planBeads(inp, {})).toMatchObject({ ok: false, actions: [] });
    expect(planBeads(inp, {}).reason).toMatch(/no lookup result for key/);
    expect(planBeads(inp, null).ok).toBe(false);
  });

  test('a collapsed file whose group key was not looked up is refused too', () => {
    const inp = input(nits(COLLAPSE_THRESHOLD + 1));
    const lookups = empty(inp);
    delete lookups[beadKeys(inp).keys.find((key) => key.includes(':group:'))];
    expect(planBeads(inp, lookups).ok).toBe(false);
  });

  test('two beads sharing a key (AMBIGUOUS_KEY) are an error action: nothing is created or written for it', () => {
    const inp = input([finding()]);
    const key = beadKeys(inp).keys[0];
    const plan = planBeads(inp, { [key]: { ok: false, error: { code: 'AMBIGUOUS_KEY', message: 'two', ids: ['a', 'b'] } } });
    expect(plan.ok).toBe(true);
    expect(plan.actions[0]).toMatchObject({ action: 'error', reason: 'ambiguous-key' });
    expect(plan.counts).toMatchObject({ error: 1, create: 0, update: 0 });
  });

  test('a lookup that failed for a key is an error action, never a create', () => {
    const inp = input([finding()]);
    const key = beadKeys(inp).keys[0];
    const plan = planBeads(inp, { [key]: { ok: false, error: { code: 'TOOL_FAILED', message: 'x' } } });
    expect(plan.actions[0]).toMatchObject({ action: 'error', reason: 'lookup-failed' });
    expect(plan.counts.create).toBe(0);
  });

  test('the input is never modified', () => {
    const deepFreeze = (value) => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const frozen = deepFreeze(input([finding(), ...nits(COLLAPSE_THRESHOLD + 1)], { followOnIds: ['F-1'], votes: { ok: true, findings: [] } }));
    expect(() => planBeads(frozen, lookupsOf(frozen))).not.toThrow();
  });
});

describe('a close belongs to the PR that last confirmed the bead (re-review F4)', () => {
  const fixed = (overrides = {}) => finding({ cleared: true, clearedBy: FIX_COMMIT, clearedReason: 'location-changed', ...overrides });
  const onPr = { commitsOnPr: [FIX_COMMIT] };
  const footerOf = (who) => `Body.\n\nLast confirmed: ${who} at head ${'1'.repeat(40)}`;
  const plan1 = (description) => {
    const inp = input([fixed()], onPr);
    const key = beadKeys(inp).keys[0];
    const held = bead('bd-1', description === undefined ? { description: undefined } : { description });
    return planBeads(inp, { [key]: held });
  };

  test('a bead whose footer names another PR of the same repository is left open and reported', () => {
    const plan = plan1(footerOf('acme/widgets PR #250'));
    expect(plan.counts).toMatchObject({ close: 0, skip: 1 });
    expect(plan.actions[0]).toMatchObject({ action: 'skip', reason: 'recorded-by-other-pr', beadId: 'bd-1', recordedBy: { repo: 'acme/widgets', prNumber: 250 } });
    expect(plan.actions[0].close).toBeUndefined();
    expect(plan.byFinding['F-1']).toMatchObject({ action: 'skip', reason: 'recorded-by-other-pr', beadId: 'bd-1', recordedBy: { repo: 'acme/widgets', prNumber: 250 } });
  });

  test('control: a footer naming THIS PR at an earlier head still closes (repository compared case-insensitively)', () => {
    for (const who of ['acme/widgets PR #7', 'ACME/Widgets PR #7']) {
      const plan = plan1(footerOf(who));
      expect(plan.counts.close).toBe(1);
      expect(plan.actions[0]).toMatchObject({ action: 'close', beadId: 'bd-1' });
    }
  });

  test('a footer naming another repository with the same PR number is left open', () => {
    const plan = plan1(footerOf('other/repo PR #7'));
    expect(plan.counts.close).toBe(0);
    expect(plan.actions[0]).toMatchObject({ action: 'skip', reason: 'recorded-by-other-pr', recordedBy: { repo: 'other/repo', prNumber: 7 } });
  });

  test('a missing or unreadable footer fails closed: recorded-pr-unknown, nothing is closed', () => {
    for (const description of [undefined, 'old', 'Last confirmed: acme/widgets PR #x at head nothex']) {
      const plan = plan1(description);
      expect(plan.counts.close).toBe(0);
      expect(plan.actions[0]).toMatchObject({ action: 'skip', reason: 'recorded-pr-unknown', beadId: 'bd-1' });
      expect(plan.byFinding['F-1']).toMatchObject({ action: 'skip', reason: 'recorded-pr-unknown' });
    }
  });

  test('a skip does not break the rest of the plan', () => {
    const inp = input([fixed({ id: 'A', failureMode: 'claim a' }), fixed({ id: 'B', failureMode: 'claim b' })], onPr);
    const [ka, kb] = beadKeys(inp).keys;
    const plan = planBeads(inp, { [ka]: bead('bd-a', { description: footerOf('acme/widgets PR #250') }), [kb]: recorded('bd-b') });
    expect(plan.counts).toMatchObject({ close: 1, skip: 1 });
    expect(plan.byFinding.A.reason).toBe('recorded-by-other-pr');
    expect(plan.byFinding.B).toMatchObject({ action: 'close', closedBeadId: 'bd-b' });
  });

  test('a collapsed file bead recorded by another PR is not closed by this PR\'s fixes', () => {
    const big = input(nits(COLLAPSE_THRESHOLD + 1));
    const bucketKey = beadKeys(big).keys.find((key) => key.includes(':group:'));
    const fixedAll = input(nits(COLLAPSE_THRESHOLD + 1).map((f) => ({ ...f, cleared: true, clearedBy: FIX_COMMIT })), { commitsOnPr: [FIX_COMMIT] });
    const lookupsWith = (held) => Object.fromEntries(beadKeys(fixedAll).keys.map((key) => [key, key === bucketKey ? held : { ok: true, found: false }]));

    const other = planBeads(fixedAll, lookupsWith(bead('bd-9', { description: footerOf('acme/widgets PR #250') })));
    expect(other.counts.close).toBe(0);
    expect(other.actions[0]).toMatchObject({ action: 'skip', reason: 'recorded-by-other-pr', beadId: 'bd-9', key: bucketKey, recordedBy: { prNumber: 250 } });
    expect(other.byFinding['N-1']).toMatchObject({ reason: 'recorded-by-other-pr', recordedBy: { repo: 'acme/widgets', prNumber: 250 } });

    const unknown = planBeads(fixedAll, lookupsWith(bead('bd-9', { description: 'old' })));
    expect(unknown.actions[0]).toMatchObject({ action: 'skip', reason: 'recorded-pr-unknown' });

    // Control: the same bucket recorded by this PR closes.
    expect(planBeads(fixedAll, lookupsWith(recorded('bd-9'))).actions[0]).toMatchObject({ action: 'close', beadId: 'bd-9' });
  });
});

describe('a collapsed bead titles its real size (re-review F11)', () => {
  const stickyPlan = (count) => {
    const big = input(nits(COLLAPSE_THRESHOLD + 1));
    const held = afterCreate(planBeads(big, empty(big)), big);
    const next = input(nits(count), { headSha: NEXT_HEAD });
    return planBeads(next, Object.fromEntries(beadKeys(next).keys.map((key) => [key, held[key] || { ok: true, found: false }])));
  };

  test('one live member of an existing collapsed bead: singular title, no (collapsed) suffix', () => {
    const { update } = stickyPlan(1).actions[0];
    expect(update.title).toBe('[nit] src/same.js: 1 Nit finding');
    expect(update.title).not.toContain('(collapsed)');
  });

  test('three members keep the plural title with (collapsed)', () => {
    expect(stickyPlan(3).actions[0].update.title).toBe('[nit] src/same.js: 3 Nit findings (collapsed)');
  });
});

describe('the reopen test matches the recorder\'s own reason shape, and the header says so (re-review F12)', () => {
  test('a person-pasted reason of the recorder\'s shape IS reopened on the next live finding (the stated limit)', () => {
    const live = input([finding()]);
    const key = beadKeys(live).keys[0];
    const pasted = `Fixed: the cited location changed at ${FIX_COMMIT} and was not reported again at ${HEAD} (acme/widgets PR #7).`;
    const plan = planBeads(live, { [key]: bead('bd-1', { status: 'closed', close_reason: pasted }) });
    expect(plan.actions[0]).toMatchObject({ action: 'update', reason: 'reopened', reopen: true });
    // br's plain close reason is `done`: that one stays closed.
    expect(planBeads(live, { [key]: bead('bd-1', { status: 'closed', close_reason: 'done' }) }).actions[0]).toMatchObject({ action: 'skip', reason: 'bead-closed' });
  });

  test('the planner header states the cross-PR close rule and the reopen limit', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '../lib/pr-review-beads.js'), 'utf8');
    const header = source.slice(0, source.indexOf("'use strict'") === -1 ? 6000 : source.indexOf('const crypto'));
    expect(header).toMatch(/recorded-by-other-pr/);
    expect(header).toMatch(/recorded-pr-unknown/);
    expect(header).toMatch(/REOPEN LIMIT/);
    expect(header).toMatch(/pastes a reason of that shape/);
    expect(header).toMatch(/sticky bucket may therefore hold a single member/);
  });
});
