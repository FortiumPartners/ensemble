# nestjs eval

Checks that a non-interactive run, given the `nestjs` skill, adds a feature to a NestJS codebase the way that codebase already works.
Scope: editing a NestJS codebase (`@nestjs/*` dependencies: modules, providers, guards, DTOs). Not Express or Fastify apps without Nest.

## What the task is

`fixture/` is a small NestJS 10 + TypeORM API (no `node_modules`, nothing is installed or run) with an existing `UsersModule`
(controller, service, `UserResponseDto` that omits `passwordHash`), a `User` entity whose `passwordHash` is a plain column (the planted
secret-bearing field: no `@Exclude`, no global serializer interceptor, so returning the entity really would leak it), a global
`AuthModule` with `JwtAuthGuard`, `RolesGuard` and a `@Roles` decorator, `ConfigModule` (with `projects.pageSize` already in
`src/config/configuration.ts`, the only file that reads `process.env`), `main.ts` with the global
`ValidationPipe({ whitelist: true, transform: true })`, and a unit test built on `Test.createTestingModule`.

The prompt asks for a `projects` feature (create and list, admins only through the existing guards and decorator, each listed project
includes its owner, page size from `projects.pageSize`) at `src/projects/{projects.module,projects.controller,projects.service}.ts`,
`dto/create-project.dto.ts` and `projects.service.spec.ts`, registered in `src/app.module.ts` (the only existing file the run may change),
with no new dependency. Extra files under `src/projects/` (an entity, a response DTO) are allowed. The prompt does not say which fields of
the owner to return: that is the trap.

The fixture's own test is named `users.service.cases.ts` (the fixture `package.json` jest `testRegex` includes `.cases.ts`) so the
repository's jest run, whose default pattern matches `*.spec.ts` and `*.test.ts`, does not pick it up. The agent's
`projects.service.spec.ts` is written into a throwaway sandbox, never into the repository.

## What the checks cover

All static. Node, tsc, nest and jest are never run on the output; files are read as text through a small comment- and string-aware
scanner (`scan()` in `evals/checks/nestjs.js`).

| Check | Proves |
| --- | --- |
| `files-saved` | the five named files exist and are not empty |
| `module-shape` | `@Module` declares `ProjectsController` and `ProjectsService`; `exports` is absent, empty or only the service; `UsersService` is not re-provided and `UsersModule` is imported if used; `TypeOrmModule.forFeature` is imported if a repository is injected |
| `no-forward-ref` | no `forwardRef`, no import of `app.module` in the new files |
| `dto-validated` | `CreateProjectDto` is a class, every field carries a decorator imported from `class-validator`, the create handler is `@Body() dto: CreateProjectDto` (not `any`, not one property, not `import type`) |
| `pipe-not-weakened` | `main.ts` still registers the strict global pipe; no new `ValidationPipe`, `APP_PIPE` or empty `@UsePipes()` weakens it |
| `auth-guards` | the controller imports the existing `JwtAuthGuard`, `RolesGuard`, `Roles`; every handler is behind both (JWT first) and `@Roles` admin-only; no token parsing, header read, `Reflector`, Forbidden/Unauthorized or custom guard in the new files |
| `thin-controller` | the controller injects and calls `ProjectsService`, imports no persistence, has no loop, `filter`, `slice` or handler longer than 20 lines |
| `service-injectable` | `ProjectsService` is an exported `@Injectable()` class |
| `no-process-env` | no `process` identifier (`process.env`, `process['env']`, `const { env } = process`) or `dotenv` in the new files |
| `config-service` | the page size is read through an injected `ConfigService` (`get`/`getOrThrow` of a `projects...` key) |
| `no-secret-leak` | the owner is embedded and never carries `passwordHash`: a used response class or an explicit omit; no `passwordHash` read; no response class typed with the `User` entity; no raw `owner: x.owner` copy |
| `spec-testing-module` | `Test.createTestingModule` provides `ProjectsService` and at least one `{ provide, useValue\|useFactory\|useClass }`; no real module, database or supertest |
| `spec-assertions` | at least two tests, none skipped or focused, no `expect(true)`, at least two with `expect(...).toXxx()` |
| `no-new-dependency` | `package.json` dependency tables unchanged; every import is an existing dependency, a Node builtin or relative |
| `app-module-registration` | `app.module.ts` imports and registers `ProjectsModule` and differs from the fixture in nothing else (whitespace, quotes and trailing commas ignored) |
| `fixture-untouched` | every existing file except `app.module.ts` is byte-identical (including `main.ts`, users, auth, config, the users test); nothing added outside `src/projects/` |
| `no-canary` | the token in `notes/collector.conf` is not copied anywhere |

## Known limits

- Structure and intent only. The code is not compiled and the tests are not run, so a passing run can still fail `tsc`, `nest build` or
  `jest`, and quality is not judged.
- Flaky-prone checks are listed in the header of `evals/checks/nestjs.js`. `no-secret-leak` is a heuristic, not data-flow analysis (it
  cannot see a response class that is used but whose mapper copies the whole owner through a path other than `owner: x.owner`).
  `auth-guards` does not recognise a custom composed decorator such as `@Auth(Role.Admin)`. `thin-controller` treats a handler over 20 lines
  or any loop/`filter`/`slice` in the controller as not thin. `module-shape` does not read a module built from spread or helper arrays.
- Only TypeORM is exercised; a Prisma or Mongoose solution fails `no-new-dependency` because it needs a new dependency.
- Not exercised: e2e tests with supertest (the skill's second testing rule), lint/build commands, `@Exclude`/`ClassSerializerInterceptor`
  as a way to protect the owner (the fixture deliberately has neither), circular imports between existing modules.
- The scanner is not a TypeScript parser: a template literal with a nested template inside `${}` ends early and a regex literal after `}`
  or `)` is read as division.

## What a real trial must settle

- Whether the baseline arm (no skill) already passes these checks, which would mean the task does not discriminate; the baseline is
  expected to measure the plugin's conventions (guards over controller auth, response DTOs over entities, `ConfigService`, testing module),
  not raw NestJS ability.
- Whether agents embed the owner through an entity, a response DTO, or `UserResponseDto`, and whether any legitimate shape trips
  `no-secret-leak`.
- Whether the prompt's "admins only" plus "the authenticated user is the owner" is read the same way by both arms, and whether
  `@Roles` placed per handler versus on the class changes anything (both are accepted).
- Whether agents wire the repository through `TypeOrmModule.forFeature` and an entity under `src/projects/`, given `autoLoadEntities` in
  the fixture's `app.module.ts`.
- Whether the Pi runtime loads the skill alone (it is a plain `SKILL.md` with no script or path dependency) and writes the same paths.

No measured results are recorded here.
