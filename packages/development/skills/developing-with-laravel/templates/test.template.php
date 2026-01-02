<?php
/**
 * Feature Test Template
 *
 * Template Variables:
 *   name: Test class name (e.g., "ContactApiTest")
 *   model: Model being tested
 *   route_prefix: API route prefix
 *   auth_required: Whether routes require authentication
 *   test_cases: Array of test method definitions
 *
 * Output: tests/Feature/{{ name }}.php
 */

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\{{ model }};
use App\Models\User;
{% for import in imports %}
use {{ import }};
{% endfor %}
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithFaker;
use Tests\TestCase;

class {{ name }} extends TestCase
{
    use RefreshDatabase, WithFaker;

    {% if auth_required %}
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();
        {% if tenant_setup %}

        // Set up tenant context
        $this->tenant = Tenant::factory()->create();
        $this->user->tenant_id = $this->tenant->id;
        $this->user->save();
        session(['tenant_id' => $this->tenant->id]);
        {% endif %}
    }

    {% endif %}
    // =========================================================================
    // Index / List Tests
    // =========================================================================

    public function test_can_list_{{ model | lower }}s(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        {{ model }}::factory()->count(3)->create({% if tenant_setup %}['tenant_id' => $this->tenant->id]{% endif %});

        $response = $this->getJson('{{ route_prefix | default('/api') }}/{{ model | lower }}s');

        $response->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonStructure([
                'data' => [
                    '*' => ['id', 'name', 'created_at'],
                ],
            ]);
    }

    public function test_can_filter_{{ model | lower }}s(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        {{ model }}::factory()->create(['status' => 'active'{% if tenant_setup %}, 'tenant_id' => $this->tenant->id{% endif %}]);
        {{ model }}::factory()->create(['status' => 'inactive'{% if tenant_setup %}, 'tenant_id' => $this->tenant->id{% endif %}]);

        $response = $this->getJson('{{ route_prefix | default('/api') }}/{{ model | lower }}s?status=active');

        $response->assertOk()
            ->assertJsonCount(1, 'data');
    }

    // =========================================================================
    // Show Tests
    // =========================================================================

    public function test_can_show_{{ model | lower }}(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        ${{ model | lower }} = {{ model }}::factory()->create({% if tenant_setup %}['tenant_id' => $this->tenant->id]{% endif %});

        $response = $this->getJson("{{ route_prefix | default('/api') }}/{{ model | lower }}s/{${{ model | lower }}->id}");

        $response->assertOk()
            ->assertJson([
                'data' => [
                    'id' => ${{ model | lower }}->id,
                ],
            ]);
    }

    public function test_returns_404_for_nonexistent_{{ model | lower }}(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        $response = $this->getJson('{{ route_prefix | default('/api') }}/{{ model | lower }}s/99999');

        $response->assertNotFound();
    }

    // =========================================================================
    // Store Tests
    // =========================================================================

    public function test_can_create_{{ model | lower }}(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        $data = [
            'name' => $this->faker->name(),
            'email' => $this->faker->email(),
        ];

        $response = $this->postJson('{{ route_prefix | default('/api') }}/{{ model | lower }}s', $data);

        $response->assertCreated()
            ->assertJsonPath('data.name', $data['name']);

        $this->assertDatabaseHas('{{ model | lower }}s', [
            'email' => $data['email'],
        ]);
    }

    public function test_validates_required_fields_on_create(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        $response = $this->postJson('{{ route_prefix | default('/api') }}/{{ model | lower }}s', []);

        $response->assertUnprocessable()
            ->assertJsonValidationErrors(['name', 'email']);
    }

    // =========================================================================
    // Update Tests
    // =========================================================================

    public function test_can_update_{{ model | lower }}(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        ${{ model | lower }} = {{ model }}::factory()->create({% if tenant_setup %}['tenant_id' => $this->tenant->id]{% endif %});

        $response = $this->putJson(
            "{{ route_prefix | default('/api') }}/{{ model | lower }}s/{${{ model | lower }}->id}",
            ['name' => 'Updated Name']
        );

        $response->assertOk()
            ->assertJsonPath('data.name', 'Updated Name');
    }

    // =========================================================================
    // Delete Tests
    // =========================================================================

    public function test_can_delete_{{ model | lower }}(): void
    {
        {% if auth_required %}
        $this->actingAs($this->user);

        {% endif %}
        ${{ model | lower }} = {{ model }}::factory()->create({% if tenant_setup %}['tenant_id' => $this->tenant->id]{% endif %});

        $response = $this->deleteJson("{{ route_prefix | default('/api') }}/{{ model | lower }}s/{${{ model | lower }}->id}");

        $response->assertNoContent();

        {% if soft_deletes %}
        $this->assertSoftDeleted('{{ model | lower }}s', ['id' => ${{ model | lower }}->id]);
        {% else %}
        $this->assertDatabaseMissing('{{ model | lower }}s', ['id' => ${{ model | lower }}->id]);
        {% endif %}
    }

    {% if auth_required %}
    // =========================================================================
    // Authorization Tests
    // =========================================================================

    public function test_unauthenticated_user_cannot_access_{{ model | lower }}s(): void
    {
        $response = $this->getJson('{{ route_prefix | default('/api') }}/{{ model | lower }}s');

        $response->assertUnauthorized();
    }

    {% if tenant_setup %}
    public function test_cannot_access_other_tenant_{{ model | lower }}(): void
    {
        $this->actingAs($this->user);

        $otherTenant = Tenant::factory()->create();
        ${{ model | lower }} = {{ model }}::factory()->create(['tenant_id' => $otherTenant->id]);

        $response = $this->getJson("{{ route_prefix | default('/api') }}/{{ model | lower }}s/{${{ model | lower }}->id}");

        $response->assertNotFound();
    }
    {% endif %}
    {% endif %}
}

/**
 * Running tests:
 *
 * # Run this test file
 * php artisan test tests/Feature/{{ name }}.php
 *
 * # Run specific test
 * php artisan test --filter=test_can_create_{{ model | lower }}
 *
 * # Run with coverage
 * php artisan test --coverage
 */
