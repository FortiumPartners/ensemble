#!/usr/bin/env node
/**
 * Get Authentication Token Helper
 * Simple script to display the current user's authentication token
 */

const { UserProfileManager } = require('./user-profile');

async function main() {
    try {
        const manager = new UserProfileManager();
        const profile = await manager.getUserProfile();

        if (!profile.token) {
            console.log('❌ No authentication token found.');
            console.log('💡 Run: node user-profile.js setup --email="your@email.com"');
            process.exit(1);
        }

        console.log('🔑 Your Authentication Token:');
        console.log('');
        console.log(`Token: ${profile.token}`);
        console.log('');
        console.log('📋 Usage:');
        console.log('  - This token is automatically used by hooks');
        console.log('  - For API calls, include in Authorization header:');
        console.log(`    Authorization: Bearer ${profile.token}`);
        console.log('');
        console.log('📧 Associated with:');
        console.log(`  Name: ${profile.name}`);
        console.log(`  Email: ${profile.email}`);
        console.log(`  User ID: ${profile.userId}`);
        console.log(`  Organization: ${profile.organizationId}`);
        console.log('');
        console.log('🔧 Commands:');
        console.log('  View profile: node user-profile.js show');
        console.log('  Update profile: node user-profile.js update --name="New Name"');
        console.log('  Reset profile: node user-profile.js reset');

    } catch (error) {
        console.error('❌ Error getting authentication token:', error.message);
        console.log('');
        console.log('💡 Try creating a profile first:');
        console.log('   node user-profile.js setup --email="your@email.com" --name="Your Name"');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}