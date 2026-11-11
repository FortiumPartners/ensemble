import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface DispatchSubcommand {
  keyword: string;
  ref: string;
  description?: string;
}

const SUBCOMMANDS_HEADING = /^##\s+Subcommands\s*$/;
const ANY_H2 = /^##\s/;
// `- **`<keyword>`** - <description>. Invoke `/ensemble:<ref>` directly, ...`
// The description is everything up to the first ". Invoke `/ensemble:" so it
// may itself contain periods, dashes and backticks.
const SUBCOMMAND_BULLET = /^-\s+\*\*`([^`]+)`\*\*\s+-\s+(.*?)\.\s+Invoke\s+`\/ensemble:([^`\s]+)`/;

/**
 * Parses the `## Subcommands` section of a dispatcher skill (SKILL.md) into
 * its routing table: one bullet per keyword, in file order. Bullets outside
 * that section, and lines in it that are not subcommand bullets, are ignored.
 * Returns an empty array when there is no such section.
 */
export function parseSubcommandsSection(markdown: string): DispatchSubcommand[] {
  const out: DispatchSubcommand[] = [];
  let inSection = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (SUBCOMMANDS_HEADING.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (ANY_H2.test(line)) break;
    const m = SUBCOMMAND_BULLET.exec(line);
    if (m) out.push({ keyword: m[1], ref: m[3], description: m[2] });
  }
  return out;
}

/**
 * Reads a dispatcher skill's `## Subcommands` bullets -- the routing table
 * the skill itself instructs the model to follow, and the single source of
 * truth for it (the dispatcher command YAML is only a manifest pointing at
 * the skill). Reusing it here, rather than hand-duplicating the
 * keyword/description list in TypeScript, keeps one source of truth.
 *
 * Returns an empty array -- never throws -- when the file is missing,
 * unreadable, or has no Subcommands section. This only backs
 * completion-dropdown sugar; a read/parse failure must degrade to "no
 * suggestions", not crash command registration or the extension itself.
 */
export function loadDispatchSubcommands(repoRoot: string, skillRelPath: string): DispatchSubcommand[] {
  try {
    const absPath = resolve(repoRoot, skillRelPath);
    if (!existsSync(absPath)) return [];
    return parseSubcommandsSection(readFileSync(absPath, "utf8"));
  } catch {
    return [];
  }
}

export interface RegisterDispatcherCommandOptions {
  /**
   * Hyphenated native command name, e.g. "ensemble-prd". Deliberately not
   * colon-separated like the markdown-prompt commands (`ensemble:prd`):
   * colons are reserved in Windows paths and have caused problems there.
   */
  name: string;
  /** Repo-root-relative path to the dispatcher's own skill (SKILL.md). */
  skillRelPath: string;
  /**
   * The existing, colon-named markdown-prompt command this forwards into
   * (bare, no leading slash -- e.g. "ensemble:prd").
   */
  forwardTo: string;
  description: string;
}

/**
 * Registers a native command whose only job is to give a markdown-prompt
 * dispatcher command (prd/trd/issue) the same live, space-triggered
 * subcommand completion /mcp has -- a capability markdown prompts cannot
 * reach on their own, since `getArgumentCompletions` is reachable only
 * through `pi.registerCommand`, not through the generic prompts/skills
 * loading mechanism every ensemble command (including these dispatchers)
 * otherwise uses.
 *
 * The handler does not duplicate any dispatch/routing logic: it forwards
 * the typed text, verbatim, into the existing, already-tested
 * `/ensemble:<name>` markdown command via `sendUserMessage`, which remains
 * the single source of truth for actual subcommand routing (including its
 * own "print the keyword table and halt" behavior on empty/unmatched
 * input) -- this registration only ever adds the completion dropdown.
 *
 * This extension loads in every session, in every repo the host opens
 * (it is installed globally, not scoped to this monorepo), so a no-op
 * skip -- not registration -- is correct when `opts.skillRelPath` doesn't
 * exist under `repoRoot`: an unrelated repo must never see `ensemble-prd`
 * et al. in its command list just because this extension happened to load.
 */
export function registerDispatcherCommand(
  pi: ExtensionAPI,
  repoRoot: string,
  opts: RegisterDispatcherCommandOptions,
): void {
  if (!existsSync(resolve(repoRoot, opts.skillRelPath))) return;
  pi.registerCommand(opts.name, {
    description: opts.description,
    getArgumentCompletions: (argumentPrefix: string) => {
      const prefix = argumentPrefix.trim().toLowerCase();
      return loadDispatchSubcommands(repoRoot, opts.skillRelPath)
        .filter((s) => s.keyword.toLowerCase().startsWith(prefix))
        .map((s) => ({
          value: s.keyword,
          label: s.keyword,
          description: s.description,
        }));
    },
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();
      pi.sendUserMessage(trimmed ? `/${opts.forwardTo} ${trimmed}` : `/${opts.forwardTo}`, {
        expandPromptTemplates: true,
      });
    },
  });
}
