#!/usr/bin/env node
/**
 * Migration Utility: Python to Node.js Hooks Conversion
 * Helps users migrate from Python analytics hooks to Node.js implementation
 * 
 * Features:
 * - Validates existing data structure
 * - Creates backup of Python files and metrics
 * - Migrates configuration and historical data
 * - Verifies Node.js implementation compatibility
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { formatISO, parseISO } = require('date-fns');

class PythonToNodeMigration {
    constructor(metricsPath, hooksPath) {
        this.metricsPath = metricsPath || path.join(os.homedir(), '.agent-os', 'metrics');
        this.hooksPath = hooksPath || path.join(__dirname);
        this.backupPath = path.join(os.homedir(), '.agent-os', 'metrics-backup-python');
        this.migrationLog = [];
    }

    /**
     * Main migration process
     * @returns {Promise<Object>} Migration result
     */
    async migrate() {
        console.log('🔄 Starting Python to Node.js metrics migration...\n');
        
        const startTime = Date.now();
        
        try {
            // Step 1: Environment validation
            await this.validateEnvironment();
            
            // Step 2: Create backup of existing data
            await this.createBackup();
            
            // Step 3: Validate existing data structure
            await this.validateExistingData();
            
            // Step 4: Migrate configuration files
            await this.migrateConfiguration();
            
            // Step 5: Convert data formats if needed
            await this.convertDataFormats();
            
            // Step 6: Test Node.js implementation
            await this.testNodeImplementation();
            
            // Step 7: Verify migration success
            await this.verifyMigration();
            
            const duration = Date.now() - startTime;
            
            console.log('\n✅ Migration completed successfully!');
            console.log(`⏱️  Total time: ${duration}ms`);
            console.log(`📦 Backup location: ${this.backupPath}`);
            console.log(`📊 Migration log: ${this.migrationLog.length} operations completed\n`);
            
            return {
                success: true,
                duration: duration,
                operationsCompleted: this.migrationLog.length,
                backupPath: this.backupPath
            };
            
        } catch (error) {
            console.error('\n❌ Migration failed:', error.message);
            console.log(`📦 Backup preserved at: ${this.backupPath}`);
            
            return {
                success: false,
                error: error.message,
                backupPath: this.backupPath
            };
        }
    }

    /**
     * Validate environment and requirements
     */
    async validateEnvironment() {
        console.log('🔍 Validating environment...');
        
        // Check Node.js version
        const nodeVersion = process.version;
        const majorVersion = parseInt(nodeVersion.substring(1).split('.')[0]);
        
        if (majorVersion < 18) {
            throw new Error(`Node.js 18+ required. Current version: ${nodeVersion}`);
        }
        
        this.log('environment_check', `Node.js ${nodeVersion} validated`);
        
        // Check if hooks directory exists
        if (!await fs.pathExists(this.hooksPath)) {
            throw new Error(`Hooks directory not found: ${this.hooksPath}`);
        }
        
        // Check if Node.js implementations exist
        const requiredFiles = ['analytics-engine.js', 'session-start.js', 'session-end.js', 'tool-metrics.js'];
        for (const file of requiredFiles) {
            const filePath = path.join(this.hooksPath, file);
            if (!await fs.pathExists(filePath)) {
                throw new Error(`Required Node.js file not found: ${file}`);
            }
        }
        
        this.log('file_check', 'All required Node.js files found');
        console.log('✅ Environment validation passed');
    }

    /**
     * Create backup of existing data
     */
    async createBackup() {
        console.log('📦 Creating backup of existing metrics...');
        
        if (await fs.pathExists(this.metricsPath)) {
            // Create timestamped backup
            const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
            const backupDir = path.join(this.backupPath, timestamp);
            
            await fs.ensureDir(backupDir);
            await fs.copy(this.metricsPath, backupDir);
            
            this.log('backup_created', `Backup created at: ${backupDir}`);
            console.log(`✅ Backup created at: ${backupDir}`);
        } else {
            this.log('no_existing_data', 'No existing metrics directory found');
            console.log('ℹ️  No existing metrics directory found');
        }
    }

    /**
     * Validate existing metrics data
     */
    async validateExistingData() {
        console.log('🔍 Validating existing metrics data...');
        
        // Check for session files
        const sessionsDir = path.join(this.metricsPath, 'sessions');
        let validFiles = 0;
        let totalFiles = 0;
        
        if (await fs.pathExists(sessionsDir)) {
            const sessionDirs = await fs.readdir(sessionsDir);
            
            for (const dir of sessionDirs) {
                const dirPath = path.join(sessionsDir, dir);
                const stat = await fs.stat(dirPath);
                
                if (stat.isDirectory()) {
                    const files = await fs.readdir(dirPath);
                    
                    for (const file of files) {
                        if (file.endsWith('.json')) {
                            totalFiles++;
                            try {
                                const data = await fs.readJSON(path.join(dirPath, file));
                                if (this.isValidSessionData(data)) {
                                    validFiles++;
                                }
                            } catch (error) {
                                console.warn(`⚠️  Invalid JSON in ${file}:`, error.message);
                            }
                        }
                    }
                }
            }
        }
        
        // Check for JSONL history files
        const historyFile = path.join(this.metricsPath, 'session-history.jsonl');
        let historyLines = 0;
        
        if (await fs.pathExists(historyFile)) {
            const content = await fs.readFile(historyFile, 'utf8');
            historyLines = content.split('\n').filter(line => line.trim()).length;
        }
        
        this.log('data_validation', `${validFiles}/${totalFiles} session files, ${historyLines} history records`);
        console.log(`✅ Validated ${validFiles}/${totalFiles} session files, ${historyLines} history records`);
    }

    /**
     * Migrate configuration files
     */
    async migrateConfiguration() {
        console.log('⚙️  Migrating configuration...');
        
        const configFile = path.join(this.metricsPath, 'config.json');
        
        if (await fs.pathExists(configFile)) {
            const config = await fs.readJSON(configFile);
            
            // Add Node.js specific configuration
            config.implementation = 'nodejs';
            config.migrated_from = 'python';
            config.migration_date = formatISO(new Date());
            config.version = '2.0.0';
            
            await fs.writeJSON(configFile, config, { spaces: 2 });
            this.log('config_migrated', 'Configuration updated for Node.js implementation');
        } else {
            // Create default configuration
            const defaultConfig = {
                implementation: 'nodejs',
                version: '2.0.0',
                data_retention_days: 90,
                metrics_directory: this.metricsPath,
                enabled_features: {
                    session_tracking: true,
                    productivity_scoring: true,
                    anomaly_detection: true,
                    trend_analysis: true
                },
                performance_thresholds: {
                    max_hook_execution_time: 50,
                    max_memory_usage: 32,
                    max_analytics_processing_time: 2000
                },
                created_date: formatISO(new Date())
            };
            
            await fs.writeJSON(configFile, defaultConfig, { spaces: 2 });
            this.log('config_created', 'Default Node.js configuration created');
        }
        
        console.log('✅ Configuration migration completed');
    }

    /**
     * Convert data formats if needed
     */
    async convertDataFormats() {
        console.log('🔄 Converting data formats...');
        
        // Check if Python-specific data structures need conversion
        const indicatorsFile = path.join(this.metricsPath, 'productivity-indicators.json');
        
        if (await fs.pathExists(indicatorsFile)) {
            const indicators = await fs.readJSON(indicatorsFile);
            
            // Ensure Node.js compatibility
            if (!indicators.last_activity) {
                indicators.last_activity = formatISO(new Date());
            }
            
            if (!indicators.tools_used) {
                indicators.tools_used = {};
            }
            
            if (!indicators.agents_invoked) {
                indicators.agents_invoked = {};
            }
            
            await fs.writeJSON(indicatorsFile, indicators, { spaces: 2 });
            this.log('indicators_converted', 'Productivity indicators updated for Node.js');
        }
        
        console.log('✅ Data format conversion completed');
    }

    /**
     * Test Node.js implementation
     */
    async testNodeImplementation() {
        console.log('🧪 Testing Node.js implementation...');
        
        // Test analytics engine
        try {
            const { MetricsAnalyzer } = require(path.join(this.hooksPath, 'analytics-engine.js'));
            const analyzer = new MetricsAnalyzer(this.metricsPath);
            
            // Test basic functionality
            const baseline = await analyzer.loadBaseline();
            if (!baseline || typeof baseline.average_commands_per_hour !== 'number') {
                throw new Error('Analytics engine baseline test failed');
            }
            
            this.log('analytics_test', 'Analytics engine test passed');
            
        } catch (error) {
            throw new Error(`Analytics engine test failed: ${error.message}`);
        }
        
        // Test hook modules
        const hooks = ['session-start.js', 'session-end.js', 'tool-metrics.js'];
        for (const hook of hooks) {
            try {
                const hookModule = require(path.join(this.hooksPath, hook));
                if (typeof hookModule.main !== 'function') {
                    throw new Error(`${hook} does not export main function`);
                }
                
                this.log('hook_test', `${hook} module test passed`);
                
            } catch (error) {
                throw new Error(`${hook} test failed: ${error.message}`);
            }
        }
        
        console.log('✅ Node.js implementation tests passed');
    }

    /**
     * Verify migration success
     */
    async verifyMigration() {
        console.log('🔍 Verifying migration...');
        
        // Check that all required files exist
        const requiredFiles = [
            'config.json',
            'productivity-indicators.json',
            'current-baseline.json'
        ];
        
        for (const file of requiredFiles) {
            const filePath = path.join(this.metricsPath, file);
            if (!await fs.pathExists(filePath)) {
                console.warn(`⚠️  Missing file: ${file}`);
            } else {
                this.log('file_verified', `${file} exists`);
            }
        }
        
        // Test analytics data generation
        try {
            const { generateDashboardData } = require(path.join(this.hooksPath, 'analytics-engine.js'));
            const dashboardData = await generateDashboardData();
            
            if (!dashboardData || !dashboardData.dashboard_updated) {
                throw new Error('Dashboard data generation failed');
            }
            
            this.log('dashboard_test', 'Dashboard data generation verified');
            
        } catch (error) {
            console.warn(`⚠️  Dashboard verification failed: ${error.message}`);
        }
        
        console.log('✅ Migration verification completed');
    }

    /**
     * Check if session data is valid
     * @param {Object} data - Session data
     * @returns {boolean} Whether data is valid
     */
    isValidSessionData(data) {
        return data.session_id && 
               data.start_time && 
               typeof data.productivity_metrics === 'object';
    }

    /**
     * Log migration operation
     * @param {string} operation - Operation type
     * @param {string} message - Log message
     */
    log(operation, message) {
        const logEntry = {
            timestamp: formatISO(new Date()),
            operation: operation,
            message: message
        };
        
        this.migrationLog.push(logEntry);
    }

    /**
     * Save migration log
     */
    async saveMigrationLog() {
        const logFile = path.join(this.metricsPath, 'migration-log.jsonl');
        const logContent = this.migrationLog.map(entry => JSON.stringify(entry)).join('\n');
        await fs.writeFile(logFile, logContent + '\n');
    }
}

/**
 * CLI execution
 */
if (require.main === module) {
    (async () => {
        try {
            const metricsPath = process.argv[2] || path.join(os.homedir(), '.agent-os', 'metrics');
            const hooksPath = process.argv[3] || __dirname;
            
            console.log('🚀 Claude Config: Python to Node.js Migration Tool');
            console.log('================================================\n');
            
            console.log(`📁 Metrics Path: ${metricsPath}`);
            console.log(`🔧 Hooks Path: ${hooksPath}\n`);
            
            const migration = new PythonToNodeMigration(metricsPath, hooksPath);
            const result = await migration.migrate();
            
            // Save migration log
            await migration.saveMigrationLog();
            
            if (result.success) {
                console.log('🎉 Migration completed successfully!');
                console.log('\nNext Steps:');
                console.log('1. Test the Node.js hooks with: node session-start.js');
                console.log('2. Verify dashboard data: node analytics-engine.js');
                console.log('3. Monitor performance in normal usage');
                console.log('4. Remove Python backup after validation\n');
                
                process.exit(0);
            } else {
                console.log('❌ Migration failed. Check the backup and try again.');
                process.exit(1);
            }
            
        } catch (error) {
            console.error('❌ Migration utility failed:', error);
            process.exit(1);
        }
    })();
}

module.exports = PythonToNodeMigration;