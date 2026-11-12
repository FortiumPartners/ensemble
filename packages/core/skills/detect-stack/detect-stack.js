#!/usr/bin/env node
'use strict';

/**
 * detect-stack - detect a project's framework, test runner, infrastructure
 * tooling and cloud provider.
 *
 * One CLI and one output envelope for four detection axes. Each axis keeps the
 * detection logic, weights and thresholds of the detector it replaced:
 *
 *   framework  NestJS, React, Phoenix, Rails, .NET, Blazor   (was framework-detector)
 *   test       Jest, pytest, RSpec, xUnit, ExUnit            (was test-detector)
 *   tooling    Helm, Kubernetes, Kustomize, ArgoCD, Fly.io   (was tooling-detector)
 *   cloud      AWS, GCP, Azure                               (was cloud-provider-detector)
 *
 * CLI:  node detect-stack.js [project-path] [--axis=framework|test|tooling|cloud|all] [options]
 * API:  const { detect } = require('./detect-stack');
 *       const result = await detect('framework', '/path/to/project');
 *
 * Every axis engine below returns its own raw shape; the normalize* functions
 * turn those into the shared envelope (see SKILL.md, "Output envelope").
 * Detector names in the output (react, jest, helm, aws, ...) are the pattern
 * keys in patterns/<axis>.json and equal the names of the skills they select.
 *
 * Exit codes: 0 = something detected, 1 = nothing detected, 2 = usage or runtime error.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// "glob" is declared in this plugin's dependencies, but a skill directory installed or copied
// without them - which is how the shipped Pi copy is distributed - has no node_modules of its
// own. Requiring it at load time made both `require('./detect-stack')` and
// `node detect-stack.js` throw MODULE_NOT_FOUND before any argument was read, so the package is
// required on first use instead. When it is missing, a wildcard lookup yields no matches and is
// recorded: the scan still answers, and its envelope says the file evidence was incomplete. A
// pattern with no wildcard is a plain relative existence check and needs none of the glob
// machinery, so those lookups answer exactly as they did before.
let globModule;
async function glob(pattern, options = {}) {
  if (globModule === undefined) {
    try {
      globModule = require('glob').glob;
    } catch (err) {
      if (!err || err.code !== 'MODULE_NOT_FOUND') throw err;
      globModule = null;
      warnMissingGlob();
    }
  }
  if (globModule !== null) return globModule(pattern, options);
  if (!pattern.includes('*')) return lookupLiteralPath(pattern, options);
  globUnavailable = true;
  return [];
}

let globUnavailable = false;
let globWarningShown = false;

function warnMissingGlob() {
  if (globWarningShown) return;
  globWarningShown = true;
  process.stderr.write(
    '[detect-stack] the optional dependency "glob" is not installed, so wildcard file lookups '
    + 'yield no matches: detections that rely on them (*.csproj, source imports and decorators, '
    + 'test file patterns, Terraform and cloud script scans) can be reported lower or missed. '
    + 'Those axis envelopes carry "degraded": "glob-unavailable".\n'
  );
}

function lookupLiteralPath(pattern, options) {
  const root = options.cwd || process.cwd();
  const file = path.resolve(root, pattern);
  try {
    if (!fs.statSync(file).isFile()) return [];
  } catch {
    return [];
  }
  return [options.absolute ? file : path.relative(root, file).split(path.sep).join('/')];
}

const AXES = ['framework', 'test', 'tooling', 'cloud'];
const PATTERNS_DIR = path.join(__dirname, 'patterns');

function patternsPathFor(axis) {
  return path.join(PATTERNS_DIR, `${axis}.json`);
}

/** Synchronously load patterns/<axis>.json (tooling, cloud and envelope helpers). */
function loadAxisPatterns(axis) {
  return JSON.parse(fs.readFileSync(patternsPathFor(axis), 'utf8'));
}

function countTrue(map) {
  return Object.values(map).filter(Boolean).length;
}

/**
 * Count regex matches of any pattern in file content.
 * Shared by the tooling and cloud axes (identical in both original detectors).
 * @param {string} content - File content to search
 * @param {string[]} patterns - Regex patterns to match
 * @returns {number} Number of pattern matches found
 */
function findPatternMatches(content, patterns) {
  let matches = 0;
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'gm');
    const found = content.match(regex);
    if (found) {
      matches += found.length;
    }
  }
  return matches;
}

/**
 * Weighted signal confidence with the multi-signal boost.
 * Shared by the tooling and cloud axes (identical in both original detectors):
 * confidence = detected weight / total weight of all configured signals, plus
 * the entry's confidence_boost once signalCount reaches minimumSignalsForBoost,
 * capped at 1.0.
 * @param {Object} detectionSignals - Signal name -> detected boolean
 * @param {Object} signalConfigs - Signal name -> { weight, ... }
 * @param {number} confidenceBoost - Additional boost for the entry
 * @param {number} signalCount - Number of signals detected
 * @param {number} minimumSignalsForBoost - Minimum signals needed for the boost
 * @returns {number} Confidence score (0-1)
 */
function calculateConfidence(detectionSignals, signalConfigs, confidenceBoost, signalCount, minimumSignalsForBoost) {
  let weightedScore = 0;
  let totalWeight = 0;

  for (const [signalType, detected] of Object.entries(detectionSignals)) {
    if (detected && signalConfigs[signalType]) {
      weightedScore += signalConfigs[signalType].weight;
    }
    if (signalConfigs[signalType]) {
      totalWeight += signalConfigs[signalType].weight;
    }
  }

  // Normalize to 0-1 range
  let confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;

  // Apply multi-signal boost if threshold met
  if (signalCount >= minimumSignalsForBoost) {
    confidence = Math.min(1.0, confidence + confidenceBoost);
  }

  return confidence;
}

// ===========================================================================
// Axis: framework  (was framework-detector)
//
// Multi-signal detection with confidence scoring for 6 frameworks:
// NestJS, React, Phoenix, Rails, .NET, Blazor.
//
// Detection signals:
//   1. Package manager dependencies (package.json, Gemfile, mix.exs, *.csproj)
//   2. Required/optional files
//   3. Import statements in source files
//   4. Boost factors for strong indicators
//
// Related: TRD-011, TRD-012, TRD-014 (manual override),
// docs/TRD/skills-based-framework-agents-trd.md
// ===========================================================================

class FrameworkDetector {
  constructor(projectRoot, patternsPath, options = {}) {
    this.projectRoot = projectRoot || process.cwd();
    this.patternsPath = patternsPath || patternsPathFor('framework');
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
   * @returns {Promise<Object>} Raw result: primary framework, confidence, alternates, details, scores
   */
  async detect(options = {}) {
    globUnavailable = false;
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
        skipped: true,
        glob_unavailable: globUnavailable
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
      details: Object.fromEntries(this.detectionResults),
      // Every framework that produced at least one signal (including those
      // below the confidence threshold), best first. Feeds all_results.
      scores: Array.from(normalized.values())
        .map(s => ({ framework: s.framework, confidence: s.confidence }))
        .sort((a, b) => b.confidence - a.confidence),
      glob_unavailable: globUnavailable
    };
  }

  /**
   * Load framework patterns from JSON file
   */
  async loadPatterns() {
    try {
      const content = await fsp.readFile(this.patternsPath, 'utf-8');
      this.patterns = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load patterns: ${error.message}`, { cause: error });
    }
  }

  /**
   * Detect from package.json (Node.js projects)
   */
  async detectFromPackageJson() {
    const pkgPath = path.join(this.projectRoot, 'package.json');

    try {
      const content = await fsp.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };

      for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
        if (!config.patterns.packageJson) continue;

        const { dependencies, weight, minMatches = 1 } = config.patterns.packageJson;
        let matches = 0;

        // Check dependencies
        if (dependencies) {
          matches += dependencies.filter(dep => allDeps[dep]).length;
        }

        if (matches >= minMatches) {
          this.addSignal(framework, 'packageJson', matches, weight);
        }
      }
    } catch {
      // No package.json or parse error - skip
    }
  }

  /**
   * Detect from Gemfile (Ruby projects)
   */
  async detectFromGemfile() {
    const gemfilePath = path.join(this.projectRoot, 'Gemfile');

    try {
      const content = await fsp.readFile(gemfilePath, 'utf-8');

      for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
        if (!config.patterns.gemfile) continue;

        const { gems, weight, minMatches = 1 } = config.patterns.gemfile;
        const matches = gems.filter(gem => content.includes(gem)).length;

        if (matches >= minMatches) {
          this.addSignal(framework, 'gemfile', matches, weight);
        }
      }
    } catch {
      // No Gemfile - skip
    }
  }

  /**
   * Detect from mix.exs (Elixir projects)
   */
  async detectFromMixExs() {
    const mixPath = path.join(this.projectRoot, 'mix.exs');

    try {
      const content = await fsp.readFile(mixPath, 'utf-8');

      for (const [framework, config] of Object.entries(this.patterns.frameworks)) {
        if (!config.patterns.mixExs) continue;

        const { dependencies, weight, minMatches = 1 } = config.patterns.mixExs;
        const matches = dependencies.filter(dep => content.includes(dep)).length;

        if (matches >= minMatches) {
          this.addSignal(framework, 'mixExs', matches, weight);
        }
      }
    } catch {
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
      const content = await fsp.readFile(csprojPath, 'utf-8');

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
    } catch {
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
            const content = await fsp.readFile(filePath, 'utf-8');
            const matches = patterns.filter(pattern => {
              const regex = new RegExp(pattern, 'i');
              return regex.test(content);
            }).length;

            totalMatches += matches;
          } catch {
            // Skip files that can't be read
            continue;
          }
        }

        if (totalMatches > 0) {
          this.addSignal(framework, 'imports', totalMatches, weight);
        }
      } catch {
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
      for (const data of Object.values(signals)) {
        totalScore += data.matches * data.weight;
      }

      // Calculate max possible score for this framework
      const config = this.patterns.frameworks[framework];
      if (config) {
        for (const value of Object.values(config.patterns)) {
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

    for (const data of scores.values()) {
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
      await fsp.access(path.join(this.projectRoot, filePath));
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
      const files = globUnavailable ? [] : await glob(globPattern, {
        cwd: this.projectRoot,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        nodir: true
      });

      const regex = new RegExp(pattern, 'i');

      // Sample first 10 files for performance
      for (const file of files.slice(0, 10)) {
        const filePath = path.join(this.projectRoot, file);
        try {
          const content = await fsp.readFile(filePath, 'utf-8');
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

// ===========================================================================
// Axis: test  (was test-detector)
//
// Detects the test runner(s) a project uses: Jest, pytest, RSpec, xUnit, ExUnit.
// Confidence per runner = sum of: config file +0.4, package dependency +0.3,
// test directory +0.2, test files +0.1 (weights live in patterns/test.json),
// capped at 1.0. Any runner with confidence > 0 is reported; there is no
// minimum threshold on this axis.
// ===========================================================================

class TestFrameworkDetector {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.patterns = null;
    this.debug = process.env.DEBUG === 'true';
  }

  async loadPatterns() {
    const content = await fsp.readFile(patternsPathFor('test'), 'utf-8');
    this.patterns = JSON.parse(content);
  }

  log(message) {
    if (this.debug) {
      console.error(`[DEBUG] ${message}`);
    }
  }

  async detect() {
    globUnavailable = false;
    await this.loadPatterns();

    const results = {
      detected: false,
      frameworks: [],
      primary: null,
      glob_unavailable: false
    };
    const all = [];

    // Detect each framework
    for (const [frameworkId, frameworkConfig] of Object.entries(this.patterns.frameworks)) {
      const detection = await this.detectFramework(frameworkId, frameworkConfig);
      all.push(detection);

      if (detection.confidence > 0) {
        results.frameworks.push(detection);
        results.detected = true;
      }
    }

    // Sort by confidence (highest first)
    results.frameworks.sort((a, b) => b.confidence - a.confidence);

    // Set primary framework (highest confidence)
    if (results.frameworks.length > 0) {
      results.primary = results.frameworks[0].name;
    } else {
      results.message = 'No test framework detected. Please specify framework manually.';
    }

    // Every runner evaluated, including those with no signal. Feeds all_results.
    results.all = all.sort((a, b) => b.confidence - a.confidence);
    results.glob_unavailable = globUnavailable;

    return results;
  }

  async detectFramework(frameworkId, config) {
    this.log(`Detecting ${config.name}...`);

    const result = {
      name: frameworkId,
      displayName: config.name,
      language: config.language,
      confidence: 0,
      version: null,
      configFiles: [],
      testDirectory: null,
      testPattern: null
    };

    const weights = config.confidenceWeights;

    // Check for config files
    for (const configFile of config.configFiles) {
      const configPath = path.join(this.projectPath, configFile);
      if (await this.fileExists(configPath)) {
        result.configFiles.push(configFile);
        result.confidence += weights.configFile;
        this.log(`Found config file: ${configFile}`);
        break; // Only count first config file
      }
    }

    // Check for package dependencies
    const packageInfo = await this.checkPackageDependencies(config);
    if (packageInfo.found) {
      result.confidence += weights.packageDependency;
      result.version = packageInfo.version;
      this.log(`Found package dependency: ${packageInfo.package} (v${packageInfo.version})`);
    }

    // Check for test directories
    for (const testDir of config.testDirectories) {
      const testDirPath = path.join(this.projectPath, testDir);
      if (await this.directoryExists(testDirPath)) {
        result.testDirectory = testDir;
        result.confidence += weights.testDirectory;
        this.log(`Found test directory: ${testDir}`);
        break; // Only count first test directory
      }
    }

    // Check for test files
    const testFiles = await this.findTestFiles(config.testPatterns);
    if (testFiles.length > 0) {
      result.confidence += weights.testFiles;
      result.testPattern = config.testPatterns[0]; // Use first pattern as default
      this.log(`Found ${testFiles.length} test files`);
    }

    // Cap confidence at 1.0
    result.confidence = Math.min(result.confidence, 1.0);

    return result;
  }

  async checkPackageDependencies(config) {
    for (const packageFile of config.packageFiles) {
      // Handle glob patterns in package files (e.g., *.csproj)
      let packagePaths;
      try {
        packagePaths = await glob(packageFile, {
          cwd: this.projectPath,
          absolute: true
        });
      } catch (error) {
        this.log(`Glob error for ${packageFile}: ${error.message}`);
        continue;
      }

      if (!Array.isArray(packagePaths)) {
        packagePaths = [packagePaths];
      }

      for (const packagePath of packagePaths) {
        if (await this.fileExists(packagePath)) {
          const content = await fsp.readFile(packagePath, 'utf-8');

          // Check each package indicator
          for (const indicator of config.packageIndicators) {
            if (content.includes(indicator)) {
              // Try to extract version
              const version = this.extractVersion(content, indicator, packagePath);
              return {
                found: true,
                package: indicator,
                version: version || 'unknown'
              };
            }
          }
        }
      }
    }

    return { found: false };
  }

  extractVersion(content, packageName, filePath) {
    const ext = path.extname(filePath);

    // package.json
    if (ext === '.json') {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return deps[packageName]?.replace(/[\^~]/, '') || null;
      } catch {
        return null;
      }
    }

    // requirements.txt
    if (filePath.includes('requirements')) {
      const match = content.match(new RegExp(`${packageName}[=><~]+([\\d.]+)`));
      return match ? match[1] : null;
    }

    // Gemfile
    if (ext === '' && filePath.includes('Gemfile')) {
      const match = content.match(new RegExp(`gem ['"]${packageName}['"],\\s*['"]~>\\s*([\\d.]+)`));
      return match ? match[1] : null;
    }

    // .csproj
    if (ext === '.csproj') {
      const match = content.match(new RegExp(`<PackageReference Include="${packageName}" Version="([\\d.]+)"`));
      return match ? match[1] : null;
    }

    return null;
  }

  async findTestFiles(patterns) {
    // Test patterns are wildcards by definition, so without the package there is no evidence
    // rather than no tests: the scan stops early and the envelope is marked.
    const files = [];
    if (globUnavailable) return files;

    for (const pattern of patterns) {
      try {
        const matches = await glob(pattern, {
          cwd: this.projectPath,
          ignore: ['node_modules/**', 'vendor/**', '.git/**']
        });
        files.push(...matches);
      } catch {
        // Ignore glob errors for unsupported patterns
      }
    }

    return [...new Set(files)]; // Remove duplicates
  }

  async fileExists(filePath) {
    try {
      const stats = await fsp.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async directoryExists(dirPath) {
    try {
      const stats = await fsp.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}

// ===========================================================================
// Axis: tooling  (was tooling-detector, v2.0.0)
//
// Multi-signal detection of infrastructure tooling: Helm, Kubernetes,
// Kustomize, ArgoCD, Fly.io.
//
// Performance optimizations (kept from the original):
// - LRU cache for detection results (cache key: project path + mtimes of the
//   primary signal files; entries expire after 5 minutes)
// - Parallel signal and tool detection with Promise.all
// - Depth-limited file globs (3 levels for file checks, 5 for content scans)
//
// The original used fast-glob, which is not a dependency of this repository.
// This axis uses `glob`, which the other three axes already use, with the same
// patterns, ignore lists and depth limits. Like the original it matches regular
// files only: symlinks are skipped by glob matches (direct paths are checked
// with fs.existsSync, which follows them) and symlinked directories are not
// traversed.
// ===========================================================================

/**
 * LRU Cache for detection results
 * Cache key: projectPath + mtime of key files
 * Cache expiration: 5 minutes or file modification
 */
class DetectionCache {
  constructor(maxSize = 100, ttl = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  _generateKey(projectPath, keyFiles) {
    const mtimes = keyFiles
      .map(file => {
        try {
          const stat = fs.statSync(path.join(projectPath, file));
          return `${file}:${stat.mtimeMs}`;
        } catch {
          return `${file}:0`;
        }
      })
      .join('|');
    return `${projectPath}|${mtimes}`;
  }

  get(projectPath, keyFiles) {
    const key = this._generateKey(projectPath, keyFiles);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data;
  }

  set(projectPath, keyFiles, data) {
    const key = this._generateKey(projectPath, keyFiles);

    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clear() {
    this.cache.clear();
  }
}

// Global cache instance
const detectionCache = new DetectionCache();

const TOOLING_IGNORE = ['**/node_modules/**', '**/.git/**', '**/vendor/**'];
const TOOLING_FILE_DEPTH = 3; // deep limit for file existence checks
const TOOLING_SCAN_DEPTH = 5; // deep limit for content scans

/**
 * Glob for regular files under a project (no directories, no symlinks).
 * @param {string} projectPath - Root project directory
 * @param {string} pattern - Glob pattern
 * @param {string[]} ignore - Ignore patterns
 * @param {number} [maxDepth] - Directory depth limit (unlimited when omitted)
 * @returns {Promise<string[]>} Matching paths relative to projectPath
 */
async function globFiles(projectPath, pattern, ignore, maxDepth) {
  const options = { cwd: projectPath, ignore, nodir: true };
  if (maxDepth) {
    options.maxDepth = maxDepth;
  }
  const matches = await glob(pattern, options);
  return matches.filter(match => {
    try {
      return fs.lstatSync(path.join(projectPath, match)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Check if specific files exist (supports glob patterns)
 * Optimized: direct paths are checked before any glob runs
 * @param {string} projectPath - Root project directory
 * @param {string|string[]} files - File path or list of file paths to check (supports glob patterns)
 * @returns {Promise<boolean>} True if any files exist
 */
async function checkFiles(projectPath, files) {
  const fileList = Array.isArray(files) ? files : [files];

  // Optimize: check non-glob files first (faster)
  const directFiles = fileList.filter(f => !f.includes('*') && !f.includes('?') && !f.includes('['));
  for (const file of directFiles) {
    const filePath = path.join(projectPath, file);
    if (fs.existsSync(filePath)) {
      return true;
    }
  }

  // Then check glob patterns
  const globPatterns = fileList.filter(f => f.includes('*') || f.includes('?') || f.includes('['));
  for (const file of globPatterns) {
    try {
      const matches = await globFiles(projectPath, file, TOOLING_IGNORE, TOOLING_FILE_DEPTH);
      if (matches.length > 0) {
        return true;
      }
    } catch {
      // If glob fails, continue to next file
      continue;
    }
  }
  return false;
}

/**
 * Check if specific directories exist
 * @param {string} projectPath - Root project directory
 * @param {string[]} directories - List of directory paths to check
 * @returns {boolean} True if any directories exist
 */
function checkDirectories(projectPath, directories) {
  for (const dir of directories) {
    const dirPath = path.join(projectPath, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      return true;
    }
  }
  return false;
}

/**
 * Analyze files matching pattern for tool-specific patterns
 * Optimized with depth limit and early exit for existence checks
 * @param {string} projectPath - Root project directory
 * @param {string} filePattern - Glob pattern for files
 * @param {string[]} patterns - Tool-specific patterns to match
 * @param {boolean} existenceOnly - Only check if any match exists (early exit)
 * @returns {Promise<number>} Number of files with matches
 */
async function analyzeFiles(projectPath, filePattern, patterns, existenceOnly = false) {
  let fileList;
  try {
    fileList = await globFiles(projectPath, filePattern, TOOLING_IGNORE, TOOLING_SCAN_DEPTH);
  } catch {
    // If glob fails, return 0
    return 0;
  }

  let filesWithMatches = 0;
  for (const file of fileList) {
    const filePath = path.join(projectPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (findPatternMatches(content, patterns) > 0) {
        filesWithMatches++;
        // Early exit for existence checks
        if (existenceOnly) {
          return 1;
        }
      }
    } catch {
      // Skip files that can't be read
      continue;
    }
  }

  return filesWithMatches;
}

/**
 * Detect signals for a single tool (optimized with parallel detection)
 * @param {string} projectPath - Root project directory
 * @param {string} toolKey - Tool identifier
 * @param {Object} toolConfig - Tool configuration
 * @param {Object} detection_rules - Global detection rules
 * @returns {Promise<Object>} Tool detection result
 */
async function detectToolSignals(projectPath, toolKey, toolConfig, detection_rules) {
  const signals = {};
  let signalCount = 0;

  // Parallel signal detection - check all signals concurrently
  const signalChecks = Object.entries(toolConfig.detection_signals).map(
    async ([signalType, signalConfig]) => {
      let detected = false;

      // File existence check (simple check, supports glob patterns)
      if (signalConfig.files) {
        detected = await checkFiles(projectPath, signalConfig.files);
      }
      // Directory existence check
      else if (signalConfig.directories) {
        detected = checkDirectories(projectPath, signalConfig.directories);
      }
      // File pattern analysis with content patterns (single pattern)
      else if (signalConfig.file_pattern && signalConfig.patterns) {
        // Use existenceOnly mode for faster detection (early exit)
        const matches = await analyzeFiles(projectPath, signalConfig.file_pattern, signalConfig.patterns, true);
        detected = matches > 0;
      }
      // File pattern analysis with content patterns (multiple patterns)
      else if (signalConfig.file_patterns && signalConfig.patterns) {
        // Check patterns in parallel for faster detection
        const patternChecks = signalConfig.file_patterns.map(filePattern =>
          analyzeFiles(projectPath, filePattern, signalConfig.patterns, true)
        );
        const results = await Promise.all(patternChecks);
        detected = results.some(r => r > 0);
      }

      return { signalType, detected, weight: signalConfig.weight };
    }
  );

  // Wait for all signal checks to complete
  const signalResults = await Promise.all(signalChecks);

  // Process results; flag tools whose primary signal (weight >= 0.7) fired
  let highConfidenceDetected = false;
  for (const { signalType, detected, weight } of signalResults) {
    signals[signalType] = detected;
    if (detected) {
      signalCount++;
      if (weight >= 0.7) {
        highConfidenceDetected = true;
      }
    }
  }

  // Calculate confidence
  const confidence = calculateConfidence(
    signals,
    toolConfig.detection_signals,
    toolConfig.confidence_boost || 0,
    signalCount,
    detection_rules.minimum_signals_for_boost
  );

  return {
    tool: toolKey,
    name: toolConfig.name,
    description: toolConfig.description,
    confidence,
    signals,
    signal_count: signalCount,
    high_confidence: highConfidenceDetected
  };
}

/**
 * Detect infrastructure tooling usage in project
 * Optimized with caching and parallel detection
 * @param {string} projectPath - Root project directory
 * @param {Object} options - Detection options
 * @param {string[]} options.tools - Specific tools to detect (helm|kubernetes|kustomize|argocd|flyio)
 * @param {number} options.minimumConfidence - Minimum confidence threshold (default: 0.7)
 * @param {boolean} options.useCache - Use detection cache (default: true)
 * @returns {Promise<Object>} Raw detection results
 */
async function detectTooling(projectPath, options = {}) {
  globUnavailable = false;
  const patterns = loadAxisPatterns('tooling');
  const { tools, detection_rules } = patterns;

  // Filter tools if specific tools requested
  const toolsToCheck = options.tools
    ? Object.keys(tools).filter(t => options.tools.includes(t))
    : Object.keys(tools);

  // Primary signal files form the cache key
  const keyFiles = toolsToCheck.flatMap(toolKey => {
    const toolConfig = tools[toolKey];
    return Object.values(toolConfig.detection_signals)
      .filter(s => s.weight >= 0.5)
      .flatMap(s => s.files || []);
  });

  // Check cache (enabled by default)
  const useCache = options.useCache !== false;
  if (useCache) {
    const cachedResult = detectionCache.get(projectPath, keyFiles);
    if (cachedResult) {
      return cachedResult;
    }
  }

  // Parallel tool detection - check all tools concurrently
  const toolDetections = await Promise.all(
    toolsToCheck.map(toolKey =>
      detectToolSignals(projectPath, toolKey, tools[toolKey], detection_rules)
    )
  );

  // Sort by confidence
  toolDetections.sort((a, b) => b.confidence - a.confidence);

  // Get minimum confidence threshold
  const minimumConfidence = options.minimumConfidence || detection_rules.minimum_confidence;

  // Filter detected tools (confidence >= threshold)
  const detectedTools = toolDetections.filter(r => r.confidence >= minimumConfidence);

  const result = {
    detected: detectedTools.length > 0,
    tools: detectedTools,
    all_results: toolDetections,
    // Stored with the cached value so a replay cannot report a degraded scan as a complete one.
    glob_unavailable: globUnavailable,
    detection_summary: {
      total_analyzed: toolDetections.length,
      detected_count: detectedTools.length,
      minimum_confidence: minimumConfidence
    }
  };

  // Cache the result
  if (useCache) {
    detectionCache.set(projectPath, keyFiles, result);
  }

  return result;
}

// ===========================================================================
// Axis: cloud  (was cloud-provider-detector)
//
// Multi-signal detection of cloud provider usage: AWS, GCP, Azure. Analyzes
// Terraform files, package manifests, CLI scripts, Dockerfiles and config files.
// ===========================================================================

/**
 * Check if specific config files exist
 * @param {string} projectPath - Root project directory
 * @param {string[]} files - List of file paths to check
 * @returns {boolean} True if any config files exist
 */
function checkConfigFiles(projectPath, files) {
  for (const file of files) {
    const filePath = path.join(projectPath, file);
    if (fs.existsSync(filePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Analyze Terraform files for provider patterns
 * @param {string} projectPath - Root project directory
 * @param {string[]} patterns - Provider-specific Terraform patterns
 * @returns {Promise<number>} Match count
 */
async function analyzeTerraform(projectPath, patterns) {
  const tfFiles = await glob('**/*.tf', { cwd: projectPath, ignore: ['**/node_modules/**', '**/.git/**'] });

  let totalMatches = 0;
  for (const file of tfFiles) {
    const filePath = path.join(projectPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    totalMatches += findPatternMatches(content, patterns);
  }

  return totalMatches;
}

/**
 * Analyze package.json for cloud SDK dependencies
 * @param {string} projectPath - Root project directory
 * @param {string[]} patterns - Provider-specific package patterns
 * @returns {number} Match count
 */
function analyzeNpmPackages(projectPath, patterns) {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return 0;
  }

  const content = fs.readFileSync(packageJsonPath, 'utf8');
  return findPatternMatches(content, patterns);
}

/**
 * Analyze requirements.txt for cloud SDK dependencies
 * @param {string} projectPath - Root project directory
 * @param {string[]} patterns - Provider-specific package patterns
 * @returns {number} Match count
 */
function analyzePythonPackages(projectPath, patterns) {
  const requirementsPath = path.join(projectPath, 'requirements.txt');

  if (!fs.existsSync(requirementsPath)) {
    return 0;
  }

  const content = fs.readFileSync(requirementsPath, 'utf8');
  return findPatternMatches(content, patterns);
}

/**
 * Analyze shell scripts for CLI usage
 * @param {string} projectPath - Root project directory
 * @param {string[]} patterns - Provider-specific CLI patterns
 * @returns {Promise<number>} Match count
 */
async function analyzeCloudCliScripts(projectPath, patterns) {
  const scriptFiles = await glob('**/*.sh', { cwd: projectPath, ignore: ['**/node_modules/**', '**/.git/**'] });

  let totalMatches = 0;
  for (const file of scriptFiles) {
    const filePath = path.join(projectPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    totalMatches += findPatternMatches(content, patterns);
  }

  return totalMatches;
}

/**
 * Analyze Dockerfiles for base images
 * @param {string} projectPath - Root project directory
 * @param {string[]} patterns - Provider-specific Docker patterns
 * @returns {Promise<number>} Match count
 */
async function analyzeDockerfiles(projectPath, patterns) {
  const dockerFiles = await glob('**/Dockerfile*', { cwd: projectPath, ignore: ['**/node_modules/**', '**/.git/**'] });

  let totalMatches = 0;
  for (const file of dockerFiles) {
    const filePath = path.join(projectPath, file);
    const content = fs.readFileSync(filePath, 'utf8');
    totalMatches += findPatternMatches(content, patterns);
  }

  return totalMatches;
}

/**
 * Detect cloud provider usage in project
 * @param {string} projectPath - Root project directory
 * @param {Object} options - Detection options
 * @param {string} options.provider - Manual provider override (aws|gcp|azure)
 * @param {number} options.minimumConfidence - Minimum confidence threshold (default: 0.7)
 * @returns {Promise<Object>} Raw detection results
 */
async function detectCloudProvider(projectPath, options = {}) {
  globUnavailable = false;
  const patterns = loadAxisPatterns('cloud');
  const { providers, detection_rules } = patterns;

  // Manual override
  if (options.provider) {
    const providerKey = options.provider.toLowerCase();
    if (providers[providerKey]) {
      return {
        detected: true,
        provider: providerKey,
        name: providers[providerKey].name,
        confidence: 1.0,
        manual_override: true,
        signals: {}
      };
    }
  }

  const results = [];

  // Analyze each provider
  for (const [providerKey, providerConfig] of Object.entries(providers)) {
    const signals = {};
    let signalCount = 0;

    // Terraform analysis
    if (providerConfig.detection_signals.terraform) {
      const matches = await analyzeTerraform(projectPath, providerConfig.detection_signals.terraform.patterns);
      signals.terraform = matches > 0;
      if (matches > 0) signalCount++;
    }

    // NPM package analysis
    if (providerConfig.detection_signals.npm) {
      const matches = analyzeNpmPackages(projectPath, providerConfig.detection_signals.npm.patterns);
      signals.npm = matches > 0;
      if (matches > 0) signalCount++;
    }

    // Python package analysis
    if (providerConfig.detection_signals.python) {
      const matches = analyzePythonPackages(projectPath, providerConfig.detection_signals.python.patterns);
      signals.python = matches > 0;
      if (matches > 0) signalCount++;
    }

    // CLI script analysis
    if (providerConfig.detection_signals.cli) {
      const matches = await analyzeCloudCliScripts(projectPath, providerConfig.detection_signals.cli.patterns);
      signals.cli = matches > 0;
      if (matches > 0) signalCount++;
    }

    // Docker analysis
    if (providerConfig.detection_signals.docker) {
      const matches = await analyzeDockerfiles(projectPath, providerConfig.detection_signals.docker.patterns);
      signals.docker = matches > 0;
      if (matches > 0) signalCount++;
    }

    // Config file analysis
    if (providerConfig.detection_signals.config) {
      const exists = checkConfigFiles(projectPath, providerConfig.detection_signals.config.files);
      signals.config = exists;
      if (exists) signalCount++;
    }

    // Calculate confidence
    const confidence = calculateConfidence(
      signals,
      providerConfig.detection_signals,
      providerConfig.confidence_boost,
      signalCount,
      detection_rules.minimum_signals_for_boost
    );

    results.push({
      provider: providerKey,
      name: providerConfig.name,
      confidence,
      signals,
      signal_count: signalCount
    });
  }

  // Sort by confidence
  results.sort((a, b) => b.confidence - a.confidence);

  // Get minimum confidence threshold
  const minimumConfidence = options.minimumConfidence || detection_rules.minimum_confidence;

  // Return top result if it meets threshold
  const topResult = results[0];
  if (topResult && topResult.confidence >= minimumConfidence) {
    return {
      detected: true,
      provider: topResult.provider,
      name: topResult.name,
      confidence: topResult.confidence,
      signals: topResult.signals,
      signal_count: topResult.signal_count,
      all_results: results,
      minimum_confidence: minimumConfidence,
      glob_unavailable: globUnavailable
    };
  }

  return {
    detected: false,
    confidence: topResult ? topResult.confidence : 0,
    all_results: results,
    minimum_confidence: minimumConfidence,
    glob_unavailable: globUnavailable
  };
}

// ===========================================================================
// Output envelope
//
// Every axis returns the same shape:
//   { axis, detected, primary, confidence, threshold, results, all_results, ...flags }
// where each entry of results / all_results is
//   { name, display_name, confidence, signals, signal_count, ...axis-specific }
// See SKILL.md, "Output envelope".
// ===========================================================================

const FRAMEWORK_SIGNAL_TYPES = ['packageJson', 'gemfile', 'mixExs', 'csproj', 'files', 'imports'];

function buildEnvelope(axis, { results, allResults, threshold, flags = {} }) {
  const primary = results.length > 0 ? results[0] : null;
  return {
    axis,
    detected: primary !== null,
    primary: primary ? primary.name : null,
    confidence: primary ? primary.confidence : 0,
    threshold,
    results,
    all_results: allResults,
    ...flags
  };
}

function normalizeFramework(raw, patterns) {
  const configs = patterns.frameworks;
  const threshold = patterns.detectionConfig.confidenceThreshold;

  const item = (name, confidence) => {
    const config = configs[name] || {};
    const details = raw.details[name] || {};
    const signals = {};
    if (!raw.manualOverride) {
      for (const type of FRAMEWORK_SIGNAL_TYPES) {
        if (config.patterns && config.patterns[type]) {
          signals[type] = Boolean(details[type]);
        }
      }
    }
    return {
      name,
      display_name: config.name || name,
      confidence,
      signals,
      signal_count: countTrue(signals),
      details
    };
  };

  if (raw.manualOverride) {
    const results = [item(raw.primary, raw.confidence)];
    return buildEnvelope('framework', {
      results,
      allResults: results,
      threshold,
      flags: { manual_override: true }
    });
  }

  if (raw.skipped) {
    return buildEnvelope('framework', {
      results: [],
      allResults: [],
      threshold,
      flags: { skipped: true }
    });
  }

  const results = raw.primary === null
    ? []
    : [
        item(raw.primary, raw.confidence),
        ...raw.alternates.map(a => item(a.framework, a.confidence))
      ];

  // Frameworks with at least one signal, best first, then the rest at confidence 0
  const scored = new Set(raw.scores.map(s => s.framework));
  const allResults = [
    ...raw.scores.map(s => item(s.framework, s.confidence)),
    ...Object.keys(configs).filter(name => !scored.has(name)).map(name => item(name, 0))
  ];

  return buildEnvelope('framework', {
    results,
    allResults,
    threshold,
    flags: raw.glob_unavailable ? { degraded: 'glob-unavailable' } : {}
  });
}

function normalizeTest(raw) {
  const item = d => {
    const signals = {
      configFile: d.configFiles.length > 0,
      packageDependency: d.version !== null,
      testDirectory: d.testDirectory !== null,
      testFiles: d.testPattern !== null
    };
    return {
      name: d.name,
      display_name: d.displayName,
      language: d.language,
      confidence: d.confidence,
      signals,
      signal_count: countTrue(signals),
      version: d.version,
      config_files: d.configFiles,
      test_directory: d.testDirectory,
      test_pattern: d.testPattern
    };
  };

  return buildEnvelope('test', {
    results: raw.frameworks.map(item),
    allResults: raw.all.map(item),
    threshold: null, // any confidence above 0 counts
    flags: {
      ...(raw.glob_unavailable ? { degraded: 'glob-unavailable' } : {}),
      ...(raw.message ? { message: raw.message } : {})
    }
  });
}

function normalizeTooling(raw) {
  const item = t => ({
    name: t.tool,
    display_name: t.name,
    description: t.description,
    confidence: t.confidence,
    signals: { ...t.signals },
    signal_count: t.signal_count,
    high_confidence: t.high_confidence
  });

  return buildEnvelope('tooling', {
    results: raw.tools.map(item),
    allResults: raw.all_results.map(item),
    threshold: raw.detection_summary.minimum_confidence,
    flags: raw.glob_unavailable ? { degraded: 'glob-unavailable' } : {}
  });
}

function normalizeCloud(raw, patterns) {
  const item = r => ({
    name: r.provider,
    display_name: r.name,
    confidence: r.confidence,
    signals: { ...r.signals },
    signal_count: r.signal_count ?? countTrue(r.signals)
  });

  if (raw.manual_override) {
    const results = [item(raw)];
    return buildEnvelope('cloud', {
      results,
      allResults: results,
      threshold: patterns.detection_rules.minimum_confidence,
      flags: { manual_override: true }
    });
  }

  const allResults = raw.all_results.map(item);
  return buildEnvelope('cloud', {
    results: allResults.filter(r => r.confidence >= raw.minimum_confidence),
    allResults,
    threshold: raw.minimum_confidence,
    flags: raw.glob_unavailable ? { degraded: 'glob-unavailable' } : {}
  });
}

// ===========================================================================
// Public API
// ===========================================================================

function requireKnown(kind, values, valid) {
  const unknown = values.filter(value => !valid.includes(value));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${kind} '${unknown.join("', '")}'. Valid ${kind}s: ${valid.join(', ')}`);
  }
}

const AXIS_RUNNERS = {
  async framework(projectPath, options) {
    const detector = new FrameworkDetector(projectPath, null, {
      framework: options.framework,
      skipDetection: options.skipDetection
    });
    const raw = await detector.detect();
    return normalizeFramework(raw, loadAxisPatterns('framework'));
  },

  async test(projectPath) {
    const raw = await new TestFrameworkDetector(projectPath).detect();
    return normalizeTest(raw);
  },

  async tooling(projectPath, options) {
    if (options.tools) {
      requireKnown('tool', options.tools, Object.keys(loadAxisPatterns('tooling').tools));
    }
    const raw = await detectTooling(projectPath, {
      tools: options.tools,
      minimumConfidence: options.minimumConfidence,
      useCache: options.useCache
    });
    return normalizeTooling(raw);
  },

  async cloud(projectPath, options) {
    const patterns = loadAxisPatterns('cloud');
    if (options.provider) {
      requireKnown('provider', [options.provider.toLowerCase()], Object.keys(patterns.providers));
    }
    const raw = await detectCloudProvider(projectPath, {
      provider: options.provider,
      minimumConfidence: options.minimumConfidence
    });
    return normalizeCloud(raw, patterns);
  }
};

/**
 * Detect one axis of a project's stack, or all of them.
 * @param {'framework'|'test'|'tooling'|'cloud'|'all'} axis
 * @param {string} [projectPath] - Project root (default: current directory)
 * @param {Object} [options]
 * @param {string} [options.framework] - framework: manual override (skips detection)
 * @param {boolean} [options.skipDetection] - framework: return an empty result without scanning
 * @param {string[]} [options.tools] - tooling: only evaluate these tools
 * @param {boolean} [options.useCache] - tooling: use the in-process cache (default true)
 * @param {string} [options.provider] - cloud: manual override (aws|gcp|azure)
 * @param {number} [options.minimumConfidence] - tooling, cloud: detection threshold
 * @returns {Promise<Object>} Envelope for one axis, or { axis: 'all', detected, axes }
 */
async function detect(axis, projectPath = process.cwd(), options = {}) {
  const root = path.resolve(projectPath);

  if (axis === 'all') {
    const entries = await Promise.all(AXES.map(name => AXIS_RUNNERS[name](root, options)));
    const axes = Object.fromEntries(AXES.map((name, i) => [name, entries[i]]));
    return {
      axis: 'all',
      detected: entries.some(entry => entry.detected),
      axes
    };
  }

  if (!AXES.includes(axis)) {
    throw new Error(`Unknown axis '${axis}'. Valid axes: ${AXES.join(', ')}, all`);
  }
  return AXIS_RUNNERS[axis](root, options);
}

// ===========================================================================
// CLI
// ===========================================================================

const USAGE = `Usage: detect-stack.js [project-path] [--axis=<axis>] [options]

Axes (default: all):
  framework   NestJS, React, Phoenix, Rails, .NET, Blazor
  test        Jest, pytest, RSpec, xUnit, ExUnit
  tooling     Helm, Kubernetes, Kustomize, ArgoCD, Fly.io
  cloud       AWS, GCP, Azure
  all         Run every axis; output { axis: "all", detected, axes }

Options:
  --axis=<axis>           Axis to run (also: --axis <axis>)
  --framework=<name>      framework: manual override, skips detection
  --provider=<name>       cloud: manual override (aws|gcp|azure)
  --tools=<a,b>           tooling: only evaluate these tools
  --min-confidence=<n>    tooling, cloud: detection threshold, 0 < n <= 1 (default 0.7)
  -h, --help              Show this help

Exit codes: 0 = detected, 1 = nothing detected, 2 = usage or runtime error`;

class UsageError extends Error {}

const VALUE_OPTIONS = new Set(['axis', 'framework', 'provider', 'tools', 'min-confidence']);

function parseArgs(argv) {
  const parsed = { axis: 'all', projectPath: undefined, options: {}, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
      continue;
    }

    if (arg.startsWith('-') && !arg.startsWith('--')) {
      throw new UsageError(`Unknown option: ${arg}`);
    }

    if (!arg.startsWith('--')) {
      if (parsed.projectPath !== undefined) {
        throw new UsageError(`Unexpected argument: ${arg}`);
      }
      parsed.projectPath = arg;
      continue;
    }

    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!VALUE_OPTIONS.has(name)) {
      throw new UsageError(`Unknown option: --${name}`);
    }

    let value;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Option --${name} requires a value`);
      }
    }

    if (value === '') {
      throw new UsageError(`Option --${name} requires a value`);
    }

    switch (name) {
      case 'axis':
        if (value !== 'all' && !AXES.includes(value)) {
          throw new UsageError(`Unknown axis '${value}'. Valid axes: ${AXES.join(', ')}, all`);
        }
        parsed.axis = value;
        break;
      case 'framework':
        parsed.options.framework = value;
        break;
      case 'provider':
        parsed.options.provider = value;
        break;
      case 'tools':
        parsed.options.tools = value.split(',').map(tool => tool.trim().toLowerCase()).filter(Boolean);
        break;
      case 'min-confidence': {
        const minimum = Number(value);
        if (!(minimum > 0 && minimum <= 1)) {
          throw new UsageError('--min-confidence must be a number greater than 0 and at most 1');
        }
        parsed.options.minimumConfidence = minimum;
        break;
      }
    }
  }

  return parsed;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`detect-stack: ${error.message}\nRun 'detect-stack.js --help' for usage.`);
    return 2;
  }

  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }

  const projectPath = path.resolve(parsed.projectPath || process.cwd());
  try {
    if (!fs.statSync(projectPath).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    console.error(`detect-stack: project path is not a directory: ${projectPath}`);
    return 2;
  }

  try {
    const result = await detect(parsed.axis, projectPath, parsed.options);
    console.log(JSON.stringify(result, null, 2));
    return result.detected ? 0 : 1;
  } catch (error) {
    console.error(`detect-stack: ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}

module.exports = {
  AXES,
  detect,
  FrameworkDetector,
  TestFrameworkDetector,
  detectionCache
};
