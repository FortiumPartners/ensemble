'use strict';

/**
 * Regression: the documented `policy` call must carry `sourceSha`.
 *
 * `pr-review-cli.js policy` ties REVIEW.md to the base commit only when the
 * caller also passes `sourceSha` (the commit the text was read from, equal to
 * `baseSha`). A call with `{ text, baseSha }` alone answers `ok:false`,
 * `policy-not-from-base` and the strict defaults (REQ-024), so a skill that
 * documents that shape reads the wrong eval directory or blocks a sweep.
 *
 * These tests execute the documented call shapes against the REAL CLI, in a
 * real git repository whose base commit holds a REVIEW.md block.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEV = path.join(__dirname, '..');
const CLI = path.join(DEV, 'lib', 'pr-review-cli.js');
const read = (rel) => fs.readFileSync(path.join(DEV, rel), 'utf8');

const REVIEW_MD = '# Review\n\n```ensemble-review-policy\n{ "evalCasesDir": "custom/eval-cases", "roundCap": 4 }\n```\n';

let repo;
let baseSha;

const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
const runCli = (sub, payload) => {
  const res = spawnSync('node', [CLI, sub], { input: JSON.stringify(payload), encoding: 'utf8' });
  return JSON.parse(res.stdout);
};

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-sourcesha-'));
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(repo, 'REVIEW.md'), REVIEW_MD);
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  baseSha = git('rev-parse', 'HEAD').stdout.trim();
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('the CLI contract the skills depend on', () => {
  test('control: text + baseSha with no sourceSha is rejected as not-from-base', () => {
    const out = runCli('policy', { text: REVIEW_MD, baseSha });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('policy-not-from-base');
    expect(out.policy.evalCasesDir).toBe('docs/review-eval/cases');
  });

  test('control: sourceSha equal to baseSha reads the block', () => {
    const out = runCli('policy', { text: REVIEW_MD, baseSha, sourceSha: baseSha });
    expect(out.ok).toBe(true);
    expect(out.policy.evalCasesDir).toBe('custom/eval-cases');
  });
});

describe('pr-review-eval Step A policy snippet', () => {
  test('the documented bash snippet, run for real, reads evalCasesDir from the base commit', () => {
    const text = read('skills/pr-review-eval/SKILL.md');
    const snippet = text.split('```bash').map((b) => b.split('```')[0]).find((b) => /PR_REVIEW_CLI" policy/.test(b));
    expect(snippet).toBeDefined();
    const res = spawnSync('bash', ['-c', snippet], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PR_REVIEW_CLI: CLI, BASE_SHA: baseSha },
    });
    const out = JSON.parse(res.stdout);
    expect([out.reason, out.ok]).toEqual([undefined, true]);
    expect(out.policy.evalCasesDir).toBe('custom/eval-cases');
  });
});

describe('pr-review-sweep Step 2 policy payload', () => {
  // The payload keys the prose documents for `policy`, built into a real call.
  const documentedKeys = (source) => {
    const match = source.replace(/\s+/g, ' ').match(/`policy` with `\{ ([^}]*) \}`/);
    expect(match).not.toBeNull();
    return match[1].split(',').map((k) => k.trim());
  };

  test('the reference payload names sourceSha, and the call it describes reads the block', () => {
    const keys = documentedKeys(read('skills/pr-review-sweep/reference/sweep-details.md'));
    expect(keys).toEqual(expect.arrayContaining(['text', 'baseSha', 'sourceSha']));
    const facts = { text: REVIEW_MD, baseSha, sourceSha: baseSha };
    const out = runCli('policy', Object.fromEntries(keys.map((k) => [k, facts[k]])));
    expect([out.reason, out.ok]).toEqual([undefined, true]);
  });

  test('SKILL.md Step 2 says baseSha and sourceSha are both SWEEP_SHA for policy too', () => {
    const flat = read('skills/pr-review-sweep/SKILL.md').replace(/\s+/g, ' ');
    const step2 = flat.slice(flat.indexOf('### Step 2'), flat.indexOf('### Step 3'));
    expect(step2).toMatch(/`policy` with `text` set to the content of `REVIEW.md` at `SWEEP_SHA`[^;]*`baseSha` and `sourceSha` both `SWEEP_SHA`/);
  });
});

describe('every documented policy call that reads REVIEW.md carries sourceSha', () => {
  test('pr-review-cycle reference keeps the correct shape', () => {
    const flat = read('skills/pr-review-cycle/reference/scope-guidance-depth.md').replace(/\s+/g, ' ');
    expect(flat).toContain('`policy` with `{ text, baseSha, sourceSha }`');
  });
});

describe('pr-review-sweep output contract is self-consistent', () => {
  const skill = read('skills/pr-review-sweep/SKILL.md');
  const flat = skill.replace(/\s+/g, ' ');
  const outputs = flat.slice(flat.indexOf('## Outputs'), flat.indexOf('A sweep never writes code'));

  test('a truncated run has a status of its own: the prose never calls it complete', () => {
    expect(outputs).toContain('**`SWEEP_PARTIAL`**');
    expect(outputs).toContain('`MAX_PATHS` truncation');
    // Every sentence that says a truncated run is not complete names the status it IS.
    expect(flat).toContain("truncation gives `SWEEP_PARTIAL`");
    expect(flat).not.toMatch(/never (reports itself as|reported as) complete/);
    // SWEEP_COMPLETE no longer claims to carry "what was left for a next run".
    const complete = outputs.slice(outputs.indexOf('**`SWEEP_COMPLETE`**'), outputs.indexOf('**`SWEEP_PARTIAL`**'));
    expect(complete).not.toContain('what was left');
    expect(complete).toContain('every path examined and every slice covered');
  });

  test('the reference and the guide use the same three statuses', () => {
    const reference = read('skills/pr-review-sweep/reference/sweep-details.md');
    const guide = fs.readFileSync(path.join(DEV, '..', '..', 'docs', 'guides', 'pr-review-sweep.md'), 'utf8');
    for (const text of [reference, guide]) expect(text).toContain('SWEEP_PARTIAL');
    expect(reference).not.toMatch(/never reported as complete/);
  });
});
