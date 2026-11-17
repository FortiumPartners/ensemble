'use strict';

/** Proof that the ensemble-onboard checks pass on a good overview and fail on plausible bad ones (kit: evals/tests/skill-eval-kit.js). */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-onboard';
const DOC = 'docs/architecture/overview.md';
const IDS = [
  'overview-saved', 'overview-sections', 'overview-commands', 'overview-no-invented-commands', 'overview-entrypoints', 'overview-modules',
  'overview-stores', 'overview-integrations', 'overview-no-secrets', 'overview-deployment', 'overview-hotspots', 'overview-unknowns', 'read-only',
];

const GOOD = `# Architecture Overview: ledger-api

## Purpose

An invoicing service: customers get invoices, which are paid through Stripe.

## Entry Points

- [src/server.js](../../src/server.js): Express HTTP server on \`PORT\` (default 8080), routes under \`/invoices\` and \`/healthz\`.
- [src/worker.js](../../src/worker.js): drains the \`reminders\` Redis list.
- [db/migrate.js](../../db/migrate.js): applies the SQL migrations.

## Module Map

- \`src/routes/\`: HTTP handlers (\`invoices.js\`).
- \`src/db/\`: the shared Postgres pool.
- \`src/integrations/\`: the Stripe client.
- \`db/migrations/\`: schema (invoices, payments).

## Data Stores

- PostgreSQL (\`DATABASE_URL\`): invoices and payments tables, migrations in \`db/migrations/\`.
- Redis (\`REDIS_URL\`): the reminders queue.

## External Integrations

- Stripe charges, credential in the \`STRIPE_API_KEY\` environment variable.

## Build/Test/Lint/Run

\`\`\`sh
npm run build        # node scripts/bundle.js
npm run lint:strict
npm run test:unit
make check           # lint:strict then test:unit
npm start
\`\`\`

## Deployment Shape

A Docker image (node:20-alpine, \`Dockerfile\`) built by GitHub Actions (\`.github/workflows/ci.yml\`) after \`make check\`. Where it is deployed is not stated.

## Hotspots

1. \`src/routes/invoices.js\`: largest file, three handlers, raw SQL and the Stripe call in one place.
2. \`src/worker.js\`: infinite loop, no error handling.
3. \`db/migrate.js\`: reapplies every migration on each run.

## Unknowns and Open Questions

- Where the image is deployed: nothing in the repository says.
- No README: the intended customer API contract is unknown.
`;

/** A stub agent that saves `text` as the overview (null: nothing), and optionally other files. */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(DOC, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const edit = (from, to) => GOOD.replace(from, to);

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.command).toBe('/ensemble-development:ensemble:onboard');
  });

  test('a good overview passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every check about the overview, and read-only still passes', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, IDS.filter((i) => i !== 'read-only'), /was not written/, { only: true });
  });

  test('an overview missing a prescribed section fails overview-sections', async () => {
    const res = await kit.runEval(ID, saves(edit(/## Hotspots[\s\S]*?(?=## Unknowns)/, '')));
    kit.expectFails(res, ['overview-sections', 'overview-hotspots'], undefined, { only: true });
    expect(res['overview-sections'].detail).toMatch(/Hotspots/);
  });

  test('default commands instead of the repository\'s fail overview-commands', async () => {
    const res = await kit.runEval(ID, saves(edit(/npm run lint:strict\nnpm run test:unit\nmake check[^\n]*/, 'npm run lint:strict\nmake test')));
    kit.expectFails(res, ['overview-commands', 'overview-no-invented-commands'], undefined, { only: true });
    expect(res['overview-commands'].detail).toMatch(/test:unit/);
  });

  test.each([
    ['a script that package.json lacks', 'npm run lint', /npm run lint$/],
    ['a bare npm test (the fixture has no test script)', 'npm test', /npm test/],
    ['a Makefile target that does not exist', 'make test', /make test/],
  ])('%s fails overview-no-invented-commands and only that', async (_what, cmd, shown) => {
    const res = await kit.runEval(ID, saves(edit('npm start\n', `npm start\n${cmd}\n`)));
    kit.expectFails(res, 'overview-no-invented-commands', shown, { only: true });
  });

  test('a heading with an empty body fails the check of that section as empty', async () => {
    const res = await kit.runEval(ID, saves(edit(/- \[src\/server\.js\][\s\S]*?(?=## Module Map)/, '')));
    kit.expectFails(res, 'overview-entrypoints', /is empty/, { only: true });
  });

  test('prose that merely says "make sure" or names "npm start" is not an invented command', async () => {
    kit.expectAllPass(await kit.runEval(ID, saves(edit('Where it is deployed is not stated.', 'Make sure to check where it is deployed; run `make check` first.'))));
  });

  test('an overview that omits the worker entry point fails overview-entrypoints', async () => {
    const res = await kit.runEval(ID, saves(edit(/- \[src\/worker\.js\][^\n]*\n/, '')));
    kit.expectFails(res, 'overview-entrypoints', /src\/worker\.js/, { only: true });
  });

  test('a module map without the integrations module fails overview-modules', async () => {
    const res = await kit.runEval(ID, saves(edit(/- `src\/integrations\/`[^\n]*\n/, '')));
    kit.expectFails(res, 'overview-modules', /integrations/, { only: true });
  });

  test('an overview that misses Redis as a data store fails overview-stores', async () => {
    const res = await kit.runEval(ID, saves(edit(/- Redis[^\n]*\n/, '')));
    kit.expectFails(res, 'overview-stores', /redis/, { only: true });
  });

  test('quoting the credential value from .env.example fails overview-no-secrets (a name alone is fine)', async () => {
    const res = await kit.runEval(ID, saves(edit('credential in the', 'key sk_test_FIXTURE0123456789 in the')));
    kit.expectFails(res, 'overview-no-secrets', /credential value/, { only: true });
  });

  test('an integrations section that names no credential variable fails overview-integrations', async () => {
    const res = await kit.runEval(ID, saves(edit('credential in the `STRIPE_API_KEY` environment variable', 'API key')));
    kit.expectFails(res, 'overview-integrations', /STRIPE_API_KEY/, { only: true });
  });

  test('a deployment shape that ignores Docker fails overview-deployment', async () => {
    const res = await kit.runEval(ID, saves(edit(/A Docker image[^\n]*/, 'Runs on a server.')));
    kit.expectFails(res, 'overview-deployment', /docker|github/i, { only: true });
  });

  test('invented hotspot files fail overview-hotspots', async () => {
    const res = await kit.runEval(ID, saves(edit('src/routes/invoices.js`: largest', 'src/services/billing.js`: largest')));
    kit.expectFails(res, 'overview-hotspots', /do not exist.*billing\.js/, { only: true });
  });

  test('too few hotspots fail overview-hotspots', async () => {
    const res = await kit.runEval(ID, saves(edit(/2\. `src\/worker[^\n]*\n3\. [^\n]*\n/, '')));
    kit.expectFails(res, 'overview-hotspots', /expected at least 3/, { only: true });
  });

  test('an empty unknowns section fails overview-unknowns', async () => {
    const res = await kit.runEval(ID, saves(edit(/- Where the image is deployed[\s\S]*$/, 'None.\n')));
    kit.expectFails(res, 'overview-unknowns', /no item/, { only: true });
  });

  test('writing CLAUDE.md fails read-only', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'CLAUDE.md': '# commands\n' }));
    kit.expectFails(res, 'read-only', /CLAUDE\.md was written without approval/, { only: true });
  });

  test('editing the repository fails read-only: a stray file, a removed file, changed package.json scripts', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/fix.js': '//\n' })), 'read-only', /src\/fix\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.remove('Makefile'); }), 'read-only', /removed.*Makefile/, { only: true });
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.write('package.json', JSON.stringify({ scripts: { test: 'jest' } })); });
    kit.expectFails(res, 'read-only', /scripts changed/, { only: true });
  });

  test('an overview over 400 lines fails overview-saved', async () => {
    const res = await kit.runEval(ID, saves(`${GOOD}${'- filler\n'.repeat(400)}`));
    kit.expectFails(res, 'overview-saved', /lines/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:onboard ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
