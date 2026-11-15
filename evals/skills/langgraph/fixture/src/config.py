"""Deployment settings, read from the environment."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    model: str
    refund_limit: float


def load_settings() -> Settings:
    return Settings(
        model=os.environ.get("SUPPORT_MODEL", ""),
        refund_limit=float(os.environ.get("REFUND_LIMIT", "100")),
    )
