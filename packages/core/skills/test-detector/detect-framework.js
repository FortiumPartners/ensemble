#!/usr/bin/env node

/**
 * Test Framework Detector
 * Automatically detects test frameworks in a project
 */

const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

class TestFrameworkDetector {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
    this.patterns = null;
    this.debug = process.env.DEBUG === 'true';
  }

  async loadPatterns() {
    const patternsPath = path.join(__dirname, 'framework-patterns.json');
    const content = await fs.readFile(patternsPath, 'utf-8');
    this.patterns = JSON.parse(content);
  }

  log(message) {
    if (this.debug) {
      console.error(`[DEBUG] ${message}`);
    }
  }

  async detect() {
    await this.loadPatterns();

    const results = {
      detected: false,
      frameworks: [],
      primary: null
    };

    // Detect each framework
    for (const [frameworkId, frameworkConfig] of Object.entries(this.patterns.frameworks)) {
      const detection = await this.detectFramework(frameworkId, frameworkConfig);

      if (detection.confidence > 0) {
        results.frameworks.push(detection);
        results.detected = true;
      }
    }

    // Sort by confidence (highest first)
    results.frameworks.sort((a, b) => b.confidence - a.confidence);

    // Set primary framework (highest confidence)
    if (results.frameworks.length > 0) {
      results.primary = results.frameworks[0].name;
    } else {
      results.message = "No test framework detected. Please specify framework manually.";
    }

    return results;
  }

  async detectFramework(frameworkId, config) {
    this.log(`Detecting ${config.name}...`);

    const result = {
      name: frameworkId,
      displayName: config.name,
      language: config.language,
      confidence: 0,
      version: null,
      configFiles: [],
      testDirectory: null,
      testPattern: null
    };

    const weights = config.confidenceWeights;

    // Check for config files
    for (const configFile of config.configFiles) {
      const configPath = path.join(this.projectPath, configFile);
      if (await this.fileExists(configPath)) {
        result.configFiles.push(configFile);
        result.confidence += weights.configFile;
        this.log(`Found config file: ${configFile}`);
        break; // Only count first config file
      }
    }

    // Check for package dependencies
    const packageInfo = await this.checkPackageDependencies(config);
    if (packageInfo.found) {
      result.confidence += weights.packageDependency;
      result.version = packageInfo.version;
      this.log(`Found package dependency: ${packageInfo.package} (v${packageInfo.version})`);
    }

    // Check for test directories
    for (const testDir of config.testDirectories) {
      const testDirPath = path.join(this.projectPath, testDir);
      if (await this.directoryExists(testDirPath)) {
        result.testDirectory = testDir;
        result.confidence += weights.testDirectory;
        this.log(`Found test directory: ${testDir}`);
        break; // Only count first test directory
      }
    }

    // Check for test files
    const testFiles = await this.findTestFiles(config.testPatterns);
    if (testFiles.length > 0) {
      result.confidence += weights.testFiles;
      result.testPattern = config.testPatterns[0]; // Use first pattern as default
      this.log(`Found ${testFiles.length} test files`);
    }

    // Cap confidence at 1.0
    result.confidence = Math.min(result.confidence, 1.0);

    return result;
  }

  async checkPackageDependencies(config) {
    for (const packageFile of config.packageFiles) {
      // Handle glob patterns in package files (e.g., *.csproj)
      let packagePaths;
      try {
        packagePaths = await glob(packageFile, {
          cwd: this.projectPath,
          absolute: true
        });
      } catch (error) {
        this.log(`Glob error for ${packageFile}: ${error.message}`);
        continue;
      }

      if (!Array.isArray(packagePaths)) {
        packagePaths = [packagePaths];
      }

      for (const packagePath of packagePaths) {
        if (await this.fileExists(packagePath)) {
          const content = await fs.readFile(packagePath, 'utf-8');

          // Check each package indicator
          for (const indicator of config.packageIndicators) {
            if (content.includes(indicator)) {
              // Try to extract version
              const version = this.extractVersion(content, indicator, packagePath);
              return {
                found: true,
                package: indicator,
                version: version || 'unknown'
              };
            }
          }
        }
      }
    }

    return { found: false };
  }

  extractVersion(content, packageName, filePath) {
    const ext = path.extname(filePath);

    // package.json
    if (ext === '.json') {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        return deps[packageName]?.replace(/[\^~]/, '') || null;
      } catch {
        return null;
      }
    }

    // requirements.txt
    if (filePath.includes('requirements')) {
      const match = content.match(new RegExp(`${packageName}[=><~]+([\\d.]+)`));
      return match ? match[1] : null;
    }

    // Gemfile
    if (ext === '' && filePath.includes('Gemfile')) {
      const match = content.match(new RegExp(`gem ['"]${packageName}['"],\\s*['"]~>\\s*([\\d.]+)`));
      return match ? match[1] : null;
    }

    // .csproj
    if (ext === '.csproj') {
      const match = content.match(new RegExp(`<PackageReference Include="${packageName}" Version="([\\d.]+)"`));
      return match ? match[1] : null;
    }

    return null;
  }

  async findTestFiles(patterns) {
    const files = [];

    for (const pattern of patterns) {
      try {
        const matches = await glob(pattern, {
          cwd: this.projectPath,
          ignore: ['node_modules/**', 'vendor/**', '.git/**']
        });
        files.push(...matches);
      } catch (error) {
        // Ignore glob errors for unsupported patterns
      }
    }

    return [...new Set(files)]; // Remove duplicates
  }

  async fileExists(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async directoryExists(dirPath) {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}

// CLI interface
async function main() {
  const projectPath = process.argv[2] || process.cwd();

  try {
    const detector = new TestFrameworkDetector(projectPath);
    const result = await detector.detect();

    // Output JSON to stdout
    console.log(JSON.stringify(result, null, 2));

    // Exit with appropriate code
    process.exit(result.detected ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({
      error: true,
      message: error.message,
      stack: error.stack
    }, null, 2));
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = { TestFrameworkDetector };
