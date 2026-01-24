using System.ComponentModel.DataAnnotations;

namespace {{Namespace}}.Entities;

/// <summary>
/// Represents a {{EntityName}} entity in the system.
/// </summary>
public class {{EntityName}}
{
    /// <summary>
    /// Unique identifier for the {{EntityName}}.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// {{PropertyName}} of the {{EntityName}}.
    /// </summary>
    [Required]
    [MaxLength(200)]
    public string {{PropertyName}} { get; set; } = string.Empty;

    /// <summary>
    /// {{SecondPropertyName}} of the {{EntityName}}.
    /// </summary>
    [MaxLength(500)]
    public string {{SecondPropertyName}} { get; set; } = string.Empty;

    /// <summary>
    /// Timestamp when the {{EntityName}} was created.
    /// </summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// User who created the {{EntityName}}.
    /// </summary>
    [MaxLength(100)]
    public string CreatedBy { get; set; } = string.Empty;

    /// <summary>
    /// Timestamp when the {{EntityName}} was last updated.
    /// </summary>
    public DateTime? UpdatedAt { get; set; }

    /// <summary>
    /// User who last updated the {{EntityName}}.
    /// </summary>
    [MaxLength(100)]
    public string? UpdatedBy { get; set; }

    /// <summary>
    /// Soft delete flag.
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>
    /// Timestamp when the {{EntityName}} was deleted.
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>
    /// User who deleted the {{EntityName}}.
    /// </summary>
    [MaxLength(100)]
    public string? DeletedBy { get; set; }

    // ============================================================================
    // Navigation Properties
    // ============================================================================

    // TODO: Add navigation properties for related entities
    // Example: public List<RelatedEntity> RelatedEntities { get; set; } = new();

    // ============================================================================
    // Domain Methods
    // ============================================================================

    /// <summary>
    /// Creates a new {{EntityName}} instance.
    /// </summary>
    public static {{EntityName}} Create(
        string {{propertyName}},
        string {{secondPropertyName}},
        string createdBy)
    {
        if (string.IsNullOrWhiteSpace({{propertyName}}))
            throw new ArgumentException("{{PropertyName}} cannot be empty", nameof({{propertyName}}));

        if (string.IsNullOrWhiteSpace(createdBy))
            throw new ArgumentException("CreatedBy cannot be empty", nameof(createdBy));

        return new {{EntityName}}
        {
            Id = Guid.NewGuid(),
            {{PropertyName}} = {{propertyName}}.Trim(),
            {{SecondPropertyName}} = {{secondPropertyName}}?.Trim() ?? string.Empty,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = createdBy,
            IsDeleted = false
        };
    }

    /// <summary>
    /// Updates the {{EntityName}} properties.
    /// </summary>
    public void Update(
        string {{propertyName}},
        string {{secondPropertyName}},
        string updatedBy)
    {
        if (string.IsNullOrWhiteSpace({{propertyName}}))
            throw new ArgumentException("{{PropertyName}} cannot be empty", nameof({{propertyName}}));

        if (string.IsNullOrWhiteSpace(updatedBy))
            throw new ArgumentException("UpdatedBy cannot be empty", nameof(updatedBy));

        {{PropertyName}} = {{propertyName}}.Trim();
        {{SecondPropertyName}} = {{secondPropertyName}}?.Trim() ?? string.Empty;
        UpdatedAt = DateTime.UtcNow;
        UpdatedBy = updatedBy;
    }

    /// <summary>
    /// Soft deletes the {{EntityName}}.
    /// </summary>
    public void Delete(string deletedBy)
    {
        if (string.IsNullOrWhiteSpace(deletedBy))
            throw new ArgumentException("DeletedBy cannot be empty", nameof(deletedBy));

        IsDeleted = true;
        DeletedAt = DateTime.UtcNow;
        DeletedBy = deletedBy;
    }

    /// <summary>
    /// Restores a soft-deleted {{EntityName}}.
    /// </summary>
    public void Restore()
    {
        IsDeleted = false;
        DeletedAt = null;
        DeletedBy = null;
    }

    /// <summary>
    /// Validates the entity state.
    /// </summary>
    public bool IsValid(out List<string> errors)
    {
        errors = new List<string>();

        if (string.IsNullOrWhiteSpace({{PropertyName}}))
            errors.Add("{{PropertyName}} is required");

        if ({{PropertyName}}?.Length > 200)
            errors.Add("{{PropertyName}} cannot exceed 200 characters");

        if ({{SecondPropertyName}}?.Length > 500)
            errors.Add("{{SecondPropertyName}} cannot exceed 500 characters");

        if (string.IsNullOrWhiteSpace(CreatedBy))
            errors.Add("CreatedBy is required");

        return errors.Count == 0;
    }
}

// ============================================================================
// MartenDB Configuration (if using MartenDB)
// ============================================================================

/*
 * Add to MartenDB configuration:
 *
 * opts.Schema.For<{{EntityName}}>()
 *     .Identity(x => x.Id)
 *     .Index(x => x.{{PropertyName}})
 *     .Index(x => x.CreatedAt)
 *     .Index(x => x.IsDeleted)
 *     .SoftDeleted()
 *     .UseOptimisticConcurrency(true);
 */

// ============================================================================
// Entity Framework Core Configuration (if using EF Core)
// ============================================================================

/*
 * Create a configuration class:
 *
 * public class {{EntityName}}Configuration : IEntityTypeConfiguration<{{EntityName}}>
 * {
 *     public void Configure(EntityTypeBuilder<{{EntityName}}> builder)
 *     {
 *         builder.ToTable("{{EntityNamePlural}}");
 *
 *         builder.HasKey(e => e.Id);
 *
 *         builder.Property(e => e.{{PropertyName}})
 *             .IsRequired()
 *             .HasMaxLength(200);
 *
 *         builder.Property(e => e.{{SecondPropertyName}})
 *             .HasMaxLength(500);
 *
 *         builder.Property(e => e.CreatedBy)
 *             .IsRequired()
 *             .HasMaxLength(100);
 *
 *         builder.HasIndex(e => e.{{PropertyName}});
 *         builder.HasIndex(e => e.CreatedAt);
 *         builder.HasIndex(e => e.IsDeleted);
 *
 *         builder.HasQueryFilter(e => !e.IsDeleted);
 *     }
 * }
 */
