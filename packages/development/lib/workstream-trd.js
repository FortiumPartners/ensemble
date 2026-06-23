'use strict';

const fs = require('fs');
const path = require('path');
const { parseTRD } = require('./trd-parser');
const { deriveTrdSlug, deriveWorkstreamSlug, validateWorkstream } = require('./workstream-planner');

function stripTrdPrefix(id) {
  return String(id || '').replace(/^TRD-/i, '');
}

function workstreamTaskId(sourceIndex, sourceTaskId) {
  return `TRD-S${String(sourceIndex + 1).padStart(2, '0')}-${stripTrdPrefix(sourceTaskId)}`.toUpperCase();
}

function acTaskId(sourceIndex, acId) {
  return `TRD-S${String(sourceIndex + 1).padStart(2, '0')}-${String(acId || '').toUpperCase()}`;
}

function uniq(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function renderTaskBody(task, item, sourceIndex, idMap) {
  const lines = [];
  lines.push(`  - Source TRD: ${item.trdPath}`);
  if (item.parsed.prdReference) lines.push(`  - Source PRD: ${item.parsed.prdReference}`);
  lines.push(`  - Source Task: ${task.id}`);
  if (task.satisfies && task.satisfies.length) lines.push(`  - [satisfies ${task.satisfies[0]}]`);
  if (task.validatesAcs && task.validatesAcs.length) lines.push(`  - Validates PRD ACs: ${task.validatesAcs.join(', ')}`);
  if (task.targetFiles && task.targetFiles.length) lines.push(`  - Target Files: ${task.targetFiles.join(', ')}`);
  const deps = (task.dependsOn || []).map((d) => idMap.get(d)).filter(Boolean);
  if (deps.length) lines.push(`  - Dependencies: ${deps.join(', ')}`);
  if (task.actions && task.actions.length) {
    lines.push('  - Actions:');
    task.actions.forEach((a, i) => lines.push(`    ${i + 1}. ${a}`));
  }
  if (task.implementationAc && task.implementationAc.length) {
    lines.push('  - Implementation AC:');
    task.implementationAc.forEach((a) => lines.push(`    - [ ] ${a}`));
  }
  if (task.testAc && task.testAc.length) {
    lines.push('  - Test AC:');
    task.testAc.forEach((a) => lines.push(`    - [ ] ${a}`));
  }
  lines.push('  - Definition of Done:');
  lines.push('    - [ ] Code artifact exists for this task/AC');
  lines.push('    - [ ] Relevant tests execute and pass');
  lines.push('    - [ ] No production .FIXME/.DISABLED/.STUB files introduced');
  lines.push('    - [ ] Acceptance criteria explicitly proven in bead comments');
  return lines.join('\n');
}

function generateWorkstreamTrd(items, opts = {}) {
  const list = items.map((item) => ({
    trdPath: item.trdPath,
    slug: item.slug || deriveTrdSlug(item.trdPath),
    parsed: item.parsed || parseTRD(item.markdown || fs.readFileSync(item.trdPath, 'utf8')),
  }));
  const validation = validateWorkstream(list);
  if (!validation.ok && !opts.allowInvalid) {
    return { ok: false, errors: validation.errors, markdown: '' };
  }
  const workstreamSlug = opts.workstreamSlug || deriveWorkstreamSlug(list.map((i) => i.trdPath));
  const today = opts.date || new Date().toISOString().slice(0, 10);
  const title = opts.title || `Workstream TRD: ${workstreamSlug}`;
  const sourcePrds = uniq(list.map((i) => i.parsed.prdReference));
  const lines = [];
  lines.push('---');
  lines.push(`document_type: workstream_trd`);
  lines.push(`status: Draft`);
  lines.push(`date: ${today}`);
  lines.push(`design_readiness_score: 4.0`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');
  lines.push('Generated executable workstream TRD. Source TRDs remain canonical; this file normalizes execution into one bead graph while preserving provenance.');
  lines.push('');
  lines.push('Next step: `/ensemble:implement-trd-beads <this-workstream-trd-path>`.');
  lines.push('');
  if (sourcePrds[0]) lines.push(`Based on PRD: ${sourcePrds[0]}`);
  lines.push('');
  lines.push('## Source TRD Manifest');
  lines.push('');
  lines.push('| Source | TRD | Slug | Title | PRD | Tasks | |');
  lines.push('|---|---|---|---|---|---:|');
  list.forEach((item, idx) => {
    lines.push(`| S${String(idx + 1).padStart(2, '0')} | ${item.trdPath} | ${item.slug} | ${item.parsed.title || ''} | ${item.parsed.prdReference || ''} | ${Object.keys(item.parsed.tasksById || {}).length} |`);
  });
  lines.push('');
  lines.push('## Master Task List');
  lines.push('');
  let prN = 1;
  list.forEach((item, sourceIndex) => {
    const tasks = item.parsed.tasksById || {};
    const idMap = new Map(Object.keys(tasks).map((id) => [id, workstreamTaskId(sourceIndex, id)]));
    lines.push(`### PR ${prN++}: ${item.parsed.title || item.slug}`);
    lines.push('');
    lines.push(`**Shippable State:** Source TRD ${item.trdPath} implemented and verified with executable tests.`);
    lines.push('');
    for (const phase of item.parsed.phases || [{ taskIds: Object.keys(tasks) }]) {
      for (const sourceTaskId of phase.taskIds || []) {
        const task = tasks[sourceTaskId];
        if (!task) continue;
        const wid = idMap.get(sourceTaskId);
        const deps = (task.dependsOn || []).map((d) => idMap.get(d)).filter(Boolean);
        const depText = deps.length ? ` [depends: ${deps.join(', ')}]` : '';
        const sat = task.satisfies && task.satisfies[0] ? ` [satisfies ${task.satisfies[0]}]` : '';
        lines.push(`- [ ] **${wid}**: ${task.description}${sat}${depText}`);
        lines.push(renderTaskBody(task, item, sourceIndex, idMap));
        lines.push('');
      }
    }
    const acToDeps = new Map();
    for (const [sourceTaskId, task] of Object.entries(tasks)) {
      for (const ac of task.validatesAcs || []) {
        if (!acToDeps.has(ac)) acToDeps.set(ac, []);
        acToDeps.get(ac).push(idMap.get(sourceTaskId));
      }
    }
    for (const [ac, deps] of [...acToDeps.entries()].sort()) {
      const wid = acTaskId(sourceIndex, ac);
      lines.push(`- [ ] **${wid}**: Verify ${ac} from ${item.trdPath} [depends: ${uniq(deps).join(', ')}]`);
      lines.push(`  - Source TRD: ${item.trdPath}`);
      if (item.parsed.prdReference) lines.push(`  - Source PRD: ${item.parsed.prdReference}`);
      lines.push(`  - Source AC: ${ac}`);
      lines.push(`  - Validates PRD ACs: ${ac}`);
      lines.push('  - Test AC:');
      lines.push(`    - [ ] Executable tests prove ${ac}`);
      lines.push('    - [ ] Tests execute and pass');
      lines.push('    - [ ] No tests are disabled via .FIXME/.DISABLED/.STUB');
      lines.push('  - Proof of requirement: executable test output and code references recorded in bead comments');
      lines.push('');
    }
  });
  lines.push('## Cross-Cutting Requirements');
  lines.push('');
  lines.push('### XC-001: Workstream Definition of Done');
  lines.push('All generated tasks must pass the DoD gate before closure: code exists, tests execute/pass, no production build-exclusion files, and AC evidence is recorded.');
  lines.push('');
  return { ok: true, errors: validation.errors || [], markdown: lines.join('\n'), workstreamSlug };
}

function microUuid() {
  try {
    // eslint-disable-next-line global-require
    return require('crypto').randomUUID().replace(/-/g, '').slice(0, 8).toLowerCase();
  } catch {
    return Math.random().toString(16).slice(2, 10).padEnd(8, '0').toLowerCase();
  }
}

function nextWorkstreamPath(outDir, year, slug, id) {
  const dir = outDir || 'docs/TRD/workstreams';
  const yy = year || new Date().getFullYear();
  const docId = id || microUuid();
  return path.join(dir, `TRD-${yy}-${docId}-workstream-${slug}.md`);
}

module.exports = { generateWorkstreamTrd, nextWorkstreamPath, workstreamTaskId, acTaskId, microUuid };
