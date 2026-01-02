<?php
/**
 * Queue Workflow Example
 *
 * This example demonstrates Laravel queue patterns including:
 * - Job definition with retries and backoff
 * - Job batching
 * - Job chaining
 * - Rate limiting
 * - Unique jobs
 */

declare(strict_types=1);

namespace App\Examples;

use App\Models\Contact;
use App\Models\User;
use App\Services\ExportService;
use App\Notifications\ExportReadyNotification;
use App\Notifications\ExportFailedNotification;
use Illuminate\Bus\Batchable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Log;
use Throwable;

// =============================================================================
// Job with Full Configuration
// =============================================================================

class ExportContactsJob implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Number of retry attempts
     */
    public int $tries = 3;

    /**
     * Backoff intervals in seconds
     */
    public array $backoff = [30, 60, 120];

    /**
     * Maximum exceptions before permanent failure
     */
    public int $maxExceptions = 2;

    /**
     * Timeout in seconds
     */
    public int $timeout = 600;

    /**
     * Unique lock duration in seconds
     */
    public int $uniqueFor = 3600;

    public function __construct(
        public readonly int $userId,
        public readonly array $filters,
        public readonly string $format = 'csv',
    ) {
    }

    /**
     * Unique identifier for preventing duplicate jobs
     */
    public function uniqueId(): string
    {
        return "export-contacts-{$this->userId}-" . md5(json_encode($this->filters));
    }

    /**
     * Rate limiting and overlapping prevention
     */
    public function middleware(): array
    {
        return [
            new RateLimited('exports'),
            new WithoutOverlapping("export-{$this->userId}"),
        ];
    }

    /**
     * Execute the job
     */
    public function handle(ExportService $exportService): void
    {
        Log::info('Starting contact export', [
            'user_id' => $this->userId,
            'filters' => $this->filters,
            'format' => $this->format,
        ]);

        // Get contacts with filters
        $contacts = Contact::query()
            ->filter($this->filters)
            ->with(['company:id,name', 'tags:id,name'])
            ->cursor();

        // Generate export file
        $filename = "contacts-{$this->userId}-" . now()->format('Y-m-d-His') . ".{$this->format}";
        $path = $exportService->export($contacts, $this->format, $filename);

        // Notify user
        $user = User::find($this->userId);
        $user?->notify(new ExportReadyNotification($path, $filename));

        Log::info('Contact export completed', [
            'user_id' => $this->userId,
            'path' => $path,
        ]);
    }

    /**
     * Handle job failure
     */
    public function failed(?Throwable $exception): void
    {
        Log::error('Contact export failed', [
            'user_id' => $this->userId,
            'error' => $exception?->getMessage(),
        ]);

        $user = User::find($this->userId);
        $user?->notify(new ExportFailedNotification($exception?->getMessage()));
    }

    /**
     * Maximum time to attempt job
     */
    public function retryUntil(): \DateTime
    {
        return now()->addHours(2);
    }

    /**
     * Tags for monitoring
     */
    public function tags(): array
    {
        return ['export', 'contacts', "user:{$this->userId}"];
    }
}

// =============================================================================
// Rate Limiter Configuration (AppServiceProvider)
// =============================================================================

// In boot() method:
RateLimiter::for('exports', function (object $job) {
    return [
        Limit::perMinute(5)->by($job->userId),
        Limit::perHour(50)->by($job->userId),
    ];
});

RateLimiter::for('api-sync', function (object $job) {
    return Limit::perSecond(10);
});

// =============================================================================
// Batchable Job
// =============================================================================

class ProcessContactChunk implements ShouldQueue
{
    use Batchable, Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public readonly array $contactIds,
        public readonly string $operation,
    ) {
    }

    public function handle(): void
    {
        // Check if batch was cancelled
        if ($this->batch()?->cancelled()) {
            return;
        }

        $contacts = Contact::whereIn('id', $this->contactIds)->get();

        foreach ($contacts as $contact) {
            match ($this->operation) {
                'sync' => $this->syncContact($contact),
                'archive' => $contact->update(['status' => 'archived']),
                'delete' => $contact->delete(),
                default => throw new \InvalidArgumentException("Unknown operation: {$this->operation}"),
            };
        }
    }

    private function syncContact(Contact $contact): void
    {
        // Sync logic
    }

    public function tags(): array
    {
        return ['batch', $this->operation, 'chunk:' . count($this->contactIds)];
    }
}

// =============================================================================
// Batch Dispatch Example
// =============================================================================

class BulkContactOperationService
{
    public function processBulkOperation(array $contactIds, string $operation, User $user): string
    {
        // Split into chunks
        $chunks = array_chunk($contactIds, 100);

        // Create batch
        $batch = Bus::batch(
            collect($chunks)->map(fn($chunk) => new ProcessContactChunk($chunk, $operation))
        )
        ->then(function (\Illuminate\Bus\Batch $batch) use ($user, $operation) {
            // All jobs completed successfully
            Log::info('Bulk operation completed', [
                'batch_id' => $batch->id,
                'operation' => $operation,
                'total_jobs' => $batch->totalJobs,
            ]);

            $user->notify(new BulkOperationCompleteNotification($batch, $operation));
        })
        ->catch(function (\Illuminate\Bus\Batch $batch, Throwable $e) use ($user) {
            // First job failure
            Log::error('Bulk operation failed', [
                'batch_id' => $batch->id,
                'error' => $e->getMessage(),
            ]);

            $user->notify(new BulkOperationFailedNotification($batch, $e->getMessage()));
        })
        ->finally(function (\Illuminate\Bus\Batch $batch) {
            // Always runs
            Cache::forget("batch-progress:{$batch->id}");
        })
        ->allowFailures()
        ->onQueue('bulk-operations')
        ->name("Bulk {$operation} - " . count($contactIds) . " contacts")
        ->dispatch();

        return $batch->id;
    }

    public function getBatchStatus(string $batchId): array
    {
        $batch = Bus::findBatch($batchId);

        if (!$batch) {
            return ['error' => 'Batch not found'];
        }

        return [
            'id' => $batch->id,
            'name' => $batch->name,
            'total_jobs' => $batch->totalJobs,
            'pending_jobs' => $batch->pendingJobs,
            'failed_jobs' => $batch->failedJobs,
            'progress' => $batch->progress(),
            'finished' => $batch->finished(),
            'cancelled' => $batch->cancelled(),
            'created_at' => $batch->createdAt->toISOString(),
            'finished_at' => $batch->finishedAt?->toISOString(),
        ];
    }

    public function cancelBatch(string $batchId): bool
    {
        $batch = Bus::findBatch($batchId);
        $batch?->cancel();

        return $batch !== null;
    }
}

// =============================================================================
// Job Chaining
// =============================================================================

class ContactImportService
{
    public function importFile(string $filePath, User $user): void
    {
        Bus::chain([
            new ValidateImportFile($filePath, $user->id),
            new ParseImportFile($filePath, $user->id),
            new ProcessImportedContacts($filePath, $user->id),
            new CleanupImportFile($filePath),
            new SendImportCompleteNotification($user->id, $filePath),
        ])
        ->onQueue('imports')
        ->catch(function (Throwable $e) use ($user, $filePath) {
            Log::error('Import chain failed', [
                'file' => $filePath,
                'error' => $e->getMessage(),
            ]);

            $user->notify(new ImportFailedNotification($e->getMessage()));
        })
        ->dispatch();
    }
}

class ValidateImportFile implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(
        public readonly string $filePath,
        public readonly int $userId,
    ) {
    }

    public function handle(): void
    {
        // Validate file exists and is readable
        if (!file_exists($this->filePath)) {
            throw new \RuntimeException("Import file not found: {$this->filePath}");
        }

        // Validate file format
        $extension = pathinfo($this->filePath, PATHINFO_EXTENSION);
        if (!in_array($extension, ['csv', 'xlsx', 'json'])) {
            throw new \RuntimeException("Unsupported file format: {$extension}");
        }

        // Validate file size
        $size = filesize($this->filePath);
        if ($size > 50 * 1024 * 1024) {  // 50MB limit
            throw new \RuntimeException("File too large: " . round($size / 1024 / 1024, 2) . "MB");
        }

        Log::info('Import file validated', ['file' => $this->filePath]);
    }
}

// =============================================================================
// Delayed and Conditional Dispatch
// =============================================================================

// Delayed dispatch
ExportContactsJob::dispatch($userId, $filters)
    ->delay(now()->addMinutes(5));

// Dispatch after response sent
ExportContactsJob::dispatchAfterResponse($userId, $filters);

// Conditional dispatch
ExportContactsJob::dispatchIf(
    $user->hasPermission('contacts.export'),
    $userId,
    $filters
);

// Dispatch unless
ExportContactsJob::dispatchUnless(
    $user->isRateLimited(),
    $userId,
    $filters
);

// Synchronous dispatch (for testing)
ExportContactsJob::dispatchSync($userId, $filters);
