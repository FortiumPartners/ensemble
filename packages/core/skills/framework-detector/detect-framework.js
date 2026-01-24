#!/usr/bin/env node

/**
 * Framework Detection System
 *
 * Multi-signal detection with confidence scoring for 6 frameworks:
 * - NestJS, React, Phoenix, Rails, .NET, Blazor
 *
 * Detection Signals:
 * 1. Package manager dependencies (package.json, Gemfile, mix.exs, *.csproj)
 * 2. Required/optional files
 * 3. Import statements in source files
 * 4. Configuration file validation
 * 5. Boost factors for strong indicators
 *
 * Related: TRD-011, TRD-012, docs/TRD/skills-based-framework-agents-trd.md
 */

const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

class FrameworkDetector {
  constructor(projectRoot, patternsPath, options = {}) {
    this.projectRoot = projectRoot || process.cwd();
    this.patternsPath = patternsPath || path.join(__dirname, 'framework-patterns.json');
    this.patterns = null;
    this.detectionResults = new Map();

    // Manual override support (TRD-014)
    this.manualOverride = options.framework || null;
    this.skipDetection = options.skipDetection || false;
  }

  /**
   * Main detection entry point
   * @param {Object} options - Detection options
   * @param {string} options.framework - Manual framework override
   * @returns {Promise<Object>} Detection result with primary framework and confidence
   */
  async detect(options = {}) {
    // Handle manual override (TRD-014)
    const manualFramework = options.framework || this.manualOverride;

    if (manualFramework) {
      return this.handleManualOverride(manualFramework);
    }

    // Skip detection if requested
    if (this.skipDetection || options.skipDetection) {
      return {
        primary: null,
        confidence: 0,
        alternates: [],
        details: {},
        skipped: true
      };
    }
    // Load patterns
    await this.loadPatterns();

    // Run all detection signals
    await this.detectFromPackageJson();
    await this.detectFromGemfile();
    await this.detectFromMixExs();
    await this.detectFromCsproj();
    await this.detectFromFiles();
    await this.detectFromImports();

    // Calculate confidence scores
    const scored = this.calculateConfidenceScores();

    // Apply boost factors
    const boosted = await this.applyBoostFactors(scored);

    // Normalize and sort
    const normalized = this.normalizeScores(boosted);

    // Get top candidates
    const candidates = this.getTopCandidates(normalized);

    return {
      primary: candidates[0]?.framework || null,
      confidence: candidates[0]?.confidence || 0,
      alternates: candidates.slice(1).map(c => ({
        framework: c.framework,
        confidence: c.confidence
      })),
      details: Object.fromEntries(this.detectionResults)
    };
  }

  /**
   * Load framework patterns from JSON file
   */
  async loadPatterns() {
    try {
      const content = await fs.readFile(this.patternsPath, 'utf-8');
      this.patterns = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load patterns: ${error.message}`);
    }
  }

  /**
   * Detect from package.json (Node.js projects)
   */
  async detectFromPackageJson() {
    const pkgPath = path.join(this.projectRoot, 'package.json');

    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };

      for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
        if (!config.patterns.packageJson) continue;

        const { dependencies, devDependencies, weight, minMatches = 1 } = config.patterns.packageJson;
        let matches = 0;

        // Check dependencies
        if (dependencies) {
          matches += dependencies.filter(dep => allDeps[dep]).length;
        }

        if (matches >= minMatches) {
          this.addSignal(framework, 'packageJson', matches, weight);
        }
      }
    } catch (error) {
      // No package.json or parse error - skip
    }
  }

  /**
   * Detect from Gemfile (Ruby projects)
   */
  async detectFromGemfile() {
    const gemfilePath = path.join(this.projectRoot, 'Gemfile');

    try {
      const content = await fs.readFile(gemfilePath, 'utf-8');

      for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
        if (!config.patterns.gemfile) continue;

        const { gems, weight, minMatches = 1 } = config.patterns.gemfile;
        const matches = gems.filter(gem => content.includes(gem)).length;

        if (matches >= minMatches) {
          this.addSignal(framework, 'gemfile', matches, weight);
        }
      }
    } catch (error) {
      // No Gemfile - skip
    }
  }

  /**
   * Detect from mix.exs (Elixir projects)
   */
  async detectFromMixExs() {
    const mixPath = path.join(this.projectRoot, 'mix.exs');

    try {
      const content = await fs.readFile(mixPath, 'utf-8');

      for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
        if (!config.patterns.mixExs) continue;

        const { dependencies, weight, minMatches = 1 } = config.patterns.mixExs;
        const matches = dependencies.filter(dep => content.includes(dep)).length;

        if (matches >= minMatches) {
          this.addSignal(framework, 'mixExs', matches, weight);
        }
      }
    } catch (error) {
      // No mix.exs - skip
    }
  }

  /**
   * Detect from *.csproj (.NET projects)
   */
  async detectFromCsproj() {
    try {
      const csprojFiles = await glob('**/*.csproj', {
        cwd: this.projectRoot,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**']
      });

      if (csprojFiles.length === 0) return;

      // Read first .csproj file
      const csprojPath = path.join(this.projectRoot, csprojFiles[0]);
      const content = await fs.readFile(csprojPath, 'utf-8');

      for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
        if (!config.patterns.csproj) continue;

        const { packageReferences, sdks, weight, minMatches = 1 } = config.patterns.csproj;
        let matches = 0;

        // Check PackageReference
        if (packageReferences) {
          matches += packageReferences.filter(ref => content.includes(ref)).length;
        }

        // Check SDK
        if (sdks) {
          matches += sdks.filter(sdk => content.includes(`Sdk="${sdk}"`)).length;
        }

        if (matches >= minMatches) {
          this.addSignal(framework, 'csproj', matches, weight);
        }
      }
    } catch (error) {
      // No .csproj files - skip
    }
  }

  /**
   * Detect from required/optional files
   */
  async detectFromFiles() {
    for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
      if (!config.patterns.files) continue;

      const { required, optional, weight } = config.patterns.files;
      let matches = 0;

      // Check required files
      if (required) {
        for (const filePath of required) {
          if (await this.fileExists(filePath)) {
            matches += 2; // Required files count double
          }
        }
      }

      // Check optional files
      if (optional) {
        for (const filePath of optional) {
          if (await this.fileExists(filePath)) {
            matches += 1;
          }
        }
      }

      if (matches > 0) {
        this.addSignal(framework, 'files', matches, weight);
      }
    }
  }

  /**
   * Detect from import statements in source files
   */
  async detectFromImports() {
    for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
      if (!config.patterns.imports) continue;

      const { patterns, fileExtensions, weight } = config.patterns.imports;

      try {
        // Find source files with matching extensions
        const globPattern = `**/*{${fileExtensions.join(',')}}`;
        const files = await glob(globPattern, {
          cwd: this.projectRoot,
          ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/vendor/**'],
          nodir: true
        });

        let totalMatches = 0;

        // Sample up to 20 files for performance
        const sampleFiles = files.slice(0, 20);

        for (const file of sampleFiles) {
          const filePath = path.join(this.projectRoot, file);
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const matches = patterns.filter(pattern => {
              const regex = new RegExp(pattern, 'i');
              return regex.test(content);
            }).length;

            totalMatches += matches;
          } catch (error) {
            // Skip files that can't be read
            continue;
          }
        }

        if (totalMatches > 0) {
          this.addSignal(framework, 'imports', totalMatches, weight);
        }
      } catch (error) {
        // Glob error - skip
      }
    }
  }

  /**
   * Calculate confidence scores based on weighted signals
   */
  calculateConfidenceScores() {
    const scores = new Map();

    for (const [framework, signals] of this.detectionResults.entries()) {
      let totalScore = 0;
      let maxPossibleScore = 0;

      // Calculate actual score
      for (const [signalType, data] of Object.entries(signals)) {
        totalScore += data.matches * data.weight;
      }

      // Calculate max possible score for this framework
      const config = this.patterns.frameworks[framework];
      if (config) {
        for (const [key, value] of Object.entries(config.patterns)) {
          if (value.weight) {
            maxPossibleScore += value.weight * 3; // Assume max 3 matches per signal
          }
        }
      }

      // Normalize to 0-1 range
      const confidence = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;

      scores.set(framework, {
        framework,
        rawScore: totalScore,
        maxScore: maxPossibleScore,
        confidence,
        signals
      });
    }

    return scores;
  }

  /**
   * Apply boost factors for strong indicators
   */
  async applyBoostFactors(scores) {
    for (const [framework, data] of scores.entries()) {
      const config = this.patterns.frameworks[framework];
      if (!config.boostFactors) continue;

      let boostMultiplier = 1.0;

      // Check each boost factor
      for (const [factor, multiplier] of Object.entries(config.boostFactors)) {
        const hasIndicator = await this.checkBoostIndicator(framework, factor);
        if (hasIndicator) {
          boostMultiplier *= multiplier;
        }
      }

      // Apply boost
      data.confidence *= boostMultiplier;
      data.boostMultiplier = boostMultiplier;
    }

    return scores;
  }

  /**
   * Check if a boost indicator is present
   */
  async checkBoostIndicator(framework, indicator) {
    const checks = {
      // NestJS
      hasNestCliJson: () => this.fileExists('nest-cli.json'),
      hasModuleDecorator: () => this.searchInFiles('@Module(', ['.ts']),
      hasControllerDecorator: () => this.searchInFiles('@Controller(', ['.ts']),

      // React
      hasJsxFiles: async () => {
        const files = await glob('**/*.{jsx,tsx}', { cwd: this.projectRoot, nodir: true });
        return files.length > 0;
      },
      hasUseStateOrEffect: () => this.searchInFiles('useState|useEffect', ['.jsx', '.tsx', '.js', '.ts']),
      hasCreateRoot: () => this.searchInFiles('createRoot', ['.jsx', '.tsx', '.js', '.ts']),

      // Phoenix
      hasEndpoint: () => this.searchInFiles('Phoenix.Endpoint', ['.ex']),
      hasRouter: () => this.searchInFiles('Phoenix.Router', ['.ex']),
      hasLiveView: () => this.searchInFiles('Phoenix.LiveView', ['.ex']),

      // Rails
      hasApplicationRb: () => this.fileExists('config/application.rb'),
      hasRoutesRb: () => this.fileExists('config/routes.rb'),
      hasActiveRecord: () => this.searchInFiles('ActiveRecord::Base', ['.rb']),

      // .NET
      hasProgramCs: () => this.fileExists('Program.cs'),
      hasApiController: () => this.searchInFiles('[ApiController]', ['.cs']),
      hasEntityFramework: () => this.searchInFiles('Microsoft.EntityFrameworkCore', ['.cs']),

      // Blazor
      hasRazorFiles: async () => {
        const files = await glob('**/*.razor', { cwd: this.projectRoot, nodir: true });
        return files.length > 0;
      },
      hasPageDirective: () => this.searchInFiles('@page', ['.razor']),
      hasComponentBase: () => this.searchInFiles('ComponentBase', ['.razor', '.cs'])
    };

    const check = checks[indicator];
    return check ? await check() : false;
  }

  /**
   * Normalize scores to 0-1 range
   */
  normalizeScores(scores) {
    const maxConfidence = Math.max(...Array.from(scores.values()).map(s => s.confidence));

    if (maxConfidence === 0) return scores;

    for (const [framework, data] of scores.entries()) {
      data.normalizedConfidence = data.confidence / maxConfidence;
    }

    return scores;
  }

  /**
   * Get top N candidates by confidence
   */
  getTopCandidates(scores) {
    const threshold = this.patterns.detectionConfig.confidenceThreshold;
    const maxCandidates = this.patterns.detectionConfig.maxCandidates;

    return Array.from(scores.values())
      .filter(s => s.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxCandidates);
  }

  /**
   * Add a detection signal
   */
  addSignal(framework, signalType, matches, weight) {
    if (!this.detectionResults.has(framework)) {
      this.detectionResults.set(framework, {});
    }

    this.detectionResults.get(framework)[signalType] = {
      matches,
      weight,
      score: matches * weight
    };
  }

  /**
   * Check if file exists (supports wildcards)
   */
  async fileExists(filePath) {
    if (filePath.includes('*')) {
      const files = await glob(filePath, { cwd: this.projectRoot, nodir: true });
      return files.length > 0;
    }

    try {
      await fs.access(path.join(this.projectRoot, filePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Search for pattern in files
   */
  async searchInFiles(pattern, extensions) {
    try {
      const globPattern = `**/*{${extensions.join(',')}}`;
      const files = await glob(globPattern, {
        cwd: this.projectRoot,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        nodir: true
      });

      const regex = new RegExp(pattern, 'i');

      // Sample first 10 files for performance
      for (const file of files.slice(0, 10)) {
        const filePath = path.join(this.projectRoot, file);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          if (regex.test(content)) return true;
        } catch {
          continue;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Handle manual framework override (TRD-014)
   * @param {string} framework - Framework name to override with
   * @returns {Promise<Object>} Detection result with manual override
   */
  async handleManualOverride(framework) {
    // Load patterns to validate framework exists
    await this.loadPatterns();

    const validFrameworks = Object.keys(this.patterns.frameworks);

    if (!validFrameworks.includes(framework)) {
      throw new Error(
        `Invalid framework '${framework}'. Valid options: ${validFrameworks.join(', ')}`
      );
    }

    return {
      primary: framework,
      confidence: 1.0,
      alternates: [],
      details: {
        [framework]: {
          manualOverride: {
            matches: 1,
            weight: 100,
            score: 100
          }
        }
      },
      manualOverride: true
    };
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  let projectRoot = process.cwd();
  let manualFramework = null;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--framework' && args[i + 1]) {
      manualFramework = args[i + 1];
      i++; // Skip next arg
    } else if (!args[i].startsWith('--')) {
      projectRoot = args[i];
    }
  }

  const detector = new FrameworkDetector(projectRoot, null, {
    framework: manualFramework
  });

  detector.detect()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('Detection failed:', error.message);
      process.exit(1);
    });
}

module.exports = FrameworkDetector;
