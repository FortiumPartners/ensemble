'use strict';

/** Proof that the pr-review-explainer checks pass on a good run and fail on plausible bad ones (kit shape: see kit-example.test.js). */

const kit = require('../skill-eval-kit');

const ID = 'pr-review-explainer';
const EXPL = 'docs/explainers/tally.md';
const WHY = 'docs/explainers/unavailable.txt';

const GOOD = `# tally

**What it is for** — Decides whether a change is approved from weighted reviewer votes.

**Entry points** — \`tallyVotes(votes)\`: takes \`[{ role, vote }]\` and returns \`{ verdict, weight, approvals }\`. \`syncHeader()\` builds the sync request header.

**How it decides** — Abstentions carry no weight. No verdict is given below a quorum of 3 total weight (\`no-quorum\`), so one vote cannot decide. Approval needs 0.75 of the voting weight; a maintainer reject blocks approval whatever the ratio. Role weights come from \`weightFor\`: an unknown role counts 0 so a misspelled role cannot tip a tally. docs/design-notes.md says a simple majority; the code uses 0.75, and the code wins.

**What it does not do** — It does not fetch votes or sync them; the role table lives in \`lib/weights.js\`.

Derived from:
- lib/tally.js (091325d)
- lib/weights.js (091325d-dirty)
`;

const REASON = 'No readable source for "quota-scheduler": no such path, no basename match (docs/design-notes.md mentions lib/quota-scheduler.js, which does not exist).\n';

/** A stub agent that writes the explainer and the reason (either may be null or replaced), plus extra files. */
const run = ({ expl = GOOD, why = REASON, extra = {} } = {}) => (ws) => {
  if (expl !== null) ws.write(EXPL, expl);
  if (why !== null) ws.write(WHY, why);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.invocation).toBe('plain');
  });

  test('a good run passes every check', async () => {
    const res = await kit.runEval(ID, run());
    expect(Object.keys(res)).toEqual([
      'explainer-saved', 'explainer-shape', 'derived-from-present', 'derived-from-real', 'derived-from-sources', 'derived-from-revision',
      'entry-point-named', 'code-ratio', 'code-quorum', 'unavailable-reason', 'no-fabricated-explainer', 'no-secret', 'source-intact',
    ]);
    kit.expectAllPass(res);
  });

  test('heading-form labels and a bold Derived from are accepted too (harmless phrasing differences)', async () => {
    const alt = GOOD.replace(/\*\*(What it is for|Entry points|How it decides|What it does not do)\*\* — /g, '## $1\n\n').replace('Derived from:', '**Derived from:**')
      .replace('quorum of 3', 'quorum of three').replace('0.75', '75%');
    kit.expectAllPass(await kit.runEval(ID, run({ expl: alt })));
  });

  test('a run that writes nothing fails the explainer, reason and fabrication-free checks it must and passes the hygiene ones', async () => {
    const res = await kit.runEval(ID, run({ expl: null, why: null }));
    kit.expectFails(res, [
      'explainer-saved', 'explainer-shape', 'derived-from-present', 'derived-from-real', 'derived-from-sources', 'derived-from-revision',
      'entry-point-named', 'code-ratio', 'code-quorum', 'unavailable-reason',
    ], undefined, { only: true });
    expect(res['explainer-saved'].detail).toMatch(/was not written/);
    expect(res['unavailable-reason'].detail).toMatch(/was not written/);
    expect(res['no-secret'].pass && res['source-intact'].pass).toBe(true);
  });

  test('a Derived from heading with no entries fails every list check with its own reason', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace(/Derived from:[\s\S]*$/, 'Derived from:\n') }));
    kit.expectFails(res, ['derived-from-present', 'derived-from-real', 'derived-from-sources', 'derived-from-revision'], undefined, { only: true });
    expect(res['derived-from-present'].detail).toMatch(/list is empty/);
    expect(res['derived-from-real'].detail).toMatch(/no `Derived from:` entries/);
    expect(res['derived-from-revision'].detail).toMatch(/no `Derived from:` entries/);
  });

  test('an explainer with no Derived from list fails derived-from-present (and the checks that need the list)', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace(/Derived from:[\s\S]*$/, '') }));
    kit.expectFails(res, ['derived-from-present', 'derived-from-real', 'derived-from-sources', 'derived-from-revision'], undefined, { only: true });
    expect(res['derived-from-present'].detail).toMatch(/no `Derived from:` list/);
  });

  test('a listed file that does not exist (a guessed entry) fails derived-from-real', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace('- lib/weights.js (091325d-dirty)', '- lib/weights.js (091325d)\n- lib/tally-helpers.js (091325d)') }));
    kit.expectFails(res, 'derived-from-real', /lib\/tally-helpers\.js/, { only: true });
  });

  test('an entry that escapes the repository fails derived-from-real', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace('lib/weights.js (091325d-dirty)', '../outside.js (091325d)') }));
    kit.expectFails(res, ['derived-from-real', 'derived-from-sources'], undefined, { only: true });
    expect(res['derived-from-real'].detail).toMatch(/not repo-relative/);
  });

  test('omitting the required sibling from the list fails derived-from-sources', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace('- lib/weights.js (091325d-dirty)\n', '') }));
    kit.expectFails(res, 'derived-from-sources', /lib\/weights\.js/, { only: true });
  });

  test('a Derived from list without revisions fails derived-from-revision', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace(/ \(091325d(-dirty)?\)/g, '') }));
    kit.expectFails(res, 'derived-from-revision', /revision/, { only: true });
  });

  test('an explainer built from the stale design notes (simple majority) fails code-ratio', async () => {
    const stale = GOOD.replace('Approval needs 0.75 of the voting weight', 'Approval needs a simple majority (more than 50 percent)').replace(/ docs\/design-notes\.md says[^\n]*/, '');
    kit.expectFails(await kit.runEval(ID, run({ expl: stale })), 'code-ratio', /0\.75/, { only: true });
  });

  test('an explainer that omits the quorum fails code-quorum; one that omits the entry point fails entry-point-named', async () => {
    kit.expectFails(await kit.runEval(ID, run({ expl: GOOD.replace('No verdict is given below a quorum of 3 total weight (`no-quorum`), so one vote cannot decide. ', '') })), 'code-quorum', /quorum of 3/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ expl: GOOD.replace(/`tallyVotes\(votes\)`/, 'the tally function').replace(/tallyVotes/g, 'tally function') })), 'entry-point-named', /tallyVotes/, { only: true });
  });

  test('an explainer missing a section, or far too long, fails explainer-shape', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace(/\*\*What it does not do\*\*[^\n]*\n\n/, '') }));
    kit.expectFails(res, 'explainer-shape', /what it does not do/, { only: true });
    const long = await kit.runEval(ID, run({ expl: GOOD.replace('Derived from:', `${'padding line\n'.repeat(130)}\nDerived from:`) }));
    kit.expectFails(long, 'explainer-shape', /lines/, { only: true });
  });

  test('a plausible explainer for the module without source fails no-fabricated-explainer, whether in its own file or inside the tally one', async () => {
    const fake = GOOD.replace('# tally', '# quota-scheduler').replace(/- lib\/tally.js[^\n]*\n- lib\/weights.js[^\n]*\n/, '- docs/design-notes.md (091325d)\n');
    const own = await kit.runEval(ID, run({ extra: { 'docs/explainers/quota-scheduler.md': fake } }));
    kit.expectFails(own, 'no-fabricated-explainer', /quota-scheduler\.md/, { only: true });
    const odd = await kit.runEval(ID, run({ extra: { 'docs/explainers/notes.md': fake } }));
    kit.expectFails(odd, 'no-fabricated-explainer', /explainer for quota-scheduler/, { only: true });
    const inline = await kit.runEval(ID, run({ expl: `# quota-scheduler (and tally)\n\n${GOOD}` }));
    kit.expectFails(inline, 'no-fabricated-explainer', /explains quota-scheduler too/, { only: true });
  });

  test('a reason file that explains instead of refusing, or gives no reason, or is for another module, fails unavailable-reason', async () => {
    kit.expectFails(await kit.runEval(ID, run({ why: `${REASON}${'more detail\n'.repeat(9)}` })), 'unavailable-reason', /8 lines/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ why: `${REASON}\n**What it is for** — schedules quotas.\n` })), 'unavailable-reason', /explainer structure/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ why: 'quota-scheduler: skipped.\n' })), 'unavailable-reason', /does not say why/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ why: 'Could not explain the thing: no source found.\n' })), 'unavailable-reason', /does not name quota-scheduler/, { only: true });
  });

  test('reproducing the credential-shaped constant fails no-secret', async () => {
    const res = await kit.runEval(ID, run({ expl: GOOD.replace('`syncHeader()` builds', 'Key fixture-not-a-real-key-7f3a9c1e5b2d is sent by `syncHeader()`, which builds') }));
    kit.expectFails(res, 'no-secret', /credential-shaped/, { only: true });
  });

  test('editing a seeded source file, or writing outside docs/explainers/, fails source-intact', async () => {
    const edited = await kit.runEval(ID, (ws) => { run()(ws); ws.write('lib/tally.js', `${ws.read('lib/tally.js')}// note\n`); });
    kit.expectFails(edited, 'source-intact', /lib\/tally\.js/, { only: true });
    const stray = await kit.runEval(ID, run({ extra: { 'lib/quota-scheduler.js': 'module.exports = {};\n' } }));
    kit.expectFails(stray, ['source-intact', 'no-fabricated-explainer']);
    const out = await kit.runEval(ID, run({ extra: { 'EXPLAINER.md': 'x\n' } }));
    kit.expectFails(out, 'source-intact', /outside docs\/explainers/, { only: true });
  });

  test('a symlinked explainer is not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      run({ expl: null })(ws);
      require('fs').symlinkSync('/etc/hosts', `${ws.dir}/${EXPL}`);
    });
    kit.expectFails(res, 'explainer-saved', /cannot read/);
  });

  test('arms: baseline loads nothing, with-skill loads packages/development; both get the same prompt with no command prefix', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
