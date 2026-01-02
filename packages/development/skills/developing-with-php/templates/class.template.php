<?php
/**
 * PSR-12 Compliant Class Template
 *
 * Template Variables:
 *   namespace: Full namespace
 *   class_name: Class name
 *   extends: Parent class (optional)
 *   implements: Array of interfaces
 *   traits: Array of traits to use
 *   properties: Array of properties
 *   constructor_params: Array of constructor parameters
 *   methods: Array of method definitions
 *   final: boolean - Make class final
 *   readonly: boolean - Make class readonly (PHP 8.2+)
 *
 * Output: src/{{ class_name }}.php
 */

declare(strict_types=1);

namespace {{ namespace }};

{% for use in uses | default([]) %}
use {{ use }};
{% endfor %}

/**
 * {{ class_name }}
 *
 * {{ description | default('TODO: Add class description') }}
 */
{% if final | default(false) %}final {% endif %}{% if readonly | default(false) %}readonly {% endif %}class {{ class_name }}{% if extends %} extends {{ extends }}{% endif %}{% if implements %} implements {{ implements | join(', ') }}{% endif %}

{
    {% if traits %}
    {% for trait in traits %}
    use {{ trait }};
    {% endfor %}

    {% endif %}
    // =========================================================================
    // Constants
    // =========================================================================

    {% for const in constants | default([]) %}
    public const {{ const.name }} = {{ const.value }};
    {% endfor %}

    // =========================================================================
    // Properties
    // =========================================================================

    {% for prop in properties | default([]) %}
    {{ prop.visibility | default('private') }}{% if prop.static %} static{% endif %}{% if prop.readonly %} readonly{% endif %} {{ prop.type }}{% if prop.nullable %}?{% endif %} ${{ prop.name }}{% if prop.default is defined %} = {{ prop.default }}{% endif %};
    {% endfor %}

    // =========================================================================
    // Constructor
    // =========================================================================

    public function __construct(
        {% for param in constructor_params | default([]) %}
        {{ param.visibility | default('private') }} {% if param.readonly | default(true) %}readonly {% endif %}{{ param.type }}{% if param.nullable %}?{% endif %} ${{ param.name }}{% if param.default is defined %} = {{ param.default }}{% endif %},
        {% endfor %}
    ) {
        {% if parent_constructor | default(false) %}
        parent::__construct();
        {% endif %}
    }

    // =========================================================================
    // Public Methods
    // =========================================================================

    {% for method in methods | default([]) %}
    {% if method.visibility | default('public') == 'public' %}
    /**
     * {{ method.description | default('TODO: Add method description') }}
     *
     {% for param in method.params | default([]) %}
     * @param {{ param.type }} ${{ param.name }}
     {% endfor %}
     * @return {{ method.return_type | default('void') }}
     */
    public{% if method.static %} static{% endif %} function {{ method.name }}({% for param in method.params | default([]) %}{{ param.type }} ${{ param.name }}{% if param.default is defined %} = {{ param.default }}{% endif %}{% if not loop.last %}, {% endif %}{% endfor %}): {{ method.return_type | default('void') }}
    {
        {{ method.body | default('// TODO: Implement') }}
    }

    {% endif %}
    {% endfor %}

    // =========================================================================
    // Protected Methods
    // =========================================================================

    {% for method in methods | default([]) %}
    {% if method.visibility == 'protected' %}
    protected{% if method.static %} static{% endif %} function {{ method.name }}({% for param in method.params | default([]) %}{{ param.type }} ${{ param.name }}{% if not loop.last %}, {% endif %}{% endfor %}): {{ method.return_type | default('void') }}
    {
        {{ method.body | default('// TODO: Implement') }}
    }

    {% endif %}
    {% endfor %}

    // =========================================================================
    // Private Methods
    // =========================================================================

    {% for method in methods | default([]) %}
    {% if method.visibility == 'private' %}
    private{% if method.static %} static{% endif %} function {{ method.name }}({% for param in method.params | default([]) %}{{ param.type }} ${{ param.name }}{% if not loop.last %}, {% endif %}{% endfor %}): {{ method.return_type | default('void') }}
    {
        {{ method.body | default('// TODO: Implement') }}
    }

    {% endif %}
    {% endfor %}
}
