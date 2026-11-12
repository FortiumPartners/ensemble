'use strict';

/**
 * End-state screenshot evidence (lib/evidence-capture.js): the C# scope every authored test opens, the check that
 * a proposed test really opens it, and the user-configured command that attaches the screenshot to an ADO Test Case.
 */

const os = require('os');
const path = require('path');

const {
  EVIDENCE_DIR_ENV,
  ATTACH_CMD_ENV,
  evidenceFileName,
  resolveEvidenceDir,
  evidencePath,
  hasEvidenceCapture,
  renderEvidenceHelper,
  resolveAttachCommand,
  buildAttachCommand,
} = require('../lib/evidence-capture');

describe('evidenceFileName', () => {
  test('an AC id becomes <id>.png', () => {
    expect(evidenceFileName('AC-001-1')).toBe('AC-001-1.png');
  });

  test('nothing outside [A-Za-z0-9_-] survives, so an id can never name a path', () => {
    const name = evidenceFileName('AC 001/../..\\x');
    expect(name).toMatch(/^[A-Za-z0-9_-]+\.png$/);
    expect(name).not.toMatch(/[\\/]|\.\./);
  });

  test.each([undefined, null, '', '   ', 7])('rejects %p', (bad) => {
    expect(() => evidenceFileName(bad)).toThrow(/acId must be a non-empty string/);
  });
});

describe('resolveEvidenceDir / evidencePath', () => {
  test('E2E_EVIDENCE_DIR wins and is made absolute', () => {
    expect(resolveEvidenceDir({ [EVIDENCE_DIR_ENV]: 'out/evidence' })).toBe(path.resolve('out/evidence'));
  });

  test.each([{}, { [EVIDENCE_DIR_ENV]: '' }, { [EVIDENCE_DIR_ENV]: '   ' }])('defaults to <temp>/e2e-evidence for %p', (env) => {
    expect(resolveEvidenceDir(env, '/scratch')).toBe(path.resolve(path.join('/scratch', 'e2e-evidence')));
  });

  test('evidencePath joins the dir and the AC file name', () => {
    const dir = path.join(os.tmpdir(), 'ev');
    expect(evidencePath(dir, 'AC-002-3')).toBe(path.join(path.resolve(dir), 'AC-002-3.png'));
  });
});

describe('hasEvidenceCapture', () => {
  const scoped = (line) => `var ctx = _fixture.CreateBrowserContext();\n${line}\nawait page.GotoAsync(url);`;

  test.each([
    'await using var evidence = EvidenceCapture.For(page, "AC-001-1");',
    'await   using   var   e = EvidenceCapture . For ( page , "AC-001-1" );',
    'await using (EvidenceCapture.For(Page, "AC-001-1"))\n{\n}',
    'await using (var e = EvidenceCapture.For(Page, "AC-001-1")) { }',
  ])('accepts a real await-using scope: %s', (line) => {
    expect(hasEvidenceCapture(scoped(line))).toBe(true);
    expect(hasEvidenceCapture(scoped(line), 'AC-001-1')).toBe(true);
  });

  test.each([
    ['a plain call that is never disposed', 'var e = EvidenceCapture.For(page, "AC-001-1");'],
    ['a non-async using', 'using var e = EvidenceCapture.For(page, "AC-001-1");'],
    ['a commented-out scope', '// await using var e = EvidenceCapture.For(page, "AC-001-1");'],
    ['a block-commented scope', '/* await using var e = EvidenceCapture.For(page, "AC-001-1"); */'],
    ['a scope that only appears in a string', 'var s = "await using var e = EvidenceCapture.For(page, \\"AC-001-1\\");";'],
    ['a different type', 'await using var e = Evidence.For(page, "AC-001-1");'],
  ])('rejects %s', (_label, line) => {
    expect(hasEvidenceCapture(scoped(line))).toBe(false);
  });

  test('with an acId, the scope must pass exactly that id (so the file the Run stage looks for is the one written)', () => {
    const src = scoped('await using var evidence = EvidenceCapture.For(page, "AC-009-9");');
    expect(hasEvidenceCapture(src, 'AC-009-9')).toBe(true);
    expect(hasEvidenceCapture(src, 'AC-001-1')).toBe(false);
  });

  test('non-strings are not a scope', () => {
    expect(hasEvidenceCapture(undefined)).toBe(false);
    expect(hasEvidenceCapture(null)).toBe(false);
  });

  test('MUTATION PROOF: removing `await` from a valid scope flips the verdict', () => {
    const valid = scoped('await using var evidence = EvidenceCapture.For(page, "AC-001-1");');
    expect(hasEvidenceCapture(valid)).toBe(true);
    expect(hasEvidenceCapture(valid.replace('await using', 'using'))).toBe(false);
    expect(hasEvidenceCapture(valid.replace('EvidenceCapture', 'Other'))).toBe(false);
  });
});

describe('renderEvidenceHelper', () => {
  const cs = renderEvidenceHelper();

  test('is an async-disposable that takes a full-page screenshot of the page it was given', () => {
    expect(cs).toContain('public sealed class EvidenceCapture : IAsyncDisposable');
    expect(cs).toContain('public static EvidenceCapture For(IPage page, string acId)');
    expect(cs).toContain('public async ValueTask DisposeAsync()');
    expect(cs).toContain('_page.ScreenshotAsync(new PageScreenshotOptions { Path = _path, FullPage = true })');
  });

  test('uses the same env var and file-name rule as the JS side', () => {
    expect(cs).toContain(`Environment.GetEnvironmentVariable("${EVIDENCE_DIR_ENV}")`);
    expect(cs).toContain('"[^A-Za-z0-9_-]", "-") + ".png"');
    expect(cs).toContain('Path.Combine(Path.GetTempPath(), "e2e-evidence")');
  });

  test('a screenshot failure warns on stderr and never throws over the test\'s own failure', () => {
    const dispose = cs.slice(cs.indexOf('DisposeAsync'));
    expect(dispose).toContain('catch (Exception ex)');
    expect(dispose).toContain('Console.Error.WriteLine');
    expect(dispose).not.toMatch(/\bthrow\b/);
  });

  test('ties to no test framework, so one file serves NUnit and xUnit projects', () => {
    expect(cs).not.toMatch(/NUnit|Xunit|\[Test\]|\[Fact\]|\[TearDown\]|PageTest/);
  });

  test('default and custom namespace, and balanced braces', () => {
    expect(cs).toContain('namespace Application.E2E.Tests');
    expect(renderEvidenceHelper({ namespace: 'bt.e2e.tests' })).toContain('namespace bt.e2e.tests');
    expect(renderEvidenceHelper({ namespace: '  ' })).toContain('namespace Application.E2E.Tests');
    expect(cs.split('{').length).toBe(cs.split('}').length);
  });

  test('the scope the helper defines is the one hasEvidenceCapture recognizes', () => {
    const example = cs.match(/Use: <c>(.*?)<\/c>/)[1];
    expect(hasEvidenceCapture(example, 'AC-001-1')).toBe(true);
  });
});

describe('resolveAttachCommand', () => {
  test('unset: no capability, and the reason names the gap (AC-015-2) rather than improvising one', () => {
    const r = resolveAttachCommand({});
    expect(r.method).toBe('none');
    expect(r.reason).toMatch(/ADO MCP cannot upload/);
    expect(r.reason).toContain(ATTACH_CMD_ENV);
  });

  test('a template missing a placeholder is refused, not half-used', () => {
    expect(resolveAttachCommand({ [ATTACH_CMD_ENV]: 'attach.ps1 -WorkItemId {workItemId}' }).method).toBe('none');
    expect(resolveAttachCommand({ [ATTACH_CMD_ENV]: 'attach.ps1 -Path {path}' }).reason).toMatch(/both \{workItemId\} and \{path\}/);
  });

  test('a complete template is returned trimmed', () => {
    const t = 'pwsh tools/Add-AdoAttachment.ps1 -WorkItemId {workItemId} -Path {path} -ReplaceSameName';
    expect(resolveAttachCommand({ [ATTACH_CMD_ENV]: `  ${t}  ` })).toEqual({ method: 'command', template: t });
  });
});

describe('buildAttachCommand', () => {
  const template = 'pwsh Add-AdoAttachment.ps1 -WorkItemId {workItemId} -Path {path}';

  test('fills both placeholders, quoting the path', () => {
    expect(buildAttachCommand(template, { workItemId: 53440, path: 'C:\\Temp\\e2e-evidence\\AC-001-1.png' })).toBe(
      'pwsh Add-AdoAttachment.ps1 -WorkItemId 53440 -Path "C:\\Temp\\e2e-evidence\\AC-001-1.png"'
    );
  });

  test('accepts a digit string and a path with spaces and short-name tildes', () => {
    expect(buildAttachCommand(template, { workItemId: '7', path: '/c/Users/MIKEDE~1/My Evidence/AC-1.png' })).toContain('-WorkItemId 7');
  });

  test.each(['1; rm -rf /', '12abc', '-1', '1.5', '', undefined, null, '1 2', '$(id)'])('refuses workItemId %p', (bad) => {
    expect(() => buildAttachCommand(template, { workItemId: bad, path: '/tmp/a.png' })).toThrow(/workItemId must be digits only/);
  });

  test.each(['/tmp/a".png', '/tmp/$(whoami).png', '/tmp/`id`.png', '/tmp/a;b.png', '/tmp/a&b.png', '/tmp/a|b.png', '/tmp/%PATH%.png', '/tmp/a\nb.png', '/tmp/{path}.png', '', undefined])(
    'refuses a path a shell could act on: %p',
    (bad) => {
      expect(() => buildAttachCommand(template, { workItemId: 1, path: bad })).toThrow(/path may only contain/);
    }
  );

  test('a template without both placeholders throws', () => {
    expect(() => buildAttachCommand('attach {path}', { workItemId: 1, path: '/tmp/a.png' })).toThrow(/both \{workItemId\} and \{path\}/);
  });

  test('a value is never re-expanded as a placeholder', () => {
    const out = buildAttachCommand('a {workItemId} b {path}', { workItemId: 5, path: '/tmp/x.png' });
    expect(out).toBe('a 5 b "/tmp/x.png"');
  });
});
