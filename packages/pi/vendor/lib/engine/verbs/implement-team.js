'use strict';

/**
 * TRD-009 (TRD-2026-d571763f): `ensemble implement team` -- the roster Step 1.7 of
 * implement-trd-tasks establishes, and the alias map it delegates through
 * (`skills/ensemble-implement-trd-tasks/references/phase-1-preflight.md:64-65`).
 *
 * The verb reads the TRD, the repository's agent definitions and the agents a runtime installed.
 * It starts nothing and writes nothing: the `Team mode` line the skill logs is returned as data,
 * so the caller prints what it printed before.
 *
 * A roster agent that resolves to nothing is refused rather than passed through. The skill halts
 * there (`phase-1-preflight.md:65`, and the printed text at :26), because a bare name reaching
 * Task() fails at the one moment it matters.
 */

const fs = require('fs');
const path = require('path');

// js-yaml is absent from the marketplace-cache install (the same guard team-defaults.js carries).
// Without it a TRD's `team:` block cannot be parsed; that is reported, never guessed at.
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const MESSAGES = require('../messages');
const { buildAliasMap, discoverAgents } = require('../agents');
const { refused } = require('../result');
const { resolveCallerPath } = require('../validate');
const { normalizeLineEndings, scanFrontmatter } = require('../../trd-parser');

const MD_RE = /\.md$/i;

/** A fenced block introduced as yaml or yml, with its body captured. */
const YAML_FENCE_RE = /^```(?:yaml|yml)\s*$([\s\S]*?)^```\s*$/gm;

/**
 * A `team:` block this installation cannot read. Distinct from an absent block: an absent block
 * is answered with the default roster, an unreadable one is refused.
 */
const TEAM_BLOCK_UNREADABLE = Symbol('team-block-unreadable');

/**
 * Whether the text declares a top-level `team:` key. An indented `team:` belongs to another key.
 * @param {string} text the text to read
 * @returns {boolean}
 */
function declaresTeamKey(text) {
  return /^team\s*:/m.test(text);
}

/**
 * Whether the text declares a top-level `team:` key inside a fenced yaml block. Used when no YAML
 * parser is available: the block cannot be read, but its presence must still be seen.
 * @param {string} text the TRD's whole text
 * @returns {boolean}
 */
function declaresTeamBlock(text) {
  YAML_FENCE_RE.lastIndex = 0;
  let match = YAML_FENCE_RE.exec(text);
  while (match !== null) {
    if (declaresTeamKey(match[1])) return true;
    match = YAML_FENCE_RE.exec(text);
  }
  return false;
}

/** The roles the `Team mode` line names, in the order it names them (phase-1-preflight.md:64). */
const LOG_ROLES = Object.freeze([
  'lead',
  'architect',
  'builder',
  'reviewer',
  'qa',
  'advisor',
  'pm',
  'documentation',
]);

/** What the line calls each of them. `builder` is reported as a count, not a name. */
const LOG_LABELS = Object.freeze({
  advisor: 'advisor',
  architect: 'architect',
  builder: 'builders',
  documentation: 'documentation',
  lead: 'lead',
  pm: 'pm',
  qa: 'qa',
  reviewer: 'reviewer',
});

/**
 * The roster the deprecated `--builder` / `builder_agent` inputs produce, copied from
 * `skills/ensemble-implement-trd-tasks/references/phase-3-execute.md:7`.
 * @param {string} builder the named builder agent
 * @returns {object} the compatibility roster
 */
function compatibilityRoster(builder) {
  return {
    architect: { agents: ['architect'], owns: ['task-design'] },
    builder: { agents: [builder], owns: ['implementation'] },
    documentation: { agents: ['documentation-specialist'], owns: ['pr-boundary-doc-maintenance'] },
    lead: { agents: ['tech-lead-orchestrator'], owns: ['planning', 'escalation'] },
  };
}

/**
 * Read the TRD once: its frontmatter and the first fenced yaml block that declares a team.
 * @param {string} absolute absolute path of the TRD
 * @returns {{frontmatter: object|null, teamBlock: *}|null} null when the file cannot be read
 */
function readTrd(absolute) {
  let text;
  try {
    text = normalizeLineEndings(fs.readFileSync(absolute, 'utf8'));
  } catch {
    return null;
  }
  const { body, frontmatter } = scanFrontmatter(text);
  if (frontmatter && frontmatter.team !== undefined) {
    return { frontmatter, teamBlock: frontmatter.team };
  }
  if (yaml === null) {
    // Without a YAML parser the fenced block cannot be read. A TRD that declares one must not be
    // answered with the default roster: that would report a success the TRD never asked for.
    return {
      frontmatter: frontmatter || null,
      teamBlock: declaresTeamBlock(body === undefined ? text : body) ? TEAM_BLOCK_UNREADABLE : undefined,
    };
  }
  YAML_FENCE_RE.lastIndex = 0;
  let match = YAML_FENCE_RE.exec(body === undefined ? text : body);
  while (match !== null) {
    let parsed;
    let unparsable = false;
    try {
      parsed = yaml.load(match[1]);
    } catch {
      parsed = null;
      unparsable = true;
    }
    if (unparsable) {
      // A block that declares a team and cannot be parsed is a declaration this run cannot read:
      // it is refused, never answered with the default roster.
      if (declaresTeamKey(match[1])) {
        return { frontmatter: frontmatter || null, teamBlock: TEAM_BLOCK_UNREADABLE };
      }
    } else if (parsed && typeof parsed === 'object' && parsed.team !== undefined) {
      return { frontmatter: frontmatter || null, teamBlock: parsed.team };
    }
    match = YAML_FENCE_RE.exec(body === undefined ? text : body);
  }
  return { frontmatter: frontmatter || null, teamBlock: undefined };
}

/**
 * Turn the TRD's `team:` block into the roster shape the rest of the command uses
 * (`docs/TRD/TRD-2026-023-trd-staleness-gate.md:301-314` is the shape a TRD writes).
 * @param {*} block the parsed `team` value
 * @returns {{roles: object}|{error: string}}
 */
function normaliseTeamBlock(block) {
  if (!block || typeof block !== 'object' || !Array.isArray(block.roles)) {
    return { error: 'a team block must have a roles list' };
  }
  const roles = Object.create(null);
  for (const entry of block.roles) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name === '') {
      return { error: 'every role must have a name' };
    }
    // A name declared twice is two roles written over each other: the first one's agents would be
    // lost without a word, so the block is refused instead.
    if (Object.prototype.hasOwnProperty.call(roles, entry.name)) {
      return { error: `role '${entry.name}' is declared more than once` };
    }
    const agents = entry.agents === undefined ? (entry.agent === undefined ? null : [entry.agent]) : entry.agents;
    if (!Array.isArray(agents) || agents.length === 0 || agents.some(a => typeof a !== 'string' || a === '')) {
      return { error: `role '${entry.name}' must name at least one agent` };
    }
    const owns = entry.owns === undefined ? [] : entry.owns;
    if (!Array.isArray(owns) || owns.some(o => typeof o !== 'string')) {
      return { error: `role '${entry.name}' has an invalid owns list` };
    }
    roles[entry.name] = { agents: [...agents], owns: [...owns] };
  }
  return { roles };
}

/**
 * The one line Step 1.7 logs (`phase-1-preflight.md:64`). An absent role reads `none` rather than
 * being dropped, so the line has the same shape whatever roster produced it.
 * @param {object} roles the roster
 * @param {string} label `default roster` or `TRD roster`
 * @returns {string}
 */
function teamModeLog(roles, label) {
  const parts = LOG_ROLES.map(role => {
    const entry = roles[role];
    if (role === 'builder') return `${LOG_LABELS[role]}=${entry ? entry.agents.length : 0}`;
    return `${LOG_LABELS[role]}=${entry ? entry.agents.join('+') : 'none'}`;
  });
  return `Team mode (${label}): ${parts.join(', ')}`;
}

/**
 * JSON with keys in sorted order, so two runs of the same roster produce the same bytes and a
 * diff of TEAM_ROLES_JSON only moves when the roster did.
 * @param {object} roles
 * @returns {string}
 */
function sortedRolesJson(roles) {
  const sorted = Object.create(null);
  for (const name of Object.keys(roles).sort()) {
    const role = roles[name];
    sorted[name] = { agents: role.agents, owns: role.owns };
  }
  return JSON.stringify(sorted);
}

/**
 * @param {object} call
 * @returns {object} the decisions, or a refusal
 */
function handler(call) {
  const input = call.input;
  const warnings = [];

  let trd = null;
  if (typeof input.trd === 'string' && MD_RE.test(input.trd)) {
    const absolute = resolveCallerPath(call.projectRoot, input.trd);
    trd = readTrd(absolute);
    if (trd === null) return refused('TRD_NOT_FOUND', `TRD '${input.trd}' does not exist`);
  }

  const frontmatter = trd === null ? null : trd.frontmatter;
  if (trd !== null && trd.teamBlock === TEAM_BLOCK_UNREADABLE) {
    return refused(
      'TEAM_BLOCK_INVALID',
      "ERROR: the TRD's team: block could not be read: this installation has no YAML parser (js-yaml)."
    );
  }
  const builderFlag = input.builder === undefined ? null : input.builder;
  const builderFrontmatter =
    frontmatter && typeof frontmatter.builder_agent === 'string' && frontmatter.builder_agent !== ''
      ? frontmatter.builder_agent
      : null;
  const builder = builderFlag === null ? builderFrontmatter : builderFlag;

  let roles;
  let rosterSource;
  if (trd !== null && trd.teamBlock !== undefined) {
    const normalised = normaliseTeamBlock(trd.teamBlock);
    if (normalised.error) {
      return refused(
        'TEAM_BLOCK_INVALID',
        `ERROR: the TRD's team: block is malformed (${normalised.error}).`
      );
    }
    roles = normalised.roles;
    rosterSource = 'trd';
    if (builder !== null) {
      warnings.push(
        `NOTE: the TRD's team: block supplies the roster; the deprecated ${
          builderFlag === null ? 'builder_agent frontmatter' : '--builder flag'
        } was ignored.`
      );
    }
  } else if (builder !== null) {
    roles = compatibilityRoster(builder);
    rosterSource = 'builder-compat';
    warnings.push(
      `NOTE: ${
        builderFlag === null ? 'builder_agent frontmatter is' : '--builder is'
      } deprecated; a compatibility roster was produced. Declare a team: block in the TRD instead.`
    );
  } else {
    // Required here rather than at module load: it reads a YAML file from disk, which a run that
    // refuses on its arguments should never pay for.
    const { resolveDefaultTeamRoles } = require('../../team-defaults');
    roles = resolveDefaultTeamRoles({});
    rosterSource = 'default';
  }

  const entries = discoverAgents({ env: call.env, projectRoot: call.projectRoot });
  const aliasMap = buildAliasMap(entries);
  const ids = new Set(entries.map(entry => entry.id));

  const unresolved = [];
  for (const role of Object.keys(roles).sort()) {
    for (const agent of roles[role].agents) {
      if (
        !Object.prototype.hasOwnProperty.call(aliasMap, agent) &&
        !ids.has(agent) &&
        !unresolved.includes(agent)
      ) {
        unresolved.push(agent);
      }
    }
  }
  if (unresolved.length > 0) {
    return refused('AGENT_NOT_REGISTERED', MESSAGES.agentNotRegistered(unresolved[0]), {
      agents: unresolved,
    });
  }

  return {
    AGENT_ALIAS_MAP: aliasMap,
    ROSTER_SOURCE: rosterSource,
    TEAM_MODE_LOG: teamModeLog(roles, rosterSource === 'trd' ? 'TRD roster' : 'default roster'),
    TEAM_ROLES: roles,
    TEAM_ROLES_JSON: sortedRolesJson(roles),
    WARNINGS: warnings,
  };
}

const spec = {
  // Nothing written: the TRD and the agent definitions are read, nothing else is touched.
  exitCodes: [0, 1, 2],
  group: 'implement',
  handler,
  inputSchema: {
    additionalProperties: false,
    properties: {
      builder: { pattern: '^[a-z][a-z0-9-]{0,63}$', type: 'string' },
      trd: { type: 'string', 'x-operand': true },
    },
    type: 'object',
  },
  name: 'team',
  outputSchema: {
    additionalProperties: false,
    properties: {
      AGENT_ALIAS_MAP: { additionalProperties: { type: 'string' }, type: 'object' },
      ROSTER_SOURCE: { enum: ['builder-compat', 'default', 'trd'], type: 'string' },
      TEAM_MODE_LOG: { type: 'string' },
      TEAM_ROLES: {
        additionalProperties: {
          additionalProperties: false,
          properties: {
            agents: { items: { type: 'string' }, type: 'array' },
            owns: { items: { type: 'string' }, type: 'array' },
          },
          required: ['agents', 'owns'],
          type: 'object',
        },
        type: 'object',
      },
      TEAM_ROLES_JSON: { type: 'string' },
      WARNINGS: { items: { type: 'string' }, type: 'array' },
    },
    type: 'object',
  },
  policyKeys: [],
  sideEffect: 'read',
  summary: 'report the team roster and the agent alias map a build would delegate through',
};

module.exports = { spec };
