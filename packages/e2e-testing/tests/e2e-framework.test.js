'use strict';

/**
 * Detecting which C# test framework the consuming E2E project uses (lib/e2e-framework.js), so spec-writer emits the
 * attributes that project's runner understands.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectE2eFramework, detectE2eFrameworkInDir } = require('../lib/e2e-framework');
const { validateProposalRequest } = require('../lib/delegation-contract');

const csproj = (...packages) =>
  `<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n${packages.map((p) => `    <PackageReference Include="${p}" Version="1.0.0" />`).join('\n')}\n  </ItemGroup>\n</Project>\n`;

describe('detectE2eFramework', () => {
  test('xUnit on core Microsoft.Playwright (the BT3 shape) is xunit', () => {
    expect(
      detectE2eFramework(csproj('Microsoft.NET.Test.Sdk', 'xunit', 'xunit.runner.visualstudio', 'FluentAssertions', 'Microsoft.Playwright'))
    ).toBe('xunit');
  });

  test('NUnit with the Playwright NUnit bindings is nunit', () => {
    expect(detectE2eFramework(csproj('NUnit', 'NUnit3TestAdapter', 'Microsoft.Playwright.NUnit'))).toBe('nunit');
    expect(detectE2eFramework(csproj('Microsoft.Playwright.NUnit'))).toBe('nunit');
  });

  test.each([['xunit.v3'], ['Microsoft.Playwright.Xunit'], ['XUnit']])('%s counts as xunit', (name) => {
    expect(detectE2eFramework(csproj(name))).toBe('xunit');
  });

  test('neither (e.g. MSTest), or both, is not guessed: null', () => {
    expect(detectE2eFramework(csproj('MSTest.TestFramework', 'Microsoft.Playwright'))).toBeNull();
    expect(detectE2eFramework(csproj('xunit', 'NUnit'))).toBeNull();
    expect(detectE2eFramework('')).toBeNull();
  });

  test('attribute order does not matter, and a commented-out reference does not count', () => {
    expect(detectE2eFramework('<PackageReference Version="2.9.3" Include="xunit" />')).toBe('xunit');
    expect(detectE2eFramework('<!-- <PackageReference Include="NUnit" /> -->\n<PackageReference Include="xunit" />')).toBe('xunit');
    expect(detectE2eFramework('<!--\n<PackageReference Include="xunit" />\n-->')).toBeNull();
  });

  test('comments are cut out whole: several in a row, one touching a reference, an unterminated opener left alone', () => {
    expect(detectE2eFramework('<!-- a --><PackageReference Include="xunit" /><!-- <PackageReference Include="NUnit" /> -->')).toBe('xunit');
    expect(detectE2eFramework('<!----><PackageReference Include="NUnit" />')).toBe('nunit');
    // an opener that never closes hides nothing: the regex this replaced left it too
    expect(detectE2eFramework('<!-- <PackageReference Include="xunit" />')).toBe('xunit');
    // the pieces around a removed comment are not re-read as a new comment
    expect(detectE2eFramework('<!<!-- x -->-- <PackageReference Include="xunit" />')).toBe('xunit');
  });

  test('several project files are read together; a mix is ambiguous', () => {
    expect(detectE2eFramework([csproj('Microsoft.Playwright'), csproj('xunit')])).toBe('xunit');
    expect(detectE2eFramework([csproj('NUnit'), csproj('xunit')])).toBeNull();
  });

  test('non-strings are ignored', () => {
    expect(detectE2eFramework(undefined)).toBeNull();
    expect(detectE2eFramework([null, csproj('NUnit')])).toBe('nunit');
  });
});

describe('detectE2eFrameworkInDir', () => {
  const roots = [];
  const project = (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-framework-'));
    roots.push(root);
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
  };
  afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

  test('finds the framework from a nested .csproj', () => {
    expect(detectE2eFrameworkInDir(project({ 'tests/App.E2E/App.E2E.csproj': csproj('xunit', 'Microsoft.Playwright') }))).toBe('xunit');
  });

  test('ignores bin, obj and node_modules, where a stray project file must not decide', () => {
    const root = project({
      'tests/App.E2E.csproj': csproj('xunit'),
      'tests/obj/Restore.csproj': csproj('NUnit'),
      'tests/bin/Other.csproj': csproj('NUnit'),
      'node_modules/pkg/x.csproj': csproj('NUnit'),
    });
    expect(detectE2eFrameworkInDir(root)).toBe('xunit');
  });

  test('a directory with no project file is null', () => {
    expect(detectE2eFrameworkInDir(project({ 'README.md': 'x' }))).toBeNull();
  });
});

describe('validateProposalRequest framework', () => {
  const base = { acText: 'Given X when Y then Z', groundingDiff: { grounded: true } };

  test.each([undefined, 'nunit', 'xunit'])('accepts %p', (framework) => {
    expect(validateProposalRequest({ ...base, framework })).toBe(true);
  });

  test.each(['mstest', 'XUNIT', '', 5, null])('rejects %p', (framework) => {
    expect(() => validateProposalRequest({ ...base, framework })).toThrow(/framework must be 'nunit' or 'xunit'/);
  });
});
