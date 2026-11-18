'use strict';

/**
 * TRD-034-TEST -- `owner` in the normalized work item (TRD-2026-6995dc96 TRD-034; PRD REQ-004
 * AC-004-2, REQ-008 AC-008-2).
 *
 *  - work-item.json declares `owner` as a property (not only via additionalProperties).
 *  - tracker.show maps `issue.owner`; an owned, open item reads back `in_progress` (kata has no
 *    in-progress status: owned-but-open IS in-progress); unowned open stays `open`; closed stays
 *    closed whatever the owner.
 *  - tracker.set-status (claim / unassign envelopes) reports the same owner and status as show.
 *  - mapOutput `inProgressWhen` must be a dotted-path string, else BAD_OUTPUT.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { mapOutput } = require('../lib/toolchain/mapping');

const DEV_ROOT = path.join(__dirname, '..');
const MANIFEST = yaml.load(
  fs.readFileSync(path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8')
);
const FIX = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', 'kata', n), 'utf8');
const SHOW = FIX('show.json');
const STATUS = FIX('status.json');
const WORK_ITEM_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(DEV_ROOT, 'toolchain', 'schemas', 'normalized', 'work-item.json'), 'utf8')
);
const validate = new Ajv({ allErrors: true, strict: false }).compile(WORK_ITEM_SCHEMA);

const edit = (raw, mutate) => {
  const doc = JSON.parse(raw);
  mutate(doc);
  return JSON.stringify(doc);
};

describe('TRD-034 work-item schema names owner', () => {
  test('declares properties.owner as a non-empty string', () => {
    expect(WORK_ITEM_SCHEMA.properties.owner).toMatchObject({ type: 'string', minLength: 1 });
  });

  test('an empty owner is schema-invalid', () => {
    expect(validate({ id: 'x', owner: '' })).toBe(false);
  });
});

describe('TRD-034 tracker.show owner and in-progress reading (AC-004-2, AC-008-2)', () => {
  const parse = MANIFEST.capabilities['tracker.show'].parse;

  test('a claimed item reads back owner and in_progress, schema-valid', () => {
    const item = mapOutput(SHOW, parse);
    expect(item.owner).toBe('bot:probe');
    expect(item.status).toBe('in_progress');
    expect(validate(item)).toBe(true);
  });

  test('an unowned open item has no owner and reads open', () => {
    const item = mapOutput(edit(SHOW, (d) => { delete d.issue.owner; }), parse);
    expect('owner' in item).toBe(false);
    expect(item.status).toBe('open');
    expect(validate(item)).toBe(true);
  });

  test('a null owner is treated as unowned', () => {
    const owner = null;
    const item = mapOutput(edit(SHOW, (d) => { d.issue.owner = owner; }), parse);
    expect('owner' in item).toBe(false);
    expect(item.status).toBe('open');
  });

  test('a closed item stays closed even when it still carries an owner', () => {
    const item = mapOutput(edit(SHOW, (d) => { d.issue.status = 'closed'; }), parse);
    expect(item.status).toBe('closed');
    expect(item.owner).toBe('bot:probe');
    expect(validate(item)).toBe(true);
  });
});

describe('TRD-034 tracker.set-status reports the same owner as show', () => {
  const parse = MANIFEST.capabilities['tracker.set-status'].parse;

  test('declares a parse block', () => {
    expect(parse).toBeDefined();
  });

  test('claim envelope: owner equals show owner, in_progress, id is the short id', () => {
    const shown = mapOutput(SHOW, MANIFEST.capabilities['tracker.show'].parse);
    const out = mapOutput(STATUS, parse);
    expect(out.id).toBe('jfh4');
    expect(out.owner).toBe(shown.owner);
    expect(out.status).toBe('in_progress');
    expect(validate(out)).toBe(true);
  });

  test('unassign envelope: open and no owner', () => {
    const out = mapOutput(edit(STATUS, (d) => { delete d.owner; }), parse);
    expect(out.id).toBe('jfh4');
    expect('owner' in out).toBe(false);
    expect(out.status).toBe('open');
    expect(validate(out)).toBe(true);
  });

  test('unassign envelope with null owner is also open and unowned', () => {
    const out = mapOutput(edit(STATUS, (d) => { d.owner = null; }), parse);
    expect('owner' in out).toBe(false);
    expect(out.status).toBe('open');
  });
});

describe('TRD-034 mapOutput inProgressWhen', () => {
  const base = { format: 'json', map: { status: '$.s' }, statusMap: { open: 'open', closed: 'closed' } };

  test.each([[5], [true], [{}], [['$.o']]])('non-string %j is BAD_OUTPUT', (bad) => {
    expect(() => mapOutput('{"s":"open","o":"x"}', { ...base, inProgressWhen: bad })).toThrow(
      expect.objectContaining({ code: 'BAD_OUTPUT' })
    );
  });

  test('absent path leaves open; present non-empty string flips open only', () => {
    const p = { ...base, inProgressWhen: '$.o' };
    expect(mapOutput('{"s":"open"}', p).status).toBe('open');
    expect(mapOutput('{"s":"open","o":"x"}', p).status).toBe('in_progress');
    expect(mapOutput('{"s":"closed","o":"x"}', p).status).toBe('closed');
  });
});
