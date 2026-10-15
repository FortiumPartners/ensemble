/**
 * Maps the raw text of a Pi `input` event to the Ensemble command it invokes.
 *
 * Pi delivers a slash command in exactly two raw forms, which for Ensemble
 * carry the same name: a prompt template, `/ensemble-<name> <args>`, and a
 * skill, `/skill:ensemble-<name> <args>`. Both resolve to the command
 * `ensemble:<name>`.
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

// `/` or `/skill:`, then `ensemble-<kebab-name>`, then end of input or whitespace and the rest.
const SLASH_INPUT = /^\/(?:skill:)?(ensemble-[a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/;
const FIRST_TOKEN = /^(\S+)(?:\s+([\s\S]*))?$/;

/**
 * Returns the command an input invokes, or undefined when the input is not an
 * Ensemble command, or is a dispatcher with a missing or unknown keyword.
 */
export function resolveCommand(inputText: string): ResolvedCommand | undefined {
  const match = SLASH_INPUT.exec(inputText);
  if (!match) return undefined;

  const [, name, rest = ""] = match;
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
