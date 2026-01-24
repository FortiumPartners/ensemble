# .NET Framework Patterns - Extracted from dotnet-backend-expert.yaml

**Source**: `agents/yaml/dotnet-backend-expert.yaml` (v1.0.1, 2025-10-15)
**Target**: Skills-based framework architecture for `backend-developer` agent
**Extraction Date**: October 2025

---

## Agent Overview

**Agent Name**: dotnet-backend-expert
**Category**: framework-specialist
**Mission**: Implement production-grade .NET backend services using modern .NET (8+), ASP.NET Core Web APIs, Wolverine for message-driven architectures, and MartenDB for document storage and event sourcing. Specializes in CQRS, event-driven design, and enterprise integration patterns.

**Tools Required**: Read, Write, Edit, Bash

---

## Core Technology Stack

### Primary Framework
- **.NET 8+**: Modern C# 12 features, minimal APIs, native AOT
- **ASP.NET Core**: Web APIs, middleware pipeline, dependency injection
- **C# 12**: Primary-constructors, collection expressions, interceptors

### Specialized Libraries
- **Wolverine**: Message-driven architecture, command/query handlers, sagas
- **MartenDB**: PostgreSQL-based document database and event store
- **Entity Framework Core**: Optional ORM for relational data

---

## Core Expertise Areas

### 1. ASP.NET Core Web APIs (Priority: HIGH)

**Scope**: Build RESTful APIs with controllers and minimal APIs

**Key Patterns**:

#### Controller-Based APIs
```csharp
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IMediator _mediator;

    public OrdersController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<OrderDto>> GetOrder(Guid id)
    {
        var query = new GetOrderQuery(id);
        var result = await _mediator.Send(query);

        return result.Match<ActionResult<OrderDto>>(
            order => Ok(order),
            notFound => NotFound()
        );
    }

    [HttpPost]
    public async Task<ActionResult<Guid>> CreateOrder(CreateOrderCommand command)
    {
        var orderId = await _mediator.Send(command);
        return CreatedAtAction(nameof(GetOrder), new { id = orderId }, orderId);
    }
}
```

#### Minimal APIs (.NET 8+)
```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var orders = app.MapGroup("/api/orders");

orders.MapGet("/{id}", async (Guid id, IMediator mediator) =>
{
    var query = new GetOrderQuery(id);
    var result = await mediator.Send(query);
    return result.Match(
        order => Results.Ok(order),
        notFound => Results.NotFound()
    );
});

orders.MapPost("/", async (CreateOrderCommand command, IMediator mediator) =>
{
    var orderId = await mediator.Send(command);
    return Results.Created($"/api/orders/{orderId}", orderId);
});

app.Run();
```

**ASP.NET Core Conventions**:
- Controllers: `[ApiController]` attribute, `ControllerBase` inheritance
- Routing: Attribute routing with `[Route]` and `[Http*]` attributes
- Dependency Injection: Constructor injection for services
- Model binding: Automatic from body/route/query parameters
- Response types: `ActionResult<T>` for type-safe responses

---

### 2. Wolverine Message Handling (Priority: HIGH)

**Scope**: Message-driven architectures with command/query handlers

**Key Patterns**:

#### Command Handlers
```csharp
// Command
public record CreateOrderCommand(Guid CustomerId, List<OrderItem> Items);

// Handler
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

        return order.Id;
    }
}
```

#### Query Handlers
```csharp
// Query
public record GetOrderQuery(Guid OrderId);

// Handler
public static class GetOrderQueryHandler
{
    public static async Task<Option<OrderDto>> Handle(
        GetOrderQuery query,
        IQuerySession session,
        CancellationToken ct)
    {
        var order = await session.LoadAsync<Order>(query.OrderId, ct);
        return order is not null
            ? Option.Some(OrderDto.FromEntity(order))
            : Option.None<OrderDto>();
    }
}
```

#### Event Handlers
```csharp
// Event
public record OrderCreated(Guid OrderId, Guid CustomerId, DateTimeOffset CreatedAt);

// Handler
public static class OrderCreatedHandler
{
    public static async Task Handle(
        OrderCreated evt,
        IDocumentSession session,
        ILogger logger)
    {
        logger.LogInformation("Order {OrderId} created for customer {CustomerId}",
            evt.OrderId, evt.CustomerId);

        // Publish follow-up events or trigger workflows
        await session.Events.Append(evt.OrderId, new OrderProcessingStarted(evt.OrderId));
        await session.SaveChangesAsync();
    }
}
```

**Wolverine Conventions**:
- Static handlers: `public static Task Handle(...)`
- Automatic parameter injection: IDocumentSession, ILogger, etc.
- Message routing: Convention-based or explicit configuration
- Cascading messages: Return events to be published

---

### 3. MartenDB Document Storage (Priority: HIGH)

**Scope**: PostgreSQL-based document database for CRUD operations

**Key Patterns**:

#### Document Operations
```csharp
// Store documents
public async Task<Order> CreateOrder(Order order)
{
    using var session = _store.LightweightSession();

    session.Store(order);
    await session.SaveChangesAsync();

    return order;
}

// Query documents
public async Task<Order?> GetOrder(Guid id)
{
    using var session = _store.QuerySession();
    return await session.LoadAsync<Order>(id);
}

// Advanced queries with LINQ
public async Task<List<Order>> GetCustomerOrders(Guid customerId)
{
    using var session = _store.QuerySession();

    return await session.Query<Order>()
        .Where(o => o.CustomerId == customerId)
        .OrderByDescending(o => o.CreatedAt)
        .ToListAsync();
}

// Compiled queries for performance
public class OrdersByCustomer : ICompiledQuery<Order, IReadOnlyList<Order>>
{
    public Guid CustomerId { get; set; }

    public Expression<Func<IMartenQueryable<Order>, IReadOnlyList<Order>>> QueryIs()
    {
        return q => q.Where(x => x.CustomerId == CustomerId)
                     .OrderByDescending(x => x.CreatedAt)
                     .ToList();
    }
}
```

#### Configuration
```csharp
services.AddMarten(opts =>
{
    opts.Connection(connectionString);

    // Document mappings
    opts.Schema.For<Order>()
        .Index(x => x.CustomerId)
        .Index(x => x.Status);

    // Use event sourcing for aggregates
    opts.Events.AddEventTypes(new[]
    {
        typeof(OrderCreated),
        typeof(OrderShipped),
        typeof(OrderCancelled)
    });
});
```

---

### 4. Event Sourcing with MartenDB (Priority: HIGH)

**Scope**: Event-driven persistence and CQRS patterns

**Key Patterns**:

#### Event Sourcing Aggregate
```csharp
public class Order
{
    public Guid Id { get; private set; }
    public Guid CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    public List<OrderItem> Items { get; private set; } = new();

    // Apply methods for event sourcing
    public void Apply(OrderCreated evt)
    {
        Id = evt.OrderId;
        CustomerId = evt.CustomerId;
        Status = OrderStatus.Pending;
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

#### Event Stream Operations
```csharp
// Append events to stream
public async Task CreateOrder(CreateOrderCommand cmd)
{
    using var session = _store.LightweightSession();

    var orderId = Guid.NewGuid();
    var evt = new OrderCreated(orderId, cmd.CustomerId, DateTimeOffset.UtcNow);

    session.Events.StartStream<Order>(orderId, evt);
    await session.SaveChangesAsync();
}

// Load aggregate from events
public async Task<Order> GetOrder(Guid orderId)
{
    using var session = _store.QuerySession();

    var order = await session.Events.AggregateStreamAsync<Order>(orderId);
    return order ?? throw new OrderNotFoundException(orderId);
}

// Append event to existing stream
public async Task ShipOrder(Guid orderId)
{
    using var session = _store.LightweightSession();

    var evt = new OrderShipped(orderId, DateTimeOffset.UtcNow);
    session.Events.Append(orderId, evt);

    await session.SaveChangesAsync();
}
```

#### Projections (Read Models)
```csharp
public class OrderSummary
{
    public Guid Id { get; set; }
    public Guid CustomerId { get; set; }
    public decimal TotalAmount { get; set; }
    public OrderStatus Status { get; set; }
}

public class OrderSummaryProjection : MultiStreamProjection<OrderSummary, Guid>
{
    public OrderSummaryProjection()
    {
        ProjectEvent<OrderCreated>((item, evt) =>
        {
            item.Id = evt.OrderId;
            item.CustomerId = evt.CustomerId;
            item.Status = OrderStatus.Pending;
        });

        ProjectEvent<OrderShipped>((item, evt) =>
        {
            item.Status = OrderStatus.Shipped;
        });
    }
}

// Register projection
services.AddMarten(opts =>
{
    opts.Projections.Add<OrderSummaryProjection>(ProjectionLifecycle.Inline);
});
```

---

### 5. CQRS Patterns (Priority: HIGH)

**Scope**: Command/Query separation for scalability

**Key Patterns**:

#### Commands (Write Operations)
```csharp
public record CreateOrderCommand(Guid CustomerId, List<OrderItem> Items);
public record ShipOrderCommand(Guid OrderId);
public record CancelOrderCommand(Guid OrderId, string Reason);

public class CreateOrderCommandHandler
{
    public async Task<Result<Guid>> Handle(CreateOrderCommand cmd, IDocumentSession session)
    {
        // Validation
        if (cmd.Items.Count == 0)
            return Result.Failure<Guid>("Order must have at least one item");

        // Business logic
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CustomerId = cmd.CustomerId,
            Items = cmd.Items,
            Status = OrderStatus.Pending
        };

        session.Store(order);
        await session.SaveChangesAsync();

        return Result.Success(order.Id);
    }
}
```

#### Queries (Read Operations)
```csharp
public record GetOrderQuery(Guid OrderId);
public record GetCustomerOrdersQuery(Guid CustomerId, int Page, int PageSize);

public class GetCustomerOrdersQueryHandler
{
    public async Task<PagedResult<OrderDto>> Handle(
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
            .Count(o => o.CustomerId == query.CustomerId);

        return new PagedResult<OrderDto>(
            orders.Select(OrderDto.FromEntity),
            total,
            query.Page,
            query.PageSize
        );
    }
}
```

---

### 6. Dependency Injection & Configuration (Priority: MEDIUM)

**Scope**: Service registration and configuration management

**Key Patterns**:

#### Program.cs Setup
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
});

// Wolverine message bus
builder.Host.UseWolverine(opts =>
{
    opts.Discovery.DisableConventionalDiscovery();
    opts.Discovery.IncludeType<CreateOrderHandler>();
});

// Application services
builder.Services.AddScoped<IOrderService, OrderService>();

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

#### Configuration (appsettings.json)
```json
{
  "ConnectionStrings": {
    "Postgres": "Host=localhost;Database=myapp;Username=postgres;Password=postgres"
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "Wolverine": {
    "Durability": {
      "Mode": "Solo"
    }
  }
}
```

---

### 7. Enterprise Integration Patterns (Priority: MEDIUM)

**Scope**: Message routing, sagas, compensation

**Key Patterns**:

#### Saga Pattern
```csharp
public class OrderSaga : Saga
{
    public Guid Id { get; set; }
    public OrderSagaState State { get; set; }

    public void Handle(OrderCreated evt)
    {
        Id = evt.OrderId;
        State = OrderSagaState.Created;
    }

    public void Handle(PaymentProcessed evt)
    {
        State = OrderSagaState.PaymentCompleted;
    }

    public void Handle(OrderShipped evt)
    {
        State = OrderSagaState.Completed;
        MarkCompleted();
    }

    public void Handle(PaymentFailed evt)
    {
        State = OrderSagaState.Failed;
        MarkCompleted();
    }
}
```

#### Message Routing
```csharp
opts.Policies.AllMessagesOfType<IOrderEvent>()
    .ToLocalQueue("orders");

opts.Policies.AllMessagesOfType<IPaymentEvent>()
    .ToLocalQueue("payments");
```

---

### 8. Testing Patterns (Priority: MEDIUM)

**Scope**: Unit, integration, and end-to-end testing

**Key Patterns**:

#### Unit Testing with xUnit
```csharp
public class CreateOrderHandlerTests
{
    [Fact]
    public async Task Handle_ValidCommand_CreatesOrder()
    {
        // Arrange
        var store = DocumentStore.For(opts =>
        {
            opts.Connection(Servers.PostgresConnectionString);
            opts.DatabaseSchemaName = "test";
        });

        using var session = store.LightweightSession();
        var command = new CreateOrderCommand(Guid.NewGuid(), new List<OrderItem>
        {
            new(Guid.NewGuid(), 2, 10.00m)
        });

        // Act
        var orderId = await CreateOrderHandler.Handle(command, session, CancellationToken.None);

        // Assert
        orderId.Should().NotBeEmpty();
        var order = await session.LoadAsync<Order>(orderId);
        order.Should().NotBeNull();
        order!.CustomerId.Should().Be(command.CustomerId);
    }
}
```

#### Integration Testing
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
        var command = new CreateOrderCommand(Guid.NewGuid(), new List<OrderItem>());

        // Act
        var response = await _client.PostAsJsonAsync("/api/orders", command);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var orderId = await response.Content.ReadFromJsonAsync<Guid>();
        orderId.Should().NotBeEmpty();
    }
}
```

---

## Quality Standards

### Testing Requirements
- **Handlers**: ≥80% coverage (xUnit for business logic)
- **Controllers**: ≥70% coverage (Integration tests)
- **Domain Models**: ≥80% coverage (Unit tests)
- **Overall**: ≥75% coverage (coverlet)

### Code Quality
- **Nullable Reference Types**: Enabled project-wide
- **Async/Await**: All I/O operations
- **Record Types**: For DTOs, commands, queries, events
- **Pattern Matching**: Modern C# 12 features

---

## Delegation Protocols

### Receives Tasks From
1. **tech-lead-orchestrator**: .NET-specific implementation from TRD
2. **ensemble-orchestrator**: .NET backend tasks requiring expertise
3. **backend-developer**: Tasks specifically requiring .NET patterns

### Delegates Tasks To
1. **test-runner**: Test execution after .NET code
2. **code-reviewer**: Comprehensive review before PR
3. **deployment-orchestrator**: Deployment tasks

---

## Skill Conversion Strategy

### Progressive Disclosure Pattern

1. **SKILL.md** (~15KB): Quick reference
   - ASP.NET Core Web API patterns
   - Wolverine handlers
   - MartenDB operations
   - Common CQRS patterns

2. **REFERENCE.md** (~40KB): Comprehensive guide
   - Advanced ASP.NET Core (middleware, filters)
   - Wolverine sagas and routing
   - MartenDB projections and event store
   - Event sourcing architecture
   - Testing strategies

### Template System

7 code generation templates planned:
1. `controller.template.cs` - ASP.NET Core controller
2. `minimal-api.template.cs` - Minimal API endpoints
3. `entity.template.cs` - MartenDB document
4. `handler.template.cs` - Wolverine command/query handler
5. `event.template.cs` - Event sourcing event
6. `projection.template.cs` - MartenDB projection
7. `test.template.cs` - xUnit test

### Example System

2 comprehensive examples planned:
1. **Web API Example**: Complete ASP.NET Core API with controllers and minimal APIs
2. **Event Sourcing Example**: Full CQRS/ES implementation with MartenDB

---

## Feature Parity Target

**Goal**: ≥95% feature coverage compared to `dotnet-backend-expert.yaml` agent

**Coverage Areas**:
1. ✅ ASP.NET Core Web APIs
2. ✅ Wolverine message handling
3. ✅ MartenDB document storage
4. ✅ Event sourcing patterns
5. ✅ CQRS architecture
6. ✅ Dependency injection
7. ✅ Enterprise patterns
8. ✅ Testing strategies

**Total**: 8/8 areas extracted = **100% pattern coverage**

---

**Status**: ✅ **COMPLETE** - All patterns extracted from dotnet-backend-expert.yaml

**Next Steps**: Create SKILL.md and REFERENCE.md with progressive disclosure pattern
