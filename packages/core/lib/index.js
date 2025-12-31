/**
 * Ensemble Core Plugin
 * @fortium/ensemble-core
 *
 * Core utilities including framework detection and configuration management
 */

const path = require('path');

// Framework Detector
const detectFramework = require('./detect-framework');
const frameworkPatterns = require('./framework-patterns.json');

// Configuration Path Management (XDG-compliant)
const configPath = require('./config-path');

// Context7 MCP Integration
const context7 = require('./context7-integration');

const skill = {
  name: 'Framework Detector',
  version: '1.0.0',
  description: 'Multi-signal framework detection with confidence scoring for major frameworks',

  capabilities: [
    'framework-detection',
    'language-detection',
    'confidence-scoring',
    'multi-signal-analysis'
  ],

  supportedFrameworks: [
    'react', 'vue', 'angular', 'svelte',
    'nestjs', 'express', 'rails', 'phoenix',
    'blazor', 'dotnet', 'django', 'flask'
  ]
};

/**
 * Load skill documentation
 * @param {string} type - 'quick' for SKILL.md, 'comprehensive' for REFERENCE.md
 * @returns {string} Path to documentation file
 */
function loadSkill(type = 'quick') {
  const skillsDir = path.join(__dirname, '..', 'skills', 'framework-detector');
  return type === 'comprehensive'
    ? path.join(skillsDir, 'REFERENCE.md')
    : path.join(skillsDir, 'SKILL.md');
}

/**
 * Detect frameworks in a project directory
 * @param {string} projectPath - Path to the project
 * @returns {Promise<Object>} Detection results with confidence scores
 */
async function detect(projectPath) {
  return detectFramework(projectPath);
}

/**
 * Get available framework patterns
 * @returns {Object} Framework patterns configuration
 */
function getPatterns() {
  return frameworkPatterns;
}

module.exports = {
  // Skill metadata
  skill,
  loadSkill,

  // Framework detector
  detect,
  detectFramework,
  getPatterns,
  frameworkPatterns,

  // Direct access to detector module
  FrameworkDetector: detectFramework,

  // Configuration path utilities (XDG-compliant)
  configPath,
  getEnsembleConfigRoot: configPath.getEnsembleConfigRoot,
  getPluginConfigPath: configPath.getPluginConfigPath,
  getLogsPath: configPath.getLogsPath,
  getCachePath: configPath.getCachePath,
  getSessionsPath: configPath.getSessionsPath,
  ensureDir: configPath.ensureDir,
  initializeConfigStructure: configPath.initializeConfigStructure,
  getLegacyPaths: configPath.getLegacyPaths,
  hasLegacyConfig: configPath.hasLegacyConfig,

  // Context7 MCP integration utilities
  context7,
  checkContext7Available: context7.checkContext7Available,
  resolveLibraryId: context7.resolveLibraryId,
  fetchLibraryDocs: context7.fetchLibraryDocs,
  getContext7InstallInstructions: context7.getInstallInstructions,
  createLibraryHelper: context7.createLibraryHelper,
  withContext7Fallback: context7.withContext7Fallback,
};
