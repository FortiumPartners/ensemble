using Marten.Events;

namespace {{Namespace}}.Events;

// ============================================================================
// EVENT DEFINITIONS
// ============================================================================

/// <summary>
/// Base interface for all {{EntityName}} events.
/// </summary>
public interface I{{EntityName}}Event
{
    Guid {{EntityName}}Id { get; }
    string TriggeredBy { get; }
}

/// <summary>
/// Event raised when a {{EntityName}} is created.
/// </summary>
public record {{EntityName}}Created(
    Guid {{EntityName}}Id,
    string {{PropertyName}},
    string {{SecondPropertyName}},
    string TriggeredBy,
    DateTime OccurredAt) : I{{EntityName}}Event;

/// <summary>
/// Event raised when a {{EntityName}} is updated.
/// </summary>
public record {{EntityName}}Updated(
    Guid {{EntityName}}Id,
    string {{PropertyName}},
    string {{SecondPropertyName}},
    string TriggeredBy,
    DateTime OccurredAt) : I{{EntityName}}Event;

/// <summary>
/// Event raised when a {{EntityName}} is deleted.
/// </summary>
public record {{EntityName}}Deleted(
    Guid {{EntityName}}Id,
    string TriggeredBy,
    DateTime OccurredAt) : I{{EntityName}}Event;

/// <summary>
/// Event raised when a {{EntityName}}'s {{PropertyName}} changes.
/// </summary>
public record {{EntityName}}{{PropertyName}}Changed(
    Guid {{EntityName}}Id,
    string Old{{PropertyName}},
    string New{{PropertyName}},
    string TriggeredBy,
    DateTime OccurredAt) : I{{EntityName}}Event;

// ============================================================================
// AGGREGATE ROOT (Event Sourcing Pattern)
// ============================================================================

/// <summary>
/// Event-sourced aggregate for {{EntityName}}.
/// Represents the current state derived from all events.
/// </summary>
public class {{EntityName}}Aggregate
{
    public Guid Id { get; private set; }
    public string {{PropertyName}} { get; private set; } = string.Empty;
    public string {{SecondPropertyName}} { get; private set; } = string.Empty;
    public DateTime CreatedAt { get; private set; }
    public string CreatedBy { get; private set; } = string.Empty;
    public DateTime? UpdatedAt { get; private set; }
    public string? UpdatedBy { get; private set; }
    public bool IsDeleted { get; private set; }
    public DateTime? DeletedAt { get; private set; }
    public string? DeletedBy { get; private set; }

    // Event version for concurrency control
    public int Version { get; private set; }

    // ========================================================================
    // EVENT APPLICATION METHODS (State Transitions)
    // ========================================================================

    /// <summary>
    /// Applies the {{EntityName}}Created event to set initial state.
    /// </summary>
    public void Apply({{EntityName}}Created evt)
    {
        Id = evt.{{EntityName}}Id;
        {{PropertyName}} = evt.{{PropertyName}};
        {{SecondPropertyName}} = evt.{{SecondPropertyName}};
        CreatedAt = evt.OccurredAt;
        CreatedBy = evt.TriggeredBy;
        IsDeleted = false;
        Version++;
    }

    /// <summary>
    /// Applies the {{EntityName}}Updated event to update state.
    /// </summary>
    public void Apply({{EntityName}}Updated evt)
    {
        {{PropertyName}} = evt.{{PropertyName}};
        {{SecondPropertyName}} = evt.{{SecondPropertyName}};
        UpdatedAt = evt.OccurredAt;
        UpdatedBy = evt.TriggeredBy;
        Version++;
    }

    /// <summary>
    /// Applies the {{EntityName}}Deleted event to mark as deleted.
    /// </summary>
    public void Apply({{EntityName}}Deleted evt)
    {
        IsDeleted = true;
        DeletedAt = evt.OccurredAt;
        DeletedBy = evt.TriggeredBy;
        Version++;
    }

    /// <summary>
    /// Applies the {{EntityName}}{{PropertyName}}Changed event.
    /// </summary>
    public void Apply({{EntityName}}{{PropertyName}}Changed evt)
    {
        {{PropertyName}} = evt.New{{PropertyName}};
        UpdatedAt = evt.OccurredAt;
        UpdatedBy = evt.TriggeredBy;
        Version++;
    }

    // ========================================================================
    // COMMAND METHODS (Decision Logic - Produces Events)
    // ========================================================================

    /// <summary>
    /// Creates a new {{EntityName}} and returns the creation event.
    /// </summary>
    public static {{EntityName}}Created Create(
        Guid id,
        string {{propertyName}},
        string {{secondPropertyName}},
        string triggeredBy)
    {
        // Validation
        if (string.IsNullOrWhiteSpace({{propertyName}}))
            throw new ArgumentException("{{PropertyName}} cannot be empty", nameof({{propertyName}}));

        if (string.IsNullOrWhiteSpace(triggeredBy))
            throw new ArgumentException("TriggeredBy cannot be empty", nameof(triggeredBy));

        // Create event
        return new {{EntityName}}Created(
            id,
            {{propertyName}}.Trim(),
            {{secondPropertyName}}?.Trim() ?? string.Empty,
            triggeredBy,
            DateTime.UtcNow);
    }

    /// <summary>
    /// Updates the {{EntityName}} and returns the update event.
    /// </summary>
    public {{EntityName}}Updated Update(
        string {{propertyName}},
        string {{secondPropertyName}},
        string triggeredBy)
    {
        // Validation
        if (IsDeleted)
            throw new InvalidOperationException("Cannot update a deleted {{EntityName}}");

        if (string.IsNullOrWhiteSpace({{propertyName}}))
            throw new ArgumentException("{{PropertyName}} cannot be empty", nameof({{propertyName}}));

        if (string.IsNullOrWhiteSpace(triggeredBy))
            throw new ArgumentException("TriggeredBy cannot be empty", nameof(triggeredBy));

        // Create event
        return new {{EntityName}}Updated(
            Id,
            {{propertyName}}.Trim(),
            {{secondPropertyName}}?.Trim() ?? string.Empty,
            triggeredBy,
            DateTime.UtcNow);
    }

    /// <summary>
    /// Deletes the {{EntityName}} and returns the deletion event.
    /// </summary>
    public {{EntityName}}Deleted Delete(string triggeredBy)
    {
        // Validation
        if (IsDeleted)
            throw new InvalidOperationException("{{EntityName}} is already deleted");

        if (string.IsNullOrWhiteSpace(triggeredBy))
            throw new ArgumentException("TriggeredBy cannot be empty", nameof(triggeredBy));

        // Create event
        return new {{EntityName}}Deleted(
            Id,
            triggeredBy,
            DateTime.UtcNow);
    }

    /// <summary>
    /// Changes the {{PropertyName}} and returns the change event.
    /// </summary>
    public {{EntityName}}{{PropertyName}}Changed Change{{PropertyName}}(
        string new{{PropertyName}},
        string triggeredBy)
    {
        // Validation
        if (IsDeleted)
            throw new InvalidOperationException("Cannot change {{PropertyName}} of a deleted {{EntityName}}");

        if (string.IsNullOrWhiteSpace(new{{PropertyName}}))
            throw new ArgumentException("New {{PropertyName}} cannot be empty", nameof(new{{PropertyName}}));

        if ({{PropertyName}} == new{{PropertyName}})
            throw new InvalidOperationException("{{PropertyName}} has not changed");

        // Create event
        return new {{EntityName}}{{PropertyName}}Changed(
            Id,
            {{PropertyName}},
            new{{PropertyName}}.Trim(),
            triggeredBy,
            DateTime.UtcNow);
    }
}

// ============================================================================
// EVENT STORE INTEGRATION (MartenDB)
// ============================================================================

/*
 * MartenDB Configuration (add to Program.cs):
 *
 * builder.Services.AddMarten(opts =>
 * {
 *     opts.Connection(connectionString);
 *
 *     // Configure event store
 *     opts.Events.StreamIdentity = StreamIdentity.AsGuid;
 *
 *     // Configure aggregate projection
 *     opts.Events.Projections.Add<{{EntityName}}Projection>(ProjectionLifecycle.Inline);
 *
 *     // Configure event archiving (optional)
 *     opts.Events.UseArchivedStreamPartitioning = true;
 * });
 *
 *
 * Example Command Handler with Event Sourcing:
 *
 * public class Create{{EntityName}}EventSourcedHandler
 * {
 *     private readonly IDocumentSession _session;
 *
 *     public Create{{EntityName}}EventSourcedHandler(IDocumentSession session)
 *     {
 *         _session = session;
 *     }
 *
 *     public async Task<Guid> Handle(Create{{EntityName}}Command command)
 *     {
 *         var id = Guid.NewGuid();
 *
 *         // Create event
 *         var evt = {{EntityName}}Aggregate.Create(
 *             id,
 *             command.{{PropertyName}},
 *             command.{{SecondPropertyName}},
 *             command.CreatedBy);
 *
 *         // Append to event stream
 *         _session.Events.StartStream<{{EntityName}}Aggregate>(id, evt);
 *         await _session.SaveChangesAsync();
 *
 *         return id;
 *     }
 * }
 *
 *
 * Example Query Handler Loading Aggregate:
 *
 * public class Get{{EntityName}}EventSourcedHandler
 * {
 *     private readonly IDocumentSession _session;
 *
 *     public Get{{EntityName}}EventSourcedHandler(IDocumentSession session)
 *     {
 *         _session = session;
 *     }
 *
 *     public async Task<{{EntityName}}Aggregate?> Handle(Get{{EntityName}}ByIdQuery query)
 *     {
 *         // Load aggregate from event stream
 *         return await _session.Events.AggregateStreamAsync<{{EntityName}}Aggregate>(query.Id);
 *     }
 * }
 */
