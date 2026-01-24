/**
 * Blazor Framework Plugin
 * @fortium/ensemble-blazor
 *
 * Blazor and .NET framework skills for web development
 */

const path = require('path');

const skill = {
  name: 'Blazor Framework',
  version: '1.0.0',
  description: 'Blazor WebAssembly and Server components with .NET backend integration',
  language: 'csharp',
  framework: 'blazor',

  capabilities: [
    'blazor-webassembly',
    'blazor-server',
    'razor-components',
    'dependency-injection',
    'state-management',
    'javascript-interop',
    'authentication',
    'dotnet-backend'
  ],

  detection: {
    patterns: [
      { file: '*.csproj', contains: 'Microsoft.AspNetCore.Components' },
      { file: '*.csproj', contains: 'Blazor' },
      { glob: '**/*.razor' },
      { glob: '**/wwwroot/index.html', contains: 'blazor' }
    ],
    confidence: 0.8
  },

  skills: ['blazor-framework', 'dotnet-framework']
};

/**
 * Load skill documentation
 * @param {string} skillName - 'blazor-framework' or 'dotnet-framework'
 * @param {string} type - 'quick' for SKILL.md, 'comprehensive' for REFERENCE.md
 * @returns {string} Path to documentation file
 */
function loadSkill(skillName = 'blazor-framework', type = 'quick') {
  const skillsDir = skillName === 'dotnet-framework'
    ? path.join(__dirname, '..', 'skills', 'dotnet-framework')
    : path.join(__dirname, '..', 'skills');

  return type === 'comprehensive'
    ? path.join(skillsDir, 'REFERENCE.md')
    : path.join(skillsDir, 'SKILL.md');
}

/**
 * Get template path
 * @param {string} templateName - Name of the template
 * @param {string} skillName - 'blazor-framework' or 'dotnet-framework'
 * @returns {string} Path to template file
 */
function getTemplate(templateName, skillName = 'blazor-framework') {
  const templatesDir = skillName === 'dotnet-framework'
    ? path.join(__dirname, '..', 'skills', 'dotnet-framework', 'templates')
    : path.join(__dirname, '..', 'skills', 'templates');
  return path.join(templatesDir, templateName);
}

/**
 * Get example path
 * @param {string} exampleName - Name of the example
 * @param {string} skillName - 'blazor-framework' or 'dotnet-framework'
 * @returns {string} Path to example file
 */
function getExample(exampleName, skillName = 'blazor-framework') {
  const examplesDir = skillName === 'dotnet-framework'
    ? path.join(__dirname, '..', 'skills', 'dotnet-framework', 'examples')
    : path.join(__dirname, '..', 'skills', 'examples');
  return path.join(examplesDir, exampleName);
}

/**
 * Check if .NET SDK is available
 * @returns {Promise<boolean>}
 */
async function isDotNetAvailable() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec('dotnet --version', (error) => {
      resolve(!error);
    });
  });
}

module.exports = {
  skill,
  loadSkill,
  getTemplate,
  getExample,
  isDotNetAvailable
};
