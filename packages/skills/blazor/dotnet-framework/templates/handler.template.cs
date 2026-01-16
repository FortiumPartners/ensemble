using Marten;
using {{Namespace}}.Entities;
using {{Namespace}}.DTOs;

namespace {{Namespace}}.Handlers;

// ============================================================================
// COMMAND HANDLERS (Write operations)
// ============================================================================

/// <summary>
/// Command to create a new {{EntityName}}.
/// </summary>
public record Create{{EntityName}}Command(
    string {{PropertyName}},
    string {{SecondPropertyName}},
    string CreatedBy);

/// <summary>
/// Handler for creating a new {{EntityName}}.
/// </summary>
public class Create{{EntityName}}Handler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<Create{{EntityName}}Handler> _logger;

    public Create{{EntityName}}Handler(
        IDocumentSession session,
        ILogger<Create{{EntityName}}Handler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<{{EntityName}}Response> Handle(Create{{EntityName}}Command command)
    {
        _logger.LogInformation(
            "Creating {{EntityName}} with {{PropertyName}}: {{{PropertyName}}}",
            command.{{PropertyName}});

        // Validate command
        if (string.IsNullOrWhiteSpace(command.{{PropertyName}}))
            throw new ValidationException("{{PropertyName}} is required");

        // Create entity using factory method
        var entity = {{EntityName}}.Create(
            command.{{PropertyName}},
            command.{{SecondPropertyName}},
            command.CreatedBy);

        // Persist to MartenDB
        _session.Store(entity);
        await _session.SaveChangesAsync();

        _logger.LogInformation(
            "{{EntityName}} created successfully with ID: {Id}",
            entity.Id);

        // Return response
        return new {{EntityName}}Response(
            entity.Id,
            entity.{{PropertyName}},
            entity.{{SecondPropertyName}},
            entity.CreatedAt,
            entity.UpdatedAt);
    }
}

/// <summary>
/// Command to update an existing {{EntityName}}.
/// </summary>
public record Update{{EntityName}}Command(
    Guid Id,
    string {{PropertyName}},
    string {{SecondPropertyName}},
    string UpdatedBy);

/// <summary>
/// Handler for updating an existing {{EntityName}}.
/// </summary>
public class Update{{EntityName}}Handler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<Update{{EntityName}}Handler> _logger;

    public Update{{EntityName}}Handler(
        IDocumentSession session,
        ILogger<Update{{EntityName}}Handler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<{{EntityName}}Response?> Handle(Update{{EntityName}}Command command)
    {
        _logger.LogInformation(
            "Updating {{EntityName}} with ID: {Id}",
            command.Id);

        // Load entity
        var entity = await _session.LoadAsync<{{EntityName}}>(command.Id);
        if (entity == null)
        {
            _logger.LogWarning("{{EntityName}} with ID {Id} not found", command.Id);
            return null;
        }

        // Update entity using domain method
        entity.Update(
            command.{{PropertyName}},
            command.{{SecondPropertyName}},
            command.UpdatedBy);

        // Persist changes
        _session.Update(entity);
        await _session.SaveChangesAsync();

        _logger.LogInformation(
            "{{EntityName}} updated successfully with ID: {Id}",
            entity.Id);

        // Return response
        return new {{EntityName}}Response(
            entity.Id,
            entity.{{PropertyName}},
            entity.{{SecondPropertyName}},
            entity.CreatedAt,
            entity.UpdatedAt);
    }
}

/// <summary>
/// Command to delete a {{EntityName}}.
/// </summary>
public record Delete{{EntityName}}Command(
    Guid Id,
    string DeletedBy);

/// <summary>
/// Handler for deleting a {{EntityName}}.
/// </summary>
public class Delete{{EntityName}}Handler
{
    private readonly IDocumentSession _session;
    private readonly ILogger<Delete{{EntityName}}Handler> _logger;

    public Delete{{EntityName}}Handler(
        IDocumentSession session,
        ILogger<Delete{{EntityName}}Handler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<bool> Handle(Delete{{EntityName}}Command command)
    {
        _logger.LogInformation(
            "Deleting {{EntityName}} with ID: {Id}",
            command.Id);

        // Load entity
        var entity = await _session.LoadAsync<{{EntityName}}>(command.Id);
        if (entity == null)
        {
            _logger.LogWarning("{{EntityName}} with ID {Id} not found", command.Id);
            return false;
        }

        // Soft delete using domain method
        entity.Delete(command.DeletedBy);

        // Persist changes
        _session.Update(entity);
        await _session.SaveChangesAsync();

        _logger.LogInformation(
            "{{EntityName}} deleted successfully with ID: {Id}",
            entity.Id);

        return true;
    }
}

// ============================================================================
// QUERY HANDLERS (Read operations)
// ============================================================================

/// <summary>
/// Query to retrieve a paginated list of {{EntityNamePlural}}.
/// </summary>
public record Get{{EntityNamePlural}}Query(
    int Page = 1,
    int PageSize = 20,
    string? Search = null,
    string? SortBy = null,
    bool Descending = false);

/// <summary>
/// Handler for retrieving a paginated list of {{EntityNamePlural}}.
/// </summary>
public class Get{{EntityNamePlural}}Handler
{
    private readonly IQuerySession _session;
    private readonly ILogger<Get{{EntityNamePlural}}Handler> _logger;

    public Get{{EntityNamePlural}}Handler(
        IQuerySession session,
        ILogger<Get{{EntityNamePlural}}Handler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<PagedResult<{{EntityName}}Response>> Handle(Get{{EntityNamePlural}}Query query)
    {
        _logger.LogInformation(
            "Retrieving {{EntityNamePlural}} - Page: {Page}, PageSize: {PageSize}",
            query.Page,
            query.PageSize);

        // Build query
        var queryable = _session.Query<{{EntityName}}>()
            .Where(x => !x.IsDeleted);

        // Apply search filter
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            queryable = queryable.Where(x =>
                x.{{PropertyName}}.Contains(query.Search) ||
                x.{{SecondPropertyName}}.Contains(query.Search));
        }

        // Apply sorting
        queryable = query.SortBy?.ToLower() switch
        {
            "{{propertyName}}" => query.Descending
                ? queryable.OrderByDescending(x => x.{{PropertyName}})
                : queryable.OrderBy(x => x.{{PropertyName}}),
            "createdat" => query.Descending
                ? queryable.OrderByDescending(x => x.CreatedAt)
                : queryable.OrderBy(x => x.CreatedAt),
            _ => queryable.OrderByDescending(x => x.CreatedAt)
        };

        // Get total count
        var totalCount = await queryable.CountAsync();

        // Apply pagination
        var items = await queryable
            .Skip((query.Page - 1) * query.PageSize)
            .Take(query.PageSize)
            .Select(x => new {{EntityName}}Response(
                x.Id,
                x.{{PropertyName}},
                x.{{SecondPropertyName}},
                x.CreatedAt,
                x.UpdatedAt))
            .ToListAsync();

        _logger.LogInformation(
            "Retrieved {Count} {{EntityNamePlural}} (Total: {TotalCount})",
            items.Count,
            totalCount);

        return new PagedResult<{{EntityName}}Response>(
            items,
            totalCount,
            query.Page,
            query.PageSize);
    }
}

/// <summary>
/// Query to retrieve a {{EntityName}} by ID.
/// </summary>
public record Get{{EntityName}}ByIdQuery(Guid Id);

/// <summary>
/// Handler for retrieving a {{EntityName}} by ID.
/// </summary>
public class Get{{EntityName}}ByIdHandler
{
    private readonly IQuerySession _session;
    private readonly ILogger<Get{{EntityName}}ByIdHandler> _logger;

    public Get{{EntityName}}ByIdHandler(
        IQuerySession session,
        ILogger<Get{{EntityName}}ByIdHandler> logger)
    {
        _session = session;
        _logger = logger;
    }

    public async Task<{{EntityName}}Response?> Handle(Get{{EntityName}}ByIdQuery query)
    {
        _logger.LogInformation(
            "Retrieving {{EntityName}} with ID: {Id}",
            query.Id);

        var entity = await _session.Query<{{EntityName}}>()
            .Where(x => x.Id == query.Id && !x.IsDeleted)
            .SingleOrDefaultAsync();

        if (entity == null)
        {
            _logger.LogWarning("{{EntityName}} with ID {Id} not found", query.Id);
            return null;
        }

        return new {{EntityName}}Response(
            entity.Id,
            entity.{{PropertyName}},
            entity.{{SecondPropertyName}},
            entity.CreatedAt,
            entity.UpdatedAt);
    }
}

// ============================================================================
// VALIDATION EXCEPTION
// ============================================================================

public class ValidationException : Exception
{
    public Dictionary<string, string[]> Errors { get; }

    public ValidationException(string message)
        : base(message)
    {
        Errors = new Dictionary<string, string[]>
        {
            { "General", new[] { message } }
        };
    }

    public ValidationException(Dictionary<string, string[]> errors)
        : base("Validation failed")
    {
        Errors = errors;
    }
}
