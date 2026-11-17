# detect-stack eval

Scope: the `detect-stack` skill (packages/core) on a small seeded project. The agent must work out the project's framework, test runner, infrastructure tooling and cloud provider and save them as `docs/stack.json` (`{framework, test, tooling[], cloud}`). The prompt is non-interactive and plain (the model finds the skill itself).

## Fixture

A React app (`package.json` with react, react-dom, jest and an AWS SDK client; `src/App.jsx`; `jest.config.js`; `tests/`), a Helm chart in the root (`Chart.yaml`, `values.yaml`, `.helmignore`, `templates/`) and AWS evidence (`infra/main.tf`, `deploy.sh`). The skill's own detector reports react, jest (with pytest and xunit at 0.2 from the bare `tests/` directory), helm only, and aws; `evals/tests/skills/detect-stack.test.js` runs the detector on the fixture so the expected values cannot drift unnoticed.

## What the checks cover (evals/checks/detect-stack.js)

- `stack-saved`: `docs/stack.json` exists, is a JSON object and has the four keys.
- `stack-framework`, `stack-test`, `stack-cloud`: the axis names exactly the expected technology (case, `.js` and `{name}` objects are tolerated; a list of candidates fails, so the pytest and xunit decoys fail the test axis).
- `tooling-detected` and `tooling-no-extras`: helm is listed, and nothing the project gives no evidence for (kubernetes, kustomize, argocd, flyio).
- `no-stray-files`: no file outside `docs/` was added.

## Known limits

- Content only: the checks do not show that the agent ran the detector, nor that it reported confidence or signals; a baseline that reads the files can pass.
- One stack only. Monorepos, manual overrides (`--framework`, `--provider`), low-confidence cases and the other detectors are not covered.
- `tooling-no-extras` is strict: a reviewer might accept `kubernetes` for a Helm chart, but the skill's detector does not report it here.
- Existing project files being edited is not detected (only new files outside `docs/`).
- Claude only: the skill runs a node script from the plugin's skill directory, a path Pi cannot resolve.

## What a real trial must settle

- Whether the with-skill arm actually finds and runs `detect-stack.js` from the skill directory in the sandbox.
- Whether the strict single-answer rules (one runner, helm only) match what both arms naturally produce, or whether a phrasing change in the prompt is needed.
- Whether the baseline already passes, which would make the uplift of this scenario small and call for a harder fixture (monorepo, low-confidence signals).
