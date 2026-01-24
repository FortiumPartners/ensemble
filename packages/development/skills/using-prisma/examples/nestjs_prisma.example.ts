/**
 * NestJS + Prisma Integration Example
 *
 * This example demonstrates:
 * - Prisma module setup with connection management
 * - Service pattern with CRUD operations
 * - Transaction handling
 * - Soft delete middleware
 * - Error handling
 * - Testing patterns
 */

// =============================================================================
// prisma.module.ts - Prisma Module Setup
// =============================================================================

import { Module, Global, OnModuleInit, OnModuleDestroy, INestApplication } from "@nestjs/common";
import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: "event", level: "query" },
        { emit: "stdout", level: "info" },
        { emit: "stdout", level: "warn" },
        { emit: "stdout", level: "error" },
      ],
      errorFormat: "pretty",
    });

    // Log slow queries in development
    if (process.env.NODE_ENV === "development") {
      this.$on("query" as never, (e: Prisma.QueryEvent) => {
        if (e.duration > 100) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log("Connected to database");
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log("Disconnected from database");
  }

  // Graceful shutdown for NestJS
  async enableShutdownHooks(app: INestApplication) {
    process.on("beforeExit", async () => {
      await app.close();
    });
  }

  // Clean database for testing
  async cleanDatabase() {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("cleanDatabase can only be run in test environment");
    }

    const tablenames = await this.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((name) => name !== "_prisma_migrations")
      .map((name) => `"public"."${name}"`)
      .join(", ");

    if (tables.length > 0) {
      await this.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
    }
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

// =============================================================================
// user.service.ts - User Service with CRUD
// =============================================================================

import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { User } from "@prisma/client";

// DTOs
export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
}

export interface UpdateUserDto {
  email?: string;
  name?: string;
}

export interface UserWithProfile extends User {
  profile: {
    bio: string | null;
    website: string | null;
    avatarUrl: string | null;
  } | null;
}

export interface PaginatedUsers {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async create(dto: CreateUserDto): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name,
          passwordHash: await this.hashPassword(dto.password),
          profile: {
            create: {}, // Create empty profile
          },
        },
        include: {
          profile: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          throw new ConflictException("Email already exists");
        }
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async findById(id: string): Promise<UserWithProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: {
          select: {
            bio: true,
            website: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findAll(options?: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: Role;
  }): Promise<PaginatedUsers> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {
      deletedAt: null, // Soft delete filter
      ...(options?.search && {
        OR: [
          { email: { contains: options.search, mode: "insensitive" } },
          { name: { contains: options.search, mode: "insensitive" } },
        ],
      }),
      ...(options?.role && { role: options.role }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          // Exclude sensitive fields
          passwordHash: false,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: data as User[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: dto,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") {
          throw new NotFoundException(`User with ID ${id} not found`);
        }
        if (error.code === "P2002") {
          throw new ConflictException("Email already exists");
        }
      }
      throw error;
    }
  }

  async updateProfile(
    userId: string,
    profileData: { bio?: string; website?: string }
  ) {
    return this.prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        ...profileData,
      },
      update: profileData,
    });
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async softDelete(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id },
    });
  }

  async restore(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async hashPassword(password: string): Promise<string> {
    // Use bcrypt or argon2 in production
    return `hashed_${password}`;
  }
}

// =============================================================================
// post.service.ts - Post Service with Transactions
// =============================================================================

export interface CreatePostDto {
  title: string;
  content?: string;
  categoryId?: string;
  tags?: string[];
}

@Injectable()
export class PostService {
  constructor(private prisma: PrismaService) {}

  // Create post with tags in a transaction
  async create(authorId: string, dto: CreatePostDto) {
    return this.prisma.$transaction(async (tx) => {
      // Create or connect tags
      const tagConnections = dto.tags
        ? await Promise.all(
            dto.tags.map(async (tagName) => {
              const tag = await tx.tag.upsert({
                where: { name: tagName },
                create: {
                  name: tagName,
                  slug: this.slugify(tagName),
                },
                update: {},
              });
              return { id: tag.id };
            })
          )
        : [];

      // Create post with tags
      const post = await tx.post.create({
        data: {
          title: dto.title,
          slug: this.slugify(dto.title),
          content: dto.content,
          authorId,
          categoryId: dto.categoryId,
          tags: {
            connect: tagConnections,
          },
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          category: true,
          tags: true,
        },
      });

      return post;
    });
  }

  // Publish post with validation
  async publish(id: string, authorId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        // Verify ownership
        const post = await tx.post.findFirst({
          where: { id, authorId },
        });

        if (!post) {
          throw new NotFoundException("Post not found or access denied");
        }

        if (post.status === "PUBLISHED") {
          throw new BadRequestException("Post is already published");
        }

        // Update status
        return tx.post.update({
          where: { id },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      }
    );
  }

  // Increment view count (optimistic update)
  async incrementViews(id: string) {
    return this.prisma.post.update({
      where: { id },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    });
  }

  // Full-text search (PostgreSQL)
  async search(query: string) {
    return this.prisma.post.findMany({
      where: {
        OR: [
          { title: { search: query } },
          { content: { search: query } },
        ],
        status: "PUBLISHED",
        deletedAt: null,
      },
      orderBy: {
        _relevance: {
          fields: ["title", "content"],
          search: query,
          sort: "desc",
        },
      },
      take: 20,
    });
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }
}

// =============================================================================
// user.controller.ts - Controller Example
// =============================================================================

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from "@nestjs/swagger";

@ApiTags("users")
@Controller("users")
export class UserController {
  constructor(private userService: UserService) {}

  @Post()
  @ApiOperation({ summary: "Create a new user" })
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "Get all users with pagination" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({ name: "search", required: false, type: String })
  findAll(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query("search") search?: string
  ) {
    return this.userService.findAll({ page, pageSize, search });
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user by ID" })
  findOne(@Param("id") id: string) {
    return this.userService.findById(id);
  }

  @Put(":id")
  @ApiOperation({ summary: "Update user" })
  update(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Soft delete user" })
  remove(@Param("id") id: string) {
    return this.userService.softDelete(id);
  }
}

// =============================================================================
// user.service.spec.ts - Testing Example
// =============================================================================

import { Test, TestingModule } from "@nestjs/testing";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";

describe("UserService", () => {
  let service: UserService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: mockDeep<PrismaClient>(),
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get(PrismaService);
  });

  describe("findById", () => {
    it("should return a user when found", async () => {
      const mockUser = {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        role: "USER",
        profile: {
          bio: "Test bio",
          website: null,
          avatarUrl: null,
        },
      };

      prisma.user.findUnique.mockResolvedValue(mockUser as any);

      const result = await service.findById("user-1");

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "user-1" },
        include: {
          profile: {
            select: {
              bio: true,
              website: true,
              avatarUrl: true,
            },
          },
        },
      });
    });

    it("should throw NotFoundException when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById("nonexistent")).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe("create", () => {
    it("should create a user successfully", async () => {
      const dto: CreateUserDto = {
        email: "new@example.com",
        name: "New User",
        password: "password123",
      };

      const mockCreated = {
        id: "new-user-id",
        email: dto.email,
        name: dto.name,
        role: "USER",
      };

      prisma.user.create.mockResolvedValue(mockCreated as any);

      const result = await service.create(dto);

      expect(result.email).toBe(dto.email);
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it("should throw ConflictException on duplicate email", async () => {
      const dto: CreateUserDto = {
        email: "existing@example.com",
        name: "User",
        password: "password",
      };

      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint", {
          code: "P2002",
          clientVersion: "5.0.0",
        })
      );

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });
});

// =============================================================================
// Integration Test Example
// =============================================================================

describe("UserService (Integration)", () => {
  let service: UserService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [UserService],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    await prisma.cleanDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should create and find a user", async () => {
    const created = await service.create({
      email: "integration@test.com",
      name: "Integration Test",
      password: "password123",
    });

    const found = await service.findById(created.id);

    expect(found.email).toBe("integration@test.com");
    expect(found.name).toBe("Integration Test");
  });

  it("should soft delete and restore a user", async () => {
    const user = await service.create({
      email: "delete@test.com",
      name: "Delete Test",
      password: "password123",
    });

    await service.softDelete(user.id);

    // Soft deleted user should not appear in normal queries
    const all = await service.findAll();
    expect(all.data.find((u) => u.id === user.id)).toBeUndefined();

    // Restore the user
    await service.restore(user.id);

    const restored = await service.findById(user.id);
    expect(restored.deletedAt).toBeNull();
  });
});

// =============================================================================
// app.module.ts - Main Module
// =============================================================================

@Module({
  imports: [PrismaModule],
  controllers: [UserController],
  providers: [UserService, PostService],
})
export class AppModule {}
