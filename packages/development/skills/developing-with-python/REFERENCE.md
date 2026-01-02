# Python Development - Comprehensive Guide

**Version**: 1.0.0
**Python**: 3.11+
**Use Case**: Deep dives, learning patterns, comprehensive reference

---

## Table of Contents

1. [Project Architecture](#1-project-architecture)
2. [Type System](#2-type-system)
3. [Classes and OOP](#3-classes-and-oop)
4. [Async Programming](#4-async-programming)
5. [FastAPI Framework](#5-fastapi-framework)
6. [Database Patterns](#6-database-patterns)
7. [Testing Strategies](#7-testing-strategies)
8. [Error Handling](#8-error-handling)
9. [Performance Optimization](#9-performance-optimization)
10. [Best Practices](#10-best-practices)

---

## 1. Project Architecture

### 1.1 Project Layouts

#### Src Layout (Recommended)

The src layout prevents accidental imports of the local package during development:

```
my_project/
├── src/
│   └── my_package/
│       ├── __init__.py       # Package initialization
│       ├── __main__.py       # python -m my_package
│       ├── py.typed          # PEP 561 marker for type hints
│       └── ...
├── tests/
│   ├── __init__.py
│   ├── conftest.py           # Shared fixtures
│   └── ...
├── pyproject.toml
├── README.md
└── .python-version
```

#### Flat Layout (Simple projects)

```
my_project/
├── my_package/
│   ├── __init__.py
│   └── ...
├── tests/
├── pyproject.toml
└── README.md
```

### 1.2 Module Organization

#### Package Structure

```python
# src/my_package/__init__.py
"""
My Package - A description of what this package does.

Example:
    >>> from my_package import process
    >>> result = process("input")
"""

from my_package.core import process
from my_package.models import User, Item

__version__ = "1.0.0"
__all__ = ["process", "User", "Item", "__version__"]
```

#### Lazy Imports (Performance)

```python
# src/my_package/__init__.py
"""Package with lazy imports for heavy dependencies."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from my_package.heavy import HeavyClass

__all__ = ["HeavyClass", "get_heavy"]

_heavy_module = None


def get_heavy():
    """Lazy import of heavy module."""
    global _heavy_module
    if _heavy_module is None:
        from my_package import heavy as _heavy_module
    return _heavy_module.HeavyClass


def __getattr__(name: str):
    if name == "HeavyClass":
        return get_heavy()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
```

### 1.3 Entry Points

#### CLI Entry Point

```python
# src/my_package/__main__.py
"""Entry point for python -m my_package."""

from my_package.cli import main

if __name__ == "__main__":
    main()
```

```python
# src/my_package/cli.py
"""Command-line interface."""

import argparse
import sys
from typing import Sequence


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="my_package",
        description="My package CLI",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("input", nargs="?", default="-")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        # Main logic here
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

#### pyproject.toml Entry Points

```toml
[project.scripts]
my-cli = "my_package.cli:main"

[project.gui-scripts]
my-gui = "my_package.gui:main"

[project.entry-points."my_package.plugins"]
plugin1 = "my_package.plugins.plugin1:Plugin"
```

### 1.4 Dependency Management

#### pyproject.toml Dependencies

```toml
[project]
name = "my_package"
version = "1.0.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.109.0",
    "pydantic>=2.5.0",
    "httpx>=0.26.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=4.1.0",
    "mypy>=1.8.0",
    "ruff>=0.1.0",
]
postgres = [
    "asyncpg>=0.29.0",
    "sqlalchemy[asyncio]>=2.0.0",
]
all = [
    "my_package[dev,postgres]",
]
```

#### Dependency Pinning with pip-tools

```bash
# requirements.in
-e .[dev]

# Generate pinned requirements
pip-compile pyproject.toml -o requirements.txt
pip-compile pyproject.toml --extra dev -o requirements-dev.txt

# Install exact versions
pip-sync requirements.txt requirements-dev.txt
```

---

## 2. Type System

### 2.1 Basic Types

#### Builtin Types

```python
from typing import Any

# Primitives
name: str = "Alice"
age: int = 30
price: float = 19.99
active: bool = True

# None type
nothing: None = None

# Any (avoid when possible)
data: Any = {"key": "value"}

# Dynamic
def process(obj: object) -> str:
    return str(obj)
```

#### Collection Types

```python
from collections.abc import Sequence, Mapping, Set, Iterable, Iterator

# List (mutable sequence)
names: list[str] = ["Alice", "Bob"]

# Tuple (immutable, fixed length)
point: tuple[int, int] = (10, 20)
rgb: tuple[int, int, int] = (255, 128, 0)
variable: tuple[int, ...] = (1, 2, 3, 4, 5)  # Variable length

# Dict (mutable mapping)
scores: dict[str, int] = {"Alice": 95, "Bob": 87}

# Set (mutable, unique items)
unique_ids: set[int] = {1, 2, 3}

# Frozenset (immutable set)
immutable_ids: frozenset[int] = frozenset({1, 2, 3})

# Abstract types (prefer for function parameters)
def process_sequence(items: Sequence[str]) -> list[str]:
    """Accept any sequence (list, tuple, etc.)."""
    return [item.upper() for item in items]

def lookup(mapping: Mapping[str, int], key: str) -> int | None:
    """Accept any mapping (dict, etc.)."""
    return mapping.get(key)
```

### 2.2 Union and Optional Types

```python
from typing import Optional, Union

# Python 3.10+ syntax (preferred)
value: int | str = 42
nullable: str | None = None

# Legacy syntax (Python 3.9 and earlier)
value: Union[int, str] = 42
nullable: Optional[str] = None  # Equivalent to str | None

# Multiple types
def process(data: int | str | list[int]) -> str:
    if isinstance(data, int):
        return str(data)
    elif isinstance(data, str):
        return data
    else:
        return ", ".join(str(x) for x in data)
```

### 2.3 Type Variables and Generics

```python
from typing import TypeVar, Generic
from collections.abc import Iterator, Callable

# Type variable
T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")

# Constrained type variable
Number = TypeVar("Number", int, float)

# Bound type variable
Comparable = TypeVar("Comparable", bound="SupportsLessThan")


def first(items: list[T]) -> T | None:
    """Return first item or None."""
    return items[0] if items else None


def maximum(a: Number, b: Number) -> Number:
    """Return maximum of two numbers."""
    return a if a > b else b


# Generic class
class Stack(Generic[T]):
    """Generic stack implementation."""

    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        if not self._items:
            raise IndexError("Stack is empty")
        return self._items.pop()

    def peek(self) -> T | None:
        return self._items[-1] if self._items else None

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self) -> Iterator[T]:
        return iter(self._items)


# Usage
int_stack: Stack[int] = Stack()
int_stack.push(42)
str_stack: Stack[str] = Stack()
str_stack.push("hello")
```

### 2.4 Callable Types

```python
from collections.abc import Callable, Awaitable
from typing import TypeVar, ParamSpec, Concatenate

T = TypeVar("T")
P = ParamSpec("P")

# Simple callable
Handler = Callable[[str, int], bool]

def register(handler: Handler) -> None:
    ...

# Callable with keyword arguments
def process(
    func: Callable[..., T],
    *args: object,
    **kwargs: object,
) -> T:
    return func(*args, **kwargs)

# Async callable
AsyncHandler = Callable[[str], Awaitable[dict[str, Any]]]

async def async_process(handler: AsyncHandler, data: str) -> dict[str, Any]:
    return await handler(data)

# ParamSpec for decorators (preserves signature)
def logged(func: Callable[P, T]) -> Callable[P, T]:
    """Decorator that logs function calls."""
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        print(f"Calling {func.__name__}")
        result = func(*args, **kwargs)
        print(f"Result: {result}")
        return result
    return wrapper

@logged
def add(a: int, b: int) -> int:
    return a + b

# Concatenate for adding parameters
def with_context(
    func: Callable[Concatenate[Context, P], T],
) -> Callable[P, T]:
    """Add context parameter to function."""
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        ctx = get_current_context()
        return func(ctx, *args, **kwargs)
    return wrapper
```

### 2.5 Protocol (Structural Typing)

```python
from typing import Protocol, runtime_checkable


class Closeable(Protocol):
    """Protocol for objects that can be closed."""

    def close(self) -> None:
        ...


class Readable(Protocol):
    """Protocol for readable objects."""

    def read(self, n: int = -1) -> bytes:
        ...


class ReadWriteCloseable(Readable, Closeable, Protocol):
    """Combined protocol."""

    def write(self, data: bytes) -> int:
        ...


@runtime_checkable
class SupportsLen(Protocol):
    """Protocol for objects with __len__."""

    def __len__(self) -> int:
        ...


def get_length(obj: SupportsLen) -> int:
    """Get length of any object supporting len()."""
    return len(obj)


# Runtime check (requires @runtime_checkable)
if isinstance(my_obj, SupportsLen):
    print(f"Length: {len(my_obj)}")


# Protocol with properties
class Named(Protocol):
    @property
    def name(self) -> str:
        ...


# Protocol with class methods
class Constructable(Protocol[T]):
    @classmethod
    def create(cls) -> T:
        ...
```

### 2.6 Type Aliases and NewType

```python
from typing import TypeAlias, NewType

# Type alias (simple substitution)
UserId: TypeAlias = int
JsonDict: TypeAlias = dict[str, "JsonValue"]
JsonValue: TypeAlias = str | int | float | bool | None | JsonDict | list["JsonValue"]

# NewType (stricter - creates distinct type)
UserId = NewType("UserId", int)
OrderId = NewType("OrderId", int)

def get_user(user_id: UserId) -> dict:
    ...

def get_order(order_id: OrderId) -> dict:
    ...

# Must explicitly wrap
user_id = UserId(42)
order_id = OrderId(42)

get_user(user_id)    # OK
get_user(order_id)   # Type error! (but runs at runtime)
get_user(42)         # Type error! (but runs at runtime)

# Complex type alias
from collections.abc import Callable, Awaitable

AsyncMiddleware: TypeAlias = Callable[
    [Request, Callable[[Request], Awaitable[Response]]],
    Awaitable[Response],
]
```

### 2.7 Literal and Final

```python
from typing import Literal, Final, final

# Literal types
Mode = Literal["r", "w", "a", "rb", "wb"]

def open_file(path: str, mode: Mode = "r") -> IO:
    return open(path, mode)

# Status literals
Status = Literal["pending", "active", "completed", "failed"]

def set_status(item_id: int, status: Status) -> None:
    ...

# Final (constant)
MAX_RETRIES: Final = 3
API_VERSION: Final[str] = "v1"

# Final class (cannot be subclassed)
@final
class Singleton:
    _instance: "Singleton | None" = None

    def __new__(cls) -> "Singleton":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance


# Final method (cannot be overridden)
class Base:
    @final
    def critical_method(self) -> None:
        """This method cannot be overridden."""
        ...
```

---

## 3. Classes and OOP

### 3.1 Dataclasses

```python
from dataclasses import dataclass, field, asdict, astuple
from datetime import datetime
from typing import ClassVar


@dataclass
class User:
    """User entity."""

    id: int
    email: str
    name: str
    created_at: datetime = field(default_factory=datetime.now)
    roles: list[str] = field(default_factory=list)
    is_active: bool = True

    # Class variable (not instance field)
    _registry: ClassVar[dict[int, "User"]] = {}

    def __post_init__(self) -> None:
        """Validation after initialization."""
        if "@" not in self.email:
            raise ValueError(f"Invalid email: {self.email}")
        User._registry[self.id] = self

    @classmethod
    def get_by_id(cls, user_id: int) -> "User | None":
        return cls._registry.get(user_id)


@dataclass(frozen=True)  # Immutable
class Point:
    """Immutable 2D point."""

    x: float
    y: float

    def distance_to(self, other: "Point") -> float:
        return ((self.x - other.x) ** 2 + (self.y - other.y) ** 2) ** 0.5


@dataclass(slots=True)  # Memory efficient (Python 3.10+)
class HighVolumeData:
    """Memory-optimized data class."""

    id: int
    value: float
    timestamp: float


@dataclass(kw_only=True)  # Keyword-only arguments (Python 3.10+)
class Config:
    """Configuration with keyword-only fields."""

    host: str
    port: int = 8080
    debug: bool = False


# Inheritance
@dataclass
class AdminUser(User):
    """Admin user with additional permissions."""

    permissions: list[str] = field(default_factory=list)
    admin_level: int = 1


# Convert to dict/tuple
user = User(id=1, email="alice@example.com", name="Alice")
user_dict = asdict(user)
user_tuple = astuple(user)
```

### 3.2 Pydantic Models

```python
from pydantic import (
    BaseModel,
    Field,
    field_validator,
    model_validator,
    ConfigDict,
    EmailStr,
    HttpUrl,
    SecretStr,
)
from datetime import datetime


class UserBase(BaseModel):
    """Base user schema."""

    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100)
    website: HttpUrl | None = None


class UserCreate(UserBase):
    """Schema for user creation."""

    password: SecretStr = Field(..., min_length=8)

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: SecretStr) -> SecretStr:
        password = v.get_secret_value()
        if not any(c.isupper() for c in password):
            raise ValueError("Password must contain uppercase letter")
        if not any(c.isdigit() for c in password):
            raise ValueError("Password must contain digit")
        return v


class UserUpdate(BaseModel):
    """Schema for user updates (all optional)."""

    email: EmailStr | None = None
    name: str | None = Field(None, min_length=1, max_length=100)

    @model_validator(mode="before")
    @classmethod
    def check_not_empty(cls, data: dict) -> dict:
        if not any(v is not None for v in data.values()):
            raise ValueError("At least one field must be provided")
        return data


class UserResponse(UserBase):
    """Schema for API responses."""

    model_config = ConfigDict(from_attributes=True)  # Enable ORM mode

    id: int
    created_at: datetime
    is_active: bool = True


class UserInDB(UserResponse):
    """Schema with database-only fields."""

    hashed_password: str


# Nested models
class Address(BaseModel):
    street: str
    city: str
    country: str
    postal_code: str


class UserWithAddress(UserResponse):
    addresses: list[Address] = Field(default_factory=list)


# Generic model
from typing import TypeVar, Generic

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
```

### 3.3 Abstract Base Classes

```python
from abc import ABC, abstractmethod
from typing import TypeVar, Generic

T = TypeVar("T")
ID = TypeVar("ID")


class Repository(ABC, Generic[T, ID]):
    """Abstract repository pattern."""

    @abstractmethod
    async def get(self, id: ID) -> T | None:
        """Get entity by ID."""
        ...

    @abstractmethod
    async def get_all(self, skip: int = 0, limit: int = 100) -> list[T]:
        """Get all entities with pagination."""
        ...

    @abstractmethod
    async def create(self, entity: T) -> T:
        """Create new entity."""
        ...

    @abstractmethod
    async def update(self, id: ID, entity: T) -> T | None:
        """Update existing entity."""
        ...

    @abstractmethod
    async def delete(self, id: ID) -> bool:
        """Delete entity by ID."""
        ...


class SQLAlchemyRepository(Repository[T, int]):
    """SQLAlchemy implementation of repository."""

    def __init__(self, session: AsyncSession, model: type[T]) -> None:
        self.session = session
        self.model = model

    async def get(self, id: int) -> T | None:
        return await self.session.get(self.model, id)

    async def get_all(self, skip: int = 0, limit: int = 100) -> list[T]:
        result = await self.session.execute(
            select(self.model).offset(skip).limit(limit)
        )
        return list(result.scalars().all())

    async def create(self, entity: T) -> T:
        self.session.add(entity)
        await self.session.commit()
        await self.session.refresh(entity)
        return entity

    async def update(self, id: int, entity: T) -> T | None:
        existing = await self.get(id)
        if existing is None:
            return None
        for key, value in entity.__dict__.items():
            if not key.startswith("_"):
                setattr(existing, key, value)
        await self.session.commit()
        return existing

    async def delete(self, id: int) -> bool:
        entity = await self.get(id)
        if entity is None:
            return False
        await self.session.delete(entity)
        await self.session.commit()
        return True
```

### 3.4 Mixins and Multiple Inheritance

```python
from datetime import datetime


class TimestampMixin:
    """Mixin for timestamp fields."""

    created_at: datetime
    updated_at: datetime | None = None

    def touch(self) -> None:
        self.updated_at = datetime.now()


class SoftDeleteMixin:
    """Mixin for soft delete functionality."""

    deleted_at: datetime | None = None
    is_deleted: bool = False

    def soft_delete(self) -> None:
        self.deleted_at = datetime.now()
        self.is_deleted = True

    def restore(self) -> None:
        self.deleted_at = None
        self.is_deleted = False


class AuditMixin:
    """Mixin for audit fields."""

    created_by: str | None = None
    updated_by: str | None = None


# Combined usage
@dataclass
class AuditableUser(TimestampMixin, SoftDeleteMixin, AuditMixin):
    """User with full auditing capabilities."""

    id: int
    email: str
    name: str
    created_at: datetime = field(default_factory=datetime.now)
```

### 3.5 Properties and Descriptors

```python
from typing import Any


class Temperature:
    """Temperature with Celsius and Fahrenheit views."""

    def __init__(self, celsius: float = 0.0) -> None:
        self._celsius = celsius

    @property
    def celsius(self) -> float:
        return self._celsius

    @celsius.setter
    def celsius(self, value: float) -> None:
        if value < -273.15:
            raise ValueError("Temperature below absolute zero")
        self._celsius = value

    @property
    def fahrenheit(self) -> float:
        return self._celsius * 9 / 5 + 32

    @fahrenheit.setter
    def fahrenheit(self, value: float) -> None:
        self.celsius = (value - 32) * 5 / 9

    @property
    def kelvin(self) -> float:
        return self._celsius + 273.15


# Custom descriptor
class Validated:
    """Descriptor for validated attributes."""

    def __init__(
        self,
        validator: Callable[[Any], bool],
        error_msg: str = "Validation failed",
    ) -> None:
        self.validator = validator
        self.error_msg = error_msg

    def __set_name__(self, owner: type, name: str) -> None:
        self.name = name
        self.private_name = f"_{name}"

    def __get__(self, obj: object | None, objtype: type | None = None) -> Any:
        if obj is None:
            return self
        return getattr(obj, self.private_name, None)

    def __set__(self, obj: object, value: Any) -> None:
        if not self.validator(value):
            raise ValueError(f"{self.name}: {self.error_msg}")
        setattr(obj, self.private_name, value)


class User:
    email = Validated(
        lambda x: "@" in x,
        "Invalid email format"
    )
    age = Validated(
        lambda x: 0 <= x <= 150,
        "Age must be between 0 and 150"
    )

    def __init__(self, email: str, age: int) -> None:
        self.email = email
        self.age = age
```

---

## 4. Async Programming

### 4.1 Async Basics

```python
import asyncio
from collections.abc import Coroutine
from typing import Any


async def fetch_data(url: str) -> dict[str, Any]:
    """Async function (coroutine)."""
    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def main() -> None:
    """Main async entry point."""
    result = await fetch_data("https://api.example.com/data")
    print(result)


# Run the event loop
if __name__ == "__main__":
    asyncio.run(main())
```

### 4.2 Concurrent Execution

```python
import asyncio


async def fetch_all(urls: list[str]) -> list[dict]:
    """Fetch all URLs concurrently."""
    tasks = [fetch_data(url) for url in urls]
    return await asyncio.gather(*tasks)


async def fetch_with_timeout(url: str, timeout: float = 10.0) -> dict | None:
    """Fetch with timeout."""
    try:
        return await asyncio.wait_for(fetch_data(url), timeout=timeout)
    except asyncio.TimeoutError:
        return None


async def fetch_first(urls: list[str]) -> dict:
    """Return first successful result."""
    tasks = [asyncio.create_task(fetch_data(url)) for url in urls]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)

    # Cancel remaining tasks
    for task in pending:
        task.cancel()

    # Return first result
    return done.pop().result()


async def fetch_with_retry(
    url: str,
    max_retries: int = 3,
    delay: float = 1.0,
) -> dict:
    """Fetch with exponential backoff retry."""
    for attempt in range(max_retries):
        try:
            return await fetch_data(url)
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(delay * (2 ** attempt))
    raise RuntimeError("Unreachable")
```

### 4.3 Semaphore and Rate Limiting

```python
import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator


class RateLimiter:
    """Token bucket rate limiter."""

    def __init__(self, rate: float, capacity: int = 10) -> None:
        self.rate = rate  # tokens per second
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = asyncio.get_event_loop().time()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = asyncio.get_event_loop().time()
            elapsed = now - self.last_update
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.last_update = now

            if self.tokens < 1:
                wait_time = (1 - self.tokens) / self.rate
                await asyncio.sleep(wait_time)
                self.tokens = 0
            else:
                self.tokens -= 1


async def fetch_with_rate_limit(
    urls: list[str],
    max_concurrent: int = 10,
    rate: float = 5.0,
) -> list[dict]:
    """Fetch with concurrency and rate limiting."""
    semaphore = asyncio.Semaphore(max_concurrent)
    rate_limiter = RateLimiter(rate)

    async def limited_fetch(url: str) -> dict:
        async with semaphore:
            await rate_limiter.acquire()
            return await fetch_data(url)

    tasks = [limited_fetch(url) for url in urls]
    return await asyncio.gather(*tasks)
```

### 4.4 Async Context Managers

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator


@asynccontextmanager
async def managed_resource() -> AsyncIterator[Resource]:
    """Async context manager for resource management."""
    resource = await acquire_resource()
    try:
        yield resource
    finally:
        await resource.close()


@asynccontextmanager
async def database_transaction(session: AsyncSession) -> AsyncIterator[AsyncSession]:
    """Transaction context manager with rollback on error."""
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise


@asynccontextmanager
async def timing(name: str) -> AsyncIterator[None]:
    """Measure async operation timing."""
    import time
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        print(f"{name}: {elapsed:.3f}s")


# Usage
async with timing("database_query"):
    async with database_transaction(session) as tx:
        await tx.execute(query)
```

### 4.5 Async Generators

```python
from collections.abc import AsyncIterator


async def paginated_fetch(
    base_url: str,
    page_size: int = 100,
) -> AsyncIterator[dict]:
    """Async generator for paginated API."""
    page = 1
    while True:
        url = f"{base_url}?page={page}&limit={page_size}"
        data = await fetch_data(url)

        if not data.get("results"):
            break

        for item in data["results"]:
            yield item

        if not data.get("has_next"):
            break

        page += 1


async def stream_lines(path: str) -> AsyncIterator[str]:
    """Stream lines from file asynchronously."""
    async with aiofiles.open(path, "r") as f:
        async for line in f:
            yield line.strip()


async def batch_process(
    items: AsyncIterator[dict],
    batch_size: int = 100,
) -> AsyncIterator[list[dict]]:
    """Batch items from async iterator."""
    batch: list[dict] = []
    async for item in items:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


# Usage
async for batch in batch_process(paginated_fetch("/api/items")):
    await process_batch(batch)
```

### 4.6 Task Groups (Python 3.11+)

```python
import asyncio


async def process_all(items: list[str]) -> list[dict]:
    """Process items using task group."""
    results: list[dict] = []

    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(fetch_data(item)) for item in items]

    # All tasks completed successfully if we reach here
    return [task.result() for task in tasks]


async def process_with_error_handling(items: list[str]) -> list[dict | None]:
    """Process items with individual error handling."""
    async def safe_fetch(item: str) -> dict | None:
        try:
            return await fetch_data(item)
        except Exception as e:
            print(f"Failed to fetch {item}: {e}")
            return None

    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(safe_fetch(item)) for item in items]

    return [task.result() for task in tasks]
```

---

## 5. FastAPI Framework

### 5.1 Application Structure

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import settings
from .db import engine, create_tables
from .routers import users, items, auth
from .middleware import RequestLoggingMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan events."""
    # Startup
    print("Starting up...")
    await create_tables()

    yield

    # Shutdown
    print("Shutting down...")
    await engine.dispose()


def create_app() -> FastAPI:
    """Application factory."""
    app = FastAPI(
        title=settings.app_name,
        description="My API description",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs" if settings.debug else None,
        redoc_url="/api/redoc" if settings.debug else None,
        openapi_url="/api/openapi.json" if settings.debug else None,
    )

    # Middleware (order matters - last added is first executed)
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
    app.include_router(items.router, prefix="/api/v1/items", tags=["items"])

    return app


app = create_app()


@app.get("/health")
async def health_check() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/ready")
async def readiness_check() -> dict[str, str]:
    """Readiness check with dependency verification."""
    # Check database
    # Check external services
    return {"status": "ready"}
```

### 5.2 Dependency Injection

```python
from typing import Annotated
from fastapi import Depends, HTTPException, status, Query, Header
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .services import UserService
from .models import User

# Database dependency
async def get_db() -> AsyncIterator[AsyncSession]:
    """Yield database session."""
    async with get_session() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


# Service dependency
async def get_user_service(db: DbSession) -> UserService:
    """Get user service with database session."""
    return UserService(db)


UserServiceDep = Annotated[UserService, Depends(get_user_service)]


# Authentication
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    user_service: UserServiceDep,
) -> User:
    """Get current authenticated user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_id = decode_token(token)
    if user_id is None:
        raise credentials_exception

    user = await user_service.get(user_id)
    if user is None:
        raise credentials_exception

    return user


async def get_current_active_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Ensure user is active."""
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )
    return user


async def require_admin(
    user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Require admin role."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


# Type aliases for common dependencies
CurrentUser = Annotated[User, Depends(get_current_active_user)]
AdminUser = Annotated[User, Depends(require_admin)]


# Pagination dependency
async def pagination(
    skip: Annotated[int, Query(ge=0, description="Number of records to skip")] = 0,
    limit: Annotated[int, Query(ge=1, le=100, description="Max records")] = 20,
) -> dict[str, int]:
    """Common pagination parameters."""
    return {"skip": skip, "limit": limit}


PaginationParams = Annotated[dict[str, int], Depends(pagination)]
```

### 5.3 Router Patterns

```python
from fastapi import APIRouter, HTTPException, status, Path, Body
from typing import Annotated

from ..dependencies import DbSession, CurrentUser, AdminUser, PaginationParams
from ..schemas import UserResponse, UserCreate, UserUpdate, PaginatedResponse
from ..services import UserService

router = APIRouter()


@router.get("", response_model=PaginatedResponse[UserResponse])
async def list_users(
    db: DbSession,
    pagination: PaginationParams,
) -> PaginatedResponse[UserResponse]:
    """
    List all users with pagination.

    Returns paginated list of users.
    """
    service = UserService(db)
    users, total = await service.list(**pagination)
    return PaginatedResponse(
        items=users,
        total=total,
        page=pagination["skip"] // pagination["limit"] + 1,
        page_size=pagination["limit"],
        pages=(total + pagination["limit"] - 1) // pagination["limit"],
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: Annotated[int, Path(gt=0, description="User ID")],
    db: DbSession,
) -> UserResponse:
    """Get user by ID."""
    service = UserService(db)
    user = await service.get(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
    return user


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        201: {"description": "User created successfully"},
        409: {"description": "User with email already exists"},
    },
)
async def create_user(
    user_in: UserCreate,
    db: DbSession,
) -> UserResponse:
    """Create a new user."""
    service = UserService(db)

    # Check for existing user
    existing = await service.get_by_email(user_in.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with email {user_in.email} already exists",
        )

    return await service.create(user_in)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: Annotated[int, Path(gt=0)],
    user_in: UserUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> UserResponse:
    """Update user (owner or admin only)."""
    if current_user.id != user_id and not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this user",
        )

    service = UserService(db)
    user = await service.update(user_id, user_in)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    admin: AdminUser,
) -> None:
    """Delete user (admin only)."""
    service = UserService(db)
    deleted = await service.delete(user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
```

### 5.4 Error Handling

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
import logging

logger = logging.getLogger(__name__)


# Custom exceptions
class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        code: str | None = None,
        details: dict | None = None,
    ) -> None:
        self.message = message
        self.status_code = status_code
        self.code = code or "INTERNAL_ERROR"
        self.details = details or {}
        super().__init__(message)


class NotFoundError(AppException):
    """Resource not found."""

    def __init__(self, resource: str, identifier: int | str) -> None:
        super().__init__(
            message=f"{resource} not found",
            status_code=404,
            code="NOT_FOUND",
            details={"resource": resource, "id": identifier},
        )


class ConflictError(AppException):
    """Resource conflict."""

    def __init__(self, message: str) -> None:
        super().__init__(message=message, status_code=409, code="CONFLICT")


class AuthenticationError(AppException):
    """Authentication failed."""

    def __init__(self, message: str = "Authentication required") -> None:
        super().__init__(message=message, status_code=401, code="UNAUTHORIZED")


class AuthorizationError(AppException):
    """Authorization failed."""

    def __init__(self, message: str = "Permission denied") -> None:
        super().__init__(message=message, status_code=403, code="FORBIDDEN")


# Exception handlers
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Handle application exceptions."""
    logger.warning(f"AppException: {exc.code} - {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    """Handle request validation errors."""
    logger.warning(f"Validation error: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": exc.errors(),
            }
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle unexpected errors."""
    logger.exception(f"Unexpected error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
            }
        },
    )
```

### 5.5 Background Tasks

```python
from fastapi import BackgroundTasks


async def send_email(email: str, subject: str, body: str) -> None:
    """Send email in background."""
    # Email sending logic
    await email_client.send(to=email, subject=subject, body=body)


async def process_webhook(payload: dict) -> None:
    """Process webhook payload."""
    # Heavy processing
    await webhook_processor.process(payload)


@router.post("/users", response_model=UserResponse)
async def create_user(
    user_in: UserCreate,
    db: DbSession,
    background_tasks: BackgroundTasks,
) -> UserResponse:
    """Create user and send welcome email."""
    service = UserService(db)
    user = await service.create(user_in)

    # Add background task
    background_tasks.add_task(
        send_email,
        email=user.email,
        subject="Welcome!",
        body="Thanks for signing up!",
    )

    return user


@router.post("/webhooks/{provider}")
async def receive_webhook(
    provider: str,
    payload: dict,
    background_tasks: BackgroundTasks,
) -> dict:
    """Receive webhook and process in background."""
    background_tasks.add_task(process_webhook, payload)
    return {"status": "accepted"}
```

### 5.6 WebSocket Support

```python
from fastapi import WebSocket, WebSocketDisconnect
from typing import Any
import json


class ConnectionManager:
    """WebSocket connection manager."""

    def __init__(self) -> None:
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str) -> None:
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str) -> None:
        self.active_connections.pop(client_id, None)

    async def send_personal(self, message: Any, client_id: str) -> None:
        websocket = self.active_connections.get(client_id)
        if websocket:
            await websocket.send_json(message)

    async def broadcast(self, message: Any) -> None:
        for websocket in self.active_connections.values():
            await websocket.send_json(message)


manager = ConnectionManager()


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str) -> None:
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_json()
            # Process message
            response = {"received": data, "client": client_id}
            await manager.send_personal(response, client_id)
    except WebSocketDisconnect:
        manager.disconnect(client_id)
        await manager.broadcast({"event": "disconnect", "client": client_id})
```

---

## 6. Database Patterns

### 6.1 SQLAlchemy 2.0 Models

```python
from datetime import datetime
from sqlalchemy import String, ForeignKey, func
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    """Base class for all models."""
    pass


class TimestampMixin:
    """Mixin for timestamp columns."""

    created_at: Mapped[datetime] = mapped_column(
        default=func.now(),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        default=None,
        onupdate=func.now(),
    )


class User(TimestampMixin, Base):
    """User model."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    is_admin: Mapped[bool] = mapped_column(default=False)

    # Relationships
    posts: Mapped[list["Post"]] = relationship(
        back_populates="author",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"User(id={self.id}, email={self.email!r})"


class Post(TimestampMixin, Base):
    """Post model."""

    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str]
    published: Mapped[bool] = mapped_column(default=False)

    # Foreign key
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    # Relationship
    author: Mapped["User"] = relationship(back_populates="posts")

    # Many-to-many
    tags: Mapped[list["Tag"]] = relationship(
        secondary="post_tags",
        back_populates="posts",
    )


class Tag(Base):
    """Tag model."""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)

    posts: Mapped[list["Post"]] = relationship(
        secondary="post_tags",
        back_populates="tags",
    )


# Association table
from sqlalchemy import Table, Column, Integer

post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", Integer, ForeignKey("posts.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)
```

### 6.2 Async Database Session

```python
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)

from .config import settings

# Create async engine
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=5,
    max_overflow=10,
)

# Session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@asynccontextmanager
async def get_session() -> AsyncIterator[AsyncSession]:
    """Get database session with automatic cleanup."""
    async with async_session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def create_tables() -> None:
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

### 6.3 Repository Pattern

```python
from typing import TypeVar, Generic
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Base

T = TypeVar("T", bound=Base)


class BaseRepository(Generic[T]):
    """Generic repository with CRUD operations."""

    def __init__(self, session: AsyncSession, model: type[T]) -> None:
        self.session = session
        self.model = model

    async def get(self, id: int) -> T | None:
        """Get by ID."""
        return await self.session.get(self.model, id)

    async def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[T], int]:
        """Get all with pagination."""
        # Count total
        count_query = select(func.count()).select_from(self.model)
        total = (await self.session.execute(count_query)).scalar() or 0

        # Get items
        query = select(self.model).offset(skip).limit(limit)
        result = await self.session.execute(query)
        items = list(result.scalars().all())

        return items, total

    async def create(self, obj: T) -> T:
        """Create new entity."""
        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def update(self, obj: T) -> T:
        """Update entity."""
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def delete(self, obj: T) -> None:
        """Delete entity."""
        await self.session.delete(obj)
        await self.session.commit()


class UserRepository(BaseRepository[User]):
    """User-specific repository."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, User)

    async def get_by_email(self, email: str) -> User | None:
        """Get user by email."""
        query = select(User).where(User.email == email)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_active_users(self) -> list[User]:
        """Get all active users."""
        query = select(User).where(User.is_active == True)
        result = await self.session.execute(query)
        return list(result.scalars().all())
```

### 6.4 Alembic Migrations

```python
# alembic/env.py
import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

from myapp.config import settings
from myapp.db.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

---

## 7. Testing Strategies

### 7.1 Test Organization

```
tests/
├── __init__.py
├── conftest.py              # Shared fixtures
├── unit/
│   ├── __init__.py
│   ├── test_models.py
│   ├── test_services.py
│   └── test_utils.py
├── integration/
│   ├── __init__.py
│   ├── test_api.py
│   ├── test_database.py
│   └── test_external.py
└── e2e/
    ├── __init__.py
    └── test_workflows.py
```

### 7.2 Fixtures (conftest.py)

```python
import pytest
import pytest_asyncio
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

from myapp.main import app
from myapp.db.session import get_session
from myapp.db.models import Base


@pytest.fixture
def anyio_backend() -> str:
    """Configure anyio backend."""
    return "asyncio"


@pytest_asyncio.fixture
async def test_db() -> AsyncIterator[AsyncSession]:
    """Create test database."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSession(engine) as session:
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def async_client(test_db: AsyncSession) -> AsyncIterator[AsyncClient]:
    """Create async test client."""

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        yield test_db

    app.dependency_overrides[get_session] = override_get_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture
def mock_user() -> dict:
    """Sample user data."""
    return {
        "email": "test@example.com",
        "name": "Test User",
        "password": "SecurePass123",
    }


@pytest.fixture
def mock_email_service() -> AsyncMock:
    """Mock email service."""
    return AsyncMock()
```

### 7.3 Unit Tests

```python
import pytest
from unittest.mock import AsyncMock, patch
from datetime import datetime

from myapp.services import UserService
from myapp.models import User
from myapp.schemas import UserCreate


class TestUserService:
    """User service unit tests."""

    @pytest.fixture
    def mock_repo(self) -> AsyncMock:
        return AsyncMock()

    @pytest.fixture
    def service(self, mock_repo: AsyncMock) -> UserService:
        return UserService(mock_repo)

    async def test_create_user_success(
        self,
        service: UserService,
        mock_repo: AsyncMock,
    ) -> None:
        """Test successful user creation."""
        # Arrange
        user_in = UserCreate(
            email="test@example.com",
            name="Test",
            password="SecurePass123",
        )
        expected = User(
            id=1,
            email=user_in.email,
            name=user_in.name,
            created_at=datetime.now(),
        )
        mock_repo.create.return_value = expected

        # Act
        result = await service.create(user_in)

        # Assert
        assert result.id == 1
        assert result.email == user_in.email
        mock_repo.create.assert_called_once()

    async def test_create_user_duplicate_email(
        self,
        service: UserService,
        mock_repo: AsyncMock,
    ) -> None:
        """Test duplicate email handling."""
        # Arrange
        user_in = UserCreate(
            email="existing@example.com",
            name="Test",
            password="SecurePass123",
        )
        mock_repo.get_by_email.return_value = User(
            id=1,
            email=user_in.email,
            name="Existing",
        )

        # Act & Assert
        with pytest.raises(ConflictError, match="already exists"):
            await service.create(user_in)

    async def test_get_user_not_found(
        self,
        service: UserService,
        mock_repo: AsyncMock,
    ) -> None:
        """Test user not found."""
        mock_repo.get.return_value = None

        result = await service.get(999)

        assert result is None
        mock_repo.get.assert_called_once_with(999)
```

### 7.4 Integration Tests

```python
import pytest
from httpx import AsyncClient


class TestUserAPI:
    """User API integration tests."""

    @pytest.mark.asyncio
    async def test_create_user_success(
        self,
        async_client: AsyncClient,
        mock_user: dict,
    ) -> None:
        """Test user creation via API."""
        response = await async_client.post("/api/v1/users", json=mock_user)

        assert response.status_code == 201
        data = response.json()
        assert data["email"] == mock_user["email"]
        assert data["name"] == mock_user["name"]
        assert "id" in data
        assert "password" not in data
        assert "hashed_password" not in data

    @pytest.mark.asyncio
    async def test_create_user_invalid_email(
        self,
        async_client: AsyncClient,
    ) -> None:
        """Test validation for invalid email."""
        response = await async_client.post(
            "/api/v1/users",
            json={
                "email": "invalid-email",
                "name": "Test",
                "password": "SecurePass123",
            },
        )

        assert response.status_code == 422
        data = response.json()
        assert "error" in data

    @pytest.mark.asyncio
    async def test_get_user_not_found(
        self,
        async_client: AsyncClient,
    ) -> None:
        """Test 404 for non-existent user."""
        response = await async_client.get("/api/v1/users/99999")

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_list_users_pagination(
        self,
        async_client: AsyncClient,
    ) -> None:
        """Test user listing with pagination."""
        # Create multiple users
        for i in range(5):
            await async_client.post(
                "/api/v1/users",
                json={
                    "email": f"user{i}@example.com",
                    "name": f"User {i}",
                    "password": "SecurePass123",
                },
            )

        # Test pagination
        response = await async_client.get("/api/v1/users?limit=2&skip=0")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["total"] == 5
```

### 7.5 Parametrized Tests

```python
import pytest
from myapp.utils import validate_email, parse_date


@pytest.mark.parametrize(
    "email,expected",
    [
        ("user@example.com", True),
        ("user.name@domain.org", True),
        ("user+tag@example.com", True),
        ("invalid", False),
        ("@nodomain.com", False),
        ("user@", False),
        ("", False),
    ],
    ids=[
        "simple_valid",
        "dot_in_local",
        "plus_addressing",
        "no_at_sign",
        "no_local_part",
        "no_domain",
        "empty_string",
    ],
)
def test_validate_email(email: str, expected: bool) -> None:
    """Test email validation with various inputs."""
    assert validate_email(email) == expected


@pytest.mark.parametrize(
    "date_str,expected_year,expected_month",
    [
        ("2024-01-15", 2024, 1),
        ("2024-12-31", 2024, 12),
        pytest.param(
            "2024-02-29",
            2024,
            2,
            id="leap_year",
        ),
    ],
)
def test_parse_date(
    date_str: str,
    expected_year: int,
    expected_month: int,
) -> None:
    """Test date parsing."""
    result = parse_date(date_str)
    assert result.year == expected_year
    assert result.month == expected_month


@pytest.mark.parametrize(
    "invalid_date",
    [
        "not-a-date",
        "2024/01/15",
        "01-15-2024",
        "",
    ],
)
def test_parse_date_invalid(invalid_date: str) -> None:
    """Test date parsing with invalid inputs."""
    with pytest.raises(ValueError):
        parse_date(invalid_date)
```

---

## 8. Error Handling

### 8.1 Exception Hierarchy

```python
from typing import Any


class AppError(Exception):
    """Base application error."""

    def __init__(
        self,
        message: str,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message
        self.code = code or self.__class__.__name__
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


# Domain errors
class DomainError(AppError):
    """Domain-specific error."""
    pass


class ValidationError(DomainError):
    """Input validation error."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(
            message=f"{field}: {message}",
            code="VALIDATION_ERROR",
            details={"field": field},
        )


class NotFoundError(DomainError):
    """Resource not found."""

    def __init__(self, resource: str, identifier: Any) -> None:
        super().__init__(
            message=f"{resource} not found",
            code="NOT_FOUND",
            details={"resource": resource, "id": identifier},
        )


class ConflictError(DomainError):
    """Resource conflict."""

    def __init__(self, message: str, resource: str | None = None) -> None:
        super().__init__(
            message=message,
            code="CONFLICT",
            details={"resource": resource} if resource else {},
        )


# Infrastructure errors
class InfrastructureError(AppError):
    """Infrastructure-level error."""
    pass


class DatabaseError(InfrastructureError):
    """Database operation error."""
    pass


class ExternalServiceError(InfrastructureError):
    """External service error."""

    def __init__(
        self,
        service: str,
        message: str,
        status_code: int | None = None,
    ) -> None:
        super().__init__(
            message=f"{service}: {message}",
            code="EXTERNAL_SERVICE_ERROR",
            details={
                "service": service,
                "status_code": status_code,
            },
        )


# Security errors
class SecurityError(AppError):
    """Security-related error."""
    pass


class AuthenticationError(SecurityError):
    """Authentication failed."""

    def __init__(self, message: str = "Authentication required") -> None:
        super().__init__(message=message, code="UNAUTHORIZED")


class AuthorizationError(SecurityError):
    """Authorization failed."""

    def __init__(self, message: str = "Permission denied") -> None:
        super().__init__(message=message, code="FORBIDDEN")
```

### 8.2 Result Type Pattern

```python
from dataclasses import dataclass
from typing import TypeVar, Generic, Callable

T = TypeVar("T")
E = TypeVar("E", bound=Exception)
U = TypeVar("U")


@dataclass(frozen=True)
class Ok(Generic[T]):
    """Success result."""

    value: T

    def is_ok(self) -> bool:
        return True

    def is_err(self) -> bool:
        return False

    def unwrap(self) -> T:
        return self.value

    def unwrap_or(self, default: T) -> T:
        return self.value

    def map(self, func: Callable[[T], U]) -> "Result[U, E]":
        return Ok(func(self.value))

    def and_then(self, func: Callable[[T], "Result[U, E]"]) -> "Result[U, E]":
        return func(self.value)


@dataclass(frozen=True)
class Err(Generic[E]):
    """Error result."""

    error: E

    def is_ok(self) -> bool:
        return False

    def is_err(self) -> bool:
        return True

    def unwrap(self) -> None:
        raise self.error

    def unwrap_or(self, default: T) -> T:
        return default

    def map(self, func: Callable[[T], U]) -> "Result[U, E]":
        return self  # type: ignore

    def and_then(self, func: Callable[[T], "Result[U, E]"]) -> "Result[U, E]":
        return self  # type: ignore


Result = Ok[T] | Err[E]


# Usage
def divide(a: float, b: float) -> Result[float, ValueError]:
    if b == 0:
        return Err(ValueError("Division by zero"))
    return Ok(a / b)


def parse_int(s: str) -> Result[int, ValueError]:
    try:
        return Ok(int(s))
    except ValueError as e:
        return Err(e)


# Chaining
result = (
    parse_int("42")
    .and_then(lambda x: divide(100, x))
    .map(lambda x: round(x, 2))
)

match result:
    case Ok(value):
        print(f"Result: {value}")
    case Err(error):
        print(f"Error: {error}")
```

---

## 9. Performance Optimization

### 9.1 Profiling

```python
import cProfile
import pstats
from functools import wraps
from time import perf_counter
from typing import Callable, TypeVar, ParamSpec
import logging

P = ParamSpec("P")
T = TypeVar("T")

logger = logging.getLogger(__name__)


def timed(func: Callable[P, T]) -> Callable[P, T]:
    """Decorator to measure function execution time."""

    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        start = perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            elapsed = perf_counter() - start
            logger.info(f"{func.__name__} took {elapsed:.3f}s")

    return wrapper


def profile(func: Callable[P, T]) -> Callable[P, T]:
    """Decorator to profile function with cProfile."""

    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        profiler = cProfile.Profile()
        try:
            return profiler.runcall(func, *args, **kwargs)
        finally:
            stats = pstats.Stats(profiler)
            stats.strip_dirs()
            stats.sort_stats("cumulative")
            stats.print_stats(20)

    return wrapper


# Async version
def async_timed(func: Callable[P, T]) -> Callable[P, T]:
    """Decorator to measure async function execution time."""

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
        start = perf_counter()
        try:
            return await func(*args, **kwargs)
        finally:
            elapsed = perf_counter() - start
            logger.info(f"{func.__name__} took {elapsed:.3f}s")

    return wrapper
```

### 9.2 Caching

```python
from functools import lru_cache, cache
from typing import TypeVar, Callable, Any
import asyncio
from datetime import datetime, timedelta

T = TypeVar("T")


# Simple LRU cache
@lru_cache(maxsize=128)
def expensive_computation(n: int) -> int:
    """Cached expensive computation."""
    return sum(i * i for i in range(n))


# Unlimited cache (Python 3.9+)
@cache
def parse_config(path: str) -> dict:
    """Cache config file parsing."""
    with open(path) as f:
        return json.load(f)


# TTL cache for async functions
class TTLCache:
    """Time-based cache."""

    def __init__(self, ttl_seconds: int = 300) -> None:
        self._cache: dict[str, tuple[Any, datetime]] = {}
        self._ttl = timedelta(seconds=ttl_seconds)

    def get(self, key: str) -> Any | None:
        if key in self._cache:
            value, timestamp = self._cache[key]
            if datetime.now() - timestamp < self._ttl:
                return value
            del self._cache[key]
        return None

    def set(self, key: str, value: Any) -> None:
        self._cache[key] = (value, datetime.now())

    def clear(self) -> None:
        self._cache.clear()


def async_cached(ttl_seconds: int = 300):
    """Async caching decorator with TTL."""
    cache = TTLCache(ttl_seconds)

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            key = f"{func.__name__}:{args}:{kwargs}"
            cached = cache.get(key)
            if cached is not None:
                return cached
            result = await func(*args, **kwargs)
            cache.set(key, result)
            return result
        return wrapper
    return decorator


@async_cached(ttl_seconds=60)
async def fetch_user(user_id: int) -> dict:
    """Cached user fetch."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"/api/users/{user_id}")
        return response.json()
```

### 9.3 Connection Pooling

```python
import httpx
from sqlalchemy.ext.asyncio import create_async_engine


# Database connection pool
engine = create_async_engine(
    "postgresql+asyncpg://user:pass@localhost/db",
    pool_size=10,           # Maintain 10 connections
    max_overflow=20,        # Allow up to 20 additional
    pool_timeout=30,        # Wait 30s for connection
    pool_recycle=1800,      # Recycle connections after 30min
    pool_pre_ping=True,     # Check connections before use
)


# HTTP client with connection pooling
class HTTPClientPool:
    """Singleton HTTP client with connection pooling."""

    _instance: "HTTPClientPool | None" = None
    _client: httpx.AsyncClient | None = None

    def __new__(cls) -> "HTTPClientPool":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    async def get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                limits=httpx.Limits(
                    max_connections=100,
                    max_keepalive_connections=20,
                    keepalive_expiry=30.0,
                ),
                timeout=httpx.Timeout(30.0, connect=10.0),
            )
        return self._client

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None


http_pool = HTTPClientPool()
```

### 9.4 Async Best Practices

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor


# Run blocking code in executor
async def run_blocking(func: Callable[..., T], *args) -> T:
    """Run blocking function in thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, func, *args)


# With custom executor
executor = ThreadPoolExecutor(max_workers=10)


async def run_cpu_bound(func: Callable[..., T], *args) -> T:
    """Run CPU-bound function in thread pool."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(executor, func, *args)


# Batch processing with concurrency limit
async def process_batch(
    items: list[str],
    processor: Callable[[str], Awaitable[dict]],
    max_concurrent: int = 10,
) -> list[dict]:
    """Process items with limited concurrency."""
    semaphore = asyncio.Semaphore(max_concurrent)

    async def process_with_limit(item: str) -> dict:
        async with semaphore:
            return await processor(item)

    return await asyncio.gather(
        *(process_with_limit(item) for item in items)
    )


# Avoid blocking the event loop
# BAD
async def bad_example() -> str:
    return open("file.txt").read()  # Blocking!

# GOOD
async def good_example() -> str:
    return await run_blocking(lambda: open("file.txt").read())

# BETTER - use async file I/O
async def better_example() -> str:
    async with aiofiles.open("file.txt") as f:
        return await f.read()
```

---

## 10. Best Practices

### 10.1 Code Style (PEP 8 + Modern Patterns)

```python
# Imports - grouped and sorted
from __future__ import annotations  # Always first

import json  # Standard library
import os
from datetime import datetime
from typing import TYPE_CHECKING

import httpx  # Third-party
from pydantic import BaseModel

from myapp.config import settings  # Local
from myapp.models import User

if TYPE_CHECKING:  # Type-only imports
    from myapp.services import UserService


# Constants - UPPER_SNAKE_CASE
MAX_RETRIES = 3
DEFAULT_TIMEOUT = 30.0


# Classes - PascalCase
class UserService:
    """Service for user operations.

    Attributes:
        db: Database session.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_user(self, user_id: int) -> User | None:
        """Get user by ID.

        Args:
            user_id: The user's ID.

        Returns:
            The user if found, None otherwise.

        Raises:
            DatabaseError: If database operation fails.
        """
        return await self.db.get(User, user_id)


# Functions - snake_case with type hints
def calculate_discount(price: float, percentage: float) -> float:
    """Calculate discounted price.

    Args:
        price: Original price.
        percentage: Discount percentage (0-100).

    Returns:
        Discounted price.
    """
    return price * (1 - percentage / 100)
```

### 10.2 Security Best Practices

```python
from secrets import token_urlsafe, compare_digest
import hashlib
import hmac

# Generate secure tokens
def generate_token(length: int = 32) -> str:
    """Generate cryptographically secure token."""
    return token_urlsafe(length)


# Secure password hashing (use passlib or bcrypt in production)
def hash_password(password: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
    """Hash password with salt."""
    if salt is None:
        salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode(),
        salt,
        100000,  # Iterations
    )
    return key, salt


def verify_password(password: str, key: bytes, salt: bytes) -> bool:
    """Verify password against hash."""
    new_key, _ = hash_password(password, salt)
    return compare_digest(key, new_key)


# Secure comparison (constant time)
def secure_compare(a: str, b: str) -> bool:
    """Compare strings in constant time to prevent timing attacks."""
    return compare_digest(a.encode(), b.encode())


# Input validation
from pydantic import BaseModel, Field, EmailStr


class UserInput(BaseModel):
    """Validated user input."""

    email: EmailStr
    name: str = Field(..., min_length=1, max_length=100, pattern=r"^[\w\s-]+$")
    age: int = Field(..., ge=0, le=150)


# SQL injection prevention (use parameterized queries)
# BAD
query = f"SELECT * FROM users WHERE email = '{email}'"

# GOOD - SQLAlchemy
result = await session.execute(
    select(User).where(User.email == email)
)


# Environment variables for secrets
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = Field(..., min_length=32)
    database_url: str

    model_config = {"env_file": ".env"}
```

### 10.3 Logging Best Practices

```python
import logging
import structlog
from typing import Any

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logger = structlog.get_logger()


# Usage
async def create_user(user_data: dict) -> User:
    log = logger.bind(email=user_data["email"])
    log.info("creating_user")

    try:
        user = await user_service.create(user_data)
        log.info("user_created", user_id=user.id)
        return user
    except Exception as e:
        log.error("user_creation_failed", error=str(e))
        raise


# Request logging middleware
from starlette.middleware.base import BaseHTTPMiddleware
import time


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        log = logger.bind(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start = time.perf_counter()
        log.info("request_started")

        try:
            response = await call_next(request)
            elapsed = time.perf_counter() - start
            log.info(
                "request_completed",
                status_code=response.status_code,
                duration_ms=round(elapsed * 1000, 2),
            )
            return response
        except Exception as e:
            elapsed = time.perf_counter() - start
            log.error(
                "request_failed",
                error=str(e),
                duration_ms=round(elapsed * 1000, 2),
            )
            raise
```

### 10.4 Configuration Management

```python
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings from environment."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "My App"
    debug: bool = False
    environment: str = Field(default="development", pattern=r"^(development|staging|production)$")

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    workers: int = Field(default=1, ge=1, le=32)

    # Database
    database_url: str = Field(..., alias="DATABASE_URL")
    db_pool_size: int = Field(default=5, ge=1, le=100)
    db_max_overflow: int = Field(default=10, ge=0, le=100)

    # Security
    secret_key: str = Field(..., min_length=32)
    access_token_expire_minutes: int = 30
    allowed_origins: list[str] = ["http://localhost:3000"]

    # External services
    redis_url: str | None = None
    sentry_dsn: str | None = None

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


# Singleton settings
settings = Settings()
```

---

## Context7 Integration Reference

For advanced topics beyond this guide, use Context7 MCP:

| Topic | Library | Query Example |
|-------|---------|---------------|
| FastAPI advanced | `fastapi` | "WebSocket authentication" |
| Pydantic validators | `pydantic` | "custom validators v2" |
| SQLAlchemy 2.0 | `sqlalchemy` | "async session scoped" |
| Alembic migrations | `alembic` | "autogenerate revisions" |
| pytest plugins | `pytest` | "fixtures parametrize" |
| httpx streaming | `httpx` | "async streaming response" |
| Celery tasks | `celery` | "task retry backoff" |
| Redis caching | `redis-py` | "async connection pool" |

---

## See Also

- **[SKILL.md](SKILL.md)** - Quick reference for common patterns
- **[templates/](templates/)** - Code generation templates
- **[examples/](examples/)** - Real-world implementation examples

---

**Version**: 1.0.0 | **Last Updated**: 2025-12-31 | **Status**: Production Ready
