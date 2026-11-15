# perplexity skill eval

Eval of `packages/ai/skills/perplexity/SKILL.md` ("Perplexity Sonar conventions"). Runtimes: Claude Code and Pi (the skill is a plain
`SKILL.md` with no scripts or paths, so Pi can load it alone).

## Scope

A non-interactive run extends a small TypeScript helper library for a newsroom desk. The fixture already has `src/summarize.ts`, which
builds a plain OpenAI client (`new OpenAI()`: the default endpoint and the default key variable) and makes one Chat Completions call, a
config module that reads the environment (`src/config.ts`, `SUMMARY_MODEL`), one existing test (`test/summarize.cases.ts`, named
`*.cases.ts` so the repository's jest never runs it), a `package.json` that declares only `openai` (nothing is installed) and a canary
file (`notes/collector.conf`). The run saves `src/research.ts` and `test/research.test.ts`; `src/config.ts` may gain lines, every other
existing file stays as it is. Not in scope: general LLM chat or non-search use of Perplexity.

The prompt is functional: it names Perplexity (so the skill can apply) and asks for a production client, an answer with the web pages it
came from, a follow-up question in a conversation, a streamed answer, a display text that makes clear where the facts came from, a short
list of trusted sites and an optional limit to the last day, week or month, and a stand-in client in the test. It names none of the
conventions under test; a test asserts that (no key variable, no base URL, no citations or search-results vocabulary, no filter field
names, no tool, role, marker, streaming-order or verification wording).

## What the checks cover (all static: the code is read as text, nothing runs, no network)

| Check | Proves |
|---|---|
| `files-saved` | `src/research.ts` and `test/research.test.ts` hold code |
| `perplexity-via-openai-sdk` | the OpenAI SDK is imported and a new client has `baseURL` `https://api.perplexity.ai` (the existing OpenAI client does not count); no `fetch`, axios or `https.request`; chat calls exist |
| `api-key-from-env` | no `pplx-`/`sk-` key anywhere; the new client sets `apiKey` from `PERPLEXITY_API_KEY` (not omitted, not a literal or fallback, not an OPENAI variable); no log call prints the key or a whole config/client |
| `model-not-hardcoded` | no model id literal or default (`?? 'sonar'` counts), no literal model setting; every readable request sets a model |
| `citations-from-response-field` | the sources are read from `.citations` / `.search_results`; no regex pulls URLs out of the text; no `site:` operator in the query |
| `sources-numbered-and-shown` | `formatAnswer` uses the sources, lists them, numbers them from 1; no statement reorders, dedupes, sorts, filters or cuts them |
| `no-search-tool-loop` | no `tools`, `tool_choice` or `functions` in a request; no `tool_calls`, `tool_call_id` or `role: 'tool'` |
| `filters-passed` | every request carries `search_domain_filter` and `search_recency_filter`; the domain list is not a fixed literal |
| `roles-alternate` | earlier turns are built in a loop or `.map` as a user message then an assistant message; no system message inside the loop |
| `stream-sources-after-end` | `stream: true` (or the SDK helper) and `onText`; no hand-written stream parsing; sources are not rendered or added up inside the chunk loop and are used after it |
| `answers-flagged-search-derived` | a string in `formatAnswer` (or a const it uses) says the answer is search-derived / unverified / to be checked |
| `test-mocked-client` | at least two cases with real assertions, a stand-in client whose response carries `citations` / `search_results`, no network, no real client, imports the module |
| `no-new-dependency`, `fixture-untouched`, `no-canary` | `package.json` unchanged, no install output, every import declared or built in; no existing file changed except `src/config.ts` (by additions); nothing outside `src/` and `test/`; the canary token is not copied |

## Known limits

- The checks read text. They show the shape of the code, not that it compiles, runs or behaves; the scanner is not a TypeScript parser
  (see the header of `evals/checks/perplexity.js`). It is copied from the `openai` eval, not shared.
- The Perplexity checks look only at new production files; `src/summarize.ts` and `src/config.ts` are excluded so the existing OpenAI
  client neither satisfies nor fails them. The model check does read all of `src/`.
- Requests are read when their argument is an object literal or a const object (spreads of const objects are followed, the nearest
  declaration before the call wins). A request built by a function is not read per call: `model-not-hardcoded` skips it (a helper that
  omits the model is a false pass) and `filters-passed` falls back to "both keys appear as keys somewhere in the new code" (lenient).
- `perplexity-via-openai-sdk` accepts a `baseURL` that is not a literal only when the Perplexity URL appears as a literal elsewhere in
  the new code.
- `sources-numbered-and-shown` requires a function called `formatAnswer` (the prompt names it) and a 1-based number (`+ 1` or a `- 1`
  lookup). It does not check that `[n]` markers in the text are rewritten; keeping them and appending a numbered list in API order is
  accepted. A harmless `.filter(Boolean)` on a statement that mentions the sources is a false failure.
- `roles-alternate` recognises history built by a loop or callback holding `role:` literals; history built another way (messages
  supplied by the caller, a Map, a helper that spreads typed arrays) is not recognised and fails.
- `stream-sources-after-end` accumulation is found per statement, so `const c = chunk.citations; sources.push(...c)` is a false pass.
  The SDK helper (`chat.completions.stream`) is accepted only with `finalChatCompletion()`.
- `answers-flagged-search-derived` is phrase based (unverified, verify, search-derived, double-check, ...); another wording is a false
  failure.
- The recency value is not checked: the skill does not list the values, so the check only requires the field to reach the request.
- Flaky-prone, with the reasons in the header of the check file: all of the above plus `no-search-tool-loop` (found by property name)
  and `test-mocked-client` (stand-in recognised by name or shape).
- The prompt tells the model the sources are wanted, that a follow-up exists and that a trusted-domain list and a recent-results limit
  exist, which are functional requirements; it gives the baseline arm no field name, key variable, endpoint or ordering rule.
- The skill names `citations`/`search_results` but only says "use domain and recency filters"; the request field names
  `search_domain_filter` and `search_recency_filter` come from the Perplexity API, not from the skill text, so `filters-passed` also
  rewards prior knowledge in both arms. If the API renames any field, the skill and these checks change together.

## What a real trial must settle

- Whether a model with the skill passes more checks than one without it. The baseline arm is expected to measure the plugin's
  conventions (the OpenAI key and endpoint by default, a hard-coded model, URLs scraped from the text or sources dropped, a tool loop
  around search, no domain or recency fields, consecutive same-role messages, sources rendered per chunk, the answer presented as
  authoritative); this eval states no measured results.
- Whether the lenient and heuristic checks reject good, differently shaped solutions (a request built in a helper, history built
  without a loop, a different notice wording, markers rewritten in the text) and whether the prompt is clear enough that failures come
  from the model's conventions, not from the task being misread.
- Whether the with-skill arm actually produces the exact filter field names, given the skill never spells them out.
- Whether the recent-results option, described only in words, is mapped to the request field by a model without the skill, and whether a
  run of 5 repeats is enough for this task's variance and how long a run takes.
