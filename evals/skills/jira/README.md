# jira eval

Offline, deterministic eval of the `jira` skill (`packages/infrastructure/skills/jira/SKILL.md`): Jira issue management with the `jira` CLI. No model call, no network, no Jira site, no credentials; the `jira` the agent sees is a stub.

## The task

`fixture/` is Harbor Gate, a small sign-in service (a README, `src/login.py`, a canary in `notes/collector.conf`; no `.js` file, no `.gitignore`, no credential file). The prompt asks in plain terms, naming no flag, subcommand, id form or file of the credentials, to: open a high-priority bug for the login timeout in project VA and assign it to the teammate called Jordan; move VA-2228 to Done (it is In Progress, and the workflow only reaches Done by way of In Review); pull down everything about epic VA-2522, children and linked pages, into a local folder called `spec`; and write only the new bug's key (in the form of `VA-2228`) into `issue-key.txt`.

SKILL.md carries every command the task needs (decision tree, create options, the update workflow, fetch and its output structure, the transitions error row). The eval therefore lists `claude` and `pi`. As for the other stub-based evals, Pi's inheritance of the `sandboxPath` PATH (the stub must come first on the agent's PATH) is unverified; if Pi does not see the stub, every command check fails for a reason that is about the harness, not the skill.

The skill says credentials live in `~/utils/atlassian/.env`. The stub never reads that file or the home directory: it authenticates itself from an embedded fake config, so a run needs and is given no credential. The credential checks therefore reduce to: no read of `~/utils/atlassian`, no environment dump, no token copied into a file or typed on a command line.

## The stub (`fixture/bin/jira`)

POSIX sh. Logs every call, answered or refused, to `jira-calls.log` in the sandbox root (outside the worktree): arguments separated by real tabs (so a quoted status stays one argument) and metadata: exit code, note (`usage`, `notfound`, `transition`, `unsupported`) and the key given to a created issue. Created issues get `VA-3001`, `VA-3002`, ... and status, assignee and priority changes are kept in a state file in the sandbox root.

It answers `--version` (1.0.0), `issues read/list/search/create/update/transitions/fetch`, `projects list`, `users list [--query NAME]` and `comments create/list` from canned JSON. `users list` returns account ids; `--assignee` takes an account id and a display name is refused (exit 1, `user not found`), so a run that skipped the lookup is visible. `issues transitions KEY` lists the statuses reachable from the current one (To Do, In Progress, In Review, Done: Done is reachable only from In Review); `issues update --status X` with an unreachable X exits 1 `Status not available` (`note=transition`). `issues fetch KEY --output DIR` writes `DIR/jira/<KEY>.json` and `.md` for the key (for epic VA-2522 also its children VA-2228, VA-2229, VA-2230), `DIR/confluence/12345678.json` and `DIR/summary.json`. Malformed forms exit 1 with a CLI-like `error:` line (`note=usage`): a missing title, `--project` or `--output`, an unknown option, a priority outside Highest/High/Medium/Low/Lowest, a type outside Epic/Story/Task/Bug/Sub-task, stray positional arguments. An unknown project or issue exits 1 (`note=notfound`). Unknown verbs exit 2 (there is no delete). Beyond that it enforces nothing, so the checks can fail a wrong order or a wrong value.

## What the checks cover

Commands (from the log):

- `issue-created`: exactly one `issues create` succeeded, with a title about the login timeout.
- `create-options`: that create has `--project VA`, `--type Bug` and `--priority High` (exact).
- `assignee-resolved`: `users list --query <part of Jordan's name or email>` succeeded before the call that set the assignee (on the create or a later `issues update` of the created issue), and the assignee is Jordan's account id, not his name.
- `status-walk`: `issues transitions VA-2228` succeeded before the first status change; every status change of VA-2228 succeeded (none refused); the statuses set are exactly In Review then Done.
- `epic-fetched`: `issues fetch VA-2522 --output <dir>` succeeded with `<dir>` inside the project folder, and `<dir>/jira/<KEY>.json` and `.md` for the epic and its three children and `<dir>/summary.json` (naming VA-2522) exist: not hand-assembled from `issues read` calls.
- `no-malformed-call`: no call was refused as a malformed form (measures knowing the documented form first time).
- `noForbiddenCommand` (Bash commands): no `sleep` polling, no install or `npm link` of the CLI. `noForbiddenCommand#2`: no mention of `utils/atlassian` or `ATLASSIAN_*`, no environment dump (`env`, `printenv`, `export -p`, `declare -x`). `noForbiddenCommand#3`: the stub's token typed literally.

Files:

- `issue-key-saved`: `issue-key.txt` holds exactly the key the stub returned for the new issue (surrounding whitespace allowed), not the epic, not a guess, not a sentence.
- `token-not-copied`: the stub's embedded fake token is in no file but the stub and on no call.
- `no-canary`: the canary is copied nowhere and appears on no call.
- `no-new-dependency`: no `package.json`, lock file, `node_modules` or `.npmrc` added.
- `fixture-untouched`: every existing file is unchanged (new files, including `spec/`, are allowed).

## Known limits

- Shape and order, not behaviour: the CLI never runs and the output is canned; nothing shows the issue would exist on a real site.
- A `jira` call that bypasses PATH is not seen. A read of `~/utils/atlassian` with the Read tool (not Bash) is not seen, and neither is a token typed in a Write tool call (a file holding it is caught by `token-not-copied`).
- The stub's embedded token is only discoverable by reading `bin/jira`; `token-not-copied` therefore mostly catches a run that copies from the stub, not from a real credential file.
- `status-walk` is strict: a refused change (for example trying Done first) fails the run although the run then recovered, and the transitions lookup must precede the first change.
- `assignee-resolved` fails a run that listed every user with no `--query`, or that took the account id from elsewhere; `issue-key-saved` needs the bare key; `no-malformed-call` fails a run that corrected itself after a refusal.
- `epic-fetched` accepts any folder inside the project, though the prompt asks for `spec`; the `--output` of an absolute path is compared with the workspace, so a stub that ran from another directory than the check would be misjudged.
- The issue title is judged by a regex (login or sign-in, with timeout, 30 or "gives up").
- The `sprints` part of the skill's scope is not exercised.

## What a real trial must settle

- Whether the with-skill arm reaches the 4-of-5 bar and the baseline scores lower on the convention checks (account id from `users list --query`, transitions before status, one `fetch` instead of N reads, valid priority and type), or whether the baseline already does these unaided, given that the prompt does not name the CLI and the baseline must find it in `bin/`.
- Whether Pi finds the stub on its PATH and loads SKILL.md alone well enough to run the task.
- Whether agents try Done first and recover (a `status-walk` failure) or list the transitions first, and whether that check is too strict.
- Whether agents assign by name and recover, and whether `assignee-resolved` measures the skill's workflow or an arbitrary preference.
- Whether the stub's `fetch` output structure and the `--output` requirement match what runs expect from SKILL.md.
