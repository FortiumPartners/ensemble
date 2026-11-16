'use strict';

/**
 * Environment allowlist and secret redaction.
 * The agent process gets PATH, LANG, TERM, TMPDIR, HOME and the named credentials; nothing else is inherited.
 * Credential names come from evals/env-allowlist.json (editable) plus any `--allow-env NAME` flags.
 */

const fs = require('fs');
const path = require('path');

const BASE_NAMES = ['PATH', 'LANG', 'TERM', 'TMPDIR'];
const DEFAULT_CREDENTIALS = ['ANTHROPIC_API_KEY'];
const ALLOWLIST_FILE = path.join(__dirname, '..', 'env-allowlist.json');
const REDACTED = '[REDACTED]';
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Credential names from the allowlist file plus `extra`. Only the default file may be absent (then the built-in
 * default applies); a `file` that was asked for explicitly must exist.
 */
function loadCredentialNames({ file, extra = [] } = {}) {
  let names = DEFAULT_CREDENTIALS;
  const explicit = file !== undefined && file !== null;
  const target = explicit ? file : ALLOWLIST_FILE;
  if (explicit && !fs.existsSync(target)) throw new Error(`env allowlist ${target} does not exist`);
  if (fs.existsSync(target)) {
    file = target;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`env allowlist ${file} is not valid JSON: ${e.message}`); }
    if (!parsed || !Array.isArray(parsed.credentials)) throw new Error(`env allowlist ${file} must be { "credentials": [names] }`);
    names = parsed.credentials;
  }
  const all = [...names, ...extra];
  for (const n of all) if (typeof n !== 'string' || !NAME_RE.test(n)) throw new Error(`invalid environment variable name on allowlist: ${JSON.stringify(n)}`);
  return [...new Set(all)];
}

/** Hosted CI: CI=true or GITHUB_ACTIONS=true. */
function isCI(env = process.env) {
  const t = (v) => String(v || '').toLowerCase() === 'true';
  return t(env.CI) || t(env.GITHUB_ACTIONS);
}

/**
 * Build the agent environment from `parent`. `home` overrides HOME (used in CI, where it is a per-run temp dir).
 * Allowlisted names that are unset in the parent stay unset.
 */
function buildEnv({ parent = process.env, credentials = DEFAULT_CREDENTIALS, home } = {}) {
  const env = {};
  for (const n of [...BASE_NAMES, ...credentials]) if (parent[n] !== undefined) env[n] = parent[n];
  if (home !== undefined) env.HOME = home;
  else if (parent.HOME !== undefined) env.HOME = parent.HOME;
  return env;
}

/**
 * Arguments placed before every git subcommand the harness runs. Neutralised keys: core.fsmonitor, core.hooksPath,
 * protocol.ext.allow, core.pager, core.gitProxy; core.sshCommand is covered by gitEnv's GIT_SSH_COMMAND.
 * NOT neutralised: remote.<name>.uploadpack / receivepack. A `-c` override does not beat a value planted in the
 * repository config (git reports "more than one uploadpack given, using the first" and keeps the planted one),
 * so the harness must never run ls-remote/fetch/push against a workspace remote name; it reads the bare
 * repository by path instead (see graders.remoteBranchUnchanged).
 */
const GIT_HARDEN = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.ext.allow=never',
  '-c', 'core.pager=cat', '-c', 'core.gitProxy='];

/**
 * Environment for the harness's own git calls: no GIT_* from the parent (GIT_DIR, GIT_WORK_TREE, GIT_SSH_COMMAND...),
 * no system or global config, no prompts, and only PATH and a HOME that holds no config. GIT_SSH_COMMAND is pinned
 * to `false` so a workspace `core.sshCommand` cannot run (the environment variable outranks the config key).
 */
function gitEnv(parent = process.env) {
  return {
    PATH: parent.PATH || '/usr/bin:/bin', HOME: '/nonexistent', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'false',
  };
}

/** Create the per-run HOME directory used in hosted CI, under `workdir`. Caller removes it. */
function makeCiHome(workdir) {
  fs.mkdirSync(workdir, { recursive: true });
  return fs.mkdtempSync(path.join(workdir, 'home-'));
}

/** Values of allowlisted credentials present in `env` (non-empty). */
function secretValues(env, credentials) {
  return [...new Set(credentials.map((n) => env[n]).filter((v) => typeof v === 'string' && v.length > 0))]
    .sort((a, b) => b.length - a.length);
}

/** Every form of `secret` that must not survive: raw, JSON-escaped, URL-encoded, and base64 (standard, URL-safe, unpadded). */
function secretForms(secret) {
  const b64 = Buffer.from(secret, 'utf8').toString('base64');
  return [
    secret,
    JSON.stringify(secret).slice(1, -1),
    encodeURIComponent(secret),
    b64,
    b64.replace(/=+$/, ''),
    b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  ];
}

/** Replace every secret value (raw, JSON-escaped, URL-encoded and base64 forms) in `text` by [REDACTED]. */
function redactText(text, secrets) {
  let out = String(text);
  const forms = [...new Set(secrets.flatMap(secretForms))].filter((f) => f.length > 0).sort((a, b) => b.length - a.length);
  for (const f of forms) out = out.split(f).join(REDACTED);
  return out;
}

/** Deep copy of `value` with secrets removed from every string, key included. */
function redactDeep(value, secrets) {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [redactText(k, secrets), redactDeep(v, secrets)]));
  }
  return value;
}

module.exports = {
  BASE_NAMES, DEFAULT_CREDENTIALS, ALLOWLIST_FILE, REDACTED,
  loadCredentialNames, isCI, buildEnv, makeCiHome, GIT_HARDEN, gitEnv, secretValues, redactText, redactDeep,
};
