"""
FastAPI Async Application
Production-ready async API with health checks and OpenAPI docs
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import asyncio

# Create FastAPI app
app = FastAPI(
    title="FastAPI Async API",
    description="Production-ready async API on Fly.io",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class HealthResponse(BaseModel):
    status: str
    version: str

class HelloResponse(BaseModel):
    message: str
    region: str

# Health check endpoint
@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for Fly.io"""
    return {
        "status": "healthy",
        "version": "1.0.0"
    }

# Example async endpoint
@app.get("/api/hello", response_model=HelloResponse)
async def hello():
    """Example async endpoint"""
    # Simulate async operation
    await asyncio.sleep(0.1)

    return {
        "message": "Hello from FastAPI on Fly.io!",
        "region": os.getenv("FLY_REGION", "unknown")
    }

# Example async database query simulation
@app.get("/api/users/{user_id}")
async def get_user(user_id: int):
    """Example async database query"""
    # Simulate async database query
    await asyncio.sleep(0.1)

    if user_id < 1:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": user_id,
        "name": f"User {user_id}",
        "email": f"user{user_id}@example.com"
    }

# Startup event
@app.on_event("startup")
async def startup_event():
    """Initialize resources on startup"""
    print("🚀 FastAPI application starting up...")
    # Initialize database connection pool
    # Initialize Redis connection
    # Initialize other resources

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup resources on shutdown"""
    print("👋 FastAPI application shutting down...")
    # Close database connections
    # Close Redis connections
    # Cleanup other resources

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
