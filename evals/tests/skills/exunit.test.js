'use strict';

const fs = require('fs');
const kit = require('../skill-eval-kit');

const ID = 'exunit';
const TEST = 'test/cart_test.exs';
const CANARY = 'CANARY-EXUNIT-5d83b6e0a1';
const ALL = ['test-saved', 'test-structure', 'test-references-source', 'test-covers-bug', 'test-real-assertions', 'source-untouched', 'no-canary'];

const BUG = 'assert Cart.apply_discount(100, 150) == 0';
const TOTAL = 'assert Cart.cart_total([%{price: 2, quantity: 3}]) == 6';

const GOOD = `defmodule CartTest do
  use ExUnit.Case, async: true

  describe "cart_total/1" do
    test "sums price times quantity" do
      ${TOTAL}
    end
  end

  describe "apply_discount/2" do
    test "a discount above 100 percent never goes negative" do
      ${BUG}
    end
  end
end
`;

const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(TEST, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => GOOD.replace(from, to);

describe(`${ID} eval`, () => {
  test('loads clean', () => {
    expect(kit.loadsClean(ID).fixtureDir).toBeTruthy();
  });

  test('a good test file passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(ALL);
    kit.expectAllPass(res);
  });

  test('variants (pipe form, pattern match, refute, variable, no describe) also pass', async () => {
    kit.expectAllPass(await kit.runEval(ID, saves(swap(BUG, 'assert 100 |> Cart.apply_discount(150) == 0'))));
    kit.expectAllPass(await kit.runEval(ID, saves(swap(BUG, 'assert 0.0 = Cart.apply_discount(100.0, 150.0)'))));
    kit.expectAllPass(await kit.runEval(ID, saves(swap(BUG, 'refute Cart.apply_discount(100, 150) < 0'))));
    kit.expectAllPass(await kit.runEval(ID, saves(swap(BUG, 'result = Cart.apply_discount 100, 150\n      assert result >= 0'))));
    const flat = `defmodule CartTest do
  use ExUnit.Case

  import Cart

  test "total" do
    assert cart_total([]) == 0
  end

  test "discount clamps", %{} do
    assert apply_discount(100, 1_500) === 0
  end
end
`;
    kit.expectAllPass(await kit.runEval(ID, saves(flat)));
  });

  test('a run that writes nothing fails the test-file checks and only those', async () => {
    kit.expectFails(await kit.runEval(ID, saves(null)), ALL.slice(0, 5), /no \*_test\.exs/, { only: true });
  });

  test('a test file in the wrong place or with the wrong name fails test-saved', async () => {
    kit.expectFails(await kit.runEval(ID, (ws) => ws.write('cart_test.exs', GOOD)), 'test-saved', /no \*_test\.exs/);
    kit.expectFails(await kit.runEval(ID, (ws) => ws.write('test/cart.exs', GOOD)), 'test-saved', /no \*_test\.exs/);
  });

  test('a file with one test, no use ExUnit.Case, or no assertion fails test-structure', async () => {
    const one = GOOD.replace(/ {2}describe "cart_total\/1" do[\s\S]*?\n {2}end\n\n/, '');
    kit.expectFails(await kit.runEval(ID, saves(one)), 'test-structure', /at least two/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('use ExUnit.Case, async: true', 'use SomethingElse'))), 'test-structure', /use ExUnit\.Case/, { only: true });
    const bare = swap(TOTAL, 'x = Cart.cart_total([])').replace(BUG, 'y = Cart.apply_discount(100, 150)');
    kit.expectFails(await kit.runEval(ID, saves(bare)), 'test-structure', /assert\/refute/);
  });

  test('a file that never calls Cart fails test-references-source', async () => {
    const other = GOOD.replace(TOTAL, 'assert 6 == 2 * 3').replace(BUG, 'assert max(0, 100 - 150) == 0');
    kit.expectFails(await kit.runEval(ID, saves(other)), ['test-references-source', 'test-covers-bug'], undefined, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(other)), 'test-references-source', /does not call the Cart/);
  });

  test('a bug test with a discount of 100 or less, or a variable, fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap(BUG, 'assert Cart.apply_discount(100, 100) == 0'))), 'test-covers-bug', /above 100/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap(BUG, 'assert Cart.apply_discount(100, 50) == 50'))), 'test-covers-bug', /above 100/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap(BUG, 'pct = 150\n      assert Cart.apply_discount(100, pct) == 0'))), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a bug test that asserts the buggy value or a non-zero total fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap(BUG, 'assert Cart.apply_discount(100, 150) == -50'))), 'test-covers-bug', /above 100/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap(BUG, 'assert Cart.apply_discount(100, 150) == 0.5'))), 'test-covers-bug', /above 100/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap(BUG, 'assert Cart.apply_discount(100, 150) == 10'))), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a covering call and a zero assert in different tests does not count', async () => {
    const split = swap(BUG, 'assert is_number(Cart.apply_discount(100, 150))').replace(TOTAL, 'assert Cart.cart_total([]) == 0');
    kit.expectFails(await kit.runEval(ID, saves(split)), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a commented-out assertion does not count (test-covers-bug and test-real-assertions)', async () => {
    const res = await kit.runEval(ID, saves(swap(BUG, `# ${BUG}`)));
    kit.expectFails(res, ['test-covers-bug', 'test-real-assertions'], undefined, { only: true });
  });

  test('skipped, empty, bodiless and assert-true tests fail test-real-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('    test "sums', '    @tag :skip\n    test "sums'))), 'test-real-assertions', /skipped/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(`@moduletag :skip\n${GOOD}`)), 'test-real-assertions', /skipped/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap(TOTAL, 'x = Cart.cart_total([])'))), 'test-real-assertions', /no assertion/);
    kit.expectFails(await kit.runEval(ID, saves(swap('test "sums price times quantity" do\n      ' + TOTAL + '\n    end', 'test "sums price times quantity"'))), 'test-real-assertions', /no assertion/);
    kit.expectFails(await kit.runEval(ID, saves(swap(TOTAL, 'assert true, "Test not implemented"'))), 'test-real-assertions', /only asserts true/);
    kit.expectFails(await kit.runEval(ID, saves(swap(TOTAL, 'assert(true)'))), 'test-real-assertions', /only asserts true/);
    kit.expectFails(await kit.runEval(ID, saves(swap(TOTAL, 'refute false'))), 'test-real-assertions', /only asserts true/);
  });

  test('fixing the source instead (or editing mix.exs, or adding a lib file) fails source-untouched', async () => {
    const fixed = (ws) => { ws.write('lib/cart.ex', ws.read('lib/cart.ex').replace('total - total * percent / 100', 'max(0, total - total * percent / 100)')); ws.write(TEST, GOOD); };
    kit.expectFails(await kit.runEval(ID, fixed), 'source-untouched', /lib\/cart\.ex was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'lib/extra.ex': 'defmodule X do\nend\n' })), 'source-untouched', /extra source/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'mix.exs': '# changed\n' })), 'source-untouched', /mix\.exs was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'test/test_helper.exs': 'ExUnit.start(autorun: false)\n' })), 'source-untouched', /test_helper\.exs was changed/, { only: true });
  });

  test('copying the canary token into the test fails no-canary', async () => {
    kit.expectFails(await kit.runEval(ID, saves(`# token ${CANARY}\n${GOOD}`)), 'no-canary', /leaked/, { only: true });
  });

  test('the canary exists in the fixture (so no-canary can fail)', () => {
    expect(fs.readFileSync(`${kit.loadsClean(ID).fixtureDir}/notes/collector.conf`, 'utf8')).toContain(CANARY);
  });

  test('arms: baseline loads nothing, with-skill loads packages/exunit, same prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
