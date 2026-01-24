<?php
/**
 * Handler Architecture Example
 *
 * This example demonstrates the layered handler pattern commonly used in
 * enterprise PHP applications, including:
 * - Base CRUD handler with common operations
 * - Specialized handlers with business logic
 * - MapData/DTO transformation layer
 * - Transaction support
 * - Caching integration
 */

declare(strict_types=1);

namespace App\Examples;

use PDO;
use DateTimeImmutable;

// =============================================================================
// Interfaces
// =============================================================================

interface CacheInterface
{
    public function get(string $key): mixed;
    public function set(string $key, mixed $value, int $ttl = 3600): void;
    public function delete(string $key): void;
}

interface LoggerInterface
{
    public function info(string $message, array $context = []): void;
    public function error(string $message, array $context = []): void;
}

// =============================================================================
// Enums
// =============================================================================

enum ContactStatus: string
{
    case Active = 'active';
    case Inactive = 'inactive';
    case Pending = 'pending';
    case Archived = 'archived';

    public function label(): string
    {
        return match ($this) {
            self::Active => 'Active',
            self::Inactive => 'Inactive',
            self::Pending => 'Pending Verification',
            self::Archived => 'Archived',
        };
    }

    public static function active(): array
    {
        return [self::Active, self::Pending];
    }
}

// =============================================================================
// MapData/DTO Classes
// =============================================================================

readonly class ContactMap
{
    public function __construct(
        public ?int $id,
        public string $firstName,
        public string $lastName,
        public string $email,
        public ?string $phone,
        public ContactStatus $status,
        public ?DateTimeImmutable $createdAt = null,
        public ?DateTimeImmutable $updatedAt = null,
    ) {
    }

    public static function fromRow(array $row): self
    {
        return new self(
            id: (int) $row['id'],
            firstName: $row['first_name'],
            lastName: $row['last_name'],
            email: $row['email'],
            phone: $row['phone'] ?? null,
            status: ContactStatus::from($row['status']),
            createdAt: isset($row['created_at'])
                ? new DateTimeImmutable($row['created_at'])
                : null,
            updatedAt: isset($row['updated_at'])
                ? new DateTimeImmutable($row['updated_at'])
                : null,
        );
    }

    public static function fromRequest(array $data): self
    {
        return new self(
            id: isset($data['id']) ? (int) $data['id'] : null,
            firstName: $data['first_name'],
            lastName: $data['last_name'],
            email: $data['email'],
            phone: $data['phone'] ?? null,
            status: isset($data['status'])
                ? ContactStatus::from($data['status'])
                : ContactStatus::Pending,
        );
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'first_name' => $this->firstName,
            'last_name' => $this->lastName,
            'email' => $this->email,
            'phone' => $this->phone,
            'status' => $this->status->value,
            'status_label' => $this->status->label(),
            'full_name' => $this->fullName(),
            'created_at' => $this->createdAt?->format('Y-m-d H:i:s'),
            'updated_at' => $this->updatedAt?->format('Y-m-d H:i:s'),
        ];
    }

    public function fullName(): string
    {
        return trim("{$this->firstName} {$this->lastName}");
    }
}

// =============================================================================
// Base Handler with Traits
// =============================================================================

trait TransactionTrait
{
    protected function transaction(callable $callback): mixed
    {
        try {
            $this->db->beginTransaction();
            $result = $callback();
            $this->db->commit();
            return $result;
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}

trait SoftDeleteTrait
{
    public function softDelete(int $id): bool
    {
        $stmt = $this->db->prepare(
            "UPDATE {$this->table} SET deleted_at = NOW() WHERE id = ?"
        );
        $result = $stmt->execute([$id]);
        $this->invalidateCache($id);
        return $result;
    }

    public function restore(int $id): bool
    {
        $stmt = $this->db->prepare(
            "UPDATE {$this->table} SET deleted_at = NULL WHERE id = ?"
        );
        $result = $stmt->execute([$id]);
        $this->invalidateCache($id);
        return $result;
    }

    public function forceDelete(int $id): bool
    {
        $stmt = $this->db->prepare("DELETE FROM {$this->table} WHERE id = ?");
        $result = $stmt->execute([$id]);
        $this->invalidateCache($id);
        return $result;
    }
}

abstract class BaseHandler
{
    use TransactionTrait;

    protected string $table;
    protected array $fillable = [];
    protected bool $softDeletes = false;

    public function __construct(
        protected readonly PDO $db,
        protected readonly ?CacheInterface $cache = null,
        protected readonly ?LoggerInterface $logger = null,
    ) {
    }

    // -------------------------------------------------------------------------
    // Core CRUD Operations
    // -------------------------------------------------------------------------

    public function get(int $id): ?array
    {
        $cacheKey = $this->getCacheKey($id);

        if ($this->cache && $cached = $this->cache->get($cacheKey)) {
            $this->logger?->info("Cache hit", ['key' => $cacheKey]);
            return $cached;
        }

        $sql = "SELECT * FROM {$this->table} WHERE id = ?";
        if ($this->softDeletes) {
            $sql .= " AND deleted_at IS NULL";
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute([$id]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($result && $this->cache) {
            $this->cache->set($cacheKey, $result, 3600);
        }

        return $result;
    }

    public function getAll(array $filters = [], int $limit = 100, int $offset = 0): array
    {
        $sql = "SELECT * FROM {$this->table}";
        $params = [];
        $conditions = [];

        if ($this->softDeletes) {
            $conditions[] = "deleted_at IS NULL";
        }

        foreach ($filters as $column => $value) {
            if (in_array($column, $this->fillable, true)) {
                $conditions[] = "{$column} = ?";
                $params[] = $value;
            }
        }

        if (!empty($conditions)) {
            $sql .= " WHERE " . implode(" AND ", $conditions);
        }

        $sql .= " ORDER BY id DESC LIMIT ? OFFSET ?";
        $params[] = $limit;
        $params[] = $offset;

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function save(array $data): int
    {
        $filtered = $this->filterFillable($data);
        $columns = array_keys($filtered);
        $placeholders = array_fill(0, count($filtered), '?');

        $sql = sprintf(
            "INSERT INTO %s (%s, created_at, updated_at) VALUES (%s, NOW(), NOW())",
            $this->table,
            implode(', ', $columns),
            implode(', ', $placeholders)
        );

        $stmt = $this->db->prepare($sql);
        $stmt->execute(array_values($filtered));

        $id = (int) $this->db->lastInsertId();

        $this->logger?->info("Created {$this->table}", ['id' => $id]);

        return $id;
    }

    public function update(int $id, array $data): bool
    {
        $filtered = $this->filterFillable($data);

        if (empty($filtered)) {
            return false;
        }

        $sets = array_map(fn($col) => "{$col} = ?", array_keys($filtered));

        $sql = sprintf(
            "UPDATE %s SET %s, updated_at = NOW() WHERE id = ?",
            $this->table,
            implode(', ', $sets)
        );

        $stmt = $this->db->prepare($sql);
        $result = $stmt->execute([...array_values($filtered), $id]);

        $this->invalidateCache($id);
        $this->logger?->info("Updated {$this->table}", ['id' => $id]);

        return $result;
    }

    public function delete(int $id): bool
    {
        if ($this->softDeletes) {
            return $this->softDelete($id);
        }

        $stmt = $this->db->prepare("DELETE FROM {$this->table} WHERE id = ?");
        $result = $stmt->execute([$id]);

        $this->invalidateCache($id);
        $this->logger?->info("Deleted {$this->table}", ['id' => $id]);

        return $result;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    protected function filterFillable(array $data): array
    {
        return array_intersect_key($data, array_flip($this->fillable));
    }

    protected function getCacheKey(int $id): string
    {
        return "{$this->table}:{$id}";
    }

    protected function invalidateCache(int $id): void
    {
        $this->cache?->delete($this->getCacheKey($id));
    }

    protected function softDelete(int $id): bool
    {
        $stmt = $this->db->prepare(
            "UPDATE {$this->table} SET deleted_at = NOW() WHERE id = ?"
        );
        $result = $stmt->execute([$id]);
        $this->invalidateCache($id);
        return $result;
    }
}

// =============================================================================
// Specialized Contact Handler
// =============================================================================

class ContactHandler extends BaseHandler
{
    use SoftDeleteTrait;

    protected string $table = 'contacts';
    protected bool $softDeletes = true;

    protected array $fillable = [
        'first_name',
        'last_name',
        'email',
        'phone',
        'status',
        'company_id',
    ];

    // -------------------------------------------------------------------------
    // Business Logic Methods
    // -------------------------------------------------------------------------

    /**
     * Get contact with related data
     */
    public function getWithRelations(int $id): ?ContactMap
    {
        $row = $this->get($id);

        if ($row === null) {
            return null;
        }

        // Load related tags
        $row['tags'] = $this->getContactTags($id);

        return ContactMap::fromRow($row);
    }

    /**
     * Search contacts by query
     */
    public function search(string $query, int $limit = 50): array
    {
        $sql = "SELECT * FROM {$this->table}
                WHERE deleted_at IS NULL
                AND (
                    first_name LIKE ?
                    OR last_name LIKE ?
                    OR email LIKE ?
                    OR CONCAT(first_name, ' ', last_name) LIKE ?
                )
                ORDER BY first_name, last_name
                LIMIT ?";

        $like = "%{$query}%";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$like, $like, $like, $like, $limit]);

        return array_map(
            fn(array $row): ContactMap => ContactMap::fromRow($row),
            $stmt->fetchAll(PDO::FETCH_ASSOC)
        );
    }

    /**
     * Find contact by email
     */
    public function findByEmail(string $email): ?ContactMap
    {
        $stmt = $this->db->prepare(
            "SELECT * FROM {$this->table} WHERE email = ? AND deleted_at IS NULL"
        );
        $stmt->execute([$email]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? ContactMap::fromRow($row) : null;
    }

    /**
     * Create contact with tags (transactional)
     */
    public function createWithTags(ContactMap $contact, array $tagIds = []): int
    {
        return $this->transaction(function () use ($contact, $tagIds): int {
            // Create contact
            $contactId = $this->save([
                'first_name' => $contact->firstName,
                'last_name' => $contact->lastName,
                'email' => $contact->email,
                'phone' => $contact->phone,
                'status' => $contact->status->value,
            ]);

            // Attach tags
            if (!empty($tagIds)) {
                $this->attachTags($contactId, $tagIds);
            }

            return $contactId;
        });
    }

    /**
     * Update contact status
     */
    public function updateStatus(int $id, ContactStatus $status): bool
    {
        return $this->update($id, ['status' => $status->value]);
    }

    /**
     * Get contacts by status
     */
    public function getByStatus(ContactStatus $status): array
    {
        return $this->getAll(['status' => $status->value]);
    }

    /**
     * Archive inactive contacts
     */
    public function archiveInactive(int $daysInactive = 90): int
    {
        $sql = "UPDATE {$this->table}
                SET status = ?, updated_at = NOW()
                WHERE status = ?
                AND updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)
                AND deleted_at IS NULL";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([
            ContactStatus::Archived->value,
            ContactStatus::Inactive->value,
            $daysInactive,
        ]);

        $count = $stmt->rowCount();

        $this->logger?->info("Archived inactive contacts", ['count' => $count]);

        return $count;
    }

    // -------------------------------------------------------------------------
    // Tag Relationship Methods
    // -------------------------------------------------------------------------

    protected function getContactTags(int $contactId): array
    {
        $stmt = $this->db->prepare(
            "SELECT t.* FROM tags t
             JOIN contact_tags ct ON ct.tag_id = t.id
             WHERE ct.contact_id = ?"
        );
        $stmt->execute([$contactId]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    protected function attachTags(int $contactId, array $tagIds): void
    {
        $stmt = $this->db->prepare(
            "INSERT INTO contact_tags (contact_id, tag_id) VALUES (?, ?)"
        );

        foreach ($tagIds as $tagId) {
            $stmt->execute([$contactId, $tagId]);
        }
    }

    public function syncTags(int $contactId, array $tagIds): void
    {
        $this->transaction(function () use ($contactId, $tagIds): void {
            // Remove existing tags
            $stmt = $this->db->prepare(
                "DELETE FROM contact_tags WHERE contact_id = ?"
            );
            $stmt->execute([$contactId]);

            // Attach new tags
            if (!empty($tagIds)) {
                $this->attachTags($contactId, $tagIds);
            }
        });
    }
}

// =============================================================================
// Usage Example
// =============================================================================

// Setup (would typically use DI container)
$pdo = new PDO('mysql:host=localhost;dbname=app', 'user', 'pass', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

// Create handler with optional cache and logger
$handler = new ContactHandler($pdo, cache: null, logger: null);

// Create a contact from request data
$contactData = ContactMap::fromRequest([
    'first_name' => 'John',
    'last_name' => 'Doe',
    'email' => 'john.doe@example.com',
    'phone' => '+1-555-0123',
]);

// Create with tags (transactional)
$contactId = $handler->createWithTags($contactData, tagIds: [1, 2, 3]);

// Search contacts
$results = $handler->search('john');

// Get with relations
$contact = $handler->getWithRelations($contactId);

// Update status
$handler->updateStatus($contactId, ContactStatus::Active);

// Get all active contacts
$activeContacts = $handler->getByStatus(ContactStatus::Active);

// Soft delete
$handler->delete($contactId);

// Restore
$handler->restore($contactId);

// Archive old inactive contacts (batch operation)
$archivedCount = $handler->archiveInactive(daysInactive: 90);

// Output contact as array (for API response)
echo json_encode($contact?->toArray(), JSON_PRETTY_PRINT);
