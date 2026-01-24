<?php
/**
 * Model Factory Template
 *
 * Template Variables:
 *   model: Model class name (e.g., "Contact")
 *   namespace: Model namespace
 *   attributes: Array of attribute definitions
 *   states: Array of state definitions
 *   relationships: Factory relationship methods
 *
 * Output: database/factories/{{ model }}Factory.php
 */

declare(strict_types=1);

namespace Database\Factories;

use App\Models\{{ model }};
{% for import in imports %}
use {{ import }};
{% endfor %}
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\{{ model }}>
 */
class {{ model }}Factory extends Factory
{
    /**
     * The name of the factory's corresponding model.
     *
     * @var class-string<\Illuminate\Database\Eloquent\Model>
     */
    protected $model = {{ model }}::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            {% for attr in attributes %}
            {% if attr.type == 'name' %}
            '{{ attr.name }}' => fake()->name(),
            {% elif attr.type == 'firstName' %}
            '{{ attr.name }}' => fake()->firstName(),
            {% elif attr.type == 'lastName' %}
            '{{ attr.name }}' => fake()->lastName(),
            {% elif attr.type == 'email' %}
            '{{ attr.name }}' => fake()->unique()->safeEmail(),
            {% elif attr.type == 'phone' %}
            '{{ attr.name }}' => fake()->phoneNumber(),
            {% elif attr.type == 'company' %}
            '{{ attr.name }}' => fake()->company(),
            {% elif attr.type == 'address' %}
            '{{ attr.name }}' => fake()->address(),
            {% elif attr.type == 'city' %}
            '{{ attr.name }}' => fake()->city(),
            {% elif attr.type == 'country' %}
            '{{ attr.name }}' => fake()->country(),
            {% elif attr.type == 'sentence' %}
            '{{ attr.name }}' => fake()->sentence(),
            {% elif attr.type == 'paragraph' %}
            '{{ attr.name }}' => fake()->paragraph(),
            {% elif attr.type == 'text' %}
            '{{ attr.name }}' => fake()->text({{ attr.length | default(200) }}),
            {% elif attr.type == 'url' %}
            '{{ attr.name }}' => fake()->url(),
            {% elif attr.type == 'uuid' %}
            '{{ attr.name }}' => fake()->uuid(),
            {% elif attr.type == 'boolean' %}
            '{{ attr.name }}' => fake()->boolean({{ attr.probability | default(50) }}),
            {% elif attr.type == 'integer' %}
            '{{ attr.name }}' => fake()->numberBetween({{ attr.min | default(1) }}, {{ attr.max | default(100) }}),
            {% elif attr.type == 'decimal' %}
            '{{ attr.name }}' => fake()->randomFloat(2, {{ attr.min | default(0) }}, {{ attr.max | default(1000) }}),
            {% elif attr.type == 'date' %}
            '{{ attr.name }}' => fake()->date(),
            {% elif attr.type == 'datetime' %}
            '{{ attr.name }}' => fake()->dateTime(),
            {% elif attr.type == 'pastDate' %}
            '{{ attr.name }}' => fake()->dateTimeBetween('-1 year', 'now'),
            {% elif attr.type == 'futureDate' %}
            '{{ attr.name }}' => fake()->dateTimeBetween('now', '+1 year'),
            {% elif attr.type == 'enum' %}
            '{{ attr.name }}' => fake()->randomElement({{ attr.enum }}::cases()),
            {% elif attr.type == 'randomElement' %}
            '{{ attr.name }}' => fake()->randomElement([{{ attr.values | join(', ') }}]),
            {% elif attr.type == 'foreignId' %}
            '{{ attr.name }}' => {{ attr.related }}::factory(),
            {% elif attr.type == 'json' %}
            '{{ attr.name }}' => {{ attr.value | default('[]') }},
            {% elif attr.type == 'nullable' %}
            '{{ attr.name }}' => fake()->optional({{ attr.probability | default(0.5) }})->{{ attr.faker }}(),
            {% else %}
            '{{ attr.name }}' => {{ attr.value | default("''") }},
            {% endif %}
            {% endfor %}
        ];
    }

    {% for state in states %}
    /**
     * State: {{ state.name }}
     * {{ state.description | default('') }}
     */
    public function {{ state.name }}(): static
    {
        return $this->state(fn (array $attributes) => [
            {% for key, value in state.attributes %}
            '{{ key }}' => {{ value }},
            {% endfor %}
        ]);
    }

    {% endfor %}
    {% for rel in relationships %}
    /**
     * Configure with {{ rel.name }}.
     */
    public function with{{ rel.name | capitalize }}({% if rel.count %}int $count = {{ rel.count }}{% endif %}): static
    {
        return $this->{% if rel.type == 'has' %}has{% else %}for{% endif %}(
            {{ rel.related }}::factory(){% if rel.count %}->count($count){% endif %}{% if rel.state %}, '{{ rel.state }}'{% endif %}

        );
    }

    {% endfor %}
}

/**
 * Usage:
 *
 * // Create single instance
 * ${{ model | lower }} = {{ model }}::factory()->create();
 *
 * // Create multiple
 * ${{ model | lower }}s = {{ model }}::factory()->count(10)->create();
 *
 * // With state
 * {% for state in states %}
 * ${{ model | lower }} = {{ model }}::factory()->{{ state.name }}()->create();
 * {% endfor %}
 *
 * // With relationships
 * {% for rel in relationships %}
 * ${{ model | lower }} = {{ model }}::factory()->with{{ rel.name | capitalize }}({% if rel.count %}3{% endif %})->create();
 * {% endfor %}
 *
 * // Custom attributes
 * ${{ model | lower }} = {{ model }}::factory()->create([
 *     'name' => 'Custom Name',
 * ]);
 *
 * // Make without persisting
 * ${{ model | lower }} = {{ model }}::factory()->make();
 */
