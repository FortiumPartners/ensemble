#!/usr/bin/env node

/**
 * Cloud Provider Detection System - Test Suite
 *
 * Comprehensive tests for cloud provider detection across 20 sample project scenarios.
 * Tests accuracy, confidence scoring, multi-signal detection, and edge cases.
 *
 * @version 1.0.0
 */

const fs = require('fs');
const path = require('path');
const { detectCloudProvider, loadPatterns } = require('./detect-cloud-provider.js');

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  failures: []
};

/**
 * Create temporary test project structure
 * @param {string} name - Test project name
 * @param {Object} files - Files to create { path: content }
 * @returns {string} Test project path
 */
function createTestProject(name, files) {
  const testDir = path.join(__dirname, 'test-projects', name);

  // Clean up existing test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  // Create directory structure
  fs.mkdirSync(testDir, { recursive: true });

  // Create files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(testDir, filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf8');
  }

  return testDir;
}

/**
 * Clean up test projects
 */
function cleanupTestProjects() {
  const testProjectsDir = path.join(__dirname, 'test-projects');
  if (fs.existsSync(testProjectsDir)) {
    fs.rmSync(testProjectsDir, { recursive: true, force: true });
  }
}

/**
 * Assert test condition
 * @param {boolean} condition - Test condition
 * @param {string} message - Test description
 */
function assert(condition, message) {
  testResults.total++;
  if (condition) {
    testResults.passed++;
    console.log(`✓ ${message}`);
  } else {
    testResults.failed++;
    testResults.failures.push(message);
    console.log(`✗ ${message}`);
  }
}

/**
 * Test: AWS Detection via Terraform
 */
async function testAwsTerraform() {
  console.log('\n=== Test 1: AWS Detection via Terraform ===');

  const projectPath = createTestProject('aws-terraform', {
    'main.tf': `
      provider "aws" {
        region = "us-east-1"
      }

      resource "aws_vpc" "main" {
        cidr_block = "10.0.0.0/16"
      }

      resource "aws_s3_bucket" "data" {
        bucket = "my-data-bucket"
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected');
  assert(result.provider === 'aws', 'Provider should be AWS');
  assert(result.confidence >= 0.7, 'Confidence should be ≥70%');
  assert(result.signals.terraform === true, 'Terraform signal should be detected');
}

/**
 * Test: GCP Detection via Terraform
 */
async function testGcpTerraform() {
  console.log('\n=== Test 2: GCP Detection via Terraform ===');

  const projectPath = createTestProject('gcp-terraform', {
    'main.tf': `
      provider "google" {
        project = "my-gcp-project"
        region  = "us-central1"
      }

      resource "google_compute_instance" "vm" {
        name         = "test-vm"
        machine_type = "n1-standard-1"
      }

      resource "google_storage_bucket" "data" {
        name     = "my-data-bucket"
        location = "US"
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'GCP should be detected');
  assert(result.provider === 'gcp', 'Provider should be GCP');
  assert(result.confidence >= 0.7, 'Confidence should be ≥70%');
  assert(result.signals.terraform === true, 'Terraform signal should be detected');
}

/**
 * Test: Azure Detection via Terraform
 */
async function testAzureTerraform() {
  console.log('\n=== Test 3: Azure Detection via Terraform ===');

  const projectPath = createTestProject('azure-terraform', {
    'main.tf': `
      provider "azurerm" {
        features {}
      }

      resource "azurerm_resource_group" "main" {
        name     = "my-resource-group"
        location = "East US"
      }

      resource "azurerm_storage_account" "storage" {
        name                     = "mystorageaccount"
        resource_group_name      = azurerm_resource_group.main.name
        location                 = azurerm_resource_group.main.location
        account_tier             = "Standard"
        account_replication_type = "LRS"
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'Azure should be detected');
  assert(result.provider === 'azure', 'Provider should be Azure');
  assert(result.confidence >= 0.7, 'Confidence should be ≥70%');
  assert(result.signals.terraform === true, 'Terraform signal should be detected');
}

/**
 * Test: AWS Detection via NPM packages
 */
async function testAwsNpm() {
  console.log('\n=== Test 4: AWS Detection via NPM ===');

  const projectPath = createTestProject('aws-npm', {
    'package.json': JSON.stringify({
      name: 'aws-app',
      dependencies: {
        '@aws-sdk/client-s3': '^3.0.0',
        '@aws-sdk/client-dynamodb': '^3.0.0',
        'aws-cdk-lib': '^2.0.0'
      }
    }, null, 2)
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected');
  assert(result.provider === 'aws', 'Provider should be AWS');
  assert(result.signals.npm === true, 'NPM signal should be detected');
}

/**
 * Test: GCP Detection via Python packages
 */
async function testGcpPython() {
  console.log('\n=== Test 5: GCP Detection via Python ===');

  const projectPath = createTestProject('gcp-python', {
    'requirements.txt': `
google-cloud-storage==2.10.0
google-cloud-pubsub==2.18.0
google-api-python-client==2.100.0
    `.trim()
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'GCP should be detected');
  assert(result.provider === 'gcp', 'Provider should be GCP');
  assert(result.signals.python === true, 'Python signal should be detected');
}

/**
 * Test: Azure Detection via CLI scripts
 */
async function testAzureCli() {
  console.log('\n=== Test 6: Azure Detection via CLI ===');

  const projectPath = createTestProject('azure-cli', {
    'deploy.sh': `
#!/bin/bash
az login
az vm create --resource-group myResourceGroup --name myVM --image UbuntuLTS
az storage account create --name mystorageaccount --resource-group myResourceGroup
    `.trim()
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'Azure should be detected');
  assert(result.provider === 'azure', 'Provider should be Azure');
  assert(result.signals.cli === true, 'CLI signal should be detected');
}

/**
 * Test: AWS Detection via Dockerfile
 */
async function testAwsDocker() {
  console.log('\n=== Test 7: AWS Detection via Docker ===');

  const projectPath = createTestProject('aws-docker', {
    'Dockerfile': `
FROM public.ecr.aws/lambda/nodejs:18
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["index.handler"]
    `.trim()
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected');
  assert(result.provider === 'aws', 'Provider should be AWS');
  assert(result.signals.docker === true, 'Docker signal should be detected');
}

/**
 * Test: Multi-signal AWS detection (high confidence)
 */
async function testAwsMultiSignal() {
  console.log('\n=== Test 8: AWS Multi-Signal Detection ===');

  const projectPath = createTestProject('aws-multi-signal', {
    'main.tf': `
      provider "aws" {
        region = "us-east-1"
      }
      resource "aws_s3_bucket" "data" {
        bucket = "my-bucket"
      }
    `,
    'package.json': JSON.stringify({
      dependencies: {
        '@aws-sdk/client-s3': '^3.0.0'
      }
    }),
    'deploy.sh': 'aws s3 sync ./dist s3://my-bucket',
    'Dockerfile': 'FROM public.ecr.aws/lambda/nodejs:18'
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected');
  assert(result.provider === 'aws', 'Provider should be AWS');
  assert(result.confidence >= 0.85, 'Multi-signal should boost confidence to ≥85%');
  assert(result.signal_count >= 3, 'Should detect at least 3 signals');
}

/**
 * Test: GCP Config files detection
 */
async function testGcpConfig() {
  console.log('\n=== Test 9: GCP Config Files Detection ===');

  const projectPath = createTestProject('gcp-config', {
    'cloudbuild.yaml': `
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/my-project/my-app', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/my-project/my-app']
    `,
    'service-account.json': JSON.stringify({
      type: 'service_account',
      project_id: 'my-gcp-project'
    })
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'GCP should be detected');
  assert(result.provider === 'gcp', 'Provider should be GCP');
  assert(result.signals.config === true, 'Config signal should be detected');
}

/**
 * Test: No cloud provider detection
 */
async function testNoCloudProvider() {
  console.log('\n=== Test 10: No Cloud Provider ===');

  const projectPath = createTestProject('no-cloud', {
    'package.json': JSON.stringify({
      dependencies: {
        'express': '^4.18.0',
        'react': '^18.2.0'
      }
    }),
    'index.js': 'console.log("Hello World");'
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === false, 'No provider should be detected');
  assert(result.confidence < 0.7, 'Confidence should be <70%');
}

/**
 * Test: Manual AWS override
 */
async function testManualOverride() {
  console.log('\n=== Test 11: Manual Provider Override ===');

  const projectPath = createTestProject('manual-override', {
    'package.json': JSON.stringify({ name: 'test' })
  });

  const result = await detectCloudProvider(projectPath, { provider: 'aws' });

  assert(result.detected === true, 'AWS should be detected via override');
  assert(result.provider === 'aws', 'Provider should be AWS');
  assert(result.confidence === 1.0, 'Manual override should have 100% confidence');
  assert(result.manual_override === true, 'Should indicate manual override');
}

/**
 * Test: Custom confidence threshold
 */
async function testCustomThreshold() {
  console.log('\n=== Test 12: Custom Confidence Threshold ===');

  const projectPath = createTestProject('custom-threshold', {
    'package.json': JSON.stringify({
      dependencies: {
        '@aws-sdk/client-s3': '^3.0.0'
      }
    })
  });

  // With high threshold, single signal might not meet it
  const result = await detectCloudProvider(projectPath, { minimumConfidence: 0.9 });

  // Should still return result but may not be detected due to high threshold
  assert(result.confidence !== undefined, 'Should calculate confidence');
  assert(result.all_results !== undefined, 'Should include all results');
}

/**
 * Test: Multi-cloud project (AWS + GCP)
 */
async function testMultiCloud() {
  console.log('\n=== Test 13: Multi-Cloud Project ===');

  const projectPath = createTestProject('multi-cloud', {
    'main.tf': `
      provider "aws" {
        region = "us-east-1"
      }
      provider "google" {
        project = "my-project"
      }
      resource "aws_s3_bucket" "data" {
        bucket = "my-bucket"
      }
      resource "google_storage_bucket" "backup" {
        name = "my-backup"
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'Should detect primary provider');
  assert(result.all_results.length > 1, 'Should detect multiple providers');

  // Check that both AWS and GCP have non-zero confidence
  const awsResult = result.all_results.find(r => r.provider === 'aws');
  const gcpResult = result.all_results.find(r => r.provider === 'gcp');

  assert(awsResult && awsResult.confidence > 0, 'AWS should have non-zero confidence');
  assert(gcpResult && gcpResult.confidence > 0, 'GCP should have non-zero confidence');
}

/**
 * Test: AWS ECS/Fargate patterns
 */
async function testAwsEcs() {
  console.log('\n=== Test 14: AWS ECS/Fargate Patterns ===');

  const projectPath = createTestProject('aws-ecs', {
    'infrastructure.tf': `
      resource "aws_ecs_cluster" "main" {
        name = "my-cluster"
      }
      resource "aws_ecs_service" "app" {
        name = "my-app"
        cluster = aws_ecs_cluster.main.id
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected via ECS');
  assert(result.provider === 'aws', 'Provider should be AWS');
}

/**
 * Test: GCP Cloud Run patterns
 */
async function testGcpCloudRun() {
  console.log('\n=== Test 15: GCP Cloud Run Patterns ===');

  const projectPath = createTestProject('gcp-cloudrun', {
    'main.tf': `
      resource "google_cloud_run_service" "app" {
        name     = "my-app"
        location = "us-central1"

        template {
          spec {
            containers {
              image = "gcr.io/my-project/my-app"
            }
          }
        }
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'GCP should be detected via Cloud Run');
  assert(result.provider === 'gcp', 'Provider should be GCP');
}

/**
 * Test: Azure AKS patterns
 */
async function testAzureAks() {
  console.log('\n=== Test 16: Azure AKS Patterns ===');

  const projectPath = createTestProject('azure-aks', {
    'kubernetes.tf': `
      resource "azurerm_kubernetes_cluster" "main" {
        name                = "my-aks-cluster"
        location            = azurerm_resource_group.main.location
        resource_group_name = azurerm_resource_group.main.name
        dns_prefix          = "myaks"
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'Azure should be detected via AKS');
  assert(result.provider === 'azure', 'Provider should be Azure');
}

/**
 * Test: AWS Lambda patterns
 */
async function testAwsLambda() {
  console.log('\n=== Test 17: AWS Lambda Patterns ===');

  const projectPath = createTestProject('aws-lambda', {
    'lambda.tf': `
      resource "aws_lambda_function" "handler" {
        filename      = "lambda_function.zip"
        function_name = "my_lambda"
        role          = aws_iam_role.lambda_role.arn
        handler       = "index.handler"
        runtime       = "nodejs18.x"
      }
    `,
    'Dockerfile': 'FROM public.ecr.aws/lambda/nodejs:18'
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected via Lambda');
  assert(result.provider === 'aws', 'Provider should be AWS');
  assert(result.signal_count >= 2, 'Should detect Terraform + Docker signals');
}

/**
 * Test: Pattern case sensitivity
 */
async function testCaseSensitivity() {
  console.log('\n=== Test 18: Pattern Case Sensitivity ===');

  const projectPath = createTestProject('case-sensitivity', {
    'main.tf': `
      # Lowercase provider
      provider "aws" {
        region = "us-east-1"
      }

      # Uppercase in comments: AWS, GCP, AZURE should not affect detection
      resource "aws_s3_bucket" "data" {
        bucket = "my-bucket"
      }
    `
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected (lowercase patterns)');
  assert(result.provider === 'aws', 'Provider should be AWS');
}

/**
 * Test: Nested directory structure
 */
async function testNestedStructure() {
  console.log('\n=== Test 19: Nested Directory Structure ===');

  const projectPath = createTestProject('nested-structure', {
    'terraform/environments/prod/main.tf': `
      provider "aws" {
        region = "us-east-1"
      }
    `,
    'src/config/aws-config.js': `
      const AWS = require('@aws-sdk/client-s3');
    `,
    'scripts/deploy/aws-deploy.sh': 'aws s3 sync ./dist s3://bucket'
  });

  const result = await detectCloudProvider(projectPath);

  assert(result.detected === true, 'AWS should be detected in nested structure');
  assert(result.provider === 'aws', 'Provider should be AWS');
  assert(result.signal_count >= 2, 'Should detect multiple signals in nested dirs');
}

/**
 * Test: Detection performance
 */
async function testPerformance() {
  console.log('\n=== Test 20: Detection Performance ===');

  const projectPath = createTestProject('performance-test', {
    'main.tf': `
      provider "aws" { region = "us-east-1" }
      resource "aws_s3_bucket" "b1" { bucket = "b1" }
      resource "aws_s3_bucket" "b2" { bucket = "b2" }
      resource "aws_s3_bucket" "b3" { bucket = "b3" }
    `,
    'package.json': JSON.stringify({ dependencies: { '@aws-sdk/client-s3': '^3.0.0' } }),
    'requirements.txt': 'boto3==1.28.0',
    'deploy.sh': 'aws s3 sync . s3://bucket',
    'Dockerfile': 'FROM public.ecr.aws/lambda/nodejs:18'
  });

  const startTime = Date.now();
  const result = await detectCloudProvider(projectPath);
  const duration = Date.now() - startTime;

  assert(result.detected === true, 'AWS should be detected');
  assert(duration < 100, `Detection should complete in <100ms (took ${duration}ms)`);
  console.log(`  Performance: ${duration}ms`);
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('='.repeat(60));
  console.log('Cloud Provider Detection - Test Suite');
  console.log('='.repeat(60));

  try {
    await testAwsTerraform();
    await testGcpTerraform();
    await testAzureTerraform();
    await testAwsNpm();
    await testGcpPython();
    await testAzureCli();
    await testAwsDocker();
    await testAwsMultiSignal();
    await testGcpConfig();
    await testNoCloudProvider();
    await testManualOverride();
    await testCustomThreshold();
    await testMultiCloud();
    await testAwsEcs();
    await testGcpCloudRun();
    await testAzureAks();
    await testAwsLambda();
    await testCaseSensitivity();
    await testNestedStructure();
    await testPerformance();
  } catch (error) {
    console.error('\n\nTest execution error:', error);
    testResults.failed++;
  } finally {
    cleanupTestProjects();
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Total:  ${testResults.total}`);
  console.log(`Passed: ${testResults.passed} ✓`);
  console.log(`Failed: ${testResults.failed} ✗`);

  if (testResults.failed > 0) {
    console.log('\nFailed tests:');
    testResults.failures.forEach(failure => console.log(`  - ${failure}`));
  }

  const successRate = ((testResults.passed / testResults.total) * 100).toFixed(1);
  console.log(`\nSuccess Rate: ${successRate}%`);

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests if called directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  createTestProject,
  cleanupTestProjects
};
