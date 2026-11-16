'use strict';

// TRD-021-TEST: Jest coverage for ac-gap-task-filer.js's implementing-author
// resolution and confirmed-AC-gap Task filing (REQ-010). AC references:
//   - AC-010-1: a filed Task's description carries the confirmed gap AND the
//     refine-trd -> implement-trd-tasks resolution suggestion.
//   - AC-010-2: two gaps confirmed in one session produce two
//     independently-tracked Tasks -- never bundled into one.

const fs = require('fs');
const path = require('path');

const {
  resolveImplementingAuthor,
  planGapTaskFiling,
  recordFiledGapTask,
  buildGapTaskTitle,
} = require('../lib/ac-gap-task-filer');

const LIB_SOURCE = fs.readFileSync(path.join(__dirname, '../lib/ac-gap-task-filer.js'), 'utf8');

const AUTHOR_LOG_ARGS = (file) => ['log', '-1', '--format=%an|%ae|%at', '--', file];

describe('resolveImplementingAuthor', () => {
  test('single file resolves correctly, gitExec invoked with the exact argv array', () => {
    const gitExec = jest.fn((args) => {
      expect(args).toEqual(AUTHOR_LOG_ARGS('src/handlers/submitClaim.js'));
      return 'Ada Lovelace|ada@example.com|1000\n';
    });

    expect(resolveImplementingAuthor(['src/handlers/submitClaim.js'], { gitExec })).toEqual({
      resolved: true,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      file: 'src/handlers/submitClaim.js',
    });
    expect(gitExec).toHaveBeenCalledTimes(1);
  });

  test('multiple files, different authors/timestamps -> the single MOST RECENT commit author wins', () => {
    const gitExec = jest.fn((args) => {
      const file = args[args.length - 1];
      if (file === 'src/old.js') return 'Old Author|old@example.com|500\n';
      if (file === 'src/new.js') return 'New Author|new@example.com|9999\n';
      throw new Error(`unexpected file: ${file}`);
    });

    // files listed oldest-first...
    expect(resolveImplementingAuthor(['src/old.js', 'src/new.js'], { gitExec })).toEqual({
      resolved: true,
      name: 'New Author',
      email: 'new@example.com',
      file: 'src/new.js',
    });

    // ...and newest-first: proves the winner is the most-recent TIMESTAMP,
    // not simply "the last file in the array" or "the first file".
    expect(resolveImplementingAuthor(['src/new.js', 'src/old.js'], { gitExec })).toEqual({
      resolved: true,
      name: 'New Author',
      email: 'new@example.com',
      file: 'src/new.js',
    });
  });

  test('an untracked file (gitExec throws) among otherwise-resolvable files degrades gracefully -- the resolvable file still wins', () => {
    const gitExec = jest.fn((args) => {
      const file = args[args.length - 1];
      if (file === 'src/untracked.js') throw new Error('fatal: no such path in HEAD');
      return 'Sole Author|sole@example.com|42\n';
    });

    expect(resolveImplementingAuthor(['src/untracked.js', 'src/tracked.js'], { gitExec })).toEqual({
      resolved: true,
      name: 'Sole Author',
      email: 'sole@example.com',
      file: 'src/tracked.js',
    });
  });

  test('gitExec throwing for every file -> {resolved: false, reason}, never throws', () => {
    const gitExec = jest.fn(() => {
      throw new Error('git not available');
    });

    expect(() => resolveImplementingAuthor(['src/gone.js'], { gitExec })).not.toThrow();
    const result = resolveImplementingAuthor(['src/gone.js'], { gitExec });
    expect(result).toEqual({
      resolved: false,
      reason: 'Could not resolve a commit author for any of: src/gone.js',
    });
  });

  test('an unexpected log line shape (missing fields) is treated as unresolved for that file, not a crash', () => {
    const gitExec = jest.fn(() => 'not-enough-parts\n');
    const result = resolveImplementingAuthor(['src/weird.js'], { gitExec });
    expect(result.resolved).toBe(false);
  });

  test.each([
    ['not an array', 'src/a.js'],
    ['null', null],
    ['an empty array', []],
    ['an array with a non-string entry', ['src/a.js', 42]],
    ['an array with a whitespace-only entry', ['src/a.js', '   ']],
  ])('rejects malformed targetFiles (%s) -- {resolved: false}, never throws', (_label, targetFiles) => {
    expect(() => resolveImplementingAuthor(targetFiles)).not.toThrow();
    expect(resolveImplementingAuthor(targetFiles).resolved).toBe(false);
  });

  test('a shell-metacharacter filename is passed to gitExec as a single, intact argv element -- never shell-interpreted', () => {
    const metaFile = 'src/foo; rm -rf / && echo pwned`whoami`.js';
    const gitExec = jest.fn(() => 'Author|author@example.com|1000\n');

    resolveImplementingAuthor([metaFile], { gitExec });

    expect(gitExec).toHaveBeenCalledWith(['log', '-1', '--format=%an|%ae|%at', '--', metaFile]);
    const receivedArgs = gitExec.mock.calls[0][0];
    expect(receivedArgs).toHaveLength(5);
    expect(receivedArgs[receivedArgs.length - 1]).toBe(metaFile); // intact, not split/expanded
  });
});

describe('planGapTaskFiling', () => {
  const resolvedAuthor = { resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' };

  test('full valid input -> exact Task shape, including a deterministic title', () => {
    const filed = planGapTaskFiling({
      acId: 'AC-009-1',
      reqId: 'REQ-009',
      gapReason: 'handler is a 501 stub; described validation logic does not exist yet',
      storyWorkItemId: 4821,
      author: resolvedAuthor,
    });

    expect(filed).toEqual({
      title: buildGapTaskTitle('AC-009-1', 'REQ-009'),
      description:
        'Playwright test authoring for AC-009-1 (REQ-009) found a confirmed implementation gap:\n\n' +
        'handler is a 501 stub; described validation logic does not exist yet\n\n' +
        'Suggested resolution: run `refine-trd` to update the TRD so this gap is captured as a task, ' +
        'then `implement-trd-tasks` to implement the fix (a `refine-trd` -> `implement-trd-tasks` cycle).',
      assignedTo: { resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' },
      parentWorkItemId: '4821',
      acId: 'AC-009-1',
      reqId: 'REQ-009',
    });
    // every field genuinely present, not silently dropped
    for (const key of ['title', 'description', 'assignedTo', 'parentWorkItemId', 'acId', 'reqId']) {
      expect(filed[key]).not.toBeUndefined();
    }
  });

  test('AC-010-1: description carries the refine-trd -> implement-trd-tasks suggestion, in that order', () => {
    const filed = planGapTaskFiling({
      acId: 'AC-009-1',
      reqId: 'REQ-009',
      gapReason: 'x',
      storyWorkItemId: 1,
      author: resolvedAuthor,
    });

    expect(filed.description).toMatch(/run `refine-trd` to update the TRD/);
    expect(filed.description).toMatch(/then `implement-trd-tasks` to implement the fix/);
    expect(filed.description).toMatch(/`refine-trd` -> `implement-trd-tasks` cycle/);
    expect(filed.description.indexOf('refine-trd')).toBeLessThan(filed.description.indexOf('implement-trd-tasks'));
  });

  test('resolved author -> assignedTo carries name/email as-is', () => {
    const filed = planGapTaskFiling({
      acId: 'AC-009-1',
      reqId: 'REQ-009',
      gapReason: 'x',
      storyWorkItemId: 1,
      author: resolvedAuthor,
    });
    expect(filed.assignedTo).toEqual({ resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  test('unresolved author -> explicit unassigned note carrying the reason, never silently dropped', () => {
    const filed = planGapTaskFiling({
      acId: 'AC-009-2',
      reqId: 'REQ-009',
      gapReason: 'x',
      storyWorkItemId: 1,
      author: { resolved: false, reason: 'no commit history for src/gone.js' },
    });
    expect(filed.assignedTo).toEqual({
      resolved: false,
      note: 'Unassigned — could not resolve the implementing commit author (no commit history for src/gone.js)',
    });
  });

  const validInput = () => ({
    acId: 'AC-009-1',
    reqId: 'REQ-009',
    gapReason: 'x',
    storyWorkItemId: 1,
    author: { resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' },
  });

  test('a non-object input throws', () => {
    expect(() => planGapTaskFiling('not an object')).toThrow(/input must be an object/);
    expect(() => planGapTaskFiling(null)).toThrow(/input must be an object/);
  });

  test.each([
    ['missing', undefined],
    ['empty string', ''],
    ['whitespace-only', '   '],
  ])('rejects a %s acId', (_label, acId) => {
    expect(() => planGapTaskFiling({ ...validInput(), acId })).toThrow(/acId must be a non-empty string/);
  });

  test.each([
    ['missing', undefined],
    ['empty string', ''],
  ])('rejects a %s reqId', (_label, reqId) => {
    expect(() => planGapTaskFiling({ ...validInput(), reqId })).toThrow(/reqId must be a non-empty string/);
  });

  test.each([
    ['missing', undefined],
    ['empty string', ''],
    ['whitespace-only', '   '],
  ])('rejects a %s gapReason', (_label, gapReason) => {
    expect(() => planGapTaskFiling({ ...validInput(), gapReason })).toThrow(/gapReason must be a non-empty string/);
  });

  test.each([
    ['missing', undefined],
    ['empty string', ''],
    ['whitespace-only', '   '],
  ])('rejects a %s storyWorkItemId', (_label, storyWorkItemId) => {
    expect(() => planGapTaskFiling({ ...validInput(), storyWorkItemId })).toThrow(
      /storyWorkItemId must be a non-empty string or number/
    );
  });

  test.each([
    ['missing', undefined],
    ['a non-object', 'not-an-object'],
    ['resolved: true but empty name', { resolved: true, name: '', email: 'x@example.com' }],
    ['resolved: true but empty email', { resolved: true, name: 'X', email: '' }],
    ['resolved: false but empty reason', { resolved: false, reason: '' }],
    ['an invalid resolved value', { resolved: 'maybe' }],
  ])('rejects a malformed author (%s)', (_label, author) => {
    expect(() => planGapTaskFiling({ ...validInput(), author })).toThrow(/author/);
  });

  test('collects every missing-field error at once, never just the first', () => {
    expect(() => planGapTaskFiling({})).toThrow(/acId.*reqId.*gapReason.*storyWorkItemId.*author/s);
  });
});

describe('AC-010-2: two confirmed gaps in one session produce two independently-tracked Tasks, never bundled', () => {
  const sharedAuthor = { resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' };

  test('two distinct decision objects come back, each with its own acId/reqId/description/assignedTo', () => {
    const gapOne = planGapTaskFiling({
      acId: 'AC-010-1',
      reqId: 'REQ-010',
      gapReason: 'first gap: missing validation on claim submission',
      storyWorkItemId: 4821,
      author: sharedAuthor,
    });
    const gapTwo = planGapTaskFiling({
      acId: 'AC-012-1',
      reqId: 'REQ-012',
      gapReason: 'second, unrelated gap: missing audit log entry',
      storyWorkItemId: 4821,
      author: { resolved: false, reason: 'no commit history for src/audit.js' },
    });

    expect(gapOne).not.toBe(gapTwo);
    expect(gapOne.acId).not.toBe(gapTwo.acId);
    expect(gapOne.reqId).not.toBe(gapTwo.reqId);
    expect(gapOne.title).not.toBe(gapTwo.title);
    expect(gapOne.description).not.toBe(gapTwo.description);
    expect(gapOne.assignedTo).toEqual({ resolved: true, name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(gapTwo.assignedTo).toEqual({
      resolved: false,
      note: 'Unassigned — could not resolve the implementing commit author (no commit history for src/audit.js)',
    });
  });

  test('no shared mutable state between calls -- mutating one decision never leaks into the other, even sharing the same author input', () => {
    const gapOne = planGapTaskFiling({
      acId: 'AC-010-1',
      reqId: 'REQ-010',
      gapReason: 'first gap',
      storyWorkItemId: 4821,
      author: sharedAuthor,
    });
    const gapTwo = planGapTaskFiling({
      acId: 'AC-012-1',
      reqId: 'REQ-012',
      gapReason: 'second gap',
      storyWorkItemId: 4821,
      author: sharedAuthor, // deliberately the same author object reference
    });

    expect(gapOne.assignedTo).not.toBe(gapTwo.assignedTo); // independent objects, never aliased

    gapOne.assignedTo.name = 'TAMPERED';
    gapOne.acId = 'TAMPERED';
    expect(gapTwo.assignedTo.name).toBe('Ada Lovelace');
    expect(gapTwo.acId).toBe('AC-012-1');

    // mutating the shared input author AFTER both calls doesn't retroactively
    // rewrite either already-returned decision -- values were copied, not
    // referenced live (see buildAssignedTo).
    sharedAuthor.name = 'Mutated Later';
    expect(gapTwo.assignedTo.name).not.toBe('Mutated Later');
  });

  test('module inspection: no gaps/batch array parameter exists anywhere -- one gap in, one Task decision out, by construction', () => {
    expect(planGapTaskFiling.length).toBe(1); // exactly one parameter: the single-gap input object

    const signatureMatch = LIB_SOURCE.match(/function planGapTaskFiling\(([^)]*)\)/);
    expect(signatureMatch).not.toBeNull();
    expect(signatureMatch[1].trim()).toBe('input'); // a single object, never `gaps` or an array

    // no batching entry point exported or defined anywhere in the module
    expect(Object.keys(require('../lib/ac-gap-task-filer'))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/batch/i)])
    );
    expect(LIB_SOURCE).not.toMatch(/function\s+\w*[Bb]atch\w*\(/);
  });
});

describe('recordFiledGapTask', () => {
  const decision = {
    title: 'AC Gap: AC-009-1 (REQ-009)',
    parentWorkItemId: '4821',
    acId: 'AC-009-1',
    reqId: 'REQ-009',
  };

  test('normalizes a valid mcpResponse', () => {
    expect(recordFiledGapTask(decision, { id: 777, title: 'Renamed by ADO' })).toEqual({
      taskWorkItemId: '777',
      title: 'Renamed by ADO',
      parentWorkItemId: '4821',
      acId: 'AC-009-1',
      reqId: 'REQ-009',
    });
  });

  test('falls back to decision.title when mcpResponse.title is absent', () => {
    expect(recordFiledGapTask(decision, { id: 777 })).toEqual({
      taskWorkItemId: '777',
      title: decision.title,
      parentWorkItemId: '4821',
      acId: 'AC-009-1',
      reqId: 'REQ-009',
    });
  });

  test.each([
    ['not an object', 'not-a-decision'],
    ['null', null],
    ['missing title', { parentWorkItemId: '1', acId: 'A', reqId: 'B' }],
    ['missing parentWorkItemId', { title: 'T', acId: 'A', reqId: 'B' }],
    ['missing acId', { title: 'T', parentWorkItemId: '1', reqId: 'B' }],
    ['missing reqId', { title: 'T', parentWorkItemId: '1', acId: 'A' }],
  ])('rejects a malformed decision (%s)', (_label, malformedDecision) => {
    expect(() => recordFiledGapTask(malformedDecision, { id: 1 })).toThrow(
      /requires the decision returned by planGapTaskFiling/
    );
  });

  test.each([
    ['null', null],
    ['not an object', 'not-a-response'],
    ['missing id', {}],
    ['a non-string title', { id: 1, title: 42 }],
  ])('rejects a malformed mcpResponse (%s)', (_label, mcpResponse) => {
    expect(() => recordFiledGapTask(decision, mcpResponse)).toThrow();
  });

  test('two separate recordFiledGapTask calls (simulating the two Tasks actually filed) track two independent taskWorkItemIds', () => {
    const decisionOne = { title: 'AC Gap: AC-010-1 (REQ-010)', parentWorkItemId: '4821', acId: 'AC-010-1', reqId: 'REQ-010' };
    const decisionTwo = { title: 'AC Gap: AC-012-1 (REQ-012)', parentWorkItemId: '4821', acId: 'AC-012-1', reqId: 'REQ-012' };

    const filedOne = recordFiledGapTask(decisionOne, { id: 9001 });
    const filedTwo = recordFiledGapTask(decisionTwo, { id: 9002 });

    expect(filedOne.taskWorkItemId).toBe('9001');
    expect(filedTwo.taskWorkItemId).toBe('9002');
    expect(filedOne.taskWorkItemId).not.toBe(filedTwo.taskWorkItemId);
    expect(filedOne.acId).not.toBe(filedTwo.acId);
    expect(filedOne).not.toBe(filedTwo);

    // mutating one recorded result never touches the other
    filedOne.taskWorkItemId = 'TAMPERED';
    expect(filedTwo.taskWorkItemId).toBe('9002');
  });
});
