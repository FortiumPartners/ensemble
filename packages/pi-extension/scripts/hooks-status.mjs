#!/usr/bin/env node
// Lifecycle hooks status check (TRD-014, REQ-014 AC-014-4, REQ-017 AC-017-2).
//
//   node scripts/hooks-status.mjs [projectRoot]
//
// Prints the per-harness capability table, Pi's definition of a command's end,
// and whether the project's `.ensemble/hooks.yaml` is active: absent, invalid
// (with each error), valid but not trusted by the user, or valid and trusted
// by the user. It says that hooks are inactive in harnesses with no adapter.
//
// This is a script, never a slash command. No `/hooks-*` command is registered
// anywhere, so it cannot collide with the same-named commands of
// `pi-yaml-hooks`. It runs no handler: it reads and validates the file, and
// reads the user's trust store.
//
// Environment:
//   ENSEMBLE_HOOKS_TRUST_STORE  the user's trust store file to read instead of
//                               `~/.ensemble/trusted-hooks.json`. For tests, so
//                               they never touch the real home directory.
//
// Exit code: 0 when the hooks file is absent or valid, 1 when it is invalid,
// 2 when this script cannot load the built agent-core package.
//
// Layout: this file belongs to the repository checkout and imports the built
// sibling package `packages/agent-core/dist` (`npm run build` there, or
// `tsc -p ../agent-core`, which `pretest` runs). It is not part of
// `dist/extension.bundle.cjs` and is not published, so a path import is valid
// where a package import would not be: the bundle is built from
// `src/extension.ts` only. agent-core is CommonJS, hence createRequire.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const coreDist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agent-core", "dist", "lifecycle-hooks");

// Kept equal to TRUST_COMMAND_NAME in src/lifecycle/adapter.ts, which this
// plain script cannot import (TypeScript source).
const TRUST_COMMAND = "ensemble-lifecycle-trust";

let core;
try {
  core = {
    ...require(path.join(coreDist, "capabilities.js")),
    ...require(path.join(coreDist, "config.js")),
    ...require(path.join(coreDist, "trust-store.js")),
  };
} catch (error) {
  console.error(
    `hooks-status: cannot load the built agent-core (${coreDist}): ${error?.message ?? error}\n` +
      "Build it first: tsc -p packages/agent-core",
  );
  process.exit(2);
}
const { renderCapabilityTable, unsupportedHookWarnings, loadHooksConfig, computeHooksDigest, isTrusted, HOOKS_FILE_RELATIVE } =
  core;

const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
const storePath = process.env.ENSEMBLE_HOOKS_TRUST_STORE || undefined;

const out = [renderCapabilityTable(), "", `Project: ${projectRoot}`];
let exitCode = 0;

const loaded = loadHooksConfig(projectRoot);
if (loaded.status === "absent") {
  out.push(`Hooks: ${HOOKS_FILE_RELATIVE} is absent. No hooks are configured, so none run.`);
} else if (loaded.status === "invalid") {
  exitCode = 1;
  out.push(`Hooks: ${HOOKS_FILE_RELATIVE} is invalid, so no hooks run until it is fixed. ${loaded.errors.length} error(s):`);
  for (const error of loaded.errors) out.push(`  ${error.path}: ${error.message}`);
} else {
  const { config } = loaded;
  const digest = computeHooksDigest(projectRoot, config);
  const trusted = isTrusted(projectRoot, digest, { storePath });
  out.push(
    `Hooks: ${HOOKS_FILE_RELATIVE} is valid (${Object.keys(config.hooks).length} hook(s), ` +
      `${Object.keys(config.commands).length} command selection(s)).`,
  );
  if (trusted) {
    out.push(
      "User trust: trusted, the hooks file and every handler file it names match the digest you trusted.",
      "Active in Pi when the host also trusts the project (ctx.isProjectTrusted()). That host trust cannot be known " +
        "outside Pi, so this check does not report it.",
    );
  } else {
    out.push(
      "User trust: NOT trusted (no record, or the hooks file or a handler file changed since you trusted it). " +
        "The hooks are inactive until you confirm them in Pi with /" + TRUST_COMMAND + ".",
      "Host trust (ctx.isProjectTrusted()) cannot be known outside Pi and is not reported.",
    );
  }
  const warnings = unsupportedHookWarnings(config, "pi");
  out.push(
    warnings.length === 0
      ? "Capability warnings for Pi: none."
      : `Capability warnings for Pi: ${warnings.length}`,
  );
  for (const warning of warnings) out.push(`  ${warning.message}`);
}
out.push("Harnesses with no adapter (see the table): hooks are inactive there whatever the project's hooks file says.");

console.log(out.join("\n"));
process.exitCode = exitCode;
