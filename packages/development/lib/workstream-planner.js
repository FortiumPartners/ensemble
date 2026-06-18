'use strict';

/**
 * Pure helpers for multi-TRD combined workstream mode.
 * No shell, br, git, or bv calls live here.
 */

const path = require('path');
const { buildScaffoldPlan } = require('./scaffold-planner');

function slugify(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveTrdSlug(trdPath) {
  const base = path.basename(String(trdPath || '')).replace(/\.[^.]+$/, '');
  return slugify(base);
}

function deriveWorkstreamSlug(trdPaths) {
  const slugs = (trdPaths || []).map(deriveTrdSlug).filter(Boolean);
  if (slugs.length === 0) return 'combined-workstream';
  if (slugs.length === 1) return slugs[0];
  const common = commonTokenPrefix(slugs);
  return common || `combined-${slugs.length}-trds`;
}

function commonTokenPrefix(slugs) {
  const tokenized = slugs.map((s) => s.split('-').filter(Boolean));
  if (!tokenized.length) return '';
  const out = [];
  for (let i = 0; i < tokenized[0].length; i++) {
    const token = tokenized[0][i];
    if (tokenized.every((parts) => parts[i] === token)) out.push(token);
    else break;
  }
  return out.join('-');
}

function validateParsedTrd(parsed, trdPath, slug, allSlugs) {
  const errors = [];
  const warnings = [];
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, trdPath, slug, errors: ['TRD parse returned no object'], warnings };
  }
  if (!parsed.prdReference) errors.push('Missing PRD reference');
  if (!Array.isArray(parsed.phases) || parsed.phases.length === 0) {
    errors.push('Missing Master Task List PR/phase sections');
  }
  if (!parsed.tasksById || Object.keys(parsed.tasksById).length === 0) {
    errors.push('Missing TRD tasks');
  }
  if (parsed.prFormat) {
    for (const phase of parsed.phases || []) {
      if (!phase.shippableState) {
        errors.push(`PR ${phase.n} missing Shippable State`);
      }
    }
  }
  if (parsed.designReadinessScore == null) {
    errors.push('Missing design_readiness_score; run /ensemble:refine-trd');
  } else if (parsed.designReadinessScore < 4.0) {
    errors.push(`design_readiness_score ${parsed.designReadinessScore} is below 4.0; run /ensemble:refine-trd`);
  }
  if (/failed|blocked/i.test(String(parsed.status || ''))) {
    errors.push(`TRD status is ${parsed.status}`);
  }
  if (allSlugs && allSlugs.filter((s) => s === slug).length > 1) {
    errors.push(`Duplicate TRD slug '${slug}' from filename; rename one TRD or use unique filenames`);
  }
  return { ok: errors.length === 0, trdPath, slug, errors, warnings };
}

function validateWorkstream(items) {
  const list = Array.isArray(items) ? items : [];
  const slugs = list.map((i) => i.slug || deriveTrdSlug(i.trdPath));
  const trds = list.map((item, idx) => validateParsedTrd(item.parsed, item.trdPath, slugs[idx], slugs));
  const errors = trds.flatMap((t) => t.errors.map((reason) => ({ trdPath: t.trdPath, slug: t.slug, reason })));
  return { ok: errors.length === 0, trds, errors };
}

function releaseTrainPrefix(workstreamSlug) {
  return `[release-train:${workstreamSlug}]`;
}

function trdEpicPrefix(workstreamSlug, trdSlug) {
  return `[release-train:${workstreamSlug}:trd:${trdSlug}]`;
}

function buildWorkstreamPlan(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const trdPaths = list.map((i) => i.trdPath);
  const workstreamSlug = opts.workstreamSlug || deriveWorkstreamSlug(trdPaths);
  const validation = validateWorkstream(list);
  const sourcePrds = list.map((i) => (i.parsed && i.parsed.prdReference) || '').filter(Boolean);

  const releaseTrain = {
    titlePrefix: releaseTrainPrefix(workstreamSlug),
    title: `${releaseTrainPrefix(workstreamSlug)} Combined Workstream`,
    type: 'epic',
    priority: 2,
    description: [
      'Combined multi-TRD release train.',
      `Source TRDs: ${trdPaths.join(', ')}`,
      `Source PRDs: ${sourcePrds.join(', ')}`,
      `workstream:combined source_trds:${trdPaths.join(',')} source_prds:${sourcePrds.join(',')} stacked_prs:${opts.stackedPrs ? 'enabled' : 'disabled'} created:${opts.created || '<created-at-runtime>'}`,
    ].join('\n'),
  };

  const trdEpics = [];
  const scaffoldPlans = [];
  const deps = [];
  const warnings = [];

  for (const item of list) {
    const slug = item.slug || deriveTrdSlug(item.trdPath);
    const parsed = item.parsed || {};
    const scaffold = buildScaffoldPlan(parsed, {
      trdSlug: slug,
      trdFilePath: item.trdPath,
      prdFilePath: parsed.prdReference || '',
    });
    scaffoldPlans.push({ trdPath: item.trdPath, slug, plan: scaffold });
    warnings.push(...(scaffold.warnings || []).map((w) => `${slug}: ${w}`));
    trdEpics.push({
      trdPath: item.trdPath,
      slug,
      titlePrefix: trdEpicPrefix(workstreamSlug, slug),
      title: `${trdEpicPrefix(workstreamSlug, slug)} ${parsed.title || slug}`,
      type: 'epic',
      priority: 2,
      description: [
        `source_trd:${item.trdPath}`,
        `source_prd:${parsed.prdReference || ''}`,
        `trd_slug:${slug}`,
        `workstream:${workstreamSlug}`,
      ].join('\n'),
      scaffoldEpicPrefix: scaffold.epic.titlePrefix,
    });
    deps.push({
      type: 'trd-epic-blocks-release-train',
      blockerId: trdEpicPrefix(workstreamSlug, slug),
      blockedId: releaseTrain.titlePrefix,
    });
    deps.push({
      type: 'scaffold-epic-blocks-trd-epic',
      blockerId: scaffold.epic.titlePrefix,
      blockedId: trdEpicPrefix(workstreamSlug, slug),
    });
  }

  return {
    ok: validation.ok,
    validation,
    workstreamSlug,
    releaseTrain,
    trdEpics,
    scaffoldPlans,
    deps,
    warnings,
  };
}

module.exports = {
  slugify,
  deriveTrdSlug,
  deriveWorkstreamSlug,
  validateWorkstream,
  buildWorkstreamPlan,
  releaseTrainPrefix,
  trdEpicPrefix,
};
