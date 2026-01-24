#!/usr/bin/env node
/**
 * Session ID Consistency Test Utility
 * Verifies that session IDs are properly persisted and shared across hooks
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

async function testSessionConsistency() {
    console.log('🧪 Testing Session ID Consistency...\n');
    
    try {
        // Step 1: Start session and get session ID from file
        console.log('1️⃣ Starting new session...');
        const sessionStartResult = execSync('node session-start.js', { encoding: 'utf8' });
        
        // Read session ID from persistent file (more reliable than parsing console output)
        const sessionIdFile = path.join(os.homedir(), '.agent-os', 'metrics', '.current-session-id');
        const expectedSessionId = (await fs.readFile(sessionIdFile, 'utf8')).trim();
        
        console.log(`   Session ID: ${expectedSessionId}`);
        
        // Step 2: Verify session ID file exists
        console.log('2️⃣ Verifying session ID persistence...');
        
        if (!await fs.pathExists(sessionIdFile)) {
            throw new Error('Session ID file was not created');
        }
        
        const persistedSessionId = (await fs.readFile(sessionIdFile, 'utf8')).trim();
        console.log(`   Persisted ID: ${persistedSessionId}`);
        
        if (persistedSessionId !== expectedSessionId) {
            throw new Error(`Session ID mismatch: expected ${expectedSessionId}, got ${persistedSessionId}`);
        }
        
        // Step 3: Test tool-metrics session ID resolution
        console.log('3️⃣ Testing tool-metrics session ID resolution...');
        // Clear environment to test fallback
        const env = { ...process.env };
        delete env.CLAUDE_SESSION_ID;
        
        const toolMetricsResult = execSync('node tool-metrics.js Read \'{"file_path": "/tmp/test.txt"}\' true', { 
            encoding: 'utf8',
            env: env
        });
        
        console.log(`   Tool-metrics completed successfully`);
        
        // Step 4: Test session-end session ID resolution and cleanup
        console.log('4️⃣ Testing session-end session ID resolution...');
        const sessionEndResult = execSync('node session-end.js', { 
            encoding: 'utf8',
            env: env
        });
        
        const resolvedIdMatch = sessionEndResult.match(/Resolving session ID: ([a-f0-9-]+)/);
        const resolvedSessionId = resolvedIdMatch ? resolvedIdMatch[1] : null;
        
        console.log(`   Resolved ID: ${resolvedSessionId}`);
        
        if (resolvedSessionId !== expectedSessionId) {
            throw new Error(`Session ID resolution failed: expected ${expectedSessionId}, got ${resolvedSessionId}`);
        }
        
        // Step 5: Verify session ID file cleanup
        console.log('5️⃣ Verifying session ID file cleanup...');
        if (await fs.pathExists(sessionIdFile)) {
            throw new Error('Session ID file was not cleaned up');
        }
        
        console.log('   Session ID file successfully removed');
        
        console.log('\n✅ All tests passed! Session ID consistency is working correctly.');
        
        return {
            success: true,
            sessionId: expectedSessionId,
            tests: {
                sessionStart: true,
                persistence: true,
                toolMetrics: true,
                sessionEnd: true,
                cleanup: true
            }
        };
        
    } catch (error) {
        console.log(`\n❌ Test failed: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

// CLI execution
if (require.main === module) {
    testSessionConsistency()
        .then(result => {
            if (result.success) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

module.exports = { testSessionConsistency };