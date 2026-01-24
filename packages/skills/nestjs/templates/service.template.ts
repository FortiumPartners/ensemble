import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { {{EntityName}}Repository } from '../repositories/{{entity-name}}.repository';
import { Create{{EntityName}}Dto } from '../dto/create-{{entity-name}}.dto';
import { Update{{EntityName}}Dto } from '../dto/update-{{entity-name}}.dto';
import { {{EntityName}} } from '../entities/{{entity-name}}.entity';
import { User } from '@/modules/users/entities/user.entity';
import { PaginatedResult, FindAllOptions } from '@/common/interfaces/pagination.interface';
import { LoggerService } from '@/common/logger/logger.service';

@Injectable()
export class {{EntityName}}Service {
  constructor(
    private readonly {{entityName}}Repository: {{EntityName}}Repository,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Find {{entity-display-name}} by ID with caching
   */
  async findById(id: number): Promise<{{EntityName}}> {
    // Check cache first
    const cacheKey = `{{entity-name}}:${id}`;
    const cached = await this.cacheManager.get<{{EntityName}}>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return cached;
    }

    // Fetch from database
    const {{entityName}} = await this.{{entityName}}Repository.findById(id);

    if (!{{entityName}}) {
      throw new NotFoundException(`{{EntityName}} with ID ${id} not found`);
    }

    // Cache result
    await this.cacheManager.set(cacheKey, {{entityName}}, 3600); // 1 hour TTL

    return {{entityName}};
  }

  /**
   * Find all {{entity-display-name-plural}} with pagination and filters
   */
  async findAll(options: FindAllOptions): Promise<PaginatedResult<{{EntityName}}>> {
    return this.{{entityName}}Repository.findAll(options);
  }

  /**
   * Create a new {{entity-display-name}}
   */
  async create(
    createDto: Create{{EntityName}}Dto,
    user: User,
  ): Promise<{{EntityName}}> {
    // Validate business rules
    await this.validateCreate(createDto);

    // Create {{entity-display-name}}
    const {{entityName}} = await this.{{entityName}}Repository.create({
      ...createDto,
      createdById: user.id,
    });

    // Emit event
    this.eventEmitter.emit('{{entity-name}}.created', {
      {{entityName}},
      user,
    });

    // Invalidate list cache
    await this.cacheManager.del('{{entity-name-plural}}:list');

    this.logger.log(`{{EntityName}} created: ${{{entityName}}.id} by user ${user.id}`);

    return {{entityName}};
  }

  /**
   * Update an existing {{entity-display-name}}
   */
  async update(
    id: number,
    updateDto: Update{{EntityName}}Dto,
    user: User,
  ): Promise<{{EntityName}}> {
    // Find existing {{entity-display-name}}
    const existing = await this.findById(id);

    // Validate business rules
    await this.validateUpdate(existing, updateDto, user);

    // Update {{entity-display-name}}
    Object.assign(existing, updateDto);
    existing.updatedById = user.id;

    const updated = await this.{{entityName}}Repository.save(existing);

    // Invalidate caches
    await this.cacheManager.del(`{{entity-name}}:${id}`);
    await this.cacheManager.del('{{entity-name-plural}}:list');

    // Emit event
    this.eventEmitter.emit('{{entity-name}}.updated', {
      {{entityName}}: updated,
      previousState: existing,
      user,
    });

    this.logger.log(`{{EntityName}} updated: ${id} by user ${user.id}`);

    return updated;
  }

  /**
   * Delete a {{entity-display-name}} (soft delete)
   */
  async delete(id: number): Promise<void> {
    const {{entityName}} = await this.findById(id);

    // Soft delete
    await this.{{entityName}}Repository.softDelete(id);

    // Invalidate caches
    await this.cacheManager.del(`{{entity-name}}:${id}`);
    await this.cacheManager.del('{{entity-name-plural}}:list');

    // Emit event
    this.eventEmitter.emit('{{entity-name}}.deleted', {
      {{entityName}}Id: id,
      {{entityName}},
    });

    this.logger.log(`{{EntityName}} deleted: ${id}`);
  }

  /**
   * Hard delete a {{entity-display-name}} (permanent)
   */
  async hardDelete(id: number): Promise<void> {
    await this.{{entityName}}Repository.delete(id);

    // Invalidate caches
    await this.cacheManager.del(`{{entity-name}}:${id}`);
    await this.cacheManager.del('{{entity-name-plural}}:list');

    this.logger.log(`{{EntityName}} hard deleted: ${id}`);
  }

  /**
   * Restore a soft-deleted {{entity-display-name}}
   */
  async restore(id: number): Promise<{{EntityName}}> {
    const {{entityName}} = await this.{{entityName}}Repository.restore(id);

    // Invalidate caches
    await this.cacheManager.del(`{{entity-name}}:${id}`);
    await this.cacheManager.del('{{entity-name-plural}}:list');

    // Emit event
    this.eventEmitter.emit('{{entity-name}}.restored', { {{entityName}} });

    this.logger.log(`{{EntityName}} restored: ${id}`);

    return {{entityName}};
  }

  /**
   * Validate create operation
   * Override this method to add custom validation logic
   */
  private async validateCreate(createDto: Create{{EntityName}}Dto): Promise<void> {
    // Example: Check for duplicate name
    // const existing = await this.{{entityName}}Repository.findByName(createDto.name);
    // if (existing) {
    //   throw new ConflictException(`{{EntityName}} with name "${createDto.name}" already exists`);
    // }
  }

  /**
   * Validate update operation
   * Override this method to add custom validation logic
   */
  private async validateUpdate(
    existing: {{EntityName}},
    updateDto: Update{{EntityName}}Dto,
    user: User,
  ): Promise<void> {
    // Example: Check ownership
    // if (existing.createdById !== user.id && !user.isAdmin) {
    //   throw new ForbiddenException('You can only update your own {{entity-display-name-plural}}');
    // }

    // Example: Check for duplicate name
    // if (updateDto.name && updateDto.name !== existing.name) {
    //   const duplicate = await this.{{entityName}}Repository.findByName(updateDto.name);
    //   if (duplicate) {
    //     throw new ConflictException(`{{EntityName}} with name "${updateDto.name}" already exists`);
    //   }
    // }
  }
}
