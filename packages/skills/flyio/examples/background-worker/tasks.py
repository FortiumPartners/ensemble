"""
Background Worker Tasks
Celery worker for processing background jobs
"""
from celery import Celery
import os
import time

# Initialize Celery
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
app = Celery('tasks', broker=redis_url, backend=redis_url)

# Configure Celery
app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)

@app.task(bind=True, max_retries=3)
def process_data(self, data_id):
    """Example task: Process data"""
    try:
        print(f"Processing data {data_id}...")
        time.sleep(5)  # Simulate work
        return {"status": "success", "data_id": data_id}
    except Exception as exc:
        # Retry with exponential backoff
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))

@app.task
def send_email(email, subject, body):
    """Example task: Send email"""
    print(f"Sending email to {email}: {subject}")
    time.sleep(2)
    return {"status": "sent", "email": email}

@app.task
def generate_report(report_id):
    """Example task: Generate report"""
    print(f"Generating report {report_id}...")
    time.sleep(10)
    return {"status": "completed", "report_id": report_id}

if __name__ == '__main__':
    app.start()
