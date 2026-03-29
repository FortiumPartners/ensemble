/**
 * Integration tests for the ask_user extension (TRD-011-TEST)
 *
 * Verifies that the ask_user extension correctly registers a tool via
 * Pi's ExtensionAPI and handles all prompt response scenarios.
 *
 * @module ensemble-pi/tests/ask-user
 */

import registerAskUser from '../extensions/ask-user';

interface ToolConfig {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string }>;
  execute: (params: { question: string }) => Promise<string>;
}

describe('ask_user extension', () => {
  let mockPrompt: jest.Mock;
  let mockRegisterTool: jest.Mock;
  let mockPi: { registerTool: jest.Mock; prompt: jest.Mock };
  let capturedConfig: ToolConfig;

  beforeEach(() => {
    mockPrompt = jest.fn();
    mockRegisterTool = jest.fn((config: ToolConfig) => {
      capturedConfig = config;
    });
    mockPi = { registerTool: mockRegisterTool, prompt: mockPrompt };
  });

  // ---------------------------------------------------------------------------
  // 1. Registration
  // ---------------------------------------------------------------------------
  it('calls pi.registerTool() exactly once when the extension is loaded', () => {
    registerAskUser(mockPi);
    expect(mockRegisterTool).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // 2. Tool name
  // ---------------------------------------------------------------------------
  it('registers a tool with name === "ask_user"', () => {
    registerAskUser(mockPi);
    expect(capturedConfig.name).toBe('ask_user');
  });

  // ---------------------------------------------------------------------------
  // 3. Tool description
  // ---------------------------------------------------------------------------
  it('description contains "single question"', () => {
    registerAskUser(mockPi);
    expect(capturedConfig.description).toContain('single question');
  });

  it('description contains "one question at a time"', () => {
    registerAskUser(mockPi);
    expect(capturedConfig.description).toContain('one question at a time');
  });

  // ---------------------------------------------------------------------------
  // 4. Parameters schema
  // ---------------------------------------------------------------------------
  it('has a parameters.question field with type === "string"', () => {
    registerAskUser(mockPi);
    expect(capturedConfig.parameters).toBeDefined();
    expect(capturedConfig.parameters.question).toBeDefined();
    expect(capturedConfig.parameters.question.type).toBe('string');
  });

  // ---------------------------------------------------------------------------
  // 5. Execute returns pi.prompt response
  // ---------------------------------------------------------------------------
  it('execute() resolves with the answer returned by pi.prompt()', async () => {
    registerAskUser(mockPi);
    mockPrompt.mockResolvedValueOnce('Alice');

    const result = await capturedConfig.execute({ question: 'What is your name?' });

    expect(mockPrompt).toHaveBeenCalledWith('What is your name?');
    expect(result).toBe('Alice');
  });

  // ---------------------------------------------------------------------------
  // 6. SIGINT / "interrupted" handling
  // ---------------------------------------------------------------------------
  it('resolves to the interrupted string when pi.prompt() rejects with Error("interrupted")', async () => {
    registerAskUser(mockPi);
    mockPrompt.mockRejectedValueOnce(new Error('interrupted'));

    const result = await capturedConfig.execute({ question: 'What is your name?' });

    expect(result).toBe('(interrupted \u2014 no answer provided)');
  });

  // ---------------------------------------------------------------------------
  // 7. AbortError handling
  // ---------------------------------------------------------------------------
  it('resolves to the interrupted string when error.name === "AbortError"', async () => {
    registerAskUser(mockPi);
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mockPrompt.mockRejectedValueOnce(abortError);

    const result = await capturedConfig.execute({ question: 'Continue?' });

    expect(result).toBe('(interrupted \u2014 no answer provided)');
  });

  // ---------------------------------------------------------------------------
  // 8. Other errors propagate
  // ---------------------------------------------------------------------------
  it('re-throws errors that are not interruption-related', async () => {
    registerAskUser(mockPi);
    const networkError = new Error('network error');
    mockPrompt.mockRejectedValueOnce(networkError);

    await expect(capturedConfig.execute({ question: 'What is your name?' })).rejects.toThrow(
      'network error',
    );
  });
});
