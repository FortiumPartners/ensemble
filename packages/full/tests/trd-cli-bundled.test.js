const fs = require('fs');
const path = require('path');

describe('ensemble-full bundled development CLIs', () => {
  test('bundles trd-cli and its helper modules for installed command runtime', () => {
    const libDir = path.join(__dirname, '..', 'lib');
    for (const file of [
      'trd-cli.js',
      'trd-parser.js',
      'scaffold-planner.js',
      'phase-tracker.js',
      'pr-strategy.js',
      'workstream-planner.js',
      'cross-trd-deps.js',
      'workstream-status.js',
      'beads-refine-cli.js',
      'beads-scope.js',
      'beads-findings.js',
      'beads-repair-plan.js',
      'beads-repair-verify.js',
    ]) {
      expect(fs.existsSync(path.join(libDir, file))).toBe(true);
    }
    expect(() => require('../lib/trd-cli')).not.toThrow();
  });
});
