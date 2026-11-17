'use strict';

/**
 * Harness extension for long, multi-step commands: eval `env`, `setup`, `push.autoSetupRemote` for remote evals, and the
 * `maxTimeoutSec` / `maxRunUsd` ceilings. Runs evals/run.js against a stub `claude` under ~/.omp/trd-skills-eval/jest
 * (never /tmp); no real model, no network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const { spawnSync } = childProcess;
const { createSuite, SKILL, PKG_DIR, QUALIFIED } = require('./stub-suite');
const { loadEvalDefs, validateEvalDef, EvalDefinitionError } = require('../lib/eval-def');
const envlib = require('../lib/env');
const setupLib = require('../lib/setup');
const sandbox = require('../lib/sandbox');
const cache = require('../lib/cache');
const exec = require('../lib/exec');
const hash = require('../lib/hash');
const { loadScenarios } = require('../run');

const ARGS = '--repeats 1 --concurrency 1 --model claude-stub-1';
const CMD = `node evals/run.js --skill ${SKILL}`;

let t;
beforeEach(() => { t = createSuite(); });
afterEach(() => t.cleanup());

const q = (l) => `echo '${l.replace(/'/g, "'\\''")}'`;
const initLine = (skills, plugins) => JSON.stringify({ type: 'system', subtype: 'init', skills, plugins, model: 'claude-stub-1' });
const invokeLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: QUALIFIED } }] } });
const resultLine = (text) => JSON.stringify({ type: 'result', num_turns: 1, total_cost_usd: 0.01, result: text });

/**
 * Stub claude: logs one `kind arm argv` line and one `NI=<value of ENSEMBLE_NON_INTERACTIVE>` line per call to calls.log; the agent records
 * the sandbox's push.autoSetupRemote in cfg.txt, sleeps when `sleep` exists next to it, writes SUMMARY.md, and says "done 111".
 */
function writeStub() {
  fs.mkdirSync(t.sub('bin'), { recursive: true });
  t.write(t.sub('bin/claude'), `#!/bin/sh
kind=agent; case "$*" in *stream-json*) ;; *) kind=judge;; esac
arm=baseline; case "$*" in *--plugin-dir*) arm=with-skill;; esac
argv=$(echo "$*" | tr '\\n' ' '); echo "$kind $arm argv=$argv" >> '${t.sub('calls.log')}'
echo "NI=$(printenv ENSEMBLE_NON_INTERACTIVE || echo absent)" >> '${t.sub('calls.log')}'
if [ "$kind" = judge ]; then echo '{"result":"{\\"score\\":0.8,\\"reason\\":\\"ok\\"}","total_cost_usd":0.01}'; exit 0; fi
git config --get push.autoSetupRemote > '${t.sub('cfg.txt')}' 2>/dev/null || echo unset > '${t.sub('cfg.txt')}'
[ -f '${t.sub('sleep')}' ] && sleep 30
[ -f '${t.sub('noresult')}' ] && { echo '{"type":"system","subtype":"init","skills":["verify"],"plugins":[],"model":"claude-stub-1"}'; exit 0; }
case "$arm" in with-skill) echo ok > SUMMARY.md
${q(initLine([QUALIFIED], [{ name: 'ensemble-product', path: PKG_DIR }]))}
${q(invokeLine)}
${q(resultLine('done 111'))};;
*) ${q(initLine(['verify'], []))}
${q(resultLine('done 111'))};;
esac
`);
  fs.chmodSync(t.sub('bin/claude'), 0o755);
}

/** Write eval.json (+ a fixture) with `extra` fields and run it; `args` replaces the default flags. */
function go(extra = {}, { args = ARGS, checks, env } = {}) {
  writeStub();
  fs.mkdirSync(t.sub('scenarios'), { recursive: true });
  t.write(t.sub('skills', SKILL, 'fixture', 'seed.txt'), 'seed\n');
  t.write(t.evalJsonPath, JSON.stringify({
    skill: SKILL, prompt: 'Write a summary of the repo', checks: checks || [{ type: 'fileExists', path: 'SUMMARY.md' }], ...extra,
  }));
  return t.exec(`${CMD} ${args}`, env);
}

const callsText = () => (fs.existsSync(t.sub('calls.log')) ? fs.readFileSync(t.sub('calls.log'), 'utf8') : '');
const agentRuns = (doc) => doc.results[0].runs || [];

// A repo with one shipped skill, for load-time tests that never run anything.
let tmp; let repo; let skillsDir;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-ext-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/demo/skills/demo-skill'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/demo/skills/demo-skill/SKILL.md'), '---\nname: demo-skill\n---\n');
  skillsDir = path.join(tmp, 'skills');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
const valid = () => ({ skill: 'demo-skill', prompt: 'Write a summary', checks: [{ type: 'fileExists', path: 'SUMMARY.md' }] });
function loadWith(extra, limits) {
  const dir = path.join(skillsDir, 'demo-skill');
  fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'eval.json'), JSON.stringify({ ...valid(), ...extra }));
  return loadEvalDefs({ skillsDir, repoRoot: repo, ...(limits && { limits }) });
}
const rejectedPart = (extra, limits) => { const r = loadWith(extra, limits).rejected[0]; return r && { part: r.error.part, message: r.error.message }; };

describe('eval env: validation', () => {
  test('a valid map is loaded and carried onto the scenario', () => {
    const { evals } = loadWith({ env: { ENSEMBLE_NON_INTERACTIVE: '1', MY_MODE_2: 'a b' } });
    expect(evals[0].env).toEqual({ ENSEMBLE_NON_INTERACTIVE: '1', MY_MODE_2: 'a b' });
    expect(require('../lib/eval-def').evalToScenario(evals[0]).env).toEqual(evals[0].env);
  });

  test.each([
    ['PATH'], ['HOME'], ['LD_PRELOAD'], ['LD_LIBRARY_PATH'], ['DYLD_INSERT_LIBRARIES'], ['NODE_OPTIONS'],
    ['MY_API_KEY'], ['GH_TOKEN'], ['APP_SECRET'], ['DB_PASSWORD'], ['ANTHROPIC_API_KEY'], ['ANTHROPIC_BASE_URL'], ['GIT_SSH_COMMAND'], ['HTTPS_PROXY'], ['TMPDIR'],
    ['OPENAI_BASE_URL'], ['OPENAI_ORG'], ['GEMINI_MODEL'], ['OPENROUTER_REGION'], ['AWS_ENDPOINT_URL'], ['AWS_REGION'], ['GOOGLE_VERTEX'], ['AZURE_OPENAI_NAME'],
    ['MY_BASE_URL'], ['SERVICE_ENDPOINT'], ['LLM_API_BASE'], ['LLM_API_URL'], ['SOME_URL'], ['DB_HOST'], ['ENDPOINT_OVERRIDE'],
  ])('the name %s is rejected at load, naming env', (name) => {
    expect(rejectedPart({ env: { [name]: 'x' } })).toMatchObject({ part: 'env' });
    expect(rejectedPart({ env: { [name]: 'x' } }).message).toMatch(new RegExp(name));
  });

  test('a name on the credential allowlist (any runtime) is rejected', () => {
    const file = t.sub('allow.json');
    fs.writeFileSync(file, JSON.stringify({ credentials: ['ODD_NAME'], runtimes: { pi: ['PIONLY'] } }));
    const names = envlib.allKnownCredentialNames(file);
    expect([...names]).toEqual(expect.arrayContaining(['ANTHROPIC_API_KEY', 'ODD_NAME', 'PIONLY']));
    expect(() => envlib.validateAgentEnv({ ODD_NAME: '1' }, names)).toThrow(/credential allowlist/);
    expect(() => envlib.validateAgentEnv({ PIONLY: '1' }, names)).toThrow(/credential allowlist/);
  });

  test.each([
    ['lowercase name', { env: { lower: '1' } }],
    ['name starting with a digit', { env: { '1A': '1' } }],
    ['name with a dash', { env: { 'A-B': '1' } }],
    ['non-string value', { env: { FLAG: 1 } }],
    ['value over 200 characters', { env: { FLAG: 'x'.repeat(201) } }],
    ['newline in a value', { env: { FLAG: 'a\nb' } }],
    ['escape in a value', { env: { FLAG: 'a\u001b[31m' } }],
    ['C1 control in a value', { env: { FLAG: 'a\u009bb' } }],
    ['array', { env: ['A=1'] }],
    ['empty object', { env: {} }],
    ['null', { env: null }],
  ])('%s is rejected', (_name, extra) => {
    expect(rejectedPart(extra)).toMatchObject({ part: 'env' });
  });

  test('a 200 character value is accepted', () => {
    expect(loadWith({ env: { FLAG: 'x'.repeat(200) } }).evals).toHaveLength(1);
  });

  test('applyAgentEnv never overwrites a credential or a base variable', () => {
    expect(() => envlib.applyAgentEnv({ A: '1' }, { A: '2' }, [])).toThrow(/refusing to override/);
    expect(() => envlib.applyAgentEnv({}, { MYCRED: '2' }, ['MYCRED'])).toThrow(/refusing to override/);
    expect(envlib.applyAgentEnv({ PATH: '/x' }, { FLAG: '1' }, [])).toEqual({ PATH: '/x', FLAG: '1' });
  });
});

describe('eval env: reaches the agent only', () => {
  const checks = [
    { type: 'fileExists', path: 'SUMMARY.md' },
    // The check env must not carry the variable: this runs through `sh -c` with the checks' environment.
    { type: 'commandOutputMatches', command: 'printenv ENSEMBLE_NON_INTERACTIVE || echo absent', pattern: '^absent' },
    { type: 'judge', rubric: 'Is the summary clear?' },
  ];

  test('both arms of the agent get it; the check env and the judge do not', () => {
    const r = go({ env: { ENSEMBLE_NON_INTERACTIVE: '1' } }, { args: `${ARGS} --judge-model opus`, checks });
    expect(r.status).toBe(0);
    const lines = callsText().split('\n').filter(Boolean);
    const pairs = [];
    for (let i = 0; i < lines.length; i += 2) pairs.push([lines[i].split(' ').slice(0, 2).join(' '), lines[i + 1]]);
    expect(pairs).toEqual(expect.arrayContaining([['agent with-skill', 'NI=1'], ['agent baseline', 'NI=1'], ['judge baseline', 'NI=absent']]));
    expect(pairs.filter(([k]) => k.startsWith('judge')).every(([, v]) => v === 'NI=absent')).toBe(true);
    expect(pairs.filter(([k]) => k.startsWith('agent')).every(([, v]) => v === 'NI=1')).toBe(true);
    // The check printed `absent`, so the commandOutputMatches check passed (the eval passed).
    expect(r.doc().results[0]).toMatchObject({ pass: true });
  });

  test('without env nothing is added', () => {
    go({}, { args: ARGS });
    expect(callsText()).toMatch(/NI=absent/);
    expect(callsText()).not.toMatch(/NI=1/);
  });

  test('a value like "1" is not a secret: it is not redacted from the transcript, even with a credential set', () => {
    const r = go({ env: { ENSEMBLE_NON_INTERACTIVE: '1' } }, { env: { ANTHROPIC_API_KEY: 'sk-ant-extsecret0123456789' } });
    expect(r.status).toBe(0);
    const text = fs.readFileSync(r.log, 'utf8');
    expect(text).toContain('done 111'); // every "1" survived
    expect(text).not.toContain('[REDACTED]1');
    expect(text).not.toMatch(/\[REDACTED\]\s*11/);
    // Unit: the secrets list is built from credentials only.
    const secrets = envlib.secretValues({ ENSEMBLE_NON_INTERACTIVE: '1', ANTHROPIC_API_KEY: 'sk-ant-x' }, ['ANTHROPIC_API_KEY']);
    expect(secrets).toEqual(['sk-ant-x']);
    expect(envlib.redactText('done 111', secrets)).toBe('done 111');
  });

  test('--allow-env naming a variable the eval sets rejects the eval', () => {
    const r = go({ env: { MY_FLAG: '1' } }, { args: `${ARGS} --allow-env MY_FLAG` });
    expect(r.stderr).toMatch(/REJECTED eval ".*": `env` name MY_FLAG is a credential of this run/);
    expect(callsText()).toBe('');
  });
});

describe('eval setup: validation', () => {
  const bad = (setup) => rejectedPart({ setup });
  test('a valid list is carried onto the scenario', () => {
    const setup = [['br', 'init'], ['git', 'add', '-A'], ['git', 'commit', '-m', 'fixture']];
    const { evals } = loadWith({ setup });
    expect(evals[0].setup).toEqual(setup);
    expect(require('../lib/eval-def').evalToScenario(evals[0]).setup).toEqual(setup);
  });

  test.each([
    ['a string', 'br init'],
    ['an empty list', []],
    ['a command as a string', ['br init']],
    ['an empty argv', [[]]],
    ['a non-string element', [['br', 1]]],
    ['an absolute binary', [['/bin/ls']]],
    ['a relative path binary', [['./run.sh']]],
    ['a path separator in the binary', [['bin/tool']]],
    ['a backslash in the binary', [['bin\\tool']]],
    ['a shell', [['sh', '-c', 'touch x']]],
    ['bash', [['bash', '-c', 'touch x']]],
    ['env', [['env', 'FOO=1', 'ls']]],
    ['a network binary', [['curl', 'http://example.invalid']]],
    ['git fetch', [['git', 'fetch']]],
    ['git clone', [['git', 'clone', 'x']]],
    ['git push', [['git', 'push']]],
    ['git remote', [['git', 'remote', 'add', 'o', 'x']]],
    ['git with a leading option', [['git', '-c', 'core.hooksPath=/x', 'status']]],
    ['bare git', [['git']]],
    ['too many commands', Array.from({ length: 21 }, () => ['true'])],
    ['a NUL byte', [['echo', 'a\0b']]],
  ])('%s is rejected at load, naming setup', (_n, setup) => {
    expect(bad(setup)).toMatchObject({ part: 'setup' });
  });
});

describe('eval setup: ALLOWLIST (attacks are rejected at load)', () => {
  const bad = (setup) => rejectedPart({ setup });
  test.each([
    ['node -e fetch', [['node', '-e', 'fetch("http://example.invalid")']]],
    ['node -e reading an absolute home path', [['node', '-e', 'require("fs").readFileSync("/Users/x/.ssh/id_rsa")']]],
    ['python3 -c', [['python3', '-c', 'import os']]],
    ['perl', [['perl', '-e', 'system("id")']]],
    ['ruby', [['ruby', '-e', 'puts 1']]],
    ['npm exec', [['npm', 'exec', 'evil']]],
    ['npm run', [['npm', 'run', 'build']]],
    ['make', [['make']]],
    ['awk system()', [['awk', 'BEGIN{system("id")}']]],
    ['tar', [['tar', 'xf', 'a.tar']]],
    ['ln', [['ln', '-s', '/etc/passwd', 'pw']]],
    ['git -c core.hooksPath', [['git', '-c', 'core.hooksPath=/x', 'status']]],
    ['git config core.hooksPath', [['git', 'config', 'core.hooksPath', '/x']]],
    ['git config alias.x', [['git', 'config', 'alias.x', '!sh']]],
    ['git config include.path', [['git', 'config', 'include.path', 'x']]],
    ['git config credential.helper', [['git', 'config', 'credential.helper', 'x']]],
    ['git config url.x.insteadOf', [['git', 'config', 'url.x.insteadOf', 'y']]],
    ['git config --global', [['git', 'config', '--global', 'user.name', 'x']]],
    ['git config --unset', [['git', 'config', '--unset', 'user.name']]],
    ['git config reading', [['git', 'config', 'user.name']]],
    ['git config commit.gpgsign not a boolean', [['git', 'config', 'commit.gpgsign', 'maybe']]],
    ['git -C', [['git', '-C', '..', 'status']]],
    ['git --git-dir', [['git', 'status', '--git-dir=/x']]],
    ['git --work-tree', [['git', 'status', '--work-tree', '/x']]],
    ['git --exec-path', [['git', '--exec-path=/x', 'status']]],
    ['git --git-dir with a relative value', [['git', 'status', '--git-dir=other']]],
    ['git --work-tree with a relative value', [['git', 'status', '--work-tree', 'sub']]],
    ['git --exec-path with a relative value', [['git', 'status', '--exec-path=bin']]],
    ['git rebase', [['git', 'rebase', '-i', 'HEAD~1']]],
    ['git filter-branch', [['git', 'filter-branch']]],
    ['git add an absolute path', [['git', 'add', '/etc/passwd']]],
    ['git add a parent path', [['git', 'add', '../x']]],
    ['git add under .git', [['git', 'add', '.git/config']]],
    ['git commit -F an absolute file', [['git', 'commit', '-F', '/etc/passwd']]],
    ['git commit --template=an absolute file', [['git', 'commit', '--template=/etc/passwd']]],
    ['br --db elsewhere', [['br', '--db', '/x/y.db', 'list']]],
    ['br leading option', [['br', '--db=/x', 'list']]],
    ['br list --db=', [['br', 'list', '--db=/x']]],
    ['br create --description-file', [['br', 'create', '--title', 't', '--description-file', 'x']]],
    ['br create -f', [['br', 'create', '-f', 'x']]],
    ['br upgrade (network)', [['br', 'upgrade']]],
    ['br config', [['br', 'config', 'set', 'a', 'b']]],
    ['br doctor', [['br', 'doctor', '--repair']]],
    ['br with an absolute path value', [['br', 'create', '--title', '/etc/passwd']]],
    ['br with a parent path value', [['br', 'update', 'x', '--notes', '../../x']]],
    ['cp to an absolute path', [['cp', 'x', '/abs/path']]],
    ['cp from an absolute path', [['cp', '/etc/passwd', 'x']]],
    ['cp to ~', [['cp', 'x', '~/y']]],
    ['cp with -L', [['cp', '-L', 'x', 'y']]],
    ['cp with one operand', [['cp', 'x']]],
    ['mkdir ../x', [['mkdir', '../x']]],
    ['mkdir a/../../x', [['mkdir', 'a/../../x']]],
    ['mkdir -m', [['mkdir', '-m', '777', 'x']]],
    ['mv out of the tree', [['mv', 'x', '../x']]],
    ['mv the project dir', [['mv', '.', 'x']]],
    ['touch under .git/hooks', [['touch', '.git/hooks/pre-commit']]],
    ['touch under a nested .git', [['touch', 'sub/.git/hooks/x']]],
    ['mkdir .claude', [['mkdir', '.claude']]],
    ['mkdir -p sub/.claude', [['mkdir', '-p', 'sub/.claude']]],
    ['touch .mcp.json', [['touch', '.mcp.json']]],
    ['touch .gitmodules', [['touch', '.gitmodules']]],
    ['touch under .beads/hooks', [['touch', '.beads/hooks/pre-commit']]],
    ['normalisation hiding .git', [['touch', 'a/./.git/hooks/x']]],
    ['chmod with a symbolic setuid mode', [['chmod', 'u+s', 'x']]],
    ['chmod with a 4-digit mode', [['chmod', '4755', 'x']]],
    ['chmod -R', [['chmod', '-R', '+x', 'x']]],
    ['chmod to an absolute path', [['chmod', '+x', '/bin/sh']]],
    ['rm -rf .', [['rm', '-rf', '.']]],
    ['rm -rf /', [['rm', '-rf', '/']]],
    ['rm -rf ~', [['rm', '-rf', '~']]],
    ['rm -rf ..', [['rm', '-rf', '..']]],
    ['rm -rf .git', [['rm', '-rf', '.git']]],
    ['rm with a long option', [['rm', '--no-preserve-root', 'x']]],
    ['rm -i', [['rm', '-i', 'x']]],
  ])('%s', (_n, setup) => {
    expect(bad(setup)).toMatchObject({ part: 'setup' });
  });

  test('a binary off the allowlist is named as such', () => {
    const m = rejectedPart({ setup: [['node', '-e', '1']] }).message;
    expect(m).toMatch(/`node` is not on the setup allowlist/);
    expect(m).toMatch(/allowed binaries: br, git, mkdir, cp, mv, touch, chmod, rm/);
    expect(rejectedPart({ setup: [['git', 'clone', 'x']] }).message).toMatch(/`git clone` is not on the setup allowlist/);
    expect(rejectedPart({ setup: [['br', 'upgrade']] }).message).toMatch(/`br upgrade` is not on the setup allowlist/);
  });

  test.each([
    [['br', 'init', '--prefix', 'itb']], [['br', 'create', '--title', 'A task', '--type', 'task', '-p', '2']], [['br', 'sync', '--flush-only']],
    [['git', 'add', '-A']], [['git', 'add', 'a/b.txt']], [['git', 'commit', '-m', 'msg']], [['git', 'commit', '-q', '--allow-empty', '-m', 'x']],
    [['git', 'switch', '-c', 'b']], [['git', 'checkout', '-b', 'b']], [['git', 'branch', 'feature']], [['git', 'tag', 'v1']], [['git', 'status']],
    [['git', 'mv', 'a', 'b']], [['git', 'rm', '-q', '--cached', 'a']],
    [['git', 'config', 'user.name', 'Eval']], [['git', 'config', '--local', 'user.email', 'a@b.invalid']], [['git', 'config', 'commit.gpgsign', 'false']],
    [['mkdir', '-p', 'a/b']], [['cp', 'a', 'b']], [['cp', '-r', 'a', 'b']], [['touch', 'f']], [['chmod', '+x', 'bin/x']], [['chmod', '755', 'x']], [['mv', 'a', 'b']], [['rm', '-rf', 'a/b']],
  ])('%j is allowed', (argv) => {
    expect(loadWith({ setup: [argv] }).evals).toHaveLength(1);
  });
});

describe('eval setup: allowed forms work end to end', () => {
  test('mkdir, cp, touch, chmod, git add/commit/switch run in order and leave the expected tree', () => {
    const r = go({
      setup: [['mkdir', '-p', 'a/b'], ['cp', 'seed.txt', 'a/b/s.txt'], ['touch', 'f'], ['mkdir', 'bin'], ['touch', 'bin/x'], ['chmod', '+x', 'bin/x'],
        ['git', 'add', '-A'], ['git', 'commit', '-m', 'msg'], ['git', 'switch', '-c', 'b']],
    }, {
      checks: [
        { type: 'fileExists', path: 'a/b/s.txt' }, { type: 'fileExists', path: 'f' },
        { type: 'commandOutputMatches', command: 'test -x bin/x && echo exec', pattern: '^exec' },
        { type: 'commandOutputMatches', command: 'git branch --show-current', pattern: '^b' },
        { type: 'commandOutputMatches', command: 'git log -1 --format=%s', pattern: '^msg' },
      ],
    });
    expect(r.status).toBe(0);
    expect(r.doc().results[0]).toMatchObject({ pass: true });
  });

  const hasBr = spawnSync('sh', ['-c', 'command -v br']).status === 0;
  (hasBr ? test : test.skip)('br init --prefix itb works in the sandbox', () => {
    const r = go({ setup: [['br', 'init', '--prefix', 'itb'], ['git', 'add', '-A'], ['git', 'commit', '-m', 'beads']] }, {
      checks: [{ type: 'fileExists', path: '.beads' }, { type: 'fileExists', path: 'SUMMARY.md' }],
    });
    expect(r.status).toBe(0);
    expect(r.doc().results[0]).toMatchObject({ pass: true });
  });

  test('a command that is not allowlisted never reaches the sandbox: the eval is rejected at load (exit 2), the stub never called', () => {
    const r = go({ setup: [['node', '-e', 'require("fs").writeFileSync("pwned", "x")']] });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/REJECTED eval ".*`node` is not on the setup allowlist/);
    expect(callsText()).toBe('');
  });
});

describe('eval setup: argv[0] is a bare name', () => {
  test.each([['/bin/ls'], ['./run.sh'], ['bin/tool'], ['bin\\tool'], ['../x']])('%s is refused as a path, not merely as an odd name', (bin) => {
    expect(rejectedPart({ setup: [[bin]] }).message).toMatch(/must be a bare name resolved on the safe PATH, not a path/);
  });
});

describe('eval setup: run in the sandbox', () => {
  test('commands run in order, in the project dir, before the agent; a setup commit moves the baseline', () => {
    const r = go({
      setup: [['touch', 'one'], ['cp', 'one', 'two'], ['git', 'add', '-A'], ['git', 'commit', '-q', '-m', 'setup'], ['touch', 'three']],
    }, {
      checks: [
        { type: 'fileExists', path: 'one' }, { type: 'fileExists', path: 'two' }, { type: 'fileExists', path: 'three' }, { type: 'fileExists', path: 'seed.txt' },
        // the setup commit is part of the baseline: main has not moved since, even though HEAD is after the fixture commit
        { type: 'noProtectedBranchCommit' },
        // `cp one two` ran after `touch one`; `three` was made after the commit, so it is untracked
        { type: 'commandOutputMatches', command: 'git status --porcelain', pattern: '\\?\\? three', flags: 'm' },
      ],
    });
    expect(r.status).toBe(0);
    expect(r.doc().results[0]).toMatchObject({ pass: true });
  });

  test('the agent never starts when setup fails: an incomplete run with a named reason, never a pass, fail or skip', () => {
    const r = go({ setup: [['touch', 'ok'], ['git', 'checkout', 'no-such-branch'], ['touch', 'never']] });
    expect(callsText()).toBe(''); // stub never called
    const doc = r.doc();
    const runs = agentRuns(doc);
    expect(doc.results[0].outcome).toBe('incomplete');
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run).toMatchObject({ outcome: 'incomplete', pass: null, costUsd: 0 });
      expect(run.incompleteReason).toMatch(/^setup failed: setup\[1\] git checkout: exit \d+/);
    }
  });

  test('a missing binary is named', () => {
    const dir = t.sub('mb'); fs.mkdirSync(dir);
    expect(setupLib.runSetup([['definitely-not-a-binary-xyz']], { dir, home: t.sub('mbh'), _unsafeAllowAny: true }))
      .toMatch(/setup\[0\] definitely-not-a-binary-xyz: `definitely-not-a-binary-xyz` was not found on the safe PATH/);
    // and without the test door the allowlist applies at run time too
    expect(setupLib.runSetup([['definitely-not-a-binary-xyz']], { dir, home: t.sub('mbh') })).toMatch(/not on the setup allowlist/);
  });

  test('a setup command that fails shows the start of its error output', () => {
    const r = go({ setup: [['git', 'checkout', 'no-such-branch']] });
    expect(agentRuns(r.doc())[0].incompleteReason).toMatch(/setup\[0\] git checkout: exit \d+: .*no-such-branch/);
  });

  test('setup is not run through a shell: metacharacters are plain arguments', () => {
    const r = go({ setup: [['touch', 'a; touch b'], ['touch', '$(touch c)']] }, {
      checks: [
        { type: 'fileExists', path: 'a; touch b' }, { type: 'fileExists', path: '$(touch c)' },
        { type: 'commandOutputMatches', command: 'ls b c 2>&1 || true', pattern: 'No such file' },
        { type: 'commandOutputMatches', command: 'test ! -e b && test ! -e c && echo clean', pattern: '^clean' },
      ],
    });
    expect(r.doc().results[0]).toMatchObject({ pass: true });
  });

  test('setup gets no credential, a throwaway HOME and no relative PATH entry', () => {
    const dir = t.sub('proj'); fs.mkdirSync(dir);
    const env = setupLib.setupEnv({
      parentEnv: { PATH: `/usr/bin::.:rel:${dir}/bin:/bin`, HOME: '/real/home', ANTHROPIC_API_KEY: 'sk-ant-x', OTHER: 'y', CI: 'true' }, home: t.sub('h'), workspace: dir,
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OTHER).toBeUndefined();
    expect(env.HOME).toBe(t.sub('h'));
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env).toMatchObject({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'false' });
  });

  test('a fixture binary is never resolved: the workspace and relative PATH entries are skipped', () => {
    const dir = t.sub('proj'); fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'tool'), '#!/bin/sh\n', { mode: 0o755 });
    const entries = setupLib.safePathEntries(`bin:${path.join(dir, 'bin')}:`, dir);
    expect(entries).toEqual([]);
    expect(setupLib.resolveBinary('tool', entries)).toBeNull();
  });

  test('setup runs with a bounded time: a command that outlives its limit fails the setup', () => {
    const dir = t.sub('b'); fs.mkdirSync(dir);
    const started = Date.now();
    const failure = setupLib.runSetup([['sleep', '20']], { dir, home: t.sub('bh'), timeoutMs: 300, _unsafeAllowAny: true });
    expect(failure).toMatch(/setup\[0\] sleep: timed out/);
    expect(Date.now() - started).toBeLessThan(10000);
  });

  test('setup output is bounded: a command printing more than the cap fails the setup', () => {
    const dir = t.sub('o'); fs.mkdirSync(dir);
    const failure = setupLib.runSetup([['yes']], { dir, home: t.sub('oh'), timeoutMs: 10000, _unsafeAllowAny: true });
    expect(failure).toMatch(/setup\[0\] yes: output exceeded/);
  });

  test('the total time budget is enforced across commands', () => {
    const dir = t.sub('tb'); fs.mkdirSync(dir);
    expect(setupLib.runSetup([['true']], { dir, home: t.sub('tbh'), totalMs: 0, _unsafeAllowAny: true })).toMatch(/time budget/);
  });

  test('limits: 20 s per command and 60 s for the list; spawnSync gets the per-command timeout capped by what is left', () => {
    expect(setupLib.COMMAND_TIMEOUT_MS).toBe(20 * 1000);
    expect(setupLib.TOTAL_TIMEOUT_MS).toBe(60 * 1000);
    const dir = t.sub('lim'); fs.mkdirSync(dir);
    const spy = jest.spyOn(childProcess, 'spawnSync');
    try {
      expect(setupLib.runSetup([['touch', 'a'], ['touch', 'b']], { dir, home: t.sub('limh') })).toBeNull();
      const timeouts = spy.mock.calls.map((c) => c[2].timeout);
      expect(timeouts).toHaveLength(2);
      expect(timeouts[0]).toBeLessThanOrEqual(20000);
      expect(timeouts[0]).toBeGreaterThan(19000);
      spy.mockClear();
      setupLib.runSetup([['touch', 'c']], { dir, home: t.sub('limh'), totalMs: 5000 });
      expect(spy.mock.calls[0][2].timeout).toBeLessThanOrEqual(5000);
      expect(spy.mock.calls.every((c) => c[2].detached === true && c[2].shell === false)).toBe(true);
    } finally { spy.mockRestore(); }
  });

  test('the list total is enforced across commands, not only per command', () => {
    const dir = t.sub('tot'); fs.mkdirSync(dir);
    const failure = setupLib.runSetup([['sleep', '0.4'], ['sleep', '5']], { dir, home: t.sub('toth'), totalMs: 700, timeoutMs: 20000, _unsafeAllowAny: true });
    expect(failure).toMatch(/setup\[1\] sleep: timed out/);
  });

  test('a sandbox whose setup fails is returned with setupError and no baseline; cleanup works', () => {
    const scenarioDir = t.sub('sc'); fs.mkdirSync(path.join(scenarioDir, 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(scenarioDir, 'fixture', 'a.txt'), 'a');
    const sb = sandbox.createSandbox(scenarioDir, { setup: [['git', 'checkout', 'nope']] }, { workdir: t.sub('work') });
    expect(sb.setupError).toMatch(/setup\[0\] git checkout: exit \d+/);
    expect(sb.baseline.mainSha).toBeNull();
    sb.cleanup();
    expect(fs.existsSync(sb.root)).toBe(false);
  });
});

describe('eval setup: the resulting tree is held to the fixture rules', () => {
  // The allowlist already refuses these commands at load, so the re-scan is exercised through the sandbox with the test-only allow-override
  // (an option of createSandbox that nothing in eval.json can reach).
  const scenarioDir = () => { const d = t.sub('sc'); fs.mkdirSync(path.join(d, 'fixture'), { recursive: true }); fs.writeFileSync(path.join(d, 'fixture', 'a.txt'), 'a'); return d; };
  const reason = (setup) => {
    const sb = sandbox.createSandbox(scenarioDir(), { setup }, { workdir: t.sub('work'), _setupUnsafeAllowAny: true });
    sb.cleanup();
    return sb.setupError;
  };

  test('setup writing .claude/ is rejected', () => {
    expect(reason([['mkdir', '.claude'], ['touch', '.claude/settings.json']])).toMatch(/^setup wrote rejected paths: \.claude \(/);
  });

  test('a nested .claude, .mcp.json and .gitmodules are rejected too', () => {
    expect(reason([['mkdir', '-p', 'sub/.claude']])).toMatch(/rejected paths: .*\.claude/);
    expect(reason([['touch', '.mcp.json']])).toMatch(/rejected paths: \.mcp\.json/);
    expect(reason([['touch', '.gitmodules']])).toMatch(/rejected paths: \.gitmodules/);
  });

  test('a symlink pointing outside the tree is rejected', () => {
    expect(reason([['ln', '-s', '/etc/passwd', 'pw']])).toMatch(/rejected paths: pw \(symlink points outside/);
  });

  test('a changed git config is rejected', () => {
    expect(reason([['git', 'config', 'core.hooksPath', '/somewhere']])).toMatch(/changed the repository git config/);
    expect(reason([['git', 'config', 'alias.x', '!sh']])).toMatch(/changed the repository git config/);
  });

  test('a planted git hook is rejected', () => {
    expect(reason([['touch', '.git/hooks/pre-commit']])).toMatch(/setup wrote git hooks: \.git\/hooks\/pre-commit/);
  });

  test('without the test-only override the same commands fail at run time on the allowlist (defence in depth)', () => {
    const sb = sandbox.createSandbox(scenarioDir(), { setup: [['touch', '.mcp.json']] }, { workdir: t.sub('work2') });
    sb.cleanup();
    expect(sb.setupError).toMatch(/setup\[0\] touch: .*\.mcp\.json.*setup may not touch/);
  });

  test('a clean setup passes the re-scan (the repository .git itself is not a finding)', () => {
    const dir = t.sub('clean'); fs.mkdirSync(dir);
    spawnSync('git', ['init', '-q'], { cwd: dir });
    expect(setupLib.checkAfterSetup(dir, fs.readFileSync(path.join(dir, '.git', 'config')))).toBeNull();
  });
});

describe('eval setup: run-time path checks (symlinks)', () => {
  const run = (cmds) => {
    const dir = t.sub('rt'); fs.mkdirSync(dir, { recursive: true });
    return { dir, failure: setupLib.runSetup(cmds, { dir, home: t.sub('rth') }) };
  };

  test('an operand resolving through a symlink out of the tree is refused', () => {
    const dir = t.sub('rt'); fs.mkdirSync(dir, { recursive: true });
    const outside = t.sub('outside'); fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(dir, 'link'));
    expect(setupLib.runSetup([['touch', 'link/x']], { dir, home: t.sub('rth') })).toMatch(/resolves outside the project/);
    expect(fs.existsSync(path.join(outside, 'x'))).toBe(false);
    expect(setupLib.runSetup([['rm', '-rf', 'link']], { dir, home: t.sub('rth') })).toMatch(/resolves outside the project/);
    expect(fs.existsSync(outside)).toBe(true);
  });

  test('an operand resolving through a symlink to .git is refused', () => {
    const dir = t.sub('rt'); fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.symlinkSync('.git', path.join(dir, 'g'));
    expect(setupLib.runSetup([['touch', 'g/hooks-x']], { dir, home: t.sub('rth') })).toMatch(/resolves under \.git/);
    expect(fs.existsSync(path.join(dir, '.git', 'hooks-x'))).toBe(false);
  });

  test('plain operands inside the tree run', () => {
    const { dir, failure } = run([['mkdir', '-p', 'a/b'], ['touch', 'a/b/c'], ['cp', 'a/b/c', 'a/d'], ['mv', 'a/d', 'a/e'], ['chmod', '+x', 'a/e'], ['rm', '-f', 'a/b/c']]);
    expect(failure).toBeNull();
    expect(fs.existsSync(path.join(dir, 'a', 'e'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'a', 'b', 'c'))).toBe(false);
  });
});

describe('eval setup: process group kill and the late re-scan', () => {
  const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const writer = (marker, delay = 1) => `(sleep ${delay}; touch '${marker}') >/dev/null 2>&1 &`;

  test('control: the same detached delayed writer DOES write when nobody kills its group', () => {
    const marker = t.sub('control-late');
    spawnSync('sh', ['-c', writer(marker)], { stdio: 'ignore' });
    sleepMs(1500);
    expect(fs.existsSync(marker)).toBe(true);
  });

  test('a background process started by a setup command is killed with its group when the command ends', () => {
    const dir = t.sub('pg'); fs.mkdirSync(dir);
    const marker = t.sub('pg-late');
    expect(setupLib.runSetup([['sh', '-c', writer(marker)]], { dir, home: t.sub('pgh'), _unsafeAllowAny: true })).toBeNull();
    sleepMs(1800);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('on timeout the whole group dies too: the command and its background child', () => {
    const dir = t.sub('pgt'); fs.mkdirSync(dir);
    const marker = t.sub('pgt-late');
    expect(setupLib.runSetup([['sh', '-c', `${writer(marker)} sleep 30`]], { dir, home: t.sub('pgth'), timeoutMs: 300, _unsafeAllowAny: true })).toMatch(/timed out/);
    sleepMs(1800);
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('a command that starts a delayed writer INTO the project cannot plant .claude after setup returned', () => {
    const dir = t.sub('pgw'); fs.mkdirSync(dir);
    expect(setupLib.runSetup([['sh', '-c', '(sleep 1; mkdir .claude) >/dev/null 2>&1 &']], { dir, home: t.sub('pgwh'), _unsafeAllowAny: true })).toBeNull();
    sleepMs(1800);
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
  });

  describe('runScenario re-runs the scan immediately before the agent starts', () => {
    const { runScenario } = require('../run');
    const REPO_ROOT = path.resolve(__dirname, '..', '..');
    const attempt = async (late) => {
      const scenarioDir = t.sub('lsc'); fs.mkdirSync(path.join(scenarioDir, 'fixture'), { recursive: true });
      fs.writeFileSync(path.join(scenarioDir, 'fixture', 'a.txt'), 'a');
      const orig = sandbox.createSandbox;
      const spy = jest.spyOn(sandbox, 'createSandbox').mockImplementation((...a) => { const sb = orig(...a); late(sb); return sb; });
      try {
        return await runScenario({ id: 'late', type: 'cli', scenarioDir, graders: [], setup: [['touch', 'f']] }, {
          workdir: t.sub('lwork'), credentials: [], parentEnv: { PATH: process.env.PATH }, timeoutMs: 5000, repoRoot: REPO_ROOT,
        });
      } finally { spy.mockRestore(); }
    };

    test('a write between the first scan and the start (.mcp.json) fails the run as incomplete with a named reason', async () => {
      const r = await attempt((sb) => fs.writeFileSync(path.join(sb.dir, '.mcp.json'), '{}'));
      expect(r).toMatchObject({ outcome: 'incomplete', pass: null, costUsd: 0 });
      expect(r.incompleteReason).toMatch(/^setup failed: late re-scan before the agent started: setup wrote rejected paths: \.mcp\.json/);
      expect(fs.readdirSync(t.sub('lwork'))).toEqual([]);
    });

    test('a late .claude, git hook and git config change are caught too', async () => {
      expect((await attempt((sb) => fs.mkdirSync(path.join(sb.dir, '.claude')))).incompleteReason).toMatch(/late re-scan.*\.claude/);
      expect((await attempt((sb) => fs.writeFileSync(path.join(sb.dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n', { mode: 0o755 }))).incompleteReason).toMatch(/late re-scan.*git hooks: \.git\/hooks\/pre-commit/);
      expect((await attempt((sb) => fs.appendFileSync(path.join(sb.dir, '.git', 'config'), '[core]\n\thooksPath = /x\n'))).incompleteReason).toMatch(/late re-scan.*changed the repository git config/);
    });

    test('control: nothing written late means the run goes on (not incomplete)', async () => {
      const r = await attempt(() => {});
      expect(r.outcome).not.toBe('incomplete');
    });
  });
});

describe('a setup failure on one run makes the eval incomplete (exit 4), like a provider error', () => {
  test('four passing runs and one setup failure: exit 4, an INCOMPLETE note, no baseline summary', () => {
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    fs.mkdirSync(t.sub('bin'), { recursive: true });
    // The 10th setup commit (with-skill run 5; baseline runs go first in each pair) fails like a flaky index.lock.
    t.write(t.sub('bin/git'), `#!/bin/sh
case "$*" in *"-m setup"*) n=$(cat '${t.sub('git.count')}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${t.sub('git.count')}'
if [ "$n" = 10 ]; then echo 'fatal: Unable to create index.lock: File exists' >&2; exit 128; fi;; esac
exec '${realGit}' "$@"
`);
    fs.chmodSync(t.sub('bin/git'), 0o755);
    const r = go({ setup: [['git', 'commit', '-q', '--allow-empty', '-m', 'setup']] }, { args: '--repeats 5 --concurrency 1 --model claude-stub-1' });
    const ev = r.doc().results[0];
    expect(ev.withSkill).toMatchObject({ passes: 4, runs: 4, providerErrors: 1, setupFailures: 1 });
    expect(ev.baseline).toMatchObject({ passes: 0, runs: 5, providerErrors: 0 });
    expect(ev.uplift).toBeNull();
    expect(r.stdout).toMatch(/INCOMPLETE .*1 run\(s\) failed in setup .*no baseline summary written/);
    expect(r.stdout).toMatch(/1 with provider errors/);
    expect(fs.existsSync(t.sub('baselines', 'claude'))).toBe(false);
    expect(r.status).toBe(4);
    const failed = agentRuns(r.doc()).filter((x) => x.outcome === 'incomplete');
    expect(failed).toHaveLength(1);
    expect(failed[0].incompleteReason).toMatch(/^setup failed: setup\[0\] git commit: exit 128: .*index\.lock/);
  });

  test('armStats counts a setup failure with the provider errors and apart', () => {
    const s = exec.armStats([
      { outcome: 'incomplete', incompleteReason: 'setup failed: x' }, { outcome: 'incomplete', incompleteReason: 'provider error: 529' },
      { outcome: 'incomplete', incompleteReason: 'something else' }, { outcome: 'pass' },
    ], 5);
    expect(s).toMatchObject({ providerErrors: 2, setupFailures: 1, runs: 1, passes: 1 });
  });
});

describe('setup git hardening and the eval hash', () => {
  test('git in setup runs with the harness hardening: a planted pre-commit hook does not run', () => {
    const dir = t.sub('hk'); fs.mkdirSync(dir);
    const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...envlib.gitEnv(), GIT_CONFIG_GLOBAL: '/dev/null' } });
    g('init', '-q'); g('config', 'user.email', 'a@b.invalid'); g('config', 'user.name', 'a');
    const marker = t.sub('hook-ran');
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    const failure = setupLib.runSetup([['git', 'commit', '-q', '--allow-empty', '-m', 'x']], { dir, home: t.sub('hkh') });
    expect(failure).toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
  });

  test('env and setup are part of the eval hash (eval.json is hashed whole): changing either changes it', () => {
    const dir = path.join(skillsDir, 'h'); fs.mkdirSync(path.join(dir, 'fixture'), { recursive: true });
    const at = (extra) => { fs.writeFileSync(path.join(dir, 'eval.json'), JSON.stringify({ ...valid(), ...extra })); return hash.evalHash(dir); };
    const plain = at({});
    const withEnv = at({ env: { ENSEMBLE_NON_INTERACTIVE: '1' } });
    const otherEnv = at({ env: { ENSEMBLE_NON_INTERACTIVE: '0' } });
    const withSetup = at({ setup: [['touch', 'a']] });
    const otherSetup = at({ setup: [['touch', 'b']] });
    expect(new Set([plain, withEnv, otherEnv, withSetup, otherSetup]).size).toBe(5);
  });
});

describe('remote evals get push.autoSetupRemote', () => {
  const gitCfg = (cwd) => spawnSync('git', ['config', '--local', '--get', 'push.autoSetupRemote'], { cwd, encoding: 'utf8' });
  const scenarioDir = () => { const d = t.sub('sc'); fs.mkdirSync(path.join(d, 'fixture'), { recursive: true }); fs.writeFileSync(path.join(d, 'fixture', 'a.txt'), 'a'); return d; };

  test('set (sandbox-local) when remote is true; unset otherwise', () => {
    const remote = sandbox.createSandbox(scenarioDir(), { remote: true }, { workdir: t.sub('work') });
    expect(gitCfg(remote.dir).stdout.trim()).toBe('true');
    remote.cleanup();
    const plain = sandbox.createSandbox(scenarioDir(), {}, { workdir: t.sub('work') });
    expect(gitCfg(plain.dir).stdout.trim()).toBe('');
    plain.cleanup();
  });

  test('a bare git push of a new branch works against the sandbox origin', () => {
    const sb = sandbox.createSandbox(scenarioDir(), { remote: true, setup: [['touch', 'x']] }, { workdir: t.sub('work') });
    expect(sb.setupError).toBeNull();
    const git = (...a) => spawnSync('git', a, { cwd: sb.dir, encoding: 'utf8', env: { ...envlib.gitEnv(), GIT_CONFIG_GLOBAL: '/dev/null' } });
    expect(git('switch', '-q', '-c', 'feature/x').status).toBe(0);
    const push = git('push', '-q');
    expect(push.status).toBe(0);
    expect(spawnSync('git', ['--git-dir', sb.baseline.remotePath, 'rev-parse', 'refs/heads/feature/x'], { encoding: 'utf8' }).status).toBe(0);
    expect(sb.baseline.remoteMainSha).toMatch(/^[0-9a-f]{40}$/);
    sb.cleanup();
  });

  test('end to end through run.js: the agent sees it only for a remote eval', () => {
    go({ remote: true });
    expect(fs.readFileSync(t.sub('cfg.txt'), 'utf8').trim()).toBe('true');
    t.resetCalls();
    go({});
    expect(fs.readFileSync(t.sub('cfg.txt'), 'utf8').trim()).toBe('unset');
  });
});

describe('ceilings: maxTimeoutSec and maxRunUsd', () => {
  test('limits.json has the long-run ceilings and keeps the defaults', () => {
    expect(exec.loadLimits()).toMatchObject({ timeoutSec: 900, maxTimeoutSec: 7200, runReserveUsd: 5, maxRunUsd: 40 });
  });

  test('without the keys the ceilings equal the defaults (nothing changes); bad ceilings are refused', () => {
    const f = t.sub('limits.json');
    fs.writeFileSync(f, JSON.stringify({ maxUsdPerSuite: 50 }));
    expect(exec.loadLimits(f)).toMatchObject({ timeoutSec: 900, maxTimeoutSec: 900, runReserveUsd: 5, maxRunUsd: 5 });
    // a file's missing keys come from the built-in defaults (900 and 5), so a custom timeoutSec above 900 without maxTimeoutSec is refused
    fs.writeFileSync(f, JSON.stringify({ timeoutSec: 1200 }));
    expect(() => exec.loadLimits(f)).toThrow(/maxTimeoutSec/);
    fs.writeFileSync(f, JSON.stringify({ timeoutSec: 1200, maxTimeoutSec: 1200 }));
    expect(exec.loadLimits(f)).toMatchObject({ timeoutSec: 1200, maxTimeoutSec: 1200 });
    fs.writeFileSync(f, JSON.stringify({ runReserveUsd: 8 }));
    expect(() => exec.loadLimits(f)).toThrow(/maxRunUsd/);
    fs.writeFileSync(f, JSON.stringify({ maxTimeoutSec: 100 }));
    expect(() => exec.loadLimits(f)).toThrow(/maxTimeoutSec/);
    fs.writeFileSync(f, JSON.stringify({ maxRunUsd: 1 }));
    expect(() => exec.loadLimits(f)).toThrow(/maxRunUsd/);
  });

  test('an eval above the ceiling is rejected at load with a named error; at or below is accepted', () => {
    expect(rejectedPart({ timeoutSec: 7201 })).toMatchObject({ part: 'timeoutSec' });
    expect(rejectedPart({ timeoutSec: 7201 }).message).toMatch(/maxTimeoutSec 7200/);
    expect(rejectedPart({ runUsd: 40.01 })).toMatchObject({ part: 'runUsd' });
    expect(rejectedPart({ runUsd: 40.01 }).message).toMatch(/maxRunUsd 40/);
    expect(rejectedPart({ runUsd: 0 })).toMatchObject({ part: 'runUsd' });
    expect(rejectedPart({ runUsd: '5' })).toMatchObject({ part: 'runUsd' });
    expect(loadWith({ timeoutSec: 7200, runUsd: 40 }).evals[0]).toMatchObject({ timeoutSec: 7200, runUsd: 40 });
    // the ceiling is data: with the default limits an eval cannot ask for more than 900 / $5
    const tight = { ...exec.loadLimits(), maxTimeoutSec: 900, maxRunUsd: 5 };
    expect(rejectedPart({ timeoutSec: 901 }, tight)).toMatchObject({ part: 'timeoutSec' });
    expect(rejectedPart({ runUsd: 5.5 }, tight)).toMatchObject({ part: 'runUsd' });
  });

  test('a rejected definition is an EvalDefinitionError', () => {
    expect(() => validateEvalDef({ ...valid(), timeoutSec: 99999 }, (() => { const d = path.join(skillsDir, 'demo-skill'); fs.mkdirSync(path.join(d, 'fixture'), { recursive: true }); return d; })(), { repoRoot: repo }))
      .toThrow(EvalDefinitionError);
  });

  test('--timeout above maxTimeoutSec is exit 2; at the ceiling it runs', () => {
    const over = go({}, { args: `${ARGS} --timeout 7201` });
    expect(over.status).toBe(2);
    expect(over.stderr).toMatch(/--timeout 7201 exceeds the limit of 7200s/);
    expect(callsText()).toBe('');
    expect(go({}, { args: `${ARGS} --timeout 7200` }).status).toBe(0);
  });

  test('an eval timeoutSec above the old 900 ceiling is honoured end to end, with its budget, and in the cache key and replay', () => {
    const r = go({ timeoutSec: 3600, runUsd: 12 }, { checks: [{ type: 'fileExists', path: 'MISSING.md' }] });
    expect(r.status).toBe(1);
    // the stub saw the eval's budget on the command line, for both arms
    const argvLines = callsText().split('\n').filter((l) => l.startsWith('agent'));
    expect(argvLines).toHaveLength(2);
    for (const l of argvLines) expect(l).toMatch(/--max-budget-usd 12( |$)/);
    // recorded settings carry the effective time limit and budget
    const run0 = agentRuns(r.doc())[0];
    expect(run0).toBeDefined();
    const text = fs.readFileSync(r.log, 'utf8');
    expect(text).toMatch(/"timeoutSec": 3600/);
    expect(text).toMatch(/"runUsd": 12/);
    // the replay command carries both and, run again, reaches the stub with the same budget and is not refused as above the ceiling
    const m = /replay: (node evals\/run\.js .*)/.exec(r.stdout);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/--timeout '?3600'?/);
    expect(m[1]).toMatch(/--run-usd '?12'?/);
    t.resetCalls();
    const again = t.exec(m[1]);
    expect(again.status).not.toBe(2);
    expect(callsText()).toMatch(/agent with-skill argv=.*--max-budget-usd 12( |$)/);
    // cache key: the per-eval budget and time limit are part of it
    const base = { ev: { id: 'e', skill: 's', invocation: 'plain' }, arm: 'with-skill', run: 1, runtime: 'claude', requestedModel: 'm', copy: { skillHash: 'a', packageHash: 'b' }, evalVersion: 'v', timeoutMs: 3600000, runUsd: 12, judgeModel: null };
    expect(cache.keyOf(cache.keyInputs(base))).not.toBe(cache.keyOf(cache.keyInputs({ ...base, runUsd: 13 })));
    expect(cache.keyOf(cache.keyInputs(base))).not.toBe(cache.keyOf(cache.keyInputs({ ...base, timeoutMs: 900000 })));
  });

  test('--run-usd overrides the eval runUsd; the suite cap still bounds it', () => {
    go({ runUsd: 12 }, { args: `${ARGS} --run-usd 3` });
    expect(callsText()).toMatch(/--max-budget-usd 3( |$)/);
    t.resetCalls();
    go({ runUsd: 30 }, { args: `${ARGS} --max-usd 8` });
    expect(callsText()).toMatch(/--max-budget-usd 8( |$)/);
  });

  test('an eval without runUsd keeps the runReserveUsd default of 5', () => {
    go({});
    expect(callsText()).toMatch(/--max-budget-usd 5( |$)/);
  });

  test('the reservation uses the eval budget: with $30 reserved per run under a $50 cap, a run of unknown cost leaves no room for the second arm', () => {
    t.write(t.sub('noresult'), ''); // no result line: no reported cost, so the run is charged its full reservation
    const r = go({ runUsd: 30 }, { args: `${ARGS} --max-usd 50` });
    const agentCalls = callsText().split('\n').filter((l) => l.startsWith('agent'));
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0]).toMatch(/--max-budget-usd 30( |$)/);
    expect(r.stdout).toMatch(/cost cap \$50 reached/);
  });

  test('the per-eval budget is in the stored-result key end to end: the same run is reused, a different budget is not', () => {
    const args = `${ARGS} --max-usd 100`;
    go({ runUsd: 30 }, { args });
    expect(callsText()).toMatch(/agent with-skill/);
    t.resetCalls();
    expect(go({ runUsd: 30 }, { args }).stdout).toMatch(/reusing stored result/);
    expect(callsText()).toBe('');
    // --max-usd 8 clamps the per-run budget to 8: a different budget, so a different key, so the stub is called again
    go({ runUsd: 30 }, { args: `${ARGS} --max-usd 8` });
    expect(callsText()).toMatch(/agent \w+(-\w+)? argv=.*--max-budget-usd 8( |$)/);
  });

  test('a legacy scenario may not set env, setup or runUsd (they are validated only for skill evals)', () => {
    const values = { env: { A: '1' }, setup: [['sh', '-c', 'x']], runUsd: 3 };
    for (const [k, v] of Object.entries(values)) {
      const base = t.sub(`legacy-${k}`);
      t.write(path.join(base, 'one', 'scenario.json'), JSON.stringify({ prompt: 'x', graders: [], [k]: v }));
      expect(() => loadScenarios(base)).toThrow(new RegExp(`\`${k}\` is a skill eval field`));
    }
    t.write(t.sub('legacy-ok', 'one', 'scenario.json'), JSON.stringify({ prompt: 'x', graders: [], timeoutSec: 600 }));
    expect(loadScenarios(t.sub('legacy-ok'))).toHaveLength(1);
  });

  test('a legacy scenario stays capped at the 900 s default: only skill evals reach maxTimeoutSec', () => {
    t.write(t.sub('scenarios', 'legacy-long', 'scenario.json'), JSON.stringify({
      type: 'agent', prompt: 'x', plugins: [], timeoutSec: 5000, graders: [{ type: 'fileExists', path: 'MISSING.md' }],
    }));
    writeStub();
    const r = t.exec('node evals/run.js --scenario legacy-long --repeats 1 --model claude-stub-1');
    expect(r.stdout).toMatch(/replay: .*--timeout '?900'?/);
  });

  test('a per-eval timeoutSec below the ceiling is honoured: a sleeping agent times out', () => {
    t.write(t.sub('sleep'), '');
    const r = go({ timeoutSec: 1 });
    expect(r.doc().results[0].runs.some((x) => x.outcome === 'timed_out')).toBe(true);
    expect(r.stdout).toMatch(/TIMED_OUT/);
  });

  test('an eval above the ceiling is rejected at run time with exit 2 and never reaches the stub', () => {
    const r = go({ timeoutSec: 7201 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/REJECTED eval ".*": `timeoutSec` 7201 exceeds the ceiling maxTimeoutSec 7200/);
    expect(callsText()).toBe('');
    const r2 = go({ runUsd: 41 });
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/`runUsd` 41 exceeds the ceiling maxRunUsd 40/);
    expect(callsText()).toBe('');
  });
});
