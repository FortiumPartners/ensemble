<?php
/**
 * Form Request Template
 *
 * Template Variables:
 *   name: Request class name (e.g., "StoreContactRequest")
 *   model: Associated model name
 *   rules: Array of field => rules
 *   messages: Custom validation messages
 *   authorize_method: Authorization logic
 *   prepare_method: Data preparation logic
 *
 * Output: app/Http/Requests/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
{% if has_enum_rules %}
use App\Enums\{{ enum_name }};
{% endif %}

class {{ name }} extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        {% if authorize_method %}
        {{ authorize_method }}
        {% else %}
        return true;
        {% endif %}
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        {% if is_update_request %}
        ${{ model_variable }}Id = $this->route('{{ model_variable }}')?->id;

        {% endif %}
        return [
            {% for field, rule in rules %}
            '{{ field }}' => [{{ rule }}],
            {% endfor %}
        ];
    }

    /**
     * Get custom messages for validator errors.
     *
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            {% for key, message in messages %}
            '{{ key }}' => '{{ message }}',
            {% endfor %}
        ];
    }

    /**
     * Get custom attributes for validator errors.
     *
     * @return array<string, string>
     */
    public function attributes(): array
    {
        return [
            {% for field, label in attributes %}
            '{{ field }}' => '{{ label }}',
            {% endfor %}
        ];
    }

    {% if prepare_method %}
    /**
     * Prepare the data for validation.
     */
    protected function prepareForValidation(): void
    {
        {{ prepare_method }}
    }
    {% endif %}

    {% if after_validation %}
    /**
     * Configure the validator instance.
     */
    public function withValidator(\Illuminate\Validation\Validator $validator): void
    {
        $validator->after(function ($validator) {
            {{ after_validation }}
        });
    }
    {% endif %}
}
