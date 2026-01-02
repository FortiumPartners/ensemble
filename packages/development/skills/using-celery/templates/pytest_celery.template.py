"""
Celery pytest Fixtures Template

Template Variables:
    app_module: str - Path to celery app module (e.g., "myapp.celery_app")
    app_variable: str - Variable name in module (e.g., "celery_app")
    use_real_worker: bool - Include worker fixture for integration tests
    test_broker: str - Test broker URL (default: "memory://")
    test_backend: str - Test backend URL (default: "cache+memory://")

Usage:
    render_template("pytest_celery.template.py", {
        "app_module": "myapp.celery_app",
        "app_variable": "app",
        "use_real_worker": True,
    })

Output: tests/conftest.py
"""
from __future__ import annotations

import pytest
from celery import Celery
from celery.contrib.testing.app import TestApp
{% if use_real_worker %}
from celery.contrib.testing.worker import start_worker
{% endif %}
from unittest.mock import AsyncMock, MagicMock, patch

# =============================================================================
# Celery Test Configuration
# =============================================================================


@pytest.fixture(scope="session")
def celery_config() -> dict:
    """
    Celery configuration for tests.

    Uses in-memory broker and backend for fast, isolated tests.
    Eager mode executes tasks synchronously for easier testing.
    """
    return {
        "broker_url": "{{ test_broker | default('memory://') }}",
        "result_backend": "{{ test_backend | default('cache+memory://') }}",
        "task_always_eager": True,
        "task_eager_propagates": True,
        "task_store_errors_even_if_ignored": True,
    }


@pytest.fixture(scope="session")
def celery_parameters() -> dict:
    """Additional parameters for celery fixture."""
    return {
        "task_cls": "{{ app_module | default('myapp.celery_app') }}:Task",
    }


@pytest.fixture(scope="session")
def celery_app(celery_config: dict) -> Celery:
    """
    Test Celery application.

    Creates a fresh Celery app with test configuration.
    Scoped to session for performance.
    """
    app = Celery("test_app")
    app.config_from_object(celery_config)

    # Import and register tasks
    # from {{ app_module | default('myapp') }}.tasks import email, reports

    return app


@pytest.fixture
def celery_app_with_tasks(celery_app: Celery):
    """
    Celery app with production tasks loaded.

    Use this when you need to test actual task implementations.
    """
    # Import your production app to get registered tasks
    from {{ app_module | default('myapp.celery_app') }} import {{ app_variable | default('app') }} as prod_app

    # Copy task registry
    celery_app.tasks.update(prod_app.tasks)

    return celery_app


{% if use_real_worker %}
# =============================================================================
# Real Worker Fixtures (Integration Tests)
# =============================================================================


@pytest.fixture(scope="session")
def celery_worker_config() -> dict:
    """Configuration for test worker."""
    return {
        "broker_url": "redis://localhost:6379/15",  # Use separate DB
        "result_backend": "redis://localhost:6379/15",
        "task_always_eager": False,  # Actually run in worker
    }


@pytest.fixture(scope="session")
def celery_worker_app(celery_worker_config: dict) -> Celery:
    """Celery app configured for real worker testing."""
    from {{ app_module | default('myapp.celery_app') }} import {{ app_variable | default('app') }}

    # Override with test config
    {{ app_variable | default('app') }}.conf.update(celery_worker_config)

    return {{ app_variable | default('app') }}


@pytest.fixture(scope="session")
def celery_worker(celery_worker_app: Celery):
    """
    Start a real Celery worker for integration tests.

    Requires Redis to be running.
    Scoped to session to avoid worker startup overhead.
    """
    with start_worker(
        celery_worker_app,
        perform_ping_check=False,
        loglevel="INFO",
    ) as worker:
        yield worker


@pytest.fixture
def wait_for_task():
    """Helper to wait for task completion with timeout."""
    from celery.result import AsyncResult

    def _wait(task_id: str, timeout: float = 30.0) -> dict:
        result = AsyncResult(task_id)
        return result.get(timeout=timeout)

    return _wait
{% endif %}


# =============================================================================
# Mock Fixtures
# =============================================================================


@pytest.fixture
def mock_external_service():
    """Mock external service for task testing."""
    with patch("{{ app_module | default('myapp') }}.tasks.external_service") as mock:
        mock.call = MagicMock(return_value={"status": "success"})
        yield mock


@pytest.fixture
def mock_database():
    """Mock database session for task testing."""
    mock_session = MagicMock()
    mock_session.query.return_value.filter.return_value.first.return_value = None
    mock_session.add = MagicMock()
    mock_session.commit = MagicMock()

    with patch("{{ app_module | default('myapp') }}.tasks.get_db_session") as mock:
        mock.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock.return_value.__exit__ = MagicMock(return_value=False)
        yield mock_session


@pytest.fixture
def mock_redis():
    """Mock Redis client for task testing."""
    mock_client = MagicMock()
    mock_client.get.return_value = None
    mock_client.set.return_value = True
    mock_client.setex.return_value = True

    with patch("{{ app_module | default('myapp') }}.tasks.redis_client", mock_client):
        yield mock_client


# =============================================================================
# Test Helpers
# =============================================================================


@pytest.fixture
def assert_task_success():
    """Helper to assert task completed successfully."""

    def _assert(result, expected_status: str = "completed"):
        assert result.successful(), f"Task failed: {result.result}"
        data = result.get()
        assert data.get("status") == expected_status, f"Unexpected status: {data}"
        return data

    return _assert


@pytest.fixture
def assert_task_failed():
    """Helper to assert task failed as expected."""

    def _assert(result, expected_exception: type = Exception):
        assert result.failed(), "Task should have failed"
        assert isinstance(result.result, expected_exception)
        return result.result

    return _assert


@pytest.fixture
def task_context():
    """Create mock task context for testing bound tasks."""

    class MockRequest:
        id = "test-task-id-12345"
        retries = 0
        parent_id = None
        root_id = "test-task-id-12345"
        hostname = "test-worker"
        is_eager = True
        delivery_info = {"routing_key": "default"}

    class MockTask:
        name = "test_task"
        request = MockRequest()

        def retry(self, exc=None, countdown=60, max_retries=3):
            from celery.exceptions import Retry
            raise Retry(exc=exc, when=countdown)

        def update_state(self, state, meta=None):
            self._state = state
            self._meta = meta

    return MockTask()


# =============================================================================
# Example Test Patterns
# =============================================================================

"""
Example unit test for a task (eager mode):

class TestSendEmailTask:
    def test_send_email_success(
        self,
        celery_app_with_tasks,
        mock_external_service,
        assert_task_success,
    ):
        from myapp.tasks.email import send_email

        result = send_email.delay(
            to="user@example.com",
            subject="Test",
            body="Hello",
        )

        data = assert_task_success(result)
        assert data["to"] == "user@example.com"
        mock_external_service.call.assert_called_once()


Example integration test with real worker:

@pytest.mark.integration
class TestEmailWorkflow:
    def test_email_chain(
        self,
        celery_worker,
        wait_for_task,
    ):
        from celery import chain
        from myapp.tasks import validate_email, send_email, log_delivery

        workflow = chain(
            validate_email.s("user@example.com"),
            send_email.s("Test Subject", "Test Body"),
            log_delivery.s(),
        )

        result = workflow.apply_async()
        final = wait_for_task(result.id, timeout=60)

        assert final["status"] == "delivered"


Example parametrized test:

@pytest.mark.parametrize("retry_count,should_succeed", [
    (0, True),
    (1, True),
    (2, True),
    (3, False),  # Max retries exceeded
])
def test_retry_behavior(
    self,
    celery_app_with_tasks,
    retry_count,
    should_succeed,
):
    from myapp.tasks import flaky_task

    # Mock to fail N times then succeed
    with patch.object(flaky_task, "run") as mock_run:
        if should_succeed:
            mock_run.side_effect = [Exception("Fail")] * retry_count + ["success"]
        else:
            mock_run.side_effect = Exception("Fail")

        result = flaky_task.delay()

        if should_succeed:
            assert result.successful()
        else:
            assert result.failed()
"""
