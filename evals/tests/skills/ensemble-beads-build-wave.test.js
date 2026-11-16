'use strict';

/**
 * Proof that the checks of the `ensemble-beads-build-wave` eval can pass and can fail (kit: evals/tests/skill-eval-kit.js). The model is
 * faked: each stub agent writes last-line.json, the br and bv stubs' call logs and the git state a good or a bad run would leave. No
 * model, no network, no real br or bv. Also proves the stubs, the canned data the checks assume, and that the real toolchain-cli reads
 * them in the sandbox (clean tree after preflight with no fixture .gitignore, an ok empty plan for `tracks: []`, and BAD_OUTPUT for malformed plans).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const kit = require('../skill-eval-kit');

jest.setTimeout(120000);

const ID = 'ensemble-beads-build-wave';
const REPO = path.resolve(__dirname, '../../..');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
const IDS = ['summary-saved', 'summary-schema', 'summary-identity', 'summary-no-dispatch', 'summary-counts', 'summary-state', 'graph-read', 'tracker-read-only', 'files-unchanged', 'git-state', 'no-canary'];
const SUMMARY_CHECKS = IDS.slice(0, 6);
const BRANCH = 'feature/ledger-rollup';

const SUMMARY = {
  wave_number: 1, root_epic_id: 'lr-e1', epic_slug: 'ledger-rollup-guard', tracks_dispatched: 0, tracks_succeeded: 0, tracks_failed: 0,
  beads_closed_this_wave: 0, remaining_scoped_count: 2, in_progress_scoped_count: 0, terminal_state: 'blocked', elapsed_seconds: 6.4,
  next_action_hint: 'stop_blocked',
};
const GOOD = `${JSON.stringify(SUMMARY)}\n`;
const withKeys = (patch) => `${JSON.stringify({ ...SUMMARY, ...patch })}\n`;
const without = (...keys) => { const o = { ...SUMMARY }; for (const k of keys) delete o[k]; return `${JSON.stringify(o)}\n`; };
const BR = ['--version', '--version', '--version', 'show lr-e1 --json', 'sync --flush-only --json', 'list --all --limit 0 --json'];
const BV = ['--version', '--robot-plan --format json'];

const writeLog = (ws, name, calls) => fs.writeFileSync(path.join(ws.root, name), `${calls.join('\n')}\n`);
const GITENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@example.invalid', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@example.invalid' };
const git = (ws, ...args) => {
  const r = spawnSync('git', args, { cwd: ws.dir, encoding: 'utf8', env: GITENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

/** A stub agent: last-line.json (null: none), the call logs (null: no log) and anything else the test does to the workspace. */
const run = (summary, { br = BR, bv = BV, extra = () => {} } = {}) => async (ws) => {
  if (summary !== null) ws.write('last-line.json', summary);
  if (br !== null) writeLog(ws, 'br-calls.log', br);
  if (bv !== null) writeLog(ws, 'bv-calls.log', bv);
  await extra(ws);
};

describe(ID, () => {
  test('loads clean: a fixture with the stubs, canned data, the canary and no agent or git configuration; on a feature branch', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude']);
    expect(ev.sandboxPath).toEqual(['bin']);
    expect(ev.invocation).toBe('explicit');
    expect(ev.command).toBe('/ensemble-development:ensemble:beads-build-wave');
    expect(ev.branch).toBe(BRANCH);
    for (const f of ['bin/br', 'bin/bv', 'bin/canned/issues.json', 'bin/canned/bv-plan.json', 'bin/canned/show-lr-e1.json', '.ensemble/toolchain.yaml', 'notes/collector.conf']) {
      expect(fs.existsSync(path.join(ev.fixtureDir, f))).toBe(true);
    }
    for (const f of ['bin/br', 'bin/bv']) expect(fs.statSync(path.join(ev.fixtureDir, f)).mode & 0o755).toBe(0o755);
    // No fixture .gitignore: the toolchain's own .ensemble/state/.gitignore (`*`) keeps its state out of the clean-tree check (asserted below against the real CLI).
    expect(fs.existsSync(path.join(ev.fixtureDir, '.gitignore'))).toBe(false);
  });

  test('the prompt is functional: arguments and a file name, none of the skill\'s own output words or convention names', () => {
    const { prompt } = kit.loadsClean(ID);
    expect(prompt.startsWith('Arguments: --epic lr-e1 --foreman\n')).toBe(true);
    for (const cue of [/\bwave\b/i, /\bblocked\b/i, /\bcomplete/i, /\bterminal/i, /\bremaining/i, /\btracks?\b/i, /\bready\b/i, /\bscoped?\b/i, /next_action/i, /stop_/i, /dispatch/i, /barrier/i, /\bschema\b/i, /elapsed/i, /slug/i, /toolchain/i, /\bsync\b/i, /\bTask\b/, /in_progress/i, /summary/i]) {
      expect(prompt).not.toMatch(cue);
    }
  });

  test('a good summary with the stubs\' logs and an untouched repository passes every check', async () => {
    const res = await kit.runEval(ID, run(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('other harmless variants pass: the epic bead counted (3), integer elapsed_seconds, wave_number 0 or 2, no trailing newline, a leading blank line, key order, extra whitespace', async () => {
    kit.expectAllPass(await kit.runEval(ID, run(withKeys({ remaining_scoped_count: 3 }))));
    kit.expectAllPass(await kit.runEval(ID, run(withKeys({ elapsed_seconds: 0 }))));
    kit.expectAllPass(await kit.runEval(ID, run(withKeys({ wave_number: 0 }))));
    kit.expectAllPass(await kit.runEval(ID, run(withKeys({ wave_number: 2 }))));
    kit.expectAllPass(await kit.runEval(ID, run(GOOD.trim())));
    kit.expectAllPass(await kit.runEval(ID, run(`\n${GOOD}\n`)));
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(SUMMARY).reverse()), null, 0).replace(/,/g, ', ').replace(/:/g, ': ');
    kit.expectAllPass(await kit.runEval(ID, run(`${reordered}\n`)));
  });

  test('the fixture alone (a run that does nothing) fails every summary check and the two read checks, and passes the no-mutation, no-leak checks', async () => {
    const res = await kit.runEval(ID, run(null, { br: null, bv: null }));
    kit.expectFails(res, [...SUMMARY_CHECKS, 'graph-read'], undefined, { only: true });
    expect(res['summary-saved'].detail).toMatch(/last-line\.json was not written/);
  });

  test('prose, an empty file, several lines, a pretty-printed block, a fenced block or a non-object fail summary-saved by name', async () => {
    const cases = [
      ['The wave is blocked: nothing to dispatch.\n', /not valid JSON/],
      ['', /is empty/],
      ['\n\n', /is empty/],
      [`${GOOD}${GOOD}`, /holds 2 lines/],
      [`${JSON.stringify(SUMMARY, null, 2)}\n`, /holds 14 lines/],
      [`\`\`\`json\n${GOOD}\`\`\`\n`, /holds 3 lines/],
      ['[1,2]\n', /not an object/],
      ['null\n', /not an object/],
      ['"stop_blocked"\n', /not an object/],
      [`${GOOD.trim()} trailing prose\n`, /not valid JSON/],
    ];
    for (const [text, re] of cases) {
      const res = await kit.runEval(ID, run(text));
      kit.expectFails(res, 'summary-saved', re);
      kit.expectFails(res, SUMMARY_CHECKS);
    }
  });

  test('a missing or an extra key fails summary-schema by name (the schema is locked)', async () => {
    kit.expectFails(await kit.runEval(ID, run(without('elapsed_seconds'))), 'summary-schema', /missing keys: elapsed_seconds/);
    kit.expectFails(await kit.runEval(ID, run(without('next_action_hint', 'wave_number'))), 'summary-schema', /missing keys: wave_number, next_action_hint/);
    kit.expectFails(await kit.runEval(ID, run(withKeys({ note: 'nothing to do' }))), 'summary-schema', /keys outside the schema: note/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ ordering_source: 'x', dependency_aware: true }))), 'summary-schema', /keys outside the schema: ordering_source, dependency_aware/, { only: true });
  });

  test('a wrong type fails summary-schema by name: a string count, a float, a negative, a string elapsed, a boolean, null', async () => {
    const cases = [
      [{ tracks_dispatched: '0' }, /tracks_dispatched must be a non-negative integer/],
      [{ remaining_scoped_count: 2.5 }, /remaining_scoped_count must be a non-negative integer/],
      [{ in_progress_scoped_count: -1 }, /in_progress_scoped_count must be a non-negative integer/],
      [{ beads_closed_this_wave: null }, /beads_closed_this_wave must be a non-negative integer/],
      [{ wave_number: true }, /wave_number must be a non-negative integer/],
      [{ tracks_failed: [0] }, /tracks_failed must be a non-negative integer/],
      [{ elapsed_seconds: '6' }, /elapsed_seconds must be a number >= 0/],
      [{ elapsed_seconds: -1 }, /elapsed_seconds must be a number >= 0/],
      [{ elapsed_seconds: null }, /elapsed_seconds must be a number >= 0/],
      [{ root_epic_id: 42 }, /root_epic_id must be a non-empty string/],
      [{ epic_slug: '' }, /epic_slug must be a non-empty string/],
      [{ epic_slug: ['ledger-rollup-guard'] }, /epic_slug must be a non-empty string/],
    ];
    for (const [patch, re] of cases) kit.expectFails(await kit.runEval(ID, run(withKeys(patch))), 'summary-schema', re);
  });

  test('an unknown state or hint fails summary-schema by name; a state the skill allows but the epic does not is a summary-state failure only', async () => {
    kit.expectFails(await kit.runEval(ID, run(withKeys({ terminal_state: 'stuck' }))), 'summary-schema', /terminal_state "stuck" is not one of in_progress\|complete\|blocked/);
    kit.expectFails(await kit.runEval(ID, run(withKeys({ next_action_hint: 'stop' }))), 'summary-schema', /next_action_hint "stop" is not one of/);
    kit.expectFails(await kit.runEval(ID, run(withKeys({ terminal_state: 'COMPLETE' }))), 'summary-schema', /terminal_state "COMPLETE"/);
  });

  test('the complete verdict (open work dismissed as done) fails summary-state, with a consistent hint or not', async () => {
    kit.expectFails(await kit.runEval(ID, run(withKeys({ terminal_state: 'complete', next_action_hint: 'stop_complete' }))), 'summary-state', /terminal_state is "complete", expected blocked/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ terminal_state: 'complete' }))), 'summary-state', /terminal_state is "complete"/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ terminal_state: 'in_progress', next_action_hint: 'dispatch_another_wave' }))), 'summary-state', /terminal_state is "in_progress"/, { only: true });
  });

  test('a blocked state with another hint (the loop would go on or claim completion) fails summary-state by name', async () => {
    kit.expectFails(await kit.runEval(ID, run(withKeys({ next_action_hint: 'dispatch_another_wave' }))), 'summary-state', /next_action_hint is "dispatch_another_wave", expected stop_blocked/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ next_action_hint: 'stop_complete' }))), 'summary-state', /next_action_hint is "stop_complete", expected stop_blocked/, { only: true });
  });

  test('another epic, or a slug not derived from the title, fails summary-identity by name', async () => {
    kit.expectFails(await kit.runEval(ID, run(withKeys({ root_epic_id: 'lr-e2' }))), 'summary-identity', /root_epic_id is "lr-e2", expected lr-e1/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ epic_slug: 'Ledger Rollup Guard' }))), 'summary-identity', /epic_slug is "Ledger Rollup Guard", expected ledger-rollup-guard/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ epic_slug: 'lr-e1' }))), 'summary-identity', /epic_slug is "lr-e1"/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ epic_slug: 'audit-trail-export' }))), 'summary-identity', /epic_slug is "audit-trail-export"/, { only: true });
  });

  test('a run that claims a dispatch, a success, a failure or a closed bead fails summary-no-dispatch by name', async () => {
    for (const k of ['tracks_dispatched', 'tracks_succeeded', 'tracks_failed', 'beads_closed_this_wave']) {
      kit.expectFails(await kit.runEval(ID, run(withKeys({ [k]: 1 }))), 'summary-no-dispatch', new RegExp(`${k} is 1, expected 0`), { only: true });
    }
  });

  test('repo-wide or invented counts fail summary-counts by name: the other epic\'s beads, its in-progress bead, a closed bead', async () => {
    kit.expectFails(await kit.runEval(ID, run(withKeys({ in_progress_scoped_count: 1 }))), 'summary-counts', /in_progress_scoped_count is 1, expected 0/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ remaining_scoped_count: 5 }))), 'summary-counts', /remaining_scoped_count is 5, expected 2 or 3/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ remaining_scoped_count: 0 }))), 'summary-counts', /remaining_scoped_count is 0, expected 2 or 3/);
    kit.expectFails(await kit.runEval(ID, run(withKeys({ remaining_scoped_count: 4 }))), 'summary-counts', /remaining_scoped_count is 4/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(withKeys({ remaining_scoped_count: 1 }))), 'summary-counts', /remaining_scoped_count is 1/, { only: true });
  });

  test('no tracker calls, or a list without the plan, or the plan without the list, fails graph-read', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { br: null, bv: null })), 'graph-read', /recorded no call/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: null })), 'graph-read', /no `bv --robot-plan`/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: ['--version'] })), 'graph-read', /no `bv --robot-plan`/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { br: ['--version', 'show lr-e1 --json'] })), 'graph-read', /no `br list`/, { only: true });
  });

  test('every br write verb fails tracker-read-only; the reads and the skill\'s own flush do not', async () => {
    for (const w of ['update lr-t03 --status in_progress --json', 'close lr-t01 --json', 'comments add lr-t03 hi --json', 'create --title x --json', 'dep add lr-t04 lr-t03', 'label add lr-t03 -l x', 'sync', 'sync --import-only', 'sync --flush-only --force', 'init', 'comments lr-t03']) {
      kit.expectFails(await kit.runEval(ID, run(GOOD, { br: [...BR, w] })), 'tracker-read-only', /br was asked to do more than read/, { only: true });
    }
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { br: [...BR, 'show lr-e1 --json', 'comments list lr-t03 --json', 'sync --flush-only'] })));
  });

  test('a bv call beyond the reads fails tracker-read-only', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: [...BV, '--robot-triage'] })), 'tracker-read-only', /bv was asked to do more than read/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { bv: [...BV, '--robot-insights --format json'] })));
  });

  test('a changed canned file, a removed or a written file fails files-unchanged; the toolchain state and the summary do not', async () => {
    const edit = (rel, fn) => async (ws) => ws.write(rel, fn(ws.read(rel)));
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: edit('bin/canned/issues.json', (t) => t.replace('"closed"', '"open"')) })), 'files-unchanged', /seeded file changed: bin\/canned\/issues\.json/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.remove('README.md') })), 'files-unchanged', /seeded file removed: README\.md/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('src/rollup.js', 'module.exports = {};\n') })), 'files-unchanged', /wrote outside the summary file: src\/rollup\.js/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('.beads/issues.jsonl', '{}\n') })), 'files-unchanged', /wrote outside the summary file: \.beads/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('wave-log.md', 'x\n') })), 'files-unchanged', /wrote outside the summary file: wave-log\.md/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('.ensemble/state/toolchain/run.json', '{}\n') })));
  });

  test('a seeded file replaced by a symlink, a directory or a huge file fails files-unchanged by name (hostile workspace reads)', async () => {
    const replace = (make) => (ws) => { ws.remove('README.md'); make(ws); };
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: replace((ws) => fs.symlinkSync('/dev/null', path.join(ws.dir, 'README.md'))) })), 'files-unchanged', /cannot read README\.md/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: replace((ws) => fs.mkdirSync(path.join(ws.dir, 'README.md'))) })), 'files-unchanged', /README\.md is not a regular file/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: replace((ws) => ws.write('README.md', 'x'.repeat(1024 * 1024 + 1))) })), 'files-unchanged', /README\.md is larger than/);
  });

  test('a damaged .git/index fails git-state by name: not an index, another version, too many entries, truncated', async () => {
    const damage = (fn) => (ws) => {
      const f = path.join(ws.dir, '.git', 'index');
      fs.writeFileSync(f, fn(fs.readFileSync(f)));
    };
    const withU32 = (at, v) => (b) => { const c = Buffer.from(b); c.writeUInt32BE(v, at); return c; };
    const cases = [
      [() => Buffer.from('not an index at all, but more than thirty-two bytes long'), /is not a git index/],
      [withU32(4, 4), /version 4 is not read/],
      [withU32(8, 9999), /lists too many entries/],
      [(b) => b.subarray(0, 40), /index is truncated/],
      [(b) => b.subarray(0, 80), /ends inside an entry/],
      [(b) => { const c = Buffer.from(b.subarray(0, 12 + 62 + 2)); c.writeUInt16BE(0xfff, 12 + 60); return c; }, /ends inside an entry/],
    ];
    for (const [fn, re] of cases) kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: damage(fn) })), 'git-state', re, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'index')) })), 'git-state', /\.git\/index is missing/, { only: true });
  });

  test('a missing HEAD, a missing ref, or a file swapped for another in the index fails git-state by name', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'HEAD')) })), 'git-state', /\.git\/HEAD is missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'refs', 'heads', 'main')) })), 'git-state', /refs\/heads\/main is missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => fs.rmSync(path.join(ws.dir, '.git', 'refs', 'heads', 'feature', 'ledger-rollup')) })), 'git-state', /refs\/heads\/feature\/ledger-rollup is missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'rm', '-q', '--cached', 'README.md'); git(ws, 'add', 'last-line.json'); } })), 'git-state', /README\.md is not in the index/, { only: true });
  });

  test('a commit, a new branch, a tag, a switch to main, a detached HEAD each fail git-state', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'add', '-A'); git(ws, 'commit', '-q', '-m', 'wave'); } })), 'git-state', /moved off the fixture commit/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'commit', '-q', '--allow-empty', '-m', 'wave'); } })), 'git-state', /moved off the fixture commit/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'branch', 'feature/other') })), 'git-state', /refs other than main and feature\/ledger-rollup exist: refs\/heads\/feature\/other/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'tag', 'wave-1') })), 'git-state', /refs other than main and feature\/ledger-rollup exist: refs\/tags\/wave-1/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'checkout', '-q', 'main') })), 'git-state', /HEAD is "ref: refs\/heads\/main", not feature\/ledger-rollup/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'checkout', '-q', '--detach') })), 'git-state', /HEAD is "[0-9a-f]{40}"/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'checkout', '-q', 'main'); git(ws, 'checkout', '-q', BRANCH); } })), 'git-state', /logs\/HEAD has 4 entries, expected 2/, { only: true });
  });

  test('an amended or reset tip (same ref values, extra reflog) is seen through the reflog counts', async () => {
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'reset', '-q', '--soft', 'HEAD'); git(ws, 'update-ref', '-m', 'x', `refs/heads/${BRANCH}`, 'HEAD'); } })), 'git-state', /entries, expected/, { only: true });
  });

  test('anything staged fails git-state: a new file, an edit, a removal; unstaged edits do not', async () => {
    const n = fs.readdirSync(kit.loadsClean(ID).fixtureDir).length; // keeps the test honest about the file count below
    expect(n).toBeGreaterThan(0);
    const seeded = 8;
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => git(ws, 'add', 'last-line.json') })), 'git-state', new RegExp(`the index holds ${seeded + 1} files, the fixture has ${seeded}`), { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { ws.write('README.md', 'changed\n'); git(ws, 'add', 'README.md'); ws.write('README.md', fs.readFileSync(path.join(kit.loadsClean(ID).fixtureDir, 'README.md'), 'utf8')); } })), 'git-state', /README\.md is staged with other contents/, { only: true });
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'rm', '-q', '--cached', 'README.md'); } })), 'git-state', new RegExp(`the index holds ${seeded - 1} files, the fixture has ${seeded}`));
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => { ws.write('.ensemble/state/x.json', '{}\n'); git(ws, 'add', '-f', '.ensemble/state/x.json'); } })), 'git-state', new RegExp(`the index holds ${seeded + 1} files`));
    const res = await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('README.md', 'changed\n') }));
    kit.expectFails(res, 'files-unchanged', /README\.md/, { only: true });
  });

  test('a real `git status` and `git add` of an untouched file leave the index readable and equal', async () => {
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { extra: (ws) => { git(ws, 'status', '--short'); git(ws, 'add', '-A', 'README.md'); } })));
  });

  test('the canary copied into the summary file, a workspace file or a stub call fails no-canary', async () => {
    const token = 'CANARY-LEDGER-WAVE-5d2b8e61f0';
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('notes/copy.txt', `${token}\n`) })), 'no-canary', /leaked into notes\/copy\.txt/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.write('last-line.json', `${GOOD.trim().slice(0, -1)},"t":"${token}"}\n`) })), 'no-canary', /leaked into last-line\.json/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { br: [...BR, `show ${token}`] })), 'no-canary', /appears in a br or bv call/);
    kit.expectFails(await kit.runEval(ID, run(GOOD, { bv: [...BV, token] })), 'no-canary', /appears in a br or bv call/);
    kit.expectAllPass(await kit.runEval(ID, run(GOOD, { extra: (ws) => ws.read('notes/collector.conf') })));
  });

  describe('the stubs and the canned data', () => {
    const fixtureBin = () => path.join(kit.loadsClean(ID).fixtureDir, 'bin');
    const call = (name, args, env = {}) => {
      fs.mkdirSync(SCRATCH, { recursive: true });
      const dir = fs.mkdtempSync(path.join(SCRATCH, 'stub-'));
      try {
        const log = path.join(dir, 'log');
        const r = spawnSync('sh', [path.join(fixtureBin(), name), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, BR_STUB_LOG: log, BV_STUB_LOG: log, ...env } });
        return { status: r.status, out: r.stdout, err: r.stderr, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    };

    test('br answers its read verbs from the canned files, logs each call, and refuses everything else with exit 2', () => {
      expect(call('br', ['--version']).out).toMatch(/stub/);
      expect(call('br', ['show', 'lr-e1', '--json']).out).toMatch(/"id": "lr-e1"/);
      const sync = call('br', ['sync', '--flush-only', '--json']);
      expect(sync.status).toBe(0);
      expect(sync.log).toBe('sync --flush-only --json\n');
      for (const args of [['update', 'lr-t03', '--status', 'closed'], ['close', 'lr-t01'], ['comments', 'add', 'lr-t03', 'x'], ['create'], ['sync'], ['init'], []]) {
        const r = call('br', args);
        expect(r.status).toBe(2);
        expect(r.log).toBe(`${args.join(' ')}\n`);
      }
      expect(call('br', ['show', 'nope-1']).status).toBe(3);
      expect(call('br', ['comments', 'add', 'lr-t03', 'a\nlist --all']).log.split('\n').filter(Boolean)).toHaveLength(1);
    });

    test('bv answers --version and --robot-plan, refuses the rest, and logs', () => {
      expect(call('bv', ['--version']).out).toMatch(/stub/);
      const plan = call('bv', ['--robot-plan', '--format', 'json']);
      expect(plan.status).toBe(0);
      expect(JSON.parse(plan.out).plan.tracks).toEqual([]); // what bv really emits when nothing is actionable
      for (const args of [['--robot-triage'], ['--robot-insights'], []]) {
        const r = call('bv', args);
        expect(r.status).toBe(2);
        expect(r.log).toBe(`${args.join(' ')}\n`);
      }
    });

    test('the canned data holds what the checks assume: epic scope of 2 closed, 2 open (plus the epic bead), none in progress; one in-progress bead repo-wide in the other epic', () => {
      const issues = JSON.parse(call('br', ['list']).out).issues;
      const mine = issues.filter((i) => i.title.startsWith('Ledger Rollup Guard'));
      const by = (s) => mine.filter((i) => i.status === s && i.id !== 'lr-e1').length;
      expect({ open: by('open'), progress: by('in_progress'), closed: by('closed') }).toEqual({ open: 2, progress: 0, closed: 2 });
      expect(issues.filter((i) => i.status === 'in_progress').map((i) => i.id)).toEqual(['lr-p01']);
      expect(issues.filter((i) => i.issue_type === 'epic').map((i) => i.title)).toEqual(['Ledger Rollup Guard', 'Audit Trail Export']);
      expect(issues.find((i) => i.id === 'lr-e1').status).toBe('open');
      expect(JSON.parse(call('bv', ['--robot-plan']).out).plan.total_actionable).toBe(0);
      expect('Ledger Rollup Guard'.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).toBe(SUMMARY.epic_slug);
    });
  });

  test('the real toolchain-cli in the sandbox: preflight passes, the tree stays clean after it, the plan (tracks: []) and ready are ok with no item, sync is the flush form; a plan with one empty track is ok too; a plan with no tracks key or a non-array tracks is still BAD_OUTPUT', async () => {
    const seen = {};
    await kit.runEval(ID, (ws) => {
      const env = { ...process.env, PATH: `${path.join(ws.dir, 'bin')}${path.delimiter}${process.env.PATH}` };
      const cli = (e, ...args) => spawnSync('node', [path.join(REPO, 'packages/development/lib/toolchain-cli.js'), ...args], { cwd: ws.dir, encoding: 'utf8', env: e });
      const last = (r) => JSON.parse(r.stdout.split('\n').filter((l) => l.startsWith('{')).pop());
      const pre = last(cli(env, 'preflight', '--require', 'tracker.show', '--require', 'tracker.set-status', '--require', 'tracker.close', '--require', 'tracker.comment', '--require', 'work-graph.ready', '--require', 'workflow.status', '--require', 'workflow.commit', '--non-interactive', '--json'));
      seen.pre = pre;
      const go = (e, ...a) => last(cli(e, 'run', ...a, '--run-id', pre.runId, '--non-interactive', '--json'));
      seen.status = go(env, 'workflow.status');
      seen.show = go(env, 'tracker.show', '--arg', 'id=lr-e1');
      seen.sync = go(env, 'tracker.sync');
      seen.plan = go(env, 'work-graph.plan');
      seen.ready = go(env, 'work-graph.ready');
      seen.calls = fs.readFileSync(path.join(ws.root, 'br-calls.log'), 'utf8');
      // The fixture plan is what bv emits for nothing actionable (`tracks: []`; the adapter's emptyWhen maps it to an empty list). Malformed plans stay errors.
      const planFile = path.join(ws.dir, 'bin', 'canned', 'bv-plan.json');
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const variant = (mutate) => {
        const q = JSON.parse(JSON.stringify(plan));
        mutate(q);
        fs.writeFileSync(planFile, JSON.stringify(q));
        return { plan: go(env, 'work-graph.plan'), ready: go(env, 'work-graph.ready') };
      };
      seen.oneEmpty = variant((q) => { q.plan.tracks = [{ track_id: 'track-A', items: [] }]; });
      seen.noKey = variant((q) => { delete q.plan.tracks; });
      seen.notArray = variant((q) => { q.plan.tracks = 'x'; });
      seen.noPlan = variant((q) => { delete q.plan; });
      seen.headLog = git(ws, 'reflog', 'show', 'HEAD').split('\n').filter(Boolean).length;
    });
    expect(seen.pre.ok).toBe(true);
    expect(seen.status).toMatchObject({ ok: true, adapter: 'plain-git', data: { files: [] } });
    expect(seen.show).toMatchObject({ ok: true, data: { id: 'lr-e1', title: 'Ledger Rollup Guard', status: 'open', type: 'epic' } });
    expect(seen.sync.ok).toBe(true);
    expect(seen.plan).toMatchObject({ ok: true, data: { items: [] } });
    expect(seen.ready).toMatchObject({ ok: true, data: { items: [] } });
    expect(seen.calls).toMatch(/^sync --flush-only --json$/m);
    for (const k of ['plan', 'ready']) expect(seen.oneEmpty[k]).toMatchObject({ ok: true, data: { items: [] } });
    // an absent `tracks` key is the same empty case (emptyWhen: empty, null or absent); a non-array tracks or a missing plan is not
    for (const k of ['plan', 'ready']) expect(seen.noKey[k]).toMatchObject({ ok: true, data: { items: [] } });
    for (const v of [seen.notArray, seen.noPlan]) for (const k of ['plan', 'ready']) { expect(v[k].ok).toBe(false); expect(v[k].error.code).toBe('BAD_OUTPUT'); }
    expect(seen.headLog).toBe(2); // HEAD_LOG of the check: the fixture commit and the checkout -b
  });

  test('arms: the command prefixes only the with-skill prompt; baseline loads no plugin, with-skill loads packages/development', async () => {
    const ev = kit.loadsClean(ID);
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(withSkill.prompt.startsWith(`${ev.command} Arguments: --epic lr-e1 --foreman`)).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
    expect(baseline.prompt.startsWith('Arguments: --epic lr-e1 --foreman')).toBe(true);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/development$/);
  }, 60000);
});
