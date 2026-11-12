'use strict';

/**
 * The two places a missing end-state screenshot is caught: the Proposal (a test that never opens the capture scope is
 * rejected before the QA engineer sees it) and the Run (a run that left no screenshot is not accepted). Both are opt-in
 * by request field, so callers that do not send them behave exactly as before.
 */

const os = require('os');
const path = require('path');

const {
  validateProposalResponse,
  validateRunRequest,
  validateRunResponse,
} = require('../lib/delegation-contract');
const { evidencePath } = require('../lib/evidence-capture');
const { formatActionLog, KNOWN_TYPES } = require('../lib/session-logger');

const SCOPED = [
  'await using var context = _fixture.CreateBrowserContext();',
  'var page = await context.NewPageAsync();',
  'await using var evidence = EvidenceCapture.For(page, "AC-001-1");',
  'await page.GotoAsync(_fixture.BaseAddress);',
].join('\n');
const UNSCOPED = SCOPED.split('\n').filter((l) => !l.includes('EvidenceCapture')).join('\n');

const proposal = (proposedTest) => ({ proposedTest, selectorsUsed: [], plainEnglishSummary: 'Opens the page.' });

describe('validateProposalResponse with an acId on the request', () => {
  const req = { acText: 'Given X when Y then Z', groundingDiff: { grounded: true }, acId: 'AC-001-1' };

  test('accepts a test that opens the AC\'s capture scope', () => {
    expect(validateProposalResponse(proposal(SCOPED), req)).toBe(true);
  });

  test('rejects a test that does not, naming the exact line to add', () => {
    expect(() => validateProposalResponse(proposal(UNSCOPED), req)).toThrow(
      /await using var evidence = EvidenceCapture\.For\(page, "AC-001-1"\)/
    );
  });

  test('rejects a scope opened for a different AC', () => {
    expect(() => validateProposalResponse(proposal(SCOPED), { ...req, acId: 'AC-002-2' })).toThrow(/"AC-002-2"/);
  });

  test('an authoring failure is still just a failure (nothing to screenshot)', () => {
    expect(validateProposalResponse({ authoringFailure: true, reason: 'no stable selector' }, req)).toBe(true);
  });
});

describe('validateProposalResponse without an acId (callers that do not opt in)', () => {
  test('behaves as before: no capture required', () => {
    expect(validateProposalResponse(proposal(UNSCOPED))).toBe(true);
    expect(validateProposalResponse(proposal(UNSCOPED), { acText: 'x', groundingDiff: {} })).toBe(true);
  });
});

describe('validateRunRequest evidence fields', () => {
  const base = {
    acText: 'Given X when Y then Z',
    groundingDiff: { grounded: true },
    proposedTest: SCOPED,
    targetEnv: 'https://qa.example.com',
    mode: 'headless',
    authStatePath: '/secure/state.json',
  };

  test('evidenceDir with an acId is valid; neither is valid (back-compat)', () => {
    expect(validateRunRequest({ ...base, acId: 'AC-001-1', evidenceDir: '/tmp/ev' })).toBe(true);
    expect(validateRunRequest(base)).toBe(true);
  });

  test('evidenceDir without an acId is refused: the acId names the file', () => {
    expect(() => validateRunRequest({ ...base, evidenceDir: '/tmp/ev' })).toThrow(/acId is required with evidenceDir/);
  });

  test.each(['', '  ', 5])('a bad evidenceDir %p is refused', (bad) => {
    expect(() => validateRunRequest({ ...base, acId: 'AC-001-1', evidenceDir: bad })).toThrow(/evidenceDir must be a non-empty string/);
  });
});

describe('validateRunResponse requires the screenshot when the request asked for one', () => {
  const dir = path.join(os.tmpdir(), 'ev-contract-test');
  const req = { acId: 'AC-001-1', evidenceDir: dir };
  const expected = evidencePath(dir, 'AC-001-1');
  const exists = () => true;
  const missing = () => false;

  test.each([
    ['a pass', { passed: true }],
    ['a failure', { passed: false, details: 'assertion failed' }],
  ])('%s without evidencePath is rejected', (_label, runResult) => {
    expect(() => validateRunResponse({ runResult }, req, { existsSync: exists })).toThrow(/evidencePath is required/);
  });

  test.each([
    ['a pass', { passed: true }],
    ['a failure', { passed: false, details: 'assertion failed' }],
  ])('%s with the screenshot at the expected path is accepted', (_label, runResult) => {
    expect(validateRunResponse({ runResult: { ...runResult, evidencePath: expected } }, req, { existsSync: exists })).toBe(true);
  });

  test('a path for some other file is rejected', () => {
    const other = evidencePath(dir, 'AC-009-9');
    expect(() => validateRunResponse({ runResult: { passed: true, evidencePath: other } }, req, { existsSync: exists })).toThrow(
      /evidencePath must be/
    );
  });

  test('a claimed screenshot that is not on disk is rejected, naming the likely cause', () => {
    expect(() => validateRunResponse({ runResult: { passed: false, evidencePath: expected } }, req, { existsSync: missing })).toThrow(
      /did not reach its EvidenceCapture scope/
    );
  });

  test('checks the real filesystem when no existsSync is injected', () => {
    expect(() => validateRunResponse({ runResult: { passed: true, evidencePath: expected } }, req)).toThrow(/no screenshot exists/);
  });

  test('without evidence fields on the request nothing changes', () => {
    expect(validateRunResponse({ runResult: { passed: true } })).toBe(true);
    expect(validateRunResponse({ runResult: { passed: true } }, { acId: 'AC-001-1' })).toBe(true);
  });

  test('the other run-result rules still apply alongside', () => {
    expect(() => validateRunResponse({ runResult: { passed: 'yes', evidencePath: expected } }, req, { existsSync: exists })).toThrow(
      /boolean `passed`/
    );
  });
});

describe('session log lines', () => {
  test('a run line carries the screenshot path for a pass and a failure; absent when there is none', () => {
    expect(formatActionLog({ type: 'run-result', acId: 'AC-001-1', mode: 'headless', runResult: { passed: true, evidencePath: '/ev/AC-001-1.png' } })).toBe(
      '[run-result] AC-001-1: PASSED (headless) [screenshot: /ev/AC-001-1.png]'
    );
    expect(formatActionLog({ type: 'run-result', acId: 'AC-001-1', mode: 'headed', runResult: { passed: false, details: 'timeout', evidencePath: '/ev/AC-001-1.png' } })).toBe(
      '[run-result] AC-001-1: FAILED (headed) - timeout [screenshot: /ev/AC-001-1.png]'
    );
    expect(formatActionLog({ type: 'run-result', acId: 'AC-001-1', mode: 'headless', runResult: { passed: true } })).toBe(
      '[run-result] AC-001-1: PASSED (headless)'
    );
  });

  test('evidence-attach is a known type with a line for each outcome', () => {
    expect(KNOWN_TYPES).toContain('evidence-attach');
    expect(formatActionLog({ type: 'evidence-attach', acId: 'AC-001-1', testCaseId: 77, method: 'command' })).toBe(
      '[evidence-attach] AC-001-1: attached to ADO Test Case 77 via command'
    );
    expect(formatActionLog({ type: 'evidence-attach', acId: 'AC-001-1', testCaseId: 77, method: 'command', ok: false, error: 'exit 1', path: '/ev/a.png' })).toBe(
      '[evidence-attach] AC-001-1: attach to ADO Test Case 77 FAILED via command - exit 1; screenshot kept at /ev/a.png'
    );
    expect(formatActionLog({ type: 'evidence-attach', acId: 'AC-001-1', method: 'none', reason: 'E2E_EVIDENCE_ATTACH_CMD is not set', path: '/ev/a.png' })).toBe(
      '[evidence-attach] AC-001-1: NOT attached (E2E_EVIDENCE_ATTACH_CMD is not set); screenshot kept at /ev/a.png'
    );
  });
});
