/**
 * Repository Pattern Template
 *
 * Template Variables:
 *   entity: Model name (e.g., "User")
 *   entity_lower: Prisma accessor (e.g., "user")
 *   include_soft_delete: boolean - Add soft delete methods
 *   include_pagination: boolean - Add paginated queries
 *   custom_methods: Array of custom method definitions
 *
 * Output: src/repositories/{{ entity_lower }}.repository.ts
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

// =============================================================================
// Types
// =============================================================================

type {{ entity }} = Prisma.{{ entity }}GetPayload<{}>;
type {{ entity }}CreateInput = Prisma.{{ entity }}CreateInput;
type {{ entity }}UpdateInput = Prisma.{{ entity }}UpdateInput;
type {{ entity }}WhereInput = Prisma.{{ entity }}WhereInput;
type {{ entity }}WhereUniqueInput = Prisma.{{ entity }}WhereUniqueInput;
type {{ entity }}OrderByInput = Prisma.{{ entity }}OrderByWithRelationInput;
type {{ entity }}Include = Prisma.{{ entity }}Include;

{% if include_pagination %}
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
{% endif %}

// =============================================================================
// Repository Class
// =============================================================================

export class {{ entity }}Repository {
  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(data: {{ entity }}CreateInput): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.create({
      data,
    });
  }

  async createMany(data: {{ entity }}CreateInput[]): Promise<number> {
    const result = await prisma.{{ entity_lower }}.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async findById(
    id: string,
    include?: {{ entity }}Include
  ): Promise<{{ entity }} | null> {
    return prisma.{{ entity_lower }}.findUnique({
      where: { id },
      include,
    });
  }

  async findByIdOrThrow(
    id: string,
    include?: {{ entity }}Include
  ): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.findUniqueOrThrow({
      where: { id },
      include,
    });
  }

  async findFirst(
    where: {{ entity }}WhereInput,
    include?: {{ entity }}Include
  ): Promise<{{ entity }} | null> {
    return prisma.{{ entity_lower }}.findFirst({
      where{% if include_soft_delete %}: { ...where, deletedAt: null }{% endif %},
      include,
    });
  }

  async findMany(
    where?: {{ entity }}WhereInput,
    options?: {
      include?: {{ entity }}Include;
      orderBy?: {{ entity }}OrderByInput | {{ entity }}OrderByInput[];
      take?: number;
      skip?: number;
    }
  ): Promise<{{ entity }}[]> {
    return prisma.{{ entity_lower }}.findMany({
      where{% if include_soft_delete %}: { ...where, deletedAt: null }{% endif %},
      ...options,
    });
  }

  {% if include_pagination %}
  async findPaginated(
    where?: {{ entity }}WhereInput,
    options?: {
      include?: {{ entity }}Include;
      orderBy?: {{ entity }}OrderByInput;
      page?: number;
      pageSize?: number;
    }
  ): Promise<PaginatedResult<{{ entity }}>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const whereWithSoftDelete = {% if include_soft_delete %}{ ...where, deletedAt: null }{% else %}where{% endif %};

    const [data, total] = await prisma.$transaction([
      prisma.{{ entity_lower }}.findMany({
        where: whereWithSoftDelete,
        include: options?.include,
        orderBy: options?.orderBy,
        skip,
        take: pageSize,
      }),
      prisma.{{ entity_lower }}.count({ where: whereWithSoftDelete }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }

  async findWithCursor(
    where?: {{ entity }}WhereInput,
    options?: {
      include?: {{ entity }}Include;
      orderBy?: {{ entity }}OrderByInput;
      cursor?: string;
      take?: number;
    }
  ): Promise<{ data: {{ entity }}[]; nextCursor: string | null }> {
    const take = options?.take ?? 20;

    const data = await prisma.{{ entity_lower }}.findMany({
      where{% if include_soft_delete %}: { ...where, deletedAt: null }{% endif %},
      include: options?.include,
      orderBy: options?.orderBy ?? { id: "asc" },
      cursor: options?.cursor ? { id: options.cursor } : undefined,
      skip: options?.cursor ? 1 : 0,
      take: take + 1, // Fetch one extra to check if there's more
    });

    const hasMore = data.length > take;
    const results = hasMore ? data.slice(0, take) : data;
    const nextCursor = hasMore ? results[results.length - 1]?.id : null;

    return { data: results, nextCursor };
  }
  {% endif %}

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async update(
    id: string,
    data: {{ entity }}UpdateInput
  ): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.update({
      where: { id },
      data,
    });
  }

  async updateMany(
    where: {{ entity }}WhereInput,
    data: {{ entity }}UpdateInput
  ): Promise<number> {
    const result = await prisma.{{ entity_lower }}.updateMany({
      where,
      data,
    });
    return result.count;
  }

  async upsert(
    where: {{ entity }}WhereUniqueInput,
    create: {{ entity }}CreateInput,
    update: {{ entity }}UpdateInput
  ): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.upsert({
      where,
      create,
      update,
    });
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  {% if include_soft_delete %}
  async softDelete(id: string): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async softDeleteMany(where: {{ entity }}WhereInput): Promise<number> {
    const result = await prisma.{{ entity_lower }}.updateMany({
      where,
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  async restore(id: string): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async hardDelete(id: string): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.delete({
      where: { id },
    });
  }
  {% else %}
  async delete(id: string): Promise<{{ entity }}> {
    return prisma.{{ entity_lower }}.delete({
      where: { id },
    });
  }

  async deleteMany(where: {{ entity }}WhereInput): Promise<number> {
    const result = await prisma.{{ entity_lower }}.deleteMany({
      where,
    });
    return result.count;
  }
  {% endif %}

  // ---------------------------------------------------------------------------
  // Aggregations
  // ---------------------------------------------------------------------------

  async count(where?: {{ entity }}WhereInput): Promise<number> {
    return prisma.{{ entity_lower }}.count({
      where{% if include_soft_delete %}: { ...where, deletedAt: null }{% endif %},
    });
  }

  async exists(where: {{ entity }}WhereInput): Promise<boolean> {
    const count = await this.count(where);
    return count > 0;
  }

  {% for method in custom_methods | default([]) %}
  // ---------------------------------------------------------------------------
  // Custom: {{ method.name }}
  // ---------------------------------------------------------------------------

  async {{ method.name }}({{ method.params }}): Promise<{{ method.return_type | default(entity) }}{% if method.nullable %} | null{% endif %}> {
    // TODO: Implement custom method
    throw new Error("Not implemented");
  }
  {% endfor %}
}

// =============================================================================
// Export Singleton
// =============================================================================

export const {{ entity_lower }}Repository = new {{ entity }}Repository();
export default {{ entity_lower }}Repository;
