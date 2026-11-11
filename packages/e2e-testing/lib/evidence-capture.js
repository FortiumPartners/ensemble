'use strict';

/**
 * End-state screenshot evidence for /ensemble:author-playwright-tests.
 *
 * Every authored test opens with `await using var evidence = EvidenceCapture.For(page, "AC-001-1");`.
 * `await using` disposes on a pass AND when the test throws, and (declared after the page/context)
 * disposes before them, so the page is still open and the helper screenshots its final state either way.
 * That scope works for any C# test framework. A teardown or base-class hook cannot see a page that
 * a test builds for itself, which is how xUnit suites usually look.
 *
 * Files land outside the repo (E2E_EVIDENCE_DIR, default <temp>/e2e-evidence), so nothing is committed.
 * The ADO MCP can only download attachments, so attaching a screenshot to a Test Case runs a command the
 * user configured (E2E_EVIDENCE_ATTACH_CMD); with none configured the command reports the gap
 * (AC-015-2) instead of improvising one.
 *
 * Plain functions over strings; spec-writer's literal/comment masker keeps a commented-out call from counting.
 */

const os = require('os');
const path = require('path');
const { maskLiteralsAndComments } = require('./spec-writer');

const EVIDENCE_DIR_ENV = 'E2E_EVIDENCE_DIR';
const ATTACH_CMD_ENV = 'E2E_EVIDENCE_ATTACH_CMD';
const DEFAULT_NAMESPACE = 'Application.E2E.Tests';

// The scope must be `await using`-ed, or it never disposes and nothing is captured.
const SCOPE_RE = /await\s+using\s+(?:var\s+\w+\s*=\s*|\(\s*(?:var\s+\w+\s*=\s*)?)EvidenceCapture\s*\.\s*For\s*\(/;
// Characters a screenshot path may contain once it is substituted, double-quoted, into a user-configured command.
const SAFE_PATH_RE = /^[A-Za-z0-9 _.:\\/()~+@#,-]+$/;

function assertAcId(acId) {
  if (typeof acId !== 'string' || acId.trim() === '') {
    throw new Error('acId must be a non-empty string (e.g. "AC-001-1")');
  }
}

/** `AC-001-1` -> `AC-001-1.png`; anything outside [A-Za-z0-9_-] becomes `-`. Matches the C# helper's own rule. */
function evidenceFileName(acId) {
  assertAcId(acId);
  return `${acId.trim().replace(/[^A-Za-z0-9_-]/g, '-')}.png`;
}

/** E2E_EVIDENCE_DIR when set, else <temp>/e2e-evidence. Always absolute. */
function resolveEvidenceDir(env = process.env, tmpdir = os.tmpdir()) {
  const configured = env && typeof env[EVIDENCE_DIR_ENV] === 'string' ? env[EVIDENCE_DIR_ENV].trim() : '';
  return path.resolve(configured || path.join(tmpdir, 'e2e-evidence'));
}

/** Where the helper writes AC `acId`'s screenshot for evidence dir `dir`. */
function evidencePath(dir, acId) {
  return path.join(path.resolve(dir), evidenceFileName(acId));
}

/**
 * Does this test source open the capture scope (as a real `await using`, not in a comment or string)?
 * With `acId`, the call must also pass that exact id, so the file the helper writes is the one the Run stage looks for.
 */
function hasEvidenceCapture(testSource, acId) {
  if (typeof testSource !== 'string') return false;
  const masked = maskLiteralsAndComments(testSource);
  const match = SCOPE_RE.exec(masked);
  if (!match) return false;
  if (acId === undefined) return true;
  const statementEnd = masked.indexOf(';', match.index);
  const statement = testSource.slice(match.index, statementEnd === -1 ? undefined : statementEnd);
  return statement.includes(`"${acId}"`);
}

/** The C# `EvidenceCapture` class, written once into the consuming E2E test project. */
function renderEvidenceHelper({ namespace } = {}) {
  const ns = typeof namespace === 'string' && namespace.trim() !== '' ? namespace.trim() : DEFAULT_NAMESPACE;
  return `using System;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Playwright;

namespace ${ns}
{
    /// <summary>
    /// Screenshots a page's final state when disposed, on a pass and when the test throws.
    /// Use: <c>await using var evidence = EvidenceCapture.For(page, "AC-001-1");</c> right after the page exists.
    /// Writes <c>&lt;AC id&gt;.png</c> under ${EVIDENCE_DIR_ENV} (default: the temp folder's e2e-evidence).
    /// </summary>
    public sealed class EvidenceCapture : IAsyncDisposable
    {
        private readonly IPage _page;
        private readonly string _path;

        private EvidenceCapture(IPage page, string path)
        {
            _page = page;
            _path = path;
        }

        public static EvidenceCapture For(IPage page, string acId)
        {
            var dir = Environment.GetEnvironmentVariable("${EVIDENCE_DIR_ENV}");
            if (string.IsNullOrWhiteSpace(dir))
            {
                dir = Path.Combine(Path.GetTempPath(), "e2e-evidence");
            }
            var name = Regex.Replace(acId.Trim(), "[^A-Za-z0-9_-]", "-") + ".png";
            return new EvidenceCapture(page, Path.Combine(Path.GetFullPath(dir), name));
        }

        public async ValueTask DisposeAsync()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_path) ?? ".");
                await _page.ScreenshotAsync(new PageScreenshotOptions { Path = _path, FullPage = true });
            }
            catch (Exception ex)
            {
                // Never mask the test's own failure; a missing file is caught when the run is validated.
                Console.Error.WriteLine("EvidenceCapture: could not write " + _path + ": " + ex.Message);
            }
        }
    }
}
`;
}

/**
 * The user-configured attach command, if any. `{method: 'command', template}` or `{method: 'none', reason}`.
 * Whether an ADO MCP attachment tool exists is the caller's call; none does today.
 */
function resolveAttachCommand(env = process.env) {
  const template = env && typeof env[ATTACH_CMD_ENV] === 'string' ? env[ATTACH_CMD_ENV].trim() : '';
  if (template === '') {
    return { method: 'none', reason: `no ADO attachment capability: the ADO MCP cannot upload and ${ATTACH_CMD_ENV} is not set` };
  }
  if (!template.includes('{workItemId}') || !template.includes('{path}')) {
    return { method: 'none', reason: `${ATTACH_CMD_ENV} must contain both {workItemId} and {path}` };
  }
  return { method: 'command', template };
}

/**
 * Fill the template. workItemId must be digits; the path is substituted double-quoted (the template must not quote it)
 * and is refused if it holds anything a shell could act on.
 */
function buildAttachCommand(template, { workItemId, path: filePath } = {}) {
  if (typeof template !== 'string' || !template.includes('{workItemId}') || !template.includes('{path}')) {
    throw new Error('template must contain both {workItemId} and {path}');
  }
  const id = String(workItemId);
  if (!/^\d+$/.test(id)) throw new Error(`workItemId must be digits only (got: ${JSON.stringify(workItemId)})`);
  if (typeof filePath !== 'string' || !SAFE_PATH_RE.test(filePath)) {
    throw new Error(`path may only contain letters, digits, spaces and . _ - : \\ / ( ) ~ + @ # , (got: ${JSON.stringify(filePath)})`);
  }
  return template.split('{workItemId}').join(id).split('{path}').join(`"${filePath}"`);
}

module.exports = {
  EVIDENCE_DIR_ENV,
  ATTACH_CMD_ENV,
  evidenceFileName,
  resolveEvidenceDir,
  evidencePath,
  hasEvidenceCapture,
  renderEvidenceHelper,
  resolveAttachCommand,
  buildAttachCommand,
};
