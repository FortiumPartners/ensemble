<?php
/**
 * Scheduled Command Template
 *
 * Template Variables:
 *   name: Command class name (e.g., "CleanupExpiredSessions")
 *   signature: Command signature
 *   description: Command description
 *   schedule: Schedule expression (daily, hourly, etc.)
 *   handle_logic: Main command logic
 *   summary_enabled: Include summary output
 *
 * Output: app/Console/Commands/{{ name }}Command.php
 */

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class {{ name }}Command extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = '{{ signature | default('app:' ~ (name | lower)) }}
                            {--dry-run : Preview changes without executing}';

    /**
     * The console command description.
     */
    protected $description = '{{ description | default('Scheduled maintenance task') }}';

    private int $affectedCount = 0;
    private float $startTime;

    public function handle(): int
    {
        $this->startTime = microtime(true);
        $isDryRun = $this->option('dry-run');

        $this->info('Starting {{ name | lower }}...');

        if ($isDryRun) {
            $this->warn('DRY RUN - No changes will be made');
        }

        try {
            {{ handle_logic | default('// TODO: Implement scheduled task logic

            // Example: Cleanup expired records
            // $query = DB::table(\'sessions\')
            //     ->where(\'last_activity\', \'<\', now()->subHours(24));
            //
            // if ($isDryRun) {
            //     $this->affectedCount = $query->count();
            //     $this->info("Would delete {$this->affectedCount} expired sessions");
            // } else {
            //     $this->affectedCount = $query->delete();
            //     $this->info("Deleted {$this->affectedCount} expired sessions");
            // }') }}

            {% if summary_enabled %}
            $this->outputSummary($isDryRun);
            {% endif %}

            return self::SUCCESS;

        } catch (\Throwable $e) {
            $this->error("{{ name }} failed: {$e->getMessage()}");

            Log::error('{{ name }}Command failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);

            return self::FAILURE;
        }
    }

    {% if summary_enabled %}
    private function outputSummary(bool $isDryRun): void
    {
        $runtime = round((microtime(true) - $this->startTime) * 1000, 2);

        $this->newLine();
        $this->info('=== Summary ===');
        $this->info("Affected records: {$this->affectedCount}");
        $this->info("Runtime: {$runtime}ms");

        if (!$isDryRun) {
            Log::info('{{ name }} completed', [
                'affected' => $this->affectedCount,
                'runtime_ms' => $runtime,
            ]);
        }
    }
    {% endif %}
}

/**
 * Scheduling (in routes/console.php):
 *
 * use Illuminate\Support\Facades\Schedule;
 *
 * Schedule::command('{{ signature | default('app:' ~ (name | lower)) }}')
 *     ->{{ schedule | default('daily') }}()
 *     ->withoutOverlapping()
 *     ->onOneServer()
 *     ->runInBackground()
 *     ->emailOutputOnFailure('admin@example.com');
 *
 * // With specific time
 * Schedule::command('{{ signature | default('app:' ~ (name | lower)) }}')
 *     ->dailyAt('02:00')
 *     ->environments(['production']);
 *
 * // With conditions
 * Schedule::command('{{ signature | default('app:' ~ (name | lower)) }}')
 *     ->hourly()
 *     ->when(function () {
 *         return config('features.cleanup_enabled');
 *     });
 *
 * Testing:
 *
 * php artisan {{ signature | default('app:' ~ (name | lower)) }} --dry-run
 * php artisan schedule:test --name="{{ signature | default('app:' ~ (name | lower)) }}"
 */
