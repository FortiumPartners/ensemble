<?php
/**
 * Permission & ACL Example (spatie/laravel-permission)
 *
 * This example demonstrates role-based access control including:
 * - Role and permission setup
 * - User role assignment
 * - Policy integration
 * - Middleware usage
 * - Blade directives
 */

declare(strict_types=1);

namespace App\Examples;

use App\Models\User;
use App\Models\Contact;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\Traits\HasRoles;

// =============================================================================
// User Model with HasRoles Trait
// =============================================================================

class User extends \Illuminate\Foundation\Auth\User
{
    use HasRoles;

    // ... other model code
}

// =============================================================================
// Seeder: Roles and Permissions Setup
// =============================================================================

class RolesAndPermissionsSeeder extends \Illuminate\Database\Seeder
{
    public function run(): void
    {
        // Reset cached roles and permissions
        app()[\Spatie\Permission\PermissionRegistrar::class]->forgetCachedPermissions();

        // Create permissions by module
        $permissions = [
            // Contacts
            'contacts.view',
            'contacts.create',
            'contacts.edit',
            'contacts.delete',
            'contacts.export',
            'contacts.import',

            // Companies
            'companies.view',
            'companies.create',
            'companies.edit',
            'companies.delete',

            // Reports
            'reports.view',
            'reports.export',
            'reports.create',

            // Users
            'users.view',
            'users.create',
            'users.edit',
            'users.delete',

            // Settings
            'settings.view',
            'settings.edit',

            // System
            'system.logs',
            'system.cache',
            'system.queue',
        ];

        foreach ($permissions as $permission) {
            Permission::create(['name' => $permission]);
        }

        // Create roles and assign permissions
        $this->createAdminRole();
        $this->createManagerRole();
        $this->createEditorRole();
        $this->createViewerRole();
    }

    private function createAdminRole(): void
    {
        $role = Role::create(['name' => 'admin']);
        $role->givePermissionTo(Permission::all());
    }

    private function createManagerRole(): void
    {
        $role = Role::create(['name' => 'manager']);
        $role->givePermissionTo([
            // Contacts - full access except import
            'contacts.view',
            'contacts.create',
            'contacts.edit',
            'contacts.delete',
            'contacts.export',

            // Companies - full access
            'companies.view',
            'companies.create',
            'companies.edit',
            'companies.delete',

            // Reports
            'reports.view',
            'reports.export',

            // Users - view only
            'users.view',

            // Settings - view only
            'settings.view',
        ]);
    }

    private function createEditorRole(): void
    {
        $role = Role::create(['name' => 'editor']);
        $role->givePermissionTo([
            // Contacts - create and edit only
            'contacts.view',
            'contacts.create',
            'contacts.edit',

            // Companies - view only
            'companies.view',

            // Reports - view only
            'reports.view',
        ]);
    }

    private function createViewerRole(): void
    {
        $role = Role::create(['name' => 'viewer']);
        $role->givePermissionTo([
            'contacts.view',
            'companies.view',
            'reports.view',
        ]);
    }
}

// =============================================================================
// Assigning Roles to Users
// =============================================================================

class UserRoleService
{
    public function assignRole(User $user, string $roleName): void
    {
        $user->assignRole($roleName);
    }

    public function syncRoles(User $user, array $roleNames): void
    {
        $user->syncRoles($roleNames);
    }

    public function removeRole(User $user, string $roleName): void
    {
        $user->removeRole($roleName);
    }

    public function givePermission(User $user, string $permission): void
    {
        // Direct permission (bypasses roles)
        $user->givePermissionTo($permission);
    }

    public function hasRole(User $user, string|array $roles): bool
    {
        return $user->hasRole($roles);
    }

    public function hasAnyRole(User $user, array $roles): bool
    {
        return $user->hasAnyRole($roles);
    }

    public function hasAllRoles(User $user, array $roles): bool
    {
        return $user->hasAllRoles($roles);
    }

    public function canDo(User $user, string $permission): bool
    {
        return $user->hasPermissionTo($permission);
    }

    public function canDoAny(User $user, array $permissions): bool
    {
        return $user->hasAnyPermission($permissions);
    }
}

// =============================================================================
// Policy with Permission Checks
// =============================================================================

class ContactPolicy
{
    /**
     * Pre-authorization check - admins bypass all
     */
    public function before(User $user, string $ability): ?bool
    {
        if ($user->hasRole('admin')) {
            return true;
        }

        return null;
    }

    public function viewAny(User $user): bool
    {
        return $user->hasPermissionTo('contacts.view');
    }

    public function view(User $user, Contact $contact): bool
    {
        if (!$user->hasPermissionTo('contacts.view')) {
            return false;
        }

        // Additional tenant check
        return $contact->tenant_id === $user->tenant_id;
    }

    public function create(User $user): bool
    {
        return $user->hasPermissionTo('contacts.create');
    }

    public function update(User $user, Contact $contact): bool
    {
        if (!$user->hasPermissionTo('contacts.edit')) {
            return false;
        }

        return $contact->tenant_id === $user->tenant_id;
    }

    public function delete(User $user, Contact $contact): bool
    {
        if (!$user->hasPermissionTo('contacts.delete')) {
            return false;
        }

        return $contact->tenant_id === $user->tenant_id;
    }

    public function export(User $user): bool
    {
        return $user->hasPermissionTo('contacts.export');
    }

    public function import(User $user): bool
    {
        return $user->hasPermissionTo('contacts.import');
    }

    public function restore(User $user, Contact $contact): bool
    {
        return $user->hasAnyRole(['admin', 'manager']);
    }

    public function forceDelete(User $user, Contact $contact): bool
    {
        return $user->hasRole('admin');
    }
}

// =============================================================================
// Controller with Authorization
// =============================================================================

class ContactController extends \App\Http\Controllers\Controller
{
    public function __construct()
    {
        // Method-level authorization
        $this->authorizeResource(Contact::class, 'contact');
    }

    public function index()
    {
        // Authorization handled by authorizeResource

        $contacts = Contact::query()
            ->forTenant(auth()->user()->tenant_id)
            ->paginate(25);

        return view('contacts.index', compact('contacts'));
    }

    public function export()
    {
        // Explicit authorization for non-CRUD actions
        $this->authorize('export', Contact::class);

        // Export logic...
    }

    public function import()
    {
        $this->authorize('import', Contact::class);

        // Import logic...
    }
}

// =============================================================================
// Middleware Usage in Routes
// =============================================================================

use Illuminate\Support\Facades\Route;

// Role-based middleware
Route::middleware(['auth', 'role:admin'])->group(function () {
    Route::resource('users', UserController::class);
    Route::get('/system/logs', [SystemController::class, 'logs']);
});

// Permission-based middleware
Route::middleware(['auth', 'permission:contacts.view'])->group(function () {
    Route::get('/contacts', [ContactController::class, 'index']);
    Route::get('/contacts/{contact}', [ContactController::class, 'show']);
});

Route::middleware(['auth', 'permission:contacts.create'])->group(function () {
    Route::post('/contacts', [ContactController::class, 'store']);
});

Route::middleware(['auth', 'permission:contacts.edit'])->group(function () {
    Route::put('/contacts/{contact}', [ContactController::class, 'update']);
});

// Multiple roles (OR)
Route::middleware(['auth', 'role:admin|manager'])->group(function () {
    Route::get('/reports', [ReportController::class, 'index']);
});

// Multiple permissions (AND)
Route::middleware(['auth', 'permission:reports.view,reports.export'])->group(function () {
    Route::get('/reports/export', [ReportController::class, 'export']);
});

// =============================================================================
// Blade Directives
// =============================================================================

/*
In Blade templates:

@role('admin')
    <a href="/admin">Admin Panel</a>
@endrole

@hasrole('manager')
    <a href="/reports">Manager Reports</a>
@endhasrole

@hasanyrole('admin|manager')
    <a href="/settings">Settings</a>
@endhasanyrole

@hasallroles('admin|super-admin')
    <a href="/super-admin">Super Admin</a>
@endhasallroles

@can('contacts.delete')
    <button>Delete Contact</button>
@endcan

@canany(['contacts.edit', 'contacts.delete'])
    <div class="actions">
        @can('contacts.edit')
            <button>Edit</button>
        @endcan
        @can('contacts.delete')
            <button>Delete</button>
        @endcan
    </div>
@endcanany

@unlessrole('viewer')
    <button>Create New</button>
@endunlessrole
*/

// =============================================================================
// API Token Abilities (Sanctum Integration)
// =============================================================================

class ApiTokenController extends \App\Http\Controllers\Controller
{
    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'abilities' => 'array',
            'abilities.*' => 'string|in:contacts:read,contacts:write,reports:read',
        ]);

        // Create token with limited abilities
        $token = $request->user()->createToken(
            $request->name,
            $request->abilities ?? ['contacts:read']
        );

        return response()->json([
            'token' => $token->plainTextToken,
            'abilities' => $token->accessToken->abilities,
        ]);
    }
}

// In controller, check token abilities:
class ApiContactController extends \App\Http\Controllers\Controller
{
    public function index(Request $request)
    {
        if (!$request->user()->tokenCan('contacts:read')) {
            abort(403, 'Token does not have contacts:read ability');
        }

        return Contact::paginate();
    }

    public function store(Request $request)
    {
        if (!$request->user()->tokenCan('contacts:write')) {
            abort(403, 'Token does not have contacts:write ability');
        }

        return Contact::create($request->validated());
    }
}
