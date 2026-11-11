### Phase 2: Scaffold

#### Step 2.1: Plan and create beads

Skipped when IS_RESUME or EXECUTE_ONLY. The scaffold-plan PLAN is authoritative; execute it, never re-derive titles, descriptions or edges.

- `node "$TRD_CLI" parse "<TRD_FILE_PATH>"` -> `trd` (title, slug, prFormat, phases[{n,title,shippableState,taskIds}], tasksById, warnings). Print warnings. `ok:false`/non-zero -> HALT.
- `node "$TRD_CLI" scaffold-plan "<TRD_FILE_PATH>"` -> `{ok, slug, plan}`; failure -> HALT. Print `plan.warnings`.
- Cache existing beads once: node "$TOOLCHAIN_CLI" run tracker.list, keyed by title prefix (`[trd:<slug>]`, `[trd:<slug>:pr:<N>]` or `[trd:<slug>:phase:<N>]`, `[trd:<slug>:task:<ID>]`). Never re-query per bead.
- Create in order `plan.epic`, `plan.stories[]`, `plan.tasks[]`, `plan.synthesizedTests[]`. Skip any entry whose titlePrefix is cached (use the cached id). Otherwise run node "$TOOLCHAIN_CLI" run tracker.create --arg title="<title>" --arg type=<type> --arg description="<description>" and capture `.data.id` (no priority/labels/externalRef arg; externalRef folds into description, labels backfilled later). Beads open with `## References`. HALT on any failure or empty id. Record ROOT_EPIC_ID, story ids by phase, TRD_TO_BEAD_MAP[task id], PHASE_TASK_IDS[phaseN].
- Then wire `plan.deps` once: each `{type, blockerId, blockedId}` has title-prefix endpoints (`[trd:<slug>]` -> epic, `...:pr:<n>`/`...:phase:<n>` -> story, `...:task:<id>` -> task bead); run node "$TOOLCHAIN_CLI" run tracker.dep-add --arg id=<blocked_bead_id> --arg dependsOnId=<blocker_bead_id> --arg type=blocks. `{ok:false,unavailable:true}` -> warn once, skip remaining edges. Otherwise: existing edges are a no-op; warn and skip unresolvable ones. Also remove stale inter-phase edges from older scaffolds (reference section 5).
- node "$TOOLCHAIN_CLI" run tracker.sync. Print epic id and story/task/dep counts.
- Test task beads (`isTest`) carry their `Test AC:` scenarios in the description. For BDD scenarios the specialist that implements the bead resolves REQNROLL_CLI (`packages/product/lib/reqnroll-cli.js`), runs `generate-bindings <PRD_PATH> --out tests --sut <SUT_CSPROJ>`, confirms RED, delegates to reqnroll-binding-specialist (`packages/reqnroll/skills/reqnroll/SKILL.md`), and re-confirms RED before the paired implementation bead goes GREEN.

#### Step 2.2: Work-graph analysis and handoff

Optional graph planning, optional Foreman tagging, then stop if PLAN_ONLY.

- Run work-graph.plan (tracks) and work-graph.graph-health (cycle/stale-blocker findings) via node "$TOOLCHAIN_CLI" run <capability>; both optional. {unavailable:true} on either -> warn and skip it (no triage-style capability; its summary folds into graph-health's `findings`). {ok:true} -> print tracks, recommendations, findings. Non-empty `findings` HALT before execution until fixed (or /ensemble:refine-beads); unexpected blockers or priority/order mismatches ask continue / refine-beads / abort (non-interactive: continue).
- `--foreman` only: tag task beads for dispatch per reference section 6.
- PLAN_ONLY: print 'Plan complete. Bead hierarchy created. Run /ensemble:implement-trd-beads --execute to begin implementation.' and EXIT. `/ensemble:beads-build <ROOT_EPIC_ID> --plan` regenerates the analysis anytime.

