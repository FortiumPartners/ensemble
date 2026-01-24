#!/usr/bin/env node
/**
 * Session Start Hook for Manager Dashboard (Node.js Implementation)
 * Initializes productivity tracking session and sets baseline metrics
 * 
 * Performance Requirements:
 * - Execution time: ≤50ms (Target: ≤30ms)
 * - Memory usage: ≤32MB (Target: ≤20MB)
 * - Zero Python dependencies (eliminated cchooks)
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { formatISO } = require('date-fns');

/**
 * Initialize session tracking with baseline metrics.
 * Direct port of Python initialize_session_metrics function.
 * @returns {Object} Session data object
 */
function initializeSessionMetrics() {
    const sessionId = crypto.randomUUID();
    const startTime = formatISO(new Date());
    
    const sessionData = {
        session_id: sessionId,
        start_time: startTime,
        user: process.env.USER || 'unknown',
        working_directory: process.cwd(),
        git_branch: getGitBranch(),
        productivity_metrics: {
            commands_executed: 0,
            tools_invoked: 0,
            files_read: 0,
            files_modified: 0,
            lines_changed: 0,
            agents_used: [],
            focus_blocks: 0,
            interruptions: 0
        },
        quality_metrics: {
            tests_run: 0,
            tests_passed: 0,
            builds_attempted: 0,
            builds_successful: 0,
            reviews_requested: 0
        },
        workflow_metrics: {
            git_commits: 0,
            prs_created: 0,
            context_switches: 0
        }
    };
    
    return sessionData;
}

/**
 * Get current git branch if available.
 * Native Node.js implementation (no cchooks dependency).
 * @returns {string} Git branch name or 'unknown'
 */
function getGitBranch() {
    try {
        const result = execSync('git rev-parse --abbrev-ref HEAD', {
            encoding: 'utf8',
            timeout: 2000,
            stdio: ['pipe', 'pipe', 'ignore']
        });
        return result.trim();
    } catch (error) {
        // Git not available or not in git repo
        return 'unknown';
    }
}

/**
 * Setup integration points for real-time dashboard updates.
 * Direct port of Python dashboard integration setup.
 * @param {string} metricsDir - Metrics directory path
 * @returns {Promise<void>}
 */
async function setupDashboardIntegration(metricsDir) {
    try {
        await fs.ensureDir(metricsDir);
        
        // Create realtime directory structure
        const realtimeDir = path.join(metricsDir, 'realtime');
        await fs.ensureDir(realtimeDir);
        
        // Initialize activity log
        const activityLog = path.join(realtimeDir, 'activity.log');
        const timestamp = formatISO(new Date());
        await fs.appendFile(activityLog, `${timestamp}|session_start|new_session|active\n`);
        
        // Create dashboard active flag
        const dashboardFlag = path.join(metricsDir, '.dashboard-active');
        await fs.writeFile(dashboardFlag, `active_since:${timestamp}\n`);
        
        // Initialize real-time log for notifications
        const realtimeLog = path.join(metricsDir, 'realtime.log');
        const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
        await fs.appendFile(realtimeLog, `🚀 [${timeStr}] Productivity tracking session started\n`);
        
    } catch (error) {
        console.error('Warning: Failed to setup dashboard integration:', error);
    }
}

/**
 * Load historical productivity baseline for comparison.
 * @param {string} metricsDir - Metrics directory path
 * @returns {Promise<Object>} Baseline configuration
 */
async function loadHistoricalBaseline(metricsDir) {
    const baselineFile = path.join(metricsDir, 'historical-baseline.json');
    
    const defaultBaseline = {
        average_commands_per_hour: 15,
        average_lines_per_hour: 120,
        average_success_rate: 0.92,
        average_focus_time_minutes: 45,
        average_context_switches: 3
    };
    
    try {
        if (await fs.pathExists(baselineFile)) {
            const baseline = await fs.readJSON(baselineFile);
            return { ...defaultBaseline, ...baseline };
        }
    } catch (error) {
        console.error('Warning: Failed to load historical baseline:', error);
    }
    
    return defaultBaseline;
}

/**
 * Create hook context object (replaces cchooks dependency).
 * Native Node.js context creation.
 * @returns {Object} Hook context
 */
function createHookContext() {
    return {
        timestamp: formatISO(new Date()),
        environment: {
            nodeVersion: process.version,
            platform: process.platform,
            architecture: process.arch
        },
        claudeConfig: {
            version: '2.0',
            agentsAvailable: [], // Could be populated from config
            mcpServers: [] // Could be populated from config
        }
    };
}

/**
 * Main hook execution for session start.
 * Performance-optimized Node.js implementation.
 * @returns {Promise<Object>} Hook execution result
 */
async function main() {
    const startTime = process.hrtime.bigint();
    
    try {
        // Create context (replaces cchooks.safe_create_context())
        const context = createHookContext();
        
        // Initialize session metrics
        const sessionData = initializeSessionMetrics();
        
        // Set session ID in environment for other hooks
        process.env.CLAUDE_SESSION_ID = sessionData.session_id;
        
        // Setup metrics directory structure
        const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
        
        // Persist session ID to file for cross-process access
        const sessionIdFile = path.join(metricsDir, '.current-session-id');
        await fs.writeFile(sessionIdFile, sessionData.session_id);
        const sessionsDir = path.join(metricsDir, 'sessions');
        await fs.ensureDir(sessionsDir);
        
        // Save session initialization data
        const sessionFile = path.join(sessionsDir, `${sessionData.session_id}.json`);
        await fs.writeJSON(sessionFile, sessionData, { spaces: 2 });
        
        // Create session JSONL for streaming events
        const sessionLog = path.join(sessionsDir, `${sessionData.session_id}.jsonl`);
        const sessionStartEvent = {
            event: 'session_start',
            timestamp: sessionData.start_time,
            session_id: sessionData.session_id,
            user: sessionData.user,
            git_branch: sessionData.git_branch,
            working_directory: sessionData.working_directory
        };
        await fs.writeFile(sessionLog, JSON.stringify(sessionStartEvent) + '\n');
        
        // Setup dashboard integration
        await setupDashboardIntegration(metricsDir);
        
        // Load historical baseline for productivity comparison
        const baseline = await loadHistoricalBaseline(metricsDir);
        const baselineFile = path.join(metricsDir, 'current-baseline.json');
        await fs.writeJSON(baselineFile, baseline, { spaces: 2 });
        
        // Initialize productivity indicators
        const indicators = {
            session_id: sessionData.session_id,
            start_time: sessionData.start_time,
            baseline: baseline,
            current_metrics: sessionData.productivity_metrics,
            last_update: sessionData.start_time,
            productivity_score: 0.0,
            trend: 'starting'
        };
        
        const indicatorsFile = path.join(metricsDir, 'productivity-indicators.json');
        await fs.writeJSON(indicatorsFile, indicators, { spaces: 2 });
        
        // Calculate execution time and memory usage
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        const memoryUsage = process.memoryUsage().heapUsed;
        const memoryUsageMB = memoryUsage / 1024 / 1024;
        
        // Performance monitoring
        if (executionTime > 30) {
            console.warn(`[Performance] Session start took ${executionTime.toFixed(2)}ms (target: ≤30ms)`);
        }
        
        if (memoryUsageMB > 20) {
            console.warn(`[Performance] Memory usage: ${memoryUsageMB.toFixed(1)}MB (target: ≤20MB)`);
        }
        
        // Success message
        console.log(`🎯 Productivity tracking initialized for session: ${sessionData.session_id.slice(0, 8)}...`);
        
        return {
            success: true,
            executionTime: Math.round(executionTime * 100) / 100,
            memoryUsage: memoryUsage,
            metrics: { 
                sessionId: sessionData.session_id,
                gitBranch: sessionData.git_branch,
                user: sessionData.user
            }
        };
        
    } catch (error) {
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000;
        
        console.error('❌ Session start hook failed:', error);
        
        return {
            success: false,
            executionTime: Math.round(executionTime * 100) / 100,
            errorMessage: error.message
        };
    }
}

// CLI execution support
if (require.main === module) {
    main()
        .then(result => {
            if (result.success) {
                console.log(`✅ Session start completed in ${result.executionTime}ms`);
                process.exit(0);
            } else {
                console.error('❌ Session start failed:', result.errorMessage);
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('❌ Hook execution failed:', error);
            process.exit(1);
        });
}

module.exports = {
    main,
    initializeSessionMetrics,
    getGitBranch,
    setupDashboardIntegration,
    loadHistoricalBaseline
};