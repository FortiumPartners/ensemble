/**
 * xUnit Testing Skill
 * @fortium/ensemble-xunit
 *
 * Provides xUnit test generation and execution for C#/.NET projects
 */

const path = require('path');

const skill = {
  name: 'xUnit Test Framework',
  version: '1.0.0',
  description: 'Execute and generate xUnit tests for C#/.NET projects with FluentAssertions and Moq support',
  language: 'csharp',
  framework: 'xunit',

  capabilities: [
    'test-generation',
    'test-execution',
    'fact-theory',
    'inline-data',
    'fluent-assertions',
    'moq-mocking',
    'class-fixtures'
  ],

  tools: {
    generateTest: path.join(__dirname, 'generate-test.cs'),
    runTest: path.join(__dirname, 'run-test.sh')
  },

  detection: {
    patterns: [
      { file: '*.csproj', contains: 'xunit' },
      { file: '*.csproj', contains: 'Microsoft.NET.Test.Sdk' },
      { glob: '**/*Tests.cs' },
      { glob: '**/*.Tests.csproj' }
    ],
    confidence: 0.8
  }
};

/**
 * Load skill documentation
 * @param {string} type - 'quick' for SKILL.md, 'comprehensive' for REFERENCE.md
 * @returns {string} Path to documentation file
 */
function loadSkill(type = 'quick') {
  const skillsDir = path.join(__dirname, '..', 'skills');
  return type === 'comprehensive'
    ? path.join(skillsDir, 'REFERENCE.md')
    : path.join(skillsDir, 'SKILL.md');
}

/**
 * Check if dotnet is available in the current environment
 * @returns {Promise<boolean>}
 */
async function isDotNetAvailable() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('which dotnet', (error) => {
      resolve(!error);
    });
  });
}

module.exports = {
  skill,
  loadSkill,
  isDotNetAvailable,
  generateTestPath: skill.tools.generateTest,
  runTestPath: skill.tools.runTest
};
