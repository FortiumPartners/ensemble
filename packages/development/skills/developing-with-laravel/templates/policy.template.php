<?php
/**
 * Policy Template
 *
 * Template Variables:
 *   model: Model name (e.g., "Contact")
 *   model_variable: Lowercase (e.g., "contact")
 *   user_model: User model class (default: User)
 *   abilities: Array of policy methods to generate
 *   use_permissions: Use spatie/laravel-permission
 *   tenant_check: Include tenant isolation check
 *
 * Output: app/Policies/{{ model }}Policy.php
 */

declare(strict_types=1);

namespace App\Policies;

use App\Models\{{ model }};
use App\Models\{{ user_model | default('User') }};
use Illuminate\Auth\Access\Response;

class {{ model }}Policy
{
    /**
     * Perform pre-authorization checks.
     */
    public function before({{ user_model | default('User') }} $user, string $ability): ?bool
    {
        {% if use_permissions %}
        // Admins bypass all checks
        if ($user->hasRole('admin')) {
            return true;
        }
        {% endif %}

        return null;
    }

    /**
     * Determine whether the user can view any models.
     */
    public function viewAny({{ user_model | default('User') }} $user): bool
    {
        {% if use_permissions %}
        return $user->hasPermissionTo('{{ model_variable | lower }}.view');
        {% else %}
        return true;
        {% endif %}
    }

    /**
     * Determine whether the user can view the model.
     */
    public function view({{ user_model | default('User') }} $user, {{ model }} ${{ model_variable }}): bool
    {
        {% if use_permissions %}
        if (!$user->hasPermissionTo('{{ model_variable | lower }}.view')) {
            return false;
        }
        {% endif %}

        {% if tenant_check %}
        // Tenant isolation
        if (${{ model_variable }}->tenant_id !== $user->tenant_id) {
            return false;
        }
        {% endif %}

        return true;
    }

    /**
     * Determine whether the user can create models.
     */
    public function create({{ user_model | default('User') }} $user): bool
    {
        {% if use_permissions %}
        return $user->hasPermissionTo('{{ model_variable | lower }}.create');
        {% else %}
        return true;
        {% endif %}
    }

    /**
     * Determine whether the user can update the model.
     */
    public function update({{ user_model | default('User') }} $user, {{ model }} ${{ model_variable }}): bool
    {
        {% if use_permissions %}
        if (!$user->hasPermissionTo('{{ model_variable | lower }}.edit')) {
            return false;
        }
        {% endif %}

        {% if tenant_check %}
        if (${{ model_variable }}->tenant_id !== $user->tenant_id) {
            return false;
        }
        {% endif %}

        return true;
    }

    /**
     * Determine whether the user can delete the model.
     */
    public function delete({{ user_model | default('User') }} $user, {{ model }} ${{ model_variable }}): bool
    {
        {% if use_permissions %}
        if (!$user->hasPermissionTo('{{ model_variable | lower }}.delete')) {
            return false;
        }
        {% endif %}

        {% if tenant_check %}
        if (${{ model_variable }}->tenant_id !== $user->tenant_id) {
            return false;
        }
        {% endif %}

        return true;
    }

    /**
     * Determine whether the user can restore the model.
     */
    public function restore({{ user_model | default('User') }} $user, {{ model }} ${{ model_variable }}): bool
    {
        {% if use_permissions %}
        return $user->hasPermissionTo('{{ model_variable | lower }}.restore');
        {% else %}
        return $this->delete($user, ${{ model_variable }});
        {% endif %}
    }

    /**
     * Determine whether the user can permanently delete the model.
     */
    public function forceDelete({{ user_model | default('User') }} $user, {{ model }} ${{ model_variable }}): bool
    {
        {% if use_permissions %}
        return $user->hasRole('admin');
        {% else %}
        return false;
        {% endif %}
    }
}
