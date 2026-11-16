# Skills eval: arms, repeats and the Claude Code adapter

How `node evals/run.js --skill <skill> --runtime claude` measures a skill: each eval runs with the skill and without it, repeated, and reports reliability, uplift and whether the skill was actually invoked. General harness usage is in `evals/README.md`; this guide records how the Claude Code adapter loads and detects skills and what the numbers mean.

## Arms

| | with-skill | baseline |
|---|---|---|
| Workspace | fresh copy of `fixture/` | identical fresh copy |
| Prompt | `prompt` (explicit mode: `command` + space + `prompt`) | `prompt` |
| Settings | `--setting-sources project`, same tools, turns, model | the same |
| Loaded | `--plugin-dir packages/<pkg>`: the package that ships the skill, as shipped (never a copy) | no plugin for the skill under test |

`--setting-sources project` is passed to both arms, so user-level settings and synced or marketplace plugins cannot leak into either one. The job passed to the runner carries `pluginDirs[]` (a list: a skill may need more than one package) and `skillPaths[]`.

A baseline run is checked for isolation. Missing evidence is never read as clean:

- **Leak.** The eval aborts, naming the leak, when the runtime reports the skill under test as loaded, the transcript invokes it, or its package appears among the loaded plugins (plugin paths are compared by `realpath` on both sides, falling back to the resolved path when it does not exist, so a symlinked path is still caught). A leak outranks the cases below.
- **`baseline isolation unverifiable: no startup skill list`.** A baseline that completed normally (not timed out, exit 0) whose stream had no `system`/`init` skills list (`loadedSource` is not `startup-event`) cannot be told from a leaked one. The eval aborts under that name, exactly like a leak.
- **Crashed or timed-out baseline before any init event.** That run is marked `outcome: "unverifiable"` and is not counted toward the baseline score (it appears as `notRun` and in `baseline.unverifiable`; its cost still counts). The eval continues with the remaining runs.

After an abort the baseline is not scored (`baseline: null`, no uplift), runs of that eval that have not yet started are skipped, and the run exits 1. A skill the model already knows is not a leak: its baseline passes too and the uplift is near zero, which is a valid result.

Several `system`/`init` events in one stream are unioned (skills and plugins); a later event never overwrites an earlier one.

**Fixtures.** The workspace is a copy of `fixture/`, and both arms use `--setting-sources project`, so project configuration in the fixture would be honoured and run with the agent's environment. An eval whose fixture contains `.claude/`, `.claude.json`, `.mcp.json`, `.git`, `.gitmodules`, `.gitattributes` or `.gitconfig` (at any depth, any letter case), or a symlink that points outside the fixture (or has an absolute target), is rejected with an error naming the eval and the file. The sandbox copy applies the same rules defensively: those entries are skipped, and a symlink is never followed out of the fixture.

**Judged checks** run on the with-skill arm only: `judgedScore` reads only that arm, so the baseline arm skips them and no judge spend is wasted (the judge reservation is not taken for baseline runs either).

**Definition limits.** `skill` must match `^[A-Za-z0-9._-]+$` (and not be `.` or `..`), and its directory must resolve under `packages/<pkg>/skills`. A `prompt` (or `command`) must not begin with `-`, and `allowedTools` entries must not contain a comma, a control character or leading/trailing whitespace (they are joined with commas on the command line; scoped patterns such as `Bash(git status:*)` are valid). A `bar` above `repeats` is rejected at load only when the eval sets both; otherwise it is checked at run time against `--repeats` or the `evals/limits.json` default.

## Repeats and reliability

Each arm runs `repeats` times (default 5, `evals/limits.json`), at most `--concurrency` at a time (default 4), with budget reserved per in-flight run (at most `--concurrency` runs are reserved at once). With-skill reliability is `passes >= bar` (default bar 4 of 5, `evals/limits.json`). The eval is `pass` when reliable, `fail` when the bar can no longer be reached, `incomplete` when the budget stopped it earlier.

- `repeats` and `bar` in `eval.json` override the defaults; `--repeats N` overrides both the eval and the default.
- When the bar is not set by the eval and the repeat count differs from the default, the default bar is scaled (`ceil(4/5 * repeats)`: 2 of 2, 3 of 3, 8 of 10). The report states each value and its source (`default`, `eval`, `flag`, `scaled`).
- A bar above the repeat count (an eval `bar` with a smaller `--repeats`) is a usage error, exit 2.
- `expectInvoked` is report-only: `invokedAsExpected` is recorded and printed, and the verdict does not change.

## Uplift

Uplift is the with-skill pass rate minus the baseline pass rate (a fraction, `+0.60` is 60 points). **For the Claude runtime it is package-level (skills share a package).** `--plugin-dir` loads a whole package, so every skill, command and agent in it is present in the with-skill arm, not only the skill under test. Pi loads one skill with `--skill`, so Pi uplift is skill-level. The two are not comparable quantities; the report prints the granularity beside the number.

## Claude Code startup events (probed)

Probed with Claude Code 2.1.311 (`claude -p ... --output-format stream-json --verbose --setting-sources project --model haiku --max-turns 1`), one run with `--plugin-dir packages/development` and one without, then one run asked to use a skill. Cost per probe run: about $0.002 to $0.004.

**The startup event does list loaded skills.** The first stream line is `{"type":"system","subtype":"init", ...}` with, among other keys:

- `skills`: array of skill names, plugin skills namespaced `<plugin>:<skill>` (for example `ensemble-development:completion-verification`), built-in ones bare (`verify`, `design`). 55 entries with the plugin, 19 without. It lists skills that are available, not skills that were used.
- `plugins`: array of `{ name, path, source, version }`. The loaded plugin appears with its absolute `path` (`.../packages/development`, `source` `...@inline`); built-in plugins have `path: "builtin"`. Without `--plugin-dir` only the four built-ins appear.
- Also `slash_commands`, `agents` (plugin ones namespaced), `tools`, `mcp_servers`, `model`, `claude_code_version`.

**Skill invocation event.** When the agent uses a skill, an assistant message carries a `tool_use` block `{"type":"tool_use","name":"Skill","input":{"skill":"ensemble-development:completion-verification"}}`, answered by a `tool_result` ("Launching skill: ...").

How the adapter uses this (`evals/lib/runners/claude.js`):

- `loadedSkills` is the union of the init event's `skills` and the skills named in `Skill` invocations; `invokedSkills` is the second set alone; `loadedPlugins` is the init `plugins` that have a path. `loadedSource` is `startup-event` when the init event carried a `skills` array, else `transcript-scan`. When the startup event lists no skills (another Claude Code version, a changed stream), `loadedSkills` is derived from the invocation events alone and the leak check uses that scan.
- The events are read as the stream arrives (not from the capped transcript), so a long run cannot push the init event out.
- A skill name matches `name` or `<plugin>:name`.
- `invoked` for a run is whether `invokedSkills` names the skill under test.

Observed, not controlled: the init event of every run listed claude.ai connector MCP servers (`mcp_servers`, 20 in the runs where the list was read; one early probe without a plugin listed none, which looks like connectors still loading). `--setting-sources project` does not remove account-level connectors, so they are present in both arms and do not differ between them, but they are not part of the skill under test.

Not verified: a slash command typed as the prompt (`invocation: explicit`) was not probed, so it is not known whether the stream shows it as a `Skill` tool_use. `invoked` counts only `Skill` tool_use events; an explicit-mode run that expands the command without that event would record `invoked: false`.

## Which copy was evaluated

Each eval result and the console state the evaluated copy: the package path loaded (`packages/<pkg>`), the skill directory's content hash (`skillHash`), the skill's `metadata.version` when present, and whether the working tree differs from the committed copy (`git status` on the package: it is loaded whole, so any edit in it counts, with the first changed files listed). `workingTreeDiffers` is `null`, shown as unknown, outside a git checkout. The installed (marketplace) copy is not inspected.

## Runner interface

`evals/lib/runners/index.js` registers runners by runtime name; `claude.js` is the only one so far (Pi comes later). `run(job)` resolves `{ transcript, exitCode, timedOut, costUsd, loadedSkills, runtime }` plus `invokedSkills`, `loadedPlugins`, `loadedSource`, `stderr`, `transcriptTruncated`, `commands`, `commandsIncomplete`. A job is `{ evalId, skill, arm, runtime, model, prompt, workspace, env, timeoutMs, maxUsd, pluginDirs[] | skillPaths[], maxTurns, allowedTools }`. `costUsd` is `null` when the stream reported none, and the scheduler then charges the run's full reservation.
