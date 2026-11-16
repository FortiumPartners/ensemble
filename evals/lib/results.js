'use strict';

/**
 * Run outcome from grader results. Deterministic checks alone decide the verdict; judged checks
 * (`judged: true`) are reported separately as a score and never change it.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const envlib = require('./env');

/** `{ pass, verdict, judgedScore, judgeModel }` for a list of grader results. */
function summarizeRun(graders) {
  const deterministic = graders.filter((g) => !g.judged);
  const judged = graders.filter((g) => g.judged);
  const scores = judged.filter((g) => typeof g.score === 'number').map((g) => g.score);
  const pass = deterministic.length > 0 && deterministic.every((g) => g.pass);
  const judgeModel = (judged.find((g) => g.judgeModel) || {}).judgeModel || null;
  return {
    pass,
    verdict: pass ? 'pass' : 'fail',
    judgedScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    judgeModel,
  };
}

/** Content hash of a directory tree: sorted relative paths with file bytes (symlinks hash their target text). */
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (e.isSymbolicLink()) h.update(`${r}\0->${fs.readlinkSync(path.join(dir, r))}\0`);
      else if (e.isFile()) { h.update(`${r}\0`); h.update(fs.readFileSync(path.join(dir, r))); h.update('\0'); }
    }
  };
  walk('');
  return h.digest('hex');
}

/** `metadata.version` (or a top-level `version`) from SKILL.md front matter, else null. */
function skillVersion(skillDir) {
  const file = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
  const v = m && /^\s*version:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(m[1]);
  return v ? v[1] : null;
}

/**
 * Which copy was evaluated: the package directory loaded as the plugin (never a copy), the skill's content hash,
 * and whether the working tree differs from the committed copy (`git status --porcelain` on the package: the
 * whole package is loaded, so an edit anywhere in it counts). `workingTreeDiffers` is null when the repository
 * is not a git checkout. The installed (marketplace) copy is not inspected.
 */
function evaluatedCopy({ repoRoot, packageName, skill }) {
  const packagePath = path.join(repoRoot, 'packages', packageName);
  const skillDir = path.join(packagePath, 'skills', skill);
  const git = (args) => spawnSync('git', [...envlib.GIT_HARDEN, '-C', repoRoot, ...args], { encoding: 'utf8', env: envlib.gitEnv() });
  let workingTreeDiffers = null;
  let changedFiles = [];
  const inside = git(['rev-parse', '--is-inside-work-tree']);
  if (inside.status === 0 && inside.stdout.trim() === 'true') {
    const st = git(['status', '--porcelain', '--untracked-files=all', '--', path.relative(repoRoot, packagePath)]);
    if (st.status === 0) {
      changedFiles = st.stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
      workingTreeDiffers = changedFiles.length > 0;
    }
  }
  return {
    packagePath: path.relative(repoRoot, packagePath),
    skillHash: fs.existsSync(skillDir) ? hashDir(skillDir) : null,
    skillVersion: skillVersion(skillDir),
    workingTreeDiffers,
    changedFiles: changedFiles.slice(0, 20),
  };
}

/** One line stating the evaluated copy. */
function describeCopy(c) {
  const tree = c.workingTreeDiffers === null ? 'working tree vs committed: unknown (not a git checkout)'
    : c.workingTreeDiffers ? `working tree DIFFERS from the committed copy (${c.changedFiles.length} changed file(s))` : 'working tree matches the committed copy';
  return `${c.packagePath} (loaded as shipped) skillHash=${c.skillHash ? c.skillHash.slice(0, 12) : 'n/a'}${c.skillVersion ? ` version=${c.skillVersion}` : ''}; ${tree}`;
}

module.exports = { summarizeRun, hashDir, skillVersion, evaluatedCopy, describeCopy };
