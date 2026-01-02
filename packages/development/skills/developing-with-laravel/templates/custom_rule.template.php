<?php
/**
 * Custom Validation Rule Template
 *
 * Template Variables:
 *   name: Rule class name (e.g., "ValidPhoneNumber")
 *   message: Validation failure message
 *   validation_logic: The validation code
 *   constructor_params: Optional constructor parameters
 *
 * Output: app/Rules/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class {{ name }} implements ValidationRule
{
    {% if constructor_params %}
    public function __construct(
        {% for param in constructor_params %}
        private readonly {{ param.type }} ${{ param.name }}{% if param.default is defined %} = {{ param.default }}{% endif %},
        {% endfor %}
    ) {
    }

    {% endif %}
    /**
     * Run the validation rule.
     *
     * @param  \Closure(string, ?string=): \Illuminate\Translation\PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        {{ validation_logic }}
    }
}

/**
 * Usage Examples:
 *
 * // In form request
 * public function rules(): array
 * {
 *     return [
 *         'phone' => ['required', new {{ name }}({% if constructor_params %}{{ constructor_params | map(attribute='name') | join(': $value, ') }}{% endif %})],
 *     ];
 * }
 *
 * // Inline rule
 * Validator::make($data, [
 *     'phone' => ['required', new {{ name }}()],
 * ]);
 */
