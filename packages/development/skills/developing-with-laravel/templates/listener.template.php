<?php
/**
 * Event Listener Template
 *
 * Template Variables:
 *   name: Listener class name (e.g., "SendContactCreatedNotification")
 *   event: Event class to listen for
 *   queued: Whether listener should be queued
 *   queue: Queue name
 *   delay: Delay in seconds
 *   handle_logic: Main listener logic
 *
 * Output: app/Listeners/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Listeners;

use App\Events\{{ event }};
{% if queued %}
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;
{% endif %}
use Illuminate\Support\Facades\Log;
use Throwable;

class {{ name }}{% if queued %} implements ShouldQueue{% endif %}

{
    {% if queued %}
    use InteractsWithQueue;

    /**
     * The name of the connection the job should be sent to.
     */
    public ?string $connection = '{{ connection | default('redis') }}';

    /**
     * The name of the queue the job should be sent to.
     */
    public ?string $queue = '{{ queue | default('listeners') }}';

    /**
     * The time (seconds) before the job should be processed.
     */
    public int $delay = {{ delay | default(0) }};

    /**
     * The number of times the queued listener may be attempted.
     */
    public int $tries = {{ tries | default(3) }};

    {% endif %}
    /**
     * Create the event listener.
     */
    public function __construct(
        {% if services %}
        {{ services }}
        {% endif %}
    ) {
    }

    /**
     * Handle the event.
     */
    public function handle({{ event }} $event): void
    {
        Log::info('{{ name }} handling {{ event }}', [
            'id' => $event->{{ event | lower | replace('event', '') | replace('created', '') | replace('updated', '') | replace('deleted', '') | trim }}->id ?? null,
        ]);

        {{ handle_logic | default('// TODO: Implement listener logic') }}
    }

    /**
     * Determine whether the listener should be queued.
     */
    public function shouldQueue({{ event }} $event): bool
    {
        {{ should_queue_logic | default('return true;') }}
    }

    {% if queued %}
    /**
     * Handle a job failure.
     */
    public function failed({{ event }} $event, Throwable $exception): void
    {
        Log::error('{{ name }} failed', [
            'event' => {{ event }}::class,
            'error' => $exception->getMessage(),
        ]);

        {{ failed_logic | default('// TODO: Handle failure') }}
    }

    /**
     * Get the number of seconds before a released job will be available.
     */
    public function backoff(): array
    {
        return [30, 60, 120];
    }
    {% endif %}
}

/**
 * Register in EventServiceProvider:
 *
 * protected $listen = [
 *     {{ event }}::class => [
 *         {{ name }}::class,
 *     ],
 * ];
 *
 * Or auto-discovery with #[AsEventListener] attribute:
 *
 * use Illuminate\Events\Attributes\AsEventListener;
 *
 * #[AsEventListener(event: {{ event }}::class)]
 * class {{ name }} { ... }
 */
