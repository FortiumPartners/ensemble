<?php
/**
 * Enum Class Template
 *
 * Template Variables:
 *   name: Enum name (e.g., "Status")
 *   cases: Array of cases [{name, value, label}]
 *   backed_type: "string" | "int"
 *   with_trait: boolean - Include EnumTrait
 *   with_labels: boolean - Include label() method
 *
 * Output: src/Enums/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Enums;

{% if with_trait | default(true) %}
interface EnumInterface
{
    public static function values(): array;
    public static function names(): array;
    public static function toArray(): array;
    public static function isValid({{ backed_type | default('string') }} $value): bool;
}

trait EnumTrait
{
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }

    public static function names(): array
    {
        return array_column(self::cases(), 'name');
    }

    public static function toArray(): array
    {
        return array_combine(self::names(), self::values());
    }

    public static function isValid({{ backed_type | default('string') }} $value): bool
    {
        return in_array($value, self::values(), true);
    }

    public static function fromName(string $name): ?self
    {
        foreach (self::cases() as $case) {
            if ($case->name === $name) {
                return $case;
            }
        }
        return null;
    }

    public static function toSelectOptions(): array
    {
        return array_map(
            fn(self $case): array => [
                'value' => $case->value,
                'label' => method_exists($case, 'label') ? $case->label() : $case->name,
            ],
            self::cases()
        );
    }
}

{% endif %}
enum {{ name }}: {{ backed_type | default('string') }}{% if with_trait | default(true) %} implements EnumInterface{% endif %}

{
    {% if with_trait | default(true) %}
    use EnumTrait;

    {% endif %}
    {% for case in cases %}
    case {{ case.name }} = {% if backed_type == 'int' %}{{ case.value }}{% else %}'{{ case.value }}'{% endif %};
    {% endfor %}

    {% if with_labels | default(true) %}
    /**
     * Get human-readable label
     */
    public function label(): string
    {
        return match ($this) {
            {% for case in cases %}
            self::{{ case.name }} => '{{ case.label | default(case.name) }}',
            {% endfor %}
        };
    }
    {% endif %}

    /**
     * Get description for documentation
     */
    public function description(): string
    {
        return match ($this) {
            {% for case in cases %}
            self::{{ case.name }} => '{{ case.description | default('') }}',
            {% endfor %}
        };
    }

    /**
     * Check if this case equals any of the given cases
     */
    public function in(self ...$cases): bool
    {
        return in_array($this, $cases, true);
    }

    /**
     * Get cases that are considered "active" or similar business logic grouping
     */
    public static function active(): array
    {
        // TODO: Customize based on business logic
        return self::cases();
    }
}

// =============================================================================
// Usage Examples:
// =============================================================================
//
// {{ name }}::{{ cases[0].name }}->value;           // '{{ cases[0].value }}'
// {{ name }}::{{ cases[0].name }}->name;            // '{{ cases[0].name }}'
// {{ name }}::{{ cases[0].name }}->label();         // '{{ cases[0].label | default(cases[0].name) }}'
//
// {{ name }}::cases();                              // Array of all cases
// {{ name }}::values();                             // Array of all values
// {{ name }}::names();                              // Array of all names
// {{ name }}::toArray();                            // [name => value, ...]
// {{ name }}::isValid('{{ cases[0].value }}');      // true
// {{ name }}::from('{{ cases[0].value }}');         // {{ name }}::{{ cases[0].name }}
// {{ name }}::tryFrom('invalid');                   // null
// {{ name }}::toSelectOptions();                    // For HTML selects
