'use strict';

/**
 * TRD-007-TEST -- kata read mappings (TRD-2026-6995dc96 TRD-007; PRD REQ-008 AC-008-1, AC-008-2).
 *
 *  - tracker.show: the recorded `kata show --json` envelope maps to the normalized work item with
 *    title, description, type, status, priority and labels populated; `type` comes from kata
 *    metadata key `type` when set and is `task` otherwise.
 *  - tracker.list: an `open` filter selects an argv that passes `--status open`, a `closed`/`all`
 *    filter widens it, and every variant (and the base) carries an explicit `--limit 0`.
 *
 * Fixtures are recordings from kata v0.23.0 (tests/fixtures/kata/README.md), not hand-written.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { mapOutput } = require('../lib/toolchain/mapping');
const { buildArgv } = require('../lib/toolchain/runner');

const DEV_ROOT = path.join(__dirname, '..');
const MANIFEST = yaml.load(
  fs.readFileSync(path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8')
);
const SHOW = fs.readFileSync(path.join(__dirname, 'fixtures', 'kata', 'show.json'), 'utf8');
const WORK_ITEM_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(DEV_ROOT, 'toolchain', 'schemas', 'normalized', 'work-item.json'), 'utf8')
);
const validate = new Ajv({ allErrors: true, strict: false }).compile(WORK_ITEM_SCHEMA);

function showWith(mutate) {
  const doc = JSON.parse(SHOW);
  mutate(doc);
  return JSON.stringify(doc);
}

describe('TRD-007 tracker.show normalization (AC-008-2)', () => {
  const parse = MANIFEST.capabilities['tracker.show'].parse;

  test('declares a parse block', () => {
    expect(parse).toBeDefined();
  });

  test('populates title, description, type, status, priority and labels, schema-valid', () => {
    const item = mapOutput(SHOW, parse);
    const raw = JSON.parse(SHOW).issue;
    expect(item.id).toBe(raw.short_id);
    expect(item.title).toBe(raw.title);
    expect(item.description).toBe(raw.body);
    expect(item.type).toBe('task');
    expect(item.status).toBe('open');
    expect(item.priority).toBe(String(raw.priority));
    expect(item.labels).toEqual(raw.labels);
    expect(validate(item)).toBe(true);
  });

  test('type comes from metadata.type when set', () => {
    const item = mapOutput(showWith((d) => { d.issue.metadata = { type: 'bug' }; }), parse);
    expect(item.type).toBe('bug');
    expect(validate(item)).toBe(true);
  });

  test('closed status normalizes to closed', () => {
    const item = mapOutput(showWith((d) => { d.issue.status = 'closed'; }), parse);
    expect(item.status).toBe('closed');
  });

  test('no priority and no labels still maps (priority omitted, labels empty)', () => {
    const item = mapOutput(
      showWith((d) => { delete d.issue.priority; delete d.issue.labels; }),
      parse
    );
    expect(item.priority).toBeUndefined();
    expect(item.labels).toEqual([]);
    expect(validate(item)).toBe(true);
  });
});

describe('TRD-007 tracker.list open filter and no truncation (AC-008-1)', () => {
  const cap = MANIFEST.capabilities['tracker.list'];

  function argvFor(args) {
    const variants = {};
    for (const [sel, map] of Object.entries(cap.variants || {})) {
      variants[sel] = {};
      for (const [k, tpl] of Object.entries(map)) {
        variants[sel][k] = tpl.map((s) => s.replace(/\$\{/g, '{'));
      }
    }
    return buildArgv(cap.run.map((s) => s.replace(/\$\{/g, '{')), args, { inputs: {}, variants });
  }

  function pair(argv, flag) {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  }

  test('open filter selects --status open (closed items excluded)', () => {
    const argv = argvFor({ filter: 'open' });
    expect(pair(argv, '--status')).toBe('open');
  });

  test('closed and all filters are honored, not ignored', () => {
    expect(pair(argvFor({ filter: 'closed' }), '--status')).toBe('closed');
    expect(pair(argvFor({ filter: 'all' }), '--status')).toBe('all');
  });

  test('an unknown filter is refused rather than silently ignored', () => {
    expect(() => argvFor({ filter: 'bogus' })).toThrow(/not an allowed variant/);
  });

  test.each([['open'], ['closed'], ['all'], [undefined]])(
    'filter=%s always passes an explicit --limit 0 and never --all',
    (filter) => {
      const argv = argvFor(filter === undefined ? {} : { filter });
      expect(pair(argv, '--limit')).toBe('0');
      expect(argv).not.toContain('--all');
      expect(argv).toContain('--json');
    }
  );
});
