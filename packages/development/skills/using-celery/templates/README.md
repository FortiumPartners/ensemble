# Celery Templates

Code generation templates for Celery tasks and configuration.

## Available Templates

| Template | Purpose | Output |
|----------|---------|--------|
| `task.template.py` | Task definitions with retry logic | `tasks/{name}.py` |
| `beat_schedule.template.py` | Beat scheduler configuration | `celery_beat.py` |
| `celery_config.template.py` | Full Celery application setup | `celery_app.py` |
| `pytest_celery.template.py` | Test fixtures and patterns | `tests/conftest.py` |

## Template Variables

### task.template.py

```python
{
    "task_name": "send_notification",      # Function name (snake_case)
    "task_full_name": "tasks.send_notification",  # Full task name
    "max_retries": 3,                      # Maximum retry attempts
    "default_retry_delay": 60,             # Seconds between retries
    "retry_backoff": True,                 # Use exponential backoff
    "retry_backoff_max": 600,              # Max backoff seconds
    "time_limit": 300,                     # Hard time limit
    "soft_time_limit": 240,                # Soft time limit
    "rate_limit": None,                    # e.g., "10/m" or None
    "queue": "default",                    # Target queue
    "ignore_result": False,                # Store result or not
    "parameters": [                        # Task parameters
        {"name": "user_id", "type": "int"},
        {"name": "message", "type": "str"},
    ],
    "return_type": "dict",                 # Return type hint
}
```

### beat_schedule.template.py

```python
{
    "schedules": [
        {
            "name": "daily-cleanup",       # Schedule entry name
            "task": "tasks.cleanup",       # Task to run
            "schedule_type": "crontab",    # "crontab" or "interval"
            "crontab": {                   # For crontab type
                "hour": 2,
                "minute": 0,
                "day_of_week": "*",
            },
            "interval_seconds": None,      # For interval type
            "args": [30],                  # Positional arguments
            "kwargs": {},                  # Keyword arguments
            "queue": None,                 # Optional queue override
        }
    ]
}
```

### celery_config.template.py

```python
{
    "app_name": "myapp",                   # Celery app name
    "broker_url": "redis://localhost:6379/0",
    "result_backend": "redis://localhost:6379/1",
    "task_modules": [                      # Autodiscovery paths
        "myapp.tasks.email",
        "myapp.tasks.reports",
    ],
    "queues": [                            # Queue definitions
        {"name": "default", "routing_key": "default"},
        {"name": "high_priority", "routing_key": "high"},
    ],
    "timezone": "UTC",
    "task_time_limit": 300,
    "worker_concurrency": 4,
}
```

### pytest_celery.template.py

```python
{
    "app_module": "myapp.celery_app",      # Path to celery app
    "app_variable": "celery_app",          # Variable name in module
    "use_real_worker": False,              # Include worker fixture
    "test_broker": "memory://",            # Test broker URL
    "test_backend": "cache+memory://",     # Test backend URL
}
```

## Usage Example

```python
# In your agent or automation:
template = load_template("task.template.py")
code = render_template(template, {
    "task_name": "process_order",
    "max_retries": 5,
    "parameters": [
        {"name": "order_id", "type": "int"},
        {"name": "priority", "type": "str", "default": '"normal"'},
    ],
    "return_type": "dict",
})
write_file("src/myapp/tasks/orders.py", code)
```

## Best Practices

1. **Idempotency**: All task templates include idempotency key patterns
2. **Retry Logic**: Templates default to exponential backoff
3. **Type Hints**: All templates use full type annotations
4. **Docstrings**: Templates include comprehensive docstrings
5. **Error Handling**: Templates include proper exception handling
