#!/usr/bin/env node

/**
 * Performance Benchmark for Tooling Detection
 *
 * Tests detection performance with and without optimizations:
 * - Baseline (no cache, sequential)
 * - With caching
 * - Parallel detection
 * - Combined optimizations
 */

const { detectTooling, detectTool, detectionCache } = require('./detect-tooling');
const path = require('path');

/**
 * Run multiple iterations and calculate average
 */
async function benchmark(iterations, fn) {
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fn();
    const duration = Date.now() - start;
    times.push(duration);
  }

  const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  return { avg, min, max, times };
}

/**
 * Test Fly.io detection performance
 */
async function testFlyioDetection() {
  console.log('\n=== Fly.io Detection Performance Benchmark ===\n');

  const projectPath = process.cwd();
  const iterations = 10;

  // Test 1: Detection without cache (clear before each run)
  console.log('Test 1: Detection without cache (10 iterations)');
  const noCacheResults = await benchmark(iterations, async () => {
    detectionCache.clear();
    await detectTool(projectPath, 'flyio', { useCache: false });
  });
  console.log(`  Average: ${noCacheResults.avg.toFixed(2)}ms`);
  console.log(`  Min: ${noCacheResults.min}ms, Max: ${noCacheResults.max}ms`);
  console.log(`  Times: [${noCacheResults.times.join(', ')}]`);

  // Test 2: Detection with cache (first run populates cache)
  console.log('\nTest 2: Detection with cache (10 iterations, cache persists)');
  detectionCache.clear();
  const withCacheResults = await benchmark(iterations, async () => {
    await detectTool(projectPath, 'flyio', { useCache: true });
  });
  console.log(`  Average: ${withCacheResults.avg.toFixed(2)}ms`);
  console.log(`  Min: ${withCacheResults.min}ms, Max: ${withCacheResults.max}ms`);
  console.log(`  Times: [${withCacheResults.times.join(', ')}]`);
  console.log(`  Cache hit improvement: ${((1 - withCacheResults.avg / noCacheResults.avg) * 100).toFixed(1)}%`);

  // Test 3: Single detection with fresh cache
  console.log('\nTest 3: Single detection performance');
  detectionCache.clear();
  const start1 = Date.now();
  const result1 = await detectTool(projectPath, 'flyio');
  const duration1 = Date.now() - start1;
  console.log(`  First run (cold): ${duration1}ms`);

  const start2 = Date.now();
  const result2 = await detectTool(projectPath, 'flyio');
  const duration2 = Date.now() - start2;
  console.log(`  Second run (warm): ${duration2}ms`);
  console.log(`  Cache speedup: ${((1 - duration2 / duration1) * 100).toFixed(1)}%`);

  // Test 4: All tools detection
  console.log('\nTest 4: All tools detection (helm, kubernetes, kustomize, argocd, flyio)');
  detectionCache.clear();
  const allToolsResults = await benchmark(5, async () => {
    detectionCache.clear();
    await detectTooling(projectPath, { useCache: false });
  });
  console.log(`  Average: ${allToolsResults.avg.toFixed(2)}ms`);
  console.log(`  Min: ${allToolsResults.min}ms, Max: ${allToolsResults.max}ms`);

  // Summary
  console.log('\n=== Performance Summary ===');
  console.log(`  Target: <10ms detection time`);
  console.log(`  Achieved (single tool, no cache): ${noCacheResults.avg.toFixed(2)}ms`);
  console.log(`  Achieved (single tool, with cache): ${withCacheResults.avg.toFixed(2)}ms`);
  console.log(`  Status: ${noCacheResults.avg < 10 ? '✅ PASSED' : '❌ FAILED'} (no cache)`);
  console.log(`  Status: ${withCacheResults.avg < 10 ? '✅ PASSED' : '❌ FAILED'} (with cache)`);

  // Performance improvements
  console.log('\n=== Performance Improvements ===');
  console.log(`  Baseline (Sprint 2): 90ms`);
  console.log(`  Current (no cache): ${noCacheResults.avg.toFixed(2)}ms`);
  console.log(`  Improvement: ${((1 - noCacheResults.avg / 90) * 100).toFixed(1)}%`);
  console.log(`  Current (with cache): ${withCacheResults.avg.toFixed(2)}ms`);
  console.log(`  Improvement: ${((1 - withCacheResults.avg / 90) * 100).toFixed(1)}%`);
}

/**
 * Test detection accuracy
 */
async function testDetectionAccuracy() {
  console.log('\n=== Detection Accuracy Test ===\n');

  const projectPath = process.cwd();

  // Test Fly.io detection
  const flyioResult = await detectTool(projectPath, 'flyio');
  console.log('Fly.io Detection:');
  console.log(`  Detected: ${flyioResult.detected}`);
  console.log(`  Confidence: ${(flyioResult.confidence * 100).toFixed(1)}%`);
  console.log(`  Signals: ${JSON.stringify(flyioResult.signals, null, 2)}`);
  console.log(`  Signal count: ${flyioResult.signal_count}`);

  // Verify accuracy
  const expectedDetected = true;
  const expectedConfidence = 0.8;

  const accuracyPassed = flyioResult.detected === expectedDetected &&
                         flyioResult.confidence >= expectedConfidence;

  console.log(`\n  Accuracy Status: ${accuracyPassed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`    Expected detected: ${expectedDetected}, Actual: ${flyioResult.detected}`);
  console.log(`    Expected confidence: >=${expectedConfidence}, Actual: ${flyioResult.confidence.toFixed(2)}`);
}

/**
 * Main benchmark execution
 */
async function main() {
  console.log('Tooling Detection Performance Benchmark');
  console.log('========================================');

  try {
    await testFlyioDetection();
    await testDetectionAccuracy();

    console.log('\n========================================');
    console.log('Benchmark completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\nBenchmark failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { benchmark, testFlyioDetection, testDetectionAccuracy };
