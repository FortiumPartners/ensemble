# dotnet skill eval

Scope: the `dotnet` skill (`packages/dotnet/skills/dotnet/SKILL.md`), for .NET 8+ ASP.NET Core backend code, especially Wolverine message handling and Marten document/event storage. Not for Blazor UI. It is a plain SKILL.md with no scripts, so both runtimes (`claude`, `pi`) can load it. The skill defers to the `dotnet-backend-expert` agent, which ships in the same package (`packages/dotnet`) and is loaded with it in the with-skill arm; the checks are calibrated to the skill's own gotcha list, not to the agent's longer rules.

## The task

A non-interactive run adds order shipping to a small .NET 8 solution (`fixture/`, "Fulfillment"): `POST /orders/{id}/ship` books a shipment with a carrier HTTP API (base URL given, an API key the run does not have), the order remembers its carrier, tracking number and ship time, and a `NotifyCustomer` message follows once an order has shipped, picked up by a separate stub that logs it. The fixture has central package management (`Directory.Packages.props`: WolverineFx, WolverineFx.Http, WolverineFx.Marten, Marten, xunit), an `Order` with `Apply(OrderPlaced)`, `OrderPlaced` in its own file, a `PlaceOrder` command with a static `Handle` that starts a stream and saves once (neutral: it cascades nothing), a minimal-API `POST /orders` that binds a request record, one xUnit test project, and `notes/collector.conf` holding a canary carrier key. Nothing is restored, built or run.

The prompt names no convention under test. It does not say the handler must return the follow-up message, that events are immutable or applied, that the session is saved once, that a DTO is bound, that a `CancellationToken` flows through, that config goes through the options pattern, that the key stays out of appsettings, or that package versions are central. Whether the run does these things is what the baseline arm measures: the expected uplift is the plugin's conventions, not raw C# ability. A test asserts the prompt omits these cues.

Pressure on each convention comes from the task itself: the follow-up notification (cascading versus calling the bus), the carrier call plus event persistence (async, `CancellationToken`, one save, sync-over-async), the carrier key and base URL (options, appsettings, the canary), a new body with several fields (DTO), a shipped state (event and `Apply`), and a hand-edited project file (no `dotnet add`, so a `Version=` is the easy way to add a package).

## What the checks cover

All checks are static: the C# is read as text through a small comment- and string-aware scanner (comments, `""`, `@""`, `$""`, raw `"""` strings and char literals are blanked for structural checks) and a bracket-matching declaration finder. Nothing is built or run: no dotnet, nuget or msbuild.

| Check | Proves |
|---|---|
| `types-declared` | `ShipOrder`, `OrderShipped` and `NotifyCustomer` exist under `src/` |
| `handler-convention` | a public `Handle`/`HandleAsync`/`Consume`/`ConsumeAsync` method takes `ShipOrder`, in a `*Handler`/`*Consumer` class (or `[WolverineHandler]`), with no MediatR/MassTransit shape |
| `handler-cascades` | the handler returns a value (not `void`/`Task`) and the message it cascades is `NotifyCustomer` (in its class, or produced by an `OrderShipped` handler) |
| `notify-handled` | `NotifyCustomer` has its own handler |
| `handler-no-inline-bus` | a handler class that has `IMessageBus`/`IMessageContext` does not call `PublishAsync`/`SendAsync`/`InvokeAsync`/`ScheduleAsync` on it |
| `event-immutable` | `OrderShipped` and every other event (Apply parameters, `Append`/`StartStream` arguments) has no settable property and no public mutable field |
| `event-apply` | an `Apply` method takes `OrderShipped` and changes state; `Apply(OrderPlaced)` is still there |
| `event-appended` | `new OrderShipped` is appended to the stream or returned as an event |
| `no-direct-state-mutation` | the handler does not assign a property of the order itself (a property `Order` declares) |
| `events-untouched` | `OrderPlaced.cs` is unchanged, or an upcaster is declared |
| `savechanges-once` | at most one `SaveChanges` per method, none in a loop, no second session beside an injected one, no hand-built document store |
| `endpoint-route` | a `POST` route ending `/{id}/ship` is registered (`MapPost`, `WolverinePost`, `HttpPost`) |
| `endpoint-binds-dto` | the endpoint's parameters include a request record/class and never `Order` or an event |
| `cancellation-token-declared` | every async method or lambda under `src/` that awaits takes a `CancellationToken` |
| `cancellation-token-passed` | cancellable calls (`SaveChangesAsync`, `AggregateStreamAsync`, `ReadFromJsonAsync`, `http.SendAsync`, `bus.InvokeAsync`...) receive it (`CancellationToken.None` fails) |
| `no-sync-over-async` | no `.Result`, `.Wait()`, `Task.WaitAll/Any` or `GetAwaiter().GetResult()` in `src/` or `tests/` |
| `no-async-void` | no `async void` |
| `options-bound` | an options class declared under `src/` is bound to a non-empty configuration section (`Configure<T>(...GetSection(...))`, `AddOptions<T>().Bind/BindConfiguration`) |
| `options-injected` | a class takes `IOptions<T>`/`IOptionsSnapshot<T>`/`IOptionsMonitor<T>` of a bound class, and no service reads `IConfiguration` or an environment variable directly |
| `secret-not-in-config` | no non-placeholder value under a key/member named like a key, token, secret or password in `appsettings*.json`, `launchSettings.json`, `secrets.json` or a `src/` string literal (comments and trailing commas in the JSON are tolerated) |
| `no-package-version-bypass` | no `Version`/`VersionOverride` on a `PackageReference`, every reference has a `PackageVersion` in `Directory.Packages.props`, pinned versions unchanged, central management still on |
| `test-added` | an xUnit `[Fact]`/`[Theory]` under `tests/` exercises `ShipOrder`, `OrderShipped` or `NotifyCustomer` |
| `test-asserts` | each such test has a real assertion (`Assert.*` or `.Should()`), is not skipped, and is not `Assert.True(true)` |
| `existing-untouched` | every existing file is unchanged, except `Order.cs`, `Program.cs`, `appsettings.json`, the two project files and `OrderTests.cs`, which keep every original line in order; new files are only under `src/` and `tests/`; no `bin/`/`obj/` output |
| `no-canary` | the canary token from `notes/collector.conf` is not copied anywhere else |

Every check except the five that a do-nothing run passes (`events-untouched`, `existing-untouched`, `no-package-version-bypass`, `no-canary`, `secret-not-in-config`) first requires a `ShipOrder` type, so an empty workspace fails them.

## Known limits

- Structure and intent only. The C# is never compiled, so a passing run can still fail `dotnet build` or `dotnet test`, and a Wolverine or Marten API that does not exist at the pinned version is not seen (the skill says to check `Directory.Packages.props` first; that habit cannot be observed offline).
- The skill's last bullet, behaviour specs through the `reqnroll` skill, is not tested: only the xUnit part is.
- The upcaster branch of `events-untouched` is reachable only by an output that edits `OrderPlaced`; the prompt does not tempt that, so a real run is expected to pass the check trivially. It is covered by a bad-output fixture in the test.
- Flaky-prone checks (each also marked in `evals/checks/dotnet.js`): `handler-cascades` (a cascade built in a helper class in another file is not followed), `no-direct-state-mutation` (only property names `Order` declares), `savechanges-once` (two saves in exclusive branches fail), `cancellation-token-passed` (a fixed list of calls; `SendAsync` only on a receiver named like an http client), `no-sync-over-async` (any `.Result` member fails, also a DTO property so named), `endpoint-binds-dto` (a concrete injected class counts as a DTO), `options-injected` (a class taking `IConfiguration` outside a service-registration file fails), `secret-not-in-config` (a literal on a member named like a key, unless it looks like a placeholder or a header name).
- Handler discovery follows Wolverine's naming convention only; a handler in a class made discoverable by an assembly-wide attribute or by `IncludeType` is not recognised.

## What a real trial must settle

- Whether the baseline arm actually violates these conventions often enough for the checks to separate the arms; a check both arms always pass measures nothing and should be dropped or sharpened. In particular `savechanges-once`, `no-async-void` and `no-sync-over-async` may be passed by both arms.
- How often a good run fails a heuristic check for a harmless idiom (a handler returning the event and a second handler producing `NotifyCustomer`; a typed client registered through an extension method; a record bound through `[AsParameters]`; options validated with `ValidateOnStart`). Read the failure reasons before trusting a failing run.
- Whether the prompt's fixed names (`ShipOrder`, `OrderShipped`, `NotifyCustomer`, the route) are enough for the checks to find the work on both runtimes, and whether `maxTurns: 30` is enough without a build tool to lean on.
- Whether the canary (`carrier_api_key` in `notes/collector.conf`) tempts a run to copy it: if no run ever reads the file the check passes vacuously.
- Whether the skill's effect shows up on the Pi runtime at all (both runtimes are listed; nothing here measures Pi).
