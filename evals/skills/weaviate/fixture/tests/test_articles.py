import articles


def test_read_articles_yields_numbered_articles(tmp_path):
    export = tmp_path / "export.jsonl"
    export.write_text('{"title": "a", "body": "b"}\n\n{"title": "c", "body": "d"}\n', encoding="utf-8")
    assert list(articles.read_articles(export)) == [
        (1, {"title": "a", "body": "b"}),
        (3, {"title": "c", "body": "d"}),
    ]


def test_read_articles_skips_broken_and_incomplete_lines(tmp_path):
    export = tmp_path / "export.jsonl"
    export.write_text('not json\n{"title": "only a title"}\n{"title": "ok", "body": "fine"}\n', encoding="utf-8")
    assert [n for n, _ in articles.read_articles(export)] == [3]
