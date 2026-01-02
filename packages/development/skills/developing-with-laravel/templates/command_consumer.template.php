<?php
/**
 * Long-Running Consumer Command Template
 *
 * Template Variables:
 *   name: Command class name (e.g., "ProcessMessageQueue")
 *   signature: Command signature
 *   description: Command description
 *   service: Injected service class
 *   fetch_method: Method to fetch items
 *   process_method: Method to process items
 *
 * Output: app/Console/Commands/{{ name }}Command.php
 */

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\{{ service | default('QueueService') }};
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class {{ name }}Command extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = '{{ signature | default('queue:' ~ (name | lower)) }}
                            {--limit=0 : Maximum items to process (0 = unlimited)}
                            {--timeout=0 : Maximum runtime in seconds (0 = unlimited)}
                            {--sleep=1 : Seconds to sleep when queue is empty}
                            {--memory=128 : Memory limit in MB}';

    /**
     * The console command description.
     */
    protected $description = '{{ description | default('Process items from queue (long-running)') }}';

    private bool $shouldExit = false;
    private int $processedCount = 0;
    private float $startTime;

    public function __construct(
        private readonly {{ service | default('QueueService') }} $service,
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

        $this->info("Starting {{ name | lower }} (PID: " . getmypid() . ")");
        $this->info("Limit: " . ($limit ?: 'unlimited') .
                    ", Timeout: " . ($timeout ?: 'unlimited') . "s" .
                    ", Memory: {$memoryLimit}MB");

        while (!$this->shouldExit) {
            // Check termination conditions
            if ($this->shouldStop($limit, $timeout, $memoryLimit)) {
                break;
            }

            // Fetch next item
            $item = $this->service->{{ fetch_method | default('fetch') }}();

            if ($item === null) {
                $this->line("<comment>Queue empty, sleeping {$sleep}s...</comment>");
                sleep($sleep);
                continue;
            }

            $this->processItem($item);
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

        // Graceful shutdown on SIGTERM
        pcntl_signal(SIGTERM, function () {
            $this->warn('SIGTERM received, finishing current item...');
            $this->shouldExit = true;
        });

        // Graceful shutdown on SIGINT (Ctrl+C)
        pcntl_signal(SIGINT, function () {
            $this->warn('SIGINT received, finishing current item...');
            $this->shouldExit = true;
        });

        // Status output on SIGUSR1
        pcntl_signal(SIGUSR1, function () {
            $this->outputStatus();
        });

        // Reload config on SIGHUP (optional)
        pcntl_signal(SIGHUP, function () {
            $this->info('SIGHUP received, reloading configuration...');
            // Reload config if needed
        });
    }

    private function shouldStop(int $limit, int $timeout, int $memoryLimit): bool
    {
        // Check item limit
        if ($limit > 0 && $this->processedCount >= $limit) {
            $this->info("Item limit ({$limit}) reached");
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
        if ($memoryUsed >= $memoryLimit * 0.9) {  // 90% threshold
            $this->warn("Memory limit ({$memoryLimit}MB) approached, stopping");
            return true;
        }

        return false;
    }

    private function processItem(object $item): void
    {
        try {
            $this->line("Processing: {$item->id}");

            $this->service->{{ process_method | default('process') }}($item);
            $this->service->acknowledge($item);

            $this->processedCount++;
            $this->info("<info>Processed:</info> {$item->id}");

        } catch (\Throwable $e) {
            $this->error("Failed: {$item->id} - {$e->getMessage()}");
            Log::error('{{ name }} processing failed', [
                'item_id' => $item->id,
                'error' => $e->getMessage(),
            ]);

            $this->service->reject($item, requeue: true);
        }
    }

    private function outputStatus(): void
    {
        $runtime = round(microtime(true) - $this->startTime, 2);
        $memory = round(memory_get_usage(true) / 1024 / 1024, 2);
        $rate = $runtime > 0 ? round($this->processedCount / $runtime, 2) : 0;

        $this->newLine();
        $this->info("=== Status ===");
        $this->info("Processed: {$this->processedCount}");
        $this->info("Runtime: {$runtime}s");
        $this->info("Rate: {$rate}/s");
        $this->info("Memory: {$memory}MB");
        $this->newLine();
    }

    private function outputSummary(): void
    {
        $runtime = round(microtime(true) - $this->startTime, 2);
        $rate = $runtime > 0 ? round($this->processedCount / $runtime, 2) : 0;

        $this->newLine();
        $this->info("=== Summary ===");
        $this->info("Total processed: {$this->processedCount}");
        $this->info("Total runtime: {$runtime}s");
        $this->info("Average rate: {$rate}/s");

        Log::info('{{ name }} completed', [
            'processed' => $this->processedCount,
            'runtime' => $runtime,
            'rate' => $rate,
        ]);
    }
}

/**
 * Usage:
 *
 * # Run indefinitely
 * php artisan {{ signature | default('queue:' ~ (name | lower)) }}
 *
 * # Run with limits
 * php artisan {{ signature | default('queue:' ~ (name | lower)) }} --limit=1000 --timeout=3600
 *
 * # Get status (send SIGUSR1)
 * kill -USR1 <pid>
 *
 * # Graceful shutdown (send SIGTERM)
 * kill <pid>
 *
 * Supervisor config (/etc/supervisor/conf.d/{{ name | lower }}.conf):
 *
 * [program:{{ name | lower }}]
 * process_name=%(program_name)s_%(process_num)02d
 * command=php /var/www/artisan {{ signature | default('queue:' ~ (name | lower)) }} --timeout=3600
 * autostart=true
 * autorestart=true
 * stopasgroup=true
 * killasgroup=true
 * user=www-data
 * numprocs=2
 * redirect_stderr=true
 * stdout_logfile=/var/log/{{ name | lower }}.log
 * stopwaitsecs=30
 */
