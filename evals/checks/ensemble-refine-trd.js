#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-refine-trd` eval (evals/skills/ensemble-refine-trd). The fixture is a small PR-format TRD
 * seeded with defects the skill's Synthesis step names: a task with no `[satisfies]`, a task with no paired TRD-NNN-TEST, a `### PR N:`
 * heading with no `**Shippable State:**` line, a stale traceability matrix and no Design Readiness score. Under --foreman every finding
 * is auto-applied, so a good run fixes them all, bumps the patch version, keeps Document ID and Label, keeps every task and the PRD intact.
 *
 * Usage: node evals/checks/ensemble-refine-trd.js <check> [--name value ...]   (cwd = the agent's workspace)
 * No check runs git or a workspace program; files are read without following symlinks (lib.js). Nothing here judges quality: these are
 * structure and preservation checks. None is known to be flaky; the ones most sensitive to phrasing are marked "(phrasing)".
 */

const {
  clean, fail, readText, listFiles, walk, need, list, run, frontmatter, section,
} = require('./lib');

const TRD_DIR = 'docs/TRD';
const TASK_LINE = /^\s*[-*]\s+\[[ xX]\]\s+\*\*(TRD-\d+(?:-TEST)?)\*\*/;
const BARE_TASK_LINE = /^\s*(?:[-*]\s+)?(?:\[[ xX]\]\s+)?\*\*TRD-\d+(?:-TEST)?\*\*/;

/** The refined TRD (`--file`), text required. */
function trd(o) {
  const file = need(o, 'file');
  const text = readText(file);
  if (text === null) fail(`${clean(file)} is missing`);
  return text;
}

/** The Master Task List section body, or a failure. */
function masterList(text) {
  const m = section(text, /^Master Task List\b/i);
  if (!m) fail('no "## Master Task List" section');
  return m.body;
}

/** Task lines of the Master Task List: [{ id, line }]. A bold TRD-NNN line without the checkbox prefix fails (the trd-cli grammar). */
function tasks(text) {
  const out = [];
  for (const line of masterList(text).split('\n')) {
    const m = TASK_LINE.exec(line);
    if (m) out.push({ id: m[1], line });
    else if (BARE_TASK_LINE.test(line)) fail(`a task line lost its "- [ ]" checkbox prefix: ${clean(line.trim())}`);
  }
  return out;
}

/** REQ ids named by the `[satisfies ...]` tags of a task line (case-insensitive tag). */
function satisfied(line) {
  const out = [];
  for (const tag of line.matchAll(/\[satisfies\s+([^\]]{1,200})\]/gi)) out.push(...(tag[1].match(/REQ-\d{3,}/g) || []));
  return out;
}

const CHECKS = {
  // Exactly the seeded TRD, overwritten in place: no second TRD file, the seeded one still there.
  'refine-in-place': (o) => {
    const files = listFiles(TRD_DIR, /\.md$/);
    if (!files.includes(need(o, 'name'))) fail(`${TRD_DIR}/${clean(o.name)} is gone: the TRD must be refined in place`);
    if (files.length !== 1) fail(`expected only the refined TRD under ${TRD_DIR}/, found ${files.map(clean).join(', ')}`);
    return `refined ${TRD_DIR}/${o.name} in place`;
  },
  'refine-identity': (o) => {
    const fm = frontmatter(trd(o));
    for (const [key, arg] of [['document_id', 'doc-id'], ['label', 'label']]) {
      if (fm[key] !== need(o, arg)) fail(`${key} is ${JSON.stringify(clean(fm[key] === undefined ? '(missing)' : fm[key]))}, expected ${JSON.stringify(o[arg])}`);
    }
    return 'Document ID and Label unchanged';
  },
  'refine-version': (o) => {
    const v = frontmatter(trd(o)).version;
    if (v !== need(o, 'to')) fail(`version is ${JSON.stringify(clean(v === undefined ? '(missing)' : v))}, expected ${JSON.stringify(o.to)} (a patch bump from ${clean(need(o, 'from'))})`);
    return `version ${o.from} -> ${o.to}`;
  },
  // A changelog entry for the new version, the earlier one kept. (phrasing: the section may be titled Changelog or Version History.)
  'refine-changelog': (o) => {
    const m = section(trd(o), /^(?:Changelog|Version History)\b/i, { toEnd: true });
    if (!m) fail('no Changelog section');
    const entries = m.body.split('\n').filter((l) => /^\s*(?:[-*]|\d+\.|\|)/.test(l));
    if (!entries.some((l) => l.includes(need(o, 'to')))) fail(`no changelog entry for ${o.to}`);
    if (!entries.some((l) => l.includes(need(o, 'from')))) fail(`the earlier changelog entry for ${o.from} was removed`);
    return `changelog has entries for ${o.from} and ${o.to}`;
  },
  // No seeded task disappeared and every task line keeps its checkbox prefix (Master Task List grammar).
  'tasks-kept': (o) => {
    const have = new Set(tasks(trd(o)).map((t) => t.id));
    const gone = list(need(o, 'tasks')).filter((id) => !have.has(id));
    if (gone.length) fail(`task(s) removed from the Master Task List: ${gone.join(', ')}`);
    return `all ${list(o.tasks).length} seeded tasks still present with checkbox prefix`;
  },
  // Task ids are unique, every [satisfies REQ-NNN] resolves to a PRD requirement (--reqs), every [Depends: TRD-NNN] resolves, and
  // --task (the task seeded without an annotation) now has one.
  'task-links': (o) => {
    const ts = tasks(trd(o));
    const ids = ts.map((t) => t.id);
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) fail(`duplicate task id ${dup}`);
    const reqs = new Set(list(need(o, 'reqs')));
    for (const t of ts) {
      const bad = satisfied(t.line).find((r) => !reqs.has(r));
      if (bad) fail(`${t.id} cites ${bad}, which is not a requirement of the PRD`);
      for (const tag of t.line.matchAll(/\[depends:?\s+([^\]]{1,200})\]/gi)) {
        const missing = (tag[1].match(/TRD-\d+(?:-TEST)?/g) || []).find((d) => !ids.includes(d));
        if (missing) fail(`${t.id} depends on ${missing}, which is not a task`);
      }
    }
    const target = ts.find((t) => t.id === need(o, 'task'));
    if (!target) fail(`${clean(o.task)} is missing`);
    if (satisfied(target.line).length === 0) fail(`${o.task} still has no [satisfies REQ-NNN] annotation`);
    return `links resolve; ${o.task} satisfies ${satisfied(target.line).join(', ')}`;
  },
  // The user-facing task seeded without a test (--task) now has a TRD-NNN-TEST task (by id, or by a [Verifies TRD-NNN] tag on a -TEST task).
  'test-paired': (o) => {
    const task = need(o, 'task');
    if (!/^TRD-\d+$/.test(task)) fail(`bad --task ${clean(task)}`);
    const verifies = new RegExp(`\\[verifies\\s+[^\\]]{0,100}\\b${task}\\b`, 'i');
    const paired = tasks(trd(o)).some((t) => t.id === `${task}-TEST` || (/-TEST$/.test(t.id) && verifies.test(t.line)));
    if (!paired) fail(`no ${task}-TEST task: ${task} still has no paired test task`);
    return `${task} has a paired test task`;
  },
  // PR format: every `### PR N:` heading of the Master Task List is followed by a `**Shippable State:**` line, and at least one PR section exists.
  shippable: (o) => {
    const lines = masterList(trd(o)).split('\n');
    let prs = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^###\s+PR\s+\d+\b/.test(lines[i])) continue;
      prs += 1;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      if (!/^\*{0,2}Shippable State:?\*{0,2}\s*\S/i.test(lines[j] || '')) fail(`"${clean(lines[i].trim())}" has no **Shippable State:** line`);
    }
    if (prs === 0) fail('the Master Task List has no "### PR N:" section');
    return `${prs} PR sections, each with a Shippable State`;
  },
  // The traceability matrix names every PRD requirement (--reqs) and every id in --ids (the tasks refinement had to add or re-link).
  traceability: (o) => {
    const m = section(trd(o), /^Acceptance Criteria Traceability\b/i);
    if (!m) fail('no "Acceptance Criteria Traceability" section');
    const wanted = [...list(need(o, 'reqs')), ...list(o.ids || '')];
    for (const id of wanted) if (!/^[A-Z]+-\d+(?:-[A-Z]+)?$/.test(id)) fail(`bad id ${clean(id)}`);
    const missing = wanted.filter((id) => !new RegExp(`(?:^|[^\\w-])${id}(?![\\w-])`, 'm').test(m.body));
    if (missing.length) fail(`the traceability matrix does not mention: ${missing.join(', ')}`);
    return 'traceability matrix refreshed';
  },
  // The Design Readiness score is (re)written in frontmatter as a number from 1 to 5 (the fixture seeded none).
  readiness: (o) => {
    const raw = frontmatter(trd(o)).design_readiness_score;
    const n = raw === undefined || !/^\d(?:\.\d{1,2})?$/.test(raw) ? NaN : Number(raw);
    if (!(n >= 1 && n <= 5)) fail(`design_readiness_score is ${JSON.stringify(clean(raw === undefined ? '(missing)' : raw))}, expected a number from 1 to 5`);
    return `design_readiness_score ${n}`;
  },
  // The PRD is read, never edited: its version and status are unchanged.
  'prd-untouched': (o) => {
    const file = need(o, 'file');
    const text = readText(file);
    if (text === null) fail(`${clean(file)} is missing`);
    const fm = frontmatter(text);
    if (fm.version !== need(o, 'version') || fm.status !== need(o, 'status')) fail(`the PRD changed: version ${clean(fm.version)}, status ${clean(fm.status)}`);
    return 'PRD unchanged';
  },
  // Refinement writes the TRD only: nothing outside docs/ (and tool state) except --allow.
  'no-impl-files': (o) => {
    const allow = new Set(list(o.allow || ''));
    const extra = walk('.').filter((f) => !f.startsWith('docs/') && !/^\.(ensemble|beads)\//.test(f) && !allow.has(f));
    if (extra.length) fail(`implementation or stray files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'no files written outside docs/';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
