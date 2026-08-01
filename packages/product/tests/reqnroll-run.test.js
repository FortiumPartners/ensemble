'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseTestOutput, isGreen, runTests } = require('../lib/reqnroll-run');

const TRX_PASS = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testName="LoginFeature.ValidLogin" outcome="Passed" />
  </Results>
  <ResultSummary outcome="Completed">
    <Counters total="3" executed="3" passed="3" failed="0" error="0" notExecuted="0" inconclusive="0" />
  </ResultSummary>
</TestRun>`;

const TRX_FAIL = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testName="LoginFeature.ValidLogin" outcome="Failed">
      <Output><ErrorInfo><Message>Expected true but found false</Message></ErrorInfo></Output>
    </UnitTestResult>
  </Results>
  <ResultSummary outcome="Failed">
    <Counters total="3" executed="3" passed="2" failed="1" error="0" notExecuted="0" inconclusive="0" />
  </ResultSummary>
</TestRun>`;

const TRX_PENDING = `<?xml version="1.0" encoding="UTF-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testName="LoginFeature.ValidLogin" outcome="Failed">
      <Output><ErrorInfo><Message>Reqnroll.PendingStepException: One or more step definitions are not implemented yet.</Message></ErrorInfo></Output>
    </UnitTestResult>
    <UnitTestResult testName="LoginFeature.BadLogin" outcome="Failed">
      <Output><ErrorInfo><Message>No matching step definition found for the step 'Given a user'</Message></ErrorInfo></Output>
    </UnitTestResult>
  </Results>
  <ResultSummary outcome="Failed">
    <Counters total="2" executed="2" passed="0" failed="2" error="0" notExecuted="0" inconclusive="0" />
  </ResultSummary>
</TestRun>`;

const CONSOLE_FAIL =
  'Failed!  - Failed:     2, Passed:     3, Skipped:     1, Total:     6, Duration: 1 s';
const CONSOLE_PASS =
  'Passed!  - Failed:     0, Passed:     5, Skipped:     0, Total:     5, Duration: 1 s';

describe('parseTestOutput (TRX)', () => {
  test('parses an all-passing run', () => {
    const r = parseTestOutput(TRX_PASS);
    expect(r).toMatchObject({ passed: 3, failed: 0, total: 3 });
    expect(r.undefinedSteps).toEqual([]);
  });

  test('parses a failing run with assertion failures', () => {
    const r = parseTestOutput(TRX_FAIL);
    expect(r.failed).toBe(1);
    expect(r.passed).toBe(2);
  });

  test('detects pending + undefined steps (the red test-first state)', () => {
    const r = parseTestOutput(TRX_PENDING);
    expect(r.failed).toBe(2);
    expect(r.pending).toBeGreaterThanOrEqual(1);
    expect(r.undefinedSteps).toContain('LoginFeature.BadLogin');
  });
});

describe('parseTestOutput (console fallback)', () => {
  test('parses the dotnet test summary line', () => {
    const r = parseTestOutput(CONSOLE_FAIL);
    expect(r).toMatchObject({ failed: 2, passed: 3, skipped: 1, total: 6 });
  });
  test('parses a passing summary line', () => {
    expect(parseTestOutput(CONSOLE_PASS)).toMatchObject({ failed: 0, passed: 5, total: 5 });
  });
});

describe('isGreen', () => {
  test('green only when something passed and nothing failed/pending', () => {
    expect(isGreen(parseTestOutput(TRX_PASS))).toBe(true);
    expect(isGreen(parseTestOutput(TRX_FAIL))).toBe(false);
    expect(isGreen(parseTestOutput(TRX_PENDING))).toBe(false);
  });
  test('a run with zero tests is NOT green (nothing proven)', () => {
    expect(isGreen({ passed: 0, failed: 0, pending: 0, total: 0, undefinedSteps: [] })).toBe(false);
  });
});

describe('runTests', () => {
  test('removes a stale TRX before a non-zero dotnet run can be parsed as green', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-run-test-'));
    const trxPath = path.join(dir, 'reqnroll.trx');

    try {
      fs.writeFileSync(trxPath, TRX_PASS);

      const { result, exitCode } = runTests(dir);

      expect(exitCode).not.toBe(0);
      expect(isGreen(result)).toBe(false);
      expect(result).toMatchObject({ passed: 0, failed: 0, total: 0 });
      expect(fs.existsSync(trxPath)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
