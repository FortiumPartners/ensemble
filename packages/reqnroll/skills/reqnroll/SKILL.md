---
name: Reqnroll BDD Bindings
description: Fill Reqnroll + xUnit step definitions test-first against the system under test
version: 1.0.0
---

# Reqnroll BDD Bindings (xUnit)

Reqnroll is the actively-maintained, open-source successor to SpecFlow. It parses
Gherkin `.feature` files and binds each step to a C# method by matching the step text
against `[Given]/[When]/[Then]` attributes. This skill covers filling those bindings
**test-first**.

## The one rule

The `[Given(@"...")]` attributes in generated `Steps/*.cs` are **authoritative and
read-only**. Bind by editing **method bodies only** — never the attribute text. A
hand-edited attribute that no longer matches the scenario step becomes an *undefined
step*. Wrong/missing attribute text is a drift signal (see
`/ensemble:check-binding-drift`), not something to fix by hand.

## Package set (already wired by the generator)

```xml
<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
<PackageReference Include="Reqnroll.xUnit" Version="2.1.0" />
<PackageReference Include="xunit" Version="2.9.2" />
<PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
<PackageReference Include="FluentAssertions" Version="6.12.1" />
```

`reqnroll.json` sits next to the `.csproj`. The test project references the
system-under-test (SUT) via `<ProjectReference>`.

## Bind to the DOMAIN, not the infrastructure (default)

Acceptance criteria describe **decisions** — "given these facts, when this happens, then
these outcomes." That maps almost 1:1 onto a decider (`decide(command, state) -> events`)
in an event-sourced / functional-core domain. **Bind there by default.** Decider tests
are pure, fast, deterministic, and in-memory — no HTTP, no database, no host.

| Gherkin | Decider |
| --- | --- |
| **Given** (prior facts) | past events folded into state via `evolve`/`fold` |
| **When** (an action) | a command passed to `decide(command, state)` |
| **Then** (outcome) | assert on the **emitted events** (or resulting state) |

```csharp
[Binding]
public partial class LoginSteps
{
    private readonly ScenarioContext _ctx;
    public LoginSteps(ScenarioContext ctx) => _ctx = ctx;

    // Given -> fold prior events into starting state (no I/O)
    [Given(@"a registered user")]
    public void GivenARegisteredUser()
        => _ctx["state"] = Account.Evolve(Account.Initial, new UserRegistered(/* … */));

    // When -> call the pure decider with a command
    [When(@"they submit valid credentials")]
    public void WhenTheySubmitValidCredentials()
        => _ctx["events"] = Account.Decide(new SubmitLogin(/* … */), _ctx.Get<AccountState>("state"));

    // Then -> assert on the emitted events / new state
    [Then(@"they are authenticated and see the dashboard")]
    public void ThenTheyAreAuthenticatedAndSeeTheDashboard()
        => _ctx.Get<IReadOnlyList<object>>("events").Should().ContainSingle(e => e is LoggedIn);
}
```

Share data across steps via the constructor-injected `ScenarioContext` (or a typed
context class via context injection). Steps may be `async Task`. Use FluentAssertions
(`.Should()`) in Then steps. Keep step bodies thin — push real behavior into the
decider, never into the step.

## When to drop to infrastructure (the exception, not the default)

Only bind to infrastructure when the acceptance criterion is genuinely *about* the wired
pipeline (routing, auth middleware, serialization, persistence round-trips) rather than a
domain decision. Then drive a real ASP.NET Core pipeline with `WebApplicationFactory<Program>`:

```csharp
[When(@"they POST the login form")]
public async Task WhenTheyPostTheLoginForm()
    => _ctx["response"] = await _client.PostAsJsonAsync("/api/login", _ctx.Get<LoginRequest>("creds"));
```

Prefer one or two of these per feature at most; if every scenario reaches for HTTP/DB,
the bindings are testing plumbing instead of behavior — push them down to the decider.

## Test-first / outside-in workflow

1. Fill a Given/When/Then body to express the interaction against the domain contract
   you *wish* existed — by default the decider (`decide`/`evolve`, the command, the
   events), not an endpoint or repository.
2. Build/run — it goes **red** (won't compile → create the command/event/decider
   signatures; then a failing assertion on the emitted events). That red is correct: it
   drives the implementation.
3. Implement the decider (inner unit-test-first loop) until the scenario is **green**.
4. Never write production logic inside a step body to force a pass; keep steps thin.

If a step can't be bound to a meaningful interaction yet, leave
`throw new PendingStepException();` and report it — a Pending step is honest; a vacuous
passing assertion is not.

## Running

```bash
dotnet test --logger "trx;LogFileName=reqnroll.trx"
dotnet test --filter "@AC-001-1"      # one scenario by tag
```

A `PendingStepException` or "No matching step definition" both mean **red** — the
expected starting state before bindings/implementation exist.
