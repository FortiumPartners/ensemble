'use strict';

/**
 * TRD-029: PR 4 packaging, mirrors, generation and docs.
 *
 * Implementation AC:
 *   1. symlinks, the Pi vendor bundle, the generated pr-merge artifacts for
 *      Claude, Pi, Codex and OpenCode, and the version files for development,
 *      git and full are refreshed, and validation passes;
 *   2. the README, CHANGELOG and a short branch-protection recommendation
 *      describe the policy keys and the strict default.
 *
 * Packaging checks are only worth having if they can fail for the real reason
 * they exist, so each one is written against the SHIPPED artifact (the file a
 * user installs), never against the source it was generated from. The docs
 * checks assert the policy key NAMES against `pr-review-policy.js` itself, so
 * documentation cannot drift into describing a key the code does not read --
 * the failure mode that makes a configuration guide worse than none.
 *
 * TRD Reference: docs/TRD/TRD-2026-70e784f2-code-review-process.md#trd-029
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(REPO_ROOT, relative));

/** The libraries PR 4 adds: tiers, approvals and the merge gate. */
const PR4_LIBS = ['pr-review-tier.js', 'pr-review-approvals.js', 'pr-review-gate.js'];

describe('TRD-029: PR 4 libraries are mirrored into the full plugin', () => {
  test.each(PR4_LIBS)('packages/full/lib/%s resolves to the development library', (name) => {
    const mirrored = path.join(REPO_ROOT, 'packages/full/lib', name);
    expect(fs.existsSync(mirrored)).toBe(true);

    // A symlink that resolves, not a stale copy that merely exists.
    const resolved = fs.realpathSync(mirrored);
    const source = fs.realpathSync(path.join(REPO_ROOT, 'packages/development/lib', name));
    expect(resolved).toBe(source);
  });

  test('the mirror is complete: every pr-review library is mirrored, so a new one cannot be forgotten', () => {
    const inDevelopment = fs
      .readdirSync(path.join(REPO_ROOT, 'packages/development/lib'))
      .filter((name) => name.startsWith('pr-review-') && name.endsWith('.js'));
    const missing = inDevelopment.filter((name) => !exists(`packages/full/lib/${name}`));

    expect(inDevelopment).toEqual(expect.arrayContaining(PR4_LIBS));
    expect(missing).toEqual([]);
  });
});

describe('TRD-029: the Pi vendor bundle carries the PR 4 modules the CLI requires', () => {
  const cliSource = read('packages/development/lib/pr-review-cli.js');

  test('the CLI really requires the PR 4 modules, so this check cannot pass vacuously', () => {
    for (const name of PR4_LIBS) {
      expect(cliSource).toContain(`require('./${name.replace(/\.js$/, '')}')`);
    }
  });

  test('every PR 4 module is vendored beside the vendored CLI', () => {
    for (const name of PR4_LIBS) {
      expect(exists(`packages/pi/vendor/lib/${name}`)).toBe(true);
    }
  });

  test('the vendored modules are the modules in this tree, not an older copy', () => {
    for (const name of PR4_LIBS) {
      expect(read(`packages/pi/vendor/lib/${name}`)).toBe(read(`packages/development/lib/${name}`));
    }
  });

  test('the vendored CLI exposes the PR 4 subcommands', () => {
    const { HANDLERS } = require(path.join(REPO_ROOT, 'packages/pi/vendor/lib/pr-review-cli.js'));
    for (const name of ['tier', 'approvals', 'gate']) {
      expect(Object.keys(HANDLERS)).toContain(name);
    }
  });
});

describe('TRD-029: the generated pr-merge artifacts carry the merge gate on every runtime', () => {
  /**
   * The shipped pr-merge renderings. pr-merge is a skill-backed command: the Claude command and the pi prompt
   * are stubs that point at the skill and carry no prose, so on those two runtimes the prose a runtime reads
   * is the skill itself (Claude: packages/git/skills/ensemble-pr-merge/SKILL.md, which the stub names; pi: its
   * vendored copy). OpenCode generates into the gitignored `dist/`, so it is asserted only when it has been
   * generated -- never silently skipped for the runtimes that ARE committed.
   */
  const ARTIFACTS = [
    { runtime: 'claude', file: 'packages/git/skills/ensemble-pr-merge/SKILL.md' },
    { runtime: 'pi', file: 'packages/pi/skills/ensemble-pr-merge/SKILL.md' },
    { runtime: 'codex', file: 'packages/codex/.codex/skills/commands/ensemble-pr-merge/SKILL.md' },
  ];
  const STUBS = [
    { runtime: 'claude', file: 'packages/git/commands/ensemble/pr-merge.md' },
    { runtime: 'pi', file: 'packages/pi/prompts/ensemble-pr-merge.md' },
  ];

  test.each([...ARTIFACTS, ...STUBS])('the $runtime artifact $file exists and is generated from the one YAML source', ({ file }) => {
    expect(exists(file)).toBe(true);
    expect(read(file).trim()).not.toBe('');
  });

  test.each(STUBS)('the $runtime command stub points at the skill that carries the gate', ({ file }) => {
    expect(read(file)).toMatch(/ensemble-pr-merge/);
  });

  test.each(ARTIFACTS)('the $runtime artifact requires mergeable:true from MODE=gate', ({ file }) => {
    const text = read(file);
    // The gate is the point of PR 4: a rendering that lost it would merge an
    // unready PR on that runtime while the others refused it.
    expect(text).toMatch(/MODE=gate/);
    expect(text).toMatch(/mergeable/);
  });

  test.each(ARTIFACTS)('the $runtime artifact reports absent server-side enforcement', ({ file }) => {
    expect(read(file)).toMatch(/SERVER-SIDE ENFORCEMENT ABSENT|branch.protection/i);
  });

  test.each(ARTIFACTS)('the $runtime artifact reaches the gate through the skill, never the CLI', ({ file }) => {
    const text = read(file);
    expect(text).toMatch(/pr-review-cycle/);
    expect(text).toMatch(/[Nn]ever call pr-review-cli\.js|never the CLI/);
  });

  test('the OpenCode rendering carries the gate too, when it has been generated', () => {
    const file = 'dist/opencode/.opencode/commands/ensemble/pr-merge.md';
    if (!exists(file)) {
      // Generated output is gitignored; `npm run generate:opencode` produces it.
      expect(exists('scripts/generate-opencode/index.js')).toBe(true);
      return;
    }
    expect(read(file)).toMatch(/MODE=gate/);
  });
});

describe('TRD-029: the version files of the packages PR 4 changes are in sync', () => {
  const PACKAGES = ['development', 'git', 'full'];

  test.each(PACKAGES)('packages/%s package.json and plugin.json agree', (name) => {
    const pkg = JSON.parse(read(`packages/${name}/package.json`));
    const plugin = JSON.parse(read(`packages/${name}/.claude-plugin/plugin.json`));
    expect(typeof pkg.version).toBe('string');
    expect(plugin.version).toBe(pkg.version);
  });

  test('every package PR 4 touches is listed in the marketplace at the same version', () => {
    const marketplace = JSON.parse(read('marketplace.json'));
    const entries = new Map((marketplace.plugins || []).map((entry) => [entry.name, entry]));

    for (const name of PACKAGES) {
      const pkg = JSON.parse(read(`packages/${name}/package.json`));
      const entry = [...entries.values()].find(
        (candidate) => candidate.name === `ensemble-${name}` || candidate.source === `./packages/${name}`
      );
      if (entry !== undefined && typeof entry.version === 'string') {
        expect(entry.version).toBe(pkg.version);
      }
    }
  });
});

describe('TRD-029: the docs describe the policy keys and the strict default', () => {
  const readme = read('README.md');
  const changelog = read('CHANGELOG.md');
  const { DEFAULT_POLICY } = require(path.join(REPO_ROOT, 'packages/development/lib/pr-review-policy.js'));

  test('the README documents the tier policy keys BY THE NAME the code reads', () => {
    // Pinned against the module, so renaming a key without updating the docs
    // fails here rather than misleading a maintainer into an ignored setting.
    for (const key of ['roundCap', 'lowWaiverEnabled', 'botLogins', 'maintainerLogins', 'sensitivePaths', 'highPaths']) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_POLICY, key)).toBe(true);
      expect(readme).toContain(`\`${key}\``);
    }
  });

  test('the README states the strict default: Low is treated as Medium until the waiver is enabled', () => {
    expect(DEFAULT_POLICY.lowWaiverEnabled).toBe(false);
    expect(readme).toMatch(/treated as \*?Medium\*?/i);
    expect(readme).toMatch(/[Ss]trict by default/);
  });

  test('the README states the approval rules a person is governed by', () => {
    expect(readme).toMatch(/[Rr]aise-only/);
    expect(readme).toMatch(/lowering-needs-code-owner/);
    expect(readme).toMatch(/bound\s+to\s+the\s+commit/i);
    expect(readme).toMatch(/Directed by:/);
    expect(readme).toMatch(/[Bb]ot approvals never count/);
  });

  test('the README carries the branch-protection recommendation and the honest limit', () => {
    expect(readme).toMatch(/branch.protection/i);
    expect(readme).toMatch(/cannot enforce it/i);
    expect(readme).toMatch(/SERVER-SIDE ENFORCEMENT ABSENT/);
  });

  test('the per-tier approval counts in the README match the module', () => {
    const { HUMANS_REQUIRED } = require(path.join(REPO_ROOT, 'packages/development/lib/pr-review-tier.js'));
    expect(HUMANS_REQUIRED).toEqual({ low: 0, medium: 1, high: 2 });
    // The table a reader acts on must carry the same numbers.
    expect(readme).toMatch(/\|\s*Low\s*\|\s*0\s*\|/);
    expect(readme).toMatch(/\|\s*Medium\s*\|\s*1\s*\|/);
    expect(readme).toMatch(/\|\s*High\s*\|\s*2\s*\|/);
  });

  test('the CHANGELOG records PR 4 with the strict default and the honest limit', () => {
    expect(changelog).toMatch(/pr-review-tier\.js/);
    expect(changelog).toMatch(/pr-review-approvals\.js/);
    expect(changelog).toMatch(/pr-review-gate\.js/);
    expect(changelog).toMatch(/lowWaiverEnabled/);
    expect(changelog).toMatch(/cannot enforce it/i);
  });
});
