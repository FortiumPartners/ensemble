/**
 * Refinement-review session model.
 *
 * One shared, versioned contract used by every refinement command that
 * opts into the browser-review phase. Persists to JSON via atomic rename;
 * every mutation is guarded by a `revision` integer (optimistic concurrency)
 * and a `sha256` over the source markdown bytes (document integrity).
 *
 * @module @sunstone-partners/ensemble-core/refinement-review/session
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

/**
 * Generate a 128-bit hex id. Used for sessionId, questionId, and commentId.
 * @returns {string}
 */
function newId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a 256-bit bearer token. NOT persisted with the session.
 * @returns {string}
 */
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Compute sha256 hex digest of a string or buffer.
 * @param {string|Buffer} input
 * @returns {string}
 */
function sha256Hex(input) {
  const h = crypto.createHash('sha256');
  h.update(input);
  return h.digest('hex');
}

/**
 * Extract ordered section headings from markdown.
 * Captures ATX headings (`#`..`######`) preceded by start-of-line.
 * @param {string} content
 * @returns {string[]} e.g. ["# Title", "## Overview", "### Acceptance Criteria"]
 */
function extractSectionHeadings(content) {
  if (typeof content !== 'string') return [];
  const out = [];
  const lines = content.split(/\r\n|\r|\n/);
  for (const line of lines) {
    const m = /^(#{1,6})\s+([^#].*?)\s*#*\s*$/.exec(line);
    if (m) out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}

/**
 * Validate an anchor object. Returns null on success or a string reason.
 * @param {unknown} anchor
 * @param {number} totalLines
 * @returns {string|null}
 */
function validateAnchor(anchor, totalLines) {
  if (anchor === null || anchor === undefined) return null;
  if (typeof anchor !== 'object') return 'anchor must be object or null';
  const { section, lineStart, lineEnd, selectedText } = anchor;
  if (section !== null && typeof section !== 'string')
    return 'anchor.section must be string or null';
  if (!Number.isInteger(lineStart) || lineStart < 1 || lineStart > totalLines)
    return `anchor.lineStart out of bounds (1..${totalLines})`;
  if (!Number.isInteger(lineEnd) || lineEnd < lineStart || lineEnd > totalLines)
    return `anchor.lineEnd out of bounds (lineStart..${totalLines})`;
  if (selectedText !== null && typeof selectedText !== 'string')
    return 'anchor.selectedText must be string or null';
  return null;
}

/**
 * Shape-validate a session envelope. Throws on the first violation.
 * @param {unknown} session
 */
function validateSession(session) {
  if (!session || typeof session !== 'object')
    throw new Error('session must be an object');
  if (session.schemaVersion !== SCHEMA_VERSION)
    throw new Error(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (typeof session.sessionId !== 'string' || !session.sessionId)
    throw new Error('sessionId is required');
  if (typeof session.revision !== 'number' || session.revision < 1)
    throw new Error('revision must be a positive integer');
  if (typeof session.createdAt !== 'string')
    throw new Error('createdAt must be an ISO timestamp');
  if (typeof session.updatedAt !== 'string')
    throw new Error('updatedAt must be an ISO timestamp');

  const doc = session.document;
  if (!doc || typeof doc !== 'object') throw new Error('document is required');
  if (doc.kind !== 'prd' && doc.kind !== 'trd')
    throw new Error('document.kind must be "prd" or "trd"');
  for (const k of ['sourcePath', 'contentPath', 'sha256']) {
    if (typeof doc[k] !== 'string' || !doc[k])
      throw new Error(`document.${k} is required`);
  }
  if (!Array.isArray(doc.sectionHeadings))
    throw new Error('document.sectionHeadings must be an array of strings');
  for (const h of doc.sectionHeadings) {
    if (typeof h !== 'string')
      throw new Error('document.sectionHeadings entries must be strings');
  }
  if (doc.customerSummary !== undefined && doc.customerSummary !== null &&
      typeof doc.customerSummary !== 'string')
    throw new Error('document.customerSummary must be string or null');

  if (!Array.isArray(session.questions) || session.questions.length === 0)
    throw new Error('questions must be a non-empty array');
  const seenQ = new Set();
  for (const q of session.questions) {
    if (!q || typeof q !== 'object') throw new Error('question must be object');
    if (typeof q.id !== 'string' || !q.id)
      throw new Error('question.id is required');
    if (seenQ.has(q.id)) throw new Error(`duplicate question id: ${q.id}`);
    seenQ.add(q.id);
    if (typeof q.prompt !== 'string' || !q.prompt)
      throw new Error('question.prompt is required');
    if (q.context !== null && typeof q.context !== 'string')
      throw new Error('question.context must be string or null');
    if (q.targetAnchor !== undefined && q.targetAnchor !== null) {
      if (typeof q.targetAnchor !== 'object')
        throw new Error('question.targetAnchor must be object or null');
      const ta = q.targetAnchor;
      if (typeof ta.lineStart !== 'number' || !Number.isInteger(ta.lineStart) || ta.lineStart < 1)
        throw new Error('question.targetAnchor.lineStart must be a positive integer');
      if (ta.lineEnd !== undefined && ta.lineEnd !== null) {
        if (typeof ta.lineEnd !== 'number' || !Number.isInteger(ta.lineEnd) || ta.lineEnd < ta.lineStart)
          throw new Error('question.targetAnchor.lineEnd must be an integer >= lineStart');
      }
      if (ta.highlightText !== undefined && ta.highlightText !== null && typeof ta.highlightText !== 'string')
        throw new Error('question.targetAnchor.highlightText must be string or null');
    }
    if (q.options !== undefined && q.options !== null) {
      if (!Array.isArray(q.options))
        throw new Error('question.options must be array or null');
      const seenOpt = new Set();
      for (const opt of q.options) {
        if (!opt || typeof opt !== 'object')
          throw new Error('question.options entries must be objects');
        if (typeof opt.id !== 'string' || !opt.id)
          throw new Error('question.options[].id is required');
        if (seenOpt.has(opt.id))
          throw new Error(`question.options duplicate id: ${opt.id}`);
        seenOpt.add(opt.id);
        if (typeof opt.label !== 'string' || !opt.label)
          throw new Error('question.options[].label is required');
        if (opt.description !== undefined && opt.description !== null && typeof opt.description !== 'string')
          throw new Error('question.options[].description must be string or null');
      }
    }
    if (q.recommendedOptionId !== undefined && q.recommendedOptionId !== null) {
      if (typeof q.recommendedOptionId !== 'string')
        throw new Error('question.recommendedOptionId must be string or null');
      if (!Array.isArray(q.options) || !q.options.some((o) => o.id === q.recommendedOptionId))
        throw new Error(`question.recommendedOptionId '${q.recommendedOptionId}' does not match any option.id`);
    }
    if (q.selectedOptionId !== undefined && q.selectedOptionId !== null) {
      if (typeof q.selectedOptionId !== 'string')
        throw new Error('question.selectedOptionId must be string or null');
      if (!Array.isArray(q.options) || !q.options.some((o) => o.id === q.selectedOptionId))
        throw new Error(`question.selectedOptionId '${q.selectedOptionId}' does not match any option.id`);
    }
    if (!['open', 'answered', 'skipped'].includes(q.status))
      throw new Error(`question.status invalid: ${q.status}`);
    if (q.answer !== null && typeof q.answer !== 'string')
      throw new Error('question.answer must be string or null');
    if (q.author !== null && typeof q.author !== 'string')
      throw new Error('question.author must be string or null');
    if (q.updatedAt !== null && typeof q.updatedAt !== 'string')
      throw new Error('question.updatedAt must be ISO string or null');
  }

  if (!Array.isArray(session.comments))
    throw new Error('comments must be an array');
  const seenC = new Set();
  for (const c of session.comments) {
    if (!c || typeof c !== 'object') throw new Error('comment must be object');
    if (typeof c.id !== 'string' || !c.id)
      throw new Error('comment.id is required');
    if (seenC.has(c.id)) throw new Error(`duplicate comment id: ${c.id}`);
    seenC.add(c.id);
    if (typeof c.body !== 'string') throw new Error('comment.body is required');
    if (typeof c.author !== 'string') throw new Error('comment.author is required');
    if (typeof c.createdAt !== 'string')
      throw new Error('comment.createdAt is required');
    if (c.resolvedAt !== null && typeof c.resolvedAt !== 'string')
      throw new Error('comment.resolvedAt must be ISO string or null');
    if (c.anchor !== null && typeof c.anchor !== 'object')
      throw new Error('comment.anchor must be object or null');
    if (c.anchor) {
      const err = validateAnchor(c.anchor, Number.MAX_SAFE_INTEGER);
      if (err) throw new Error(`comment.anchor invalid: ${err}`);
    }
  }

  if (session.completedAt !== undefined &&
      session.completedAt !== null &&
      typeof session.completedAt !== 'string')
    throw new Error('completedAt must be ISO string or null');
  if (session.completedBy !== undefined &&
      session.completedBy !== null &&
      typeof session.completedBy !== 'string')
    throw new Error('completedBy must be string or null');
  // Approval is optional in both directions: sessions written before the
  // customer-approval tab existed simply lack the field, so it is never
  // required — only shape-checked when present.
  if (session.approval !== undefined && session.approval !== null) {
    const a = session.approval;
    if (typeof a !== 'object') throw new Error('approval must be object or null');
    if (a.decision !== 'approved' && a.decision !== 'changes-requested')
      throw new Error('approval.decision must be "approved" or "changes-requested"');
    if (typeof a.author !== 'string' || !a.author)
      throw new Error('approval.author is required');
    if (a.note !== null && typeof a.note !== 'string')
      throw new Error('approval.note must be string or null');
    if (typeof a.decidedAt !== 'string' || !a.decidedAt)
      throw new Error('approval.decidedAt must be an ISO timestamp');
  }
}

/**
 * Atomic JSON write: write to temp file in same directory, fsync, rename.
 * @param {string} filePath
 * @param {unknown} value
 */
function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const data = JSON.stringify(value, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

/**
 * Read JSON, throwing a descriptive error on parse failure.
 * @param {string} filePath
 * @returns {unknown}
 */
function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Load and validate a session from disk.
 * @param {string} sessionPath
 * @returns {object}
 */
function loadSession(sessionPath) {
  const session = readJson(sessionPath);
  validateSession(session);
  return session;
}

/**
 * Create a new session. Reads the source markdown to compute sha256 and
 * section headings. Persists the session and returns `{ session, token }`.
 *
 * @param {object} args
 * @param {string} args.sessionPath - where the session JSON is persisted
 * @param {"prd"|"trd"} args.kind
 * @param {string} args.sourcePath - source markdown path (absolute)
 * @param {Array<{id?: string, prompt: string, context?: string|null, targetAnchor?: object|null, options?: Array<{id: string, label: string, description?: string|null}>|null, recommendedOptionId?: string|null}>} args.questions
 * @param {string} [args.customerSummary] - plain-language summary for the
 *   customer-facing approval tab. When absent, the server derives one from
 *   the source markdown.
 * @returns {{session: object, token: string}}
 */
function createSession({ sessionPath, kind, sourcePath, questions, customerSummary }) {

  if (!['prd', 'trd'].includes(kind))
    throw new Error(`kind must be "prd" or "trd" (got ${kind})`);
  if (typeof sourcePath !== 'string' || !sourcePath)
    throw new Error('sourcePath is required');
  if (!Array.isArray(questions) || questions.length === 0)
    throw new Error('questions must be a non-empty array');
  if (customerSummary !== undefined && customerSummary !== null && typeof customerSummary !== 'string')
    throw new Error('customerSummary must be a string when provided');

  const abs = path.resolve(sourcePath);
  const content = fs.readFileSync(abs);
  const sha = sha256Hex(content);
  const headings = extractSectionHeadings(content.toString('utf8'));

  const now = new Date().toISOString();
  const session = {
    schemaVersion: SCHEMA_VERSION,
    sessionId: newId(),
    document: {
      kind,
      sourcePath: abs,
      contentPath: abs,
      sha256: sha,
      sectionHeadings: headings,
      customerSummary: customerSummary || null,
    },
    questions: questions.map((q) => ({
      id: q.id || newId(),
      prompt: q.prompt,
      context: q.context || null,
      targetAnchor: q.targetAnchor || null,
      options: q.options || null,
      recommendedOptionId: q.recommendedOptionId || null,
      selectedOptionId: null,
      status: 'open',
      answer: null,
      author: null,
      updatedAt: null,
    })),
    comments: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    completedBy: null,
    approval: null,
  };

  validateSession(session);

  writeJsonAtomic(sessionPath, session);

  return { session, token: newToken() };
}

/**
 * Mutate a session through a function, persisting with optimistic concurrency.
 * Re-validates the document sha256 against the on-disk source on every write.
 *
 * The mutator receives the current session and may mutate it in place to
 * describe the data change. `revision` is auto-incremented by exactly 1 after
 * the mutator returns; the mutator MUST NOT touch `revision` itself. Every
 * accepted persisted mutation advances optimistic concurrency by one.
 *
 * @param {object} args
 * @param {string} args.sessionPath
 * @param {number} args.expectedRevision - caller's last-known revision
 * @param {(s: object) => void} args.mutate
 * @param {string} [args.now] - override timestamp (for testing)
 * @returns {object} the persisted session
 * @throws on revision mismatch, document hash drift, completion freeze, validation.
 */
function mutateSession({ sessionPath, expectedRevision, mutate, now }) {
  const session = loadSession(sessionPath);

  if (session.completedAt)
    throw Object.assign(new Error('session is completed'), {
      code: 'SESSION_COMPLETED',
      status: 410,
    });
  if (typeof expectedRevision !== 'number' || session.revision !== expectedRevision)
    throw Object.assign(
      new Error(
        `revision conflict (expected ${expectedRevision}, current ${session.revision})`,
      ),
      { code: 'REVISION_CONFLICT', status: 409, currentRevision: session.revision },
    );

  // Re-verify document integrity. The source is read-only for the command's
  // lifetime; if it changes, every anchored comment becomes suspect.
  const onDisk = fs.readFileSync(session.document.sourcePath);
  const onDiskSha = sha256Hex(onDisk);
  if (onDiskSha !== session.document.sha256)
    throw Object.assign(new Error('document sha256 changed on disk'), {
      code: 'DOCUMENT_CHANGED',
      status: 409,
      sessionRevision: session.revision,
    });

  const preRevision = session.revision;
  mutate(session);

  if (session.revision !== preRevision)
    throw Object.assign(
      new Error('mutator must not change revision; mutateSession owns the +1 bump'),
      { code: 'REVISION_TAMPERED', status: 400 },
    );

  session.revision = preRevision + 1;
  session.updatedAt = now || new Date().toISOString();

  validateSession(session);
  writeJsonAtomic(sessionPath, session);
  return session;
}

/**
 * Reopen a completed session: clear `completedAt`/`completedBy` so the
 * session is mutable again, while preserving user answers, comments, and
 * document integrity. Revision is bumped by 1, expectedRevision is
 * checked, and document sha256 is re-verified.
 *
 * Use this when iterating on a refinement loop where the same session
 * must be revisitable after the user finishes one round of feedback.
 * For a fresh session, callers should `createSession` instead — a fresh
 * sessionPath is the canonical "start over" mechanism.
 *
 * @param {object} args
 * @param {string} args.sessionPath
 * @param {number} args.expectedRevision
 * @param {string} [args.now] - override timestamp (for testing)
 * @returns {object} the persisted session
 * @throws SESSION_NOT_FOUND, REVISION_CONFLICT, DOCUMENT_CHANGED
 */
function reopenSession({ sessionPath, expectedRevision, now }) {
  const session = loadSession(sessionPath);

  if (typeof expectedRevision !== 'number' || session.revision !== expectedRevision)
    throw Object.assign(
      new Error(
        `revision conflict (expected ${expectedRevision}, current ${session.revision})`,
      ),
      { code: 'REVISION_CONFLICT', status: 409, currentRevision: session.revision },
    );

  // Re-verify document integrity, same as mutateSession.
  const onDisk = fs.readFileSync(session.document.sourcePath);
  const onDiskSha = sha256Hex(onDisk);
  if (onDiskSha !== session.document.sha256)
    throw Object.assign(new Error('document sha256 changed on disk'), {
      code: 'DOCUMENT_CHANGED',
      status: 409,
      sessionRevision: session.revision,
    });

  const preRevision = session.revision;
  session.completedAt = null;
  session.completedBy = null;
  session.revision = preRevision + 1;
  session.updatedAt = now || new Date().toISOString();

  validateSession(session);
  writeJsonAtomic(sessionPath, session);
  return session;
}

/**
 * Migrate an existing session in place when one is present, otherwise create
 * a new one. Bootstrap-time helper for agents that need to add new additive
 * question metadata (targetAnchor, options, recommendedOptionId) without
 * losing user-entered state (answer, status, selectedOptionId, comments,
 * revision history).
 *
 * Rules:
 * - If sessionPath is missing or empty: calls createSession with `questions`.
 * - If a valid session is present and not completed: loads it, applies the
 *   optional `migrate(s)` callback (additive fill-in only), persists via
 *   mutateSession at the loaded revision, and returns the new revision.
 *   The migrate callback MUST NOT touch status/answer/selectedOptionId/comments.
 * - Throws SESSION_COMPLETED (410) if the existing session is frozen.
 *
 * Always returns a freshly generated token so browser sessions reset on
 * restart, matching the existing convention.
 *
 * @param {object} args
 * @param {string} args.sessionPath
 * @param {(s: object) => void} [args.migrate] - additive mutator applied on load
 * @param {boolean} [args.reopen] - when true, an existing completed session
 *   is reopened in place (completedAt/completedBy cleared, revision bumped).
 *   Defaults to false: completed sessions throw SESSION_COMPLETED.
 * @param {string} [args.customerSummary] - plain-language summary for the
 *   customer-facing approval tab. For a new session it is stored directly; for
 *   an existing one it replaces a stale/absent summary (revision +1) and is
 *   skipped when already identical.
 * @returns {{ session: object, token: string }}
 */
function migrateOrCreate({ sessionPath, kind, sourcePath, questions, customerSummary, migrate, reopen }) {
  const exists = fs.existsSync(sessionPath);
  let readable = false;
  if (exists) {
    try {
      readable = fs.statSync(sessionPath).size > 0;
    } catch {
      readable = false;
    }
  }

  if (!exists || !readable) {
    return createSession({ sessionPath, kind, sourcePath, questions, customerSummary });
  }

  const loaded = loadSession(sessionPath);

  if (loaded.completedAt) {
    if (!reopen) {
      throw Object.assign(
        new Error('session is completed; choose a fresh sessionPath to restart'),
        { code: 'SESSION_COMPLETED', status: 410 },
      );
    }
    // reopen:true: clear completion fields. Use the dedicated primitive
    // because mutateSession rejects completed sessions.
    reopenSession({
      sessionPath,
      expectedRevision: loaded.revision,
    });
  }

  // Refresh the customer-facing summary before any caller-supplied migration so
  // the Overview tab always tracks the current PRD. Skipping when the text is
  // already identical avoids a pointless revision bump on every reopen.
  if (typeof customerSummary === 'string' && customerSummary) {
    const current = loadSession(sessionPath);
    if (current.document.customerSummary !== customerSummary) {
      mutateSession({
        sessionPath,
        expectedRevision: current.revision,
        mutate: (s) => { s.document.customerSummary = customerSummary; },
      });
    }
  }

  if (typeof migrate === 'function') {
    const reloaded = loadSession(sessionPath);
    mutateSession({
      sessionPath,
      expectedRevision: reloaded.revision,
      mutate: migrate,
    });
  }

  const finalSession = loadSession(sessionPath);
  return { session: finalSession, token: newToken() };
}


module.exports = {
  SCHEMA_VERSION,
  newId,
  newToken,
  sha256Hex,
  extractSectionHeadings,
  validateAnchor,
  validateSession,
  writeJsonAtomic,
  readJson,
  loadSession,
  createSession,
  mutateSession,
  reopenSession,
  migrateOrCreate,
};
