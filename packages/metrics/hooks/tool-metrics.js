#!/usr/bin/env node
/**
 * Tool Metrics Collection Hook for Manager Dashboard (Node.js Implementation)
 * Captures tool usage patterns, performance, and productivity metrics
 * 
 * Performance Requirements:
 * - Execution time: ≤50ms (Target: ≤30ms)
 * - Memory usage: ≤32MB (Target: ≤20MB)
 * - Zero Python dependencies (eliminated cchooks)
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { formatISO } = require('date-fns');
const { MetricsApiClient, sendToBackendWithFallback } = require('./metrics-api-client');
const { UserProfileManager } = require('./user-profile');

/**
 * Log metrics data to JSONL format for analytics processing and send to backend API.
 * Maintains backward compatibility with local storage while adding API integration.
 * @param {Object} data - Metrics data to log
 * @returns {Promise<Object>} Result with success status and method used
 */
async function logMetrics(data) {
    // Local storage fallback function
    const localFallback = async (metricsData) => {
        const metricsDir = path.join(os.homedir(), '.ensemble', 'metrics');
        await fs.ensureDir(metricsDir);
        
        // Main metrics log
        const metricsLog = path.join(metricsDir, 'tool-metrics.jsonl');
        await fs.appendFile(metricsLog, JSON.stringify(metricsData) + '\n');
        
        // Real-time activity log for dashboard
        const realtimeDir = path.join(metricsDir, 'realtime');
        await fs.ensureDir(realtimeDir);
        
        const activityFile = path.join(realtimeDir, 'activity.log');
        const timestamp = metricsData.timestamp || formatISO(new Date());
        const toolName = metricsData.tool_name || 'unknown';
        const status = metricsData.status || 'unknown';
        
        await fs.appendFile(activityFile, `${timestamp}|tool_complete|${toolName}|${status}\n`);
    };

    try {
        // Initialize API client
        const apiClient = new MetricsApiClient();
        
        // Send to backend with local fallback
        const result = await sendToBackendWithFallback(
            apiClient,
            apiClient.submitToolMetrics,
            data,
            localFallback
        );
        
        return result;
        
    } catch (error) {
        console.error('Warning: Failed to log metrics:', error);
        // Ensure local fallback is executed even if API client fails
        try {
            await localFallback(data);
            return {
                success: true,
                method: 'local_fallback',
                message: 'API client failed, data stored locally',
                error: error.message
            };
        } catch (fallbackError) {
            return {
                success: false,
                method: 'local_fallback',
                message: 'Both API and local storage failed',
                error: fallbackError.message
            };
        }
    }
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
            const metricsDir = path.join(os.homedir(), '.ensemble', 'metrics');
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
 * Create hook context object (replaces cchooks PostToolUseContext).
 * Native Node.js context creation with tool execution details.
 * @param {Object} toolData - Tool execution data
 * @returns {Object} Hook context
 */
function createPostToolUseContext(toolData) {
    return {
        tool_name: toolData.toolName || 'unknown',
        tool_input: toolData.toolInput || {},
        error: toolData.error || null,
        timestamp: formatISO(new Date()),
        environment: {
            nodeVersion: process.version,
            platform: process.platform,
            architecture: process.arch
        }
    };
}

/**
 * Update real-time productivity indicators for dashboard.
 * Direct port of Python indicator update logic.
 * @param {Object} metrics - Metrics data
 * @returns {Promise<void>}
 */
async function updateProductivityIndicators(metrics) {
    try {
        const metricsDir = path.join(os.homedir(), '.ensemble', 'metrics');
        const indicatorsFile = path.join(metricsDir, 'productivity-indicators.json');
        
        // Load existing indicators or initialize
        let indicators;
        if (await fs.pathExists(indicatorsFile)) {
            indicators = await fs.readJSON(indicatorsFile);
        } else {
            indicators = {
                session_start: formatISO(new Date()),
                commands_executed: 0,
                tools_used: {},
                files_modified: 0,
                lines_changed: 0,
                agents_invoked: {},
                success_rate: 100.0,
                last_activity: null
            };
        }
        
        // Update indicators based on current metrics
        indicators.commands_executed += 1;
        indicators.last_activity = metrics.timestamp;
        
        const toolName = metrics.tool_name;
        if (!indicators.tools_used) indicators.tools_used = {};
        indicators.tools_used[toolName] = (indicators.tools_used[toolName] || 0) + 1;
        
        if (['Edit', 'Write'].includes(toolName) && 'file_path' in metrics) {
            indicators.files_modified += 1;
        }
        
        if ('net_lines' in metrics) {
            indicators.lines_changed += Math.abs(metrics.net_lines);
        } else if ('lines_written' in metrics) {
            indicators.lines_changed += metrics.lines_written;
        }
        
        if (metrics.subagent_type) {
            const agent = metrics.subagent_type;
            if (!indicators.agents_invoked) indicators.agents_invoked = {};
            indicators.agents_invoked[agent] = (indicators.agents_invoked[agent] || 0) + 1;
        }
        
        // Calculate success rate
        const totalCommands = indicators.commands_executed;
        if (totalCommands > 0) {
            if (!metrics.success) {
                // Adjust success rate down slightly
                indicators.success_rate = Math.max(0, indicators.success_rate - (1.0 / totalCommands));
            }
            // If successful, maintain current success rate
        }
        
        // Save updated indicators
        await fs.writeJSON(indicatorsFile, indicators, { spaces: 2 });
        
        // Signal dashboard update if active
        const dashboardSignal = path.join(metricsDir, '.dashboard-active');
        if (await fs.pathExists(dashboardSignal)) {
            const realtimeLog = path.join(metricsDir, 'realtime.log');
            const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
            const logMessage = `📊 [${timeStr}] ${toolName} completed - Productivity: ${indicators.commands_executed} commands, ${indicators.files_modified} files\n`;
            await fs.appendFile(realtimeLog, logMessage);
        }
        
    } catch (error) {
        console.error('Warning: Failed to update productivity indicators:', error);
    }
}

/**
 * Extract tool-specific metrics based on tool type.
 * Direct port of Python tool-specific metric collection.
 * @param {Object} context - Hook context
 * @returns {Object} Tool-specific metrics
 */
/**
 * Creates enhanced activity item matching the ActivityItem interface for real-time feed display
 * @param {Object} context - Tool execution context
 * @param {Object} toolData - Tool execution data
 * @param {Object} userProfile - User profile with authentication
 * @param {string} sessionId - Current session ID
 * @param {string} timestamp - ISO formatted timestamp
 * @returns {Object} Enhanced activity item
 */
function createEnhancedActivityItem(context, toolData, userProfile, sessionId, timestamp) {
    const toolName = context.tool_name;
    const toolInput = context.tool_input || {};
    const hasError = !!context.error;
    const executionTime = Math.round(toolData.executionTime || 0);

    // Map tool names to action types and descriptions
    const actionMapping = {
        'Read': {
            type: 'file_operation',
            description: `read file ${toolInput.file_path || 'unknown'}`,
            category: 'File I/O'
        },
        'Edit': {
            type: 'file_operation',
            description: `edited file ${toolInput.file_path || 'unknown'}`,
            category: 'File Modification'
        },
        'Write': {
            type: 'file_operation',
            description: `wrote file ${toolInput.file_path || 'unknown'}`,
            category: 'File Creation'
        },
        'MultiEdit': {
            type: 'file_operation',
            description: `multi-edited file ${toolInput.file_path || 'unknown'}`,
            category: 'File Modification'
        },
        'Bash': {
            type: 'command_execution',
            description: `executed command: ${(toolInput.command || '').split(' ')[0] || 'unknown'}`,
            category: 'Command Line'
        },
        'Task': {
            type: 'agent_interaction',
            description: `delegated to ${toolInput.subagent_type || 'unknown'} agent`,
            category: 'AI Agent'
        },
        'Glob': {
            type: 'file_operation',
            description: `searched files with pattern ${toolInput.pattern || 'unknown'}`,
            category: 'File Search'
        },
        'Grep': {
            type: 'file_operation',
            description: `searched content for "${toolInput.pattern || 'unknown'}"`,
            category: 'Content Search'
        }
    };

    const action = actionMapping[toolName] || {
        type: 'tool_usage',
        description: `used ${toolName} tool`,
        category: 'General'
    };

    // Extract target information based on tool type
    let target = { name: toolName, type: 'command' };
    let artifacts = [];
    let tags = [];

    switch (toolName) {
        case 'Read':
        case 'Edit':
        case 'Write':
        case 'MultiEdit':
            target = {
                name: path.basename(toolInput.file_path || 'unknown'),
                type: 'file',
                path: toolInput.file_path,
                metadata: {
                    file_extension: path.extname(toolInput.file_path || ''),
                    file_size_bytes: getFileSizeSync(toolInput.file_path)
                }
            };
            tags.push('file-operation', path.extname(toolInput.file_path || '').replace('.', '') || 'no-ext');
            break;

        case 'Bash':
            const command = toolInput.command || '';
            const commandName = command.split(' ')[0] || 'unknown';
            target = {
                name: commandName,
                type: 'command',
                metadata: {
                    full_command: command,
                    background: toolInput.run_in_background || false,
                    timeout: toolInput.timeout
                }
            };
            tags.push('command', commandName);
            if (toolInput.run_in_background) tags.push('background');
            break;

        case 'Task':
            target = {
                name: toolInput.subagent_type || 'unknown',
                type: 'agent',
                metadata: {
                    task_description: toolInput.description || '',
                    prompt_length: (toolInput.prompt || '').length
                }
            };
            tags.push('agent-delegation', toolInput.subagent_type || 'unknown');
            break;

        case 'Glob':
        case 'Grep':
            target = {
                name: toolInput.pattern || 'unknown',
                type: 'project',
                metadata: {
                    search_pattern: toolInput.pattern,
                    search_path: toolInput.path || process.cwd()
                }
            };
            tags.push('search', toolName.toLowerCase());
            break;
    }

    // Extract git context if available
    let gitContext = {};
    try {
        const gitBranch = process.env.GIT_BRANCH || getCurrentGitBranch();
        const gitCommit = process.env.GIT_COMMIT || getCurrentGitCommit();
        if (gitBranch) gitContext.git_branch = gitBranch;
        if (gitCommit) gitContext.git_commit = gitCommit.substring(0, 8);
    } catch (error) {
        // Git context not available
    }

    // Create error details if there's an error
    let errorDetails = null;
    if (hasError) {
        errorDetails = {
            message: String(context.error),
            code: context.error_code || 'unknown',
            recovery_suggestions: generateRecoverySuggestions(toolName, context.error)
        };
    }

    // Determine priority based on tool type, execution time, and success
    let priority = 'low';
    if (hasError) priority = 'high';
    else if (executionTime > 5000) priority = 'medium'; // > 5 seconds
    else if (toolName === 'Task') priority = 'medium'; // Agent delegations are important

    // Performance metrics
    const metrics = {
        execution_time_ms: executionTime,
        memory_usage: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100, // MB
        error_count: hasError ? 1 : 0,
        warning_count: 0 // Could be enhanced based on tool output analysis
    };

    // Add file-specific metrics
    if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(toolName)) {
        const fileMetrics = extractFileMetrics(toolInput, toolName);
        Object.assign(metrics, fileMetrics);
    }

    return {
        id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user: {
            id: userProfile.userId,
            name: userProfile.name,
            email: userProfile.email,
            avatar_url: userProfile.avatar_url
        },
        action: {
            type: action.type,
            name: toolName,
            description: action.description,
            category: action.category
        },
        target,
        status: hasError ? 'error' : 'success',
        timestamp,
        duration_ms: executionTime,
        execution_context: {
            project_id: process.env.PROJECT_ID || path.basename(process.cwd()),
            session_id: sessionId,
            environment: process.env.NODE_ENV || 'development',
            ...gitContext
        },
        metrics,
        error_details: errorDetails,
        artifacts,
        tags,
        priority,
        is_automated: true // All Claude tool executions are automated
    };
}

/**
 * Helper function to safely get file size
 */
function getFileSizeSync(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return 0;
        return fs.statSync(filePath).size;
    } catch (error) {
        return 0;
    }
}

/**
 * Helper function to get current git branch
 */
function getCurrentGitBranch() {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
        return null;
    }
}

/**
 * Helper function to get current git commit
 */
function getCurrentGitCommit() {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
        return null;
    }
}

/**
 * Generate recovery suggestions based on tool and error
 */
function generateRecoverySuggestions(toolName, error) {
    const errorStr = String(error).toLowerCase();
    const suggestions = [];

    if (errorStr.includes('no such file') || errorStr.includes('enoent')) {
        suggestions.push('Check if the file path is correct');
        suggestions.push('Verify the file exists');
        if (toolName === 'Read') suggestions.push('Try using Glob to find the correct file path');
    } else if (errorStr.includes('permission denied') || errorStr.includes('eacces')) {
        suggestions.push('Check file permissions');
        suggestions.push('Try running with appropriate permissions');
    } else if (errorStr.includes('timeout')) {
        suggestions.push('Increase timeout value');
        suggestions.push('Check if the operation is resource-intensive');
    } else if (toolName === 'Bash' && errorStr.includes('command not found')) {
        suggestions.push('Verify the command is installed');
        suggestions.push('Check PATH environment variable');
    }

    return suggestions.length > 0 ? suggestions : ['Check the error message for details'];
}

/**
 * Extract file-specific metrics for file operations
 */
function extractFileMetrics(toolInput, toolName) {
    const metrics = {};

    switch (toolName) {
        case 'Edit':
            const oldString = toolInput.old_string || '';
            const newString = toolInput.new_string || '';
            metrics.lines_removed = oldString.split('\n').length;
            metrics.lines_added = newString.split('\n').length;
            metrics.chars_removed = oldString.length;
            metrics.chars_added = newString.length;
            break;

        case 'Write':
            const content = toolInput.content || '';
            metrics.lines_written = content.split('\n').length;
            metrics.chars_written = content.length;
            break;

        case 'Read':
            metrics.lines_requested = toolInput.limit || 'all';
            break;
    }

    return metrics;
}

function extractToolSpecificMetrics(context) {
    const metrics = {};
    const toolName = context.tool_name;
    const toolInput = context.tool_input || {};

    switch (toolName) {
        case 'Read':
            // File read metrics
            const filePath = toolInput.file_path || '';
            try {
                const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
                Object.assign(metrics, {
                    file_path: filePath,
                    file_size_bytes: fileSize,
                    lines_requested: toolInput.limit || 'all'
                });
            } catch (error) {
                // File doesn't exist or access error
                Object.assign(metrics, {
                    file_path: filePath,
                    file_size_bytes: 0,
                    lines_requested: toolInput.limit || 'all'
                });
            }
            break;
            
        case 'Edit':
            // File edit metrics
            const editFilePath = toolInput.file_path || '';
            const oldString = toolInput.old_string || '';
            const newString = toolInput.new_string || '';
            
            const linesRemoved = oldString ? oldString.split('\n').length : 0;
            const linesAdded = newString ? newString.split('\n').length : 0;
            
            Object.assign(metrics, {
                file_path: editFilePath,
                lines_added: linesAdded,
                lines_removed: linesRemoved,
                net_lines: linesAdded - linesRemoved,
                replace_all: toolInput.replace_all || false
            });
            break;
            
        case 'Write':
            // File write metrics
            const writeFilePath = toolInput.file_path || '';
            const content = toolInput.content || '';
            
            Object.assign(metrics, {
                file_path: writeFilePath,
                content_length: content.length,
                lines_written: content ? content.split('\n').length : 0,
                file_type: writeFilePath ? path.extname(writeFilePath) : 'unknown'
            });
            break;
            
        case 'Bash':
            // Command execution metrics
            const command = toolInput.command || '';
            Object.assign(metrics, {
                command: command,
                command_type: command ? command.split(' ')[0] : 'unknown',
                background: toolInput.run_in_background || false,
                timeout: toolInput.timeout || null
            });
            break;
            
        case 'Task':
            // Sub-agent invocation metrics
            const subagentType = toolInput.subagent_type || 'unknown';
            const description = toolInput.description || '';
            
            Object.assign(metrics, {
                subagent_type: subagentType,
                task_description: description,
                delegation: true
            });
            break;
            
        default:
            // Generic tool metrics
            Object.assign(metrics, {
                generic_tool: true,
                input_keys: Object.keys(toolInput)
            });
            break;
    }
    
    return metrics;
}

/**
 * Main hook execution for tool metrics collection.
 * Performance-optimized Node.js implementation.
 * @param {Object} toolData - Tool execution data (replaces cchooks context)
 * @returns {Promise<Object>} Hook execution result
 */
async function main(toolData = {}) {
    const startTime = process.hrtime.bigint();
    
    try {
        // Create context (replaces cchooks.safe_create_context())
        const context = createPostToolUseContext(toolData);
        
        // Get user profile for proper identification
        const userManager = new UserProfileManager();
        const userProfile = await userManager.getUserProfile();

        // Capture tool execution metrics
        const timestamp = formatISO(new Date());
        const sessionId = await getCurrentSessionId();

        // Enhanced activity data matching ActivityItem interface
        const activityData = createEnhancedActivityItem(context, toolData, userProfile, sessionId, timestamp);

        // Basic tool metrics with proper user identification (legacy format for backward compatibility)
        const metricsData = {
            event_type: 'tool_execution',
            timestamp: timestamp,
            tool_name: context.tool_name,
            success: !context.error,
            execution_time_ms: Math.round(toolData.executionTime || 0),
            user: userProfile.email,
            user_id: userProfile.userId,
            user_name: userProfile.name,
            organization_id: userProfile.organizationId,
            session_id: sessionId,
            auth_token: userProfile.token,
            // Enhanced activity data
            enhanced_activity: activityData
        };
        
        // Extract tool-specific metrics
        const toolSpecificMetrics = extractToolSpecificMetrics(context);
        Object.assign(metricsData, toolSpecificMetrics);
        
        // Handle Task tool agent performance tracking
        if (context.tool_name === 'Task') {
            const agentMetrics = {
                event_type: 'agent_invocation',
                timestamp: timestamp,
                agent_name: toolSpecificMetrics.subagent_type,
                task_description: toolSpecificMetrics.task_description,
                success: !context.error,
                execution_time_ms: metricsData.execution_time_ms
            };
            await logMetrics(agentMetrics);
        }
        
        // Add error details if present
        if (context.error) {
            metricsData.error = true;
            metricsData.error_message = String(context.error);
        }
        
        // Log the metrics (both to backend API and local storage)
        const logResult = await logMetrics(metricsData);
        
        // Update productivity indicators
        await updateProductivityIndicators(metricsData);
        
        // Calculate execution time and memory usage
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        const memoryUsage = process.memoryUsage().heapUsed;
        const memoryUsageMB = memoryUsage / 1024 / 1024;
        
        // Performance monitoring
        if (executionTime > 30) {
            console.warn(`[Performance] Tool metrics took ${executionTime.toFixed(2)}ms (target: ≤30ms)`);
        }
        
        if (memoryUsageMB > 20) {
            console.warn(`[Performance] Memory usage: ${memoryUsageMB.toFixed(1)}MB (target: ≤20MB)`);
        }
        
        return {
            success: true,
            executionTime: Math.round(executionTime * 100) / 100,
            memoryUsage: memoryUsage,
            metrics: { 
                toolName: context.tool_name,
                successful: !context.error,
                metricsLogged: logResult.success,
                apiMethod: logResult.method,
                apiMessage: logResult.message
            }
        };
        
    } catch (error) {
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000;
        
        console.error('❌ Tool metrics hook failed:', error);
        
        return {
            success: false,
            executionTime: Math.round(executionTime * 100) / 100,
            errorMessage: error.message
        };
    }
}

/**
 * Simulate tool execution for testing (when run directly).
 * @param {Array} args - Command line arguments
 * @returns {Promise<void>}
 */
async function simulateToolExecution(args) {
    if (args.length < 3) {
        console.log('Usage: node tool-metrics.js <tool_name> [tool_input_json] [success]');
        console.log('Examples:');
        console.log('  node tool-metrics.js Read \'{"file_path": "/tmp/test.txt"}\' true');
        console.log('  node tool-metrics.js Edit \'{"file_path": "/tmp/test.txt", "old_string": "old", "new_string": "new"}\' true');
        console.log('  node tool-metrics.js Task \'{"subagent_type": "frontend-developer", "description": "Create component"}\' true');
        return;
    }
    
    const toolName = args[2];
    const toolInput = args[3] ? JSON.parse(args[3]) : {};
    const success = args[4] !== 'false';
    
    const toolData = {
        toolName: toolName,
        toolInput: toolInput,
        error: success ? null : new Error('Simulated tool failure'),
        executionTime: Math.random() * 100 + 10 // Random execution time between 10-110ms
    };
    
    console.log(`🔧 Simulating ${toolName} tool execution...`);
    console.log(`📝 Input: ${JSON.stringify(toolInput, null, 2)}`);
    console.log(`✅ Success: ${success}`);
    
    const result = await main(toolData);
    
    if (result.success) {
        console.log(`✅ Tool metrics logged successfully in ${result.executionTime}ms`);
    } else {
        console.error(`❌ Tool metrics failed: ${result.errorMessage}`);
    }
}

// CLI execution support
if (require.main === module) {
    simulateToolExecution(process.argv)
        .then(() => process.exit(0))
        .catch(error => {
            console.error('❌ Hook execution failed:', error);
            process.exit(1);
        });
}

module.exports = {
    main,
    logMetrics,
    updateProductivityIndicators,
    extractToolSpecificMetrics,
    createPostToolUseContext,
    getCurrentSessionId
};