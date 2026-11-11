/**
 * Command Transformer
 *
 * Transforms Ensemble YAML command definitions (phases/steps/actions) into
 * Pi-compatible command templates written to packages/pi/commands/.
 *
 * Output format per command:
 *   - HTML comment header with version and description
 *   - H1 title from metadata.name
 *   - Blockquote preamble from mission.summary (if present)
 *   - Fenced callout block for constraints (if present)
 *   - H2 sections for each workflow phase
 *   - H3 sections for each step with description and numbered action list
 *
 * A skill-backed command (CommandYaml.skill: its YAML is a manifest, the skill carries the prompt)
 * renders as a stub instead: the same header plus a `Skill:` line, the H1 title, and a pointer
 * that tells the agent to load the skill. It has no mission, constraints, arguments or phases.
 *
 * @module ensemble-pi/transformers/command-transformer
 */

import * as path from 'path';
import { CommandYaml, CommandParameter, Phase, Step, DispatchSubcommand } from '../types';
import { commandHeaderLine, generatedMarker, skillHeaderLine } from '../generated-marker';

// ---------------------------------------------------------------------------
// Internal rendering helpers
// ---------------------------------------------------------------------------

/**
 * Render the HTML comment header block containing generator metadata,
 * source filename, version, and description. Its first line is the generated
 * marker and its second the Command line (see ../generated-marker.ts): pruning
 * and command-wrapper recognition key on them, so they are built there. A
 * skill-backed command adds a Skill line third, which is how the wrapper
 * generator knows its prompt is a stub (skillOfPrompt).
 */
function renderHeader(commandYaml: CommandYaml, sourcePath: string): string {
  const { name, version, description, capabilities } = commandYaml.metadata;
  const sourceFile = path.basename(sourcePath);
  const lines: string[] = [
    generatedMarker(sourceFile),
    commandHeaderLine(name, version),
    ...(commandYaml.skill !== undefined ? [skillHeaderLine(commandYaml.skill)] : []),
    `<!-- Description: ${description} -->`,
  ];
  const required = capabilities?.required ?? [];
  const optional = capabilities?.optional ?? [];
  if (required.length > 0 || optional.length > 0) {
    lines.push(`<!-- Capabilities: required=[${required.join(', ')}], optional=[${optional.join(', ')}] -->`);
  }
  return lines.join('\n');
}

/**
 * Render the H1 title from metadata.name. Claude-style command names
 * (ensemble:<cmd>) are normalized to the Pi invocation form (ensemble-<cmd>)
 * globally in transformCommand, so this renders the name as-is.
 */
function renderTitle(name: string): string {
  return `# ${name}`;
}

/**
 * Render mission.summary as a blockquote preamble.
 * Multi-line summaries are collapsed to a single quoted paragraph — each
 * internal newline is replaced with a space so the blockquote stays compact.
 */
function renderMission(summary: string): string {
  const collapsed = summary
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  return `> **Mission:** ${collapsed}`;
}

/**
 * Render the constraints array as a fenced callout block.
 * Uses a blockquote with a bold header followed by bullet points.
 */
function renderConstraints(constraints: string[]): string {
  const lines: string[] = ['> **Constraints:**'];
  for (const constraint of constraints) {
    lines.push(`> - ${constraint.trim()}`);
  }
  return lines.join('\n');
}

/**
 * Render the parameters array as an "## Arguments" section.
 * Each parameter renders as a single bullet: name, type, required/optional,
 * default (if present), and description.
 */
function renderArguments(parameters: CommandParameter[]): string {
  const lines: string[] = ['## Arguments', ''];
  for (const param of parameters) {
    const type = param.type ?? 'string';
    const requirement = param.required ? 'required' : 'optional';
    let tag = `${type}, ${requirement}`;
    if (param.default !== undefined) {
      tag += `, default: \`${JSON.stringify(param.default)}\``;
    }
    let line = `- **\`${param.name}\`** (${tag})`;
    if (param.description) {
      const desc = param.description.trim().replace(/\s+/g, ' ');
      line += `: ${desc}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * Render the dispatch.subcommands array as a "## Subcommands" section for a
 * dispatcher command. Each subcommand's `ref` resolves through the
 * commandPathsByRef map (built once per generation run in generator.ts's
 * discovery loop, over its own existing discovery of packages/*\/commands/*.yaml)
 * to that sibling command's own, already-generated Pi prompt output path --
 * the dispatcher never inlines the sibling's workflow, keeping per-invocation
 * cost equal to today's single-command cost.
 *
 * Mirrors scripts/lib/command-transformer.js's generateSubcommandsSection for
 * Claude Code, but points at Pi's own `prompts/<name>.md` output path instead
 * of Claude's `commands/ensemble/<name>.md`.
 */
function renderSubcommands(
  subcommands: DispatchSubcommand[],
  commandPathsByRef: Map<string, string>,
  sourcePath: string
): string {
  const lines: string[] = ['## Subcommands', ''];
  for (const sub of subcommands) {
    const outputPath = commandPathsByRef.get(sub.ref);
    if (!outputPath) {
      throw new Error(
        `dispatch.subcommands references unknown command '${sub.ref}' (${sourcePath})`
      );
    }
    const description = sub.description ? sub.description.trim().replace(/\s+/g, ' ') : '';
    const descPrefix = description ? `${description}. ` : '';
    // Use the Claude-canonical "ensemble:<cmd>" form here; the global
    // ensemble: → ensemble- rewrite at the end of transformCommand() already
    // normalizes every such reference in the output, so no local rewrite is
    // needed.
    lines.push(
      `- **\`${sub.keyword}\`** - ${descPrefix}run \`/ensemble:${sub.ref}\` (\`${outputPath}\`), passing the remaining arguments through as its $ARGUMENTS.`
    );
  }
  return lines.join('\n');
}

/**
 * Coerce an action value to a display string.
 * YAML actions that contain unquoted colons are parsed by js-yaml as
 * single-key objects (e.g. `{"key": "value"}`). Reassemble them into
 * the original "key: value" text so the rendered output is readable.
 */
function actionToString(action: unknown): string {
  if (typeof action === 'string') {
    return action.trim();
  }
  if (action !== null && typeof action === 'object') {
    // Single-key object from an unquoted "key: value" action line
    const entries = Object.entries(action as Record<string, unknown>);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      return `${key}: ${value}`;
    }
    // Multi-key fallback — JSON stringify is a safe last resort
    return JSON.stringify(action);
  }
  return String(action);
}

/**
 * Render a single action item.
 * Actions are numbered (1-based) and output as plain text lines.
 */
function renderAction(action: unknown, index: number): string {
  return `${index + 1}. ${actionToString(action)}`;
}

/**
 * Render a step as an H3 section with optional description and action list.
 * stepNumber is 1-based and derived from the step's position in the parent array
 * rather than `step.id` to guarantee sequential output even when YAML ids skip.
 */
function renderStep(step: Step, stepNumber: number): string {
  const parts: string[] = [];

  parts.push(`### Step ${stepNumber}: ${step.title}`);

  if (step.description && step.description.trim()) {
    parts.push('');
    parts.push(step.description.trim());
  }

  if (step.actions && step.actions.length > 0) {
    parts.push('');
    parts.push('**Actions:**');
    for (let i = 0; i < step.actions.length; i++) {
      parts.push(renderAction(step.actions[i], i));
    }
  }

  return parts.join('\n');
}

/**
 * Render a phase as an H2 section followed by its steps.
 * phaseNumber is 1-based and derived from position in the phases array.
 */
function renderPhase(phase: Phase, phaseNumber: number): string {
  const parts: string[] = [];

  parts.push(`## Phase ${phaseNumber}: ${phase.name}`);

  if (phase.steps && phase.steps.length > 0) {
    for (let i = 0; i < phase.steps.length; i++) {
      parts.push('');
      parts.push(renderStep(phase.steps[i], i + 1));
    }
  }

  return parts.join('\n');
}

/**
 * Render the body of a skill-backed command's prompt: no workflow of its own, only the pointer to
 * the skill that carries it. The wording follows the hand-off the assessment command already makes
 * (packages/assessment/commands/assess.yaml): the `skill://<name>` form OMP resolves, then the
 * skill's file for a runtime that cannot load a skill by name. That file ships in this package's
 * skills/ directory (copied there by skill-copier, or in place in a self-contained package).
 *
 * A skill may be split into files beside its SKILL.md (a `references/` directory of phase files, say)
 * that the SKILL.md names by paths relative to itself. Those files ship in the skill's directory,
 * but an agent resolves a bare relative path against its working directory, where nothing is, so the
 * stub says what the paths are relative to, in both forms the skill can be reached by.
 *
 * The skill itself refers to $ARGUMENTS, and a skill loaded by name has no other way to learn the
 * value, so the stub hands it over. The prompt template's own $ARGUMENTS placeholder is expanded
 * everywhere it appears, so it is written once, as the value, and the explanation next to it says
 * ARGUMENTS without the sigil.
 */
function renderSkillStub(skill: string): string {
  return [
    `This command is a thin entry point: the \`${skill}\` skill carries its complete instructions.`,
    '',
    `Load that skill by name (\`skill://${skill}\`, or your runtime's skill loader) and follow it exactly. If your runtime cannot load a skill by name, read its \`SKILL.md\` file yourself (it ships under \`skills/${skill}/\` in this package) and follow its full text.`,
    '',
    `The skill names some files by paths relative to its own directory (the files of its \`references/\` directory, for example). Resolve those paths against that directory, \`skills/${skill}/\` in this package (\`skill://${skill}/<path>\` where your runtime reads skill URLs), never against your working directory.`,
    '',
    'Wherever the skill refers to its ARGUMENTS, use this value (empty if none were given): $ARGUMENTS',
  ].join('\n');
}

/**
 * Render everything after the title of a command that carries its own prompt: mission preamble,
 * constraints, arguments, dispatcher subcommands and workflow phases, each preceded by a blank line.
 */
function renderPromptBody(
  commandYaml: CommandYaml,
  sourcePath: string,
  commandPathsByRef: Map<string, string> | undefined
): string[] {
  const sections: string[] = [];

  // 3. Mission preamble (optional)
  if (commandYaml.mission?.summary) {
    sections.push('');
    sections.push(renderMission(commandYaml.mission.summary));
  }

  // 4. Constraints callout (optional)
  if (commandYaml.constraints && commandYaml.constraints.length > 0) {
    sections.push('');
    sections.push(renderConstraints(commandYaml.constraints));
  }

  // 5. Arguments (optional)
  if (commandYaml.parameters && commandYaml.parameters.length > 0) {
    sections.push('');
    sections.push(renderArguments(commandYaml.parameters));
  }

  // 5b. Subcommands (dispatcher commands only)
  if (commandYaml.dispatch?.subcommands && commandYaml.dispatch.subcommands.length > 0) {
    sections.push('');
    sections.push(
      renderSubcommands(
        commandYaml.dispatch.subcommands,
        commandPathsByRef ?? new Map(),
        sourcePath
      )
    );
  }

  // 6. Workflow phases
  const phases = commandYaml.workflow?.phases ?? [];
  for (let i = 0; i < phases.length; i++) {
    sections.push('');
    sections.push(renderPhase(phases[i], i + 1));
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transform a parsed command YAML object into a Pi-compatible prompt template
 * string. Deterministic: identical input always produces identical output.
 *
 * @param commandYaml  - Parsed and validated CommandYaml object
 * @param sourcePath   - Absolute path to the source .yaml file (used in header comment)
 * @param options      - Runtime options (verbose: emit progress to stdout;
 *   commandPathsByRef: bare command name -> resolved Pi prompt output path,
 *   for resolving dispatcher subcommand refs — only required when
 *   commandYaml.dispatch?.subcommands is present)
 * @returns            Rendered markdown string for the prompt template
 */
export function transformCommand(
  commandYaml: CommandYaml,
  sourcePath: string,
  options: { verbose?: boolean; commandPathsByRef?: Map<string, string> }
): string {
  const { name, version } = commandYaml.metadata;

  if (options.verbose) {
    process.stdout.write(`  [command-transformer] transforming: ${name} (v${version})\n`);
  }

  const sections: string[] = [];

  // 1. Header comment block
  sections.push(renderHeader(commandYaml, sourcePath));

  // 2. Title
  sections.push('');
  sections.push(renderTitle(name));

  // 3-6. Body: a skill-backed command points at its skill, any other renders its own prompt
  if (commandYaml.skill !== undefined) {
    sections.push('');
    sections.push(renderSkillStub(commandYaml.skill));
  } else {
    sections.push(...renderPromptBody(commandYaml, sourcePath, options.commandPathsByRef));
  }

  // Terminate with a single trailing newline for clean file output
  let output = sections.join('\n') + '\n';

  // Map AskUserQuestion → ask throughout the rendered output.
  // Pi/OMP's native interactive-question tool is registered as "ask" (not
  // "ask_user" — that name was never shipped by any Pi runtime; the Ensemble
  // YAML sources use the Claude Code tool name (AskUserQuestion). A global
  // replacement here ensures no AskUserQuestion references survive into any
  // Pi prompt.
  output = output.replace(/AskUserQuestion/g, 'ask');

  // Rewrite Claude-style command references (ensemble:<cmd>) to the Pi
  // invocation form (ensemble-<cmd>). Pi command names cannot contain ':'
  // (illegal in filenames on Windows), so each command is emitted as
  // prompts/ensemble-<cmd>.md and invoked as /ensemble-<cmd>. This covers the
  // H1 title, the header comment, and every cross-command reference in the
  // body, keeping the YAML source authored in the Claude-canonical colon form.
  output = output.replace(/ensemble:([a-z0-9-]+)/g, 'ensemble-$1');

  // INTERVIEW PROTOCOL annotations and {{variable}} placeholders require
  // no additional transformation: action items render verbatim (the
  // actionToString helper preserves the text as-is), and Pi shares the
  // same {{variable}} template syntax as Ensemble YAML — no escaping needed.

  return output;
}
