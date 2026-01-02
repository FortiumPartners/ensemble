"""
Celery Application Configuration Template

Template Variables:
    app_name: str - Celery application name
    broker_url: str - Message broker URL
    result_backend: str - Result backend URL
    task_modules: list[str] - Task module paths for autodiscovery
    queues: list[dict] - Queue definitions with name and routing_key
    task_routes: dict - Task to queue routing
    timezone: str - Timezone (default: "UTC")
    task_time_limit: int - Default task time limit in seconds
    task_soft_time_limit: int - Default soft time limit
    worker_concurrency: int - Default worker concurrency
    worker_prefetch_multiplier: int - Prefetch multiplier
    result_expires: int - Result expiration in seconds

Usage:
    render_template("celery_config.template.py", {
        "app_name": "myapp",
        "broker_url": "redis://localhost:6379/0",
        "result_backend": "redis://localhost:6379/1",
        "task_modules": ["myapp.tasks.email", "myapp.tasks.reports"],
    })
"""
from __future__ import annotations

from celery import Celery
from kombu import Queue

# =============================================================================
# Configuration from Environment
# =============================================================================

from pydantic import Field
from pydantic_settings import BaseSettings


class CelerySettings(BaseSettings):
    """Celery configuration from environment variables."""

    # Broker
    celery_broker_url: str = Field(
        default="{{ broker_url | default('redis://localhost:6379/0') }}",
        alias="CELERY_BROKER_URL",
    )

    # Result Backend
    celery_result_backend: str = Field(
        default="{{ result_backend | default('redis://localhost:6379/1') }}",
        alias="CELERY_RESULT_BACKEND",
    )

    # Worker
    celery_worker_concurrency: int = Field(
        default={{ worker_concurrency | default(4) }},
        alias="CELERY_WORKER_CONCURRENCY",
    )

    # Task limits
    celery_task_time_limit: int = Field(
        default={{ task_time_limit | default(300) }},
        alias="CELERY_TASK_TIME_LIMIT",
    )

    celery_task_soft_time_limit: int = Field(
        default={{ task_soft_time_limit | default(240) }},
        alias="CELERY_TASK_SOFT_TIME_LIMIT",
    )

    # Testing
    celery_task_always_eager: bool = Field(
        default=False,
        alias="CELERY_TASK_ALWAYS_EAGER",
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = CelerySettings()

# =============================================================================
# Celery Application
# =============================================================================

app = Celery(
    "{{ app_name | default('myapp') }}",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    {% if task_modules %}
    include=[
        {% for module in task_modules %}
        "{{ module }}",
        {% endfor %}
    ],
    {% endif %}
)

# =============================================================================
# Task Configuration
# =============================================================================

app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # Time and timezone
    timezone="{{ timezone | default('UTC') }}",
    enable_utc=True,

    # Task execution
    task_track_started=True,
    task_time_limit=settings.celery_task_time_limit,
    task_soft_time_limit=settings.celery_task_soft_time_limit,

    # Task acknowledgment
    task_acks_late=True,  # Ack after task completes (reliability)
    task_reject_on_worker_lost=True,

    # Worker settings
    worker_prefetch_multiplier={{ worker_prefetch_multiplier | default(1) }},
    worker_concurrency=settings.celery_worker_concurrency,
    worker_max_tasks_per_child=1000,  # Restart after N tasks (memory)

    # Result backend
    result_expires={{ result_expires | default(3600) }},  # 1 hour
    result_extended=True,  # Include traceback in results

    # Testing
    task_always_eager=settings.celery_task_always_eager,
    task_eager_propagates=True,
)

# =============================================================================
# Queue Configuration
# =============================================================================

app.conf.task_queues = (
    {% for queue in queues | default([{"name": "default", "routing_key": "default"}]) %}
    Queue("{{ queue.name }}", routing_key="{{ queue.routing_key }}"),
    {% endfor %}
)

app.conf.task_default_queue = "default"
app.conf.task_default_routing_key = "default"

# =============================================================================
# Task Routing
# =============================================================================

{% if task_routes %}
app.conf.task_routes = {
    {% for task, config in task_routes.items() %}
    "{{ task }}": {{ config }},
    {% endfor %}
}
{% else %}
# app.conf.task_routes = {
#     "tasks.email.*": {"queue": "email"},
#     "tasks.reports.*": {"queue": "reports"},
#     "tasks.high_priority_*": {"queue": "high_priority"},
# }
{% endif %}

# =============================================================================
# Beat Schedule (Optional)
# =============================================================================

# Import beat schedule if defined
# from .beat_schedule import beat_schedule
# app.conf.beat_schedule = beat_schedule

# =============================================================================
# Broker Transport Options
# =============================================================================

app.conf.broker_transport_options = {
    "visibility_timeout": 43200,  # 12 hours (must exceed longest task)
    "socket_timeout": 5.0,
    "socket_connect_timeout": 5.0,
    "retry_on_timeout": True,
}

# =============================================================================
# Signals (Optional)
# =============================================================================

from celery.signals import task_prerun, task_postrun, task_failure
import logging

logger = logging.getLogger(__name__)


@task_prerun.connect
def on_task_prerun(sender, task_id, task, args, kwargs, **kw):
    """Log task start."""
    logger.debug(f"Task {task.name}[{task_id}] starting")


@task_postrun.connect
def on_task_postrun(sender, task_id, task, args, kwargs, retval, **kw):
    """Log task completion."""
    logger.debug(f"Task {task.name}[{task_id}] completed")


@task_failure.connect
def on_task_failure(sender, task_id, exception, args, kwargs, traceback, **kw):
    """Log task failure."""
    logger.error(f"Task {sender.name}[{task_id}] failed: {exception}")


# =============================================================================
# Autodiscover Tasks
# =============================================================================

# Alternatively, use autodiscover for automatic task loading:
# app.autodiscover_tasks(["myapp.tasks"])


# =============================================================================
# Export
# =============================================================================

# For convenience, export the app as celery_app
celery_app = app
