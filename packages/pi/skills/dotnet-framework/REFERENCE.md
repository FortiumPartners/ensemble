# .NET Framework - Comprehensive Reference

**Framework**: .NET 8+ with ASP.NET Core
**For Agent**: backend-developer
**Purpose**: Deep-dive reference for complex .NET development scenarios

---

## Table of Contents

1. [.NET Architecture Overview](#1-net-architecture-overview)
2. [Advanced ASP.NET Core](#2-advanced-aspnet-core)
3. [Wolverine Advanced Patterns](#3-wolverine-advanced-patterns)
4. [MartenDB Deep Dive](#4-martendb-deep-dive)
5. [Event Sourcing Architecture](#5-event-sourcing-architecture)
6. [CQRS Implementation](#6-cqrs-implementation)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Performance Optimization](#8-performance-optimization)
9. [Testing Strategies](#9-testing-strategies)
10. [Production Deployment](#10-production-deployment)

---

## 1. .NET Architecture Overview

### Modern .NET Stack

**.NET 8+ Features**:
- Native AOT compilation for minimal container images
- Improved JSON serialization performance
- Enhanced minimal APIs with route groups
- Primary constructors for classes
- Collection expressions

**Project Structure**:
```
MyApp/
├── MyApp.Api/              # Web API project
│   ├── Controllers/
│   ├── Program.cs
│   └── appsettings.json
├── MyApp.Domain/           # Domain models and events
│   ├── Aggregates/
│   ├── Events/
│   └── ValueObjects/
├── MyApp.Application/      # Handlers and services
│   ├── Commands/
│   ├── Queries/
│   └── Handlers/
└── MyApp.Infrastructure/   # Data access and external services
    ├── Persistence/
    └── Services/
```

### Dependency Flow

```
┌─────────────────┐
│   MyApp.Api     │ ◄── HTTP endpoints, controllers
└────────┬────────┘
         │ depends on
         ▼
┌─────────────────┐
│MyApp.Application│ ◄── Command/query handlers
└────────┬────────┘
         │ depends on
         ▼
┌─────────────────┐
│  MyApp.Domain   │ ◄── Pure domain logic
└─────────────────┘
         ▲
         │ referenced by
┌─────────────────┐
│MyApp.Infrastructure│ ◄── MartenDB, external APIs
└─────────────────┘
```

---

## 2. Advanced ASP.NET Core

### Middleware Pipeline

```csharp
var app = builder.Build();

// Middleware order matters!
app.UseExceptionHandler("/error");        // 1. Error handling
app.UseHttpsRedirection();                 // 2. HTTPS redirect
app.UseCors("AllowAll");                   // 3. CORS
app.UseAuthentication();                   // 4. Authentication
app.UseAuthorization();                    // 5. Authorization
app.UseResponseCompression();              // 6. Compression
app.MapControllers();                      // 7. Endpoints

app.Run();
```

### Custom Middleware

```csharp
public class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggingMiddleware> _logger;

    public RequestLoggingMiddleware(
        RequestDelegate next,
        ILogger<RequestLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            await _next(context);
        }
        finally
        {
            stopwatch.Stop();
            _logger.LogInformation(
                "Request {Method} {Path} completed in {ElapsedMs}ms with status {StatusCode}",
                context.Request.Method,
                context.Request.Path,
                stopwatch.ElapsedMilliseconds,
                context.Response.StatusCode
            );
        }
    }
}

// Extension method
public static class RequestLoggingMiddlewareExtensions
{
    public static IApplicationBuilder UseRequestLogging(this IApplicationBuilder app)
    {
        return app.UseMiddleware<RequestLoggingMiddleware>();
    }
}

// Usage
app.UseRequestLogging();
```

### Action Filters

```csharp
public class ValidateModelAttribute : ActionFilterAttribute
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid)
        {
            context.Result = new BadRequestObjectResult(context.ModelState);
        }
    }
}

// Usage
[ApiController]
[Route("api/[controller]")]
[ValidateModel]  // Applied to all actions in controller
public class OrdersController : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult> CreateOrder(CreateOrderCommand command)
    {
        // Model is already validated
        var result = await _mediator.Send(command);
        return Ok(result);
    }
}
```

### Model Binding

```csharp
// From route
[HttpGet("{id}")]
public async Task<ActionResult<Order>> GetOrder(Guid id) { }

// From query string
[HttpGet]
public async Task<ActionResult<List<Order>>> GetOrders(
    [FromQuery] int page = 1,
    [FromQuery] int pageSize = 20) { }

// From body
[HttpPost]
public async Task<ActionResult> CreateOrder(
    [FromBody] CreateOrderCommand command) { }

// From header
[HttpGet]
public async Task<ActionResult> GetOrders(
    [FromHeader(Name = "X-Api-Key")] string apiKey) { }

// Custom binding
public class OrderFilterBinder : IModelBinder
{
    public Task BindModelAsync(ModelBindingContext bindingContext)
    {
        var status = bindingContext.ValueProvider.GetValue("status").FirstValue;
        var dateFrom = bindingContext.ValueProvider.GetValue("from").FirstValue;

        var filter = new OrderFilter
        {
            Status = Enum.Parse<OrderStatus>(status ?? "Pending"),
            DateFrom = DateTime.Parse(dateFrom ?? DateTime.UtcNow.AddDays(-30).ToString())
        };

        bindingContext.Result = ModelBindingResult.Success(filter);
        return Task.CompletedTask;
    }
}
```

---

## 3. Wolverine Advanced Patterns

### Message Routing

```csharp
builder.Host.UseWolverine(opts =>
{
    // Route messages by type
    opts.PublishAllMessages()
        .ToLocalQueue("orders")
        .UseDurableInbox();

    // Route specific messages
    opts.Policies.ForMessagesOfType<IOrderEvent>()
        .ToLocalQueue("order-events");

    opts.Policies.ForMessagesOfType<IPaymentEvent>()
        .ToLocalQueue("payments")
        .MaximumParallelMessages(5);

    // External transport (RabbitMQ, Azure Service Bus, etc.)
    opts.UseRabbitMq("host=rabbitmq")
        .AutoProvision()
        .BindExchange("orders")
        .ToQueue("order-commands");
});
```

### Sagas (Long-Running Workflows)

```csharp
public class OrderFulfillmentSaga : Saga
{
    public Guid Id { get; set; }
    public Guid OrderId { get; set; }
    public SagaState State { get; set; }
    public string? PaymentId { get; set; }
    public string? ShipmentId { get; set; }

    // Start saga
    public void Start(OrderCreated evt)
    {
        Id = Guid.NewGuid();
        OrderId = evt.OrderId;
        State = SagaState.Started;
    }

    // Handle subsequent events
    public void Handle(PaymentProcessed evt)
    {
        if (evt.OrderId == OrderId)
        {
            PaymentId = evt.PaymentId;
            State = SagaState.PaymentCompleted;
        }
    }

    public void Handle(OrderShipped evt)
    {
        if (evt.OrderId == OrderId)
        {
            ShipmentId = evt.ShipmentId;
            State = SagaState.Shipped;
            MarkCompleted();  // End saga
        }
    }

    public void Handle(PaymentFailed evt)
    {
        if (evt.OrderId == OrderId)
        {
            State = SagaState.Failed;
            MarkCompleted();
        }
    }
}
```

### Cascading Messages

```csharp
public static class OrderHandler
{
    // Return messages to cascade
    public static (OrderCreatedEvent, SendWelcomeEmail) Handle(
        CreateOrderCommand command,
        IDocumentSession session)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            CustomerId = command.CustomerId
        };

        session.Store(order);

        // Both messages will be published
        var evt = new OrderCreatedEvent(order.Id, order.CustomerId);
        var email = new SendWelcomeEmail(order.CustomerId);

        return (evt, email);
    }

    // Or return array
    public static object[] Handle(CreateOrderCommand command)
    {
        return new object[]
        {
            new OrderCreatedEvent(Guid.NewGuid(), command.CustomerId),
            new SendConfirmationEmail(command.CustomerId),
            new UpdateCustomerStats(command.CustomerId)
        };
    }
}
```

### Scheduled Messages

```csharp
public static class OrderHandler
{
    public static async Task Handle(
        OrderCreated evt,
        IMessageContext context)
    {
        // Schedule message for future delivery
        await context.ScheduleAsync(
            new CheckOrderStatus(evt.OrderId),
            DateTimeOffset.UtcNow.AddHours(24)
        );

        // Schedule with delay
        await context.ScheduleAsync(
            new SendReminderEmail(evt.CustomerId),
            TimeSpan.FromDays(7)
        );
    }
}
```

---

## 4. MartenDB Deep Dive

### Full-Text Search

```csharp
// Configure full-text search
opts.Schema.For<Order>()
    .FullTextIndex(x => x.SearchText);

// Query with full-text search
var orders = await session.Query<Order>()
    .Where(x => x.Search("\"wireless mouse\""))
    .ToListAsync();

// Search with ranking
var results = await session.Query<Order>()
    .Where(x => x.Search("laptop"))
    .OrderByDescending(x => x.Rank())
    .ToListAsync();
```

### Multi-Tenancy

```csharp
// Configure tenant per schema
opts.Policies.AllDocumentsAreMultiTenanted();

// Or per table
opts.Schema.For<Order>().MultiTenanted();

// Usage with tenant ID
using var session = _store.LightweightSession("tenant-123");
var orders = await session.Query<Order>().ToListAsync();
// Only returns orders for tenant-123
```

### Document Metadata

```csharp
opts.Schema.For<Order>()
    .Metadata(x =>
    {
        x.CreatedAt.Enabled();
        x.LastModified.Enabled();
        x.Version.Enabled();
        x.CausationId.Enabled();
        x.CorrelationId.Enabled();
    });

// Query metadata
var recentOrders = await session.Query<Order>()
    .Where(x => x.ModifiedSince(DateTimeOffset.UtcNow.AddDays(-7)))
    .ToListAsync();
```

### Optimistic Concurrency

```csharp
// Load with version
var order = await session.LoadAsync<Order>(orderId);
var version = await session.MetadataFor(order).CurrentVersion;

// Update with version check
order.Status = OrderStatus.Shipped;
session.Store(order, version);

try
{
    await session.SaveChangesAsync();
}
catch (ConcurrencyException)
{
    // Handle conflict - order was modified by another process
}
```

### Bulk Operations

```csharp
// Bulk insert
var orders = GenerateOrders(10000);

await _store.Advanced.Clean.DeleteDocumentsFor<Order>();

await _store.BulkInsertDocumentsAsync(orders);

// Batch updates
using var batch = _store.LightweightSession().CreateBatchCommand();

foreach (var order in orders)
{
    order.Status = OrderStatus.Processed;
    batch.Store(order);
}

await batch.ExecuteAsync();
```

---

## 5. Event Sourcing Architecture

### Aggregate Design

```csharp
public class Order
{
    // State (private setters)
    public Guid Id { get; private set; }
    public Guid CustomerId { get; private set; }
    public OrderStatus Status { get; private set; }
    private readonly List<OrderItem> _items = new();
    public IReadOnlyList<OrderItem> Items => _items.AsReadOnly();
    public decimal TotalAmount { get; private set; }

    // Command methods (public API)
    public void AddItem(OrderItem item)
    {
        if (Status != OrderStatus.Pending)
            throw new InvalidOperationException("Cannot add items to non-pending order");

        // Emit event
        Apply(new ItemAddedToOrder(Id, item));
    }

    public void Ship(string trackingNumber)
    {
        if (Status != OrderStatus.Pending)
            throw new InvalidOperationException("Order already shipped or cancelled");

        Apply(new OrderShipped(Id, trackingNumber, DateTimeOffset.UtcNow));
    }

    // Apply methods (rebuild state from events)
    public void Apply(OrderCreated evt)
    {
        Id = evt.OrderId;
        CustomerId = evt.CustomerId;
        Status = OrderStatus.Pending;
    }

    public void Apply(ItemAddedToOrder evt)
    {
        _items.Add(evt.Item);
        TotalAmount += evt.Item.Price * evt.Item.Quantity;
    }

    public void Apply(OrderShipped evt)
    {
        Status = OrderStatus.Shipped;
    }
}
```

### Event Versioning

```csharp
// V1 event
public record OrderCreatedV1(Guid OrderId, Guid CustomerId);

// V2 event with additional fields
public record OrderCreatedV2(
    Guid OrderId,
    Guid CustomerId,
    string CustomerEmail,
    DateTimeOffset CreatedAt);

// Upcast old events
opts.Events.Upcast<OrderCreatedV1, OrderCreatedV2>(oldEvent =>
    new OrderCreatedV2(
        oldEvent.OrderId,
        oldEvent.CustomerId,
        "unknown@example.com",  // Default for old events
        DateTimeOffset.MinValue
    ));
```

### Event Upcasting

```csharp
public class OrderCreatedUpcaster : IEventUpcaster<OrderCreatedV1, OrderCreatedV2>
{
    private readonly IUserRepository _userRepo;

    public OrderCreatedUpcaster(IUserRepository userRepo)
    {
        _userRepo = userRepo;
    }

    public async Task<OrderCreatedV2> UpcastAsync(
        OrderCreatedV1 oldEvent,
        CancellationToken ct)
    {
        var user = await _userRepo.GetAsync(oldEvent.CustomerId, ct);

        return new OrderCreatedV2(
            oldEvent.OrderId,
            oldEvent.CustomerId,
            user.Email,
            DateTimeOffset.UtcNow
        );
    }
}
```

### Snapshots

```csharp
// Enable snapshots for large aggregates
opts.Events.UseAggregatorLookup(AggregationLookup.UsePublicApply);
opts.Events.UseIdentityMapForAggregates = true;

// Create snapshot every 100 events
opts.Events.Archiving = new EventArchiving
{
    SnapshotEvery = 100
};

// Load with snapshot
var order = await session.Events.AggregateStreamAsync<Order>(orderId);
// Loads from latest snapshot + subsequent events
```

---

## 6. CQRS Implementation

### Command Side (Write Model)

```csharp
// Command with validation
public record CreateOrderCommand(Guid CustomerId, List<OrderItem> Items)
{
    public void Validate()
    {
        if (CustomerId == Guid.Empty)
            throw new ValidationException("CustomerId is required");

        if (Items == null || Items.Count == 0)
            throw new ValidationException("Order must have at least one item");

        foreach (var item in Items)
        {
            if (item.Quantity <= 0)
                throw new ValidationException("Item quantity must be positive");
        }
    }
}

// Handler with business logic
public static class CreateOrderCommandHandler
{
    public static async Task<Result<Guid>> Handle(
        CreateOrderCommand command,
        IDocumentSession session,
        ICustomerService customerService,
        CancellationToken ct)
    {
        // Validate
        command.Validate();

        // Business rules
        var customer = await customerService.GetAsync(command.CustomerId, ct);
        if (!customer.CanPlaceOrder())
            return Result<Guid>.Failure("Customer cannot place orders");

        // Create aggregate
        var orderId = Guid.NewGuid();
        var evt = new OrderCreated(orderId, command.CustomerId, DateTimeOffset.UtcNow);

        session.Events.StartStream<Order>(orderId, evt);

        foreach (var item in command.Items)
        {
            session.Events.Append(orderId, new ItemAddedToOrder(orderId, item));
        }

        await session.SaveChangesAsync(ct);

        return Result<Guid>.Success(orderId);
    }
}
```

### Query Side (Read Model)

```csharp
// Read model (denormalized)
public class OrderListItem
{
    public Guid Id { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerEmail { get; set; } = string.Empty;
    public OrderStatus Status { get; set; }
    public decimal TotalAmount { get; set; }
    public int ItemCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

// Projection to build read model
public class OrderListProjection : MultiStreamProjection<OrderListItem, Guid>
{
    public OrderListProjection()
    {
        ProjectEvent<OrderCreated>(async (item, evt, session) =>
        {
            var customer = await session.LoadAsync<Customer>(evt.CustomerId);

            item.Id = evt.OrderId;
            item.CustomerName = customer.Name;
            item.CustomerEmail = customer.Email;
            item.Status = OrderStatus.Pending;
            item.CreatedAt = evt.CreatedAt;
        });

        ProjectEvent<ItemAddedToOrder>((item, evt) =>
        {
            item.ItemCount++;
            item.TotalAmount += evt.Item.Price * evt.Item.Quantity;
        });

        ProjectEvent<OrderShipped>((item, evt) =>
        {
            item.Status = OrderStatus.Shipped;
        });
    }
}

// Query handler
public static class GetOrderListQueryHandler
{
    public static async Task<PagedResult<OrderListItem>> Handle(
        GetOrderListQuery query,
        IQuerySession session)
    {
        var items = await session.Query<OrderListItem>()
            .Where(x => x.Status == query.Status)
            .OrderByDescending(x => x.CreatedAt)
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .ToListAsync();

        var total = await session.Query<OrderListItem>()
            .CountAsync(x => x.Status == query.Status);

        return new PagedResult<OrderListItem>(items, total, query.Page, query.PageSize);
    }
}
```

---

## 7. Authentication & Authorization

### JWT Authentication

```csharp
// Configuration
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!))
        };
    });

// Token generation
public class TokenService
{
    private readonly IConfiguration _config;

    public string GenerateToken(User user)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email),
            new Claim(ClaimTypes.Role, user.Role.ToString())
        };

        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));

        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddHours(24),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
```

### Policy-Based Authorization

```csharp
// Register policies
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy =>
        policy.RequireRole("Admin"));

    options.AddPolicy("CanManageOrders", policy =>
        policy.RequireClaim("Permission", "Orders.Manage"));

    options.AddPolicy("MinimumAge", policy =>
        policy.Requirements.Add(new MinimumAgeRequirement(18)));
});

// Custom requirement
public class MinimumAgeRequirement : IAuthorizationRequirement
{
    public int MinimumAge { get; }

    public MinimumAgeRequirement(int minimumAge)
    {
        MinimumAge = minimumAge;
    }
}

// Custom handler
public class MinimumAgeHandler : AuthorizationHandler<MinimumAgeRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        MinimumAgeRequirement requirement)
    {
        var birthDateClaim = context.User.FindFirst(c => c.Type == "birthdate");

        if (birthDateClaim != null &&
            DateTime.TryParse(birthDateClaim.Value, out var birthDate))
        {
            var age = DateTime.Today.Year - birthDate.Year;
            if (birthDate.Date > DateTime.Today.AddYears(-age))
                age--;

            if (age >= requirement.MinimumAge)
            {
                context.Succeed(requirement);
            }
        }

        return Task.CompletedTask;
    }
}

// Usage in controller
[Authorize(Policy = "CanManageOrders")]
[HttpDelete("{id}")]
public async Task<ActionResult> DeleteOrder(Guid id)
{
    // Only users with Orders.Manage permission can access
}
```

---

## 8. Performance Optimization

### Response Caching

```csharp
// Add caching services
builder.Services.AddResponseCaching();
builder.Services.AddMemoryCache();

// Use caching middleware
app.UseResponseCaching();

// Cache responses
[HttpGet]
[ResponseCache(Duration = 60, VaryByQueryKeys = new[] { "page", "pageSize" })]
public async Task<ActionResult<List<OrderDto>>> GetOrders(int page = 1, int pageSize = 20)
{
    var orders = await _session.Query<Order>()
        .OrderByDescending(x => x.CreatedAt)
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync();

    return Ok(orders.Select(OrderDto.FromEntity));
}
```

### Output Caching (.NET 8+)

```csharp
builder.Services.AddOutputCache(options =>
{
    options.AddBasePolicy(builder => builder.Expire(TimeSpan.FromMinutes(10)));
    options.AddPolicy("Orders", builder =>
        builder.Expire(TimeSpan.FromMinutes(5))
               .Tag("orders"));
});

app.UseOutputCache();

// Use in minimal API
app.MapGet("/api/orders/{id}", async (Guid id, IQuerySession session) =>
{
    var order = await session.LoadAsync<Order>(id);
    return order is not null ? Results.Ok(order) : Results.NotFound();
})
.CacheOutput("Orders");

// Invalidate cache
public class OrderService
{
    private readonly IOutputCacheStore _cache;

    public async Task UpdateOrder(Order order)
    {
        await _session.Store(order);
        await _session.SaveChangesAsync();

        // Invalidate cache
        await _cache.EvictByTagAsync("orders", default);
    }
}
```

### Database Connection Pooling

```csharp
// Connection string with pooling
"Host=localhost;Database=myapp;Username=postgres;Password=postgres;Pooling=true;MinPoolSize=0;MaxPoolSize=100"

// Configure Marten for performance
opts.Advanced.DdlRules.TableCreation = CreationStyle.CreateIfNotExists;
opts.Advanced.DdlRules.IndexCreation = CreationStyle.CreateIfNotExists;
opts.UseNodaTime();  // Better date/time handling
```

---

## 9. Testing Strategies

### Test Containers

```csharp
public class OrdersApiTests : IAsyncLifetime
{
    private PostgreSqlContainer? _postgres;
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    public async Task InitializeAsync()
    {
        _postgres = new PostgreSqlBuilder()
            .WithImage("postgres:16")
            .WithDatabase("testdb")
            .Build();

        await _postgres.StartAsync();

        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.ConfigureServices(services =>
                {
                    services.AddMarten(opts =>
                    {
                        opts.Connection(_postgres.GetConnectionString());
                    });
                });
            });

        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();
        _factory?.Dispose();
        await (_postgres?.StopAsync() ?? Task.CompletedTask);
    }

    [Fact]
    public async Task CreateOrder_ValidRequest_ReturnsCreated()
    {
        // Test implementation
    }
}
```

---

## 10. Production Deployment

### Health Checks

```csharp
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, name: "postgres")
    .AddCheck<MartenHealthCheck>("marten")
    .AddCheck<WolverineHealthCheck>("wolverine");

app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = async (context, report) =>
    {
        context.Response.ContentType = "application/json";
        var result = JsonSerializer.Serialize(new
        {
            status = report.Status.ToString(),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString(),
                duration = e.Value.Duration.TotalMilliseconds
            })
        });
        await context.Response.WriteAsync(result);
    }
});
```

### Logging

```csharp
builder.Logging.AddConsole();
builder.Logging.AddJsonConsole();  // Structured logging

// Serilog integration
builder.Host.UseSerilog((context, config) =>
{
    config
        .ReadFrom.Configuration(context.Configuration)
        .WriteTo.Console()
        .WriteTo.File("logs/app.log", rollingInterval: RollingInterval.Day)
        .Enrich.FromLogContext();
});
```

---

**Reference Complete** - Use with SKILL.md for comprehensive .NET expertise
