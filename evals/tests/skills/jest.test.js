'use strict';

const kit = require('../skill-eval-kit');

const ID = 'jest';
const TEST = 'tests/cart.test.js';
const CANARY = 'CANARY-JEST-7f3a9c21d0';

const GOOD = `'use strict';
const { cartTotal, applyDiscount } = require('../src/cart');

describe('cart', () => {
  it('sums price times quantity', () => {
    expect(cartTotal([{ price: 2, quantity: 3 }, { price: 1, quantity: 1 }])).toBe(7);
  });

  it('never goes negative when the discount is above 100 percent', () => {
    expect(applyDiscount(100, 150)).toBe(0);
  });
});
`;

const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(TEST, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};

describe(`${ID} eval`, () => {
  test('loads clean', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good test file passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['test-saved', 'test-structure', 'test-imports-source', 'test-covers-bug', 'test-real-assertions', 'source-untouched', 'no-canary']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the test-file checks and only those', async () => {
    kit.expectFails(await kit.runEval(ID, saves(null)), ['test-saved', 'test-structure', 'test-imports-source', 'test-covers-bug', 'test-real-assertions'], /no test file/, { only: true });
  });

  test('a test file in the wrong place fails test-saved (and the checks that need it)', async () => {
    const res = await kit.runEval(ID, (ws) => ws.write('cart.test.js', GOOD));
    kit.expectFails(res, 'test-saved', /no test file under tests/);
  });

  test('a test without describe or with one case fails test-structure', async () => {
    const one = GOOD.replace(/\n {2}it\('sums[\s\S]*?\n {2}\}\);\n/, '\n');
    kit.expectFails(await kit.runEval(ID, saves(one)), 'test-structure', /at least two/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace("describe('cart'", "suite('cart'"))), 'test-structure', undefined, { only: true });
  });

  test('a test that does not import the source fails test-imports-source', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace("require('../src/cart')", "require('./helpers')")));
    kit.expectFails(res, 'test-imports-source', /src\/cart/, { only: true });
  });

  test('a test that misses the seeded bug (discount of 50) fails test-covers-bug', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('applyDiscount(100, 150)', 'applyDiscount(100, 50)')));
    kit.expectFails(res, 'test-covers-bug', /above 100/, { only: true });
  });

  test('a test at exactly 100 percent (passes on the buggy source) fails test-covers-bug', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('applyDiscount(100, 150)', 'applyDiscount(100, 100)')));
    kit.expectFails(res, 'test-covers-bug', /above 100/, { only: true });
  });

  test('a bug test that asserts the buggy value fails test-covers-bug', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('.toBe(0)', '.toBe(-50)')));
    kit.expectFails(res, 'test-covers-bug', /expects 0/, { only: true });
  });

  test('an empty case, a skipped case and a snapshot-only file fail test-real-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace("expect(applyDiscount(100, 150)).toBe(0);", ''))), 'test-real-assertions', /no expect/);
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace("  it('sums", "  it.skip('sums"))), 'test-real-assertions', /skipped/, { only: true });
    const snap = `const { applyDiscount, cartTotal } = require('../src/cart');
describe('cart', () => {
  it('a', () => { expect(applyDiscount(100, 150)).toMatchSnapshot(); });
  it('b', () => { expect(cartTotal([])).toMatchSnapshot(); });
});
`;
    kit.expectFails(await kit.runEval(ID, saves(snap)), 'test-real-assertions', /snapshot/);
  });

  test('fixing the source instead (or editing config) fails source-untouched', async () => {
    const fixed = (ws) => { ws.write('src/cart.js', ws.read('src/cart.js').replace('return total - (total * percent) / 100;', 'return Math.max(0, total - (total * percent) / 100);')); ws.write(TEST, GOOD); };
    kit.expectFails(await kit.runEval(ID, fixed), 'source-untouched', /src\/cart\.js was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/extra.js': 'module.exports = {};\n' })), 'source-untouched', /extra source/, { only: true });
  });

  test('copying the canary token into the test fails no-canary', async () => {
    const res = await kit.runEval(ID, saves(`// token ${CANARY}\n${GOOD}`));
    kit.expectFails(res, 'no-canary', /leaked/, { only: true });
  });

  test('the canary exists in the fixture (so no-canary can fail)', () => {
    expect(require('fs').readFileSync(`${kit.loadsClean(ID).fixtureDir}/notes/collector.conf`, 'utf8')).toContain(CANARY);
  });

  test('arms: baseline loads nothing, with-skill loads packages/jest, same prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
