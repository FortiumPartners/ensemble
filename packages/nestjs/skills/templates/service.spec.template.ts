import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { {{EntityName}}Service } from './{{entity-name}}.service';
import { {{EntityName}}Repository } from '../repositories/{{entity-name}}.repository';
import { LoggerService } from '@/common/logger/logger.service';
import { Create{{EntityName}}Dto } from '../dto/create-{{entity-name}}.dto';
import { Update{{EntityName}}Dto } from '../dto/update-{{entity-name}}.dto';
import { {{EntityName}} } from '../entities/{{entity-name}}.entity';
import { User } from '@/modules/users/entities/user.entity';

// Mock types
type MockType<T> = {
  [P in keyof T]?: jest.Mock;
};

// Mock factory functions
const mockRepository = (): MockType<{{EntityName}}Repository> => ({
  findById: jest.fn(),
  findAll: jest.fn(),
  findByName: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
  delete: jest.fn(),
  restore: jest.fn(),
});

const mockCacheManager = (): MockType<any> => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
});

const mockEventEmitter = (): MockType<EventEmitter2> => ({
  emit: jest.fn(),
  emitAsync: jest.fn(),
});

const mockLogger = (): MockType<LoggerService> => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
});

describe('{{EntityName}}Service', () => {
  let service: {{EntityName}}Service;
  let repository: MockType<{{EntityName}}Repository>;
  let cacheManager: MockType<any>;
  let eventEmitter: MockType<EventEmitter2>;
  let logger: MockType<LoggerService>;

  // Test data
  const mockUser: User = {
    id: 1,
    email: 'test@test.com',
    name: 'Test User',
    isAdmin: false,
  } as User;

  const mock{{EntityName}}: {{EntityName}} = {
    id: 1,
    name: 'Test {{EntityName}}',
    description: 'Test description',
    isActive: true,
    createdById: mockUser.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as {{EntityName}};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {{EntityName}}Service,
        {
          provide: {{EntityName}}Repository,
          useFactory: mockRepository,
        },
        {
          provide: CACHE_MANAGER,
          useFactory: mockCacheManager,
        },
        {
          provide: EventEmitter2,
          useFactory: mockEventEmitter,
        },
        {
          provide: LoggerService,
          useFactory: mockLogger,
        },
      ],
    }).compile();

    service = module.get<{{EntityName}}Service>({{EntityName}}Service);
    repository = module.get({{EntityName}}Repository);
    cacheManager = module.get(CACHE_MANAGER);
    eventEmitter = module.get(EventEmitter2);
    logger = module.get(LoggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should return cached {{entity-display-name}} if exists', async () => {
      cacheManager.get.mockResolvedValue(mock{{EntityName}});

      const result = await service.findById(1);

      expect(result).toEqual(mock{{EntityName}});
      expect(cacheManager.get).toHaveBeenCalledWith('{{entity-name}}:1');
      expect(repository.findById).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith('Cache hit: {{entity-name}}:1');
    });

    it('should fetch from database and cache if not cached', async () => {
      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(mock{{EntityName}});

      const result = await service.findById(1);

      expect(result).toEqual(mock{{EntityName}});
      expect(repository.findById).toHaveBeenCalledWith(1);
      expect(cacheManager.set).toHaveBeenCalledWith(
        '{{entity-name}}:1',
        mock{{EntityName}},
        3600,
      );
    });

    it('should throw NotFoundException if {{entity-display-name}} not found', async () => {
      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(null);

      await expect(service.findById(999)).rejects.toThrow(NotFoundException);
      await expect(service.findById(999)).rejects.toThrow(
        '{{EntityName}} with ID 999 not found',
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated {{entity-display-name-plural}}', async () => {
      const paginatedResult = {
        data: [mock{{EntityName}}],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      repository.findAll.mockResolvedValue(paginatedResult);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toEqual(paginatedResult);
      expect(repository.findAll).toHaveBeenCalledWith({ page: 1, limit: 20 });
    });
  });

  describe('create', () => {
    const createDto: Create{{EntityName}}Dto = {
      name: 'New {{EntityName}}',
      description: 'New description',
      isActive: true,
    };

    it('should create a new {{entity-display-name}}', async () => {
      repository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(mock{{EntityName}});

      const result = await service.create(createDto, mockUser);

      expect(repository.create).toHaveBeenCalledWith({
        ...createDto,
        createdById: mockUser.id,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith('{{entity-name}}.created', {
        {{entityName}}: mock{{EntityName}},
        user: mockUser,
      });
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name-plural}}:list');
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('{{EntityName}} created'),
      );
      expect(result).toEqual(mock{{EntityName}});
    });

    it('should throw ConflictException if {{entity-display-name}} already exists', async () => {
      repository.findByName.mockResolvedValue(mock{{EntityName}});

      await expect(service.create(createDto, mockUser)).rejects.toThrow(
        ConflictException,
      );

      expect(repository.create).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const updateDto: Update{{EntityName}}Dto = {
      name: 'Updated {{EntityName}}',
      description: 'Updated description',
    };

    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(mock{{EntityName}});
    });

    it('should update {{entity-display-name}} successfully', async () => {
      const updated = { ...mock{{EntityName}}, ...updateDto };
      repository.save.mockResolvedValue(updated);

      const result = await service.update(1, updateDto, mockUser);

      expect(repository.save).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name}}:1');
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name-plural}}:list');
      expect(eventEmitter.emit).toHaveBeenCalledWith('{{entity-name}}.updated', {
        {{entityName}}: updated,
        previousState: mock{{EntityName}},
        user: mockUser,
      });
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('{{EntityName}} updated'),
      );
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException if {{entity-display-name}} not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update(999, updateDto, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should validate duplicate name when updating', async () => {
      const duplicate = { ...mock{{EntityName}}, id: 2 };
      repository.findByName.mockResolvedValue(duplicate);

      await expect(
        service.update(1, { name: 'Duplicate Name' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(mock{{EntityName}});
    });

    it('should soft delete {{entity-display-name}}', async () => {
      await service.delete(1);

      expect(repository.softDelete).toHaveBeenCalledWith(1);
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name}}:1');
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name-plural}}:list');
      expect(eventEmitter.emit).toHaveBeenCalledWith('{{entity-name}}.deleted', {
        {{entityName}}Id: 1,
        {{entityName}}: mock{{EntityName}},
      });
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('{{EntityName}} deleted'),
      );
    });

    it('should throw NotFoundException if {{entity-display-name}} not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.delete(999)).rejects.toThrow(NotFoundException);
      expect(repository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('should restore soft-deleted {{entity-display-name}}', async () => {
      repository.restore.mockResolvedValue(mock{{EntityName}});

      const result = await service.restore(1);

      expect(repository.restore).toHaveBeenCalledWith(1);
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name}}:1');
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name-plural}}:list');
      expect(eventEmitter.emit).toHaveBeenCalledWith('{{entity-name}}.restored', {
        {{entityName}}: mock{{EntityName}},
      });
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('{{EntityName}} restored'),
      );
      expect(result).toEqual(mock{{EntityName}});
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete CRUD lifecycle', async () => {
      // Create
      const createDto: Create{{EntityName}}Dto = {
        name: 'Lifecycle Test',
        description: 'Test lifecycle',
        isActive: true,
      };

      repository.findByName.mockResolvedValue(null);
      repository.create.mockResolvedValue(mock{{EntityName}});

      const created = await service.create(createDto, mockUser);
      expect(created).toBeDefined();

      // Read
      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(mock{{EntityName}});

      const found = await service.findById(created.id);
      expect(found).toEqual(mock{{EntityName}});

      // Update
      const updateDto: Update{{EntityName}}Dto = { name: 'Updated Name' };
      const updated = { ...mock{{EntityName}}, ...updateDto };
      repository.save.mockResolvedValue(updated);

      const result = await service.update(created.id, updateDto, mockUser);
      expect(result.name).toBe('Updated Name');

      // Delete
      await service.delete(created.id);
      expect(repository.softDelete).toHaveBeenCalledWith(created.id);
    });

    it('should handle cache invalidation across operations', async () => {
      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(mock{{EntityName}});

      // Initial read - caches result
      await service.findById(1);
      expect(cacheManager.set).toHaveBeenCalled();

      // Update - invalidates cache
      const updateDto: Update{{EntityName}}Dto = { name: 'New Name' };
      repository.save.mockResolvedValue({ ...mock{{EntityName}}, ...updateDto });
      await service.update(1, updateDto, mockUser);

      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name}}:1');
      expect(cacheManager.del).toHaveBeenCalledWith('{{entity-name-plural}}:list');
    });
  });
});
