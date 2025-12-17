# NestJS Microservice - Fly.io Deployment

Production-ready NestJS microservice with health checks and graceful shutdown.

## Features

- ✅ NestJS enterprise architecture
- ✅ Terminus health checks (liveness & readiness)
- ✅ Graceful shutdown with signal handling
- ✅ Dependency injection & modularity
- ✅ TypeScript with strict mode
- ✅ Multi-stage Docker build
- ✅ Production-optimized configuration

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [NestJS CLI](https://docs.nestjs.com/cli/overview)
- [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/)
- Fly.io account

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Local Development

```bash
npm run start:dev
```

Access at: `http://localhost:3000`

### 3. Deploy to Fly.io

```bash
# Login to Fly.io
flyctl auth login

# Create new app
flyctl apps create nestjs-microservice

# Set secrets
flyctl secrets set DATABASE_URL=postgres://...
flyctl secrets set JWT_SECRET=your-secret

# Deploy
./deploy.sh
```

## Project Structure

```
src/
├── main.ts                 # Application bootstrap
├── app.module.ts           # Root module
├── app.controller.ts       # Root controller
├── app.service.ts          # Root service
├── health/                 # Health check module
│   ├── health.controller.ts
│   └── health.module.ts
└── config/                 # Configuration
    └── configuration.ts
```

## Health Checks

### Liveness Probe

**Endpoint**: `GET /health`

Checks if application is alive and running.

```typescript
// health.controller.ts
@Get()
@HealthCheck()
check() {
  return this.health.check([
    () => this.http.pingCheck('basic', 'http://localhost:3000')
  ]);
}
```

### Readiness Probe

**Endpoint**: `GET /health/ready`

Checks if application is ready to accept traffic (database, cache, etc.).

```typescript
@Get('ready')
@HealthCheck()
ready() {
  return this.health.check([
    () => this.db.pingCheck('database'),
    () => this.redis.pingCheck('redis')
  ]);
}
```

## Configuration

### Environment Variables

```bash
# Database
flyctl secrets set DATABASE_URL=postgres://user:pass@host:5432/db

# Authentication
flyctl secrets set JWT_SECRET=your-jwt-secret

# External services
flyctl secrets set REDIS_URL=redis://...
flyctl secrets set API_KEY=secret-value
```

### NestJS Configuration

Use `@nestjs/config` for configuration management:

```typescript
// app.module.ts
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    })
  ]
})
export class AppModule {}
```

## Graceful Shutdown

The application handles SIGTERM signals for graceful shutdown:

```typescript
// main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable graceful shutdown
  app.enableShutdownHooks();

  await app.listen(3000, '0.0.0.0');
}
```

## Database Integration

### TypeORM Example

```typescript
// app.module.ts
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: false
    })
  ]
})
export class AppModule {}
```

## Scaling

```bash
# Scale vertically
flyctl scale vm shared-cpu-2x --memory 1024

# Scale horizontally
flyctl scale count 3

# Regional deployment
flyctl regions add iad ams
flyctl scale count 2 --region sea
flyctl scale count 2 --region iad
flyctl scale count 1 --region ams
```

## Monitoring

```bash
# View logs
flyctl logs

# Filter by level
flyctl logs --level error

# Check status
flyctl status

# Open dashboard
flyctl dashboard
```

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

## Troubleshooting

### Application won't start

```bash
# Check logs for errors
flyctl logs --lines 100

# SSH into machine
flyctl ssh console

# Check environment variables
flyctl ssh console -C "env | grep NODE"
```

### Database connection fails

```bash
# Verify DATABASE_URL is set
flyctl secrets list

# Test connection from machine
flyctl ssh console -C "node -e \"console.log(process.env.DATABASE_URL)\""
```

### High memory usage

Increase memory allocation:

```bash
flyctl scale vm shared-cpu-1x --memory 512
```

## Production Checklist

- [ ] Set all environment variables
- [ ] Configure database connection
- [ ] Set up health check endpoints
- [ ] Configure logging/monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Configure rate limiting
- [ ] Set up backup strategy
- [ ] Test graceful shutdown
- [ ] Configure CORS if needed
- [ ] Set up CI/CD pipeline

## Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [NestJS Terminus](https://docs.nestjs.com/recipes/terminus)
- [Fly.io Node.js Guide](https://fly.io/docs/languages-and-frameworks/node/)
- [TypeORM Documentation](https://typeorm.io/)
