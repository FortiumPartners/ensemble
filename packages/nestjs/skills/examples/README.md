# NestJS Framework Examples

Real-world implementation examples demonstrating production-ready patterns and best practices.

## Available Examples

### 1. user-management-crud.example.ts

**Complete CRUD Implementation**

Demonstrates:
- ✅ Full CRUD operations with TypeORM
- ✅ JWT authentication and RBAC authorization
- ✅ Input validation with class-validator
- ✅ Response transformation with DTOs
- ✅ Redis caching with cache-aside pattern
- ✅ Event emitting for domain events
- ✅ Soft delete with restore capability
- ✅ Pagination and filtering
- ✅ Comprehensive error handling

**Use this example when:**
- Building entity CRUD operations
- Implementing role-based access control
- Adding caching to your services
- Creating RESTful APIs with OpenAPI docs

**Key sections:**
1. Entity definition with TypeORM
2. DTOs with validation decorators
3. Repository pattern implementation
4. Service layer with business logic
5. Controller with authentication
6. Module configuration
7. Event listeners

### 2. jwt-authentication.example.ts

**JWT Authentication System**

Demonstrates:
- ✅ JWT token generation and validation
- ✅ Passport.js integration (JWT + Local strategies)
- ✅ Login/logout functionality
- ✅ Refresh token pattern
- ✅ Password hashing with bcrypt
- ✅ Custom guards (JwtAuthGuard, RolesGuard)
- ✅ Custom decorators (@CurrentUser, @Public, @Roles)
- ✅ E2E authentication tests

**Use this example when:**
- Implementing authentication from scratch
- Adding JWT-based security
- Creating login/register endpoints
- Implementing token refresh mechanism

**Key sections:**
1. JWT Strategy with Passport
2. Local Strategy for username/password
3. AuthService with token generation
4. AuthController with public endpoints
5. Custom guards and decorators
6. Module configuration
7. Environment variables
8. Testing examples

## How to Use These Examples

### 1. Copy the Pattern

Each example is self-contained and can be adapted to your needs:

```bash
# Copy entity definition
cp examples/user-management-crud.example.ts src/modules/users/

# Adapt to your domain
# Replace "User" with your entity name
# Customize fields and validation rules
```

### 2. Install Dependencies

```bash
npm install @nestjs/common @nestjs/core @nestjs/typeorm
npm install @nestjs/jwt @nestjs/passport passport passport-jwt
npm install @nestjs/cache-manager cache-manager
npm install @nestjs/event-emitter
npm install class-validator class-transformer
npm install bcrypt
npm install --save-dev @types/bcrypt @types/passport-jwt
```

### 3. Configure Your Project

Add to your `app.module.ts`:

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({ /* config */ }),
    CacheModule.register({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
```

### 4. Environment Variables

Create `.env` file:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=password
DB_NAME=nestjs_db

# JWT
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRES_IN=7d

# Redis (optional)
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Code Generation

Use the templates in `../templates/` directory to generate boilerplate:

```bash
# Generate a new resource
nest g resource products

# Then adapt the templates to your needs
```

## Testing

Each example includes test scenarios. Run tests with:

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

## Best Practices Checklist

When implementing these patterns, ensure:

- [ ] **Validation**: All inputs validated with class-validator
- [ ] **Security**: Passwords hashed, JWT secrets strong
- [ ] **Error Handling**: Proper exception types and messages
- [ ] **Caching**: Implemented for frequently accessed data
- [ ] **Events**: Domain events emitted for side effects
- [ ] **Documentation**: OpenAPI/Swagger annotations
- [ ] **Testing**: Unit and E2E tests with ≥80% coverage
- [ ] **Logging**: Comprehensive logging for debugging
- [ ] **Pagination**: Implemented for list endpoints
- [ ] **Soft Delete**: Preserve data with soft delete

## Common Customizations

### Change Database from PostgreSQL to MySQL

```typescript
// In TypeORM config
{
  type: 'mysql',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  // ... rest of config
}
```

### Use Prisma Instead of TypeORM

See `REFERENCE.md` section "Data Layer & Persistence" for Prisma examples.

### Add GraphQL Support

See `REFERENCE.md` section "GraphQL Integration" for resolver examples.

### Implement Microservices

See `REFERENCE.md` section "Microservices Architecture" for TCP, RabbitMQ, and Redis patterns.

## Related Documentation

- [SKILL.md](../SKILL.md) - Quick reference patterns
- [REFERENCE.md](../REFERENCE.md) - Comprehensive guide
- [templates/](../templates/) - Code generation templates

## Need Help?

Refer to the comprehensive patterns in `REFERENCE.md`:

- **Architecture** → Section 1: Architecture & Design Patterns
- **Authentication** → Section 6: Authentication & Authorization
- **GraphQL** → Section 7: GraphQL Integration
- **Testing** → Section 10: Testing Strategies
- **Performance** → Section 11: Performance Optimization
- **Deployment** → Section 12: Deployment & Production

## Version Compatibility

These examples are compatible with:
- NestJS: 8.0+ (recommended 10.4+)
- TypeORM: 0.3+
- Node.js: 18+
- TypeScript: 5.0+
