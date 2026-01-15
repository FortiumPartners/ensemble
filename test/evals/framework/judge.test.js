/**
 * judge.js - Unit Tests
 * TRD Task: TRD-TEST-070
 *
 * Tests for the judging component that uses Claude Opus to score
 * collected code against rubrics.
 *
 * Following TDD methodology - write tests first.
 */

const path = require('path');

describe('judge.js', () => {
  let judge;
  let mockFs;
  let mockSpawnSync;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Setup mocks before requiring module
    mockFs = {
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      mkdirSync: jest.fn(),
      readdirSync: jest.fn().mockReturnValue([]),
      statSync: jest.fn().mockReturnValue({ isFile: () => true, isDirectory: () => false })
    };

    mockSpawnSync = jest.fn();

    jest.doMock('fs', () => mockFs);
    jest.doMock('child_process', () => ({ spawnSync: mockSpawnSync }));

    // Suppress console output during tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Require fresh module with mocks
    judge = require('./judge');
  });

  afterEach(() => {
    jest.resetModules();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('parseArgs', () => {
    it('should parse session directory as first positional argument', () => {
      const args = judge.parseArgs(['./results/session-123', 'code-quality']);

      expect(args.sessionDir).toBe('./results/session-123');
    });

    it('should parse rubric as second positional argument', () => {
      const args = judge.parseArgs(['./results/session-123', 'code-quality']);

      expect(args.rubric).toBe('code-quality');
    });

    it('should parse --rubrics-dir flag', () => {
      const args = judge.parseArgs([
        './results/session-123',
        'code-quality',
        '--rubrics-dir',
        '/custom/rubrics'
      ]);

      expect(args.rubricsDir).toBe('/custom/rubrics');
    });

    it('should parse --output-dir flag', () => {
      const args = judge.parseArgs([
        './results/session-123',
        'code-quality',
        '--output-dir',
        '/custom/output'
      ]);

      expect(args.outputDir).toBe('/custom/output');
    });

    it('should parse --all flag', () => {
      const args = judge.parseArgs(['./results/session-123', '--all']);

      expect(args.all).toBe(true);
    });

    it('should parse --context flag with file path', () => {
      const args = judge.parseArgs([
        './results/session-123',
        'test-quality',
        '--context',
        './source.py'
      ]);

      expect(args.context).toBe('./source.py');
    });

    it('should parse --retries flag with numeric value', () => {
      const args = judge.parseArgs([
        './results/session-123',
        'code-quality',
        '--retries',
        '5'
      ]);

      expect(args.retries).toBe(5);
    });

    it('should parse --quiet flag', () => {
      const args = judge.parseArgs([
        './results/session-123',
        'code-quality',
        '--quiet'
      ]);

      expect(args.quiet).toBe(true);
    });

    it('should parse --dry-run flag', () => {
      const args = judge.parseArgs([
        './results/session-123',
        'code-quality',
        '--dry-run'
      ]);

      expect(args.dryRun).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = judge.parseArgs(['--help']);

      expect(args.help).toBe(true);
    });

    it('should use default values when flags not provided', () => {
      const args = judge.parseArgs(['./results/session-123', 'code-quality']);

      expect(args.retries).toBe(3); // default
      expect(args.quiet).toBe(false);
      expect(args.dryRun).toBe(false);
      expect(args.all).toBe(false);
    });
  });

  describe('loadRubric', () => {
    it('should load rubric markdown from file path', () => {
      const rubricContent = `# Code Quality Rubric\n\n## Scoring Scale\n...`;
      mockFs.readFileSync.mockReturnValue(rubricContent);

      const rubric = judge.loadRubric('/path/to/code-quality.md');

      expect(rubric).toBe(rubricContent);
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        '/path/to/code-quality.md',
        'utf8'
      );
    });

    it('should load rubric by name from rubrics directory', () => {
      const rubricContent = `# Error Handling Rubric`;
      mockFs.existsSync.mockImplementation((p) => p.endsWith('.md'));
      mockFs.readFileSync.mockReturnValue(rubricContent);

      const rubric = judge.loadRubric('error-handling', '/rubrics');

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/error-handling\.md$/),
        'utf8'
      );
    });

    it('should throw error for non-existent rubric', () => {
      mockFs.existsSync.mockReturnValue(false);

      expect(() => {
        judge.loadRubric('nonexistent', '/rubrics');
      }).toThrow(/rubric.*not found|does not exist/i);
    });
  });

  describe('loadSessionFiles', () => {
    it('should load code files from session directory', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py', 'utils.py'];
        return [];
      });
      mockFs.readFileSync.mockImplementation((filepath) => {
        if (filepath.includes('calc.py')) return 'def add(a, b): return a + b';
        if (filepath.includes('utils.py')) return 'def helper(): pass';
        return '';
      });

      const files = judge.loadSessionFiles('./results/session-123');

      expect(files).toHaveProperty('code');
      expect(files.code).toHaveLength(2);
    });

    it('should load test files separately from code files', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        if (dir.includes('tests')) return ['test_calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const files = judge.loadSessionFiles('./results/session-123');

      expect(files).toHaveProperty('tests');
      expect(files.tests).toHaveLength(1);
    });

    it('should return empty arrays for empty directories', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);

      const files = judge.loadSessionFiles('./results/session-123');

      expect(files.code).toEqual([]);
      expect(files.tests).toEqual([]);
    });
  });

  describe('buildPrompt', () => {
    it('should construct prompt from rubric template and code content', () => {
      const rubric = `# Code Quality Rubric\n## Evaluation Prompt Template\n\`\`\`\n{code_content}\n\`\`\``;
      const codeFiles = [{ filename: 'calc.py', content: 'def add(a, b): return a + b' }];

      const prompt = judge.buildPrompt(rubric, codeFiles);

      expect(prompt).toContain('def add(a, b): return a + b');
      expect(prompt).toContain('calc.py');
    });

    it('should include multiple files in prompt', () => {
      const rubric = `# Rubric`;
      const codeFiles = [
        { filename: 'file1.py', content: 'code1' },
        { filename: 'file2.py', content: 'code2' }
      ];

      const prompt = judge.buildPrompt(rubric, codeFiles);

      expect(prompt).toContain('file1.py');
      expect(prompt).toContain('file2.py');
      expect(prompt).toContain('code1');
      expect(prompt).toContain('code2');
    });

    it('should include context file when provided', () => {
      const rubric = `# Test Quality Rubric`;
      const testFiles = [{ filename: 'test_calc.py', content: 'def test_add(): assert add(1, 2) == 3' }];
      const contextContent = 'def add(a, b): return a + b';

      const prompt = judge.buildPrompt(rubric, testFiles, { context: contextContent });

      expect(prompt).toContain('test_add');
      expect(prompt).toContain(contextContent);
    });
  });

  describe('invokeClaude', () => {
    it('should call claude CLI with correct arguments', () => {
      const mockResponse = JSON.stringify({
        score: 4,
        justification: 'Good code quality',
        strengths: ['Clear naming'],
        weaknesses: ['Could use more comments']
      });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      const prompt = 'Evaluate this code...';
      judge.invokeClaude(prompt);

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', prompt]),
        expect.objectContaining({ encoding: 'utf8' })
      );
    });

    it('should use opus model', () => {
      const mockResponse = JSON.stringify({ score: 3 });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      judge.invokeClaude('test prompt');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--model', expect.stringMatching(/opus/i)]),
        expect.any(Object)
      );
    });

    it('should request JSON output format', () => {
      const mockResponse = JSON.stringify({ score: 3 });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      judge.invokeClaude('test prompt');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['--output-format', 'json']),
        expect.any(Object)
      );
    });

    it('should parse JSON response', () => {
      const mockResponse = JSON.stringify({
        score: 4,
        justification: 'Well-structured code',
        dimension_scores: { readability: 4, maintainability: 5 }
      });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      const result = judge.invokeClaude('test prompt');

      expect(result).toHaveProperty('score', 4);
      expect(result).toHaveProperty('justification');
    });

    it('should retry on API error up to max retries', () => {
      mockSpawnSync
        .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'API Error', error: null })
        .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'API Error', error: null })
        .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ score: 3 }), stderr: '', error: null });

      const result = judge.invokeClaude('test prompt', { retries: 3 });

      expect(mockSpawnSync).toHaveBeenCalledTimes(3);
      expect(result).toHaveProperty('score', 3);
    });

    it('should throw after exhausting retries', () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'API Error',
        error: null
      });

      expect(() => {
        judge.invokeClaude('test prompt', { retries: 2 });
      }).toThrow(/failed|retry|exhausted/i);
    });

    it('should handle spawn errors', () => {
      mockSpawnSync.mockReturnValue({
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('ENOENT: command not found')
      });

      expect(() => {
        judge.invokeClaude('test prompt', { retries: 1 });
      }).toThrow(/failed|retry|exhausted/i);
    });
  });

  describe('invokeClaude security', () => {
    it('should safely handle prompts with shell metacharacters', () => {
      const maliciousPrompt = 'test $(rm -rf /) `whoami`';
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ score: 3 }),
        stderr: '',
        error: null
      });

      const result = judge.invokeClaude(maliciousPrompt);

      // Verify prompt was passed directly without shell interpretation
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', maliciousPrompt]),
        expect.any(Object)
      );
      expect(result).toHaveProperty('score', 3);
    });

    it('should safely handle prompts with quotes', () => {
      const promptWithQuotes = 'Evaluate code: print("Hello\'s World")';
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ score: 4 }),
        stderr: '',
        error: null
      });

      judge.invokeClaude(promptWithQuotes);

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', promptWithQuotes]),
        expect.any(Object)
      );
    });

    it('should safely handle prompts with newlines and special characters', () => {
      const complexPrompt = 'Line1\nLine2\tTabbed\r\n$PATH; echo "pwned"';
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ score: 3 }),
        stderr: '',
        error: null
      });

      judge.invokeClaude(complexPrompt);

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', complexPrompt]),
        expect.any(Object)
      );
    });
  });

  describe('extractScore', () => {
    it('should extract overall score from response', () => {
      const response = {
        score: 4,
        justification: 'Good quality',
        dimension_scores: {
          readability: 4,
          maintainability: 5,
          correctness: 4,
          best_practices: 3
        }
      };

      const result = judge.extractScore(response);

      expect(result.overall).toBe(4);
    });

    it('should extract dimension scores when present', () => {
      const response = {
        score: 4,
        dimension_scores: {
          readability: 4,
          maintainability: 5
        }
      };

      const result = judge.extractScore(response);

      expect(result.dimensions).toEqual({
        readability: 4,
        maintainability: 5
      });
    });

    it('should handle response without dimension scores', () => {
      const response = {
        score: 3,
        justification: 'Acceptable'
      };

      const result = judge.extractScore(response);

      expect(result.overall).toBe(3);
      expect(result.dimensions).toEqual({});
    });

    it('should validate score is within 1-5 range', () => {
      const invalidResponse = {
        score: 10,
        justification: 'Invalid score'
      };

      expect(() => {
        judge.extractScore(invalidResponse);
      }).toThrow(/invalid|score|range/i);
    });
  });

  describe('saveScore', () => {
    it('should save score to JSON file in scores directory', () => {
      const scoreData = {
        rubric: 'code-quality',
        session_id: 'session-123',
        scores: { overall: 4, dimensions: {} },
        justification: 'Good code'
      };

      judge.saveScore('./results/session-123', 'code-quality', scoreData);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/scores.*code-quality\.json$/),
        expect.any(String)
      );
    });

    it('should create scores directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      judge.saveScore('./results/session-123', 'code-quality', {});

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/scores/),
        expect.objectContaining({ recursive: true })
      );
    });

    it('should include metadata in saved score', () => {
      const scoreData = {
        scores: { overall: 4 },
        justification: 'Good'
      };

      judge.saveScore('./results/session-123', 'code-quality', scoreData);

      const writtenContent = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      expect(writtenContent).toHaveProperty('rubric', 'code-quality');
      expect(writtenContent).toHaveProperty('session_id', 'session-123');
      expect(writtenContent).toHaveProperty('judged_at');
      expect(writtenContent).toHaveProperty('model');
    });
  });

  describe('listRubrics', () => {
    it('should list available rubrics in rubrics directory', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'code-quality.md',
        'error-handling.md',
        'test-quality.md'
      ]);

      const rubrics = judge.listRubrics('/rubrics');

      expect(rubrics).toContain('code-quality');
      expect(rubrics).toContain('error-handling');
      expect(rubrics).toContain('test-quality');
    });

    it('should filter non-markdown files', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'code-quality.md',
        'README.txt',
        '.gitkeep'
      ]);

      const rubrics = judge.listRubrics('/rubrics');

      expect(rubrics).toContain('code-quality');
      expect(rubrics).not.toContain('README');
      expect(rubrics).not.toContain('.gitkeep');
    });
  });

  describe('run', () => {
    it('should show help when --help flag provided', async () => {
      const result = await judge.run(['--help']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/usage|options|arguments/i)
      );
      expect(result.exitCode).toBe(0);
    });

    it('should exit with error when no session directory provided', async () => {
      const result = await judge.run([]);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/session.*dir|argument|required/i);
    });

    it('should exit with error when no rubric specified and --all not provided', async () => {
      const result = await judge.run(['./results/session-123']);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/rubric|required|--all/i);
    });

    it('should judge with all rubrics when --all flag provided', async () => {
      // Setup rubrics directory
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('rubrics')) return ['code-quality.md', 'error-handling.md'];
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const mockResponse = JSON.stringify({
        score: 4,
        justification: 'Good',
        strengths: [],
        weaknesses: []
      });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      await judge.run(['./results/session-123', '--all']);

      // Should invoke claude for each rubric
      expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    });

    it('should not invoke Claude in dry-run mode', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const result = await judge.run([
        './results/session-123',
        'code-quality',
        '--dry-run'
      ]);

      expect(mockSpawnSync).not.toHaveBeenCalled();
      expect(result.exitCode).toBe(0);
    });

    it('should print prompt in dry-run mode', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('# Rubric content');

      await judge.run(['./results/session-123', 'code-quality', '--dry-run']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/prompt|dry.*run/i)
      );
    });

    it('should return exit code 0 on success', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const mockResponse = JSON.stringify({
        score: 4,
        justification: 'Good',
        strengths: [],
        weaknesses: []
      });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      const result = await judge.run(['./results/session-123', 'code-quality']);

      expect(result.exitCode).toBe(0);
    });

    it('should save scores to output directory', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const mockResponse = JSON.stringify({
        score: 4,
        justification: 'Good',
        strengths: ['Clear naming'],
        weaknesses: []
      });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      await judge.run(['./results/session-123', 'code-quality']);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/scores.*code-quality\.json/),
        expect.any(String)
      );
    });

    it('should use custom output directory when provided', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const mockResponse = JSON.stringify({
        score: 4,
        justification: 'Good',
        strengths: [],
        weaknesses: []
      });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      await judge.run([
        './results/session-123',
        'code-quality',
        '--output-dir',
        '/custom/output'
      ]);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/custom\/output.*code-quality\.json/),
        expect.any(String)
      );
    });
  });

  describe('output format', () => {
    it('should include required fields in score output', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py', 'utils.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const mockResponse = JSON.stringify({
        score: 4,
        justification: 'Well-structured code with clear naming conventions.',
        dimension_scores: {
          readability: 4,
          maintainability: 5,
          correctness: 4,
          best_practices: 3
        },
        strengths: ['Clear function naming', 'Good separation of concerns'],
        weaknesses: ['Missing docstrings']
      });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      await judge.run(['./results/session-123', 'code-quality']);

      const writtenContent = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);

      expect(writtenContent).toHaveProperty('rubric', 'code-quality');
      expect(writtenContent).toHaveProperty('session_id', 'session-123');
      expect(writtenContent).toHaveProperty('judged_at');
      expect(writtenContent).toHaveProperty('model');
      expect(writtenContent).toHaveProperty('files_judged');
      expect(writtenContent).toHaveProperty('scores');
      expect(writtenContent.scores).toHaveProperty('overall', 4);
      expect(writtenContent.scores).toHaveProperty('dimensions');
      expect(writtenContent).toHaveProperty('justification');
      expect(writtenContent).toHaveProperty('strengths');
      expect(writtenContent).toHaveProperty('weaknesses');
      expect(writtenContent).toHaveProperty('raw_response');
    });

    it('should include list of judged files', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py', 'utils.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const mockResponse = JSON.stringify({ score: 4, strengths: [], weaknesses: [] });
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: mockResponse,
        stderr: '',
        error: null
      });

      await judge.run(['./results/session-123', 'code-quality']);

      const writtenContent = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);

      expect(writtenContent.files_judged).toContain('calc.py');
      expect(writtenContent.files_judged).toContain('utils.py');
    });
  });

  describe('error handling', () => {
    it('should handle session directory not found', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await judge.run(['./nonexistent/session', 'code-quality']);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/session.*not found|does not exist/i);
    });

    it('should handle rubric not found', async () => {
      mockFs.existsSync.mockImplementation((filepath) => {
        // Session directory exists
        if (filepath.includes('session-123') && !filepath.includes('.md')) return true;
        // Code directory exists
        if (filepath.includes('code')) return true;
        // Rubric file does not exist
        if (filepath.includes('nonexistent') || filepath.includes('.md')) return false;
        return true;
      });
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      const result = await judge.run(['./results/session-123', 'nonexistent-rubric']);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/rubric.*not found/i);
    });

    it('should handle empty session (no files to judge)', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([]);
      mockFs.readFileSync.mockReturnValue('# Rubric');

      const result = await judge.run(['./results/session-123', 'code-quality']);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/no files|empty/i);
    });

    it('should handle invalid JSON response from Claude', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir.includes('code')) return ['calc.py'];
        return [];
      });
      mockFs.readFileSync.mockReturnValue('content');

      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'not valid json',
        stderr: '',
        error: null
      });

      const result = await judge.run(['./results/session-123', 'code-quality']);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/json|parse|response/i);
    });
  });

  describe('loadRubric security', () => {
    it('should sanitize path traversal attempts by extracting basename', () => {
      // The implementation sanitizes by stripping .. and extracting basename
      // ../../etc/passwd -> passwd -> /test/rubrics/passwd.md
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('# Rubric content');

      // This should NOT access /etc/passwd, but instead look for passwd.md in rubrics dir
      judge.loadRubric('../../etc/passwd', '/test/rubrics');

      // Verify it looked in the safe location, not the traversed path
      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/test\/rubrics\/passwd\.md$/),
        'utf8'
      );
    });

    it('should sanitize deeper path traversal by extracting basename', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('# Rubric content');

      // ../../../etc/shadow -> shadow -> /test/rubrics/shadow.md
      judge.loadRubric('../../../etc/shadow', '/test/rubrics');

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/test\/rubrics\/shadow\.md$/),
        'utf8'
      );
    });

    it('should sanitize rubric names with path separators by extracting basename', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('# Rubric content');

      // foo/../../../etc/passwd -> passwd -> /test/rubrics/passwd.md
      judge.loadRubric('foo/../../../etc/passwd', '/test/rubrics');

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\/test\/rubrics\/passwd\.md$/),
        'utf8'
      );
    });

    it('should allow legitimate rubric names', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('# Valid Rubric');

      // Should not throw
      const content = judge.loadRubric('code-quality', '/test/rubrics');
      expect(content).toBe('# Valid Rubric');
    });

    it('should allow explicit .md file paths', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('# Rubric from file path');

      // Explicit .md paths should work (user takes responsibility)
      const content = judge.loadRubric('/some/path/rubric.md');
      expect(content).toBe('# Rubric from file path');
    });
  });
});
