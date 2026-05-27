---
name: ensemble:inject-standards
description: Selectively inject relevant standards from standards/index.yml into agent context based on current task
version: 1.0.0
category: implementation
last-updated: 2026-03-29
argument-hint: <task-description>
---
<!-- DO NOT EDIT - Generated from inject-standards.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Read the project standards index and emit a compact, task-relevant subset of coding
conventions to stdout for immediate use by the current agent context. Rather than
loading all standards every session, this command scores each rule against the provided
task description and selects the top 5-8 most applicable rules -- keeping token cost
minimal while ensuring the right conventions are surfaced at the right time.

## Workflow

### Phase 1: Standards Loading

**1. Standards Discovery**
   Verify the standards index exists before proceeding

   - Check if standards/index.yml exists in the project root
   - If standards/index.yml does not exist: print "ERROR: No standards index found. Run /ensemble:discover-standards first." and stop
   - If the file exists, read standards/index.yml fully into memory
   - Note the stack metadata (language, framework) and the full list of categories and rules

**2. Task Analysis**
   Parse the task description and extract keyword signals for relevance matching

   - Read $ARGUMENTS as TASK_DESCRIPTION
   - If TASK_DESCRIPTION is empty: print "ERROR: Provide a task description, e.g., /ensemble:inject-standards 'implement user authentication endpoint'" and stop
   - Convert TASK_DESCRIPTION to lowercase and extract individual keywords
   - Identify technology terms (language names, framework names, library names)
   - Identify domain nouns (user, order, payment, product, auth, session, etc.)
   - Identify task verbs: implement, fix, test, refactor, add, remove, update, debug, review

### Phase 2: Relevance Matching

**1. Category Scoring**
   Score each standards category against the extracted task keywords

   - Assign a base score of 0 to each category (naming, testing, imports, error_handling, git, api)
   - Always boost naming by +10 -- naming conventions apply to every coding task
   - Always boost git by +10 -- commit and branch conventions apply to every coding task
   - Boost testing by +8 if TASK_DESCRIPTION contains: test, spec, coverage, unit, integration, e2e, fixture, mock
   - Boost api by +8 if TASK_DESCRIPTION contains: api, endpoint, route, controller, handler, request, response, REST, GraphQL
   - Boost error_handling by +8 if TASK_DESCRIPTION contains: fix, bug, error, exception, crash, failure, handle, rescue
   - Boost imports by +5 if TASK_DESCRIPTION contains: import, require, module, dependency, package, library
   - Rank categories by final score descending

**2. Rule Selection**
   Choose the top 5-8 individual rules most relevant to the task

   - Always include all naming rules (naming conventions are universal)
   - Always include all git rules (commit and branch conventions are universal)
   - From remaining categories ordered by score, include all rules from the top-scoring category
   - From the second-highest scoring non-universal category, include up to 3 rules
   - Stop once the total selected rule count is between 5 and 8
   - If fewer than 5 rules exist in the index total, include all rules

### Phase 3: Context Injection

**1. Standards Summary Output**
   Print a compact, agent-consumable standards block to stdout

   - Print header: "=== RELEVANT STANDARDS FOR: <TASK_DESCRIPTION> ==="
   - Print stack line: "Stack: <language> + <framework>"
   - Print a blank line
   - For each selected category, print the category name followed by each selected rule as a bullet
   - For rules that have an example field, append it inline: "- <rule>  [example: <example>]"
   - Print footer: "Full index: standards/index.yml"
   - Print closing line: "====================================="

**2. Handoff Note**
   Print instructions for the agent to proceed with the injected context

   - Print: "Standards injected. Proceed with task using the above conventions."
   - Print: "Run /ensemble:discover-standards to refresh the index if the codebase has changed."

## Expected Output

**Format:** Stdout block containing filtered standards relevant to the provided task description

**Structure:**
- **Standards Block**: Compact formatted output listing stack, selected rules grouped by category, and path to full index
- **Handoff Note**: One-line instruction confirming standards are injected and advising how to refresh the index

## Usage

```
/ensemble:inject-standards <task-description>
```
