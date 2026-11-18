### Phase 2: Scaffold

#### Step 2.1: Plan and create beads

Skipped when IS_RESUME or EXECUTE_ONLY. The scaffold-plan PLAN is authoritative; execute it, never re-derive titles, descriptions or edges.

- `node "$TRD_CLI" parse "<TRD_FILE_PATH>"` -> `trd` (title, slug, prFormat, phases[{n,title,shippableState,taskIds}], tasksById, warnings). Print warnings. `ok:false`/non-zero -> HALT.
- `node "$TRD_CLI" scaffold-plan "<TRD_FILE_PATH>"` -> `{ok, slug, plan}`; failure -> HALT. Print `plan.warnings`.
- `node "$TRD_CLI" scaffold-calls "<TRD_FILE_PATH>"` -> `{creates[{titlePrefix,args}], deps[]}`.
- Cache existing beads once: node "$TOOLCHAIN_CLI" run tracker.list by title prefix (`[trd:<slug>]`, `[trd:<slug>:pr:<N>]` or `[trd:<slug>:phase:<N>]`, `[trd:<slug>:task:<ID>]`); kata's is open-only, so closed items are not cached.
- Create `creates[]` in order (`plan.epic`, `plan.stories[]`, `plan.tasks[]`, `plan.synthesizedTests[]`); a cached titlePrefix reuses its id. An entry not cached first runs tracker.find-by-key --arg key=<externalKey> (also sees closed items); a hit reuses its id, else node "$TOOLCHAIN_CLI" run tracker.create-detailed with `args` as `--arg k=v`, capturing `.data.id`. `{ok:false,unavailable:true}` -> run tracker.create --arg title="<title>" --arg type=<type> --arg description="<description>" (no priority/labels/externalRef arg; externalRef folds into description, labels backfilled later). kata create-detailed carries no labels or type, so labels arrive only via the Delegate-phase backfill (tracker.label). Beads open with `## References`. HALT on any other failure or empty id. Record ROOT_EPIC_ID, story ids by phase, TRD_TO_BEAD_MAP[task id], PHASE_TASK_IDS[phaseN].
- Wire `plan.deps` once: `node "$TRD_CLI" scaffold-dep-args "<TRD_FILE_PATH>" --ids '{"<titlePrefix>":"<id>",...}'` -> `{deps[{id,dependsOnId,type}], unresolved[]}` (keys like `[trd:<slug>]` = epic; warn, skip `unresolved`); each dep: node "$TOOLCHAIN_CLI" run tracker.dep-add --arg id=<blocked_bead_id> --arg dependsOnId=<blocker_bead_id> --arg type=<type>. `{ok:false,unavailable:true}` -> warn once, skip the rest; existing edges no-op. Also remove stale inter-phase edges (reference section 5).
- node "$TOOLCHAIN_CLI" run tracker.sync. Print epic id and story/task/dep counts.
- Test task beads (`isTest`) carry their `Test AC:` scenarios in the description. If BDD_MODE.enabled the specialist follows "TRD commands" in `packages/reqnroll/skills/reqnroll/SKILL.md`; otherwise it writes them in the repo's own framework and runs them with `test-runner.run`. RED before the paired implementation bead goes GREEN.

#### Step 2.2: Work-graph analysis and handoff

Optional graph planning, optional Foreman tagging, then stop if PLAN_ONLY.

- Run work-graph.ready, work-graph.plan and work-graph.graph-health (cycle/stale-blocker findings) via node "$TOOLCHAIN_CLI" run <capability>, never a tracker binary. {unavailable:true} -> warn and skip it. {ok:true} -> print ready items, tracks, recommendations, findings. Non-empty `findings` HALT before execution until fixed (or /ensemble:refine-beads); unexpected blockers or priority/order mismatches ask continue / refine-beads / abort (non-interactive: continue).
- `--foreman` only: tag task beads for dispatch per reference section 6.
- PLAN_ONLY: print 'Plan complete. Bead hierarchy created. Run /ensemble:implement-trd-tasks --execute to begin implementation.' and EXIT. `/ensemble:beads-build <ROOT_EPIC_ID> --plan` regenerates the analysis anytime.
