# FastAPI Async Application - Fly.io Deployment

Production-ready FastAPI async API with OpenAPI documentation and async patterns.

## Features

- ✅ FastAPI with async/await support
- ✅ Automatic OpenAPI documentation
- ✅ Uvicorn ASGI server with multiple workers
- ✅ Async database support (SQLAlchemy + asyncpg)
- ✅ Pydantic v2 validation
- ✅ Health check endpoints
- ✅ CORS middleware configured
- ✅ Prometheus metrics ready

## Prerequisites

- [Python 3.12+](https://www.python.org/)
- [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/)
- Fly.io account

## Quick Start

### 1. Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Local Development

```bash
# Run with auto-reload
uvicorn main:app --reload

# Or with multiple workers
uvicorn main:app --workers 4
```

Access:
- API: `http://localhost:8000`
- Docs: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

### 4. Deploy to Fly.io

```bash
# Login
flyctl auth login

# Create app
flyctl apps create fastapi-async

# Set secrets (if needed)
flyctl secrets set DATABASE_URL=postgres://...

# Deploy
./deploy.sh
```

## Project Structure

```
.
├── main.py              # Main application
├── models.py            # Pydantic models
├── database.py          # Async database setup
├── routers/             # API routes
│   ├── users.py
│   └── items.py
├── requirements.txt     # Dependencies
├── Dockerfile           # Multi-stage build
├── fly.toml            # Fly.io configuration
└── deploy.sh           # Deployment script
```

## Async Patterns

### Async Database Queries

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# Create async engine
engine = create_async_engine(DATABASE_URL)
async_session = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

# Use in endpoints
@app.get("/users/{user_id}")
async def get_user(user_id: int):
    async with async_session() as session:
        result = await session.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        return user
```

### Async HTTP Requests

```python
import httpx

@app.get("/external-api")
async def fetch_external():
    async with httpx.AsyncClient() as client:
        response = await client.get("https://api.example.com/data")
        return response.json()
```

### Async Redis Caching

```python
import aioredis

redis = await aioredis.create_redis_pool("redis://localhost")

@app.get("/cached-data")
async def get_cached():
    # Try cache first
    cached = await redis.get("data")
    if cached:
        return json.loads(cached)

    # Fetch and cache
    data = await fetch_data()
    await redis.setex("data", 3600, json.dumps(data))
    return data
```

## Configuration

### Environment Variables

```bash
# Database
flyctl secrets set DATABASE_URL=postgresql+asyncpg://...

# Redis
flyctl secrets set REDIS_URL=redis://...

# API keys
flyctl secrets set API_KEY=your-secret-key
```

### Pydantic Settings

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    redis_url: str
    api_key: str

    class Config:
        env_file = ".env"

settings = Settings()
```

## OpenAPI Documentation

FastAPI automatically generates interactive API documentation:

- **Swagger UI**: `/docs`
- **ReDoc**: `/redoc`
- **OpenAPI JSON**: `/openapi.json`

Customize documentation:

```python
app = FastAPI(
    title="My API",
    description="API Description",
    version="1.0.0",
    terms_of_service="https://example.com/terms/",
    contact={
        "name": "API Support",
        "url": "https://example.com/support",
        "email": "support@example.com",
    },
    license_info={
        "name": "Apache 2.0",
        "url": "https://www.apache.org/licenses/LICENSE-2.0.html",
    },
)
```

## Background Tasks

### Simple Background Tasks

```python
from fastapi import BackgroundTasks

def send_email(email: str):
    # Send email logic
    pass

@app.post("/send-notification")
async def notify(email: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_email, email)
    return {"message": "Notification queued"}
```

### Celery for Heavy Tasks

```python
from celery import Celery

celery = Celery("tasks", broker="redis://...")

@celery.task
def process_data(data_id: int):
    # Heavy processing
    pass

@app.post("/process")
async def queue_processing(data_id: int):
    process_data.delay(data_id)
    return {"status": "queued"}
```

## Performance Optimization

### Uvicorn Workers

```bash
# Multiple workers for better throughput
uvicorn main:app --workers 4 --host 0.0.0.0 --port 8000
```

### Database Connection Pooling

```python
engine = create_async_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=0,
    pool_pre_ping=True
)
```

### Response Caching

```python
from fastapi_cache import FastAPICache
from fastapi_cache.backends.redis import RedisBackend
from fastapi_cache.decorator import cache

@app.get("/expensive-operation")
@cache(expire=3600)  # Cache for 1 hour
async def expensive():
    result = await heavy_computation()
    return result
```

## Monitoring

### Prometheus Metrics

```python
from prometheus_fastapi_instrumentator import Instrumentator

app = FastAPI()
Instrumentator().instrument(app).expose(app)
```

Access metrics at `/metrics`

### Health Checks

```python
from fastapi import status

@app.get("/health", status_code=status.HTTP_200_OK)
async def health():
    # Check database
    # Check Redis
    # Check external services
    return {"status": "healthy"}
```

## Scaling

```bash
# Scale vertically
flyctl scale vm shared-cpu-2x --memory 512

# Scale horizontally
flyctl scale count 3

# Auto-scaling configuration
# Already configured in fly.toml
```

## Troubleshooting

### Import errors

```bash
# Verify dependencies installed
pip list

# Reinstall requirements
pip install -r requirements.txt --force-reinstall
```

### Async warnings

```python
# Use async context managers
async with session() as db:
    # Database operations

# Close connections properly
await engine.dispose()
```

### Performance issues

```bash
# Check worker count
flyctl logs | grep "Started server process"

# Monitor resource usage
flyctl status
flyctl metrics
```

## Production Checklist

- [ ] Configure CORS for production domains
- [ ] Set up database connection pooling
- [ ] Configure Redis for caching
- [ ] Set up monitoring (Prometheus/Grafana)
- [ ] Configure error tracking (Sentry)
- [ ] Set up rate limiting
- [ ] Configure logging
- [ ] Test async operations under load
- [ ] Set up backup strategy
- [ ] Configure CI/CD pipeline

## Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Uvicorn Documentation](https://www.uvicorn.org/)
- [SQLAlchemy Async](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- [Pydantic V2](https://docs.pydantic.dev/latest/)
