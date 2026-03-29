/**
 * TRD-010-TEST: --validate flag catches malformed artifacts
 *
 * Tests that validateResults() (called inside generate() when validate: true)
 * correctly accepts well-formed artifacts and rejects malformed ones.
 *
 * Strategy: mock glob (returns no command/agent files so the loop bodies are
 * skipped), mock copySkills and generateAgentsMd to inject controlled
 * TransformResult objects, then observe whether generate() resolves or rejects.
 */

import * as path from 'path';

// --- Mocks must be declared before imports that use them ---

jest.mock('glob', () => ({
  glob: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/transformers/skill-copier', () => ({
  copySkills: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/transformers/agent-transformer', () => ({
  buildAgentResult: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue(''),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
  };
});

// Mock generateAgentsMd so we control what ends up in results
jest.mock('../src/generator', () => {
  const actual = jest.requireActual<typeof import('../src/generator')>('../src/generator');
  return {
    ...actual,
    generateAgentsMd: jest.fn(),
  };
});

import { generate } from '../src/generator';
import { copySkills } from '../src/transformers/skill-copier';
import { TransformResult } from '../src/types';

// Helper that returns a well-formed agent TransformResult
function makeAgentResult(overrides: Partial<TransformResult> = {}): TransformResult {
  return {
    sourcePath: '/fake/src/agent.yaml',
    outputPath: '/fake/out/agents/foo.md',
    content: '---\nname: foo\ndescription: bar\n---\n# foo\n\nBody content.',
    type: 'agent',
    ...overrides,
  };
}

// Helper that returns a well-formed command TransformResult
function makeCommandResult(overrides: Partial<TransformResult> = {}): TransformResult {
  return {
    sourcePath: '/fake/src/command.yaml',
    outputPath: '/fake/out/prompts/ensemble-cmd.md',
    content: '# Some Title\n\nCommand instructions.',
    type: 'command',
    ...overrides,
  };
}

// Shared generate() options — dry-run so no real I/O
const BASE_OPTIONS = {
  dryRun: true,
  verbose: false,
  validate: true,
  sourceRoot: '/fake/src',
  outputRoot: '/fake/out',
};

// Helper to set the copySkills mock return value
function injectResults(results: TransformResult[]): void {
  (copySkills as jest.Mock).mockResolvedValueOnce(results);
}

// Re-import the mocked generateAgentsMd so we can control its output
import * as generatorModule from '../src/generator';

// generateAgentsMd is already mocked at the module level; we need to make it
// return a result that passes validation by default.
function setupAgentsMdMock(result: TransformResult): void {
  (generatorModule.generateAgentsMd as jest.Mock).mockReturnValueOnce(result);
}

const GOOD_AGENTS_MD: TransformResult = {
  sourcePath: '/fake/src/CLAUDE.md',
  outputPath: '/fake/out/AGENTS.md',
  content: '# Ensemble Agent Mesh\n\nContent.',
  type: 'agents-md',
};

// ============================================================================
// Test cases
// ============================================================================

describe('--validate flag: agent artifact validation', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  test('valid agent artifact passes validation', async () => {
    injectResults([makeAgentResult()]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    await expect(generate(BASE_OPTIONS)).resolves.toBeUndefined();
  });

  test('agent missing frontmatter name field: throws "Validation failed" and logs specific error to stderr', async () => {
    const badAgent = makeAgentResult({
      content: '---\ndescription: bar\n---\n# foo\n\nBody.',
    });
    injectResults([badAgent]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    await expect(generate(BASE_OPTIONS)).rejects.toThrow(/Validation failed/);

    // The specific field error is written to stderr by validateResults
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrOutput).toMatch(/missing frontmatter field 'name'/);
  });

  test('agent missing frontmatter description field: throws "Validation failed" and logs specific error to stderr', async () => {
    const badAgent = makeAgentResult({
      content: '---\nname: foo\n---\n# foo\n\nBody.',
    });
    injectResults([badAgent]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    await expect(generate(BASE_OPTIONS)).rejects.toThrow(/Validation failed/);

    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrOutput).toMatch(/missing frontmatter field 'description'/);
  });
});

describe('--validate flag: command artifact validation', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  test('valid command artifact passes validation', async () => {
    injectResults([makeCommandResult()]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    await expect(generate(BASE_OPTIONS)).resolves.toBeUndefined();
  });

  test('command missing H1 heading: throws "Validation failed" and logs "missing H1 heading" to stderr', async () => {
    const badCommand = makeCommandResult({
      content: 'No heading here, just some text.',
    });
    injectResults([badCommand]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    await expect(generate(BASE_OPTIONS)).rejects.toThrow(/Validation failed/);

    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrOutput).toMatch(/missing H1 heading/);
  });
});

describe('--validate flag: empty content', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('agent artifact with empty content throws', async () => {
    const emptyAgent = makeAgentResult({ content: '   ' });
    injectResults([emptyAgent]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    await expect(generate(BASE_OPTIONS)).rejects.toThrow(/Validation failed/);
  });

  test('command artifact with empty content throws', async () => {
    const emptyCommand = makeCommandResult({ content: '' });
    injectResults([emptyCommand]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    await expect(generate(BASE_OPTIONS)).rejects.toThrow(/Validation failed/);
  });
});

describe('--validate flag: multiple errors are collected', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('multiple failing artifacts report all errors in a single throw', async () => {
    const badAgent = makeAgentResult({
      outputPath: '/fake/out/agents/bad1.md',
      content: '---\ndescription: no-name\n---\n# body',
    });
    const badCommand = makeCommandResult({
      outputPath: '/fake/out/prompts/bad2.md',
      content: 'no heading here',
    });
    injectResults([badAgent, badCommand]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    let thrownError: Error | undefined;
    try {
      await generate(BASE_OPTIONS);
    } catch (e) {
      thrownError = e as Error;
    }

    expect(thrownError).toBeDefined();
    // The error message reports the total count of validation errors
    expect(thrownError!.message).toMatch(/Validation failed: \d+ error\(s\)/);
    // Count must be ≥ 2 (at least one from each failing artifact)
    const match = thrownError!.message.match(/Validation failed: (\d+) error\(s\)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBeGreaterThanOrEqual(2);
  });
});

describe('--validate flag: disabled when validate=false', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('bad artifact does NOT throw when validate flag is false', async () => {
    const badAgent = makeAgentResult({
      content: '---\ndescription: no-name\n---\n# body',
    });
    injectResults([badAgent]);
    setupAgentsMdMock(GOOD_AGENTS_MD);

    const noValidateOptions = { ...BASE_OPTIONS, validate: false };
    await expect(generate(noValidateOptions)).resolves.toBeUndefined();
  });
});
