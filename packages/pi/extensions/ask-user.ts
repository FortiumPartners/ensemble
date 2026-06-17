/**
 * Pi ask_user Extension
 *
 * Registers the ask_user tool via Pi's ExtensionAPI, bridging Pi's
 * missing AskUserQuestion primitive with an interactive TUI prompt handler.
 *
 * @module ensemble-pi/extensions/ask-user
 */

interface ToolParameters {
  question: string;
}

interface ExtensionAPI {
  registerTool(config: {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string }>;
    execute: (params: ToolParameters) => Promise<string>;
  }): void;
  prompt(question: string): Promise<string>;
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'ask_user',
    description:
      'Ask the user a single question and return their answer. Use for interactive interviews — one question at a time.',
    parameters: {
      question: {
        type: 'string',
        description: 'The question to display to the user',
      },
    },
    execute: async ({ question }: ToolParameters): Promise<string> => {
      try {
        return await pi.prompt(question);
      } catch (err: unknown) {
        // Handle Ctrl+C / interruption gracefully
        if (
          err instanceof Error &&
          (err.message.includes('interrupted') ||
            err.message.includes('SIGINT') ||
            err.name === 'AbortError')
        ) {
          return '(interrupted — no answer provided)';
        }
        throw err;
      }
    },
  });
}
