<?php
/**
 * Database Seeder Template
 *
 * Template Variables:
 *   name: Seeder class name (e.g., "ContactSeeder")
 *   model: Model to seed
 *   count: Number of records to create
 *   truncate: Whether to truncate before seeding
 *   dependencies: Other seeders to call first
 *   custom_data: Array of specific records to create
 *
 * Output: database/seeders/{{ name }}.php
 */

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\{{ model }};
{% for import in imports %}
use {{ import }};
{% endfor %}
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class {{ name }} extends Seeder
{
    use WithoutModelEvents;

    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        {% if truncate %}
        // Truncate existing data
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        {{ model }}::truncate();
        DB::statement('SET FOREIGN_KEY_CHECKS=1');

        {% endif %}
        {% if dependencies %}
        // Run dependent seeders first
        $this->call([
            {% for dep in dependencies %}
            {{ dep }}::class,
            {% endfor %}
        ]);

        {% endif %}
        {% if custom_data %}
        // Create specific records
        {% for record in custom_data %}
        {{ model }}::create([
            {% for key, value in record %}
            '{{ key }}' => {{ value }},
            {% endfor %}
        ]);

        {% endfor %}
        {% endif %}

        {% if count %}
        // Create factory records
        {% if states %}
        // Mixed states
        {% for state in states %}
        {{ model }}::factory()
            ->count({{ state.count }})
            ->{{ state.name }}()
            ->create();

        {% endfor %}
        {% else %}
        {{ model }}::factory()
            ->count({{ count }})
            {% if relationships %}
            {% for rel in relationships %}
            ->has({{ rel.model }}::factory()->count({{ rel.count }}))
            {% endfor %}
            {% endif %}
            ->create();
        {% endif %}
        {% endif %}

        $this->command->info('{{ model }} seeding completed.');
    }
}

/**
 * Usage:
 *
 * # Run this seeder
 * php artisan db:seed --class={{ name }}
 *
 * # Run all seeders
 * php artisan db:seed
 *
 * # Fresh migration with seeding
 * php artisan migrate:fresh --seed
 *
 * Register in DatabaseSeeder:
 *
 * public function run(): void
 * {
 *     $this->call([
 *         {{ name }}::class,
 *     ]);
 * }
 */
