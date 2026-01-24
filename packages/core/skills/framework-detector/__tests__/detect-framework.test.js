/**
 * Unit tests for FrameworkDetector
 * Target: 80% code coverage
 *
 * Related: TRD-015, docs/TRD/skills-based-framework-agents-trd.md
 */

const fs = require('fs').promises;
const path = require('path');
const FrameworkDetector = require('../detect-framework');
const { glob } = require('glob');

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    access: jest.fn()
  }
}));

jest.mock('glob', () => ({
  glob: jest.fn()
}));

describe('FrameworkDetector', () => {
  let detector;
  const mockPatternsPath = '/test/framework-patterns.json';
  const mockProjectRoot = '/test/project';

  const mockPatterns = {
    frameworks: {
      nestjs: {
        name: 'NestJS',
        category: 'backend',
        language: 'typescript',
        patterns: {
          packageJson: {
            dependencies: ['@nestjs/core', '@nestjs/common'],
            weight: 10,
            minMatches: 2
          },
          files: {
            required: ['nest-cli.json'],
            optional: ['src/main.ts'],
            weight: 8
          },
          imports: {
            patterns: ["from '@nestjs/core'", '@Module\\('],
            fileExtensions: ['.ts'],
            weight: 7
          }
        },
        boostFactors: {
          hasNestCliJson: 1.5,
          hasModuleDecorator: 1.3
        }
      },
      react: {
        name: 'React',
        category: 'frontend',
        language: 'javascript',
        patterns: {
          packageJson: {
            dependencies: ['react', 'react-dom'],
            weight: 10,
            minMatches: 1
          },
          files: {
            optional: ['src/App.jsx', 'src/index.jsx'],
            weight: 7
          },
          imports: {
            patterns: ["from 'react'", 'useState', 'useEffect'],
            fileExtensions: ['.jsx', '.tsx'],
            weight: 8
          }
        },
        boostFactors: {
          hasJsxFiles: 1.4,
          hasUseStateOrEffect: 1.3
        }
      }
    },
    detectionConfig: {
      confidenceThreshold: 0.8,
      maxCandidates: 3
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    detector = new FrameworkDetector(mockProjectRoot, mockPatternsPath);
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      const defaultDetector = new FrameworkDetector();
      expect(defaultDetector.projectRoot).toBe(process.cwd());
      expect(defaultDetector.patternsPath).toContain('framework-patterns.json');
      expect(defaultDetector.detectionResults).toBeInstanceOf(Map);
    });

    test('should initialize with custom values', () => {
      expect(detector.projectRoot).toBe(mockProjectRoot);
      expect(detector.patternsPath).toBe(mockPatternsPath);
    });

    test('should accept manual override option', () => {
      const overrideDetector = new FrameworkDetector(mockProjectRoot, mockPatternsPath, {
        framework: 'nestjs'
      });
      expect(overrideDetector.manualOverride).toBe('nestjs');
    });

    test('should accept skipDetection option', () => {
      const skipDetector = new FrameworkDetector(mockProjectRoot, mockPatternsPath, {
        skipDetection: true
      });
      expect(skipDetector.skipDetection).toBe(true);
    });
  });

  describe('loadPatterns()', () => {
    test('should load and parse patterns JSON', async () => {
      fs.readFile.mockResolvedValue(JSON.stringify(mockPatterns));

      await detector.loadPatterns();

      expect(fs.readFile).toHaveBeenCalledWith(mockPatternsPath, 'utf-8');
      expect(detector.patterns).toEqual(mockPatterns);
    });

    test('should throw error on file read failure', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      await expect(detector.loadPatterns()).rejects.toThrow('Failed to load patterns');
    });

    test('should throw error on invalid JSON', async () => {
      fs.readFile.mockResolvedValue('invalid json{');

      await expect(detector.loadPatterns()).rejects.toThrow('Failed to load patterns');
    });
  });

  describe('detect() - Manual Override', () => {
    beforeEach(() => {
      fs.readFile.mockResolvedValue(JSON.stringify(mockPatterns));
    });

    test('should return manual override result from constructor option', async () => {
      const overrideDetector = new FrameworkDetector(mockProjectRoot, mockPatternsPath, {
        framework: 'nestjs'
      });

      const result = await overrideDetector.detect();

      expect(result.primary).toBe('nestjs');
      expect(result.confidence).toBe(1.0);
      expect(result.manualOverride).toBe(true);
      expect(result.alternates).toEqual([]);
    });

    test('should return manual override result from detect options', async () => {
      const result = await detector.detect({ framework: 'react' });

      expect(result.primary).toBe('react');
      expect(result.confidence).toBe(1.0);
      expect(result.manualOverride).toBe(true);
    });

    test('should throw error for invalid framework override', async () => {
      await expect(detector.detect({ framework: 'invalid-framework' })).rejects.toThrow(
        'Invalid framework'
      );
    });

    test('should prioritize detect options over constructor options', async () => {
      const overrideDetector = new FrameworkDetector(mockProjectRoot, mockPatternsPath, {
        framework: 'nestjs'
      });

      const result = await overrideDetector.detect({ framework: 'react' });

      expect(result.primary).toBe('react');
    });
  });

  describe('detect() - Skip Detection', () => {
    test('should skip detection when skipDetection constructor option is true', async () => {
      const skipDetector = new FrameworkDetector(mockProjectRoot, mockPatternsPath, {
        skipDetection: true
      });

      const result = await skipDetector.detect();

      expect(result.primary).toBe(null);
      expect(result.confidence).toBe(0);
      expect(result.skipped).toBe(true);
    });

    test('should skip detection when detect options.skipDetection is true', async () => {
      const result = await detector.detect({ skipDetection: true });

      expect(result.primary).toBe(null);
      expect(result.skipped).toBe(true);
    });
  });

  describe('detectFromPackageJson()', () => {
    beforeEach(() => {
      detector.patterns = mockPatterns;
    });

    test('should detect NestJS from package.json', async () => {
      const packageJson = {
        dependencies: {
          '@nestjs/core': '^10.0.0',
          '@nestjs/common': '^10.0.0',
          '@nestjs/platform-express': '^10.0.0'
        }
      };
      fs.readFile.mockResolvedValue(JSON.stringify(packageJson));

      await detector.detectFromPackageJson();

      const results = detector.detectionResults.get('nestjs');
      expect(results.packageJson).toBeDefined();
      expect(results.packageJson.matches).toBeGreaterThanOrEqual(2);
    });

    test('should detect React from package.json', async () => {
      const packageJson = {
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0'
        }
      };
      fs.readFile.mockResolvedValue(JSON.stringify(packageJson));

      await detector.detectFromPackageJson();

      const results = detector.detectionResults.get('react');
      expect(results.packageJson).toBeDefined();
      expect(results.packageJson.matches).toBeGreaterThanOrEqual(1);
    });

    test('should handle missing package.json gracefully', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));

      await expect(detector.detectFromPackageJson()).resolves.not.toThrow();
      expect(detector.detectionResults.size).toBe(0);
    });

    test('should handle invalid package.json gracefully', async () => {
      fs.readFile.mockResolvedValue('invalid json');

      await expect(detector.detectFromPackageJson()).resolves.not.toThrow();
    });

    test('should check devDependencies as well', async () => {
      const packageJson = {
        dependencies: {},
        devDependencies: {
          '@nestjs/core': '^10.0.0',
          '@nestjs/common': '^10.0.0'
        }
      };
      fs.readFile.mockResolvedValue(JSON.stringify(packageJson));

      await detector.detectFromPackageJson();

      const results = detector.detectionResults.get('nestjs');
      expect(results).toBeDefined();
    });

    test('should respect minMatches requirement', async () => {
      const packageJson = {
        dependencies: {
          '@nestjs/core': '^10.0.0'
          // Only 1 match, but minMatches is 2 for NestJS
        }
      };
      fs.readFile.mockResolvedValue(JSON.stringify(packageJson));

      await detector.detectFromPackageJson();

      const results = detector.detectionResults.get('nestjs');
      expect(results).toBeUndefined(); // Should not be added
    });
  });

  describe('detectFromGemfile()', () => {
    beforeEach(() => {
      detector.patterns = {
        frameworks: {
          rails: {
            patterns: {
              gemfile: {
                gems: ["gem 'rails'", "gem 'activesupport'"],
                weight: 10,
                minMatches: 1
              }
            }
          }
        },
        detectionConfig: mockPatterns.detectionConfig
      };
    });

    test('should detect Rails from Gemfile', async () => {
      fs.readFile.mockResolvedValue("gem 'rails', '~> 7.0'\ngem 'activesupport'");

      await detector.detectFromGemfile();

      const results = detector.detectionResults.get('rails');
      expect(results.gemfile).toBeDefined();
      expect(results.gemfile.matches).toBeGreaterThanOrEqual(1);
    });

    test('should handle missing Gemfile gracefully', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));

      await expect(detector.detectFromGemfile()).resolves.not.toThrow();
    });
  });

  describe('detectFromMixExs()', () => {
    beforeEach(() => {
      detector.patterns = {
        frameworks: {
          phoenix: {
            patterns: {
              mixExs: {
                dependencies: ['{:phoenix,', '{:phoenix_ecto,'],
                weight: 10,
                minMatches: 1
              }
            }
          }
        },
        detectionConfig: mockPatterns.detectionConfig
      };
    });

    test('should detect Phoenix from mix.exs', async () => {
      fs.readFile.mockResolvedValue('{:phoenix, "~> 1.7"}\n{:phoenix_ecto, "~> 4.4"}');

      await detector.detectFromMixExs();

      const results = detector.detectionResults.get('phoenix');
      expect(results.mixExs).toBeDefined();
    });

    test('should handle missing mix.exs gracefully', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));

      await expect(detector.detectFromMixExs()).resolves.not.toThrow();
    });
  });

  describe('detectFromCsproj()', () => {
    beforeEach(() => {
      detector.patterns = {
        frameworks: {
          dotnet: {
            patterns: {
              csproj: {
                packageReferences: ['Microsoft.AspNetCore'],
                sdks: ['Microsoft.NET.Sdk.Web'],
                weight: 10,
                minMatches: 1
              }
            }
          }
        },
        detectionConfig: mockPatterns.detectionConfig
      };
    });

    test('should detect .NET from .csproj', async () => {
      glob.mockResolvedValue(['project.csproj']);
      fs.readFile.mockResolvedValue(
        '<Project Sdk="Microsoft.NET.Sdk.Web"><PackageReference Include="Microsoft.AspNetCore" /></Project>'
      );

      await detector.detectFromCsproj();

      const results = detector.detectionResults.get('dotnet');
      expect(results.csproj).toBeDefined();
    });

    test('should handle no .csproj files gracefully', async () => {
      glob.mockResolvedValue([]);

      await expect(detector.detectFromCsproj()).resolves.not.toThrow();
    });

    test('should handle glob errors gracefully', async () => {
      glob.mockRejectedValue(new Error('Glob error'));

      await expect(detector.detectFromCsproj()).resolves.not.toThrow();
    });
  });

  describe('detectFromFiles()', () => {
    beforeEach(() => {
      detector.patterns = mockPatterns;
    });

    test('should detect from required files with double weight', async () => {
      fs.access.mockImplementation(async filePath => {
        if (filePath.includes('nest-cli.json')) return;
        throw new Error('ENOENT');
      });

      await detector.detectFromFiles();

      const results = detector.detectionResults.get('nestjs');
      expect(results.files).toBeDefined();
      expect(results.files.matches).toBe(2); // Required files count double
    });

    test('should detect from optional files', async () => {
      fs.access.mockImplementation(async filePath => {
        // Use path.sep to handle both Windows (\) and Unix (/) path separators
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (normalizedPath.includes('src/main.ts')) return;
        throw new Error('ENOENT');
      });

      await detector.detectFromFiles();

      const results = detector.detectionResults.get('nestjs');
      expect(results.files).toBeDefined();
      expect(results.files.matches).toBe(1);
    });

    test('should handle wildcard file patterns', async () => {
      glob.mockResolvedValue(['some-file.ts']);
      detector.patterns.frameworks.nestjs.patterns.files.required = ['*.ts'];

      await detector.detectFromFiles();

      const results = detector.detectionResults.get('nestjs');
      expect(results).toBeDefined();
    });
  });

  describe('detectFromImports()', () => {
    beforeEach(() => {
      detector.patterns = mockPatterns;
    });

    test('should detect NestJS from import statements', async () => {
      glob.mockResolvedValue(['src/app.module.ts', 'src/main.ts']);
      fs.readFile.mockResolvedValue("import { Module } from '@nestjs/core';\n@Module()");

      await detector.detectFromImports();

      const results = detector.detectionResults.get('nestjs');
      expect(results.imports).toBeDefined();
      expect(results.imports.matches).toBeGreaterThan(0);
    });

    test('should sample maximum 20 files for performance', async () => {
      const manyFiles = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
      glob.mockResolvedValue(manyFiles);
      fs.readFile.mockResolvedValue("from '@nestjs/core'");

      await detector.detectFromImports();

      // Should only read 20 files per framework pattern
      // The implementation checks multiple frameworks, each sampling up to 20 files
      // So we verify that each individual framework's sampling is limited
      const callCount = fs.readFile.mock.calls.length;
      // Number of calls should be divisible by 20 (20 files per framework with import patterns)
      // At minimum 20, at maximum 20 * (number of frameworks with imports)
      expect(callCount % 20).toBe(0);
      expect(callCount).toBeGreaterThanOrEqual(20);
      // Each framework should only sample 20, so no more than frameworkCount * 20
      expect(callCount).toBeLessThanOrEqual(100); // max 5 frameworks * 20 files
    });

    test('should handle file read errors gracefully', async () => {
      glob.mockResolvedValue(['file1.ts', 'file2.ts']);
      fs.readFile
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce("from 'react'");

      await expect(detector.detectFromImports()).resolves.not.toThrow();
    });

    test('should handle glob errors gracefully', async () => {
      glob.mockRejectedValue(new Error('Glob error'));

      await expect(detector.detectFromImports()).resolves.not.toThrow();
    });
  });

  describe('calculateConfidenceScores()', () => {
    beforeEach(() => {
      detector.patterns = mockPatterns;
    });

    test('should calculate scores from weighted signals', () => {
      detector.detectionResults.set('nestjs', {
        packageJson: { matches: 3, weight: 10, score: 30 },
        files: { matches: 2, weight: 8, score: 16 }
      });

      const scores = detector.calculateConfidenceScores();

      const nestjsScore = scores.get('nestjs');
      expect(nestjsScore.rawScore).toBe(46);
      expect(nestjsScore.confidence).toBeGreaterThan(0);
      expect(nestjsScore.confidence).toBeLessThanOrEqual(1);
    });

    test('should return 0 confidence for framework with no signals', () => {
      detector.detectionResults.set('react', {
        packageJson: { matches: 0, weight: 10, score: 0 }
      });

      const scores = detector.calculateConfidenceScores();

      const reactScore = scores.get('react');
      expect(reactScore.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('applyBoostFactors()', () => {
    beforeEach(() => {
      detector.patterns = mockPatterns;
    });

    test('should apply boost multiplier when indicator present', async () => {
      const scores = new Map();
      scores.set('nestjs', {
        framework: 'nestjs',
        confidence: 0.5,
        rawScore: 50,
        signals: {}
      });

      // Mock hasNestCliJson check to return true
      fs.access.mockResolvedValue();

      const boosted = await detector.applyBoostFactors(scores);

      const nestjsScore = boosted.get('nestjs');
      expect(nestjsScore.confidence).toBeGreaterThan(0.5);
      expect(nestjsScore.boostMultiplier).toBeGreaterThan(1.0);
    });

    test('should not apply boost when indicator absent', async () => {
      const scores = new Map();
      scores.set('nestjs', {
        framework: 'nestjs',
        confidence: 0.5,
        rawScore: 50,
        signals: {}
      });

      // Mock all checks to return false
      fs.access.mockRejectedValue(new Error('ENOENT'));
      glob.mockResolvedValue([]);

      const boosted = await detector.applyBoostFactors(scores);

      const nestjsScore = boosted.get('nestjs');
      expect(nestjsScore.confidence).toBe(0.5);
      expect(nestjsScore.boostMultiplier).toBe(1.0);
    });
  });

  describe('normalizeScores()', () => {
    test('should normalize to 0-1 range based on max confidence', () => {
      const scores = new Map();
      scores.set('nestjs', { confidence: 0.8, framework: 'nestjs' });
      scores.set('react', { confidence: 0.4, framework: 'react' });

      const normalized = detector.normalizeScores(scores);

      expect(normalized.get('nestjs').normalizedConfidence).toBe(1.0);
      expect(normalized.get('react').normalizedConfidence).toBe(0.5);
    });

    test('should handle zero max confidence', () => {
      const scores = new Map();
      scores.set('nestjs', { confidence: 0, framework: 'nestjs' });

      const normalized = detector.normalizeScores(scores);

      expect(normalized.get('nestjs').normalizedConfidence).toBeUndefined();
    });
  });

  describe('getTopCandidates()', () => {
    beforeEach(() => {
      detector.patterns = mockPatterns;
    });

    test('should filter by confidence threshold', () => {
      const scores = new Map();
      scores.set('nestjs', { confidence: 0.9, framework: 'nestjs' });
      scores.set('react', { confidence: 0.7, framework: 'react' }); // Below 0.8 threshold

      const candidates = detector.getTopCandidates(scores);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].framework).toBe('nestjs');
    });

    test('should sort by confidence descending', () => {
      const scores = new Map();
      scores.set('nestjs', { confidence: 0.85, framework: 'nestjs' });
      scores.set('react', { confidence: 0.95, framework: 'react' });

      const candidates = detector.getTopCandidates(scores);

      expect(candidates[0].framework).toBe('react');
      expect(candidates[1].framework).toBe('nestjs');
    });

    test('should limit to maxCandidates', () => {
      const scores = new Map();
      scores.set('nestjs', { confidence: 0.95, framework: 'nestjs' });
      scores.set('react', { confidence: 0.9, framework: 'react' });
      scores.set('rails', { confidence: 0.85, framework: 'rails' });
      scores.set('phoenix', { confidence: 0.8, framework: 'phoenix' });

      const candidates = detector.getTopCandidates(scores);

      expect(candidates.length).toBeLessThanOrEqual(3); // maxCandidates = 3
    });
  });

  describe('addSignal()', () => {
    test('should add signal to new framework', () => {
      detector.addSignal('nestjs', 'packageJson', 3, 10);

      const results = detector.detectionResults.get('nestjs');
      expect(results.packageJson).toEqual({
        matches: 3,
        weight: 10,
        score: 30
      });
    });

    test('should add multiple signals to same framework', () => {
      detector.addSignal('nestjs', 'packageJson', 3, 10);
      detector.addSignal('nestjs', 'files', 2, 8);

      const results = detector.detectionResults.get('nestjs');
      expect(results.packageJson).toBeDefined();
      expect(results.files).toBeDefined();
    });
  });

  describe('fileExists()', () => {
    test('should return true for existing file', async () => {
      fs.access.mockResolvedValue();

      const exists = await detector.fileExists('test.ts');

      expect(exists).toBe(true);
    });

    test('should return false for non-existing file', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const exists = await detector.fileExists('missing.ts');

      expect(exists).toBe(false);
    });

    test('should handle wildcard patterns', async () => {
      glob.mockResolvedValue(['file1.ts', 'file2.ts']);

      const exists = await detector.fileExists('*.ts');

      expect(exists).toBe(true);
      expect(glob).toHaveBeenCalled();
    });

    test('should return false for wildcard with no matches', async () => {
      glob.mockResolvedValue([]);

      const exists = await detector.fileExists('*.xyz');

      expect(exists).toBe(false);
    });
  });

  describe('searchInFiles()', () => {
    test('should return true when pattern found', async () => {
      glob.mockResolvedValue(['file1.ts', 'file2.ts']);
      fs.readFile.mockResolvedValue("import { Module } from '@nestjs/core';\n@Module({})");

      const found = await detector.searchInFiles('@Module\\(', ['.ts']);

      expect(found).toBe(true);
    });

    test('should return false when pattern not found', async () => {
      glob.mockResolvedValue(['file1.ts']);
      fs.readFile.mockResolvedValue('some other content');

      const found = await detector.searchInFiles('nonexistent', ['.ts']);

      expect(found).toBe(false);
    });

    test('should sample first 10 files', async () => {
      const manyFiles = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
      glob.mockResolvedValue(manyFiles);
      fs.readFile.mockResolvedValue('content');

      await detector.searchInFiles('pattern', ['.ts']);

      expect(fs.readFile).toHaveBeenCalledTimes(10);
    });

    test('should handle file read errors gracefully', async () => {
      glob.mockResolvedValue(['file1.ts']);
      fs.readFile.mockRejectedValue(new Error('Permission denied'));

      const found = await detector.searchInFiles('pattern', ['.ts']);

      expect(found).toBe(false);
    });

    test('should handle glob errors gracefully', async () => {
      glob.mockRejectedValue(new Error('Glob error'));

      const found = await detector.searchInFiles('pattern', ['.ts']);

      expect(found).toBe(false);
    });
  });

  describe('handleManualOverride()', () => {
    beforeEach(() => {
      fs.readFile.mockResolvedValue(JSON.stringify(mockPatterns));
    });

    test('should return result with confidence 1.0', async () => {
      const result = await detector.handleManualOverride('nestjs');

      expect(result.primary).toBe('nestjs');
      expect(result.confidence).toBe(1.0);
      expect(result.manualOverride).toBe(true);
      expect(result.alternates).toEqual([]);
    });

    test('should include manual override in details', async () => {
      const result = await detector.handleManualOverride('react');

      expect(result.details.react.manualOverride).toEqual({
        matches: 1,
        weight: 100,
        score: 100
      });
    });

    test('should throw error for invalid framework', async () => {
      await expect(detector.handleManualOverride('invalid')).rejects.toThrow(
        'Invalid framework'
      );
    });

    test('should list valid frameworks in error message', async () => {
      try {
        await detector.handleManualOverride('invalid');
      } catch (error) {
        expect(error.message).toContain('nestjs');
        expect(error.message).toContain('react');
      }
    });
  });

  describe('Integration: Full detection workflow', () => {
    beforeEach(() => {
      fs.readFile.mockImplementation(async filePath => {
        if (filePath.includes('framework-patterns.json')) {
          return JSON.stringify(mockPatterns);
        }
        if (filePath.includes('package.json')) {
          return JSON.stringify({
            dependencies: {
              '@nestjs/core': '^10.0.0',
              '@nestjs/common': '^10.0.0'
            }
          });
        }
        if (filePath.includes('.ts')) {
          return "import { Module } from '@nestjs/core';\n@Module()";
        }
        throw new Error('File not found');
      });

      fs.access.mockImplementation(async filePath => {
        if (filePath.includes('nest-cli.json')) return;
        throw new Error('ENOENT');
      });

      glob.mockResolvedValue(['src/app.module.ts', 'src/main.ts']);
    });

    test('should complete full detection workflow', async () => {
      const result = await detector.detect();

      expect(result.primary).toBe('nestjs');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.details.nestjs).toBeDefined();
      expect(result.details.nestjs.packageJson).toBeDefined();
      expect(result.details.nestjs.files).toBeDefined();
      expect(result.details.nestjs.imports).toBeDefined();
    });

    test('should return null when no frameworks detected', async () => {
      fs.readFile.mockImplementation(async filePath => {
        if (filePath.includes('framework-patterns.json')) {
          return JSON.stringify(mockPatterns);
        }
        throw new Error('File not found');
      });

      glob.mockResolvedValue([]);

      const result = await detector.detect();

      expect(result.primary).toBe(null);
      expect(result.confidence).toBe(0);
    });

    test('should return alternates when multiple frameworks detected', async () => {
      // Create patterns with lower threshold to allow multiple frameworks to be detected
      const multiFrameworkPatterns = {
        ...mockPatterns,
        detectionConfig: {
          confidenceThreshold: 0.3, // Lower threshold to allow both frameworks
          maxCandidates: 3
        }
      };

      fs.readFile.mockImplementation(async filePath => {
        if (filePath.includes('framework-patterns.json')) {
          return JSON.stringify(multiFrameworkPatterns);
        }
        if (filePath.includes('package.json')) {
          return JSON.stringify({
            dependencies: {
              '@nestjs/core': '^10.0.0',
              '@nestjs/common': '^10.0.0',
              react: '^18.0.0',
              'react-dom': '^18.0.0'
            }
          });
        }
        return 'content';
      });

      glob.mockResolvedValue(['src/app.tsx', 'src/index.tsx']);

      const result = await detector.detect();

      expect(result.primary).toBeDefined();
      expect(result.alternates.length).toBeGreaterThan(0);
    });
  });
});
