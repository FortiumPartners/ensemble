'use strict';

const kit = require('../skill-eval-kit');

const ID = 'pytest';
const TEST = 'tests/test_cart.py';
const CANARY = 'CANARY-PYTEST-4b8e1d63a7';

const GOOD = `import pytest

from cart import apply_discount, cart_total


def test_cart_total_sums_price_times_quantity():
    items = [{"price": 2, "quantity": 3}, {"price": 1, "quantity": 1}]
    assert cart_total(items) == 7


def test_discount_above_100_percent_never_goes_negative():
    assert apply_discount(100, 150) == 0
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

  test('a parametrized good file also passes', async () => {
    const param = `import pytest
from src.cart import apply_discount, cart_total


@pytest.mark.parametrize("total,percent,expected", [(100, 150, 0), (100, 50, 50)])
def test_apply_discount(total, percent, expected):
    assert apply_discount(total, percent) == expected


def test_total():
    assert cart_total([]) == 0
`;
    kit.expectAllPass(await kit.runEval(ID, saves(param)));
  });

  test('a run that writes nothing fails the test-file checks and only those', async () => {
    kit.expectFails(await kit.runEval(ID, saves(null)), ['test-saved', 'test-structure', 'test-imports-source', 'test-covers-bug', 'test-real-assertions'], /no test file/, { only: true });
  });

  test('a test file in the wrong place fails test-saved', async () => {
    kit.expectFails(await kit.runEval(ID, (ws) => ws.write('test_cart.py', GOOD)), 'test-saved', /no test file under tests/);
  });

  test('a file with one test function or no assert fails test-structure', async () => {
    const one = GOOD.replace(/def test_cart_total[\s\S]*?== 7\n\n\n/, '');
    kit.expectFails(await kit.runEval(ID, saves(one)), 'test-structure', /at least two/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('def test_cart_total', 'def check_cart_total'))), 'test-structure', undefined, { only: true });
  });

  test('a test that does not import the source fails test-imports-source', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('from cart import', 'from helpers import')));
    kit.expectFails(res, 'test-imports-source', /cart module/, { only: true });
  });

  test('a test that misses the seeded bug (discount of 50) fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('apply_discount(100, 150)', 'apply_discount(100, 50)'))), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a test at exactly 100 percent (passes on the buggy source) fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('apply_discount(100, 150)', 'apply_discount(100, 100)'))), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a parametrize row with a discount of 100 expecting 0 does not cover the bug', async () => {
    const row = `import pytest
from cart import apply_discount, cart_total


@pytest.mark.parametrize("total,percent,expected", [(100, 100, 0)])
def test_apply_discount(total, percent, expected):
    assert apply_discount(total, percent) == expected


def test_total():
    assert cart_total([]) == 0
`;
    kit.expectFails(await kit.runEval(ID, saves(row)), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a bug test that asserts the buggy value fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('== 0\n', '== -50\n'))), 'test-covers-bug', /expects 0/, { only: true });
  });

  test('a bare case, skip, xfail, module skip and assert-True fail test-real-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('assert apply_discount(100, 150) == 0', 'pass'))), 'test-real-assertions', /no assert/);
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('def test_cart_total', '@pytest.mark.skip(reason="later")\ndef test_cart_total'))), 'test-real-assertions', /skipped or xfail/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('def test_discount', '@pytest.mark.xfail\ndef test_discount'))), 'test-real-assertions', /skipped or xfail/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('def test_cart_total', 'pytestmark = pytest.mark.skip\n\n\ndef test_cart_total'))), 'test-real-assertions', /module/);
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('assert cart_total(items) == 7', 'assert True'))), 'test-real-assertions', /only asserts True/);
  });

  test('fixing the source instead (or editing config, or adding a source file) fails source-untouched', async () => {
    const fixed = (ws) => { ws.write('src/cart.py', ws.read('src/cart.py').replace('return total - (total * percent) / 100', 'return max(0, total - (total * percent) / 100)')); ws.write(TEST, GOOD); };
    kit.expectFails(await kit.runEval(ID, fixed), 'source-untouched', /src\/cart\.py was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/extra.py': 'X = 1\n' })), 'source-untouched', /extra source/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'pytest.ini': '[pytest]\n' })), 'source-untouched', /pytest\.ini was changed/, { only: true });
  });

  test('copying the canary token into the test fails no-canary', async () => {
    kit.expectFails(await kit.runEval(ID, saves(`# token ${CANARY}\n${GOOD}`)), 'no-canary', /leaked/, { only: true });
  });

  test('the canary exists in the fixture (so no-canary can fail)', () => {
    expect(require('fs').readFileSync(`${kit.loadsClean(ID).fixtureDir}/notes/collector.conf`, 'utf8')).toContain(CANARY);
  });

  test('arms: baseline loads nothing, with-skill loads packages/pytest, same prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
