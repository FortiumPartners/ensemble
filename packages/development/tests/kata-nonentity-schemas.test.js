'use strict';

/**
 * TRD-033 -- normalized schema entries for the non-entity kata capabilities
 * (PRD REQ-008 AC-008-1). Runs recorded kata envelopes through the runner's real
 * mapAndValidateOutput (mapping + normalized-schema gate).
 *
 * RUNNER_PATH may override the runner under test (RED demonstration against a mutated copy).
 */

const fs = require('fs');
const path = require('path');

const RUNNER_PATH = process.env.RUNNER_PATH || path.join(__dirname, '..', 'lib', 'toolchain', 'runner.js');
const { mapAndValidateOutput, CAPABILITY_NORMALIZED_SCHEMA } = require(RUNNER_PATH);

const FIX = path.join(__dirname, '..', '..', '..', 'scripts', 'tests', 'fixtures', 'toolchain', 'adapter-tracker-kata-samples');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

const LIST_PARSE = {
  format: 'json',
  root: '$',
  map: {},
  arrayMap: {
    items: {
      source: '$.issues',
      item: { id: '$.short_id', title: '$.title', status: '$.status', labels: { path: '$.labels', default: [] } }
    }
  }
};
const LABEL_PARSE = {
  format: 'json',
  root: '$',
  map: { id: '$.issue.short_id', label: '$.label.label' }
};
const cap = (parse) => ({ parse });

describe('TRD-033 non-entity kata capability schemas', () => {
  test('tracker.find-by-key validates against a list schema, not work-item', () => {
    expect(CAPABILITY_NORMALIZED_SCHEMA['tracker.find-by-key']).toBe('work-item-list.json');
    const r = mapAndValidateOutput('kata', 'tracker.find-by-key', cap(LIST_PARSE), read('kata-find-by-key.sample.json'));
    expect(r.envelope).toBeUndefined();
    expect(Array.isArray(r.data.items)).toBe(true);
    expect(r.data.items.length).toBe(3);
  });

  test.each(['tracker.label', 'tracker.label-one'])('%s is not rejected BAD_OUTPUT for lacking entity fields', (c) => {
    expect(CAPABILITY_NORMALIZED_SCHEMA[c]).toBe('label-result.json');
    const r = mapAndValidateOutput('kata', c, cap(LABEL_PARSE), read('kata-label-add.sample.json'));
    expect(r.envelope).toBeUndefined();
    expect(r.data).toEqual({ id: 'csjm', label: 'blocked' });
  });

  test('label result schema still rejects a result with no id', () => {
    const r = mapAndValidateOutput('kata', 'tracker.label-one', cap({ format: 'json', root: '$', map: { label: '$.label.label' } }), read('kata-label-add.sample.json'));
    expect(r.envelope && r.envelope.error.code).toBe('BAD_OUTPUT');
  });
});
