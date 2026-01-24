import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { {{EntityName}} } from '../entities/{{entity-name}}.entity';
import { PaginatedResult, FindAllOptions } from '@/common/interfaces/pagination.interface';

@Injectable()
export class {{EntityName}}Repository {
  constructor(
    @InjectRepository({{EntityName}})
    private readonly repository: Repository<{{EntityName}}>,
  ) {}

  /**
   * Find {{entity-display-name}} by ID
   */
  async findById(id: number): Promise<{{EntityName}} | null> {
    return this.repository.findOne({
      where: { id },
      // Include relations if needed
      // relations: ['relatedEntity'],
    });
  }

  /**
   * Find all {{entity-display-name-plural}} with pagination
   */
  async findAll(options: FindAllOptions): Promise<PaginatedResult<{{EntityName}}>> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = options;

    const skip = (page - 1) * limit;

    const query = this.repository.createQueryBuilder('{{entityName}}')
      .take(limit)
      .skip(skip)
      .orderBy(`{{entityName}}.${sortBy}`, sortOrder);

    // Add search condition if provided
    if (search) {
      query.where(
        '{{entityName}}.name ILIKE :search OR {{entityName}}.description ILIKE :search',
        { search: `%${search}%` },
      );
    }

    // Exclude soft-deleted records
    query.andWhere('{{entityName}}.deletedAt IS NULL');

    // Execute query
    const [data, total] = await query.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find {{entity-display-name}} by custom criteria
   * Example: Find by name
   */
  async findByName(name: string): Promise<{{EntityName}} | null> {
    return this.repository.findOne({
      where: { name, deletedAt: IsNull() },
    });
  }

  /**
   * Create a new {{entity-display-name}}
   */
  async create(data: Partial<{{EntityName}}>): Promise<{{EntityName}}> {
    const {{entityName}} = this.repository.create(data);
    return this.repository.save({{entityName}});
  }

  /**
   * Save {{entity-display-name}} (insert or update)
   */
  async save({{entityName}}: {{EntityName}}): Promise<{{EntityName}}> {
    return this.repository.save({{entityName}});
  }

  /**
   * Update {{entity-display-name}} by ID
   */
  async update(id: number, data: Partial<{{EntityName}}>): Promise<{{EntityName}}> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  /**
   * Soft delete {{entity-display-name}}
   */
  async softDelete(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }

  /**
   * Hard delete {{entity-display-name}} (permanent)
   */
  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  /**
   * Restore soft-deleted {{entity-display-name}}
   */
  async restore(id: number): Promise<{{EntityName}}> {
    await this.repository.restore(id);
    return this.findById(id);
  }

  /**
   * Count {{entity-display-name-plural}}
   */
  async count(where?: any): Promise<number> {
    return this.repository.count({ where });
  }

  /**
   * Find active {{entity-display-name-plural}}
   */
  async findActive(): Promise<{{EntityName}}[]> {
    return this.repository.find({
      where: {
        isActive: true,
        deletedAt: IsNull(),
      },
    });
  }

  /**
   * Bulk create {{entity-display-name-plural}}
   */
  async bulkCreate(data: Partial<{{EntityName}}>[]): Promise<{{EntityName}}[]> {
    const entities = data.map(item => this.repository.create(item));
    return this.repository.save(entities);
  }

  /**
   * Custom query using QueryBuilder
   * Example: Find with complex conditions
   */
  async findWithComplexConditions(
    minValue: number,
    maxValue: number,
  ): Promise<{{EntityName}}[]> {
    return this.repository.createQueryBuilder('{{entityName}}')
      .where('{{entityName}}.value >= :minValue', { minValue })
      .andWhere('{{entityName}}.value <= :maxValue', { maxValue })
      .andWhere('{{entityName}}.deletedAt IS NULL')
      .orderBy('{{entityName}}.createdAt', 'DESC')
      .getMany();
  }

  /**
   * Find with relations
   * Example: Include related entities
   */
  async findWithRelations(id: number): Promise<{{EntityName}} | null> {
    return this.repository.findOne({
      where: { id },
      relations: [
        // 'relatedEntity',
        // 'anotherRelation',
      ],
    });
  }
}
