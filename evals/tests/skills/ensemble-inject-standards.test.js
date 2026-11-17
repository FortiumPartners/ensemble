'use strict';

/**
 * Proof that the ensemble-inject-standards checks (evals/checks/ensemble-inject-standards.js) pass on a faithful run and fail on
 * plausible wrong ones. The stub agent writes the file the real run is told to leave (standards-context.txt), never calls a model.
 */

const kit = require('../skill-eval-kit');

const ID = 'ensemble-inject-standards';
const OUT = 'standards-context.txt';

const GOOD = `=== RELEVANT STANDARDS FOR: Implement a REST endpoint that lists a user's orders, adding the module import it needs. ===
Stack: TypeScript + NestJS

naming
- Use camelCase for variables and functions  [example: orderTotal, fetchOrders]
- Name source files in kebab-case

git
- Use conventional commit messages  [example: feat(orders): add list]
- Start branch names with feat/ or fix/

api
- Wrap responses in a data and meta envelope  [example: { "data": [], "meta": {} }]
- Use plural nouns for resource paths

imports
- Group imports as builtins, packages, then local files
- Prefer the @/ alias over deep relative paths

Full index: standards/index.yml
=====================================
Standards injected. Proceed with task using the above conventions.
Run /ensemble:standards discover to refresh the index if the codebase has changed.
`;

/** A stub agent that saves `text` as the block (null: nothing) and optionally writes/removes other files. */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(OUT, text);
  for (const [rel, body] of Object.entries(extra)) { if (body === null) ws.remove(rel); else ws.write(rel, body); }
};
const without = (re) => GOOD.split('\n').filter((l) => !re.test(l)).join('\n');

describe(`${ID}`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('the prompt carries no keyword that would boost testing or error_handling (they must score 0)', () => {
    const { prompt } = kit.loadsClean(ID);
    expect(prompt.toLowerCase()).not.toMatch(/test|spec|coverage|unit|integration|e2e|fixture|mock|fix|bug|error|exception|crash|failure|handle|rescue/);
    expect(prompt.toLowerCase()).toMatch(/endpoint/); // api: the top-scoring category
  });

  test('a faithful block passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['context-saved', 'header-stack', 'rules-present', 'rules-absent', 'rule-count', 'example-inline', 'footer-handoff', 'index-unchanged', 'only-expected-files']);
    kit.expectAllPass(res);
  });

  test('the optional second category may be dropped (6 bullets) and the block still passes', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/imports\n- .*\n- .*\n\n/, '')));
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the block checks and only those', async () => {
    const res = await kit.runEval(ID, saves(null));
    kit.expectFails(res, ['context-saved', 'header-stack', 'rules-present', 'rules-absent', 'rule-count', 'example-inline', 'footer-handoff'], /standards-context\.txt is missing/, { only: true });
  });

  test('a blank file fails context-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('\n')), 'context-saved', /is empty/);
  });

  test('dumping the whole index (every rule, no selection) fails rules-absent and rule-count', async () => {
    const dump = GOOD.replace('Full index', `testing\n- Name test files with the *.spec.ts suffix\n- Mock only at the network boundary\n- One assertion topic per case\n\nerror_handling\n- Throw typed AppError subclasses\n- Never swallow exceptions silently\n- Log errors once at the service boundary\n\nFull index`);
    kit.expectFails(await kit.runEval(ID, saves(dump)), ['rules-absent', 'rule-count'], undefined, { only: true });
  });

  test('a single stray irrelevant rule fails rules-absent only', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/imports\n- .*\n- .*\n\n/, '').replace('Full index', '- Throw typed AppError subclasses\nFull index')));
    kit.expectFails(res, 'rules-absent', /AppError/, { only: true });
  });

  test('dropping a universal git rule fails rules-present', async () => {
    kit.expectFails(await kit.runEval(ID, saves(without(/feat\//))), 'rules-present', /feat\//);
  });

  test('dropping the top-scoring category (api) fails rules-present', async () => {
    const res = await kit.runEval(ID, saves(without(/envelope|plural nouns/)));
    kit.expectFails(res, ['rules-present', 'example-inline'], undefined, { only: true });
    kit.expectFails(res, 'rules-present', /envelope; plural nouns/);
  });

  test('a stack line with the wrong stack fails header-stack', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('TypeScript + NestJS', 'Python + Django'))), 'header-stack', /Stack: TypeScript \+ NestJS/, { only: true });
  });

  test('a header that does not carry the task fails header-stack', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/RELEVANT STANDARDS FOR:.*===/, 'RELEVANT STANDARDS FOR: something else ==='))), 'header-stack', /does not carry the task/, { only: true });
  });

  test('a block without the header line fails header-stack', async () => {
    kit.expectFails(await kit.runEval(ID, saves(without(/^=== RELEVANT/))), 'header-stack', /no "=== RELEVANT STANDARDS FOR/, { only: true });
  });

  test('too few rules (selected 4) fails rule-count', async () => {
    const res = await kit.runEval(ID, saves(without(/kebab-case|plural nouns|imports|Group imports|@\//)));
    kit.expectFails(res, 'rule-count', /\d rule bullets, expected 5-8/);
  });

  test('a rule printed only in prose, not as a bullet, fails example-inline', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/- (Wrap responses)/, 'Note: $1'))), 'example-inline', /not printed as a bullet/);
  });

  test('rules printed without their example fail example-inline', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/ +\[example: [^\n]*\]/g, ''))), 'example-inline', /no inline \[example/, { only: true });
  });

  test('a block without the footer fails footer-handoff', async () => {
    kit.expectFails(await kit.runEval(ID, saves(without(/^Full index/))), 'footer-handoff', /Full index/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(without(/^Standards injected/))), 'footer-handoff', /Standards injected/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(without(/^Run \/ensemble/))), 'footer-handoff', /standards discover/, { only: true });
  });

  test('a modified index fails index-unchanged', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'standards/index.yml': 'version: 1\n' }));
    kit.expectFails(res, 'index-unchanged', /modified/, { only: true });
  });

  test('a deleted index fails index-unchanged', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'standards/index.yml': null })), 'index-unchanged', /missing/, { only: true });
  });

  test('implementation written next to a good block fails only-expected-files', async () => {
    const res = await kit.runEval(ID, saves(GOOD, { 'src/orders.controller.ts': 'export class OrdersController {}\n' }));
    kit.expectFails(res, 'only-expected-files', /src\/orders\.controller\.ts/, { only: true });
  });

  test('arms: baseline loads nothing, with-skill loads packages/core; the command prefixes only the with-skill prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt.startsWith('/ensemble-core:ensemble:inject-standards ')).toBe(true);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
