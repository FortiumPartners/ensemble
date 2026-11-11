'use strict';

/**
 * pr-review-load.js -- the host-load sampler of a review and the reader of its samples (kata nj2d, plan docs/plans/pr-review-speed-plan-v2.md
 * section 5 child V2-1: "a 30 s load sampler is restored").
 *
 * Why. A review's wall time is only readable against the load the machine was under: the measured runs shared one machine with the local-CI
 * gate (two Node versions, about 5.5 minutes) and the review agents, and the R2 samples saw a load average of 19.1 on 18 cores; R3 took none.
 * `pr-review-cli timing` reports the samples this file writes (`hostLoad`, and per agent the highest load while it ran).
 *
 *   node pr-review-load.js sample --run-id <runId> [--cwd <projectRoot>] [--interval-sec <1..3600>] [--max-samples <n>] [--max-minutes <n>]
 *
 * appends one JSON line per interval (default 30 s, the first at once) to `<projectRoot>/.ensemble/state/toolchain/load-<runId>.jsonl`, beside
 * the run's trace (`trace-<runId>.jsonl`, same run id rules), until it is stopped (SIGTERM or SIGINT, exit 0), has taken `--max-samples` or has
 * run `--max-minutes` (default 120, so a forgotten sampler ends). Start it BEFORE `prepare`, with the `runId` you pass to `prepare` (the
 * review's own, or its `traceRunId`), in the background; stop it when the review is over. A sample line is
 * `{"ts":"<ISO-8601>","load1":4.52,"load5":3.1,"load15":2.2,"cpus":18}`.
 *
 * OPTIONAL AND NEVER IN THE WAY. A review does not wait for it, start it or know about it: a review without samples reports its host load as
 * MISSING with the reason (`readLoadSamples`), never as 0. It writes only that one file, appends (a sampler started again adds to the file),
 * and never throws into whatever started it: a directory it cannot write to is a reason and an exit code.
 *
 * NEVER A MADE-UP FIGURE. `os.loadavg()` reports 0, 0, 0 on win32, which is no measurement, so there the sampler refuses (exit 3) before it
 * writes anything. A reading that is not three finite non-negative numbers is skipped, not written as 0, and a line that does not hold an
 * ISO-8601 time with a zone, three finite non-negative loads and a positive cpu count (or null) is skipped when read, with its line number.
 *
 * Exit codes: 0 stopped or finished, 1 the file could not be written, 2 a usage error, 3 the platform has no load average.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { stateDir } = require('./run-trace');
const { isValidRunId, invalidRunIdMessage } = require('./toolchain/run-id');

const DEFAULT_INTERVAL_MS = 30000;
const DEFAULT_MAX_MINUTES = 120;
const MAX_INTERVAL_SEC = 3600;
/** A samples file is read whole: 120 minutes at 30 s is a few hundred lines, so a file past this is not a samples file. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** ISO-8601 with a zone, what `Date#toISOString` writes: `Date.parse` alone also reads local-time and free-form text. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const USAGE = 'Usage: node pr-review-load.js sample --run-id <runId> [--cwd <projectRoot>] [--interval-sec <1..3600, default 30>] [--max-samples <n>] [--max-minutes <n, default 120>]';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isLoad = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const round2 = (value) => Math.round(value * 100) / 100;

/** `<projectRoot>/.ensemble/state/toolchain/load-<runId>.jsonl`, beside the run's trace; throws for a run id the trace would refuse. */
function loadPath(projectRoot, runId) {
  if (!isValidRunId(runId)) throw new Error(`load: ${invalidRunIdMessage(runId)}`);
  return path.join(stateDir(projectRoot), `load-${runId}.jsonl`);
}

/** One reading of the machine: the sample line, or null when the load average is not three finite non-negative numbers (never written as 0). */
function takeSample(deps) {
  const reading = deps.loadavg();
  if (!Array.isArray(reading) || reading.length < 3 || !reading.slice(0, 3).every(isLoad)) return null;
  const cpus = deps.cpus();
  return { ts: new Date(deps.now()).toISOString(), load1: round2(reading[0]), load5: round2(reading[1]), load15: round2(reading[2]), cpus: Number.isInteger(cpus) && cpus > 0 ? cpus : null };
}

/** Why a parsed line is no sample, or null. */
function sampleProblem(record) {
  if (!isObject(record)) return 'not a load sample';
  if (typeof record.ts !== 'string' || !ISO_8601.test(record.ts) || !Number.isFinite(Date.parse(record.ts))) return 'has no ISO-8601 time with a zone';
  for (const key of ['load1', 'load5', 'load15']) if (!isLoad(record[key])) return `${key} is not a non-negative number`;
  if (!Object.prototype.hasOwnProperty.call(record, 'cpus') || (record.cpus !== null && !(Number.isInteger(record.cpus) && record.cpus > 0))) return 'cpus is not a positive integer (or null)';
  return null;
}

/**
 * The samples of a file's text, in file order: `{ ts, tsMs, load1, load5, load15, cpus }`. A line that is no sample is skipped and named
 * (`line 3: ..., skipped`): it is never read as a load of 0.
 *
 * @returns {{samples: Object[], warnings: string[]}}
 */
function parseLoadSamples(text) {
  const samples = [];
  const warnings = [];
  String(text).split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    let record;
    try {
      record = JSON.parse(line);
    } catch (_error) {
      warnings.push(`line ${index + 1}: not valid JSON, skipped`);
      return;
    }
    const problem = sampleProblem(record);
    if (problem !== null) {
      warnings.push(`line ${index + 1}: ${problem}, skipped`);
      return;
    }
    samples.push({ ts: record.ts, tsMs: Date.parse(record.ts), load1: record.load1, load5: record.load5, load15: record.load15, cpus: record.cpus });
  });
  return { samples, warnings };
}

/**
 * The samples of a run, or the reason there are none: a file that is not there (the sampler was not run), cannot be read or holds no usable
 * sample is `{ ok: false, reason }`, never an empty set that reads as a quiet machine.
 *
 * @param {string} projectRoot
 * @param {string} runId  the trace's run id
 * @param {{statSync: Function, readFileSync: Function}} [io]
 * @returns {{ok: true, samples: Object[], warnings: string[], path: string}|{ok: false, reason: string}}
 */
function readLoadSamples(projectRoot, runId, io = fs) {
  let file;
  try {
    file = loadPath(projectRoot, runId);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  let text;
  try {
    if (io.statSync(file).size > MAX_FILE_BYTES) return { ok: false, reason: `the load samples file ${file} is larger than ${MAX_FILE_BYTES} bytes, so it is not a samples file` };
    text = io.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, reason: `no load samples file at ${file}: the sampler was not run for this review (node lib/pr-review-load.js sample --run-id ${runId})` };
    return { ok: false, reason: `the load samples file ${file} cannot be read: ${error && error.message ? error.message : String(error)}` };
  }
  const { samples, warnings } = parseLoadSamples(text);
  if (samples.length === 0) return { ok: false, reason: `the load samples file ${file} holds no usable sample${warnings.length > 0 ? ` (${warnings.length} line(s) skipped)` : ''}` };
  return { ok: true, samples, warnings, path: file };
}

function realDeps() {
  return {
    platform: process.platform,
    now: () => Date.now(),
    cpus: () => os.cpus().length,
    loadavg: () => os.loadavg(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    shouldStop: () => false,
    fs,
  };
}

/**
 * Takes a sample now and then every `intervalMs` until `shouldStop()`, `maxSamples` readings or `maxMs` since the start, appending each one to
 * the run's samples file. `maxSamples` counts readings taken: one that is no sample is skipped, so `samples` (the lines written) can be fewer.
 *
 * @param {{projectRoot: string, runId: string, intervalMs?: number, maxSamples?: number, maxMs?: number}} options
 * @param {object} [deps]  `{ platform, now, cpus, loadavg, sleep, shouldStop, fs }`; the real machine by default
 * @returns {Promise<{ok: true, file: string, samples: number}|{ok: false, reason: string, unsupported?: true, samples?: number}>}
 */
async function runSampler({ projectRoot, runId, intervalMs = DEFAULT_INTERVAL_MS, maxSamples = Infinity, maxMs = DEFAULT_MAX_MINUTES * 60000 }, deps = {}) {
  const d = { ...realDeps(), ...deps };
  if (d.platform === 'win32') return { ok: false, unsupported: true, reason: 'load averages are not available on win32 (the platform reports 0 for all three, which is no measurement), so no sample is written' };
  let file;
  try {
    file = loadPath(projectRoot, runId);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  const startedAt = d.now();
  let taken = 0;
  let written = 0;
  for (;;) {
    if (d.shouldStop()) break;
    const sample = takeSample(d);
    taken += 1;
    if (sample !== null) {
      try {
        d.fs.mkdirSync(path.dirname(file), { recursive: true });
        d.fs.appendFileSync(file, `${JSON.stringify(sample)}\n`);
      } catch (error) {
        return { ok: false, reason: `cannot write ${file}: ${error && error.message ? error.message : String(error)}`, samples: written };
      }
      written += 1;
    }
    if (taken >= maxSamples) break;
    if (d.now() - startedAt + intervalMs > maxMs) break;
    await d.sleep(intervalMs);
  }
  return { ok: true, file, samples: written };
}

const NUMBER = /^\d+(?:\.\d+)?$/;

/** `sample` and its options, or the usage error. */
function parseArgs(argv) {
  if (!Array.isArray(argv) || argv[0] !== 'sample') return { ok: false, error: argv && argv[0] ? `Unknown subcommand ${JSON.stringify(argv[0])}.` : 'No subcommand.' };
  const options = { cwd: process.cwd(), intervalMs: DEFAULT_INTERVAL_MS, maxSamples: Infinity, maxMs: DEFAULT_MAX_MINUTES * 60000 };
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--run-id', '--cwd', '--interval-sec', '--max-samples', '--max-minutes'].includes(flag)) return { ok: false, error: `Unexpected argument ${JSON.stringify(flag)}.` };
    if (value === undefined) return { ok: false, error: `${flag} needs a value.` };
    if (flag === '--run-id') options.runId = value;
    else if (flag === '--cwd') options.cwd = value;
    else if (!NUMBER.test(value)) return { ok: false, error: `${flag} must be a number (got ${JSON.stringify(value)}).` };
    else if (flag === '--interval-sec') {
      const seconds = Number(value);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_INTERVAL_SEC) return { ok: false, error: `--interval-sec must be a whole number of seconds from 1 to ${MAX_INTERVAL_SEC} (got ${value}).` };
      options.intervalMs = seconds * 1000;
    } else if (flag === '--max-samples') {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1) return { ok: false, error: `--max-samples must be a whole number of at least 1 (got ${value}).` };
      options.maxSamples = count;
    } else {
      const minutes = Number(value);
      if (!(minutes > 0)) return { ok: false, error: `--max-minutes must be greater than 0 (got ${value}).` };
      options.maxMs = minutes * 60000;
    }
  }
  if (!isValidRunId(options.runId)) return { ok: false, error: options.runId === undefined ? '--run-id is required.' : `${invalidRunIdMessage(options.runId)}.` };
  return { ok: true, options };
}

/**
 * Script entry: `node pr-review-load.js sample ...` (see the top of this file). SIGTERM and SIGINT stop it between samples, with exit 0.
 *
 * @param {string[]} argv process.argv.slice(2)
 * @param {{out?: (text: string) => void, deps?: object}} [io]
 * @returns {Promise<number>} exit code
 */
async function main(argv, io = {}) {
  const out = io.out || ((text) => process.stdout.write(text));
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    out(`${parsed.error}\n${USAGE}\n`);
    return 2;
  }
  const { cwd, runId, intervalMs, maxSamples, maxMs } = parsed.options;
  let stopped = false;
  let wake = null;
  const stop = () => {
    stopped = true;
    if (wake !== null) wake();
  };
  const signalAwareSleep = (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    const file = loadPath(cwd, runId);
    out(`load sampler: writing ${file} every ${intervalMs / 1000} s (${maxSamples === Infinity ? 'no sample limit' : `at most ${maxSamples} samples`}, at most ${maxMs / 60000} min; SIGTERM or SIGINT stops it)\n`);
    const answer = await runSampler({ projectRoot: cwd, runId, intervalMs, maxSamples, maxMs }, { sleep: signalAwareSleep, shouldStop: () => stopped, ...(io.deps || {}) });
    if (!answer.ok) {
      out(`load sampler: ${answer.reason}\n`);
      return answer.unsupported === true ? 3 : 1;
    }
    out(`load sampler: stopped after ${answer.samples} samples in ${answer.file}\n`);
    return 0;
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}

module.exports = { DEFAULT_INTERVAL_MS, loadPath, takeSample, parseLoadSamples, readLoadSamples, runSampler, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
