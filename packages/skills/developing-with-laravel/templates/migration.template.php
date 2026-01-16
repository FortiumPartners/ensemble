<?php
/**
 * Migration Template
 *
 * Template Variables:
 *   table: Table name
 *   columns: Array of column definitions
 *     - name: Column name
 *     - type: Column type (string, integer, text, etc.)
 *     - nullable: boolean
 *     - default: Default value
 *     - unique: boolean
 *   indexes: Array of index definitions
 *   foreign_keys: Array of foreign key definitions
 *   soft_deletes: boolean
 *   timestamps: boolean
 *
 * Output: database/migrations/{{ timestamp }}_create_{{ table }}_table.php
 */

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('{{ table }}', function (Blueprint $table) {
            $table->id();

            {% for col in columns %}
            {% if col.type == 'foreignId' %}
            $table->foreignId('{{ col.name }}'){% if col.nullable %}->nullable(){% endif %}->constrained({% if col.references %}'{{ col.references }}'{% endif %}){% if col.cascade %}->cascadeOnDelete(){% endif %};
            {% elif col.type == 'string' %}
            $table->string('{{ col.name }}'{% if col.length %}, {{ col.length }}{% endif %}){% if col.nullable %}->nullable(){% endif %}{% if col.default is defined %}->default('{{ col.default }}'){% endif %}{% if col.unique %}->unique(){% endif %};
            {% elif col.type == 'text' %}
            $table->text('{{ col.name }}'){% if col.nullable %}->nullable(){% endif %};
            {% elif col.type == 'integer' %}
            $table->integer('{{ col.name }}'){% if col.unsigned %}->unsigned(){% endif %}{% if col.nullable %}->nullable(){% endif %}{% if col.default is defined %}->default({{ col.default }}){% endif %};
            {% elif col.type == 'bigInteger' %}
            $table->bigInteger('{{ col.name }}'){% if col.unsigned %}->unsigned(){% endif %}{% if col.nullable %}->nullable(){% endif %};
            {% elif col.type == 'decimal' %}
            $table->decimal('{{ col.name }}', {{ col.precision | default(10) }}, {{ col.scale | default(2) }}){% if col.nullable %}->nullable(){% endif %}{% if col.default is defined %}->default({{ col.default }}){% endif %};
            {% elif col.type == 'boolean' %}
            $table->boolean('{{ col.name }}'){% if col.default is defined %}->default({{ col.default | lower }}){% endif %};
            {% elif col.type == 'date' %}
            $table->date('{{ col.name }}'){% if col.nullable %}->nullable(){% endif %};
            {% elif col.type == 'datetime' %}
            $table->dateTime('{{ col.name }}'){% if col.nullable %}->nullable(){% endif %};
            {% elif col.type == 'timestamp' %}
            $table->timestamp('{{ col.name }}'){% if col.nullable %}->nullable(){% endif %};
            {% elif col.type == 'json' %}
            $table->json('{{ col.name }}'){% if col.nullable %}->nullable(){% endif %};
            {% elif col.type == 'enum' %}
            $table->enum('{{ col.name }}', [{{ col.values | map("'%s'" | format) | join(', ') }}]){% if col.nullable %}->nullable(){% endif %}{% if col.default is defined %}->default('{{ col.default }}'){% endif %};
            {% else %}
            $table->{{ col.type }}('{{ col.name }}'){% if col.nullable %}->nullable(){% endif %};
            {% endif %}
            {% endfor %}

            {% if timestamps %}
            $table->timestamps();
            {% endif %}
            {% if soft_deletes %}
            $table->softDeletes();
            {% endif %}

            // Indexes
            {% for index in indexes %}
            {% if index.type == 'unique' %}
            $table->unique([{{ index.columns | map("'%s'" | format) | join(', ') }}]);
            {% elif index.type == 'index' %}
            $table->index([{{ index.columns | map("'%s'" | format) | join(', ') }}]);
            {% endif %}
            {% endfor %}
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('{{ table }}');
    }
};
