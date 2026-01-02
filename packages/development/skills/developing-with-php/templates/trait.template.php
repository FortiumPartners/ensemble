<?php
/**
 * Trait Template
 *
 * Template Variables:
 *   name: Trait name (e.g., "Timestamps")
 *   properties: Array of properties [{name, type, default, visibility}]
 *   methods: Array of methods to include
 *   with_interface: boolean - Create companion interface
 *
 * Output: src/Traits/{{ name }}.php
 */

declare(strict_types=1);

namespace App\Traits;

{% if with_interface | default(false) %}
interface {{ name }}Interface
{
    {% for method in methods %}
    public function {{ method.name }}({{ method.params | default('') }}): {{ method.return_type | default('void') }};
    {% endfor %}
}

{% endif %}
trait {{ name }}
{
    // =========================================================================
    // Properties
    // =========================================================================

    {% for prop in properties | default([]) %}
    {{ prop.visibility | default('protected') }} {% if prop.nullable | default(false) %}?{% endif %}{{ prop.type }} ${{ prop.name }}{% if prop.default is defined %} = {{ prop.default }}{% elif prop.nullable | default(false) %} = null{% endif %};
    {% endfor %}

    // =========================================================================
    // Methods
    // =========================================================================

    {% for method in methods %}
    public function {{ method.name }}({{ method.params | default('') }}): {{ method.return_type | default('void') }}
    {
        {{ method.body | default('// TODO: Implement') }}
    }

    {% endfor %}
}

// =============================================================================
// Common Trait Examples
// =============================================================================

/**
 * Timestamps Trait
 */
trait TimestampsTrait
{
    protected ?\DateTimeImmutable $createdAt = null;
    protected ?\DateTimeImmutable $updatedAt = null;

    public function setCreatedAt(): void
    {
        $this->createdAt = new \DateTimeImmutable();
    }

    public function setUpdatedAt(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function getCreatedAt(): ?\DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getUpdatedAt(): ?\DateTimeImmutable
    {
        return $this->updatedAt;
    }

    public function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }
}

/**
 * Soft Delete Trait
 */
trait SoftDeleteTrait
{
    protected ?\DateTimeImmutable $deletedAt = null;

    public function softDelete(): void
    {
        $this->deletedAt = new \DateTimeImmutable();
    }

    public function restore(): void
    {
        $this->deletedAt = null;
    }

    public function isDeleted(): bool
    {
        return $this->deletedAt !== null;
    }

    public function getDeletedAt(): ?\DateTimeImmutable
    {
        return $this->deletedAt;
    }
}

/**
 * API Response Trait
 */
trait ApiResponseTrait
{
    protected function success(mixed $data = null, string $message = 'Success', int $code = 200): array
    {
        return [
            'success' => true,
            'message' => $message,
            'data' => $data,
            'code' => $code,
        ];
    }

    protected function error(string $message, int $code = 400, ?array $errors = null): array
    {
        $response = [
            'success' => false,
            'message' => $message,
            'code' => $code,
        ];

        if ($errors !== null) {
            $response['errors'] = $errors;
        }

        return $response;
    }

    protected function paginated(array $data, int $total, int $page, int $perPage): array
    {
        return [
            'success' => true,
            'data' => $data,
            'meta' => [
                'total' => $total,
                'page' => $page,
                'per_page' => $perPage,
                'total_pages' => (int) ceil($total / $perPage),
                'has_more' => ($page * $perPage) < $total,
            ],
        ];
    }
}

/**
 * Transaction Trait
 */
trait TransactionTrait
{
    abstract protected function getDb(): \PDO;

    protected function transaction(callable $callback): mixed
    {
        $db = $this->getDb();

        try {
            $db->beginTransaction();
            $result = $callback();
            $db->commit();
            return $result;
        } catch (\Throwable $e) {
            $db->rollBack();
            throw $e;
        }
    }
}
