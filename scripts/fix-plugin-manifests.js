#!/usr/bin/env node

/**
 * Fix plugin.json manifests to use array format for agents, commands, and skills
 * 
 * Changes:
 * - "agents": "./agents" → "agents": ["./agents/file1.md", "./agents/file2.md", ...]
 * - "commands": "./commands" → "commands": ["./commands/file1.md", ...]
 * - "skills": "./skills" → "skills": ["./skills/dir1", "./skills/dir2", ...]
 */

const fs = require('fs');
const path = require('path');

// Find all plugin.json files
const rootDir = path.join(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const pluginManifests = [];

if (fs.existsSync(packagesDir)) {
  const packages = fs.readdirSync(packagesDir);
  for (const pkg of packages) {
    const manifestPath = path.join(packagesDir, pkg, '.claude-plugin', 'plugin.json');
    if (fs.existsSync(manifestPath)) {
      pluginManifests.push(manifestPath);
    }
  }
}

console.log(`Found ${pluginManifests.length} plugin manifests to fix\n`);

let fixed = 0;
let skipped = 0;
let errors = 0;

for (const manifestPath of pluginManifests) {
  try {
    const packageDir = path.dirname(path.dirname(manifestPath));
    const packageName = path.basename(packageDir);
    
    console.log(`Processing: ${packageName}`);
    
    // Read manifest
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let modified = false;
    
    // Fix agents
    if (typeof manifest.agents === 'string') {
      const agentsDir = path.join(packageDir, manifest.agents);
      if (fs.existsSync(agentsDir)) {
        const agentFiles = fs.readdirSync(agentsDir)
          .filter(f => f.endsWith('.md'))
          .map(f => `./${manifest.agents}/${f}`);
        
        if (agentFiles.length > 0) {
          manifest.agents = agentFiles;
          console.log(`  ✓ Fixed agents: ${agentFiles.length} files`);
          modified = true;
        } else {
          manifest.agents = [];
          console.log(`  ✓ Fixed agents: empty array (no .md files found)`);
          modified = true;
        }
      } else {
        manifest.agents = [];
        console.log(`  ✓ Fixed agents: empty array (directory not found)`);
        modified = true;
      }
    }
    
    // Fix commands
    if (typeof manifest.commands === 'string') {
      const commandsDir = path.join(packageDir, manifest.commands);
      const commandFiles = [];
      
      if (fs.existsSync(commandsDir)) {
        // Check for nested ensemble/ directory structure
        const ensembleDir = path.join(commandsDir, 'ensemble');
        if (fs.existsSync(ensembleDir)) {
          // Use nested structure
          fs.readdirSync(ensembleDir)
            .filter(f => f.endsWith('.md'))
            .forEach(f => commandFiles.push(`./${manifest.commands}/ensemble/${f}`));
        } else {
          // Use flat structure
          fs.readdirSync(commandsDir)
            .filter(f => f.endsWith('.md'))
            .forEach(f => commandFiles.push(`./${manifest.commands}/${f}`));
        }
      }
      
      manifest.commands = commandFiles;
      console.log(`  ✓ Fixed commands: ${commandFiles.length} files`);
      modified = true;
    }
    
    // Fix skills
    if (typeof manifest.skills === 'string') {
      const skillsDir = path.join(packageDir, manifest.skills);
      if (fs.existsSync(skillsDir)) {
        const skillDirs = fs.readdirSync(skillsDir)
          .filter(f => {
            const fullPath = path.join(skillsDir, f);
            return fs.statSync(fullPath).isDirectory();
          })
          .map(d => `./${manifest.skills}/${d}`);
        
        if (skillDirs.length > 0) {
          manifest.skills = skillDirs;
          console.log(`  ✓ Fixed skills: ${skillDirs.length} directories`);
          modified = true;
        } else {
          manifest.skills = [];
          console.log(`  ✓ Fixed skills: empty array (no directories found)`);
          modified = true;
        }
      } else {
        manifest.skills = [];
        console.log(`  ✓ Fixed skills: empty array (directory not found)`);
        modified = true;
      }
    }
    
    if (modified) {
      // Write back with proper formatting
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(manifest, null, 2) + '\n',
        'utf8'
      );
      console.log(`  ✓ Saved: ${manifestPath}\n`);
      fixed++;
    } else {
      console.log(`  - Already in array format, skipped\n`);
      skipped++;
    }
    
  } catch (error) {
    console.error(`  ✗ Error processing ${manifestPath}: ${error.message}\n`);
    errors++;
  }
}

console.log('=====================================');
console.log(`Summary:`);
console.log(`  Fixed:   ${fixed}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Errors:  ${errors}`);
console.log(`  Total:   ${pluginManifests.length}`);
console.log('=====================================');

if (fixed > 0) {
  console.log('\nRun `claude plugin validate packages/<package-name>` to verify fixes');
}

process.exit(errors > 0 ? 1 : 0);
