# Background worker Dockerfile
FROM python:3.12-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

COPY . .

RUN useradd -m -u 1001 worker && \
    chown -R worker:worker /app

USER worker

# Worker process - no HTTP port exposed
CMD ["celery", "-A", "tasks", "worker", "--loglevel=info", "--concurrency=10"]
