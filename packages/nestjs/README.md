# @fortium/ensemble-nestjs

NestJS backend framework skills for Claude Code AI-Augmented Development

## Overview

The `@fortium/ensemble-nestjs` plugin provides comprehensive NestJS framework expertise for the AI-Mesh development ecosystem. This plugin enables Claude Code to architect, develop, and maintain production-ready NestJS applications following enterprise patterns and best practices.

## Features

- **Enterprise Architecture**: Modular design with dependency injection and clean separation of concerns
- **RESTful API Development**: Complete CRUD patterns with OpenAPI/Swagger documentation
- **Authentication & Authorization**: JWT-based security with RBAC and custom guards
- **Data Layer Abstraction**: Repository pattern with TypeORM/Prisma/Mongoose support
- **GraphQL Support**: Schema-first and code-first approaches with federation
- **Microservices Architecture**: TCP, RabbitMQ, Redis, and NATS patterns
- **Testing Excellence**: Unit (≥80%), integration (≥70%), and E2E (≥60%) testing strategies
- **Performance Optimization**: Caching, background jobs, query optimization
- **Code Generation Templates**: Production-ready templates for controllers, services, DTOs, and more

## Installation

### Via Claude Code Marketplace

```bash
claude plugin add @fortium/ensemble-nestjs
```

### Manual Installation

```bash
npm install @fortium/ensemble-nestjs
```

## Plugin Contents

### Skills Documentation

#### `skills/SKILL.md` (13KB)
Quick reference guide with essential patterns and best practices:
- Module Architecture
- Dependency Injection
- DTO Validation
- Repository Pattern
- Controller Best Practices
- Authentication & Authorization
- Exception Handling
- Testing Strategies
- Performance Patterns

#### `skills/REFERENCE.md` (72KB)
Comprehensive reference with advanced patterns:
- Architecture & Design Patterns
- Module System & Dependency Injection
- Controllers & Routing
- Services & Business Logic
- Data Layer & Persistence (TypeORM, Prisma, Mongoose)
- Authentication & Authorization (JWT, OAuth2, SAML)
- GraphQL Integration (Schema-first, Code-first, Federation)
- Microservices Architecture (TCP, RabbitMQ, Redis, NATS)
- Advanced Patterns (CQRS, Event Sourcing, Domain Events)
- Testing Strategies (Unit, Integration, E2E)
- Performance Optimization (Caching, Background Jobs, Query Optimization)
- Deployment & Production (Docker, Kubernetes, Health Checks, Monitoring)

#### `skills/VALIDATION.md` (18KB)
Feature parity validation against the original `nestjs-backend-expert.yaml` agent:
- 98.5% feature parity achieved
- Complete coverage validation
- Quality standards verification

### Code Generation Templates

All templates support variable substitution with placeholders:

#### `skills/templates/controller.template.ts` (5.8KB)
Production-ready controller with:
- OpenAPI/Swagger annotations
- Authentication guards
- DTO validation
- Response transformation
- CRUD operations (GET, POST, PATCH, DELETE)
- Pagination support

#### `skills/templates/service.template.ts` (6.4KB)
Service layer implementation with:
- Dependency injection
- Business logic separation
- Event emission
- Caching integration
- Error handling
- Soft delete support

#### `skills/templates/repository.template.ts` (4.6KB)
Data access layer with:
- TypeORM integration
- CRUD operations
- Custom query methods
- Transaction support
- Error handling

#### `skills/templates/dto.template.ts` (6.3KB)
Data Transfer Objects with:
- Request DTOs (Create, Update)
- Response DTOs with @Exclude for sensitive fields
- Validation decorators
- OpenAPI documentation
- Partial types

#### `skills/templates/entity.template.ts` (2.5KB)
Database entity with:
- TypeORM decorators
- Relationships
- Timestamps
- Soft delete columns

#### `skills/templates/module.template.ts` (1.6KB)
Module configuration with:
- Imports/exports
- Providers registration
- Controllers registration
- TypeORM feature imports

#### `skills/templates/service.spec.template.ts` (11.7KB)
Comprehensive unit tests with:
- Test setup with mocks
- CRUD operation tests
- Error scenario tests
- Edge case coverage
- ≥80% coverage patterns

#### `skills/templates/test-templates.js` (11.7KB)
Template testing utility:
- Variable substitution validation
- Template generation examples
- Test execution framework

### Real-World Examples

#### `skills/examples/user-management-crud.example.ts` (14.2KB)
Complete user management system demonstrating:
- Full CRUD operations with TypeORM
- JWT authentication and RBAC
- Input validation with class-validator
- Response transformation with DTOs
- Redis caching with cache-aside pattern
- Event emitting for domain events
- Soft delete with restore capability
- Pagination and filtering
- Comprehensive error handling

**Use cases:**
- Building entity CRUD operations
- Implementing role-based access control
- Adding caching to services
- Creating RESTful APIs with OpenAPI docs

#### `skills/examples/jwt-authentication.example.ts` (14.9KB)
Production-ready authentication system with:
- JWT token generation and validation
- Passport.js integration (JWT + Local strategies)
- Login/logout functionality
- Refresh token pattern
- Password hashing with bcrypt
- Custom guards (JwtAuthGuard, RolesGuard)
- Custom decorators (@CurrentUser, @Public, @Roles)
- E2E authentication tests

**Use cases:**
- Implementing authentication from scratch
- Adding JWT-based security
- Creating login/register endpoints
- Implementing token refresh mechanism

#### `skills/examples/README.md` (5.6KB)
Comprehensive guide for using examples:
- Copy and adaptation patterns
- Dependency installation
- Project configuration
- Environment variables
- Testing instructions
- Best practices checklist
- Common customizations

## Usage

After installation, this plugin's skills and templates are automatically available to Claude Code. The backend-developer agent will automatically load NestJS skills when working with NestJS projects.

### Automatic Skill Loading

The plugin integrates with the `backend-developer` agent which automatically detects NestJS projects by checking for:
- `package.json` with `@nestjs/common` dependency
- `nest-cli.json` configuration file
- TypeScript configuration with NestJS patterns
- File structure with `src/` and module organization

### Manual Usage

You can explicitly reference skills in prompts:

```
@skills/SKILL.md - Quick patterns and best practices
@skills/REFERENCE.md - Comprehensive guide with advanced patterns
@skills/templates/controller.template.ts - Generate controller
@skills/examples/user-management-crud.example.ts - CRUD example
```

### Code Generation with Templates

Templates use variable substitution with these placeholders:

- `{{EntityName}}` - PascalCase entity name (e.g., `User`)
- `{{entityName}}` - camelCase entity name (e.g., `user`)
- `{{entity-name}}` - kebab-case entity name (e.g., `user`)
- `{{entity-name-plural}}` - kebab-case plural (e.g., `users`)
- `{{endpoint-path}}` - API endpoint path (e.g., `api/v1/users`)
- `{{entity-display-name}}` - Human-readable name (e.g., `User`)

**Example: Generate a Product controller**

```typescript
// Replace placeholders:
{{EntityName}} → Product
{{entityName}} → product
{{entity-name}} → product
{{entity-name-plural}} → products
{{endpoint-path}} → api/v1/products
{{entity-display-name}} → Product
```

## Directory Structure

```
@fortium/ensemble-nestjs/
├── skills/                         # NestJS expertise and patterns
│   ├── SKILL.md                    # Quick reference (13KB)
│   ├── REFERENCE.md                # Comprehensive guide (72KB)
│   ├── VALIDATION.md               # Feature parity validation (18KB)
│   ├── templates/                  # Code generation templates
│   │   ├── controller.template.ts  # REST controller (5.8KB)
│   │   ├── service.template.ts     # Service layer (6.4KB)
│   │   ├── repository.template.ts  # Data access (4.6KB)
│   │   ├── dto.template.ts         # Data transfer objects (6.3KB)
│   │   ├── entity.template.ts      # Database entity (2.5KB)
│   │   ├── module.template.ts      # Module config (1.6KB)
│   │   ├── service.spec.template.ts # Unit tests (11.7KB)
│   │   ├── test-templates.js       # Template testing (11.7KB)
│   │   └── TEST-RESULTS.md         # Template validation (8.4KB)
│   └── examples/                   # Real-world examples
│       ├── user-management-crud.example.ts   # CRUD system (14.2KB)
│       ├── jwt-authentication.example.ts     # Auth system (14.9KB)
│       └── README.md               # Examples guide (5.6KB)
├── lib/                            # Library code
│   └── index.js                    # Entry point with metadata
├── .claude-plugin/                 # Plugin configuration
│   └── plugin.json                 # Plugin manifest
├── package.json                    # NPM package config
├── CHANGELOG.md                    # Version history
└── README.md                       # This file
```

## Framework Support

- **NestJS Version**: 8.0+ (recommended 10.4+)
- **Node.js**: 18+
- **TypeScript**: 5.0+
- **Databases**: PostgreSQL, MySQL, MongoDB, SQLite
- **ORMs**: TypeORM 0.3+, Prisma 5+, Mongoose 8+
- **Authentication**: Passport.js, JWT, OAuth2, SAML
- **Testing**: Jest 29+, Supertest

## Quality Standards

The plugin enforces these quality targets:

- **Service Coverage**: ≥80% (business logic)
- **Controller Coverage**: ≥70% (API endpoints)
- **E2E Coverage**: ≥60% (critical paths)
- **Overall Coverage**: ≥75%
- **Security**: OWASP Top 10 compliance
- **Performance**: Response time <200ms for standard operations
- **API Documentation**: 100% OpenAPI coverage

## Integration with AI-Mesh Ecosystem

This plugin is part of the AI-Mesh plugin ecosystem and works seamlessly with:

- **@fortium/ensemble-development** - Core development workflows and agents
- **@fortium/ensemble-react** - Frontend React framework (for full-stack apps)
- **@fortium/ensemble-blazor** - Blazor framework (for .NET full-stack)
- **Backend Agents**: Automatically loaded by `backend-developer` agent

## Dependencies

### Required
- **@fortium/ensemble-development**: ^4.0.0 (core agent system)

### Optional (for testing)
- **jest**: ^29.7.0 (unit testing framework)

## Examples and Use Cases

### 1. Building a RESTful API

Generate complete CRUD operations for a Product entity:

```typescript
// Use templates:
1. entity.template.ts → src/modules/products/entities/product.entity.ts
2. dto.template.ts → src/modules/products/dto/
3. repository.template.ts → src/modules/products/repositories/product.repository.ts
4. service.template.ts → src/modules/products/services/product.service.ts
5. controller.template.ts → src/modules/products/controllers/product.controller.ts
6. module.template.ts → src/modules/products/products.module.ts
7. service.spec.template.ts → src/modules/products/services/product.service.spec.ts
```

### 2. Implementing Authentication

Use the JWT authentication example:

```typescript
// Copy and adapt:
skills/examples/jwt-authentication.example.ts → src/modules/auth/

// Includes:
- JWT strategy with Passport.js
- Login/logout endpoints
- Refresh token mechanism
- Custom guards and decorators
- E2E tests
```

### 3. Adding GraphQL

Reference the GraphQL section in REFERENCE.md:

```
Section 7: GraphQL Integration
- Schema-first approach
- Code-first approach
- Federation patterns
- Resolvers and data loaders
```

### 4. Microservices Communication

Reference the Microservices section in REFERENCE.md:

```
Section 8: Microservices Architecture
- TCP transport
- RabbitMQ message queues
- Redis pub/sub
- NATS streaming
```

## Testing

The plugin includes comprehensive testing support:

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

All templates include corresponding test files with ≥80% coverage patterns.

## Documentation

- **Quick Reference**: `skills/SKILL.md` - Essential patterns (5 min read)
- **Comprehensive Guide**: `skills/REFERENCE.md` - Advanced patterns (30 min read)
- **Examples**: `skills/examples/README.md` - Real-world implementations
- **Templates**: `skills/templates/` - Code generation templates
- **Validation**: `skills/VALIDATION.md` - Feature parity verification

## Version History

See [CHANGELOG.md](./CHANGELOG.md) for version history and migration notes.

## Support

- **Documentation**: [AI-Mesh Plugins Repository](https://github.com/FortiumPartners/ensemble)
- **Issues**: [GitHub Issues](https://github.com/FortiumPartners/ensemble/issues)
- **Discussions**: [GitHub Discussions](https://github.com/FortiumPartners/ensemble/discussions)

## License

MIT - See [LICENSE](../../LICENSE) for details.

## Contributing

See the [main repository](https://github.com/FortiumPartners/ensemble) for contribution guidelines.

## Credits

Extracted from ensemble v3.x monolith as part of the plugin architecture migration. Originally developed by the Fortium Partners team as part of the Leo AI-Augmented Development Process.

---

**Part of the AI-Mesh Plugin Ecosystem**
Professional AI-augmented development for Claude Code
