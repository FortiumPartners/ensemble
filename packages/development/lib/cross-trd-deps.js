'use strict';

/** Pure source-qualified dependency resolver for combined workstreams. */

const TASK_REF_RE = /^([a-z0-9][a-z0-9-]*)#(TRD-[A-Za-z0-9-]+)$/;
const PR_REF_RE = /^([a-z0-9][a-z0-9-]*)#PR-(\d+)$/i;

function parseQualifiedRef(ref) {
  const value = String(ref || '').trim();
  let m = value.match(TASK_REF_RE);
  if (m) return { ok: true, kind: 'task', trdSlug: m[1], id: m[2].toUpperCase(), raw: value };
  m = value.match(PR_REF_RE);
  if (m) return { ok: true, kind: 'pr', trdSlug: m[1], id: `PR-${Number(m[2])}`, n: Number(m[2]), raw: value };
  return { ok: false, raw: value, reason: 'Expected <trd-slug>#TRD-NNN or <trd-slug>#PR-N' };
}

function taskPrefix(slug, taskId) {
  return `[trd:${slug}:task:${taskId}]`;
}

function prPrefix(slug, n) {
  return `[trd:${slug}:pr:${n}]`;
}

function buildIndex(scaffoldPlans) {
  const bySlug = new Map();
  for (const entry of scaffoldPlans || []) {
    const slug = entry.slug;
    const plan = entry.plan || {};
    const tasks = new Map();
    const prs = new Map();
    for (const t of plan.tasks || []) tasks.set(t.id, t.titlePrefix);
    for (const t of plan.synthesizedTests || []) tasks.set(t.id, t.titlePrefix);
    for (const s of plan.stories || []) prs.set(s.phaseN, s.titlePrefix);
    bySlug.set(slug, { slug, tasks, prs, trdPath: entry.trdPath });
  }
  return bySlug;
}

function resolveRef(parsed, index) {
  if (!parsed.ok) return { ok: false, ref: parsed.raw, reason: parsed.reason };
  const source = index.get(parsed.trdSlug);
  if (!source) return { ok: false, ref: parsed.raw, reason: `Unknown TRD slug '${parsed.trdSlug}'` };
  if (parsed.kind === 'task') {
    const titlePrefix = source.tasks.get(parsed.id);
    if (!titlePrefix) return { ok: false, ref: parsed.raw, reason: `Unknown task '${parsed.id}' in ${parsed.trdSlug}` };
    return { ok: true, ref: parsed.raw, kind: parsed.kind, trdSlug: parsed.trdSlug, targetId: parsed.id, titlePrefix, trdPath: source.trdPath };
  }
  const titlePrefix = source.prs.get(parsed.n);
  if (!titlePrefix) return { ok: false, ref: parsed.raw, reason: `Unknown PR '${parsed.id}' in ${parsed.trdSlug}` };
  return { ok: true, ref: parsed.raw, kind: parsed.kind, trdSlug: parsed.trdSlug, targetId: parsed.id, titlePrefix, trdPath: source.trdPath };
}

function collectQualifiedDepends(scaffoldPlans) {
  const out = [];
  for (const entry of scaffoldPlans || []) {
    const slug = entry.slug;
    const plan = entry.plan || {};
    for (const task of plan.tasks || []) {
      for (const dep of task.dependsOn || []) {
        if (String(dep).includes('#')) {
          out.push({ sourceSlug: slug, sourceTaskId: task.id, sourceTitlePrefix: task.titlePrefix, dep });
        }
      }
    }
  }
  return out;
}

function resolveCrossTrdDeps(scaffoldPlans) {
  const index = buildIndex(scaffoldPlans);
  const refs = collectQualifiedDepends(scaffoldPlans);
  const edges = [];
  const errors = [];
  for (const ref of refs) {
    const parsed = parseQualifiedRef(ref.dep);
    const resolved = resolveRef(parsed, index);
    if (!resolved.ok) {
      errors.push({ sourceSlug: ref.sourceSlug, sourceTaskId: ref.sourceTaskId, ref: ref.dep, reason: resolved.reason });
      continue;
    }
    edges.push({
      type: 'cross-trd-depends',
      blockerId: resolved.titlePrefix,
      blockedId: ref.sourceTitlePrefix,
      source: { trdSlug: ref.sourceSlug, taskId: ref.sourceTaskId, titlePrefix: ref.sourceTitlePrefix },
      target: { trdSlug: resolved.trdSlug, id: resolved.targetId, kind: resolved.kind, titlePrefix: resolved.titlePrefix, trdPath: resolved.trdPath },
      metadata: `cross_trd_dep source:${ref.sourceSlug}#${ref.sourceTaskId} target:${resolved.trdPath}#${resolved.targetId}`,
    });
  }
  return { ok: errors.length === 0, edges, errors };
}

module.exports = {
  parseQualifiedRef,
  resolveCrossTrdDeps,
};
