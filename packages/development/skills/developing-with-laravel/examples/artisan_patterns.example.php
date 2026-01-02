<?php
/**
 * Artisan CLI Patterns Example
 *
 * This example demonstrates advanced Artisan patterns including:
 * - Interactive commands with prompts
 * - Progress bars and output formatting
 * - Long-running consumer commands
 * - Signal handling for graceful shutdown
 * - Scheduling patterns
 */

declare(strict_types=1);

namespace App\Examples;

use App\Models\Contact;
use App\Services\ExportService;
use App\Services\ImportService;
use Illuminate\Console\Command;
use Illuminate\Console\ConfirmableTrait;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\LazyCollection;

// =============================================================================
// Interactive Command with All Prompt Types
// =============================================================================

class ImportContactsCommand extends Command
{
    use ConfirmableTrait;

    protected $signature = 'contacts:import
                            {file? : Path to the import file}
                            {--format= : File format (csv, xlsx, json)}
                            {--dry-run : Preview without importing}
                            {--force : Skip confirmation in production}';

    protected $description = 'Import contacts from a file';

    public function handle(ImportService $importService): int
    {
        // Confirm in production
        if (!$this->confirmToProceed()) {
            return self::FAILURE;
        }

        // Get file path (argument or prompt)
        $file = $this->argument('file') ?? $this->ask(
            'Enter the path to the import file',
            storage_path('imports/contacts.csv')
        );

        if (!file_exists($file)) {
            $this->error("File not found: {$file}");
            return self::FAILURE;
        }

        // Get format (option or choice)
        $format = $this->option('format') ?? $this->choice(
            'What is the file format?',
            ['csv', 'xlsx', 'json'],
            0  // Default to csv
        );

        // Multi-select for columns
        $availableColumns = ['first_name', 'last_name', 'email', 'phone', 'company', 'status'];
        $columns = $this->choice(
            'Which columns should be imported?',
            $availableColumns,
            null,
            null,
            true  // Allow multiple
        );

        // Confirm settings
        $this->newLine();
        $this->info('Import Settings:');
        $this->table(
            ['Setting', 'Value'],
            [
                ['File', $file],
                ['Format', $format],
                ['Columns', implode(', ', $columns)],
                ['Dry Run', $this->option('dry-run') ? 'Yes' : 'No'],
            ]
        );

        if (!$this->confirm('Proceed with import?', true)) {
            $this->info('Import cancelled.');
            return self::SUCCESS;
        }

        // Perform import
        $isDryRun = $this->option('dry-run');

        try {
            $result = $importService->import($file, $format, $columns, $isDryRun);

            $this->newLine();
            $this->info('Import ' . ($isDryRun ? 'preview' : 'completed') . ':');
            $this->table(
                ['Metric', 'Count'],
                [
                    ['Total rows', $result['total']],
                    ['Imported', $result['imported']],
                    ['Skipped', $result['skipped']],
                    ['Errors', $result['errors']],
                ]
            );

            if (!empty($result['error_details'])) {
                $this->warn('Errors encountered:');
                foreach (array_slice($result['error_details'], 0, 10) as $error) {
                    $this->line("  - Row {$error['row']}: {$error['message']}");
                }
            }

            return self::SUCCESS;

        } catch (\Throwable $e) {
            $this->error("Import failed: {$e->getMessage()}");
            return self::FAILURE;
        }
    }
}

// =============================================================================
// Progress Bar and Batch Processing
// =============================================================================

class ExportContactsCommand extends Command
{
    protected $signature = 'contacts:export
                            {--format=csv : Export format (csv, xlsx, json)}
                            {--status= : Filter by status}
                            {--output= : Output file path}';

    protected $description = 'Export contacts to a file';

    public function handle(ExportService $exportService): int
    {
        $format = $this->option('format');
        $status = $this->option('status');
        $output = $this->option('output')
            ?? storage_path("exports/contacts-" . now()->format('Y-m-d-His') . ".{$format}");

        $this->info('Preparing export...');

        // Get query with optional filter
        $query = Contact::query()
            ->when($status, fn($q) => $q->where('status', $status))
            ->with(['company:id,name', 'tags:id,name']);

        $total = $query->count();

        if ($total === 0) {
            $this->warn('No contacts found to export.');
            return self::SUCCESS;
        }

        $this->info("Exporting {$total} contacts to {$format}...");

        // Progress bar with batch processing
        $bar = $this->output->createProgressBar($total);
        $bar->setFormat(' %current%/%max% [%bar%] %percent:3s%% %elapsed:6s%/%estimated:-6s% %memory:6s%');
        $bar->start();

        $exported = 0;

        // Use chunk for memory efficiency
        $query->chunk(500, function ($contacts) use ($exportService, $format, $output, $bar, &$exported) {
            $exportService->appendChunk($output, $format, $contacts);
            $exported += $contacts->count();
            $bar->advance($contacts->count());
        });

        $bar->finish();

        $this->newLine(2);
        $this->info("Successfully exported {$exported} contacts to: {$output}");

        return self::SUCCESS;
    }
}

// =============================================================================
// Long-Running Consumer with Signal Handling
// =============================================================================

class ProcessQueueCommand extends Command
{
    protected $signature = 'queue:process-external
                            {queue=default : Queue name to process}
                            {--limit=0 : Max messages to process (0 = unlimited)}
                            {--timeout=0 : Max runtime in seconds (0 = unlimited)}
                            {--sleep=3 : Sleep seconds when empty}
                            {--memory=128 : Memory limit in MB}';

    protected $description = 'Process messages from external message queue';

    private bool $shouldExit = false;
    private int $processed = 0;
    private float $startTime;

    public function handle(): int
    {
        $this->startTime = microtime(true);
        $this->registerSignalHandlers();

        $queue = $this->argument('queue');
        $limit = (int) $this->option('limit');
        $timeout = (int) $this->option('timeout');
        $sleep = (int) $this->option('sleep');
        $memoryLimit = (int) $this->option('memory');

        $this->info("Starting queue processor (PID: " . getmypid() . ")");
        $this->info("Queue: {$queue} | Limit: " . ($limit ?: 'unlimited') .
                   " | Timeout: " . ($timeout ?: 'unlimited') . "s");

        while (!$this->shouldExit) {
            // Check stop conditions
            if ($this->shouldStop($limit, $timeout, $memoryLimit)) {
                break;
            }

            // Fetch message from external queue
            $message = $this->fetchMessage($queue);

            if ($message === null) {
                $this->line("<comment>[" . now()->format('H:i:s') . "] Queue empty, sleeping {$sleep}s...</comment>");
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
            $this->warn('PCNTL not loaded - signal handling disabled');
            return;
        }

        pcntl_async_signals(true);

        pcntl_signal(SIGTERM, function () {
            $this->warn("\nSIGTERM received - finishing current message...");
            $this->shouldExit = true;
        });

        pcntl_signal(SIGINT, function () {
            $this->warn("\nSIGINT received - finishing current message...");
            $this->shouldExit = true;
        });

        pcntl_signal(SIGUSR1, function () {
            $this->outputStatus();
        });
    }

    private function shouldStop(int $limit, int $timeout, int $memoryLimit): bool
    {
        if ($limit > 0 && $this->processed >= $limit) {
            $this->info("Limit reached ({$limit} messages)");
            return true;
        }

        if ($timeout > 0) {
            $runtime = microtime(true) - $this->startTime;
            if ($runtime >= $timeout) {
                $this->info("Timeout reached ({$timeout}s)");
                return true;
            }
        }

        $memoryUsed = memory_get_usage(true) / 1024 / 1024;
        if ($memoryUsed >= $memoryLimit * 0.9) {
            $this->warn("Memory limit approaching ({$memoryLimit}MB)");
            return true;
        }

        return false;
    }

    private function fetchMessage(string $queue): ?object
    {
        // Simulated - replace with actual queue client
        return null;
    }

    private function processMessage(object $message): void
    {
        $this->line("[" . now()->format('H:i:s') . "] Processing: {$message->id}");

        try {
            // Process message
            $this->processed++;
            $this->info("  <info>Processed:</info> {$message->id}");

        } catch (\Throwable $e) {
            $this->error("  <error>Failed:</error> {$e->getMessage()}");
            Log::error('Queue processing failed', [
                'message_id' => $message->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function outputStatus(): void
    {
        $runtime = round(microtime(true) - $this->startTime, 1);
        $memory = round(memory_get_usage(true) / 1024 / 1024, 1);
        $rate = $runtime > 0 ? round($this->processed / $runtime, 2) : 0;

        $this->newLine();
        $this->info("=== Status ===");
        $this->line("Processed: {$this->processed} | Runtime: {$runtime}s | Rate: {$rate}/s | Memory: {$memory}MB");
        $this->newLine();
    }

    private function outputSummary(): void
    {
        $runtime = round(microtime(true) - $this->startTime, 2);
        $rate = $runtime > 0 ? round($this->processed / $runtime, 2) : 0;

        $this->newLine();
        $this->info("=== Summary ===");
        $this->table(
            ['Metric', 'Value'],
            [
                ['Total Processed', $this->processed],
                ['Runtime', "{$runtime}s"],
                ['Rate', "{$rate}/s"],
                ['Peak Memory', round(memory_get_peak_usage(true) / 1024 / 1024, 1) . 'MB'],
            ]
        );
    }
}

// =============================================================================
// Scheduled Tasks (routes/console.php)
// =============================================================================

use Illuminate\Support\Facades\Schedule;

// Daily cleanup
Schedule::command('contacts:cleanup --days=90')
    ->daily()
    ->at('02:00')
    ->withoutOverlapping()
    ->onOneServer()
    ->environments(['production'])
    ->emailOutputOnFailure('admin@example.com');

// Hourly sync
Schedule::command('contacts:sync')
    ->hourly()
    ->runInBackground()
    ->withoutOverlapping(expiresAfter: 60);

// Every 5 minutes with conditions
Schedule::command('queue:process-external --limit=100 --timeout=240')
    ->everyFiveMinutes()
    ->when(function () {
        return config('queue.external.enabled', false);
    })
    ->onOneServer();

// Weekly report
Schedule::command('reports:weekly')
    ->weeklyOn(1, '08:00')  // Monday at 8am
    ->environments(['production']);

// Custom schedule with closure
Schedule::call(function () {
    DB::table('sessions')
        ->where('last_activity', '<', now()->subHours(24))
        ->delete();
})
->daily()
->name('cleanup-sessions')
->withoutOverlapping();

// Job scheduling
Schedule::job(new App\Jobs\ProcessDailyMetrics(), 'metrics')
    ->dailyAt('00:15')
    ->onOneServer();

// =============================================================================
// Custom Generator Command
// =============================================================================

use Illuminate\Console\GeneratorCommand;

class MakeServiceCommand extends GeneratorCommand
{
    protected $name = 'make:service';
    protected $description = 'Create a new service class';
    protected $type = 'Service';

    protected function getStub(): string
    {
        return base_path('stubs/service.stub');
    }

    protected function getDefaultNamespace($rootNamespace): string
    {
        return $rootNamespace . '\\Services';
    }
}
