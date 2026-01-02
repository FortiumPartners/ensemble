# Python Development Examples

Real-world implementation examples demonstrating production-ready patterns and best practices.

## Available Examples

### 1. patterns.example.py

**Design Patterns in Python**

Demonstrates:
- Repository pattern with async support
- Service layer pattern
- Unit of Work pattern
- Factory pattern
- Strategy pattern
- Dependency injection

**Use this example when**:
- Structuring backend applications
- Implementing clean architecture
- Building testable code

---

### 2. fastapi_app.example.py

**Complete FastAPI Application**

Demonstrates:
- Application factory pattern
- Router organization
- Dependency injection
- Pydantic models and validation
- Error handling middleware
- Authentication/authorization
- Database integration patterns
- Background tasks

**Use this example when**:
- Starting a new FastAPI project
- Learning FastAPI best practices
- Implementing REST APIs

---

### 3. async_patterns.example.py

**Async/Await Patterns**

Demonstrates:
- Concurrent execution with gather
- Rate limiting and semaphores
- Async context managers
- Async generators and streaming
- Task groups (Python 3.11+)
- Error handling in async code

**Use this example when**:
- Building async applications
- Optimizing I/O-bound operations
- Implementing concurrent processing

---

## How to Use These Examples

### 1. Study the Pattern

Each example is self-contained with extensive comments:

```bash
# Read the example
cat examples/patterns.example.py

# Run with Python
python examples/patterns.example.py
```

### 2. Adapt to Your Project

```bash
# Copy relevant sections
cp examples/fastapi_app.example.py src/main.py

# Modify for your domain
# - Change entity names
# - Adjust validation rules
# - Add your business logic
```

### 3. Run Tests

```bash
# Examples include test patterns
pytest examples/ -v
```

---

## Best Practices Checklist

When implementing these patterns:

- [ ] **Type Hints**: All functions have complete type annotations
- [ ] **Async**: Use async for I/O operations
- [ ] **Validation**: Pydantic models for all external data
- [ ] **Error Handling**: Custom exceptions with proper hierarchy
- [ ] **Logging**: Structured logging with context
- [ ] **Testing**: Unit tests with mocks, integration tests with fixtures
- [ ] **Documentation**: Docstrings for public APIs

---

## Context7 Integration

For library-specific details beyond these examples, use Context7:

```python
# When you need more details on a library:
# 1. Resolve the library ID
mcp__context7__resolve-library-id(
    libraryName="fastapi",
    query="WebSocket authentication"
)

# 2. Query the docs
mcp__context7__query-docs(
    libraryId="/tiangolo/fastapi",
    query="how to authenticate WebSocket connections"
)
```

---

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference patterns
- [REFERENCE.md](../REFERENCE.md) - Comprehensive guide
- [templates/](../templates/) - Code generation templates

---

**Status**: Production Ready
