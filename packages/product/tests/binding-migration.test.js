'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parsePRD } = require('../lib/prd-parser');
const {
  literalStepExpression, collectSteps, renderStepClass, scanBindingAttributes,
  rewriteBindingExpressions, diffBindingDrift, writeBindingArtifacts, writeFileAtomic,
} = require('../lib/reqnroll-gen');
const { runMigrate } = require('../lib/reqnroll-cli');

const markdown = '### REQ-001: Literal steps\n'
  + '- AC-001-1: Given a paused/canceled plan, when a URL/token is read, then the (private) value remains literal.\n';
const prd = parsePRD(markdown);
const temporaryDirectories = [];
const cli = path.join(__dirname, '../lib/reqnroll-cli.js');
function fixture() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'binding-migration-'));
  temporaryDirectories.push(directory);
  const prdPath = path.join(directory, 'PRD-literals.md');
  fs.writeFileSync(prdPath, markdown);
  const steps = path.join(directory, 'custom-steps');
  fs.mkdirSync(steps);
  return { directory, prdPath, steps };
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const literalCases = [
  ['a paused/canceled plan', ['a paused plan', 'a canceled plan']],
  ['a URL/token is read', ['a URL is read', 'a token is read']],
  ['the (private) value remains literal', ['the private value remains literal', 'the  value remains literal']],
  ['a {string} token', ['a "secret" token']],
  ['literal .+*? [x] {2} (a|b) ^$ \\ path', ['literal x [x] {2} a ^$ \\ path']],
  ['a "quoted" value', ['a quoted value']],
];

describe('literal binding behavior', () => {
  test.each(literalCases)('matches only the complete literal clause: %s', (text, alternatives) => {
    const expression = new RegExp(literalStepExpression(text));
    expect(expression.test(text)).toBe(true);
    for (const other of [...alternatives, `prefix ${text}`, `${text} suffix`])
      expect(expression.test(other)).toBe(false);
  });

  test('generated expressions retain logical drift identities and fingerprints', () => {
    const steps = collectSteps(prd);
    const source = renderStepClass(prd.reqs[0], steps);
    expect(scanBindingAttributes(source).map(({ text }) => text)).toEqual([
      'a paused/canceled plan', 'a URL/token is read', 'the (private) value remains literal',
    ]);
    expect(diffBindingDrift(prd, [source])).toEqual({ inSync: true, unbound: [], orphaned: [] });
    const changed = parsePRD(markdown.replace('a URL/token is read', 'another URL/token is read'));
    const drift = diffBindingDrift(changed, [source]);
    expect(drift.unbound.map(({ text }) => text)).toEqual(['another URL/token is read']);
    expect(drift.orphaned.map(({ text }) => text)).toEqual(['a URL/token is read']);
  });
});

describe('body-preserving expression migration', () => {
  test('ignores comments, character literals, and ordinary/verbatim/raw/interpolated strings', () => {
    const attribute = '[Given(@"a paused/canceled plan")]';
    const source = [
      `// ${attribute}`,
      `/* ${attribute} */`,
      'public partial class REQ001Steps {',
      `    ${attribute}`,
      '    [Obsolete]',
      '    public void GivenPlan() {',
      '        var character = \'"\';',
      '        var ordinary = "[Given(@\\"a paused/canceled plan\\")]";',
      '        var verbatim = @"[Given(@""a paused/canceled plan"")]";',
      `        var raw = """${attribute}""";`,
      `        var interpolated = $"{Wrap("""${attribute}""")}";`,
      `        var rawInterpolated = $$"""{{Wrap("""${attribute}""")}}""";`,
      `        var collection = ${attribute};`,
      '        ExecuteRealCommand();',
      '    }',
      '}',
    ].join('\r\n');
    const expected = source.replace(`    ${attribute}\r\n`,
      '    [Given(@"^a paused/canceled plan$")]\r\n');
    const result = rewriteBindingExpressions(prd, source);
    expect(result.content).toBe(expected);
    expect(result.changes).toEqual([{ keyword: 'Given', text: 'a paused/canceled plan' }]);
    expect(scanBindingAttributes(result.content)).toEqual([
      { keyword: 'Given', text: 'a paused/canceled plan' },
    ]);
    expect(rewriteBindingExpressions(prd, result.content)).toEqual({ content: expected, changes: [] });
  });

  test('preserves unrecognized custom attributes rather than assigning new semantics', () => {
    const source = '[Given(@"custom (.*)")] public void Custom(string input) { Use(input); }';
    expect(rewriteBindingExpressions(prd, source)).toEqual({ content: source, changes: [] });
  });

  test('ignores preprocessor directives containing an apostrophe', () => {
    const source = "#region Don't touch\n[Given(@\"a paused/canceled plan\")] public void G() { }\n#endregion\n";
    expect(scanBindingAttributes(source).map(({ text }) => text)).toEqual(['a paused/canceled plan']);
    expect(rewriteBindingExpressions(prd, source).content)
      .toBe(source.replace('a paused/canceled plan', literalStepExpression('a paused/canceled plan')));
  });

  test.each([
    ['modifier-less void', 'void G() { }'],
    ['modifier-less int return', 'int G() { return 1; }'],
    ['modifier-less string return', 'string G() { return ""; }'],
    ['public int return', 'public int G() { return 1; }'],
    ['generic return', 'List<Dictionary<string, int>> G() { return null; }'],
    ['qualified generic return', 'System.Collections.Generic.List<string> G() { return null; }'],
    ['array return', 'string[] G() { return null; }'],
    ['multi-dimensional array return', 'int[,] G() { return null; }'],
    ['nullable return', 'int? G() { return null; }'],
    ['tuple return', '(int a, string b) G() { return default; }'],
    ['modified tuple return', 'public static (int, string) G() { return default; }'],
    ['generic method with constraint', 'T G<T>(T value) where T : class { return value; }'],
    ['expression-bodied', 'string G() => "";'],
    ['comment between attribute and declaration', '/* note */ int G() { return 1; }'],
    ['other attribute in between', '[Obsolete] string G() { return ""; }'],
  ])('detects a binding declared with %s', (_name, declaration) => {
    const source = `[Given(@"a paused/canceled plan")] ${declaration}`;
    expect(scanBindingAttributes(source)).toEqual([{ keyword: 'Given', text: 'a paused/canceled plan' }]);
    expect(diffBindingDrift(prd, [source]).unbound.map(({ text }) => text))
      .not.toContain('a paused/canceled plan');
    expect(rewriteBindingExpressions(prd, source).changes)
      .toEqual([{ keyword: 'Given', text: 'a paused/canceled plan' }]);
  });

  test.each([
    ['collection return', 'return [Given(@"a paused/canceled plan")];'],
    ['collection assignment', 'var x = [Given(@"a paused/canceled plan")];'],
    ['collection argument', 'Use([Given(@"a paused/canceled plan")], 1);'],
    ['collection element', 'var x = [[Given(@"a paused/canceled plan")], 2];'],
    ['lambda attribute', 'Action a = [Given(@"a paused/canceled plan")] () => { };'],
    ['dangling attribute before block', '{ [Given(@"a paused/canceled plan")] }'],
    ['field-like statement', '[Given(@"a paused/canceled plan")] int value = Compute();'],
  ])('still refuses an attribute-shaped expression that is not a declaration: %s', (_name, statement) => {
    const source = `class C { void M() { ${statement} } }`;
    expect(scanBindingAttributes(source)).toEqual([]);
    expect(rewriteBindingExpressions(prd, source)).toEqual({ content: source, changes: [] });
  });

  test('refuses ambiguous old/current expressions without guessing the intended clause', () => {
    const ambiguous = parsePRD('### REQ-001: Ambiguous\n'
      + '- AC-001-1: Given x, when ^x$, then done.\n');
    expect(() => rewriteBindingExpressions(ambiguous, '[Given(@"^x$")] public void G() {}'))
      .toThrow('Ambiguous legacy/current');
  });

  test('normal regeneration upgrades expressions without overwriting a filled method', () => {
    const { directory } = fixture();
    const generated = writeBindingArtifacts(prd, 'PRD-literals', directory);
    const file = path.join(generated.outDir, 'Steps/REQ-001.Steps.cs');
    const original = '[Given(@"a paused/canceled plan")] public async Task G() { await RealCommand(); }';
    fs.writeFileSync(file, original);
    writeBindingArtifacts(prd, 'PRD-literals', directory);
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '[Given(@"^a paused/canceled plan$")] public async Task G() { await RealCommand(); }');
  });
});

describe('migrate-bindings CLI', () => {
  test('previews and migrates split/nested files without changing bodies, then is idempotent', () => {
    const { prdPath, steps } = fixture();
    const nested = path.join(steps, 'partial');
    fs.mkdirSync(nested);
    const first = path.join(steps, 'Given.cs');
    const second = path.join(nested, 'When.cs');
    const beforeFirst = '\ufeff[Given(@"a paused/canceled plan")]\r\npublic void G() { RealCommand(); }\r\n';
    const beforeSecond = '[When(@"a URL/token is read")] public void W() { ReadProtected(); }\n';
    fs.writeFileSync(first, beforeFirst, { mode: 0o600 });
    fs.writeFileSync(second, beforeSecond);
    const preview = runMigrate([prdPath, '--steps-dir', steps, '--dry-run']);
    expect(preview.changed.map(({ steps: count }) => count)).toEqual([1, 1]);
    expect(fs.readFileSync(first, 'utf8')).toBe(beforeFirst);
    expect(fs.readFileSync(second, 'utf8')).toBe(beforeSecond);
    const result = JSON.parse(execFileSync(process.execPath,
      [cli, 'migrate-bindings', prdPath, '--steps-dir', steps, '--json'], { encoding: 'utf8' }));
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(first, 'utf8')).toBe(beforeFirst.replace('a paused/canceled plan', '^a paused/canceled plan$'));
    expect(fs.readFileSync(second, 'utf8')).toBe(beforeSecond.replace('a URL/token is read', '^a URL/token is read$'));
    if (process.platform !== 'win32') expect(fs.statSync(first).mode & 0o777).toBe(0o600);
    expect(runMigrate([prdPath, '--steps-dir', steps]).changed).toEqual([]);
  });

  test('preflights all sources before writing when a later file has an unterminated literal', () => {
    const { prdPath, steps } = fixture();
    const first = path.join(steps, 'A.cs');
    const broken = path.join(steps, 'Z.cs');
    const original = '[Given(@"a paused/canceled plan")] public void G() {}';
    fs.writeFileSync(first, original);
    fs.writeFileSync(broken, 'class Broken { string value = "unterminated; }');
    expect(() => runMigrate([prdPath, '--steps-dir', steps])).toThrow('Unterminated C# literal');
    expect(fs.readFileSync(first, 'utf8')).toBe(original);
  });

  test('rejects non-UTF-8 input without replacing any original bytes', () => {
    const { prdPath, steps } = fixture();
    const file = path.join(steps, 'Legacy.cs');
    const original = Buffer.concat([
      Buffer.from('[Given(@"a paused/canceled plan")] public void G() { /*'),
      Buffer.from([0xff]), Buffer.from('*/ }'),
    ]);
    fs.writeFileSync(file, original);
    expect(() => runMigrate([prdPath, '--steps-dir', steps])).toThrow(
      expect.objectContaining({ code: 'ERR_ENCODING_INVALID_ENCODED_DATA' }));
    expect(fs.readFileSync(file)).toEqual(original);
  });

  test('a concurrent user edit is never overwritten and leaves no temporary output', () => {
    const { steps } = fixture();
    const file = path.join(steps, 'Changed.cs');
    const original = Buffer.from('the source originally read');
    const changed = 'a newer user edit';
    fs.writeFileSync(file, changed);
    expect(() => writeFileAtomic(file, 'migration output', 0o600, original))
      .toThrow('Binding source changed during migration');
    expect(fs.readFileSync(file, 'utf8')).toBe(changed);
    expect(fs.readdirSync(steps)).toEqual(['Changed.cs']);
  });

  test.each(['root', 'ancestor'])('refuses a symlink at the binding-directory %s', (location) => {
    const { directory, prdPath, steps } = fixture();
    const target = path.join(steps, 'Original.cs');
    const original = '[Given(@"a paused/canceled plan")] public void G() {}';
    fs.writeFileSync(target, original);
    const alias = path.join(directory, 'alias');
    fs.symlinkSync(location === 'root' ? steps : directory, alias, 'dir');
    const requested = location === 'root' ? alias : path.join(alias, 'custom-steps');
    expect(() => runMigrate([prdPath, '--steps-dir', requested])).toThrow('Refusing a symlink');
    expect(fs.readFileSync(target, 'utf8')).toBe(original);
  });

  test('refuses symlink traversal and never changes the linked source', () => {
    const { directory, prdPath, steps } = fixture();
    const target = path.join(directory, 'outside.cs');
    const original = '[Given(@"a paused/canceled plan")] public void G() {}';
    fs.writeFileSync(target, original);
    fs.symlinkSync(target, path.join(steps, 'linked.cs'));
    expect(() => runMigrate([prdPath, '--steps-dir', steps])).toThrow('Refusing a symlink');
    expect(fs.readFileSync(target, 'utf8')).toBe(original);
  });
});
