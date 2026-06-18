'use strict';

const { parseQualifiedRef, resolveCrossTrdDeps } = require('../lib/cross-trd-deps');

describe('cross-trd-deps', () => {
  test('parses supported source-qualified refs', () => {
    expect(parseQualifiedRef('alpha#TRD-001')).toMatchObject({ ok: true, kind: 'task', trdSlug: 'alpha', id: 'TRD-001' });
    expect(parseQualifiedRef('beta#PR-2')).toMatchObject({ ok: true, kind: 'pr', trdSlug: 'beta', n: 2 });
    expect(parseQualifiedRef('TRD-001')).toMatchObject({ ok: false });
  });

  test('resolves cross-TRD task and PR references to title-prefix edges', () => {
    const plans = [
      {
        slug: 'alpha', trdPath: 'alpha.md', plan: {
          stories: [{ phaseN: 1, titlePrefix: '[trd:alpha:pr:1]' }],
          synthesizedTests: [],
          tasks: [{ id: 'TRD-001', titlePrefix: '[trd:alpha:task:TRD-001]', dependsOn: ['beta#TRD-002', 'beta#PR-1'] }],
        },
      },
      {
        slug: 'beta', trdPath: 'beta.md', plan: {
          stories: [{ phaseN: 1, titlePrefix: '[trd:beta:pr:1]' }],
          synthesizedTests: [],
          tasks: [{ id: 'TRD-002', titlePrefix: '[trd:beta:task:TRD-002]', dependsOn: [] }],
        },
      },
    ];
    const result = resolveCrossTrdDeps(plans);
    expect(result.ok).toBe(true);
    expect(result.edges).toHaveLength(2);
    expect(result.edges[0]).toMatchObject({ blockerId: '[trd:beta:task:TRD-002]', blockedId: '[trd:alpha:task:TRD-001]' });
    expect(result.edges[1]).toMatchObject({ blockerId: '[trd:beta:pr:1]' });
  });

  test('reports ambiguous or missing refs instead of guessing', () => {
    const result = resolveCrossTrdDeps([{ slug: 'alpha', trdPath: 'a.md', plan: { stories: [], tasks: [{ id: 'TRD-001', titlePrefix: '[trd:alpha:task:TRD-001]', dependsOn: ['missing#TRD-999'] }], synthesizedTests: [] } }]);
    expect(result.ok).toBe(false);
    expect(result.errors[0].reason).toMatch(/Unknown TRD slug/);
  });
});
