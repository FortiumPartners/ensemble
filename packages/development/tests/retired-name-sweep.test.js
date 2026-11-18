/**
 * TRD-023-TEST: no source manifest or generated artifact names the retired command.
 *
 * AC-009-2: `implement-trd-beads` is absent from every command, agent and skill source manifest
 * and every generated mirror (packages/full, pi, codex, opencode, generated .md beside YAML).
 *
 * Allowed occurrences:
 *   (a) the ensemble-trd dispatcher skill and its generated mirrors, which name the retired
 *       command literally on purpose (AC-009-3) and must also name the replacement;
 *   (b) historical material: CHANGELOG.md, docs/, evals, .beads, tests and test fixtures.
 *
 * The scanner takes a root directory so the test can prove it is not vacuous by scanning a
 * mutated scratch copy (under ~/.omp, never /tmp). RETIRED_SWEEP_ROOT points the real-tree
 * assertions at another root, which is how the RED run is demonstrated.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCAN_ROOT = process.env.RETIRED_SWEEP_ROOT || REPO_ROOT;
const RETIRED = 'implement-trd-beads';
const REPLACEMENT = 'implement-trd-tasks';

const SCAN_DIRS = ['packages']; // commands/agents/skills sources plus full/pi/codex/opencode mirrors
const SKIP_DIRS = new Set(['node_modules', '.git']);

const toPosix = (p) => p.split(path.sep).join('/');

/** Historical / archival / test material that the sweep must not touch. */
function isExcluded(rel) {
  const p = toPosix(rel);
  const parts = p.split('/');
  const base = parts[parts.length - 1];
  if (base === 'CHANGELOG.md') return true;
  if (/^(docs|evals|\.beads)\//.test(p)) return true;
  // package-level tests and fixtures
  if (parts.includes('tests') || parts.includes('fixtures') || parts.includes('__tests__')) return true;
  return false;
}

/** The dispatcher skill and its generated mirrors may name the retired command by design. */
function isDispatcherAllowance(rel) {
  const p = toPosix(rel);
  return /(^|\/)skills\/(commands\/)?ensemble-trd\/SKILL\.md$/.test(p);
}

function walk(root, relDir, out) {
  const abs = path.join(root, relDir);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = path.join(relDir, e.name);
    out.push({ rel, isDir: e.isDirectory() });
    if (e.isDirectory()) walk(root, rel, out);
  }
}

/** Pure check for one entry; returns offender reasons. */
function checkEntry(rel, isDir, readContent) {
  if (isExcluded(rel)) return [];
  const reasons = [];
  if (toPosix(rel).split('/').some((seg) => seg.includes(RETIRED))) reasons.push('named');
  if (!isDir && !isDispatcherAllowance(rel)) {
    let content = '';
    try {
      content = readContent(rel);
    } catch {
      /* unreadable/binary: skip */
    }
    if (content.includes(RETIRED)) reasons.push('content');
  }
  return reasons;
}

function scan(root) {
  const entries = [];
  for (const d of SCAN_DIRS) walk(root, d, entries);
  const offenders = [];
  const allowed = [];
  for (const { rel, isDir } of entries) {
    const reasons = checkEntry(rel, isDir, (r) => fs.readFileSync(path.join(root, r), 'utf8'));
    if (reasons.length) offenders.push({ file: toPosix(rel), reasons });
    else if (!isDir && !isExcluded(rel) && isDispatcherAllowance(rel)) {
      const c = fs.readFileSync(path.join(root, rel), 'utf8');
      if (c.includes(RETIRED)) allowed.push(toPosix(rel));
    }
  }
  return { offenders, allowed };
}

describe('TRD-023-TEST retired command name sweep', () => {
  describe('happy path: swept tree', () => {
    const result = scan(SCAN_ROOT);

    test('zero offenders in commands, agents, skills and generated mirrors', () => {
      expect(result.offenders).toEqual([]);
    });

    test('no file or directory is named with the retired name', () => {
      const entries = [];
      for (const d of SCAN_DIRS) walk(SCAN_ROOT, d, entries);
      const named = entries.filter((e) => !isExcluded(e.rel) && e.rel.includes(RETIRED)).map((e) => e.rel);
      expect(named).toEqual([]);
    });

    test('the only allowed occurrences are the ensemble-trd dispatcher skill and its mirrors', () => {
      expect(result.allowed.length).toBeGreaterThanOrEqual(1);
      for (const f of result.allowed) {
        expect(f).toMatch(/skills\/(commands\/)?ensemble-trd\/SKILL\.md$/);
      }
      // source plus the generated mirrors that exist
      expect(result.allowed).toContain('packages/development/skills/ensemble-trd/SKILL.md');
    });

    test('every allowed dispatcher file also names the replacement', () => {
      for (const f of result.allowed) {
        const c = fs.readFileSync(path.join(SCAN_ROOT, f), 'utf8');
        expect(c).toContain(RETIRED);
        expect(c).toContain(REPLACEMENT);
      }
    });
  });

  describe('edge: archived documents', () => {
    const archived = [
      'docs/TRD/implement-trd-beads.md',
      'docs/TRD/implement-trd-beads-br-bv-migration.md',
      'docs/PRD/completed/implement-trd-beads.md',
    ];

    test.each(archived)('%s is excluded by the sweep predicate', (rel) => {
      expect(isExcluded(rel)).toBe(true);
      expect(checkEntry(rel, false, () => RETIRED)).toEqual([]);
    });

    test.each(archived)('%s still names the retired command and is unchanged vs HEAD', (rel) => {
      const abs = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(abs)) return; // archive may be relocated; exclusion is asserted above
      expect(fs.readFileSync(abs, 'utf8')).toContain(RETIRED);
      let tracked = true;
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: REPO_ROOT, stdio: 'ignore' });
      } catch {
        tracked = false;
      }
      if (!tracked) return; // non-git env or untracked: skip diff check
      let clean = true;
      try {
        execFileSync('git', ['diff', '--quiet', 'HEAD', '--', rel], { cwd: REPO_ROOT, stdio: 'ignore' });
      } catch (err) {
        if (err.status === 1) clean = false;
      }
      expect(clean).toBe(true);
    });

    test('other historical locations are excluded', () => {
      for (const rel of [
        'packages/development/CHANGELOG.md',
        'packages/development/tests/fixtures/implement-trd/command-golden.json',
        'packages/development/tests/trd-parser.test.js',
        'evals/skills/x/README.md',
        '.beads/issues.jsonl',
      ]) {
        expect(isExcluded(rel)).toBe(true);
      }
    });
  });

  describe('self-check: the scanner is not vacuous', () => {
    test('synthetic in-memory offenders are flagged', () => {
      expect(checkEntry('packages/development/commands/x.yaml', false, () => `name: ${RETIRED}`)).toEqual(['content']);
      expect(checkEntry(`packages/development/commands/${RETIRED}.yaml`, false, () => '')).toEqual(['named']);
      expect(checkEntry(`packages/full/skills/ensemble-${RETIRED}`, true, () => '')).toEqual(['named']);
      // an ensemble-trd-lookalike elsewhere is not allowed
      expect(checkEntry('packages/development/skills/other/SKILL.md', false, () => RETIRED)).toEqual(['content']);
      // allowance applies to the dispatcher only
      expect(checkEntry('packages/pi/skills/ensemble-trd/SKILL.md', false, () => RETIRED)).toEqual([]);
    });

    test('a mutated scratch copy of the tree is reported while the real tree is clean', () => {
      const base = path.join(os.homedir(), '.omp', 'br-oc017');
      fs.mkdirSync(base, { recursive: true });
      const scratch = fs.mkdtempSync(path.join(base, 'copy-'));
      try {
        const src = path.join(REPO_ROOT, 'packages', 'development');
        const dst = path.join(scratch, 'packages', 'development');
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(path.join(src, 'commands'), path.join(dst, 'commands'), { recursive: true });
        const tasksSkill = path.join(src, 'skills', 'ensemble-implement-trd-tasks');
        if (fs.existsSync(tasksSkill)) {
          fs.cpSync(tasksSkill, path.join(dst, 'skills', 'ensemble-implement-trd-tasks'), { recursive: true });
        }
        expect(scan(scratch).offenders).toEqual([]); // copy starts clean

        const cmd = path.join(dst, 'commands', 'implement-trd-tasks.yaml');
        fs.appendFileSync(cmd, `\n# mutation: ${RETIRED}\n`);
        fs.writeFileSync(path.join(dst, 'commands', `${RETIRED}.yaml`), 'name: x\n');

        const found = scan(scratch).offenders;
        expect(found).toEqual(
          expect.arrayContaining([
            { file: 'packages/development/commands/implement-trd-tasks.yaml', reasons: ['content'] },
            { file: `packages/development/commands/${RETIRED}.yaml`, reasons: ['named'] },
          ])
        );
        expect(scan(REPO_ROOT).offenders).toEqual([]);
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });
  });
});
