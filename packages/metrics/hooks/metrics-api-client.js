#!/usr/bin/env node
/**
 * Metrics API Client for External Metrics Web Service Integration
 * Provides HTTP client functionality for hooks to send data to backend
 * 
 * Performance Requirements:
 * - HTTP request timeout: ≤5 seconds
 * - Retry logic for failed requests
 * - Graceful degradation if backend unavailable
 */

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class MetricsApiClient {
    constructor(config = {}) {
        this.baseURL = config.baseURL || process.env.METRICS_API_URL || 'http://localhost:3002/api/v1';
        this.timeout = config.timeout || 5000;
        this.retryAttempts = config.retryAttempts || 2;
        this.retryDelay = config.retryDelay || 1000;
        
        // Create axios instance with configuration
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: this.timeout,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Claude-Config-Hooks/2.0.0'
            }
        });
        
        // Add request/response interceptors
        this.setupInterceptors();
    }

    setupInterceptors() {
        // Request interceptor for authentication
        this.client.interceptors.request.use(
            async (config) => {
                // Try to get authentication token if available
                const token = await this.getAuthToken();
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
                return config;
            },
            (error) => Promise.reject(error)
        );

        // Response interceptor for error handling
        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config;
                
                // If 401 and we haven't already retried, try to get a fresh token
                if (error.response?.status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;
                    const token = await this.refreshAuthToken();
                    if (token) {
                        originalRequest.headers.Authorization = `Bearer ${token}`;
                        return this.client(originalRequest);
                    }
                }
                
                return Promise.reject(error);
            }
        );
    }

    /**
     * Get authentication token from local storage or environment
     */
    async getAuthToken() {
        try {
            // Try environment variable first
            if (process.env.METRICS_API_TOKEN) {
                return process.env.METRICS_API_TOKEN;
            }
            
            // Try local token file (if available)
            const tokenFile = path.join(os.homedir(), '.ensemble', 'metrics', '.auth-token');
            if (await fs.pathExists(tokenFile)) {
                const tokenData = await fs.readJson(tokenFile);
                if (tokenData.accessToken && new Date(tokenData.expiresAt) > new Date()) {
                    return tokenData.accessToken;
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Attempt to refresh authentication token
     */
    async refreshAuthToken() {
        try {
            const tokenFile = path.join(os.homedir(), '.ensemble', 'metrics', '.auth-token');
            if (await fs.pathExists(tokenFile)) {
                const tokenData = await fs.readJson(tokenFile);
                if (tokenData.refreshToken) {
                    const response = await axios.post(`${this.baseURL}/auth/refresh`, {
                        refreshToken: tokenData.refreshToken
                    });
                    
                    const { accessToken, refreshToken } = response.data.data.tokens;
                    await fs.writeJson(tokenFile, {
                        accessToken,
                        refreshToken,
                        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                    });
                    
                    return accessToken;
                }
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Make HTTP request with retry logic
     */
    async makeRequest(method, endpoint, data = null, options = {}) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= this.retryAttempts + 1; attempt++) {
            try {
                const response = await this.client.request({
                    method,
                    url: endpoint,
                    data,
                    ...options
                });
                
                return {
                    success: true,
                    data: response.data,
                    status: response.status,
                    attempt
                };
                
            } catch (error) {
                lastError = error;
                
                // Don't retry on client errors (4xx) except 401
                if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 401) {
                    break;
                }
                
                // Wait before retry (except on last attempt)
                if (attempt <= this.retryAttempts) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                }
            }
        }
        
        return {
            success: false,
            error: lastError.message || 'Unknown error',
            status: lastError.response?.status || 0,
            attempts: this.retryAttempts + 1
        };
    }

    /**
     * Send session data to backend
     */
    async submitSession(sessionData) {
        return this.makeRequest('POST', '/metrics/sessions', sessionData);
    }

    /**
     * Send tool metrics to backend (using hooks endpoint)
     */
    async submitToolMetrics(toolMetrics) {
        return this.makeRequest('POST', '/hooks/tool-metrics', toolMetrics);
    }

    /**
     * Send productivity metrics to backend
     */
    async submitProductivityMetrics(productivityData) {
        return this.makeRequest('POST', '/metrics/productivity', productivityData);
    }

    /**
     * Submit analytics data to backend
     */
    async submitAnalytics(analyticsData) {
        return this.makeRequest('POST', '/metrics/analytics', analyticsData);
    }

    /**
     * Health check endpoint
     */
    async healthCheck() {
        return this.makeRequest('GET', '/health');
    }

    /**
     * Test connection to metrics backend
     */
    async testConnection() {
        try {
            const result = await this.healthCheck();
            return {
                success: result.success,
                message: result.success ? 'Connection successful' : `Connection failed: ${result.error}`,
                baseURL: this.baseURL,
                status: result.status
            };
        } catch (error) {
            return {
                success: false,
                message: `Connection test failed: ${error.message}`,
                baseURL: this.baseURL,
                status: 0
            };
        }
    }
}

/**
 * Utility function to safely send data to backend with fallback to local storage
 */
async function sendToBackendWithFallback(apiClient, method, data, localFallback) {
    try {
        const result = await method.call(apiClient, data);
        
        if (result.success) {
            return {
                success: true,
                method: 'api',
                message: 'Data sent to backend successfully',
                response: result
            };
        } else {
            // API call failed, fall back to local storage
            if (localFallback) {
                await localFallback(data);
                return {
                    success: true,
                    method: 'local_fallback',
                    message: 'Backend unavailable, data stored locally',
                    error: result.error
                };
            } else {
                return {
                    success: false,
                    method: 'api',
                    message: 'API call failed and no local fallback provided',
                    error: result.error
                };
            }
        }
    } catch (error) {
        // Exception occurred, fall back to local storage
        if (localFallback) {
            try {
                await localFallback(data);
                return {
                    success: true,
                    method: 'local_fallback',
                    message: 'Exception occurred, data stored locally',
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
        } else {
            return {
                success: false,
                method: 'api',
                message: 'Exception occurred and no local fallback provided',
                error: error.message
            };
        }
    }
}

// Export for use in other modules
module.exports = {
    MetricsApiClient,
    sendToBackendWithFallback
};

// CLI functionality for testing
if (require.main === module) {
    async function testApiClient() {
        console.log('🧪 Testing Metrics API Client...\n');
        
        const client = new MetricsApiClient();
        
        // Test connection
        console.log('1. Testing connection...');
        const connectionTest = await client.testConnection();
        console.log(`   ${connectionTest.success ? '✅' : '❌'} ${connectionTest.message}`);
        console.log(`   Base URL: ${connectionTest.baseURL}\n`);
        
        if (connectionTest.success) {
            // Test submitting sample tool metrics
            console.log('2. Testing tool metrics submission...');
            const sampleToolMetrics = {
                tool_name: 'Read',
                execution_time_ms: 25,
                success: true,
                file_path: '/tmp/test.txt',
                timestamp: new Date().toISOString(),
                session_id: 'test-session-' + Date.now()
            };
            
            const toolResult = await client.submitToolMetrics(sampleToolMetrics);
            console.log(`   ${toolResult.success ? '✅' : '❌'} Tool metrics: ${toolResult.success ? 'Success' : toolResult.error}`);
            
            // Test submitting sample session data
            console.log('3. Testing session submission...');
            const sampleSession = {
                session_id: 'test-session-' + Date.now(),
                start_time: new Date().toISOString(),
                duration_hours: 0.5,
                productivity_score: 7.5,
                metrics: {
                    commands_executed: 10,
                    files_modified: 3,
                    lines_changed: 45
                }
            };
            
            const sessionResult = await client.submitSession(sampleSession);
            console.log(`   ${sessionResult.success ? '✅' : '❌'} Session data: ${sessionResult.success ? 'Success' : sessionResult.error}`);
        }
        
        console.log('\n🎉 API Client test completed!');
    }
    
    testApiClient().catch(error => {
        console.error('❌ API Client test failed:', error);
        process.exit(1);
    });
}