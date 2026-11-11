/**
 * @sunstone-partners/ensemble-rails
 *
 * The plugin ships Claude Code skills under skills/; this module only exposes their paths.
 */

const path = require('path');

const skillsDir = path.join(__dirname, '..', 'skills');

module.exports = {
  name: 'ensemble-rails',
  skillsDir,
  skillPath: path.join(skillsDir, 'rails', 'SKILL.md')
};
