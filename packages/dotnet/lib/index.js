/**
 * .NET Backend Plugin
 * @fortium/ensemble-dotnet
 *
 * ASP.NET Core, Wolverine CQRS, and MartenDB backend development skills
 */

const path = require('path');

const plugin = {
  name: '.NET Backend',
  version: '1.0.0',
  description: 'ASP.NET Core, Wolverine CQRS, and MartenDB event sourcing backend development',
  language: 'csharp',
  framework: 'dotnet',

  capabilities: [
    'aspnetcore-webapi',
    'minimal-api',
    'wolverine-cqrs',
    'marten-eventsourcing',
    'marten-documents',
    'efcore',
    'jwt-authentication',
    'policy-authorisation',
    'xunit-testing',
    'fluent-validation',
    'openapi'
  ],

  detection: {
    patterns: [
      { file: '*.csproj', contains: 'Microsoft.AspNetCore' },
      { file: '*.csproj', contains: 'Wolverine' },
      { file: '*.csproj', contains: 'Marten' },
      { file: 'Program.cs', contains: 'WebApplication.CreateBuilder' }
    ],
    confidence: 0.8
  },

  /**
   * Skill documentation lives in the blazor package (shared .NET skill)
   */
  skillPath: path.resolve(__dirname, '../../blazor/skills/dotnet-framework')
};

/**
 * Load the dotnet-framework skill documentation
 * @param {string} type - 'quick' for SKILL.md, 'comprehensive' for REFERENCE.md
 * @returns {string} Absolute path to the documentation file
 */
function loadSkill(type = 'quick') {
  return type === 'comprehensive'
    ? path.join(plugin.skillPath, 'REFERENCE.md')
    : path.join(plugin.skillPath, 'SKILL.md');
}

/**
 * Get the path to a code template
 * @param {string} templateName - Template filename (e.g. 'handler.template.cs')
 * @returns {string} Absolute path to the template
 */
function getTemplate(templateName) {
  return path.join(plugin.skillPath, 'templates', templateName);
}

/**
 * Get the path to an example file
 * @param {string} exampleName - Example filename (e.g. 'event-sourcing.example.cs')
 * @returns {string} Absolute path to the example
 */
function getExample(exampleName) {
  return path.join(plugin.skillPath, 'examples', exampleName);
}

module.exports = {
  plugin,
  loadSkill,
  getTemplate,
  getExample
};
