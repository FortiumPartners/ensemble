'use strict';

/**
 * Proof that the checks of the `ensemble-list-issue` eval can pass and can fail (kit: evals/tests/skill-eval-kit.js). The model is faked:
 * each stub agent writes the listing.md (and the br/bv stubs' call logs) a good or bad run would leave. No model, no network, no real br.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');

const ID = 'ensemble-list-issue';
const IDS = ['listing-saved', 'open-issues', 'no-closed', 'tracker-read', 'read-only'];

const GOOD = `Open issues (3):

| ID | Title | Type | Priority |
|---|---|---|---|
| br-3k1 | Fix login redirect loop | bug | 1 |
| br-7m2 | Add CSV export for reports | feature | 2 |
| br-9q4 | Document the retry policy | task | 3 |
`;

const BR_CALLS = ['--version', 'list --all --limit 0 --json'];
const BV_CALLS = ['--version'];

const writeLog = (ws, name, calls) => { if (calls !== null) fs.writeFileSync(path.join(ws.root, name), `${calls.join('\n')}\n`); };

/** A stub agent: saves `text` (null: none) as listing.md, writes the stubs' call logs (default: the reads a good run makes) and extra files. */
const run = (text, { br = BR_CALLS, bv = BV_CALLS, extra = {} } = {}) => (ws) => {
  if (text !== null) ws.write('listing.md', text);
  writeLog(ws, 'br-calls.log', br);
  writeLog(ws, 'bv-calls.log', bv);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`test setup: ${from} not in the listing`);
  return text.replace(from, to);
};

describe(ID, () => {
  test('loads clean: valid definition, a fixture with the stubs and no agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.sandboxPath).toEqual(['bin']);
  });

  test('a good listing passes every check', async () => {
    const res = await kit.runEval(ID, run(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('other layouts pass: a bullet list, id after title, a table plus ranking words', async () => {
    const bullets = '# Open issues\n\n- br-3k1: Fix login redirect loop [P1, bug]\n- br-7m2: Add CSV export for reports [P2]\n- br-9q4: Document the retry policy [P3]\n';
    kit.expectAllPass(await kit.runEval(ID, run(bullets)));
    const titleFirst = '1. Fix login redirect loop (BR-3K1)\n2. Add CSV export for reports (br-7m2)\n3. Document the retry policy (br-9q4)\n';
    kit.expectAllPass(await kit.runEval(ID, run(titleFirst)));
    const split = '### br-3k1\nFix login redirect loop\n\n### br-7m2\nAdd CSV export\nfor reports\n\n### br-9q4\nDocument the retry policy\n';
    kit.expectAllPass(await kit.runEval(ID, run(split)));
  });

  test('the fixture alone (a run that does nothing) fails the listing and tracker checks, and passes read-only', async () => {
    const res = await kit.runEval(ID, run(null, { br: null, bv: null }));
    kit.expectFails(res, ['listing-saved', 'open-issues', 'no-closed', 'tracker-read'], undefined, { only: true });
  });

  test('the closed issue listed (no status filter) fails no-closed and open-issues', async () => {
    const res = await kit.runEval(ID, run(`${GOOD}| br-2z8 | Remove legacy cookie banner | task | 3 |\n`));
    kit.expectFails(res, ['no-closed', 'open-issues'], undefined, { only: true });
    kit.expectFails(res, 'no-closed', /closed issue br-2z8/);
  });

  test('only the title of the closed issue fails no-closed', async () => {
    const res = await kit.runEval(ID, run(`${GOOD}\nRemoved: Remove legacy cookie banner\n`));
    kit.expectFails(res, 'no-closed', /title of the closed issue br-2z8/, { only: true });
  });

  test('only the id of the closed issue fails no-closed', async () => {
    const res = await kit.runEval(ID, run(`${GOOD}\nSkipped br-2z8.\n`));
    kit.expectFails(res, 'no-closed', /closed issue br-2z8/);
  });

  test('ids far from their titles (an id block, then a title block) fail open-issues', async () => {
    const far = 'br-3k1\nbr-7m2\nbr-9q4\n\n\n\n\nFix login redirect loop\nAdd CSV export for reports\nDocument the retry policy\n';
    kit.expectFails(await kit.runEval(ID, run(far)), 'open-issues', /does not show id and title of: br-3k1/, { only: true });
  });

  test('an open issue missing fails open-issues', async () => {
    const res = await kit.runEval(ID, run(GOOD.replace(/^\| br-7m2.*\n/m, '')));
    kit.expectFails(res, 'open-issues', /br-7m2/, { only: true });
  });

  test('ids without titles, and titles without ids, fail open-issues', async () => {
    kit.expectFails(await kit.runEval(ID, run('Open issues: br-3k1, br-7m2, br-9q4 (three of them, all unassigned and waiting for triage).\n')), 'open-issues', /br-3k1/, { only: true });
    kit.expectFails(await kit.runEval(ID, run('Open issues: Fix login redirect loop; Add CSV export for reports; Document the retry policy (three).\n')), 'open-issues', /br-3k1/, { only: true });
  });

  test('a wrong title for an id, and an invented issue, fail open-issues', async () => {
    kit.expectFails(await kit.runEval(ID, run(swap(GOOD, '| br-9q4 | Document the retry policy |', '| br-9q4 | Rotate the API keys |'))), 'open-issues', /br-9q4/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(`${GOOD}| br-5x5 | Upgrade the build image | task | 2 |\n`)), 'open-issues', /not open: br-5x5/, { only: true });
  });

  test('a short stub listing fails listing-saved', async () => {
    kit.expectFails(await kit.runEval(ID, run('br-3k1\n')), 'listing-saved', /too short/);
  });

  test('a listing written without ever calling br fails tracker-read only', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { br: null })), 'tracker-read', /recorded no call/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { br: ['--version'] })), 'tracker-read', /no `br list`/, { only: true });
  });

  test('a br write fails read-only (and only that)', async () => {
    for (const w of ['close br-3k1 --json', 'update br-7m2 --status in_progress', 'create --title x', 'comments add br-9q4 hi', 'sync --flush-only']) {
      kit.expectFails(await kit.runEval(ID, run(GOOD, { br: [...BR_CALLS, w] })), 'read-only', /br was asked to do more than read/, { only: true });
    }
  });

  test('a read-only br show and the ranked bv --robot-plan pass; an unknown bv call fails read-only', async () => {
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { br: [...BR_CALLS, 'show br-3k1 --json'], bv: [...BV_CALLS, '--robot-plan --format json'] })));
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: [...BV_CALLS, '--robot-apply'] })), 'read-only', /bv was asked to do more than read/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: [...BV_CALLS, '--robot-planner'] })), 'read-only', /bv was asked to do more than read/, { only: true });
  });

  test('tampering with the seeded issues, or a file written outside the listing, fails read-only', async () => {
    const res = await kit.runEval(ID, (ws) => {
      run(GOOD)(ws);
      ws.write('bin/canned/issues.json', '{"issues":[{"id":"br-3k1"}]}\n');
    });
    kit.expectFails(res, 'read-only', /seeded issue data changed: 1 issues, expected 4/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: { 'triage.md': 'plan\n' } })), 'read-only', /triage\.md/, { only: true });
  });

  test('arms: the command prefixes only the with-skill prompt; baseline loads no plugin, with-skill loads packages/development', async () => {
    const ev = kit.loadsClean(ID);
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(withSkill.prompt.startsWith(`${ev.command} `)).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/development$/);
  }, 60000);
});
