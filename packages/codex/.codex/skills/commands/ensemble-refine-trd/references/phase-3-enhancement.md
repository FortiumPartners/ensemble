### Phase 3: Enhancement

#### Step 3.1: List Available TRDs

If --list is passed (not with --foreman), pick the TRD interactively

- If $ARGUMENTS contains '--list': resolve TRD_CLI per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/trd-cli.js. If none of the 4 tiers resolve OR 'which node' fails: print 'ERROR: Node.js and the TRD CLI (lib/trd-cli.js) are required. Ensure Node.js is installed and the ensemble-development or ensemble-pi plugin bundle is present.' and HALT.
- Run node "$TRD_CLI" list --type trd and parse {ok,type,items}; on failure print the error and HALT. Show a table (ID/Name, Status, Score, Last Modified) and ask the user via AskUserQuestion (id 'trd_select') which TRD to refine. Map the slug to docs/TRD/<file>.md (HALT 'ERROR: Could not resolve path for slug <TRD_SLUG>' if missing) and continue with it as the TRD path.

#### Step 3.2: Content Refinement

Apply changes ONLY for SELECTED_ITEMS; leave unselected sections alone. Fix what the findings identified: missing `[satisfies]`/TRD-NNN-TEST tasks, AC references, architecture justification, integration contracts, oversized tasks, dependency chains, stale references. (PR_FORMAT=true) insert missing `**Shippable State:**` lines, rewrite infrastructure-only ones with a user-observable capability, move tasks to resolve forward dependencies, and place new tasks inside the correct `### PR N:` section. (PR_FORMAT=false, conversion confirmed) convert Phase/Sprint headings in the Master Task List to `### PR N:` with Shippable State lines; leave `## Sprint Planning` unchanged.
If the PRD touches auth, PII, payments, file upload, external network exposure or new third-party integrations and the TRD lacks `## Threat Model`, invoke the `threat-model` skill.

#### Step 3.3: Validation

Verify structural integrity before writing

- Run `node "$TRD_CLI" parse <refined trd>` and diff `tasksById` against the Current TRD Analysis snapshot: fail if any task disappeared or a task line lost its checkbox prefix, and fix before writing. Also verify TRD-NNN IDs are unique, `[satisfies]`/`[depends]` annotations resolve, no cycles were introduced, user-facing tasks have paired TRD-NNN-TEST tasks, and counts match the Master Task List summary.
- If PR_FORMAT=true: every `### PR N:` has a Shippable State line, no task depends on a later PR, and the Master Task List contains only `### PR N:` headings.
