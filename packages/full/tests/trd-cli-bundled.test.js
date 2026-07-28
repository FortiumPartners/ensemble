const fs = require('fs');
const path = require('path');
describe('ensemble-full bundled development CLIs', () => {
  test('bundles trd-cli and its helper modules for installed command runtime', () => {
    const libDir = path.join(__dirname, '..', 'lib');
    for (const file of [
      'trd-cli.js',
      'trd-parser.js',
      'scaffold-planner.js',
      'phase-tracker.js',
      'pr-strategy.js',
      'workstream-planner.js',
      'cross-trd-deps.js',
      'workstream-status.js',
      'workstream-trd.js',
      'beads-refine-cli.js',
      'beads-scope.js',
      'beads-findings.js',
      'beads-repair-plan.js',
      'beads-repair-verify.js',
      'prd-parser.js',
    ]) {
      expect(fs.existsSync(path.join(libDir, file))).toBe(true);
    }
    expect(() => require('../lib/trd-cli')).not.toThrow();
  });
});

describe('prd-parser', () => {
  const { extractPrdContext } = require('../lib/prd-parser');

  test('extracts REQ and AC entries', () => {
    const prd = [
      '## REQ-001 — HTTP command ingress',
      'Some requirement text.',
      '**AC-001-1:** Given a POST, when it is sent, then response arrives.',
    ].join('\n');
    const ctx = extractPrdContext(prd);
    expect(ctx.requirements['REQ-001']).toBeDefined();
    expect(ctx.acs['AC-001-1']).toBeDefined();
    expect(ctx.acs['AC-001-1'].given).toBe('a POST');
    expect(ctx.acs['AC-001-1'].when).toBe('it is sent');
    expect(ctx.acs['AC-001-1'].then).toBe('response arrives');
  });

  test('returns empty map for empty input', () => {
    const ctx = extractPrdContext('');
    expect(ctx.requirements).toEqual({});
    expect(ctx.acs).toEqual({});
  });
});

describe('trd-parser — architectureDecision and keyTechnicalDecisions', () => {
  const { parseTRD } = require('../lib/trd-parser');

  test('extracts architectureDecision prose', () => {
    const trd = [
      '---',
      'status: Draft',
      '---',
      '# My TRD',
      '',
      '## 1. Architecture Decision',
      '',
      'Chosen Approach: Option B',
      'because it is simpler.',
      '',
      '### Key Technical Decisions',
      '',
      '1. First decision.',
      '',
      '## Master Task List',
      '',
      '- [ ] **TRD-001**: A task',
    ].join('\n');
    const result = parseTRD(trd);
    expect(result.architectureDecision).toContain('Chosen Approach');
    expect(result.architectureDecision).toContain('because it is simpler');
  });

  test('extracts keyTechnicalDecisions entries', () => {
    const trd = [
      '---',
      'status: Draft',
      '---',
      '# My TRD',
      '',
      '## 1. Architecture Decision',
      '',
      '### Key Technical Decisions',
      '',
      '1. First decision.',
      '',
      '2. Second decision.',
      '',
      '---',
      '',
      '## Master Task List',
      '',
      '- [ ] **TRD-001**: A task',
    ].join('\n');
    const result = parseTRD(trd);
    expect(Array.isArray(result.keyTechnicalDecisions)).toBe(true);
    expect(result.keyTechnicalDecisions.length).toBe(2);
    expect(result.keyTechnicalDecisions[0]).toContain('1. First decision');
    expect(result.keyTechnicalDecisions[1]).toContain('2. Second decision');
  });

  test('### Later Subsection does not bleed into keyTechnicalDecisions', () => {
    const trd = [
      '---',
      'status: Draft',
      '---',
      '# My TRD',
      '',
      '## 1. Architecture Decision',
      '',
      '### Key Technical Decisions',
      '',
      '1. First decision.',
      '',
      '2. Second decision.',
      '',
      '### Later Subsection',
      '',
      'This text should not appear in any decision entry.',
      '',
      '---',
      '',
      '## Master Task List',
      '',
      '- [ ] **TRD-001**: A task',
    ].join('\n');
    const result = parseTRD(trd);
    expect(result.keyTechnicalDecisions.length).toBe(2);
    result.keyTechnicalDecisions.forEach((d) => {
      expect(d).not.toContain('Later Subsection');
    });
  });

  test('returns null / [] when Architecture Decision section is absent', () => {
    const trd = [
      '---',
      'status: Draft',
      '---',
      '# Minimal TRD',
      '',
      '## Master Task List',
      '',
      '- [ ] **TRD-001**: A task',
    ].join('\n');
    const result = parseTRD(trd);
    expect(result.architectureDecision).toBeNull();
    expect(result.keyTechnicalDecisions).toEqual([]);
  });

  test('unnumbered ## Architecture Decision heading matches', () => {
    const trd = [
      '---',
      'status: Draft',
      '---',
      '# My TRD',
      '',
      '## Architecture Decision',
      '',
      'No numbered prefix here.',
      '',
      '### Key Technical Decisions',
      '',
      '1. EventCodec dual-read path.',
      '',
      '## Master Task List',
      '',
      '- [ ] **TRD-001**: A task',
    ].join('\n');
    const result = parseTRD(trd);
    expect(result.architectureDecision).toContain('No numbered prefix here');
    expect(result.keyTechnicalDecisions[0]).toContain('EventCodec dual-read path');
  });
});

describe('scaffold-planner — TRD Context in task descriptions', () => {
  const { buildScaffoldPlan } = require('../lib/scaffold-planner');

  const OPTS = {
    trdSlug: 'test-trd',
    trdFilePath: '/tmp/test-trd.md',
    prdFilePath: '/tmp/test-prd.md',
    prdContext: null,
  };

  function makeParsed(extra = {}) {
    return {
      title: 'Test TRD',
      summary: 'A test.',
      prdReference: null,
      architectureDecision: 'Chosen Approach: Option B\nbecause it is simpler.',
      keyTechnicalDecisions: ['1. EventCodec dual-read path.', '2. Versioned envelope.'],
      prFormat: false,
      phases: [{ n: 1, title: 'Implementation', shippableState: null, taskIds: ['TRD-001'] }],
      tasksById: {
        'TRD-001': {
          id: 'TRD-001',
          description: 'Implement X',
          satisfies: [],
          actions: ['Do the thing'],
          implementationAc: [],
          dependsOn: [],
          phaseN: 1,
          isTest: false,
          targetFiles: [],
          nestedSubitems: [],
          testSubitems: [],
        },
      },
      ...extra,
    };
  }

  test('impl task emits --- TRD Context --- with architecture decision prose', () => {
    const plan = buildScaffoldPlan(makeParsed(), OPTS);
    const t = plan.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('--- TRD Context ---');
    expect(t.description).toContain('Chosen Approach');
    expect(t.description).toContain('because it is simpler');
  });

  test('impl task emits --- TRD Context --- from keyTechnicalDecisions alone', () => {
    const plan = buildScaffoldPlan(makeParsed({ architectureDecision: null }), OPTS);
    const t = plan.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).toContain('--- TRD Context ---');
    expect(t.description).toContain('**Key Technical Decisions:**');
    expect(t.description).not.toContain('Rationale:');
  });

  test('omits --- TRD Context --- when both fields are absent', () => {
    const plan = buildScaffoldPlan(
      makeParsed({ architectureDecision: null, keyTechnicalDecisions: [] }),
      OPTS
    );
    const t = plan.tasks.find((x) => x.id === 'TRD-001');
    expect(t.description).not.toContain('--- TRD Context ---');
  });
});
