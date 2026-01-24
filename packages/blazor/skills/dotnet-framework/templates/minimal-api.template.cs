using Microsoft.AspNetCore.Mvc;
using {{Namespace}}.Commands;
using {{Namespace}}.Queries;
using {{Namespace}}.DTOs;
using Wolverine;

namespace {{Namespace}}.Endpoints;

/// <summary>
/// Minimal API endpoints for {{EntityNamePlural}}.
/// </summary>
public static class {{EntityNamePlural}}Endpoints
{
    /// <summary>
    /// Maps all {{EntityName}} endpoints to the application.
    /// </summary>
    public static RouteGroupBuilder Map{{EntityNamePlural}}Endpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/{{EntityNamePluralLower}}")
            .WithTags("{{EntityNamePlural}}")
            .WithOpenApi()
            .RequireAuthorization();

        group.MapGet("/", GetAll)
            .WithName("Get{{EntityNamePlural}}")
            .Produces<PagedResult<{{EntityName}}Response>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError);

        group.MapGet("/{id:guid}", GetById)
            .WithName("Get{{EntityName}}ById")
            .Produces<{{EntityName}}Response>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError);

        group.MapPost("/", Create)
            .WithName("Create{{EntityName}}")
            .Produces<{{EntityName}}Response>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status500InternalServerError);

        group.MapPut("/{id:guid}", Update)
            .WithName("Update{{EntityName}}")
            .Produces<{{EntityName}}Response>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status500InternalServerError);

        group.MapDelete("/{id:guid}", Delete)
            .WithName("Delete{{EntityName}}")
            .Produces(StatusCodes.Status204NoContent)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError);

        return group;
    }

    /// <summary>
    /// Retrieves a paginated list of {{EntityNamePlural}}.
    /// </summary>
    private static async Task<IResult> GetAll(
        [AsParameters] Get{{EntityNamePlural}}Query query,
        IMessageBus messageBus,
        ILogger<Program> logger)
    {
        try
        {
            var result = await messageBus.InvokeAsync<PagedResult<{{EntityName}}Response>>(query);
            return Results.Ok(result);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving {{EntityNamePlural}}");
            return Results.Problem(
                title: "Error retrieving {{EntityNamePlural}}",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    /// <summary>
    /// Retrieves a specific {{EntityName}} by ID.
    /// </summary>
    private static async Task<IResult> GetById(
        Guid id,
        IMessageBus messageBus,
        ILogger<Program> logger)
    {
        try
        {
            var query = new Get{{EntityName}}ByIdQuery(id);
            var result = await messageBus.InvokeAsync<{{EntityName}}Response?>(query);

            if (result == null)
            {
                logger.LogWarning("{{EntityName}} with ID {Id} not found", id);
                return Results.NotFound($"{{EntityName}} with ID {id} not found");
            }

            return Results.Ok(result);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving {{EntityName}} {Id}", id);
            return Results.Problem(
                title: "Error retrieving {{EntityName}}",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    /// <summary>
    /// Creates a new {{EntityName}}.
    /// </summary>
    private static async Task<IResult> Create(
        [FromBody] Create{{EntityName}}Request request,
        HttpContext context,
        IMessageBus messageBus,
        ILogger<Program> logger)
    {
        try
        {
            var command = new Create{{EntityName}}Command(
                request.{{PropertyName}},
                request.{{SecondPropertyName}},
                context.User.Identity?.Name ?? "Anonymous");

            var result = await messageBus.InvokeAsync<{{EntityName}}Response>(command);

            return Results.CreatedAtRoute(
                "Get{{EntityName}}ById",
                new { id = result.Id },
                result);
        }
        catch (ValidationException ex)
        {
            logger.LogWarning(ex, "Validation failed for {{EntityName}} creation");
            return Results.ValidationProblem(ex.Errors);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating {{EntityName}}");
            return Results.Problem(
                title: "Error creating {{EntityName}}",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    /// <summary>
    /// Updates an existing {{EntityName}}.
    /// </summary>
    private static async Task<IResult> Update(
        Guid id,
        [FromBody] Update{{EntityName}}Request request,
        HttpContext context,
        IMessageBus messageBus,
        ILogger<Program> logger)
    {
        try
        {
            var command = new Update{{EntityName}}Command(
                id,
                request.{{PropertyName}},
                request.{{SecondPropertyName}},
                context.User.Identity?.Name ?? "Anonymous");

            var result = await messageBus.InvokeAsync<{{EntityName}}Response?>(command);

            if (result == null)
            {
                logger.LogWarning("{{EntityName}} with ID {Id} not found for update", id);
                return Results.NotFound($"{{EntityName}} with ID {id} not found");
            }

            return Results.Ok(result);
        }
        catch (ValidationException ex)
        {
            logger.LogWarning(ex, "Validation failed for {{EntityName}} update");
            return Results.ValidationProblem(ex.Errors);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating {{EntityName}} {Id}", id);
            return Results.Problem(
                title: "Error updating {{EntityName}}",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    /// <summary>
    /// Deletes a {{EntityName}}.
    /// </summary>
    private static async Task<IResult> Delete(
        Guid id,
        HttpContext context,
        IMessageBus messageBus,
        ILogger<Program> logger)
    {
        try
        {
            var command = new Delete{{EntityName}}Command(
                id,
                context.User.Identity?.Name ?? "Anonymous");

            var success = await messageBus.InvokeAsync<bool>(command);

            if (!success)
            {
                logger.LogWarning("{{EntityName}} with ID {Id} not found for deletion", id);
                return Results.NotFound($"{{EntityName}} with ID {id} not found");
            }

            return Results.NoContent();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting {{EntityName}} {Id}", id);
            return Results.Problem(
                title: "Error deleting {{EntityName}}",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }
}

// ============================================================================
// Program.cs Integration Example
// ============================================================================

/*
 * Add to Program.cs:
 *
 * app.Map{{EntityNamePlural}}Endpoints();
 *
 * Or with version prefix:
 *
 * var v1 = app.MapGroup("/api/v1");
 * v1.Map{{EntityNamePlural}}Endpoints();
 */
