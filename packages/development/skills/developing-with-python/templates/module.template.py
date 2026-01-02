"""{{description}}

This module provides {{module_name}} functionality.

Example:
    >>> from {{module_name}} import {{ModuleName}}
    >>> obj = {{ModuleName}}(name="example")
    >>> obj.process()
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

__all__ = ["{{ModuleName}}", "{{ModuleName}}Error", "process_{{module_name}}"]

logger = logging.getLogger(__name__)


class {{ModuleName}}Error(Exception):
    """Exception raised for {{module_name}} errors.

    Attributes:
        message: Explanation of the error.
        details: Additional error details.
    """

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        self.message = message
        self.details = details or {}
        super().__init__(message)


@dataclass
class {{ModuleName}}:
    """Represents a {{module_name}} entity.

    Attributes:
        id: Unique identifier.
        name: Display name.
        created_at: Creation timestamp.
        metadata: Additional metadata.
    """

    id: int | None = None
    name: str = ""
    created_at: datetime = field(default_factory=datetime.now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Validate after initialization."""
        if not self.name:
            raise {{ModuleName}}Error("Name is required", {"field": "name"})

    def process(self) -> dict[str, Any]:
        """Process the {{module_name}}.

        Returns:
            Processing result as a dictionary.

        Raises:
            {{ModuleName}}Error: If processing fails.
        """
        logger.info("Processing %s: %s", self.__class__.__name__, self.name)
        try:
            result = {
                "id": self.id,
                "name": self.name,
                "processed_at": datetime.now().isoformat(),
                "status": "completed",
            }
            logger.debug("Processing result: %s", result)
            return result
        except Exception as e:
            logger.exception("Processing failed for %s", self.name)
            raise {{ModuleName}}Error(f"Processing failed: {e}") from e

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation.

        Returns:
            Dictionary with all fields.
        """
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat(),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> {{ModuleName}}:
        """Create instance from dictionary.

        Args:
            data: Dictionary with entity data.

        Returns:
            New {{ModuleName}} instance.
        """
        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)

        return cls(
            id=data.get("id"),
            name=data["name"],
            created_at=created_at or datetime.now(),
            metadata=data.get("metadata", {}),
        )


def process_{{module_name}}(
    name: str,
    *,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Process a {{module_name}} by name.

    This is a convenience function that creates and processes
    a {{ModuleName}} instance.

    Args:
        name: The name to process.
        options: Optional processing options.

    Returns:
        Processing result dictionary.

    Raises:
        {{ModuleName}}Error: If processing fails.

    Example:
        >>> result = process_{{module_name}}("example")
        >>> print(result["status"])
        completed
    """
    logger.info("Processing {{module_name}}: %s", name)
    obj = {{ModuleName}}(name=name, metadata=options or {})
    return obj.process()


if __name__ == "__main__":
    # Example usage
    logging.basicConfig(level=logging.DEBUG)

    try:
        result = process_{{module_name}}("test")
        print(f"Result: {result}")
    except {{ModuleName}}Error as e:
        print(f"Error: {e.message}")
