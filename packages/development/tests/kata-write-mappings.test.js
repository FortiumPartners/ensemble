'use strict';

/**
 * TRD-009-TEST -- kata create/update mappings (TRD-2026-6995dc96 TRD-009; PRD AC-001-4).
 *
 *  - tracker.create returns the new item's short id as the `id` output.
 *  - tracker.update runs `kata edit <id> --body <fields> --json` and returns the id (it used to
 *    declare no parse block, so no `id` output at all, against the contract's outputs: [id]).
 *  - The contract's single opaque `fields` input can only name one kata field (the body); title,
 *    priority and owner cannot be expressed by `update`. Title and priority live in
 *    `update-detailed`, whose contract has no `owner` input, so owner is a documented limit.
 *
 * The edit/create envelopes are the mutation shape recorded in adapter.yaml
 * (`{kata_api_version, issue, event, ...}`, id at `.issue.short_id`); no daemon is started here.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const { mapOutput } = require('../lib/toolchain/mapping');
const { buildArgv } = require('../lib/toolchain/runner');

const DEV_ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(DEV_ROOT, ...p), 'utf8');
const MANIFEST = yaml.load(read('skills', 'adapter-tracker-kata', 'adapter.yaml'));
const CONTRACT = yaml.load(read('toolchain', 'categories', 'tracker.yaml'));
const SKILL = read('skills', 'adapter-tracker-kata', 'SKILL.md');
const validate = new Ajv({ allErrors: true, strict: false }).compile(
  JSON.parse(read('toolchain', 'schemas', 'normalized', 'work-item.json'))
);

const argvFor = (cap, args) =>
  buildArgv(cap.run.map((x) => x.replace(/\$\{/g, '{')), args, { inputs: {}, variants: {} });

const ENVELOPE = JSON.stringify({
  kata_api_version: 1,
  issue: { short_id: 'ab3d', id: 7, title: 'T', body: 'B', status: 'open', priority: 2, owner: 'bot:x' },
  event: {},
  events: [],
  changed: true,
  changes: [],
});

describe('TRD-009 tracker.create', () => {
  const cap = MANIFEST.capabilities['tracker.create'];

  test('returns the short id as the id output, schema-valid', () => {
    const out = mapOutput(ENVELOPE, cap.parse);
    expect(out.id).toBe('ab3d');
    expect(validate(out)).toBe(true);
  });

  test('argv carries title and description; type is not sent (kata has no type field)', () => {
    const argv = argvFor(cap, { title: 'a title', description: 'a body', type: 'bug' });
    expect(argv).toEqual(['kata', 'create', 'a title', '--body', 'a body', '--json']);
    expect(cap.run.join(' ')).not.toMatch(/type/);
  });
});

describe('TRD-009 tracker.update', () => {
  const cap = MANIFEST.capabilities['tracker.update'];

  test('declares a parse block that returns the id', () => {
    expect(cap.parse).toBeDefined();
    const out = mapOutput(ENVELOPE, cap.parse);
    expect(out.id).toBe('ab3d');
    expect(validate(out)).toBe(true);
  });

  test('argv is kata edit <id> --body <fields> --json', () => {
    expect(argvFor(cap, { id: 'ab3d', fields: 'new body' })).toEqual(
      ['kata', 'edit', 'ab3d', '--body', 'new body', '--json']
    );
  });

  test('every placeholder is a contract input and the contract output is produced', () => {
    const c = CONTRACT.capabilities
      ? CONTRACT.capabilities['tracker.update']
      : CONTRACT['tracker.update'];
    const used = [...cap.run.join(' ').matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
    used.forEach((u) => expect(c.inputs).toContain(u));
    expect(Object.keys(cap.parse.map)).toEqual(expect.arrayContaining(c.outputs));
  });
});

describe('TRD-009 title, priority and owner coverage', () => {
  test('update-detailed carries title, body and priority (title/priority via kata edit)', () => {
    const run = MANIFEST.capabilities['tracker.update-detailed'].run.join(' ');
    expect(run).toMatch(/--title/);
    expect(run).toMatch(/--body/);
    expect(run).toMatch(/--priority/);
  });

  test('owner is not expressible: no contract input exists for it, and the limit is documented', () => {
    const c = CONTRACT.capabilities ? CONTRACT.capabilities : CONTRACT;
    expect(c['tracker.update-detailed'].inputs).not.toContain('owner');
    expect(MANIFEST.capabilities['tracker.update-detailed'].run.join(' ')).not.toMatch(/--owner/);
    expect(SKILL).toMatch(/owner/i);
    expect(SKILL).toMatch(/`update` writes only the body/);
    expect(SKILL).toMatch(/`create` sends no `type`/);
  });
});
