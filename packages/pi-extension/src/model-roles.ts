import { isRecord } from "@sunstone-partners/ensemble-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Model-role check: an Ensemble agent whose OMP model role is not set is reported
 * loudly, at the moment it is about to start, instead of silently losing its tier or
 * dying with OMP's misleading "No model selected".
 *
 * Why this exists. The generated Pi agents name a tier as an ordered role list,
 * `model: "@high,@default"` or `"@medium,@default"` (the agent transformer in
 * packages/pi). OMP expands each `@role` through the user's `modelRoles` and tries the
 * entries in order. `high` and `medium` are custom roles, so on a machine that has not
 * defined them:
 *   - `modelRoles.default` usable: the agent silently runs on the default model and
 *     the tier has no effect, and nothing says so;
 *   - nothing usable: the child dies with "No model selected ... Use /login ...", which
 *     is the wrong advice for a missing role mapping.
 * A SKILL.md cannot check this, so the check is code, here.
 *
 * Mechanism: OMP's `before_subagent_spawn` event (extension API, measured on omp
 * 18.16.0; it is not in Pi's typings). It fires once per child (`task`, eval `agent()`,
 * workpool), after the host has applied the agent's frontmatter, `task.agentModelOverrides`
 * and role expansion, and before the child resolves its model. Its `patterns` are the
 * model list the host will try. A role that is not configured stays in that list as the
 * literal `@role`; a configured role, an agent pinned through `task.agentModelOverrides`
 * and a per-call model leave no `@role` behind. So the check reads no settings file, no
 * agent file and no frontmatter, and an override cannot make it fire by mistake.
 *
 *   - no literal tier alias in `patterns`: quiet, always;
 *   - a literal tier alias and some pattern resolves: the agent starts on its fallback.
 *     The user is told once per session. The spawn is never blocked;
 *   - a literal tier alias and no pattern resolves: OMP would fail the child, so the
 *     spawn is refused with the message instead (the host returns it to the model as the
 *     job's error), and the user is told once per session.
 *
 * A pattern "resolves" when `ctx.models.resolve` returns a model, which is the call the
 * host's own resolution makes, over the same authenticated model list.
 *
 * Hosts that never emit the event (Pi, older OMP) never call the handler, so they keep
 * the quiet fallback. A handler that throws or times out does not stop a spawn in OMP.
 * The check still catches its own failures and says so, so a defect is not silent.
 *
 * Known limit: the notice goes to the user only from the user-facing session. A child
 * session (`ctx.agent.kind === "sub"`) has no UI, and its stderr would corrupt the
 * parent's TUI, so a fallback inside an orchestrator's children is not announced
 * separately. The first notice in the user-facing session lists every tier role that
 * has no usable model, so one edit of the config fixes them all.
 *
 * @module ensemble-pi-extension/model-roles
 */

/**
 * The OMP roles the generated agents' tiers map to. Keep in step with `MODEL_TIER_ROLES`
 * in packages/pi/src/transformers/agent-transformer.ts: tests/model-roles.test.ts fails
 * when a generated agent names a role that is missing here.
 */
export const TIER_ROLES = ["high", "medium"] as const;
export type TierRole = (typeof TIER_ROLES)[number];

/** The OMP event this check handles. */
export const SPAWN_EVENT = "before_subagent_spawn";

/** Where OMP reads `modelRoles` from; the user's profile may use another agent directory. */
const CONFIG_FILE = "~/.omp/agent/config.yml";

const isTierRole = (role: string): role is TierRole => (TIER_ROLES as readonly string[]).includes(role);

/**
 * The role a pattern names when it is an OMP role alias (`@high`, `@high:xhigh`), else
 * undefined. A bare word (`high`) is a model-name substring to OMP, not a role.
 */
export function aliasRole(pattern: string): string | undefined {
  const match = /^@([^\s:,@]+)(?::\S+)?$/.exec(pattern.trim());
  return match?.[1];
}

/**
 * The tier roles the host left in `patterns` as literal aliases, in order, once each.
 * OMP expands a configured role to its model; an alias it could not expand is a role
 * nobody configured.
 */
export function unresolvedTierRoles(patterns: readonly string[]): TierRole[] {
  const roles: TierRole[] = [];
  for (const pattern of patterns) {
    const role = aliasRole(pattern);
    if (role !== undefined && isTierRole(role) && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

/** A spawn the check has something to say about. */
export type Notable =
  | {
      kind: "fallback";
      agent: string;
      /** The tier roles this spawn asked for that are not set. */
      asked: TierRole[];
      /** Every tier role with no usable model right now: `asked` and any other. */
      unusable: TierRole[];
      /** The model the spawn will run on instead. */
      runsOn: string;
    }
  | {
      kind: "unstartable";
      agent: string;
      asked: TierRole[];
      unusable: TierRole[];
      /** The `default` role resolves to no model either. */
      defaultUnusable: boolean;
    };

/** What the check concludes about one spawn. */
export type SpawnAssessment = { kind: "quiet" } | Notable;

/**
 * Decides what to say about a spawn. `resolve` returns the name of the model a spec
 * resolves to, or undefined; it is the host's `ctx.models.resolve`.
 */
export function assessSpawn(
  agent: string,
  patterns: readonly string[],
  resolve: (spec: string) => string | undefined,
): SpawnAssessment {
  const asked = unresolvedTierRoles(patterns);
  if (asked.length === 0) return { kind: "quiet" };

  const unusable = TIER_ROLES.filter((role) => asked.includes(role) || resolve(`@${role}`) === undefined);

  for (const pattern of patterns) {
    const runsOn = resolve(pattern);
    if (runsOn !== undefined) return { kind: "fallback", agent, asked, unusable, runsOn };
  }
  return { kind: "unstartable", agent, asked, unusable, defaultUnusable: resolve("@default") === undefined };
}

/** The longest agent name, in characters, that a notice shows. */
const AGENT_NAME_LIMIT = 80;

/** The longest model name (`provider/id`), in characters, that a notice shows. */
const MODEL_NAME_LIMIT = 120;

/** The longest host error text, in characters, that a notice shows. */
const ERROR_TEXT_LIMIT = 200;

/**
 * Host-supplied text made safe to print. The notice goes raw to a terminal and back to the model,
 * and an agent name comes from an agent file (any repository can ship one), so it cannot be trusted
 * to carry no escape sequence or line break. The text is capped at `limit` characters; quotes,
 * backslashes and C0 controls are then escaped the way JSON does it, and every other control
 * character, format character (bidi marks, zero-width and tag characters) and line or paragraph
 * separator, which JSON leaves raw, is written as its \u escape. The result holds no character a
 * terminal or a reader would act on and no line break.
 */
function neutralize(text: string, limit: number): string {
  const characters = Array.from(text);
  const shown = characters.length > limit ? `${characters.slice(0, limit).join("")}...` : text;
  return JSON.stringify(shown)
    .slice(1, -1)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`;
    });
}

/** An agent name made safe to print, in double quotes: `"code-reviewer"`. */
export function quoteAgentName(agent: string): string {
  return `"${neutralize(agent, AGENT_NAME_LIMIT)}"`;
}

/** The message for the user and, when the spawn is refused, for the model. */
export function buildNotice(assessment: Notable): string {
  const roles: string[] = [...assessment.unusable];
  if (assessment.kind === "unstartable" && assessment.defaultUnusable) roles.unshift("default");

  const asked = assessment.asked.map((role) => `"${role}"`).join(" and ");
  const agent = quoteAgentName(assessment.agent);
  const what =
    assessment.kind === "unstartable"
      ? `Ensemble agent ${agent} was not started: it asks for the OMP model role ${asked}, which is not set, and nothing it falls back to resolves to a model either. OMP would only fail it with "No model selected" and the advice to /login.`
      : `Ensemble agent ${agent} asked for the OMP model role ${asked}, which is not set, so it runs on ${neutralize(assessment.runsOn, MODEL_NAME_LIMIT)} instead and its model tier has no effect.`;
  const otherwise =
    assessment.kind === "unstartable"
      ? "Retrying the spawn fails the same way until the roles are set."
      : "Until they are set, every agent that asks for these roles runs on its fallback model.";

  return [
    what,
    `Set ${roles.map((role) => `modelRoles.${role}`).join(", ")} in ${CONFIG_FILE} (or in the config.yml of the OMP profile you use), for example:`,
    "",
    "modelRoles:",
    ...roles.map((role) => `  ${role}: <provider>/<model>`),
    "",
    otherwise,
    "To pin one agent to a model whatever its tier, set task.agentModelOverrides in the same file.",
  ].join("\n");
}

/** What OMP reads from a `before_subagent_spawn` handler. */
export interface SpawnResult {
  block?: boolean;
  reason?: string;
}

interface SpawnEventHost {
  on(event: typeof SPAWN_EVENT, handler: (event: unknown, ctx: unknown) => SpawnResult | undefined): void;
}

interface SpawnFacts {
  agent: string;
  patterns: string[];
}

/** The agent and model list of an OMP spawn event, or undefined when the event is not that shape. */
function readSpawn(event: unknown): SpawnFacts | undefined {
  if (!isRecord(event) || typeof event.agent !== "string" || !Array.isArray(event.patterns)) return undefined;
  if (!event.patterns.every((pattern): pattern is string => typeof pattern === "string")) return undefined;
  return { agent: event.agent, patterns: event.patterns };
}

/** The name `provider/id` of a model object, or undefined when `model` is not one. */
function modelName(model: unknown): string | undefined {
  if (!isRecord(model) || typeof model.id !== "string") return undefined;
  return typeof model.provider === "string" ? `${model.provider}/${model.id}` : model.id;
}

/** What the handler needs of the host's event context. */
interface SpawnContext {
  resolve: (spec: string) => string | undefined;
  isChildSession: boolean;
  sessionId: string;
  tell: (message: string, level: "warning" | "error") => void;
}

function readContext(ctx: unknown): SpawnContext | undefined {
  if (!isRecord(ctx) || !isRecord(ctx.models) || typeof ctx.models.resolve !== "function") return undefined;
  const models = ctx.models as { resolve: (spec: string) => unknown };
  const ui = isRecord(ctx.ui) ? ctx.ui : undefined;
  const sessionManager = isRecord(ctx.sessionManager) ? ctx.sessionManager : undefined;
  return {
    resolve: (spec) => modelName(models.resolve(spec)),
    isChildSession: isRecord(ctx.agent) && ctx.agent.kind === "sub",
    sessionId: typeof sessionManager?.getSessionId === "function" ? String(sessionManager.getSessionId()) : "",
    tell: (message, level) => {
      try {
        if (ctx.hasUI === true && typeof ui?.notify === "function") {
          ui.notify(message, level);
          return;
        }
      } catch {
        // The host's UI failed; the message still reaches the user, on stderr.
      }
      process.stderr.write(`${message}\n`);
    },
  };
}

/**
 * The `before_subagent_spawn` handler. The notice for the user is shown once per session
 * and set of roles; a refused spawn always returns its reason to the model.
 */
export function createSpawnHandler(): (event: unknown, ctx: unknown) => SpawnResult | undefined {
  const told = new Set<string>();
  const tellOnce = (host: SpawnContext, key: string, message: string, level: "warning" | "error"): void => {
    if (host.isChildSession) return; // no UI here, and stderr would corrupt the parent's TUI
    const once = `${host.sessionId}|${key}`;
    if (told.has(once)) return;
    told.add(once);
    host.tell(message, level);
  };

  return (event, ctx) => {
    const spawn = readSpawn(event);
    const host = readContext(ctx);
    if (spawn === undefined || host === undefined) return undefined; // not OMP's event: stay out of the way
    try {
      const assessment = assessSpawn(spawn.agent, spawn.patterns, host.resolve);
      if (assessment.kind === "quiet") return undefined;
      const notice = buildNotice(assessment);
      const key = `${assessment.kind}|${assessment.unusable.join(",")}`;
      if (assessment.kind === "fallback") {
        tellOnce(host, key, notice, "warning");
        return undefined;
      }
      tellOnce(host, key, notice, "error");
      return { block: true, reason: notice };
    } catch (error) {
      // The check failed, not the spawn: let the spawn run, and say that the check did not.
      const reason = isRecord(error) && typeof error.message === "string" ? error.message : String(error);
      const skipped = `Ensemble model-role check skipped for ${quoteAgentName(spawn.agent)}: ${neutralize(reason, ERROR_TEXT_LIMIT)}`;
      tellOnce(host, "check-failed", skipped, "warning");
      return undefined;
    }
  };
}

/**
 * Registers the check. It registers one handler in every session, because Ensemble
 * agents are used in any repository; the handler says nothing unless a spawn asked for a
 * tier role that is not set.
 */
export function registerModelRoleCheck(pi: ExtensionAPI): void {
  // `before_subagent_spawn` exists in OMP only, so Pi's typed `on` does not list it. Pi
  // accepts any event name and never emits this one.
  (pi as unknown as SpawnEventHost).on(SPAWN_EVENT, createSpawnHandler());
}
