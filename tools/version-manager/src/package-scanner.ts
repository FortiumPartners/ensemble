import * as fs from 'fs';
import * as path from 'path';

/**
 * Information about a package in the ensemble ecosystem
 */
export interface PackageInfo {
  name: string;
  path: string;
  pluginJsonPath: string;
  packageJsonPath: string;
}

/**
 * Scans a directory for ensemble packages
 * A valid package must have both .claude-plugin/plugin.json and package.json
 *
 * @param rootDir - The root directory to scan (typically packages/)
 * @returns Array of PackageInfo for all valid packages
 */
export function scanPackages(rootDir: string): PackageInfo[] {
  const packages: PackageInfo[] = [];

  // Check if directory exists
  if (!fs.existsSync(rootDir)) {
    return packages;
  }

  // Read directory entries
  let entries: string[];
  try {
    entries = fs.readdirSync(rootDir);
  } catch (error) {
    return packages;
  }

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry);

    // Skip non-directories
    let stats: fs.Stats;
    try {
      stats = fs.statSync(entryPath);
    } catch (error) {
      continue;
    }

    if (!stats.isDirectory()) {
      continue;
    }

    // Check for required files
    const pluginJsonPath = path.join(entryPath, '.claude-plugin', 'plugin.json');
    const packageJsonPath = path.join(entryPath, 'package.json');

    const hasPluginJson = fs.existsSync(pluginJsonPath);
    const hasPackageJson = fs.existsSync(packageJsonPath);

    // Only include packages with both files
    if (hasPluginJson && hasPackageJson) {
      packages.push({
        name: entry,
        path: entryPath,
        pluginJsonPath,
        packageJsonPath
      });
    }
  }

  return packages;
}
