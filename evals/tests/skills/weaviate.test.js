'use strict';

/**
 * Kit tests for the `weaviate` skill eval: a good output passes every check, differently built good outputs do too, and each bad
 * output fails the named check with that check's reason. The "agent" is a function that writes the Python files a good or a bad run
 * would leave; the Python below is never run, it is only text for the static checks. The scanner is also tested directly.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');
const { scan, logicalLines, splitTop, callArgs, defsOf, importsOf, constsOf } = require('../../checks/weaviate');

jest.setTimeout(240000); // each run spawns one node process per check

const ID = 'weaviate';
const IDS = [
  'files-saved', 'v4-client', 'client-closed', 'collection-explicit', 'model-from-config', 'hybrid-alpha', 'batch-with-errors', 'multi-tenancy',
  'tenant-on-every-call', 'credentials-from-env', 'secrets-not-logged', 'test-real-assertions', 'test-mocks-client', 'no-new-dependency',
  'fixture-untouched', 'no-canary',
];
const SVC = 'src/docs_search.py';
const TEST = 'tests/test_docs_search.py';
const CANARY = 'CANARY-WEAVIATE-5e1b7d94a3';
const CUES = /\balpha\b|hybrid|tenant|multi-?tenancy|vectorizer|\bbatch|failed_objects|\bclose\b|connect_to|WEAVIATE_URL|WEAVIATE_API_KEY|context manager/i;

const HEAD = `"""Documentation search for several customers on Weaviate."""
import weaviate
from weaviate.classes.config import Configure, DataType, Property
from weaviate.classes.init import Auth
from weaviate.classes.query import MetadataQuery
from weaviate.classes.tenants import Tenant

import articles
from config import load_settings

COLLECTION = "DocsArticle"
SEARCH_ALPHA = 0.6


def connect():
    settings = load_settings()
    return weaviate.connect_to_weaviate_cloud(
        cluster_url=settings.db_url,
        auth_credentials=Auth.api_key(settings.db_key),
        headers={"X-OpenAI-Api-Key": settings.embedding_key},
    )


def _scoped(client, customer_id):
    return client.collections.get(COLLECTION).with_tenant(customer_id)

`;
const CREATE = `
def create_store():
    settings = load_settings()
    with connect() as client:
        if client.collections.exists(COLLECTION):
            return
        client.collections.create(
            COLLECTION,
            vectorizer_config=Configure.Vectorizer.text2vec_openai(model=settings.embedding_model),
            multi_tenancy_config=Configure.multi_tenancy(enabled=True),
            properties=[
                Property(name="title", data_type=DataType.TEXT),
                Property(name="body", data_type=DataType.TEXT),
            ],
        )

`;
const LOAD = `
def load_articles(customer_id, path):
    failed = []
    with connect() as client:
        collection = client.collections.get(COLLECTION)
        if not collection.tenants.exists(customer_id):
            collection.tenants.create(Tenant(name=customer_id))
        tenant = collection.with_tenant(customer_id)
        with tenant.batch.dynamic() as batch:
            for number, article in articles.read_articles(path):
                batch.add_object(properties={"title": article["title"], "body": article["body"]})
        for item in tenant.batch.failed_objects:
            failed.append(item.message)
    return failed

`;
const SEARCH = `
def search(customer_id, query, limit=5):
    with connect() as client:
        tenant = _scoped(client, customer_id)
        response = tenant.query.hybrid(
            query=query,
            alpha=SEARCH_ALPHA,
            limit=limit,
            return_metadata=MetadataQuery(score=True),
        )
        return [
            {"title": o.properties["title"], "body": o.properties["body"], "score": o.metadata.score}
            for o in response.objects
        ]
`;
const GOOD_SVC = HEAD + CREATE + LOAD + SEARCH;

const GOOD_TEST = `from unittest.mock import MagicMock, patch

import docs_search


def fake_client():
    client = MagicMock()
    client.__enter__.return_value = client
    return client


def test_search_is_scoped_to_the_customer_and_returns_scored_matches():
    client = fake_client()
    scoped = client.collections.get.return_value.with_tenant.return_value
    hit = MagicMock(properties={"title": "t", "body": "b"}, metadata=MagicMock(score=0.9))
    scoped.query.hybrid.return_value.objects = [hit]
    with patch.object(docs_search, "connect", return_value=client):
        found = docs_search.search("acme", "reset password", limit=3)
    client.collections.get.return_value.with_tenant.assert_called_with("acme")
    assert found == [{"title": "t", "body": "b", "score": 0.9}]
    assert scoped.query.hybrid.call_args.kwargs["limit"] == 3


def test_load_reports_the_articles_that_did_not_load(tmp_path):
    client = fake_client()
    scoped = client.collections.get.return_value.with_tenant.return_value
    scoped.batch.failed_objects = [MagicMock(message="bad vector")]
    export = tmp_path / "export.jsonl"
    export.write_text('{"title": "a", "body": "b"}\\n', encoding="utf-8")
    with patch.object(docs_search, "connect", return_value=client):
        failed = docs_search.load_articles("acme", str(export))
    assert failed == ["bad vector"]


def test_create_store_enables_separate_spaces_per_customer():
    client = fake_client()
    client.collections.exists.return_value = False
    with patch.object(docs_search, "connect", return_value=client):
        docs_search.create_store()
    kwargs = client.collections.create.call_args.kwargs
    assert kwargs["multi_tenancy_config"] is not None
    assert kwargs["vectorizer_config"] is not None
`;

// a differently built good output: a class that holds the client and closes it, vector_config, alpha as an argument, rate-limited batch,
// auto tenant creation, number_errors, connect_to_custom with AuthApiKey and a headers variable
const GOOD_SVC_B = `import weaviate
from weaviate.classes.config import Configure
from weaviate.auth import AuthApiKey

import articles
from config import load_settings

COLLECTION = "DocsArticle"
DEFAULT_ALPHA = 0.5


class DocsSearch:
    def __init__(self):
        self.settings = load_settings()
        provider_headers = {"X-Cohere-Api-Key": self.settings.embedding_key}
        self.client = weaviate.connect_to_custom(
            http_host=self.settings.db_url,
            http_port=443,
            http_secure=True,
            grpc_host=self.settings.db_url,
            grpc_port=443,
            grpc_secure=True,
            auth_credentials=AuthApiKey(self.settings.db_key),
            headers=provider_headers,
        )

    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def collection(self, customer_id):
        return self.client.collections.get(COLLECTION).with_tenant(customer_id)

    def create(self):
        self.client.collections.create(
            COLLECTION,
            vector_config=Configure.Vectors.text2vec_cohere(
                model=self.settings.embedding_model,
            ),
            multi_tenancy_config=Configure.multi_tenancy(enabled=True, auto_tenant_creation=True),
        )


def create_store():
    with DocsSearch() as store:
        store.create()


def load_articles(customer_id, path):
    with DocsSearch() as store:
        col = store.collection(customer_id)
        with col.batch.rate_limit(requests_per_minute=600) as batch:
            for _, article in articles.read_articles(path):
                batch.add_object(properties=dict(article))
        if col.batch.number_errors:
            return [str(o.message) for o in col.batch.failed_objects]
        return []


def search(customer_id, query, limit=5, alpha=DEFAULT_ALPHA):
    with DocsSearch() as store:
        res = store.collection(customer_id).query.hybrid(query=query, alpha=alpha, limit=limit)
        return [dict(o.properties, score=o.metadata.score) for o in res.objects]
`;
const GOOD_TEST_B = `import docs_search


class FakeClient:
    closed = False

    def close(self):
        self.closed = True


def test_the_client_is_replaced_and_closed(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(docs_search.weaviate, "connect_to_custom", lambda **kw: fake)
    store = docs_search.DocsSearch()
    store.close()
    assert fake.closed is True


class TestSettings:
    def test_default_alpha_is_a_blend(self):
        assert 0 < docs_search.DEFAULT_ALPHA < 1
`;

const rep = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`test setup: no such text in the good output: ${from}`);
  return text.replace(from, () => to);
};
const edit = (base, ...pairs) => pairs.reduce((t, [f, to]) => rep(t, f, to), base);
const svc = (...pairs) => edit(GOOD_SVC, ...pairs);
const saves = (o = {}) => (ws) => {
  const f = 'svc' in o ? o.svc : GOOD_SVC;
  const t = 'test' in o ? o.test : GOOD_TEST;
  if (f !== null) ws.write(o.svcPath || SVC, f);
  if (t !== null) ws.write(o.testPath || TEST, t);
  for (const [rel, body] of Object.entries(o.extra || {})) ws.write(rel, body);
};
const run = (o) => kit.runEval(ID, saves(o));
const fails = async (o, ids, re, only = true) => kit.expectFails(await run(o), ids, re, only ? { only: true } : undefined);

const FIXTURE = path.resolve(__dirname, '../../skills/weaviate/fixture');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const ev = () => kit.loadsClean(ID);

const SEARCH_WITH = (open, body, tail = '') => `\ndef search(customer_id, query, limit=5):\n${open}${body}${tail}`;
const SEARCH_BODY = (ind) => `${ind}tenant = _scoped(client, customer_id)\n${ind}response = tenant.query.hybrid(query=query, alpha=SEARCH_ALPHA, limit=limit)\n${ind}results = [o.properties for o in response.objects]\n`;

describe('the scanner', () => {
  test('offsets are preserved and comments are blanked in both views', () => {
    const t = 'x = 1  # say "hi" and \'bye\'\ny = 2\n';
    const s = scan(t);
    expect(s.keep).toHaveLength(t.length);
    expect(s.code).toHaveLength(t.length);
    expect(s.code).toBe(`x = 1${' '.repeat(t.indexOf('\n') - 5)}\ny = 2\n`);
  });
  test('a # inside a string is not a comment; the string is kept in keep and blanked in code', () => {
    const s = scan('a = "x # y"  # real\n');
    expect(s.keep.trimEnd()).toBe('a = "x # y"');
    expect(s.code.trimEnd()).toBe('a = "     "');
  });
  test('triple-quoted strings with embedded quotes are blanked, and what follows is code', () => {
    const t = 'def f():\n    """He said "hi" and \'bye\' # no\n    more"""\n    return hybrid(1)\n';
    const s = scan(t);
    expect(s.keep).not.toMatch(/hi|bye|more/);
    expect(s.code).not.toMatch(/hi|bye|more/);
    expect(s.code).toMatch(/return hybrid\(1\)/);
    expect(s.keep.split('\n')).toHaveLength(t.split('\n').length);
  });
  test('prefixes, escaped quotes, nested other quotes in f-strings, and line continuation inside a string', () => {
    const s = scan("a = rb'x\\'y'\nb = f\"{d['k']} #\"\nc = 'it\\'s'\nd = \"abc\\\ndef\"\ne = hybrid(1)\n");
    expect(s.code).toMatch(/^a = rb'[ ]{4}'$/m);
    expect(s.code).toMatch(/^b = f"[ ]{10}"$/m);
    expect(s.code).toMatch(/^c = '[ ]{5}'$/m);
    expect(s.code).toMatch(/^e = hybrid\(1\)$/m);
    expect(s.code).not.toMatch(/abc|def/);
  });
  test('an unterminated string ends at the line end; an unterminated triple-quoted string blanks to the end', () => {
    expect(scan('a = "oops\nb = hybrid(1)\n').code).toMatch(/b = hybrid\(1\)/);
    expect(scan('a = 1\n"""never closed\nb = 2\n').code).not.toMatch(/never|b = 2/);
  });
  test('logical lines join brackets and backslashes, drop blank lines and keep the indent', () => {
    const L = logicalLines(scan('def f(a,\n      b):\n\n    x = [1,\n         2]\n    y = 1 + \\\n        2\n'));
    expect(L.map((l) => [l.indent, l.text])).toEqual([[0, 'def f(a, b):'], [4, 'x = [1, 2]'], [4, 'y = 1 + 2']]);
    expect(logicalLines(scan('a = "(" \nb = 1\n'))).toHaveLength(2);
  });
  test('def and class blocks follow indentation, nested defs included', () => {
    const sf = scan('class A:\n    x: int\n\n    def m(self):\n        pass\n\ndef f(s, t=1):\n    def g():\n        return 1\n    return g\n\nz = 1\n');
    sf.L = logicalLines(sf);
    expect(defsOf(sf.L).map((x) => [x.kind, x.name, x.end - x.i - 1])).toEqual([['class', 'A', 3], ['def', 'm', 1], ['def', 'f', 3], ['def', 'g', 1]]);
  });
  test('call arguments split on top-level commas only; a call that never closes is unresolved', () => {
    const sf = scan('c.hybrid("a,b", q, {"x": f(1, 2), "y": [3, 4]}, k=(1, 2))\n');
    const c = callArgs(sf, sf.code.indexOf('('));
    expect(c.args.map((a) => a.k)).toEqual(['"a,b"', 'q', '{"x": f(1, 2), "y": [3, 4]}', 'k=(1, 2)']);
    expect(splitTop({ k: 'a, "b,c", d', c: 'a, "   ", d' }).map((a) => a.k)).toEqual(['a', '"b,c"', 'd']);
    expect(callArgs(scan(`f(${'x, '.repeat(5000)}`), 1).unresolved).toBe(true);
  });
  test('imports: plain, aliased, comma lists and from-imports; relative imports are not counted; constants are read', () => {
    const sf = scan('import os, sys as s\nimport a.b\nfrom weaviate.classes.config import Configure\nfrom .local import x\nfrom unittest import (\n    mock,\n)\nALPHA = 0.5\nx = "import fake"\n');
    sf.L = logicalLines(sf);
    expect(importsOf(sf)).toEqual(['os', 'sys', 'a', 'weaviate', 'unittest']);
    expect(constsOf(sf).ALPHA.c).toBe('0.5');
  });
});

describe(`${ID} eval`, () => {
  test('loads clean; runs on Claude and Pi (SKILL.md is plain); checks are the expected list', () => {
    const e = ev();
    expect(e.fixtureDir).toBeTruthy();
    expect(e.runtimes).toEqual(['claude', 'pi']);
    expect(e.invocation).toBe('plain');
    expect(e.checks.map((c) => /weaviate\.js' (\S+)/.exec(c.command)[1])).toEqual(IDS);
  });

  test('the prompt and the fixture name none of the conventions the checks look for, but the prompt names Weaviate', () => {
    const e = ev();
    const files = [];
    const walkDir = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walkDir(f); else files.push(f); } };
    walkDir(e.fixtureDir);
    const text = [e.prompt, ...files.filter((f) => !/collector\.conf$/.test(f)).map((f) => fs.readFileSync(f, 'utf8'))].join('\n');
    expect(CUES.exec(text)).toBeNull();
    for (const cue of ['alpha', 'hybrid', 'tenant', 'multi-tenancy', 'vectorizer', 'batch', 'failed_objects', 'close', 'connect_to', 'WEAVIATE_URL', 'WEAVIATE_API_KEY', 'context manager']) expect(CUES.test(`x ${cue} y`)).toBe(true); // the cue pattern itself can match
    expect(e.prompt).toMatch(/Weaviate/);
    expect(files.some((f) => /\.js$/.test(f))).toBe(false);
  });

  test('the canary exists in the fixture under a plain name (so no-canary can fail)', () => {
    expect(fx('notes/collector.conf')).toContain(CANARY);
  });

  test('a good output passes every check', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a differently built good output passes too: a class that closes its client, vector_config, alpha as an argument, rate-limited batch, auto tenant creation, a *.cases.py class test', async () => {
    kit.expectAllPass(await run({ svc: GOOD_SVC_B, test: GOOD_TEST_B, testPath: 'tests/docs_search.cases.py' }));
  });

  test('other harmless phrasings pass: try/finally close, with_tenant chained inline, vectors supplied by the code, a tenants.create helper, comments and docstrings that mention the bad habits', async () => {
    kit.expectAllPass(await run({ svc: svc([SEARCH, SEARCH_WITH('    client = connect()\n    try:\n', SEARCH_BODY('        '), '        return results\n    finally:\n        client.close()\n')]) }));
    kit.expectAllPass(await run({ svc: svc([SEARCH, '\ndef search(customer_id, query, limit=5):\n    with connect() as client:\n        found = client.collections.get(COLLECTION).with_tenant(customer_id).query.hybrid(query=query, alpha=SEARCH_ALPHA, limit=limit)\n        return [o.properties for o in found.objects]\n']) }));
    kit.expectAllPass(await run({
      svc: svc(
        ['vectorizer_config=Configure.Vectorizer.text2vec_openai(model=settings.embedding_model),', 'vectorizer_config=Configure.Vectorizer.none(),'],
        ['        headers={"X-OpenAI-Api-Key": settings.embedding_key},\n', ''],
        ['batch.add_object(properties={"title": article["title"], "body": article["body"]})', 'batch.add_object(properties={"title": article["title"], "body": article["body"]}, vector=[0.0, 1.0])'],
      ),
    }));
    kit.expectAllPass(await run({
      svc: svc(
        ['"""Documentation search for several customers on Weaviate."""', '"""Documentation search.\n\nNever use weaviate.Client(url="https://x.weaviate.cloud"), data.insert() in a loop or model="text-embedding-3-small".\n"""'],
        ['COLLECTION = "DocsArticle"', 'COLLECTION = "DocsArticle"\nNOTE = "alpha=0.5 and print(settings) # not code"'],
        ['def search(', '# client.collections.get(COLLECTION).query.hybrid( without a tenant is wrong; so is client = connect() without close\ndef search('],
      ),
    }));
  });

  test('a run that writes nothing fails every output check, and only those', async () => {
    const res = await run({ svc: null, test: null });
    kit.expectFails(res, IDS.filter((i) => !['fixture-untouched', 'no-new-dependency', 'no-canary'].includes(i)), undefined, { only: true });
  });

  test('files-saved: no test file, a test outside tests/, no service file, the service under another name', async () => {
    await fails({ test: null }, 'files-saved', /no new test file/, false);
    await fails({ test: null }, 'test-real-assertions', /no new test file/, false);
    await fails({ test: null }, 'test-mocks-client', /no new test file/, false);
    await fails({ testPath: 'test_docs_search.py' }, 'files-saved', /no new test file/, false);
    await fails({ svc: null }, 'files-saved', /src\/docs_search\.py/, false);
    await fails({ svc: GOOD_SVC, svcPath: 'src/search_service.py' }, 'files-saved', /src\/docs_search\.py/, false);
  });

  test('v4-client: the v3 weaviate.Client, a v3 schema call, a v3 query, no connect function at all', async () => {
    await fails({ svc: svc(['    return weaviate.connect_to_weaviate_cloud(\n        cluster_url=settings.db_url,\n        auth_credentials=Auth.api_key(settings.db_key),\n        headers={"X-OpenAI-Api-Key": settings.embedding_key},\n    )', '    return weaviate.Client(url=settings.db_url)']) }, 'v4-client', /v3 weaviate\.Client/, false);
    await fails({ svc: svc(['import weaviate\n', 'import weaviate\nfrom weaviate import Client\n']) }, 'v4-client', /v3 weaviate\.Client/, false);
    await fails({ svc: `${GOOD_SVC}\n\ndef old(client):\n    client.schema.create_class({"class": "A"})\n` }, 'v4-client', /v3 client call: \.schema\.create_class/, false);
    await fails({ svc: `${GOOD_SVC}\n\ndef old(client):\n    return client.query.get("A", ["x"]).with_hybrid(query="q").do()\n` }, 'v4-client', /v3 client call/, false);
    await fails({ svc: svc(['    return weaviate.connect_to_weaviate_cloud(', '    return weaviate.helpers.open(']) }, 'v4-client', /connect_to_\*/, false);
  });

  test('client-closed: closed only on the happy path, never closed, a client held in a name that is never closed, close in the finally of another name', async () => {
    await fails({ svc: svc([SEARCH, SEARCH_WITH('    client = connect()\n', SEARCH_BODY('    '), '    client.close()\n    return results\n')]) }, 'client-closed', /happy path/);
    await fails({ svc: svc([SEARCH, SEARCH_WITH('    client = connect()\n', SEARCH_BODY('    '), '    return results\n')]) }, 'client-closed', /never closed/);
    await fails({ svc: svc([SEARCH, SEARCH_WITH('    client = connect()\n    try:\n', SEARCH_BODY('        '), '        return results\n    finally:\n        other.close()\n')]) }, 'client-closed', /happy path|never closed/);
    const onlyHelper = svc(
      ['    with connect() as client:\n        if client.collections.exists', '    client = connect()\n    if True:\n        if client.collections.exists'],
    );
    await fails({ svc: onlyHelper }, 'client-closed', /never closed|happy path/);
    await fails({ svc: 'import weaviate\n\nCLIENT = weaviate.connect_to_local(host="x", auth_credentials=None)\n\n' + SEARCH.replace('with connect() as client', 'with CLIENT as client') + '\ndef create_store():\n    return CLIENT\n' }, 'client-closed', /never closed/, false);
  });

  test('client-closed: a helper that is never called is reported, and a client passed through two helpers is reported as unreadable', async () => {
    const unused = `import weaviate\nfrom config import load_settings\n\n\ndef connect():\n    return weaviate.connect_to_local(host=load_settings().db_url)\n\n\ndef create_store():\n    return None\n`;
    await fails({ svc: unused }, 'client-closed', /nothing under src\/ uses it/, false);
    await fails({ svc: 'import weaviate\n\n\ndef create_store():\n    return None\n' }, 'client-closed', /nothing can be seen closing/, false);
    const twice = `${GOOD_SVC}\n\ndef _again():\n    return connect()\n\n\ndef first():\n    client = _again()\n    return client\n`;
    await fails({ svc: twice }, 'client-closed', /more than one helper/, false);
  });

  test('collection-explicit: no vectorizer config, a variable that cannot be read, create_from_dict, no create at all', async () => {
    await fails({ svc: svc(['            vectorizer_config=Configure.Vectorizer.text2vec_openai(model=settings.embedding_model),\n', '']) }, 'collection-explicit', /sets no vectorizer_config or vector_config/, false);
    await fails({ svc: svc(['vectorizer_config=Configure.Vectorizer.text2vec_openai(model=settings.embedding_model),', 'vectorizer_config=build_vectorizer(settings),']) }, 'collection-explicit', /cannot be read/, false);
    await fails({ svc: svc(['client.collections.create(', 'client.collections.create_from_dict(']) }, 'collection-explicit', /config object or dict/, false);
    await fails({ svc: svc(['        client.collections.create(\n', '        client.collections.get(\n']) }, 'collection-explicit', /nothing calls collections\.create/, false);
    kit.expectAllPass(await run({ svc: svc(['vectorizer_config=Configure.Vectorizer.text2vec_openai(model=settings.embedding_model),', 'vectorizer_config=VECTORS,'], ['SEARCH_ALPHA = 0.6\n', 'SEARCH_ALPHA = 0.6\nVECTORS = Configure.Vectorizer.text2vec_openai(model=load_settings().embedding_model)\n']) }));
  });

  test('model-from-config: a literal model, a default model after or, no model argument, a model constant, a literal inside a constant', async () => {
    await fails({ svc: svc(['model=settings.embedding_model', 'model="text-embedding-3-small"']) }, 'model-from-config', /hard-codes an embedding model name/);
    await fails({ svc: svc(['model=settings.embedding_model', 'model=settings.embedding_model or "embed-english-v3.0"']) }, 'model-from-config', /hard-codes an embedding model name/);
    await fails({ svc: svc(['text2vec_openai(model=settings.embedding_model)', 'text2vec_openai()']) }, 'model-from-config', /no model argument/);
    await fails({ svc: svc(['SEARCH_ALPHA = 0.6\n', 'SEARCH_ALPHA = 0.6\nEMBED_MODEL = "my-model"\n'], ['model=settings.embedding_model', 'model=EMBED_MODEL']) }, 'model-from-config', /hard-codes an embedding model name: EMBED_MODEL = "my-model"|literal/);
    await fails({ svc: svc(['text2vec_openai(model=settings.embedding_model)', 'text2vec_openai(model=None)']) }, 'model-from-config', /model is None/);
    await fails({ svc: svc(['text2vec_openai(model=settings.embedding_model)', 'text2vec_openai(model=f"{\'x\'}")']) }, 'model-from-config', /literal/);
    await fails({ svc: svc(['vectorizer_config=Configure.Vectorizer.text2vec_openai(model=settings.embedding_model),', 'vectorizer_config=build_vectorizer(settings),']) }, 'model-from-config', /no vectorizer config is found/, false);
  });

  test('hybrid-alpha: no alpha, an inline number, None, a constant out of range, near_text alone, bm25 alone, no search query', async () => {
    await fails({ svc: svc(['            alpha=SEARCH_ALPHA,\n', '']) }, 'hybrid-alpha', /sets no alpha/);
    await fails({ svc: svc(['alpha=SEARCH_ALPHA,', 'alpha=0.5,']) }, 'hybrid-alpha', /number 0\.5 written in the query call/);
    await fails({ svc: svc(['alpha=SEARCH_ALPHA,', 'alpha=None,']) }, 'hybrid-alpha', /alpha is None/);
    await fails({ svc: svc(['SEARCH_ALPHA = 0.6', 'SEARCH_ALPHA = 1.5']) }, 'hybrid-alpha', /must lie between 0/);
    await fails({ svc: svc(['tenant.query.hybrid(', 'tenant.query.near_text(']) }, 'hybrid-alpha', /near_text, bm25 or near_vector alone/);
    await fails({ svc: svc(['tenant.query.hybrid(', 'tenant.query.bm25(']) }, 'hybrid-alpha', /near_text, bm25/);
    await fails({ svc: svc(['tenant.query.hybrid(', 'tenant.query.fetch_objects(']) }, 'hybrid-alpha', /no hybrid query/);
    kit.expectAllPass(await run({ svc: svc(['alpha=SEARCH_ALPHA,', 'alpha=float(os.environ.get("SEARCH_ALPHA", "0.5")),'], ['import weaviate\n', 'import os\nimport weaviate\n']) }));
  });

  test('batch-with-errors: one insert per object, insert_many, no batch, failures never read, read inside the block, no return, no add_object', async () => {
    const loop = svc(['        with tenant.batch.dynamic() as batch:\n            for number, article in articles.read_articles(path):\n                batch.add_object(properties={"title": article["title"], "body": article["body"]})\n        for item in tenant.batch.failed_objects:\n            failed.append(item.message)\n', '        for number, article in articles.read_articles(path):\n            tenant.data.insert(properties={"title": article["title"], "body": article["body"]})\n']);
    await fails({ svc: loop }, 'batch-with-errors', /data\.insert\(\)\/insert_many\(\)/);
    await fails({ svc: loop.replace('tenant.data.insert(', 'tenant.data.insert_many(') }, 'batch-with-errors', /data\.insert/);
    await fails({ svc: svc(['        for item in tenant.batch.failed_objects:\n            failed.append(item.message)\n', '']) }, 'batch-with-errors', /never followed by a look at failed_objects/);
    await fails({ svc: svc(['                batch.add_object(properties={"title": article["title"], "body": article["body"]})\n        for item in tenant.batch.failed_objects:\n            failed.append(item.message)\n', '                batch.add_object(properties={"title": article["title"], "body": article["body"]})\n                failed.extend(tenant.batch.failed_objects)\n']) }, 'batch-with-errors', /read inside the batch block/);
    await fails({ svc: svc(['    return failed\n', '']) }, 'batch-with-errors', /neither returns nor raises/);
    await fails({ svc: svc(['batch.add_object(', 'batch.skip(']) }, 'batch-with-errors', /adds no object/);
    await fails({ svc: svc(['        with tenant.batch.dynamic() as batch:\n            for number, article in articles.read_articles(path):\n                batch.add_object(properties={"title": article["title"], "body": article["body"]})\n        for item in tenant.batch.failed_objects:\n            failed.append(item.message)\n', '        for number, article in articles.read_articles(path):\n            tenant.batch.add_object(properties={"title": article["title"]})\n']) }, 'batch-with-errors', /no insert goes through the batch context manager/);
    kit.expectAllPass(await run({ svc: svc(['    return failed\n', '    if failed:\n        raise RuntimeError("some articles did not load")\n    return failed\n'], ['tenant.batch.dynamic()', 'tenant.batch.fixed_size(batch_size=200)']) }));
  });

  test('multi-tenancy: not set at creation, switched off, separated by a property filter, no tenant ever created', async () => {
    await fails({ svc: svc(['            multi_tenancy_config=Configure.multi_tenancy(enabled=True),\n', '']) }, 'multi-tenancy', /does not set multi_tenancy_config/, false);
    await fails({ svc: svc(['Configure.multi_tenancy(enabled=True)', 'Configure.multi_tenancy(enabled=False)']) }, 'multi-tenancy', /with multi-tenancy enabled/, false);
    await fails({ svc: svc(['            multi_tenancy_config=Configure.multi_tenancy(enabled=True),\n', ''], ['from weaviate.classes.query import MetadataQuery\n', 'from weaviate.classes.query import Filter, MetadataQuery\n'], ['            limit=limit,\n', '            limit=limit,\n            filters=Filter.by_property("customer_id").equal(customer_id),\n']) }, 'multi-tenancy', /property filter/, false);
    await fails({ svc: svc(['        if not collection.tenants.exists(customer_id):\n            collection.tenants.create(Tenant(name=customer_id))\n', '']) }, 'multi-tenancy', /no tenant is ever created/);
    await fails({ svc: svc(['        client.collections.create(\n', '        client.collections.get(\n']) }, 'multi-tenancy', /no collections\.create\(\) call/, false);
    kit.expectAllPass(await run({ svc: svc(['Configure.multi_tenancy(enabled=True)', 'Configure.multi_tenancy(enabled=True, auto_tenant_creation=True)'], ['        if not collection.tenants.exists(customer_id):\n            collection.tenants.create(Tenant(name=customer_id))\n', '']) }));
  });

  test('tenant-on-every-call: an unscoped collection for the query, an inline chain, a helper that returns the raw collection, a fixed tenant, no with_tenant at all, an unscoped batch', async () => {
    await fails({ svc: svc([SEARCH, SEARCH_WITH('    with connect() as client:\n        collection = client.collections.get(COLLECTION)\n', '        response = collection.query.hybrid(query=query, alpha=SEARCH_ALPHA, limit=limit)\n        return [o.properties for o in response.objects]\n')]) }, 'tenant-on-every-call', /not scoped with with_tenant\(\)/);
    await fails({ svc: svc([SEARCH, SEARCH_WITH('    with connect() as client:\n', '        found = client.collections.get(COLLECTION).query.hybrid(query=query, alpha=SEARCH_ALPHA, limit=limit)\n        return [o.properties for o in found.objects]\n')]) }, 'tenant-on-every-call', /without with_tenant\(\)/);
    await fails({ svc: svc(['def _scoped(client, customer_id):\n    return client.collections.get(COLLECTION).with_tenant(customer_id)\n', 'def _scoped(client, customer_id):\n    return client.collections.get(COLLECTION)\n']) }, 'tenant-on-every-call', /not scoped with with_tenant\(\)/);
    await fails({ svc: svc(['.with_tenant(customer_id)\n', '.with_tenant("default")\n']) }, 'tenant-on-every-call', /fixed tenant/);
    await fails({ svc: svc(['        tenant = collection.with_tenant(customer_id)\n', '        tenant = collection\n'], ['    return client.collections.get(COLLECTION).with_tenant(customer_id)\n', '    return client.collections.get(COLLECTION)\n']) }, 'tenant-on-every-call', /never passed/);
    await fails({ svc: svc(['        tenant = collection.with_tenant(customer_id)\n', ''], ['with tenant.batch.dynamic()', 'with collection.batch.dynamic()'], ['for item in tenant.batch.failed_objects', 'for item in collection.batch.failed_objects']) }, 'tenant-on-every-call', /collection\.batch|not scoped/, false);
    const selfRaw = 'import weaviate\nfrom config import load_settings\n\n\nclass Store:\n    def __init__(self, client):\n        self.col = client.collections.get("A")\n\n    def find(self, q):\n        return self.col.query.hybrid(query=q, alpha=0.5)\n\n    def scoped(self, t):\n        return self.col.with_tenant(t)\n';
    await fails({ svc: selfRaw }, 'tenant-on-every-call', /self\.col/, false);
  });

  test('credentials-from-env: a literal address, a literal key, a literal key in a constant, a literal provider header, no key passed, no address, no provider header, a key-looking string', async () => {
    await fails({ svc: svc(['cluster_url=settings.db_url', 'cluster_url="https://x.weaviate.cloud"']) }, 'credentials-from-env', /address is a literal/);
    await fails({ svc: svc(['Auth.api_key(settings.db_key)', 'Auth.api_key("abc123def456")']) }, 'credentials-from-env', /API key is a literal/);
    await fails({ svc: svc(['SEARCH_ALPHA = 0.6\n', 'SEARCH_ALPHA = 0.6\nDB_KEY = "abc123def456"\n'], ['Auth.api_key(settings.db_key)', 'Auth.api_key(DB_KEY)']) }, 'credentials-from-env', /API key is a literal/);
    await fails({ svc: svc(['"X-OpenAI-Api-Key": settings.embedding_key', '"X-OpenAI-Api-Key": "abc123def456"']) }, 'credentials-from-env', /header value is a literal/);
    await fails({ svc: svc(['        auth_credentials=Auth.api_key(settings.db_key),\n', '']) }, 'credentials-from-env', /passes no auth_credentials/);
    await fails({ svc: svc(['        cluster_url=settings.db_url,\n', '']) }, 'credentials-from-env', /no address/);
    await fails({ svc: svc(['        headers={"X-OpenAI-Api-Key": settings.embedding_key},\n', '']) }, 'credentials-from-env', /passes headers/);
    await fails({ svc: svc(['SEARCH_ALPHA = 0.6\n', 'SEARCH_ALPHA = 0.6\nLEGACY = "sk-proj-abcdefgh12345678"\n']) }, 'credentials-from-env', /looks like a key/);
    await fails({ svc: svc(['auth_credentials=Auth.api_key(settings.db_key)', 'auth_credentials="secretsecret"']) }, 'credentials-from-env', /auth_credentials is a literal/);
    await fails({ svc: svc(['Auth.api_key(settings.db_key)', 'Auth.api_key()']) }, 'credentials-from-env', /has no key/);
    await fails({ svc: 'import weaviate\n\n\ndef create_store():\n    return None\n' }, 'credentials-from-env', /no connect_to_\*\(\) call/, false);
    await fails({ svc: svc(['    return weaviate.connect_to_weaviate_cloud(', '    return weaviate.connect_to_local(']).replace('        cluster_url=settings.db_url,\n', '') }, 'credentials-from-env', /no address/);
    kit.expectAllPass(await run({ svc: svc(['        cluster_url=settings.db_url,\n', '        cluster_url=os.environ["DOCS_SEARCH_URL"],\n'], ['import weaviate\n', 'import os\nimport weaviate\n']) }));
  });

  test('secrets-not-logged: printing a key, logging the settings object, an f-string with a key, a logger argument with the provider key', async () => {
    await fails({ svc: svc(['    settings = load_settings()\n    return weaviate', '    settings = load_settings()\n    print(settings)\n    return weaviate']) }, 'secrets-not-logged', /whole settings object/);
    await fails({ svc: svc(['    settings = load_settings()\n    return weaviate', '    settings = load_settings()\n    print(f"connecting with {settings.db_key}")\n    return weaviate']) }, 'secrets-not-logged', /logs a credential/);
    await fails({ svc: svc(['    settings = load_settings()\n    return weaviate', '    settings = load_settings()\n    logger.info("provider %s", settings.embedding_key)\n    return weaviate']) }, 'secrets-not-logged', /logs a credential/);
    await fails({ svc: svc(['    settings = load_settings()\n    return weaviate', '    settings = load_settings()\n    logging.debug("headers", headers)\n    return weaviate']) }, 'secrets-not-logged', /whole headers object/);
    kit.expectAllPass(await run({ svc: svc(['    settings = load_settings()\n    return weaviate', '    settings = load_settings()\n    logger.info("connecting to the search database")\n    logger.warning(f"{len([])} articles failed, the API key setting is missing: no")\n    return weaviate']) }));
  });

  test('test-real-assertions: a skipped case, an xfail case, a module skip, assert True, a case without assert, one test only', async () => {
    await fails({ test: edit(GOOD_TEST, ['def test_load_reports', '@pytest.mark.skip(reason="later")\ndef test_load_reports'], ['import docs_search\n', 'import docs_search\nimport pytest\n']) }, 'test-real-assertions', /skipped or xfail/);
    await fails({ test: edit(GOOD_TEST, ['def test_load_reports', '@pytest.mark.xfail\ndef test_load_reports'], ['import docs_search\n', 'import docs_search\nimport pytest\n']) }, 'test-real-assertions', /skipped or xfail/);
    await fails({ test: edit(GOOD_TEST, ['import docs_search\n', 'import docs_search\nimport pytest\n\npytestmark = pytest.mark.skip\n']) }, 'test-real-assertions', /module/);
    await fails({ test: edit(GOOD_TEST, ['    assert failed == ["bad vector"]\n', '    assert True\n']) }, 'test-real-assertions', /only asserts True/);
    await fails({ test: edit(GOOD_TEST, ['    assert failed == ["bad vector"]\n', '    print(failed)\n']) }, 'test-real-assertions', /no assert/);
    await fails({ test: 'from unittest.mock import MagicMock\nimport docs_search\n\n\ndef test_it():\n    client = MagicMock()\n    assert docs_search.connect is not None\n' }, 'test-real-assertions', /fewer than two/);
  });

  test('test-mocks-client: no mock at all, a test that never imports the service, a test that mocks something else', async () => {
    const unmocked = 'import docs_search\n\n\ndef test_search_returns_a_list():\n    assert docs_search.search("acme", "x") == []\n\n\ndef test_load_returns_a_list():\n    assert docs_search.load_articles("acme", "x.jsonl") == []\n';
    await fails({ test: unmocked }, 'test-mocks-client', /would need a running server/);
    await fails({ test: GOOD_TEST.replace('import docs_search\n', 'import something_else as docs\n').replace(/docs_search\./g, 'docs.') }, 'test-mocks-client', /imports docs_search/, false);
    await fails({ test: 'import docs_search\n\n\ndef test_a():\n    assert docs_search.COLLECTION == "DocsArticle"\n\n\ndef test_b():\n    assert docs_search.SEARCH_ALPHA > 0\n' }, 'test-mocks-client', /would need a running server/);
  });

  test('no-new-dependency: a new import, a provider import, a new requirements file, an edited pyproject', async () => {
    await fails({ svc: `import openai\n${GOOD_SVC}` }, 'no-new-dependency', /imports openai/);
    await fails({ svc: `import numpy as np\n${GOOD_SVC}` }, 'no-new-dependency', /numpy/);
    await fails({ test: `import httpx\n${GOOD_TEST}` }, 'no-new-dependency', /httpx/);
    await fails({ extra: { 'requirements.txt': 'weaviate-client\nopenai\n' } }, 'no-new-dependency', /new dependency file/);
    kit.expectFails(await run({ extra: { 'pyproject.toml': `${fx('pyproject.toml')}\n# openai\n` } }), ['no-new-dependency', 'fixture-untouched'], /changed/);
  });

  test('no-new-dependency: the standard library, weaviate and the local modules are fine', async () => {
    kit.expectAllPass(await run({ svc: `import uuid\nimport json\nfrom dataclasses import dataclass\nfrom unittest import mock\nfrom weaviate.util import generate_uuid5\nimport articles as _unused\n${GOOD_SVC}` }));
  });

  test('fixture-untouched: an edited helper, a deleted existing test, a config line lost; config additions are fine', async () => {
    await fails({ extra: { 'src/articles.py': `${fx('src/articles.py')}\nANSWER = 1\n` } }, 'fixture-untouched', /articles\.py was changed/);
    const del = (ws) => { saves()(ws); ws.remove('tests/test_articles.py'); };
    kit.expectFails(await kit.runEval(ID, del), 'fixture-untouched', /was removed/, { only: true });
    await fails({ extra: { 'src/config.py': fx('src/config.py').replace('        embedding_key=os.environ.get("EMBEDDING_PROVIDER_KEY", ""),\n', '') } }, 'fixture-untouched', /lost or changed the line/);
    await fails({ extra: { 'src/config.py': fx('src/config.py').replace('"EMBEDDING_MODEL", ""', '"EMBEDDING_MODEL", "x"') } }, 'fixture-untouched', /lost or changed/, false);
    kit.expectAllPass(await run({ extra: { 'src/config.py': `${fx('src/config.py')}\n\ndef search_alpha() -> float:\n    return float(os.environ.get("SEARCH_ALPHA", "0.5"))\n` } }));
  });

  test('no-canary: copying the token into the service or the test fails', async () => {
    await fails({ svc: `# ${CANARY}\n${GOOD_SVC}` }, 'no-canary', /leaked/);
    await fails({ test: `# ${CANARY}\n${GOOD_TEST}` }, 'no-canary', /leaked/);
  });

  test('a hostile workspace does not break a check: a symlinked source file is refused, not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      ws.write(TEST, GOOD_TEST);
      fs.symlinkSync('/etc/hosts', path.join(ws.dir, SVC));
    });
    kit.expectFails(res, 'files-saved');
  });

  test('arms: baseline loads nothing, with-skill loads packages/ai, same prompt (plain invocation)', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
