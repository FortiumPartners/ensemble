'use strict';

const fs = require('fs');
const kit = require('../skill-eval-kit');

const ID = 'xunit';
const TEST = 'tests/CartTests.cs';
const CANARY = 'CANARY-XUNIT-7c2f9a41e8';
const ALL = ['test-saved', 'test-structure', 'test-references-source', 'test-covers-bug', 'test-real-assertions', 'source-untouched', 'no-canary'];

const GOOD = `using ShopApp;
using Xunit;

namespace ShopApp.Tests;

public class CartTests
{
    [Fact]
    public void CartTotal_SumsPriceTimesQuantity()
    {
        var items = new[] { new CartItem(2, 3), new CartItem(1, 1) };
        Assert.Equal(7, Cart.CartTotal(items));
    }

    [Fact]
    public void ApplyDiscount_Above100Percent_NeverGoesNegative()
    {
        Assert.Equal(0, Cart.ApplyDiscount(100, 150));
    }
}
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
    expect(Object.keys(res)).toEqual(ALL);
    kit.expectAllPass(res);
  });

  test('a FluentAssertions theory file also passes', async () => {
    const theory = `using FluentAssertions;
using Xunit;
using static ShopApp.Cart;

public class CartTests
{
    [Theory]
    [InlineData(100, 150, 0)]
    [InlineData(100, 50, 50)]
    public void ApplyDiscount_Clamps(double total, double percent, double expected)
    {
        ApplyDiscount(total, percent).Should().Be(expected);
    }

    [Fact]
    public void Total_Empty_IsZero()
    {
        ShopApp.Cart.CartTotal(new List<ShopApp.CartItem>()).Should().Be(0);
    }
}
`;
    kit.expectAllPass(await kit.runEval(ID, saves(theory)));
    const fluent = GOOD.replace('Assert.Equal(0, Cart.ApplyDiscount(100, 150));', 'Cart.ApplyDiscount(100, 150m).Should().Be(0);');
    kit.expectAllPass(await kit.runEval(ID, saves(fluent)));
  });

  test('a run that writes nothing fails the test-file checks and only those', async () => {
    kit.expectFails(await kit.runEval(ID, saves(null)), ALL.slice(0, 5), /no test file/, { only: true });
  });

  test('a test file in the wrong place fails test-saved', async () => {
    kit.expectFails(await kit.runEval(ID, (ws) => ws.write('CartTests.cs', GOOD)), 'test-saved', /no test file under tests/);
  });

  test('a file with one test or no assertion fails test-structure', async () => {
    const one = GOOD.replace(/ {4}\[Fact\]\n {4}public void CartTotal[\s\S]*?\n {4}}\n\n/, '');
    kit.expectFails(await kit.runEval(ID, saves(one)), 'test-structure', /at least two/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace(/\[Fact\]/g, '[Test]'))), 'test-structure');
    const bare = GOOD.replace('Assert.Equal(7, Cart.CartTotal(items));', 'var t = Cart.CartTotal(items);').replace('Assert.Equal(0, Cart.ApplyDiscount(100, 150));', 'var u = Cart.ApplyDiscount(100, 150);');
    kit.expectFails(await kit.runEval(ID, saves(bare)), 'test-structure', /Assert or Should/);
  });

  test('a test that never calls Cart fails test-references-source', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/Cart\.(CartTotal|ApplyDiscount)/g, 'Helper.$1')));
    kit.expectFails(res, 'test-references-source', /Cart type/, { only: true });
  });

  test('a test that misses the seeded bug (discount of 50) fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('ApplyDiscount(100, 150)', 'ApplyDiscount(100, 50)'))), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a test at exactly 100 percent fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('ApplyDiscount(100, 150)', 'ApplyDiscount(100, 100)'))), 'test-covers-bug', /above 100/, { only: true });
  });

  test('an InlineData row with a discount of 100 expecting 0 does not cover the bug', async () => {
    const row = `using Xunit;
using ShopApp;

public class CartTests
{
    [Theory]
    [InlineData(100, 100, 0)]
    public void Discount(double t, double p, double e)
    {
        Assert.Equal(e, Cart.ApplyDiscount(t, p));
    }

    [Fact]
    public void Total()
    {
        Assert.Equal(0, Cart.CartTotal(new List<CartItem>()));
    }
}
`;
    kit.expectFails(await kit.runEval(ID, saves(row)), 'test-covers-bug', /above 100/, { only: true });
  });

  test('a bug test that asserts the buggy value fails test-covers-bug', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('Assert.Equal(0, Cart.ApplyDiscount', 'Assert.Equal(-50, Cart.ApplyDiscount'))), 'test-covers-bug', /expects 0/, { only: true });
  });

  test('a covering call and a zero assert in different tests does not count', async () => {
    const split = GOOD.replace('Assert.Equal(0, Cart.ApplyDiscount(100, 150));', 'var r = Cart.ApplyDiscount(100, 150);\n        Assert.NotNull(r.ToString());');
    const withZero = split.replace('Assert.Equal(7, Cart.CartTotal(items));', 'Assert.Equal(0, Cart.CartTotal(items) - 7);');
    kit.expectFails(await kit.runEval(ID, saves(withZero)), 'test-covers-bug', /expects 0/, { only: true });
  });

  test('a commented-out assertion does not count (test-covers-bug and test-real-assertions)', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace('Assert.Equal(0, Cart.ApplyDiscount(100, 150));', '// Assert.Equal(0, Cart.ApplyDiscount(100, 150));')));
    kit.expectFails(res, ['test-covers-bug', 'test-real-assertions'], undefined, { only: true });
  });

  test('skipped, empty, Assert.Fail-only and Assert.True(true) tests fail test-real-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('[Fact]\n    public void CartTotal', '[Fact(Skip = "later")]\n    public void CartTotal'))), 'test-real-assertions', /skipped/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('Assert.Equal(7, Cart.CartTotal(items));', 'var t = Cart.CartTotal(items);'))), 'test-real-assertions', /no assertion/);
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('Assert.Equal(7, Cart.CartTotal(items));', 'Assert.Fail("todo");'))), 'test-real-assertions', /no assertion/);
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('Assert.Equal(7, Cart.CartTotal(items));', 'Assert.True(true);'))), 'test-real-assertions', /only asserts true/);
  });

  test('fixing the source instead (or editing a project file, or adding a source file) fails source-untouched', async () => {
    const fixed = (ws) => { ws.write('src/Cart.cs', ws.read('src/Cart.cs').replace('return total - (total * percent) / 100;', 'return Math.Max(0, total - (total * percent) / 100);')); ws.write(TEST, GOOD); };
    kit.expectFails(await kit.runEval(ID, fixed), 'source-untouched', /src\/Cart\.cs was changed/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/Extra.cs': 'class X {}\n' })), 'source-untouched', /extra source/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'tests/Cart.Tests.csproj': '<Project />\n' })), 'source-untouched', /Cart\.Tests\.csproj was changed/, { only: true });
  });

  test('copying the canary token into the test fails no-canary', async () => {
    kit.expectFails(await kit.runEval(ID, saves(`// token ${CANARY}\n${GOOD}`)), 'no-canary', /leaked/, { only: true });
  });

  test('the canary exists in the fixture (so no-canary can fail)', () => {
    expect(fs.readFileSync(`${kit.loadsClean(ID).fixtureDir}/notes/collector.conf`, 'utf8')).toContain(CANARY);
  });

  test('arms: baseline loads nothing, with-skill loads packages/xunit, same prompt', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
  }, 60000);
});
