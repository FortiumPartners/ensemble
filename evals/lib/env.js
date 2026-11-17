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
 * Credential names from the allowlist file plus `extra`. The file's optional `runtimes` map ({ "pi": [names] }) adds
 * names only when that runtime is in play, so a Claude run never receives Pi's provider keys. Only the default file may be absent (then the built-in
 * default applies); a `file` that was asked for explicitly must exist.
 */
function loadCredentialNames({ file, extra = [], runtime } = {}) {
  let names = DEFAULT_CREDENTIALS;
  let runtimeNames = [];
  const explicit = file !== undefined && file !== null;
  const target = explicit ? file : ALLOWLIST_FILE;
  if (explicit && !fs.existsSync(target)) throw new Error(`env allowlist ${target} does not exist`);
  if (fs.existsSync(target)) {
    file = target;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`env allowlist ${file} is not valid JSON: ${e.message}`); }
    if (!parsed || !Array.isArray(parsed.credentials)) throw new Error(`env allowlist ${file} must be { "credentials": [names] }`);
    names = parsed.credentials;
    if (parsed.runtimes !== undefined) {
      if (!parsed.runtimes || typeof parsed.runtimes !== 'object' || Array.isArray(parsed.runtimes) || !Object.values(parsed.runtimes).every(Array.isArray)) {
        throw new Error(`env allowlist ${file}: "runtimes" must be { "<runtime>": [names] }`);
      }
      runtimeNames = Object.prototype.hasOwnProperty.call(parsed.runtimes, runtime) ? parsed.runtimes[runtime] : [];
    }
  }
  const all = [...names, ...runtimeNames, ...extra];
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

const MAX_REASON = 160;

/**
 * A short, single-line, printable form of provider/runtime error text for a record or a printed line: secrets redacted first
 * (so a key is never cut in half), control characters removed, whitespace collapsed, at most MAX_REASON characters.
 */
function shortReason(text, secrets = []) {
  const clean = redactText(text, secrets).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > MAX_REASON ? `${clean.slice(0, MAX_REASON - 3)}...` : clean;
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


// ---- Eval `env`: non-secret variables for the AGENT's environment only ---------------------------------------------

const AGENT_ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const MAX_AGENT_ENV_VARS = 32;
const MAX_AGENT_ENV_VALUE = 200;
// Names that change how a process is loaded or reaches the network, or that name the harness's own inputs. Exact names, then prefixes.
const DENIED_ENV_NAMES = new Set([
  'PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR', 'TMP', 'TEMP', 'SHELL', 'USER', 'LOGNAME', 'PWD', 'IFS', 'ENV', 'BASH_ENV',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME',
  'RUBYOPT', 'RUBYLIB', 'PERL5OPT', 'PERL5LIB', 'SSH_AUTH_SOCK', 'CLAUDE_CONFIG_DIR',
]);
// Provider prefixes: a name here could redirect or reconfigure a provider client that holds a real key (AWS_ENDPOINT_URL, GOOGLE_API_BASE, ...).
const DENIED_ENV_PREFIXES = ['LD_', 'DYLD_', 'GIT_', 'ANTHROPIC_', 'EVALS_', 'NPM_CONFIG_', 'OPENAI_', 'GEMINI_', 'OPENROUTER_', 'AWS_', 'GOOGLE_', 'AZURE_'];
// Names that point a client at another server, whatever the provider (substring match, deliberately broad).
const ENDPOINT_LIKE_RE = /BASE_URL|_ENDPOINT|ENDPOINT_|API_BASE|API_URL|_URL$|_HOST$/;
// Credential-like names (substring match, deliberately broad).
const CREDENTIAL_LIKE_RE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PROXY/;

/** Every credential name the harness knows of: the built-in default plus the allowlist file's names and every runtime's names. */
function allKnownCredentialNames(file = ALLOWLIST_FILE) {
  const names = new Set(DEFAULT_CREDENTIALS);
  if (!fs.existsSync(file)) return names;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`env allowlist ${file} is not valid JSON: ${e.message}`); }
  if (parsed && Array.isArray(parsed.credentials)) for (const n of parsed.credentials) names.add(n);
  if (parsed && parsed.runtimes && typeof parsed.runtimes === 'object') for (const list of Object.values(parsed.runtimes)) if (Array.isArray(list)) for (const n of list) names.add(n);
  return names;
}

/** Why `name` may not be set by an eval's `env`, or null when it may. `credentialNames`: names to refuse in addition to the built-in rules. */
function deniedAgentEnvName(name, credentialNames = allKnownCredentialNames()) {
  if (DENIED_ENV_NAMES.has(name)) return 'it is a name the harness controls';
  const prefix = DENIED_ENV_PREFIXES.find((p) => name.startsWith(p));
  if (prefix) return `names starting with ${prefix} are not allowed`;
  if (ENDPOINT_LIKE_RE.test(name)) return 'it looks like an endpoint or base URL (BASE_URL, _ENDPOINT, API_BASE, _URL, _HOST); `env` may not redirect a provider client';
  if (CREDENTIAL_LIKE_RE.test(name)) return 'it looks like a credential (KEY, TOKEN, SECRET, PASSWORD, ...); `env` holds non-secret values only';
  if (credentialNames.has(name)) return 'it is on the credential allowlist';
  return null;
}

/**
 * Validate an eval's `env` map (NAME -> string). Returns a plain copy; throws an Error whose message names the problem.
 * Values are not secrets and are never redacted from transcripts.
 */
function validateAgentEnv(map, credentialNames = allKnownCredentialNames()) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('`env` must be an object of NAME -> string');
  const names = Object.keys(map);
  if (names.length === 0) throw new Error('`env` must not be empty (omit it instead)');
  if (names.length > MAX_AGENT_ENV_VARS) throw new Error(`\`env\` may hold at most ${MAX_AGENT_ENV_VARS} variables`);
  const out = {};
  for (const name of names) {
    if (!AGENT_ENV_NAME_RE.test(name)) throw new Error(`\`env\` name ${JSON.stringify(name.slice(0, 60))} must match ${AGENT_ENV_NAME_RE}`);
    const why = deniedAgentEnvName(name, credentialNames);
    if (why) throw new Error(`\`env\` name ${name} is not allowed: ${why}`);
    const v = map[name];
    if (typeof v !== 'string') throw new Error(`\`env\` value of ${name} must be a string`);
    if (v.length > MAX_AGENT_ENV_VALUE) throw new Error(`\`env\` value of ${name} is longer than ${MAX_AGENT_ENV_VALUE} characters`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) throw new Error(`\`env\` value of ${name} contains a control character`);
    out[name] = v;
  }
  return out;
}

/**
 * Put an eval's `env` into the agent environment `env`. Refuses (throws) a name that is a credential of this run (for example one
 * named by --allow-env) or that the agent environment already carries: an eval can never overwrite a credential or a base variable.
 */
function applyAgentEnv(env, map, credentials = []) {
  for (const [name, value] of Object.entries(map || {})) {
    if (Object.prototype.hasOwnProperty.call(env, name) || deniedAgentEnvName(name, new Set(credentials))) {
      throw new Error(`eval \`env\` name ${name} is a credential or a variable the harness sets; refusing to override it`);
    }
    env[name] = value;
  }
  return env;
}

module.exports = {
  AGENT_ENV_NAME_RE, allKnownCredentialNames, deniedAgentEnvName, validateAgentEnv, applyAgentEnv,
  BASE_NAMES, DEFAULT_CREDENTIALS, ALLOWLIST_FILE, REDACTED,
  loadCredentialNames, isCI, buildEnv, makeCiHome, GIT_HARDEN, gitEnv, secretValues, redactText, redactDeep, shortReason, MAX_REASON,
};
