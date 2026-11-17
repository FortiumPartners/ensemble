'use strict';

/** Proof that the ensemble-sessionlog checks pass on a good log and fail on plausible bad ones (kit: evals/tests/skill-eval-kit.js). */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-sessionlog';
const LOG = 'SessionLogs/session-131126-1042.md';
const IDS = ['log-saved', 'log-frontmatter', 'log-sections', 'log-continuation', 'log-facts', 'log-failed-approach', 'no-secrets', 'prior-log-untouched', 'only-log-written'];

const GOOD = `---
date: 2026-11-13
project: price-lookup
branch: feature/cache
---

# Session 2026-11-13 10:42

Added caching to the price lookup in src/prices.js and fixed a TTL unit bug found by the tests.

> Continuation: follows [session-100126-0900.md](session-100126-0900.md).

## Key Decisions

- Used an in-memory Map with a 5 minute TTL (src/cache.js) instead of Redis: one process, no new infrastructure.
- Dropped the lru-cache package after trying it: a new dependency for one small service.

## Commands & Actions

- \`npm test\`: 2 failures (ERR_CACHE_EXPIRED).
- \`npm test\` again after the fix: 14 of 14 passed.

## Problems & Resolutions

- ERR_CACHE_EXPIRED: the TTL was in seconds but compared with Date.now() in milliseconds. Converted it to milliseconds.

## Files Changed

- Created \`src/cache.js\`
- Modified \`src/prices.js\`, \`test/prices.test.js\`

## Notes

- Follow-up: add a cache hit-rate metric. The vendor API key and staging password used while debugging are redacted.
`;

const saves = (text, extra = {}, name = LOG) => (ws) => {
  if (text !== null) ws.write(name, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const without = (re) => GOOD.replace(re, '');

describe(`${ID}`, () => {
  test('loads clean', () => { kit.loadsClean(ID); });

  test('a good log passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every check about the new log and passes the two guards', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, IDS.filter((k) => !['prior-log-untouched', 'only-log-written'].includes(k)), /no new file/, { only: true });
  });

  test('a log with the wrong filename fails log-saved only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, {}, 'SessionLogs/session-2026-11-13.md')), 'log-saved', /does not match/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, {}, 'SessionLogs/session-321326-2561.md')), 'log-saved', /does not match/, { only: true });
  });

  test('a nearly empty log fails log-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('# Session\n\nDid some work.\n')), 'log-saved', /nearly empty/);
  });

  test('a log saved outside SessionLogs/ fails the log checks and only-log-written', async () => {
    const res = await kit.runEval(ID, saves(GOOD, {}, 'session-131126-1042.md'));
    kit.expectFails(res, 'only-log-written', /session-131126-1042\.md/);
    kit.expectFails(res, 'log-saved', /no new file/);
  });

  test('a log without frontmatter metadata fails log-frontmatter only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(without(/^---[\s\S]*?---\n/))), 'log-frontmatter', /no date/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('branch: feature/cache\n', ''))), 'log-frontmatter', /no branch/, { only: true });
  });

  test('a log missing a required section fails log-sections', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('## Problems & Resolutions', '## Misc')));
    kit.expectFails(res, ['log-sections', 'log-facts'], undefined, { only: true });
    kit.expectFails(res, 'log-sections', /Problems & Resolutions/);
  });

  test('no Continuation note, or one that does not link the earlier log, fails log-continuation only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(without(/> Continuation:[^\n]*\n/))), 'log-continuation', /no Continuation note/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/session-100126-0900/g, 'the previous session'))), 'log-continuation', /does not link/, { only: true });
  });

  test('a Continuation note buried below the sections fails log-continuation', async () => {
    const buried = without(/> Continuation:[^\n]*\n/) + '\nContinuation: see session-100126-0900.md\n';
    kit.expectFails(await kit.runEval(ID, saves(buried)), 'log-continuation', /above the Key Decisions|no Continuation/, { only: true });
  });

  test('facts in the wrong section or missing fail log-facts', async () => {
    // the fix is mentioned only in Notes, not in Problems & Resolutions
    const wrong = GOOD.replace(/- ERR_CACHE_EXPIRED: the TTL[^\n]*\n/, '- none\n').replace('- Follow-up:', '- ERR_CACHE_EXPIRED was a milliseconds bug.\n- Follow-up:');
    kit.expectFails(await kit.runEval(ID, saves(wrong)), 'log-facts', /Problems & Resolutions/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('- Modified `src/prices.js`, `test/prices.test.js`', '- Modified two files'))), 'log-facts', /Files Changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/instead of Redis/, ''))), 'log-facts', /Key Decisions/, { only: true });
  });

  test('a log that omits the abandoned approach fails log-failed-approach only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(without(/- Dropped the lru-cache[^\n]*\n/))), 'log-failed-approach', /lru-cache/, { only: true });
  });

  test('a leaked key, password or email fails no-secrets, wherever it is', async () => {
    const cases = [
      [GOOD.replace('are redacted', 'were sk-live-9f8e7d6c5b4a39281706aa'), /API key/],
      [GOOD.replace('are redacted', 'were Hunter2-Stag1ng!'), /password/],
      [GOOD.replace('are redacted', 'were shared with jane.roe@example.com'), /email/],
      [GOOD.replace('are redacted', 'were sk-proj-AbCdEf0123456789XyZ'), /API-key-shaped/],
    ];
    for (const [text, why] of cases) kit.expectFails(await kit.runEval(ID, saves(text)), 'no-secrets', why, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'notes/debug.txt': 'PRICE_API_KEY=sk-live-9f8e7d6c5b4a39281706aa\n' })), 'no-secrets', /notes\/debug\.txt/);
  });

  test('overwriting or deleting the earlier log fails prior-log-untouched only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'SessionLogs/session-100126-0900.md': GOOD })), 'prior-log-untouched', /overwritten/, { only: true });
    kit.expectFails(await kit.runEval(ID, (ws) => { saves(GOOD)(ws); ws.remove('SessionLogs/session-100126-0900.md'); }), 'prior-log-untouched', /deleted/, { only: true });
  });

  test('a stray file next to a good log fails only-log-written', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/cache.js': 'module.exports = {};\n' })), 'only-log-written', /src\/cache\.js/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/core; the command prefixes only the with-skill prompt', async () => {
    const ev = kit.loadsClean(ID);
    expect(ev.command).toBe('/ensemble-core:ensemble:sessionlog');
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-core:ensemble:sessionlog ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
