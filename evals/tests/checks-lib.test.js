'use strict';

/** evals/checks/lib.js: the shared helpers of the skill check scripts (fs and path only), including their behaviour on hostile input. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../checks/lib');

const SCRATCH = path.join(os.homedir(), '.omp', 'trd-skills-eval', 'jest');
let root;
beforeAll(() => { fs.mkdirSync(SCRATCH, { recursive: true }); root = fs.mkdtempSync(path.join(SCRATCH, 'lib-')); });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const runWith = (checks, args) => { const lines = []; const code = lib.run(checks, ['node', 'x.js', ...args], (l) => lines.push(l)); return { code, lines }; };
const timed = (fn) => { const t = Date.now(); const r = fn(); return { r, ms: Date.now() - t }; };

describe('run', () => {
  const checks = {
    ok: () => 'fine',
    bad: () => lib.fail('nope \u001b[31m'),
    boom: () => { throw new Error('exploded'); },
    args: (o) => `${lib.need(o, 'a')}`,
  };
  test('PASS prints and returns 0; FAIL prints the reason (control characters stripped) and returns 1', () => {
    expect(runWith(checks, ['ok'])).toEqual({ code: 0, lines: ['PASS: fine'] });
    expect(runWith(checks, ['bad'])).toEqual({ code: 1, lines: ['FAIL: nope ?[31m'] });
  });
  test('fails closed: an exception, an unknown name, a prototype name, a missing name, a missing argument', () => {
    expect(runWith(checks, ['boom'])).toEqual({ code: 1, lines: ['FAIL: check threw: exploded'] });
    expect(runWith(checks, ['nope']).code).toBe(1);
    for (const n of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(runWith(checks, [n]).lines[0]).toMatch(/^FAIL: unknown check/);
    expect(runWith(checks, []).code).toBe(1);
    expect(runWith(checks, ['args']).lines[0]).toBe('FAIL: missing --a');
    expect(runWith(checks, ['args', '--a', 'v'])).toEqual({ code: 0, lines: ['PASS: v'] });
    expect(runWith(checks, ['args', 'a', 'v']).lines[0]).toMatch(/^FAIL: bad arguments/);
  });
});

describe('files', () => {
  test('readText: null when absent, refuses a symlink, a directory and a file over 1 MiB', () => {
    const f = path.join(root, 'a.txt');
    fs.writeFileSync(f, 'hi');
    expect(lib.readText(f)).toBe('hi');
    expect(lib.readText(path.join(root, 'missing'))).toBeNull();
    fs.symlinkSync(f, path.join(root, 'link.txt'));
    expect(() => lib.readText(path.join(root, 'link.txt'))).toThrow(/symlinks are not followed/);
    expect(() => lib.readText(root)).toThrow(/not a regular file/);
    fs.writeFileSync(path.join(root, 'big'), Buffer.alloc(lib.MAX_BYTES + 1));
    expect(() => lib.readText(path.join(root, 'big'))).toThrow(/larger than/);
    expect(() => lib.readRequired(path.join(root, 'missing'), 'x.md')).toThrow(/x\.md is missing/);
  });
  test('walk: skips .git, does not enter symlinked directories, caps the count', () => {
    const w = path.join(root, 'w');
    fs.mkdirSync(path.join(w, '.git'), { recursive: true });
    fs.mkdirSync(path.join(w, 'd'));
    fs.writeFileSync(path.join(w, '.git/x'), '');
    fs.writeFileSync(path.join(w, 'd/y'), '');
    fs.symlinkSync(root, path.join(w, 'out'));
    expect(lib.walk(w).sort()).toEqual(['d/y', 'out']);
    const many = path.join(root, 'many');
    fs.mkdirSync(many);
    for (let i = 0; i <= lib.MAX_FILES; i += 1) fs.writeFileSync(path.join(many, `f${i}`), '');
    expect(() => lib.walk(many)).toThrow(/more than/);
  });
  test('listFiles filters by name and treats a missing directory as empty', () => {
    expect(lib.listFiles(path.join(root, 'none'), /./)).toEqual([]);
    expect(lib.listFiles(path.join(root, 'd-none'), /\.md$/)).toEqual([]);
  });
});

describe('markdown', () => {
  const DOC = '---\nDocument ID: "PRD-1"\nversion: 1.0.0\n---\n# T\n## Changelog\n- 1.0.0\n### Sub\n- x\n## Other\n- y\n### REQ-001: a\n- AC-001-1: Given a, when b, then c\n';
  test('frontmatter, headings, section, reqSections, acBlocks, isGwt', () => {
    expect(lib.frontmatter(DOC)).toEqual({ document_id: 'PRD-1', version: '1.0.0' });
    expect(lib.frontmatter('no front matter')).toEqual({});
    expect(lib.headings(DOC).map((h) => `${h.level}:${h.text}`)).toEqual(['1:T', '2:Changelog', '3:Sub', '2:Other', '3:REQ-001: a']);
    expect(lib.section(DOC, 'changelog').body).toContain('- x');
    expect(lib.section(DOC, 'changelog').body).not.toContain('- y');
    expect(lib.section(DOC, /^Changelog/, { toEnd: true }).body).toContain('- y');
    expect(lib.section(DOC, 'missing')).toBeNull();
    expect(lib.reqSections(DOC).map((r) => r.id)).toEqual(['REQ-001']);
    expect(lib.acBlocks(lib.reqSections(DOC)[0].body)).toEqual(['- AC-001-1: Given a, when b, then c']);
    expect(lib.isGwt('Given a, when b, then c')).toBe(true);
    expect(lib.isGwt('GIVEN a WHEN b THEN c')).toBe(true);
    for (const s of ['Given a, then c', 'when b then c given a', 'given when', 'forgiven when then', 'Given a, when b', '']) {
      expect(lib.isGwt(s)).toBe(/\bgiven\b[\s\S]+\bwhen\b[\s\S]+\bthen\b/i.test(s));
    }
  });
  test('a 1 MiB hostile file is processed in bounded time by every helper', () => {
    const n = 1024 * 1024;
    const inputs = [
      `---\nk:${' '.repeat(n / 2)}x\n---`,
      `---\n${'a: b\n'.repeat(n / 5)}`,
      `#${' '.repeat(n)}`,
      `### REQ-001 x\n- AC-001-1${' '.repeat(n / 2)}given when`,
      `### REQ-001 x\n${'- AC-001-1: given\n  when\n'.repeat(n / 26)}`,
      `${'given when '.repeat(n / 11)}`,
      `## Changelog\n${'1'.repeat(n)}`,
      `${'#'.repeat(n / 2)}${'\n'.repeat(n / 2)}`,
    ];
    for (const text of inputs) {
      const { ms } = timed(() => {
        lib.frontmatter(text); lib.headings(text); lib.section(text, /^Changelog/); lib.reqSections(text);
        lib.acBlocks(text); lib.isGwt(text);
      });
      expect(ms).toBeLessThan(3000);
    }
  });
});
