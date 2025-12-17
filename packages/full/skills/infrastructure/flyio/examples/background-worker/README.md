# Background Worker - Fly.io Deployment

Celery worker for processing background jobs without HTTP interface.

## Features
- ✅ Worker-only configuration (no HTTP)
- ✅ Redis for job queue
- ✅ Task retry with exponential backoff
- ✅ Configurable concurrency
- ✅ Multiple worker types

## Quick Start

### 1. Create Redis Instance

```bash
flyctl redis create --name worker-redis
```

### 2. Set Redis URL

```bash
flyctl secrets set REDIS_URL=redis://...
```

### 3. Deploy Worker

```bash
flyctl apps create background-worker
./deploy.sh
```

## Task Examples

### Queue Tasks from API

```python
# In your web application
from tasks import process_data, send_email

# Queue task
process_data.delay(data_id=123)
send_email.delay("user@example.com", "Welcome", "Hello!")
```

### Monitor Tasks

```bash
# View worker logs
flyctl logs

# Check Redis queue
flyctl redis connect
> LLEN celery

# Monitor task status
celery -A tasks inspect active
```

## Scaling

```bash
# Scale workers vertically
flyctl scale vm shared-cpu-2x --memory 1024

# Scale workers horizontally
flyctl scale count 5

# Configure concurrency
flyctl secrets set WORKER_CONCURRENCY=20
```

## Task Patterns

### Retry Logic

```python
@app.task(bind=True, max_retries=3, default_retry_delay=60)
def unreliable_task(self):
    try:
        # Task logic
        pass
    except Exception as exc:
        raise self.retry(exc=exc)
```

### Scheduled Tasks

```python
from celery.schedules import crontab

app.conf.beat_schedule = {
    'cleanup-every-day': {
        'task': 'tasks.cleanup',
        'schedule': crontab(hour=0, minute=0),
    },
}
```

### Task Chaining

```python
from celery import chain

# Chain tasks
workflow = chain(
    process_data.s(123),
    generate_report.s(),
    send_email.s()
)
workflow.apply_async()
```

## Monitoring

### Flower Dashboard

Add to Dockerfile:

```dockerfile
RUN pip install flower
CMD ["celery", "-A", "tasks", "flower", "--port=5555"]
```

Access dashboard at port 5555.

### Prometheus Metrics

```python
from celery.signals import task_success, task_failure

@task_success.connect
def task_success_handler(sender=None, **kwargs):
    # Export metrics
    pass
```

## Troubleshooting

### Worker not processing tasks

```bash
# Check worker is running
flyctl logs

# Check Redis connection
flyctl ssh console -C "python -c 'import redis; r=redis.from_url(\"$REDIS_URL\"); print(r.ping())'"

# Inspect worker
flyctl ssh console -C "celery -A tasks inspect active"
```

### High memory usage

```bash
# Reduce concurrency
flyctl secrets set WORKER_CONCURRENCY=5

# Scale memory
flyctl scale vm shared-cpu-1x --memory 1024
```

## Production Checklist

- [ ] Set REDIS_URL secret
- [ ] Configure task timeouts
- [ ] Set up task result backend
- [ ] Configure retry policies
- [ ] Set up monitoring (Flower/Prometheus)
- [ ] Configure dead letter queue
- [ ] Test failure scenarios
- [ ] Set up alerts for queue size
- [ ] Configure log aggregation

## Resources
- [Celery Documentation](https://docs.celeryq.dev/)
- [Redis Documentation](https://redis.io/docs/)
- [Task Queue Patterns](https://docs.celeryq.dev/en/stable/userguide/tasks.html)
