<?php
/**
 * Resource Controller Template
 *
 * Template Variables:
 *   model: Model name (e.g., "Contact")
 *   model_variable: Lowercase variable (e.g., "contact")
 *   model_plural: Plural form (e.g., "contacts")
 *   route_prefix: Route prefix (e.g., "api")
 *   form_request: Custom form request class name
 *   resource: API Resource class name
 *   service: Optional service class name
 *   with_authorization: Include policy authorization
 *
 * Output: app/Http/Controllers/{{ model }}Controller.php
 */

declare(strict_types=1);

namespace App\Http\Controllers{% if route_prefix == 'api' %}\Api{% endif %};

use App\Http\Controllers\Controller;
use App\Http\Requests\{{ form_request | default(model ~ 'Request') }};
use App\Http\Resources\{{ resource | default(model ~ 'Resource') }};
use App\Models\{{ model }};
{% if service %}
use App\Services\{{ service }};
{% endif %}
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class {{ model }}Controller extends Controller
{
    {% if service %}
    public function __construct(
        private readonly {{ service }} $service,
    ) {
    }

    {% endif %}
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        {% if with_authorization %}
        $this->authorize('viewAny', {{ model }}::class);

        {% endif %}
        ${{ model_plural }} = {{ model }}::query()
            ->when($request->search, fn($q, $search) => $q->where('name', 'like', "%{$search}%"))
            ->when($request->status, fn($q, $status) => $q->where('status', $status))
            ->orderBy($request->sort_by ?? 'created_at', $request->sort_dir ?? 'desc')
            ->paginate($request->per_page ?? 25);

        return {{ resource | default(model ~ 'Resource') }}::collection(${{ model_plural }});
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store({{ form_request | default(model ~ 'Request') }} $request): JsonResponse
    {
        {% if with_authorization %}
        $this->authorize('create', {{ model }}::class);

        {% endif %}
        {% if service %}
        ${{ model_variable }} = $this->service->create($request->validated());
        {% else %}
        ${{ model_variable }} = {{ model }}::create($request->validated());
        {% endif %}

        return (new {{ resource | default(model ~ 'Resource') }}(${{ model_variable }}))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * Display the specified resource.
     */
    public function show({{ model }} ${{ model_variable }}): {{ resource | default(model ~ 'Resource') }}
    {
        {% if with_authorization %}
        $this->authorize('view', ${{ model_variable }});

        {% endif %}
        return new {{ resource | default(model ~ 'Resource') }}(${{ model_variable }});
    }

    /**
     * Update the specified resource in storage.
     */
    public function update({{ form_request | default(model ~ 'Request') }} $request, {{ model }} ${{ model_variable }}): {{ resource | default(model ~ 'Resource') }}
    {
        {% if with_authorization %}
        $this->authorize('update', ${{ model_variable }});

        {% endif %}
        {% if service %}
        ${{ model_variable }} = $this->service->update(${{ model_variable }}, $request->validated());
        {% else %}
        ${{ model_variable }}->update($request->validated());
        {% endif %}

        return new {{ resource | default(model ~ 'Resource') }}(${{ model_variable }});
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy({{ model }} ${{ model_variable }}): JsonResponse
    {
        {% if with_authorization %}
        $this->authorize('delete', ${{ model_variable }});

        {% endif %}
        {% if service %}
        $this->service->delete(${{ model_variable }});
        {% else %}
        ${{ model_variable }}->delete();
        {% endif %}

        return response()->json(null, 204);
    }
}
