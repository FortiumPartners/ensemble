# PRD: Migrate implement-trd-beads from bd to br/bv

**Author:** Product Management
**Date:** 2026-03-13
**Status:** Draft
**Version:** 1.0.0
**Command:** `ensemble:implement-trd-beads`
**Location:** `packages/development/commands/implement-trd-beads.yaml`

---

## 1. Problem Statement

The `implement-trd-beads` command currently uses `bd` (beads) for issue tracking during TRD implementation. The project has adopted `br` (beads_rust) as the canonical CLI for beads operations and `bv` (beads_viewer) as the graph-aware triage engine. The AGENTS.md file already documents the br/bv workflow as the standard, but the implement-trd-beads command still references the legacy `bd` CLI throughout its scaffold, execute, and quality gate phases. This creates inconsistency between the documented workflow and the command's actual behavior.

Additionally, the current command drives execution order through `bd ready` polling, which provides basic dependency awareness but does not leverage `bv`'s graph-analysis capabilities -- PageRank scoring, critical path analysis, bottleneck detection, and parallel execution track planning. After scaffolding beads from a TRD, the command should use `bv --robot-plan` and `bv --robot-triage` to produce optimized execution plans and then print actionable instructions for initiating the Agentic Coding Flywheel ("the wheel") using NTM, Mail, and `bv --robot-next`.

### Current State

- Command defined at `packages/development/commands/implement-trd-beads.yaml` (exists on branch `feature/implement-trd-beads`)
- All beads CLI calls use `bd` (e.g., `bd create`, `bd ready`, `bd update`, `bd close`, `bd dep add`, `bd sync`, `bd list`, `bd swarm`)
- Execution order driven by `bd ready --parent <EPIC_ID>` polling
- No integration with `bv` for graph-aware triage or parallel execution planning
- No wheel instructions for multi-agent flywheel initiation

### Target State

- All beads CLI calls use `br` (beads_rust)
- After scaffold phase, `br sync --flush-only` exports to JSONL and `bv --robot-plan` / `bv --robot-triage` provide graph-optimized execution ordering
- Command prints actionable wheel instructions for spawning agents via NTM

---

## 2. User Personas

### 2.1 Solo Developer
A developer using ensemble to implement a TRD end-to-end. They run the command, it scaffolds beads, and they follow the execution order to complete tasks sequentially. They benefit from `bv --robot-triage` providing smart prioritization rather than raw dependency order.

### 2.2 AI Agent (Autonomous)
An AI agent executing a TRD implementation autonomously. The agent needs deterministic, machine-readable output from `bv --robot-next` to self-select tasks. Must use `--format toon` for token-optimized output to minimize context usage.

### 2.3 Team Lead (Flywheel Coordinator)
A team lead who scaffolds the TRD into beads, gets the `bv --robot-plan` parallel tracks, and then uses the printed wheel instructions to spawn multiple agents via NTM. They need copy-pasteable commands for the full claim-work-close-sync loop.

---

## 3. Requirements

### 3.1 Replace bd with br (Must Have)

**Description:** Every `bd` CLI invocation in the implement-trd-beads command must be replaced with the equivalent `br` command.

**Mapping:**

| Current (bd)                                          | Target (br)                                          |
|-------------------------------------------------------|------------------------------------------------------|
| `bd create --type epic --title ...`                   | `br create --title="..." --type=epic --priority=2`   |
| `bd create --type feature --title ... --parent ...`   | `br create --title="..." --type=feature --priority=2`|
| `bd create --type task --title ... --parent ...`      | `br create --title="..." --type=task`                |
| `bd update <id> --claim`                              | `br update <id> --status=in_progress`                |
| `bd update <id> --status closed`                      | `br close <id> --reason="Completed"`                 |
| `bd update <id> --status open`                        | `br update <id> --status=open`                       |
| `bd close <id>`                                       | `br close <id>`                                      |
| `bd dep add <id> <depends-on>`                        | `br dep add <id> <depends-on>`                       |
| `bd list --label ... --json`                          | `br list --status=open` (filter by label in output)  |
| `bd ready --parent <id> --type task --json`           | `br ready` (filter by parent post-hoc)               |
| `bd sync`                                             | `br sync --flush-only`                               |
| `bd status`                                           | `br list --status=open` (health check equivalent)    |
| `bd swarm create <id>`                                | Remove (swarm is a bd-specific concept; not in br)   |
| `bd swarm status <id>`                                | Replace with `bv --robot-triage` for status overview |
| `bd comments add <id> 'text'`                         | Remove or replace with br equivalent if available    |

**Acceptance Criteria:**
- Zero occurrences of `bd` in the command YAML after migration
- All scaffold, execute, and quality gate phases function correctly with `br`
- `br sync --flush-only` is called after any batch of bead mutations to export JSONL for bv

**Notes on br differences from bd:**
- `br` does not have `--silent` flag; capture output and discard if needed
- `br` does not have `--external-ref`; use `--title` prefix pattern `[trd:SLUG:task:XXX]` for idempotency lookups via `br list` + grep
- `br` does not have `--parent`; use `br dep add` to create parent-child relationships
- `br` does not have swarm commands; replace swarm status with `bv --robot-triage`
- `br` claim semantics use `--status=in_progress` rather than `--claim`

### 3.2 TRD Task Parser (Must Have)

**Description:** Parse the TRD markdown to extract tasks and create corresponding beads with proper dependencies.

**Input Format:**
```markdown
### Phase 1: Setup
- [ ] **TRD-001**: Initialize project structure [Priority: P1]
- [ ] **TRD-002**: Configure database schema [Depends: TRD-001] [Priority: P1]

### Phase 2: Implementation
- [ ] **TRD-003**: Implement API endpoints [Depends: TRD-002] [Priority: P2]
```

**Parser Output (per task):**
```
{
  "id": "TRD-001",
  "description": "Initialize project structure",
  "phase": 1,
  "phase_title": "Setup",
  "depends_on": [],
  "priority": 1,
  "checked": false
}
```

**Acceptance Criteria:**
- Parser extracts task ID, description, phase, dependencies, and priority
- Dependencies reference other TRD task IDs which are resolved to bead IDs after creation
- Tasks without explicit phase assignment default to Phase 1
- Duplicate task IDs produce a warning and halt scaffold
- Already-checked tasks (`- [x]`) are skipped during scaffold

### 3.3 BV Integration (Must Have)

**Description:** After creating all beads from the TRD and syncing, invoke bv robot commands for graph-aware execution planning.

**Workflow:**

1. After scaffold completes and all beads + dependencies are created:
   ```bash
   br sync --flush-only    # Export beads DB to .beads/beads.jsonl
   ```

2. Get parallel execution tracks:
   ```bash
   bv --robot-plan --format toon
   ```
   This returns dependency-respecting parallel execution tracks showing which tasks can run concurrently.

3. Get scored triage recommendations:
   ```bash
   bv --robot-triage --format toon
   ```
   This returns:
   - `quick_ref`: at-a-glance counts and top 3 picks
   - `recommendations`: ranked actionable items with scores and reasons
   - `quick_wins`: low-effort high-impact items
   - `blockers_to_clear`: items that unblock the most downstream work
   - `project_health`: status/type/priority distributions and graph metrics

4. Present the bv analysis output in the command's completion summary, clearly labeled.

**Acceptance Criteria:**
- `br sync --flush-only` is called before any bv invocation
- Only `--robot-*` flags are used (never bare `bv`)
- `--format toon` is used for token-optimized output in agent context
- bv output is captured and presented in a structured summary section
- If bv is not installed or fails, the command degrades gracefully: print warning and continue with br-only execution order

### 3.4 Wheel Instructions Output (Must Have)

**Description:** After bv analysis, print clear, actionable instructions for initiating the Agentic Coding Flywheel with the triaged tasks.

**Output Template:**

```
================================================================
WHEEL INSTRUCTIONS - Agentic Coding Flywheel
================================================================

PARALLEL EXECUTION TRACKS (from bv --robot-plan):
  Track 1: TRD-001, TRD-004 (no dependencies)
  Track 2: TRD-002, TRD-003 (depends on Track 1)
  Track 3: TRD-005 (depends on Track 2)

RECOMMENDED EXECUTION ORDER (from bv --robot-triage):
  1. TRD-001 (score: 0.95 - unblocks 3 downstream tasks)
  2. TRD-004 (score: 0.82 - quick win, low effort)
  3. TRD-002 (score: 0.78 - high impact)

SPAWN AGENTS WITH NTM:
  # Spawn one agent per parallel track
  ntm new trd-track-1 -- claude code
  ntm new trd-track-2 -- claude code

AGENT SELF-SELECTION LOOP:
  # Each agent runs this loop:
  bv --robot-next --format toon          # Get top priority task
  br update <id> --status=in_progress    # Claim the task
  # ... implement the task ...
  br close <id> --reason="Completed"     # Mark done
  br sync --flush-only                   # Export for bv
  bv --robot-next --format toon          # Get next task

AGENT COORDINATION VIA MAIL:
  # Send status updates between agents
  mail send trd-track-2 "TRD-001 complete, Track 2 unblocked"
  mail check                             # Check for messages

MONITOR PROGRESS:
  bv --robot-triage --format toon        # Full triage refresh
  br list --status=open                  # See remaining work
================================================================
```

**Acceptance Criteria:**
- Wheel instructions are printed after bv analysis in every successful run
- NTM spawn commands are copy-pasteable
- Agent self-selection loop uses `bv --robot-next` (not `br ready`)
- Mail coordination examples reference actual track names
- Instructions degrade gracefully if bv is unavailable (omit bv-dependent sections, show br-only loop)

### 3.5 Backward Compatibility (Must Have)

**Description:** The modified command must maintain its existing interface.

**Requirements:**
- Still accepts a TRD path as the primary argument
- `--status` flag still works for checking implementation progress
- `--reset-task TRD-XXX` flag still works for resetting individual tasks
- `max parallel N` argument still works for controlling concurrency
- Feature branch creation logic unchanged (git-town hack or git switch -c fallback)
- Strategy detection logic unchanged (tdd/characterization/test-after/bug-fix/refactor/flexible)
- Quality gate behavior unchanged per strategy

**Acceptance Criteria:**
- All existing argument patterns produce equivalent behavior with br/bv
- No new required arguments introduced

### 3.6 Idempotent Scaffold with br (Should Have)

**Description:** Since `br` does not have `--external-ref`, the scaffold must use an alternative idempotency mechanism.

**Approach:**
- Use a title-prefix convention: `[trd:SLUG:task:XXX] Task description`
- Before creating a bead, run `br list --status=open` and search for matching title prefix
- If found, reuse the existing bead ID; if not found, create new
- Cache the full `br list` output at scaffold start to avoid per-task queries

**Acceptance Criteria:**
- Running the command twice on the same TRD does not create duplicate beads
- Partial scaffolds (interrupted mid-creation) resume correctly on re-run
- Cache is refreshed once at scaffold start, not per-task

### 3.7 Graceful Degradation (Should Have)

**Description:** The command should handle missing tools gracefully.

**Scenarios:**

| Missing Tool | Behavior |
|-------------|----------|
| `br` not installed | HALT with installation instructions |
| `bv` not installed | WARN, skip bv integration, use `br ready` for execution order, omit bv sections from wheel instructions |
| `git-town` not installed | Fall back to `git switch -c` as current command does |

**Acceptance Criteria:**
- Each tool is checked at preflight
- Clear error messages with installation guidance
- Command completes maximum possible work even with partial tooling

### 3.8 Remove Dolt Dependencies (Could Have)

**Description:** The current command has explicit Dolt health checks (`gt dolt status`). Since `br` uses its own storage backend, evaluate whether Dolt checks are still needed.

**Decision criteria:**
- If `br` uses Dolt internally: keep health checks but update commands
- If `br` uses SQLite/file-based storage: remove Dolt preflight checks entirely

**Acceptance Criteria:**
- No references to Dolt commands if br does not use Dolt
- If Dolt is still required, health check commands are updated to match br's expectations

### 3.9 Remove Swarm Concept (Could Have)

**Description:** The `bd swarm` commands (create, status) do not exist in `br`. Replace swarm-related functionality.

**Replacements:**

| Current (bd swarm) | Replacement |
|---------------------|-------------|
| `bd swarm create <EPIC_ID>` | Remove entirely; not needed with bv |
| `bd swarm status <EPIC_ID>` | `bv --robot-triage --format toon` for status overview |
| Swarm molecule ID tracking | Remove; bv operates on the full graph |

**Acceptance Criteria:**
- No references to swarm commands in the updated YAML
- Status overview functionality preserved through bv --robot-triage

---

## 4. Out of Scope

- Modifying the `implement-trd` or `implement-trd-enhanced` commands (separate effort)
- Updating AGENTS.md (already documents br/bv workflow)
- Implementing NTM or Mail functionality (these are external tools referenced in instructions)
- Changes to bv or br CLI themselves
- Migration of existing beads databases from bd to br format

---

## 5. Technical Constraints

1. **Command format:** YAML at `packages/development/commands/implement-trd-beads.yaml`, generated to markdown via `npm run generate`
2. **Robot flags only:** Never invoke bare `bv` (launches interactive TUI that blocks agent sessions)
3. **Token optimization:** Use `--format toon` for all bv output when in agent context
4. **Sync before bv:** Always run `br sync --flush-only` before any `bv --robot-*` call to ensure JSONL is current
5. **Priority format:** Use numeric priorities (0-4) not words, matching br's interface
6. **No interactive flags:** Never use `-i` flags on any command (blocks in agent context)

---

## 6. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| bd references eliminated | 0 occurrences | Grep for `\bbd\b` in updated YAML |
| Scaffold correctness | 100% tasks created | Compare TRD task count to br list count after scaffold |
| Dependency accuracy | 100% deps wired | Compare TRD dependency declarations to br dep output |
| BV integration | Plan + triage output captured | Verify bv --robot-plan and --robot-triage produce non-empty output |
| Wheel instructions | Printed on every successful run | Verify output contains WHEEL INSTRUCTIONS section |
| Idempotency | No duplicates on re-run | Run command twice, verify bead count unchanged |
| Backward compatibility | All existing args work | Test --status, --reset-task, max parallel, TRD path |

---

## 7. Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| br CLI differences from bd cause scaffold failures | High | Medium | Document all br/bd API differences upfront; test each command mapping |
| bv not available in all environments | Medium | Low | Graceful degradation: warn and fall back to br-only execution |
| Title-prefix idempotency less reliable than external-ref | Medium | Medium | Use structured prefix format `[trd:SLUG:task:XXX]` with exact match |
| Swarm removal loses status overview functionality | Low | Low | bv --robot-triage provides richer status than swarm status |
| br does not support --parent flag for hierarchy | Medium | High | Use br dep add for parent-child relationships; document pattern |

---

## 8. Implementation Phases

### Phase 1: br Migration (Core)
- Replace all bd calls with br equivalents in YAML
- Update preflight health checks (remove Dolt if not needed, add br check)
- Update idempotency mechanism from external-ref to title-prefix
- Remove swarm commands
- Update claim semantics from `--claim` to `--status=in_progress`

### Phase 2: BV Integration
- Add `br sync --flush-only` after scaffold completion
- Add `bv --robot-plan --format toon` invocation
- Add `bv --robot-triage --format toon` invocation
- Capture and present bv output in structured summary
- Add bv availability check in preflight with graceful degradation

### Phase 3: Wheel Instructions
- Design and implement wheel instructions output template
- Include NTM spawn commands based on parallel tracks from bv
- Include agent self-selection loop with `bv --robot-next`
- Include Mail coordination examples
- Include progress monitoring commands

### Phase 4: Testing and Validation
- Test with sample TRD end-to-end
- Validate idempotency (run twice, no duplicates)
- Validate backward compatibility (all existing args)
- Validate graceful degradation (bv missing)
- Regenerate markdown with `npm run generate`

---

## 9. Dependencies

| Dependency | Type | Status |
|------------|------|--------|
| `br` (beads_rust) CLI | Runtime | Available |
| `bv` (beads_viewer) CLI | Runtime | Available |
| `implement-trd-beads.yaml` on feature branch | Source | Exists on `feature/implement-trd-beads` |
| `npm run generate` | Build | Available |
| NTM (Named Tmux Manager) | External reference | Documented only |
| Mail (Agent Mail) | External reference | Documented only |

---

## 10. Open Questions

1. Does `br` support a `--json` output flag for programmatic parsing, or is output parsing needed?
2. Does `br create` return the created bead ID on stdout, and in what format?
3. Is there a `br` equivalent for `bd comments add` to record quality gate results?
4. Should the wheel instructions reference specific NTM session naming conventions?
5. Should the command support a `--no-wheel` flag to suppress wheel instructions for simple single-agent runs?
