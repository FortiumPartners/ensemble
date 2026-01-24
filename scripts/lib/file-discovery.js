/**
 * File Discovery Module
 * Discovers YAML files by scanning plugin.json manifests
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');
const { glob } = require('glob');

/**
 * Discover all YAML files to process by scanning plugin manifests
 * @param {string} packagesDir - Path to packages directory
 * @param {object} options - Discovery options
 * @param {string[]} [options.types] - Types to discover: 'commands', 'agents', or both
 * @returns {Promise<{commands: string[], agents: string[]}>}
 */
async function discoverYamlFiles(packagesDir, options = {}) {
  const types = options.types || ['commands', 'agents'];
  const result = {
    commands: [],
    agents: []
  };

  // Find all plugin.json files
  const pluginJsonPattern = path.join(packagesDir, '*/.claude-plugin/plugin.json');
  const pluginJsonFiles = await glob(pluginJsonPattern);

  for (const pluginJsonPath of pluginJsonFiles) {
    try {
      const pluginJson = JSON.parse(await fs.readFile(pluginJsonPath, 'utf8'));
      const pluginDir = path.dirname(path.dirname(pluginJsonPath));

      // Discover commands (handle both string and array formats)
      if (types.includes('commands') && pluginJson.commands) {
        const commandPaths = Array.isArray(pluginJson.commands)
          ? pluginJson.commands
          : [pluginJson.commands];
        for (const cmdPath of commandPaths) {
          const commandsDir = path.join(pluginDir, cmdPath);
          const commandYamls = await discoverYamlsInDir(commandsDir);
          result.commands.push(...commandYamls);
        }
      }

      // Discover agents (handle both string and array formats)
      if (types.includes('agents') && pluginJson.agents) {
        const agentPaths = Array.isArray(pluginJson.agents)
          ? pluginJson.agents
          : [pluginJson.agents];

        // Collect unique directories to scan (avoid duplicate scans)
        const agentDirs = new Set();
        for (const agentPath of agentPaths) {
          if (agentPath.endsWith('.md')) {
            // Individual file path - extract directory
            agentDirs.add(path.dirname(path.join(pluginDir, agentPath)));
          } else {
            // Directory path
            agentDirs.add(path.join(pluginDir, agentPath));
          }
        }

        for (const agentsDir of agentDirs) {
          const agentYamls = await discoverYamlsInDir(agentsDir);
          result.agents.push(...agentYamls);
        }
      }
    } catch (error) {
      // Log warning but continue - missing/invalid plugin.json is not fatal
      console.warn(`Warning: Could not process ${pluginJsonPath}: ${error.message}`);
    }
  }

  return result;
}

/**
 * Discover YAML files in a directory
 * Skips symlinked directories to avoid processing files from other packages
 * @param {string} dir - Directory to scan
 * @returns {Promise<string[]>} Array of YAML file paths
 */
async function discoverYamlsInDir(dir) {
  try {
    // Use lstat to detect symlinks (stat follows symlinks, lstat doesn't)
    const lstat = await fs.lstat(dir);

    // Skip symlinked directories - these point to other packages
    if (lstat.isSymbolicLink()) {
      return [];
    }

    if (!lstat.isDirectory()) {
      return [];
    }
  } catch (error) {
    // Directory doesn't exist
    return [];
  }

  const pattern = path.join(dir, '*.yaml');
  return glob(pattern);
}

/**
 * Discover all Markdown files in agent/command directories
 * Used for orphan cleanup
 * @param {string} packagesDir - Path to packages directory
 * @returns {Promise<{commands: string[], agents: string[]}>}
 */
async function discoverMarkdownFiles(packagesDir) {
  const result = {
    commands: [],
    agents: []
  };

  // Find all plugin.json files
  const pluginJsonPattern = path.join(packagesDir, '*/.claude-plugin/plugin.json');
  const pluginJsonFiles = await glob(pluginJsonPattern);

  for (const pluginJsonPath of pluginJsonFiles) {
    try {
      const pluginJson = JSON.parse(await fs.readFile(pluginJsonPath, 'utf8'));
      const pluginDir = path.dirname(path.dirname(pluginJsonPath));

      // Discover command Markdown files (handle both string and array formats)
      if (pluginJson.commands) {
        const commandPaths = Array.isArray(pluginJson.commands)
          ? pluginJson.commands
          : [pluginJson.commands];
        for (const cmdPath of commandPaths) {
          const commandsDir = path.join(pluginDir, cmdPath);
          const commandMds = await discoverMdsInDir(commandsDir);
          result.commands.push(...commandMds);
        }
      }

      // Discover agent Markdown files (handle both string and array formats)
      if (pluginJson.agents) {
        const agentPaths = Array.isArray(pluginJson.agents)
          ? pluginJson.agents
          : [pluginJson.agents];

        // Collect unique directories to scan (avoid duplicate scans)
        const agentDirs = new Set();
        for (const agentPath of agentPaths) {
          if (agentPath.endsWith('.md')) {
            // Individual file path - extract directory
            agentDirs.add(path.dirname(path.join(pluginDir, agentPath)));
          } else {
            // Directory path
            agentDirs.add(path.join(pluginDir, agentPath));
          }
        }

        for (const agentsDir of agentDirs) {
          const agentMds = await discoverMdsInDir(agentsDir);
          result.agents.push(...agentMds);
        }
      }
    } catch (error) {
      // Silent - errors already logged during YAML discovery
    }
  }

  return result;
}

/**
 * Discover Markdown files in a directory
 * Skips symlinked directories to avoid modifying files in other packages
 * @param {string} dir - Directory to scan
 * @returns {Promise<string[]>} Array of Markdown file paths
 */
async function discoverMdsInDir(dir) {
  try {
    // Use lstat to detect symlinks (stat follows symlinks, lstat doesn't)
    const lstat = await fs.lstat(dir);

    // Skip symlinked directories - these point to other packages
    if (lstat.isSymbolicLink()) {
      return [];
    }

    if (!lstat.isDirectory()) {
      return [];
    }
  } catch (error) {
    return [];
  }

  const pattern = path.join(dir, '*.md');
  return glob(pattern);
}

/**
 * Get the expected Markdown output path for a YAML file
 * @param {string} yamlPath - Path to YAML file
 * @param {object} metadata - Parsed metadata (may contain output_path override)
 * @returns {string} Expected Markdown file path
 */
function getOutputPath(yamlPath, metadata = {}) {
  if (metadata.output_path) {
    // Validate that output_path stays within the same directory
    const dir = path.dirname(yamlPath);
    const resolvedOutput = path.resolve(dir, metadata.output_path);

    // Security check: ensure output is within repo
    if (!resolvedOutput.startsWith(dir)) {
      // Fall back to default if output_path tries to escape
      console.warn(`Warning: output_path "${metadata.output_path}" escapes directory, using default`);
    } else {
      return resolvedOutput;
    }
  }

  // Default: same name, .md extension, same directory
  const dir = path.dirname(yamlPath);
  const baseName = path.basename(yamlPath, '.yaml');
  return path.join(dir, `${baseName}.md`);
}

module.exports = {
  discoverYamlFiles,
  discoverYamlsInDir,
  discoverMarkdownFiles,
  discoverMdsInDir,
  getOutputPath
};
