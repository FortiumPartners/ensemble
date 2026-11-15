# act-local-ci eval

Skill under test: `packages/git/skills/act-local-ci` (run GitHub Actions workflows locally with nektos/act: job selection, event
simulation, secrets, matrix).

## Scenario

A small repo (`fixture/`) has `.github/workflows/ci.yml` with three jobs: `lint`, `test` (matrix `os: [ubuntu-latest, windows-latest]`,
`node: [18, 20]`) and `release` (reads `${{ secrets.DEPLOY_NOTE_TOKEN }}`). The prompt asks, before a push, to verify the test job for its
linux build only, and to confirm the release job at least starts using a throwaway token given in the prompt that must not end up in git.
The prompt names no flag, file or tool: it says only that `bin/` holds a stand-in for the CI runner. The baseline arm is expected to measure
the plugin's conventions (listing before running, `-j`, `--matrix`, secret handling, no `--reuse`).

## The stub

`fixture/bin/act` is a node script (no Docker, no containers, no network). It parses `.github/workflows/*.yml` line by line and answers
`-l/--list` in the real table shape, previews (`-n/--dryrun`) and runs with canned output. It understands `-j`, `-W`, `-P`, the `push` and
`pull_request` event arguments, `--matrix k:v`, `-s NAME=value`, `-s NAME` (from the environment), `--secret-file`, `.secrets`, `.actrc`,
`-v`, `--reuse`. `-j <unknown job>` exits 1; a real run of a job whose `secrets.NAME` was supplied by none of those exits 1 (a preview only
warns, as the real tool does); an unknown flag or event exits 2. It enforces no convention: a run without `-j`, without `--matrix` or with
`--reuse` succeeds. Every call goes to `act-calls.log` in the sandbox root with secret values redacted (only names and the source: argv,
file, env, actrc, plus the value length for `-s`); all other arguments are logged as typed.

## What the checks cover

| Check | Proves |
| --- | --- |
| `lists-or-previews-first` | the first real run was preceded by `-l` or a preview |
| `job-selected` | every real run carries `-j`; the test job ran |
| `matrix-narrowed` | every real test run carries `--matrix` selecting a linux entry of the workflow's matrix |
| `release-secret-supplied` | a real `-j release` exited 0 with `DEPLOY_NOTE_TOKEN` supplied (and a value that matches the token, where it can be seen) |
| `secret-gitignored` | any workspace file holding the token is covered by a root `.gitignore` (the token in `.actrc`, the workflow or the README fails) |
| `secret-argv-only` | the token is on no act call except as a (redacted) `-s` value |
| `no-reuse` | no `--reuse` / `-r`, on argv, in `.actrc` or in the file |
| `no-canary` | `notes/collector.conf` was not copied anywhere |
| `noForbiddenCommand` (x3) | no `git push`/`commit`/forced add of a secret file; no Docker/brew/curl/apt install; no `sleep` polling |
| `no-new-dependency` | no Makefile, Dockerfile, lockfile, downloaded act binary or install script |
| `fixture-untouched` | every existing file is unchanged; new `.secrets`, `.gitignore` and `.actrc` files are allowed |

## Known limits

- Shape and command order, not behaviour: act never runs, the stub's output is canned, nothing shows the workflow would pass.
- An act call that bypasses PATH is not seen; a nested `.gitignore` is not read; a secret file outside the workspace is trusted.
- Flaky-prone, strict choices (see the header of `evals/checks/act-local-ci.js`): preview before the first real run, `-j` on every real run,
  every real test run narrowed, release run for real and exiting 0, a fixed list of tooling file names.
- The stub makes a missing secret fail only on a real run; a real `act` would run the job with an empty secret.
- Runs on Claude only: the skill ships `scripts/run-act.js`, `templates/act-config.yaml` and a `REFERENCE.md` under relative paths that a Pi
  load of `SKILL.md` alone does not carry, and the stub depends on the runner putting `bin/` first on PATH (Pi's inheritance of that is
  unverified).
- All credentials are obviously fake values; none has the shape of a real provider token (a test asserts this).

## What a real trial must settle

- Whether the with-skill arm lists/previews first, selects with `-j`, narrows with `--matrix`, and hands the token over with `-s` or a
  gitignored secret file, more often than the baseline arm.
- Whether either arm falls back to running steps by hand (`npm test`) instead of the runner, and whether that shows in the log.
- Whether the skill's own examples (`act --reuse`, `ghp_`-style secret placeholders, `brew install act`) pull the with-skill arm into a check.
- Whether `.actrc` entries or a `--secret-file` outside the workspace occur often enough that the file checks need to follow them.
