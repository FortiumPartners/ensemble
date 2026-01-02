"""Complete FastAPI Application Example.

This example demonstrates a production-ready FastAPI application
with proper structure, patterns, and best practices.

Features:
- Application factory pattern
- Router organization
- Dependency injection
- Pydantic models with validation
- Error handling middleware
- Database integration patterns
- Background tasks
- Authentication

Run this example:
    uvicorn examples.fastapi_app.example:app --reload

Or test with:
    pytest examples/fastapi_app.example.py -v
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any, TypeVar, Generic

from fastapi import (
    FastAPI,
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Path,
    BackgroundTasks,
    Request,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, EmailStr, field_validator, ConfigDict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# Configuration
# =============================================================================


class Settings(BaseModel):
    """Application settings."""

    app_name: str = "Example API"
    debug: bool = True
    database_url: str = "sqlite+aiosqlite:///:memory:"
    secret_key: str = "super-secret-key-change-in-production"
    allowed_origins: list[str] = ["http://localhost:3000"]


settings = Settings()


# =============================================================================
# Exceptions
# =============================================================================


class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        code: str = "INTERNAL_ERROR",
    ) -> None:
        self.message = message
        self.status_code = status_code
        self.code = code
        super().__init__(message)


class NotFoundError(AppException):
    """Resource not found."""

    def __init__(self, resource: str, id: Any) -> None:
        super().__init__(
            message=f"{resource} with id '{id}' not found",
            status_code=404,
            code="NOT_FOUND",
        )


class ConflictError(AppException):
    """Resource conflict."""

    def __init__(self, message: str) -> None:
        super().__init__(message=message, status_code=409, code="CONFLICT")


class ValidationError(AppException):
    """Validation error."""

    def __init__(self, message: str) -> None:
        super().__init__(message=message, status_code=422, code="VALIDATION_ERROR")


# =============================================================================
# Schemas (Pydantic Models)
# =============================================================================

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response."""

    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    @property
    def has_prev(self) -> bool:
        return self.page > 1


class UserBase(BaseModel):
    """Base user schema."""

    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)


class UserCreate(UserBase):
    """User creation schema."""

    password: str = Field(..., min_length=8)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not any(c.isupper() for c in v):
            raise ValueError("Password must contain uppercase letter")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain digit")
        return v


class UserUpdate(BaseModel):
    """User update schema (all optional)."""

    email: EmailStr | None = None
    name: str | None = Field(None, min_length=1, max_length=100)
    is_active: bool | None = None


class UserResponse(UserBase):
    """User response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    created_at: datetime


class ItemBase(BaseModel):
    """Base item schema."""

    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    price: float = Field(..., gt=0)


class ItemCreate(ItemBase):
    """Item creation schema."""

    pass


class ItemResponse(ItemBase):
    """Item response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    created_at: datetime


# =============================================================================
# Database Simulation (In-Memory Storage)
# =============================================================================


class Database:
    """Simulated async database."""

    def __init__(self) -> None:
        self.users: dict[int, dict] = {}
        self.items: dict[int, dict] = {}
        self._user_id = 0
        self._item_id = 0

    async def get_user(self, user_id: int) -> dict | None:
        return self.users.get(user_id)

    async def get_user_by_email(self, email: str) -> dict | None:
        for user in self.users.values():
            if user["email"] == email:
                return user
        return None

    async def create_user(self, data: dict) -> dict:
        self._user_id += 1
        user = {
            "id": self._user_id,
            "created_at": datetime.now(),
            "is_active": True,
            **data,
        }
        self.users[self._user_id] = user
        return user

    async def list_users(
        self, skip: int = 0, limit: int = 20
    ) -> tuple[list[dict], int]:
        users = list(self.users.values())
        return users[skip : skip + limit], len(users)

    async def update_user(self, user_id: int, data: dict) -> dict | None:
        if user_id not in self.users:
            return None
        self.users[user_id].update(data)
        return self.users[user_id]

    async def delete_user(self, user_id: int) -> bool:
        if user_id in self.users:
            del self.users[user_id]
            return True
        return False

    async def create_item(self, data: dict) -> dict:
        self._item_id += 1
        item = {
            "id": self._item_id,
            "created_at": datetime.now(),
            **data,
        }
        self.items[self._item_id] = item
        return item

    async def list_items(
        self, owner_id: int | None = None, skip: int = 0, limit: int = 20
    ) -> tuple[list[dict], int]:
        items = list(self.items.values())
        if owner_id:
            items = [i for i in items if i["owner_id"] == owner_id]
        return items[skip : skip + limit], len(items)


# Global database instance
db = Database()


# =============================================================================
# Dependencies
# =============================================================================


async def get_db() -> Database:
    """Database dependency."""
    return db


async def get_current_user(
    # In real app: token verification here
) -> dict:
    """Get current authenticated user.

    This is a simplified version. In production:
    - Parse JWT token from Authorization header
    - Verify token signature
    - Fetch user from database
    """
    # Simulate authenticated user
    return {"id": 1, "email": "user@example.com", "name": "Test User"}


# Type aliases for dependencies
DbDep = Annotated[Database, Depends(get_db)]
CurrentUser = Annotated[dict, Depends(get_current_user)]


# =============================================================================
# Background Tasks
# =============================================================================


async def send_welcome_email(email: str, name: str) -> None:
    """Send welcome email (simulated)."""
    logger.info("Sending welcome email to %s (%s)", name, email)
    # In production: use email service
    await asyncio.sleep(1)  # Simulate async email sending
    logger.info("Welcome email sent to %s", email)


async def log_activity(user_id: int, action: str) -> None:
    """Log user activity (simulated)."""
    logger.info("User %d performed action: %s", user_id, action)


# =============================================================================
# Routers
# =============================================================================

# User router
user_router = APIRouter(prefix="/users", tags=["users"])


@user_router.get("", response_model=PaginatedResponse[UserResponse])
async def list_users(
    db: DbDep,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PaginatedResponse[UserResponse]:
    """List all users with pagination."""
    users, total = await db.list_users(skip=skip, limit=limit)
    return PaginatedResponse(
        items=[UserResponse.model_validate(u) for u in users],
        total=total,
        page=skip // limit + 1,
        page_size=limit,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


@user_router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    db: DbDep,
    user_id: Annotated[int, Path(gt=0)],
) -> UserResponse:
    """Get user by ID."""
    user = await db.get_user(user_id)
    if not user:
        raise NotFoundError("User", user_id)
    return UserResponse.model_validate(user)


@user_router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    db: DbDep,
    user_in: UserCreate,
    background_tasks: BackgroundTasks,
) -> UserResponse:
    """Create a new user."""
    # Check for existing user
    existing = await db.get_user_by_email(user_in.email)
    if existing:
        raise ConflictError(f"User with email '{user_in.email}' already exists")

    # Create user (hash password in production!)
    user_data = user_in.model_dump()
    user_data["hashed_password"] = f"hashed_{user_data.pop('password')}"
    user = await db.create_user(user_data)

    # Send welcome email in background
    background_tasks.add_task(send_welcome_email, user["email"], user["name"])

    return UserResponse.model_validate(user)


@user_router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    db: DbDep,
    user_id: Annotated[int, Path(gt=0)],
    user_in: UserUpdate,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> UserResponse:
    """Update user (requires authentication)."""
    # Only allow self-update (or admin in production)
    if current_user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    user = await db.update_user(user_id, user_in.model_dump(exclude_unset=True))
    if not user:
        raise NotFoundError("User", user_id)

    # Log activity in background
    background_tasks.add_task(log_activity, user_id, "profile_updated")

    return UserResponse.model_validate(user)


@user_router.delete("/{user_id}", status_code=204)
async def delete_user(
    db: DbDep,
    user_id: Annotated[int, Path(gt=0)],
    current_user: CurrentUser,
) -> None:
    """Delete user (requires authentication)."""
    if current_user["id"] != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    deleted = await db.delete_user(user_id)
    if not deleted:
        raise NotFoundError("User", user_id)


# Item router
item_router = APIRouter(prefix="/items", tags=["items"])


@item_router.post("", response_model=ItemResponse, status_code=201)
async def create_item(
    db: DbDep,
    item_in: ItemCreate,
    current_user: CurrentUser,
) -> ItemResponse:
    """Create a new item (requires authentication)."""
    item_data = item_in.model_dump()
    item_data["owner_id"] = current_user["id"]
    item = await db.create_item(item_data)
    return ItemResponse.model_validate(item)


@item_router.get("", response_model=PaginatedResponse[ItemResponse])
async def list_items(
    db: DbDep,
    owner_id: Annotated[int | None, Query()] = None,
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PaginatedResponse[ItemResponse]:
    """List items with optional owner filter."""
    items, total = await db.list_items(owner_id=owner_id, skip=skip, limit=limit)
    return PaginatedResponse(
        items=[ItemResponse.model_validate(i) for i in items],
        total=total,
        page=skip // limit + 1,
        page_size=limit,
        pages=(total + limit - 1) // limit if total > 0 else 1,
    )


# =============================================================================
# Application Factory
# =============================================================================


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan events."""
    # Startup
    logger.info("Starting up %s...", settings.app_name)
    # Initialize database, caches, etc.

    yield

    # Shutdown
    logger.info("Shutting down %s...", settings.app_name)
    # Cleanup resources


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title=settings.app_name,
        description="Example FastAPI application with best practices",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Exception handlers
    @app.exception_handler(AppException)
    async def app_exception_handler(
        request: Request, exc: AppException
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    # Include routers
    app.include_router(user_router, prefix="/api/v1")
    app.include_router(item_router, prefix="/api/v1")

    # Health check
    @app.get("/health")
    async def health_check() -> dict[str, str]:
        return {"status": "healthy"}

    return app


# Create application instance
app = create_app()


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    import asyncio
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
