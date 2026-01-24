"""
Celery Beat Schedule Template

Template Variables:
    schedules: list[dict] - Schedule entries with:
        - name: str - Schedule entry name
        - task: str - Task name to execute
        - schedule_type: str - "crontab" or "interval"
        - crontab: dict - Crontab spec (minute, hour, day_of_week, etc.)
        - interval_seconds: int - Interval in seconds
        - args: list - Positional arguments
        - kwargs: dict - Keyword arguments
        - queue: str | None - Optional queue override
        - expires: int | None - Task expiration in seconds

Usage:
    render_template("beat_schedule.template.py", {
        "schedules": [
            {
                "name": "daily-cleanup",
                "task": "tasks.cleanup_old_records",
                "schedule_type": "crontab",
                "crontab": {"hour": 2, "minute": 0},
                "args": [30],
            },
            {
                "name": "health-check",
                "task": "tasks.health_check",
                "schedule_type": "interval",
                "interval_seconds": 60,
            },
        ]
    })
"""
from __future__ import annotations

from celery.schedules import crontab

# =============================================================================
# Beat Schedule Configuration
# =============================================================================
#
# Add this to your celery_app.py or celeryconfig.py:
#
#   from .beat_schedule import beat_schedule
#   app.conf.beat_schedule = beat_schedule
#
# Run beat with:
#   celery -A myapp.celery_app beat --loglevel=info
#
# =============================================================================

beat_schedule = {
    {% for schedule in schedules %}
    # -------------------------------------------------------------------------
    # {{ schedule.name }}
    # -------------------------------------------------------------------------
    "{{ schedule.name }}": {
        "task": "{{ schedule.task }}",
        {% if schedule.schedule_type == "crontab" %}
        "schedule": crontab(
            {% if schedule.crontab.minute is defined %}
            minute="{{ schedule.crontab.minute | default('*') }}",
            {% endif %}
            {% if schedule.crontab.hour is defined %}
            hour="{{ schedule.crontab.hour | default('*') }}",
            {% endif %}
            {% if schedule.crontab.day_of_week is defined %}
            day_of_week="{{ schedule.crontab.day_of_week | default('*') }}",
            {% endif %}
            {% if schedule.crontab.day_of_month is defined %}
            day_of_month="{{ schedule.crontab.day_of_month | default('*') }}",
            {% endif %}
            {% if schedule.crontab.month_of_year is defined %}
            month_of_year="{{ schedule.crontab.month_of_year | default('*') }}",
            {% endif %}
        ),
        {% else %}
        "schedule": {{ schedule.interval_seconds }}.0,  # seconds
        {% endif %}
        {% if schedule.args %}
        "args": {{ schedule.args }},
        {% endif %}
        {% if schedule.kwargs %}
        "kwargs": {{ schedule.kwargs }},
        {% endif %}
        {% if schedule.queue %}
        "options": {"queue": "{{ schedule.queue }}"},
        {% endif %}
        {% if schedule.expires %}
        "options": {"expires": {{ schedule.expires }}},
        {% endif %}
    },
    {% endfor %}
}

# =============================================================================
# Common Schedule Patterns Reference
# =============================================================================

SCHEDULE_PATTERNS = {
    # Every minute
    "every_minute": crontab(),

    # Every 15 minutes
    "every_15_minutes": crontab(minute="*/15"),

    # Every hour at minute 0
    "hourly": crontab(minute=0),

    # Every day at midnight UTC
    "daily_midnight": crontab(hour=0, minute=0),

    # Every day at 2 AM UTC (good for cleanup tasks)
    "daily_2am": crontab(hour=2, minute=0),

    # Weekdays at 9 AM (business hours start)
    "weekdays_9am": crontab(hour=9, minute=0, day_of_week="1-5"),

    # Every Sunday at 6 PM (weekly reports)
    "weekly_sunday": crontab(hour=18, minute=0, day_of_week=0),

    # First day of month at midnight (monthly tasks)
    "monthly_first": crontab(hour=0, minute=0, day_of_month=1),

    # First Monday of each month
    "monthly_first_monday": crontab(
        hour=0, minute=0, day_of_week=1, day_of_month="1-7"
    ),

    # Quarterly (Jan, Apr, Jul, Oct 1st)
    "quarterly": crontab(
        hour=0, minute=0, day_of_month=1, month_of_year="1,4,7,10"
    ),
}


# =============================================================================
# Example Beat Schedule
# =============================================================================

EXAMPLE_BEAT_SCHEDULE = {
    # Health check every 60 seconds
    "health-check": {
        "task": "tasks.health_check",
        "schedule": 60.0,
    },

    # Cleanup old records daily at 2 AM
    "daily-cleanup": {
        "task": "tasks.cleanup_old_records",
        "schedule": crontab(hour=2, minute=0),
        "args": (30,),  # days_old
    },

    # Generate reports every weekday at 9 AM
    "weekday-reports": {
        "task": "tasks.generate_daily_report",
        "schedule": crontab(hour=9, minute=0, day_of_week="1-5"),
        "options": {"queue": "reports"},
    },

    # Weekly summary every Sunday at 6 PM
    "weekly-summary": {
        "task": "tasks.send_weekly_summary",
        "schedule": crontab(hour=18, minute=0, day_of_week=0),
        "kwargs": {"include_charts": True},
    },

    # Monthly billing on the 1st at midnight
    "monthly-billing": {
        "task": "tasks.process_monthly_billing",
        "schedule": crontab(hour=0, minute=0, day_of_month=1),
        "options": {"queue": "billing", "expires": 3600},
    },
}
