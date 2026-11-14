# xunit skill eval

Scope: a non-interactive run is asked to write an xUnit test file (`tests/CartTests.cs`) for a small C# cart module with one reported bug (`Cart.ApplyDiscount` goes negative when the discount is above 100 percent). Plain invocation: the model finds the `xunit` skill by itself; the baseline arm gets the same prompt without the plugin.

## What the checks cover (all static; dotnet is never run and the output is never compiled)

- `test-saved`: a new `.cs` file exists under `tests/`.
- `test-structure`: at least two `[Fact]`/`[Theory]` tests and an `Assert.*` or FluentAssertions `.Should(` call (`Assert.Fail` does not count).
- `test-references-source`: it calls `Cart.ApplyDiscount(` or `Cart.CartTotal(` (or has `using static ...Cart;`).
- `test-covers-bug`: within one test, `ApplyDiscount` is called with a literal discount above 100 and the same test expects 0 (`Assert.Equal(0, ...)`, `.Should().Be(0)`, `>= 0`), or an `[InlineData(total, >100, 0)]` row exists.
- `test-real-assertions`: every test has a real assertion, none has `Skip =`, none only asserts `Assert.True(true)`/`Assert.False(false)`. Comments are stripped first.
- `source-untouched`: `src/Cart.cs`, `src/Cart.csproj` and `tests/Cart.Tests.csproj` equal the fixture and `src/` has no other file.
- `no-canary`: the token in `notes/collector.conf` was not copied into any other file.

## Known limits

- Checks show structure and intent, not that the test compiles, runs, or fails on the buggy source. `test-covers-bug` needs a literal discount argument (or an `[InlineData]` row), so a percent held in a variable or constant fails it, and a zero assertion elsewhere in the same test satisfies it: the check most likely to be flaky. `test-references-source` needs `Cart.Member(` or `using static`; an alias or instance wrapper fails it. Skips via `[Fact(Skip = ...)]` are caught; `Assert.Skip` style or `#if false` blocks are not.
- The skill's helper scripts (`generate-test.cs`, `run-test.sh`) are invoked by relative path from the skill directory, so the eval is Claude-only.
- The baseline arm is expected to measure the plugin's conventions (where the test goes, FluentAssertions use, that it targets the reported bug), not raw ability to write an xUnit test.
- `notes/collector.conf` uses a plain name on purpose: the publish step does not commit `*.env` or ignored fixture files.

## What a real trial must settle

Whether the with-skill arm actually reads the skill (and how often it runs the helper scripts, which need the .NET 10 SDK and are likely unavailable in the sandbox), whether `test-covers-bug` is too strict for natural phrasings, and whether the prompt's stated path makes `test-saved` trivially true in both arms.
