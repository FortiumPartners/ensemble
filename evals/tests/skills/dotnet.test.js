'use strict';

/**
 * Kit tests for the `dotnet` skill eval: a good output passes every check, differently phrased good outputs do too, and bad outputs each
 * fail the named check. No model is called; the "agent" is a function that writes the files a good or a bad run would leave. The C# and
 * the project files below are never compiled or run; they are only text for the static checks.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');
const { CHECKS, scan, parse, pairsOf, parseParams, stripJsonComments } = require('../../checks/dotnet');

jest.setTimeout(120000); // each run spawns one node process per check

const ID = 'dotnet';
const IDS = [
  'types-declared', 'handler-convention', 'handler-cascades', 'notify-handled', 'handler-no-inline-bus', 'event-immutable', 'event-apply',
  'event-appended', 'no-direct-state-mutation', 'events-untouched', 'savechanges-once', 'endpoint-route', 'endpoint-binds-dto',
  'cancellation-token-declared', 'cancellation-token-passed', 'no-sync-over-async', 'no-async-void', 'options-bound', 'options-injected',
  'secret-not-in-config', 'no-package-version-bypass', 'test-added', 'test-asserts', 'existing-untouched', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/dotnet/fixture');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const API = 'src/Fulfillment.Api';
const ORDER = `${API}/Orders/Order.cs`;
const PROGRAM = `${API}/Program.cs`;
const SETTINGS = `${API}/appsettings.json`;
const CSPROJ = `${API}/Fulfillment.Api.csproj`;
const PLACED = `${API}/Orders/Events/OrderPlaced.cs`;
const SHIP = `${API}/Orders/ShipOrder.cs`;
const SHIPPED = `${API}/Orders/Events/OrderShipped.cs`;
const NOTIFY = `${API}/Orders/NotifyCustomer.cs`;
const NOTIFYH = `${API}/Orders/NotifyCustomerHandler.cs`;
const HANDLER = `${API}/Orders/ShipOrderHandler.cs`;
const REQ = `${API}/Orders/ShipOrderRequest.cs`;
const ENDPOINT = `${API}/Orders/ShipOrderEndpoint.cs`;
const OPTIONS = `${API}/Carrier/CarrierOptions.cs`;
const CLIENT = `${API}/Carrier/CarrierClient.cs`;
const TESTS = 'tests/Fulfillment.Tests/ShipOrderTests.cs';
const PACKAGES = 'Directory.Packages.props';

const GOOD = {
  [SHIP]: `namespace Fulfillment.Api.Orders;

public record ShipOrder(Guid OrderId, string Carrier, string ServiceLevel, string PostalCode);
`,
  [SHIPPED]: `namespace Fulfillment.Api.Orders;

public record OrderShipped(Guid OrderId, string Carrier, string TrackingNumber, DateTimeOffset ShippedAt);
`,
  [NOTIFY]: `namespace Fulfillment.Api.Orders;

public record NotifyCustomer(Guid OrderId, string TrackingNumber);
`,
  [NOTIFYH]: `using Microsoft.Extensions.Logging;

namespace Fulfillment.Api.Orders;

public static class NotifyCustomerHandler
{
    public static void Handle(NotifyCustomer message, ILogger<NotifyCustomer> logger)
    {
        logger.LogInformation("Order {OrderId} shipped, tracking {Tracking}", message.OrderId, message.TrackingNumber);
    }
}
`,
  [HANDLER]: `using Fulfillment.Api.Carrier;
using Marten;

namespace Fulfillment.Api.Orders;

public static class ShipOrderHandler
{
    public static async Task<NotifyCustomer> Handle(ShipOrder command, IDocumentSession session, ICarrierClient carrier, CancellationToken ct)
    {
        var order = await session.Events.AggregateStreamAsync<Order>(command.OrderId, token: ct);
        if (order is null) throw new InvalidOperationException("Order not found");

        var tracking = await carrier.BookAsync(command, ct);
        session.Events.Append(command.OrderId, new OrderShipped(command.OrderId, command.Carrier, tracking, DateTimeOffset.UtcNow));
        await session.SaveChangesAsync(ct);

        return new NotifyCustomer(command.OrderId, tracking);
    }
}
`,
  [REQ]: `namespace Fulfillment.Api.Orders;

public record ShipOrderRequest(string Carrier, string ServiceLevel, string PostalCode);
`,
  [ENDPOINT]: `using Wolverine;

namespace Fulfillment.Api.Orders;

public static class ShipOrderEndpoint
{
    public static void MapShipOrderEndpoint(this IEndpointRouteBuilder app)
    {
        app.MapPost("/orders/{id:guid}/ship", async (Guid id, ShipOrderRequest request, IMessageBus bus, CancellationToken ct) =>
        {
            await bus.InvokeAsync(new ShipOrder(id, request.Carrier, request.ServiceLevel, request.PostalCode), ct);
            return Results.Accepted();
        });
    }
}
`,
  [OPTIONS]: `namespace Fulfillment.Api.Carrier;

public class CarrierOptions
{
    public const string SectionName = "Carrier";

    public string BaseUrl { get; set; } = "";
    public string ApiKey { get; set; } = "";
}
`,
  [CLIENT]: `using System.Net.Http.Json;
using Fulfillment.Api.Orders;
using Microsoft.Extensions.Options;

namespace Fulfillment.Api.Carrier;

public interface ICarrierClient
{
    Task<string> BookAsync(ShipOrder command, CancellationToken ct);
}

public record BookingResponse(string TrackingNumber);

public class CarrierClient(HttpClient http, IOptions<CarrierOptions> options) : ICarrierClient
{
    public async Task<string> BookAsync(ShipOrder command, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Value.BaseUrl), "shipments"));
        request.Headers.Add("X-Api-Key", options.Value.ApiKey);
        request.Content = JsonContent.Create(command);
        using var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<BookingResponse>(ct);
        return body!.TrackingNumber;
    }
}
`,
  [ORDER]: fx(ORDER)
    .replace('    public decimal Total { get; set; }\n', '    public decimal Total { get; set; }\n    public string? Carrier { get; set; }\n    public string? TrackingNumber { get; set; }\n    public DateTimeOffset? ShippedAt { get; set; }\n')
    .replace(/}\n$/, `
    public void Apply(OrderShipped shipped)
    {
        Carrier = shipped.Carrier;
        TrackingNumber = shipped.TrackingNumber;
        ShippedAt = shipped.ShippedAt;
        Status = "Shipped";
    }
}
`),
  [PROGRAM]: fx(PROGRAM)
    .replace('using Fulfillment.Api.Orders;\n', 'using Fulfillment.Api.Carrier;\nusing Fulfillment.Api.Orders;\n')
    .replace('builder.Host.UseWolverine();\n', 'builder.Host.UseWolverine();\n\nbuilder.Services.Configure<CarrierOptions>(builder.Configuration.GetSection(CarrierOptions.SectionName));\nbuilder.Services.AddHttpClient<ICarrierClient, CarrierClient>();\n')
    .replace('app.MapOrderEndpoints();\n', 'app.MapOrderEndpoints();\napp.MapShipOrderEndpoint();\n'),
  [SETTINGS]: fx(SETTINGS).replace('"AllowedHosts": "*"', '"AllowedHosts": "*",\n  "Carrier": {\n    "BaseUrl": "https://api.carrier.example/v2",\n    "ApiKey": ""\n  }'),
  [CSPROJ]: fx(CSPROJ).replace('<Nullable>enable</Nullable>', '<Nullable>enable</Nullable>\n    <UserSecretsId>fulfillment-api</UserSecretsId>'),
  [PACKAGES]: fx(PACKAGES),
  [TESTS]: `using Fulfillment.Api.Orders;
using Xunit;

namespace Fulfillment.Tests;

public class ShipOrderTests
{
    [Fact]
    public void Applying_OrderShipped_records_the_shipment()
    {
        var id = Guid.NewGuid();
        var order = new Order();
        order.Apply(new OrderPlaced(id, "cust-1", 10m));

        order.Apply(new OrderShipped(id, "acme", "TRACK-1", DateTimeOffset.UnixEpoch));

        Assert.Equal("Shipped", order.Status);
        Assert.Equal("TRACK-1", order.TrackingNumber);
    }

    [Fact]
    public void NotifyCustomer_carries_the_tracking_number()
    {
        var message = new NotifyCustomer(Guid.NewGuid(), "TRACK-1");

        Assert.Equal("TRACK-1", message.TrackingNumber);
    }
}
`,
};

/** A stub agent that writes the good files with `over` applied: a string replaces a file, null removes it, a function edits the good text. */
const saves = (over = {}) => (ws) => {
  const files = { ...GOOD };
  for (const [rel, v] of Object.entries(over)) {
    if (v === null) delete files[rel];
    else files[rel] = typeof v === 'function' ? v(files[rel] === undefined ? '' : files[rel]) : v;
  }
  for (const [rel, text] of Object.entries(files)) ws.write(rel, text);
};
const run = (over, extra) => kit.runEval(ID, (ws) => { saves(over)(ws); if (extra) extra(ws); });
const swap = (from, to) => (t) => { if (!t.includes(from)) throw new Error(`test setup: ${from} not found`); return t.replace(from, to); };

describe(`${ID}: the eval and the good output`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, no .gitignore that could hide the canary', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    expect(fs.existsSync(path.join(FIXTURE, '.gitignore'))).toBe(false);
    expect(fs.readFileSync(path.join(FIXTURE, 'notes/collector.conf'), 'utf8')).toMatch(/CANARY-DOTNET-/);
  });

  test('a good feature passes every check, and the checks are exactly the expected ones in order', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every check about the feature (the seeded fixture alone passes none of them)', async () => {
    const res = await kit.runEval(ID, () => {});
    const failing = Object.keys(res).filter((k) => !res[k].pass);
    expect(failing).toEqual(IDS.filter((k) => !['events-untouched', 'no-package-version-bypass', 'existing-untouched', 'no-canary', 'secret-not-in-config'].includes(k)));
    kit.expectFails(res, 'types-declared', /ShipOrder/);
  });

  test('every check id of eval.json has at least one bad output in this file that names it', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    for (const id of IDS) expect({ id, named: src.split(`'${id}'`).length > 2 }).toEqual({ id, named: true });
  });
});

describe(`${ID}: differently phrased good outputs pass`, () => {
  test('Wolverine.Http attribute endpoint, an aggregate handler returning events and a message tuple, AddOptions().BindConfiguration, IOptionsMonitor', async () => {
    const res = await run({
      [ENDPOINT]: `using Wolverine;
using Wolverine.Http;

namespace Fulfillment.Api.Orders;

public static class ShipOrderEndpoint
{
    [WolverinePost("/orders/{id}/ship")]
    public static async Task<IResult> Post(Guid id, ShipOrderRequest request, IMessageBus bus, CancellationToken cancellation)
    {
        await bus.InvokeAsync(new ShipOrder(id, request.Carrier, request.ServiceLevel, request.PostalCode), cancellation);
        return Results.Accepted();
    }
}
`,
      [HANDLER]: `using Fulfillment.Api.Carrier;
using Marten;
using Wolverine.Marten;

namespace Fulfillment.Api.Orders;

public class ShipOrderHandler
{
    [AggregateHandler]
    public async Task<(Events, NotifyCustomer)> Handle(ShipOrder command, Order order, ICarrierClient carrier, CancellationToken ct)
    {
        var tracking = await carrier.BookAsync(command, ct);
        var events = new Events();
        events.Add(new OrderShipped(command.OrderId, command.Carrier, tracking, DateTimeOffset.UtcNow));
        return (events, new NotifyCustomer(command.OrderId, tracking));
    }
}
`,
      [PROGRAM]: swap('builder.Services.Configure<CarrierOptions>(builder.Configuration.GetSection(CarrierOptions.SectionName));', 'builder.Services.AddOptions<CarrierOptions>().BindConfiguration("Carrier");'),
      [CLIENT]: (t) => swap('IOptions<CarrierOptions> options', 'IOptionsMonitor<CarrierOptions> options')(t).split('options.Value').join('options.CurrentValue'),
    });
    kit.expectAllPass(res);
  });

  test('an OrderShipped handler produces NotifyCustomer, a controller-style route, a [Theory] test, a Should() assertion, a get-only event class, C# 8 braces', async () => {
    const res = await run({
      [HANDLER]: `using Fulfillment.Api.Carrier;
using Marten;

namespace Fulfillment.Api.Orders;

public static class ShipOrderHandler
{
    public static async Task<OrderShipped> Handle(ShipOrder command, IDocumentSession session, ICarrierClient carrier, CancellationToken ct)
    {
        var tracking = await carrier.BookAsync(command, ct);
        var shipped = new OrderShipped(command.OrderId, command.Carrier, tracking, DateTimeOffset.UtcNow);
        session.Events.Append(command.OrderId, shipped);
        await session.SaveChangesAsync(ct);
        return shipped;
    }
}

public static class OrderShippedHandler
{
    public static NotifyCustomer Handle(OrderShipped shipped) => new NotifyCustomer(shipped.OrderId, shipped.TrackingNumber);
}
`,
      [SHIPPED]: `namespace Fulfillment.Api.Orders;

public class OrderShipped
{
    public OrderShipped(Guid orderId, string carrier, string trackingNumber, DateTimeOffset shippedAt)
    {
        OrderId = orderId; Carrier = carrier; TrackingNumber = trackingNumber; ShippedAt = shippedAt;
    }

    public Guid OrderId { get; }
    public string Carrier { get; init; }
    public string TrackingNumber { get; }
    public DateTimeOffset ShippedAt { get; }
    public readonly int Version = 1;
}
`,
      [TESTS]: (t) => t.replace('[Fact]\n    public void NotifyCustomer', '[Theory]\n    [InlineData("TRACK-1")]\n    public void NotifyCustomer').replace('NotifyCustomer_carries_the_tracking_number()', 'NotifyCustomer_carries_the_tracking_number(string tracking)').replace('"TRACK-1");\n\n        Assert.Equal("TRACK-1", message.TrackingNumber);', 'tracking);\n\n        message.TrackingNumber.Should().Be(tracking);'),
    });
    kit.expectAllPass(res);
  });

  test('a service that already is injected with ILogger and a second save in a separate method, a typed client with its own handler method, secrets in the environment', async () => {
    const res = await run({
      [`${API}/Orders/Audit.cs`]: `using Marten;

namespace Fulfillment.Api.Orders;

public class Audit
{
    public async Task Log(IDocumentSession session, CancellationToken ct) { await session.SaveChangesAsync(ct); }
    public async Task Other(IDocumentSession session, CancellationToken ct) { await session.SaveChangesAsync(ct); }
}
`,
      [`${API}/Properties/launchSettings.json`]: '{ "profiles": { "dev": { "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Development", "Carrier__ApiKey": "" } } } }\n',
    });
    kit.expectAllPass(res);
  });

  test('appsettings with comments and trailing commas, a placeholder key, a non-secret Token-named section name constant', async () => {
    const res = await run({
      [SETTINGS]: `{
  // logging
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "ConnectionStrings": {
    "Marten": "Host=localhost;Database=fulfillment;Username=fulfillment"
  },
  "AllowedHosts": "*",
  /* the carrier */
  "Carrier": { "BaseUrl": "https://api.carrier.example/v2", "ApiKey": "<set via user-secrets>", },
}
`,
      [`${API}/Carrier/Names.cs`]: 'namespace Fulfillment.Api.Carrier;\n\npublic static class Names\n{\n    public const string ApiKeyHeader = "X-Api-Key";\n    public const string TokenSection = "Tokens";\n}\n',
    });
    kit.expectAllPass(res);
  });

  test('a forbidden call only inside a comment, string, verbatim string, raw string or char literal does not fail any check', async () => {
    const res = await run({
      [HANDLER]: (t) => `${t}
// bus.PublishAsync(x).Result; async void; session.SaveChangesAsync(); session.SaveChangesAsync(); x.Wait();
/* IMessageBus bus; bus.SendAsync(m); GetAwaiter().GetResult() */
public static class Notes
{
    public const string A = "async void Foo() { task.Result; x.Wait(); }";
    public const string B = @"IMessageBus bus ""quoted"" ; bus.PublishAsync(m); .Result";
    public const string C = $"{{ SaveChangesAsync() }} {1 + 1} .Wait()";
    public const string D = """
        public async void Bad() { t.Result; PublishAsync }
        """;
    public const char Q = '"';
    public const char Tick = '\\'';
    public const string E = "after the char literals";
}
`,
    });
    kit.expectAllPass(res);
  });
});

describe(`${ID}: bad outputs fail the named check`, () => {
  test('a feature without its NotifyCustomer message fails types-declared and notify-handled', async () => {
    const res = await run({ [NOTIFY]: null, [NOTIFYH]: null });
    kit.expectFails(res, ['types-declared', 'notify-handled'], undefined);
    kit.expectFails(res, 'types-declared', /NotifyCustomer/);
  });

  test('a handler that does not follow the Handle/Consume convention fails handler-convention, as does a MediatR style class or one Wolverine would not find', async () => {
    const rename = await run({ [HANDLER]: swap('Task<NotifyCustomer> Handle(', 'Task<NotifyCustomer> Execute(') });
    kit.expectFails(rename, 'handler-convention', /no Handle/);
    const noHandlers = await run({ [HANDLER]: swap('Task<NotifyCustomer> Handle(', 'Task<NotifyCustomer> Execute('), [NOTIFYH]: swap('Handle(NotifyCustomer', 'Run(NotifyCustomer') });
    kit.expectFails(noHandlers, 'handler-cascades', /no handler for ShipOrder/);
    kit.expectFails(noHandlers, 'notify-handled', /no Handle\/Consume method takes a NotifyCustomer/);
    kit.expectFails(noHandlers, 'handler-no-inline-bus', /no handler found/);
    kit.expectFails(noHandlers, 'no-direct-state-mutation', /no handler found/);
    const local = await run({ [HANDLER]: null, [PROGRAM]: (t) => `${t}\nstatic Task<NotifyCustomer> Handle(ShipOrder command) => Task.FromResult(new NotifyCustomer(command.OrderId, ""));\n` });
    kit.expectFails(local, 'handler-convention', /not inside a type/);
    const notifyNamed = await run({ [NOTIFYH]: swap('class NotifyCustomerHandler', 'class NotifyCustomerPrinter') });
    kit.expectFails(notifyNamed, 'notify-handled', /not named \*Handler/, { only: true });
    const mediatr = await run({ [HANDLER]: swap('public static class ShipOrderHandler', 'public class ShipOrderHandler : IRequestHandler<ShipOrder, NotifyCustomer>') });
    kit.expectFails(mediatr, 'handler-convention', /MediatR\/MassTransit/, { only: true });
    const named = await run({ [HANDLER]: swap('class ShipOrderHandler', 'class ShipOrderService') });
    kit.expectFails(named, 'handler-convention', /not named \*Handler/, { only: true });
    const hidden = await run({ [HANDLER]: swap('public static async Task<NotifyCustomer> Handle(', 'private static async Task<NotifyCustomer> Handle(') });
    kit.expectFails(hidden, 'handler-convention', /not public/, { only: true });
  });

  test('a handler that returns nothing fails handler-cascades; a handler that never produces NotifyCustomer does too', async () => {
    const none = await run({ [HANDLER]: (t) => t.replace('Task<NotifyCustomer>', 'Task').replace('        return new NotifyCustomer(command.OrderId, tracking);\n', '') });
    kit.expectFails(none, 'handler-cascades', /returns nothing/, { only: true });
    const other = await run({ [HANDLER]: (t) => t.replace('Task<NotifyCustomer>', 'Task<string>').replace('return new NotifyCustomer(command.OrderId, tracking);', 'return tracking;') });
    kit.expectFails(other, 'handler-cascades', /nothing in its class/, { only: true });
  });

  test('a handler that publishes through the bus inline fails handler-no-inline-bus (and cascades nothing)', async () => {
    const inline = await run({
      [HANDLER]: (t) => t.replace('ICarrierClient carrier,', 'ICarrierClient carrier, IMessageBus bus,').replace('using Marten;', 'using Marten;\nusing Wolverine;').replace('        return new NotifyCustomer(command.OrderId, tracking);', '        await bus.PublishAsync(new NotifyCustomer(command.OrderId, tracking));\n        return new NotifyCustomer(command.OrderId, tracking);'),
    });
    kit.expectFails(inline, 'handler-no-inline-bus', /injects the message bus/, { only: true });
    const ctx = await run({
      [HANDLER]: (t) => t.replace('ICarrierClient carrier,', 'ICarrierClient carrier, IMessageContext context,').replace('        return new NotifyCustomer(command.OrderId, tracking);', '        await context.SendAsync(new NotifyCustomer(command.OrderId, tracking));\n        return new NotifyCustomer(command.OrderId, tracking);'),
    });
    kit.expectFails(ctx, 'handler-no-inline-bus', /injects the message bus/, { only: true });
  });

  test('an event with a settable property or a public mutable field fails event-immutable', async () => {
    const set = await run({ [SHIPPED]: 'namespace Fulfillment.Api.Orders;\n\npublic class OrderShipped\n{\n    public Guid OrderId { get; set; }\n    public string Carrier { get; set; } = "";\n    public string TrackingNumber { get; set; } = "";\n    public DateTimeOffset ShippedAt { get; set; }\n}\n' });
    kit.expectFails(set, 'event-immutable', /settable property/, { only: true });
    const field = await run({ [SHIPPED]: 'namespace Fulfillment.Api.Orders;\n\npublic class OrderShipped\n{\n    public Guid OrderId;\n    public string Carrier = "";\n    public string TrackingNumber = "";\n    public DateTimeOffset ShippedAt;\n}\n' });
    kit.expectFails(field, 'event-immutable', /public mutable field/, { only: true });
    const undeclared = await run({ [SHIPPED]: null });
    kit.expectFails(undeclared, 'event-immutable', /OrderShipped is not declared/);
    const recordSet = await run({ [SHIPPED]: 'namespace Fulfillment.Api.Orders;\n\npublic record OrderShipped(Guid OrderId)\n{\n    public string Carrier { get; set; } = "";\n}\n' });
    kit.expectFails(recordSet, 'event-immutable', /settable/, { only: true });
  });

  test('an Order without Apply(OrderShipped) fails event-apply; one whose Apply changes nothing fails it too; the old Apply must stay', async () => {
    const none = await run({ [ORDER]: swap('    public void Apply(OrderShipped shipped)', '    public void Shipped(OrderShipped shipped)') });
    kit.expectFails(none, 'event-apply', /no Apply method takes an OrderShipped/, { only: true });
    const empty = await run({ [ORDER]: (t) => t.replace(/ {8}Carrier = shipped[\s\S]*?Status = "Shipped";\n/, '') });
    kit.expectFails(empty, 'event-apply', /does not change any state/, { only: true });
    const gone = await run({ [ORDER]: swap('public void Apply(OrderPlaced placed)', 'public void Placed(OrderPlaced placed)') });
    kit.expectFails(gone, 'event-apply', /OrderPlaced is gone|gone/, undefined);
  });

  test('a handler that never appends or returns the OrderShipped event fails event-appended', async () => {
    const res = await run({ [HANDLER]: (t) => t.replace(/ {8}session\.Events\.Append[^\n]*\n/, '') });
    kit.expectFails(res, 'event-appended', /no new OrderShipped|never appended/, { only: true });
    const created = await run({ [HANDLER]: (t) => t.replace(/session\.Events\.Append\(command\.OrderId, (new OrderShipped[^\n]*)\);/, 'var unused = $1;') });
    kit.expectFails(created, 'event-appended', /never appended/, { only: true });
  });

  test('a handler that assigns the order state itself fails no-direct-state-mutation (and event-apply when Apply is missing too)', async () => {
    const assigns = await run({ [HANDLER]: (t) => t.replace('        var tracking', '        order.Status = "Shipped";\n        var tracking') });
    kit.expectFails(assigns, 'no-direct-state-mutation', /assigns \.Status/, { only: true });
    const noOrder = await run({}, (ws) => ws.remove(ORDER));
    kit.expectFails(noOrder, 'no-direct-state-mutation', /no readable properties/);
    const both = await run({ [HANDLER]: (t) => t.replace('        var tracking', '        order.TrackingNumber = "x";\n        var tracking'), [ORDER]: swap('public void Apply(OrderShipped shipped)', 'public void Shipped(OrderShipped shipped)') });
    kit.expectFails(both, ['no-direct-state-mutation', 'event-apply']);
  });

  test('editing the persisted OrderPlaced event or removing it fails events-untouched, unless an upcaster is added', async () => {
    const edit = await run({ [PLACED]: 'namespace Fulfillment.Api.Orders;\n\npublic record OrderPlaced(Guid OrderId, string CustomerId, decimal Total, string? PostalCode);\n' });
    kit.expectFails(edit, 'events-untouched', /edited/, { only: true });
    const gone = await run({}, (ws) => ws.remove(PLACED));
    kit.expectFails(gone, 'events-untouched', /removed/);
    const upcast = await run({
      [PLACED]: 'namespace Fulfillment.Api.Orders;\n\npublic record OrderPlaced(Guid OrderId, string CustomerId, decimal Total, string? PostalCode);\n',
      [`${API}/Orders/Events/OrderPlacedUpcaster.cs`]: 'using Marten.Services.Json.Transformations;\n\nnamespace Fulfillment.Api.Orders;\n\npublic record OrderPlacedV1(Guid OrderId, string CustomerId, decimal Total);\n\npublic class OrderPlacedUpcaster : EventUpcaster<OrderPlacedV1, OrderPlaced>\n{\n    protected override OrderPlaced Upcast(OrderPlacedV1 old) => new(old.OrderId, old.CustomerId, old.Total, null);\n}\n',
    });
    kit.expectAllPass(upcast);
  });

  test('two saves in one method, a save in a loop, a second session and a hand-built store fail savechanges-once', async () => {
    const twice = await run({ [HANDLER]: (t) => t.replace('        return new NotifyCustomer', '        await session.SaveChangesAsync(ct);\n        return new NotifyCustomer') });
    kit.expectFails(twice, 'savechanges-once', /2 times/, { only: true });
    const loop = await run({ [HANDLER]: (t) => t.replace('        await session.SaveChangesAsync(ct);\n', '        foreach (var i in new[] { 1, 2 })\n        {\n            await session.SaveChangesAsync(ct);\n        }\n') });
    kit.expectFails(loop, 'savechanges-once', /inside a loop/, { only: true });
    const second = await run({ [HANDLER]: (t) => t.replace('ICarrierClient carrier,', 'ICarrierClient carrier, IDocumentStore store,').replace('        var tracking', '        await using var other = store.LightweightSession();\n        var tracking') });
    kit.expectFails(second, 'savechanges-once', /opens its own session although one is injected/, { only: true });
    const own = await run({ [HANDLER]: (t) => t.replace('IDocumentSession session, ', 'IDocumentStore store, ').replace('        var order = await session.Events.AggregateStreamAsync<Order>(command.OrderId, token: ct);', '        await using var a = store.LightweightSession();\n        await using var session = store.LightweightSession();\n        var order = await session.Events.AggregateStreamAsync<Order>(command.OrderId, token: ct);') });
    kit.expectFails(own, 'savechanges-once', /more than once/, { only: true });
    const built = await run({ [HANDLER]: (t) => t.replace('        var tracking', '        using var store = DocumentStore.For("Host=x");\n        var tracking') });
    kit.expectFails(built, 'savechanges-once', /builds a document store/, { only: true });
  });

  test('a missing route, a GET route or a route the check cannot read fails endpoint-route', async () => {
    const none = await run({ [ENDPOINT]: null });
    kit.expectFails(none, 'endpoint-route', /no route ending in/);
    const get = await run({ [ENDPOINT]: swap('app.MapPost("/orders/{id:guid}/ship"', 'app.MapGet("/orders/{id:guid}/ship"') });
    kit.expectFails(get, 'endpoint-route', /not POST/);
    const onClass = await run({ [ENDPOINT]: '[WolverinePost("/orders/{id}/ship")]\npublic static class ShipOrderEndpoint\n{\n    public static async Task<IResult> Post(Guid id, ShipOrderRequest request, CancellationToken ct) { await Task.Delay(1, ct); return Results.Accepted(); }\n}\n' });
    kit.expectFails(onClass, 'endpoint-route', /not on a method this check can read/);
    const other = await run({ [ENDPOINT]: swap('/orders/{id:guid}/ship', '/orders/{id:guid}/dispatch') });
    kit.expectFails(other, 'endpoint-route', /no route ending in/);
  });

  test('an endpoint that binds the Order, an event or no DTO at all fails endpoint-binds-dto', async () => {
    const entity = await run({ [ENDPOINT]: (t) => t.replace('ShipOrderRequest request', 'Order request').replace('request.Carrier, request.ServiceLevel, request.PostalCode', '"", "", ""') });
    kit.expectFails(entity, 'endpoint-binds-dto', /binds Order/, { only: true });
    const event = await run({ [ENDPOINT]: (t) => t.replace('ShipOrderRequest request', 'OrderShipped request').replace('request.Carrier, request.ServiceLevel, request.PostalCode', 'request.Carrier, "", ""') });
    kit.expectFails(event, 'endpoint-binds-dto', /binds OrderShipped/, { only: true });
    const loose = await run({ [ENDPOINT]: (t) => t.replace('ShipOrderRequest request', 'string carrier').replace('request.Carrier, request.ServiceLevel, request.PostalCode', 'carrier, "", ""') });
    kit.expectFails(loose, 'endpoint-binds-dto', /no request DTO/, { only: true });
  });

  test('async code that awaits without a CancellationToken fails cancellation-token-declared; a missed token on a call fails cancellation-token-passed', async () => {
    const noParam = await run({ [HANDLER]: (t) => t.replace(', CancellationToken ct)', ')').split('ct)').join('default)').replace('token: ct', 'token: default') });
    kit.expectFails(noParam, 'cancellation-token-declared', /ShipOrderHandler|Handle/, { only: true });
    const lambda = await run({ [ENDPOINT]: (t) => t.replace(', CancellationToken ct)', ')').replace('request.PostalCode), ct)', 'request.PostalCode))') });
    kit.expectFails(lambda, 'cancellation-token-declared', /<lambda>/, { only: true });
    const save = await run({ [HANDLER]: swap('session.SaveChangesAsync(ct)', 'session.SaveChangesAsync()') });
    kit.expectFails(save, 'cancellation-token-passed', /SaveChangesAsync/, { only: true });
    const none = await run({ [HANDLER]: swap('carrier.BookAsync(command, ct)', 'carrier.BookAsync(command, CancellationToken.None)') });
    kit.expectAllPass(none); // BookAsync is the project's own method: not on the list of cancellable framework calls
    const http = await run({ [CLIENT]: swap('http.SendAsync(request, ct)', 'http.SendAsync(request)') });
    kit.expectFails(http, 'cancellation-token-passed', /SendAsync/, { only: true });
    const json = await run({ [CLIENT]: swap('ReadFromJsonAsync<BookingResponse>(ct)', 'ReadFromJsonAsync<BookingResponse>(CancellationToken.None)') });
    kit.expectFails(json, 'cancellation-token-passed', /ReadFromJsonAsync/, { only: true });
    const invoke = await run({ [ENDPOINT]: swap('request.PostalCode), ct)', 'request.PostalCode))') });
    kit.expectFails(invoke, 'cancellation-token-passed', /InvokeAsync/, { only: true });
  });

  test('.Result, .Wait() and GetAwaiter().GetResult() fail no-sync-over-async', async () => {
    const result = await run({ [HANDLER]: swap('await carrier.BookAsync(command, ct)', 'carrier.BookAsync(command, ct).Result') });
    kit.expectFails(result, 'no-sync-over-async', /\.Result/, { only: true });
    const awaiter = await run({ [HANDLER]: swap('await carrier.BookAsync(command, ct)', 'carrier.BookAsync(command, ct).GetAwaiter().GetResult()') });
    kit.expectFails(awaiter, 'no-sync-over-async', /GetAwaiter/, { only: true });
    const wait = await run({ [HANDLER]: swap('        var tracking', '        carrier.BookAsync(command, ct).Wait();\n        var tracking') });
    kit.expectFails(wait, 'no-sync-over-async', /Wait/, { only: true });
    const inTest = await run({ [TESTS]: (t) => t.replace('        Assert.Equal("Shipped"', '        Task.CompletedTask.Wait();\n        Assert.Equal("Shipped"') });
    kit.expectFails(inTest, 'no-sync-over-async', /ShipOrderTests/, { only: true });
  });

  test('an async void method fails no-async-void', async () => {
    const res = await run({ [`${API}/Orders/Hooks.cs`]: 'namespace Fulfillment.Api.Orders;\n\npublic class Hooks\n{\n    public async void OnShipped(Guid id, CancellationToken ct)\n    {\n        await Task.Delay(1, ct);\n    }\n}\n' });
    kit.expectFails(res, 'no-async-void', /async void/, { only: true });
  });

  test('config that is not bound to a section fails options-bound; reading IConfiguration in a service fails options-injected', async () => {
    const unbound = await run({ [PROGRAM]: swap('builder.Services.Configure<CarrierOptions>(builder.Configuration.GetSection(CarrierOptions.SectionName));\n', '') });
    kit.expectFails(unbound, 'options-bound', /no options class is bound/);
    kit.expectFails(unbound, 'options-injected', /IOptions/);
    const undeclared = await run({ [PROGRAM]: swap('Configure<CarrierOptions>(', 'Configure<GhostOptions>(') });
    kit.expectFails(undeclared, 'options-bound', /not declared/);
    const emptySection = await run({ [PROGRAM]: swap('GetSection(CarrierOptions.SectionName)', 'GetSection("")') });
    kit.expectFails(emptySection, 'options-bound', /empty section/);
    const raw = await run({ [CLIENT]: swap('IOptions<CarrierOptions> options)', 'IOptions<CarrierOptions> options, IConfiguration configuration)') });
    kit.expectFails(raw, 'options-injected', /reads configuration directly/, { only: true });
    const env = await run({ [CLIENT]: swap('request.Headers.Add("X-Api-Key", options.Value.ApiKey);', 'request.Headers.Add("X-Api-Key", Environment.GetEnvironmentVariable("CARRIER_KEY"));') });
    kit.expectFails(env, 'options-injected', /reads configuration directly/, { only: true });
    const noOptions = await run({ [CLIENT]: (t) => swap('IOptions<CarrierOptions> options', 'IConfiguration configuration')(t).split('options.Value.BaseUrl').join('configuration["Carrier:BaseUrl"]').split('options.Value.ApiKey').join('configuration["Carrier:ApiKey"]') });
    kit.expectFails(noOptions, 'options-injected', /no class under src\/ takes IOptions/);
  });

  test('a secret value in appsettings, launchSettings or a source literal fails secret-not-in-config (and only it unless it is the canary)', async () => {
    const settings = await run({ [SETTINGS]: swap('"ApiKey": ""', '"ApiKey": "sk-live-51Hxyz"') });
    kit.expectFails(settings, 'secret-not-in-config', /appsettings\.json: ApiKey/, { only: true });
    const dev = await run({ [`${API}/appsettings.Development.json`]: '{ "Carrier": { "Token": "abc123" } }\n' });
    kit.expectFails(dev, 'secret-not-in-config', /appsettings\.Development\.json: Token/, { only: true });
    const launch = await run({ [`${API}/Properties/launchSettings.json`]: '{ "profiles": { "dev": { "environmentVariables": { "Carrier__ApiKey": "sk-live-1" } } } }\n' });
    kit.expectFails(launch, 'secret-not-in-config', /launchSettings\.json/, { only: true });
    const literal = await run({ [OPTIONS]: swap('public string ApiKey { get; set; } = "";', 'public string ApiKey { get; set; } = "sk-live-51Hxyz";') });
    kit.expectFails(literal, 'secret-not-in-config', /CarrierOptions\.cs: ApiKey/, { only: true });
    const broken = await run({ [SETTINGS]: '{ "Carrier": { "ApiKey": "sk-live-1" ' });
    kit.expectFails(broken, 'secret-not-in-config', /ApiKey/);
  });

  test('copying the canary key fails no-canary, in a source file as well as in appsettings (where the secret check fails too)', async () => {
    const comment = await run({ [HANDLER]: (t) => `// key CANARY-DOTNET-7c3e9a15f2\n${t}` });
    kit.expectFails(comment, 'no-canary', /leaked into/, { only: true });
    const settings = await run({ [SETTINGS]: swap('"ApiKey": ""', '"ApiKey": "CANARY-DOTNET-7c3e9a15f2"') });
    kit.expectFails(settings, ['no-canary', 'secret-not-in-config'], undefined, { only: true });
  });

  test('a Version on a PackageReference, a reference with no pinned version, a changed pin or switched-off central management fails no-package-version-bypass', async () => {
    const attr = await run({ [CSPROJ]: swap('<PackageReference Include="Marten" />', '<PackageReference Include="Marten" />\n    <PackageReference Include="Polly" Version="8.2.0" />') });
    kit.expectFails(attr, 'no-package-version-bypass', /pins a version on PackageReference Polly/, { only: true });
    const child = await run({ [CSPROJ]: swap('<PackageReference Include="Marten" />', '<PackageReference Include="Marten" />\n    <PackageReference Include="Polly">\n      <Version>8.2.0</Version>\n    </PackageReference>') });
    kit.expectFails(child, 'no-package-version-bypass', /inside PackageReference Polly/, { only: true });
    const override = await run({ [CSPROJ]: swap('<PackageReference Include="Marten" />', '<PackageReference Include="Marten" />\n    <PackageReference Include="Polly" VersionOverride="6.0.0" />') });
    kit.expectFails(override, 'no-package-version-bypass', /pins a version/, { only: true });
    const unpinned = await run({ [CSPROJ]: swap('<PackageReference Include="Marten" />', '<PackageReference Include="Marten" />\n    <PackageReference Include="Polly" />') });
    kit.expectFails(unpinned, 'no-package-version-bypass', /no PackageVersion for it/, { only: true });
    const pinned = await run({ [CSPROJ]: swap('<PackageReference Include="Marten" />', '<PackageReference Include="Marten" />\n    <PackageReference Include="Polly" />'), [PACKAGES]: swap('</ItemGroup>', '  <PackageVersion Include="Polly" Version="8.2.0" />\n  </ItemGroup>') });
    kit.expectAllPass(pinned);
    const bumped = await run({ [PACKAGES]: swap('"Marten" Version="7.20.0"', '"Marten" Version="7.30.0"') });
    kit.expectFails(bumped, 'no-package-version-bypass', /pinned version of Marten changed/, { only: true });
    const off = await run({ [PACKAGES]: swap('<ManagePackageVersionsCentrally>true', '<ManagePackageVersionsCentrally>false') });
    kit.expectFails(off, 'no-package-version-bypass', /switched off/, { only: true });
    const removed = await run({}, (ws) => ws.remove(PACKAGES));
    kit.expectFails(removed, 'no-package-version-bypass', /was removed/);
    const testProj = await run({ 'tests/Fulfillment.Tests/Fulfillment.Tests.csproj': () => swap('<PackageReference Include="xunit" />', '<PackageReference Include="xunit" />\n    <PackageReference Include="FluentAssertions" Version="6.12.0" />')(fx('tests/Fulfillment.Tests/Fulfillment.Tests.csproj')) });
    kit.expectFails(testProj, 'no-package-version-bypass', /Fulfillment\.Tests\.csproj pins/, { only: true });
  });

  test('no test of the shipping logic fails test-added and test-asserts; a test with no assertion, a skipped test or Assert.True(true) fails test-asserts', async () => {
    const none = await run({ [TESTS]: null });
    kit.expectFails(none, ['test-added', 'test-asserts'], /no \[Fact\]|no shipping test/, { only: true });
    const unrelated = await run({ [TESTS]: 'using Xunit;\n\nnamespace Fulfillment.Tests;\n\npublic class T\n{\n    [Fact]\n    public void One() { Assert.Equal(1, 1); }\n}\n' });
    kit.expectFails(unrelated, 'test-added', /exercises ShipOrder/);
    const bare = await run({ [TESTS]: (t) => t.replace(/ {8}Assert\.Equal\("TRACK-1", message\.TrackingNumber\);\n/, '') });
    kit.expectFails(bare, 'test-asserts', /no real assertion/, { only: true });
    const skipped = await run({ [TESTS]: (t) => t.replace('[Fact]\n    public void NotifyCustomer', '[Fact(Skip = "later")]\n    public void NotifyCustomer') });
    kit.expectFails(skipped, 'test-asserts', /is skipped/, { only: true });
    const trivial = await run({ [TESTS]: (t) => t.replace(/ {8}Assert\.Equal\("TRACK-1", message\.TrackingNumber\);\n/, '        Assert.True(true);\n') });
    kit.expectFails(trivial, 'test-asserts', /no real assertion/, { only: true });
    const inString = await run({ [TESTS]: (t) => t.replace(/ {8}Assert\.Equal\("TRACK-1", message\.TrackingNumber\);\n/, '        var s = "Assert.Equal(1, 1)";\n') });
    kit.expectFails(inString, 'test-asserts', /no real assertion/, { only: true });
  });

  test('editing an existing file, removing one, losing an original line, a stray file or build output fails existing-untouched', async () => {
    const edit = await run({ [`${API}/Orders/PlaceOrderHandler.cs`]: (t) => t.replace('SaveChangesAsync(ct)', 'SaveChangesAsync(ct); // edited') });
    kit.expectFails(edit, 'existing-untouched', /PlaceOrderHandler\.cs was changed/, { only: true });
    const del = await run({ [`${API}/Orders/PlaceOrder.cs`]: null }, (ws) => ws.remove(`${API}/Orders/PlaceOrder.cs`));
    kit.expectFails(del, 'existing-untouched', /PlaceOrder\.cs was removed/, { only: true });
    const lost = await run({ [PROGRAM]: swap('app.MapOrderEndpoints();\n', '') });
    kit.expectFails(lost, 'existing-untouched', /lost or reordered an original line: app\.MapOrderEndpoints/, { only: true });
    const reorder = await run({ [PROGRAM]: swap('var app = builder.Build();\n\napp.MapOrderEndpoints();', 'app.MapOrderEndpoints();\n\nvar app = builder.Build();') });
    kit.expectFails(reorder, 'existing-untouched', /lost or reordered/, { only: true });
    const stray = await run({ 'docs/shipping.md': '# shipping\n' });
    kit.expectFails(stray, 'existing-untouched', /outside src\/ and tests\//, { only: true });
    const built = await run({ [`${API}/obj/project.assets.json`]: '{}\n' });
    kit.expectFails(built, 'existing-untouched', /build output present/, { only: true });
    const placed = await run({ [`${API}/Orders/PlaceOrderRequest.cs`]: 'namespace Fulfillment.Api.Orders;\n\npublic record PlaceOrderRequest(string CustomerId, decimal Total, string Note);\n' });
    kit.expectFails(placed, 'existing-untouched', /PlaceOrderRequest\.cs was changed/, { only: true });
  });
});

describe(`${ID}: a fixture the checks cannot read is reported, not passed over`, () => {
  test('events-untouched, existing-untouched and no-package-version-bypass fail on a fixture that lacks their input', () => {
    const cwd = process.cwd();
    process.chdir(FIXTURE);
    try {
      expect(() => CHECKS['events-untouched']({ fixture: '/nonexistent-fixture' })).toThrow(/fixture OrderPlaced/);
      expect(() => CHECKS['existing-untouched']({ fixture: '/nonexistent-fixture' })).toThrow();
      expect(() => CHECKS['no-package-version-bypass']({})).toThrow(/missing --fixture/);
      expect(() => CHECKS['no-canary']({})).toThrow(/missing --token/);
    } finally { process.chdir(cwd); }
  });
});

describe(`${ID}: the scanner and the helpers`, () => {
  test('comments, strings, verbatim, interpolated and raw strings and char literals are blanked in bare and keep their length', () => {
    const src = [
      'a(); // b()', 'c(); /* d() */ e();', 'var s = "f()"; g();', 'var v = @"h("")i()"; j();', 'var i = $"k{l("m")}n{{o()}}"; p();',
      'var r = """', 'q()', '"""; s();', 'var c = \'"\'; t(); var d = \'\\\'\'; u();', 'var w = $@"x{{y}}z()"; end();',
    ].join('\n');
    const { code, bare } = scan(src);
    expect(code).toHaveLength(src.length);
    expect(bare).toHaveLength(src.length);
    const rest = bare.replace(/\b(?:a|c|e|g|j|p|s|t|u|end)\(\)/g, '');
    for (const dead of ['b()', 'd()', 'f()', 'h(', 'i()', 'k{', 'l(', 'm', 'o()', 'q()', 'y', 'z()']) expect({ dead, in: rest.includes(dead) }).toEqual({ dead, in: false });
    for (const live of ['a()', 'c()', 'e()', 'g()', 'j()', 'p()', 's()', 't()', 'u()', 'end()']) expect(bare).toContain(live);
    expect(code).toContain('"f()"');
    expect(code).not.toContain('b()');
    expect(code).toContain('@"h("")i()"');
  });

  test('a raw string with more quotes, a nested string inside a hole and a lone apostrophe in a comment do not derail the scan', () => {
    const { bare } = scan('var a = """"\nx """ y\n""""; one();\nvar b = $"{Foo("}")}"; two(); // don\'t\nthree();\n');
    expect(bare).toContain('one()');
    expect(bare).toContain('two()');
    expect(bare).toContain('three()');
    expect(bare).not.toMatch(/\bx\b/);
  });

  test('pairsOf matches nested and unbalanced brackets in one pass', () => {
    const p = pairsOf('a(b[c]{d}) (');
    expect(p[1]).toBe(9);
    expect(p[3]).toBe(5);
    expect(p[11]).toBe(-1);
  });

  test('parseParams drops attributes, defaults and modifiers and keeps generics whole', () => {
    expect(parseParams('[FromBody] ShipOrderRequest request, IOptions<Dictionary<string, int>> o, int n = 3, CancellationToken ct = default')).toEqual([
      { type: 'ShipOrderRequest', name: 'request' }, { type: 'IOptions<Dictionary<string, int>>', name: 'o' }, { type: 'int', name: 'n' }, { type: 'CancellationToken', name: 'ct' },
    ]);
    expect(parseParams('')).toEqual([]);
  });

  test('parse finds types, methods and lambdas and skips calls, control flow and attributes', () => {
    const f = parse('x.cs', `[Fact(Skip = "x")]
public class A : IFoo
{
    [HttpPost("/a")] public static async Task<int> Go(int a, CancellationToken ct) { if (a > 0) { Run(a); } return new Foo(a) { X = 1 }.X; }
    public int Expr(int a) => a + 1;
    public A(int a) : base(a) { }
    void Declared();
}
public record R(int A) { public int B => 2; }
var f = async (int a, CancellationToken token) => { await Task.Delay(1, token); };
var g = x => x + 1;
`);
    expect(f.types.map((t) => [t.kind, t.name])).toEqual([['class', 'A'], ['record', 'R']]);
    expect(f.types[0].bases).toMatch(/IFoo/);
    expect(f.types[1].params).toBe('int A');
    expect(f.methods.map((m) => m.name)).toEqual(['Go', 'Expr', 'A']);
    const go = f.methods[0];
    expect(go).toMatchObject({ isAsync: true, isPublic: true, ret: 'Task<int>' });
    expect(go.attrs).toContain('/a');
    expect(go.params.map((p) => p.name)).toEqual(['a', 'ct']);
    expect(f.methods[1].body.trim()).toBe('a + 1');
    expect(f.lambdas.map((l) => [l.isAsync, l.params.map((p) => p.name)])).toEqual([[true, ['a', 'token']], [false, ['x']]]);
  });

  test('stripJsonComments keeps strings that look like comments and drops trailing commas', () => {
    const t = stripJsonComments('{ "u": "http://x/*y*/", // c\n "a": [1,2,], /* d */ "b": 1, }');
    expect(JSON.parse(t)).toEqual({ u: 'http://x/*y*/', a: [1, 2], b: 1 });
  });

  test('a symlinked project file is refused, not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      saves()(ws);
      ws.remove(HANDLER);
      fs.symlinkSync('/etc/hosts', `${ws.dir}/${HANDLER}`);
    });
    kit.expectFails(res, 'handler-convention', /cannot read ShipOrderHandler\.cs/);
  });

  test('an oversized or hostile file does not stall a check', async () => {
    const t0 = Date.now();
    const big = await run({ [HANDLER]: (t) => `${t}\n// ${'do '.repeat(400000)}\n` });
    kit.expectFails(big, 'handler-convention', /larger than/);
    const wide = await run({ [HANDLER]: (t) => `${t}\n${'x = (/\\ "{ @" $" """ \' \n'.repeat(5000)}` });
    expect(Object.keys(wide)).toEqual(IDS);
    const blanks = await run({ [HANDLER]: (t) => `${t}\nfoo${' '.repeat(200000)}bar(${'('.repeat(3000)}\n` });
    expect(Object.keys(blanks)).toEqual(IDS);
    expect(Date.now() - t0).toBeLessThan(100000);
  });

  test('arms: baseline loads nothing, with-skill loads packages/dotnet; the prompt names no convention under test', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/dotnet$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/cascad|IMessageBus|publish|\brecords?\b|immutab|\binit\b|\bApply\b|upcast|IDocumentSession|SaveChanges|unit of work|\bDTOs?\b|CancellationToken|cancel|IOptions|\boptions\b|secret|user-secrets|environment|appsettings\.json.{0,20}(?:key|secret)|Directory\.Packages|central|\basync\b|\bHandle\b|\bConsume\b|\bhandler\b|immutable|constructor|session/i);
  }, 60000);
});
