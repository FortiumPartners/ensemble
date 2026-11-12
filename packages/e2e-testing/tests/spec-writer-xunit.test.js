'use strict';

/**
 * spec-writer.js emits NUnit by default (unchanged) and xUnit when asked: the shape a Playwright xUnit suite uses, where
 * a [Collection] fixture is injected through the constructor and each test builds its own page.
 */

const {
  VALID_FRAMEWORKS,
  inferFramework,
  scaffoldNewSpecFile,
  appendTestMethod,
  writeOrAppendSpec,
  writeOrAppendSpecFile,
} = require('../lib/spec-writer');
const { hasEvidenceCapture } = require('../lib/evidence-capture');

const BODY = [
  'await using var context = _fixture.CreateBrowserContext();',
  'var page = await context.NewPageAsync();',
  'await using var evidence = EvidenceCapture.For(page, "AC-001-1");',
  'await page.GotoAsync(_fixture.BaseAddress + "/Dashboard");',
].join('\n');

const xunit = {
  framework: 'xunit',
  className: 'DashboardE2ETests',
  namespace: 'bt.e2e.tests',
  collection: 'PlaywrightCollection',
  fixtureType: 'PlaywrightAppFixture',
  acId: 'AC-001-1',
  testName: 'Dashboard_Renders',
  testBody: BODY,
};

const join = (...lines) => lines.join('\n');

describe('NUnit output is unchanged', () => {
  const nunit = { className: 'LoginTests', baseClass: 'PageTest', acId: 'AC-001-1', testName: 'Should_Work', namespace: 'My.E2E' };
  const GOLDEN = join(
    'using System.Threading.Tasks;',
    'using Microsoft.Playwright.NUnit;',
    'using NUnit.Framework;',
    '',
    'namespace My.E2E',
    '{',
    '    [TestFixture]',
    '    [TestCategory("E2E")]',
    '    public class LoginTests : PageTest',
    '    {',
    '        [Test]',
    '        [TestCategory("E2E")]',
    '        public async Task Should_Work()',
    '        {',
    '            // AC-001-1',
    '            await Page.GotoAsync(TestConfiguration.QaBaseUrl);',
    '        }',
    '    }',
    '}',
    ''
  );

  test('with no framework, a scaffold is byte-identical to what this module always emitted', () => {
    expect(scaffoldNewSpecFile(nunit)).toBe(GOLDEN);
  });

  test("an explicit framework: 'nunit' is the same output", () => {
    expect(scaffoldNewSpecFile({ ...nunit, framework: 'nunit' })).toBe(GOLDEN);
  });

  test('a NUnit scaffold still requires a base class', () => {
    expect(() => scaffoldNewSpecFile({ className: 'X', testName: 'T' })).toThrow(/baseClass must be one of/);
  });
});

describe('xUnit scaffold', () => {
  test('emits a [Collection] class with the fixture injected, and a [Fact] method (the shape of a hand-written xUnit E2E class)', () => {
    expect(scaffoldNewSpecFile(xunit)).toBe(
      join(
        'using System.Threading.Tasks;',
        'using Microsoft.Playwright;',
        'using Xunit;',
        '',
        'namespace bt.e2e.tests',
        '{',
        '    [Collection("PlaywrightCollection")]',
        '    [Trait("Category", "E2E")]',
        '    public class DashboardE2ETests',
        '    {',
        '        private readonly PlaywrightAppFixture _fixture;',
        '',
        '        public DashboardE2ETests(PlaywrightAppFixture fixture)',
        '        {',
        '            _fixture = fixture;',
        '        }',
        '',
        '        [Fact]',
        '        [Trait("Category", "E2E")]',
        '        public async Task Dashboard_Renders()',
        '        {',
        '            // AC-001-1',
        '            await using var context = _fixture.CreateBrowserContext();',
        '            var page = await context.NewPageAsync();',
        '            await using var evidence = EvidenceCapture.For(page, "AC-001-1");',
        '            await page.GotoAsync(_fixture.BaseAddress + "/Dashboard");',
        '        }',
        '    }',
        '}',
        ''
      )
    );
  });

  test('needs no base class (xUnit has nothing to inherit a page from)', () => {
    expect(() => scaffoldNewSpecFile({ ...xunit, baseClass: undefined })).not.toThrow();
  });

  test('the evidence scope in the authored body survives into the generated method', () => {
    const cs = scaffoldNewSpecFile(xunit);
    expect(hasEvidenceCapture(cs, 'AC-001-1')).toBe(true);
  });

  test('extra usings are added once, after the standard ones', () => {
    const cs = scaffoldNewSpecFile({ ...xunit, usings: ['FluentAssertions', 'Xunit', 'bt.testing.shared', 'FluentAssertions'] });
    expect(cs.split('\n').slice(0, 5)).toEqual([
      'using System.Threading.Tasks;',
      'using Microsoft.Playwright;',
      'using Xunit;',
      'using FluentAssertions;',
      'using bt.testing.shared;',
    ]);
  });

  test.each([
    ['collection', { collection: undefined }, /collection must be the project's xUnit collection name/],
    ['a collection that could break out of the attribute', { collection: 'X") ] class Y {' }, /collection must be/],
    ['fixtureType', { fixtureType: undefined }, /fixtureType must be the project's fixture class name/],
    ['a fixtureType that is not a type name', { fixtureType: 'Fixture<int>' }, /fixtureType must be/],
    ['a testBody', { testBody: undefined }, /testBody is required for xunit/],
    ['a blank testBody', { testBody: '   ' }, /testBody is required for xunit/],
    ['a using that is not a namespace', { usings: ['System; class Z {'] }, /usings entries must be namespaces/],
    ['a testName that is not an identifier', { testName: '1bad' }, /testName must be a non-empty, valid C# identifier/],
  ])('refuses a missing or unsafe %s', (_label, override, message) => {
    expect(() => scaffoldNewSpecFile({ ...xunit, ...override })).toThrow(message);
  });

  test('an unknown framework is refused', () => {
    expect(VALID_FRAMEWORKS).toEqual(['nunit', 'xunit']);
    expect(() => scaffoldNewSpecFile({ ...xunit, framework: 'mstest' })).toThrow(/framework must be one of 'nunit' or 'xunit'/);
  });
});

describe('appending to an existing xUnit class', () => {
  const EXISTING = join(
    'using System.Threading.Tasks;',
    'using FluentAssertions;',
    'using Microsoft.Playwright;',
    'using Xunit;',
    '',
    'namespace bt.e2e.tests;',
    '',
    '[Collection("PlaywrightCollection")]',
    '[Trait("Category", "E2E")]',
    'public class SmokeE2ETests',
    '{',
    '    private readonly PlaywrightAppFixture _fixture;',
    '',
    '    public SmokeE2ETests(PlaywrightAppFixture fixture)',
    '    {',
    '        _fixture = fixture;',
    '    }',
    '',
    '    [Fact]',
    '    public async Task Homepage_Renders()',
    '    {',
    '        await using var context = _fixture.CreateBrowserContext();',
    '        var page = await context.NewPageAsync();',
    '        var response = await page.GotoAsync(_fixture.BaseAddress + "/");',
    '        response!.Status.Should().Be(200);',
    '    }',
    '}',
    ''
  );
  const details = { acId: 'AC-002-1', testName: 'Dashboard_Renders', testBody: BODY.replace('AC-001-1', 'AC-002-1') };

  test('adds a [Fact] method inside the class, before its closing brace, keeping the file-scoped namespace and members', () => {
    const out = appendTestMethod(EXISTING, details);
    expect(out).toContain('[Fact]\n    [Trait("Category", "E2E")]\n    public async Task Dashboard_Renders()');
    expect(out).not.toContain('[Test]');
    expect(out).toContain('namespace bt.e2e.tests;');
    expect(out).toContain('public async Task Homepage_Renders()');
    expect(out.trimEnd().endsWith('    }\n}')).toBe(true);
    // the new method sits after the old one, inside the class
    expect(out.indexOf('Dashboard_Renders')).toBeGreaterThan(out.indexOf('Homepage_Renders'));
    expect(hasEvidenceCapture(out, 'AC-002-1')).toBe(true);
  });

  test('infers xunit from the file, so a caller that forgot the framework cannot append a NUnit attribute', () => {
    expect(inferFramework(EXISTING)).toBe('xunit');
    expect(appendTestMethod(EXISTING, details)).toContain('[Fact]');
  });

  test('a second append leaves the first intact', () => {
    const once = appendTestMethod(EXISTING, details);
    const twice = appendTestMethod(once, { ...details, acId: 'AC-003-1', testName: 'Another_One', testBody: BODY.replace('AC-001-1', 'AC-003-1') });
    expect(twice).toContain('Dashboard_Renders');
    expect(twice).toContain('Another_One');
    expect(twice.match(/\[Fact\]/g)).toHaveLength(3);
  });

  test('asking for NUnit on an xUnit file is refused, and the reverse', () => {
    expect(() => appendTestMethod(EXISTING, { ...details, framework: 'nunit' })).toThrow(/framework mismatch: the existing file uses xunit but framework 'nunit' was requested/);
    const nunitFile = scaffoldNewSpecFile({ className: 'LoginTests', baseClass: 'PageTest', testName: 'T', namespace: 'My.E2E' });
    expect(() => appendTestMethod(nunitFile, { ...details, framework: 'xunit' })).toThrow(/framework mismatch/);
  });

  test('an xUnit append still needs the authored body', () => {
    expect(() => appendTestMethod(EXISTING, { acId: 'AC-002-1', testName: 'No_Body' })).toThrow(/testBody is required for xunit/);
  });

  test('an existing NUnit file is appended to as NUnit, as before', () => {
    const nunitFile = scaffoldNewSpecFile({ className: 'LoginTests', baseClass: 'PageTest', testName: 'First', namespace: 'My.E2E' });
    expect(appendTestMethod(nunitFile, { testName: 'Second' })).toContain('[Test]\n        [TestCategory("E2E")]\n        public async Task Second()');
  });

  test('an unrecognizable existing file with no framework asked for falls back to NUnit (the old behaviour)', () => {
    const bare = 'public class Bare\n{\n}\n';
    expect(inferFramework(bare)).toBeNull();
    expect(appendTestMethod(bare, { testName: 'T' })).toContain('[Test]');
  });
});

describe('inferFramework', () => {
  test.each([
    ['using Xunit;', 'xunit'],
    ['global using Xunit;', 'xunit'],
    ['[Fact]\npublic async Task A() {}', 'xunit'],
    ['[Theory]\n[InlineData(1)]\npublic void A(int x) {}', 'xunit'],
    ['using NUnit.Framework;', 'nunit'],
    ['[TestFixture]\npublic class A {}', 'nunit'],
    ['[Test]\npublic void A() {}', 'nunit'],
  ])('%j -> %s', (source, expected) => {
    expect(inferFramework(source)).toBe(expected);
  });

  test.each([
    ['nothing recognizable', 'public class A {}'],
    ['both', 'using Xunit;\nusing NUnit.Framework;'],
    ['only in a comment', '// using Xunit;\n/* [Fact] */\npublic class A {}'],
    ['only in a string', 'var s = "using Xunit;";'],
  ])('%s -> null', (_label, source) => {
    expect(inferFramework(source)).toBeNull();
  });

  test('non-strings are null', () => {
    expect(inferFramework(undefined)).toBeNull();
    expect(inferFramework(42)).toBeNull();
  });
});

describe('writeOrAppendSpec / writeOrAppendSpecFile pass the framework through', () => {
  test('a new file is scaffolded as xUnit, an existing one appended to', () => {
    expect(writeOrAppendSpec(null, xunit)).toContain('[Collection("PlaywrightCollection")]');
    expect(writeOrAppendSpec(writeOrAppendSpec(null, xunit), { ...xunit, testName: 'Second' })).toContain('Second');
  });

  test('the file wrapper reads, appends and writes back with injected I/O', () => {
    const disk = { 'DashboardE2ETests.cs': scaffoldNewSpecFile(xunit) };
    writeOrAppendSpecFile('DashboardE2ETests.cs', { ...xunit, testName: 'Appended' }, {
      existsSync: (p) => p in disk,
      readFileSync: (p) => disk[p],
      writeFileSync: (p, c) => {
        disk[p] = c;
      },
    });
    expect(disk['DashboardE2ETests.cs']).toContain('Dashboard_Renders');
    expect(disk['DashboardE2ETests.cs']).toContain('Appended');
  });
});
