'use strict';

/**
 * br-0wx (items c, d, e): in a repo that tracks .beads/issues.jsonl
 *  - Scaffold's br writes dirty the tracked export, and the dirty-tree gates then HALT the
 *    command on its own output (d);
 *  - the checkpoint / checkbox-sync commits and the closing reminders did not say what to
 *    stage, and the reminders told the user to `git add .beads/`, which sweeps in whatever
 *    the shared db exported (c);
 *  - none of this was documented (e).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { readDevelopmentSkill } = require('./helpers/skill-workflow');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// implement-trd-beads and beads-build are skill-backed: the prompt is the skill (SKILL.md +
// references/), the YAML only a manifest.
const skillProse = (skill) => readDevelopmentSkill(skill).prompt;
const lines = (text) => text.split('\n');

const COMMANDS = {
  // the dirty-tree status capture lives in the on-demand reference skill, not the command body
  'implement-trd-beads.yaml':
    skillProse('ensemble-implement-trd-beads') + '\n' + read('skills/implement-trd-beads-reference/SKILL.md'),
  'beads-build.yaml': skillProse('ensemble-beads-build'),
  'beads-build-wave.yaml': read('commands/beads-build-wave.yaml'),
};
const GATES = ['implement-trd-beads.yaml', 'beads-build.yaml', 'beads-build-wave.yaml'];
const STAGERS = ['implement-trd-beads.yaml', 'beads-build.yaml'];

describe('dirty-tree gates ignore br\'s own state under .beads/', () => {
  test.each(GATES)('%s reads the tree through workflow.status and excludes .beads', (file) => {
    // the status reading: a HALT line in beads-build-wave.yaml, a WORKTREE_STATUS capture in the
    // other two (their clean-tree gate moved after resume detection and decides on that capture)
    const gate = lines(COMMANDS[file]).find((l) => l.includes('run workflow.status'));
    expect(gate).toBeDefined();
    expect(gate).toMatch(/\.beads\//);
  });

  test('the documented filter behaves: a br export write is ignored, a real change is not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-gate-'));
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 't@t');
      git('config', 'user.name', 't');
      fs.mkdirSync(path.join(dir, '.beads'));
      fs.writeFileSync(path.join(dir, '.beads', 'issues.jsonl'), '{"id":"a"}\n');
      git('add', '-A');
      git('commit', '-q', '-m', 'base');

      fs.appendFileSync(path.join(dir, '.beads', 'issues.jsonl'), '{"id":"b"}\n'); // what Scaffold's br writes do
      // workflow.status (plain-git: status --porcelain) lists every changed path; the commands drop
      // the paths under .beads/ from that list
      const outsideBeads = () =>
        git('status', '--porcelain')
          .split('\n')
          .filter((l) => l && !l.slice(3).startsWith('.beads/'));
      expect(git('status', '--porcelain')).not.toBe(''); // the unfiltered gate halts on its own output
      expect(outsideBeads()).toEqual([]);

      fs.writeFileSync(path.join(dir, 'real.txt'), 'x'); // a genuine uncommitted change still halts
      expect(outsideBeads().join('\n')).toContain('real.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('commits and reminders stage the TRD\'s beads through beads-stage', () => {
  test.each(STAGERS)('%s: the phase checkpoint stages beads before committing', (file) => {
    const line = lines(COMMANDS[file]).find((l) => /checkpoint \(tests pass/.test(l) && l.includes('run workflow.commit'));
    expect(line).toBeDefined();
    expect(line.indexOf('beads-stage')).toBeGreaterThan(-1);
    expect(line.indexOf('beads-stage')).toBeLessThan(line.indexOf('run workflow.commit'));
  });

  test.each(STAGERS)('%s: the checkbox-sync commit stages the TRD file and the beads', (file) => {
    const line = lines(COMMANDS[file]).find((l) => l.includes('run workflow.commit') && l.includes('sync checkboxes'));
    expect(line).toBeDefined();
    expect(line).toMatch(/[Ss]tage <(TRD_FILE_PATH|TRD_PATH)>/);
    expect(line.indexOf('beads-stage')).toBeGreaterThan(-1);
    expect(line.indexOf('beads-stage')).toBeLessThan(line.indexOf('run workflow.commit'));
  });

  test.each(STAGERS)('%s: the closing reminder uses beads-stage, not git add .beads/', (file) => {
    const line = lines(COMMANDS[file]).find((l) => l.includes('Remind user:') && /br sync --flush-only|run tracker\.sync/.test(l));
    expect(line).toBeDefined();
    expect(line).toMatch(/beads-stage .*&& node \\?"\$TOOLCHAIN_CLI\\?" run workflow\.commit .*chore: final beads sync/);
    expect(line).not.toMatch(/git add \.beads/);
  });

  test.each(STAGERS)('%s never tells anyone to `git add .beads/` or commit with -a', (file) => {
    expect(COMMANDS[file]).not.toMatch(/git add \.beads/);
    expect(COMMANDS[file]).not.toMatch(/git commit -a/);
  });

  test('beads-build works out what to stage from the root epic or the label', () => {
    expect(COMMANDS['beads-build.yaml']).toMatch(/STAGE_SCOPE/);
    expect(COMMANDS['beads-build.yaml']).toMatch(/--match "\[trd:<slug>"/);
    expect(COMMANDS['beads-build.yaml']).toMatch(/--label <LABEL>/);
  });

  test('the stacked-PR guide gives the same advice', () => {
    const guide = read('../../docs/guides/stacked-prs.md');
    expect(guide).not.toMatch(/git add \.beads/);
    expect(guide).toMatch(/beads-stage/);
  });
});

describe('the tracked-export guide', () => {
  const guide = read('../../docs/guides/beads-tracked-export.md');

  test('explains the shared database and the helper', () => {
    expect(guide).toMatch(/shared/i);
    expect(guide).toMatch(/beads-stage --match/);
    expect(guide).toMatch(/--check/);
    expect(guide).toMatch(/\.beads/);
  });

  test.each(STAGERS)('%s points at it', (file) => {
    expect(COMMANDS[file]).toContain('docs/guides/beads-tracked-export.md');
  });
});
