# ensemble-onboard eval

Scope: a non-interactive `/ensemble-development:ensemble:onboard` run on `fixture/`, a small brownfield service (`ledger-api`: Express, Postgres,
Redis, Stripe, Dockerfile, GitHub Actions, Makefile). The fixture's commands are deliberately non-default (`npm run lint:strict`,
`npm run test:unit`, `make check`; no `test` script), so a model that guesses `npm test` is caught. Claude only: the skill resolves
`toolchain-cli` through tool-path-resolution, which fails on Pi in a sandbox without an installed bundle.

## What the checks cover (`evals/checks/ensemble-onboard.js`)

- `overview-saved`, `overview-sections`: `docs/architecture/overview.md` exists, at most 400 lines, with the nine prescribed sections.
- `overview-commands`, `overview-no-invented-commands`: the real commands verbatim in Build/Test/Lint/Run; no `npm run X`, `make X` or bare `npm test` that the repository lacks.
- `overview-entrypoints`, `overview-modules`, `overview-stores`, `overview-integrations`, `overview-deployment`: the fixture's real entry points, modules, stores, integration with its credential variable name, and Docker/CI shape appear in the right section.
- `overview-no-secrets`: no credential value from `.env.example` is quoted.
- `overview-hotspots`: at least three real files, and no file-looking path that does not exist.
- `overview-unknowns`: at least one listed item (the fixture has no README and no deploy target).
- `read-only`: no CLAUDE.md/AGENTS.md, no stray or removed files, `package.json` scripts intact.

## Known limits

- The sandbox git history is one commit, so churn cannot rank hotspots; the check tests that hotspots are real files, not that the ranking is right.
- The CLAUDE.md block and debt-bead proposals are interactive; only the absence of the writes is checked, not the quality of the proposals.
- Idempotent in-place update of an existing overview is not covered.
- `read-only` detects added and removed files and changed `package.json` scripts, not edits to other file contents.
- Phrasing-sensitive checks (see the header of the check script): `overview-modules`, `overview-no-secrets`, `overview-hotspots`.

## What a real trial must settle

- Whether the three phrasing-sensitive checks pass for correct overviews from both arms.
- Whether the baseline arm writes `docs/architecture/overview.md` at all, and with which sections, since the prompt does not name them.
- Whether `preflight` and `tracker.create` resolve in the sandbox so the skill does not halt before writing.
- Whether `npm run build` is always copied verbatim or paraphrased as `node scripts/bundle.js`.
