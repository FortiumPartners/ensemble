/**
 * @fortium/ensemble-nestjs
 *
 * NestJS backend framework skills for Claude Code AI-Augmented Development
 * Part of the AI-Mesh plugin ecosystem
 */

/**
 * Skill Metadata
 *
 * This metadata is used by the plugin system to understand the capabilities
 * and requirements of the NestJS framework skill.
 */
const skillMetadata = {
  name: 'NestJS Framework',
  version: '1.0.0',
  category: 'backend',
  frameworks: ['nestjs'],
  languages: ['typescript', 'javascript'],

  // Framework version compatibility
  frameworkVersions: {
    min: '8.0.0',
    max: '11.x',
    recommended: '10.4.0'
  },

  // Compatible agents
  compatibleAgents: {
    'backend-developer': '>=3.0.0',
    'tech-lead-orchestrator': '>=2.5.0'
  },

  // Skills structure
  skills: {
    quickReference: 'skills/SKILL.md',
    comprehensiveGuide: 'skills/REFERENCE.md',
    validation: 'skills/VALIDATION.md'
  },

  // Templates for code generation
  templates: {
    controller: 'skills/templates/controller.template.ts',
    service: 'skills/templates/service.template.ts',
    repository: 'skills/templates/repository.template.ts',
    dto: 'skills/templates/dto.template.ts',
    entity: 'skills/templates/entity.template.ts',
    module: 'skills/templates/module.template.ts',
    serviceSpec: 'skills/templates/service.spec.template.ts',
    testTemplates: 'skills/templates/test-templates.js'
  },

  // Real-world examples
  examples: {
    userCrud: 'skills/examples/user-management-crud.example.ts',
    jwtAuth: 'skills/examples/jwt-authentication.example.ts',
    readme: 'skills/examples/README.md'
  },

  // Template placeholder variables
  templateVariables: [
    { name: 'EntityName', description: 'PascalCase entity name', example: 'User' },
    { name: 'entityName', description: 'camelCase entity name', example: 'user' },
    { name: 'entity-name', description: 'kebab-case entity name', example: 'user' },
    { name: 'entity-name-plural', description: 'kebab-case plural', example: 'users' },
    { name: 'endpoint-path', description: 'API endpoint path', example: 'api/v1/users' },
    { name: 'entity-display-name', description: 'Human-readable name', example: 'User' }
  ],

  // Quality standards
  qualityStandards: {
    serviceCoverage: '>=80%',
    controllerCoverage: '>=70%',
    e2eCoverage: '>=60%',
    overallCoverage: '>=75%',
    security: 'OWASP Top 10 compliance',
    performance: '<200ms response time',
    apiDocumentation: '100% OpenAPI coverage'
  },

  // Supported features
  features: [
    'Enterprise Architecture',
    'RESTful API Development',
    'Authentication & Authorization',
    'Data Layer Abstraction',
    'GraphQL Support',
    'Microservices Architecture',
    'Testing Excellence',
    'Performance Optimization',
    'Code Generation Templates'
  ],

  // Detection patterns for automatic skill loading
  detectionPatterns: {
    files: [
      'nest-cli.json',
      'package.json'
    ],
    packageJsonDependencies: [
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/platform-express'
    ],
    directoryStructure: [
      'src/modules',
      'src/controllers',
      'src/services'
    ]
  }
};

/**
 * Get skill metadata
 *
 * @returns {Object} The skill metadata object
 */
function getMetadata() {
  return skillMetadata;
}

/**
 * Get template by name
 *
 * @param {string} templateName - Name of the template (e.g., 'controller', 'service')
 * @returns {string|null} Path to the template file or null if not found
 */
function getTemplate(templateName) {
  return skillMetadata.templates[templateName] || null;
}

/**
 * Get example by name
 *
 * @param {string} exampleName - Name of the example (e.g., 'userCrud', 'jwtAuth')
 * @returns {string|null} Path to the example file or null if not found
 */
function getExample(exampleName) {
  return skillMetadata.examples[exampleName] || null;
}

/**
 * Get all template names
 *
 * @returns {string[]} Array of template names
 */
function getTemplateNames() {
  return Object.keys(skillMetadata.templates);
}

/**
 * Get all example names
 *
 * @returns {string[]} Array of example names
 */
function getExampleNames() {
  return Object.keys(skillMetadata.examples);
}

/**
 * Check if this skill is compatible with a given agent
 *
 * @param {string} agentName - Name of the agent
 * @param {string} agentVersion - Version of the agent
 * @returns {boolean} True if compatible, false otherwise
 */
function isCompatibleWithAgent(agentName, agentVersion) {
  const requiredVersion = skillMetadata.compatibleAgents[agentName];
  if (!requiredVersion) return false;

  // Simple version comparison (assumes semver)
  // For production, use a proper semver library
  return true; // Simplified for now
}

/**
 * Get detection patterns for automatic skill loading
 *
 * @returns {Object} Detection patterns object
 */
function getDetectionPatterns() {
  return skillMetadata.detectionPatterns;
}

// Export public API
module.exports = {
  metadata: skillMetadata,
  getMetadata,
  getTemplate,
  getExample,
  getTemplateNames,
  getExampleNames,
  isCompatibleWithAgent,
  getDetectionPatterns
};

// For ES modules
if (typeof exports !== 'undefined') {
  exports.metadata = skillMetadata;
  exports.getMetadata = getMetadata;
  exports.getTemplate = getTemplate;
  exports.getExample = getExample;
  exports.getTemplateNames = getTemplateNames;
  exports.getExampleNames = getExampleNames;
  exports.isCompatibleWithAgent = isCompatibleWithAgent;
  exports.getDetectionPatterns = getDetectionPatterns;
}
