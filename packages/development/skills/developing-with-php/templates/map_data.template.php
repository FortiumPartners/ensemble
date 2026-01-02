<?php
/**
 * MapData/DTO Class Template
 *
 * Template Variables:
 *   entity: Entity name (e.g., "Contact")
 *   properties: Array of property definitions [{name, type, nullable, default}]
 *   from_array: boolean - Include fromArray static method
 *   from_row: boolean - Include fromRow for database rows
 *   to_array: boolean - Include toArray method
 *
 * Output: src/MapData/{{ entity }}Map.php
 */

declare(strict_types=1);

namespace App\MapData;

readonly class {{ entity }}Map
{
    public function __construct(
        {% for prop in properties %}
        public {{ prop.type }}{% if prop.nullable %}?{% endif %} ${{ prop.name }}{% if prop.default is defined %} = {{ prop.default }}{% elif prop.nullable %} = null{% endif %},
        {% endfor %}
    ) {
    }

    {% if from_array | default(true) %}
    /**
     * Create from associative array (e.g., request data)
     */
    public static function fromArray(array $data): self
    {
        return new self(
            {% for prop in properties %}
            {{ prop.name }}: {% if prop.type == 'int' %}(int) {% elif prop.type == 'float' %}(float) {% elif prop.type == 'bool' %}(bool) {% endif %}($data['{{ prop.name }}'] ?? {{ prop.default | default('null') }}),
            {% endfor %}
        );
    }
    {% endif %}

    {% if from_row | default(true) %}
    /**
     * Create from database row
     */
    public static function fromRow(array $row): self
    {
        return new self(
            {% for prop in properties %}
            {{ prop.name }}: {% if prop.type == 'int' %}(int) {% elif prop.type == 'float' %}(float) {% elif prop.type == 'bool' %}(bool) {% endif %}($row['{{ prop.db_column | default(prop.name) }}'] ?? {{ prop.default | default('null') }}),
            {% endfor %}
        );
    }
    {% endif %}

    {% if to_array | default(true) %}
    /**
     * Convert to array for serialization
     */
    public function toArray(): array
    {
        return [
            {% for prop in properties %}
            '{{ prop.name }}' => $this->{{ prop.name }},
            {% endfor %}
        ];
    }
    {% endif %}

    /**
     * Convert to JSON
     */
    public function toJson(): string
    {
        return json_encode($this->toArray(), JSON_THROW_ON_ERROR);
    }
}

// =============================================================================
// Collection Class (Optional)
// =============================================================================

class {{ entity }}MapCollection implements \Countable, \IteratorAggregate
{
    /** @var {{ entity }}Map[] */
    private array $items = [];

    public function __construct(array $rows = [])
    {
        foreach ($rows as $row) {
            $this->items[] = {{ entity }}Map::fromRow($row);
        }
    }

    public function add({{ entity }}Map $item): void
    {
        $this->items[] = $item;
    }

    public function all(): array
    {
        return $this->items;
    }

    public function first(): ?{{ entity }}Map
    {
        return $this->items[0] ?? null;
    }

    public function toArray(): array
    {
        return array_map(
            fn({{ entity }}Map $item): array => $item->toArray(),
            $this->items
        );
    }

    public function filter(callable $callback): self
    {
        $collection = new self();
        $collection->items = array_values(array_filter($this->items, $callback));
        return $collection;
    }

    public function map(callable $callback): array
    {
        return array_map($callback, $this->items);
    }

    public function count(): int
    {
        return count($this->items);
    }

    public function getIterator(): \Traversable
    {
        return new \ArrayIterator($this->items);
    }
}
