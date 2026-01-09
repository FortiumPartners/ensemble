# Technical Requirements Document: Automated Plugin Version Management

## Document Information

- **Project**: Automated Version Management System for Ensemble Plugin Ecosystem
- **Version**: 1.1.0
- **Status**: Draft
- **Created**: 2026-01-09
- **Last Updated**: 2026-01-09
- **Owner**: Technical Architecture Team
- **Related PRD**: `docs/PRD/automated-version-management.md` v1.1.0
- **Tech Lead**: TBD
- **Reviewers**: DevOps Team, Core Development Team

---

## 1. Executive Summary

### 1.1 Technical Overview

This document specifies the technical implementation for an automated version management system that ensures consistent semantic versioning across the Ensemble plugin ecosystem (25 packages in npm workspaces monorepo). The system parses conventional commit messages, determines appropriate version bumps, synchronizes version numbers across multiple file formats, and cascades updates to dependent packages.

### 1.2 Key Technical Decisions

**Finalized (from PRD v1.1.0):**
- **Hook Type**: Pre-commit hook (updates version files before commit finalization)
- **Dependency Format**: `workspace:*` for monorepo development
- **Multi-commit Strategy**: Highest precedence (breaking > minor > patch)
- **Versioning Strategy**: Version-locked (all 25 packages maintain same version)
- **Merge Conflict Handling**: Fail with conflict (require manual resolution)
- **Pre-release Scope**: Out of Phase 1 scope
- **Changelog Strategy**: Root-level only (single CHANGELOG.md)
- **Revert Behavior**: Versions never decrease (semver compliance)
- **Manual Override**: Deferred to Phase 4

**New (from Refinement v1.1.0):**
- **Commit Parser**: Use conventional-commits-parser library (battle-tested, robust)
- **Error Handling**: Fail-fast approach (block commit entirely, require manual resolution)
- **Performance Strategy**: Always update all packages (maintains version-locked strategy)

### 1.3 Architecture Principles

1. **Atomic Operations**: All version updates must be transactional (all or nothing)
2. **Idempotency**: Running operations multiple times produces same result
3. **Fail-Fast**: Detect errors early and provide clear recovery paths (block commit on any error)
4. **Zero-Config**: Works out of box with sensible defaults
5. **Performance**: Pre-commit hook completes in <2 seconds
6. **Auditability**: All decisions logged with rationale and timestamps
7. **Security-First**: Input sanitization and validation for all external inputs

---

## 2. System Architecture

### 2.1 Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer Workflow                        │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Pre-Commit Hook (Husky)                                    │
│  - Parse commit message (conventional-commits-parser)       │
│  - Sanitize and validate input                              │
│  - Determine version bump                                   │
│  - Update version files                                     │
│  - Log to audit trail                                       │
│  - Stage changes                                            │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Version Bump Engine                                        │
│  ┌─────────────────┐ ┌────────────────┐ ┌────────────────┐ │
│  │ Conventional    │ │  Semver        │ │  File          │ │
│  │ Commit Parser   │ │  Resolver      │ │  Synchronizer  │ │
│  │ (library)       │ │                │ │  (atomic)      │ │
│  └─────────────────┘ └────────────────┘ └────────────────┘ │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  Cascade Engine (Version-Locked Strategy)                   │
│  - Detect constituent plugin changes                        │
│  - Apply precedence rules                                   │
│  - Update ALL packages to same version                      │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  File System Updates (Atomic)                               │
│  - plugin.json × 25                                         │
│  - package.json × 25                                        │
│  - marketplace.json                                         │
│  - CHANGELOG.md                                             │
│  - .version-bumps.log (audit trail)                         │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  CI/CD Validation (GitHub Actions)                          │
│  - Version consistency checks (PR validation)               │
│  - Cascade verification                                     │
│  - Format validation                                        │
│  - Pre-push hooks (catch before remote push)                │
│  - Release automation (GitHub releases)                     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
Commit Message → Input Sanitization → Parser (conventional-commits-parser)
                                            ↓
                                      Bump Type Determination
                                            ↓
                                      Current Versions (ALL 25 packages)
                                            ↓
                                      New Versions (version-locked)
                                            ↓
                                    Atomic File Updates
                                            ↓
                                  Audit Log Entry (timestamped)
                                            ↓
                                  Changelog Generation
                                            ↓
                                    Git Stage & Commit
                                            ↓
                                    Pre-push Hook Validation
                                            ↓
                                    GitHub Actions PR Check
                                            ↓
                                    Release Automation (on merge)
```

---

## 3. Technical Components

### 3.1 Conventional Commit Parser

#### 3.1.1 Library Selection

**Decision: Use `conventional-commits-parser` library**

**Rationale:**
- Battle-tested with 5M+ weekly downloads
- Maintained by conventional-changelog team
- Robust edge case handling (malformed commits, unusual formats)
- Full spec compliance with Conventional Commits 1.0.0
- Comprehensive test coverage

**Installation:**
```json
{
  "dependencies": {
    "conventional-commits-parser": "^5.0.0"
  }
}
```

#### 3.1.2 Configuration

```typescript
import parser from 'conventional-commits-parser';

const parserOptions = {
  headerPattern: /^(\w*)(?:\(([^\)]*)\))?!?: (.*)$/,
  headerCorrespondence: ['type', 'scope', 'subject'],
  noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
  revertPattern: /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
  revertCorrespondence: ['header', 'hash'],
  issuePrefixes: ['#'],
  // Strict mode: fail on parse errors
  strict: true,
};
```

#### 3.1.3 Interface

```typescript
interface CommitMessage {
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
    action: string;
    owner?: string;
    repository?: string;
    issue: string;
    raw: string;
    prefix: string;
  }>;
}

interface ParseResult {
  bumpType: 'major' | 'minor' | 'patch' | 'none';
  commits: CommitMessage[];
  affectedPackages: string[];
}

function parseConventionalCommit(message: string): CommitMessage;
function determineBumpType(commits: CommitMessage[]): 'major' | 'minor' | 'patch' | 'none';
```

#### 3.1.4 Parsing Implementation

```typescript
import parser from 'conventional-commits-parser';
import { sanitizeCommitMessage } from './security';

function parseConventionalCommit(message: string): CommitMessage {
  // 1. Input sanitization (security layer)
  const sanitized = sanitizeCommitMessage(message);

  // 2. Parse with conventional-commits-parser
  const parsed = parser.sync(sanitized, parserOptions);

  // 3. Detect breaking changes
  const hasBreakingFlag = parsed.type?.endsWith('!');
  const hasBreakingNote = (parsed.notes || []).some(
    note => note.title === 'BREAKING CHANGE'
  );

  return {
    type: parsed.type?.replace('!', '') || 'unknown',
    scope: parsed.scope || undefined,
    breaking: hasBreakingFlag || hasBreakingNote,
    subject: parsed.subject || '',
    body: parsed.body || undefined,
    footer: parsed.footer || undefined,
    notes: parsed.notes,
    references: parsed.references,
  };
}
```

#### 3.1.5 Bump Type Determination

```typescript
function determineBumpType(commits: CommitMessage[]): 'major' | 'minor' | 'patch' | 'none' {
  const types: BumpType[] = [];

  for (const commit of commits) {
    if (commit.breaking) {
      types.push('major');
    } else if (commit.type === 'feat') {
      types.push('minor');
    } else if (commit.type === 'fix') {
      types.push('patch');
    } else {
      types.push('none');
    }
  }

  return applyPrecedence(types);
}
```

#### 3.1.6 Precedence Algorithm

```typescript
function applyPrecedence(bumpTypes: BumpType[]): 'major' | 'minor' | 'patch' | 'none' {
  if (bumpTypes.includes('major')) return 'major';
  if (bumpTypes.includes('minor')) return 'minor';
  if (bumpTypes.includes('patch')) return 'patch';
  return 'none';
}
```

---

## 4. Error Handling Strategy (Fail-Fast Approach)

### 4.1 Philosophy

**Fail-Fast Principle:**
- Block commit entirely on ANY error
- No partial updates or "best effort" behavior
- Require explicit manual resolution before commit can proceed
- Clear error messages with actionable recovery steps

**Benefits:**
- Prevents inconsistent state
- Forces immediate attention to issues
- Audit trail remains clean
- Simpler rollback/recovery logic

### 4.2 Error Types & Handling

```typescript
export class VersionError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoveryAction: string,
    public exitCode: number = 1
  ) {
    super(message);
    this.name = 'VersionError';
  }
}

export const ErrorCodes = {
  PARSE_ERROR: {
    code: 'E001',
    message: 'Failed to parse commit message',
    recovery: 'Use conventional commit format: type(scope): subject'
  },
  INVALID_VERSION: {
    code: 'E002',
    message: 'Invalid semver version detected',
    recovery: 'Run `npm run fix-versions` to repair'
  },
  VERSION_MISMATCH: {
    code: 'E003',
    message: 'Version mismatch across files',
    recovery: 'Run `npm run fix-versions` to synchronize'
  },
  MERGE_CONFLICT: {
    code: 'E004',
    message: 'Merge conflict in version files',
    recovery: 'Resolve conflicts manually, then run `npm run fix-versions`'
  },
  FILE_IO_ERROR: {
    code: 'E005',
    message: 'File system operation failed',
    recovery: 'Check file permissions and retry'
  },
  ATOMIC_TRANSACTION_FAILED: {
    code: 'E006',
    message: 'Atomic transaction rollback occurred',
    recovery: 'Check disk space and file locks, then retry'
  },
  CASCADE_ERROR: {
    code: 'E007',
    message: 'Cascade to ensemble-full failed',
    recovery: 'Verify ensemble-full package structure'
  },
  VALIDATION_ERROR: {
    code: 'E008',
    message: 'Version validation failed',
    recovery: 'Run `npm run validate-versions` for details'
  },
  MALFORMED_COMMIT: {
    code: 'E009',
    message: 'Commit message does not follow conventional format',
    recovery: 'Use format: type(scope): description. Examples: feat(core): add utility, fix(router): resolve bug'
  },
  EMPTY_COMMIT_MESSAGE: {
    code: 'E010',
    message: 'Commit message is empty or whitespace-only',
    recovery: 'Provide a meaningful commit message following conventional commits format'
  },
  INPUT_SANITIZATION_FAILED: {
    code: 'E011',
    message: 'Commit message contains invalid or potentially dangerous characters',
    recovery: 'Use only alphanumeric characters, spaces, hyphens, underscores, and standard punctuation'
  }
} as const;
```

### 4.3 Pre-Commit Hook Error Handling

```typescript
async function preCommitHook(): Promise<void> {
  let commitMsg: string;
  let parsed: CommitMessage;

  try {
    // 1. Get staged commit message
    commitMsg = await getStagedCommitMessage();

    // 2. Validate not empty/whitespace
    if (!commitMsg || commitMsg.trim().length === 0) {
      throw new VersionError(
        ErrorCodes.EMPTY_COMMIT_MESSAGE.message,
        ErrorCodes.EMPTY_COMMIT_MESSAGE.code,
        ErrorCodes.EMPTY_COMMIT_MESSAGE.recovery
      );
    }

    // 3. Sanitize input (security check)
    const sanitized = sanitizeCommitMessage(commitMsg);
    if (sanitized !== commitMsg) {
      throw new VersionError(
        ErrorCodes.INPUT_SANITIZATION_FAILED.message,
        ErrorCodes.INPUT_SANITIZATION_FAILED.code,
        ErrorCodes.INPUT_SANITIZATION_FAILED.recovery
      );
    }

    // 4. Parse conventional commit (strict mode)
    try {
      parsed = parseConventionalCommit(commitMsg);
    } catch (parseError) {
      throw new VersionError(
        ErrorCodes.MALFORMED_COMMIT.message,
        ErrorCodes.MALFORMED_COMMIT.code,
        ErrorCodes.MALFORMED_COMMIT.recovery
      );
    }

    // 5. Determine bump type
    const bumpType = determineBumpType([parsed]);

    if (bumpType === 'none') {
      console.log('ℹ️  No version bump (non-versioning commit type)');
      return;
    }

    // 6. Check for merge conflicts in version files
    const hasConflicts = await detectMergeConflicts();
    if (hasConflicts) {
      throw new VersionError(
        ErrorCodes.MERGE_CONFLICT.message,
        ErrorCodes.MERGE_CONFLICT.code,
        ErrorCodes.MERGE_CONFLICT.recovery
      );
    }

    // 7. Calculate new versions (ALL 25 packages for version-locked strategy)
    const updates = await calculateVersionUpdates(bumpType);

    // 8. Validate all versions before proceeding
    for (const update of updates) {
      if (!validateVersion(update.newVersion)) {
        throw new VersionError(
          `${ErrorCodes.INVALID_VERSION.message}: ${update.package} -> ${update.newVersion}`,
          ErrorCodes.INVALID_VERSION.code,
          ErrorCodes.INVALID_VERSION.recovery
        );
      }
    }

    // 9. Preview changes
    console.log('📦 Version bump preview:');
    console.log(`   Bump type: ${bumpType}`);
    console.log(`   New version: ${updates[0].newVersion} (all packages - version-locked)`);
    console.log(`   Affected: ${updates.length} packages`);

    // 10. Apply updates atomically (all or nothing)
    await synchronizeVersions(updates);

    // 11. Generate changelog
    await generateChangelog([parsed], updates[0].newVersion);

    // 12. Audit log (timestamped)
    await logAudit({
      timestamp: new Date().toISOString(),
      operation: 'bump',
      user: process.env.USER || 'unknown',
      changes: updates,
      reason: `${bumpType} bump from commit: ${parsed.type}${parsed.scope ? `(${parsed.scope})` : ''}: ${parsed.subject}`,
      commitSHA: await getCommitSHA()
    });

    // 13. Stage updated files
    const updatedFiles = [
      ...updates.flatMap(u => [
        `packages/${u.package}/.claude-plugin/plugin.json`,
        `packages/${u.package}/package.json`
      ]),
      'marketplace.json',
      'CHANGELOG.md',
      '.version-bumps.log'
    ];

    await stageFiles(updatedFiles);

    console.log(`\n✓ Updated ${updatedFiles.length} files`);
    console.log('✓ All versions synchronized to', updates[0].newVersion);
    console.log('✓ Audit log updated');

  } catch (error) {
    // FAIL-FAST: Block commit on any error
    if (error instanceof VersionError) {
      console.error(`\n❌ ${error.code}: ${error.message}`);
      console.error(`\n🔧 Recovery: ${error.recoveryAction}\n`);
      process.exit(error.exitCode);
    } else {
      console.error('\n❌ Unexpected error during version bump:', error.message);
      console.error('\n🔧 Recovery: Check logs and run `npm run fix-versions`\n');
      process.exit(1);
    }
  }
}
```

### 4.4 Edge Case Handling

#### 4.4.1 Malformed Commits

**Strict vs Lenient Parser Behavior:**

```typescript
// Configuration: STRICT mode (fail-fast)
const parserOptions = {
  ...baseOptions,
  strict: true,  // Throw on parse errors
};

// Malformed examples that will BLOCK commit:
const malformedExamples = [
  'add feature',                    // Missing type
  'feat add feature',               // Missing colon
  'feat(): add feature',            // Empty scope
  'FEAT(core): add feature',        // Uppercase type (should be lowercase)
  'feat(core) add feature',         // Missing colon
  'feat(core)!add feature',         // Missing space after !
];

function parseConventionalCommit(message: string): CommitMessage {
  try {
    const parsed = parser.sync(message, parserOptions);

    // Additional strict validation
    if (!parsed.type) {
      throw new Error('Missing commit type');
    }

    if (parsed.type !== parsed.type.toLowerCase()) {
      throw new Error('Commit type must be lowercase');
    }

    if (!parsed.subject || parsed.subject.trim().length === 0) {
      throw new Error('Missing commit subject');
    }

    return {
      type: parsed.type.replace('!', ''),
      scope: parsed.scope || undefined,
      breaking: parsed.type?.endsWith('!') || (parsed.notes || []).some(n => n.title === 'BREAKING CHANGE'),
      subject: parsed.subject,
      body: parsed.body || undefined,
      footer: parsed.footer || undefined,
      notes: parsed.notes,
      references: parsed.references,
    };
  } catch (error) {
    throw new VersionError(
      `${ErrorCodes.MALFORMED_COMMIT.message}: ${error.message}`,
      ErrorCodes.MALFORMED_COMMIT.code,
      ErrorCodes.MALFORMED_COMMIT.recovery
    );
  }
}
```

#### 4.4.2 Empty or Whitespace-Only Commits

```typescript
async function getStagedCommitMessage(): Promise<string> {
  const message = await fs.readFile('.git/COMMIT_EDITMSG', 'utf8');

  // Remove git comment lines
  const cleaned = message
    .split('\n')
    .filter(line => !line.startsWith('#'))
    .join('\n')
    .trim();

  if (cleaned.length === 0) {
    throw new VersionError(
      ErrorCodes.EMPTY_COMMIT_MESSAGE.message,
      ErrorCodes.EMPTY_COMMIT_MESSAGE.code,
      ErrorCodes.EMPTY_COMMIT_MESSAGE.recovery
    );
  }

  return cleaned;
}
```

**Decision: Empty commits are BLOCKED**
- Rationale: No semantic meaning = no version bump possible
- Recovery: Provide a meaningful commit message
- Exception: `--allow-empty` flag bypasses hook (for special cases like CI triggers)

---

## 5. Security Controls

### 5.1 Input Sanitization

```typescript
// lib/security.ts

/**
 * Sanitize commit message to prevent injection attacks
 * Validates and cleans input before passing to parser
 */
export function sanitizeCommitMessage(message: string): string {
  // 1. Remove null bytes (prevents null byte injection)
  let sanitized = message.replace(/\0/g, '');

  // 2. Normalize line endings (prevent CRLF injection)
  sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Limit length (prevent DoS via enormous commit messages)
  const MAX_LENGTH = 10000; // 10KB
  if (sanitized.length > MAX_LENGTH) {
    throw new VersionError(
      `Commit message exceeds maximum length (${MAX_LENGTH} characters)`,
      'E011',
      'Shorten your commit message'
    );
  }

  // 4. Validate allowed characters (alphanumeric, spaces, common punctuation)
  // Allow: a-z, A-Z, 0-9, space, -, _, :, !, (, ), #, ., ,, ;, newline
  const allowedPattern = /^[a-zA-Z0-9\s\-_:!()#.,;\n]+$/;
  if (!allowedPattern.test(sanitized)) {
    const invalidChars = sanitized
      .split('')
      .filter(char => !allowedPattern.test(char))
      .join('');
    throw new VersionError(
      `Commit message contains invalid characters: ${invalidChars}`,
      ErrorCodes.INPUT_SANITIZATION_FAILED.code,
      ErrorCodes.INPUT_SANITIZATION_FAILED.recovery
    );
  }

  // 5. Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Validate semver version string (strict)
 */
export function validateVersion(version: string): boolean {
  // Strict semver: MAJOR.MINOR.PATCH (no pre-release, no build metadata)
  const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  return semverRegex.test(version);
}

/**
 * Validate file path is within allowed directories
 */
export function validateFilePath(path: string): boolean {
  // Prevent directory traversal attacks
  const normalized = path.normalize('NFD');

  // Block path traversal patterns
  if (normalized.includes('..') || normalized.startsWith('/')) {
    return false;
  }

  // Whitelist allowed directories
  const allowedPrefixes = [
    'packages/',
    'marketplace.json',
    'CHANGELOG.md',
    '.version-bumps.log'
  ];

  return allowedPrefixes.some(prefix => normalized.startsWith(prefix));
}
```

### 5.2 Audit Logging (Timestamped)

```typescript
// lib/audit.ts

export interface AuditLogEntry {
  timestamp: string;          // ISO 8601 format
  operation: 'bump' | 'cascade' | 'fix' | 'validate';
  user: string;               // System user
  commitSHA?: string;         // Git commit SHA
  changes: VersionInfo[];     // All version changes
  reason: string;             // Human-readable explanation
  bumpType?: BumpType;        // Type of bump (major/minor/patch)
  filesModified: string[];    // List of files changed
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const logPath = '.version-bumps.log';

  // Format log entry as JSON Lines (JSONL)
  const logLine = JSON.stringify({
    timestamp: entry.timestamp || new Date().toISOString(),
    operation: entry.operation,
    user: entry.user || process.env.USER || 'unknown',
    commitSHA: entry.commitSHA,
    changes: entry.changes.map(c => ({
      package: c.package,
      from: c.currentVersion,
      to: c.newVersion,
      bump: c.bumpType
    })),
    reason: entry.reason,
    bumpType: entry.bumpType,
    filesModified: entry.filesModified || [],
  }) + '\n';

  // Append to log (never truncate)
  await fs.appendFile(logPath, logLine);

  // Also log to console for immediate visibility
  console.log('📝 Audit log entry created:', {
    operation: entry.operation,
    timestamp: entry.timestamp,
    affectedPackages: entry.changes.length
  });
}

/**
 * Query audit log for specific operations or time ranges
 */
export async function queryAuditLog(options: {
  operation?: string;
  user?: string;
  since?: Date;
  package?: string;
}): Promise<AuditLogEntry[]> {
  const logPath = '.version-bumps.log';

  if (!await fs.pathExists(logPath)) {
    return [];
  }

  const content = await fs.readFile(logPath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  const entries = lines.map(line => JSON.parse(line) as AuditLogEntry);

  // Apply filters
  return entries.filter(entry => {
    if (options.operation && entry.operation !== options.operation) return false;
    if (options.user && entry.user !== options.user) return false;
    if (options.since && new Date(entry.timestamp) < options.since) return false;
    if (options.package && !entry.changes.some(c => c.package === options.package)) return false;
    return true;
  });
}

/**
 * Generate audit report for compliance/review
 */
export async function generateAuditReport(since?: Date): Promise<string> {
  const entries = await queryAuditLog({ since });

  const report = [
    '# Version Management Audit Report',
    `Generated: ${new Date().toISOString()}`,
    `Period: ${since ? since.toISOString() : 'All time'} - ${new Date().toISOString()}`,
    `Total operations: ${entries.length}`,
    '',
    '## Summary',
    `- Bumps: ${entries.filter(e => e.operation === 'bump').length}`,
    `- Cascades: ${entries.filter(e => e.operation === 'cascade').length}`,
    `- Fixes: ${entries.filter(e => e.operation === 'fix').length}`,
    `- Validations: ${entries.filter(e => e.operation === 'validate').length}`,
    '',
    '## Detailed Log',
    ...entries.map(entry =>
      `- ${entry.timestamp} | ${entry.operation} | ${entry.user} | ${entry.changes.length} packages | ${entry.reason}`
    )
  ].join('\n');

  return report;
}
```

### 5.3 Threat Model & Mitigations

| Threat | Severity | Mitigation | Implementation |
|--------|----------|------------|----------------|
| Malicious commit messages with injection | High | Sanitize all input, validate character set | `sanitizeCommitMessage()` with allowlist |
| File system access beyond version files | Medium | Restrict write access to whitelisted paths | `validateFilePath()` with directory checks |
| Unauthorized version downgrades | High | Enforce semver never-decrease rule | Validation in `bumpVersion()` |
| Git hook bypass via `--no-verify` | Low | CI validation catches inconsistencies | GitHub Actions PR checks |
| Race conditions in concurrent commits | Medium | Use file locking for atomic updates | Atomic transaction with backups |
| Denial of service via large inputs | Medium | Limit commit message length | 10KB max in `sanitizeCommitMessage()` |
| Path traversal attacks | High | Normalize paths, block `..` patterns | `validateFilePath()` normalization |
| Null byte injection | High | Strip null bytes from input | `replace(/\0/g, '')` in sanitization |
| CRLF injection | Medium | Normalize line endings | Convert CRLF to LF |

---

## 6. CI/CD Integration Points (Phase 1)

### 6.1 GitHub Actions PR Checks

#### 6.1.1 Version Consistency Validation

```yaml
# .github/workflows/validate-pr.yml

name: Validate Version Consistency

on:
  pull_request:
    types: [opened, synchronize, reopened]
  push:
    branches: [main, develop]

jobs:
  validate-versions:
    runs-on: ubuntu-latest
    name: Version Consistency Check

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for version comparison

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci --legacy-peer-deps

      - name: Validate version consistency
        run: npm run validate-versions
        id: validate

      - name: Check version-locked strategy
        run: npm run validate-version-locked

      - name: Verify cascade to ensemble-full
        run: npm run validate-cascade

      - name: Check marketplace.json consistency
        run: npm run validate-marketplace

      - name: Comment PR with results
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ Version validation failed. Run `npm run fix-versions` to repair inconsistencies.'
            })
```

#### 6.1.2 Block Bad Merges

```yaml
# .github/workflows/block-bad-merge.yml

name: Block Invalid Version Changes

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  check-version-changes:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Check for version downgrades
        run: |
          npm run check-version-downgrades
          if [ $? -ne 0 ]; then
            echo "❌ Version downgrade detected. Versions must never decrease."
            exit 1
          fi

      - name: Check for version-locked violations
        run: |
          npm run check-version-locked-violations
          if [ $? -ne 0 ]; then
            echo "❌ Not all packages have same version (version-locked strategy)."
            exit 1
          fi

      - name: Validate conventional commit messages
        uses: wagoid/commitlint-github-action@v5
        with:
          configFile: commitlint.config.js
```

### 6.2 Pre-Push Hooks

#### 6.2.1 Catch Issues Before Remote Push

```bash
# .husky/pre-push

#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "🔍 Running pre-push validation..."

# 1. Validate version consistency
npm run validate-versions || {
  echo "❌ Version validation failed"
  echo "🔧 Run 'npm run fix-versions' to repair"
  exit 1
}

# 2. Check for uncommitted version changes
if git diff --name-only | grep -q "plugin.json\|package.json\|marketplace.json"; then
  echo "❌ Uncommitted version file changes detected"
  echo "🔧 Commit or stash changes before pushing"
  exit 1
fi

# 3. Verify all commits use conventional format
npm run validate-commit-messages || {
  echo "❌ Non-conventional commits detected"
  echo "🔧 Use format: type(scope): description"
  exit 1
}

echo "✅ Pre-push validation passed"
```

#### 6.2.2 Configuration

```json
// package.json
{
  "scripts": {
    "validate-versions": "node scripts/validate-versions.js",
    "validate-version-locked": "node scripts/validate-version-locked.js",
    "validate-cascade": "node scripts/validate-cascade.js",
    "validate-marketplace": "node scripts/validate-marketplace.js",
    "validate-commit-messages": "node scripts/validate-commit-messages.js",
    "check-version-downgrades": "node scripts/check-version-downgrades.js",
    "check-version-locked-violations": "node scripts/check-version-locked-violations.js"
  }
}
```

### 6.3 Release Automation

#### 6.3.1 Auto-Create GitHub Releases on Version Changes

```yaml
# .github/workflows/auto-release.yml

name: Auto-Create GitHub Release

on:
  push:
    branches:
      - main
    paths:
      - 'packages/*/package.json'
      - 'marketplace.json'

jobs:
  detect-version-change:
    runs-on: ubuntu-latest
    outputs:
      version_changed: ${{ steps.check.outputs.changed }}
      new_version: ${{ steps.check.outputs.version }}

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2  # Need previous commit for comparison

      - name: Check if version changed
        id: check
        run: |
          # Get version from package.json (any package, all are same due to version-locked)
          NEW_VERSION=$(jq -r '.version' packages/core/package.json)

          # Get version from previous commit
          git checkout HEAD~1
          OLD_VERSION=$(jq -r '.version' packages/core/package.json)
          git checkout -

          if [ "$NEW_VERSION" != "$OLD_VERSION" ]; then
            echo "changed=true" >> $GITHUB_OUTPUT
            echo "version=$NEW_VERSION" >> $GITHUB_OUTPUT
            echo "✅ Version changed: $OLD_VERSION → $NEW_VERSION"
          else
            echo "changed=false" >> $GITHUB_OUTPUT
            echo "ℹ️ No version change detected"
          fi

  create-release:
    needs: detect-version-change
    if: needs.detect-version-change.outputs.version_changed == 'true'
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Extract changelog for version
        id: changelog
        run: |
          VERSION="${{ needs.detect-version-change.outputs.new_version }}"

          # Extract section from CHANGELOG.md for this version
          CHANGELOG=$(awk "/## \[$VERSION\]/,/## \[/{if (/## \[/ && !first) {first=1; next}; if (/## \[/) exit; print}" CHANGELOG.md)

          # Save to file for GitHub release
          echo "$CHANGELOG" > release-notes.md

      - name: Create Git tag
        run: |
          VERSION="${{ needs.detect-version-change.outputs.new_version }}"
          git tag "v$VERSION" -m "Release v$VERSION"
          git push origin "v$VERSION"

      - name: Create GitHub Release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: v${{ needs.detect-version-change.outputs.new_version }}
          release_name: Ensemble v${{ needs.detect-version-change.outputs.new_version }}
          body_path: release-notes.md
          draft: false
          prerelease: false

      - name: Publish to npm (optional)
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          echo "//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}" > .npmrc
          npm run publish:changed
```

#### 6.3.2 Release Notification

```yaml
# .github/workflows/release-notification.yml

name: Release Notification

on:
  release:
    types: [published]

jobs:
  notify:
    runs-on: ubuntu-latest

    steps:
      - name: Send Slack notification
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "🚀 New Ensemble release: ${{ github.event.release.tag_name }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*New Release Published*\n\nVersion: `${{ github.event.release.tag_name }}`\n\n${{ github.event.release.body }}"
                  }
                },
                {
                  "type": "actions",
                  "elements": [
                    {
                      "type": "button",
                      "text": {
                        "type": "plain_text",
                        "text": "View Release"
                      },
                      "url": "${{ github.event.release.html_url }}"
                    }
                  ]
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## 7. Testing Strategy (Mission-Critical Tests)

### 7.1 Breaking Changes Cascade (Mission-Critical)

```typescript
// tests/integration/breaking-changes-cascade.test.ts

describe('Breaking Changes Cascade (Mission-Critical)', () => {
  let testRepo: TestRepository;

  beforeEach(async () => {
    testRepo = await createTestRepository();
    await testRepo.setVersion('5.1.0'); // All packages start at 5.1.0
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  test('breaking change in single package bumps ALL packages to major', async () => {
    // Change only ensemble-core
    await testRepo.writeFile('packages/core/lib/index.js', 'export const breaking = true;');
    await testRepo.stage('packages/core/lib/index.js');

    // Execute breaking change commit
    await testRepo.commit('feat(core)!: rewrite API');

    // Verify ALL 25 packages bumped to 6.0.0
    const allPackages = await testRepo.getAllPackages();
    for (const pkg of allPackages) {
      const version = await testRepo.getVersion(pkg);
      expect(version).toBe('6.0.0');
    }

    // Verify marketplace.json updated
    const marketplace = await testRepo.readJson('marketplace.json');
    for (const plugin of marketplace.plugins) {
      expect(plugin.version).toBe('6.0.0');
    }

    // Verify audit log
    const auditEntries = await testRepo.getAuditLog();
    const lastEntry = auditEntries[auditEntries.length - 1];
    expect(lastEntry.operation).toBe('bump');
    expect(lastEntry.bumpType).toBe('major');
    expect(lastEntry.changes.length).toBe(25);
  });

  test('breaking change with BREAKING CHANGE footer cascades correctly', async () => {
    await testRepo.writeFile('packages/git/lib/index.js', 'export const breaking = true;');
    await testRepo.stage('packages/git/lib/index.js');

    const commitMsg = `feat(git): update workflow

BREAKING CHANGE: Workflow API changed`;

    await testRepo.commit(commitMsg);

    // All packages should be at 6.0.0
    const versions = await testRepo.getAllVersions();
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toBe('6.0.0');
  });

  test('multiple breaking changes in same commit use single major bump', async () => {
    await testRepo.writeFile('packages/core/lib/index.js', 'export const core = true;');
    await testRepo.writeFile('packages/git/lib/index.js', 'export const git = true;');
    await testRepo.stage(['packages/core/lib/index.js', 'packages/git/lib/index.js']);

    await testRepo.commit('feat!: rewrite core and git APIs');

    // Should bump from 5.1.0 to 6.0.0 (not 7.0.0)
    const versions = await testRepo.getAllVersions();
    expect(versions.every(v => v === '6.0.0')).toBe(true);
  });

  test('breaking change in ensemble-full only bumps all packages', async () => {
    await testRepo.writeFile('packages/full/lib/index.js', 'export const full = true;');
    await testRepo.stage('packages/full/lib/index.js');

    await testRepo.commit('feat(full)!: breaking change');

    // All packages (including full itself) should be 6.0.0
    const versions = await testRepo.getAllVersions();
    expect(versions.every(v => v === '6.0.0')).toBe(true);
  });

  test('precedence: breaking > minor > patch cascades correctly', async () => {
    // Simulate PR with multiple commits
    const commits = [
      { msg: 'fix(core): patch fix', type: 'patch' },
      { msg: 'feat(git): minor feature', type: 'minor' },
      { msg: 'feat(router)!: breaking change', type: 'major' }
    ];

    // Determine highest precedence (should be major)
    const bumpTypes = commits.map(c => c.type);
    const finalBump = applyPrecedence(bumpTypes);

    expect(finalBump).toBe('major');

    // Simulate bump
    await testRepo.bumpVersion(finalBump);

    // All should be 6.0.0
    const versions = await testRepo.getAllVersions();
    expect(versions.every(v => v === '6.0.0')).toBe(true);
  });
});
```

### 7.2 Cross-Platform Behavior (Mission-Critical)

```typescript
// tests/integration/cross-platform.test.ts

describe('Cross-Platform Behavior (Mission-Critical)', () => {
  const platforms = ['linux', 'darwin', 'win32'];

  describe.each(platforms)('Platform: %s', (platform) => {
    let testRepo: TestRepository;

    beforeEach(async () => {
      testRepo = await createTestRepository({ platform });
    });

    afterEach(async () => {
      await testRepo.cleanup();
    });

    test('Windows paths handled correctly', async () => {
      // Windows uses backslashes, Unix uses forward slashes
      const packagePath = platform === 'win32'
        ? 'packages\\core\\package.json'
        : 'packages/core/package.json';

      const normalized = normalizePath(packagePath);
      expect(normalized).toBe('packages/core/package.json');

      // File operations should work regardless
      const version = await testRepo.getVersion('core');
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('Line endings handled correctly (CRLF vs LF)', async () => {
      // Create commit message with platform-specific line endings
      const subject = 'feat(core): add utility';
      const body = 'This is the body';

      const commitMsg = platform === 'win32'
        ? `${subject}\r\n\r\n${body}`  // CRLF (Windows)
        : `${subject}\n\n${body}`;      // LF (Unix)

      // Parser should normalize to LF internally
      const parsed = parseConventionalCommit(commitMsg);
      expect(parsed.subject).toBe('add utility');
      expect(parsed.body).toBe(body);

      // Changelog should use LF consistently
      const changelog = await testRepo.generateChangelog(parsed, '5.2.0');
      expect(changelog).not.toContain('\r\n');
      expect(changelog).toContain('\n');
    });

    test('File permissions preserved (Unix) or handled (Windows)', async () => {
      if (platform === 'win32') {
        // Windows doesn't have Unix-style permissions
        // Verify files are created with correct attributes
        await testRepo.writeFile('test.json', '{}');
        const stats = await fs.stat('test.json');
        expect(stats.mode).toBeDefined();
      } else {
        // Unix: verify permissions preserved
        const scriptPath = 'scripts/bump-versions.js';
        await fs.chmod(scriptPath, 0o755); // rwxr-xr-x

        await testRepo.bumpVersion('minor');

        const stats = await fs.stat(scriptPath);
        expect(stats.mode & 0o777).toBe(0o755);
      }
    });

    test('Path separators normalized in audit log', async () => {
      await testRepo.writeFile('packages/core/lib/index.js', 'export const test = true;');
      await testRepo.commit('feat(core): add test');

      const auditLog = await testRepo.getAuditLog();
      const lastEntry = auditLog[auditLog.length - 1];

      // All paths in audit log should use forward slashes (cross-platform)
      for (const file of lastEntry.filesModified) {
        expect(file).not.toContain('\\');
        expect(file).toMatch(/^packages\//);
      }
    });

    test('Environment variables handled correctly', async () => {
      // Windows uses %VAR%, Unix uses $VAR
      const user = platform === 'win32'
        ? process.env.USERNAME || 'unknown'
        : process.env.USER || 'unknown';

      await testRepo.commit('feat(core): add feature');

      const auditLog = await testRepo.getAuditLog();
      const lastEntry = auditLog[auditLog.length - 1];

      expect(lastEntry.user).toBe(user);
      expect(lastEntry.user).not.toBe('unknown'); // Should resolve
    });

    test('Git operations work across platforms', async () => {
      // Test git commands that may differ (status, diff, etc.)
      const changedFiles = await testRepo.getChangedPackages();
      expect(Array.isArray(changedFiles)).toBe(true);

      const currentSHA = await testRepo.getCommitSHA();
      expect(currentSHA).toMatch(/^[0-9a-f]{40}$/); // Full SHA
    });

    test('JSON file encoding consistent (UTF-8)', async () => {
      // Test special characters in commit messages
      const specialChars = 'feat(core): add üñïçödé support';

      await testRepo.commit(specialChars);

      // Changelog should preserve UTF-8 encoding
      const changelog = await fs.readFile('CHANGELOG.md', 'utf8');
      expect(changelog).toContain('üñïçödé');

      // Audit log should preserve UTF-8
      const auditLog = await fs.readFile('.version-bumps.log', 'utf8');
      const lastLine = auditLog.split('\n').slice(-2)[0]; // -2 because last is empty
      expect(lastLine).toContain('üñïçödé');
    });
  });

  test('Atomic transactions work on all platforms', async () => {
    // Test rollback behavior
    const testRepo = await createTestRepository();

    // Force a failure mid-transaction
    jest.spyOn(fs, 'writeFile').mockImplementationOnce(() => {
      throw new Error('Simulated write failure');
    });

    const initialVersions = await testRepo.getAllVersions();

    try {
      await testRepo.bumpVersion('minor');
      fail('Should have thrown error');
    } catch (error) {
      // Verify rollback: all versions should be unchanged
      const rolledBackVersions = await testRepo.getAllVersions();
      expect(rolledBackVersions).toEqual(initialVersions);
    }
  });
});
```

### 7.3 Additional Test Coverage Requirements

```typescript
// tests/integration/error-handling.test.ts

describe('Error Handling (Fail-Fast)', () => {
  test('malformed commit blocks commit entirely', async () => {
    const malformedCommits = [
      'add feature',              // Missing type
      'feat add feature',         // Missing colon
      'FEAT(core): uppercase',    // Uppercase type
    ];

    for (const commit of malformedCommits) {
      await expect(preCommitHook(commit)).rejects.toThrow(VersionError);
      await expect(preCommitHook(commit)).rejects.toMatchObject({
        code: 'E009',
        recoveryAction: expect.stringContaining('conventional')
      });
    }
  });

  test('empty commit message blocks commit', async () => {
    const emptyCommits = ['', '   ', '\n\n', '\t\t'];

    for (const commit of emptyCommits) {
      await expect(preCommitHook(commit)).rejects.toThrow(VersionError);
      await expect(preCommitHook(commit)).rejects.toMatchObject({
        code: 'E010'
      });
    }
  });

  test('invalid characters trigger sanitization error', async () => {
    const maliciousCommits = [
      'feat(core): add feature\0null byte',
      'feat(core): <script>alert("xss")</script>',
      'feat(core): `rm -rf /`',
    ];

    for (const commit of maliciousCommits) {
      await expect(preCommitHook(commit)).rejects.toThrow(VersionError);
    }
  });
});

// tests/integration/audit-log.test.ts

describe('Audit Logging', () => {
  test('audit log entries have timestamps', async () => {
    await testRepo.commit('feat(core): add feature');

    const auditLog = await queryAuditLog({});
    const lastEntry = auditLog[auditLog.length - 1];

    expect(lastEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(lastEntry.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
  });

  test('audit log includes commit SHA', async () => {
    await testRepo.commit('feat(core): add feature');

    const auditLog = await queryAuditLog({});
    const lastEntry = auditLog[auditLog.length - 1];

    expect(lastEntry.commitSHA).toMatch(/^[0-9a-f]{40}$/);
  });

  test('audit log query filters work', async () => {
    const since = new Date();

    await testRepo.commit('feat(core): feature 1');
    await testRepo.commit('fix(git): bug fix');
    await testRepo.commit('feat(router): feature 2');

    const bumpEntries = await queryAuditLog({ operation: 'bump', since });
    expect(bumpEntries.length).toBe(3);

    const coreEntries = await queryAuditLog({ package: 'core', since });
    expect(coreEntries.length).toBeGreaterThanOrEqual(1);
  });
});
```

### 7.4 Test Coverage Requirements

- **Unit tests**: ≥90% coverage
- **Integration tests**: All critical paths (breaking changes, cross-platform, error handling)
- **Coverage tools**: Jest with coverage reports
- **CI enforcement**: Block PR merge if coverage drops below threshold

```json
// jest.config.js
{
  "coverageThreshold": {
    "global": {
      "branches": 90,
      "functions": 90,
      "lines": 90,
      "statements": 90
    }
  },
  "collectCoverageFrom": [
    "lib/**/*.{ts,js}",
    "scripts/**/*.{ts,js}",
    "!**/*.test.{ts,js}",
    "!**/node_modules/**"
  ]
}
```

---

## 8. Performance Strategy (Always Update All Packages)

### 8.1 Design Decision

**Strategy: Always update all 25 packages simultaneously (version-locked)**

**Rationale:**
- Maintains version-locked strategy (simpler mental model)
- No need for change detection or partial updates
- Consistent user experience ("Ensemble 6.0.0" has clear meaning)
- Simpler implementation with fewer edge cases
- Atomic all-or-nothing updates reduce risk

**Performance Impact:**
- Update 50 files per commit (25 × 2 files each, plus marketplace.json + CHANGELOG.md)
- Target: <2 seconds total for pre-commit hook

### 8.2 Optimization Techniques

```typescript
// Parallel file reads
async function readAllVersions(): Promise<Map<string, string>> {
  const packages = getAllPackages();

  // Read all package.json files in parallel
  const versionPromises = packages.map(async pkg => {
    const version = await getPackageJsonVersion(pkg);
    return [pkg, version] as [string, string];
  });

  const versions = await Promise.all(versionPromises);
  return new Map(versions);
}

// Parallel file writes (atomic transaction)
async function synchronizeVersions(updates: VersionInfo[]): Promise<void> {
  const writePromises: Promise<void>[] = [];

  for (const update of updates) {
    // Write plugin.json and package.json in parallel
    writePromises.push(
      updatePluginJson(update),
      updatePackageJson(update)
    );
  }

  // Update marketplace.json (depends on all updates)
  writePromises.push(updateMarketplace(updates));

  // Execute all writes in parallel
  await Promise.all(writePromises);
}

// In-memory JSON parsing (avoid disk I/O)
const jsonCache = new Map<string, { content: any, mtime: number }>();

async function readJsonCached(path: string): Promise<any> {
  const stat = await fs.stat(path);
  const cached = jsonCache.get(path);

  if (cached && cached.mtime === stat.mtimeMs) {
    return cached.content;
  }

  const content = JSON.parse(await fs.readFile(path, 'utf8'));
  jsonCache.set(path, { content, mtime: stat.mtimeMs });
  return content;
}
```

### 8.3 Performance Benchmarks

```typescript
// tests/performance/benchmark.test.ts

describe('Performance Benchmarks', () => {
  test('pre-commit hook completes in <2 seconds', async () => {
    const start = performance.now();

    await testRepo.commit('feat(core): add feature');

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(2000); // 2 seconds
  });

  test('reading all 25 package versions in <200ms', async () => {
    const start = performance.now();

    const versions = await readAllVersions();

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(200); // 200ms
    expect(versions.size).toBe(25);
  });

  test('writing all 50 files in <300ms', async () => {
    const updates = getAllPackages().map(pkg => ({
      package: pkg,
      currentVersion: '5.1.0',
      newVersion: '5.2.0',
      bumpType: 'minor' as const
    }));

    const start = performance.now();

    await synchronizeVersions(updates);

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(300); // 300ms
  });

  test('parsing conventional commit in <10ms', async () => {
    const message = 'feat(core): add utility function';

    const start = performance.now();

    const parsed = parseConventionalCommit(message);

    const duration = performance.now() - start;
    expect(duration).toBeLessThan(10); // 10ms
  });
});
```

---

## 9. Implementation Phases (Updated)

### Phase 1: Core Automation (Weeks 1-2)

**Sprint 1.1: Foundation**
- [ ] Set up TypeScript project structure
- [ ] Install and configure `conventional-commits-parser` library
- [ ] Implement input sanitization layer
- [ ] Implement bump type determination
- [ ] Unit tests for parser and security (≥90% coverage)

**Sprint 1.2: File Operations**
- [ ] Implement file synchronizer (parallel writes)
- [ ] Add atomic transaction support with rollback
- [ ] Implement JSON formatting preservation
- [ ] Unit tests for file operations

**Sprint 1.3: Error Handling (Fail-Fast)**
- [ ] Implement VersionError class with recovery actions
- [ ] Add error handling for all edge cases (malformed, empty commits)
- [ ] Implement error logging and user messaging
- [ ] Unit tests for error scenarios

**Sprint 1.4: Pre-commit Hook**
- [ ] Install Husky
- [ ] Implement pre-commit hook script with fail-fast behavior
- [ ] Add version bump preview
- [ ] Integration tests for end-to-end flow

**Deliverables:**
- Working pre-commit hook with fail-fast error handling
- Conventional commit parsing using `conventional-commits-parser`
- Input sanitization and validation
- Version file synchronization (all 25 packages)
- Unit test suite (≥90% coverage)

### Phase 2: Version-Locked Strategy & Audit Logging (Week 3)

**Sprint 2.1: Version-Locked Implementation**
- [ ] Implement always-update-all-packages strategy
- [ ] Implement precedence algorithm (major > minor > patch)
- [ ] Performance optimization (parallel I/O)
- [ ] Unit tests for version-locked logic

**Sprint 2.2: Audit Logging**
- [ ] Implement timestamped audit log (JSONL format)
- [ ] Add commit SHA tracking
- [ ] Implement audit log query functions
- [ ] Add audit report generation
- [ ] Unit tests for audit logging

**Sprint 2.3: Integration**
- [ ] Integrate audit logging with pre-commit hook
- [ ] Update ensemble-full with all constituent packages
- [ ] Handle multiple package changes
- [ ] Integration tests for version-locked scenarios

**Deliverables:**
- Working version-locked strategy (all 25 packages)
- Timestamped audit log with commit context
- Multi-package change handling
- Integration test suite

### Phase 3: CI/CD Integration (Week 4)

**Sprint 3.1: GitHub Actions PR Checks**
- [ ] Implement validate-versions script
- [ ] Implement validate-version-locked script
- [ ] Implement validate-cascade script
- [ ] Create validate-pr.yml workflow
- [ ] Add PR comment automation on failure

**Sprint 3.2: Pre-Push Hooks**
- [ ] Implement pre-push hook
- [ ] Add version consistency checks
- [ ] Add conventional commit validation
- [ ] Test pre-push failure scenarios

**Sprint 3.3: Release Automation**
- [ ] Implement version change detection
- [ ] Create auto-release.yml workflow
- [ ] Add changelog extraction for releases
- [ ] Implement release notification (Slack/Discord)
- [ ] Test end-to-end release flow

**Sprint 3.4: Error Recovery & Changelog**
- [ ] Implement fix-versions command
- [ ] Add merge conflict detection
- [ ] Implement changelog generator
- [ ] Error recovery tests

**Deliverables:**
- GitHub Actions PR validation (block bad merges)
- Pre-push hooks (catch issues before remote push)
- Automated GitHub release creation
- fix-versions command
- Changelog automation

### Phase 4: Mission-Critical Testing & Cross-Platform (Week 5)

**Sprint 4.1: Breaking Changes Cascade Tests**
- [ ] Test single package breaking change cascades to all 25 packages
- [ ] Test BREAKING CHANGE footer detection
- [ ] Test multiple breaking changes in one commit
- [ ] Test precedence with mixed bump types
- [ ] Verify audit log entries for cascades

**Sprint 4.2: Cross-Platform Tests**
- [ ] Test Windows path handling (backslashes vs forward slashes)
- [ ] Test line ending normalization (CRLF vs LF)
- [ ] Test file permissions (Unix) and attributes (Windows)
- [ ] Test environment variable resolution (USER vs USERNAME)
- [ ] Test UTF-8 encoding across platforms
- [ ] Test atomic transactions on all platforms

**Sprint 4.3: Edge Case & Security Tests**
- [ ] Test malformed commit handling (strict mode)
- [ ] Test empty/whitespace commit handling
- [ ] Test input sanitization (injection prevention)
- [ ] Test audit log querying and reporting
- [ ] Performance benchmarks (<2s hook, <200ms reads, <300ms writes)

**Deliverables:**
- Complete test suite for breaking changes cascade
- Cross-platform test suite (Linux, macOS, Windows)
- Edge case test coverage (malformed, empty commits)
- Security test coverage (sanitization, validation)
- Performance benchmarks passing

### Phase 5: Documentation & Launch (Week 6)

**Sprint 5.1: Documentation**
- [ ] Update CLAUDE.md with version management guide
- [ ] Write migration guide for team
- [ ] Create troubleshooting guide (error code reference)
- [ ] Document configuration options (.versionrc.json)
- [ ] Document audit log format and querying

**Sprint 5.2: Testing & QA**
- [ ] End-to-end testing on all 25 packages
- [ ] Performance testing (hook <2s on real repo)
- [ ] Cross-platform testing (CI matrix: macOS, Linux, Windows)
- [ ] Security review (input validation, audit trail)
- [ ] Load testing (large commit messages, many files)

**Sprint 5.3: Launch**
- [ ] Team training session (error handling, recovery procedures)
- [ ] Beta period with core team (2 weeks)
- [ ] Gather feedback and fix issues
- [ ] Production rollout

**Deliverables:**
- Complete documentation (user guide + technical reference)
- Production-ready system with fail-fast error handling
- Team training materials
- Launch metrics baseline

---

## 10. Success Criteria (Updated)

### 10.1 Functional Requirements

- [ ] **FR-1**: Conventional commit detection using `conventional-commits-parser` library
- [ ] **FR-2**: Version files synchronized (plugin.json, package.json, marketplace.json) for all 25 packages
- [ ] **FR-3**: Version-locked strategy working (all packages maintain same version)
- [ ] **FR-4**: Pre-commit hook running with fail-fast error handling
- [ ] **FR-5**: GitHub Actions PR checks blocking bad merges
- [ ] **FR-6**: Pre-push hooks catching issues before remote push
- [ ] **FR-7**: Automated GitHub release creation on version changes
- [ ] **FR-8**: Changelog generation with Keep a Changelog format
- [ ] **FR-9**: Error recovery with fix-versions command
- [ ] **FR-10**: Timestamped audit logging with commit context

### 10.2 Non-Functional Requirements

- [ ] **Performance**: Pre-commit hook <2 seconds (p95)
- [ ] **Reliability**: 99.9% success rate for version bumps
- [ ] **Maintainability**: Unit tests ≥90% coverage
- [ ] **Usability**: Zero-config for standard workflows
- [ ] **Security**: Input sanitization and validation for all inputs
- [ ] **Cross-platform**: Works on macOS, Linux, Windows (CI tested)
- [ ] **Fail-fast**: All errors block commit with clear recovery steps

### 10.3 Mission-Critical Tests

- [ ] **Breaking changes cascade correctly** to all 25 packages
- [ ] **Cross-platform behavior** consistent (Windows, macOS, Linux)
- [ ] **Line endings normalized** (CRLF → LF)
- [ ] **File paths normalized** (backslash → forward slash in audit log)
- [ ] **Malformed commits blocked** with actionable error messages
- [ ] **Empty commits blocked** unless `--allow-empty`
- [ ] **Input sanitization prevents injection** attacks

### 10.4 CI/CD Integration

- [ ] **PR checks validate version consistency** before merge
- [ ] **Pre-push hooks catch issues** before remote push
- [ ] **GitHub releases auto-created** on version changes
- [ ] **Release notifications sent** to team (Slack/Discord)

### 10.5 Launch Metrics (3 Months Post-Launch)

- [ ] Version consistency: 100% (zero mismatches)
- [ ] Manual override rate: <5%
- [ ] CI validation pass rate: >98%
- [ ] Release preparation time: <5 minutes (from 30 minutes)
- [ ] Developer satisfaction: >8/10 survey score
- [ ] Zero security incidents related to version management
- [ ] Audit log 100% complete (no gaps)

---

## 11. Appendix

### A. Library Comparison: Why conventional-commits-parser?

| Feature | conventional-commits-parser | Custom Regex | git-conventional-commits |
|---------|----------------------------|--------------|-------------------------|
| Battle-tested | ✅ 5M+ weekly downloads | ❌ Untested | ✅ But less popular |
| Spec compliance | ✅ Conventional Commits 1.0.0 | ⚠️ Partial | ✅ |
| Edge case handling | ✅ Comprehensive | ❌ Minimal | ⚠️ Some |
| Breaking change detection | ✅ Both ! and footer | ⚠️ Manual | ✅ |
| Issue reference parsing | ✅ Built-in | ❌ None | ⚠️ Limited |
| Revert detection | ✅ Built-in | ❌ None | ❌ None |
| Maintenance | ✅ Active | ❌ Self | ⚠️ Moderate |
| Test coverage | ✅ Excellent | ❌ Self | ⚠️ Good |

**Decision: Use conventional-commits-parser for robustness and maintainability.**

### B. Error Code Reference (Quick Guide)

| Code | Error | Recovery Action |
|------|-------|----------------|
| E001 | Parse error | Use conventional commit format |
| E002 | Invalid version | Run `npm run fix-versions` |
| E003 | Version mismatch | Run `npm run fix-versions` |
| E004 | Merge conflict | Resolve manually, then `fix-versions` |
| E005 | File I/O error | Check permissions and retry |
| E006 | Atomic transaction failed | Check disk space, retry |
| E007 | Cascade error | Verify ensemble-full structure |
| E008 | Validation error | Run `npm run validate-versions` |
| E009 | Malformed commit | Use format: type(scope): description |
| E010 | Empty commit | Provide meaningful commit message |
| E011 | Sanitization failed | Use only allowed characters |

### C. Audit Log Format (JSONL)

```json
{"timestamp":"2026-01-09T12:34:56.789Z","operation":"bump","user":"developer","commitSHA":"abc123...","changes":[{"package":"core","from":"5.1.0","to":"5.2.0","bump":"minor"}],"reason":"minor bump from commit: feat(core): add utility","bumpType":"minor","filesModified":["packages/core/.claude-plugin/plugin.json","packages/core/package.json","marketplace.json","CHANGELOG.md"]}
```

### D. Cross-Platform Normalization

```typescript
// Path normalization (always use forward slashes)
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').normalize('NFD');
}

// Line ending normalization (always use LF)
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// User detection (cross-platform)
function getCurrentUser(): string {
  return process.platform === 'win32'
    ? process.env.USERNAME || 'unknown'
    : process.env.USER || 'unknown';
}
```

---

## 12. Version History

### v1.1.0 - 2026-01-09

**Refinements based on user feedback:**

1. **Conventional Commit Parser (Section 3.1)**
   - Specified use of `conventional-commits-parser` library
   - Added configuration and implementation details
   - Documented parser options (strict mode)

2. **Error Handling Strategy (New Section 4)**
   - Added fail-fast approach documentation
   - Defined error types with recovery actions
   - Implemented malformed and empty commit handling
   - Added input sanitization requirements

3. **Security Controls (Section 5)**
   - Added input sanitization function with character allowlist
   - Implemented timestamped audit logging with commit SHA
   - Added audit log querying and reporting
   - Expanded threat model with specific mitigations

4. **CI/CD Integration Points (New Section 6)**
   - GitHub Actions PR checks (validate version consistency, block bad merges)
   - Pre-push hooks (catch issues before remote push)
   - Release automation (auto-create GitHub releases on version changes)
   - Release notification workflows

5. **Mission-Critical Tests (Section 7)**
   - Breaking changes cascade test suite
   - Cross-platform behavior tests (Windows paths, line endings, permissions)
   - Edge case tests (malformed commits, empty commits)
   - Audit log testing

6. **Performance Strategy (New Section 8)**
   - Clarified always-update-all-packages approach (version-locked)
   - Added optimization techniques (parallel I/O, caching)
   - Defined performance benchmarks (<2s hook, <200ms reads, <300ms writes)

7. **Implementation Phases (Section 9)**
   - Updated to reflect new features (fail-fast, audit logging, CI/CD)
   - Added Phase 4 for mission-critical testing
   - Expanded timeline from 5 to 6 weeks

8. **Success Criteria (Section 10)**
   - Added mission-critical test requirements
   - Added CI/CD integration success criteria
   - Added security and audit log metrics

9. **Appendix (Section 11)**
   - Added library comparison (conventional-commits-parser vs alternatives)
   - Added error code reference quick guide
   - Added audit log format example
   - Added cross-platform normalization examples

**Changes summary:**
- Enhanced error handling with fail-fast approach
- Specified `conventional-commits-parser` library for robustness
- Added comprehensive security controls (sanitization + audit logging)
- Expanded CI/CD integration (PR checks, pre-push, release automation)
- Added mission-critical test scenarios (breaking changes, cross-platform)
- Clarified performance strategy (always update all packages)

### v1.0.0 - 2026-01-09

**Initial draft based on PRD v1.1.0:**
- Core architecture and component design
- Conventional commit parsing (generic approach)
- Semver resolution and file synchronization
- Version-locked cascade strategy
- Changelog generation
- Pre-commit hook implementation
- CI validation framework
- Testing strategy and coverage requirements

---

## Document Approval

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Tech Lead | TBD | | |
| Backend Developer | TBD | | |
| DevOps Lead | TBD | | |
| QA Engineer | TBD | | |
| Security Engineer | TBD | | |

---

**End of Technical Requirements Document**
