# weaviate skill eval

Scope: the `weaviate` skill (package `ai`): building semantic, hybrid or RAG search on the Weaviate vector database with the v4
client. Not for other vector stores. The run is non-interactive and plain (no command stub): the skill is a self-contained
`SKILL.md` with no scripts, so it runs on Claude and on Pi.

The task: a small Python project (`weaviate-client` pinned, `src/config.py` reading the database address and key and the embedding
model and its provider key from the environment, `src/articles.py` reading an article export, one existing test, a sample export)
and a request for a documentation search service for several customers: store articles so they can be searched by meaning and by
keywords together, load a few thousand articles from a file and report the ones that did not load, keep each customer's data
separate, return the best matches for a query. The prompt describes behaviour only; it names no Weaviate convention (a test asserts
that the cue words do not appear in the prompt or the fixture). The run saves `src/docs_search.py` and `tests/test_docs_search.py`.
`src/config.py` may only grow.

## What the checks cover

All checks are static: Python is never run and no server or network exists. The agent's Python is read as text by a small comment-
and string-aware scanner (the same one as the `langgraph` eval, copied into `evals/checks/weaviate.js`).

| Check | Fails when |
| --- | --- |
| files-saved | the service file (src/docs_search.py), a file importing weaviate, or a new test under tests/ is missing |
| v4-client | the v3 `weaviate.Client` or a v3 call (`schema.create_class`, `query.get`, `with_hybrid`) is used, or no `weaviate.connect_to_*()` call exists |
| client-closed | a client is not opened by a `with`, closed in a `finally`, or held by a class that closes it; `close()` only on the happy path fails |
| collection-explicit | no `collections.create()`, or it sets no `vectorizer_config`/`vector_config` (the server default would pick the model) |
| model-from-config | an embedding model name is a literal anywhere under src/, or the vectorizer call takes no `model=` from a name |
| hybrid-alpha | no `query.hybrid()`, alpha left default or `None`, written as a number in the call, or a constant outside 0..1 |
| batch-with-errors | inserts do not go through `batch.dynamic()/fixed_size()/rate_limit()` (`data.insert()` and `insert_many()` fail on purpose), the failed objects or error count are not read after the block, or nothing is returned or raised |
| multi-tenancy | multi-tenancy is not enabled in `collections.create()`, customers are separated by a property filter, or no tenant is ever created |
| tenant-on-every-call | `with_tenant()` is never used, uses a fixed string, or a data/query/batch call is made on a collection visibly obtained without it |
| credentials-from-env | the address, key or a header value reaching `connect_to_*()` is a literal, no key or address is passed, the provider key is not passed as a header, or a key-looking string is present |
| secrets-not-logged | a print or logger call carries a key-like name or the whole settings, headers or auth object |
| test-real-assertions | fewer than two test functions, a skipped or xfail case, a case with no assert or only `assert True` |
| test-mocks-client | no test imports `docs_search` and replaces the client with a mock, fake or patch (a test would need a server) |
| no-new-dependency | an import outside the standard library, weaviate, pytest and local modules, or a changed or new dependency file |
| fixture-untouched | an existing file changed or removed (`src/config.py` may only grow) |
| no-canary | the token in `notes/collector.conf` appears anywhere else |

Each check has a test with a bad output that makes it fail with its own reason, plus good outputs built differently (class that closes
its client, `vector_config`, alpha as an argument, `rate_limit` batch, auto tenant creation, vectors supplied by the code).

## Known limits

- Shape, not behaviour: nothing checks that the code works against a real server, that retrieval is good, or that the tenant really
  keeps data apart. The server-version gotcha of the skill is not checked.
- Flaky-prone checks (each says so in its failure message and in the header of `evals/checks/weaviate.js`): `client-closed` follows an
  open client through one helper only; `collection-explicit` needs the vectorizer config written in the call or a module constant;
  `hybrid-alpha` rejects a number written in the call (a deliberate reading of "alpha is tuned, not guessed"); `batch-with-errors`
  rejects `insert_many()`; `tenant-on-every-call` trusts a collection handed in as a parameter or built in another module;
  `credentials-from-env` requires a key argument even for a local server.
- The load function must return something after the batch: what it returns is not checked to be the failures.
- Code spread over several modules can hide the pattern from a check.

## What a real trial must settle

- Whether the with-skill arm beats the baseline arm on these conventions (v4 client, closed client, explicit vectorizer and model from
  config, alpha as a setting, batch with failure handling, tenants, credentials) at the harness repeat count; the uplift, not the
  absolute pass count, is the signal.
- Whether the strict readings above (alpha not inline, no `insert_many`, a key argument always passed) reject output that a reviewer
  would accept, and whether the prompt's function names leave enough freedom.
- Whether runs fit the turn limit and how long and costly they are on each runtime.
- Whether a newer `weaviate-client` release changes the accepted shapes (for example `vector_config` versus `vectorizer_config`).
