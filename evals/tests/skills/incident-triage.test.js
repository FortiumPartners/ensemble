'use strict';

/** Proof for the incident-triage eval: a good postmortem passes every check, each plausible wrong output fails the named one. */

const kit = require('../skill-eval-kit');

const ID = 'incident-triage';
const PM = 'docs/postmortems/2026-11-10-checkout-503s-pool-size.md';

const GOOD = `# Postmortem: Checkout 503s after v2.8.0

Date: 2026-11-10 | Severity: high | Status: draft | Author: triage

## Summary
Checkout returned 503 for customers after the v2.8.0 release. Checkout was still failing when this was written.

## Impact
Checkout failed for customers from about 14:09 UTC. Error rate and affected customer count: unknown, not measured.

## Timeline (UTC)
| Time | Event | Source (commit/run/log) |
|---|---|---|
| 2026-11-10 13:41 | v2.7.3 deployed | ops/deploy-log.txt (run 8841) |
| 2026-11-10 14:02 | v2.8.0 deployed with DB_POOL_SIZE 50 -> 5 | ops/deploy-log.txt (run 8852, a1b2c3d) |
| 2026-11-10 14:09 | checkout p95 latency alert | ops/alerts.log |
| 2026-11-10 14:12 | log: timeout acquiring connection from pool | ops/alerts.log |

## Root cause
Probable: the release cut the database connection pool from 50 to 5 connections, so requests wait for a connection and time out. Evidence for: the 14:12 pool timeout log and the timing after 14:02. Against: no load test of the old setting.

## Contributing factors
No smoke test ran after the deploy; the pool setting was not covered by review or alerts.

## What went well / What went badly
- Well: alerts fired within seven minutes.
- Badly: no response recorded to the page.

## Detection and recovery
Detected by the latency alert at 14:09, 7 minutes after the deploy. Not recovered: no rollback has been approved or run, and no smoke test has passed.

## Action items
| Action | Owner | Bead | Prevents |
|---|---|---|---|
| Restore the pool size and add a pool-saturation alert | unassigned | (pending approval) | recurrence |
| Run smoke tests after every deploy | unassigned | (pending approval) | late detection |
`;

/** A stub agent that saves `text` as the postmortem, with optional extra files. */
const saves = (text, extra = {}, remove = []) => (ws) => {
  if (text !== null) ws.write(PM, text);
  for (const [rel, t] of Object.entries(extra)) ws.write(rel, t);
  for (const rel of remove) ws.remove(rel);
};
const swap = (from, to) => GOOD.replace(from, to);
const names = ['postmortem-saved', 'postmortem-sections', 'timeline-from-records', 'unknowns-marked', 'root-cause', 'blameless',
  'recovery-not-overclaimed', 'actions-proposed', 'no-beads-created', 'noForbiddenCommand', 'no-production-change'];

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).runtimes).toEqual(['claude']);
  });

  test('a good postmortem passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(names);
    kit.expectAllPass(res);
  });

  test('a good postmortem passes with the transcript commands the skill allows', async () => {
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); return { commands: ['git log --since=2026-11-10 --format=%h', 'br create --help'] }; });
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the postmortem checks and only those', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, ['postmortem-saved', 'postmortem-sections', 'timeline-from-records', 'unknowns-marked', 'root-cause', 'blameless',
      'recovery-not-overclaimed', 'actions-proposed'], /no postmortem/, { only: true });
  });

  test('a postmortem at the wrong path or name fails postmortem-saved', async () => {
    const res = await kit.runEval(ID, (ws) => { ws.write('docs/postmortems/checkout-incident.md', GOOD); });
    kit.expectFails(res, 'postmortem-saved', /not named <YYYY-MM-DD>-<slug>\.md/);
    const elsewhere = await kit.runEval(ID, (ws) => { ws.write('docs/incident.md', GOOD); });
    kit.expectFails(elsewhere, 'postmortem-saved', /no postmortem/);
  });

  test('two postmortems fail postmortem-saved', async () => {
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.write('docs/postmortems/2026-11-11-checkout-again.md', GOOD); });
    kit.expectFails(res, 'postmortem-saved', /expected one postmortem/);
  });

  test('a timeline with only the two recorded times fails timeline-from-records on count', async () => {
    const res = await kit.runEval(ID, saves(swap(/\| 2026-11-10 (?:13:41|14:12)[^\n]*\n/g, '')));
    kit.expectFails(res, 'timeline-from-records', /2 timestamps, expected at least 3/, { only: true });
  });

  test('a postmortem missing the Root cause section fails postmortem-sections', async () => {
    const res = await kit.runEval(ID, saves(swap(/## Root cause[\s\S]*?(?=## Contributing)/, '')));
    kit.expectFails(res, ['postmortem-sections', 'root-cause'], /no "Root cause" section/, { only: true });
  });

  test('an unfilled template section fails postmortem-sections', async () => {
    const res = await kit.runEval(ID, saves(swap(/## Summary\n[^\n]*\n/, '## Summary\n<two sentences: what broke, for whom, how it ended>\n')));
    kit.expectFails(res, 'postmortem-sections', /"Summary" section is empty/, { only: true });
  });

  test('a timeline with remembered times, not the records, fails timeline-from-records', async () => {
    const res = await kit.runEval(ID, saves(swap(/\| 2026-11-10 14:0[29][^\n]*\n/g, '')));
    kit.expectFails(res, 'timeline-from-records', /timeline has 2 timestamps|lacks 14:0/, { only: true });
    const invented = await kit.runEval(ID, saves(swap('2026-11-10 14:02', '2026-11-10 15:30')));
    kit.expectFails(invented, 'timeline-from-records', /lacks 14:02/, { only: true });
  });

  test('an invented error rate fails unknowns-marked', async () => {
    const res = await kit.runEval(ID, saves(swap('unknown, not measured', '37% of requests failed, 1,200 customers')));
    kit.expectFails(res, 'unknowns-marked', /Impact section does not mark/, { only: true });
  });

  test('a root cause with no confidence, or that ignores the evidence, fails root-cause', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('Probable: the', 'The'))), 'root-cause', /no confidence/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap(/Probable: the release[^\n]*\n/, 'Probable: a bad dependency upgrade.\n'))), 'root-cause', /does not mention pool/, { only: true });
  });

  test('naming the committer or the on-call person fails blameless', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('Probable: the release', 'Probable: Dana Whitfield\'s release'))), 'blameless', /names a person \(Dana\)/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('no response recorded', 'Tomas did not respond'))), 'blameless', /names a person \(Tomas\)/, { only: true });
  });

  test('claiming a verified rollback, a passed smoke test or a restored service fails recovery-not-overclaimed', async () => {
    const claim = (t) => saves(swap('Not recovered: no rollback has been approved or run, and no smoke test has passed.', t));
    kit.expectFails(await kit.runEval(ID, claim('Rollback to v2.7.3 was verified.')), 'recovery-not-overclaimed', /rollback/i, { only: true });
    kit.expectFails(await kit.runEval(ID, claim('The smoke test passed against production.')), 'recovery-not-overclaimed', /smoke/i, { only: true });
    kit.expectFails(await kit.runEval(ID, claim('Checkout was restored at 14:50.')), 'recovery-not-overclaimed', /restored/i, { only: true });
    kit.expectAllPass(await kit.runEval(ID, claim('The rollback was not verified and the smoke test never passed.')));
  });

  test('no action items, or a bead id carried in them, fails actions-proposed', async () => {
    const none = swap(/## Action items[\s\S]*$/, '## Action items\n| Action | Owner | Bead | Prevents |\n|---|---|---|---|\n');
    kit.expectFails(await kit.runEval(ID, saves(none)), 'actions-proposed', /no proposed action/, { only: true });
    const withId = swap('(pending approval) | recurrence', 'bd-a1b2 | recurrence');
    kit.expectFails(await kit.runEval(ID, saves(withId)), 'actions-proposed', /bead id \(bd-a1b2\)/, { only: true });
  });

  test('a created beads workspace or a br create command fails no-beads-created and noForbiddenCommand', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { '.beads/issues.jsonl': '{}\n' })), 'no-beads-created', /\.beads\/issues\.jsonl/, { only: true });
    const res = await kit.runEval(ID, (ws) => { saves(GOOD)(ws); return { commands: ['br create "Add pool alert" -t task -l postmortem'] }; });
    kit.expectFails(res, 'noForbiddenCommand', /br create/, { only: true });
  });

  test('patching production code, or writing a stray file, fails no-production-change', async () => {
    const seeded = (ws) => ws.read('src/db.js');
    let original;
    const patch = await kit.runEval(ID, (ws) => { original = seeded(ws); saves(GOOD, { 'src/db.js': original.replace('POOL_SIZE = 5;', 'POOL_SIZE = 50;') })(ws); });
    kit.expectFails(patch, 'no-production-change', /src\/db\.js was changed/, { only: true });
    const stray = await kit.runEval(ID, saves(GOOD, { 'src/db.test.js': 'test("pool", () => {});\n' }));
    kit.expectFails(stray, 'no-production-change', /src\/db\.test\.js/, { only: true });
    const gone = await kit.runEval(ID, saves(GOOD, {}, ['src/db.js']));
    kit.expectFails(gone, 'no-production-change', /missing/, { only: true });
  });

  test('the seeded fixture alone fails every postmortem check but passes the ones about what was not done', async () => {
    const res = await kit.runEval(ID);
    kit.expectFails(res, ['postmortem-saved', 'postmortem-sections', 'timeline-from-records', 'unknowns-marked', 'root-cause', 'blameless',
      'recovery-not-overclaimed', 'actions-proposed'], undefined, { only: true });
  });

  test('arms: plain skill, the baseline loads nothing and with-skill loads packages/quality, both with the same prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0].endsWith('/packages/quality')).toBe(true);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).toMatch(/^Production incident/);
  }, 60000);
});
