'use strict';

/**
 * TRD-037: the cross-runtime reachability and no-new-secrets proof.
 *
 * Implementation AC (REQ-023, REQ-024):
 *   1. `fix-issue`, `implement-trd-beads` and `pr-merge`, traced from their
 *      entry command TEXT through the skill to the CLI subcommands, reach the
 *      verified-findings, convergence and tier behaviour -- asserted THROUGH
 *      the entry point, never around it;
 *   2. the Claude, Pi, Codex and OpenCode generated artifacts carry the same
 *      procedures and subcommands, or the report states what is reduced;
 *   3. no new CI secret is required for the in-agent review to complete, and
 *      credential-like text is redacted across every new lib.
 *
 * This file grades the pure library. The proof it performs over the REAL
 * repository artifacts lives in `pr-review-reachability-repo.test.js`: the
 * grader is only worth trusting if a broken chain is actually refused, so
 * every rule here is paired with a case that must FAIL.
 */

const {
  traceCapabilities,
  compareRuntimes,
  gradeSecretHygiene,
  CAPABILITIES,
  RUNTIMES,
} = require('../lib/pr-review-reachability');

// ---------------------------------------------------------------------------
// Fixtures: one healthy chain, which each test then breaks in exactly one link
// ---------------------------------------------------------------------------

const SKILL_PATH = 'packages/development/skills/pr-review-cycle/SKILL.md';

/** A skill text that invokes the given subcommands the way the real one does. */
const skillText = (subcommands) =>
  subcommands.map((name) => `Run \`node "$PR_REVIEW_CLI" ${name}\` with the payload.`).join('\n');

/** An entry command text that reaches the skill by path. */
const entryText = (skillPath = SKILL_PATH) =>
  `Invoke the shared pr-review-cycle skill, located at "$(git rev-parse --show-toplevel)/${skillPath}".`;

const ALL_SUBCOMMANDS = ['votes', 'verify-assign', 'status', 'ledger', 'scope', 'tier', 'mode'];

function healthy(overrides = {}) {
  return {
    entryPoints: [{ id: 'fix-issue', text: entryText() }],
    skills: [{ id: 'pr-review-cycle', path: SKILL_PATH, text: skillText(ALL_SUBCOMMANDS) }],
    subcommands: ALL_SUBCOMMANDS,
    ...overrides,
  };
}

const traceOf = (result, id) => result.entryPoints.find((entry) => entry.id === id);

// ---------------------------------------------------------------------------
// AC-023-1: reached THROUGH the entry point
// ---------------------------------------------------------------------------

describe('TRD-037 AC-023-1: capabilities are traced entry text -> skill -> CLI subcommand', () => {
  test('a whole chain reaches every required capability and names the links it used', () => {
    const result = traceCapabilities(healthy());

    expect(result.ok).toBe(true);
    expect(result.unreachable).toEqual([]);

    const trace = traceOf(result, 'fix-issue');
    expect(trace.reached.sort()).toEqual(['convergence', 'mode', 'tier', 'verified-findings']);
    expect(trace.unreachable).toEqual([]);
    expect(trace.skills).toEqual(['pr-review-cycle']);

    // The chain is evidence, not a claim: each capability names the skill and
    // the subcommand that carried it.
    const verified = trace.capabilities.find((entry) => entry.capability === 'verified-findings');
    expect(verified.via).toEqual([
      { skill: 'pr-review-cycle', subcommand: 'votes' },
      { skill: 'pr-review-cycle', subcommand: 'verify-assign' },
    ]);
  });

  test('REFUSED: an entry point that never names the skill reaches nothing', () => {
    // The whole point of AC-023-1. The skill still invokes every subcommand
    // and the CLI still registers them -- but nothing calls the skill, so the
    // code is exactly the "unit-tested code that nothing calls" the AC rejects.
    const result = traceCapabilities(
      healthy({ entryPoints: [{ id: 'fix-issue', text: 'Review the PR carefully and merge it.' }] })
    );

    expect(result.ok).toBe(false);
    const trace = traceOf(result, 'fix-issue');
    expect(trace.skills).toEqual([]);
    expect(trace.reached).toEqual([]);
    expect(trace.unreachable.sort()).toEqual(['convergence', 'mode', 'tier', 'verified-findings']);
    expect(trace.reason).toBe('entry-point-reaches-no-skill');
  });

  test('REFUSED: a subcommand the CLI does not register is not reachable', () => {
    // The skill asks for `tier`, but the CLI has no such handler: the call
    // would fail at run time, so the capability is NOT reached.
    const result = traceCapabilities(healthy({ subcommands: ['votes', 'verify-assign', 'status', 'ledger', 'scope', 'mode'] }));

    expect(result.ok).toBe(false);
    const trace = traceOf(result, 'fix-issue');
    expect(trace.unreachable).toEqual(['tier']);
    expect(trace.reached).not.toContain('tier');
    const tier = trace.capabilities.find((entry) => entry.capability === 'tier');
    expect(tier.unregistered).toEqual(['tier']);
  });

  test('REFUSED: a skill that never invokes the subcommand does not carry the capability', () => {
    const result = traceCapabilities(
      healthy({ skills: [{ id: 'pr-review-cycle', path: SKILL_PATH, text: skillText(['status', 'ledger', 'scope', 'tier', 'mode']) }] })
    );

    expect(result.ok).toBe(false);
    expect(traceOf(result, 'fix-issue').unreachable).toEqual(['verified-findings']);
  });

  test('REFUSED: a skill that never invokes `mode` leaves the mode capability unreachable', () => {
    const result = traceCapabilities(
      healthy({ skills: [{ id: 'pr-review-cycle', path: SKILL_PATH, text: skillText(['votes', 'verify-assign', 'status', 'ledger', 'scope', 'tier']) }] })
    );

    expect(result.ok).toBe(false);
    expect(traceOf(result, 'fix-issue').unreachable).toEqual(['mode']);
  });

  test('convergence needs the WHOLE of its evidence: round cap, repeats and delta range', () => {
    // Convergence is three subcommands (status, ledger, scope). Dropping any
    // one leaves the behaviour partly unreachable, and the report says which.
    for (const dropped of ['status', 'ledger', 'scope']) {
      const kept = ALL_SUBCOMMANDS.filter((name) => name !== dropped);
      const result = traceCapabilities(
        healthy({ skills: [{ id: 'pr-review-cycle', path: SKILL_PATH, text: skillText(kept) }] })
      );
      const trace = traceOf(result, 'fix-issue');
      expect(trace.unreachable).toEqual(['convergence']);
      const convergence = trace.capabilities.find((entry) => entry.capability === 'convergence');
      expect(convergence.missing).toEqual([dropped]);
    }
  });

  test('a capability reached through a second skill is still reached, and the skill is named', () => {
    const result = traceCapabilities(
      healthy({
        entryPoints: [{ id: 'pr-merge', text: `${entryText()} It also uses docs/skills/gate/SKILL.md.` }],
        skills: [
          { id: 'pr-review-cycle', path: SKILL_PATH, text: skillText(['votes', 'verify-assign', 'status', 'ledger', 'scope', 'mode']) },
          { id: 'gate', path: 'docs/skills/gate/SKILL.md', text: skillText(['tier']) },
        ],
      })
    );

    expect(result.ok).toBe(true);
    const tier = traceOf(result, 'pr-merge').capabilities.find((entry) => entry.capability === 'tier');
    expect(tier.via).toEqual([{ skill: 'gate', subcommand: 'tier' }]);
  });

  test('an entry point that calls the CLI directly is reported, never counted as reachability', () => {
    // Integration contract (TRD architecture): callers invoke the skill, never
    // the CLI. A direct call is a boundary violation AND does not prove the
    // skill path works, so it must not satisfy the capability.
    const result = traceCapabilities(
      healthy({
        entryPoints: [{ id: 'fix-issue', text: 'Run `node packages/development/lib/pr-review-cli.js votes` directly.' }],
      })
    );

    expect(result.ok).toBe(false);
    const trace = traceOf(result, 'fix-issue');
    expect(trace.directCliReferences).toEqual(['votes']);
    expect(trace.reached).toEqual([]);
  });

  test('fail closed: an unreadable request is refused, never reported as "all reachable"', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      [],
      {},
      { entryPoints: 'no', skills: [], subcommands: [] },
      { entryPoints: [], skills: 'no', subcommands: [] },
      { entryPoints: [], skills: [], subcommands: 'no' },
      { entryPoints: [{ id: '', text: 'x' }], skills: [], subcommands: [] },
      { __proto__: { entryPoints: [] } },
    ]) {
      const result = traceCapabilities(bad);
      expect(result.ok).toBe(false);
      expect(typeof result.reason).toBe('string');
      expect(result.reason).not.toBe('');
      expect(result.entryPoints).toEqual([]);
    }
  });

  test('an empty entry-point list is a refusal, not a vacuous pass', () => {
    const result = traceCapabilities({ entryPoints: [], skills: [], subcommands: ALL_SUBCOMMANDS });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-entry-points');
  });

  test('the capability map names the three behaviours the AC requires', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(['convergence', 'mode', 'tier', 'verified-findings']);
    expect(CAPABILITIES['verified-findings']).toEqual(['votes', 'verify-assign']);
    expect(CAPABILITIES.tier).toEqual(['tier']);
    expect(CAPABILITIES.mode).toEqual(['mode']);
    expect(CAPABILITIES.convergence.slice().sort()).toEqual(['ledger', 'scope', 'status']);
  });
});

// ---------------------------------------------------------------------------
// AC-023-2: the same procedures on every runtime, or a stated reduction
// ---------------------------------------------------------------------------

describe('TRD-037 AC-023-2: runtimes match the baseline or the report states what is reduced', () => {
  const runtime = (procedures, subcommands) => ({ procedures, subcommands });

  const full = {
    claude: runtime(['pr-review-cycle', 'pr-review-eval'], ALL_SUBCOMMANDS),
    pi: runtime(['pr-review-cycle', 'pr-review-eval'], ALL_SUBCOMMANDS),
    codex: runtime(['pr-review-cycle', 'pr-review-eval'], ALL_SUBCOMMANDS),
    opencode: runtime(['pr-review-cycle', 'pr-review-eval'], ALL_SUBCOMMANDS),
  };

  test('four equivalent runtimes report equivalent, with nothing reduced', () => {
    const result = compareRuntimes({ runtimes: full, baseline: 'claude' });

    expect(result.ok).toBe(true);
    expect(result.equivalent).toBe(true);
    for (const name of RUNTIMES) {
      const entry = result.report.find((item) => item.runtime === name);
      expect(entry.equivalent).toBe(true);
      expect(entry.missingProcedures).toEqual([]);
      expect(entry.missingSubcommands).toEqual([]);
    }
  });

  test('a runtime missing a procedure is NOT equivalent and the reduction is stated', () => {
    const result = compareRuntimes({
      runtimes: { ...full, codex: runtime(['pr-review-cycle'], ALL_SUBCOMMANDS) },
      baseline: 'claude',
    });

    expect(result.equivalent).toBe(false);
    const codex = result.report.find((item) => item.runtime === 'codex');
    expect(codex.equivalent).toBe(false);
    expect(codex.missingProcedures).toEqual(['pr-review-eval']);
    // "States what is reduced" means a sentence a human can read, not a flag.
    expect(codex.reduction).toMatch(/pr-review-eval/);
    expect(result.reductions).toHaveLength(1);
  });

  test('a runtime missing a subcommand is NOT equivalent and the reduction is stated', () => {
    const result = compareRuntimes({
      runtimes: { ...full, pi: runtime(['pr-review-cycle', 'pr-review-eval'], ['votes', 'verify-assign', 'status', 'ledger', 'scope', 'mode']) },
      baseline: 'claude',
    });

    expect(result.equivalent).toBe(false);
    const pi = result.report.find((item) => item.runtime === 'pi');
    expect(pi.missingSubcommands).toEqual(['tier']);
    expect(pi.reduction).toMatch(/tier/);
  });

  test('a runtime that is absent entirely is reduced to nothing, never silently skipped', () => {
    const { codex, ...withoutCodex } = full;
    expect(codex).toBeDefined();
    const result = compareRuntimes({ runtimes: withoutCodex, baseline: 'claude' });

    expect(result.equivalent).toBe(false);
    const entry = result.report.find((item) => item.runtime === 'codex');
    expect(entry.present).toBe(false);
    expect(entry.reduction).toMatch(/not installed|absent|missing/i);
  });

  test('extras are reported but never make a runtime non-equivalent', () => {
    const result = compareRuntimes({
      runtimes: { ...full, pi: runtime(['pr-review-cycle', 'pr-review-eval', 'pr-review-sweep'], ALL_SUBCOMMANDS) },
      baseline: 'claude',
    });

    expect(result.equivalent).toBe(true);
    expect(result.report.find((item) => item.runtime === 'pi').extraProcedures).toEqual(['pr-review-sweep']);
  });

  test('fail closed: an unreadable comparison is refused and never "equivalent"', () => {
    for (const bad of [null, undefined, 'x', [], {}, { runtimes: null }, { runtimes: full, baseline: 'nope' }, { runtimes: { claude: 'x' }, baseline: 'claude' }]) {
      const result = compareRuntimes(bad);
      expect(result.ok).toBe(false);
      expect(result.equivalent).toBe(false);
      expect(typeof result.reason).toBe('string');
    }
  });

  test('an empty baseline is a refusal: nothing to compare is never equivalence', () => {
    const result = compareRuntimes({
      runtimes: { ...full, claude: { procedures: [], subcommands: [] } },
      baseline: 'claude',
    });
    expect(result.ok).toBe(false);
    expect(result.equivalent).toBe(false);
    expect(result.reason).toBe('baseline-declares-nothing');
  });
});

// ---------------------------------------------------------------------------
// AC-023-3 and AC-024-2: no new CI secret, and credentials never reproduced
// ---------------------------------------------------------------------------

describe('TRD-037 AC-023-3: the in-agent review needs no new CI secret', () => {
  test('a workflow using only the pre-existing secrets requires nothing new', () => {
    const result = gradeSecretHygiene({
      workflows: [{ path: '.github/workflows/review.yml', text: 'token: ${{ secrets.GITHUB_TOKEN }}' }],
      allowedSecrets: ['GITHUB_TOKEN'],
      samples: [],
    });

    expect(result.ok).toBe(true);
    expect(result.newSecrets).toEqual([]);
    expect(result.inAgentReviewRuns).toBe(true);
  });

  test('REFUSED: a workflow that introduces a new secret is named and fails the proof', () => {
    const result = gradeSecretHygiene({
      workflows: [
        { path: '.github/workflows/review.yml', text: 'key: ${{ secrets.GITHUB_TOKEN }}\nother: ${{ secrets.HOSTED_REVIEWER_KEY }}' },
      ],
      allowedSecrets: ['GITHUB_TOKEN'],
      samples: [],
    });

    expect(result.ok).toBe(false);
    expect(result.newSecrets).toEqual([
      { secret: 'HOSTED_REVIEWER_KEY', path: '.github/workflows/review.yml' },
    ]);
  });

  test('with no hosted reviewer configured the in-agent review still runs', () => {
    const result = gradeSecretHygiene({
      workflows: [{ path: '.github/workflows/review.yml', text: 'token: ${{ secrets.GITHUB_TOKEN }}' }],
      allowedSecrets: ['GITHUB_TOKEN'],
      hostedReviewerConfigured: false,
      samples: [],
    });

    expect(result.inAgentReviewRuns).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.notes).toContain('hosted-reviewer-not-configured');
  });
});

describe('TRD-037 AC-024-2: credential-like text is redacted in every new lib', () => {
  const SECRET = 'ghp_0123456789abcdef0123456789abcdef0123';

  test('a sample whose output no longer contains the secret passes, and names the lib', () => {
    const result = gradeSecretHygiene({
      workflows: [],
      allowedSecrets: [],
      samples: [
        { lib: 'pr-review-ledger', secret: SECRET, output: { finding: { evidence: '[REDACTED]' } } },
        { lib: 'pr-review-votes', secret: SECRET, output: { reason: 'token [REDACTED] rejected' } },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.leaks).toEqual([]);
    expect(result.libsChecked.sort()).toEqual(['pr-review-ledger', 'pr-review-votes']);
  });

  test('REFUSED: a lib that reproduces the secret anywhere in its output is a named leak', () => {
    const result = gradeSecretHygiene({
      workflows: [],
      allowedSecrets: [],
      samples: [
        { lib: 'pr-review-ledger', secret: SECRET, output: { finding: { evidence: '[REDACTED]' } } },
        { lib: 'pr-review-metrics', secret: SECRET, output: { rows: [{ note: `saw ${SECRET} here` }] } },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.leaks).toEqual([{ lib: 'pr-review-metrics', where: 'rows.0.note' }]);
  });

  test('the secret is found however deeply it is nested, and in keys as well as values', () => {
    const nested = gradeSecretHygiene({
      workflows: [],
      allowedSecrets: [],
      samples: [{ lib: 'deep', secret: SECRET, output: { a: [{ b: { c: [`x ${SECRET}`] } }] } }],
    });
    expect(nested.leaks).toEqual([{ lib: 'deep', where: 'a.0.b.c.0' }]);

    const inKey = gradeSecretHygiene({
      workflows: [],
      allowedSecrets: [],
      samples: [{ lib: 'keyed', secret: SECRET, output: { [SECRET]: 'value' } }],
    });
    expect(inKey.ok).toBe(false);
    expect(inKey.leaks[0].lib).toBe('keyed');
  });

  test('a sample with no secret to look for is refused, never counted as "clean"', () => {
    // The dangerous false pass: an empty secret matches nothing, so every
    // output would look redacted. It must be refused as an unusable sample.
    const result = gradeSecretHygiene({
      workflows: [],
      allowedSecrets: [],
      samples: [{ lib: 'pr-review-ledger', secret: '', output: { any: 'thing' } }],
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/secret/);
    expect(result.libsChecked).toEqual([]);
  });

  test('fail closed: an unreadable request is refused and never "no leaks"', () => {
    for (const bad of [null, undefined, 'x', [], { workflows: 'no' }, { workflows: [], samples: 'no' }, { workflows: [], samples: [null] }]) {
      const result = gradeSecretHygiene(bad);
      expect(result.ok).toBe(false);
      expect(result.inAgentReviewRuns).toBe(false);
      expect(typeof result.reason).toBe('string');
    }
  });
});

describe('final-gate fixes: reachability and hygiene fail closed', () => {
  test('secrets: empty input is refused as nothing-checked', () => {
    for (const input of [{}, { workflows: [] }, { workflows: [], samples: [] }]) {
      const result = gradeSecretHygiene(input);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('nothing-checked');
    }
  });

  test('secrets: bracket access and whole-object use are caught', () => {
    const cases = [
      ["a: ${{ secrets['EVIL'] }}", 'EVIL'],
      ['a: ${{ secrets["EVIL"] }}', 'EVIL'],
      ['a: ${{ toJSON(secrets) }}', '*'],
      ['a: ${{ secrets }}', '*'],
      ['a: ${{ secrets[matrix.name] }}', '*'],
    ];
    for (const [text, name] of cases) {
      const result = gradeSecretHygiene({ workflows: [{ path: 'w.yml', text }], allowedSecrets: ['GITHUB_TOKEN', '*x'] });
      expect(result.ok).toBe(false);
      expect(result.newSecrets).toEqual([{ secret: name, path: 'w.yml' }]);
    }
  });

  test('trace: a capability mapped to an empty list is not reached', () => {
    const result = traceCapabilities({
      entryPoints: [{ id: 'e', text: entryText() }],
      skills: [{ id: 'pr-review-cycle', path: SKILL_PATH, text: skillText(ALL_SUBCOMMANDS) }],
      subcommands: ALL_SUBCOMMANDS,
      capabilities: { empty: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.unreachable).toEqual(['empty']);
  });

  test('runtimes: expected [] is not equivalent by vacuity', () => {
    const result = compareRuntimes({
      runtimes: { claude: { procedures: ['p'], subcommands: ['votes'] } },
      baseline: 'claude',
      expected: [],
    });
    expect(result.ok).toBe(false);
    expect(result.equivalent).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
