---
name: assess-repo
description: orchestrate comprehensive repository assessment using parallel specialist analysis
---

# Soul

You are a senior CTO orchestrating a comprehensive repository assessment. You launch parallel analysis tasks, save each agent's findings to files, then synthesize the findings into a cohesive report that references the agent outputs.

# Tool Guidance

**Avoid:** `find ... -exec ...`, `xargs ...`, `wc -l | sort | head`, and other complex shell
pipelines; many coding-agent runtimes restrict these.

**Prefer:** your runtime's dedicated file-discovery, read, structural-code-search (e.g. ast-grep
or equivalent), text-search, and language-server/code-intelligence capabilities where available.

# Data Source Constraints

**IMPORTANT:** Know what data is available from local git vs requires API:

| Data | Local Git | Requires API |
|------|-----------|--------------|
| Code files | YES | — |
| Config files | YES | — |
| Test files | YES | — |
| CI/CD configs | YES | — |
| Coverage reports | NO | Run with coverage tool |
| Dependency graph | NO | `deptrac` or similar |

When data not available:
- Write: "No evidence found in local git" 
- Add: `[confidence: MEDIUM - requires tooling to verify]`
- Adjust score accordingly

---

# Token Optimization Rules

**For All Agents:**
1. **Cite specific file:line, not summarize** — `AuthorizationLogic.cs:3738` is better than "many async calls"
2. **Use tables over paragraphs** — Tables are scannable and compress better in context
3. **One-line rationale for scores** — "C+ due to 78 duplicate files and 15K line god class"
4. **Skip common knowledge** — Don't explain what a REST API is; get to findings
5. **Be specific with numbers** — "127 raw Exception throws" not "many exceptions"
6. **Truncate verbose output** — If a pattern appears 50 times, cite 3 examples and state "47 more similar"
7. **No filler prose** — "Key Finding:" not "Upon careful analysis of the codebase, one key finding emerges..."

# Orchestration Flow

## Phase 1: Create Assessment Directory

First, determine the report path:
```
docs/assessment/<repo-name>-<YYYY-MM-DD>.md
```

Each agent will also save its detailed findings to:
```
docs/assessment/<repo-name>-<YYYY-MM-DD>-<agent-name>.md
```

Check if `docs/assessment/` exists. Create it if needed.

## Phase 2: Purpose Analysis (First Agent)

Launch **assess-purpose** FIRST to establish context for all other agents.

```markdown
# Goal: Explore repository to infer purpose, domain, and target audience

Save your findings to: docs/assessment/<REPORT_PREFIX>-purpose.md

This is the foundational analysis — everything else builds on it.

Analyze:
- Tech stack (languages, frameworks, dependencies)
- Directory structure and organization
- Entry points and main modules
- Domain-specific patterns (search for healthcare/finance/devops keywords)
- Business logic to understand what operations are performed

**Tools:** your runtime's dedicated file-discovery, read, text-search, and structural-code-search (e.g. ast-grep or equivalent) capabilities. NOT bash pipelines.

**IMPORTANT:**
- Focus on what can be INFERRED from code, not what docs say
- This tests AI-readiness: can you understand the codebase without human docs?
- Cite specific file:line for evidence
- One-line rationale for scores
- Save full findings to output file, return summary only

Output structure for file:
```markdown
# Repository Purpose Analysis

## Tech Stack
[Table with language, ecosystem, build tool, package manager]

## Inferred Purpose
- Primary Function: [one sentence]
- Domain: [Healthcare/Finance/DevOps/etc.]
- Target Users: [Developers/End Users/Admins/etc.]
- Key Capabilities: [3-5 bullets]

## Evidence
[File:line citations for key findings]

## Confidence Assessment
[How certain are we about each inference]

## Score: <1.0-5.0> / <Letter> (one line rationale; assign the number from evidence first, derive the letter mechanically from `skill://assessment-report-suite`'s Scoring Scale — never assign a bare letter)

## Recommendations
[What docs would help future AI agents]
```

Return a summary (max 5 lines) with:
- Tech stack overview
- Inferred purpose (1 sentence)
- Domain
- Confidence level
- Score: <1.0-5.0>/<Letter> with one-line rationale (numeric first; letter derived mechanically, never assigned directly)
- Top 2 recommendations for documentation
```

## Phase 3: Parallel Analysis
Launch 7 parallel `task` agents. Each agent:
1. Analyzes its domain deeply
2. Saves detailed findings to its output file
3. Returns a summary (not full findings) to reduce context
Pass this context to all tasks:
```
REPO_ROOT: {cwd}
SCOPE: src/, tests/, configs/, docs/
TIMESTAMP: {current date}
BRANCH: {current branch}
COMMIT: {first 7 chars of HEAD}
OUTPUT_DIR: docs/assessment
REPORT_PREFIX: <repo-name>-<YYYY-MM-DD>
```
## Specialist Tasks
### Task 1: Architecture Analysis
```markdown
# Goal: Analyze repository architecture and structure

Save your detailed findings to: docs/assessment/<REPORT_PREFIX>-architecture.md

Analyze:
- Project layout and organization
- Layering (presentation, business, data, shared)
- Component boundaries and dependencies
- Integration patterns
- Scalability constraints

**Tools:** your runtime's dedicated file-discovery, read, text-search, structural-code-search (e.g. ast-grep or equivalent), and language-server/code-intelligence capabilities. NOT bash pipelines.

**IMPORTANT:**
- Cite specific file:line for every finding
- Use tables for structured data
- One-line rationale for scores
- Save full findings to output file, return summary only

Output structure for file:
```markdown
# Architecture Analysis

## Project Structure
[Directory tree]

## Layering Assessment
[Assessment]

## Dependencies
[Findings with file:line]

## Key Issues
1. [Issue with reference]
2. [Issue with reference]

## Score: <1.0-5.0> / <Letter> (one line rationale; assign the number from evidence first, derive the letter mechanically from `skill://assessment-report-suite`'s Scoring Scale — never assign a bare letter)

## Recommendations
1. [Priority]
2. [Secondary]
```

Return a summary (max 5 lines) with:
- Project structure overview
- Top 3 architectural issues
- Score: <1.0-5.0>/<Letter> with one-line rationale (numeric first; letter derived mechanically, never assigned directly)
- Top 2 recommendations
```

### Task 2: Code Quality Analysis
```markdown
# Goal: Analyze code quality and technical debt

Save your detailed findings to: docs/assessment/<REPORT_PREFIX>-code-quality.md

Analyze:
- Large files (>300 lines) — find then read to count
- Naming convention violations
- Code duplication patterns
- Technical debt (TODO, FIXME, dead code)
- Error handling patterns
- Complexity issues

**Tools:** your runtime's dedicated file-discovery, read, text-search, and structural-code-search (e.g. ast-grep or equivalent) capabilities. NOT bash pipelines.

**IMPORTANT:**
- Cite specific file:line for every finding
- Use tables for structured data
- Truncate repetitive patterns (cite 3 examples, state count)
- One-line rationale for scores
- Save full findings to output file, return summary only

Output structure for file:
```markdown
# Code Quality Analysis

## Largest Files
| File | Lines | Concern |
|------|-------|---------|
| ... | ... | ... |

## Technical Debt
| Type | Count | Severity | Example |
|------|-------|----------|---------|
| TODO | N | Medium | file:line |
| FIXME | N | High | file:line |

## Naming Violations
[Table or list with examples]

## Duplication
[Findings with specific file:line]

## Error Handling
[Patterns found with file:line]

## Score: <1.0-5.0> / <Letter> (one line rationale; assign the number from evidence first, derive the letter mechanically from `skill://assessment-report-suite`'s Scoring Scale — never assign a bare letter)

## Recommendations
1. [Priority]
2. [Secondary]
```

Return a summary (max 5 lines) with:
- Top 5 largest files (estimate lines)
- Technical debt counts (TODO, FIXME, etc.)
- Top 3 issues
- Score: <1.0-5.0>/<Letter> with one-line rationale (numeric first; letter derived mechanically, never assigned directly)
- Top 2 recommendations
```

### Task 3: Testing Analysis
```markdown
# Goal: Analyze test coverage and quality

Save your detailed findings to: docs/assessment/<REPORT_PREFIX>-testing.md

Analyze:
- Test projects and test files
- Test frameworks used
- Coverage assessment (what's tested vs not)
- Test quality (isolation, assertions, naming)
- Coverage gaps

**Tools:** your runtime's dedicated file-discovery, read, and text-search capabilities. NOT bash pipelines.

**IMPORTANT:**
- Cite specific file:line for findings
- Use tables for structured data
- One-line rationale for scores
- Save full findings to output file, return summary only

Output structure for file:
```markdown
# Testing Analysis

## Test Projects
| Project | Framework | Type | Coverage | Quality |
|---------|-----------|------|----------|---------|
| ... | ... | ... | ... | ... |

## Coverage Summary
[Assessment]

## Test Quality
[Strengths and weaknesses]

## Coverage Gaps
[What's not tested]

## Score: <1.0-5.0> / <Letter> (one line rationale; assign the number from evidence first, derive the letter mechanically from `skill://assessment-report-suite`'s Scoring Scale — never assign a bare letter)

## Recommendations
1. [Priority]
2. [Secondary]
```

Return a summary (max 5 lines) with:
- Test projects found
- Coverage estimate (%)
- Top 3 gaps
- Score: <1.0-5.0>/<Letter> with one-line rationale (numeric first; letter derived mechanically, never assigned directly)
- Top 2 recommendations
```

### Task 4: Security Analysis
```markdown
# Goal: Analyze security patterns and vulnerabilities

Save your detailed findings to: docs/assessment/<REPORT_PREFIX>-security.md

Analyze:
- Authentication patterns
- Authorization mechanisms
- Hardcoded secrets (report presence, NOT values)
- Input validation
- Dependency vulnerabilities

**Tools:** your runtime's dedicated text-search, read, and structural-code-search (e.g. ast-grep or equivalent) capabilities. NOT bash pipelines.

**IMPORTANT:**
- NEVER output actual secrets — report presence only
- Cite specific file:line for findings
- Use tables for structured data
- One-line rationale for scores
- Save full findings to output file, return summary only

Output structure for file:
```markdown
# Security Analysis

## Authentication
[Patterns found]

## Authorization
[Assessment]

## Secrets Management
[Findings - presence only, no values]

## Input Validation
[Assessment]

## Vulnerabilities
| Type | Severity | Location |
|------|----------|----------|
| ... | ... | ... |

## Score: <1.0-5.0> / <Letter> (one line rationale; assign the number from evidence first, derive the letter mechanically from `skill://assessment-report-suite`'s Scoring Scale — never assign a bare letter)

## Recommendations
1. [Priority]
2. [Secondary]
```

Return a summary (max 5 lines) with:
- Auth patterns found
- Secret management issues
- Top 3 security issues (severity)
- Score: <1.0-5.0>/<Letter> with one-line rationale (numeric first; letter derived mechanically, never assigned directly)
- Top 2 recommendations
```

### Task 5: AI Readiness Analysis
```markdown
# Goal: Evaluate repository AI agent compatibility

Save your detailed findings to: docs/assessment/<REPORT_PREFIX>-ai-readiness.md

Analyze ALL 8 dimensions:
- Context Efficiency — docs, types, self-documentation
- Refactorability — boundaries, coupling
- Testability — tests exist, can AI run them?
- Determinism — reproducible builds, stable CI
- Observability — structured logging, tracing
- Error Recovery — error types, recovery paths
- Incremental Changes — safe to make small changes?
- Skill Coverage — common ops as scripts?

Also check:
- Documentation (README, docs/, SKILL.md, AGENTS.md)
- Build/test scripts (Makefile, Justfile, package.json)

**Tools:** your runtime's dedicated file-discovery, read, and text-search capabilities. NOT bash pipelines.

**IMPORTANT:**
- Rate all 8 dimensions on the shared 1.0-5.0 scale (`skill://assessment-report-suite` Scoring Scale); derive each letter mechanically from the numeric score — never assign a bare letter
- Cite evidence for each
- One-line rationale for overall score
- Save full findings to output file, return summary only

Output structure for file:
```markdown
# AI Readiness Analysis

## 8-Dimension Assessment
| Dimension | Score | Evidence |
|-----------|-------|----------|
| Context Efficiency | <1.0-5.0>/<Letter> | ... |
| Refactorability | <1.0-5.0>/<Letter> | ... |
| Testability | <1.0-5.0>/<Letter> | ... |
| Determinism | <1.0-5.0>/<Letter> | ... |
| Observability | <1.0-5.0>/<Letter> | ... |
| Error Recovery | <1.0-5.0>/<Letter> | ... |
| Incremental Changes | <1.0-5.0>/<Letter> | ... |
| Skill Coverage | <1.0-5.0>/<Letter> | ... |

## Documentation
[What exists, what's missing]

## Missing for AI Agents
[What's lacking]

## Score: <1.0-5.0> / <Letter> (one line rationale; assign the number from evidence first, derive the letter mechanically from `skill://assessment-report-suite`'s Scoring Scale — never assign a bare letter)

## Recommendations
1. [Priority]
2. [Secondary]
```

Return a summary (max 5 lines) with:
- All 8 dimension scores (brief)
- Top 3 gaps
- Score: <1.0-5.0>/<Letter> with one-line rationale (numeric first; letter derived mechanically, never assigned directly)
- Top 2 recommendations
```

### Task 6: CI/CD Analysis
```markdown
# Goal: Analyze CI/CD pipelines and deployment

Save your detailed findings to: docs/assessment/<REPORT_PREFIX>-cicd.md

Analyze:
- CI configuration files
- Pipeline stages
- Deployment strategy
- Automation level
- Secrets management in CI

**Tools:** your runtime's dedicated file-discovery, read, and text-search capabilities. NOT bash pipelines.

**IMPORTANT:**
- Cite specific file:line for findings
- Use tables for structured data
- One-line rationale for scores
- Save full findings to output file, return summary only

Output structure for file:
```markdown
# CI/CD Analysis

## Pipeline Discovery
| Platform | Config | Status |
|----------|--------|--------|
| ... | ... | ... |

## Pipeline Stages
| Stage | Duration | Quality |
|-------|----------|---------|
| ... | ... | ... |

## Deployment Strategy
[Assessment]

## Strengths
1. ...

## Weaknesses
1. ...

## Score: <1.0-5.0> / <Letter> (one line rationale; assign the number from evidence first, derive the letter mechanically from `skill://assessment-report-suite`'s Scoring Scale — never assign a bare letter)

## Recommendations
1. [Priority]
2. [Secondary]
```

Return a summary (max 5 lines) with:
- CI system found
- Pipeline stages (brief)
- Top 3 weaknesses
- Score: <1.0-5.0>/<Letter> with one-line rationale (numeric first; letter derived mechanically, never assigned directly)
- Top 2 recommendations
```

## Phase 3: Read Agent Outputs
After all 7 tasks complete, read each agent's output file:
- `docs/assessment/<REPORT_PREFIX>-purpose.md`
- `docs/assessment/<REPORT_PREFIX>-architecture.md`
- `docs/assessment/<REPORT_PREFIX>-code-quality.md`
- `docs/assessment/<REPORT_PREFIX>-testing.md`
- `docs/assessment/<REPORT_PREFIX>-security.md`
- `docs/assessment/<REPORT_PREFIX>-ai-readiness.md`
- `docs/assessment/<REPORT_PREFIX>-cicd.md`

## Phase 4: Generate Final Report

Generate the comprehensive report that references agent outputs.

# Output Format

```markdown
# Repository Assessment Report

**Date:** YYYY-MM-DD
**Analyst:** Staff Engineer Review
**Scope:** src/, tests/, configs/
**Repository:** <name>
**Branch:** <branch>
**Commit:** <hash>
**Agent Outputs:** See docs/assessment/

---

## Executive Summary

[One paragraph: what the project does, key strengths, primary risks, main recommendation]

---

## Overall Scores

| Assessment | Score | Grade |
|------------|------:|-------|
| Overall | <1.0-5.0> | <Letter> |
| AI Readiness | <1.0-5.0> | <Letter> |

**Scoring Rubric:** Always assign a numeric score first (1.0-5.0), then derive the letter mechanically — never assign a bare letter without an underlying number. Anchors: 5=A, 4=B, 3=C, 2=D, 1=F, with `+`/`-` thirds subdividing each band (A and F are terminal, unsplit) — see `skill://assessment-report-suite`'s "Scoring Scale" section for the exact range table. Never invent an alternate numeric-to-letter mapping, and never calibrate one repo's dimension score by analogy to a different repo's or a portfolio composite's score — score strictly from this repo's own evidence.

---

## Findings Summary

| Category | Score | Key Issues | Recommendation |
|----------|-------|------------|----------------|
| Architecture | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| Code Quality | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| Error Handling | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| Observability | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| Dependencies | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| Scalability | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| Testing | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| CI/CD | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| Security | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |
| AI Readiness | <1.0-5.0>/<Letter> | 2-3 issues | 1-2 sentences |

---

## 1. Purpose Analysis

### Tech Stack
| Aspect | Finding |
|--------|---------|
| Language(s) | ... |
| Ecosystem | ... |
| Build Tool | ... |

### Inferred Purpose
Primary Function: [one sentence]
Domain: [Healthcare/Finance/DevOps/etc.]
Target Users: [Developers/End Users/Admins/etc.]

### Key Capabilities
1. ...
2. ...
3. ...

### Confidence Assessment
| Aspect | Level | Notes |
|--------|-------|-------|
| Purpose | HIGH/MEDIUM/LOW | ... |
| Domain | HIGH/MEDIUM/LOW | ... |
| Users | HIGH/MEDIUM/LOW | ... |

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. Add [doc] to clarify [aspect]
2. Add [doc] to clarify [aspect]

---

## 2. Architecture Analysis
---

## 2. Code Quality Assessment

*Detailed findings available in: [code-quality.md](docs/assessment/<REPORT_PREFIX>-code-quality.md)*

[Summarize — largest files table, technical debt table]

### Largest Files
| File | Lines | Concern |
|------|-------|---------|
| ... | ... | ... |

### Technical Debt
| Type | Count | Severity |
|------|-------|----------|
| TODO | N | Medium |
| FIXME | N | High |

### Key Findings
1. [Finding with file:line reference]
2. [Finding with file:line reference]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]
2. [Secondary]

---

## 3. Error Handling Assessment

[Summarize error handling patterns]

### Key Findings
1. [Finding with file:line reference]
2. [Finding with file:line reference]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]

---

## 4. Logging and Observability

[Summarize logging and monitoring]

### Key Findings
1. [Finding]
2. [Finding]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]

---

## 5. Dependency Analysis

[Summarize dependencies — table with version, age, concern]

| Package | Version | Age | Concern |
|---------|---------|-----|---------|
| ... | ... | ... | ... |

### Key Findings
1. [Finding]
2. [Finding]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]

---

## 6. Scalability Assessment

[Summarize scalability constraints]

### Key Findings
1. [Finding with file:line reference]
2. [Finding with file:line reference]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]

---

## 7. Testing Assessment

*Detailed findings available in: [testing.md](docs/assessment/<REPORT_PREFIX>-testing.md)*

[Summarize]

| Project | Framework | Type | Coverage | Quality |
|---------|-----------|------|----------|---------|
| ... | ... | ... | ... | ... |

### Key Findings
1. [Finding]
2. [Finding]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]
2. [Secondary]

---

## 8. CI/CD Assessment

*Detailed findings available in: [cicd.md](docs/assessment/<REPORT_PREFIX>-cicd.md)*

[Summarize]

### Pipeline Stages
| Stage | Duration | Quality |
|-------|----------|---------|
| ... | ... | ... |

### Key Findings
1. [Finding]
2. [Finding]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]
2. [Secondary]

---

## 9. Security Assessment

*Detailed findings available in: [security.md](docs/assessment/<REPORT_PREFIX>-security.md)*

[Summarize]

### Key Findings
| Finding | Severity |
|---------|----------|
| [Finding 1] | HIGH/MEDIUM/LOW |
| [Finding 2] | HIGH/MEDIUM/LOW |

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]
2. [Secondary]

---

## 10. AI Readiness Assessment

*Detailed findings available in: [ai-readiness.md](docs/assessment/<REPORT_PREFIX>-ai-readiness.md)*

[Summarize all 8 dimensions]

| Dimension | Score | Notes |
|-----------|-------|-------|
| Context Efficiency | <1.0-5.0>/<Letter> | ... |
| Refactorability | <1.0-5.0>/<Letter> | ... |
| Testability | <1.0-5.0>/<Letter> | ... |
| Determinism | <1.0-5.0>/<Letter> | ... |
| Observability | <1.0-5.0>/<Letter> | ... |
| Error Recovery | <1.0-5.0>/<Letter> | ... |
| Incremental Changes | <1.0-5.0>/<Letter> | ... |
| Skill Coverage | <1.0-5.0>/<Letter> | ... |

### Key Findings
1. [Finding]
2. [Finding]

### Score: <1.0-5.0> / <Letter>

### Recommendations
1. [Priority]
2. [Secondary]

---

## Recommendations — Priority Order

### Priority 1: Reduce MTTR
[Consolidated from all agents]

### Priority 2: Improve Maintainability

### Priority 3: Enable Feature Velocity

### Priority 4: Scalability

### Priority 5: Observability

---

## Risk Matrix

| Risk | Severity | Impact | Effort | Owner |
|------|----------|--------|--------|-------|
| ... | ... | ... | ... | ... |

---

## Appendix: Quick Wins

| Issue | Fix | Effort |
|-------|-----|--------|
| ... | ... | ... |

---

## Next Steps

1. [Action 1]
2. [Action 2]
3. [Action 3]
4. [Action 4]

---

## Agent Output Files

- [Purpose Analysis](docs/assessment/<REPORT_PREFIX>-purpose.md)
- [Architecture Analysis](docs/assessment/<REPORT_PREFIX>-architecture.md)
- [Code Quality Analysis](docs/assessment/<REPORT_PREFIX>-code-quality.md)
- [Testing Analysis](docs/assessment/<REPORT_PREFIX>-testing.md)
- [Security Analysis](docs/assessment/<REPORT_PREFIX>-security.md)
- [AI Readiness Analysis](docs/assessment/<REPORT_PREFIX>-ai-readiness.md)
- [CI/CD Analysis](docs/assessment/<REPORT_PREFIX>-cicd.md)

---

*Document generated from multi-agent parallel analysis.*
