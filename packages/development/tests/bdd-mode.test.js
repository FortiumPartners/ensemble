'use strict';

/**
 * Tests for lib/bdd-mode.js: the one place that decides whether the TRD commands use the Reqnroll/BDD
 * path. BDD stays on by default (what the commands did before it was configurable); these are the ways
 * to opt out. Precedence is flag > ENSEMBLE_BDD > TRD `test_approach` > default (on).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const bddMode = require('../lib/bdd-mode');
const { resolveBdd } = bddMode;

const DEFAULT_MESSAGE = 'Test approach: BDD (Reqnroll) [default; opt out with ENSEMBLE_BDD=0, or --no-bdd on create-trd]';

const roots = [];
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdd-mode-'));
  roots.push(dir);
  return dir;
}
function write(root, rel, text) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}
function trdWith(root, testApproach) {
  const stamp = testApproach === undefined ? '' : `test_approach: ${testApproach}\n`;
  return write(root, 'docs/TRD/TRD-2026-aaaaaaaa-x.md', `---\ndocument_id: TRD-2026-aaaaaaaa\nstatus: Draft\n${stamp}---\n\n# TRD\n`);
}

afterAll(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe('the default is unchanged: BDD is on', () => {
  test('with nothing set, it is on, and the message says how to opt out', () => {
    expect(resolveBdd({ env: {} })).toEqual({ enabled: true, source: 'default', message: DEFAULT_MESSAGE });
  });

  test('it does not depend on what the repo contains: a repo with no Reqnroll in it is still on', () => {
    expect(resolveBdd({ env: {}, repoRoot: tmp() })).toMatchObject({ enabled: true, source: 'default' });
  });

  test('there is no repo detection left to get wrong', () => {
    expect(bddMode.detectReqnroll).toBeUndefined();
  });

  test('an unstamped TRD, such as one written before this was configurable, is on', () => {
    const root = tmp();
    expect(resolveBdd({ env: {}, trdPath: trdWith(root) })).toMatchObject({ enabled: true, source: 'default' });
  });
});

describe('opting out', () => {
  test.each([
    ['bdd', true],
    ['no-bdd', false],
  ])('flag %s beats env and the TRD stamp', (flag, enabled) => {
    const trd = trdWith(tmp(), enabled ? 'standard' : 'bdd-reqnroll');
    const env = { ENSEMBLE_BDD: enabled ? 'off' : 'on' };
    expect(resolveBdd({ flag, env, trdPath: trd })).toMatchObject({ enabled, source: 'flag' });
  });

  test.each([
    ['1', true], ['true', true], ['ON', true], [' yes ', true],
    ['0', false], ['False', false], ['off', false], ['NO', false],
  ])('env ENSEMBLE_BDD=%j -> %s, and beats the TRD stamp', (value, enabled) => {
    const trd = trdWith(tmp(), enabled ? 'standard' : 'bdd-reqnroll');
    expect(resolveBdd({ env: { ENSEMBLE_BDD: value }, trdPath: trd })).toMatchObject({ enabled, source: 'env' });
  });

  test.each([
    ['bdd-reqnroll', true],
    ['standard', false],
    ['  BDD-Reqnroll ', true],
    ['STANDARD', false],
  ])('TRD test_approach %j -> %s, with no flag or env needed (implement-trd-beads honours create-trd\'s opt-out)', (stamp, enabled) => {
    const trd = trdWith(tmp(), stamp);
    expect(resolveBdd({ env: {}, trdPath: trd })).toMatchObject({ enabled, source: 'trd', evidence: trd.split(path.sep).join('/') });
  });

  test('reads the stamp from a CRLF TRD (this repo\'s TRDs are often Windows-authored)', () => {
    const trd = write(tmp(), 'docs/TRD/crlf.md', '---\r\ndocument_id: TRD-2026-bbbbbbbb\r\ntest_approach: standard\r\n---\r\n\r\n# TRD\r\n');
    expect(resolveBdd({ env: {}, trdPath: trd })).toMatchObject({ enabled: false, source: 'trd' });
  });
});

describe('bad input falls back to the default rather than silently opting out', () => {
  test('an unrecognised ENSEMBLE_BDD is ignored with a warning', () => {
    const out = resolveBdd({ env: { ENSEMBLE_BDD: 'maybe' } });
    expect(out).toMatchObject({ enabled: true, source: 'default' });
    expect(out.warning).toContain("ENSEMBLE_BDD='maybe'");
  });

  test('an empty ENSEMBLE_BDD is simply unset: no warning', () => {
    const out = resolveBdd({ env: { ENSEMBLE_BDD: '  ' } });
    expect(out).toMatchObject({ enabled: true, source: 'default' });
    expect(out.warning).toBeUndefined();
  });

  test('an unrecognised test_approach falls through to the default, with a warning', () => {
    const out = resolveBdd({ env: {}, trdPath: trdWith(tmp(), 'cucumber') });
    expect(out).toMatchObject({ enabled: true, source: 'default' });
    expect(out.warning).toContain("test_approach 'cucumber'");
  });

  test('an unreadable TRD path falls through to the default', () => {
    expect(resolveBdd({ env: {}, trdPath: path.join(tmp(), 'nope.md') })).toMatchObject({ enabled: true, source: 'default' });
  });
});

describe('the stamp is found wherever the TRD puts its frontmatter', () => {
  const frontmatter = (stamp) => `---\ndocument_id: TRD-2026-cccccccc\nstatus: Draft\n${stamp === undefined ? '' : `test_approach: ${stamp}\n`}---\n`;

  // docs/TRD/TRD-2026-021-tiered-model-aliases.md puts an H1 above its frontmatter, as does any TRD titled
  // before its metadata. A reader that insists on `---` as line 1 sees no frontmatter there and silently runs BDD.
  test.each([
    ['an H1 above it', `# TRD-2026-021: Tiered Model Aliases\n\n${frontmatter('standard')}\n## Body\n`],
    ['an HTML comment above it', `<!-- generated by hand -->\n\n${frontmatter('standard')}\n# TRD\n`],
    ['a multi-line HTML comment and an H1 above it', `<!--\n  notes\n-->\n# TRD\n\n${frontmatter('standard')}\n## Body\n`],
    ['a byte-order mark before it', `\uFEFF${frontmatter('standard')}\n# TRD\n`],
    ['an H1 above it and CRLF line endings', `# TRD\r\n\r\n${frontmatter('standard').replace(/\n/g, '\r\n')}\r\n## Body\r\n`],
  ])('a stamp is honoured with %s', (_layout, text) => {
    const trd = write(tmp(), 'docs/TRD/layout.md', text);
    expect(resolveBdd({ env: {}, trdPath: trd })).toMatchObject({ enabled: false, source: 'trd' });
  });

  test('an unrecognised stamp is still reported when the frontmatter sits under an H1', () => {
    const trd = write(tmp(), 'docs/TRD/layout.md', `# TRD\n\n${frontmatter('cucumber')}\n## Body\n`);
    const out = resolveBdd({ env: {}, trdPath: trd });
    expect(out).toMatchObject({ enabled: true, source: 'default' });
    expect(out.warning).toContain("test_approach 'cucumber'");
  });

  test('a TRD with its frontmatter under an H1 and no stamp is on, as before', () => {
    const trd = write(tmp(), 'docs/TRD/layout.md', `# TRD\n\n${frontmatter()}\n## Body\n`);
    expect(resolveBdd({ env: {}, trdPath: trd })).toMatchObject({ enabled: true, source: 'default' });
  });

  test('a test_approach line in the body is not a stamp', () => {
    const trd = write(tmp(), 'docs/TRD/body.md', `${frontmatter()}\n# TRD\n\n\`\`\`yaml\ntest_approach: standard\n\`\`\`\n`);
    expect(resolveBdd({ env: {}, trdPath: trd })).toMatchObject({ enabled: true, source: 'default' });
  });
});

describe('every warning is surfaced, whichever source decides', () => {
  const BAD_ENV = "ENSEMBLE_BDD='maybe' is not one of 1/true/on/yes or 0/false/off/no; ignored";

  test('an unrecognised ENSEMBLE_BDD is reported when the TRD stamp decides', () => {
    const out = resolveBdd({ env: { ENSEMBLE_BDD: 'maybe' }, trdPath: trdWith(tmp(), 'standard') });
    expect(out).toMatchObject({ enabled: false, source: 'trd', warning: BAD_ENV });
    expect(out.message).toBe(`Warning: ${BAD_ENV}\nTest approach: standard [trd]`);
  });

  test('an unrecognised ENSEMBLE_BDD is reported when a flag decides', () => {
    const out = resolveBdd({ flag: 'no-bdd', env: { ENSEMBLE_BDD: 'maybe' } });
    expect(out).toMatchObject({ enabled: false, source: 'flag', warning: BAD_ENV });
    expect(out.message).toBe(`Warning: ${BAD_ENV}\nTest approach: standard [flag]`);
  });

  test('an unrecognised ENSEMBLE_BDD and an unrecognised test_approach are both reported, each on its own line', () => {
    const trd = trdWith(tmp(), 'cucumber');
    const out = resolveBdd({ env: { ENSEMBLE_BDD: 'maybe' }, trdPath: trd });
    const stampWarning = `test_approach 'cucumber' in ${trd.split(path.sep).join('/')} is not 'bdd-reqnroll' or 'standard'; ignored`;
    expect(out).toMatchObject({ enabled: true, source: 'default', warning: `${BAD_ENV}\n${stampWarning}` });
    expect(out.message).toBe(`Warning: ${BAD_ENV}\nWarning: ${stampWarning}\n${DEFAULT_MESSAGE}`);
  });

  test('an unrecognised test_approach is reported too when a flag or ENSEMBLE_BDD decides over it', () => {
    const trd = trdWith(tmp(), 'cucumber');
    const stampWarning = `test_approach 'cucumber' in ${trd.split(path.sep).join('/')} is not 'bdd-reqnroll' or 'standard'; ignored`;
    expect(resolveBdd({ flag: 'bdd', env: {}, trdPath: trd })).toMatchObject({ enabled: true, source: 'flag', warning: stampWarning });
    expect(resolveBdd({ env: { ENSEMBLE_BDD: '0' }, trdPath: trd })).toMatchObject({ enabled: false, source: 'env', warning: stampWarning });
  });

  test('a recognised ENSEMBLE_BDD beside a stamp produces no warning', () => {
    const out = resolveBdd({ env: { ENSEMBLE_BDD: '0' }, trdPath: trdWith(tmp(), 'bdd-reqnroll') });
    expect(out).toMatchObject({ enabled: false, source: 'env' });
    expect(out.warning).toBeUndefined();
  });
});

describe('an unreadable TRD is never silent', () => {
  test('the default still applies, with a warning that names the path and the reason', () => {
    const missing = path.join(tmp(), 'nope.md');
    const out = resolveBdd({ env: {}, trdPath: missing });
    expect(out).toMatchObject({
      enabled: true,
      source: 'default',
      warning: `cannot read ${missing.split(path.sep).join('/')} (ENOENT); its test_approach was not consulted`,
    });
    expect(out.message).toBe(`Warning: ${out.warning}\n${DEFAULT_MESSAGE}`);
  });

  test('a directory is not a TRD either', () => {
    const dir = tmp();
    expect(resolveBdd({ env: {}, trdPath: dir }).warning).toContain(`cannot read ${dir.split(path.sep).join('/')} (EISDIR)`);
  });
});

describe('message', () => {
  test('is the one line the commands print: the warning first, then the approach and its source', () => {
    expect(resolveBdd({ flag: 'bdd', env: {} }).message).toBe('Test approach: BDD (Reqnroll) [flag]');
    expect(resolveBdd({ flag: 'no-bdd', env: {} }).message).toBe('Test approach: standard [flag]');
    expect(resolveBdd({ env: { ENSEMBLE_BDD: '0' } }).message).toBe('Test approach: standard [env]');
    expect(resolveBdd({ env: { ENSEMBLE_BDD: 'maybe' } }).message).toBe(
      `Warning: ENSEMBLE_BDD='maybe' is not one of 1/true/on/yes or 0/false/off/no; ignored\n${DEFAULT_MESSAGE}`
    );
  });
});
