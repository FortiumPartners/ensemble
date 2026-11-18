'use strict';

/**
 * TRD-034-TEST -- `owner` is a declared field of the normalized work item
 * (TRD-2026-6995dc96 TRD-034; PRD REQ-004 AC-004-2, REQ-008 AC-008-2).
 *
 * SCHEMA_PATH may override the schema under test (used only to demonstrate RED against a copy
 * with `owner` removed); it defaults to the real work-item.json.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const DEFAULT_SCHEMA = path.join(
  __dirname, '..', 'toolchain', 'schemas', 'normalized', 'work-item.json'
);
const SCHEMA_PATH = process.env.SCHEMA_PATH || DEFAULT_SCHEMA;
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(SCHEMA);

const item = (extra) => ({
  id: 'br-1',
  title: 'T',
  description: 'D',
  type: 'task',
  status: 'in_progress',
  priority: '2',
  labels: ['a'],
  ...extra,
});

describe('TRD-034 normalized work item: owner', () => {
  test('happy: item carrying an owner validates and owner is a declared, typed property', () => {
    expect(validate(item({ owner: 'alice' }))).toBe(true);
    expect(SCHEMA.properties).toHaveProperty('owner');
    expect(SCHEMA.properties.owner.type).toBe('string');

    // Rejections prove owner is typed, not passthrough via additionalProperties.
    expect(validate(item({ owner: '' }))).toBe(false);
    expect(validate(item({ owner: 123 }))).toBe(false);
    const paths = (validate.errors || []).map((e) => e.instancePath);
    expect(paths).toContain('/owner');
  });

  test('edge: item with no owner property validates (absence is not an error)', () => {
    const doc = item({});
    expect('owner' in doc).toBe(false);
    expect(validate(doc)).toBe(true);
    expect(validate({ id: 'br-2' })).toBe(true);
  });

  test('edge: schema file lists owner under properties, not solely additionalProperties', () => {
    const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    expect(Object.keys(raw.properties)).toContain('owner');
    expect(raw.additionalProperties).toBe(true);
    expect(raw.required).not.toContain('owner');
  });
});
