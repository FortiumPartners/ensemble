<?php
/**
 * Middleware Template
 *
 * Template Variables:
 *   name: Middleware class name (e.g., "EnsureTenantAccess")
 *   check_logic: The authorization/check logic
 *   terminate_logic: Optional terminate logic
 *   has_parameters: Whether middleware accepts parameters
 *   parameters: Parameter names for parameterized middleware
 *
 * Output: app/Http/Middleware/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class {{ name }}
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     {% if has_parameters %}
     * @param  string  ${{ parameters | join(', $') }}
     {% endif %}
     */
    public function handle(Request $request, Closure $next{% if has_parameters %}, {% for param in parameters %}string ${{ param }}{% if not loop.last %}, {% endif %}{% endfor %}{% endif %}): Response
    {
        {{ check_logic | default('// TODO: Implement middleware logic

        // Example: Check authentication
        // if (!$request->user()) {
        //     return redirect()->route(\'login\');
        // }

        // Example: Check role
        // if (!$request->user()->hasRole($role)) {
        //     abort(403, \'Unauthorized\');
        // }

        // Example: Check tenant
        // $tenantId = session(\'tenant_id\');
        // if (!$tenantId) {
        //     abort(403, \'No tenant context\');
        // }') }}

        return $next($request);
    }

    {% if terminate_logic %}
    /**
     * Handle tasks after the response has been sent to the browser.
     */
    public function terminate(Request $request, Response $response): void
    {
        {{ terminate_logic }}
    }
    {% endif %}
}

/**
 * Registration:
 *
 * // In bootstrap/app.php (Laravel 11+)
 * ->withMiddleware(function (Middleware $middleware) {
 *     $middleware->alias([
 *         '{{ name | lower }}' => \App\Http\Middleware\{{ name }}::class,
 *     ]);
 *
 *     // Or add to group
 *     $middleware->web(append: [
 *         \App\Http\Middleware\{{ name }}::class,
 *     ]);
 * })
 *
 * Usage:
 *
 * // In routes
 * Route::middleware('{{ name | lower }}')->group(function () {
 *     // Protected routes
 * });
 *
 * // With parameters
 * Route::middleware('{{ name | lower }}:admin,editor')->group(function () {
 *     // Routes requiring admin or editor role
 * });
 *
 * // In controller
 * public function __construct()
 * {
 *     $this->middleware('{{ name | lower }}');
 * }
 */
