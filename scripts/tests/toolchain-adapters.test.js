'use strict';
/**
 * Tests for TRD-2026-8d825f54 TRD-006: `discoverAdapters(ctx)` / `loadAdapter(name, ctx)` in
 * packages/development/lib/toolchain/adapters.js, covering repo-local, user and installed
 * adapter discovery, origin-priority and duplicate-id tie-break, the `NOT_INSTALLED` failure,
 * the repo-local non-interactive trust rule (TRD interpretation I5) including its
 * `CONFIG_INVALID` and `ctx.env`-replaces-`process.env` edges, the no-cache/no-build
 * read-fresh-every-call behavior for both `adapter.yaml` and `SKILL.md` (PRD REQ-005 AC-005-1,
 * REQ-007 AC-007-1/2/3), symlinked adapter directories, and resilient listing that never throws
 * a raw filesystem error.
 *
 * `describe('discoverAdapters: library-relative installed-tier roots ...')` (PR 5 independent
 * review) covers the "installed" tier's second source of search roots: this library's own
 * on-disk location (`__dirname`), recognized via a small fixed allow-list of real shipped
 * layouts (`matchLibraryLocationTail`/`LIBRARY_LOCATION_TAILS`), including mutation proofs
 * built against `./fixtures/toolchain/library-layout-copy.js` -- a fresh copy of `adapters.js`
 * (plus its siblings) at the LITERAL relative directory names each layout actually ships at,
 * since the recognition is tail-based on `__dirname`'s real path, not something a plain
 * `ctx`-driven unit test of the live, in-repo module can vary.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { discoverAdapters, loadAdapter } = require('../../packages/development/lib/toolchain/adapters');
const { getUserToolchainConfigPath } = require('../../packages/development/lib/toolchain/config-path');
const { makeLibraryLayoutCopy } = require('./fixtures/toolchain/library-layout-copy');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function mkTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Keep only `discoverAdapters()` results whose `dir` lives inside one of `roots` (as a real
 * path-segment prefix, never a bare string prefix that could false-match a sibling tmp dir
 * name sharing a prefix). PR 5 independent review: `discoverAdapters`/`loadAdapter` now ALSO
 * discover this library's own real, library-relative installed-tier roots (this repo's own
 * shipped `packages/*\/skills/adapter-*` directories, since these tests `require()` the real,
 * unmutated `adapters.js` in-process rather than a copied bundle) -- a test asserting on
 * "exactly what I seeded under my own tmp roots" must filter those out first, the same way it
 * would filter out another test's temp dir if jest ever shared process state across them.
 *
 * @param {Array<{name: string, origin: string, dir: string}>} result
 * @param {...string} roots usually `projectRoot` and/or `xdgConfigHome`
 */
function withinProjectRoot(result, ...roots) {
  const prefixes = roots.map((root) => (root.endsWith(path.sep) ? root : root + path.sep));
  return result.filter((entry) =>
    roots.some((root, i) => entry.dir === root || entry.dir.startsWith(prefixes[i]))
  );
}

const SKILL_MD = ['# Example Adapter', '', '## Vocabulary', '', '- show: read a work item by id', ''].join('\n');

/** The filename adapters.js treats as "this directory is a skill, not a container of skills". */
const SKILL_FILE_NAME = 'SKILL.md';

function validAdapterManifest(overrides = {}) {
  return {
    adapter: 'example-adapter',
    version: '1.0.0',
    categories: ['tracker'],
    contract: { tracker: '1.0' },
    binaries: ['example-tool'],
    allowlist: [{ bin: 'example-tool', sub: ['show'] }],
    env: [],
    health: [{ id: 'version', run: ['example-tool', '--version'], timeoutMs: 5000 }],
    detect: [],
    capabilities: {
      'tracker.show': {
        run: ['example-tool', 'show', '--id', '${id}'],
        parse: { format: 'json', root: '$' }
      }
    },
    ...overrides
  };
}

/**
 * Write a realistic adapter skill directory (`adapter.yaml` plus `SKILL.md`), mirroring the
 * fixture pattern of scripts/tests/toolchain-manifest.test.js.
 */
function writeAdapterDir(dir, manifest, skillMd = SKILL_MD) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adapter.yaml'), yaml.dump(manifest));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  return dir;
}

/** The user adapters directory for one adapter name, derived the same way adapters.js does. */
function userAdapterDir(xdgConfigHome, name) {
  const configPath = getUserToolchainConfigPath({ XDG_CONFIG_HOME: xdgConfigHome });
  return path.join(path.dirname(configPath), 'adapters', name);
}

function writeUserToolchainConfig(xdgConfigHome, configObject) {
  const configPath = getUserToolchainConfigPath({ XDG_CONFIG_HOME: xdgConfigHome });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(configObject));
  return configPath;
}

describe('loadAdapter: user-level adapters', () => {
  test('AC-005-1/AC-007-1: an adapter under the user adapters/ dir resolves with origin user and stays under the temp XDG root', () => {
    const projectRoot = mkTempDir('ensemble-adapters-user-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-user-xdg-');

    const dir = userAdapterDir(xdgConfigHome, 'bar');
    writeAdapterDir(dir, validAdapterManifest({ adapter: 'bar' }));

    const result = loadAdapter('bar', { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });

    expect(result.origin).toBe('user');
    expect(result.dir).toBe(dir);
    // The resolved directory lives entirely under the temp XDG root, so this call could not
    // have read or written anything under the real repository's packages/ tree.
    expect(result.dir.startsWith(xdgConfigHome)).toBe(true);
    expect(result.manifest.adapter).toBe('bar');
  });
});

describe('loadAdapter: origin priority (user wins over installed)', () => {
  test('AC-007-1/I5: the same adapter id declared in both the user adapters dir and an installed packages/*/skills dir resolves with origin user', () => {
    const projectRoot = mkTempDir('ensemble-adapters-priority-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-priority-xdg-');

    const userDir = userAdapterDir(xdgConfigHome, 'shared-owner');
    writeAdapterDir(userDir, validAdapterManifest({ adapter: 'shared-adapter' }));

    const installedDir = path.join(projectRoot, 'packages', 'some-pkg', 'skills', 'shared-skill');
    writeAdapterDir(installedDir, validAdapterManifest({ adapter: 'shared-adapter' }));

    const result = loadAdapter('shared-adapter', { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });

    expect(result.origin).toBe('user');
    expect(result.dir).toBe(userDir);
  });
});

describe('loadAdapter: duplicate-id tie-break (first by origin priority, then sorted directory name)', () => {
  test('two installed packages declaring the same adapter id resolve to the lexicographically-first package directory', () => {
    const projectRoot = mkTempDir('ensemble-adapters-duptie-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-duptie-xdg-');

    const firstDir = path.join(projectRoot, 'packages', 'pkg-a', 'skills', 'dup-skill');
    writeAdapterDir(firstDir, validAdapterManifest({ adapter: 'dup-adapter' }));
    const secondDir = path.join(projectRoot, 'packages', 'pkg-b', 'skills', 'dup-skill');
    writeAdapterDir(secondDir, validAdapterManifest({ adapter: 'dup-adapter' }));

    const result = loadAdapter('dup-adapter', {
      projectRoot,
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      interactive: true
    });

    expect(result.origin).toBe('installed');
    expect(result.dir).toBe(firstDir);
  });
});

describe('loadAdapter: NOT_INSTALLED', () => {
  test('AC-007-2: a name found in no search location fails with code NOT_INSTALLED naming the adapter, every search location (repo-local, user, project packages, and this library\'s own installed-tier roots), and a marketplace install hint', () => {
    const projectRoot = mkTempDir('ensemble-adapters-missing-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-missing-xdg-');
    const name = 'totally-unknown-adapter';

    const expectedRepoLocalDir = path.join(projectRoot, '.ensemble', 'adapters', name);
    const expectedUserDir = userAdapterDir(xdgConfigHome, name);
    const expectedPackagesRoot = path.join(projectRoot, 'packages');

    expect.assertions(7);
    try {
      loadAdapter(name, { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });
    } catch (error) {
      expect(error.code).toBe('NOT_INSTALLED');
      expect(error.message).toContain(name);
      expect(error.message).toContain(expectedRepoLocalDir);
      expect(error.message).toContain(expectedUserDir);
      expect(error.message).toContain(expectedPackagesRoot);
      expect(error.message.toLowerCase()).toMatch(/marketplace/);
      // PR 5 independent review: this suite runs the REAL, unmutated adapters.js module
      // in-process (require()'d directly, not a copied bundle), so its own __dirname matches
      // the monorepo-source tail and the message also names this library's own real,
      // library-relative installed-tier roots (this repo's packages/development/skills among
      // them) -- the exact mechanism this task fixes.
      expect(error.message).toContain(path.join('packages', 'development', 'skills', name));
    }
  });
});

describe('loadAdapter: repo-local trust (TRD interpretation I5)', () => {
  let projectRoot;
  let xdgConfigHome;
  let repoLocalDir;

  beforeEach(() => {
    projectRoot = mkTempDir('ensemble-adapters-repo-project-');
    xdgConfigHome = mkTempDir('ensemble-adapters-repo-xdg-');
    repoLocalDir = path.join(projectRoot, '.ensemble', 'adapters', 'foo');
    writeAdapterDir(repoLocalDir, validAdapterManifest({ adapter: 'foo' }));
  });

  test('AC-007-3: an interactive call resolves the repo-local adapter with origin repo-local', () => {
    const result = loadAdapter('foo', {
      projectRoot,
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      interactive: true
    });

    expect(result.origin).toBe('repo-local');
    expect(result.dir).toBe(repoLocalDir);
    expect(result.manifest.adapter).toBe('foo');
  });

  test("I5: a non-interactive call without 'foo' in trustedRepoAdapters fails naming the adapter and the trust setting", () => {
    expect.assertions(3);
    try {
      loadAdapter('foo', { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome }, interactive: false });
    } catch (error) {
      expect(error.code).toBe('UNTRUSTED_REPO_ADAPTER');
      expect(error.message).toContain('foo');
      expect(error.message).toContain('trustedRepoAdapters');
    }
  });

  test(
    "PR review finding 3: an empty ctx (no 'interactive' key at all) still defaults to " +
      'non-interactive and throws UNTRUSTED_REPO_ADAPTER, pinning the fail-closed default',
    () => {
      expect.assertions(3);
      try {
        loadAdapter('foo', { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });
      } catch (error) {
        expect(error.code).toBe('UNTRUSTED_REPO_ADAPTER');
        expect(error.message).toContain('foo');
        expect(error.message).toContain('trustedRepoAdapters');
      }
    }
  );

  test("AC-007-3: a non-interactive call with 'foo' in trustedRepoAdapters resolves with no packaging step", () => {
    writeUserToolchainConfig(xdgConfigHome, { trustedRepoAdapters: ['foo'] });

    const result = loadAdapter('foo', {
      projectRoot,
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      interactive: false
    });

    expect(result.origin).toBe('repo-local');
    expect(result.dir).toBe(repoLocalDir);
    expect(result.manifest.adapter).toBe('foo');
  });

  test('a non-interactive call whose user toolchain.yaml fails schema validation fails with CONFIG_INVALID naming the file', () => {
    const userConfigPath = getUserToolchainConfigPath({ XDG_CONFIG_HOME: xdgConfigHome });
    fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
    // trustedRepoAdapters must be an array of strings per the toolchain config schema; a bare
    // string fails ajv validation inside loadToolchainConfigFile.
    fs.writeFileSync(userConfigPath, yaml.dump({ trustedRepoAdapters: 'foo' }));

    expect.assertions(2);
    try {
      loadAdapter('foo', { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome }, interactive: false });
    } catch (error) {
      expect(error.code).toBe('CONFIG_INVALID');
      expect(error.message).toContain(userConfigPath);
    }
  });
});

describe('loadAdapter: ctx.env replaces process.env wholesale for the trust lookup', () => {
  test('a partial ctx.env cannot read the developer real trustedRepoAdapters resolved from process.env', () => {
    const projectRoot = mkTempDir('ensemble-adapters-envreplace-project-');
    const repoLocalDir = path.join(projectRoot, '.ensemble', 'adapters', 'env-trust-adapter');
    writeAdapterDir(repoLocalDir, validAdapterManifest({ adapter: 'env-trust-adapter' }));

    // Simulate the developer's real environment: process.env.XDG_CONFIG_HOME points at a
    // config that trusts this adapter, and process.env.HOME is pinned to a fresh directory
    // with no pre-existing `.config`, so config-path.js's own fallback chain stays isolated
    // from the real machine running this test.
    const developerXdgConfigHome = mkTempDir('ensemble-adapters-envreplace-real-xdg-');
    writeUserToolchainConfig(developerXdgConfigHome, { trustedRepoAdapters: ['env-trust-adapter'] });
    const fakeHome = mkTempDir('ensemble-adapters-envreplace-home-');

    const savedXdg = process.env.XDG_CONFIG_HOME;
    const savedHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = developerXdgConfigHome;
    process.env.HOME = fakeHome;
    try {
      // ctx.env carries no XDG_CONFIG_HOME at all. If it replaces process.env wholesale (as
      // documented), the trust lookup falls back through config-path.js's own chain to
      // <fakeHome>/.ensemble/toolchain.yaml, which was never written, so trustedRepoAdapters
      // is empty and this non-interactive call is rejected. If it instead merged with
      // process.env, the developer's real XDG_CONFIG_HOME would leak through and the call
      // would resolve the adapter as trusted with no error.
      expect.assertions(1);
      try {
        loadAdapter('env-trust-adapter', { projectRoot, env: {}, interactive: false });
        throw new Error('expected loadAdapter to reject the untrusted repo-local adapter');
      } catch (error) {
        expect(error.code).toBe('UNTRUSTED_REPO_ADAPTER');
      }
    } finally {
      if (savedXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = savedXdg;
      }
      if (savedHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = savedHome;
      }
    }
  });
});

describe('loadAdapter: no caching (Implementation AC 4)', () => {
  test('an edited capability run template between two calls in the same process is reflected on the second call', () => {
    const projectRoot = mkTempDir('ensemble-adapters-fresh-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-fresh-xdg-');
    const dir = path.join(projectRoot, '.ensemble', 'adapters', 'freshy');
    writeAdapterDir(dir, validAdapterManifest({ adapter: 'freshy' }));

    const ctx = { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome }, interactive: true };

    const first = loadAdapter('freshy', ctx);
    expect(first.manifest.capabilities['tracker.show'].run).toEqual(['example-tool', 'show', '--id', '${id}']);

    const edited = validAdapterManifest({
      adapter: 'freshy',
      capabilities: {
        'tracker.show': {
          run: ['example-tool', 'show', '--id', '${id}', '--verbose'],
          parse: { format: 'json', root: '$' }
        }
      }
    });
    fs.writeFileSync(path.join(dir, 'adapter.yaml'), yaml.dump(edited));

    const second = loadAdapter('freshy', ctx);

    expect(second.manifest.capabilities['tracker.show'].run).toEqual([
      'example-tool',
      'show',
      '--id',
      '${id}',
      '--verbose'
    ]);
    expect(second.manifest.capabilities['tracker.show'].run).not.toEqual(
      first.manifest.capabilities['tracker.show'].run
    );
  });

  test('PRD REQ-005 AC-005-1: SKILL.md content is returned on the loaded adapter and an edit between two calls is visible', () => {
    const projectRoot = mkTempDir('ensemble-adapters-skillmd-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-skillmd-xdg-');
    const dir = path.join(projectRoot, '.ensemble', 'adapters', 'skillmd-adapter');
    writeAdapterDir(dir, validAdapterManifest({ adapter: 'skillmd-adapter' }));

    const ctx = { projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome }, interactive: true };

    const first = loadAdapter('skillmd-adapter', ctx);
    expect(first.skillMd.ok).toBe(true);
    expect(first.skillMd.content).toBe(SKILL_MD);

    const editedSkillMd = ['# Example Adapter', '', '## Vocabulary', '', '- show: edited behavior', ''].join('\n');
    fs.writeFileSync(path.join(dir, 'SKILL.md'), editedSkillMd);

    const second = loadAdapter('skillmd-adapter', ctx);
    expect(second.skillMd.ok).toBe(true);
    expect(second.skillMd.content).toBe(editedSkillMd);
    expect(second.skillMd.content).not.toBe(first.skillMd.content);
  });

  test('a missing SKILL.md is reported clearly on the loaded adapter instead of throwing', () => {
    const projectRoot = mkTempDir('ensemble-adapters-skillmd-missing-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-skillmd-missing-xdg-');
    const dir = path.join(projectRoot, '.ensemble', 'adapters', 'no-skillmd');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'adapter.yaml'), yaml.dump(validAdapterManifest({ adapter: 'no-skillmd' })));
    // Deliberately no SKILL.md written.

    let result;
    expect(() => {
      result = loadAdapter('no-skillmd', {
        projectRoot,
        env: { XDG_CONFIG_HOME: xdgConfigHome },
        interactive: true
      });
    }).not.toThrow();

    expect(result.origin).toBe('repo-local');
    expect(result.skillMd.ok).toBe(false);
    expect(result.skillMd.error).toContain(path.join(dir, 'SKILL.md'));
    expect(result.skillMd.error.toLowerCase()).toMatch(/missing or unreadable/);
  });
});

describe('loadAdapter/discoverAdapters: symlinked adapter directories', () => {
  test('a symlinked adapter directory under the repo-local root resolves like a real directory', () => {
    const projectRoot = mkTempDir('ensemble-adapters-symlink-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-symlink-xdg-');
    const externalDir = mkTempDir('ensemble-adapters-symlink-target-');
    writeAdapterDir(externalDir, validAdapterManifest({ adapter: 'symlinked-adapter' }));

    const repoLocalAdaptersDir = path.join(projectRoot, '.ensemble', 'adapters');
    fs.mkdirSync(repoLocalAdaptersDir, { recursive: true });
    const linkPath = path.join(repoLocalAdaptersDir, 'symlinked-adapter');
    fs.symlinkSync(externalDir, linkPath, 'dir');

    const result = loadAdapter('symlinked-adapter', {
      projectRoot,
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      interactive: true
    });

    expect(result.origin).toBe('repo-local');
    expect(result.dir).toBe(linkPath);
    expect(result.manifest.adapter).toBe('symlinked-adapter');
    expect(result.skillMd.ok).toBe(true);
  });
});

describe('discoverAdapters: adapters grouped one level under an installed skills root (#138)', () => {
  // The full bundle ships `packages/full/skills/git` as a symlink to `../../git/skills`, so the
  // five git adapters sit one level deeper than the flat ones beside them
  // (`adapter-tracker-beads` and friends). A scan of only a skills root's immediate children
  // finds the flat ones and never sees `adapter-workflow-plain-git`, which is what made
  // `beads-build-wave` stop at `HEALTH_FAILED: plain-git: could not load the adapter for
  // category 'workflow'` with no track dispatched.
  // The adapter id is deliberately NOT 'plain-git' here. These tests require the real,
  // unmutated adapters.js in-process, so its library-relative roots include this repo's own
  // packages/git/skills/adapter-workflow-plain-git -- asserting on 'plain-git' from a temp
  // projectRoot passes by resolving the REAL adapter whether the nested scan works or not,
  // which is a test that cannot fail. Hence a fixture-only id, and `withinProjectRoot` on
  // every discovery assertion in this block.
  test('an adapter inside a plain group directory under packages/<pkg>/skills resolves with origin installed', () => {
    const projectRoot = mkTempDir('ensemble-adapters-nested-plain-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-nested-plain-xdg-');
    const adapterDir = writeAdapterDir(
      path.join(projectRoot, 'packages', 'full', 'skills', 'git', 'adapter-workflow-grouped'),
      validAdapterManifest({ adapter: 'grouped-workflow', categories: ['workflow'], contract: { workflow: '1.0' } })
    );

    const found = withinProjectRoot(
      discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } }),
      projectRoot
    );
    expect(found).toEqual([{ name: 'grouped-workflow', origin: 'installed', dir: adapterDir }]);

    const result = loadAdapter('grouped-workflow', {
      projectRoot,
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      interactive: false
    });
    expect(result.origin).toBe('installed');
    expect(result.dir).toBe(adapterDir);
  });

  test("an adapter inside a SYMLINKED group directory resolves too, which is the layout the full bundle actually ships", () => {
    const projectRoot = mkTempDir('ensemble-adapters-nested-symlink-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-nested-symlink-xdg-');
    // packages/git/skills/adapter-workflow-plain-git is the real home of the adapter...
    const realGroup = path.join(projectRoot, 'packages', 'git', 'skills');
    writeAdapterDir(
      path.join(realGroup, 'adapter-workflow-plain-git'),
      validAdapterManifest({ adapter: 'plain-git', categories: ['workflow'], contract: { workflow: '1.0' } })
    );
    // ...and packages/full/skills/git is a symlink to it, exactly as the bundle has it.
    const fullSkills = path.join(projectRoot, 'packages', 'full', 'skills');
    fs.mkdirSync(fullSkills, { recursive: true });
    fs.symlinkSync(realGroup, path.join(fullSkills, 'git'), 'dir');
    // A flat adapter beside the symlink, so the test shows the nested one is found IN ADDITION
    // to what already worked rather than instead of it.
    writeAdapterDir(
      path.join(fullSkills, 'adapter-tracker-beads'),
      validAdapterManifest({ adapter: 'beads' })
    );

    const found = withinProjectRoot(
      discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } }),
      projectRoot
    );

    // `plain-git` twice is correct, not a duplicate bug. The installed tier scans every
    // `packages/*/skills` under projectRoot, so this one adapter is reachable by two roots:
    // directly as a flat child of packages/git/skills, and again one level inside
    // packages/full/skills via the `git` symlink. Both entries point at the same adapter after
    // realpath. loadAdapter takes the first match, so the repeat is invisible to callers; it is
    // asserted here so a future dedupe is a deliberate change rather than an accident.
    expect(found.map((entry) => entry.name).sort()).toEqual(['beads', 'plain-git', 'plain-git']);
    expect(found.every((entry) => entry.origin === 'installed')).toBe(true);
    expect(new Set(found.map((entry) => fs.realpathSync(entry.dir))).size).toBe(2);
  });

  // RT-3: every other test in this block uses a group literally named `git`. The descent is
  // not keyed on the name, and the bundle groups under `infrastructure/`, `core/` and
  // `e2e-testing/` as well, so a name-keyed regression would pass all of the above.
  test.each(['infrastructure', 'core', 'e2e-testing'])(
    'the group name is not special: an adapter under a group named %s resolves too',
    (groupName) => {
      const projectRoot = mkTempDir(`ensemble-adapters-group-${groupName}-project-`);
      const xdgConfigHome = mkTempDir(`ensemble-adapters-group-${groupName}-xdg-`);
      const adapterDir = writeAdapterDir(
        path.join(projectRoot, 'packages', 'full', 'skills', groupName, 'adapter-iac-grouped'),
        validAdapterManifest({ adapter: `grouped-under-${groupName}` })
      );

      const found = withinProjectRoot(
        discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } }),
        projectRoot
      );

      expect(found).toEqual([
        { name: `grouped-under-${groupName}`, origin: 'installed', dir: adapterDir }
      ]);
    }
  );

  test('the descent is exactly one level: an adapter two levels under a skills root is NOT discovered', () => {
    const projectRoot = mkTempDir('ensemble-adapters-nested-depth-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-nested-depth-xdg-');
    writeAdapterDir(
      path.join(projectRoot, 'packages', 'full', 'skills', 'git', 'deeper', 'adapter-too-deep'),
      validAdapterManifest({ adapter: 'too-deep' })
    );

    const found = withinProjectRoot(
      discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } }),
      projectRoot
    );

    expect(found).toEqual([]);
  });

  // Asked for by the session this bug blocked: a test that resolves `workflow: plain-git` from
  // the full bundle's OWN location, not from a fixture. The fixture tests above would all stay
  // green if someone moved the shipped adapters around; this one goes red. It reads the real
  // packages/full/skills as an installed root, where `git` is the live symlink to
  // ../../git/skills, so it exercises the same grouped-and-symlinked path the install does.
  test("the SHIPPED bundle's own packages/full/skills resolves workflow:plain-git, which no fixture can promise", () => {
    const projectRoot = mkTempDir('ensemble-adapters-shipped-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-shipped-xdg-');
    const shippedSkills = path.resolve(__dirname, '..', '..', 'packages', 'full', 'skills');
    const ctx = {
      projectRoot,
      env: { XDG_CONFIG_HOME: xdgConfigHome },
      interactive: false,
      installedRoots: [shippedSkills]
    };

    // Guard the premise: if the bundle ever stops grouping adapters, this test is measuring
    // nothing and should say so rather than pass.
    const groupedWorkflow = path.join(shippedSkills, 'git', 'adapter-workflow-plain-git');
    expect(fs.existsSync(path.join(groupedWorkflow, 'adapter.yaml'))).toBe(true);

    const result = loadAdapter('plain-git', ctx);
    expect(result.origin).toBe('installed');

    // The load-bearing assertion. `loadAdapter` alone cannot carry this test: the
    // library-relative roots are derived from __dirname and come BEFORE ctx.installedRoots, so
    // `plain-git` also resolves flat from this repo's own packages/git/skills -- and because
    // packages/full/skills/git IS a symlink to packages/git/skills, the two realpath to the
    // same directory. A realpath comparison therefore passes with or without the descent.
    // What only the descent can produce is a discovery entry whose UNRESOLVED dir sits under
    // the bundle's own grouped path.
    const groupPrefix = path.join(shippedSkills, 'git') + path.sep;
    const viaBundleGroup = discoverAdapters(ctx).filter(
      (entry) => entry.name === 'plain-git' && entry.dir.startsWith(groupPrefix)
    );
    // TWO, not one: `plain-git` is declared by two directories in this group,
    // `adapter-workflow-plain-git` and `adapter-worktree-plain-git`, each carrying one
    // category of the same adapter id. So the group contributes two entries under that id and
    // the workflow one is what this test pinned. (`loadAdapter` returns only the first match,
    // which makes the worktree half of that id unreachable through it -- that predates this
    // change and reproduces identically without the descent, so it is filed separately at
    // https://github.com/FortiumPartners/ensemble/issues/146 rather than fixed here.)
    expect(viaBundleGroup).toHaveLength(2);
    const workflowEntry = viaBundleGroup.find(
      (entry) => fs.realpathSync(entry.dir) === fs.realpathSync(groupedWorkflow)
    );
    expect(workflowEntry).toBeDefined();
    expect(workflowEntry.origin).toBe('installed');

    // And the flat adapters beside the group are still found, so the descent added reach
    // instead of redirecting it.
    const names = new Set(
      withinProjectRoot(discoverAdapters(ctx), shippedSkills).map((entry) => entry.name)
    );
    expect(names.has('plain-git')).toBe(true);
    expect(names.has('beads')).toBe(true);
  });

  // The descent's cost bound, and the reason it exists: the installed roots hold 181
  // non-adapter directories, nearly all ordinary skills. Descending into all of them took
  // discovery from 5.2ms to 11.8ms per call, and `toolchain-cli explain` calls it enough times
  // to add ~2.5s -- enough to make toolchain-detect.test.js's 5000ms subprocess budget fail
  // intermittently (measured 1698/1792/2274ms before, 4131/4537/4702ms after, with one 5053ms
  // failure). A directory that carries its own SKILL.md is a skill, not a container of skills.
  test('a group directory that carries its own SKILL.md is a skill and is NOT descended into', () => {
    const projectRoot = mkTempDir('ensemble-adapters-skillmd-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-skillmd-xdg-');
    // A skill directory that happens to contain a subdirectory carrying an adapter.yaml. The
    // subdirectory belongs to that skill; it is not a separately installed adapter.
    const skillDir = path.join(projectRoot, 'packages', 'full', 'skills', 'threat-model');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# threat-model\n');
    writeAdapterDir(
      path.join(skillDir, 'examples'),
      validAdapterManifest({ adapter: 'not-an-installed-adapter' })
    );
    // ...and a real group beside it, so the test shows the skip is selective rather than
    // switching the descent off.
    const groupedDir = writeAdapterDir(
      path.join(projectRoot, 'packages', 'full', 'skills', 'git', 'adapter-workflow-grouped'),
      validAdapterManifest({ adapter: 'grouped-workflow', categories: ['workflow'], contract: { workflow: '1.0' } })
    );

    const found = withinProjectRoot(
      discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } }),
      projectRoot
    );

    expect(found).toEqual([{ name: 'grouped-workflow', origin: 'installed', dir: groupedDir }]);
  });

  test('a group directory that declares its own adapter.yaml is that adapter, and its children are not also scanned', () => {
    const projectRoot = mkTempDir('ensemble-adapters-nested-self-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-nested-self-xdg-');
    const groupDir = path.join(projectRoot, 'packages', 'full', 'skills', 'adapter-tracker-beads');
    // Deliberately NO SKILL.md on this adapter, which is what makes the test able to fail.
    // `writeAdapterDir` writes one, and a SKILL.md would make the descent skip this directory
    // anyway -- so with it, deleting the `continue` that ends the manifest branch changes
    // nothing and the mutation goes green. Without it, that `continue` is the only thing
    // stopping the scan from walking into a real adapter's own subdirectories.
    fs.mkdirSync(groupDir, { recursive: true });
    fs.writeFileSync(
      path.join(groupDir, 'adapter.yaml'),
      yaml.dump(validAdapterManifest({ adapter: 'beads' }))
    );
    expect(fs.existsSync(path.join(groupDir, SKILL_FILE_NAME))).toBe(false);
    // A nested directory inside a REAL adapter directory is part of that adapter, not a second
    // adapter: descending into it would invent one.
    writeAdapterDir(
      path.join(groupDir, 'vendored'),
      validAdapterManifest({ adapter: 'not-a-separate-adapter' })
    );

    const found = withinProjectRoot(
      discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } }),
      projectRoot
    );

    expect(found.map((entry) => entry.name)).toEqual(['beads']);
  });
});

describe('discoverAdapters: resilient listing (never throws a raw fs error)', () => {
  test('a missing adapters root is skipped, not thrown', () => {
    const projectRoot = mkTempDir('ensemble-adapters-missing-root-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-missing-root-xdg-');
    // No .ensemble/adapters, no user adapters dir, no project-relative packages dir exists at
    // all under this test's own projectRoot.

    let result;
    expect(() => {
      result = discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });
    }).not.toThrow();
    expect(withinProjectRoot(result, projectRoot)).toEqual([]);
  });

  test('a non-directory adapters root (a plain file in its place) is skipped, not thrown', () => {
    const projectRoot = mkTempDir('ensemble-adapters-file-root-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-file-root-xdg-');
    fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
    // .ensemble/adapters exists as a plain file, not a directory: readdirSync on it raises
    // ENOTDIR.
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'adapters'), 'not a directory');

    let result;
    expect(() => {
      result = discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });
    }).not.toThrow();
    expect(withinProjectRoot(result, projectRoot)).toEqual([]);
  });

  test('a stray file inside an adapters root is skipped, not thrown and not treated as an adapter', () => {
    const projectRoot = mkTempDir('ensemble-adapters-stray-file-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-stray-file-xdg-');
    const repoLocalRoot = path.join(projectRoot, '.ensemble', 'adapters');
    fs.mkdirSync(repoLocalRoot, { recursive: true });
    fs.writeFileSync(path.join(repoLocalRoot, 'README.md'), 'not an adapter directory');
    const realAdapterDir = path.join(repoLocalRoot, 'real-adapter');
    writeAdapterDir(realAdapterDir, validAdapterManifest({ adapter: 'real-adapter' }));

    let result;
    expect(() => {
      result = discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });
    }).not.toThrow();
    expect(withinProjectRoot(result, projectRoot)).toEqual([
      { name: 'real-adapter', origin: 'repo-local', dir: realAdapterDir }
    ]);
  });

  test('a broken symlink inside an adapters root is skipped, not thrown', () => {
    const projectRoot = mkTempDir('ensemble-adapters-broken-symlink-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-broken-symlink-xdg-');
    const repoLocalRoot = path.join(projectRoot, '.ensemble', 'adapters');
    fs.mkdirSync(repoLocalRoot, { recursive: true });
    fs.symlinkSync(path.join(projectRoot, 'does-not-exist'), path.join(repoLocalRoot, 'broken-link'), 'dir');

    let result;
    expect(() => {
      result = discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });
    }).not.toThrow();
    expect(withinProjectRoot(result, projectRoot)).toEqual([]);
  });
});

describe('discoverAdapters', () => {
  test('enumerates repo-local, user and installed adapters, taking each name from its own manifest regardless of directory naming (TRD interpretation I7)', () => {
    const projectRoot = mkTempDir('ensemble-adapters-discover-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-discover-xdg-');

    const repoLocalDir = path.join(projectRoot, '.ensemble', 'adapters', 'repo-adapter-dir');
    writeAdapterDir(repoLocalDir, validAdapterManifest({ adapter: 'repo-id' }));

    const userDir = userAdapterDir(xdgConfigHome, 'user-adapter-dir');
    writeAdapterDir(userDir, validAdapterManifest({ adapter: 'user-id' }));

    // The installed directory carries neither the manifest's declared id nor any
    // 'adapter-'-prefixed name, proving discovery selects by the manifest's declared `adapter`
    // id and does not depend on any directory-naming convention (TRD interpretation I7).
    const installedDir = path.join(projectRoot, 'packages', 'some-pkg', 'skills', 'mystery-tool');
    writeAdapterDir(
      installedDir,
      validAdapterManifest({ adapter: 'installed-id', categories: ['tracker', 'host'], contract: { tracker: '1.0', host: '1.0' } })
    );

    // A skills-directory sibling with no adapter.yaml at all must still be ignored: there is
    // nothing in it to select by.
    const emptyDir = path.join(projectRoot, 'packages', 'some-pkg', 'skills', 'not-an-adapter');
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });

    // Filtered to this test's own projectRoot/xdgConfigHome: PR 5 independent review added a
    // second, library-relative source to the "installed" tier (this library's own real,
    // shipped packages/*/skills, discovered alongside whatever this test seeded under its own
    // tmp roots, since this suite runs the real adapters.js in-process -- see
    // `withinProjectRoot`'s own doc). `discoverAdapters: discovers this library's own
    // library-relative installed roots too` below covers that half of the contract instead.
    expect(withinProjectRoot(result, projectRoot, xdgConfigHome)).toEqual(
      expect.arrayContaining([
        { name: 'repo-id', origin: 'repo-local', dir: repoLocalDir },
        { name: 'user-id', origin: 'user', dir: userDir },
        { name: 'installed-id', origin: 'installed', dir: installedDir }
      ])
    );
    expect(withinProjectRoot(result, projectRoot, xdgConfigHome)).toHaveLength(3);
  });

  test('discovers this library\'s own library-relative installed roots too (PR 5 independent review)', () => {
    const projectRoot = mkTempDir('ensemble-adapters-discover-library-relative-project-');
    const xdgConfigHome = mkTempDir('ensemble-adapters-discover-library-relative-xdg-');
    // No .ensemble/adapters, no user adapters dir, no project-relative packages/ dir: every
    // "installed" result must come from this library's own on-disk location, not projectRoot.

    const result = discoverAdapters({ projectRoot, env: { XDG_CONFIG_HOME: xdgConfigHome } });
    const beads = result.find((entry) => entry.name === 'beads' && entry.origin === 'installed');

    expect(beads).toBeDefined();
    expect(beads.dir).toBe(
      path.resolve(__dirname, '..', '..', 'packages', 'development', 'skills', 'adapter-tracker-beads')
    );
  });
});

describe('discoverAdapters: library-relative installed-tier roots, one real copy per shipped layout (PR 5 independent review)', () => {
  const { mutateAndRequire } = require('./fixtures/toolchain/mutant-toolchain-copy');
  const UNRELATED_PROJECT_ROOT = '/tmp/toolchain-adapters-library-relative-unrelated-project';

  test.each([
    ['source'],
    ['pi'],
    ['codex'],
    ['opencode']
  ])("layout '%s': a copy of adapters.js at the real shipped relative position finds the adapter-tracker-beads skill copied alongside it, from a projectRoot that has nothing to do with the copy", (layout) => {
    const copy = makeLibraryLayoutCopy(layout, { includeAdapterSkills: true });
    try {
      delete require.cache[require.resolve(copy.adaptersPath)];
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const { loadAdapter: loadAdapterFromCopy } = require(copy.adaptersPath);
      const result = loadAdapterFromCopy('beads', { projectRoot: UNRELATED_PROJECT_ROOT, env: {} });
      expect(result.origin).toBe('installed');
      expect(fs.realpathSync(result.dir)).toBe(fs.realpathSync(path.join(copy.skillsRoot, 'adapter-tracker-beads')));
    } finally {
      copy.cleanup();
    }
  });

  describe('mutation-proof: removing the library-relative root derivation', () => {
    test("the real (unmutated) copy still finds 'beads' from an unrelated projectRoot", () => {
      const copy = makeLibraryLayoutCopy('source', { includeAdapterSkills: true });
      try {
        delete require.cache[require.resolve(copy.adaptersPath)];
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const { loadAdapter: loadAdapterFromCopy } = require(copy.adaptersPath);
        expect(() => loadAdapterFromCopy('beads', { projectRoot: UNRELATED_PROJECT_ROOT, env: {} })).not.toThrow();
      } finally {
        copy.cleanup();
      }
    });

    test("reverting installedSkillsRoots' own '...libraryRelativeSkillsRoots(),' spread to drop it makes 'beads' unreachable from an unrelated projectRoot again (NOT_INSTALLED)", () => {
      const copy = makeLibraryLayoutCopy('source', { includeAdapterSkills: true });
      try {
        const needle = '...libraryRelativeSkillsRoots(),';
        const replacement = '';
        const mutated = mutateAndRequire(copy.adaptersPath, needle, replacement);

        expect(() => mutated.loadAdapter('beads', { projectRoot: UNRELATED_PROJECT_ROOT, env: {} })).toThrow(
          expect.objectContaining({ code: 'NOT_INSTALLED' })
        );
      } finally {
        copy.cleanup();
      }
    });
  });

  describe('mutation-proof: widening the "package-root" shape one level higher than its fixed, correct offset', () => {
    test('the real (unmutated) copy does NOT find a planted adapter one level above the real skills root', () => {
      const copy = makeLibraryLayoutCopy('source', { includeAdapterSkills: true });
      try {
        // copy.skillsRoot is <copy.root>/pkg/skills; one level too high is <copy.root>/skills.
        const evilDir = path.join(copy.root, 'skills', 'adapter-evil');
        writeAdapterDir(evilDir, validAdapterManifest({ adapter: 'evil-widened' }));

        delete require.cache[require.resolve(copy.adaptersPath)];
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const { loadAdapter: loadAdapterFromCopy } = require(copy.adaptersPath);
        expect(() =>
          loadAdapterFromCopy('evil-widened', { projectRoot: UNRELATED_PROJECT_ROOT, env: {} })
        ).toThrow(expect.objectContaining({ code: 'NOT_INSTALLED' }));
      } finally {
        copy.cleanup();
      }
    });

    test("reverting libraryRelativeSkillsRoots' own 'path.join(ancestor, 'skills')' push to climb one level higher DOES find that same planted adapter (proving the fixed offset, not a search, is what keeps it out)", () => {
      const copy = makeLibraryLayoutCopy('source', { includeAdapterSkills: true });
      try {
        const evilDir = path.join(copy.root, 'skills', 'adapter-evil');
        writeAdapterDir(evilDir, validAdapterManifest({ adapter: 'evil-widened' }));

        const needle = "const roots = [path.join(ancestor, 'skills')];";
        const replacement = "const roots = [path.join(path.dirname(ancestor), 'skills')];";
        const mutated = mutateAndRequire(copy.adaptersPath, needle, replacement);

        const result = mutated.loadAdapter('evil-widened', { projectRoot: UNRELATED_PROJECT_ROOT, env: {} });
        expect(result.origin).toBe('installed');
      } finally {
        copy.cleanup();
      }
    });
  });

  describe("mutation-proof: dropping the Pi layout's own tail entry", () => {
    test("the real (unmutated) LIBRARY_LOCATION_TAILS still recognizes a Pi-shaped copy", () => {
      const copy = makeLibraryLayoutCopy('pi', { includeAdapterSkills: true });
      try {
        delete require.cache[require.resolve(copy.adaptersPath)];
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const { loadAdapter: loadAdapterFromCopy } = require(copy.adaptersPath);
        expect(() => loadAdapterFromCopy('beads', { projectRoot: UNRELATED_PROJECT_ROOT, env: {} })).not.toThrow();
      } finally {
        copy.cleanup();
      }
    });

    test("removing the Pi tail entry from LIBRARY_LOCATION_TAILS makes a Pi-shaped copy fail to find its own adapter (NOT_INSTALLED), while leaving the other three layouts' entries untouched", () => {
      const copy = makeLibraryLayoutCopy('pi', { includeAdapterSkills: true });
      try {
        const needle = "{ segments: ['vendor', 'lib', 'toolchain'], shape: 'package-root', npmScopeSiblings: true },";
        const replacement = '';
        const mutated = mutateAndRequire(copy.adaptersPath, needle, replacement);

        expect(() => mutated.loadAdapter('beads', { projectRoot: UNRELATED_PROJECT_ROOT, env: {} })).toThrow(
          expect.objectContaining({ code: 'NOT_INSTALLED' })
        );
      } finally {
        copy.cleanup();
      }
    });
  });

  describe("ctx.installedRoots: explicit extra roots are appended after the derived ones, never replacing them", () => {
    test('a ctx.installedRoots entry whose own adapter id is absent from every derived root is still discovered', () => {
      const copy = makeLibraryLayoutCopy('source', { includeAdapterSkills: true });
      const extraRoot = mkTempDir('ensemble-adapters-installed-roots-override-');
      try {
        writeAdapterDir(path.join(extraRoot, 'override-tool'), validAdapterManifest({ adapter: 'override-id' }));

        delete require.cache[require.resolve(copy.adaptersPath)];
        // eslint-disable-next-line global-require, import/no-dynamic-require
        const { loadAdapter: loadAdapterFromCopy } = require(copy.adaptersPath);

        // The real 'beads' (derived) is STILL found with installedRoots supplied...
        expect(() =>
          loadAdapterFromCopy('beads', { projectRoot: UNRELATED_PROJECT_ROOT, env: {}, installedRoots: [extraRoot] })
        ).not.toThrow();
        // ...and the override root's own id, unreachable from any derived root, is ALSO found.
        const overrideResult = loadAdapterFromCopy('override-id', {
          projectRoot: UNRELATED_PROJECT_ROOT,
          env: {},
          installedRoots: [extraRoot]
        });
        expect(overrideResult.origin).toBe('installed');
        expect(fs.realpathSync(overrideResult.dir)).toBe(fs.realpathSync(path.join(extraRoot, 'override-tool')));
      } finally {
        copy.cleanup();
      }
    });
  });
});
