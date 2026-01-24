# Celery & Beat Comprehensive Reference

This document provides in-depth coverage of Celery patterns, configuration, and best practices for production deployments.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Broker Configuration](#2-broker-configuration)
3. [Task Design Patterns](#3-task-design-patterns)
4. [Workflow Patterns (Canvas)](#4-workflow-patterns-canvas)
5. [Beat Scheduler Advanced](#5-beat-scheduler-advanced)
6. [Result Backends](#6-result-backends)
7. [Worker Management](#7-worker-management)
8. [Error Handling & Reliability](#8-error-handling--reliability)
9. [Performance Optimization](#9-performance-optimization)
10. [Production Deployment](#10-production-deployment)

---

## 1. Architecture Overview

### Component Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   FastAPI App   │────▶│  Message Broker │────▶│  Celery Worker  │
│   (Producer)    │     │  (Redis/RMQ)    │     │   (Consumer)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │                        │
                               │                        ▼
┌─────────────────┐            │              ┌─────────────────┐
│  Celery Beat    │────────────┘              │  Result Backend │
│  (Scheduler)    │                           │  (Redis/DB)     │
└─────────────────┘                           └─────────────────┘
```

### Component Responsibilities

| Component | Purpose | Scaling Strategy |
|-----------|---------|------------------|
| **Producer** | Sends tasks to broker | Horizontal (app replicas) |
| **Broker** | Message queue | Cluster (Redis Cluster, RMQ Cluster) |
| **Worker** | Executes tasks | Horizontal (add workers) |
| **Beat** | Schedules periodic tasks | Single instance (leader election) |
| **Result Backend** | Stores task results | Same as broker or separate |

### Message Flow

```python
# 1. Producer sends task
task = send_email.delay("user@example.com", "Subject", "Body")
# Creates message: {"task": "tasks.send_email", "args": [...], "id": "uuid"}

# 2. Broker queues message
# Redis: LPUSH celery (serialized message)
# RMQ: Publish to exchange → routing → queue

# 3. Worker fetches message
# Worker.consume() → deserialize → execute task function

# 4. Worker stores result (if configured)
# Result backend: SET celery-task-meta-{task_id} {result_json}

# 5. Producer retrieves result (optional)
result = task.get(timeout=30)
```

---

## 2. Broker Configuration

### Redis Broker

```python
# Basic Redis
broker_url = "redis://localhost:6379/0"

# Redis with password
broker_url = "redis://:password@localhost:6379/0"

# Redis Sentinel
broker_url = "sentinel://sentinel1:26379;sentinel2:26379/mymaster/0"

# Redis Cluster
broker_url = "redis+cluster://node1:6379,node2:6379,node3:6379/0"

# Connection pool settings
broker_pool_limit = 10  # Max connections
broker_connection_timeout = 4.0  # Seconds
broker_connection_retry = True
broker_connection_retry_on_startup = True
broker_connection_max_retries = 10
```

### Redis Visibility Timeout

```python
# Critical for task reliability
broker_transport_options = {
    "visibility_timeout": 43200,  # 12 hours (must exceed longest task)
    "fanout_prefix": True,
    "fanout_patterns": True,
    "socket_timeout": 5.0,
    "socket_connect_timeout": 5.0,
    "retry_on_timeout": True,
}
```

### RabbitMQ Broker

```python
# Basic RabbitMQ
broker_url = "amqp://guest:guest@localhost:5672//"

# With virtual host
broker_url = "amqp://user:pass@host:5672/myvhost"

# SSL/TLS
broker_url = "amqps://user:pass@host:5671//"
broker_use_ssl = {
    "keyfile": "/path/to/key.pem",
    "certfile": "/path/to/cert.pem",
    "ca_certs": "/path/to/ca.pem",
    "cert_reqs": ssl.CERT_REQUIRED,
}

# Heartbeat
broker_heartbeat = 30

# Publisher confirms
broker_transport_options = {
    "confirm_publish": True,
}
```

### Queue Topology

```python
from kombu import Queue, Exchange

# Define exchanges
default_exchange = Exchange("default", type="direct")
topic_exchange = Exchange("topics", type="topic")

# Define queues
task_queues = (
    Queue("default", default_exchange, routing_key="default"),
    Queue("high_priority", default_exchange, routing_key="high"),
    Queue("low_priority", default_exchange, routing_key="low"),
    Queue("email", topic_exchange, routing_key="notifications.email.#"),
    Queue("sms", topic_exchange, routing_key="notifications.sms.#"),
)

# Routing
task_routes = {
    "tasks.send_email": {"queue": "email", "routing_key": "notifications.email.transactional"},
    "tasks.send_sms": {"queue": "sms", "routing_key": "notifications.sms.alerts"},
    "tasks.generate_report": {"queue": "low_priority"},
    "tasks.process_payment": {"queue": "high_priority"},
}
```

---

## 3. Task Design Patterns

### Idempotent Tasks

```python
from celery import shared_task
from dataclasses import dataclass
from hashlib import sha256


@dataclass
class IdempotencyKey:
    """Generate unique idempotency keys."""

    @staticmethod
    def for_order(order_id: int, action: str) -> str:
        return sha256(f"order:{order_id}:{action}".encode()).hexdigest()[:32]

    @staticmethod
    def for_user(user_id: int, action: str, date: str) -> str:
        return sha256(f"user:{user_id}:{action}:{date}".encode()).hexdigest()[:32]


@shared_task(bind=True)
def process_payment(self, order_id: int, amount: float) -> dict:
    """Idempotent payment processing."""
    idempotency_key = IdempotencyKey.for_order(order_id, "payment")

    # Check if already processed
    existing = PaymentRecord.query.filter_by(
        idempotency_key=idempotency_key
    ).first()

    if existing:
        return {"status": "already_processed", "payment_id": existing.id}

    # Process payment
    payment = payment_gateway.charge(order_id, amount)

    # Record with idempotency key
    record = PaymentRecord(
        order_id=order_id,
        payment_id=payment.id,
        idempotency_key=idempotency_key,
    )
    db.session.add(record)
    db.session.commit()

    return {"status": "processed", "payment_id": payment.id}
```

### Task Signatures and Partials

```python
from celery import signature, Signature


# Create signature (lazy task reference)
sig = send_email.s("user@example.com", "Subject", "Body")

# Partial signature (incomplete arguments)
partial = process_order.s()  # Will receive order_id later
partial.delay(123)  # Now complete

# Immutable signature (ignore parent result)
immutable = cleanup.si()  # s(immutable=True)

# Signature with options
sig_with_options = send_email.signature(
    args=("user@example.com", "Subject", "Body"),
    kwargs={"priority": "high"},
    countdown=60,
    expires=3600,
    retry=True,
    retry_policy={
        "max_retries": 3,
        "interval_start": 0,
        "interval_step": 0.2,
        "interval_max": 0.5,
    },
)

# Clone and modify
new_sig = sig.clone()
new_sig.args = ("other@example.com", "New Subject", "New Body")
new_sig.set(queue="high_priority")
```

### Task Inheritance

```python
from celery import Task, shared_task
from functools import wraps


class BaseTask(Task):
    """Base task with common functionality."""

    abstract = True
    max_retries = 3
    default_retry_delay = 60

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails after all retries."""
        logger.error(
            f"Task {self.name}[{task_id}] failed: {exc}",
            exc_info=einfo.exception,
        )
        # Send alert
        notify_failure(self.name, task_id, str(exc))

    def on_success(self, retval, task_id, args, kwargs):
        """Called when task succeeds."""
        logger.info(f"Task {self.name}[{task_id}] completed")
        metrics.increment(f"task.{self.name}.success")

    def on_retry(self, exc, task_id, args, kwargs, einfo):
        """Called when task is retried."""
        logger.warning(
            f"Task {self.name}[{task_id}] retrying: {exc}",
        )
        metrics.increment(f"task.{self.name}.retry")

    def before_start(self, task_id, args, kwargs):
        """Called before task starts."""
        self.start_time = time.time()

    def after_return(self, status, retval, task_id, args, kwargs, einfo):
        """Called after task returns (success or failure)."""
        duration = time.time() - self.start_time
        metrics.timing(f"task.{self.name}.duration", duration)


@shared_task(bind=True, base=BaseTask)
def my_task(self, data: dict) -> dict:
    """Task using base class."""
    return process(data)
```

### Bound Tasks with Request Context

```python
@shared_task(bind=True)
def contextual_task(self, data: dict) -> dict:
    """Task with full request context access."""

    # Task ID
    task_id = self.request.id

    # Retry count
    retries = self.request.retries

    # Parent task (in chains)
    parent_id = self.request.parent_id

    # Root task (first task in workflow)
    root_id = self.request.root_id

    # Delivery info
    delivery_info = self.request.delivery_info
    queue = delivery_info.get("routing_key")

    # Hostname of executing worker
    hostname = self.request.hostname

    # Task was called via apply_async or delay
    is_eager = self.request.is_eager

    # Custom headers
    custom_data = self.request.get("custom_header")

    return {
        "task_id": task_id,
        "retries": retries,
        "queue": queue,
        "hostname": hostname,
    }


# Send with custom headers
contextual_task.apply_async(
    args=[{"key": "value"}],
    headers={"custom_header": "custom_value"},
)
```

---

## 4. Workflow Patterns (Canvas)

### Chain with Error Handling

```python
from celery import chain
from celery.exceptions import ChainError


def order_workflow(order_id: int):
    """Chain with explicit error handling."""
    return chain(
        validate_order.s(order_id),
        reserve_inventory.s(),
        process_payment.s(),
        ship_order.s(),
        send_confirmation.s(),
    ).on_error(handle_order_error.s())


@shared_task
def handle_order_error(request, exc, traceback, order_id: int):
    """Error handler for order workflow."""
    # request contains the failed task's request
    failed_task = request.task

    # Compensating actions
    if failed_task == "tasks.process_payment":
        release_inventory.delay(order_id)
    elif failed_task == "tasks.ship_order":
        refund_payment.delay(order_id)

    # Notify customer
    notify_order_failure.delay(order_id, str(exc))


# Alternative: Link error handler
workflow = chain(
    step1.s() | step2.s() | step3.s()
)
workflow.link_error(error_handler.s())
result = workflow.apply_async()
```

### Group with Timeout

```python
from celery import group
from celery.exceptions import TimeoutError


def process_batch(items: list[int], timeout: int = 300) -> list[dict]:
    """Process items in parallel with timeout."""
    workflow = group(process_item.s(item_id) for item_id in items)
    result = workflow.apply_async()

    try:
        # Wait for all with timeout
        return result.get(timeout=timeout)
    except TimeoutError:
        # Revoke pending tasks
        result.revoke()

        # Get completed results
        completed = []
        for child in result.children:
            if child.ready():
                completed.append(child.get())

        return completed
```

### Chord with Error Callback

```python
from celery import chord


def aggregate_reports(report_ids: list[int]):
    """Chord with error handling."""
    header = [generate_report.s(rid) for rid in report_ids]
    callback = combine_reports.s()

    workflow = chord(header)(callback)

    # Or with error handling
    workflow = chord(
        header,
        combine_reports.s().on_error(report_error.s())
    )

    return workflow


@shared_task
def combine_reports(results: list[dict]) -> dict:
    """Callback receives list of header results."""
    # Filter failed results (they're exceptions)
    successful = [r for r in results if not isinstance(r, Exception)]

    return {
        "total": len(results),
        "successful": len(successful),
        "data": merge_data(successful),
    }


@shared_task
def report_error(request, exc, traceback):
    """Handle chord callback failure."""
    logger.error(f"Report aggregation failed: {exc}")
```

### Map and Starmap

```python
from celery import group


# Map: Apply same args to multiple items
def map_task(items: list[str]):
    """Map single function over items."""
    return group(fetch_url.s(url) for url in items).apply_async()


# Starmap: Apply different args to each invocation
def starmap_task(pairs: list[tuple[str, int]]):
    """Apply function with unpacked arguments."""
    return group(
        process.s(*pair) for pair in pairs
    ).apply_async()


# Using chunks for large datasets
from celery import chunks

def chunked_processing(items: list[int], chunk_size: int = 100):
    """Process in chunks to reduce broker load."""
    workflow = process_item.chunks(
        [(item,) for item in items],
        chunk_size,
    )
    return workflow.apply_async()
```

### Complex Workflow Example

```python
from celery import chain, group, chord


def etl_workflow(source_id: int, destinations: list[str]):
    """Complex ETL workflow with parallel processing."""

    return chain(
        # Step 1: Extract data
        extract_data.s(source_id),

        # Step 2: Transform in parallel chunks
        chord(
            group(transform_chunk.s(i) for i in range(10)),
            merge_chunks.s(),
        ),

        # Step 3: Load to multiple destinations in parallel
        group(
            load_to_destination.s(dest) for dest in destinations
        ),

        # Step 4: Finalize (runs after all loads complete)
        # Note: Group results are passed as list
        finalize_etl.s(source_id),
    )


# Execute
result = etl_workflow(
    source_id=123,
    destinations=["warehouse", "analytics", "backup"]
).apply_async()

# Monitor progress
for child in result.children:
    print(f"{child.id}: {child.status}")
```

---

## 5. Beat Scheduler Advanced

### Solar Schedules

```python
from celery.schedules import solar

# Location-based scheduling
app.conf.beat_schedule = {
    # At sunrise in New York
    "sunrise-task": {
        "task": "tasks.morning_routine",
        "schedule": solar("sunrise", -74.0060, 40.7128),  # NYC
    },
    # At sunset
    "sunset-task": {
        "task": "tasks.evening_routine",
        "schedule": solar("sunset", -74.0060, 40.7128),
    },
    # Civil dawn (6° below horizon)
    "dawn-task": {
        "task": "tasks.pre_sunrise",
        "schedule": solar("dawn_civil", -74.0060, 40.7128),
    },
}
```

### Custom Schedule Class

```python
from celery.schedules import schedule
from datetime import datetime, timedelta


class BusinessHoursSchedule(schedule):
    """Run only during business hours."""

    def __init__(
        self,
        run_every: timedelta,
        start_hour: int = 9,
        end_hour: int = 17,
        business_days: tuple = (0, 1, 2, 3, 4),  # Mon-Fri
    ):
        self.run_every = run_every
        self.start_hour = start_hour
        self.end_hour = end_hour
        self.business_days = business_days
        super().__init__(run_every)

    def is_due(self, last_run_at):
        now = datetime.now()

        # Check if business hours
        is_business_day = now.weekday() in self.business_days
        is_business_hour = self.start_hour <= now.hour < self.end_hour

        if not (is_business_day and is_business_hour):
            # Calculate next business time
            next_run = self._next_business_time(now)
            return schedule.is_due(False, (next_run - now).total_seconds())

        return super().is_due(last_run_at)

    def _next_business_time(self, now: datetime) -> datetime:
        """Calculate next business hours start."""
        next_day = now + timedelta(days=1)
        next_day = next_day.replace(
            hour=self.start_hour, minute=0, second=0
        )

        # Skip to Monday if weekend
        while next_day.weekday() not in self.business_days:
            next_day += timedelta(days=1)

        return next_day


# Usage
app.conf.beat_schedule = {
    "business-hours-task": {
        "task": "tasks.check_orders",
        "schedule": BusinessHoursSchedule(
            run_every=timedelta(minutes=15),
            start_hour=9,
            end_hour=18,
        ),
    },
}
```

### Database-Backed Schedules

```python
# Using django-celery-beat as reference pattern

from sqlalchemy import Column, Integer, String, JSON, Boolean
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class PeriodicTask(Base):
    """Database model for scheduled tasks."""

    __tablename__ = "periodic_tasks"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), unique=True)
    task = Column(String(200))
    args = Column(JSON, default=list)
    kwargs = Column(JSON, default=dict)
    queue = Column(String(200), nullable=True)

    # Schedule type (one of these)
    interval_seconds = Column(Integer, nullable=True)
    crontab = Column(String(200), nullable=True)  # "* * * * *"

    enabled = Column(Boolean, default=True)
    last_run_at = Column(DateTime, nullable=True)
    total_run_count = Column(Integer, default=0)


class DatabaseScheduler:
    """Custom scheduler reading from database."""

    def __init__(self, app: Celery):
        self.app = app
        self._schedule = {}
        self._last_sync = None
        self.sync_interval = 60  # Refresh every minute

    def tick(self) -> float:
        """Called by beat - check and run due tasks."""
        self._sync_schedule()

        remaining_seconds = float("inf")

        for entry_name, entry in self._schedule.items():
            is_due, next_time = entry.is_due()

            if is_due:
                self._run_entry(entry)

            remaining_seconds = min(remaining_seconds, next_time)

        return remaining_seconds

    def _sync_schedule(self):
        """Reload schedule from database."""
        if self._last_sync and (time.time() - self._last_sync) < self.sync_interval:
            return

        tasks = db.query(PeriodicTask).filter(enabled=True).all()

        self._schedule = {
            task.name: self._create_entry(task)
            for task in tasks
        }

        self._last_sync = time.time()

    def _create_entry(self, task: PeriodicTask):
        """Create schedule entry from database record."""
        if task.interval_seconds:
            schedule = timedelta(seconds=task.interval_seconds)
        elif task.crontab:
            schedule = crontab(*task.crontab.split())

        return ScheduleEntry(
            name=task.name,
            task=task.task,
            schedule=schedule,
            args=task.args,
            kwargs=task.kwargs,
            options={"queue": task.queue} if task.queue else {},
        )
```

### Beat High Availability

```python
# Using Redis for leader election

import redis
import time
from threading import Thread


class BeatLeaderElection:
    """Leader election for Beat HA deployment."""

    def __init__(
        self,
        redis_url: str,
        instance_id: str,
        lock_ttl: int = 30,
    ):
        self.redis = redis.from_url(redis_url)
        self.instance_id = instance_id
        self.lock_ttl = lock_ttl
        self.lock_key = "celery:beat:leader"
        self._is_leader = False
        self._running = False

    def start(self):
        """Start leader election loop."""
        self._running = True
        Thread(target=self._election_loop, daemon=True).start()

    def stop(self):
        """Stop and release leadership."""
        self._running = False
        if self._is_leader:
            self.redis.delete(self.lock_key)

    def _election_loop(self):
        """Continuously try to acquire/maintain leadership."""
        while self._running:
            if self._is_leader:
                # Renew lock
                self.redis.expire(self.lock_key, self.lock_ttl)
            else:
                # Try to acquire
                acquired = self.redis.set(
                    self.lock_key,
                    self.instance_id,
                    nx=True,  # Only if not exists
                    ex=self.lock_ttl,
                )
                if acquired:
                    self._is_leader = True
                    logger.info(f"Acquired Beat leadership: {self.instance_id}")

            time.sleep(self.lock_ttl / 3)

    @property
    def is_leader(self) -> bool:
        """Check if this instance is the leader."""
        return self._is_leader


# Usage in beat startup
leader = BeatLeaderElection(
    redis_url="redis://localhost:6379/0",
    instance_id=socket.gethostname(),
)
leader.start()

# Only run beat if leader
if leader.is_leader:
    beat.run()
```

---

## 6. Result Backends

### Redis Backend

```python
# Basic Redis result backend
result_backend = "redis://localhost:6379/1"

# With options
result_backend = "redis://localhost:6379/1"
result_backend_transport_options = {
    "socket_timeout": 5.0,
    "socket_connect_timeout": 5.0,
}

# Result expiration
result_expires = 3600  # 1 hour

# Extended result (include traceback, children)
result_extended = True
```

### Database Backend (SQLAlchemy)

```python
# PostgreSQL
result_backend = "db+postgresql://user:pass@localhost/celery_results"

# SQLite (development)
result_backend = "db+sqlite:///celery_results.db"

# Engine options
result_backend_transport_options = {
    "echo": False,
    "pool_size": 10,
    "pool_recycle": 3600,
}
```

### Custom Result Backend

```python
from celery.backends.base import BaseBackend


class CustomBackend(BaseBackend):
    """Custom result storage backend."""

    def __init__(self, app, url=None, **kwargs):
        super().__init__(app, **kwargs)
        self.storage = create_storage(url)

    def _store_result(
        self,
        task_id: str,
        result,
        state: str,
        traceback=None,
        request=None,
        **kwargs,
    ):
        """Store task result."""
        meta = self.encode_result(result, state)

        if traceback:
            meta["traceback"] = traceback

        self.storage.set(
            f"celery-task-meta-{task_id}",
            json.dumps(meta),
            expire=self.expires,
        )

    def _get_task_meta_for(self, task_id: str):
        """Retrieve task result."""
        data = self.storage.get(f"celery-task-meta-{task_id}")

        if data:
            return json.loads(data)

        return {"status": "PENDING", "result": None}

    def _delete_result(self, task_id: str):
        """Delete stored result."""
        self.storage.delete(f"celery-task-meta-{task_id}")


# Register backend
from celery.backends import BACKEND_ALIASES
BACKEND_ALIASES["custom"] = "myapp.backends:CustomBackend"

# Use in config
result_backend = "custom://storage-url"
```

### Ignoring Results

```python
# Global: Disable all results
result_backend = None  # Or 'disabled://'

# Per-task: Ignore specific task results
@shared_task(ignore_result=True)
def fire_and_forget(data: dict):
    """Task that doesn't need result stored."""
    process(data)


# Store result only on failure
@shared_task(ignore_result=True, store_errors_even_if_ignored=True)
def important_task(data: dict):
    """Store errors for debugging."""
    return process(data)
```

---

## 7. Worker Management

### Worker Pools

```python
# Prefork (default) - Process-based
celery -A app worker --pool=prefork --concurrency=4

# Gevent - Greenlet-based (high I/O concurrency)
celery -A app worker --pool=gevent --concurrency=100

# Eventlet - Similar to gevent
celery -A app worker --pool=eventlet --concurrency=100

# Solo - Single-threaded (debugging)
celery -A app worker --pool=solo

# Threads - Thread-based (Python GIL limited)
celery -A app worker --pool=threads --concurrency=10
```

### Worker Autoscaling

```python
# CLI autoscale
celery -A app worker --autoscale=10,3  # max=10, min=3

# Programmatic configuration
worker_autoscaler = "celery.worker.autoscale:Autoscaler"
worker_autoscale = (10, 3)  # (max, min)

# Custom autoscaler
from celery.worker.autoscale import Autoscaler


class QueueDepthAutoscaler(Autoscaler):
    """Scale based on queue depth."""

    def _maybe_scale(self, req=None):
        queue_depth = self._get_queue_depth()

        if queue_depth > 100:
            self.scale_up()
        elif queue_depth < 10:
            self.scale_down()

    def _get_queue_depth(self) -> int:
        """Check queue depth from broker."""
        with self.app.connection() as conn:
            return conn.default_channel.queue_declare(
                "celery", passive=True
            ).message_count
```

### Worker Signals

```python
from celery.signals import (
    worker_init,
    worker_ready,
    worker_shutdown,
    worker_process_init,
    task_prerun,
    task_postrun,
    task_failure,
)


@worker_init.connect
def on_worker_init(sender, **kwargs):
    """Called when worker starts."""
    logger.info(f"Worker {sender} initializing")
    # Initialize database connections, etc.


@worker_ready.connect
def on_worker_ready(sender, **kwargs):
    """Called when worker is ready to receive tasks."""
    logger.info(f"Worker {sender} ready")


@worker_shutdown.connect
def on_worker_shutdown(sender, **kwargs):
    """Called when worker shuts down."""
    logger.info(f"Worker {sender} shutting down")
    # Cleanup connections


@worker_process_init.connect
def on_process_init(sender, **kwargs):
    """Called when worker child process initializes (prefork)."""
    # Set up per-process resources
    setup_database_connection()


@task_prerun.connect
def on_task_prerun(sender, task_id, task, args, kwargs, **kw):
    """Called before task executes."""
    logger.debug(f"Task {task.name}[{task_id}] starting")


@task_postrun.connect
def on_task_postrun(sender, task_id, task, args, kwargs, retval, **kw):
    """Called after task executes."""
    logger.debug(f"Task {task.name}[{task_id}] completed")


@task_failure.connect
def on_task_failure(sender, task_id, exception, args, kwargs, traceback, **kw):
    """Called when task fails."""
    logger.error(f"Task {sender.name}[{task_id}] failed: {exception}")
    # Send to error tracking
    sentry_sdk.capture_exception(exception)
```

### Graceful Shutdown

```python
# Worker warm shutdown settings
worker_cancel_long_running_tasks_on_connection_loss = True

# Custom shutdown handling
from celery.signals import worker_shutting_down


@worker_shutting_down.connect
def on_shutdown(sender, sig, how, exitcode, **kwargs):
    """Handle graceful shutdown."""
    logger.info(f"Shutdown signal received: {sig}")

    # Complete current tasks
    # (Celery handles this automatically with SIGTERM)

    # Save state if needed
    save_checkpoint()


# systemd service for graceful restarts
# /etc/systemd/system/celery-worker.service
"""
[Unit]
Description=Celery Worker
After=network.target

[Service]
Type=forking
User=celery
Group=celery
WorkingDirectory=/app
ExecStart=/app/venv/bin/celery -A myapp worker --pidfile=/run/celery/worker.pid
ExecStop=/bin/kill -s TERM $MAINPID
ExecReload=/bin/kill -s HUP $MAINPID
Restart=always
TimeoutStopSec=300

[Install]
WantedBy=multi-user.target
"""
```

---

## 8. Error Handling & Reliability

### Retry Strategies

```python
from celery import shared_task
from celery.exceptions import Retry


# Exponential backoff with jitter
@shared_task(
    bind=True,
    max_retries=5,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def robust_task(self, data: dict):
    """Task with exponential backoff retry."""
    try:
        return external_api.call(data)
    except TransientError as exc:
        raise self.retry(exc=exc)


# Custom retry delays
@shared_task(bind=True, max_retries=5)
def custom_backoff_task(self, data: dict):
    """Task with custom retry schedule."""
    retry_delays = [10, 30, 60, 300, 900]  # seconds

    try:
        return external_api.call(data)
    except TransientError as exc:
        countdown = retry_delays[min(self.request.retries, len(retry_delays) - 1)]
        raise self.retry(exc=exc, countdown=countdown)


# Conditional retry
@shared_task(bind=True, max_retries=3)
def conditional_retry_task(self, order_id: int):
    """Retry only for specific errors."""
    try:
        return process_order(order_id)
    except OrderNotFoundError:
        # Don't retry - permanent failure
        raise
    except PaymentDeclinedError:
        # Don't retry - business logic failure
        return {"status": "declined"}
    except GatewayTimeoutError as exc:
        # Retry - transient failure
        raise self.retry(exc=exc, countdown=60)
```

### Dead Letter Queue

```python
from kombu import Queue


# Configure DLQ
task_queues = (
    Queue("default"),
    Queue("dead_letter", routing_key="dead_letter"),
)

task_routes = {
    "dead_letter_handler": {"queue": "dead_letter"},
}


@shared_task(bind=True, max_retries=3)
def task_with_dlq(self, data: dict):
    """Task that moves to DLQ on final failure."""
    try:
        return process(data)
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            # Move to dead letter queue
            move_to_dlq.delay(
                original_task=self.name,
                args=self.request.args,
                kwargs=self.request.kwargs,
                exception=str(exc),
                retries=self.request.retries,
            )
            raise
        raise self.retry(exc=exc)


@shared_task(queue="dead_letter")
def move_to_dlq(original_task: str, args, kwargs, exception: str, retries: int):
    """Store failed task for manual review."""
    DeadLetterRecord.create(
        task_name=original_task,
        args=args,
        kwargs=kwargs,
        exception=exception,
        retries=retries,
        created_at=datetime.utcnow(),
    )


# Reprocess from DLQ
@shared_task
def reprocess_dlq(record_id: int):
    """Retry a task from dead letter queue."""
    record = DeadLetterRecord.get(record_id)

    task = celery_app.tasks[record.task_name]
    result = task.apply_async(args=record.args, kwargs=record.kwargs)

    record.reprocessed_at = datetime.utcnow()
    record.reprocess_task_id = result.id
    record.save()

    return {"task_id": result.id}
```

### Circuit Breaker Pattern

```python
import time
from dataclasses import dataclass
from threading import Lock


@dataclass
class CircuitBreakerState:
    failures: int = 0
    last_failure_time: float = 0
    state: str = "closed"  # closed, open, half-open


class CircuitBreaker:
    """Circuit breaker for external service calls."""

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._states: dict[str, CircuitBreakerState] = {}
        self._lock = Lock()

    def get_state(self, service: str) -> CircuitBreakerState:
        """Get or create state for service."""
        with self._lock:
            if service not in self._states:
                self._states[service] = CircuitBreakerState()
            return self._states[service]

    def is_available(self, service: str) -> bool:
        """Check if service is available."""
        state = self.get_state(service)

        if state.state == "closed":
            return True

        if state.state == "open":
            # Check if recovery timeout passed
            if time.time() - state.last_failure_time > self.recovery_timeout:
                state.state = "half-open"
                return True
            return False

        # half-open: allow one request
        return True

    def record_success(self, service: str):
        """Record successful call."""
        state = self.get_state(service)
        state.failures = 0
        state.state = "closed"

    def record_failure(self, service: str):
        """Record failed call."""
        state = self.get_state(service)
        state.failures += 1
        state.last_failure_time = time.time()

        if state.failures >= self.failure_threshold:
            state.state = "open"


# Global circuit breaker
circuit_breaker = CircuitBreaker()


@shared_task(bind=True, max_retries=3)
def call_external_service(self, service: str, data: dict):
    """Task with circuit breaker."""
    if not circuit_breaker.is_available(service):
        raise self.retry(
            exc=CircuitOpenError(f"Circuit open for {service}"),
            countdown=circuit_breaker.recovery_timeout,
        )

    try:
        result = external_services[service].call(data)
        circuit_breaker.record_success(service)
        return result
    except Exception as exc:
        circuit_breaker.record_failure(service)
        raise self.retry(exc=exc)
```

---

## 9. Performance Optimization

### Prefetching and Batching

```python
# Worker prefetch settings
worker_prefetch_multiplier = 1  # Fetch 1 task per worker process
# Higher values = better throughput, worse latency fairness

# For long-running tasks
worker_prefetch_multiplier = 1

# For short, fast tasks
worker_prefetch_multiplier = 4


# Batch processing
@shared_task
def process_batch(item_ids: list[int]) -> dict:
    """Process multiple items in single task."""
    results = []

    for item_id in item_ids:
        results.append(process_item(item_id))

    return {"processed": len(results)}


def queue_in_batches(all_items: list[int], batch_size: int = 100):
    """Queue items in batches to reduce broker overhead."""
    for i in range(0, len(all_items), batch_size):
        batch = all_items[i:i + batch_size]
        process_batch.delay(batch)
```

### Connection Pooling

```python
# Broker connection pool
broker_pool_limit = 10  # Connections per process

# Connection retry
broker_connection_retry = True
broker_connection_retry_on_startup = True
broker_connection_max_retries = 10

# Result backend connection pool
result_backend_transport_options = {
    "max_connections": 20,
}


# Reuse connections in tasks
from contextlib import contextmanager
import httpx


# Global client (reused across tasks in same process)
_http_client: httpx.Client | None = None


def get_http_client() -> httpx.Client:
    global _http_client
    if _http_client is None:
        _http_client = httpx.Client(
            timeout=30.0,
            limits=httpx.Limits(max_connections=100),
        )
    return _http_client


@shared_task
def make_api_call(endpoint: str) -> dict:
    """Task reusing connection pool."""
    client = get_http_client()
    response = client.get(endpoint)
    return response.json()


# Cleanup on worker shutdown
from celery.signals import worker_shutdown


@worker_shutdown.connect
def close_http_client(sender, **kwargs):
    global _http_client
    if _http_client:
        _http_client.close()
        _http_client = None
```

### Memory Management

```python
# Restart worker after N tasks (prevents memory leaks)
worker_max_tasks_per_child = 1000

# Memory limit (soft)
worker_max_memory_per_child = 200000  # 200MB


# Memory-efficient task design
@shared_task
def process_large_dataset(dataset_id: int):
    """Memory-efficient large data processing."""
    # Stream data instead of loading all at once
    for chunk in stream_dataset(dataset_id, chunk_size=1000):
        process_chunk(chunk)

        # Explicitly free memory
        del chunk
        gc.collect()


# Avoid storing large results
@shared_task(ignore_result=True)
def process_and_store(data_id: int):
    """Don't return large data - store externally."""
    result = process(data_id)

    # Store in external storage
    storage.put(f"results/{data_id}", result)

    # Just return reference
    # (But we ignore_result so nothing stored)
```

### Task Compression

```python
# Enable compression for large payloads
task_compression = "gzip"  # or "bzip2", "lzma"

# Per-task compression
@shared_task(compression="gzip")
def process_large_payload(data: dict):
    return heavy_processing(data)


# Result compression
result_compression = "gzip"


# Custom serializer with compression
import gzip
import json
from kombu.serialization import register


def gzip_json_encode(obj):
    """Compress JSON payload."""
    json_bytes = json.dumps(obj).encode("utf-8")
    return gzip.compress(json_bytes)


def gzip_json_decode(data):
    """Decompress JSON payload."""
    json_bytes = gzip.decompress(data)
    return json.loads(json_bytes.decode("utf-8"))


register(
    "gzip-json",
    gzip_json_encode,
    gzip_json_decode,
    content_type="application/x-gzip-json",
    content_encoding="binary",
)

# Use custom serializer
task_serializer = "gzip-json"
accept_content = ["gzip-json", "json"]
```

---

## 10. Production Deployment

### Docker Compose Setup

```yaml
# docker-compose.yml
version: "3.8"

services:
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: .
    command: uvicorn myapp.main:app --host 0.0.0.0 --port 8000
    ports:
      - "8000:8000"
    environment:
      - CELERY_BROKER_URL=redis://redis:6379/0
      - CELERY_RESULT_BACKEND=redis://redis:6379/1
    depends_on:
      redis:
        condition: service_healthy

  celery-worker:
    build: .
    command: celery -A myapp.celery_app worker --loglevel=info --concurrency=4
    environment:
      - CELERY_BROKER_URL=redis://redis:6379/0
      - CELERY_RESULT_BACKEND=redis://redis:6379/1
    depends_on:
      redis:
        condition: service_healthy
    deploy:
      replicas: 2
      resources:
        limits:
          memory: 512M

  celery-beat:
    build: .
    command: celery -A myapp.celery_app beat --loglevel=info
    environment:
      - CELERY_BROKER_URL=redis://redis:6379/0
      - CELERY_RESULT_BACKEND=redis://redis:6379/1
    depends_on:
      redis:
        condition: service_healthy
    deploy:
      replicas: 1  # Only one beat!

  flower:
    build: .
    command: celery -A myapp.celery_app flower --port=5555
    ports:
      - "5555:5555"
    environment:
      - CELERY_BROKER_URL=redis://redis:6379/0
    depends_on:
      - celery-worker

volumes:
  redis_data:
```

### Kubernetes Deployment

```yaml
# celery-worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: celery-worker
spec:
  replicas: 3
  selector:
    matchLabels:
      app: celery-worker
  template:
    metadata:
      labels:
        app: celery-worker
    spec:
      containers:
        - name: worker
          image: myapp:latest
          command:
            - celery
            - -A
            - myapp.celery_app
            - worker
            - --loglevel=info
            - --concurrency=4
          env:
            - name: CELERY_BROKER_URL
              valueFrom:
                secretKeyRef:
                  name: celery-secrets
                  key: broker-url
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            exec:
              command:
                - celery
                - -A
                - myapp.celery_app
                - inspect
                - ping
            initialDelaySeconds: 30
            periodSeconds: 60
          readinessProbe:
            exec:
              command:
                - celery
                - -A
                - myapp.celery_app
                - inspect
                - ping
            initialDelaySeconds: 10
            periodSeconds: 30

---
# celery-beat-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: celery-beat
spec:
  replicas: 1  # Must be exactly 1
  strategy:
    type: Recreate  # No rolling update for beat
  selector:
    matchLabels:
      app: celery-beat
  template:
    metadata:
      labels:
        app: celery-beat
    spec:
      containers:
        - name: beat
          image: myapp:latest
          command:
            - celery
            - -A
            - myapp.celery_app
            - beat
            - --loglevel=info
          env:
            - name: CELERY_BROKER_URL
              valueFrom:
                secretKeyRef:
                  name: celery-secrets
                  key: broker-url
```

### Systemd Services

```ini
# /etc/systemd/system/celery-worker@.service
[Unit]
Description=Celery Worker %i
After=network.target redis.service

[Service]
Type=forking
User=celery
Group=celery
WorkingDirectory=/app
Environment="CELERY_BROKER_URL=redis://localhost:6379/0"
ExecStart=/app/venv/bin/celery multi start worker%i \
    -A myapp.celery_app \
    --pidfile=/run/celery/worker%i.pid \
    --logfile=/var/log/celery/worker%i.log \
    --loglevel=INFO \
    -c 4
ExecStop=/app/venv/bin/celery multi stopwait worker%i \
    --pidfile=/run/celery/worker%i.pid
ExecReload=/app/venv/bin/celery multi restart worker%i \
    -A myapp.celery_app \
    --pidfile=/run/celery/worker%i.pid \
    --logfile=/var/log/celery/worker%i.log \
    --loglevel=INFO \
    -c 4
Restart=always
RuntimeDirectory=celery

[Install]
WantedBy=multi-user.target

# /etc/systemd/system/celery-beat.service
[Unit]
Description=Celery Beat Scheduler
After=network.target redis.service

[Service]
Type=simple
User=celery
Group=celery
WorkingDirectory=/app
Environment="CELERY_BROKER_URL=redis://localhost:6379/0"
ExecStart=/app/venv/bin/celery -A myapp.celery_app beat \
    --pidfile=/run/celery/beat.pid \
    --loglevel=INFO
Restart=always
RuntimeDirectory=celery

[Install]
WantedBy=multi-user.target
```

### Monitoring and Alerting

```python
# Prometheus metrics
from prometheus_client import Counter, Histogram, Gauge
from celery.signals import task_prerun, task_postrun, task_failure


TASK_COUNTER = Counter(
    "celery_tasks_total",
    "Total Celery tasks",
    ["task", "state"],
)

TASK_DURATION = Histogram(
    "celery_task_duration_seconds",
    "Task execution time",
    ["task"],
)

QUEUE_DEPTH = Gauge(
    "celery_queue_depth",
    "Number of tasks in queue",
    ["queue"],
)


@task_prerun.connect
def on_task_prerun(sender, task_id, task, args, kwargs, **kw):
    TASK_COUNTER.labels(task=task.name, state="started").inc()


@task_postrun.connect
def on_task_postrun(sender, task_id, task, args, kwargs, retval, state, **kw):
    TASK_COUNTER.labels(task=task.name, state="completed").inc()


@task_failure.connect
def on_task_failure(sender, task_id, exception, args, kwargs, traceback, **kw):
    TASK_COUNTER.labels(task=sender.name, state="failed").inc()


# Expose metrics endpoint
from prometheus_client import start_http_server

def start_metrics_server(port: int = 9090):
    start_http_server(port)
```

---

## Summary

This reference covers advanced Celery patterns for production deployments:

- **Architecture**: Multi-component design with proper scaling strategies
- **Brokers**: Redis and RabbitMQ configuration with connection pooling
- **Tasks**: Idempotent design, retry strategies, and workflow patterns
- **Beat**: Cron, solar, and database-backed schedules
- **Reliability**: Circuit breakers, dead letter queues, graceful shutdown
- **Performance**: Prefetching, batching, compression, and memory management
- **Deployment**: Docker, Kubernetes, and systemd configurations

For quick patterns, see [SKILL.md](./SKILL.md). For library-specific details, use Context7 MCP with `/celery/celery`.

---

**Version**: 1.0.0 | **Last Updated**: 2025-01-01 | **Status**: Production Ready
