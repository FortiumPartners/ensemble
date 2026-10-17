/**
 * Shared type guards for agent-core. This package has one canonical
 * `isRecord`; modules import it rather than defining their own.
 */

/** Narrows to a plain object. Its fields stay `unknown`; check each one before use. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
