/**
 * Maps the raw text of a Pi `input` event to the Ensemble command it invokes.
 *
 * Pi delivers a slash command in exactly two raw forms, which for Ensemble
 * carry the same name: a prompt template, `/ensemble-<name> <args>`, and a
 * skill, `/skill:ensemble-<name> <args>`. Both resolve to the command
 * `ensemble:<name>`.
 *
 * A third form reaches `input` in this repository. Pi fires no `input` for the
 * text of a registered extension command, and the dispatcher commands
 * (dispatcher-commands.ts) are extension commands: they forward
 * `/ensemble:<dispatcher> <args>` with `sendUserMessage`, and `input` then fires
 * once for that forwarded text with source `extension` (measured, Pi 1.2.0).
 * So `/ensemble:prd create foo` resolves exactly like `/ensemble-prd create foo`,
 * and a dispatcher invocation starts one lifecycle whichever of the two reaches
 * `input`. The colon form is accepted for the dispatchers only: Pi has no
 * template or skill that answers to `/ensemble:create-prd`.
 *
 * Four dispatcher commands (`ensemble-prd`, `ensemble-trd`, `ensemble-issue`,
 * `ensemble-feature`) take a keyword as their first argument that selects the
 * real target. The lifecycle belongs to the target, never the dispatcher, so
 * a dispatcher resolves only through its keyword map.
 */

/**
 * dispatcher command name -> (keyword -> target command ref).
 *
 * Copied from the `dispatch.subcommands` list of each dispatcher's YAML
 * (`packages/product/commands/prd.yaml`, and `trd.yaml`, `issue.yaml`,
 * `feature.yaml` under `packages/development/commands/`). Those files exist
 * only in the Ensemble repo, not in a user's project, so the extension cannot
 * read them at runtime. tests/lifecycle-resolve-command.test.ts compares this
 * data to the YAML and fails on any difference. Refs are the YAML's bare
 * `ref` values, without the `ensemble:` prefix.
 */
export const DISPATCHER_TARGETS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "ensemble-prd": {
    create: "create-prd",
    "create-meeting": "create-prd-meeting",
    refine: "refine-prd",
    "refine-meeting": "refine-prd-meeting",
  },
  "ensemble-trd": {
    create: "create-trd",
    foreman: "create-trd-foreman",
    refine: "refine-trd",
    workstream: "create-workstream-trd",
    implement: "implement-trd-beads",
    analyze: "analyze-requirements",
    complexity: "analyze-complexity",
    validate: "validate-requirements",
    verify: "verify-requirements",
    status: "requirement-status",
    graph: "trd-dependency-graph",
  },
  "ensemble-issue": {
    fix: "fix-issue",
    list: "list-issue",
    resume: "fix-issue",
    status: "fix-issue",
    abandon: "fix-issue",
  },
  "ensemble-feature": {
    new: "new-feature",
    resume: "new-feature",
    status: "new-feature",
    abandon: "new-feature",
  },
};

export interface ResolvedCommand {
  /** Colon-form command name, e.g. `ensemble:create-prd`. */
  command: string;
  /** Text after the command (and, for a dispatcher, after its keyword), trimmed. */
  arguments: string;
}

const KEBAB = "[a-z0-9]+(?:-[a-z0-9]+)*";
// `/` or `/skill:` then `ensemble-<kebab-name>`, or `/ensemble:<kebab-name>` (what a dispatcher forwards),
// then end of input or whitespace and the rest.
const SLASH_INPUT = new RegExp(`^/(?:(?:skill:)?(ensemble-${KEBAB})|ensemble:(${KEBAB}))(?:\\s+([\\s\\S]*))?$`);
const FIRST_TOKEN = /^(\S+)(?:\s+([\s\S]*))?$/;

/**
 * Returns the command an input invokes, or undefined when the input is not an
 * Ensemble command, or is a dispatcher with a missing or unknown keyword.
 */
export function resolveCommand(inputText: string): ResolvedCommand | undefined {
  const match = SLASH_INPUT.exec(inputText);
  if (!match) return undefined;

  const templateName: string | undefined = match[1];
  const forwardedName: string | undefined = match[2];
  const rest = match[3] ?? "";
  const name = templateName ?? `ensemble-${forwardedName}`;
  // The colon form exists only for the dispatchers.
  if (forwardedName !== undefined && !Object.hasOwn(DISPATCHER_TARGETS, name)) return undefined;

  if (!Object.hasOwn(DISPATCHER_TARGETS, name)) {
    return { command: `ensemble:${name.slice("ensemble-".length)}`, arguments: rest.trim() };
  }

  const keywordMatch = FIRST_TOKEN.exec(rest.trim());
  if (!keywordMatch) return undefined;
  const targets = DISPATCHER_TARGETS[name];
  const keyword = keywordMatch[1];
  if (!Object.hasOwn(targets, keyword)) return undefined;
  return { command: `ensemble:${targets[keyword]}`, arguments: (keywordMatch[2] ?? "").trim() };
}
