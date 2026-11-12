'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PKG = path.join(__dirname, '..');
const BUNDLE = path.join(PKG, 'bundle', 'lifecycle.cjs');

let proj;
let home;
let store;
beforeEach(() => {
  proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-proj-')));
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lc-home-')));
  store = path.join(home, '.ensemble', 'trusted-hooks.json');
});
afterEach(() => {
  fs.rmSync(proj, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

function run(input, env = {}) {
  return spawnSync('node', [BUNDLE], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj, HOME: home, ...env },
    encoding: 'utf8',
  });
}

const LOG = () => path.join(proj, 'log.jsonl');
const logLines = () => (fs.existsSync(LOG()) ? fs.readFileSync(LOG(), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const submit = (prompt, session = 's1') => ({ hook_event_name: 'UserPromptSubmit', session_id: session, cwd: proj, prompt });
const stop = (extra = {}, session = 's1') => ({ hook_event_name: 'Stop', session_id: session, cwd: proj, ...extra });

/** A hooks file whose shell handlers append their stdin to log.jsonl. */
function writeHooks({ startPolicy = 'continue', startScript } = {}) {
  fs.mkdirSync(path.join(proj, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'rec.js'), "require('fs').appendFileSync(require('path').join(process.env.ENSEMBLE_PROJECT_ROOT,'log.jsonl'), require('fs').readFileSync(0,'utf8')+'\\n');\n");
  fs.writeFileSync(path.join(proj, 'fail.js'), "process.exit(3);\n");
  const startArgs = startScript || './rec.js';
  fs.writeFileSync(
    path.join(proj, '.ensemble', 'hooks.yaml'),
    [
      'version: 1',
      'hooks:',
      '  rec:',
      '    type: shell',
      '    command: node',
      '    args: ["./rec.js"]',
      '    on_error: continue',
      '  gate:',
      '    type: shell',
      '    command: node',
      `    args: ["${startArgs === './rec.js' ? './fail.js' : startArgs}"]`,
      `    on_error: ${startPolicy}`,
      'commands:',
      '  ensemble:fix-issue:',
      startPolicy === 'block' ? '    start: [gate, rec]' : '    start: [rec]',
      '    end: [rec]',
      '',
    ].join('\n'),
  );
}

function trust() {
  const r = spawnSync('node', ['-e', `
    const m = require(${JSON.stringify(path.join(PKG, '..', 'agent-core', 'dist', 'index.js'))});
    const l = m.loadHooksConfig(${JSON.stringify(proj)});
    m.recordTrust(${JSON.stringify(proj)}, m.computeHooksDigest(${JSON.stringify(proj)}, l.config), { storePath: ${JSON.stringify(store)} });
  `], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

describe('start and end', () => {
  beforeEach(() => { writeHooks(); trust(); });

  test('start fires once with the Pi payload shape; Stop ends it once', () => {
    const s = run(submit('/ensemble:fix-issue the token=abc123def is broken'));
    expect(s.status).toBe(0);
    let lines = logLines();
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0])).toEqual(['event', 'run_id', 'command', 'arguments', 'cwd', 'session_id', 'timestamp']);
    expect(lines[0]).toMatchObject({ event: 'command.start', command: 'ensemble:fix-issue', cwd: proj, session_id: 's1' });
    expect(lines[0].arguments).toContain('[REDACTED]');
    expect(lines[0].arguments).not.toContain('abc123def');

    const e = run(stop());
    expect(e.status).toBe(0);
    lines = logLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ event: 'command.end', run_id: lines[0].run_id, command: 'ensemble:fix-issue', outcome: 'succeeded' });
    expect(lines[1].duration_ms).toEqual(expect.any(Number));

    run(stop());
    expect(logLines()).toHaveLength(2);
  });

  test('non-Ensemble prompts and commands the file does not select fire nothing', () => {
    run(submit('hello there'));
    run(submit('/review something'));
    run(submit('/ensemble:create-prd foo'));
    run(stop());
    expect(logLines()).toEqual([]);
  });

  test('a new command before Stop closes the previous run as cancelled', () => {
    run(submit('/ensemble:fix-issue one'));
    run(submit('/ensemble:fix-issue two'));
    const lines = logLines();
    expect(lines.map((l) => [l.event, l.arguments])).toEqual([
      ['command.start', 'one'],
      ['command.end', 'one'],
      ['command.start', 'two'],
    ]);
    expect(lines[1].outcome).toBe('cancelled');
    run(stop());
    expect(logLines().slice(-1)[0]).toMatchObject({ event: 'command.end', arguments: 'two', outcome: 'succeeded' });
  });

  test('StopFailure ends failed and SessionEnd ends cancelled; sessions are independent', () => {
    run(submit('/ensemble:fix-issue a', 'sA'));
    run(submit('/ensemble:fix-issue b', 'sB'));
    run({ hook_event_name: 'StopFailure', session_id: 'sA', cwd: proj });
    run({ hook_event_name: 'SessionEnd', session_id: 'sB', cwd: proj });
    const ends = logLines().filter((l) => l.event === 'command.end');
    expect(ends.map((l) => [l.session_id, l.outcome])).toEqual([['sA', 'failed'], ['sB', 'cancelled']]);
  });

  test('a Stop with stop_hook_active ends the run once and never loops or blocks', () => {
    run(submit('/ensemble:fix-issue x'));
    const r = run(stop({ stop_hook_active: true }));
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('"decision"');
    const r2 = run(stop({ stop_hook_active: true }));
    expect(r2.stdout).toBe('');
    expect(logLines().filter((l) => l.event === 'command.end')).toHaveLength(1);
  });

  test('a dispatcher keyword resolves to its target command', () => {
    fs.writeFileSync(path.join(proj, '.ensemble', 'hooks.yaml'), fs.readFileSync(path.join(proj, '.ensemble', 'hooks.yaml'), 'utf8').replace('ensemble:fix-issue', 'ensemble:create-prd'));
    trust();
    run(submit('/ensemble:prd create a thing'));
    expect(logLines()[0]).toMatchObject({ command: 'ensemble:create-prd', arguments: 'a thing' });
  });
});

describe('plugin-namespaced command names', () => {
  beforeEach(() => { writeHooks(); trust(); });

  test.each([
    '/ensemble-full:ensemble-fix-issue the build is broken',
    '/ensemble-development:ensemble:fix-issue the build is broken',
  ])('%s starts the command', (prompt) => {
    run(submit(prompt));
    expect(logLines()[0]).toMatchObject({ event: 'command.start', command: 'ensemble:fix-issue', arguments: 'the build is broken' });
  });

  test('a bundle dispatcher resolves to its target command', () => {
    fs.writeFileSync(path.join(proj, '.ensemble', 'hooks.yaml'), fs.readFileSync(path.join(proj, '.ensemble', 'hooks.yaml'), 'utf8').replace('ensemble:fix-issue', 'ensemble:create-prd'));
    trust();
    run(submit('/ensemble-full:ensemble-prd create a thing'));
    expect(logLines()[0]).toMatchObject({ command: 'ensemble:create-prd', arguments: 'a thing' });
  });

  test.each(['/ensemble-fix-issue', '/ensemble-full:fix-issue', '/other-plugin:ensemble-fix-issue'])('%s is not a command start', (prompt) => {
    run(submit(prompt));
    expect(logLines()).toHaveLength(0);
  });
});

describe('opt-in and trust', () => {
  test('no hooks file: nothing runs, nothing printed, no state written', () => {
    const r = run(submit('/ensemble:fix-issue x'));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(fs.existsSync(path.join(proj, '.ensemble'))).toBe(false);
  });

  test('untrusted hooks do not run, and the user is told how to trust them', () => {
    writeHooks();
    const r = run(submit('/ensemble:fix-issue x'));
    expect(r.status).toBe(0);
    expect(logLines()).toEqual([]);
    expect(JSON.parse(r.stdout).systemMessage).toMatch(/not trusted/);
    run(stop());
    expect(logLines()).toEqual([]);
  });

  test('editing a covered file voids trust', () => {
    writeHooks();
    trust();
    fs.appendFileSync(path.join(proj, 'rec.js'), '// edited\n');
    run(submit('/ensemble:fix-issue x'));
    expect(logLines()).toEqual([]);
  });

  test('the trust subcommand refuses without a terminal and records nothing', () => {
    writeHooks();
    const r = spawnSync('node', [BUNDLE, 'trust', proj], { input: 'yes\n', env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(fs.existsSync(store)).toBe(false);
  });
});

describe('blocking and failure handling', () => {
  test('a failing start handler with on_error block blocks the prompt and still ends the run', () => {
    writeHooks({ startPolicy: 'block' });
    trust();
    const r = run(submit('/ensemble:fix-issue x'));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe('block');
    expect(out.reason).toMatch(/gate/);
    const lines = logLines();
    expect(lines.map((l) => [l.event, l.outcome])).toEqual([['command.end', 'failed']]);
    run(stop());
    expect(logLines()).toHaveLength(1);
  });

  test('prompt handlers cannot run here: reported as failed, command continues under on_error continue', () => {
    writeHooks();
    fs.mkdirSync(path.join(proj, 'prompts'));
    fs.writeFileSync(path.join(proj, 'prompts', 'p.md'), 'check');
    const file = path.join(proj, '.ensemble', 'hooks.yaml');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('hooks:\n', 'hooks:\n  pr:\n    type: prompt\n    prompt: ./prompts/p.md\n    on_error: continue\n').replace('start: [rec]', 'start: [pr, rec]'));
    trust();
    const r = run(submit('/ensemble:fix-issue x'));
    expect(JSON.parse(r.stdout).systemMessage).toMatch(/"pr" failed.*only in Pi/);
    expect(logLines()).toHaveLength(1);
  });
});

describe('failing open', () => {
  test.each(['', 'not json', '{"hook_event_name":', '[]', 'null'])('malformed stdin %j exits 0 silently', (input) => {
    const r = run(input);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  test('an unreadable state file or odd event is ignored', () => {
    writeHooks();
    trust();
    fs.mkdirSync(path.join(proj, '.ensemble', 'lifecycle-state'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.ensemble', 'lifecycle-state', 's1.json'), '{broken');
    expect(run(stop()).status).toBe(0);
    expect(run({ hook_event_name: 'PreToolUse', session_id: 's1' }).status).toBe(0);
    expect(logLines()).toEqual([]);
  });

  test('state stays out of git', () => {
    writeHooks();
    trust();
    run(submit('/ensemble:fix-issue x'));
    expect(fs.readFileSync(path.join(proj, '.ensemble', 'lifecycle-state', '.gitignore'), 'utf8')).toBe('*\n');
  });
});

describe('plugin package', () => {
  test('hooks.json registers the four events against the committed bundle', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(PKG, 'hooks', 'hooks.json'), 'utf8')).hooks;
    expect(Object.keys(hooks).sort()).toEqual(['SessionEnd', 'Stop', 'StopFailure', 'UserPromptSubmit']);
    for (const groups of Object.values(hooks)) {
      const command = groups[0].hooks[0].command;
      expect(command).toContain('${CLAUDE_PLUGIN_ROOT}/bundle/lifecycle.cjs');
    }
    expect(fs.existsSync(BUNDLE)).toBe(true);
  });

  // bun's bundle output differs between versions (runtime helpers change), so a byte comparison is only meaningful
  // against the bun that built the committed bundle (bundle/BUN_VERSION, written by scripts/build.mjs). Any other bun,
  // or none, skips the comparison; a stale bundle is still caught by whoever rebuilds with the recorded version.
  const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  const recordedBun = fs.readFileSync(path.join(PKG, 'bundle', 'BUN_VERSION'), 'utf8').trim();
  (bun.status === 0 && bun.stdout.trim() === recordedBun ? test : test.skip)('the committed bundle matches a fresh build of agent-core and the gate (rebuild with npm run build)', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-build-'));
    try {
      const r = spawnSync('bun', ['build', 'src/main.ts', '--target=node', '--format=cjs', `--outfile=${path.join(out, 'lifecycle.cjs')}`], { cwd: PKG, encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(fs.readFileSync(path.join(out, 'lifecycle.cjs'), 'utf8')).toBe(fs.readFileSync(BUNDLE, 'utf8'));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
