"""Deployment settings, read from the environment."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    db_url: str
    db_key: str
    embedding_model: str
    embedding_key: str


def load_settings() -> Settings:
    return Settings(
        db_url=os.environ.get("DOCS_SEARCH_URL", ""),
        db_key=os.environ.get("DOCS_SEARCH_KEY", ""),
        embedding_model=os.environ.get("EMBEDDING_MODEL", ""),
        embedding_key=os.environ.get("EMBEDDING_PROVIDER_KEY", ""),
    )
