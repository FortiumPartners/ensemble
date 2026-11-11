'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const yaml = require('js-yaml');
const analyzer = require('../lib/complexity-analyzer');
const { readCommandProse } = require('../../../scripts/lib/skill-backed-command');

// analyze-complexity is a skill-backed command: the YAML is a manifest (metadata + skill) and the
// prompt lives in its skill, so the contract is pinned against the manifest plus the skill prose.
function readCommand() {
  const commandPath = path.join(__dirname, '../commands/analyze-complexity.yaml');
  const raw = fs.readFileSync(commandPath, 'utf8');
  return readCommandProse(commandPath, yaml.load(raw), raw);
}

describe('complexity-analyzer input contract', () => {
  test('uses interactive arguments outside Foreman mode', () => {
    const result = analyzer.normalizeInput({ foreman: false, description: 'Fix a one-line typo in README' }, {});
    expect(result.ok).toBe(true);
    expect(result.source).toBe('args');
    expect(result.originalDescription).toBe('Fix a one-line typo in README');
  });

  test('uses Foreman metadata over args under --foreman', () => {
    const env = {
      FOREMAN_TASK_TITLE: 'Foreman title',
      FOREMAN_TASK_DESCRIPTION: 'Foreman description',
    };
    const result = analyzer.normalizeInput({ foreman: true, description: 'arg description' }, env);
    expect(result.ok).toBe(true);
    expect(result.source).toBe('foreman');
    expect(result.subject).toBe('Foreman title');
    expect(result.originalDescription).toBe('Foreman description');
  });

  test('halts with no route on missing subject', () => {
    const result = analyzer.analyze(null, { foreman: false, description: '' }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Missing work description');
    expect(result.selectedRoute).toBeUndefined();
  });
});

describe('complexity-analyzer scoring and route mapping', () => {
  test('scores simple fixture in simple band', () => {
    const result = analyzer.analyze(null, { description: 'Fix a single file typo in command help with no dependencies and low risk.' }, {});
    expect(result.ok).toBe(true);
    expect(result.score).toBeLessThanOrEqual(3);
    expect(result.selectedRoute).toBe('simple');
    expect(result.routePlan).toContain('/ensemble:fix-issue');
  });

  test('scores complex initiative in complex band', () => {
    const result = analyzer.analyze(null, {
      description: 'Implement cross-cutting platform workflow across multiple packages, config, CLI, Foreman artifacts, approval gates, fallback handling, audit trail, reviewer and QA operators.',
    }, {});
    expect(result.ok).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(7);
    expect(result.selectedRoute).toBe('complex');
    expect(result.routePlan).toEqual(expect.arrayContaining(['/ensemble:refine-prd', '/ensemble:refine-trd']));
  });

  test.each([
    [1, 'simple'], [2, 'simple'], [3, 'simple'],
    [4, 'medium'], [5, 'medium'], [6, 'medium'],
    [7, 'complex'], [8, 'complex'], [9, 'complex'], [10, 'complex'],
  ])('maps score %s to %s', (score, route) => {
    expect(analyzer.scoreToRoute(score)).toBe(route);
  });

  test('boundary route mappings match documented bands', () => {
    expect(analyzer.scoreToRoute(3)).toBe('simple');
    expect(analyzer.scoreToRoute(4)).toBe('medium');
    expect(analyzer.scoreToRoute(6)).toBe('medium');
    expect(analyzer.scoreToRoute(7)).toBe('complex');
  });
});

describe('complexity-analyzer overrides, disable controls, and fallback', () => {
  test('valid override selects route while preserving recommendation', () => {
    const result = analyzer.analyze(null, { description: 'Fix one small bug in one file', route: 'complex' }, {});
    expect(result.ok).toBe(true);
    expect(result.recommendedRoute).toBe('simple');
    expect(result.selectedRoute).toBe('complex');
    expect(result.override).toEqual({ applied: true, source: 'flag', value: 'complex' });
  });

  test('invalid override halts and lists valid choices', () => {
    const result = analyzer.analyze(null, { description: 'Fix one small bug', route: 'create-prd' }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Valid choices: simple, medium, complex');
  });

  test('--no-adaptive-planning takes precedence over config', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-planning-'));
    fs.writeFileSync(path.join(tmp, 'ensemble.yaml'), 'adaptive_planning:\n  enabled: true\n');
    const result = analyzer.analyze(null, { description: 'Implement config change', noAdaptivePlanning: true, cwd: tmp }, {});
    expect(result.ok).toBe(true);
    expect(result.disabled).toBe(true);
    expect(result.adaptivePlanning).toEqual({ enabled: false, source: '--no-adaptive-planning' });
  });

  test('adaptive_planning.enabled false disables classification', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adaptive-planning-'));
    fs.writeFileSync(path.join(tmp, '.ensemble.yaml'), 'adaptive_planning:\n  enabled: false\n');
    const result = analyzer.analyze(null, { description: 'Implement config change', cwd: tmp }, {});
    expect(result.ok).toBe(true);
    expect(result.disabled).toBe(true);
    expect(result.selectedRoute).toBeNull();
  });

  test('low-confidence Foreman analysis selects safer higher-depth route', () => {
    const result = analyzer.analyze(null, { foreman: true }, { FOREMAN_TASK_TITLE: 'Tweak', FOREMAN_TASK_DESCRIPTION: '' });
    expect(result.ok).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.selectedRoute).toBe('medium');
    expect(result.missingDetails).toContain('dependencies');
  });

  test('malformed output fallback halts when insufficient detail exists', () => {
    const result = analyzer.analyze(null, { description: 'Tweak', aiOutputMalformed: true }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('insufficient structural detail');
  });

  test('malformed output fallback is deterministic when enough detail exists', () => {
    const description = 'Implement CLI config integration with fallback and approval audit for users and Foreman operators.';
    const first = analyzer.analyze(null, { description, aiOutputMalformed: true }, {});
    const second = analyzer.analyze(null, { description, aiOutputMalformed: true }, {});
    expect(first.ok).toBe(true);
    expect(first.fallback.applied).toBe(true);
    expect(first.selectedRoute).toBe(second.selectedRoute);
  });
});

describe('complexity-analyzer adaptive_planning config detection', () => {
  test.each([
    ['nested enabled false', 'adaptive_planning:\n  enabled: false\n', true],
    ['CRLF line endings', 'adaptive_planning:\r\n  enabled: false\r\n', true],
    ['trailing spaces after the key', 'adaptive_planning:  \n  enabled: false\n', true],
    ['other settings before enabled', 'adaptive_planning:\n  mode: strict\n  # why\n  enabled: false\n', true],
    ['blank line before enabled', 'adaptive_planning:\n\n  enabled: false\n', true],
    ['settings around the block', 'name: demo\nadaptive_planning:\n  enabled: false\nother: 1\n', true],
    ['enabled true', 'adaptive_planning:\n  enabled: true\n', false],
    ['enabled falsey', 'adaptive_planning:\n  enabled: falsey\n', false],
    ['enabled false outside the block', 'adaptive_planning:\n  mode: strict\nenabled: false\n', false],
    ['no adaptive_planning key', 'other:\n  enabled: false\n', false],
  ])('%s', (_name, text, expected) => {
    expect(analyzer.isAdaptivePlanningDisabled(text)).toBe(expected);
  });

  // The pattern that reads this block once backtracked exponentially on whitespace-only lines
  // under the key (CodeQL js/redos). A hard deadline makes a regression throw instead of
  // hanging the suite, the same way toolchain/detect.js bounds its own pattern evaluation.
  function detectWithin(deadlineMs, text) {
    const context = vm.createContext({ detect: analyzer.isAdaptivePlanningDisabled, text, result: undefined });
    new vm.Script('result = detect(text);').runInContext(context, { timeout: deadlineMs });
    return context.result;
  }

  test('a long run of whitespace-only lines under the key is matched in linear time', () => {
    const blankLines = `adaptive_planning:\n${' \n'.repeat(100000)}`;
    expect(detectWithin(3000, blankLines)).toBe(false);
    expect(detectWithin(3000, `${blankLines}  enabled: false\n`)).toBe(true);
  });
});

describe('complexity-analyzer audit and artifacts', () => {
  test('redacts secrets in rationale/audit text while preserving original description', () => {
    const secret = 'token=supersecretvalue12345';
    const result = analyzer.analyze(null, { description: `Fix API integration with ${secret}` }, {});
    expect(result.ok).toBe(true);
    expect(result.normalized.originalDescription).toContain(secret);
    expect(JSON.stringify(result.rationale)).not.toContain('supersecretvalue12345');
    expect(result.redactions.length).toBeGreaterThan(0);
  });

  test('computes Foreman sidecar path from phase artifact basename', () => {
    expect(analyzer.sidecarPath('/tmp/run/phase-4.md')).toBe('/tmp/run/phase-4.classification.json');
  });

  test('command manifest and skill declare generated artifact and Foreman contracts', () => {
    const command = readCommand();
    expect(command).toContain('name: ensemble:analyze-complexity');
    expect(command).toContain('output_path: ensemble/analyze-complexity.md');
    for (const name of ['description', 'route', 'no-adaptive-planning', 'foreman']) {
      expect(command).toContain(`**\`${name}\`**`);
    }
    expect(command).toContain('FOREMAN_ARTIFACT_PATH');
  });

  test('command skill resolves the analyzer rather than hardcoding a monorepo path', () => {
    const command = readCommand();
    // A bare packages/development/lib/... path only exists in the monorepo, so Phase 1
    // step 1 could not run from a consuming project with only the plugin installed.
    expect(command).not.toContain('node packages/development/lib/');
    expect(command).toContain('tool-path-resolution');
    expect(command).toContain('"$COMPLEXITY_ANALYZER" analyze');
  });
});

describe('complexity-analyzer route calibration', () => {
  // The suite previously asserted config precedence, override validation and
  // Foreman fallbacks, but nothing asserted that a large description stays out
  // of the Simple band. Simple dispatches straight to /ensemble:fix-issue with
  // no PRD and no TRD, so under-routing is the failure that costs something.
  const LARGE = [
    'Build a multi-tenant billing system with Stripe Connect, Postgres schema, invoice migration, admin UI, webhook handlers and a reconciliation job across three services',
    'Replace the authentication system across every service, migrate all user sessions, and roll out to production with a staged rollback plan',
    'Re-architect the entire platform to support multiple services and cross-cutting end-to-end observability for multi-team ownership with security and compliance audit approval',
  ];

  test.each(LARGE)('large work never routes to simple: %s', (description) => {
    const result = analyzer.analyze(null, { foreman: false, description }, {});
    expect(result.ok).toBe(true);
    expect(result.recommendedRoute).not.toBe('simple');
  });

  const SMALL = [
    'Fix a typo in the README',
    'Rename a variable in utils.js',
    'Bump the eslint version',
    'Correct a broken link in the docs',
    'Fix an off-by-one in the pagination offset',
  ];

  test.each(SMALL)('small work still routes to simple: %s', (description) => {
    const result = analyzer.analyze(null, { foreman: false, description }, {});
    expect(result.ok).toBe(true);
    expect(result.recommendedRoute).toBe('simple');
  });

  test('a quantifier in front of a singular noun counts as broad scope', () => {
    // "across every service" means the same as "across all services"; the
    // original high band only matched the literal token "multiple".
    const result = analyzer.analyze(null, {
      foreman: false,
      description: 'Update the request logger across every service',
    }, {});
    expect(result.ok).toBe(true);
    expect(result.dimensions.scopeSize.score).toBe(3);
  });

  test('plural dependency nouns score the same as singular ones', () => {
    const singular = analyzer.analyze(null, { foreman: false, description: 'Touch the service and the endpoint' }, {});
    const plural = analyzer.analyze(null, { foreman: false, description: 'Touch the services and the endpoints' }, {});
    expect(plural.dimensions.dependencies.score).toBe(singular.dimensions.dependencies.score);
  });

  test('migration verbs carry the same risk weight as the noun', () => {
    const noun = analyzer.analyze(null, { foreman: false, description: 'Plan the migration and the rollback' }, {});
    const verb = analyzer.analyze(null, { foreman: false, description: 'Migrate the data and the rollback' }, {});
    expect(verb.dimensions.riskFactors.score).toBe(noun.dimensions.riskFactors.score);
  });
});

describe('complexity-analyzer low-confidence confirmation gate', () => {
  // Operator decision on br-0r3 (option C): low confidence asks before dispatch
  // unless the work is recognisably small. #65 gated only on "nothing recognised";
  // a single weak signal now asks too. Recognisably small work (a narrow marker, or
  // one named file nothing imports) is exempt, so a typo does not get a prompt.
  const VAGUE = [
    'Rework how we handle customers',
    'Make the checkout flow better',
    'Redo onboarding',
    'Improve the reporting',
  ];

  test.each(VAGUE)('a description with no recognised signal asks first: %s', (description) => {
    const result = analyzer.analyze(null, { foreman: false, description }, {});
    expect(result.ok).toBe(true);
    expect(result.needsConfirmation).toBe(true);
    expect(analyzer.renderReport(result)).toContain('CONFIRM BEFORE DISPATCH');
  });

  const RECOGNISABLY_SMALL = [
    'Fix a typo in the README',
    'Update the copyright year',
    'Fix an off-by-one in the pagination offset',
    'Rename a variable in utils.js',
    'Bump the eslint version',
    'Correct a broken link in the docs',
  ];

  test.each(RECOGNISABLY_SMALL)('recognisably small work is not gated: %s', (description) => {
    const result = analyzer.analyze(null, { foreman: false, description }, {});
    expect(result.ok).toBe(true);
    expect(result.needsConfirmation).toBe(false);
    expect(result.recommendedRoute).toBe('simple');
  });

  test('work with real signal is not gated', () => {
    const result = analyzer.analyze(null, {
      foreman: false,
      description: 'Build a multi-tenant billing system with Postgres schema, invoice migration, webhook handlers and a reconciliation job across three services',
    }, {});
    expect(result.needsConfirmation).toBe(false);
    expect(result.recommendedRoute).toBe('complex');
  });

  test('an explicit --route leaves nothing to confirm', () => {
    const result = analyzer.analyze(null, {
      foreman: false,
      description: 'Rework how we handle customers',
      route: 'medium',
    }, {});
    expect(result.needsConfirmation).toBe(false);
    expect(result.selectedRoute).toBe('medium');
  });

  test('Foreman mode keeps its own safety bump and never asks', () => {
    // Foreman is unattended — there is nobody to answer a prompt. Its existing
    // low-confidence path escalates the route instead, and that stays untouched.
    const env = {
      FOREMAN_TASK_TITLE: 'Rework how we handle customers',
      FOREMAN_TASK_DESCRIPTION: 'Rework how we handle customers',
    };
    const result = analyzer.analyze(null, { foreman: true }, env);
    expect(result.ok).toBe(true);
    expect(result.needsConfirmation).toBe(false);
  });
});

describe('complexity-analyzer option C: low confidence asks unless recognisably small', () => {
  test('one weak signal is low confidence and now asks, saying why', () => {
    const result = analyzer.analyze(null, { foreman: false, description: 'Add a settings page' }, {});
    expect(result.confidence).toBe('low');
    expect(result.rationale.length).toBeGreaterThan(0);
    expect(result.needsConfirmation).toBe(true);
    expect(result.confirmationReason).toContain('only 1 of 3 dimensions had evidence');
    expect(analyzer.renderReport(result)).toContain('CONFIRM BEFORE DISPATCH: confidence is low');
  });

  test('nothing recognised keeps the floor-score explanation', () => {
    const result = analyzer.analyze(null, { foreman: false, description: 'Redo onboarding' }, {});
    expect(result.confirmationReason).toContain('score sits at the floor');
  });

  test('medium confidence does not ask', () => {
    // Two dimensions with evidence: scope ("add") and dependencies ("database").
    // "Add a caching layer" was wrong here: the dependency pattern matches
    // "cache", not "caching", so that text has one signal and is correctly low.
    const result = analyzer.analyze(null, { foreman: false, description: 'Add a settings page backed by the database' }, {});
    expect(result.confidence).toBe('medium');
    expect(result.needsConfirmation).toBe(false);
  });
});

describe('complexity-analyzer narrow markers do not disarm the gate', () => {
  // Review found the gate could be silently defeated by one ordinary word: a bare
  // narrow-marker list matched "comments" inside "Rework how we handle customer
  // comments and complaints", producing scope evidence and suppressing the very
  // confirmation this feature adds. A marker that fires on ordinary prose is worse
  // than no marker, because it fails toward less planning without saying so.
  const VAGUE_CONTAINING_NARROW_WORDS = [
    'Rework how we handle customer comments and complaints',
    'We should rename several fields for clarity throughout the codebase',
    'Clean up the changelog process across the org',
    'Improve how we comment on releases',
  ];

  test.each(VAGUE_CONTAINING_NARROW_WORDS)(
    'a narrow word in vague prose still asks: %s',
    (description) => {
      const result = analyzer.analyze(null, { foreman: false, description }, {});
      expect(result.ok).toBe(true);
      expect(result.needsConfirmation).toBe(true);
    }
  );

  test('the same sentence with and without a stray narrow word behaves identically', () => {
    // The live repro from review: these two differed only by the word "comments",
    // and that one word flipped the gate off.
    const withWord = analyzer.analyze(null, {
      foreman: false,
      description: 'Rework how we handle customer comments and complaints',
    }, {});
    const withoutWord = analyzer.analyze(null, {
      foreman: false,
      description: 'Rework how we handle customer complaints',
    }, {});
    expect(withWord.needsConfirmation).toBe(withoutWord.needsConfirmation);
    expect(withWord.needsConfirmation).toBe(true);
  });

  const GENUINELY_SMALL_USING_THE_SAME_WORDS = [
    'Rename a variable in utils.js',
    'Fix a comment that says the wrong thing',
    'Update a docstring in the parser',
  ];

  test.each(GENUINELY_SMALL_USING_THE_SAME_WORDS)(
    'the singular-article form still reads as small: %s',
    (description) => {
      const result = analyzer.analyze(null, { foreman: false, description }, {});
      expect(result.needsConfirmation).toBe(false);
      expect(result.recommendedRoute).toBe('simple');
    }
  );
});

describe('complexity-analyzer readable signals only (br-0r3)', () => {
  // The operator decision on br-0r3: score only what classify can actually read,
  // cite where each signal came from, and report what was missing rather than
  // guessing it. Team size is never readable, so it is never scored.
  const { execFileSync } = require('child_process');
  let repo;

  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  };

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'classify-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    write('packages/a/src/core.js', 'module.exports = {};\n');
    write('packages/a/src/leaf.js', 'module.exports = {};\n');
    for (let i = 0; i < 6; i++) write(`packages/a/src/user${i}.js`, "const core = require('./core');\n");
    for (let i = 0; i < 6; i++) write(`packages/b/src/use${i}.ts`, "import core from '../../a/src/core.js';\n");
    write('packages/b/src/other.ts', 'export {};\n');
    write('packages/a/src/dup.js', '\n');
    write('packages/b/src/dup.js', '\n');
    execFileSync('git', ['add', '-A'], { cwd: repo });
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  const run = (description, extra = {}) =>
    analyzer.analyze(null, { foreman: false, description, repoRoot: repo, ...extra }, {});

  test('team size is not a dimension and is always reported missing', () => {
    const result = run('Fix a typo in the README');
    expect(result.dimensions.teamSize).toBeUndefined();
    expect(result.missingDetails).toContain(analyzer.TEAM_SIZE_UNREADABLE);
  });

  test('product words that used to read as team size no longer move the score', () => {
    const plain = analyzer.analyze(null, { foreman: false, description: 'Add a settings page' }, {});
    const wordy = analyzer.analyze(null, {
      foreman: false,
      description: 'Add a settings page for users, owners, admins, operators and stakeholders',
    }, {});
    expect(wordy.score).toBe(plain.score);
  });

  test('fan-in counts require and import forms, across packages, excluding the file itself', () => {
    const facts = analyzer.collectRepoFacts('packages/a/src/core.js', repo);
    expect(facts.resolved).toHaveLength(1);
    expect(facts.resolved[0].fanIn).toBe(12);
  });

  test('the same text naming a high fan-in file scores higher than naming a leaf', () => {
    const core = run('Change the return shape of packages/a/src/core.js');
    const leaf = run('Change the return shape of packages/a/src/leaf.js');
    expect(core.score).toBeGreaterThan(leaf.score);
    expect(core.rationale.join('\n')).toContain('packages/a/src/core.js is imported by 12 files');
  });

  test('named paths spanning packages raise scope, with the packages cited', () => {
    const result = run('Update packages/a/src/leaf.js and packages/b/src/other.ts');
    expect(result.dimensions.scopeSize.score).toBe(3);
    expect(result.rationale.join('\n')).toContain('span 2 packages (packages/a, packages/b)');
  });

  test('unresolved and ambiguous paths are reported missing, never guessed', () => {
    const result = run('Fix nope.js and dup.js');
    expect(result.missingDetails).toContain('named path not found in repository: nope.js');
    expect(result.missingDetails).toContain('named path ambiguous (2 tracked matches): dup.js');
    expect(result.repoFacts.resolved).toHaveLength(0);
  });

  test('a bare filename with one tracked match resolves', () => {
    const result = run('Rename a variable in leaf.js');
    expect(result.repoFacts.resolved.map(r => r.path)).toEqual(['packages/a/src/leaf.js']);
  });

  test('without a repository root, repo facts are reported missing', () => {
    const result = analyzer.analyze(null, { foreman: false, description: 'Fix packages/a/src/core.js' }, {});
    expect(result.repoFacts.available).toBe(false);
    expect(result.missingDetails).toContain('repository facts: no repository root supplied');
  });

  test('URLs are not mistaken for paths', () => {
    expect(analyzer.extractPathMentions('See https://example.com/a/b.js and packages/a/src/core.js'))
      .toEqual(['packages/a/src/core.js']);
  });

  test('a bead supplies subject, and its type and dependencies are cited signals', () => {
    const bead = { id: 'br-x', title: 'Epic: rework billing', description: 'Rework billing', issue_type: 'epic', priority: 1, dependencies: [{ id: 'a' }, { id: 'b' }], dependents: 1 };
    const result = run('', { bead });
    expect(result.ok).toBe(true);
    expect(result.normalized.source).toBe('bead');
    expect(result.dimensions.scopeSize.score).toBe(3);
    expect(result.dimensions.dependencies.evidence).toContain('bead: 2 dependencies, 1 dependents');
  });

  test('bead priority and labels are cited but neither scored nor able to disarm the gate', () => {
    const bead = { id: 'br-y', title: 'Rework how we handle customers', priority: 0, labels: ['urgent'] };
    const result = run('', { bead });
    expect(result.rationale).toContain('bead: priority P0 (urgency; not scored)');
    expect(result.rationale).toContain('bead: labels urgent (not scored)');
    expect(result.confidence).toBe('low');
    expect(result.needsConfirmation).toBe(true);
  });

  test('option C: a single named file that nothing imports is recognisably small', () => {
    const result = run('Tweak packages/a/src/leaf.js');
    expect(result.confidence).toBe('low');
    expect(result.needsConfirmation).toBe(false);
  });

  test('option C: a bead whose only signal is its type still asks', () => {
    const result = run('', { bead: { id: 'br-z', title: 'Improve the reporting', issue_type: 'task', priority: 2 } });
    expect(result.confidence).toBe('low');
    expect(result.needsConfirmation).toBe(true);
  });

  test('the report prints missing inputs', () => {
    const report = analyzer.renderReport(run('Fix nope.js'));
    expect(report).toContain('## Missing Inputs');
    expect(report).toContain('named path not found in repository: nope.js');
  });
});
