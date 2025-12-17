using Marten.Events;
using Marten.Events.Aggregation;
using Marten.Events.Projections;
using {{Namespace}}.Events;

namespace {{Namespace}}.Projections;

// ============================================================================
// READ MODEL (Projection Target)
// ============================================================================

/// <summary>
/// Read model for {{EntityName}} queries.
/// Projected from {{EntityName}} events for optimized reads.
/// </summary>
public class {{EntityName}}ReadModel
{
    public Guid Id { get; set; }
    public string {{PropertyName}} { get; set; } = string.Empty;
    public string {{SecondPropertyName}} { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime? UpdatedAt { get; set; }
    public string? UpdatedBy { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }

    // Additional projection-specific properties
    public int EventCount { get; set; }
    public DateTime LastEventAt { get; set; }
}

// ============================================================================
// INLINE PROJECTION (Real-time Updates)
// ============================================================================

/// <summary>
/// Inline projection for {{EntityName}} read model.
/// Updates synchronously with event append (strong consistency).
/// </summary>
public class {{EntityName}}Projection : SingleStreamProjection<{{EntityName}}ReadModel>
{
    /// <summary>
    /// Creates initial read model from {{EntityName}}Created event.
    /// </summary>
    public {{EntityName}}ReadModel Create({{EntityName}}Created evt)
    {
        return new {{EntityName}}ReadModel
        {
            Id = evt.{{EntityName}}Id,
            {{PropertyName}} = evt.{{PropertyName}},
            {{SecondPropertyName}} = evt.{{SecondPropertyName}},
            CreatedAt = evt.OccurredAt,
            CreatedBy = evt.TriggeredBy,
            IsDeleted = false,
            EventCount = 1,
            LastEventAt = evt.OccurredAt
        };
    }

    /// <summary>
    /// Updates read model from {{EntityName}}Updated event.
    /// </summary>
    public void Apply({{EntityName}}Updated evt, {{EntityName}}ReadModel model)
    {
        model.{{PropertyName}} = evt.{{PropertyName}};
        model.{{SecondPropertyName}} = evt.{{SecondPropertyName}};
        model.UpdatedAt = evt.OccurredAt;
        model.UpdatedBy = evt.TriggeredBy;
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }

    /// <summary>
    /// Marks read model as deleted from {{EntityName}}Deleted event.
    /// </summary>
    public void Apply({{EntityName}}Deleted evt, {{EntityName}}ReadModel model)
    {
        model.IsDeleted = true;
        model.DeletedAt = evt.OccurredAt;
        model.DeletedBy = evt.TriggeredBy;
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }

    /// <summary>
    /// Updates {{PropertyName}} from {{EntityName}}{{PropertyName}}Changed event.
    /// </summary>
    public void Apply({{EntityName}}{{PropertyName}}Changed evt, {{EntityName}}ReadModel model)
    {
        model.{{PropertyName}} = evt.New{{PropertyName}};
        model.UpdatedAt = evt.OccurredAt;
        model.UpdatedBy = evt.TriggeredBy;
        model.EventCount++;
        model.LastEventAt = evt.OccurredAt;
    }
}

// ============================================================================
// ASYNC PROJECTION (Eventual Consistency)
// ============================================================================

/// <summary>
/// Async projection for {{EntityName}} statistics.
/// Updates asynchronously in background (eventual consistency).
/// </summary>
public class {{EntityName}}StatisticsProjection : MultiStreamProjection<{{EntityName}}Statistics, Guid>
{
    public {{EntityName}}StatisticsProjection()
    {
        // Identity is the {{EntityName}}Id
        Identity<{{EntityName}}Created>(x => x.{{EntityName}}Id);
        Identity<{{EntityName}}Updated>(x => x.{{EntityName}}Id);
        Identity<{{EntityName}}Deleted>(x => x.{{EntityName}}Id);
    }

    public void Apply({{EntityName}}Created evt, {{EntityName}}Statistics stats)
    {
        stats.Id = evt.{{EntityName}}Id;
        stats.CreatedAt = evt.OccurredAt;
        stats.TotalEvents = 1;
        stats.LastEventAt = evt.OccurredAt;
        stats.IsActive = true;
    }

    public void Apply({{EntityName}}Updated evt, {{EntityName}}Statistics stats)
    {
        stats.UpdateCount++;
        stats.TotalEvents++;
        stats.LastEventAt = evt.OccurredAt;
    }

    public void Apply({{EntityName}}Deleted evt, {{EntityName}}Statistics stats)
    {
        stats.DeletedAt = evt.OccurredAt;
        stats.IsActive = false;
        stats.TotalEvents++;
        stats.LastEventAt = evt.OccurredAt;
    }
}

/// <summary>
/// Statistics read model for {{EntityName}}.
/// </summary>
public class {{EntityName}}Statistics
{
    public Guid Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public bool IsActive { get; set; }
    public int UpdateCount { get; set; }
    public int TotalEvents { get; set; }
    public DateTime LastEventAt { get; set; }
}

// ============================================================================
// CUSTOM AGGREGATION PROJECTION
// ============================================================================

/// <summary>
/// Custom projection for {{EntityName}} summary with manual aggregation.
/// </summary>
public class {{EntityName}}SummaryProjection : CustomProjection<{{EntityName}}Summary, Guid>
{
    public {{EntityName}}SummaryProjection()
    {
        // Aggregate by CreatedBy user
        AggregateByStream();
    }

    public override async ValueTask<{{EntityName}}Summary> ApplyAsync(
        IReadOnlyList<IEvent> events,
        IQuerySession session,
        {{EntityName}}Summary? current,
        CancellationToken cancellationToken)
    {
        var summary = current ?? new {{EntityName}}Summary();

        foreach (var @event in events)
        {
            switch (@event.Data)
            {
                case {{EntityName}}Created created:
                    summary.TotalCreated++;
                    summary.UserSummaries.TryAdd(created.TriggeredBy, new UserSummary());
                    summary.UserSummaries[created.TriggeredBy].CreatedCount++;
                    break;

                case {{EntityName}}Updated updated:
                    summary.TotalUpdated++;
                    summary.UserSummaries.TryAdd(updated.TriggeredBy, new UserSummary());
                    summary.UserSummaries[updated.TriggeredBy].UpdatedCount++;
                    break;

                case {{EntityName}}Deleted deleted:
                    summary.TotalDeleted++;
                    summary.UserSummaries.TryAdd(deleted.TriggeredBy, new UserSummary());
                    summary.UserSummaries[deleted.TriggeredBy].DeletedCount++;
                    break;
            }
        }

        return summary;
    }
}

/// <summary>
/// Summary read model for {{EntityName}} aggregated statistics.
/// </summary>
public class {{EntityName}}Summary
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int TotalCreated { get; set; }
    public int TotalUpdated { get; set; }
    public int TotalDeleted { get; set; }
    public Dictionary<string, UserSummary> UserSummaries { get; set; } = new();
}

public class UserSummary
{
    public int CreatedCount { get; set; }
    public int UpdatedCount { get; set; }
    public int DeletedCount { get; set; }
}

// ============================================================================
// PROJECTION CONFIGURATION (Add to Program.cs)
// ============================================================================

/*
 * Configure projections in MartenDB setup:
 *
 * builder.Services.AddMarten(opts =>
 * {
 *     opts.Connection(connectionString);
 *
 *     // INLINE PROJECTION (real-time, strong consistency)
 *     opts.Projections.Add<{{EntityName}}Projection>(ProjectionLifecycle.Inline);
 *
 *     // ASYNC PROJECTION (background daemon, eventual consistency)
 *     opts.Projections.Add<{{EntityName}}StatisticsProjection>(ProjectionLifecycle.Async);
 *
 *     // CUSTOM PROJECTION
 *     opts.Projections.Add<{{EntityName}}SummaryProjection>(ProjectionLifecycle.Async);
 *
 *     // Configure async daemon
 *     opts.Projections.AsyncMode = DaemonMode.HotCold;
 * })
 * .AddAsyncDaemon(DaemonMode.HotCold);
 *
 *
 * Projection Lifecycle Options:
 * - Inline: Updates synchronously with event append (strong consistency)
 * - Async: Background daemon processes events (eventual consistency, higher throughput)
 * - Live: Real-time subscription to event stream (for external integrations)
 *
 *
 * Querying Projected Read Models:
 *
 * public class Get{{EntityName}}ReadModelHandler
 * {
 *     private readonly IQuerySession _session;
 *
 *     public async Task<{{EntityName}}ReadModel?> Handle(Get{{EntityName}}ByIdQuery query)
 *     {
 *         return await _session.LoadAsync<{{EntityName}}ReadModel>(query.Id);
 *     }
 * }
 *
 *
 * Rebuilding Projections (Admin Operation):
 *
 * using var daemon = await host.Services.GetRequiredService<IProjectionCoordinator>()
 *     .RebuildProjectionAsync<{{EntityName}}Projection>(CancellationToken.None);
 */
