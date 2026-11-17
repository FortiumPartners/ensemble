'use strict';

/** Kit test for the `assess-security` eval: a good report passes every check; each bad report fails the check it targets. */

const kit = require('../skill-eval-kit');

jest.setTimeout(60000);

const ID = 'assess-security';
const REPORT = 'docs/assessment/security.md';

const GOOD = `# Security Analysis

## Authentication

| Pattern | Status | Notes |
|---------|--------|-------|
| JWT | ✓ | tokens issued with jwt.sign (src/auth.js:7) and checked with jwt.verify (src/auth.js:13); lifetime is 30 days |
| Session | ✗ | no server-side sessions |
| OAuth | ✗ | not used |

## Authorization

Most routes use requireAuth and requireRole('admin') (src/routes.js:16). The DELETE /admin/users/:id route has no authentication or role middleware at all, so any anonymous caller can delete users (src/routes.js:20).

## Secrets Management

Hardcoded secrets are present in source; values are deliberately not shown.

| Type | Status | Concern |
|------|--------|---------|
| Hardcoded secrets | ✓ | JWT signing secret (src/auth.js:4), payments API key (src/config.js:4), database password in a connection string (src/config.js:5) |
| Env variables | ✓ | PORT, SMTP_HOST and CARD_KEY are read from the environment |
| Vault usage | ✗ | none |

## Input Validation

Email is validated on user creation (src/users.js:6). The search endpoint passes req.query.name straight into a SQL string (src/routes.js:26), an SQL injection.

## Sensitive Data Handling

The ssn and date of birth are stored as plain text in the users table, unencrypted (src/users.js:10). Card numbers are encrypted with AES-256-GCM before storage (src/payments.js:7). No HIPAA-style controls were found.

## Vulnerabilities

| Type | Severity | Location |
|------|----------|----------|
| SQL injection in /search | HIGH | src/routes.js:26 |
| Hardcoded secrets | HIGH | src/auth.js:4 |
| Unauthenticated admin delete | HIGH | src/routes.js:20 |
| Plain-text ssn and dob | MEDIUM | src/users.js:10 |
| 30-day token lifetime | LOW | src/auth.js:7 |
| Old dependencies: lodash 4.17.4, minimist 0.0.8, jsonwebtoken 8.0.0 | MEDIUM | package.json:9 |

## Key Findings

1. SQL injection in the search endpoint - severity: HIGH (src/routes.js:26)
2. Secrets are hardcoded in source - severity: HIGH (src/config.js:4)
3. An admin route has no authentication - severity: HIGH (src/routes.js:20)

## Score: 2.0 / D (several high-severity issues, some good practice on card encryption)

## Recommendations

1. Move every secret to the environment or a vault, rotate them, and use parameterised SQL.
2. Put requireAuth and requireRole in front of every admin route and upgrade the pinned dependencies.
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
    expect(Object.keys(res)).toEqual(['report-saved', 'sections-complete', 'score-format', 'no-secret-values', 'secrets-reported', 'auth-jwt', 'oauth-absent',
      'authz-gap', 'sql-injection', 'vuln-table', 'sensitive-data', 'dependencies-noted', 'citations-real', 'findings-recommendations', 'no-stray-writes']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check and passes only no-stray-writes', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, Object.keys(res).filter((k) => k !== 'no-stray-writes'), /was not written/, { only: true });
  });

  test('a bare-letter score, a mismatched letter and an out-of-range score fail score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 2.0 / D (', '## Score: D ('))), 'score-format', /not "<1\.0-5\.0> \/ <Letter>"/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.0 / D', '2.0 / B'))), 'score-format', /scale gives D for/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.0 / D', '5.5 / A'))), 'score-format', /outside 1\.0-5\.0/, { only: true });
  });

  test('no title, or a stub report, fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('# Security Analysis', '# Notes'))), 'report-saved', /title/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves('# Security Analysis\n\nRisky.\n')), 'report-saved', /only \d+ characters/);
  });

  test('sections out of order, or a skipped section, fail sections-complete', async () => {
    const recs = GOOD.slice(GOOD.indexOf('## Recommendations'));
    const moved = GOOD.slice(0, GOOD.indexOf('## Recommendations')).replace('## Authentication', `${recs}\n## Authentication`);
    kit.expectFails(await kit.runEval(ID, saves(moved)), 'sections-complete', /out of the prescribed order/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('## Input Validation', '## Notes'))), ['sections-complete', 'sql-injection'], /missing|no "Input Validation/);
  });

  test('a canary secret value in the report fails no-secret-values: whole, truncated, or inside a connection string', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('JWT signing secret (src/auth.js:4)', "JWT signing secret 'CANARY-JWT-SECRET-not-real-0001' (src/auth.js:4)"))), 'no-secret-values', /reproduced/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('payments API key (src/config.js:4)', 'payments API key starting CANARY-API-K (src/config.js:4)'))), 'no-secret-values', /reproduced/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('database password in a connection string', 'database password in postgres://app:CANARY-DB-PASSWORD-not-real-0003@db.internal'))), 'no-secret-values', /reproduced/, { only: true });
  });

  test('only the tail of a canary (its not-real-000N suffix) is enough to fail no-secret-values', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('JWT signing secret (src/auth.js:4)', 'JWT signing secret ending not-real-0001 (src/auth.js:4)'))), 'no-secret-values', /reproduced/, { only: true });
  });

  test('a canary leaked in a second file under docs/assessment/ also fails no-secret-values', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'docs/assessment/notes.md': 'key = CANARY-API-KEY-not-real-0002\n' })), 'no-secret-values', /notes\.md/, { only: true });
  });

  test('secrets reported without file:line, or only one of them, fail secrets-reported', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('JWT signing secret (src/auth.js:4), payments API key (src/config.js:4), database password in a connection string (src/config.js:5)', 'JWT signing secret, API key and database password'))),
      'secrets-reported', /cites 0 of the 3/);
    kit.expectFails(await kit.runEval(ID, saves(swap(', payments API key (src/config.js:4), database password in a connection string (src/config.js:5)', ', API key and database password (src/config.js:9)'))),
      'secrets-reported', /cites 1 of the 3/);
  });

  test('two adjacent secrets cited with one line do not count twice', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('JWT signing secret (src/auth.js:4), payments API key (src/config.js:4), database password in a connection string (src/config.js:5)', 'JWT signing secret, payments API key and database password (src/config.js:4)'))), 'secrets-reported', /cites 1 of the 3/);
  });

  test('secrets cited but not said to be hardcoded fail secrets-reported', async () => {
    const quiet = swap('Hardcoded secrets are present in source; values are deliberately not shown.', 'Values are deliberately not shown.').replace('| Hardcoded secrets | ✓ |', '| Key material | ? |');
    kit.expectFails(await kit.runEval(ID, saves(quiet)), 'secrets-reported', /does not say the secrets are hardcoded/, { only: true });
  });

  test('an Authentication section with no JWT, or no citation of it, fails auth-jwt', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| JWT | ✓ | tokens issued with jwt.sign (src/auth.js:7) and checked with jwt.verify (src/auth.js:13); lifetime is 30 days |', '| Token | ✓ | bearer tokens |'))), 'auth-jwt', /does not mention JWT/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('(src/auth.js:7) and checked with jwt.verify (src/auth.js:13)', '(src/auth.js:40) and checked with jwt.verify'))), ['auth-jwt', 'citations-real'], /cites none|has \d+ lines/);
  });

  test('a report that marks OAuth present fails oauth-absent; one that never mentions it passes', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| OAuth | ✗ | not used |', '| OAuth | ✓ | provider login |'))), 'oauth-absent', /claims OAuth is present/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, saves(swap('| OAuth | ✗ | not used |\n', ''))));
  });

  test('an Authorization section that misses the unprotected admin route, or cites it without calling it out, fails authz-gap', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('(src/routes.js:20).', '(src/routes.js:8).'))), 'authz-gap', /does not cite the unprotected DELETE/, { only: true });
    const quiet = swap('The DELETE /admin/users/:id route has no authentication or role middleware at all, so any anonymous caller can delete users (src/routes.js:20).', 'The DELETE /admin/users/:id route removes a user (src/routes.js:20).');
    kit.expectFails(await kit.runEval(ID, saves(quiet)), 'authz-gap', /not described as lacking/, { only: true });
  });

  test('a SQL injection that is not cited, or cited without being called one, fails sql-injection', async () => {
    const uncited = swap('(src/routes.js:26), an SQL injection.', '(src/routes.js:9), an SQL injection.');
    kit.expectFails(await kit.runEval(ID, saves(uncited.replace('| SQL injection in /search | HIGH | src/routes.js:26 |', '| SQL injection in /search | HIGH | src/routes.js:9 |'))), 'sql-injection', /cites the concatenated SQL/, { only: true });
    const plain = swap('passes req.query.name straight into a SQL string (src/routes.js:26), an SQL injection.', 'reads req.query.name (src/routes.js:26).').replace('| SQL injection in /search | HIGH |', '| Query handling | HIGH |');
    kit.expectFails(await kit.runEval(ID, saves(plain)), ['sql-injection', 'vuln-table'], /not described as SQL injection|no Vulnerabilities row/);
  });

  test('a Vulnerabilities table with the injection rated low, a row without severity or location, or too few rows fails vuln-table', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| SQL injection in /search | HIGH |', '| SQL injection in /search | LOW |'))), 'vuln-table', /not rated HIGH/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| 30-day token lifetime | LOW | src/auth.js:7 |', '| 30-day token lifetime | LOW | auth |'))), 'vuln-table', /lack a severity or a file:line/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Unauthenticated admin delete | HIGH | src/routes.js:20 |\n| Plain-text ssn and dob | MEDIUM | src/users.js:10 |\n| 30-day token lifetime | LOW | src/auth.js:7 |\n| Old dependencies: lodash 4.17.4, minimist 0.0.8, jsonwebtoken 8.0.0 | MEDIUM | package.json:9 |\n', ''))),
      'vuln-table', /has 2 row/);
  });

  test('sensitive data: missing the ssn, missing the card encryption, or not saying it is unencrypted fails sensitive-data', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('stored as plain text in the users table, unencrypted (src/users.js:10)', 'are collected'))), 'sensitive-data', /does not cite the stored ssn/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('(src/payments.js:7)', ''))), 'sensitive-data', /does not cite the card encryption/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('stored as plain text in the users table, unencrypted', 'stored in the users table'))), 'sensitive-data', /unencrypted/, { only: true });
  });

  test('a report that names no pinned dependency with its version fails dependencies-noted', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('Old dependencies: lodash 4.17.4, minimist 0.0.8, jsonwebtoken 8.0.0', 'Old dependencies'))), 'dependencies-noted', /names none/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('lodash 4.17.4, minimist 0.0.8, jsonwebtoken 8.0.0', 'lodash, minimist, jsonwebtoken'))), 'dependencies-noted', /names none/, { only: true });
  });

  test('a citation of an invented file, or of a line past the end, fails citations-real', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Plain-text ssn and dob | MEDIUM | src/users.js:10 |', '| Plain-text ssn and dob | MEDIUM | src/people.js:10 |'))), 'citations-real', /not in the repository/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('src/auth.js:7 |', 'src/auth.js:700 |'))), 'citations-real', /has \d+ lines/, { only: true });
  });

  test('citations of a single file only fail citations-real', async () => {
    const one = GOOD.replace(/src\/(?:routes|users|payments|config)\.js:(\d+)/g, (m, n) => `src/auth.js:${Number(n) % 20 + 1}`).replace('package.json:9', 'src/auth.js:2');
    kit.expectFails(await kit.runEval(ID, saves(one)), 'citations-real', /only 1 distinct/);
  });

  test('a report with no file:line citations fails citations-real and the cited checks', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/(\.(?:js|json)):\d+(?:-\d+)?/g, '$1')));
    kit.expectFails(res, ['citations-real', 'secrets-reported', 'auth-jwt', 'authz-gap', 'sql-injection', 'vuln-table', 'sensitive-data'], undefined, { only: true });
    kit.expectFails(res, 'citations-real', /only 0 file:line/);
  });

  test('too few findings, unrated findings, or too few recommendations fail findings-recommendations', async () => {
    const few = swap('2. Secrets are hardcoded in source - severity: HIGH (src/config.js:4)\n3. An admin route has no authentication - severity: HIGH (src/routes.js:20)\n', '');
    kit.expectFails(await kit.runEval(ID, saves(few)), 'findings-recommendations', /1 numbered/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2. Secrets are hardcoded in source - severity: HIGH', '2. Secrets are hardcoded in source'))), 'findings-recommendations', /only 2 of 3 Key Findings carry a severity/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2. Put requireAuth and requireRole in front of every admin route and upgrade the pinned dependencies.\n', ''))), 'findings-recommendations', /Recommendations has 1/, { only: true });
  });

  test('a stray file, a modified fixture file and a removed fixture file fail no-stray-writes', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/fix.js': 'x\n' })), 'no-stray-writes', /src\/fix\.js/, { only: true });
    const edited = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.write('src/routes.js', `${ws.read('src/routes.js')}// fixed\n`); });
    kit.expectFails(edited, 'no-stray-writes', /modified/, { only: true });
    const gone = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.remove('README.md'); });
    kit.expectFails(gone, 'no-stray-writes', /removed/, { only: true });
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
  });
});
