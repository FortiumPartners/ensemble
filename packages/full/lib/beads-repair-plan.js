'use strict';

function fix(id, finding, commands, verify, extra = {}) {
  return Object.assign({
    id,
    findingId: finding.id,
    risk: 'medium',
    requiresDependencyConfirmation: commands.some((c) => /^br dep\s+/i.test(c)),
    commands,
    verify,
    inverseCommands: [],
    expectedGraphEffect: finding.recommendation || '',
    skipped: false,
  }, extra);
}

function shellQuote(value) {
  return `'${String(value == null ? '' : value).replace(/'/g, `'"'"'`)}'`;
}

function planFixForFinding(finding, index) {
  const id = `fix-${String(index + 1).padStart(3, '0')}`;
  const beadIds = finding.beadIds || [];
  if (finding.requiresUserResolution || finding.type === 'cycle' || finding.type === 'priority_order') {
    return fix(id, finding, [], { kind: 'manual_resolution_required' }, {
      risk: 'high',
      skipped: true,
      options: ['retry with chosen edge', 'skip', 'reverse selected edge', 'abort'],
      expectedGraphEffect: 'Blocked until user chooses a dependency resolution.',
    });
  }
  if ((finding.type === 'traceability' || finding.type === 'pr_boundary') && beadIds[0]) {
    const msg = `refine-beads: ${finding.type} finding ${finding.id}: ${finding.recommendation}`;
    return fix(id, finding, [`br comments add ${beadIds[0]} --message ${shellQuote(msg)}`], { kind: 'comment_contains', beadId: beadIds[0], text: `refine-beads: ${finding.type}` }, { risk: 'low', inverseCommands: [] });
  }
  if (finding.type === 'orphan' && beadIds.length >= 2) {
    const child = beadIds[0];
    const parent = beadIds[1];
    return fix(id, finding, [`br dep add ${shellQuote(child)} ${shellQuote(parent)} --type parent-child`], { kind: 'dependency_exists', source: child, target: parent }, { risk: 'medium', inverseCommands: [`br dep remove ${shellQuote(child)} ${shellQuote(parent)}`] });
  }
  if (finding.type === 'duplicate') {
    return fix(id, finding, [], { kind: 'manual_review_required' }, {
      risk: 'low',
      skipped: true,
      options: ['merge', 'close duplicate', 'relink', 'leave unchanged'],
      expectedGraphEffect: 'No automatic close is generated for possible duplicates.',
    });
  }
  return fix(id, finding, [], { kind: 'manual_review_required' }, { skipped: true, expectedGraphEffect: 'Manual review required; no deterministic br command proposed.' });
}

function buildRepairPlan(findings) {
  const list = Array.isArray(findings) ? findings : [];
  const fixes = list.map(planFixForFinding);
  return {
    ok: true,
    findings: list,
    fixes,
    summary: summarizeRepairPlan(fixes),
  };
}

function summarizeRepairPlan(fixes) {
  const list = Array.isArray(fixes) ? fixes : [];
  return {
    total: list.length,
    executable: list.filter((f) => !f.skipped && f.commands.length).length,
    skipped: list.filter((f) => f.skipped || !f.commands.length).length,
    dependencyConfirmationRequired: list.filter((f) => f.requiresDependencyConfirmation).length,
  };
}

function renderSummary({ findings = [], fixes = [], applied = [], skipped = [], failed = [], remaining = [] } = {}) {
  const changedEdges = applied
    .filter((a) => a.verify && a.verify.kind === 'dependency_exists')
    .map((a) => `${a.verify.source} -> ${a.verify.target}`);
  return {
    findings: findings.length,
    fixesApproved: applied.length + skipped.length + failed.length,
    fixesApplied: applied.length,
    fixesSkipped: skipped.length,
    failedFixes: failed.length,
    remainingGraphIssues: remaining.length,
    changedDependencyEdges: changedEdges,
  };
}

module.exports = { buildRepairPlan, summarizeRepairPlan, renderSummary, shellQuote };
