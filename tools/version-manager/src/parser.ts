import * as conventionalCommitsParser from 'conventional-commits-parser';
import { sanitizeCommitMessage } from './sanitizer';
import { VersionError, ErrorCodes } from './errors';

type Commit = conventionalCommitsParser.Commit;

/**
 * Parser configuration for conventional commits
 * Uses strict mode to fail on malformed commits
 */
const parserOptions = {
  // Pattern matches: type(scope)!: subject or type(scope): subject
  headerPattern: /^(\w+)(?:\(([^\)]+)\))?(!)?:\s*(.+)$/,
  headerCorrespondence: ['type', 'scope', 'breaking', 'subject'],
  noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
  revertPattern: /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
  revertCorrespondence: ['header', 'hash'],
  issuePrefixes: ['#'],
};

/**
 * Parsed commit message structure
 */
export interface CommitMessage {
  type: string;          // feat, fix, docs, etc.
  scope?: string;        // (core), (router), etc.
  breaking: boolean;     // ! suffix or BREAKING CHANGE footer
  subject: string;       // Short description
  body?: string;         // Long description
  footer?: string;       // Footer notes
  notes?: Array<{        // Breaking change notes
    title: string;
    text: string;
  }>;
  references?: Array<{   // Issue references
    action?: string;
    owner?: string;
    repository?: string;
    issue: string;
    raw: string;
    prefix: string;
  }>;
}

/**
 * Parse conventional commit message
 *
 * @param message - Raw commit message
 * @returns Parsed commit structure
 * @throws VersionError if message is malformed or invalid
 */
export function parseConventionalCommit(message: string): CommitMessage {
  // 1. Input sanitization (security layer)
  const sanitized = sanitizeCommitMessage(message);

  // 2. Parse with conventional-commits-parser
  let parsed: Commit;
  try {
    parsed = conventionalCommitsParser.sync(sanitized, parserOptions);
  } catch (error) {
    throw new VersionError(
      `${ErrorCodes.PARSE_ERROR.message}: ${error instanceof Error ? error.message : 'unknown error'}`,
      ErrorCodes.PARSE_ERROR.code,
      ErrorCodes.PARSE_ERROR.recovery
    );
  }

  // 3. Validate required fields
  if (!parsed.type || parsed.type.trim().length === 0) {
    throw new VersionError(
      `${ErrorCodes.PARSE_ERROR.message}: Missing commit type`,
      ErrorCodes.PARSE_ERROR.code,
      ErrorCodes.PARSE_ERROR.recovery
    );
  }

  // 4. Validate type is lowercase
  if (parsed.type !== parsed.type.toLowerCase()) {
    throw new VersionError(
      `${ErrorCodes.PARSE_ERROR.message}: Commit type must be lowercase`,
      ErrorCodes.PARSE_ERROR.code,
      ErrorCodes.PARSE_ERROR.recovery
    );
  }

  // 5. Validate subject exists and is not empty
  if (!parsed.subject || parsed.subject.trim().length === 0) {
    throw new VersionError(
      `${ErrorCodes.PARSE_ERROR.message}: Missing commit subject`,
      ErrorCodes.PARSE_ERROR.code,
      ErrorCodes.PARSE_ERROR.recovery
    );
  }

  // 6. Validate scope is not empty if present
  if (parsed.scope !== null && parsed.scope !== undefined && parsed.scope.trim().length === 0) {
    throw new VersionError(
      `${ErrorCodes.PARSE_ERROR.message}: Scope cannot be empty`,
      ErrorCodes.PARSE_ERROR.code,
      ErrorCodes.PARSE_ERROR.recovery
    );
  }

  // 7. Detect breaking changes
  // The breaking flag is captured as a separate field in the parsed result
  const hasBreakingFlag = !!(parsed as any).breaking;
  const hasBreakingNote = (parsed.notes || []).some(
    (note: conventionalCommitsParser.Note) => note.title === 'BREAKING CHANGE' || note.title === 'BREAKING-CHANGE'
  );

  // 8. Build result
  return {
    type: parsed.type,
    scope: parsed.scope || undefined,
    breaking: hasBreakingFlag || hasBreakingNote,
    subject: parsed.subject,
    body: parsed.body || undefined,
    footer: parsed.footer || undefined,
    notes: parsed.notes,
    references: parsed.references,
  };
}
