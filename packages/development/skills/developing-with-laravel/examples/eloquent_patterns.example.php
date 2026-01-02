<?php
/**
 * Eloquent ORM Patterns Example
 *
 * This example demonstrates advanced Eloquent patterns including:
 * - Model relationships and eager loading
 * - Query scopes (local and global)
 * - Model observers
 * - Transactions and locking
 * - Raw queries and subqueries
 */

declare(strict_types=1);

namespace App\Examples;

use App\Models\Company;
use App\Models\Contact;
use App\Models\Tag;
use App\Enums\ContactStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\DB;

// =============================================================================
// Model with Full Features
// =============================================================================

class Contact extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'first_name',
        'last_name',
        'email',
        'phone',
        'status',
        'company_id',
        'tenant_id',
    ];

    protected function casts(): array
    {
        return [
            'status' => ContactStatus::class,
            'metadata' => 'array',
            'last_contacted_at' => 'datetime',
        ];
    }

    // -------------------------------------------------------------------------
    // Relationships
    // -------------------------------------------------------------------------

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'contact_tags')
            ->withTimestamps()
            ->withPivot('added_by');
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class)->latest();
    }

    public function latestActivity(): HasOne
    {
        return $this->hasOne(Activity::class)->latestOfMany();
    }

    // -------------------------------------------------------------------------
    // Local Scopes
    // -------------------------------------------------------------------------

    public function scopeActive(Builder $query): void
    {
        $query->where('status', ContactStatus::Active);
    }

    public function scopeForCompany(Builder $query, int $companyId): void
    {
        $query->where('company_id', $companyId);
    }

    public function scopeFilter(Builder $query, array $filters): void
    {
        $query
            ->when($filters['status'] ?? null, fn($q, $s) => $q->where('status', $s))
            ->when($filters['company_id'] ?? null, fn($q, $c) => $q->where('company_id', $c))
            ->when($filters['search'] ?? null, function ($q, $search) {
                $q->where(function ($query) use ($search) {
                    $query->where('first_name', 'like', "%{$search}%")
                          ->orWhere('last_name', 'like', "%{$search}%")
                          ->orWhere('email', 'like', "%{$search}%");
                });
            })
            ->when($filters['tag_ids'] ?? null, function ($q, $tagIds) {
                $q->whereHas('tags', fn($t) => $t->whereIn('tags.id', $tagIds));
            });
    }

    public function scopeWithRecentActivity(Builder $query, int $days = 30): void
    {
        $query->whereHas('activities', function ($q) use ($days) {
            $q->where('created_at', '>=', now()->subDays($days));
        });
    }

    // -------------------------------------------------------------------------
    // Accessors
    // -------------------------------------------------------------------------

    public function getFullNameAttribute(): string
    {
        return trim("{$this->first_name} {$this->last_name}");
    }

    // -------------------------------------------------------------------------
    // Business Methods
    // -------------------------------------------------------------------------

    public function markAsContacted(): void
    {
        $this->update(['last_contacted_at' => now()]);
    }

    public function syncTags(array $tagIds, int $addedBy): void
    {
        $syncData = collect($tagIds)->mapWithKeys(fn($id) => [
            $id => ['added_by' => $addedBy]
        ])->toArray();

        $this->tags()->sync($syncData);
    }
}

// =============================================================================
// Global Scope for Multi-Tenancy
// =============================================================================

class TenantScope implements \Illuminate\Database\Eloquent\Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        if ($tenantId = session('tenant_id')) {
            $builder->where($model->getTable() . '.tenant_id', $tenantId);
        }
    }

    public function extend(Builder $builder): void
    {
        $builder->macro('withoutTenant', function (Builder $builder) {
            return $builder->withoutGlobalScope($this);
        });

        $builder->macro('forTenant', function (Builder $builder, int $tenantId) {
            return $builder->withoutGlobalScope($this)
                          ->where('tenant_id', $tenantId);
        });
    }
}

// Apply global scope in model boot
// protected static function booted(): void
// {
//     static::addGlobalScope(new TenantScope());
// }

// =============================================================================
// Model Observer
// =============================================================================

class ContactObserver
{
    public function creating(Contact $contact): void
    {
        $contact->status ??= ContactStatus::Pending;
        $contact->tenant_id ??= session('tenant_id');
    }

    public function created(Contact $contact): void
    {
        // Log activity
        Activity::create([
            'contact_id' => $contact->id,
            'type' => 'created',
            'description' => "Contact created",
            'user_id' => auth()->id(),
        ]);

        // Queue sync job
        SyncContactToExternalSystem::dispatch($contact)->delay(now()->addMinutes(5));
    }

    public function updated(Contact $contact): void
    {
        if ($contact->wasChanged('status')) {
            Activity::create([
                'contact_id' => $contact->id,
                'type' => 'status_changed',
                'description' => "Status changed to {$contact->status->label()}",
                'metadata' => [
                    'old_status' => $contact->getOriginal('status'),
                    'new_status' => $contact->status->value,
                ],
                'user_id' => auth()->id(),
            ]);
        }
    }

    public function deleted(Contact $contact): void
    {
        // Clear cache
        Cache::tags(['contacts', "contact:{$contact->id}"])->flush();
    }
}

// =============================================================================
// Query Examples
// =============================================================================

// Eager loading with constraints
$contacts = Contact::with([
    'company:id,name',
    'tags:id,name',
    'activities' => fn($q) => $q->latest()->limit(5),
])
->active()
->filter(request()->only(['status', 'company_id', 'search', 'tag_ids']))
->orderBy('last_name')
->paginate(25);

// Subquery select
$contacts = Contact::select(['contacts.*'])
    ->selectSub(
        Activity::selectRaw('COUNT(*)')
            ->whereColumn('contact_id', 'contacts.id'),
        'activities_count'
    )
    ->selectSub(
        Activity::selectRaw('MAX(created_at)')
            ->whereColumn('contact_id', 'contacts.id'),
        'last_activity_at'
    )
    ->get();

// Exists subquery
$contactsWithOrders = Contact::whereExists(function ($query) {
    $query->select(DB::raw(1))
          ->from('orders')
          ->whereColumn('orders.contact_id', 'contacts.id')
          ->where('orders.status', 'completed');
})->get();

// Raw expressions
$stats = Contact::select([
    DB::raw('DATE(created_at) as date'),
    DB::raw('COUNT(*) as total'),
    DB::raw('SUM(CASE WHEN status = "active" THEN 1 ELSE 0 END) as active_count'),
])
->whereBetween('created_at', [now()->subDays(30), now()])
->groupBy('date')
->orderBy('date')
->get();

// =============================================================================
// Transaction Examples
// =============================================================================

// Basic transaction
$contact = DB::transaction(function () use ($data, $tagIds) {
    $contact = Contact::create($data);
    $contact->tags()->attach($tagIds);

    Activity::create([
        'contact_id' => $contact->id,
        'type' => 'created',
        'user_id' => auth()->id(),
    ]);

    return $contact->load('tags');
});

// Transaction with deadlock retry
DB::transaction(function () use ($contactId, $quantity) {
    $contact = Contact::where('id', $contactId)
        ->lockForUpdate()
        ->first();

    // Perform operations with locked record
    $contact->update(['credits' => $contact->credits - $quantity]);
}, attempts: 5);

// =============================================================================
// Batch Operations
// =============================================================================

// Chunked processing
Contact::where('status', ContactStatus::Inactive)
    ->where('updated_at', '<', now()->subDays(90))
    ->chunkById(100, function ($contacts) {
        foreach ($contacts as $contact) {
            $contact->update(['status' => ContactStatus::Archived]);
        }
    });

// Lazy collection (memory efficient)
Contact::where('status', ContactStatus::Active)
    ->lazy()
    ->each(function (Contact $contact) {
        // Process one at a time
        SyncContactJob::dispatch($contact);
    });

// Cursor (streaming)
foreach (Contact::cursor() as $contact) {
    // Memory-efficient iteration
    ProcessContact::dispatch($contact);
}

// Mass update
Contact::where('company_id', $companyId)
    ->where('status', ContactStatus::Pending)
    ->update([
        'status' => ContactStatus::Active,
        'activated_at' => now(),
    ]);

// Upsert (insert or update)
Contact::upsert(
    [
        ['email' => 'john@example.com', 'first_name' => 'John', 'last_name' => 'Doe'],
        ['email' => 'jane@example.com', 'first_name' => 'Jane', 'last_name' => 'Doe'],
    ],
    uniqueBy: ['email'],
    update: ['first_name', 'last_name']
);
