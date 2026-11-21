'use strict';

/**
 * Shared test helper (NOT a test file itself) for `adapter-tracker-jira`'s own test suite
 * (TRD-2026-8d825f54 TRD-032/TRD-032-TEST). Writes a small, executable, node-shebang stub
 * `jira` script into a caller-supplied directory under `os.tmpdir()`; a caller prepends that
 * directory to `PATH` so the adapter's real, unmodified `adapter.yaml` `run[]` templates
 * (which invoke the bare binary name `jira`, resolved via `PATH`) hit this stub instead of a
 * real `jira` install. NEVER writes inside the real repository tree and NEVER shells out to a
 * real `jira` binary itself -- no `jira` binary is installed in this environment at all.
 *
 * The stub's canned JSON mirrors the flat-object shape
 * `packages/infrastructure/skills/jira/SKILL.md`'s own jq examples document for `jira issues
 * read` (top-level `.key`/`.summary`/`.status`), extended with the `issueType`/`description`/
 * `priority`/`labels` fields this adapter's own `adapter.yaml` documents as an inferred,
 * REST-API-shaped convention (not independently captured live -- see that manifest's own
 * capability comments and this adapter's `SKILL.md` "Known limits").
 *
 * A per-test CONTROL FILE, not an env var, drives response variations, mirroring
 * `adapter-tracker-beads-stub.js`'s own documented reasoning: `runner.js#buildChildEnv`
 * deliberately strips every env var the resolved adapter's own `env:` list does not declare
 * (plus a small fixed allowlist) before spawning ANY adapter child process, so a custom
 * `STUB_*` env var set on the TEST process would never reach the stub child. The control file
 * lives INSIDE the caller-supplied `binDir` (`<binDir>/control.json`), giving every test its
 * own private channel with no shared state across jest worker processes.
 */

const fs = require('fs');
const path = require('path');

const CONTROL_FILE_NAME = 'control.json';

/**
 * Resolve one test's control-file path, colocated with its stub binary inside `binDir`.
 * @param {string} binDir absolute path to the per-test stub bin directory
 * @returns {string}
 */
function controlFilePath(binDir) {
  return path.join(binDir, CONTROL_FILE_NAME);
}

/**
 * Write this test's stub response overrides. Call once per test (after `writeJiraStub(binDir)`,
 * before invoking the adapter), passing the same `binDir`. No cleanup call is needed: the
 * control file lives inside `binDir`, which every caller already removes in its own `afterEach`
 * (`fs.rmSync(dir, {recursive: true, force: true})`).
 * @param {string} binDir the same directory passed to `writeJiraStub`
 * @param {{issueStatus?: string, errorEnvelope?: boolean}} [overrides]
 */
function writeStubControl(binDir, overrides = {}) {
  fs.writeFileSync(controlFilePath(binDir), JSON.stringify(overrides));
}

const JIRA_STUB_SOURCE = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);

function readControl() {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]), 'control.json'), 'utf8'));
  } catch {
    return {};
  }
}
const control = readControl();
const status = control.issueStatus || 'In Review';
const errorEnvelope = Boolean(control.errorEnvelope);

function out(value) {
  process.stdout.write(JSON.stringify(value));
}

// Matches the adapter's own documented tool-failure-on-zero-exit shape (TRD-024's
// \`checkZeroExitErrorEnvelope\`, reused verbatim by this adapter's runner call): a top-level
// JSON OBJECT with its own \`error\` property.
const ERROR_ENVELOPE = { error: { code: 'TOOL_FAILED', message: 'stub jira failure' } };

function issueObject(key) {
  return {
    key,
    summary: 'Stub issue summary',
    description: 'Stub issue description',
    issueType: 'Bug',
    status,
    priority: 'High',
    labels: ['stub-label']
  };
}

if (argv[0] === '--version') {
  process.stdout.write('jira 1.0.0 (ensemble-client)\\n');
} else if (argv[0] === 'issues' && argv[1] === 'read') {
  out(errorEnvelope ? ERROR_ENVELOPE : issueObject(argv[2]));
} else if (argv[0] === 'issues' && argv[1] === 'list') {
  out(errorEnvelope ? ERROR_ENVELOPE : [issueObject('VA-1'), issueObject('VA-2')]);
} else if (argv[0] === 'issues' && argv[1] === 'create') {
  out(errorEnvelope ? ERROR_ENVELOPE : issueObject('VA-created-1'));
} else if (argv[0] === 'issues' && argv[1] === 'update') {
  out(errorEnvelope ? ERROR_ENVELOPE : issueObject(argv[2]));
} else if (argv[0] === 'comments' && argv[1] === 'create') {
  out(errorEnvelope ? ERROR_ENVELOPE : { id: 'comment-1', body: argv[argv.indexOf('--body') + 1] });
} else if (argv[0] === 'comments' && argv[1] === 'list') {
  out(errorEnvelope ? ERROR_ENVELOPE : [{ id: 'comment-1', body: 'a stub comment' }]);
} else {
  process.stderr.write('stub jira: unrecognized argv ' + JSON.stringify(argv) + '\\n');
  process.exit(1);
}
`;

/**
 * Write an executable `jira` stub script into `binDir` (created if missing). Returns `binDir`
 * for convenient chaining.
 * @param {string} binDir absolute path, expected to live under `os.tmpdir()`
 * @returns {string} `binDir`
 */
function writeJiraStub(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const jiraPath = path.join(binDir, 'jira');
  fs.writeFileSync(jiraPath, JIRA_STUB_SOURCE, { mode: 0o755 });
  fs.chmodSync(jiraPath, 0o755);
  return binDir;
}

module.exports = { writeJiraStub, writeStubControl };
