import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerDispatcherCommand } from "./dispatcher-commands";
import { registerLifecycleHooks } from "./lifecycle/adapter";

/**
 * Walks up from `startDir` looking for a `.git` directory to find the
 * repo root. Falls back to `startDir` if none is found (e.g. a repo
 * checked out without its .git, or a sandboxed/shallow environment).
 */
function resolveRepoRoot(startDir: string): string {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
}

/**
 * Registers native Pi/OMP completion for the four markdown-prompt
 * dispatcher commands (prd/trd/issue/feature). Each registration is a
 * no-op in any repo that doesn't have the corresponding YAML -- see
 * registerDispatcherCommand's own doc comment -- so this extension
 * loading globally in every session never pollutes an unrelated
 * repo's command list.
 *
 * It also registers the command lifecycle hooks adapter, which is likewise
 * inert unless the repo has an `.ensemble/hooks.yaml`.
 */
function activate(pi: ExtensionAPI): void {
  const repoRoot = resolveRepoRoot(process.cwd());

  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-prd",
    yamlRelPath: "packages/product/commands/prd.yaml",
    forwardTo: "ensemble:prd",
    description: "Dispatch to a PRD-management subcommand (create, refine, ...)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-trd",
    yamlRelPath: "packages/development/commands/trd.yaml",
    forwardTo: "ensemble:trd",
    description: "Dispatch to a TRD-management subcommand (create, refine, analyze, ...)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-issue",
    yamlRelPath: "packages/development/commands/issue.yaml",
    forwardTo: "ensemble:issue",
    description: "Dispatch to an issue-management subcommand by keyword (fix, list, resume, status, abandon)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-feature",
    yamlRelPath: "packages/development/commands/feature.yaml",
    forwardTo: "ensemble:feature",
    description: "Dispatch to the feature-lifecycle workflow by keyword (new, resume, status, abandon)",
  });

  registerLifecycleHooks(pi, repoRoot);
}

export default activate;
