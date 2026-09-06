'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const analyzer = require('../lib/complexity-analyzer');

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

  test('command YAML declares generated artifact and Foreman contracts', () => {
    const commandPath = path.join(__dirname, '../commands/analyze-complexity.yaml');
    const command = fs.readFileSync(commandPath, 'utf8');
    expect(command).toContain('name: ensemble:analyze-complexity');
    expect(command).toContain('output_path: ensemble/analyze-complexity.md');
    for (const name of ['description', 'route', 'no-adaptive-planning', 'foreman']) {
      expect(command).toContain(`name: ${name}`);
    }
    expect(command).toContain('FOREMAN_ARTIFACT_PATH');
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
