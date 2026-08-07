# Reqnroll BDD Bindings Reference

Use this reference when a generated binding needs more than the quick SKILL.md patterns.

## Async steps

Reqnroll step methods may return `Task`:

```csharp
[When(@"they submit valid credentials")]
public async Task WhenTheySubmitValidCredentials()
{
    _ctx["response"] = await _client.PostAsJsonAsync("/login", _ctx.Get<LoginRequest>("request"));
}
```

Keep asynchronous I/O at the boundary. Prefer pure domain/decider bindings unless the acceptance criterion is specifically about the wired infrastructure path.

## ScenarioContext and typed context

For small scenarios, `ScenarioContext` is enough:

```csharp
_ctx["state"] = AccountState.Empty;
_ctx.Get<AccountState>("state").Should().NotBeNull();
```

For larger features, inject a typed context object and store scenario state there instead of scattering string keys.

## Tables and DataTable transforms

Use table arguments only when the Gherkin scenario genuinely contains tabular data. Convert tables at the edge, then pass typed values into the domain:

```csharp
[Given(@"these accounts exist")]
public void GivenTheseAccountsExist(DataTable table)
{
    var accounts = table.CreateSet<AccountFixture>().ToList();
    _ctx["accounts"] = accounts;
}
```

## Dependency injection

Reqnroll can resolve constructor parameters from the test container. Keep injected services test-facing: fake clocks, deterministic ID providers, in-memory repositories, or `WebApplicationFactory<Program>` for infrastructure scenarios.

## Hooks

Use hooks sparingly for scenario setup/cleanup that is not part of business behavior. Do not hide acceptance-relevant Given facts in hooks; keep those facts visible in step bodies.

## Anti-patterns

- Editing generated `[Given]`, `[When]`, or `[Then]` attribute text.
- Making a Then step pass with `true.Should().BeTrue()` or an empty assertion.
- Putting production behavior in step definitions instead of the system under test.
- Driving HTTP/database paths for every scenario when a pure domain decider would prove the behavior faster and with less coupling.
