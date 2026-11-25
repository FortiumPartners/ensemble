'use strict';

/**
 * TRD-005-TEST (TRD-2026-d571763f): policy resolution and the `engine` discovery verbs.
 *
 * Every scenario drives the real entry point `main(argv, ctx)` from `lib/ensemble-cli.js` with
 * the real `buildRegistry()`, so what is pinned is what a maintainer actually gets from
 * `ensemble engine policy|schema|verbs|doctor`, not a stand-in.
 *
 * The policy file's refusals matter beyond typos: the schema is the mechanism that keeps review
 * criteria, tone and fix strategy out of TypeScript *and* out of policy (Constitution Rule 8),
 * so a free-text value has to be refused and the refusal has to name the key.
 */

const Ajv = require('ajv');

const defaults = require('../lib/engine/policy/defaults.json');
const { POLICY_KEYS, POLICY_SCHEMA, loadPolicy } = require('../lib/engine/policy');
const { buildRegistry } = require('../lib/ensemble-cli');
const { expectMatchesOutputSchema, makeCtx, makeRoot, runMain, writeEngineYaml } =
  require('./helpers/engine-run');

function runIn(root, argv) {
  return runMain(argv, makeCtx({ cwd: root }));
}

function policyVerb() {
  return buildRegistry().get('engine', 'policy');
}

describe('policy resolution', () => {
  test('defaults apply when no repository file exists', () => {
    const root = makeRoot();
    const { values, sources, file } = loadPolicy({ projectRoot: root });

    expect(file).toEqual({ path: '.ensemble/engine.yaml', present: false });
    expect(values.max_parallel_default).toBe(defaults.max_parallel_default);
    expect(values.design_readiness_pass).toBe(defaults.design_readiness_pass);
    expect(values.staleness_hours).toBe(defaults.staleness_hours);
    for (const key of POLICY_KEYS) expect(sources[key]).toBe('default');
  });

  test('repository override wins and reports source repo', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'design_readiness_pass: 3.5\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'policy', '--json']);

    expect(exitCode).toBe(0);
    expect(envelope.status).toBe('OK');
    expect(envelope.data.file).toEqual({ path: '.ensemble/engine.yaml', present: true });
    expect(envelope.data.policy.design_readiness_pass).toEqual({ source: 'repo', value: 3.5 });
    expect(envelope.data.policy.staleness_hours).toEqual({
      source: 'default',
      value: defaults.staleness_hours,
    });
    expectMatchesOutputSchema(policyVerb(), envelope);
  });

  test('every effective value is printed with its source', () => {
    const root = makeRoot();
    const { envelope } = runIn(root, ['engine', 'policy']);

    expect(Object.keys(envelope.data.policy).sort()).toEqual([...POLICY_KEYS].sort());
    for (const key of POLICY_KEYS) {
      expect(envelope.data.policy[key].source).toBe('default');
      expect(envelope.data.policy[key].value).toEqual(defaults[key]);
    }
  });

  test('unknown key is refused naming it, and defaults are not used', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'no_such_policy_key: 7\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'policy']);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('POLICY_UNKNOWN_KEY');
    expect(envelope.error.message).toContain('no_such_policy_key');
    expect(envelope.data).toBeUndefined();
  });

  test('wrong type is refused naming the key', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'max_parallel_default: many\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'policy']);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('POLICY_INVALID_VALUE');
    expect(envelope.error.message).toContain('max_parallel_default');
  });

  test('malformed YAML is refused and the defaults are not silently used', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'design_readiness_pass: [3.5\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'policy']);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('POLICY_YAML_INVALID');
    expect(envelope.data).toBeUndefined();
  });

  test('a non-mapping root is refused', () => {
    const root = makeRoot();
    writeEngineYaml(root, '- design_readiness_pass\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'policy']);

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('POLICY_NOT_A_MAPPING');
  });

  test('an empty file is a present file with no overrides', () => {
    const root = makeRoot();
    writeEngineYaml(root, '');

    const { values, sources, file } = loadPolicy({ projectRoot: root });

    expect(file.present).toBe(true);
    expect(values).toEqual(defaults);
    for (const key of POLICY_KEYS) expect(sources[key]).toBe('default');
  });

  test('a 500-character free-text value is refused naming the key', () => {
    const root = makeRoot();
    const sentence = `Review every function for ${'clarity and intent '.repeat(30)}`.slice(0, 500);
    expect(sentence).toHaveLength(500);
    writeEngineYaml(root, `default_strategy: "${sentence}"\n`);

    const { envelope, exitCode } = runIn(root, ['engine', 'policy']);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('default_strategy');
  });

  test('a table override replaces the shipped table', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'strategy_detection:\n  legacy: refactor\n');

    const { values, sources } = loadPolicy({ projectRoot: root });

    expect(values.strategy_detection).toEqual({ legacy: 'refactor' });
    expect(sources.strategy_detection).toBe('repo');
  });

  test('a table value outside the strategy enum is refused naming the key', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'strategy_detection:\n  legacy: whatever-the-model-feels\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'policy']);

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('POLICY_INVALID_VALUE');
    expect(envelope.error.message).toContain('strategy_detection');
  });

  test('warn above pass is refused', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'design_readiness_warn: 4.5\ndesign_readiness_pass: 4.0\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'policy']);

    expect(exitCode).toBe(2);
    expect(envelope.error.code).toBe('POLICY_BAND_ORDER');
  });
});

describe('policy schema shape (Rule 8)', () => {
  test('the shipped defaults validate against the policy schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    expect(ajv.validate(POLICY_SCHEMA, defaults)).toBe(true);
  });

  test('a mutated copy of the defaults does not validate', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const mutated = { ...defaults, max_parallel_default: 'three' };
    expect(ajv.validate(POLICY_SCHEMA, mutated)).toBe(false);
  });

  test('no free-text field longer than 80 characters is accepted anywhere', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const long = 'x'.repeat(81);
    for (const key of POLICY_KEYS) {
      const candidate = { ...defaults, [key]: long };
      expect(ajv.validate(POLICY_SCHEMA, candidate)).toBe(false);
    }
  });

  test('every policy value is a number, a boolean, an enumerated string or a table of them', () => {
    const allowed = new Set(['boolean', 'integer', 'number', 'string', 'object']);
    for (const key of POLICY_KEYS) {
      const property = POLICY_SCHEMA.properties[key];
      expect(property).toBeDefined();
      expect(allowed.has(property.type)).toBe(true);
      if (property.type === 'string') expect(Array.isArray(property.enum)).toBe(true);
      if (property.type === 'object') {
        expect(property.additionalProperties.enum).toBeDefined();
        expect(property.propertyNames.maxLength).toBeLessThanOrEqual(80);
      }
    }
  });
});

describe('engine discovery verbs', () => {
  test('engine verbs lists every registered verb from the registry', () => {
    const root = makeRoot();
    const registry = buildRegistry();
    const { envelope, exitCode } = runIn(root, ['engine', 'verbs']);

    expect(exitCode).toBe(0);
    expect(envelope.data.verbs).toEqual(
      registry.verbs().map(s => ({
        group: s.group,
        name: s.name,
        sideEffect: s.sideEffect,
        summary: s.summary,
      }))
    );
    expectMatchesOutputSchema(registry.get('engine', 'verbs'), envelope);
  });

  test('engine schema prints exactly the schemas the registry holds', () => {
    const root = makeRoot();
    const registry = buildRegistry();
    const spec = registry.get('engine', 'policy');
    const { envelope, exitCode } = runIn(root, ['engine', 'schema', 'engine.policy']);

    expect(exitCode).toBe(0);
    expect(envelope.data).toEqual({
      group: 'engine',
      inputSchema: spec.inputSchema,
      name: 'policy',
      outputSchema: spec.outputSchema,
    });
    expectMatchesOutputSchema(registry.get('engine', 'schema'), envelope);
  });

  test('engine schema refuses an unknown verb with nearest verbs', () => {
    const root = makeRoot();
    const { envelope, exitCode } = runIn(root, ['engine', 'schema', 'engine.polcy']);

    expect(exitCode).toBe(2);
    expect(envelope.status).toBe('INVALID_INPUT');
    expect(envelope.error.code).toBe('UNKNOWN_VERB');
    expect(envelope.error.details.nearestVerbs).toContain('engine policy');
  });

  test('engine doctor reports the CLI path, Node version, project root and the parsed file', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'staleness_hours: 48\n');
    const registry = buildRegistry();
    const { envelope, exitCode } = runIn(root, ['engine', 'doctor']);

    expect(exitCode).toBe(0);
    expect(envelope.data.cliPath).toContain('ensemble-cli.js');
    expect(envelope.data.nodeVersion).toBe(process.version);
    expect(envelope.data.projectRoot).toBe(root);
    expect(envelope.data.engineYaml).toEqual({
      error: null,
      parsed: true,
      path: '.ensemble/engine.yaml',
      present: true,
    });
    expectMatchesOutputSchema(registry.get('engine', 'doctor'), envelope);
  });

  test('engine doctor reports a broken engine.yaml instead of refusing', () => {
    const root = makeRoot();
    writeEngineYaml(root, 'staleness_hours: [48\n');

    const { envelope, exitCode } = runIn(root, ['engine', 'doctor']);

    expect(exitCode).toBe(0);
    expect(envelope.status).toBe('OK');
    expect(envelope.data.engineYaml.parsed).toBe(false);
    expect(typeof envelope.data.engineYaml.error).toBe('string');
  });

  test('every registered verb only declares policy keys the loader knows', () => {
    for (const spec of buildRegistry().verbs()) {
      for (const key of spec.policyKeys) expect(POLICY_KEYS).toContain(key);
    }
  });
});
