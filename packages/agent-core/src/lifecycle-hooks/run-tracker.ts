/**
 * Command run tracker (TRD-007). Pure state: no I/O, no host types.
 *
 * One tracker lives per session and follows at most one in-flight run, a
 * command that has begun and not yet ended. Every run ends exactly once:
 * the first end signal wins and later ones return `undefined`. A run that
 * never signalled completion is never reported as `succeeded`; it ends as
 * `cancelled` when the next command begins or the session shuts down
 * (AC-021-5). A settled agent loop is not an end (AC-021-4).
 */

import { randomUUID } from "node:crypto";
import type { CommandOutcome } from "./types";

/** Longest run of colliding ids from `newId` tolerated before giving up. */
const MAX_ID_ATTEMPTS = 8;

export interface RunTrackerOptions {
  sessionId: string;
  /** Millisecond clock; injected so tests are deterministic. */
  now?: () => number;
  /** Run id source; injected so tests are deterministic. */
  newId?: () => string;
}

export interface BeginInput {
  command: string;
  arguments: string;
  cwd: string;
}

/** A run that has begun and not ended. */
export interface ActiveRun {
  run_id: string;
  command: string;
  arguments: string;
  cwd: string;
  session_id: string;
  /** Clock reading when the run began, in the injected clock's milliseconds. */
  started_at: number;
}

export interface CompletionInput {
  /** What the command stated; `cancelled` is never stated, only observed. */
  outcome: Extract<CommandOutcome, "succeeded" | "failed">;
  reason?: string;
  summary?: string;
  artifacts?: string[];
}

/** The single end of a run. */
export interface EndResult {
  run_id: string;
  command: string;
  arguments: string;
  cwd: string;
  session_id: string;
  outcome: CommandOutcome;
  duration_ms: number;
  reason?: string;
  summary?: string;
  artifacts?: string[];
}

export interface BeginResult {
  run: ActiveRun;
  /** The previous run, ended as `cancelled` because this command began first. */
  superseded?: EndResult;
}

export class CommandRunTracker {
  private readonly sessionId: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly usedIds = new Set<string>();
  private active: ActiveRun | undefined;

  constructor(options: RunTrackerOptions) {
    this.sessionId = options.sessionId;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? randomUUID;
  }

  /**
   * Begin a run. A run still in flight is ended first as `cancelled`, naming
   * the missing completion signal, and returned as `superseded` so the caller
   * can run its end handlers. The new id is produced before the old run ends,
   * so an id source that cannot produce a unique id throws with the old run
   * still in flight rather than losing its end.
   */
  begin(input: BeginInput): BeginResult {
    const runId = this.uniqueId();
    const superseded = this.end("cancelled", {
      reason: `No completion signal was received before the next command (${input.command}) began; the previous run was superseded.`,
    });
    const run: ActiveRun = {
      run_id: runId,
      command: input.command,
      arguments: input.arguments,
      cwd: input.cwd,
      session_id: this.sessionId,
      started_at: this.now(),
    };
    this.active = run;
    return superseded ? { run: { ...run }, superseded } : { run: { ...run } };
  }

  /** The command signalled completion (AC-021-2, AC-021-7). */
  complete(input: CompletionInput): EndResult | undefined {
    return this.end(input.outcome, {
      reason: input.reason,
      summary: input.summary,
      artifacts: input.artifacts,
    });
  }

  /** The agent loop ended in an error before completion (AC-021-3). */
  fail(reason: string): EndResult | undefined {
    return this.end("failed", { reason });
  }

  /** The agent loop was aborted before completion (AC-021-3). */
  cancel(reason: string): EndResult | undefined {
    return this.end("cancelled", { reason });
  }

  /** A start handler blocked the just-begun run (AC-004-5). */
  blockedAtStart(handlerName: string): EndResult | undefined {
    return this.end("failed", {
      reason: `Blocked by start handler "${handlerName}".`,
    });
  }

  /** The session is ending with the run still in flight (AC-021-5). */
  shutdown(): EndResult | undefined {
    return this.end("cancelled", {
      reason: "No completion signal was received before the session ended.",
    });
  }

  /** The run in flight, if any. */
  current(): ActiveRun | undefined {
    return this.active ? { ...this.active } : undefined;
  }

  private end(
    outcome: CommandOutcome,
    detail: { reason?: string; summary?: string; artifacts?: string[] },
  ): EndResult | undefined {
    const run = this.active;
    if (!run) return undefined;
    this.active = undefined;

    const result: EndResult = {
      run_id: run.run_id,
      command: run.command,
      arguments: run.arguments,
      cwd: run.cwd,
      session_id: run.session_id,
      outcome,
      duration_ms: Math.max(0, this.now() - run.started_at),
    };
    if (detail.reason !== undefined) result.reason = detail.reason;
    if (detail.summary !== undefined) result.summary = detail.summary;
    if (detail.artifacts !== undefined) result.artifacts = [...detail.artifacts];
    return result;
  }

  private uniqueId(): string {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
      const id = this.newId();
      if (!this.usedIds.has(id)) {
        this.usedIds.add(id);
        return id;
      }
    }
    throw new Error(
      `Could not produce a run id unique within session ${this.sessionId} after ${MAX_ID_ATTEMPTS} attempts.`,
    );
  }
}
