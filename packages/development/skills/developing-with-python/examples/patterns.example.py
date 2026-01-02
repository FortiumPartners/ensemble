"""Design Patterns in Python.

This example demonstrates common design patterns used in production
Python applications, particularly for backend services.

Patterns covered:
1. Repository Pattern - Data access abstraction
2. Service Layer Pattern - Business logic encapsulation
3. Unit of Work Pattern - Transaction management
4. Factory Pattern - Object creation
5. Strategy Pattern - Interchangeable algorithms
6. Dependency Injection - Loose coupling

Run this example:
    python examples/patterns.example.py
"""
from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import TypeVar, Generic, Protocol, Callable, Any
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# Domain Models
# =============================================================================


@dataclass
class Entity:
    """Base entity with common fields."""

    id: int | None = None
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime | None = None


@dataclass
class User(Entity):
    """User domain entity."""

    email: str = ""
    name: str = ""
    is_active: bool = True
    roles: list[str] = field(default_factory=list)

    def activate(self) -> None:
        """Activate the user."""
        self.is_active = True
        self.updated_at = datetime.now()

    def deactivate(self) -> None:
        """Deactivate the user."""
        self.is_active = False
        self.updated_at = datetime.now()

    def add_role(self, role: str) -> None:
        """Add a role to the user."""
        if role not in self.roles:
            self.roles.append(role)
            self.updated_at = datetime.now()


@dataclass
class Order(Entity):
    """Order domain entity."""

    user_id: int = 0
    items: list[dict] = field(default_factory=list)
    status: str = "pending"
    total: float = 0.0

    def calculate_total(self) -> float:
        """Calculate order total."""
        self.total = sum(item.get("price", 0) * item.get("quantity", 1) for item in self.items)
        return self.total


# =============================================================================
# Pattern 1: Repository Pattern
# =============================================================================

T = TypeVar("T", bound=Entity)


class Repository(ABC, Generic[T]):
    """Abstract repository defining data access contract.

    The Repository pattern mediates between the domain and data mapping
    layers using a collection-like interface for accessing domain objects.
    """

    @abstractmethod
    async def get(self, id: int) -> T | None:
        """Get entity by ID."""
        ...

    @abstractmethod
    async def get_all(self, skip: int = 0, limit: int = 100) -> list[T]:
        """Get all entities with pagination."""
        ...

    @abstractmethod
    async def add(self, entity: T) -> T:
        """Add a new entity."""
        ...

    @abstractmethod
    async def update(self, entity: T) -> T:
        """Update an existing entity."""
        ...

    @abstractmethod
    async def delete(self, entity: T) -> None:
        """Delete an entity."""
        ...


class InMemoryRepository(Repository[T]):
    """In-memory repository implementation for testing."""

    def __init__(self) -> None:
        self._storage: dict[int, T] = {}
        self._next_id = 1

    async def get(self, id: int) -> T | None:
        return self._storage.get(id)

    async def get_all(self, skip: int = 0, limit: int = 100) -> list[T]:
        items = list(self._storage.values())
        return items[skip : skip + limit]

    async def add(self, entity: T) -> T:
        entity.id = self._next_id
        self._next_id += 1
        self._storage[entity.id] = entity
        return entity

    async def update(self, entity: T) -> T:
        if entity.id is None or entity.id not in self._storage:
            raise ValueError(f"Entity not found: {entity.id}")
        entity.updated_at = datetime.now()
        self._storage[entity.id] = entity
        return entity

    async def delete(self, entity: T) -> None:
        if entity.id is not None and entity.id in self._storage:
            del self._storage[entity.id]


class UserRepository(InMemoryRepository[User]):
    """User-specific repository with additional queries."""

    async def get_by_email(self, email: str) -> User | None:
        """Find user by email."""
        for user in self._storage.values():
            if user.email == email:
                return user
        return None

    async def get_active_users(self) -> list[User]:
        """Get all active users."""
        return [u for u in self._storage.values() if u.is_active]


# =============================================================================
# Pattern 2: Unit of Work Pattern
# =============================================================================


class UnitOfWork(Protocol):
    """Unit of Work protocol for transaction management.

    The Unit of Work pattern maintains a list of objects affected by a
    business transaction and coordinates the writing out of changes.
    """

    users: UserRepository

    async def __aenter__(self) -> "UnitOfWork":
        ...

    async def __aexit__(self, *args: Any) -> None:
        ...

    async def commit(self) -> None:
        ...

    async def rollback(self) -> None:
        ...


class InMemoryUnitOfWork:
    """In-memory Unit of Work implementation."""

    def __init__(self) -> None:
        self.users = UserRepository()
        self._committed = False

    async def __aenter__(self) -> "InMemoryUnitOfWork":
        logger.debug("Starting unit of work")
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type is not None:
            await self.rollback()
        logger.debug("Ending unit of work")

    async def commit(self) -> None:
        """Commit all changes."""
        self._committed = True
        logger.info("Changes committed")

    async def rollback(self) -> None:
        """Rollback all changes."""
        logger.warning("Changes rolled back")


# =============================================================================
# Pattern 3: Service Layer Pattern
# =============================================================================


class UserService:
    """Service layer for user business logic.

    The Service Layer pattern defines an application's boundary with a
    layer of services that establishes a set of available operations.
    """

    def __init__(self, uow: UnitOfWork) -> None:
        self.uow = uow

    async def create_user(self, email: str, name: str) -> User:
        """Create a new user with validation."""
        async with self.uow:
            # Check for existing user
            existing = await self.uow.users.get_by_email(email)
            if existing:
                raise ValueError(f"User with email {email} already exists")

            # Create user
            user = User(email=email, name=name)
            user = await self.uow.users.add(user)

            await self.uow.commit()
            logger.info("Created user: %s", user.email)
            return user

    async def get_user(self, user_id: int) -> User | None:
        """Get user by ID."""
        return await self.uow.users.get(user_id)

    async def activate_user(self, user_id: int) -> User:
        """Activate a user."""
        async with self.uow:
            user = await self.uow.users.get(user_id)
            if not user:
                raise ValueError(f"User not found: {user_id}")

            user.activate()
            user = await self.uow.users.update(user)

            await self.uow.commit()
            logger.info("Activated user: %s", user.email)
            return user

    async def deactivate_user(self, user_id: int) -> User:
        """Deactivate a user."""
        async with self.uow:
            user = await self.uow.users.get(user_id)
            if not user:
                raise ValueError(f"User not found: {user_id}")

            user.deactivate()
            user = await self.uow.users.update(user)

            await self.uow.commit()
            logger.info("Deactivated user: %s", user.email)
            return user


# =============================================================================
# Pattern 4: Factory Pattern
# =============================================================================


class NotificationFactory:
    """Factory for creating notification objects.

    The Factory pattern provides an interface for creating objects
    without specifying their concrete classes.
    """

    @staticmethod
    def create(notification_type: str, **kwargs: Any) -> "Notification":
        """Create a notification of the specified type."""
        factories: dict[str, type[Notification]] = {
            "email": EmailNotification,
            "sms": SMSNotification,
            "push": PushNotification,
        }

        factory = factories.get(notification_type)
        if not factory:
            raise ValueError(f"Unknown notification type: {notification_type}")

        return factory(**kwargs)


@dataclass
class Notification(ABC):
    """Base notification class."""

    recipient: str
    message: str

    @abstractmethod
    async def send(self) -> bool:
        """Send the notification."""
        ...


@dataclass
class EmailNotification(Notification):
    """Email notification."""

    subject: str = ""

    async def send(self) -> bool:
        logger.info("Sending email to %s: %s", self.recipient, self.subject)
        # Email sending logic here
        return True


@dataclass
class SMSNotification(Notification):
    """SMS notification."""

    async def send(self) -> bool:
        logger.info("Sending SMS to %s", self.recipient)
        # SMS sending logic here
        return True


@dataclass
class PushNotification(Notification):
    """Push notification."""

    title: str = ""

    async def send(self) -> bool:
        logger.info("Sending push to %s: %s", self.recipient, self.title)
        # Push notification logic here
        return True


# =============================================================================
# Pattern 5: Strategy Pattern
# =============================================================================


class PricingStrategy(Protocol):
    """Strategy for calculating prices.

    The Strategy pattern defines a family of algorithms, encapsulates
    each one, and makes them interchangeable.
    """

    def calculate(self, base_price: float, quantity: int) -> float:
        """Calculate the final price."""
        ...


class RegularPricing:
    """Regular pricing with no discount."""

    def calculate(self, base_price: float, quantity: int) -> float:
        return base_price * quantity


class BulkPricing:
    """Bulk pricing with volume discount."""

    def __init__(self, discount_threshold: int = 10, discount_percent: float = 10) -> None:
        self.discount_threshold = discount_threshold
        self.discount_percent = discount_percent

    def calculate(self, base_price: float, quantity: int) -> float:
        total = base_price * quantity
        if quantity >= self.discount_threshold:
            total *= 1 - (self.discount_percent / 100)
        return total


class PremiumPricing:
    """Premium pricing with fixed discount."""

    def __init__(self, discount_percent: float = 15) -> None:
        self.discount_percent = discount_percent

    def calculate(self, base_price: float, quantity: int) -> float:
        total = base_price * quantity
        return total * (1 - self.discount_percent / 100)


class PriceCalculator:
    """Calculator that uses pricing strategies."""

    def __init__(self, strategy: PricingStrategy) -> None:
        self.strategy = strategy

    def set_strategy(self, strategy: PricingStrategy) -> None:
        """Change the pricing strategy."""
        self.strategy = strategy

    def calculate_price(self, base_price: float, quantity: int) -> float:
        """Calculate price using current strategy."""
        return self.strategy.calculate(base_price, quantity)


# =============================================================================
# Pattern 6: Dependency Injection
# =============================================================================


class Container:
    """Simple dependency injection container.

    Dependency Injection is a technique where objects receive their
    dependencies from external sources rather than creating them.
    """

    _instances: dict[type, Any] = {}
    _factories: dict[type, Callable[[], Any]] = {}

    @classmethod
    def register(cls, interface: type, factory: Callable[[], Any]) -> None:
        """Register a factory for a type."""
        cls._factories[interface] = factory

    @classmethod
    def register_instance(cls, interface: type, instance: Any) -> None:
        """Register a singleton instance."""
        cls._instances[interface] = instance

    @classmethod
    def resolve(cls, interface: type[T]) -> T:
        """Resolve a dependency."""
        # Check for singleton instance
        if interface in cls._instances:
            return cls._instances[interface]

        # Check for factory
        if interface in cls._factories:
            instance = cls._factories[interface]()
            return instance

        raise ValueError(f"No registration found for {interface}")

    @classmethod
    def clear(cls) -> None:
        """Clear all registrations."""
        cls._instances.clear()
        cls._factories.clear()


def inject(interface: type[T]) -> T:
    """Decorator helper for dependency injection."""
    return Container.resolve(interface)


# =============================================================================
# Example Usage
# =============================================================================


async def main() -> None:
    """Demonstrate all patterns."""
    print("=" * 60)
    print("Design Patterns Example")
    print("=" * 60)

    # Setup dependency injection
    uow = InMemoryUnitOfWork()
    Container.register_instance(UnitOfWork, uow)
    Container.register(UserService, lambda: UserService(Container.resolve(UnitOfWork)))

    # 1. Repository & Service Layer
    print("\n1. Repository & Service Layer Pattern")
    print("-" * 40)

    user_service = Container.resolve(UserService)

    # Create users
    user1 = await user_service.create_user("alice@example.com", "Alice")
    user2 = await user_service.create_user("bob@example.com", "Bob")
    print(f"Created users: {user1.name}, {user2.name}")

    # Deactivate user
    user1 = await user_service.deactivate_user(user1.id)
    print(f"Deactivated: {user1.name}, active={user1.is_active}")

    # 2. Factory Pattern
    print("\n2. Factory Pattern")
    print("-" * 40)

    email = NotificationFactory.create(
        "email",
        recipient="user@example.com",
        message="Hello!",
        subject="Welcome",
    )
    await email.send()

    sms = NotificationFactory.create(
        "sms",
        recipient="+1234567890",
        message="Your code is 123456",
    )
    await sms.send()

    # 3. Strategy Pattern
    print("\n3. Strategy Pattern")
    print("-" * 40)

    calculator = PriceCalculator(RegularPricing())

    base_price = 10.0
    quantity = 15

    # Regular pricing
    print(f"Regular: ${calculator.calculate_price(base_price, quantity):.2f}")

    # Switch to bulk pricing
    calculator.set_strategy(BulkPricing(discount_threshold=10, discount_percent=10))
    print(f"Bulk: ${calculator.calculate_price(base_price, quantity):.2f}")

    # Switch to premium pricing
    calculator.set_strategy(PremiumPricing(discount_percent=15))
    print(f"Premium: ${calculator.calculate_price(base_price, quantity):.2f}")

    print("\n" + "=" * 60)
    print("All patterns demonstrated successfully!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
