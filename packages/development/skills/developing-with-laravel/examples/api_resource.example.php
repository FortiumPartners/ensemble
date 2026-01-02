<?php
/**
 * API Resource Example
 *
 * This example demonstrates Laravel API Resources including:
 * - Basic resource transformation
 * - Resource collections
 * - Conditional attributes
 * - Nested resources
 * - Pagination
 */

declare(strict_types=1);

namespace App\Examples;

use App\Models\Contact;
use App\Models\Company;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Http\Resources\Json\ResourceCollection;

// =============================================================================
// Basic API Resource
// =============================================================================

class ContactResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'full_name' => $this->full_name,
            'email' => $this->email,
            'phone' => $this->phone,
            'status' => [
                'value' => $this->status->value,
                'label' => $this->status->label(),
            ],

            // Conditional attributes
            'metadata' => $this->when($request->user()?->isAdmin(), $this->metadata),

            // Only include when loaded
            'company' => new CompanyResource($this->whenLoaded('company')),
            'tags' => TagResource::collection($this->whenLoaded('tags')),
            'activities_count' => $this->whenCounted('activities'),
            'latest_activity' => new ActivityResource($this->whenLoaded('latestActivity')),

            // Conditional based on request
            'internal_notes' => $this->when(
                $request->has('include_notes') && $request->user()?->can('viewNotes', $this->resource),
                $this->internal_notes
            ),

            // Merge when condition met
            $this->mergeWhen($request->has('include_audit'), [
                'created_by' => $this->created_by,
                'updated_by' => $this->updated_by,
            ]),

            // Timestamps
            'last_contacted_at' => $this->last_contacted_at?->toISOString(),
            'created_at' => $this->created_at->toISOString(),
            'updated_at' => $this->updated_at->toISOString(),

            // Links
            'links' => [
                'self' => route('contacts.show', $this->id),
                'company' => $this->when(
                    $this->company_id,
                    route('companies.show', $this->company_id ?? 0)
                ),
            ],
        ];
    }

    /**
     * Get additional data that should be returned with the resource array.
     *
     * @return array<string, mixed>
     */
    public function with(Request $request): array
    {
        return [
            'meta' => [
                'version' => '1.0',
            ],
        ];
    }
}

// =============================================================================
// Resource Collection with Custom Pagination
// =============================================================================

class ContactCollection extends ResourceCollection
{
    /**
     * The resource that this resource collects.
     *
     * @var string
     */
    public $collects = ContactResource::class;

    /**
     * Transform the resource collection into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'data' => $this->collection,
            'meta' => [
                'total' => $this->total(),
                'per_page' => $this->perPage(),
                'current_page' => $this->currentPage(),
                'last_page' => $this->lastPage(),
                'from' => $this->firstItem(),
                'to' => $this->lastItem(),
            ],
            'links' => [
                'first' => $this->url(1),
                'last' => $this->url($this->lastPage()),
                'prev' => $this->previousPageUrl(),
                'next' => $this->nextPageUrl(),
            ],
        ];
    }

    /**
     * Get additional data that should be returned with the resource array.
     *
     * @return array<string, mixed>
     */
    public function with(Request $request): array
    {
        return [
            'meta' => [
                'filters_applied' => $request->only(['status', 'company_id', 'search']),
                'timestamp' => now()->toISOString(),
            ],
        ];
    }
}

// =============================================================================
// Nested Resource
// =============================================================================

class CompanyResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'domain' => $this->domain,
            'industry' => $this->industry,
            'size' => $this->size,

            // Nested contacts (when loaded)
            'contacts' => ContactResource::collection($this->whenLoaded('contacts')),
            'contacts_count' => $this->whenCounted('contacts'),

            // Summary stats (computed attribute)
            $this->mergeWhen($this->relationLoaded('contacts'), [
                'active_contacts' => $this->contacts->where('status', 'active')->count(),
            ]),

            'created_at' => $this->created_at->toISOString(),
            'updated_at' => $this->updated_at->toISOString(),
        ];
    }
}

class TagResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'color' => $this->color,

            // Pivot data (from belongsToMany)
            'added_at' => $this->whenPivotLoaded('contact_tags', function () {
                return $this->pivot->created_at?->toISOString();
            }),
            'added_by' => $this->whenPivotLoaded('contact_tags', function () {
                return $this->pivot->added_by;
            }),
        ];
    }
}

class ActivityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'description' => $this->description,
            'metadata' => $this->metadata,
            'user' => [
                'id' => $this->user?->id,
                'name' => $this->user?->name,
            ],
            'created_at' => $this->created_at->toISOString(),
        ];
    }
}

// =============================================================================
// Controller Usage
// =============================================================================

class ContactController
{
    public function index(Request $request)
    {
        $contacts = Contact::query()
            ->with(['company:id,name', 'tags'])
            ->withCount('activities')
            ->filter($request->only(['status', 'company_id', 'search']))
            ->orderBy($request->sort_by ?? 'created_at', $request->sort_dir ?? 'desc')
            ->paginate($request->per_page ?? 25);

        return new ContactCollection($contacts);
    }

    public function show(Contact $contact)
    {
        $contact->load([
            'company',
            'tags',
            'latestActivity',
            'activities' => fn($q) => $q->limit(10),
        ]);

        return new ContactResource($contact);
    }

    public function store(StoreContactRequest $request)
    {
        $contact = Contact::create($request->validated());

        if ($request->has('tag_ids')) {
            $contact->tags()->attach($request->tag_ids);
        }

        $contact->load(['company', 'tags']);

        return (new ContactResource($contact))
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateContactRequest $request, Contact $contact)
    {
        $contact->update($request->validated());

        if ($request->has('tag_ids')) {
            $contact->tags()->sync($request->tag_ids);
        }

        $contact->load(['company', 'tags']);

        return new ContactResource($contact);
    }

    public function destroy(Contact $contact)
    {
        $contact->delete();

        return response()->json(null, 204);
    }
}

// =============================================================================
// Resource Response Customization
// =============================================================================

// In controller - adding headers
return (new ContactResource($contact))
    ->response()
    ->header('X-Contact-ID', $contact->id)
    ->header('X-Request-ID', request()->header('X-Request-ID'));

// In controller - wrapping disabled
ContactResource::withoutWrapping();
return new ContactResource($contact);

// Custom wrapping key
class CustomContactResource extends JsonResource
{
    public static $wrap = 'contact';  // Changes 'data' to 'contact'
}
