# Product Requirements Document: ENSEMBLE-HISTORY.md Change Tracking

| Field | Value |
|-------|-------|
| **PRD ID** | PRD-CORE-004 |
| **Feature** | ENSEMBLE-HISTORY.md Change Tracking |
| **Plugin** | ensemble-core |
| **Version Target** | 5.2.0 |
| **Status** | Approved - Ready for Development |
| **Created** | 2025-12-22 |
| **Last Updated** | 2025-12-22 |
| **Author** | Fortium Partners |
| **Version** | 1.1 |

---

## 0. Key Decisions Summary

This PRD has been updated with the following decisions from user interview (2025-12-22):

| Decision Area | Resolution | Section Reference |
|---------------|------------|-------------------|
| **Ordering** | Newest-first - recent changes at top for quick access | 4.3 |
| **Command Integration** | Part of `/ensemble:fold-prompt` workflow | 4.5 |
| **Entry Content** | Full detail - problem, solution, and key decisions | 4.3 |
| **Git Handling** | Auto-commit with standard message | 4.6 |
| **PRD/TRD Linking** | Match by filename - link if same base filename | 4.2 |
| **Draft Documents** | Include all documents regardless of status | 4.1 |
| **File Location** | `docs/ENSEMBLE-HISTORY.md` | 4.3 |

---

## 1. Executive Summary

### 1.1 Problem Statement

The ensemble plugin ecosystem has accumulated significant development history through PRDs and TRDs in `docs/PRD/` and `docs/TRD/`. However:

1. **No Consolidated History**: Changes and decisions are scattered across 7+ PRDs and 6+ TRDs with no single timeline view
2. **Lost Context**: When reviewing past decisions, developers must read entire PRD/TRD documents to understand what changed and why
3. **No CLAUDE.md Integration**: The AI assistant lacks awareness of project evolution and past architectural decisions
4. **Onboarding Friction**: New team members cannot quickly understand the project's evolution

### 1.2 Solution Overview

Enhance the `/ensemble:fold-prompt` command to:

1. **Scan PRDs and TRDs**: Read all documents in `docs/PRD/` and `docs/TRD/`
2. **Extract Key Changes**: Identify what was changed, why, and when from each document
3. **Generate ENSEMBLE-HISTORY.md**: Create a chronological change log with structured entries
4. **Reference from CLAUDE.md**: Add a reference so Claude Code reads history for context

### 1.3 Value Proposition

| Stakeholder | Benefit |
|-------------|---------|
| **Developers** | Single source for understanding project evolution |
| **Claude Code** | Better context for architectural decisions and past patterns |
| **New Team Members** | Quick onboarding through chronological change history |
| **Project Managers** | Clear view of feature delivery timeline |

---

## 2. User Analysis

### 2.1 Target Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| **Plugin Developer** | Creates and maintains ensemble plugins | Understand past decisions when making changes |
| **Claude Code AI** | AI assistant working on codebase | Historical context for better suggestions |
| **New Contributor** | Developer onboarding to project | Quick understanding of project evolution |
| **Tech Lead** | Reviews architecture decisions | Single reference for decision history |

### 2.2 User Personas

#### Persona 1: Plugin Developer - Marcus
- Works on ensemble plugins daily
- Often wonders "why was this designed this way?"
- Currently must grep through PRDs to find historical context
- Wants quick access to past decisions when modifying code

**Goals:**
- Find past decisions without reading entire PRDs
- Understand the "why" behind architectural choices
- Reference history when proposing new changes

#### Persona 2: Claude Code AI
- Assists with development tasks
- Has context from CLAUDE.md but not historical evolution
- May suggest changes that contradict past decisions
- Needs awareness of project patterns and conventions

**Goals:**
- Understand past architectural decisions
- Avoid suggesting previously rejected approaches
- Provide better context-aware assistance

#### Persona 3: New Contributor - Sarah
- Just joined the team
- Overwhelmed by 24 packages and 28 agents
- Needs to understand how the project evolved
- Wants chronological view of features and changes

**Goals:**
- Quickly understand project history
- Learn the reasoning behind current architecture
- Get productive faster with historical context

### 2.3 Pain Points

1. **Scattered Information**: PRDs/TRDs contain valuable history but require reading entire documents
2. **No Timeline View**: Cannot see chronological evolution of the project
3. **Lost Decisions**: Key decisions buried in document sections
4. **Context Loss**: Claude Code cannot reference past decisions when helping

### 2.4 User Journey

**Current Journey (Problematic):**
1. Developer wonders why something was designed a certain way
2. Searches through multiple PRDs/TRDs manually
3. Reads large documents to find relevant section
4. May miss relevant context in other documents
5. Makes changes without full historical context

**Desired Journey:**
1. Developer runs `/ensemble:fold-prompt`
2. Command generates/updates ENSEMBLE-HISTORY.md
3. Developer (or Claude) reads chronological history
4. Finds relevant past decisions quickly
5. Makes informed changes with full context

---

## 3. Goals & Non-Goals

### 3.1 Goals (In Scope)

| ID | Goal | Success Criteria |
|----|------|------------------|
| G1 | Generate ENSEMBLE-HISTORY.md from PRDs/TRDs | File created with entries from all docs |
| G2 | Chronological ordering by date | Entries sorted newest-first or oldest-first |
| G3 | Structured entry format | Each entry has date, PRD/TRD ref, summary |
| G4 | Extract key decisions | Decision summaries included from each doc |
| G5 | CLAUDE.md reference | CLAUDE.md instructs reading ENSEMBLE-HISTORY.md |
| G6 | Incremental updates | Re-running updates without duplicating |

### 3.2 Non-Goals (Out of Scope)

| ID | Non-Goal | Rationale |
|----|----------|-----------|
| NG1 | Modify existing PRDs/TRDs | Source documents should remain unchanged |
| NG2 | Git commit history integration | Focus on PRD/TRD content, not git |
| NG3 | Automatic PR/issue linking | Manual references sufficient for v1 |
| NG4 | Real-time updates | On-demand generation via command |

---

## 4. Functional Requirements

### 4.1 Document Scanning

**FR-4.1.1**: Scan `docs/PRD/` directory for all `.md` files
**FR-4.1.2**: Scan `docs/TRD/` directory for all `.md` files
**FR-4.1.3**: Parse document metadata (title, date, version, status)
**FR-4.1.4**: Extract executive summary or problem statement
**FR-4.1.5**: Extract key decisions or changes from each document

### 4.2 Change Extraction & PRD/TRD Linking

**FR-4.2.1**: Identify document creation date from metadata or file
**FR-4.2.2**: Extract PRD ID or document identifier
**FR-4.2.3**: Summarize the problem being solved (1-2 sentences)
**FR-4.2.4**: Summarize the solution implemented (1-2 sentences)
**FR-4.2.5**: List key decisions made (if available in document)
**FR-4.2.6**: Match PRDs and TRDs by base filename (e.g., `yaml-to-markdown-generator.md` in both directories creates linked entry)
**FR-4.2.7**: Display matched PRD/TRD pairs as single entry with both links
**FR-4.2.8**: Show unmatched documents (PRD without TRD or vice versa) with appropriate indicator

### 4.3 ENSEMBLE-HISTORY.md Generation

**FR-4.3.1**: Generate markdown file at `docs/ENSEMBLE-HISTORY.md`
**FR-4.3.2**: Include header with generation timestamp
**FR-4.3.3**: Order entries chronologically (newest first by default)
**FR-4.3.4**: Group entries by date (YYYY-MM-DD)
**FR-4.3.5**: Link to source PRD/TRD document

#### Entry Format

```markdown
## 2025-12-19 - YAML-to-Markdown Generator

**PRD**: [PRD-CORE-003](PRD/yaml-to-markdown-generator.md)
**TRD**: [TRD-CORE-003](TRD/yaml-to-markdown-generator.md)
**Status**: Implemented

### Problem
Manual YAML to Markdown conversion caused drift and lost context.

### Solution
Built automated generator preserving rich metadata and workflow structure.

### Key Decisions
- Use plugin manifest for file discovery
- Commit generated files with "DO NOT EDIT" warnings
- Strict validation for delegation references
```

### 4.4 CLAUDE.md Integration

**FR-4.4.1**: Add reference to ENSEMBLE-HISTORY.md in CLAUDE.md
**FR-4.4.2**: Instruct Claude to read history for architectural context
**FR-4.4.3**: Place reference in appropriate section (e.g., after Architecture)

#### CLAUDE.md Addition

```markdown
## Project History

For understanding past architectural decisions and project evolution, read:
- [docs/ENSEMBLE-HISTORY.md](docs/ENSEMBLE-HISTORY.md) - Chronological change log
- [docs/PRD/](docs/PRD/) - Detailed product requirements
- [docs/TRD/](docs/TRD/) - Technical implementation details
```

### 4.5 fold-prompt Integration

**FR-4.5.1**: Add new phase to fold-prompt workflow: "History Consolidation"
**FR-4.5.2**: Execute history generation during fold-prompt run
**FR-4.5.3**: Report generated entries count in output
**FR-4.5.4**: Support incremental updates (don't duplicate existing entries)

### 4.6 Git Integration

**FR-4.6.1**: Auto-commit ENSEMBLE-HISTORY.md after generation
**FR-4.6.2**: Use conventional commit message: `docs(history): update ENSEMBLE-HISTORY.md with latest PRD/TRD changes`
**FR-4.6.3**: Include count of entries in commit message body
**FR-4.6.4**: Skip commit if no changes detected (file unchanged)

#### Commit Message Format

```
docs(history): update ENSEMBLE-HISTORY.md with latest PRD/TRD changes

- Generated from 7 PRDs and 6 TRDs
- Last updated: 2025-12-22

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Requirement | Target |
|-------------|--------|
| Document scanning | < 2 seconds for 20 documents |
| History generation | < 5 seconds total |
| Memory usage | < 100MB during generation |

### 5.2 Reliability

| Requirement | Target |
|-------------|--------|
| Parse failures | Graceful handling, skip malformed docs |
| Missing metadata | Use file dates as fallback |
| Encoding issues | UTF-8 support required |

### 5.3 Maintainability

| Requirement | Target |
|-------------|--------|
| Code location | `packages/core/lib/history-generator.js` |
| Test coverage | Unit tests for extraction logic |
| Documentation | JSDoc comments on public functions |

---

## 6. Acceptance Criteria

### AC-1: History File Generation
- [ ] Running `/ensemble:fold-prompt` creates `docs/ENSEMBLE-HISTORY.md`
- [ ] File contains entries from all PRDs in `docs/PRD/`
- [ ] File contains entries from all TRDs in `docs/TRD/`
- [ ] Entries are ordered chronologically by date

### AC-2: Entry Structure
- [ ] Each entry includes date (YYYY-MM-DD format)
- [ ] Each entry links to source PRD/TRD document
- [ ] Each entry includes problem summary
- [ ] Each entry includes solution summary
- [ ] Key decisions extracted where available

### AC-3: CLAUDE.md Integration
- [ ] CLAUDE.md contains reference to ENSEMBLE-HISTORY.md
- [ ] Reference includes instruction to read for context
- [ ] Path is relative and valid

### AC-4: Incremental Updates
- [ ] Re-running fold-prompt updates existing entries
- [ ] New PRDs/TRDs are added on subsequent runs
- [ ] No duplicate entries created

### AC-5: Error Handling
- [ ] Malformed documents are skipped with warning
- [ ] Missing dates fall back to file modification time
- [ ] Empty directories handled gracefully

### AC-6: Git Integration
- [ ] ENSEMBLE-HISTORY.md is auto-committed after generation
- [ ] Commit message follows conventional commit format
- [ ] Commit includes count of PRDs and TRDs processed
- [ ] No commit created if file is unchanged

### AC-7: PRD/TRD Linking
- [ ] PRDs and TRDs with matching filenames appear as single entry
- [ ] Both PRD and TRD links shown when matched
- [ ] Unmatched documents shown with indicator (PRD only / TRD only)

---

## 7. Technical Considerations

### 7.1 Document Parsing Strategy

```javascript
// Extract metadata from PRD/TRD markdown
const extractMetadata = (content, filepath) => {
  // 1. Check for YAML frontmatter
  // 2. Parse metadata table (| Field | Value |)
  // 3. Extract from headings (# PRD: Title)
  // 4. Fallback to file stats
};
```

### 7.2 Date Extraction Priority

1. `Created` field in metadata table
2. `Date` field in YAML frontmatter
3. First date pattern found in document (YYYY-MM-DD)
4. File modification timestamp (fallback)

### 7.3 Summary Extraction

1. Look for "Problem Statement" or "Problem" section
2. Extract first paragraph (limit to 200 chars)
3. Look for "Solution" or "Solution Overview" section
4. Extract first paragraph (limit to 200 chars)

### 7.4 Key Decisions Extraction

1. Look for "Key Decisions" table or section
2. Parse table rows if present
3. Look for bullet points under decision headers
4. Limit to top 5 decisions per document

---

## 8. Implementation Phases

### Phase 1: Core Generation (MVP)
- Document scanning
- Basic metadata extraction
- ENSEMBLE-HISTORY.md generation
- Chronological ordering

### Phase 2: CLAUDE.md Integration
- Add history reference to CLAUDE.md
- fold-prompt workflow integration
- Output reporting

### Phase 3: Enhanced Extraction
- Key decisions parsing
- Status tracking
- Incremental updates

---

## 9. Open Questions

| # | Question | Resolution | Status |
|---|----------|------------|--------|
| 1 | Should history be newest-first or oldest-first? | **Newest-first** - recent changes at top for quick access | **Resolved** |
| 2 | Include status (Draft/Implemented) in entries? | **Yes** - include all documents with status indicator | **Resolved** |
| 3 | Generate on every fold-prompt or separate command? | **Part of fold-prompt** - runs during environment optimization | **Resolved** |
| 4 | Maximum entries to show before archiving? | No limit for v1, consider pagination later | Proposed |
| 5 | How to match PRDs with TRDs? | **By filename** - same base filename creates linked entry | **Resolved** |
| 6 | Auto-commit or manual commit? | **Auto-commit** with conventional commit message | **Resolved** |
| 7 | File location? | **docs/ENSEMBLE-HISTORY.md** | **Resolved** |

---

## 10. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-22 | Fortium Partners | Initial PRD creation |
| 1.1 | 2025-12-22 | Fortium Partners | Added Key Decisions Summary, resolved open questions from user interview, added Git Integration section (FR-4.6), added PRD/TRD linking requirements (FR-4.2.6-4.2.8) |

---

## 11. Related Documents

- [CLAUDE.md](../../CLAUDE.md) - Claude Code configuration
- [docs/AGENT_PROTOCOL.md](../AGENT_PROTOCOL.md) - Agent communication
- [PRD: YAML-to-Markdown Generator](yaml-to-markdown-generator.md) - Related generator PRD
- [fold-prompt.yaml](../../packages/core/commands/fold-prompt.yaml) - Current command definition
