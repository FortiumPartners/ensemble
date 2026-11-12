'use strict';

/**
 * The recall guard (kata yg7k): scores a review run's findings against a reference set of known Important findings.
 *
 * Guards and what each test's mutation would break (each was run against the module; see the kata comment):
 *   - severity: a finding that names the defect but is graded Nit is `downgraded`, never `found` (mutation: count any matching finding);
 *   - wording: ALL words of one term list must appear (mutation: any one word, which would make a passing mention a hit);
 *   - anchor: the cited line must fall in the range plus slack, in the same path (mutation: path only);
 *   - fail closed: an unreadable reference or findings file is exit 2, never a pass.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { scoreRecall, main } = require('../lib/review-recall-guard');

const GUARD = path.resolve(__dirname, '..', 'lib', 'review-recall-guard.js');
const REFERENCE = path.resolve(__dirname, '..', '..', '..', 'docs', 'review-eval', 'recall', 'pr207-48c862c.json');
const LEDGER = path.join(__dirname, 'fixtures', 'review-recall', 'pr207-medium-run-ledger.json');

const reference = JSON.parse(fs.readFileSync(REFERENCE, 'utf8'));
const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
const finding = (over) => ({ id: 'x1', locationOrLink: 'lib/a.js:10', severity: 'important', failureMode: 'nothing in particular', ...over });
const ref = (items) => ({ items });

describe('the real process on the first Medium run of PR 207 (the measurement this guard re-runs)', () => {
  const run = (...args) => spawnSync(process.execPath, [GUARD, ...args], { encoding: 'utf8' });

  test('it reproduces the measured loss: 1 of 6 Important found, 1 raised only as a nit, 4 never raised; exit 1', () => {
    const r = run('--reference', REFERENCE, '--findings', LEDGER);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ ok: true, pass: false, counts: { items: 6, found: 1, downgraded: 1, 'not-raised': 4 } });
    expect(out.items.map((i) => [i.id, i.status])).toEqual([['E1', 'found'], ['E2', 'not-raised'], ['E3', 'not-raised'], ['E4', 'downgraded'], ['E5', 'not-raised'], ['E6', 'not-raised']]);
    expect(out.notRaisedRate).toBeCloseTo(4 / 6, 5);
    expect(out.falseNegativeRate).toBeCloseTo(5 / 6, 5);
  });

  test('--max-false-negative moves the line a pass needs, and 1 passes anything readable', () => {
    expect(run('--reference', REFERENCE, '--findings', LEDGER, '--max-false-negative', '0.5').status).toBe(1);
    expect(run('--reference', REFERENCE, '--findings', LEDGER, '--max-false-negative', '1').status).toBe(0);
  });

  test('a run that raises every reference defect as Important passes with exit 0 (the guard can pass)', () => {
    const all = { ledger: reference.items.map((item, i) => finding({ id: `g${i}`, locationOrLink: 'x/y.js:1', failureMode: `about ${item.terms[0].join(' and ')}` })) };
    let written = '';
    const code = main(['--reference', REFERENCE, '--findings', 'all'], { readFile: (name) => (name === 'all' ? JSON.stringify(all) : fs.readFileSync(name, 'utf8')), write: (text) => { written += text; } });
    expect(code).toBe(0);
    expect(JSON.parse(written)).toMatchObject({ pass: true, falseNegativeRate: 0, counts: { found: 6 } });
  });

  test.each([
    [['--reference', REFERENCE]],
    [['--reference', REFERENCE, '--findings', '/nonexistent/ledger.json']],
    [['--reference', REFERENCE, '--findings', LEDGER, '--slack', 'many']],
    [['--reference', REFERENCE, '--findings', LEDGER, '--slack', '']],
    [['--reference', REFERENCE, '--findings', LEDGER, '--max-false-negative', '']],
    [['--reference', REFERENCE, '--findings', LEDGER, '--max-false-negative', '2']],
    [['--reference', REFERENCE, '--findings', LEDGER, '--bogus', '1']],
  ])('unreadable or bad input is exit 2 and never a pass (%j)', (args) => {
    const r = run(...args);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, pass: false });
  });
});

describe('severity: only an Important finding counts as found', () => {
  const item = ref([{ id: 'A', terms: [['frobnicate']] }]);
  const named = { failureMode: 'the frobnicate call throws' };

  test.each([['important'], ['Critical'], ['Major']])('%s is found', (severity) => {
    expect(scoreRecall({ reference: item, findings: [finding({ ...named, severity })] }).items[0].status).toBe('found');
  });

  test.each([['nit'], ['Minor'], ['pre-existing'], ['loud'], [undefined]])('%s that names the defect is downgraded, not found', (severity) => {
    const result = scoreRecall({ reference: item, findings: [finding({ ...named, severity })] });
    expect(result.items[0].status).toBe('downgraded');
    expect(result.pass).toBe(false);
  });

  test('a nit and an Important on the same defect: found, and both are listed', () => {
    const result = scoreRecall({ reference: item, findings: [finding({ ...named, id: 'n', severity: 'nit' }), finding({ ...named, id: 'i' })] });
    expect(result.items[0]).toMatchObject({ status: 'found', best: 'i' });
    expect(result.items[0].matchedBy.map((m) => m.id)).toEqual(['n', 'i']);
  });
});

describe('wording: every word of one term list, in the failure mode or the evidence', () => {
  const item = ref([{ id: 'A', terms: [['alpha', 'beta'], ['gamma']] }]);
  const status = (over) => scoreRecall({ reference: item, findings: [finding(over)] }).items[0].status;

  test('one word of a two-word list is not a match; the whole list is; any list will do; case is ignored', () => {
    expect(status({ failureMode: 'only ALPHA here' })).toBe('not-raised');
    expect(status({ failureMode: 'Alpha and BETA' })).toBe('found');
    expect(status({ failureMode: 'gamma alone' })).toBe('found');
  });

  test('the evidence counts when the ledger carries it', () => {
    expect(status({ failureMode: 'vague', evidence: 'ran it: gamma' })).toBe('found');
  });
});

describe('the reference is not satisfied by unrelated text, and a run that inflates is visible (review of PR 283, round 2)', () => {
  const status = (id, failureMode) => scoreRecall({ reference, findings: [finding({ failureMode })] }).items.find((i) => i.id === id).status;

  test('a finding that merely mentions a generic word of the reference does not satisfy the item', () => {
    expect(status('E4', 'The usings option of the scaffold is ignored for a second namespace')).toBe('not-raised');
    expect(status('E3', 'The first class in the file is a fixture, unrelated to where text is spliced')).toBe('not-raised');
    expect(status('E4', 'The usings list and the fixtureType both come from the caller')).toBe('found');
  });

  test('a correct paraphrase of E6 is found', () => {
    expect(status('E6', 'The headed flag is accepted by the parser but never reaches the browser launch')).toBe('found');
  });

  test('Important findings that match no item are listed, and a matching one is not', () => {
    const result = scoreRecall({ reference, findings: [finding({ id: 'a', failureMode: 'something else entirely' }), finding({ id: 'b', severity: 'nit', failureMode: 'also unrelated' }), finding({ id: 'c', failureMode: 'Microsoft.Playwright.Xunit is misclassified' })] });
    expect(result.unmatchedImportant.map((f) => f.id)).toEqual(['a']);
  });

  test('findings of another head are refused (exit-2 class), the same head and a bare array are scored', () => {
    const other = scoreRecall({ reference, findings: { headSha: 'f'.repeat(40), ledger: [] } });
    expect(other).toMatchObject({ ok: false, pass: false });
    expect(other.error).toMatch(/head-mismatch/);
    expect(scoreRecall({ reference, findings: { headSha: reference.headSha, ledger: [] } }).ok).toBe(true);
    expect(scoreRecall({ reference, findings: [] }).ok).toBe(true);
  });
});

describe('whole words: a word inside a longer one is not a hit (review of PR 283)', () => {
  const item = ref([{ id: 'A', terms: [['slow-mo']] }]);
  const status = (failureMode, evidence) => scoreRecall({ reference: item, findings: [finding({ failureMode, evidence })] }).items[0].status;

  test('"slow-motion" does not match "slow-mo"; "the slow-mo flag", "(slow-mo)" and "slow-mo." do', () => {
    expect(status('nothing', 'a slow-motion screenshot')).toBe('not-raised');
    expect(status('the slow-mo flag is ignored')).toBe('found');
    expect(status('(slow-mo)')).toBe('found');
    expect(status('ignores slow-mo.')).toBe('found');
  });

  test('regex characters in a word are literal: "[theory]" is not a character class', () => {
    const r = ref([{ id: 'A', terms: [['[theory]']] }]);
    expect(scoreRecall({ reference: r, findings: [finding({ failureMode: 'matches t, h or e' })] }).items[0].status).toBe('not-raised');
    expect(scoreRecall({ reference: r, findings: [finding({ failureMode: 'the [Theory] attribute' })] }).items[0].status).toBe('found');
  });
});

describe('the committed fixture is the run\'s own ledger, evidence included (review of PR 283)', () => {
  test('every entry carries its evidence, because the guard matches on it', () => {
    expect(ledger.ledger.length).toBe(17);
    expect(ledger.headSha).toBe(reference.headSha);
    for (const entry of ledger.ledger) expect(typeof entry.evidence === 'string' && entry.evidence.length > 0).toBe(true);
  });

  test('a paraphrase of E5 that names the function and the missing directory is found', () => {
    const paraphrase = finding({ failureMode: 'detectE2eFrameworkInDir throws when the directory does not exist' });
    expect(scoreRecall({ reference, findings: [paraphrase] }).items.find((i) => i.id === 'E5').status).toBe('found');
  });
});

describe('anchors: same path, a line in the range plus slack', () => {
  const item = ref([{ id: 'A', anchors: [{ path: 'lib/a.js', startLine: 100, endLine: 110 }] }]);
  const status = (locationOrLink, extra = {}) => scoreRecall({ reference: item, findings: [finding({ locationOrLink })], ...extra }).items[0].status;

  test('inside, at the slack edge, past it, and another path', () => {
    expect(status('lib/a.js:105')).toBe('found');
    expect(status('lib/a.js:113')).toBe('found');
    expect(status('lib/a.js:114')).toBe('not-raised');
    expect(status('lib/a.js:97')).toBe('found');
    expect(status('lib/a.js:96')).toBe('not-raised');
    expect(status('lib/b.js:105')).toBe('not-raised');
    expect(status('lib/a.js:114', { slack: 4 })).toBe('found');
  });

  test('a range location overlapping the anchor is a hit; an unparseable location is not', () => {
    expect(status('lib/a.js:90-100')).toBe('found');
    expect(status('lib/a.js')).toBe('not-raised');
  });

  test('anchors and terms together need both', () => {
    const both = ref([{ id: 'A', anchors: [{ path: 'lib/a.js', startLine: 1, endLine: 5 }], terms: [['zed']] }]);
    const s = (over) => scoreRecall({ reference: both, findings: [finding(over)] }).items[0].status;
    expect(s({ locationOrLink: 'lib/a.js:3', failureMode: 'zed' })).toBe('found');
    expect(s({ locationOrLink: 'lib/a.js:3', failureMode: 'other' })).toBe('not-raised');
    expect(s({ locationOrLink: 'lib/z.js:3', failureMode: 'zed' })).toBe('not-raised');
  });
});

describe('fail closed on what it cannot read', () => {
  const ok = ref([{ id: 'A', terms: [['x']] }]);
  test.each([
    ['no items', { items: [] }, [], /reference-empty/],
    ['not an object', null, [], /reference-empty/],
    ['an item without an id', { items: [{ terms: [['x']] }] }, [], /reference-item-invalid/],
    ['a duplicate id', { items: [{ id: 'A', terms: [['x']] }, { id: 'A', terms: [['y']] }] }, [], /reference-duplicate-id: A/],
    ['an item with neither anchors nor terms', { items: [{ id: 'A' }] }, [], /reference-item-unmatchable: A/],
    ['an empty term list', { items: [{ id: 'A', terms: [[]] }] }, [], /reference-item-invalid/],
    ['a backwards anchor', { items: [{ id: 'A', anchors: [{ path: 'a.js', startLine: 5, endLine: 2 }] }] }, [], /reference-item-invalid/],
    ['findings that are not a list', ok, { nothing: true }, /findings-unreadable/],
  ])('%s is ok:false', (_name, reference_, findings, error) => {
    const result = scoreRecall({ reference: reference_, findings });
    expect(result).toMatchObject({ ok: false, pass: false });
    expect(result.error).toMatch(error);
  });

  test('findings may be an array, { ledger } or { findings }; entries that are not objects are ignored', () => {
    const f = finding({ failureMode: 'x' });
    for (const findings of [[f], { ledger: [f] }, { findings: [f] }, [null, 3, f]]) expect(scoreRecall({ reference: ok, findings }).items[0].status).toBe('found');
  });

  test('main() writes one JSON line and returns the exit code, reading both files through its deps', () => {
    let written = '';
    const files = { r: JSON.stringify(ok), f: JSON.stringify([finding({ failureMode: 'x' })]) };
    const code = main(['--reference', 'r', '--findings', 'f'], { readFile: (name) => files[name], write: (text) => { written += text; } });
    expect(code).toBe(0);
    expect(written.trim().split('\n')).toHaveLength(1);
    expect(main(['--reference', 'r', '--findings', 'f'], { readFile: () => '{not json', write: () => {} })).toBe(2);
  });
});
