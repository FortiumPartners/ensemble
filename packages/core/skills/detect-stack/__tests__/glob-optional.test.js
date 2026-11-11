const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const AXES = ['framework', 'test', 'tooling', 'cloud'];
const DEGRADED = 'glob-unavailable';

const tempDirs = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A copy of the skill in a directory with no node_modules on the path upward, so a
 * `require('glob')` from inside it fails the way it does in a bare install of the shipped Pi
 * copy. With `withGlob`, the package plus its hoisted dependency closure is vendored beside it
 * (the closure is read from the manifests, so a version bump cannot quietly make it incomplete).
 */
function skillCopy({ withGlob = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-copy-'));
  tempDirs.push(root);
  const dir = path.join(root, 'detect-stack');
  fs.cpSync(SKILL_DIR, dir, {
    recursive: true,
    filter: source => !source.includes(`${path.sep}__tests__${path.sep}`)
  });
  if (withGlob) {
    const modules = path.join(dir, 'node_modules');
    fs.mkdirSync(modules, { recursive: true });
    for (const name of globClosure()) {
      fs.cpSync(path.join(REPO_ROOT, 'node_modules', name), path.join(modules, name), {
        recursive: true
      });
    }
  }
  return { dir, script: path.join(dir, 'detect-stack.js') };
}

function globClosure() {
  const names = new Set(['glob']);
  const queue = ['glob'];
  while (queue.length) {
    let manifest;
    try {
      manifest = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'node_modules', queue.shift(), 'package.json'), 'utf8')
      );
    } catch {
      continue;
    }
    for (const dep of Object.keys(manifest.dependencies || {})) {
      if (names.has(dep)) continue;
      if (!fs.existsSync(path.join(REPO_ROOT, 'node_modules', dep, 'package.json'))) continue;
      names.add(dep);
      queue.push(dep);
    }
  }
  return [...names];
}

/**
 * A React app whose Jest suites live under src/. Every axis has an answer here and each needs a
 * file glob to give it: React from package.json plus its source layout, Jest from jest.config.js
 * and the test files, the tooling and cloud axes from their file and content signals.
 */
function fixtureProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-stack-fixture-'));
  tempDirs.push(dir);
  const write = (rel, content) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  };
  write('package.json', {
    name: 'web',
    dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' }
  });
  write('jest.config.js', 'module.exports = { testEnvironment: "node" };\n');
  write('src/components/Button.jsx', 'export default function Button() { return null; }\n');
  write('src/components/Button.test.jsx', 'test("renders", () => {});\n');
  write('src/utils/format.js', 'export const format = value => String(value);\n');
  write('src/utils/format.test.js', 'test("formats", () => {});\n');
  write('Dockerfile', 'FROM node:22\nCMD ["node", "index.js"]\n');
  write('.github/workflows/ci.yaml', 'name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n');
  write('helm/Chart.yaml', 'apiVersion: v2\nname: web\nversion: 0.1.0\n');
  write('infra/main.tf', 'resource "aws_instance" "web" { instance_type = "t3.micro" }\n');
  return dir;
}

/**
 * Run `script` in a child process. `mode: 'absent'` makes every `require('glob')` inside it fail
 * with MODULE_NOT_FOUND, which is the bare-install condition; `'present'` loads it as-is.
 * `args` runs the CLI exactly as a user does (`node detect-stack.js <args>`, the hook preloaded
 * with --require, since the module does not export its `main`); otherwise `axis` is passed to
 * the API through a small driver.
 */
function runCopy(script, { mode = 'absent', args = null, axis = null, project = null }) {
  const base = path.dirname(path.dirname(script));
  const hookSource = mode === 'absent'
    ? ['const Module = require("module");',
       'const loadOrig = Module._load;',
       'Module._load = function (request, parent, isMain) {',
       '  if (request === "glob") {',
       '    const err = new Error("Cannot find module \'glob\'");',
       "    err.code = 'MODULE_NOT_FOUND';",
       '    throw err;',
       '  }',
       '  return loadOrig.apply(this, arguments);',
       '};'].join('\n')
    : '';
  let command;
  if (args) {
    const hook = path.join(base, 'hook.js');
    fs.writeFileSync(hook, hookSource);
    command = ['--require', hook, script, ...args];
  } else {
    const driver = path.join(base, 'driver.js');
    fs.writeFileSync(
      driver,
      [
        hookSource,
        `const mod = require(${JSON.stringify(script)});`,
        'Promise.resolve()',
        `  .then(() => mod.detect(${JSON.stringify(axis)}, ${JSON.stringify(project)}))`,
        '  .then(value => process.stdout.write(JSON.stringify(value)))',
        '  .catch(error => {',
        '    process.stdout.write(JSON.stringify({ crashed: String(error && error.stack) }));',
        '    process.exitCode = 9;',
        '  });'
      ].join('\n')
    );
    command = [driver];
  }
  const run = spawnSync(process.execPath, command, { encoding: 'utf8', timeout: 180000 });
  expect(run.stderr).not.toMatch(/Cannot find module 'glob'/);
  return run;
}

/** Ask a copy for one axis through its API and return the envelope. */
function envelope(script, axis, project, { mode = 'absent' } = {}) {
  const run = runCopy(script, { mode, axis, project });
  const parsed = JSON.parse(run.stdout || '{}');
  expect(parsed.crashed).toBeUndefined();
  return parsed;
}

describe('running detect-stack.js without the glob package', () => {
  // This is the bug: the require ran at module load, so nothing worked, not even --help.
  test('the module loads and its API is intact', () => {
    const { script } = skillCopy();
    const probe = path.join(path.dirname(path.dirname(script)), 'probe.js');
    fs.writeFileSync(
      probe,
      ['const Module = require("module");',
       'const loadOrig = Module._load;',
       'Module._load = function (request) {',
       '  if (request === "glob") {',
       '    const err = new Error("Cannot find module \'glob\'");',
       "    err.code = 'MODULE_NOT_FOUND';",
       '    throw err;',
       '  }',
       '  return loadOrig.apply(this, arguments);',
       '};',
       `const mod = require(${JSON.stringify(script)});`,
       'process.stdout.write([typeof mod.detect, Array.isArray(mod.AXES)].join(","));'].join('\n')
    );
    const run = spawnSync(process.execPath, [probe], { encoding: 'utf8', timeout: 180000 });
    expect(run.stderr).not.toMatch(/Cannot find module 'glob'/);
    expect(run.stdout).toBe('function,true');
  });

  test('the CLI prints an envelope, and --help prints usage', () => {
    const { script } = skillCopy();
    const project = fixtureProject();
    const run = runCopy(script, { args: [project] });
    // The CLI exits 0 when something was detected (1 when nothing was, 2 on a usage or runtime
    // error). Without the package the test axis still finds Jest from jest.config.js, so the run
    // exits 0 with a complete envelope in which every axis says its file evidence was incomplete.
    // A crash at load time would print no JSON at all, which the parse below distinguishes.
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.axis).toBe('all');
    expect(parsed.detected).toBe(true);
    for (const axis of AXES) expect(parsed.axes[axis].degraded).toBe(DEGRADED);

    const help = runCopy(script, { args: ['--help'] });
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/Usage: detect-stack\.js/);
  });
});

describe('a scan with glob unavailable', () => {
  test.each(AXES)('the %s axis answers and flags its missing file evidence', axis => {
    const { script } = skillCopy();
    const result = envelope(script, axis, fixtureProject());
    expect(result.axis).toBe(axis);
    expect(result.degraded).toBe(DEGRADED);
  });

  test('the same scan with the package present flags nothing', () => {
    const { script } = skillCopy({ withGlob: true });
    const project = fixtureProject();
    for (const axis of AXES) {
      expect(envelope(script, axis, project, { mode: 'present' }).degraded).toBeUndefined();
    }
  });

  test('a tooling result cached during a degraded scan keeps the flag', () => {
    // detectTooling caches its whole result per project path and key-file mtimes, so a second
    // lookup in the same process is served from the cache. The flag has to be part of the cached
    // value or the replay would read back as a complete scan.
    const { script } = skillCopy();
    const project = fixtureProject();
    const driver = path.join(path.dirname(path.dirname(script)), 'replay.js');
    fs.writeFileSync(
      driver,
      ['const Module = require("module");',
       'const loadOrig = Module._load;',
       'Module._load = function (request) {',
       '  if (request === "glob") {',
       '    const err = new Error("Cannot find module \'glob\'");',
       "    err.code = 'MODULE_NOT_FOUND';",
       '    throw err;',
       '  }',
       '  return loadOrig.apply(this, arguments);',
       '};',
       `const { detect } = require(${JSON.stringify(script)});`,
       `const p = ${JSON.stringify(project)};`,
       "detect('tooling', p)",
       '  .then(first => detect("tooling", p).then(second => ({',
       '    first: first.degraded,',
       '    second: second.degraded',
       '  })))',
       '  .then(value => process.stdout.write(JSON.stringify(value)));'].join('\n')
    );
    const run = spawnSync(process.execPath, [driver], { encoding: 'utf8', timeout: 180000 });
    expect(run.stderr).not.toMatch(/Cannot find module 'glob'/);
    expect(JSON.parse(run.stdout)).toEqual({ first: DEGRADED, second: DEGRADED });
  });

  test('the warning is written once, not per lookup', () => {
    const { script } = skillCopy();
    const run = runCopy(script, { axis: 'all', project: fixtureProject() });
    expect(JSON.parse(run.stdout).axis).toBe('all');
    expect((run.stderr.match(/is not installed/g) || []).length).toBe(1);
  });
});
