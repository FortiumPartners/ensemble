# Red run 4821

The required `unit` job on `main` went red this morning and nobody has touched `src/` since. The previous six runs were green and
a re-run last week passed, so the team calls the `checkout` tests flaky. The full CI output is `ci/logs/run-4821.txt`. The CI
pipeline is `ci/pipeline.yml`.

Open question from the channel: "can we just turn on retries for this job until someone has time?" Policy is in `notes/README.md`.
