using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using {{Namespace}}.Commands;
using {{Namespace}}.Queries;
using {{Namespace}}.DTOs;
using Wolverine;

namespace {{Namespace}}.Controllers;

/// <summary>
/// API controller for managing {{EntityNamePlural}}.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class {{EntityNamePlural}}Controller : ControllerBase
{
    private readonly IMessageBus _messageBus;
    private readonly ILogger<{{EntityNamePlural}}Controller> _logger;

    public {{EntityNamePlural}}Controller(
        IMessageBus messageBus,
        ILogger<{{EntityNamePlural}}Controller> logger)
    {
        _messageBus = messageBus;
        _logger = logger;
    }

    /// <summary>
    /// Retrieves a paginated list of {{EntityNamePlural}}.
    /// </summary>
    /// <param name="query">Query parameters for filtering and pagination</param>
    /// <returns>Paginated list of {{EntityNamePlural}}</returns>
    [HttpGet]
    [ProducesResponseType(typeof(PagedResult<{{EntityName}}Response>), StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<{{EntityName}}Response>>> GetAll(
        [FromQuery] Get{{EntityNamePlural}}Query query)
    {
        try
        {
            var result = await _messageBus.InvokeAsync<PagedResult<{{EntityName}}Response>>(query);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving {{EntityNamePlural}}");
            return StatusCode(StatusCodes.Status500InternalServerError,
                "An error occurred while retrieving {{EntityNamePlural}}");
        }
    }

    /// <summary>
    /// Retrieves a specific {{EntityName}} by ID.
    /// </summary>
    /// <param name="id">The {{EntityName}} identifier</param>
    /// <returns>The requested {{EntityName}}</returns>
    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof({{EntityName}}Response), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<{{EntityName}}Response>> GetById(Guid id)
    {
        try
        {
            var query = new Get{{EntityName}}ByIdQuery(id);
            var result = await _messageBus.InvokeAsync<{{EntityName}}Response?>(query);

            if (result == null)
            {
                _logger.LogWarning("{{EntityName}} with ID {Id} not found", id);
                return NotFound($"{{EntityName}} with ID {id} not found");
            }

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error retrieving {{EntityName}} {Id}", id);
            return StatusCode(StatusCodes.Status500InternalServerError,
                "An error occurred while retrieving the {{EntityName}}");
        }
    }

    /// <summary>
    /// Creates a new {{EntityName}}.
    /// </summary>
    /// <param name="request">The {{EntityName}} creation request</param>
    /// <returns>The created {{EntityName}}</returns>
    [HttpPost]
    [ProducesResponseType(typeof({{EntityName}}Response), StatusCodes.Status201Created)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<{{EntityName}}Response>> Create(
        [FromBody] Create{{EntityName}}Request request)
    {
        try
        {
            var command = new Create{{EntityName}}Command(
                request.{{PropertyName}},
                request.{{SecondPropertyName}},
                User.Identity?.Name ?? "Anonymous");

            var result = await _messageBus.InvokeAsync<{{EntityName}}Response>(command);

            return CreatedAtAction(
                nameof(GetById),
                new { id = result.Id },
                result);
        }
        catch (ValidationException ex)
        {
            _logger.LogWarning(ex, "Validation failed for {{EntityName}} creation");
            return BadRequest(new ValidationProblemDetails(ex.Errors));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating {{EntityName}}");
            return StatusCode(StatusCodes.Status500InternalServerError,
                "An error occurred while creating the {{EntityName}}");
        }
    }

    /// <summary>
    /// Updates an existing {{EntityName}}.
    /// </summary>
    /// <param name="id">The {{EntityName}} identifier</param>
    /// <param name="request">The {{EntityName}} update request</param>
    /// <returns>The updated {{EntityName}}</returns>
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof({{EntityName}}Response), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ValidationProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<{{EntityName}}Response>> Update(
        Guid id,
        [FromBody] Update{{EntityName}}Request request)
    {
        try
        {
            var command = new Update{{EntityName}}Command(
                id,
                request.{{PropertyName}},
                request.{{SecondPropertyName}},
                User.Identity?.Name ?? "Anonymous");

            var result = await _messageBus.InvokeAsync<{{EntityName}}Response?>(command);

            if (result == null)
            {
                _logger.LogWarning("{{EntityName}} with ID {Id} not found for update", id);
                return NotFound($"{{EntityName}} with ID {id} not found");
            }

            return Ok(result);
        }
        catch (ValidationException ex)
        {
            _logger.LogWarning(ex, "Validation failed for {{EntityName}} update");
            return BadRequest(new ValidationProblemDetails(ex.Errors));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating {{EntityName}} {Id}", id);
            return StatusCode(StatusCodes.Status500InternalServerError,
                "An error occurred while updating the {{EntityName}}");
        }
    }

    /// <summary>
    /// Deletes a {{EntityName}}.
    /// </summary>
    /// <param name="id">The {{EntityName}} identifier</param>
    /// <returns>No content on success</returns>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id)
    {
        try
        {
            var command = new Delete{{EntityName}}Command(
                id,
                User.Identity?.Name ?? "Anonymous");

            var success = await _messageBus.InvokeAsync<bool>(command);

            if (!success)
            {
                _logger.LogWarning("{{EntityName}} with ID {Id} not found for deletion", id);
                return NotFound($"{{EntityName}} with ID {id} not found");
            }

            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting {{EntityName}} {Id}", id);
            return StatusCode(StatusCodes.Status500InternalServerError,
                "An error occurred while deleting the {{EntityName}}");
        }
    }
}

// ============================================================================
// DTOs (Request/Response models)
// ============================================================================

namespace {{Namespace}}.DTOs;

/// <summary>
/// Response model for {{EntityName}}.
/// </summary>
public record {{EntityName}}Response(
    Guid Id,
    string {{PropertyName}},
    string {{SecondPropertyName}},
    DateTime CreatedAt,
    DateTime? UpdatedAt);

/// <summary>
/// Request model for creating a {{EntityName}}.
/// </summary>
public record Create{{EntityName}}Request(
    string {{PropertyName}},
    string {{SecondPropertyName}});

/// <summary>
/// Request model for updating a {{EntityName}}.
/// </summary>
public record Update{{EntityName}}Request(
    string {{PropertyName}},
    string {{SecondPropertyName}});

/// <summary>
/// Paginated result wrapper.
/// </summary>
public record PagedResult<T>(
    IEnumerable<T> Items,
    int TotalCount,
    int Page,
    int PageSize);
