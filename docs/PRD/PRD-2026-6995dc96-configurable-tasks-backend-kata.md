---
documentId: PRD-2026-6995dc96
label: prd-configurable-tasks-backend-kata
version: 1.3.0
status: Draft
date: 2026-11-13
scaleDepth: STANDARD
totalRequirements: 18
readinessScore: 4.7
related:
  - docs/PRD/PRD-2026-8d825f54-tool-abstraction-layer.md
  - docs/PRD/PRD-2026-b6939c7c-config-driven-tools.md
  - docs/PRD/PRD-2026-023-multi-trd-beads-workstream.md
  - docs/PRD/PRD-2026-87e64cc6-command-surface-consolidation.md
---

# PRD-2026-6995dc96: Configurable Tasks Backend (Kata Tracker Adapter)

## PRD Health Summary

| Metric | Value |
|--------|-------|
| Risk flags | 4 |
| Cross-requirement dependencies | 27 (see the Dependency Map section) |
| Constitution compliance | passed |
| Open clarifications | 0 `[NEEDS CLARIFICATION]` markers |
| Readiness score | 4.7 |

**Risk-flagged requirements:** REQ-001 (adapter surface is large; an unimplemented capability degrades silently into a fallback rather than erroring), REQ-009 (1,114 occurrences of the beads-specific command name across 248 tracked files, including generated mirrors), REQ-012 (kata is an external binary this repo does not version), REQ-015 (capability coverage now differs between adapters, so an unlisted gap is indistinguishable from an intentional fallback).

## Product Summary

**Problem:** Ensemble's TRD-to-work-items pipeline is coupled to one tasks system. `PRD-2026-8d825f54` established the capability-contract layer and `PRD-2026-b6939c7c` the configuration-driven provider selection, but only one tracker has ever been exercised end to end: dependency-aware TRD execution reaches `br`, `bv`, `.beads/issues.jsonl` and `/ensemble:implement-trd-beads` through prose and command naming, so a team on a different tracker inherits instructions that cannot work.

**Solution:** Ship `kata` as a second first-class tracker adapter — declaring the `tracker` and `work-graph` categories, mapping every capability to a native kata operation, and serving graph-health from an adapter-side scan — selected by one `toolchain.yaml` value. Retire the backend-named command in favour of a backend-neutral command that keeps its flags byte-identically, per the retirement precedent in `PRD-2026-87e64cc6`.

**Value proposition:** The tracker swap that `PRD-2026-8d825f54` made its exit criterion — "demonstrated end-to-end, by config alone" — gets a second proof point that exercises the parts `jira` left on the fallback path: dependency-aware pickup, graph health, external dedupe keys, and reason-plus-evidence closure. Users stop reading `br`/`bv`/`.beads/issues.jsonl` into their prompts, and no TRD, PRD, or skill prose needs a rewrite when the tracker changes.

**Target users:** Ensemble maintainers landing the second backend; teams adopting Kata as system of record; teams staying on Beads who need command names to stop implying a tracker choice.

## User Analysis

| Role | Pain point today | Success metric |
|------|------------------|----------------|
| Team adopting Kata | Must hand-author beads-shaped prompts, or get no dependency-aware pickup because `work-graph` falls back to a links-only analyzer | `tracker: kata` in one file yields working scaffold, ready-list, and plan, with no `br`/`bv` on PATH |
| Team staying on Beads | `implement-trd-beads` in docs and muscle memory; worried a "configurable tracker" change means their flow regresses | Unconfigured projects resolve to beads with zero behavior delta; existing suites green |
| Ensemble maintainer | Two tracker axes to keep honest, and a 248-file command-name surface to migrate without breaking generated artifacts | Generation, validation, and contract-doc checks all green in one PR cycle |
| Agent runtime (pi / omp / codex) | Prompt prose names `br`, `bv`, `.beads/issues.jsonl`, so a non-Beads project gets instructions that cannot work | Command and skill prose reaches the tracker only through `toolchain-cli run <capability>` |

## Requirements by Feature Area

### A. Kata tracker adapter

### REQ-001: A Kata project needs no Ensemble-side behavior change to work its backlog. [Must] [RISK: adapter surface is large; a capability left unimplemented degrades silently into a fallback rather than erroring, so "coverage" must be asserted, not assumed]

The system ships a `kata` tracker adapter that declares both the `tracker` and `work-graph`
categories and implements every required tracker capability plus every optional one whose
contract names a fallback, so that selecting it is a configuration act and nothing else.

- AC-001-1: Given a project whose toolchain configuration names the kata tracker and sets no work-graph override, when the toolchain resolves the `tracker` and `work-graph` categories, then both resolve to the kata adapter and report a config source, not the shipped default.
- AC-001-2: Given the same project, when the toolchain preflight runs, then the kata adapter's health check passes and reports the backing tool's version.
- AC-001-3: Given the same project with the `kata` binary absent from PATH, when preflight runs, then it reports a named missing-binary failure for that adapter instead of proceeding.
- AC-001-4: Given the kata adapter's manifest, when its declared capabilities are compared against the `tracker` and `work-graph` category definitions, then it declares every capability whose contract entry is marked required, and every capability whose contract entry names a fallback.

### REQ-002: Work items a TRD flow creates must carry their identity in Kata's own dedupe mechanism. [Must]

Creating and finding a work item by an external dedupe key works natively in the kata backend,
so TRD re-runs reconcile against existing items instead of duplicating them or skipping the
lookup.

- AC-002-1: Given a work item created through the adapter with a dedupe key, when the same key is looked up again in the same workspace, then the lookup returns that one item and no other.
- AC-002-2: Given a key that matches nothing, when it is looked up, then the result is an empty list and not an error.
- AC-002-3: Given two items carrying different dedupe keys, when one key is looked up, then only the matching item is returned.

### REQ-003: Closing a work item must record why it closed and what proves it. [Must]

Closure through the kata backend records a reason and the resolving commit or command as
evidence, in the backend's own evidence model, so the audit trail survives outside Ensemble.

- AC-003-1: Given an open item, when it is closed through the adapter with a reason and a commit, then the item is closed and reading it back shows the recorded reason.
- AC-003-2: Given a close where the reason is absent, when the adapter is invoked, then the call is refused with an outcome the caller can observe rather than closing the item silently.
- AC-003-3: Given an item closed with a test command as its proof, when the item is read back, then the recorded evidence names that command.

### REQ-004: Labels and lifecycle status must be first-class in the kata backend. [Must]

Labelling and the normalized lifecycle statuses map onto native kata operations, so
label-scoped sweeps and status transitions do not fall back to editing item text.

An in-progress claim lands on the item as Kata's own ownership state: an owned-but-open item *is*
the in-progress representation, so the claim is readable back by a reader who never consulted
Ensemble. Closing remains a distinct state, and dropping a claim returns the item to open and
unowned.

- AC-004-1: Given items whose titles share a prefix, when a label is applied to them by id, then reading each item back shows that label.
- AC-004-2: Given an open unowned item, when status is set to in-progress, then the item reads back as owned and open, and its owner is reported.
- AC-004-3: Given an item, when its status is set to closed through the status capability, then reading it back reports closed.

Clarification (resolved 2026-11-13): the tracker contract's normalized status set includes an
in-progress value, and the backing tool exposes only open/closed on the status field itself.
In-progress is represented by ownership: a claimed item is owned and open. `closed` maps directly;
`pending` and `done` map to open and closed respectively.

### REQ-005: Dependency links must be expressed in the backend's own readiness vocabulary. [Must]

Adding and removing a dependency link maps to the backend's blocking-edge operation, so an item
the TRD flow marks as blocked is actually withheld from the backend's ready list.

- AC-005-1: Given two open items A and B, when a link is added making A blocked by B, then A no longer appears in the backend's ready listing while B remains open.
- AC-005-2: Given that link, when it is removed, then A reappears in the ready listing.
- AC-005-3: Given a link of a kind the backend has no equivalent for, when the adapter is asked to add it, then the call reports refusal with a reason rather than silently creating a blocking edge.

### REQ-006: The fallback paths must not fire in a kata project. [Must]

The contract's degradation paths — skip-findings, title-prefix label scoping, full-export
substitution — are the safety net for backends that lack a capability, not the kata adapter's
normal operation.

- AC-006-1: Given a kata project, when each tracker capability the contract marks optional-with-fallback is invoked, then the result comes from the adapter and the resolved output names the kata adapter as its source.
- AC-006-2: Given a kata project, when the resolved adapter for `work-graph` is reported, then it names the kata adapter rather than the built-in links analyzer.

### B. Dependency-aware execution on Kata

### REQ-007: Picking up the next item on a Kata project must use the backend's dependency graph. [Must]

Ready-work listing, sequential planning order, and graph-health triage come from the resolved
tracker's own graph rather than a links-only approximation, so dependency-aware execution
survives the tracker swap.

Graph-health is computed by the adapter from the item links it already exports: a local cycle and
stale-blocker scan over the same edges the ready-listing reads. No backing-tool command provides
it, and the contract's links-only fallback implements ready-listing and planning only, so omitting
the computation would leave the capability with no source at all.

- AC-007-1: Given a kata project where item C is blocked by item B and item B is open, when ready-work is listed through the `work-graph` capability, then C is absent, the unblocked items are returned in the backing tracker's own listing order, and two consecutive listings of an unchanged item set return the identical sequence.
- AC-007-2: Given a set of open items with dependency links, when a sequential plan is requested, then every item appears after all items it depends on.
- AC-007-3: Given a dependency cycle introduced into the item set, when graph-health is requested, then the cycle is reported as a finding rather than the plan silently ordering the cycle anyway.
- AC-007-4: Given a kata project, when a plan is produced, then the reported ordering source names the kata adapter and the result reports itself dependency-aware.
- AC-007-5: Given a dependency link naming an item id that the tracker's scope never returns, when graph-health is requested, then that dangling edge is reported as a finding.

### REQ-008: An item that leaves the ready set must remain reachable for triage. [Should]

Listing, single-item read, and comment history are available through the contract, so a
supervisor or reviewer can inspect blocked or closed work without leaving the capability layer.

- AC-008-1: Given a kata project with open and closed items, when items are listed with an open filter, then closed items are excluded, and the filter is honored rather than ignored.
- AC-008-2: Given one item, when it is read by id, then its title, description, type, status, priority and labels are all populated in the normalized shape.
- AC-008-3: Given an item with two comments added in a known order, when its comments are listed, then both appear in that order.

### C. Command surface

### REQ-009: The command that turns a TRD into work items must not name a backend. [Must] [RISK: 1,114 occurrences of the current name across 248 tracked files, including generated command and skill mirrors]

The TRD-to-work-items flow is reached by a backend-neutral name, and the beads-named command is
removed outright — no alias, no hidden entry, no compatibility window — following the retirement
precedent set when the TRD and requirement-analysis variants were folded into their base
commands.

- AC-009-1: Given a kata project, when the backend-neutral TRD-implementation command is invoked on a TRD, then work items are scaffolded in kata and the run never invokes a beads-specific tool.
- AC-009-2: Given the shipped command, agent and skill inventories, when `implement-trd-beads` is searched for, then no entry with that name remains in any source manifest or generated artifact.
- AC-009-3: Given a user who invokes `implement-trd-beads`, when the dispatcher resolves it, then the outcome is an unrecognized-command message that names the replacement, not a silent fallthrough to an unrelated command.
- AC-009-4: Given the TRD dispatcher command, when its `implement` keyword is dispatched, then it routes to the backend-neutral command and no longer states that beads project management is being used.

### REQ-010: Existing command's phases and accepted arguments must survive the rename. [Must]

Renaming the surface changes what it is called, not what it does: every argument the beads-named
command accepts today remains accepted by the backend-neutral command with the same meaning.

- AC-010-1: Given each phase the beads-named command supports today — plan-only execution, unattended execution, branch selection, status reporting, single-task reset, backlog listing, workstream generation, and delegation to an external runner — when it is exercised on the backend-neutral command, then it is accepted and reaches the same handling.
- AC-010-2: Given the same TRD and the same arguments on a beads project, when the flow is run before and after this change, then both runs produce the same work-item titles, dependency edges and phase grouping.
- AC-010-3: Given a plan-only invocation, when it completes, then the completion message names the backend-neutral command for the execute step.

### REQ-011: Work-item vocabulary in shared prose must stop being beads-shaped. [Must]

Where command, skill and contract prose names a tracker's storage format, its binaries, or its
subcommands, that prose reaches the tracker through the capability layer, so one rewrite serves
both backends.

- AC-011-1: Given the shared TRD-implementation command and skill prose, when it is searched for a named tracker binary or a tracker-specific storage path, then none is found outside text that is explicitly scoped to describing one backend.
- AC-011-2: Given a kata project and a beads project, when the same prose instructs the agent to create, link, and close a work item, then each instruction is expressed as a capability call that resolves differently per project and identically in text.
- AC-011-3: Given a beads project, when the flow runs after this prose change, then beads behavior is unchanged from today.

### D. Coexistence, defaults, and prerequisites

### REQ-012: Kata must be an optional dependency, never an installation requirement. [Must] [RISK: kata is an external binary this repo does not version; adapter health, detection and tests must all tolerate its absence]

Installing Ensemble must not start requiring the kata tool, and every check that assumes it must
be able to report absence without failing installation, generation, or the rest of the suite.

- AC-012-1: Given a machine with the kata tool absent, when the package is installed and its test suite is run, then installation succeeds and the suite reports skips naming the missing tool rather than failures.
- AC-012-2: Given a machine with the kata tool absent, when toolchain preflight runs for a project that has not selected kata, then no kata-related failure is reported.
- AC-012-3: Given a kata project whose tool disappears after selection, when preflight runs, then it fails with the missing-binary diagnosis from REQ-001 rather than falling back to beads.

### REQ-013: Beads must remain the default, and beads projects must not be auto-routed to Kata. [Must]

Unconfigured behavior stays as shipped today, and the new backend is never selected by
inference from repo contents.

- AC-013-1: Given a project with no toolchain configuration, when the tracker resolves, then it resolves to beads from the shipped default and the beads workspace directory is the working tracker.
- AC-013-2: Given a repository containing a Kata workspace binding file but no toolchain configuration, when the tracker resolves, then it resolves to beads and records no detection-derived kata choice.
- AC-013-3: Given a kata project, when its toolchain configuration is deleted, then the tracker resolves back to beads without further edits.
- AC-013-4: Given the shipped default configuration, when it is read, then the tracker value is beads and the work-graph value is unchanged from today.

### REQ-014: Running the TRD flow on a Kata project must be a supported, documented starting point. [Should]

A team adopting kata needs one short path from "tracker: kata" to a scaffolded backlog, with the
prerequisite stated where the command is documented.

- AC-014-1: Given the command's documentation, when a reader looks for what must be true before running it on a kata project, then the prerequisites are stated there, including what binds the workspace to a kata project.
- AC-014-2: Given a fresh kata project, when a reader follows only the documented steps, then the flow scaffolds work items in kata.
- AC-014-3: Given a kata project that is not yet bound, when the flow is invoked, then it stops with the documented prerequisite message rather than scaffolding into the wrong project.

### REQ-015: The two backends must be comparable from one place. [Should] [RISK: capability coverage now differs between adapters, and an unlisted gap is indistinguishable from an intentional fallback]

The tracker contract documentation states which capabilities each shipped backend implements and
which are reached by fallback, so a reader can tell a deliberate gap from an omission.

- AC-015-1: Given the generated tracker contract documentation, when it is read, then it names the shipped backends and, per backend, which capabilities are native and which are reached by fallback.
- AC-015-2: Given the kata adapter as the last capability is added, when its coverage is compared to the contract's required set, then no required capability is missing.
- AC-015-3: Given a capability whose native-versus-fallback status has changed in an adapter but has not yet been recorded in the coverage documentation, when a reader consults that documentation, then the discrepancy is discoverable there rather than the documentation stating the superseded status as though it were current.

### E. Non-functional requirements

### REQ-016: The skip guarantee must cover every kata-dependent check, not only the suite that ships with the adapter. [Must]

REQ-012 guarantees that installation and the adapter's own suite tolerate the tool's absence.
This extends that guarantee to checks added elsewhere in the repo as the effort grows, and to
proving that the skips are honest rather than silently vacuous.

- AC-016-1: Given a runner with the backing tool absent, when the repo-wide test run is executed, then it exits successfully and names each skipped check with the reason "tool absent".
- AC-016-2: Given a CI job matrix that does not install the backing tool, when the job runs, then it passes and reports a nonzero skip count for the kata-dependent checks.
- AC-016-3: Given the skip list, when it is compared to the set of tests that touch kata, then no test that asserts kata behavior is reported as passing on a runner where the tool is absent.

### REQ-017: Adapter calls must fail within a bounded, observable time. [Should]

A backing tool that hangs, exits nonzero, or writes unparseable output must produce a named
adapter error within a bounded time, so a hung external binary cannot stall a TRD flow.

The bound is per capability, not one global figure: read-only capabilities (listing, single-item
read, comment listing) are held to the short bound, and capabilities that write to the tracker or
traverse an entire backlog to the longer one. A single global bound would either trip on
legitimate scaffold runs or fail to notice a hung read. The PRD fixes the shape of the bound —
which capability class is held to which bound, that the bound in force is always reported, and
that both are configurable per project — and leaves the seconds to the TRD, since the right number
depends on measured backing-tool latency.

Clarification (resolved 2026-11-13): no numeric bound is stated here by design. The
requirement-level commitment is that a bound exists per capability class, is configurable, and is
named in every timeout outcome; the values are a TRD sizing decision.

- AC-017-1: Given a backing tool that never exits, when a capability is invoked through the adapter, then the call returns a timeout error naming the capability, the capability's bound class, and the bound that was in force, rather than blocking indefinitely.
- AC-017-2: Given a backing tool that exits nonzero with a message on stderr, when a capability is invoked, then the adapter reports a failure that carries that message through to the caller.
- AC-017-3: Given a backing tool that writes output the adapter cannot parse, when a capability is invoked, then the adapter reports a parse failure rather than returning an empty or partial result as though it succeeded.

### REQ-018: Selecting the new backend in a workspace it cannot serve must be caught before any work item is written. [Must]

Misconfiguration that REQ-001 and REQ-012 do not already cover — a workspace that is not bound, a
tool version too old for a required operation — is caught during preflight, before the flow
creates, edits, or closes anything.

- AC-018-1: Given a kata project whose workspace is not bound, when the TRD flow is invoked, then it stops during preflight and the project contains zero newly created work items.
- AC-018-2: Given a backing tool older than the version the adapter requires, when preflight runs, then it names the minimum version and makes no call that the old version cannot serve.
- AC-018-3: Given a preflight that passes, when the flow runs to completion, then every capability it needed was reported available by that preflight.

## Goals and Non-Goals

**Goals**

- A project selects its tasks backend by editing one configuration value, and the TRD-to-work-items flow works end to end on that backend with no beads tool installed. *(REQ-001, REQ-009, REQ-014)*
- Dependency-aware pickup, sequential planning, and graph-health triage work on the new backend, not only on the backend that shipped with the machinery. *(REQ-007)*
- No command, skill or agent name states which tasks backend it uses. *(REQ-009, REQ-011)*
- A project that never hears about the new backend sees zero behavior change. *(REQ-013)*
- The capability coverage of both backends is stated where a reader would look for it, and provably complete against the contract. *(REQ-015)*

**Non-Goals**

- **Making the new backend the default, or migrating anyone onto it.** Selection stays explicit; unconfigured projects keep today's tracker. *(REQ-013)*
- **A migration tool from Beads to Kata.** Importing an existing `.beads/issues.jsonl` into a kata project, and the reverse, are out of scope; teams start a fresh backlog or keep beads.
- **Third or fourth backends.** Exactly two backends ship. The `jira` adapter stays as authored: it deliberately implements the tracker contract only and lets `work-graph` take the built-in analyzer. Nothing here pulls it onto the graph path.
- **Changing what a TRD contains, or how it is authored.** `create-trd` already reaches no tracker: it writes the TRD document. Requirement coverage, task format, shippable-state and design-readiness rules are unchanged.
- **A compatibility window or deprecation period for the retired command name.** Per the retirement precedent, removal is outright. *(REQ-009)*
- **Scheduling, dispatch, retries, or recovery in Kata.** Owning the work-item record is the whole claim; running agents against it stays outside Ensemble.
- **Backfilling historical PRD and TRD documents.** Archived documents keep their original wording, including the retired command name where they used it.

## Relationship to Existing PRDs

Ratified in this run: this PRD **extends** the toolchain line of work rather than superseding
it. The three documents below carry amendment notes at their next edit; none is reopened.

| Document | Standing | Relationship |
|---|---|---|
| `PRD-2026-8d825f54-tool-abstraction-layer` | **Locked**, 2026-10-21 | Parent. Its exit criterion is that the tracker swap "is demonstrated end-to-end, by configuration alone", and REQ-020 already overrides the sole-execution-layer claim below. Kata is the second demonstration; it is the first that exercises the `work-graph` capabilities natively, which `jira` left on the built-in fallback. |
| `PRD-2026-b6939c7c-config-driven-tools` | Draft, 2026-08-13 | Partially superseded, before this PRD. REQ-015 ("Beads remains the sole execution layer") and the non-goal "Migrating Beads off execution layer" were already overridden by 8d825f54 REQ-020. This PRD inherits that override and adds nothing new against it. Its Layer 1 and Layer 3 work — project-local configuration, provider-neutral prose, CI enforcement — is the foundation this PRD builds on, and its CI enforcement (no hardcoded backend references in prompts and skills) is treated as a check to satisfy, not a rule to re-litigate. |
| `PRD-2026-023-multi-trd-beads-workstream` | 2026-06-16 | Non-goal conflict, resolved by scoping. Its non-goal "replacing Beads with another task graph system" is not contradicted: beads is not replaced, and stays default. Its multi-TRD workstream behavior is stated in beads terms; whatever of it must survive on kata is carried here as REQ-007 and REQ-008 rather than reopened there. |
| `PRD-2026-87e64cc6-command-surface-consolidation` | 2026-10-06 | Precedent, followed. Its 2026-10-18 amendment retired variant commands by folding them into base-command flags and deleting the aliases outright, with no compatibility window (REQ-008 there). REQ-009 here applies the same retirement to the last backend-named TRD command. |

**Terminology.** The user-facing request says "tasks backend"; the repository's toolchain axis is
named `tracker` (category `tracker`, contract `tracker.md`, `tracker.*` capabilities), with
`work-graph` as the dependency-graph category. This PRD keeps `tracker` as the technical name and
treats "tasks backend" as the product-level phrase for a resolved tracker adapter.

## Approvals and Decision Ownership

| Decision | Approving role | Criteria judged against |
|---|---|---|
| Adding a second tasks backend, and the adapter shape it takes | Architecture owner | `PRD-2026-8d825f54`'s locked contract; the constitution's approval requirement for architecture changes. Recorded as ratified in this run: extend, do not supersede. |
| Removing a shipped command name outright | Command-surface owner | `PRD-2026-87e64cc6` REQ-008's no-compatibility-window precedent, ratified in this run. |
| Keeping beads as the shipped default | Product owner | REQ-013; zero delta for unconfigured projects. |
| Scope of native capability coverage in the new adapter | Architecture owner | REQ-001 AC-001-4 and REQ-015 AC-015-2: the required set plus every capability the contract marks with a fallback. Ratified in this run as tracker-plus-graph, not tracker-only. |
| Whether the kata tool becomes a package dependency | Package owner | REQ-012; installation must not require it. |
| Scoping the kata integration to locally-spawned kata daemons, leaving the remote kata gateway path undelivered and untested | Architecture owner | Decided 2026-11-14, recorded in `TRD-2026-6995dc96`. Two live gateway probe responses have no local analogue: sending no token gives `origin_forbidden`, sending a token that is not a valid browser session gives `web_session_required` — both `kind: internal` with `exit_code: 1`, both outside the 2/3/4/5/7 exit-code taxonomy this integration's error mapping assumes. The gateway also checks an `Origin` header the CLI controls, so an adapter cannot compensate by setting headers itself, which makes `KATA_AUTH_TOKEN` a hard prerequisite for remote use rather than an optional enhancement. Nothing below obliges anyone to reach or authenticate against a gateway. If gateway-backed delivery is wanted later, a requirement must be added covering remote-gateway authentication and its failure envelope: the 18 requirements here stop at "a Kata project" while the adapter manifest's `env` block already names `KATA_SERVER` and `KATA_AUTH_TOKEN`. |

The accountable counterpart for the customer-facing approve/request-changes step is the same
architecture owner who signs the adapter shape: no requirement here is approved by its author.

## Technical Constraints and Dependencies

**Constraints**

- **The backing tool must be at version v0.23.0 or later.** This PRD sets that floor; it is a
  requirement, not an observation about the tool — nothing in this repository versions it, so the
  statement belongs here rather than in a lockfile. It is the referent for REQ-018 AC-018-2: a tool
  below the floor is a named preflight failure, not a degraded run. The first implementation that
  exercises the mapped operations against v0.23.0 confirms the floor holds; if it does not, this
  constraint is wrong and is corrected by reopening this PRD, not by patching the adapter to
  compensate. *(REQ-012, REQ-018)*
- The tool stays an optional dependency: no constraint here may make its absence fail
  installation, generation, or a test run. *(REQ-012, REQ-016)*
- Adapter coverage is asserted against the versioned contract documents —
  `docs/toolchain/contracts/tracker.md` (contract version `1.1` as amended 2026-11-14, previously
  `1.0`) and `docs/toolchain/contracts/work-graph.md` (contract version `2.0`) — so "the required
  set" in REQ-001 AC-001-4 and REQ-015 AC-015-2 has a dated referent rather than a moving one. A
  bump of either contract version is a requirements change to this PRD, not an implementation detail.
- Beads remains the shipped default; nothing here licenses selecting the new backend by inference.
  *(REQ-013)*
- **Delivery is against locally-spawned kata daemons.** This effort configures, exercises and tests
  the adapter against a kata daemon started on the same machine as the flow that calls it; operation
  against a remote kata gateway is not delivered and not tested here. *(REQ-001, REQ-012, REQ-018)*

**Declared dependencies on other documents**

| Document | Role here | Enforced by |
|---|---|---|
| `PRD-2026-8d825f54-tool-abstraction-layer` (Locked) | Parent contract; its capability definitions and exit criterion are what this PRD satisfies | REQ-001 AC-001-4, REQ-015 AC-015-2 |
| `docs/toolchain/contracts/tracker.md` (contract version `1.1`, amended 2026-11-14), `work-graph.md` (contract version `2.0`) | The required-plus-fallback-bearing capability set | REQ-001 AC-001-4, REQ-015 AC-015-1 |
| `PRD-2026-b6939c7c-config-driven-tools` | Foundation: project-local configuration, provider-neutral prose, CI enforcement of no hardcoded backend references | REQ-011 |
| `PRD-2026-87e64cc6-command-surface-consolidation` | Retirement precedent — outright removal, no compatibility window | REQ-009 |
| `PRD-2026-023-multi-trd-beads-workstream` | Behavior carried forward in beads terms, re-expressed here rather than reopened there | REQ-007, REQ-008 |
| Backing tool at v0.23.0+ (external, unversioned by this repo) | The operations the adapter maps onto | REQ-001, REQ-012, REQ-018 |

## Entry Criteria

Before implementation starts:

1. The `kata` tool is available on the implementation machine, and a scratch kata project exists that a test harness can create and discard without touching a real project. *(prerequisite for REQ-001 through REQ-008; REQ-012 makes its absence a skip, not a blocker to the rest)*
2. The capability inventory in `docs/toolchain/contracts/tracker.md` and `work-graph.md` is confirmed current, since REQ-001 AC-001-4 and REQ-015 AC-015-2 assert against it.
3. The list of commands, agents and skills naming the beads-specific command is enumerated, so REQ-009's "no entry remains" is checkable rather than impressionistic.
4. Generation and validation entry points (`generate`, `validate`, the contract-docs check) are confirmed runnable locally, since REQ-009 and REQ-015 are asserted through generated artifacts.
5. A beads project fixture exists that exercises the TRD flow end to end, so REQ-010 AC-010-2 and REQ-011 AC-011-3 can be compared against before-and-after output rather than asserted from reading.

## Exit Criteria

Effort is delivered when all of the following are observable:

1. Setting one configuration value in a project with no beads tool installed produces a scaffolded kata backlog with dependency edges, a ready list, and a sequential plan, from the backend-neutral command. *(REQ-001, REQ-007, REQ-009, REQ-014)*
2. A capability-coverage assertion passes for the kata adapter against the full required-plus-fallback-bearing set in both contracts, and fails when a capability is removed from the manifest. *(REQ-001 AC-001-4, REQ-015 AC-015-2)*
3. No source manifest or generated artifact names the retired command; the dispatcher rejects the retired name and names the replacement. *(REQ-009)*
4. The backend-neutral command accepts every phase the retired command supported, and a beads project produces byte-identical work items before and after. *(REQ-010)*
5. A project with no toolchain configuration resolves to beads, the shipped default configuration file is unchanged, and no tracker detection route selects the new backend from repository contents — a repository carrying a Kata workspace binding file with no toolchain configuration still resolves to beads. *(REQ-013)*
6. Installing the package and running its test suite on a machine without the kata tool both succeed, with kata-dependent checks reported as named skips. *(REQ-012, REQ-016)*
7. Shared command, skill and contract prose contains no tracker binary or tracker storage path outside explicitly beads-scoped sections, and the beads-scoped flow is unchanged by the prose edit. *(REQ-011)*
8. Generated contract documentation lists both backends with the native-versus-fallback split, and the docs check fails on an unrecorded manifest change. *(REQ-015)*
9. A misconfigured kata workspace stops in preflight having created zero work items, and a backing tool that hangs, fails, or emits unparseable output produces a named adapter error rather than a silent empty result. *(REQ-017, REQ-018)*

## Dependency Map

| Requirement | Depends on | Reason |
|---|---|---|
| REQ-002, REQ-003, REQ-004, REQ-005 | REQ-001 | Each is a slice of one manifest; none is reachable until the adapter resolves |
| REQ-006 | REQ-001, REQ-002, REQ-003, REQ-004, REQ-005 | Fallback suppression is only observable once the capabilities the fallbacks stand in for exist |
| REQ-007 | REQ-001, REQ-005 | Graph output is meaningless unless links land on real blocking edges |
| REQ-008 | REQ-001 | Read paths ride the same manifest |
| REQ-009 | REQ-001 | Retiring the backend-named name only makes sense once a second backend resolves |
| REQ-010 | REQ-009 | Rename-and-preserve-flags is one edit; the flag set is measured from the pre-rename command |
| REQ-011 | REQ-009, REQ-010 | Prose rewrite targets the neutral surface |
| REQ-012 | REQ-001 | Absence handling is a property of the adapter's health and detection |
| REQ-013 | REQ-001, REQ-012 | Detection-never-auto-selects matters only because a detectable candidate now exists |
| REQ-014 | REQ-009, REQ-010 | Documentation describes the surviving command |
| REQ-015 | REQ-001, REQ-006, REQ-007 | Coverage documentation records native versus fallback, which earlier requirements establish |
| REQ-016 | REQ-001, REQ-012 | Skip-on-absence is only meaningful once there is a kata-dependent check to skip |
| REQ-017 | REQ-001 | Timeouts and error passthrough are adapter behaviors, reachable only through its invocation layer |
| REQ-018 | REQ-001, REQ-014, REQ-017 | Preflight gating reuses the adapter's health detection and the documented binding prerequisite |

**Delivery waves**

Shipped in this order. Wave 1 is the critical path; nothing downstream is observable until it closes.

| Wave | Scope | Requirements | Cannot start until | Wave closes when |
|---|---|---|---|---|
| 1 | Adapter manifest and mapping — one package, one manifest, one mapping table | REQ-001 → REQ-002, REQ-003, REQ-004, REQ-005 → REQ-006 | Entry criteria 1-2 met | Exit criterion 2 passes: coverage assertion green, and red when a capability is removed |
| 2 | Graph capabilities — same package, separate capability group | REQ-007, REQ-008 | Wave 1: links land on real blocking edges | Ready list, sequential plan and graph-health all report the kata adapter as their source |
| 3 | Surface rename and prose neutralization | REQ-009 → REQ-010 → REQ-011 → REQ-014 | Wave 1 in code **no** dependency; ships after it because REQ-009's premise is that a second backend resolves | Exit criteria 3, 4 and 7 hold; beads project output byte-identical |
| 4 | Safety and disclosure | REQ-012, REQ-013 after wave 1; REQ-015 last | Waves 1-3 for REQ-015, which records what they established | Exit criteria 5 and 8 hold |
| 5 | Robustness | REQ-017, REQ-018 after wave 1; REQ-016 once a kata-dependent test exists | Wave 1 for REQ-017/018; first kata-dependent test for REQ-016 | Exit criterion 9 holds |

Wave 3 is the only wave with no code dependency on wave 1, so it can be built in parallel and held
for ship order. REQ-015 is deliberately last in wave 4: coverage documentation records the
native-versus-fallback split that waves 1-3 establish, so writing it earlier would document a set
that is still moving. REQ-016 is the only wave-5 item gated on an artifact rather than a wave,
because a skip guarantee has nothing to skip until a kata-dependent check exists.

## Readiness Scorecard

| Dimension | Score | Note |
|---|---|---|
| Completeness | 4.8 | 18 requirements across five feature areas, including an explicit non-functional set; every Must has a happy-path and an edge-case AC; a stated external version floor and declared document dependencies now sit alongside the entry criteria |
| Testability | 4.8 | ACs are observable reads of resolved configuration, item state, or generated artifacts; the ready-list ordering and the timeout bound are now checkable properties rather than adjectives, and the Should-tier AC bar is an explicit recorded rule rather than an implied one |
| Clarity | 4.7 | Terminology reconciled explicitly; delivery sequence states what can be built in parallel and what each wave must show; the requirement/tool boundary is respected — the PRD states the shape of a bound and leaves values to sizing |
| Feasibility | 4.6 | Contract machinery exists and a second adapter already ships against it; graph-health has a named implementation (adapter-side scan); the external tool's version floor is now pinned, so the preflight gate has a referent |
| **Overall** | **4.7** | Above 4.0 Development Ready threshold |

## Notes

- Constitution compliance: **passed**. Article 3 (tests accompany features) is met by per-requirement ACs plus an Exit-criterion assertion-coverage check that can fail; Articles 4 and 8 by keeping selection in configuration and adapter manifests rather than in code; Article 6 by AC-009-1, AC-014-2 and Exit criterion 1, which run the flow through the shipped command rather than around it; Article 7 by AC-001-4 and Exit criterion 2, which require a guard shown capable of failing. AC-015-3 was also cited for Article 7 through v1.1.0; it is now stated as reader-observable drift discovery rather than as a check that demonstrably fails, so Article 7 no longer rests on it. The mechanism that makes a stale coverage record discoverable is a TRD-level choice, and the TRD SHOULD satisfy it with a guard that can be shown failing rather than a documentation note.
- Ambiguity scan: **0 markers**. Both former `[NEEDS CLARIFICATION]` markers were resolved in the 2026-11-13 refinement pass: in-progress is represented by Kata item ownership (REQ-004), and graph-health is computed by the adapter as a local cycle and dangling-edge scan over the exported item links (REQ-007), since no backing-tool command provides it and the contract's links-only fallback implements ready-listing and planning only.
- Acceptance-criteria bar, stated explicitly: **Must** requirements carry 2+ ACs including an edge case; **Should** requirements carry 1+ AC, and the tier is not held to the edge-case rule. This is a recorded decision, not an omission — the Should-tier requirements (REQ-008, REQ-014, REQ-015, REQ-017) were reviewed against the Must-tier bar in the 2026-11-13 v1.2.0 pass and left at their existing coverage deliberately.
- Decisions genuinely the user's — relationship to existing PRDs, the fate and shape of the beads-named command, whether beads stays selectable, how deep the adapter's capability coverage goes, and the two marker resolutions above — were taken in an explicit decision pass and recorded in *Relationship to Existing PRDs* and *Approvals and Decision Ownership*.
- Lock history: **Locked** on 2026-11-13 at v1.1.0, confirmed by the human at that refinement's close-out, on the record that readiness sat at 4.6 with zero open questions at that pass. **Reopened to Draft** the same day at v1.2.0: that pass added a delivery sequence, a version floor, and a constraints section, and rewrote three ACs — a requirements change by the lock's own definition. **Nothing was invalidated by the reopen:** `TRD-2026-6995dc96` does reference this PRD by id and label, but it was created from v1.2.0 after the reopen rather than refined against v1.1.0, and no beads issue or any other artifact in this repository referenced this PRD at an earlier version — so v1.2.0 remains the first version anything downstream was built from. The re-creation rule is therefore prospective — any TRD built from this document must be created from v1.2.0, and never refined against a superseded version. Approving roles for the individual decisions are in *Approvals and Decision Ownership*. A later requirements change reopens this document again and forces the same rule. As of 2026-11-14 one open question is carried forward — whether a future gateway-backed delivery adds its own requirement covering remote-gateway authentication — recorded in *Approvals and Decision Ownership* and in `TRD-2026-6995dc96`.
- Scope decision recorded 2026-11-14 (architecture owner, no version bump): the delivered kata
  integration is scoped to locally-spawned kata daemons; the remote kata gateway path is out of scope
  for this effort, undelivered and untested. The rationale, the two probe refusals behind it, and the
  open question it leaves for a future gateway-backed delivery are recorded in *Approvals and Decision
  Ownership* and in `TRD-2026-6995dc96`. This is a scope clarification plus a correction to the lock
  note above — no requirement or acceptance criterion changed — so `version` stays at 1.2.0 rather
  than signalling that TRDs must be re-created.

## Changelog

### v1.3.0 — 2026-11-14

Amendment recording the `tracker` contract bump that `TRD-2026-6995dc96` deferred to this PRD. Readiness 4.7 unchanged; requirements unchanged at 18; ACs unchanged at 58; ambiguity markers remain 0. **`status` stays `Draft`** — this document was already `Draft` after the v1.2.0 reopen, so recording a contract change here is not a lock transition.

- **The rule this enacts.** *Technical Constraints* states that a bump of either contract version "is a requirements change to this PRD, not an implementation detail," and *Open Question 12* records the labels decision as adding `tracker.label-one` to tracker contract **1.1** while deferring the bump itself: "Both bumps become a single PRD amendment owned by the architecture owner; this TRD does not bump either contract number on its own authority." This is that amendment, applied on the architecture owner's instruction.
- **What landed.** `packages/development/toolchain/categories/tracker.yaml` gains optional `tracker.label-one` (`inputs: [id, label]`, `outputs: [id, labels]`, `addedInMinor: 1`) and moves `1.0` → `1.1`. The *Technical Constraints* bullet and the *Dependency Map* row naming `docs/toolchain/contracts/tracker.md` now cite contract version `1.1`, keeping AC-001-4 and AC-015-1 pointed at a referent that matches the shipped contract rather than a superseded one.
- **Why a minor bump, and why it breaks nothing.** Adding an optional capability is additive, which `lib/toolchain/contracts.js#checkAdditiveOnly` permits within a major version; a major bump would be required only for a removal, a `required` flip, or a required addition. Compatibility is major-only, so the shipped beads adapter stays conformant at its unchanged `contract: tracker: "1.0"` pin, and `addedInMinor: 1` puts `tracker.label-one` in `checkCompat`'s `unavailableCapabilities` for it — beads cannot declare a capability it cannot honour.
- **Scope of the bump.** `tracker` only. The `work-graph` `2.0` → `2.1` bump the design also anticipates is **not** taken here: its motivation is additive *output* fields — `findings` on `work-graph.plan` and `dependencyAware` on `work-graph.graph-health`, per option C and the *Target Files* row "Work-graph contract amendment (AMENDED, additive)", to satisfy REQ-007 AC-007-3 and AC-007-4 — and those fields are produced by the shared analyzer work in TRD-016 and TRD-011, not by this change. `work-graph` therefore stays at `2.0` and this PRD's referent for it is unchanged.
- **Downstream consequence, discharged rather than noted.** The rule attached to *Lock history* says a requirements change here obliges `TRD-2026-6995dc96` to be re-created or explicitly re-confirmed. **Re-confirmed rather than re-created**, on the narrow ground that the only requirement touched is a referent version, not a behaviour: requirements, ACs, and the readiness gate are untouched, and the TRD's `tracker.label-one` design (TRD-012, TRD-033) anticipated exactly this contract shape. What must now change downstream is narrower and is recorded in the TRD, not here: statements asserting the shipped contract is still `1.0` and the amendment is pending are now false.
- **Citation-safety convention respected.** This entry cites constraints, dependency rows and Open Questions by quoted anchor. The PRD was previously edited using `PRD line NNN` citations in `TRD-2026-6995dc96`, which silently broke eight of them; this pass introduces none, and the two regions edited above the changelog are above the TRD's remaining PRD-line citation, so no anchor could drift.

### v1.2.0 — 2026-11-13

Refinement pass (`/ensemble:refine-prd`). Readiness 4.6 → 4.7. Requirements unchanged at 18; ACs unchanged at 58; ambiguity markers 0 → 0. **Status reopened `Locked` → `Draft`.**

**On the version:** the skill's default for a refine pass is a patch bump, which v1.1.0 followed for two resolved markers and a new NFR cluster. v1.2.0 deviates deliberately and the deviation is justified by its own criterion — the bump is meant to signal "a requirements change, so TRDs must be re-created" — and this pass added a section, a delivery sequence, an external version floor, and rewrote three ACs. Nothing derived from v1.1.0, so nothing downstream is invalidated and the minor bump costs nothing. (`TRD-2026-6995dc96` does now reference this PRD by id and label, but it was authored from v1.2.0, so it is not a stale derivation; at the time of the v1.2.0 bump nothing in the repo referenced this PRD at all.)

- **Reopened from Locked.** The pass added a delivery sequence, an external version floor, and a constraints section, and rewrote three ACs. Under the lock's own definition that is a requirements change, so `status` moved to `Draft` rather than being quietly edited under a lock. Verified consequence *at the time of reopening*: nothing to invalidate — no TRD, beads issue, or other artifact in the repo referenced this PRD, so the re-creation rule bound only going forward. That condition no longer holds: `TRD-2026-6995dc96` was created from v1.2.0 and cites this document by id and label, so a future requirements change here obliges that TRD to be re-created or explicitly re-confirmed.
- **New section — Technical Constraints and Dependencies.** Previously absent: the PRD asserted a version gate (REQ-018 AC-018-2 "older than the version the adapter requires") with no version stated anywhere, and named its sibling PRDs only in frontmatter. Now sets the backing-tool floor at **v0.23.0+** as the AC-018-2 referent — stated as a requirement this PRD imposes and the first implementation confirms, since nothing in the repo versions the tool — names the contract referents (`tracker.md` at contract version `1.0`, `work-graph.md` at `2.0`) so "the required set" is dated rather than moving, and carries a table of the five declared document/external dependencies with the requirement that enforces each.
- **Implementation clusters → delivery waves.** The five clusters were prose with no stated order. Now a numbered table: scope, requirements, start precondition, and the observable condition that closes each wave. Records that wave 3 (rename and prose) has **no code dependency** on wave 1 and can be built in parallel, that REQ-015 is deliberately last because it documents what waves 1-3 establish, and that REQ-016 is gated on an artifact existing rather than on a wave completing.
- **AC-007-1 anchored:** "present in a stable, defined order" named no ordering key, so two readers could not agree it passed. Now states the backing tracker's own listing order, and expresses stability observably — two consecutive listings of an unchanged item set return the identical sequence.
- **REQ-017 bound given a shape:** the requirement promised a "bounded" time and AC-017-1 required the error to name "the elapsed bound", but no bound or owner existed. Now states the bound is **per capability class** (read-only vs. tracker-writing/backlog-traversing), configurable per project, and always reported — with the seconds left to the TRD, since the right number depends on measured backing-tool latency. AC-017-1 asserts the capability, its bound class, and the bound in force. A Clarification note records that omitting the number is deliberate.
- **AC-015-3 de-technicalized:** it previously asserted behavior of "the documentation check that regenerates contract docs" — a tooling reference at PRD level, against the Non-Goals technology-claim rule. Restated as reader-observable: an unrecorded native-versus-fallback change is discoverable in the coverage documentation rather than masked by a current-looking record. Consequential weakening flagged honestly in Notes: Article 7's guard citation now rests on AC-001-4 and Exit criterion 2 alone, with a pointer that the TRD SHOULD satisfy it with a guard shown capable of failing.
- **Should-tier AC bar made explicit rather than implied:** Notes now states 2+ ACs with an edge case for Must, 1+ for Should. REQ-008, REQ-014, REQ-015 and REQ-017 were checked against the Must-tier bar and left as they are, by decision.
- **PRD Health Summary conformed to the create-prd metadata-only rule:** dropped the restated Must/Should/Could/Won't and AC-coverage rows (REQ headings and AC sub-items are the source truth, and restated counts are what drift), added an open-clarifications row, and replaced the "see the Dependency Map section" pointer with the actual count — **27** cross-requirement edges across 14 mapped rows. Matches the sibling `PRD-2026-8d825f54` shape.
- **Heading repaired:** `## Approvals Decision Ownership` → `## Approvals and Decision Ownership`, restoring the conjunction every cross-reference in the document already uses.
- Readiness re-scored: Completeness 4.5 → 4.8, Testability 4.7 → 4.8, Clarity 4.5 → 4.7, Feasibility unchanged at 4.6; overall 4.6 → 4.7.

- **Line-number citations from `TRD-2026-6995dc96` replaced with quoted anchors:** the *Approvals and Decision Ownership* row, *Technical Constraints* bullet and Notes bullets added by the local-daemon scope decision inserted one line above the *Technical Constraints and Dependencies* bullet about contract-version bumps, shifting it and every later line down by one. `TRD-2026-6995dc96` cited this PRD by line number in eight places, so the cited passages moved — and two of the eight, at PRD lines 271 and 278 in Goals and Non-Goals, happened to sit *above* the insertion and stayed correct, which is exactly how this failure mode hides: the numbers keep looking plausible while pointing at the wrong sentence. No validator checks a prose `PRD line NNN` reference, so nothing fails. Each citation now names a quoted phrase from its passage, chosen to fit entirely within a single PRD line so that no future insertion can split the anchor itself.
### v1.1.0 — 2026-11-13

Refinement pass (`/ensemble:refine-prd`). Readiness 4.4 → 4.6. Requirements 15 → 18; ACs 48 → 58; ambiguity markers 2 → 0.

- **REQ-004 marker resolved:** in-progress status is represented by Kata item ownership — an owned-but-open item is the in-progress state; `closed` maps directly, `pending` and `done` map to open and closed. AC-004-2 rewritten to assert ownership rather than defer to an unresolved representation.
- **REQ-007 marker resolved:** graph-health is computed by the adapter as a local cycle and dangling-edge scan over the item links it already exports. Chosen over omission because no backing-tool command provides graph-health and the contract's links-only fallback implements only ready-listing and planning. Added AC-007-5 for dangling-edge detection.
- **AC-010-1 made measurable:** it previously ranged over "each flag the beads-named command documents today", an unbounded set no reader could show satisfied; it now enumerates the command's supported phases. REQ-010 was retitled to match, dropping the implementation-level word "flags" that contradicted the Non-Goals technology-claim rule.
- **Goals graph-health bullet retained:** it asserts that graph-health triage works on the new backend; the marker that made that an open question is now resolved, so the goal stands met by an adapter-side scan over exported item links rather than by a backing-tool command.
- **New non-functional cluster E:** REQ-016 (the skip guarantee extends repo-wide and the skips are proven honest, building on REQ-012 rather than repeating it), REQ-017 (bounded, observable adapter failures against a hung, failing, or unparseable backing tool), REQ-018 (unbound-workspace and too-old-tool misconfigurations caught in preflight before any write, scoped to what REQ-001/REQ-012 do not already cover). Three ACs each.
- **AC-level implementation identifiers generalized:** AC-001-1 and AC-013-2 named config-file and manifest identifiers (`toolchain.yaml`, `tracker: kata`, `work-graph`, `.kata.toml`), which belong at TRD level; both now describe the user-visible act. AC-013-4 keeps its literal `tracker`/`work-graph` keys, since reading shipped default configuration back is the observable check itself.
- **AC-009-2 and AC-009-3 now name the retired command literally**, since the assertion is that the string is absent and that invoking it names its replacement.
- Exit criteria 4-8 tightened to name what is observable, and criterion 9 added for the new robustness cluster; Dependency Map and implementation clusters extended to cover REQ-016/017/018.
