# Celery Examples

Production-ready examples demonstrating Celery patterns and FastAPI integration.

## Available Examples

| Example | Description | Key Patterns |
|---------|-------------|--------------|
| `task_patterns.example.py` | Core task patterns | Idempotency, retries, workflows |
| `fastapi_celery.example.py` | FastAPI integration | API endpoints, polling, progress |

## task_patterns.example.py

Demonstrates:
- **Idempotent Tasks** - Safe to retry without side effects
- **Retry Strategies** - Exponential backoff, conditional retry
- **Workflow Patterns** - Chains, groups, chords
- **Error Handling** - Dead letter queue, circuit breaker
- **Rate Limiting** - Protect external services

## fastapi_celery.example.py

Demonstrates:
- **Task Triggering** - Queue tasks from API endpoints
- **Status Polling** - Check task status and results
- **Progress Tracking** - Real-time progress updates
- **Task Revocation** - Cancel running tasks
- **Health Checks** - Monitor worker health
- **Webhook Callbacks** - Notify on completion

## Running Examples

### Prerequisites

```bash
# Install dependencies
pip install celery[redis] fastapi uvicorn pydantic-settings

# Start Redis
docker run -d -p 6379:6379 redis:7-alpine
```

### Start Worker

```bash
# In project directory
celery -A examples.task_patterns worker --loglevel=info
```

### Start Beat (for scheduled tasks)

```bash
celery -A examples.task_patterns beat --loglevel=info
```

### Start FastAPI

```bash
uvicorn examples.fastapi_celery:app --reload
```

## Integration with Python Skill

These examples complement the Python skill patterns:

| Python Skill Pattern | Celery Example |
|---------------------|----------------|
| FastAPI application factory | `fastapi_celery.example.py` |
| Pydantic models | Task input/output schemas |
| Repository pattern | Task result persistence |
| pytest patterns | Task testing fixtures |
| Error handling | Task retry and DLQ patterns |
