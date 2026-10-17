'use strict';

/**
 * Tests for the JSON-in/JSON-out CLI wrapper (lib/pr-review-cli.js).
 *
 * The exported handler functions are exercised directly against the real
 * pr-review-*.js modules (no child process) for speed, plus a smoke test
 * via spawnSync proving the executable reads stdin JSON, prints JSON on
 * stdout, and the shell-invoked result equals the direct library call.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  runScope,
  runLedger,
  runRemote,
  runStatus,
  runStateRead,
  runStateWrite,
  LEDGER_ACTIONS,
  main,
} = require('../lib/pr-review-cli');

const { resolveReviewScope } = require('../lib/pr-review-scope');
const { evaluateRemoteReview } = require('../lib/pr-review-remote');
const { deriveStatus } = require('../lib/pr-review-status');

const CLI = path.join(__dirname, '..', 'lib', 'pr-review-cli.js');

// Full object ids -- scope only resolves these, never a bare ref or a short fake.
const BASE_SHA = '8b87a6d71146cd2e36e09c4fc265b6bb336f8798';
const HEAD_SHA = 'b8fe66aeb70b304237e584311a2b481a3c990f91';

/** Facts the grader reports REVIEW_COMPLETE for. Every fact is supplied because none defaults to "fine". */
function completeStatusFacts(overrides = {}) {
  return {
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    reviewedHeadSha: HEAD_SHA,
    findingCounts: { total: 0, actionable: 0, deferred: 0 },
    tests: { passed: true, skipped: false, command: 'npm test' },
    remotePhase: 'REMOTE_REVIEW_COMPLETE',
    ...overrides,
  };
}

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-cli-'));
}

function makeFinding(overrides = {}) {
  return {
    id: 'f1',
    source: 'coderabbit',
    locationOrLink: 'src/a.js:10',
    severity: 'major',
    failureMode: 'bug',
    disposition: 'fix',
    evidence: 'stack trace',
    originalTextOrLink: 'comment text',
    ...overrides,
  };
}

function captureStdout(fn) {
  const orig = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += String(chunk);
    return true;
  };
  let code;
  try {
    code = fn();
  } finally {
    process.stdout.write = orig;
  }
  return { code, captured };
}

function withStdin(jsonValue, fn) {
  const orig = fs.readFileSync;
  fs.readFileSync = (fd, enc) => {
    if (fd === 0) return typeof jsonValue === 'string' ? jsonValue : JSON.stringify(jsonValue);
    return orig(fd, enc);
  };
  try {
    return fn();
  } finally {
    fs.readFileSync = orig;
  }
}

describe('pr-review-cli: delegation to the matching module (handler functions)', () => {
  test('scope delegates to resolveReviewScope and returns its exact result', () => {
    const payload = { baseSha: BASE_SHA, headSha: HEAD_SHA };
    expect(runScope(payload)).toEqual(resolveReviewScope(payload));
    expect(runScope(payload)).toEqual({
      ok: true,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      range: `${BASE_SHA}..${HEAD_SHA}`,
    });
  });

  test('scope through the CLI handler rejects bare refs instead of resolving a moving range', () => {
    const result = runScope({ baseSha: 'main', headSha: 'HEAD' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.invalid).toEqual(['baseSha', 'headSha']);
    expect(result.range).toBeUndefined();
  });

  test('remote delegates to evaluateRemoteReview and returns its exact result', () => {
    const payload = {
      headSha: 'head-1',
      reviews: [{ id: 'r1', author: 'coderabbit[bot]', commitSha: 'head-1' }],
      comments: [],
      threads: [],
      checkRuns: [],
      botLogins: ['coderabbit[bot]'],
    };
    expect(runRemote(payload)).toEqual(evaluateRemoteReview(payload));
  });

  test('status delegates to deriveStatus and returns its exact result', () => {
    const payload = completeStatusFacts();
    expect(runStatus(payload)).toEqual(deriveStatus(payload));
    expect(runStatus(payload).status).toBe('REVIEW_COMPLETE');
  });

  test('status with no facts is blocked through the CLI handler, never complete', () => {
    const result = runStatus({});
    expect(result).toEqual(deriveStatus({}));
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(runStatus(null).localPhase).toBe('LOCAL_REVIEW_BLOCKED');
  });

  test('ledger validate action delegates to validateLedger', () => {
    const bad = makeFinding({ evidence: undefined });
    const result = runLedger({ action: 'validate', findings: [makeFinding(), bad] });
    expect(result.ok).toBe(false);
    expect(result.offendingIds).toEqual(['f1']);
  });

  test('ledger dedupe action delegates to dedupeFindings', () => {
    const dup = makeFinding({ id: 'f2' });
    const result = runLedger({ action: 'dedupe', findings: [makeFinding(), dup] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].originalLinks).toEqual(['comment text', 'comment text']);
  });

  test('ledger isActionable action delegates to isActionable', () => {
    expect(runLedger({ action: 'isActionable', finding: makeFinding({ severity: 'critical' }) })).toEqual({
      actionable: true,
    });
  });

  test('ledger merge action delegates to mergeFindings', () => {
    const existing = [makeFinding({ headSha: 'h1' })];
    const incoming = [makeFinding({ id: 'f2', locationOrLink: 'src/b.js:1', headSha: 'h1' })];
    const result = runLedger({ existingLedger: existing, incomingFindings: incoming, headSha: 'h1', action: 'merge' });
    expect(result.ledger.map((f) => f.id).sort()).toEqual(['f1', 'f2']);
  });

  test('ledger scopeViolations action delegates to scopeViolations', () => {
    const result = runLedger({
      action: 'scopeViolations',
      changedFiles: ['src/a.js', 'src/out-of-scope.js'],
      scope: ['src/a.js'],
      ledger: [],
    });
    expect(result.violations).toEqual(['src/out-of-scope.js']);
  });

  test('ledger with an unknown action throws naming the valid actions', () => {
    expect(() => runLedger({ action: 'bogus' })).toThrow(/Unknown ledger action 'bogus'/);
  });

  test('state-write then state-read for the same head returns the written report', () => {
    const cwd = tmpCwd();
    const written = runStateWrite({ prId: '42', cwd, state: { headSha: 'h1', ledger: [] } });
    expect(written.ok).toBe(true);
    const read = runStateRead({ prId: '42', cwd, headSha: 'h1' });
    expect(read.exists).toBe(true);
    expect(read.discarded).toBe(false);
  });

  test('state-read for a different head than was written discards the state', () => {
    const cwd = tmpCwd();
    runStateWrite({ prId: '42', cwd, state: { headSha: 'h-A', ledger: [] } });
    const read = runStateRead({ prId: '42', cwd, headSha: 'h-B' });
    expect(read.discarded).toBe(true);
    expect(read.state).toBeNull();
  });

  test('state-read of a corrupt report returns a structured not-ok result instead of throwing', () => {
    const cwd = tmpCwd();
    const written = runStateWrite({ prId: '42', cwd, state: { headSha: 'h1', ledger: [] } });
    fs.writeFileSync(written.path, '{"headSha":"h1","ledger":[');
    let read;
    expect(() => {
      read = runStateRead({ prId: '42', cwd, headSha: 'h1' });
    }).not.toThrow();
    expect(read.ok).toBe(false);
    expect(read.reason).toBe('corrupt');
  });
});

describe('pr-review-cli: main() dispatch, stdin parsing and error contract', () => {
  test('unknown subcommand prints a JSON error and exits non-zero', () => {
    const { code, captured } = captureStdout(() => main(['bogus-command']));
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/Unknown subcommand/);
  });

  test('unparseable JSON on stdin exits non-zero with a message and writes no state', () => {
    const cwd = tmpCwd();
    const { code, captured } = withStdin('{ not valid json', () =>
      captureStdout(() => main(['state-write']))
    );
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/invalid JSON on stdin/);
    expect(fs.readdirSync(cwd)).toHaveLength(0);
  });

  test('valid status payload on stdin prints the exact deriveStatus result and exits 0', () => {
    const payload = completeStatusFacts();
    const { code, captured } = withStdin(payload, () => captureStdout(() => main(['status'])));
    expect(code).toBe(0);
    expect(JSON.parse(captured)).toEqual(deriveStatus(payload));
  });
});

describe('pr-review-cli: executable smoke test (child_process) -- shell invocation equals direct call', () => {
  test('node pr-review-cli.js status < payload -> exit 0, stdout JSON equals deriveStatus(payload) directly', () => {
    const payload = completeStatusFacts();
    const res = spawnSync('node', [CLI, 'status'], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toEqual(deriveStatus(payload));
  });

  test('node pr-review-cli.js scope < payload -> stdout JSON equals resolveReviewScope(payload) directly', () => {
    const payload = { baseSha: BASE_SHA, headSha: HEAD_SHA };
    const res = spawnSync('node', [CLI, 'scope'], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(resolveReviewScope(payload));
    expect(JSON.parse(res.stdout).ok).toBe(true);
  });

  test('node pr-review-cli.js with unparseable stdin -> exit 1 and a single JSON {error}, no stray stdout', () => {
    const res = spawnSync('node', [CLI, 'status'], {
      input: 'not json at all',
      encoding: 'utf8',
    });
    expect(res.status).toBe(1);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.error).toMatch(/invalid JSON on stdin/);
  });

  test('node pr-review-cli.js with no subcommand -> exit 1 and JSON {error}', () => {
    const res = spawnSync('node', [CLI], { input: '{}', encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).error).toMatch(/Unknown subcommand/);
  });
});

describe('pr-review-cli: bounded latency and no network access', () => {
  test('a 200-finding ledger validate and a 50-review remote payload each complete through the CLI handlers in under 1 second', () => {
    const findings = Array.from({ length: 200 }, (_, i) => makeFinding({ id: `f${i}`, locationOrLink: `src/f${i}.js:1` }));
    const reviews = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      author: 'coderabbit[bot]',
      commitSha: 'head-1',
      state: 'commented',
    }));

    const ledgerStart = Date.now();
    const ledgerResult = runLedger({ action: 'validate', findings });
    const ledgerElapsed = Date.now() - ledgerStart;
    expect(ledgerResult.ok).toBe(true);
    expect(ledgerElapsed).toBeLessThan(1000);

    const remoteStart = Date.now();
    const remoteResult = runRemote({ headSha: 'head-1', reviews, comments: [], threads: [], checkRuns: [], botLogins: ['coderabbit[bot]'] });
    const remoteElapsed = Date.now() - remoteStart;
    expect(remoteResult.remotePhase).toBe('REMOTE_REVIEW_COMPLETE');
    expect(remoteElapsed).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Round 2. Names are matched as own properties only, and a request parameter
// that is missing, misspelt or of the wrong type is a CLI error -- never an
// empty default that lets a clean result through.
// ---------------------------------------------------------------------------

/** Names every object inherits. None of them is a subcommand or a ledger action. */
const INHERITED_NAMES = [
  'constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
  '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
];

/** What a payload can carry where something else was expected. */
const WRONG_VALUES = [undefined, null, '', '   ', 0, 1, -1, 0.5, NaN, true, false, 'x', {}, [], [[]], ['x'], [null]];

/** One complete payload per ledger action, and the kind each of its keys must be. */
const LEDGER_PAYLOADS = {
  validate: { action: 'validate', findings: [makeFinding()] },
  isActionable: { action: 'isActionable', finding: makeFinding() },
  dedupe: { action: 'dedupe', findings: [makeFinding()] },
  merge: {
    action: 'merge',
    existingLedger: [],
    incomingFindings: [makeFinding({ headSha: 'h1' })],
    headSha: 'h1',
  },
  scopeViolations: { action: 'scopeViolations', changedFiles: ['src/a.js'], scope: ['src/a.js'], ledger: [] },
};
const KEY_KINDS = {
  findings: 'array',
  finding: 'object',
  existingLedger: 'array',
  incomingFindings: 'array',
  headSha: 'text',
  changedFiles: 'array',
  scope: 'array',
  ledger: 'array',
};
const KEY_CASES = Object.entries(LEDGER_PAYLOADS).flatMap(([action, payload]) =>
  Object.keys(payload)
    .filter((key) => key !== 'action')
    .map((key) => [action, key])
);
const isKind = {
  array: (value) => Array.isArray(value),
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  text: (value) => typeof value === 'string' && value.trim() !== '',
};
const outcomeOf = (fn) => {
  try {
    fn();
    return 'returned';
  } catch {
    return 'threw';
  }
};

describe('pr-review-cli: subcommands and ledger actions are matched as own properties only', () => {
  test.each(INHERITED_NAMES)('%s is an unknown subcommand: exit 1, an error, no handler called', (name) => {
    const { code, captured } = captureStdout(() => main([name]));
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/Unknown subcommand/);
  });

  test.each([
    ['no arguments', []],
    ['argv that is not an array', 'status'],
    ['argv that is undefined', undefined],
    ['argv that is null', null],
    ['an empty subcommand', ['']],
    ['a numeric subcommand', [5]],
    ['a null subcommand', [null]],
    ['an array subcommand', [['status']]],
    ['a padded subcommand', [' status']],
    ['an upper-case subcommand', ['STATUS']],
    ['an underscore typo of a state subcommand', ['state_read']],
  ])('%s is an unknown subcommand', (_label, argv) => {
    const { code, captured } = captureStdout(() => main(argv));
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/Unknown subcommand/);
  });

  test.each(INHERITED_NAMES)('%s is an unknown ledger action, not an echo of the payload', (name) => {
    expect(() => runLedger({ action: name, findings: [] })).toThrow(/Unknown ledger action/);
  });

  test.each([
    ['an array', ['validate']],
    ['a number', 5],
    ['null', null],
    ['a boolean', true],
    ['an object', { name: 'validate' }],
    ['an empty string', ''],
    ['a padded name', ' validate'],
    ['an upper-case name', 'VALIDATE'],
    ['the hyphenated spelling the skill once documented', 'scope-violations'],
    ['a snake-case spelling', 'scope_violations'],
    ['an absent action', undefined],
  ])('a ledger action that is %s is unknown', (_label, action) => {
    expect(() => runLedger({ action, findings: [], changedFiles: [], scope: [], ledger: [] })).toThrow(/Unknown ledger action/);
  });

  test('the ledger actions are exactly the documented five', () => {
    expect(Object.keys(LEDGER_ACTIONS).sort()).toEqual(['dedupe', 'isActionable', 'merge', 'scopeViolations', 'validate']);
  });
});

describe('pr-review-cli: a ledger payload must carry every key of its action', () => {
  test('every action has a complete payload here, and no payload is for an unknown action', () => {
    expect(Object.keys(LEDGER_PAYLOADS).sort()).toEqual(Object.keys(LEDGER_ACTIONS).sort());
  });

  test.each(Object.keys(LEDGER_PAYLOADS))('%s accepts its complete payload', (action) => {
    expect(() => runLedger(LEDGER_PAYLOADS[action])).not.toThrow();
  });

  test.each(KEY_CASES)('%s without %s is an error naming the key, not a clean result', (action, key) => {
    const payload = { ...LEDGER_PAYLOADS[action] };
    delete payload[key];
    expect(() => runLedger(payload)).toThrow(new RegExp(`'${key}'`));
  });

  test.each(KEY_CASES)('%s with %s misspelt is an error, however close the spelling', (action, key) => {
    for (const misspelt of [key.toUpperCase(), `${key}s`, key.slice(0, -1), ` ${key}`, `${key}_`]) {
      const payload = { ...LEDGER_PAYLOADS[action] };
      payload[misspelt] = payload[key];
      delete payload[key];
      expect([misspelt, outcomeOf(() => runLedger(payload))]).toEqual([misspelt, 'threw']);
    }
  });

  test.each(KEY_CASES)('%s with a %s of the wrong kind is an error', (action, key) => {
    const kind = KEY_KINDS[key];
    const wrong = WRONG_VALUES.filter((value) => value !== undefined && !isKind[kind](value));
    expect(wrong.length).toBeGreaterThan(5);
    for (const value of wrong) {
      const payload = { ...LEDGER_PAYLOADS[action], [key]: value };
      expect([key, value, outcomeOf(() => runLedger(payload))]).toEqual([key, value, 'threw']);
    }
  });

  test('a payload that is not an object is an error, not an unknown action', () => {
    for (const payload of [null, undefined, [], 'validate', 5, true]) {
      expect(() => runLedger(payload)).toThrow(/ledger payload must be a JSON object/);
    }
  });

  test('the payload that used to come back clean from the CLI is now an error', () => {
    const { code, captured } = withStdin({ action: 'validate' }, () => captureStdout(() => main(['ledger'])));
    expect(code).toBe(1);
    expect(JSON.parse(captured).error).toMatch(/findings/);
  });

  test('findings inside a payload that cannot be read are an error for dedupe, merge and scopeViolations', () => {
    expect(() => runLedger({ action: 'dedupe', findings: [null] })).toThrow();
    expect(() => runLedger({ action: 'merge', existingLedger: [5], incomingFindings: [], headSha: 'h1' })).toThrow();
    expect(() => runLedger({ action: 'merge', existingLedger: [], incomingFindings: ['x'], headSha: 'h1' })).toThrow();
    expect(() => runLedger({ action: 'scopeViolations', changedFiles: [5], scope: [], ledger: [] })).toThrow();
    expect(() => runLedger({ action: 'scopeViolations', changedFiles: [], scope: [], ledger: [null] })).toThrow();
  });

  test('validate grades the findings in-band: an unreadable entry is an invalid ledger, reported, not an error', () => {
    const result = runLedger({ action: 'validate', findings: [makeFinding(), null] });
    expect(result.ok).toBe(false);
    expect(result.offendingIds).toHaveLength(1);
  });

  test('an unreadable finding is reported actionable through the CLI too', () => {
    expect(runLedger({ action: 'isActionable', finding: {} })).toEqual({ actionable: true });
  });
});

describe('pr-review-cli: state commands need their request parameters', () => {
  test.each([undefined, null, '', '   ', 0, 5, true, {}, [], ['h1']])('state-read with a headSha of %p is an error', (headSha) => {
    const cwd = tmpCwd();
    runStateWrite({ prId: '42', cwd, state: { headSha: 'h1', ledger: [] } });
    expect(() => runStateRead({ prId: '42', cwd, headSha })).toThrow(/headSha/);
  });

  test('state-read without the headSha key is an error, not a resume for any head', () => {
    const cwd = tmpCwd();
    runStateWrite({ prId: '42', cwd, state: { ledger: [{ id: 'f1', disposition: 'fix' }] } });
    expect(() => runStateRead({ prId: '42', cwd })).toThrow(/requires payload key 'headSha'/);
  });

  test.each([undefined, null, 'x', 5, true, [], [{ headSha: 'h1' }]])('state-write with a state of %p is an error and writes nothing', (state) => {
    const cwd = tmpCwd();
    expect(() => runStateWrite({ prId: '42', cwd, state })).toThrow(/state/);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test('state-write without the state key is an error and writes nothing', () => {
    const cwd = tmpCwd();
    expect(() => runStateWrite({ prId: '42', cwd })).toThrow(/requires payload key 'state'/);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test.each([null, '', '   ', 0, 5, true, false, {}, [], ['42']])('a prId of %p is an error', (prId) => {
    const cwd = tmpCwd();
    expect(() => runStateRead({ prId, cwd, headSha: 'h1' })).toThrow();
    expect(() => runStateWrite({ prId, cwd, state: { headSha: 'h1' } })).toThrow();
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  test.each([null, '', '   ', 0, 5, true, false, {}, [], ['x']])('a targetPath of %p is an error, not a fall-through to prId', (targetPath) => {
    const cwd = tmpCwd();
    expect(() => runStateRead({ targetPath, prId: '42', cwd, headSha: 'h1' })).toThrow(/targetPath/);
    expect(() => runStateWrite({ targetPath, prId: '42', cwd, state: { headSha: 'h1' } })).toThrow(/targetPath/);
  });

  test.each([null, '', '   ', 0, 5, true, {}, [], ['x']])('a cwd of %p is an error', (cwd) => {
    expect(() => runStateRead({ prId: '42', cwd, headSha: 'h1' })).toThrow(/cwd/);
    expect(() => runStateWrite({ prId: '42', cwd, state: { headSha: 'h1' } })).toThrow(/cwd/);
  });

  test('neither a targetPath nor a prId is an error, and so is a payload that is not an object', () => {
    expect(() => runStateRead({ headSha: 'h1' })).toThrow(/requires targetPath or prId/);
    expect(() => runStateWrite({ state: { headSha: 'h1' } })).toThrow(/requires targetPath or prId/);
    for (const payload of [null, undefined, [], 'x', 5, true]) {
      expect(() => runStateRead(payload)).toThrow(/payload must be a JSON object/);
      expect(() => runStateWrite(payload)).toThrow(/payload must be a JSON object/);
    }
  });

  test('an explicit targetPath still wins over a prId, and a good request still round-trips', () => {
    const cwd = tmpCwd();
    const targetPath = path.join('.ensemble', 'pr-review', 'explicit.json');
    expect(runStateWrite({ targetPath, prId: 'other', cwd, state: { headSha: 'h1', ledger: [] } }).ok).toBe(true);
    expect(runStateRead({ targetPath, cwd, headSha: 'h1' }).discarded).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.ensemble', 'pr-review', 'pr-other.json'))).toBe(false);
  });
});

describe('pr-review-cli: the graded subcommands pass any payload through to their module', () => {
  test.each([null, undefined, [], 'x', 5, true, false, {}])('scope, remote and status of %p equal the module called directly', (payload) => {
    expect(runScope(payload)).toEqual(resolveReviewScope(payload));
    expect(runRemote(payload)).toEqual(evaluateRemoteReview(payload));
    expect(runStatus(payload)).toEqual(deriveStatus(payload));
  });
});

describe('pr-review-cli: adversarial sweep over every subcommand -- no invalid payload completes anything', () => {
  // JSON text of payloads that are not an object or are an empty one.
  const PAYLOADS = ['null', '[]', '"x"', '5', 'true', 'false', '{}', '[{}]', '{"__proto__":{"action":"validate"}}', '{"constructor":{"prototype":{}}}'];

  const run = (subcommand, json) => {
    const { code, captured } = withStdin(json, () => captureStdout(() => main([subcommand])));
    return { code, result: JSON.parse(captured) };
  };

  test.each(PAYLOADS)('scope %s: never ok', (json) => {
    const { code, result } = run('scope', json);
    expect(code).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.range).toBeUndefined();
  });

  test.each(PAYLOADS)('remote %s: never complete', (json) => {
    const { code, result } = run('remote', json);
    expect(code).toBe(0);
    expect(result.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  test.each(PAYLOADS)('status %s: blocked, never complete', (json) => {
    const { code, result } = run('status', json);
    expect(code).toBe(0);
    expect(result.status).toBe('REVIEW_BLOCKED');
    expect(result.localPhase).toBe('LOCAL_REVIEW_BLOCKED');
    expect(result.remotePhase).not.toBe('REMOTE_REVIEW_COMPLETE');
  });

  test.each(PAYLOADS)('ledger %s: an error, never a result', (json) => {
    const { code, result } = run('ledger', json);
    expect(code).toBe(1);
    expect(typeof result.error).toBe('string');
  });

  test.each(['state-read', 'state-write'])('%s with every one of those payloads is an error that writes nothing', (subcommand) => {
    for (const json of PAYLOADS) {
      const { code, result } = run(subcommand, json);
      expect([subcommand, json, code]).toEqual([subcommand, json, 1]);
      expect(typeof result.error).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Round 3. The local review is bound to a SNAPSHOT commit and PR creation then makes the one real commit, so the remote run
// names a different head holding the same tree. status, state-write and state-read carry the tree facts end to end.
// ---------------------------------------------------------------------------

describe('pr-review-cli: tree facts carry a locally reviewed snapshot through to the published commit', () => {
  const { readState } = require('../lib/pr-review-state');

  // The reviewed snapshot (S) and the commit PR creation made (P) are different commits; T is the one tree they share.
  const S = 'a'.repeat(40);
  const P = HEAD_SHA;
  const T = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const T2 = '9daeafb9864cf43055ae93beb0afd6c7d144bfa4';
  const LEDGER = [makeFinding({ id: 'f1', disposition: 'fix' })];

  /** The local-phase facts, remote still to come: head and reviewed head are the snapshot. */
  const localFacts = (overrides = {}) =>
    completeStatusFacts({ headSha: S, reviewedHeadSha: S, reviewedTreeSha: T, remotePhase: undefined, ...overrides });

  /** The remote-phase facts, as the skill builds them from the recorded report: the pushed head, the recorded reviewed head. */
  const remoteFacts = (recorded, overrides = {}) =>
    completeStatusFacts({
      baseSha: recorded.baseSha,
      headSha: P,
      headTreeSha: T,
      reviewedHeadSha: recorded.reviewedHeadSha,
      reviewedTreeSha: recorded.reviewedTreeSha,
      findingCounts: recorded.findingCounts,
      tests: recorded.tests,
      remotePhase: 'REMOTE_REVIEW_COMPLETE',
      ...overrides,
    });

  test('status delegates the tree facts to the grader: an identical tree under a different head completes', () => {
    const payload = completeStatusFacts({ headSha: P, reviewedHeadSha: S, reviewedTreeSha: T, headTreeSha: T });
    expect(runStatus(payload)).toEqual(deriveStatus(payload));
    expect(runStatus(payload)).toMatchObject({ status: 'REVIEW_COMPLETE', localPhase: 'LOCAL_REVIEW_COMPLETE' });
  });

  test('status with a different tree is stale, and with an unreadable one is blocked: never complete', () => {
    const stale = runStatus(completeStatusFacts({ headSha: P, reviewedHeadSha: S, reviewedTreeSha: T, headTreeSha: T2 }));
    expect([stale.status, stale.localPhase, stale.next]).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 're-run-review-for-current-head']);
    const blocked = runStatus(completeStatusFacts({ headSha: P, reviewedHeadSha: S, reviewedTreeSha: T, headTreeSha: 'HEAD^{tree}' }));
    expect([blocked.status, blocked.localPhase, blocked.next]).toEqual(['REVIEW_BLOCKED', 'LOCAL_REVIEW_BLOCKED', 'supply-review-facts']);
  });

  test('the local result is recordable and resumes under the published head: local -> publish -> remote reaches REVIEW_COMPLETE', () => {
    const cwd = tmpCwd();

    // Local phase: graded for the snapshot, remote not yet. The skill records the full result.
    const local = runStatus(localFacts());
    expect([local.status, local.localPhase]).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_COMPLETE']);
    expect(runStateWrite({ prId: '42', cwd, state: { ...local, ledger: LEDGER } }).ok).toBe(true);

    // Remote phase: the head is the real commit, so the head differs; its tree is the reviewed tree.
    const read = runStateRead({ prId: '42', cwd, headSha: P, treeSha: T });
    expect(read).toMatchObject({ ok: true, exists: true, discarded: false });
    expect(read.dispositionedFindings.map((finding) => finding.id)).toEqual(['f1']);
    expect([read.state.reviewedHeadSha, read.state.reviewedTreeSha]).toEqual([S, T]);

    const remote = runStatus(remoteFacts(read.state));
    expect([remote.status, remote.localPhase, remote.remotePhase]).toEqual(['REVIEW_COMPLETE', 'LOCAL_REVIEW_COMPLETE', 'REMOTE_REVIEW_COMPLETE']);
  });

  test('the same flow with a changed tree is stale at every step: the report is not resumed and the review cannot complete', () => {
    const cwd = tmpCwd();
    const local = runStatus(localFacts());
    runStateWrite({ prId: '42', cwd, state: { ...local, ledger: LEDGER } });

    // The commit PR creation made holds different content: nothing recorded carries forward.
    const read = runStateRead({ prId: '42', cwd, headSha: P, treeSha: T2 });
    expect(read).toMatchObject({ ok: true, exists: true, discarded: true, state: null, dispositionedFindings: [] });

    // ... and a grader handed the stale recorded facts anyway still refuses to complete.
    const remote = runStatus(remoteFacts(local, { headTreeSha: T2 }));
    expect([remote.status, remote.localPhase, remote.next]).toEqual(['REVIEW_PENDING', 'LOCAL_REVIEW_PENDING', 're-run-review-for-current-head']);
  });

  test('a blocked local result can still be recorded and read back: an unreadable tree is not carried into the report', () => {
    const cwd = tmpCwd();
    const blocked = runStatus(localFacts({ reviewedTreeSha: 'HEAD^{tree}' }));
    expect(blocked.status).toBe('REVIEW_BLOCKED');
    expect(runStateWrite({ prId: '42', cwd, state: blocked }).ok).toBe(true);
    const read = runStateRead({ prId: '42', cwd, headSha: S });
    expect([read.discarded, read.state.reviewedTreeSha]).toEqual([false, null]);
  });

  describe('state-read treeSha', () => {
    const seed = (cwd) => runStateWrite({ prId: '42', cwd, state: { headSha: S, reviewedHeadSha: S, reviewedTreeSha: T, ledger: LEDGER } });

    test('is optional: without it a different head is discarded and the same head resumes, exactly as before', () => {
      const cwd = tmpCwd();
      seed(cwd);
      expect(runStateRead({ prId: '42', cwd, headSha: P }).discarded).toBe(true);
      expect(runStateRead({ prId: '42', cwd, headSha: S }).discarded).toBe(false);
    });

    test('resumes a different head only for the identical tree, and is passed through to the module unchanged', () => {
      const cwd = tmpCwd();
      seed(cwd);
      for (const [treeSha, discarded] of [[T, false], [T2, true], [T.toUpperCase(), true], ['main', true]]) {
        const result = runStateRead({ prId: '42', cwd, headSha: P, treeSha });
        expect([treeSha, result.discarded]).toEqual([treeSha, discarded]);
        expect(result).toEqual(readState(path.join(cwd, '.ensemble', 'pr-review', 'pr-42.json'), P, { cwd, treeSha }));
      }
    });

    test.each([null, '', '   ', 0, 5, true, false, {}, [], ['x'], [T]])('a treeSha of %p is an error naming it, not a silent head-only resume', (treeSha) => {
      const cwd = tmpCwd();
      seed(cwd);
      expect(() => runStateRead({ prId: '42', cwd, headSha: S, treeSha })).toThrow(/treeSha/);
    });

    test('a misspelt tree key is not read as a tree: the report is discarded for the different head', () => {
      const cwd = tmpCwd();
      seed(cwd);
      for (const key of ['treeSHA', 'tree', 'headTreeSha', 'reviewedTreeSha']) {
        expect([key, runStateRead({ prId: '42', cwd, headSha: P, [key]: T }).discarded]).toEqual([key, true]);
      }
    });

    test('headSha stays required beside a tree', () => {
      const cwd = tmpCwd();
      seed(cwd);
      expect(() => runStateRead({ prId: '42', cwd, treeSha: T })).toThrow(/requires payload key 'headSha'/);
    });
  });

  describe('state-write reviewedTreeSha', () => {
    test('a report whose reviewedTreeSha is not a full object id is refused as a result, writes nothing, and keeps the old report', () => {
      const cwd = tmpCwd();
      expect(runStateWrite({ prId: '42', cwd, state: { headSha: S, reviewedTreeSha: T } }).ok).toBe(true);
      const target = path.join(cwd, '.ensemble', 'pr-review', 'pr-42.json');
      const before = fs.readFileSync(target, 'utf8');

      for (const bad of ['main', '', ` ${T}`, 5, [T], {}]) {
        const refused = runStateWrite({ prId: '42', cwd, state: { headSha: P, reviewedTreeSha: bad } });
        expect([JSON.stringify(bad), refused.ok]).toEqual([JSON.stringify(bad), false]);
        expect(refused.reason).toContain('reviewedTreeSha');
      }
      expect(fs.readFileSync(target, 'utf8')).toBe(before);
    });

    test('a report with no tree, or a null one, is still written', () => {
      const cwd = tmpCwd();
      expect(runStateWrite({ prId: '42', cwd, state: { headSha: S, ledger: [] } }).ok).toBe(true);
      expect(runStateWrite({ prId: '43', cwd, state: { headSha: S, reviewedTreeSha: null, ledger: [] } }).ok).toBe(true);
    });
  });
});
