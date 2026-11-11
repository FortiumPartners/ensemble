/**
 * @sunstone-partners/ensemble-nestjs
 *
 * The plugin ships Claude Code skills under skills/; this module only exposes their paths.
 */

const path = require('path');

const skillsDir = path.join(__dirname, '..', 'skills');

module.exports = {
  name: 'ensemble-nestjs',
  skillsDir,
  skillPath: path.join(skillsDir, 'nestjs', 'SKILL.md')
};
