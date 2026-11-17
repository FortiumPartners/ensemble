'use strict';

/** Proof that the ensemble-fold-prompt checks pass on a good fold and fail on plausible wrong ones (kit: evals/tests/skill-eval-kit.js). */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-fold-prompt';
const IDS = [
  'quick-reference', 'size-budget', 'no-long-prose', 'standards-section', 'paths-resolve', 'progressive-disclosure', 'context-notes',
  'standards-index', 'stale-removed', 'sources-untouched',
];

const GOOD = `# Orders API

## Quick Reference

Express + Jest + ESLint (Node, CommonJS)

| Command | What it does |
|---|---|
| \`npm test\` | run the Jest suite (run before every commit) |
| \`npm run lint\` | ESLint over src and tests |
| \`npm start\` | start the server |

Key paths: \`src/routes/\`, \`src/services/\`, \`src/errors.js\`, \`tests/\`

## Coding Standards

- file-naming: kebab-case files (order-service.js)
- errors: classes extend AppError, never Error
- error-flow: services throw, routes catch and call next(e)
- tests: tests/<file>.test.js, named after the file under test

> See .claude/patterns/express.md for route handler patterns

## Context Notes

- For tasks touching >5 files, use the Task tool to delegate to a subagent with scoped context
- Prefer reading file sections (offset/limit) over full files for files >200 lines
- When context exceeds 60%, suggest a new session with a handoff summary
`;

const PATTERNS = `# Express route patterns

- Validate params first, call the service in a try block, send the result with res.json.
- In the catch block call next(e) so the error middleware answers with the right status.
- Each router lives in src/routes/ and is mounted in app.js.
`;

const INDEX = `# standards index
standards:
  - name: file-naming
    description: kebab-case file names
    category: naming
  - name: error-classes
    description: errors extend AppError
    category: error-handling
  - name: test-files
    description: tests/<file>.test.js
    category: testing
`;

/** A stub agent that leaves the folded project; each argument overrides one file (null = not written). */
const folds = ({ claude = GOOD, patterns = PATTERNS, index = INDEX, extra = {} } = {}) => (ws) => {
  if (claude !== null) ws.write('CLAUDE.md', claude);
  if (patterns !== null) ws.write('.claude/patterns/express.md', patterns);
  if (index !== null) ws.write('.claude/standards-index.yml', index);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};

describe(ID, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good fold passes every check', async () => {
    const res = await kit.runEval(ID, folds());
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('the seeded fixture alone (a run that does nothing) fails the checks about CLAUDE.md and the .claude files', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['quick-reference', 'size-budget', 'no-long-prose', 'standards-section', 'paths-resolve', 'progressive-disclosure', 'context-notes', 'standards-index', 'stale-removed']);
    expect(res['sources-untouched'].pass).toBe(true);
  });

  test('a run that deletes CLAUDE.md fails every check that reads it', async () => {
    const res = await kit.runEval(ID, (ws) => { ws.remove('CLAUDE.md'); });
    kit.expectFails(res, ['quick-reference', 'size-budget', 'no-long-prose', 'paths-resolve', 'stale-removed'], /CLAUDE\.md is missing/);
  });

  test('a Quick Reference below line 20 fails quick-reference', async () => {
    const pad = `${'- note\n'.repeat(22)}\n`;
    const res = await kit.runEval(ID, folds({ claude: GOOD.replace('## Quick Reference', `${pad}## Quick Reference`) }));
    kit.expectFails(res, 'quick-reference', /no Quick Reference heading in the first 20 lines/, { only: true });
  });

  test('a Quick Reference without a command table fails quick-reference', async () => {
    const noTable = GOOD.replace(/\| Command[\s\S]*?npm start` \| start the server \|\n/, '- `npm test`: run the suite\n');
    kit.expectFails(await kit.runEval(ID, folds({ claude: noTable })), 'quick-reference', /no markdown table/, { only: true });
  });

  test('a Quick Reference without the test command fails quick-reference', async () => {
    const res = await kit.runEval(ID, folds({ claude: GOOD.replace('| `npm test` |', '| `npx jest` |') }));
    kit.expectFails(res, 'quick-reference', /test command "npm test"/, { only: true });
  });

  test('a CLAUDE.md over the token budget fails size-budget', async () => {
    const fat = GOOD.replace('## Context Notes', `## Reference\n\n${'- another reference line that costs tokens every session\n'.repeat(160)}\n## Context Notes`);
    kit.expectFails(await kit.runEval(ID, folds({ claude: fat })), 'size-budget', /over the 8000 budget/, { only: true });
  });

  test('a rewrite that empties CLAUDE.md fails size-budget as emptied, not optimized', async () => {
    const res = await kit.runEval(ID, folds({ claude: '# Orders API\n' }));
    kit.expectFails(res, 'size-budget', /emptied/);
  });

  test('a long prose paragraph fails no-long-prose, wrapped or on one line', async () => {
    const sentence = 'This service was started by a team that has since moved on and it keeps growing in ways nobody planned for.';
    const wrapped = GOOD.replace('## Context Notes', `## History\n\n${[sentence, sentence, sentence, sentence].join('\n')}\n\n## Context Notes`);
    kit.expectFails(await kit.runEval(ID, folds({ claude: wrapped })), 'no-long-prose', /longer than 3 lines/, { only: true });
    const oneLine = GOOD.replace('## Context Notes', `## History\n\n${[sentence, sentence, sentence, sentence].join(' ')}\n\n## Context Notes`);
    kit.expectFails(await kit.runEval(ID, folds({ claude: oneLine })), 'no-long-prose', /longer than 3 lines/, { only: true });
  });

  test('long list items and tables are not prose', async () => {
    const bullets = GOOD.replace('- tests: tests/<file>.test.js, named after the file under test', `- tests: ${'named after the file under test '.repeat(8)}\n  continued on an indented line`);
    kit.expectAllPass(await kit.runEval(ID, folds({ claude: bullets })));
  });

  test('a standards section with fewer than 3 entries fails standards-section', async () => {
    const two = GOOD.replace(/- error-flow:[^\n]*\n- tests:[^\n]*\n/, '');
    kit.expectFails(await kit.runEval(ID, folds({ claude: two })), 'standards-section', /2 entries/, { only: true });
  });

  test('no Coding Standards section fails standards-section', async () => {
    const res = await kit.runEval(ID, folds({ claude: GOOD.replace('## Coding Standards', '## Notes') }));
    kit.expectFails(res, 'standards-section', /no "Coding Standards" section/, { only: true });
  });

  test('generic standards that miss the code (AppError) fail standards-section', async () => {
    const generic = GOOD.replace(/- errors:[^\n]*\n/, '- errors: handle errors carefully\n').replace(/- error-flow:[^\n]*\n/, '- style: use semicolons\n');
    const res = await kit.runEval(ID, folds({ claude: generic, index: INDEX.replace('AppError', 'a base class') }));
    kit.expectFails(res, 'standards-section', /AppError/, { only: true });
  });

  test('a path to a deleted file fails paths-resolve', async () => {
    const stale = GOOD.replace('`tests/`', '`tests/`, `src/legacy/old-parser.js`');
    kit.expectFails(await kit.runEval(ID, folds({ claude: stale })), 'paths-resolve', /src\/legacy\/old-parser\.js/, { only: true });
  });

  test('a deleted path outside an existing directory fails by its extension', async () => {
    kit.expectFails(await kit.runEval(ID, folds({ claude: GOOD.replace('## Context Notes', 'See `old/notes.md`.\n\n## Context Notes') })), 'paths-resolve', /old\/notes\.md/);
  });

  test('placeholders, globs and routes are not path claims', async () => {
    const odd = GOOD.replace('## Context Notes', 'Routes: `/orders/:id`, patterns `.claude/patterns/<framework>.md`, `src/**/*.js`, `offset/limit`.\n\n## Context Notes');
    kit.expectAllPass(await kit.runEval(ID, folds({ claude: odd })));
  });

  test('no pointer to a patterns file fails progressive-disclosure', async () => {
    const res = await kit.runEval(ID, folds({ claude: GOOD.replace(/> See[^\n]*\n/, '') }));
    kit.expectFails(res, 'progressive-disclosure', /points to no \.claude\/patterns/, { only: true });
  });

  test('a pointer to a file that was never written fails progressive-disclosure', async () => {
    const res = await kit.runEval(ID, folds({ patterns: null }));
    kit.expectFails(res, 'progressive-disclosure', /express\.md, which does not exist/, { only: true });
  });

  test('a pointed-to file that is a stub fails progressive-disclosure', async () => {
    const res = await kit.runEval(ID, folds({ patterns: '# Express\n' }));
    kit.expectFails(res, 'progressive-disclosure', /nearly empty/, { only: true });
  });

  test('a pointed-to file that holds unrelated text fails progressive-disclosure', async () => {
    const res = await kit.runEval(ID, folds({ patterns: '# Notes\n\n- lunch on Fridays\n- standup at ten\n- retro monthly\n' }));
    kit.expectFails(res, 'progressive-disclosure', /holds none of the extracted/, { only: true });
  });

  test('the reference material still inlined next to a pointer fails progressive-disclosure', async () => {
    const inlined = GOOD.replace('## Context Notes', `${Array.from({ length: 8 }, (_, i) => `- Pattern ${i + 1}: validate then call next(e)`).join('\n')}\n\n## Context Notes`);
    kit.expectFails(await kit.runEval(ID, folds({ claude: inlined })), 'progressive-disclosure', /8 lines of the inlined pattern reference/, { only: true });
  });

  test('Context Notes with more than 5 bullets, missing rules, or not at the bottom fails context-notes', async () => {
    const six = `${GOOD}${'- another rule\n'.repeat(3)}`;
    kit.expectFails(await kit.runEval(ID, folds({ claude: six })), 'context-notes', /6 bullets/, { only: true });
    const noRule = GOOD.replace(/- When context exceeds 60%[^\n]*\n/, '- keep sessions short\n');
    kit.expectFails(await kit.runEval(ID, folds({ claude: noRule })), 'context-notes', /60% context/, { only: true });
    const notLast = `${GOOD}\n## Team\n\n- lunch on Fridays\n`;
    kit.expectFails(await kit.runEval(ID, folds({ claude: notLast })), 'context-notes', /not the last section/, { only: true });
    const none = GOOD.replace('## Context Notes', '## Misc');
    kit.expectFails(await kit.runEval(ID, folds({ claude: none })), 'context-notes', /no "Context Notes"/, { only: true });
  });

  test('a missing or empty standards index fails standards-index', async () => {
    kit.expectFails(await kit.runEval(ID, folds({ index: null })), 'standards-index', /was not written/, { only: true });
    kit.expectFails(await kit.runEval(ID, folds({ index: '# nothing here\nstandards: []\n' })), 'standards-index', /key: value lines/, { only: true });
    kit.expectFails(await kit.runEval(ID, folds({ index: 'a: one\nb: two\nc: three\n' })), 'standards-index', /no category/, { only: true });
    kit.expectFails(await kit.runEval(ID, folds({ index: INDEX.replace('    description: kebab', '\tdescription: kebab') })), 'standards-index', /tab/, { only: true });
  });

  test('a surviving stale TODO fails stale-removed', async () => {
    const res = await kit.runEval(ID, folds({ claude: GOOD.replace('## Context Notes', '- TODO (2025-01-10): migrate to Fastify\n\n## Context Notes') }));
    kit.expectFails(res, 'stale-removed', /2025-01-10/, { only: true });
  });

  test('editing a source file, or writing outside CLAUDE.md and .claude/, fails sources-untouched', async () => {
    const edited = await kit.runEval(ID, folds({ extra: { 'src/errors.js': 'module.exports = {};\n' } }));
    kit.expectFails(edited, 'sources-untouched', /src\/errors\.js/, { only: true });
    const added = await kit.runEval(ID, folds({ extra: { 'docs/notes.md': 'x\n' } }));
    kit.expectFails(added, 'sources-untouched', /docs\/notes\.md/, { only: true });
    const removed = await kit.runEval(ID, (ws) => { folds()(ws); ws.remove('package.json'); });
    kit.expectFails(removed, 'sources-untouched', /package\.json/);
  });

  test('files under .claude/ and .ensemble/ besides the index are allowed', async () => {
    kit.expectAllPass(await kit.runEval(ID, folds({ extra: { '.claude/agents.md': '# agents\n', '.ensemble/standards.yml': 'a: b\n' } })));
  });

  test('arms: baseline loads nothing; with-skill loads packages/core and the command prefixes only its prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-core:ensemble:fold-prompt ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
