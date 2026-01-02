<?php
/**
 * Service Provider Template
 *
 * Template Variables:
 *   name: Provider class name (e.g., "PaymentServiceProvider")
 *   bindings: Array of interface => implementation bindings
 *   singletons: Array of singleton bindings
 *   deferred: Whether provider is deferred
 *   provides: Array of service classes (for deferred)
 *   config_file: Config file to publish/merge
 *   migrations_path: Migrations path to publish
 *
 * Output: app/Providers/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
{% if deferred %}
use Illuminate\Contracts\Support\DeferrableProvider;
{% endif %}

class {{ name }} extends ServiceProvider{% if deferred %} implements DeferrableProvider{% endif %}

{
    {% if deferred %}
    /**
     * Get the services provided by the provider.
     *
     * @return array<int, string>
     */
    public function provides(): array
    {
        return [
            {% for service in provides %}
            {{ service }}::class,
            {% endfor %}
        ];
    }

    {% endif %}
    /**
     * Register any application services.
     */
    public function register(): void
    {
        {% if config_file %}
        // Merge default config
        $this->mergeConfigFrom(
            __DIR__ . '/../../config/{{ config_file }}.php',
            '{{ config_file }}'
        );

        {% endif %}
        {% for interface, implementation in bindings %}
        // Bind {{ interface }} to {{ implementation }}
        $this->app->bind(
            {{ interface }}::class,
            {{ implementation }}::class
        );

        {% endfor %}
        {% for singleton in singletons %}
        // Register {{ singleton.class }} as singleton
        $this->app->singleton({{ singleton.class }}::class, function ($app) {
            return new {{ singleton.class }}(
                {% for dep in singleton.dependencies %}
                $app->make({{ dep }}::class),
                {% endfor %}
                {% for config in singleton.config %}
                config('{{ config.key }}', {{ config.default }}),
                {% endfor %}
            );
        });

        {% endfor %}
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        {% if config_file %}
        // Publish config
        $this->publishes([
            __DIR__ . '/../../config/{{ config_file }}.php' => config_path('{{ config_file }}.php'),
        ], '{{ name | lower | replace('serviceprovider', '') }}-config');

        {% endif %}
        {% if migrations_path %}
        // Publish migrations
        $this->publishes([
            __DIR__ . '/../../{{ migrations_path }}' => database_path('migrations'),
        ], '{{ name | lower | replace('serviceprovider', '') }}-migrations');

        // Load migrations
        $this->loadMigrationsFrom(__DIR__ . '/../../{{ migrations_path }}');

        {% endif %}
        {% if views_path %}
        // Load views
        $this->loadViewsFrom(__DIR__ . '/../../resources/views', '{{ view_namespace }}');

        // Publish views
        $this->publishes([
            __DIR__ . '/../../resources/views' => resource_path('views/vendor/{{ view_namespace }}'),
        ], '{{ name | lower | replace('serviceprovider', '') }}-views');

        {% endif %}
        {% if routes_file %}
        // Load routes
        $this->loadRoutesFrom(__DIR__ . '/../../routes/{{ routes_file }}.php');

        {% endif %}
        {% if commands %}
        // Register commands
        if ($this->app->runningInConsole()) {
            $this->commands([
                {% for command in commands %}
                {{ command }}::class,
                {% endfor %}
            ]);
        }

        {% endif %}
        {% if macros %}
        // Register macros
        {{ macros }}

        {% endif %}
    }
}

/**
 * Registration:
 *
 * // In bootstrap/providers.php (Laravel 11+)
 * return [
 *     App\Providers\{{ name }}::class,
 * ];
 *
 * // Or in config/app.php (Laravel 10)
 * 'providers' => [
 *     App\Providers\{{ name }}::class,
 * ],
 *
 * Publishing assets:
 *
 * php artisan vendor:publish --tag={{ name | lower | replace('serviceprovider', '') }}-config
 * php artisan vendor:publish --tag={{ name | lower | replace('serviceprovider', '') }}-migrations
 */
