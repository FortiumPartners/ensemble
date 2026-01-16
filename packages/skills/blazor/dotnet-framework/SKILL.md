# .NET Framework Skill - Quick Reference

**Framework**: .NET 8+ with ASP.NET Core
**For Agent**: backend-developer
**Purpose**: Fast lookup of common .NET patterns and conventions

---

## 1. ASP.NET Core Web APIs

### Controller-Based API

```csharp
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IMessageBus _bus;
    private readonly IQuerySession _session;

    public OrdersController(IMessageBus bus, IQuerySession session)
    {
        _bus = bus;
        _session = session;
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<OrderDto>> GetOrder(Guid id)
    {
        var order = await _session.LoadAsync<Order>(id);
        return order is not null
            ? Ok(OrderDto.FromEntity(order))
            : NotFound();
    }

    [HttpPost]
    public async Task<ActionResult<Guid>> CreateOrder(CreateOrderCommand command)
    {
        var orderId = await _bus.InvokeAsync<Guid>(command);
        return CreatedAtAction(nameof(GetOrder), new { id = orderId }, orderId);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult> UpdateOrder(Guid id, UpdateOrderCommand command)
    {
        if (id != command.OrderId)
            return BadRequest("ID mismatch");

        await _bus.InvokeAsync(command);
        return NoContent();
    }

    [HttpDelete("{id}")]
    public async Task<ActionResult> DeleteOrder(Guid id)
    {
        await _bus.InvokeAsync(new DeleteOrderCommand(id));
        return NoContent();
    }
}
```

### Minimal API (.NET 8+)

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var orders = app.MapGroup("/api/orders")
    .WithTags("Orders")
    .WithOpenApi();

orders.MapGet("/{id}", async (Guid id, IQuerySession session) =>
{
    var order = await session.LoadAsync<Order>(id);
    return order is not null ? Results.Ok(order) : Results.NotFound();
})
.WithName("GetOrder")
.Produces<Order>(StatusCodes.Status200OK)
.Produces(StatusCodes.Status404NotFound);

orders.MapPost("/", async (CreateOrderCommand cmd, IMessageBus bus) =>
{
    var orderId = await bus.InvokeAsync<Guid>(cmd);
    return Results.Created($"/api/orders/{orderId}", orderId);
})
.WithName("CreateOrder")
.Produces<Guid>(StatusCodes.Status201Created);

app.Run();
```

### Program.cs Setup

```csharp
var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Marten configuration
builder.Services.AddMarten(opts =>
{
    opts.Connection(builder.Configuration.GetConnectionString("Postgres")!);
    opts.AutoCreateSchemaObjects = AutoCreate.CreateOrUpdate;

    // Document schema
    opts.Schema.For<Order>()
        .Index(x => x.CustomerId)
        .Index(x => x.Status);
});

// Wolverine message bus
builder.Host.UseWolverine();

var app = builder.Build();

// Middleware pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
```

---

## 2. Wolverine Message Handling

### Command Handlers

```csharp
// Command
public record CreateOrderCommand(Guid CustomerId, List<OrderItem> Items);

// Handler (static method)
public static class CreateOrderHandler
{
    public static async Task<Guid> Handle(
        CreateOrderCommand command,
        IDocumentSession session,
        CancellationToken ct)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CustomerId = command.CustomerId,
            Items = command.Items,
            Status = OrderStatus.Pending,
            CreatedAt = DateTimeOffset.UtcNow
        };

        session.Store(order);
        await session.SaveChangesAsync(ct);

        // Publish event
        await session.Events.Append(order.Id, new OrderCreated(order.Id, order.CustomerId));

        return order.Id;
    }
}
```

### Query Handlers

```csharp
// Query
public record GetOrderQuery(Guid OrderId);

// Handler
public static class GetOrderQueryHandler
{
    public static async Task<OrderDto?> Handle(
        GetOrderQuery query,
        IQuerySession session)
    {
        var order = await session.LoadAsync<Order>(query.OrderId);
        return order is not null ? OrderDto.FromEntity(order) : null;
    }
}

// Query with pagination
public record GetCustomerOrdersQuery(Guid CustomerId, int Page = 1, int PageSize = 20);

public static class GetCustomerOrdersHandler
{
    public static async Task<PagedResult<OrderDto>> Handle(
        GetCustomerOrdersQuery query,
        IQuerySession session)
    {
        var orders = await session.Query<Order>()
            .Where(o => o.CustomerId == query.CustomerId)
            .OrderByDescending(o => o.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .ToListAsync();

        var total = await session.Query<Order>()
            .CountAsync(o => o.CustomerId == query.CustomerId);

        return new PagedResult<OrderDto>(
            orders.Select(OrderDto.FromEntity),
            total,
            query.Page,
            query.PageSize
        );
    }
}
```

### Event Handlers

```csharp
// Event
public record OrderCreated(Guid OrderId, Guid CustomerId);
public record OrderShipped(Guid OrderId, string TrackingNumber);

// Event handler
public static class OrderCreatedHandler
{
    public static async Task Handle(
        OrderCreated evt,
        IDocumentSession session,
        ILogger<OrderCreatedHandler> logger)
    {
        logger.LogInformation("Order {OrderId} created for customer {CustomerId}",
            evt.OrderId, evt.CustomerId);

        // Trigger follow-up actions
        // Events are automatically cascaded if returned
    }
}
```

---

## 3. MartenDB Document Storage

### Basic Document Operations

```csharp
// Store document
public async Task<Order> CreateOrder(Order order)
{
    using var session = _store.LightweightSession();

    session.Store(order);
    await session.SaveChangesAsync();

    return order;
}

// Load document
public async Task<Order?> GetOrder(Guid id)
{
    using var session = _store.QuerySession();
    return await session.LoadAsync<Order>(id);
}

// Update document
public async Task UpdateOrder(Order order)
{
    using var session = _store.LightweightSession();

    session.Update(order);
    await session.SaveChangesAsync();
}

// Delete document
public async Task DeleteOrder(Guid id)
{
    using var session = _store.LightweightSession();

    session.Delete<Order>(id);
    await session.SaveChangesAsync();
}
```

### Querying with LINQ

```csharp
// Simple queries
var orders = await session.Query<Order>()
    .Where(o => o.CustomerId == customerId)
    .ToListAsync();

// Complex queries
var recentOrders = await session.Query<Order>()
    .Where(o => o.Status == OrderStatus.Pending)
    .Where(o => o.CreatedAt > DateTimeOffset.UtcNow.AddDays(-30))
    .OrderByDescending(o => o.CreatedAt)
    .Take(10)
    .ToListAsync();

// Aggregations
var totalAmount = await session.Query<Order>()
    .Where(o => o.CustomerId == customerId)
    .SumAsync(o => o.TotalAmount);

var orderCount = await session.Query<Order>()
    .CountAsync(o => o.Status == OrderStatus.Completed);
```

### Compiled Queries (Performance)

```csharp
public class OrdersByCustomer : ICompiledQuery<Order, IReadOnlyList<Order>>
{
    public Guid CustomerId { get; init; }

    public Expression<Func<IMartenQueryable<Order>, IReadOnlyList<Order>>> QueryIs()
    {
        return q => q.Where(x => x.CustomerId == CustomerId)
                     .OrderByDescending(x => x.CreatedAt)
                     .ToList();
    }
}

// Usage
var query = new OrdersByCustomer { CustomerId = customerId };
var orders = await session.QueryAsync(query);
```

---

## 4. Event Sourcing

### Event Stream Operations

```csharp
// Start new event stream
public async Task CreateOrder(CreateOrderCommand cmd)
{
    using var session = _store.LightweightSession();

    var orderId = Guid.NewGuid();
    var evt = new OrderCreated(orderId, cmd.CustomerId);

    session.Events.StartStream<Order>(orderId, evt);
    await session.SaveChangesAsync();
}

// Append events to stream
public async Task ShipOrder(Guid orderId, string trackingNumber)
{
    using var session = _store.LightweightSession();

    var evt = new OrderShipped(orderId, trackingNumber);
    session.Events.Append(orderId, evt);

    await session.SaveChangesAsync();
}

// Load aggregate from events
public async Task<Order> GetOrder(Guid orderId)
{
    using var session = _store.QuerySession();

    var order = await session.Events.AggregateStreamAsync<Order>(orderId);
    return order ?? throw new OrderNotFoundException(orderId);
}
```

### Aggregate with Apply Methods

```csharp
public class Order
{
    public Guid Id { get; private set; }
    public Guid CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public List<OrderItem> Items { get; private set; } = new();
    public decimal TotalAmount { get; private set; }

    // Apply events to rebuild state
    public void Apply(OrderCreated evt)
    {
        Id = evt.OrderId;
        CustomerId = evt.CustomerId;
        Status = OrderStatus.Pending;
    }

    public void Apply(ItemAddedToOrder evt)
    {
        Items.Add(evt.Item);
        TotalAmount += evt.Item.Price * evt.Item.Quantity;
    }

    public void Apply(OrderShipped evt)
    {
        Status = OrderStatus.Shipped;
    }

    public void Apply(OrderCancelled evt)
    {
        Status = OrderStatus.Cancelled;
    }
}
```

### Projections (Read Models)

```csharp
public class OrderSummary
{
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public decimal TotalAmount { get; set; }
    public OrderStatus Status { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class OrderSummaryProjection : MultiStreamProjection<OrderSummary, Guid>
{
    public OrderSummaryProjection()
    {
        ProjectEvent<OrderCreated>((summary, evt) =>
        {
            summary.Id = evt.OrderId;
            summary.CustomerId = evt.CustomerId;
            summary.Status = OrderStatus.Pending;
            summary.CreatedAt = DateTimeOffset.UtcNow;
        });

        ProjectEvent<OrderShipped>((summary, evt) =>
        {
            summary.Status = OrderStatus.Shipped;
        });

        ProjectEvent<OrderCancelled>((summary, evt) =>
        {
            summary.Status = OrderStatus.Cancelled;
        });
    }
}

// Register in configuration
opts.Projections.Add<OrderSummaryProjection>(ProjectionLifecycle.Inline);
```

---

## 5. CQRS Patterns

### Commands (Write Operations)

```csharp
// Commands are records with required data
public record CreateOrderCommand(Guid CustomerId, List<OrderItem> Items);
public record AddItemToOrderCommand(Guid OrderId, OrderItem Item);
public record ShipOrderCommand(Guid OrderId, string TrackingNumber);
public record CancelOrderCommand(Guid OrderId, string Reason);

// Command validation
public class CreateOrderCommandValidator : AbstractValidator<CreateOrderCommand>
{
    public CreateOrderCommandValidator()
    {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Items).NotEmpty().WithMessage("Order must have at least one item");
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(x => x.Quantity).GreaterThan(0);
            item.RuleFor(x => x.Price).GreaterThan(0);
        });
    }
}
```

### Queries (Read Operations)

```csharp
// Queries return DTOs, not domain entities
public record GetOrderQuery(Guid OrderId);
public record GetCustomerOrdersQuery(Guid CustomerId, int Page, int PageSize);
public record SearchOrdersQuery(string SearchTerm, OrderStatus? Status, int Page, int PageSize);

// DTOs for responses
public record OrderDto(
    Guid Id,
    Guid CustomerId,
    OrderStatus Status,
    decimal TotalAmount,
    List<OrderItemDto> Items,
    DateTimeOffset CreatedAt)
{
    public static OrderDto FromEntity(Order order) => new(
        order.Id,
        order.CustomerId,
        order.Status,
        order.TotalAmount,
        order.Items.Select(OrderItemDto.FromEntity).ToList(),
        order.CreatedAt
    );
}
```

---

## 6. Dependency Injection

### Service Registration

```csharp
// Register services by lifetime
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddSingleton<ICacheService, CacheService>();
builder.Services.AddTransient<IEmailService, EmailService>();

// Register with factory
builder.Services.AddScoped<IOrderRepository>(sp =>
{
    var store = sp.GetRequiredService<IDocumentStore>();
    return new OrderRepository(store);
});

// Register generic services
builder.Services.AddScoped(typeof(IRepository<>), typeof(Repository<>));

// Options pattern
builder.Services.Configure<EmailSettings>(
    builder.Configuration.GetSection("Email"));
```

### Constructor Injection

```csharp
public class OrderService : IOrderService
{
    private readonly IDocumentSession _session;
    private readonly IMessageBus _bus;
    private readonly ILogger<OrderService> _logger;
    private readonly IOptions<OrderSettings> _settings;

    public OrderService(
        IDocumentSession session,
        IMessageBus bus,
        ILogger<OrderService> logger,
        IOptions<OrderSettings> settings)
    {
        _session = session;
        _bus = bus;
        _logger = logger;
        _settings = settings;
    }

    public async Task<Guid> CreateOrder(CreateOrderCommand command)
    {
        _logger.LogInformation("Creating order for customer {CustomerId}",
            command.CustomerId);

        var orderId = await _bus.InvokeAsync<Guid>(command);
        return orderId;
    }
}
```

---

## 7. Configuration

### appsettings.json

```json
{
  "ConnectionStrings": {
    "Postgres": "Host=localhost;Database=myapp;Username=postgres;Password=postgres"
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Wolverine": "Debug"
    }
  },
  "Marten": {
    "AutoCreateSchemaObjects": "CreateOrUpdate"
  },
  "Wolverine": {
    "Durability": {
      "Mode": "Solo"
    }
  },
  "OrderSettings": {
    "MaxItemsPerOrder": 100,
    "OrderExpirationDays": 30
  }
}
```

### Reading Configuration

```csharp
// Simple values
var connectionString = builder.Configuration.GetConnectionString("Postgres");
var maxItems = builder.Configuration.GetValue<int>("OrderSettings:MaxItemsPerOrder");

// Bind to class
builder.Services.Configure<OrderSettings>(
    builder.Configuration.GetSection("OrderSettings"));

// Usage
public class OrderService
{
    private readonly OrderSettings _settings;

    public OrderService(IOptions<OrderSettings> settings)
    {
        _settings = settings.Value;
    }
}
```

---

## 8. Testing with xUnit

### Unit Tests

```csharp
public class CreateOrderHandlerTests
{
    [Fact]
    public async Task Handle_ValidCommand_CreatesOrder()
    {
        // Arrange
        var store = DocumentStore.For(opts =>
        {
            opts.Connection(TestConnectionString);
            opts.DatabaseSchemaName = "test";
        });

        using var session = store.LightweightSession();

        var command = new CreateOrderCommand(
            Guid.NewGuid(),
            new List<OrderItem> { new(Guid.NewGuid(), 2, 10.00m) }
        );

        // Act
        var orderId = await CreateOrderHandler.Handle(
            command, session, CancellationToken.None);

        // Assert
        orderId.Should().NotBeEmpty();

        var order = await session.LoadAsync<Order>(orderId);
        order.Should().NotBeNull();
        order!.CustomerId.Should().Be(command.CustomerId);
        order.Items.Should().HaveCount(1);
    }
}
```

### Integration Tests

```csharp
public class OrdersApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public OrdersApiTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task CreateOrder_ValidRequest_ReturnsCreated()
    {
        // Arrange
        var command = new CreateOrderCommand(
            Guid.NewGuid(),
            new List<OrderItem> { new(Guid.NewGuid(), 1, 10.00m) }
        );

        // Act
        var response = await _client.PostAsJsonAsync("/api/orders", command);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var orderId = await response.Content.ReadFromJsonAsync<Guid>();
        orderId.Should().NotBeEmpty();
    }
}
```

### Test Data with Bogus

```csharp
public class OrderFaker : Faker<Order>
{
    public OrderFaker()
    {
        RuleFor(o => o.Id, f => Guid.NewGuid());
        RuleFor(o => o.CustomerId, f => Guid.NewGuid());
        RuleFor(o => o.Status, f => f.PickRandom<OrderStatus>());
        RuleFor(o => o.TotalAmount, f => f.Random.Decimal(10, 1000));
        RuleFor(o => o.CreatedAt, f => f.Date.RecentOffset());
    }
}

// Usage
var faker = new OrderFaker();
var order = faker.Generate();
var orders = faker.Generate(10);
```

---

## 9. Common Patterns

### Result Pattern

```csharp
public record Result<T>
{
    public bool IsSuccess { get; init; }
    public T? Value { get; init; }
    public string? Error { get; init; }

    public static Result<T> Success(T value) =>
        new() { IsSuccess = true, Value = value };

    public static Result<T> Failure(string error) =>
        new() { IsSuccess = false, Error = error };

    public TResult Match<TResult>(
        Func<T, TResult> onSuccess,
        Func<string, TResult> onFailure) =>
        IsSuccess ? onSuccess(Value!) : onFailure(Error!);
}

// Usage
public async Task<Result<Order>> GetOrder(Guid id)
{
    var order = await _session.LoadAsync<Order>(id);
    return order is not null
        ? Result<Order>.Success(order)
        : Result<Order>.Failure("Order not found");
}
```

### Option Pattern

```csharp
public record Option<T>
{
    private readonly T? _value;
    public bool HasValue { get; }

    private Option(T? value, bool hasValue)
    {
        _value = value;
        HasValue = hasValue;
    }

    public static Option<T> Some(T value) => new(value, true);
    public static Option<T> None() => new(default, false);

    public T ValueOr(T defaultValue) => HasValue ? _value! : defaultValue;

    public TResult Match<TResult>(
        Func<T, TResult> some,
        Func<TResult> none) =>
        HasValue ? some(_value!) : none();
}
```

---

## 10. Common Commands

### .NET CLI

```bash
# Create new project
dotnet new webapi -n MyApp.Api
dotnet new classlib -n MyApp.Domain

# Add packages
dotnet add package Marten
dotnet add package Wolverine
dotnet add package FluentValidation

# Run project
dotnet run
dotnet watch run  # Hot reload

# Testing
dotnet test
dotnet test --logger "console;verbosity=detailed"

# Build and publish
dotnet build
dotnet publish -c Release
```

### Entity Framework Core Migrations

```bash
# Add migration
dotnet ef migrations add InitialCreate

# Update database
dotnet ef database update

# Generate SQL script
dotnet ef migrations script
```

---

**Quick Reference Complete** - See REFERENCE.md for comprehensive details and advanced patterns
