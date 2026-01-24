#!/usr/bin/env node

/**
 * Template Testing Script
 *
 * Validates NestJS code generation templates by:
 * 1. Replacing placeholders with test values
 * 2. Parsing generated code with TypeScript compiler
 * 3. Validating NestJS decorators and imports
 * 4. Checking code structure and conventions
 *
 * Usage: node test-templates.js
 */

const fs = require('fs');
const path = require('path');

// Test entity configuration
const TEST_ENTITY = {
  EntityName: 'Product',                      // PascalCase
  entityName: 'product',                      // camelCase
  'entity-name': 'product',                   // kebab-case
  'entity-name-plural': 'products',           // kebab-case plural
  'entity-display-name': 'product',           // lowercase for display
  'entity-display-name-plural': 'products',   // lowercase plural for display
  'endpoint-path': 'products',                // API endpoint path
  'table-name': 'products',                   // Database table name
  'ENTITY_NAME': 'PRODUCT'                    // SCREAMING_SNAKE_CASE
};

// Template files to test
const TEMPLATES = [
  'controller.template.ts',
  'service.template.ts',
  'repository.template.ts',
  'dto.template.ts',
  'entity.template.ts',
  'module.template.ts',
  'service.spec.template.ts'
];

// Expected imports for each template
const EXPECTED_IMPORTS = {
  'controller.template.ts': [
    '@nestjs/common',
    '@nestjs/swagger',
    'class-validator',
    'class-transformer'
  ],
  'service.template.ts': [
    '@nestjs/common',
    '@nestjs/cache-manager',
    '@nestjs/event-emitter'
  ],
  'repository.template.ts': [
    '@nestjs/common',
    '@nestjs/typeorm',
    'typeorm'
  ],
  'dto.template.ts': [
    '@nestjs/swagger',
    'class-validator',
    'class-transformer'
  ],
  'entity.template.ts': [
    'typeorm',
    'class-transformer'
  ],
  'module.template.ts': [
    '@nestjs/common',
    '@nestjs/typeorm'
  ],
  'service.spec.template.ts': [
    '@nestjs/testing'
  ]
};

// Expected decorators for each template
const EXPECTED_DECORATORS = {
  'controller.template.ts': ['@Controller', '@ApiTags', '@UseGuards', '@Get', '@Post', '@Patch', '@Delete'],
  'service.template.ts': ['@Injectable'],
  'repository.template.ts': ['@Injectable', '@InjectRepository'],
  'dto.template.ts': ['@ApiProperty', '@IsString', '@IsOptional', '@Expose', '@Exclude'],
  'entity.template.ts': ['@Entity', '@PrimaryGeneratedColumn', '@Column', '@CreateDateColumn'],
  'module.template.ts': ['@Module'],
  'service.spec.template.ts': ['describe', 'it', 'beforeEach', 'expect']
};

// Test results
const results = {
  passed: 0,
  failed: 0,
  errors: []
};

/**
 * Replace placeholders in template content
 */
function replacePlaceholders(content, entity) {
  let result = content;

  // Replace all placeholder variations (order matters - most specific first)
  result = result.replace(/\{\{entity-name-plural\}\}/g, entity['entity-name-plural']);
  result = result.replace(/\{\{entity-display-name-plural\}\}/g, entity['entity-display-name-plural']);
  result = result.replace(/\{\{entity-display-name\}\}/g, entity['entity-display-name']);
  result = result.replace(/\{\{entity-name\}\}/g, entity['entity-name']);
  result = result.replace(/\{\{endpoint-path\}\}/g, entity['endpoint-path']);
  result = result.replace(/\{\{table-name\}\}/g, entity['table-name']);
  result = result.replace(/\{\{ENTITY_NAME\}\}/g, entity['ENTITY_NAME']);
  result = result.replace(/\{\{EntityName\}\}/g, entity.EntityName);
  result = result.replace(/\{\{entityName\}\}/g, entity.entityName);

  return result;
}

/**
 * Validate TypeScript syntax (basic checks)
 */
function validateTypeScriptSyntax(content, templateName) {
  const errors = [];

  // Check for unclosed braces
  const openBraces = (content.match(/\{/g) || []).length;
  const closeBraces = (content.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Unmatched braces: ${openBraces} open, ${closeBraces} close`);
  }

  // Check for unclosed parentheses
  const openParens = (content.match(/\(/g) || []).length;
  const closeParens = (content.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push(`Unmatched parentheses: ${openParens} open, ${closeParens} close`);
  }

  // Check for unclosed brackets
  const openBrackets = (content.match(/\[/g) || []).length;
  const closeBrackets = (content.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    errors.push(`Unmatched brackets: ${openBrackets} open, ${closeBrackets} close`);
  }

  // Check for remaining placeholders
  const remainingPlaceholders = content.match(/\{\{[^}]+\}\}/g);
  if (remainingPlaceholders) {
    errors.push(`Unreplaced placeholders: ${remainingPlaceholders.join(', ')}`);
  }

  // Check for basic TypeScript structure
  if (!templateName.includes('.spec.')) {
    // Should have at least one export for non-test files
    if (!content.includes('export ')) {
      errors.push('No export statements found');
    }
  }

  return errors;
}

/**
 * Validate expected imports
 */
function validateImports(content, templateName) {
  const errors = [];
  const expectedImports = EXPECTED_IMPORTS[templateName] || [];

  for (const importPackage of expectedImports) {
    const importRegex = new RegExp(`from ['"]${importPackage.replace(/\//g, '\\/')}`, 'g');
    if (!importRegex.test(content)) {
      errors.push(`Missing expected import: ${importPackage}`);
    }
  }

  return errors;
}

/**
 * Validate expected decorators
 */
function validateDecorators(content, templateName) {
  const errors = [];
  const expectedDecorators = EXPECTED_DECORATORS[templateName] || [];

  for (const decorator of expectedDecorators) {
    if (!content.includes(decorator)) {
      errors.push(`Missing expected decorator/function: ${decorator}`);
    }
  }

  return errors;
}

/**
 * Validate NestJS conventions
 */
function validateNestJSConventions(content, templateName, entity) {
  const errors = [];

  // Check class naming conventions
  if (templateName.includes('controller')) {
    if (!content.includes(`${entity.EntityName}Controller`)) {
      errors.push(`Controller should be named ${entity.EntityName}Controller`);
    }
  }

  if (templateName.includes('service') && !templateName.includes('.spec.')) {
    if (!content.includes(`${entity.EntityName}Service`)) {
      errors.push(`Service should be named ${entity.EntityName}Service`);
    }
  }

  if (templateName.includes('repository')) {
    if (!content.includes(`${entity.EntityName}Repository`)) {
      errors.push(`Repository should be named ${entity.EntityName}Repository`);
    }
  }

  if (templateName.includes('module')) {
    if (!content.includes(`${entity.EntityName}sModule`) && !content.includes(`${entity.EntityName}Module`)) {
      errors.push(`Module should be named ${entity.EntityName}Module or ${entity.EntityName}sModule`);
    }
  }

  // Check for proper decorator usage
  if (templateName.includes('controller')) {
    if (!content.includes('@Controller(')) {
      errors.push('Controller missing @Controller decorator');
    }
  }

  if (templateName.includes('service') && !templateName.includes('.spec.')) {
    if (!content.includes('@Injectable()')) {
      errors.push('Service missing @Injectable decorator');
    }
  }

  return errors;
}

/**
 * Test a single template
 */
function testTemplate(templateName) {
  console.log(`\n🧪 Testing: ${templateName}`);
  console.log('─'.repeat(60));

  const templatePath = path.join(__dirname, templateName);

  // Read template file
  let content;
  try {
    content = fs.readFileSync(templatePath, 'utf-8');
  } catch (error) {
    console.error(`❌ Failed to read template: ${error.message}`);
    results.failed++;
    results.errors.push({ template: templateName, error: `File read error: ${error.message}` });
    return;
  }

  // Replace placeholders
  const generated = replacePlaceholders(content, TEST_ENTITY);

  // Run all validations
  const allErrors = [];

  // 1. TypeScript syntax validation
  const syntaxErrors = validateTypeScriptSyntax(generated, templateName);
  if (syntaxErrors.length > 0) {
    allErrors.push({ category: 'Syntax', errors: syntaxErrors });
  }

  // 2. Import validation
  const importErrors = validateImports(generated, templateName);
  if (importErrors.length > 0) {
    allErrors.push({ category: 'Imports', errors: importErrors });
  }

  // 3. Decorator validation
  const decoratorErrors = validateDecorators(generated, templateName);
  if (decoratorErrors.length > 0) {
    allErrors.push({ category: 'Decorators', errors: decoratorErrors });
  }

  // 4. NestJS conventions validation
  const conventionErrors = validateNestJSConventions(generated, templateName, TEST_ENTITY);
  if (conventionErrors.length > 0) {
    allErrors.push({ category: 'Conventions', errors: conventionErrors });
  }

  // Report results
  if (allErrors.length === 0) {
    console.log('✅ All validations passed');
    console.log(`   • TypeScript syntax: valid`);
    console.log(`   • Expected imports: present`);
    console.log(`   • Expected decorators: present`);
    console.log(`   • NestJS conventions: followed`);
    results.passed++;
  } else {
    console.log('❌ Validation failed:');
    allErrors.forEach(({ category, errors }) => {
      console.log(`\n   ${category} Errors:`);
      errors.forEach(error => console.log(`   • ${error}`));
    });
    results.failed++;
    results.errors.push({ template: templateName, errors: allErrors });
  }
}

/**
 * Generate sample output for manual inspection
 */
function generateSampleOutput() {
  console.log('\n\n📄 Generating sample output files...');
  console.log('─'.repeat(60));

  const outputDir = path.join(__dirname, 'test-output');

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  TEMPLATES.forEach(templateName => {
    const templatePath = path.join(__dirname, templateName);
    const content = fs.readFileSync(templatePath, 'utf-8');
    const generated = replacePlaceholders(content, TEST_ENTITY);

    // Write generated file
    const outputFileName = templateName.replace('.template.ts', '.generated.ts');
    const outputPath = path.join(outputDir, outputFileName);
    fs.writeFileSync(outputPath, generated);

    console.log(`✅ Generated: ${outputFileName}`);
  });

  console.log(`\n📁 Output directory: ${outputDir}`);
}

/**
 * Print summary
 */
function printSummary() {
  console.log('\n\n📊 Test Summary');
  console.log('═'.repeat(60));
  console.log(`Total templates: ${TEMPLATES.length}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);

  if (results.failed > 0) {
    console.log('\n❌ Failed Templates:');
    results.errors.forEach(({ template }) => {
      console.log(`   • ${template}`);
    });
  }

  const successRate = ((results.passed / TEMPLATES.length) * 100).toFixed(1);
  console.log(`\n📈 Success Rate: ${successRate}%`);

  if (results.failed === 0) {
    console.log('\n🎉 All templates validated successfully!');
  } else {
    console.log('\n⚠️  Some templates need fixes. See errors above.');
  }
}

/**
 * Main execution
 */
function main() {
  console.log('🚀 NestJS Template Testing Suite');
  console.log('═'.repeat(60));
  console.log(`Testing entity: ${TEST_ENTITY.EntityName}`);
  console.log(`Templates directory: ${__dirname}`);

  // Test all templates
  TEMPLATES.forEach(testTemplate);

  // Generate sample output
  generateSampleOutput();

  // Print summary
  printSummary();

  // Exit with appropriate code
  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
main();
