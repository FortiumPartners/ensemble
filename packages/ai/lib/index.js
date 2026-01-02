/**
 * @fortium/ensemble-ai - AI SDK Skills Plugin
 *
 * Provides comprehensive AI development skills including:
 * - OpenAI Chat Completions API patterns
 * - OpenAI Responses API patterns
 * - Agents SDK integration
 * - Embeddings API usage
 * - Streaming patterns (sync and async)
 * - Tool calling and function patterns
 * - Code generation templates
 *
 * @version 5.1.0
 * @license MIT
 */

const path = require('path');
const fs = require('fs');

/**
 * Skill metadata for AI providers
 */
const skillMetadata = {
  name: 'ai-providers',
  version: '5.1.0',
  providers: ['openai'],
  language: ['Python', 'TypeScript'],
  category: 'ai',
  description: 'Progressive disclosure documentation for AI SDK development',

  // Detection configuration
  detection: {
    minimumConfidence: 0.8,
    primarySignals: [
      {
        type: 'package.json',
        path: 'dependencies.openai',
        confidence: 0.5
      },
      {
        type: 'requirements.txt',
        pattern: 'openai',
        confidence: 0.5
      },
      {
        type: 'pyproject.toml',
        pattern: 'openai',
        confidence: 0.5
      }
    ],
    secondarySignals: [
      {
        type: 'env-file',
        pattern: 'OPENAI_API_KEY',
        confidence: 0.3
      },
      {
        type: 'import-statement',
        pattern: /from openai import|import openai/,
        confidence: 0.3
      }
    ],
    boostFactors: [
      {
        type: 'file-pattern',
        pattern: '**/*agent*.py',
        boost: 0.1
      },
      {
        type: 'file-pattern',
        pattern: '**/*embedding*.py',
        boost: 0.1
      }
    ]
  },

  // Skill files
  files: {
    quickReference: 'skills/openai/SKILL.md',
    comprehensive: 'skills/openai/REFERENCE.md',
    validation: 'skills/openai/VALIDATION.md',
    readme: 'skills/openai/README.md'
  },

  // Code generation templates
  templates: {
    directory: 'skills/openai/templates',
    available: [
      {
        name: 'chat-completion-python',
        file: 'chat-completion.template.py',
        description: 'Chat Completions API with Python'
      },
      {
        name: 'chat-completion-typescript',
        file: 'chat-completion.template.ts',
        description: 'Chat Completions API with TypeScript'
      },
      {
        name: 'streaming-python',
        file: 'streaming.template.py',
        description: 'Streaming responses with Python'
      },
      {
        name: 'agent-python',
        file: 'agent.template.py',
        description: 'Agents SDK integration'
      },
      {
        name: 'embeddings-python',
        file: 'embeddings.template.py',
        description: 'Embeddings API usage'
      }
    ]
  },

  // Real-world examples
  examples: {
    directory: 'skills/openai/examples',
    available: [
      {
        name: 'basic-chat',
        file: 'basic-chat.example.py',
        description: 'Basic chat completion example'
      },
      {
        name: 'tool-calling',
        file: 'tool-calling.example.py',
        description: 'Tool calling and function patterns'
      },
      {
        name: 'streaming',
        file: 'streaming.example.py',
        description: 'Streaming response patterns'
      },
      {
        name: 'embeddings',
        file: 'embeddings.example.py',
        description: 'Embeddings API usage'
      }
    ]
  },

  // Performance targets
  performance: {
    quickReferenceLoadTime: '<100ms',
    comprehensiveLoadTime: '<500ms',
    templateGeneration: '<50ms',
    codeGenerationSuccessRate: '>=95%',
    userSatisfaction: '>=90%'
  },

  // Capabilities
  capabilities: [
    'Chat Completions API',
    'Responses API',
    'Agents SDK',
    'Embeddings API',
    'Tool Calling',
    'Streaming',
    'Structured Output',
    'Vision/Multimodal'
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
    throw new Error(`Failed to load AI skill (${type}): ${error.message}`);
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
 * Check if OpenAI is detected in the project
 * @param {string} projectPath - Path to project directory
 * @returns {Promise<{detected: boolean, confidence: number, signals: string[]}>}
 */
async function detectOpenAI(projectPath) {
  const signals = [];
  let confidence = 0;

  try {
    // Check package.json for OpenAI dependency (Node.js)
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));

      if (packageJson.dependencies?.openai || packageJson.devDependencies?.openai) {
        signals.push('package.json has openai dependency');
        confidence += 0.5;
      }
    }

    // Check requirements.txt for OpenAI (Python)
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      const requirements = await fs.promises.readFile(requirementsPath, 'utf-8');
      if (requirements.includes('openai')) {
        signals.push('requirements.txt has openai dependency');
        confidence += 0.5;
      }
    }

    // Check pyproject.toml for OpenAI (Python)
    const pyprojectPath = path.join(projectPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      const pyproject = await fs.promises.readFile(pyprojectPath, 'utf-8');
      if (pyproject.includes('openai')) {
        signals.push('pyproject.toml has openai dependency');
        confidence += 0.5;
      }
    }

    // Check for .env file with OPENAI_API_KEY
    const envPath = path.join(projectPath, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = await fs.promises.readFile(envPath, 'utf-8');
      if (envContent.includes('OPENAI_API_KEY')) {
        signals.push('.env contains OPENAI_API_KEY');
        confidence += 0.3;
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

// Export API
module.exports = {
  name: 'ensemble-ai',
  version: '5.1.0',
  metadata: skillMetadata,
  loadSkill,
  getTemplate,
  getExample,
  detectOpenAI
};
