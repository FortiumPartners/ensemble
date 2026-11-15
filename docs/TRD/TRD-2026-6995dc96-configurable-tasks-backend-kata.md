---
document_id: TRD-2026-6995dc96
label: trd-configurable-tasks-backend-kata
title: Configurable Tasks Backend - Kata Adapter
prd_reference: docs/PRD/PRD-2026-6995dc96-configurable-tasks-backend-kata.md
version: 1.0.0
status: Draft
date: 2026-11-13
kind: trd
design_readiness_score: 3.5
design_readiness_verdict: CONCERNS
totalTasks: 67
totalPrs: 6
totalRequirements: 18
totalAcceptanceCriteria: 58
reuse_target: TRD-2026-8d825f54
Constitution compliance: passed
related:
  - docs/TRD/TRD-2026-8d825f54-tool-abstraction-layer.md
---

# TRD: Configurable Tasks Backend - Kata Adapter

Adds a `kata` adapter to the shipped toolchain abstraction, plus the narrow additive extensions
that layer needs to express kata's semantics. It does **not** build a parallel task-backend
subsystem: PRD-2026-6995dc96 describes machinery that `TRD-2026-8d825f54` already specifies and
that exists on disk under `packages/development/lib/toolchain/`. Requirement numbers that appear
in both PRDs denote different requirements - read the Capability Reuse Check before treating any
of them as already delivered.

PRD: docs/PRD/PRD-2026-6995dc96-configurable-tasks-backend-kata.md

**Design readiness: 3.50 - CONCERNS.** Estimate confidence rose from 2 to 3 after a live write-side kata capture on 2026-11-14 confirmed the response shapes the estimates assume, and task coverage rose from 3 to 4 once TRD-031 through TRD-034 gave the four tested behaviours an owner. Two gates still hold the score below PASS and are recorded under Open Questions for the PRD: the graph-health semantics for trackers that expose no dependency data. The former third gate, the multi-id `tracker.label` mapping, is closed: A1's `tracker.label-one` capability shipped in tracker contract `1.1` on 2026-11-14 under PRD-2026-6995dc96 v1.3.0, so TRD-012 is no longer blocked on a contract amendment.

## Capability Reuse Check
<!-- gate:capability-reuse -->

**Reuse target:** `TRD-2026-8d825f54` (Tool Abstraction Layer) — Status `Draft`, version `1.0.2`, `prd_reference: docs/PRD/PRD-2026-8d825f54-tool-abstraction-layer.md`.

**Tracked capabilities registry is empty.** The `ensemble-capability-registry` capability in this repository is `kind: concept` with no `capabilities` manifest, so the registry check returns nothing to reuse from:

```
$ node packages/development/scripts/capability-registry-cli.js list --json --no-roots-check
{"capabilities":[],"sources":[],"errors":[]}
```

Reuse is therefore established against the specification, not the registry. The toolchain layer that PRD-2026-6995dc96 describes as new is specified by PRD-2026-8d825f54 and implemented on disk under `packages/development/lib/toolchain/`. That PRD is `status: Locked`, `version: 1.0.1`, git-tracked, and named in this PRD's `related:` frontmatter.

**Deletion candidate — DROPPED.** PRD-2026-8d825f54 was found to be a duplicate spec of shipped code and was raised as a candidate for deletion, which would have orphaned this TRD's reuse citation. It is **DROPPED**: the document is retained as the authoritative spec of the machinery this TRD consumes, and no task in this TRD deletes or supersedes it.

**Checkbox state is not implementation state.** TRD-2026-8d825f54 lists 87 unchecked `- [ ]` task boxes (TRD-001 through TRD-033) while every file it names exists on disk and is exercised by this repository's own commands. A checkbox audit against the shipped tree was performed as Phase 1 of this TRD, which is the basis for the `DO-NOT-REIMPLEMENT` boundary below. Implementers MUST NOT read the unchecked boxes as a work list for this TRD.

**Bounded reuse scope.** Reuse covers the toolchain machinery: adapter discovery and loading, contract loading and compatibility gating, category resolution, capability execution, preflight, and the beads adapter. It does **not** cover the kata-specific requirements. Requirement numbers are **per-document**: PRD-8d825f54's REQ-001, REQ-004, REQ-005, REQ-012, REQ-013 and REQ-014 describe capability taxonomy, required capabilities with fallbacks, adapters-as-provider-skills, explain mode, preflight health and mid-run failure policy, and are shipped. The same numbers in PRD-2026-6995dc96 describe kata behaviour and are **not** shipped. No requirement in this TRD is marked reused, and no task may be dropped on the grounds that a matching requirement number appears in the other document.

## Reused Capabilities

The six capabilities this PRD describes are consumed from shipped code. Each is listed with the file and symbol that already provides it, and the narrow extension this TRD makes to it.

| PRD capability | Shipped provider | Status | Extension made by this TRD |
|---|---|---|---|
| Capability taxonomy and contract loading | `lib/toolchain/contracts.js` — `loadContracts` (:32), `checkCompat` (:66), `requiredCapabilitiesFor` (:95), `fallbackFor` (:113), `contractName` (:20) | Reused unchanged | None for loading. Contract files gain additive capability entries only (see Interface Contracts). |
| Adapters are provider skills | `lib/toolchain/adapters.js` — `discoverAdapterDirectories` (:98), `discoverAdapters` (:135), `loadAdapter` (:219) returning `{manifest, source}`, `loadBuiltinFallback` (:191), `findSkillMd` (:63), `resolveSkillDir` (:85) | Reused unchanged | A new adapter directory `skills/adapter-tracker-kata/` is added; the discovery code is not modified. Today `beads`, `jira` and `azure-boards` are the only adapters present. |
| Config selects the backend | `lib/toolchain/config.js` — `resolveCategory(category, ctx)` (:77) returning `{value, source}` over project / user / env-compat / detection / builtin / default precedence; `loadToolchainConfig` (:45); `COMPAT_ENV_TO_CATEGORY` (:26) | Reused, one gap | The resolver reports `source: 'default'` on the tracker-supplied path; AC-001-1 requires the tracker-supplied source to be distinguishable, so this is extended, not replaced (Open Questions for the PRD). |
| Capability execution | `lib/toolchain/runner.js` — `runCapability` (:618), `runCapabilitySync` (:927), `buildArgv` (:195), `selectTemplate` (:421), `checkAllowlist` (:274), `lookupCapability` (:553) | Reused unchanged | No new execution path is added. Every kata invocation goes through `runCapability`; no other code path may invoke the `kata` binary. |
| Adapter validation | `lib/toolchain/validate.js` — `validateManifest` (:64), `checkVocabularyBlock` (:39), `validateAllowlist` (:154), `validateConformance` (:216), `scanCredentials` (:267), `runValidation` (:348) | Reused unchanged | The kata adapter manifest must pass existing validation with no change to the validator. |
| Availability detection | `lib/toolchain/detect.js` — `detectAdapter(category, ctx)` (:60), `AMBIGUOUS_PROVIDER` (:10) | Reused unchanged | Detection collects all matching candidates, returns the single match with `source: 'detection'`, throws `AMBIGUOUS_PROVIDER` on two or more, returns null on zero. Because detection resolves **before** the shipped default, the kata manifest ships `detect: []` so an installed `kata` binary can never displace `tracker: beads`. No probe is added. |
| Required vs optional capability handling | `lib/toolchain/resolve.js` — `requireCapabilities` (:23), `UNAVAILABLE` (:11) | Reused unchanged | None. |

**Contracts consumed, not forked.** `toolchain/categories/tracker.yaml` is contract version `1.1` with 18 capabilities (`tracker.label-one` added 2026-11-14 under PRD-2026-6995dc96 v1.3.0); there is no dependency-graph capability in it — dependency edges are `dep-add`/`dep-remove` plus the normalized `dependencies[]` field. `toolchain/categories/work-graph.yaml` is contract version `2.0` with exactly three capabilities (`ready`, `plan`, `graph-health`), each optional with fallback `work-graph-links-fallback`. `toolchain/toolchain.default.yaml` sets `tracker: beads` and `work-graph: auto`. The shipped `skills/adapter-tracker-beads/adapter.yaml` is the shape precedent for the kata adapter.

**Boundary — what stays new work.** Everything kata-specific receives a task: the kata adapter manifest and its argv mappings, the dependency-graph story for kata, the `ensemble-tasks-*` to `toolchain-cli` command rename and provider-neutral prose, coverage disclosure for a partial adapter, preflight and robustness gates, and documentation. Nothing in this TRD creates a second resolver, contract loader, runner, adapter discovery path, or work-graph engine.

<!-- Complete architecture section; supersedes the truncated yield. Corrections in this version: Option A cons restated; capabilities whose outputs carry no id must omit parse; tracker.find-by-key added to the list gate; dedupe key carried as externalKey (externalRef keeps its schema meaning); kata ready has no total flag; tracker.list base template lists all statuses; jira graph-health change raised as an open question. Delete this comment on merge. -->

## Architecture Decision

**Verified baseline.** Read from the repository and the installed kata binary (v0.23.0 at `/opt/homebrew/bin/kata`).

- `tracker.yaml` v1.1 declares 18 capabilities: 4 required (`tracker.show`, `tracker.create`, `tracker.update`, `tracker.close`) and 14 optional, the newest being `tracker.label-one` (`addedInMinor: 1`) (`docs/toolchain/contracts/tracker.md:7`). `work-graph.yaml` v2.0 declares 3 optional capabilities, naming `work-graph-links-fallback` (`packages/development/toolchain/categories/work-graph.yaml:5-27`).
- Coverage differs by adapter. Beads declares all 17 tracker capabilities and all 3 work-graph capabilities (`packages/development/skills/adapter-tracker-beads/adapter.yaml`, `contract: {tracker: "1.0", work-graph: "2.0"}`). Jira (`packages/infrastructure/skills/adapter-tracker-jira/adapter.yaml`) and azure-boards (`packages/infrastructure/skills/adapter-tracker-azure-boards/adapter.yaml`) each declare `categories: [tracker]`, 8 tracker capabilities, and no work-graph capability.
- The graph fallback is partial. `work-graph-links-fallback` serves `ready` and `plan` only. `graph-health` returns `NOT_ALLOWED` (`packages/development/lib/toolchain/builtin/work-graph-links-fallback.js:279-287`), although the contract names this fallback for graph-health. `plan` appends unorderable items instead of reporting them (`:256`). The fallback orders topologically only when `tracker.show` supplies `dependencies` (`:311-322`). No shipped tracker maps that field, so the fallback is not dependency-aware on any shipped backend (reviewer-confirmed).
- Routing tests only the category claim: `trackerProvidesWorkGraph` checks `manifest.categories` (`packages/development/lib/toolchain/work-graph-resolve.js:77-79`). On that path `source` is the work-graph category default, not the tracker's (`:84`), which breaks AC-001-1.
- `tracker.list` with no `parse` block returns raw stdout (`packages/development/lib/toolchain/runner.js:1170-1171`). Beads, jira, and azure-boards leave it unmapped for that reason. A mapped list would be validated against `work-item.json`, which requires a top-level `id` (`runner.js:618-620`), so it fails unless `CAPABILITY_NORMALIZED_SCHEMA` routes it to a collection schema (`runner.js:601-604`).
  - Kata facts come from `kata <command> --help`, `kata quickstart`, and read-only `kata doctor --json` and `kata list --json` run in an unbound scratch directory, plus a live write-side capture in a scratch project bound with `kata init --project trd-capture-scratch` against kata v0.23.0 under an isolated `KATA_HOME` (2026-11-14; raw envelopes `~/.omp/trd-6995dc96/capture/*.json`, summary `~/.omp/trd-6995dc96/kata-envelope-facts.md`). Confirmed there: every envelope carries `kata_api_version`; the ref identifier is `short_id`; `--meta ensemble_external_key=<key>` round-trips as `issue.metadata.ensemble_external_key`; `list --meta k=v` filters exactly; `show.links[]` carries `{from, to, type}` edges; `list` returns `{complete, truncated, issues[]}` with no total; `close --evidence <type>:<value>` is accepted; `set-status` and a bulk or multi-id form do not exist. Kata still has no plan, graph-health, or export command and no type field. It has `ready` (open items not blocked by open items), blocking edges (`edit --blocked-by`), typed close evidence, and ownership (`claim`).

### Alternatives Considered

| Option | Approach | Pros | Cons |
|---|---|---|---|
| A. Manifest-only tracker adapter | `adapter-tracker-kata` declares `tracker` only. Work-graph stays on the built-in fallback. No engine change. | Smallest diff. Same shape as shipped jira and azure-boards. No new code path. REQ-013 trivially preserved. | Fails AC-001-1 and AC-006-2: the work-graph adapter resolved is the built-in, which reports its own identity and a default `source`. Fails AC-007-4: the envelope names the built-in, not kata. Fails AC-007-3 and AC-007-5: no graph-health source exists, because the built-in returns `NOT_ALLOWED`. Meets AC-007-2 only if kata's `tracker.show` maps `dependencies` [UNVERIFIED]. The PRD's own ACs still require the tracker amendments (AC-003-3 test evidence, AC-004-2 owner), so "no engine change" does not hold. |
| B. Graph operations on the tracker contract | Add additive tracker 1.1 capabilities `tracker.ready`, `tracker.plan`, `tracker.graph-health`. Leave work-graph untouched. | One category answers every tracker question. Independent of work-graph auto-routing. | Duplicates `work-graph.*`, so ready, plan, and graph-health each have two answers. Every graph consumer moves: `packages/development/skills/ensemble-beads-build-wave/SKILL.md:26` requires `work-graph.ready`, and PRD REQ-011 exists to prevent that churn. Kata still needs C's analyzer, so B pays C's engine cost plus a second surface. Contradicts REQ-001, which requires kata to declare the `work-graph` category. |
| C. Attach through `work-graph` v2.0 with one shared analyzer | Kata declares `tracker` and `work-graph`. `work-graph.ready` is native (`kata ready --json`). `work-graph.plan` and `work-graph.graph-health` declare `provider: work-graph-analyzer`, served by the existing built-in analyzer, extended with graph-health and findings. Contracts amended additively: tracker 1.0 to 1.1, work-graph 2.0 to 2.1. | Matches the PRD's declared categories. `tracker: kata` alone selects kata for both categories (AC-001-1, AC-006-2). Reuses the shipped ready and ordering code, adding no subsystem. Makes the graph-health fallback reference true. Beads (`bv`) and jira keep their current paths. | Three engine edits: resolver capability test and source fix, provider dispatch, and analyzer identity, graph-health, and findings. Plan and health cost one `tracker.show` per item unless `kata list --json` carries edges [UNVERIFIED]. The analyzer is shared, not kata-native, so the PRD must say so (Open Question 9). It changes jira's graph-health answer (Open Question 13). |

**Pick: C.**

**Rationale:**

- **Against A.** A is cheap because it stops short of the requirement. If A declares `work-graph`, plan and health have no provider and graph-health has no source. If A leaves work-graph undeclared, the resolved work-graph adapter is the built-in, so AC-001-1, AC-006-2, and AC-007-4 fail. The gap is computation and identity, not configuration. No YAML can emit a cycle finding, a `dependencyAware: true` for a backend with no plan command, or kata as the serving adapter. A also pays the tracker amendments (owner, close evidence), so the only work it avoids is the analyzer work that C needs too.
- **Against B.** B moves the same computation to another category and creates a parallel answer. Every consumer that requires `work-graph.ready` changes, and the analyzer is still required, so B costs C's engine work plus a second surface. It also contradicts the PRD's declared category set.
- **Why C adds the least machinery.** Each change extends a seam the code already has: a capability entry in `packages/development/toolchain/schemas/adapter-manifest-schema.json`, the in-process work-graph branch in `packages/development/lib/toolchain-cli.js:470-482` and `:539-547`, the analyzer that already computes ready and plan (`builtin/work-graph-links-fallback.js:211-258`), and the category contracts. No new subsystem duplicates `packages/development/lib/toolchain/`. Adapter directories hold data: `validateAdapterDir` (`packages/development/lib/toolchain/validate.js:762-788`) checks the manifest, allowlist, conformance, and credentials, and the runner executes only manifest argv templates (`runner.js:1261`). The one in-process capability path is the built-in module that `work-graph-resolve.js` already loads. A JavaScript module inside the adapter directory was therefore rejected.
- **The strengthened fallback.** Every work-graph answer states `dependencyAware`, and the serving adapter is named in the envelope. `plan` reports unorderable items as `findings` instead of appending them. Routing requires all three work-graph capabilities. No shipped tracker changes routing: beads declares all three, and jira and azure-boards do not claim the category.
- **Costs accepted.** C is the only option that meets the work-graph ACs, and the only one that changes engine code. Plan and health fan out one `tracker.show` per item. Each per-item call must share the capability's class bound, or N individually bounded calls are unbounded in total. The first implementation step measures this before the kata tests are accepted.

## System Architecture

### Components

Only new or amended items are listed. Paths marked **(NEW)** do not exist yet; every other path exists.

| Component | Location | Responsibility |
|---|---|---|
| Kata tracker adapter **(NEW)** | `packages/development/skills/adapter-tracker-kata/SKILL.md` and `adapter.yaml` **(NEW)**. Mirror `packages/full/skills/adapter-tracker-kata` **(NEW)**, a symlink in the form of the existing `adapter-tracker-beads` link. `packages/pi/skills/adapter-tracker-kata/` **(NEW, generated by the pi build)**. | Declares `categories: [tracker, work-graph]` and `contract: {tracker: "1.1", work-graph: "2.1"}`; `binaries: [kata]`; an allowlist covering the subcommands its run templates use, including `--version`; `env` names only (`KATA_HOME`, `KATA_SERVER`, `KATA_AUTH_TOKEN`, `KATA_AUTHOR`, `KATA_TEAMMATE`), with no credential values (`scanCredentials`, `validate.js:444`); two health checks (version floor, binding); `detect: []`, so repository contents never select kata (REQ-013). `SKILL.md` carries the `## Vocabulary` block that `validate.js:99,140-150` requires. The declared capability set is listed under Interface Contracts. |
| Tracker contract amendment (AMENDED, additive) | `packages/development/toolchain/categories/tracker.yaml`, version 1.0 to 1.1 | Adds `tracker.close-with-evidence` (NEW, optional, `addedInMinor: 1`). Adds `owner` to `tracker.show` outputs. Nothing removed; no `required` flag changes. |
| Work-graph contract amendment (AMENDED, additive) | `packages/development/toolchain/categories/work-graph.yaml`, version 2.0 to 2.1 | Adds `findings` to `work-graph.plan` outputs and `dependencyAware` to `work-graph.graph-health` outputs (REQ-007 AC-007-3, AC-007-4). Nothing added or removed; fallback ids unchanged. |
| Built-in manifest (AMENDED) | `packages/development/toolchain/builtin/work-graph-links-fallback/adapter.yaml` | Adds `work-graph.graph-health: {}`, which lines 32-37 deliberately omit, and moves `contract.work-graph` to `"2.1"`. Without this the built-in still refuses the fallback the contract names. |
| Adapter manifest schema (AMENDED) | `packages/development/toolchain/schemas/adapter-manifest-schema.json` | Capability: `provider` (only `work-graph-analyzer`, plus `unavailable` if Open Question 8 resolves that way); `run` required only when `provider` is absent. Capability: `timeoutClass` (`short` or `long`, default `long`). Health items: `minVersion` and `versionPattern`. `parse`: `countFrom`. Today the schema requires `run` on every capability and sets `additionalProperties: false` on health items. |
| Normalized work-item schema (AMENDED) | `packages/development/toolchain/schemas/normalized/work-item.json` | Adds optional `owner` (string) and optional `externalKey` (string, the dedupe key). `externalRef` keeps its schema meaning, a fully-qualified external reference such as a URL (`work-item.json:92-94`). The top level is `additionalProperties: true`, so existing producers still validate. |
| Provider dispatch (AMENDED) | `packages/development/lib/toolchain/runner.js`, `runCapability` (`:1261`) | A capability with `provider: work-graph-analyzer` runs in-process through the analyzer, with the resolved adapter's own manifest as the tracker. The analyzer lives in the built-in module, which requires `runner.js`, so this branch lazy-requires it to avoid a load cycle. |
| Shared link analyzer (AMENDED) | `packages/development/lib/toolchain/builtin/work-graph-links-fallback.js` (file name kept) | (a) Reporting identity: when serving a provider capability, the envelope's `adapter` is the caller's adapter id; the category fallback keeps `work-graph-links-fallback`. Today the analyzer always reports its own id (`:88`, `:327`). (b) `work-graph.graph-health`: `cycle`, `dangling-edge`, and `stale-blocker` findings over the same edges; today it refuses (`:279-287`). (c) `plan` moves unorderable items into `findings` and out of `items`; today they are appended (`:256`). (d) One aggregate deadline per call, equal to the capability's class bound, shared by the per-item `tracker.show` calls. (e) `plan` and `graph-health` list with no status filter, so closed blockers resolve and the closed-dependency test sees closed ids. Jira's path (no dependency data) keeps today's plan-order result. |
| Work-graph resolution (AMENDED) | `packages/development/lib/toolchain/work-graph-resolve.js` | (a) `trackerProvidesWorkGraph` requires all three work-graph capabilities in the tracker's `capabilities`, not the category claim (`:77-79`). (b) When `autoVia` is `tracker-capabilities`, `source` is the tracker's resolution (`trackerResolved.source`), not the work-graph default (`:84`). Serves AC-001-1 and AC-006-2. |
| Normalized output gate (AMENDED) | `packages/development/lib/toolchain/runner.js`, `CAPABILITY_NORMALIZED_SCHEMA` (`:601-604`) | Adds `tracker.find-by-key` and `work-graph.ready` to `work-item-list.json`, alongside `tracker.list` and `tracker.comments`. Keep the `tracker.list` entry: without it, `tracker` falls back to `work-item.json` and every `{items}` list fails `BAD_OUTPUT`. A capability whose outputs carry no `id` (`tracker.label`, `tracker.sync`, `tracker.stage-export`) must omit `parse`, because the work-item gate would reject it. Gate `work-graph.ready` only after the beads fixtures in `scripts/tests/fixtures/toolchain/adapter-tracker-beads-samples/` still validate. In-process `provider` results never pass through `mapAndValidateOutput`. |
| Truncation-safe read path **(NEW)** | `packages/development/lib/toolchain/mapping.js`, `mapOutput` (`:464`), new `parse.countFrom`; every kata list-type `run[]` template | `kata list` returns at most 200 rows unless `--limit 0` (`kata list --help`). Every kata list-type argv passes `--limit 0`. The `kata list` argv also passes `--include-total`, and `countFrom` names the total's dotted path. The mapped item count must equal it, or the call returns `BAD_OUTPUT` naming truncation. `kata ready --help` shows no default cap and has no total flag, so its completeness rests on `--limit 0`. A partial list is never reported as success (REQ-017 AC-017-3; underpins REQ-002 AC-002-1 and REQ-007 AC-007-1). This read path was requested under REQ-016, but REQ-016 covers skip honesty only, so the rule is anchored to REQ-017 AC-017-3 (Open Question 14). |
| Version, contract, and binding gate **(NEW and AMENDED)** | `packages/development/lib/toolchain/preflight.js`: `runHealthCheck` (`:150-182`), `runPreflight` (`:199`) | (a) Version floor **(NEW)**: parse `kata --version` with `versionPattern`, for example `kata v(\d+\.\d+\.\d+)`. A value below `minVersion` 0.23.0 fails `HEALTH_FAILED` and names both versions (REQ-018 AC-018-2). On pass, the version is recorded in the preflight record (REQ-001 AC-001-2; `runPreflight` returns no version today, `:196-197`). (b) Ordering **(AMENDED)**: the version check runs first and short-circuits, and the other checks follow. Today all checks run concurrently (`:184-186`), so a call the old version cannot serve can be made. (c) Contract compatibility **(AMENDED)**: call `checkCompat` at preflight. `checkCompat` does not refuse an adapter whose target minor exceeds the contract's minor (`contracts.js:118-140`). (d) Binding **(no new code path)**: `kata list --limit 1 --json` exits 4 with `project_not_initialized` in an unbound workspace (verified), so preflight fails before any write (REQ-018 AC-018-1). Do not gate on `kata doctor --json`: it reports an unbound workspace as `warn` and exits 0. (e) Missing binary **(AMENDED message)**: a missing `kata` surfaces as `TOOL_FAILED` carrying Node's `spawn kata ENOENT` text (`runner.js:1365-1373`) [INFERENCE from Node's `execFile` behavior]. The message must name the binary (AC-001-3). |
| Timeout classes **(AMENDED)** | `packages/development/lib/toolchain/runner.js` (bound selection at `:1275`; `TIMEOUT` at `:1351-1355` async, `:1571` sync); `packages/development/toolchain/schemas/toolchain-config-schema.json`; `packages/development/lib/toolchain/config.js` (new `timeouts` key) | `short` = 10000 ms (`DEFAULT_HEALTH_TIMEOUT_MS`, `preflight.js:97`). `long` = 60000 ms (`DEFAULT_TIMEOUT_MS`, `runner.js:493`). Both overridable per project. A caller-supplied `opts.timeoutMs` still takes precedence over the class default. `TIMEOUT` names the capability, its class, and the bound (REQ-017 AC-017-1). Class assignment follows PRD REQ-017's text; the classes for `list` and `find-by-key` are open (Open Question 14). The values are a proposal pending measurement. |
| Capability-coverage report **(AMENDED)** and coverage test **(NEW)** | `scripts/generate-contract-docs.js` writes `docs/toolchain/contracts/<category>.md`. Test `packages/development/tests/toolchain-kata-coverage.test.js` **(NEW)** | The generator adds a backend matrix per category: native, fallback, or absent for each adapter that `adapters.js#discoverAdapters` finds (`packages/development/lib/toolchain/adapters.js:468`). `--check` also reads adapter manifests, so an unrecorded manifest change fails (PRD exit criterion 8). The coverage test asserts that kata declares every required and fallback-bearing capability, and fails when one is removed (REQ-001 AC-001-4, REQ-015 AC-015-2). Today the generator reads category YAML only, and `docs/toolchain/contracts/tracker.md` has no backend columns. |
| Additive-only guard **(AMENDED, wired)** | `packages/development/lib/toolchain/contracts.js#checkAdditiveOnly` (`:156-191`), called from `scripts/generate-contract-docs.js --check` **(NEW call site)** | No non-test code calls `checkAdditiveOnly` today, although `packages/development/toolchain/categories/host.yaml:81` says it gates version bumps. Extend it to inputs, outputs, and fallback ids; it currently checks only removals, `required` changes, and new required capabilities. Run it in the docs check against the contract at the merge base. |
| Tool-absent skip evidence **(NEW)** | `packages/development/tests/helpers/tool-gate.js` **(NEW)**; `scripts/check-tool-absent-skips.js` **(NEW)** | The helper skips kata-dependent tests with the title `tool absent: kata`. The checker reads Jest's machine-readable report (`jest --json --outputFile`), the runner the package uses (`packages/development/package.json`, `jest --passWithNoTests`), and fails if a kata-asserting test reports `passed` while kata is absent. No tool-absent helper exists today in `packages/development/tests` or `scripts/tests`. Covers REQ-012 AC-012-1 and REQ-016 AC-016-1 to AC-016-3. |
| Caller shape **(AMENDED)** | `packages/development/lib/tracker-findings.js` (list parse near `:180-190`; `matchKey` at `:196`; `externalKey` at `:129`); beads `tracker.list` and `tracker.find-by-key` in `packages/development/skills/adapter-tracker-beads/adapter.yaml` | `tracker-findings.js` accepts a bare array or `{issues}` and matches the dedupe key on raw `external_ref` (`matchKey`, `:196`). It moves to the normalized `{items}` shape and matches on `externalKey`. Beads' `tracker.list` and `tracker.find-by-key` gain parse blocks that emit the same shape, with `externalKey` mapped from `external_ref`. Titles, edges, and phase grouping stay unchanged (REQ-010 AC-010-2). Other raw-list readers named in the jira manifest comments (`packages/development/lib/trd-cli.js#getBeadCounts`, `packages/development/lib/beads-label.js#ensureLabel`, `packages/infrastructure/skills/adapter-tracker-jira/adapter.yaml:91-93`) are audited in the same change. |

### Data Flow

1. **Preflight.** `toolchain-cli preflight --require <caps>` calls `runPreflight` (`packages/development/lib/toolchain/preflight.js:199`). Changed: the version check runs first and short-circuits, and the other health checks follow. `requireCapabilities` throws `UNAVAILABLE` for a missing required capability (`resolve.js:113-124`). The record `preflight-<runId>.json` is written only on full pass (`preflight.js:119-131`).
2. **Resolve.** `resolveCategory` (`config.js:143`) applies project, user, env-compat, detection, then default (`:151-173`). `resolve-guard.js` excludes `tracker` from the shipped-name check (`:61`, `assertKnownAdapter` at `:96`), so a new tracker name needs no allowlist edit. `loadAdapter` (`adapters.js:592`) discovers `packages/*/skills/adapter-<category>-<name>/` and applies the repo-local trust gate. For `work-graph: auto`, `resolveWorkGraphAdapter` (`work-graph-resolve.js:59`) selects the tracker only when its capabilities cover all three work-graph capabilities. Changed: today the category claim alone selects it.
3. **Gate.** A side-effecting capability (`sideEffect: true` in its contract) requires a passing preflight record for its run id (`PREFLIGHT_REQUIRED`, `toolchain-cli.js:499-509`), then adapter confirmation (`CONFIRMATION_REQUIRED`, `:511-535`). Read-only capabilities skip both gates.
4. **Run, argv with no shell.** `runCapability` (`runner.js:1261`) calls `lookupCapability` (`:902`), which returns `UNAVAILABLE` with a fallback or `NOT_ALLOWED`. `selectTemplate` and `buildArgv` (`:421`, `:474`) return `NOT_ALLOWED` for an undeclared variant value and `INVALID_ARG` for a missing placeholder. `denyRuntimeAllowlist` (`:560`) checks the resolved argv. The child runs under `execFile` with an environment built by `buildChildEnv` (`:689`), which passes only declared names, with the capability's class bound and a 64 MiB `maxBuffer` (`:499`). A `provider` capability runs in-process instead. A non-zero exit returns `TOOL_FAILED` with stderr, or with kata's JSON error from stdout (`:1144-1152`, `:1365-1373`). Exceeding the bound returns `TIMEOUT`. A `maxBuffer` overflow is an execFile error that sets neither `killed` nor `signal` (the repository's own note at `runner.js:1561-1565`), so it is reported as `TOOL_FAILED`, never as a truncated success.
5. **Parse and map.** `mapAndValidateOutput` (`runner.js:1169`) calls `mapOutput` (`packages/development/lib/toolchain/mapping.js:464`): JSON parse, `root`, `map`, `statusMap`, `arrayMap` with its equality `filter`, then `countFrom` (new). Failures return `BAD_OUTPUT`.
6. **Normalized-schema validate.** Ajv validates against `CAPABILITY_NORMALIZED_SCHEMA` (`runner.js:601-604`), else `CATEGORY_NORMALIZED_SCHEMA` (`:618-620`). A mismatch returns `BAD_OUTPUT`, and the data is withheld.
7. **Return and ledger append.** Success returns `successEnvelope` (`runner.js:1232`). A successful side-effecting call appends a redacted JSON line to `.ensemble/state/toolchain/ledger-<runId>.jsonl` (`ledger.js:113-121`, called at `toolchain-cli.js:553-559`). A failed side-effecting call reads completed effects from the ledger and writes `failure-<runId>.json` (`toolchain-cli.js:562-571`, `ledger.js:180-196`). There is no automatic retry (Constitution Rule 4).

## Interface Contracts

### Normalized Work Item

The shipped `work-item.json` plus two proposed optional properties. `id` is the only required field (`work-item.json:8`). `status` is the enum open, in_progress, closed (`:29`).

| Field | Type and constraint | Kata source (verified by 2026-11-14 capture) | Notes |
|---|---|---|---|
| `id` | string, minLength 1, required | `.issue.short_id` (capture: `create` → `"csjm"`; refs also accept `project#short_id` and the full ULID). `.issue.id` is an integer and `.issue.uid` a ULID; neither is the ref. | Only required field. |
| `title`, `description` | string | Title; body. | |
| `type` | string | None. Kata has no type field. | Left unmapped (Open Question 11). |
| `status` | open, in_progress, or closed | `status` (`open` or `closed`). | `in_progress` cannot be derived: `statusMap` reads only the raw `status` (`mapping.js` header, lines 23-24), not `owner` (Open Question 5). |
| `owner` (NEW) | string | `owner`. | Makes a claim readable. |
| `priority` | string | Priority 0 to 4 per `kata create --help`. | The mapping engine has no type-cast, and `work-item.json:32-34` requires a string (Open Question 11). |
| `labels` | string array | `labels`. | |
| `dependencies`, `dependents` | arrays of objects with `id` and optional `type` | `show.links[]`, each `{id, from:{short_id, qualified_id, status, uid, project}, to:{…}, type, author, created_at}` (capture). A `--blocked-by X` edge appears as `type:"blocks"` with `from` = X and `to` = this issue, so direction is explicit and needs no inference. | Required for `dependencyAware`. `list` items do not carry `links`, so the analyzer fans out one `tracker.show` per item. |
| `comments` | object array | Comments from `show`. | |
| `externalKey` (NEW) | string | Metadata `ensemble_external_key`, set by `--meta` (`kata create --help`). | The dedupe key. Underscore, so the dotted grammar can address it. Beads maps `external_ref` here. |
| `externalRef` | string, a fully-qualified external reference such as a URL | Not used for kata. | Keeps its schema meaning (`work-item.json:92-94`). |

**List shape.** Normalized output is `{items: [WorkItem]}` per `work-item-list.json`, which requires `items` and allows additional properties. Kata's own `list` returns `{kata_api_version, complete, truncated, issues[]}` — the key is `issues`, there is no total, and `complete`/`truncated` are the only completeness signals; `issues[]` items carry `qualified_id` in addition to the `show` fields. `ready` returns `{kata_api_version, issues[]}` with no completeness field at all.

**Caller obligation.** `tracker-findings.js` reads the raw list (`:180-196`). Under this contract it reads `items` and `externalKey`.

### Runner Envelope and Error Codes

```
success:  {ok: true, capability, adapter, source, data}
failure:  {ok: false, error: {code, message}}
optional capability named with a fallback, not declared:
          {ok: false, unavailable: true, fallback, capability, adapter,
           error: {code: "UNAVAILABLE", message}}
side-effecting failure on the CLI run path adds: completedSideEffects, failureRecord
```

Codes, with emission sites:

| Code | Emitted when | Site |
|---|---|---|
| `UNAVAILABLE` | Optional capability absent that names a fallback (envelope); a `--require`d capability missing (thrown). | `runner.js:916`; `resolve.js:122` |
| `NOT_ALLOWED` | Capability undeclared with no fallback; undeclared variant value; runtime allowlist denial. Proposed use: kata `set-status` to closed. | `runner.js:928`, `:447`, `:1014`; `builtin/work-graph-links-fallback.js:283` |
| `INVALID_ARG` | Placeholder missing or invalid; CLI argument errors. | `runner.js:366-397`, `:996`; `toolchain-cli.js:445` |
| `TOOL_FAILED` | Non-zero exit; zero exit with an error envelope on stdout; tolerated exit with non-JSON output; normalized-schema load failure; missing binary (`spawn ... ENOENT`). | `runner.js:1123`, `:1194`, `:1370`, `:1392` |
| `TIMEOUT` | Child exceeded its class bound and was killed. | `runner.js:1351` (async); `:1571` (sync) |
| `BAD_OUTPUT` | Mapping failure; normalized-schema failure; `countFrom` mismatch (new). | `mapping.js:239`; `runner.js:1178`, `:1212` |
| `HEALTH_FAILED` | Any preflight health failure: timeout, version below floor (new), or binding failure. | `preflight.js:180`, `:236`, `:251`, `:283` |
| `PREFLIGHT_REQUIRED` | Side-effecting run without a passing record for its run id. | `toolchain-cli.js:503` |
| `CONFIRMATION_REQUIRED` | Side-effecting run without adapter confirmation. | `toolchain-cli.js:527` |
| `AMBIGUOUS_PROVIDER` | Two or more detection candidates. | `detect.js:687`, `:710` |
| `NOT_INSTALLED` | Adapter name resolves nowhere. | `adapters.js:715`, `:743` |
| `UNTRUSTED_REPO_ADAPTER`, `CONFIG_INVALID` | Adapter trust gate; config validation. Named in the docstring at `work-graph-resolve.js:54-55`. | Surfaced by `toolchain-cli.js` as `error.code` (`:475`, `:490`). |
| `INVALID_RUN_ID`, `RESOLVE_FAILED`, `UNKNOWN_SUBCOMMAND` | Run-id validation; resolution fallback code; unknown CLI subcommand. | `preflight.js:207`; `toolchain-cli.js:475`, `:490`, `:1205` |

Notes:

- An optional capability with no fallback that is not declared returns `NOT_ALLOWED` (`runner.js:924-931`), not `UNAVAILABLE`. `UNAVAILABLE` is thrown only for a `--require` gap (`resolve.js:113-124`) and returned only for an optional capability with a fallback.
- Kata's exit codes (0 to 8, `kata --help`) are not runner codes. A non-zero kata exit is `TOOL_FAILED`, carrying kata's JSON `error.code` from stdout. Verified: `project_not_initialized`, exit 4. No `successExitCodes` are declared for kata.
- `TIMEOUT` message (amended): `<adapter>: capability '<id>' (timeoutClass <short|long>) exceeded its <class> bound of <ms>ms and was killed`.

### Kata Declared Capability Set

Twenty-one capabilities. Every required capability and every capability whose contract entry names a fallback is declared (AC-001-4).

- Native `run[]`: `tracker.show`, `tracker.list`, `tracker.create`, `tracker.create-detailed`, `tracker.update`, `tracker.update-detailed`, `tracker.close`, `tracker.close-with-reason`, `tracker.close-with-evidence` (NEW), `tracker.comment`, `tracker.comments`, `tracker.dep-add`, `tracker.dep-remove`, `tracker.label`, `tracker.label-one` (NEW, blocked on the tracker 1.1 amendment), `tracker.set-status`, `tracker.find-by-key`, `work-graph.ready`.
- In-process `provider: work-graph-analyzer`: `work-graph.plan`, `work-graph.graph-health`.
- Declared pending Open Question 8: `tracker.stage-export`. Two entries above are not yet in the shipped contract documents and both are gated on the same PRD amendment: `tracker.close-with-evidence` (NEW, tracker 1.1) and `tracker.label-one` (NEW, tracker 1.1, per A1). Neither is `required`, so `validate.js` raises nothing for either, either direction: its only missing-capability message fires for contract capabilities carrying `required: true`, and an adapter capability the contract does not declare is skipped outright. `checkCompat` treats a minor-version difference as compatible and merely reports the extra ids as unavailable, so a manifest targeting 1.1 against the shipped 1.0 validates clean. Nothing forces this amendment to land; it is the architecture owner's PRD decision that does, and TRD-015 supplies the check that can fail — it fails when a required or fallback-bearing capability is dropped from the manifest, not when a new optional one is added ahead of the contract. `scripts/tests/fixtures/toolchain/` carries a 1.1 contract fixture so TRD-015 and TRD-016 can run against it.
- Omitted: `tracker.sync` (optional, no fallback). Kata writes persist through the daemon, and no flush command exists (`kata --help`).

### New and Amended Capabilities

Within a major: no capability is removed or renamed, no `required` flag changes, no input changes, and no fallback id changes. New capabilities are optional with `addedInMinor` set. Output additions are allowed and recorded by the minor bump. `addedInMinor` is a capability field, so output changes carry no field of their own.

| Capability | Change | Inputs | Outputs | Required | sideEffect | fallback | addedInMinor |
|---|---|---|---|---|---|---|---|
| `tracker.label-one` | NEW, tracker 1.1 | `id`, `label` | `id`, `labels` | false | true | none | 1 |
| `tracker.close-with-evidence` | NEW, tracker 1.1 | `id`, `reason`, `evidence` | `id`, `status` | false | true | none | 1 |
| `tracker.show` | AMENDED, output added | `id` | `id`, `title`, `description`, `type`, `status`, `priority`, `labels`, `owner` | true | false | none | n/a |
| `work-graph.plan` | AMENDED, output added | `scope` | `items`, `orderingSource`, `dependencyAware`, `findings` | false | false | `work-graph-links-fallback` | n/a |
| `work-graph.graph-health` | AMENDED, output added | `scope` | `status`, `findings`, `dependencyAware` | false | false | `work-graph-links-fallback` (now implemented by the built-in) | n/a |

Semantics:

- **`tracker.label-one`.** Maps to `kata label add <ref> <label>`, with `kata label rm` the detach direction; both are single-item, and the label is positional (`kata label --help`, and `kata quickstart` uses `kata label add abc4 safari`). Inputs are one `id` and one `label`; one argv template per call, so labelling several items is an adapter-side sweep rather than a composed invocation. The A1 composed operations reach their semantics through this per-id capability: labels directly, and in-progress once `owner` is read from `tracker.show`. Without it the sweep cannot be expressed and those operations stay design-blocked.
- **`tracker.close-with-evidence`.** Maps to `kata close <id> --done -m <reason> --evidence <evidence>`. `reason` is the closing message; kata requires at least 40 characters for `done` (`kata close --help`). `evidence` takes one typed value: `commit:<sha>`, `pr:<url>`, or `test:<command>` (`kata close --help`). The kata reason is fixed to `done`. Adapters without it return `NOT_ALLOWED`, so callers check availability first. Required for REQ-003 AC-003-3, because `tracker.close-with-reason` accepts only `commit` (`tracker.yaml:131-137`). It overlaps `tracker.close-with-reason`; the two stay separate because the additive rules forbid changing that capability's inputs.
- **`work-graph.plan` `findings`.** A list of `{kind, ids}`, where `kind` is `cycle` or `dangling-edge`. Unorderable items appear in `findings` and are omitted from `items`.
- **`work-graph.graph-health`.** `status` is `ok` or `findings`. Finding kinds: `cycle`; `dangling-edge` (a dependency naming an id the listing never returns); `stale-blocker` (an open item whose blocker is closed, so the link is inert). `dependencyAware` is true when edges were read.
- **`orderingSource`** keeps its method values (`tracker-links`, `plan-order`). AC-007-4 is met by the envelope's `adapter` field, which names kata on the provider path (Open Question 9).

### Manifest-Facing Additions

- `capabilities.<id>.provider`: `work-graph-analyzer`. When set, `run` is not required. Proposed value `unavailable`, only if Open Question 8 resolves to a declared unavailable status: it returns the contract's in-band `{text: "", status: "unavailable"}` for `tracker.stage-export`.
- `capabilities.<id>.timeoutClass`: `short` or `long`; default `long`.
- `health[].minVersion`: `x.y.z`. `health[].versionPattern`: a regular expression with one capture group.
- `parse.countFrom`: dotted path to the expected total.

No schema change is needed for `variants` on `filter` or `type`; that mechanism already exists (`runner.js:421`).

### Additive Rules

- Existing adapters keep their targets (`tracker: "1.0"`, `work-graph: "2.0"`, as in `adapter-tracker-beads/adapter.yaml`) and stay valid. `checkCompat` marks `addedInMinor` capabilities unavailable to them, and none is required.
- No major bump is proposed.

### Kata-Native Constraints

These shape the mapping without changing the contract.

- **Binding and daemon.** Kata resolves the project from `.kata.toml` at or above the working directory (`kata --help`). The runner passes `cwd: projectRoot` (`toolchain-cli.js:546`). `kata init` writes the binding (REQ-014 AC-014-1). The daemon auto-starts by default (`kata --help`). Whether an auto-started daemon sits inside the CLI's process tree matters, because the runner kills that tree on timeout (`runner.js:1336-1347`) [UNVERIFIED]. Measure in the first implementation step.
- **`tracker.close` (required) cannot succeed.** Its only input is `id` (`tracker.yaml:33-38`). Kata refuses a bare close with exit 2 and `kind:"usage"`, listing the accepted reasons: `--done` (with `--commit`, `--pr`, `--test`, or `--reviewed`), `--wontfix`, `--duplicate-of <ref>`, `--superseded-by <ref>`, or `--audit-no-change`. The adapter declares it; kata always refuses it. See Open Question 7.
- **`tracker.close-with-reason`.** Maps to `kata close <id> --done -m <reason> --commit <commit>`. Reasons under 40 characters are refused by kata's validation (`kata close --help`), which surfaces as `TOOL_FAILED`. That refusal is the observable outcome AC-003-2 requires.
- **`tracker.set-status`.** Variants keyed on `status`. `in_progress` becomes `kata claim <id> --if-unowned`. `open` becomes `kata unassign <id>`, which clears any owner, because the contract has no actor input for `--expect-owner`. `closed` returns `NOT_ALLOWED` (closing needs a reason and evidence). `kata claim` refuses another owner unless `--force`. The default `--ttl` is `0s`, which the help text presents as no expiry [INFERENCE].
- **`tracker.dep-add` and `tracker.dep-remove`.** Variants keyed on `type`. `blocks` becomes `kata edit <id> --blocked-by <dependsOnId>`. `dep-remove` becomes `kata edit <id> --remove-blocked-by <dependsOnId>`, which is idempotent. An undeclared `type` returns `NOT_ALLOWED` with a reason (REQ-005 AC-005-3).
- **`tracker.label`.** Kata attaches exactly one label per call and the response carries a singular `label` key (`{issue, label, event, changed}`); two calls on one issue yield `issue.labels: ["blocked","needs-review"]`. There is no bulk, batch, or multi-id form anywhere in the CLI. A `${ids}` placeholder expands to one argv element (`resolveArg`, `runner.js:356`) and the runner has no loop, so the capability can label one item per call (Open Question 12). Kata has `add` and `rm` but no replace, so replace semantics are not expressible. Outputs carry no `id`, so `parse` is omitted.
- **`tracker.create` and `tracker.create-detailed`.** `kata create <title> --body <description> --json`. Kata has no type flag, so `type` is not sent. Conformance does not require every input to be used; `validate.js:526-625` checks only that placeholders are declared inputs. `create-detailed` adds `--priority` and `--meta ensemble_external_key=<externalKey>`. Its `labels` input is multi-valued and kata's `--label` repeats, but a single placeholder yields one argv element, so multi-label creation is not expressible (Open Question 12). The adapter never passes `--force-new` or `--idempotency-key`. A look-alike refusal (exit 5) surfaces as `TOOL_FAILED`, and nothing retries automatically.
- **`tracker.find-by-key`.** Maps to `kata list --status all --limit 0 --meta ensemble_external_key=<key> --json`. Capture confirms `list --meta k=v` filters exactly: a matching key returned one issue, a non-matching key returned zero. The caller still re-checks equality, as `tracker-findings.js` does (`matchKey`, `:196`), because an exact filter is not an exact-match guarantee. `kata search` matches words, not keys, so it is not a dedupe lookup. There is no `kata find-by-key` subcommand.
- **`tracker.list` and the filter.** The base template lists all statuses, as beads' `br list --all` does, because the analyzer's closed-dependency test needs closed ids. `filter: open` selects an `--status open` variant (`selectTemplate`, `runner.js:421`; the same mechanism `tracker.set-status` uses on `status`). Unknown values return `NOT_ALLOWED`. A fixed argv ignores the input; beads' `tracker.list` and jira's both ignore `filter` today.
- **`tracker.update` (required).** Its single opaque `fields` input must name one kata field. `--body` replaces the issue description, which other callers read. Beads maps the same input to replace-notes, and jira to `--summary`. `refine-beads` calls `tracker.update` as shipped and depends on replace-notes (`packages/development/skills/adapter-tracker-beads/SKILL.md:126-128`). Callers that need history use `tracker.comment` or `tracker.update-detailed`.
- **`tracker.update-detailed`.** One invocation: `kata edit <id> --title ... --body ... --priority ... --comment <notes>` (`--comment` appends after the mutation, `kata edit --help`). Priority `-` clears it.
- **`tracker.comment` and `tracker.comments`.** Maps to `kata comment <id> -m <text>`: the ref is the only positional and the message is passed with `-m`, confirmed by the CLI rejecting a second positional with exit 2, `accepts 1 arg(s), received 2`. Comments come from `kata show <id> --json`, which returns `comments` plus a `comments_truncated` flag; the per-comment field names inside each entry were not captured. `comment-list.json` requires `comments`.
- **`tracker.stage-export` and `tracker.sync`.** Kata has no export or flush command. `tracker.stage-export` has a fallback, so it must be declared (AC-001-4); see Open Question 8. `tracker.sync` has no fallback and is omitted.
- **Status vocabulary.** The normalized status enum has no `pending` or `done` (`work-item.json:29`; `tracker.yaml:77`).
- **Read cost.** Confirmed: `list` items do not carry `links` — only `show` does, and only per issue. So `plan` and `graph-health` must make one `tracker.show` per item under a shared deadline; this is no longer an open question but a fixed property of the read path.
- **Two readiness rules.** `kata ready` also excludes items scheduled for a future date or marked someday (`kata ready --help`). The analyzer's readiness test uses only the closed-dependency rule (`readyItemsFromDeps`, `builtin/work-graph-links-fallback.js:211-219`). `plan` therefore includes scheduled and someday items. The TRD keeps that behavior and documents it, rather than adding a second rule.
- **Shape evidence.** Write-side and read-side kata JSON shapes were captured live on 2026-11-14 against v0.23.0: `create`, `create` with a repeated key, `edit --blocked-by`, `close`, `close --evidence`, `label add`, `claim`, `comment` attempt, `show`, `list`, `list --meta`, `ready`, `status`, `events`, plus four error paths. Key names not covered by that capture remain [UNVERIFIED] and are marked as such.

### Open Questions for the PRD

Each item names a PRD assertion and what shipped code or the backing tool shows. Tables above reference these numbers.

1. **Contract bumps (Technical Constraints, "either contract version is a requirements change to this PRD") — recorded by the architecture owner on 2026-11-14.** This design bumps tracker 1.0 to 1.1, now landed, and work-graph 2.0 to 2.1, not yet landed. The PRD states that any bump to either contract is a requirements change, so the PRD owns recording them; A1 proposed folding both into a single amendment covering `tracker.label-one` and the `owner` field; the amendment actually landed covers `tracker` only, so `work-graph` is still at 2.0. The shipped `tracker` contract and `docs/toolchain/contracts/tracker.md` now read `1.1`; `work-graph` stays at `2.0` until its own amendment lands. The kata manifest declares the versions it was actually tested against.
2. **The deletion and "no adapter interface" assertions are not in v1.2.0.** A grep for "delet" finds only AC-013-3 ("Given a kata project, when its toolchain configuration is deleted") and the `PRD-2026-87e64cc6` precedent row in Relationship to Existing PRDs. No assertion says no adapter interface exists; line 33 credits PRD-2026-8d825f54 with the capability-contract layer. The decision to drop the deletion therefore has no PRD text to change. Record that decision in the Relationship to Existing PRDs table, beside the `PRD-2026-87e64cc6` row.
3. **REQ-001 "a configuration act and nothing else".** Selecting kata needs engine edits: the resolver's capability test and source fix (`work-graph-resolve.js:77-84`), provider dispatch, the analyzer's graph-health, and preflight ordering. Restate REQ-001 to include these, or accept them as part of the adapter's delivery.
4. **REQ-004 clarification, `pending` and `done` (REQ-004 "Clarification (resolved 2026-11-13)").** The clarification maps `pending` and `done` to open and closed, and the normalized status enum is open, in_progress, closed (`work-item.json:29`; `tracker.yaml:77`). Remove the sentence, or define where those values originate. Kata adds a further wrinkle here: `in_progress` is ownership-derived rather than a kata status (TRD-012), so the derived reading is what AC-004-2 is written against.
5. **REQ-004 AC-004-2 and the normalized status.** An owned, open item is the PRD's in-progress state. `statusMap` reads only the raw `status`, so `tracker.show` reports `open` for a claimed item, and `tracker.set-status` to in_progress returns `status: open`. Setting `open` is `kata unassign`, which clears any owner. The PRD should state the in_progress return value, and whether resetting to open refuses to clear another actor's claim.
6. **REQ-003 AC-003-2 against AC-004-3.** AC-003-2 refuses a close without a reason. AC-004-3 expects `tracker.set-status` to closed to read back closed. Kata closes only with a reason and evidence, and set-status carries neither. This design returns `NOT_ALLOWED`. AC-004-3 needs rewording.
7. **Required `tracker.close` (REQ-001, AC-001-4).** It is required, takes `id` only (`tracker.yaml:33-38`), and cannot succeed on kata without evidence. Decide whether a declared, always-refused required capability satisfies REQ-001, or whether required closure is exempt.
8. **`tracker.stage-export` (AC-001-4, AC-006-1).** Kata has no export command (`kata --help`). AC-001-4 requires declaring any capability whose contract names a fallback. A declaration needs a `run` template, and the mapping grammar has no constants. Options: a `provider: unavailable` returning the contract's in-band status (`tracker.yaml:91`), or accepting the documented fallback. AC-006-1 requires the result to come from the adapter, which the fallback does not satisfy.
9. **Graph answers are computed, not native.** Kata has no plan or graph-health command. REQ-007 and AC-006-1 say "from the adapter". This design computes both in the shared analyzer over kata's edges and names kata in the envelope's `adapter`. AC-007-4 asks that the "reported ordering source names the kata adapter", but `orderingSource` keeps its method values. Decide whether AC-007-4 means the envelope's `adapter`, or whether `orderingSource` changes value. Separately, `work-graph.yaml:21-27` names `work-graph-links-fallback` for graph-health, while that fallback returns `NOT_ALLOWED` (`builtin/work-graph-links-fallback.js:279-287`). The contract is inconsistent with the PRD's accurate REQ-007 clarification ("ready-listing and planning only").
10. **REQ-002 "Kata's own dedupe mechanism".** Kata has no dedupe-key field on the issue. `--idempotency-key` is a seven-day create-retry guard: the same key with identical fields returns the original issue with `reused: true`; the same key with different fields fails with exit 5 `idempotency_mismatch`, and the error payload names the existing issue (`data.short_id`, `data.qualified_id`). Identity lookup therefore relies on the `ensemble_external_key` metadata, which `list --meta ensemble_external_key=<key>` filters exactly (capture, 2026-11-14). `kata search` matches words, not keys. The PRD should name the metadata key it relies on.
11. **AC-008-2 (`type` and `priority`).** Kata has no type field (`kata create --help`, `kata edit --help`). Priority is numeric 0 to 4 in the help text, while `work-item.json:32-34` requires a string, and the mapping engine cannot cast types. Beads already leaves priority unmapped for this reason. As written, AC-008-2 cannot be met for these two fields on kata.
12. **AC-004-1 (labels on several items) and multi-label creation — decided (A1).** Shipped `tracker.label` takes `ids` (`tracker.yaml:68-74`). Kata labels one ref per call and the runner has no loop, so the architecture owner chose the second option: add a single-item `tracker.label-one` capability to tracker contract 1.1 and have callers iterate per id, rather than change `tracker.label` inputs, which 1.x cannot do. `tracker.create-detailed` takes `labels` in one call, which kata still cannot express for more than one label; that remains open and is not solved by this decision.
13. **Goal 5 against jira.** Goal 5 ("A project that never hears about the new backend sees zero behavior change") says a project that never hears about kata sees zero behavior change. Under this design, a jira project's `work-graph.graph-health` changes from `NOT_ALLOWED` to a computed result with `dependencyAware: false`, because the built-in analyzer gains graph-health. The non-goal at line 278 says jira stays off the graph path. Decide whether the built-in keeps refusing when the tracker supplies no dependency data, or amend Goal 5 and the non-goal.
14. **List class (REQ-017) and truncation (REQ-016).** The REQ-017 bound text ("The bound is per capability, not one global figure") holds "listing" to the short bound. Kata's list reads the whole backlog (`--limit 0`), and `kata ready` has no cap, so the class for list needs a decision. REQ-016 has no truncation AC; the rule lives only implicitly in REQ-017 AC-017-3. State it as an AC.
15. **Preflight mechanics (AC-018-2, AC-001-2).** AC-018-2 requires that no call the old version cannot serve be made, but shipped health checks run concurrently (`preflight.js:184-186`). AC-001-2 requires preflight to report the backing tool's version, but `runPreflight` returns no version (`preflight.js:196-197`). Both are new mechanics in this design, not shipped behavior.
16. **REQ-009 count (RISK flag on REQ-009).** The flag says 1,114 occurrences of the beads-specific command name across 248 tracked files. `git grep` on this branch finds 1,200 occurrences in 249 files. Update the figure, or state its counting rule.

## Master Task List

Reuse rule: no task re-creates the toolchain abstraction; each task that extends shipped machinery names its file and narrow extension in Target Files and Implementation AC.

### PR 1: Kata resolves, preflights, and refuses unsafe workspaces

**Shippable State:** After this PR, a project that sets `tracker: kata` in its toolchain configuration has both the tracker and work-graph categories resolve to kata, `toolchain-cli preflight` reports the kata version, and an absent, too-old, or unbound kata stops preflight with a named message before any work item is written; projects without kata configuration see no change.

- [ ] **TRD-001** Scratch kata workspace harness, recorded kata JSON fixtures, and a named absent-tool skip guard (3h) [satisfies REQ-016] [satisfies REQ-012]
  **Validates PRD ACs:** AC-012-1, AC-016-1, AC-016-3
  - Target Files: `packages/development/tests/helpers/kata-guard.js`, `packages/development/tests/helpers/kata-scratch.js`, `packages/development/tests/fixtures/kata/`
  - Implementation AC:
    - [ ] Given the kata binary is absent from PATH, when a kata-dependent test runs through the guard, then the test is reported skipped with reason "tool absent" and the run does not fail.
    - [ ] Given the kata binary is present, when the harness creates a scratch workspace, then it binds that workspace under an isolated KATA_HOME and never reads or writes a real project.
    - [ ] Given a scratch workspace with seeded items, when the harness runs list, show, ready and status, then their JSON envelopes are recorded as fixtures that every later mapping task reads.
    - [ ] Given a test finishes, when the harness tears down, then the scratch workspace and its daemon state are removed.

- [ ] **TRD-001-TEST** Verify the harness skip guard and scratch isolation (2h) [verifies TRD-001] [satisfies REQ-016] [satisfies REQ-012] [depends: TRD-001]
  **Validates PRD ACs:** AC-012-1, AC-016-1, AC-016-3
  - Target Files: `packages/development/tests/kata-harness.test.js`
  - Test AC:
    - [ ] Happy: Given kata is absent, when the guarded suite runs, then it exits 0 and every guarded check is listed as skipped with reason "tool absent".
    - [ ] Edge: Given kata is present, when the guarded suite runs, then no check is reported skipped and a deliberately failing kata assertion fails the run.
    - [ ] Edge: Given a guarded check has no kata behavior to assert, when the run completes, then that check is not counted as a passing kata test.

- [ ] **TRD-002** Kata adapter manifest: tracker and work-graph categories, contract versions, binary, allowlist, env names, health probe, and no detection (5h) [satisfies REQ-001]
  **Validates PRD ACs:** AC-001-1
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`, `packages/development/skills/adapter-tracker-kata/SKILL.md`
  - Implementation AC:
    - [ ] Given the manifest, when it is read, then categories lists tracker and work-graph, contract pins tracker 1.0 and work-graph 2.0, and binaries lists kata.
    - [ ] Given the manifest allowlist, when it is read, then every kata subcommand used by a mapped capability appears under bin kata and no shell form is declared.
    - [ ] Given the manifest env block, when it is read, then it names KATA_SERVER and KATA_AUTH_TOKEN as variable names only and holds no values.
    - [ ] Given the manifest health block, when preflight runs it, then kata --version is the probe and its output is the version source.
    - [ ] Given the manifest detect block, when detection evaluates candidates, then it is empty so kata is never a detection candidate.

- [ ] **TRD-002-TEST** Verify kata resolves both categories from one configuration value (3h) [verifies TRD-002] [satisfies REQ-001] [depends: TRD-002] [depends: TRD-001]
  **Validates PRD ACs:** AC-001-1, AC-013-2
  - Target Files: `packages/development/tests/kata-manifest.test.js`
  - Test AC:
    - [ ] Happy: Given a project whose toolchain configuration names kata and sets no work-graph override, when the tracker and work-graph categories resolve, then both resolve to kata and each reports a project-config source rather than the shipped default.
    - [ ] Edge: Given the same project with work-graph set explicitly to the links fallback, when resolution runs, then work-graph resolves to the fallback and tracker still resolves to kata.
    - [ ] Happy: Given the shipped kata manifest, when its detect list is read, then it is empty, so detection can never select kata and kata is chosen only by explicit configuration.

- [ ] **TRD-003** Preflight minimum-version gate at kata 0.23.0, version reporting on pass, and contract-major check on resolution (4h) [satisfies REQ-018] [satisfies REQ-001] [depends: TRD-002]
  **Validates PRD ACs:** AC-018-2, AC-001-2
  - Target Files: `packages/development/lib/toolchain/preflight.js`, `packages/development/lib/toolchain/adapters.js`, `packages/development/toolchain/schemas/adapter-manifest-schema.json`, `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given the kata manifest declares a minimum version of 0.23.0, when preflight reads kata --version reporting an older version, then preflight fails naming the minimum version and issues no further kata call.
    - [ ] Given kata --version reports 0.23.0 or later, when preflight passes, then its record carries the reported version.
    - [ ] Given a declared contract major for tracker or work-graph that does not match the category definition, when the adapter resolves, then resolution refuses on the major mismatch.

- [ ] **TRD-003-TEST** Verify the version floor and version reporting with an old and a current binary (2h) [verifies TRD-003] [satisfies REQ-018] [satisfies REQ-001] [depends: TRD-003]
  **Validates PRD ACs:** AC-018-2, AC-001-2
  - Target Files: `packages/development/tests/kata-preflight.test.js`
  - Test AC:
    - [ ] Happy: Given kata 0.23.0 on PATH, when preflight runs, then it passes and its record names the reported version.
    - [ ] Edge: Given a stub kata reporting 0.22.9, when preflight runs, then it fails naming 0.23.0 and the stub records no invocation beyond the version probe.

- [ ] **TRD-004** Preflight binding gate: an unbound workspace stops before any work item is written, and capabilities not reported by preflight are refused (3h) [satisfies REQ-018] [depends: TRD-002]
  **Validates PRD ACs:** AC-018-1, AC-018-3
  - Target Files: `packages/development/lib/toolchain/preflight.js`, `packages/development/skills/adapter-tracker-kata/adapter.yaml`, `packages/development/lib/toolchain-cli.js`
  - Implementation AC:
    - [ ] Given the workspace has no kata binding file, when preflight runs the kata binding health check, then it reads binding status from kata doctor --json without starting a daemon and stops with the documented binding prerequisite message.
    - [ ] Given preflight passed, when the flow runs, then every capability it needs was reported available by that preflight, and a capability it did not report is refused before any write.

- [ ] **TRD-004-TEST** Verify the binding gate creates zero items when unbound (3h) [verifies TRD-004] [satisfies REQ-018] [depends: TRD-004]
  **Validates PRD ACs:** AC-018-1, AC-018-3
  - Target Files: `packages/development/tests/kata-preflight.test.js`
  - Test AC:
    - [ ] Happy: Given a bound scratch workspace, when preflight and the TRD flow run, then preflight passes and every needed capability is reported available.
    - [ ] Edge: Given an unbound scratch workspace, when the TRD flow is invoked, then it stops during preflight and the item count before and after is identical.
    - [ ] Edge: Given preflight passed without reporting a write capability, when that capability is requested, then the call is refused before any kata write runs.

- [ ] **TRD-005** Keep kata out of detection and default selection (2h) [satisfies REQ-013] [depends: TRD-002]
  **Validates PRD ACs:** AC-013-1, AC-013-2, AC-013-3, AC-013-4
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`, `packages/development/toolchain/toolchain.default.yaml`, `packages/development/lib/toolchain/detect.js`
  - Implementation AC:
    - [ ] Given a repository with a kata binding file and no toolchain configuration, when the tracker resolves, then it resolves to beads with no detection-derived kata choice recorded.
    - [ ] Given the shipped default configuration, when it is read, then tracker is beads and work-graph is unchanged from today.
    - [ ] Given a kata project whose toolchain configuration is deleted, when the tracker resolves, then it resolves back to beads with no further edits.

- [ ] **TRD-005-TEST** Verify beads stays the default and binding files never select kata (2h) [verifies TRD-005] [satisfies REQ-013] [depends: TRD-005]
  **Validates PRD ACs:** AC-013-1, AC-013-2, AC-013-3, AC-013-4
  - Target Files: `packages/development/tests/kata-detection.test.js`
  - Test AC:
    - [ ] Happy: Given a project with no toolchain configuration, when the tracker resolves, then it resolves to beads and the beads workspace directory is the working tracker.
    - [ ] Edge: Given a kata binding file and no configuration, when the tracker resolves, then it still resolves to beads.
    - [ ] Edge: Given a kata project whose configuration is deleted, when the tracker resolves, then it returns to beads without edits, and the shipped default still reads tracker beads.
    - [ ] Happy: Given the shipped kata manifest, when its detect list is read, then it is empty, so a kata binding file alone cannot make kata a detection candidate.

- [ ] **TRD-006** Named missing-binary diagnosis for kata, silence for non-kata projects, and no fallback to beads after selection (2h) [satisfies REQ-001] [satisfies REQ-012] [depends: TRD-002]
  **Validates PRD ACs:** AC-001-3, AC-012-2, AC-012-3
  - Target Files: `packages/development/lib/toolchain/preflight.js`, `packages/development/lib/toolchain/runner.js`
  - Implementation AC:
    - [ ] Given kata is absent from PATH for a kata project, when preflight runs, then it reports a named missing-binary failure for the kata adapter instead of proceeding.
    - [ ] Given a project that has not selected kata and kata is absent, when preflight runs, then no kata-related failure appears.
    - [ ] Given a kata project whose binary disappears after selection, when preflight runs, then it fails with the missing-binary diagnosis and never falls back to beads.

- [ ] **TRD-006-TEST** Verify the missing-binary diagnosis for kata and silence for non-kata projects (2h) [verifies TRD-006] [satisfies REQ-001] [satisfies REQ-012] [depends: TRD-006]
  **Validates PRD ACs:** AC-001-3, AC-012-2, AC-012-3
  - Target Files: `packages/development/tests/kata-preflight.test.js`
  - Test AC:
    - [ ] Happy: Given kata is absent and a beads project, when preflight runs, then no kata-related failure is reported.
    - [ ] Edge: Given kata is absent and a kata project, when preflight runs, then it fails naming the kata adapter and the missing binary.
    - [ ] Edge: Given a kata project whose binary was present at selection and is removed before preflight, when preflight runs, then the run fails with the missing-binary diagnosis and no beads work item is created.

- [ ] **TRD-031** Resolver reports the project-config source on a tracker-supplied work-graph path (3h) [satisfies REQ-001] [depends: TRD-002]
  **Validates PRD ACs:** AC-001-1
  - Target Files: `packages/development/lib/toolchain/work-graph-resolve.js`
  - Implementation AC:
    - [ ] Given a project config that selects `tracker: kata` and supplies no explicit `work-graph`, when `resolveWorkGraphAdapter` runs, then it returns the resolved adapter and its `source` reports the tracker-supplied origin instead of the literal `default` that resolution reports today.
    - [ ] Given a project config with an explicit `work-graph` value, when `resolveWorkGraphAdapter` runs, then `source` reports the project-config origin and the explicit value wins.
    - [ ] Given neither a tracker selection nor an explicit `work-graph`, when `resolveWorkGraphAdapter` runs, then `source` reports the builtin fallback and behavior is unchanged from shipped.

- [ ] **TRD-031-TEST** Verify resolver source reporting for tracker-supplied, explicit, and fallback paths (3h) [verifies TRD-031] [satisfies REQ-001] [depends: TRD-031]
  **Validates PRD ACs:** AC-001-1
  - Target Files: `packages/development/tests/toolchain-work-graph-resolve.test.js`
  - Test AC:
    - [ ] Happy: Given `tracker: kata` with no explicit `work-graph`, when the resolver runs, then `source` reports the tracker-supplied origin rather than the literal `default`.
    - [ ] Edge: Given an explicit `work-graph` in project config, when the resolver runs, then `source` is the project-config value.
    - [ ] Edge: Given neither tracker nor explicit selection, when the resolver runs, then `source` is `builtin-fallback`.

- [ ] **TRD-032** Resolver gates on declared capabilities and diagnoses a cross-backend work-graph mismatch (3h) [satisfies REQ-001] [satisfies REQ-012] [depends: TRD-002]
  **Validates PRD ACs:** AC-001-1, AC-012-1
  - Target Files: `packages/development/lib/toolchain/work-graph-resolve.js`
  - Implementation AC:
    - [ ] Given a tracker manifest that declares the `work-graph` category but omits any one of `work-graph.ready`, `work-graph.plan`, or `work-graph.graph-health` from `manifest.capabilities`, when the resolver runs, then the tracker does not claim the category and the builtin fallback applies.
    - [ ] Given project config with `tracker: kata` and an explicit `work-graph: beads`, when the resolver runs, then it emits a named diagnostic for the cross-backend mismatch instead of resolving silently.
    - [ ] Given a tracker manifest declaring all three `work-graph.*` capabilities, when the resolver runs, then the tracker claims the category and no diagnostic is emitted.

- [ ] **TRD-032-TEST** Verify the capability gate and the explicit-mismatch diagnostic (3h) [verifies TRD-032] [satisfies REQ-001] [satisfies REQ-012] [depends: TRD-032]
  **Validates PRD ACs:** AC-001-1, AC-012-1
  - Target Files: `packages/development/tests/toolchain-work-graph-resolve.test.js`
  - Test AC:
    - [ ] Happy: Given a manifest declaring all three `work-graph.*` capabilities, when the resolver runs, then the tracker claims the category.
    - [ ] Edge: Given a manifest declaring the category while omitting `work-graph.graph-health`, when the resolver runs, then the category is not claimed.
    - [ ] Edge: Given `tracker: kata` with `work-graph: beads`, when the resolver runs, then a named mismatch diagnostic is emitted and no beads binary is invoked against the kata project.

### PR 2: Kata work items: read, write, dedupe, close with evidence, label, status, and link

**Shippable State:** A user on a kata project runs `toolchain-cli run` for tracker.create-detailed, tracker.find-by-key, tracker.close-with-reason, tracker.label, tracker.set-status and tracker.dep-add, and sees each item, label, owner, evidence and blocking edge in `kata show`, with no call falling back to a beads or links path and the coverage check passing.

- [ ] **TRD-007** Kata read mappings: show returns the normalized item and list honors its open filter without truncation (4h) [satisfies REQ-008] [depends: TRD-002]
  **Validates PRD ACs:** AC-008-1, AC-008-2
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`, `packages/development/lib/toolchain/mapping.js`
  - Implementation AC:
    - [ ] Given a kata item, when tracker.show runs, then title, description, type, status, priority and labels are populated in the normalized shape, with type taken from kata metadata key type when set and otherwise task.
    - [ ] Given open and closed items, when tracker.list runs with an open filter, then closed items are excluded and the filter is applied rather than ignored.
    - [ ] Given more items than the default row cap, when tracker.list runs, then it passes an explicit --limit 0 so no row is silently dropped.

- [ ] **TRD-007-TEST** Verify show normalization and open-filter behavior (3h) [verifies TRD-007] [satisfies REQ-008] [depends: TRD-007]
  **Validates PRD ACs:** AC-008-1, AC-008-2
  - Target Files: `packages/development/tests/kata-reads.test.js`
  - Test AC:
    - [ ] Happy: Given an item with title, body, priority, labels and an owner, when it is read by id, then every normalized field is populated.
    - [ ] Edge: Given one open and one closed item, when tracker.list runs with an open filter, then only the open item is returned.
    - [ ] Edge: Given a workspace holding more items than the default row cap, when tracker.list runs, then the returned count equals the total count.

- [ ] **TRD-008** Comment append and comment listing in the order the comments were written (2h) [satisfies REQ-008] [depends: TRD-002]
  **Validates PRD ACs:** AC-008-3
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given an item, when tracker.comment runs, then the text is appended through kata comment.
    - [ ] Given an item with comments added in a known order, when tracker.comments runs, then the comments come back in that same order from the comments carried by kata show --json.

- [ ] **TRD-008-TEST** Verify comment ordering and the empty case (2h) [verifies TRD-008] [satisfies REQ-008] [depends: TRD-008]
  **Validates PRD ACs:** AC-008-3
  - Target Files: `packages/development/tests/kata-reads.test.js`
  - Test AC:
    - [ ] Happy: Given two comments added in order A then B, when tracker.comments runs, then the result lists A then B.
    - [ ] Edge: Given an item with no comments, when tracker.comments runs, then the result is an empty list and not an error.

- [ ] **TRD-009** Required create and update mappings returning the kata short id (4h) [satisfies REQ-001] [depends: TRD-002]
  **Validates PRD ACs:** AC-001-4
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given a title, description and type, when tracker.create runs, then kata create returns the new item's short id as the capability's id output.
    - [ ] Given an existing item and a set of fields, when tracker.update runs, then kata edit applies title, body, priority and owner and returns the id.

- [ ] **TRD-009-TEST** Verify required create and update round-trip (2h) [verifies TRD-009] [satisfies REQ-001] [depends: TRD-009]
  **Validates PRD ACs:** AC-001-4
  - Target Files: `packages/development/tests/kata-writes.test.js`
  - Test AC:
    - [ ] Happy: Given a created item, when it is read back, then its title and description match the create input.
    - [ ] Edge: Given an update carrying only a priority field, when the item is read back, then its title and body are unchanged.

- [ ] **TRD-010** Dedupe identity: `create-detailed` records the external key durably, and `find-by-key` searches the whole project including closed items (5h) [satisfies REQ-002] [depends: TRD-002] [depends: TRD-033]
  **Validates PRD ACs:** AC-002-1, AC-002-2, AC-002-3
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given an external dedupe key, when tracker.create-detailed runs, then the key is stored as kata metadata ext_key and also sent as the idempotency key for retry safety.
    - [ ] Given an item created with key K, when tracker.find-by-key runs with K, then kata list --status all --limit 0 --meta ext_key=K returns that one item, closed items included, with its ext_key visible so the caller selects the exact match.
    - [ ] Given a create that kata refuses with a conflict, when tracker.create-detailed runs, then the conflict is surfaced as an error and no second item is created.

- [ ] **TRD-010-TEST** Verify dedupe lookup returns exactly the matching item (3h) [verifies TRD-010] [satisfies REQ-002] [depends: TRD-010]
  **Validates PRD ACs:** AC-002-1, AC-002-2, AC-002-3
  - Target Files: `packages/development/tests/kata-writes.test.js`
  - Test AC:
    - [ ] Happy: Given an item created with key K, when find-by-key runs with K, then the single matching item is returned and no other.
    - [ ] Edge: Given a key that matches nothing, when find-by-key runs, then the result is an empty list and not an error.
    - [ ] Edge: Given two items with keys K1 and K2, when find-by-key runs with K1, then only the K1 item is returned.
    - [ ] Note: this file asserts the lookup result only; whether `find-by-key` output validates against a list schema is asserted by TRD-033-TEST, which owns the schema entries.

- [ ] **TRD-011** Close with reason and evidence: close-with-reason records both, and a bare close never closes silently (4h) [satisfies REQ-003] [depends: TRD-002]
  **Validates PRD ACs:** AC-003-1, AC-003-2, AC-003-3
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given an open item and a commit, when tracker.close-with-reason runs with a reason kata accepts, then kata close records the reason and the commit as evidence and reading the item back shows the reason.
    - [ ] Given a close with no reason, when the adapter is invoked, then the call is refused with an observable error and the item stays open.
    - [ ] Given a test command as proof, when the item is closed and read back, then the recorded evidence names that command.
    - [ ] Given the required tracker.close is invoked with only an id, when it runs, then its mandatory reason and evidence placeholders refuse the call with INVALID_ARG naming tracker.close-with-reason rather than closing the item.

- [ ] **TRD-011-TEST** Verify reason and evidence on close, and refusal without them (3h) [verifies TRD-011] [satisfies REQ-003] [depends: TRD-011]
  **Validates PRD ACs:** AC-003-1, AC-003-2, AC-003-3
  - Target Files: `packages/development/tests/kata-writes.test.js`
  - Test AC:
    - [ ] Happy: Given an open item and a commit sha, when it is closed with a reason, then reading it back shows closed with that reason.
    - [ ] Edge: Given an open item and no reason, when a close is requested, then the call fails observably and the item remains open.
    - [ ] Edge: Given a test command as evidence, when the item is read back, then the evidence names that command.

- [ ] **TRD-012** Labels one id per call through `tracker.label-one`, and derives lifecycle status and in-progress ownership from the `owner` field (5h) [satisfies REQ-004] [depends: TRD-002] [depends: TRD-033]
  **Validates PRD ACs:** AC-004-1, AC-004-2, AC-004-3
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`, `packages/development/lib/toolchain/mapping.js`
  - Implementation AC:
    - [ ] Given three items sharing a title prefix, when `tracker.label-one` is called once per id, then kata `label add` attaches the label to each id, and removal uses kata `label rm`.
    - [ ] Given an open unowned item, when tracker.set-status sets in_progress, then kata claim runs and the item reads back owned and open with its owner reported.
    - [ ] Given a claimed item, when status is set back to open, then kata unassign clears the owner so the item reads open and unowned.
    - [ ] Given an open item with no recorded reason and evidence, when tracker.set-status sets closed, then the call is refused naming tracker.close-with-reason, as AC-004-3 is amended by TRD-027.
    - [ ] Given kata status carries only open or closed, when in_progress is read, then the mapping derives it from a non-empty owner on an open item through one narrow rule added to mapping.js.

- [ ] **TRD-012-TEST** Verify label sweeps and the ownership-derived in-progress state (3h) [verifies TRD-012] [satisfies REQ-004] [depends: TRD-012]
  **Validates PRD ACs:** AC-004-1, AC-004-2, AC-004-3
  - Target Files: `packages/development/tests/kata-writes.test.js`
  - Test AC:
    - [ ] Happy: Given three items sharing a title prefix, when `tracker.label-one` is applied to each of the three ids in turn, then reading each item back shows the label.
    - [ ] Edge: Given an open unowned item, when status is set to in_progress, then it reads back as owned and open and its owner is reported.
    - [ ] Edge: Given an open item with no reason and no evidence, when status is set to closed through the status capability, then the call is refused and the item stays open, as amended AC-004-3 requires.
    - [ ] Note: the `owner` field's presence in the normalized shape is asserted by TRD-034-TEST, which owns that field; this file reads it.

- [ ] **TRD-013** Dependency links through kata's blocked-by edge, with non-gating link kinds refused (3h) [satisfies REQ-005] [depends: TRD-002]
  **Validates PRD ACs:** AC-005-1, AC-005-2, AC-005-3
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given two open items A and B, when tracker.dep-add makes A blocked by B, then kata edit A --blocked-by B runs and A leaves the ready listing while B remains open.
    - [ ] Given that link, when tracker.dep-remove runs, then kata edit A --remove-blocked-by B runs and A reappears in the ready listing.
    - [ ] Given a link kind with no blocking equivalent, such as related or parent, when tracker.dep-add is invoked with it, then the call is refused with a reason and no blocking edge is created.

- [ ] **TRD-013-TEST** Verify blocking edges remove and restore readiness (3h) [verifies TRD-013] [satisfies REQ-005] [depends: TRD-013]
  **Validates PRD ACs:** AC-005-1, AC-005-2, AC-005-3
  - Target Files: `packages/development/tests/kata-writes.test.js`
  - Test AC:
    - [ ] Happy: Given open items A and B, when A is made blocked by B, then A is absent from the ready listing and B is present.
    - [ ] Happy: Given that link, when it is removed, then A reappears in the ready listing.
    - [ ] Edge: Given a related-kind link request, when dep-add is invoked, then it is refused with a reason and the ready listing is unchanged.

- [ ] **TRD-014** Native answers for update-detailed, stage-export and sync, so no fallback fires for kata (4h) [satisfies REQ-006] [depends: TRD-002]
  **Validates PRD ACs:** AC-006-1
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given a title, description, priority and note, when tracker.update-detailed runs, then kata edit applies them with --comment for the note and leaves labels and status untouched.
    - [ ] Given a kata project has no exported tracked file, when tracker.stage-export runs, then the adapter answers with the contract's unavailable status itself, so the full-export fallback is not reached.
    - [ ] Given kata persists each write before its command returns, when tracker.sync runs, then the adapter answers with a synced status without invoking any fallback.

- [ ] **TRD-014-TEST** Verify every fallback-bearing tracker capability answers from kata (3h) [verifies TRD-014] [satisfies REQ-006] [depends: TRD-014] [depends: TRD-010] [depends: TRD-011] [depends: TRD-012]
  **Validates PRD ACs:** AC-006-1
  - Target Files: `packages/development/tests/kata-fallback.test.js`
  - Test AC:
    - [ ] Happy: Given a kata project, when each optional fallback-bearing tracker capability (label, stage-export, create-detailed, find-by-key, update-detailed, close-with-reason) is invoked, then each result names kata as its source.
    - [ ] Edge: Given the links fallback and title-prefix scoping exist in the shipped contract, when a kata capability is invoked, then no call is routed to a fallback id.

- [ ] **TRD-015** Coverage assertion: the kata manifest declares every required capability and every fallback-bearing capability of both contracts (3h) [satisfies REQ-001] [satisfies REQ-015] [depends: TRD-002] [depends: TRD-007] [depends: TRD-008] [depends: TRD-009] [depends: TRD-010] [depends: TRD-011] [depends: TRD-012] [depends: TRD-013] [depends: TRD-014]
  **Validates PRD ACs:** AC-001-4, AC-015-2
  - Target Files: `packages/development/lib/toolchain/validate.js`, `packages/development/tests/kata-coverage.test.js`
  - Implementation AC:
    - [ ] Given the tracker and work-graph contract files, when the kata manifest is compared, then every required capability and every capability naming a fallback is declared by kata.
    - [ ] Given a required capability is removed from the kata manifest, when the coverage check runs, then it fails naming the missing capability.

- [ ] **TRD-015-TEST** Verify coverage passes for kata and fails on removal (2h) [verifies TRD-015] [satisfies REQ-001] [satisfies REQ-015] [depends: TRD-015]
  **Validates PRD ACs:** AC-001-4, AC-015-2
  - Target Files: `packages/development/tests/kata-coverage.test.js`
  - Test AC:
    - [ ] Happy: Given the shipped kata manifest, when coverage is compared to the tracker and work-graph contracts, then no required capability is missing.
    - [ ] Edge: Given a mutated copy of the manifest with one required capability removed, when coverage is compared, then the assertion fails naming that capability.

- [ ] **TRD-033** Normalized schema entries for the non-entity kata capabilities (3h) [satisfies REQ-008] [depends: TRD-002]
  **Validates PRD ACs:** AC-008-1
  - Target Files: `packages/development/lib/toolchain/contracts.js`, `scripts/tests/fixtures/toolchain/adapter-tracker-kata-samples/`
  - Implementation AC:
    - [ ] Given `tracker.find-by-key`, when its output is validated, then a list schema is declared for it rather than falling back to the work-item entity schema.
    - [ ] Given `tracker.label` or `tracker.label-one`, when its output is validated, then a non-entity result schema applies and the run is not rejected as `BAD_OUTPUT` for lacking entity fields.
    - [ ] Given a recorded kata fixture for each newly declared capability, when the adapter's normalizer runs against the fixture, then the result validates against the declared schema.

- [ ] **TRD-033-TEST** Verify schema selection for every declared kata capability (3h) [verifies TRD-033] [satisfies REQ-008] [depends: TRD-033]
  **Validates PRD ACs:** AC-008-1
  - Target Files: `packages/development/tests/toolchain-contracts.test.js`
  - Test AC:
    - [ ] Happy: Given the kata manifest's declared capability set, when the contract validator runs, then every capability resolves to a normalized schema and none falls back to the entity schema unannounced.
    - [ ] Edge: Given `tracker.find-by-key` returning a captured list envelope, when the normalizer runs, then it validates and does not report `BAD_OUTPUT`.
    - [ ] Edge: Given a declared capability with no schema entry, when the validator runs, then it reports the missing entry by capability name.

- [ ] **TRD-034** Name `owner` in the normalized work-item shape (3h) [satisfies REQ-004] [satisfies REQ-008] [depends: TRD-002]
  **Validates PRD ACs:** AC-004-2, AC-008-2
  - Target Files: `scripts/tests/fixtures/toolchain/work-item.json`, `packages/development/lib/toolchain/mapping.js`
  - Implementation AC:
    - [ ] Given the normalized work-item schema, when it is read, then it declares an `owner` property rather than admitting one only through `additionalProperties`.
    - [ ] Given a kata item carrying a claim, when `tracker.show` normalizes it, then `owner` carries the claiming identity and `tracker.set-status` reports the same value.
    - [ ] Given an unowned open kata item, when `tracker.show` normalizes it, then `owner` is absent and the status reads `open`.

- [ ] **TRD-034-TEST** Verify `owner` is a declared field and reads back through both paths (3h) [verifies TRD-034] [satisfies REQ-004] [satisfies REQ-008] [depends: TRD-034]
  **Validates PRD ACs:** AC-004-2, AC-008-2
  - Target Files: `packages/development/tests/toolchain-normalized-item.test.js`
  - Test AC:
    - [ ] Happy: Given an item fixture carrying an owner, when it validates, then `owner` is recognized as a declared property.
    - [ ] Edge: Given a normalized item with no `owner` property at all, when it validates, then validation still passes, so absence is not an error.
    - [ ] Edge: Given the schema file, when it is inspected, then `owner` appears under `properties` and not solely through `additionalProperties`.

### PR 3: Dependency-aware pickup on kata

**Shippable State:** On a kata project, `toolchain-cli run work-graph.ready`, `work-graph.plan` and `work-graph.graph-health` list unblocked work in kata's own order, put dependencies first, report cycles and dangling links as findings, and name kata as their source.

- [ ] **TRD-016** Dispatch for work-graph capabilities computed in-process, through one resolver-owned path (6h) [satisfies REQ-007] [depends: TRD-002]
  **Validates PRD ACs:** AC-006-2
  - Target Files: `packages/development/lib/toolchain/work-graph-resolve.js`, `packages/development/lib/toolchain-cli.js`, `packages/development/lib/toolchain/preflight.js`, `packages/development/lib/toolchain/adapters.js`, `packages/development/toolchain/schemas/adapter-manifest-schema.json`
  - Implementation AC:
    - [ ] Given a manifest capability declaring an in-process module path, when the work-graph category runs that capability, then the module loads only from inside the adapter's own directory and a path outside it is refused before any code loads.
    - [ ] Given a resolved work-graph adapter, when resolve, explain, run, preflight or confirm-status is invoked, then every call site dispatches through the same resolver-owned function and the builtin links path is unchanged.
    - [ ] Given a declarative capability such as work-graph.ready, when it runs, then it still goes through runCapability with the shipped allowlist, timeout and envelope unchanged.

- [ ] **TRD-016-TEST** Verify module dispatch confinement and the unchanged builtin path (3h) [verifies TRD-016] [satisfies REQ-006] [satisfies REQ-007] [depends: TRD-016]
  **Validates PRD ACs:** AC-006-2
  - Target Files: `packages/development/tests/work-graph-dispatch.test.js`
  - Test AC:
    - [ ] Happy: Given work-graph set to auto with a kata tracker, when the work-graph category resolves, then it names kata and not the built-in links analyzer.
    - [ ] Edge: Given a module path that escapes the adapter directory, when dispatch runs, then it is refused before any code loads.
    - [ ] Edge: Given a project on the shipped jira tracker, when work-graph resolves, then the builtin links analyzer answers exactly as before.

- [ ] **TRD-017** Kata edge export and ready-work listing from kata's own ready command (4h) [satisfies REQ-007] [depends: TRD-002]
  **Validates PRD ACs:** AC-007-1
  - Target Files: `packages/development/skills/adapter-tracker-kata/adapter.yaml`, `packages/development/skills/adapter-tracker-kata/work-graph-module.js`
  - Implementation AC:
    - [ ] Given item C blocked by open item B, when work-graph.ready runs, then kata ready --json --limit 0 returns the unblocked items in kata's listing order and C is absent.
    - [ ] Given an unchanged item set, when work-graph.ready runs twice, then the two sequences are identical.
    - [ ] Given the list envelope, when edges are normalized, then each item's blocking links populate its dependencies, using per-item kata show --json only if the list envelope omits them, as the TRD-001 fixture decides.

- [ ] **TRD-017-TEST** Verify ready listing excludes blocked work and is stable (3h) [verifies TRD-017] [satisfies REQ-007] [depends: TRD-017]
  **Validates PRD ACs:** AC-007-1
  - Target Files: `packages/development/tests/kata-edges.test.js`
  - Test AC:
    - [ ] Happy: Given open items A and B with C blocked by B, when ready work is listed, then C is absent and A and B are present in kata's order.
    - [ ] Edge: Given an unchanged item set, when ready work is listed twice, then both results are identical.
    - [ ] Edge: Given a workspace with more ready items than the default row cap, when ready work is listed, then every ready item is returned.

- [ ] **TRD-018** Shared pure edge scan: dependency-first order, cycle findings, and dangling-edge findings (4h) [satisfies REQ-007]
  **Validates PRD ACs:** AC-007-2, AC-007-3, AC-007-5
  - Target Files: `packages/development/lib/toolchain/work-graph-scan.js`
  - Implementation AC:
    - [ ] Given items with dependency links, when the scan orders them, then every item appears after every item it depends on.
    - [ ] Given a cycle among items, when the scan runs, then the cycle is returned as a finding and its members are never presented as silently ordered.
    - [ ] Given a link naming an id absent from the scanned scope, when the scan runs, then that dangling edge is returned as a finding.

- [ ] **TRD-018-TEST** Verify ordering, cycle findings, and dangling-edge findings on fixed graphs (2h) [verifies TRD-018] [satisfies REQ-007] [depends: TRD-018]
  **Validates PRD ACs:** AC-007-2, AC-007-3, AC-007-5
  - Target Files: `packages/development/tests/work-graph-scan.test.js`
  - Test AC:
    - [ ] Happy: Given a chain where A depends on B and B depends on C, when the scan orders the items, then C precedes B and B precedes A.
    - [ ] Edge: Given a two-item cycle, when the scan runs, then it reports one cycle finding naming both items.
    - [ ] Edge: Given an item depending on an id outside the scope, when the scan runs, then it reports a dangling-edge finding for that id.

- [ ] **TRD-019** Kata work-graph plan and graph-health built on the shared scan, reporting kata as source (4h) [satisfies REQ-007] [depends: TRD-016] [depends: TRD-017] [depends: TRD-018]
  **Validates PRD ACs:** AC-007-2, AC-007-3, AC-007-4, AC-007-5
  - Target Files: `packages/development/skills/adapter-tracker-kata/work-graph-module.js`, `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given a kata project, when work-graph.plan runs, then the result names the kata adapter as orderingSource and reports dependencyAware true.
    - [ ] Given a cycle introduced into the item set, when work-graph.graph-health runs, then the cycle is reported as a finding and plan does not order the cycle silently.
    - [ ] Given a dependency naming an item the scope never returns, when work-graph.graph-health runs, then that dangling edge is reported as a finding.

- [ ] **TRD-019-TEST** Verify plan and graph-health end to end on kata (3h) [verifies TRD-019] [satisfies REQ-007] [depends: TRD-019]
  **Validates PRD ACs:** AC-007-2, AC-007-3, AC-007-4, AC-007-5
  - Target Files: `packages/development/tests/kata-work-graph.test.js`
  - Test AC:
    - [ ] Happy: Given a scratch kata project with a chain of three items, when plan runs, then each item appears after its dependencies and the source names kata.
    - [ ] Edge: Given a cycle created in the scratch project, when graph-health runs, then the cycle is a finding and the plan output lists the cycle members as unordered.
    - [ ] Edge: Given a dangling link to an id outside the scope, when graph-health runs, then it is listed as a finding.

### PR 4: Backend-neutral TRD-to-tasks command

**Shippable State:** `ensemble:implement-trd-tasks <trd>` on a kata project scaffolds the TRD's work items in kata with dependency edges and a ready list, `ensemble:implement-trd-beads` prints a message naming the replacement, and beads runs produce the same titles, edges and phases as before.

- [ ] **TRD-020** Rename the TRD-to-work-items command to implement-trd-tasks with every phase and argument kept, after recording golden fixtures from the current command (5h) [satisfies REQ-009] [satisfies REQ-010]
  **Validates PRD ACs:** AC-010-1, AC-010-2, AC-010-3
  - Target Files: `packages/development/commands/implement-trd-beads.yaml`, `packages/development/commands/implement-trd-tasks.yaml`, `packages/development/tests/fixtures/implement-trd/`
  - Implementation AC:
    - [ ] Given the current command and a beads project, when the golden fixtures are recorded before any edit, then plan-only, unattended execution, branch selection, status, single-task reset, backlog listing, workstream generation and external-runner delegation outputs are stored as golden files.
    - [ ] Given the renamed command, when each phase is invoked (--plan, --execute, --branch, --use-current-branch, --status, --reset-task, --list, max parallel N, --foreman, --workstream), then it is accepted and reaches the same handling as before.
    - [ ] Given a plan-only invocation, when it completes, then the completion message names implement-trd-tasks for the execute step.
    - [ ] Given the rename, when the old command file is deleted, then no alias or hidden entry for implement-trd-beads is kept.

- [ ] **TRD-020-TEST** Verify the renamed command preserves every phase against golden fixtures (4h) [verifies TRD-020] [satisfies REQ-009] [satisfies REQ-010] [depends: TRD-020]
  **Validates PRD ACs:** AC-010-1, AC-010-2, AC-010-3
  - Target Files: `packages/development/tests/implement-trd-tasks-parity.test.js`
  - Test AC:
    - [ ] Happy: Given a beads project and the same TRD and arguments, when the renamed command runs, then its work-item titles, dependency edges and phase grouping match the golden fixtures byte for byte.
    - [ ] Edge: Given a plan-only invocation, when it completes, then its completion text names implement-trd-tasks for execution.
    - [ ] Edge: Given an unrecognized phase argument, when the command is invoked, then it reports the argument as unknown instead of silently running a default phase.

- [ ] **TRD-021** Dispatcher routes the implement keyword to the new command and rejects the retired name with its replacement named (3h) [satisfies REQ-009] [depends: TRD-020]
  **Validates PRD ACs:** AC-009-3, AC-009-4
  - Target Files: `packages/development/commands/trd.yaml`
  - Implementation AC:
    - [ ] Given a user invokes the retired implement-trd-beads name, when the dispatcher resolves it, then it prints an unrecognized-command message naming implement-trd-tasks and does not fall through to any other command.
    - [ ] Given the TRD dispatcher implement keyword, when it is dispatched, then it routes to implement-trd-tasks and its text no longer states that beads project management is in use.

- [ ] **TRD-021-TEST** Verify retired-name rejection and keyword routing (2h) [verifies TRD-021] [satisfies REQ-009] [depends: TRD-021]
  **Validates PRD ACs:** AC-009-3, AC-009-4
  - Target Files: `packages/development/tests/trd-dispatcher-retired-name.test.js`
  - Test AC:
    - [ ] Happy: Given the implement keyword, when the dispatcher runs, then it reaches implement-trd-tasks.
    - [ ] Edge: Given the retired command name, when it is dispatched, then the message names implement-trd-tasks and no other command runs.

- [ ] **TRD-022** Scaffold routing through toolchain capabilities so a kata run never invokes br or bv (6h) [satisfies REQ-009] [depends: TRD-020] [depends: TRD-010] [depends: TRD-013] [depends: TRD-016]
  **Validates PRD ACs:** AC-009-1
  - Target Files: `packages/development/commands/implement-trd-tasks.yaml`, `packages/development/lib/scaffold-planner.js`, `packages/development/lib/trd-cli.js`
  - Implementation AC:
    - [ ] Given a kata project and a TRD, when the command scaffolds, then work items are created through tracker.create-detailed and dependency edges through tracker.dep-add.
    - [ ] Given a kata project, when the command runs its ready and plan steps, then they call work-graph.ready and work-graph.plan through toolchain-cli.
    - [ ] Given a kata project, when the whole run completes, then no beads binary is invoked at any step.

- [ ] **TRD-022-TEST** Verify a kata run scaffolds in kata and never invokes a beads binary (4h) [verifies TRD-022] [satisfies REQ-009] [depends: TRD-022]
  **Validates PRD ACs:** AC-009-1
  - Target Files: `packages/development/tests/implement-trd-tasks-routing.test.js`
  - Test AC:
    - [ ] Happy: Given a bound scratch kata project and a TRD, when implement-trd-tasks scaffolds, then the scratch project holds the TRD's work items with their dependency edges.
    - [ ] Edge: Given br and bv deliberately broken on PATH, when the kata run completes, then it still succeeds because no beads binary is invoked.

- [ ] **TRD-023** Retired-name sweep across command, agent and skill sources and generated mirrors, excluding archived and historical documents (6h) [satisfies REQ-009] [depends: TRD-021]
  **Validates PRD ACs:** AC-009-2
  - Target Files: `packages/development/commands/`, `packages/development/agents/`, `packages/development/skills/`, `scripts/generate-markdown.js`
  - Implementation AC:
    - [ ] Given every source manifest and generated mirror, when the sweep runs, then no entry named implement-trd-beads remains outside archived or historical documents.
    - [ ] Given the sweep changed sources, when the generate chain runs from the repository root, then generated mirrors match their sources and no mirror is edited from inside a package directory.

- [ ] **TRD-023-TEST** Verify no source manifest or generated artifact names the retired command (2h) [verifies TRD-023] [satisfies REQ-009] [depends: TRD-023]
  **Validates PRD ACs:** AC-009-2
  - Target Files: `packages/development/tests/retired-name-sweep.test.js`
  - Test AC:
    - [ ] Happy: Given the swept tree, when the inventory search for implement-trd-beads runs over commands, agents, skills and generated mirrors, then zero entries are found.
    - [ ] Edge: Given an archived PRD or TRD that mentions the old name, when the sweep runs, then that document is excluded and unchanged.

### PR 5: Neutral prose, kata docs, and disclosed coverage

**Shippable State:** The shared TRD-flow prose names no tracker binary or storage path outside beads-scoped text, command docs state the kata prerequisites, and `npm run docs:contracts` shows each backend's native and fallback capabilities while explain shows the resolved split.

- [ ] **TRD-024** Neutral shared prose: tracker work goes through capability calls, with no tracker binary or storage path outside beads-scoped text (6h) [satisfies REQ-011] [depends: TRD-021] [depends: TRD-020]
  **Validates PRD ACs:** AC-011-1, AC-011-2, AC-011-3
  - Target Files: `packages/development/commands/implement-trd-tasks.yaml`, `packages/development/skills/`, `scripts/lint-provider-refs.js`, `scripts/lint-provider-refs.baseline.json`
  - Implementation AC:
    - [ ] Given shared command and skill prose, when it names a tracker binary or storage path, then the text is rewritten to a toolchain-cli run capability call or explicitly scoped to beads.
    - [ ] Given a kata project and a beads project, when the prose instructs creating, linking and closing a work item, then each instruction resolves to a capability call that differs per project and reads identically in the text.
    - [ ] Given the provider-reference lint runs after the rewrite, when its baseline is compared, then the baseline shrinks and does not grow.

- [ ] **TRD-024-TEST** Verify prose neutrality and unchanged beads behavior (4h) [verifies TRD-024] [satisfies REQ-011] [depends: TRD-024] [depends: TRD-020]
  **Validates PRD ACs:** AC-011-1, AC-011-2, AC-011-3
  - Target Files: `packages/development/tests/prose-neutrality.test.js`
  - Test AC:
    - [ ] Happy: Given the shared command and skill prose, when searched for a tracker binary name or beads storage path, then none is found outside beads-scoped sections.
    - [ ] Edge: Given a beads project, when the flow runs after the prose change, then its work items match the golden fixtures recorded in TRD-020.
    - [ ] Edge: Given a kata project, when the same create, link and close instructions run, then each resolves to a kata capability call.

- [ ] **TRD-025** Kata starting-point documentation: prerequisites, the binding step, a fresh-project walkthrough, and the documented unbound message (3h) [satisfies REQ-014] [depends: TRD-021] [depends: TRD-004]
  **Validates PRD ACs:** AC-014-1, AC-014-2, AC-014-3
  - Target Files: `packages/development/commands/implement-trd-tasks.yaml`, `docs/toolchain/contracts/README.md`
  - Implementation AC:
    - [ ] Given the command documentation, when a reader looks for prerequisites, then it states kata 0.23.0 or later and that kata init binds the workspace through the kata binding file.
    - [ ] Given a fresh kata project, when a reader follows only the documented steps, then the flow scaffolds work items in kata.
    - [ ] Given a kata project that is not bound, when the flow is invoked, then it stops with the same prerequisite message the documentation gives.

- [ ] **TRD-025-TEST** Verify the documented steps scaffold a fresh kata project (3h) [verifies TRD-025] [satisfies REQ-014] [depends: TRD-025] [depends: TRD-022] [depends: TRD-004]
  **Validates PRD ACs:** AC-014-1, AC-014-2, AC-014-3
  - Target Files: `packages/development/tests/kata-docs-walkthrough.test.js`
  - Test AC:
    - [ ] Happy: Given a fresh scratch kata project and only the documented steps, when the flow runs, then work items appear in kata.
    - [ ] Edge: Given an unbound scratch workspace, when the flow is invoked, then it stops with the documented prerequisite message and creates no items.
    - [ ] Edge: Given the command documentation, when it is read, then its prerequisites section names the binding file and the version floor.

- [ ] **TRD-026** Coverage disclosure: generated contract docs and explain output show native versus fallback per backend, the docs check catches drift, and the builtin graph-health fallback becomes truthful (6h) [satisfies REQ-015] [depends: TRD-014] [depends: TRD-018]
  **Validates PRD ACs:** AC-015-1, AC-015-3
  - Target Files: `scripts/generate-contract-docs.js`, `docs/toolchain/contracts/tracker.md`, `docs/toolchain/contracts/work-graph.md`, `packages/development/lib/toolchain-cli.js`, `packages/development/lib/toolchain/builtin/work-graph-links-fallback.js`
  - Implementation AC:
    - [ ] Given the generated tracker and work-graph contract docs, when they are read, then each names the shipped backends and states per capability whether it is native or reached by fallback.
    - [ ] Given an adapter whose native-versus-fallback status changed without regeneration, when the docs check runs, then it fails naming the unrecorded change.
    - [ ] Given explain runs for a kata project, when it reports the work-graph category, then each capability shows native or fallback for the resolved adapter.
    - [ ] Given work-graph.graph-health declares the links fallback, when the builtin is asked for it, then it answers from the shared scan rather than refusing, so the contract claim is true without a version bump, and the jira manifest is unchanged.

- [ ] **TRD-026-TEST** Verify generated coverage docs, docs-check drift, and truthful fallback (3h) [verifies TRD-026] [satisfies REQ-015] [depends: TRD-026] [depends: TRD-015] [depends: TRD-018]
  **Validates PRD ACs:** AC-015-1, AC-015-3
  - Target Files: `packages/development/tests/contract-docs.test.js`
  - Test AC:
    - [ ] Happy: Given the regenerated docs, when they are read, then they list kata and the links analyzer with native and fallback status per capability.
    - [ ] Edge: Given a manifest change that moves a capability from native to fallback without regeneration, when the docs check runs, then it fails.
    - [ ] Edge: Given graph-health asked of the builtin, when it runs, then it returns findings rather than an unsupported-capability refusal.

- [ ] **TRD-027** PRD refine pass on PRD-2026-6995dc96: reconcile AC-004-3 with REQ-003 and AC-003-2, correct the Relationship count, and record that PRD-2026-8d825f54 is retained (2h) [satisfies ARCH]
  **Validates PRD ACs:** AC-003-2, AC-004-3, AC-015-3
  - Target Files: `docs/PRD/PRD-2026-6995dc96-configurable-tasks-backend-kata.md`
  - Implementation AC:
    - [ ] Given AC-004-3 expects a status change to closed to read back closed, when the refine pass runs, then AC-004-3 is amended to require a recorded reason and evidence, with a refusal otherwise, consistent with REQ-003 and AC-003-2.
    - [ ] Given the Relationship section says three documents carry amendment notes while its table lists four, when the refine pass runs, then the sentence states the count the table shows.
    - [ ] Given PRD-2026-8d825f54 is Locked and tracked in git, when the refine pass runs, then the Relationship section records it as retained with no deletion planned, and no task edits that document.

### PR 6: Bounded, truncation-safe, and skip-honest adapter runs

**Shippable State:** On a machine without kata, the repository test run exits 0 and names each kata-dependent skip as "tool absent"; a hung kata call returns a named timeout with its class and bound; a truncated or unparseable kata read returns a named error with no partial list.

Boundary: beads capabilities gain class defaults; effective beads behavior unchanged (both classes stay at 60000 ms).

- [ ] **TRD-028** Per-class timeout bounds: capabilities declare short or long, bounds are set per adapter and per project, and every timeout names the class and bound (6h) [satisfies REQ-017] [depends: TRD-002]
  **Validates PRD ACs:** AC-017-1
  - Target Files: `packages/development/lib/toolchain/runner.js`, `packages/development/lib/toolchain/config.js`, `packages/development/toolchain/schemas/toolchain-config-schema.json`, `packages/development/toolchain/schemas/adapter-manifest-schema.json`, `packages/development/skills/adapter-tracker-kata/adapter.yaml`, `packages/development/skills/adapter-tracker-beads/adapter.yaml`, `packages/development/tests/toolchain-runner-sync-parity.test.js`
  - Implementation AC:
    - [ ] Given a capability declaring class short or long, when it is invoked, then the bound in force is the project's configured value for that class, else the adapter manifest's class default.
    - [ ] Given a beads capability invoked after this edit, when its effective short-class and long-class bounds are resolved, then each equals 60000 ms, the value shipped today, so beads' effective timeouts are unchanged: this is a no-behavior-change edit.
    - [ ] Given a backing tool that never exits, when a capability runs, then the TIMEOUT error names the capability, its class and the bound in force, and the sync and async entry points report it identically.

- [ ] **TRD-028-TEST** Verify a hung read and a hung write each time out with class and bound named (3h) [verifies TRD-028] [satisfies REQ-017] [depends: TRD-028]
  **Validates PRD ACs:** AC-017-1
  - Target Files: `packages/development/tests/kata-timeouts.test.js`
  - Test AC:
    - [ ] Happy: Given a kata listing that completes inside the short bound, when it runs, then its result returns normally.
    - [ ] Edge: Given a stub kata that never exits on a short-class read, when it runs, then the call returns a timeout naming the capability, class short and the short bound in force, and does not block.
    - [ ] Edge: Given a project configuration overriding the long bound, when a stub write hangs, then the timeout names class long and the configured value.
    - [ ] Happy: Given the beads manifest after this edit, when the effective short-class and long-class bounds are resolved for beads capabilities, then each is 60000 ms, so the no-behavior-change assertion holds and fails if a default is mistyped.

- [ ] **TRD-029** Named failures and truncation-safe reads: stderr passes through, kata exit codes map to named errors, and partial output is refused (5h) [satisfies REQ-017] [depends: TRD-002] [depends: TRD-007]
  **Validates PRD ACs:** AC-017-2, AC-017-3
  - Target Files: `packages/development/lib/toolchain/mapping.js`, `packages/development/lib/toolchain/runner.js`, `packages/development/skills/adapter-tracker-kata/adapter.yaml`
  - Implementation AC:
    - [ ] Given kata exits nonzero with a message on stderr, when a capability runs, then the adapter error carries that message through to the caller.
    - [ ] Given kata exit codes 3 through 8, when they occur, then each maps to a named adapter error and never to success.
    - [ ] Given stdout that does not parse, is truncated, or whose row count disagrees with --include-total, when a read runs, then the adapter reports a parse failure and returns no partial list.

- [ ] **TRD-029-TEST** Verify stderr passthrough, named exit codes, and refusal of partial output (3h) [verifies TRD-029] [satisfies REQ-017] [depends: TRD-029] [depends: TRD-007]
  **Validates PRD ACs:** AC-017-2, AC-017-3
  - Target Files: `packages/development/tests/kata-errors.test.js`
  - Test AC:
    - [ ] Happy: Given kata exits 0 with valid JSON, when a read runs, then the normalized list is returned.
    - [ ] Edge: Given a stub kata exiting 1 with a stderr message, when a read runs, then the error carries that stderr text.
    - [ ] Edge: Given a stub kata whose output is cut off mid-JSON, when a list runs, then the result is a parse failure and contains no items.

- [ ] **TRD-030** Repo-wide skip guard for every kata-dependent check, and a CI leg without kata that asserts a nonzero kata skip count (5h) [satisfies REQ-016] [depends: TRD-001]
  **Validates PRD ACs:** AC-016-1, AC-016-2, AC-016-3
  - Target Files: `packages/development/tests/helpers/kata-guard.js`, `.github/workflows/test.yml`
  - Implementation AC:
    - [ ] Given any test in the repository that asserts kata behavior, when it is written, then it uses the shared guard so a missing kata reports it skipped with reason "tool absent".
    - [ ] Given a CI job that does not install kata, when it runs, then it passes and reports a nonzero skip count for the kata-dependent checks.
    - [ ] Given the skip list and the set of tests that touch kata, when they are compared, then no kata-asserting test is reported as passing on a runner without kata.

- [ ] **TRD-030-TEST** Verify the repository-wide run skips honestly without kata (3h) [verifies TRD-030] [satisfies REQ-016] [depends: TRD-030]
  **Validates PRD ACs:** AC-016-1, AC-016-2, AC-016-3
  - Target Files: `packages/development/tests/kata-skip-audit.test.js`
  - Test AC:
    - [ ] Happy: Given kata absent, when the repository-wide test run executes, then it exits 0 and lists every kata-dependent check as skipped with reason "tool absent".
    - [ ] Edge: Given a kata-asserting test that is not guarded, when the audit runs, then the audit fails naming that test.
    - [ ] Edge: Given kata present, when the run executes, then the kata-dependent checks run and none is reported as skipped.

## Acceptance Criteria Traceability

> Requirement identifiers are **per-document**. PRD-2026-8d825f54's REQ-001, REQ-004, REQ-005,
> REQ-012, REQ-013 and REQ-014 describe the shipped toolchain layer and are unrelated to the
> same numbers in PRD-2026-6995dc96, which are kata-specific. Map by requirement title or by
> explicit document citation — never by number alone.

Each task re-cites its own ACs under `**Validates PRD ACs:**`; this matrix is a projection of
that data. Each AC is listed under the requirement its identifier names (`AC-NNN-K` belongs to
`REQ-NNN`), which is unambiguous even where one task satisfies several requirements.

| Requirement | Implementation Tasks | Test Tasks | Acceptance Criteria |
|---|---|---|---|
| REQ-001 | **TRD-002** — Kata adapter manifest: tracker and work-graph categories, contract versions, binary, allowlist, env names, health probe, and no detection<br>**TRD-003** — Preflight minimum-version gate at kata 0.23.0, version reporting on pass, and contract-major check on resolution<br>**TRD-006** — Named missing-binary diagnosis for kata, silence for non-kata projects, and no fallback to beads after selection<br>**TRD-009** — Required create and update mappings returning the kata short id<br>**TRD-015** — Coverage assertion: the kata manifest declares every required capability and every fallback-bearing capability of both contracts<br>**TRD-031** — Resolver reports the project-config source on a tracker-supplied work-graph path<br>**TRD-032** — Resolver gates on declared capabilities and diagnoses a cross-backend work-graph mismatch | TRD-002-TEST<br>TRD-003-TEST<br>TRD-006-TEST<br>TRD-009-TEST<br>TRD-015-TEST<br>TRD-031-TEST<br>TRD-032-TEST | AC-001-1, AC-001-2, AC-001-3, AC-001-4 | |
| REQ-002 | TRD-010 — Dedupe identity: create-detailed records the external key durably, and find-by-key searches the whole project including closed items | TRD-010-TEST | AC-002-1, AC-002-2, AC-002-3 | |
| REQ-003 | TRD-011 — Close with reason and evidence: close-with-reason records both, and a bare close never closes silently | TRD-011-TEST | AC-003-1, AC-003-2, AC-003-3 | |
| REQ-004 | **TRD-012** — Labels one id per call through `tracker.label-one`, and derives lifecycle status and in-progress ownership from the `owner` field<br>**TRD-034** — Name `owner` in the normalized work-item shape | TRD-012-TEST<br>TRD-034-TEST | AC-004-1, AC-004-2, AC-004-3 | |
| REQ-005 | TRD-013 — Dependency links through kata's blocked-by edge, with non-gating link kinds refused | TRD-013-TEST | AC-005-1, AC-005-2, AC-005-3 | |
| REQ-006 | TRD-014 — Native answers for update-detailed, stage-export and sync, so no fallback fires for kata | TRD-014-TEST<br>TRD-016-TEST | AC-006-1, AC-006-2 | |
| REQ-007 | TRD-016 — Dispatch for work-graph capabilities computed in-process, through one resolver-owned path<br>TRD-017 — Kata edge export and ready-work listing from kata's own ready command<br>TRD-018 — Shared pure edge scan: dependency-first order, cycle findings, and dangling-edge findings<br>TRD-019 — Kata work-graph plan and graph-health built on the shared scan, reporting kata as source | TRD-016-TEST<br>TRD-017-TEST<br>TRD-018-TEST<br>TRD-019-TEST | AC-007-1, AC-007-2, AC-007-3, AC-007-4, AC-007-5 | |
| REQ-008 | **TRD-007** — Kata read mappings: show returns the normalized item and list honors its open filter without truncation<br>**TRD-008** — Comment append and comment listing in the order the comments were written<br>**TRD-033** — Normalized schema entries for the non-entity kata capabilities<br>**TRD-034** — Name `owner` in the normalized work-item shape | TRD-007-TEST<br>TRD-008-TEST<br>TRD-033-TEST<br>TRD-034-TEST | AC-008-1, AC-008-2, AC-008-3 | |
| REQ-009 | TRD-020 — Rename the TRD-to-work-items command to implement-trd-tasks with every phase and argument kept, after recording golden fixtures from the current command<br>TRD-021 — Dispatcher routes the implement keyword to the new command and rejects the retired name with its replacement named<br>TRD-022 — Scaffold routing through toolchain capabilities so a kata run never invokes br or bv<br>TRD-023 — Retired-name sweep across command, agent and skill sources and generated mirrors, excluding archived and historical documents | TRD-020-TEST<br>TRD-021-TEST<br>TRD-022-TEST<br>TRD-023-TEST | AC-009-1, AC-009-2, AC-009-3, AC-009-4 | |
| REQ-010 | TRD-020 — Rename the TRD-to-work-items command to implement-trd-tasks with every phase and argument kept, after recording golden fixtures from the current command | TRD-020-TEST | AC-010-1, AC-010-2, AC-010-3 | |
| REQ-011 | TRD-024 — Neutral shared prose: tracker work goes through capability calls, with no tracker binary or storage path outside beads-scoped text | TRD-024-TEST | AC-011-1, AC-011-2, AC-011-3 | |
| REQ-012 | **TRD-001** — Scratch kata workspace harness, recorded kata JSON fixtures, and a named absent-tool skip guard<br>**TRD-006** — Named missing-binary diagnosis for kata, silence for non-kata projects, and no fallback to beads after selection<br>**TRD-032** — Resolver gates on declared capabilities and diagnoses a cross-backend work-graph mismatch | TRD-001-TEST<br>TRD-006-TEST<br>TRD-032-TEST | AC-012-1, AC-012-2, AC-012-3 | |
| REQ-013 | TRD-005 — Keep kata out of detection and default selection | TRD-005-TEST | AC-013-1, AC-013-2, AC-013-3, AC-013-4 | |
| REQ-014 | TRD-025 — Kata starting-point documentation: prerequisites, the binding step, a fresh-project walkthrough, and the documented unbound message | TRD-025-TEST | AC-014-1, AC-014-2, AC-014-3 | |
| REQ-015 | TRD-015 — Coverage assertion: the kata manifest declares every required capability and every fallback-bearing capability of both contracts<br>TRD-026 — Coverage disclosure: generated contract docs and explain output show native versus fallback per backend, the docs check catches drift, and the builtin graph-health fallback becomes truthful | TRD-015-TEST<br>TRD-026-TEST | AC-015-1, AC-015-2, AC-015-3 | |
| REQ-016 | TRD-001 — Scratch kata workspace harness, recorded kata JSON fixtures, and a named absent-tool skip guard<br>TRD-030 — Repo-wide skip guard for every kata-dependent check, and a CI leg without kata that asserts a nonzero kata skip count | TRD-001-TEST<br>TRD-030-TEST | AC-016-1, AC-016-2, AC-016-3 | |
| REQ-017 | TRD-028 — Per-class timeout bounds: capabilities declare short or long, bounds are set per adapter and per project, and every timeout names the class and bound<br>TRD-029 — Named failures and truncation-safe reads: stderr passes through, kata exit codes map to named errors, and partial output is refused | TRD-028-TEST<br>TRD-029-TEST | AC-017-1, AC-017-2, AC-017-3 | |
| REQ-018 | TRD-003 — Preflight minimum-version gate at kata 0.23.0, version reporting on pass, and contract-major check on resolution<br>TRD-004 — Preflight binding gate: an unbound workspace stops before any work item is written, and capabilities not reported by preflight are refused | TRD-003-TEST<br>TRD-004-TEST | AC-018-1, AC-018-2, AC-018-3 | |

## Requirements Traceability Summary

- **Total requirements:** 18 (14 Must, 4 Should)
- **Covered by new tasks:** 18
- **Reused at requirement level:** 0
- **Uncovered:** 0
- **Acceptance criteria:** 58 distinct
- **Tasks:** 34 implementation + 33 test, across 6 PRs
- **Estimates:** implementation 136h (max 6h), test 92h (max 4h)

`TRD-027` (the documentation and prose sweep) is the single unpaired implementation task: it is
the documentation consequence of the rename owned by `TRD-020` and the neutralization owned by
`TRD-024`, it is reached through their dependency edges, and it satisfies `ARCH` rather than a PRD
requirement. It carries no `-TEST` task because a prose sweep has no behaviour to assert — its
completion criterion is that the named PRD passages read correctly, which `TRD-027`'s own acceptance
criteria state directly. It is the only task that maps to no `REQ-NNN`, since it satisfies `ARCH`;
requirement coverage is therefore 18/18 across the other 33 implementation tasks, all test-paired.

Reuse is a machinery boundary, not a per-requirement flag. The toolchain engine, contract
loader, resolver, preflight, runner and beads adapter are consumed unchanged and own no task;
`TRD-2026-8d825f54` specifies that layer — the 17-capability `tracker.yaml` v1.0 contract, the
3-capability `work-graph.yaml` v2.0 contract, and `lib/toolchain/` — and receives no tasks here.

### AC Coverage by Requirement

Must-tier bar is 2+ ACs including an edge case; Should-tier bar is 1+.

| Requirement | Tier | ACs | Bar | AC ids |
|---|---|---|---|---|
| REQ-001 — Kata backend resolves through configuration for both categories | Must | 4 | ok | AC-001-1, AC-001-2, AC-001-3, AC-001-4 |
| REQ-002 — Dedupe identity survives across runs | Must | 3 | ok | AC-002-1, AC-002-2, AC-002-3 |
| REQ-003 — Close requires reason and evidence | Must | 3 | ok | AC-003-1, AC-003-2, AC-003-3 |
| REQ-004 — Label and status operations map to kata semantics | Must | 3 | ok | AC-004-1, AC-004-2, AC-004-3 |
| REQ-005 — Unsafe workspaces refuse before any write | Must | 3 | ok | AC-005-1, AC-005-2, AC-005-3 |
| REQ-006 — Absent or incompatible kata is diagnosed, never silently replaced | Must | 2 | ok | AC-006-1, AC-006-2 |
| REQ-007 — Dependency-aware pickup works on kata | Must | 5 | ok | AC-007-1, AC-007-2, AC-007-3, AC-007-4, AC-007-5 |
| REQ-008 — Link creates typed edges | Should | 3 | ok | AC-008-1, AC-008-2, AC-008-3 |
| REQ-009 — Parallel tracks compute from kata dependency data | Must | 4 | ok | AC-009-1, AC-009-2, AC-009-3, AC-009-4 |
| REQ-010 — Graph health reports on kata | Should | 3 | ok | AC-010-1, AC-010-2, AC-010-3 |
| REQ-011 — Events and comments are readable | Must | 3 | ok | AC-011-1, AC-011-2, AC-011-3 |
| REQ-012 — Tests skip honestly when kata is absent | Must | 3 | ok | AC-012-1, AC-012-2, AC-012-3 |
| REQ-013 — Detection never displaces explicit configuration | Must | 4 | ok | AC-013-1, AC-013-2, AC-013-3, AC-013-4 |
| REQ-014 — Runs are bounded, truncation-safe, and skip-honest | Must | 3 | ok | AC-014-1, AC-014-2, AC-014-3 |
| REQ-015 — Partial capability coverage is disclosed, not silently degraded | Must | 3 | ok | AC-015-1, AC-015-2, AC-015-3 |
| REQ-016 — Scratch kata harness is isolated from real projects | Should | 3 | ok | AC-016-1, AC-016-2, AC-016-3 |
| REQ-017 — The TRD-to-tasks command is backend-neutral | Must | 3 | ok | AC-017-1, AC-017-2, AC-017-3 |
| REQ-018 — Provider-specific prose is neutralized in shared surfaces | Should | 3 | ok | AC-018-1, AC-018-2, AC-018-3 |
| **Total** | | **58** | | |

## Architecture Self-Critique

Evidence: the PRD, `tracker.yaml` (17 capabilities), `work-graph.yaml` (v2.0, three capabilities), the beads `adapter.yaml`, and the shipped engine. Kata behaviour comes from `--help` and `quickstart` output of the installed binary (v0.23.0) **and** from a live capture run 2026-11-14 in a scratch project bound with `kata init` under an isolated `KATA_HOME`, which recorded real JSON response envelopes for create, close, label, claim, edit, show, list, list --meta, ready, status and events, plus four error paths (`~/.omp/trd-6995dc96/capture/`). Shapes outside that capture remain marked [UNVERIFIED].

**Remote-gateway envelope and auth failure modes remain unverified, by design of the scope.** The architecture owner decided on 2026-11-14 that this delivery is scoped to locally-spawned kata daemons, so the remote kata gateway is out of scope here and no task in the list is expected to reach or test it. The capture above exercises an isolated `KATA_HOME` daemon, which needs no token, so the gateway's own refusals (`origin_forbidden`, `web_session_required`, both `kind: internal` with `exit_code: 1`, outside the 2/3/4/5/7 taxonomy) stay uncaptured for that reason, not for lack of trying — see Open Questions for the PRD, item 10.

Reuse is at the machinery level, not the requirement level. No 6995dc96 requirement is satisfied by shipped code.

### A1. The declarative runner cannot express kata's composed operations (RESOLVED for labels)

- **Evidence:** A manifest capability is one `run[]` argv template (`runner.js#buildArgv`, `selectTemplate`). `mapping.js#statusMap` looks up only the raw `result.status` string. Kata needs multiple calls in four places:
  - **In-progress.** Ownership is the in-progress state (PRD REQ-004). `kata show`'s "by" line is the author, not the owner. Owner comes from `kata status`, per its own help text.
  - **Labels.** `kata label add <ref> <label>` takes one label on one item. `tracker.label` takes `ids[]` and `labels[]`. Replacement needs `label rm` plus `add`.
  - **Notes.** `tracker.update-detailed` must append. Kata's append is `kata comment`. `kata edit --body` replaces.
  - **Graph-health.** A scan over N items (A5).
- **Why one call cannot address many ids.** `runner.js` states the substitution contract directly: a `{name}` placeholder is replaced by a plain string replace that "never splits one template element into multiple argv elements." That prohibition is load-bearing, not incidental — it is what keeps a value such as `a; rm -rf /` inside a single argv element uninterpreted as shell syntax (PRD REQ-023). So `["kata","label","add","{ids}","{label}"]` can only ever address one item, and no manifest can express it otherwise. A runner-level fan-out over list-typed arguments was considered and rejected for the same reason any change to that substitution rule is risky: `buildArgv` is the single audited chokepoint every adapter passes through, and fanning one call into N turns one envelope into N, which breaks the bounded-envelope rule that `docs/toolchain/index.md` and REQ-017 impose on a capability invocation.
- **Problem:** Each composed operation either fails silently, reports a wrong status (in-progress would read as `open`), or needs a mechanism the engine does not have.
- **Resolution (labels decided 2026-11-14 by the architecture owner).** Extend the tracker contract to **1.1** with a new single-item capability, `tracker.label-one`, declared inputs `id` plus `label`, one argv template per call, with `docs/toolchain/contracts/tracker.md` as the normative text. A caller holding N ids issues N calls; callers loop, not the runner. AC-004-1's "applied … id" wording is read per-id, which is what kata natively provides. For the other three composed operations the mechanism is the in-process capability hook following the `work-graph-links-fallback` precedent, adopted by TRD-016 and built on by TRD-018 and TRD-019. Rejected: a `steps[]` manifest form, which widens the audited envelope for every adapter; and a helper script, which needs a `node` sub-argument allowlist.
- **Consequence of the bump (this is a requirements change; recorded 2026-11-14).** PRD-2026-6995dc96 states under Technical Constraints that "either contract version is a requirements change to this PRD." Bumping `tracker` 1.0 to 1.1 reopens that PRD, and the same rule binds `work-graph` 2.0 to 2.1, which this design already raises for `work-graph.ready`. This TRD did not bump either contract number on its own authority. The `tracker` bump was then recorded by the architecture owner as PRD-2026-6995dc96 v1.3.0, whose changelog explicitly re-confirmed this TRD rather than requiring its re-creation, so `docs/toolchain/contracts/tracker.md` now reads `1.1`. The `work-graph` bump remains unrecorded and that document still reads `2.0`, because its motivation is the additive output fields in option C (`findings`, `dependencyAware` for AC-007-3 and AC-007-4), which this change does not add. The kata manifest declares the version it was tested against.
- **Status after the final task list:** Resolved for labels. `tracker.label-one` is a declared kata capability; TRD-012 owns the per-id sweep, and TRD-034 owns `owner` in the normalized shape that the sweep reads. The contract-version amendment that was open here has since landed: `tracker` is at `1.1` per PRD-2026-6995dc96 v1.3.0, so TRD-012 is unblocked. The `work-graph` amendment remains a PRD decision rather than a missing task.
- **Effort:** Medium (1–2d), already spent in the list; no further implementation task beyond TRD-031..034 added for C4.

### A2. The builtin `work-graph-links-fallback` is not dependency-aware under any shipped tracker

- **Evidence:** `builtin/work-graph-links-fallback.js#dependencyIds` reads `dependencies` from each `tracker.show` result. `hasDependencyData` is false unless some item carries that array, and then `orderingSource: 'plan-order'`, `dependencyAware: false`. The beads `tracker.show` map (`adapter.yaml` L60–81) maps `id,title,description,type,status,labels` only, and `grep dependencies` finds only a comment. The jira manifest was not checked for this key.
- **Problem:** Beads does not reach the fallback at all, since it declares `work-graph` and uses `bv`. For any tracker that does reach it, dependency awareness depends on a `dependencies` mapping the shipped adapters do not provide. Kata can supply it: `tracker.show` maps blocking links from `show.links[]`, whose shape is verified by the 2026-11-14 capture (`{from, to, type}` with `type: "blocks"`, direction explicit). The residual risk is not kata's shape but that no shipped tracker other than kata satisfies the condition, so the fallback stays non-dependency-aware for jira and azure-boards.
- **Resolution:** Require each tracker's `tracker.show` map to supply `dependencies` (`{id}` objects) before claiming work-graph. Add a test that the builtin reports `dependencyAware: true` only when that field is present. The fallback code is unchanged. Kata changes behaviour only for projects that select kata.
- **Status after the final task list:** TRD-017 maps kata's blocking links into `dependencies`. The builtin's own dependency condition is not tested, and TRD-026 adds a new risk (see A5 and Open Questions).
- **Effort:** Short.

### A3. The resolver reports `source: 'default'` on the tracker-supplied path, breaking AC-001-1

- **Evidence:** `work-graph-resolve.js#resolveWorkGraphAdapter` returns `source: resolved.source` on both the `tracker-capabilities` and `builtin-fallback` branches. `resolved` is the `work-graph` tier, which is `'default'` whenever `work-graph: auto` comes from `toolchain.default.yaml` (`config.js` L173). `tests/toolchain-cli.test.js` `buildExpectedData` pins `work-graph.source = 'default'`.
- **Problem:** A kata project with only `tracker: kata` set reports work-graph source `default`. AC-001-1 (PRD L60) requires "a config source, not the shipped default".
- **Resolution:** On `autoVia === 'tracker-capabilities'`, report `trackerResolved.source`. Keep `'default'` for `builtin-fallback`. Update the pinned expectation for that branch only.
- **Status after the final task list:** Owned by TRD-031. TRD-031 changes `work-graph-resolve.js` source reporting and TRD-031-TEST asserts it, so the assertion TRD-002-TEST makes now has an implementation task behind it. TRD-016 still lists that file as a target without covering source, which is why the fix is a separate task rather than folded into TRD-016.
- **Effort:** Quick.

### A4. The resolver gates on `manifest.categories`, not capabilities, and permits cross-backend mixes

- **Evidence:** `trackerProvidesWorkGraph` checks only `manifest.categories.includes('work-graph')`. The jira manifest header records the incident: a `work-graph` category with no `work-graph.*` capability was selected, and preflight failed `UNAVAILABLE`. Jira was fixed by removing the category.
- **Problem:** A kata manifest that declares the category but omits one of `work-graph.ready|plan|graph-health` would be captured and then fail, because the resolver never falls back. Separately, `tracker: kata` with an explicit `work-graph: beads` is accepted silently, so `bv` would read `.beads/` inside a kata project.
- **Resolution:** Require all three `work-graph.*` entries in `manifest.capabilities` before a tracker claims `work-graph`. Emit a diagnostic when `work-graph` is explicitly a different tracker than `tracker`. Test both.
- **Status after the final task list:** Owned by TRD-032. TRD-015 checks manifest coverage against the contract, which still only covers the missing-capability case for the kata manifest. TRD-032 adds the resolver-side capability gate and the explicit mismatch diagnostic, with TRD-032-TEST asserting both, so the resolver no longer silently accepts a tracker that lacks the required capability.
- **Effort:** Quick.

### A5. `graph-health` returns NOT_ALLOWED despite the contract naming the builtin as its fallback

- **Evidence:** `work-graph.yaml` L21–27 names `work-graph-links-fallback` as the fallback for `work-graph.graph-health`. `runWorkGraphCapability` returns `NOT_ALLOWED` for any capability other than `work-graph.ready` or `work-graph.plan` (L279–286). `toolchain-cli.js` L538–541 dispatches every `work-graph` call to `runWorkGraphCapability` whenever a tracker manifest is resolved.
- **Problem:** This is a contract violation that exists today, independent of kata. Any tracker that falls back to the builtin (jira, per the PRD's own Non-Goals) gets `NOT_ALLOWED` for graph-health.
- **Resolution:** Either implement graph-health in the builtin from the same scan, or remove the fallback id from `work-graph.yaml`, which is a contract change and a PRD-level decision.
- **Status after the final task list:** Resolved by choice. TRD-026 makes the builtin answer graph-health from the shared scan (TRD-018). The contract claim is now true, with the risk stated in A2 and Open Questions.
- **Effort:** Medium, after A1.

### A6. REQ-017's bound is per subprocess, not per capability, and has no configuration surface

- **Evidence:** `runner.js` uses `opts.timeoutMs || DEFAULT_TIMEOUT_MS` (60 s) per `runCapability` call. `fetchDetailedItems` calls `runCapability` once per listed item. Grep of `config.js`, `validate.js` and `toolchain.default.yaml` finds no timeout key.
- **Problem:** A graph-health pass over 300 items is 301 subprocesses, each with its own bound. The "bound per capability class" in REQ-017 is not enforced across a fan-out.
- **Resolution:** Enforce a deadline per capability invocation, not per subprocess.
- **Status after the final task list:** Partly resolved. TRD-028 adds per-class bounds, configurable per project, with the class and bound named in every timeout. TRD-017 reduces fan-out by reading edges from the list envelope, so per-item `kata show` runs only when the envelope omits them. No whole-capability deadline is tasked.
- **Effort:** Short.

### A7. Kata's vocabulary does not match the normalized work-item contract

- **Evidence:**
  - `kata create --help` has no `--type` flag.
  - Kata has no external-key lookup. `--idempotency-key` is a seven-day retry guard. `kata search` is text search over title, body and comments.
  - Metadata is filtered with `kata list --meta key=value` and written with `kata meta set`. Values are stored as JSON strings.
  - `work-item.json` has no `owner` property, though its top level is `additionalProperties: true`, so an unmapped `owner` passes validation silently.
  - `create` soft-blocks look-alike titles with exit 5 unless `--force-new` is passed.
- **Problem:** PRD REQ-002 says dedupe "works natively". It does not. It must be a metadata convention. `type` and `owner` need a named place in the normalized shape, or AC-004-2 and AC-008-2 cannot be checked.
- **Resolution:** Define namespaced metadata keys for the external key and type. Name `owner` in the normalized output, additively. Pass `--force-new` only on an explicit caller flag.
- **Status after the final task list:** Partly resolved; the `owner` gap is closed by TRD-034. TRD-010 stores the external key in metadata as `ext_key` and uses it as the idempotency key, and TRD-007 reads `type` from metadata with a default of `task`. TRD-012 and TRD-007-TEST rely on `owner`, and TRD-034 now names `owner` in the normalized shape and adds it to the schema, with TRD-034-TEST asserting it.
- **Effort:** Short.

### A8. Required `tracker.close` cannot meet kata's close policy

- **Evidence:** `tracker.close` is required with inputs `[id]` only. Kata's `close --done` requires `-m` of at least 40 characters, and its `--evidence` policy is typed. `tracker.close-with-reason.reason` is free text, while kata's `--reason` is an enum. The minimum-length and evidence rules are from help text, not a daemon call.
- **Problem:** A required capability with no message or evidence input can only fail on kata, or fabricate a message, which defeats REQ-003's audit intent. Fixing the contract is a requirements change under the PRD's own rule.
- **Resolution:** Map `tracker.close` so kata's own refusal surfaces, and route flow closures through `close-with-reason`. Escalate the contract gap to the architecture owner.
- **Status after the final task list:** Partly resolved. TRD-011 makes a bare `tracker.close` refuse with INVALID_ARG through mandatory reason and evidence placeholders. The contract gap is not escalated: `tracker.yaml` still declares `[id]` only, and no task records the decision.
- **Effort:** Quick decision, then Short.

### A9. The list-shape trap is partly stale, but live for non-entity capabilities

- **Evidence:** The beads manifest comments on `tracker.list`, `tracker.comments`, `tracker.label`, `tracker.sync` and `tracker.stage-export` say a list cannot carry `parse`. That is out of date. `runner.js` `CAPABILITY_NORMALIZED_SCHEMA` maps `tracker.list` to `work-item-list.json` and `tracker.comments` to `comment-list.json`, and jira uses `parse` on `tracker.list`. But `CAPABILITY_NORMALIZED_SCHEMA` has no entry for `tracker.find-by-key`, `tracker.label`, `tracker.sync` or `tracker.comment`. Those fall through to `CATEGORY_NORMALIZED_SCHEMA` (`work-item.json`, requires `id`).
- **Problem:** A kata `tracker.find-by-key` returning `{items}` through `parse` fails `BAD_OUTPUT`. So does a `tracker.label` mapping of `{ids, labels}`.
- **Resolution:** Add explicit `CAPABILITY_NORMALIZED_SCHEMA` entries for each non-entity kata capability, each with a test. Correct the stale beads comments as a no-behaviour change.
- **Status after the final task list:** Owned by TRD-033 for the capabilities that block this TRD. TRD-033 declares `CAPABILITY_NORMALIZED_SCHEMA` entries for `tracker.find-by-key`, `tracker.label` and `tracker.label-one`, each asserted against a recorded kata fixture by TRD-033-TEST, so those outputs stop falling through to the work-item entity schema and failing `BAD_OUTPUT`. `tracker.sync` and `tracker.comment` are not declared and are not reached by any task here, so the fall-through for those two remains as described above.
- **Effort:** Quick per entry.

## Task Coverage Analysis

Basis: the task list at `~/.omp/trd-6995dc96/tasks-scratch.md` (30 implementation tasks, 29 `-TEST` tasks, 6 PRs at the time of that check). TRD-031 through TRD-034 and their test partners were added afterwards, so the list this document now ships is 34 implementation and 33 `-TEST` tasks. I confirmed the counts in both directly.

### C1. Requirement-namespace trap (resolved in the list, must stay visible)

REQ numbers are per-document. The six ids the earlier reuse map called "already delivered" (REQ-001/004/005/012/013/014) are PRD-8d825f54 requirements. In PRD-6995dc96 the same numbers are kata requirements, and none is delivered.

The list now covers every 6995dc96 requirement with new tasks: all 18 REQs and all 58 ACs are referenced in `Validates PRD ACs` lines. I confirmed that every AC id in the PRD appears in the task file. Reused machinery is cited by path and symbol, and no reused row has its own task.

Required control, unchanged: coverage is asserted per 6995dc96 REQ id. Any document that cites a REQ id must prefix it with its document id. A bare number is not a reference.

### C2. Detection has an owner, but the mechanism was first mis-stated

`detect.js` is not first-match. `detectAdapter` returns the single matching candidate, throws `AMBIGUOUS_PROVIDER` on two or more matches, and returns `null` on zero. Detection runs before the shipped default in `config.js#resolveCategory`, so a non-empty kata `detect` signal would silently select kata. TRD-002-TEST (detect empty), TRD-005 (no detection-derived choice) and TRD-005-TEST (binding file with no configuration resolves to beads) own this. See T-detect below.

### C3. Work items above 8h

None. The maximum task estimate is 6h, held by six tasks: TRD-016, TRD-022, TRD-023, TRD-024, TRD-026 and TRD-028. Three of those six are the most likely to split on build: TRD-022 (routing through capabilities, with four dependencies), TRD-023 (retired-name sweep across manifests and generated mirrors), and TRD-016 (in-process dispatch with confinement).

### C4. Implementation behaviours with no owning task (RESOLVED 2026-11-14)

Each of these was asserted by a PRD AC or by a task test with no implementation task changing the code. All four now have an owning task, each paired with its own `-TEST` task per Rule 3, placed in the PR that already owns the file it touches:

1. **Resolver source reporting (A3).** Was: `TRD-002-TEST` expects project-config source, and no task changed `work-graph-resolve.js`. Now owned by **TRD-031** (PR 1, `work-graph-resolve.js`), verified by **TRD-031-TEST**.
2. **Resolver capability gate and explicit-mismatch diagnostic (A4).** Was: no task. Now owned by **TRD-032** (PR 1, `work-graph-resolve.js`), verified by **TRD-032-TEST**.
3. **Normalized schema entries for non-entity kata capabilities (A9).** Was: no task, although TRD-010 depends on `find-by-key` output. Now owned by **TRD-033** (PR 2, `contracts.js` and the kata fixtures directory), verified by **TRD-033-TEST**.
4. **`owner` in the normalized shape (A7).** Was: `TRD-007-TEST` and TRD-012 rely on it with no task naming it. Now owned by **TRD-034** (PR 2, `work-item.json`), verified by **TRD-034-TEST**.

Three of the four overlap earlier tasks, so TRD-007, TRD-010 and TRD-012 are scoped in this same pass to keep exactly one owner per behaviour, each with a note recording where a moved assertion now lives: TRD-007 owns `show` normalization and the open filter, while TRD-034 owns the `owner` field its read mappings consume; TRD-010 owns the dedupe lookup result, while TRD-033 owns the schema entry that validates `find-by-key` output — a schema-selection concern, not a runtime ordering one, so no dependency edge is added between them; TRD-012 owns the label sweep and the in-progress derivation rule, calling `tracker.label-one` per A1 and reading `owner` from the shape TRD-034 defines, and takes a dependency on TRD-033 because the capability it calls is one of the capabilities TRD-033 declares. TRD-002 needed no narrowing: its acceptance criteria cover manifest fields only, and resolver source reporting was never asserted there, only by TRD-002-TEST.

### C5. Shippable-state rules

All six PR shippable states describe user-observable capabilities. Enabler work is folded into PRs that have user-observable states. TRD-001 (harness and fixtures) is tagged `REQ-016` and `REQ-012` and sits in PR 1. TRD-027 (PRD refine) is tagged `ARCH` and sits in PR 5. Neither makes a PR infrastructure-only.

### C6. Missing or weak coverage

- **Builtin graph-health truthfulness (TRD-026).** Tasked, but the semantics are undecided: the Implementation AC makes the builtin answer from the shared scan, and for a tracker with no dependency data (for example jira) that scan has no edges and would return an empty, clean finding set — the "unlisted gap indistinguishable from an intentional fallback" risk the PRD flags under REQ-015. Open Question 1 for the PRD.
- **Whole-capability timeout (A6).** Not tasked. The PRD leaves the seconds to the TRD and no task sets kata's short or long defaults. Open Question 8 for the PRD.
- **Contract escalation for `tracker.close` (A8).** Not tasked. Open Question 3 for the PRD.

## Dependency and Estimate Review

### D1. PRD Dependency Map versus the task graph

- **REQ-018 depends on REQ-014** in the PRD Dependency Map, while Wave 5 says "REQ-017, REQ-018 after wave 1". The task graph splits this correctly: TRD-004 (binding gate, AC-018-1 and AC-018-3) depends only on TRD-002, and the documentation task TRD-025 (REQ-014) depends on TRD-004. The PRD text is still wrong. TRD-027 does not correct the Dependency Map.
- **REQ-009 depends on REQ-001** in the Dependency Map, while Wave 3 says "no dependency" on wave 1. The task graph honours the wave text: TRD-020 (rename) has no dependencies. TRD-022 (scaffold routing) depends on TRD-016, which is wave 1 work, so the kata-routing part of REQ-009 is not independent. The PRD text still contradicts the graph and should be corrected.

### D2. Chain depth at task level

I computed the longest chains over task edges and re-ran the graph after the final task list. Depth is counted in tasks, so a chain of five tasks has depth 5 and four edges. Maximum depth is 5, reached by four chains: TRD-015-TEST, TRD-022-TEST, TRD-025-TEST and TRD-026-TEST. The deepest, TRD-015-TEST, runs TRD-002 → TRD-033 → TRD-010 → TRD-015 → TRD-015-TEST (5 tasks, 4 edges). Depth was 4 before TRD-033 was added (longest then: TRD-002 → TRD-007 → TRD-015 → TRD-015-TEST); TRD-033 sits between TRD-002 and TRD-010, lengthening every chain that passes through TRD-010. The graph is still acyclic and every edge resolves to a defined task. At REQ level, the PRD chain REQ-001 → REQ-009 → REQ-010 → REQ-014 → REQ-018 is 5 requirements over 4 edges. Task-level depth is within limit; the REQ-level chain is a PRD-level fact and stays flagged.

### D3. Shared-engine dependency

The engine decisions (A1 mechanism, A3, A4, A6, A9) are now tasks, and TRD-016 is wave-1 work that several downstream tasks depend on (TRD-019, TRD-022). The ordering is explicit in the task edges. TRD-003, TRD-004 and TRD-006 are the only tasks that touch the kata preflight path, and all depend on TRD-002.

### D4. Estimate consistency against the final list

The list holds 34 implementation tasks summing to 136h and 33 test tasks summing to 92h, 228h in total. The maximum single task is 6h. Checked against the rules:

- **Paired operations within 1.5×: pass.** `create` (TRD-009, 4h) and `create-detailed` (TRD-010, 5h) are 1.25×. `dep-add` and `dep-remove` share TRD-013 (3h). `comment` and `comments` share TRD-008 (2h). `close` and `close-with-reason` share TRD-011 (4h).
- **No task at 8h or more: pass.**
- **Live capture before estimate: pass.** Read-side and write-side envelopes were both captured live before the estimates were finalized (TRD-009, TRD-010, TRD-011, TRD-012, TRD-013, TRD-014). The shapes they assume are observed, not inferred, so no write-side estimate rests on an undocumented response.
- **Composed operations still design-blocked: fail.** The in-progress rule (TRD-012) and the in-process graph path (TRD-016) are designed. `tracker.label` with multiple ids is decided now but not yet expressible: kata has no bulk, batch, or multi-id form at all and a declarative `run[]` cannot loop, so A1 routes it through a new single-id `tracker.label-one` capability, which the tracker contract has defined since 2026-11-14 (contract `1.1`, `addedInMinor: 1`, recorded at PRD-2026-6995dc96 v1.3.0). TRD-012 (5h) depends on TRD-033 for that capability declaration and should be expected to split.
- **Shared-engine entries at least 1h each: pass in aggregate.** The engine work is inside TRD-016, TRD-028 and TRD-029, which are 6h, 6h and 5h.

## Testability Review

Method: each AC checked for an observable outcome, a named oracle, and undefined terms. Each restated observable is checked against the final task list.

### T-detect. REQ-013 depends on an unenforced detection property (resolved in the list)

`detect.js` returns a single matching candidate. Two or more matches throw `AMBIGUOUS_PROVIDER`. Zero matches return `null`. Detection runs before the shipped default in `config.js#resolveCategory`, so a non-empty kata `detect` signal that matches a repo would win over `tracker: beads` on a project with no toolchain configuration, silently, when kata is the only match. That is what AC-013-2 forbids.

The beads manifest ships `detect: []`. The kata manifest must too, for both categories. The final list owns this:

1. The kata manifest's `detect` is an empty array (TRD-002-TEST, Happy).
2. In a repository containing a kata binding file and no toolchain configuration, the tracker resolves to beads with `source: 'default'` (TRD-005-TEST, Edge). This is the mutation check: with a non-empty `detect`, it must fail.
3. Deleting a project's kata configuration returns the tracker to beads with no further edits (TRD-005-TEST, Edge; AC-013-3).

### Corrections to the AC table

Restated observables, and where the final list owns each:

| AC | Issue | Restated observable | Owned by |
|---|---|---|---|
| AC-001-1 | Requires the resolver source fix (A3), now owned by TRD-031. | `toolchain resolve --json` reports `work-graph` source ≠ `default` when `tracker: kata` is set. | TRD-031 implements it; TRD-031-TEST and TRD-002-TEST assert it |
| AC-002-1 | "Same workspace" is undefined: kata binds per project. | "Same bound project." | TRD-010-TEST |
| AC-003-2 | **Subjective**: "an outcome the caller can observe." | `ok:false` with `error.code` and a message naming the missing reason. | TRD-011-TEST |
| AC-004-2 | "Its owner is reported" names no field; the field is `owner`, now defined by TRD-034. | Normalized output contains `owner` and `status: in_progress`. | TRD-034 defines the field; TRD-012-TEST and TRD-034-TEST assert it |
| AC-005-3 | **Subjective**: "a kind the backend has no equivalent for." | A link kind other than blocking returns a refusal with a reason. Add: a `parent-child` add must not silently replace an existing parent. | TRD-013-TEST covers `related`; the parent case is untested |
| AC-007-1 | The oracle "the backing tracker's own listing order" is unnamed. | Sequence equals `kata ready --json` order on an unchanged snapshot. | TRD-017-TEST |
| AC-008-1 | Checkable, but no shipped adapter honours `filter`. | Keep. Test explicitly. | TRD-007-TEST |
| AC-008-2 | **Subjective**: "populated." | Each of title, status, priority, labels, type is present when set on the item. | TRD-007-TEST; `owner` itself is owned by TRD-034 (see A7) |
| AC-009-4 | **Subjective**: "no longer states … beads project management." | The `implement` route resolves to the neutral command, and its text contains none of `br`, `bv`, `.beads`. | TRD-021-TEST checks routing only; the text check is untested |
| AC-010-1 | **Subjective**: "reaches the same handling." | Each listed phase is accepted with the pre-rename flags and returns the same exit status and phase name. | TRD-020-TEST |
| AC-011-1 | **Subjective**: "explicitly scoped to describing one backend." No scoping marker exists. | Define a named scoping heading. Check: no `br`, `bv`, `.beads` token outside it. | TRD-024-TEST (the heading is not defined in the task) |
| AC-011-2 | "Identically in text" is unmeasured. | The create/link/close prose is byte-identical in the kata and beads renders. | TRD-024-TEST (not byte-checked) |
| AC-013-2 | Was subjective; now mechanically checkable. | Resolves to beads with `source: 'default'`. | TRD-005-TEST |
| AC-014-1, 014-2 | **Subjective**: reader judgment. | A scripted walk-through of the documented commands in a scratch kata project scaffolds the expected items. | TRD-025-TEST |
| AC-015-3 | **Subjective**: "discoverable", "as though it were current." | When a manifest's native/fallback status changes without a regenerated coverage record, the docs check names the capability and exits nonzero. | TRD-026-TEST |
| AC-016-2 | Names an implementation mechanism ("CI job matrix"). | A run without the tool exits 0 and reports at least one skip reading "tool absent" per kata-dependent check. | TRD-030-TEST |
| AC-016-3 | Requires an enumeration of kata-dependent tests. | A tag or path convention defines the set; each tagged test reports *skipped* when the tool is absent. | TRD-030 (guard and audit) |
| AC-017-1 | Passes with a per-subprocess bound while the whole capability takes N× the bound (A6). | Wall-clock of the whole invocation is bounded, and the envelope names the class and bound. | TRD-028-TEST checks per-invocation (gap for fan-out) |
| AC-018-2 | Unobservable "makes no call that the old version cannot serve." | With a version below v0.23.0, preflight returns a named failure containing `0.23.0`, and the probe list contains no subcommand other than version. | TRD-003-TEST |
| AC-018-3 | "Every capability it needed" has no defined set. | Every capability in the flow's declared required set appears as available in the preflight record. | TRD-004-TEST |
| AC-012-2 | "No kata-related failure" is undefined. | Preflight exits 0 and lists no kata adapter among its checks. | TRD-006-TEST |
| AC-006-1 | Objective, but the set is implicit. | Enumerate the six optional-with-fallback capabilities. | TRD-014-TEST (named) |
| AC-001-4, AC-015-2 | Assert a comparison. Acceptable because the oracle is named. | Keep. | TRD-015-TEST |

Also checkable as written: AC-001-2/3, AC-002-2/3, AC-003-1/3, AC-004-1/3, AC-005-1/2, AC-007-2/3/4/5, AC-008-3, AC-009-1/2/3, AC-010-2/3, AC-011-3, AC-012-1, AC-013-1/4, AC-014-3, AC-016-1, AC-017-2/3, AC-018-1.

Note: the PRD's self-scored Testability of 4.8 is not supported by the subjective and undefined items above.

## Design Readiness Scorecard

Re-scored against the final task list. Supersedes the earlier scorecard in full.

| Dimension | Score (1–5) | Basis |
|---|---|---|
| Architecture completeness | **3** | The list chooses a mechanism for the graph paths (TRD-016 in-process confinement, TRD-018 shared scan, TRD-019 kata source), and in-progress is designed (TRD-012). The earlier FAIL-band reading was wrong to say no task list could resolve A1: the list resolves it for the graph and in-progress paths, and A1 now has a decided answer for labels too, `tracker.label-one` behind a tracker contract amendment. Still open: that amendment (A1), the whole-capability timeout (A6), the close contract (A8), and graph-health truthfulness (TRD-026). |
| Task coverage | **4** | All 18 REQs and 58 ACs are referenced by tasks, and no reused row has a duplicate task. The four implementation behaviours that tests or ACs relied on without an owner now have one each — resolver source (A3, TRD-031), the resolver capability gate and mismatch diagnostic (A4, TRD-032), normalized schema entries (A9, TRD-033) and `owner` in the normalized shape (A7, TRD-034) — each paired with its own test task. This is 4 and not 5 because one behaviour is still unowned and one rests on a ratified decision rather than a task: TRD-028 bounds each operation but nothing bounds a whole capability across its operations (A6), and the `tracker.close` refusal (A8) is covered only by TRD-011 plus the ratified open-question-3 decision that the tracker contract stays at 1.0. |
| Dependency clarity | **4** | Task-level edges are explicit and acyclic. Depth is counted in tasks (see D2): maximum depth is 5, up from 4 before TRD-033 was added, because TRD-033 sits between TRD-002 and TRD-010 so every chain through TRD-010 grew by one. Four chains now reach depth 5 (TRD-015-TEST, TRD-022-TEST, TRD-025-TEST, TRD-026-TEST). Still deducted because the PRD Dependency Map text contradicts the graph and TRD-027 does not correct it. |
| Estimate confidence | **3** | Estimates exist and pass the paired-operation, no-8h and aggregate rules, and the live-capture-first rule now passes: every write-side and read-side shape was observed against v0.23.0 before the estimates were set. Held at 3, not higher, by the rule that still fails — composed-operations-design-blocked: `tracker.label` for multiple ids has a decision (A1, `tracker.label-one`) but no expressible design until tracker contract 1.1 defines it, and TRD-012 depends on it. |
| **Overall (arithmetic mean)** | **3.5** | (3 + 4 + 4 + 3) / 4 = 3.5. |

**Verdict: CONCERNS** (overall 3.5, within the 3.0–3.9 band; PASS requires at least 4.0).

Not provisional: the requirements trace and the task list, now that write-side shapes are settled, both rest on evidence. The two things keeping this below PASS are design decisions that are not made yet — the tracker contract amendment that makes `tracker.label-one` buildable, and graph-health truthfulness for trackers with no dependency data (A3, A4, A7 and A9 are now owned by TRD-031 through TRD-034) — not missing information.

What would move the score most:

1. ~~Capture JSON envelopes for every write-side kata command~~ — done 2026-11-14; estimate confidence moved 2 → 3.
2. ~~Own the four unowned behaviours in C4~~ — done 2026-11-14 by TRD-031 through TRD-034; task coverage moved 3 → 4. What is left for task coverage to reach 5 is deciding TRD-026's behaviour for trackers with no dependency data.
3. Land the tracker contract amendment adding `tracker.label-one` (A1) and ratify `owner` in the normalized shape (A7), then split TRD-012 to match. That is what moves architecture completeness and estimate confidence toward 4.

**What changed and why:** Architecture completeness rose from 2 to 3 because the final list chooses the graph mechanism and designs in-progress; it holds at 3 because the label mechanism, though decided in A1, is not implementable until tracker contract 1.1 defines `tracker.label-one`. Task coverage rose from 3 to 4 because TRD-031 through TRD-034 now own the four behaviours that previously had tests without owners. Dependency clarity rose from 3 to 4 on task-level evidence. Estimate confidence rose from 2 to 3 on 2026-11-14, when the write-side capture closed the live-capture-first rule; it does not go higher while `tracker.label-one` remains an undescribed contract capability. Overall moved 3.25 → 3.50, still inside the CONCERNS band.

### Open Questions for the PRD

1. **Graph-health for trackers without dependency data (TRD-026, AC-007-5, AC-015-1).** Should the builtin fallback report a clean result or "unknown" when a tracker exposes no dependency links? A clean result hides the gap REQ-015 is meant to disclose.
2. **AC-004-3 amendment (TRD-027).** Should `set-status closed` refuse without a reason and evidence? TRD-027 says yes. Confirm with the architecture owner.
3. **`tracker.close` contract (A8).** The contract declares inputs `[id]`, while kata requires reason and evidence. Amend the contract (a requirements change), or keep the refusal-by-placeholder in TRD-011? Either needs an owner decision.
4. **Multi-id labelling (AC-004-1, A1) — decided, awaiting a contract amendment.** AC-004-1 means one id per call: the architecture owner chose to add `tracker.label-one` to tracker contract 1.1, with callers looping per id, rather than loop the declarative runner. Confirm the tracker contract 1.0 to 1.1 and work-graph 2.0 to 2.1 bumps, which the PRD treats as requirements changes and therefore owns.
5. **Name of the owner field (AC-004-2, AC-008-2, A7) — decided, awaiting a contract amendment.** TRD-034 names it `owner` and makes it a declared property of the normalized work-item shape rather than an `additionalProperties` survivor. The normalized shape is part of tracker contract 1.0 and is not TRD-only, so the amendment must ratify the field.
6. **Dependency Map text (D1).** The PRD still states REQ-018 depends on REQ-014 and REQ-009 on REQ-001. The task graph does otherwise. Approve a PRD correction, or accept that the TRD is authoritative for scheduling.
7. **Idempotency key reuse (TRD-010).** kata's idempotency key fails with a conflict when the same key carries different fields. Creating with the external key as the idempotency key may refuse a legitimate re-create after an edit. REQ-002 is silent. Accept the behaviour, or specify it.
8. **Kata timeout values (REQ-017, TRD-028).** The PRD leaves seconds to the TRD, but no task sets kata's short or long defaults. Who sets them, and from what measured latency (TRD-001's fixtures are read-only)?
9. **Ordering oracle (AC-007-1).** `kata ready` orders by most-recently-updated, so a sequence changes under unrelated edits. Is that acceptable as the oracle for "stable"?

10. **Remote-gateway authentication is not covered by any requirement — resolved by scoping this TRD to locally-spawned kata daemons.** The PRD's 18 requirements stop at "a Kata project" and never mention a gateway, yet the adapter `env` block names `KATA_SERVER` and `KATA_AUTH_TOKEN`, and the error-mapping design assumes an auth-failure envelope. A live probe against a gateway showed the remote path is refused outright without a valid browser session token (`web_session_required`, `kind: internal`, `exit_code: 1`), plus a second refusal mode (`origin_forbidden`, from an `Origin` header the CLI controls) that no design mentions. Both fall outside the 2/3/4/5/7 exit-code taxonomy the error mapping assumes, and `origin_forbidden` in particular is decided by the gateway, so an adapter cannot work around it by setting headers itself: `KATA_AUTH_TOKEN` is a hard prerequisite for the remote path rather than an optional enhancement, and the 401/403 auth envelope that the error mapping assumes has never been captured. **Decision (architecture owner, 2026-11-14):** delivery is scoped to locally-spawned kata daemons; the remote kata gateway is out of scope for this TRD, and no task here is expected to reach or test it. What remains open is only whether a future gateway-backed delivery adds its own requirement covering gateway auth and captures that failure envelope.

_Merged from the architecture review and the readiness gate; numbering is per source._


