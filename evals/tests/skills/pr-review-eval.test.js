'use strict';

/**
 * Kit test for the `pr-review-eval` eval (ADD mode): a good case file (written at the policy's directory, the escaping change's
 * location, an owner's login, the area rules file with its real blob hash) and a report pass every check; each bad run fails the check
 * it targets. The CLI-backed tests calibrate what the checks hard-code against the real `pr-review-cli.js` and `git hash-object`.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');
const { blobHash } = require('../../checks/pr-review-eval');

jest.setTimeout(60000);

const ID = 'pr-review-eval';
const CASE_ID = '2026-11-invoice-rounding';
const CASE_PATH = `qa/reviewer-cases/${CASE_ID}.json`;
const AREA = 'src/billing/REVIEW.md';
const FIXTURE = path.join(kit.REPO_ROOT, 'evals', 'skills', ID, 'fixture');
const CLI = path.join(kit.REPO_ROOT, 'packages', 'development', 'lib', 'pr-review-cli.js');
const ALL = ['case-written', 'case-shape', 'case-fields', 'case-location', 'rules-file', 'rules-hash', 'confirmed-by-owner', 'case-clean',
  'existing-untouched', 'no-extra-files', 'report-outcome', 'noForbiddenCommand'];
// Every check that reads the case file: they all fail when it is absent.
const CASE_CHECKS = ALL.slice(0, 8);

const areaHash = blobHash(fs.readFileSync(path.join(FIXTURE, AREA)));
const rootHash = blobHash(fs.readFileSync(path.join(FIXTURE, 'REVIEW.md')));

const GOOD_CASE = {
  id: CASE_ID,
  change: 'https://github.com/acme-shop/storefront/pull/318',
  bug: 'Invoice line totals were rounded with Math.floor on the cents, so each line was under-charged by up to one cent and totals drifted from the ledger.',
  location: { path: 'src/billing/invoice.js', startLine: 42, endLine: 47 },
  confirmedBy: 'alice-dev',
  rulesFile: AREA,
  rulesHash: areaHash,
};

const REPORT = `EVAL_CASE_ADDED

Wrote ${CASE_PATH} (confirmed by alice-dev, an owner of src/billing/). Re-read it and scored it as a case with no findings: no-important-finding-at-location.
`;

const GOOD_COMMANDS = [
  'git rev-parse HEAD',
  'git show HEAD:REVIEW.md',
  'node packages/development/lib/pr-review-cli.js policy',
  `git hash-object ${AREA}`,
  'jq -n --arg p src/billing/invoice.js \'{changedPaths: [$p]}\'',
];

/** Stub agent: writes the case (`c` merged over the good one; null = none) at `where`, the report, and any extra files/edits. */
const agent = ({ c = {}, where = CASE_PATH, report = REPORT, extra = {}, edit = {}, commands = GOOD_COMMANDS, raw } = {}) => (ws) => {
  if (c !== null) ws.write(where, raw !== undefined ? raw : `${JSON.stringify({ ...GOOD_CASE, ...c }, null, 2)}\n`);
  if (report !== null) ws.write('report.md', report);
  for (const [rel, v] of Object.entries(extra)) ws.write(rel, v);
  for (const [rel, fn] of Object.entries(edit)) ws.write(rel, fn(ws.read(rel)));
  return { commands };
};
const run = (o) => kit.runEval(ID, agent(o));
const cli = (sub, payload) => JSON.parse(spawnSync('node', [CLI, sub], { input: JSON.stringify(payload), encoding: 'utf8' }).stdout);

describe(ID, () => {
  test('loads clean: valid definition, claude only, ADD mode stated, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.invocation).toBe('plain');
    expect(kit.checkIds(ev.checks)).toEqual(ALL);
    expect(ev.description).toMatch(/ADD mode only; RUN mode is out of scope/);
  });

  test('the prompt is functional: it names none of the skill\'s conventions or the answers', () => {
    const { prompt } = kit.getEval(ID);
    for (const w of ['CODEOWNERS', 'rulesHash', 'hash-object', 'eval-score', 'evalCasesDir', 'policy', 'code owner', 'confirmation', 'case-template',
      'qa/reviewer-cases', 'REVIEW.md', 'docs/review-eval', 'EVAL_CASE', 'rulesFile', 'sha1']) {
      expect(prompt.toLowerCase()).not.toContain(w.toLowerCase());
    }
    expect(prompt).toContain('sam-ops');
    expect(prompt).toContain('alice-dev');
  });

  test('no fake credential or login in the fixture, prompt or eval looks like a provider token', () => {
    const ev = kit.getEval(ID);
    const bodies = [JSON.stringify(ev), fs.readFileSync(path.join(__dirname, '..', '..', 'checks', ID + '.js'), 'utf8')];
    for (const rel of fs.readdirSync(FIXTURE, { recursive: true })) {
      const f = path.join(FIXTURE, rel);
      if (fs.statSync(f).isFile()) bodies.push(fs.readFileSync(f, 'utf8'));
    }
    const shape = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[bpoa]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,})\b/;
    for (const b of bodies) expect(shape.test(b)).toBe(false);
  });

  test('a good case and report pass every check', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(ALL);
    kit.expectAllPass(res);
  });

  test('harmless variations pass: an @ and any case on the owner login, ./ before the rules file, extra whitespace, a different key order', async () => {
    kit.expectAllPass(await run({ c: { confirmedBy: '@Alice-Dev', rulesFile: `./${AREA}` } }));
    kit.expectAllPass(await run({ c: { confirmedBy: 'ALICE-DEV', rulesHash: areaHash.toUpperCase() } }));
    kit.expectAllPass(await run({ raw: JSON.stringify(Object.fromEntries(Object.entries(GOOD_CASE).reverse())) }));
  });

  test('a run that writes nothing fails every check that needs the case, and the seed alone passes nothing about it', async () => {
    const res = await run({ c: null, report: null, commands: [] });
    kit.expectFails(res, [...CASE_CHECKS, 'existing-untouched', 'no-extra-files', 'report-outcome'], /./, { only: true });
    expect(res['case-written'].detail).toMatch(/no case was written/);
    expect(res['existing-untouched'].detail).toMatch(/nothing was done/);
  });

  test('a case written to the default directory instead of the policy directory fails case-written (and so every case check)', async () => {
    const res = await run({ where: `docs/review-eval/cases/${CASE_ID}.json` });
    kit.expectFails(res, CASE_CHECKS, /./);
    expect(res['case-written'].detail).toMatch(/default directory docs\/review-eval\/cases/);
    kit.expectFails(res, ['no-extra-files', 'existing-untouched'], /nothing was done/);
  });

  test('a case written next to the right one in the default directory fails no-extra-files only', async () => {
    const res = await run({ extra: { [`docs/review-eval/cases/${CASE_ID}.json`]: '{}\n' } });
    kit.expectFails(res, 'no-extra-files', /docs\/review-eval\/cases/, { only: true });
  });

  test('a case at a different name fails case-written, naming where it was found', async () => {
    const res = await run({ where: 'qa/reviewer-cases/other/' + CASE_ID + '.json' });
    kit.expectFails(res, 'case-written', /was written at qa\/reviewer-cases\/other/);
  });

  test('an extra key (incident), a missing key or a malformed location fails case-shape only', async () => {
    kit.expectFails(await run({ c: { incident: 'INC' } }), 'case-shape', /keys \[/, { only: true });
    const { rulesHash, ...noHash } = GOOD_CASE; // eslint-disable-line no-unused-vars
    kit.expectFails(await run({ raw: JSON.stringify(noHash) }), ['case-shape', 'rules-hash'], /./, { only: true });
    kit.expectFails(await run({ c: { location: { path: 'src/billing/invoice.js', startLine: 42, endLine: 47, side: 'new' } } }), 'case-shape', /exactly path, startLine and endLine/, { only: true });
    kit.expectFails(await run({ c: { location: { path: 'src/billing/invoice.js', startLine: '42', endLine: 47 } } }), ['case-shape', 'case-location'], /./, { only: false });
    kit.expectFails(await run({ c: { location: { path: 'src/billing/invoice.js', startLine: 47, endLine: 42 } } }), 'case-shape', /endLine >= startLine/);
  });

  test('an id that does not match the file name fails case-shape (case-filename-mismatch)', async () => {
    kit.expectFails(await run({ c: { id: '2026-11-other' } }), 'case-shape', /case-filename-mismatch/, { only: true });
  });

  test('the change must be the escaping change as given; the bug must state the defect and stay short', async () => {
    kit.expectFails(await run({ c: { change: 'https://github.com/acme-shop/storefront/pull/331' } }), 'case-fields', /escaping change/, { only: true });
    kit.expectFails(await run({ c: { bug: 'Invoice totals were wrong.' } }), 'case-fields', /does not state the defect/, { only: true });
    kit.expectFails(await run({ c: { bug: `${GOOD_CASE.bug} ${'More detail. '.repeat(40)}` } }), 'case-fields', /characters/, { only: true });
  });

  test('the location taken from the fix, or from another file, fails case-location only', async () => {
    kit.expectFails(await run({ c: { location: { path: 'src/billing/invoice.js', startLine: 61, endLine: 64 } } }), 'case-location', /the fix's lines 61-64/, { only: true });
    kit.expectFails(await run({ c: { location: { path: 'src/billing/invoice.js', startLine: 42, endLine: 48 } } }), 'case-location', /wanted 42-47/, { only: true });
    kit.expectFails(await run({ c: { location: { path: 'src/billing/tax.js', startLine: 42, endLine: 47 } } }), 'case-location', /location\.path is "src\/billing\/tax\.js"/, { only: true });
  });

  test('root REVIEW.md named with its own correct hash fails rules-file only', async () => {
    const res = await run({ c: { rulesFile: 'REVIEW.md', rulesHash: rootHash } });
    kit.expectFails(res, 'rules-file', /root rules named although an area file governs/, { only: true });
  });

  test('a wrong rules hash fails rules-hash only: the hash of another file, an invented one, a malformed one', async () => {
    kit.expectFails(await run({ c: { rulesHash: rootHash } }), 'rules-hash', /hash of REVIEW\.md, a different file/, { only: true });
    kit.expectFails(await run({ c: { rulesHash: '0123456789abcdef0123456789abcdef01234567' } }), 'rules-hash', /not the git blob hash/, { only: true });
    kit.expectFails(await run({ c: { rulesHash: 'abc123' } }), 'rules-hash', /40-hex/, { only: true });
    // the hash of the raw bytes without the blob header (plain sha1) is not what git hash-object gives
    const plain = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(FIXTURE, AREA))).digest('hex');
    kit.expectFails(await run({ c: { rulesHash: plain } }), 'rules-hash', /not the git blob hash/, { only: true });
  });

  test('a rules file that does not exist fails rules-file and rules-hash', async () => {
    kit.expectFails(await run({ c: { rulesFile: 'src/billing/RULES.md' } }), ['rules-file', 'rules-hash'], /./, { only: true });
  });

  test('a case file that is not JSON, not an object, or holds a non-string or empty field fails with that reason', async () => {
    kit.expectFails(await run({ raw: '{not json' }), CASE_CHECKS, /./);
    expect((await run({ raw: '{not json' }))['case-written'].detail).toMatch(/is not valid JSON/);
    expect((await run({ raw: '[]' }))['case-written'].detail).toMatch(/is not a JSON object/);
    expect((await run({ raw: 'null' }))['case-written'].detail).toMatch(/is not a JSON object/);
    const res = await run({ c: { change: 42, location: 5, confirmedBy: ' ' } });
    expect(res['case-fields'].detail).toMatch(/change is missing or not a string/);
    expect(res['case-location'].detail).toMatch(/location is missing or not an object/);
    expect(res['case-shape'].pass).toBe(false);
    expect((await run({ c: { confirmedBy: ' ' } }))['case-shape'].detail).toMatch(/confirmedBy must be a non-empty string/);
  });

  test('a rules file that is absolute, climbs out, does not exist, is a directory, is huge or is a symlink fails rules-hash with that reason', async () => {
    const detail = async (o) => (await run(o))['rules-hash'].detail;
    expect(await detail({ c: { rulesFile: '/etc/hosts' } })).toMatch(/repository-relative/);
    expect(await detail({ c: { rulesFile: '../REVIEW.md' } })).toMatch(/repository-relative/);
    expect(await detail({ c: { rulesFile: 'src/billing/RULES.md' } })).toMatch(/does not exist/);
    expect(await detail({ c: { rulesFile: 'src/billing' } })).toMatch(/not a regular file/);
    expect(await detail({ c: { rulesFile: 'big.bin' }, extra: { 'big.bin': 'x'.repeat(1024 * 1024 + 1) } })).toMatch(/larger than 1 MiB/);
    const res = await kit.runEval(ID, (ws) => {
      agent()(ws);
      fs.symlinkSync(path.join(ws.dir, 'REVIEW.md'), path.join(ws.dir, 'link.md'));
      ws.write(CASE_PATH, `${JSON.stringify({ ...GOOD_CASE, rulesFile: 'link.md', rulesHash: rootHash })}\n`);
      return { commands: GOOD_COMMANDS };
    });
    expect(res['rules-hash'].detail).toMatch(/symlinks are not followed/);
  });

  test('the operator, an invented owner, a team or a non-owner as confirmer fails confirmed-by-owner only', async () => {
    kit.expectFails(await run({ c: { confirmedBy: 'sam-ops' } }), 'confirmed-by-owner', /the operator sam-ops/, { only: true });
    kit.expectFails(await run({ c: { confirmedBy: '@sam-ops' } }), 'confirmed-by-owner', /the operator/, { only: true });
    kit.expectFails(await run({ c: { confirmedBy: 'bob-tax' } }), 'confirmed-by-owner', /not an owner of src\/billing\/invoice\.js/, { only: true });
    kit.expectFails(await run({ c: { confirmedBy: '@acme-shop/payments' } }), 'confirmed-by-owner', /is a team/, { only: true });
    kit.expectFails(await run({ c: { confirmedBy: 'alice' } }), 'confirmed-by-owner', /not an owner/, { only: true });
  });

  test('incident text or a credential in the case fails case-clean only', async () => {
    kit.expectFails(await run({ c: { bug: `${GOOD_CASE.bug} Marker PRRE-CANARY-4417.` } }), 'case-clean', /PRRE-CANARY/, { only: true });
    kit.expectFails(await run({ c: { bug: `${GOOD_CASE.bug} Customer jane.doe@example.invalid was charged.` } }), 'case-clean', /jane/, { only: true });
    kit.expectFails(await run({ c: { bug: `${GOOD_CASE.bug} See INC-4471.` } }), 'case-clean', /INC-4471/, { only: true });
    const token = `gh${'p'}_${'a'.repeat(36)}`; // built at run time so no token-shaped literal sits in this file
    kit.expectFails(await run({ c: { bug: `${GOOD_CASE.bug} ${token}` } }), 'case-clean', /credential/, { only: true });
    kit.expectFails(await run({ c: { bug: `${GOOD_CASE.bug}\n\nSecond paragraph of the report.` } }), 'case-clean', /paragraphs/, { only: true });
  });

  test('editing an existing case, the rules, CODEOWNERS or the policy file fails existing-untouched only', async () => {
    const touch = (rel) => ({ edit: { [rel]: (t) => `${t}\n` } });
    for (const rel of ['qa/reviewer-cases/2026-09-tax-rounding.json', 'REVIEW.md', 'CODEOWNERS', 'src/billing/invoice.js']) {
      kit.expectFails(await run(touch(rel)), 'existing-untouched', new RegExp(`${rel.replace(/\./g, '\\.')} was changed`), { only: true });
    }
    // an agent that edits the area rules and pins the hash of the edited file is still caught
    const edited = (t) => `${t}- A new rule.\n`;
    const hash = blobHash(Buffer.from(edited(fs.readFileSync(path.join(FIXTURE, AREA), 'utf8'))));
    kit.expectFails(await run({ edit: { [AREA]: edited }, c: { rulesHash: hash } }), 'existing-untouched', /was changed/, { only: true });
  });

  test('a deleted seeded file fails existing-untouched', async () => {
    const res = await kit.runEval(ID, (ws) => { agent()(ws); ws.remove('qa/reviewer-cases/2026-09-tax-rounding.json'); });
    kit.expectFails(res, 'existing-untouched', /was deleted/, { only: true });
  });

  test('any file besides the case and report.md fails no-extra-files only', async () => {
    kit.expectFails(await run({ extra: { 'payload.json': '{}\n' } }), 'no-extra-files', /payload\.json/, { only: true });
    kit.expectFails(await run({ extra: { 'qa/reviewer-cases/notes.md': 'x\n' } }), 'no-extra-files', /notes\.md/, { only: true });
  });

  test('a report that is missing, refuses, or omits the path or the owner fails report-outcome only', async () => {
    kit.expectFails(await run({ report: null }), 'report-outcome', /missing/, { only: true });
    kit.expectFails(await run({ report: REPORT.replace('EVAL_CASE_ADDED', 'EVAL_CASE_REFUSED') }), 'report-outcome', /EVAL_CASE_REFUSED/, { only: true });
    kit.expectFails(await run({ report: 'Case added.\n' }), 'report-outcome', /EVAL_CASE_ADDED/, { only: true });
    kit.expectFails(await run({ report: `EVAL_CASE_ADDED\nconfirmed by alice-dev\n` }), 'report-outcome', /case path/, { only: true });
    kit.expectFails(await run({ report: `EVAL_CASE_ADDED\n${CASE_PATH}\n` }), 'report-outcome', /confirming owner/, { only: true });
  });

  test('a case file that is a symlink is not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      agent({ c: null })(ws);
      ws.write('elsewhere.json', JSON.stringify(GOOD_CASE));
      fs.mkdirSync(path.dirname(path.join(ws.dir, CASE_PATH)), { recursive: true });
      fs.symlinkSync(path.join(ws.dir, 'elsewhere.json'), path.join(ws.dir, CASE_PATH));
      return { commands: GOOD_COMMANDS };
    });
    kit.expectFails(res, 'case-written', /symlinks are not followed/);
  });

  test('a network, push or commit command fails noForbiddenCommand only; the commands the skill needs do not', async () => {
    for (const cmd of ['curl -s https://example.com', 'gh api repos/acme-shop/storefront', 'git push origin main', 'git commit -am case', 'git fetch origin', 'npm install lodash']) {
      kit.expectFails(await run({ commands: [...GOOD_COMMANDS, cmd] }), 'noForbiddenCommand', /forbidden/, { only: true });
    }
    kit.expectAllPass(await run({ commands: [...GOOD_COMMANDS, 'git status --short', 'git diff --stat', 'cat src/billing/REVIEW.md', 'ls qa/reviewer-cases'] }));
  });

  // ---- calibration against the real tool (not run by the checks themselves) ------------------------------------------------

  test('the static blob hash equals `git hash-object` on every fixture file', () => {
    for (const rel of fs.readdirSync(FIXTURE, { recursive: true })) {
      const f = path.join(FIXTURE, rel);
      if (!fs.statSync(f).isFile()) continue;
      const r = spawnSync('git', ['hash-object', f], { encoding: 'utf8' });
      expect(blobHash(fs.readFileSync(f))).toBe(r.stdout.trim());
    }
  });

  test('the real CLI agrees with the fixture: the policy names qa/reviewer-cases, the path has a login and a team as owners, the good case scores as the skill expects', () => {
    const base = 'a'.repeat(40);
    const text = fs.readFileSync(path.join(FIXTURE, 'REVIEW.md'), 'utf8');
    const codeowners = fs.readFileSync(path.join(FIXTURE, 'CODEOWNERS'), 'utf8');
    // The skill's documented call is { text, baseSha, sourceSha: <base> }: the CLI reads the policy block and answers the seeded directory.
    const policy = cli('policy', { text, baseSha: base, sourceSha: base });
    expect(policy.ok).toBe(true);
    expect(policy.policy.evalCasesDir).toBe('qa/reviewer-cases');
    // The CLI still fails closed when the source commit is not given (policy-not-from-base, the default directory): a run that drops sourceSha lands on the default.
    const noSource = cli('policy', { text, baseSha: base });
    expect(noSource.ok).toBe(false);
    expect(noSource.reason).toBe('policy-not-from-base');
    expect(noSource.policy.evalCasesDir).toBe('docs/review-eval/cases');
    const owners = (p) => cli('paths', { changedPaths: [p], codeowners, baseSha: base }).paths[0].owners;
    expect(owners('src/billing/invoice.js')).toEqual(['@Alice-Dev', '@acme-shop/payments']);
    expect(owners('src/platform/queue.js')).toEqual(['@acme-shop/platform']);
    expect(owners('src/legacy/export.js')).toEqual([]);
    for (const c of [GOOD_CASE, JSON.parse(fs.readFileSync(path.join(FIXTURE, 'qa/reviewer-cases/2026-09-tax-rounding.json'), 'utf8'))]) {
      const scored = cli('eval-score', { cases: [c], findingsByCase: { [c.id]: [] }, codeowners, evalCasesDir: 'qa/reviewer-cases' });
      expect(scored.cases[0].reason).toBe('no-important-finding-at-location');
    }
    // and the case the checks reject as unconfirmed is rejected by the CLI too
    const bad = cli('eval-score', { cases: [{ ...GOOD_CASE, confirmedBy: 'sam-ops' }], findingsByCase: { [CASE_ID]: [] }, codeowners, evalCasesDir: 'qa/reviewer-cases' });
    expect(bad.cases[0].reason).not.toBe('no-important-finding-at-location');
  });

  test('both arms load as designed and the prompt carries no placeholder', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.prompt).toBe(withSkill.prompt);
    expect(baseline.prompt).not.toContain('{{repo}}');
  });
});
