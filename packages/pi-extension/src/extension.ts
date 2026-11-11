import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerDispatcherCommand } from "./dispatcher-commands";
import { registerLifecycleHooks } from "./lifecycle/adapter";
import { registerModelRoleCheck } from "./model-roles";

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
 * Registers native Pi/OMP completion for the six markdown-prompt
 * dispatcher commands (prd/trd/issue/feature/reqnroll/standards). Each registration is a
 * no-op in any repo that doesn't have the corresponding dispatcher skill -- see
 * registerDispatcherCommand's own doc comment -- so this extension
 * loading globally in every session never pollutes an unrelated
 * repo's command list.
 *
 * It also registers the command lifecycle hooks adapter, which is likewise
 * inert unless the repo has an `.ensemble/hooks.yaml`.
 *
 * Unlike those, the model-role check registers in every session: Ensemble
 * agents run in any repository. Its handler says nothing unless a spawn asked
 * for a tier role (`high`, `medium`) that the user has not set; see
 * model-roles.ts.
 */
function activate(pi: ExtensionAPI): void {
  const repoRoot = resolveRepoRoot(process.cwd());

  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-prd",
    skillRelPath: "packages/product/skills/ensemble-prd/SKILL.md",
    forwardTo: "ensemble:prd",
    description: "Dispatch to a PRD-management subcommand (create, refine, ...)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-trd",
    skillRelPath: "packages/development/skills/ensemble-trd/SKILL.md",
    forwardTo: "ensemble:trd",
    description: "Dispatch to a TRD-management subcommand (create, refine, analyze, ...)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-issue",
    skillRelPath: "packages/development/skills/ensemble-issue/SKILL.md",
    forwardTo: "ensemble:issue",
    description: "Dispatch to an issue-management subcommand by keyword (fix, list, resume, status, abandon)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-feature",
    skillRelPath: "packages/development/skills/ensemble-feature/SKILL.md",
    forwardTo: "ensemble:feature",
    description: "Dispatch to the feature-lifecycle workflow by keyword (new, resume, status, abandon)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-reqnroll",
    skillRelPath: "packages/product/skills/ensemble-reqnroll/SKILL.md",
    forwardTo: "ensemble:reqnroll",
    description: "Dispatch to a PRD-to-Reqnroll acceptance-test subcommand by keyword (features, feature-drift, bindings, binding-drift, tdd)",
  });
  registerDispatcherCommand(pi, repoRoot, {
    name: "ensemble-standards",
    skillRelPath: "packages/core/skills/ensemble-standards/SKILL.md",
    forwardTo: "ensemble:standards",
    description: "Dispatch to a coding-standards subcommand by keyword (discover, inject, fold)",
  });

  registerLifecycleHooks(pi, repoRoot);
  registerModelRoleCheck(pi);
}

export default activate;
