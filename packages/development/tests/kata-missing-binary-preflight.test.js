'use strict';

/**
 * TRD-006-TEST (TRD-2026-6995dc96; PRD REQ-001 AC-001-3, REQ-012 AC-012-2/3): a named
 * MISSING_BINARY preflight failure for a kata project, silence about kata for projects that did
 * not select it, and no fallback to beads after selection. PATH is replaced by scratch dirs of
 * stubs only. Scratch under ~/.omp/br-l6sej/, never the system temp directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runPreflight } = require('../lib/toolchain/preflight');

const SCRATCH_ROOT = path.join(os.homedir(), '.omp', 'br-l6sej', 'scratch');
const savedPath = process.env.PATH;
const dirs = [];

function mk(label) {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const d = fs.mkdtempSync(path.join(SCRATCH_ROOT, `${label}-`));
  dirs.push(d);
  return d;
}

/** A stub dir whose `name` binary logs its argv. */
function stubDir(name, body) {
  const dir = mk(`stub-${name}`);
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, name), ['#!/bin/sh', `echo "$*" >> "${log}"`, body, ''].join('\n'), { mode: 0o755 });
  return { dir, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) };
}

const KATA_BODY = [
  'if [ "$1" = "--version" ]; then echo "kata v0.23.0"; exit 0; fi',
  'echo \'{"checks":[{"id":"config.workspace","status":"ok"}]}\''
].join('\n');

function project(toolchainYaml) {
  const projectRoot = mk('proj');
  if (toolchainYaml) {
    fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), toolchainYaml);
  }
  return { projectRoot, ctx: { projectRoot, env: { XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } } };
}

const recordPath = (root, id) => path.join(root, '.ensemble', 'state', 'toolchain', `preflight-${id}.json`);

afterEach(() => {
  process.env.PATH = savedPath;
});
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('kata missing-binary preflight (TRD-006-TEST)', () => {
  test('Failure: kata project with kata absent -> MISSING_BINARY naming kata, no record', async () => {
    process.env.PATH = mk('empty');
    const { projectRoot, ctx } = project('tracker: kata\n');
    const result = await runPreflight({ categories: ['tracker'], runId: 'absent' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MISSING_BINARY');
    expect(result.error.message).toContain('kata');
    expect(result.error.message).toMatch(/PATH/);
    expect(result.error.message).toMatch(/install/i);
    expect(fs.existsSync(recordPath(projectRoot, 'absent'))).toBe(false);
  });

  test('Silence: projects that did not select kata succeed with no kata mention when kata is absent', async () => {
    const br = stubDir('br', 'echo "br 0.1.0"');
    const bv = stubDir('bv', 'echo "bv v0.26.0"');
    process.env.PATH = `${br.dir}${path.delimiter}${bv.dir}`;
    for (const [label, yaml] of [['default', null], ['beads', 'tracker: beads\n']]) {
      const { projectRoot, ctx } = project(yaml);
      const result = await runPreflight({ categories: ['tracker'], runId: `quiet-${label}` }, ctx);
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/kata/i);
      expect(fs.readFileSync(recordPath(projectRoot, `quiet-${label}`), 'utf8')).not.toMatch(/kata/i);
    }
  });

  test('Silence: beads project with no binaries fails naming a beads binary, never kata', async () => {
    process.env.PATH = mk('empty');
    const { ctx } = project('tracker: beads\n');
    const result = await runPreflight({ categories: ['tracker'], runId: 'quiet-none' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error.message).toMatch(/'(br|bv)'/);
    expect(JSON.stringify(result)).not.toMatch(/kata/i);
  });

  test('Disappearing binary: passes with the stub, then MISSING_BINARY after removal, never touching beads', async () => {
    const kata = stubDir('kata', KATA_BODY);
    const br = stubDir('br', 'echo "br 0.1.0"');
    process.env.PATH = `${kata.dir}${path.delimiter}${br.dir}`;
    const { projectRoot, ctx } = project('tracker: kata\n');

    const first = await runPreflight({ categories: ['tracker'], runId: 'gone-1' }, ctx);
    expect(first.ok).toBe(true);
    expect(fs.existsSync(recordPath(projectRoot, 'gone-1'))).toBe(true);
    expect(br.calls()).toEqual([]);

    fs.rmSync(path.join(kata.dir, 'kata'));
    const second = await runPreflight({ categories: ['tracker'], runId: 'gone-2' }, ctx);
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe('MISSING_BINARY');
    expect(second.error.message).toContain('kata');
    expect(second.error.message).not.toMatch(/beads|\bbr\b/i);
    expect(fs.existsSync(recordPath(projectRoot, 'gone-2'))).toBe(false);
    expect(br.calls()).toEqual([]);
  });
});
