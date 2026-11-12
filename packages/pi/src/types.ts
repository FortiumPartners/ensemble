/**
 * Shared TypeScript interfaces for the Pi generator.
 *
 * Defines input shapes (CommandYaml, AgentYaml), output shapes (TransformResult),
 * and runtime configuration (GeneratorOptions).
 *
 * @module ensemble-pi/types
 */

export interface GeneratorOptions {
  dryRun: boolean;
  verbose: boolean;
  validate: boolean;
  /** Monorepo root path. Defaults to process.cwd(). */
  sourceRoot: string;
  /** packages/pi path. Defaults to __dirname/.. */
  outputRoot: string;
}

export interface Phase {
  id: number;
  name: string;
  steps: Step[];
}

export interface Step {
  id: number;
  title: string;
  description?: string;
  /**
   * Actions are declared as strings in YAML but js-yaml may parse unquoted
   * "key: value" entries as single-key objects. Use `unknown[]` to accept
   * both and coerce to string during rendering.
   */
  actions?: unknown[];
}

export interface CommandParameter {
  name: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
}

/** One entry in a dispatcher command's dispatch.subcommands[] list. */
export interface DispatchSubcommand {
  /** First-argument token the user types to select this subcommand. */
  keyword: string;
  /** Referenced sibling command's metadata.name with "ensemble:" stripped. */
  ref: string;
  /** Optional override; defaults to the referenced command's own description. */
  description?: string;
}

export interface CommandYaml {
  metadata: {
    name: string;
    description: string;
    version: string;
    /** 'hidden' routes the prompt to prompts/_hidden/ (not registered, no wrapper skill). */
    visibility?: 'visible' | 'hidden';
    /** Toolchain capability ids this command relies on; required/optional parallel the command YAML schema. */
    capabilities?: {
      required?: string[];
      optional?: string[];
    };
  };
  /**
   * Skill-backed command: the name of the skill (a directory of the same package's `skills/`)
   * whose SKILL.md carries the command's whole prompt. Such a command is a manifest, its metadata
   * plus this key, so it has no workflow; its Pi prompt is a stub that points at the skill.
   */
  skill?: string;
  /** Absent on a skill-backed command. */
  workflow?: {
    phases: Phase[];
  };
  constraints?: string[];
  mission?: {
    summary?: string;
  };
  parameters?: CommandParameter[];
  /** Marks this command as a thin dispatcher routing to sibling commands. */
  dispatch?: {
    subcommands: DispatchSubcommand[];
  };
}

export interface AgentYaml {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  /** Body content after frontmatter */
  body?: string;
}

export interface TransformResult {
  sourcePath: string;
  outputPath: string;
  content: string;
  type: 'command' | 'agent' | 'skill' | 'agents-md' | 'lib';
}

/** What a generator run reports back to its caller. */
export interface GenerateResult {
  /**
   * Absolute paths, sorted, of the stale generated files the run removed or, on a dry run,
   * would remove. A file is stale when the generator wrote it earlier (it carries a generated
   * marker), this run did not reproduce it, and so its command, agent or skill was removed,
   * renamed or moved. Hand-authored files are never listed.
   */
  pruned: string[];
}
