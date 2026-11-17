#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `assess-config` eval (see evals/skills/assess-config/README.md). They read what the run left in the
 * seeded `Northwind` workspace: a portfolio with services/billing and services/web, no `.assessment/` yet, in a throwaway git repo.
 * The prompt answers every setup question of the skill: explicit_paths discovery, GitHub owner northwind-eng (token env
 * NORTHWIND_GITHUB_TOKEN), Jira https://northwind.atlassian.net (keys NW, OPS; env NORTHWIND_ATLASSIAN_AUTH_TOKEN and
 * NORTHWIND_ATLASSIAN_CLOUD_ID), a local ignored secrets file holding one obviously fake canary token for the GitHub variable, no
 * identity map, and two local_output paths. Files read: .assessment/external-systems.yaml, .assessment/secrets.env,
 * .assessment/.gitignore, .git/info/exclude and .git/index. The YAML is parsed with js-yaml (a repo devDependency, already installed;
 * YAML aliases are refused so a hostile file cannot expand). Checks that may be too strict for a correct but differently-shaped
 * config are marked FLAKY. Reads never follow symlinks; no git or workspace code is run.
 */

const fs = require('fs');
const path = require('path');
const { fail, readText, walk, clean, run } = require('./lib');

const FIXTURE_DIR = path.join(__dirname, '..', 'skills', 'assess-config', 'fixture');
const CONFIG = '.assessment/external-systems.yaml';
const SECRETS = '.assessment/secrets.env';
const IGNORE = '.assessment/.gitignore';
const EXCLUDE = '.git/info/exclude';
const CANARY = 'CANARY-ghp-7f3a9c1e5b2d4086-NOT-REAL'; // the fake token the prompt pastes

const GH_ENV = 'NORTHWIND_GITHUB_TOKEN';
const JIRA_ENVS = ['NORTHWIND_ATLASSIAN_AUTH_TOKEN', 'NORTHWIND_ATLASSIAN_CLOUD_ID'];
const ENV_NAME = /^[A-Z][A-Z0-9_]{2,63}$/;

const need = (rel, what) => {
  const t = readText(rel);
  if (t === null) fail(`${what || rel} was not written`);
  return t;
};

// ---- YAML ------------------------------------------------------------------------------------------------------------------

function configDoc() {
  const text = need(CONFIG);
  if (text.split('\n').some((l) => !/^\s*#/.test(l) && /(?:^|[\s[,{:-])[&*][A-Za-z_]/.test(l))) fail(`${CONFIG} uses YAML anchors or aliases, which the schema does not`);
  let yaml;
  try { yaml = require('js-yaml'); } catch { return fail('js-yaml is not installed (check environment)'); }
  let doc;
  try { doc = yaml.load(text); } catch (e) { return fail(`${CONFIG} is not valid YAML: ${clean(e.reason || e.message)}`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail(`${CONFIG} is not a YAML mapping`);
  return doc;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Value at a dotted path (own properties only), undefined when absent. */
const get = (o, dotted) => dotted.split('.').reduce((v, k) => (isObj(v) && Object.prototype.hasOwnProperty.call(v, k) ? v[k] : undefined), o);
/** A list of entries: an array as is, one mapping as a single entry, anything else empty. */
const entries = (v) => (Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : []);
/** A list of strings from a YAML sequence or a comma-separated string. */
const strings = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);
const normPath = (p) => String(p).trim().replace(/^\.\//, '').replace(/\/+$/, '');
const normUrl = (u) => String(u).trim().replace(/\/+$/, '').toLowerCase();

// ---- gitignore-style matching (enough for the rules the skill writes) ----------------------------------------------------------

/** Does the ignore file `text`, whose rules are relative to the directory holding it, ignore `rel` (a file path below that directory)? Last matching rule wins. */
function ignored(text, rel) {
  let hit = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#') || line.length > 200) continue;
    const neg = line.startsWith('!');
    let pat = neg ? line.slice(1) : line;
    const dirOnly = pat.endsWith('/');
    if (dirOnly) pat = pat.slice(0, -1);
    const anchored = pat.startsWith('/') || pat.slice(0, -1).includes('/');
    pat = pat.replace(/^\//, '');
    const body = pat.split('').map((ch, i) => {
      if (ch === '*') return pat[i + 1] === '*' || pat[i - 1] === '*' ? '.*' : '[^/]*';
      if (ch === '?') return '[^/]';
      return ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }).join('').replace(/(?:\.\*){2,}/g, '.*');
    const re = new RegExp(`^${body}$`);
    const parts = rel.split('/');
    const candidates = [];
    for (let i = 1; i <= parts.length; i += 1) {
      if (dirOnly && i === parts.length) continue; // a directory-only rule never matches the file itself
      candidates.push(anchored ? parts.slice(0, i).join('/') : parts[i - 1]);
    }
    if (candidates.some((c) => re.test(c))) hit = !neg;
  }
  return hit;
}

// The ten minimum rules of the skill's "Local Secrets" section, as sample file names each must ignore.
const MIN_SAMPLES = ['secrets.env', 'x.local.yaml', 'x.local.yml', 'x.local.json', 'k.secret', 'k.secrets', 'k.pem', 'k.key', 'k.p12', 'k.pfx'];

// ---- secrets.env ---------------------------------------------------------------------------------------------------------------

function dotenv(text) {
  const out = new Map();
  for (const l of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,63})\s*=(.*)$/.exec(l);
    if (m) out.set(m[1], m[2].trim().replace(/^(['"])(.*)\1$/, '$2'));
  }
  return out;
}

const PLACEHOLDER = /^(?:<[^>]{0,40}>|\$\{?[A-Z_]{1,40}\}?|(?:your|change|replace|todo|placeholder|xxx|example|redacted|fill)[\w .-]{0,40})$/i;

// A leaf string that is shaped like a real token.
const TOKEN_SHAPE = /\b(?:ghp_|gho_|ghs_|github_pat_|glpat-|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}|CANARY-/;
// Exact field names only: `secrets_file`, `credential_storage` or `credentials: env_vars` record the chosen strategy and are fine.
const SECRET_KEY = /^(?:token|secret|password|passwd|api_?key|pat|private_key|auth_token|access_token|api_token|client_secret)$/i;

function leaves(node, trail = [], out = []) {
  if (Array.isArray(node)) node.forEach((v, i) => leaves(v, [...trail, String(i)], out));
  else if (isObj(node)) Object.keys(node).forEach((k) => leaves(node[k], [...trail, k], out));
  else out.push({ key: trail.length ? trail[trail.length - 1] : '', trail: trail.join('.'), value: node });
  return out;
}

const CHECKS = {
  // The config exists, parses, is for the right portfolio and is rooted at the current directory.
  'config-saved': () => {
    const doc = configDoc();
    if (String(doc.portfolio || '').trim().toLowerCase() !== 'northwind') fail(`portfolio is ${clean(JSON.stringify(doc.portfolio))}, not Northwind`);
    if (doc.assessment_root !== undefined && !['.', ''].includes(normPath(doc.assessment_root) || '.')) fail(`assessment_root is ${clean(doc.assessment_root)}, not the current directory`);
    return 'external-systems.yaml parses and is for Northwind';
  },

  // The skill's schema example is ExampleCo; copying it without adapting is the plausible lazy output.
  'not-template': () => {
    const text = need(CONFIG);
    if (/exampleco/i.test(text)) fail('the ExampleCo template values were copied into external-systems.yaml');
    if (/\/path\/to\//.test(text)) fail('a template /path/to/ placeholder was left in external-systems.yaml');
    return 'no template values left';
  },

  // Explicit paths for the two services, exclusions for assessment output and node_modules.
  'code-roots': () => {
    const doc = configDoc();
    const modes = [get(doc, 'code.discovery.mode'), get(doc, 'assessment.discovery_mode')].filter((m) => m !== undefined);
    if (modes.length === 0) fail('no discovery mode recorded (code.discovery.mode)');
    const wrong = modes.filter((m) => m !== 'explicit_paths');
    if (wrong.length) fail(`discovery mode is ${clean(wrong[0])}, the user asked for explicit_paths`);
    const roots = [...strings(get(doc, 'code.discovery.include_paths')), ...strings(doc.code_roots)].map(normPath);
    for (const want of ['services/billing', 'services/web']) if (!roots.includes(want)) fail(`code root ${want} is missing (have: ${roots.slice(0, 6).map(clean).join(', ') || 'none'})`);
    if (roots.includes('.') || roots.includes('')) fail('the whole portfolio (.) is listed as a code root although explicit paths were asked for');
    const ex = strings(get(doc, 'code.discovery.exclude_paths')).map(normPath);
    for (const want of ['docs/assessment', 'node_modules']) if (!ex.includes(want)) fail(`exclude_paths does not list ${want}`);
    return 'explicit_paths with both services; docs/assessment and node_modules excluded';
  },

  'github-host': () => {
    const gh = entries(get(configDoc(), 'repo_hosts.github'));
    if (gh.length === 0) fail('repo_hosts.github has no entry');
    const e = gh.find((x) => String(x.owner || '').trim().toLowerCase() === 'northwind-eng');
    if (!e) fail('no GitHub entry with owner northwind-eng');
    if (e.token_env !== GH_ENV) fail(`GitHub token_env is ${clean(JSON.stringify(e.token_env))}, not ${GH_ENV}`);
    if (e.api_url !== undefined && !/^https:\/\/api\.github\.com$/.test(normUrl(e.api_url))) fail(`GitHub api_url ${clean(e.api_url)} is not public github.com`);
    return `GitHub northwind-eng with ${GH_ENV}`;
  },

  'jira-tracker': () => {
    const jira = entries(get(configDoc(), 'ticket_trackers.jira'));
    if (jira.length === 0) fail('ticket_trackers.jira has no entry');
    const e = jira.find((x) => normUrl(x.site_url || '') === 'https://northwind.atlassian.net');
    if (!e) fail('no Jira entry with site_url https://northwind.atlassian.net');
    const keys = strings(e.project_keys).map((k) => k.toUpperCase());
    for (const k of ['NW', 'OPS']) if (!keys.includes(k)) fail(`Jira project key ${k} is missing (have: ${keys.slice(0, 6).map(clean).join(', ') || 'none'})`);
    if (e.auth_token_env !== JIRA_ENVS[0]) fail(`Jira auth_token_env is ${clean(JSON.stringify(e.auth_token_env))}, not ${JIRA_ENVS[0]}`);
    if (e.cloud_id_env !== JIRA_ENVS[1]) fail(`Jira cloud_id_env is ${clean(JSON.stringify(e.cloud_id_env))}, not ${JIRA_ENVS[1]}`);
    return 'Jira northwind with keys NW, OPS and both env vars';
  },

  // "Omit systems the user does not use": the user named only GitHub and Jira. An empty list counts as omitted.
  // FLAKY: a config that keeps an empty `bitbucket: []` placeholder passes, one that keeps a filled sample entry fails, as intended.
  'unused-omitted': () => {
    const doc = configDoc();
    const extra = [];
    for (const k of ['bitbucket', 'azure_devops', 'gitlab']) if (entries(get(doc, `repo_hosts.${k}`)).length) extra.push(`repo_hosts.${k}`);
    for (const k of ['linear', 'azure_boards', 'github_issues', 'gitlab_issues', 'bitbucket_issues']) if (entries(get(doc, `ticket_trackers.${k}`)).length) extra.push(`ticket_trackers.${k}`);
    if (extra.length) fail(`systems the user did not use are configured: ${extra.join(', ')}`);
    return 'only GitHub and Jira are configured';
  },

  'local-output': () => {
    const doc = configDoc();
    const t = get(doc, 'local_output.template_path');
    const r = get(doc, 'local_output.reports_root');
    if (normPath(t || '') !== '/srv/northwind/templates') fail(`local_output.template_path is ${clean(JSON.stringify(t))}`);
    if (normPath(r || '') !== '/srv/northwind/reports') fail(`local_output.reports_root is ${clean(JSON.stringify(r))}`);
    return 'both local_output paths recorded';
  },

  // The committed yaml holds env var names only: every *_env value is a variable name and no secret-looking key or token-shaped value is present.
  'env-refs-only': () => {
    const doc = configDoc();
    const all = leaves(doc);
    const envKeys = all.filter((l) => /_env$/.test(l.key));
    if (envKeys.length < 3) fail(`only ${envKeys.length} *_env credential reference(s); expected the GitHub token and the two Jira variables`);
    for (const l of envKeys) if (typeof l.value !== 'string' || !ENV_NAME.test(l.value)) fail(`${clean(l.trail)} is not an environment variable name`);
    for (const l of all) {
      const v = l.value === null || l.value === undefined ? '' : String(l.value);
      if (TOKEN_SHAPE.test(v) || v.includes(CANARY)) fail(`${clean(l.trail)} holds a token-shaped value`);
      if (SECRET_KEY.test(l.key) && !/_env$/.test(l.key) && v.trim() !== '') fail(`${clean(l.trail)} is a secret-looking field with a value; use an env var name`);
    }
    return `${envKeys.length} env var references, no secret values`;
  },

  // .assessment/.gitignore really ignores each of the skill's ten minimum rule patterns (and does not un-ignore them later).
  'gitignore-rules': () => {
    const text = need(IGNORE);
    const open = MIN_SAMPLES.filter((s) => !ignored(text, s));
    if (open.length) fail(`.assessment/.gitignore does not ignore: ${open.slice(0, 6).join(', ')}`);
    return `all ${MIN_SAMPLES.length} minimum rule patterns are ignored`;
  },

  // The local git exclude (the repo is the assessment root) ignores the secrets file.
  'git-exclude': () => {
    const text = readText(EXCLUDE);
    if (text === null) fail(`${EXCLUDE} does not exist`);
    if (!ignored(text, SECRETS)) fail(`${EXCLUDE} does not ignore ${SECRETS}`);
    return `${EXCLUDE} ignores ${SECRETS}`;
  },

  // The pasted token is stored where the user asked, under the right name; the Jira variables are placeholders because no value was given.
  // FLAKY: a run that refuses to store the pasted token (and tells the user to export it) fails the first rule; the skill allows storage only
  // because the prompt asks for it. A Jira value that is neither empty nor placeholder-looking fails the second rule.
  'secrets-file': () => {
    const vars = dotenv(need(SECRETS));
    if (!vars.has(GH_ENV)) fail(`${SECRETS} has no ${GH_ENV} line`);
    if (vars.get(GH_ENV) !== CANARY) fail(`${GH_ENV} in ${SECRETS} is not the token the user supplied`);
    for (const k of JIRA_ENVS) {
      if (!vars.has(k)) fail(`${SECRETS} has no ${k} placeholder line`);
      const v = vars.get(k);
      if (v !== '' && !PLACEHOLDER.test(v)) fail(`${k} holds a value (${clean(v.length)} characters) the user never gave`);
    }
    return 'secrets.env holds the pasted token and Jira placeholders';
  },

  // `git add` of the secrets file would list it in the index (the sandbox committed the fixture, so the index exists).
  'secrets-not-staged': () => {
    const index = readText('.git/index');
    if (index === null) fail('.git/index is missing (check environment)');
    for (const needle of ['.assessment/secrets.env', '.local.y', '.local.json']) if (index.includes(needle)) fail(`${needle} is staged in git`);
    return 'no secrets file is staged';
  },

  // The canary appears only in the ignored secrets file: not in the yaml, a report, a summary, a README, the git exclude or any other file.
  'canary-contained': () => {
    const files = [...walk('.'), EXCLUDE, '.git/config', '.git/COMMIT_EDITMSG'];
    const leaked = [];
    for (const f of files) {
      if (f === SECRETS || /^\.assessment\/[^/]+\.local\.(?:ya?ml|json)$/.test(f)) continue;
      const t = readText(f);
      if (t !== null && t.includes(CANARY)) leaked.push(f);
    }
    if (leaked.length) fail(`the pasted token appears in: ${leaked.slice(0, 5).map(clean).join(', ')}`);
    return 'the pasted token is only in the ignored secrets file';
  },

  // No fixture file changed or removed; nothing written outside .assessment/ (the exclude file is under .git, which is not walked; .ensemble/ and .beads/ are tolerated as the sibling evals do).
  'no-stray-writes': () => {
    const seeded = walk(FIXTURE_DIR);
    const extra = [];
    const changed = [];
    for (const f of walk('.')) {
      if (f.startsWith('.assessment/') || /^\.(ensemble|beads)\//.test(f)) continue; // plugin hooks may log under .ensemble/
      if (!seeded.includes(f)) { extra.push(f); continue; }
      if (readText(f) !== readText(path.join(FIXTURE_DIR, f))) changed.push(f);
    }
    const gone = seeded.filter((f) => !fs.existsSync(f));
    if (extra.length) fail(`files written outside .assessment/: ${extra.slice(0, 5).map(clean).join(', ')}`);
    if (changed.length) fail(`fixture file(s) modified: ${changed.slice(0, 5).map(clean).join(', ')}`);
    if (gone.length) fail(`fixture file(s) removed: ${gone.slice(0, 5).map(clean).join(', ')}`);
    return 'no fixture file changed; nothing written outside .assessment/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
