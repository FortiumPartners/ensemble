<?php
/**
 * Queue Job Template
 *
 * Template Variables:
 *   name: Job class name (e.g., "ProcessContactImport")
 *   queue: Queue name (default: "default")
 *   tries: Number of retry attempts
 *   backoff: Backoff intervals array
 *   timeout: Job timeout in seconds
 *   unique: Whether job should be unique
 *   constructor_params: Constructor parameters
 *   handle_logic: Main job logic
 *   failed_logic: Failure handling logic
 *
 * Output: app/Jobs/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
{% if unique %}
use Illuminate\Contracts\Queue\ShouldBeUnique;
{% endif %}
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
{% if middleware %}
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\Middleware\WithoutOverlapping;
{% endif %}
use Illuminate\Support\Facades\Log;
use Throwable;

class {{ name }} implements ShouldQueue{% if unique %}, ShouldBeUnique{% endif %}

{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * The number of times the job may be attempted.
     */
    public int $tries = {{ tries | default(3) }};

    /**
     * The number of seconds to wait before retrying the job.
     *
     * @var array<int>
     */
    public array $backoff = [{{ backoff | default('30, 60, 120') }}];

    /**
     * The maximum number of unhandled exceptions to allow before failing.
     */
    public int $maxExceptions = {{ max_exceptions | default(2) }};

    /**
     * The number of seconds the job can run before timing out.
     */
    public int $timeout = {{ timeout | default(120) }};

    {% if unique %}
    /**
     * The number of seconds after which the job's unique lock will be released.
     */
    public int $uniqueFor = {{ unique_for | default(3600) }};

    {% endif %}
    /**
     * Create a new job instance.
     */
    public function __construct(
        {% for param in constructor_params %}
        public readonly {{ param.type }} ${{ param.name }},
        {% endfor %}
    ) {
    }

    {% if unique %}
    /**
     * Get the unique ID for the job.
     */
    public function uniqueId(): string
    {
        return '{{ name | lower }}-' . {{ unique_id_expression | default('$this->id') }};
    }

    {% endif %}
    {% if middleware %}
    /**
     * Get the middleware the job should pass through.
     *
     * @return array<int, object>
     */
    public function middleware(): array
    {
        return [
            new RateLimited('{{ rate_limit_key | default('jobs') }}'),
            {% if without_overlapping %}
            new WithoutOverlapping({{ overlapping_key }}),
            {% endif %}
        ];
    }

    {% endif %}
    /**
     * Execute the job.
     */
    public function handle({% if services %}{{ services }}{% endif %}): void
    {
        Log::info('{{ name }} started', [
            {% for param in constructor_params %}
            '{{ param.name }}' => $this->{{ param.name }},
            {% endfor %}
        ]);

        {{ handle_logic | default('// TODO: Implement job logic') }}

        Log::info('{{ name }} completed');
    }

    /**
     * Handle a job failure.
     */
    public function failed(?Throwable $exception): void
    {
        Log::error('{{ name }} failed', [
            {% for param in constructor_params %}
            '{{ param.name }}' => $this->{{ param.name }},
            {% endfor %}
            'error' => $exception?->getMessage(),
        ]);

        {{ failed_logic | default('// TODO: Handle failure (notify user, etc.)') }}
    }

    /**
     * Determine the time at which the job should timeout.
     */
    public function retryUntil(): \DateTime
    {
        return now()->addHours({{ retry_until_hours | default(2) }});
    }

    /**
     * Get the tags that should be assigned to the job.
     *
     * @return array<string>
     */
    public function tags(): array
    {
        return [
            '{{ name | lower }}',
            {% for param in constructor_params %}
            '{{ param.name }}:' . $this->{{ param.name }},
            {% endfor %}
        ];
    }
}
