# Technology Stack - todo-list-api

> Generated: 2026-01-14

## Platform

**Primary Platform:** Python 3.11+

## Languages

| Language | Purpose |
|----------|---------|
| Python | Core application logic, API endpoints |

## Frameworks & Libraries

| Component | Technology | Purpose |
|-----------|------------|---------|
| Web Framework | FastAPI | REST API with async support |
| Validation | Pydantic | Request/response model validation |

## Testing

| Type | Framework | Location |
|------|-----------|----------|
| Unit | pytest | `tests/unit/` |
| Integration | pytest | `tests/integration/` |
| API Testing | pytest + httpx | `tests/api/` |

## Database

Not yet configured - to be determined based on requirements.

## Infrastructure

To be configured based on deployment requirements.

## Architecture

- RESTful API design
- Pydantic models for data validation
- Standard CRUD operations pattern

## Key Patterns

- **Request Validation:** Pydantic models for all request bodies
- **Response Models:** Typed Pydantic responses for all endpoints
- **Error Handling:** FastAPI exception handlers with consistent error format
