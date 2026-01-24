<?php
/**
 * Event Template
 *
 * Template Variables:
 *   name: Event class name (e.g., "ContactCreated")
 *   model: Associated model
 *   broadcast: Whether to broadcast event
 *   channel_type: public, private, or presence
 *   channel_name: Broadcast channel name
 *   broadcast_data: Data to broadcast
 *
 * Output: app/Events/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Events;

use App\Models\{{ model }};
use Illuminate\Broadcasting\InteractsWithSockets;
{% if broadcast %}
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
{% else %}
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
{% endif %}
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class {{ name }}{% if broadcast %} implements ShouldBroadcast{% endif %}

{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * Create a new event instance.
     */
    public function __construct(
        public readonly {{ model }} ${{ model | lower }},
        {% if additional_data %}
        public readonly array $metadata = [],
        {% endif %}
    ) {
    }

    {% if broadcast %}
    /**
     * Get the channels the event should broadcast on.
     *
     * @return array<int, \Illuminate\Broadcasting\Channel>
     */
    public function broadcastOn(): array
    {
        return [
            {% if channel_type == 'private' %}
            new PrivateChannel('{{ channel_name }}'),
            {% elif channel_type == 'presence' %}
            new PresenceChannel('{{ channel_name }}'),
            {% else %}
            new Channel('{{ channel_name }}'),
            {% endif %}
        ];
    }

    /**
     * The event's broadcast name.
     */
    public function broadcastAs(): string
    {
        return '{{ broadcast_name | default(name | lower | replace('_', '.')) }}';
    }

    /**
     * Get the data to broadcast.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            {{ broadcast_data | default("'id' => $this->" ~ (model | lower) ~ "->id,
            'type' => '" ~ (name | lower) ~ "',
            'timestamp' => now()->toISOString(),") }}
        ];
    }

    /**
     * Determine if this event should broadcast.
     */
    public function broadcastWhen(): bool
    {
        {{ broadcast_condition | default('return true;') }}
    }
    {% endif %}
}

/**
 * Usage:
 *
 * // Dispatch event
 * event(new {{ name }}(${{ model | lower }}));
 *
 * // Or using the Event facade
 * Event::dispatch(new {{ name }}(${{ model | lower }}));
 *
 * // Register listener in EventServiceProvider
 * protected $listen = [
 *     {{ name }}::class => [
 *         {{ name }}Listener::class,
 *     ],
 * ];
 */
