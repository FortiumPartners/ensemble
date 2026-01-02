<?php
/**
 * Eloquent Model Template
 *
 * Template Variables:
 *   model: Model name (e.g., "Contact")
 *   table: Database table name (optional, auto-derived)
 *   fillable: Array of fillable columns
 *   casts: Array of column => cast type
 *   relationships: Array of relationship definitions
 *   soft_deletes: boolean
 *   has_factory: boolean
 *   scopes: Array of scope definitions
 *
 * Output: app/Models/{{ model }}.php
 */

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
{% if soft_deletes %}
use Illuminate\Database\Eloquent\SoftDeletes;
{% endif %}
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class {{ model }} extends Model
{
{% if has_factory %}
    use HasFactory;
{% endif %}
{% if soft_deletes %}
    use SoftDeletes;
{% endif %}

    /**
     * The table associated with the model.
     */
    protected $table = '{{ table }}';

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        {% for column in fillable %}
        '{{ column }}',
        {% endfor %}
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        // 'password',
    ];

    /**
     * The attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            {% for column, type in casts %}
            '{{ column }}' => {{ type }},
            {% endfor %}
            'created_at' => 'datetime',
            'updated_at' => 'datetime',
            {% if soft_deletes %}
            'deleted_at' => 'datetime',
            {% endif %}
        ];
    }

    // =========================================================================
    // Relationships
    // =========================================================================

    {% for rel in relationships %}
    {% if rel.type == 'belongsTo' %}
    public function {{ rel.name }}(): BelongsTo
    {
        return $this->belongsTo({{ rel.model }}::class{% if rel.foreign_key %}, '{{ rel.foreign_key }}'{% endif %});
    }

    {% elif rel.type == 'hasMany' %}
    public function {{ rel.name }}(): HasMany
    {
        return $this->hasMany({{ rel.model }}::class{% if rel.foreign_key %}, '{{ rel.foreign_key }}'{% endif %});
    }

    {% elif rel.type == 'belongsToMany' %}
    public function {{ rel.name }}(): BelongsToMany
    {
        return $this->belongsToMany({{ rel.model }}::class{% if rel.pivot_table %}, '{{ rel.pivot_table }}'{% endif %})
            {% if rel.with_timestamps %}->withTimestamps(){% endif %}
            {% if rel.with_pivot %}->withPivot({{ rel.with_pivot | join(', ') }}){% endif %};
    }

    {% endif %}
    {% endfor %}

    // =========================================================================
    // Query Scopes
    // =========================================================================

    {% for scope in scopes %}
    /**
     * Scope: {{ scope.description | default(scope.name) }}
     */
    public function scope{{ scope.name | capitalize }}(Builder $query{% if scope.params %}, {{ scope.params }}{% endif %}): void
    {
        {{ scope.body }}
    }

    {% endfor %}

    // =========================================================================
    // Accessors & Mutators
    // =========================================================================

    // Add accessors/mutators as needed

    // =========================================================================
    // Business Logic
    // =========================================================================

    // Add business methods as needed
}
