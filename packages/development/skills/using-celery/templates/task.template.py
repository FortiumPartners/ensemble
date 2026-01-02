"""
Celery Task Template

Template Variables:
    task_name: str - Function name (snake_case)
    task_full_name: str - Full task name for registration
    max_retries: int - Maximum retry attempts (default: 3)
    default_retry_delay: int - Seconds between retries (default: 60)
    retry_backoff: bool - Use exponential backoff (default: True)
    retry_backoff_max: int - Max backoff seconds (default: 600)
    time_limit: int - Hard time limit in seconds (default: 300)
    soft_time_limit: int - Soft time limit in seconds (default: 240)
    rate_limit: str | None - Rate limit (e.g., "10/m")
    queue: str - Target queue (default: "default")
    ignore_result: bool - Don't store result (default: False)
    parameters: list[dict] - Task parameters with name, type, default
    return_type: str - Return type hint (default: "dict")
    autoretry_exceptions: list[str] - Exceptions to auto-retry

Usage:
    render_template("task.template.py", {
        "task_name": "send_notification",
        "parameters": [
            {"name": "user_id", "type": "int"},
            {"name": "message", "type": "str"},
        ],
    })
"""
from __future__ import annotations

import logging
from typing import Any

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded

logger = logging.getLogger(__name__)


# =============================================================================
# Template: Basic Task with Retry
# =============================================================================

@shared_task(
    bind=True,
    name="{{ task_full_name | default('tasks.' + task_name) }}",
    max_retries={{ max_retries | default(3) }},
    default_retry_delay={{ default_retry_delay | default(60) }},
    {% if retry_backoff | default(True) %}
    autoretry_for=(Exception,),  # Customize exceptions
    retry_backoff=True,
    retry_backoff_max={{ retry_backoff_max | default(600) }},
    retry_jitter=True,
    {% endif %}
    {% if time_limit %}
    time_limit={{ time_limit }},
    {% endif %}
    {% if soft_time_limit %}
    soft_time_limit={{ soft_time_limit }},
    {% endif %}
    {% if rate_limit %}
    rate_limit="{{ rate_limit }}",
    {% endif %}
    {% if ignore_result | default(False) %}
    ignore_result=True,
    {% endif %}
    {% if queue and queue != "default" %}
    queue="{{ queue }}",
    {% endif %}
)
def {{ task_name }}(
    self,
    {% for param in parameters %}
    {{ param.name }}: {{ param.type }}{% if param.default %} = {{ param.default }}{% endif %},
    {% endfor %}
) -> {{ return_type | default("dict") }}:
    """
    {{ task_description | default(task_name + " task.") }}

    Args:
    {% for param in parameters %}
        {{ param.name }}: {{ param.description | default("Parameter " + param.name) }}
    {% endfor %}

    Returns:
        {{ return_description | default("Task result dictionary") }}

    Raises:
        MaxRetriesExceededError: When all retries exhausted
        SoftTimeLimitExceeded: When soft time limit reached
    """
    task_id = self.request.id
    retry_count = self.request.retries

    logger.info(
        f"Task {self.name}[{task_id}] started (attempt {retry_count + 1})"
    )

    try:
        # =====================================================================
        # TODO: Implement task logic here
        # =====================================================================

        result = {
            "task_id": task_id,
            "status": "completed",
            # Add your result fields here
        }

        logger.info(f"Task {self.name}[{task_id}] completed successfully")
        return result

    except SoftTimeLimitExceeded:
        logger.warning(f"Task {self.name}[{task_id}] soft time limit exceeded")
        # Perform graceful cleanup
        raise

    except MaxRetriesExceededError:
        logger.error(f"Task {self.name}[{task_id}] max retries exceeded")
        # Handle permanent failure
        raise

    except Exception as exc:
        logger.exception(f"Task {self.name}[{task_id}] failed: {exc}")
        # Let autoretry handle it, or manually retry:
        # raise self.retry(exc=exc, countdown=60)
        raise


# =============================================================================
# Template: Idempotent Task
# =============================================================================

@shared_task(
    bind=True,
    name="{{ task_full_name | default('tasks.' + task_name) }}_idempotent",
    max_retries={{ max_retries | default(3) }},
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def {{ task_name }}_idempotent(
    self,
    idempotency_key: str,
    {% for param in parameters %}
    {{ param.name }}: {{ param.type }}{% if param.default %} = {{ param.default }}{% endif %},
    {% endfor %}
) -> {{ return_type | default("dict") }}:
    """
    Idempotent version of {{ task_name }}.

    Uses idempotency_key to prevent duplicate execution.
    Safe to retry without side effects.

    Args:
        idempotency_key: Unique key to prevent duplicate execution
    {% for param in parameters %}
        {{ param.name }}: {{ param.description | default("Parameter " + param.name) }}
    {% endfor %}

    Returns:
        Task result with status and idempotency info
    """
    task_id = self.request.id

    # Check if already processed
    # TODO: Replace with your storage mechanism
    existing_result = check_idempotency(idempotency_key)
    if existing_result:
        logger.info(
            f"Task {self.name}[{task_id}] already processed "
            f"(idempotency_key={idempotency_key})"
        )
        return {
            "status": "already_processed",
            "original_result": existing_result,
            "idempotency_key": idempotency_key,
        }

    try:
        # =====================================================================
        # TODO: Implement idempotent task logic here
        # =====================================================================

        result = {
            "task_id": task_id,
            "status": "completed",
            "idempotency_key": idempotency_key,
        }

        # Store result with idempotency key
        # TODO: Replace with your storage mechanism
        store_idempotency(idempotency_key, result)

        return result

    except Exception as exc:
        logger.exception(f"Task {self.name}[{task_id}] failed: {exc}")
        raise


def check_idempotency(key: str) -> dict | None:
    """Check if task was already processed."""
    # TODO: Implement using Redis, database, etc.
    # Example with Redis:
    # return redis_client.get(f"idempotency:{key}")
    return None


def store_idempotency(key: str, result: dict) -> None:
    """Store idempotency result."""
    # TODO: Implement using Redis, database, etc.
    # Example with Redis:
    # redis_client.setex(f"idempotency:{key}", 86400, json.dumps(result))
    pass
