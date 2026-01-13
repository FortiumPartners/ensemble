import { scanPackages, PackageInfo } from '../src/package-scanner';
import * as fs from 'fs';
import * as path from 'path';

describe('Package Scanner', () => {
  const testDir = path.join(__dirname, 'fixtures', 'packages');

  beforeEach(() => {
    // Create test directory structure
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('scanPackages', () => {
    it('should find packages with plugin.json and package.json', () => {
      // Create test package structure
      const pkg1 = path.join(testDir, 'pkg1');
      fs.mkdirSync(pkg1, { recursive: true });
      fs.mkdirSync(path.join(pkg1, '.claude-plugin'));
      fs.writeFileSync(
        path.join(pkg1, '.claude-plugin', 'plugin.json'),
        '{"name":"ensemble-pkg1","version":"1.0.0"}'
      );
      fs.writeFileSync(
        path.join(pkg1, 'package.json'),
        '{"name":"@fortium/ensemble-pkg1","version":"1.0.0"}'
      );

      const packages = scanPackages(testDir);

      expect(packages).toHaveLength(1);
      expect(packages[0].name).toBe('pkg1');
      expect(packages[0].path).toBe(pkg1);
      expect(packages[0].pluginJsonPath).toBe(
        path.join(pkg1, '.claude-plugin', 'plugin.json')
      );
      expect(packages[0].packageJsonPath).toBe(path.join(pkg1, 'package.json'));
    });

    it('should find multiple packages', () => {
      // Create 3 test packages
      for (let i = 1; i <= 3; i++) {
        const pkg = path.join(testDir, `pkg${i}`);
        fs.mkdirSync(pkg, { recursive: true });
        fs.mkdirSync(path.join(pkg, '.claude-plugin'));
        fs.writeFileSync(
          path.join(pkg, '.claude-plugin', 'plugin.json'),
          `{"name":"ensemble-pkg${i}","version":"1.0.0"}`
        );
        fs.writeFileSync(
          path.join(pkg, 'package.json'),
          `{"name":"@fortium/ensemble-pkg${i}","version":"1.0.0"}`
        );
      }

      const packages = scanPackages(testDir);

      expect(packages).toHaveLength(3);
      expect(packages.map(p => p.name).sort()).toEqual(['pkg1', 'pkg2', 'pkg3']);
    });

    it('should skip packages without plugin.json', () => {
      // Package with only package.json
      const pkg1 = path.join(testDir, 'pkg1');
      fs.mkdirSync(pkg1, { recursive: true });
      fs.writeFileSync(
        path.join(pkg1, 'package.json'),
        '{"name":"pkg1","version":"1.0.0"}'
      );

      // Valid package
      const pkg2 = path.join(testDir, 'pkg2');
      fs.mkdirSync(pkg2, { recursive: true });
      fs.mkdirSync(path.join(pkg2, '.claude-plugin'));
      fs.writeFileSync(
        path.join(pkg2, '.claude-plugin', 'plugin.json'),
        '{"name":"ensemble-pkg2","version":"1.0.0"}'
      );
      fs.writeFileSync(
        path.join(pkg2, 'package.json'),
        '{"name":"@fortium/ensemble-pkg2","version":"1.0.0"}'
      );

      const packages = scanPackages(testDir);

      expect(packages).toHaveLength(1);
      expect(packages[0].name).toBe('pkg2');
    });

    it('should skip packages without package.json', () => {
      // Package with only plugin.json
      const pkg1 = path.join(testDir, 'pkg1');
      fs.mkdirSync(pkg1, { recursive: true });
      fs.mkdirSync(path.join(pkg1, '.claude-plugin'));
      fs.writeFileSync(
        path.join(pkg1, '.claude-plugin', 'plugin.json'),
        '{"name":"ensemble-pkg1","version":"1.0.0"}'
      );

      // Valid package
      const pkg2 = path.join(testDir, 'pkg2');
      fs.mkdirSync(pkg2, { recursive: true });
      fs.mkdirSync(path.join(pkg2, '.claude-plugin'));
      fs.writeFileSync(
        path.join(pkg2, '.claude-plugin', 'plugin.json'),
        '{"name":"ensemble-pkg2","version":"1.0.0"}'
      );
      fs.writeFileSync(
        path.join(pkg2, 'package.json'),
        '{"name":"@fortium/ensemble-pkg2","version":"1.0.0"}'
      );

      const packages = scanPackages(testDir);

      expect(packages).toHaveLength(1);
      expect(packages[0].name).toBe('pkg2');
    });

    it('should skip non-directory entries', () => {
      // Create a file in packages directory
      fs.writeFileSync(path.join(testDir, 'README.md'), '# README');

      // Valid package
      const pkg1 = path.join(testDir, 'pkg1');
      fs.mkdirSync(pkg1, { recursive: true });
      fs.mkdirSync(path.join(pkg1, '.claude-plugin'));
      fs.writeFileSync(
        path.join(pkg1, '.claude-plugin', 'plugin.json'),
        '{"name":"ensemble-pkg1","version":"1.0.0"}'
      );
      fs.writeFileSync(
        path.join(pkg1, 'package.json'),
        '{"name":"@fortium/ensemble-pkg1","version":"1.0.0"}'
      );

      const packages = scanPackages(testDir);

      expect(packages).toHaveLength(1);
      expect(packages[0].name).toBe('pkg1');
    });

    it('should return empty array for non-existent directory', () => {
      const packages = scanPackages(path.join(testDir, 'nonexistent'));

      expect(packages).toEqual([]);
    });

    it('should return empty array for empty directory', () => {
      const packages = scanPackages(testDir);

      expect(packages).toEqual([]);
    });

    it('should handle packages with symlinks', () => {
      // Create a valid package
      const pkg1 = path.join(testDir, 'pkg1');
      fs.mkdirSync(pkg1, { recursive: true });
      fs.mkdirSync(path.join(pkg1, '.claude-plugin'));
      fs.writeFileSync(
        path.join(pkg1, '.claude-plugin', 'plugin.json'),
        '{"name":"ensemble-pkg1","version":"1.0.0"}'
      );
      fs.writeFileSync(
        path.join(pkg1, 'package.json'),
        '{"name":"@fortium/ensemble-pkg1","version":"1.0.0"}'
      );

      // Create a symlink to another directory (should be skipped or handled gracefully)
      const linkPath = path.join(testDir, 'link-to-pkg1');
      try {
        fs.symlinkSync(pkg1, linkPath);
      } catch (error) {
        // Skip symlink test on Windows without admin rights
        console.log('Skipping symlink test');
      }

      const packages = scanPackages(testDir);

      // Should find at least the real package
      expect(packages.length).toBeGreaterThanOrEqual(1);
      expect(packages.some(p => p.name === 'pkg1')).toBe(true);
    });
  });

  describe('PackageInfo type', () => {
    it('should have correct properties', () => {
      const pkg1 = path.join(testDir, 'pkg1');
      fs.mkdirSync(pkg1, { recursive: true });
      fs.mkdirSync(path.join(pkg1, '.claude-plugin'));
      fs.writeFileSync(
        path.join(pkg1, '.claude-plugin', 'plugin.json'),
        '{"name":"ensemble-pkg1","version":"1.0.0"}'
      );
      fs.writeFileSync(
        path.join(pkg1, 'package.json'),
        '{"name":"@fortium/ensemble-pkg1","version":"1.0.0"}'
      );

      const packages = scanPackages(testDir);
      const pkg = packages[0];

      expect(pkg).toHaveProperty('name');
      expect(pkg).toHaveProperty('path');
      expect(pkg).toHaveProperty('pluginJsonPath');
      expect(pkg).toHaveProperty('packageJsonPath');
      expect(typeof pkg.name).toBe('string');
      expect(typeof pkg.path).toBe('string');
      expect(typeof pkg.pluginJsonPath).toBe('string');
      expect(typeof pkg.packageJsonPath).toBe('string');
    });
  });
});
