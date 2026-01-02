<?php
/**
 * Artisan Command Template
 *
 * Template Variables:
 *   name: Command class name (e.g., "SyncContacts")
 *   signature: Command signature with arguments and options
 *   description: Command description
 *   handle_logic: Main command logic
 *   has_progress: Include progress bar
 *   has_confirmation: Require confirmation in production
 *
 * Output: app/Console/Commands/{{ name }}Command.php
 */

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
{% if has_confirmation %}
use Illuminate\Console\ConfirmableTrait;
{% endif %}
use Illuminate\Support\Facades\Log;

class {{ name }}Command extends Command
{
    {% if has_confirmation %}
    use ConfirmableTrait;

    {% endif %}
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = '{{ signature | default('app:' ~ (name | lower)) }}
                            {--dry-run : Run without making changes}
                            {--force : Force the operation in production}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = '{{ description | default('Description of the command') }}';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        {% if has_confirmation %}
        if (!$this->confirmToProceed()) {
            return self::FAILURE;
        }

        {% endif %}
        $isDryRun = $this->option('dry-run');

        if ($isDryRun) {
            $this->warn('Running in dry-run mode - no changes will be made');
        }

        $this->info('Starting {{ name | lower }}...');

        try {
            {{ handle_logic | default('// TODO: Implement command logic

            // Example with progress bar
            // $items = Model::cursor();
            // $this->withProgressBar($items, function ($item) use ($isDryRun) {
            //     if (!$isDryRun) {
            //         // Process item
            //     }
            // });') }}

            $this->newLine();
            $this->info('{{ name }} completed successfully');

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
}

/**
 * Usage:
 *
 * php artisan {{ signature | default('app:' ~ (name | lower)) }}
 * php artisan {{ signature | default('app:' ~ (name | lower)) }} --dry-run
 * php artisan {{ signature | default('app:' ~ (name | lower)) }} --force
 *
 * With arguments:
 * php artisan {{ signature | default('app:' ~ (name | lower)) }} argument-value
 *
 * Scheduling (in routes/console.php):
 *
 * Schedule::command('{{ signature | default('app:' ~ (name | lower)) }}')
 *     ->daily()
 *     ->withoutOverlapping()
 *     ->onOneServer();
 */
