#!/usr/bin/env node
/**
 * Analytics Engine for Manager Dashboard Metrics (Node.js Implementation)
 * Processes collected metrics data to generate insights and recommendations
 * 
 * Performance Requirements:
 * - Hook execution time: ≤50ms per invocation (Target: ≤30ms)
 * - Memory usage: ≤32MB peak per execution (Target: ≤20MB)
 * - Analytics processing: ≤2 seconds for 30-day analysis
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { formatISO, parseISO, subDays } = require('date-fns');
const ss = require('simple-statistics');

class MetricsAnalyzer {
    /**
     * Advanced analytics engine for productivity metrics.
     * @param {string} [metricsDir] - Custom metrics directory path
     */
    constructor(metricsDir) {
        this.metricsDir = metricsDir || path.join(os.homedir(), '.agent-os', 'metrics');
        // Ensure metrics directory exists
        fs.ensureDirSync(this.metricsDir);
    }

    /**
     * Calculate comprehensive productivity score (0-10 scale).
     * Maintains exact same algorithm as Python version.
     * @param {Object} sessionData - Session data object
     * @returns {number} Productivity score between 0-10
     */
    async calculateProductivityScore(sessionData) {
        const startTime = process.hrtime.bigint();
        
        try {
            const baseline = await this.loadBaseline();
            
            // Get session metrics (exact same logic as Python)
            const durationHours = sessionData.duration_hours || 0.1;
            const commands = (sessionData.metrics?.commands_executed) || 0;
            const lines = (sessionData.metrics?.lines_changed) || 0;
            const successRate = ((sessionData.metrics?.success_rate) || 100) / 100;
            const agentsUsed = (sessionData.metrics?.agents_used) || 0;
            
            // Calculate component scores (matching Python exactly)
            const velocityScore = Math.min(2.5, (commands / durationHours) / (baseline.average_commands_per_hour || 15) * 2.5);
            const outputScore = Math.min(2.5, (lines / durationHours) / (baseline.average_lines_per_hour || 120) * 2.5);
            const qualityScore = successRate * 2.0;
            const efficiencyScore = Math.min(1.5, agentsUsed / 3 * 1.5);  // Bonus for using AI agents
            const focusScore = Math.min(1.5, durationHours / 2 * 1.5);  // Bonus for sustained focus
            
            const totalScore = velocityScore + outputScore + qualityScore + efficiencyScore + focusScore;
            const finalScore = Math.min(10.0, Math.max(0.0, totalScore));
            
            // Performance monitoring
            const endTime = process.hrtime.bigint();
            const executionTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
            
            if (executionTime > 30) {
                console.warn(`[Performance] calculateProductivityScore took ${executionTime.toFixed(2)}ms (target: ≤30ms)`);
            }
            
            return finalScore;
            
        } catch (error) {
            console.error('Error calculating productivity score:', error);
            return 0.0;
        }
    }

    /**
     * Detect productivity anomalies requiring attention.
     * Port of Python anomaly detection logic.
     * @param {Object} currentMetrics - Current session metrics
     * @returns {Promise<Array>} Array of anomaly objects
     */
    async detectAnomalies(currentMetrics) {
        const startTime = process.hrtime.bigint();
        
        try {
            const anomalies = [];
            const baseline = await this.loadBaseline();
            const history = await this.loadRecentSessions(30);
            
            if (history.length === 0) {
                return anomalies;
            }
            
            // Calculate historical averages using simple-statistics
            const historicalCommandsPerHour = history.map(s => {
                const commands = s.metrics?.commands_executed || 0;
                const duration = Math.max(s.duration_hours || 0.1, 0.1);
                return commands / duration;
            }).filter(x => x > 0);
            
            const historicalSuccessRates = history.map(s => 
                s.metrics?.success_rate || 100
            );
            
            const avgCommandsPerHour = historicalCommandsPerHour.length > 0 ? 
                ss.mean(historicalCommandsPerHour) : 15;
            const avgSuccessRate = historicalSuccessRates.length > 0 ? 
                ss.mean(historicalSuccessRates) : 95;
            
            // Current session metrics
            const currentCommandsPerHour = (currentMetrics.commands_executed || 0) / 
                Math.max(currentMetrics.duration_hours || 0.1, 0.1);
            const currentSuccessRate = currentMetrics.success_rate || 100;
            
            // Velocity anomaly detection (exact same logic as Python)
            if (currentCommandsPerHour < avgCommandsPerHour * 0.5) {
                anomalies.push({
                    type: 'low_velocity',
                    severity: 'warning',
                    message: `Command velocity ${currentCommandsPerHour.toFixed(1)}/hr is ${Math.round((1 - currentCommandsPerHour/avgCommandsPerHour)*100)}% below average`,
                    recommendation: 'Consider using /execute-tasks or agent delegation to improve efficiency'
                });
            } else if (currentCommandsPerHour > avgCommandsPerHour * 1.5) {
                anomalies.push({
                    type: 'high_velocity',
                    severity: 'info',
                    message: `Excellent velocity! ${currentCommandsPerHour.toFixed(1)}/hr is ${Math.round((currentCommandsPerHour/avgCommandsPerHour-1)*100)}% above average`,
                    recommendation: 'Great work! Maintain current workflow patterns'
                });
            }
            
            // Success rate anomaly detection
            if (currentSuccessRate < avgSuccessRate * 0.8) {
                anomalies.push({
                    type: 'low_success_rate',
                    severity: 'alert',
                    message: `Success rate ${currentSuccessRate.toFixed(1)}% is significantly below average (${avgSuccessRate.toFixed(1)}%)`,
                    recommendation: 'Use test-runner agent and code-reviewer for better quality'
                });
            }
            
            // Agent usage patterns
            const agentsUsed = currentMetrics.agents_used || 0;
            if (agentsUsed === 0 && currentCommandsPerHour > 10) {
                anomalies.push({
                    type: 'no_agent_usage',
                    severity: 'suggestion',
                    message: 'High activity detected but no AI agents used',
                    recommendation: 'Consider using Task tool with specialized agents to boost productivity'
                });
            }
            
            // Performance monitoring
            const endTime = process.hrtime.bigint();
            const executionTime = Number(endTime - startTime) / 1000000;
            
            if (executionTime > 30) {
                console.warn(`[Performance] detectAnomalies took ${executionTime.toFixed(2)}ms (target: ≤30ms)`);
            }
            
            return anomalies;
            
        } catch (error) {
            console.error('Error detecting anomalies:', error);
            return [];
        }
    }

    /**
     * Generate actionable recommendations based on metrics analysis.
     * Direct port of Python recommendation logic.
     * @param {Object} metrics - Current metrics
     * @param {Array} history - Historical session data
     * @returns {Promise<Array>} Array of recommendation objects
     */
    async generateRecommendations(metrics, history) {
        try {
            const recommendations = [];
            
            // Agent usage optimization
            const toolsUsed = metrics.tools_used || {};
            const agentsInvoked = metrics.agents_invoked || {};
            
            if (Object.keys(agentsInvoked).length < 3 && (metrics.commands_executed || 0) > 10) {
                recommendations.push({
                    priority: 'high',
                    category: 'agent_usage',
                    title: 'Increase AI Agent Utilization',
                    description: 'You executed many commands but used few agents. Agents can automate complex workflows.',
                    action: 'Try: Task tool with frontend-developer, code-reviewer, or test-runner agents',
                    impact: '15-30% productivity improvement expected'
                });
            }
            
            // Workflow optimization
            if ((toolsUsed.Read || 0) > (toolsUsed.Edit || 0) * 3) {
                recommendations.push({
                    priority: 'medium',
                    category: 'workflow',
                    title: 'Optimize Read/Edit Ratio',
                    description: 'High read-to-edit ratio suggests research-heavy session.',
                    action: 'Consider using context-fetcher agent to gather information more efficiently',
                    impact: 'Reduce information gathering time by 40%'
                });
            }
            
            // Quality improvement
            const successRate = metrics.success_rate || 100;
            if (successRate < 90) {
                recommendations.push({
                    priority: 'high',
                    category: 'quality',
                    title: 'Improve Success Rate',
                    description: `Current success rate ${successRate.toFixed(1)}% is below optimal.`,
                    action: 'Use test-runner agent after changes and code-reviewer before commits',
                    impact: 'Reduce debugging time by 50%'
                });
            }
            
            // Productivity patterns from history (using simple-statistics for linear regression)
            if (history && history.length >= 5) {
                const recentSessions = history.slice(-5);
                const recentScores = [];
                
                for (const session of recentSessions) {
                    const score = await this.calculateProductivityScore(session);
                    recentScores.push(score);
                }
                
                if (recentScores.length >= 3) {
                    // Simple linear regression using simple-statistics
                    const xValues = recentScores.map((_, index) => index);
                    const trend = ss.linearRegressionLine(ss.linearRegression(xValues.map((x, i) => [x, recentScores[i]])));
                    const slope = trend(1) - trend(0); // Calculate slope
                    
                    if (slope < -0.5) {
                        recommendations.push({
                            priority: 'medium',
                            category: 'trend',
                            title: 'Declining Productivity Trend',
                            description: 'Productivity has been decreasing over recent sessions.',
                            action: 'Review workflow patterns and consider process improvements',
                            impact: 'Arrest decline and return to baseline performance'
                        });
                    }
                }
            }
            
            // Focus and efficiency
            const duration = metrics.duration_hours || 0;
            if (duration < 0.5 && (metrics.commands_executed || 0) < 5) {
                recommendations.push({
                    priority: 'low',
                    category: 'efficiency',
                    title: 'Short Session Detected',
                    description: 'Brief sessions may indicate interruptions or task switching.',
                    action: 'Try to batch related tasks for longer, focused work sessions',
                    impact: 'Improve deep work and reduce context switching overhead'
                });
            }
            
            return recommendations;
            
        } catch (error) {
            console.error('Error generating recommendations:', error);
            return [];
        }
    }

    /**
     * Calculate team-wide productivity metrics.
     * Port of Python team metrics calculation.
     * @returns {Promise<Object>} Team metrics object
     */
    async calculateTeamMetrics() {
        const startTime = process.hrtime.bigint();
        
        try {
            const history = await this.loadRecentSessions(90); // Last 90 days
            
            if (history.length === 0) {
                return { error: 'No historical data available' };
            }
            
            // Team productivity metrics
            const totalSessions = history.length;
            const productivityScores = [];
            
            for (const session of history) {
                const score = await this.calculateProductivityScore(session);
                productivityScores.push(score);
            }
            
            const avgProductivityScore = ss.mean(productivityScores);
            
            const totalCommands = history.reduce((sum, s) => sum + (s.metrics?.commands_executed || 0), 0);
            const totalHours = history.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
            const totalLines = history.reduce((sum, s) => sum + (s.metrics?.lines_changed || 0), 0);
            
            // Agent usage statistics
            const allAgents = {};
            for (const session of history) {
                const agentsInvoked = session.metrics?.agents_invoked || {};
                for (const [agent, count] of Object.entries(agentsInvoked)) {
                    allAgents[agent] = (allAgents[agent] || 0) + count;
                }
            }
            
            // Calculate trends using simple-statistics
            let trendChange = 0;
            if (history.length >= 7) {
                const recentWeek = history.slice(-7);
                const previousWeek = history.length >= 14 ? history.slice(-14, -7) : [];
                
                const recentScores = [];
                for (const session of recentWeek) {
                    const score = await this.calculateProductivityScore(session);
                    recentScores.push(score);
                }
                
                const recentAvg = ss.mean(recentScores);
                
                if (previousWeek.length > 0) {
                    const previousScores = [];
                    for (const session of previousWeek) {
                        const score = await this.calculateProductivityScore(session);
                        previousScores.push(score);
                    }
                    const previousAvg = ss.mean(previousScores);
                    
                    if (previousAvg > 0) {
                        trendChange = ((recentAvg - previousAvg) / previousAvg) * 100;
                    }
                }
            }
            
            // Performance monitoring
            const endTime = process.hrtime.bigint();
            const executionTime = Number(endTime - startTime) / 1000000;
            
            if (executionTime > 2000) { // 2 seconds target
                console.warn(`[Performance] calculateTeamMetrics took ${executionTime.toFixed(0)}ms (target: ≤2000ms)`);
            }
            
            return {
                team_summary: {
                    total_sessions: totalSessions,
                    avg_productivity_score: Math.round(avgProductivityScore * 10) / 10,
                    total_commands: totalCommands,
                    total_hours: Math.round(totalHours * 10) / 10,
                    total_lines_changed: totalLines,
                    commands_per_hour: Math.round((totalCommands / Math.max(totalHours, 0.1)) * 10) / 10,
                    lines_per_hour: Math.round((totalLines / Math.max(totalHours, 0.1)) * 10) / 10
                },
                trend_analysis: {
                    week_over_week_change: Math.round(trendChange * 10) / 10,
                    direction: trendChange > 2 ? 'improving' : trendChange < -2 ? 'declining' : 'stable'
                },
                agent_leaderboard: Object.entries(allAgents)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10),
                last_updated: formatISO(new Date())
            };
            
        } catch (error) {
            console.error('Error calculating team metrics:', error);
            return { error: error.message };
        }
    }

    /**
     * Load current productivity baseline.
     * @returns {Promise<Object>} Baseline configuration
     */
    async loadBaseline() {
        try {
            const baselineFile = path.join(this.metricsDir, 'historical-baseline.json');
            const defaultBaseline = {
                average_commands_per_hour: 15,
                average_lines_per_hour: 120,
                average_success_rate: 95
            };
            
            if (await fs.pathExists(baselineFile)) {
                const baseline = await fs.readJSON(baselineFile);
                return { ...defaultBaseline, ...baseline };
            }
            
            return defaultBaseline;
        } catch (error) {
            console.error('Error loading baseline:', error);
            return {
                average_commands_per_hour: 15,
                average_lines_per_hour: 120,
                average_success_rate: 95
            };
        }
    }

    /**
     * Load recent session data for analysis.
     * @param {number} days - Number of days to look back
     * @returns {Promise<Array>} Array of session objects
     */
    async loadRecentSessions(days = 30) {
        try {
            const historyFile = path.join(this.metricsDir, 'session-history.jsonl');
            const cutoffDate = subDays(new Date(), days);
            
            if (!await fs.pathExists(historyFile)) {
                return [];
            }
            
            const content = await fs.readFile(historyFile, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            
            const sessions = [];
            for (const line of lines) {
                try {
                    const session = JSON.parse(line);
                    const sessionDate = parseISO(session.start_time?.replace('Z', '') || new Date().toISOString());
                    
                    if (sessionDate > cutoffDate) {
                        sessions.push(session);
                    }
                } catch (parseError) {
                    // Skip invalid JSON lines
                    continue;
                }
            }
            
            return sessions;
        } catch (error) {
            console.error('Error loading recent sessions:', error);
            return [];
        }
    }
}

/**
 * Generate comprehensive dashboard data for manager view.
 * Main entry point function equivalent to Python version.
 * @returns {Promise<Object>} Dashboard data object
 */
async function generateDashboardData() {
    const startTime = process.hrtime.bigint();
    
    try {
        const analyzer = new MetricsAnalyzer();
        
        // Current session indicators
        const indicatorsFile = path.join(analyzer.metricsDir, 'productivity-indicators.json');
        let currentIndicators = {};
        
        if (await fs.pathExists(indicatorsFile)) {
            try {
                currentIndicators = await fs.readJSON(indicatorsFile);
            } catch (error) {
                console.error('Error reading productivity indicators:', error);
            }
        }
        
        // Team metrics
        const teamMetrics = await analyzer.calculateTeamMetrics();
        
        // Recent anomalies
        let anomalies = [];
        if (Object.keys(currentIndicators).length > 0) {
            anomalies = await analyzer.detectAnomalies(currentIndicators);
        }
        
        // Recommendations
        const history = await analyzer.loadRecentSessions(30);
        let recommendations = [];
        if (Object.keys(currentIndicators).length > 0) {
            recommendations = await analyzer.generateRecommendations(currentIndicators, history);
        }
        
        const dashboardData = {
            current_session: currentIndicators,
            team_metrics: teamMetrics,
            anomalies: anomalies,
            recommendations: recommendations,
            dashboard_updated: formatISO(new Date())
        };
        
        // Performance monitoring
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000;
        
        if (executionTime > 2000) {
            console.warn(`[Performance] generateDashboardData took ${executionTime.toFixed(0)}ms (target: ≤2000ms)`);
        }
        
        return dashboardData;
        
    } catch (error) {
        console.error('Error generating dashboard data:', error);
        return {
            error: error.message,
            dashboard_updated: formatISO(new Date())
        };
    }
}

// CLI execution support (when run directly)
if (require.main === module) {
    (async () => {
        try {
            console.log('📊 Generating dashboard data...');
            
            const dashboardData = await generateDashboardData();
            
            // Save to dashboard data file
            const metricsDir = path.join(os.homedir(), '.agent-os', 'metrics');
            await fs.ensureDir(metricsDir);
            
            const dashboardFile = path.join(metricsDir, 'dashboard-data.json');
            await fs.writeJSON(dashboardFile, dashboardData, { spaces: 2 });
            
            console.log('📊 Dashboard data generated successfully');
            console.log(`💾 Saved to: ${dashboardFile}`);
            
            // Memory usage monitoring
            const memUsage = process.memoryUsage();
            const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            
            if (heapUsedMB > 20) {
                console.warn(`[Performance] Memory usage: ${heapUsedMB}MB (target: ≤20MB)`);
            } else {
                console.log(`✅ Memory usage: ${heapUsedMB}MB (within target)`);
            }
            
            process.exit(0);
            
        } catch (error) {
            console.error('❌ Failed to generate dashboard data:', error);
            process.exit(1);
        }
    })();
}

module.exports = {
    MetricsAnalyzer,
    generateDashboardData
};