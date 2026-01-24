import { updateVersions, VersionUpdate } from '../src/file-sync';
import { PackageInfo } from '../src/package-scanner';
import * as fs from 'fs';
import * as path from 'path';

describe('File Synchronizer', () => {
  const testDir = path.join(__dirname, 'fixtures', 'file-sync');

  beforeEach(() => {
    // Create test directory
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

  const createTestPackage = (name: string, version: string): PackageInfo => {
    const pkgPath = path.join(testDir, name);
    fs.mkdirSync(pkgPath, { recursive: true });
    fs.mkdirSync(path.join(pkgPath, '.claude-plugin'));

    const pluginJson = {
      name: `ensemble-${name}`,
      version,
      description: `Test package ${name}`
    };

    const packageJson = {
      name: `@fortium/ensemble-${name}`,
      version,
      description: `Test package ${name}`
    };

    const pluginJsonPath = path.join(pkgPath, '.claude-plugin', 'plugin.json');
    const packageJsonPath = path.join(pkgPath, 'package.json');

    fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + '\n');
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

    return {
      name,
      path: pkgPath,
      pluginJsonPath,
      packageJsonPath
    };
  };

  describe('updateVersions', () => {
    it('should update version in both plugin.json and package.json', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');
      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      await updateVersions(update);

      const pluginJson = JSON.parse(fs.readFileSync(pkg.pluginJsonPath, 'utf-8'));
      const packageJson = JSON.parse(fs.readFileSync(pkg.packageJsonPath, 'utf-8'));

      expect(pluginJson.version).toBe('2.0.0');
      expect(packageJson.version).toBe('2.0.0');
    });

    it('should update multiple packages', async () => {
      const pkg1 = createTestPackage('pkg1', '1.0.0');
      const pkg2 = createTestPackage('pkg2', '1.0.0');
      const pkg3 = createTestPackage('pkg3', '1.0.0');

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg1, pkg2, pkg3]
      };

      await updateVersions(update);

      // Check all packages were updated
      for (const pkg of [pkg1, pkg2, pkg3]) {
        const pluginJson = JSON.parse(fs.readFileSync(pkg.pluginJsonPath, 'utf-8'));
        const packageJson = JSON.parse(fs.readFileSync(pkg.packageJsonPath, 'utf-8'));

        expect(pluginJson.version).toBe('2.0.0');
        expect(packageJson.version).toBe('2.0.0');
      }
    });

    it('should preserve JSON formatting (2-space indent)', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      // Verify original formatting
      const originalPlugin = fs.readFileSync(pkg.pluginJsonPath, 'utf-8');
      expect(originalPlugin).toContain('  "name"'); // 2-space indent

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      await updateVersions(update);

      const updatedPlugin = fs.readFileSync(pkg.pluginJsonPath, 'utf-8');
      expect(updatedPlugin).toContain('  "name"'); // Still 2-space indent
      expect(updatedPlugin.endsWith('\n')).toBe(true); // Trailing newline preserved
    });

    it('should preserve JSON formatting (4-space indent)', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      // Rewrite with 4-space indent
      const pluginJson = JSON.parse(fs.readFileSync(pkg.pluginJsonPath, 'utf-8'));
      fs.writeFileSync(pkg.pluginJsonPath, JSON.stringify(pluginJson, null, 4) + '\n');

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      await updateVersions(update);

      const updatedPlugin = fs.readFileSync(pkg.pluginJsonPath, 'utf-8');
      expect(updatedPlugin).toContain('    "name"'); // 4-space indent preserved
    });

    it('should preserve trailing newlines', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      await updateVersions(update);

      const pluginContent = fs.readFileSync(pkg.pluginJsonPath, 'utf-8');
      const packageContent = fs.readFileSync(pkg.packageJsonPath, 'utf-8');

      expect(pluginContent.endsWith('\n')).toBe(true);
      expect(packageContent.endsWith('\n')).toBe(true);
    });

    it('should be atomic - rollback on failure', async () => {
      const pkg1 = createTestPackage('pkg1', '1.0.0');
      const pkg2 = createTestPackage('pkg2', '1.0.0');

      // Create an invalid package (delete package.json to cause error)
      const pkg3: PackageInfo = {
        name: 'pkg3',
        path: path.join(testDir, 'pkg3'),
        pluginJsonPath: path.join(testDir, 'pkg3', '.claude-plugin', 'plugin.json'),
        packageJsonPath: path.join(testDir, 'pkg3', 'package.json') // Doesn't exist
      };

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg1, pkg2, pkg3]
      };

      await expect(updateVersions(update)).rejects.toThrow();

      // Verify rollback - packages should still be at 1.0.0
      const pkg1Plugin = JSON.parse(fs.readFileSync(pkg1.pluginJsonPath, 'utf-8'));
      const pkg1Package = JSON.parse(fs.readFileSync(pkg1.packageJsonPath, 'utf-8'));

      expect(pkg1Plugin.version).toBe('1.0.0');
      expect(pkg1Package.version).toBe('1.0.0');
    });

    it('should handle empty package list', async () => {
      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: []
      };

      await expect(updateVersions(update)).resolves.not.toThrow();
    });

    it('should preserve other JSON fields', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      // Add extra fields
      const pluginJson = JSON.parse(fs.readFileSync(pkg.pluginJsonPath, 'utf-8'));
      pluginJson.author = { name: 'Test Author', email: 'test@example.com' };
      pluginJson.keywords = ['test', 'package'];
      fs.writeFileSync(pkg.pluginJsonPath, JSON.stringify(pluginJson, null, 2) + '\n');

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      await updateVersions(update);

      const updated = JSON.parse(fs.readFileSync(pkg.pluginJsonPath, 'utf-8'));
      expect(updated.version).toBe('2.0.0');
      expect(updated.author).toEqual({ name: 'Test Author', email: 'test@example.com' });
      expect(updated.keywords).toEqual(['test', 'package']);
      expect(updated.description).toBe('Test package test-pkg');
    });

    it('should handle nested JSON structures', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      // Add nested structure to package.json
      const packageJson = JSON.parse(fs.readFileSync(pkg.packageJsonPath, 'utf-8'));
      packageJson.repository = {
        type: 'git',
        url: 'https://github.com/test/repo.git',
        directory: 'packages/test-pkg'
      };
      fs.writeFileSync(pkg.packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      await updateVersions(update);

      const updated = JSON.parse(fs.readFileSync(pkg.packageJsonPath, 'utf-8'));
      expect(updated.version).toBe('2.0.0');
      expect(updated.repository).toEqual({
        type: 'git',
        url: 'https://github.com/test/repo.git',
        directory: 'packages/test-pkg'
      });
    });
  });

  describe('performance', () => {
    it('should complete updates in reasonable time', async () => {
      // Create 25 test packages (simulating real ensemble structure)
      const packages: PackageInfo[] = [];
      for (let i = 1; i <= 25; i++) {
        packages.push(createTestPackage(`pkg${i}`, '1.0.0'));
      }

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages
      };

      const startTime = Date.now();
      await updateVersions(update);
      const duration = Date.now() - startTime;

      // Should complete in less than 500ms for 50 files (25 packages × 2 files)
      // This is more generous than the TRD requirement of 300ms to account for test overhead
      expect(duration).toBeLessThan(500);

      // Verify all updated
      for (const pkg of packages) {
        const pluginJson = JSON.parse(fs.readFileSync(pkg.pluginJsonPath, 'utf-8'));
        expect(pluginJson.version).toBe('2.0.0');
      }
    });
  });

  describe('error handling', () => {
    it('should throw FILE_READ_ERROR on read failure', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      // Make file unreadable
      fs.chmodSync(pkg.pluginJsonPath, 0o000);

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      try {
        await expect(updateVersions(update)).rejects.toThrow();
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(pkg.pluginJsonPath, 0o644);
      }
    });

    it('should throw FILE_WRITE_ERROR on write failure', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      // Make files read-only (not the directory)
      fs.chmodSync(pkg.pluginJsonPath, 0o444);
      fs.chmodSync(pkg.packageJsonPath, 0o444);

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      try {
        await expect(updateVersions(update)).rejects.toThrow();
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(pkg.pluginJsonPath, 0o644);
        fs.chmodSync(pkg.packageJsonPath, 0o644);
      }
    });

    it('should handle malformed JSON gracefully', async () => {
      const pkg = createTestPackage('test-pkg', '1.0.0');

      // Write invalid JSON
      fs.writeFileSync(pkg.pluginJsonPath, '{ invalid json }');

      const update: VersionUpdate = {
        newVersion: '2.0.0',
        packages: [pkg]
      };

      await expect(updateVersions(update)).rejects.toThrow();
    });
  });
});
