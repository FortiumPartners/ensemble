'use strict';

const { summarizeWorkstream, formatWorkstreamStatus } = require('../lib/workstream-status');

describe('workstream-status', () => {
  test('summarizes release train and per-TRD task progress', () => {
    const issues = [
      { id: 'rt', title: '[release-train:demo] Combined Workstream', status: 'open' },
      { id: 'a1', title: '[trd:alpha:task:TRD-001] Build A', status: 'closed' },
      { id: 'a2', title: '[trd:alpha:task:TRD-002] Build B', status: 'open', dependencies: [{ depends_on_id: 'a1' }] },
      { id: 'b1', title: '[trd:beta:task:TRD-001] Build C', status: 'in_progress' },
    ];
    const summary = summarizeWorkstream(issues, { workstreamSlug: 'demo' });
    expect(summary.aggregate).toMatchObject({ total: 3, closed: 1, blocked: 1, in_progress: 1 });
    expect(summary.trds.map((t) => t.slug)).toEqual(['alpha', 'beta']);
    expect(formatWorkstreamStatus(summary)).toContain('COMBINED WORKSTREAM STATUS');
  });
});
