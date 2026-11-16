'use strict';

const kit = require('../skill-eval-kit');

const ID = 'ensemble-analyze-complexity';
const REPORT = 'docs/complexity.md';

const GOOD = `# Adaptive Planning Complexity Analysis

- Subject: Migrate session token handling in packages/auth/src/session.js and packages/billing/src/invoice.js to the new identity provider API, with a rollback plan for the production rollout. Staging uses [REDACTED:key-value-secret]
- Score: 9
- Recommended route: complex
- Selected route: complex
- Confidence: high
- Override: none
- Adaptive planning: enabled

## Rationale
- scopeSize: repo: packages/auth/src/session.js (3 lines, packages/auth, imported by 2 files)
- scopeSize: repo: packages/billing/src/invoice.js (3 lines, packages/billing, imported by 0 files)
- scopeSize: repo: named paths span 2 packages (packages/auth, packages/billing)
- dependencies: repo: packages/auth/src/session.js is imported by 2 files
- riskFactors: risk signal: migrate

## Missing Inputs
- team size: not readable from a description or the repository; not scored
- bead metadata: no --bead given

## Route Plan
- /ensemble:create-prd
- /ensemble:refine-prd
- /ensemble:create-trd
- /ensemble:refine-trd
- STOP: await implementation approval
`;

const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const edit = (from, to) => saves(GOOD.replace(from, to));

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'score-route-consistent', 'expected-complex', 'secret-redacted', 'route-plan', 'repo-facts-cited', 'missing-inputs', 'no-implementation']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every check', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, Object.keys(res), /not written|no "Score|was not written/, { only: true });
  });

  test('a report with no score line fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('Complexity looks high.\n')), 'report-saved', /no "Score/);
  });

  test('a score whose band disagrees with the recommended route fails score-route-consistent', async () => {
    const res = await kit.runEval(ID, edit('- Score: 9', '- Score: 5'));
    kit.expectFails(res, ['score-route-consistent', 'expected-complex'], undefined, { only: true });
    kit.expectFails(res, 'score-route-consistent', /5 is the medium band/);
  });

  test('a selected route that differs from the recommended one with no override fails score-route-consistent', async () => {
    const res = await kit.runEval(ID, edit('- Selected route: complex', '- Selected route: medium'));
    kit.expectFails(res, ['score-route-consistent', 'expected-complex'], undefined, { only: true });
  });

  test('a consistent but medium verdict fails expected-complex only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('- Score: 9', '- Score: 5').replace(/route: complex/g, 'route: medium')));
    kit.expectFails(res, 'expected-complex', /below 7/, { only: true });
  });

  test('the API key left in the rationale fails secret-redacted', async () => {
    const res = await kit.runEval(ID, edit('Staging uses [REDACTED:key-value-secret]', 'Staging uses API_KEY=sk_live_abcdef1234567890'));
    kit.expectFails(res, 'secret-redacted', /unredacted/, { only: true });
  });

  test('dropping the key without a marker fails secret-redacted', async () => {
    const res = await kit.runEval(ID, edit(' Staging uses [REDACTED:key-value-secret]', ''));
    kit.expectFails(res, 'secret-redacted', /no \[REDACTED/, { only: true });
  });

  test('the original description in the route plan is allowed to carry the key', async () => {
    kit.expectAllPass(await kit.runEval(ID, edit('- STOP: await', '- original: API_KEY=sk_live_abcdef1234567890\n- STOP: await')));
  });

  test('a route plan out of order or without the approval stop fails route-plan', async () => {
    let res = await kit.runEval(ID, edit('- /ensemble:refine-prd\n- /ensemble:create-trd', '- /ensemble:create-trd\n- /ensemble:refine-prd'));
    kit.expectFails(res, 'route-plan', /lacks/, { only: true });
    res = await kit.runEval(ID, edit('- STOP: await implementation approval\n', ''));
    kit.expectFails(res, 'route-plan', /does not stop/, { only: true });
    res = await kit.runEval(ID, edit('- /ensemble:refine-prd\n', ''));
    kit.expectFails(res, 'route-plan', /refine-prd/, { only: true });
  });

  test('a report that never read the repository fails repo-facts-cited', async () => {
    const text = GOOD.replace(/^- (scopeSize|dependencies): repo:.*\n/gm, '');
    kit.expectFails(await kit.runEval(ID, saves(text)), 'repo-facts-cited', /does not cite/, { only: true });
  });

  test('a wrong fan-in fails repo-facts-cited', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/imported by 2/g, 'imported by 7')));
    kit.expectFails(res, 'repo-facts-cited', /imported by 2/, { only: true });
  });

  test('team size missing from Missing Inputs, or given a score, fails missing-inputs', async () => {
    let res = await kit.runEval(ID, edit('- team size: not readable from a description or the repository; not scored\n', ''));
    kit.expectFails(res, 'missing-inputs', /does not list team size/, { only: true });
    res = await kit.runEval(ID, edit('- riskFactors: risk signal: migrate', '- team size score 2 (several people)\n- riskFactors: risk signal: migrate'));
    kit.expectFails(res, 'missing-inputs', /team size was scored/, { only: true });
  });

  test('an implementation file or a removed seeded file fails no-implementation', async () => {
    let res = await kit.runEval(ID, saves(GOOD, { 'packages/auth/src/provider.js': 'module.exports = {};\n' }));
    kit.expectFails(res, 'no-implementation', /provider\.js/, { only: true });
    res = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.remove('packages/auth/src/tokens.js'); });
    kit.expectFails(res, 'no-implementation', /removed seeded file/, { only: true });
  });

  test('a score outside 1-10 fails score-route-consistent with the range reason', async () => {
    const res = await kit.runEval(ID, edit('- Score: 9', '- Score: 12'));
    kit.expectFails(res, 'score-route-consistent', /outside 1-10/, { only: true });
  });

  test('each repository citation is required on its own: a missing path, or a missing package span', async () => {
    let res = await kit.runEval(ID, saves(GOOD.replace(/^- scopeSize: repo: packages\/billing\/src\/invoice\.js.*\n/m, '').replace('Migrate session token handling in packages/auth/src/session.js and packages/billing/src/invoice.js', 'Migrate session token handling')));
    kit.expectFails(res, 'repo-facts-cited', /does not cite packages\/billing\/src\/invoice\.js/, { only: true });
    res = await kit.runEval(ID, saves(GOOD.replace(/^- scopeSize: repo: named paths span.*\n/m, '')));
    kit.expectFails(res, 'repo-facts-cited', /span of two packages/, { only: true });
  });

  test('a report without a Route Plan or Missing Inputs heading fails with that reason', async () => {
    let res = await kit.runEval(ID, saves(GOOD.replace('## Route Plan', '## Next')));
    kit.expectFails(res, 'route-plan', /no "Route Plan" section/, { only: true });
    res = await kit.runEval(ID, saves(GOOD.replace('## Missing Inputs', '## Gaps')));
    kit.expectFails(res, 'missing-inputs', /no "Missing Inputs" section/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:analyze-complexity ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
