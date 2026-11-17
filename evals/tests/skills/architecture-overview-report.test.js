'use strict';

/** Proof that the architecture-overview-report checks pass on a good overview and fail on plausible wrong ones (skill eval kit). */

const kit = require('../skill-eval-kit');

const ID = 'architecture-overview-report';
const OUT = 'docs/assessment/architecture-overview-2026-03-12.md';
const IDS = [
  'overview-saved', 'sources-listed', 'mermaid-wellformed', 'context-edges', 'isolated-not-merged', 'lower-confidence-marked',
  'diagram-grounded', 'platform-diagram', 'integration-table', 'risks-ranked', 'only-assessment-docs',
];

const CONTEXT = `\`\`\`mermaid
graph TB
  subgraph Acme[Acme platform]
    CON[acme-console]
    BFF[acme-bff]
    CTR[acme-contracts]
  end
  KC[Keycloak]
  CON -->|HTTPS 8080| BFF
  CON -->|OIDC login| KC
  BFF -->|JWKS fetch| KC
  CON -.->|imports 1.2.0| CTR
  BFF -.->|imports 1.5.0| CTR
  subgraph Billing[Isolated product]
    LB[legacy-billing]
  end
  OPS[ops-inventory]
  OPS -.->|inferred, lower confidence| BFF
\`\`\``;

const LAYERS = `\`\`\`mermaid
graph TD
  C[OrdersController] --> S[OrdersService]
  S --> R[OrdersRepository]
  R --> DB[(Postgres 5432)]
\`\`\``;

const GOOD = `# Acme Portfolio — Architectural Overview

**Date:** 2026-03-12
**Sources:** acme-console-2026-03-12-architecture.md, acme-bff-2026-03-12-architecture.md, acme-contracts-2026-03-12-architecture.md, legacy-billing-2026-03-12-architecture.md, ops-inventory-2026-03-12-architecture.md

Two platforms: the Acme console/BFF platform, and legacy-billing, which is isolated. The ops-inventory edge is inferred from structural signals only (lower confidence). Diagrams were not rendered: no network.

## 1. Portfolio System Context
${CONTEXT}

## 2. Acme BFF — layering
${LAYERS}

## 3. Cross-Cutting Integration Points
| Integration point | Consumers | Evidence | Risk |
|---|---|---|---|
| Keycloak realm | acme-console, acme-bff | src/auth/verify.ts:40 | no cached fallback when JWKS fetch fails |
| acme-contracts schemas | acme-console, acme-bff | .github/workflows/release.yml:1 | no CI gate validates the contract |
| Postgres (bff only) | acme-bff | src/repositories/orders.ts:11 | none documented beyond layering |

## 4. Summary of Architecturally Significant Risks
1. No CI gate validates the acme-contracts schema; both consumers can break silently (section 3, F-001).
2. A single Keycloak realm is a hard dependency of console and bff (F-002).
3. The console pins a stale contracts version (F-003).
4. OrdersService bypasses another module's service layer in acme-bff (F-004, section 2).
5. The acme-bff chart has no readiness probe (F-007).
6. legacy-billing nightly job runs on a single host (F-005).
`;

const SRC = (n) => `docs/assessment/${n}-2026-03-12-architecture.md`;
/** A stub agent that saves `text` as the overview and optionally other files. */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(OUT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => GOOD.replace(from, to);

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good overview passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every check about the overview, and the seeded fixture alone does not pass', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, IDS.filter((i) => i !== 'only-assessment-docs'), /no docs\/assessment\/architecture-overview/, { only: true });
  });

  test('a wrongly named file (no date) fails overview-saved', async () => {
    const res = await kit.runEval(ID, (ws) => ws.write('docs/assessment/architecture-overview.md', GOOD));
    kit.expectFails(res, 'overview-saved', /no docs\/assessment\/architecture-overview/);
  });

  test('a Date line that disagrees with the file name fails overview-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('**Date:** 2026-03-12', '**Date:** 2026-04-01'))), 'overview-saved', /does not match/, { only: true });
  });

  test('a Sources line that omits an input fails sources-listed', async () => {
    const res = await kit.runEval(ID, saves(swap(', ops-inventory-2026-03-12-architecture.md', '')));
    kit.expectFails(res, 'sources-listed', /ops-inventory-2026-03-12-architecture\.md/, { only: true });
  });

  test('a single diagram, or a broken one, fails mermaid-wellformed', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap(LAYERS, ''))), 'mermaid-wellformed', /1 mermaid block/);
    kit.expectFails(await kit.runEval(ID, saves(swap('  end', '').replace('    LB[legacy-billing]\n  end', '    LB[legacy-billing]'))), 'mermaid-wellformed', /subgraph without "end"/);
    kit.expectFails(await kit.runEval(ID, saves(swap('C[OrdersController]', 'C[OrdersController'))), 'mermaid-wellformed', /unbalanced/);
    kit.expectFails(await kit.runEval(ID, saves(swap('graph TB', 'graph TD'))), 'mermaid-wellformed', /not "graph TB"/);
    kit.expectFails(await kit.runEval(ID, saves(swap('graph TD', 'pie'))), 'mermaid-wellformed', /does not start with graph/);
    kit.expectFails(await kit.runEval(ID, saves(`${GOOD}\n\`\`\`mermaid\ngraph TD\n`)), 'mermaid-wellformed', /never closed/);
  }, 60000);

  test('a missing title, or a near-empty or label-poor diagram, fails the structure checks', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('# Acme Portfolio — Architectural Overview', '# Acme Portfolio'))), 'overview-saved', /title/, { only: true });
    const thin = `\`\`\`mermaid\ngraph TD\n  A[One] --> B[Two]\n  C[Three]\n\`\`\``;
    kit.expectFails(await kit.runEval(ID, saves(swap(LAYERS, thin))), 'mermaid-wellformed', /fewer than 2 edges/);
    const nolabel = `\`\`\`mermaid\ngraph TD\n  A --> B\n  B --> C\n\`\`\``;
    kit.expectFails(await kit.runEval(ID, saves(swap(LAYERS, nolabel))), 'mermaid-wellformed', /fewer than 3 labelled/);
  }, 60000);

  test('a context diagram without the documented edges fails context-edges', async () => {
    const res = await kit.runEval(ID, saves(swap('  BFF -->|JWKS fetch| KC\n', '  BFF --> CON\n')));
    kit.expectFails(res, 'context-edges', /bff~keycloak/, { only: true });
  });

  test('an edge from the isolated product to the platform fails isolated-not-merged, and so does never calling it isolated', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('  OPS[ops-inventory]', '  LB --> KC\n  OPS[ops-inventory]'))), 'isolated-not-merged', /isolated product to another platform/);
    kit.expectFails(await kit.runEval(ID, saves(swap('which is isolated', 'which is part of the platform').replace('Isolated product', 'Billing'))), 'isolated-not-merged', /never described/);
  });

  test('a solid unmarked edge for the structural-only repo fails lower-confidence-marked', async () => {
    const res = await kit.runEval(ID, saves(swap('  OPS -.->|inferred, lower confidence| BFF', '  OPS --> BFF')));
    kit.expectFails(res, 'lower-confidence-marked', /solid, unmarked edge/);
  });

  test('prose that never flags the structural-only repo fails lower-confidence-marked', async () => {
    const res = await kit.runEval(ID, saves(swap('The ops-inventory edge is inferred from structural signals only (lower confidence). ', '').replace('  OPS -.->|inferred, lower confidence| BFF', '  OPS -.-> BFF')));
    kit.expectFails(res, 'lower-confidence-marked', /never labelled/);
  });

  test('an invented port fails diagram-grounded', async () => {
    const res = await kit.runEval(ID, saves(swap('HTTPS 8080', 'HTTPS 9443')));
    kit.expectFails(res, 'diagram-grounded', /9443/, { only: true });
  });

  test('no layered diagram fails platform-diagram', async () => {
    const res = await kit.runEval(ID, saves(swap('C[OrdersController] --> S[OrdersService]', 'C[Orders] --> S[Core]')));
    kit.expectFails(res, 'platform-diagram', /layers/, { only: true });
  });

  test('a table missing the contract row, the file:line evidence or a column fails integration-table', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| acme-contracts schemas | acme-console, acme-bff | .github/workflows/release.yml:1 | no CI gate validates the contract |\n', ''))), 'integration-table', /need one per shared dependency|no row/);
    kit.expectFails(await kit.runEval(ID, saves(swap('src/auth/verify.ts:40', 'the verify module'))), 'integration-table', /file:line/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Integration point | Consumers | Evidence | Risk |', '| Integration point | Consumers | Risk |'))), 'integration-table', /header/);
    kit.expectFails(await kit.runEval(ID, saves(swap('acme-console, acme-bff | .github', 'acme-bff | .github'))), 'integration-table', /both consumers/, { only: true });
  }, 60000);

  test('a table with only two rows, an empty cell, or no contracts row fails integration-table', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Postgres (bff only) | acme-bff | src/repositories/orders.ts:11 | none documented beyond layering |\n', ''))), 'integration-table', /2 data row/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| none documented beyond layering |', '|  |'))), 'integration-table', /empty or missing cell/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| acme-contracts schemas |', '| Shared schemas |'))), 'integration-table', /no row for the shared dependency "contracts"/, { only: true });
  }, 60000);

  test('a risk that names nothing from the sources fails risks-ranked', async () => {
    const vague = swap('5. The acme-bff chart has no readiness probe (F-007).', '5. Operational maturity is generally low.');
    kit.expectFails(await kit.runEval(ID, saves(vague)), 'risks-ranked', /names no repo/, { only: true });
  }, 60000);

  test('too few risks, or the billing risk ranked above the contract risk, fails risks-ranked', async () => {
    const few = GOOD.replace(/\n4\. OrdersService[^\n]*\n5\. [^\n]*\n6\. [^\n]*/, '');
    kit.expectFails(await kit.runEval(ID, saves(few)), 'risks-ranked', /3 risk items/, { only: true });
    const reordered = GOOD.replace(/## 4\.[\s\S]*$/, `## 4. Summary of Architecturally Significant Risks
1. legacy-billing nightly job runs on a single host (F-005).
2. No CI gate validates the acme-contracts schema (F-001).
3. A single Keycloak realm is a hard dependency (F-002).
4. The console pins a stale contracts version (F-003).
5. acme-bff chart has no readiness probe (F-007).
`);
    kit.expectFails(await kit.runEval(ID, saves(reordered)), 'risks-ranked', /ranked above/, { only: true });
  }, 60000);

  test('an implementation file, an extra report, or an altered source fails only-assessment-docs', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/overview.js': 'x\n' })), 'only-assessment-docs', /src\/overview\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'docs/assessment/executive-summary.md': '# x\n' })), 'only-assessment-docs', /executive-summary/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { [SRC('acme-bff')]: '# rewritten\n' })), 'only-assessment-docs', /altered/); // the rewritten source also loses the ports the diagrams cite
  }, 60000);

  test('scratch diagram files are allowed', async () => {
    kit.expectAllPass(await kit.runEval(ID, saves(GOOD, { 'diagram-1.mmd': 'graph TB\n', 'docs/assessment/d1.svg': '<svg/>' })));
  });

  test('arms: plain invocation, baseline and with-skill share the prompt and only with-skill loads the assessment package', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins.length).toBeGreaterThan(0);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
