/**
 * Reqnroll BDD Skill
 * @fortium/ensemble-reqnroll
 *
 * Provides the reqnroll-binding-specialist agent and Reqnroll + xUnit binding
 * guidance. The deterministic codegen (PRD -> .feature + step stubs + project)
 * lives in @fortium/ensemble-product (lib/reqnroll-*.js); this package supplies
 * the agent + skill that fill the generated Pending() bindings test-first.
 */

const path = require('path');

const skill = {
  name: 'Reqnroll BDD Bindings',
  version: '1.0.0',
  description:
    'Fill PRD-generated Reqnroll + xUnit step definitions test-first, without editing the generated step-matching attributes',
  language: 'csharp',
  framework: 'reqnroll',

  capabilities: [
    'bdd-step-bindings',
    'outside-in-tdd',
    'scenario-context-state',
    'fluent-assertions',
    'webapplicationfactory-integration',
  ],

  agents: ['reqnroll-binding-specialist'],

  detection: {
    patterns: [
      { file: '*.csproj', contains: 'Reqnroll' },
      { glob: '**/*.feature' },
      { glob: '**/reqnroll.json' },
    ],
    confidence: 0.8,
  },
};

function loadSkill(type = 'quick') {
  const file = type === 'reference' ? 'REFERENCE.md' : 'SKILL.md';
  return path.join(__dirname, '..', 'skills', 'reqnroll', file);
}

module.exports = { skill, loadSkill };
