# Ensemble vNext - Implementation Notes

> This document captures technical decisions and clarifications from architecture discussions.
> See `architecture.md` for the high-level design.

---

## Design Decisions

### Architecture & Migration

| Decision | Resolution |
|----------|------------|
| Relationship to current Ensemble | Major refactor/replacement, not evolution |
| Distribution mechanism | Claude Code plugin marketplace |
| Version tracking | Plugin version embedded in vendored files |
| Agent consolidation (28 → ~11) | Intentional trim based on actual usage patterns |
| Primary goal | Enable autonomous development with engineer oversight |

### Subagent Configuration

| Setting | Resolution |
|---------|------------|
| Tool restrictions | All tools enabled by default (no `tools:` line in frontmatter) |
| Skills specification | Explicit skills based on project tech stack (defined in `stack.md`) |
| Frontmatter reference | See Claude Code docs: name, description, model, color, tools (optional) |

### Orchestration Model

**Decision**: The command IS the orchestrator. There is no separate orchestrator subagent.

The implement→verify→simplify→verify→review cycle is encoded in:
1. The command's structured workflow (primary enforcement)
2. Rules files (`.claude/rules/process.md`) for guidance when users work outside commands
3. Stop hooks for completion gating in autonomy mode

**Rationale**:
- Visibility - workflow is explicit in the command definition
- Debuggability - easy to understand what's happening
- Determinism - consistent execution path every time
- Simplicity - no hook ordering concerns or hidden state

### Artifact Locations

| Artifact | Location |
|----------|----------|
| PRD | `docs/PRD/` |
| TRD | `docs/TRD/` |
| Execution plan | TBD (embedded in TRD or separate) |
| Status tracking | `.trd-state/<trd-name>/implement.json` |
| Constitution | `.claude/rules/constitution.md` |
| Stack definition | `.claude/rules/stack.md` |
| Process rules | `.claude/rules/process.md` |
| Living memory | `CLAUDE.md` (project root) |

### Plan Mode Output

**Question**: What does `/plan-trd` produce?

**Options to explore**:
- Embed plan in TRD itself (add "Execution Plan" section)
- Use TodoWrite to create structured task list
- Generate separate plan artifact

**Key outputs required**:
1. Parallelization opportunities
2. Offloadable work for remote/web sessions
3. Operational mechanics for execution

### Quality Gates

| Aspect | Resolution |
|--------|------------|
| Gate type | Automated (tests pass, coverage thresholds) |
| User intervention | Minimal; retry until success with guardrails |
| Simplification gate | Automated; runs only after verification passes |
| Review gate | Automated code review agent |

### Error Recovery

| Scenario | Behavior |
|----------|----------|
| Test failure | Retry with debug loop (max 2-3 attempts) |
| Persistent failure | Pause for user decision |
| Coverage below threshold | Strategy-dependent (block/warn/continue) |

### Parallel Execution

| Aspect | Resolution |
|--------|------------|
| Conflict detection | Planning stage determines parallelizable tasks |
| Conflict resolution | Deconflict during merge |
| Cross-cutting concerns | Handle in merge; not a primary concern |

---

## Hook Configuration

### Permitter Hook (PermissionRequest)

Smart bash permission expansion that reduces friction for common command patterns.

**Problem solved**: Claude Code's permission allowlist uses exact prefix matching. `Bash(npm test:*)` won't match `API_KEY=x npm test` or `timeout 30 npm test`.

**How it works**:
1. Intercepts bash permission requests
2. Normalizes command (strips env vars, wrappers like `timeout`, chains like `&&`)
3. Matches normalized commands against allowlist
4. Auto-approves if all extracted commands match

**Key properties**:
- Never creates new permissions—only recognizes equivalent forms
- Fail-closed design—any parse error defers to normal permission flow
- Rejects unsafe constructs (`$()`, heredocs, process substitution)

### Router Hook (UserPromptSubmit)

Generates router-rules.json files (global + project-specific) by analyzing documentation and codebase. Matches keywords/patterns and injects context steering to appropriate commands/skills/subagents.

**vNext behavior**: Similar pattern, streamlined for vendored runtime.

### Formatter Hook (PostToolUse)

| Aspect | Resolution |
|--------|------------|
| Scope | PostToolUse on Edit/Write |
| Default | Simple, standard prettifier supporting many languages |
| Configuration | Project-configurable |

### Status Hook (SubagentStop)

Updates status artifact on every subagent completion.

### Learning Hook (SessionEnd)

| Aspect | Resolution |
|--------|------------|
| Scope | Auto-captures session learnings |
| Target | CLAUDE.md only (never Constitution) |
| Behavior | Non-blocking; keeps updates brief |

---

## Learning Loop Details

### SessionEnd (Automatic)

- Runs automatically at session end
- Updates CLAUDE.md with conventions, patterns, "do not repeat" knowledge
- **Cannot** modify Constitution
- Keeps updates brief to prevent bloat

### /update-project (Manual)

| Target | Behavior |
|--------|----------|
| CLAUDE.md | Updated automatically |
| Constitution | Proposes changes; requires explicit user confirmation |
| Subagent prompts | Updated when delegation quality needs improvement |

**Use cases**:
- Force learning capture mid-session
- Propose Constitution changes based on session learnings
- Improve subagent delegation prompts

---

## Secondary LLM Review

### Activation Requirements

Secondary review is **disabled by default**. Both conditions must be met:

1. Environment variable: `ENSEMBLE_SECONDARY_REVIEW=1`
2. Credentials in `.claude/settings.local.json`

### Configuration

```json
{
  "ensemble": {
    "secondaryReview": {
      "provider": "openai",
      "model": "gpt-4o"
    }
  }
}
```

### Behavior

- Submits (Story + PRD) for PRD review
- Submits (PRD + TRD) for TRD review
- Returns structured critique integrated into refinement workflow
- Secondary LLM sees only artifacts, not codebase

---

## Wiggum Mode + Cloud Offload

### Design Intent

Wiggum mode (`/implement-trd --wiggum`) and cloud/web offload are designed to work together for "fire and forget" tasks.

### Pattern

1. Plan locally with `/plan-trd`
2. Offload with `& /implement-trd --wiggum`
3. Cloud session runs autonomously until completion promise
4. Monitor with `/tasks`
5. Pull completed work with `/teleport`

### Completion Promise

Emitted only when ALL gates pass:
- Implementation complete
- Tests passing
- Coverage thresholds met
- Code simplified
- Review approved
- Artifacts/status updated

---

## Skills Directory Structure

Skills use a directory-per-skill structure supporting progressive disclosure:

```
.claude/skills/
├── react/
│   ├── SKILL.md          # Main skill definition (required)
│   ├── REFERENCE.md      # Additional reference material (optional)
│   ├── VALIDATION.md     # Validation criteria (optional)
│   └── examples/         # Code examples (optional)
│       └── README.md
├── typescript/
│   └── SKILL.md
└── testing/
    └── SKILL.md
```

### SKILL.md Format

```yaml
---
name: Skill Name
description: This skill should be used when the user asks to "phrase 1", "phrase 2"...
version: 1.0.0
---

Skill instructions and guidance...
```

---

## init-project Behavior

### Comprehensive Repo Scan

`init-project` doesn't just look at dependency files. It performs a comprehensive scan:

1. **Dependency files** - package.json, requirements.txt, Gemfile, etc.
2. **Project structure** - Directory layout, file organization
3. **Architecture patterns** - How code is organized (MVC, Clean Architecture, etc.)
4. **Existing conventions** - Code style, naming patterns, module structure

### Output

- `.claude/` directory structure
- Project subagents
- Compiled skills based on repo analysis
- Workflow commands
- Hook configuration
- Constitution template
- Stack definition (`.claude/rules/stack.md`)
- Process rules template
- Updated `.gitignore`
- CLAUDE.md template

### .gitignore Handling

```gitignore
# Track .claude/ directory
!.claude/

# But ignore local settings
.claude/settings.local.json
.claude/*.local.*
```

---

## Plugin Commands

| Command | Purpose |
|---------|---------|
| `/init-project` | Generate initial vendored runtime |
| `/rebase-project` | Upgrade vendored runtime to newer plugin version |
| `/add-skill <name>` | Add additional skills without full rebase |

### /add-skill

Adds skills to `.claude/skills/<skill-name>/` without requiring a full rebase:
- Validates skill exists in plugin library
- Compiles and trims for project context
- Preserves existing skills

---

## Claude Code Frontmatter Reference

### Agents (`.claude/agents/*.md`)

```yaml
---
name: agent-identifier
description: Use this agent when [triggering conditions]...
model: inherit  # or: sonnet, opus, haiku
color: blue     # terminal color
tools: ["Read", "Write", "Grep", "Bash"]  # OPTIONAL - omit for all tools
---

System prompt content...
```

**vNext convention**: Omit `tools:` line to enable all tools.

### Skills (`.claude/skills/<name>/SKILL.md`)

```yaml
---
name: Skill Name
description: This skill should be used when the user asks to "phrase 1", "phrase 2"...
version: 1.0.0
---

Skill instructions and guidance...
```

### Commands (`.claude/commands/*.md`)

```yaml
---
description: Brief description
argument-hint: [arg1] [arg2]
allowed-tools: Read, Bash(git:*)
model: sonnet
---

Command prompt content with:
- Arguments: $1, $2, or $ARGUMENTS
- Files: @path/to/file
- Bash: !`command here`
```

---

## Status Tracking Schema

From `implement-trd-enhanced.md` (current Ensemble):

```json
{
  "trd_file": "docs/TRD/feature.md",
  "trd_hash": "<sha256>",
  "branch": "feature/feature-name",
  "strategy": "tdd",
  "phase_cursor": 2,
  "tasks": {
    "TRD-001": { "status": "success", "commit": "abc1234" },
    "TRD-002": { "status": "failed", "error": "Test assertion failed" }
  },
  "coverage": { "unit": 0.82, "integration": 0.71 },
  "checkpoints": [
    { "phase": 1, "commit": "def5678", "timestamp": "..." }
  ]
}
```

---

## MCP Integration

| Server | Status |
|--------|--------|
| Context7 | Supported |
| Playwright | Supported |
| Others | Project-configurable via `.mcp.json` |

---

## Open Items

- [ ] Plan mode output format (TodoWrite vs artifact vs embedded in TRD)
- [ ] Exact remote branch naming convention
- [ ] Status artifact merge conflict resolution strategy
- [ ] Monorepo/multi-repo support scope
- [ ] Testing strategy for vendored components
- [ ] Wiggum fallback loop implementation details

---

## Reference: Boris Jabes Workflow

Key patterns from the Claude Code creator that inform vNext:

1. **Plan mode priority** - Sessions start in plan mode; iterate on plan before execution
2. **Parallel execution** - 5+ local instances, 5-10 web sessions, iOS throughout day
3. **Verification-centric** - "Give Claude a way to verify its work" improves quality 2-3x
4. **Post-processing subagents** - `code-simplifier`, `verify-app` run after implementation
5. **Living CLAUDE.md** - Updated multiple times weekly with learnings
6. **Permission pre-allow** - Use `/permissions` rather than skip permissions
7. **MCP integration** - Slack, BigQuery, Sentry for autonomous operation

**vNext goal**: Encode these patterns into a repeatable framework so less experienced engineers can operate at a level approaching what Boris achieves intuitively—running parallel sessions, maintaining verification discipline, and delegating effectively.
