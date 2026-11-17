'use strict';

/**
 * A `*` key in a variants map is the catch-all for open-ended selector values (a label, a
 * scope) that cannot be enumerated. A literal key still wins, an absent selector keeps the base
 * template, and the substituted value goes through the same INVALID_ARG guard as any
 * placeholder. The beads adapter uses it so work-graph.plan/ready can plan one label's subgraph
 * instead of a repo-wide plan whose first track can belong to another TRD.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { buildArgv } = require('../lib/toolchain/runner.js');

const BASE = ['bv', '--robot-plan', '--format', 'json'];
const VARIANTS = {
  scope: { '*': ['bv', '--robot-plan', '--label', '{scope}', '--format', 'json'] },
};

describe('buildArgv `*` catch-all variant', () => {
  test('substitutes an arbitrary selector value through the catch-all template', () => {
    expect(buildArgv(BASE, { scope: 'trd-x' }, { variants: VARIANTS, inputs: {} })).toEqual([
      'bv', '--robot-plan', '--label', 'trd-x', '--format', 'json',
    ]);
  });

  test('keeps the base template when the selector is absent', () => {
    expect(buildArgv(BASE, {}, { variants: VARIANTS, inputs: {} })).toEqual(BASE);
  });

  test('a literal key wins over the catch-all', () => {
    const variants = { scope: { all: ['bv', '--robot-plan'], '*': VARIANTS.scope['*'] } };
    expect(buildArgv(BASE, { scope: 'all' }, { variants, inputs: {} })).toEqual(['bv', '--robot-plan']);
  });

  test('rejects a selector value that looks like a flag', () => {
    expect(() => buildArgv(BASE, { scope: '--evil' }, { variants: VARIANTS, inputs: {} })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARG' })
    );
  });

  test('a variants map without `*` still rejects an unlisted value as NOT_ALLOWED', () => {
    const variants = { scope: { open: ['x'] } };
    expect(() => buildArgv(BASE, { scope: 'nope' }, { variants, inputs: {} })).toThrow(
      expect.objectContaining({ code: 'NOT_ALLOWED' })
    );
  });
});

describe('beads adapter work-graph scoping', () => {
  const adapter = yaml.load(
    fs.readFileSync(path.join(__dirname, '../skills/adapter-tracker-beads/adapter.yaml'), 'utf8')
  );

  test.each(['work-graph.ready', 'work-graph.plan'])('%s plans one label when scope is supplied', (cap) => {
    const entry = adapter.capabilities ? adapter.capabilities[cap] : adapter[cap];
    expect(entry.variants.scope['*']).toEqual([
      'bv', '--robot-plan', '--label', '${scope}', '--format', 'json',
    ]);
    expect(entry.run).toEqual(BASE);
  });
});
