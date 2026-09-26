/**
 * Packed-install regression test for PI → ensemble-core dependency
 * (regression for the install-blocking "Cannot find module
 * '@sunstone-partners/ensemble-core'" bug in the refinement-review
 * bootstrap scripts).
 *
 * Simulates a real npm install of the PI package as a downstream
 * user would experience it:
 *
 *   1. npm pack the live @sunstone-partners/ensemble-core from
 *      ../core into a tarball.
 *   2. npm pack the live @sunstone-partners/ensemble-pi from this
 *      package into a tarball.
 *   3. Create an isolated temp install prefix.
 *   4. npm install the core tarball, then npm install the pi tarball
 *      with --omit=dev into that prefix.
 *   5. Spawn a node child process from inside the install prefix
 *      (mimicking the bootstrap script living outside the package's
 *      own node_modules) that uses the canonical createRequire
 *      resolution pattern to load @sunstone-partners/ensemble-core
 *      via the installed PI package's package.json. Assert the core
 *      loads, refinementReview.session is callable, getLogsPath
 *      resolves, and the UI directory exists.
 *
 * If this test ever fails, either:
 *   - PI package.json dropped the @sunstone-partners/ensemble-core
 *     dependency declaration, OR
 *   - The bootstrap script no longer anchors via createRequire, OR
 *   - The published @sunstone-partners/ensemble-core tarball no longer
 *     exposes refinementReview.session.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PI_PKG_DIR = path.resolve(__dirname, '..');
const CORE_PKG_DIR = path.join(REPO_ROOT, 'packages/core');

function rmrf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

interface PackedArtifacts {
  installPrefix: string;
  piTarball: string;
  coreTarball: string;
  cleanup: () => void;
}

function packAndInstall(): PackedArtifacts {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-packed-install-'));
  const packDir = path.join(work, 'packs');
  const installPrefix = path.join(work, 'install');
  fs.mkdirSync(packDir, { mode: 0o755 });
  fs.mkdirSync(installPrefix, { mode: 0o755 });

  // 1. Pack core from its source dir.
  const coreTarball = run(
    'npm',
    ['pack', '--silent', '--pack-destination', packDir],
    CORE_PKG_DIR,
  ).trim();
  const coreTarballAbs = path.join(packDir, coreTarball);

  // 2. Pack PI from its source dir.
  const piTarball = run(
    'npm',
    ['pack', '--silent', '--pack-destination', packDir],
    PI_PKG_DIR,
  ).trim();
  const piTarballAbs = path.join(packDir, piTarball);

  // 3. Install core first into our isolated prefix.
  run(
    'npm',
    [
      'install',
      '--silent',
      '--no-audit',
      '--no-fund',
      '--prefix',
      installPrefix,
      '--omit=dev',
      coreTarballAbs,
    ],
    work,
  );

  // 4. Install PI — its dependency on @sunstone-partners/ensemble-core
  //    must pull in the already-installed core from the same prefix.
  run(
    'npm',
    [
      'install',
      '--silent',
      '--no-audit',
      '--no-fund',
      '--prefix',
      installPrefix,
      '--omit=dev',
      piTarballAbs,
    ],
    work,
  );

  return {
    installPrefix,
    piTarball: piTarballAbs,
    coreTarball: coreTarballAbs,
    cleanup: () => rmrf(work),
  };
}

// Probe script run inside the install prefix. It deliberately lives in
// a directory with no node_modules and uses the canonical createRequire
// resolution pattern from the SKILL.md guidance so the test fails if
// either the bootstrap pattern or the dependency declaration regresses.
const PROBE_SCRIPT = `'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const installPrefix = process.env.INSTALL_PREFIX;
const PI_PKG_JSON = require.resolve(
  '@sunstone-partners/ensemble-pi/package.json',
  {
    paths: [
      path.join(installPrefix, 'node_modules'),
      path.join(installPrefix, 'lib/node_modules'),
      installPrefix,
    ],
  },
);
const piRequire = createRequire(PI_PKG_JSON);
const core = piRequire('@sunstone-partners/ensemble-core');

if (!core || !core.refinementReview || !core.refinementReview.session) {
  throw new Error('core.refinementReview.session is not loadable');
}
const sess = core.refinementReview.session;
if (typeof sess.createSession !== 'function') {
  throw new Error('refinementReview.session.createSession is not a function');
}
if (typeof sess.mutateSession !== 'function') {
  throw new Error('refinementReview.session.mutateSession is not a function');
}
if (typeof sess.newToken !== 'function') {
  throw new Error('refinementReview.session.newToken is not a function');
}
if (typeof sess.migrateOrCreate !== 'function') {
  throw new Error('refinementReview.session.migrateOrCreate is not a function');
}
if (typeof core.getLogsPath !== 'function') {
  throw new Error('getLogsPath is not a function');
}
const logsPath = core.getLogsPath();
if (typeof logsPath !== 'string' || logsPath.length === 0) {
  throw new Error('getLogsPath did not return a string');
}
const corePkgJson = piRequire.resolve('@sunstone-partners/ensemble-core/package.json');
const uiDir = path.join(path.dirname(corePkgJson), 'lib/refinement-review/ui');
if (!fs.existsSync(uiDir)) {
  throw new Error('UI directory not found at: ' + uiDir);
}

// Smoke-test the new question-shape contract end-to-end through a
// real createSession + mutateSession cycle. If a future release drops
// 'options' / 'recommendedOptionId' / 'selectedOptionId' from the
// session schema, or breaks 'mutateSession' additive merge, this
// probe will throw before the assertion below.
const tmpSessionPath = path.join(installPrefix, '__probe-session.json');
try { fs.unlinkSync(tmpSessionPath); } catch {}
const fresh = sess.createSession({
  sessionPath: tmpSessionPath,
  kind: 'prd',
  sourcePath: __filename,
  questions: [
    {
      id: 'q-probe',
      prompt: 'probe',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      recommendedOptionId: 'yes',
    },
  ],
});
if (!fresh || typeof fresh.token !== 'string') {
  throw new Error('createSession did not return { session, token }');
}
const freshSessionPath = tmpSessionPath;
if (!fs.existsSync(freshSessionPath)) {
  throw new Error('createSession did not persist a session file');
}
const persisted = JSON.parse(fs.readFileSync(freshSessionPath, 'utf8'));
const probeQ = persisted.questions && persisted.questions[0];
if (!probeQ || !Array.isArray(probeQ.options) || probeQ.options.length !== 2) {
  throw new Error('created session did not persist options array');
}
if (probeQ.recommendedOptionId !== 'yes') {
  throw new Error('created session did not persist recommendedOptionId');
}
const revisionBefore = persisted.revision;
sess.mutateSession({
  sessionPath: freshSessionPath,
  expectedRevision: revisionBefore,
  mutate(s) {
    s.questions.forEach((q) => { q['selectedOptionId'] = 'yes'; });
  },
});
const mutated = JSON.parse(fs.readFileSync(freshSessionPath, 'utf8'));
if (mutated.revision <= revisionBefore) {
  throw new Error('mutateSession did not bump revision');
}
if (mutated.questions[0].selectedOptionId !== 'yes') {
  throw new Error('mutateSession did not persist selectedOptionId');
}

// Exercise migrateOrCreate against the same file path to prove the
// bootstrap-time helper is callable AND that additive fill-in of new
// question metadata (targetAnchor / options / recommendedOptionId) on a
// session that already exists does not clobber user-entered state.
const m = sess.migrateOrCreate({
  sessionPath: freshSessionPath,
  kind: 'prd',
  sourcePath: __filename,
  migrate(s) {
    s.questions.forEach((q) => {
      q['targetAnchor'] = { lineStart: 1, lineEnd: 1 };
      q['recommendedOptionId'] = 'yes';
    });
  },
});
if (!m || typeof m.token !== 'string' || m.token === fresh.token) {
  throw new Error('migrateOrCreate did not return a fresh token');
}
const afterMigrate = JSON.parse(fs.readFileSync(freshSessionPath, 'utf8'));
if (afterMigrate.sessionId !== mutated.sessionId) {
  throw new Error('migrateOrCreate changed sessionId (must preserve identity)');
}
if (afterMigrate.revision <= mutated.revision) {
  throw new Error('migrateOrCreate did not advance revision');
}
if (afterMigrate.questions[0].selectedOptionId !== 'yes') {
  throw new Error('migrateOrCreate clobbered user-selectedOptionId');
}
if (afterMigrate.questions[0].recommendedOptionId !== 'yes') {
  throw new Error('migrateOrCreate did not persist recommendedOptionId');
}
if (!afterMigrate.questions[0].targetAnchor || afterMigrate.questions[0].targetAnchor.lineStart !== 1) {
  throw new Error('migrateOrCreate did not fill in targetAnchor');
}
try { fs.unlinkSync(freshSessionPath); } catch {}

// The customer-facing Overview tab is authored through the exact bootstrap
// contract: migrateOrCreate({ ... customerSummary }) must land the text on
// document.customerSummary on first create, refresh it on re-run when the
// summary changed, and leave a recorded approval decision untouched. If a
// future release drops the parameter or the merge guard, this throws.
const csDocPath = path.join(installPrefix, '__probe-customer-summary.md');
const csSessionPath = path.join(installPrefix, '__probe-cs-session.json');
fs.writeFileSync(csDocPath, '# Probe PRD\\n\\n## Goals\\n\\nShip it.\\n');
try { fs.unlinkSync(csSessionPath); } catch {}
const SUMMARY_V1 = '## What we are building\\n\\nFirst draft.\\n';
const created = sess.migrateOrCreate({
  sessionPath: csSessionPath,
  kind: 'prd',
  sourcePath: csDocPath,
  questions: [{ id: 'q-cs', prompt: 'cs' }],
  customerSummary: SUMMARY_V1,
});
if (created.session.document.customerSummary !== SUMMARY_V1) {
  throw new Error('migrateOrCreate did not persist customerSummary on create');
}
sess.mutateSession({
  sessionPath: csSessionPath,
  expectedRevision: created.session.revision,
  mutate(s) {
    s.approval = {
      decision: 'approved',
      author: 'probe-customer',
      note: null,
      decidedAt: new Date().toISOString(),
    };
  },
});
const SUMMARY_V2 = '## What we are building\\n\\nSecond draft after edits.\\n';
const rerun = sess.migrateOrCreate({
  sessionPath: csSessionPath,
  kind: 'prd',
  sourcePath: csDocPath,
  questions: [{ id: 'q-cs', prompt: 'cs' }],
  customerSummary: SUMMARY_V2,
  reopen: true,
});
if (rerun.session.document.customerSummary !== SUMMARY_V2) {
  throw new Error('migrateOrCreate did not refresh customerSummary on re-run');
}
if (!rerun.session.approval || rerun.session.approval.decision !== 'approved') {
  throw new Error('migrateOrCreate clobbered the recorded approval decision');
}
const noop = sess.migrateOrCreate({
  sessionPath: csSessionPath,
  kind: 'prd',
  sourcePath: csDocPath,
  questions: [{ id: 'q-cs', prompt: 'cs' }],
  customerSummary: SUMMARY_V2,
  reopen: true,
});
if (noop.session.document.customerSummary !== SUMMARY_V2) {
  throw new Error('no-change re-run lost customerSummary');
}
const csOverview = core.refinementReview.overview;
if (!csOverview || typeof csOverview.deriveCustomerOverview !== 'function') {
  throw new Error('core.refinementReview.overview.deriveCustomerOverview is unavailable');
}
const derived = csOverview.deriveCustomerOverview(fs.readFileSync(csDocPath, 'utf8'));
if (derived.source !== 'derived' || !/Ship it\\./.test(derived.markdown)) {
  throw new Error('deriveCustomerOverview did not return the expected shape');
}
try { fs.unlinkSync(csSessionPath); } catch {}
try { fs.unlinkSync(csDocPath); } catch {}

process.stdout.write(JSON.stringify({
  piPkgJson: PI_PKG_JSON,
  corePkgJson,
  uiDir,
  logsPath,
  sessionKeys: Object.keys(core.refinementReview),
}));
`;

describe('packed install — PI depends on @sunstone-partners/ensemble-core', () => {
  let artifacts: PackedArtifacts | null = null;

  beforeAll(() => {
    artifacts = packAndInstall();
  }, 180_000);

  afterAll(() => {
    artifacts?.cleanup();
  });

  it('core tarball is produced and installed', () => {
    expect(artifacts).not.toBeNull();
    expect(fs.existsSync(artifacts!.coreTarball)).toBe(true);
    const installedCorePkg = path.join(
      artifacts!.installPrefix,
      'node_modules/@sunstone-partners/ensemble-core/package.json',
    );
    expect(fs.existsSync(installedCorePkg)).toBe(true);
  });

  it('pi tarball is produced and installed', () => {
    expect(fs.existsSync(artifacts!.piTarball)).toBe(true);
    const installedPiPkg = path.join(
      artifacts!.installPrefix,
      'node_modules/@sunstone-partners/ensemble-pi/package.json',
    );
    expect(fs.existsSync(installedPiPkg)).toBe(true);
  });

  it('package.json declares @sunstone-partners/ensemble-core as a dependency', () => {
    const piPkg = JSON.parse(
      fs.readFileSync(
        path.join(
          artifacts!.installPrefix,
          'node_modules/@sunstone-partners/ensemble-pi/package.json',
        ),
        'utf8',
      ),
    );
    const declaredVersion =
      piPkg.dependencies?.['@sunstone-partners/ensemble-core'];
    expect(declaredVersion).toBeTruthy();
    expect(typeof declaredVersion).toBe('string');
  });

  it('a script in the install prefix can resolve core via createRequire', () => {
    const probePath = path.join(
      artifacts!.installPrefix,
      '__probe__.js',
    );
    fs.writeFileSync(probePath, PROBE_SCRIPT, { mode: 0o644 });

    const stdout = execFileSync(process.execPath, [probePath], {
      cwd: artifacts!.installPrefix,
      env: {
        ...process.env,
        INSTALL_PREFIX: artifacts!.installPrefix,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = JSON.parse(stdout.trim());
    expect(result.piPkgJson).toContain('@sunstone-partners/ensemble-pi');
    expect(result.corePkgJson).toContain(
      '@sunstone-partners/ensemble-core',
    );
    expect(result.uiDir).toContain('lib/refinement-review/ui');
    expect(fs.existsSync(result.uiDir)).toBe(true);
    expect(typeof result.logsPath).toBe('string');
    expect(result.logsPath.length).toBeGreaterThan(0);
    expect(result.sessionKeys).toEqual(
      expect.arrayContaining(['session', 'server', 'opener']),
    );
  }, 60_000);
});
