/**
 * Shared test helpers for team-based execution model tests.
 *
 * Extracts functions that were previously duplicated across multiple test files.
 * Each function is exported as a named export for selective import.
 */

'use strict';

// ---------------------------------------------------------------------------
// parseSubState - Comment status parser
// ---------------------------------------------------------------------------

/**
 * Parses the output of `br comment list <bead_id>` to find the latest
 * status: comment.
 *
 * Format: status:<state> <key>:<value> [<key>:<value>...]
 *
 * Valid states: in_progress, in_review, in_qa, closed, skip-review, skip-qa
 * Valid keys:   assigned, builder, reviewer, qa, verdict, reason, files, lead
 *
 * reason: values use %20 for spaces; hyphens are preserved literally.
 *
 * @param {string} commentListOutput - Raw stdout from `br comment list`
 * @returns {{ state: string, metadata: Object } | null}
 */
function parseSubState(commentListOutput) {
  if (!commentListOutput || typeof commentListOutput !== 'string') {
    return null;
  }

  const lines = commentListOutput.split('\n');

  // Scan in reverse so the latest comment wins
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    const statusIdx = line.indexOf('status:');
    if (statusIdx === -1) continue;

    const statusPart = line.substring(statusIdx);
    if (!statusPart.startsWith('status:')) continue;

    const tokens = statusPart.split(/\s+/);
    const state = tokens[0].replace('status:', '');

    if (!state) continue;

    const metadata = {};
    for (let j = 1; j < tokens.length; j++) {
      const colonIdx = tokens[j].indexOf(':');
      if (colonIdx === -1) continue;
      const key = tokens[j].substring(0, colonIdx);
      const rawValue = tokens[j].substring(colonIdx + 1);
      if (!key || rawValue === undefined) continue;

      if (key === 'reason') {
        metadata[key] = decodeURIComponent(rawValue);
      } else {
        metadata[key] = rawValue;
      }
    }

    return { state, metadata };
  }

  return null;
}

// ---------------------------------------------------------------------------
// parseTeamConfig - Team YAML parser
// ---------------------------------------------------------------------------

/**
 * Parses the `team:` section of a command YAML (already loaded as a JS object)
 * and returns a normalized team configuration.
 *
 * @param {Object|undefined|null} yamlTeamSection - The `team:` object from parsed YAML
 * @returns {{ teamMode: boolean, teamRoles: Object, reviewerEnabled: boolean, qaEnabled: boolean }}
 * @throws {Error} if required roles (lead, builder) are missing
 */
function parseTeamConfig(yamlTeamSection) {
  if (!yamlTeamSection) {
    return {
      teamMode: false,
      teamRoles: {},
      reviewerEnabled: false,
      qaEnabled: false,
    };
  }

  const roles = yamlTeamSection.roles || [];
  const teamRoles = {};

  for (const role of roles) {
    const agents =
      role.agents ||
      (role.agent ? [role.agent] : []);

    teamRoles[role.name] = {
      agents,
      owns: role.owns || [],
    };
  }

  if (!teamRoles.lead) {
    throw new Error("team.roles must include a 'lead' role");
  }
  if (!teamRoles.builder) {
    throw new Error("team.roles must include a 'builder' role");
  }

  return {
    teamMode: true,
    teamRoles,
    reviewerEnabled: !!teamRoles.reviewer,
    qaEnabled: !!teamRoles.qa,
  };
}

// ---------------------------------------------------------------------------
// VALID_TRANSITIONS - State machine transition table
// ---------------------------------------------------------------------------

/**
 * Valid state transitions for the bead sub-state machine.
 *
 * open         -> in_progress   (builder claims task)
 * in_progress  -> in_review     (builder submits for review)
 * in_progress  -> in_qa         (lead skips review via skip-review)
 * in_progress  -> closed        (lead skips all stages)
 * in_review    -> in_qa         (reviewer approves)
 * in_review    -> in_progress   (reviewer rejects)
 * in_qa        -> closed        (QA passes)
 * in_qa        -> in_progress   (QA rejects)
 */
const VALID_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['in_review', 'in_qa', 'closed'],
  in_review: ['in_qa', 'in_progress'],
  in_qa: ['closed', 'in_progress'],
};

// ---------------------------------------------------------------------------
// validateTransition - State machine validator
// ---------------------------------------------------------------------------

/**
 * Returns true if transitioning from currentState to targetState is allowed.
 *
 * @param {string} currentState
 * @param {string} targetState
 * @returns {boolean}
 */
function validateTransition(currentState, targetState) {
  const allowed = VALID_TRANSITIONS[currentState] || [];
  return allowed.includes(targetState);
}

// ---------------------------------------------------------------------------
// countRejections - Rejection cycle counter
// ---------------------------------------------------------------------------

/**
 * Count how many times verdict:rejected appears in a comment list output.
 * Used to detect when the rejection cycle limit (MAX_REJECTIONS) has been hit.
 *
 * Respects lead-reset:true baseline -- if present, only rejections AFTER the
 * most recent lead-reset:true line are counted.
 *
 * @param {string} commentListOutput - Raw stdout from `br comment list`
 * @returns {number}
 */
function countRejections(commentListOutput) {
  if (!commentListOutput || typeof commentListOutput !== 'string') return 0;
  const lines = commentListOutput.split('\n');
  let baselineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('lead-reset:true')) baselineIndex = i;
  }
  const relevantLines = lines.slice(baselineIndex + 1);
  return (relevantLines.join('\n').match(/verdict:rejected/g) || []).length;
}

// ---------------------------------------------------------------------------
// requiresEscalation - Escalation threshold check
// ---------------------------------------------------------------------------

/** Maximum rejection cycles before lead escalation is required. */
const MAX_REJECTIONS = 2;

/**
 * Returns true when the rejection count has reached or exceeded MAX_REJECTIONS,
 * indicating that the lead must intervene before re-assigning the task.
 *
 * @param {number} rejectionCount
 * @returns {boolean}
 */
function requiresEscalation(rejectionCount) {
  return rejectionCount >= MAX_REJECTIONS;
}

// ---------------------------------------------------------------------------
// selectBuilder - Keyword-based builder selection
// ---------------------------------------------------------------------------

const BACKEND_KEYWORDS = ['backend', 'api', 'database', 'server', 'model', 'migration'];
const FRONTEND_KEYWORDS = ['frontend', 'ui', 'component', 'react', 'vue', 'css'];
const INFRA_KEYWORDS = ['infra', 'deploy', 'docker', 'k8s', 'aws'];
const DOCS_KEYWORDS = ['docs', 'documentation', 'readme'];

/**
 * Selects the most appropriate builder agent for a task based on keywords.
 *
 * @param {string[]} taskKeywords
 * @param {string[]} builderAgents
 * @returns {string} selected agent name
 */
function selectBuilder(taskKeywords, builderAgents) {
  for (const kw of taskKeywords) {
    if (BACKEND_KEYWORDS.includes(kw) && builderAgents.includes('backend-developer')) return 'backend-developer';
    if (FRONTEND_KEYWORDS.includes(kw) && builderAgents.includes('frontend-developer')) return 'frontend-developer';
    if (INFRA_KEYWORDS.includes(kw) && builderAgents.includes('infrastructure-developer')) return 'infrastructure-developer';
    if (DOCS_KEYWORDS.includes(kw) && builderAgents.includes('backend-developer')) return 'backend-developer';
  }
  return builderAgents[0]; // Default to first builder
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  parseSubState,
  parseTeamConfig,
  VALID_TRANSITIONS,
  validateTransition,
  countRejections,
  MAX_REJECTIONS,
  requiresEscalation,
  selectBuilder,
  BACKEND_KEYWORDS,
  FRONTEND_KEYWORDS,
  INFRA_KEYWORDS,
  DOCS_KEYWORDS,
};
