'use strict';
// Copies src/ to dist/ (placeholder for a real bundler).
const fs = require('fs');
fs.cpSync('src', 'dist', { recursive: true });
