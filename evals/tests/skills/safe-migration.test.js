'use strict';

/** Proof that the safe-migration checks pass on a good run and fail, each for its own reason, on plausible wrong ones. */

const kit = require('../skill-eval-kit');

const ID = 'safe-migration';
const TRD = 'docs/TRD/TRD-2026-c3d4e5f6-user-names.md';
const EXPAND = 'db/migrations/002_add_first_last_name.sql';
const ROLLBACK = 'docs/migrations/2026-11-13-split-fullname-rollback.md';
const SEEDED_001 = `-- 001
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  fullname VARCHAR(200) NOT NULL
);
`;

const PLAN = `
Record of the change that splits users.fullname into first_name and last_name on a table of about 2 million rows.

### Phase 1: Expand

Add nullable first_name and last_name columns next to fullname in migration 002. Old code keeps inserting fullname only.

### Phase 2: Migrate

Backfill first_name and last_name from fullname in batches, dual-write both shapes, and switch reads behind a feature flag once a comparison job shows they agree.

### Phase 3: Contract

Drop fullname only after one release in production with no readers (verified by grep and logs). The contract phase needs its own explicit approval; approval of this plan is not approval of the contract.

### Dry run

Restore last night's production snapshot to a scratch database and run phases 1 and 2 there. Record the row counts before and after (users: 2,000,000 rows) and the timing.
`;

const TRD_GOOD = `${'---\ndocument_id: TRD-2026-c3d4e5f6\n---\n\n# TRD: Structured user names\n\n## Tasks\n\n- [ ] TRD-001: Store first and last name\n\n'}## Migration Plan\n${PLAN}\n## Non-goals\n\n- Changing the sign-up form.\n`;

const EXPAND_SQL = `-- expand: additive only
ALTER TABLE users ADD COLUMN first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN last_name VARCHAR(100);
`;

const ROLLBACK_MD = `# Rollback: split users.fullname

To undo phase 1 run \`ALTER TABLE users DROP COLUMN first_name, DROP COLUMN last_name;\`.
fullname is never dropped before the contract phase, so no data is lost until then.

After the contract phase, restore users.fullname from the backup \`users-pre-contract-2026-11-13\` (snapshot id snap-0123):
\`pg_restore --table users --data-only users-pre-contract-2026-11-13.dump\`
`;

/** The stub agent: a good run, with any piece replaced or dropped by `over` (a value of null drops the file). */
const writes = (over = {}) => (ws) => {
  const files = { [TRD]: TRD_GOOD, [EXPAND]: EXPAND_SQL, [ROLLBACK]: ROLLBACK_MD, ...over };
  for (const [rel, body] of Object.entries(files)) if (body !== null) ws.write(rel, body);
};

describe(ID, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('a good run passes every check', async () => {
    const res = await kit.runEval(ID, writes());
    expect(Object.keys(res)).toEqual([
      'plan-section', 'plan-phases', 'plan-dry-run', 'plan-approval-gate', 'expand-migration',
      'rollback-saved', 'rollback-content', 'no-early-destructive', 'history-immutable',
    ]);
    kit.expectAllPass(res);
  });

  test('a down migration under db/ is a valid rollback and may drop the new columns', async () => {
    const down = 'db/migrations/002_add_first_last_name.down.sql';
    const res = await kit.runEval(ID, writes({ [ROLLBACK]: null, [down]: '-- undo expand on users\nALTER TABLE users DROP COLUMN first_name;\nALTER TABLE users DROP COLUMN last_name;\nDROP TABLE users_name_backfill;\n' }));
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every output check; only the guards on untouched files pass', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['plan-section', 'plan-phases', 'plan-dry-run', 'plan-approval-gate', 'expand-migration', 'rollback-saved', 'rollback-content'], undefined, { only: true });
    expect(res['expand-migration'].detail).toMatch(/no new \.sql migration/);
    expect(res['rollback-saved'].detail).toMatch(/no rollback file/);
  });

  test('a Migration Plan of a few words fails plan-section; so does a heading of level 1 or 4', async () => {
    const short = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, '\nExpand, migrate, contract.\n') }));
    kit.expectFails(short, 'plan-section', /only \d+ words/);
    for (const h of ['# Migration Plan', '#### Migration Plan']) {
      const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace('## Migration Plan', h) }));
      kit.expectFails(res, 'plan-section', /no `## Migration Plan` section/);
    }
  });

  test('a TRD with no Migration Plan section fails plan-section, and the checks that read the plan', async () => {
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace('## Migration Plan', '## Notes') }));
    kit.expectFails(res, ['plan-section', 'plan-phases', 'plan-dry-run', 'plan-approval-gate'], /Migration Plan/, { only: true });
  });

  test('a one-step plan (rename in place) fails plan-phases', async () => {
    const plan = 'Rename the column fullname to first_name in one migration and deploy the new code together with it. The table has about 2 million rows, so run it in a quiet hour and keep an eye on the dashboards afterwards. Dry run on a snapshot with row counts first; the contract needs approval.';
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, plan) }));
    kit.expectFails(res, 'plan-phases', /never names the expand/, { only: true });
  });

  test('phases out of order (contract before expand) fail plan-phases', async () => {
    const plan = `${'Contract first: drop the old shape. Then migrate readers. Then expand. '.repeat(1)}The contract needs approval. Dry run on a snapshot, row counts recorded. ${'Filler words so the plan is long enough to count as a plan. '.repeat(3)}`;
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, plan) }));
    kit.expectFails(res, 'plan-phases', /no (?:migrate|contract)/, { only: true });
  });

  test('a plan that stops after migrate (no contract phase) fails plan-phases', async () => {
    const plan = PLAN.replace(/### Phase 3: Contract[\s\S]*?(?=### Dry run)/, '');
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, plan) }));
    kit.expectFails(res, 'plan-phases', /no contract phase after migrate/);
    kit.expectFails(res, 'plan-approval-gate', /approval/);
  });

  test('a plan with no dry run on a copy fails plan-dry-run', async () => {
    const plan = PLAN.replace(/### Dry run[\s\S]*$/, '### Testing\n\nRun the unit tests in CI.\n');
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, plan) }));
    kit.expectFails(res, 'plan-dry-run', /dry run/, { only: true });
  });

  test('a dry run without row counts fails plan-dry-run', async () => {
    const plan = PLAN.replace(/Record the row counts before and after \(users: 2,000,000 rows\) and the timing\./, 'Note how long it takes.').replace('about 2 million rows', 'a big table');
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, plan) }));
    kit.expectFails(res, 'plan-dry-run', /row counts/, { only: true });
  });

  test('a plan that does not gate the contract phase on approval fails plan-approval-gate', async () => {
    const plan = PLAN.replace(/ The contract phase needs its own explicit approval; approval of this plan is not approval of the contract\./, '');
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, plan) }));
    kit.expectFails(res, 'plan-approval-gate', /approval/, { only: true });
  });

  test('an approval that is nowhere near the contract phase does not satisfy plan-approval-gate', async () => {
    const plan = PLAN.replace(/ The contract phase needs its own explicit approval; approval of this plan is not approval of the contract\./, '')
      + `\n### Schedule\n\n${'The change window is the second Tuesday of the month, outside the billing run. '.repeat(6)}\nThe date was approved by the team lead.\n`;
    const res = await kit.runEval(ID, writes({ [TRD]: TRD_GOOD.replace(PLAN, plan.replace(/contract/gi, 'final')).replace('### Phase 3: final', '### Phase 3: Contract') }));
    kit.expectFails(res, 'plan-approval-gate', /approval/, { only: true });
  });

  test('a NOT NULL column with no default fails expand-migration', async () => {
    const sql = 'ALTER TABLE users ADD COLUMN first_name VARCHAR(100) NOT NULL, ADD COLUMN last_name VARCHAR(100);\n';
    const res = await kit.runEval(ID, writes({ [EXPAND]: sql }));
    kit.expectFails(res, 'expand-migration', /first_name is added NOT NULL/, { only: true });
  });

  test('NOT NULL with a default is a valid expand; a migration that adds only one of the columns fails', async () => {
    kit.expectAllPass(await kit.runEval(ID, writes({ [EXPAND]: "ALTER TABLE users ADD COLUMN first_name VARCHAR(100) NOT NULL DEFAULT '';\nALTER TABLE users ADD COLUMN last_name VARCHAR(100);\n" })));
    const res = await kit.runEval(ID, writes({ [EXPAND]: 'ALTER TABLE users ADD COLUMN first_name VARCHAR(100);\n' }));
    kit.expectFails(res, 'expand-migration', /last_name/, { only: true });
  });

  test('a rollback that is a stub fails rollback-saved', async () => {
    const res = await kit.runEval(ID, writes({ [ROLLBACK]: '# Rollback\n\nRestore from backup.\n' }));
    kit.expectFails(res, 'rollback-saved', /stub/);
  });

  test('a generic rollback that names no table or column fails rollback-content', async () => {
    const res = await kit.runEval(ID, writes({ [ROLLBACK]: '# Rollback\n\nIf something goes wrong:\n\n1. Revert the deploy.\n2. Run the down script and restore the database backup.\n3. Tell the team.\n' }));
    kit.expectFails(res, 'rollback-content', /names neither/, { only: true });
  });

  test('a rollback that says how to undo but not how data is restored fails rollback-content', async () => {
    const res = await kit.runEval(ID, writes({ [ROLLBACK]: '# Rollback\n\nRun ALTER TABLE users DROP COLUMN first_name; and ALTER TABLE users DROP COLUMN last_name; to undo.\nThe fullname column stays.\n' }));
    kit.expectFails(res, 'rollback-content', /how data is restored/, { only: true });
  });

  test('a rollback that has the table and a restore path but no undo command fails rollback-content', async () => {
    const res = await kit.runEval(ID, writes({ [ROLLBACK]: '# Rollback\n\nNothing to undo for users: first_name and last_name stay empty until backfilled.\nThe fullname column is untouched. Keep the nightly backup and snapshot until the contract phase.\n' }));
    kit.expectFails(res, 'rollback-content', /no undo command/, { only: true });
  });

  test('a migration that drops the old column now fails no-early-destructive', async () => {
    const res = await kit.runEval(ID, writes({ [EXPAND]: `${EXPAND_SQL}ALTER TABLE users DROP COLUMN fullname;\n` }));
    kit.expectFails(res, 'no-early-destructive', /db\/migrations\/002_add_first_last_name\.sql/, { only: true });
  });

  test('a rename of the old column in a second file fails no-early-destructive', async () => {
    const res = await kit.runEval(ID, writes({ 'db/migrations/003_rename.sql': 'ALTER TABLE users RENAME COLUMN fullname TO legacy_name;\n' }));
    kit.expectFails(res, 'no-early-destructive', /003_rename/, { only: true });
  });

  test('editing the applied migration in place fails history-immutable', async () => {
    const res = await kit.runEval(ID, writes({ 'db/migrations/001_create_users.sql': `${SEEDED_001.replace(/\);\n$/, '')},\n  first_name VARCHAR(100),\n  last_name VARCHAR(100)\n);\n` }));
    kit.expectFails(res, 'history-immutable', /edited in place/, { only: true });
  });

  test('an applied migration rewritten so it no longer creates the old column fails history-immutable', async () => {
    const res = await kit.runEval(ID, writes({ 'db/migrations/001_create_users.sql': '-- 001 intentionally emptied\nCREATE TABLE users (id BIGSERIAL PRIMARY KEY);\n' }));
    kit.expectFails(res, 'history-immutable', /no longer creates/, { only: true });
  });

  test('deleting the applied migration fails history-immutable', async () => {
    const res = await kit.runEval(ID, (ws) => { writes()(ws); ws.remove('db/migrations/001_create_users.sql'); });
    kit.expectFails(res, 'history-immutable', /deleted/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the prompt is the same in both and is not a command', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/development$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
