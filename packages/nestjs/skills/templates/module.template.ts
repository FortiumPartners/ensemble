import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { {{EntityName}}Controller } from './controllers/{{entity-name}}.controller';
import { {{EntityName}}Service } from './services/{{entity-name}}.service';
import { {{EntityName}}Repository } from './repositories/{{entity-name}}.repository';
import { {{EntityName}} } from './entities/{{entity-name}}.entity';
// Import related modules if needed
// import { UsersModule } from '../users/users.module';
// import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // TypeORM entity registration
    TypeOrmModule.forFeature([{{EntityName}}]),

    // Cache module (if not global)
    // CacheModule.register({
    //   ttl: 3600, // 1 hour
    //   max: 100,  // max items in cache
    // }),

    // Import related modules
    // UsersModule,
    // AuthModule,
  ],
  controllers: [{{EntityName}}Controller],
  providers: [
    {{EntityName}}Service,
    {{EntityName}}Repository,

    // Custom providers
    // {
    //   provide: '{{ENTITY_NAME}}_REPOSITORY',
    //   useClass: {{EntityName}}Repository,
    // },

    // Factory providers
    // {
    //   provide: '{{ENTITY_NAME}}_SERVICE',
    //   useFactory: (repository: {{EntityName}}Repository) => {
    //     return new {{EntityName}}Service(repository);
    //   },
    //   inject: [{{EntityName}}Repository],
    // },
  ],
  exports: [
    // Export services that other modules may need
    {{EntityName}}Service,
    // {{EntityName}}Repository,
  ],
})
export class {{EntityName}}Module {}
