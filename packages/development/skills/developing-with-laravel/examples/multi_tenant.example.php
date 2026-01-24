<?php
/**
 * Multi-Tenancy Patterns Example
 *
 * This example demonstrates multi-tenant architecture including:
 * - Tenant model and relationships
 * - Global scope for automatic filtering
 * - Tenant-aware middleware
 * - Cross-tenant operations
 * - Tenant-specific configuration
 */

declare(strict_types=1);

namespace App\Examples;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Scope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Storage;

// =============================================================================
// Tenant Model
// =============================================================================

class Tenant extends Model
{
    protected $fillable = [
        'name',
        'domain',
        'database',
        'settings',
        'is_active',
        'trial_ends_at',
        'subscription_ends_at',
    ];

    protected function casts(): array
    {
        return [
            'settings' => 'array',
            'is_active' => 'boolean',
            'trial_ends_at' => 'datetime',
            'subscription_ends_at' => 'datetime',
        ];
    }

    // -------------------------------------------------------------------------
    // Relationships
    // -------------------------------------------------------------------------

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function contacts(): HasMany
    {
        return $this->hasMany(Contact::class);
    }

    public function companies(): HasMany
    {
        return $this->hasMany(Company::class);
    }

    // -------------------------------------------------------------------------
    // Settings Helpers
    // -------------------------------------------------------------------------

    public function getSetting(string $key, mixed $default = null): mixed
    {
        return data_get($this->settings, $key, $default);
    }

    public function setSetting(string $key, mixed $value): void
    {
        $settings = $this->settings ?? [];
        data_set($settings, $key, $value);
        $this->update(['settings' => $settings]);
    }

    // -------------------------------------------------------------------------
    // Status Checks
    // -------------------------------------------------------------------------

    public function isOnTrial(): bool
    {
        return $this->trial_ends_at && $this->trial_ends_at->isFuture();
    }

    public function hasActiveSubscription(): bool
    {
        return $this->subscription_ends_at && $this->subscription_ends_at->isFuture();
    }

    public function isAccessible(): bool
    {
        return $this->is_active && ($this->isOnTrial() || $this->hasActiveSubscription());
    }
}

// =============================================================================
// Global Tenant Scope
// =============================================================================

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        if ($tenantId = app('tenant')?->id ?? session('tenant_id')) {
            $builder->where($model->getTable() . '.tenant_id', $tenantId);
        }
    }

    public function extend(Builder $builder): void
    {
        // Remove scope for cross-tenant queries
        $builder->macro('withoutTenant', function (Builder $builder) {
            return $builder->withoutGlobalScope($this);
        });

        // Query specific tenant
        $builder->macro('forTenant', function (Builder $builder, int $tenantId) {
            return $builder->withoutGlobalScope($this)
                          ->where('tenant_id', $tenantId);
        });

        // Query all tenants
        $builder->macro('allTenants', function (Builder $builder) {
            return $builder->withoutGlobalScope($this);
        });
    }
}

// =============================================================================
// Trait for Tenant-Scoped Models
// =============================================================================

trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        // Apply global scope
        static::addGlobalScope(new TenantScope());

        // Auto-assign tenant on create
        static::creating(function (Model $model) {
            if (!$model->tenant_id) {
                $model->tenant_id = app('tenant')?->id ?? session('tenant_id');
            }
        });
    }

    public function tenant()
    {
        return $this->belongsTo(Tenant::class);
    }

    public function scopeForTenant(Builder $query, int $tenantId): void
    {
        $query->withoutGlobalScope(TenantScope::class)
              ->where('tenant_id', $tenantId);
    }
}

// Usage in models:
class Contact extends Model
{
    use BelongsToTenant;

    // ... model code
}

// =============================================================================
// Tenant Resolution Middleware
// =============================================================================

class TenantMiddleware
{
    public function handle(Request $request, \Closure $next)
    {
        $tenant = $this->resolveTenant($request);

        if (!$tenant) {
            abort(404, 'Tenant not found');
        }

        if (!$tenant->isAccessible()) {
            abort(403, 'Tenant subscription expired or inactive');
        }

        // Set tenant in container
        app()->instance('tenant', $tenant);

        // Set in session for subsequent requests
        session(['tenant_id' => $tenant->id]);

        // Configure tenant-specific settings
        $this->configureTenant($tenant);

        return $next($request);
    }

    private function resolveTenant(Request $request): ?Tenant
    {
        // Strategy 1: Subdomain
        $host = $request->getHost();
        $parts = explode('.', $host);

        if (count($parts) >= 3) {
            $subdomain = $parts[0];
            if ($tenant = Tenant::where('domain', $subdomain)->first()) {
                return $tenant;
            }
        }

        // Strategy 2: Request header
        if ($tenantId = $request->header('X-Tenant-ID')) {
            return Tenant::find($tenantId);
        }

        // Strategy 3: Authenticated user's tenant
        if ($user = $request->user()) {
            return $user->tenant;
        }

        // Strategy 4: Route parameter
        if ($tenantId = $request->route('tenant')) {
            return Tenant::find($tenantId);
        }

        return null;
    }

    private function configureTenant(Tenant $tenant): void
    {
        // Configure storage disk
        Config::set('filesystems.disks.tenant', [
            'driver' => 'local',
            'root' => storage_path("app/tenants/{$tenant->id}"),
            'visibility' => 'private',
        ]);

        // Configure mail
        if ($fromName = $tenant->getSetting('mail.from_name')) {
            Config::set('mail.from.name', $fromName);
        }

        // Configure cache prefix
        Config::set('cache.prefix', "tenant_{$tenant->id}_");

        // Configure queue
        Config::set('queue.connections.redis.queue', "tenant_{$tenant->id}_default");
    }
}

// =============================================================================
// Cross-Tenant Service
// =============================================================================

class TenantService
{
    private ?Tenant $previousTenant = null;

    /**
     * Execute callback within tenant context
     */
    public function run(Tenant $tenant, callable $callback): mixed
    {
        $this->previousTenant = app('tenant');

        try {
            app()->instance('tenant', $tenant);
            session(['tenant_id' => $tenant->id]);

            return $callback($tenant);

        } finally {
            $this->restorePreviousTenant();
        }
    }

    /**
     * Execute callback for all tenants
     */
    public function forAllTenants(callable $callback): void
    {
        Tenant::where('is_active', true)
            ->cursor()
            ->each(function (Tenant $tenant) use ($callback) {
                $this->run($tenant, $callback);
            });
    }

    /**
     * Execute callback without tenant scope
     */
    public function withoutTenant(callable $callback): mixed
    {
        $this->previousTenant = app('tenant');

        try {
            app()->forgetInstance('tenant');
            session()->forget('tenant_id');

            return $callback();

        } finally {
            $this->restorePreviousTenant();
        }
    }

    private function restorePreviousTenant(): void
    {
        if ($this->previousTenant) {
            app()->instance('tenant', $this->previousTenant);
            session(['tenant_id' => $this->previousTenant->id]);
        } else {
            app()->forgetInstance('tenant');
            session()->forget('tenant_id');
        }

        $this->previousTenant = null;
    }
}

// =============================================================================
// Tenant-Aware Jobs
// =============================================================================

trait TenantAware
{
    public int $tenantId;

    public function initializeTenantAware(): void
    {
        $this->tenantId = app('tenant')?->id ?? session('tenant_id');
    }

    public function setTenantContext(): void
    {
        if ($this->tenantId) {
            $tenant = Tenant::find($this->tenantId);
            if ($tenant) {
                app()->instance('tenant', $tenant);
                session(['tenant_id' => $tenant->id]);
            }
        }
    }
}

class ProcessTenantDataJob implements \Illuminate\Contracts\Queue\ShouldQueue
{
    use TenantAware;
    use \Illuminate\Bus\Queueable;
    use \Illuminate\Foundation\Bus\Dispatchable;
    use \Illuminate\Queue\InteractsWithQueue;
    use \Illuminate\Queue\SerializesModels;

    public function __construct(
        public readonly int $contactId,
    ) {
        $this->initializeTenantAware();
    }

    public function handle(): void
    {
        // Restore tenant context
        $this->setTenantContext();

        // Now queries are automatically scoped to tenant
        $contact = Contact::find($this->contactId);
        // Process contact...
    }
}

// =============================================================================
// Tenant-Aware Commands
// =============================================================================

class TenantCommand extends \Illuminate\Console\Command
{
    protected $signature = 'tenant:run {tenant} {--all : Run for all tenants}';
    protected $description = 'Run operation for tenant(s)';

    public function handle(TenantService $tenantService): int
    {
        if ($this->option('all')) {
            $this->info('Running for all tenants...');

            $tenantService->forAllTenants(function (Tenant $tenant) {
                $this->line("Processing tenant: {$tenant->name}");
                $this->processForTenant($tenant);
            });

        } else {
            $tenant = Tenant::findOrFail($this->argument('tenant'));
            $this->info("Running for tenant: {$tenant->name}");

            $tenantService->run($tenant, function (Tenant $tenant) {
                $this->processForTenant($tenant);
            });
        }

        return self::SUCCESS;
    }

    private function processForTenant(Tenant $tenant): void
    {
        // Queries automatically scoped to tenant
        $count = Contact::count();
        $this->line("  - {$count} contacts");
    }
}

// =============================================================================
// Usage Examples
// =============================================================================

// Automatic scoping (most common)
$contacts = Contact::all();  // Only current tenant's contacts

// Explicit tenant query
$contacts = Contact::forTenant($specificTenantId)->get();

// Cross-tenant query
$allContacts = Contact::withoutTenant()->get();
$allContacts = Contact::allTenants()->get();

// Run in different tenant context
$tenantService = app(TenantService::class);
$result = $tenantService->run($otherTenant, function (Tenant $tenant) {
    return Contact::count();
});

// Tenant-specific storage
Storage::disk('tenant')->put('reports/monthly.pdf', $content);
$path = Storage::disk('tenant')->path('reports/monthly.pdf');

// Tenant-specific cache
Cache::put("contacts_count", $count, 3600);  // Auto-prefixed with tenant ID
