<?php
/**
 * PDO Repository Template
 *
 * Template Variables:
 *   entity: Entity name (e.g., "User")
 *   entity_lower: Lowercase (e.g., "user")
 *   table: Database table name
 *   primary_key: Primary key column (default: "id")
 *   columns: Array of column definitions
 *   soft_deletes: boolean
 *   timestamps: boolean
 *
 * Output: src/Repositories/{{ entity }}Repository.php
 */

declare(strict_types=1);

namespace App\Repositories;

use App\Entities\{{ entity }};
use PDO;
use PDOStatement;

class {{ entity }}Repository
{
    protected string $table = '{{ table }}';
    protected string $primaryKey = '{{ primary_key | default('id') }}';

    protected array $columns = [
        {% for col in columns %}
        '{{ col.name }}',
        {% endfor %}
    ];

    public function __construct(
        protected readonly PDO $db
    ) {
    }

    // =========================================================================
    // Find Methods
    // =========================================================================

    public function find(int|string $id): ?{{ entity }}
    {
        $sql = "SELECT * FROM {$this->table} WHERE {$this->primaryKey} = ?";
        {% if soft_deletes %}
        $sql .= " AND deleted_at IS NULL";
        {% endif %}

        $stmt = $this->db->prepare($sql);
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? $this->hydrate($row) : null;
    }

    public function findOrFail(int|string $id): {{ entity }}
    {
        $entity = $this->find($id);

        if ($entity === null) {
            throw new \RuntimeException("{{ entity }} not found: {$id}");
        }

        return $entity;
    }

    public function findBy(array $criteria, ?int $limit = null): array
    {
        [$where, $params] = $this->buildWhere($criteria);

        $sql = "SELECT * FROM {$this->table} {$where}";

        if ($limit !== null) {
            $sql .= " LIMIT {$limit}";
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return array_map(
            fn(array $row): {{ entity }} => $this->hydrate($row),
            $stmt->fetchAll(PDO::FETCH_ASSOC)
        );
    }

    public function findOneBy(array $criteria): ?{{ entity }}
    {
        $results = $this->findBy($criteria, 1);
        return $results[0] ?? null;
    }

    public function findAll(): array
    {
        {% if soft_deletes %}
        return $this->findBy(['deleted_at' => null]);
        {% else %}
        $stmt = $this->db->query("SELECT * FROM {$this->table}");
        return array_map(
            fn(array $row): {{ entity }} => $this->hydrate($row),
            $stmt->fetchAll(PDO::FETCH_ASSOC)
        );
        {% endif %}
    }

    // =========================================================================
    // Persistence Methods
    // =========================================================================

    public function save({{ entity }} $entity): void
    {
        if ($entity->{{ primary_key | default('id') }} === null) {
            $this->insert($entity);
        } else {
            $this->update($entity);
        }
    }

    protected function insert({{ entity }} $entity): void
    {
        $data = $this->extract($entity);
        unset($data[$this->primaryKey]);

        {% if timestamps %}
        $data['created_at'] = date('Y-m-d H:i:s');
        $data['updated_at'] = date('Y-m-d H:i:s');
        {% endif %}

        $columns = implode(', ', array_keys($data));
        $placeholders = implode(', ', array_fill(0, count($data), '?'));

        $sql = "INSERT INTO {$this->table} ({$columns}) VALUES ({$placeholders})";
        $stmt = $this->db->prepare($sql);
        $stmt->execute(array_values($data));

        $entity->{{ primary_key | default('id') }} = (int) $this->db->lastInsertId();
    }

    protected function update({{ entity }} $entity): void
    {
        $data = $this->extract($entity);
        $id = $data[$this->primaryKey];
        unset($data[$this->primaryKey]);

        {% if timestamps %}
        $data['updated_at'] = date('Y-m-d H:i:s');
        {% endif %}

        $sets = implode(', ', array_map(
            fn(string $col): string => "{$col} = ?",
            array_keys($data)
        ));

        $sql = "UPDATE {$this->table} SET {$sets} WHERE {$this->primaryKey} = ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([...array_values($data), $id]);
    }

    public function delete({{ entity }} $entity): void
    {
        {% if soft_deletes %}
        $this->softDelete($entity);
        {% else %}
        $sql = "DELETE FROM {$this->table} WHERE {$this->primaryKey} = ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$entity->{{ primary_key | default('id') }}]);
        {% endif %}
    }

    {% if soft_deletes %}
    protected function softDelete({{ entity }} $entity): void
    {
        $sql = "UPDATE {$this->table} SET deleted_at = NOW() WHERE {$this->primaryKey} = ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$entity->{{ primary_key | default('id') }}]);
    }

    public function restore({{ entity }} $entity): void
    {
        $sql = "UPDATE {$this->table} SET deleted_at = NULL WHERE {$this->primaryKey} = ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$entity->{{ primary_key | default('id') }}]);
    }

    public function forceDelete({{ entity }} $entity): void
    {
        $sql = "DELETE FROM {$this->table} WHERE {$this->primaryKey} = ?";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$entity->{{ primary_key | default('id') }}]);
    }
    {% endif %}

    // =========================================================================
    // Aggregation Methods
    // =========================================================================

    public function count(array $criteria = []): int
    {
        [$where, $params] = $this->buildWhere($criteria);
        $sql = "SELECT COUNT(*) FROM {$this->table} {$where}";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return (int) $stmt->fetchColumn();
    }

    public function exists(array $criteria): bool
    {
        return $this->count($criteria) > 0;
    }

    // =========================================================================
    // Hydration / Extraction
    // =========================================================================

    protected function hydrate(array $row): {{ entity }}
    {
        return new {{ entity }}(
            {% for col in columns %}
            {{ col.name }}: {% if col.type == 'int' %}(int) {% elif col.type == 'float' %}(float) {% elif col.type == 'bool' %}(bool) {% endif %}$row['{{ col.db_name | default(col.name) }}']{% if col.nullable %} ?? null{% endif %},
            {% endfor %}
        );
    }

    protected function extract({{ entity }} $entity): array
    {
        return [
            {% for col in columns %}
            '{{ col.db_name | default(col.name) }}' => $entity->{{ col.name }},
            {% endfor %}
        ];
    }

    // =========================================================================
    // Query Building
    // =========================================================================

    protected function buildWhere(array $criteria): array
    {
        {% if soft_deletes %}
        if (!isset($criteria['deleted_at'])) {
            $criteria['deleted_at'] = null;
        }
        {% endif %}

        if (empty($criteria)) {
            return ['', []];
        }

        $conditions = [];
        $params = [];

        foreach ($criteria as $column => $value) {
            if ($value === null) {
                $conditions[] = "{$column} IS NULL";
            } else {
                $conditions[] = "{$column} = ?";
                $params[] = $value;
            }
        }

        return ['WHERE ' . implode(' AND ', $conditions), $params];
    }
}
