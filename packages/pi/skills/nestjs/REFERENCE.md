---
name: NestJS Framework Reference
version: 1.0.0
framework_versions:
  min: 8.0.0
  max: 11.x
  recommended: 10.4.0
compatible_agents:
  backend-developer: ">=3.0.0"
description: Comprehensive NestJS reference with advanced patterns, microservices, and GraphQL
---

# NestJS Framework - Comprehensive Reference

## Table of Contents

1. [Architecture & Design Patterns](#architecture--design-patterns)
2. [Module System & Dependency Injection](#module-system--dependency-injection)
3. [Controllers & Routing](#controllers--routing)
4. [Services & Business Logic](#services--business-logic)
5. [Data Layer & Persistence](#data-layer--persistence)
6. [Authentication & Authorization](#authentication--authorization)
7. [GraphQL Integration](#graphql-integration)
8. [Microservices Architecture](#microservices-architecture)
9. [Advanced Patterns](#advanced-patterns)
10. [Testing Strategies](#testing-strategies)
11. [Performance Optimization](#performance-optimization)
12. [Deployment & Production](#deployment--production)

---

## Architecture & Design Patterns

### Layered Architecture

```
src/
├── common/                 # Shared utilities, decorators, filters
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   └── pipes/
├── config/                 # Configuration management
│   ├── database.config.ts
│   ├── jwt.config.ts
│   └── app.config.ts
├── modules/                # Feature modules
│   ├── users/
│   │   ├── controllers/   # HTTP/GraphQL controllers
│   │   ├── services/      # Business logic
│   │   ├── repositories/  # Data access
│   │   ├── dto/           # Data Transfer Objects
│   │   ├── entities/      # Database entities
│   │   ├── guards/        # Module-specific guards
│   │   ├── tests/         # Unit & integration tests
│   │   └── users.module.ts
│   ├── auth/
│   └── orders/
├── shared/                 # Shared modules (database, cache, email)
│   ├── database/
│   ├── cache/
│   └── email/
├── main.ts                # Application entry point
└── app.module.ts          # Root module
```

### Module Design Principles

**1. Single Responsibility**
```typescript
// users.module.ts - Focused on user management only
@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    AuthModule.forRoot(), // Import what you need
    CacheModule,
  ],
  controllers: [UserController],
  providers: [
    UserService,
    UserRepository,
    UserPasswordService,
    UserEmailService,
  ],
  exports: [UserService], // Export only what others need
})
export class UsersModule {}
```

**2. Encapsulation**
```typescript
// Internal implementation detail - not exported
@Injectable()
class UserPasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }
}

// Public API - exported for other modules
@Injectable()
export class UserService {
  constructor(
    private readonly repository: UserRepository,
    private readonly passwordService: UserPasswordService, // Private dependency
  ) {}

  async createUser(dto: CreateUserDto): Promise<User> {
    const hashedPassword = await this.passwordService.hash(dto.password);
    return this.repository.create({ ...dto, password: hashedPassword });
  }
}
```

**3. Dependency Inversion**
```typescript
// Define interface (abstraction)
export interface IEmailService {
  sendWelcomeEmail(email: string, name: string): Promise<void>;
  sendPasswordResetEmail(email: string, token: string): Promise<void>;
}

// Concrete implementation
@Injectable()
export class SendGridEmailService implements IEmailService {
  async sendWelcomeEmail(email: string, name: string): Promise<void> {
    // SendGrid implementation
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    // SendGrid implementation
  }
}

// Module configuration with token
@Module({
  providers: [
    {
      provide: 'IEmailService',
      useClass: SendGridEmailService,
    },
  ],
  exports: ['IEmailService'],
})
export class EmailModule {}

// Consumer depends on abstraction
@Injectable()
export class UserService {
  constructor(
    @Inject('IEmailService') private readonly emailService: IEmailService,
  ) {}

  async createUser(dto: CreateUserDto): Promise<User> {
    const user = await this.repository.create(dto);
    await this.emailService.sendWelcomeEmail(user.email, user.name);
    return user;
  }
}
```

---

## Module System & Dependency Injection

### Dynamic Modules

```typescript
// config/database.module.ts
@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: 'DATABASE_OPTIONS',
          useValue: options,
        },
        {
          provide: 'DATABASE_CONNECTION',
          useFactory: async (opts: DatabaseOptions) => {
            return await createConnection(opts);
          },
          inject: ['DATABASE_OPTIONS'],
        },
      ],
      exports: ['DATABASE_CONNECTION'],
      global: options.isGlobal ?? false,
    };
  }

  static forRootAsync(options: DatabaseAsyncOptions): DynamicModule {
    return {
      module: DatabaseModule,
      imports: options.imports || [],
      providers: [
        {
          provide: 'DATABASE_OPTIONS',
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        {
          provide: 'DATABASE_CONNECTION',
          useFactory: async (opts: DatabaseOptions) => {
            return await createConnection(opts);
          },
          inject: ['DATABASE_OPTIONS'],
        },
      ],
      exports: ['DATABASE_CONNECTION'],
      global: options.isGlobal ?? false,
    };
  }
}

// Usage in app.module.ts
@Module({
  imports: [
    DatabaseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        database: configService.get('DB_NAME'),
      }),
      inject: [ConfigService],
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### Provider Scopes

```typescript
// Request-scoped provider (new instance per request)
@Injectable({ scope: Scope.REQUEST })
export class RequestLoggerService {
  constructor(@Inject(REQUEST) private request: Request) {}

  log(message: string): void {
    console.log(`[${this.request.id}] ${message}`);
  }
}

// Transient provider (new instance per injection)
@Injectable({ scope: Scope.TRANSIENT })
export class TransientService {
  // Each consumer gets its own instance
}

// Default: Singleton (shared instance)
@Injectable() // scope: Scope.DEFAULT
export class SingletonService {
  // Single instance shared across application
}
```

### Circular Dependencies

```typescript
// users/users.service.ts
@Injectable()
export class UserService {
  constructor(
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
  ) {}
}

// auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    @Inject(forwardRef(() => UserService))
    private userService: UserService,
  ) {}
}
```

**Better approach: Extract shared logic**
```typescript
// Avoid circular dependencies by extracting shared logic
@Injectable()
export class UserAuthService {
  validateCredentials(email: string, password: string): Promise<boolean> {
    // Shared authentication logic
  }
}

// Both services depend on UserAuthService (no circle)
@Injectable()
export class UserService {
  constructor(private readonly userAuthService: UserAuthService) {}
}

@Injectable()
export class AuthService {
  constructor(private readonly userAuthService: UserAuthService) {}
}
```

---

## Controllers & Routing

### RESTful API Design

```typescript
@ApiTags('users')
@Controller('api/v1/users')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {}

  // GET /api/v1/users?page=1&limit=20&search=john
  @Get()
  @ApiOperation({ summary: 'List users with pagination and search' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, type: PaginatedUserResponseDto })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ): Promise<PaginatedUserResponseDto> {
    return this.userService.findAll({ page, limit, search });
  }

  // GET /api/v1/users/:id
  @Get(':id')
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserResponseDto> {
    const user = await this.userService.findById(id);
    return plainToInstance(UserResponseDto, user);
  }

  // POST /api/v1/users
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new user' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async create(
    @Body(ValidationPipe) dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    this.logger.log(`Creating user: ${dto.email}`);
    const user = await this.userService.create(dto);
    return plainToInstance(UserResponseDto, user);
  }

  // PATCH /api/v1/users/:id
  @Patch(':id')
  @ApiOperation({ summary: 'Update user partially' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(ValidationPipe) dto: UpdateUserDto,
    @CurrentUser() currentUser: User,
  ): Promise<UserResponseDto> {
    // Validate permission
    if (currentUser.id !== id && !currentUser.isAdmin) {
      throw new ForbiddenException('Cannot update other users');
    }
    const user = await this.userService.update(id, dto);
    return plainToInstance(UserResponseDto, user);
  }

  // DELETE /api/v1/users/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete user (admin only)' })
  @ApiResponse({ status: 204, description: 'User deleted successfully' })
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.userService.delete(id);
  }

  // POST /api/v1/users/:id/avatar
  @Post(':id/avatar')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png)$/)) {
        return cb(new BadRequestException('Only images allowed'), false);
      }
      cb(null, true);
    },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadAvatarDto })
  async uploadAvatar(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UserResponseDto> {
    const user = await this.userService.updateAvatar(id, file);
    return plainToInstance(UserResponseDto, user);
  }
}
```

### API Versioning

**URI Versioning**
```typescript
// v1/users.controller.ts
@Controller({ path: 'users', version: '1' })
export class UserV1Controller {
  @Get()
  findAll() {
    return this.userService.findAllV1();
  }
}

// v2/users.controller.ts
@Controller({ path: 'users', version: '2' })
export class UserV2Controller {
  @Get()
  findAll() {
    return this.userService.findAllV2();
  }
}

// main.ts
app.enableVersioning({
  type: VersioningType.URI,
});
```

**Header Versioning**
```typescript
// main.ts
app.enableVersioning({
  type: VersioningType.HEADER,
  header: 'API-Version',
});

// Controller uses same @Controller({ version: '1' }) decorator
```

### Custom Decorators

```typescript
// decorators/current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

// decorators/roles.decorator.ts
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

// decorators/public.decorator.ts
export const Public = () => SetMetadata('isPublic', true);

// Usage in controller
@Get('profile')
async getProfile(@CurrentUser() user: User): Promise<UserResponseDto> {
  return plainToInstance(UserResponseDto, user);
}

@Post('admin/action')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
async adminAction(): Promise<void> {
  // Only admin and super_admin can access
}

@Get('health')
@Public()
async health(): Promise<{ status: string }> {
  return { status: 'ok' }; // Public endpoint, no auth required
}
```

---

## Services & Business Logic

### Service Layer Patterns

```typescript
// users/services/user.service.ts
@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly logger: LoggerService,
  ) {}

  async findById(id: number): Promise<User> {
    // Check cache first
    const cacheKey = `user:${id}`;
    const cached = await this.cacheManager.get<User>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return cached;
    }

    // Fetch from database
    const user = await this.userRepository.findById(id);

    // Cache result
    await this.cacheManager.set(cacheKey, user, 3600);
    return user;
  }

  async create(dto: CreateUserDto): Promise<User> {
    // Validate business rules
    const existing = await this.userRepository.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await this.passwordService.hash(dto.password);

    // Create user
    const user = await this.userRepository.create({
      ...dto,
      password: hashedPassword,
    });

    // Emit event for other parts of the system
    this.eventEmitter.emit('user.created', { user });

    // Invalidate related caches
    await this.cacheManager.del('users:list');

    this.logger.log(`User created: ${user.id}`);
    return user;
  }

  async update(id: number, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    // If email is being changed, validate uniqueness
    if (dto.email && dto.email !== user.email) {
      const existing = await this.userRepository.findByEmail(dto.email);
      if (existing) {
        throw new ConflictException('Email already in use');
      }
    }

    // Update user
    Object.assign(user, dto);
    const updated = await this.userRepository.save(user);

    // Invalidate cache
    await this.cacheManager.del(`user:${id}`);

    // Emit update event
    this.eventEmitter.emit('user.updated', { user: updated });

    return updated;
  }

  @Transactional()
  async delete(id: number): Promise<void> {
    const user = await this.findById(id);

    // Soft delete (set deletedAt timestamp)
    user.deletedAt = new Date();
    await this.userRepository.save(user);

    // Or hard delete
    // await this.userRepository.delete(id);

    // Invalidate cache
    await this.cacheManager.del(`user:${id}`);
    await this.cacheManager.del('users:list');

    // Emit deletion event
    this.eventEmitter.emit('user.deleted', { userId: id });

    this.logger.log(`User deleted: ${id}`);
  }
}
```

### Transaction Management

```typescript
// Using TypeORM QueryRunner
@Injectable()
export class OrderService {
  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly paymentService: PaymentService,
    private readonly inventoryService: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create order
      const order = await queryRunner.manager.save(Order, {
        userId: dto.userId,
        items: dto.items,
        total: dto.total,
      });

      // Process payment
      const payment = await this.paymentService.charge({
        orderId: order.id,
        amount: order.total,
        customerId: dto.userId,
      }, queryRunner);

      // Update inventory
      for (const item of dto.items) {
        await this.inventoryService.reduceStock(
          item.productId,
          item.quantity,
          queryRunner,
        );
      }

      // Commit transaction
      await queryRunner.commitTransaction();

      return order;
    } catch (error) {
      // Rollback on error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}

// Using custom @Transactional() decorator
export function Transactional() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const dataSource = this.dataSource || this.connection;
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const result = await originalMethod.apply(this, [...args, queryRunner]);
        await queryRunner.commitTransaction();
        return result;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    };

    return descriptor;
  };
}
```

---

## Data Layer & Persistence

### TypeORM Repository Pattern

```typescript
// users/entities/user.entity.ts
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  @Index()
  email: string;

  @Column()
  @Exclude() // Don't serialize in responses
  password: string;

  @Column({ nullable: true })
  name: string;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role: Role;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;

  @OneToMany(() => Order, order => order.user)
  orders: Order[];

  @ManyToMany(() => Permission)
  @JoinTable()
  permissions: Permission[];
}

// users/repositories/user.repository.ts
@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  async findById(id: number): Promise<User> {
    const user = await this.repository.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { email },
      relations: ['permissions'],
    });
  }

  async findAll(options: FindAllOptions): Promise<PaginatedResult<User>> {
    const { page = 1, limit = 20, search } = options;
    const skip = (page - 1) * limit;

    const query = this.repository.createQueryBuilder('user')
      .leftJoinAndSelect('user.permissions', 'permissions')
      .take(limit)
      .skip(skip);

    // Add search condition
    if (search) {
      query.where(
        'user.email ILIKE :search OR user.name ILIKE :search',
        { search: `%${search}%` },
      );
    }

    // Add soft delete filter
    query.andWhere('user.deletedAt IS NULL');

    const [users, total] = await query.getManyAndCount();

    return {
      data: users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(data: Partial<User>): Promise<User> {
    const user = this.repository.create(data);
    return this.repository.save(user);
  }

  async save(user: User): Promise<User> {
    return this.repository.save(user);
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  // Soft delete
  async softDelete(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }

  // Custom query methods
  async findActiveUsers(): Promise<User[]> {
    return this.repository.find({
      where: { isActive: true, deletedAt: IsNull() },
    });
  }

  async countByRole(role: Role): Promise<number> {
    return this.repository.count({ where: { role } });
  }

  // Complex query with QueryBuilder
  async findUsersWithOrdersAboveAmount(amount: number): Promise<User[]> {
    return this.repository.createQueryBuilder('user')
      .leftJoin('user.orders', 'order')
      .where('order.total > :amount', { amount })
      .groupBy('user.id')
      .having('COUNT(order.id) > 0')
      .getMany();
  }
}
```

### Prisma Integration

```typescript
// prisma/schema.prisma
model User {
  id        Int       @id @default(autoincrement())
  email     String    @unique
  password  String
  name      String?
  role      Role      @default(USER)
  isActive  Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?
  orders    Order[]
  @@index([email])
}

// prisma/prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Soft delete middleware
  constructor() {
    super();
    this.$use(async (params, next) => {
      if (params.model === 'User') {
        if (params.action === 'delete') {
          // Change delete to update
          params.action = 'update';
          params.args['data'] = { deletedAt: new Date() };
        }
        if (params.action === 'findUnique' || params.action === 'findFirst') {
          // Exclude deleted records
          params.args.where = {
            ...params.args.where,
            deletedAt: null,
          };
        }
      }
      return next(params);
    });
  }
}

// users/repositories/user.repository.ts
@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { permissions: true },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findAll(options: FindAllOptions): Promise<PaginatedResult<User>> {
    const { page = 1, limit = 20, search } = options;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { permissions: true },
        take: limit,
        skip,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async update(id: number, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async delete(id: number): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
```

---

## Authentication & Authorization

### JWT Authentication Strategy

```typescript
// auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const { sub: userId } = payload;
    const user = await this.userService.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return user; // Attached to request.user
  }
}

// auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
  ) {}

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    // Validate credentials
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.passwordService.verify(
      user.password,
      dto.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user);

    // Update last login
    await this.userService.updateLastLogin(user.id);

    return {
      accessToken,
      refreshToken,
      user: plainToInstance(UserResponseDto, user),
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const user = await this.userService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException();
      }

      const accessToken = await this.generateAccessToken(user);
      const newRefreshToken = await this.generateRefreshToken(user);

      return {
        accessToken,
        refreshToken: newRefreshToken,
        user: plainToInstance(UserResponseDto, user),
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async generateAccessToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.signAsync(payload, {
      expiresIn: '15m',
    });
  }

  private async generateRefreshToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });
  }
}
```

### Role-Based Access Control (RBAC)

```typescript
// common/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    return requiredRoles.some(role => user.role === role);
  }
}

// common/decorators/roles.decorator.ts
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

// Usage
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Get('users')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getAllUsers(): Promise<User[]> {
    return this.userService.findAll();
  }

  @Delete('users/:id')
  @Roles(Role.SUPER_ADMIN) // Only super admin
  async deleteUser(@Param('id') id: number): Promise<void> {
    await this.userService.delete(id);
  }
}
```

### Permission-Based Authorization

```typescript
// common/guards/permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      'permissions',
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user || !user.permissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const hasPermission = requiredPermissions.every(required =>
      user.permissions.some(permission => permission.name === required),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Required permissions: ${requiredPermissions.join(', ')}`,
      );
    }

    return true;
  }
}

// common/decorators/permissions.decorator.ts
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata('permissions', permissions);

// Usage
@Controller('posts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PostsController {
  @Post()
  @RequirePermissions(Permission.POST_CREATE)
  async create(@Body() dto: CreatePostDto): Promise<Post> {
    return this.postsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.POST_UPDATE, Permission.POST_UPDATE_OWN)
  async update(
    @Param('id') id: number,
    @Body() dto: UpdatePostDto,
    @CurrentUser() user: User,
  ): Promise<Post> {
    // Check if user owns the post or has general update permission
    const post = await this.postsService.findById(id);
    if (post.authorId !== user.id && !user.permissions.includes(Permission.POST_UPDATE)) {
      throw new ForbiddenException();
    }
    return this.postsService.update(id, dto);
  }
}
```

---

## GraphQL Integration

### GraphQL Module Setup

```typescript
// app.module.ts
@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: true,
      context: ({ req }) => ({ req }),
      formatError: (error) => {
        const originalError = error.extensions?.originalError as any;
        return {
          message: error.message,
          code: error.extensions?.code,
          statusCode: originalError?.statusCode,
        };
      },
    }),
  ],
})
export class AppModule {}
```

### GraphQL Resolvers

```typescript
// users/dto/user.object-type.ts
@ObjectType()
export class UserObjectType {
  @Field(() => ID)
  id: number;

  @Field()
  email: string;

  @Field({ nullable: true })
  name?: string;

  @Field(() => RoleEnum)
  role: Role;

  @Field()
  isActive: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => [OrderObjectType])
  orders: OrderObjectType[];
}

// users/dto/create-user.input.ts
@InputType()
export class CreateUserInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @MinLength(8)
  password: string;

  @Field({ nullable: true })
  @MaxLength(100)
  name?: string;
}

// users/resolvers/user.resolver.ts
@Resolver(() => UserObjectType)
export class UserResolver {
  constructor(
    private readonly userService: UserService,
    private readonly ordersService: OrdersService,
  ) {}

  @Query(() => UserObjectType, { name: 'user' })
  @UseGuards(GqlAuthGuard)
  async getUser(@Args('id', { type: () => Int }) id: number): Promise<User> {
    return this.userService.findById(id);
  }

  @Query(() => [UserObjectType], { name: 'users' })
  @UseGuards(GqlAuthGuard, GqlRolesGuard)
  @Roles(Role.ADMIN)
  async getUsers(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('search', { nullable: true }) search?: string,
  ): Promise<User[]> {
    const result = await this.userService.findAll({ page, limit, search });
    return result.data;
  }

  @Mutation(() => UserObjectType)
  async createUser(
    @Args('input') input: CreateUserInput,
  ): Promise<User> {
    return this.userService.create(input);
  }

  @Mutation(() => UserObjectType)
  @UseGuards(GqlAuthGuard)
  async updateUser(
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateUserInput,
    @CurrentUser() currentUser: User,
  ): Promise<User> {
    if (currentUser.id !== id && !currentUser.isAdmin) {
      throw new ForbiddenException('Cannot update other users');
    }
    return this.userService.update(id, input);
  }

  // Field resolver (N+1 solution with DataLoader)
  @ResolveField(() => [OrderObjectType])
  async orders(
    @Parent() user: UserObjectType,
    @Loader(OrdersLoader) ordersLoader: DataLoader<number, Order[]>,
  ): Promise<Order[]> {
    return ordersLoader.load(user.id);
  }
}

// DataLoader for batching
@Injectable()
export class OrdersLoader implements NestDataLoader<number, Order[]> {
  constructor(private readonly ordersService: OrdersService) {}

  generateDataLoader(): DataLoader<number, Order[]> {
    return new DataLoader<number, Order[]>(async (userIds: number[]) => {
      const orders = await this.ordersService.findByUserIds(userIds);

      // Group orders by userId
      const ordersMap = new Map<number, Order[]>();
      orders.forEach(order => {
        const userOrders = ordersMap.get(order.userId) || [];
        userOrders.push(order);
        ordersMap.set(order.userId, userOrders);
      });

      // Return in same order as userIds
      return userIds.map(id => ordersMap.get(id) || []);
    });
  }
}
```

### GraphQL Subscriptions

```typescript
// users/resolvers/user.resolver.ts
@Resolver(() => UserObjectType)
export class UserResolver {
  constructor(
    private readonly userService: UserService,
    @Inject('PUB_SUB') private pubSub: PubSub,
  ) {}

  @Mutation(() => UserObjectType)
  async createUser(@Args('input') input: CreateUserInput): Promise<User> {
    const user = await this.userService.create(input);

    // Publish event
    await this.pubSub.publish('userCreated', { userCreated: user });

    return user;
  }

  @Subscription(() => UserObjectType, {
    filter: (payload, variables) => {
      // Optional: filter subscriptions
      return payload.userCreated.role === variables.role;
    },
  })
  @UseGuards(GqlAuthGuard)
  userCreated(@Args('role', { nullable: true }) role?: Role) {
    return this.pubSub.asyncIterator('userCreated');
  }
}

// app.module.ts - Setup PubSub
@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      installSubscriptionHandlers: true,
      subscriptions: {
        'graphql-ws': true,
      },
    }),
  ],
  providers: [
    {
      provide: 'PUB_SUB',
      useValue: new PubSub(),
    },
  ],
})
export class AppModule {}
```

---

## Microservices Architecture

### TCP Microservice

```typescript
// microservices/users/main.ts
async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        host: '0.0.0.0',
        port: 3001,
      },
    },
  );
  await app.listen();
}

// microservices/users/users.controller.ts
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @MessagePattern({ cmd: 'get_user' })
  async getUser(@Payload() data: { id: number }): Promise<User> {
    return this.usersService.findById(data.id);
  }

  @MessagePattern({ cmd: 'create_user' })
  async createUser(@Payload() data: CreateUserDto): Promise<User> {
    return this.usersService.create(data);
  }

  @EventPattern('user_created')
  async handleUserCreated(@Payload() data: User) {
    console.log('User created event received:', data.id);
    // Handle event (send email, update analytics, etc.)
  }
}

// API Gateway
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'USERS_SERVICE',
        transport: Transport.TCP,
        options: {
          host: 'localhost',
          port: 3001,
        },
      },
    ]),
  ],
})
export class AppModule {}

@Controller('users')
export class UsersGatewayController {
  constructor(
    @Inject('USERS_SERVICE') private readonly usersClient: ClientProxy,
  ) {}

  @Get(':id')
  async getUser(@Param('id') id: number): Promise<User> {
    return firstValueFrom(
      this.usersClient.send({ cmd: 'get_user' }, { id }),
    );
  }

  @Post()
  async createUser(@Body() dto: CreateUserDto): Promise<User> {
    const user = await firstValueFrom(
      this.usersClient.send({ cmd: 'create_user' }, dto),
    );

    // Emit event
    this.usersClient.emit('user_created', user);

    return user;
  }
}
```

### RabbitMQ Microservice

```typescript
// microservices/orders/main.ts
async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL],
        queue: 'orders_queue',
        queueOptions: {
          durable: true,
        },
      },
    },
  );
  await app.listen();
}

// microservices/orders/orders.controller.ts
@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @MessagePattern('create_order')
  async createOrder(@Payload() data: CreateOrderDto): Promise<Order> {
    return this.ordersService.create(data);
  }

  @EventPattern('payment_processed')
  async handlePaymentProcessed(@Payload() data: PaymentProcessedEvent) {
    await this.ordersService.updateOrderStatus(data.orderId, OrderStatus.PAID);
  }
}

// API Gateway with RabbitMQ
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'ORDERS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL],
          queue: 'orders_queue',
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
  ],
})
export class AppModule {}
```

### Redis Microservice (Pub/Sub)

```typescript
// microservices/notifications/main.ts
async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.REDIS,
      options: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
      },
    },
  );
  await app.listen();
}

// microservices/notifications/notifications.controller.ts
@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @EventPattern('send_notification')
  async handleSendNotification(@Payload() data: SendNotificationEvent) {
    await this.notificationsService.send(data);
  }
}
```

---

## Advanced Patterns

### Interceptors

```typescript
// common/interceptors/logging.interceptor.ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body } = request;
    const now = Date.now();

    this.logger.log(`Incoming Request: ${method} ${url}`);

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const delay = Date.now() - now;
        this.logger.log(
          `Completed: ${method} ${url} ${response.statusCode} - ${delay}ms`,
        );
      }),
      catchError((error) => {
        const delay = Date.now() - now;
        this.logger.error(
          `Failed: ${method} ${url} - ${delay}ms - ${error.message}`,
        );
        throw error;
      }),
    );
  }
}

// common/interceptors/transform.interceptor.ts
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}

// common/interceptors/cache.interceptor.ts
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const cacheKey = `cache:${request.method}:${request.url}`;

    // Check cache
    const cachedResponse = await this.cacheManager.get(cacheKey);
    if (cachedResponse) {
      return of(cachedResponse);
    }

    // Execute handler and cache result
    return next.handle().pipe(
      tap(async (response) => {
        await this.cacheManager.set(cacheKey, response, 60); // 60s TTL
      }),
    );
  }
}

// Usage
@Controller('users')
@UseInterceptors(LoggingInterceptor, TransformInterceptor, CacheInterceptor)
export class UsersController {
  // All endpoints in this controller use these interceptors
}
```

### Pipes

```typescript
// common/pipes/parse-json.pipe.ts
@Injectable()
export class ParseJsonPipe implements PipeTransform {
  transform(value: string): any {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new BadRequestException('Invalid JSON format');
    }
  }
}

// common/pipes/validation.pipe.ts
@Injectable()
export class CustomValidationPipe implements PipeTransform {
  async transform(value: any, metadata: ArgumentMetadata) {
    if (!metadata.metatype || !this.toValidate(metadata.metatype)) {
      return value;
    }

    const object = plainToInstance(metadata.metatype, value);
    const errors = await validate(object);

    if (errors.length > 0) {
      const messages = errors.map(error => ({
        field: error.property,
        constraints: error.constraints,
      }));
      throw new BadRequestException({
        message: 'Validation failed',
        errors: messages,
      });
    }

    return value;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}

// Usage
@Post()
async create(
  @Body(new ParseJsonPipe(), CustomValidationPipe) dto: CreateUserDto,
): Promise<User> {
  return this.userService.create(dto);
}
```

### Event Emitters

```typescript
// users/users.service.ts
@Injectable()
export class UsersService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const user = await this.repository.create(dto);

    // Emit synchronous event
    this.eventEmitter.emit('user.created', user);

    // Emit async event
    this.eventEmitter.emitAsync('user.created.async', user);

    return user;
  }
}

// users/listeners/user-created.listener.ts
@Injectable()
export class UserCreatedListener {
  constructor(
    private readonly emailService: EmailService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @OnEvent('user.created')
  handleUserCreated(user: User) {
    console.log(`User created: ${user.id}`);
    // Send welcome email
    this.emailService.sendWelcome(user.email, user.name);
  }

  @OnEvent('user.created.async')
  async handleUserCreatedAsync(user: User) {
    // Async operations
    await this.analyticsService.trackUserCreated(user);
  }

  @OnEvent('user.*', { async: true })
  async handleAllUserEvents(payload: any) {
    // Handle all user events (created, updated, deleted)
    console.log('User event:', payload);
  }
}
```

### CQRS Pattern

```typescript
// commands/create-user.command.ts
export class CreateUserCommand {
  constructor(
    public readonly email: string,
    public readonly password: string,
    public readonly name?: string,
  ) {}
}

// commands/handlers/create-user.handler.ts
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    private readonly repository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateUserCommand): Promise<User> {
    const { email, password, name } = command;

    // Check if user exists
    const existing = await this.repository.findByEmail(email);
    if (existing) {
      throw new ConflictException('User already exists');
    }

    // Hash password
    const hashedPassword = await this.passwordService.hash(password);

    // Create user
    const user = await this.repository.create({
      email,
      password: hashedPassword,
      name,
    });

    // Publish domain event
    this.eventBus.publish(new UserCreatedEvent(user.id, user.email));

    return user;
  }
}

// queries/get-user.query.ts
export class GetUserQuery {
  constructor(public readonly id: number) {}
}

// queries/handlers/get-user.handler.ts
@QueryHandler(GetUserQuery)
export class GetUserHandler implements IQueryHandler<GetUserQuery> {
  constructor(private readonly repository: UserRepository) {}

  async execute(query: GetUserQuery): Promise<User> {
    return this.repository.findById(query.id);
  }
}

// events/user-created.event.ts
export class UserCreatedEvent {
  constructor(
    public readonly userId: number,
    public readonly email: string,
  ) {}
}

// events/handlers/user-created.handler.ts
@EventsHandler(UserCreatedEvent)
export class UserCreatedHandler implements IEventHandler<UserCreatedEvent> {
  constructor(private readonly emailService: EmailService) {}

  async handle(event: UserCreatedEvent) {
    await this.emailService.sendWelcome(event.email);
  }
}

// Controller using CQRS
@Controller('users')
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<User> {
    return this.commandBus.execute(
      new CreateUserCommand(dto.email, dto.password, dto.name),
    );
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<User> {
    return this.queryBus.execute(new GetUserQuery(id));
  }
}
```

---

## Testing Strategies

### Unit Testing Services

```typescript
// users/services/user.service.spec.ts
describe('UserService', () => {
  let service: UserService;
  let repository: MockType<UserRepository>;
  let passwordService: MockType<PasswordService>;
  let eventEmitter: MockType<EventEmitter2>;
  let cacheManager: MockType<Cache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: UserRepository,
          useFactory: mockRepository,
        },
        {
          provide: PasswordService,
          useFactory: mockPasswordService,
        },
        {
          provide: EventEmitter2,
          useFactory: mockEventEmitter,
        },
        {
          provide: CACHE_MANAGER,
          useFactory: mockCacheManager,
        },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    repository = module.get(UserRepository);
    passwordService = module.get(PasswordService);
    eventEmitter = module.get(EventEmitter2);
    cacheManager = module.get(CACHE_MANAGER);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should return cached user if exists', async () => {
      const cachedUser = { id: 1, email: 'test@test.com' };
      cacheManager.get.mockResolvedValue(cachedUser);

      const result = await service.findById(1);

      expect(result).toEqual(cachedUser);
      expect(cacheManager.get).toHaveBeenCalledWith('user:1');
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache if not cached', async () => {
      const user = { id: 1, email: 'test@test.com' };
      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(user);

      const result = await service.findById(1);

      expect(result).toEqual(user);
      expect(repository.findById).toHaveBeenCalledWith(1);
      expect(cacheManager.set).toHaveBeenCalledWith('user:1', user, 3600);
    });
  });

  describe('create', () => {
    const dto: CreateUserDto = {
      email: 'test@test.com',
      password: 'Pass123!',
      name: 'Test User',
    };

    it('should hash password and create user', async () => {
      const hashedPassword = 'hashed_password';
      const createdUser = { id: 1, ...dto, password: hashedPassword };

      repository.findByEmail.mockResolvedValue(null);
      passwordService.hash.mockResolvedValue(hashedPassword);
      repository.create.mockResolvedValue(createdUser);

      const result = await service.create(dto);

      expect(repository.findByEmail).toHaveBeenCalledWith(dto.email);
      expect(passwordService.hash).toHaveBeenCalledWith(dto.password);
      expect(repository.create).toHaveBeenCalledWith({
        ...dto,
        password: hashedPassword,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.created', { user: createdUser });
      expect(cacheManager.del).toHaveBeenCalledWith('users:list');
      expect(result).toEqual(createdUser);
    });

    it('should throw ConflictException if user exists', async () => {
      repository.findByEmail.mockResolvedValue({ id: 1, email: dto.email });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      await expect(service.create(dto)).rejects.toThrow('User with this email already exists');

      expect(passwordService.hash).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update user successfully', async () => {
      const existingUser = { id: 1, email: 'old@test.com', name: 'Old Name' };
      const dto: UpdateUserDto = { name: 'New Name' };
      const updatedUser = { ...existingUser, ...dto };

      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(existingUser);
      repository.save.mockResolvedValue(updatedUser);

      const result = await service.update(1, dto);

      expect(repository.save).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalledWith('user:1');
      expect(eventEmitter.emit).toHaveBeenCalledWith('user.updated', { user: updatedUser });
      expect(result).toEqual(updatedUser);
    });

    it('should validate email uniqueness when changing email', async () => {
      const existingUser = { id: 1, email: 'old@test.com' };
      const dto: UpdateUserDto = { email: 'new@test.com' };

      cacheManager.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(existingUser);
      repository.findByEmail.mockResolvedValue({ id: 2, email: dto.email });

      await expect(service.update(1, dto)).rejects.toThrow(ConflictException);
      await expect(service.update(1, dto)).rejects.toThrow('Email already in use');
    });
  });
});
```

### Integration Testing

```typescript
// users/users.controller.integration.spec.ts
describe('UsersController (Integration)', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: 'localhost',
          port: 5433, // Test database port
          username: 'test',
          password: 'test',
          database: 'test_db',
          entities: [User, Order, Permission],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User]),
        UsersModule,
        AuthModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    userRepository = module.get('UserRepository');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean database before each test
    await userRepository.clear();
  });

  describe('POST /users', () => {
    it('should create a new user', async () => {
      const dto: CreateUserDto = {
        email: 'test@test.com',
        password: 'Pass123!',
        name: 'Test User',
      };

      const response = await request(app.getHttpServer())
        .post('/users')
        .send(dto)
        .expect(201);

      expect(response.body).toMatchObject({
        email: dto.email,
        name: dto.name,
      });
      expect(response.body.password).toBeUndefined(); // Should not expose password

      // Verify database
      const user = await userRepository.findOne({ where: { email: dto.email } });
      expect(user).toBeDefined();
      expect(user.password).not.toBe(dto.password); // Should be hashed
    });

    it('should return 400 for invalid email', async () => {
      const dto = {
        email: 'invalid-email',
        password: 'Pass123!',
      };

      const response = await request(app.getHttpServer())
        .post('/users')
        .send(dto)
        .expect(400);

      expect(response.body.message).toContain('Invalid email format');
    });

    it('should return 409 for duplicate email', async () => {
      const dto: CreateUserDto = {
        email: 'test@test.com',
        password: 'Pass123!',
      };

      // Create first user
      await request(app.getHttpServer())
        .post('/users')
        .send(dto)
        .expect(201);

      // Attempt to create duplicate
      const response = await request(app.getHttpServer())
        .post('/users')
        .send(dto)
        .expect(409);

      expect(response.body.message).toContain('already exists');
    });
  });

  describe('GET /users/:id', () => {
    it('should return user by id', async () => {
      // Create user
      const user = await userRepository.save({
        email: 'test@test.com',
        password: 'hashed',
        name: 'Test User',
      });

      // Get access token
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: user.email, password: 'Pass123!' });

      const token = loginResponse.body.accessToken;

      // Get user
      const response = await request(app.getHttpServer())
        .get(`/users/${user.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: user.id,
        email: user.email,
        name: user.name,
      });
      expect(response.body.password).toBeUndefined();
    });

    it('should return 404 for non-existent user', async () => {
      await request(app.getHttpServer())
        .get('/users/999')
        .expect(404);
    });

    it('should return 401 without authentication', async () => {
      await request(app.getHttpServer())
        .get('/users/1')
        .expect(401);
    });
  });
});
```

### E2E Testing

```typescript
// test/users.e2e-spec.ts
describe('Users E2E', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('User Registration and Authentication Flow', () => {
    const userDto: CreateUserDto = {
      email: 'e2e@test.com',
      password: 'Pass123!',
      name: 'E2E User',
    };

    it('should register a new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send(userDto)
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body.user).toMatchObject({
        email: userDto.email,
        name: userDto.name,
      });

      authToken = response.body.accessToken;
    });

    it('should login with registered user', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userDto.email,
          password: userDto.password,
        })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });

    it('should access protected profile endpoint', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.email).toBe(userDto.email);
    });

    it('should update profile', async () => {
      const updateDto = { name: 'Updated Name' };

      const response = await request(app.getHttpServer())
        .patch('/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateDto)
        .expect(200);

      expect(response.body.name).toBe(updateDto.name);
    });

    it('should refresh access token', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: userDto.email,
          password: userDto.password,
        });

      const refreshToken = loginResponse.body.refreshToken;

      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
    });
  });
});
```

---

## Performance Optimization

### Redis Caching

```typescript
// cache/cache.module.ts
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        store: redisStore,
        host: configService.get('REDIS_HOST'),
        port: configService.get('REDIS_PORT'),
        ttl: 3600, // Default TTL in seconds
      }),
      inject: [ConfigService],
      isGlobal: true,
    }),
  ],
})
export class CacheConfigModule {}

// Advanced caching patterns
@Injectable()
export class UserService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly repository: UserRepository,
  ) {}

  // Cache-aside pattern
  async findById(id: number): Promise<User> {
    const cacheKey = `user:${id}`;

    // Try cache first
    const cached = await this.cacheManager.get<User>(cacheKey);
    if (cached) return cached;

    // Fetch from DB
    const user = await this.repository.findById(id);

    // Store in cache
    await this.cacheManager.set(cacheKey, user, 3600);

    return user;
  }

  // Cache invalidation
  async update(id: number, dto: UpdateUserDto): Promise<User> {
    const user = await this.repository.update(id, dto);

    // Invalidate cache
    await this.cacheManager.del(`user:${id}`);
    await this.cacheManager.del('users:list');

    return user;
  }

  // Cache refresh strategy
  async refreshCache(id: number): Promise<void> {
    const user = await this.repository.findById(id);
    await this.cacheManager.set(`user:${id}`, user, 3600);
  }
}
```

### Background Jobs with Bull

```typescript
// queues/email.queue.ts
@Injectable()
export class EmailQueue {
  constructor(
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  async sendWelcomeEmail(email: string, name: string): Promise<void> {
    await this.emailQueue.add('welcome', {
      email,
      name,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: true,
    });
  }

  async sendPasswordReset(email: string, token: string): Promise<void> {
    await this.emailQueue.add('password-reset', {
      email,
      token,
    }, {
      priority: 1, // High priority
      attempts: 5,
    });
  }
}

// processors/email.processor.ts
@Processor('email')
export class EmailProcessor {
  constructor(private readonly emailService: EmailService) {}

  @Process('welcome')
  async sendWelcomeEmail(job: Job<{ email: string; name: string }>) {
    const { email, name } = job.data;
    await this.emailService.sendWelcome(email, name);
    return { sent: true };
  }

  @Process('password-reset')
  async sendPasswordReset(job: Job<{ email: string; token: string }>) {
    const { email, token } = job.data;
    await this.emailService.sendPasswordReset(email, token);
    return { sent: true };
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    console.log(`Job ${job.id} completed`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    console.error(`Job ${job.id} failed:`, error.message);
  }
}

// Module setup
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  providers: [EmailQueue, EmailProcessor],
  exports: [EmailQueue],
})
export class EmailQueueModule {}
```

### Rate Limiting

```typescript
// main.ts
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later',
  }),
);

// Custom rate limiter per endpoint
@Injectable()
export class CustomRateLimitGuard implements CanActivate {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const ip = request.ip;
    const endpoint = `${request.method}:${request.path}`;
    const key = `rate-limit:${ip}:${endpoint}`;

    const current = await this.cacheManager.get<number>(key);

    if (!current) {
      await this.cacheManager.set(key, 1, 60); // 1 minute window
      return true;
    }

    if (current >= 10) { // Max 10 requests per minute
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.cacheManager.set(key, current + 1, 60);
    return true;
  }
}

// Usage
@Controller('auth')
@UseGuards(CustomRateLimitGuard)
export class AuthController {
  @Post('login')
  async login(@Body() dto: LoginDto) {
    // Protected by rate limiter
  }
}
```

### Database Query Optimization

```typescript
// Prevent N+1 queries
@Injectable()
export class UserService {
  // Bad: N+1 problem
  async getUsersWithOrdersBad(): Promise<User[]> {
    const users = await this.userRepository.find();
    for (const user of users) {
      user.orders = await this.orderRepository.findByUserId(user.id); // N queries
    }
    return users;
  }

  // Good: Use relations
  async getUsersWithOrdersGood(): Promise<User[]> {
    return this.userRepository.find({
      relations: ['orders'], // 1 query with JOIN
    });
  }

  // Better: Use QueryBuilder for complex queries
  async getUsersWithOrdersOptimized(): Promise<User[]> {
    return this.userRepository.createQueryBuilder('user')
      .leftJoinAndSelect('user.orders', 'order')
      .where('user.isActive = :isActive', { isActive: true })
      .andWhere('order.total > :minTotal', { minTotal: 100 })
      .getMany();
  }
}

// Pagination optimization
async findAll(page: number, limit: number): Promise<PaginatedResult<User>> {
  const skip = (page - 1) * limit;

  // Use take/skip instead of LIMIT/OFFSET for better performance
  const query = this.repository.createQueryBuilder('user')
    .take(limit)
    .skip(skip);

  // Use getManyAndCount for pagination
  const [users, total] = await query.getManyAndCount();

  return {
    data: users,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

// Index optimization
@Entity('users')
@Index(['email', 'isActive']) // Composite index
export class User {
  @Column({ unique: true })
  @Index() // Single column index
  email: string;

  @Column()
  isActive: boolean;

  // Full-text search index
  @Index({ fulltext: true })
  @Column('text')
  bio: string;
}
```

---

## Deployment & Production

### Health Checks

```typescript
// health/health.controller.ts
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private redis: RedisHealthIndicator,
    private disk: DiskHealthIndicator,
    private memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.pingCheck('redis'),
      () => this.disk.checkStorage('storage', { path: '/', thresholdPercent: 0.9 }),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
    ]);
  }

  @Get('liveness')
  @HealthCheck()
  liveness() {
    // Simple liveness probe for Kubernetes
    return { status: 'ok' };
  }

  @Get('readiness')
  @HealthCheck()
  async readiness() {
    // Check if app is ready to accept traffic
    return this.health.check([
      () => this.db.pingCheck('database'),
    ]);
  }
}
```

### Logging

```typescript
// common/logger/logger.service.ts
@Injectable()
export class LoggerService implements LoggerService {
  private logger: winston.Logger;

  constructor(private configService: ConfigService) {
    this.logger = winston.createLogger({
      level: configService.get('LOG_LEVEL') || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: { service: 'nestjs-app' },
      transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
      ],
    });

    if (process.env.NODE_ENV !== 'production') {
      this.logger.add(new winston.transports.Console({
        format: winston.format.simple(),
      }));
    }
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }
}
```

### Environment Configuration

```typescript
// config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  database: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
});

// config/validation.schema.ts
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
});

// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      validationSchema,
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:18-alpine AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - REDIS_HOST=redis
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=nestjs
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=nestjs_db
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres-data:
```

---

## Additional Resources

### Official Documentation
- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeORM Documentation](https://typeorm.io/)
- [Prisma Documentation](https://www.prisma.io/docs/)

### Community Resources
- [NestJS Discord](https://discord.gg/nestjs)
- [Awesome NestJS](https://github.com/juliandavidmr/awesome-nestjs)

### Best Practices
- Follow the principle of single responsibility
- Use dependency injection for loose coupling
- Write comprehensive tests (≥80% coverage)
- Implement proper error handling
- Use DTOs for data validation
- Document APIs with OpenAPI/Swagger
- Monitor performance and set up alerts
- Use environment variables for configuration
- Implement health checks for production
- Follow security best practices (OWASP Top 10)

---

*For quick reference patterns, see [SKILL.md](./SKILL.md)*
*For code templates, see [templates/](./templates/)*
*For real-world examples, see [examples/](./examples/)*
