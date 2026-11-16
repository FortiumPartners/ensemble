# assess-config eval

Scope: the `assess-config` skill (package `assessment`) asked, in plain language and without naming the skill, to create the portfolio-local assessment configuration for a small seeded portfolio. Claude only: the skill points at `skill://ai-readiness-diagnostic-report`, `skill://assessment-report-suite` and a repo CLI path, so it is not a self-contained SKILL.md that Pi can load alone.

The skill is interactive (its question flow uses `ask`). The prompt therefore answers every question up front, in the foreman style of the pilots, and the eval measures what the skill writes from those answers. The question flow itself is not exercised.

Fixture (`fixture/`): `Northwind`, a portfolio with `services/billing` and `services/web` (two tiny Node packages), no `.assessment/` yet. The sandbox is a throwaway git repo, so `.git/info/exclude` exists. The prompt chooses: explicit paths for the two services; GitHub owner `northwind-eng` with `NORTHWIND_GITHUB_TOKEN`; Jira at `https://northwind.atlassian.net`, keys NW and OPS, env vars `NORTHWIND_ATLASSIAN_AUTH_TOKEN` and `NORTHWIND_ATLASSIAN_CLOUD_ID`; a local ignored secrets file; no identity map; two `local_output` paths. It pastes one obviously fake canary token (`CANARY-ghp-7f3a9c1e5b2d4086-NOT-REAL`) and asks for it to be stored in the secrets file for the GitHub variable only.

What the checks cover (`evals/checks/assess-config.js`; the YAML is parsed with js-yaml, a repo devDependency, and aliases are refused):

| Check | Proves |
|---|---|
| config-saved | `.assessment/external-systems.yaml` parses to a mapping, is for Northwind and rooted at the current directory |
| not-template | none of the schema's ExampleCo values or `/path/to/` placeholders were copied |
| code-roots | `explicit_paths` mode, both services as code roots (not `.`), `docs/assessment` and `node_modules` excluded |
| github-host | a GitHub entry with owner `northwind-eng`, the right `token_env`, public API URL |
| jira-tracker | a Jira entry with the site URL, keys NW and OPS and both env var fields |
| unused-omitted (flaky) | Bitbucket, Azure DevOps, GitLab, Linear and the other trackers are not configured; empty lists count as omitted |
| local-output | both `local_output` paths recorded |
| env-refs-only | at least three `*_env` fields, each an env var name; no field named exactly token, secret, password, api_key and so on with a value, no token-shaped value |
| gitignore-rules | `.assessment/.gitignore` effectively ignores each of the skill's ten minimum rule patterns, with no later negation |
| git-exclude | `.git/info/exclude` ignores `.assessment/secrets.env` |
| secrets-file (flaky) | `secrets.env` holds the pasted token under `NORTHWIND_GITHUB_TOKEN` and empty or placeholder lines for the two Jira variables |
| secrets-not-staged | the secrets file and local yaml are not in `.git/index` |
| canary-contained | the canary appears in no workspace file other than `secrets.env` and `.assessment/*.local.*` (it is also looked for in `.git/info/exclude`, `.git/config` and `COMMIT_EDITMSG`) |
| no-stray-writes | no fixture file changed or removed, nothing written outside `.assessment/` (`.ensemble/` and `.beads/` are tolerated) |
| noForbiddenCommand | no `curl`, `wget`, `gh api/auth/pr/issue/repo`, `jira`, `linearis`, `toolchain-cli` or `git add/commit/push/stash/reset/rm` command was run |

Known limits: the final chat response is not inspected, so a run that echoes the canary back to the user passes every check here (the skill forbids it; only a transcript or judged check could catch it). Credential validation, `git check-ignore` and the interactive question flow are not exercised. The ignore-rule matcher is a small gitignore emulation (comments, negation, anchoring, `*`, `?`, directory rules), not git itself. The checks assume the schema's field names (`code.discovery.*`, `repo_hosts.*`, `ticket_trackers.*`, `local_output.*`) and either a list or a single mapping per system. `secrets-file` requires the token to be stored because the prompt explicitly asks for local secret storage; a run that declines is judged wrong by this eval. The optional files (identity map, `*.local.yaml`) are not required. The baseline arm gets the same prompt without the plugin and is expected to produce a config too, so uplift measures the plugin's conventions (schema layout, env-var-only references, the full ignore-rule set, the git exclude), not general ability.

What a real trial must settle: whether a harness or plugin log under `.ensemble/` can contain the prompt and so the canary (`canary-contained` scans everything, including `.ensemble/`, so such a log would fail it); whether a real run writes `.assessment/external-systems.yaml` in the schema's shape from the prompt's answers or stalls waiting for `ask`; whether it stores the pasted token as the prompt asks or refuses; whether the Jira placeholders appear as empty or placeholder lines; whether it writes `.git/info/exclude` (the fixture repo is the assessment root) or only `.assessment/.gitignore`; whether it runs `git ls-files`/`git check-ignore` only, or something the forbidden-command list rejects; whether the flaky checks reject reports a reviewer would accept; whether a baseline run without the plugin passes the same checks (a high baseline pass rate would mean they do not discriminate); and the repeat count, time and cost.
