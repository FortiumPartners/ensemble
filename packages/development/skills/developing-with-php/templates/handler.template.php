<?php
/**
 * Handler Class Template
 *
 * Template Variables:
 *   entity: Entity name (e.g., "Contact")
 *   entity_lower: Lowercase (e.g., "contact")
 *   table: Database table name
 *   fillable: Array of fillable columns
 *   soft_deletes: boolean - Include soft delete support
 *   with_cache: boolean - Include caching
 *
 * Output: src/Handlers/{{ entity }}Handler.php
 */

declare(strict_types=1);

namespace App\Handlers;

use PDO;
{% if with_cache %}
use Psr\SimpleCache\CacheInterface;
{% endif %}

class {{ entity }}Handler
{
    protected string $table = '{{ table }}';

    protected array $fillable = [
        {% for field in fillable %}
        '{{ field }}',
        {% endfor %}
    ];

    public function __construct(
        protected readonly PDO $db,
        {% if with_cache %}
        protected readonly ?CacheInterface $cache = null,
        {% endif %}
    ) {
    }

    // =========================================================================
    // Read Operations
    // =========================================================================

    public function get(int $id): ?array
    {
        {% if with_cache %}
        $cacheKey = "{$this->table}:{$id}";

        if ($this->cache && $cached = $this->cache->get($cacheKey)) {
            return $cached;
        }

        {% endif %}
        $sql = "SELECT * FROM {$this->table} WHERE id = ?";
        {% if soft_deletes %}
        $sql .= " AND deleted_at IS NULL";
        {% endif %}

        $stmt = $this->db->prepare($sql);
        $stmt->execute([$id]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

        {% if with_cache %}
        if ($result && $this->cache) {
            $this->cache->set($cacheKey, $result, 3600);
        }

        {% endif %}
        return $result;
    }

    public function getAll(array $filters = [], ?int $limit = null, int $offset = 0): array
    {
        $sql = "SELECT * FROM {$this->table}";
        $params = [];

        $conditions = [];
        {% if soft_deletes %}
        $conditions[] = "deleted_at IS NULL";
        {% endif %}

        foreach ($filters as $column => $value) {
            if (in_array($column, $this->fillable, true)) {
                $conditions[] = "{$column} = ?";
                $params[] = $value;
            }
        }

        if (!empty($conditions)) {
            $sql .= " WHERE " . implode(" AND ", $conditions);
        }

        $sql .= " ORDER BY id DESC";

        if ($limit !== null) {
            $sql .= " LIMIT ? OFFSET ?";
            $params[] = $limit;
            $params[] = $offset;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function count(array $filters = []): int
    {
        $sql = "SELECT COUNT(*) FROM {$this->table}";
        $params = [];

        $conditions = [];
        {% if soft_deletes %}
        $conditions[] = "deleted_at IS NULL";
        {% endif %}

        foreach ($filters as $column => $value) {
            if (in_array($column, $this->fillable, true)) {
                $conditions[] = "{$column} = ?";
                $params[] = $value;
            }
        }

        if (!empty($conditions)) {
            $sql .= " WHERE " . implode(" AND ", $conditions);
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return (int) $stmt->fetchColumn();
    }

    // =========================================================================
    // Write Operations
    // =========================================================================

    public function save(array $data): int
    {
        $filtered = $this->filterFillable($data);
        $columns = implode(', ', array_keys($filtered));
        $placeholders = implode(', ', array_fill(0, count($filtered), '?'));

        $stmt = $this->db->prepare(
            "INSERT INTO {$this->table} ({$columns}, created_at, updated_at)
             VALUES ({$placeholders}, NOW(), NOW())"
        );
        $stmt->execute(array_values($filtered));

        $id = (int) $this->db->lastInsertId();
        $this->invalidateCache($id);

        return $id;
    }

    public function update(int $id, array $data): bool
    {
        $filtered = $this->filterFillable($data);

        if (empty($filtered)) {
            return false;
        }

        $sets = implode(', ', array_map(
            fn(string $col): string => "{$col} = ?",
            array_keys($filtered)
        ));

        $stmt = $this->db->prepare(
            "UPDATE {$this->table} SET {$sets}, updated_at = NOW() WHERE id = ?"
        );
        $result = $stmt->execute([...array_values($filtered), $id]);

        $this->invalidateCache($id);

        return $result;
    }

    // =========================================================================
    // Delete Operations
    // =========================================================================

    {% if soft_deletes %}
    public function delete(int $id): bool
    {
        return $this->softDelete($id);
    }

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
    {% else %}
    public function delete(int $id): bool
    {
        $stmt = $this->db->prepare("DELETE FROM {$this->table} WHERE id = ?");
        $result = $stmt->execute([$id]);
        $this->invalidateCache($id);

        return $result;
    }
    {% endif %}

    // =========================================================================
    // Helpers
    // =========================================================================

    protected function filterFillable(array $data): array
    {
        return array_intersect_key($data, array_flip($this->fillable));
    }

    protected function invalidateCache(int $id): void
    {
        {% if with_cache %}
        $this->cache?->delete("{$this->table}:{$id}");
        {% endif %}
    }

    // =========================================================================
    // Custom Methods
    // =========================================================================

    // TODO: Add entity-specific query methods here
}
