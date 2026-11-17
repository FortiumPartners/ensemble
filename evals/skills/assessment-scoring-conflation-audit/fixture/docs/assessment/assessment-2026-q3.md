# Engineering Assessment, Q3 2026

Draft for the steering review. Scores use the 1.0 to 5.0 scale; each repository table is scored from that repository's own evidence.

## Repository: pylon-api

| Dimension | Score | Grade | Finding |
|---|---|---|---|
| Code Quality | 3.9 | B | Consistent module layout, linted in CI, 82% of functions have type hints. |
| AI Adoption | 3.4 | C+ | Strong type hints and documented playbooks (B-level readiness); agentic tool signals = D (no Copilot, CodeGen or LLM workflow found in commit history or CI). |
| CI/CD | 3.7 | B | Pipelines run on every push; deploys are manual but scripted. |
| Testing | 2.6 | C | Unit tests cover the core library; no integration or contract tests. |
| Security | 1.4 | F | CRITICAL: the admin API accepts unauthenticated requests. |

## Repository: harbor-bff

| Dimension | Score | Grade | Finding |
|---|---|---|---|
| Code Quality | 4.2 | B+ | Small, well-factored handlers; strict TypeScript. |
| Dependency Hygiene | 2.3 | D+ | Eleven dependencies are more than two major versions behind. |
| Security | 2.3 | D+ | Calibrated to the portfolio's Agentic Security Posture composite (2.3, D+), which includes pylon-api's CRITICAL unauthenticated API and soc-bff's unpatched RCE. harbor-bff's own worst finding is HIGH: the webhook signing secret is optional (Phase 3.5 cap B+ to B, 3.9). |

## Portfolio composite

| Dimension | Score | Grade | Finding |
|---|---|---|---|
| Agentic Security Posture | 2.3 | D+ | Aggregates pylon-api's CRITICAL unauthenticated API and soc-bff's CRITICAL unpatched RCE. |
| Team Capability | 3.1 | C | Portfolio-wide survey; no per-repository equivalent. |
