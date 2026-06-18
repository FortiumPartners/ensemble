'use strict';

function normalizeIssues(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.issues)) return input.issues;
  return [];
}

function extractPrefix(title) {
  const m = String(title || '').match(/^(\[[^\]]+\])/);
  return m ? m[1] : '';
}

function extractTrdSlug(title) {
  const m = String(title || '').match(/\[trd:([^:\]]+)/);
  return m ? m[1] : null;
}

function summarizeWorkstream(input, opts = {}) {
  const issues = normalizeIssues(input);
  const workstreamSlug = opts.workstreamSlug || null;
  const releaseTrainPrefix = workstreamSlug ? `[release-train:${workstreamSlug}]` : '[release-train:';
  const releaseTrain = issues.find((i) => String(i.title || '').startsWith(releaseTrainPrefix)) || null;
  const trdMap = new Map();

  for (const issue of issues) {
    const title = issue.title || '';
    const slug = extractTrdSlug(title);
    if (!slug) continue;
    if (!trdMap.has(slug)) {
      trdMap.set(slug, { slug, total: 0, open: 0, in_progress: 0, closed: 0, ready: 0, blocked: 0, tasks: [] });
    }
    const bucket = trdMap.get(slug);
    const isTask = title.includes(`:task:`);
    if (isTask) {
      bucket.total += 1;
      const status = issue.status || 'open';
      if (status === 'closed') bucket.closed += 1;
      else if (status === 'in_progress') bucket.in_progress += 1;
      else bucket.open += 1;
      const deps = Array.isArray(issue.dependencies) ? issue.dependencies : [];
      if (status !== 'closed' && deps.length > 0) bucket.blocked += 1;
      else if (status !== 'closed') bucket.ready += 1;
      bucket.tasks.push({ id: issue.id, title, status, prefix: extractPrefix(title), dependencyCount: deps.length });
    }
  }

  const trds = Array.from(trdMap.values()).sort((a, b) => a.slug.localeCompare(b.slug));
  const aggregate = trds.reduce(
    (acc, t) => {
      acc.total += t.total;
      acc.closed += t.closed;
      acc.open += t.open;
      acc.in_progress += t.in_progress;
      acc.ready += t.ready;
      acc.blocked += t.blocked;
      return acc;
    },
    { total: 0, closed: 0, open: 0, in_progress: 0, ready: 0, blocked: 0 }
  );

  return { ok: true, releaseTrain, aggregate, trds };
}

function formatWorkstreamStatus(summary) {
  const s = summary || summarizeWorkstream([]);
  const lines = [];
  lines.push('=== COMBINED WORKSTREAM STATUS ===');
  lines.push(`Release train: ${s.releaseTrain ? `${s.releaseTrain.id} ${s.releaseTrain.title}` : 'not found'}`);
  lines.push(`Progress: ${s.aggregate.closed}/${s.aggregate.total} tasks closed; ready=${s.aggregate.ready}; blocked=${s.aggregate.blocked}; in_progress=${s.aggregate.in_progress}`);
  for (const trd of s.trds) {
    lines.push(`- ${trd.slug}: ${trd.closed}/${trd.total} closed; ready=${trd.ready}; blocked=${trd.blocked}; in_progress=${trd.in_progress}`);
  }
  lines.push('==================================');
  return lines.join('\n');
}

module.exports = {
  summarizeWorkstream,
  formatWorkstreamStatus,
};
