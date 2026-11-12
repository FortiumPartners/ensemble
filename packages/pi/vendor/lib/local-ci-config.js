'use strict';

/**
 * Per-repository local-CI gate configuration validator.
 *
 * Pure: the caller supplies the config source (YAML text or an already-parsed
 * object). FAIL CLOSED: a missing config is a problem (never another repo's
 * defaults), every unknown key, missing required key, wrong type or job that is
 * both included and excluded is reported by name, and no approval set is
 * returned unless the config is fully valid.
 *
 * Result: { ok:true, problems:[], approvalSet } or { ok:false, problems:[...] }.
 * approvalSet = { workflows:[{file, jobs:[{id, matrix}]}],
 *   checks:[{workflow, job, matrix}], excluded:[{workflow, job, reason}],
 *   excludedSteps:[{workflow, job, step, reason}], steps:[{name, cmd}],
 *   equivalents:[{workflowStep, runs}], secretNames:[envVarName], outputPaths:[repoRelativePath],
 *   statusContext, botReview:{ skipped, logins } }
 */

const yaml = require('js-yaml');

const TOP_REQUIRED = ['workflows', 'steps', 'status_context'];
const TOP_ALLOWED = ['workflows', 'steps', 'excluded', 'excluded_steps', 'equivalents', 'secret_names', 'output_paths', 'status_context', 'bot_reviewers', 'hosted_reuse'];

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isText(v) {
  return typeof v === 'string' && v.trim() !== '';
}
function isScalar(v) {
  return isText(v) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';
}

function checkKeys(obj, allowed, required, where, problems) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) problems.push(`${where}: unknown key "${key}"`);
  }
  for (const key of required) {
    if (!(key in obj)) problems.push(`${where}: missing required key "${key}"`);
  }
}

function expandMatrix(matrix) {
  let combos = [{}];
  for (const key of Object.keys(matrix)) {
    const next = [];
    for (const combo of combos) {
      for (const value of matrix[key]) next.push({ ...combo, [key]: value });
    }
    combos = next;
  }
  return combos;
}

function validateWorkflows(list, problems) {
  const workflows = [];
  const seenFiles = new Set();
  if (!Array.isArray(list) || list.length === 0) {
    problems.push('workflows: must be a non-empty list');
    return workflows;
  }
  list.forEach((wf, i) => {
    const where = `workflows[${i}]`;
    if (!isObject(wf)) {
      problems.push(`${where}: must be a mapping`);
      return;
    }
    checkKeys(wf, ['file', 'jobs'], ['file', 'jobs'], where, problems);
    if ('file' in wf && !isText(wf.file)) problems.push(`${where}.file: must be non-empty text`);
    const jobs = [];
    const seenJobs = new Set();
    if ('jobs' in wf) {
      if (!Array.isArray(wf.jobs) || wf.jobs.length === 0) {
        problems.push(`${where}.jobs: must be a non-empty list`);
      } else {
        wf.jobs.forEach((job, j) => {
          const jw = `${where}.jobs[${j}]`;
          if (!isObject(job)) {
            problems.push(`${jw}: must be a mapping`);
            return;
          }
          checkKeys(job, ['id', 'matrix'], ['id'], jw, problems);
          if ('id' in job && !isText(job.id)) problems.push(`${jw}.id: must be non-empty text`);
          let matrix = {};
          if ('matrix' in job) {
            if (!isObject(job.matrix) || Object.keys(job.matrix).length === 0) {
              problems.push(`${jw}.matrix: must be a non-empty mapping of lists`);
            } else {
              for (const [k, v] of Object.entries(job.matrix)) {
                if (!Array.isArray(v) || v.length === 0 || !v.every(isScalar)) {
                  problems.push(`${jw}.matrix.${k}: must be a non-empty list of scalar values`);
                }
              }
              matrix = job.matrix;
            }
          }
          if (isText(job.id)) {
            const key = JSON.stringify([job.id, Object.keys(matrix).sort().map((k) => [k, matrix[k]])]);
            if (seenJobs.has(key)) problems.push(`${jw}: duplicate job "${job.id}" with the same matrix in ${isText(wf.file) ? wf.file : where}`);
            seenJobs.add(key);
            jobs.push({ id: job.id, matrix });
          }
        });
      }
    }
    if (isText(wf.file)) {
      if (seenFiles.has(wf.file)) problems.push(`${where}.file: duplicate workflow file "${wf.file}"`);
      seenFiles.add(wf.file);
      workflows.push({ file: wf.file, jobs });
    }
  });
  return workflows;
}

function validateExcluded(list, problems) {
  const excluded = [];
  if (list === undefined) return excluded;
  if (!Array.isArray(list)) {
    problems.push('excluded: must be a list');
    return excluded;
  }
  list.forEach((ex, i) => {
    const where = `excluded[${i}]`;
    if (!isObject(ex)) {
      problems.push(`${where}: must be a mapping`);
      return;
    }
    checkKeys(ex, ['workflow', 'job', 'reason'], ['workflow', 'job', 'reason'], where, problems);
    for (const k of ['workflow', 'job', 'reason']) {
      if (k in ex && !isText(ex[k])) problems.push(`${where}.${k}: must be non-empty text`);
    }
    if (isText(ex.workflow) && isText(ex.job) && isText(ex.reason)) {
      excluded.push({ workflow: ex.workflow, job: ex.job, reason: ex.reason });
    }
  });
  return excluded;
}

/** A list of mappings whose keys are all required non-empty text. */
function validateRecords(list, where, keys, problems) {
  const out = [];
  if (list === undefined) return out;
  if (!Array.isArray(list)) {
    problems.push(`${where}: must be a list`);
    return out;
  }
  list.forEach((item, i) => {
    const at = `${where}[${i}]`;
    if (!isObject(item)) {
      problems.push(`${at}: must be a mapping`);
      return;
    }
    checkKeys(item, keys, keys, at, problems);
    for (const k of keys) {
      if (k in item && !isText(item[k])) problems.push(`${at}.${k}: must be non-empty text`);
    }
    if (keys.every((k) => isText(item[k]))) out.push(Object.fromEntries(keys.map((k) => [k, item[k]])));
  });
  return out;
}

/**
 * The trusted command list: required, non-empty, unique names. These are the
 * exact commands the runner executes itself, in order, per required Node version.
 */
function validateSteps(list, problems) {
  if (list === undefined) return [];
  if (Array.isArray(list) && list.length === 0) {
    problems.push('steps: must be a non-empty list');
    return [];
  }
  const steps = validateRecords(list, 'steps', ['name', 'cmd'], problems);
  const seen = new Set();
  for (const s of steps) {
    if (seen.has(s.name)) problems.push(`steps: duplicate step name "${s.name}"`);
    seen.add(s.name);
  }
  return steps;
}

// Environment-variable NAMES only (never values): these are the secrets the maintainer allows trusted steps to see. The
// names come from the base-ref config so neither a PR head nor a caller can choose what reaches the code under test; the
// values are read from the maintainer's environment or the fixed gitignored .ensemble/local-ci.secrets.env, never this file.
const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
function validateSecretNames(value, problems) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.push('secret_names: must be a list of environment variable names');
    return [];
  }
  const out = [];
  value.forEach((name, i) => {
    if (typeof name !== 'string' || !SECRET_NAME_RE.test(name)) {
      problems.push(`secret_names[${i}]: must be an environment variable NAME (letters, digits, underscore); values never belong in this file`);
    } else if (out.includes(name)) {
      problems.push(`secret_names[${i}]: duplicate name "${name}"`);
    } else {
      out.push(name);
    }
  });
  return out;
}

// Paths a trusted step is allowed to leave behind as UNTRACKED files (install and build output). Anything else a step
// creates fails the run, because an untracked file is the one thing a step can plant that a later command, or its own
// test, reads as permission to pass. Each entry is a repo-relative directory (covers everything under it) or one exact
// file: no globs, no `..`, no absolute paths, so the matcher is a plain prefix test with nothing to misparse.
const DEFAULT_OUTPUT_PATHS = ['node_modules', 'coverage', '.cache', 'dist'];
const OUTPUT_PATH_RE = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/;
function validateOutputPaths(value, problems) {
  if (value === undefined || value === null) return [...DEFAULT_OUTPUT_PATHS];
  if (!Array.isArray(value)) {
    problems.push('output_paths: must be a list of repo-relative directories or files');
    return [...DEFAULT_OUTPUT_PATHS];
  }
  const out = [];
  value.forEach((raw, i) => {
    const p = typeof raw === 'string' ? raw.replace(/\/+$/, '') : raw;
    const bad = typeof p !== 'string' || !OUTPUT_PATH_RE.test(p) || p.split('/').some((seg) => seg === '.' || seg === '..' || seg === '.git');
    if (bad) {
      problems.push(`output_paths[${i}]: must be a plain repo-relative path (letters, digits, . _ @ + - and /), not absolute, not containing "..", "." or ".git", and no globs`);
    } else if (out.includes(p)) {
      problems.push(`output_paths[${i}]: duplicate path "${p}"`);
    } else {
      out.push(p);
    }
  });
  return out;
}

function validateBots(value, problems) {
  if (value === undefined || value === null) return { skipped: true, logins: [] };
  if (!Array.isArray(value) || !value.every(isText)) {
    problems.push('bot_reviewers: must be a list of non-empty logins');
    return { skipped: true, logins: [] };
  }
  const logins = value.map((l) => l.trim());
  return { skipped: logins.length === 0, logins };
}

/**
 * Opt-in to accepting hosted CI results instead of re-running the commands locally (see local-ci-hosted.js).
 * `covers` names the local `steps` that hosted CI is declared to run; EVERY step must be named, so a step added to
 * `steps` without a hosted counterpart switches reuse off. `extra_workflows` (same shape as `workflows`) lists hosted
 * jobs beyond the approval set that must also be green. Absent -> null: never reuse hosted results.
 */
function validateHostedReuse(value, steps, problems) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    problems.push('hosted_reuse: must be a mapping');
    return null;
  }
  checkKeys(value, ['covers', 'extra_workflows'], ['covers'], 'hosted_reuse', problems);
  const stepNames = steps.map((s) => s.name);
  const covers = [];
  if ('covers' in value) {
    if (!Array.isArray(value.covers) || value.covers.length === 0) {
      problems.push('hosted_reuse.covers: must be a non-empty list of step names');
    } else {
      value.covers.forEach((name, i) => {
        if (!isText(name)) problems.push(`hosted_reuse.covers[${i}]: must be non-empty text`);
        else if (!stepNames.includes(name)) problems.push(`hosted_reuse.covers[${i}]: "${name}" is not a step in steps`);
        else if (covers.includes(name)) problems.push(`hosted_reuse.covers[${i}]: duplicate step "${name}"`);
        else covers.push(name);
      });
      for (const name of stepNames) {
        if (!covers.includes(name)) problems.push(`hosted_reuse.covers: step "${name}" is not declared as run by hosted CI; list it or remove hosted_reuse`);
      }
    }
  }
  const extraWorkflows = 'extra_workflows' in value ? validateWorkflows(value.extra_workflows, problems) : [];
  return { covers, extraWorkflows };
}

function validateConfig(source) {
  if (source === undefined || source === null || (typeof source === 'string' && source.trim() === '')) {
    return {
      ok: false,
      problems: ['local CI config is missing (expected .ensemble/local-ci.yaml); no defaults are assumed'],
    };
  }

  let config = source;
  if (typeof source === 'string') {
    try {
      config = yaml.load(source);
    } catch (err) {
      return { ok: false, problems: [`local CI config is not valid YAML: ${err.message}`] };
    }
    if (config === undefined || config === null) {
      return {
        ok: false,
        problems: ['local CI config is missing (expected .ensemble/local-ci.yaml); no defaults are assumed'],
      };
    }
  }
  if (!isObject(config)) {
    return { ok: false, problems: ['local CI config: top level must be a mapping'] };
  }

  const problems = [];
  // app_id gets its own explanatory problem below instead of the generic unknown-key line.
  checkKeys(Object.fromEntries(Object.entries(config).filter(([k]) => k !== 'app_id')), TOP_ALLOWED, TOP_REQUIRED, 'config', problems);

  const workflows = 'workflows' in config ? validateWorkflows(config.workflows, problems) : [];
  const excluded = validateExcluded(config.excluded, problems);
  const excludedSteps = validateRecords(config.excluded_steps, 'excluded_steps', ['workflow', 'job', 'step', 'reason'], problems);
  const steps = validateSteps(config.steps, problems);
  const equivalents = validateRecords(config.equivalents, 'equivalents', ['workflowStep', 'runs'], problems);

  if ('status_context' in config && !isText(config.status_context)) {
    problems.push('status_context: must be non-empty text');
  }
  if ('app_id' in config) {
    problems.push('app_id: the GitHub App was removed; the gate posts the status with the maintainer\'s own gh login, so delete the app_id key');
  }
  const botReview = validateBots(config.bot_reviewers, problems);
  const secretNames = validateSecretNames(config.secret_names, problems);
  const outputPaths = validateOutputPaths(config.output_paths, problems);
  const hostedReuseDecl = validateHostedReuse(config.hosted_reuse, steps, problems);

  for (const ex of excluded) {
    const wf = workflows.find((w) => w.file === ex.workflow);
    if (wf && wf.jobs.some((j) => j.id === ex.job)) {
      problems.push(`job "${ex.job}" in ${ex.workflow} is both included and excluded`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  const expandChecks = (list) => {
    const out = [];
    for (const wf of list) {
      for (const job of wf.jobs) {
        for (const matrix of expandMatrix(job.matrix)) out.push({ workflow: wf.file, job: job.id, matrix });
      }
    }
    return out;
  };
  const checks = expandChecks(workflows);
  // Hosted jobs the reuse path must see green: the approval set plus any extra workflows. Never fed to the runner.
  const hostedReuse = hostedReuseDecl
    ? { covers: hostedReuseDecl.covers, checks: [...checks, ...expandChecks(hostedReuseDecl.extraWorkflows)] }
    : null;

  return {
    ok: true,
    problems: [],
    approvalSet: {
      workflows,
      checks,
      excluded,
      excludedSteps,
      steps,
      equivalents,
      secretNames,
      outputPaths,
      statusContext: config.status_context.trim(),
      botReview,
      hostedReuse,
    },
  };
}

module.exports = { validateConfig };
