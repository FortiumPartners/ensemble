'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CEILINGS, countWords, collectSizes, checkBudgets, buildBaseline } = require('../lib/prompt-budget');

const words = (n) => Array(n).fill('w').join(' ');
const cmd = (words_) => ({ kind: 'command', words: words_ });

describe('checkBudgets', () => {
  test('under-ceiling file passes', () => {
    const r = checkBudgets({ 'packages/a/commands/x.yaml': cmd(CEILINGS.command) }, {});
    expect(r).toEqual({ failures: [], advisories: [] });
  });

  test('new over-ceiling file fails naming file, size, limit', () => {
    const r = checkBudgets({ 'packages/a/commands/x.yaml': cmd(CEILINGS.command + 1) }, {});
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('packages/a/commands/x.yaml');
    expect(r.failures[0]).toContain(String(CEILINGS.command + 1));
    expect(r.failures[0]).toContain(String(CEILINGS.command));
  });

  test('ceilings differ per kind', () => {
    const sizes = {
      'packages/a/agents/x.yaml': { kind: 'agent', words: CEILINGS.agent + 1 },
      'packages/a/skills/s/SKILL.md': { kind: 'skill', words: CEILINGS.skill + 1 },
    };
    expect(checkBudgets(sizes, {}).failures).toHaveLength(2);
  });

  test('baselined file growing fails', () => {
    const f = 'packages/a/commands/x.yaml';
    const r = checkBudgets({ [f]: cmd(3001) }, { [f]: 3000 });
    expect(r.failures[0]).toContain('3001');
    expect(r.failures[0]).toContain('3000');
  });

  test('baselined file at baseline passes silently', () => {
    const f = 'packages/a/commands/x.yaml';
    expect(checkBudgets({ [f]: cmd(3000) }, { [f]: 3000 })).toEqual({ failures: [], advisories: [] });
  });

  test('baselined file shrinking passes with advisory', () => {
    const f = 'packages/a/commands/x.yaml';
    const r = checkBudgets({ [f]: cmd(2900) }, { [f]: 3000 });
    expect(r.failures).toEqual([]);
    expect(r.advisories[0]).toContain(f);
    expect(r.advisories[0]).toContain('--update-prompt-baseline');
  });

  test('a skill measured with its references says so in the failure and the advisory', () => {
    const f = 'packages/a/skills/s/SKILL.md';
    const skill = (words_, references) => ({ kind: 'skill', words: words_, references });
    expect(checkBudgets({ [f]: skill(3001, 7) }, { [f]: 3000 }).failures[0]).toContain('3001 words (SKILL.md plus 7 reference files)');
    expect(checkBudgets({ [f]: skill(2900, 1) }, { [f]: 3000 }).advisories[0]).toContain('2900 words (SKILL.md plus 1 reference file)');
    expect(checkBudgets({ [f]: skill(3001, undefined) }, { [f]: 3000 }).failures[0]).not.toContain('SKILL.md plus');
  });
});

describe('buildBaseline', () => {
  test('records only over-ceiling files at current size', () => {
    const sizes = {
      'packages/a/commands/big.yaml': cmd(4000),
      'packages/a/commands/small.yaml': cmd(10),
    };
    expect(buildBaseline(sizes)).toEqual({ 'packages/a/commands/big.yaml': 4000 });
  });
});

describe('collectSizes', () => {
  let root, pkgs;
  const put = (rel, content) => {
    const full = path.join(pkgs, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-'));
    pkgs = path.join(root, 'packages');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('counts source files and classifies them', () => {
    put('dev/commands/c.yaml', words(5));
    put('dev/agents/a.yaml', words(6));
    put('dev/skills/s/SKILL.md', words(7));
    put('dev/commands/c.md', words(99));
    expect(collectSizes(pkgs)).toEqual({
      'packages/dev/commands/c.yaml': { kind: 'command', words: 5 },
      'packages/dev/agents/a.yaml': { kind: 'agent', words: 6 },
      'packages/dev/skills/s/SKILL.md': { kind: 'skill', words: 7 },
    });
  });

  test('reference directories and node_modules are excluded', () => {
    for (const p of ['pi', 'codex', 'opencode']) {
      put(`${p}/commands/c.yaml`, words(9000));
      put(`${p}/skills/s/SKILL.md`, words(9000));
    }
    put('dev/node_modules/x/SKILL.md', words(9000));
    put('dev/commands/ok.yaml', words(3));
    expect(Object.keys(collectSizes(pkgs))).toEqual(['packages/dev/commands/ok.yaml']);
  });

  test('symlinked mirrors are not double counted', () => {
    put('dev/skills/s/SKILL.md', words(4));
    fs.mkdirSync(path.join(pkgs, 'full'));
    fs.symlinkSync(path.join(pkgs, 'dev', 'skills'), path.join(pkgs, 'full', 'skills'));
    expect(Object.keys(collectSizes(pkgs))).toEqual(['packages/dev/skills/s/SKILL.md']);
  });

  describe('a skill that backs a command manifest is measured with its references', () => {
    const KEY = 'packages/dev/skills/demo/SKILL.md';
    const manifest = (skill) => `metadata:\n  name: c\nskill: ${skill}\n`;

    test('its size is the SKILL.md plus every references/*.md, and the entry says how many', () => {
      put('dev/commands/c.yaml', manifest('demo'));
      put('dev/skills/demo/SKILL.md', words(7));
      put('dev/skills/demo/references/a.md', words(3));
      put('dev/skills/demo/references/b.md', words(4));
      expect(collectSizes(pkgs)[KEY]).toEqual({ kind: 'skill', words: 14, references: 2 });
    });

    test('splitting the prompt into references leaves the measured size unchanged', () => {
      put('dev/commands/c.yaml', manifest('demo'));
      put('dev/skills/demo/SKILL.md', words(20));
      const whole = collectSizes(pkgs)[KEY].words;

      put('dev/skills/demo/SKILL.md', words(12));
      put('dev/skills/demo/references/moved.md', words(8));
      expect(collectSizes(pkgs)[KEY].words).toBe(whole);
    });

    test('the ratchet still binds a split prompt: it fails once the total grows past its baseline', () => {
      put('dev/commands/c.yaml', manifest('demo'));
      put('dev/skills/demo/SKILL.md', words(12));
      put('dev/skills/demo/references/moved.md', words(8));
      const baseline = { [KEY]: 20 };
      expect(checkBudgets(collectSizes(pkgs), baseline)).toEqual({ failures: [], advisories: [] });

      put('dev/skills/demo/references/moved.md', words(9));
      const { failures } = checkBudgets(collectSizes(pkgs), baseline);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('21 words (SKILL.md plus 1 reference file) exceeds its baseline of 20');
    });

    test('the baseline built from the measurement is that total', () => {
      put('dev/commands/c.yaml', manifest('demo'));
      put('dev/skills/demo/SKILL.md', words(12));
      put('dev/skills/demo/references/moved.md', words(8));
      expect(buildBaseline(collectSizes(pkgs), { command: 100, agent: 100, skill: 10 })).toEqual({ [KEY]: 20 });
    });

    test('a skill named by several manifests is counted once', () => {
      put('dev/commands/one.yaml', manifest('demo'));
      put('dev/commands/two.yaml', manifest('demo'));
      put('dev/skills/demo/SKILL.md', words(7));
      put('dev/skills/demo/references/a.md', words(3));
      expect(collectSizes(pkgs)[KEY].words).toBe(10);
    });

    test('only .md files directly inside references/ count', () => {
      put('dev/commands/c.yaml', manifest('demo'));
      put('dev/skills/demo/SKILL.md', words(7));
      put('dev/skills/demo/references/a.md', words(3));
      put('dev/skills/demo/references/notes.txt', words(50));
      put('dev/skills/demo/references/deeper/b.md', words(60));
      put('dev/skills/demo/other/c.md', words(70));
      expect(collectSizes(pkgs)[KEY]).toEqual({ kind: 'skill', words: 10, references: 1 });
    });

    test('a skill that backs no command is still measured by its SKILL.md alone', () => {
      put('dev/commands/c.yaml', manifest('demo'));
      put('dev/skills/demo/SKILL.md', words(7));
      put('dev/skills/plain/SKILL.md', words(4));
      put('dev/skills/plain/references/a.md', words(30));
      expect(collectSizes(pkgs)['packages/dev/skills/plain/SKILL.md']).toEqual({ kind: 'skill', words: 4 });
    });

    test('a manifest does not borrow a skill of the same name from another package', () => {
      put('dev/commands/c.yaml', manifest('demo'));
      put('other/skills/demo/SKILL.md', words(7));
      put('other/skills/demo/references/a.md', words(30));
      expect(collectSizes(pkgs)['packages/other/skills/demo/SKILL.md']).toEqual({ kind: 'skill', words: 7 });
    });

    test('a manifest that is not valid YAML, or names a skill that does not exist, does not stop the measurement', () => {
      put('dev/commands/broken.yaml', 'metadata: [unclosed\n');
      put('dev/commands/missing.yaml', manifest('nope'));
      put('dev/commands/bad-name.yaml', manifest('../escape'));
      put('dev/skills/demo/SKILL.md', words(7));
      expect(Object.keys(collectSizes(pkgs)).sort()).toEqual([
        'packages/dev/commands/bad-name.yaml',
        'packages/dev/commands/broken.yaml',
        'packages/dev/commands/missing.yaml',
        'packages/dev/skills/demo/SKILL.md',
      ]);
    });
  });
});

test('countWords matches wc -w semantics', () => {
  expect(countWords('a  b\n\tc ')).toBe(3);
  expect(countWords('')).toBe(0);
});
