"""{{EntityName}} API router.

This module provides REST API endpoints for {{entity_name}} operations.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from ..dependencies import DbSession, CurrentUser, get_{{entity_name}}_service
from ..schemas import (
    {{EntityName}}Create,
    {{EntityName}}Response,
    {{EntityName}}Update,
    PaginatedResponse,
)
from ..services import {{EntityName}}Service

router = APIRouter()

# Type alias for dependency
{{EntityName}}ServiceDep = Annotated[{{EntityName}}Service, Depends(get_{{entity_name}}_service)]


@router.get(
    "",
    response_model=PaginatedResponse[{{EntityName}}Response],
    summary="List {{entity_name}}s",
    description="Retrieve a paginated list of {{entity_name}}s.",
)
async def list_{{entity_name}}s(
    service: {{EntityName}}ServiceDep,
    skip: Annotated[int, Query(ge=0, description="Records to skip")] = 0,
    limit: Annotated[int, Query(ge=1, le=100, description="Max records")] = 20,
) -> PaginatedResponse[{{EntityName}}Response]:
    """List all {{entity_name}}s with pagination."""
    items, total = await service.list(skip=skip, limit=limit)
    return PaginatedResponse(
        items=items,
        total=total,
        page=skip // limit + 1,
        page_size=limit,
        pages=(total + limit - 1) // limit,
    )


@router.get(
    "/{{{entity_name}}_id}",
    response_model={{EntityName}}Response,
    summary="Get {{entity_name}}",
    description="Retrieve a {{entity_name}} by its ID.",
    responses={
        404: {"description": "{{EntityName}} not found"},
    },
)
async def get_{{entity_name}}(
    service: {{EntityName}}ServiceDep,
    {{entity_name}}_id: Annotated[int, Path(gt=0, description="{{EntityName}} ID")],
) -> {{EntityName}}Response:
    """Get a {{entity_name}} by ID."""
    {{entity_name}} = await service.get({{entity_name}}_id)
    if not {{entity_name}}:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{{EntityName}} with id {{{entity_name}}_id} not found",
        )
    return {{entity_name}}


@router.post(
    "",
    response_model={{EntityName}}Response,
    status_code=status.HTTP_201_CREATED,
    summary="Create {{entity_name}}",
    description="Create a new {{entity_name}}.",
    responses={
        201: {"description": "{{EntityName}} created successfully"},
        409: {"description": "{{EntityName}} already exists"},
    },
)
async def create_{{entity_name}}(
    service: {{EntityName}}ServiceDep,
    {{entity_name}}_in: {{EntityName}}Create,
) -> {{EntityName}}Response:
    """Create a new {{entity_name}}."""
    return await service.create({{entity_name}}_in)


@router.put(
    "/{{{entity_name}}_id}",
    response_model={{EntityName}}Response,
    summary="Update {{entity_name}}",
    description="Update an existing {{entity_name}}.",
    responses={
        404: {"description": "{{EntityName}} not found"},
    },
)
async def update_{{entity_name}}(
    service: {{EntityName}}ServiceDep,
    {{entity_name}}_id: Annotated[int, Path(gt=0)],
    {{entity_name}}_in: {{EntityName}}Update,
    current_user: CurrentUser,
) -> {{EntityName}}Response:
    """Update a {{entity_name}}.

    Requires authentication.
    """
    return await service.update({{entity_name}}_id, {{entity_name}}_in)


@router.patch(
    "/{{{entity_name}}_id}",
    response_model={{EntityName}}Response,
    summary="Partial update {{entity_name}}",
    description="Partially update an existing {{entity_name}}.",
    responses={
        404: {"description": "{{EntityName}} not found"},
    },
)
async def patch_{{entity_name}}(
    service: {{EntityName}}ServiceDep,
    {{entity_name}}_id: Annotated[int, Path(gt=0)],
    {{entity_name}}_in: {{EntityName}}Update,
    current_user: CurrentUser,
) -> {{EntityName}}Response:
    """Partially update a {{entity_name}}.

    Only provided fields will be updated.
    Requires authentication.
    """
    return await service.update({{entity_name}}_id, {{entity_name}}_in)


@router.delete(
    "/{{{entity_name}}_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete {{entity_name}}",
    description="Delete a {{entity_name}} by its ID.",
    responses={
        204: {"description": "{{EntityName}} deleted"},
        404: {"description": "{{EntityName}} not found"},
    },
)
async def delete_{{entity_name}}(
    service: {{EntityName}}ServiceDep,
    {{entity_name}}_id: Annotated[int, Path(gt=0)],
    current_user: CurrentUser,
) -> None:
    """Delete a {{entity_name}}.

    Requires authentication.
    """
    deleted = await service.delete({{entity_name}}_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{{EntityName}} with id {{{entity_name}}_id} not found",
        )
