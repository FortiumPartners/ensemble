'use strict';

/**
 * TRD-026 (br-199gw, Implementation AC 3): `explain` reports, for the work-graph category, which
 * capabilities the resolved adapter answers natively and which are reached by fallback. `resolve`
 * output is unchanged.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { explain, resolve, main } = require('../lib/toolchain-cli');

const tempDirs = [];
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function projectWith(tracker) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-coverage-'));
  tempDirs.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, '.ensemble'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.ensemble', 'toolchain.yaml'), `tracker: ${tracker}\n`);
  return { projectRoot, env: { PATH: process.env.PATH, XDG_CONFIG_HOME: path.join(projectRoot, 'xdg') } };
}

function captureStdout(fn) {
  const orig = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    return { returned: fn(), captured };
  } finally {
    process.stdout.write = orig;
  }
}

describe('explain: work-graph coverage', () => {
  test('tracker kata: every capability native (module-served)', () => {
    const result = explain(projectWith('kata'));
    expect(result.ok).toBe(true);
    expect(result.data['work-graph'].adapter).toBe('kata');
    expect(result.data['work-graph'].capabilities).toEqual({
      'work-graph.ready': 'native',
      'work-graph.plan': 'native',
      'work-graph.graph-health': 'native'
    });
  });

  test('tracker beads: every work-graph capability is native', () => {
    const result = explain(projectWith('beads'));
    expect(result.data['work-graph'].capabilities).toEqual({
      'work-graph.ready': 'native',
      'work-graph.plan': 'native',
      'work-graph.graph-health': 'native'
    });
  });

  test('resolve output carries no capabilities (shape unchanged)', () => {
    const result = resolve(projectWith('kata'));
    expect(result.data['work-graph'].capabilities).toBeUndefined();
    expect(Object.keys(result.data['work-graph']).sort()).toEqual(['adapter', 'autoVia', 'source']);
  });

  test('human-readable explain shows per-capability native/fallback for work-graph', () => {
    const ctx = projectWith('kata');
    const { captured, returned } = captureStdout(() => main(['explain'], ctx));
    expect(returned).toBe(0);
    expect(captured).toMatch(/work-graph\.ready\s*:?\s*native/);
    expect(captured).toMatch(/work-graph\.plan\s*:?\s*native/);
    expect(captured).toMatch(/work-graph\.graph-health\s*:?\s*native/);
  });
});
