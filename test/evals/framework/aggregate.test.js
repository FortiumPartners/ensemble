/**
 * aggregate.js - Unit Tests
 * TRD Task: TRD-TEST-071
 *
 * Tests for the score aggregation and report generation component.
 * Following TDD methodology - write tests first.
 */

const path = require('path');

describe('aggregate.js', () => {
  let aggregate;
  let mockFs;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Setup mocks before requiring module
    mockFs = {
      existsSync: jest.fn().mockReturnValue(true),
      readdirSync: jest.fn(),
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      statSync: jest.fn()
    };

    jest.doMock('fs', () => mockFs);

    // Require fresh module with mocks
    aggregate = require('./aggregate');
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('parseArgs', () => {
    it('should parse eval results directory as first positional argument', () => {
      const args = aggregate.parseArgs(['results/my-eval']);

      expect(args.resultsDir).toBe('results/my-eval');
    });

    it('should parse --output flag with file path', () => {
      const args = aggregate.parseArgs(['results/', '--output', 'custom-report.md']);

      expect(args.output).toBe('custom-report.md');
    });

    it('should parse --format flag with markdown option', () => {
      const args = aggregate.parseArgs(['results/', '--format', 'markdown']);

      expect(args.format).toBe('markdown');
    });

    it('should parse --format flag with json option', () => {
      const args = aggregate.parseArgs(['results/', '--format', 'json']);

      expect(args.format).toBe('json');
    });

    it('should parse --format flag with both option', () => {
      const args = aggregate.parseArgs(['results/', '--format', 'both']);

      expect(args.format).toBe('both');
    });

    it('should parse --significance flag with numeric value', () => {
      const args = aggregate.parseArgs(['results/', '--significance', '0.01']);

      expect(args.significance).toBe(0.01);
    });

    it('should parse --quiet flag', () => {
      const args = aggregate.parseArgs(['results/', '--quiet']);

      expect(args.quiet).toBe(true);
    });

    it('should parse --help flag', () => {
      const args = aggregate.parseArgs(['--help']);

      expect(args.help).toBe(true);
    });

    it('should use default values when flags not provided', () => {
      const args = aggregate.parseArgs(['results/']);

      expect(args.format).toBe('markdown');
      expect(args.significance).toBe(0.05);
      expect(args.quiet).toBe(false);
    });
  });

  describe('collectScores', () => {
    it('should scan eval results directory for score files', () => {
      mockFs.readdirSync.mockReturnValue(['with-skill', 'without-skill']);
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scores: [{ rubric: 'code-quality', score: 4 }]
      }));

      const scores = aggregate.collectScores('/results/my-eval');

      expect(mockFs.readdirSync).toHaveBeenCalledWith('/results/my-eval');
    });

    it('should group scores by variant', () => {
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir === '/results/my-eval') {
          return ['with-skill', 'without-skill'];
        }
        return ['session-abc'];
      });
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scores: [
          { rubric: 'code-quality', score: 4 },
          { rubric: 'test-quality', score: 3 }
        ]
      }));

      const scores = aggregate.collectScores('/results/my-eval');

      expect(scores).toHaveProperty('with-skill');
      expect(scores).toHaveProperty('without-skill');
    });

    it('should collect multiple sessions per variant', () => {
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir === '/results/my-eval') {
          return ['with-skill'];
        }
        return ['session-abc', 'session-def', 'session-ghi'];
      });
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scores: [{ rubric: 'code-quality', score: 4 }]
      }));

      const scores = aggregate.collectScores('/results/my-eval');

      expect(scores['with-skill'].sessions).toHaveLength(3);
    });

    it('should support multiple rubrics per session', () => {
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir === '/results/my-eval') {
          return ['with-skill'];
        }
        return ['session-abc'];
      });
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        scores: [
          { rubric: 'code-quality', score: 4 },
          { rubric: 'test-quality', score: 5 },
          { rubric: 'error-handling', score: 3 }
        ]
      }));

      const scores = aggregate.collectScores('/results/my-eval');
      const session = scores['with-skill'].sessions[0];

      expect(session.scores).toHaveProperty('code-quality');
      expect(session.scores).toHaveProperty('test-quality');
      expect(session.scores).toHaveProperty('error-handling');
    });

    it('should handle missing score files gracefully', () => {
      mockFs.readdirSync.mockImplementation((dir) => {
        if (dir === '/results/my-eval') {
          return ['with-skill'];
        }
        return ['session-abc'];
      });
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });
      mockFs.existsSync.mockReturnValue(false);

      const scores = aggregate.collectScores('/results/my-eval');

      // Should not throw, session should be empty or skipped
      expect(scores['with-skill'].sessions).toHaveLength(0);
    });
  });

  describe('calculateStatistics', () => {
    it('should calculate mean for a set of scores', () => {
      const scores = [4, 5, 3, 4, 4];

      const stats = aggregate.calculateStatistics(scores);

      expect(stats.mean).toBe(4);
    });

    it('should calculate median for odd number of scores', () => {
      const scores = [3, 5, 4, 2, 1];

      const stats = aggregate.calculateStatistics(scores);

      expect(stats.median).toBe(3);
    });

    it('should calculate median for even number of scores', () => {
      const scores = [3, 5, 4, 2];

      const stats = aggregate.calculateStatistics(scores);

      expect(stats.median).toBe(3.5);
    });

    it('should calculate sample standard deviation', () => {
      const scores = [2, 4, 4, 4, 5, 5, 7, 9];

      const stats = aggregate.calculateStatistics(scores);

      // Sample stddev of [2,4,4,4,5,5,7,9] - mean is 5, sample variance is 4.57
      // Sample stddev is sqrt(4.57) = 2.14
      expect(stats.stddev).toBeCloseTo(2.14, 1);
    });

    it('should calculate min and max', () => {
      const scores = [3, 1, 4, 1, 5, 9, 2, 6];

      const stats = aggregate.calculateStatistics(scores);

      expect(stats.min).toBe(1);
      expect(stats.max).toBe(9);
    });

    it('should handle single score', () => {
      const scores = [4];

      const stats = aggregate.calculateStatistics(scores);

      expect(stats.mean).toBe(4);
      expect(stats.median).toBe(4);
      expect(stats.stddev).toBe(0);
      expect(stats.min).toBe(4);
      expect(stats.max).toBe(4);
    });

    it('should handle empty array', () => {
      const scores = [];

      const stats = aggregate.calculateStatistics(scores);

      expect(stats.mean).toBe(0);
      expect(stats.stddev).toBe(0);
    });
  });

  describe('aggregateByVariant', () => {
    it('should calculate per-variant statistics', () => {
      const collectedScores = {
        'with-skill': {
          sessions: [
            { sessionId: 'abc', scores: { 'code-quality': 4 } },
            { sessionId: 'def', scores: { 'code-quality': 5 } },
            { sessionId: 'ghi', scores: { 'code-quality': 4 } }
          ]
        }
      };

      const aggregated = aggregate.aggregateByVariant(collectedScores);

      expect(aggregated['with-skill'].sessions).toBe(3);
      expect(aggregated['with-skill'].overall.mean).toBeCloseTo(4.33, 1);
    });

    it('should calculate per-rubric statistics', () => {
      const collectedScores = {
        'with-skill': {
          sessions: [
            { sessionId: 'abc', scores: { 'code-quality': 4, 'test-quality': 5 } },
            { sessionId: 'def', scores: { 'code-quality': 5, 'test-quality': 4 } }
          ]
        }
      };

      const aggregated = aggregate.aggregateByVariant(collectedScores);

      expect(aggregated['with-skill'].by_rubric).toHaveProperty('code-quality');
      expect(aggregated['with-skill'].by_rubric).toHaveProperty('test-quality');
      expect(aggregated['with-skill'].by_rubric['code-quality'].mean).toBe(4.5);
      expect(aggregated['with-skill'].by_rubric['test-quality'].mean).toBe(4.5);
    });
  });

  describe('compareVariants', () => {
    it('should calculate difference between variant means', () => {
      const aggregated = {
        'with-skill': { overall: { mean: 4.2 }, sessions: 5 },
        'without-skill': { overall: { mean: 3.1 }, sessions: 5 }
      };

      const comparison = aggregate.compareVariants(aggregated);

      expect(comparison.difference).toBeCloseTo(1.1, 1);
    });

    it('should calculate percent improvement', () => {
      const aggregated = {
        'with-skill': { overall: { mean: 4.2 }, sessions: 5 },
        'without-skill': { overall: { mean: 3.1 }, sessions: 5 }
      };

      const comparison = aggregate.compareVariants(aggregated);

      // (4.2 - 3.1) / 3.1 * 100 = 35.5%
      expect(comparison.percent_improvement).toBeCloseTo(35.5, 0);
    });

    it('should determine statistical significance', () => {
      const aggregated = {
        'with-skill': {
          overall: { mean: 4.2, stddev: 0.4 },
          sessions: 5,
          raw_scores: [4, 4.5, 4.2, 4.3, 4]
        },
        'without-skill': {
          overall: { mean: 3.1, stddev: 0.7 },
          sessions: 5,
          raw_scores: [3, 3.5, 2.8, 3.2, 3]
        }
      };

      const comparison = aggregate.compareVariants(aggregated, 0.05);

      expect(comparison).toHaveProperty('p_value');
      expect(comparison).toHaveProperty('significant');
    });

    it('should handle single variant gracefully', () => {
      const aggregated = {
        'with-skill': { overall: { mean: 4.2 }, sessions: 5 }
      };

      const comparison = aggregate.compareVariants(aggregated);

      expect(comparison).toBe(null);
    });
  });

  describe('generateMarkdownReport', () => {
    it('should include summary table with variant scores', () => {
      const data = {
        eval_name: 'developing-with-python',
        variants: {
          'with-skill': { sessions: 5, overall: { mean: 4.2, stddev: 0.4 } },
          'without-skill': { sessions: 5, overall: { mean: 3.1, stddev: 0.7 } }
        },
        comparison: { difference: 1.1, percent_improvement: 35 }
      };

      const report = aggregate.generateMarkdownReport(data);

      expect(report).toContain('# Evaluation Report');
      expect(report).toContain('with-skill');
      expect(report).toContain('without-skill');
      expect(report).toContain('4.2');
      expect(report).toContain('3.1');
    });

    it('should include per-rubric analysis section', () => {
      const data = {
        eval_name: 'test-eval',
        variants: {
          'with-skill': {
            sessions: 3,
            overall: { mean: 4.0 },
            by_rubric: {
              'code-quality': { mean: 4.4, median: 4, min: 4, max: 5 },
              'test-quality': { mean: 3.8, median: 4, min: 3, max: 4 }
            }
          }
        }
      };

      const report = aggregate.generateMarkdownReport(data);

      expect(report).toContain('Per-Rubric Analysis');
      expect(report).toContain('code-quality');
      expect(report).toContain('test-quality');
    });

    it('should include raw scores section', () => {
      const data = {
        eval_name: 'test-eval',
        variants: {
          'with-skill': {
            sessions: 2,
            overall: { mean: 4.0 },
            by_rubric: {},
            raw_sessions: [
              { sessionId: 'abc123', scores: { 'code-quality': 4 } },
              { sessionId: 'def456', scores: { 'code-quality': 5 } }
            ]
          }
        }
      };

      const report = aggregate.generateMarkdownReport(data);

      expect(report).toContain('Raw Scores');
      expect(report).toContain('abc123');
      expect(report).toContain('def456');
    });

    it('should include methodology section', () => {
      const data = {
        eval_name: 'test-eval',
        generated_at: '2026-01-13T11:00:00Z',
        variants: {
          'with-skill': { sessions: 5, overall: { mean: 4.0 } }
        },
        methodology: {
          model: 'claude-opus-4-5-20251101',
          rubrics: ['code-quality', 'test-quality']
        }
      };

      const report = aggregate.generateMarkdownReport(data);

      expect(report).toContain('Methodology');
      expect(report).toContain('claude-opus');
      expect(report).toContain('2026-01-13');
    });

    it('should highlight significant differences', () => {
      const data = {
        eval_name: 'test-eval',
        variants: {
          'with-skill': { sessions: 5, overall: { mean: 4.2 } },
          'without-skill': { sessions: 5, overall: { mean: 3.1 } }
        },
        comparison: {
          difference: 1.1,
          percent_improvement: 35,
          p_value: 0.02,
          significant: true
        }
      };

      const report = aggregate.generateMarkdownReport(data);

      expect(report).toMatch(/significant|statistically/i);
      expect(report).toContain('35%');
    });
  });

  describe('generateJsonOutput', () => {
    it('should include eval_name and generated_at', () => {
      const data = {
        eval_name: 'developing-with-python',
        variants: {},
        comparison: null
      };

      const output = aggregate.generateJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.eval_name).toBe('developing-with-python');
      expect(parsed).toHaveProperty('generated_at');
    });

    it('should include variants with statistics', () => {
      const data = {
        eval_name: 'test-eval',
        variants: {
          'with-skill': {
            sessions: 5,
            overall: { mean: 4.2, stddev: 0.4, median: 4, min: 4, max: 5 },
            by_rubric: {
              'code-quality': { mean: 4.4, stddev: 0.5 }
            }
          }
        }
      };

      const output = aggregate.generateJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.variants['with-skill'].sessions).toBe(5);
      expect(parsed.variants['with-skill'].overall.mean).toBe(4.2);
      expect(parsed.variants['with-skill'].by_rubric['code-quality'].mean).toBe(4.4);
    });

    it('should include comparison statistics', () => {
      const data = {
        eval_name: 'test-eval',
        variants: {},
        comparison: {
          difference: 1.1,
          percent_improvement: 35,
          p_value: 0.02,
          significant: true
        }
      };

      const output = aggregate.generateJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.comparison.difference).toBe(1.1);
      expect(parsed.comparison.percent_improvement).toBe(35);
      expect(parsed.comparison.significant).toBe(true);
    });

    it('should include raw_scores when present', () => {
      const data = {
        eval_name: 'test-eval',
        variants: {
          'with-skill': {
            sessions: 1,
            overall: {},
            raw_sessions: [
              { sessionId: 'abc', scores: { 'code-quality': 4 } }
            ]
          }
        }
      };

      const output = aggregate.generateJsonOutput(data);
      const parsed = JSON.parse(output);

      expect(parsed.raw_scores).toBeDefined();
    });
  });

  describe('run', () => {
    it('should show help when --help flag provided', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const result = await aggregate.run(['--help']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/usage|options|arguments/i)
      );
      expect(result.exitCode).toBe(0);

      consoleLogSpy.mockRestore();
    });

    it('should exit with error when no results directory provided', async () => {
      const result = await aggregate.run([]);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/results.*directory|argument.*required/i);
    });

    it('should exit with error for non-existent directory', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = await aggregate.run(['/nonexistent/dir']);

      expect(result.exitCode).not.toBe(0);
      expect(result.error).toMatch(/not found|does not exist/i);
    });

    it('should generate markdown report by default', async () => {
      setupValidResultsDir();

      await aggregate.run(['/results/my-eval']);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/report\.md$/),
        expect.stringContaining('# Evaluation Report')
      );
    });

    it('should generate JSON output when --format json specified', async () => {
      setupValidResultsDir();

      await aggregate.run(['/results/my-eval', '--format', 'json']);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/\.json$/),
        expect.stringMatching(/^\{[\s\S]*\}$/)
      );
    });

    it('should generate both formats when --format both specified', async () => {
      setupValidResultsDir();

      await aggregate.run(['/results/my-eval', '--format', 'both']);

      const writeFileCalls = mockFs.writeFileSync.mock.calls;
      const filePaths = writeFileCalls.map(call => call[0]);

      expect(filePaths.some(p => p.endsWith('.md'))).toBe(true);
      expect(filePaths.some(p => p.endsWith('.json'))).toBe(true);
    });

    it('should use custom output path when --output specified', async () => {
      setupValidResultsDir();

      await aggregate.run(['/results/my-eval', '--output', '/custom/report.md']);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        '/custom/report.md',
        expect.any(String)
      );
    });

    it('should suppress progress when --quiet specified', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      setupValidResultsDir();

      await aggregate.run(['/results/my-eval', '--quiet']);

      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should return exit code 0 on success', async () => {
      setupValidResultsDir();

      const result = await aggregate.run(['/results/my-eval']);

      expect(result.exitCode).toBe(0);
    });
  });

  // Helper function to setup valid results directory mock
  function setupValidResultsDir() {
    mockFs.existsSync.mockImplementation((path) => {
      // Check if it's asking about score.json file
      if (path.includes('score.json')) {
        return true;
      }
      return true;
    });

    mockFs.readdirSync.mockImplementation((dir) => {
      if (dir === '/results/my-eval') {
        return ['with-skill', 'without-skill'];
      }
      // Session directories
      return ['session-abc'];
    });

    mockFs.statSync.mockReturnValue({ isDirectory: () => true });

    mockFs.readFileSync.mockImplementation((filepath) => {
      if (filepath.includes('sessions.json')) {
        return JSON.stringify({
          evalName: 'test-eval',
          timestamp: '2026-01-13T10:00:00Z',
          variants: [
            { id: 'with-skill', sessionId: 'abc', status: 'completed' },
            { id: 'without-skill', sessionId: 'def', status: 'completed' }
          ]
        });
      }
      if (filepath.includes('score.json')) {
        return JSON.stringify({
          scores: [
            { rubric: 'code-quality', score: 4, justification: 'Good code' },
            { rubric: 'test-quality', score: 3, justification: 'Adequate tests' }
          ]
        });
      }
      return '{}';
    });
  }
});

describe('statistical functions', () => {
  let aggregate;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('fs', () => ({
      existsSync: jest.fn().mockReturnValue(true),
      readdirSync: jest.fn(),
      readFileSync: jest.fn(),
      writeFileSync: jest.fn(),
      statSync: jest.fn()
    }));
    aggregate = require('./aggregate');
  });

  describe('tTest', () => {
    it('should calculate t-statistic for two samples', () => {
      const sample1 = [4.0, 4.5, 4.2, 4.3, 4.0];
      const sample2 = [3.0, 3.5, 2.8, 3.2, 3.0];

      const result = aggregate.tTest(sample1, sample2);

      // t-statistic should be significantly positive (sample1 > sample2)
      expect(result.t).toBeGreaterThan(0);
      expect(result).toHaveProperty('p');
      expect(result.p).toBeLessThan(0.05); // Should be significant
    });

    it('should return high p-value for similar samples', () => {
      const sample1 = [4.0, 4.1, 3.9, 4.0, 4.0];
      const sample2 = [4.0, 4.0, 4.0, 4.1, 3.9];

      const result = aggregate.tTest(sample1, sample2);

      expect(result.p).toBeGreaterThan(0.1); // Not significant
    });

    it('should handle small samples', () => {
      const sample1 = [4, 5];
      const sample2 = [2, 3];

      const result = aggregate.tTest(sample1, sample2);

      expect(result).toHaveProperty('t');
      expect(result).toHaveProperty('p');
    });
  });
});
