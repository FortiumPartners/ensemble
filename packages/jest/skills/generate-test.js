#!/usr/bin/env node

/**
 * Jest Test Generator
 * Generates Jest test files from templates
 */

const fs = require('fs').promises;
const path = require('path');

class JestTestGenerator {
  constructor(options) {
    this.options = options;
    this.templateDir = path.join(__dirname, 'templates');
  }

  async generate() {
    const { source, output, type = 'unit', description, framework } = this.options;

    // Validate inputs
    if (!source) {
      throw new Error('Source file path is required (--source)');
    }
    if (!output) {
      throw new Error('Output test file path is required (--output)');
    }

    // Load template
    const templateName = `${type}-test.template.js`;
    const templatePath = path.join(this.templateDir, templateName);
    let template;

    try {
      template = await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      throw new Error(`Template not found: ${templateName}`);
    }

    // Generate test content
    const testContent = await this.populateTemplate(template, {
      source,
      description,
      framework
    });

    // Write test file
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, testContent);

    // Return result
    return {
      success: true,
      testFile: output,
      testCount: this.countTests(testContent),
      template: type,
      framework: framework || 'generic'
    };
  }

  async populateTemplate(template, context) {
    const { source, description, framework } = context;

    // Extract component/module name from source path
    const basename = path.basename(source, path.extname(source));
    const componentName = basename;

    // Determine imports based on framework
    let imports = '';
    if (framework === 'react') {
      imports = `import { render, fireEvent, screen } from '@testing-library/react';\nimport { ${componentName} } from '${this.getRelativeImport(source)}';`;
    } else {
      imports = `const { ${componentName} } = require('${this.getRelativeImport(source)}');`;
    }

    // Generate test name from description
    const testName = description || `should work correctly`;

    // Simple template replacement
    let result = template
      .replace(/{{IMPORTS}}/g, imports)
      .replace(/{{DESCRIBE_BLOCK}}/g, componentName)
      .replace(/{{TEST_NAME}}/g, testName)
      .replace(/{{BEFORE_EACH}}/g, '// Add setup code here')
      .replace(/{{AFTER_EACH}}/g, '// Add cleanup code here')
      .replace(/{{BEFORE_ALL}}/g, '// Add one-time setup here')
      .replace(/{{AFTER_ALL}}/g, '// Add one-time cleanup here')
      .replace(/{{ARRANGE}}/g, `// const instance = new ${componentName}();`)
      .replace(/{{ACT}}/g, '// const result = instance.method();')
      .replace(/{{ASSERT}}/g, '// expect(result).toBe(expected);')
      .replace(/{{TEST_CASES}}/g, '');

    return result;
  }

  getRelativeImport(sourcePath) {
    // Convert absolute path to relative import
    // Simplified - just return the path for now
    return sourcePath.replace(/\.(js|ts|jsx|tsx)$/, '');
  }

  countTests(content) {
    const matches = content.match(/it\(/g);
    return matches ? matches.length : 0;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const options = {};

  // Parse arguments
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    options[key] = value;
  }

  try {
    const generator = new JestTestGenerator(options);
    const result = await generator.generate();

    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error.message
    }, null, 2));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { JestTestGenerator };
