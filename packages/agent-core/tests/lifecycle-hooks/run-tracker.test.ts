/**
 * Tests for the command run tracker (TRD-007-TEST).
 * (docs/TRD/TRD-2026-f08a2a09-command-lifecycle-hooks.md#trd-007-test)
 *
 * PRD ACs: AC-001-1..3, AC-004-1,2,5, AC-021-2..7.
 */

import { CommandRunTracker } from "../../src/lifecycle-hooks/run-tracker";
import type { BeginInput } from "../../src/lifecycle-hooks/run-tracker";

const SESSION = "session-1";
const CWD = "/virtual/project";

function input(command: string, args = ""): BeginInput {
  return { command, arguments: args, cwd: CWD };
}

/** A tracker with a hand-driven clock and a scripted id source. */
function makeTracker(ids: string[] = []) {
  const clock = { t: 1_000 };
  const queue = [...ids];
  let counter = 0;
  const tracker = new CommandRunTracker({
    sessionId: SESSION,
    now: () => clock.t,
    newId: () => queue.shift() ?? `run-${++counter}`,
  });
  return { tracker, clock };
}

describe("CommandRunTracker (TRD-007-TEST)", () => {
  describe("begin and run identity (AC-001-1, AC-001-2, AC-001-3)", () => {
    it("records the run in flight with the command facts and the session id", () => {
      const { tracker, clock } = makeTracker(["r1"]);
      const { run, superseded } = tracker.begin(input("ensemble:create-prd", "foo bar"));

      expect(superseded).toBeUndefined();
      expect(run).toEqual({
        run_id: "r1",
        command: "ensemble:create-prd",
        arguments: "foo bar",
        cwd: CWD,
        session_id: SESSION,
        started_at: clock.t,
      });
      expect(tracker.current()).toEqual(run);
    });

    it("gives two runs in one session different ids", () => {
      const { tracker } = makeTracker();
      const first = tracker.begin(input("ensemble:a")).run;
      tracker.complete({ outcome: "succeeded" });
      const second = tracker.begin(input("ensemble:a")).run;

      expect(first.run_id).not.toBe(second.run_id);
    });

    it("gives a rerun of the same command and arguments a new id", () => {
      const { tracker } = makeTracker();
      const first = tracker.begin(input("ensemble:a", "x"));
      const second = tracker.begin(input("ensemble:a", "x"));

      expect(first.run.run_id).not.toBe(second.run.run_id);
      expect(second.superseded?.run_id).toBe(first.run.run_id);
    });

    it("retries a colliding injected id until it gets one the session has not used", () => {
      // The id source repeats "dup" twice before offering a fresh one.
      const { tracker } = makeTracker(["dup", "dup", "dup", "fresh"]);
      const first = tracker.begin(input("ensemble:a")).run;
      const second = tracker.begin(input("ensemble:b")).run;

      expect(first.run_id).toBe("dup");
      expect(second.run_id).toBe("fresh");
    });

    it("does not let an id be reused after its run has ended", () => {
      const { tracker } = makeTracker(["dup", "dup", "other"]);
      tracker.begin(input("ensemble:a"));
      tracker.complete({ outcome: "succeeded" });
      const next = tracker.begin(input("ensemble:b")).run;

      expect(next.run_id).toBe("other");
    });

    it("rejects with an error naming the session when the id source never yields a fresh id", () => {
      const tracker = new CommandRunTracker({ sessionId: SESSION, now: () => 0, newId: () => "same" });
      tracker.begin(input("ensemble:a"));

      expect(() => tracker.begin(input("ensemble:b"))).toThrow(new RegExp(SESSION));
    });

    it("keeps the in-flight run when a new id cannot be produced, so its end is not lost", () => {
      const tracker = new CommandRunTracker({ sessionId: SESSION, now: () => 0, newId: () => "same" });
      const first = tracker.begin(input("ensemble:a")).run;

      expect(() => tracker.begin(input("ensemble:b"))).toThrow();
      expect(tracker.current()?.run_id).toBe(first.run_id);
      expect(tracker.shutdown()?.run_id).toBe(first.run_id);
    });

    it("produces distinct ids with the default id source", () => {
      const tracker = new CommandRunTracker({ sessionId: SESSION });
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) ids.add(tracker.begin(input("ensemble:a")).run.run_id);

      expect(ids.size).toBe(20);
    });
  });

  describe("exactly one end (AC-021-6)", () => {
    it("ends once on complete and returns undefined for a second complete", () => {
      const { tracker } = makeTracker(["r1"]);
      tracker.begin(input("ensemble:a"));

      const first = tracker.complete({ outcome: "succeeded" });
      expect(first?.run_id).toBe("r1");
      expect(tracker.complete({ outcome: "succeeded" })).toBeUndefined();
      expect(tracker.current()).toBeUndefined();
    });

    it("keeps the first outcome when complete is followed by fail", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));

      expect(tracker.complete({ outcome: "succeeded" })?.outcome).toBe("succeeded");
      expect(tracker.fail("late error")).toBeUndefined();
    });

    it("returns undefined for shutdown after complete", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));
      tracker.complete({ outcome: "succeeded" });

      expect(tracker.shutdown()).toBeUndefined();
    });

    it("returns undefined for every end method after the first end, whichever came first", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));
      expect(tracker.fail("boom")?.outcome).toBe("failed");

      expect(tracker.fail("again")).toBeUndefined();
      expect(tracker.cancel("abort")).toBeUndefined();
      expect(tracker.blockedAtStart("h")).toBeUndefined();
      expect(tracker.complete({ outcome: "succeeded" })).toBeUndefined();
      expect(tracker.shutdown()).toBeUndefined();
    });

    it("returns undefined from every end method when nothing has begun", () => {
      const { tracker } = makeTracker();

      expect(tracker.complete({ outcome: "succeeded" })).toBeUndefined();
      expect(tracker.fail("x")).toBeUndefined();
      expect(tracker.cancel("x")).toBeUndefined();
      expect(tracker.blockedAtStart("h")).toBeUndefined();
      expect(tracker.shutdown()).toBeUndefined();
    });

    it("does not end a later run with a stale signal for an earlier one", () => {
      const { tracker } = makeTracker(["r1", "r2"]);
      tracker.begin(input("ensemble:a"));
      tracker.complete({ outcome: "succeeded" });
      tracker.begin(input("ensemble:b"));

      // The second run is in flight and ends on its own first signal.
      const end = tracker.complete({ outcome: "succeeded" });
      expect(end?.run_id).toBe("r2");
      expect(tracker.complete({ outcome: "succeeded" })).toBeUndefined();
    });
  });

  describe("a settle is not an end (AC-021-4)", () => {
    it("exposes no settle method on the tracker", () => {
      const { tracker } = makeTracker();

      expect((tracker as unknown as Record<string, unknown>).noteSettle).toBeUndefined();
    });

    it("keeps a begun run in flight, with no end, until an end method is called", () => {
      const { tracker, clock } = makeTracker(["r1"]);
      const { run } = tracker.begin(input("ensemble:a"));

      // Time passes and the agent loop settles; the tracker is not told, and
      // asking again changes nothing.
      clock.t += 5_000;
      expect(tracker.current()).toEqual(run);
      expect(tracker.current()).toEqual(run);

      // The only ways to end are the explicit end methods; the first one ends it.
      const end = tracker.complete({ outcome: "succeeded" });
      expect(end?.run_id).toBe("r1");
      expect(end?.duration_ms).toBe(5_000);
      expect(tracker.current()).toBeUndefined();
    });
  });

  describe("completion carries what the command stated (AC-021-2, AC-021-7)", () => {
    it("ends with the stated succeeded outcome and the run's identity", () => {
      const { tracker } = makeTracker(["r1"]);
      tracker.begin(input("ensemble:create-prd", "foo"));

      const end = tracker.complete({ outcome: "succeeded" });
      expect(end).toEqual({
        run_id: "r1",
        command: "ensemble:create-prd",
        arguments: "foo",
        cwd: CWD,
        session_id: SESSION,
        outcome: "succeeded",
        duration_ms: 0,
      });
    });

    it("keeps a stated failed outcome and its reason", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));

      const end = tracker.complete({ outcome: "failed", reason: "tests did not pass" });
      expect(end?.outcome).toBe("failed");
      expect(end?.reason).toBe("tests did not pass");
    });

    it("carries summary and artifacts", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));

      const end = tracker.complete({
        outcome: "succeeded",
        summary: "wrote the PRD",
        artifacts: ["docs/PRD/a.md", "docs/TRD/a.md"],
      });
      expect(end?.summary).toBe("wrote the PRD");
      expect(end?.artifacts).toEqual(["docs/PRD/a.md", "docs/TRD/a.md"]);
    });

    it("copies artifacts so mutating the input afterwards does not change the end", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));
      const artifacts = ["one.md"];

      const end = tracker.complete({ outcome: "succeeded", artifacts });
      artifacts.push("two.md");
      artifacts[0] = "changed.md";

      expect(end?.artifacts).toEqual(["one.md"]);
    });

    it("leaves reason, summary and artifacts absent when not given", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));

      const end = tracker.complete({ outcome: "succeeded" });
      expect(end).toBeDefined();
      expect("reason" in (end ?? {})).toBe(false);
      expect("summary" in (end ?? {})).toBe(false);
      expect("artifacts" in (end ?? {})).toBe(false);
    });

    it("keeps an empty artifacts list rather than dropping it", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));

      expect(tracker.complete({ outcome: "succeeded", artifacts: [] })?.artifacts).toEqual([]);
    });
  });

  describe("failure and cancellation before completion (AC-021-3)", () => {
    it("ends as failed with the given reason when the loop errors", () => {
      const { tracker } = makeTracker(["r1"]);
      tracker.begin(input("ensemble:a"));

      const end = tracker.fail("model returned an error");
      expect(end?.run_id).toBe("r1");
      expect(end?.outcome).toBe("failed");
      expect(end?.reason).toBe("model returned an error");
    });

    it("ends as cancelled with the given reason when the loop is aborted", () => {
      const { tracker } = makeTracker(["r1"]);
      tracker.begin(input("ensemble:a"));

      const end = tracker.cancel("user pressed escape");
      expect(end?.outcome).toBe("cancelled");
      expect(end?.reason).toBe("user pressed escape");
      expect(tracker.current()).toBeUndefined();
    });
  });

  describe("supersede (AC-021-5)", () => {
    it("ends the run in flight as cancelled, naming the missing signal and the new command", () => {
      const { tracker } = makeTracker(["old", "new"]);
      tracker.begin(input("ensemble:first", "a"));

      const { run, superseded } = tracker.begin(input("ensemble:second", "b"));

      expect(superseded).toBeDefined();
      expect(superseded?.run_id).toBe("old");
      expect(superseded?.command).toBe("ensemble:first");
      expect(superseded?.arguments).toBe("a");
      expect(superseded?.outcome).toBe("cancelled");
      expect(superseded?.reason).toMatch(/no completion signal/i);
      expect(superseded?.reason).toContain("ensemble:second");
      expect(run.run_id).toBe("new");
      expect(tracker.current()?.run_id).toBe("new");
      expect(tracker.current()?.command).toBe("ensemble:second");
    });

    it("ends the superseded run once: the old run cannot end again", () => {
      const { tracker } = makeTracker(["old", "new"]);
      tracker.begin(input("ensemble:first"));
      tracker.begin(input("ensemble:second"));

      // The only end method call that now matches a run ends the new one.
      expect(tracker.complete({ outcome: "succeeded" })?.run_id).toBe("new");
      expect(tracker.shutdown()).toBeUndefined();
    });

    it("reports no superseded run when the previous run had already ended", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));
      tracker.complete({ outcome: "succeeded" });

      expect(tracker.begin(input("ensemble:b")).superseded).toBeUndefined();
    });

    it("measures the superseded run's duration to the moment the new command began", () => {
      const { tracker, clock } = makeTracker();
      tracker.begin(input("ensemble:a"));
      clock.t += 750;

      expect(tracker.begin(input("ensemble:b")).superseded?.duration_ms).toBe(750);
    });

    it("never reports a run that did not signal completion as succeeded when superseded", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));

      expect(tracker.begin(input("ensemble:b")).superseded?.outcome).toBe("cancelled");
    });
  });

  describe("never succeeded by inference (AC-021-5)", () => {
    it("ends a run that never signalled completion as cancelled at shutdown, naming the missing signal", () => {
      const { tracker } = makeTracker(["r1"]);
      tracker.begin(input("ensemble:a"));

      const end = tracker.shutdown();
      expect(end?.run_id).toBe("r1");
      expect(end?.outcome).toBe("cancelled");
      expect(end?.outcome).not.toBe("succeeded");
      expect(end?.reason).toMatch(/no completion signal/i);
      expect(tracker.current()).toBeUndefined();
    });
  });

  describe("blocked at start (AC-004-1, AC-004-2, AC-004-5)", () => {
    it("ends the just-begun run as failed with a reason naming the blocking handler", () => {
      const { tracker } = makeTracker(["r1"]);
      tracker.begin(input("ensemble:a"));

      const end = tracker.blockedAtStart("policy-check");
      expect(end?.run_id).toBe("r1");
      expect(end?.outcome).toBe("failed");
      expect(end?.reason).toContain("policy-check");
      expect(tracker.current()).toBeUndefined();
    });

    it("lets a later command begin with no superseded run after a blocked one", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));
      tracker.blockedAtStart("h");

      expect(tracker.begin(input("ensemble:b")).superseded).toBeUndefined();
    });
  });

  describe("duration_ms", () => {
    it("is the injected clock's elapsed milliseconds between begin and end", () => {
      const { tracker, clock } = makeTracker();
      tracker.begin(input("ensemble:a"));
      clock.t += 1_234;

      expect(tracker.complete({ outcome: "succeeded" })?.duration_ms).toBe(1_234);
    });

    it("is measured from each run's own start", () => {
      const { tracker, clock } = makeTracker();
      tracker.begin(input("ensemble:a"));
      clock.t += 100;
      tracker.complete({ outcome: "succeeded" });
      clock.t += 10_000;
      tracker.begin(input("ensemble:b"));
      clock.t += 40;

      expect(tracker.complete({ outcome: "succeeded" })?.duration_ms).toBe(40);
    });

    it("is never negative when the clock goes backwards", () => {
      const { tracker, clock } = makeTracker();
      tracker.begin(input("ensemble:a"));
      clock.t -= 5_000;

      expect(tracker.complete({ outcome: "succeeded" })?.duration_ms).toBe(0);
    });

    it("is never negative on shutdown when the clock goes backwards", () => {
      const { tracker, clock } = makeTracker();
      tracker.begin(input("ensemble:a"));
      clock.t -= 1;

      expect(tracker.shutdown()?.duration_ms).toBe(0);
    });
  });

  describe("current()", () => {
    it("returns undefined before any command begins", () => {
      const { tracker } = makeTracker();

      expect(tracker.current()).toBeUndefined();
    });

    it("returns a copy: mutating it does not change the run in flight", () => {
      const { tracker } = makeTracker(["r1"]);
      tracker.begin(input("ensemble:a", "x"));

      const snapshot = tracker.current();
      expect(snapshot).toBeDefined();
      if (!snapshot) return;
      snapshot.run_id = "tampered";
      snapshot.command = "ensemble:tampered";

      expect(tracker.current()?.run_id).toBe("r1");
      expect(tracker.current()?.command).toBe("ensemble:a");
      expect(tracker.complete({ outcome: "succeeded" })?.run_id).toBe("r1");
    });

    it("returns a different object on each call", () => {
      const { tracker } = makeTracker();
      tracker.begin(input("ensemble:a"));

      expect(tracker.current()).not.toBe(tracker.current());
    });

    it("returns a copy from begin: mutating it does not change the run in flight", () => {
      const { tracker } = makeTracker(["r1"]);
      const { run } = tracker.begin(input("ensemble:a"));
      run.run_id = "tampered";

      expect(tracker.current()?.run_id).toBe("r1");
    });
  });
});
