---
name: nestjs
description: "Use when working in a NestJS codebase (@nestjs/* dependencies: modules, providers, guards, DTOs); not for Express/Fastify apps without Nest."
metadata:
  version: "2.0.0"
---

# NestJS conventions

Match the existing module layout and ORM (TypeORM/Prisma/Mongoose) rather than introducing another.

Gotchas:
- One feature = one module; export only providers other modules need. Avoid circular imports (`forwardRef` is a last resort).
- Validate all input with DTOs + `class-validator` and a global `ValidationPipe({ whitelist: true, transform: true })`.
- Authentication in guards, not controllers; authorization via roles/ability decorators the repo already defines.
- Keep controllers thin; business logic in providers; never return ORM entities containing secrets (use serialization/response DTOs).
- Config via `ConfigModule`, never `process.env` in providers.
- Tests: `Test.createTestingModule` with mocked providers for unit tests; supertest e2e with a real app instance.
- Run lint, `npm test`, and `npm run build`.
