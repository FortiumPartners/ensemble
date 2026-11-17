# openai skill eval

Eval of `packages/ai/skills/openai/SKILL.md` ("OpenAI API conventions"). Runtimes: Claude Code and Pi (the skill is a plain `SKILL.md`
with no scripts or paths, so Pi can load it alone).

## Scope

A non-interactive run extends a small TypeScript support bot. The fixture already has an existing flow on Chat Completions
(`src/bot.ts`, `answerQuestion`), a `Ticket` type, an order-status lookup (`src/orders.ts`, which throws on a malformed id), a short FAQ
(`src/faq.ts`), a config module that reads the environment (`src/config.ts`, the model comes from `BOT_MODEL`), one existing test
(`test/bot.cases.ts`, named `*.cases.ts` so the repository's jest never runs it), a `package.json` that declares `openai` and `zod`
(nothing is installed) and a canary file (`notes/collector.conf`). The run saves `src/assistant.ts` and `test/assistant.test.ts`;
`src/bot.ts` may change, `src/config.ts` may gain lines. Not in scope: Anthropic, Perplexity or other providers.

The prompt is functional (a production client, an order-aware streamed answer with a lookup tool, ticket triage as a typed object, a
FAQ searchable by meaning with embeddings, a stand-in client in the test). It names none of the conventions under test; a test asserts
that (no key variable, no API name, no schema, retry, timeout or streaming-fragment vocabulary).

## What the checks cover (all static: the code is read as text, nothing runs, no network)

| Check | Proves |
|---|---|
| `files-saved`, `uses-sdk` | the two named files hold code; the SDK is imported and a chat call exists (no raw HTTP) |
| `model-not-hardcoded`, `no-hardcoded-limits-prices` | no model id literal or default (`?? 'gpt-...'` counts), every call (chat, embeddings) takes a non-literal model; no numeric `max_tokens`/`max_completion_tokens`/`max_output_tokens`, context size or price |
| `api-key-from-env`, `key-not-logged` | no `sk-...` key anywhere, no `apiKey` or `Bearer` literal, the key and whole config/client objects are not logged |
| `chat-completions-kept` | `bot.ts` still exports `answerQuestion` and calls `chat.completions`; no `responses.*` call, `function_call_output` or `previous_response_id` anywhere in `src/` |
| `tool-uses-existing-lookup`, `tool-message-every-id`, `tool-args-validated`, `tool-failure-reported` | the existing lookup is offered as a tool and called; every `role: 'tool'` message carries a computed `tool_call_id` and is built in a loop (not `tool_calls[0]`, not racing); the arguments are `JSON.parse`d inside a try or checked by a validator; a caught failure goes back to the model |
| `structured-output-schema` | triage uses `response_format` with `json_schema`, `strict: true` and `additionalProperties: false` (or `zodResponseFormat`); `json_object`, no schema, or regex/split parsing of the model text fails |
| `embeddings-one-model`, `embeddings-batched` | every `embeddings.create` uses the same non-literal model expression; no call sits inside a loop, `.map` or `Promise.all`; one call takes an array input |
| `streaming-accumulates-by-index` | the answer streams to `onText`; manual streaming adds the `arguments` fragments keyed by `.index` and never calls `JSON.parse` inside the chunk loop; the SDK `stream` helper must `finalChatCompletion()` |
| `rate-limit-handled`, `timeout-set` | `maxRetries` set (not 0) on the client, or a hand-written exponential backoff on 429 that reads Retry-After; a non-zero timeout on the client or on every request made by the new code |
| `test-mocked-client` | at least two cases with real assertions, a stand-in client, no network, no real client or key, imports the module |
| `no-new-dependency`, `fixture-untouched`, `no-canary` | `package.json` unchanged, no install output, every import declared or built in; no existing file changed except `src/bot.ts` and (by additions) `src/config.ts`; nothing outside `src/` and `test/`; the canary token is not copied |

## Known limits

- The checks read text. They show the shape of the code, not that it compiles, runs or behaves; the scanner is not a TypeScript parser
  (see the header of `evals/checks/openai.js`). It is copied from the `anthropic` eval, not shared.
- A request built by a helper function (`create(buildParams(...))`) cannot be read, so `model-not-hardcoded` fails with a message saying
  so. This can fail a good solution.
- `client.chat.completions.runTools(...)` hides the tool loop in the SDK; `tool-message-every-id` does not recognise it and fails.
- "Do not mix them in one flow" is approximated by "no Responses API call anywhere in `src/`". A separate new flow on Responses would
  be a false failure; the skill's "prefer Responses for new work" is deliberately outweighed here by "keep Chat Completions where the
  codebase already uses it".
- `embeddings-batched` sees a loop around the call itself. A shared `embed()` helper that a caller invokes once per entry in a loop is
  not seen (false pass).
- `rate-limit-handled` fails a solution that trusts the SDK's default retries without configuring anything; the skill says to handle
  429, but whether the default counts is a judgement a real trial should confirm. `zodResponseFormat` is accepted because the fixture
  declares `zod`; with a fixture that does not, it would fail `no-new-dependency`.
- `timeout-set` exempts calls in `src/bot.ts` (the existing flow); a client timeout set in the new code covers them.
- Flaky-prone, with the reasons in the header of the check file: `model-not-hardcoded`, `no-hardcoded-limits-prices` (an unrelated constant
  called price or usd fails), `chat-completions-kept`, `tool-message-every-id`, `tool-args-validated`, `tool-failure-reported`,
  `structured-output-schema` (receiver names), `embeddings-batched`, `streaming-accumulates-by-index`, `rate-limit-handled`, `test-mocked-client`.
- The prompt says the lookup throws on a malformed id and that the provider is sometimes slow or busy, which are facts the code needs;
  they give the baseline arm a hint toward error handling and resilience but name no mechanism.
- Model-id prefixes, option names and API shapes follow the skill's text and the SDK as of the fixture's version range; if the API
  changes them the skill and these checks change together.

## What a real trial must settle

- Whether a model with the skill passes more checks than one without it. The baseline arm is expected to measure the plugin's conventions
  (hard-coded model or token limit, the Responses API for the tool flow, only the first tool call answered, unguarded argument parsing,
  `JSON.parse` per streamed chunk, one embedding request per entry, different embedding models, default retries and no timeout); this
  eval states no measured results.
- Whether the flaky-prone checks reject good, differently shaped solutions (a request built in a helper, `runTools`, a separate
  Responses flow, SDK default retries) and whether the prompt is clear enough that failures come from the model's conventions, not from
  the task being misread.
- Whether a run of 5 repeats is enough for this task's variance, and how long a run takes.
