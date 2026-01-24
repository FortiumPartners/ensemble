/*
 * ============================================================================
 * EXAMPLE 2: Event Sourcing with MartenDB
 * ============================================================================
 *
 * This example demonstrates a complete event sourcing implementation with:
 * - Event-sourced aggregates with MartenDB
 * - Event streams and projections
 * - Command handlers producing events
 * - Read models with inline and async projections
 * - Optimistic concurrency control
 * - Temporal queries (state at specific time)
 * - Event replay and audit trails
 *
 * Technologies:
 * - MartenDB Event Store
 * - Wolverine command handling
 * - Event sourcing patterns
 * - CQRS with read models
 * - ASP.NET Core Minimal APIs
 *
 * Lines: ~550
 * Complexity: Advanced
 */

using Marten;
using Marten.Events;
using Marten.Events.Aggregation;
using Marten.Events.Projections;
using Microsoft.AspNetCore.Mvc;
using Wolverine;

// ============================================================================
// PROGRAM.CS - Application Startup
// ============================================================================

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Configure MartenDB with Event Store
builder.Services.AddMarten(opts =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
        ?? "Host=localhost;Database=order_system;Username=postgres;Password=postgres";

    opts.Connection(connectionString);
    opts.AutoCreateSchemaObjects = Marten.Schema.AutoCreate.CreateOrUpdate;

    // Configure event store
    opts.Events.StreamIdentity = StreamIdentity.AsGuid;

    // Add inline projection for read model (strong consistency)
    opts.Projections.Add<OrderProjection>(ProjectionLifecycle.Inline);

    // Add async projection for statistics (eventual consistency)
    opts.Projections.Add<OrderStatisticsProjection>(ProjectionLifecycle.Async);

    // Enable event archiving for historical queries
    opts.Events.UseArchivedStreamPartitioning = true;
})
.AddAsyncDaemon(DaemonMode.HotCold); // Background daemon for async projections

// Configure Wolverine
builder.Host.UseWolverine();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Map endpoints
app.MapOrderEndpoints();

app.Run();

// ============================================================================
// DOMAIN EVENTS
// ============================================================================

public record OrderCreated(
    Guid OrderId,
    string CustomerId,
    List<OrderItemData> Items,
    decimal TotalAmount,
    DateTime OccurredAt);

public record OrderShipped(
    Guid OrderId,
    string ShippingAddress,
    string TrackingNumber,
    DateTime OccurredAt);

public record OrderCompleted(
    Guid OrderId,
    DateTime CompletedAt);

public record OrderCancelled(
    Guid OrderId,
    string Reason,
    DateTime OccurredAt);

public record OrderItemAdded(
    Guid OrderId,
    OrderItemData Item,
    DateTime OccurredAt);

public record OrderItemRemoved(
    Guid OrderId,
    Guid ItemId,
    DateTime OccurredAt);

public record OrderItemData(
    Guid ItemId,
    string ProductId,
    string ProductName,
    int Quantity,
    decimal UnitPrice);

// ============================================================================
// AGGREGATE ROOT (Event-Sourced)
// ============================================================================

public class OrderAggregate
{
    public Guid Id { get; private set; }
    public string CustomerId { get; private set; } = string.Empty;
    public List<OrderItem> Items { get; private set; } = new();
    public decimal TotalAmount { get; private set; }
    public OrderStatus Status { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? ShippedAt { get; private set; }
    public DateTime? CompletedAt { get; private set; }
    public string? TrackingNumber { get; private set; }
    public int Version { get; private set; }

    // Event application methods (state transitions)
    public void Apply(OrderCreated evt)
    {
        Id = evt.OrderId;
        CustomerId = evt.CustomerId;
        Items = evt.Items.Select(i => new OrderItem(
            i.ItemId, i.ProductId, i.ProductName, i.Quantity, i.UnitPrice)).ToList();
        TotalAmount = evt.TotalAmount;
        Status = OrderStatus.Created;
        CreatedAt = evt.OccurredAt;
        Version++;
    }

    public void Apply(OrderShipped evt)
    {
        Status = OrderStatus.Shipped;
        ShippedAt = evt.OccurredAt;
        TrackingNumber = evt.TrackingNumber;
        Version++;
    }

    public void Apply(OrderCompleted evt)
    {
        Status = OrderStatus.Completed;
        CompletedAt = evt.OccurredAt;
        Version++;
    }

    public void Apply(OrderCancelled evt)
    {
        Status = OrderStatus.Cancelled;
        Version++;
    }

    public void Apply(OrderItemAdded evt)
    {
        Items.Add(new OrderItem(
            evt.Item.ItemId,
            evt.Item.ProductId,
            evt.Item.ProductName,
            evt.Item.Quantity,
            evt.Item.UnitPrice));
        TotalAmount = Items.Sum(i => i.Quantity * i.UnitPrice);
        Version++;
    }

    public void Apply(OrderItemRemoved evt)
    {
        Items.RemoveAll(i => i.ItemId == evt.ItemId);
        TotalAmount = Items.Sum(i => i.Quantity * i.UnitPrice);
        Version++;
    }

    // Command methods (decision logic - produces events)
    public static OrderCreated Create(
        Guid orderId,
        string customerId,
        List<OrderItemData> items)
    {
        if (string.IsNullOrWhiteSpace(customerId))
            throw new ArgumentException("Customer ID is required", nameof(customerId));

        if (items == null || items.Count == 0)
            throw new ArgumentException("Order must have at least one item", nameof(items));

        var totalAmount = items.Sum(i => i.Quantity * i.UnitPrice);

        return new OrderCreated(
            orderId,
            customerId,
            items,
            totalAmount,
            DateTime.UtcNow);
    }

    public OrderShipped Ship(string shippingAddress, string trackingNumber)
    {
        if (Status != OrderStatus.Created)
            throw new InvalidOperationException($"Cannot ship order in {Status} status");

        if (string.IsNullOrWhiteSpace(shippingAddress))
            throw new ArgumentException("Shipping address is required", nameof(shippingAddress));

        return new OrderShipped(Id, shippingAddress, trackingNumber, DateTime.UtcNow);
    }

    public OrderCompleted Complete()
    {
        if (Status != OrderStatus.Shipped)
            throw new InvalidOperationException($"Cannot complete order in {Status} status");

        return new OrderCompleted(Id, DateTime.UtcNow);
    }

    public OrderCancelled Cancel(string reason)
    {
        if (Status == OrderStatus.Completed)
            throw new InvalidOperationException("Cannot cancel a completed order");

        return new OrderCancelled(Id, reason, DateTime.UtcNow);
    }
}

public enum OrderStatus
{
    Created,
    Shipped,
    Completed,
    Cancelled
}

public record OrderItem(
    Guid ItemId,
    string ProductId,
    string ProductName,
    int Quantity,
    decimal UnitPrice);

// ============================================================================
// READ MODEL (Projection Target)
// ============================================================================

public class OrderReadModel
{
    public Guid Id { get; set; }
    public string CustomerId { get; set; } = string.Empty;
    public List<OrderItem> Items { get; set; } = new();
    public decimal TotalAmount { get; set; }
    public OrderStatus Status { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ShippedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? TrackingNumber { get; set; }
    public int EventCount { get; set; }
    public DateTime LastEventAt { get; set; }
}

// ============================================================================
// INLINE PROJECTION (Strong Consistency)
// ============================================================================

public class OrderProjection : SingleStreamProjection<OrderReadModel>
{
    public OrderReadModel Create(OrderCreated evt)
    {
        return new OrderReadModel
        {
            Id = evt.OrderId,
            CustomerId = evt.CustomerId,
            Items = evt.Items.Select(i => new OrderItem(
                i.ItemId, i.ProductId, i.ProductName, i.Quantity, i.UnitPrice)).ToList(),
            TotalAmount = evt.TotalAmount,
            Status = OrderStatus.Created,
            CreatedAt = evt.OccurredAt,
            EventCount = 1,
            LastEventAt = evt.OccurredAt
        };
    }

    public void Apply(OrderShipped evt, OrderReadModel model)
    {
        model.Status = OrderStatus.Shipped;
        model.ShippedAt = evt.OccurredAt;
        model.TrackingNumber = evt.TrackingNumber;
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }

    public void Apply(OrderCompleted evt, OrderReadModel model)
    {
        model.Status = OrderStatus.Completed;
        model.CompletedAt = evt.OccurredAt;
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }

    public void Apply(OrderCancelled evt, OrderReadModel model)
    {
        model.Status = OrderStatus.Cancelled;
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }

    public void Apply(OrderItemAdded evt, OrderReadModel model)
    {
        model.Items.Add(new OrderItem(
            evt.Item.ItemId,
            evt.Item.ProductId,
            evt.Item.ProductName,
            evt.Item.Quantity,
            evt.Item.UnitPrice));
        model.TotalAmount = model.Items.Sum(i => i.Quantity * i.UnitPrice);
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }

    public void Apply(OrderItemRemoved evt, OrderReadModel model)
    {
        model.Items.RemoveAll(i => i.ItemId == evt.ItemId);
        model.TotalAmount = model.Items.Sum(i => i.Quantity * i.UnitPrice);
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }
}

// ============================================================================
// ASYNC PROJECTION (Eventual Consistency)
// ============================================================================

public class OrderStatisticsProjection : MultiStreamProjection<OrderStatistics, Guid>
{
    public OrderStatisticsProjection()
    {
        Identity<OrderCreated>(x => x.OrderId);
        Identity<OrderShipped>(x => x.OrderId);
        Identity<OrderCompleted>(x => x.OrderId);
        Identity<OrderCancelled>(x => x.OrderId);
    }

    public void Apply(OrderCreated evt, OrderStatistics stats)
    {
        stats.Id = evt.OrderId;
        stats.CustomerId = evt.CustomerId;
        stats.OrderValue = evt.TotalAmount;
        stats.EventCount = 1;
        stats.CreatedAt = evt.OccurredAt;
        stats.LastEventAt = evt.OccurredAt;
    }

    public void Apply(OrderShipped evt, OrderStatistics stats)
    {
        stats.ShippedAt = evt.OccurredAt;
        stats.EventCount++;
        stats.LastEventAt = evt.OccurredAt;
    }

    public void Apply(OrderCompleted evt, OrderStatistics stats)
    {
        stats.CompletedAt = evt.OccurredAt;
        stats.EventCount++;
        stats.LastEventAt = evt.OccurredAt;
    }

    public void Apply(OrderCancelled evt, OrderStatistics stats)
    {
        stats.CancelledAt = evt.OccurredAt;
        stats.EventCount++;
        stats.LastEventAt = evt.OccurredAt;
    }
}

public class OrderStatistics
{
    public Guid Id { get; set; }
    public string CustomerId { get; set; } = string.Empty;
    public decimal OrderValue { get; set; }
    public int EventCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ShippedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public DateTime LastEventAt { get; set; }
}

// ============================================================================
// COMMANDS
// ============================================================================

public record CreateOrderCommand(
    string CustomerId,
    List<OrderItemData> Items);

public record ShipOrderCommand(
    Guid OrderId,
    string ShippingAddress,
    string TrackingNumber);

public record CompleteOrderCommand(Guid OrderId);

public record CancelOrderCommand(Guid OrderId, string Reason);

// ============================================================================
// COMMAND HANDLERS (Event Sourcing Style)
// ============================================================================

public class CreateOrderHandler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<CreateOrderHandler> _logger;

    public CreateOrderHandler(IDocumentSession session, ILogger<CreateOrderHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<Guid> Handle(CreateOrderCommand command)
    {
        _logger.LogInformation("Creating order for customer: {CustomerId}", command.CustomerId);

        var orderId = Guid.NewGuid();

        // Create event using aggregate's decision logic
        var evt = OrderAggregate.Create(orderId, command.CustomerId, command.Items);

        // Append event to stream
        _session.Events.StartStream<OrderAggregate>(orderId, evt);
        await _session.SaveChangesAsync();

        _logger.LogInformation("Order created with ID: {OrderId}", orderId);

        return orderId;
    }
}

public class ShipOrderHandler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<ShipOrderHandler> _logger;

    public ShipOrderHandler(IDocumentSession session, ILogger<ShipOrderHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<bool> Handle(ShipOrderCommand command)
    {
        _logger.LogInformation("Shipping order: {OrderId}", command.OrderId);

        // Load aggregate from event stream
        var aggregate = await _session.Events.AggregateStreamAsync<OrderAggregate>(command.OrderId);
        if (aggregate == null)
        {
            _logger.LogWarning("Order not found: {OrderId}", command.OrderId);
            return false;
        }

        try
        {
            // Use aggregate's decision logic to produce event
            var evt = aggregate.Ship(command.ShippingAddress, command.TrackingNumber);

            // Append event to stream with expected version (optimistic concurrency)
            _session.Events.Append(command.OrderId, aggregate.Version, evt);
            await _session.SaveChangesAsync();

            _logger.LogInformation("Order shipped: {OrderId}", command.OrderId);
            return true;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Cannot ship order {OrderId}: {Message}",
                command.OrderId, ex.Message);
            throw;
        }
    }
}

public class CompleteOrderHandler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<CompleteOrderHandler> _logger;

    public CompleteOrderHandler(IDocumentSession session, ILogger<CompleteOrderHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<bool> Handle(CompleteOrderCommand command)
    {
        _logger.LogInformation("Completing order: {OrderId}", command.OrderId);

        var aggregate = await _session.Events.AggregateStreamAsync<OrderAggregate>(command.OrderId);
        if (aggregate == null) return false;

        try
        {
            var evt = aggregate.Complete();
            _session.Events.Append(command.OrderId, aggregate.Version, evt);
            await _session.SaveChangesAsync();

            _logger.LogInformation("Order completed: {OrderId}", command.OrderId);
            return true;
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Cannot complete order {OrderId}: {Message}",
                command.OrderId, ex.Message);
            throw;
        }
    }
}

// ============================================================================
// MINIMAL API ENDPOINTS
// ============================================================================

public static class OrderEndpoints
{
    public static RouteGroupBuilder MapOrderEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/orders")
            .WithTags("Orders")
            .WithOpenApi();

        group.MapPost("/", CreateOrder)
            .WithName("CreateOrder")
            .Produces<Guid>(StatusCodes.Status201Created);

        group.MapPost("/{id:guid}/ship", ShipOrder)
            .WithName("ShipOrder")
            .Produces(StatusCodes.Status200OK);

        group.MapPost("/{id:guid}/complete", CompleteOrder)
            .WithName("CompleteOrder")
            .Produces(StatusCodes.Status200OK);

        group.MapPost("/{id:guid}/cancel", CancelOrder)
            .WithName("CancelOrder")
            .Produces(StatusCodes.Status200OK);

        group.MapGet("/{id:guid}", GetOrder)
            .WithName("GetOrder")
            .Produces<OrderReadModel>(StatusCodes.Status200OK);

        group.MapGet("/{id:guid}/history", GetOrderHistory)
            .WithName("GetOrderHistory")
            .Produces<List<IEvent>>(StatusCodes.Status200OK);

        group.MapGet("/{id:guid}/at/{timestamp:datetime}", GetOrderAtTime)
            .WithName("GetOrderAtTime")
            .Produces<OrderAggregate>(StatusCodes.Status200OK);

        return group;
    }

    private static async Task<IResult> CreateOrder(
        [FromBody] CreateOrderCommand command,
        IMessageBus messageBus)
    {
        var orderId = await messageBus.InvokeAsync<Guid>(command);
        return Results.Created($"/api/orders/{orderId}", orderId);
    }

    private static async Task<IResult> ShipOrder(
        Guid id,
        [FromBody] ShipOrderCommand command,
        IMessageBus messageBus)
    {
        command = command with { OrderId = id };
        var success = await messageBus.InvokeAsync<bool>(command);
        return success ? Results.Ok() : Results.NotFound();
    }

    private static async Task<IResult> CompleteOrder(
        Guid id,
        IMessageBus messageBus)
    {
        var command = new CompleteOrderCommand(id);
        var success = await messageBus.InvokeAsync<bool>(command);
        return success ? Results.Ok() : Results.NotFound();
    }

    private static async Task<IResult> CancelOrder(
        Guid id,
        [FromBody] CancelOrderCommand command,
        IMessageBus messageBus)
    {
        command = command with { OrderId = id };
        var success = await messageBus.InvokeAsync<bool>(command);
        return success ? Results.Ok() : Results.NotFound();
    }

    private static async Task<IResult> GetOrder(
        Guid id,
        IQuerySession session)
    {
        // Get from read model (fast, projected state)
        var order = await session.LoadAsync<OrderReadModel>(id);
        return order != null ? Results.Ok(order) : Results.NotFound();
    }

    private static async Task<IResult> GetOrderHistory(
        Guid id,
        IDocumentSession session)
    {
        // Get all events from stream (full audit trail)
        var events = await session.Events.FetchStreamAsync(id);
        return events.Any() ? Results.Ok(events) : Results.NotFound();
    }

    private static async Task<IResult> GetOrderAtTime(
        Guid id,
        DateTime timestamp,
        IDocumentSession session)
    {
        // Temporal query: get aggregate state at specific point in time
        var aggregate = await session.Events.AggregateStreamAsync<OrderAggregate>(
            id,
            timestamp: timestamp);

        return aggregate != null ? Results.Ok(aggregate) : Results.NotFound();
    }
}

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/*
 * Example 1: Create and process an order
 *
 * POST /api/orders
 * {
 *   "customerId": "CUST-123",
 *   "items": [
 *     {
 *       "itemId": "11111111-1111-1111-1111-111111111111",
 *       "productId": "PROD-001",
 *       "productName": "Widget",
 *       "quantity": 2,
 *       "unitPrice": 29.99
 *     }
 *   ]
 * }
 *
 * Response: "22222222-2222-2222-2222-222222222222"
 *
 *
 * Example 2: Ship the order
 *
 * POST /api/orders/22222222-2222-2222-2222-222222222222/ship
 * {
 *   "shippingAddress": "123 Main St, City, State 12345",
 *   "trackingNumber": "TRACK-123456"
 * }
 *
 *
 * Example 3: Get current order state (from read model)
 *
 * GET /api/orders/22222222-2222-2222-2222-222222222222
 *
 * Response:
 * {
 *   "id": "22222222-2222-2222-2222-222222222222",
 *   "customerId": "CUST-123",
 *   "status": "Shipped",
 *   "totalAmount": 59.98,
 *   ...
 * }
 *
 *
 * Example 4: Get full event history (audit trail)
 *
 * GET /api/orders/22222222-2222-2222-2222-222222222222/history
 *
 * Response:
 * [
 *   { "eventType": "OrderCreated", "timestamp": "2025-01-15T10:00:00Z", ... },
 *   { "eventType": "OrderShipped", "timestamp": "2025-01-16T14:30:00Z", ... }
 * ]
 *
 *
 * Example 5: Temporal query (state at specific time)
 *
 * GET /api/orders/22222222-2222-2222-2222-222222222222/at/2025-01-15T12:00:00Z
 *
 * Response: Order aggregate state as it existed at noon on Jan 15
 */
