<?php
/**
 * Passport OAuth Example
 *
 * This example demonstrates Laravel Passport OAuth including:
 * - OAuth server configuration
 * - Token scopes
 * - Password grant
 * - Client credentials grant
 * - Authorization code flow
 * - Personal access tokens
 */

declare(strict_types=1);

namespace App\Examples;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Laravel\Passport\Passport;

// =============================================================================
// Passport Configuration (AuthServiceProvider)
// =============================================================================

class AuthServiceProvider extends \Illuminate\Foundation\Support\Providers\AuthServiceProvider
{
    public function boot(): void
    {
        // Define token scopes
        Passport::tokensCan([
            'contacts:read' => 'Read contacts',
            'contacts:write' => 'Create, update contacts',
            'contacts:delete' => 'Delete contacts',
            'companies:read' => 'Read companies',
            'companies:write' => 'Create, update companies',
            'reports:read' => 'Read reports',
            'users:read' => 'Read user profiles',
            'admin' => 'Full administrative access',
        ]);

        // Define scope groups for easier assignment
        Passport::setDefaultScope([
            'contacts:read',
            'companies:read',
        ]);

        // Token lifetimes
        Passport::tokensExpireIn(now()->addDays(15));
        Passport::refreshTokensExpireIn(now()->addDays(30));
        Passport::personalAccessTokensExpireIn(now()->addMonths(6));

        // Enable implicit grant (for SPAs - use with caution)
        // Passport::enableImplicitGrant();

        // Hash client secrets for security
        Passport::hashClientSecrets();
    }
}

// =============================================================================
// Auth Config (config/auth.php)
// =============================================================================

/*
'guards' => [
    'api' => [
        'driver' => 'passport',
        'provider' => 'users',
    ],
],
*/

// =============================================================================
// User Model Configuration
// =============================================================================

use Laravel\Passport\HasApiTokens;

class User extends \Illuminate\Foundation\Auth\User
{
    use HasApiTokens;
    // ... other traits and code
}

// =============================================================================
// API Routes with Scopes
// =============================================================================

// routes/api.php
Route::middleware('auth:api')->group(function () {
    // Routes requiring any valid token
    Route::get('/user', function (Request $request) {
        return $request->user();
    });

    // Routes requiring specific scopes
    Route::middleware('scope:contacts:read')->group(function () {
        Route::get('/contacts', [ContactController::class, 'index']);
        Route::get('/contacts/{contact}', [ContactController::class, 'show']);
    });

    Route::middleware('scope:contacts:write')->group(function () {
        Route::post('/contacts', [ContactController::class, 'store']);
        Route::put('/contacts/{contact}', [ContactController::class, 'update']);
    });

    Route::middleware('scope:contacts:delete')->group(function () {
        Route::delete('/contacts/{contact}', [ContactController::class, 'destroy']);
    });

    // Multiple scopes required (AND)
    Route::middleware('scopes:contacts:read,companies:read')->group(function () {
        Route::get('/contacts/{contact}/company', [ContactController::class, 'company']);
    });

    // Admin-only routes
    Route::middleware('scope:admin')->group(function () {
        Route::resource('users', UserController::class);
        Route::get('/system/stats', [SystemController::class, 'stats']);
    });
});

// =============================================================================
// Controller with Scope Checks
// =============================================================================

class ContactController extends \App\Http\Controllers\Controller
{
    public function index(Request $request)
    {
        // Scope already verified by middleware, but can double-check
        if (!$request->user()->tokenCan('contacts:read')) {
            abort(403, 'Missing contacts:read scope');
        }

        return Contact::paginate();
    }

    public function store(Request $request)
    {
        // Check for additional permissions based on data
        if ($request->has('company_id') && !$request->user()->tokenCan('companies:read')) {
            abort(403, 'Cannot assign company without companies:read scope');
        }

        return Contact::create($request->validated());
    }

    public function destroy(Request $request, Contact $contact)
    {
        // Extra permission for bulk delete
        if ($request->has('bulk') && !$request->user()->tokenCan('admin')) {
            abort(403, 'Bulk delete requires admin scope');
        }

        $contact->delete();
        return response()->noContent();
    }
}

// =============================================================================
// Password Grant (First-Party Apps)
// =============================================================================

class PasswordGrantController extends \App\Http\Controllers\Controller
{
    /**
     * Login and get token via password grant
     */
    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required',
            'scope' => 'nullable|string',
        ]);

        // Verify credentials
        if (!auth()->attempt($request->only('email', 'password'))) {
            return response()->json([
                'error' => 'invalid_credentials',
                'message' => 'The provided credentials are incorrect.',
            ], 401);
        }

        $user = auth()->user();

        // Create token with requested scopes
        $scopes = $request->scope
            ? explode(' ', $request->scope)
            : ['contacts:read', 'companies:read'];

        // Validate user can have requested scopes
        $allowedScopes = $this->getAllowedScopes($user);
        $scopes = array_intersect($scopes, $allowedScopes);

        $token = $user->createToken('password-grant', $scopes);

        return response()->json([
            'token_type' => 'Bearer',
            'access_token' => $token->accessToken,
            'expires_at' => $token->token->expires_at->toISOString(),
            'scopes' => $scopes,
        ]);
    }

    private function getAllowedScopes(User $user): array
    {
        if ($user->hasRole('admin')) {
            return ['admin', 'contacts:read', 'contacts:write', 'contacts:delete',
                    'companies:read', 'companies:write', 'reports:read', 'users:read'];
        }

        if ($user->hasRole('manager')) {
            return ['contacts:read', 'contacts:write', 'companies:read', 'reports:read'];
        }

        return ['contacts:read', 'companies:read'];
    }

    /**
     * Refresh token
     */
    public function refresh(Request $request)
    {
        $request->validate([
            'refresh_token' => 'required',
        ]);

        // Use Passport's built-in refresh endpoint
        // POST /oauth/token with grant_type=refresh_token
    }

    /**
     * Revoke current token
     */
    public function logout(Request $request)
    {
        $request->user()->token()->revoke();

        return response()->json(['message' => 'Successfully logged out']);
    }

    /**
     * Revoke all tokens
     */
    public function logoutAll(Request $request)
    {
        $user = $request->user();

        // Revoke all access tokens
        $user->tokens->each(function ($token) {
            $token->revoke();
        });

        return response()->json(['message' => 'All sessions terminated']);
    }
}

// =============================================================================
// Client Credentials Grant (Machine-to-Machine)
// =============================================================================

// In routes/api.php
Route::middleware('client')->group(function () {
    Route::get('/public/stats', [PublicController::class, 'stats']);
});

// Middleware for client credentials
// CheckClientCredentials::class from Laravel\Passport\Http\Middleware

// Create client via artisan:
// php artisan passport:client --client
// This creates client_id and client_secret

// Request token:
// POST /oauth/token
// {
//   "grant_type": "client_credentials",
//   "client_id": "your-client-id",
//   "client_secret": "your-client-secret",
//   "scope": "contacts:read companies:read"
// }

// =============================================================================
// Personal Access Tokens
// =============================================================================

class PersonalAccessTokenController extends \App\Http\Controllers\Controller
{
    /**
     * List user's tokens
     */
    public function index(Request $request)
    {
        return $request->user()->tokens()
            ->where('revoked', false)
            ->get()
            ->map(fn($token) => [
                'id' => $token->id,
                'name' => $token->name,
                'scopes' => $token->scopes,
                'created_at' => $token->created_at->toISOString(),
                'expires_at' => $token->expires_at->toISOString(),
            ]);
    }

    /**
     * Create a new personal access token
     */
    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'scopes' => 'array',
            'scopes.*' => 'string|in:contacts:read,contacts:write,companies:read,reports:read',
        ]);

        // Limit scopes based on user role
        $allowedScopes = $this->getUserAllowedScopes($request->user());
        $requestedScopes = $request->scopes ?? ['contacts:read'];
        $scopes = array_intersect($requestedScopes, $allowedScopes);

        $token = $request->user()->createToken($request->name, $scopes);

        return response()->json([
            'id' => $token->token->id,
            'name' => $request->name,
            'token' => $token->accessToken,  // Only shown once!
            'scopes' => $scopes,
            'expires_at' => $token->token->expires_at->toISOString(),
        ], 201);
    }

    /**
     * Revoke a specific token
     */
    public function destroy(Request $request, string $tokenId)
    {
        $token = $request->user()->tokens()->find($tokenId);

        if (!$token) {
            abort(404, 'Token not found');
        }

        $token->revoke();

        return response()->noContent();
    }

    private function getUserAllowedScopes(User $user): array
    {
        // Same logic as password grant
        return ['contacts:read', 'companies:read'];
    }
}

// =============================================================================
// OAuth Token Introspection
// =============================================================================

class TokenIntrospectionController extends \App\Http\Controllers\Controller
{
    /**
     * Check token validity and get info
     */
    public function introspect(Request $request)
    {
        $user = $request->user();
        $token = $user->token();

        return response()->json([
            'active' => !$token->revoked && $token->expires_at->isFuture(),
            'scope' => implode(' ', $token->scopes ?? []),
            'client_id' => $token->client_id,
            'user_id' => $user->id,
            'expires_at' => $token->expires_at->timestamp,
            'token_type' => 'Bearer',
        ]);
    }
}

// =============================================================================
// Rate Limiting by Client/Token
// =============================================================================

// In RouteServiceProvider or bootstrap
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;

RateLimiter::for('api', function (Request $request) {
    // Different limits for different grant types
    $token = $request->user()?->token();

    if ($token && in_array('admin', $token->scopes ?? [])) {
        return Limit::perMinute(1000)->by($token->id);
    }

    if ($token) {
        return Limit::perMinute(100)->by($token->id);
    }

    // Client credentials
    return Limit::perMinute(60)->by($request->ip());
});
