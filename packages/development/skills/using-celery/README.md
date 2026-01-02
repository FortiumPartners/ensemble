# Celery & Beat Development Skill

Distributed task queue and periodic scheduling for Python applications with Redis/RabbitMQ brokers.

## Overview

This skill provides comprehensive guidance for Celery development (5.3+) with a focus on:

- **Task Design** - Idempotent, retriable task patterns
- **Beat Scheduler** - Periodic and cron-based scheduling
- **Broker Configuration** - Redis and RabbitMQ setup
- **FastAPI Integration** - Background task patterns (complements Python skill)
- **Testing** - pytest patterns for async task validation

## Skill Structure

```
skills/celery/
├── SKILL.md           # Quick reference (~800 lines)
├── REFERENCE.md       # Comprehensive guide (~1500 lines)
├── VALIDATION.md      # Feature parity tracking
├── README.md          # This file
├── templates/         # Code generation templates
│   ├── task.template.py
│   ├── beat_schedule.template.py
│   ├── celery_config.template.py
│   └── pytest_celery.template.py
└── examples/          # Production-ready examples
    ├── fastapi_celery.example.py
    └── task_patterns.example.py
```

## Quick Start

### For Common Tasks

Use **SKILL.md** for:
- Basic task definitions
- Beat schedule configuration
- Retry patterns
- Task routing
- Monitoring setup

### For Deep Understanding

Use **REFERENCE.md** for:
- Complete architectural guidance
- Multi-queue topology
- Result backend optimization
- Workflow patterns (chains, groups, chords)
- Production hardening

### For Code Generation

Use **templates/** when creating:
- New Celery tasks
- Beat schedule configuration
- Celery application setup
- Task test suites

### For Architecture Reference

Use **examples/** to understand:
- FastAPI + Celery integration
- Complex workflow patterns
- Testing strategies

## Relationship to Python Skill

This skill **complements** the Python skill:

| Python Skill | Celery Skill |
|--------------|--------------|
| FastAPI application structure | Task worker integration |
| Pydantic models for validation | Task argument serialization |
| pytest patterns | Task-specific testing |
| Async/await in web handlers | Async task execution |
| Repository pattern | Task result persistence |

**Load order**: Python skill first, then Celery skill for task-related work.

## Context7 Integration

This skill documents common patterns. For library-specific edge cases:

| When to Use Context7 | Library ID |
|---------------------|------------|
| Advanced Celery features | `/celery/celery` |
| Redis-specific patterns | `/redis/redis-py` |
| RabbitMQ configuration | `/celery/kombu` |
| Flower monitoring | `/mher/flower` |

### Example Context7 Query

```python
# When skill patterns aren't sufficient:
# 1. Resolve library
mcp__context7__resolve_library_id(
    libraryName="celery",
    query="canvas workflow with error handling"
)

# 2. Query docs
mcp__context7__query_docs(
    libraryId="/celery/celery",
    query="how to use chord with error callbacks"
)
```

## Coverage Summary

| Category | Coverage | Notes |
|----------|----------|-------|
| Task Definition | 95% | Decorators, signatures, binding |
| Beat Scheduling | 90% | Cron, intervals, solar |
| Broker Config | 85% | Redis primary, RabbitMQ reference |
| Workflows | 85% | Chains, groups, chords |
| Testing | 90% | pytest fixtures, eager mode |
| Monitoring | 80% | Flower, custom metrics |

See [VALIDATION.md](./VALIDATION.md) for detailed coverage matrix.

## Key Patterns

### Basic Task

```python
from celery import Celery

app = Celery("tasks", broker="redis://localhost:6379/0")

@app.task(bind=True, max_retries=3)
def send_email(self, to: str, subject: str, body: str) -> dict:
    try:
        # Send email logic
        return {"status": "sent", "to": to}
    except ConnectionError as exc:
        raise self.retry(exc=exc, countdown=60)
```

### Beat Schedule

```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    "cleanup-daily": {
        "task": "tasks.cleanup_old_records",
        "schedule": crontab(hour=2, minute=0),
        "args": (30,),  # days_old
    },
    "health-check": {
        "task": "tasks.health_check",
        "schedule": 60.0,  # every 60 seconds
    },
}
```

### FastAPI Integration

```python
from fastapi import FastAPI, BackgroundTasks

app = FastAPI()
celery_app = Celery("tasks", broker="redis://localhost:6379/0")

@app.post("/orders/{order_id}/process")
async def process_order(order_id: int) -> dict:
    # Queue the task
    task = celery_app.send_task(
        "tasks.process_order",
        args=[order_id],
    )
    return {"task_id": task.id, "status": "queued"}
```

## Requirements

- Python 3.11+
- Celery 5.3+
- Redis 4.0+ or RabbitMQ 3.8+
- (Optional) Flower for monitoring

## Related Skills

- **Python** - Core development patterns (`packages/development/skills/python/`)
- **pytest** - Testing framework (`packages/pytest/`)
- **NestJS** - TypeScript equivalent (Bull/BullMQ) (`packages/nestjs/`)

## Maintenance

When updating this skill:

1. Update patterns in SKILL.md or REFERENCE.md
2. Ensure templates reflect current best practices
3. Update VALIDATION.md coverage matrix
4. Test examples still run correctly
5. Verify FastAPI integration examples work with Python skill patterns

## Version

- **Skill Version**: 1.0.0
- **Target Celery**: 5.3+
- **Target Redis**: 4.0+
- **Target Python**: 3.11+

---

**Status**: Production Ready | **Coverage**: 90%
