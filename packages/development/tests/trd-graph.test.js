'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');


const {
  buildRegistry,
  buildGraph,
  detectCycles,
  findOverlaps,
  findCapabilityProviders,
  emitJson,
  emitMermaid,
  emitDot,
} = require('../lib/trd-graph');
const { main: runTrdGraphCli } = require('../lib/trd-graph-cli');


// --- Fixture TRDs (in-memory) -------------------------------------------------
// alpha: foundational domain work, no deps.
// beta:  depends on alpha (cross-TRD ref) and shares a target file with gamma.
// gamma: depends on alpha; overlaps beta on src/Order.cs.

function trd({ id, label, kind, prd, tasks, capabilities }) {
  const lines = [
    '---',
    `document_id: ${id}`,
    label ? `label: ${label}` : '',
    kind ? `kind: ${kind}` : '',
    capabilities ? `capabilities: ${capabilities.join(', ')}` : '',
    `prd_reference: ${prd}`,
    '---',
    `# ${id}: ${label || id}`,
    '',
    '## Master Task List',
    '',
    '### PR 1: Work',
    '**Shippable State:** Something shippable happens.',
    '',
    ...tasks,
  ];
  return lines.filter((l) => l !== '').join('\n') + '\n';
}
function runCli(argv) {
  const stdout = [];
  const stderr = [];
  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;
  process.stdout.write = (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  try {
    return {
      code: runTrdGraphCli(argv),
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
}

function inTempCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-graph-cli-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    return fn(dir);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}


const ALPHA = trd({
  id: 'TRD-2026-aaaaaaaa',
  label: 'trd-order-domain',
  kind: 'foundational',
  capabilities: ['order-domain', 'money-value-object'],
  prd: 'docs/PRD/PRD-2026-aaaaaaaa-order.md',
  tasks: [
    '- [ ] **TRD-001**: Create Order domain object (3h) [satisfies REQ-001]',
    '  - Target Files: src/Order.cs',
  ],
});

const BETA = trd({
  id: 'TRD-2026-bbbbbbbb',
  label: 'trd-checkout',
  prd: 'docs/PRD/PRD-2026-bbbbbbbb-checkout.md',
  tasks: [
    '- [ ] **TRD-001**: Wire checkout to Order (2h) [satisfies REQ-002] [depends: trd-2026-aaaaaaaa-order#TRD-001]',
    '  - Target Files: src/Order.cs, src/Checkout.cs',
  ],
});

const GAMMA = trd({
  id: 'TRD-2026-cccccccc',
  label: 'trd-returns',
  prd: 'docs/PRD/PRD-2026-cccccccc-returns.md',
  tasks: [
    '- [ ] **TRD-001**: Returns against Order (2h) [satisfies REQ-003] [depends: trd-2026-aaaaaaaa-order#TRD-001]',
    '  - Target Files: src/Order.cs, src/Returns.cs',
  ],
});

const ENTRIES = [
  { path: 'docs/TRD/TRD-2026-aaaaaaaa-order.md', markdown: ALPHA },
  { path: 'docs/TRD/TRD-2026-bbbbbbbb-checkout.md', markdown: BETA },
  { path: 'docs/TRD/TRD-2026-cccccccc-returns.md', markdown: GAMMA },
];

describe('buildRegistry', () => {
  const reg = buildRegistry(ENTRIES);

  test('keys nodes on the (unique) slug, carrying document_id as an attribute', () => {
    expect(reg.nodes).toHaveLength(3);
    const alpha = reg.bySlug.get('trd-2026-aaaaaaaa-order');
    expect(alpha.id).toBe('trd-2026-aaaaaaaa-order'); // id === slug
    expect(alpha.documentId).toBe('TRD-2026-aaaaaaaa');
    expect(alpha.label).toBe('trd-order-domain');
    expect(alpha.kind).toBe('foundational');
  });

  test('flags duplicate document_ids (legacy numbering collision) as a warning', () => {
    const dup = buildRegistry([
      { path: 'docs/TRD/TRD-2026-023-one.md', markdown: '---\ndocument_id: TRD-2026-023\n---\n# TRD-2026-023: One\n## Master Task List\n### PR 1: x\n**Shippable State:** y.\n- [ ] **TRD-001**: t\n' },
      { path: 'docs/TRD/TRD-2026-023-two.md', markdown: '---\ndocument_id: TRD-2026-023\n---\n# TRD-2026-023: Two\n## Master Task List\n### PR 1: x\n**Shippable State:** y.\n- [ ] **TRD-001**: t\n' },
    ]);
    expect(dup.nodes).toHaveLength(2); // both kept (unique slugs)
    expect(dup.warnings.join(' ')).toMatch(/duplicate document_id.*TRD-2026-023/i);
  });

  test('derives a display label when none is authored', () => {
    const noLabel = buildRegistry([
      { path: 'docs/TRD/TRD-2026-dddddddd-thing.md', markdown: '---\ndocument_id: TRD-2026-dddddddd\n---\n# TRD-2026-dddddddd: Cool Thing\n## Master Task List\n### PR 1: x\n**Shippable State:** y.\n- [ ] **TRD-001**: t\n' },
    ]);
    expect(noLabel.nodes[0].label).toBe('trd-cool-thing');
  });
});

describe('buildGraph', () => {
  const graph = buildGraph(buildRegistry(ENTRIES));

  test('creates one edge per cross-TRD dependency (slug-keyed)', () => {
    const edgePairs = graph.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edgePairs).toEqual([
      'trd-2026-bbbbbbbb-checkout->trd-2026-aaaaaaaa-order',
      'trd-2026-cccccccc-returns->trd-2026-aaaaaaaa-order',
    ]);
  });

  test('ignores intra-TRD deps (bare TRD-NNN) and records dangling refs', () => {
    const g = buildGraph(
      buildRegistry([
        { path: 'docs/TRD/TRD-2026-eeeeeeee-x.md', markdown: trd({ id: 'TRD-2026-eeeeeeee', label: 'trd-x', prd: 'p.md', tasks: ['- [ ] **TRD-002**: y [depends: TRD-001, ghost-slug#TRD-001]'] }) },
      ])
    );
    expect(g.edges).toHaveLength(0); // bare TRD-001 is intra-TRD; ghost-slug unresolved
    expect(g.warnings.join(' ')).toMatch(/ghost-slug#TRD-001/);
  });

  test('warns and skips cross-TRD task refs whose target slug exists but task id is absent', () => {
    const g = buildGraph(
      buildRegistry([
        { path: 'docs/TRD/TRD-2026-aaaaaaaa-target.md', markdown: trd({ id: 'TRD-2026-aaaaaaaa', label: 'trd-target', prd: 'p.md', tasks: ['- [ ] **TRD-001**: target task'] }) },
        { path: 'docs/TRD/TRD-2026-bbbbbbbb-source.md', markdown: trd({ id: 'TRD-2026-bbbbbbbb', label: 'trd-source', prd: 'p.md', tasks: ['- [ ] **TRD-001**: source task [depends: trd-2026-aaaaaaaa-target#TRD-999]'] }) },
      ])
    );

    expect(g.edges).toEqual([]);
    expect(g.warnings.join('\n')).toMatch(/trd-2026-aaaaaaaa-target#TRD-999/);
    expect(g.warnings.join('\n')).toMatch(/unknown task 'TRD-999'/);
  });

  test('warns and skips cross-TRD PR refs whose target slug exists but PR number is absent', () => {
    const g = buildGraph(
      buildRegistry([
        { path: 'docs/TRD/TRD-2026-aaaaaaaa-target.md', markdown: trd({ id: 'TRD-2026-aaaaaaaa', label: 'trd-target', prd: 'p.md', tasks: ['- [ ] **TRD-001**: target task'] }) },
        { path: 'docs/TRD/TRD-2026-bbbbbbbb-source.md', markdown: trd({ id: 'TRD-2026-bbbbbbbb', label: 'trd-source', prd: 'p.md', tasks: ['- [ ] **TRD-001**: source task [depends: trd-2026-aaaaaaaa-target#PR-2]'] }) },
      ])
    );

    expect(g.edges).toEqual([]);
    expect(g.warnings.join('\n')).toMatch(/trd-2026-aaaaaaaa-target#PR-2/);
    expect(g.warnings.join('\n')).toMatch(/unknown PR 'PR-2'/);
  });

  test('no cycles in the fixture graph', () => {
    expect(graph.cycles).toEqual([]);
  });
});

describe('detectCycles', () => {
  test('finds a simple A->B->A cycle', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }];
    const edges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ];
    expect(detectCycles(nodes, edges).length).toBeGreaterThan(0);
  });
});

describe('findOverlaps', () => {
  test('flags TRD pairs that touch the same target files', () => {
    const overlaps = findOverlaps(buildRegistry(ENTRIES));
    // beta & gamma both touch src/Order.cs; alpha also touches it.
    const pair = overlaps.find(
      (o) =>
        [o.a.id, o.b.id].includes('trd-2026-bbbbbbbb-checkout') &&
        [o.a.id, o.b.id].includes('trd-2026-cccccccc-returns')
    );
    expect(pair).toBeTruthy();
    expect(pair.sharedFiles).toContain('src/Order.cs');
  });
});

describe('findCapabilityProviders', () => {
  const providers = findCapabilityProviders(buildRegistry(ENTRIES));

  test('lists each capability with its providing foundational TRD', () => {
    const order = providers.find((p) => p.capability === 'order-domain');
    expect(order).toBeTruthy();
    expect(order.providers[0].slug).toBe('trd-2026-aaaaaaaa-order');
    expect(order.providers[0].kind).toBe('foundational');
    expect(providers.map((p) => p.capability)).toContain('money-value-object');
  });

  test('is empty when no TRD declares capabilities', () => {
    const none = findCapabilityProviders(
      buildRegistry([{ path: 'docs/TRD/TRD-2026-zzzzzzzz-x.md', markdown: trd({ id: 'TRD-2026-zzzzzzzz', label: 'trd-x', prd: 'p.md', tasks: ['- [ ] **TRD-001**: t'] }) }])
    );
    expect(none).toEqual([]);
  });
});

describe('emitters', () => {
  const graph = buildGraph(buildRegistry(ENTRIES));

  test('emitJson is stable and shaped', () => {
    const j = JSON.parse(emitJson(graph));
    expect(j.nodes.length).toBe(3);
    expect(j.edges.length).toBe(2);
  });

  test('emitMermaid renders nodes by label and directed edges', () => {
    const m = emitMermaid(graph);
    expect(m).toMatch(/^graph TD/m);
    expect(m).toContain('trd-order-domain');
    expect(m).toContain('-->');
  });

  test('emitDot renders a digraph', () => {
    const d = emitDot(graph);
    expect(d).toMatch(/^digraph/m);
    expect(d).toContain('->');
  });
});

describe('trd-graph-cli empty registry discovery', () => {
  test('empty cwd returns empty graph, capabilities, and overlap results without errors', () => {
    inTempCwd(() => {
      const graph = runCli(['graph']);
      expect(graph.code).toBe(0);
      expect(graph.stderr).toBe('');
      expect(JSON.parse(graph.stdout)).toMatchObject({
        nodes: [],
        edges: [],
        cycles: [],
        warnings: [],
      });

      const capabilities = runCli(['capabilities', '--json']);
      expect(capabilities.code).toBe(0);
      expect(capabilities.stderr).toBe('');
      expect(JSON.parse(capabilities.stdout)).toEqual({ capabilities: [] });

      const overlap = runCli(['overlap', '--json']);
      expect(overlap.code).toBe(0);
      expect(overlap.stderr).toBe('');
      expect(JSON.parse(overlap.stdout)).toEqual({ overlaps: [] });
    });
  });
});
