#!/usr/bin/env node

/**
 * Cloud Provider Detection System
 *
 * Multi-signal detection algorithm for identifying cloud provider usage in projects.
 * Analyzes Terraform, package manifests, CLI scripts, Docker configs, and project files.
 *
 * @module detect-cloud-provider
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

/**
 * Load detection patterns from cloud-provider-patterns.json
 * @returns {Object} Detection patterns configuration
 */
function loadPatterns() {
  const patternsPath = path.join(__dirname, 'cloud-provider-patterns.json');
  const patternsJson = fs.readFileSync(patternsPath, 'utf8');
  return JSON.parse(patternsJson);
}

/**
 * Search for pattern matches in file content
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
 * @returns {number} Match count
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
 * @returns {number} Match count
 */
async function analyzeCliScripts(projectPath, patterns) {
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
 * @returns {number} Match count
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
 * Calculate confidence score for a cloud provider
 * @param {Object} detectionSignals - Signal detection results
 * @param {Object} signalWeights - Weight configuration for each signal type
 * @param {number} confidenceBoost - Additional boost for provider
 * @param {number} signalCount - Number of signals detected
 * @param {number} minimumSignalsForBoost - Minimum signals needed for boost
 * @returns {number} Confidence score (0-1)
 */
function calculateConfidence(detectionSignals, signalWeights, confidenceBoost, signalCount, minimumSignalsForBoost) {
  let weightedScore = 0;
  let totalWeight = 0;

  for (const [signalType, detected] of Object.entries(detectionSignals)) {
    if (detected && signalWeights[signalType]) {
      weightedScore += signalWeights[signalType].weight;
    }
    if (signalWeights[signalType]) {
      totalWeight += signalWeights[signalType].weight;
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

/**
 * Detect cloud provider usage in project
 * @param {string} projectPath - Root project directory
 * @param {Object} options - Detection options
 * @param {string} options.provider - Manual provider override (aws|gcp|azure)
 * @param {number} options.minimumConfidence - Minimum confidence threshold (default: 0.7)
 * @returns {Promise<Object>} Detection results
 */
async function detectCloudProvider(projectPath, options = {}) {
  const patterns = loadPatterns();
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
      const matches = await analyzeCliScripts(projectPath, providerConfig.detection_signals.cli.patterns);
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
      all_results: results
    };
  }

  return {
    detected: false,
    confidence: topResult ? topResult.confidence : 0,
    all_results: results
  };
}

/**
 * CLI interface for cloud provider detection
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const projectPath = args[0] || process.cwd();
  const options = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      options.provider = args[i + 1];
      i++;
    } else if (args[i] === '--min-confidence' && args[i + 1]) {
      options.minimumConfidence = parseFloat(args[i + 1]);
      i++;
    }
  }

  try {
    const result = await detectCloudProvider(projectPath, options);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.detected ? 0 : 1);
  } catch (error) {
    console.error('Error detecting cloud provider:', error.message);
    process.exit(2);
  }
}

// Run CLI if called directly
if (require.main === module) {
  main();
}

module.exports = {
  detectCloudProvider,
  loadPatterns
};
