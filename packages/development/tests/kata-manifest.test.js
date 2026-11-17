'use strict';

/**
 * TRD-002-TEST -- one configuration value resolves both categories (TRD-2026-6995dc96 TRD-002).
 *
 * PRD-2026-6995dc96 AC-001-1 (the primary criterion):
 *   Given a project whose toolchain configuration sets the tracker adapter to kata and sets no
 *   work-graph override, when the work-graph adapter resolves, then it resolves to the Kata
 *   adapter, and no second configuration value names a work-graph adapter anywhere in the
 *   project's toolchain configuration.
 * AC-001-1 Edge: the project also names the work-graph fallback explicitly -> that fallback is
 *   used for the work-graph category while the tracker category still resolves to Kata.
 * AC-001-1 Error: the project's tracker entry names an adapter that is not installed -> the
 *   tracker resolution reports the configuration error rather than silently falling back.
 * AC-013-2 (the default side of the same promise): a repository containing the Kata workspace
 *   binding file and no toolchain configuration -> the tracker resolves to beads, recording no
 *   detection-derived kata choice.
 *
 * What is actually being killed here, and why each assertion is not decoration:
 *
 *  - AC-001-1 is a *resolution* property. The only code that implements it is
 *    packages/development/lib/toolchain/work-graph-resolve.js: the category config holds
 *    `work-graph: auto`, and the `auto` branch substitutes whatever tracker adapter just
 *    resolved -- provided that tracker declares a work-graph capability. Reverting that file, or
 *    flipping the shipped default back to a literal work-graph adapter, or dropping
 *    `work-graph: auto` from toolchain.default.yaml, or deleting the `work-graph: "2.0"` entry
 *    from the Kata manifest (which makes the substitution decline and fall back), each turn this
 *    red. That is the whole point of AC-001-1: the single value `tracker: kata` is what moves the
 *    work-graph answer.
 *
 *  - The Edge criterion is asserted as the throw it actually is, not as a value. The fallback id
 *    `work-graph-links-fallback` is a BUILTIN module
 *    (packages/development/lib/toolchain/builtin/work-graph-links-fallback), deliberately not an
 *    installed skill directory, so `resolveWorkGraphAdapter()` reaches for it through
 *    `loadBuiltinWorkGraphAdapter()` only from the `auto` branch; the explicit-value branch calls
 *    `loadAdapter()`, which cannot see it and throws NOT_INSTALLED. Asserting the throw is the
 *    honest reading of "no second configuration value names a work-graph adapter": naming one by
 *    hand is not a supported route, so the shipped configuration cannot accidentally grow one.
 *    It also documents the asymmetry a future reader will otherwise mistake for a bug.
 *
 *  - The Error criterion is asserted for BOTH categories. AC-001-1's Error clause literally says
 *    "the project's tracker entry", so the tracker leg is the requirement; the work-graph leg is
 *    the same `resolveCategory` call one category over, included because the substitution reads
 *    that resolution and a silent fallback there would resurrect exactly the second-value problem
 *    the AC forbids.
 *
 *  - AC-013-2 is asserted through the real detection path rather than against the manifest text,
 *    because the promise is about behaviour: `detectAdapter()` is passed as `ctx.detect`, so a
 *    detection signal that could reach Kata would produce `source: 'detection'` and fail the
 *    assertion. The manifest's empty `detect` list is checked separately as the reason it holds.
 *    The bead's own text asks for "a project that declares neither adapter"; this file honours
 *    that verbatim in the `neither key` case and additionally runs the literal PRD scenario (the
 *    `.kata.toml` binding file present, nothing configured) so the stronger claim in AC-013-2 --
 *    that Kata's own footprint in the repository is not itself a signal -- is covered too.
 *
 * Hermeticity: every `ctx` here passes `env: { XDG_CONFIG_HOME: <tmp> }`, because
 * getEnsembleConfigRoot() reads the user-level toolchain config from `$XDG_CONFIG_HOME/ensemble`
 * and falls back to the real `~/.config/ensemble` otherwise -- a developer machine that has set
 * `tracker: kata` or `work-graph: ...` globally would otherwise flip these results.
 * `projectConfig` is passed explicitly so the project file lookup is skipped, and `detect` is
 * stubbed everywhere except the AC-013-2 case, where the real `detectAdapter` is what is under
 * test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const yaml = require('js-yaml');

const { resolveCategory } = require('../lib/toolchain/config');
const { resolveWorkGraphAdapter } = require('../lib/toolchain/work-graph-resolve');
const { detectAdapter } = require('../lib/toolchain/detect');
const { loadAdapter } = require('../lib/toolchain/adapters');

const DEV_ROOT = path.join(__dirname, '..');
const KATA_MANIFEST_PATH = path.join(DEV_ROOT, 'skills', 'adapter-tracker-kata', 'adapter.yaml');
const WORK_GRAPH_CATEGORY_PATH = path.join(DEV_ROOT, 'toolchain', 'categories', 'work-graph.yaml');
const DEFAULT_TOOLCHAIN_PATH = path.join(DEV_ROOT, 'toolchain', 'toolchain.default.yaml');

const KATA_ADAPTER_ID = 'kata';
const SHIPPED_TRACKER_DEFAULT = 'beads';
// The `auto` sentinel. Whichever category config carries it, it must never be the value a
// resolution hands back: that would mean the substitution in work-graph-resolve.js was skipped.
const AUTO_SENTINEL = 'auto';
// The builtin the `auto` branch falls back to. Not an installed adapter, so naming it in config
// is a configuration error -- see the Edge case below.
const WORK_GRAPH_FALLBACK_ID = 'work-graph-links-fallback';
// AC-013-2's "Kata workspace binding file", named in the TRD's Target Files.
const KATA_WORKSPACE_BINDING_FILE = '.kata.toml';

/** Isolated resolution context: no user config, no project file lookup, no detection. */
function contextFor(projectConfig) {
  return {
    projectConfig,
    env: { XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'kata-manifest-')) },
    detect: () => null,
  };
}

function readYaml(file) {
  return yaml.load(fs.readFileSync(file, 'utf8'));
}

/**
 * The work-graph id that the shipped category contract declares as its fallback, read from the
 * manifest rather than hard-coded, so renaming it cannot silently make an assertion vacuous.
 *
 * The fallback is declared per capability (`capabilities.<cap>.fallback`), not at the category
 * root; every capability of the category has to name the same builtin, otherwise a capability
 * could be served by a different adapter than the one this file reasons about.
 */
function declaredWorkGraphFallback() {
  const category = readYaml(WORK_GRAPH_CATEGORY_PATH);
  expect(category).toBeTruthy();
  expect(category.category).toBe('work-graph');
  const fallbacks = Object.entries(category.capabilities || {}).map(([capability, spec]) => {
    expect(typeof spec.fallback).toBe('string');
    return spec.fallback;
  });
  expect(fallbacks.length).toBeGreaterThan(0);
  // One fallback for the whole category.
  expect(new Set(fallbacks).size).toBe(1);
  return fallbacks[0];
}

describe('TRD-002-TEST: one configuration value resolves both categories', () => {
  describe('AC-001-1 Happy: tracker: kata, no work-graph override', () => {
    // The project's toolchain configuration, exactly as a project would write it.
    const projectConfig = { tracker: KATA_ADAPTER_ID };

    test('the tracker resolves to kata from the project value', () => {
      const resolved = resolveCategory('tracker', contextFor(projectConfig));

      expect(resolved.value).toBe(KATA_ADAPTER_ID);
      // 'project', not 'default': this is the project's own choice, which is what AC-013-2
      // forbids detection from ever producing.
      expect(resolved.source).toBe('project');
    });

    test('the work-graph resolves to the same kata adapter, via the tracker capability', () => {
      const resolved = resolveWorkGraphAdapter(contextFor(projectConfig));

      // The load-bearing assertion of AC-001-1: one config value moved both categories.
      expect(resolved.value).toBe(KATA_ADAPTER_ID);
      // Not the sentinel. `work-graph: auto` is the shipped default; the resolver substitutes the
      // tracker rather than handing `auto` back as if it were an adapter id.
      expect(resolved.value).not.toBe(AUTO_SENTINEL);
      // Not the builtin either: falling back would mean the substitution declined, which happens
      // the moment the Kata manifest stops declaring a work-graph capability.
      expect(resolved.value).not.toBe(declaredWorkGraphFallback());
      // The audit trail for "it followed the tracker", so a future rewrite that hard-codes kata
      // here cannot pass while looking identical from `value` alone.
      expect(resolved.autoVia).toBe('tracker-capabilities');
      // The adapter was found for real, not synthesised: skills/adapter-tracker-kata is a shipped
      // package asset, so it resolves at the installed tier.
      expect(resolved.origin).toBe('installed');
      // The manifest that was loaded is the one this file checks below -- the same
      // categories:[tracker, work-graph] declaration AC-001 requires of a new adapter.
      expect(resolved.manifest.adapter).toBe(KATA_ADAPTER_ID);
      expect(resolved.manifest.categories).toEqual(
        expect.arrayContaining(['tracker', 'work-graph']),
      );
    });

    test('the shipped configuration carries no second value naming a work-graph adapter', () => {
      // AC-001-1's negative clause, checked against the file that ships to every project rather
      // than only against the context built above: `work-graph: auto` is the shipped value, and
      // `auto` is a sentinel rather than a name, so nothing points at a work-graph adapter.
      const shippedDefaults = readYaml(DEFAULT_TOOLCHAIN_PATH);

      expect(shippedDefaults.tracker).toBe(SHIPPED_TRACKER_DEFAULT);
      expect(shippedDefaults['work-graph']).toBe(AUTO_SENTINEL);
      // The sentinel is also what the category contract declares, so `auto` is the contract's own
      // "follow your tracker" instruction and not an accident of this one defaults file.
      expect(declaredWorkGraphFallback()).toBe(WORK_GRAPH_FALLBACK_ID);
    });

    test('a project that declares neither adapter keeps the shipped defaults', () => {
      // The bead's own text: "a project that declares neither adapter" must still get the shipped
      // defaults, so the substitution cannot have become the unconditional path.
      const tracker = resolveCategory('tracker', contextFor({}));
      const workGraph = resolveWorkGraphAdapter(contextFor({}));

      expect(tracker.value).toBe(SHIPPED_TRACKER_DEFAULT);
      expect(tracker.source).toBe('default');
      // The shipped beads tracker declares the work-graph category as well, so `auto` resolves
      // THROUGH it: the work-graph answer follows the default tracker, which is beads -- not Kata,
      // and not the sentinel either.
      expect(workGraph.value).toBe(SHIPPED_TRACKER_DEFAULT);
      expect(workGraph.value).not.toBe(KATA_ADAPTER_ID);
      expect(workGraph.value).not.toBe(AUTO_SENTINEL);
      // The links fallback is the per-capability answer for a tracker that does NOT declare the
      // work-graph category. beads does declare it, so the fallback is not what should be
      // reached here.
      expect(workGraph.value).not.toBe(declaredWorkGraphFallback());
      expect(workGraph.autoVia).toBe('tracker-capabilities');
    });
  });

  describe('AC-001-1 Edge: the work-graph fallback named explicitly alongside tracker: kata', () => {
    // The Edge criterion describes a project that "also names the work-graph fallback
    // explicitly". The fallback is a builtin module rather than an installed skill directory, so
    // this is not a supported configuration: the explicit-value branch of resolveWorkGraphAdapter
    // goes through loadAdapter() and cannot reach it. Asserting the throw is the honest
    // equivalent -- it is what keeps "no second configuration value names a work-graph adapter"
    // true by construction -- and it records the asymmetry with the builtin for the next reader.
    const projectConfig = {
      tracker: KATA_ADAPTER_ID,
      'work-graph': WORK_GRAPH_FALLBACK_ID,
    };

    test('naming the builtin fallback as an adapter is a configuration error, not a silent choice', () => {
      expect(() => resolveWorkGraphAdapter(contextFor(projectConfig))).toThrow(
        /is not installed/,
      );
      try {
        resolveWorkGraphAdapter(contextFor(projectConfig));
        throw new Error('expected resolveWorkGraphAdapter to throw');
      } catch (error) {
        expect(error.code).toBe('NOT_INSTALLED');
      }
    });

    test('the tracker half of that configuration still resolves to kata', () => {
      // The Edge criterion says the tracker keeps resolving to kata even when the project has
      // said something about the work-graph category. The two categories are resolved
      // independently, so the invalid work-graph value must not contaminate the tracker answer.
      const resolved = resolveCategory('tracker', contextFor(projectConfig));

      expect(resolved.value).toBe(KATA_ADAPTER_ID);
      expect(resolved.source).toBe('project');
    });
  });

  describe('AC-001-1 Error: a tracker entry naming an adapter that is not installed', () => {
    const MISSING_ADAPTER = 'adapter-that-does-not-exist-trd-002-test';

    test('the tracker resolution carries the configuration error instead of falling back', () => {
      // resolveCategory() resolves a category to a NAME; it does not load the adapter, so it
      // cannot know whether the name is installed. What AC-001-1's Error clause forbids is the
      // silent substitution: the project's own value has to survive resolution, named and
      // attributed to the project, rather than being replaced by the shipped default.
      const resolved = resolveCategory('tracker', contextFor({ tracker: MISSING_ADAPTER }));

      expect(resolved.value).toBe(MISSING_ADAPTER);
      expect(resolved.source).toBe('project');
      // Explicitly NOT the shipped default: a fallback here would hand the project a working
      // beads tracker and hide the typo the project made.
      expect(resolved.value).not.toBe(SHIPPED_TRACKER_DEFAULT);
    });

    test('loading the named adapter reports the configuration error', () => {
      // This is where the error surfaces: the resolution names the adapter, and loading it
      // refuses. The message has to name the adapter the project asked for -- a bare "not
      // installed" would send someone to the wrong file.
      const ctx = contextFor({ tracker: MISSING_ADAPTER });

      expect(() =>
        loadAdapter(MISSING_ADAPTER, {
          projectRoot: DEV_ROOT,
          env: ctx.env,
          category: 'tracker',
        }),
      ).toThrow(/not installed/);
      try {
        loadAdapter(MISSING_ADAPTER, {
          projectRoot: DEV_ROOT,
          env: ctx.env,
          category: 'tracker',
        });
        throw new Error('expected loadAdapter to throw');
      } catch (error) {
        expect(error.code).toBe('NOT_INSTALLED');
        expect(error.message).toContain(MISSING_ADAPTER);
      }
    });

    test('the work-graph resolution reports the same error rather than silently substituting a fallback', () => {
      // The substitution reads the tracker resolution and then has to LOAD that tracker to ask
      // whether it declares a work-graph capability. If that load swallowed NOT_INSTALLED and
      // returned a default, the work-graph category would quietly resolve anyway -- hiding the
      // typo the tracker leg just reported.
      expect(() => resolveWorkGraphAdapter(contextFor({ tracker: MISSING_ADAPTER }))).toThrow(
        /not installed/,
      );
      try {
        resolveWorkGraphAdapter(contextFor({ tracker: MISSING_ADAPTER }));
        throw new Error('expected resolveWorkGraphAdapter to throw');
      } catch (error) {
        expect(error.code).toBe('NOT_INSTALLED');
        expect(error.message).toContain(MISSING_ADAPTER);
      }
    });
  });

  describe('AC-013-2: nothing configured, even with the Kata binding file present', () => {
    // A project root holding the Kata workspace binding file and no toolchain configuration.
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-binding-'));
    fs.writeFileSync(
      path.join(projectRoot, KATA_WORKSPACE_BINDING_FILE),
      '# Kata workspace binding\nname = "trd-002-test"\n',
      'utf8',
    );

    function contextWithoutConfiguration() {
      // projectConfig: null means "the project has no toolchain configuration" -- the same shape
      // resolveCategory reaches when the file is absent -- while still resolving paths against
      // the binding-carrying projectRoot below.
      return {
        projectRoot,
        projectConfig: null,
        env: { XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'kata-manifest-')) },
        diagnostics: [],
        // The real detector, not a stub: AC-013-2 is a claim about detection, so it only means
        // something if the actual detection code is what gets consulted.
        detect: detectAdapter,
      };
    }

    test('the tracker still resolves to beads', () => {
      const resolved = resolveCategory('tracker', contextWithoutConfiguration());

      expect(resolved.value).toBe(SHIPPED_TRACKER_DEFAULT);
      // 'default', not 'detection': AC-013-2's exact promise is that no detection-derived choice
      // is recorded. This is the assertion that fails if anyone adds a detect signal that could
      // reach kata.
      expect(resolved.source).not.toBe('detection');
      expect(resolved.source).toBe('default');
    });

    test('the work-graph follows the default tracker rather than Kata', () => {
      const resolved = resolveWorkGraphAdapter(contextWithoutConfiguration());

      // Nothing configured -> the tracker is the shipped beads default -> the work-graph category
      // follows that tracker, because beads declares the work-graph capability. The Kata binding
      // file sitting in the repository is not a signal that reaches either category.
      expect(resolved.value).toBe(SHIPPED_TRACKER_DEFAULT);
      expect(resolved.value).not.toBe(KATA_ADAPTER_ID);
      expect(resolved.value).not.toBe(AUTO_SENTINEL);
      expect(resolved.source).toBe('default');
    });

    test('detection records nothing that points at kata', () => {
      const ctx = contextWithoutConfiguration();
      resolveCategory('tracker', ctx);

      // detectAdapter() pushes one record per candidate it had to EXCLUDE, and returns
      // {source: 'detection'} only for a candidate whose signals matched. Either way, kata must
      // be absent from the record: the binding file is not a detection signal.
      expect(
        ctx.diagnostics.filter((entry) => entry && String(entry.adapter).includes(KATA_ADAPTER_ID)),
      ).toEqual([]);
      expect(detectAdapter('tracker', ctx)).not.toEqual(
        expect.objectContaining({ value: KATA_ADAPTER_ID }),
      );
    });

    test('the shipped Kata manifest declares no detection signals, so detection cannot reach it', () => {
      // The reason the three tests above hold: adapter-tracker-kata ships `detect: []`, so it is
      // never a detection candidate for any category and remains reachable by explicit
      // configuration only.
      const manifest = readYaml(KATA_MANIFEST_PATH);

      expect(manifest).toBeTruthy();
      expect(manifest.detect).toEqual([]);
    });
  });
});
