# Migrating hardcoded tool references to the toolchain

Shared commands, agents and skills must not name tool binaries such as `gh`, `br` or `terraform`. They call capabilities (`tracker.show`, `host.change-request-create`, `workflow.push`) through the toolchain CLI, and the resolved adapter decides which tool runs. This guide is for downstream forks and for anyone whose source fails one of the two checks that enforce this: `node scripts/lint-provider-refs.js` and `node scripts/check-taxonomy-coverage.js`. Each failure class below has a heading, an example of the failing source (Before) and the fixed source (After).

Find the capability you need in the generated [category contracts](../toolchain/contracts/README.md). To add a tool that no adapter covers, see the [adapter authoring guide](adapter-authoring.md).

## How a command calls a capability

A command that uses capabilities does four things:

1. Declares them under `metadata.capabilities.required` (and `optional`) in its YAML.
2. Grants the `Bash` tool in `metadata.allowed_tools`.
3. Runs one preflight that lists every required capability, and keeps its `runId`.
4. Runs each capability with `node "$TOOLCHAIN_CLI" run <capability> --arg name=value --run-id "$RUN_ID" --json`.

`TOOLCHAIN_CLI` is a shell variable holding the path to `toolchain-cli.js`. It is the same convention the existing `TRD_CLI` variable uses for the TRD CLI.

## Running the checks

```bash
node scripts/lint-provider-refs.js
node scripts/check-taxonomy-coverage.js
```

Both print `file:line CLASS detail` for each failure and exit 1 when there is any. The lint scans `.yaml` and `.md` files under `packages/*/commands`, `packages/*/agents` and `packages/*/skills`. It skips `adapter-*` directories, because an adapter is allowed to name its tool, and the generated trees `packages/pi`, `packages/full`, `packages/codex` and `packages/opencode`. Fix the YAML or skill source, then regenerate; never edit generated files.

A segment is checked when it is a line inside a fenced code block, or the content of an inline code span. Prose that mentions a tool without code formatting is not flagged.

### What the lint does not flag

- Calls to Ensemble's own CLIs: `node` followed by a shell variable whose name ends in `_CLI`, such as `node "$TRD_CLI" ...`, `node $TOOLCHAIN_CLI ...` or `node "${TRD_CLI}" ...`.
- Generic shell words listed under `ignoredCommands` in `packages/development/toolchain/tool-inventory.yaml`, such as `cat`, `echo`, `grep`, `ls`, `mkdir`, `test`, `cd`, `rm`, `cp`, `mv`, `sed`, `awk`, `jq`, `head`, `tail`, `wc`, `sort`, `find`, `curl` and `date`.

Plain `git` is a tool binary. Plain git operations are capabilities of the `workflow` category (`workflow.status`, `workflow.commit`, `workflow.push`, `workflow.log`, `workflow.diff`, `workflow.merge-base`, `workflow.remote-url`), served by the `plain-git` adapter by default and the `git-town` adapter when git-town is configured.

### Baseline ratchet and named sources

Existing violations that have not been migrated yet are recorded in `scripts/lint-provider-refs.baseline.json`. Each entry is keyed by file, class and binary and holds a count; there are no line numbers, so edits elsewhere in a file do not invalidate it.

- The lint fails when a key's count is higher than its baseline count, or when a key is not in the baseline. A new violation in an already grandfathered file therefore fails.
- When a count drops, the lint prints `baseline can shrink` for that entry. Run `node scripts/lint-provider-refs.js --update-baseline` to rewrite the file and commit the result. The flag is never run automatically.
- Named sources must have zero violations regardless of the baseline, and `--update-baseline` refuses to run while one has a violation. They are the commands `implement-trd-beads`, `beads-build`, `beads-build-wave`, `implement-bead`, `fix-issue` and `pr-merge` (source `.yaml` and generated `commands/ensemble/*.md`) and the skills `git-town` and `pr-review-cycle`.

The ratchet only goes down. Migrating a file means fixing its violations, then shrinking the baseline in the same change.

## BINARY_IN_COMMAND

A command source under `packages/*/commands/` runs a tool binary directly.

Before:

```yaml
steps:
  - 'Run: gh pr create --base main --head "$BRANCH" --title "$TITLE"'
```

After:

```yaml
metadata:
  capabilities:
    required:
      - host.change-request-create
  allowed_tools:
    - Bash
steps:
  - 'Run: node "$TOOLCHAIN_CLI" preflight --require host.change-request-create --json; RUN_ID=<runId>'
  - 'Run: node "$TOOLCHAIN_CLI" run host.change-request-create --arg baseBranch=main --arg headBranch="$BRANCH" --arg title="$TITLE" --arg description="$BODY" --run-id "$RUN_ID" --json'
```

Argument names come from the capability's `inputs` in its contract. If no capability covers the operation, reword the step to state the intent without a literal command, or add the capability to the category contract and an adapter. Then regenerate the command docs.

## BINARY_IN_AGENT

An agent source under `packages/*/agents/` names a tool binary.

Before:

```markdown
When the tests pass, run `git commit -m "<message>"` and then `git push`.
```

After:

```markdown
When the tests pass, commit with the `workflow.commit` capability and push with `workflow.push`
(`node "$TOOLCHAIN_CLI" run workflow.commit --arg message="<message>" --run-id "$RUN_ID" --json`).
```

Agents inherit the run id from the command that dispatched them, so pass it in the delegation prompt. If an agent only describes a tool in prose, remove the code formatting only when the sentence is genuinely a description and not an instruction to run something.

## BINARY_IN_SKILL

A skill source under `packages/*/skills/` (not an `adapter-*` skill) names a tool binary.

Before:

```bash
git town sync --all
git push
```

After:

```bash
node "$TOOLCHAIN_CLI" run workflow.sync --arg branch="$BRANCH" --run-id "$RUN_ID" --json
node "$TOOLCHAIN_CLI" run workflow.push --arg branch="$BRANCH" --run-id "$RUN_ID" --json
```

A skill that exists to teach a tool belongs in an adapter: move it to an `adapter-<category>-<tool>` directory with an `adapter.yaml`, where naming the tool is allowed.

## MISSING_PREFLIGHT

A command YAML declares `metadata.capabilities.required` but has no single preflight line that lists every one of those ids. A preflight split across lines, or one that omits an id, does not count; the lint reports the `capabilities:` line.

Before:

```yaml
metadata:
  capabilities:
    required:
      - host.change-request-create
      - workflow.push
steps:
  - 'Run: node "$TOOLCHAIN_CLI" preflight --require host.change-request-create --json'
```

After:

```yaml
metadata:
  capabilities:
    required:
      - host.change-request-create
      - workflow.push
steps:
  - 'Run: node "$TOOLCHAIN_CLI" preflight --require host.change-request-create --require workflow.push --json; on {ok:false} print error.message and HALT. RUN_ID=<runId>'
```

Optional capabilities are not preflighted. Add each new required id to the preflight line whenever you add it to the list.

## MISSING_BASH_GRANT

A command YAML declares capabilities and has a `metadata.allowed_tools` list that does not include `Bash`. The toolchain CLI is run through `Bash`, so the command could never call it. A command with no `allowed_tools` key at all is not flagged.

Before:

```yaml
metadata:
  capabilities:
    required:
      - tracker.show
  allowed_tools:
    - Read
    - Write
```

After:

```yaml
metadata:
  capabilities:
    required:
      - tracker.show
  allowed_tools:
    - Read
    - Write
    - Bash
```

## UNMAPPED_TOOL

Reported by `node scripts/check-taxonomy-coverage.js`, not by the lint. A command in a fenced shell block of a shared source, or a binary declared by a shipped adapter, is in neither `packages/development/toolchain/tool-inventory.yaml` nor its `ignoredCommands` list. The check reads fences tagged `bash`, `sh`, `shell`, `zsh`, `console` or untagged, and looks at the first word of each line and of each segment after `&&`, `||`, `;`, `|` or `$(`.

Before:

```bash
# in a shared SKILL.md; "mytool" is in neither the inventory nor ignoredCommands
mytool deploy --env staging
```

After:

```yaml
# tool-inventory.yaml
container-deploy:
  - mytool
```

A tool must map to exactly one category. If the word is a generic shell utility rather than a provider tool, list it under `ignoredCommands` instead. If the source should not name the tool at all, use a capability as in `BINARY_IN_COMMAND`. A tool that is mapped does not make the lint stop flagging it: the lint flags every mapped binary, so the real fix for a source is the capability call, and mapping only keeps the inventory complete.

## DUPLICATE_TOOL_MAPPING

Reported by `node scripts/check-taxonomy-coverage.js`. A tool in `tool-inventory.yaml` is listed under two categories, or under a category and in `ignoredCommands`. A tool maps to exactly one category.

Before:

```yaml
host:
  - gh
workflow:
  - gh
```

After:

```yaml
host:
  - gh
```

## UNKNOWN_INVENTORY_CATEGORY

Reported by `node scripts/check-taxonomy-coverage.js`. A key in `tool-inventory.yaml` is neither `ignoredCommands` nor a category with a contract file in `packages/development/toolchain/categories/`.

Before:

```yaml
deployment:
  - mytool
```

After:

```yaml
container-deploy:
  - mytool
```

## MISSING_DEFAULT_ADAPTER

Reported by `node scripts/check-taxonomy-coverage.js`. A category has no entry in `packages/development/toolchain/toolchain.default.yaml`, or its default names an adapter that no shipped adapter provides for that category. Add or fix the default, and ship the adapter (see the [adapter authoring guide](adapter-authoring.md)). The `work-graph: auto` value is valid because it resolves to the built-in link fallback.

Before:

```yaml
# toolchain.default.yaml
iac: pulumi
```

After:

```yaml
# toolchain.default.yaml
iac: terraform
```
