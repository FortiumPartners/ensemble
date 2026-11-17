# Eval: ensemble-check-binding-drift

Scope. `/ensemble-product:ensemble:check-binding-drift` is read-only: it diffs a PRD's acceptance-criteria steps against the `[Given/When/Then(@"...")]` attributes in the Reqnroll `Steps/*.cs` files and reports UNBOUND (in the PRD, no binding) and ORPHANED (binding, no PRD step) steps. The fixture is a PRD with two requirements (five acceptance criteria) and a generated `tests/<slug>/Steps` and `Features` tree, then drifted: one criterion was reworded after generation (one UNBOUND plus one ORPHANED), one criterion was added (three UNBOUND), and eight steps stay in sync. The prompt asks the run to save its report to `drift-report.md`, because the skill itself writes nothing a script could read.

What the checks cover (`evals/checks/ensemble-check-binding-drift.js`):

- `report-saved`: `drift-report.md` exists and is not a stub.
- `report-unbound`, `report-orphaned`: every expected step is listed under the UNBOUND / ORPHANED section of the report.
- `report-precision`: no in-sync step is reported as drift, and no step is in the other section.
- `bindings-untouched`: the `tests/` tree has exactly the files it started with, the orphaned binding is still in the `.cs`, no stub exists for an unbound step, and the PRD still holds the unbound steps (read-only constraint).

Known limits.

- The report checks are phrasing-dependent. A step belongs to a section by the line that introduces it, which must start with UNBOUND or ORPHANED (the CLI's own output, or a heading, bullet, bold or table row). A report that lists the right steps without those words fails.
- Step text is compared case-, whitespace-, backtick- and quote-insensitively, as a substring.
- Not checked: that the CLI ran, its exit code (0, 1, 2), the recommendations in step 1.3, the "no bindings yet" and IN_SYNC branches (the fixture has drift only), `--out`, nested `Steps/` directories, and bindings with regex parameters.
- The fixture's PRD has no constitution; the skill reads none.
- Claude only: the skill needs `reqnroll-cli.js` from the plugin, so Pi is not run.

What a real trial must settle.

- Whether `${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js` resolves for the with-skill arm in the sandbox (the fallback `packages/product/lib/...` does not exist in the workspace). If it does not, the with-skill arm halts, as the skill instructs, and nothing counts.
- Whether the baseline, with no helper, can diff the steps by reading. If it can, the uplift is small; if it cannot, uplift reflects the plugin's CLI and vocabulary, not only the skill.
- Whether real reports say UNBOUND / ORPHANED at line starts, and whether the report files use the shape the checks accept.
- The pass rate and spread over repeats; no results are recorded here.
