/**
 * .NET Backend Plugin
 * @sunstone-partners/ensemble-dotnet
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
   * Skill documentation lives in this package (skills/dotnet/SKILL.md)
   */
  skillPath: path.resolve(__dirname, '..', 'skills', 'dotnet')
};

/**
 * Get the path to the dotnet SKILL.md
 * @returns {string} Absolute path to the skill file
 */
function loadSkill() {
  return path.join(plugin.skillPath, 'SKILL.md');
}

module.exports = {
  plugin,
  loadSkill
};
