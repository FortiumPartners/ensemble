# Laravel Reference Guide

Comprehensive patterns for enterprise Laravel development.

**Prerequisites**: PHP skill (language fundamentals), Laravel SKILL.md (framework basics)

---

## Table of Contents

1. [Service Container & Dependency Injection](#1-service-container--dependency-injection)
2. [Eloquent Advanced Patterns](#2-eloquent-advanced-patterns)
3. [Repository Pattern](#3-repository-pattern)
4. [Queue System Advanced](#4-queue-system-advanced)
5. [Event Broadcasting Advanced](#5-event-broadcasting-advanced)
6. [Artisan CLI Advanced](#6-artisan-cli-advanced)
7. [Multi-Tenancy Patterns](#7-multi-tenancy-patterns)
8. [Authentication Advanced](#8-authentication-advanced)
9. [Common Integrations](#9-common-integrations)
10. [Performance Optimization](#10-performance-optimization)
11. [Testing Advanced](#11-testing-advanced)
12. [Debugging & Profiling](#12-debugging--profiling)

---

## 1. Service Container & Dependency Injection

### Container Fundamentals

```php
// Binding basics
app()->bind(PaymentGateway::class, StripeGateway::class);

// Singleton (one instance)
app()->singleton(ConfigService::class, function ($app) {
    return new ConfigService(
        cache: $app->make(CacheInterface::class),
        ttl: config('services.config.ttl', 3600),
    );
});

// Instance binding (pre-existing)
app()->instance(Logger::class, $myLogger);

// Contextual binding
app()->when(PhotoController::class)
    ->needs(Filesystem::class)
    ->give(function () {
        return Storage::disk('photos');
    });

// Interface to implementation
app()->bind(
    PaymentProcessorInterface::class,
    StripePaymentProcessor::class
);
```

### Service Provider Patterns

```php
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Contracts\Support\DeferrableProvider;

class PaymentServiceProvider extends ServiceProvider implements DeferrableProvider
{
    /**
     * Services provided by this provider
     */
    public function provides(): array
    {
        return [
            PaymentGateway::class,
            PaymentProcessorInterface::class,
        ];
    }

    public function register(): void
    {
        $this->app->singleton(PaymentGateway::class, function ($app) {
            $driver = config('payment.driver', 'stripe');

            return match ($driver) {
                'stripe' => new StripeGateway(
                    config('payment.stripe.key'),
                    config('payment.stripe.secret'),
                ),
                'braintree' => new BraintreeGateway(
                    config('payment.braintree.merchant_id'),
                    config('payment.braintree.public_key'),
                    config('payment.braintree.private_key'),
                ),
                default => throw new InvalidArgumentException("Unknown payment driver: {$driver}"),
            };
        });

        // Alias for interface
        $this->app->bind(
            PaymentProcessorInterface::class,
            PaymentGateway::class
        );
    }

    public function boot(): void
    {
        // Publish configuration
        $this->publishes([
            __DIR__ . '/../../config/payment.php' => config_path('payment.php'),
        ], 'payment-config');

        // Merge default config
        $this->mergeConfigFrom(
            __DIR__ . '/../../config/payment.php',
            'payment'
        );
    }
}
```

### Advanced Binding Patterns

```php
// Tagged bindings (multiple implementations)
app()->bind('reports.sales', SalesReport::class);
app()->bind('reports.inventory', InventoryReport::class);
app()->bind('reports.finance', FinanceReport::class);

app()->tag([
    'reports.sales',
    'reports.inventory',
    'reports.finance',
], 'reports');

// Resolve all tagged
$reports = app()->tagged('reports');
foreach ($reports as $report) {
    $report->generate();
}

// Extending bindings (decoration)
app()->extend(PaymentGateway::class, function ($gateway, $app) {
    return new LoggingPaymentDecorator(
        $gateway,
        $app->make(Logger::class)
    );
});

// Rebinding callback
app()->rebinding(PaymentGateway::class, function ($app, $gateway) {
    // Called when binding is refreshed
    $app->make(PaymentController::class)->setGateway($gateway);
});
```

### Method Injection

```php
class OrderController extends Controller
{
    // Constructor injection
    public function __construct(
        private readonly OrderService $orderService,
        private readonly LoggerInterface $logger,
    ) {
    }

    // Method injection (resolved per-call)
    public function store(
        StoreOrderRequest $request,
        PaymentGateway $payment,  // Resolved from container
        InventoryService $inventory
    ) {
        $order = $this->orderService->create($request->validated());

        $payment->charge($order->total);
        $inventory->reserve($order->items);

        return response()->json($order, 201);
    }
}
```

---

## 2. Eloquent Advanced Patterns

### Model Observers

```php
<?php

namespace App\Observers;

use App\Models\Contact;
use App\Services\AuditService;
use App\Jobs\SyncContactToExternalSystem;
use Illuminate\Support\Facades\Cache;

class ContactObserver
{
    public function __construct(
        private readonly AuditService $audit,
    ) {
    }

    public function creating(Contact $contact): void
    {
        // Set defaults before creation
        $contact->status ??= ContactStatus::Pending;
        $contact->created_by = auth()->id();
    }

    public function created(Contact $contact): void
    {
        // Post-creation tasks
        $this->audit->log('contact.created', $contact);

        // Dispatch sync job
        SyncContactToExternalSystem::dispatch($contact)
            ->delay(now()->addMinutes(5));
    }

    public function updating(Contact $contact): void
    {
        $contact->updated_by = auth()->id();
    }

    public function updated(Contact $contact): void
    {
        $this->audit->log('contact.updated', $contact, [
            'changes' => $contact->getChanges(),
            'original' => $contact->getOriginal(),
        ]);

        // Invalidate caches
        Cache::tags(['contacts', "contact:{$contact->id}"])->flush();
    }

    public function deleting(Contact $contact): bool
    {
        // Prevent deletion if has active orders
        if ($contact->orders()->where('status', 'active')->exists()) {
            return false;  // Abort deletion
        }

        return true;
    }

    public function deleted(Contact $contact): void
    {
        $this->audit->log('contact.deleted', $contact);
        Cache::tags(['contacts'])->flush();
    }

    public function restored(Contact $contact): void
    {
        $this->audit->log('contact.restored', $contact);
    }

    public function forceDeleted(Contact $contact): void
    {
        // Clean up related data
        $contact->activities()->forceDelete();
        $contact->notes()->forceDelete();
    }
}

// Register in AppServiceProvider::boot()
Contact::observe(ContactObserver::class);
```

### Query Scopes Advanced

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    // -------------------------------------------------------------------------
    // Local Scopes
    // -------------------------------------------------------------------------

    public function scopeActive(Builder $query): void
    {
        $query->whereIn('status', [
            OrderStatus::Pending,
            OrderStatus::Processing,
            OrderStatus::Shipped,
        ]);
    }

    public function scopeForUser(Builder $query, int $userId): void
    {
        $query->where('user_id', $userId);
    }

    public function scopeDateRange(Builder $query, ?string $from, ?string $to): void
    {
        $query->when($from, fn($q) => $q->where('created_at', '>=', $from))
              ->when($to, fn($q) => $q->where('created_at', '<=', $to));
    }

    public function scopeWithTotalAbove(Builder $query, float $amount): void
    {
        $query->where('total', '>', $amount);
    }

    // Dynamic scope with multiple parameters
    public function scopeFilter(Builder $query, array $filters): void
    {
        $query->when($filters['status'] ?? null, function ($q, $status) {
            $q->where('status', $status);
        })
        ->when($filters['customer_id'] ?? null, function ($q, $customerId) {
            $q->where('customer_id', $customerId);
        })
        ->when($filters['min_total'] ?? null, function ($q, $min) {
            $q->where('total', '>=', $min);
        })
        ->when($filters['search'] ?? null, function ($q, $search) {
            $q->where(function ($query) use ($search) {
                $query->where('order_number', 'like', "%{$search}%")
                      ->orWhereHas('customer', function ($q) use ($search) {
                          $q->where('name', 'like', "%{$search}%");
                      });
            });
        });
    }
}

// Usage
$orders = Order::active()
    ->forUser(auth()->id())
    ->dateRange($request->from, $request->to)
    ->filter($request->only(['status', 'customer_id', 'min_total', 'search']))
    ->with(['customer', 'items.product'])
    ->paginate(25);
```

### Global Scopes

```php
<?php

namespace App\Models\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

class TenantScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        if ($tenantId = session('tenant_id')) {
            $builder->where($model->getTable() . '.tenant_id', $tenantId);
        }
    }

    public function extend(Builder $builder): void
    {
        // Add macro to remove this scope
        $builder->macro('withoutTenant', function (Builder $builder) {
            return $builder->withoutGlobalScope($this);
        });

        // Add macro for specific tenant
        $builder->macro('forTenant', function (Builder $builder, int $tenantId) {
            return $builder->withoutGlobalScope($this)
                          ->where('tenant_id', $tenantId);
        });
    }
}

// Apply in model
class Contact extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope());

        // Or inline scope
        static::addGlobalScope('active', function (Builder $builder) {
            $builder->where('is_active', true);
        });
    }
}

// Usage
Contact::all();                      // Auto-filtered by tenant
Contact::withoutTenant()->all();     // All tenants
Contact::forTenant(5)->get();        // Specific tenant
Contact::withoutGlobalScope('active')->get();  // Include inactive
```

### Raw Queries & Expressions

```php
use Illuminate\Support\Facades\DB;

// Raw select
$results = DB::select('
    SELECT department_id,
           COUNT(*) as employee_count,
           AVG(salary) as avg_salary
    FROM employees
    WHERE status = ?
    GROUP BY department_id
    HAVING COUNT(*) > ?
', ['active', 5]);

// Raw within Eloquent
$users = User::select([
    'id',
    'name',
    DB::raw('DATE(created_at) as signup_date'),
    DB::raw('DATEDIFF(NOW(), last_login_at) as days_since_login'),
])
->whereRaw('YEAR(created_at) = ?', [2024])
->orderByRaw('FIELD(status, "active", "pending", "inactive")')
->get();

// Subquery select
$users = User::select(['users.*'])
    ->selectSub(
        Order::selectRaw('SUM(total)')
            ->whereColumn('user_id', 'users.id'),
        'total_spent'
    )
    ->get();

// Subquery where
$activeUsers = User::whereIn('id', function ($query) {
    $query->select('user_id')
          ->from('orders')
          ->where('created_at', '>=', now()->subDays(30));
})->get();

// Insert with raw
DB::table('metrics')->insert([
    'page' => '/dashboard',
    'views' => 1,
    'created_at' => DB::raw('NOW()'),
]);

// Update with increment and raw
DB::table('products')
    ->where('id', $productId)
    ->update([
        'view_count' => DB::raw('view_count + 1'),
        'last_viewed_at' => DB::raw('NOW()'),
    ]);
```

### Transactions & Locking

```php
use Illuminate\Support\Facades\DB;

// Basic transaction
DB::transaction(function () use ($order, $items) {
    $order->save();

    foreach ($items as $item) {
        $order->items()->create($item);

        // Decrement inventory
        Product::where('id', $item['product_id'])
            ->decrement('stock', $item['quantity']);
    }
});

// Transaction with return value
$order = DB::transaction(function () use ($data) {
    $order = Order::create($data['order']);
    $order->items()->createMany($data['items']);
    return $order->load('items');
});

// Manual transaction control
DB::beginTransaction();

try {
    $user = User::create($userData);
    $profile = $user->profile()->create($profileData);

    if (!$this->externalService->register($user)) {
        throw new RegistrationException('External registration failed');
    }

    DB::commit();
} catch (\Throwable $e) {
    DB::rollBack();
    throw $e;
}

// Pessimistic locking
$product = Product::where('id', $productId)
    ->lockForUpdate()  // SELECT ... FOR UPDATE
    ->first();

$product->stock -= $quantity;
$product->save();

// Shared lock (read lock)
$product = Product::where('id', $productId)
    ->sharedLock()  // SELECT ... LOCK IN SHARE MODE
    ->first();

// Deadlock retry
DB::transaction(function () {
    // Operations
}, attempts: 5);  // Retry up to 5 times on deadlock
```

### Eager Loading Optimization

```php
// Constrained eager loading
$orders = Order::with([
    'customer:id,name,email',  // Select specific columns
    'items' => function ($query) {
        $query->where('status', 'active')
              ->orderBy('created_at', 'desc');
    },
    'items.product:id,name,sku,price',
    'items.product.category:id,name',
])
->whereHas('items', function ($query) {
    $query->where('quantity', '>', 0);
})
->get();

// Nested eager loading with morphTo
$activities = Activity::with([
    'subject' => function (MorphTo $morphTo) {
        $morphTo->morphWith([
            Contact::class => ['company', 'tags'],
            Order::class => ['customer', 'items'],
        ]);
    },
])->get();

// Lazy eager loading (after retrieval)
$orders = Order::all();

if ($includeItems) {
    $orders->load('items.product');
}

// Eager load count
$users = User::withCount([
    'orders',
    'orders as completed_orders_count' => function ($query) {
        $query->where('status', 'completed');
    },
])->get();

// Eager load sum/avg
$users = User::withSum('orders', 'total')
    ->withAvg('orders', 'total')
    ->get();
```

---

## 3. Repository Pattern

### Base Repository

```php
<?php

namespace App\Repositories;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Pagination\LengthAwarePaginator;

abstract class BaseRepository
{
    protected Model $model;

    public function __construct()
    {
        $this->model = app($this->model());
    }

    abstract protected function model(): string;

    public function query(): Builder
    {
        return $this->model->newQuery();
    }

    public function find(int $id): ?Model
    {
        return $this->query()->find($id);
    }

    public function findOrFail(int $id): Model
    {
        return $this->query()->findOrFail($id);
    }

    public function findBy(string $column, mixed $value): ?Model
    {
        return $this->query()->where($column, $value)->first();
    }

    public function all(): Collection
    {
        return $this->query()->get();
    }

    public function paginate(int $perPage = 15, array $columns = ['*']): LengthAwarePaginator
    {
        return $this->query()->paginate($perPage, $columns);
    }

    public function create(array $data): Model
    {
        return $this->query()->create($data);
    }

    public function update(int $id, array $data): bool
    {
        return $this->query()->where('id', $id)->update($data) > 0;
    }

    public function delete(int $id): bool
    {
        return $this->query()->where('id', $id)->delete() > 0;
    }

    public function exists(int $id): bool
    {
        return $this->query()->where('id', $id)->exists();
    }
}
```

### Specialized Repository

```php
<?php

namespace App\Repositories;

use App\Models\Contact;
use App\Enums\ContactStatus;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Pagination\LengthAwarePaginator;

class ContactRepository extends BaseRepository
{
    protected function model(): string
    {
        return Contact::class;
    }

    public function findByEmail(string $email): ?Contact
    {
        return $this->findBy('email', $email);
    }

    public function findByCompany(int $companyId): Collection
    {
        return $this->query()
            ->where('company_id', $companyId)
            ->orderBy('last_name')
            ->get();
    }

    public function search(string $term, array $filters = []): LengthAwarePaginator
    {
        return $this->query()
            ->where(function ($query) use ($term) {
                $query->where('first_name', 'like', "%{$term}%")
                      ->orWhere('last_name', 'like', "%{$term}%")
                      ->orWhere('email', 'like', "%{$term}%");
            })
            ->when($filters['status'] ?? null, fn($q, $s) => $q->where('status', $s))
            ->when($filters['company_id'] ?? null, fn($q, $c) => $q->where('company_id', $c))
            ->with(['company', 'tags'])
            ->orderBy('created_at', 'desc')
            ->paginate($filters['per_page'] ?? 25);
    }

    public function getByStatus(ContactStatus $status): Collection
    {
        return $this->query()
            ->where('status', $status)
            ->get();
    }

    public function getWithRecentActivity(int $days = 30): Collection
    {
        return $this->query()
            ->whereHas('activities', function ($query) use ($days) {
                $query->where('created_at', '>=', now()->subDays($days));
            })
            ->with(['activities' => fn($q) => $q->latest()->limit(5)])
            ->get();
    }

    public function updateStatus(int $id, ContactStatus $status): bool
    {
        return $this->update($id, ['status' => $status->value]);
    }

    public function createWithTags(array $data, array $tagIds = []): Contact
    {
        $contact = $this->create($data);

        if (!empty($tagIds)) {
            $contact->tags()->sync($tagIds);
        }

        return $contact->load('tags');
    }
}
```

### Repository Interface Pattern

```php
<?php

namespace App\Contracts;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;

interface RepositoryInterface
{
    public function find(int $id): ?Model;
    public function findOrFail(int $id): Model;
    public function all(): Collection;
    public function create(array $data): Model;
    public function update(int $id, array $data): bool;
    public function delete(int $id): bool;
}

// Bind in ServiceProvider
app()->bind(
    ContactRepositoryInterface::class,
    ContactRepository::class
);
```

---

## 4. Queue System Advanced

### RabbitMQ Configuration

```php
// config/queue.php
'connections' => [
    'rabbitmq' => [
        'driver' => 'rabbitmq',
        'host' => env('RABBITMQ_HOST', 'localhost'),
        'port' => env('RABBITMQ_PORT', 5672),
        'user' => env('RABBITMQ_USER', 'guest'),
        'password' => env('RABBITMQ_PASSWORD', 'guest'),
        'vhost' => env('RABBITMQ_VHOST', '/'),
        'queue' => env('RABBITMQ_QUEUE', 'default'),

        'options' => [
            'exchange' => [
                'name' => env('RABBITMQ_EXCHANGE_NAME', 'exchange'),
                'type' => env('RABBITMQ_EXCHANGE_TYPE', 'direct'),
                'durable' => true,
            ],
            'queue' => [
                'durable' => true,
                'arguments' => [
                    'x-max-priority' => 10,
                    'x-dead-letter-exchange' => 'dlx',
                ],
            ],
        ],
    ],
],
```

### Job with Advanced Options

```php
<?php

namespace App\Jobs;

use App\Models\Contact;
use App\Services\ExportService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Throwable;

class ExportContactsJob implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [30, 60, 120];
    public int $timeout = 600;  // 10 minutes
    public int $maxExceptions = 2;

    // Unique job properties
    public int $uniqueFor = 3600;  // 1 hour

    public function __construct(
        public readonly int $userId,
        public readonly array $filters,
        public readonly string $format = 'csv',
    ) {
    }

    public function uniqueId(): string
    {
        return "export-contacts-{$this->userId}-" . md5(json_encode($this->filters));
    }

    public function middleware(): array
    {
        return [
            new RateLimited('exports'),
            new WithoutOverlapping("export-{$this->userId}"),
        ];
    }

    public function handle(ExportService $exportService): void
    {
        $contacts = Contact::query()
            ->filter($this->filters)
            ->cursor();  // Memory efficient

        $path = $exportService->export(
            data: $contacts,
            format: $this->format,
            filename: "contacts-{$this->userId}-" . now()->format('Y-m-d'),
        );

        // Notify user
        User::find($this->userId)?->notify(
            new ExportReadyNotification($path)
        );
    }

    public function failed(Throwable $exception): void
    {
        // Notify user of failure
        User::find($this->userId)?->notify(
            new ExportFailedNotification($exception->getMessage())
        );

        // Log for debugging
        Log::error('Export job failed', [
            'user_id' => $this->userId,
            'filters' => $this->filters,
            'exception' => $exception->getMessage(),
        ]);
    }

    public function retryUntil(): \DateTime
    {
        return now()->addHours(2);
    }

    public function tags(): array
    {
        return ['export', "user:{$this->userId}"];
    }
}

// Rate limiter in AppServiceProvider
RateLimiter::for('exports', function (object $job) {
    return Limit::perMinute(5)->by($job->userId);
});
```

### Job Batching

```php
use Illuminate\Bus\Batch;
use Illuminate\Support\Facades\Bus;

// Create batch
$batch = Bus::batch([
    new ProcessContactChunk($contacts->slice(0, 100)),
    new ProcessContactChunk($contacts->slice(100, 100)),
    new ProcessContactChunk($contacts->slice(200, 100)),
])
->then(function (Batch $batch) {
    // All jobs completed successfully
    Log::info("Batch {$batch->id} completed");
    Notification::send($user, new BatchCompleteNotification($batch));
})
->catch(function (Batch $batch, Throwable $e) {
    // First batch job failure
    Log::error("Batch {$batch->id} failed", ['error' => $e->getMessage()]);
})
->finally(function (Batch $batch) {
    // Batch finished (success or failure)
    Cache::forget("batch-progress:{$batch->id}");
})
->allowFailures()
->onQueue('bulk-processing')
->name('Contact Import Batch')
->dispatch();

// Check batch status
$batch = Bus::findBatch($batchId);

return [
    'id' => $batch->id,
    'name' => $batch->name,
    'total_jobs' => $batch->totalJobs,
    'pending_jobs' => $batch->pendingJobs,
    'failed_jobs' => $batch->failedJobs,
    'progress' => $batch->progress(),
    'finished' => $batch->finished(),
    'cancelled' => $batch->cancelled(),
];

// Add jobs to existing batch
$batch->add([
    new ProcessContactChunk($moreContacts),
]);

// Cancel batch
$batch->cancel();
```

### Job Chaining

```php
use Illuminate\Support\Facades\Bus;

// Chain with shared data
Bus::chain([
    new ValidateImportFile($filePath),
    new ParseImportFile($filePath),
    new ProcessImportedContacts($filePath),
    new SendImportCompleteNotification($userId),
])
->onQueue('imports')
->catch(function (Throwable $e) {
    Log::error('Import chain failed', ['error' => $e->getMessage()]);
})
->dispatch();

// Chain from within a job
class ValidateImportFile implements ShouldQueue
{
    public function handle(): void
    {
        $validated = $this->validate();

        // Dispatch next job with data
        ParseImportFile::dispatch($this->filePath, $validated)
            ->chain([
                new ProcessImportedContacts($this->filePath),
                new SendImportCompleteNotification($this->userId),
            ]);
    }
}
```

### Custom Queue Driver

```php
<?php

namespace App\Queue;

use Illuminate\Contracts\Queue\Queue as QueueContract;
use Illuminate\Queue\Queue;

class CustomQueueDriver extends Queue implements QueueContract
{
    protected $client;

    public function __construct($client)
    {
        $this->client = $client;
    }

    public function size($queue = null): int
    {
        return $this->client->getQueueSize($this->getQueue($queue));
    }

    public function push($job, $data = '', $queue = null): mixed
    {
        return $this->pushRaw($this->createPayload($job, $this->getQueue($queue), $data), $queue);
    }

    public function pushRaw($payload, $queue = null, array $options = []): mixed
    {
        return $this->client->push(
            $this->getQueue($queue),
            $payload,
            $options
        );
    }

    public function later($delay, $job, $data = '', $queue = null): mixed
    {
        return $this->client->pushDelayed(
            $this->getQueue($queue),
            $this->createPayload($job, $this->getQueue($queue), $data),
            $this->secondsUntil($delay)
        );
    }

    public function pop($queue = null): ?\Illuminate\Contracts\Queue\Job
    {
        $message = $this->client->pop($this->getQueue($queue));

        if ($message) {
            return new CustomJob(
                $this->container,
                $this->client,
                $message,
                $this->connectionName,
                $this->getQueue($queue)
            );
        }

        return null;
    }

    protected function getQueue($queue): string
    {
        return $queue ?: $this->default;
    }
}

// Register in ServiceProvider
Queue::extend('custom', function () {
    return new CustomQueueConnector();
});
```

---

## 5. Event Broadcasting Advanced

### Laravel Reverb Configuration

```php
// config/broadcasting.php
'connections' => [
    'reverb' => [
        'driver' => 'reverb',
        'key' => env('REVERB_APP_KEY'),
        'secret' => env('REVERB_APP_SECRET'),
        'app_id' => env('REVERB_APP_ID'),
        'options' => [
            'host' => env('REVERB_HOST', 'localhost'),
            'port' => env('REVERB_PORT', 8080),
            'scheme' => env('REVERB_SCHEME', 'http'),
            'useTLS' => env('REVERB_SCHEME', 'http') === 'https',
        ],
    ],
],
```

### Broadcast Events

```php
<?php

namespace App\Events;

use App\Models\Message;
use App\Models\User;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MessageSent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly Message $message,
        public readonly User $sender,
    ) {
    }

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel("conversation.{$this->message->conversation_id}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'message.sent';
    }

    public function broadcastWith(): array
    {
        return [
            'id' => $this->message->id,
            'content' => $this->message->content,
            'sender' => [
                'id' => $this->sender->id,
                'name' => $this->sender->name,
                'avatar' => $this->sender->avatar_url,
            ],
            'sent_at' => $this->message->created_at->toISOString(),
        ];
    }

    public function broadcastWhen(): bool
    {
        // Only broadcast if recipient is online
        return Cache::has("user-online:{$this->message->recipient_id}");
    }
}
```

### Presence Channel

```php
// Event for presence channel
class UserJoinedConversation implements ShouldBroadcast
{
    public function __construct(
        public readonly int $conversationId,
        public readonly User $user,
    ) {
    }

    public function broadcastOn(): array
    {
        return [
            new PresenceChannel("conversation.{$this->conversationId}"),
        ];
    }

    public function broadcastAs(): string
    {
        return 'user.joined';
    }
}

// Channel authorization (routes/channels.php)
Broadcast::channel('conversation.{conversationId}', function (User $user, int $conversationId) {
    $conversation = Conversation::find($conversationId);

    if ($conversation && $conversation->hasParticipant($user->id)) {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'avatar' => $user->avatar_url,
        ];
    }

    return false;
});

// Private channel auth
Broadcast::channel('user.{userId}', function (User $user, int $userId) {
    return $user->id === $userId;
});

// Team channel with role check
Broadcast::channel('team.{teamId}', function (User $user, int $teamId) {
    $team = Team::find($teamId);

    return $team && $team->hasMember($user);
});
```

### Client Whisper (Client Events)

```php
// Enable client events in channel authorization
Broadcast::channel('conversation.{conversationId}', function (User $user, int $conversationId) {
    return ['id' => $user->id, 'name' => $user->name];
});

// Frontend: Send whisper (typing indicator)
// Echo.private(`conversation.${conversationId}`)
//     .whisper('typing', { user: currentUser.name });

// Listen for whispers
// .listenForWhisper('typing', (e) => {
//     console.log(`${e.user} is typing...`);
// });
```

---

## 6. Artisan CLI Advanced

### Command Lifecycle

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Console\ConfirmableTrait;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class FullLifecycleCommand extends Command
{
    use ConfirmableTrait;

    protected $signature = 'app:full-lifecycle
                            {action : The action to perform}
                            {--force : Skip confirmation}';

    protected $description = 'Demonstrates full command lifecycle';

    /**
     * Runs before the command (validation, setup)
     */
    protected function initialize(InputInterface $input, OutputInterface $output): void
    {
        parent::initialize($input, $output);

        // Validate action
        $validActions = ['import', 'export', 'sync'];
        if (!in_array($input->getArgument('action'), $validActions)) {
            throw new \InvalidArgumentException(
                "Invalid action. Valid: " . implode(', ', $validActions)
            );
        }
    }

    /**
     * Interactive prompt for missing arguments
     */
    protected function interact(InputInterface $input, OutputInterface $output): void
    {
        // Nothing to do if action is provided
    }

    /**
     * Main command logic
     */
    public function handle(): int
    {
        if (!$this->confirmToProceed()) {
            return self::FAILURE;
        }

        $action = $this->argument('action');

        return match ($action) {
            'import' => $this->handleImport(),
            'export' => $this->handleExport(),
            'sync' => $this->handleSync(),
        };
    }

    private function handleImport(): int
    {
        $this->info('Starting import...');
        // Implementation
        return self::SUCCESS;
    }

    private function handleExport(): int
    {
        $this->info('Starting export...');
        return self::SUCCESS;
    }

    private function handleSync(): int
    {
        $this->info('Starting sync...');
        return self::SUCCESS;
    }
}
```

### Long-Running Consumer Command

```php
<?php

namespace App\Console\Commands;

use App\Services\MessageQueueService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class ProcessMessageQueueCommand extends Command
{
    protected $signature = 'queue:messages
                            {--limit=0 : Maximum messages to process (0 = unlimited)}
                            {--timeout=0 : Maximum runtime in seconds (0 = unlimited)}
                            {--sleep=1 : Seconds to sleep when queue is empty}
                            {--memory=128 : Memory limit in MB}';

    protected $description = 'Process messages from external message queue';

    private bool $shouldExit = false;
    private int $processedCount = 0;
    private float $startTime;

    public function __construct(
        private readonly MessageQueueService $queueService,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $this->startTime = microtime(true);
        $this->registerSignalHandlers();

        $limit = (int) $this->option('limit');
        $timeout = (int) $this->option('timeout');
        $sleep = (int) $this->option('sleep');
        $memoryLimit = (int) $this->option('memory');

        $this->info("Starting message processor (PID: " . getmypid() . ")");
        $this->info("Limit: " . ($limit ?: 'unlimited') .
                    ", Timeout: " . ($timeout ?: 'unlimited') . "s" .
                    ", Memory: {$memoryLimit}MB");

        while (!$this->shouldExit) {
            // Check termination conditions
            if ($this->shouldStop($limit, $timeout, $memoryLimit)) {
                break;
            }

            // Fetch and process message
            $message = $this->queueService->fetch();

            if ($message === null) {
                $this->line("<comment>Queue empty, sleeping {$sleep}s...</comment>");
                sleep($sleep);
                continue;
            }

            $this->processMessage($message);
        }

        $this->outputSummary();

        return self::SUCCESS;
    }

    private function registerSignalHandlers(): void
    {
        if (!extension_loaded('pcntl')) {
            $this->warn('PCNTL extension not loaded, signal handling disabled');
            return;
        }

        pcntl_async_signals(true);

        pcntl_signal(SIGTERM, function () {
            $this->warn('SIGTERM received, finishing current message...');
            $this->shouldExit = true;
        });

        pcntl_signal(SIGINT, function () {
            $this->warn('SIGINT received, finishing current message...');
            $this->shouldExit = true;
        });

        pcntl_signal(SIGUSR1, function () {
            $this->outputStatus();
        });
    }

    private function shouldStop(int $limit, int $timeout, int $memoryLimit): bool
    {
        // Check message limit
        if ($limit > 0 && $this->processedCount >= $limit) {
            $this->info("Message limit ({$limit}) reached");
            return true;
        }

        // Check timeout
        if ($timeout > 0) {
            $runtime = microtime(true) - $this->startTime;
            if ($runtime >= $timeout) {
                $this->info("Timeout ({$timeout}s) reached");
                return true;
            }
        }

        // Check memory
        $memoryUsed = memory_get_usage(true) / 1024 / 1024;
        if ($memoryUsed >= $memoryLimit) {
            $this->warn("Memory limit ({$memoryLimit}MB) approached, stopping");
            return true;
        }

        return false;
    }

    private function processMessage(object $message): void
    {
        try {
            $this->line("Processing message: {$message->id}");

            $this->queueService->process($message);
            $this->queueService->acknowledge($message);

            $this->processedCount++;
            $this->info("Processed: {$message->id}");

        } catch (\Throwable $e) {
            $this->error("Failed: {$message->id} - {$e->getMessage()}");
            $this->queueService->reject($message, requeue: true);
        }
    }

    private function outputStatus(): void
    {
        $runtime = round(microtime(true) - $this->startTime, 2);
        $memory = round(memory_get_usage(true) / 1024 / 1024, 2);

        $this->info("Status: {$this->processedCount} processed, {$runtime}s runtime, {$memory}MB memory");
    }

    private function outputSummary(): void
    {
        $runtime = round(microtime(true) - $this->startTime, 2);
        $rate = $runtime > 0 ? round($this->processedCount / $runtime, 2) : 0;

        $this->newLine();
        $this->info("=== Summary ===");
        $this->info("Processed: {$this->processedCount} messages");
        $this->info("Runtime: {$runtime} seconds");
        $this->info("Rate: {$rate} messages/second");
    }
}
```

### Scheduling with Custom Logic

```php
// app/Console/Kernel.php
protected function schedule(Schedule $schedule): void
{
    // Skip scheduling in certain environments
    if (app()->environment('testing')) {
        return;
    }

    // Basic scheduled task
    $schedule->command('contacts:sync')
        ->hourly()
        ->withoutOverlapping()
        ->onOneServer()
        ->runInBackground();

    // Conditional scheduling
    $schedule->command('reports:daily')
        ->dailyAt('06:00')
        ->environments(['production'])
        ->when(function () {
            return config('features.daily_reports');
        })
        ->before(function () {
            Cache::put('report-running', true);
        })
        ->after(function () {
            Cache::forget('report-running');
        });

    // Schedule with output
    $schedule->command('queue:work --stop-when-empty')
        ->everyMinute()
        ->appendOutputTo(storage_path('logs/queue.log'))
        ->emailOutputOnFailure('admin@example.com');

    // Schedule closure
    $schedule->call(function () {
        DB::table('sessions')
            ->where('last_activity', '<', now()->subHours(24))
            ->delete();
    })
    ->daily()
    ->name('cleanup-sessions')
    ->withoutOverlapping();

    // Schedule job
    $schedule->job(new PruneOldRecordsJob(), 'maintenance')
        ->weekly()
        ->sundays()
        ->at('02:00');

    // Schedule with maintenance mode check
    $schedule->command('backup:run')
        ->daily()
        ->at('03:00')
        ->evenInMaintenanceMode();

    // Frequency based on environment
    $schedule->command('metrics:collect')
        ->when(function () {
            return app()->environment('production')
                ? now()->minute === 0  // Every hour in production
                : now()->minute % 5 === 0;  // Every 5 min in dev
        });
}
```

### Artisan Generator Commands

```php
<?php

namespace App\Console\Commands;

use Illuminate\Console\GeneratorCommand;
use Symfony\Component\Console\Input\InputOption;

class MakeHandlerCommand extends GeneratorCommand
{
    protected $name = 'make:handler';
    protected $description = 'Create a new handler class';
    protected $type = 'Handler';

    protected function getStub(): string
    {
        $stub = $this->option('crud')
            ? 'handler.crud.stub'
            : 'handler.stub';

        return base_path("stubs/{$stub}");
    }

    protected function getDefaultNamespace($rootNamespace): string
    {
        return $rootNamespace . '\\Handlers';
    }

    protected function buildClass($name): string
    {
        $stub = parent::buildClass($name);

        // Replace custom placeholders
        $model = $this->option('model') ?? $this->guessModelName($name);
        $stub = str_replace('{{ model }}', $model, $stub);
        $stub = str_replace('{{ modelVariable }}', lcfirst($model), $stub);

        return $stub;
    }

    protected function guessModelName(string $name): string
    {
        // UserHandler -> User
        return str_replace('Handler', '', class_basename($name));
    }

    protected function getOptions(): array
    {
        return [
            ['model', 'm', InputOption::VALUE_OPTIONAL, 'The model for the handler'],
            ['crud', 'c', InputOption::VALUE_NONE, 'Generate CRUD methods'],
        ];
    }
}

// Usage: php artisan make:handler ContactHandler --model=Contact --crud
```

### Testing Artisan Commands

```php
<?php

namespace Tests\Feature\Console;

use App\Models\Contact;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class ContactCommandsTest extends TestCase
{
    use RefreshDatabase;

    public function test_sync_command_processes_contacts(): void
    {
        Contact::factory()->count(5)->create();

        $this->artisan('contacts:sync')
            ->expectsOutput('Starting contact sync...')
            ->expectsOutput('Synced 5 contacts')
            ->assertSuccessful();
    }

    public function test_sync_command_with_dry_run(): void
    {
        Contact::factory()->count(3)->create();

        $this->artisan('contacts:sync --dry-run')
            ->expectsOutput('DRY RUN - No changes will be made')
            ->assertSuccessful();

        // Verify no changes were made
        $this->assertDatabaseMissing('contacts', ['synced_at' => now()]);
    }

    public function test_export_command_requires_confirmation(): void
    {
        $this->artisan('contacts:export --all')
            ->expectsConfirmation('Export all contacts?', 'no')
            ->assertSuccessful();
    }

    public function test_export_command_with_force(): void
    {
        Contact::factory()->count(2)->create();

        $this->artisan('contacts:export --all --force')
            ->assertSuccessful();
    }

    public function test_command_asks_for_format(): void
    {
        $this->artisan('contacts:export')
            ->expectsQuestion('Which format?', 'csv')
            ->expectsChoice('Select columns', ['name', 'email'], ['name', 'email', 'phone'])
            ->assertSuccessful();
    }

    public function test_long_running_command_handles_signals(): void
    {
        Queue::fake();

        // Run command in background and send signal
        $this->artisan('queue:messages --limit=10')
            ->assertSuccessful();
    }

    public function test_scheduled_command_runs(): void
    {
        $this->travelTo(now()->setTime(6, 0));

        $this->artisan('schedule:test --name="reports:daily"')
            ->assertSuccessful();
    }
}
```

---

## 7. Multi-Tenancy Patterns

### Tenant Model & Middleware

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Tenant extends Model
{
    protected $fillable = ['name', 'domain', 'settings', 'is_active'];

    protected $casts = [
        'settings' => 'array',
        'is_active' => 'boolean',
    ];

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function contacts(): HasMany
    {
        return $this->hasMany(Contact::class);
    }

    public function getSetting(string $key, mixed $default = null): mixed
    {
        return data_get($this->settings, $key, $default);
    }
}
```

```php
<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use Closure;
use Illuminate\Http\Request;

class TenantMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        // Resolve tenant from subdomain, header, or user
        $tenant = $this->resolveTenant($request);

        if (!$tenant) {
            abort(404, 'Tenant not found');
        }

        if (!$tenant->is_active) {
            abort(403, 'Tenant is inactive');
        }

        // Set tenant in context
        app()->instance('tenant', $tenant);
        session(['tenant_id' => $tenant->id]);

        // Configure tenant-specific settings
        config([
            'mail.from.name' => $tenant->getSetting('mail.from_name', config('app.name')),
            'filesystems.disks.tenant' => [
                'driver' => 'local',
                'root' => storage_path("app/tenants/{$tenant->id}"),
            ],
        ]);

        return $next($request);
    }

    private function resolveTenant(Request $request): ?Tenant
    {
        // Method 1: Subdomain
        $host = $request->getHost();
        $subdomain = explode('.', $host)[0];

        if ($tenant = Tenant::where('domain', $subdomain)->first()) {
            return $tenant;
        }

        // Method 2: Header
        if ($tenantId = $request->header('X-Tenant-ID')) {
            return Tenant::find($tenantId);
        }

        // Method 3: Authenticated user's tenant
        if ($user = $request->user()) {
            return $user->tenant;
        }

        return null;
    }
}
```

### Tenant-Scoped Models

```php
<?php

namespace App\Models\Concerns;

use App\Models\Scopes\TenantScope;
use App\Models\Tenant;

trait BelongsToTenant
{
    public static function bootBelongsToTenant(): void
    {
        static::addGlobalScope(new TenantScope());

        static::creating(function ($model) {
            if (!$model->tenant_id && $tenant = app('tenant')) {
                $model->tenant_id = $tenant->id;
            }
        });
    }

    public function tenant()
    {
        return $this->belongsTo(Tenant::class);
    }

    public function scopeForTenant($query, int $tenantId)
    {
        return $query->withoutGlobalScope(TenantScope::class)
                     ->where('tenant_id', $tenantId);
    }
}

// Usage in model
class Contact extends Model
{
    use BelongsToTenant;
}
```

### Cross-Tenant Operations

```php
<?php

namespace App\Services;

use App\Models\Tenant;
use Illuminate\Support\Facades\DB;

class CrossTenantService
{
    /**
     * Execute callback for all tenants
     */
    public function forAllTenants(callable $callback): void
    {
        Tenant::where('is_active', true)
            ->cursor()
            ->each(function (Tenant $tenant) use ($callback) {
                $this->runForTenant($tenant, $callback);
            });
    }

    /**
     * Execute callback for specific tenant
     */
    public function runForTenant(Tenant $tenant, callable $callback): mixed
    {
        $previousTenant = app('tenant');

        try {
            app()->instance('tenant', $tenant);
            session(['tenant_id' => $tenant->id]);

            return $callback($tenant);
        } finally {
            // Restore previous tenant
            if ($previousTenant) {
                app()->instance('tenant', $previousTenant);
                session(['tenant_id' => $previousTenant->id]);
            } else {
                app()->forgetInstance('tenant');
                session()->forget('tenant_id');
            }
        }
    }

    /**
     * Run without tenant scope
     */
    public function withoutTenantScope(callable $callback): mixed
    {
        return Contact::withoutGlobalScope(TenantScope::class)
            ->tap(fn() => $callback());
    }
}
```

---

## 8. Authentication Advanced

### Passport OAuth Server

```php
// config/auth.php guards
'guards' => [
    'api' => [
        'driver' => 'passport',
        'provider' => 'users',
    ],
],

// AuthServiceProvider
public function boot(): void
{
    // Token scopes
    Passport::tokensCan([
        'contacts:read' => 'Read contacts',
        'contacts:write' => 'Create and update contacts',
        'contacts:delete' => 'Delete contacts',
        'admin' => 'Administrator access',
    ]);

    // Default scopes
    Passport::setDefaultScope(['contacts:read']);

    // Token lifetimes
    Passport::tokensExpireIn(now()->addDays(15));
    Passport::refreshTokensExpireIn(now()->addDays(30));
    Passport::personalAccessTokensExpireIn(now()->addMonths(6));
}

// Controller using scopes
class ContactController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth:api');
        $this->middleware('scope:contacts:read')->only(['index', 'show']);
        $this->middleware('scope:contacts:write')->only(['store', 'update']);
        $this->middleware('scope:contacts:delete')->only(['destroy']);
    }
}

// Check scopes in code
if ($request->user()->tokenCan('admin')) {
    // Admin operations
}
```

### Spatie Permission Integration

```php
// User model
use Spatie\Permission\Traits\HasRoles;

class User extends Authenticatable
{
    use HasRoles;
}

// Create roles and permissions
$adminRole = Role::create(['name' => 'admin']);
$managerRole = Role::create(['name' => 'manager']);

$permissions = [
    'contacts.view',
    'contacts.create',
    'contacts.edit',
    'contacts.delete',
    'reports.view',
    'reports.export',
    'users.manage',
];

foreach ($permissions as $permission) {
    Permission::create(['name' => $permission]);
}

// Assign permissions to roles
$adminRole->givePermissionTo(Permission::all());
$managerRole->givePermissionTo([
    'contacts.view',
    'contacts.create',
    'contacts.edit',
    'reports.view',
]);

// Assign role to user
$user->assignRole('manager');
$user->assignRole(['manager', 'editor']);

// Check permissions
if ($user->hasPermissionTo('contacts.delete')) {
    // Can delete
}

if ($user->hasRole('admin')) {
    // Is admin
}

if ($user->hasAnyRole(['admin', 'manager'])) {
    // Has admin or manager role
}

// Middleware usage
Route::middleware(['role:admin'])->group(function () {
    Route::resource('users', UserController::class);
});

Route::middleware(['permission:contacts.edit'])->group(function () {
    Route::put('contacts/{contact}', [ContactController::class, 'update']);
});

// Blade directives
@role('admin')
    <a href="/admin">Admin Panel</a>
@endrole

@can('contacts.delete')
    <button>Delete Contact</button>
@endcan
```

### Policy with Permissions

```php
<?php

namespace App\Policies;

use App\Models\Contact;
use App\Models\User;

class ContactPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasPermissionTo('contacts.view');
    }

    public function view(User $user, Contact $contact): bool
    {
        // Check permission and ownership/tenant
        return $user->hasPermissionTo('contacts.view')
            && $contact->tenant_id === $user->tenant_id;
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

        // Tenant check
        if ($contact->tenant_id !== $user->tenant_id) {
            return false;
        }

        // Additional business rules
        if ($contact->is_locked && !$user->hasRole('admin')) {
            return false;
        }

        return true;
    }

    public function delete(User $user, Contact $contact): bool
    {
        return $user->hasPermissionTo('contacts.delete')
            && $contact->tenant_id === $user->tenant_id
            && !$contact->has_active_orders;
    }

    public function restore(User $user, Contact $contact): bool
    {
        return $user->hasRole('admin');
    }

    public function forceDelete(User $user, Contact $contact): bool
    {
        return $user->hasRole('admin');
    }
}
```

---

## 9. Common Integrations

### Excel Export (Laravel Excel)

```php
<?php

namespace App\Exports;

use App\Models\Contact;
use Maatwebsite\Excel\Concerns\Exportable;
use Maatwebsite\Excel\Concerns\FromQuery;
use Maatwebsite\Excel\Concerns\WithHeadings;
use Maatwebsite\Excel\Concerns\WithMapping;
use Maatwebsite\Excel\Concerns\WithChunkReading;
use Maatwebsite\Excel\Concerns\WithStyles;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

class ContactsExport implements FromQuery, WithHeadings, WithMapping, WithChunkReading, WithStyles
{
    use Exportable;

    public function __construct(
        private readonly array $filters = [],
    ) {
    }

    public function query()
    {
        return Contact::query()
            ->filter($this->filters)
            ->with(['company', 'tags'])
            ->orderBy('last_name');
    }

    public function headings(): array
    {
        return [
            'ID',
            'First Name',
            'Last Name',
            'Email',
            'Phone',
            'Company',
            'Tags',
            'Status',
            'Created At',
        ];
    }

    public function map($contact): array
    {
        return [
            $contact->id,
            $contact->first_name,
            $contact->last_name,
            $contact->email,
            $contact->phone,
            $contact->company?->name,
            $contact->tags->pluck('name')->implode(', '),
            $contact->status->label(),
            $contact->created_at->format('Y-m-d H:i:s'),
        ];
    }

    public function chunkSize(): int
    {
        return 1000;
    }

    public function styles(Worksheet $sheet): array
    {
        return [
            1 => ['font' => ['bold' => true]],  // Header row
        ];
    }
}

// Usage
return (new ContactsExport($request->filters))
    ->download('contacts.xlsx');

// Queue export
(new ContactsExport($filters))->queue('contacts.xlsx', 's3');
```

### Excel Import

```php
<?php

namespace App\Imports;

use App\Models\Contact;
use Maatwebsite\Excel\Concerns\ToModel;
use Maatwebsite\Excel\Concerns\WithHeadingRow;
use Maatwebsite\Excel\Concerns\WithValidation;
use Maatwebsite\Excel\Concerns\WithBatchInserts;
use Maatwebsite\Excel\Concerns\WithChunkReading;
use Maatwebsite\Excel\Concerns\SkipsOnFailure;
use Maatwebsite\Excel\Concerns\SkipsFailures;
use Maatwebsite\Excel\Validators\Failure;

class ContactsImport implements ToModel, WithHeadingRow, WithValidation, WithBatchInserts, WithChunkReading, SkipsOnFailure
{
    use SkipsFailures;

    public function model(array $row): ?Contact
    {
        return new Contact([
            'first_name' => $row['first_name'],
            'last_name' => $row['last_name'],
            'email' => $row['email'],
            'phone' => $row['phone'] ?? null,
            'status' => ContactStatus::from($row['status'] ?? 'pending'),
        ]);
    }

    public function rules(): array
    {
        return [
            'first_name' => ['required', 'string', 'max:255'],
            'last_name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'unique:contacts,email'],
            'phone' => ['nullable', 'string', 'max:50'],
            'status' => ['nullable', 'string', 'in:active,pending,inactive'],
        ];
    }

    public function customValidationMessages(): array
    {
        return [
            'email.unique' => 'Contact with this email already exists.',
        ];
    }

    public function batchSize(): int
    {
        return 500;
    }

    public function chunkSize(): int
    {
        return 1000;
    }
}

// Usage
$import = new ContactsImport();
Excel::import($import, $request->file('contacts'));

// Get failures
if ($import->failures()->isNotEmpty()) {
    foreach ($import->failures() as $failure) {
        // $failure->row(), $failure->attribute(), $failure->errors()
    }
}
```

### Third-Party API Service Pattern

```php
<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

abstract class BaseApiService
{
    protected string $baseUrl;
    protected int $timeout = 30;
    protected int $retries = 3;
    protected int $retryDelay = 100;

    abstract protected function getHeaders(): array;

    protected function client(): PendingRequest
    {
        return Http::baseUrl($this->baseUrl)
            ->timeout($this->timeout)
            ->retry($this->retries, $this->retryDelay, function ($exception, $request) {
                // Retry on connection errors and 5xx responses
                return $exception instanceof \Illuminate\Http\Client\ConnectionException
                    || ($exception instanceof \Illuminate\Http\Client\RequestException
                        && $exception->response->serverError());
            })
            ->withHeaders($this->getHeaders());
    }

    protected function get(string $endpoint, array $params = []): array
    {
        return $this->request('get', $endpoint, ['query' => $params]);
    }

    protected function post(string $endpoint, array $data = []): array
    {
        return $this->request('post', $endpoint, ['json' => $data]);
    }

    protected function put(string $endpoint, array $data = []): array
    {
        return $this->request('put', $endpoint, ['json' => $data]);
    }

    protected function delete(string $endpoint): array
    {
        return $this->request('delete', $endpoint);
    }

    protected function request(string $method, string $endpoint, array $options = []): array
    {
        $startTime = microtime(true);

        try {
            $response = $this->client()->$method($endpoint, $options['json'] ?? $options['query'] ?? []);

            $this->logRequest($method, $endpoint, $response, microtime(true) - $startTime);

            if ($response->successful()) {
                return $response->json() ?? [];
            }

            $this->handleErrorResponse($response);

        } catch (\Throwable $e) {
            Log::error("API request failed: {$method} {$endpoint}", [
                'error' => $e->getMessage(),
                'duration' => microtime(true) - $startTime,
            ]);
            throw $e;
        }
    }

    protected function handleErrorResponse(Response $response): void
    {
        $body = $response->json();

        match ($response->status()) {
            401 => throw new \RuntimeException('Authentication failed'),
            403 => throw new \RuntimeException('Access forbidden'),
            404 => throw new \RuntimeException('Resource not found'),
            422 => throw new \InvalidArgumentException($body['message'] ?? 'Validation failed'),
            429 => throw new \RuntimeException('Rate limit exceeded'),
            default => throw new \RuntimeException($body['message'] ?? 'API request failed'),
        };
    }

    protected function logRequest(string $method, string $endpoint, Response $response, float $duration): void
    {
        Log::debug("API: {$method} {$endpoint}", [
            'status' => $response->status(),
            'duration' => round($duration * 1000, 2) . 'ms',
        ]);
    }

    protected function cached(string $key, int $ttl, callable $callback): mixed
    {
        return Cache::remember($key, $ttl, $callback);
    }
}

// Concrete implementation
class CrmApiService extends BaseApiService
{
    protected string $baseUrl = 'https://api.crm.example.com/v1';

    public function __construct()
    {
        $this->baseUrl = config('services.crm.base_url');
    }

    protected function getHeaders(): array
    {
        return [
            'Authorization' => 'Bearer ' . config('services.crm.api_key'),
            'Accept' => 'application/json',
            'X-Client-Id' => config('services.crm.client_id'),
        ];
    }

    public function getContacts(array $params = []): array
    {
        return $this->get('/contacts', $params);
    }

    public function getContact(string $id): array
    {
        return $this->cached(
            "crm:contact:{$id}",
            ttl: 300,
            callback: fn() => $this->get("/contacts/{$id}")
        );
    }

    public function createContact(array $data): array
    {
        $result = $this->post('/contacts', $data);
        Cache::forget("crm:contacts:list");
        return $result;
    }

    public function updateContact(string $id, array $data): array
    {
        $result = $this->put("/contacts/{$id}", $data);
        Cache::forget("crm:contact:{$id}");
        return $result;
    }

    public function syncContact(Contact $contact): array
    {
        $data = [
            'external_id' => $contact->id,
            'first_name' => $contact->first_name,
            'last_name' => $contact->last_name,
            'email' => $contact->email,
            'phone' => $contact->phone,
        ];

        if ($contact->external_crm_id) {
            return $this->updateContact($contact->external_crm_id, $data);
        }

        return $this->createContact($data);
    }
}
```

### Image Processing (Intervention)

```php
<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\ImageManager;
use Intervention\Image\Drivers\Gd\Driver;

class ImageService
{
    private ImageManager $manager;

    public function __construct()
    {
        $this->manager = new ImageManager(new Driver());
    }

    public function processAvatar(UploadedFile $file, int $userId): string
    {
        $image = $this->manager->read($file);

        // Resize to standard sizes
        $sizes = [
            'thumb' => 50,
            'small' => 100,
            'medium' => 200,
            'large' => 400,
        ];

        $basePath = "avatars/{$userId}";
        $filename = time() . '.webp';

        foreach ($sizes as $size => $dimension) {
            $resized = $image->cover($dimension, $dimension);

            Storage::disk('public')->put(
                "{$basePath}/{$size}_{$filename}",
                $resized->toWebp(80)
            );
        }

        return "{$basePath}/{$filename}";
    }

    public function processProductImage(UploadedFile $file, int $productId): array
    {
        $image = $this->manager->read($file);
        $basePath = "products/{$productId}";
        $filename = uniqid() . '.webp';

        // Original (constrained)
        $original = $image->scaleDown(1920, 1920);
        Storage::disk('public')->put(
            "{$basePath}/original_{$filename}",
            $original->toWebp(90)
        );

        // Thumbnail
        $thumb = $image->cover(300, 300);
        Storage::disk('public')->put(
            "{$basePath}/thumb_{$filename}",
            $thumb->toWebp(80)
        );

        return [
            'original' => "{$basePath}/original_{$filename}",
            'thumbnail' => "{$basePath}/thumb_{$filename}",
        ];
    }
}
```

---

## 10. Performance Optimization

### Query Optimization

```php
// Avoid N+1 with eager loading
$contacts = Contact::with(['company', 'tags', 'latestActivity'])->get();

// Select only needed columns
$contacts = Contact::select(['id', 'name', 'email', 'company_id'])
    ->with('company:id,name')
    ->get();

// Chunking for large datasets
Contact::where('status', 'active')
    ->chunk(1000, function ($contacts) {
        foreach ($contacts as $contact) {
            // Process
        }
    });

// Lazy collection for memory efficiency
Contact::where('status', 'active')
    ->lazy()
    ->each(function ($contact) {
        // Process one at a time
    });

// Cursor for streaming
foreach (Contact::cursor() as $contact) {
    // Memory-efficient iteration
}

// Subquery optimization
$latestOrder = Order::select('user_id')
    ->selectRaw('MAX(created_at) as latest_order_at')
    ->groupBy('user_id');

$users = User::joinSub($latestOrder, 'latest_orders', function ($join) {
    $join->on('users.id', '=', 'latest_orders.user_id');
})->get();
```

### Caching Strategies

```php
// Cache model queries
$popularProducts = Cache::remember('popular-products', 3600, function () {
    return Product::withCount('orders')
        ->orderByDesc('orders_count')
        ->limit(10)
        ->get();
});

// Cache tags for invalidation
Cache::tags(['products', 'homepage'])->put('featured', $featured, 3600);
Cache::tags(['products'])->flush();  // Clear all product caches

// Model caching trait
trait Cacheable
{
    public static function findCached(int $id): ?static
    {
        return Cache::remember(
            static::getCacheKey($id),
            static::$cacheTtl ?? 3600,
            fn() => static::find($id)
        );
    }

    public static function getCacheKey(int $id): string
    {
        return sprintf('%s:%d', (new static)->getTable(), $id);
    }

    public static function clearCache(int $id): void
    {
        Cache::forget(static::getCacheKey($id));
    }

    protected static function bootCacheable(): void
    {
        static::updated(fn($model) => static::clearCache($model->id));
        static::deleted(fn($model) => static::clearCache($model->id));
    }
}

// Route caching
Route::middleware('cache.response:3600')->group(function () {
    Route::get('/api/public/products', [ProductController::class, 'index']);
});
```

### Database Indexing Patterns

```php
// Migration with indexes
Schema::create('contacts', function (Blueprint $table) {
    $table->id();
    $table->foreignId('tenant_id')->constrained()->cascadeOnDelete();
    $table->foreignId('company_id')->nullable()->constrained();
    $table->string('email');
    $table->string('first_name');
    $table->string('last_name');
    $table->string('status', 20)->default('pending');
    $table->timestamps();
    $table->softDeletes();

    // Single column indexes
    $table->index('email');
    $table->index('status');
    $table->index('created_at');

    // Composite indexes (order matters!)
    $table->index(['tenant_id', 'status']);
    $table->index(['tenant_id', 'email']);
    $table->index(['tenant_id', 'last_name', 'first_name']);
    $table->index(['tenant_id', 'deleted_at', 'status']);  // For soft delete queries

    // Unique constraint
    $table->unique(['tenant_id', 'email']);
});
```

---

## 11. Testing Advanced

### Test Helpers & Traits

```php
<?php

namespace Tests;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

trait TestHelpers
{
    protected ?Tenant $tenant = null;
    protected ?User $user = null;

    protected function setUpTenant(): void
    {
        $this->tenant = Tenant::factory()->create();
        session(['tenant_id' => $this->tenant->id]);
        app()->instance('tenant', $this->tenant);
    }

    protected function actingAsAdmin(): self
    {
        $this->user = User::factory()
            ->for($this->tenant)
            ->create();

        $this->user->assignRole('admin');

        return $this->actingAs($this->user);
    }

    protected function actingAsManager(): self
    {
        $this->user = User::factory()
            ->for($this->tenant)
            ->create();

        $this->user->assignRole('manager');

        return $this->actingAs($this->user);
    }

    protected function assertDatabaseHasForTenant(string $table, array $data): void
    {
        $this->assertDatabaseHas($table, array_merge($data, [
            'tenant_id' => $this->tenant->id,
        ]));
    }
}
```

### Mocking External Services

```php
<?php

namespace Tests\Feature;

use App\Services\CrmApiService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ContactSyncTest extends TestCase
{
    public function test_syncs_contact_to_external_crm(): void
    {
        Http::fake([
            'api.crm.example.com/v1/contacts' => Http::response([
                'id' => 'crm-123',
                'email' => 'test@example.com',
            ], 201),
        ]);

        $contact = Contact::factory()->create([
            'email' => 'test@example.com',
        ]);

        $service = app(CrmApiService::class);
        $result = $service->syncContact($contact);

        $this->assertEquals('crm-123', $result['id']);

        Http::assertSent(function ($request) use ($contact) {
            return $request->url() === 'https://api.crm.example.com/v1/contacts'
                && $request['email'] === $contact->email;
        });
    }

    public function test_handles_crm_api_failure(): void
    {
        Http::fake([
            'api.crm.example.com/*' => Http::response(['error' => 'Server error'], 500),
        ]);

        $contact = Contact::factory()->create();
        $service = app(CrmApiService::class);

        $this->expectException(\RuntimeException::class);
        $service->syncContact($contact);
    }
}
```

### Database Testing Patterns

```php
<?php

namespace Tests\Feature;

use App\Models\Contact;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ContactRepositoryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTenant();
    }

    public function test_creates_contact_with_tags(): void
    {
        $tags = Tag::factory()->count(3)->create();

        $data = [
            'first_name' => 'John',
            'last_name' => 'Doe',
            'email' => 'john@example.com',
        ];

        $repository = app(ContactRepository::class);
        $contact = $repository->createWithTags($data, $tags->pluck('id')->toArray());

        $this->assertDatabaseHasForTenant('contacts', [
            'email' => 'john@example.com',
        ]);

        $this->assertCount(3, $contact->tags);
    }

    public function test_search_returns_matching_contacts(): void
    {
        Contact::factory()->create(['first_name' => 'Alice', 'last_name' => 'Smith']);
        Contact::factory()->create(['first_name' => 'Bob', 'last_name' => 'Jones']);
        Contact::factory()->create(['first_name' => 'Charlie', 'last_name' => 'Smith']);

        $repository = app(ContactRepository::class);
        $results = $repository->search('Smith');

        $this->assertCount(2, $results);
    }

    public function test_respects_tenant_isolation(): void
    {
        $otherTenant = Tenant::factory()->create();

        // Create contact for other tenant
        Contact::factory()->create([
            'tenant_id' => $otherTenant->id,
            'email' => 'other@example.com',
        ]);

        // Create contact for current tenant
        Contact::factory()->create([
            'tenant_id' => $this->tenant->id,
            'email' => 'current@example.com',
        ]);

        $repository = app(ContactRepository::class);
        $contacts = $repository->all();

        $this->assertCount(1, $contacts);
        $this->assertEquals('current@example.com', $contacts->first()->email);
    }
}
```

---

## 12. Debugging & Profiling

### Query Logging

```php
// Enable query log
DB::enableQueryLog();

// Run queries
$contacts = Contact::with('company')->get();
$orders = Order::where('status', 'active')->get();

// Get logged queries
$queries = DB::getQueryLog();

foreach ($queries as $query) {
    Log::debug('Query', [
        'sql' => $query['query'],
        'bindings' => $query['bindings'],
        'time' => $query['time'] . 'ms',
    ]);
}

// Disable when done
DB::disableQueryLog();
```

### Performance Listener

```php
<?php

namespace App\Listeners;

use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\Log;

class QueryExecutedListener
{
    public function handle(QueryExecuted $event): void
    {
        if ($event->time > 100) {  // Slow query threshold: 100ms
            Log::warning('Slow query detected', [
                'sql' => $event->sql,
                'bindings' => $event->bindings,
                'time' => $event->time . 'ms',
                'connection' => $event->connectionName,
            ]);
        }
    }
}

// Register in EventServiceProvider
protected $listen = [
    QueryExecuted::class => [
        QueryExecutedListener::class,
    ],
];
```

### Debug Helper

```php
<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class Debug
{
    private static array $timers = [];

    public static function startTimer(string $name): void
    {
        self::$timers[$name] = [
            'start' => microtime(true),
            'memory_start' => memory_get_usage(true),
        ];
    }

    public static function endTimer(string $name): array
    {
        if (!isset(self::$timers[$name])) {
            return [];
        }

        $timer = self::$timers[$name];
        $result = [
            'name' => $name,
            'duration_ms' => round((microtime(true) - $timer['start']) * 1000, 2),
            'memory_used_mb' => round((memory_get_usage(true) - $timer['memory_start']) / 1024 / 1024, 2),
        ];

        unset(self::$timers[$name]);

        Log::debug("Timer: {$name}", $result);

        return $result;
    }

    public static function queryCount(callable $callback): array
    {
        DB::enableQueryLog();
        $result = $callback();
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        return [
            'result' => $result,
            'query_count' => count($queries),
            'total_time_ms' => array_sum(array_column($queries, 'time')),
            'queries' => $queries,
        ];
    }

    public static function dump(...$vars): void
    {
        foreach ($vars as $var) {
            Log::debug('Debug dump', ['value' => $var]);
        }
    }
}

// Usage
Debug::startTimer('contact-sync');
$result = $service->syncContacts();
Debug::endTimer('contact-sync');

$debug = Debug::queryCount(function () {
    return Contact::with('company', 'tags')->get();
});
// $debug['query_count'], $debug['total_time_ms']
```

---

## Version Information

- **Skill Version**: 1.0.0
- **Laravel Version**: 11.x / 12.x
- **Last Updated**: 2025-01-01

## See Also

- **SKILL.md**: Quick reference for daily Laravel development
- **PHP Skill**: Language fundamentals (prerequisite)
- **Context7**: For package-specific documentation (Livewire, Filament, etc.)
