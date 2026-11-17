#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-configure-team` eval (`evals/skills/ensemble-configure-team/`). The skill reads a TRD's Master
 * Task List, classifies its complexity and injects a `## 4.1 Team Configuration` section (metrics, then a yaml team block) between the
 * Master Task List and the next section, changing nothing else. The fixture TRD has 12 tasks (8 canonical-shape, 4 nested-description
 * shape), 72 estimated hours, a 5-task dependency chain and backend, frontend, database, infrastructure, documentation and testing
 * tasks, so the tier is Complex (hours > 60) whatever the keyword matcher does with the domains. The references of the skill carry the
 * rules; the numbers below are derived from the fixture, not from a run.
 *
 * Usage (cwd = the agent's workspace): node evals/checks/ensemble-configure-team.js <check> [--name value ...]
 * Files are read without following symlinks (lib.readText); nothing from the workspace is executed; printed text is cleaned.
 * The original TRD and the set of real agent names are read from this repository (never from the workspace).
 *
 * Flakiness notes: `depth` accepts the two common ways to count a chain (nodes or edges); `builders` expects two distinct builder
 * agents, which a registry with an unusual keyword match could in theory collapse (the default mapping gives three).
 */

const fs = require('fs');
const path = require('path');
const { clean, fail, readText, listFiles, walk, need, list, run } = require('./lib');

const REPO = path.resolve(__dirname, '../..');
const TRD_DIR = 'docs/TRD';
const HEADING = /^## (?:4\.1 )?Team Configuration[ \t]*$/;
const LEAD_OWNS = ['task-selection', 'architecture-review', 'final-approval'];
const FENCE = /```ya?ml[^\n]*\n([\s\S]*?)\n[ \t]*```/;

/** The TRD the agent edited: the one file under docs/TRD/ (the fixture seeds one; a second one is a stray). */
function trd() {
  const files = listFiles(TRD_DIR, /\.md$/);
  if (files.length === 0) fail('no TRD file under docs/TRD/ (the seeded TRD was removed)');
  if (files.length > 1) fail(`expected one TRD under docs/TRD/, found ${files.length}: ${files.map(clean).join(', ')}`);
  return { name: files[0], text: readText(path.join(TRD_DIR, files[0])) };
}

/** Split into lines keeping each line's start offset; returns the line index of every `## ` heading. */
function h2(lines) {
  const out = [];
  lines.forEach((l, i) => { if (/^## \S/.test(l)) out.push(i); });
  return out;
}

/** The injected section of `text`: { start, end, lines (heading included), body } where the end is the next `## ` heading or the end. */
function teamSection(text) {
  const lines = text.split('\n');
  const starts = lines.map((l, i) => (HEADING.test(l) ? i : -1)).filter((i) => i >= 0);
  if (starts.length === 0) fail('no `## 4.1 Team Configuration` (or `## Team Configuration`) heading in the TRD');
  if (starts.length > 1) fail(`${starts.length} Team Configuration headings; the section must appear once`);
  const start = starts[0];
  const next = h2(lines).find((i) => i > start);
  const end = next === undefined ? lines.length : next;
  return { start, end, all: lines, lines: lines.slice(start, end), body: lines.slice(start, end).join('\n') };
}

/** The yaml block inside the section. */
function yamlBlock(sec) {
  const m = FENCE.exec(sec.body);
  if (!m) fail('the Team Configuration section has no fenced yaml block');
  return m[1];
}

/** Role chunks of the yaml: { lead, builder, reviewer, qa } -> array of lines. Understands `- name: builder` and `builders:` forms. */
function roles(yaml) {
  const out = {};
  let cur = null;
  for (const line of yaml.split('\n')) {
    const m = /^\s*(?:-\s*)?(?:name:\s*["']?(lead|builder|reviewer|qa)\b|(lead|builder|builders|reviewer|qa):)/.exec(line);
    if (m) { cur = (m[1] || m[2]).replace(/s$/, ''); if (!out[cur]) out[cur] = []; }
    if (cur) out[cur].push(line);
  }
  return out;
}

/** Agent names in some yaml lines: `agent: x`, `agents: [x, y]`, and `- x` items under `agents:`. A `plugin:` prefix is dropped. */
function agentsIn(lines) {
  const found = [];
  const add = (s) => { const n = s.replace(/^["']|["']$/g, '').trim(); if (n) found.push(n.slice(n.lastIndexOf(':') + 1)); };
  let listIndent = -1;
  for (const line of lines) {
    const indent = /^\s*/.exec(line)[0].length;
    let m = /^\s*(?:-\s*)?agent:\s*(\S+)\s*$/.exec(line);
    if (m) { add(m[1]); listIndent = -1; continue; }
    m = /^\s*agents:\s*\[([^\]]{0,300})\]/.exec(line);
    if (m) { m[1].split(',').forEach(add); listIndent = -1; continue; }
    if (/^\s*agents:\s*$/.test(line)) { listIndent = indent; continue; }
    m = /^\s*-\s*(\S+)\s*$/.exec(line);
    if (listIndent >= 0 && m && indent >= listIndent) { add(m[1]); continue; }
    if (line.trim() !== '') listIndent = -1;
  }
  return found;
}

/** Every agent defined in this repository (`name:` under metadata of packages/*\/agents/*.yaml). */
function realAgents() {
  const names = new Set();
  const pkgs = fs.readdirSync(path.join(REPO, 'packages'), { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const p of pkgs) {
    const dir = path.join(REPO, 'packages', p.name, 'agents');
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)); } catch { /* package without agents */ }
    for (const f of files) {
      let t = null;
      try { t = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 20000); } catch { /* unreadable repo file: skip it */ } // repo files, trusted: some agent yamls are symlinks
      const m = t && /^\s{0,4}name:\s*([\w-]+)\s*$/m.exec(t);
      if (m) names.add(m[1]);
    }
  }
  return names;
}

/** First number following `label` (bounded, tolerant of table pipes, `=`, bold and `~`) in the section header text. */
function metric(sec, label) {
  const m = new RegExp(`${label}\\W{0,8}(\\d+(?:\\.\\d+)?)`, 'i').exec(sec.body);
  return m ? Number(m[1]) : null;
}

/** The TRD with the Team Configuration section cut out, blank-line and trailing-space noise normalised. */
const norm = (s) => s.replace(/[ \t]+$/gm, '').replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim();

const FIXTURE_TRD = path.join(REPO, 'evals/skills/ensemble-configure-team/fixture/docs/TRD/TRD-2026-c0ffee01-notes-api.md');

const CHECKS = {
  // The section exists once, after the Master Task List and before the Quality Requirements section.
  'section-injected': () => {
    const { text } = trd();
    const sec = teamSection(text);
    const heads = h2(sec.all).map((i) => sec.all[i]);
    const mtl = sec.all.findIndex((l) => /^## (?:\d+\.\s*)?Master Task List/.test(l));
    const qr = sec.all.findIndex((l) => /^## (?:\d+\.\s*)?Quality Requirements/.test(l));
    if (mtl < 0 || qr < 0) fail('the Master Task List or Quality Requirements heading is gone from the TRD');
    if (!(mtl < sec.start && sec.start < qr)) fail(`the section is not between the Master Task List and Quality Requirements (found at line ${sec.start + 1}; ${heads.length} sections)`);
    return `Team Configuration injected once at line ${sec.start + 1}, between the Master Task List and Quality Requirements`;
  },
  // 12 tasks, 72 hours: both task shapes must be counted (8 canonical + 4 nested-description).
  'metrics-counts': () => {
    const sec = teamSection(trd().text);
    const tasks = metric(sec, 'tasks?(?:\\s+count)?');
    const hours = metric(sec, '(?:estimated[ _]hours|hours)');
    if (tasks !== 12) fail(`task count is ${tasks === null ? 'not stated' : tasks}, the Master Task List has 12 (8 canonical + 4 nested-description)`);
    if (hours !== 72) fail(`estimated hours is ${hours === null ? 'not stated' : hours}, the tasks sum to 72`);
    return 'task count 12 and estimated hours 72 stated';
  },
  // Complex (hours > 60): the tier word must be Complex.
  'tier-complex': () => {
    const m = /tier\W{0,8}(simple|medium|complex)\b/i.exec(teamSection(trd().text).body);
    if (!m) fail('the section does not state a team tier');
    if (m[1].toLowerCase() !== 'complex') fail(`tier is ${m[1]}, 72 hours exceeds the 60-hour Complex threshold`);
    return 'tier Complex stated';
  },
  // At least three domains detected (backend, frontend, database, ...), with backend and frontend named; chain depth 4 or 5.
  domains: () => {
    const sec = teamSection(trd().text);
    const n = metric(sec, 'domains?(?:\\s+count)?');
    if (n === null || n < 3) fail(`domain count is ${n === null ? 'not stated' : n}; the tasks span backend, frontend and database at least`);
    const fence = sec.lines.findIndex((l) => /^```/.test(l));
    const head = sec.lines.slice(0, fence < 0 ? sec.lines.length : fence).join('\n').toLowerCase();
    for (const d of ['backend', 'frontend']) if (!head.includes(d)) fail(`the metrics do not list the ${d} domain`);
    return `${n} domains stated, backend and frontend listed`;
  },
  depth: () => {
    const d = metric(teamSection(trd().text), 'depth');
    if (d === null) fail('dependency depth is not stated');
    if (d !== 4 && d !== 5) fail(`dependency depth is ${d}; the TRD-001..TRD-005 chain is 5 tasks (4 links)`);
    return `dependency depth ${d}`;
  },
  // The lead role: tech-lead-orchestrator owning the three lead responsibilities.
  'lead-role': () => {
    const r = roles(yamlBlock(teamSection(trd().text))).lead;
    if (!r) fail('the yaml block has no lead role');
    const agents = agentsIn(r);
    if (!agents.includes('tech-lead-orchestrator')) fail(`lead agent is ${agents.map(clean).join(', ') || 'missing'}, not tech-lead-orchestrator`);
    const text = r.join('\n');
    const missing = LEAD_OWNS.filter((o) => !text.includes(o));
    if (missing.length) fail(`the lead does not own ${missing.join(', ')}`);
    return 'lead is tech-lead-orchestrator and owns task-selection, architecture-review, final-approval';
  },
  // Builder role: owns implementation; at least two distinct builder agents, each a real agent of this repository.
  builders: () => {
    const r = roles(yamlBlock(teamSection(trd().text))).builder;
    if (!r) fail('the yaml block has no builder role');
    if (!/\bimplementation\b/.test(r.join('\n'))) fail('the builder role does not own implementation');
    const agents = [...new Set(agentsIn(r))];
    const real = realAgents();
    const unknown = agents.filter((a) => !real.has(a));
    if (unknown.length) fail(`builder agent(s) not defined under packages/*/agents: ${unknown.map(clean).join(', ')}`);
    if (agents.length < 2) fail(`only ${agents.length} builder agent (${agents.map(clean).join(', ') || 'none'}); the tasks span backend, frontend and database`);
    return `builders ${agents.join(', ')} own implementation`;
  },
  // Complex adds a reviewer (code-reviewer) and a QA role (test-runner).
  'complex-roles': () => {
    const rs = roles(yamlBlock(teamSection(trd().text)));
    if (!rs.reviewer) fail('Complex tier but no reviewer role');
    if (!rs.qa) fail('Complex tier but no qa role');
    if (!agentsIn(rs.reviewer).includes('code-reviewer')) fail('the reviewer is not code-reviewer');
    if (!agentsIn(rs.qa).includes('test-runner')) fail('the qa role is not test-runner');
    return 'reviewer is code-reviewer, qa is test-runner';
  },
  // Outside the section the TRD is what it was: cut the section out and compare with the seeded TRD (whitespace-normalised).
  'trd-preserved': () => {
    const { text } = trd();
    const sec = teamSection(text);
    const rest = sec.all.slice(0, sec.start).concat(sec.all.slice(sec.end)).join('\n');
    const orig = readText(FIXTURE_TRD);
    if (orig === null) fail('the seeded TRD is missing from the repository fixture');
    if (norm(rest) === norm(orig)) return 'the TRD is unchanged outside the Team Configuration section';
    const a = norm(rest).split('\n');
    const b = norm(orig).split('\n');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    return fail(`the TRD changed outside the section near: ${clean(a[i] === undefined ? '(end of file)' : a[i])} (expected: ${clean(b[i] === undefined ? '(end of file)' : b[i])})`);
  },
  // The skill configures; it implements nothing: no file besides the TRD (and the seeded files / tool state in --allow) exists.
  'no-stray-files': (o) => {
    const allow = new Set(list(need(o, 'allow')));
    const extra = walk('.').filter((f) => !/^\.(ensemble|beads)\//.test(f) && !allow.has(f));
    if (extra.length) fail(`unexpected files written: ${extra.slice(0, 5).map(clean).join(', ')}`);
    return 'only the seeded files exist';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS };
