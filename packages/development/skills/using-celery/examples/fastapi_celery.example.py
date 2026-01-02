"""
FastAPI + Celery Integration Example

Production-ready patterns for integrating Celery with FastAPI:
- Triggering tasks from endpoints
- Status polling and result retrieval
- Progress tracking
- Task revocation
- Health checks
- Webhook callbacks

Run with:
    # Terminal 1: Start worker
    celery -A examples.task_patterns worker --loglevel=info

    # Terminal 2: Start API
    uvicorn examples.fastapi_celery:app --reload
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime
from enum import Enum
from typing import Annotated, Any

import httpx
from celery import Celery
from celery.result import AsyncResult
from celery.states import FAILURE, PENDING, REVOKED, STARTED, SUCCESS
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, Field, HttpUrl

# =============================================================================
# Celery Application
# =============================================================================

celery_app = Celery(
    "fastapi_celery",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)

celery_app.conf.update(
    task_track_started=True,
    result_extended=True,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Pydantic Schemas
# =============================================================================


class TaskStatus(str, Enum):
    """Task status enum."""
    PENDING = "pending"
    STARTED = "started"
    PROGRESS = "progress"
    SUCCESS = "success"
    FAILURE = "failure"
    REVOKED = "revoked"


class TaskResponse(BaseModel):
    """Response when task is queued."""
    task_id: str
    status: TaskStatus
    message: str = "Task queued successfully"


class TaskStatusResponse(BaseModel):
    """Response for task status check."""
    task_id: str
    status: TaskStatus
    ready: bool
    successful: bool | None = None
    result: Any | None = None
    error: str | None = None
    progress: dict | None = None


class TaskRevokeResponse(BaseModel):
    """Response for task revocation."""
    task_id: str
    revoked: bool
    message: str


class EmailRequest(BaseModel):
    """Email sending request."""
    to: str = Field(..., pattern=r"^[\w\.-]+@[\w\.-]+\.\w+$")
    subject: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1)
    priority: str = Field(default="normal", pattern="^(low|normal|high)$")


class ReportRequest(BaseModel):
    """Report generation request."""
    report_type: str = Field(..., pattern="^(daily|weekly|monthly)$")
    start_date: str
    end_date: str
    format: str = Field(default="pdf", pattern="^(pdf|csv|xlsx)$")


class BatchProcessRequest(BaseModel):
    """Batch processing request."""
    items: list[int] = Field(..., min_items=1, max_items=1000)
    webhook_url: HttpUrl | None = Field(default=None)


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    celery: dict
    timestamp: str


# =============================================================================
# Celery Tasks (defined here for completeness)
# =============================================================================

from celery import shared_task
import time


@shared_task(bind=True)
def send_email_task(
    self,
    to: str,
    subject: str,
    body: str,
    priority: str = "normal",
) -> dict:
    """Send email task."""
    task_id = self.request.id
    logger.info(f"Sending email to {to}")

    # Simulate email sending
    time.sleep(2)

    return {
        "task_id": task_id,
        "to": to,
        "subject": subject,
        "status": "sent",
        "timestamp": datetime.utcnow().isoformat(),
    }


@shared_task(bind=True)
def generate_report_task(
    self,
    report_type: str,
    start_date: str,
    end_date: str,
    format: str = "pdf",
) -> dict:
    """Generate report task with progress updates."""
    task_id = self.request.id
    stages = ["Fetching data", "Processing", "Formatting", "Saving"]

    for i, stage in enumerate(stages):
        self.update_state(
            state="PROGRESS",
            meta={
                "stage": stage,
                "current": i + 1,
                "total": len(stages),
                "percent": ((i + 1) / len(stages)) * 100,
            },
        )
        time.sleep(1)  # Simulate work

    return {
        "task_id": task_id,
        "report_type": report_type,
        "format": format,
        "file_url": f"/reports/{task_id}.{format}",
        "status": "completed",
    }


@shared_task(bind=True)
def batch_process_task(
    self,
    items: list[int],
    webhook_url: str | None = None,
) -> dict:
    """Batch process items with progress and optional webhook callback."""
    task_id = self.request.id
    total = len(items)
    processed = []

    for i, item in enumerate(items):
        # Simulate processing
        time.sleep(0.1)
        processed.append({"id": item, "status": "processed"})

        # Update progress every 10 items
        if i % 10 == 0:
            self.update_state(
                state="PROGRESS",
                meta={
                    "current": i + 1,
                    "total": total,
                    "percent": ((i + 1) / total) * 100,
                },
            )

    result = {
        "task_id": task_id,
        "total_processed": len(processed),
        "status": "completed",
    }

    # Call webhook if provided
    if webhook_url:
        try:
            with httpx.Client(timeout=10) as client:
                client.post(webhook_url, json=result)
        except Exception as e:
            logger.error(f"Webhook call failed: {e}")

    return result


# =============================================================================
# FastAPI Application
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - verify Celery connection on startup."""
    # Verify Celery is reachable
    try:
        celery_app.control.inspect().ping()
        logger.info("Celery connection verified")
    except Exception as e:
        logger.warning(f"Celery not available on startup: {e}")

    yield

    # Shutdown
    logger.info("Shutting down")


app = FastAPI(
    title="FastAPI + Celery Example",
    description="Production patterns for async task processing",
    version="1.0.0",
    lifespan=lifespan,
)


# =============================================================================
# Task Management Router
# =============================================================================

router = APIRouter(prefix="/tasks", tags=["tasks"])


def map_celery_status(celery_status: str) -> TaskStatus:
    """Map Celery status to API status."""
    mapping = {
        PENDING: TaskStatus.PENDING,
        STARTED: TaskStatus.STARTED,
        "PROGRESS": TaskStatus.PROGRESS,
        SUCCESS: TaskStatus.SUCCESS,
        FAILURE: TaskStatus.FAILURE,
        REVOKED: TaskStatus.REVOKED,
    }
    return mapping.get(celery_status, TaskStatus.PENDING)


@router.get("/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str) -> TaskStatusResponse:
    """
    Get task status and result.

    Returns current status, progress (if available), and result on completion.
    """
    result = AsyncResult(task_id, app=celery_app)

    response = TaskStatusResponse(
        task_id=task_id,
        status=map_celery_status(result.status),
        ready=result.ready(),
    )

    # Add progress info if available
    if result.status == "PROGRESS" and result.info:
        response.progress = result.info

    # Add result or error if ready
    if result.ready():
        response.successful = result.successful()
        if result.successful():
            response.result = result.get()
        else:
            response.error = str(result.result)

    return response


@router.delete("/{task_id}", response_model=TaskRevokeResponse)
async def revoke_task(
    task_id: str,
    terminate: bool = Query(
        default=False,
        description="Terminate running task (SIGTERM)",
    ),
) -> TaskRevokeResponse:
    """
    Revoke a pending or running task.

    - For pending tasks: Removed from queue
    - For running tasks: Terminated if terminate=true
    """
    result = AsyncResult(task_id, app=celery_app)

    if result.ready():
        return TaskRevokeResponse(
            task_id=task_id,
            revoked=False,
            message="Task already completed",
        )

    celery_app.control.revoke(task_id, terminate=terminate)

    return TaskRevokeResponse(
        task_id=task_id,
        revoked=True,
        message="Task revoked" + (" and terminated" if terminate else ""),
    )


@router.get("/{task_id}/progress")
async def get_task_progress(task_id: str) -> dict:
    """
    Get task progress for long-running tasks.

    Returns progress percentage and current stage if available.
    """
    result = AsyncResult(task_id, app=celery_app)

    if result.status == "PROGRESS" and result.info:
        return {
            "task_id": task_id,
            "status": "running",
            **result.info,
        }

    if result.ready():
        return {
            "task_id": task_id,
            "status": "completed" if result.successful() else "failed",
            "percent": 100 if result.successful() else 0,
        }

    return {
        "task_id": task_id,
        "status": result.status.lower(),
        "percent": 0,
    }


# =============================================================================
# Email Router
# =============================================================================

email_router = APIRouter(prefix="/emails", tags=["emails"])


@email_router.post("/send", response_model=TaskResponse, status_code=status.HTTP_202_ACCEPTED)
async def send_email(request: EmailRequest) -> TaskResponse:
    """
    Queue email for sending.

    Returns immediately with task_id for status polling.
    """
    # Determine queue based on priority
    queue = "high_priority" if request.priority == "high" else "default"

    task = send_email_task.apply_async(
        args=[request.to, request.subject, request.body],
        kwargs={"priority": request.priority},
        queue=queue,
    )

    return TaskResponse(
        task_id=task.id,
        status=TaskStatus.PENDING,
        message=f"Email queued for delivery to {request.to}",
    )


# =============================================================================
# Reports Router
# =============================================================================

reports_router = APIRouter(prefix="/reports", tags=["reports"])


@reports_router.post("/generate", response_model=TaskResponse, status_code=status.HTTP_202_ACCEPTED)
async def generate_report(request: ReportRequest) -> TaskResponse:
    """
    Queue report generation.

    Long-running task with progress tracking.
    Poll /tasks/{task_id}/progress for updates.
    """
    task = generate_report_task.delay(
        report_type=request.report_type,
        start_date=request.start_date,
        end_date=request.end_date,
        format=request.format,
    )

    return TaskResponse(
        task_id=task.id,
        status=TaskStatus.PENDING,
        message=f"Report generation started. Poll /tasks/{task.id}/progress for updates.",
    )


# =============================================================================
# Batch Processing Router
# =============================================================================

batch_router = APIRouter(prefix="/batch", tags=["batch"])


@batch_router.post("/process", response_model=TaskResponse, status_code=status.HTTP_202_ACCEPTED)
async def batch_process(request: BatchProcessRequest) -> TaskResponse:
    """
    Queue batch processing job.

    Optionally provide webhook_url for completion notification.
    """
    task = batch_process_task.delay(
        items=request.items,
        webhook_url=str(request.webhook_url) if request.webhook_url else None,
    )

    return TaskResponse(
        task_id=task.id,
        status=TaskStatus.PENDING,
        message=f"Processing {len(request.items)} items",
    )


# =============================================================================
# Health Check Router
# =============================================================================

health_router = APIRouter(prefix="/health", tags=["health"])


@health_router.get("", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Application health check including Celery workers.
    """
    celery_status = {"status": "unknown", "workers": []}

    try:
        # Ping workers with timeout
        response = celery_app.control.ping(timeout=2.0)

        if response:
            workers = []
            for worker_response in response:
                for worker_name, result in worker_response.items():
                    workers.append({
                        "name": worker_name,
                        "status": "ok" if result.get("ok") == "pong" else "error",
                    })

            celery_status = {
                "status": "healthy",
                "workers": workers,
                "worker_count": len(workers),
            }
        else:
            celery_status = {
                "status": "unhealthy",
                "workers": [],
                "error": "No workers responding",
            }

    except Exception as e:
        celery_status = {
            "status": "unhealthy",
            "workers": [],
            "error": str(e),
        }

    return HealthResponse(
        status="healthy" if celery_status["status"] == "healthy" else "degraded",
        celery=celery_status,
        timestamp=datetime.utcnow().isoformat(),
    )


@health_router.get("/ready")
async def readiness_check() -> dict:
    """
    Kubernetes readiness probe.

    Returns 200 if app can accept traffic.
    """
    return {"ready": True}


@health_router.get("/live")
async def liveness_check() -> dict:
    """
    Kubernetes liveness probe.

    Returns 200 if app is alive.
    """
    return {"alive": True}


# =============================================================================
# Include Routers
# =============================================================================

app.include_router(router)
app.include_router(email_router)
app.include_router(reports_router)
app.include_router(batch_router)
app.include_router(health_router)


# =============================================================================
# Root Endpoint
# =============================================================================


@app.get("/")
async def root() -> dict:
    """API information."""
    return {
        "name": "FastAPI + Celery Example",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


# =============================================================================
# Example Usage
# =============================================================================

"""
# Send email
curl -X POST http://localhost:8000/emails/send \
    -H "Content-Type: application/json" \
    -d '{"to": "user@example.com", "subject": "Test", "body": "Hello!"}'

# Response:
# {"task_id": "abc123", "status": "pending", "message": "Email queued..."}

# Check status
curl http://localhost:8000/tasks/abc123

# Response:
# {"task_id": "abc123", "status": "success", "ready": true, "result": {...}}

# Generate report with progress
curl -X POST http://localhost:8000/reports/generate \
    -H "Content-Type: application/json" \
    -d '{"report_type": "daily", "start_date": "2024-01-01", "end_date": "2024-01-31"}'

# Poll progress
curl http://localhost:8000/tasks/{task_id}/progress

# Response:
# {"task_id": "...", "status": "running", "stage": "Processing", "percent": 50}

# Batch with webhook
curl -X POST http://localhost:8000/batch/process \
    -H "Content-Type: application/json" \
    -d '{"items": [1, 2, 3, 4, 5], "webhook_url": "https://example.com/webhook"}'

# Health check
curl http://localhost:8000/health

# Response:
# {"status": "healthy", "celery": {"status": "healthy", "workers": [...]}}
"""
