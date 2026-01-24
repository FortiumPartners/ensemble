/**
 * @fortium/ensemble-react - React Framework Skills Plugin
 *
 * Provides comprehensive React development skills including:
 * - Modern component patterns with hooks
 * - State management approaches
 * - Performance optimization techniques
 * - TypeScript integration
 * - Testing patterns
 * - Code generation templates
 *
 * @version 4.0.0
 * @license MIT
 */

const path = require('path');
const fs = require('fs');

/**
 * Skill metadata for React framework
 */
const skillMetadata = {
  name: 'react-framework',
  version: '1.0.0',
  framework: 'React',
  minVersion: '18.0.0',
  language: ['JavaScript', 'TypeScript'],
  category: 'frontend',
  description: 'Progressive disclosure documentation for React development with modern patterns',

  // Detection configuration
  detection: {
    minimumConfidence: 0.8,
    primarySignals: [
      {
        type: 'package.json',
        path: 'dependencies.react',
        confidence: 0.4
      },
      {
        type: 'file-pattern',
        pattern: '**/*.{jsx,tsx}',
        directory: 'src/',
        confidence: 0.4
      }
    ],
    secondarySignals: [
      {
        type: 'package.json',
        path: 'dependencies.react-dom',
        confidence: 0.2
      },
      {
        type: 'import-statement',
        pattern: /from ['"]react['"]/,
        confidence: 0.2
      }
    ],
    boostFactors: [
      {
        type: 'config-file',
        files: ['next.config.js', 'next.config.mjs'],
        boost: 0.1
      },
      {
        type: 'config-file',
        files: ['vite.config.js', 'vite.config.ts'],
        boost: 0.1
      }
    ]
  },

  // Skill files
  files: {
    quickReference: 'skills/SKILL.md',
    comprehensive: 'skills/REFERENCE.md',
    patterns: 'skills/PATTERNS-EXTRACTED.md',
    validation: 'skills/VALIDATION.md',
    readme: 'skills/README.md'
  },

  // Code generation templates
  templates: {
    directory: 'skills/templates',
    available: [
      {
        name: 'component',
        file: 'component.template.tsx',
        description: 'Functional component with hooks and TypeScript'
      },
      {
        name: 'component-test',
        file: 'component.test.template.tsx',
        description: 'Component unit tests with React Testing Library'
      },
      {
        name: 'context',
        file: 'context.template.tsx',
        description: 'Context provider pattern for state management'
      },
      {
        name: 'hook',
        file: 'hook.template.ts',
        description: 'Custom hook for reusable logic'
      }
    ]
  },

  // Real-world examples
  examples: {
    directory: 'skills/examples',
    available: [
      {
        name: 'component-patterns',
        file: 'component-patterns.example.tsx',
        description: 'Component composition patterns and best practices'
      },
      {
        name: 'state-management',
        file: 'state-management.example.tsx',
        description: 'State management approaches with hooks and context'
      }
    ]
  },

  // Performance targets
  performance: {
    quickReferenceLoadTime: '<100ms',
    comprehensiveLoadTime: '<500ms',
    templateGeneration: '<50ms',
    codeGenerationSuccessRate: '≥95%',
    userSatisfaction: '≥90%'
  },

  // Capabilities
  capabilities: [
    'Component Architecture',
    'State Management',
    'Hooks & Effects',
    'Performance Optimization',
    'Testing Patterns',
    'TypeScript Integration'
  ]
};

/**
 * Load skill content
 * @param {string} type - 'quick' for SKILL.md or 'comprehensive' for REFERENCE.md
 * @returns {Promise<string>} Skill content
 */
async function loadSkill(type = 'quick') {
  const skillFile = type === 'comprehensive'
    ? skillMetadata.files.comprehensive
    : skillMetadata.files.quickReference;

  const skillPath = path.join(__dirname, '..', skillFile);

  try {
    const content = await fs.promises.readFile(skillPath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(`Failed to load React skill (${type}): ${error.message}`);
  }
}

/**
 * Get template content
 * @param {string} templateName - Name of the template
 * @returns {Promise<string>} Template content
 */
async function getTemplate(templateName) {
  const template = skillMetadata.templates.available.find(t => t.name === templateName);

  if (!template) {
    throw new Error(`Template '${templateName}' not found. Available: ${skillMetadata.templates.available.map(t => t.name).join(', ')}`);
  }

  const templatePath = path.join(__dirname, '..', skillMetadata.templates.directory, template.file);

  try {
    const content = await fs.promises.readFile(templatePath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(`Failed to load template '${templateName}': ${error.message}`);
  }
}

/**
 * Get example content
 * @param {string} exampleName - Name of the example
 * @returns {Promise<string>} Example content
 */
async function getExample(exampleName) {
  const example = skillMetadata.examples.available.find(e => e.name === exampleName);

  if (!example) {
    throw new Error(`Example '${exampleName}' not found. Available: ${skillMetadata.examples.available.map(e => e.name).join(', ')}`);
  }

  const examplePath = path.join(__dirname, '..', skillMetadata.examples.directory, example.file);

  try {
    const content = await fs.promises.readFile(examplePath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(`Failed to load example '${exampleName}': ${error.message}`);
  }
}

/**
 * Check if React is detected in the project
 * @param {string} projectPath - Path to project directory
 * @returns {Promise<{detected: boolean, confidence: number, signals: string[]}>}
 */
async function detectReact(projectPath) {
  const signals = [];
  let confidence = 0;

  try {
    // Check package.json for React dependency
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.dependencies?.react || packageJson.devDependencies?.react) {
        signals.push('package.json has React dependency');
        confidence += 0.4;
      }

      if (packageJson.dependencies?['react-dom'] || packageJson.devDependencies?.['react-dom']) {
        signals.push('package.json has react-dom dependency');
        confidence += 0.2;
      }
    }

    // Check for JSX/TSX files
    const srcPath = path.join(projectPath, 'src');
    if (fs.existsSync(srcPath)) {
      const hasReactFiles = await hasFilesWithExtension(srcPath, ['.jsx', '.tsx']);
      if (hasReactFiles) {
        signals.push('JSX/TSX files found in src/');
        confidence += 0.4;
      }
    }

    // Check for framework config files
    const configFiles = ['next.config.js', 'next.config.mjs', 'vite.config.js', 'vite.config.ts'];
    for (const configFile of configFiles) {
      if (fs.existsSync(path.join(projectPath, configFile))) {
        signals.push(`${configFile} detected`);
        confidence += 0.1;
      }
    }

  } catch (error) {
    // Silent failure - return no detection
  }

  return {
    detected: confidence >= skillMetadata.detection.minimumConfidence,
    confidence: Math.min(confidence, 1.0),
    signals
  };
}

/**
 * Helper to check for files with specific extensions
 */
async function hasFilesWithExtension(directory, extensions, depth = 2) {
  if (depth <= 0) return false;

  try {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        if (extensions.some(ext => entry.name.endsWith(ext))) {
          return true;
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const found = await hasFilesWithExtension(
          path.join(directory, entry.name),
          extensions,
          depth - 1
        );
        if (found) return true;
      }
    }
  } catch (error) {
    // Directory not accessible
  }

  return false;
}

// Export API
module.exports = {
  metadata: skillMetadata,
  loadSkill,
  getTemplate,
  getExample,
  detectReact
};
