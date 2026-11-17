'use strict';

/** Kit test for the `ensemble-new-feature` eval: the checks pass on a correct approval-checkpoint record and fail on plausible wrong ones. */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-new-feature';
const RUN = '.ensemble/new-feature/7f3a9c1e5b2d4086.json';
const IDS = ['approval-recorded', 'approval-labelled-foreman', 'single-mutation', 'no-pr-approval', 'lineage-intact', 'one-run-and-lock', 'nothing-else-written'];

/** The seeded record after a correct foreman grant, with `patch` applied on top; `fn` may edit the parsed record first. */
const granted = (ws, patch = {}) => {
  const rec = JSON.parse(ws.read(RUN));
  Object.assign(rec, {
    stage: 'implementation',
    implementationApprovedAt: new Date().toISOString(),
    stageOutcome: { kind: 'approval_wait', detail: 'implementation approval granted by --foreman policy (no human present)', recordedAt: new Date().toISOString() },
    revision: rec.revision + 1,
    updatedAt: new Date().toISOString(),
  }, patch);
  ws.write(RUN, `${JSON.stringify(rec, null, 2)}\n`);
};

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('a correct foreman grant passes every check', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that changes nothing fails the grant checks and passes the ones about what must stay put', async () => {
    const res = await kit.runEval(ID);
    kit.expectFails(res, ['approval-recorded', 'approval-labelled-foreman', 'single-mutation'], undefined, { only: true });
  });

  test('a grant labelled as a human approval fails approval-labelled-foreman only', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { stageOutcome: { kind: 'approval_wait', detail: 'approved by the user', recordedAt: new Date().toISOString() } }));
    kit.expectFails(res, 'approval-labelled-foreman', /foreman policy/, { only: true });
  });

  test('a grant that skips the outcome record (kind success) fails approval-labelled-foreman', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { stageOutcome: { kind: 'success', detail: 'foreman', recordedAt: new Date().toISOString() } }));
    kit.expectFails(res, 'approval-labelled-foreman', /approval_wait/, { only: true });
  });

  test('a grant that leaves the stage at implementation_approval fails approval-recorded', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { stage: 'implementation_approval' }));
    kit.expectFails(res, 'approval-recorded', /expected "implementation"/, { only: true });
  });

  test('a copied (seed-old) approval timestamp fails approval-recorded', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { implementationApprovedAt: '2026-10-06T07:00:00.000Z' }));
    kit.expectFails(res, 'approval-recorded', /older than the seeded/, { only: true });
  });

  test('a record edited without the revision bump fails single-mutation', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { revision: 9 }));
    kit.expectFails(res, 'single-mutation', /expected 10/, { only: true });
  });

  test('running past the checkpoint into PR approval fails no-pr-approval', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { stage: 'pr_create', prApprovedAt: new Date().toISOString() }));
    kit.expectFails(res, ['no-pr-approval', 'approval-recorded'], undefined, { only: true });
    expect(res['no-pr-approval'].detail).toMatch(/prApprovedAt/);
  });

  test('a fabricated pr: reference fails no-pr-approval', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { beadRefs: ['br-s1a1', 'br-s1a2', 'br-s1a3', 'pr:https://example.invalid/pull/1'] }));
    kit.expectFails(res, ['no-pr-approval', 'lineage-intact'], undefined, { only: true });
    expect(res['no-pr-approval'].detail).toMatch(/PR reference/);
  });

  test('a rewritten artifact lineage fails lineage-intact', async () => {
    const res = await kit.runEval(ID, (ws) => {
      const rec = JSON.parse(ws.read(RUN));
      granted(ws, { artifacts: rec.artifacts.slice(0, 3) });
    });
    kit.expectFails(res, 'lineage-intact', /artifacts\[\]/, { only: true });
  });

  test('a second run record (a new run started instead of resuming) fails one-run-and-lock and nothing-else-written', async () => {
    const res = await kit.runEval(ID, (ws) => {
      granted(ws);
      ws.write('.ensemble/new-feature/aaaaaaaaaaaaaaaa.json', '{}\n');
    });
    kit.expectFails(res, ['one-run-and-lock', 'nothing-else-written'], undefined, { only: true });
  });

  test('a released lock fails one-run-and-lock only', async () => {
    const res = await kit.runEval(ID, (ws) => { granted(ws); ws.remove('.ensemble/new-feature/active.lock'); });
    kit.expectFails(res, 'one-run-and-lock', /active\.lock was removed/, { only: true });
  });

  test('a new PRD or code written next to a good grant fails nothing-else-written', async () => {
    const res = await kit.runEval(ID, (ws) => { granted(ws); ws.write('src/slugify.js', 'module.exports = {};\n'); ws.write('docs/PRD/PRD-2026-ffffffff-new.md', '# new\n'); });
    kit.expectFails(res, 'nothing-else-written', /src\/slugify\.js/, { only: true });
  });

  test('a stage that re-ran and rewrote the TRD fails nothing-else-written', async () => {
    const res = await kit.runEval(ID, (ws) => {
      granted(ws);
      ws.write('docs/TRD/TRD-2026-5c0de1a7-slugify.md', ws.read('docs/TRD/TRD-2026-5c0de1a7-slugify.md').replace('version: 1.0.1', 'version: 1.0.2'));
    });
    kit.expectFails(res, 'nothing-else-written', /version changed/, { only: true });
  });

  test('a run marked completed or abandoned fails approval-recorded', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { status: 'completed' }));
    kit.expectFails(res, 'approval-recorded', /must stay active/, { only: true });
  });

  test('a lock that names another run fails one-run-and-lock only', async () => {
    const res = await kit.runEval(ID, (ws) => { granted(ws); ws.write('.ensemble/new-feature/active.lock', 'aaaaaaaaaaaaaaaa'); });
    kit.expectFails(res, 'one-run-and-lock', /active\.lock names/, { only: true });
  });

  test('an outcome that names foreman but no approval fails approval-labelled-foreman', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { stageOutcome: { kind: 'approval_wait', detail: 'foreman was here', recordedAt: new Date().toISOString() } }));
    kit.expectFails(res, 'approval-labelled-foreman', /not an approval or grant/, { only: true });
  });

  test('an updatedAt that did not advance fails single-mutation', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { updatedAt: '2026-10-06T14:50:00.000Z' }));
    kit.expectFails(res, 'single-mutation', /updatedAt was not advanced/, { only: true });
  });

  test('a rewritten projectRoot fails lineage-intact only', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { projectRoot: '/somewhere/else' }));
    kit.expectFails(res, 'lineage-intact', /projectRoot/, { only: true });
  });

  test('a run driven on to done without any PR approval fails no-pr-approval (and approval-recorded)', async () => {
    const res = await kit.runEval(ID, (ws) => granted(ws, { stage: 'done' }));
    kit.expectFails(res, ['no-pr-approval', 'approval-recorded'], undefined, { only: true });
    expect(res['no-pr-approval'].detail).toMatch(/past implementation/);
  });

  test('a run record that is not JSON fails every record check', async () => {
    const res = await kit.runEval(ID, (ws) => ws.write(RUN, 'not json'));
    kit.expectFails(res, ['approval-recorded', 'approval-labelled-foreman', 'single-mutation', 'no-pr-approval', 'lineage-intact'], /not valid JSON/, { only: true });
  });

  test('a symlinked run record is not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      granted(ws);
      ws.write('real.json', ws.read(RUN));
      ws.remove(RUN);
      require('fs').symlinkSync(`${ws.dir}/real.json`, `${ws.dir}/${RUN}`);
    });
    kit.expectFails(res, 'approval-recorded', /symlinks are not followed/);
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.prompt.startsWith('/ensemble-development:ensemble:new-feature docs/TRD/')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
