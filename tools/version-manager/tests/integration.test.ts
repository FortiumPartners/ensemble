import { scanPackages } from '../src/package-scanner';
import * as path from 'path';

describe('Integration Tests', () => {
  describe('Real ensemble packages', () => {
    it('should find all 25 packages in ensemble repo', () => {
      const packagesDir = path.join(__dirname, '..', '..', '..', 'packages');
      const packages = scanPackages(packagesDir);

      // Should find exactly 25 packages
      expect(packages).toHaveLength(25);

      // Verify all packages have required files
      for (const pkg of packages) {
        expect(pkg.name).toBeTruthy();
        expect(pkg.path).toContain('packages');
        expect(pkg.pluginJsonPath).toContain('.claude-plugin/plugin.json');
        expect(pkg.packageJsonPath).toContain('package.json');
      }
    });

    it('should find expected package names', () => {
      const packagesDir = path.join(__dirname, '..', '..', '..', 'packages');
      const packages = scanPackages(packagesDir);

      const packageNames = packages.map(p => p.name).sort();

      // Check for some known packages
      const expectedPackages = [
        'core',
        'development',
        'infrastructure',
        'product',
        'quality',
        'git',
        'full',
        'react',
        'nestjs',
        'rails',
        'phoenix',
        'blazor'
      ];

      for (const expected of expectedPackages) {
        expect(packageNames).toContain(expected);
      }
    });

    it('should read version from real package files', () => {
      const packagesDir = path.join(__dirname, '..', '..', '..', 'packages');
      const packages = scanPackages(packagesDir);

      expect(packages.length).toBeGreaterThan(0);

      // Pick the first package and verify we can read its version
      const firstPackage = packages[0];
      const fs = require('fs');

      const pluginJson = JSON.parse(fs.readFileSync(firstPackage.pluginJsonPath, 'utf-8'));
      const packageJson = JSON.parse(fs.readFileSync(firstPackage.packageJsonPath, 'utf-8'));

      expect(pluginJson.version).toBeDefined();
      expect(packageJson.version).toBeDefined();
      expect(typeof pluginJson.version).toBe('string');
      expect(typeof packageJson.version).toBe('string');
    });

    it('should detect formatting of real package files', () => {
      const packagesDir = path.join(__dirname, '..', '..', '..', 'packages');
      const packages = scanPackages(packagesDir);
      const fs = require('fs');
      const { detectFormat } = require('../src/json-formatter');

      expect(packages.length).toBeGreaterThan(0);

      const firstPackage = packages[0];
      const content = fs.readFileSync(firstPackage.pluginJsonPath, 'utf-8');
      const format = detectFormat(content);

      // Should detect some indentation (2-space is most common)
      expect(format.indent).toBeDefined();
      expect(format.indent.length).toBeGreaterThan(0);

      // Should detect trailing newline preference
      expect(typeof format.trailingNewline).toBe('boolean');
    });
  });
});
