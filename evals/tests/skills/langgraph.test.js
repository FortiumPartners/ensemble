'use strict';

/**
 * Kit tests for the `langgraph` skill eval: a good output passes every check, differently built good outputs do too, and each bad
 * output fails the named check with that check's reason. The "agent" is a function that writes the Python files a good or a bad run
 * would leave; the Python below is never run, it is only text for the static checks. The scanner is also tested directly.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');
const { scan, logicalLines, splitTop, callArgs, defsOf, importsOf, constsOf, nodeName } = require('../../checks/langgraph');

jest.setTimeout(240000); // each run spawns one node process per check

const ID = 'langgraph';
const IDS = [
  'files-saved', 'state-schema-reducer', 'nodes-partial-update', 'nodes-no-mutation', 'cycle-has-exit', 'recursion-limit-set', 'checkpointer-compiled',
  'thread-id-per-customer', 'approval-uses-interrupt', 'resume-with-command', 'side-effects-before-interrupt', 'model-from-config', 'test-nodes-direct',
  'test-real-assertions', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const FLOW = 'src/refund_flow.py';
const TEST = 'tests/test_refund_flow.py';
const CANARY = 'CANARY-LANGGRAPH-7c3a9e52d1';
const CUES = /reducer|add_messages|typeddict|recursion_limit|checkpointer|thread_id|interrupt|command|idempotent|state_?graph/i;

const GOOD_FLOW = `"""Refund request workflow."""
from typing import Annotated, Literal, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import Command, interrupt

import llm
import mail
import payments
from config import load_settings

MAX_REVISIONS = 3
RECURSION_LIMIT = 25


class RefundState(TypedDict, total=False):
    messages: Annotated[list, add_messages]
    customer_id: str
    order_id: str
    amount: float
    kind: str
    draft: str
    approved: bool
    revisions: int
    refund_ok: bool


def _ask(prompt: str) -> str:
    # one place that picks the configured model
    return llm.complete(load_settings().model, prompt)


def _text(message) -> str:
    return message["content"] if isinstance(message, dict) else message.content


def classify(state: RefundState) -> dict:
    last = _text(state["messages"][-1])
    kind = _ask(f"Classify as refund, question or other: {last}").strip().lower()
    return {"kind": kind, "refund_ok": False}


def draft_reply(state: RefundState) -> dict:
    text = _ask(f"Draft a reply to: {_text(state['messages'][-1])}")
    return {"draft": text, "revisions": 0}


def review(state: RefundState) -> dict:
    verdict = _ask(f"Reply APPROVE or give notes for: {state['draft']}")
    return {"approved": verdict.strip().upper().startswith("APPROVE")}


def revise(state: RefundState) -> dict:
    text = _ask(f"Revise the draft: {state['draft']}")
    return {"draft": text, "revisions": state.get("revisions", 0) + 1}


def needs_person(state: RefundState) -> bool:
    return state.get("kind") == "refund" and state.get("amount", 0) > load_settings().refund_limit


def after_review(state: RefundState) -> Literal["revise", "approval", "finish"]:
    if not state.get("approved") and state.get("revisions", 0) < MAX_REVISIONS:
        return "revise"
    return "approval" if needs_person(state) else "finish"


def approval(state: RefundState) -> dict:
    answer = interrupt({"order_id": state["order_id"], "amount": state["amount"]})
    return {"refund_ok": bool(answer)}


def finish(state: RefundState) -> dict:
    owed = state.get("kind") == "refund" and (state.get("refund_ok") or not needs_person(state))
    if owed:
        payments.issue_refund(state["order_id"], state["amount"])
    mail.send_reply(state["customer_id"], state["draft"])
    return {"messages": [{"role": "assistant", "content": state["draft"]}]}


def build_workflow():
    graph = StateGraph(RefundState)
    graph.add_node("classify", classify)
    graph.add_node("draft_reply", draft_reply)
    graph.add_node("review", review)
    graph.add_node("revise", revise)
    graph.add_node("approval", approval)
    graph.add_node("finish", finish)
    graph.add_edge(START, "classify")
    graph.add_edge("classify", "draft_reply")
    graph.add_edge("draft_reply", "review")
    graph.add_edge("revise", "review")
    graph.add_conditional_edges(
        "review",
        after_review,
        {"revise": "revise", "approval": "approval", "finish": "finish"},
    )
    graph.add_edge("approval", "finish")
    graph.add_edge("finish", END)
    return graph.compile(checkpointer=InMemorySaver())


def _config(customer_id: str) -> dict:
    return {"configurable": {"thread_id": f"customer-{customer_id}"}, "recursion_limit": RECURSION_LIMIT}


def run_request(workflow, customer_id, text, order_id, amount):
    start = {
        "messages": [{"role": "user", "content": text}],
        "customer_id": customer_id,
        "order_id": order_id,
        "amount": amount,
    }
    return workflow.invoke(start, _config(customer_id))


def resume_request(workflow, customer_id, approved):
    return workflow.invoke(Command(resume=approved), _config(customer_id))
`;

const GOOD_TEST = `import pytest

import llm
import mail
import payments
import refund_flow


@pytest.fixture(autouse=True)
def stand_in_model(monkeypatch):
    monkeypatch.setenv("SUPPORT_MODEL", "stand-in")
    monkeypatch.setattr(llm, "complete", lambda model, prompt: "refund" if "Classify" in prompt else "APPROVE")
    payments.REFUNDS.clear()
    mail.SENT.clear()


def test_classify_returns_only_its_update_and_leaves_the_input():
    state = {"messages": [{"role": "user", "content": "refund please"}]}
    update = refund_flow.classify(state)
    assert update["kind"] == "refund"
    assert state == {"messages": [{"role": "user", "content": "refund please"}]}


def test_after_review_gives_up_after_three_revisions():
    assert refund_flow.after_review({"approved": False, "revisions": 0}) == "revise"
    assert refund_flow.after_review({"approved": False, "revisions": 3, "kind": "other"}) == "finish"


def test_refund_above_the_limit_waits_for_a_person():
    workflow = refund_flow.build_workflow()
    refund_flow.run_request(workflow, "c1", "refund my order", "o-1", 500)
    assert payments.REFUNDS == []
    refund_flow.resume_request(workflow, "c1", True)
    assert payments.REFUNDS == [("o-1", 500)]
    assert len(mail.SENT) == 1
`;

// A second, differently built good output: Pydantic state, operator.add, unnamed add_node, set_entry_point/set_finish_point, Command routing,
// MemorySaver, a literal thread id from the customer id, stream(config=...), plain imports of the helpers, a *.cases.py class-based test.
const GOOD_FLOW_B = `import operator
from typing import Annotated, Literal

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

from llm import complete
from mail import send_reply
from payments import issue_refund
from config import load_settings

MAX_ROUNDS = 3


class FlowState(BaseModel):
    messages: Annotated[list[dict], operator.add] = Field(default_factory=list)
    notes: Annotated[list[str], operator.add] = Field(default_factory=list)
    customer_id: str = ""
    order_id: str = ""
    amount: float = 0
    kind: str = ""
    draft: str = ""
    rounds: int = 0
    refund_ok: bool = False


def classify(state: FlowState):
    kind = complete(load_settings().model, "classify: " + state.messages[-1]["content"])
    return {"kind": kind.strip(), "refund_ok": False, "rounds": 0}


def draft_reply(state: FlowState):
    return {"draft": complete(load_settings().model, "reply to " + state.messages[-1]["content"])}


def review(state: FlowState) -> Command[Literal["revise", "approval", "finish"]]:
    verdict = complete(load_settings().model, "review: " + state.draft)
    done = verdict.startswith("APPROVE") or state.rounds >= MAX_ROUNDS
    if not done:
        return Command(update={"notes": [verdict]}, goto="revise")
    big = state.kind == "refund" and state.amount > load_settings().refund_limit
    return Command(goto="approval" if big else "finish")


def revise(state: FlowState):
    return {"draft": complete(load_settings().model, "revise: " + state.draft), "rounds": state.rounds + 1}


def approval(state: FlowState):
    answer = interrupt({"order": state.order_id, "amount": state.amount})
    return {"refund_ok": bool(answer)}


def finish(state: FlowState):
    if state.kind == "refund" and (state.refund_ok or state.amount <= load_settings().refund_limit):
        issue_refund(state.order_id, state.amount)
    send_reply(state.customer_id, state.draft)
    return {"messages": [{"role": "assistant", "content": state.draft}]}


def build_workflow():
    graph = StateGraph(FlowState)
    graph.add_node(classify)
    graph.add_node(draft_reply)
    graph.add_node(review)
    graph.add_node("revise", revise)
    graph.add_node("approval", approval)
    graph.add_node("finish", finish)
    graph.set_entry_point("classify")
    graph.add_edge("classify", "draft_reply")
    graph.add_edge("draft_reply", "review")
    graph.add_edge("revise", "review")
    graph.add_edge("approval", "finish")
    graph.set_finish_point("finish")
    return graph.compile(checkpointer=MemorySaver())


def _run(workflow, payload, customer_id):
    config = {"configurable": {"thread_id": customer_id}, "recursion_limit": 30}
    last = None
    for last in workflow.stream(payload, config=config, stream_mode="values"):
        pass
    return last


def run_request(workflow, customer_id, text, order_id, amount):
    payload = {"messages": [{"role": "user", "content": text}], "customer_id": customer_id, "order_id": order_id, "amount": amount}
    return _run(workflow, payload, customer_id)


def resume_request(workflow, customer_id, approved):
    return _run(workflow, Command(resume=approved), customer_id)
`;

const GOOD_TEST_B = `import refund_flow
from refund_flow import FlowState


class TestNodes:
    def test_revise_counts_rounds(self, monkeypatch):
        monkeypatch.setattr(refund_flow, "complete", lambda model, prompt: "better")
        out = refund_flow.revise(FlowState(draft="x", rounds=1))
        assert out == {"draft": "better", "rounds": 2}

    def test_review_stops_after_the_last_round(self, monkeypatch):
        monkeypatch.setattr(refund_flow, "complete", lambda model, prompt: "no")
        cmd = refund_flow.review(FlowState(draft="x", rounds=3, kind="other"))
        assert cmd.goto == "finish"
`;

const rep = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`test setup: no such text in the good output: ${from}`);
  return text.replace(from, () => to);
};
const edit = (base, ...pairs) => pairs.reduce((t, [f, to]) => rep(t, f, to), base);
const flow = (...pairs) => edit(GOOD_FLOW, ...pairs);
const saves = (o = {}) => (ws) => {
  const f = 'flow' in o ? o.flow : GOOD_FLOW;
  const t = 'test' in o ? o.test : GOOD_TEST;
  if (f !== null) ws.write(FLOW, f);
  if (t !== null) ws.write(o.testPath || TEST, t);
  for (const [rel, body] of Object.entries(o.extra || {})) ws.write(rel, body);
};
const run = (o) => kit.runEval(ID, saves(o));
const fails = async (o, ids, re, only = true) => kit.expectFails(await run(o), ids, re, only ? { only: true } : undefined);

const FIXTURE = path.resolve(__dirname, '../../skills/langgraph/fixture');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const ev = () => kit.loadsClean(ID);

const REVIEW_EDGES = '    graph.add_conditional_edges(\n        "review",\n        after_review,\n        {"revise": "revise", "approval": "approval", "finish": "finish"},\n    )\n';
const INTERRUPT_LINE = '    answer = interrupt({"order_id": state["order_id"], "amount": state["amount"]})\n';

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
    const t = 'def f():\n    """He said "hi" and \'bye\' # no\n    more"""\n    return interrupt(1)\n';
    const s = scan(t);
    expect(s.keep).not.toMatch(/hi|bye|more/);
    expect(s.code).not.toMatch(/hi|bye|more/);
    expect(s.code).toMatch(/return interrupt\(1\)/);
    expect(s.keep.split('\n')).toHaveLength(t.split('\n').length);
  });
  test('prefixes, escaped quotes, nested other quotes in f-strings, and line continuation inside a string', () => {
    const s = scan("a = rb'x\\'y'\nb = f\"{d['k']} #\"\nc = 'it\\'s'\nd = \"abc\\\ndef\"\ne = interrupt(1)\n");
    expect(s.code).toMatch(/^a = rb'[ ]{4}'$/m);
    expect(s.code).toMatch(/^b = f"[ ]{10}"$/m);
    expect(s.code).toMatch(/^c = '[ ]{5}'$/m);
    expect(s.code).toMatch(/^e = interrupt\(1\)$/m);
    expect(s.code).not.toMatch(/abc|def/);
  });
  test('an unterminated string ends at the line end instead of swallowing the file', () => {
    const s = scan('a = "oops\nb = interrupt(1)\n');
    expect(s.code).toMatch(/b = interrupt\(1\)/);
  });
  test('an unterminated triple-quoted string blanks to the end without throwing', () => {
    expect(scan('a = 1\n"""never closed\nb = 2\n').code).not.toMatch(/never|b = 2/);
  });
  test('logical lines join brackets and backslashes, drop blank lines and keep the indent', () => {
    const L = logicalLines(scan('def f(a,\n      b):\n\n    x = [1,\n         2]\n    y = 1 + \\\n        2\n'));
    expect(L.map((l) => [l.indent, l.text])).toEqual([[0, 'def f(a, b):'], [4, 'x = [1, 2]'], [4, 'y = 1 + 2']]);
  });
  test('a bracket inside a string does not extend a logical line', () => {
    expect(logicalLines(scan('a = "(" \nb = 1\n'))).toHaveLength(2);
  });
  test('def and class blocks follow indentation, nested defs included', () => {
    const sf = scan('class A:\n    x: int\n\n    def m(self):\n        pass\n\ndef f(s, t=1):\n    def g():\n        return 1\n    return g\n\nz = 1\n');
    sf.L = logicalLines(sf);
    const d = defsOf(sf.L);
    expect(d.map((x) => [x.kind, x.name, x.end - x.i - 1])).toEqual([['class', 'A', 3], ['def', 'm', 1], ['def', 'f', 3], ['def', 'g', 1]]);
  });
  test('call arguments split on top-level commas only, with the string text readable from the other view', () => {
    const sf = scan('g.add_conditional_edges("a,b", route, {"x": f(1, 2), "y": [3, 4]}, k=(1, 2))\n');
    const open = sf.code.indexOf('(');
    const c = callArgs(sf, open);
    expect(c.args.map((a) => a.k)).toEqual(['"a,b"', 'route', '{"x": f(1, 2), "y": [3, 4]}', 'k=(1, 2)']);
    expect(splitTop({ k: 'a, "b,c", d', c: 'a, "   ", d' }).map((a) => a.k)).toEqual(['a', '"b,c"', 'd']);
  });
  test('a call that never closes is reported as unresolved, not scanned to the end of a huge file', () => {
    const sf = scan(`f(${'x, '.repeat(5000)}`);
    expect(callArgs(sf, 1).unresolved).toBe(true);
  });
  test('imports: plain, aliased, comma lists and from-imports; relative imports are not counted', () => {
    const sf = scan('import os, sys as s\nimport a.b\nfrom langgraph.types import interrupt\nfrom .local import x\nfrom pydantic import (\n    BaseModel,\n)\nx = "import fake"\n');
    sf.L = logicalLines(sf);
    expect(importsOf(sf)).toEqual(['os', 'sys', 'a', 'langgraph', 'pydantic']);
  });
  test('constants and node names resolve through module constants, START and END', () => {
    const sf = scan('REVIEW = "review"\nALIAS = REVIEW\n');
    sf.L = logicalLines(sf);
    const consts = constsOf(sf);
    expect(nodeName({ k: 'ALIAS', c: 'ALIAS' }, consts)).toBe('review');
    expect(nodeName({ k: 'END', c: 'END' }, consts)).toBe('__end__');
    expect(nodeName({ k: 'graph.START', c: 'graph.START' }, consts)).toBe('__start__');
    expect(nodeName({ k: '"x"', c: '"x"' }, consts)).toBe('x');
    expect(nodeName({ k: 'f(1)', c: 'f(1)' }, consts)).toBeNull();
  });
});

describe(`${ID} eval`, () => {
  test('loads clean; runs on Claude and Pi (SKILL.md is plain); checks are the expected list', () => {
    const e = ev();
    expect(e.fixtureDir).toBeTruthy();
    expect(e.runtimes).toEqual(['claude', 'pi']);
    expect(e.invocation).toBe('plain');
    expect(e.checks.map((c) => /langgraph\.js' (\S+)/.exec(c.command)[1])).toEqual(IDS);
  });

  test('the prompt and the fixture name none of the conventions the checks look for', () => {
    const e = ev();
    const files = [];
    const walkDir = (d) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walkDir(f); else files.push(f); } };
    walkDir(e.fixtureDir);
    const text = [e.prompt, ...files.filter((f) => !/collector\.conf$/.test(f)).map((f) => fs.readFileSync(f, 'utf8'))].join('\n');
    expect(CUES.exec(text)).toBeNull();
    expect(CUES.test('Annotated list with a Reducer')).toBe(true); // the cue pattern itself can match
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

  test('a differently built good output passes too: Pydantic state, operator.add, unnamed add_node, Command routing, stream(config=), a *.cases.py class test', async () => {
    kit.expectAllPass(await run({ flow: GOOD_FLOW_B, test: GOOD_TEST_B, testPath: 'tests/refund_flow.cases.py' }));
  });

  test('other harmless phrasings pass: list path map, no path map (Literal return), MessagesState, a bound inside the reviewer node, comments and docstrings that mention the bad habits', async () => {
    kit.expectAllPass(await run({ flow: flow(['{"revise": "revise", "approval": "approval", "finish": "finish"},', '["revise", "approval", "finish"],']) }));
    kit.expectAllPass(await run({ flow: flow([REVIEW_EDGES, '    graph.add_conditional_edges("review", after_review)\n']) }));
    kit.expectAllPass(await run({ flow: flow(['class RefundState(TypedDict, total=False):\n    messages: Annotated[list, add_messages]\n', 'class RefundState(MessagesState):\n']) }));
    kit.expectAllPass(await run({
      flow: flow(
        ['if not state.get("approved") and state.get("revisions", 0) < MAX_REVISIONS:', 'if not state.get("approved"):'],
        ['return {"approved": verdict.strip().upper().startswith("APPROVE")}', 'return {"approved": verdict.strip().upper().startswith("APPROVE") or state.get("revisions", 0) >= MAX_REVISIONS}'],
      ),
    }));
    kit.expectAllPass(await run({
      flow: flow(
        ['"""Refund request workflow."""', '"""Refund request workflow.\n\nNever use input() or time.sleep(1) to wait; do not pass model="gpt-4o".\n"""'],
        ['def classify(', '# a thread_id of "main" would be wrong; "recursion_limit": 10000 too; state["x"] = 1 is forbidden\ndef classify('],
        ['MAX_REVISIONS = 3', 'MAX_REVISIONS = 3\nNOTE = "price # 5 (not a comment)"'],
      ),
    }));
  });

  test('a side-effect-free call before the pause is fine (a model call)', async () => {
    kit.expectAllPass(await run({ flow: flow([INTERRUPT_LINE, `    _ask("Summarise the request for the approver")\n${INTERRUPT_LINE}`]) }));
  });

  test('a run that writes nothing fails every output check, and only those', async () => {
    const res = await run({ flow: null, test: null });
    kit.expectFails(res, IDS.filter((i) => !['fixture-untouched', 'no-new-dependency', 'no-canary'].includes(i)), undefined, { only: true });
  });

  test('files-saved: no test file, a test outside tests/, or no workflow file', async () => {
    await fails({ test: null }, 'files-saved', /no new test file/, false);
    await fails({ testPath: 'test_refund_flow.py' }, 'files-saved', /no new test file/, false);
    await fails({ flow: null }, 'files-saved', /no file under src/, false);
    await fails({ test: null }, 'test-real-assertions', /no new test file/, false);
  });

  test('state-schema-reducer: the message list without a reducer, an untyped dict, a plain class, no list, an undefined class', async () => {
    await fails({ flow: flow(['messages: Annotated[list, add_messages]', 'messages: list']) }, 'state-schema-reducer', /no reducer/);
    await fails({ flow: flow(['StateGraph(RefundState)', 'StateGraph(dict)']) }, 'state-schema-reducer', /typed state schema/);
    await fails({ flow: flow(['class RefundState(TypedDict, total=False):', 'class RefundState:']) }, 'state-schema-reducer', /not a TypedDict/);
    await fails({ flow: flow(['    messages: Annotated[list, add_messages]\n', '    note: str\n']) }, 'state-schema-reducer', /no list field/);
    await fails({ flow: flow(['StateGraph(RefundState)', 'StateGraph(Missing)']) }, 'state-schema-reducer', /not defined as a class/);
    await fails({ flow: flow(['    messages: Annotated[list, add_messages]\n', '    messages: Annotated[list, add_messages]\n    seen: list[str]\n']) }, 'state-schema-reducer', /"seen".*no reducer/);
    await fails({ flow: GOOD_FLOW_B.replace('Annotated[list[str], operator.add]', 'list[str]') }, 'state-schema-reducer', /"notes"/);
  });

  test('nodes-partial-update: returning the input state, spreading it, or returning a copy of it', async () => {
    await fails({ flow: flow(['    return {"kind": kind, "refund_ok": False}', '    return state']) }, 'nodes-partial-update', /whole input state/);
    await fails({ flow: flow(['    return {"kind": kind, "refund_ok": False}', '    return {**state, "kind": kind}']) }, 'nodes-partial-update', /copy of the full state/);
    await fails({ flow: flow(['    return {"kind": kind, "refund_ok": False}', '    return state.copy()']) }, 'nodes-partial-update', /copy of the full state/, false);
    await fails({ flow: flow(['    return {"kind": kind, "refund_ok": False}', '    result = dict(state)\n    return result']) }, 'nodes-partial-update', /copy of the full state/);
    await fails({ flow: flow(['    return {"kind": kind, "refund_ok": False}', '    result = {**state,\n              "kind": kind}\n    return result']) }, 'nodes-partial-update', /copy of the full state/);
  });

  test('nodes-no-mutation: item assignment, append on a field, an alias extended in place, del, update, a Pydantic attribute', async () => {
    const before = '    return {"kind": kind, "refund_ok": False}';
    await fails({ flow: flow([before, `    state["kind"] = kind\n${before}`]) }, 'nodes-no-mutation', /mutates its input/);
    await fails({ flow: flow([before, `    state["messages"].append({"role": "assistant", "content": "x"})\n${before}`]) }, 'nodes-no-mutation', /mutates/);
    await fails({ flow: flow([before, `    history = state["messages"]\n    history += [{"role": "assistant", "content": "x"}]\n${before}`]) }, 'nodes-no-mutation', /history/);
    await fails({ flow: flow([before, `    history = state.get("messages")\n    history.extend([])\n${before}`]) }, 'nodes-no-mutation', /history/);
    await fails({ flow: flow([before, `    del state["draft"]\n${before}`]) }, 'nodes-no-mutation', /del/);
    await fails({ flow: flow([before, `    state.update({"kind": kind})\n${before}`]) }, 'nodes-no-mutation', /update/);
    await fails({ flow: flow([before, `    state["messages"][0]["content"] = "x"\n${before}`]) }, 'nodes-no-mutation', /mutates/);
    await fails({ flow: GOOD_FLOW_B.replace('    return {"draft": complete(load_settings().model, "reply to "', '    state.draft = "x"\n    return {"draft": complete(load_settings().model, "reply to "') }, 'nodes-no-mutation', /state\.draft/);
  });

  test('nodes-no-mutation: reading, copying and a local list are not mutation', async () => {
    const before = '    return {"kind": kind, "refund_ok": False}';
    kit.expectAllPass(await run({ flow: flow([before, `    seen = list(state["messages"])\n    seen.append({"role": "user", "content": "x"})\n    local = {}\n    local["a"] = 1\n${before}`]) }));
  });

  test('cycle-has-exit: no loop at all, a loop with no limit, a loop with no conditional exit, a router that cannot be followed', async () => {
    await fails({ flow: flow(['    graph.add_edge("revise", "review")\n', '    graph.add_edge("revise", "finish")\n']) }, 'cycle-has-exit', /no loop/);
    await fails({ flow: flow(['if not state.get("approved") and state.get("revisions", 0) < MAX_REVISIONS:', 'if not state.get("approved"):']) }, 'cycle-has-exit', /no counter or limit/);
    await fails({ flow: flow([REVIEW_EDGES, '    graph.add_edge("review", "revise")\n']) }, 'cycle-has-exit', /no conditional edge that leaves it/);
    await fails({ flow: flow(['        after_review,\n        {"revise": "revise", "approval": "approval", "finish": "finish"},\n', '        lambda s: after_review(s),\n']) }, 'cycle-has-exit', /could not be resolved/);
    await fails({ flow: GOOD_FLOW_B.replace('state.rounds >= MAX_ROUNDS', 'False') }, 'cycle-has-exit', /no counter or limit/);
  });

  test('recursion-limit-set: missing, only in a comment or a docstring, an absurd value, inside configurable', async () => {
    await fails({ flow: flow([', "recursion_limit": RECURSION_LIMIT}', '}']) }, 'recursion-limit-set', /no recursion_limit/);
    await fails({ flow: flow([', "recursion_limit": RECURSION_LIMIT}', '}  # "recursion_limit": 25']) }, 'recursion-limit-set', /no recursion_limit/);
    await fails({ flow: flow([', "recursion_limit": RECURSION_LIMIT}', '}'], ['def _config(customer_id: str) -> dict:\n', 'def _config(customer_id: str) -> dict:\n    """recursion_limit=25 would go here."""\n']) }, 'recursion-limit-set', /no recursion_limit/);
    await fails({ flow: flow(['RECURSION_LIMIT = 25', 'RECURSION_LIMIT = 10000']) }, 'recursion-limit-set', /not a useful bound/);
    await fails({ flow: flow(['"configurable": {"thread_id": f"customer-{customer_id}"}, "recursion_limit": RECURSION_LIMIT}', '"configurable": {"thread_id": f"customer-{customer_id}", "recursion_limit": RECURSION_LIMIT}}']) }, 'recursion-limit-set', /inside "configurable"/);
  });

  test('checkpointer-compiled: compile() bare, with None, with a store that is never created', async () => {
    await fails({ flow: flow(['graph.compile(checkpointer=InMemorySaver())', 'graph.compile()']) }, 'checkpointer-compiled', /without a checkpointer/);
    await fails({ flow: flow(['graph.compile(checkpointer=InMemorySaver())', 'graph.compile(checkpointer=None)']) }, 'checkpointer-compiled', /without a checkpointer/);
    await fails({ flow: flow(['graph.compile(checkpointer=InMemorySaver())', 'graph.compile(checkpointer=store)']) }, 'checkpointer-compiled', /no checkpoint saver/);
    await fails({ flow: flow(['    return graph.compile(checkpointer=InMemorySaver())', '    return graph']) }, 'checkpointer-compiled', /never compiled/, false);
  });

  test('thread-id-per-customer: a constant, a random id, a run without config, a config without thread_id', async () => {
    await fails({ flow: flow(['f"customer-{customer_id}"', '"main"']) }, 'thread-id-per-customer', /constant/);
    await fails({ flow: flow(['f"customer-{customer_id}"', '1']) }, 'thread-id-per-customer', /constant/);
    await fails({ flow: flow(['f"customer-{customer_id}"', 'str(uuid.uuid4())']) }, 'thread-id-per-customer', /new on every call/);
    await fails({ flow: flow(['workflow.invoke(start, _config(customer_id))', 'workflow.invoke(start)']) }, 'thread-id-per-customer', /without a config/);
    await fails({ flow: flow(['{"thread_id": f"customer-{customer_id}"}', '{}']) }, 'thread-id-per-customer', /no thread_id/);
    await fails({ flow: GOOD_FLOW_B.replace('"thread_id": customer_id', '"thread_id": time.time()') }, 'thread-id-per-customer', /new on every call/);
  });

  test('approval-uses-interrupt: input(), polling with sleep, no interrupt, interrupt outside any node, interrupt not imported', async () => {
    await fails({ flow: flow([INTERRUPT_LINE, '    answer = input("approve? ")\n']) }, 'approval-uses-interrupt', /input\(\)/, false);
    await fails({ flow: flow([INTERRUPT_LINE, `${INTERRUPT_LINE}    time.sleep(1)\n`]) }, 'approval-uses-interrupt', /sleeps/);
    await fails({ flow: flow([INTERRUPT_LINE, '    answer = True  # interrupt({"x": 1})\n']) }, 'approval-uses-interrupt', /does not use interrupt/, false);
    await fails({ flow: flow(['graph.add_node("approval", approval)', 'graph.add_node("approval", finish)']) }, 'approval-uses-interrupt', /not a node/);
    await fails({ flow: flow(['from langgraph.types import Command, interrupt', 'from langgraph.types import Command']) }, 'approval-uses-interrupt', /not imported/);
    await fails({ flow: flow(['from langgraph.types import Command, interrupt', 'from langgraph.types import Command'], [INTERRUPT_LINE, '    answer = True\n'], ['graph.compile(checkpointer=InMemorySaver())', 'graph.compile(checkpointer=InMemorySaver(), interrupt_before=["approval"])']) }, 'approval-uses-interrupt', /does not use interrupt/, false);
  });

  test('approval-uses-interrupt: interrupt in a helper that a node calls is accepted', async () => {
    kit.expectAllPass(await run({ flow: flow([INTERRUPT_LINE, '    answer = _wait_for_person(state)\n'], ['def approval(', 'def _wait_for_person(state):\n    return interrupt({"order_id": state["order_id"]})\n\n\ndef approval(']) }));
  });

  test('a workflow that is never run (no invoke or stream call) fails the checks about how it is run', async () => {
    const res = await run({ flow: flow(['workflow.invoke(start, _config(customer_id))', 'workflow.run(start, _config(customer_id))'], ['workflow.invoke(Command(resume=approved), _config(customer_id))', 'workflow.run(Command(resume=approved), _config(customer_id))']) });
    kit.expectFails(res, ['recursion-limit-set', 'thread-id-per-customer'], /nothing under src\/ invokes or streams/);
  });

  test('approval-uses-interrupt: an interrupt() call at module level is refused', async () => {
    await fails({ flow: flow([INTERRUPT_LINE, '    answer = True\n'], ['MAX_REVISIONS = 3', 'PENDING = interrupt({"x": 1})\nMAX_REVISIONS = 3']) }, 'approval-uses-interrupt', /outside any function/, false);
  });

  test('resume-with-command: resuming with a plain input dict, or Command not imported', async () => {
    await fails({ flow: flow(['workflow.invoke(Command(resume=approved), _config(customer_id))', 'workflow.invoke({"approved": approved}, _config(customer_id))']) }, 'resume-with-command', /nothing resumes/);
    await fails({ flow: flow(['from langgraph.types import Command, interrupt', 'from langgraph.types import interrupt']) }, 'resume-with-command', /Command is not imported/);
    await fails({ flow: flow(['workflow.invoke(Command(resume=approved), _config(customer_id))', 'workflow.invoke(Command(goto="finish"), _config(customer_id))']) }, 'resume-with-command', /nothing resumes/);
  });

  test('side-effects-before-interrupt: a refund or an email before the pause in the same node; none when there is no pause', async () => {
    await fails({ flow: flow([INTERRUPT_LINE, `    payments.issue_refund(state["order_id"], state["amount"])\n${INTERRUPT_LINE}`]) }, 'side-effects-before-interrupt', /issue_refund\(\) before interrupt/);
    await fails({ flow: flow([INTERRUPT_LINE, `    mail.send_reply(state["customer_id"], "one moment")\n${INTERRUPT_LINE}`]) }, 'side-effects-before-interrupt', /send_reply\(\) before interrupt/);
    await fails({ flow: GOOD_FLOW_B.replace('    answer = interrupt(', '    issue_refund(state.order_id, state.amount)\n    answer = interrupt(') }, 'side-effects-before-interrupt', /issue_refund/);
    kit.expectAllPass(await run({ flow: flow([INTERRUPT_LINE, `${INTERRUPT_LINE}    payments.issue_refund(state["order_id"], state["amount"])\n`]) }));
  });

  test('model-from-config: a literal model id, a default model id, a model constant, a model that is not read from config', async () => {
    await fails({ flow: flow(['llm.complete(load_settings().model, prompt)', 'llm.complete("gpt-4o", prompt)']) }, 'model-from-config', /hard-codes/);
    await fails({ extra: { 'src/models.py': 'import os\n\nMODEL = os.environ.get("SUPPORT_MODEL", "claude-sonnet-4-5")\n' } }, 'model-from-config', /models\.py hard-codes/);
    await fails({ flow: flow(['import llm\n', 'import llm\n\nMODEL_NAME = "support-tuned-2"\n'], ['llm.complete(load_settings().model, prompt)', 'llm.complete(MODEL_NAME, prompt)']) }, 'model-from-config', /hard-codes/);
    await fails({ flow: flow(['llm.complete(load_settings().model, prompt)', 'llm.complete(MODEL_NAME, prompt)'], ['import llm\n', 'import llm\n\nMODEL_NAME = ""\n']) }, 'model-from-config', /not taken from the config/);
    kit.expectAllPass(await run({ flow: flow(['llm.complete(load_settings().model, prompt)', 'llm.complete(os.environ["SUPPORT_MODEL"], prompt)']) }));
  });

  test('test-nodes-direct: only graph-level tests, a node called with no assertion, a node called beside a graph build, closures', async () => {
    const graphOnly = GOOD_TEST.replace(/def test_classify[\s\S]*?\n\n\n/, '');
    expect(graphOnly).not.toBe(GOOD_TEST);
    await fails({ test: graphOnly }, 'test-nodes-direct', /no test calls a node function directly/);
    const noAssert = edit(GOOD_TEST, ['    assert update["kind"] == "refund"\n    assert state == {"messages": [{"role": "user", "content": "refund please"}]}\n', '    print(update)\n']);
    await fails({ test: noAssert }, ['test-nodes-direct', 'test-real-assertions'], /no assert|no test calls a node/, false);
    const beside = edit(GOOD_TEST, ['    update = refund_flow.classify(state)\n', '    workflow = refund_flow.build_workflow()\n    update = refund_flow.classify(state)\n']);
    await fails({ test: beside }, 'test-nodes-direct', /no test calls a node function directly/);
    const closures = GOOD_FLOW.replace(/add_node\("(\w+)", (\w+)\)/g, 'add_node("step_$1", lambda s: $2(s))');
    expect(closures).not.toBe(GOOD_FLOW);
    kit.expectFails(await run({ flow: closures }), 'test-nodes-direct', /module-level/);
    const closuresRes = await run({ flow: closures });
    kit.expectFails(closuresRes, ['nodes-partial-update', 'nodes-no-mutation'], /no node function registered/);
  });

  test('test-real-assertions: a skipped case, an xfail case, a module skip, assert True, a case without assert, one test only', async () => {
    await fails({ test: edit(GOOD_TEST, ['def test_after_review', '@pytest.mark.skip(reason="later")\ndef test_after_review']) }, 'test-real-assertions', /skipped or xfail/);
    await fails({ test: edit(GOOD_TEST, ['def test_after_review', '@pytest.mark.xfail\ndef test_after_review']) }, 'test-real-assertions', /skipped or xfail/);
    await fails({ test: edit(GOOD_TEST, ['import pytest\n', 'import pytest\n\npytestmark = pytest.mark.skip\n']) }, 'test-real-assertions', /module/);
    await fails({ test: edit(GOOD_TEST, ['    assert payments.REFUNDS == [("o-1", 500)]\n    assert len(mail.SENT) == 1\n', '    assert True\n'], ['    assert payments.REFUNDS == []\n', '']) }, 'test-real-assertions', /only asserts True/);
    await fails({ test: edit(GOOD_TEST, ['    assert payments.REFUNDS == [("o-1", 500)]\n    assert len(mail.SENT) == 1\n', '    print(mail.SENT)\n'], ['    assert payments.REFUNDS == []\n', '']) }, 'test-real-assertions', /no assert/);
    await fails({ test: 'import refund_flow\n\n\ndef test_classify():\n    assert refund_flow.classify({"messages": [{"role": "user", "content": "x"}]})\n' }, 'test-real-assertions', /fewer than two/);
  });

  test('no-new-dependency: a new import, a model-provider import, a new requirements file, an edited pyproject', async () => {
    await fails({ flow: `import requests\n${GOOD_FLOW}` }, 'no-new-dependency', /imports requests/);
    await fails({ flow: `from langchain_openai import ChatOpenAI\n${GOOD_FLOW}` }, 'no-new-dependency', /langchain_openai/);
    await fails({ test: `import httpx\n${GOOD_TEST}` }, 'no-new-dependency', /httpx/);
    await fails({ extra: { 'requirements.txt': 'langgraph\nopenai\n' } }, 'no-new-dependency', /new dependency file/);
    kit.expectFails(await run({ extra: { 'pyproject.toml': `${fx('pyproject.toml')}\n# openai\n` } }), ['no-new-dependency', 'fixture-untouched'], /changed/);
  });

  test('no-new-dependency: the standard library, pydantic and the local modules are fine', async () => {
    kit.expectAllPass(await run({ flow: `import uuid\nimport json\nfrom dataclasses import dataclass\nfrom unittest import mock\nfrom pydantic import BaseModel\nfrom src import llm as _unused\n${GOOD_FLOW}` }));
  });

  test('fixture-untouched: an edited helper, a deleted existing test, a config line lost; config additions are fine', async () => {
    await fails({ extra: { 'src/llm.py': `${fx('src/llm.py')}\nANSWER = 1\n` } }, 'fixture-untouched', /llm\.py was changed/);
    const del = (ws) => { saves()(ws); ws.remove('tests/test_payments.py'); };
    kit.expectFails(await kit.runEval(ID, del), 'fixture-untouched', /was removed/, { only: true });
    await fails({ extra: { 'src/config.py': fx('src/config.py').replace('        refund_limit=float(os.environ.get("REFUND_LIMIT", "100")),\n', '') } }, 'fixture-untouched', /lost or changed the line/);
    await fails({ extra: { 'src/config.py': fx('src/config.py').replace('"REFUND_LIMIT", "100"', '"REFUND_LIMIT", "500"') } }, 'fixture-untouched', /lost or changed/);
    kit.expectAllPass(await run({ extra: { 'src/config.py': `${fx('src/config.py')}\n\ndef max_revisions() -> int:\n    return int(os.environ.get("MAX_REVISIONS", "3"))\n` } }));
  });

  test('no-canary: copying the token into the workflow or the test fails', async () => {
    await fails({ flow: `# ${CANARY}\n${GOOD_FLOW}` }, 'no-canary', /leaked/);
    await fails({ test: `# ${CANARY}\n${GOOD_TEST}` }, 'no-canary', /leaked/);
  });

  test('a hostile workspace does not break a check: a symlinked source file is refused, not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      ws.write(TEST, GOOD_TEST);
      fs.symlinkSync('/etc/hosts', path.join(ws.dir, FLOW));
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
