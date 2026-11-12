'use strict';

/**
 * `hosted_reuse` in .ensemble/local-ci.yaml (fwj0): the BASE-ref config's opt-in to accepting the jobs hosted CI already
 * ran on the PR's head instead of repeating the local steps. Absent -> never reuse. Present -> every local step must be
 * declared as run by hosted CI, so a step added without that declaration cannot be skipped by accident. And this
 * repository's own config must name exactly the jobs its real workflows produce.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { validateConfig } = require('../lib/local-ci-config');
const { verifyHosted, expectedJobName } = require('../lib/local-ci-hosted');
const { makeBaseRepo, cleanupBaseRepos } = require('./helpers/local-ci-base-repo');
const { REPO, hostedRun, withoutJob, actionsApi, memoGit } = require('./helpers/local-ci-hosted');

afterAll(cleanupBaseRepos);

const base = (hosted) => ({
  workflows: [{ file: 'a.yml', jobs: [{ id: 'build' }, { id: 'test', matrix: { node: [22, 24] } }] }],
  steps: [
    { name: 'install', cmd: 'npm ci' },
    { name: 'test', cmd: 'npm test' },
  ],
  status_context: 'x/local-ci',
  ...(hosted === undefined ? {} : { hosted_reuse: hosted }),
});
const COVERS = ['install', 'test'];
const validate = (hosted, over) => validateConfig({ ...base(hosted), ...over });
const withoutHosted = (set) => {
  const copy = { ...set };
  delete copy.hostedReuse;
  return copy;
};

describe('hosted_reuse: the opt-in', () => {
  it('absent: reuse is off, recorded as null (never undefined, never an empty set)', () => {
    const r = validateConfig(base());
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.approvalSet.hostedReuse).toBeNull();
    expect(Object.keys(r.approvalSet)).toContain('hostedReuse');
  });

  it('written as null it is off too, so the key can only ever switch reuse OFF', () => {
    const r = validate(null);
    expect(r.ok).toBe(true);
    expect(r.approvalSet.hostedReuse).toBeNull();
  });

  it('valid: the declared covers and the approval set\'s own checks', () => {
    const r = validate({ covers: COVERS });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.approvalSet.hostedReuse).toEqual({
      covers: ['install', 'test'],
      checks: [
        { workflow: 'a.yml', job: 'build', matrix: {} },
        { workflow: 'a.yml', job: 'test', matrix: { node: 22 } },
        { workflow: 'a.yml', job: 'test', matrix: { node: 24 } },
      ],
    });
    expect(r.approvalSet.hostedReuse.checks).toEqual(r.approvalSet.checks);
  });

  it('extra_workflows add their checks AFTER the approval set\'s, expanded per matrix combination', () => {
    const r = validate({
      covers: COVERS,
      extra_workflows: [
        { file: 'drift.yml', jobs: [{ id: 'drift' }] },
        { file: 'b.yml', jobs: [{ id: 'unit', matrix: { os: ['linux', 'mac'], node: [22] } }] },
      ],
    });
    expect(r.problems).toEqual([]);
    expect(r.approvalSet.hostedReuse.checks.map((c) => [c.workflow, c.job, c.matrix])).toEqual([
      ['a.yml', 'build', {}],
      ['a.yml', 'test', { node: 22 }],
      ['a.yml', 'test', { node: 24 }],
      ['drift.yml', 'drift', {}],
      ['b.yml', 'unit', { os: 'linux', node: 22 }],
      ['b.yml', 'unit', { os: 'mac', node: 22 }],
    ]);
  });

  it('the extra workflows never reach the approval set the runner and the status record use', () => {
    const plain = validateConfig(base()).approvalSet;
    const withExtras = validate({ covers: COVERS, extra_workflows: [{ file: 'drift.yml', jobs: [{ id: 'drift' }, { id: 'unit', matrix: { node: [18] } }] }] }).approvalSet;
    // workflows (the record's workflow set) and checks (the Node versions the runner runs) are exactly what they were
    expect(withExtras.workflows).toEqual(plain.workflows);
    expect(withExtras.checks).toEqual(plain.checks);
    expect(withoutHosted(withExtras)).toEqual(withoutHosted(plain));
  });

  it('covers may be listed in any order and are kept as declared', () => {
    const r = validate({ covers: ['test', 'install'] });
    expect(r.problems).toEqual([]);
    expect(r.approvalSet.hostedReuse.covers).toEqual(['test', 'install']);
  });
});

describe('hosted_reuse: a malformed declaration is a problem that names its cause, and the config is then refused', () => {
  const problems = (hosted, over) => {
    const r = validate(hosted, over);
    expect(r.ok).toBe(false);
    expect(r.approvalSet).toBeUndefined();
    return r.problems.join('\n');
  };

  it('a step missing from covers is named, with how to fix it', () => {
    expect(problems({ covers: ['install'] })).toContain('hosted_reuse.covers: step "test" is not declared as run by hosted CI; list it or remove hosted_reuse');
  });

  it('every uncovered step is named, not just the first', () => {
    const text = problems({ covers: ['lint'] }, { steps: [{ name: 'lint', cmd: 'npm run lint' }, { name: 'a', cmd: 'a' }, { name: 'b', cmd: 'b' }] });
    expect(text).toContain('step "a" is not declared as run by hosted CI');
    expect(text).toContain('step "b" is not declared as run by hosted CI');
    expect(text).not.toContain('step "lint" is not declared');
  });

  it('covers naming a step that does not exist', () => {
    expect(problems({ covers: ['install', 'test', 'lint'] })).toContain('hosted_reuse.covers[2]: "lint" is not a step in steps');
  });

  it('covers naming a step twice', () => {
    expect(problems({ covers: ['install', 'install', 'test'] })).toContain('hosted_reuse.covers[1]: duplicate step "install"');
  });

  it.each([
    ['a number', 42],
    ['empty text', ''],
    ['blank text', '   '],
    ['null', null],
    ['a mapping', {}],
    ['a list', ['install']],
  ])('a covers entry that is %s is not step-name text', (_n, entry) => {
    expect(problems({ covers: [entry, 'install', 'test'] })).toContain('hosted_reuse.covers[0]: must be non-empty text');
  });

  it.each([
    ['text', 'install'],
    ['a mapping', { install: true }],
    ['a number', 5],
    ['true', true],
    ['an empty list', []],
  ])('covers that is %s is not a non-empty list of step names', (_n, covers) => {
    expect(problems({ covers })).toContain('hosted_reuse.covers: must be a non-empty list of step names');
  });

  it('covers is required', () => {
    expect(problems({})).toContain('hosted_reuse: missing required key "covers"');
    expect(problems({ extra_workflows: [{ file: 'd.yml', jobs: [{ id: 'd' }] }] })).toContain('hosted_reuse: missing required key "covers"');
  });

  it('an unknown key is named, a typo of covers is both unknown and missing', () => {
    expect(problems({ covers: COVERS, skip: true })).toContain('hosted_reuse: unknown key "skip"');
    const typo = problems({ cover: COVERS });
    expect(typo).toContain('hosted_reuse: unknown key "cover"');
    expect(typo).toContain('hosted_reuse: missing required key "covers"');
  });

  it.each([
    ['text', 'yes'],
    ['a list', ['install']],
    ['a number', 1],
    ['true', true],
    ['false', false],
  ])('hosted_reuse that is %s is not a mapping', (_n, value) => {
    expect(problems(value)).toContain('hosted_reuse: must be a mapping');
  });

  it('all problems are reported together', () => {
    const text = problems({ covers: ['install', 'install', 'lint'], skip: 1 });
    expect(text).toContain('hosted_reuse: unknown key "skip"');
    expect(text).toContain('hosted_reuse.covers[1]: duplicate step "install"');
    expect(text).toContain('hosted_reuse.covers[2]: "lint" is not a step in steps');
    expect(text).toContain('hosted_reuse.covers: step "test" is not declared as run by hosted CI');
  });
});

describe('extra_workflows are validated exactly like workflows', () => {
  const MALFORMED = [
    ['not a list', 'ci.yml'],
    ['an empty list', []],
    ['an entry that is not a mapping', ['ci.yml']],
    ['an entry without a file', [{ jobs: [{ id: 'x' }] }]],
    ['an entry without jobs', [{ file: 'x.yml' }]],
    ['an entry with an empty jobs list', [{ file: 'x.yml', jobs: [] }]],
    ['an unknown key in an entry', [{ file: 'x.yml', jobs: [{ id: 'x' }], when: 'always' }]],
    ['a job without an id', [{ file: 'x.yml', jobs: [{ matrix: { n: [1] } }] }]],
    ['an unknown key in a job', [{ file: 'x.yml', jobs: [{ id: 'x', bogus: 1 }] }]],
    ['an empty matrix list', [{ file: 'x.yml', jobs: [{ id: 'x', matrix: { n: [] } }] }]],
    ['a matrix value that is not a list', [{ file: 'x.yml', jobs: [{ id: 'x', matrix: { n: 22 } }] }]],
    ['a non-scalar matrix value', [{ file: 'x.yml', jobs: [{ id: 'x', matrix: { n: [{}] } }] }]],
    ['the same file twice', [{ file: 'x.yml', jobs: [{ id: 'x' }] }, { file: 'x.yml', jobs: [{ id: 'y' }] }]],
    ['the same job with the same matrix twice', [{ file: 'x.yml', jobs: [{ id: 'x' }, { id: 'x' }] }]],
  ];

  it.each(MALFORMED)('%s is refused for extra_workflows exactly as it is for workflows', (_n, list) => {
    const asExtra = validate({ covers: COVERS, extra_workflows: list });
    expect(asExtra.ok).toBe(false);
    expect(asExtra.approvalSet).toBeUndefined();
    expect(validateConfig({ ...base(), workflows: list }).ok).toBe(false);
  });

  it('control: a well-formed list is accepted', () => {
    const list = [{ file: 'x.yml', jobs: [{ id: 'x' }, { id: 'x', matrix: { n: [1] } }] }, { file: 'y.yml', jobs: [{ id: 'x' }] }];
    expect(validate({ covers: COVERS, extra_workflows: list }).problems).toEqual([]);
    expect(validateConfig({ ...base(), workflows: list }).problems).toEqual([]);
  });
});

describe("this repository's own .ensemble/local-ci.yaml", () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const VALIDATE = '.github/workflows/validate.yml';
  const TEST = '.github/workflows/test.yml';
  const DRIFT = '.github/workflows/generated-drift.yml';
  const HOSTED_NAMES = ['validate', 'test (22)', 'test (24)', 'drift'];
  const configText = read('.ensemble/local-ci.yaml');
  const real = validateConfig(configText);
  // read lazily / from the YAML itself: a config that stopped validating must fail its own test, not crash collection
  const reuse = () => real.approvalSet.hostedReuse;
  const stepNames = yaml.load(configText).steps.map((s) => s.name);

  it('validates, and opts in to hosted reuse', () => {
    expect(real.problems).toEqual([]);
    expect(real.ok).toBe(true);
    expect(reuse()).not.toBeNull();
  });

  it('declares EVERY local step as run by hosted CI', () => {
    expect([...reuse().covers].sort()).toEqual([...stepNames].sort());
  });

  it('its hosted checks are validate, test on Node 22 and 24, and the extra drift workflow\'s job', () => {
    expect(reuse().checks.map((c) => [c.workflow, c.job, c.matrix['node-version']])).toEqual([
      [VALIDATE, 'validate', undefined],
      [TEST, 'test', 22],
      [TEST, 'test', 24],
      [DRIFT, 'drift', undefined],
    ]);
    // the approval set (what the status record and the runner use) does not include the extra workflow
    expect(real.approvalSet.workflows.map((w) => w.file)).toEqual([VALIDATE, TEST]);
  });

  it('the job names derived from the REAL workflow files are exactly validate, test (22), test (24), drift', () => {
    const derived = reuse().checks.map((c) => {
      const jobs = yaml.load(read(c.workflow)).jobs;
      expect(Object.keys(jobs)).toContain(c.job);
      return expectedJobName(jobs[c.job], c.job, c.matrix);
    });
    expect(derived).toEqual(HOSTED_NAMES);
  });

  it('each real workflow runs on pull_request, which hosted reuse requires', () => {
    for (const file of [VALIDATE, TEST, DRIFT]) {
      expect(Object.keys(yaml.load(read(file)).on)).toContain('pull_request');
    }
  });

  describe('through verifyHosted, against the real workflow files', () => {
    const files = Object.fromEntries([VALIDATE, TEST, DRIFT].map((rel) => [rel, read(rel)]));
    const fx = makeBaseRepo({ config: configText, files });
    const git = memoGit();
    const entries = () => [
      hostedRun(101, VALIDATE, ['validate'], fx.headSha, { workflow: files[VALIDATE] }),
      hostedRun(102, TEST, ['test (22)', 'test (24)'], fx.headSha, { workflow: files[TEST] }),
      hostedRun(103, DRIFT, ['drift'], fx.headSha, { workflow: files[DRIFT] }),
    ];
    const verify = (list) => verifyHosted({ repo: REPO, headSha: fx.headSha, baseSha: fx.baseSha, repoRoot: fx.dir, approvalSet: real.approvalSet, pr: require('./helpers/local-ci-base-repo').PR, baseRefName: require('./helpers/local-ci-base-repo').BASE_BRANCH }, { git, ghApi: actionsApi(list) });

    it('hosted CI green under exactly those four names is accepted', () => {
      const r = verify(entries());
      expect(r.ok).toBe(true);
      expect(r.jobs.map((j) => j.name)).toEqual(HOSTED_NAMES);
    });

    it.each(HOSTED_NAMES)('and each of them is required: without %s the answer is refused', (name) => {
      const r = verify(entries().map((e) => withoutJob(e, name)));
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(`required job "${name}" is missing`);
    });
  });

  it.each(stepNames)('dropping %s from covers makes the config invalid, naming that step', (name) => {
    const doc = yaml.load(configText);
    doc.hosted_reuse.covers = doc.hosted_reuse.covers.filter((c) => c !== name);
    const r = validateConfig(doc);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain(`hosted_reuse.covers: step "${name}" is not declared as run by hosted CI; list it or remove hosted_reuse`);
  });

  it('without its hosted_reuse block the config is otherwise identical, and reuse is off', () => {
    const doc = yaml.load(configText);
    delete doc.hosted_reuse;
    const r = validateConfig(doc);
    expect(r.problems).toEqual([]);
    expect(r.approvalSet.hostedReuse).toBeNull();
    expect(r.approvalSet).toEqual({ ...real.approvalSet, hostedReuse: null });
  });
});
