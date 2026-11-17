'use strict';

/** Kit test for the `assess-architect` eval: a good report passes every check; each bad report fails the check it targets. */

const kit = require('../skill-eval-kit');

const ID = 'assess-architect';
const REPORT = 'docs/assessment/architecture.md';

const GOOD = `# Architecture Analysis

## Project Structure

\`\`\`
src/
  index.js
  controllers/orderController.js
  services/orderService.js
  repositories/orderRepository.js
  shared/cache.js, logger.js
  jobs/emailWorker.js
configs/app.json
tests/orderService-check.js
\`\`\`

A layered Express service: controllers (presentation), services (business), repositories (data) and a shared layer. The entry point is src/index.js:1.

## Layering Assessment

| Layer | Files | Evaluation |
|---|---|---|
| Presentation | src/controllers/orderController.js:1 | HTTP handlers and response mapping |
| Business | src/services/orderService.js:1 | caching, order rules and job enqueueing |
| Data | src/repositories/orderRepository.js:1 | Postgres queries through a pg pool |
| Shared | src/shared/cache.js:1, src/shared/logger.js:1 | cross-cutting cache and logging |

The separation is intended to be controller -> service -> repository, but it is not enforced.

## Dependencies

| Finding | Evidence |
|---|---|
| The data layer imports the presentation layer, an upward dependency that makes a circular import (controller -> repository -> controller) | src/repositories/orderRepository.js:4 |
| The controller imports the repository directly and skips the service layer | src/controllers/orderController.js:3 |

## Integration Patterns

Postgres through a pg Pool (src/repositories/orderRepository.js:6), Redis through ioredis (src/shared/cache.js:5) and a BullMQ queue and worker on the same Redis (src/jobs/emailWorker.js:5).

## Scalability Constraints

- The Postgres pool is capped at 5 connections (configs/app.json:3).
- The e-mail worker runs with concurrency 1 (configs/app.json:5, src/jobs/emailWorker.js:15).
- Cached orders expire after 60 seconds (configs/app.json:4).

## Architecture Diagram

\`\`\`mermaid
graph TD
  Index[src/index.js] --> Controller[orderController]
  Controller --> Service[orderService]
  Service --> Repository[orderRepository]
  Repository --> Postgres[(Postgres)]
  Service --> Cache[Redis cache]
  Service --> Queue[BullMQ queue]
  Repository -. violation .-> Controller
\`\`\`

## Key Issues

1. The repository imports the controller, a circular upward dependency (src/repositories/orderRepository.js:4).
2. The controller bypasses the service layer (src/controllers/orderController.js:3).
3. The pool of 5 and the worker concurrency of 1 limit throughput (configs/app.json:3).

## Score: 3.2 / C+ (works and is small, but the layering is violated in two places)

## Recommendations

1. Move toResponse into a shared module and remove the repository's import of the controller.
2. Route the customer count through the service so the controller never touches a repository.
`;

/** A stub agent that saves \`text\` as the report (and optionally other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: ${from} not in GOOD`); return GOOD.replace(from, to); };

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'sections-complete', 'score-format', 'diagram-valid', 'diagram-components', 'layers-identified',
      'violation-upward', 'violation-skip', 'citations-real', 'integrations-named', 'scalability-constraints', 'key-issues-recommendations', 'no-stray-writes']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check and passes only no-stray-writes', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, Object.keys(res).filter((k) => k !== 'no-stray-writes'), /not written|was not written|no "|missing/i, { only: true });
  });

  test('a report without the numeric score (a bare letter) fails score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 3.2 / C+ (', '## Score: C+ ('))), 'score-format', /not "<1\.0-5\.0> \/ <Letter>"/, { only: true });
  });

  test('a score whose letter does not match the scale fails score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('3.2 / C+', '3.2 / B'))), 'score-format', /scale gives C\+/, { only: true });
  });

  test('a report with no Architecture Analysis title, or a stub, fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('# Architecture Analysis', '# Notes'))), 'report-saved', /title/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves('# Architecture Analysis\n\nLooks layered.\n')), 'report-saved', /only \d+ characters/);
  });

  test('a score outside 1.0-5.0 fails score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('3.2 / C+', '5.5 / A'))), 'score-format', /outside 1\.0-5\.0/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('3.2 / C+', '0.5 / F'))), 'score-format', /outside 1\.0-5\.0/, { only: true });
  });

  test('sections present but in the wrong order fail sections-complete', async () => {
    const recs = GOOD.slice(GOOD.indexOf('## Recommendations'));
    const res = await kit.runEval(ID, saves(`${GOOD.slice(0, GOOD.indexOf('## Recommendations'))}`.replace('## Project Structure', `${recs}\n## Project Structure`)));
    kit.expectFails(res, 'sections-complete', /out of the prescribed order/, { only: true });
  });

  test('a Layering Assessment that never mentions the shared layer fails layers-identified', async () => {
    const res = await kit.runEval(ID, saves(swap('| Shared | src/shared/cache.js:1, src/shared/logger.js:1 | cross-cutting cache and logging |\n', '').replace('and a shared layer', 'layers')));
    kit.expectFails(res, 'layers-identified', /shared layer/, { only: true });
  });

  test('citations of a single file only fail citations-real', async () => {
    const one = GOOD.replace(/(?:src|configs)\/[A-Za-z/]+\.(?:js|json):(\d+)/g, 'src/repositories/orderRepository.js:$1');
    const res = await kit.runEval(ID, saves(one));
    kit.expectFails(res, 'citations-real', /only 1 distinct/);
  });

  test('a Scalability section that names areas but none of the configured values fails scalability-constraints', async () => {
    const res = await kit.runEval(ID, saves(swap('- The Postgres pool is capped at 5 connections (configs/app.json:3).\n- The e-mail worker runs with concurrency 1 (configs/app.json:5, src/jobs/emailWorker.js:15).\n- Cached orders expire after 60 seconds (configs/app.json:4).',
      '- The Postgres connection pool is small.\n- The worker queue is slow.\n- The Redis cache may expire.')));
    kit.expectFails(res, 'scalability-constraints', /configured values/, { only: true });
  });

  test('a removed fixture file fails no-stray-writes', async () => {
    const res = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.remove('tests/orderService-check.js'); });
    kit.expectFails(res, 'no-stray-writes', /removed/, { only: true });
  });

  test('a report that skips a section fails sections-complete', async () => {
    const res = await kit.runEval(ID, saves(swap('## Scalability Constraints', '## Notes')));
    kit.expectFails(res, ['sections-complete', 'scalability-constraints'], /missing|no "Scalability/);
    kit.expectFails(res, 'sections-complete', /Scalability Constraints/);
  });

  test('a report with no Mermaid block fails the diagram checks', async () => {
    const res = await kit.runEval(ID, saves(swap('```mermaid', '```text')));
    kit.expectFails(res, ['diagram-valid', 'diagram-components'], /mermaid/, { only: true });
  });

  test('a diagram with unbalanced brackets or too few edges fails diagram-valid', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('Repository --> Postgres[(Postgres)]', 'Repository --> Postgres[(Postgres'))), 'diagram-valid', /unbalanced/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('  Index[src/index.js] --> Controller[orderController]\n', '  Index[src/index.js]\n').replace('  Service --> Cache[Redis cache]\n  Service --> Queue[BullMQ queue]\n  Repository -. violation .-> Controller\n', ''))), 'diagram-valid', /only 3 edge/, { only: true });
  });

  test('a diagram that omits the data layer fails diagram-components', async () => {
    const res = await kit.runEval(ID, saves(swap('  Service --> Repository[orderRepository]\n  Repository --> Postgres[(Postgres)]\n', '  Service --> Postgres[(Postgres)]\n').replace('  Repository -. violation .-> Controller\n', '  Service --> Cache2[Redis cache]\n')));
    kit.expectFails(res, 'diagram-components', /data layer/, { only: true });
  });

  test('a Mermaid block of another diagram type fails diagram-valid', async () => {
    const res = await kit.runEval(ID, saves(swap('graph TD', 'sequenceDiagram')));
    kit.expectFails(res, ['diagram-valid', 'diagram-components'], /graph|flowchart/, { only: true });
  });

  test('a diagram with no entry point, or with no external dependency, fails diagram-components', async () => {
    const noEntry = swap('  Index[src/index.js] --> Controller[orderController]\n', '  Controller[orderController] --> Service[orderService]\n').replace('  Controller --> Service[orderService]\n', '');
    kit.expectFails(await kit.runEval(ID, saves(noEntry)), 'diagram-components', /entry point/, { only: true });
    const noExternal = swap('  Repository --> Postgres[(Postgres)]\n  Service --> Cache[Redis cache]\n  Service --> Queue[BullMQ queue]\n', '  Repository --> Controller\n');
    kit.expectFails(await kit.runEval(ID, saves(noExternal)), 'diagram-components', /external dependency/, { only: true });
  });

  test('an Integration Patterns section that leaves out Postgres or the queue fails integrations-named', async () => {
    const noPg = swap('Postgres through a pg Pool (src/repositories/orderRepository.js:6), ', 'A relational store (src/repositories/orderRepository.js:6), ');
    kit.expectFails(await kit.runEval(ID, saves(noPg)), 'integrations-named', /Postgres/, { only: true });
    const noQueue = swap(' and a BullMQ queue and worker on the same Redis (src/jobs/emailWorker.js:5)', ' (src/shared/cache.js:5)');
    kit.expectFails(await kit.runEval(ID, saves(noQueue)), 'integrations-named', /queue/, { only: true });
  });

  test('a report with fewer than two recommendations fails key-issues-recommendations', async () => {
    const res = await kit.runEval(ID, saves(swap('2. Route the customer count through the service so the controller never touches a repository.\n', '')));
    kit.expectFails(res, 'key-issues-recommendations', /Recommendations has 1/, { only: true });
  });

  test('a Layering Assessment that names no data layer fails layers-identified', async () => {
    const res = await kit.runEval(ID, saves(swap('| Data | src/repositories/orderRepository.js:1 | Postgres queries through a pg pool |', '| Other | src/shared/cache.js:1 | cache |')
      .replace('controller -> service -> repository, but it is not enforced.', 'not enforced.').replace('controllers (presentation), services (business), repositories (data) and a shared layer', 'controllers (presentation), services (business) and a shared layer')));
    kit.expectFails(res, 'layers-identified', /data/, { only: true });
  });

  test('a report that misses the planted upward import fails violation-upward', async () => {
    const res = await kit.runEval(ID, saves(swap('src/repositories/orderRepository.js:4', 'src/repositories/orderRepository.js:12').replace('(src/repositories/orderRepository.js:4)', '(src/repositories/orderRepository.js:12)')));
    kit.expectFails(res, 'violation-upward', /orderRepository\.js:4/, { only: true });
  });

  test('the upward import cited with no explanation of what is wrong fails violation-upward', async () => {
    const res = await kit.runEval(ID, saves(swap('The data layer imports the presentation layer, an upward dependency that makes a circular import (controller -> repository -> controller)', 'Uses a helper').replace('The repository imports the controller, a circular upward dependency', 'The repository file')));
    kit.expectFails(res, 'violation-upward', /not described/, { only: true });
  });

  test('a report that does not cite the controller-to-repository skip fails violation-skip', async () => {
    const res = await kit.runEval(ID, saves(swap('src/controllers/orderController.js:3 |', 'src/controllers/orderController.js:1 |').replace('(src/controllers/orderController.js:3)', '(src/controllers/orderController.js:1)')));
    kit.expectFails(res, 'violation-skip', /orderController\.js:3/, { only: true });
  });

  test('a citation of an invented file, or of a line past the end, fails citations-real', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('src/shared/logger.js:1', 'src/shared/metrics.js:1'))), 'citations-real', /not in the repository/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('configs/app.json:3).', 'configs/app.json:300).'))), 'citations-real', /has \d+ lines/, { only: true });
  });

  test('a report with no file:line citations fails citations-real and key-issues-recommendations', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/(\.(?:js|json)):\d+/g, '$1')));
    kit.expectFails(res, ['citations-real', 'key-issues-recommendations', 'violation-upward', 'violation-skip'], undefined, { only: true });
    kit.expectFails(res, 'citations-real', /only 0 file:line/);
  });

  test('an Integration Patterns section that leaves out Redis fails integrations-named', async () => {
    const res = await kit.runEval(ID, saves(swap('Redis through ioredis (src/shared/cache.js:5) and a BullMQ queue and worker on the same Redis', 'a message broker')));
    kit.expectFails(res, 'integrations-named', /Redis/, { only: true });
  });

  test('a Scalability Constraints section that finds only one area fails scalability-constraints', async () => {
    const res = await kit.runEval(ID, saves(swap('- The e-mail worker runs with concurrency 1 (configs/app.json:5, src/jobs/emailWorker.js:15).\n- Cached orders expire after 60 seconds (configs/app.json:4).\n', '')));
    kit.expectFails(res, 'scalability-constraints', /covers 1 of/, { only: true });
  });

  test('too few Key Issues, or none citing a file, fails key-issues-recommendations', async () => {
    const few = await kit.runEval(ID, saves(swap('2. The controller bypasses the service layer (src/controllers/orderController.js:3).\n3. The pool of 5 and the worker concurrency of 1 limit throughput (configs/app.json:3).\n', '')));
    kit.expectFails(few, 'key-issues-recommendations', /1 numbered/, { only: true });
    const uncited = await kit.runEval(ID, saves(swap('1. The repository imports the controller, a circular upward dependency (src/repositories/orderRepository.js:4).\n2. The controller bypasses the service layer (src/controllers/orderController.js:3).\n3. The pool of 5 and the worker concurrency of 1 limit throughput (configs/app.json:3).', '1. The repository imports the controller, a circular upward dependency.\n2. The controller bypasses the service layer.\n3. The pool of 5 limits throughput.')));
    kit.expectFails(uncited, 'key-issues-recommendations', /only 0 Key Issue/);
  });

  test('a stray source file, and a modified fixture file, fail no-stray-writes', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/fix.js': 'x\n' })), 'no-stray-writes', /src\/fix\.js/, { only: true });
    const edited = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.write('src/repositories/orderRepository.js', `${ws.read('src/repositories/orderRepository.js')}// fixed\n`); });
    kit.expectFails(edited, 'no-stray-writes', /modified/, { only: true });
  });

  test('arms: plain invocation, baseline loads nothing, with-skill loads packages/assessment, same prompt', async () => {
    const ev = kit.loadsClean(ID);
    expect(ev.invocation).toBe('plain');
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/assessment$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
