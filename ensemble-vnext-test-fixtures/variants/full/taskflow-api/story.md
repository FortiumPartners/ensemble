# FastAPI Todo List API

## Overview
Build a RESTful Todo List API using FastAPI with proper Pydantic validation.

## Requirements

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /todos | List all todos |
| POST | /todos | Create a new todo |
| PUT | /todos/{id} | Update an existing todo |
| DELETE | /todos/{id} | Delete a todo |

### Data Model

```python
class Todo:
    id: int
    title: str
    description: Optional[str]
    completed: bool = False
```

### Technical Requirements
- FastAPI with Pydantic models for validation
- Proper HTTP status codes:
  - 200: Success
  - 201: Created
  - 404: Not found
  - 422: Validation error
- Type hints throughout
- Comprehensive test suite using TestClient

## Example Usage

```bash
# Create a todo
POST /todos
{"title": "Buy groceries", "description": "Milk, eggs, bread"}
# Response: 201 Created

# List all todos
GET /todos
# Response: 200 OK, [{"id": 1, "title": "Buy groceries", ...}]

# Update a todo
PUT /todos/1
{"completed": true}
# Response: 200 OK

# Delete a todo
DELETE /todos/1
# Response: 200 OK
```

## File Structure

```
main.py           # FastAPI application
test_main.py      # API tests
```

## Success Criteria
- All CRUD endpoints work correctly
- Pydantic validation enforced
- Tests pass with good coverage
- Proper error handling
