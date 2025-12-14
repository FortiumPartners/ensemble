# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-10

### Added

- **Complete NestJS Framework Skill Extraction** from ensemble v3.x monolith
- **Skills Documentation** (102KB total)
  - `SKILL.md` (13KB) - Quick reference with essential patterns
  - `REFERENCE.md` (72KB) - Comprehensive guide with advanced patterns
  - `VALIDATION.md` (18KB) - Feature parity validation (98.5% achieved)
- **Code Generation Templates** (8 templates, 58KB total)
  - `controller.template.ts` (5.8KB) - Production-ready REST controllers
  - `service.template.ts` (6.4KB) - Service layer with DI and business logic
  - `repository.template.ts` (4.6KB) - Data access layer with TypeORM
  - `dto.template.ts` (6.3KB) - Request/response DTOs with validation
  - `entity.template.ts` (2.5KB) - Database entities with relationships
  - `module.template.ts` (1.6KB) - Module configuration
  - `service.spec.template.ts` (11.7KB) - Unit tests with ≥80% coverage
  - `test-templates.js` (11.7KB) - Template testing utility
- **Real-World Examples** (34.7KB total)
  - `user-management-crud.example.ts` (14.2KB) - Complete CRUD with auth, caching, events
  - `jwt-authentication.example.ts` (14.9KB) - JWT auth with Passport.js and refresh tokens
  - `examples/README.md` (5.6KB) - Examples usage guide
- **Library Entry Point**
  - `lib/index.js` - Skill metadata and API for programmatic access
- **Comprehensive Documentation**
  - Updated `README.md` with complete plugin documentation
  - Installation via Claude Code marketplace
  - Usage examples and code generation patterns
  - Integration with AI-Mesh ecosystem

### Migration Notes

This release represents the extraction of NestJS framework expertise from the ensemble monolith (v3.x) to a standalone plugin. All content is sourced from:

- **Source**: `/Users/ldangelo/Development/Fortium/ensemble/skills/nestjs-framework/`
- **Target**: `/Users/ldangelo/Development/Fortium/ensemble/packages/nestjs/`

### Features

- **Enterprise Architecture**: Modular design with dependency injection
- **RESTful API Development**: Complete CRUD patterns with OpenAPI/Swagger
- **Authentication & Authorization**: JWT-based security with RBAC
- **Data Layer Abstraction**: TypeORM, Prisma, Mongoose support
- **GraphQL Support**: Schema-first and code-first approaches
- **Microservices Architecture**: TCP, RabbitMQ, Redis, NATS patterns
- **Testing Excellence**: Unit (≥80%), integration (≥70%), E2E (≥60%)
- **Performance Optimization**: Caching, background jobs, query optimization

### Quality Standards

- Service Coverage: ≥80%
- Controller Coverage: ≥70%
- E2E Coverage: ≥60%
- Overall Coverage: ≥75%
- Security: OWASP Top 10 compliance
- Performance: <200ms response time
- API Documentation: 100% OpenAPI coverage

### Compatibility

- **NestJS**: 8.0+ (recommended 10.4+)
- **Node.js**: 18+
- **TypeScript**: 5.0+
- **Dependencies**: @fortium/ensemble-development ^4.0.0

### Known Issues

None

## [Unreleased]

- Future enhancements and updates will be tracked here
