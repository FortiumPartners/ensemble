<?php
/**
 * Interface Template
 *
 * Template Variables:
 *   namespace: Full namespace
 *   name: Interface name
 *   extends: Array of parent interfaces
 *   methods: Array of method signatures
 *   constants: Array of constants
 *
 * Output: src/Contracts/{{ name }}.php
 */

declare(strict_types=1);

namespace {{ namespace }};

/**
 * {{ name }}
 *
 * {{ description | default('TODO: Add interface description') }}
 */
interface {{ name }}{% if extends %} extends {{ extends | join(', ') }}{% endif %}

{
    {% for const in constants | default([]) %}
    public const {{ const.name }} = {{ const.value }};
    {% endfor %}

    {% for method in methods %}
    /**
     * {{ method.description | default('TODO: Add method description') }}
     *
     {% for param in method.params | default([]) %}
     * @param {{ param.type }} ${{ param.name }} {{ param.description | default('') }}
     {% endfor %}
     * @return {{ method.return_type }}
     {% if method.throws %}
     * @throws {{ method.throws | join(', ') }}
     {% endif %}
     */
    public function {{ method.name }}({% for param in method.params | default([]) %}{{ param.type }}{% if param.nullable %}?{% endif %} ${{ param.name }}{% if param.default is defined %} = {{ param.default }}{% endif %}{% if not loop.last %}, {% endif %}{% endfor %}): {{ method.return_type }};
    {% endfor %}
}

// =============================================================================
// Common Interface Patterns
// =============================================================================

/**
 * Repository Interface
 */
interface RepositoryInterface
{
    public function find(int $id): ?object;
    public function findBy(array $criteria): array;
    public function findOneBy(array $criteria): ?object;
    public function findAll(): array;
    public function save(object $entity): void;
    public function delete(object $entity): void;
    public function count(array $criteria = []): int;
}

/**
 * Handler Interface
 */
interface HandlerInterface
{
    public function get(int $id): ?array;
    public function getAll(array $filters = []): array;
    public function save(array $data): int;
    public function update(int $id, array $data): bool;
    public function delete(int $id): bool;
}

/**
 * Cache Interface (PSR-16 SimpleCache)
 */
interface CacheInterface
{
    public function get(string $key, mixed $default = null): mixed;
    public function set(string $key, mixed $value, ?int $ttl = null): bool;
    public function delete(string $key): bool;
    public function clear(): bool;
    public function has(string $key): bool;
}

/**
 * Logger Interface (PSR-3 subset)
 */
interface LoggerInterface
{
    public function emergency(string $message, array $context = []): void;
    public function alert(string $message, array $context = []): void;
    public function critical(string $message, array $context = []): void;
    public function error(string $message, array $context = []): void;
    public function warning(string $message, array $context = []): void;
    public function notice(string $message, array $context = []): void;
    public function info(string $message, array $context = []): void;
    public function debug(string $message, array $context = []): void;
}

/**
 * Service Interface
 */
interface ServiceInterface
{
    public function execute(array $input): mixed;
}

/**
 * Factory Interface
 */
interface FactoryInterface
{
    public function create(array $data): object;
}

/**
 * Validator Interface
 */
interface ValidatorInterface
{
    public function validate(mixed $data): bool;
    public function getErrors(): array;
}
