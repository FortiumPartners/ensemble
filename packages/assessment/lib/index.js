/**
 * Assessment Plugin
 * @sunstone-partners/ensemble-assessment
 *
 * Repository, team, and AI-readiness assessment and diagnostic reporting
 * skills. Each skill is self-contained under skills/<name>/SKILL.md;
 * assessment-report-suite orchestrates the others into a single executive
 * package.
 */

const path = require('path');
const fs = require('fs');

const SKILLS_DIR = path.join(__dirname, '..', 'skills');

const skill = {
  name: 'Assessment & Diagnostics',
  version: '1.0.0',
  description: 'Repository, team, and AI-readiness assessment and diagnostic reporting skills',
  category: 'assessment',

  capabilities: [
    'repository-assessment',
    'team-assessment',
    'ai-readiness-diagnostic',
    'architecture-overview',
    'code-quality-analysis',
    'security-analysis',
    'cicd-analysis',
    'testing-analysis',
    'assessment-report-generation',
  ],

  skills: fs.existsSync(SKILLS_DIR)
    ? fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [],
};

/**
 * Resolve the path to a given skill's documentation file.
 * @param {string} name - skill directory name, e.g. 'assess-repo'
 * @param {string} type - 'quick' for SKILL.md, 'reference' for REFERENCE.md
 * @returns {string} absolute path to the skill doc
 */
function loadSkill(name, type = 'quick') {
  const file = type === 'reference' ? 'REFERENCE.md' : 'SKILL.md';
  return path.join(SKILLS_DIR, name, file);
}

module.exports = { skill, loadSkill };
