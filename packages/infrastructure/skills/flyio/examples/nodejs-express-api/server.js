// Example Express API Server
const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Example API endpoint
app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello from Fly.io!',
    region: process.env.FLY_REGION || 'unknown'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express API listening on port ${PORT}`);
});
