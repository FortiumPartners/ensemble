'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const cp = require('child_process');

const { parseTestOutput, isGreen, runTests, normalizeFilter } = require('../lib/reqnroll-run');

// The wrapper calls `execFileSync('dotnet', args, ...)`; spy on it so the argv it
// hands to dotnet can be asserted without a .NET SDK.
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return { ...actual, execFileSync: jest.fn(actual.execFileSync) };
});

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

// `dotnet test` reads an argument starting with '@' as a RESPONSE FILE, prints
// usage and exits 1 having run nothing, so the red/green loop saw every
// scenario as red. These tests assert the argv handed to the spawn (no SDK needed).
describe('runTests --filter argument vector', () => {
  let captured = null;
  let dir = null;

  beforeEach(() => {
    captured = null;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-filter-'));
    cp.execFileSync.mockImplementation((cmd, args) => {
      captured = { cmd, args };
      const err = new Error('stubbed dotnet run');
      err.status = 0;
      err.stdout = '';
      err.stderr = '';
      throw err;
    });
  });

  afterEach(() => {
    cp.execFileSync.mockReset();
    cp.execFileSync.mockImplementation(jest.requireActual('child_process').execFileSync);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const filterArg = (opts) => {
    runTests(dir, opts);
    const i = captured.args.indexOf('--filter');
    return i === -1 ? null : captured.args[i + 1];
  };

  test('a bare @<AC-id> tag becomes Category=<AC-id>', () => {
    expect(filterArg({ filter: '@AC-001-1' })).toBe('Category=AC-001-1');
  });

  test('an explicit Category= expression is passed through unchanged', () => {
    expect(filterArg({ filter: 'Category=AC-001-1' })).toBe('Category=AC-001-1');
  });

  test('a FullyQualifiedName~ expression is passed through unchanged', () => {
    expect(filterArg({ filter: 'FullyQualifiedName~Foo' })).toBe('FullyQualifiedName~Foo');
  });

  test('a compound expression is passed through unchanged', () => {
    expect(filterArg({ filter: 'Category=AC-001-1&Priority=1' })).toBe(
      'Category=AC-001-1&Priority=1'
    );
  });

  test('no filter means no --filter argument at all', () => {
    runTests(dir);
    expect(captured.args).not.toContain('--filter');
  });

  test('the normalised filter is the only thing dotnet ever sees', () => {
    runTests(dir, { filter: '@AC-001-1' });
    expect(captured.args).not.toContain('@AC-001-1');
  });

  test('a blank filter produces no --filter argument', () => {
    runTests(dir, { filter: '   ' });
    expect(captured.args).not.toContain('--filter');
  });

  test('a compound filter arrives as ONE argument, never split on | or &', () => {
    const arg = filterArg({ filter: 'Category=A|Category=B' });
    expect(arg).toBe('Category=A|Category=B');
    expect(captured.args.filter((a) => a.includes('Category='))).toHaveLength(1);
  });

  test('every tag in a compound filter is rewritten, not only the first', () => {
    expect(filterArg({ filter: '@AC-001-1|@AC-001-2' })).toBe(
      'Category=AC-001-1|Category=AC-001-2'
    );
  });

  test('a tag mixed into an existing expression is rewritten too', () => {
    expect(filterArg({ filter: 'Category=AC-001-1|@AC-001-2' })).toBe(
      'Category=AC-001-1|Category=AC-001-2'
    );
  });

  test('the filter is trimmed before it is normalised', () => {
    expect(filterArg({ filter: '  @AC-001-1  ' })).toBe('Category=AC-001-1');
  });

  test('a filter that cannot be expressed fails loudly instead of running zero tests', () => {
    expect(() => runTests(dir, { filter: '@AC-001-1 @AC-001-2' })).toThrow(/response file/);
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  test('a negated tag never reaches dotnet as a filter that matches nothing', () => {
    expect(() => runTests(dir, { filter: '!@AC-001-1' })).toThrow(/negation is written/);
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });
});

describe('normalizeFilter', () => {
  test.each([
    ['@AC-001-1', 'Category=AC-001-1'],
    ['@needs-clarification', 'Category=needs-clarification'],
    // A plain word is a valid VSTest filter (it matches the test's full name),
    // so it must NOT be rewritten into Category=<word>.
    ['AC-001-1', 'AC-001-1'],
    ['PRDSample', 'PRDSample'],
    ['Category=AC-001-1', 'Category=AC-001-1'],
    ['FullyQualifiedName~Foo', 'FullyQualifiedName~Foo'],
    ['Category=A|Category=B', 'Category=A|Category=B'],
    ['TestCategory!=AC-001-1', 'TestCategory!=AC-001-1'],
    // Every tag operand is rewritten, so compound filters keep working.
    ['@AC-001-1|@AC-001-2', 'Category=AC-001-1|Category=AC-001-2'],
    ['Category=AC-001-1|@AC-001-2', 'Category=AC-001-1|Category=AC-001-2'],
    // An `@` that is not at the start of a condition is part of a value.
    ['FullyQualifiedName~@weird', 'FullyQualifiedName~@weird'],
    ['  @AC-001-1  ', 'Category=AC-001-1'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeFilter(input)).toBe(expected);
  });

  test('no filter at all means no filter expression', () => {
    expect(normalizeFilter(undefined)).toBeNull();
    expect(normalizeFilter(null)).toBeNull();
    expect(normalizeFilter('')).toBeNull();
    expect(normalizeFilter('   ')).toBeNull();
  });

  test.each(['@AC-001-1 @AC-001-2', 'Category=AC-001-1 @AC-001-2', '@'])(
    '%s is rejected: dotnet would read it as a response file',
    (input) => {
      expect(() => normalizeFilter(input)).toThrow(/response file/);
    }
  );

  test('a negated tag is rejected: dotnet has no standalone "!" operator', () => {
    expect(() => normalizeFilter('!@AC-001-1')).toThrow(/negation is written/);
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
