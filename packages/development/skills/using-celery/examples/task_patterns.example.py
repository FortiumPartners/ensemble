"""
Celery Task Patterns Example

Production-ready patterns for distributed task processing:
- Idempotent tasks
- Retry strategies
- Workflow patterns (chains, groups, chords)
- Error handling and dead letter queues
- Rate limiting and circuit breakers

Run with:
    celery -A examples.task_patterns worker --loglevel=info
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from celery import Celery, chain, chord, group, shared_task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from celery.schedules import crontab

# =============================================================================
# Celery Application Setup
# =============================================================================

app = Celery(
    "task_patterns",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,
    task_soft_time_limit=240,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Pattern 1: Idempotent Tasks
# =============================================================================


@dataclass
class IdempotencyStore:
    """Simple in-memory idempotency store (use Redis in production)."""

    _store: dict = None

    def __post_init__(self):
        if self._store is None:
            self._store = {}

    def get(self, key: str) -> dict | None:
        return self._store.get(key)

    def set(self, key: str, value: dict, ttl_seconds: int = 86400) -> None:
        self._store[key] = {
            "value": value,
            "expires_at": datetime.utcnow() + timedelta(seconds=ttl_seconds),
        }

    def generate_key(self, operation: str, *args) -> str:
        data = f"{operation}:{':'.join(str(a) for a in args)}"
        return hashlib.sha256(data.encode()).hexdigest()[:32]


# Global store (use Redis in production)
idempotency_store = IdempotencyStore()


@shared_task(bind=True, max_retries=3)
def process_payment(
    self,
    order_id: int,
    amount: float,
    idempotency_key: str | None = None,
) -> dict:
    """
    Idempotent payment processing.

    Safe to retry - uses idempotency key to prevent duplicate charges.
    """
    task_id = self.request.id

    # Generate idempotency key if not provided
    if not idempotency_key:
        idempotency_key = idempotency_store.generate_key(
            "payment", order_id, amount
        )

    # Check if already processed
    existing = idempotency_store.get(idempotency_key)
    if existing:
        logger.info(f"Payment already processed: {idempotency_key}")
        return {
            "status": "already_processed",
            "idempotency_key": idempotency_key,
            "original_result": existing["value"],
        }

    try:
        # Simulate payment processing
        time.sleep(0.5)

        # Simulate occasional failures for retry demonstration
        if order_id % 10 == 0 and self.request.retries == 0:
            raise ConnectionError("Payment gateway timeout")

        result = {
            "order_id": order_id,
            "amount": amount,
            "status": "charged",
            "transaction_id": f"txn_{task_id[:8]}",
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Store with idempotency key
        idempotency_store.set(idempotency_key, result)

        logger.info(f"Payment processed: {result}")
        return result

    except ConnectionError as exc:
        logger.warning(f"Payment failed, retrying: {exc}")
        raise self.retry(exc=exc, countdown=30)


# =============================================================================
# Pattern 2: Retry Strategies
# =============================================================================


@shared_task(
    bind=True,
    max_retries=5,
    autoretry_for=(ConnectionError, TimeoutError),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def fetch_external_data(self, endpoint: str) -> dict:
    """
    Task with automatic exponential backoff retry.

    Retries: 1s, 2s, 4s, 8s, 16s (with jitter, capped at 600s)
    """
    task_id = self.request.id
    retry_count = self.request.retries

    logger.info(f"Fetching {endpoint} (attempt {retry_count + 1})")

    # Simulate external API call
    time.sleep(0.2)

    # Simulate intermittent failures
    if "unstable" in endpoint and retry_count < 2:
        raise ConnectionError("Service temporarily unavailable")

    return {
        "endpoint": endpoint,
        "data": {"fetched": True},
        "attempts": retry_count + 1,
    }


@shared_task(bind=True, max_retries=3)
def conditional_retry_task(self, data: dict) -> dict:
    """
    Task with conditional retry logic.

    Some errors should not be retried (e.g., validation errors).
    """
    try:
        # Validate input
        if "required_field" not in data:
            raise ValueError("Missing required_field - not retryable")

        # Process
        time.sleep(0.1)

        # Simulate transient error
        if data.get("simulate_failure") and self.request.retries < 2:
            raise ConnectionError("Transient error")

        return {"status": "processed", "data": data}

    except ValueError as exc:
        # Don't retry validation errors
        logger.error(f"Validation error (no retry): {exc}")
        raise

    except ConnectionError as exc:
        # Retry connection errors with custom countdown
        countdown = 30 * (2 ** self.request.retries)  # 30s, 60s, 120s
        logger.warning(f"Retrying in {countdown}s: {exc}")
        raise self.retry(exc=exc, countdown=countdown)


# =============================================================================
# Pattern 3: Workflow Patterns
# =============================================================================


@shared_task
def extract_data(source_id: int) -> dict:
    """Extract step of ETL workflow."""
    time.sleep(0.2)
    return {
        "source_id": source_id,
        "records": [
            {"id": i, "value": f"record_{i}"}
            for i in range(10)
        ],
    }


@shared_task
def transform_chunk(chunk: list[dict], transformation: str = "uppercase") -> list[dict]:
    """Transform step - processes data chunk."""
    time.sleep(0.1)
    if transformation == "uppercase":
        return [
            {**record, "value": record["value"].upper()}
            for record in chunk
        ]
    return chunk


@shared_task
def load_data(data: list[dict], destination: str) -> dict:
    """Load step - stores processed data."""
    time.sleep(0.2)
    return {
        "destination": destination,
        "records_loaded": len(data),
        "status": "success",
    }


@shared_task
def aggregate_results(results: list[dict]) -> dict:
    """Aggregate parallel processing results."""
    total_records = sum(r.get("records_loaded", 0) for r in results)
    return {
        "total_records": total_records,
        "destinations": [r.get("destination") for r in results],
        "status": "aggregated",
    }


def create_etl_workflow(source_id: int, destinations: list[str]):
    """
    Create ETL workflow using Celery canvas.

    Flow:
    1. Extract data from source
    2. Transform data (could be parallelized for large datasets)
    3. Load to multiple destinations in parallel
    4. Aggregate results
    """
    return chain(
        # Step 1: Extract
        extract_data.s(source_id),

        # Step 2: Transform (uses result from extract)
        transform_chunk.s(),

        # Step 3: Load to multiple destinations in parallel
        # Then aggregate results
        chord(
            group(load_data.s(dest) for dest in destinations),
            aggregate_results.s(),
        ),
    )


@shared_task
def validate_order(order_id: int) -> dict:
    """Validate order in order workflow."""
    time.sleep(0.1)
    return {"order_id": order_id, "valid": True}


@shared_task
def reserve_inventory(order_data: dict) -> dict:
    """Reserve inventory for order."""
    time.sleep(0.2)
    return {**order_data, "inventory_reserved": True}


@shared_task
def charge_payment(order_data: dict) -> dict:
    """Charge payment for order."""
    time.sleep(0.3)
    return {**order_data, "payment_charged": True}


@shared_task
def ship_order(order_data: dict) -> dict:
    """Ship order."""
    time.sleep(0.2)
    return {**order_data, "shipped": True}


@shared_task
def send_confirmation(order_data: dict) -> dict:
    """Send order confirmation."""
    time.sleep(0.1)
    return {**order_data, "confirmation_sent": True, "status": "completed"}


def create_order_workflow(order_id: int):
    """
    Create order processing workflow.

    Sequential chain with each step depending on previous.
    """
    return chain(
        validate_order.s(order_id),
        reserve_inventory.s(),
        charge_payment.s(),
        ship_order.s(),
        send_confirmation.s(),
    )


# =============================================================================
# Pattern 4: Error Handling & Dead Letter Queue
# =============================================================================


@shared_task(ignore_result=True)
def move_to_dlq(
    task_name: str,
    task_args: tuple,
    task_kwargs: dict,
    exception: str,
    traceback: str,
) -> None:
    """
    Dead letter queue handler.

    Stores failed tasks for manual review and potential replay.
    """
    record = {
        "task_name": task_name,
        "args": task_args,
        "kwargs": task_kwargs,
        "exception": exception,
        "traceback": traceback,
        "failed_at": datetime.utcnow().isoformat(),
    }

    # In production: store in database or dedicated queue
    logger.error(f"Task moved to DLQ: {json.dumps(record)}")


@shared_task(bind=True, max_retries=3)
def task_with_dlq(self, data: dict) -> dict:
    """
    Task that moves to DLQ on final failure.
    """
    try:
        # Simulate processing
        if data.get("force_failure"):
            raise ValueError("Forced failure for testing")

        return {"status": "processed", "data": data}

    except Exception as exc:
        if self.request.retries >= self.max_retries:
            # All retries exhausted - move to DLQ
            import traceback as tb

            move_to_dlq.delay(
                task_name=self.name,
                task_args=self.request.args,
                task_kwargs=self.request.kwargs,
                exception=str(exc),
                traceback=tb.format_exc(),
            )
            raise

        # Retry
        raise self.retry(exc=exc, countdown=30)


# =============================================================================
# Pattern 5: Rate Limiting
# =============================================================================


@shared_task(
    bind=True,
    rate_limit="5/s",  # 5 per second
)
def rate_limited_api_call(self, endpoint: str) -> dict:
    """
    Rate-limited task for external API calls.

    Celery enforces rate limit across all workers.
    """
    time.sleep(0.1)  # Simulate API call
    return {"endpoint": endpoint, "status": "success"}


@shared_task(
    bind=True,
    rate_limit="100/m",  # 100 per minute
)
def bulk_email_send(self, recipient: str, template: str) -> dict:
    """
    Rate-limited email sending.

    Respects email provider rate limits.
    """
    time.sleep(0.05)  # Simulate email send
    return {
        "recipient": recipient,
        "template": template,
        "status": "sent",
    }


# =============================================================================
# Pattern 6: Circuit Breaker
# =============================================================================


class CircuitBreaker:
    """
    Simple circuit breaker implementation.

    States: CLOSED (normal) -> OPEN (blocking) -> HALF_OPEN (testing)
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._failures: dict[str, int] = {}
        self._last_failure_time: dict[str, float] = {}
        self._state: dict[str, str] = {}

    def is_available(self, service: str) -> bool:
        state = self._state.get(service, "CLOSED")

        if state == "CLOSED":
            return True

        if state == "OPEN":
            last_failure = self._last_failure_time.get(service, 0)
            if time.time() - last_failure > self.recovery_timeout:
                self._state[service] = "HALF_OPEN"
                return True
            return False

        # HALF_OPEN: allow one request to test
        return True

    def record_success(self, service: str):
        self._failures[service] = 0
        self._state[service] = "CLOSED"

    def record_failure(self, service: str):
        failures = self._failures.get(service, 0) + 1
        self._failures[service] = failures
        self._last_failure_time[service] = time.time()

        if failures >= self.failure_threshold:
            self._state[service] = "OPEN"
            logger.warning(f"Circuit OPEN for {service}")


# Global circuit breaker
circuit_breaker = CircuitBreaker()


class CircuitOpenError(Exception):
    """Circuit breaker is open."""
    pass


@shared_task(bind=True, max_retries=3)
def call_external_service(self, service: str, payload: dict) -> dict:
    """
    Task with circuit breaker protection.

    Fails fast when service is unhealthy.
    """
    if not circuit_breaker.is_available(service):
        raise self.retry(
            exc=CircuitOpenError(f"Circuit open for {service}"),
            countdown=circuit_breaker.recovery_timeout,
        )

    try:
        # Simulate service call
        time.sleep(0.1)

        if payload.get("force_failure"):
            raise ConnectionError("Service unavailable")

        result = {"service": service, "payload": payload, "status": "success"}
        circuit_breaker.record_success(service)
        return result

    except Exception as exc:
        circuit_breaker.record_failure(service)
        raise self.retry(exc=exc, countdown=10)


# =============================================================================
# Pattern 7: Progress Tracking
# =============================================================================


@shared_task(bind=True)
def long_running_task(self, total_items: int) -> dict:
    """
    Long-running task with progress updates.

    Clients can poll for progress using task_id.
    """
    task_id = self.request.id
    processed = 0

    for i in range(total_items):
        # Simulate work
        time.sleep(0.1)
        processed += 1

        # Update progress
        self.update_state(
            state="PROGRESS",
            meta={
                "current": processed,
                "total": total_items,
                "percent": (processed / total_items) * 100,
            },
        )

    return {
        "task_id": task_id,
        "processed": processed,
        "status": "completed",
    }


# =============================================================================
# Beat Schedule
# =============================================================================

app.conf.beat_schedule = {
    "health-check-every-minute": {
        "task": "examples.task_patterns.health_check",
        "schedule": 60.0,
    },
    "cleanup-daily": {
        "task": "examples.task_patterns.cleanup_old_data",
        "schedule": crontab(hour=2, minute=0),
        "args": (30,),  # days
    },
}


@shared_task
def health_check() -> dict:
    """Periodic health check task."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
    }


@shared_task
def cleanup_old_data(days_old: int) -> dict:
    """Cleanup old data task."""
    logger.info(f"Cleaning up data older than {days_old} days")
    return {
        "cleaned_up": True,
        "days_old": days_old,
        "timestamp": datetime.utcnow().isoformat(),
    }


# =============================================================================
# Usage Examples
# =============================================================================

if __name__ == "__main__":
    # Example 1: Idempotent payment
    print("Example 1: Idempotent Payment")
    result = process_payment.delay(order_id=123, amount=99.99)
    print(f"Result: {result.get(timeout=10)}")

    # Example 2: ETL workflow
    print("\nExample 2: ETL Workflow")
    workflow = create_etl_workflow(
        source_id=1,
        destinations=["warehouse", "analytics"],
    )
    result = workflow.apply_async()
    print(f"Result: {result.get(timeout=30)}")

    # Example 3: Order workflow
    print("\nExample 3: Order Workflow")
    workflow = create_order_workflow(order_id=456)
    result = workflow.apply_async()
    print(f"Result: {result.get(timeout=30)}")

    # Example 4: Progress tracking
    print("\nExample 4: Progress Tracking")
    result = long_running_task.delay(total_items=10)
    while not result.ready():
        if result.state == "PROGRESS":
            meta = result.info
            print(f"Progress: {meta['current']}/{meta['total']} ({meta['percent']:.1f}%)")
        time.sleep(0.5)
    print(f"Final: {result.get()}")
