'use strict';

/**
 * Parity suite (TRD-2026-8d825f54 TRD-025): `runCapability` (async, `execFile`) and
 * `runCapabilitySync` (sync, `execFileSync`, TRD-025) share every guard in
 * `packages/development/lib/toolchain/runner.js` -- capability lookup, argv building, the
 * runtime allowlist re-check, child-environment filtering, `TOOL_FAILED` detail redaction, the
 * zero-exit stdout-error-envelope check, `mapOutput`, and the error taxonomy
 * (`NOT_ALLOWED`/`INVALID_ARG`/`TIMEOUT`/`TOOL_FAILED`/`BAD_OUTPUT`) -- because both call the
 * exact same extracted helper functions. Every test here calls BOTH entry points against the
 * SAME manifest/capability/args and asserts identical envelopes, proving the two can never
 * silently diverge.
 *
 * `faketool` (a tiny executable Node script under a throwaway temp dir, referenced by its
 * absolute path so no `PATH` lookup/mutation is involved) stands in for the real binary a
 * resolved adapter would declare; no real `br`/`bv` is ever invoked by this file.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCapability, runCapabilitySync } = require('../lib/toolchain/runner');

let dir;
let bin;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-sync-parity-'));
  bin = path.join(dir, 'faketool');
  fs.writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      'const cmd = process.argv[2];',
      "if (cmd === 'echo') {",
      "  process.stdout.write(JSON.stringify({ hello: 'world' }));",
      "} else if (cmd === 'wrapped') {",
      "  process.stdout.write(JSON.stringify({ items: [{ id: 'x' }] }));",
      "} else if (cmd === 'env') {",
      '  process.stdout.write(JSON.stringify(process.env));',
      "} else if (cmd === 'fail') {",
      "  process.stderr.write('boom from stderr');",
      '  process.exit(7);',
      // br prints its JSON error object on STDOUT and exits non-zero with an EMPTY stderr.
      "} else if (cmd === 'envfail') {",
      "  process.stdout.write(JSON.stringify({ error: { code: 'NOT_INITIALIZED', message: 'no .beads here', hint: 'run br init' } }));",
      '  process.exit(1);',
      "} else if (cmd === 'envfail-stderr') {",
      "  process.stderr.write('real stderr detail');",
      "  process.stdout.write(JSON.stringify({ error: { code: 'SHOULD_NOT_WIN', message: 'x' } }));",
      '  process.exit(1);',
      "} else if (cmd === 'envfail-secret') {",
      "  process.stdout.write(JSON.stringify({ error: { code: 'CONFIG_ERROR', hint: 'password=hunter2secretvalue' } }));",
      '  process.exit(1);',
      "} else if (cmd === 'envfail-quoted-secret') {",
      "  process.stdout.write(JSON.stringify({ error: { code: 'CONFIG_ERROR', hint: 'password=\"hunter2quotedvalue\"', details: [{ note: 'api_key=\"nestedquotedvalue\"' }] } }));",
      '  process.exit(1);',
      "} else if (cmd === 'envzero-quoted-secret') {",
      "  process.stdout.write(JSON.stringify({ error: { code: 'CONFIG_ERROR', hint: 'password=\"hunter2quotedvalue\"' } }));",
      "} else if (cmd === 'envfail-long') {",
      "  process.stdout.write(JSON.stringify({ error: { code: 'VALIDATION_FAILED', hint: 'z'.repeat(20000) } }));",
      '  process.exit(1);',
      "} else if (cmd === 'plainfail') {",
      "  process.stdout.write(JSON.stringify([{ id: 'not-an-error-envelope' }]));",
      '  process.exit(1);',
      "} else if (cmd === 'sleep') {",
      "  setTimeout(() => process.stdout.write('done'), 5000);",
      // 3 MiB of stdout: well over Node's own 1 MiB execFile*/execFileSync default maxBuffer,
      // well under this runner's 64 MiB DEFAULT_MAX_BUFFER_BYTES -- PR 6 review item 1
      // (`runCapabilitySync` must apply the SAME default as `runCapability`, not Node's bare
      // 1 MiB one).
      "} else if (cmd === 'largeOutput') {",
      "  process.stdout.write(JSON.stringify({ items: [{ id: 'x', filler: 'y'.repeat(3 * 1024 * 1024) }] }));",
      '} else {',
      "  process.stderr.write('unknown cmd ' + cmd);",
      '  process.exit(2);',
      '}',
      ''
    ].join('\n')
  );
  fs.chmodSync(bin, 0o755);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function adapter(overrides = {}) {
  return {
    adapter: 'faketool-adapter',
    binaries: [bin],
    allowlist: [{ bin, sub: ['echo', 'wrapped', 'env', 'fail', 'sleep', 'largeOutput', 'envfail', 'envfail-stderr', 'envfail-secret', 'envfail-quoted-secret', 'envzero-quoted-secret', 'envfail-long', 'plainfail'] }],
    env: ['FAKE_TOOL_TOKEN'],
    capabilities: {
      'test.echo': { run: [bin, 'echo'] },
      'test.wrapped': {
        run: [bin, 'wrapped'],
        parse: { format: 'json', root: '$', map: { items: '$.items' } }
      },
      'test.env': { run: [bin, 'env'] },
      'test.fail': { run: [bin, 'fail'] },
      'test.envfail': { run: [bin, 'envfail'] },
      'test.envfail-stderr': { run: [bin, 'envfail-stderr'] },
      'test.envfail-secret': { run: [bin, 'envfail-secret'] },
      'test.envfail-quoted-secret': { run: [bin, 'envfail-quoted-secret'] },
      'test.envzero-quoted-secret': { run: [bin, 'envzero-quoted-secret'] },
      'test.envfail-long': { run: [bin, 'envfail-long'] },
      'test.plainfail': { run: [bin, 'plainfail'] },
      'test.sleep': { run: [bin, 'sleep'] },
      'test.badarg': { run: [bin, 'echo', '{missingArg}'] },
      'test.unlisted-binary': { run: ['/definitely/not/on/the/allowlist', 'x'] },
      'test.largeOutput': {
        run: [bin, 'largeOutput'],
        parse: { format: 'json', root: '$', map: { items: '$.items' } }
      },
      ...overrides
    }
  };
}

describe('runCapability vs runCapabilitySync: identical envelopes for every guard', () => {
  test('capability not declared by the adapter -> same NOT_ALLOWED envelope', async () => {
    const a = await runCapability(adapter(), 'test.nope', {}, {});
    const s = runCapabilitySync(adapter(), 'test.nope', {}, {});
    expect(s).toEqual(a);
    expect(a).toEqual({
      ok: false,
      error: { code: 'NOT_ALLOWED', message: "capability 'test.nope' is not declared by adapter 'faketool-adapter'" }
    });
  });

  test('missing required arg (no default) -> same INVALID_ARG envelope', async () => {
    const a = await runCapability(adapter(), 'test.badarg', {}, {});
    const s = runCapabilitySync(adapter(), 'test.badarg', {}, {});
    expect(s).toEqual(a);
    expect(a).toEqual({
      ok: false,
      error: { code: 'INVALID_ARG', message: "'missingArg': no value supplied and the contract declares no default" }
    });
  });

  test('argv resolves to a binary outside allowlist -> same NOT_ALLOWED envelope (runtime allowlist re-check)', async () => {
    const a = await runCapability(adapter(), 'test.unlisted-binary', {}, {});
    const s = runCapabilitySync(adapter(), 'test.unlisted-binary', {}, {});
    expect(s).toEqual(a);
    expect(a.ok).toBe(false);
    expect(a.error.code).toBe('NOT_ALLOWED');
    expect(a.error.message).toMatch(/not declared in 'binaries'/);
  });

  test('success, no parse block -> same ok:true envelope with raw stdout as data', async () => {
    const a = await runCapability(adapter(), 'test.echo', {}, { source: 'default' });
    const s = runCapabilitySync(adapter(), 'test.echo', {}, { source: 'default' });
    expect(s).toEqual(a);
    expect(a).toEqual({
      ok: true,
      capability: 'test.echo',
      adapter: 'faketool-adapter',
      source: 'default',
      data: '{"hello":"world"}'
    });
  });

  test('success, with a parse block (non-tracker category, no schema gate) -> same mapped data', async () => {
    const a = await runCapability(adapter(), 'test.wrapped', {}, {});
    const s = runCapabilitySync(adapter(), 'test.wrapped', {}, {});
    expect(s).toEqual(a);
    expect(a).toEqual({
      ok: true,
      capability: 'test.wrapped',
      adapter: 'faketool-adapter',
      source: null,
      data: { items: [{ id: 'x' }] }
    });
  });

  test('non-zero exit with stderr -> same TOOL_FAILED envelope, redacted/bounded detail included verbatim', async () => {
    const a = await runCapability(adapter(), 'test.fail', {}, {});
    const s = runCapabilitySync(adapter(), 'test.fail', {}, {});
    expect(s).toEqual(a);
    expect(a).toEqual({
      ok: false,
      error: { code: 'TOOL_FAILED', message: "faketool-adapter: capability 'test.fail' failed: boom from stderr" }
    });
  });

  describe('non-zero exit with an EMPTY stderr: the tool\'s own stdout error envelope is the detail', () => {
    test("br-style {error:{code,message,hint}} on stdout -> TOOL_FAILED message carries the tool's own code, identically for both entry points", async () => {
      const a = await runCapability(adapter(), 'test.envfail', {}, {});
      const s = runCapabilitySync(adapter(), 'test.envfail', {}, {});
      expect(s).toEqual(a);
      expect(a.ok).toBe(false);
      expect(a.error.code).toBe('TOOL_FAILED');
      expect(a.error.message).toContain('NOT_INITIALIZED');
      expect(a.error.message).toContain('run br init');
      expect(a.error.message).not.toMatch(/Command failed/);
    });

    test('non-empty stderr still wins over a stdout envelope', async () => {
      const a = await runCapability(adapter(), 'test.envfail-stderr', {}, {});
      const s = runCapabilitySync(adapter(), 'test.envfail-stderr', {}, {});
      expect(s).toEqual(a);
      expect(a.error.message).toBe("faketool-adapter: capability 'test.envfail-stderr' failed: real stderr detail");
    });

    test('stdout that is not an error envelope (a JSON array) falls back to the Node error message', async () => {
      const a = await runCapability(adapter(), 'test.plainfail', {}, {});
      const s = runCapabilitySync(adapter(), 'test.plainfail', {}, {});
      expect(a.error.code).toBe('TOOL_FAILED');
      expect(s.error.code).toBe('TOOL_FAILED');
      expect(a.error.message).toMatch(/Command failed/);
      expect(s.error.message).toMatch(/Command failed/);
      expect(a.error.message).not.toContain('not-an-error-envelope');
      expect(s.error.message).not.toContain('not-an-error-envelope');
    });

    test('the envelope detail is redacted and length-bounded like stderr', async () => {
      const a = await runCapability(adapter(), 'test.envfail-secret', {}, {});
      const s = runCapabilitySync(adapter(), 'test.envfail-secret', {}, {});
      expect(s).toEqual(a);
      expect(a.error.message).toContain('CONFIG_ERROR');
      expect(a.error.message).not.toContain('hunter2secretvalue');

      const la = await runCapability(adapter(), 'test.envfail-long', {}, {});
      const ls = runCapabilitySync(adapter(), 'test.envfail-long', {}, {});
      expect(ls).toEqual(la);
      expect(la.error.message).toContain('[truncated]');
      expect(la.error.message.length).toBeLessThan(5000);
    });

    // JSON escapes the embedded quotes of password="..." to \", which the key-value-secret
    // pattern does not match once the envelope is serialized -- every string leaf must be
    // redacted BEFORE JSON.stringify.
    test('a double-quoted secret in the envelope detail is redacted (non-zero exit, both entry points)', async () => {
      const a = await runCapability(adapter(), 'test.envfail-quoted-secret', {}, {});
      const s = runCapabilitySync(adapter(), 'test.envfail-quoted-secret', {}, {});
      expect(s).toEqual(a);
      expect(a.error.code).toBe('TOOL_FAILED');
      expect(a.error.message).toContain('CONFIG_ERROR');
      expect(a.error.message).toContain('[REDACTED:key-value-secret]');
      expect(a.error.message).not.toContain('hunter2quotedvalue');
      expect(a.error.message).not.toContain('nestedquotedvalue');
    });

    test('a double-quoted secret in a zero-exit stdout error envelope is redacted (both entry points)', async () => {
      const a = await runCapability(adapter(), 'test.envzero-quoted-secret', {}, {});
      const s = runCapabilitySync(adapter(), 'test.envzero-quoted-secret', {}, {});
      expect(s).toEqual(a);
      expect(a.error.code).toBe('TOOL_FAILED');
      expect(a.error.message).toContain('[REDACTED:key-value-secret]');
      expect(a.error.message).not.toContain('hunter2quotedvalue');
    });
  });

  test('env filtering: only BASE_ENV_ALLOWLIST + declared env[] names reach the child, identically for both entry points', async () => {
    const parentEnv = {
      PATH: process.env.PATH,
      FAKE_TOOL_TOKEN: 'secret-value',
      UNRELATED_SECRET: 'should-not-pass'
    };
    const a = await runCapability(adapter(), 'test.env', {}, { parentEnv });
    const s = runCapabilitySync(adapter(), 'test.env', {}, { parentEnv });
    expect(a.ok).toBe(true);
    expect(s.ok).toBe(true);
    const envA = JSON.parse(a.data);
    const envS = JSON.parse(s.data);
    expect(envA.FAKE_TOOL_TOKEN).toBe('secret-value');
    expect(envS.FAKE_TOOL_TOKEN).toBe('secret-value');
    expect(envA.UNRELATED_SECRET).toBeUndefined();
    expect(envS.UNRELATED_SECRET).toBeUndefined();
    // Same allowed KEY SET from both entry points given the identical parentEnv/manifest.
    expect(Object.keys(envS).sort()).toEqual(Object.keys(envA).sort());
  });

  test(
    'timeout -> same TIMEOUT envelope naming the adapter, capability and configured timeout',
    async () => {
      const a = await runCapability(adapter(), 'test.sleep', {}, { timeoutMs: 200 });
      const s = runCapabilitySync(adapter(), 'test.sleep', {}, { timeoutMs: 200 });
      expect(s).toEqual(a);
      expect(a).toEqual({
        ok: false,
        error: {
          code: 'TIMEOUT',
          message:
            "faketool-adapter: capability 'test.sleep' (timeout class 'short') exceeded its timeout of 200ms and was killed"
        }
      });
    },
    15000
  );

  test(
    "large output (3 MiB, over Node's own 1 MiB execFile*/execFileSync default maxBuffer) -> both entry points succeed via this runner's own 64 MiB DEFAULT_MAX_BUFFER_BYTES default, with mapOutput applied identically (PR 6 review item 1)",
    async () => {
      const a = await runCapability(adapter(), 'test.largeOutput', {}, {});
      const s = runCapabilitySync(adapter(), 'test.largeOutput', {}, {});
      expect(a.ok).toBe(true);
      expect(s.ok).toBe(true);
      expect(a.data.items).toHaveLength(1);
      expect(a.data.items[0].id).toBe('x');
      expect(a.data.items[0].filler).toHaveLength(3 * 1024 * 1024);
      expect(s).toEqual(a);
    },
    15000
  );

  test('output beyond an explicitly injected small maxBuffer override fails closed with the SAME error code for both entry points (PR 6 review item 1)', async () => {
    const a = await runCapability(adapter(), 'test.largeOutput', {}, { execFileOptions: { maxBuffer: 1024 } });
    const s = runCapabilitySync(adapter(), 'test.largeOutput', {}, { execFileOptions: { maxBuffer: 1024 } });
    expect(a.ok).toBe(false);
    expect(s.ok).toBe(false);
    // Same CODE (never a real timeout misclassification): message text differs because each
    // entry point's underlying Node error object differs (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`
    // for `execFile`, `ENOBUFS` for `execFileSync`), but both are output-size failures, never
    // the TIMEOUT taxonomy branch.
    expect(a.error.code).toBe('TOOL_FAILED');
    expect(s.error.code).toBe('TOOL_FAILED');
  });

  describe('mutation-proof: removing the default maxBuffer from runCapabilitySync', () => {
    test("the real (unmutated) runCapabilitySync still succeeds on 3 MiB of stdout (same as the test above)", () => {
      const s = runCapabilitySync(adapter(), 'test.largeOutput', {}, {});
      expect(s.ok).toBe(true);
    });

    test("reverting runCapabilitySync's own 'maxBuffer: DEFAULT_MAX_BUFFER_BYTES,' (the execFileSync options block) makes the SAME 3 MiB output fail closed under Node's bare 1 MiB default", () => {
      const { makeMutantToolchainRoot, mutateAndRequire } = require('../../../scripts/tests/fixtures/toolchain/mutant-toolchain-copy');
      const mutantRoot = makeMutantToolchainRoot();
      try {
        const needle =
          'stdout = execFileSync(argv[0], argv.slice(1), {\n' + '      maxBuffer: DEFAULT_MAX_BUFFER_BYTES,';
        const replacement = 'stdout = execFileSync(argv[0], argv.slice(1), {';
        const mutated = mutateAndRequire(mutantRoot.runnerPath, needle, replacement);

        const result = mutated.runCapabilitySync(adapter(), 'test.largeOutput', {}, {});
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('TOOL_FAILED');
      } finally {
        mutantRoot.cleanup();
      }
    });
  });
});

describe('TRD-028: per-class timeout bounds (PRD AC-017-1)', () => {
  const yaml = require('js-yaml');
  const Ajv = require('ajv');
  const DEV = path.join(__dirname, '..');
  const manifestSchema = require('../toolchain/schemas/adapter-manifest-schema.json');
  const { resolveCapabilityTimeout } = require('../lib/toolchain/runner');
  const { parseToolchainConfigText } = require('../lib/toolchain/config');

  const loadYaml = (rel) => yaml.load(fs.readFileSync(path.join(DEV, rel), 'utf8'));

  // A never-exiting child: a real process that keeps its event loop alive forever.
  function hangAdapter(extra = {}, capExtra = {}) {
    return {
      adapter: 'faketool-adapter',
      binaries: [bin],
      allowlist: [{ bin, sub: ['hang'] }],
      env: [],
      capabilities: { 'test.hang': { run: [bin, 'hang'], ...capExtra } },
      ...extra
    };
  }

  beforeAll(() => {
    const src = fs.readFileSync(bin, 'utf8');
    fs.writeFileSync(
      bin,
      src.replace("if (cmd === 'echo') {", "if (cmd === 'hang') {\n  setInterval(() => {}, 1000);\n} else if (cmd === 'echo') {")
    );
  });

  test('never-exiting tool: TIMEOUT names capability, class and bound; sync and async identical', async () => {
    const m = hangAdapter({ timeouts: { short: 150, long: 900 } }, { timeoutClass: 'short' });
    const a = await runCapability(m, 'test.hang', {}, {});
    const s = runCapabilitySync(m, 'test.hang', {}, {});
    expect(s).toEqual(a);
    expect(a.ok).toBe(false);
    expect(a.error.code).toBe('TIMEOUT');
    expect(a.error.message).toBe(
      "faketool-adapter: capability 'test.hang' (timeout class 'short') exceeded its timeout of 150ms and was killed"
    );
  }, 15000);

  test('long class uses the long bound and names it', async () => {
    const m = hangAdapter({ timeouts: { short: 5000, long: 200 } }, { timeoutClass: 'long' });
    const a = await runCapability(m, 'test.hang', {}, {});
    const s = runCapabilitySync(m, 'test.hang', {}, {});
    expect(s).toEqual(a);
    expect(a.error.message).toContain("(timeout class 'long') exceeded its timeout of 200ms");
  }, 15000);

  test('project timeouts beat the manifest; both entry points report the project bound', async () => {
    const m = hangAdapter({ timeouts: { short: 5000, long: 5000 } }, { timeoutClass: 'long' });
    const opts = { timeouts: { long: 180 } };
    const a = await runCapability(m, 'test.hang', {}, opts);
    const s = runCapabilitySync(m, 'test.hang', {}, opts);
    expect(s).toEqual(a);
    expect(a.error.message).toContain("(timeout class 'long') exceeded its timeout of 180ms");
  }, 15000);

  test('precedence: opts.timeoutMs > project > manifest > default 60000; class defaults to short', () => {
    const cap = (c) => ({ ...(c ? { timeoutClass: c } : {}) });
    const m = { timeouts: { short: 11, long: 22 } };
    expect(resolveCapabilityTimeout(m, cap(), {})).toEqual({ timeoutClass: 'short', boundMs: 11 });
    expect(resolveCapabilityTimeout(m, cap('long'), {})).toEqual({ timeoutClass: 'long', boundMs: 22 });
    expect(resolveCapabilityTimeout(m, cap('long'), { timeouts: { long: 33 } })).toEqual({ timeoutClass: 'long', boundMs: 33 });
    expect(resolveCapabilityTimeout(m, cap('long'), { timeouts: { short: 44 } }).boundMs).toBe(22);
    expect(resolveCapabilityTimeout(m, cap('long'), { timeouts: { long: 33 }, timeoutMs: 55 }).boundMs).toBe(55);
    expect(resolveCapabilityTimeout({}, cap('long'), {})).toEqual({ timeoutClass: 'long', boundMs: 60000 });
    expect(resolveCapabilityTimeout({ timeouts: { short: 11 } }, cap('long'), {}).boundMs).toBe(60000);
  });

  test('beads effective short and long bounds are both 60000 (no behavior change)', () => {
    const beads = loadYaml('skills/adapter-tracker-beads/adapter.yaml');
    expect(resolveCapabilityTimeout(beads, { timeoutClass: 'short' }, {}).boundMs).toBe(60000);
    expect(resolveCapabilityTimeout(beads, { timeoutClass: 'long' }, {}).boundMs).toBe(60000);
    expect(beads.timeouts).toEqual({ short: 60000, long: 60000 });
    for (const [name, cap] of Object.entries(beads.capabilities)) {
      if (cap.run) expect([name, ['short', 'long'].includes(cap.timeoutClass)]).toEqual([name, true]);
    }
    expect(beads.capabilities['tracker.show'].timeoutClass).toBe('short');
    expect(beads.capabilities['tracker.sync'].timeoutClass).toBe('long');
  });

  test('kata declares short 60000, long 120000 and classes every argv capability', () => {
    const kata = loadYaml('skills/adapter-tracker-kata/adapter.yaml');
    expect(kata.timeouts).toEqual({ short: 60000, long: 120000 });
    for (const [name, cap] of Object.entries(kata.capabilities)) {
      if (cap.run) expect([name, ['short', 'long'].includes(cap.timeoutClass)]).toEqual([name, true]);
    }
    expect(kata.capabilities['tracker.show'].timeoutClass).toBe('short');
    expect(kata.capabilities['tracker.create'].timeoutClass).toBe('long');
  });

  describe('schemas', () => {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(manifestSchema);
    const base = () => loadYaml('skills/adapter-tracker-kata/adapter.yaml');

    test('shipped kata and beads manifests validate', () => {
      expect(validate(base())).toBe(true);
      expect(validate(loadYaml('skills/adapter-tracker-beads/adapter.yaml'))).toBe(true);
    });
    test('accepts valid timeouts and timeoutClass values', () => {
      const m = base();
      m.timeouts = { short: 1, long: 999999 };
      m.capabilities['tracker.show'].timeoutClass = 'long';
      expect(validate(m)).toBe(true);
    });
    test.each([
      [{ short: 0, long: 1 }],
      [{ short: 1.5 }],
      [{ short: '60' }],
      [{ short: 1, bogus: 2 }],
      ['fast']
    ])('rejects manifest timeouts %j', (bad) => {
      const m = base();
      m.timeouts = bad;
      expect(validate(m)).toBe(false);
    });
    test('rejects an unknown timeoutClass', () => {
      const m = base();
      m.capabilities['tracker.show'].timeoutClass = 'medium';
      expect(validate(m)).toBe(false);
    });
  });

  describe('project config', () => {
    test('accepts positive-integer short/long timeouts', () => {
      expect(parseToolchainConfigText('timeouts:\n  short: 5000\n  long: 90000\n', 'x')).toEqual({
        timeouts: { short: 5000, long: 90000 }
      });
      expect(parseToolchainConfigText('timeouts:\n  long: 90000\n', 'x').timeouts).toEqual({ long: 90000 });
    });
    test.each([
      ['timeouts:\n  short: 0\n'],
      ['timeouts:\n  long: -5\n'],
      ['timeouts:\n  short: 1.5\n'],
      ['timeouts:\n  short: fast\n'],
      ['timeouts:\n  medium: 5\n'],
      ['timeouts: 5\n']
    ])('rejects %j naming the config', (text) => {
      expect(() => parseToolchainConfigText(text, 'proj.yaml')).toThrow(/proj\.yaml: invalid toolchain config/);
    });
  });
});
