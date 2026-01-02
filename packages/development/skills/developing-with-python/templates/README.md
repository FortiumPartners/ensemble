# Python Development Templates

Code generation templates for rapid Python development with production-ready patterns.

## Available Templates

### 1. module.template.py
**Standard Python Module**

Demonstrates:
- Module docstring and `__all__` exports
- Type hints with `from __future__ import annotations`
- Dataclass for data structures
- Function with full type annotations
- Error handling patterns

**Placeholders**:
- `{{module_name}}` - Module name (snake_case)
- `{{ModuleName}}` - Class name (PascalCase)
- `{{description}}` - Module description

---

### 2. service.template.py
**Service Class with Dependency Injection**

Demonstrates:
- Async service pattern
- Repository dependency injection
- Type-safe method signatures
- Error handling with custom exceptions
- Logging integration

**Placeholders**:
- `{{ServiceName}}` - Service class name
- `{{EntityName}}` - Entity being managed
- `{{entity_name}}` - Entity name (snake_case)

---

### 3. fastapi_router.template.py
**FastAPI Router with CRUD Operations**

Demonstrates:
- Router setup with tags
- All CRUD endpoints (GET, POST, PUT, DELETE)
- Pydantic schemas for request/response
- Dependency injection for auth and database
- Proper HTTP status codes
- OpenAPI documentation

**Placeholders**:
- `{{EntityName}}` - Entity name (PascalCase)
- `{{entity_name}}` - Entity name (snake_case)
- `{{entities}}` - Plural form for routes

---

### 4. pytest.template.py
**pytest Test Suite**

Demonstrates:
- Test class organization
- Fixtures for common setup
- Async test patterns
- Parametrized tests
- Mock and patch usage
- API integration tests

**Placeholders**:
- `{{TestSubject}}` - What's being tested
- `{{test_subject}}` - snake_case version

---

### 5. cli.template.py
**Command-Line Application**

Demonstrates:
- argparse configuration
- Subcommands pattern
- Configuration loading
- Logging setup
- Exit code handling
- Testable main function

**Placeholders**:
- `{{cli_name}}` - CLI application name
- `{{description}}` - CLI description

---

## Usage

### Manual Replacement

```bash
# Copy template
cp templates/module.template.py src/my_module.py

# Replace placeholders
sed -i 's/{{module_name}}/my_module/g' src/my_module.py
sed -i 's/{{ModuleName}}/MyModule/g' src/my_module.py
```

### With Python Script

```python
from pathlib import Path
import re


def generate_from_template(
    template_path: str,
    output_path: str,
    replacements: dict[str, str],
) -> None:
    """Generate file from template with replacements."""
    template = Path(template_path).read_text()

    for placeholder, value in replacements.items():
        template = template.replace(f"{{{{{placeholder}}}}}", value)

    Path(output_path).write_text(template)


# Example usage
generate_from_template(
    "templates/service.template.py",
    "src/services/user_service.py",
    {
        "ServiceName": "UserService",
        "EntityName": "User",
        "entity_name": "user",
    },
)
```

---

## Template Checklist

Before using templates in production:

- [ ] All placeholders replaced
- [ ] mypy passes with strict mode
- [ ] ruff check passes
- [ ] ruff format applied
- [ ] Tests written for new code
- [ ] Docstrings complete

---

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference for Python patterns
- [REFERENCE.md](../REFERENCE.md) - Comprehensive Python guide
- [examples/](../examples/) - Real-world implementation examples

---

**Status**: Production Ready
