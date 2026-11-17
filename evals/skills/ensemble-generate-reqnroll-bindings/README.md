# ensemble-generate-reqnroll-bindings eval

Scope: Claude Code only. `/ensemble-product:ensemble:generate-reqnroll-bindings docs/PRD/PRD-2026-0a1b2c3d-csv2json.md --out tests --sut src/Csv2Json/Csv2Json.csproj` against a seeded PRD (two requirements, three acceptance criteria, one shared Given) and a stub SUT `.csproj`. The skill runs `packages/product/lib/reqnroll-cli.js generate-bindings`; the fixture holds no constitution because the skill does not read one. Pi is not listed: the skill depends on the CLI path (`${CLAUDE_PLUGIN_ROOT}`).

## What the checks cover (`evals/checks/ensemble-generate-reqnroll-bindings.js`)

Expected values come from the seeded PRD in this repository, not from the workspace copy. The scaffold directory is found by its `.reqnroll-trace.json`, so any `--out` passes.

| Check | Asserts |
|---|---|
| `scaffold-files` | exactly one scaffold; a `.feature` and a `.Steps.cs` per requirement, one `*.Tests.csproj`, `reqnroll.json` |
| `feature-scenarios` | every AC is a scenario tagged `@AC-NNN-M` whose Given/When/Then lines are the PRD's wording verbatim |
| `step-bindings` | `[Binding]`; one literal `[Given/When/Then(@"^...$")]` per distinct PRD step; every body Pending |
| `csproj-wired` | `Microsoft.NET.Sdk`, a TargetFramework, PackageReferences to Reqnroll.xUnit, xunit and Microsoft.NET.Test.Sdk, a ProjectReference to the `--sut`, `reqnroll.json` parses |
| `trace-manifest` | PRD id and version, `sut_csproj`, every distinct step with keyword, text, method, file and the generator's 12-hex hash |
| `matches-generator` | every file is byte-identical to `buildBindingArtifacts` for the seeded PRD (repository code, pure) |
| `no-stray-writes` | PRD unmodified; nothing written outside the scaffold (tool state aside). Possibly flaky: a notes file left by the agent fails it |

## Known limits

- Nothing builds the C#: no `dotnet`, no package restore, no network. `step-bindings` and `csproj-wired` are textual.
- `matches-generator` makes the CLI's output the contract. A scaffold that is correct but differently formatted fails it by design; `trace-manifest` and the shape checks still say what is wrong. If the generator changes, the check follows it (it requires `packages/product/lib`).
- The baseline arm has no CLI and writes the project by hand; it is expected to measure the plugin's conventions (exact escaping, fingerprints, layout), and its uplift is the package's, not the skill text's.
- Write-once preservation, `--dry-run`, `--force` and parser warnings are not exercised.

## What a real trial must settle

- Whether `${CLAUDE_PLUGIN_ROOT}/lib/reqnroll-cli.js` resolves in the sandbox with only `packages/product` loaded, and the with-skill arm reaches the CLI.
- Whether the with-skill arm writes anything outside `tests/` (flakiness of `no-stray-writes`).
- Whether a baseline that hand-writes a plausible scaffold passes the shape checks and fails only on the generator comparison.
- Whether `--foreman` is accepted (or ignored harmlessly) by this command.
