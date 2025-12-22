# Technical Requirements Document: ENSEMBLE-HISTORY.md Change Tracking

| Field | Value |
|-------|-------|
| **TRD ID** | TRD-CORE-004 |
| **Feature** | ENSEMBLE-HISTORY.md Change Tracking |
| **Plugin** | ensemble-core |
| **Version Target** | 5.2.0 |
| **Status** | Ready for Development |
| **Created** | 2025-12-22 |
| **Last Updated** | 2025-12-22 |
| **Author** | Fortium Partners |
| **Version** | 1.2 |
| **PRD Reference** | PRD-CORE-004 v1.1 |

---

> **Implementation Reminder**: Run `/ensemble:fold-prompt` periodically while implementing this TRD to keep CLAUDE.md optimized and generate the ENSEMBLE-HISTORY.md as you work. This ensures Claude maintains context about architectural decisions and project evolution.

---

## 1. Executive Summary

### 1.1 Technical Approach Overview

This TRD defines the technical implementation for a history generator that consolidates PRD/TRD documents into a chronological change log (`ENSEMBLE-HISTORY.md`). The system will integrate with the existing `/ensemble:fold-prompt` command workflow.

**Core Technical Decisions:**
- **Language**: Node.js (>=20.0.0) - aligns with existing ensemble tooling
- **Parser**: Custom markdown parser with regex patterns for metadata extraction
- **Location**: `packages/core/lib/history-generator.js` - new module in core package
- **Integration**: Add phase to `fold-prompt.yaml` workflow
- **Git**: Use existing git commands via child_process

### 1.2 Key Architectural Decisions

| Decision Area | Choice | Rationale |
|---------------|--------|-----------|
| **Document Parsing** | Regex-based markdown parser | PRDs/TRDs use consistent formats; no need for heavy markdown AST |
| **PRD/TRD Matching** | Filename-based matching | Simple, reliable, already used for related docs |
| **Date Extraction** | Multi-strategy with fallbacks | Handles various date formats in existing docs |
| **Output Format** | Structured markdown | Human-readable, Claude-compatible, git-diffable |
| **Git Integration** | Auto-commit via child_process | Consistent commit messages, CI-friendly |
| **Ordering** | Newest-first | Quick access to recent decisions |

### 1.3 Technology Stack

```
Runtime:       Node.js >=20.0.0
Dependencies:  fs/promises (built-in), path (built-in), child_process (built-in)
NewModules:    packages/core/lib/history-generator.js
               packages/core/lib/document-parser.js
Testing:       Jest with >80% coverage target
Integration:   fold-prompt.yaml workflow phase
```

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    fold-prompt Command                          │
│                 (packages/core/commands/)                       │
│  Phase 4: History Consolidation (NEW)                          │
│  - Triggers history generation                                 │
│  - Reports entry count                                         │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────────────────────────┐
│                   History Generator Module                       │
│              (packages/core/lib/history-generator.js)           │
│  - Orchestrates document scanning                               │
│  - Coordinates PRD/TRD matching                                 │
│  - Generates ENSEMBLE-HISTORY.md                               │
│  - Triggers git commit                                         │
└────────────────┬────────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        v                 v
┌───────────────┐  ┌───────────────┐
│ Document      │  │ Git           │
│ Parser        │  │ Integration   │
│               │  │               │
│ - Scan dirs   │  │ - Stage file  │
│ - Parse MD    │  │ - Commit      │
│ - Extract     │  │ - Message fmt │
│   metadata    │  │               │
└───────────────┘  └───────────────┘
```

### 2.2 Module Breakdown

| Module | Responsibility | Location |
|--------|---------------|----------|
| **history-generator.js** | Main orchestration, output generation | `packages/core/lib/` |
| **document-parser.js** | Parse PRD/TRD markdown, extract metadata | `packages/core/lib/` |
| **fold-prompt.yaml** | Add History Consolidation phase | `packages/core/commands/` |

### 2.3 Data Flow

```
docs/PRD/*.md ─────┐
                   │
                   v
           ┌──────────────┐
           │   Scanner    │
           │  (glob PRD/  │
           │   and TRD/)  │
           └──────┬───────┘
                  │
                  v
           ┌──────────────┐
           │   Parser     │
           │  (extract    │◄── Date, Title, Problem,
           │   metadata)  │    Solution, Decisions
           └──────┬───────┘
                  │
                  v
           ┌──────────────┐
           │   Matcher    │
           │  (link by    │◄── Group by base filename
           │   filename)  │
           └──────┬───────┘
                  │
                  v
           ┌──────────────┐
           │  Generator   │
           │  (create     │──► docs/ENSEMBLE-HISTORY.md
           │   markdown)  │
           └──────┬───────┘
                  │
                  v
           ┌──────────────┐
           │    Git       │
           │  (commit if  │──► Conventional commit
           │   changed)   │
           └──────────────┘

docs/TRD/*.md ─────┘
```

---

## 3. Detailed Design

### 3.1 Document Parser (`document-parser.js`)

#### 3.1.1 Interface

```javascript
/**
 * @typedef {Object} ParsedDocument
 * @property {string} filename - Base filename without extension
 * @property {string} filepath - Full path to document
 * @property {'PRD'|'TRD'} type - Document type
 * @property {string|null} id - Document ID (e.g., PRD-CORE-004)
 * @property {string|null} title - Document title
 * @property {string|null} date - Creation date (YYYY-MM-DD)
 * @property {string|null} status - Document status
 * @property {string|null} problem - Problem statement summary
 * @property {string|null} solution - Solution summary
 * @property {string[]} decisions - Key decisions (max 5)
 */

/**
 * Scan directory for markdown files
 * @param {string} dirPath - Directory to scan
 * @returns {Promise<string[]>} Array of file paths
 */
async function scanDirectory(dirPath) { }

/**
 * Parse a PRD or TRD markdown file
 * @param {string} filepath - Path to markdown file
 * @param {'PRD'|'TRD'} type - Document type
 * @returns {Promise<ParsedDocument>}
 */
async function parseDocument(filepath, type) { }
```

#### 3.1.2 Metadata Extraction Strategies

```javascript
// Date extraction priority
const extractDate = (content, filepath) => {
  // Strategy 1: Metadata table "| **Created** | 2025-12-22 |"
  const tableMatch = content.match(/\|\s*\*\*Created\*\*\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|/);
  if (tableMatch) return tableMatch[1];

  // Strategy 2: Inline "Created: 2025-12-22"
  const inlineMatch = content.match(/Created:\s*(\d{4}-\d{2}-\d{2})/i);
  if (inlineMatch) return inlineMatch[1];

  // Strategy 3: First date pattern in document
  const anyDateMatch = content.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (anyDateMatch) return anyDateMatch[1];

  // Strategy 4: File modification time (fallback)
  const stats = await fs.stat(filepath);
  return stats.mtime.toISOString().split('T')[0];
};

// Problem extraction
const extractProblem = (content) => {
  // Look for Problem Statement section
  const problemMatch = content.match(
    /###?\s*(?:\d+\.\d+\s*)?Problem\s*(?:Statement)?\s*\n+([\s\S]*?)(?=\n###?|\n##|\Z)/i
  );
  if (problemMatch) {
    // Extract first meaningful paragraph, limit to 200 chars
    const paragraph = problemMatch[1]
      .split('\n\n')[0]
      .replace(/\n/g, ' ')
      .trim()
      .slice(0, 200);
    return paragraph + (paragraph.length >= 200 ? '...' : '');
  }
  return null;
};

// Solution extraction
const extractSolution = (content) => {
  // Look for Solution/Solution Overview section
  const solutionMatch = content.match(
    /###?\s*(?:\d+\.\d+\s*)?Solution\s*(?:Overview)?\s*\n+([\s\S]*?)(?=\n###?|\n##|\Z)/i
  );
  if (solutionMatch) {
    const paragraph = solutionMatch[1]
      .split('\n\n')[0]
      .replace(/\n/g, ' ')
      .trim()
      .slice(0, 200);
    return paragraph + (paragraph.length >= 200 ? '...' : '');
  }
  return null;
};

// Key decisions extraction
const extractDecisions = (content) => {
  const decisions = [];

  // Strategy 1: Key Decisions table
  const tableMatch = content.match(
    /Key\s*Decisions?\s*(?:Summary)?\s*\n+\|[^\n]+\|\s*\n\|[-|\s]+\|\s*\n([\s\S]*?)(?=\n##|\n\n\n|\Z)/i
  );
  if (tableMatch) {
    const rows = tableMatch[1].match(/\|\s*\*\*([^|]+)\*\*\s*\|/g);
    if (rows) {
      rows.slice(0, 5).forEach(row => {
        const match = row.match(/\*\*([^*]+)\*\*/);
        if (match) decisions.push(match[1].trim());
      });
    }
  }

  // Strategy 2: Bullet list under decisions header
  if (decisions.length === 0) {
    const listMatch = content.match(
      /Key\s*Decisions?\s*\n+((?:[-*]\s+[^\n]+\n?)+)/i
    );
    if (listMatch) {
      const bullets = listMatch[1].match(/[-*]\s+([^\n]+)/g);
      if (bullets) {
        bullets.slice(0, 5).forEach(bullet => {
          decisions.push(bullet.replace(/^[-*]\s+/, '').trim());
        });
      }
    }
  }

  return decisions;
};
```

### 3.2 History Generator (`history-generator.js`)

#### 3.2.1 Interface

```javascript
/**
 * @typedef {Object} HistoryEntry
 * @property {string} date - Entry date (YYYY-MM-DD)
 * @property {string} title - Feature title
 * @property {ParsedDocument|null} prd - Linked PRD
 * @property {ParsedDocument|null} trd - Linked TRD
 * @property {string} status - Combined status
 * @property {string|null} problem - Problem summary
 * @property {string|null} solution - Solution summary
 * @property {string[]} decisions - Combined key decisions
 */

/**
 * @typedef {Object} GenerationResult
 * @property {boolean} success - Whether generation succeeded
 * @property {string} outputPath - Path to generated file
 * @property {number} entryCount - Number of entries generated
 * @property {number} prdCount - Number of PRDs processed
 * @property {number} trdCount - Number of TRDs processed
 * @property {boolean} changed - Whether file content changed
 * @property {string|null} error - Error message if failed
 */

/**
 * Generate ENSEMBLE-HISTORY.md from PRDs and TRDs
 * @param {Object} options
 * @param {string} options.docsDir - Path to docs directory
 * @param {string} options.outputPath - Output file path
 * @param {boolean} options.autoCommit - Whether to auto-commit
 * @returns {Promise<GenerationResult>}
 */
async function generateHistory(options) { }
```

#### 3.2.2 PRD/TRD Matching Algorithm

```javascript
/**
 * Match PRDs with TRDs by base filename
 * @param {ParsedDocument[]} prds - Parsed PRD documents
 * @param {ParsedDocument[]} trds - Parsed TRD documents
 * @returns {HistoryEntry[]}
 */
function matchDocuments(prds, trds) {
  const entries = new Map(); // filename -> HistoryEntry

  // Process PRDs first
  for (const prd of prds) {
    entries.set(prd.filename, {
      date: prd.date,
      title: prd.title || formatTitle(prd.filename),
      prd: prd,
      trd: null,
      status: prd.status,
      problem: prd.problem,
      solution: prd.solution,
      decisions: prd.decisions
    });
  }

  // Match TRDs
  for (const trd of trds) {
    if (entries.has(trd.filename)) {
      // Merge with existing PRD entry
      const entry = entries.get(trd.filename);
      entry.trd = trd;
      // Prefer TRD date if PRD date missing
      entry.date = entry.date || trd.date;
      // Merge decisions (deduplicate)
      entry.decisions = [...new Set([...entry.decisions, ...trd.decisions])].slice(0, 5);
    } else {
      // TRD without PRD
      entries.set(trd.filename, {
        date: trd.date,
        title: trd.title || formatTitle(trd.filename),
        prd: null,
        trd: trd,
        status: trd.status,
        problem: trd.problem,
        solution: trd.solution,
        decisions: trd.decisions
      });
    }
  }

  // Sort by date (newest first)
  return Array.from(entries.values())
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/**
 * Convert filename to human-readable title
 * @param {string} filename - e.g., "yaml-to-markdown-generator"
 * @returns {string} - e.g., "YAML to Markdown Generator"
 */
function formatTitle(filename) {
  return filename
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Yaml/g, 'YAML')
    .replace(/Trd/g, 'TRD')
    .replace(/Prd/g, 'PRD');
}
```

#### 3.2.3 Output Generation

```javascript
/**
 * Generate markdown content for ENSEMBLE-HISTORY.md
 * @param {HistoryEntry[]} entries - Sorted history entries
 * @param {Object} stats - Generation statistics
 * @returns {string} - Markdown content
 */
function generateMarkdown(entries, stats) {
  const lines = [
    '# Ensemble Project History',
    '',
    '> Chronological record of architectural decisions and feature implementations',
    '> Auto-generated from PRDs and TRDs - Do not edit manually',
    '',
    `**Last Updated**: ${new Date().toISOString().split('T')[0]}`,
    `**PRDs Processed**: ${stats.prdCount}`,
    `**TRDs Processed**: ${stats.trdCount}`,
    '',
    '---',
    ''
  ];

  for (const entry of entries) {
    // Entry header
    lines.push(`## ${entry.date || 'Unknown Date'} - ${entry.title}`);
    lines.push('');

    // Document links
    if (entry.prd) {
      lines.push(`**PRD**: [${entry.prd.id || entry.prd.filename}](PRD/${entry.prd.filename}.md)`);
    }
    if (entry.trd) {
      lines.push(`**TRD**: [${entry.trd.id || entry.trd.filename}](TRD/${entry.trd.filename}.md)`);
    }
    if (!entry.prd && entry.trd) {
      lines.push('*TRD only - no linked PRD*');
    }
    if (entry.prd && !entry.trd) {
      lines.push('*PRD only - TRD pending*');
    }

    // Status
    if (entry.status) {
      lines.push(`**Status**: ${entry.status}`);
    }
    lines.push('');

    // Problem
    if (entry.problem) {
      lines.push('### Problem');
      lines.push(entry.problem);
      lines.push('');
    }

    // Solution
    if (entry.solution) {
      lines.push('### Solution');
      lines.push(entry.solution);
      lines.push('');
    }

    // Key Decisions
    if (entry.decisions.length > 0) {
      lines.push('### Key Decisions');
      for (const decision of entry.decisions) {
        lines.push(`- ${decision}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}
```

### 3.3 Git Integration

```javascript
const { execSync } = require('child_process');

/**
 * Commit ENSEMBLE-HISTORY.md with conventional commit message
 * @param {string} filepath - Path to history file
 * @param {Object} stats - Generation statistics
 * @returns {boolean} - Whether commit was created
 */
function commitHistoryFile(filepath, stats) {
  // Check if file changed
  try {
    execSync(`git diff --quiet "${filepath}"`, { stdio: 'ignore' });
    // No changes - file is identical
    return false;
  } catch (e) {
    // File has changes (or is new)
  }

  // Stage file
  execSync(`git add "${filepath}"`);

  // Create commit message
  const message = `docs(history): update ENSEMBLE-HISTORY.md with latest PRD/TRD changes

- Generated from ${stats.prdCount} PRDs and ${stats.trdCount} TRDs
- Last updated: ${new Date().toISOString().split('T')[0]}

🤖 Generated with [Claude Code](https://claude.com/claude-code)`;

  // Commit
  execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
    stdio: 'inherit'
  });

  return true;
}
```

### 3.4 fold-prompt Integration

#### 3.4.1 Updated fold-prompt.yaml

Add new phase after "Advanced Integration & Validation":

```yaml
    - name: History Consolidation
      order: 4
      steps:
        - order: 1
          title: Scan PRD/TRD Documents
          description: Read all documents in docs/PRD/ and docs/TRD/
          actions:
            - Scan docs/PRD/ for markdown files
            - Scan docs/TRD/ for markdown files
            - Parse document metadata

        - order: 2
          title: Generate ENSEMBLE-HISTORY.md
          description: Create chronological change log
          actions:
            - Match PRDs with TRDs by filename
            - Extract problem, solution, decisions
            - Generate structured markdown entries
            - Write to docs/ENSEMBLE-HISTORY.md

        - order: 3
          title: Commit History Updates
          description: Auto-commit if changes detected
          actions:
            - Check for file changes
            - Stage ENSEMBLE-HISTORY.md
            - Create conventional commit
```

---

## 4. Master Task List

### 4.1 Task Overview

| Task ID | Task | Priority | Estimate | Dependencies |
|---------|------|----------|----------|--------------|
| HIST-001 | Create document-parser.js module | High | 3h | None |
| HIST-002 | Create history-generator.js module | High | 4h | HIST-001 |
| HIST-003 | Implement git integration | Medium | 2h | HIST-002 |
| HIST-004 | Update fold-prompt.yaml | Medium | 1h | HIST-002 |
| HIST-005 | Add Project History section to CLAUDE.md | Low | 0.5h | HIST-002 |
| HIST-006 | Write unit tests for document-parser | High | 2h | HIST-001 |
| HIST-007 | Write unit tests for history-generator | High | 2h | HIST-002 |
| HIST-008 | Integration testing | Medium | 2h | HIST-001-007 |
| HIST-009 | Documentation and JSDoc | Low | 1h | HIST-001-004 |

**Total Estimated Effort**: 17.5 hours

### 4.2 Detailed Task Breakdown

#### HIST-001: Create document-parser.js module

- [ ] Create file at `packages/core/lib/document-parser.js`
- [ ] Implement `scanDirectory()` function
- [ ] Implement `parseDocument()` function
- [ ] Implement `extractDate()` with 4 fallback strategies
- [ ] Implement `extractTitle()` from metadata
- [ ] Implement `extractProblem()` from content
- [ ] Implement `extractSolution()` from content
- [ ] Implement `extractDecisions()` from content
- [ ] Implement `extractStatus()` from metadata
- [ ] Add JSDoc comments
- [ ] Export public interface

#### HIST-002: Create history-generator.js module

- [ ] Create file at `packages/core/lib/history-generator.js`
- [ ] Implement `generateHistory()` main function
- [ ] Implement `matchDocuments()` for PRD/TRD linking
- [ ] Implement `formatTitle()` for filename conversion
- [ ] Implement `generateMarkdown()` for output
- [ ] Add error handling and logging
- [ ] Add JSDoc comments
- [ ] Export public interface

#### HIST-003: Implement git integration

- [ ] Add `commitHistoryFile()` function to history-generator.js
- [ ] Implement change detection via `git diff`
- [ ] Implement file staging via `git add`
- [ ] Implement commit with conventional message
- [ ] Handle case where git is not available
- [ ] Handle case where repo has no changes

#### HIST-004: Update fold-prompt.yaml

- [ ] Add Phase 4: History Consolidation
- [ ] Add step 1: Scan PRD/TRD Documents
- [ ] Add step 2: Generate ENSEMBLE-HISTORY.md
- [ ] Add step 3: Commit History Updates
- [ ] Update expected output section
- [ ] Regenerate fold-prompt.md via `npm run generate`

#### HIST-005: Add Project History section to CLAUDE.md

- [ ] Add "## Project History" section
- [ ] Add link to docs/ENSEMBLE-HISTORY.md
- [ ] Add links to docs/PRD/ and docs/TRD/
- [ ] Add instruction for Claude to read history

#### HIST-006: Write unit tests for document-parser

- [ ] Create `packages/core/tests/document-parser.test.js`
- [ ] Test `scanDirectory()` with mock files
- [ ] Test `parseDocument()` with sample PRD
- [ ] Test `parseDocument()` with sample TRD
- [ ] Test `extractDate()` all strategies
- [ ] Test `extractProblem()` variations
- [ ] Test `extractSolution()` variations
- [ ] Test `extractDecisions()` variations
- [ ] Test error handling for malformed docs

#### HIST-007: Write unit tests for history-generator

- [ ] Create `packages/core/tests/history-generator.test.js`
- [ ] Test `matchDocuments()` with paired docs
- [ ] Test `matchDocuments()` with orphan PRD
- [ ] Test `matchDocuments()` with orphan TRD
- [ ] Test `generateMarkdown()` output format
- [ ] Test `formatTitle()` conversions
- [ ] Test sorting (newest-first)

#### HIST-008: Integration testing

- [ ] Test full generation with existing docs/PRD and docs/TRD
- [ ] Verify output matches expected format
- [ ] Test incremental update (re-run)
- [ ] Test git commit creation
- [ ] Test with fold-prompt command

#### HIST-009: Documentation and JSDoc

- [ ] Add JSDoc to all public functions
- [ ] Update packages/core/README.md
- [ ] Add inline comments for complex logic

---

## 5. Sprint Planning

### Sprint 1: Core Implementation (8h)

| Task ID | Task | Status |
|---------|------|--------|
| HIST-001 | Create document-parser.js module | [ ] |
| HIST-002 | Create history-generator.js module | [ ] |
| HIST-006 | Write unit tests for document-parser | [ ] |

**Sprint Goal**: Working parser and generator with tests

### Sprint 2: Integration (6h)

| Task ID | Task | Status |
|---------|------|--------|
| HIST-003 | Implement git integration | [ ] |
| HIST-004 | Update fold-prompt.yaml | [ ] |
| HIST-007 | Write unit tests for history-generator | [ ] |

**Sprint Goal**: Full workflow integrated with fold-prompt

### Sprint 3: Polish (3.5h)

| Task ID | Task | Status |
|---------|------|--------|
| HIST-005 | Add Project History section to CLAUDE.md | [ ] |
| HIST-008 | Integration testing | [ ] |
| HIST-009 | Documentation and JSDoc | [ ] |

**Sprint Goal**: Production-ready with documentation

---

## 6. Acceptance Criteria Mapping

| AC ID | Acceptance Criteria | Task IDs |
|-------|---------------------|----------|
| AC-1 | History file generation | HIST-002 |
| AC-2 | Entry structure | HIST-002 |
| AC-3 | CLAUDE.md integration | HIST-005 |
| AC-4 | Incremental updates | HIST-002 |
| AC-5 | Error handling | HIST-001, HIST-002 |
| AC-6 | Git integration | HIST-003 |
| AC-7 | PRD/TRD linking | HIST-002 |

---

## 7. File Structure

```
packages/core/
├── lib/
│   ├── document-parser.js    # NEW - Document parsing
│   ├── history-generator.js  # NEW - History generation
│   ├── detect-framework.js   # Existing
│   ├── config-path.js        # Existing
│   └── index.js              # Update exports
├── commands/
│   ├── fold-prompt.yaml      # UPDATE - Add Phase 4
│   └── ensemble/
│       └── fold-prompt.md    # REGENERATE
└── tests/
    ├── document-parser.test.js  # NEW
    └── history-generator.test.js # NEW

docs/
├── ENSEMBLE-HISTORY.md       # GENERATED OUTPUT
├── PRD/                      # Input
└── TRD/                      # Input

CLAUDE.md                     # UPDATE - Add Project History section
```

---

## 8. Error Handling Specifications

### 8.1 Error Message Format

All error messages follow a consistent format:

```
[HIST-{CODE}] {Category}: {Message}
```

### 8.2 Error Codes and Messages

| Code | Category | Message Template | Trigger | Recovery |
|------|----------|------------------|---------|----------|
| `HIST-E001` | SCAN | `Failed to scan directory: {dirPath}` | Directory doesn't exist or no read permission | Skip directory, continue with available |
| `HIST-E002` | PARSE | `Failed to parse document: {filepath}` | Malformed markdown, encoding error | Skip document, log warning, continue |
| `HIST-E003` | PARSE | `Missing required metadata in: {filepath}` | No title or date extractable | Use fallback values, include with warning |
| `HIST-E004` | MATCH | `Duplicate filename detected: {filename}` | Multiple files with same base name in PRD or TRD | Use first found, log warning |
| `HIST-E005` | WRITE | `Failed to write history file: {outputPath}` | No write permission, disk full | Throw error, abort generation |
| `HIST-E006` | GIT | `Git command failed: {command}` | Git not installed, not a repo | Skip git operations, log warning |
| `HIST-E007` | GIT | `Nothing to commit - history unchanged` | File content identical | Silent success, no commit needed |

### 8.3 Warning Messages

Warnings don't stop execution but are logged for visibility:

| Code | Message | When |
|------|---------|------|
| `HIST-W001` | `No PRDs found in {dirPath}` | Empty PRD directory |
| `HIST-W002` | `No TRDs found in {dirPath}` | Empty TRD directory |
| `HIST-W003` | `Using file date for: {filepath}` | No date in document metadata |
| `HIST-W004` | `Truncated content in: {filepath}` | Problem/solution exceeded 200 chars |
| `HIST-W005` | `Skipped git commit: not in git repository` | Running outside git repo |

### 8.4 Error Handling Implementation

```javascript
class HistoryError extends Error {
  constructor(code, message, filepath = null) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.filepath = filepath;
    this.name = 'HistoryError';
  }
}

const handleError = (error, context) => {
  // Log error with context
  console.error(`${error.message}`);
  if (context.filepath) {
    console.error(`  File: ${context.filepath}`);
  }

  // Determine if recoverable
  const fatalCodes = ['HIST-E005'];
  if (fatalCodes.includes(error.code)) {
    throw error;
  }

  // Continue with degraded functionality
  return null;
};
```

---

## 9. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Inconsistent PRD/TRD formats | Medium | High | Multi-strategy extraction with fallbacks |
| Date parsing failures | Low | Medium | Fallback to file modification time |
| Git not available | Low | Low | Graceful skip with warning |
| Large number of documents | Low | Low | Performance tested up to 50 docs |

---

## 10. Testing Strategy

### 10.1 Unit Tests

```javascript
// document-parser.test.js
describe('DocumentParser', () => {
  describe('extractDate', () => {
    it('extracts from metadata table', () => { });
    it('extracts from inline Created field', () => { });
    it('falls back to first date pattern', () => { });
    it('falls back to file mtime', () => { });
  });

  describe('extractProblem', () => {
    it('extracts Problem Statement section', () => { });
    it('truncates to 200 chars', () => { });
    it('returns null if no section found', () => { });
  });
});

// history-generator.test.js
describe('HistoryGenerator', () => {
  describe('matchDocuments', () => {
    it('links PRD and TRD by filename', () => { });
    it('handles orphan PRD', () => { });
    it('handles orphan TRD', () => { });
    it('sorts newest first', () => { });
  });
});
```

### 10.2 Integration Tests

```javascript
describe('Integration', () => {
  it('generates ENSEMBLE-HISTORY.md from real docs', async () => {
    const result = await generateHistory({
      docsDir: 'docs',
      outputPath: 'docs/ENSEMBLE-HISTORY.md',
      autoCommit: false
    });

    expect(result.success).toBe(true);
    expect(result.entryCount).toBeGreaterThan(0);
  });
});
```

---

## 11. CLI Output Specifications

### 11.1 fold-prompt Integration Output

When the history generator runs as part of `/ensemble:fold-prompt`, it produces the following output:

```
=== Phase 4: History Consolidation ===

Scanning docs/PRD/... found 7 documents
Scanning docs/TRD/... found 6 documents

Parsing documents:
  ✓ ensemble-history-tracking.md (PRD + TRD)
  ✓ yaml-to-markdown-generator.md (PRD + TRD)
  ✓ plugin-marketplace-v2.md (PRD only)
  ...

Generated ENSEMBLE-HISTORY.md:
  - Entries: 8
  - PRDs processed: 7
  - TRDs processed: 6
  - Matched pairs: 5
  - PRD only: 2
  - TRD only: 1

Git: Committed docs/ENSEMBLE-HISTORY.md
  commit abc1234 docs(history): update ENSEMBLE-HISTORY.md with latest PRD/TRD changes
```

### 11.2 Output Symbols

| Symbol | Meaning |
|--------|---------|
| `✓` | Successfully processed |
| `⚠` | Processed with warnings |
| `✗` | Failed to process (skipped) |
| `→` | Action taken |

### 11.3 Verbose Mode Output

When `--verbose` or environment variable `ENSEMBLE_VERBOSE=true`:

```
[DEBUG] Scanning directory: docs/PRD/
[DEBUG] Found file: docs/PRD/ensemble-history-tracking.md
[DEBUG] Extracting metadata from: ensemble-history-tracking.md
[DEBUG]   Date: 2025-12-22 (from metadata table)
[DEBUG]   Title: ENSEMBLE-HISTORY.md Change Tracking
[DEBUG]   Status: Approved - Ready for Development
[DEBUG] Extracting problem statement (200 char limit)
[DEBUG] Extracting solution overview (200 char limit)
[DEBUG] Found 7 key decisions
...
```

### 11.4 Summary Report Format

The generation result is returned as a structured object:

```javascript
{
  success: true,
  outputPath: 'docs/ENSEMBLE-HISTORY.md',
  stats: {
    prdCount: 7,
    trdCount: 6,
    entryCount: 8,
    matchedPairs: 5,
    prdOnly: 2,
    trdOnly: 1
  },
  warnings: [
    { code: 'HIST-W003', file: 'legacy-doc.md', message: 'Using file date' }
  ],
  gitCommit: 'abc1234',
  duration: 1234 // milliseconds
}
```

---

## 12. Development Workflow

### 12.1 Periodic Environment Optimization

During implementation of this TRD, run `/ensemble:fold-prompt` at these key points:

| Milestone | Trigger | Rationale |
|-----------|---------|-----------|
| **Sprint Start** | Before beginning each sprint | Ensure Claude has latest context |
| **After HIST-002** | Generator module complete | Core functionality ready for testing |
| **After HIST-004** | fold-prompt integration done | Verify history generation works |
| **After HIST-008** | Integration tests pass | Validate end-to-end workflow |
| **Before PR** | Prior to pull request creation | Capture all decisions in history |

### 12.2 Workflow Commands

```bash
# Run fold-prompt to update environment and generate history
/ensemble:fold-prompt

# After implementation, verify history was generated
cat docs/ENSEMBLE-HISTORY.md

# Check git status for auto-commit
git log -1 --oneline
```

### 12.3 Implementation Best Practices

1. **Incremental Commits**: Commit after each task completion
2. **Run fold-prompt**: Execute after major milestones
3. **Verify History**: Check ENSEMBLE-HISTORY.md includes recent changes
4. **Update CLAUDE.md**: Ensure Claude maintains context through fold-prompt runs

---

## 13. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-22 | Fortium Partners | Initial TRD creation |
| 1.1 | 2025-12-22 | Fortium Partners | Added implementation reminder callout, added Development Workflow section with periodic fold-prompt guidance |
| 1.2 | 2025-12-22 | Fortium Partners | Added Error Handling Specifications (Section 8), CLI Output Specifications (Section 11), fixed section numbering |

---

## 14. Related Documents

- [PRD-CORE-004: ENSEMBLE-HISTORY.md Change Tracking](../PRD/ensemble-history-tracking.md)
- [TRD-CORE-003: YAML-to-Markdown Generator](yaml-to-markdown-generator.md)
- [CLAUDE.md](../../CLAUDE.md)
- [fold-prompt.yaml](../../packages/core/commands/fold-prompt.yaml)
