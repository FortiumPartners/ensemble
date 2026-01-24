#!/usr/bin/env node
/**
 * Session End Hook for Manager Dashboard (Node.js Implementation)
 * Finalizes productivity metrics, generates session summary, and updates historical data
 * 
 * Performance Requirements:
 * - Execution time: ≤50ms (Target: ≤30ms)
 * - Memory usage: ≤32MB (Target: ≤20MB)
 * - Zero Python dependencies (eliminated cchooks)
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { formatISO, parseISO, differenceInHours, differenceInSeconds } = require('date-fns');

/**
 * Calculate comprehensive session productivity summary.
 * Direct port of Python calculation logic with exact same algorithm.
 * @param {Object} sessionData - Session initialization data
 * @param {Object} finalIndicators - Final productivity indicators
 * @returns {Promise<Object>} Session summary object
 */
async function calculateSessionSummary(sessionData, finalIndicators) {
    try {
        const startTime = parseISO(sessionData.start_time.replace('Z', ''));
        const endTime = new Date();
        const durationSeconds = differenceInSeconds(endTime, startTime);
        
        // Calculate productivity metrics (exact same logic as Python)
        const hoursWorked = durationSeconds / 3600;
        const commandsPerHour = (finalIndicators.commands_executed || 0) / Math.max(hoursWorked, 0.1);
        const linesPerHour = (finalIndicators.lines_changed || 0) / Math.max(hoursWorked, 0.1);
        
        // Load baseline for comparison
        const baseline = await loadBaseline();
        
        // Calculate productivity score (0-10 scale) - exact same algorithm as Python
        const scoreFactors = {
            velocity: Math.min(2.0, commandsPerHour / Math.max(baseline.average_commands_per_hour || 15, 1)),
            code_output: Math.min(2.0, linesPerHour / Math.max(baseline.average_lines_per_hour || 120, 1)),
            success_rate: (finalIndicators.success_rate || 100) / 100,
            focus: Math.min(2.0, hoursWorked), // Max 2 points for 2+ hour sessions
            agent_efficiency: Math.min(2.0, Object.keys(finalIndicators.agents_invoked || {}).length / 3) // Bonus for using agents
        };
        
        let productivityScore = Object.values(scoreFactors).reduce((sum, val) => sum + val, 0) * 2; // Scale to 10
        productivityScore = Math.min(10.0, Math.max(0.0, productivityScore));
        
        // Determine productivity trend (exact same logic as Python)
        let trend;
        if (productivityScore >= 8.0) {
            trend = 'excellent';
        } else if (productivityScore >= 6.0) {
            trend = 'good';
        } else if (productivityScore >= 4.0) {
            trend = 'average';
        } else {
            trend = 'needs_improvement';
        }
        
        const summary = {
            session_id: sessionData.session_id,
            start_time: sessionData.start_time,
            end_time: formatISO(endTime),
            duration_hours: Math.round(hoursWorked * 100) / 100,
            productivity_score: Math.round(productivityScore * 10) / 10,
            trend: trend,
            metrics: {
                commands_executed: finalIndicators.commands_executed || 0,
                files_modified: finalIndicators.files_modified || 0,
                lines_changed: finalIndicators.lines_changed || 0,
                agents_used: Object.keys(finalIndicators.agents_invoked || {}).length,
                tools_used: Object.keys(finalIndicators.tools_used || {}).length,
                success_rate: Math.round((finalIndicators.success_rate || 100) * 10) / 10
            },
            performance: {
                commands_per_hour: Math.round(commandsPerHour * 10) / 10,
                lines_per_hour: Math.round(linesPerHour * 10) / 10,
                vs_baseline_velocity: Math.round((commandsPerHour / (baseline.average_commands_per_hour || 15) - 1) * 100 * 10) / 10,
                vs_baseline_output: Math.round((linesPerHour / (baseline.average_lines_per_hour || 120) - 1) * 100 * 10) / 10
            },
            recommendations: generateRecommendations(scoreFactors, finalIndicators)
        };
        
        return summary;
        
    } catch (error) {
        console.error('Error calculating session summary:', error);
        throw error;
    }
}

/**
 * Generate actionable recommendations based on session performance.
 * Direct port of Python recommendation logic.
 * @param {Object} scoreFactors - Score factors object
 * @param {Object} indicators - Final productivity indicators
 * @returns {Array} Array of recommendation objects
 */
function generateRecommendations(scoreFactors, indicators) {
    const recommendations = [];
    
    if (scoreFactors.velocity < 0.8) {
        recommendations.push({
            priority: 'medium',
            category: 'productivity',
            message: 'Consider using more automated commands to increase velocity',
            action: 'Try /execute-tasks for multi-step workflows'
        });
    }
    
    if (scoreFactors.agent_efficiency < 0.5) {
        recommendations.push({
            priority: 'high',
            category: 'automation',
            message: 'Leverage AI agents more to boost productivity',
            action: 'Use Task tool with specialized agents (frontend-developer, code-reviewer, etc.)'
        });
    }
    
    if ((indicators.success_rate || 100) < 90) {
        recommendations.push({
            priority: 'high',
            category: 'quality',
            message: 'Focus on reducing errors to improve success rate',
            action: 'Use test-runner agent before making changes'
        });
    }
    
    if (scoreFactors.code_output < 0.7) {
        recommendations.push({
            priority: 'medium',
            category: 'efficiency',
            message: 'Consider batching similar tasks for better code output',
            action: 'Group related file modifications together'
        });
    }
    
    // Positive reinforcement for good performance
    if (scoreFactors.velocity > 1.2) {
        recommendations.push({
            priority: 'info',
            category: 'achievement',
            message: 'Excellent velocity! You\'re 20% above baseline',
            action: 'Maintain current workflow patterns'
        });
    }
    
    return recommendations;
}

/**
 * Get current session ID with fallback mechanism.
 * Resolves session ID consistency issue between hooks.
 * @returns {Promise<string>} Session ID or default fallback
 */
async function getCurrentSessionId() {
    // Primary: Environment variable (set by session-start)
    let sessionId = process.env.CLAUDE_SESSION_ID;
    
    if (!sessionId) {
        // Fallback: Read from persistent file
        try {
            const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
            const sessionIdFile = path.join(metricsDir, '.current-session-id');
            if (await fs.pathExists(sessionIdFile)) {
                sessionId = (await fs.readFile(sessionIdFile, 'utf8')).trim();
            }
        } catch (error) {
            console.warn('Could not read session ID file:', error.message);
        }
    }
    
    // Last resort: Use default session
    return sessionId || 'default-session';
}

/**
 * Load session data with enhanced error handling and fallbacks.
 * @param {string} sessionId - Session ID to load
 * @returns {Promise<Object>} Session data object
 */
async function loadSessionData(sessionId) {
    const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
    const sessionFile = path.join(metricsDir, 'sessions', `${sessionId}.json`);
    
    if (!await fs.pathExists(sessionFile)) {
        console.warn(`Session file not found for ID: ${sessionId}`);
        console.log(`Expected: ${sessionFile}`);
        
        // Try to find any recent session file as fallback
        const sessionsDir = path.join(metricsDir, 'sessions');
        if (await fs.pathExists(sessionsDir)) {
            const files = (await fs.readdir(sessionsDir))
                .filter(f => f.endsWith('.json') && !f.endsWith('_summary.json'));
            
            if (files.length > 0) {
                // Sort files by modification time (most recent first)
                const filesWithStats = await Promise.all(
                    files.map(async (file) => {
                        const filePath = path.join(sessionsDir, file);
                        const stat = await fs.stat(filePath);
                        return { file, mtime: stat.mtime };
                    })
                );
                
                filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
                const mostRecentFile = filesWithStats[0].file;
                
                console.log(`Using most recent session file: ${mostRecentFile}`);
                return await fs.readJSON(path.join(sessionsDir, mostRecentFile));
            }
        }
        
        // Create minimal session data if none found
        return {
            session_id: sessionId,
            start_time: formatISO(new Date()),
            user: process.env.USER || 'unknown',
            working_directory: process.cwd(),
            git_branch: 'unknown',
            productivity_metrics: {
                commands_executed: 0,
                files_modified: 0,
                lines_changed: 0
            }
        };
    }
    
    return await fs.readJSON(sessionFile);
}

/**
 * Load current productivity baseline.
 * @returns {Promise<Object>} Baseline configuration
 */
async function loadBaseline() {
    const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
    const baselineFile = path.join(metricsDir, 'current-baseline.json');
    
    const defaultBaseline = {
        average_commands_per_hour: 15,
        average_lines_per_hour: 120,
        average_success_rate: 0.92
    };
    
    try {
        if (await fs.pathExists(baselineFile)) {
            const baseline = await fs.readJSON(baselineFile);
            return { ...defaultBaseline, ...baseline };
        }
    } catch (error) {
        console.error('Warning: Failed to load baseline:', error);
    }
    
    return defaultBaseline;
}

/**
 * Update historical productivity data for trend analysis.
 * Direct port of Python historical data update logic.
 * @param {Object} summary - Session summary object
 * @returns {Promise<void>}
 */
async function updateHistoricalData(summary) {
    try {
        const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
        const historyFile = path.join(metricsDir, 'session-history.jsonl');
        
        // Append session summary to history
        await fs.appendFile(historyFile, JSON.stringify(summary) + '\n');
        
        // Update rolling baseline (last 30 sessions)
        const sessions = [];
        
        if (await fs.pathExists(historyFile)) {
            const content = await fs.readFile(historyFile, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                try {
                    sessions.push(JSON.parse(line));
                } catch (parseError) {
                    // Skip invalid JSON lines
                    continue;
                }
            }
        }
        
        // Keep only recent sessions for baseline calculation
        const recentSessions = sessions.length > 30 ? sessions.slice(-30) : sessions;
        
        if (recentSessions.length > 0) {
            const totalCommands = recentSessions.reduce((sum, s) => sum + (s.metrics?.commands_executed || 0), 0);
            const totalHours = recentSessions.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
            const totalLines = recentSessions.reduce((sum, s) => sum + (s.metrics?.lines_changed || 0), 0);
            const totalSuccess = recentSessions.reduce((sum, s) => sum + (s.metrics?.success_rate || 100), 0);
            
            if (totalHours > 0) {
                const newBaseline = {
                    average_commands_per_hour: totalCommands / totalHours,
                    average_lines_per_hour: totalLines / totalHours,
                    average_success_rate: totalSuccess / recentSessions.length,
                    last_updated: formatISO(new Date()),
                    sessions_count: recentSessions.length
                };
                
                const baselineFile = path.join(metricsDir, 'historical-baseline.json');
                await fs.writeJSON(baselineFile, newBaseline, { spaces: 2 });
            }
        }
        
    } catch (error) {
        console.error('Warning: Failed to update historical baseline:', error);
    }
}

/**
 * Clean up temporary session files and flags.
 * @param {string} sessionId - Session ID
 * @returns {Promise<void>}
 */
async function cleanupSessionFiles(sessionId) {
    try {
        const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
        
        // Remove dashboard active flag
        const dashboardFlag = path.join(metricsDir, '.dashboard-active');
        if (await fs.pathExists(dashboardFlag)) {
            await fs.remove(dashboardFlag);
        }
        
        // Archive real-time activity log
        const activityLog = path.join(metricsDir, 'realtime', 'activity.log');
        if (await fs.pathExists(activityLog)) {
            const archiveDir = path.join(metricsDir, 'archives');
            await fs.ensureDir(archiveDir);
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
            const archiveFile = path.join(archiveDir, `activity_${sessionId.slice(0, 8)}_${timestamp}.log`);
            await fs.move(activityLog, archiveFile);
        }
        
    } catch (error) {
        console.error('Warning: Failed to cleanup session files:', error);
    }
}

/**
 * Create hook context object (replaces cchooks dependency).
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
            agentsAvailable: [],
            mcpServers: []
        }
    };
}

/**
 * Main hook execution for session end.
 * Performance-optimized Node.js implementation.
 * @returns {Promise<Object>} Hook execution result
 */
async function main() {
    const startTime = process.hrtime.bigint();
    
    try {
        // Create context (replaces cchooks.safe_create_context())
        const context = createHookContext();
        
        const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
        const sessionId = await getCurrentSessionId();
        
        console.log(`🔍 Resolving session ID: ${sessionId}`);
        
        // Load session data with fallback handling
        const sessionData = await loadSessionData(sessionId);
        
        // Load final productivity indicators
        const indicatorsFile = path.join(metricsDir, 'productivity-indicators.json');
        let finalIndicators = {};
        
        if (await fs.pathExists(indicatorsFile)) {
            finalIndicators = await fs.readJSON(indicatorsFile);
        }
        
        // Calculate comprehensive session summary
        const summary = await calculateSessionSummary(sessionData, finalIndicators);
        
        // Update session JSONL with end event
        const sessionLog = path.join(metricsDir, 'sessions', `${sessionId}.jsonl`);
        const sessionEndEvent = {
            event: 'session_end',
            timestamp: summary.end_time,
            session_id: sessionId,
            duration_hours: summary.duration_hours,
            productivity_score: summary.productivity_score,
            final_metrics: summary.metrics
        };
        await fs.appendFile(sessionLog, JSON.stringify(sessionEndEvent) + '\n');
        
        // Save final session summary
        const summaryFile = path.join(metricsDir, 'sessions', `${sessionId}_summary.json`);
        await fs.writeJSON(summaryFile, summary, { spaces: 2 });
        
        // Update historical data
        await updateHistoricalData(summary);
        
        // Clean up temporary files
        await cleanupSessionFiles(sessionId);
        
        // Remove session ID file
        try {
            const sessionIdFile = path.join(metricsDir, '.current-session-id');
            if (await fs.pathExists(sessionIdFile)) {
                await fs.remove(sessionIdFile);
            }
        } catch (error) {
            console.warn('Warning: Failed to remove session ID file:', error);
        }
        
        // Display session summary (matching Python output format)
        console.log(`\n🎯 Productivity Session Summary`);
        console.log(`📊 Score: ${summary.productivity_score}/10 (${summary.trend})`);
        console.log(`⏱️  Duration: ${summary.duration_hours} hours`);
        console.log(`⚡ Commands: ${summary.metrics.commands_executed} (${summary.performance.commands_per_hour}/hr)`);
        console.log(`📝 Lines: ${summary.metrics.lines_changed} (${summary.performance.lines_per_hour}/hr)`);
        console.log(`🤖 Agents: ${summary.metrics.agents_used} used`);
        console.log(`✅ Success: ${summary.metrics.success_rate}%`);
        
        if (summary.recommendations && summary.recommendations.length > 0) {
            console.log(`\n💡 Recommendations:`);
            for (const rec of summary.recommendations.slice(0, 3)) { // Show top 3
                console.log(`   ${rec.message}`);
            }
        }
        
        // Calculate execution time and memory usage
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        const memoryUsage = process.memoryUsage().heapUsed;
        const memoryUsageMB = memoryUsage / 1024 / 1024;
        
        // Performance monitoring
        if (executionTime > 30) {
            console.warn(`[Performance] Session end took ${executionTime.toFixed(2)}ms (target: ≤30ms)`);
        }
        
        if (memoryUsageMB > 20) {
            console.warn(`[Performance] Memory usage: ${memoryUsageMB.toFixed(1)}MB (target: ≤20MB)`);
        }
        
        return {
            success: true,
            executionTime: Math.round(executionTime * 100) / 100,
            memoryUsage: memoryUsage,
            metrics: { 
                sessionId: sessionId,
                productivityScore: summary.productivity_score,
                trend: summary.trend,
                duration: summary.duration_hours
            }
        };
        
    } catch (error) {
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000;
        
        console.error('❌ Session end hook failed:', error);
        
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
                console.log(`✅ Session end completed in ${result.executionTime}ms`);
                process.exit(0);
            } else {
                console.error('❌ Session end failed:', result.errorMessage);
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
    calculateSessionSummary,
    generateRecommendations,
    loadBaseline,
    updateHistoricalData,
    cleanupSessionFiles,
    getCurrentSessionId,
    loadSessionData
};