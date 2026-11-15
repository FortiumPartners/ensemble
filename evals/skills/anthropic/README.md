# anthropic skill eval

Eval of `packages/ai/skills/anthropic/SKILL.md` ("Anthropic API conventions"). Runtimes: Claude Code and Pi (the skill is a plain `SKILL.md`
with no scripts or paths, so Pi can load it alone).

## Scope

A non-interactive run adds a Claude-backed support-ticket assistant to a small TypeScript support-desk app. The fixture already has a
`Ticket` type, an order-status lookup (`src/orders.ts`, which throws on a malformed id), a config module that reads the environment
(`src/config.ts`), a long fixed policy (`docs/refund-policy.md`, about 6 KB, long enough that caching it is worth doing), one existing test
(`test/orders.cases.ts`, named `*.cases.ts` so the repository's jest never runs it), a `package.json` that declares `@anthropic-ai/sdk`
(nothing is installed) and a canary file (`notes/collector.conf`). The run saves `src/assistant.ts` and `test/assistant.test.ts`; `src/config.ts`
may gain lines. Not in scope: OpenAI, Perplexity or other providers.

The prompt is functional (summarize a ticket, answer with an order-lookup tool, stream the reply, reuse a long policy across requests, reason
carefully on escalated tickets, take the client as an argument, test with a stand-in). It names none of the conventions under test; a test
asserts that.

## What the checks cover (all static: the code is read as text, nothing runs, no network)

| Check | Proves |
|---|---|
| `files-saved`, `uses-sdk` | the two named files hold code; the SDK is imported and used (no raw HTTP) |
| `model-not-hardcoded`, `no-hardcoded-limits-prices` | no model id literal (a `?? 'claude-...'` default counts), no model string literal, no context size or price constant |
| `api-key-from-env`, `key-not-logged` | no key literal anywhere (`sk-ant-...`, `apiKey: '...'`, literal fallback), the key is not logged |
| `max-tokens-every-call`, `stop-reason-handled` | every `messages.create/stream` sets `max_tokens`; `max_tokens`, `tool_use` and `refusal` are each compared |
| `streams-answer` | the SDK stream helper, text forwarded to `onText` as it arrives, `finalMessage()` awaited, no hand-parsed stream |
| `tool-uses-existing-lookup`, `tool-results-every-id`, `tool-error-flagged` | the existing lookup is the tool; every `tool_use` block (not just the first) gets a `tool_result` with its own id, in order, in a user message; a failing tool is caught and returned with `is_error` |
| `thinking-for-hard`, `thinking-budget-below-max`, `assistant-turn-verbatim` | extended thinking only for escalated tickets; `budget_tokens` below `max_tokens` (and at least 1024) when both are literals; the assistant turn is the response content, unfiltered |
| `cache-control-present`, `cache-on-stable-prefix`, `cache-not-on-volatile` | `cache_control` is ephemeral, sits on fixed content (the policy or tools), and not on the ticket turn or on text that interpolates per-request data |
| `policy-doc-loaded` | the policy is read from disk, not pasted into code |
| `no-custom-retry` | no retry/backoff/sleep, no 429/5xx branching, no caught rate-limit error (`maxRetries` alone is allowed) |
| `test-mocked-client` | the test has at least two cases with real assertions, a stand-in client, no network, no real key, imports the module |
| `no-new-dependency`, `fixture-untouched`, `no-canary` | `package.json` unchanged, no install output, every import declared or built in; no existing file changed except `src/config.ts` (additions only); nothing outside `src/` and `test/`; the canary token is not copied |

## Known limits

- The checks read text. They show the shape of the code, not that it compiles, runs or behaves; the scanner is not a TypeScript parser
  (see the header of `evals/checks/anthropic.js`: a regexp literal after `)` or `}` is read as division).
- A request built by a helper function (`messages.stream(buildParams(...))`) cannot be read, so `max-tokens-every-call` and
  `model-not-hardcoded` fail with a message saying so. This can fail a good solution.
- `thinking-budget-below-max` compares only literals or `const N = 123`; anything else passes with a note. `thinking: { type: 'adaptive' }`
  (no budget) passes. A top-level (automatic) `cache_control` on the whole request would be read as volatile and fail.
- Flaky-prone, with the reasons in the header of the check file: `max-tokens-every-call`, `model-not-hardcoded` (a default id is a
  hard-coded id), `stop-reason-handled` (comparisons only), `tool-results-every-id`, `tool-error-flagged`, `assistant-turn-verbatim`,
  `cache-*` (the volatile words are `ticket`, `customer`, `Date`, `random`, `uuid`, `timestamp`), `no-custom-retry` (an unrelated `attempt`
  variable fails), `test-mocked-client`.
- The prompt says the lookup throws on a malformed id, which is a fact the code needs; it gives the baseline arm a hint toward error
  handling but not the `is_error` flag.
- The model ids, the SDK version and the stop reasons in the checks follow the skill's text; if the API changes them the skill and these
  checks change together.

## What a real trial must settle

- Whether a model with the skill passes more checks than one without it. The baseline arm is expected to measure the plugin's conventions
  (hard-coded model id, missing `max_tokens` or stop reasons, only the first tool call answered, thinking blocks dropped, cache on the wrong
  block, a retry loop of its own); this eval states no measured results.
- Whether the flaky-prone checks reject good, differently shaped solutions (a request built in a helper, a lookup table keyed by stop reason,
  a policy variable named after the ticket), and whether the prompt is clear enough that failures come from the model's conventions, not from
  the task being misread.
- Whether a run of 5 repeats is enough for this task's variance, and how long a run takes.
