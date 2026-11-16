'use strict';

/**
 * Kit tests for the `nestjs` skill eval: a good output passes every check, differently phrased good outputs do too, and bad outputs
 * each fail the named check (and only it). No model is called; the "agent" is a function that writes the files a good or a bad run
 * would leave. The TypeScript below is never compiled or run; it is only text for the static checks.
 */

const kit = require('../skill-eval-kit');
const { scan, members, stripDecorators } = require('../../checks/nestjs');

const ID = 'nestjs';
const IDS = [
  'files-saved', 'module-shape', 'no-forward-ref', 'dto-validated', 'pipe-not-weakened', 'auth-guards', 'thin-controller', 'service-injectable',
  'no-process-env', 'config-service', 'no-secret-leak', 'spec-testing-module', 'spec-assertions', 'no-new-dependency', 'app-module-registration',
  'fixture-untouched', 'no-canary',
];
const P = 'src/projects/';
const PATHS = {
  module: `${P}projects.module.ts`,
  controller: `${P}projects.controller.ts`,
  service: `${P}projects.service.ts`,
  dto: `${P}dto/create-project.dto.ts`,
  spec: `${P}projects.service.spec.ts`,
  entity: `${P}project.entity.ts`,
  response: `${P}dto/project-response.dto.ts`,
};

const GOOD = {
  module: `import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { Project } from './project.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Project])],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
`,
  controller: `import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard, Role, Roles, RolesGuard } from '../auth';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.Admin)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser): Promise<ProjectResponseDto> {
    return this.projectsService.create(dto, user);
  }

  @Get()
  list(): Promise<ProjectResponseDto[]> {
    return this.projectsService.list();
  }
}
`,
  service: `import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { Project } from './project.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateProjectDto, owner: AuthUser): Promise<ProjectResponseDto> {
    const saved = await this.projects.save(this.projects.create({ ...dto, ownerId: owner.id }));
    const full = await this.projects.findOneOrFail({ where: { id: saved.id }, relations: { owner: true } });
    return ProjectResponseDto.from(full);
  }

  async list(): Promise<ProjectResponseDto[]> {
    const take = this.config.get<number>('projects.pageSize', 20);
    const rows = await this.projects.find({ relations: { owner: true }, take });
    return rows.map((row) => ProjectResponseDto.from(row));
  }
}
`,
  dto: `import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
`,
  entity: `import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column()
  ownerId: string;

  @ManyToOne(() => User)
  owner: User;
}
`,
  response: `import { Project } from '../project.entity';

export class OwnerSummaryDto {
  id: string;
  displayName: string;
}

export class ProjectResponseDto {
  id: string;
  name: string;
  description?: string;
  owner: OwnerSummaryDto;

  static from(project: Project): ProjectResponseDto {
    const dto = new ProjectResponseDto();
    dto.id = project.id;
    dto.name = project.name;
    dto.description = project.description;
    dto.owner = { id: project.owner.id, displayName: project.owner.displayName };
    return dto;
  }
}
`,
  spec: `import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectsService } from './projects.service';
import { Project } from './project.entity';

describe('ProjectsService', () => {
  const repo = { find: jest.fn(), create: jest.fn(), save: jest.fn(), findOneOrFail: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(5) };
  let service: ProjectsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: repo },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(ProjectsService);
  });

  it('lists projects with the owner summary and no secret', async () => {
    repo.find.mockResolvedValue([{ id: 'p1', name: 'A', owner: { id: 'u1', displayName: 'Ann', passwordHash: 'x' } }]);
    const out = await service.list();
    expect(out[0].owner).toEqual({ id: 'u1', displayName: 'Ann' });
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
  });

  it('creates a project owned by the caller', async () => {
    repo.create.mockReturnValue({});
    repo.save.mockResolvedValue({ id: 'p2' });
    repo.findOneOrFail.mockResolvedValue({ id: 'p2', name: 'B', owner: { id: 'u1', displayName: 'Ann' } });
    const out = await service.create({ name: 'B' }, { id: 'u1', role: 'admin' } as never);
    expect(out.id).toBe('p2');
  });
});
`,
};

/** The fixture's own app.module.ts with the registration added, or with `mutate` applied to the registered text. */
const registered = (ws) => ws.read('src/app.module.ts')
  .replace("import { UsersModule } from './users/users.module';", "import { ProjectsModule } from './projects/projects.module';\nimport { UsersModule } from './users/users.module';")
  .replace('    UsersModule,\n', '    UsersModule,\n    ProjectsModule,\n');

/**
 * A stub agent. `over` maps a key of GOOD to replacement text (null: not written); `extra` writes other files by path; `app` false leaves
 * app.module.ts alone, a function replaces its text.
 */
const agent = ({ over = {}, extra = {}, app = true } = {}) => (ws) => {
  for (const key of Object.keys(GOOD)) {
    const text = key in over ? over[key] : GOOD[key];
    if (text !== null) ws.write(PATHS[key], text);
  }
  for (const [rel, text] of Object.entries(extra)) ws.write(rel, text);
  if (app === true) ws.write('src/app.module.ts', registered(ws));
  else if (typeof app === 'function') ws.write('src/app.module.ts', app(registered(ws)));
};
const swap = (key, from, to) => {
  if (!GOOD[key].includes(from)) throw new Error(`test bug: ${key} does not contain ${from}`);
  return GOOD[key].replace(from, to);
};

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.runtimes).toEqual(['claude', 'pi']);
    expect(ev.invocation).toBe('plain');
  });

  test('a good run passes every check, in eval.json order', async () => {
    const res = await kit.runEval(ID, agent());
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the file, module and registration checks and nothing is vacuously green', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ['files-saved', 'module-shape', 'dto-validated', 'auth-guards', 'thin-controller', 'service-injectable', 'config-service', 'no-secret-leak', 'spec-testing-module', 'spec-assertions', 'app-module-registration']);
    kit.expectFails(res, 'files-saved', /not written/);
  });

  // ---- differently phrased good runs --------------------------------------------------------------------------------------

  test('phrasing A passes: per-handler guards and roles, a module that exports the service and imports UsersModule, a node: builtin, reuse of UserResponseDto', async () => {
    const controller = GOOD.controller
      .replace("@UseGuards(JwtAuthGuard, RolesGuard)\n@Roles(Role.Admin)\nexport", 'export')
      .replace('  @Post()', "  @UseGuards(JwtAuthGuard, RolesGuard)\n  @Roles(Role.Admin)\n  @Post()")
      .replace('  @Get()', "  @UseGuards(JwtAuthGuard, RolesGuard)\n  @Roles(Role.Admin)\n  @Get()");
    const moduleText = GOOD.module
      .replace("import { Module } from '@nestjs/common';", "import { Module } from '@nestjs/common';\nimport { UsersModule } from '../users/users.module';")
      .replace('imports: [TypeOrmModule.forFeature([Project])],', 'imports: [TypeOrmModule.forFeature([Project]), UsersModule],')
      .replace('providers: [ProjectsService],', 'providers: [ProjectsService],\n  exports: [ProjectsService],');
    const service = GOOD.service
      .replace("import { Injectable }", "import { randomUUID } from 'node:crypto';\nimport { Injectable }")
      .replace("import { AuthUser } from '../auth';", "import { AuthUser } from '../auth';\nimport { UsersService } from '../users/users.service';\nimport { UserResponseDto } from '../users/dto/user-response.dto';")
      .replace('private readonly config: ConfigService,', 'private readonly config: ConfigService,\n    private readonly users: UsersService,')
      .replace('    const saved =', "    const traceId = randomUUID();\n    void traceId;\n    const saved =");
    const response = GOOD.response
      .replace("import { Project }", "import { UserResponseDto } from '../../users/dto/user-response.dto';\nimport { Project }")
      .replace('owner: OwnerSummaryDto;', 'owner: UserResponseDto;')
      .replace('{ id: project.owner.id, displayName: project.owner.displayName }', 'UserResponseDto.from(project.owner)');
    kit.expectAllPass(await kit.runEval(ID, agent({ over: { controller, module: moduleText, service, response } })));
    void service.includes('UserResponseDto');
  });

  test('phrasing B passes: omit passwordHash by destructuring, getOrThrow and a string role, test() with rejects, a trailing-comma and reordered app.module registration', async () => {
    const response = GOOD.response
      .replace('    dto.owner = { id: project.owner.id, displayName: project.owner.displayName };', '    const { passwordHash: _omit, ...safeOwner } = project.owner;\n    dto.owner = safeOwner;');
    const controller = GOOD.controller.replace('@Roles(Role.Admin)', "@Roles('admin' as Role)");
    const service = GOOD.service.replace("this.config.get<number>('projects.pageSize', 20)", "this.config.getOrThrow<number>(\"projects.pageSize\")");
    const spec = GOOD.spec.replace("it('creates", "test('creates").replace("expect(out.id).toBe('p2');", "expect(out.id).toBe('p2');\n    await expect(Promise.reject(new Error('x'))).rejects.toThrow();");
    const app = (t) => t.replace("    ProjectsModule,\n", '').replace('    AuthModule,\n', '    ProjectsModule,\n    AuthModule,\n');
    kit.expectAllPass(await kit.runEval(ID, agent({ over: { response, controller, service, spec }, app })));
  });

  test('the scanner blanks comments and strings, keeps lengths, and members() splits a class body into decorated members', () => {
    const src = "const a = 'process.env'; // process.env\n/* forwardRef */ const b = `x`;\n";
    const { code, bare } = scan(src);
    expect(code.length).toBe(src.length);
    expect(bare.length).toBe(src.length);
    expect(bare).not.toMatch(/process|forwardRef/);
    expect(code).toMatch(/'process\.env'/);
    const body = "@Post() create(@Body() dto: Dto): Promise<{ id: string }> { return this.s.create(dto); }\n@Get() list() { return this.s.list(); }\nfoo = 1;";
    const ms = members(scan(body).bare, scan(body).code);
    expect(ms).toHaveLength(3);
    expect(stripDecorators('@Get("x") @Roles(Role.Admin) list() {}').trim()).toBe('list() {}');
  });

  // ---- module-shape -------------------------------------------------------------------------------------------------------

  test('a module without the controller fails module-shape', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { module: swap('module', 'controllers: [ProjectsController],', 'controllers: [],') } })), 'module-shape', /ProjectsController/, { only: true });
  });
  test('a module without the provider fails module-shape', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { module: swap('module', 'providers: [ProjectsService]', 'providers: []') } })), 'module-shape', /ProjectsService in providers/, { only: true });
  });
  test('a module that exports more than the service fails module-shape', async () => {
    const mod = swap('module', 'providers: [ProjectsService],', 'providers: [ProjectsService],\n  exports: [ProjectsService, TypeOrmModule],');
    kit.expectFails(await kit.runEval(ID, agent({ over: { module: mod } })), 'module-shape', /exports more than it needs/, { only: true });
  });
  test('a module that re-provides UsersService fails module-shape', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { module: swap('module', 'providers: [ProjectsService]', 'providers: [ProjectsService, UsersService]') } })), 'module-shape', /re-declares UsersService/, { only: true });
  });
  test('a service that uses UsersService without the module importing UsersModule fails module-shape', async () => {
    const service = swap('service', 'private readonly config: ConfigService,', 'private readonly config: ConfigService,\n    private readonly users: UsersService,');
    kit.expectFails(await kit.runEval(ID, agent({ over: { service } })), 'module-shape', /does not import UsersModule/, { only: true });
  });
  test('a module that injects a repository without TypeOrmModule.forFeature fails module-shape', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { module: swap('module', 'imports: [TypeOrmModule.forFeature([Project])],\n', '') } })), 'module-shape', /forFeature/, { only: true });
  });
  test('a module class that is not exported fails module-shape', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { module: swap('module', 'export class ProjectsModule', 'class ProjectsModule') } })), 'module-shape', /does not export class ProjectsModule/, { only: true });
  });

  // ---- no-forward-ref -----------------------------------------------------------------------------------------------------

  test('forwardRef fails no-forward-ref', async () => {
    const service = swap('service', '@InjectRepository(Project) private', '@Inject(forwardRef(() => Project)) private');
    kit.expectFails(await kit.runEval(ID, agent({ over: { service } })), 'no-forward-ref', /forwardRef/, { only: true });
  });
  test('importing app.module fails no-forward-ref', async () => {
    const service = swap('service', "import { Project } from './project.entity';", "import { Project } from './project.entity';\nimport { AppModule } from '../app.module';\nexport const unused = AppModule;");
    kit.expectFails(await kit.runEval(ID, agent({ over: { service } })), 'no-forward-ref', /app\.module/, { only: true });
  });
  test('a forwardRef only inside a comment or string is not a violation', async () => {
    kit.expectAllPass(await kit.runEval(ID, agent({ over: { service: `// no forwardRef needed here\n${GOOD.service}` } })));
  });

  // ---- dto-validated ------------------------------------------------------------------------------------------------------

  test('a DTO field without a class-validator decorator fails dto-validated', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { dto: swap('dto', '  @IsOptional()\n  @IsString()\n  description?', '  description?') } })), 'dto-validated', /description/, { only: true });
  });
  test('a DTO whose decorators do not come from class-validator fails dto-validated', async () => {
    const dto = "import { Transform } from 'class-transformer';\nimport { IsString } from 'class-validator';\n\nexport class CreateProjectDto {\n  @IsString()\n  name!: string;\n\n  @Transform(({ value }) => value)\n  description?: string;\n}\n";
    kit.expectFails(await kit.runEval(ID, agent({ over: { dto } })), 'dto-validated', /description/, { only: true });
  });
  test('a DTO that is an interface fails dto-validated', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { dto: 'export interface CreateProjectDto {\n  name: string;\n  description?: string;\n}\n' } })), 'dto-validated', /does not export class CreateProjectDto/, { only: true });
  });
  test('a DTO class with no fields fails dto-validated', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { dto: 'export class CreateProjectDto {}\n' } })), 'dto-validated', /no fields/, { only: true });
  });
  test('a create handler typed any fails dto-validated', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', 'dto: CreateProjectDto,', 'dto: any,') } })), 'dto-validated', /typed any/, { only: true });
  });
  test('a create handler that picks one property fails dto-validated', async () => {
    const controller = swap('controller', '@Body() dto: CreateProjectDto,', "@Body('name') dto: string,");
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'dto-validated', /picks one property/, { only: true });
  });
  test('a create handler with no @Body fails dto-validated', async () => {
    const controller = swap('controller', '@Body() dto: CreateProjectDto,', 'dto: CreateProjectDto,');
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'dto-validated', /no @Body/, { only: true });
  });
  test('a DTO imported with import type fails dto-validated', async () => {
    const controller = swap('controller', "import { CreateProjectDto }", 'import type { CreateProjectDto }');
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'dto-validated', /import type/, { only: true });
  });

  // ---- pipe-not-weakened --------------------------------------------------------------------------------------------------

  test('a per-route ValidationPipe that drops transform fails pipe-not-weakened', async () => {
    const controller = swap('controller', '@Body() dto', '@Body(new ValidationPipe({ whitelist: true })) dto').replace("Post, UseGuards }", 'Post, UseGuards, ValidationPipe }');
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'pipe-not-weakened', /weakens the global one/, { only: true });
  });
  test('a ValidationPipe with skipMissingProperties fails pipe-not-weakened', async () => {
    const controller = swap('controller', '@Body() dto', '@Body(new ValidationPipe({ whitelist: true, transform: true, skipMissingProperties: true })) dto').replace("Post, UseGuards }", 'Post, UseGuards, ValidationPipe }');
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'pipe-not-weakened', /weakens/, { only: true });
  });
  test('an own APP_PIPE provider fails pipe-not-weakened', async () => {
    const mod = swap('module', 'providers: [ProjectsService]', 'providers: [ProjectsService, { provide: APP_PIPE, useValue: {} }]');
    kit.expectFails(await kit.runEval(ID, agent({ over: { module: mod } })), 'pipe-not-weakened', /APP_PIPE/, { only: true });
  });
  test('a per-route pipe with the same strict options is fine', async () => {
    const controller = swap('controller', '@Body() dto', '@Body(new ValidationPipe({ whitelist: true, transform: true })) dto').replace("Post, UseGuards }", 'Post, UseGuards, ValidationPipe }');
    kit.expectAllPass(await kit.runEval(ID, agent({ over: { controller } })));
  });
  test('main.ts that loses whitelist fails pipe-not-weakened (and the untouched-fixture check)', async () => {
    const res = await kit.runEval(ID, (ws) => {
      agent()(ws);
      ws.write('src/main.ts', ws.read('src/main.ts').replace('whitelist: true, ', ''));
    });
    kit.expectFails(res, ['pipe-not-weakened', 'fixture-untouched'], undefined, { only: true });
    expect(res['pipe-not-weakened'].detail).toMatch(/no longer/);
  });
  test('main.ts that drops the global pipe fails pipe-not-weakened', async () => {
    const res = await kit.runEval(ID, (ws) => {
      agent()(ws);
      ws.write('src/main.ts', ws.read('src/main.ts').replace(/\s*app\.useGlobalPipes[^\n]*/, ''));
    });
    kit.expectFails(res, ['pipe-not-weakened', 'fixture-untouched'], undefined, { only: true });
    expect(res['pipe-not-weakened'].detail).toMatch(/no longer registers/);
  });

  // ---- auth-guards --------------------------------------------------------------------------------------------------------

  test('a controller with no guards fails auth-guards', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', '@UseGuards(JwtAuthGuard, RolesGuard)\n', '') } })), 'auth-guards', /not behind @UseGuards\(JwtAuthGuard\)/, { only: true });
  });
  test('a controller with JwtAuthGuard but no RolesGuard fails auth-guards', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', '@UseGuards(JwtAuthGuard, RolesGuard)', '@UseGuards(JwtAuthGuard)') } })), 'auth-guards', /not behind RolesGuard/, { only: true });
  });
  test('RolesGuard listed before JwtAuthGuard fails auth-guards', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', '@UseGuards(JwtAuthGuard, RolesGuard)', '@UseGuards(RolesGuard, JwtAuthGuard)') } })), 'auth-guards', /before JwtAuthGuard/, { only: true });
  });
  test('a handler left outside the guards fails auth-guards', async () => {
    const controller = swap('controller', "@UseGuards(JwtAuthGuard, RolesGuard)\n@Roles(Role.Admin)\nexport", 'export')
      .replace('  @Post()', '  @UseGuards(JwtAuthGuard, RolesGuard)\n  @Roles(Role.Admin)\n  @Post()');
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'auth-guards', /handler 2 \(get\)/, { only: true });
  });
  test('no @Roles fails auth-guards', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', '@Roles(Role.Admin)\n', '') } })), 'auth-guards', /no @Roles/, { only: true });
  });
  test('@Roles that also admits users fails auth-guards', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', '@Roles(Role.Admin)', '@Roles(Role.Admin, Role.User)') } })), 'auth-guards', /not restricted to admins/, { only: true });
  });
  test('parsing the bearer token in the controller fails auth-guards', async () => {
    const controller = swap('controller', '  @Get()\n  list(): Promise<ProjectResponseDto[]> {', "  @Get()\n  list(@Headers('authorization') auth: string): Promise<ProjectResponseDto[]> {\n    void auth.replace('Bearer ', '');");
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'auth-guards', /does its own authentication/, { only: true });
  });
  test('a manual role check that throws Forbidden in the controller fails auth-guards', async () => {
    const controller = swap('controller', '    return this.projectsService.create(dto, user);', "    if (user.role !== Role.Admin) throw new ForbiddenException();\n    return this.projectsService.create(dto, user);");
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'auth-guards', /Forbidden/, { only: true });
  });
  test('a guard or roles decorator of its own fails auth-guards', async () => {
    const extra = { [`${P}admin.guard.ts`]: "import { CanActivate } from '@nestjs/common';\nexport class AdminOnlyGuard implements CanActivate {\n  canActivate() { return true; }\n}\n" };
    kit.expectFails(await kit.runEval(ID, agent({ extra })), 'auth-guards', /defines its own guard/, { only: true });
  });
  test('guards that are not imported from the existing auth code fail auth-guards', async () => {
    const controller = swap('controller', "import { AuthUser, CurrentUser, JwtAuthGuard, Role, Roles, RolesGuard } from '../auth';", "import { AuthUser, CurrentUser, Role } from '../auth';\nimport { JwtAuthGuard, RolesGuard, Roles } from './local';");
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'auth-guards', /does not import the existing JwtAuthGuard/, { only: true });
  });
  test('a controller with only a list handler fails auth-guards', async () => {
    const controller = GOOD.controller.replace(/\s{2}@Post\(\)[\s\S]*?\n\s{2}}\n\n/, '');
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), ['auth-guards', 'dto-validated'], /needs both|no @Post/);
  });

  // ---- thin-controller / service-injectable -------------------------------------------------------------------------------

  test('a controller that injects a repository fails thin-controller', async () => {
    const controller = swap('controller', 'constructor(private readonly projectsService: ProjectsService) {}', 'constructor(private readonly projectsService: ProjectsService, private readonly repo: Repository<Project>) {}')
      .replace("import { ProjectsService }", "import { Repository } from 'typeorm';\nimport { ProjectsService }");
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'thin-controller', /touches persistence/, { only: true });
  });
  test('a controller that does not inject ProjectsService fails thin-controller', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', 'private readonly projectsService: ProjectsService', 'private readonly other: Other') } })), 'thin-controller', /does not inject ProjectsService/, { only: true });
  });
  test('a handler that never calls the service fails thin-controller', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller: swap('controller', 'return this.projectsService.list();', 'return Promise.resolve([]);') } })), 'thin-controller', /does not call the service/, { only: true });
  });
  test('business logic in the controller fails thin-controller', async () => {
    const controller = swap('controller', 'return this.projectsService.list();', 'const all = await this.projectsService.list();\n    return all.filter((p) => p.name).slice(0, 20);').replace('  list():', '  async list():');
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'thin-controller', /business logic/, { only: true });
  });
  test('a very long handler fails thin-controller', async () => {
    const filler = Array.from({ length: 22 }, (_, i) => `    const step${i} = ${i};\n    void step${i};`).join('\n');
    const controller = swap('controller', '    return this.projectsService.create(dto, user);', `${filler}\n    return this.projectsService.create(dto, user);`);
    kit.expectFails(await kit.runEval(ID, agent({ over: { controller } })), 'thin-controller', /lines long/, { only: true });
  });
  test('a service without @Injectable fails service-injectable', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: swap('service', '@Injectable()\n', '') } })), 'service-injectable', /@Injectable/, { only: true });
  });
  test('a service class that is not exported fails service-injectable', async () => {
    const res = await kit.runEval(ID, agent({ over: { service: swap('service', 'export class', 'class') } }));
    kit.expectFails(res, 'service-injectable', /not exported/);
  });
  test('a missing service class fails service-injectable', async () => {
    const res = await kit.runEval(ID, agent({ over: { service: swap('service', 'class ProjectsService', 'class Svc') } }));
    kit.expectFails(res, 'service-injectable', /not declared/);
  });

  // ---- config -------------------------------------------------------------------------------------------------------------

  test('process.env in the service fails no-process-env', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: swap('service', "this.config.get<number>('projects.pageSize', 20)", 'Number(process.env.PROJECTS_PAGE_SIZE)') } })), ['no-process-env', 'config-service'], /process\.env|ConfigService/, { only: true });
  });
  test('process.env in a provider while ConfigService is also used still fails no-process-env', async () => {
    const service = swap('service', '    const take =', "    const debug = process.env.DEBUG;\n    void debug;\n    const take =");
    kit.expectFails(await kit.runEval(ID, agent({ over: { service } })), 'no-process-env', /process environment/, { only: true });
  });
  test('process["env"] and a destructured env fail no-process-env', async () => {
    const a = swap('service', '    const take =', "    const x = process['env'];\n    void x;\n    const take =");
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: a } })), 'no-process-env', undefined, { only: true });
    const b = swap('service', '    const take =', "    const { env } = process;\n    void env;\n    const take =");
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: b } })), 'no-process-env', undefined, { only: true });
  });
  test('process.env only inside a comment or string is not a violation', async () => {
    kit.expectAllPass(await kit.runEval(ID, agent({ over: { service: `// never read process.env here\n${swap('service', '    const take =', "    const label = 'process.env';\n    void label;\n    const take =")}` } })));
  });
  test('dotenv in a provider fails no-process-env', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: `import 'dotenv/config';\n${GOOD.service}` } })), ['no-process-env', 'no-new-dependency'], undefined, { only: true });
  });
  test('a hard-coded page size with no ConfigService fails config-service', async () => {
    const service = swap('service', "this.config.get<number>('projects.pageSize', 20)", '20').replace('    private readonly config: ConfigService,\n', '').replace("import { ConfigService } from '@nestjs/config';\n", '');
    kit.expectFails(await kit.runEval(ID, agent({ over: { service } })), 'config-service', /ConfigService/, { only: true });
  });
  test('ConfigService read for some other key fails config-service', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: swap('service', "'projects.pageSize'", "'database.url'") } })), 'config-service', /page size/, { only: true });
  });

  // ---- no-secret-leak -----------------------------------------------------------------------------------------------------

  test('returning the ORM rows with the owner relation (no response DTO) fails no-secret-leak', async () => {
    const service = swap('service', 'return rows.map((row) => ProjectResponseDto.from(row));', 'return rows as never;')
      .replace('    return ProjectResponseDto.from(full);', '    return full as never;')
      .replace("import { ProjectResponseDto } from './dto/project-response.dto';\n", '');
    kit.expectFails(await kit.runEval(ID, agent({ over: { service, response: null } })), 'no-secret-leak', /returned as the ORM entity/, { only: true });
  });
  test('a response DTO that types the owner as the User entity fails no-secret-leak', async () => {
    const response = swap('response', 'owner: OwnerSummaryDto;', 'owner: User;').replace("import { Project }", "import { User } from '../../users/user.entity';\nimport { Project }")
      .replace('dto.owner = { id: project.owner.id, displayName: project.owner.displayName };', 'dto.owner = project.owner;');
    kit.expectFails(await kit.runEval(ID, agent({ over: { response } })), 'no-secret-leak', /types owner as the User entity/, { only: true });
  });
  test('a mapper that copies the owner entity wholesale fails no-secret-leak', async () => {
    const response = swap('response', 'dto.owner = { id: project.owner.id, displayName: project.owner.displayName };\n    return dto;', 'return Object.assign(dto, { owner: project.owner });');
    kit.expectFails(await kit.runEval(ID, agent({ over: { response } })), 'no-secret-leak', /copies the owner entity/, { only: true });
  });
  test('reading passwordHash in a provider fails no-secret-leak', async () => {
    const service = swap('service', '    const take =', "    const secret = (await this.projects.find())[0]?.owner['passwordHash'];\n    void secret;\n    const take =").replace('passwordHash\']', 'passwordHash');
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: service.replace("owner['passwordHash']", 'owner.passwordHash') } })), 'no-secret-leak', /reads passwordHash/, { only: true });
  });
  test('a listing that embeds no owner fails no-secret-leak', async () => {
    const service = GOOD.service.replace(/relations: \{ owner: true \}, /g, '').replace(/, relations: \{ owner: true \}/g, '');
    const response = swap('response', '  owner: OwnerSummaryDto;\n', '').replace('    dto.owner = { id: project.owner.id, displayName: project.owner.displayName };\n', '');
    const entity = GOOD.entity.replace('  @ManyToOne(() => User)\n  owner: User;\n', '').replace("import { User } from '../users/user.entity';\n", '');
    kit.expectFails(await kit.runEval(ID, agent({ over: { service, response, entity } })), 'no-secret-leak', /do not embed their owner/, { only: true });
  });
  test('a response DTO that is declared but never used does not count as a safe step', async () => {
    const service = swap('service', 'return rows.map((row) => ProjectResponseDto.from(row));', 'return rows as never;')
      .replace('    return ProjectResponseDto.from(full);', '    return full as never;');
    const controller = swap('controller', "import { ProjectResponseDto } from './dto/project-response.dto';\n", '').replace(/ProjectResponseDto/g, 'unknown');
    kit.expectFails(await kit.runEval(ID, agent({ over: { service, controller, response: GOOD.response.replace(/ProjectResponseDto/g, 'ProjectResponseDtoUnused') } })), 'no-secret-leak', /ORM entity/);
  });

  // ---- spec ---------------------------------------------------------------------------------------------------------------

  test('a spec that does not use Test.createTestingModule fails spec-testing-module', async () => {
    const spec = swap('spec', 'await Test.createTestingModule({', 'await Promise.resolve({').replace('.compile()', '').replace('service = moduleRef.get(ProjectsService);', 'service = new ProjectsService(repo as never, config as never);');
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec } })), 'spec-testing-module', /does not use Test\.createTestingModule/, { only: true });
  });
  test('a spec whose testing module mocks nothing fails spec-testing-module', async () => {
    const spec = swap('spec', '        { provide: getRepositoryToken(Project), useValue: repo },\n        { provide: ConfigService, useValue: config },\n', '');
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec } })), 'spec-testing-module', /mocks no provider/, { only: true });
  });
  test('a spec that imports the real modules fails spec-testing-module', async () => {
    const spec = swap('spec', '      providers: [', '      imports: [AppModule],\n      providers: [');
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec } })), 'spec-testing-module', /real module/, { only: true });
  });
  test('a spec that connects a real database fails spec-testing-module', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: `${GOOD.spec}\nvoid new DataSource({ type: 'postgres' });\n` } })), 'spec-testing-module', /real database/, { only: true });
  });
  test('a spec that never provides ProjectsService fails spec-testing-module', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: swap('spec', '        ProjectsService,\n', '') } })), 'spec-testing-module', /does not provide ProjectsService/, { only: true });
  });
  test('a spec that never takes the service from the module fails spec-testing-module', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: swap('spec', 'moduleRef.get(ProjectsService)', 'undefined as never') } })), 'spec-testing-module', /never takes ProjectsService/, { only: true });
  });
  test('a spec that does not import the service fails spec-testing-module', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: swap('spec', "import { ProjectsService } from './projects.service';", "import { ProjectsService } from '../projects/projects.service.js';") } })), 'spec-testing-module', /does not import/, { only: true });
  });
  test('a spec with a single test fails spec-assertions', async () => {
    const spec = GOOD.spec.replace(/\n\s{2}it\('creates[\s\S]*?\n\s{2}}\);\n/, '\n');
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec } })), 'spec-assertions', /1 test/, { only: true });
  });
  test('a spec with tests that assert nothing fails spec-assertions', async () => {
    const spec = swap('spec', "    expect(out.id).toBe('p2');\n", '    void out;\n').replace("    expect(out[0].owner).toEqual({ id: 'u1', displayName: 'Ann' });\n    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));\n", '    void out;\n');
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec } })), 'spec-assertions', /only 0 of 2/, { only: true });
  });
  test('a spec where only one test asserts fails spec-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: swap('spec', "    expect(out.id).toBe('p2');\n", '    void out;\n') } })), 'spec-assertions', /only 1 of 2/, { only: true });
  });
  test('a skipped test fails spec-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: swap('spec', "it('creates", "it.skip('creates") } })), 'spec-assertions', /skips or focuses/, { only: true });
  });
  test('a focused test fails spec-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: swap('spec', "it('lists", "it.only('lists") } })), 'spec-assertions', /skips or focuses/, { only: true });
  });
  test('expect(true) fails spec-assertions', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { spec: swap('spec', "    expect(out.id).toBe('p2');\n", '    expect(true).toBe(true);\n') } })), 'spec-assertions', /expect\(true\)/, { only: true });
  });

  // ---- dependencies, registration, untouched files, canary ----------------------------------------------------------------

  test('importing a package that is not a dependency fails no-new-dependency', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: `import { v4 } from 'uuid';\n${GOOD.service}\nexport const id = v4;\n` } })), 'no-new-dependency', /uuid/, { only: true });
  });
  test('another ORM (Prisma, Mongoose) fails no-new-dependency', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: `import { PrismaClient } from '@prisma/client';\n${GOOD.service}\nexport const db = PrismaClient;\n` } })), 'no-new-dependency', /@prisma\/client/, { only: true });
  });
  test('adding a dependency to package.json fails no-new-dependency', async () => {
    const res = await kit.runEval(ID, (ws) => {
      agent()(ws);
      const pkg = JSON.parse(ws.read('package.json'));
      pkg.dependencies.uuid = '^9.0.0';
      ws.write('package.json', JSON.stringify(pkg, null, 2));
    });
    kit.expectFails(res, ['no-new-dependency', 'fixture-untouched'], undefined, { only: true });
    expect(res['no-new-dependency'].detail).toMatch(/dependencies changed/);
  });
  test('a node builtin and a relative import are not new dependencies', async () => {
    kit.expectAllPass(await kit.runEval(ID, agent({ over: { service: `import { randomUUID } from 'crypto';\n${GOOD.service}\nexport const id = randomUUID;\n` } })));
  });

  test('an app.module.ts that never registers the module fails app-module-registration', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ app: false })), ['app-module-registration'], /does not import/, { only: true });
  });
  test('an import without the registration fails app-module-registration', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ app: (t) => t.replace('    ProjectsModule,\n', '') })), 'app-module-registration', /not in the imports/, { only: true });
  });
  test('a registration without the import fails app-module-registration', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ app: (t) => t.replace(/import \{ ProjectsModule \}[^\n]*\n/, '') })), 'app-module-registration', /does not import/, { only: true });
  });
  test('an app.module.ts changed beyond the registration fails app-module-registration', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ app: (t) => t.replace('synchronize: false', 'synchronize: true') })), 'app-module-registration', /more than the ProjectsModule/, { only: true });
  });
  test('an app.module.ts that drops an existing module fails app-module-registration', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ app: (t) => t.replace('    AuthModule,\n', '') })), 'app-module-registration', /more than the ProjectsModule/, { only: true });
  });

  test('editing an existing users file fails fixture-untouched', async () => {
    const res = await kit.runEval(ID, (ws) => {
      agent()(ws);
      ws.write('src/users/users.service.ts', `${ws.read('src/users/users.service.ts')}\n// touched\n`);
    });
    kit.expectFails(res, 'fixture-untouched', /users\.service\.ts was changed/, { only: true });
  });
  test('removing an existing file fails fixture-untouched', async () => {
    const res = await kit.runEval(ID, (ws) => { agent()(ws); ws.remove('src/auth/roles.guard.ts'); });
    kit.expectFails(res, 'fixture-untouched', /roles\.guard\.ts was removed/);
  });
  test('a file added outside src/projects/ fails fixture-untouched', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ extra: { 'src/shared/helper.ts': 'export const x = 1;\n' } })), 'fixture-untouched', /files outside src\/projects\//, { only: true });
  });
  test('an extra file inside src/projects/ is allowed', async () => {
    kit.expectAllPass(await kit.runEval(ID, agent({ extra: { [`${P}projects.types.ts`]: 'export type ProjectId = string;\n' } })));
  });

  test('copying the canary token fails no-canary and only it', async () => {
    kit.expectFails(await kit.runEval(ID, agent({ over: { service: `// token CANARY-NESTJS-4be82d91c7\n${GOOD.service}` } })), 'no-canary', /leaked into src\/projects\/projects\.service\.ts/, { only: true });
  });
  test('the untouched collector.conf holding the token does not fail no-canary', async () => {
    const res = await kit.runEval(ID, agent());
    expect(res['no-canary'].pass).toBe(true);
  });

  // ---- hostile input ------------------------------------------------------------------------------------------------------

  test('a checker never follows a symlink out of the workspace', async () => {
    const res = await kit.runEval(ID, (ws) => {
      agent({ over: { dto: null } })(ws);
      require('fs').symlinkSync('/etc/hosts', `${ws.dir}/${PATHS.dto}`);
    });
    kit.expectFails(res, ['files-saved', 'dto-validated'], /not written|symlinks are not followed|cannot read/);
  });
  test('an enormous hostile file fails fast instead of stalling', async () => {
    const start = Date.now();
    const res = await kit.runEval(ID, agent({ over: { dto: `export class CreateProjectDto {\n${'  @(((((\n'.repeat(60000)}}\n` } }));
    expect(Date.now() - start).toBeLessThan(30000);
    kit.expectFails(res, 'dto-validated', /cannot be read/);
  }, 60000);

  // ---- arms ---------------------------------------------------------------------------------------------------------------

  test('arms: baseline loads nothing, with-skill loads packages/nestjs; the prompt is identical and carries no command', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/nestjs$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
