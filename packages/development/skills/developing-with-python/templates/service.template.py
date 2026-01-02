"""{{EntityName}} service module.

This module provides business logic for {{entity_name}} operations.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .exceptions import ConflictError, NotFoundError
from .schemas import {{EntityName}}Create, {{EntityName}}Response, {{EntityName}}Update

if TYPE_CHECKING:
    from .repositories import {{EntityName}}Repository

__all__ = ["{{ServiceName}}"]

logger = logging.getLogger(__name__)


class {{ServiceName}}:
    """Service for {{entity_name}} business logic.

    This service handles all {{entity_name}}-related operations,
    coordinating between the API layer and the repository.

    Attributes:
        repo: The {{entity_name}} repository instance.
    """

    def __init__(self, repo: {{EntityName}}Repository) -> None:
        """Initialize the service.

        Args:
            repo: Repository for {{entity_name}} data access.
        """
        self.repo = repo

    async def get(self, {{entity_name}}_id: int) -> {{EntityName}}Response | None:
        """Get a {{entity_name}} by ID.

        Args:
            {{entity_name}}_id: The {{entity_name}}'s unique identifier.

        Returns:
            The {{entity_name}} if found, None otherwise.
        """
        logger.debug("Getting {{entity_name}} with id=%d", {{entity_name}}_id)
        entity = await self.repo.get({{entity_name}}_id)
        if entity is None:
            return None
        return {{EntityName}}Response.model_validate(entity)

    async def get_by_identifier(
        self,
        identifier: str,
    ) -> {{EntityName}}Response | None:
        """Get a {{entity_name}} by unique identifier.

        Args:
            identifier: The unique identifier (e.g., email, slug).

        Returns:
            The {{entity_name}} if found, None otherwise.
        """
        logger.debug("Getting {{entity_name}} by identifier=%s", identifier)
        entity = await self.repo.get_by_identifier(identifier)
        if entity is None:
            return None
        return {{EntityName}}Response.model_validate(entity)

    async def list(
        self,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple[list[{{EntityName}}Response], int]:
        """List {{entity_name}}s with pagination.

        Args:
            skip: Number of records to skip.
            limit: Maximum number of records to return.

        Returns:
            Tuple of (list of {{entity_name}}s, total count).
        """
        logger.debug("Listing {{entity_name}}s: skip=%d, limit=%d", skip, limit)
        entities, total = await self.repo.get_all(skip=skip, limit=limit)
        return [{{EntityName}}Response.model_validate(e) for e in entities], total

    async def create(
        self,
        data: {{EntityName}}Create,
    ) -> {{EntityName}}Response:
        """Create a new {{entity_name}}.

        Args:
            data: The {{entity_name}} creation data.

        Returns:
            The created {{entity_name}}.

        Raises:
            ConflictError: If {{entity_name}} with identifier already exists.
        """
        logger.info("Creating {{entity_name}}")

        # Check for existing
        existing = await self.repo.get_by_identifier(data.identifier)
        if existing:
            raise ConflictError(
                f"{{EntityName}} with identifier '{data.identifier}' already exists"
            )

        # Create entity
        entity = await self.repo.create(data.model_dump())
        logger.info("Created {{entity_name}} with id=%d", entity.id)

        return {{EntityName}}Response.model_validate(entity)

    async def update(
        self,
        {{entity_name}}_id: int,
        data: {{EntityName}}Update,
    ) -> {{EntityName}}Response:
        """Update an existing {{entity_name}}.

        Args:
            {{entity_name}}_id: The {{entity_name}}'s ID.
            data: The update data.

        Returns:
            The updated {{entity_name}}.

        Raises:
            NotFoundError: If {{entity_name}} not found.
        """
        logger.info("Updating {{entity_name}} id=%d", {{entity_name}}_id)

        entity = await self.repo.get({{entity_name}}_id)
        if entity is None:
            raise NotFoundError("{{EntityName}}", {{entity_name}}_id)

        # Update only provided fields
        update_data = data.model_dump(exclude_unset=True)
        entity = await self.repo.update({{entity_name}}_id, update_data)

        logger.info("Updated {{entity_name}} id=%d", {{entity_name}}_id)
        return {{EntityName}}Response.model_validate(entity)

    async def delete(self, {{entity_name}}_id: int) -> bool:
        """Delete a {{entity_name}}.

        Args:
            {{entity_name}}_id: The {{entity_name}}'s ID.

        Returns:
            True if deleted, False if not found.
        """
        logger.info("Deleting {{entity_name}} id=%d", {{entity_name}}_id)

        entity = await self.repo.get({{entity_name}}_id)
        if entity is None:
            return False

        await self.repo.delete(entity)
        logger.info("Deleted {{entity_name}} id=%d", {{entity_name}}_id)
        return True
