'use strict';

/**
 * Proof for the `ensemble-trd-dependency-graph` eval (evals/checks/ensemble-trd-dependency-graph.js): a good report passes every
 * check, each plausible wrong output fails the check it targets, and a run that writes nothing passes none of the output checks.
 * The good report is the shape trd-graph-cli prints for the fixture (graph --format mermaid, overlap, stderr warning).
 */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-trd-dependency-graph';
const REPORT = 'docs/trd-graph-report.md';

const MERMAID = `\`\`\`mermaid
graph TD
  n_trd_2026_aaaa1111_inventory(["trd-inventory"])
  n_trd_2026_bbbb2222_checkout["trd-checkout"]
  n_trd_2026_cccc3333_promotions["trd-promotions"]
  n_trd_2026_dddd4444_reports["trd-reports"]
  n_trd_2026_bbbb2222_checkout --> n_trd_2026_aaaa1111_inventory
  n_trd_2026_cccc3333_promotions --> n_trd_2026_aaaa1111_inventory
\`\`\``;

const OVERLAP = `## Likely-duplicate work

trd-checkout and trd-promotions both target src/Pricing.js (1 shared file). Extract the pricing work into one foundational TRD and have both reference it with [depends: <trd-slug>#TRD-NNN] instead of specifying it twice.`;

const WARNING = `## Warnings

Unresolved cross-TRD dependency 'trd-2026-bbbb2222-checkout#TRD-009' (from trd-2026-dddd4444-reports#TRD-002): unknown task 'TRD-009' in trd-2026-bbbb2222-checkout. No edge is drawn for it.`;

const doc = (...parts) => `# TRD dependency graph\n\n${parts.join('\n\n')}\n\nNo dependency cycle was detected.\n`;
const GOOD = doc(MERMAID, OVERLAP, WARNING);

const TRD = (file) => `docs/TRD/${file}`;
const saves = (text, extra) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  if (extra) extra(ws);
};

const CHECK_IDS = ['report-saved', 'graph-edges', 'graph-edges-only', 'overlap-reported', 'overlap-only-pair', 'extract-suggested', 'warning-surfaced', 'trds-untouched'];

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('a good report passes every check, and the checks run in the declared order', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(CHECK_IDS);
    kit.expectAllPass(res);
  });

  test('a Mermaid diagram with letter ids and separate node definitions passes (phrasing differences)', async () => {
    const lettered = `\`\`\`mermaid
graph LR
  A["inventory service"]
  B[checkout]
  C(promotions)
  D[reports]
  B -->|needs| A
  C --> A
\`\`\``;
    kit.expectAllPass(await kit.runEval(ID, saves(doc(lettered, OVERLAP, WARNING))));
  });

  test('a DOT graph with the same edges passes', async () => {
    const dot = '```dot\ndigraph TRD {\n  "trd-2026-bbbb2222-checkout" -> "trd-2026-aaaa1111-inventory";\n  "trd-2026-cccc3333-promotions" -> "trd-2026-aaaa1111-inventory";\n  "trd-2026-dddd4444-reports";\n}\n```';
    kit.expectAllPass(await kit.runEval(ID, saves(doc(dot, OVERLAP, WARNING))));
  });

  test('a run that writes nothing fails every check about the output and only those', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, CHECK_IDS.filter((c) => c !== 'trds-untouched'), /not written|no line names|no edge/, { only: true });
  });

  test('a report that is a stub naming the TRDs fails report-saved when too short', async () => {
    kit.expectFails(await kit.runEval(ID, saves('inventory checkout promotions reports')), 'report-saved', /nearly empty/);
  });

  test('a report that omits a TRD fails report-saved', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/reports/g, 'sales').replace(/TRD-009/g, 'TRD-0')));
    kit.expectFails(res, 'report-saved', /reports/);
  });

  test('arrows drawn the wrong way fail graph-edges', async () => {
    const reversed = MERMAID.replace('n_trd_2026_bbbb2222_checkout --> n_trd_2026_aaaa1111_inventory', 'n_trd_2026_aaaa1111_inventory --> n_trd_2026_bbbb2222_checkout')
      .replace('n_trd_2026_cccc3333_promotions --> n_trd_2026_aaaa1111_inventory', 'n_trd_2026_aaaa1111_inventory --> n_trd_2026_cccc3333_promotions');
    const res = await kit.runEval(ID, saves(doc(reversed, OVERLAP, WARNING)));
    kit.expectFails(res, ['graph-edges', 'graph-edges-only'], /checkout>inventory|inventory>checkout/, { only: true });
  });

  test('a graph missing one dependency fails graph-edges only', async () => {
    const res = await kit.runEval(ID, saves(doc(MERMAID.replace(/\n {2}n_trd_2026_cccc3333_promotions --> [^\n]*/, ''), OVERLAP, WARNING)));
    kit.expectFails(res, 'graph-edges', /promotions>inventory/, { only: true });
  });

  test('a prose-only report with no drawn graph fails graph-edges and graph-edges-only', async () => {
    const res = await kit.runEval(ID, saves(doc('checkout and promotions depend on inventory.', OVERLAP, WARNING)));
    kit.expectFails(res, ['graph-edges', 'graph-edges-only'], undefined, { only: true });
  });

  test('an edge for the unresolved reference (reports --> checkout) fails graph-edges-only', async () => {
    const withBad = MERMAID.replace(/\n```$/, '\n  n_trd_2026_dddd4444_reports --> n_trd_2026_bbbb2222_checkout\n```');
    const res = await kit.runEval(ID, saves(doc(withBad, OVERLAP, WARNING)));
    kit.expectFails(res, 'graph-edges-only', /reports>checkout/, { only: true });
  });

  test('an overlap drawn as a dependency (checkout --> promotions) fails graph-edges-only', async () => {
    const withBad = MERMAID.replace(/\n```$/, '\n  n_trd_2026_bbbb2222_checkout --> n_trd_2026_cccc3333_promotions\n```');
    const res = await kit.runEval(ID, saves(doc(withBad, OVERLAP, WARNING)));
    kit.expectFails(res, 'graph-edges-only', /checkout>promotions/, { only: true });
  });

  test('a report without the overlap finding fails overlap-reported, overlap-only-pair and extract-suggested', async () => {
    const res = await kit.runEval(ID, saves(doc(MERMAID, WARNING)));
    kit.expectFails(res, ['overlap-reported', 'overlap-only-pair', 'extract-suggested'], undefined, { only: true });
  });

  test('a per-TRD file table with no overlap claim does not satisfy overlap-reported', async () => {
    const table = '## Files\n\n| TRD | files |\n|---|---|\n| checkout | src/Cart.js, src/Pricing.js |\n| promotions | src/Pricing.js, src/Promo.js |';
    const res = await kit.runEval(ID, saves(doc(MERMAID, table, WARNING)));
    kit.expectFails(res, 'overlap-reported', /no passage/);
  });

  test('blaming a TRD that does not touch the file fails overlap-only-pair', async () => {
    const res = await kit.runEval(ID, saves(doc(MERMAID, OVERLAP, 'src/Pricing.js is also shared with trd-reports.', WARNING)));
    kit.expectFails(res, 'overlap-only-pair', /does not touch it/, { only: true });
  });

  test('an overlap without the extract-and-reference advice fails extract-suggested', async () => {
    const bare = '## Overlap\n\ntrd-checkout and trd-promotions overlap on src/Pricing.js.';
    kit.expectFails(await kit.runEval(ID, saves(doc(MERMAID, bare, WARNING))), 'extract-suggested', /extract/, { only: true });
  });

  const ADVICE = 'Extract the shared work into one foundational TRD and have both reference it with [depends: <trd-slug>#TRD-NNN].';

  test('an overlap that names only one of the two TRDs, or no file, fails overlap-reported', async () => {
    const one = await kit.runEval(ID, saves(doc(MERMAID, `trd-checkout shares src/Pricing.js with another TRD. ${ADVICE}`, WARNING)));
    kit.expectFails(one, 'overlap-reported', /no passage/, { only: true });
    const other = await kit.runEval(ID, saves(doc(MERMAID, `trd-promotions shares src/Pricing.js with another TRD. ${ADVICE}`, WARNING)));
    kit.expectFails(other, 'overlap-reported', /no passage/, { only: true });
    const nofile = await kit.runEval(ID, saves(doc(MERMAID, `trd-checkout and trd-promotions overlap on their pricing code. ${ADVICE}`, WARNING)));
    kit.expectFails(nofile, ['overlap-reported', 'overlap-only-pair'], undefined, { only: true });
  });

  test('blaming inventory for the shared file fails overlap-only-pair', async () => {
    const res = await kit.runEval(ID, saves(doc(MERMAID, OVERLAP, 'src/Pricing.js is also shared with trd-inventory.', WARNING)));
    kit.expectFails(res, 'overlap-only-pair', /does not touch it/, { only: true });
  });

  test('extract advice that is not about the shared work, or that does not say to reference it, fails extract-suggested', async () => {
    const plain = 'trd-checkout and trd-promotions overlap on src/Pricing.js.';
    const generic = await kit.runEval(ID, saves(doc(MERMAID, plain, ADVICE, WARNING)));
    kit.expectFails(generic, 'extract-suggested', /no suggestion/, { only: true });
    const noref = await kit.runEval(ID, saves(doc(MERMAID, 'trd-checkout and trd-promotions overlap on src/Pricing.js: extract the pricing work into a foundational TRD.', WARNING)));
    kit.expectFails(noref, 'extract-suggested', /no suggestion/, { only: true });
    const noverb = await kit.runEval(ID, saves(doc(MERMAID, 'trd-checkout and trd-promotions overlap on src/Pricing.js; one may depend on the other.', WARNING)));
    kit.expectFails(noverb, 'extract-suggested', /no suggestion/, { only: true });
  });

  test('a warning about some other reference does not satisfy warning-surfaced', async () => {
    const res = await kit.runEval(ID, saves(doc(MERMAID, OVERLAP, 'Unresolved reference to trd-9999 in trd-reports.')));
    kit.expectFails(res, 'warning-surfaced', /TRD-009/, { only: true });
  });

  test('a report that does not mention the dangling reference fails warning-surfaced', async () => {
    kit.expectFails(await kit.runEval(ID, saves(doc(MERMAID, OVERLAP))), 'warning-surfaced', /TRD-009/, { only: true });
  });

  test('mentioning TRD-009 without calling it a problem fails warning-surfaced', async () => {
    const res = await kit.runEval(ID, saves(doc(MERMAID, OVERLAP, 'reports depends on checkout#TRD-009 for rendering.')));
    kit.expectFails(res, 'warning-surfaced', /TRD-009/, { only: true });
  });

  test('editing a TRD to "fix" the dangling reference fails trds-untouched', async () => {
    const res = await kit.runEval(ID, saves(GOOD, (ws) => {
      const f = TRD('TRD-2026-dddd4444-reports.md');
      ws.write(f, ws.read(f).replace('#TRD-009', '#TRD-001'));
    }));
    kit.expectFails(res, 'trds-untouched', /reports\.md was modified/, { only: true });
  });

  test('adding or removing a file under docs/TRD fails trds-untouched', async () => {
    const added = await kit.runEval(ID, saves(GOOD, (ws) => ws.write(TRD('TRD-2026-eeee5555-pricing.md'), '# extracted\n')));
    kit.expectFails(added, 'trds-untouched', /docs\/TRD changed/, { only: true });
    const removed = await kit.runEval(ID, saves(GOOD, (ws) => ws.remove(TRD('TRD-2026-aaaa1111-inventory.md'))));
    kit.expectFails(removed, 'trds-untouched', /docs\/TRD changed/, { only: true });
  });

  test('the seeded fixture alone passes trds-untouched (no TRD edit needed) and fails the rest', async () => {
    const res = await kit.runEval(ID, () => {});
    expect(res['trds-untouched'].pass).toBe(true);
    expect(res['report-saved'].pass).toBe(false);
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:trd-dependency-graph ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
