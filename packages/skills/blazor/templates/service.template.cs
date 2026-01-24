/*
 * ============================================================================
 * TEMPLATE: Blazor State Management Service
 * ============================================================================
 *
 * Purpose: Scoped service for state management with change notifications
 * Usage: Shared state across components
 *
 * Placeholders:
 * - {{ServiceName}} - Service name (e.g., AppState, UserState)
 * - {{EntityName}} - Entity name (e.g., User, Product)
 * - {{Namespace}} - Namespace (e.g., MyApp.Services)
 *
 * Lines: ~180
 */

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace {{Namespace}}.Services;

/// <summary>
/// State management service for {{EntityName}} data with change notifications.
/// Register as Scoped service in Program.cs.
/// </summary>
public interface I{{ServiceName}}
{
    // State properties
    IReadOnlyList<{{EntityName}}> Items { get; }
    {{EntityName}}? SelectedItem { get; }
    bool IsLoading { get; }
    string? ErrorMessage { get; }

    // State change event
    event Action? OnChange;

    // CRUD operations
    Task LoadAsync();
    Task<{{EntityName}}> GetByIdAsync(Guid id);
    Task CreateAsync({{EntityName}} item);
    Task UpdateAsync({{EntityName}} item);
    Task DeleteAsync(Guid id);

    // State management
    void SelectItem({{EntityName}}? item);
    void ClearSelection();
    void ClearError();
}

public class {{ServiceName}} : I{{ServiceName}}
{
    private readonly ILogger<{{ServiceName}}> _logger;
    private List<{{EntityName}}> _items = new();
    private {{EntityName}}? _selectedItem;
    private bool _isLoading;
    private string? _errorMessage;

    public {{ServiceName}}(ILogger<{{ServiceName}}> logger)
    {
        _logger = logger;
    }

    // ========================================================================
    // PUBLIC PROPERTIES
    // ========================================================================

    public IReadOnlyList<{{EntityName}}> Items => _items.AsReadOnly();

    public {{EntityName}}? SelectedItem
    {
        get => _selectedItem;
        private set
        {
            if (_selectedItem != value)
            {
                _selectedItem = value;
                NotifyStateChanged();
            }
        }
    }

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (_isLoading != value)
            {
                _isLoading = value;
                NotifyStateChanged();
            }
        }
    }

    public string? ErrorMessage
    {
        get => _errorMessage;
        private set
        {
            if (_errorMessage != value)
            {
                _errorMessage = value;
                NotifyStateChanged();
            }
        }
    }

    public event Action? OnChange;

    // ========================================================================
    // DATA OPERATIONS
    // ========================================================================

    public async Task LoadAsync()
    {
        try
        {
            IsLoading = true;
            ErrorMessage = null;

            _logger.LogInformation("Loading {{EntityName}} data");

            // Simulate API call
            await Task.Delay(500);

            // TODO: Replace with actual data service call
            // _items = await dataService.GetAllAsync();
            _items = GenerateSampleData();

            _logger.LogInformation("Loaded {Count} {{EntityName}} items", _items.Count);

            NotifyStateChanged();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error loading {{EntityName}} data");
            ErrorMessage = "Failed to load data";
        }
        finally
        {
            IsLoading = false;
        }
    }

    public async Task<{{EntityName}}> GetByIdAsync(Guid id)
    {
        try
        {
            _logger.LogInformation("Fetching {{EntityName}} {Id}", id);

            var item = _items.FirstOrDefault(x => x.Id == id);
            if (item == null)
            {
                throw new InvalidOperationException($"{{EntityName}} with ID {id} not found");
            }

            return await Task.FromResult(item);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching {{EntityName}} {Id}", id);
            ErrorMessage = $"Failed to fetch {{EntityName}}";
            throw;
        }
    }

    public async Task CreateAsync({{EntityName}} item)
    {
        try
        {
            _logger.LogInformation("Creating new {{EntityName}}");

            // Validate
            if (string.IsNullOrWhiteSpace(item.Name))
            {
                throw new ArgumentException("Name is required");
            }

            // TODO: Replace with actual data service call
            // await dataService.CreateAsync(item);
            await Task.Delay(300);

            item.Id = Guid.NewGuid();
            item.CreatedAt = DateTime.UtcNow;
            _items.Add(item);

            _logger.LogInformation("Created {{EntityName}} {Id}", item.Id);

            NotifyStateChanged();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating {{EntityName}}");
            ErrorMessage = "Failed to create {{EntityName}}";
            throw;
        }
    }

    public async Task UpdateAsync({{EntityName}} item)
    {
        try
        {
            _logger.LogInformation("Updating {{EntityName}} {Id}", item.Id);

            var existing = _items.FirstOrDefault(x => x.Id == item.Id);
            if (existing == null)
            {
                throw new InvalidOperationException($"{{EntityName}} with ID {item.Id} not found");
            }

            // TODO: Replace with actual data service call
            // await dataService.UpdateAsync(item);
            await Task.Delay(300);

            existing.Name = item.Name;
            existing.Email = item.Email;
            existing.Status = item.Status;
            existing.Notes = item.Notes;
            existing.UpdatedAt = DateTime.UtcNow;

            _logger.LogInformation("Updated {{EntityName}} {Id}", item.Id);

            NotifyStateChanged();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating {{EntityName}} {Id}", item.Id);
            ErrorMessage = "Failed to update {{EntityName}}";
            throw;
        }
    }

    public async Task DeleteAsync(Guid id)
    {
        try
        {
            _logger.LogInformation("Deleting {{EntityName}} {Id}", id);

            var item = _items.FirstOrDefault(x => x.Id == id);
            if (item == null)
            {
                throw new InvalidOperationException($"{{EntityName}} with ID {id} not found");
            }

            // TODO: Replace with actual data service call
            // await dataService.DeleteAsync(id);
            await Task.Delay(300);

            _items.Remove(item);

            if (_selectedItem?.Id == id)
            {
                _selectedItem = null;
            }

            _logger.LogInformation("Deleted {{EntityName}} {Id}", id);

            NotifyStateChanged();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting {{EntityName}} {Id}", id);
            ErrorMessage = "Failed to delete {{EntityName}}";
            throw;
        }
    }

    // ========================================================================
    // STATE MANAGEMENT
    // ========================================================================

    public void SelectItem({{EntityName}}? item)
    {
        SelectedItem = item;
    }

    public void ClearSelection()
    {
        SelectedItem = null;
    }

    public void ClearError()
    {
        ErrorMessage = null;
    }

    private void NotifyStateChanged()
    {
        OnChange?.Invoke();
    }

    // ========================================================================
    // SAMPLE DATA (Remove in production)
    // ========================================================================

    private List<{{EntityName}}> GenerateSampleData()
    {
        return new List<{{EntityName}}>
        {
            new() { Id = Guid.NewGuid(), Name = "Sample 1", Email = "sample1@example.com", Status = "Active", CreatedAt = DateTime.UtcNow.AddDays(-10) },
            new() { Id = Guid.NewGuid(), Name = "Sample 2", Email = "sample2@example.com", Status = "Active", CreatedAt = DateTime.UtcNow.AddDays(-5) },
            new() { Id = Guid.NewGuid(), Name = "Sample 3", Email = "sample3@example.com", Status = "Inactive", CreatedAt = DateTime.UtcNow.AddDays(-2) }
        };
    }
}

// ============================================================================
// MODEL
// ============================================================================

public class {{EntityName}}
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Status { get; set; } = "Active";
    public string Notes { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

// ============================================================================
// REGISTRATION (Program.cs)
// ============================================================================

/*
 * Add to Program.cs:
 *
 * builder.Services.AddScoped<I{{ServiceName}}, {{ServiceName}}>();
 *
 *
 * Component usage:
 *
 * @inject I{{ServiceName}} {{ServiceName}}
 * @implements IDisposable
 *
 * @code {
 *     protected override async Task OnInitializedAsync()
 *     {
 *         {{ServiceName}}.OnChange += StateHasChanged;
 *         await {{ServiceName}}.LoadAsync();
 *     }
 *
 *     public void Dispose()
 *     {
 *         {{ServiceName}}.OnChange -= StateHasChanged;
 *     }
 * }
 */
