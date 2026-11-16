"""Reads the article export: one JSON object per line with a title and a body."""
import json
from pathlib import Path


def read_articles(path):
    """Yield (line_number, article) for each readable line; a broken line is skipped, not fatal."""
    with Path(path).open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                article = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(article, dict) and article.get("title") and article.get("body"):
                yield number, article
