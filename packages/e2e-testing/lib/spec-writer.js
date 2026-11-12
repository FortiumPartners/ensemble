'use strict';

/**
 * TRD-014: test placement into the consuming application's existing E2E test
 * project for /ensemble:author-playwright-tests (REQ-006).
 *
 * *** TRD DOCUMENTATION DISCREPANCY (flagging for a later TRD fix) ***
 * The TRD's own System Architecture diagram (line 62) describes this module
 * as writing to `**\/*.spec.ts` -- implying TypeScript. But this task's own
 * Implementation AC (and the PRD's AC-006-1, verbatim) requires
 * `[TestCategory("E2E")]` (a C# NUnit/MSTest bracket attribute -- this syntax
 * does not exist in TypeScript, which uses decorators or object-literal tags
 * instead) and `AuthenticatedPageTest`/`PageTest` base classes (Microsoft
 * .Playwright.NUnit/.MSTest .NET SDK class names). A `.spec.ts` file cannot
 * contain `[TestCategory("E2E")]` attribute syntax -- the two descriptions are
 * flatly incompatible.
 *
 * Resolution: the AC text's concrete C# attribute/class syntax is unambiguous
 * and is followed exactly as written here. The consuming application's E2E
 * test project is treated as a C# NUnit-style test project (Microsoft
 * .Playwright's .NET bindings), and this module generates/appends `.cs` file
 * content, not `.spec.ts`. The diagram's "**\/*.spec.ts" line appears to be an
 * error/copy-paste artifact from a TypeScript-flavored Playwright convention
 * and should be corrected in a TRD documentation fix.
 *
 * Related, not fixed here: resume-scan.js (TRD-005, already shipped) also
 * documents itself in terms of `.spec.ts` files and assumes that file
 * extension in its own header comments/examples. Its actual tag-matching
 * regexes (AC_ID_RE, HASH_TAG_RE) only look at `//`-comment lines and don't
 * care what extension the file has, so they still work unchanged against
 * `.cs` files -- but its doc comments and any future glob pattern built on top
 * of it should be corrected alongside the architecture diagram, not silently
 * left implying TypeScript.
 *
 * Framework: NUnit (above) is the default and its output is unchanged. `specDetails.framework: 'xunit'` emits
 * `[Fact]`/`[Trait("Category", ...)]` instead, for projects (e.g. xUnit on core Microsoft.Playwright) where each test
 * builds its own page from a `[Collection]` fixture. e2e-framework.js detects which one a project uses. A new xUnit
 * file needs the project's own `collection` and `fixtureType` (and a `testBody`: there is no safe default body);
 * appending to an existing file infers the framework from the file and refuses a mismatch.
 *
 * Scope (Implementation AC for TRD-014):
 *   - AC-006-1: a new file uses AuthenticatedPageTest or PageTest (caller's
 *     choice -- this module does not guess from AC text), carries
 *     [TestCategory("E2E")], and references TestConfiguration.* for URLs/IDs
 *     rather than a hardcoded literal.
 *   - AC-006-2: an AC for a REQ already covered by an existing spec file is
 *     appended to that file, not a redundant new one. This module only
 *     performs the append once the caller has decided *which* file that is
 *     (a later task's job, per the TRD) -- it just does the append correctly
 *     and safely, without corrupting the rest of the file.
 *
 * Out of scope here (later TRD-015 traceability-tagger.js's job): the
 * `@AC-NNN-M @hash:` traceability tag. This module only leaves a plain
 * `// {acId}` comment above the generated method as an anchor line -- it does
 * not add or manage `@hash:`/`@ado-testcase:` tags itself.
 *
 * Convention: plain functions over plain strings/data (no C# AST/class
 * hierarchy) matching this package's existing modules (resume-scan.js,
 * ac-decision-loop.js, req-batcher.js). No disk I/O in the core logic --
 * `writeOrAppendSpecFile` is a thin, injectable fs wrapper on top, matching
 * resume-scan.js's `scanConfirmedAcsInFiles` precedent.
 */

const fs = require('fs');

const VALID_BASE_CLASSES = ['AuthenticatedPageTest', 'PageTest'];
const VALID_FRAMEWORKS = ['nunit', 'xunit'];
const TEST_CATEGORY = 'E2E';
const DEFAULT_NAMESPACE = 'Application.E2E.Tests';
const DEFAULT_TEST_BODY = 'await Page.GotoAsync(TestConfiguration.QaBaseUrl);';
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOTTED_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const COLLECTION_NAME_RE = /^[A-Za-z0-9_. -]+$/;

/** Throw a clear error if `value` isn't a valid, non-empty C# identifier. */
function assertIdentifier(label, value) {
  if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
    throw new Error(`${label} must be a non-empty, valid C# identifier (got: ${JSON.stringify(value)})`);
  }
}

/** Throw a clear error if `baseClass` isn't one of the two AC-006-1 names. */
function assertBaseClass(baseClass) {
  if (!VALID_BASE_CLASSES.includes(baseClass)) {
    throw new Error(
      `baseClass must be one of ${VALID_BASE_CLASSES.map((b) => `'${b}'`).join(' or ')} (got: ${JSON.stringify(baseClass)}) -- ` +
        'this module never guesses; the caller decides based on whether the AC needs an authenticated session.'
    );
  }
}

/** 'nunit' when the caller gave no framework (the shape this module has always emitted); otherwise the validated choice. */
function resolveFramework(specDetails) {
  const framework = specDetails && specDetails.framework;
  if (framework === undefined) return 'nunit';
  if (!VALID_FRAMEWORKS.includes(framework)) {
    throw new Error(`framework must be one of ${VALID_FRAMEWORKS.map((f) => `'${f}'`).join(' or ')} (got: ${JSON.stringify(framework)})`);
  }
  return framework;
}

/**
 * Which framework does this existing spec file already use? 'xunit' / 'nunit' from its usings or attributes
 * (comments and string literals ignored), or null when it shows neither or both.
 */
function inferFramework(source) {
  if (typeof source !== 'string') return null;
  const masked = maskLiteralsAndComments(source);
  const xunit = /^[ \t]*(?:global\s+)?using\s+Xunit\s*;/m.test(masked) || /\[\s*(?:Fact|Theory)\s*[\](]/.test(masked);
  const nunit = /^[ \t]*(?:global\s+)?using\s+NUnit\.Framework\s*;/m.test(masked) || /\[\s*(?:Test|TestFixture)\s*[\](]/.test(masked);
  if (xunit === nunit) return null;
  return xunit ? 'xunit' : 'nunit';
}

/**
 * Indent every non-blank line of `text` by `indent`. Blank lines stay blank
 * (no trailing whitespace introduced).
 */
function indentBlock(text, indent) {
  return String(text)
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trim() === '' ? '' : indent + line))
    .join('\n');
}

/**
 * Render one `[Test]` method block (attributes + signature + body), indented
 * so its own lines start at `indent`. Shared by both scaffoldNewSpecFile and
 * appendTestMethod so a scaffolded file and an appended method are always
 * byte-identical in shape for the same inputs.
 *
 * @param {{acId?: string, testName: string, testBody?: string, testCategory?: string}} specDetails
 * @param {string} indent - whitespace the method's own lines (attributes,
 *   signature, closing brace) are indented with; the body is one level deeper.
 * @returns {string} the rendered method block, ending in a newline
 */
function renderTestMethodBlock(specDetails, indent) {
  const { acId, testName, testBody, testCategory } = specDetails || {};
  const framework = resolveFramework(specDetails);
  assertIdentifier('testName', testName);

  const category =
    typeof testCategory === 'string' && testCategory.trim() !== '' ? testCategory.trim() : TEST_CATEGORY;
  const hasBody = typeof testBody === 'string' && testBody.trim() !== '';
  if (framework === 'xunit' && !hasBody) {
    throw new Error(
      'testBody is required for xunit: the fixture a test builds its page from is project-specific, so there is no safe default body.'
    );
  }
  const body = hasBody ? testBody.trim() : DEFAULT_TEST_BODY;
  const bodyIndent = indent + '    ';
  const acComment = acId ? `${bodyIndent}// ${acId}\n` : '';
  const attributes =
    framework === 'xunit'
      ? `${indent}[Fact]\n${indent}[Trait("Category", "${category}")]\n`
      : `${indent}[Test]\n${indent}[TestCategory("${category}")]\n`;

  return (
    attributes +
    `${indent}public async Task ${testName}()\n` +
    `${indent}{\n` +
    acComment +
    `${indentBlock(body, bodyIndent)}\n` +
    `${indent}}\n`
  );
}

/**
 * Scaffold a brand-new `.cs` spec file containing one `[TestFixture]` class
 * (extending `AuthenticatedPageTest` or `PageTest`) with one `[Test]` method.
 *
 * @param {object} specDetails
 * @param {string} specDetails.className - the C# class name (e.g. "LoginTests")
 * @param {'AuthenticatedPageTest'|'PageTest'} specDetails.baseClass
 * @param {string} [specDetails.namespace] - defaults to "Application.E2E.Tests"
 * @param {string} [specDetails.acId] - e.g. "AC-006-1", left as a plain comment anchor
 * @param {string} specDetails.testName - C# method name (e.g. "Should_Redirect_To_Login")
 * @param {string} [specDetails.testBody] - raw C# statements for the method body;
 *   defaults to a TestConfiguration.*-based placeholder (AC-006-1) if omitted
 * @param {string} [specDetails.testCategory] - defaults to "E2E" (AC-006-1)
 * @returns {string} full new file content
 * @throws {Error} if className/baseClass/testName are missing or invalid
 */
function scaffoldNewSpecFile(specDetails = {}) {
  const { className, baseClass, namespace } = specDetails;
  const framework = resolveFramework(specDetails);
  assertIdentifier('className', className);
  if (framework === 'nunit') assertBaseClass(baseClass);
  const ns = typeof namespace === 'string' && namespace.trim() !== '' ? namespace.trim() : DEFAULT_NAMESPACE;

  const methodBlock = renderTestMethodBlock(specDetails, '        '); // 8 spaces: namespace(0) + class(4) + member(8)

  if (framework === 'xunit') return scaffoldXunitFile({ ...specDetails, className, ns }, methodBlock);

  return (
    'using System.Threading.Tasks;\n' +
    'using Microsoft.Playwright.NUnit;\n' +
    'using NUnit.Framework;\n' +
    '\n' +
    `namespace ${ns}\n` +
    '{\n' +
    '    [TestFixture]\n' +
    `    [TestCategory("${TEST_CATEGORY}")]\n` +
    `    public class ${className} : ${baseClass}\n` +
    '    {\n' +
    methodBlock +
    '    }\n' +
    '}\n'
  );
}

/**
 * A new xUnit class in the shape a Playwright xUnit suite uses: a `[Collection]` shared fixture injected
 * through the constructor (xUnit has no base class to inherit a page from). The collection name and fixture
 * type are the project's own, so the caller must supply them (the command copies them from a sibling spec).
 */
function scaffoldXunitFile({ className, ns, collection, fixtureType, usings }, methodBlock) {
  if (typeof collection !== 'string' || !COLLECTION_NAME_RE.test(collection.trim())) {
    throw new Error(`collection must be the project's xUnit collection name (got: ${JSON.stringify(collection)}) -- copy it from a sibling spec class.`);
  }
  if (typeof fixtureType !== 'string' || !DOTTED_IDENTIFIER_RE.test(fixtureType)) {
    throw new Error(`fixtureType must be the project's fixture class name (got: ${JSON.stringify(fixtureType)}) -- copy it from a sibling spec class.`);
  }
  const extra = [...new Set(Array.isArray(usings) ? usings : [])];
  for (const u of extra) {
    if (typeof u !== 'string' || !DOTTED_IDENTIFIER_RE.test(u)) throw new Error(`usings entries must be namespaces (got: ${JSON.stringify(u)})`);
  }
  const baseUsings = ['System.Threading.Tasks', 'Microsoft.Playwright', 'Xunit'];
  const usingLines = [...baseUsings, ...extra.filter((u) => !baseUsings.includes(u))].map((u) => `using ${u};\n`).join('');

  return (
    usingLines +
    '\n' +
    `namespace ${ns}\n` +
    '{\n' +
    `    [Collection("${collection.trim()}")]\n` +
    `    [Trait("Category", "${TEST_CATEGORY}")]\n` +
    `    public class ${className}\n` +
    '    {\n' +
    `        private readonly ${fixtureType} _fixture;\n` +
    '\n' +
    `        public ${className}(${fixtureType} fixture)\n` +
    '        {\n' +
    '            _fixture = fixture;\n' +
    '        }\n' +
    '\n' +
    methodBlock +
    '    }\n' +
    '}\n'
  );
}

/** Neutral placeholder char for masked positions -- never '{'/'}'/word-char. */
const MASK_CHAR = '\0';

/**
 * Return a same-length copy of `content` with the *interior* of every string
 * literal (`"..."`), verbatim string literal (`@"..."`, `""` = escaped quote),
 * char literal (`'x'`), line comment (`// ...`), and block comment
 * (`/* ... *\/`) replaced with a neutral placeholder char -- so a brace-depth
 * counter run over the result only ever sees real code braces. Newlines are
 * left in place (not masked) so line-based logic elsewhere stays unaffected;
 * everything else preserves its original index, so the result can be used to
 * *decide* indices while still slicing/inserting into the ORIGINAL content.
 *
 * ponytail: a hand-rolled lexer scoped to what breaks brace-counting, not a
 * full C# tokenizer. Both interpolated-verbatim orderings are handled as
 * verbatim strings: `@"..."`/`@$"..."` are detected directly (an `@` followed
 * by `"` or `$"`), and `$@"..."` works too, but indirectly -- the leading `$`
 * matches no branch and is skipped as a plain code char, then the `@"` that
 * follows is caught by the same verbatim-detection branch. This is the
 * STOPPING POINT for this lexer (three review rounds: string-literal brace
 * masking, then `@$` vs `$@` ordering -- both now closed). Known, accepted,
 * final gaps, not planned to be fixed: C# 11 raw string literals
 * (`"""..."""`), and an interpolated string's `{expr}` holes, which are
 * masked as opaque text rather than parsed (safe as long as the hole itself
 * is brace-balanced, which normal interpolation is). Upgrade only if a real
 * spec body hits one of these.
 *
 * @param {string} content
 * @returns {string} same length as `content`
 */
function maskLiteralsAndComments(content) {
  const out = content.split('');
  const n = content.length;

  const maskRun = (from, to) => {
    for (let k = from; k < to; k++) {
      if (content[k] !== '\n') out[k] = MASK_CHAR;
    }
  };

  let i = 0;
  while (i < n) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '/' && next === '/') {
      let j = i;
      while (j < n && content[j] !== '\n') j++;
      maskRun(i, j);
      i = j;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = content.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      maskRun(i, stop);
      i = stop;
      continue;
    }

    if (ch === '@' && (next === '"' || (next === '$' && content[i + 2] === '"'))) {
      const prefixLen = next === '"' ? 2 : 3; // `@"` (2 chars) or `@$"` (3 chars)
      let j = i + prefixLen;
      while (j < n) {
        if (content[j] === '"') {
          if (content[j + 1] === '"') {
            j += 2; // "" == escaped literal quote inside a verbatim string
            continue;
          }
          j++; // closing quote
          break;
        }
        j++;
      }
      maskRun(i, j);
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (content[j] === '\\') {
          j += 2; // skip the escaped char, whatever it is (incl. another quote)
          continue;
        }
        if (content[j] === quote) {
          j++; // closing quote
          break;
        }
        j++;
      }
      maskRun(i, Math.min(j, n));
      i = j;
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * Locate the `class ... { ... }` body's own opening/closing brace positions
 * inside `content`, by tracking brace depth from the class's opening brace
 * (not just scanning for the last `}` in the file -- the last member inside
 * the class is itself brace-delimited, e.g. a `[Test]` method body, so the
 * closing braces of the last method, the class, and (if block-scoped) the
 * namespace all appear consecutively at the end of the file; only depth
 * tracking tells them apart reliably).
 *
 * The class-declaration search and the depth scan both run over a *masked*
 * copy (see maskLiteralsAndComments) so braces/`class`-looking text inside
 * string/char literals and comments can't desync the count or fake a match
 * -- but all returned indices are positions into the ORIGINAL `content`
 * (masking never changes length), so callers can keep slicing/inserting into
 * the unmasked text.
 *
 * @param {string} content
 * @returns {{openBraceIndex: number, closeBraceIndex: number}}
 * @throws {Error} if no class declaration or no matching closing brace is found
 */
function findClassBodyRange(content) {
  const masked = maskLiteralsAndComments(content);

  const classDeclMatch = masked.match(/\bclass\s+\w+[^{]*\{/);
  if (!classDeclMatch) {
    throw new Error('Could not locate a "class Name ... {" declaration in existingContent.');
  }
  const openBraceIndex = classDeclMatch.index + classDeclMatch[0].length - 1;

  let depth = 1;
  for (let i = openBraceIndex + 1; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { openBraceIndex, closeBraceIndex: i };
      }
    }
  }
  throw new Error('Could not find the matching closing brace for the class body in existingContent.');
}

/**
 * Append a new `[Test]` method to an existing `.cs` spec file, inside the
 * class body, immediately before the class's own closing brace -- without
 * disturbing anything else in the file (AC-006-2).
 *
 * @param {string} existingContent - the existing file's full text (must be non-empty)
 * @param {object} specDetails - see renderTestMethodBlock (acId, testName, testBody, testCategory)
 * @returns {string} full updated file content
 * @throws {Error} if existingContent is empty, or no class body can be located
 */
function appendTestMethod(existingContent, specDetails = {}) {
  if (typeof existingContent !== 'string' || existingContent.trim() === '') {
    throw new Error('appendTestMethod requires a non-empty existingContent -- use scaffoldNewSpecFile for a brand-new file.');
  }

  const { closeBraceIndex } = findClassBodyRange(existingContent);

  // An existing file already says which framework its tests use; never append the other one's attribute to it.
  const requested = specDetails.framework === undefined ? undefined : resolveFramework(specDetails);
  const inferred = inferFramework(existingContent);
  if (requested && inferred && requested !== inferred) {
    throw new Error(`framework mismatch: the existing file uses ${inferred} but framework '${requested}' was requested.`);
  }
  const framework = requested || inferred || 'nunit';

  // Indentation of the line the class's own closing brace sits on; new
  // members go one level (4 spaces) deeper than that.
  const lineStart = existingContent.lastIndexOf('\n', closeBraceIndex - 1) + 1;
  const braceLineIndent = (existingContent.slice(lineStart, closeBraceIndex).match(/^[ \t]*/) || [''])[0];
  const methodIndent = braceLineIndent + '    ';

  const methodBlock = renderTestMethodBlock({ ...specDetails, framework }, methodIndent);

  const before = existingContent.slice(0, closeBraceIndex).replace(/[ \t\r\n]+$/, '');
  const after = existingContent.slice(closeBraceIndex); // starts at the class's own closing '}'

  return `${before}\n\n${methodBlock}${braceLineIndent}${after}`;
}

/**
 * Write-or-append entry point (AC-006-1 + AC-006-2 combined): scaffold a
 * brand-new file when none exists yet, or append a new `[Test]` method to an
 * existing one. The caller (a later task) decides WHICH existing file (if
 * any) covers the same REQ -- this function just does the write/append once
 * that decision is made.
 *
 * @param {string|null|undefined} existingFileContent - null/empty for a new file
 * @param {object} specDetails - see scaffoldNewSpecFile / renderTestMethodBlock
 * @returns {string} full file content to write back to disk
 */
function writeOrAppendSpec(existingFileContent, specDetails = {}) {
  if (typeof existingFileContent === 'string' && existingFileContent.trim() !== '') {
    return appendTestMethod(existingFileContent, specDetails);
  }
  return scaffoldNewSpecFile(specDetails);
}

/**
 * Thin file-I/O wrapper over writeOrAppendSpec: reads `filePath` if it
 * exists, computes the new content, and writes it back. Injectable I/O via
 * `opts`, matching resume-scan.js's `scanConfirmedAcsInFiles` precedent --
 * the core logic above stays pure string-in/string-out.
 *
 * @param {string} filePath
 * @param {object} specDetails - see scaffoldNewSpecFile / renderTestMethodBlock
 * @param {object} [opts]
 * @param {(p: string) => boolean} [opts.existsSync]
 * @param {(p: string) => string} [opts.readFileSync]
 * @param {(p: string, content: string) => void} [opts.writeFileSync]
 * @returns {string} the content written
 */
function writeOrAppendSpecFile(filePath, specDetails = {}, opts = {}) {
  const existsSync = opts.existsSync || fs.existsSync;
  const readFileSync = opts.readFileSync || ((p) => fs.readFileSync(p, 'utf8'));
  const writeFileSync = opts.writeFileSync || ((p, content) => fs.writeFileSync(p, content, 'utf8'));

  const existingContent = existsSync(filePath) ? readFileSync(filePath) : null;
  const newContent = writeOrAppendSpec(existingContent, specDetails);
  writeFileSync(filePath, newContent);
  return newContent;
}

module.exports = {
  VALID_BASE_CLASSES,
  VALID_FRAMEWORKS,
  inferFramework,
  scaffoldNewSpecFile,
  appendTestMethod,
  writeOrAppendSpec,
  writeOrAppendSpecFile,
  maskLiteralsAndComments, // exposed for TRD-014-TEST's direct unit coverage
};

// ponytail self-check: `node packages/e2e-testing/lib/spec-writer.js` exercises
// scaffold, append (including a second append to prove no corruption), and the
// baseClass/identifier guards -- no separate test file yet (TRD-014-TEST is a
// later task, per the TRD's dependency graph, that will formalize this into Jest).
if (require.main === module) {
  const assert = require('assert');

  // --- scaffoldNewSpecFile: AC-006-1 shape ---
  const scaffolded = scaffoldNewSpecFile({
    className: 'LoginTests',
    baseClass: 'AuthenticatedPageTest',
    acId: 'AC-006-1',
    testName: 'Should_Redirect_To_Login_When_Unauthenticated',
  });
  assert.ok(scaffolded.includes('public class LoginTests : AuthenticatedPageTest'));
  assert.ok(scaffolded.includes('[TestCategory("E2E")]'));
  assert.ok(scaffolded.includes('TestConfiguration.QaBaseUrl')); // default body, never a hardcoded URL literal
  assert.ok(scaffolded.includes('// AC-006-1'));
  assert.ok(scaffolded.includes('namespace Application.E2E.Tests'));
  assert.throws(() => scaffoldNewSpecFile({ className: 'X' }), /baseClass must be one of/);
  assert.throws(
    () => scaffoldNewSpecFile({ className: '1Bad', baseClass: 'PageTest', testName: 'T' }),
    /className must be a non-empty, valid C# identifier/
  );

  // custom body must be used verbatim, not overridden by the TestConfiguration placeholder
  const withCustomBody = scaffoldNewSpecFile({
    className: 'CaseSearchTests',
    baseClass: 'PageTest',
    testName: 'Should_Filter_By_CaseId',
    testBody: 'await Page.GotoAsync(TestConfiguration.QaBaseUrl + "/cases/" + TestConfiguration.SampleCaseId);',
  });
  assert.ok(withCustomBody.includes('TestConfiguration.SampleCaseId'));
  assert.ok(!withCustomBody.includes(DEFAULT_TEST_BODY));

  // --- appendTestMethod: AC-006-2, no redundant new file, no corruption ---
  const appended = appendTestMethod(scaffolded, {
    acId: 'AC-006-2',
    testName: 'Should_Show_Error_On_Bad_Password',
    testBody: 'await Page.FillAsync("#password", "wrong");',
  });
  // both methods present in one file/class -- no duplicate file created
  assert.ok(appended.includes('Should_Redirect_To_Login_When_Unauthenticated'));
  assert.ok(appended.includes('Should_Show_Error_On_Bad_Password'));
  // only one class/namespace declaration -- not duplicated by the append
  assert.strictEqual((appended.match(/public class LoginTests/g) || []).length, 1);
  assert.strictEqual((appended.match(/namespace Application\.E2E\.Tests/g) || []).length, 1);
  // well-formed: braces still balance, and the file still ends with the
  // class-closing brace followed by the namespace-closing brace
  assert.strictEqual((appended.match(/\{/g) || []).length, (appended.match(/\}/g) || []).length);
  assert.ok(/\}\r?\n {4}\}\r?\n\}\r?\n?$/.test(appended));

  // a second append must still work correctly (append-to-appended, no drift)
  const appendedTwice = appendTestMethod(appended, {
    acId: 'AC-006-3',
    testName: 'Should_Lock_Account_After_Failed_Attempts',
  });
  assert.ok(appendedTwice.includes('Should_Lock_Account_After_Failed_Attempts'));
  assert.strictEqual((appendedTwice.match(/\[TestCategory\("E2E"\)\]/g) || []).length, 4); // class(1) + 3 methods

  assert.throws(() => appendTestMethod('', { testName: 'X' }), /requires a non-empty existingContent/);
  assert.throws(() => appendTestMethod('not csharp at all', { testName: 'X' }), /Could not locate a "class/);

  // --- writeOrAppendSpec: dispatches on existingFileContent presence ---
  const fresh = writeOrAppendSpec(null, {
    className: 'NewTests',
    baseClass: 'PageTest',
    testName: 'Should_Load_Home_Page',
  });
  assert.ok(fresh.includes('public class NewTests : PageTest'));
  const grown = writeOrAppendSpec(fresh, { testName: 'Should_Show_Nav_Bar' });
  assert.ok(grown.includes('Should_Load_Home_Page') && grown.includes('Should_Show_Nav_Bar'));

  // --- writeOrAppendSpecFile: thin fs wrapper, fully injectable (no real disk I/O here) ---
  const fakeDisk = {};
  const fsOpts = {
    existsSync: (p) => Object.prototype.hasOwnProperty.call(fakeDisk, p),
    readFileSync: (p) => fakeDisk[p],
    writeFileSync: (p, content) => {
      fakeDisk[p] = content;
    },
  };
  writeOrAppendSpecFile(
    'LoginTests.cs',
    { className: 'LoginTests', baseClass: 'AuthenticatedPageTest', testName: 'Should_Redirect_To_Login' },
    fsOpts
  );
  assert.ok(fakeDisk['LoginTests.cs'].includes('Should_Redirect_To_Login'));
  writeOrAppendSpecFile('LoginTests.cs', { testName: 'Should_Log_Out' }, fsOpts);
  assert.ok(fakeDisk['LoginTests.cs'].includes('Should_Redirect_To_Login')); // first method preserved
  assert.ok(fakeDisk['LoginTests.cs'].includes('Should_Log_Out')); // appended, not a second file

  // --- regression (code-reviewer REJECTED, br-3ql): findClassBodyRange's
  // brace-depth counter must ignore braces inside string/char literals and
  // comments, not just scan raw text. The trap literals below deliberately
  // contain a *stray, unmatched* brace character on purpose (that's the
  // whole point of the bug), so raw whole-file brace-count symmetry is NOT a
  // valid check here -- instead each case appends a trap-containing test
  // (test N), then appends ONE MORE test on top (test N+1), which is what
  // forces findClassBodyRange to re-scan the already-written trap text. A
  // corrupted splice would land test N+1 inside test N's literal/comment,
  // mangle the trailing class/namespace closing braces, and/or lose a method.
  const closesCleanly = (s) => assert.ok(/\}\r?\n {4}\}\r?\n\}\r?\n?$/.test(s));
  const testMethodCount = (s) => (s.match(/\[Test\]/g) || []).length;

  function assertTrapSurvivesAppend(trapText, trapTestName, followOnTestName) {
    const withTrap = appendTestMethod(scaffolded, { testName: trapTestName, testBody: trapText });
    assert.ok(withTrap.includes(trapText));
    const afterFollowOn = appendTestMethod(withTrap, { testName: followOnTestName });
    assert.ok(afterFollowOn.includes(trapText)); // trap test untouched, byte-for-byte
    assert.ok(afterFollowOn.indexOf(trapTestName) < afterFollowOn.indexOf(followOnTestName)); // correct order, not spliced inside
    assert.strictEqual((afterFollowOn.match(/public class LoginTests/g) || []).length, 1); // no duplicate class
    assert.strictEqual(testMethodCount(afterFollowOn), 3); // scaffolded's own + trap + follow-on, none lost
    closesCleanly(afterFollowOn);
    return afterFollowOn;
  }

  // 1. exact repro from the bug report: unbalanced braces in a string literal
  assertTrapSurvivesAppend(
    'var trap = "}}}"; // unbalanced braces live inside this string literal',
    'Should_Handle_Weird_String',
    'Should_Run_After_The_Trap'
  );

  // 2. verbatim string literal with unmatched braces (and a doubled "" escape)
  assertTrapSurvivesAppend(
    'var trap = @"{{{ unmatched, and a "" escaped quote";',
    'Should_Handle_Verbatim_Trap',
    'Should_Run_After_Verbatim_Trap'
  );

  // 3. line comment containing a brace
  assertTrapSurvivesAppend(
    '// this comment has a stray { brace in it',
    'Should_Handle_Line_Comment_Trap',
    'Should_Run_After_Line_Comment_Trap'
  );

  // 4. block comment containing a brace
  assertTrapSurvivesAppend(
    '/* stray } brace in a block comment */',
    'Should_Handle_Block_Comment_Trap',
    'Should_Run_After_Block_Comment_Trap'
  );

  // 5. escaped quote inside a regular string literal, next to a brace
  assertTrapSurvivesAppend(
    'var trap = "a { \\" } b";',
    'Should_Handle_Escaped_Quote_Trap',
    'Should_Run_After_Escaped_Quote_Trap'
  );

  // 6. `@$"..."` (verbatim-interpolated, `@` before `$`) -- this was the
  // actually-broken ordering (3rd review round): the backslash before the
  // real closing quote used to be misread as a plain-string escape, eating
  // the closing quote and running the scan off into later code.
  assertTrapSurvivesAppend(
    'var trap = @$"C:\\Temp\\";',
    'Should_Handle_At_Dollar_Verbatim_Trap',
    'Should_Run_After_At_Dollar_Verbatim_Trap'
  );

  // 7. `$@"..."` (`$` before `@`) -- already worked before this fix (the `$`
  // is skipped as an ordinary code char, then `@"` is caught directly), kept
  // here so both orderings have permanent regression coverage side by side.
  assertTrapSurvivesAppend(
    'var trap = $@"C:\\Temp\\";',
    'Should_Handle_Dollar_At_Verbatim_Trap',
    'Should_Run_After_Dollar_At_Verbatim_Trap'
  );

  console.log('spec-writer.js self-check passed');
}
