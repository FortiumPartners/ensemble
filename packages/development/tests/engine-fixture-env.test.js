/**
 * The environment a fixture hands a child process: what the child may reach, and what it may not.
 * A fixture that opened up a whole host directory would let a real `git-town`, `br` or `kata` into
 * a scenario, and the scenario would then pass or fail on this host instead of on the code.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { makeRepo } = require('./helpers/engine-repo');

describe('the fixture environment', () => {
  test('the PATH holds only the fixture bin directory and the allowed tools', () => {
    const fx = makeRepo({ files: { 'README.md': 'fixture\n' } });
    const entries = fx.env.PATH.split(path.delimiter);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toBe(fx.binDir);
    expect(entries).not.toContain(path.dirname(process.execPath));
  });

  test('the tools directory holds the allowed tools and no real tracker', () => {
    const fx = makeRepo({ files: { 'README.md': 'fixture\n' } });
    const toolsDir = fx.env.PATH.split(path.delimiter)[1];
    const names = fs.readdirSync(toolsDir);

    expect(names).toEqual(expect.arrayContaining(['git', 'node']));
    expect(names).not.toContain('git-town');
    expect(names).not.toContain('br');
    expect(names).not.toContain('kata');
  });

  test('node still resolves inside the fixture environment', () => {
    const fx = makeRepo({ files: { 'README.md': 'fixture\n' } });

    const out = execFileSync('node', ['--version'], { encoding: 'utf8', env: fx.env });

    expect(out.trim()).toMatch(/^v\d+/);
  });
});
