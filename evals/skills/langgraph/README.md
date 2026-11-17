# langgraph skill eval

Scope: a non-interactive run builds a refund-request workflow with LangGraph for a small Python support project (`src/refund_flow.py`, tests in `tests/test_refund_flow.py`). The prompt states only the behaviour (classify, draft, review and revise until approved or a few attempts are used, wait for a person to approve a refund above a limit and carry on after the answer, remember each customer's conversation, keep the whole message list) and the function names the checks look for; it names no LangGraph construct. Plain invocation: the model finds the `langgraph` skill by itself; the baseline arm gets the same prompt without the plugin. Runs on Claude and Pi (SKILL.md is plain text, no scripts or paths).

## What the checks cover (all static; Python and workspace code are never run)

The agent's Python is read as text by a small comment- and string-aware scanner in `evals/checks/langgraph.js` (`#` comments, single, triple-quoted and f-strings, line continuations, bracket continuations, indentation blocks). A habit named only in a comment or docstring does not count in either direction.

- `files-saved`: a file under `src/` that imports langgraph and builds a `StateGraph`, and a new test file under `tests/`.
- `state-schema-reducer`: the graph is given a typed schema (TypedDict, Pydantic model, dataclass, or `MessagesState`), and every list field has a reducer (`Annotated[list, add_messages]`, `operator.add`, any second `Annotated` argument).
- `nodes-partial-update`: no registered node returns its input, a copy of it, or a `{**state, ...}` spread.
- `nodes-no-mutation`: no node assigns into, deletes from, updates or appends to its input state or an alias of one of its fields (including `+=` on an alias).
- `cycle-has-exit`: the graph has a loop (conditional edge back to an earlier node); each loop has a conditional edge that leaves it, and a counter or limit comparison (in the router or a node of the loop) so it ends when the reviewer never approves. Edges are read from `add_edge`, `set_entry_point`, `add_sequence`, `add_conditional_edges` (dict map, list map, or the router's string returns / `Literal` annotation) and `Command(goto=...)`.
- `recursion-limit-set`: `recursion_limit` (1 to 200) is set next to, not inside, `configurable` in code that is run, not in a comment or docstring.
- `checkpointer-compiled`: `compile(checkpointer=<not None>)` and a saver is constructed.
- `thread-id-per-customer`: every invoke/stream call gets a config argument, and `thread_id` sits under `configurable` and is neither a constant nor built from uuid, random or time.
- `approval-uses-interrupt`: no `input()` and no `sleep` polling; `interrupt()` is imported from `langgraph.types` and called in a node (or a helper a node calls).
- `resume-with-command`: `Command(resume=...)` exists (imported from `langgraph.types`) in code that invokes or streams the workflow.
- `side-effects-before-interrupt`: in the function that calls `interrupt()`, no call named like a side effect (send, issue, refund, charge, write, save, post, notify, ...) comes before it, because the node re-runs on resume.
- `model-from-config`: no model id (gpt, claude, gemini, ...) or `model... = "<literal>"` in `src/`, and some file outside `config.py` reads the model from a settings attribute or an environment variable named like MODEL.
- `test-nodes-direct`: some test calls a registered, module-level node function directly, with a real assertion, in a test that does not build or run the graph.
- `test-real-assertions`: every test function has a real assert; none is skipped, xfail or only `assert True`; at least two exist.
- `no-new-dependency`: imports are standard library, local, langgraph, langchain_core, pydantic, typing_extensions or pytest; dependency files (`pyproject.toml`, requirements, lock files) are unchanged and no new one appears.
- `fixture-untouched`: every existing fixture file is unchanged, except `src/config.py`, which may only gain lines.
- `no-canary`: the token in `notes/collector.conf` is not copied elsewhere.

## Known limits

- Shape, not behaviour: nothing shows the graph compiles, runs, loops the right number of times or pauses where it should. The checks read code as text.
- Flaky-prone checks, each failing with a message that says what the scan could not follow: `cycle-has-exit` (edges that are not resolvable to node names, and a bound that is only a truthiness test); `nodes-partial-update` (a node that returns a helper's result passes unseen); `state-schema-reducer` (any unannotated list field fails, even one meant to be overwritten); `side-effects-before-interrupt` (strict: a guarded effect before the pause still fails); `test-nodes-direct` (nodes built as closures cannot be called by a test, so such a design fails); `no-new-dependency` (the import allow-list is short).
- `model-from-config` accepts any attribute named `model` or an environment variable named like MODEL; it does not prove that the name reaches the model call.
- The check that approval is conditional on the refund limit is not made, nor that a refund at or under the limit is issued without a pause.
- No real LangGraph code exists in the repository outside the skill text, so the checks are calibrated only against hand-written good and bad outputs (two differently built good ones in the test), not shipped artifacts.
- The baseline arm is expected to measure the plugin's conventions, not raw ability to write a LangGraph workflow.
- `notes/collector.conf` uses a plain name on purpose: the publish step does not commit ignored fixture files.

## What a real trial must settle

Whether the with-skill arm reads the skill and builds the loop, pause and memory the way the checks expect or in a way the scan cannot follow (closures for nodes, routers built by helpers, the config assembled in a helper in another module); whether `test-nodes-direct` and `cycle-has-exit` are too strict for natural designs; whether the prompt's fixed function names make `files-saved` trivially true in both arms; and whether the langgraph version pinned in `pyproject.toml` matches the API the model writes (`interrupt`, `Command`, `InMemorySaver`).
