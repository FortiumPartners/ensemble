'use strict';

/** PR 5 behavior: coverage report and exemptions (TRD-017-TEST), on a fixture tree of skills. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const coverage = require('../lib/coverage');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(__dirname, '../coverage.js');
const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');

let root;
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  fs.mkdirSync(SCRATCH, { recursive: true });
  root = fs.mkdtempSync(path.join(SCRATCH, 'c-'));
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const sub = (...p) => path.join(root, ...p);
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const skill = (pkg, name) => write(sub('repo', 'packages', pkg, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
const evalFor = (name, def = {}) => {
  write(sub('evals', 'skills', name, 'eval.json'), JSON.stringify({ skill: name, prompt: 'Do the thing', checks: [{ type: 'fileExists', path: 'x' }], ...def }));
  write(sub('evals', 'skills', name, 'fixture', 'seed.txt'), 's\n');
};
const exemptions = (text) => write(sub('exemptions.json'), typeof text === 'string' ? text : JSON.stringify(text));
const run = () => coverage.computeCoverage({ repoRoot: sub('repo'), skillsDir: sub('evals', 'skills'), exemptionsFile: sub('exemptions.json') });
const row = (c, name) => c.rows.filter((r) => r.skill === name);

describe('TRD-017 coverage', () => {
  test('Scenario: every skill once, one status', () => {
    skill('core', 'alpha'); skill('core', 'beta'); skill('dev', 'gamma'); skill('dev', 'delta');
    // generated and aggregate packages are not source: their copies must not appear
    skill('full', 'alpha'); skill('pi', 'gamma'); skill('codex', 'zeta');
    evalFor('alpha');
    exemptions({ beta: 'loaded by a resolver, not invoked by name' });
    const c = run();
    expect(c.errors).toEqual([]);
    expect(c.rows.map((r) => r.skill)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(c.rows.map((r) => r.status)).toEqual(['evaluated', 'exempt', 'missing', 'missing']);
    expect(row(c, 'alpha')[0]).toMatchObject({ packages: ['core'], evalId: 'alpha', runtimes: ['claude'] });
    expect(c.counts).toEqual({ evaluated: 1, exempt: 1, missing: 2, total: 4 });
    for (const r of c.rows) expect(['evaluated', 'exempt', 'missing']).toContain(r.status);
  });

  test('Scenario: exemption needs a reason (empty, blank or absent reason is missing; a reason is shown)', () => {
    skill('core', 'a'); skill('core', 'b'); skill('core', 'c');
    exemptions({ a: '', b: '   ', c: 'because' });
    const c = run();
    expect(c.errors).toEqual([]);
    expect(row(c, 'a')[0]).toMatchObject({ status: 'missing', note: 'exempt but no reason is given' });
    expect(row(c, 'b')[0].status).toBe('missing');
    expect(row(c, 'c')[0]).toMatchObject({ status: 'exempt', reason: 'because' });
    expect(coverage.formatCoverage(c)).toMatch(/c \(core\): reason: because/);
  });

  test('Scenario: new skill missing (no eval, no exemption)', () => {
    skill('core', 'old'); evalFor('old');
    exemptions({});
    expect(run().rows.map((r) => r.status)).toEqual(['evaluated']);
    skill('core', 'fresh');
    const c = run();
    expect(row(c, 'fresh')[0]).toMatchObject({ status: 'missing', note: 'no eval and no exemption' });
    expect(coverage.formatCoverage(c)).toMatch(/MISSING \(uncovered\): 1\n {2}fresh/);
  });

  test('a rejected eval leaves its skill missing, with the rejection shown; legacy scenarios never count', () => {
    skill('core', 'alpha');
    evalFor('alpha', { prompt: '' });
    write(sub('evals', 'scenarios', 'alpha', 'scenario.json'), JSON.stringify({ id: 'alpha', skill: 'alpha', type: 'agent' }));
    const c = run();
    expect(row(c, 'alpha')[0].status).toBe('missing');
    expect(row(c, 'alpha')[0].note).toMatch(/its eval was rejected: eval "alpha": missing task/);
  });

  test('stale, duplicate and conflicting exemptions are errors', () => {
    skill('core', 'alpha'); skill('core', 'beta'); evalFor('beta');
    exemptions('{ "alpha": "one", "ghost": "stale", "beta": "has an eval" }');
    expect(run().errors).toEqual(expect.arrayContaining([
      expect.stringContaining('stale exemption "ghost": no such shipped skill'),
      expect.stringContaining('stale exemption "beta": the skill has an eval'),
    ]));
    exemptions('{ "alpha": "one",\n "alpha": "two" }');
    expect(run().errors).toEqual([expect.stringContaining('duplicate exemption for "alpha"')]);
    // a key repeated only inside a reason text, or nested, is not a duplicate
    exemptions('{ "alpha": "says \\"alpha\\": twice", "beta2": "x" }');
    expect(run().errors).toEqual([expect.stringContaining('stale exemption "beta2"')]);
  });

  test('unreadable exemptions file and bad skill directories fail closed', () => {
    skill('core', 'alpha');
    exemptions('{oops');
    expect(run).toThrow(/exemptions\.json: not valid JSON/);
    exemptions('[]');
    expect(run).toThrow(/must be a JSON object/);
    exemptions({});
    write(sub('repo/packages/core/skills/bad name/SKILL.md'), 'x');
    write(sub('repo/packages/core/skills/nomd/readme.txt'), 'x');
    fs.symlinkSync(sub('repo/packages/core/skills/alpha'), sub('repo/packages/core/skills/link'));
    skill('dev', 'alpha'); // same name in a second source package
    const errs = run().errors.join('\n');
    expect(errs).toMatch(/invalid skill name/);
    expect(errs).toMatch(/nomd has no SKILL\.md/);
    expect(errs).toMatch(/link is a symlink/);
    expect(errs).toMatch(/skill "alpha" is shipped by more than one source package \(core, dev\)/);
    expect(() => coverage.computeCoverage({ repoRoot: sub('nowhere') })).toThrow(/packages\/ directory not found/);
  });

  test('CLI: missing is reported without gating, --strict gates, errors exit 2', () => {
    skill('core', 'alpha');
    const cli = (...args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
    // the CLI reads the real repository: it reports and exits 0, --strict follows the real missing count
    const plain = cli();
    expect(plain.status).toBe(0);
    expect(plain.stdout).toMatch(/^EVALUATED: \d+\nEXEMPT: \d+/);
    expect(cli('--strict').status).toBe(plain.stdout.match(/(\d+) missing/)[1] === '0' ? 0 : 1);
    expect(cli('--bogus').status).toBe(2);
    expect(JSON.parse(cli('--json').stdout).counts.total).toBeGreaterThan(0);
    expect(require('../coverage').main(['--strict'], { repoRoot: sub('repo'), skillsDir: sub('evals', 'skills'), exemptionsFile: sub('exemptions.json') })).toBe(1);
    exemptions({ ghost: 'x' });
    expect(require('../coverage').main([], { repoRoot: sub('repo'), skillsDir: sub('evals', 'skills'), exemptionsFile: sub('exemptions.json') })).toBe(2);
  });
});

describe('TRD-017 committed exemptions.json', () => {
  const real = () => coverage.computeCoverage({ repoRoot: REPO_ROOT });

  test('lists every adapter-loaded skill with a reason, and the real report has no errors', () => {
    const c = real();
    expect(c.errors).toEqual([]); // no stale or duplicate entries
    const adapters = c.rows.filter((r) => r.skill.startsWith('adapter-'));
    expect(adapters.length).toBeGreaterThan(0);
    for (const r of adapters) {
      expect(r.status).toBe('exempt');
      expect(r.reason.length).toBeGreaterThan(10);
    }
    expect(c.rows.filter((r) => r.status === 'exempt').map((r) => r.skill)).toEqual(adapters.map((r) => r.skill));
  });

  test('the real report lists each shipped skill once', () => {
    const c = real();
    expect(new Set(c.rows.map((r) => r.skill)).size).toBe(c.rows.length);
    expect(c.counts.evaluated + c.counts.exempt + c.counts.missing).toBe(c.rows.length);
  });
});
