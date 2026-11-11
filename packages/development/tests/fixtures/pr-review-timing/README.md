# pr-review-timing fixture

`trace-review-pr234.jsonl` is a real review converted to a `lib/run-trace.js` trace: the
2026-11-05 review of PR #234 (`docs/plans/pr-review-speedup-plan.md`, section 1, "Correction after
measuring two small PRs"): an orchestrating agent that ran 92 turns and 102 tool calls, and 61
dispatched agents (classifier, second assessor, two security-lane runs, 6 reviewers and 51 verifiers).

How it was derived (one-off, from the omp session files; those files are what `lib/pr-review-timing.js`
exists to stop depending on, so the converter is not committed):

- One `review` span for the orchestrator: start = the session's first timestamp, `last_message_ts` = its last
  `message` event, end = its `session_exit` (7 minutes after the last message). `turns` = its assistant
  messages (92), `tool_calls` = its tool calls (102).
- One `review.<role>` span (kind `agent`) per dispatched agent, role taken from the agent's name (`Cls`,
  `Second`, `Sec`, `Rev`, `V`), `agent` = the name. Start = the agent session's first timestamp,
  `last_message_ts` = its last `message` event, end = its `session_exit`.
- The spans were written with `createTracer` and an injected clock, so the file is in the real format.

What it deliberately lacks: `review.head-read`, `review.gate` and `review.verdict` spans, and a `round`
attr. The session recorded none of them (the gate and verdict were ad-hoc scripts), and inventing them would
make the fixture claim more than was measured. Tests rely on that: the critical path of this trace has no total,
and the missing stages are reported as MISSING.

Figures it reproduces: wall 19.7 min, 5.9 min with at least one agent active, 13.8 min (70%) orchestrator-only,
3.0 min before the first dispatch, slowest reviewer 2 min 9 s, slowest verifier 79 s. Every agent span ends 7
minutes (the idle linger) after its `last_message_ts`; measuring to the span end instead would report only about 3 min
orchestrator-only, which is the error the plan's C01 correction describes.
