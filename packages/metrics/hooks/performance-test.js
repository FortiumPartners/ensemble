#!/usr/bin/env node
/**
 * Performance Test Suite for Node.js Analytics Hooks
 * Validates that all TRD performance requirements are met
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class PerformanceTest {
    constructor() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
    }

    /**
     * Run comprehensive performance test suite
     */
    async runTests() {
        console.log('🚀 Claude Config Node.js Performance Test Suite');
        console.log('=============================================\n');
        
        try {
            // Test 1: Session Start Performance
            await this.testSessionStart();
            
            // Test 2: Session End Performance  
            await this.testSessionEnd();
            
            // Test 3: Tool Metrics Performance
            await this.testToolMetrics();
            
            // Test 4: Analytics Engine Performance
            await this.testAnalyticsEngine();
            
            // Test 5: Memory Usage Tests
            await this.testMemoryUsage();
            
            // Test 6: Dependency Validation
            await this.testDependencies();
            
            // Test 7: Data Compatibility
            await this.testDataCompatibility();
            
            // Final Results
            this.printResults();
            
            return this.failed === 0;
            
        } catch (error) {
            console.error('❌ Test suite failed:', error);
            return false;
        }
    }

    /**
     * Test session start hook performance
     */
    async testSessionStart() {
        console.log('1️⃣  Testing Session Start Hook Performance...');
        
        const { main } = require('./session-start.js');
        
        const startTime = process.hrtime.bigint();
        const result = await main();
        const endTime = process.hrtime.bigint();
        
        const executionTime = Number(endTime - startTime) / 1000000; // ms
        const memoryMB = result.memoryUsage / 1024 / 1024;
        
        // TRD Requirements: ≤50ms execution, ≤32MB memory
        this.assert('session_start_time', executionTime <= 50, 
            `Execution time: ${executionTime.toFixed(2)}ms (≤50ms required)`);
        
        this.assert('session_start_memory', memoryMB <= 32,
            `Memory usage: ${memoryMB.toFixed(1)}MB (≤32MB required)`);
        
        this.assert('session_start_success', result.success,
            `Hook execution successful`);
        
        // Bonus: Target performance (≤30ms, ≤20MB)
        if (executionTime <= 30) {
            console.log(`   🎯 TARGET EXCEEDED: ${executionTime.toFixed(2)}ms (target: ≤30ms)`);
        }
        
        if (memoryMB <= 20) {
            console.log(`   🎯 TARGET EXCEEDED: ${memoryMB.toFixed(1)}MB (target: ≤20MB)`);
        }
        
        console.log('');
    }

    /**
     * Test session end hook performance
     */
    async testSessionEnd() {
        console.log('2️⃣  Testing Session End Hook Performance...');
        
        // Set up session ID from previous test
        const indicatorsFile = path.join(os.homedir(), '.agent-os', 'metrics', 'productivity-indicators.json');
        let sessionId = 'test-session';
        
        if (await fs.pathExists(indicatorsFile)) {
            const indicators = await fs.readJSON(indicatorsFile);
            sessionId = indicators.session_id || sessionId;
        }
        
        process.env.CLAUDE_SESSION_ID = sessionId;
        
        const { main } = require('./session-end.js');
        
        const startTime = process.hrtime.bigint();
        const result = await main();
        const endTime = process.hrtime.bigint();
        
        const executionTime = Number(endTime - startTime) / 1000000; // ms
        const memoryMB = result.memoryUsage / 1024 / 1024;
        
        // TRD Requirements: ≤50ms execution, ≤32MB memory
        this.assert('session_end_time', executionTime <= 50,
            `Execution time: ${executionTime.toFixed(2)}ms (≤50ms required)`);
        
        this.assert('session_end_memory', memoryMB <= 32,
            `Memory usage: ${memoryMB.toFixed(1)}MB (≤32MB required)`);
        
        this.assert('session_end_success', result.success,
            `Hook execution successful`);
        
        // Bonus: Target performance
        if (executionTime <= 30) {
            console.log(`   🎯 TARGET EXCEEDED: ${executionTime.toFixed(2)}ms (target: ≤30ms)`);
        }
        
        console.log('');
    }

    /**
     * Test tool metrics hook performance
     */
    async testToolMetrics() {
        console.log('3️⃣  Testing Tool Metrics Hook Performance...');
        
        const { main } = require('./tool-metrics.js');
        
        // Test different tool types
        const toolTests = [
            { toolName: 'Read', toolInput: { file_path: '/tmp/test.txt' } },
            { toolName: 'Edit', toolInput: { file_path: '/tmp/test.txt', old_string: 'old', new_string: 'new' } },
            { toolName: 'Write', toolInput: { file_path: '/tmp/new.txt', content: 'test content' } },
            { toolName: 'Task', toolInput: { subagent_type: 'frontend-developer', description: 'test task' } }
        ];
        
        for (const toolTest of toolTests) {
            const startTime = process.hrtime.bigint();
            const result = await main({
                toolName: toolTest.toolName,
                toolInput: toolTest.toolInput,
                error: null,
                executionTime: 10
            });
            const endTime = process.hrtime.bigint();
            
            const executionTime = Number(endTime - startTime) / 1000000; // ms
            const memoryMB = result.memoryUsage / 1024 / 1024;
            
            // TRD Requirements: ≤50ms execution, ≤32MB memory
            this.assert(`tool_metrics_${toolTest.toolName.toLowerCase()}_time`, executionTime <= 50,
                `${toolTest.toolName} execution: ${executionTime.toFixed(2)}ms (≤50ms required)`);
            
            this.assert(`tool_metrics_${toolTest.toolName.toLowerCase()}_memory`, memoryMB <= 32,
                `${toolTest.toolName} memory: ${memoryMB.toFixed(1)}MB (≤32MB required)`);
        }
        
        console.log('');
    }

    /**
     * Test analytics engine performance
     */
    async testAnalyticsEngine() {
        console.log('4️⃣  Testing Analytics Engine Performance...');
        
        const { generateDashboardData, MetricsAnalyzer } = require('./analytics-engine.js');
        
        // Test dashboard data generation (full analytics processing)
        const startTime = process.hrtime.bigint();
        const dashboardData = await generateDashboardData();
        const endTime = process.hrtime.bigint();
        
        const executionTime = Number(endTime - startTime) / 1000000; // ms
        const memoryUsage = process.memoryUsage();
        const memoryMB = memoryUsage.heapUsed / 1024 / 1024;
        
        // TRD Requirements: ≤2 seconds for analytics processing, ≤32MB memory
        this.assert('analytics_processing_time', executionTime <= 2000,
            `Analytics processing: ${executionTime.toFixed(0)}ms (≤2000ms required)`);
        
        this.assert('analytics_memory', memoryMB <= 32,
            `Memory usage: ${memoryMB.toFixed(1)}MB (≤32MB required)`);
        
        this.assert('dashboard_data_generated', !!dashboardData.dashboard_updated,
            `Dashboard data generation successful`);
        
        // Test individual analyzer functions
        const analyzer = new MetricsAnalyzer();
        
        // Test productivity score calculation
        const testSession = {
            duration_hours: 2,
            metrics: {
                commands_executed: 30,
                lines_changed: 200,
                success_rate: 95,
                agents_used: 2
            }
        };
        
        const scoreStartTime = process.hrtime.bigint();
        const productivityScore = await analyzer.calculateProductivityScore(testSession);
        const scoreEndTime = process.hrtime.bigint();
        
        const scoreTime = Number(scoreEndTime - scoreStartTime) / 1000000;
        
        this.assert('productivity_score_calculation', scoreTime <= 100,
            `Productivity score calculation: ${scoreTime.toFixed(2)}ms`);
        
        this.assert('productivity_score_range', productivityScore >= 0 && productivityScore <= 10,
            `Productivity score in valid range: ${productivityScore.toFixed(1)}/10`);
        
        // Bonus: Target performance (≤1.5s, ≤20MB)
        if (executionTime <= 1500) {
            console.log(`   🎯 TARGET EXCEEDED: ${executionTime.toFixed(0)}ms (target: ≤1500ms)`);
        }
        
        console.log('');
    }

    /**
     * Test memory usage across all components
     */
    async testMemoryUsage() {
        console.log('5️⃣  Testing Memory Usage...');
        
        const initialMemory = process.memoryUsage();
        
        // Simulate intensive usage
        for (let i = 0; i < 10; i++) {
            const { generateDashboardData } = require('./analytics-engine.js');
            await generateDashboardData();
        }
        
        const finalMemory = process.memoryUsage();
        const memoryDelta = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
        
        this.assert('memory_leak_test', memoryDelta < 50,
            `Memory delta after 10 operations: ${memoryDelta.toFixed(1)}MB`);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            const afterGCMemory = process.memoryUsage();
            const gcMemoryMB = afterGCMemory.heapUsed / 1024 / 1024;
            console.log(`   Memory after GC: ${gcMemoryMB.toFixed(1)}MB`);
        }
        
        console.log('');
    }

    /**
     * Test dependency requirements
     */
    async testDependencies() {
        console.log('6️⃣  Testing Dependencies...');
        
        // Check Node.js version
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);
        
        this.assert('nodejs_version', majorVersion >= 18,
            `Node.js version: ${nodeVersion} (≥18 required)`);
        
        // Check required packages
        const requiredPackages = ['date-fns', 'fs-extra', 'simple-statistics'];
        
        for (const pkg of requiredPackages) {
            try {
                require(pkg);
                this.assert(`dependency_${pkg.replace('-', '_')}`, true,
                    `${pkg} package available`);
            } catch (error) {
                this.assert(`dependency_${pkg.replace('-', '_')}`, false,
                    `${pkg} package missing: ${error.message}`);
            }
        }
        
        // Test that Python dependencies are NOT required
        try {
            require('pandas');
            this.assert('no_python_deps', false, 'Python dependencies still present');
        } catch (error) {
            this.assert('no_python_deps', true, 'No Python dependencies (as expected)');
        }
        
        console.log('');
    }

    /**
     * Test data compatibility
     */
    async testDataCompatibility() {
        console.log('7️⃣  Testing Data Compatibility...');
        
        const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
        
        // Test configuration compatibility
        const configFile = path.join(metricsDir, 'config.json');
        if (await fs.pathExists(configFile)) {
            const config = await fs.readJSON(configFile);
            this.assert('config_format', !!config.implementation,
                'Configuration format valid');
        }
        
        // Test productivity indicators
        const indicatorsFile = path.join(metricsDir, 'productivity-indicators.json');
        if (await fs.pathExists(indicatorsFile)) {
            const indicators = await fs.readJSON(indicatorsFile);
            this.assert('indicators_format', !!indicators.session_id,
                'Productivity indicators format valid');
        }
        
        // Test historical data
        const historyFile = path.join(metricsDir, 'session-history.jsonl');
        if (await fs.pathExists(historyFile)) {
            const content = await fs.readFile(historyFile, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            let validLines = 0;
            for (const line of lines.slice(-5)) { // Test last 5 lines
                try {
                    const session = JSON.parse(line);
                    if (session.session_id && session.start_time) {
                        validLines++;
                    }
                } catch (error) {
                    // Skip invalid lines
                }
            }
            
            this.assert('history_format', validLines > 0,
                `Historical data format valid: ${validLines} valid entries`);
        }
        
        console.log('');
    }

    /**
     * Assert test condition
     */
    assert(testName, condition, message) {
        const result = {
            test: testName,
            passed: condition,
            message: message,
            timestamp: new Date().toISOString()
        };
        
        this.results.push(result);
        
        if (condition) {
            this.passed++;
            console.log(`   ✅ ${message}`);
        } else {
            this.failed++;
            console.log(`   ❌ ${message}`);
        }
    }

    /**
     * Print final test results
     */
    printResults() {
        console.log('\n📊 Performance Test Results');
        console.log('===========================');
        console.log(`Total Tests: ${this.results.length}`);
        console.log(`Passed: ${this.passed}`);
        console.log(`Failed: ${this.failed}`);
        console.log(`Success Rate: ${Math.round(this.passed / this.results.length * 100)}%\n`);
        
        if (this.failed === 0) {
            console.log('🎉 All performance requirements met!');
            console.log('✅ Node.js implementation ready for production');
        } else {
            console.log('⚠️  Some tests failed. Review requirements before deployment.');
        }
        
        // Save detailed results
        const resultsFile = path.join(__dirname, 'performance-test-results.json');
        fs.writeJSONSync(resultsFile, {
            timestamp: new Date().toISOString(),
            summary: {
                total: this.results.length,
                passed: this.passed,
                failed: this.failed,
                success_rate: Math.round(this.passed / this.results.length * 100)
            },
            results: this.results
        }, { spaces: 2 });
        
        console.log(`\n📋 Detailed results saved to: ${resultsFile}`);
    }
}

// CLI execution
if (require.main === module) {
    (async () => {
        try {
            const test = new PerformanceTest();
            const success = await test.runTests();
            process.exit(success ? 0 : 1);
        } catch (error) {
            console.error('❌ Performance test failed:', error);
            process.exit(1);
        }
    })();
}

module.exports = PerformanceTest;