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

export interface CommandYaml {
  metadata: {
    name: string;
    description: string;
    version: string;
  };
  workflow: {
    phases: Phase[];
  };
  constraints?: string[];
  mission?: {
    summary?: string;
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
  type: 'command' | 'agent' | 'skill' | 'agents-md';
}
