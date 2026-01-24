#!/usr/bin/env node
/**
 * User Profile Management for Claude Config Hooks
 * Handles user authentication and identification for metrics
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class UserProfileManager {
    constructor() {
        this.profileDir = path.join(os.homedir(), '.ensemble', 'profile');
        this.profileFile = path.join(this.profileDir, 'user.json');
    }

    /**
     * Get or create user profile
     */
    async getUserProfile() {
        try {
            await fs.ensureDir(this.profileDir);

            if (await fs.pathExists(this.profileFile)) {
                const profile = await fs.readJson(this.profileFile);

                // Validate profile has required fields
                if (profile.userId && profile.email && profile.token) {
                    return profile;
                }
            }

            // Create new profile if none exists or invalid
            return await this.createDefaultProfile();

        } catch (error) {
            console.warn('Failed to load user profile, using default:', error.message);
            return this.getDefaultProfile();
        }
    }

    /**
     * Create a new user profile
     */
    async createUserProfile(userData) {
        const { email, name, organizationId = '1' } = userData;

        if (!email) {
            throw new Error('Email is required for user profile');
        }

        const profile = {
            userId: crypto.randomUUID(),
            email,
            name: name || email.split('@')[0],
            organizationId,
            token: this.generateToken(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'claude-config-hooks',
            version: '1.0.0'
        };

        await fs.ensureDir(this.profileDir);
        await fs.writeJson(this.profileFile, profile, { spaces: 2 });

        console.log(`✅ User profile created: ${profile.name} (${profile.email})`);
        return profile;
    }

    /**
     * Create default profile based on environment
     */
    async createDefaultProfile() {
        const osUser = process.env.USER || process.env.USERNAME || 'developer';
        const gitEmail = await this.getGitEmail();
        const gitName = await this.getGitName();

        const profile = {
            userId: crypto.randomUUID(),
            email: gitEmail || `${osUser}@localhost`,
            name: gitName || osUser,
            organizationId: '1', // Default organization
            token: this.generateToken(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            source: 'auto-generated',
            version: '1.0.0'
        };

        await fs.ensureDir(this.profileDir);
        await fs.writeJson(this.profileFile, profile, { spaces: 2 });

        console.log(`📝 Auto-generated user profile: ${profile.name} (${profile.email})`);
        console.log(`   To customize: node hooks/user-profile.js setup --email "your@email.com" --name "Your Name"`);

        return profile;
    }

    /**
     * Get fallback profile without file I/O
     */
    getDefaultProfile() {
        const osUser = process.env.USER || process.env.USERNAME || 'developer';
        return {
            userId: 'default-user',
            email: `${osUser}@localhost`,
            name: osUser,
            organizationId: '1',
            token: null,
            createdAt: new Date().toISOString(),
            source: 'fallback'
        };
    }

    /**
     * Generate authentication token
     */
    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Get git user email
     */
    async getGitEmail() {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('git config user.email', (error, stdout) => {
                    resolve(error ? null : stdout.trim());
                });
            });
        } catch {
            return null;
        }
    }

    /**
     * Get git user name
     */
    async getGitName() {
        try {
            const { exec } = require('child_process');
            return new Promise((resolve) => {
                exec('git config user.name', (error, stdout) => {
                    resolve(error ? null : stdout.trim());
                });
            });
        } catch {
            return null;
        }
    }

    /**
     * Update existing profile
     */
    async updateProfile(updates) {
        const profile = await this.getUserProfile();
        const updatedProfile = {
            ...profile,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await fs.writeJson(this.profileFile, updatedProfile, { spaces: 2 });
        console.log(`✅ User profile updated`);
        return updatedProfile;
    }

    /**
     * Reset profile (delete and recreate)
     */
    async resetProfile() {
        if (await fs.pathExists(this.profileFile)) {
            await fs.remove(this.profileFile);
            console.log('🗑️  User profile deleted');
        }
        return await this.createDefaultProfile();
    }

    /**
     * Show current profile
     */
    async showProfile() {
        const profile = await this.getUserProfile();
        console.log('\n📋 Current User Profile:');
        console.log(`   User ID: ${profile.userId}`);
        console.log(`   Name: ${profile.name}`);
        console.log(`   Email: ${profile.email}`);
        console.log(`   Organization: ${profile.organizationId}`);
        console.log(`   Created: ${profile.createdAt}`);
        console.log(`   Source: ${profile.source}`);
        if (profile.token) {
            console.log(`   Token: ${profile.token.substring(0, 8)}...`);
        }
        console.log('');
        return profile;
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const manager = new UserProfileManager();

    if (args.length === 0 || args[0] === 'show') {
        await manager.showProfile();
        return;
    }

    switch (args[0]) {
        case 'setup':
            const email = args.find(arg => arg.startsWith('--email='))?.split('=')[1];
            const name = args.find(arg => arg.startsWith('--name='))?.split('=')[1];
            const org = args.find(arg => arg.startsWith('--org='))?.split('=')[1];

            if (!email) {
                console.error('❌ Email is required: --email="your@email.com"');
                process.exit(1);
            }

            await manager.createUserProfile({ email, name, organizationId: org });
            break;

        case 'reset':
            await manager.resetProfile();
            break;

        case 'update':
            const updates = {};
            args.slice(1).forEach(arg => {
                if (arg.startsWith('--name=')) updates.name = arg.split('=')[1];
                if (arg.startsWith('--email=')) updates.email = arg.split('=')[1];
                if (arg.startsWith('--org=')) updates.organizationId = arg.split('=')[1];
            });

            if (Object.keys(updates).length === 0) {
                console.error('❌ No updates provided. Use --name, --email, or --org');
                process.exit(1);
            }

            await manager.updateProfile(updates);
            break;

        case 'help':
        default:
            console.log(`
📋 Claude Config User Profile Manager

Usage:
  node user-profile.js [command] [options]

Commands:
  show                     Show current user profile
  setup                    Create new user profile
  update                   Update existing profile
  reset                    Delete and recreate profile
  help                     Show this help

Setup Options:
  --email="your@email.com" User email (required)
  --name="Your Name"       Display name (optional)
  --org="org-id"          Organization ID (optional)

Examples:
  node user-profile.js setup --email="john@company.com" --name="John Doe"
  node user-profile.js update --name="John Smith"
  node user-profile.js reset
`);
            break;
    }
}

// Export for use in other modules
module.exports = { UserProfileManager };

// CLI execution
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
    });
}