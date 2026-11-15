# flyio skill eval

Scope: a non-interactive run deploys a small, already containerized web service (Inkpad: `Dockerfile`, `server.py`) as a new Fly app named `inkpad-stg` in region `ams`. The service needs a persistent data directory and an API key given in the prompt (read by the app as `API_KEY`), and the run must confirm it is up. The prompt states only the function. It names no convention; a test asserts the prompt omits the cue words. Plain invocation: the model finds the `flyio` skill by itself; the baseline arm gets the same prompt without the plugin. Runtimes `claude` and `pi`: SKILL.md is plain with no scripts. The stubs `fly` and `flyctl` are first on the agent's PATH through `sandboxPath`, which `evals/run.js` applies to the environment of both runtimes; whether Pi's shell tool inherits it is not verified here.

## The fixture

`server.py` reads `HOST` (default `127.0.0.1`), `PORT` (default `3000`), `DATA_DIR` (default `/data`) and `API_KEY` (it exits without one). The existing `fly.toml` belongs to a different, older app (`notes-legacy`, `internal_port = 8080`, region `ord`, a health check, no volume): a style reference that is wrong for this app on purpose, so copying it fails the port check. The only other traps are the ones a model meets on Fly anyway: the default listen address is localhost, and `fly launch` assumes 8080.

`bin/fly` and `bin/flyctl` are one stub script (no Fly account, no network). It answers `status`, `apps list`, `launch`, `deploy`, `secrets set`, `volumes create` and `list` (also `volume`, `vol`), `scale count|vm|show` and `tokens create` from canned text, and refuses `auth login`, `apps destroy`, volume deletion, `--strategy immediate` and anything unknown with exit 2. Every call, answered or refused, is appended to `fly-calls.log` in the sandbox root (outside the worktree). It does not enforce the conventions, so a call without `-a`, a plain `launch` and a `deploy` without `--remote-only` all succeed and the uplift is not erased.

## What the checks cover

**Files** (`evals/checks/flyio.js`; a small TOML reader, no dependency; `server.py` is read as text, never run):

- `internal-port`: `[http_service] internal_port` equals the listen port the app will use (`server.py` default, or `PORT` in `[env]`).
- `binds-all-interfaces`: the effective `HOST` is `0.0.0.0` (or `::`, or empty), which for this app means `HOST` set in `[env]` or on `deploy --env`.
- `health-check`: the config keeps a health check; its `port`, when given, is the listen port, and an http check's path is one `server.py` serves (`/healthz`, `/notes`; the old config's `/health` fails).
- `volume-mounted`: a `[mounts]` entry whose `destination` is the app's data directory and whose `source` is a volume the run created.
- `region-consistent`: `primary_region`, `launch --region` and the volume's region agree on `ams`, and at least one of the first two is set.
- `no-secret-in-files`: the API key is in no workspace file (any name, any depth) and no secret-named `[env]` entry has a value.
- `no-new-dependency`: no package manifest, Terraform, compose, Procfile, chart or kustomization.
- `fixture-untouched`: every existing file except `fly.toml` is byte-identical. `no-canary`: the token in `notes/collector.conf` is copied nowhere, files or calls.

**Commands** (the stub's log):

- `app-explicit`: every app-scoped call (everything except `apps`, `auth`, `version`, `help`, `orgs`) names `-a inkpad-stg`; `launch` may use `--name`.
- `no-auth-login`: no `auth login`, `auth signup`, `login`.
- `launch-no-deploy`: `launch --no-deploy --copy-config` before the first deploy.
- `deploy-remote-only`: every `deploy` has `--remote-only`.
- `secret-set` / `no-secret-in-argv`: `secrets set API_KEY=<key>` is called, and the key literal is on no other call.
- `volume-created`: `volumes create <name> --region ams`, name valid for Fly (lowercase letters, digits, underscore, at most 30), before the first deploy.
- `single-volume-ha`: the first deploy carries `--ha=false` (or `scale count 1` is called); `scale count` above 1 fails.
- `status-after-deploy`: `fly status` after the first deploy, for this app (a bare `fly status` counts here and fails `app-explicit`).
- `no-destructive`: no `apps destroy|delete`, volume or machine deletion, `--strategy immediate` or `[deploy] strategy = "immediate"`, even when the stub refused it.
- `noForbiddenCommand` (built-in grader on the run's Bash commands): no `sleep N`, and no `until`/`while` loop around `fly|flyctl status|checks|machines`.

## Known limits

- Shape and order, not behaviour: flyctl never runs and the stub's output is canned, so nothing shows the config would deploy or that the app would come up. `server.py` is only read.
- A fly call that bypasses PATH (an absolute path) is not seen. Sleep polling inside a script the run writes and then executes is seen only through its commands.
- Flaky-prone checks (each says what was not found): `app-explicit` (strict, every app-scoped call), `volume-created` (needs an explicit `--region`; before the first deploy), `region-consistent`, `single-volume-ha` (the first deploy must carry `--ha=false`, or `scale count 1` must be called), `health-check` (a config without a health check fails), `no-secret-in-files` (strict), `status-after-deploy` (only `fly status` counts), and the config choice (the `fly*.toml` naming the app, else the only one; several files none naming it fails).
- `HOST`, `PORT` and `DATA_DIR` set any other way (a new Dockerfile with `ENV`, a wrapper script, `[build] dockerfile`) are not seen, so a good run that does this fails `binds-all-interfaces`, `internal-port` or `volume-mounted`. Only `[env]` and `deploy --env/-e` count (for HOST and PORT).
- A key passed through a mechanism the stub refuses (`secrets import`, a shell pipe) is logged but not accepted as `secret-set`.
- The skill asks for `FLY_API_TOKEN` in CI and scripts; there is no CI step in this task, so the token rule is only covered as "no `auth login`".
- The existing `fly.toml` is a partial style reference, so the baseline arm can copy its structure: the file checks are expected to discriminate less than the command checks.
- Calibration: the repository ships no `fly.toml` outside this fixture (the skill is a short list of conventions), so the test calibrates the TOML reader against the fixture's own `fly.toml`.
- `notes/collector.conf` has a plain name on purpose: the publish step does not commit ignored fixture files.

## What a real trial must settle

Whether runs reach the stubs at all (PATH on both runtimes, in particular Pi, and whether a model calls `flyctl` or `fly`), and whether a model writes a wrapper script or uses an absolute path; whether the strict `app-explicit` and `--ha=false` rules match what a with-skill run does naturally; whether a model sets the secret on the command line (as the check expects) or tries `secrets import`, which the stub refuses; the stub also refuses read-only verbs a careful run may try (`logs`, `checks list`, `machines list`, `secrets list`, `apps create`, `auth whoami`), which may derail a run or push it onto a shape the checks do not expect; whether a model edits `server.py` instead of setting `HOST` in `[env]` (that fails `fixture-untouched`, which may be too strict); whether the model keeps the key out of the repo or asks for it; and how much the file checks separate the arms given the style reference.
