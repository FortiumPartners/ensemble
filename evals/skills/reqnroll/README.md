# reqnroll skill eval

Scope: a non-interactive run is asked to fill the step bodies of a generated Reqnroll + xUnit `Steps/REQ-001.Steps.cs` (every body still `throw new PendingStepException()`), test-first, against a tiny in-memory C# decider (`src/Account`: `Decide`/`Evolve`). The fixture is real `generate-bindings` output (two methods carry the deliberate `_` plus 12 hex suffix) with its feature file, test project, `reqnroll.json`, `.reqnroll-trace.json` manifest and PRD. Plain invocation: the model finds the `reqnroll` skill by itself; the baseline arm gets the same prompt without the plugin. It targets the skill's two distinct rules: the `[Given/When/Then]` attribute text is read-only (bodies only), and bindings go to the domain decider, not HTTP/DB/host. It does not duplicate the `ensemble-generate-reqnroll-bindings` eval, which checks the generator command, not the filling.

## What the checks cover (all static; dotnet is never run and nothing is compiled)

- `steps-saved`: the Steps file exists and has as many binding methods as the fixture.
- `attributes-readonly`: every `[Given/When/Then]` attribute line equals the fixture's byte for byte, in order (a whitespace edit, an added or a commented-out-and-replaced attribute fails).
- `signatures-unchanged`: every binding method name (including the hash-suffixed ones), return type and parameters equal the fixture's.
- `bodies-filled`: no body is empty, throws, is pending or `NotImplemented`, calls `Assert.Fail`, or carries a TODO/FIXME. Comments are stripped before the empty test.
- `binds-domain`: the steps reference `Acme.Accounts`; no `.cs` under `tests/` names an HTTP, host or database type or namespace; every When body calls `Decide(`; every Given body builds state through the SUT (`Evolve(`, `Account.Initial`, `AccountState`, `AccountOpened`).
- `then-real-assertions`: every Then body has `Assert.*` (not `Assert.Fail`) or a FluentAssertions `.Should().X`, and not only on a constant (`Assert.True(true)`, `true.Should()`, `70.Should()`).
- `sut-untouched`: `src/Account/Account.cs` and `.csproj` equal the fixture and `src/` has no other file.
- `generated-untouched`: the feature file, test csproj, `reqnroll.json`, trace manifest and PRD equal the fixture and no other `.feature`/`.csproj`/`.json` appears under `tests/`.
- `no-canary`: the token in `notes/collector.conf` was not copied into another file.

## Known limits

- Checks show structure and intent, not that the bindings compile, run, or that the scenarios go green or red for the right reason.
- Flaky-prone: `binds-domain` (a body that reaches the decider only through a helper in another class, or a Given that builds state through an unlisted type, fails it) and `then-real-assertions` (an assertion hidden in a helper, or a Then that calls one, fails it). Comments and string contents are masked by a linear scanner; raw `"""` strings are not parsed.
- Attribute comparison is exact, so a run that reformats indentation fails `attributes-readonly` although the matching text is intact.
- The fixture's attributes already match its feature file, so the eval shows whether the run leaves them alone, not whether it reports drift.
- The baseline arm is expected to measure the plugin's conventions (read-only attributes, domain-not-infrastructure), not raw C# ability.
- `notes/collector.conf` uses a plain name on purpose: the publish step does not commit `*.env` or ignored fixture files.
- Claude only: not exercised on Pi.

## What a real trial must settle

Whether the baseline arm already leaves attributes alone and binds to the decider (then the uplift is small), whether `binds-domain` is too strict for natural phrasings (helper methods, typed context classes), whether the with-skill arm reads REFERENCE.md, and whether the prompt's "make no other change" makes `generated-untouched` and `sut-untouched` trivially true in both arms.
